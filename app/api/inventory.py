from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
import logging

from app.services.inventory_service import claim_item_atomic
from app.core.db import db

router = APIRouter()
logger = logging.getLogger(__name__)

class ClaimRequest(BaseModel):
    product_id: str
    quantity: int = 1

# Dummy dependency to simulate a logged-in User
async def get_current_user_id() -> str:
    # MVP dummy value for testing endpoints without JWT parsing
    return "dummy-buyer-uuid"

@router.post("/claim")
async def handle_claim(req: ClaimRequest, user_id: str = Depends(get_current_user_id)) -> Dict[str, Any]:
    """
    Handles high-concurrency claims for items.
    """
    try:
        # Step 1: Atomic Soft-Lock in Redis via Lua Script
        # Will raise an HTTPException(400) if oversold or 404 if not found
        claim_result = await claim_item_atomic(user_id, req.product_id, req.quantity)

        # Step 2: Push message to queue or write Order creation to DB (Simplified for MVP)
        # Assuming enqueue_order_creation is implemented via Celery/Streams
        # await enqueue_order_creation(user_id, req.product_id, req.quantity)

        return {
            "message": "Claim successful, waiting for payment.",
            "remaining_stock": claim_result["remaining_stock"],
            "status": claim_result["status"]
        }

    except HTTPException as http_exc:
        # Pass through expected API exceptions
        raise http_exc
    except Exception as e:
        logger.error(f"Unexpected error in claim endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal system error processing claim.")