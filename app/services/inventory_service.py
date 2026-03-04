import redis.asyncio as redis
from fastapi import HTTPException
import logging
import os

logger = logging.getLogger(__name__)

# Fallback REDIS_URL suitable for testing or local development
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Initialize Redis client globally to be reused across requests
redis_client = redis.from_url(REDIS_URL, decode_responses=True)

# Preload the Lua Script for atomic inventory deduction.
# This ensures that read and write happen without interruption from other clients.
# Returns:
#   new_stock (>= 0) on success
#   -1 if key doesn't exist
#   -2 if not enough stock
LUA_CLAIM_STOCK = """
local stock_key = KEYS[1]
local decrement = tonumber(ARGV[1])

local current_stock = redis.call('GET', stock_key)
if not current_stock then
    return -1
end

current_stock = tonumber(current_stock)
if current_stock >= decrement then
    local new_stock = redis.call('DECRBY', stock_key, decrement)
    return new_stock
else
    return -2
end
"""

claim_script = redis_client.register_script(LUA_CLAIM_STOCK)

async def claim_item_atomic(user_id: str, product_id: str, quantity: int = 1):
    """
    Executes the Lua script to atomically soft-lock inventory in Redis.
    """
    stock_key = f"product:{product_id}:stock"

    try:
        # Pass the product stock key as KEYS[1] and quantity/user_id as ARGV
        result = await claim_script(keys=[stock_key], args=[quantity, user_id])

        if result == -1:
            raise HTTPException(
                status_code=404,
                detail="Product not found or not active for sale in Redis."
            )
        elif result == -2:
            raise HTTPException(
                status_code=400,
                detail="Out of stock. Better luck next time!"
            )

        # Returning success object representing soft lock obtained
        return {"status": "success", "remaining_stock": result}

    except redis.RedisError as e:
        logger.error(f"Redis error during atomic claim for product {product_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error during claiming.")