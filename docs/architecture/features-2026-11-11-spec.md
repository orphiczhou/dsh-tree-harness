# 功能规格 — 2026-11-11：会话自交接 + 工作区归档/检索

> Lead 架构规格（实现前冻结）。两个功能的 API 证据、设计决策、验收标准、写作用域。
> 状态：**已实现**（T-F1 handoff、T-F2 会话树 v1.1.0）。
> **A 节（交接）已在同日第三轮被修订实现取代**：交接并入 `packages/dsh-session-tree` **v1.2.0**（独立插件删除），并补齐两条真机缺陷修复——① root 接替会话挂到同一侧栏工作区（`workspaceRegistry.resolveByPath` + `Workspace.attachSession`）；② 继承 Agent 预设（`meta.agentPreset` + 发布前 `setup` 内 `agentPresets.mount`）与权限模式（`permission/preset` / `sandbox/mode` / `approval/policy`，`source:'delegation'`）。最新事实以 [session-handoff-2026-11-11.md](session-handoff-2026-11-11.md) §0 与 [e2e-handoff-2026-11-11.md](e2e-handoff-2026-11-11.md) 为准；A.3「新增 host-only 插件」的部署形态描述已过时。

---

## A. 功能 1：会话自交接（context handoff）

### A.1 用户需求
会话接近 50% 上下文时，能够**自己写交接文件**，并**启动同层级的新会话**（同工作区、同 Agent 预设（工作模式）、同权限模式、同模型、同思考强度）接替自己继续推进。

### A.2 API 证据（本机 DSH 0.2.2-rc.1 实测/源码核对）
| 能力 | API | 证据 |
|---|---|---|
| 上下文占用 | `ctx.tokenMeter.contextPressure(session)` → `{pressureTokens?, contextWindow?}` | host Service catalog（tokenMeter） |
| 当前模型/思考强度 | `session.requestHeader()` → `{config:{provider, model, reasoningEffort?, maxTokens?}}` | Service catalog·Session 类；request/header 事件 |
| 同工作区 | `session.header.cwd`（回退 `ctx.workingDirectory.get(session)`） | SessionHeader 类型 |
| 会话 ID 生成 | `session-${crypto.randomUUID()}`（运行时 SessionId 即品牌化字符串） | dsh-session `brandString('session-…')` |
| 建**根级**新会话 | `ctx.agents.create({ sessionId, meta:{cwd}, agentOptions, signal })` → `AgentHandle{agent, dispose}` | host Service catalog（agents.create / CreateAgentOptions） |
| 建**兄弟**新会话（当前是子会话） | `ctx.subagents.startActivation({ provider:'spawn', label, request:{ prompt, parent: <当前会话的活父 Agent>, agentOptions}, signal, delivery:'parent' })` | subagents 方法表（rc.2 形态） |
| 给新根会话发首条指令 | `handle.agent.followup(userMessage)`；userMessage 最小形状 `{ role:'user', content:[{type:'text',text}], source:{kind:'user'} }`（可补 `id`/`time`） | dsh-agent-loop `followup()/send()`；api-session-controller 用 `agent.followup(createUserMessage(...))`；inbox wire 校验为 `z.custom()`（宽松） |
| 父会话是否活着 | `ctx.agents.get(parentSessionId)` | agents 方法表 |

### A.3 设计（v1）
新增 **host-only 插件** `packages/dsh-session-handoff/`（零 npm 依赖，只经 `ctx.inject`）：

工具 `session_handoff`，action 闭集：
- `status`：返回 `{ context_pct, pressure_tokens, context_window, provider, model, reasoning_effort, cwd, session_id, parent_session, successor_available, threshold_pct }`；`context_pct` 缺失时明确 `unavailable`（不猜）。
- `handoff`：入参 `{ kind:"root"|"sibling"|"auto"(缺省), summary, next_steps[], files[], open_questions[], note?, spawn:true(缺省), threshold_pct=50, force=false }`
  1. 计算 pct；`!force && pct < threshold_pct` → 拒绝并返回当前 pct（防误触发）；
  2. 写交接文件到 `cwd`：`HANDOFF-<sessionShort>-<yyyyMMdd-HHmmss>.md`（结构：任务/现状/决策/已改文件/下一步/开放问题/原会话 id/模型与 effort/接替提示语）；返回绝对路径；
  3. `spawn` 时建接替会话（见矩阵），把「读交接文件并继续推进」的 prompt 作为首条消息；返回 `{ handoff_path, successor:{ session_id, kind, model, reasoning_effort, parent_session } }`；
  4. 任何 spawn 失败：文件已写成功则返回 `spawn_error`（不静默），文件失败则整体失败。

**接替会话矩阵**：
| 当前会话 | 接替方式 | 层级结果 |
|---|---|---|
| 有 `parentSession` 且 `agents.get(parent)` 活 | `subagents.startActivation({request:{parent: liveParent, prompt,…}})` | **兄弟**（同父，同层级）✓ |
| 有 `parentSession` 但父不活 | 回退 `agents.create` 根级 + 在结果中 `degraded:"parent-inactive"` 明示（不假装同层级） | 根级（降级，显式告知） |
| 根会话（无 parent） | `agents.create({parentAgent:undefined, meta:{cwd}})` + `followup` | 根级（同层级）✓ |

**模型/思考强度继承**：读 `session.requestHeader().config`，把 `{provider, model, reasoningEffort, maxTokens}` 原样传 `agentOptions`；读不到时省略并返回 `inherited:"provider-default"` 说明。
**工作区继承**：`meta.cwd = session.header.cwd`（回退 workingDirectory）。
**防重复**：同一会话 5 分钟内已成功 handoff 则拒绝再次（记录 session id + 时间，内存表）；`force:true` 可覆盖。

**自动感知（v1 必做，轻量）**：
- 工具描述明确要求：上下文接近 50% 时调用 `session_handoff {action:"status"}`，≥50% 时执行 handoff；
- 在 `agent.md` §0.2 工程约定 + 交接提示词里写入该纪律；
- （stretch，v1.5）监听宿主事件在 pct 跨 50% 时向会话注入一条 developer 提醒——需 Event 服务形状确认，本轮不阻塞。

**测试（离线，node --test）**：mock `tools/subagents/agents/tokenMeter` 四类服务，覆盖：
status 缺 pressure 字段；pct<50 拒绝；pct≥50 写文件（内容含模板字段）；根会话走 agents.create + followup；子会话走 startActivation(兄弟)；父不活降级路径；spawn 失败但文件已写；防重复/force。

**约束**：不 import 任何 `@deepseek-ai/*`；工具注册用 `defineTool` 产出的 JSON-Schema 形状（同 tree_send，不依赖包）；插件 `apply` 用 `ctx.inject([...], cb)`。

### A.4 验收
1. `node --test` 全绿（≥10 用例）；
2. Lead 安装后活体：`status` 返回真实 pct（本机当前会话）；`handoff(force)` 真实产出文件 + 真实接替会话（可在侧栏看到，模型/effort 与原会话一致）；
3. 失败/降级路径有明确字段，不静默；
4. 文件不在仓库内（写到会话 cwd，需告知用户）。

---

## B. 功能 2：会话树 UI — 工作区归档/隐藏 + 最近活动排序 + 归档检索召回

### B.1 用户需求
工作区越积越多，需要：工作区可归档/隐藏；或按最新会话倒序；「会话数」后的 `…` 菜单里能操作**已归档会话**与**已归档工作区**；归档后的工作区和会话**能看、能查、能召回**。

### B.2 现状（`packages/dsh-session-tree/client.js`，v1.0.4）
- 已占 `sidebar.workspaces` 单席位（priority −100）；已按 workspace 分组；已有会话级归档（`archivedSessionIds` from `useWorkspaces`）+ 视图菜单 `archivedMode: hide/show/only`；行级 `…` 菜单有归档/取消归档（`uiWorkspace.archiveSession/unarchiveSession`）。
- **缺**：工作区级隐藏/归档；工作区排序（现按 Host 顺序）；`…` 菜单里的工作区条目；隐藏后的检索与召回。

### B.3 设计（v1，纯客户端）
Host 无工作区归档 API（workspaceController 只有 create/rename/delete/insert/archiveSession/unarchiveSession/pin…）→ **工作区隐藏为插件层状态**，持久化 `localStorage["session-tree:hiddenWorkspaces"]`（JSON 数组）。
1. **排序**：新增工作区排序 `workspaceOrder ∈ {recent(缺省), host}`；`recent` = 每个工作区取成员会话最新活动时间（会话 row 的 `updatedAt`/projection 时间，缺失回退 `createdAt`）倒序；「Ungrouped」恒最后。视图菜单加「工作区排序：最近活动 / Host 顺序」。
2. **工作区隐藏/召回**：
   - 工作区分组行 hover 出现 `…` 菜单（复用 `.st-menu` 样式）：`隐藏此工作区` / （已隐藏分区内）`恢复显示`；
   - 视图菜单新增「已隐藏工作区：隐藏 / 显示为分区 / 仅显示已隐藏」三态（对应 `hiddenWorkspacesMode`），持久化；
   - 隐藏分区标题 `Hidden workspaces (N)`，渲染在树末尾，可展开/恢复；搜索时**命中隐藏工作区名称也显示**并带「已隐藏」标记。
3. **`…` 菜单整合**（「会话数」右侧）：`排序方式`、`工作区排序`、`已归档会话`（隐藏/显示/仅）、`已隐藏工作区`（隐藏/显示分区/仅显示）、`展开全部/全部折叠`、`刷新标题`；保持现有项不回归。
4. **归档会话检索/召回**：保持 `archivedMode=show/only` 全量可见 + 行菜单 `取消归档`；搜索在 show/only 模式下覆盖已归档（当前逻辑已如此，补断言）。
5. **版本**：`packages/dsh-session-tree/package.json` bump **1.1.0**（D6：改代码必须 bump）；README 增补新能力一节（中英）。
6. **测试**：更新 `test/render.test.cjs` 夹具与断言（新增：recent 排序、隐藏分区、搜索命中隐藏、恢复）；`test/style-guard.cjs`/`provider-conformance.cjs` 保持绿；gating 断言只增不删语义。

### B.4 验收
1. 渲染测试全绿（原 107 gating + 新增 ≥8 条）；
2. `provider-conformance.cjs` 在 rc.2 兼容 fixture 下 keep 绿（同现有约定）;
3. Lead 在真实页面验证：工作区 `…` 菜单出现、隐藏/恢复生效且刷新后仍生效（localStorage）、recent 排序生效、已归档会话可看可召回；
4. 不改 Host 侧 API、不改 `tree_send`、不碰 `sidebar.workspaces` priority/inject 硬数组。

---

## C. 非目标 / 禁止
- 不改 profile 结构（除 Lead 安装新插件）；不发布 npm；不重写 git 历史；不复制仓外文件进仓。
- 团队成员**不执行任何 git 写命令**；不互改对方文件（写作用域见任务板）。
- 会话树单包内容发布同步（`scripts/release-plugin.mjs` + 公开插件仓 push）属 Lead 发布动作，本轮先本地实现验证，发布由 Lead 决定。

## D. 风险
1. `agents.create` 根会话在真实宿主上的可见性（侧栏出现、可正常对话）需真机验证；失败则降级为「仅写交接文件 + 提示用户手动新开会话」。
2. `followup` 伪造最小 message 形状若被下游渲染/校验拒绝 → 改为 `setup` 回调内 followup 或退回「文件+提示」路径。
3. 会话树 client.js 74KB 大文件改动 → 必须保持现有 gating 断言；新增本地持久化需容错（localStorage 不可用时降级为内存）。
