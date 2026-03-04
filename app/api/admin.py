import logging
from typing import Optional
from decimal import Decimal
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.core.db import db

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Dummy Dependency for MVP ---
async def get_current_admin():
    # In a real app, this parses a JWT and validates `role == 'ADMIN'`
    # We'll return a hardcoded admin User ID for the MVP backend skeleton
    return "admin-uuid-1234"

# --- Models ---
class UpdateProfileRequest(BaseModel):
    bio: Optional[str] = None
    xianyuHomeUrl: Optional[str] = None

class ConfirmPaymentRequest(BaseModel):
    actual_paid_amount: float

# --- Profile API ---
@router.patch("/profile")
async def update_admin_profile(req: UpdateProfileRequest, admin_id: str = Depends(get_current_admin)):
    """
    Allows the Admin to update their trust building properties: bio (rules) and Xianyu profile link.
    """
    try:
        updated_user = await db.user.update(
            where={"id": admin_id},
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
async def get_pending_audit_orders(admin_id: str = Depends(get_current_admin)):
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
async def confirm_payment(order_id: str, req: ConfirmPaymentRequest, admin_id: str = Depends(get_current_admin)):
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
