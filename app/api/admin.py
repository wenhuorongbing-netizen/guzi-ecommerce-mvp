import logging
import csv
import io
from typing import Optional
from decimal import Decimal
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.core.db import db
from app.api.auth import get_current_admin

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Models ---
class UpdateProfileRequest(BaseModel):
    bio: Optional[str] = None
    xianyuHomeUrl: Optional[str] = None

class ConfirmPaymentRequest(BaseModel):
    actual_paid_amount: float

# --- Profile API ---
@router.patch("/profile")
async def update_admin_profile(req: UpdateProfileRequest, admin_user = Depends(get_current_admin)):
    """
    Allows the Admin to update their trust building properties: bio (rules) and Xianyu profile link.
    """
    try:
        updated_user = await db.user.update(
            where={"id": admin_user.id},
            data={
                "bio": req.bio,
                "xianyuHomeUrl": req.xianyuHomeUrl
            }
        )
        return {"status": "success", "message": "Profile updated successfully"}
    except Exception as e:
        logger.error(f"Failed to update profile: {e}")
        raise HTTPException(status_code=500, detail="Internal server error updating profile.")


# --- Audit Dashboard APIs ---
@router.get("/orders/pending-audit")
async def get_pending_audit_orders(admin_user = Depends(get_current_admin)):
    """
    Returns all orders where buyers have submitted an external Xianyu order ID,
    waiting for the admin to confirm the payment amount.
    """
    try:
        orders = await db.order.find_many(
            where={
                "status": "PENDING_AUDIT"
            },
            include={
                "user": True,  # to get the buyer's nickname
                "items": True
            },
            order={"updatedAt": "asc"}
        )

        # Structure the response for the frontend dashboard
        results = []
        for o in orders:
            results.append({
                "order_id": o.id,
                "buyer_nickname": o.user.nickname if o.user else "Unknown",
                "expected_amount": float(o.totalAmount),
                "external_order_id": o.externalOrderId,
                "reconciliation_code": o.reconciliationCode,
                "submitted_at": o.updatedAt.isoformat()
            })

        return {"status": "success", "data": results}
    except Exception as e:
        logger.error(f"Failed to fetch pending audit orders: {e}")
        raise HTTPException(status_code=500, detail="Internal server error fetching orders.")


@router.post("/orders/{order_id}/confirm-payment")
async def confirm_payment(order_id: str, req: ConfirmPaymentRequest, admin_user = Depends(get_current_admin)):
    """
    Admin confirms the actual paid amount against the external order ID.
    Transitions order to PAID and creates the Payment record.
    """
    async with db.tx() as tx:
        order = await tx.order.find_unique(where={"id": order_id})

        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        if order.status != "PENDING_AUDIT":
            raise HTTPException(status_code=400, detail="Order is not in pending audit status")

        actual = Decimal(str(req.actual_paid_amount))
        expected = order.totalAmount

        if actual < expected:
            # Partial or short payment. For Sprint 4, we mark as mismatch.
            await tx.order.update(
                where={"id": order.id},
                data={"status": "PAYMENT_MISMATCH"}
            )
            # Create a Payment record denoting the failure/shortfall
            await tx.payment.create(data={
                "orderId": order.id,
                "paymentType": "DEPOSIT",
                "expectedAmount": expected,
                "actualPaidAmount": actual,
                "differenceAmount": expected - actual,
                "externalOrderId": order.externalOrderId,
                "status": "AUDIT_FAILED_MISMATCH"
            })
            return {"status": "mismatch", "message": f"Shortfall detected: expected {expected}, got {actual}"}

        else:
            # Full payment confirmed
            await tx.order.update(
                where={"id": order.id},
                data={"status": "PAID"} # Updated to the new Sprint 4 simplified status
            )

            # Create the successful Payment record
            await tx.payment.create(data={
                "orderId": order.id,
                "paymentType": "DEPOSIT",
                "expectedAmount": expected,
                "actualPaidAmount": actual,
                "differenceAmount": actual - expected, # 0 or positive if overpaid
                "externalOrderId": order.externalOrderId,
                "status": "AUDIT_PASSED"
            })
            return {"status": "success", "message": "Payment confirmed and order marked as PAID."}

# --- Export API ---
@router.get("/events/{event_id}/export")
async def export_paid_orders_csv(event_id: str, admin_user = Depends(get_current_admin)):
    """
    Generates a CSV report of all PAID orders for a specific event.
    """
    try:
        # Find all PAID orders for this event
        orders = await db.order.find_many(
            where={
                "status": "PAID",
                "items": {
                    "some": {
                        "product": {
                            "eventId": event_id
                        }
                    }
                }
            },
            include={
                "user": True,
                "items": {
                    "include": {
                        "product": True
                    }
                }
            }
        )

        if not orders:
            raise HTTPException(status_code=404, detail="No paid orders found for this event.")

        output = io.StringIO()
        writer = csv.writer(output)

        # Write CSV Header
        writer.writerow(["Buyer Nickname", "Xianyu Order ID", "Total Amount (¥)", "Purchased Items"])

        for order in orders:
            buyer_name = order.user.nickname if order.user else "Unknown"
            xianyu_id = order.externalOrderId or "N/A"
            total = f"{order.totalAmount:.2f}"

            # Format items list: "ItemA x2, ItemB x1"
            items_str = ", ".join(
                [f"{item.product.name} x{item.quantity}" for item in order.items if item.product]
            )

            writer.writerow([buyer_name, xianyu_id, total, items_str])

        output.seek(0)

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=export_event_{event_id}.csv"}
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Failed to generate CSV export for event {event_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error generating export.")

@router.get("/events/{event_id}/notif-template")
async def generate_notification_template(event_id: str, admin_user = Depends(get_current_admin)):
    """
    Sprint 6: 补款通知助手
    Generates a copy-pasteable notification template for chat groups.
    """
    try:
        event = await db.event.find_unique(where={"id": event_id})
        if not event:
            raise HTTPException(status_code=404, detail="Event not found.")

        template = (
            f"📢【补款通知】\n"
            f"🎉 {event.name} 已到货/开启补款！\n\n"
            f"请各位宝宝点击下方链接查看您的专属账单并支付国际邮费。\n"
            f"👉 补款链接：https://guzi.app/event/{event.id}/checkout\n\n"
            f"⚠️ 注意事项：\n"
            f"1. 请在闲鱼拍下对应金额，并在备注填写您原有的【对账暗号】！\n"
            f"2. 团长将严格按照您在闲鱼填写的收货地址发货，请务必核对无误。\n"
            f"3. 逾期未补款将视为跑单处理，请大家尽快操作哦~ 感谢配合！💖"
        )

        return {"status": "success", "template": template}
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Failed to generate notification template: {e}")
        raise HTTPException(status_code=500, detail="Internal server error generating template.")
