import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.core.db import db
from app.api.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

from typing import List
from decimal import Decimal
import uuid

class OrderItemRequest(BaseModel):
    product_id: str
    quantity: int

class CreateOrderRequest(BaseModel):
    items: List[OrderItemRequest]

class VerifyPaymentRequest(BaseModel):
    order_id: str
    external_order_id: str

@router.post("/create")
async def create_order(req: CreateOrderRequest, current_user = Depends(get_current_user)):
    """
    Sprint 6: Checkout endpoint implementing Bundle Sales Logic (捆绑销售).
    """
    if not req.items:
        raise HTTPException(status_code=400, detail="Cart is empty.")

    # 1. Fetch requested products
    product_ids = [item.product_id for item in req.items]
    products = await db.product.find_many(where={"id": {"in": product_ids}})
    product_map = {p.id: p for p in products}

    # Verify all products exist
    for item in req.items:
        if item.product_id not in product_map:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found.")

    # 2. Check Bundle Requirements
    cart_quantities = {item.product_id: item.quantity for item in req.items}

    for item in req.items:
        product = product_map[item.product_id]
        if product.bundleRequirement:
            # Expected format "REQUIRED_ID:REQUIRED_QTY"
            try:
                req_id, req_qty_str = product.bundleRequirement.split(":")
                req_qty = int(req_qty_str) * item.quantity # Scale required cold item by hot item qty

                # Check if the cart has enough of the required cold item
                cart_qty = cart_quantities.get(req_id, 0)
                if cart_qty < req_qty:
                    cold_product = await db.product.find_unique(where={"id": req_id})
                    cold_name = cold_product.name if cold_product else req_id
                    raise HTTPException(
                        status_code=400,
                        detail=f"Requirement not met: [{product.name}] requires you to also purchase [{req_qty}x {cold_name}]."
                    )
            except ValueError:
                logger.error(f"Malformed bundleRequirement for product {product.id}: {product.bundleRequirement}")

    # 3. Process Order Creation (Assuming Redis soft-locks have already been acquired in a real flow,
    #    or they are acquired here. For MVP checkout, we commit the order to DB).
    async with db.tx() as tx:
        total_amount = Decimal(0)
        order_id = str(uuid.uuid4())

        # Calculate total
        for item in req.items:
            total_amount += product_map[item.product_id].price * item.quantity

        reconciliation_code = f"{current_user.nickname[:3].upper()}_{order_id[:4].upper()}"

        # Create Order
        order = await tx.order.create(data={
            "id": order_id,
            "userId": current_user.id,
            "totalAmount": total_amount,
            "status": "AWAITING_PAYMENT",
            "reconciliationCode": reconciliation_code
        })

        # Create Items
        for item in req.items:
            await tx.orderitem.create(data={
                "orderId": order.id,
                "productId": item.product_id,
                "quantity": item.quantity,
                "price": product_map[item.product_id].price
            })

        # Create initial pending Payment record
        await tx.payment.create(data={
            "orderId": order.id,
            "paymentType": "DEPOSIT",
            "expectedAmount": total_amount,
            "status": "AWAITING_PAYMENT"
        })

    return {"status": "success", "order_id": order.id, "reconciliation_code": reconciliation_code, "total": float(total_amount)}

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