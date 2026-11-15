# DESIGN-tree-panel-v2 — Tree Runs 面板 v2 设计（实现指引级）

> **交付物**：leaf `t29p-W2-design`（设计师）。唯一产物 = 本文件。
> **上游**：`docs/operations/panel-v2/SPEC-flow-parity.md`（W1 逆向规格，下文简称 **SPEC**；`SPEC :N` 均指该文件行号）。
> **下游**：W3 照本文件实现，不改设计；设计偏离需走 commander 裁决。
> **本仓行号基准**：`client.js :N` 指 `packages/dsh-session-tree/client.js`（3258 行版）；`panel-view.js :N` 指 `packages/dsh-tree-engine/src/panel-view.js`。
> **标注约定**：**[P0]/[P1]/[N-A]** 沿用 SPEC §5 checklist 编号（如「#11 [P0]」）；每条视觉值带 SPEC 行号回引。
> **纪律**：本设计不改代码、不 git/npm；席位注册与轮询 controller 不在改动面（§1.3 显式清单）。

---

## §1 组件树 v2

### 1.1 v2 组件清单与替换关系

v2 结构总图（`h()` hyperscript，与现仓同款零构建写法）：

```
PanelShell（原 TreeRunsPanel 改名重构；导出 seam 名仍为 Body）
├── PanelHeader                         [新提炼] 页头（标题/存储根/更新时刻/计数/刷新）
├── PanelBody（容器，flex row 分栏）     [新] st-tr2-body
│   ├── PanelList（左列表列，自滚）      [新提炼] st-tr2-list
│   │   ├── 三态 note（loading/error/empty，st-tr-note / st-tr2-empty）
│   │   └── PanelTreeCard ×N            [保留名·结构改造] 双行卡片 + data-selected
│   └── PanelDetail（右详情区，自滚）    [新提炼] st-tr2-detail
│       ├── 详情空态（未选中/加载/错误，st-tr2-empty / st-tr-note）
│       ├── PanelFieldGrid              [新提炼] 字段栅格 st-tr2-fieldgrid + PanelField（复用）
│       ├── TreeGraph                   [新增] 树图（§3 全参）——外面包一层 Boundary
│       ├── PanelLeafTable              [新提炼] 表头行 + PanelLeafRow ×N（PanelLeafRow 保留）
│       │   └── SessionCell（行内 8 列，无 hook 实现）[新增]
│       └── PanelEventTail              [新提炼] 事件尾 st-tr-events（结构保留，加 #seq）
├── PanelOverlay                        [保留不动] 渲染同一 PanelShell，自动获得 v2 布局
├── PanelEntry                          [保留] pill（仅 CSS 逐值重整，见 §4.4）
└── PanelTabTitle                       [保留不动]
```

### 1.2 逐组件替换关系明细

| 旧组件（client.js 锚点） | v2 处置 | 说明 |
|---|---|---|
| `TreeRunsPanel`（:1302-1443） | **改名 `PanelShell` 并重构** | 现为「列表↔详情」切换式单栏（selected 早分支二选一，:1337/:1442）；v2 改为**左右分栏同屏**（SPEC §2.1 结论）：单次渲染同时产出左列 + 右区，选中只刷新右区内容、列表常驻。原 topBar 内联块（:1319-1334）提炼为 `PanelHeader`；列表分支（:1422-1441）提炼为 `PanelList`；详情分支（:1337-1403）提炼为 `PanelDetail`。**`← Back` 按钮删除**（:1410-1414）——分栏同屏无返回概念（SPEC §4.2）。store 的 `selectedTreeId` 语义不变（常驻选中，不自动取消）。 |
| `PanelTreeCard`（:1203-1250） | **保留名，结构改造** | 改为 SPEC §3.1 的双行结构：行1 = treeId(mono 600) + **四态状态 Badge**（新增，见 §2.5 `treeStatusOf` 派生）；行2 = `leafCount · counts 圆点 · updatedAt` meta 行（现 dots 组从行1 移入行2）。`rootGoalPreview` 从第三行改为卡片 `title` 属性携带（hover 可见，双行结构不被破坏）。新增 `data-selected` 属性承载选中态（§2.6）。 |
| `PanelLeafRow`（:1253-1279） | **保留不动** | 7 列 grid 行（id/badge/relay/task/ctx/verif/deps）原样保留（现有断言全部依赖此结构）。v2 仅**追加第 8 列** SessionCell（§3 无关，见 §6.1 V2-8；不改动前 7 列顺序）。 |
| `PanelBadge`（:1197-1200） | **保留不动** | 四态 tone 映射 `panelToneOf` 原样（v1 扩展见 §5.5）。 |
| `PanelField`（:1282-1293） | **保留**，容器换新 | Field 对保留；外层栅格从 `.st-tr-grid`（auto/minmax 双列）换为 SPEC #10 的 `st-tr2-fieldgrid`（repeat(auto-fill, minmax(260px,1fr))，SPEC :1235-1239）。 |
| `PanelOverlay`（:1446-1483） | **保留不动** | markup/CSS（st-tr-overlay*）原样；其子面板换成 PanelShell 后自动分栏。Escape 监听逻辑不动。 |
| `PanelEntry`（:1490-1506） | **保留**，仅样式逐值重整 | 类名不变 `st-tr-pill`；26px 胶囊规格落地见 §4.4（#1 [P0]）。 |
| `PanelTabTitle`（:1509-1511） | 保留不动 | — |
| `createPanelRuntime`（:1519-1563） | 微改 | `Body: wrap('sidebar-body', TreeRunsPanel)` 换成 PanelShell；新增导出纯函数 seam（§5.6）。席位注册路径不动。 |

**新增组件**：`PanelHeader`、`PanelList`、`PanelDetail`、`PanelFieldGrid`、`PanelLeafTable`、`PanelEventTail`、`TreeGraph`（内含工具栏/图例，不再拆子组件，保持与 flow FlowGraph 单组件形态一致 SPEC :1670-1968）、`SessionCell`。

**删除**：`← Back` 按钮 UI（controller.back() 方法本身保留，见 §1.3）；CSS 类 `.st-tr-scroll`（被 st-tr2-list/st-tr2-detail 取代）、`.st-tr-grid/.st-tr-flabel/.st-tr-fvalue`（被 st-tr2-field* 取代）。

### 1.3 与席位 / controller / store 的边界（不动清单，W3 不得触碰）

| 不动部分 | client.js 锚点 | 不变式 |
|---|---|---|
| 席位注册 `registerPanelSeats` | :1571-1664 | 5 席位（降级）/6 席位（右栏）清单、order、key、id 全部原样（panel-render ⑦ 与 style-guard A8=10 依赖） |
| apply 接线 | :3229-3235 | `registerPanelSeats(ctx)` 调用点与 try/catch 不动 |
| 轮询 `createPanelController` | :979-1184 | `POLL_MS=1500`（:834）、列表每 tick、detail+events 每 2 tick（:1115）、`select()` 清空+并行拉取（:1129-1142）、`start/stop`+AbortController 全量取消（:985-1020,:1156-1174）。**`back()` 方法保留**（API 兼容），v2 UI 不再引用 |
| panel store 字段集 | :1520-1534 | 13 个字段一个不加一个不减（zoom/pan 等视图态**不进 store**，见 §5.1） |
| `usePanelStore` | :1187-1194 | useSyncExternalStore 优先 + useState/useEffect fallback 双路径不动 |
| 定时器卫生 | :912-940 | `panelResetGlobalTimers` / `panelTrackTimer` / `window.__stTreePanelTimers` 不动 |
| 样式表挂载与自愈 | :187-249 | 单张 `style[data-plugin-css="session-tree"]` + `ensureStylesheet` + `guardStylesheet` 双 MutationObserver 不动；v2 CSS 只是**追加进 `CSS` 模板常量**（:53-172） |
| ErrorBoundary 席位包裹 | :1552 `wrap()` | 每席位一层 Boundary 不动；TreeGraph 额外内层包一层 Boundary（#27 [P0] 精神：SVG 数学是最易崩的新代码，崩溃渲染 `st-tr-note[data-kind=error]`『Graph unavailable』，不拖垮详情区其余部分） |
| 侧栏树本体 / DICT / SessionMeta | 全文其余部分 | buildRows/TreeView/DICT/metaOf 等与面板无关，一律不动 |
| `PANEL_*` 常量 | :833-842 | ROUTE/POLL_MS/TREE_LIMIT(50)/EVENT_FETCH_LIMIT(100)/EVENT_TAIL(50)/TIMERS_KEY/TAB_ID/TAB_KIND 全部原值 |

---

## §2 区域布局规格（对齐 SPEC §2）

### 2.1 壳层纵向骨架 [#4 P0]

`PanelShell` 根 = 现 `.st-tr-root`（flex column / height 100% / font-size 12px，client.js :127）不变，从上到下：

| 段 | 类 | 关键值 | 回引 |
|---|---|---|---|
| 页头 | `st-tr2-top` | `display:flex;align-items:center;gap:8px;padding:8px 10px;flex:0 0 auto;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)` | SPEC :858-867（pageHeader） |
| 主体分栏 | `st-tr2-body` | `flex:1 1 auto;display:flex;flex-direction:row;align-items:stretch;min-height:0` | SPEC :868-874（pageBody） |

- **待办区 pendingSection：[N-A] #22**（本仓无 gates 写面），不渲染。
- **页脚 [P1] #6**：可选 `st-tr2-foot`（`flex:0 0 auto;padding:4px 10px 6px;font-size:11px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1)`，SPEC :943-949），文案『只读投影 · 数据源 /tree-panel · 更新 <UTC>』；P0 范围不实现。
- 页容器不滚，滚动下沉到 st-tr2-list / st-tr2-detail / st-tr2-viewport 三个内区（SPEC §2.4）。

### 2.2 页头内容（三件套 [#5 P0] + 本仓保留项）

依序：① 标题 `st-tr2-title`（`font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary)`，SPEC :800-804）文案 **`Tree Runs · read-only`**；② 存储根 `st-tr-top-path`（沿用现类，dim 省略号，title 携带全路径）；③ 计数 `st-tr-top-count`（沿用现类）；④ `更新 <UTC>` dim（新增，`panelTimeOf(state.updatedAt)`，SPEC :2588）；⑤ `Refresh` 按钮（沿用 `st-tr-btn`，值重整见 §4.3，onClick 仍 `controller.refreshAll(true)`）。窄栏（≤320px）下 ②④ 靠 `min-width:0 + ellipsis` 收缩，不换行。

### 2.3 左列表列 `.st-tr2-list` [#4 P0]

逐值（SPEC :875-885 pageList 直映射）：

```css
.st-tr2-list{flex:0 0 36%;min-width:150px;max-width:320px;overflow-y:auto;
  padding:8px;display:flex;flex-direction:column;gap:6px;
  border-right:1px solid var(--dsw-alias-border-l1)}
```

降级 overlay 内同构生效（PanelOverlay 渲染同一 PanelShell，无需第二套布局）。

### 2.4 右详情区 `.st-tr2-detail` [#4 P0]

逐值（SPEC :886-895 pageDetail 直映射）：

```css
.st-tr2-detail{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;
  padding:8px 10px;display:flex;flex-direction:column;gap:8px}
```

### 2.5 列表卡片双行结构 [#7 P0]

`PanelTreeCard` 仍为 `<button type=button class="st-tr-card" data-tree-id data-selected>`（整卡热区，SPEC :1558-1567）：

- **行1** `.st-tr-card-top`（现类保留）：`treeId`（`.st-tr-mono .st-tr-card-id`，11px 等宽 600，title 携带全名）+ 右侧 `PanelBadge`。
  - Badge 状态 = **树级派生**（契约无树级 status 字段，见 §7.2）：纯函数 `treeStatusOf(counts)` → ① `failed>0` → `'failed'`；② 其余非终态计数（running/pending/active 等除 succeeded 外任一 >0）→ `'running'`；③ `succeeded>0` → `'succeeded'`；④ 否则 `'pending'`。文本即该派生串，tone 走 `panelToneOf`（四态，SPEC #9 的本仓色板见 §4.2 注）。
- **行2** `.st-tr-meta`（现类保留，`margin-top:3px;label 三级色;11px;ellipsis`）：拼接串 **`<N> leaves · <counts 圆点组> · updated <UTC>`**。counts 圆点组沿用现 `st-tr-dots`/`st-tr-dot[data-tone]` markup（四态语义、failed=0 不渲染圆点——现有断言语义原样保留），只是从行1 移入行2。
- `rootGoalPreview` → 卡片 `title` 属性（`treeId + ' — ' + preview`），不再占行。
- 排序：沿用服务端 `/trees` 返回序（updatedAt 降序，panel-view.js :345-350），客户端不重排（SPEC :206 同款纪律）。

### 2.6 选中态 [#8 P0]

- 判据：`tree.treeId === state.selectedTreeId`（SPEC :1556 对位）。
- 样式：`.st-tr-card[data-selected='true']{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}`（SPEC :1200-1210 runItemActive 逐键：仅边框+背景两键变化）。
- 点击行为：`controller.select(treeId)`——置选中、清 detail/events、并行拉取（client.js :1129-1142），**布局结构不变、列表常驻**（SPEC §4.1）；不提供取消选中（与 flow 一致，SPEC §4.2 无返回概念）。
- hover：沿用 v1 现行 `.st-tr-card:hover`（interactive-bg + border-l2），不新增不删除（W1 §1.4 INFERENCE 建议不自创 hover；v1 已有者为存量，保持）。

### 2.7 空态 / 加载 / 错误文案 [#28 P0]

空态框新类 `st-tr2-empty`：`padding:12px;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px`（SPEC :1321-1326 empty 逐值）。错误仍用 `st-tr-note[data-kind='error']`（error 色，client.js :149）。

| 区 | 态 | v2 文案（英文，与 v1 面板语言一致；括注 SPEC 原句） | 容器 |
|---|---|---|---|
| 列表 | 加载（首载且空） | `Loading trees…` | st-tr-note |
| 列表 | 错误 | `Tree list unavailable: <treesError>` | st-tr-note[data-kind=error] |
| 列表 | 空 | `No trees (storage root: <storageRoot>).` | **st-tr2-empty**（dashed + 存储根提示，#28） |
| 详情 | 未选中 | `Select a tree on the left to view read-only detail (graph / fields / leaves / events).` ← 对位 SPEC :1973『选择左侧 run 查看只读详情（节点状态 / 错误码 / 事件 / 会话入口）』 | **st-tr2-empty** |
| 详情 | 加载 | `Loading tree…` | st-tr-note |
| 详情 | 错误 | `Detail unavailable: <detailError>` | st-tr-note[data-kind=error] |
| 详情 | 数据缺 | `No detail for this tree yet.` | st-tr-note |
| 事件尾 | 空/错误 | `No events yet.` / `Events unavailable: <eventsError>`（沿用 v1） | st-tr-note |
| 图区 | 详情可用但 leaves 空 | 整个 TreeGraph 不渲染（见 §3.7，SPEC :1679 同款：空图=图区消失） | — |

四路错误就地显示、不弹 toast、不清已有数据、AbortError 静默（SPEC §4.8；client.js :1022-1028 reportError 已实现，不动）。

---

## §3 TreeGraph 设计（对齐 SPEC §3.4 FlowGraph 全参）

### 3.1 数据映射与预处理

- **节点** = `detail.leaves`（服务端已按 leafId 升序，panel-view.js :239）；**根节点** = `detail.root.leafId`（服务端 `rootLeafIdOf` 已算好，panel-view.js :179-184；客户端兜底：取不到时用 leaves[0].leafId）。
- **边** = 客户端推导（**契约不改**，§7）：对每 leaf 逐条 `dependencies` 生成 `edge(dep → leaf.leafId)`；过滤双端都存在于节点集的边（SPEC :1630-1634 同款）；按 `from + '\u0000' + to` 去重（防御重复声明）；`dependencies.slice(0,64)` 上限服务端已裁（panel-view.js :166-168）。
- **dependencies 会成环吗？** 写入面**不会**：引擎 `tree_node add` 对 dependencies 做 cycle-checked 且派发要求依赖全 done（工具面硬约束）。但契约投影不携带环保证明、且允许引用不存在/拼接错误的 id——因此客户端**必须保留** SPEC :1635-1647 的同款保护：松弛提升条件 `level[to]+1 <= nodes.length` + 外层 pass 上限 `nodes.length + 2`。环若因数据异常出现，退化表现 = 目标被压到更深列（与 flow 回边观感一致，SPEC §3.4① INFERENCE），**绝不挂死**。
- 组件挂载点：`PanelDetail` 内、字段栅格之后（对位 flow Detail 中 FlowGraph 位置，SPEC :1994）；外层包 `Boundary`（§1.3）。

### 3.2 分层算法（最长路径分层）[#11 P0]

纯函数 `treeGraphLayout(leaves, rootLeafId)` → `{ nodes, edges, graphW, graphH, maxLevel, maxRows }`：

```
1. level[n] = 0（全体）；edges 按 §3.1 预处理。
2. 重复至多 (nodes.length + 2) 轮：逐边检查，
   若 level[from] + 1 > level[to] 且 level[to] + 1 <= nodes.length → level[to] += 1。
   （= SPEC :1635-1647 flowLayout 逐式移植；环保护内建）
3. columns[level] 按服务端 leaf 原序（leafId 升序）排入；row = 同列内序号。
4. maxLevel = 最深非空列号；maxRows = 最大列长。
```

无交叉最小化、无同列去环特判——与 flow 完全同构（SPEC :1656-1658 注记），不做超(flow)设计。

### 3.3 几何常量与画布 [#11 P0]

| 常量 | 值 | 推导 / 回引 |
|---|---|---|
| `PAD` | 12 | SPEC :1685 |
| `BOX_W` | **192** | 本仓 leafId 较长（`<treeId>-<Role><seq>-<name>`，treeId 上限 32 字符）：id 行用 **mono 12px/700**（≈7.2px/字符），展示 **22 字符**截断 → 左缩进 19 + 22×7.2≈158 + 右边距 8 ≈ 185 ≤ 192。对位 flow 168×56 基准（SPEC :1681，18 字符×13px 同法推导） |
| `BOX_H` | **56** | 保持 flow 三行节奏（y+21 / y+38 / y+50），SPEC :1682 |
| `COL_GAP` | 76 | SPEC :1683 |
| `ROW_GAP` | 18 | SPEC :1684 |
| `graphW` | `2*PAD + (maxLevel+1)*BOX_W + maxLevel*COL_GAP` | SPEC :1699 |
| `graphH` | `2*PAD + maxRows*BOX_H + (maxRows-1)*ROW_GAP` | SPEC :1700 |
| 节点坐标 | `x = PAD + level*(BOX_W+COL_GAP)`；`y = PAD + row*(BOX_H+ROW_GAP)` | SPEC :1693-1696 |

### 3.4 节点盒子

每节点 = `<g class="st-tr2-node" data-leaf-id data-status data-tone data-root>`（data-* 供测试钩子，§6.1）：

1. **主体** `<rect rx="9">` 填充 `var(--dsw-alias-bg-layer-2)`；边框：`failed` → `var(--dsw-alias-state-error-primary)` **2px**；**root**（leafId===detail.root.leafId）→ `var(--dsw-alias-brand-primary)` **1.6px**（本仓新增的根区分，替代 flow 无根语义）；其余 → `var(--dsw-alias-border-l1)` **1.2px**。全部 ×`scaleComp`（§3.6）补偿（SPEC :1786-1796）。
2. **角色色条**（对位 flow 类型色条，SPEC :1797-1804）：左侧竖条宽 5px（x+6→x+11，全高内缩 1px），`opacity .9`，取色按 `role`：`commander → var(--dsw-alias-brand-primary)`、`auditor → var(--dsw-alias-state-success-primary)`、`worker/未知 → var(--dsw-alias-label-secondary)`（SPEC #11 建议的角色映射）。
3. **文本三行**（SVG `<text>`）：
   - 行1 `y+21`：`leafId`，**mono 12px/700**，`fill var(--dsw-alias-label-primary)`，**超 22 字符截断加 `…`**（flow 18 字符先例 SPEC :1810）；root 节点此行 fill 换 brand 色（根区分第二层）。`<title>` 子元素携带全名。
   - 行2 `y+38`，**11px/600**（LOD1，§3.6）：`role 原串`（roleTone 色）+ ` ' · ' + status 原串`（状态 tone 色），x 手工偏移 `19 + 4 + role.length*11`（flow :1830 同式）。**状态取色用本仓四态**（running=蓝/succeeded=绿/failed=红/other=idle，与表内 Badge 同色板，见 §4.2 注）——这是对 flow statusTone（running→warn）的**记录在案的有意偏离**，理由：A8c 断言已把四态蓝绿红钉死在 tone 类上，图/表同色优先。
   - 行3 `y+50`，**10px** `labelSecondary`（LOD2）：`ctx <N>%` + （`relay !== 'auto'` 时）` · relay <relay>`，`' · '` 连接（对位 flow 次级行 :1843；flow 的 attempt/耗时本仓无数据，§7.4）。
4. **failed 退化标记** [#16 P0]：右上角实心 error 圆（`cx=x+BOX_W-12, cy=y+13, r=6×comp`）+ 反白 `!`（9px/700，fill `var(--dsw-alias-bg-layer-1)`）（SPEC :1811-1816）。
5. 节点/边**不可点击**、无 hover 态（SPEC §4.7：flow svg 无 onClick，本仓同样不加）。

### 3.5 SVG 边

每边 = `<g class="st-tr2-edge" data-from data-to data-state>` 内一条 `<path>`：

- **端点**：起点 `(x1+BOX_W, y1+BOX_H/2)`，终点左边中点**回退 8px** 留箭头位 `(x2-8, y2+BOX_H/2)`（SPEC :1733-1742）。
- **控制点**（三次贝塞尔 `M sx sy C c1x c1y, c2x c2y, ex ey`）：前向边（`x2 > x1+8`）`off = max(36, min(dx*0.5, 160))`，`c1x = x1+off`、`c2x = x2-off`；非前向（同列/向左，依赖声明静态图几乎不出现，防御保留）退化为 `±70`（SPEC :1737-1741）。
- **扇出避让** [#13 P0]：同源多出边按序号 `bend = (i − (total−1)/2) × 14` px，`c1y = y中 + bend` 全量、`c2y = y中 + bend/4`（SPEC :1702-1708,:1730-1741）——指挥官扇出多 worker 的常见形态。
- **双态取色**（任务书裁决：`.dependencies` 全部视为**「已声明」态**）：
  - **P0 基线**：所有边统一「已声明」态 = `stroke var(--dsw-alias-label-secondary)`、**虚线 `'7 5'`×comp**、线宽 **1.3×comp**、`opacity .85`、箭头 `#st-tr2-arrow-decl`（空心：`fill var(--dsw-alias-bg-layer-1)` + `stroke labelSecondary 1.2`，`M0.5,0.5 L6.5,3.5 L0.5,6.5 z`，9×9 refX7 refY3.5）（SPEC :1747-1752 未走态 + :1957-1961 marker-off 逐值移植；语义读作「依赖已声明，上游未完成」）。
  - **[P1] #12 派生双态**：纯函数 `edgeStateOf(fromLeaf)` = `from.status === 'succeeded' ? 'sat' : 'decl'`；`sat` = `stroke var(--dsw-alias-brand-primary)` **实线**、**2.1×comp**、`opacity 1`、箭头 `#st-tr2-arrow-sat`（brand 实心 `M0,0 L6,3 L0,6 z`，8×8 refX6 refY3，SPEC :1952-1956）。P0 即在 `<defs>` 里同时定义两枚 marker（一行切换的成本），P0 只接线 decl。
- **join 入边序号圆：[N-A] #14**（本仓无 join 汇聚语义），不实现。
- flow 的 `edge.selected`「客户端只读不写」问题（SPEC :1747-1752 INFERENCE）在本仓的答案 = 上面的 P1 客户端推导——比 flow 更进一步，SPEC #12 明文建议。

### 3.6 缩放平移 [#15 P0]

| 项 | 规格 | 回引 |
|---|---|---|
| zoom 状态 | TreeGraph 局部 `useState(1)`，`clampZoom(v) = min(2.5, max(0.25, v))` | SPEC :1851 |
| 反向补偿 | `scaleComp = 1/max(zoom, 0.25)`，所有线宽/字号 ×comp，缩小时视觉粗细恒定 | SPEC :1723 |
| 滚轮缩放 | **仅 Ctrl/⌘+wheel**（`e.ctrlKey||e.metaKey` 才 `preventDefault`），每档 **×/÷ 1.12**，以指针为锚反写 `scrollLeft/scrollTop`：`锚 = 指针坐标/旧zoom − 视口偏移/旧zoom`，新偏移 = `锚×新zoom − 指针坐标 + 视口原点`（flow :1849-1877 同式） | SPEC :1869 |
| 拖拽平移 | 左键 `pointerdown` 记锚点 + `setPointerCapture`，`pointermove` 反写 viewport `scrollLeft/scrollTop`；`cursor:grab`（拖拽中不切 grabbing，flow 同款未实现，SPEC §4.7 INFERENCE） | SPEC :1878-1894 |
| 视口 | `.st-tr2-viewport{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);max-height:520px;overflow:auto;touch-action:none;cursor:grab}`；内层 div 按 `graphW×zoom / graphH×zoom` 撑开滚动区，`<svg viewBox="0 0 graphW graphH" width/height=逻辑×zoom>` | SPEC :924-934, :1931-1943 |
| 工具栏 4 按钮 | `.st-tr2-graphbtn{padding:2px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:18px}`：`−`（÷1.2）/ `＋`（×1.2）/ **`Fit`（=(clientWidth−8)/graphW，clamp [0.25,2]，滚动归零——即本仓「重置」语义，不设第 5 按钮）** / `100%`（zoom=1+滚动归零） | SPEC :913-923, :1860-1867, :1903-1906 |
| 初始 fit | **[P1]**：详情首帧就绪时自动执行一次 Fit（flow 无此行为；首帧闪烁风险，故不入 P0） | — |
| hint | `Ctrl/⌘+wheel zoom · drag to pan · dashed = declared dependency`（11px labelSecondary，挂在工具栏右） | SPEC :1907 |
| LOD | `showLabels = zoom ≥ 0.5`（行2 role·status）、`showDetail = zoom ≥ 0.85`（行3 ctx·relay）；节点盒子与 id 行恒显 | SPEC :1721-1722 |

### 3.7 退化态

| 态 | 行为 | 回引 |
|---|---|---|
| 空图（`leaves.length === 0`） | TreeGraph 整体 return null——**连 section 框都不渲染**（空图=图区消失） | SPEC :1679 |
| 单 leaf（maxLevel=0） | `graphW = 24+192 = 216`、`graphH = 24+56 = 80`，无边渲染，正常出卡 | SPEC :1699-1700 静态推导 |
| 全 root / 无依赖（所有 dependencies 空） | 全部节点 level 0 → 单列纵排，边数 0，正常渲染 | 算法自然结果 |
| 树只有 root | 单节点 + 根样式（brand 边框），同单 leaf | — |
| 详情缺失 / 图区崩溃 | 前者整个 PanelDetail 走 note 态；后者 Boundary 兜底『Graph unavailable』（§1.3） | §1.3 |

### 3.8 图例条 [P1] #17

`.st-tr2-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}`（SPEC :935-942），内容：`● succeeded ● failed ● running ● other · ─── declared dependency (dashed) · ━━ upstream done ([P1] solid brand) · 角色条：指挥 brand / 执行 灰 / 审计 绿`。P0 可先渲染前半（状态四点 + 虚线说明），成本极低。

**禁抄清单**：flow 死样式 `graphWrap`/`dot`/`banner` 零引用，勿移植（SPEC #32）。

---

## §4 CSS 方案

### 4.1 命名空间与挂载

- **新类一律 `st-tr2-*`**，不污染现有 `st-tr-*` 断言面（panel-render ①② 与 style-guard A8b/c/d 全部按类名匹配）。
- **例外（原地改值不改名）**：`.st-tr-pill`（任务书点名逐值落地）、`.st-tr-btn`（页头按钮重整）、`.st-tr-card`（加 data-selected 修饰）、`.st-tr-event-type`（事件 type 加品牌色）。这些类的**存在性断言**全部保持通过（A8b 查存在、panel-render 查类名/文本，均不锁数值）。
- **挂载**：追加进 `client.js` 现有 `CSS` 模板常量（:53-172），沿用单张 `style[data-plugin-css="session-tree"]` + 自愈守卫（§1.3 不动清单）。
- **颜色纪律 [#30 P0]**：新 `st-tr2-*` 类**只允许 `--dsw-alias-*` token**（SPEC §0 十四 token 表）；**无任何字面色 / url() / http**（panel-render ⑤ 断言依赖）。**记录在案的唯一例外**：遗留四态 tone 类 `.st-tr-dot[data-tone='running']` / `.st-tr-badge[data-tone='running']` 的 `var(--dsw-static-blue-500,#3b82f6)` fallback 被 style-guard **A8c 逐字钉死**，原样保留；TreeGraph SVG 内 running 状态取色沿用同一 fallback 写法以保持图表同色（同属该例外，写入 A8c 同款断言覆盖）。

### 4.2 token 映射表（本设计用到的子集，SPEC §0/§1）

| 语义 | token | 用途 |
|---|---|---|
| bgLayer1 | `--dsw-alias-bg-layer-1` | 页头/卡片底、图视口底、pill 底、marker 空心填充 |
| bgLayer2 | `--dsw-alias-bg-layer-2` | 图节点盒底、graphbtn 底、选中卡底、pill 角标底 |
| bgBase | `--dsw-alias-bg-base` | st-tr-btn 底（flow :824-833）、pill 激活反白字色 |
| borderL1 / borderL2 | `--dsw-alias-border-l1/-l2` | 各级边框、分隔线、dashed 空态框 |
| brandPrimary | `--dsw-alias-brand-primary` | 选中卡边、pill 激活、根节点边、角色条-commander、事件 type 色 |
| labelPrimary / labelSecondary | `--dsw-alias-label-primary/-secondary` | 正文/次级文字、声明边 |
| state-error/success/warn/idle | `--dsw-alias-state-*-primary` | failed/succeeded/warn点缀/other tone |

> 四态色板说明：本仓 tone 语义 = running 蓝（static-blue fallback 例外）/ succeeded 绿 / failed 红 / other idle 灰（A8c 钉死 + 侧栏圆点同款，client.js :76-81）；**不采用** flow statusTone 的 running→warn 归并（SPEC :1385）——偏离已记录，理由见 §3.4-3。

### 4.3 逐类关键属性表

**壳层/分栏**（§2 已给逐值的不再重复）：`st-tr2-top`、`st-tr2-body`、`st-tr2-list`、`st-tr2-detail`、`st-tr2-empty`、`st-tr2-foot[P1]`。

**页头三件**：
```css
.st-tr2-title{flex:none;font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary)} /* SPEC :800-804 */
.st-tr2-dim{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}                  /* SPEC :810-812 */
.st-tr-btn{  /* 原地改值为 flow button :824-833 */
  height:24px;padding:0 10px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);font:500 12px system-ui,-apple-system,"Segoe UI",sans-serif;
  cursor:pointer;white-space:nowrap}
.st-tr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}  /* 存量 hover 保留（§2.6 同判） */
```

**字段栅格** [#10 P0]（SPEC :1235-1255 逐值）：
```css
.st-tr2-fieldgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 16px}
.st-tr2-field{display:flex;gap:8px;align-items:baseline;min-width:0}
.st-tr2-fieldlabel{flex:0 0 auto;min-width:84px;color:var(--dsw-alias-label-secondary);font-size:11px}
.st-tr2-fieldvalue{min-width:0;word-break:break-all;color:var(--dsw-alias-label-primary);font-size:12px}
.st-tr2-fieldvalue.st-tr-mono{font-size:11px}   /* mono 值沿用等宽栈 */
.st-tr2-section{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-1);padding:8px 10px}          /* SPEC :1223-1228 */
.st-tr2-section-title{font-weight:600;font-size:12px;margin-bottom:6px;
  color:var(--dsw-alias-label-primary)}                              /* SPEC :1229-1234 */
```
P0 字段清单（全部契约已有，§7.1）：`Tree`(treeId, mono) / `Root goal`(root.goalPreview) / `Root status` / `Created` / `Updated` / `Leaves`(stats.total) / `Status`(byStatus 复合串 `pending=1 · running=2 …`) / `Sessions`(数字)。[P1] 追加：`Storage root`(mono)、`Journal`(客户端组合 `<storageRoot>/<treeId>/tree-state.json`, mono)、`Age`(updatedAt−createdAt, `formatMs` 风格)。

**图区**（§3.5/§3.6 已给 viewport/graphbtn）：`st-tr2-graphbar`（flex wrap gap 6px align-center）、`st-tr2-hint`（同 st-tr2-dim）、`st-tr2-legend`（§3.8）。

**事件尾** [#21 P0]（结构保留 + 两处升级）：
```css
.st-tr-event-type{  /* 原地改值：flow eventType brand+mono，SPEC :1300-1303 */
  color:var(--dsw-alias-brand-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.st-tr2-event-seq{flex:none;color:var(--dsw-alias-label-secondary)}  /* 新增 #seq 前缀 */
```
行结构 = `#<seq>`(st-tr2-event-seq mono) → ts(st-tr-mono) → leafId(st-tr-mono) → type(st-tr-event-type)。上限 `PANEL_EVENT_TAIL=50` 不变（『Events (last 50)』标题断言依赖）。

**SessionCell** [#19 P0]（leaf 表第 8 列，列头 `Session`；无 hook 实现，§5.2）：
- 会话 id `<span class="st-tr-cell st-tr-mono">` 截断展示 + `user-select:text`（flow codeText :818-823）；
- 复制按钮：`height:20px;padding:0 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-brand-primary);font:500 11px …`（flow linkButton :834-843）；
- onClick：`navigator.clipboard.writeText(id)` → 按钮文案直写 `Copied` / `Copy failed`，**1500ms 后复原 `Copy`**（flow :1484-1491 同节奏；setTimeout 一次性、不进 `__stTreePanelTimers` 账本——无 setState 无泄漏面）；
- `sessionId` 为 null → 渲染 `—`，无按钮（flow :1501-1504）。

### 4.4 pill 逐值落地（`.st-tr-pill` 原地改值，[#1 P0]；SPEC §1.2 :744-757 逐键）

```css
.st-tr-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;
  border-radius:999px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  font:600 12px system-ui,-apple-system,"Segoe UI",sans-serif;
  cursor:pointer;white-space:nowrap}
.st-tr-pill-dot{flex:none;width:7px;height:7px;border-radius:50%;
  background:var(--dsw-alias-brand-primary)}      /* 7px 品牌圆点，SPEC :2679/:772-778；由 static-blue 换 brand token */
.st-tr-pill:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)} /* 存量保留（§1.4 判定） */
.st-tr-pill[data-open='true']{border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}  /* [P1] #2 激活态，语义=面板已打开（overlay 路径） */
```
待办角标 `N 待办`：**[N-A] #3**（无 gates 写面），不实现，类名挂点不预留。

### 4.5 字体体系 [#31 P0]

正文/按钮 `system-ui,-apple-system,"Segoe UI",sans-serif`；等宽 `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`（v1 栈，比 flow 多 Menlo，保持 v1）；字号：页基准 12px、次级/等宽 11px、标题 13px、图内次级 10px（SPEC §0）。

### 4.6 删除/新增类清单（供 style-guard 抽查对账）

- **删除**：`.st-tr-scroll`、`.st-tr-grid`、`.st-tr-flabel`、`.st-tr-fvalue`（A1e 断言的是 `.st-meta/.st-ctx` 不存在，与本次删除无关，不受影响）。
- **新增**：`st-tr2-top/title/dim/body/list/detail/empty/foot/fieldgrid/field/fieldlabel/fieldvalue/section/section-title/graphbar/graphbtn/viewport/hint/legend/event-seq/node/edge/svg`（node/edge/svg 为 SVG 内类，仍写入样式表供统一调色）。
- **原地改值**：`st-tr-pill`(+dot)、`st-tr-btn`、`st-tr-card`(+data-selected 规则)、`st-tr-event-type`。

---

## §5 状态与 hook 计划（F8 铁律专项）

### 5.1 新状态清单与落点

| 状态 | 落点 | 类型 | 说明 |
|---|---|---|---|
| `selectedTreeId` | panel store（**已有，:1527**） | 持久 | 语义不变：分栏下常驻选中，无自动取消 |
| `open` | panel store（已有） | 持久 | overlay 路径 + pill `data-open`，不动 |
| `trees/detail/events/treesLoading/detailLoading/*Error/storageRoot/total/lastSeq` | panel store（已有 13 字段） | 持久 | **一字段不动**（controller 写面不动） |
| `zoom` | **TreeGraph 局部 `useState(1)`** | 视图态 | 不进 store（flow 同款：zoom 在 FlowGraph 组件内，SPEC :1849-1851）；切换树/关闭面板即失忆，可接受 |
| `pan` | **非 React state**：viewport DOM `scrollLeft/scrollTop` 直写 | 视图态 | flow 同款（SPEC :1878-1894）；避免 60Hz setState |
| `hoverLeaf` | **不引入** | — | 决策记录：flow 图节点无 hover（SPEC §4.7 FACT），加 hover 属自创交互，砍掉 |
| 复制反馈 | **非 state**：按钮 textContent 直写 + setTimeout 复原（§4.3） | 视图态 | 决策记录：为保 F8 hook 数学干净（§5.3），SessionCell 零 hook |

### 5.2 hooks 位置约定（铁律）

1. **全部 hooks 只出现在组件函数体顶部、无条件执行**；loading/error/empty/list/detail 分支只允许出现在**最后一次 `return`** 的元素树里（v1 TreeRunsPanel :1296-1300 注释已立此规，v2 全组件沿用；flow 的 railMode 先例同源）。
2. `PanelShell` hook 固定序列：`usePanelStore(store)`（内含 1×useState fallback 或 1×useSyncExternalStore）→ `useEffect(轮询 start/stop, [])`（:1308-1311 原样）。**序列与状态无关。**
3. `TreeGraph` hook 固定序列：`useState(zoom)` → `useRef(viewportRef)`；`useRef(fitDoneRef)` 仅在 [P1] 初始 fit 落地时加入（加入后 GRAPH_HOOKS 由 2→3，§5.3 公式同步改常数）。**空图 return null 也在这两个 hook 之后**（先 hook 后分支）。
4. **行级/单元级组件禁止 hooks**：`PanelTreeCard`/`PanelLeafRow`/`PanelField`/`SessionCell`/`PanelBadge` 全部零 hook（SessionCell 用 DOM 直写方案的原因，见 §5.1）。props 驱动，无内部状态。
5. 禁止在 map 回调/条件块内调用 hook；禁止 hook 数量随数据量变化（每行零 hook 从结构上根除该风险）。

### 5.3 三态 hook 恒定的保证手法与测试公式

- v1 断言口径（mount/list/detail 全等）在 v2 下**不再成立**：detail 态多挂一个 TreeGraph（+2 hooks）。v2 把口径改成**两条精确公式**（均进 §6.1 断言）：
  - **公式 A（图前三态恒定）**：`loading = error = empty = selected-but-loading` 四态 useState 计数全等——这四态都不渲染 TreeGraph、不渲染 leaf 行，任何早分支 hook 漂移立即打破等式。
  - **公式 B（详情态增量恒定）**：`detailCalls === baseCalls + GRAPH_HOOKS`，其中 `baseCalls` 为公式 A 的值，`GRAPH_HOOKS = 2`（useState+useRef；P1 fit 落地后 = 3，测试常数同步）。这钉死「TreeGraph hooks 必须无条件执行」。
- 保证手法 = §5.2 五条纪律 + 上述回归栅栏（flow railMode 先例：**分支后置 + hook 计数断言**双保险）；React stub 保持**不含 useSyncExternalStore**（panel-render :223-225 注释的既有口径），测的正是 fallback 路径。

### 5.4 轮询不动声明 [#25/#26 P0]

`createPanelController`（:979-1184）逐行不动：1.5s 列表 tick；`ticks % 2 === 0 || force` 时刷 detail+events；`select()` 清空+并行；`start/stop` + `abortAll`；`withAbort` 对 AbortController 缺席的降级分支；`panelTrackTimer`/`panelResetGlobalTimers`/`window.__stTreePanelTimers` HMR 卫生。v2 只改**消费端**（PanelShell 渲染形态），数据面零改动——panel-render ⑥ 定时器/abort 六连断言预期原样通过。事件增量参数 `since` 契约已备（panel-view.js :281-290）但客户端沿用 v1 全量尾拉（limit=100），**不在 v2 改**（§7.3）。

### 5.5 纯函数新增/扩展（全部无副作用、进模块导出 seam）

| 函数 | 位置 | 说明 |
|---|---|---|
| `treeStatusOf(counts)` | 新增 | §2.5 树级 Badge 派生 |
| `treeGraphLayout(leaves, rootLeafId)` | 新增 | §3.2-3.3（纯几何） |
| `clampZoom(v)` + 常量 `ZOOM_MIN=0.25/ZOOM_MAX=2.5/ZOOM_STEP=1.12` | 新增 | §3.6 |
| `edgeStateOf(leaf)` | 新增（P1 接线，P0 定义+导出） | §3.5 |
| `panelToneOf(status)` | **微扩展**（:946-951）：`'done' → 'succeeded'`、`'active'/'segment_pending' → 'running'` 归入现组、`'pending_brief' → 'other'` [P1] | 引擎真实状态词表（pending_brief/active/segment_pending/done）落进现四态；fixture 用词不受影响，现有断言不破 |
| `statsSessionsOf(stats)` | 新增 | 兼容 `sessions` 为 number（服务端 panel-view.js :243）或 object（旧 fixture）双型 → 计数串；修复 v1 `Object.keys(数字)` 得 0 的口径错位（§7.1 注） |

导出追加到 :3250-3255 的 seam 区（模块装载器只消费 inject/apply，导出无运行时面，:3239-3242 注释先例）。

---

## §6 测试计划

### 6.1 panel-render v2 断言清单（新增，编号 V2-*）

| # | 断言 | 判定方法（mini renderer 口径） |
|---|---|---|
| V2-1 | 分栏两区并存 | 选中后单次 `Body` 渲染同时含 `.st-tr2-list` 与 `.st-tr2-detail` 各 ≥1，且 `.st-tr2-body` 直接子区恰 2 个 |
| V2-2 | 列表卡片双行结构 | 卡片行1 含 `st-tr-mono st-tr-card-id` + `st-tr-badge`（data-tone ∈ 四态）；行2 `st-tr-meta` 文本含 `'4 leaves'`、`'updated 2026-11-15 02:30:00'` |
| V2-3 | 树级 Badge 派生 | `treeStatusOf` 直接断言：`{failed:1,running:2}→failed`、`{running:2,succeeded:1}→running`、`{succeeded:3}→succeeded`、`{pending:1}→pending`；卡片 Badge 文本 tree-alpha=`failed`、tree-beta=`succeeded` |
| V2-4 | 选中进详情 + 高亮 | 点卡片后 `store.selectedTreeId==='tree-alpha'`；该卡 `data-selected==='true'`、另一卡 `'false'`；详情区渲染 3 行 leaves |
| V2-5 | 空态文案 | 未选中渲染 `Select a tree on the left to view read-only detail`；容器类 `st-tr2-empty`；列表空态 `No trees (storage root: D:\x).` 且类 `st-tr2-empty` |
| V2-6 | 图渲染 node 数 = leaves 数 | 选中 tree-alpha 后 svg 内 `g.st-tr2-node` 恰 3，`data-leaf-id` 序 = `['la-root','lb-ver','lc-bad']` |
| V2-7 | 边数 = dependencies 总和 | `g.st-tr2-edge` 恰 2（lb-ver→[la-root]、lc-bad→[lb-ver]）；`data-from/data-to` 对正确；全部 `data-state==='decl'`（P0 单态） |
| V2-8 | SessionCell 列 | 第 8 列列头 `Session`；`lb-ver` 行含 `sess-impl-2` mono 串与 `Copy` 按钮；`lc-bad` 行（sessionId=null）为 `—` 无按钮；点击按钮调用 `navigator.clipboard.writeText`（stub 注入） |
| V2-9 | 缩放/平移函数存在性与边界 | seam 断言：`clampZoom(0.1)===0.25`、`clampZoom(9)===2.5`、`clampZoom(1)===1`；`ZOOM_STEP===1.12`；`treeGraphLayout` 返回 `graphW/graphH` 与 §3.3 公式一致（3 节点链 → 752×80） |
| V2-10 | 根节点区分 | `g.st-tr2-node[data-leaf-id='la-root'][data-root='true']` 存在；其余节点 `data-root==='false'` |
| V2-11 | 公式 A（三态+selected-loading hook 恒定） | `loadCalls === errCalls === emptyCalls === selLoadCalls` |
| V2-12 | 公式 B（详情态增量恒定） | `detailCalls === baseCalls + 2`（GRAPH_HOOKS） |
| V2-13 | failed 节点角标 | `lc-bad` 的 g 含 data-status='failed'（rect 描边色断言留给 style-guard；渲染层断言 data 属性） |
| V2-14 | 事件尾含 #seq | 事件行文本以 `#1/#2/#3` 开头、type span 类含 `st-tr-event-type` |
| V2-15 | 无 Back 按钮 | 详情态渲染树中不存在文本为 `← Back` 的按钮（删除项回归守卫） |

**既有语义保留断言**（不重列）：⑤ 资源卫生、⑥ 定时器/abort、⑦ 席位清单预期全部原样通过——因为 fetch 口径、controller、席位注册零改动。

### 6.2 style-guard 更新点

- **A8 计数不变声明**：席位注册零改动 → `slotCount()===10`（A8）**原样保留，预期不动一行**。
- **A8b/c/d 原样保留**：`.st-tr-pill{`/`.st-tr-card{`/`.st-tr-badge{` 存在性、四态 tone 取色（含 running 蓝 fallback）、`.st-tr-overlay{`/`.st-tr-row[data-kind='head']{` 全部不受 §4 改值影响（改值不改名、删的是无断言类）。
- **新增抽查（追加在 A8d 之后）**：
  - **A8e**：`/\.st-tr2-list\{[^}]*min-width:150px/.test(sheet) && /\.st-tr2-list\{[^}]*max-width:320px/.test(sheet)`（#4 分栏 clamp）；
  - **A8f**：`/\.st-tr2-viewport\{[^}]*max-height:520px/.test(sheet)` 且含 `touch-action:none`（#15）；
  - **A8g**：`/\.st-tr2-fieldgrid\{[^}]*minmax\(260px,1fr\)/.test(sheet)`（#10 栅格参数照抄）；
  - **A8h**：`/\.st-tr-pill\{[^}]*height:26px/.test(sheet)`（#1 逐值落地）；
  - **A8i**：`/\.st-tr2-empty\{[^}]*dashed/.test(sheet)`（#28 空态虚线框）。
- A0–A7（注入/自愈/幂等）与 B/C 场景零改动。

### 6.3 现有 58 判定逐条处置（panel-render.test.cjs）

**保留 55 条**（名称与口径不变）：加载脚本/module id/seam 存在（3）；挂载首帧加载态、挂载登记定时器（2）；① 两张卡、mono treeId、顶栏 storageRoot、顶栏总数、Refresh 按钮、四态圆点着色、tone 集合、updated/leaves 文案、F8 list==mount（9）；① 卡片可点击（1）；② 3 行 leaves、行序、Badge 四态 tone、relay/task/ctx 列、verification ✓✗、dependencies 列、root 摘要、事件尾 3 条、`Events (last 50)`（9）；③ 详情态 hook==列表态（**改口径为 V2-11/V2-12 承接**，见下）、加载态、错误态、空树态、三态恒定（5）；④ pill 类名/文案/aria-pressed/openTab/overlay 打开/overlay 渲染/Escape 监听/Escape 关闭/关闭后 null（9）；⑤ 同源路径、路由命中、凭据 no-store、无绝对 URL、CSS 无外链（5）；⑥ 定时器登记/卸载清理/abort/无残留/AbortController 降级/HMR 清理（6）；⑦ 5 席位/pill 席位/overlay 席位/右栏 6 席位/tab 注册/pane.tab key（6）；seam 工厂（1）。

**改写 2 条**：
1. `① 卡片渲染 rootGoalPreview`（:368）→ 改断言卡片 `title` 属性含 preview 串（预览移入 title，§2.5）。
2. `② 返回回列表（selectedTreeId 清空）`（:419）→ 改断言「点击另一卡片切换选中：`selectedTreeId` 更新为新 treeId 且详情随之刷新」（分栏无返回概念，§1.2）。

**删除 1 条**：
3. `② 返回按钮存在`（:413-414）→ 分栏同屏无 Back 按钮（SPEC §4.2），由 V2-15 反向守卫。

（③ 的「详情态 useState 数量与列表态一致」计入保留组但其判定式改写为 V2-11/V2-12 两式——净效果：58 → 57 条原有 + 15 条 V2 新增 ≈ 72 判定。）

### 6.4 render.test.cjs 与 provider-conformance 不受影响的论证

- **`test/render.test.cjs`（侧栏树）**：其断言面是 `buildRows`/TreeView/`st-row`/`st-dot`/workspace 分组——本次改动的全部锚点都在面板块（CSS 面板段 :121-171、面板运行时 :826-1664）与导出 seam 区（:3250-3255），不触碰侧栏渲染路径与 DICT；唯一共享面是 `CSS` 常量追加与 `panelToneOf` 扩展（面板专用函数，render.test.cjs 不引用）。**零影响**。
- **`test/provider-conformance.cjs`**：验证 `apply(ctx)` 的服务注入形状（sidebarRightTabs/sidebarRight/slots/effect）。席位注册函数与 apply 接线零改动（§1.3），注册清单不变。**零影响**。
- **style-guard 自身机制断言（A0–A7、B、C）**：样式表注入/自愈机制（ensureStylesheet/guardStylesheet/STYLE_SELECTOR）零改动，CSS 仅文本追加。**零影响**。
- **运行口径**：`node test/panel-render.test.cjs` / `node test/style-guard.cjs` 退出码 0=绿；两个文件均只依赖 Node 内建，无新依赖引入。

---

## §7 服务端差距结论

### 7.1 逐字段核对（依据 panel-view.js 投影 = `/tree-panel` 契约唯一权威）

| 设计所需 | 契约出处 | 结论 |
|---|---|---|
| 树卡片：treeId/rootLeafId/createdAt/updatedAt/leafCount/counts/rootGoalPreview/storageRoot/total | projectTreeSummary :197-205 + listTrees :351-357 | **齐备** |
| 图：leafId/status/role/dependencies | projectLeaf :158-168 | **齐备**（edges 客户端推导，§3.1） |
| 图：根节点标识 | projectTreeDetail.root.leafId :234-236 | **齐备**（root = root leaf，无需客户端猜 `${treeId}-root`） |
| 表：leafId/status/relay/taskType/ctxPct/verification{pass,attempts,…}/dependencies | projectLeaf :158-174 | **齐备**（v1 已渲染） |
| 表：sessionId（SessionCell #19 P0） | projectLeaf :163 | **齐备**——任务书字段清单未列但契约在（测试夹具 :92 亦有），无服务端改动 |
| 字段栅格：treeId/createdAt/updatedAt/root{status,goalPreview}/stats.total/byStatus | projectTreeDetail :230-246 | **齐备** |
| 字段栅格：stats.sessions | :243（**number**） | **齐备，但类型口径**：v1 客户端按 object 取 keys（fixture 亦 object），服务端实发 number → v2 用 `statsSessionsOf` 双型兼容（§5.5），**客户端修，无服务端改动** |
| 事件尾：seq/ts/leafId/type/lastSeq + since/limit/leaf 参数 | projectEvents :281-290 | **齐备**（since 契约在，客户端 v2 仍全量尾拉，不强制增量） |
| assignee{provider,model,effort} / doneSummaryPreview(≤200) | :107-115, :136-146, :170, :175 | **齐备未渲染**：v2 [P1] 以 title 属性携带 doneSummaryPreview（leafId 单元格）；assignee 暂不渲染（记录） |
| storageRoot（详情栅格） | 详情投影**无**此字段（仅 list 有） | **非缺口**：存储根全局唯一，页头已展示（§2.2）；详情栅格 [P1] Journal 路径由客户端组合 `<storageRoot>/<treeId>/tree-state.json`（文件名固定，panel-view.js :318） |
| integrity（SPEC #7/#23） | 契约无 | **缺口**：本仓 tree-state 无 hash 链投影 → v2 不渲染 integrity 行（#23 P1 搁置，见 7.4-a） |
| attempt/耗时（flow 节点行次级） | 契约无 per-leaf startedAt/durationMs | **缺口**：leaf 行次级改用 `role · ctxN% · relay`（全部已有），不加字段（7.4-b） |

### 7.2 客户端推导项（均无服务端改动）

edges（dependencies→边 + 双端过滤 + 去重，§3.1）；根节点（detail.root.leafId）；树级 Badge（treeStatusOf counts 派生，§2.5）；Journal 路径组合（P1）；Age 时长（P1，updatedAt−createdAt）。

### 7.3 结论

**P0 范围预计零服务端改动**：树图/表/栅格/事件四区所需字段在 `/tree-panel` 三路由现有投影中全部齐备；唯二数据缺口（integrity、per-leaf 耗时）都在 P1 且有客户端替代方案（见 7.4），不阻塞 W3。

### 7.4 最小新增字段提案（单列；**默认都不做**，仅当未来需要时按此提案走契约变更流程）

| 提案 | 字段 | 落点 | 触发条件 |
|---|---|---|---|
| a | list 条目 + `integrity: 'ok'\|'unknown'`（枚举单值，脱敏口径同现有投影） | projectTreeSummary | 需要 SPEC #23 完整性降级展示时 |
| b | leaf 投影 + `startedAt`/`durationMs`（number，可空） | projectLeaf | 需要 flow 式「attempt · 耗时」行时 |
| c | detail + `storageRoot`（与 list 同值冗余） | projectTreeDetail | 仅当详情区要独立展示存储根（当前页头已覆盖，无需求） |

---

## 附：设计自检摘要

- 七节齐备；W1 checklist **P0 共 20 项（#1/4/5/7/8/9/10/11/13/15/16/18/19/21/25/26/27/28/30/31）全部落位**，P1 落位 8 项（#2/6/12/17/20/24→title 携带/#29 无 overlay 需求仅记/#32 禁抄），N-A 3 项（#3/14/22）显式声明；P0 覆盖 **20/20**。
- 两个有意偏离均已记录并给理由：① 四态色板不采 flow statusTone running→warn（A8c + 侧栏圆点一致性，§4.2 注）；② v1 存量 hover 保留（W1 §1.4 INFERENCE 判定，§2.6/§4.4）。
- 唯一交付物为本文件；代码、测试文件的落改属 W3 工作面。
