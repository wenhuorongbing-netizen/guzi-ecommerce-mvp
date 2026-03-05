# Phase 2.5: Enterprise UI/UX & Stability Overhaul

**Document Owner**: Jules, AI Tech Lead
**Project**: 二次元周边（谷子）代购与对账中枢 (Guzi E-Commerce Enterprise)
**Status**: Phase 2.5 Enhancement

为解决复杂配置带来的管理灾难，以及生硬拦截带来的买家流失，本次升级聚焦于“可视化规则构建（Admin）”、“智能凑单引导（Buyer）”及“系统级高可用容灾（Stability）”。

---

## 1. 团长端：可视化规则构建器 (Visual Rule Builder)

复杂的 JSON 协议对团长极度不友好。我们需要在 `app/admin/events/[id]/rules/page.tsx` 实现一个类似“IF-THEN”自动化工具的积木式拖拽面板，使得配置强制捆绑逻辑像玩游戏一样简单直观。

### 1.1 Zustand 状态结构设计 (`useRuleBuilderStore`)

```typescript
// store/ruleBuilderStore.ts
export type RuleConditionOperator = '>=' | '==' | '<=';

export interface Condition {
  id: string;
  type: 'category' | 'specific_item' | 'tag';
  targetId: string; // e.g., 'category_cold', 'item_123'
  operator: RuleConditionOperator;
  value: number; // e.g., 2
}

export interface BundleRule {
  id: string;
  triggerItemId: string; // 触发该规则的热门商品 ID (IF)
  conditions: Condition[]; // 必须满足的条件列表 (THEN: AND 关系)
  description: string; // 自动生成的友好描述，如 "每购买1个热门吧唧，需带2个冷门挂件"
}

interface RuleBuilderState {
  rules: BundleRule[];
  activeRuleId: string | null;
  addRule: (triggerItemId: string) => void;
  addCondition: (ruleId: string, condition: Omit<Condition, 'id'>) => void;
  removeCondition: (ruleId: string, conditionId: string) => void;
  // ... selector for JSON serialization sent to backend `bundleRequirement`
}
```

### 1.2 UI 交互架构与伪代码 (IF-THEN 积木范式)

- **左侧区**：商品池（支持搜索、筛选热门/冷门 Tag）。
- **右侧区**：规则画布。
- **交互逻辑**：团长从左侧拖拽（或点击）一个热门商品到右侧，系统自动生成一条 `[当购买 {Item A} 时] -> [必须满足...]` 的空规则槽。团长继续点击 `+ 添加条件`，选择冷门区商品或 Category，并设置数量 `>= 1`。

```tsx
// 伪代码：RuleCard.tsx
const RuleCard = ({ rule }) => {
  return (
    <div className="border-l-4 border-blue-500 bg-white p-4 shadow-sm rounded-md mb-4 flex flex-col gap-3">
      {/* Trigger (IF) */}
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
        <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">IF</span>
        <span>Buyer adds</span>
        <Badge item={rule.triggerItem} className="ring-2 ring-blue-300" />
      </div>

      {/* Action/Condition (THEN) */}
      <div className="ml-8 pl-4 border-l-2 border-gray-200 flex flex-col gap-2">
        <span className="text-xs text-gray-500 font-bold tracking-wider">THEN REQUIRE (AND)</span>

        {rule.conditions.map(cond => (
          <div key={cond.id} className="flex items-center gap-2 bg-gray-50 p-2 rounded border border-gray-100 text-sm">
            <span>At least</span>
            <input type="number" min="1" value={cond.value} className="w-12 text-center border rounded" />
            <span>items from</span>
            <select value={cond.targetId} className="border rounded bg-white p-1">
              <option value="category_cold">Cold Items Zone</option>
              <option value="tag_any_stand">Any Acrylic Stand</option>
            </select>
            <button className="text-red-400 hover:text-red-600 ml-auto"><TrashIcon size={14}/></button>
          </div>
        ))}

        <button className="text-xs text-blue-500 hover:bg-blue-50 w-fit px-2 py-1 rounded border border-dashed border-blue-300 mt-1">
          + Add Condition
        </button>
      </div>
    </div>
  )
}
```

---

## 2. 买家端：智能购物车与动态进度条 (Smart Cart with Bundle Progress)

绝对不能在买家点击“结算”时抛出 HTTP 400。所有的拦截必须是**预防性、引导性**的前端校验。

### 2.1 实时校验选择器 (Selector in `useCartStore`)

```typescript
// store/cartStore.ts -> Selector 衍生状态
export const selectCartValidation = (state: CartState) => {
  const issues = [];
  let isCheckoutAllowed = true;

  // 1. 寻找购物车中带有 bundleRequirement 的触发商品
  const triggerItems = state.items.filter(item => item.bundleRequirement);

  for (const trigger of triggerItems) {
    // 假设 rules 解析为一个按分类计数的逻辑
    const requiredColdQty = trigger.bundleRequirement.qty * trigger.quantity; // 比如买2个热门，要带2个冷门
    const currentColdQty = state.items
      .filter(item => item.tags.includes(trigger.bundleRequirement.targetTag))
      .reduce((sum, item) => sum + item.quantity, 0);

    if (currentColdQty < requiredColdQty) {
      isCheckoutAllowed = false;
      const shortfall = requiredColdQty - currentColdQty;
      issues.push({
        triggerName: trigger.name,
        missingType: "冷门区商品",
        shortfall,
        progress: (currentColdQty / requiredColdQty) * 100
      });
    }
  }

  return { isCheckoutAllowed, issues };
};
```

### 2.2 购物车 UI 防呆设计与 Tailwind 样式反馈

- 购物车顶部悬浮提示区。当检测到 `issues.length > 0` 时，渲染警告面板。
- 结算按钮状态变更为 `disabled`，并变灰（搭配 cursor-not-allowed）。

```tsx
// 伪代码：CartSidebar.tsx
const { isCheckoutAllowed, issues } = useCartStore(selectCartValidation);

return (
  <div className="flex flex-col h-full bg-white/95 backdrop-blur-md shadow-2xl">
    {/* 动态防呆预警面板 */}
    {issues.length > 0 && (
      <div className="bg-amber-50 border-l-4 border-amber-500 p-3 mx-4 mt-4 rounded-r-md">
        <h4 className="text-amber-800 text-sm font-bold flex items-center gap-1">
          <AlertCircle size={16}/> 凑单未完成
        </h4>
        <div className="mt-2 space-y-2">
          {issues.map((issue, idx) => (
            <div key={idx}>
              <p className="text-xs text-amber-700">
                已选【{issue.triggerName}】，还需搭配 <span className="font-bold">{issue.shortfall}</span> 个{issue.missingType}
              </p>
              {/* 视觉反馈：微型进度条 */}
              <div className="w-full bg-amber-200 rounded-full h-1.5 mt-1 overflow-hidden">
                <div
                  className="bg-amber-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(issue.progress, 100)}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* ... Cart Items List ... */}

    {/* 底部结算按钮 */}
    <div className="p-4 border-t bg-gray-50/80">
      <button
        disabled={!isCheckoutAllowed}
        className={`w-full py-3 rounded-lg font-bold text-white transition-all shadow-md ${
          isCheckoutAllowed
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:scale-[1.02] active:scale-95'
            : 'bg-gray-400 cursor-not-allowed opacity-70'
        }`}
      >
        {isCheckoutAllowed ? '去结算 (Checkout)' : '请先完成凑单'}
      </button>
    </div>
  </div>
)
```

---

## 3. 企业级可用性与稳定性 (Stability & Fallbacks)

### 3.1 巨幅排阵图的加载优化 (Image Optimization)

二次元代购往往会发布长达几万像素的超长排阵图，直接加载会导致内存溢出或极长的白屏时间。

- **格式转换与压缩**：在团长上传图片时，后端/CDN（例如使用 Next.js `next/image` 或阿里云 OSS）自动将原图转码为高压缩比的 `WebP` 或 `AVIF` 格式。
- **渐进式加载 (Blur-up Placeholder)**：生成极低分辨率的 Base64 缩略图（Data URI），在页面加载瞬间优先展示模糊轮廓。
- **瓦片化切割 (Tiled Rendering) [未来展望]**：如果单图达到 20MB 以上，前端考虑引入类似地图引擎（如 Leaflet 或 OpenSeadragon）的技术，将巨图切割为小瓦片（Tiles）按需加载，而非使用原生的 `<img>` 标签硬抗。

### 3.2 多模态 AI 优雅降级 (AI Degradation Fallback)

外部大模型 API (Gemini/Qwen) 存在可用性风险（如触发限流、网络波动、或者遇到复杂反光图像导致完全瞎认）。我们必须设计一套坚固的**断路器与降级机制**。

**Fallback Workflow:**
1. **超时截断**：后端调用大模型 API 设置严格的 timeout（如 15 秒）。
2. **错误捕获与状态广播**：当发生 `TimeoutError` 或 JSON 解析异常时，FastAPI 捕获该异常，并返回带有特定错误码的响应：`{"status": "degraded", "message": "AI vision analysis failed or timed out."}`
3. **前端无缝切换模式**：
   - 团长上传图片并点击“一键解析”后，按钮显示 Loading。
   - 收到 `degraded` 响应后，前端立即弹出 Toast 提示：“AI 识别拥堵，已自动切换为手工模式”。
   - 将之前输入的 Reference Text 降级传给现有的“纯文本大模型解析器 (`/api/parser`)”。
   - 文本解析器快速生成不带坐标的 `PendingItem[]` 列表，放入侧边栏。
   - **闭环**：团长回到 MVP 阶段经典的 Text-to-Chips & Point-and-Click 工作流，手动将 Chip 拖拽到图片上。整个过程业务不断流。