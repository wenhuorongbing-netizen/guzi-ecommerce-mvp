from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from app.core.db import db
from app.api.auth import get_current_admin
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

class HotspotDraft(BaseModel):
    id: str  # Frontend generated UUID
    x: float
    y: float
    name: str
    price: float
    stock: int

class BatchProductsRequest(BaseModel):
    event_id: str
    image_url: Optional[str] = None
    hotspots: List[HotspotDraft]

@router.post("/batch")
async def create_batch_products(req: BatchProductsRequest, admin_user = Depends(get_current_admin)):
    """
    Receives JSON containing hotspots mapped from the Image Tagging UI
    and bulk inserts them as Product entities.
    """
    # Verify the event exists
    event = await db.event.find_unique(where={"id": req.event_id})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    try:
        # Use a transaction to ensure either all hotspots are inserted or none
        async with db.tx() as tx:
            inserted_products = []
            for hs in req.hotspots:
                product = await tx.product.create(
                    data={
                        "eventId": req.event_id,
                        "name": hs.name,
                        "price": Decimal(str(hs.price)),
                        "stock": hs.stock,
                        "imageUrl": req.image_url,
                        "x": hs.x,
                        "y": hs.y
                    }
                )
                inserted_products.append(product)

        return {
            "status": "success",
            "message": f"Successfully created {len(inserted_products)} products.",
            "count": len(inserted_products)
        }
    except Exception as e:
        logger.error(f"Failed to insert batch products: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during batch creation")
