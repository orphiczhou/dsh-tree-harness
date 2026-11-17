# Tree Runs 关系图升级方案（A 已实施 / B·C 待评估）

> 状态：**A 已实施（session-tree v1.8.3，2026-11-17）**；**B、C 为候选升级方案，未实施，等后续评估**。
> 裁决来源：用户 2026-11-17——「先做A，把B和C记录为升级方案，待后续评估是否实施。」
> 适用范围：`packages/dsh-session-tree` 的 Tree Runs 面板详情区树图（`TreeGraph`）。**只影响展示层**，不改 `tree-state.json` 契约、不改 `/tree-panel` 投影字段、不改派发/验收语义。

## 0. 先厘清三套“关系”的语义（不能混为一谈）

| 体系 | 边的含义 | 有没有条件/数据 | 能不能成环 | 视觉语言 |
|---|---|---|---|---|
| tree `parent` | **组织从属**：谁派发了谁（严格树，每个叶至多一个父） | 无 | 否 | 实线（品牌色），父 → 子 |
| tree `dependencies` | **派发前置门**：目标叶必须等前置叶结算（`runtime.state` 成功/失败）后才能派发 | 无数据传递、无条件表达式、无 join 语义 | 引擎拦环，但跨层可“反向”指向 | 虚线，目标等前置 |
| flow 引擎的边 | **执行顺序/控制流**：A 完成后才执行 B，可带 `when` 条件；入边 ≥2 = `join(all)` | 数据走变量池 `{{nodes.y.outputs.z}}`，**不在边上** | DAG（无环） | 折线 + `bend` 扇出偏移 + join 入边序号；未选中虚线 7/5、选中实线 2.1 |

结论：tree 的 `parent` 与 `dependencies` 是两种不同语义，**不能合并成 flow 风格的一张 DAG**（合并会压平“谁派发谁”的层级）；但可以借鉴 flow 的**画法语言**（分层、扇出偏移、join 标记、选中提亮）。

## 1. A 方案（已实施，v1.8.3）

目标：不改变主视图（分层树），只解决「虚线被节点盒挡住、看不出关系」与「点亮后仍在盒子下面」。

实现要点：

1. **边分两层渲染**：`st-tr2-edges-back`（未点亮）位于节点盒之前，`st-tr2-edges-front`（点亮边 + 无法绕行的反向依赖）位于节点盒之后——点亮边永远压在最上层。
2. **依赖边障碍感知路由**（新增导出纯函数，测试可直断言）：
   - `depRoutePoints(fromRect, toRect, laneIndex)` → `{ mode: 'forward' | 'same' | 'backward', points }`；
   - forward：从源盒右缘出发，走**列间空道**的竖直 lane，再进入目标盒左缘；
   - same-column（wave2 的 D1 等前置都在同一列，是最常见场景）：绕到**该列右侧 lane**，再折回目标盒右缘；
   - backward（目标在更左列）：暂保留贝塞尔兜底，但**强制进前层**，不再被节点盒遮挡；
   - 同组平行边按 `laneIndex × 10px` 扇出，避免重叠。
3. **圆角弧**：`roundedPathOf(points, radius)` 在折点用二次贝塞尔画圆角（`DEP_ROUTE_RADIUS = 10`），即用户要的「弧形线」，同时保证路径不穿过任何节点盒。
4. **点亮语义不变**：选中节点的相关边（父边 + 依赖边）进前层并加 16% 同色 halo；无关边压到 0.12；`<title>`（`A is parent of B` / `B depends on A`）保留。
5. 边组 `pointerEvents: 'stroke'`，节点点击不被遮挡的边拦截；**不新增 hook**（纯计算，`GRAPH_HOOKS` 仍为 2）。

验证：panel-render 101 → **105/105**（新增 V2-44 分层顺序/ halo、V2-45 折线 + 圆角 + title、V2-46 反向依赖前层兜底、V2-47 `depRoutePoints`/`roundedPathOf` 正反例）；style-guard 51/51。

## 2. B 方案（待评估）：`Hierarchy | Dependency` 双视图

**做法**：详情区加视图切换（默认 Hierarchy 保持现状；Dependency 视图借用 flow 的 DAG 布局语言）。

- 依赖视图只把 `dependencies` 当边，按**最长路径分层**（与 flow `flowLayout` 同思路，client.js:1626-1661），同源/同目标边按 `bend = (i - (n-1)/2) * 14` 扇出；
- 入边 ≥2 的节点加 **join 标记**（小圆标 + 入边序号），提示“它在等 3 个前置”；
- 层级序号（level 1..n）画在列头，便于对读；
- Hierarchy 视图保持现有 parent 树 + 依赖虚线。

**成本**：约 1.5 天（布局复用 + 视图切换 + 测试与真机）。

**收益**：密集依赖（如 wave2 的 D1 等 3 个前置）在依赖视图里天然可读，不需要靠“点选才提亮”；同时保留从属视图，语义不丢。

**风险**：两套视图的“同一棵树”认知负担；视图状态需要持久化（记住用户选择）；布局算法要防环（`treeHierarchyOf` 已有 visited 保护，可复用）。

**触发条件**：出现“依赖密度高到主视图必须逐个点选才看得懂”的树（经验阈值：单树依赖边 ≥ 叶数，或单节点入度 ≥ 3 的树占多数）。

## 3. C 方案（待评估，倾向不推荐）：统一 flow 风格单图

**做法**：把 `parent` 也当边，整体按 DAG 布局（最长路径 + 扇出 + join），一个图里同时画从属与依赖，用线型区分。

**成本**：约 3 天（布局重写 + 交互回归 + 大量既有断言改口径 + 真机验证）。

**收益**：视觉上与 Flow Runs 完全一致，“一套图语言”。

**代价/风险**：
- `parent` 本质是树，转 DAG 后**层级被压平**（多层从属会退化成并列），损失“谁派发谁”的直观性；
- 现有面板断言（V2-6/V2-7/V2-9/V2-16..20 等按 parent 分层、边数、尺寸）大范围改口径，回归面最大；
- join 语义并不存在于 tree `dependencies`（无 join 概念），强行画 join 会误导。

**触发条件**：只有当用户明确要求“tree 与 flow 面板视觉完全同构”，且接受层级信息以其它形式（如缩进/面包屑）呈现时才考虑。

## 4. 决策与后续

- 2026-11-17：**先做 A**（已随 v1.8.3 交付）；B、C 记录在案，**不实施**。
- 复评触发：①用户提出新的可读性反馈；②树规模/依赖密度达到 §2 的触发条件；③flow 面板推出新的关系图语言且被用户认可。
- 无论选 B 还是 C，都保持：`tree-state.json` 契约不变、`/tree-panel` 投影字段不变、tree_verify/依赖闸语义不变。

## 5. 相关文件

- 客户端：`packages/dsh-session-tree/client.js`（`depRoutePoints` / `roundedPathOf` / `TreeGraph`）
- 测试：`packages/dsh-session-tree/test/panel-render.test.cjs`（V2-44..47）
- flow 侧参照（只读）：`D:\Codes\DSH动态流程引擎插件\spike\dsh-flow-plugin\client.js`（`flowLayout` :1626-1661、边绘制 :1727-1774）
