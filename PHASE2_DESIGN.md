# Phase 2 Technical Design Document

**Document Owner**: Jules, AI Tech Lead
**Project**: 二次元周边（谷子）代购与对账中枢 (Guzi E-Commerce MVP)
**Status**: Phase 2 Planning

## 1. Database Schema Evolution
为了支持“跨图各一”、“多图阵列”以及“强制捆绑风控”，我们需要对原有的 `Product` 与 `Event` 关系进行维度升级。通过引入 `EventImage` 来管理多图场景，引入 `Character` 模型来支持“角色各一”，并在 `Product` 级别使用 JSON 字段支持高度动态的强制捆绑规则（如要求“冷热配比”）。

### Prisma Schema 重构建议

```prisma
// 新增：角色模型，支持“一键各一”
model Character {
  id        String    @id @default(uuid())
  name      String    // 角色名，例如 "Character_A"
  eventId   String
  event     Event     @relation(fields: [eventId], references: [id])
  products  Product[]
}

// 新增：活动阵列图模型，支持单个 Event 下的跨图
model EventImage {
  id        String    @id @default(uuid())
  eventId   String
  event     Event     @relation(fields: [eventId], references: [id])
  imageUrl  String
  name      String    // e.g., "吧唧区", "立牌区"
  products  Product[]
}

// 修改：Product 模型
model Product {
  id                String       @id @default(uuid())
  eventId           String
  event             Event        @relation(fields: [eventId], references: [id])

  // 关联到具体的排阵图
  eventImageId      String?
  eventImage        EventImage?  @relation(fields: [eventImageId], references: [id])

  // 关联角色
  characterId       String?
  character         Character?   @relation(fields: [characterId], references: [id])

  name              String
  price             Decimal      @db.Decimal(10, 2)
  stock             Int          @default(0)

  // 坐标体系保留，但依赖 eventImageId 所在的底图
  x                 Float?
  y                 Float?

  // 强制捆绑风控配置 (Strict Bundling Logic)
  // Example: { "type": "requires_any", "tags": ["cold_item"], "qty": 1 }
  // 存储复杂的捆绑协议，由前端购物车及后端统一解析
  bundleRequirement Json?

  orderItems        OrderItem[]
}
```

## 2. State Management Redesign
现有的 `store/productStore.ts` 设计仅面向“单图热区编辑（Admin）”，且状态强耦合了 `imageUrl` 和 `hotspots`。为了支撑多图切换及严格的跨图捆绑校验，我们需要进行“解耦与升维”重构。

### 重构思路：
1. **多图状态升维 (Multi-image Dictionary)**：
   将 `imageUrl` 和 `hotspots` 变更为支持多图映射的数据结构。例如 `images: Record<string, EventImage>` 以及 `hotspotsByImage: Record<string, Hotspot[]>`。添加 `activeImageId` 用于视图层切换。
2. **购物车状态解耦 (Cart Store Separation)**：
   将买家的加购行为提取到独立的 `useCartStore` 中。购物车状态应当是一个全局的 `CartItem[]` 数组。
3. **“各一”快捷键支持 (One-Click "All-in")**：
   在 `useCartStore` 中实现 `addAllForCharacter(characterId, allProducts)` 动作。该动作遍历整个 Event 的所有 `Product`（跨图），提取目标角色的商品并一键分发到购物车中。
4. **捆绑风控校验器 (Bundle Validator)**：
   引入一个衍生状态或 Selector 函数 `validateCart()`，每次购物车变动时触发。它会读取购物车中所有带 `bundleRequirement` 的热门商品，在全局 `CartItem[]` 里面进行匹配校验。如果不满足条件，将阻止结算按钮的高亮并抛出 UI 警告提示。

## 3. AI Pipeline Standard
Phase 2 将从纯手动打点（Human-in-the-loop）迁移至基于多模态大模型的自动化视觉管线。通过 Gemini 1.5 Flash 或 Qwen2.5-VL，我们将原始代购清单（群聊文本）和排阵图直接进行融合解析。

### 多模态 Prompt 范式设计

**[System Instruction]**
```text
You are a highly precise Anime Merchandise AI Vision Assistant designed to power a point-and-click e-commerce system.
Your task is to analyze the provided merchandise layout image alongside the reference group chat text.
Identify every merchandise item mentioned in the text that appears in the image.
You must output ONLY a valid JSON array without any markdown formatting, backticks, or preamble.

Strict Output JSON Schema:
[
  {
    "name": "<Item Name from text>",
    "type": "<Badge | Acrylic Stand | Plushie | Other>",
    "bounding_box": [ymin, xmin, ymax, xmax]
  }
]

Coordinate Rules:
- The bounding_box coordinates must be integers normalized from 0 to 1000.
- ymin: top edge, xmin: left edge, ymax: bottom edge, xmax: right edge.
```

**[Input Text]**
```text
Group Chat Reference: "排阵图更新：A款角色吧唧通贩，每个角色带1个立牌。另外角落里的B款随机挂件也可接。"
```
**[Input Image]**
*(Attached Layout Image Buffer)*

**处理管线 (FastAPI `vision.py`)**:
1. 调用 Gemini 1.5 Flash 接口，传入系统指令、文本和图片。
2. 接收 JSON 响应，解析 `bounding_box`。
3. 将 `[ymin, xmin, ymax, xmax]` 转换为前端 `ImageTagger` 所需的中心坐标百分比 `x = (xmin + xmax)/20`, `y = (ymin + ymax)/20`。
4. 将数据直接下发至前端的 `pendingItems` 及初始 `hotspots`，由团长进行最后一步确认（减轻团长的手动绘制负担）。

## 4. Sprint Planning

将 Phase 2 拆分为 3 个高度内聚的 Sprint 进行迭代交付：

### Sprint 1: Data Model & Multi-Image Foundation (Week 1)
**目标**: 完成底层数据结构和前后台多图框架的搭建。
- **Epic 1.1**: 更新 Prisma Schema，迁移现有数据，支持 `EventImage`, `Character`, 和 JSON 类型的 `bundleRequirement`。
- **Epic 1.2**: 重构前端 `store/productStore.ts` 状态机，支持 `hotspotsByImage` 的字典结构和 `activeImageId` 视图切换。
- **Epic 1.3**: Admin UI 升级，允许在同一个 Event 内上传多张排阵图，并在多图之间通过 Tab 切换打点。

### Sprint 2: The "All-in" Flow & Bundling Risk Control (Week 2)
**目标**: 实现买家侧核心的高级电商交互。
- **Epic 2.1**: 创建独立的 `useCartStore`，实现“一键各一（All-in）”跨图加购逻辑。
- **Epic 2.2**: 前端购物车实现强制捆绑校验器，当冷门商品不足时提示阻断。
- **Epic 2.3**: 后端 `create_order` API 升级，注入与前端一致的 `bundleRequirement` 校验拦截算法，确保接口级别的防绕过与安全性。

### Sprint 3: Multimodal AI Vision Integration (Week 3)
**目标**: 提升团长上架效率，完成 AI 视觉管线迁移。
- **Epic 3.1**: 开发 `app/api/vision.py` 核心节点，集成 Gemini 1.5 Flash 接口，封装 Multimodal Prompt。
- **Epic 3.2**: 开发坐标转换器，将大模型的千分位 Bounding Box 映射回 `x%`, `y%` 坐标系。
- **Epic 3.3**: 前端 Admin 端打点 UI 接入 AI 识别结果，由“手工画圈”过渡为“AI 预生成 + 人工快速微调”，达成效率翻倍。
