# E2 · DSH 平台能力边界研究报告

> **研究对象**：DeepSeek Harness `0.2.2-rc.1`（Electron 桌面安装内的 `app.asar`，`@deepseek-ai/dsh-*` 共 331 个包）
> **研究问题**：一个第三方编排引擎（严格树形任务引擎、自由 DAG 流程引擎）应当依赖平台的什么、不应重造什么；平台缺什么（必须由编排层自建的契约）。
> **方法**：只读 asar 源码 + 包内 README（版本内自带文档，与源码同源）；第三方插件源码仅作「API 用法实证」，其文档结论一律不采信。
> **证据标记**：`FACT` = 源码/包内文档直接可见（给路径:行号）；`INFERENCE` = 由代码行为推导（给推导链）；`UNKNOWN` = 本轮未取证。

---

## 0. 结论先行

### 0.1 一句话结论

**DSH 是「会话运行时 + 能力总线」，不是编排引擎。** 它把「创建/恢复一个会话、给它发消息、中断它、观察它、给它权限、把它的日志持久化、把它显示出来」做成了稳定原语；但**任务图语义、验证、预算、跨进程身份、拓扑视图**一律没有。因此编排层应把自己定位成 **DSH 之上的「任务账本 + 对账器 + 视图」**，而不是再造会话/消息/日志/权限。

### 0.2 应当依赖的平台原语（不要重造）

| # | 原语 | 入口 | 平台保证 | 证据 |
|---|---|---|---|---|
| 1 | 会话创建/恢复 | `ctx.agents.create()` / `ctx.agents.resume()` | 同一 id 命名空间；`AgentHandle` 是唯一拆除能力；setup 可注入 composition | `dsh-agent:lib/types/index.js:190,208`；`dsh-agent:README.md:32,43` |
| 2 | 子智能体派发 | `ctx.subagents.startActivation(spec)` | provider 注册表、容量槽、父所有权、descriptor 落盘、catalog 事实 | `dsh-subagent:lib/types/index.js:138`；`manager.js:316-406` |
| 3 | 消息投递/唤醒 | `ctx.subagents.sendMessage()`、`[deliverSubagentPrompt]`、`prompt()` | inbox 受理即返回；运行中 steer、空闲起 turn、冷恢复 | `dsh-subagent:lib/types/index.js:178,193,298` |
| 4 | 中断 | `ctx.subagents.interrupt(id, authority)` | 只停当前 turn（`keepInbox:true`），授权按活祖先或父地址 | `manager.js:132-166` |
| 5 | 会话谱系/查询 | `ctx.sessionQuery.*`、`ctx.subagents.listChildren/listDescendants` | live-first、detached、`traceSession` 祖先+后代 | `dsh-session-query:lib/index.js:1072,1096,1184`；`dsh-subagent:lib/types/index.js:258,277` |
| 6 | 事件日志 | `session.append()` + `session/event` | append-only、深冻结、可回放、可持久化 | `dsh-session:lib/index.js:1596,1645`；`dsh-session:README.md:44,52` |
| 7 | 生命周期观察 | `agent/created` / `agent/disposed` / `agent/status`、`turn/start` / `turn/end`、`subagent/start` / `subagent/end`、`workflow/*` | 事件只观察、不授予控制权 | `dsh-agent:lib/types/index.js:311,348`；`dsh-agent-loop:lib/index.js:731,819` |
| 8 | 权限继承 | `sandbox/mode`、`approval/policy`、`permission/preset` 三条会话事实 | 按会话折叠、重启后仍生效 | `dsh-sandbox-policy:README.md:74,78`；`dsh-user-approval:README.md:35,77` |
| 9 | 令牌计量 | `ctx.tokenMeter.measure()` / `contextPressure()` | 回放式、确定性、无模型调用 | `dsh-token-meter:README.md:36,49` |
| 10 | 非会话持久化 | `ctx.storageDomain.open(spec)` + `defineDomain` | schema 校验、写穿、`domain/changed` | `dsh-storage-domain:README.md:40-58` |
| 11 | UI 槽位 | `ctx.slots.register/inject/provideRoot` | 优先级/遮蔽、所有权、卸载回收 | `dsh-client-ui-renderer:lib/client.js:1546-1601`；`dsh-client-ui-layout:README.md:36-38` |
| 12 | 浏览器↔Host 通道 | `@Remote` + `ctx.remote.<ns>.<method>` | 类型化 wire、访问控制、取消信号 | `dsh-typert-protocol:README.md:31-44,62` |

### 0.3 平台缺口（必须由编排层自建）

| # | 缺口 | 现状（FACT） | 后果 | 建议自建物 |
|---|---|---|---|---|
| G1 | **任务图/树持久化** | 无图语义。会话树「除 fork 外不存在」（`dsh-session:README.md:207`）；`storageDomain` 只有 KV，无事务/二级索引/多段键（`dsh-storage-domain:README.md:146-148`） | 依赖/就绪/层级只能自存 | `TreeState/NodeState` 账本（KV + 单一写链 + CAS revision） |
| G2 | **预算记账** | 无 token/成本/时间预算原语。workflow 明确「No token-budget vocabulary」（`dsh-workflow:README.md:129`）；subagent 只有 `maxDepth`/`maxActiveSubagents`（`dsh-subagent:lib/types/index.js:75-78`）；goal 只有轮数（`dsh-goal:README.md:44-48`） | 无法按 run/node 记账与拒绝 | 预算预留 + 结算（tokenMeter 采集实际值） |
| G3 | **调用者身份（durable / 跨进程）** | initiator 是进程内 AsyncLocalStorage（`dsh-agent:README.md:12,205`）；session header **白名单**只收 7 个 meta 字段（共 9 个 header 字段），未知 meta 被静默丢弃（`dsh-session:lib/index.js:1831-1841`）；`prompt()` 仅按父地址授权（`dsh-subagent:lib/types/index.js:298-337`） | 无法在会话里存 `runId/nodeId`，也无法证明「谁派发的」 | 编排账本内 `sessionId ↔ {runId,nodeId,attempt}`；dispatch 时带幂等键 |
| G4 | **节点验证/DoD** | 无 verify/DoD 服务；只有工具与 `outputSchema`（activation 级、**不持久**，`dsh-subagent:lib/types/descriptor.js:16-19`） | 完成=模型自述，不可信 | 独立 verifier（命令/LLM/人工）+ 证据引用 |
| G5 | **拓扑 UI** | 无全局树/图视图；内置只有会话 header 的 popover 子会话树（`dsh-client-ui-subagent:README.md:28-36`），侧栏默认**隐藏**子会话（同文件 :12） | 多树/多 run 无可视化 | 占用 `sidebar.workspaces` 或 `main` keyed 面板 + Remote 读模型 |
| G6 | **跨引擎组合注册表** | 无注册表。`workflowEngine` 单 provider，第二个 engine 直接被 Cordis 拒（`cordis:lib/index.js:1400`）；唯一可插拔执行面是 `subagents.registerProvider`（`dsh-subagent:lib/types/index.js:374`） | 树引擎/流程引擎并存时无仲裁 | 自建 `OrchestratorRegistry`（单一 owner + 软探测） |
| G7 | **会话归属（workspace）不在创建路径** | `agents.create`/`startActivation` 不挂 workspace；只有 API Session Controller 与 schedule 调 `attachSession`（`dsh-api-session-controller:lib/index.js:809`；`dsh-schedule:lib/index.js:1514`） | 程序创建的会话在侧栏显示 Ungrouped | dispatch 后显式 `workspaceRegistry.resolveByPath(cwd).attachSession(id)` |
| G8 | **会话级标签/元数据** | 无 tags/labels；只有 `session/title`（`dsh-session-title:lib/index.js:301`）、subagent `descriptor.label`（`dsh-subagent:lib/types/descriptor.js:127-130`）、workspace pin/archive | 无法按 run/业务维度检索 | 编排账本自存 + 写入 `label` + 首条 prompt 前缀 |
| G9 | **消息幂等/崩溃重放** | 无 exactly-once；accepted-but-unlogged 会丢（`dsh-subagent:README.md:211-212`）；activation 图不跨进程（同文件 :210） | 调度器必须自己做去重与重放 | `idempotencyKey` + 账本 outbox/inbox |

### 0.4 对「编排契约」的六条硬建议

1. **派发契约冻结快照**：`agentOptions`（provider/model/effort/maxTokens）、`agentPreset`、`cwd`、`permission` 在派发时一次性快照；不要依赖父会话后续变化（`dsh-subagent:lib/types/child-agent.js:74-92` 的行为即「快照」）。
2. **终态只从日志推导**：`turn/end.reason.kind` / `subagent/end.stopReason` 是权威；`result` Promise 只是当前进程的便捷通道，崩溃即失忆（`dsh-agent-loop:lib/index.js:819`；`dsh-subagent:lib/types/lifecycle.js:79-105`）。
3. **每次状态变更带 `(runId,nodeId,attempt,expectedRevision,idempotencyKey)`**；DSH 不提供 CAS，账本必须自己做。
4. **预算先预留再派发**；结算用 `tokenMeter.measure(session)`（回放式，provider usage 只在同一 canonical envelope 命中时复用）。
5. **验证与执行分离**：节点执行成功 ≠ 验收通过；DoD 由独立 verifier 产生 `evidenceRefs`，写进账本。
6. **UI 只消费只读投影**：Host `@Remote` 暴露 `TreeSnapshot`，Client 用 slot 注册；不要把编排状态塞进会话事件。

---

## 1. 取证方法与阅读口径

| 通道 | 命令/工具 | 结果 |
|---|---|---|
| asar 内文件直读 | `read` 工具直接打开 `D:\DSHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\...` | ✅ 可用（本报告主要通道） |
| asar 目录列举/检索 | `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSHarness\DeepSeek Harness.exe' -e "fs.readdirSync(...)"` | ✅ 可用 |
| asar 只读工具 | `node D:\Codes\dsh-tree-harness\scripts\asar-tool.cjs <asar> find/grep/cat ...` | ✅ 可用（grep 参数为 `<filePattern> <textPattern>`） |
| `glob` / `grep` 工具 | — | ❌ 不能进 asar（符合任务说明） |

**口径说明**：
- 包内 README 与源码同版本随包发布，本报告把它当「包内文档」引用，但仍以 `.js` 源码行号为主证据；README 只用于补充「设计意图/限制」。
- 行号对 `0.2.2-rc.1` 有效；升级后需重取。
- 第三方仓库（`dsh-tree-harness`、`DSH动态流程引擎插件`）只作为「平台 API 被如何使用」的实证，其结论不作为平台事实。

**路径缩写**（附录 A 有完整映射）：

| 缩写 | 实际路径 |
|---|---|
| `dsh-<pkg>:<file>` | `D:\DSHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-<pkg>\<file>` |
| `cordis:<file>` | `...\@deepseek-ai\cordis\<file>` |

---

## 2. 平台原语地图（分层）

| 层 | 服务（`ctx.*`） | 提供者包 | 稳定性判断 | 证据 |
|---|---|---|---|---|
| 模型/循环 | `llm`、`agentLoop` | `dsh-llm`、`dsh-agent-loop` | 核心，稳定 | `dsh-agent-loop:lib/index.js:1299-1329` |
| Agent | `agents` | `dsh-agent` | 核心，稳定（公开 `Agent` API） | `dsh-agent:README.md:28-32` |
| 会话 | `sessions`、`sessionProjections`、`sessionTitle`、`sessionQuery`、`sessionPersistence` | `dsh-session` 等 | 核心，稳定但格式版本化 | `dsh-session:README.md:30-40` |
| 子智能体 | `subagents`（+ provider） | `dsh-subagent`、`-spawn-in-process`、`-fork-in-process` | 较稳定，**近版本有形状漂移** | 附录 B.1 |
| 工作流 | `workflowEngine` | `dsh-workflow` + `dsh-workflow-ptc` | 稳定但能力刻意最小 | `dsh-workflow:README.md:71,126-130` |
| 工具 | `tools`（+ executor） | `dsh-tools` | 核心，稳定 | `dsh-tools:README.md:30-34,88-94` |
| 存储 | `storageDomain` | `dsh-storage` + `dsh-storage-domain` + backend | 稳定，能力有限 | `dsh-storage-domain:README.md:146-148` |
| Web | `webServer` | `dsh-host-webserver` | 稳定 | `dsh-host-webserver:README.md:61-69` |
| UI | `slots`、`layout`、`uiWorkspace`、`modules` | 客户端 `dsh-client-ui-*` | 稳定（槽位语义复杂） | `dsh-client-ui-renderer:lib/client.js:1434-1601` |
| 权限 | `permissionPresets`、`sandboxPolicy`、`approval` | `dsh-permission-presets` 等 | 稳定（三权分立） | 见 §7 |
| 组合 | Loader / bundle patch | `dsh` CLI、`dsh-plugin-manager`、`dsh-base` | 稳定（YAML 分层） | `dsh:README.md:41-46` |

> **INFERENCE**：`sessionQuery` 与 `sessionProjections` 是「读侧」两条腿：前者读原始日志/谱系，后者读派生状态并可直接推给浏览器。编排层应优先用它们，而不是自己解析 `session.jsonl`。

---

## 3. 会话与子智能体原语

### 3.1 `ctx.subagents` 方法表（FACT）

服务类 `SubagentRuntime extends TypertRemoteService`，服务名 `subagents`（`dsh-subagent:lib/types/index.js:60-89`）。

| 方法 | 签名（语义） | 关键行为 | 行号 |
|---|---|---|---|
| `startActivation(spec)` | `{provider, label, request, childId?, signal, delivery}` → `{childId, messageId, result, dispose}` | 返回即「已受理」；`dispose()` 取消**这一次** activation 并等后代清理 | `:138-154`，`manager.js:1111-1117` |
| `waitForChildren(parent)` | `Agent` → `boolean` | 只 join 进行中的后代；空闲 parked inbox 不阻塞宿主完成 | `:161-163`，`manager.js:190-231` |
| `sendMessage(sender, targetId, content, options)` | 精确活 sender | 只允许「直接子」或「直接父」；运行中 steer、空闲起 turn、缺席的直系子冷恢复 | `:178-180`，`manager.js:473` |
| `deliverSubagentPrompt` | Symbol 键 | Host 协议投递（不代表 Agent 身份），Queue/Steer | `:193-197` |
| `interrupt(targetSessionId, authority)` | `authority = {kind:'ancestor',agent}` 或 `{kind:'user',parentSessionId}` | 只停当前 turn，`keepInbox:true`；后代继续跑 | `:213-215`，`manager.js:132-166` |
| `drainDescendants(parents)` | 宿主 teardown | 停止并 child-first 释放后代 | `:226-232` |
| `drainChildren(parent, childIds)` | 释放选定常驻子 | 其他同父子不受影响 | `:243-248` |
| `listChildren(parentSessionId, signal)` | 读父 catalog | 不加载/不恢复子 Agent；live-preferred 观察 | `:258-260` |
| `listDescendants(rootSessionId, signal)` | 递归 pre-order | 每个 catalog 只观察一次；坏分支降级为诊断 | `:277-279` |
| `prompt(request, signal)` | 浏览器/宿主 Remote 投递 | 按 **durable parent 地址** 授权；要求目标 continuable 且父 live | `:298-338` |
| `interruptByParent(childId, parentId, mode)` | Remote 面 | 父离线也能停活子 | `:353-365` |
| `registerProvider(provider)` | `{name, start? \| prepareContinuable?, capabilities, inheritsParentContext}` | 重名抛 `DUPLICATE_PROVIDER`；移除 provider 不撤销已受理 run | `:374-393` |
| `getProvider/list` | 查询 | 插入序 | `:399-408` |

**配置**：`maxDepth` 默认 **1**、`maxActiveSubagents` 默认 **8**（`dsh-subagent:lib/types/index.js:75-78`）。容量是**进程内、按根 parent 的 activation 树共享**的槽位，不是累计 token 配额（`dsh-subagent:README.md:51-57`）。

### 3.2 `startActivation` 的请求形状（FACT + 实证）

`request` 至少包含（从实现读取的字段）：

| 字段 | 含义 | 证据 |
|---|---|---|
| `prompt: ContentBlock[]` | 首条消息 | `manager.js:394-396` |
| `parent: Agent` | **精确活 Agent**，用于授权与所有权 | `manager.js:318,146-148` |
| `cwd?: string` | 相对路径按父当前目录解析；缺省继承 | `manager.js:455-462` |
| `agentOptions?: {provider,model,reasoningEffort,maxTokens}` | 覆盖父路由；子深度自动打戳 | `child-agent.js:74-92` |
| `agentPreset?: string` | 独立 preset；仅 in-process spawn 支持 | `dsh-subagent:lib/types/index.js:442-444` |
| `outputSchema?: object` | activation 级结构化输出；**不持久** | `descriptor.js:16-19` |
| `maxDepth?: number` | 绝对深度上限 | `child-agent.js:31-40` |

`spec.delivery: 'parent' | 'caller'` 决定完成通知是否回到父模型；`caller` 供 workflow 自行收集（`dsh-subagent:README.md:61`）。

> **FACT**：每个 local 子会话必写一条 `subagent/descriptor`（`mode:'continuable'`, `version:3`）到**子会话自己的日志**，并把 `subagent/catalog` 事实追加到**父会话**（`manager.js:772,397`；`catalog.js:87-95`）。这两条事实是「可发现性」的持久根基。

### 3.3 本地 provider：spawn 与 fork

| Provider | 能力 | 继承父上下文 | 继续对话 | 证据 |
|---|---|---|---|---|
| `spawn`（`subagent-spawn-in-process`） | `agentOptions` / `agentPreset` / `outputSchema` / `depthLimit` 全 true | 否（零父上下文） | 是（durable session） | `dsh-subagent-spawn-in-process:lib/index.js:19-34` |
| `fork`（`subagent-fork-in-process`） | 同 spawn，但拒绝 `agentPreset` | 是（父**已完成轮**的种子） | 是 | `dsh-subagent-fork-in-process:README.md:12,36` |
| 外部（ACP / SDK / Codex / Claude Code） | 单次执行 | 各自体系 | **否**（无本地子会话） | `dsh-subagent:README.md:205` |

> **FACT**：fork 的种子是「一次性快照」，之后的父轮不会进入子（`dsh-subagent-fork-in-process:README.md:12`）。

### 3.4 会话创建：`ctx.agents.create / resume` 与 `agentLoop`

`ctx.agents` 是注册表（`AgentRegistry`），`create/resume` 委派给注册的 factory（`dsh-agent:lib/types/index.js:190-214`）。默认 factory 是 `dsh-agent-loop` 的 `AgentLoop`（服务名 `agentLoop`，`dsh-agent-loop:lib/index.js:1329`）。

```text
ctx.agents.create({
  sessionId,                      // 必填；与 Agent id 同一命名空间
  parentAgent?,                   // 传了才是 runtime child；不传是 root
  meta?: {                        // 只接受 7 个白名单 meta 字段（header 共 9 个字段）
    cwd?, parentSession?, isSeeded?, origin?: 'subagent',
    delegationDepth?, agentPreset?, createdAt?
  },
  seed?, inheritedEventCount?,    // fork 种子边界
  agentOptions?: { provider, model, reasoningEffort, maxTokens },
  setup?: (agentCtx, agent) => void | Promise<void>,  // 发布前的 composition
  signal?
})
ctx.agents.resume({
  resumeSessionId, parentAgent?, agentOptions?, setup?, signal?
})
```

证据：`dsh-subagent:lib/types/manager.js:787-804`（内部真实调用）；`dsh-agent-loop:lib/index.js:1668-1703`（createAgent）、`:1710-1775`（resume）；`dsh-session:lib/index.js:1831-1841`（header 白名单）。

`AgentLoop` 还暴露装饰性配置 `agentLoop.agents[]`（`id/sessionId/provider/model/...`）用于声明式启动（`dsh-agent-loop:lib/index.js:1308-1320`），第三方编排一般不用。

> **INFERENCE**：`setup(agentCtx, agent)` 是第三方注入「per-node 工具集/提示词/监听器」的**唯一正确时机**；创建后再改 composition 会破坏静态前缀（`dsh-agent:README.md:43,182`）。

### 3.5 会话谱系字段（FACT）

`SessionHeader` 是**闭集白名单**（`dsh-session:lib/index.js:1831-1841`）：

| 字段 | 语义 | 谁写 | 备注 |
|---|---|---|---|
| `version` / `id` / `createdAt` | 格式与身份 | 平台 | `version:4`（当前） |
| `cwd` | 绝对工作目录 | 平台/派发方 | 必须是绝对路径（`:45-51`） |
| `parentSession` | **直接创建者**会话 id | 派发方 | 历史普通 fork 也可能保留该字段；分类看 `origin`（`dsh-session:README.md:32`） |
| `isSeeded` | 是否含继承前缀 | 平台 | fork/seed |
| `origin` | **只允许 `'subagent'`** | 派发方 | 与 fork 区分的唯一可靠标记（`archive-admission.js:95-104`） |
| `delegationDepth` | 递归预算的持久下限 | 平台（subagent 服务） | 冷恢复不能「变回顶层」 |
| `agentPreset` | 组合 id | 派发方 | **只写 header，不自动挂载组合**；挂载须在 `setup()` 里 `agentPresets.mount/composeFrom`（`dsh-agent-loop:lib/index.js` 无 `agentPreset` 引用；`child-agent.js:140-152`） |
| `……其他任何字段` | — | — | **静默丢弃**（不在白名单） |

**`continuable` 不是 header 字段**：它是子会话日志里的 `subagent/descriptor.mode ∈ {'one-shot','continuable'}`（`descriptor.js:110-113`），以及父 catalog 行的 `mode`（`catalog.js:11-32`）。

**权限继承不是 header 字段**，而是三条 log-only 会话事件：`sandbox/mode`、`approval/policy`、`permission/preset`，由父在派发时捕获并写入子日志（`child-agent.js:180-207`）。

**workspace 归属不在 header**：由 `workspace` 域中的 `sessionIds` 记录（`dsh-workspace:lib/index.js:102-129`），且创建路径**不会自动写入**（见 G7）。

### 3.6 如何枚举某会话的子会话（4 条路径 + 陷阱）

| 路径 | API | 优点 | 限制 |
|---|---|---|---|
| 实时 catalog（直接子） | `ctx.subagents.listChildren(parentSessionId)` | 不加载子 Agent；父事件序 | 只覆盖有 catalog 事实的子；外部一次性子为叶子 |
| 实时 catalog（递归） | `ctx.subagents.listDescendants(rootSessionId)` | pre-order、带 depth、坏分支诊断 | 顺序读，冷树可能累计存储延迟（`dsh-subagent:README.md:204`） |
| 持久过滤 | `ctx.sessionQuery.filterSessions([{kind:'parent', values:[id]}])` | 覆盖所有带 `parentSession` 的会话 | **包含历史普通 fork**（误判风险） |
| 谱系追踪 | `ctx.sessionQuery.traceSession(id)` | 一次拿到祖先链 + 后代树 + `complete/unresolvedParentId` | 需要完整 corpus 列表 |

证据：`dsh-subagent:lib/types/index.js:258,277`；`dsh-session-query:lib/index.js:680-701`（filters：id/cwd/created-at/parent/availability）、`:903-946`（traceSession 实现）、`:1184-1188`。

> **陷阱（FACT）**：`parentSession` 不能单独作为「子智能体」判据——普通会话 fork 也可能保留它；平台自己用 `origin === 'subagent'` 判别（`dsh-subagent:lib/types/archive-admission.js:95-104`；`dsh-api-session-controller:README.md:66`）。

### 3.7 会话日志、持久化与投影缓存

| 对象 | 形状 | 证据 |
|---|---|---|
| 会话事件 | `{type, seq, time, data, surfaceOp?, sourceEventSeqs?, ignorable?}`，append-only、深冻结 | `dsh-session:lib/index.js:645-672` |
| 派生历史 | `session.deriveMessages()` 纯函数式折叠；surface 是唯一真源 | `dsh-session:README.md:44,52` |
| 持久化布局 | `<root>/<normalized-cwd>--/<encoded-id>/session.vN.jsonl.zstd`（当前格式一行一事件；历史代只读） | `dsh-session-persistence-jsonl:README.md:54-64` |
| 写入屏障 | `ctx.sessions.flush(session)` 等所有持久化监听器落盘 | `dsh-session:lib/index.js:1970` |
| 投影缓存 | **不是 per-session 文件**，而是 storage domain `session_projcache` 的 per-record 表 | `dsh-session-projection-cache:README.md:84` |
| 第三方事件类型 | **不被接受**：`KNOWN_SESSION_EVENT_TYPES` 为仓内生成集合，读路径拒绝未知且非 `ignorable` 的事件 | `dsh-session:lib/types/known-event-types.js:21-84`；`dsh-session-persistence:lib/index.js:184` |
| 插件记录 | `appendPluginRecord` 只允许 `packages/experimental/` 的仓内调用者；外部插件「must not call it either」 | `dsh-session:README.md:72-78` |

> **结论（FACT+INFERENCE）**：第三方编排状态**不要**写进会话事件日志。写自定义 `session.append('my/type')` 会让冷恢复在读路径直接失败（`dsh-session-persistence:184`）；`appendPluginRecord` 又不是给外部用的。正确落点是 `storageDomain` 或自有数据目录。

### 3.8 消息、唤醒与中断语义

| 动作 | 语义 | 证据 |
|---|---|---|
| `sendMessage(sender, child, content)` | 精确活 sender；直接子/直接父；运行中 steer，空闲起 turn；**返回受理 id，不返回回复** | `manager.js:473-500`；`dsh-tool-subagent-control:README.md:47` |
| 投递来源 | 模型消息落 `{kind:'agent-message', form:'relay', senderSessionId}` | `dsh-tool-subagent-control:README.md:73` |
| 冷恢复 | 需要 persistence + `sessionQuery.observeSession` + `descriptor.mode==='continuable'` + **精确活父**；否则 `NOT_RESUMABLE` | `manager.js:1192-1243` |
| `interrupt` | 只停当前 turn（`keepInbox:true`）；排队消息保留；后代继续；外部后端停唯一执行 | `manager.js:158-165`；`dsh-tool-subagent-control:README.md:51` |
| 宿主停止级联 | `workspace/session-stop` → 对每个 `origin:'subagent'` 的运行后代 `child.cancel({kind:'parent'})`（清 inbox） | `archive-admission.js:76-86` |
| 父 Agent 拆除 | `drainDescendants(parents)` child-first 释放；ACP/SDK 宿主在句柄关闭时调用 | `manager.js:236-307`；`dsh-acp:lib/index.js:915`；`dsh-sdk-jsonrpc-server:lib/index.js:691` |
| 父 turn 取消 | **不会**自动级联到子；只有父 Agent 拆除/宿主 stop 才级联 | **INFERENCE**（manager 只监听 `agent/disposed`，`:119-121`；无 cancel→drain 监听） |

### 3.9 内置 `spawn`/`fork` 工具与自建 `tree_send` 的关系

| 维度 | 内置工具 | `tree_send`（第三方） |
|---|---|---|
| 暴露面 | `subagent`（spawn）/ fork 实例；`send_message`/`interrupt_agent`/`list_agents` | 一个自定义工具 |
| 可达性 | 模型只能「直接子」或「直接父」 | 兄弟/跨层：用 Host 侧 `subagents.prompt()` 按 durable 父地址投递 |
| 返回 | 受理 id（不等待） | 受理 id |
| 代价 | —— | 目标必须 continuable；父必须 live；两个 root 之间仍不可达 |

**为什么必须存在（第三方源码自述，FACT）**：`ctx.subagents.sendMessage(sender, target)` 按精确活 sender 授权，强制直接父子邻接；兄弟→兄弟没有路径。而 `prompt(request)` 按 durable 父地址授权，可以从 Host 调用（`dsh-tree-harness/packages/dsh-session-tree/index.js:40-53`）。

> **INFERENCE（安全含义）**：`prompt()` 不验证「调用者 Agent」，只验证「父地址」。因此任何能执行 `tree_send` 的模型都能给任意 continuable 子会话发消息（只要知道 id 与其父）。编排契约必须自带 `callerNodeId` 校验。

---

## 4. 会话元数据、生命周期与钩子

### 4.1 元数据能力矩阵

| 需求 | 平台支持 | 证据 | 结论 |
|---|---|---|---|
| 给会话打 tag/label | ❌ | header 白名单（`dsh-session:lib/index.js:1831-1841`） | 自存（`sessionId` 为键） |
| 自定义 header 字段 | ❌（静默丢弃） | 同上 | 不要尝试 |
| 会话标题 | ✅ `ctx.sessionTitle.rename(session, title)` | `dsh-session-title:lib/index.js:301` | 可用于人类可读名，但**进不了模型**（`README:12`） |
| 子智能体标签 | ✅ `startActivation({label})` → `subagent/descriptor.label` | `descriptor.js:127-130` | 推荐把 `nodeId` 编码进 label |
| 工作区归属/置顶/归档 | ✅ workspace registry | `dsh-workspace:README.md:100-102` | 创建后需显式 attach |
| 每会话派生状态（可推给浏览器） | ✅ `ctx.sessionProjections.register({key, stateSchema, apply, wire})` | `dsh-session-projection:README.md:36-64` | 但只能从**会话事件**折叠；自有状态需另走 Remote |
| 任意持久化 KV | ✅ `ctx.storageDomain` | `dsh-storage-domain:README.md:40-58` | 编排账本首选 |
| 插件私有文件目录 | ⚠️ 无正式 API；`dsh-home-paths` 提供 home 解析 | `dsh-home-paths:README.md:31-41` | 可用 `resolveDshHome()/dshHomePath()`，不要读 `DSH_PROFILE_DIR` 环境变量（非契约） |

### 4.2 生命周期事件表（可订阅）

| 事件 | 载荷 | 派发模式 | 证据 |
|---|---|---|---|
| `session/created` | `session` | serial（创建监听器） | `dsh-session:lib/index.js:1850-1910` |
| `session/disposed` | `session` | emit | `dsh-session:README.md:34` |
| `session/event` | `(session, event)` | emit，逐监听器隔离 | `dsh-session:lib/index.js:1596-1601` |
| `agent/created` | `{agent, source:'startup' \| 'resume', signal?}` | serial | `dsh-agent:lib/types/index.js:348-352` |
| `agent/disposed` | `{agent}` | emit | `dsh-agent:lib/types/index.js:311` |
| `agent/status` | `{status}`（`running`/`idle`） | emit | `dsh-agent-loop:lib/index.js:562` |
| `turn/start` / `turn/end` | `{turn}` / `{turn, reason:{kind,...}}` | 会话事件 | `dsh-agent-loop:lib/index.js:731,819`；kind 来源 `:746-768,800-815` |
| `subagent/start` | `{runId, provider, id, local}` | scoped emit | `dsh-subagent:lib/types/lifecycle.js:47-53` |
| `subagent/end` | `{...identity, stopReason, lastAssistantMessage?}` | scoped emit | `lifecycle.js:54-61` |
| `workflow/start` / `workflow/end` / `workflow/phase` / `workflow/log` / `workflow/agent-start` / `workflow/agent-end` | 只读快照 | emit | `dsh-workflow:README.md:85` |
| `domain/changed` | 写后通知 | emit | `dsh-storage-domain:README.md:73` |

`turn/end.reason.kind` 的取值（从代码可见）：`completed`、`max-tokens`、`aborted`、`interrupted`、`error`、`blocked`（`dsh-agent-loop:lib/index.js:746-768,800-815`；`interrupted` 另由崩溃恢复 closer 产生，`dsh-session:lib/types/repair.js:88`；映射见 `dsh-subagent:lib/types/lifecycle.js:79-105`）。

### 4.3 Agent 级钩子（插件可挂）

| 钩子 | 模式 | 能力 | 证据 |
|---|---|---|---|
| `setup(agentCtx, agent)` | 创建期 | 给单个 Agent 注入工具/提示词/监听器/限制 | `dsh-agent:README.md:43,74` |
| `agent/pre-step` | waterfall | 拒绝/替换进入 step 的消息批次 | `dsh-agent-loop:lib/index.js:685` |
| `agent/turn-stopping` | serial | turn 即将关闭前拦截（可 steer 保持开启） | `dsh-agent-loop:lib/index.js:791` |
| `agent/request-error` | waterfall | 重试失败的模型请求 | `dsh-agent-loop:lib/index.js:929` |
| `agent/assistant-stream` | emit | 流式帧观察（仅呈现，不是回放源） | `dsh-agent-loop:lib/index.js:873` |
| `tools/pre-execute` | waterfall | allow/deny/ask | `dsh-tools:README.md:92` |
| `tools/execute` / `post-execute` / `result` | around/observe | 超时/重试/改结果/观察 | 同上 |
| `ctx.tools.guard(fn)` | 单调 guard | 在 pre-execute 之后、不可被翻案 | `dsh-tools:README.md:91` |
| `ctx.tools.restrict(filter)` | 作用域 | 收窄该 Agent 可见工具 | `dsh-tools:README.md:88` |
| `workspace/session-activity` | waterfall | 报告某会话还在跑什么 | `dsh-workspace:README.md:102` |
| `workspace/session-stop` | parallel | 请求停止 | 同上 |
| `approval/request` | waterfall | 应答审批 | `dsh-user-approval:README.md:31` |

> **FACT**：`subagent/start|end` 是 observe-only；平台明确「run-affecting 的 continuation/decision API 等具体消费者」（`dsh-subagent:README.md:213`）。编排层不能靠事件「驱动」状态，只能靠它「触发对账」。

---

## 5. 工作流引擎（`ctx.workflowEngine`）

### 5.1 API 形状

| 项 | 内容 | 证据 |
|---|---|---|
| 服务 | `WorkflowEngine extends Service`，服务名 `workflowEngine` | `dsh-workflow:lib/types/index.js:42-45` |
| 启动 | `ctx.workflowEngine.start({script, meta, args?, parent, signal?})` | `dsh-workflow:README.md:51` |
| 返回 run | `{id, meta, result, cancel(reason?), dispose()}` | `dsh-workflow:README.md:53` |
| 脚本 hook | `agent(prompt, opts?)`、`parallel()`、`pipeline()`、`phase()`、`log()`；顶层 await；`return <json>` | `dsh-workflow:README.md:36-45` |
| 结果 | `result` 永不 reject；失败 `stopReason:'error'`，取消 `'cancelled'` | `dsh-workflow:README.md:53` |
| 模型面 | `workflow` 工具**阻塞父 turn**，最终只给一个结果 | `dsh-workflow:README.md:32` |
| 引擎实现 | 随包为 PTC（独立 Node 进程 + 调用会话的文件沙箱） | `dsh-workflow-ptc:README.md:12,59` |

### 5.2 限制（全部 FACT）

| 限制 | 证据 |
|---|---|
| **一个 context 只能有一个 engine**（第二个 `provide` 抛 `service "workflowEngine" has been registered at ...`） | `cordis:lib/index.js:1400` |
| **无 journaling / resume**：脚本、子进度、中间值都不 checkpoint | `dsh-workflow:README.md:127` |
| **无保存/嵌套工作流**：脚本里没有 `workflow()` hook | `dsh-workflow:README.md:128` |
| **无 token 预算词汇**：只限制并发/条目/子数 | `dsh-workflow:README.md:129` |
| **前台收集**：caller 持有一个 live run 并等待；无后台 start/poll | `dsh-workflow:README.md:126` |
| **holder-owned**：engine 卸载不发现独立 live handle；每个消费者必须 dispose | `dsh-workflow:README.md:130` |
| **无整体时间上限**；PTC 只给初始同步片 `syncTimeoutMs`（默认 5000） | `dsh-workflow-ptc:README.md:45,156` |
| **VM 不是安全边界**；文件策略继承调用会话，网络不受文件策略限制 | `dsh-workflow-ptc:README.md:59,158` |
| **cap 是协作式**，不是宿主强制配额 | `dsh-workflow-ptc:README.md:155` |

> **结论**：`ctx.workflowEngine` 适合「一次性的 fan-out 脚本」，**不适合**作为需要持久、可恢复、可审计的 DAG 引擎。第三方流程引擎应把 PTC 当「执行器」而不是「状态机」。

---

## 6. 工具 / 服务 / 存储 / UI 扩展点

### 6.1 工具

| 能力 | API | 证据 |
|---|---|---|
| 定义 | `defineTool({name, description, parameters, output:{schema, render}, execute(args, exec)})` | `dsh-tools:README.md:45-61` |
| 注册 | `ctx.tools.register(def, {when?})`；`when` 每 step 求值一次 | `dsh-tools:README.md:69` |
| 作用域 | `agent.ctx` 内注册 = 只对该 Agent 生效，卸载即回收 | `dsh-agent:README.md:74` |
| 条件/遮蔽 | 同名替换会阻止未启动调用用旧定义；`restrict` 收窄 | `dsh-tools:README.md:71,88` |
| UI 卡片 | Client 按 wire tool name 从 `tool.call.toolview` 选渲染器；Host 的 `presentCall/Result` **不消费** | `dsh-tools:README.md:98`；`dsh-client-ui-tool:README.md:38-46` |
| 超时 | 定义上的 `timeoutMs` 只是声明；需 `dsh-tool-call-timeout-policy` | `dsh-tools:README.md:199` |

> **INFERENCE**：编排工具（`tree_plan`/`tree_dispatch`/`tree_verify`/`flow_run`）应作为普通工具注册，并用 `output.schema` 保证可回放；不要依赖 `presentCall`。

### 6.2 服务与依赖注入

| 机制 | 语义 | 证据 |
|---|---|---|
| 静态 `inject`（模块导出） | 硬依赖：服务不在则插件 fiber 不激活 | `dsh-agent-loop:lib/index.js:1299-1306` |
| `ctx.inject(names, cb)` | 等价于挂一个「依赖满足才 apply」的子插件；依赖消失则卸载 | `cordis:lib/index.js:1672-1677` |
| `ctx.get(name)` | 软探测：不存在返回 `undefined`，不抛 | `cordis:lib/index.js:1347-1356` |
| `ctx.provide` | 同名重复注册**直接抛错**，没有优先级/遮蔽 | `cordis:lib/index.js:1384-1414`（抛错在 `:1400`） |
| `ctx.effect` | 所有者生命周期；卸载按逆序回收 | `cordis:lib/index.js`（`ctx.provide` 内部即用） |

> **FACT**：平台没有「服务优先级/覆盖」机制（区别于 UI 槽位）。多编排引擎并存时，**服务名必须互不冲突**，否则第二个装不上。

### 6.3 存储

| 能力 | API | 证据 |
|---|---|---|
| 声明的域 | `defineDomain({name, version, tables:{...domainTable(schema)}})` | `dsh-storage-domain:README.md:40-45` |
| 打开 | `const d = await ctx.storageDomain.open(spec)` | `:52` |
| 读写 | `d.table('x').get/put/update/delete/deleteMany`；读同步、写持久化后才 resolve | `:53-56`；`lib/index.js:254-306` |
| 变更 | 每次写发 `domain/changed`（进程内） | `:73,146` |
| 限制 | 单进程可见；无跨表事务/二级索引/多段键；无值迁移 runner | `:146-148` |

> **建议**：编排账本用**一个域 + 三张表**（`runs`/`nodes`/`journal`），以 `runId`、`nodeId` 为主键，`revision` 做 CAS；不要期望平台给事务。

### 6.4 Web / HTTP

| 能力 | API | 证据 |
|---|---|---|
| 命名路由 | `ctx.webServer.register({kind:'exact' \| 'prefix', path, handler \| resource})`；重复 (kind,path) 抛错 | `dsh-host-webserver:lib/index.js:375-380`；`README:61` |
| 升级路由 | `registerUpgrade({path, handler})` | `README:61` |
| 兜底 | `registerFallback(handler \| {resource})`；只能一个 | `README:67` |
| 首页注入 | `webserver/index-inject` + `renderIndex` | `README:69` |

### 6.5 Client 插件与 Slot

**声明**（`package.json`）：`dsh.client = {platform:'web', immediately?, inject?:[...] , external?:[...]}` + `exports["./client"]`（`dsh-client-modules:README.md:33-34`；实证 `dsh-tree-harness/packages/dsh-session-tree/package.json:44-57`）。

**槽位 API**（Client 侧）：

| 方法 | 语义 | 证据 |
|---|---|---|
| `ctx.slots.register({name, key?, priority?, order?, id?}, Component)` | 向某槽位注册；`priority` 决定同 cell 的遮蔽顺序（**最低者胜**；单占槽位同优先级会在加载时抛错） | `dsh-client-ui-renderer:lib/client.js:1546-1555`（注释）；实证 `dsh-tree-harness/packages/dsh-session-tree/README.md:264,294` |
| `ctx.slots.inject(name, factory)` | 延迟到槽位声明存在后再注册（避免 boot 顺序问题） | `dsh-client-ui-renderer:lib/client.js:1394-1426` |
| `ctx.slots.provideRoot({hooks \| sources, props})` | 贡献全局数据（hook 名全局唯一） | `dsh-client-ui-renderer:lib/client.js:1465-1484` |
| `ctx.slots.entries/subscribe/getVersion` | 只读观察 | `:1542-1601` |

**布局槽位**（`dsh-client-ui-layout:README.md:29-45`）：`root`、`sidebar.*`、`main`（keyed，`conversation` 保留）、`rightbar`、`shell.bottom`、`shell.overlay`、`shell.leading`。

### 6.6 自定义面板/覆盖层的可行组合

| 目标 | 做法 | 证据 |
|---|---|---|
| 全局侧栏树（替换工作区浏览器） | `ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({name:'sidebar.workspaces', priority:-100}, Comp))` | 实证 `dsh-tree-harness/packages/dsh-session-tree/client.js:2035-2036` |
| 新主面板页 | 在 `main` 注册带 `key` 的条目 + `ctx.layout.selectPanel(key)` | `dsh-client-ui-layout:README.md:36` |
| 底部状态条/全屏覆盖层 | `shell.bottom` / `shell.overlay` | `dsh-client-ui-layout:README.md:38` |
| 会话内工具卡片 | `tool.call.toolview` + wire tool name | `dsh-client-ui-tool:README.md:38-46` |
| 打开某节点会话 | `ctx.uiWorkspace.openSession(sessionId)` 或 `{parentSessionId, childSessionId, mode}` | 实证 `dsh-tree-harness/packages/dsh-session-tree/client.js:1231-1241` |
| 浏览器读 Host 编排状态 | Host 侧 `@Remote` 方法 + Client `ctx.remote.<ns>.<method>` | `dsh-typert-protocol:README.md:31-44` |

> **FACT**：平台内置的子会话树只在「会话 header 的 popover」里，且普通侧栏**省略子会话**（`dsh-client-ui-subagent:README.md:12,28-36`）。因此「全局多树/多 run 拓扑」必须自建。

---

## 7. 权限与预算

### 7.1 权限继承矩阵（FACT）

| 维度 | 顶层会话 | in-process 子会话 | 证据 |
|---|---|---|---|
| sandbox mode | 部署默认 → `sandbox/mode` 会话覆盖 | **只复制父的显式覆盖**（非部署默认、非一次性 grant） | `child-agent.js:180-187`；`sandbox-policy:README.md:74,78` |
| approval policy | `ask`（默认）→ `approval/policy` 覆盖 | **若部署挂载了 approval 服务，则强制 `never`**（无论父策略）；未挂载则不写 | `child-agent.js:185` |
| permission preset | 用户选择 → `permission/preset` | 仅当父是 `auto`/`danger-full-access` 时复制；否则不写 | `child-agent.js:183` |
| 模型路由 | 父最新 request header 或 creation options | 继承父 provider/model/effort/maxTokens，可被 `agentOptions` 覆盖 | `child-agent.js:49-92` |
| 递归深度 | 0 | 父 +1，持久化到 header | `child-agent.js:31-40,107-121` |
| 工具集 | preset composition | 同 preset 或独立 preset；可用 `toolFilter` 收窄 | `child-agent.js:140-168` |

> **重要**：子会话在运行时上下文里会收到一句固定声明——权限在启动时固定、不能从内部放宽、审批自动拒绝（`child-agent.js:127-130`）。这解释了「子智能体默认不可升级权限」的设计。

### 7.2 级联矩阵（谁能停谁）

| 发起方 | 动作 | 影响范围 | 证据 |
|---|---|---|---|
| 父 Agent | `agent.cancel(cause)` | **只当前 Agent**；默认清 inbox（`keepInbox` 可保留） | `dsh-agent:README.md:58,208` |
| 父/祖先 | `ctx.subagents.interrupt(child)` | **只目标当前 turn**；保留排队消息；后代继续 | `manager.js:158-165` |
| 宿主 stop（归档/停止） | `workspace/session-stop` | 每个运行中的 `origin:'subagent'` 后代 `cancel({kind:'parent'})`（清 inbox） | `archive-admission.js:76-86` |
| 父 Agent 拆除 | `drainDescendants` | 整个后代森林 child-first 释放 | `manager.js:236-307` |
| workflow run | `run.dispose()` | 取消脚本 + 停 PTC 进程 + 释放子 | `dsh-workflow:README.md:53`；`dsh-workflow-ptc:README.md:61` |
| 浏览器 | `subagents/interruptByParent` | 单子当前 turn；父可离线 | `dsh-subagent:lib/types/index.js:353-365` |

### 7.3 预算原语盘点

| 原语 | 粒度 | 是否强制 | 证据 |
|---|---|---|---|
| `subagents.maxDepth`（默认 1） | 递归深度 | 是（创建时拒） | `dsh-subagent:lib/types/index.js:75-78`；`child-agent.js:36-39` |
| `subagents.maxActiveSubagents`（默认 8） | 每根 activation 树的**活跃槽位** | 是（进程内，满则 `ACTIVATION_LIMIT_REACHED`） | `README:51-57` |
| workflow `maxConcurrentAgents`/`maxTotalAgents`/`maxItemsPerCall` | 单 run | 是（协作式） | `dsh-workflow-ptc:README.md:40-47` |
| agent-team `maxMembers`/`maxTasks`/`maxMessageBytes` | 单 team | 是 | `dsh-experimental-agent-team:README.md:49-54` |
| goal `maxGoalRounds`（默认 256） | 单会话目标 | 是（轮数） | `dsh-goal:README.md:44-48` |
| `tokenMeter.measure/contextPressure` | 单会话测量 | **否**（只测量，不拒绝） | `dsh-token-meter:README.md:36,49` |
| token/成本/时间预算 | —— | **不存在** | `dsh-workflow:README.md:129`（明确无）；`dsh-agent-loop:lib/index.js:1308-1320`（只有 `maxParallelToolCalls`/`maxTokens`） |

> **结论**：平台只有「并发/深度/轮数」这类**结构性硬上限**，没有「花多少 token / 跑多久」的预算语义。编排层必须自己实现预算账本，并把 `maxTokens`（单次输出上限）与「累计预算」区分开。

---

## 8. 插件组合与兼容

### 8.1 分层顺序（FACT）

```text
空 root
 → 各 bundle 的 patch（按 dsh.profile.bundles 顺序）
 → 用户 profile 的 cordis.patch.yml
 → home 级 $DSH_HOME/cordis.patch.yml
 → --patch overlays
```

证据：`dsh:README.md:41-46`。行级语义：**按 id 定位、后写覆盖整行 config**（不是 merge）；行顺序不表达加载顺序，激活由「服务是否可用」驱动（`dsh-base:cordis.patch.yml:3-13`）。

### 8.2 服务注册冲突/遮蔽

| 面 | 规则 | 证据 |
|---|---|---|
| Host 服务（`ctx.provide`） | 同名**抛错**；无优先级、无覆盖 | `cordis:lib/index.js:1400` |
| Subagent provider | 同名 `DUPLICATE_PROVIDER` | `dsh-subagent:lib/types/index.js:381-383` |
| 工具 | 同名可替换/遮蔽；`restrict` 可收窄 | `dsh-tools:README.md:71,88` |
| Workflow engine | 单例（第二条 provide 抛错） | `cordis:lib/index.js:1400` |
| Client Slot | 有 `priority`（最低者胜）+ 失败让位（abdication）；**单占槽位同优先级 → 加载时抛错** | `dsh-client-ui-renderer:lib/client.js:1546-1555`；实证 `dsh-session-tree/README.md:264,294` |

> **INFERENCE**：多 bundle 想「增强」同一能力时，Host 侧只能**换实现**（禁用原行 + 挂新行），不能叠加；UI 侧才能叠加/遮蔽。

### 8.3 依赖与降级

| 模式 | 写法 | 行为 |
|---|---|---|
| 硬依赖 | `export const inject = ['tools','subagents']` 或 `ctx.inject([...], cb)` | 服务缺失 → 插件不激活/被卸载，不降级 |
| 软探测 | `ctx.get('sessionQuery')` | 返回 `undefined`，调用方自行降级 |
| 可选贡献 | `ctx.inject(['sessionProjections'], ...)` | 有则注册，无则跳过 |

实证：`dsh-tree-harness/packages/dsh-session-tree/index.js:1379-1383` 用 `ctx.inject([...])` 拿工具作用域，用 `requestedService()` 软探测 `permissionPresets/sandboxPolicy/approval/tokenMeter`，缺失时返回 `unavailable` 而不是崩。

### 8.4 版本/兼容策略

| 机制 | 规则 | 证据 |
|---|---|---|
| 安装期检查 | `engines.dsh`，否则 DSH peer 范围；不满足直接拒装 | `dsh-plugin-manager:README.md:77` |
| 启动期检查 | 同一运行时版本；不兼容插件拒绝启动 | `dsh:README.md:39` |
| 豁免 | 精确 `package@version` × 精确 runtime version，写入 profile 的 `compatibility.json`；须显式接受风险 | `dsh-plugin-manager:README.md:79-83` |
| Client 侧 | 页面绑定 Host release（version+commit）；release 不一致时**不加载**新插件，直到刷新 | `dsh-client-modules:README.md:51` |
| 会话格式 | 版本化 + 迁移链 + `ignorable` 未知事件保留 | `dsh-session:README.md:205` |

### 8.5 实证：API 形状漂移是真实风险

第三方树引擎自带兼容层，记录了两代形状（`dsh-tree-harness/packages/dsh-tree-engine/src/compat.js:5-15`）：

- 旧：`startContinuable({provider,label,signal,request})` → `{childId|sessionId|session.id}`
- 新：`startActivation({provider,label,request,signal,delivery})` → `{childId|messageId,result,dispose}`
- `interrupt` 的 authority 也从 `{kind:'parent',parentSessionId}` 变为 `{kind:'ancestor',agent}|{kind:'user',parentSessionId}`

> **建议**：编排插件对 `subagents` 做「能力探测 + 双形解析 + fail-closed」，并把探测结果写进启动诊断；不要写死单一代形状。

---

## 9. 职责边界：平台 vs 编排层

### 9.1 内置子智能体 vs 第三方树形任务引擎（RACI）

| 能力 | DSH 平台 | tree-engine | 说明 |
|---|---|---|---|
| 会话创建/恢复 | **R/A** | C | `agents.create/resume` |
| 消息投递/唤醒 | **R/A** | C | `sendMessage`/`prompt` |
| 中断 | **R** | C | 只停当前 turn |
| 权限级联 | **R/A** | C（快照请求） | `sandbox/mode`/`approval/policy` |
| 日志/持久化 | **R/A** | I | 不要自建会话日志 |
| 谱系发现 | **R** | C | `listChildren`/`traceSession` |
| 任务树/DAG 语义 | — | **R/A** | 平台无 |
| 依赖/就绪/重试 | — | **R/A** | 平台无 |
| DoD/验证 | — | **R/A** | 平台无 |
| 预算记账 | — | **R/A** | 平台无 |
| 调用者身份（durable） | — | **R/A** | 平台无 |
| 拓扑 UI | C（槽位） | **R/A** | 平台只给容器 |
| 跨引擎注册 | — | **R/A** | 平台无 |
| 工作区归属 | C（API） | **R** | 需显式 attach |

### 9.2 与实验性 `agent-teams` 的重叠（必须知道）

平台已有一个**实验性**团队服务 `ctx.agentTeams`（`dsh-experimental-agent-team`），它已经实现了：

| 能力 | 实现 | 证据 |
|---|---|---|
| 持久 roster | Lead 会话日志里的 `team/member` | `README:126,144` |
| 共享任务板 | `team/task` + `expectedRevision` CAS + 依赖 DAG 校验 | `README:72-78,136` |
| 成员消息 | Lead→子 steer；成员间 sendMessage | `README:66-70` |
| 等待变更 | `waitForChange()`（10s–1h） | `README:82,140` |
| 上限 | `maxMembers`/`maxTasks`/`maxMessageBytes` | `README:49-54` |

**但它不是树引擎**：Team 是「一个 Lead + 扁平成员 + 扁平任务板」，没有多层 commander、没有 DoD/验证、没有预算、没有拓扑视图，且是 experimental、默认不在主线（`README:12,32`）。

> **INFERENCE**：树引擎不要重复实现「消息/roster」这一层（可用 `subagents` + 自建轻量 roster），但任务板可以借鉴其 **CAS + 完整快照 + tombstone** 语义；不要直接复用 `agentTeams`（实验性、事件类型是仓内私有）。

### 9.3 与 `workflowEngine` 的边界

| 场景 | 用 workflowEngine | 用自建 DAG 引擎 |
|---|---|---|
| 一次性 fan-out（审查 N 个文件） | ✅ | 过度设计 |
| 需要跨重启恢复 | ❌ | ✅ |
| 需要人类审批门/断点 | ❌（脚本内做不到持久门） | ✅ |
| 需要 token 预算/成本核算 | ❌ | ✅ |
| 需要可视化运行图 | ❌（只有 phase/log） | ✅ |
| 需要嵌套子流程 | ❌ | ✅ |

---

## 10. 平台缺口清单（必须自建）

> 每条都给「现状证据 → 契约建议」。编号对应 §0.3。

### G1 任务图/树持久化

- **现状**：无图 API；`storageDomain` 只有 KV；无跨表事务/二级索引；会话树「除 fork 外不存在」（`dsh-session:README.md:207`）；实验 team board 是扁平且私有事件（`dsh-experimental-agent-team:README.md:134-136`）。
- **必须自建**：
  - `RunRecord { runId, kind:'tree'|'dag', specVersion, status, createdAt, budget, revision }`
  - `NodeRecord { runId, nodeId, parentNodeId?, deps[], state, attempt, sessionId?, dispatchSpecHash, resultRef?, verification?, revision }`
  - `JournalEntry { runId, rev, op, payload, at, idempotencyKey }`
  - 单一写链 + `expectedRevision` CAS + 快照/日志分离（日志 append-only，快照可重建）。
- **落点**：`ctx.storageDomain`（一个域三张表），或自有目录（若域不可用则 fail-closed 提示安装 storage 组件）。

### G2 预算记账

- **现状**：无预算原语（§7.3）。
- **必须自建**：
  - `Budget { maxTokens?, maxWallMs?, maxNodes?, maxConcurrent?, maxAttemptsPerNode? }`
  - `Reservation { runId, nodeId, reservedTokens, reservedAt, expiresAt }`
  - 结算：`tokenMeter.measure(session)`（`surfaceTokens/totalTokens/nodes`），provider usage 只在 canonical envelope 命中时复用（`dsh-token-meter:README.md:43-45`）。
  - 拒绝策略：预留失败即 `blocked`，不派发。
- **注意**：`maxActiveSubagents` 是进程内槽位，不能当累计预算；`maxTokens` 是单次输出上限，不能当 run 预算。

### G3 调用者身份（durable / 跨进程）

- **现状**：initiator 是进程内（`dsh-agent:README.md:12,205`）；header 白名单（`dsh-session:lib/index.js:1831-1841`）；`prompt()` 只按父地址授权（`dsh-subagent:lib/types/index.js:298-337`）。
- **必须自建**：
  - 账本内 `sessionId ↔ {runId, nodeId, attempt, parentNodeId}` 映射（唯一 durable 关联）。
  - `label` 编码 `runId/nodeId`（进入 `subagent/descriptor.label`，可被 `listChildren` 读回）。
  - 首条 prompt 加一行机读前缀（模型可见，便于自证；不是授权）。
  - 每次跨节点消息带 `callerNodeId`，由编排工具校验（不要依赖平台邻接授权）。

### G4 节点验证/DoD

- **现状**：无 verify 服务；`outputSchema` 只到 activation，不持久（`descriptor.js:16-19`）。
- **必须自建**：
  - `Dod { ref, checks:[{kind:'command'|'llm'|'artifact'|'human', spec, timeoutMs}], requireEvidence:boolean }`
  - `VerificationResult { nodeId, attempt, verdict:'pass'|'fail'|'inconclusive', evidenceRefs[], verifier, at }`
  - 验证必须由**独立会话或独立进程**执行，不能复用执行节点的自述。
  - 证据引用指向：文件路径、命令输出、`sessionId@seq`、外部 URL。

### G5 拓扑 UI

- **现状**：内置只有 header popover 子会话树（`dsh-client-ui-subagent:README.md:28-36`）；侧栏隐藏子会话（`:12`）。
- **必须自建**：
  - Host：`@Remote` 的 `getTreeSnapshot(runId)` / `command(runId, cmd, expectedRevision)`。
  - Client：`sidebar.workspaces` 座位（priority < 0）或 `main` keyed 面板；节点点击用 `ctx.uiWorkspace.openSession({parentSessionId, childSessionId, mode})`。
  - 不要在 Client 里重算状态：只渲染 Host 投影。

### G6 跨引擎组合注册表

- **现状**：无注册表；`workflowEngine` 单例；`subagents` provider 是唯一可插拔执行面。
- **必须自建**：
  - 指定**唯一 owner 插件** provide `orchestration` 服务：
    ```ts
    interface OrchestratorRegistry {
      register(engine: { id, kind:'tree'|'dag', capabilities, describe(): EngineDescriptor }): Disposer
      list(): EngineDescriptor[]
      route(request: { kind, requiredCapabilities }): EngineDescriptor | undefined
    }
    ```
  - 其他引擎用 `ctx.get('orchestration')` 软探测；缺失时降级为「只用自己的工具名」。
  - 不要试图注册第二个 `workflowEngine`（会抛错）。

### G7 会话归属（workspace）

- **现状**：`agents.create`/`startActivation` 不写 workspace；只有 API controller/schedule 调 `attachSession`（`dsh-api-session-controller:lib/index.js:809`；`dsh-schedule:lib/index.js:1514`）。
- **必须自建**：派发成功后 `workspaceRegistry.resolveByPath(cwd)` → `workspace.attachSession(sessionId)`；失败只告警，不回滚会话（实证：`dsh-tree-harness/packages/dsh-session-tree/index.js:1029-1034`）。

### G8 会话级标签/元数据

- **现状**：header 白名单；无 tags/labels（§4.1）。
- **必须自建**：账本 `sessionId` 索引 + `label` 编码 + 可选 `sessionTitle.rename()` 做人类可读标题。不要把业务状态塞 header。

### G9 消息幂等/崩溃重放

- **现状**：无 exactly-once；accepted-but-unlogged 会丢（`dsh-subagent:README.md:211-212`）；无 durable parent mailbox（`:212`）；activation inbox 不跨进程（`:210`）。
- **必须自建**：
  - `idempotencyKey = hash(runId,nodeId,attempt,kind)`；账本记录 `sentAt/ackedAt`。
  - 对账时以「会话日志里的 `user/message`/`turn/start`」为到达证据，而不是以 `sendMessage` 返回为准。
  - 超时重发必须查重（同 key 只发一次）。

### 补充缺口（次级）

| # | 缺口 | 证据 | 影响 |
|---|---|---|---|
| G10 | 第三方不能注册新会话事件类型 | `known-event-types.js:21-84`；`dsh-session-persistence:184` | 状态不能进日志 |
| G11 | 无后台/离屏 run 服务 | `dsh-workflow:README.md:126`；subagent activation 依附父 residency | 长任务需父常驻或自己做 |
| G12 | 无跨进程共享存储协调 | `dsh-storage-domain:README.md:146`；`dsh-subagent:README.md:210` | 多 Host 并发需自建 lease |

---

## 11. 编排契约 v0（建议稿）

> 目标：让「树引擎」与「DAG 引擎」共享同一层 DSH 适配，不互相重造。契约分四段：**派发 / 账本 / 观测 / 视图**。

### 11.1 分层图

```text
┌──────────────────────────── 编排层（自建） ────────────────────────────┐
│  TreeEngine / DagEngine → Scheduler → Verifier → BudgetLedger          │
│            │                 │            │            │               │
│            └────── OrchestrationStore（CAS + journal） ─┘               │
│                              │                                         │
│                   DshAdapter（唯一平台耦合点）                           │
└──────────────────────────────┼─────────────────────────────────────────┘
                               │ 只用这些平台原语
  agents.create/resume · subagents.startActivation/sendMessage/interrupt
  sessionQuery · sessionProjections · tokenMeter · workspace · slots/@Remote
```

### 11.2 接口 A：`DshAdapter.spawnNode`（派发契约）

```ts
interface SpawnNodeSpec {
  // 身份（平台不存，编排层负责）
  runId: string                 // 一次 run
  nodeId: string                // 图内节点
  attempt: number               // 从 1 开始
  idempotencyKey: string        // sha256(runId,nodeId,attempt,'spawn')

  // 平台身份
  sessionId?: string            // 预留；不给则平台生成
  parentAgent: Agent            // 精确活 Agent（平台强校验）
  parentSessionId?: string      // 仅写 header.parentSession，用于谱系
  cwd: string                   // 绝对路径
  label: string                 // 建议 `${runId}/${nodeId}/${attempt}`

  // 组合快照（冻结）
  agentPreset?: string
  agentOptions?: {
    provider?: string
    model?: string
    reasoningEffort?: string
    maxTokens?: number
  }

  // 权限快照（冻结）
  permission?: {
    preset?: 'auto' | 'danger-full-access'
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
    approvalPolicy?: 'never' | 'ask'   // 平台对 in-process 子强制 never
  }

  // 任务
  prompt: ContentBlock[]
  outputSchema?: JsonSchema     // activation 级，不持久
  maxDepth?: number
  delivery: 'parent' | 'caller'

  // 编排层预算（平台不认，自己执行）
  budget?: { maxTokens?: number; maxWallMs?: number; maxTurns?: number }
  verification?: { dodRef: string; timeoutMs: number }
}

interface SpawnNodeResult {
  sessionId: string
  messageId: string
  activation: { dispose(): Promise<void> }  // 平台句柄
  // 注意：不要在这里等 result；结果走观测契约
  workspace: { attached: boolean; reason?: string }
}
```

**平台映射**：

| 契约字段 | 平台调用 | 备注 |
|---|---|---|
| `parentAgent` | `startActivation({request:{parent}})` | 必须是 `ctx.agents.get(id) === agent` 的那个对象 |
| `sessionId` | `startActivation({childId})` | 预留 id 要求 local backend，并保证返回 `messageId` |
| `label` | `startActivation({label})` | 写入 `subagent/descriptor.label` |
| `permission` | `setup()` 内 `session.append('sandbox/mode' \| 'approval/policy' \| 'permission/preset')` | 参考 `child-agent.js:197-207` |
| `agentPreset` | `request.agentPreset`（仅 spawn） | fork 拒绝 |
| `outputSchema` | `request.outputSchema` | 仅本次 activation |
| `cwd` | `request.cwd` | 相对路径按父 cwd 解析 |
| workspace | 派发后 `attachSession` | 失败告警不回滚 |

### 11.3 接口 B：`OrchestrationStore`（账本契约）

```ts
interface RunRecord {
  runId: string
  kind: 'tree' | 'dag'
  specVersion: number
  status: 'created' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled'
  createdAt: number
  updatedAt: number
  revision: number
  budget: Budget
  rootSessionId?: string
}

interface NodeRecord {
  runId: string
  nodeId: string
  parentNodeId?: string
  deps: string[]
  state: 'PENDING' | 'READY' | 'DISPATCHED' | 'RUNNING' | 'VERIFYING'
       | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED'
  attempt: number
  sessionId?: string
  dispatchHash?: string          // 冻结 spec 的哈希
  lastSeen?: { turn?: number; seq?: number }
  terminal?: TerminalFact
  verification?: VerificationResult
  revision: number
}

interface JournalEntry {
  runId: string
  rev: number
  at: number
  op: 'run.create' | 'node.ready' | 'node.dispatch' | 'node.settle'
    | 'node.verify' | 'budget.reserve' | 'budget.settle' | 'run.close'
  payload: JsonValue
  idempotencyKey: string
}
```

**不变量**：
- 任何 `node.state` 变更必须 `expectedRevision` 匹配，否则 `STALE_REVISION`。
- `DISPATCHED` 之前必须先 `budget.reserve` 成功。
- `SUCCEEDED` 必须伴随 `verification.verdict === 'pass'`；否则最多 `VERIFYING`/`FAILED`。
- 删除节点只做 tombstone（保留 id 稳定，参考 team board `README:136`）。

### 11.4 接口 C：`Observer / Reconciler`（观测契约）

```ts
type TerminalKind =
  "completed" | "max-tokens" | "aborted" | "interrupted"
  | "error" | "blocked" | "unknown"

interface TerminalFact {
  sessionId: string
  runId: string
  nodeId: string
  attempt: number
  kind: TerminalKind
  stopReason?: string            // subagent/end 的 stopReason
  lastTurn?: number
  lastSeq?: number
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  outputText?: string
  structured?: JsonValue
  source: 'log-fold' | 'live-result'
}
```

**订阅**（触发对账，不驱动状态）：

| 事件 | 用途 |
|---|---|
| `agent/created{source}` | 发现 resume/startup |
| `agent/status{status}` | running/idle 近似 |
| `session/event`（`turn/end`） | 终态权威 |
| `subagent/end{stopReason}` | 子激活终态（含 external） |
| `workflow/end` | 流程 run 终态 |
| `domain/changed` | 账本自身变更（可选） |

**对账算法**（冷启动/重连）：

```text
for each node in RUNNING|DISPATCHED|VERIFYING:
  obs = sessionQuery.observeSession(node.sessionId)
  if obs missing: mark FAILED(lost) unless retry budget
  fold own events:
    last turn/end.reason.kind → TerminalKind
    last assistant/message → outputText
    tool/result(meta).usage → usage（可选）
  if terminal: verify → settle
  else if agent live and status running: keep
  else: mark STALLED → retry or fail
```

**终态映射表**：

| `turn/end.reason.kind` | 节点状态 | 说明 |
|---|---|---|
| `completed` | → `VERIFYING` | 执行完成 ≠ 验收通过 |
| `max-tokens` | `FAILED`（可重试） | 预算/长度 |
| `aborted` / `interrupted` | `CANCELLED` | 区分用户取消与系统中断可用 `stopReason` |
| `error` | `FAILED` | |
| `blocked` | `BLOCKED` | 被 hook/policy 拒绝 |
| 无 `turn/end` | `FAILED(never-ran)` | 冷恢复时以日志为准 |

### 11.5 接口 D：`UiBridge`（视图契约）

```ts
interface TreeSnapshot {
  runId: string
  kind: 'tree' | 'dag'
  status: RunRecord['status']
  revision: number
  nodes: Array<{
    nodeId: string
    parentNodeId?: string
    title: string
    state: NodeRecord['state']
    address?: { parentSessionId: string; childSessionId: string; mode: 'continuable'|'one-shot'|'unknown' }
    badges?: { running?: boolean; tokens?: number; durationMs?: number }
    verification?: { verdict: string; evidenceCount: number }
  }>
  edges: Array<{ from: string; to: string; kind: 'tree'|'dep'|'data' }>
  updatedAt: number
}

interface UiBridge {
  getSnapshot(runId: string): Promise<TreeSnapshot>
  subscribe(runId: string, cb: (s: TreeSnapshot) => void): Disposer
  command(runId: string, cmd: TreeCommand, expectedRevision: number): Promise<CommandResult>
}
```

**UI 落点建议**：

| 需求 | 落点 |
|---|---|
| 全局多 run 列表 + 树 | `sidebar.workspaces`（priority 取负，压过默认 WorkspaceBrowser） |
| 单 run 大图（DAG） | `main` keyed 面板 + `ctx.layout.selectPanel('orchestration')` |
| 节点会话 | `ctx.uiWorkspace.openSession({parentSessionId, childSessionId, mode})` |
| 实时运行条 | `shell.bottom` |
| 审批/告警浮层 | `shell.overlay` |

### 11.6 最小字段表（可直接抄进 schema）

| 契约 | 必填字段 |
|---|---|
| `SpawnNodeSpec` | `runId,nodeId,attempt,idempotencyKey,parentAgent,cwd,label,prompt,delivery` |
| `RunRecord` | `runId,kind,specVersion,status,createdAt,revision,budget` |
| `NodeRecord` | `runId,nodeId,deps,state,attempt,revision` |
| `TerminalFact` | `sessionId,runId,nodeId,attempt,kind,source` |
| `TreeSnapshot` | `runId,kind,status,revision,nodes,edges,updatedAt` |
| `VerificationResult` | `nodeId,attempt,verdict,evidenceRefs,verifier,at` |

### 11.7 错误码/幂等/对账规则（建议）

| 场景 | 错误码 | 处理 |
|---|---|---|
| 平台不兼容（缺 `startActivation`） | `E_DSH_CAPABILITY` | fail-closed，启动诊断列出缺失服务 |
| 重复派发（同 idempotencyKey） | `E_DUPLICATE_DISPATCH` | 返回既有 sessionId，不新建 |
| 账本 revision 过期 | `E_STALE_REVISION` | 调用方重读后重试 |
| 容量满（`ACTIVATION_LIMIT_REACHED`） | `E_CAPACITY` | 入队等待，不重试风暴 |
| 子会话不可恢复 | `E_NOT_RESUMABLE` | 标记 node `FAILED`，按策略重派新 attempt |
| 预算不足 | `E_BUDGET_EXHAUSTED` | 节点 `BLOCKED`，run 可 `paused` |
| 验证失败 | `E_DOD_FAILED` | 记录证据，按 `maxAttempts` 重试 |

---

## 12. 未解问题（UNKNOWN）

| # | 问题 | 为什么未解 | 下一步 |
|---|---|---|---|
| U1 | 第三方 Client 插件能否稳定拿到「所有会话 + parentId」而不依赖内部 `useSessions` prop | 树插件用的是注入 props/`ctx.remote`，但 `useSessions` 的正式公共面未在 asar 文档中确认 | 查 `dsh-client-ui-session` 的公共导出与 `dsh-api-session-controller` 的 projection 契约 |
| U2 | `sessionQuery.observeSession` 的完整签名/过期策略 | 只从 subagent 调用点间接看到 `{signal}` / `{projectionMode:'none'}` | 读 `dsh-session-query` 的类型源或 `README:108-110` |
| U3 | `workspace/session-stop` 的「运行中」判定是否会漏掉刚唤醒的子 | 需要跑真实场景验证 | 设计实验：归档 → 观察是否仍有子 turn |
| U4 | 多 Host 进程共享同一 profile 时的写入仲裁 | 平台明确未提供 lease | 自建文件锁/单写者 |
| U5 | `permissionPresets.permissionState(session)` 的来源（投影 or 服务） | 树插件用软探测调用，asar 中只见 `current()` | 读 `dsh-permission-presets` 的类型源 |
| U6 | `caller` delivery 的 workflow 子会话在 run dispose 后是否仍可冷恢复 | README 说需 persistence+query；未实测 | 设计实验：dispose 后 `send_message` |

---

## 附录 A：asar 路径缩写与关键行号索引

**根**：`D:\DSHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\`

| 缩写 | 完整路径 |
|---|---|
| `dsh-subagent` | `dsh-subagent\lib\types\index.js`、`manager.js`、`lifecycle.js`、`child-agent.js`、`descriptor.js`、`catalog.js`、`archive-admission.js` |
| `dsh-agent` | `dsh-agent\lib\types\index.js`、`README.md` |
| `dsh-agent-loop` | `dsh-agent-loop\lib\index.js`、`README.md` |
| `dsh-session` | `dsh-session\lib\index.js`、`lib\types\index.js`、`lib\types\known-event-types.js`、`README.md` |
| `dsh-session-query` | `dsh-session-query\lib\index.js`、`README.md` |
| `dsh-session-persistence` | `dsh-session-persistence\lib\index.js` |
| `dsh-session-persistence-jsonl` | `dsh-session-persistence-jsonl\README.md` |
| `dsh-session-projection` | `dsh-session-projection\README.md` |
| `dsh-session-projection-cache` | `dsh-session-projection-cache\README.md` |
| `dsh-workflow` | `dsh-workflow\lib\types\index.js`、`README.md` |
| `dsh-workflow-ptc` | `dsh-workflow-ptc\README.md` |
| `dsh-tools` | `dsh-tools\README.md` |
| `dsh-storage-domain` | `dsh-storage-domain\README.md`、`lib\index.js` |
| `dsh-host-webserver` | `dsh-host-webserver\lib\index.js`、`README.md` |
| `dsh-client-ui-renderer` | `dsh-client-ui-renderer\lib\client.js` |
| `dsh-client-ui-layout` | `dsh-client-ui-layout\README.md` |
| `dsh-client-ui-tool` | `dsh-client-ui-tool\README.md` |
| `dsh-client-ui-subagent` | `dsh-client-ui-subagent\README.md` |
| `dsh-client-modules` | `dsh-client-modules\README.md` |
| `dsh-typert-protocol` | `dsh-typert-protocol\README.md` |
| `dsh-permission-presets` | `dsh-permission-presets\README.md` |
| `dsh-sandbox-policy` | `dsh-sandbox-policy\README.md` |
| `dsh-user-approval` | `dsh-user-approval\README.md` |
| `dsh-workspace` | `dsh-workspace\lib\index.js`、`README.md` |
| `dsh-api-session-controller` | `dsh-api-session-controller\lib\index.js`、`README.md` |
| `dsh-token-meter` | `dsh-token-meter\README.md` |
| `dsh-goal` | `dsh-goal\README.md` |
| `dsh-experimental-agent-team` | `dsh-experimental-agent-team\README.md` |
| `dsh-plugin-manager` | `dsh-plugin-manager\README.md` |
| `dsh` | `dsh\README.md`、`dsh\package.json` |
| `cordis` | `cordis\lib\index.js` |

**第三方实证**：

| 文件 | 用途 |
|---|---|
| `D:\Codes\dsh-tree-harness\packages\dsh-session-tree\index.js` | `tree_send` 存在原因（40-53）、`agents.create` + workspace attach（1018-1036） |
| `D:\Codes\dsh-tree-harness\packages\dsh-session-tree\client.js` | `ctx.slots.inject/register`（2035-2036）、`uiWorkspace.openSession`（1231-1241） |
| `D:\Codes\dsh-tree-harness\packages\dsh-tree-engine\src\compat.js` | API 形状漂移（5-15） |
| `D:\Codes\dsh-tree-harness\packages\dsh-tree-engine\src\store.js` | 自建文件持久化（37-69） |
| `D:\Codes\DSH动态流程引擎插件\spike\dsh-flow-plugin\lib\session-executor.js` | `startActivation` 用法（260-272） |

---

## 附录 B：第三方实证摘要

### B.1 `tree_send` 为什么要存在

- `ctx.subagents.sendMessage` 按**精确活 sender + 直接父子邻接**授权，兄弟/跨层不可达。
- `ctx.subagents.prompt` 按 **durable 父地址**授权，Host 可调用，于是 `tree_send` 用 `prompt({parentSessionId, childSessionId, mode:'continuable', delivery, content})` 投递。
- 代价：目标必须 continuable、父必须 live、只返回受理、两个 root 之间仍不可达。

（证据：`dsh-tree-harness/packages/dsh-session-tree/index.js:40-53,272-291`）

### B.2 `session_handoff` 暴露的两个平台缺口

1. `agents.create({meta:{cwd}, agentOptions})` **不会**挂 workspace → 侧栏显示 Ungrouped；需 `workspaceRegistry.resolveByPath(cwd)` + `attachSession`。
2. `agents.create` **不会**自动 mount Agent preset composition，且从部署默认权限起步 → 需 `meta.agentPreset` + `setup()` 内 mount preset 并补写 `permission/preset`、`sandbox/mode`、`approval/policy`（`source:'delegation'`）。平台侧证据：`dsh-agent-loop:lib/index.js` 全文无 `agentPreset` 引用（只有 header 记录，`dsh-session:lib/index.js:1840`）；挂载函数只在 `child-agent.js:140-152` 被 subagent 管理器调用。

（证据：`dsh-tree-harness/packages/dsh-session-tree/index.js:19-33,1000-1036`；平台侧见上）

### B.3 API 形状漂移的真实代价

树引擎为 `startContinuable → startActivation`、`interrupt` authority 变化维护了双形兼容层，并在两形都缺时 fail-closed 报 `NO_START_MECHANISM_MESSAGE`（`dsh-tree-harness/packages/dsh-tree-engine/src/compat.js:16-28,50,96-140`）。

> **建议**：把「平台能力探测」做成编排插件的启动自检（像 `tree_doctor` 那样），并把探测结果暴露给用户/日志；不要静默降级到猜测。

---

## 附录 C：一页速查（给实现者）

```text
创建 root 会话     ctx.agents.create({sessionId, meta:{cwd, agentPreset?}, agentOptions, setup})
派发子节点         ctx.subagents.startActivation({provider:'spawn', label, delivery:'parent',
                     request:{parent, cwd, prompt, agentPreset?, agentOptions?, outputSchema?, maxDepth?}})
发消息             ctx.subagents.sendMessage(sender, targetId, content)   // 仅直接父子
跨层消息           ctx.subagents.prompt({parentSessionId, childSessionId, mode:'continuable', delivery, content})
停当前 turn        ctx.subagents.interrupt(childId, {kind:'ancestor', agent})
查子会话           ctx.subagents.listChildren / listDescendants；或 sessionQuery.filterSessions
查谱系             ctx.sessionQuery.traceSession(id)   // 注意 origin 判别
读终态             fold turn/end.reason.kind（权威）；subagent/end.stopReason（辅助）
读用量             ctx.tokenMeter.measure(session) / contextPressure(session)
存状态             ctx.storageDomain.open(defineDomain(...))
挂 UI              Client: ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({name, priority:-100}, C))
打开节点会话       ctx.uiWorkspace.openSession({parentSessionId, childSessionId, mode})
浏览器读 Host      Host: @Remote 方法；Client: ctx.remote.<ns>.<method>
```

**三条红线**：
1. 不要把编排状态写进会话事件（未知事件类型会让冷恢复失败）。
2. 不要用 header 存业务元数据（白名单静默丢弃）。
3. 不要等 `result` Promise 做权威判定（崩溃/跨进程即失忆，以日志为准）。
