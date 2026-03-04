# 谷子代购对账系统 MVP 核心架构设计 (Hardened)

## 1. System Architecture Diagram & Tech Stack

为满足“高并发抢单”、“两段式账单对账”、“轻量安全鉴权”以及“严格库存防超卖”的业务需求，本系统采用前后端分离架构。

**核心技术栈推荐:**

* **前端**: Next.js (App Router), React, Zustand (状态管理), TailwindCSS.
* **后端**: Python (FastAPI), Pydantic (数据校验), PyJWT (轻量级会话维持).
* **数据库**: PostgreSQL (主存储，支持强事务隔离).
* **ORM**: Prisma Client Python.
* **缓存与并发控制**: Redis (存储高并发时的活动库存、TTL 软锁定队列).
* **异步任务/补偿机制**: Celery + Redis (或更轻量级的 APScheduler) 用于处理超时未支付的库存释放。

**Text-based Architecture Flow:**

```text
[ Buyer (Next.js UI) ] --(1. Login/Register: Nickname + PIN)--> [ Auth API (JWT) ]
       |
  (2. Click Hotspot to Claim)
       v
[ FastAPI: Inventory API ] --(Lua Script: Atomic Decr)--> [ Redis (Soft Lock: 2H TTL) ]
       |                                                       |
  (3. Create Order: AWAITING_PAYMENT)                          | (5. Timeout? Release Stock)
       v                                                       v
[ PostgreSQL (Prisma) ] <--(Async Compensation Cron)----[ Redis/Celery Task Queue ]
       |
  (4. Buyer Submits Xianyu Order ID)
       v
[ FastAPI: Order API ] --(Update Status to PENDING_AUDIT)--> [ Redis (Hard Lock) ]
       |
  (6. Admin Audits Actual Paid Amount)
       v
[ FastAPI: Admin API ] --(Compare Amount & Audit Payment)--> [ PostgreSQL (Update Status) ]
```

### TTL-based Inventory Locking (库存防跑单机制)

我们采用 **Soft Lock (软锁定)** 和 **Hard Lock (硬锁定)** 相结合的状态机设计：

1. 买家抢到后，Redis `DECR` 操作成功，生成 `AWAITING_PAYMENT` 的 `Order`，此时库存为 **“软锁定”**。
2. 同时向延迟队列（如 Celery 的 ETA task 或 RabbitMQ 延迟死信队列）发送一条消息：`expire_order(order_id)`，延迟时间设为 2 小时。
3. **情景 A (合规):** 买家在 2 小时内调用 `submit_external_order_id` 回填闲鱼单号。系统将订单转为 `PENDING_AUDIT`，此时这部分库存转为 **“硬锁定”**。
4. **情景 B (跑单):** 买家未能在 2 小时内回填。2 小时后，异步补偿任务 `expire_order` 触发。任务检查数据库该订单状态，若仍为 `AWAITING_PAYMENT`，则将其置为 `CANCELLED`，并通过 Redis `INCR` 把库存加回去。

## 2. Robust Database Schema (Prisma)

为应对“定金+尾款”两段式账单设计，并且加固鉴权机制，我们重构了核心 Schema：

```prisma
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Epic 1: Secure & Lightweight Auth
model User {
  id           String   @id @default(uuid())
  nickname     String   @unique
  hashedPin    String   // 存储 bcrypt Hash 后的 6位数字 PIN
  role         UserRole @default(BUYER)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  orders       Order[]
}

enum UserRole {
  BUYER
  ADMIN
}

// 场次/批次
model Event {
  id          String    @id @default(uuid())
  name        String
  status      EventStatus @default(DRAFT)
  startTime   DateTime?
  endTime     DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  products    Product[]
}

enum EventStatus {
  DRAFT
  PUBLISHED
  ACTIVE
  CLOSED
}

// 商品：包含热区坐标 (Human-in-the-loop)
model Product {
  id          String   @id @default(uuid())
  eventId     String
  event       Event    @relation(fields: [eventId], references: [id])
  name        String
  price       Decimal  @db.Decimal(10, 2)
  stock       Int      @default(0)

  imageUrl    String?
  x           Float?
  y           Float?

  orderItems  OrderItem[]
}

// Epic 4: Phased Billing - 解耦 Order 与 Payment
model Order {
  id               String      @id @default(uuid())
  userId           String
  user             User        @relation(fields: [userId], references: [id])

  // 订单级金额（商品总价，可能不含后续邮费）
  totalAmount      Decimal     @db.Decimal(10, 2)
  status           OrderStatus @default(CREATED)

  // 对账暗号：买家唯一识别码，填在闲鱼备注
  reconciliationCode String    @unique

  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  items            OrderItem[]
  payments         Payment[]
}

model OrderItem {
  id        String  @id @default(uuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id])
  productId String
  product   Product @relation(fields: [productId], references: [id])
  quantity  Int     @default(1)
  price     Decimal @db.Decimal(10, 2) // 快照价格
}

// 账单/支付单：支持多次支付（定金、尾款）
model Payment {
  id                String        @id @default(uuid())
  orderId           String
  order             Order         @relation(fields: [orderId], references: [id])
  paymentType       PaymentType   // 定金 DEPOSIT 还是 尾款 BALANCE

  expectedAmount    Decimal       @db.Decimal(10, 2) // 应付金额
  actualPaidAmount  Decimal?      @db.Decimal(10, 2) // 团长审核时填入的实际到账金额
  differenceAmount  Decimal?      @db.Decimal(10, 2) // 差异金额 (少付记录正数缺口)

  externalOrderId   String?       // 买家去闲鱼拍下后回填的订单号
  status            PaymentStatus @default(AWAITING_PAYMENT)

  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
}

enum PaymentType {
  DEPOSIT
  BALANCE_AND_SHIPPING
}

enum OrderStatus {
  CREATED               // 初始状态
  AWAITING_PAYMENT      // (软锁定) 等待提交付款单号
  PENDING_AUDIT         // (硬锁定) 单号已提交，等待团长审核
  PAYMENT_MISMATCH      // 审核异常：发现跑单或少付钱
  PAID_PARTIALLY        // 定金已付，尾款待付
  PAID_COMPLETELY       // 全部付清
  SHIPPED               // 已发货
  CANCELLED             // 2小时超时释放 或 手动取消
}

enum PaymentStatus {
  AWAITING_PAYMENT
  PENDING_AUDIT
  AUDIT_PASSED
  AUDIT_FAILED_MISMATCH
}
```

## 3. Core Logic Implementation (FastAPI)

以下展示如何在 FastAPI 中实现严谨的订单号回填与账单审核逻辑。

### 接口 1: 买家回填外部订单号 (Hard Locking)

买家回填单号后，将 `AWAITING_PAYMENT` (软锁定) 推进到 `PENDING_AUDIT` (硬锁定)。

```python
# app/api/buyer.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import prisma
from app.core.db import db # 假设 db 是初始化的 Prisma Client

router = APIRouter()

class SubmitOrderRequest(BaseModel):
    payment_id: str
    external_order_id: str

@router.post("/payments/submit-external-id")
async def submit_external_order_id(req: SubmitOrderRequest, current_user = Depends(get_current_user)):
    """
    买家在闲鱼拍下后，回填订单号。
    """
    async with db.tx() as tx:
        # 1. 查询支付单，并加上排他锁（通过 Prisma 行级锁特性或应用层隔离）
        payment = await tx.payment.find_first(
            where={
                "id": req.payment_id,
                "order": {"userId": current_user.id}
            },
            include={"order": True}
        )

        if not payment:
            raise HTTPException(status_code=404, detail="Payment record not found.")

        if payment.status != "AWAITING_PAYMENT":
            raise HTTPException(status_code=400, detail="Payment is not awaiting submission.")

        if payment.order.status == "CANCELLED":
             raise HTTPException(status_code=400, detail="Order has already been cancelled due to timeout.")

        # 2. 更新 Payment 状态和关联的 Order 状态 (转化为 Hard Lock)
        await tx.payment.update(
            where={"id": req.payment_id},
            data={
                "externalOrderId": req.external_order_id,
                "status": "PENDING_AUDIT"
            }
        )

        await tx.order.update(
            where={"id": payment.orderId},
            data={"status": "PENDING_AUDIT"}
        )

        # Note: 由于进入了 PENDING_AUDIT，2小时补偿任务在检查状态时会直接忽略此订单

    return {"message": "External order ID submitted successfully. Awaiting admin audit."}
```

### 接口 2: 团长极速审核 (Rapid Audit)

团长对比闲鱼账单金额。如果少付钱，进入 `PAYMENT_MISMATCH`；如果足额，则推进到通过状态。

```python
# app/api/admin.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from decimal import Decimal
from app.core.db import db

router = APIRouter()

class AuditPaymentRequest(BaseModel):
    actual_paid_amount: Decimal

@router.post("/admin/payments/{payment_id}/audit")
async def audit_payment(payment_id: str, req: AuditPaymentRequest, current_user = Depends(get_current_admin)):
    """
    团长审核界面核心 API：核销金额。
    """
    async with db.tx() as tx:
        payment = await tx.payment.find_unique(where={"id": payment_id}, include={"order": True})

        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        if payment.status != "PENDING_AUDIT":
            raise HTTPException(status_code=400, detail="Payment is not in PENDING_AUDIT status")

        expected = Decimal(payment.expectedAmount)
        actual = Decimal(req.actual_paid_amount)
        difference = expected - actual

        if actual < expected:
            # 买家少付款 (跑单/错填)
            await tx.payment.update(
                where={"id": payment_id},
                data={
                    "status": "AUDIT_FAILED_MISMATCH",
                    "actualPaidAmount": actual,
                    "differenceAmount": difference
                }
            )
            await tx.order.update(
                where={"id": payment.orderId},
                data={"status": "PAYMENT_MISMATCH"}
            )
            return {"status": "mismatch", "message": f"Shortfall detected: {difference}"}

        else:
            # 全额或超额付款
            await tx.payment.update(
                where={"id": payment_id},
                data={
                    "status": "AUDIT_PASSED",
                    "actualPaidAmount": actual,
                    "differenceAmount": difference # 如果是负数代表多付了
                }
            )

            # 判断这是定金还是尾款，决定 Order 的最终状态
            new_order_status = "PAID_PARTIALLY" if payment.paymentType == "DEPOSIT" else "PAID_COMPLETELY"

            await tx.order.update(
                where={"id": payment.orderId},
                data={"status": new_order_status}
            )
            return {"status": "passed", "message": "Audit passed successfully."}
```

### 补偿机制: 2小时超时释放 (Compensation Mechanism)

这里展示使用轻量级 `APScheduler` (或 Celery) 执行异步任务的思想：

```python
# app/workers/inventory_worker.py
import asyncio
import logging
from app.core.db import db
from app.services.inventory_service import redis_client

logger = logging.getLogger(__name__)

async def expire_unpaid_order(order_id: str, payment_id: str):
    """
    延迟任务：2小时后触发。检查订单是否未回填闲鱼单号，若是，则释放库存。
    """
    try:
        async with db.tx() as tx:
            payment = await tx.payment.find_unique(where={"id": payment_id}, include={"order": {"include": {"items": True}}})

            if not payment:
                return

            # 只有当状态依然是 AWAITING_PAYMENT (买家没回填单号) 时才触发释放
            if payment.status == "AWAITING_PAYMENT":
                logger.warning(f"Order {order_id} timed out. Cancelling and releasing stock.")

                # 1. 数据库状态更新
                await tx.payment.update(where={"id": payment_id}, data={"status": "CANCELLED"})
                await tx.order.update(where={"id": order_id}, data={"status": "CANCELLED"})

                # 2. Redis 软锁定释放 (通过 INCR 把库存加回)
                # 这部分需要严谨处理，使用 Redis Pipeline 保证原子性
                pipeline = redis_client.pipeline()
                for item in payment.order.items:
                    stock_key = f"product:{item.productId}:stock"
                    # 将软锁定的商品数量加回去
                    pipeline.incrby(stock_key, item.quantity)

                await pipeline.execute()
                logger.info(f"Successfully released stock for Order {order_id}")

    except Exception as e:
        logger.error(f"Failed to process expiry for order {order_id}: {str(e)}")
        # 生产环境中应该有告警系统
```

## 4. Human-in-the-loop (HITL) 上架方案设计

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
