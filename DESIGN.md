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

  // 交互式打点热区信息
  imageUrl    String?  // 原图 URL
  x           Float?   // 热区中心相对 X 坐标 (0-100)
  y           Float?   // 热区中心相对 Y 坐标 (0-100)

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

## 3. Human-in-the-loop (HITL) 上架方案设计

鉴于多模态大模型在处理密集重叠的二次元徽章、立牌等周边时，容易出现严重的幻觉（漏识别、角色认错、类别搞错），导致团长需要花费大量时间纠错。我们决定放弃全自动 AI 识别，采用 Human-in-the-loop (HITL) 方案。

### 方案评估：Option 1 vs Option 2

* **Option 1: 交互式打点/切图 (Image Tagging UI)**
  * **原理**: 纯前端实现。用户上传大图后，在图片上点击创建热区（Hotspot），并手动输入商品信息。
  * **开发成本**: 极低。无需部署任何复杂的后端视觉算法环境，完全解耦。
  * **准确度**: 100%。完全由团长主观控制，不会有任何“误判”。
* **Option 2: 轻量级 CV 辅助裁剪 (OpenCV / YOLO Object Detection)**
  * **原理**: 后端跑 OpenCV 边缘检测或轻量级 YOLO，返回边界框给前端，前端切成卡片让用户填。
  * **开发成本**: 中高。需要处理复杂的背景干扰（例如吧唧托、背景布），且密集摆放时的轮廓粘连会导致 OpenCV 提取失败，仍需大量人工干预。

**结论推荐：采用 Option 1 (交互式打点 UI) 作为 MVP 方案。** 它不仅开发最快，架构最轻（直接移除了繁重的 CV/AI 服务部署），而且符合小红书等平台用户的使用直觉。

### 前端交互核心逻辑 (React + Zustand)

买家和团长将共享这一套基于热区坐标的视觉交互。

**1. 状态管理 (Zustand)**
负责管理当前图片上的所有打点信息。

```typescript
// store/taggingStore.ts
import { create } from 'zustand'

export interface Hotspot {
  id: string; // 唯一标识，前端可先用 uuid 生成
  x: number;  // 相对图片的百分比 X 坐标
  y: number;  // 相对图片的百分比 Y 坐标
  name: string;
  price: number;
  stock: number;
}

interface TaggingState {
  imageUrl: string | null;
  hotspots: Hotspot[];
  activeHotspotId: string | null; // 当前正在编辑的热区
  setImage: (url: string) => void;
  addHotspot: (hotspot: Hotspot) => void;
  updateHotspot: (id: string, updates: Partial<Hotspot>) => void;
  removeHotspot: (id: string) => void;
  setActiveHotspot: (id: string | null) => void;
}

export const useTaggingStore = create<TaggingState>((set) => ({
  imageUrl: null,
  hotspots: [],
  activeHotspotId: null,
  setImage: (url) => set({ imageUrl: url, hotspots: [], activeHotspotId: null }),
  addHotspot: (hotspot) => set((state) => ({
    hotspots: [...state.hotspots, hotspot],
    activeHotspotId: hotspot.id // 添加后默认选中
  })),
  updateHotspot: (id, updates) => set((state) => ({
    hotspots: state.hotspots.map(h => h.id === id ? { ...h, ...updates } : h)
  })),
  removeHotspot: (id) => set((state) => ({
    hotspots: state.hotspots.filter(h => h.id !== id),
    activeHotspotId: state.activeHotspotId === id ? null : state.activeHotspotId
  })),
  setActiveHotspot: (id) => set({ activeHotspotId: id })
}))
```

**2. 核心组件交互逻辑 (React)**
用户点击图片，计算相对坐标并新增热区。

```tsx
// components/ImageTagger.tsx
import React, { useRef } from 'react';
import { useTaggingStore } from '../store/taggingStore';
import { v4 as uuidv4 } from 'uuid';

export const ImageTagger = () => {
  const { imageUrl, hotspots, addHotspot, setActiveHotspot } = useTaggingStore();
  const imageRef = useRef<HTMLImageElement>(null);

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current) return;

    // 获取点击位置相对于图片的百分比坐标
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // 创建新的热区草稿
    addHotspot({
      id: uuidv4(),
      x,
      y,
      name: '',
      price: 0,
      stock: 1
    });
  };

  return (
    <div className="relative inline-block">
      {imageUrl && (
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Merch Layout"
          onClick={handleImageClick}
          className="max-w-full cursor-crosshair rounded shadow-lg"
        />
      )}

      {/* 渲染热区锚点 */}
      {hotspots.map((hotspot) => (
        <div
          key={hotspot.id}
          className="absolute w-6 h-6 -ml-3 -mt-3 bg-white border-2 border-red-500 rounded-full cursor-pointer hover:scale-110 transition-transform shadow-md"
          style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
          onClick={(e) => {
            e.stopPropagation(); // 阻止触发底图的点击事件
            setActiveHotspot(hotspot.id);
          }}
        >
          {/* 这里可以嵌套一个弹出式表单（Popover/Tooltip），
              如果 activeHotspotId === hotspot.id 则显示输入框 */}
        </div>
      ))}
    </div>
  );
};
```
