import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.db import db
from app.api.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

class VerifyPaymentRequest(BaseModel):
    order_id: str
    external_order_id: str

@router.post("/verify-payment")
async def verify_payment(req: VerifyPaymentRequest, current_user = Depends(get_current_user)):
    """
    Called by the Buyer after they've checked out on Xianyu and want to submit their external order ID.
    Transitions the Order state from AWAITING_PAYMENT to PENDING_AUDIT.
    """
    async with db.tx() as tx:
        # Find the order
        order = await tx.order.find_unique(where={"id": req.order_id})

        if not order:
            raise HTTPException(status_code=404, detail="Order not found.")

        if order.userId != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to modify this order.")

        if order.status == "CANCELLED":
            raise HTTPException(status_code=400, detail="Order has already expired and been cancelled.")

        if order.status != "AWAITING_PAYMENT":
            raise HTTPException(status_code=400, detail="Order is not awaiting payment.")

        # Update Order status and append the external ID
        await tx.order.update(
            where={"id": req.order_id},
            data={
                "status": "PENDING_AUDIT"
            }
        )

        # Link it to the AWAITING_PAYMENT payment record
        # In a real system, you might have to find the specific 'DEPOSIT' payment
        payment = await tx.payment.find_first(
            where={
                "orderId": req.order_id,
                "status": "AWAITING_PAYMENT"
            }
        )

        if payment:
            await tx.payment.update(
                where={"id": payment.id},
                data={
                    "status": "PENDING_AUDIT",
                    "externalOrderId": req.external_order_id
                }
            )

        return {"status": "success", "message": "Payment external ID submitted. Awaiting Admin Audit."}

@router.get("/my-orders")
async def get_my_orders(current_user = Depends(get_current_user)):
    """
    Allows a buyer to query their own orders safely.
    """
    try:
        orders = await db.order.find_many(
            where={
                "userId": current_user.id
            },
            include={
                "items": {
                    "include": {
                        "product": True
                    }
                },
                "payments": True
            },
            order={"createdAt": "desc"}
        )
        return {"status": "success", "data": orders}
    except Exception as e:
        logger.error(f"Failed fetching orders for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/admin/trigger-ttl-cron")
async def manual_trigger_ttl():
    """
    Trigger endpoint to simulate a CRON job that finds expired AWAITING_PAYMENT orders (older than 2 hours)
    and cancels them, releasing the soft locks.
    """
    try:
        two_hours_ago = datetime.utcnow() - timedelta(hours=2)

        # Find orders that are still waiting for payment and were created more than 2 hours ago
        expired_orders = await db.order.find_many(
            where={
                "status": "AWAITING_PAYMENT",
                "createdAt": {
                    "lt": two_hours_ago
                }
            },
            include={
                "items": True
            }
        )

        cancelled_count = 0
        for order in expired_orders:
            async with db.tx() as tx:
                # Cancel the order
                await tx.order.update(
                    where={"id": order.id},
                    data={"status": "CANCELLED"}
                )

                # Mark associated payments as cancelled
                payments = await tx.payment.find_many(where={"orderId": order.id})
                for p in payments:
                    if p.status == "AWAITING_PAYMENT":
                        # We use AUDIT_FAILED_MISMATCH or a custom status to denote it was dropped
                        await tx.payment.update(
                            where={"id": p.id},
                            data={"status": "AUDIT_FAILED_MISMATCH"}
                        )

                # IMPORTANT: In a full system, here is where you would call Redis to INCR the inventory back
                # e.g.,
                # for item in order.items:
                #     await redis_client.incrby(f"product:{item.productId}:stock", item.quantity)

                cancelled_count += 1
                logger.info(f"Automatically cancelled expired order: {order.id}")

        return {"status": "success", "expired_orders_cancelled": cancelled_count}

    except Exception as e:
        logger.error(f"Error running TTL cron: {e}")
        raise HTTPException(status_code=500, detail="Internal server error executing TTL cron.")