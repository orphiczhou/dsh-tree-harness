# SPEC-flow-parity — Flow Runs 面板逆向规格（Tree Runs v2 对齐用）

> **交付物**：leaf `t29p-W1-spec`（需求分析师·flow 面板逆向规格）。
> **用途**：供 W2（设计）与 W3（实现）逐条对齐 flow 插件面板 UI。
> **数据源（只读，未改动 flow 仓）**：`D:\Codes\DSH动态流程引擎插件\spike\dsh-flow-plugin\client.js`（2909 行，零构建浏览器 bundle，`h()` hyperscript + 内联 style 对象 + `tv()` 主题 token；模块头注释 :1-29 声明「colors come ONLY from the 14 live theme tokens; no literal colors」:26）。
> **逆向方法**：全文通读 client.js（1-2909 全行），锚点行号逐段核实；对 `selected`/`hover`/死样式做了 grep 交叉核查。
> **行号基准**：本文件所有 `client.js:N` 均指上述文件实际行号（本文写作时已逐段验证）。
>
> **证据标注约定**：
> - **FACT** = 有源码行号证据（含由源码公式的静态推导，推导式随条目给出）。
> - **INFERENCE** = 需运行时确认的推断（源码只给了间接证据）。
>
> **重要校正**：任务书谓「Badge 色调映射 14 状态」——源码事实是 **14 指主题 token 数**（:57-73），Badge 状态→色调映射由 `statusTone` 归并为 **4 个色调组**（success/error/warn/labelSecondary），具名覆盖 **9 个状态 + fallback**（:1380-1387）。详见 §3.2。

---

## §0 token 体系（一切视觉值的原子）

`TOKENS` 表（client.js:57-73）+ `tv()` 包装函数（:75-77，`tv(name) => 'var(' + name + ')'`）。面板所有颜色**只**引用这 14 个 CSS 变量，无字面色（FACT，:26 头注释 + 全文无 `#`/`rgb(` 字面色——见 §5 checklist 第 30 条）。

| 语义键 | CSS 变量（token 字面名） | client.js:57-73 |
|---|---|---|
| bgBase | `--dsw-alias-bg-base` | :59 |
| bgLayer1 | `--dsw-alias-bg-layer-1` | :60 |
| bgLayer2 | `--dsw-alias-bg-layer-2` | :61 |
| bgOverlay | `--dsw-alias-bg-overlay` | :62 |
| borderL1 | `--dsw-alias-border-l1` | :63 |
| borderL2 | `--dsw-alias-border-l2` | :64 |
| brand | `--dsw-alias-brand-primary` | :65 |
| labelPrimary | `--dsw-alias-label-primary` | :66 |
| labelSecondary | `--dsw-alias-label-secondary` | :67 |
| error | `--dsw-alias-state-error-primary` | :68 |
| idle | `--dsw-alias-state-idle-primary` | :69 |
| success | `--dsw-alias-state-success-primary` | :70 |
| warn | `--dsw-alias-state-warn-primary` | :71 |
| sidebarFill | `--dsw-specific-sidebar-fill` | :72 |

通用字体（FACT）：
- 正文/按钮：`system-ui, -apple-system, Segoe UI, sans-serif`（pill :754、overlay :787、page :854）。
- 等宽：`ui-monospace, SFMono-Regular, Consolas, monospace`（mono :814、codeText :819、modalPrompt :1065、amendLabel :1134、pre :1288、eventType :1302、eventPayload :1306）。
- 字号体系：页基准 12px/1.5（page :855-856、overlay :788-789）；次级/等宽 11px；标题 13px（headerTitle :802、modalTitle :1050）。

---

## §1 入口 pill 视觉规格（逐值提取）

### 1.1 组件与注册（FACT）

- 入口组件：`EntryButton`（client.js:2654-2689），经 `withBoundary('entry', …)` 包成 `BoundaryEntry`（:2730），注册进会话输入坞席位 `conversation.composer.dock`，参数 `{ name: 'conversation.composer.dock', id: 'flow-runs', order: 5, label: () => 'Flow Runs' }`（:2848-2852）。
- pill DOM 结构（:2668-2688）：`<button>` → ① 7px 品牌色圆点 span（:2679，内联 style，与 `styles.dot` :772-778 同值；`styles.dot` 本身零引用，死样式——grep 核查）→ ② 文本 `'Flow Runs'`（:2680）→ ③ 条件渲染待办 badge（:2681-2687）。
- tooltip：`title: 'Flow Runs（只读运行面板 + 待办人工决策；在右侧栏打开）'`（:2673）；`aria-pressed` 随 `state.open`（:2674）。

### 1.2 pill 常态样式（FACT，style 对象 `pill` :744-757 逐键）

| CSS 键 | 值 | 证据 |
|---|---|---|
| display | `inline-flex` | :745 |
| align-items | `center` | :746 |
| gap | `6px` | :747 |
| height | `26px` | :748 |
| padding | `0 10px` | :749 |
| border-radius | `999px`（全圆角胶囊） | :750 |
| border | `1px solid var(--dsw-alias-border-l1)` | :751 |
| background | `var(--dsw-alias-bg-layer-1)` | :752 |
| color | `var(--dsw-alias-label-primary)` | :753 |
| font（简写） | `600 12px system-ui, -apple-system, Segoe UI, sans-serif` → **weight 600 / size 12px / 上述字体栈** | :754 |
| cursor | `pointer` | :755 |
| white-space | `nowrap` | :756 |

### 1.3 pill 激活态（FACT，`pillActive` :758-771 逐键）

与常态**逐键相同**，仅三键不同（:765-767）：`border: 1px solid var(--dsw-alias-brand-primary)`、`background: var(--dsw-alias-brand-primary)`、`color: var(--dsw-alias-bg-base)`（品牌色填充底 + 反白字）。

⚠ 语义校正（FACT）：`pillActive` 的切换条件是 `state.open`（:2672）——即 **overlay 降级模式**下面板打开时。右侧栏模式下 `openPanel()` 走 `sidebarRight.openTab(kind)` 成功路径**不会**置 `state.open`（:2641-2652），pill 保持常态。即：**pillActive ≈ "overlay 已展开"指示，不是 hover/按下态**。

### 1.4 hover / :active 态（FACT + INFERENCE）

- **FACT：源码不存在任何自定义 hover/active 视觉**。全文无 `:hover`/`:active` 伪类（内联 style 对象本就无法写伪类）、无 `onMouseEnter/onMouseOver/onFocus` 处理（grep `hover|onMouseEnter|onMouseOver` 零命中）。
- FACT：仅有 `cursor: pointer`（:755）与按下语义 `aria-pressed`（:2674）。
- INFERENCE：浏览器对 `<button>` 的默认 hover/焦点环样式（宿主全局 CSS 可能覆盖）需运行时确认；W2 若要「同布局同功能」，**不建议自创 hover 效果**，与 flow 保持一致 = 只有 cursor 变手型。

### 1.5 待办角标（gates 计数 badge）（FACT）

- 样式对象 `pendingBadge`（:951-962）逐键：

| CSS 键 | 值 | 证据 |
|---|---|---|
| display | `inline-block` | :952 |
| padding | `0 5px` | :953 |
| border-radius | `999px` | :954 |
| border | `1px solid var(--dsw-alias-state-warn-primary)` | :955 |
| background | `var(--dsw-alias-bg-layer-2)` | :956 |
| color | `var(--dsw-alias-state-warn-primary)` | :957 |
| font-weight | `600` | :958 |
| font-size | `11px` | :959 |
| line-height | `16px` | :960 |
| white-space | `nowrap` | :961 |

- 内容与显隐（:2665-2687）：计数 `pendingGateCount(gates)`——`status` 非字符串或 === `'pending'` 的 gate 才计入（:258-266）；显隐条件 `gatesChannel !== 'disabled' && count > 0`（:2667）；文案 **`'<N> 待办'`**（:2685），tooltip `'待人工决策 <N> 项'`（:2684）。形状=warn 描边胶囊（非圆点数字泡）。

### 1.6 等价 CSS class 写法示例（token → `--dsw-alias-*` 直映射）

```css
/* 由 §1.2/§1.3/§1.5 逐键转写；token 名即 flow TOKENS 表字面名（client.js:57-73） */
.flow-entry-pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: 600 12px system-ui, -apple-system, "Segoe UI", sans-serif;
  cursor: pointer; white-space: nowrap;
}
.flow-entry-pill__dot {           /* client.js:2679 内联；7px 品牌圆点 */
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--dsw-alias-brand-primary); display: inline-block;
}
/* 激活态仅 overlay 模式使用（client.js:2672）；右侧栏模式保持常态 */
.flow-entry-pill.is-active {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.flow-entry-pill__badge {         /* pendingBadge client.js:951-962 */
  display: inline-block; padding: 0 5px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-state-warn-primary);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-state-warn-primary);
  font-weight: 600; font-size: 11px; line-height: 16px; white-space: nowrap;
}
```

---

## §2 面板壳层布局规格

### 2.1 关键结论：列表与详情是**左右分栏同屏**（非切换式）——确定性结论 + 证据链（FACT）

**结论：右侧栏页面模式下，run 列表区与详情区在同一 `flex row` 容器内左右并置、同屏渲染、各自独立滚动；没有任何「列表↔详情」互斥切换逻辑。** 降级 overlay 模式同样左右分栏同屏。

证据链（全部 client.js 实行号）：
1. `SidebarBody` 渲染树（:2578-2632）：`page`（flex column）→ `pageHeader` → `<PendingGates/>`（:2602-2607）→ **`pageBody`（:2608-2613）内并列两个兄弟节点：`pageList` 里挂 `<RunList/>`（:2611）、`pageDetail` 里挂 `<Detail/>`（:2612）**。
2. `styles.pageBody`（:868-874）：`flex: '1 1 auto'; display: 'flex'; flexDirection: 'row'; alignItems: 'stretch'; minHeight: '0'` —— row 方向，两子区同屏。
3. `styles.pageList`（:875-885）：`flex: '0 0 36%'; minWidth: '150px'; maxWidth: '320px'; overflowY: 'auto'; padding: '8px'; display: 'flex'; flexDirection: 'column'; gap: '6px'; borderRight: '1px solid var(--dsw-alias-border-l1)'` —— 固定占比左列 + 右分隔线 + 自滚动。
4. `styles.pageDetail`（:886-895）：`flex: '1 1 auto'; minWidth: '0'; minHeight: '0'; overflowY: 'auto'; padding: '8px 10px'; display: 'flex'; flexDirection: 'column'; gap: '8px'` —— 弹性占满右区 + 自滚动。
5. Detail 空态文案自证并置：`'选择左侧 run 查看只读详情（节点状态 / 错误码 / 事件 / 会话入口）。'`（:1973）。
6. 选择 run 只是就地刷新右区（`controller.select` :680-693 重置 detail/events 并拉取），**不改变布局结构**。
7. 降级 overlay `Panel` 同构（:2160-2165）：`body`（flex row :1164-1170）→ `listPane`（固定 320px，`flex: '0 0 320px'`，:1171-1180）+ `detailPane`（flex 1，:1181-1188）。

### 2.2 纵向骨架（右侧栏页面，FACT）

`SidebarBody`（:2578-2632）从上到下四段 + 一浮层：

| 段 | 样式键 | 关键值 | 证据 |
|---|---|---|---|
| 页头 | `pageHeader` | flex 两端对齐、gap 8px、padding `8px 10px`、下边框 borderL1、背景 bgLayer1、`flex: '0 0 auto'`（定高不滚） | :858-867 |
| 待办区 | `pendingSection` | `flex: '0 1 auto'; maxHeight: '45%'; overflowY: 'auto'`（可压缩、最多吃 45% 高、自滚）、padding `8px 10px`、下边框、背景 bgLayer1；`gatesChannel==='disabled'` 时整区不渲染（:2182） | :963-973 |
| 主体 | `pageBody` | `flex: '1 1 auto'` 吃满剩余高；内部左右分栏见 §2.1 | :868-874 |
| 页脚 | `pageFooter` | `flex: '0 0 auto'; padding: '4px 10px 6px'`、labelSecondary 11px、上边框 borderL1（定高） | :943-949 |
| 决策浮层 | `DecideModal` 条件挂载 | `modalMask: position absolute; inset 0; zIndex 30; background bgOverlay`（**相对 page 定位，非全屏**）+ `modalCard: flex '0 1 560px'; maxHeight 100%; overflowY auto; borderRadius 10px` | :2621-2631, :1018-1041 |

页容器 `page`（:845-857）：`position relative; height 100%; width 100%; minHeight 0`、背景 bgBase、文字 labelPrimary、**页本身不滚**（滚动下沉到 pageList / pageDetail / pendingSection / graphViewport 四个内区）。

### 2.3 页头内容（FACT）

- 左：标题 `'Flow Runs · 只读 + 待办决策'`，样式 `headerTitle`（600 / 13px / labelPrimary，:800-804，挂在 :2584）。
- 右：`更新 <UTC 时钟>`（`dim`，:2588）+ `刷新` 按钮（`button`：height 24px、padding `0 10px`、圆角 6px、边框 borderL1、背景 **bgBase**、labelPrimary、`500 12px`，:824-833，挂 :2589-2599）。
- overlay 变体多一个 `关闭` 按钮（:2147-2157）且标题为 `'Flow Runs · 只读运行面板'`（:2131）。

### 2.4 滚动策略汇总（FACT）

| 区 | 滚动 | 证据 |
|---|---|---|
| page 容器 | 不滚（height 100%，minHeight 0） | :845-857 |
| pageHeader / pageFooter | 定高不滚（flex 0 0 auto） | :866, :944 |
| pendingSection | 自滚，maxHeight 45% | :964-966 |
| pageList（左列） | 自滚（overflowY auto） | :879 |
| pageDetail（右区） | 自滚（overflowY auto） | :890 |
| graphViewport（图内视口） | 自滚 + maxHeight **520px**、`touchAction none` | :924-934 |
| pre（outputPreview / outputs 摘要） | 自滚 maxHeight 180px | :1292-1293 |
| modalPrompt | 自滚 maxHeight 160px | :1069-1070 |
| modalCard | 自滚（maxHeight 100%） | :1032 |

### 2.5 空态 / 加载态 / 错误态（FACT，全部为 `empty`/`dim` 文本块）

- 通用 `empty` 样式（:1321-1326）：padding 12px、labelSecondary、**1px dashed borderL2 虚线框**、圆角 8px。`dim`（:810-812）= labelSecondary 无框。
- RunList（:1546-1553）：加载（首载无数据）`'加载 run 列表…'`；错误 `'列表不可用：<listError>'`；空 `'没有 run（存储根：<storageRoot>）。'`。
- Detail（:1973-1976）：未选中 `'选择左侧 run 查看只读详情（…）'`；加载 `'加载 run 详情…'`；错误 `'详情不可用：<detailError>'`；其他 `'详情不可用。'`。
- 事件区（:2081-2084）：错误 `'事件不可用：<eventsError>'`；空 `'暂无事件。'`/redacted `'完整性未通过：事件流不渲染。'`。
- 待办区（:2186-2193）：错误 `'待办不可用：<gatesError>'`；空 `'暂无待办'`；首载 `'加载待办…'`。
- 渲染崩溃兜底 `withBoundary`（:2691-2717）：每个挂载席位包 ErrorBoundary，崩溃渲染 `boundary` 样式 span（error 色、`500 12px`，:1327-1330），文案 `'Flow Runs 面板不可用（已自兜错，不影响宿主）'`（:2711），并 console.error 带标签（:2700-2708）。

---

## §3 逐区域组件规格

### 3.1 RunList run 卡片（FACT）

组件 `RunList`（:1544-1585）；每 run 一个 `<button>`（可点击、整卡热区，:1558-1567），两行结构：

- **第一行** `runItemTop`（flex 两端对齐、gap 8px，:1211-1216）：`runId`（mono：11px 等宽 labelPrimary，:813-817）+ `<Badge status>`（右对齐，:1571-1572）。
- **第二行** `runItemMeta`（marginTop 4px、labelSecondary、11px、`wordBreak: break-all`，:1217-1222）：拼接式单行（:1577-1580）——`<flowName || flowId> · integrity=<integrity.state，缺省 'unknown'>` + （有 errorCode 时）` · <errorCode>` + （`trusted === false` 时）` · 未校验`。
- 卡片样式 `runItem`（:1189-1199）：block、width 100%、textAlign left、padding `8px 10px`、圆角 8px、边框 1px solid borderL1、背景 bgLayer1、文字 labelPrimary、cursor pointer。
- **选中态** `runItemActive`（:1200-1210）：仅两键变化——边框变 `1px solid var(--dsw-alias-brand-primary)`、背景变 `var(--dsw-alias-bg-layer-2)`。选中判据 `run.runId === state.selectedRunId`（:1556）。
- 列表容器：flex column、gap 6px（:1584 内联；与 pageList 自身 gap 6px 叠加，实际卡间距 6px）。
- 排序：按 `GET /flow-panel/runs?limit=20`（:560，`RUN_LIMIT=20` :44）返回原序，客户端不重排。

### 3.2 Badge 与状态→色调映射（FACT）

- `Badge`（:1412-1414）：`<span>` 渲染 `textOf(status)`（空值显示 `'—'`，:268-271）。
- `badgeStyle(status)`（:1399-1410）逐键：`display: inline-block; padding: 0 6px; border-radius: 999px; border: 1px solid <tone>; color: <tone>; font-size: 11px; line-height: 16px; white-space: nowrap`。**无背景色（透明底描边胶囊）**；tone = `statusTone(status)`。
- `statusTone`（:1380-1387）映射表（run 状态与 node 状态共用）：

| 状态（具名） | tone token | client.js |
|---|---|---|
| `succeeded` | success `--dsw-alias-state-success-primary` | :1381 |
| `failed` / `corrupted` / `unverified` / `unverified-tail` / `stale` | error `--dsw-alias-state-error-primary` | :1382-1383 |
| `running` / `suspended` / `interrupted` | warn `--dsw-alias-state-warn-primary` | :1385 |
| 其余一切（如 `pending` / `skipped` / `cancelled` / `waiting` / 未知串） | labelSecondary `--dsw-alias-label-secondary` | :1386 |

- node 侧中文标签表 `NODE_STATUS_LABELS`（:1605-1615）：succeeded 成功 / failed 失败 / skipped 跳过 / running 运行中 / pending 待执行 / waiting 等待审批 / cancelled 已取消 / suspended 已挂起 / interrupted 已中断（图表卡片用，Badge 本身直接显示英文原串）。

### 3.3 Detail 顶部字段栅格（FACT）

- Detail 组件（:1970-2094）右区从上到下依次：完整性错误区块（仅 `trusted===false`，:1985-1993）→ `<FlowGraph/>`（:1994）→ **Run 字段区**（:1995-2029）→ 节点区（:2030-2043）→ 门禁区（:2044-2064，有 gates 才渲染）→ outputs 摘要区（:2065-2072，有字符串才渲染）→ 事件区（:2073-2092）。
- 字段栅格 `fieldGrid`（:1235-1239）：`display: grid; gridTemplateColumns: repeat(auto-fill, minmax(260px, 1fr)); gap: '4px 16px'`（自适应列数，列最小 260px，行距 4px 列距 16px）。
- `Field` 组件（:1416-1423）：flex 行、gap 8px、baseline 对齐、minWidth 0（:1240-1245）；label=`fieldLabel`（labelSecondary、`flex: '0 0 auto'`、**minWidth 84px**，:1246-1250）；value=`fieldValue`（labelPrimary、`wordBreak: break-all`，:1251-1255），`mono===true` 时 value 换 `mono` 样式（11px 等宽，:1421）。
- Run 区 17 个字段清单（:2002-2027，标题 `'Run'` sectionTitle :1998）：`runId`(mono) / `status` / `flow`(flowName‖flowId) / `engine` / `integrity`(=state + degraded 时缀「（降级可见）」:2006) / `errorCode` / `failedNodeId` / `permTier` / `callerOrigin` / `startedAt`(formatClock) / `endedAt`(formatClock) / `duration`(formatMs) / `lastSeq` / `storageRoot`(mono) / `journalPath`(mono) / `stats`(复合串 `executions=N retries=N concurrency=N`，:2017-2027)。
- section 容器（:1223-1228）：边框 borderL1、圆角 8px、背景 bgLayer1、padding `8px 10px`；`sectionTitle`（:1229-1234）：600 / 12px / marginBottom 6px / labelPrimary。
- 格式化（FACT）：`formatClock`→UTC `YYYY-MM-DD HH:MM:SSZ`（:203-210）；`formatMs`→`<1s` 显示 `Nms`，否则 `X.Xs`（:221-225）；空值统一 `'—'`（textOf :268-271）。

### 3.4 FlowGraph 只读流程图（FACT，除注明外）

组件 :1670-1968；`nodes.length === 0` 时整体返回 null（:1679，连 section 框都不渲染——**空图态=图区消失**）。

**① 分层布局算法 `flowLayout`**（:1624-1660）：
- 只保留两端节点都存在的边（:1630-1634）。
- 层号 = 沿边方向的最长路径松弛：所有节点 level 初始 0；反复扫描边，若 `level[from]+1 > level[to]` 且 `next <= nodes.length` 则提升 `level[to]`（环保护：上限 nodes.length + 外层 pass 上限 `nodes.length + 2`，:1635-1647）。
- 同层节点按**数组原序**排入同列 `columns[depth]`（:1648-1654），`maxLevel` 取最深列（:1655-1658）。
- 无拓扑排序交叉最小化、无同列去环特判（回边会把目标压到更深列——静态推导，FACT 公式如此；运行观感 INFERENCE）。

**② 节点盒子**（:1681-1685, :1786-1846）：
- 尺寸常量：`BOX_W=168, BOX_H=56, COL_GAP=76, ROW_GAP=18, PAD=12`（:1681-1685）；画布 `graphW = 2*PAD + (maxLevel+1)*BOX_W + maxLevel*COL_GAP`，`graphH = 2*PAD + maxRows*BOX_H + (maxRows-1)*ROW_GAP`（:1699-1700）。位置 `x = PAD + depth*(168+76)`，`y = PAD + row*(56+18)`（:1693-1696）。
- 卡片主体：`<rect rx=9>`，填充 bgLayer2；边框 `node.status==='failed'` 时 error 色 **2px**，否则 borderL1 **1.2px**（×缩放补偿，:1786-1796）。
- **类型色条**：左侧竖条宽 5px（x+6 → x+11，全高内缩 1px），填充 `typeColor(type)`、opacity 0.9（:1797-1804）。`typeColor`（:1390-1397）：session→brand；condition/judge→warn；human_gate→error；join→success；code→labelSecondary；其余→borderL2。
- 文本行（LOD 分级，见 ④）：`id`（x+19, y+21，**13px/700**，labelPrimary，**截断 18 字符** :1810）；类型+状态行（y+38，11px/600：类型用 typeTone 色，`'· ' + 状态中文名` 用 statusTone 色，x 偏移 `19+4+typeLabel.length*11` 手工排 :1830）；次级信息行（y+50，10px labelSecondary：`尝试 N · 耗时 · 错误码` 以 `' · '` 连接、**截断 40 字符** :1843）。
- failed 退化标记：右上角实心 error 圆（cx=x+W-12, cy=y+13, r=6×补偿）+ 反白 `'!'`（9px/700，bgLayer1 色，:1811-1816）。
- 节点类型中文标签 `NODE_TYPE_LABELS`（:1593-1604）：start 起点 / end 终点 / session 会话 / condition 条件 / join 汇聚 / code 代码 / judge 判定 / human_gate 人工门禁 / loop 循环 / supervisor 监督。

**③ SVG 边样式**（:1725-1772, :1944-1962）：
- 路径：三次贝塞尔，起点右边中点 `(x1+W, y1+H/2)` → 终点左边中点（终点回退 8px 留箭头位）（:1733-1742）。前向边（`x2 > x1+8`，:1737）控制点 `c1x = x1 + max(36, min(dx*0.5, 160))`、`c2x = x2 − 同式`；回边退化为 `±70`（:1738-1741）；控制点 y 加扇出弯折。
- **扇出避让**：同源多出边按序号弯折 `bend = (offset − (total−1)/2) × 14` px，c1y 全量、c2y 打 4 折（:1702-1708, :1730-1741）。
- **已走/未走**：`edge.selected` 真时 = brand 实线、线宽 2.1×补偿、**无虚线**、实心箭头 `#flow-panel-arrow-on`、opacity 1；假时 = labelSecondary **虚线 `'7 5'`×补偿**、线宽 1.3×补偿、空心箭头 `#flow-panel-arrow-off`、opacity 0.85（:1747-1752）。
  - ⚠ **INFERENCE**：`edge.selected` 在客户端**只读不写**（grep 全文仅 :1747-1752 读取）——即「已走」标记由宿主 run.edges 数据自带，客户端不按节点状态推导。W2 需决定本仓语义（我们 DAG 是静态依赖，见 §5 第 11 条）。
- **箭头 marker 三枚**（:1944-1962）：默认/未走空心（`M0.5,0.5 L6.5,3.5 L0.5,6.5 z`，bgLayer1 填充 + labelSecondary 描边 1.2，9×9 refX7 refY3.5，:1957-1961）；已走实心（`M0,0 L6,3 L0,6 z`，brand 填充，8×8 refX6 refY3，:1952-1956）；未选默认（同实心形状但 borderL2 填充，:1948-1951）。
- **join 入边顺序号**：目标是 join 节点的入边按声明序编号，贝塞尔中点（t=0.5，:1663-1667）画 r=9×补偿 圆（bgLayer1 填、borderL2 描）+ 10px/600 labelSecondary 数字（:1710-1718, :1755-1771）。

**④ 缩放平移交互**（:1849-1894, :1900-1930）：
- zoom state 初始 1，clamp **[0.25, 2.5]**（:1851）；`scaleComp = 1/max(zoom, 0.25)` 做线宽/字号反向补偿（:1723），保证缩小时线条视觉粗细恒定。
- 滚轮：**仅 Ctrl/⌘+滚轮**生效（:1869），每档 ×/÷ **1.12**，以指针为锚修正 scrollLeft/scrollTop（:1849-1877）。
- 拖拽平移：左键按下记锚点 + `setPointerCapture`，move 反写 wrap.scrollLeft/Top（:1878-1894）；视口 `cursor: grab`、`touch-action: none`（:932-933）。
- 工具栏 4 按钮（graphBtn：padding `2px 8px`、圆角 6px、边框 borderL1、背景 bgLayer2、11px/18px，:913-923）：`缩小 −`（÷1.2）、`放大 ＋`（×1.2）、`适应宽度`（`(clientWidth−8)/graphW` clamp [0.25,2] 并回零滚动 :1860-1867）、`100%`（:1903-1906）；后缀提示 `'Ctrl/⌘+滚轮 缩放 · 拖拽平移 · 虚线=未走的边'`（:1907）。
- LOD：`showLabels = zoom ≥ 0.5`（类型/状态行 + join 序号）、`showDetail = zoom ≥ 0.85`（次级信息行）（:1721-1722）。
- 容器：`section` 外框（:1898）+ 标题 `'流程图（只读 · N 节点 / M 边 · 缩放 X%）'`（:1899）+ 图例条 `graphLegend`（11px labelSecondary，gap 10px，:935-942；内容 :1912-1918：● 成功/失败/跳过/运行中-待执行、实线已走边、虚线未走边、类型清单）+ `graphViewport`（borderL1 框、圆角 8px、bgLayer1 底、maxHeight 520px，:924-934）。内层按 `graphW×zoom / graphH×zoom` 撑开滚动区域，svg `viewBox` 恒为逻辑尺寸（:1931-1943）。
- 单节点退化（静态推导，FACT 公式）：maxLevel=0 → `graphW = 24+168 = 192`、无边渲染，正常出卡片。
- 死样式备注：`graphWrap`（:896-903）零引用（grep 核查），FlowGraph 实际用 `section`+`graphViewport`，W2 不要照抄 graphWrap。

### 3.5 NodeRow 节点行（FACT）

组件 :1500-1529。**注意：不是表格行，是纵向堆叠卡片行**（Detail「节点（N）」区内逐个 `nodeRow`，按 `detail.nodes` 数组原序、无排序/分组逻辑 :2039-2041）。

- 行样式 `nodeRow`（:1256-1263）：上边框 1px solid borderL2（行间分隔线）、paddingTop 6px、marginTop 6px、flex column、gap 3px。
- 头行 `nodeHead`（flex、center、gap 8px、**可换行 wrap**，:1264-1269）列清单（依序）：
  1. `node.id`（mono 11px，:1511）
  2. `<Badge status>`（:1512，样式见 §3.2）
  3. dim 灰串（:1513-1519）：`<type>` + （attempts>1 时）`' · attempt <N>'` + （有 durationMs 时）`' · <formatMs>'`
- 元信息行 `nodeMeta`（labelSecondary、11px、break-all，:1270-1274）：`'error=<errorCode>'` + （有 message 时）`' · <errorMessage>'` + `' · 会话 '` + `<SessionCell/>`（:1521-1526；sessionId 空显示 `'—'` :1501-1504）。
- **SessionCell**（:1481-1498）：`inlineActions` 容器（inline-flex、gap 6px、marginLeft 4px，:1275-1280）内 = `<code>`（codeText：11px 等宽、labelPrimary、**user-select: text** :818-823）+ 复制按钮（`linkButton`：height 20px、padding `0 6px`、圆角 5px、边框 borderL2、背景 bgBase、**brand 色字**、`500 11px`，:834-843）。点击 `navigator.clipboard.writeText`（:273-293），按钮文案反馈：成功 `'已复制'` / 失败 `'复制失败'`，**1500ms 后复原为 `'复制'`**（:1484-1491）。
- 输出预览：`typeof node.outputPreview === 'string'` 才渲染 `<pre>`（:1527），样式 `pre`（:1281-1294）：margin `2px 0 0`、padding `6px 8px`、圆角 6px、**背景 bgBase**、边框 borderL2、labelPrimary、等宽 11px、`pre-wrap` + `break-all`、**maxHeight 180px 自滚**。

### 3.6 EventRow 事件行（FACT）

组件 :1531-1542；单行样式 `eventRow`（上边框 borderL2、padding `5px 0`、break-all，:1295-1299）。内容依序（全部同一行内联 + 换行 payload）：
1. `'#<seq>'`（mono，:1535）
2. `event.type`（`eventType`：**brand 色 + 等宽**，:1300-1303）
3. `event.nodeId`（存在时前置空格接排，:1538）
4. `event.ts`（存在时 `' · <formatTs UTC>'`，dim，:1539）
5. 第二行 `eventPayload`：`payloadPreview || ''`（labelSecondary、等宽 11px、pre-wrap、break-all，:1304-1310）。

事件数据面（FACT）：`GET /flow-panel/runs/<id>/events?since=<lastSeq>&limit=200`（:198-201, `EVENT_LIMIT=200` :45）**增量合并**、缓冲上限 **400 条**（超出裁掉最旧，`EVENT_BUFFER_MAX=400` :46，:607-610）；redacted 标记整体置「已隐藏」（:620, :2079）。

### 3.7 PendingGates 待办区 + DecideModal 决策模态（FACT 记录结构；本仓暂无 gates 写面 → W2/W3 标 N/A）

- **PendingGates**（:2180-2245）：`pendingSection` 容器（§2.2）→ 头行 `pendingHeader`（baseline 两端对齐 :974-979）：`'待办（N）'`（`pendingTitle` 600/12px :980-984）+ 右侧更新时间 dim → 卡片列表 `pendingList`（column gap 6px :985-989）。每卡 `<button>` `pendingCard`（:990-1000：padding `6px 8px`、圆角 8px、**warn 色边框**、bgLayer2 底、cursor pointer）：上行 `pendingPrompt`（600/12px，prompt 单行摘要 **60 字符**截断 `promptSummary` :243-248）+ `pendingBadge`『待决策』（:2213-2214）；下行 `pendingMeta`（labelSecondary 11px）：`'run <runId> · node <nodeId> · 剩余 <formatRemaining>'`（:2218-2224；剩余时间中文短格式 天/小时/分/秒 :228-240）。
- **DecideModal**（:2252-2556）：page 内绝对定位浮层（§2.2）；`modalCard` 宽 `flex '0 1 560px'`、圆角 10px、bgBase 底（:1028-1041）；内容序：标题+关闭 → fieldGrid 四字段（runId/flow/节点/剩余倒计时 :2452-2462）→ `'prompt 全文'`（`modalPrompt`：等宽 11px、bgLayer1 底、maxHeight 160px 自滚 :1058-1071）→ 决策按钮行（`choiceButton`：height 26px、padding `0 12px`、圆角 6px、brand 边+brand 字、bgLayer2 底；提交中换 `choiceButtonDisabled` 灰 :1078-1097；文案 `approve 通过 / reject 拒绝 / amend 修正变量` :1436）→ submitting/serverError/localError 行（INFO 类错误码走 warnLine 黄、其余 formError 红 :1137-1153, :2488-2497）→ rationale textarea（:1098-1109）→ amend 变量白名单输入行（`amendLabel` 左 40% 等宽省略 + input :1122-1136）→ `'超时后果'` hintLines（直译 host timeoutHint :1445-1460）→ `'上游输出预览'`（同一 run 已加载时取最后 succeeded 节点 output ≤400 字符 :1462-1479）。本地 1s 倒计时 tick + Escape 关闭（:2267-2295）。

---

## §4 交互清单（FACT 除注明外）

| # | 交互 | 行为 | 证据 |
|---|---|---|---|
| 4.1 | **点击 run 卡片** | `controller.select(runId)`：置 `selectedRunId`；**清空** detail/events/lastSeq/redacted/error；`detailLoading=true`；立即并行 `refreshDetail()` + `refreshEvents()`。列表卡片即时高亮（runItemActive）。布局不变（左列仍在） | :680-693, :1556-1566 |
| 4.2 | **返回列表入口** | **不存在**——左右同屏无返回概念。overlay 降级模式有 `关闭` 按钮 + `Escape` 全局键关面板（`store.set({open:false})`）；右侧栏模式的关闭归宿主 tab 管理，面板内无关闭钮 | :2147-2157, :2108-2123, :2578-2632 |
| 4.3 | **手动刷新** | 页头 `刷新` 按钮 → `refreshAll(true)`：强制刷 gates + 列表；选中 run 时同时刷 detail + events | :2589-2599, :635-655 |
| 4.4 | **自动轮询** | `POLL_MS = 1500`（:43）。面板挂载即 `start()`（:2567-2577）：每 1.5s `refreshAll(false)`；**detail+events 每两拍刷一次**（`ticks % 2 === 0` ≈ 3s 节流，:639, :644-646）；首拍立即 `refreshAll(true)`（:665）。卸载 `stop()` 清定时器 + abort 全部在途请求（:668-678） | :657-666 |
| 4.5 | **gates 独立轮询** | 入口 pill 与页面**共享**一个 1.5s interval，引用计数（多实例末位才停，:532-556）；pill 挂载即开 watch（:2656-2664）。gates 失败只落 `gatesError`，不影响 run 列表语义（:640） | :532-556 |
| 4.6 | **缩放平移** | 见 §3.4 ④（Ctrl/⌘+滚轮 ×1.12、拖拽、4 按钮、clamp 0.25–2.5、指针锚定） | :1849-1894 |
| 4.7 | **hover / 选中高亮** | **无自定义 hover**（§1.4）；选中=卡片 brand 边框 + bgLayer2 底（:1200-1210）；图节点/边**不可点击**（svg 无 onClick，FACT——grep 无节点点击处理） | :1200-1210, :1773-1847 |
| 4.8 | **加载失败表现** | 四路错误各自就地显示：listError→列表区 empty 块（:1547）；detailError→详情区（:1975）；eventsError→事件区 dim（:2082）；gatesError→待办区 dim（:2187）。**不弹 toast、不清空已有数据**（错误只写 error 字段，旧 runs/detail 保留渲染）。AbortError 静默吞掉（:442-444）。组件级崩溃由 ErrorBoundary 兜底（:2691-2717） | :376-381, :1546-1553 |
| 4.9 | **复制 sessionId** | 见 §3.5（clipboard API + 1.5s 文案反馈） | :1481-1498 |
| 4.10 | **决策提交**（本仓 N/A） | 提交中全按钮禁用；成功→就地成功卡 + 自动刷 gates/list +（若选中对应 run）detail/events（:485-499）；已裁决/过期/凭据类错误码按「提示+刷新」处理不报红（INFO_DECIDE_CODES :1426-1433, :506-527） | :2308-2349 |
| 4.11 | **打开入口** | pill 点击→优先 `sidebarRight.openTab('flow-runs')`；宿主无该服务→降级 overlay（`store.set({open:true})`，可见降级带 warn 日志，:2640-2652, :2853-2859）。面板挂载即轮询、卸载即停（:2567-2577, :2098-2107） | :2641-2652 |

INFERENCE（4.7 补充）：图卡片 hover 是否有宿主级 cursor 变化——视口整体 `cursor: grab`（:932），节点无独立 hover 态（FACT 无代码）；拖拽中抓手是否变 grabbing 未实现（源码无 cursor 切换）。

---

## §5 parity 对照清单（flow 特性 → Tree Runs v2 映射）

> 优先级：**P0** 必做（用户「同布局同功能」直接要求或布局前提）；**P1** 可选（有价证券，数据/语义需适配）；**N-A** 不适用（本仓无对应语义）。「本仓」指 dsh-tree-harness 的 Tree Runs 面板 v1→v2；树数据面 = `tree_status overview`（树/节点计数）、`tree_node list`（leaf 清单：role/taskType/status/session_id/依赖）、`tree_log events`（事件尾）、`tree_status sessions`（预算）、journal 完整性（hash 链 + 外部锚点，同 flow_status 的 integrity 概念）。

| # | flow 特性（证据） | Tree Runs v2 映射建议 | 级别 | 理由 |
|---|---|---|---|---|
| 1 | 入口 pill 视觉全套（§1：26px 胶囊/600 12px/dot/badge，:744-771, :2654-2689） | Tree Runs 入口 pill 逐值复刻，文案换 `Tree Runs`，dot 保留 | **P0** | 用户点名「同字体同背景色块」 |
| 2 | pill 激活态 pillActive（:758-771） | 复刻样式；语义可改为「面板聚焦/打开中」 | P1 | flow 中该态仅 overlay 模式可见（:2672），右侧栏模式永远常态 |
| 3 | pill 待办角标 `N 待办`（:951-962, :2665-2687） | N/A（可留挂点） | **N-A** | 本仓暂无 gates/人工决策写面（任务书明示） |
| 4 | 左右分栏同屏（§2.1：pageList 36% clamp 150–320px + pageDetail flex1，:868-895, :2608-2613） | 列表区（run/树列表）+ 详情区同屏；宽度体系照抄 | **P0** | W2 布局前提，任务书点名 |
| 5 | 页头：标题 + `更新 <UTC>` + 刷新按钮（:858-867, :2584-2599） | 照抄三件套；标题 `Tree Runs · 只读…` | **P0** | 同布局 |
| 6 | 页脚只读声明（:943-949, :2614-2620） | 照抄样式；文案换本仓数据来源声明 | P1 | 信息价值可保留 |
| 7 | RunList 两行卡片（§3.1：runId mono + Badge / meta 行，:1544-1585, :1189-1222） | 树列表卡片：`treeId` mono + Badge；meta 行 = `leaf 汇总（active/segment_pending/pending_brief/done） · integrity=<state> · errorCode?` | **P0** | 直接对位 |
| 8 | 选中态 runItemActive（brand 边 + bgLayer2 底，:1200-1210） | 照抄 | **P0** | 同交互 |
| 9 | Badge 描边胶囊样式 + statusTone 四色归并（:1399-1410, :1380-1387） | 本仓状态映射：`running`→warn、`succeeded`→success、`failed`→error、`pending_brief`/`pending`→labelSecondary、`segment_pending`→warn（与 interrupted 同族）、未知→labelSecondary | **P0** | 用户点名四态对齐；样式逐值复刻 |
| 10 | Detail 字段栅格 fieldGrid + Field（§3.3，:1235-1255, :1416-1423） | Tree Runs run 字段区：`treeId`(mono)/`status`/`root goal`/`leaf 总数`/`integrity`/`storage root`(mono)/`journal`(mono)/`创建·更新时间`/`耗时`/`sessions` 等，栅格参数照抄（minmax 260px, gap 4×16） | **P0** | 用户点名字段栅格 |
| 11 | FlowGraph 分层 DAG（§3.4 ①②：最长路径松弛、168×56 盒、类型色条） | **树图区**：本仓 `dependencies` DAG 用同一算法（dependencies 天然无环，环保护保留兜底）；节点=leaf，盒子文本=leaf_id/role/状态；类型色条可映射 role（commander→brand、worker→labelSecondary、auditor→success，或按 taskType） | **P0** | 用户点名树图区 ↔ nodes/edges |
| 12 | 边已走/未走双态（brand 实线 vs 灰虚线，:1747-1752） | 语义改造：本仓依赖是静态的，「已走」可映射 `done 的上游依赖边`（from.status==='done' && to 已活跃），或 v2 先全实线+端点状态色 | P1 | 数据语义不同；`edge.selected` 客户端不推导（INFERENCE，:1747-1752）——本仓建议**客户端按 leaf status 推导**，比 flow 更进一步 |
| 13 | 扇出避让 bend（:1702-1741） | 保留（指挥官扇出 3+ worker 常见） | P0 | 实现成本低、观感必要（随 11 附带） |
| 14 | join 入边序号圆（:1710-1718, :1755-1771） | N-A | **N-A** | 本仓无 join 汇聚节点语义 |
| 15 | 缩放平移全套（Ctrl/⌘ 滚轮/拖拽/4 按钮/clamp/LOD，:1849-1930） | 照抄全套含 0.5/0.85 LOD 阈值 | **P0** | 用户点名「同功能」；实现自包含 |
| 16 | failed 红边卡 + `!` 角标（:1786-1816） | failed leaf 同款 | **P0** | 随 11 附带 |
| 17 | 图例条 graphLegend（:935-942, :1909-1919） | 照抄结构，文案换本仓状态/角色 | P1 | 随图附带成本低 |
| 18 | NodeRow leaf 行（§3.5：id+Badge+type·attempt·耗时 / error 行+SessionCell / pre 预览，:1500-1529） | **leaf 表**：每 leaf 一行——`leaf_id`(mono)+Badge(status)+role·attempt·耗时；第二行 `error=<code> · 会话 <SessionCell>`；done 摘要/outputPreview 用同款 pre | **P0** | 用户点名 leaf 表 ↔ NodeRow |
| 19 | SessionCell 复制按钮（:1481-1498, :834-843, :818-823） | 照抄（本仓 leaf 有 session_id；连 1.5s 反馈文案一起抄） | **P0** | 任务书点名 |
| 20 | outputPreview pre（180px 自滚，:1281-1294） | leaf done meta 摘要截断展示（≤400 字符先例 :1475） | P1 | 数据面：本仓需约定从 tree_log done.meta 取 preview |
| 21 | EventRow 事件尾（§3.6，:1531-1542）+ since 增量合并 400 上限（:599-633） | **事件尾区**：`tree_log events` 投影（brief_echo/plan/progress/done…），`#seq + type(brand mono) + leaf_id + ts` 结构对齐 | **P0** | 用户点名事件尾 ↔ EventRow |
| 22 | 门禁区 / PendingGates / DecideModal（§3.7） | N/A | **N-A** | 本仓无 gates 写面（任务书明示）；结构记录已留 §3.7 备未来 |
| 23 | 完整性未通过错误区块（:1985-1993：不渲染 output/节点） | 映射本仓 journal 完整性（hash 链/锚点 FAIL 时详情降级） | P1 | 本仓有对应概念（flow_status integrity 同源思想） |
| 24 | `outputs 摘要（2 KiB 上限）` 区（:2065-2072） | 树级「结论/产出摘要」区 | P1 | 价值有，非布局必需 |
| 25 | 轮询节奏 1.5s / detail 3s / gates 1.5s（:43, :639, :532-556） | 照抄 1.5s 列表轮询 + 3s 详情节流；gates 路径删除 | **P0** | 同功能；节流保护数据面 |
| 26 | AbortController 全量取消 + 卸载即停（:338-374, :668-678） | 照抄（防卸载后 setState/请求悬挂） | **P0** | 工程正确性，成本低 |
| 27 | ErrorBoundary 四席位兜底（:2691-2717） | 照抄（pill/面板/list/detail 各包一层亦可） | **P0** | 宿主安全惯例，便宜 |
| 28 | 空态 dashed 框 + 存储根提示（:1321-1326, :1548-1553） | 照抄；空态提示本仓存储根/runs 目录 | **P0** | 同布局空态 |
| 29 | overlay 降级（shell.overlay fallback，:2853-2859）+ Escape 关闭（:2108-2123） | N-A（本仓宿主已有 sidebarRight；v1 已是页面形态） | **N-A** | 本仓无需 overlay 路径；Escape 可作 P1 键盘细节 |
| 30 | 「只用 14 个 token、无字面色」纪律（:26, :57-77） | **沿用同 14 token**（同一宿主主题体系）；禁止字面色 | **P0** | 保证宿主主题一致性，用户点名的「同背景色块」前提 |
| 31 | 字体体系（12px 基准 / 11px 次级与等宽 / 13px 标题 / 等宽栈，§0） | 照抄全套 | **P0** | 「同字体」要求 |
| 32 | 死样式排除：`graphWrap`(:896-903)/`dot`(:772-778)/`banner`(:1311-1315) 零引用 | W3 不要照抄这三个 style 键 | P1 | grep 核查事实，防无脑移植引入死代码 |

---

## 附：FACT / INFERENCE 计数与自检

- **FACT 证据规模（可验证口径）**：显式 **FACT** 标注 **32** 处；全文 `file:line` 值引用 **约 380 处**（§0 全部 14 token + 3 字体栈；§1 逐键表 + CSS 转写；§2 全部布局值与三态文案；§3 全部组件键值/公式/字段清单；§4 交互表；§5 checklist 证据列——凡带 `:N` 者均为 FACT 证据）。
- **INFERENCE 条目**：**4** 处，均已行内标注——① pill hover/焦点环的浏览器默认渲染（§1.4）；② `edge.selected` 由宿主数据提供、客户端不推导（§3.4 ③）；③ flowLayout 回边下观感（§3.4 ①）；④ 拖拽中 cursor 不变 grabbing（§4.7 补充）。
- **关键结论复核**：列表与详情**左右分栏同屏**（§2.1，7 条证据链）——W2 可直接以此为布局前提。
- **死样式**：`graphWrap` / `dot` / `banner` 已 grep 确认零引用（§5 第 32 条）。
