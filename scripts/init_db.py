import asyncio
import logging
from prisma import Prisma
import bcrypt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def init():
    db = Prisma()
    await db.connect()

    try:
        # Create or verify Admin User
        admin_nickname = "SuperAdmin"
        admin_pin = "123456"
        hashed_pin = bcrypt.hashpw(admin_pin.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        admin_user = await db.user.find_unique(where={"nickname": admin_nickname})
        if not admin_user:
            admin_user = await db.user.create({
                "nickname": admin_nickname,
                "hashedPin": hashed_pin,
                "role": "ADMIN",
                "trustScore": 100,
                "bio": "Official Test Admin",
                "xianyuHomeUrl": "https://2.taobao.com"
            })
            logger.info(f"Created Admin User: {admin_nickname} (PIN: 123456)")
        else:
            logger.info("Admin User already exists.")

        # Create dummy Event
        event_id = "draft-event-uuid-1234"
        event = await db.event.find_unique(where={"id": event_id})
        if not event:
            event = await db.event.create({
                "id": event_id,
                "name": "Sprint 6 Test Drop",
                "status": "ACTIVE"
            })
            logger.info("Created Sprint 6 Test Event")

            # Create a Cold Product
            cold_product = await db.product.create({
                "eventId": event.id,
                "name": "冷门款立牌 (Cold Stand)",
                "price": 20.00,
                "stock": 50,
                "x": 20,
                "y": 20
            })

            # Create a Hot Product requiring the Cold Product
            await db.product.create({
                "eventId": event.id,
                "name": "热门款徽章 (Hot Badge)",
                "price": 50.00,
                "stock": 10,
                "bundleRequirement": f"{cold_product.id}:1", # Needs 1 cold product
                "x": 60,
                "y": 60
            })
            logger.info("Created Dummy Products with Bundle Logic")

    except Exception as e:
        logger.error(f"Failed to bootstrap DB: {e}")
    finally:
        await db.disconnect()

if __name__ == "__main__":
    asyncio.run(init())
