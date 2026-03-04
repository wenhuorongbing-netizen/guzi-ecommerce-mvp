# 谷子代购对账系统 MVP 核心架构设计

## 1. Database Schema Design (Prisma)

本项目采用 PostgreSQL 作为主存储，Prisma 作为 ORM。以下是核心数据表结构，重点体现订单的状态机转换以及与第三方二手交易平台（如闲鱼）的对账关联。

```prisma
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 用户：由于是基于简易昵称的轻量级系统，前期仅保存必要信息
model User {
  id        String   @id @default(uuid())
  nickname  String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orders    Order[]
}

// 场次/批次：一次团购活动，可以包含多个商品
model Event {
  id          String    @id @default(uuid())
  name        String    // 比如 "2023年10月排球少年吧唧团"
  description String?
  status      EventStatus @default(DRAFT)
  startTime   DateTime? // 开团抢单时间
  endTime     DateTime? // 截团时间
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  products    Product[]
}

enum EventStatus {
  DRAFT       // 草稿（正在通过 AI 上架）
  PUBLISHED   // 已发布/预热中
  ACTIVE      // 抢单进行中
  CLOSED      // 截团
}

// 商品：关联到具体的一个场次
model Product {
  id          String   @id @default(uuid())
  eventId     String
  event       Event    @relation(fields: [eventId], references: [id])
  name        String   // 角色名或物品名
  price       Decimal  @db.Decimal(10, 2)
  stock       Int      @default(0) // 实际库存
  imageUrl    String?  // 切片图片或热区图片

  orderItems  OrderItem[]
}

// 订单：包含一个用户在一次开团中抢到的汇总商品
model Order {
  id               String      @id @default(uuid())
  userId           String
  user             User        @relation(fields: [userId], references: [id])
  totalAmount      Decimal     @db.Decimal(10, 2)
  status           OrderStatus @default(CREATED)

  // 对账核心字段
  reconciliationCode String      @unique // 唯一对账暗号，买家拍闲鱼时填在备注
  externalOrderId    String?     // 买家回填的第三方(闲鱼)订单号

  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  items            OrderItem[]
}

// 订单状态机
enum OrderStatus {
  CREATED               // 已创建（抢单成功尚未生成总账单）
  AWAITING_PAYMENT      // 待支付（截团后生成汇总账单，等待买家去闲鱼拍下）
  PENDING_VERIFICATION  // 待核验（买家已回填单号，等待团长确认）
  PAID                  // 已支付（团长核对闲鱼订单与对账暗号无误）
  SHIPPED               // 已发货
  CANCELLED             // 已取消
}

// 订单项：具体抢到了什么
model OrderItem {
  id        String  @id @default(uuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id])
  productId String
  product   Product @relation(fields: [productId], references: [id])
  quantity  Int     @default(1)
  price     Decimal @db.Decimal(10, 2) // 下单时的快照价格
}
```

## 2. Architecture & Redis Logic (防超卖核心)

在极小库存并发抢单场景下，数据库的行锁容易导致性能瓶颈。我们需要引入 Redis 作为库存的“Source of Truth”。核心思路是利用 Redis 的单线程特性和 Lua 脚本，实现**库存检查和扣减的原子操作**。

### Lua 脚本: 原子扣减库存

在 Redis 中，每个商品库存使用一个字符串类型的 Key 表示，例如 `product:{product_id}:stock`。

```lua
-- claim_stock.lua
-- KEYS[1] : 商品库存键 (例如 "product:123:stock")
-- ARGV[1] : 扣减数量 (通常为 1)
-- ARGV[2] : 用户标识 (用于幂等或限制单人限购，这里暂不复杂化，仅做基础防超卖)

local stock_key = KEYS[1]
local decrement = tonumber(ARGV[1])

-- 获取当前库存
local current_stock = redis.call('GET', stock_key)

-- 如果键不存在，说明未初始化或商品不存在
if not current_stock then
    return -1 -- 商品不存在或未上架
end

current_stock = tonumber(current_stock)

-- 检查库存是否充足
if current_stock >= decrement then
    -- 扣减库存
    local new_stock = redis.call('DECRBY', stock_key, decrement)
    return new_stock -- 返回扣减后的剩余库存（成功）
else
    return -2 -- 库存不足（超卖防护）
end
```

### FastAPI/Python 伪代码集成

```python
# app/services/inventory_service.py
import redis.asyncio as redis
from fastapi import HTTPException

# 初始化 Redis 客户端
redis_client = redis.from_url("redis://localhost:6379/0", decode_responses=True)

# 预加载 Lua 脚本
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

async def claim_item(user_id: str, product_id: str, quantity: int = 1):
    """
    处理抢单逻辑
    """
    stock_key = f"product:{product_id}:stock"

    try:
        # 执行 Lua 脚本，保证原子性
        result = await claim_script(keys=[stock_key], args=[quantity, user_id])

        if result == -1:
            raise HTTPException(status_code=404, detail="Product not found or not active for sale.")
        elif result == -2:
            raise HTTPException(status_code=400, detail="Out of stock. Better luck next time!")

        # 扣减成功，此时可以安全地通过消息队列（如 Redis Streams 或 RabbitMQ）
        # 异步落库到 PostgreSQL，生成 Order 和 OrderItem
        await enqueue_order_creation(user_id, product_id, quantity)

        return {"status": "success", "remaining_stock": result}

    except redis.RedisError as e:
        # 记录日志，系统级异常
        # logger.error(f"Redis error during claim: {e}")
        raise HTTPException(status_code=500, detail="Internal server error during claiming.")

async def enqueue_order_creation(user_id: str, product_id: str, quantity: int):
    # 异步写入数据库的逻辑，削峰填谷
    pass
```

## 3. AI Vision Implementation (AI 智能上架)

当团长上传一张包含几十个吧唧的阵型图时，我们需要调用多模态模型来自动识别并返回每个物品的坐标，以减轻团长的上架负担。
以下使用 FastAPI 处理图片上传并调用兼容 OpenAI API 的视觉模型（如 GPT-4V 或支持该协议的本地大模型部署）。

```python
# app/api/vision.py
import base64
from fastapi import APIRouter, UploadFile, File, HTTPException
import httpx
import os

router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your-api-key")
VISION_API_URL = os.getenv("VISION_API_URL", "https://api.openai.com/v1/chat/completions")

def encode_image(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")

@router.post("/analyze-image")
async def analyze_merch_image(file: UploadFile = File(...)):
    """
    接收团长上传的图片，调用大模型识别图内周边，返回坐标和分类估算。
    """
    # 1. 验证图片格式和大小
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024: # 10MB limit
        raise HTTPException(status_code=400, detail="Image size exceeds 10MB limit")

    base64_image = encode_image(image_bytes)

    # 2. 组装 Prompt
    # 强调返回 JSON 格式以及需要的字段
    prompt = (
        "你是一个二次元周边（吧唧、立牌等）识别助手。请分析这张图，"
        "识别图中所有的独立商品，并以严格的 JSON 数组格式返回。"
        "每个对象包含：\\n"
        "1. 'category' (字符串，如 '徽章', '立牌', '色纸')\\n"
        "2. 'bbox' (数组 [x, y, width, height]，代表相对图片的百分比坐标，0-100)\\n"
        "3. 'description' (简短描述人物特征或颜色)。\\n"
        "不要返回任何 JSON 以外的解释性文本。"
    )

    payload = {
        "model": "gpt-4-vision-preview", # 或配置为你使用的模型
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{file.content_type};base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
        "max_tokens": 1500,
        "temperature": 0.1 # 降低温度以保证格式化输出的稳定性
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }

    # 3. 调用多模态模型 API
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(VISION_API_URL, headers=headers, json=payload)
            response.raise_for_status()

            result_data = response.json()
            content = result_data["choices"][0]["message"]["content"]

            # 这里需要一个安全的 JSON 解析逻辑，剥离 markdown 代码块标签 (```json ... ```)
            # 为了 MVP 简化，我们假设模型完全遵循指令返回了纯净的 JSON 字符串
            import json

            # 清理可能的 markdown 标记
            clean_content = content.strip()
            if clean_content.startswith("```json"):
                clean_content = clean_content[7:]
            if clean_content.endswith("```"):
                clean_content = clean_content[:-3]

            items = json.loads(clean_content.strip())

            return {
                "status": "success",
                "items": items
            }

    except httpx.HTTPError as e:
        # logger.error(f"Vision API request failed: {e}")
        raise HTTPException(status_code=502, detail="Failed to communicate with Vision AI service.")
    except Exception as e:
        # logger.error(f"Failed to parse AI response: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response. Please try again.")
```
