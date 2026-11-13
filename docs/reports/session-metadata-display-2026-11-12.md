# 所有会话显示「模型 / 思考强度 / 上下文占用」研究报告（2026-11-12）

> 任务：共享任务板 `task-8`。执行者：teammate `session-ui-research`。
> 环境：DSH 桌面 `0.2.2-rc.1`（asar package.json）· checkout `D:\DSHarness\resources\app.asar\dsh\` · GUI `http://127.0.0.1:9398` · 仓库 `D:\Codes\dsh-tree-harness`（session-tree **v1.3.7**；研究基线；Q4 后当前为 **v1.4.0**，client 半未变）。
> 证据：本仓源码行号 + asar 反编译行号 + **真实会话日志**（`%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\`，210 个 `.jsonl.zstd`，多帧 zstd，已解码扫描）。
> scratch：`D:\Codes\_composition-research\session-ui-probe\`（`asar-extract.cjs` / `decode-session.cjs` / `scan-headers.cjs` / `scan-coverage.cjs` / `scan-pressure.cjs` + `extracted/`）。
> 纪律：只读其他文件；**未改 `packages/**`**、未改 profile、未 reload、未 commit。本文件是唯一写入（+scratch）。
>
> **⚠ 2026-11-13 用户修正（task-10）**：**不要在左侧会话树显示** model/effort/context，改到**会话详情页底部**（composer 区）。因此本文 §3–§5、§8 的「树行徽标」方向已**作废**（Lead 负责移除已加的树行 `st-meta`）；**权威方案见 §9「修正：改到会话界面底部 + 子会话为何不显示」**。§1（数据源）、§2（覆盖）仍然有效。

---

## 0. 结论先行

| # | 问题 | 判决 | 一句话依据 |
|---|---|---|---|
| 1 | **数据是否可得** | **PASS** | `model/provider/reasoningEffort/contextWindow/pressureTokens` 全部有**客户端可读投影**：`modelSelection`、`contextPressure`、`agentPreset`、`tokenUsage`（`SessionProjectionMap`，asar `dsh-api-session-controller/lib/typert.host.js` 同名声明）；日志侧另有 `request/header` / `request/context` / `assistant/message.usage` 三重事实源。 |
| 2 | **所有会话类型是否覆盖** | **PASS（同一数据面）** | 210 个真实日志：root=9、subagent=201（continuable=170 / one-shot=31），全部是同一 Session/同一投影面；**206/210** 具备 contextPressure 的两个输入，**209/210** 有 model（其余 4 个为空白/未完成回合会话）。 |
| 3 | **展示机制** | **PARTIAL→可补齐（纯 client 半）** | 左树行数据**已经在 props 里**（`byId[id].projectionValues` / `projectionsBySession[id].values`），当前 `norm()` 只取标题/标签（`client.js:424-471`），**丢弃了 model/context 字段**；标题栏有现成可注入槽位 `conversation.session.header.utilities`（list/session scope，`dsh-cordis-client-runner` slot 合同）。 |
| 4 | **实时性** | **PASS（事件推送，无需轮询）** | 宿主 control 流推送投影：连接 baseline 为**全量** `snapshot(session)`（`dsh-api-session-controller/lib/index.js:1067-1080`），此后每事件 `projection` 帧带 `changes`（`:1032-1039`）；客户端 `handleControlFrame→store.apply` 直接刷新（client 同文件 ≈3465+）。 |
| 5 | **最小可靠方案（MVP）** | **纯 client 半，0 host 改动** | 改 `packages/dsh-session-tree/client.js`：`norm()` 透出 `modelSelection/contextPressure/agentPreset` → `buildRows` 派生徽标 → 行渲染 + 对可见行做**有上限的** `ctx.sessions.refreshProjections(id)` 预热；标题栏用 `conversation.session.header.utilities` 二次注入。**不需要新 RPC**。 |
| 6 | **还缺什么** | 3 项（均不阻塞 MVP） | ① 冷会话的 `contextPressure` 不在摘要列（`wire.summary:false`），需逐会话全量投影读（有成本，需限额/懒加载）；② 无插件级「新增 Remote endpoint」证据（端点是 `@deepseek-ai/dsh-api-*` 生成物）→ 批量接口属核心改造 UNKNOWN；③ one-shot 子会话 descriptor 不带 model，需等第一次 `request/header`。 |
| 7 | **工作量** | **MVP ≈ 1 人日**（client 4–6h + 测试 2–3h + 收尾）；标题栏 chip +2–3h；增强（批量/持久缓存）+1–2d（依赖核心 API 结论） | 见 §5 |

**一句话**：用户要的「每个会话显示模型 + 思考强度 + 上下文占用」**不需要宿主改协议**——数据本来就在 `useSessions` 的行投影里（model/effort 甚至在列表摘要里），只是 `dsh-session-tree` 当前没渲染；唯一要额外做工作的是冷会话的上下文百分比，用已有的 `refreshProjections` 逐行预热即可诚实展示，拿不到时显示 `—` 而不是编造。

---

## 1. 数据从哪来（逐字段证据矩阵）

### 1.1 权威投影（host 侧定义，client 侧可读）

`SessionProjectionMap`（asar `/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js`，`"name": "SessionProjectionMap"` 的 declaration 原文）明确列出 23 个投影键，本需求相关：

```text
modelSelection: ModelSelectionProjection
agentPreset: string | null
tokenUsage: TokenUsageProjection
contextPressure: SessionProjectionSummaryExcluded<ContextPressureProjection>
contextBreakdown: SessionProjectionSummaryExcluded<ContextBreakdownProjection>
subagentCatalog / subagentTiming / subagent / permissions / workingDirectory / title / ...
```

| 需求字段 | 权威来源（host） | wire 形状（原文） | 是否进「会话列表摘要」 | 客户端读取路径 | 日志事实源 |
|---|---|---|---|---|---|
| **provider / model / reasoningEffort** | `modelSelection` 投影（`dsh-agent/lib/index.js:141-171` `modelSelectionProjectionDefinition`） | `{lastUsed: {provider, model, reasoningEffort?}\|null, next: {...}\|null}`；`lastUsed`=最近一次已记录请求用的选择，`next`=下一模型步骤将用的选择（无记录时 null） | **是**（未标 `summary:false`）→ `byId[id].projectionValues.modelSelection` | `useSessions((s)=>s.byId[id].projectionValues.modelSelection)`；全量投影读后也在 `projectionsBySession[id].values.modelSelection` | `request/header` 事件 `data.header.config.{provider,model,reasoningEffort}`（真实日志 seq14 样例见 §6.3）；continuable 子会话另有 `subagent/descriptor.agentProvider/agentModel/agentReasoningEffort` |
| **思考强度缺省语义** | 同上 `selectionOfHeader`：`adapterDefaults.reasoningEffort === true` 时**省略** effort（= 走 adapter 默认） | `reasoningEffort` 可缺省 | 是 | 缺省 → UI 显示「default / 提供商默认」 | 真实日志：88/210 个 `request/header.config` 无 `reasoningEffort`（如 `glm-5.3` 会话） |
| **agentPreset（工作模式）** | `agentPreset` 投影（`dsh-agent-preset-registry/lib/index.js:49-60`） | `string \| null` | 是 | `byId[id].projectionValues.agentPreset` | `session` header.agentPreset / `agent-preset/selected` 事件 |
| **上下文占用 %** | `contextPressure` 投影（`dsh-token-meter/lib/index.js:449-500` `contextPressureProjectionDefinition`） | `{contextWindow?, pressureTokens?, projectedTokens?}`；`pressureTokens`=prompt 侧（input+cacheRead+cacheWrite），`projectedTokens`=按当前 surface 增量外推的下一次请求占用量 | **否**（`wire.summary:false`，`:495`；类型标注 `SessionProjectionSummaryExcluded`） | ① live 会话：control baseline/帧直接进 `projectionsBySession[id].values.contextPressure`；② 冷会话：`ctx.sessions.refreshProjections(id)`（= `remote.session.projections`）全量读后进同一 store；③ 已打开会话：打开流 `projections(observation)` 全量 seed 同一 store | `request/context.data.contextWindow`（分母）+ `assistant/message.data.usage`（分子：input+cacheRead+cacheWrite，见 token-meter `pressureFrom`） |
| **累计 token 用量（辅助）** | `tokenUsage` 投影（`dsh-token-meter/lib/index.js:394-446`） | `{uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}` | 是 | `byId[id].projectionValues.tokenUsage` | `assistant/message.data.usage` 折叠 |
| （已存在的 UI 口径） | `ContextMeter`（`dsh-client-ui-conversation/lib/client.js:21480-21540`） | — | — | `useProjection("contextPressure")` | **公式**：`usedTokens = projectedTokens ?? pressureTokens；percent = min(100, round(used/contextWindow*100))`；无 window 或 token 时**不渲染** |

> `summary:false` 的机制：投影注册时可声明 `wire.summary`，`dsh-session-projection/lib/index.js:125` 归一化（`summary: wire.summary !== false`），`:284-296 summaryKeys()` 只把非 `summary:false` 的键放进「会话列表摘要」；`:232-266 snapshot(session)`（不传 keys）返回**全部** client-visible 键。会话列表 RPC 用 `snapshot(session, summaryKeys())`（`dsh-api-session-controller/lib/index.js:2887-2897 projectionsFor`），而单会话 projections RPC 用全量 `snapshot(live)` / `observeSession(projection:true)`（`:1833-1850`）。

### 1.2 客户端 store 的行形状（已核实）

- 行状态：`SessionListState { ids, byId, phase, projectionsBySession }`、`SessionProjectionSnapshot { values: Partial<SessionProjectionViewValues>, state, error }` —— asar `dsh-cordis-client-runner/lib/client.js:2337-2346`。
- `byId` 行由 `projectList()` 组装：`{id, displayTitle, running, retainedBy, blank, updatedAt, formatStatus, projectionValues?, title?, cwd?, parentId?, origin?}` —— `dsh-api-session-controller/lib/client.js:4164-4204`；子代理目录行在 `:4210-4245` 并入（`origin:'subagent'`，`projectionValues` 可能为 `undefined`）。
- `projectionValues` = 该会话客户端投影 store 的 `values()`（summary 键 + 后续全量 seed 的并集）；`projectionsBySession[id].values` 是同一份 store 的视图 —— `:3459-3467`、`:3628-3638`。**两者都已在 `dsh-session-tree` 的 slot props 里**（`client.js:1022-1033`）。
- 打开任意会话会把该会话的**全量投影** seed 进同一个 store（客户端 `createSession` 复用 `projectionStore(sessionId)`，`dsh-api-session-controller/lib/client.js:3150-3185`；打开流带 `projections(observation)`，host `index.js:2509-2514`）→ **打开过的会话，其树行也立即有 contextPressure**。
- `tokenMeter.contextPressure(session)` / `measure(session)` 需要**活 Session 对象**（host 服务；`dsh-token-meter/lib/index.js:818-824`）。client 侧不能直接调；本仓 `index.js:308-388`（`session_handoff` 的 `collectFacts`）正是这么用的（`tokenMeter.contextPressure(session)` + `session.requestHeader().config` + 自己算 pct，`:332-335`），测试 mock 见 `test/handoff.test.js:59-61,123-124`。**这证明 host 侧路径可行，但树行不需要它**（见 §3.3）。

### 1.3 日志事件（durable 事实源，真实解码验证）

以 `2d632bb4-7060-477d-a58b-7b62a1024e1e/session.v4.jsonl.zstd`（continuable 子会话）解码为例（1.35 MB 文本，259 帧）：

| 事件 | 行/原文摘要 |
|---|---|
| `session`（第 1 帧，seq 0） | `{"type":"session","version":4,"id":"2d632bb4-…","createdAt":1794497300115,"cwd":"D:\\Codes\\dsh-tree-harness","parentSession":"session-bff3c54c-…","isSeeded":false,"origin":"subagent","delegationDepth":1,"agentPreset":"standard"}` ← **header 里没有 model** |
| `subagent/descriptor`（seq 0） | `{"version":3,"mode":"continuable","provider":"spawn","label":"研究会话模型/思考强度/上下文显示","agentProvider":"opencode-go","agentModel":"deepseek-v4.1-flash","agentReasoningEffort":"max"}` |
| `subagent/model-selection-policy`（seq 4） | `{"allowedModels":[{provider,model},…]}` ← **是允许清单，不是实际选择** |
| `request/header`（seq 14） | `data.header.config = {"provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"max","maxTokens":384000}`；`data.reason ∈ {initial,resume,change,series}`，`data.startsSeries?` |
| `request/context`（seq 15） | `{"provider":"opencode-go","model":"deepseek-v4.1-flash","contextWindow":1000000}` |
| `assistant/message`（51 条） | `data.usage = {"inputTokens":53981,"outputTokens":201,"totalTokens":54566,"cacheReadTokens":384}` |

root 会话（`session-bff3c54c-…`，header `delegationDepth:0`、无 `origin`、`agentPreset:"standard"`）另有 `agent-preset/selected`（seq 0，`{"agentPreset":"standard"}`），同样无 header model、模型在 `request/header`（`{"maxTokens":384000,"provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"max"}`）。事件生产者：`request/header` 由 `dsh-agent-loop/lib/index.js:1015-1045` 追加（`{header: canonicalHeader({config, adapterDefaults?, tools?}), reason, startsSeries?}`），`canonicalHeader` 定义见 `dsh-session/lib/index.js:604-615`；持久化事件流可用 host `sessionQuery.observeSession/readSession` 读取（`dsh-session-query/lib/index.js:1064-1075`、`:350-410`）。

---

## 2. 覆盖会话类型矩阵

对 `--D-Codes-dsh-tree-harness--` 全部 210 个日志做首帧/前 120 帧扫描（脚本见 §6.4）：

```json
{"total":210,"header":210,"descriptor":201,"descriptorModel":170,
 "modes":{"continuable":170,"one-shot":31},
 "origins":{"subagent":201,"root":9},
 "presets":{"cordis":114,"standard":94}}
// scan-pressure.cjs：contextWindow 209、usage 206、both 206、requestHeader.model 209、无显式 effort 88
```

| 会话类型 | 实例（日志头部证据） | model/provider/effort | agentPreset | 上下文占用 | 备注 |
|---|---|---|---|---|---|
| **root 会话** | `origin` 缺省、`delegationDepth:0`（9/210） | ✅ 9/9 首个 `request/header` 有 model；`modelSelection.lastUsed` 投影 | ✅ header + `agent-preset/selected` | ✅ 9/9（`request/context`+`usage`） | 空白会话无任何选择，显示空 |
| **tree leaf（continuable subagent）** | `origin:"subagent"`,`delegationDepth≥1` + `subagent/descriptor.mode:"continuable"`（170/210） | ✅ 169/170（唯一缺的是 0-turn 空白子会话）；descriptor **seq 0** 即带 `agentProvider/agentModel/agentReasoningEffort`（170/170）；首个 request/header 后以 `modelSelection.lastUsed` 为当前真相 | ✅ header | ✅ 166/170（3 个回合未完成 + 1 个空白） | 最完整的一类 |
| **flow 节点（一次性子会话）** | `mode:"one-shot"`（31/210），通常 `parentSession`=某 agent 会话 | ✅ 31/31 首个 `request/header` 有 model | ✅ header | ✅ 31/31（扫描窗口内） | descriptor **不带** agentModel/effort（31/31 只有 version/mode/provider/label） |
| **普通 subagent（spawn 一次性）** | 同 one-shot；`provider:"spawn"` | 同上 | ✅ | 同上 | 与 flow 节点同形 |
| **handoff successor** | 由 `sessions.create` 新建 → **root 会话**（无 origin、depth 0）；本仓 `index.js:941-1030` 的 `session_handoff` | ✅ 同 root（继承 provider/model/effort 由 handoff 显式传入，`index.js:581-599`） | ✅ | ✅ | 显示路径与 root 完全一致 |

**同一数据面结论**：五类都是同一种 Session，客户端显示路径**无需按类型分支**；差异只在「冷会话」的上下文占用需预热（§4）。

其它已确认的形状差异：
- 已归档/隐藏、pinned 等不影响字段；
- 子代理目录行（`subagentCatalog` 里但没有 `byId` 行）在 `:4210-4245` 合成，`projectionValues` 可能缺失 → 需 `refreshProjections` 补；
- 空白会话（`blank:true` / `sessionListMetadata.blank`，`SessionListMetadata` 定义见 `typert.host.js`）没有请求 → 空显示。

---

## 3. 展示机制

### 3.1 左树每一行（`packages/dsh-session-tree/client.js`，当前 2,043 行）

现状证据（**为什么现在不显示**）：

1. **行模型已经带 metadata 入参**：`TreeView` 读取
   `const byId = useS(sel => sel.byId)`、`projectionsBySession = useS(sel => sel.projectionsBySession)`（`client.js:1022-1023`），slot 合同也保证 `useSessions`（asar runner slot catalog：`sidebar.workspaces` standardProps 含 `useSessions/useSessionStatus/useSessionRetainInfo/useWorkspaces`）。
2. **归一化丢了字段**：`norm(key, raw)` 只取 `title/displayTitle/subagent.label/subagentCatalog/running/updatedAt/parentId/origin`（`client.js:424-471`）；`vals = r.projectionValues || r.projections.values`（`:426`）里的 `modelSelection/contextPressure/agentPreset` 被丢弃。
3. **行对象没有元数据**：`buildRows()` 产出的 session/subagent 行字段仅 `{key,kind,depth,id,parentId,mode,label,labelIsFallback,secondary,running,state,tag,expandable,expanded,childCount}`（workspace 分支 `:780-796`、flat 分支 `:950-966`、搜索分支 `:864-879`/`:929-936`）。
4. **行渲染没有槽位**：`client.js:1599-1694` 的 `body.map` 里依次是 `st-twist / st-dot / st-label / st-tag / st-count / st-aside / st-more`；CSS 段（`:53-107`）无 meta 样式。
5. **已有预热机制可复用**：`ensureLoaded(id)` → `ctx.sessions.refreshProjections(id)`（`:1111-1126`），`ensureChildTitles(parentId)` 以 6 个/60ms、`MAX_CHILDREN=300` 上限批量预热子行（`:1138-1166`）；`loadTitles()` 已直接调用 `remote.session.list({})`（`:1063-1096`）——说明 client 半调用该 RPC 是既有模式。

**建议行样式**（文字版原型，窄侧栏两段式）：

```text
▸ ● 研究会话模型/思考强度/上下文显示   [sub]   deepseek-v4.1-flash · max   38%
           └ label（省略号）                      └ 10–11px tertiary，hover title 展开 provider/preset/窗口
```

- `model`：`modelSelection.lastUsed?.model ?? modelSelection.next?.model`；无 → 不渲染（空白会话）。
- `effort`：同上取 `reasoningEffort`；**缺省显示** `default`（并入 title/tooltip，避免行宽爆炸）。
- `ctx`：`projectedTokens ?? pressureTokens` / `contextWindow`，取整 `%`、`min(100, …)`，与 `ContextMeter` 同口径（`dsh-client-ui-conversation/lib/client.js:21520-21534`）。无 window/token → 不渲染（诚实缺失）。

### 3.2 会话详情/标题栏：**有现成可注入槽位**

asar `dsh-cordis-client-runner/lib/client.js` 的 **slot 合同目录**（每个 slot 带 `kind/scope/standardProps/registerOptions/occupants/example`）中确认：

| slot | kind | scope | 结论 |
|---|---|---|---|
| `conversation.session.header.utilities` | **list** | session | ✅ **标题栏右侧 utility 区，追加式注入，零冲突**；`standardProps` 含 `sessionId`、`useSessions`、`useSession`、**`useProjection`**、`useConversation` 等；`registerOptions`: `id`(required)、`order`、`label`；示例即 `ctx.slots.inject(...ctx.slots.register({name,id,order},Component))`；现有 occupants 为 open-in-app / schedule / forge / liveshare / session-log-export |
| `conversation.session.header.lineage` / `.actions` / `.corner` | single/list | session | 可用但语义是标题/动作/角标，不建议承载 |
| `conversation.session.header` | single | session | 替换整块 header = 阴影官方 chrome，`replaceRisk` 高，**不做** |
| `conversation.header` | single | session-maybe | 常驻导航容器，**不做** |
| `conversation.composer.dock` | single | session-maybe | 已被 chat 的 ActivityPill/UsagePill 占用；**`ContextMeter` 已在下方面板**（`dsh-client-ui-conversation/lib/client.js:21480-21540`，读 `contextPressure`+`contextBreakdown`）→ 不要重复造 |

槽位声明处：`dsh-client-ui-conversation/lib/client.js:22917-22940`（`conversation.session.header` 的 children: lineage/actions/utilities/corner/views.actions）；渲染处 `:20893-20903`（`renderSlot("conversation.session.header.utilities", {})`）。**结论：标题栏 chip（model · effort · pct）是纯 client 半工作，无需 host 改动。**

### 3.3 若字段缺失，Host 侧扩展方案与风险

| 方案 | 做法 | 可行性/风险 |
|---|---|---|
| **A. 复用现有通道（推荐，MVP）** | client 半：`useSessions` 行投影（model/effort/preset/tokenUsage）+ `ctx.sessions.refreshProjections(id)`（冷会话全量投影，含 contextPressure）+ live control 帧自动更新 | ✅ 零 host 改动、零新 API；`refreshProjections` 是既有公开 client 服务（树已用）；单会话 `remote.session.projections` 既有 RPC（client store 内部同款调用，`dsh-api-session-controller/lib/client.js:3186-3220`） |
| **B. 插件 Host RPC/批量接口（增强）** | host 半 `index.js` 用 `sessionQuery.observeSession(id,{projectionMode:'all'})` + `tokenMeter.contextPressure` 批量产出 `{model,effort,pct}`，client 一次拉全表 | ⚠️ **无证据表明插件可新增 Remote endpoint**：endpoint 表是 `@deepseek-ai/dsh-api-*` 的 `typert.host.js`/`typert.remote-client.js` 代码生成物（如 `directoryPicker/pick`），client 合同目录只列 slots/hooks/inspect/remoteAccess，无 endpoint 注册面 → **UNKNOWN，按核心 UI/API 改造估算** |
| **C. 事件推送自定义通道** | host 发自定义 `ctx.remote.$on` 事件 | ⚠️ 已见事件名均为生成/声明式（`llm/adapters-updated` 等）；插件自定义事件注册面未找到 → **UNKNOWN**；MVP 不需要（B 的实时性已由投影帧满足） |
| **D. 改核心 UI 组件** | 官方会话列表/标题栏直接渲染 | ❌ 不属本仓可控；`sidebar.workspaces` 为 single、`priority:-100` 已由本插件 shadow，插件内自足即可 |

**版本/API 风险**：`contextPressure` 的 `summary:false` 是上游 wire 选择；本方案读全量投影，不依赖摘要口径，**若上游改为 summary 也不会坏**（只会更快）。键名 `modelSelection/contextPressure/agentPreset/tokenUsage` 在 `0.2.2-rc.1` 稳定；跨大版本需按 `stateVersion` 重新核对（`modelSelection` v3、`contextPressure` v5、`agentPreset` v1）。

---

## 4. 实时性与 MVP / 增强方案

### 4.1 实时性证据（事件推送，不是轮询）

| 环节 | 证据 |
|---|---|
| host 为**活/已 attach** 会话推全量 baseline | `dsh-api-session-controller/lib/index.js:1067-1080`：`projectionBaseline()` 对 `ctx.sessions.list()` 每会话 `sessionProjections.snapshot(session)`（**全量**，含 contextPressure） |
| 每提交事件推增量帧 | 同文件 `:1032-1039`：`onEventChanged((session, changes, seq) => broadcast({type:"projection", sessionId, seq, changes}))` |
| client 落地 | `dsh-api-session-controller/lib/client.js:3465-3480 handleControlFrame` → `projectionStore(sessionId).apply(key,val,seq)`（higher-seq-wins） |
| 树会自动重渲染 | store `subscribeAny → notifier.markDirty`；`projectionValues` 引用变化会重建 list items，`useSessions` 订阅者重渲染（`client.js:3628-3640`、`4130-4170`） |

**结论**：运行中会话的上下文 % 与 model/effort 变化会随 turn/step **自动刷新**，无需轮询。

### 4.2 冷会话的边界（必须诚实说明）

- 会话列表摘要**不含** `contextPressure`（`wire.summary:false`）；冷（未 attach、未打开）会话的树行初始只有 model/effort/preset/tokenUsage（若持久投影缓存有对应 `stateVersion` 的 row）。
- 补法：`refreshProjections(id)` → `remote.session.projections({sessionId})`：live 走全量 `snapshot(live)`，冷会话走 `sessionQuery.observeSession(projection:'all')`（host `index.js:1833-1865`，persistence stat + 日志准备 + LRU 缓存 `preparedSessionCacheSize=5`）。
- **成本**：冷读一次可能解压 1–6 MB 日志（本机 210 个日志中最大 6.6 MB）；并发 4；客户端 store 该 id 只加载一次/连接（`projectionLoads.state==='ready'` 后 `refreshProjections` 直接 resolve，`dsh-api-session-controller/lib/client.js:3186-3210`；树注释 `client.js:1050-1057` 也记录了这一「once per connection」行为）。
- 因此预热必须**限量**：只对「当前渲染的可见行 + 展开的子行」做，上限（如 300 行/连接，沿用 `MAX_CHILDREN`），失败静默降级为 `—`。

### 4.3 MVP 与增强的边界

| 方案 | 内容 | 归属 |
|---|---|---|
| **MVP（推荐）** | ① 树行显示 `model · effort`（来自摘要投影，所有行）；② 上下文 % 仅对「已有全量投影」的行显示（live 会话天然有；已打开会话 seed 后有；其余按需预热）；③ 标题栏 chip（model/effort/pct，`conversation.session.header.utilities`）；④ 缺失一律不渲染/`—`，hover title 给出 provider/preset/窗口/token 详情 | **纯 client 半**（`client.js` + `locale/*.json` + README/架构同步），无需 disable→enable（`docs/architecture/session-tree-ui.md:12`：client 半刷新页面即生效） |
| **增强 1（客户端可做）** | 预热策略升级：展开/悬停时按需、`localStorage` 上次已知值（标注 stale）、懒加载队列 + 失败重试退避 | client 半（1–2h） |
| **增强 2（需核心/API 结论）** | 批量 `{sessionId → model/effort/pct}` 接口，一次性覆盖全树（含冷会话），避免 N 次冷读 | host 半 + **新 Remote endpoint**（UNKNOWN：插件注册面未证实）或把 `sessionListMetadata` 类摘要扩展（核心改动） |
| **不建议** | 轮询 `remote.session.projections` 全表 | 冷读成本高、和事件推送重复 |

---

## 5. 实现计划

### 5.1 Patch 计划（file / function 级）

| # | 文件:位置 | 改动 | 说明 |
|---|---|---|---|
| 1 | `packages/dsh-session-tree/client.js:424-471` `norm()` | 透出 `modelSelection`、`contextPressure`、`agentPreset`（来源 `vals`，`vals = r.projectionValues \|\| r.projections.values`） | 纯派生，无副作用 |
| 2 | `client.js:486` 附近（`sessionState` 旁） | 新增纯函数 `metaOf(node)`：`{model, effort, modelLabel, pct, usedTokens, contextWindow, preset}`；公式对齐 `ContextMeter` | 可单测（无 DOM） |
| 3 | `client.js:780-796`（workspace 行）/ `:864-879`、`:929-936`（search/flat 行）/ `:950-966`（walk 行） | 行对象增加 `meta` 字段（`metaOf(n)`）；catalog-only 子行（`:570-585`）`meta=null` | 保持 `buildRows` 纯函数 |
| 4 | `client.js:1653-1659`（label/tag 之间） | 渲染 `<span class="st-meta" data-model=... data-effort=... data-ctx-pct=...>` + `aria-label`/`title` | 行宽不够时 CSS 隐藏 effort（`@container`/`.st-root` 窄宽规则），`title` 仍可见 |
| 5 | `client.js:84-107` CSS 段 | `.st-meta{flex:none;font-size:10px;...;max-width:…;overflow:hidden;text-overflow:ellipsis}`；`.st-ctx[data-level='warn']` 色 | 用既有主题变量（`--dsw-alias-label-tertiary` 等），遵守 `style-guard.cjs` |
| 6 | `client.js:1109-1181` 附近 | 新增 `ensureMeta(id)`（`useRef(new Set())` 去重 + 6 个/60ms 节流 + 总上限 300）；`useEffect` 对 `rows`（kind session/subagent 且 `meta` 缺 contextPressure）调用；**只在存在 `ctx.sessions.refreshProjections` 时** | 复用 `ensureChildTitles` 的批量节流模式；不阻塞渲染 |
| 7 | `client.js:186-281` DICT + `locale/en.json`/`zh.json` | 新文案：`model`、`effortDefault`、`contextUsage`、`contextUnavailable`、`loadingMeta` | `makeT` 双语文案规则（`docs/architecture/session-tree-ui.md:25`） |
| 8 | `client.js:2012` `inject` + `:2035-2037` apply 末尾 | （Phase 2）`ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({name, id:'session-meta', order:60}, HeaderMeta))`；`HeaderMeta` 用 `useProjection('modelSelection')/('contextPressure')`、`useSessions`、`sessionId` | 槽位合同见 §3.2；无需 host 半、无需改 package.json 的 `dsh.client.inject`（槽位注入自身等待声明方） |
| 9 | `packages/dsh-session-tree/package.json` | `version` 由 1.3.7 → 1.4.0（**与另一 teammate 的 index.js 1.4.0 冲突，Lead 统一 bump 一次**）；README「当前版本」同步 | 版本纪律 `session-tree-ui.md:18,63` |
| 10 | `docs/architecture/session-tree-ui.md:69-73` §6 + `docs/README.md` | 变更记录 + 新功能说明 | 文档纪律 §5 STEP 6 |

**明确不改**：`index.js`（host 半，另一位 teammate 正在改，避免冲突）、`cordis.patch.yml`、profile、不 reload。

### 5.2 测试计划

| 测试 | 内容 | 现状 |
|---|---|---|
| `node test/render.test.cjs` | 既有 90 条断言 + 夹具自检（沙箱加载真 `client.js`、合成 `byId` 图：深 4 层、>300 子行、归档/pinned/孤儿/环） | 新增夹具行带 `projectionValues.modelSelection/contextPressure/agentPreset`；断言：有值 → 行文本含 `model · effort`/`NN%`；缺 effort → `default`；缺 window → 不渲染 pct；catalog-only 子行不崩；`meta` 不改变既有行序/层级/box |
| `node test/style-guard.cjs` | 样式注入 + 自愈守卫 | 追加断言：注入的 CSS 文本含 `.st-meta{`、`.st-ctx{`；行高/缩进规则未被破坏 |
| 新增 `test/meta.test.cjs`（或并入 render） | 纯函数 `metaOf` 边界：`lastUsed` 优先于 `next`；`projectedTokens` 优先；pct clamp 100；window=0/负值安全；全部空 → null | 确定性、无 DOM |
| `node --test test/handoff.test.js` | 145 项 host 侧回归 | 本改动不碰 host 半，应保持全绿（**基线锁定**，防误改） |
| `node --test test/tree-send.test.js`、`node test/provider-conformance.cjs` | 既有回归 | 保持全绿 |
| `node test/skills.test.cjs` | skills 打包一致性 | 只有改 skills 才受影响；本方案不改 skills |

### 5.3 GUI 7 步验证流程（client 半，刷新页面即生效）

1. 单测全绿（§5.2 六个命令）；
2. **刷新** `http://127.0.0.1:9398`（client 半热更：按 `session-tree-ui.md:12` 只需刷页；若无 HMR 就刷新浏览器）；
3. 左侧树：root 行出现 `deepseek-v4.1-flash · max` 与 `NN%`；空白会话无徽标（不显示 0/假值）；
4. 展开含子会话的父行：子行（continuable/one-shot）都出徽标；catalog 子行预热后补齐；控制台无 `refreshProjections` 报错；
5. 打开一个正在运行的子会话：标题栏右侧 chip 与树行一致；下方 composer 的 ContextMeter 百分比一致（同公式同源）；
6. 让该会话跑一个 turn：**不点任何东西**，树行 pct 随事件更新（验证 §4.1 推送链）；再切回冷会话验证显示保持不闪；
7. `cordis_inspect_query` 的 `SessionTree` provider `snapshot`：行数/层级/缩进/几何与改动前一致（必要时扩展 snapshot schema 增加 `meta` 字段，但保持 `additionalProperties:false` 与 required 对齐，见 `client.js:1901-2005`）。

### 5.4 工作量与风险

| 项 | 估算 |
|---|---|
| client 行渲染 + 纯函数 + CSS + 预热（#1–#7） | 4–6 h |
| 测试夹具/断言/新单测 | 2–3 h |
| 标题栏 chip（#8） | 2–3 h |
| 文档/版本/发布流程 | 1–2 h |
| **MVP 合计** | **≈ 1 人日**（不含 release 镜像同步） |
| 增强批量接口 | +1–2 d，**依赖核心 API UNKNOWN** |

风险与缓解：

| 风险 | 级别 | 缓解 |
|---|---|---|
| 冷会话预热触发大量日志解压（210 会话 × 最大 6.6 MB） | 中 | 仅可见行、总上限 300、6/60ms 节流、失败静默 `—`；后续用增强 1/2 |
| `projectionsBySession` 每次投影变化都重建 `byId`/rows → 高频重渲染（live 会话每事件一次） | 中 | 沿用现有 memo 依赖（已是现状）；徽标为纯文本；必要时对 `meta` 做浅比较或 `React.memo` 行组件（Phase 2） |
| 组合缺失 token-meter → 无 contextPressure | 低 | 不渲染 pct，仅 model/effort（`agentPreset` 同样可选） |
| 思考强度为 adapter 默认（88/210 无显式值） | 低 | 显示 `default` 而非空/猜最大值 |
| 版本 bump 与 Q4（index.js 1.4.0）冲突 | 中 | Lead 决定单一 1.4.0；client 改动建议同版本发布 |
| 侧栏窄（rail 模式）行溢出 | 低 | `wide===false` 时行不渲染 meta（`client.js:1410-1425` 已处理 rail）；宽模式 flex 省略 |
| `refreshProjections` 语义（一次/连接）被上游改动 | 低 | 只把它当「补一次全量」，不依赖重取 |

---

## 6. 证据清单（可复核）

### 6.1 本仓（相对 `D:\Codes\dsh-tree-harness`）

| 文件 | 关键行 | 内容 |
|---|---|---|
| `packages/dsh-session-tree/client.js` | 1022-1033 / 424-471 / 780-796 / 864-879 / 929-936 / 950-966 / 1599-1694 / 53-107 / 1109-1181 / 1138-1166 / 1063-1096 / 2012 / 2035-2037 | slot props、`norm()`、行对象、行渲染、CSS、预热机制、`remote.session.list`、inject、槽注册 |
| `packages/dsh-session-tree/index.js` | 308-388 / 332-335 / 346-350 / 941-1030 / 1383 | host 侧 `collectFacts`（provider/model/reasoningEffort + tokenMeter.contextPressure + pct）、handoff successor 创建、服务注入 |
| `packages/dsh-session-tree/test/handoff.test.js` | 59-61 / 123-124 / 249-303 | host 侧 mock 形状：`provider/model/reasoningEffort`、`tokenMeter.contextPressure` |
| `packages/dsh-session-tree/test/render.test.cjs` | 头部注释 | 沙箱加载真 `client.js`、合成 `byId` 夹具（深 4 层/>300 子/归档/孤儿/环） |
| `packages/dsh-session-tree/test/style-guard.cjs` | 头部注释 | 样式注入/自愈断言（`.st-folder` 等） |
| `docs/architecture/session-tree-ui.md` | 8-18 / 20-31 / 57-67 / 69-73 | 设计原则（client/host 半边界）、代码地图、迭代流程、变更记录 |

### 6.2 DSH asar（`D:\DSHarness\resources\app.asar`，`dsh` 0.2.2-rc.1）

| 文件 | 行 | 内容 |
|---|---|---|
| `.../dsh-api-session-controller/lib/typert.host.js` | `SessionProjectionMap` declaration | 23 个投影键（含 `modelSelection/agentPreset/tokenUsage/contextPressure`） |
| `.../dsh-api-session-controller/lib/index.js` | 1032-1039 / 1067-1080 / 1833-1865 / 2509-2514 / 2887-2897 / 3891-3896 | 投影增量帧、全量 baseline、单会话 projections RPC（live/冷）、打开流 projections、列表摘要 `summaryKeys`、list RPC |
| `.../dsh-api-session-controller/lib/client.js` | 3150-3185 / 3186-3220 / 3459-3467 / 3465-3480 / 3628-3638 / 4130-4245 | 投影 store 复用、`refreshProjections`（一次/连接）、`projectionValues`、control 帧落地、list snapshot、`byId` 行形状 + catalog 行 |
| `.../dsh-session-projection/lib/index.js` | 125 / 232-266 / 284-296 | `wire.summary` 归一、全量 `snapshot(session)`、`summaryKeys()` |
| `.../dsh-token-meter/lib/index.js` | 394-446 / 449-500 / 818-824 | `tokenUsage` 投影、`contextPressure` 投影（`summary:false` 在 495）、`tokenMeter.contextPressure(session)` |
| `.../dsh-agent/lib/index.js` | 141-171 | `modelSelection` 投影（`lastUsed/pending`；effort 缺省语义） |
| `.../dsh-agent-preset-registry/lib/index.js` | 49-60 | `agentPreset` 投影 |
| `.../dsh-agent-loop/lib/index.js` | 1015-1045 | `request/header` 事件 `{header, reason:initial/resume/change/series, startsSeries?}` |
| `.../dsh-session/lib/index.js` | 604-615 | `canonicalHeader`（config + adapterDefaults + tools） |
| `.../dsh-session-query/lib/index.js` | 1064-1075 / 350-410 | `observeSession` / 冷读 prepare + projectionMode |
| `.../dsh-cordis-client-runner/lib/client.js` | 2337-2346 + slot 合同目录 | `SessionListState`/`SessionProjectionSnapshot`；`sidebar.workspaces`、`conversation.session.header.utilities` 的 kind/scope/standardProps/registerOptions/example |
| `.../dsh-client-ui-conversation/lib/client.js` | 21480-21540 / 22917-22940 / 20893-20903 | `ContextMeter`（contextPressure/contextBreakdown + 百分比公式）、header 槽声明、header 槽渲染 |
| `.../dsh-client-ui-chat/lib/client.js` | 9690+ | 既有 `UsagePill`（composer 区，非本需求） |
| `.../dsh-client-ui-sidebar/lib/client.js` | 543 / 757-771 | `sidebar.workspaces` 渲染与声明（single/root） |

### 6.3 真实会话日志（已解码）

- 样本：`C:\Users\sir_c\.dsh\sessions\--D-Codes-dsh-tree-harness--\2d632bb4-7060-477d-a58b-7b62a1024e1e\session.v4.jsonl.zstd`（431 KB → 1.35 MB 文本，259 帧）→ scratch `extracted/sample-session.jsonl`；root 样本 `session-bff3c54c-…`（3.36 MB → 9.16 MB 文本）→ `extracted/root-session.jsonl`。
- 全量扫描：210 日志 → `scan-headers.cjs` / `scan-coverage.cjs` / `scan-pressure.cjs` 输出见 §2；4 个「缺 pressure 输入」的日志已逐个分类：3 个「有 contextWindow/model、无 assistant usage」（回合未完成）、1 个空白会话（0 turn）。

### 6.4 复现命令

```powershell
# 1) 解 asar 文件（按路径正则提取到 scratch/extracted）
node D:\Codes\_composition-research\session-ui-probe\asar-extract.cjs ^
  "D:\DSHarness\resources\app.asar" "dsh-token-meter/lib/index\.js$" "dsh-agent/lib/index\.js$"

# 2) 解码多帧 zstd 会话日志（Node 内置 zstd 只解第一帧，脚本按 frame/block 结构逐帧解）
node D:\Codes\_composition-research\session-ui-probe\decode-session.cjs ^
  "%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\<id>\session.v4.jsonl.zstd" out.jsonl

# 3) 全量覆盖扫描（首帧 header / descriptor + 前 6 帧 / 前 120 帧 pressure 输入）
node D:\Codes\_composition-research\session-ui-probe\scan-headers.cjs   "%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--"
node D:\Codes\_composition-research\session-ui-probe\scan-coverage.cjs  "%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--" 6
node D:\Codes\_composition-research\session-ui-probe\scan-pressure.cjs  "%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--" 120
```

---

## 7. UNKNOWN（明确未证实，不猜）

1. **插件能否新增 Remote endpoint / 自定义 Remote 事件**：已核实 endpoint 表为 `@deepseek-ai/dsh-api-*` 的 typert 生成物、client 合同目录只覆盖 slots/hooks/inspect/remoteAccess；**未找到插件注册面**。若需要「一次拉全表元数据」的批量接口，需核心团队确认（增强 2）。
2. **`refreshProjections` 在会话从冷变热后的刷新保证**：live 后由 control 帧更新（已核实帧路径）；但「连接建立时不在 attach 列表的会话，之后变 live」是否有完整 baseline 重发，未在运行中实测，只从代码路径推断增量帧会落到 on-demand 创建的 store。建议实施后用 GUI 第 6 步实测确认。
3. **思考强度的展示名**：`modelSelection` 给的是 adapter 的 effort id（如 `max`），中文展示名在模型目录（`dsh-client-ui-model-selection` 的 `efforts[].name`）而非投影里；MVP 直接显示 id（可接受），若要本地化需注入模型目录服务（未验证 client 插件可用性）。
4. **`contextPressure` 在极旧日志（不同 `stateVersion`）上的可用性**：`stateVersion:5`；持久投影缓存的旧版本 row 会被跳过（`viewCheckpoint` 版本不匹配则 absent），此时需全量重折（`refreshProjections` 会重算），成本已计入。
5. **侧栏窄宽度下 model·effort·pct 三段的视觉验收**：需 GUI 实测（第 3/4 步），本报告只给布局约束。

---

## 8. 交付判定

- **「每个会话显示 model / reasoning effort / 上下文占用」最小可靠方案 = §5.1 的 #1–#7（纯 client 半）**，不需要宿主协议改动；
- **还缺的只有**：冷会话 context% 的预热成本控制（限额即可诚实展示）、以及若要做批量接口的核心 API 结论（UNKNOWN）；
- **实现归属**：树行 + 标题栏 chip → **client 半（`packages/dsh-session-tree/client.js` + locale）**；批量/事件通道 → **host 半/核心 UI（未证实可插件化，不建议 MVP 依赖）**。

> **2026-11-13 修正**：用户要求改到**会话界面底部**、且**不要左侧树行徽标**——§8 的「树行」归属作废（Lead 负责移除）；正确方案见 §9。

---

## 9. 修正（2026-11-13）：改到会话界面底部 + 子会话为何「有些不显示」

> 任务：`task-10`。用户原话：“**不要在左侧会话树显示这些信息**。我要的是在**会话的界面下面**显示，就和正常会话都显示这些信息，但是会话 call 出来的会话有些不显示。”
> 结论先行：**根因有两条独立的**——① 官方模型选择器对**所有子会话**直接 `return null`（不是布局问题）；② **只读子会话**（一次性/未知模式/父离线）的整个 composer 被官方只读组件**替换**，模型选择器 + ContextMeter + 底部 dock 一起消失。**没有任何官方「常驻底部」slot 能在 composer 被替换时存活**；推荐「`conversation.composer.dock` 底部条（主）+ `conversation.session.header.utilities` 兜底角标（只读子会话）/ 或 Phase 2 chain 覆盖拿回底部」。

### 9.1 官方会话底部信息现状（root 会话为什么「都显示」）

| 信息 | 官方组件 | 所在 slot / 位置 | 数据投影 | 渲染条件（原文） |
|---|---|---|---|---|
| **model + 思考强度** | `ModelSelect`（`dsh-client-ui-model-selection/lib/client.js:1120-1128` 注释：trigger 同时显示 model name + effort） | `conversation.input.model`（**single**，位于 composer 工具行；渲染于 `dsh-client-ui-conversation/lib/client.js:22110`） | `modelSelection`（`{lastUsed, next}`，effort 可缺省=adapter 默认） | `if (!available) return null;`（model-selection client `:1297`） |
| **上下文占用 %** | `ContextMeter`（conversation client `:21480-21540`） | composer 底部 dock 行 `div[data-composer-dock]`（`:22219`），与 `conversation.composer.dock` 同一 flex 行 | `contextPressure`（`projectedTokens ?? pressureTokens` / `contextWindow`，clamp 100%）+ `contextBreakdown` 面板 | `variant === "composer" && input !== undefined && sessionId !== undefined` 才渲染 dock（`:22219`）；`activity` 占用时 `activity ? null : <ContextMeter>`；投影缺 token/window 时 `contextOccupancy()` 返回 null → 不渲染 |
| **思考强度明细** | `ModelSelect` 二级菜单 Model/Effort 行 | 同上 trigger | 同上 | 同上 |
| **底部其它** | chat `ActivityPill` id `'activity'`（order 0）/ `UsagePill` id `'usage'`（order 1） | `conversation.composer.dock`（**list**，session scope，"Ambient entries below the composer card"；注册样例 chat client `:15561-15571`） | `useChat` / `performanceUsage` | 同 dock 条件 |
| **标题栏 utilities** | open-in-app / schedule / forge 等 | `conversation.session.header.utilities`（**list**，session scope，右侧 utility 区；渲染于 conversation client `:20893-20903`） | 各 occupant 自定义；standardProps 含 `sessionId/useProjection/useSession/useSessions` | 常驻（只要 Conversation header 挂载） |

composer 自身的插槽合同（asar `dsh-cordis-client-runner/lib/client.js` slot 目录，逐条核实）：

| slot | kind | scope | 说明 |
|---|---|---|---|
| `conversation.composer` | **chain** | session | 按 `select` 选一个组件**替换整个 composer**；fallback 才是正常 composer。官方 occupant：`client-ui-subagent SubagentReadOnlyComposer` 等；owner props = `{sessionId, session, pendingInteraction}` |
| `conversation.composer.bar` | single | session-maybe | 正常 composer body（`InputBar`），替换=shadow 官方（`replaceRisk: shadows-shipped-ui`） |
| `conversation.composer.dock` | **list** | session | **composer 卡片下方的一条 flex 行**（`display:flex;justify-content:center;gap:12px;min-height:22px`，CSS `.GRgSLq_dock`），官方 occupant = ActivityPill/UsagePill；**声明于 `conversation.composer.bar` 的 entry**（InputBar 不渲染则不存在） |
| `conversation.input.model` / `.input.permission` / `.input.plan` / `.input.left`/`.right`/`.input.activity` / `.input.overlay` / `.input.attachments` | single/list | session | 全部**声明于 `conversation.composer.bar` entry**（conversation client `:22958-22995`）→ composer 被替换时一律不存在 |
| `conversation.session` | single | session | 整个 Conversation body（ConversationSession），替换=shadow 官方 |
| `conversation.view` | list | session | 会话**视图 tab**（chat/trajectory/stats，一次只渲染一个）→ **不是 footer** |
| `shell.bottom` | single | **root** | 应用级底部（下方全宽），**无 Session 绑定**，官方 occupant = inspector；替换=shadow |
| `shell.overlay` | list | root | 应用级浮层，**无 Session 绑定**（拿不到当前会话） |
| `main.conversation` | single | session-maybe | ConversationRoot 外壳，替换=shadow |

### 9.2 子会话「有些不显示」的代码级原因（4 条）

| # | 现象 | 代码证据 | 影响会话类型 |
|---|---|---|---|
| **1** | **model/effort 完全不显示**（即使 composer 正常） | `dsh-client-ui-model-selection/lib/client.js:2074`：`const available = sessions.subagentAddress(sessionId) === void 0;`（子会话=false）→ `:1297`：`if (!available) return null;`；`:944` 还有 `assertAvailable() → "model selection is unavailable for addressed subagent sessions"`。即**官方对子会话直接禁用/隐藏模型选择器** | **全部子会话**（continuable 也一样） |
| **2** | **整个底部区消失**（连 ContextMeter、dock 都没有） | `dsh-client-ui-subagent/lib/client.js:1221-1230 selectReadOnlySubagent`：`mode==='unknown'`→只读、`mode==='one-shot'`→只读、`parentAvailable===false && !running`→只读；`:1273-1280` 以 `priority:-10` 注册到 `conversation.composer` chain → 命中即用 `SubagentReadOnlyComposer`（`:683-690`，一个 54px 的只读说明框）**替换整个 composer**；conversation client `:20583-20590` `renderSlotChain(... fallback: composerBar)`、`:20592-20597 composerSeat children: composer` → InputBar 不渲染，其声明的 `conversation.composer.dock`/`input.model`/ContextMeter 全部不存在 | **one-shot（含 flow 一次性节点）、mode=unknown、父会话离线且未运行的 continuable** |
| **3** | 上下文 % 单独缺失 | `ContextMeter` 数据侧：`contextOccupancy(pressure)` 在缺 `contextWindow` 或 token 时返回 null（conversation client `:21525-21534`）→ 不渲染；`activity` occupant 存在时被 `activity ? null : <ContextMeter>` 顶掉（`:22219`） | 空白/未跑完回合、无 usage 的会话；侧栏语音输入激活时 |
| **4** | 只读子会话的「会话界面」根本没有可输入区 | 同 #2；侧栏子会话（openAside → `sidebar.right.pane.tab` + `sidebar.chat.conversation`，subagent client `:835-843`）同样走 `conversation.content` embedded variant（`ConversationSlotPanel`）→ composer 同样可能被只读替换 | 侧栏打开的 one-shot 子会话 |

> 补充：root 会话与**父可用**的 continuable 子会话 composer 正常（`selectReadOnlySubagent` 返回 null → fallback InputBar），但 #1 仍让它们的 model/effort 不显示；#2 的三种只读场景则整块底部不存在。

### 9.3 推荐注入点（底部优先）

| 方案 | slot / 注册 | 覆盖 | 风险 |
|---|---|---|---|
| **主方案（MVP，强烈推荐）** | `conversation.composer.dock`（**list**，session scope）→ `ctx.slots.register({ name:'conversation.composer.dock', id:'session-meta', order:100, locale:'session-tree' }, SessionMetaStrip)` | **root + 父可用的 continuable 子会话**（主窗口与右侧栏 embedded 均可，只要 InputBar 渲染）；位置 = composer 卡片下方 dock 行（**真正的“会话界面下面”**），与 ActivityPill/UsagePill/ContextMeter 同排 | 无（list 追加、`replaceRisk:none`）；空白/hero 阶段（`variant!=='composer'` 或 `input===undefined`）不渲染 → 需要兜底 |
| **兜底 A（零 shadow，推荐与主方案一起）** | `conversation.session.header.utilities`（**list**，session scope）→ `ctx.slots.register({ name:'conversation.session.header.utilities', id:'session-meta-chip', order:60, locale:'session-tree' }, SessionMetaChip)`；组件内用 `useSession(s=>s.subagent)` 判断，**仅只读子会话渲染**（正常会话返回 null 避免重复） | **one-shot / unknown / 父离线子会话**（composer 被替换也常驻，因为 header 始终在）；位置 = 标题栏右侧（不是底部，但 100% 可见、官方支持追加） | 无（list）；位置妥协：不是“界面下面” |
| **兜底 B（Phase 2，拿回只读子会话的底部）** | `conversation.composer`（**chain**）注册 `priority:-20`（低于官方 subagent 的 -10 → 先被尝试），`select` **精确复刻** `selectReadOnlySubagent` 四分支；命中时渲染「只读说明 + 元信息条」；未命中返回 null 落回官方 | 三类只读子会话的**底部** | ⚠ 需复刻官方只读文案/分支（zh/en 至少；其它语言回退）；上游改文案/条件要跟进 → `replaceRisk` 实质是 shadows-仅只读态 |
| ❌ 不推荐 | `conversation.composer.bar` / `conversation.session` / `main.conversation`（single，替换=shadow 官方）；`conversation.view`（是 tab 不是 footer）；`shell.bottom`（single/root、被 inspector 占用、**无 session 绑定**）；`shell.overlay`（root scope 拿不到当前会话） | — | 高 |

**推荐组合**：MVP = 主方案（dock 底部条）+ 兜底 A（只读子会话 header chip）；用户若坚持「只读子会话也要在底部」，再做兜底 B（chain 覆盖）。

### 9.4 组件与 patch 计划（纯 client 半，仅 `packages/dsh-session-tree/client.js`）

**数据投影（子会话与 root 同源可用）**：打开子会话走 `uiWorkspace.openSession(address)` → `replaceMain(target)`（`dsh-client-ui-workspace/lib/client.js:1473-1475,1661-1690`：`sessions.retain(target)` 保留**子会话**并记录 `subagentAddress`）→ Conversation 绑定子会话，打开流返回**全量 projections**（host `dsh-api-session-controller/lib/index.js:2509-2514` `projections: projections(observation)`，含 `contextPressure`）→ `useProjection('modelSelection'|'contextPressure')` 拿到的就是子会话自己的数据。前一轮实测：one-shot/flow 节点 31/31 有首个 `request/header`（model）且 31/31 具备 contextPressure 输入（§2），因此只读子会话也能显示真实值；空白/无 usage 时诚实显示 `—`。

**插件内实现（伪代码）**：

```js
// ① 纯函数：与官方 ContextMeter 同口径
function metaOf(modelSelection, contextPressure) {          // 均可 undefined
  const sel = (modelSelection && (modelSelection.lastUsed || modelSelection.next)) || null
  const used = contextPressure && (contextPressure.projectedTokens ?? contextPressure.pressureTokens)
  const win = contextPressure && contextPressure.contextWindow
  return {
    model: sel ? sel.model : null,
    provider: sel ? sel.provider : null,
    effort: sel ? (sel.reasoningEffort || null) : null,     // 缺省 = adapter 默认
    pct: used !== undefined && win > 0 ? Math.min(100, Math.round((used / win) * 100)) : null,
    usedTokens: used, contextWindow: win,
  }
}

// ② 组件（dock 条目与 header 条目共用；t 由 locale:'session-tree' 注入）
function SessionMetaStrip({ sessionId, useProjection, t }) {
  const sel = useProjection('modelSelection')
  const cp  = useProjection('contextPressure')
  const m = metaOf(sel, cp)
  if (!m.model && m.pct === null) return null                 // 诚实缺失：不渲染假值
  const title = [m.provider && (m.provider + '/' + m.model),
                 m.pct !== null && (m.usedTokens + ' / ' + m.contextWindow + ' tokens')]
                .filter(Boolean).join(' · ')
  return React.createElement('div', { className: 'st-meta-strip', 'data-session-meta': sessionId, title },
    m.model ? React.createElement('span', { className: 'st-meta-item' }, m.model) : null,
    m.model ? React.createElement('span', { className: 'st-meta-item' }, m.effort || t('effortDefault')) : null,
    m.pct !== null ? React.createElement('span', { className: 'st-meta-item st-meta-pct' }, m.pct + '%') : null)
}

// ③ apply() 内（与现有 sidebar.workspaces 注册并列）
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
  name: 'conversation.composer.dock', id: 'session-meta', order: 100, locale: 'session-tree',
}, SessionMetaStrip))

// ④ 兜底 A（只读子会话 header chip；组件内部判断，正常会话 return null）
ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
  name: 'conversation.session.header.utilities', id: 'session-meta-chip', order: 60, locale: 'session-tree',
}, SessionMetaChip))     // chip 内：const sub = useSession(s => s.subagent); 正常会话直接 null

// ⑤ 兜底 B（Phase 2，只读子会话底部；select 复刻官方四分支）
function selectReadOnlyMeta(owner) {
  const sub = owner.session && owner.session.subagent
  if (!sub) return null
  if (sub.address.mode === 'unknown') return { reason: 'unknown' }
  if (sub.address.mode === 'one-shot') return { reason: 'one-shot' }
  if (sub.parentAvailable !== false) return null
  return owner.session.running === true ? null : { reason: 'parent-unavailable' }
}
ctx.slots.inject('conversation.composer', () => ctx.slots.register({
  name: 'conversation.composer', priority: -20, locale: 'session-tree', select: selectReadOnlyMeta,
}, SessionMetaReadOnlyComposer))   // 渲染：只读说明（复刻文案）+ <SessionMetaStrip/>
```

CSS（injected 到 `<head>`，沿用 `ensureStylesheet` 模式）：`.st-meta-strip{display:inline-flex;align-items:center;gap:10px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;white-space:nowrap}`；窄容器 `max-width:100%;overflow:hidden;text-overflow:ellipsis`（dock 行为 `display:flex;justify-content:center;gap:12px`，条目过长会挤压 → 加 `max-width`）。

> **树行徽标移除**（task-9 方向错误）：由 Lead 另派实施，本报告只登记“作废”；`norm()` 的投影字段读取可保留（无渲染副作用）或一并回退。

### 9.8 实施记录（2026-11-13，task-11）

- **树行徽标已全部移除**：`.st-meta{` / `.st-meta-model` / `.st-ctx{` / `rowMetaElement` / `ensureMeta` / `data-ctx-pct` 在 `client.js` 均 0 命中；render 新增断言“即使行投影带 model/context，树行也没有 `st-meta*`”。
- **已实现（纯 client，2 个追加式 list slot）**：① `conversation.composer.dock` `{id:'session-meta', order:100}` → `SessionMetaStrip`（仅子会话；composer 卡片下方 dock 行）；② `conversation.session.header.utilities` `{id:'session-meta-chip', order:60}` → `SessionMetaChip`（仅只读子会话，精确复刻官方 `selectReadOnlySubagent` 四分支）；root 两面返回 null，保留官方 UI。
- **数据**：slot `sessionId` + `useProjection('modelSelection'/'contextPressure')`；`metaOf` 与 ContextMeter 同口径；effort 缺省“默认/default”；缺失不渲染。
- **测试**：render **151/151**（夹具 9/9 + 实时 11/11）、meta **41/41**、style-guard **26/26**、handoff 41/41、tree-send 25/25、skills 3/3、verify-bundle 0 fail。
- **人工验收状态（2026-11-13 13:28 最终关闭：PASS）**：用户 2026-11-13 01:07（重启后）反馈“看到参数了”，**13:28 进一步确认「子会话视图的各项数据」可见并同意关闭 NOT VERIFIED**。此前 D21 轮复核证据：① 代码级——`conversation.composer.dock#session-meta` 仅对**子会话**渲染（root 返回 null，保留官方 UI，无重复）；`conversation.session.header.utilities#session-meta-chip` 仅对只读子会话（`SelectReadOnlyMeta` 三分支）渲染；空白/缺投影返回 null 不渲染假值；render **151/151**、meta **41/41**、style-guard **26/26** 全绿。② 活体截图（01:42，`PrintWindow(PW_CLIENTONLY|PW_RENDERFULLCONTENT)`）——左侧「会话树」正常渲染；root composer 保留官方 **`DeepSeek V4.1 Flash Max`** 选择器 + 右下官方 **`20%`** 上下文读数；root 底部无重复条。③ 子会话视图由用户本人在 DSH 会话中确认数据可见（continuable 子会话底部 dock 条 / 只读子会话标题栏 chip）。**结论：人工验收 PASS，NOT VERIFIED 关闭。**
- **平台边界不变**：只读子会话没有“composer 之外的会话级底部 slot”；若要求底部，只能 Phase 2 chain 覆盖（需复刻官方只读 UI）。

### 9.5 为什么不能简单塞进「常驻底部」（关键限制，避免实施返工）

- `conversation.composer.dock` 虽然 kind=list，但它是 **InputBar 渲染时**调用的（conversation client `:22219`）——**只注册 slot 不够，必须 InputBar 挂载**；composer 被 chain 替换 = dock 永远不会被 render，插件注册的条目静默不显示（不会报错）。
- 官方**没有任何**“composer 之外、会话级、常驻”的底部 slot：`conversation.view` 是 tab；`shell.bottom`/`shell.overlay` 是 root scope 且无 Session 绑定；`conversation.session`/`header` 是 single（替换即 shadow）。
- 因此「只读子会话的底部」只有两条路：**chain 覆盖**（兜底 B，复刻只读 UI）或 **header chip**（兜底 A，位置改上方）。这是平台能力边界，不是插件实现问题。

### 9.6 测试计划

| 测试 | 新增断言 |
|---|---|
| `node test/render.test.cjs`（沙箱加载真 `client.js`，合成 props） | ① 注入 `composer.dock` 的组件能收到 `sessionId/useProjection` 并渲染 `model · effort · NN%`；② `metaOf` 边界：`lastUsed` 优先于 `next`、`projectedTokens` 优先、windownull → pct null、pct clamp 100、effort 缺省 → `默认`；③ 缺投影 → 组件返回 null（不渲染假值）；④ dock/header 两个注册 id 唯一、order 正确 |
| `node test/style-guard.cjs` | 注入 CSS 含 `.st-meta-strip`；样式自愈守卫仍 PASS |
| `node --test test/handoff.test.js` / `tree-send.test.js` / `provider-conformance.cjs` | host 半未改，保持基线全绿（防误改） |
| GUI 7 步（`http://127.0.0.1:9398`） | 1) 刷新页面（client 半无需 disable→enable）；2) root 会话：底部 dock 出现 `model · effort · %`（与上方 ModelSelect/ContextMeter 一致）；3) **continuable 子会话**（树里 leaf）打开：以前无 model 选择器 → 现在底部条出现；4) **one-shot/flow 子会话**打开：以前只有只读框 → header chip 出现（Phase 2 后为底部条）；5) **父离线子会话**：同 4；6) 空白新会话：不显示假值（隐藏或 `—`）；7) 跑一个 turn：% 随 contextPressure 事件更新，切换会话不串数据、无 console error |

### 9.7 工作量、风险、UNKNOWN

| 项 | 估算 |
|---|---|
| 主方案（dock 底部条 + metaOf + CSS + locale） | 2–3 h |
| 兜底 A（header chip 只读子会话） | 1–2 h |
| 测试（render 夹具 + style-guard + 纯函数边界） | 1–2 h |
| **MVP 合计（主 + 兜底 A）** | **≈ 0.5–1 人日** |
| 兜底 B（chain 覆盖只读子会话底部） | +3–4 h（含只读文案复刻与回归） |

风险：① 兜底 B 复刻官方只读 UI（文案/条件漂移、8 语言 vs 我方 zh/en）；② 空白/hero 阶段与 `activity` 占用时 dock 不渲染（兜底 A 覆盖）；③ root 会话官方已有 ModelSelect+ContextMeter，本方案**重复显示**（可接受；也可只对 `subagent!==null` 渲染 dock 条，但用户要求“不管什么会话”故默认全渲染）；④ 子会话投影在极大历史下打开较慢（打开流全量 projections 与现有行为一致，无额外 RPC）。

UNKNOWN：① ≥0.2.2-rc.1 是否有计划中的「Conversation 常驻 footer/status」slot（当前目录没有）；② `ctx.locale.bind('subagent')` 能否跨插件读官方只读文案（若可，兜底 B 可免复刻）；③ 侧栏 embedded 会话中 `composer.dock` 的可用性仅从 `variant: 'composer'` 条件推断，未在运行中实测（建议 GUI 第 3 步同时验证主窗口与「在右侧栏打开」两种入口）。
