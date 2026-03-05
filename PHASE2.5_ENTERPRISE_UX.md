# Phase 2.5: Enterprise UI/UX & Stability Overhaul

**Document Owner**: Jules, AI Tech Lead
**Project**: 二次元周边（谷子）代购与对账中枢 (Guzi E-Commerce Enterprise)
**Status**: Phase 2.5 Enhancement

为解决复杂配置带来的管理灾难，以及生硬拦截带来的买家流失，本次升级聚焦于“可视化规则构建（Admin）”、“智能凑单引导（Buyer）”及“系统级高可用容灾（Stability）”。本次设计在兼顾功能性的同时，深度优化了**代码可拓展性 (Extensibility)**、**代码可读性 (Readability)** 和 **无障碍访问性 (A11y/Accessibility)**。

---

## 1. 团长端：可视化规则构建器 (Visual Rule Builder)

复杂的 JSON 协议对团长极度不友好。我们需要在 `app/admin/events/[id]/rules/page.tsx` 实现一个类似“IF-THEN”自动化工具的积木式拖拽面板，使得配置强制捆绑逻辑像玩游戏一样简单直观。

### 1.1 Zustand 状态结构设计 (`useRuleBuilderStore`)

设计目标：解耦规则树结构，使得未来可以轻松扩展更多维度的风控动作（如：限制单个 IP 购买数量）。

```typescript
// store/ruleBuilderStore.ts
import { create } from 'zustand';

export type RuleConditionOperator = '>=' | '==' | '<=';

export interface RuleCondition {
  id: string;
  type: 'category' | 'specific_item' | 'tag';
  targetId: string; // 例如: 'category_cold', 'item_123'
  operator: RuleConditionOperator;
  value: number; // 要求的基准数量，例如: 2
}

export interface BundleRule {
  id: string;
  triggerItemId: string; // 触发该规则的热门商品 ID (IF)
  conditions: RuleCondition[]; // 必须满足的条件列表 (THEN: 默认 AND 逻辑聚合)
  description: string; // 自动生成的友好描述，如 "购买 1 个本商品，需带 2 个冷门挂件"
}

interface RuleBuilderState {
  rules: BundleRule[];
  activeRuleId: string | null;

  // Actions
  addRule: (triggerItemId: string) => void;
  updateRuleDescription: (ruleId: string, desc: string) => void;
  removeRule: (ruleId: string) => void;

  addCondition: (ruleId: string, condition: Omit<RuleCondition, 'id'>) => void;
  updateCondition: (ruleId: string, conditionId: string, updates: Partial<RuleCondition>) => void;
  removeCondition: (ruleId: string, conditionId: string) => void;

  // Selector: 将结构化 State 序列化为后端 Prisma schema 可接受的 JSON 字符串
  serializeRulesForBackend: () => string;
}

export const useRuleBuilderStore = create<RuleBuilderState>((set, get) => ({
  rules: [],
  activeRuleId: null,

  addRule: (triggerItemId) => set((state) => ({
    rules: [
      ...state.rules,
      {
        id: crypto.randomUUID(),
        triggerItemId,
        conditions: [],
        description: 'New Bundle Rule'
      }
    ]
  })),

  updateRuleDescription: (ruleId, desc) => set((state) => ({
    rules: state.rules.map(rule => rule.id === ruleId ? { ...rule, description: desc } : rule)
  })),

  removeRule: (ruleId) => set((state) => ({
    rules: state.rules.filter(rule => rule.id !== ruleId)
  })),

  addCondition: (ruleId, condition) => set((state) => ({
    rules: state.rules.map(rule => {
      if (rule.id === ruleId) {
        return {
          ...rule,
          conditions: [...rule.conditions, { ...condition, id: crypto.randomUUID() }]
        };
      }
      return rule;
    })
  })),

  updateCondition: (ruleId, conditionId, updates) => set((state) => ({
    rules: state.rules.map(rule => {
      if (rule.id === ruleId) {
        return {
          ...rule,
          conditions: rule.conditions.map(c => c.id === conditionId ? { ...c, ...updates } : c)
        };
      }
      return rule;
    })
  })),

  removeCondition: (ruleId, conditionId) => set((state) => ({
    rules: state.rules.map(rule => {
      if (rule.id === ruleId) {
        return { ...rule, conditions: rule.conditions.filter(c => c.id !== conditionId) };
      }
      return rule;
    })
  })),

  serializeRulesForBackend: () => {
    return JSON.stringify(get().rules);
  }
}));
```

### 1.2 UI 交互架构与无障碍 (A11y) 伪代码 (IF-THEN 积木范式)

- **语义化 HTML**: 使用 `<fieldset>`, `<legend>`, 增强屏幕阅读器兼容性。
- **键盘导航**: 确保所有按钮和输入框均可被 `Tab` 键聚焦（`focus:ring`）。

```tsx
// 伪代码：components/admin/RuleCard.tsx
import React from 'react';
import { BundleRule } from '../../store/ruleBuilderStore';
import { TrashIcon, PlusCircleIcon } from 'lucide-react';

interface RuleCardProps {
  rule: BundleRule;
  onRemoveRule: (id: string) => void;
  onAddCondition: (id: string) => void;
  onRemoveCondition: (ruleId: string, conditionId: string) => void;
}

export const RuleCard: React.FC<RuleCardProps> = ({ rule, onRemoveRule, onAddCondition, onRemoveCondition }) => {
  return (
    <article
      className="border-l-4 border-blue-600 bg-white p-5 shadow-sm rounded-lg mb-6 flex flex-col gap-4 focus-within:ring-2 focus-within:ring-blue-200 transition-all"
      aria-labelledby={`rule-title-${rule.id}`}
    >
      {/* 头部：规则摘要与删除操作 */}
      <header className="flex justify-between items-center">
        <h3 id={`rule-title-${rule.id}`} className="text-sm font-bold text-gray-800">
          Bundle Rule <span className="text-gray-400 font-normal">#{rule.id.slice(-4)}</span>
        </h3>
        <button
          onClick={() => onRemoveRule(rule.id)}
          aria-label="Delete entire bundle rule"
          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <TrashIcon size={18} aria-hidden="true" />
        </button>
      </header>

      {/* Trigger (IF) */}
      <section className="flex items-center gap-3 text-sm text-gray-700 bg-gray-50 p-3 rounded border border-gray-100">
        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold text-xs uppercase tracking-wide">IF</span>
        <span>Buyer adds</span>
        {/* 这里可以抽象出一个更独立的被选中商品展示组件 */}
        <div className="font-semibold px-2 py-1 bg-white border rounded shadow-sm">
          Product ID: {rule.triggerItemId}
        </div>
      </section>

      {/* Action/Condition (THEN) */}
      <fieldset className="ml-6 pl-5 border-l-2 border-dashed border-gray-300 flex flex-col gap-3">
        <legend className="sr-only">Conditions required for this item</legend>
        <span className="text-xs text-gray-500 font-bold tracking-widest uppercase" aria-hidden="true">THEN REQUIRE (AND)</span>

        {rule.conditions.map(cond => (
          <div
            key={cond.id}
            className="flex flex-wrap items-center gap-2 bg-gray-50/80 p-3 rounded-md border border-gray-200 text-sm focus-within:border-blue-300"
          >
            <label htmlFor={`cond-val-${cond.id}`} className="sr-only">Quantity required</label>
            <span className="text-gray-600">At least</span>
            <input
              id={`cond-val-${cond.id}`}
              type="number"
              min="1"
              defaultValue={cond.value}
              aria-label="Required item quantity"
              className="w-16 text-center border-gray-300 rounded shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />

            <label htmlFor={`cond-target-${cond.id}`} className="sr-only">Target category or item</label>
            <span className="text-gray-600">items from</span>
            <select
              id={`cond-target-${cond.id}`}
              defaultValue={cond.targetId}
              className="border-gray-300 rounded shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm bg-white py-1.5"
            >
              <option value="category_cold">Cold Items Zone (冷门区)</option>
              <option value="tag_any_stand">Any Acrylic Stand (任意立牌)</option>
            </select>

            <button
              onClick={() => onRemoveCondition(rule.id, cond.id)}
              aria-label="Remove this condition"
              className="ml-auto text-gray-400 hover:text-red-500 p-1.5 rounded-full hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
            >
              <TrashIcon size={16} aria-hidden="true" />
            </button>
          </div>
        ))}

        <button
          onClick={() => onAddCondition(rule.id)}
          className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 w-fit px-3 py-1.5 rounded-md border border-transparent hover:border-blue-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 mt-1"
        >
          <PlusCircleIcon size={16} aria-hidden="true" />
          <span>Add Condition</span>
        </button>
      </fieldset>
    </article>
  );
}
```

---

## 2. 买家端：智能购物车与动态进度条 (Smart Cart with Bundle Progress)

绝对不能在买家点击“结算”时抛出后端 HTTP 400。所有的拦截必须是**预防性、引导性**的前端校验，提供极佳的购物反馈（A11y ARIA Live Region）。

### 2.1 实时校验选择器 (Selector in `useCartStore`)

我们利用 Selector 模式将购物车列表转化为校验结果，保持核心 Store 纯净。

```typescript
// store/cartSelectors.ts
import { CartState } from './cartStore';

export interface CartIssue {
  triggerName: string;
  missingType: string;
  requiredQty: number;
  currentQty: number;
  shortfall: number;
  progressPercentage: number;
}

export interface ValidationResult {
  isCheckoutAllowed: boolean;
  issues: CartIssue[];
}

export const selectCartValidation = (state: CartState): ValidationResult => {
  const issues: CartIssue[] = [];
  let isCheckoutAllowed = true;

  // 1. 寻找购物车中带有强制捆绑协议 (bundleRequirement) 的触发商品
  const triggerItems = state.items.filter(item => item.bundleRequirement);

  for (const trigger of triggerItems) {
    // 假设后端传递的 JSON 已被解析为特定的强类型对象
    const req = trigger.bundleRequirement;

    // 计算要求的冷门数量 (购买数量 * 单品所需绑定数量)
    const requiredTargetQty = req.qty * trigger.quantity;

    // 动态聚合购物车中满足条件的商品数量
    const currentTargetQty = state.items
      .filter(item => item.tags && item.tags.includes(req.targetTag))
      .reduce((sum, item) => sum + item.quantity, 0);

    if (currentTargetQty < requiredTargetQty) {
      isCheckoutAllowed = false;
      const shortfall = requiredTargetQty - currentTargetQty;

      issues.push({
        triggerName: trigger.name,
        missingType: req.targetDescription || '指定类别商品', // e.g., "冷门区商品"
        requiredQty: requiredTargetQty,
        currentQty: currentTargetQty,
        shortfall,
        progressPercentage: Math.min((currentTargetQty / requiredTargetQty) * 100, 100)
      });
    }
  }

  return { isCheckoutAllowed, issues };
};
```

### 2.2 购物车 UI 防呆设计与 A11y 反馈

- **动态防呆预警面板**：当检测到 `issues.length > 0` 时渲染，并使用 `role="alert"`。
- **进度条语义化**：使用 `progressbar` 角色，为读屏器提供明确进度指示。
- **结算按钮**：使用 `aria-disabled` 代替原生的 `disabled`，使得焦点依然可以落在按钮上，便于向辅助技术解释为何无法点击。

```tsx
// 伪代码：components/buyer/CartSidebar.tsx
import React from 'react';
import { useCartStore } from '../../store/cartStore';
import { selectCartValidation } from '../../store/cartSelectors';
import { AlertCircleIcon, ShoppingBagIcon } from 'lucide-react';

export const CartSidebar: React.FC = () => {
  const { isCheckoutAllowed, issues } = useCartStore(selectCartValidation);
  // ... 其他购物车状态 (cartItems, total, etc.)

  return (
    <aside
      className="flex flex-col h-full bg-white/95 backdrop-blur-xl shadow-2xl border-l border-gray-100"
      aria-label="Shopping Cart"
    >
      <header className="px-6 py-4 border-b flex justify-between items-center bg-gray-50/50">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <ShoppingBagIcon size={20} aria-hidden="true" />
          Your Cart
        </h2>
      </header>

      {/* 动态防呆预警面板 (ARIA Live Region) */}
      <div aria-live="polite" className="px-4 pt-4">
        {issues.length > 0 && (
          <section
            role="alert"
            className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-sm"
          >
            <h4 className="text-amber-900 text-sm font-bold flex items-center gap-2 mb-3">
              <AlertCircleIcon size={18} aria-hidden="true" />
              <span>捆绑条件未满足 (Bundling Required)</span>
            </h4>

            <ul className="space-y-4">
              {issues.map((issue, idx) => (
                <li key={idx} className="flex flex-col gap-1.5">
                  <p className="text-xs text-amber-800 leading-relaxed">
                    由于您选择了 <span className="font-semibold bg-amber-100 px-1 rounded">[{issue.triggerName}]</span>，
                    还需搭配 <span className="font-bold text-amber-600 text-sm">{issue.shortfall}</span> 个 {issue.missingType}。
                  </p>

                  {/* 视觉反馈：进度条 (A11y Compliant) */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-full bg-amber-200/60 rounded-full h-2 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={issue.progressPercentage}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="bg-amber-500 h-2 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${issue.progressPercentage}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-amber-600 font-bold w-12 text-right tracking-tighter">
                      {issue.currentQty} / {issue.requiredQty}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ... Cart Items List ... */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
         {/* Cart Item Cards Go Here */}
      </div>

      {/* 底部结算悬浮栏 */}
      <footer className="p-5 border-t bg-white/90 backdrop-blur-md sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button
          onClick={() => {
            if (isCheckoutAllowed) {
              // 发起后端 /create_order 请求
            }
          }}
          aria-disabled={!isCheckoutAllowed}
          title={isCheckoutAllowed ? "Proceed to Checkout" : "Please resolve cart issues first"}
          className={`
            w-full py-3.5 rounded-xl font-bold text-white text-base transition-all duration-200 shadow-md flex justify-center items-center gap-2 focus:outline-none focus:ring-4 focus:ring-blue-300
            ${isCheckoutAllowed
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-200 shadow-none'
            }
          `}
        >
          {isCheckoutAllowed ? '去结算 (Checkout)' : '请先完成凑单'}
        </button>
      </footer>
    </aside>
  );
};
```

---

## 3. 企业级可用性与稳定性 (Stability & Fallbacks)

### 3.1 巨幅排阵图的加载优化 (Image Optimization)

二次元代购往往会发布长达几万像素的超长排阵图，直接加载会导致设备浏览器崩溃（OOM）或极长的白屏时间。

- **构建时预处理格式转换**：在团长上传图片时，API 自动利用 Python `Pillow` 或云存储服务（OSS）将原图无损转码为高压缩比的 `WebP` 格式，大幅减少网络传输体积。
- **渐进式加载 (Blur-up Placeholder)**：使用 `next/image` 组件，生成极低分辨率的 Base64 缩略图（Data URI），在页面加载瞬间优先展示模糊轮廓，减轻用户的等待焦虑。
- **瓦片化切割 (Tiled Rendering) [架构级扩展]**：对于大于 20MB 且长宽比超过 1:10 的极端“清明上河图”，前端引入基于 Canvas 的地图引擎技术（如 OpenSeadragon）。将巨图切割为小瓦片（Tiles），随着用户的平移/缩放按需加载可视区域，彻底解决内存爆炸问题。

### 3.2 多模态 AI 优雅降级 (AI Graceful Degradation)

外部大模型 API (Gemini/Qwen) 依赖第三方公网，存在不可预测的可用性风险（如触发速率限制、网络波动、或者模型出现严重的“幻觉”拒绝服务）。我们必须设计一套坚固的**断路器与降级机制**。

**Fallback Workflow (容灾状态机):**
1. **严格的短路超时 (Circuit Breaker Timeout)**：后端 `vision.py` 调用大模型 API 时，必须设置严格的 `timeout`（如 15 秒）。避免 HTTP 连接长时间挂起耗尽 FastAPI 工作线程池。
2. **错误捕获与状态广播**：当捕获到 `httpx.TimeoutException` 或 JSON Schema 结构性解析异常时，不应返回 `HTTP 500`，而是返回 `HTTP 206 Partial Content` 或附带特定元数据的 `200 OK`：
   `{"status": "degraded", "message": "AI vision API timed out.", "fallback_required": true}`
3. **前端无缝切换模式 (Seamless UX Transition)**：
   - 团长点击“一键解析 (Auto Tag)”，按钮进入 Loading 态。
   - 收到 `degraded` 响应后，前端立即触发全局 Toast 提示：“⚠️ AI 视觉通道拥堵，已自动为您切换至基础文本解析模式”。
   - 前端自动提取团长刚刚输入的 Reference Text，**静默回退**请求至 MVP 阶段经典的纯文本解析器 `/api/parser`（该接口响应极快）。
   - 文本解析器快速生成不带坐标信息的 `PendingItem[]` 列表，放入侧边栏。
   - **闭环**：团长回到 MVP 阶段经典的 "Text-to-Chips" 工作流，手动将 Chip 拖拽到图上。整个过程业务不会阻断断流，确保发车效率。