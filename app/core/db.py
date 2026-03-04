from prisma import Prisma
import logging
import asyncio

logger = logging.getLogger(__name__)
db = Prisma()

async def connect_db(retries: int = 5, delay: int = 5):
    """
    Connect to Prisma with abnormal disconnect retry logic.
    Useful in Dockerized environments where DB might start slower than API.
    """
    for attempt in range(1, retries + 1):
        try:
            if not db.is_connected():
                await db.connect()
                logger.info("Successfully connected to the Prisma database.")
            return
        except Exception as e:
            logger.warning(f"Database connection attempt {attempt}/{retries} failed: {e}")
            if attempt < retries:
                logger.info(f"Retrying in {delay} seconds...")
                await asyncio.sleep(delay)
            else:
                logger.error("All attempts to connect to the database failed.")
                raise e

async def disconnect_db():
    if db.is_connected():
        try:
            await db.disconnect()
            logger.info("Disconnected from the database.")
        except Exception as e:
            logger.error(f"Failed to disconnect from the database cleanly: {e}")