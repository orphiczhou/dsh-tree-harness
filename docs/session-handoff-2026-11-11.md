# 会话自交接插件（@local/dsh-session-handoff）— 设计与交付记录

- **日期**：2026-11-11
- **角色**：handoff-engineer（T-F1 / task-6）
- **规格来源**：[docs/features-2026-11-11-spec.md](features-2026-11-11-spec.md) **A 节**（Lead 已冻结；本实现照做，未改规格）
- **状态**：**v0.1.0 源码 + 离线测试全部通过（24/24）**；**未安装 bundle、未做真机验证**（按任务约束由 Lead 执行）
- **写作用域**：仅 `packages/dsh-session-handoff/` 与本文档；未执行任何 git 写命令、未安装 bundle、未修改 profile / `agent.md` / 既有 packages

---

## 1. 交付文件清单

| 文件 | 作用 | SHA256（2026-11-11 实测） |
|---|---|---|
| `packages/dsh-session-handoff/package.json` | bundle 清单（`@local/dsh-session-handoff` v0.1.0 / private / type module / `dsh.manifestVersion=1` / `bundle.patch` / `icon`；**零 dependencies / peerDependencies**） | `70a7dc34e804feb91fd0c7a68c361c9ca9d3f151f98c12e42e71d941d1a6c01f` |
| `packages/dsh-session-handoff/cordis.patch.yml` | 一条 insert：`id: session-handoff` → `@local/dsh-session-handoff`（结构与 `dsh-tree-engine` 完全一致） | `e0d81d21f3848df2ad27e2600dc03a392d0c7a892ee4b63e06904f1b115534a5` |
| `packages/dsh-session-handoff/index.js` | host 半：`session_handoff` 工具（status / handoff），零 `@deepseek-ai/*` import | `6feb42aefc852d6bda94d957f876b3a28d43b44a0ec74aab8dde0b8d12d7a039` |
| `packages/dsh-session-handoff/icon.svg` | 自绘图标（旧会话节点 → 箭头 → 接替会话节点，无第三方品牌） | `c7c31e88768b9b3d24ebc424a7bed8f34251fbf23fd02d1f2bcbc549559e6e42` |
| `packages/dsh-session-handoff/locale/en.json` | Plugin Manager / Settings 的 `meta.title` / `meta.description`（英文） | `336011abc98e2a40f60481476f9caf22d2642fa9eb69efd5a569528bb41decef` |
| `packages/dsh-session-handoff/locale/zh.json` | 同上（中文） | `fbe1e46457fd8e8266c099cabd1dcb3666ed4178af020a2628c69c9a3283d5b0` |
| `packages/dsh-session-handoff/tests/handoff.test.js` | `node:test` 离线测试 24 例（mock 四类服务） | `442c6894ed391e9d49e06e8c7b84c31c2ea3d2b6ec2f0451d0b80e2fb23defe5` |
| `docs/session-handoff-2026-11-11.md` | 本文档 | — |

未新增 README（bundle 展示元数据由 `locale/*.json` 提供，符合当前插件规范；如需公开仓 README 由 Lead 决定）。

---

## 2. 设计

### 2.1 工具 `session_handoff`

注册方式（与 `tree_send` 完全同形）：plain object + `services.tools.register({...HANDOFF_TOOL, execute: makeExecute(services)})`；`parameters` 为完整 JSON-Schema（不是 `defineTool()` 属性映射），因此**不 import `@deepseek-ai/dsh-tools`**，包不声明任何依赖。

- `ctx.inject(['tools', 'subagents', 'agents', 'tokenMeter'], callback)`：四类服务齐备才注册；缺任一服务时工具不出现（插件不失败）。
- 可选服务 `workingDirectory` 通过 `services[key]` 防御式读取（Cordis 缺服务访问器会抛，已 try/catch），用于 cwd 回退。
- 模型面描述遵循 agent-experience：**何时用**（上下文接近 50% 先 `status`，≥50% 执行 `handoff`）→ 参数规则写在**参数描述**里（默认值/0–100/必填/覆盖关系）→ 返回 bounded（一行 render，不倾倒文件内容）。

**action=`status`** 返回（缺失值明确 `"unavailable"`，不猜）：

```json
{
  "action": "status",
  "context_pct": 60,
  "pressure_tokens": 60000,
  "context_window": 100000,
  "threshold_pct": 50,
  "provider": "deepseek",
  "model": "deepseek-chat",
  "reasoning_effort": "high",
  "cwd": "<session.header.cwd，回退 workingDirectory.get>",
  "session_id": "session-…",
  "parent_session": "unavailable",
  "successor_available": true,
  "successor_kind": "root",          // 额外：当前矩阵下会走 sibling / root
  "recommended_action": "handoff",   // 额外：continue / handoff
  "notes": []                        // 额外：降级原因（≤4 条）
}
```

**action=`handoff`** 入参：`{kind:"root"|"sibling"|"auto"(缺省), summary(必填), next_steps[], files[], open_questions[], note?, spawn:true(缺省), threshold_pct=50, force=false}`。

执行顺序（规格 A.3 冻结顺序）：

1. 阈值守卫：`!force && pct < threshold_pct` → 返回 `{status:"rejected", reason:"below-threshold", context_pct, threshold_pct}`，**不写文件**；pct 不可得时带 `warnings` 继续（不臆造百分比）。
2. 防重复：同会话 5 分钟内已成功交接 → 返回 `{status:"rejected", reason:"recent-handoff", last_handoff_at, handoff_path}`；`force:true` 覆盖。
3. 写交接文件：`<cwd>/HANDOFF-<短id>-<yyyyMMdd-HHmmss>.md`（短 id = session id 去 `session-` 前缀/非字母数字后的前 8 位）；**文件写失败 → 工具整体报错**（不静默）。
4. 启动接替会话（`spawn:false` 时跳过，返回 `status:"file-only"`）；**spawn 失败 → 返回 `handoff_path` + `spawn_error`，文件保留**。
5. 成功返回：

```json
{
  "action": "handoff",
  "status": "handed-off",
  "handoff_path": "<绝对路径>",
  "context_pct": 60,
  "threshold_pct": 50,
  "context_window": 100000,
  "cwd": "<cwd>",
  "session_id": "session-…",
  "parent_session": "unavailable",
  "successor": {
    "session_id": "session-…（新）",
    "kind": "root",                  // root | sibling
    "parent_session": "unavailable",
    "model": "deepseek-chat",
    "reasoning_effort": "high",
    "inherited": "session-route"     // session-route | provider-default
  },
  "degraded": "parent-inactive",     // 仅降级时出现
  "warnings": []
}
```

### 2.2 交接文件模板

固定小节（顺序冻结，便于机器/正则复核）：`Task`（summary）、`Current status`（session/父会话/工作区/文件路径/上下文/模型与 effort）、`Decisions`（note）、`Changed files`（files）、`Next steps`（next_steps 编号列表）、`Open questions`、`Original session`（session id / parent / provider / model / reasoning_effort / cwd / generated_at）、`Successor instructions`（接替提示语，同首条消息）。列表项有上限（50 项 × 1000 字符，summary/note 8000 字符），超限截断加 `…`。

### 2.3 接替会话矩阵（规格 A.3 冻结）

| 当前会话 | 接替方式 | 返回 |
|---|---|---|
| 子会话且 `session.header.parentSession` 非空、`agents.get(parent)` 返回活 Agent、`subagents` 可用 | `subagents.startActivation({provider:'spawn', label:'handoff <短id>', request:{prompt:[{type:'text',text:prompt}], parent:<活父 Agent>, cwd, agentOptions?}, signal, delivery:'parent'})` | `successor.kind="sibling"`，`parent_session=<原 parent>`（**兄弟，同父同层级**） |
| 子会话但父 `agents.get(parent)` 不可得 | 回退 `agents.create(...)` 根级 | `successor.kind="root"` + **`degraded:"parent-inactive"`**（不假装同层级） |
| 子会话且父活但 **subagents 服务缺失** | 回退根级 | `degraded:"subagents-unavailable"` |
| 根会话（无 parent） | `agents.create({sessionId:'session-'+randomUUID(), meta:{cwd}, agentOptions?, signal})` → `handle.agent.followup(userMessage)` | `successor.kind="root"` |
| `agents` 服务缺失 | 不启动 | 文件已写 + `spawn_error:"no successor path available (agents service unavailable)"` |

入参 `kind` 可**强制层级**：`root` 即使在子会话里也强制建根级（`degraded` 不填）；`sibling` 请求兄弟，父不活时回退根级并 `degraded:"parent-inactive"`，根会话请求 `sibling` 时回退根级（根→根本身即同层，不标降级）。`auto`（缺省）走上面的矩阵。

### 2.4 模型 / 思考强度 / 工作区继承

- 模型与 effort：`session.requestHeader()?.config` → `{provider, model, reasoningEffort, maxTokens}` 中**存在即原样**传入 `agentOptions`（`reasoningEffort` 是 branded string，透传）；读不到 config 时**省略 `agentOptions` 整个键**并返回 `inherited:"provider-default"`。读到时 `inherited:"session-route"`。
- 工作区：根级 `meta.cwd = session.header.cwd`（回退 `ctx.workingDirectory.get(session)`）；兄弟级 `request.cwd` 显式传同一路径，保证接替会话与交接文件同工作区。
- 首条消息（根级）最小形状 + 身份：`{id: randomUUID(), role:'user', content:[{type:'text',text:prompt}], source:{kind:'user'}}`（对应 `createUserMessage()` 的产物形状；该版本 UserMessage 无 `time` 字段，故不补 time）。
- 接替 prompt 必含「先读交接文件路径并继续推进」：`First read the handoff file at: <绝对路径>` … `Then continue advancing the work from its next steps…`。

### 2.5 关键设计决策：接替会话使用 **detached AbortSignal**

规格把 `signal` 列为 `agents.create` / `startActivation` 入参，但未规定必须是 `exec.signal`。实现传入 **一个新建、永不 abort 的 AbortSignal**，理由：

- `exec.signal` 是**当前 turn 的取消信号**；交接的目的正是让接替会话在旧会话停止/关闭后继续存活。若把旧 turn 的 signal 绑给新会话，用户因「上下文将满」按停止时可能连带取消接替会话，违背功能目的。
- 代价：交接调用期间用户取消 turn 不会中止 spawn。可接受（文件已落盘、spawn 为一次快速调用），并且已在返回/文档里明确。

### 2.6 防重复

`apply` 时创建 `Map<sessionId, {at, path}>`；**交接文件写成功后**记录；同会话 `now - at < 5min` 且 `!force` → `rejected/recent-handoff`。该表是进程内内存：HMR/重启丢失（丢的后果只是可能多写一个文件，不损坏状态）；不做持久化（规格 A.3 明确「内存表」）。

---

## 3. API 证据（本机 DSH 0.2.2-rc.1，2026-11-11 复核）

> 规格 A.2 已冻结证据；实现前又用 `cordis_inspect_query`（host `Service` provider）逐条复核签名，并对照 asar 内 `lib/index.js` 源码确认真实形态。

| 能力 | 签名 / 形状（实测） |
|---|---|
| 上下文占用 | `tokenMeter.contextPressure(session: Session): Pick<ContextPressureProjection,'pressureTokens'|'contextWindow'>`；「fields remain absent until their source events are recorded」（即字段可能缺，必须显式 unavailable） |
| 当前模型/effort | `Session.requestHeader(): EpochHeader \| undefined`；`EpochHeader.config: LlmCallConfig = {provider, model, reasoningEffort?, temperature?, maxTokens?, stop?}` |
| 会话头 / 父会话 | `Session.header: SessionHeader = {id, createdAt, cwd?, parentSession?, isSeeded, origin?, delegationDepth?, agentPreset?}` |
| 父是否活 | `agents.get(id: SessionId): Agent \| undefined` |
| 建根级新会话 | `agents.create(options: CreateAgentOptions): Promise<AgentHandle>`；`CreateAgentOptions = {sessionId, parentAgent?, meta?:{cwd?…}, agentOptions?, signal?, setup?}`；`AgentHandle = {agent, dispose()}`（源码：`ownerCtx = this.ctx`，即 agents 服务的 context） |
| 给新会话发首条指令 | `ReactLoopAgent.followup(input)` → `send(input,'next-turn',true)` → inbox splice（源码 `@deepseek-ai/dsh-agent-loop/lib/index.js`）；inbox wire 校验为 `z.custom()`（宽松） |
| 建兄弟会话 | `subagents.startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>`；`SubagentActivationSpec = {provider, label, childId?, request: Omit<SubagentStartRequest,'label'|'signal'>, signal, delivery:'parent'|'caller'}`；`SubagentStartRequest = {cwd?, agentPreset?, prompt: ContentBlock[], parent: Agent, signal, agentOptions?, outputSchema?, maxDepth?}`；`SubagentActivation.childId: SessionId` |
| spawn provider 名 | `include:subagent-spawn-in-process` 的 Config schema：`providerName` default **`"spawn"`**（`Config.listConfigs` 实测，当前 profile 未覆盖 → 注册名即 `spawn`），故兄弟路径 `provider:'spawn'` 与本机一致 |
| 会话 ID 形态 | `SessionId` branded string；根级按规格用 `session-${crypto.randomUUID()}` |

结论：实现与规格 A.2/A.3 逐项一致；唯一主动补充是 `inherited`、`successor_kind`、`recommended_action`、`notes`、`warnings` 等**有界附加字段**（不改变规格必含字段）。

---

## 4. 用法示例

```jsonc
// 1) 例行巡检：上下文接近 50% 时先看占用
{ "action": "status" }

// 2) 根会话交接（先写文件，再建同模型/effort/cwd 的新根会话）
{
  "action": "handoff",
  "summary": "实现会话自交接插件；index.js/测试已完成，待 Lead 安装验证。",
  "next_steps": ["Lead 安装 bundle", "真机验证 status/handoff", "更新 agent.md §0.2 纪律"],
  "files": ["packages/dsh-session-handoff/index.js", "docs/session-handoff-2026-11-11.md"],
  "open_questions": ["新根会话是否出现在侧栏工作区？"],
  "note": "接替会话刻意与旧 turn 解绑（detached signal）。"
}

// 3) 子会话交接（auto：父 Agent 活着走兄弟，同父同层级；父不活降级根级并标 degraded）
{ "action": "handoff", "kind": "auto", "summary": "…" }

// 3b) 强制层级：kind=root 强制根级；kind=sibling 请求兄弟（不可得则降级根级）
{ "action": "handoff", "kind": "root", "summary": "…" }

// 4) 只留文件、不自动 spawn（宿主 API 异常时的安全降级）
{ "action": "handoff", "summary": "…", "spawn": false }

// 5) 低于阈值 / 5 分钟内重复时强制覆盖（需用户明确要求）
{ "action": "handoff", "summary": "…", "force": true }
```

---

## 5. 离线测试

命令（bundled node v24.21.0；目录形参 `node --test tests` 在 Node 24 有假失败，按 `agent.md` §0.2 用 glob）：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
cd D:\Codes\dsh-tree-harness\packages\dsh-session-handoff
& $node --check index.js          # exit 0
& $node --test tests/*.test.js    # exit 0
```

实测结果（2026-11-11）：

```
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 209.4686
```

覆盖（规格 A.3 测试清单 + 边界）：

| # | 用例 | 规格要求 |
|---|---|---|
| 1–3 | status 正常/缺 pressure/缺 tokenMeter → `unavailable` 不猜 | ✅ 缺 pressure |
| 4 | cwd 回退 `workingDirectory.get`、无 requestHeader → provider unavailable | ✅ |
| 5 | 无 agents/subagents → `successor_available=false` | ✅ 降级 |
| 6 | pct 30 < 50 拒绝、不写文件 | ✅ pct<50 拒绝 |
| 7 | pct 50 写文件，模板字段（任务/现状/决策/文件/下一步/开放问题/原会话 id/model/effort/接替提示语）齐全 | ✅ pct≥50 写文件 |
| 8 | 根会话：`agents.create`（session-*/meta.cwd/agentOptions/signal）+ `followup`（message 形状 + prompt 含路径） | ✅ 根会话 create+followup |
| 9 | 子会话父活：`startActivation`（provider=spawn/delivery=parent/同 parent 对象/cwd/agentOptions/prompt） | ✅ 兄弟 |
| 10 | 父不活 → 根级 + `degraded:"parent-inactive"` | ✅ 降级 |
| 11 | spawn 抛错但文件已写 → `handoff-file-written` + `spawn_error` | ✅ spawn 失败 |
| 12 | spawn=false → file-only，不 spawn | ✅ |
| 13 | 5 分钟内防重复；超窗后可再次交接 | ✅ 防重复 |
| 14 | force 同时覆盖阈值与防重复（pct 10 也放行；同会话 1s 后强制再交） | ✅ force |
| 15 | 文件写失败（cwd 是普通文件）→ 整体 reject，未 spawn | ✅ 文件失败整体失败 |
| 16 | `threshold_pct` 参数生效（80 拒绝 / status 建议 continue / 50 放行） | ✅ |
| 17 | 缺 summary → reject | ✅ |
| 18 | 缺 agents/subagents → 文件写成功 + `spawn_error` 明示 | ✅ |
| 19 | 无 config → 省略 agentOptions + `inherited:"provider-default"` | ✅ |
| 20 | 无调用会话 → 明确报错 | ✅ |
| 21 | `apply`：注入四服务、工具 JSON-Schema 形状、render 有界 | ✅ |
| 22 | `kind:"root"` 强制根级（子会话父活也不建兄弟、无 degraded） | ✅ kind 参数 |
| 23 | `kind:"sibling"` 且父不活 → 根级 + `degraded:"parent-inactive"` | ✅ kind 参数 |
| 24 | 根会话请求 `kind:"sibling"` → 回退根级（根→根即同层，不标降级） | ✅ kind 参数 |

---

## 6. 验收对照（规格 A.4）

1. ✅ `node --test` 全绿（24 ≥ 10）——本机实测。
2. ⏳ Lead 安装后活体：`status` 返回真实 pct；`handoff(force)` 真实产出文件 + 真实接替会话（模型/effort 一致）——**未执行，待 Lead**。
3. ✅ 失败/降级路径均有明确字段（`degraded` / `spawn_error` / `notes` / `warnings`），不静默。
4. ✅ 交接文件写到会话 cwd（不在仓库内；若 cwd 是仓库根，会在 `git status` 出现，见风险 6）。

---

## 7. 未验证项与风险（交 Lead 判断）

| # | 风险 | 影响 | 缓解/备选 |
|---|---|---|---|
| 1 | **根会话可见性**（规格 D1）：`agents.create` 建出的根会话能否在侧栏/工作区正常出现并可对话，未真机验证。源码显示会话已持久化、agents 注册表可见（`agents.roots()`），但侧栏分组依赖 workspace/session 投影。 | 若不可见，接替会话"存在但用户看不到" | 真机先验；失败时退路：`spawn:false` 只写文件 + 提示用户手动新开会话（规格 D1 备选），或改为在 `setup` 回调内 followup |
| 2 | **`followup` 最小消息形状**（规格 D2）：未 import `createUserMessage`（零依赖约束），自造 `{id,role,content,source}`。inbox wire 校验为 `z.custom()`（宽松），风险低。 | 若被下游渲染/校验拒绝，根级接替失败 | 备选 a) `agents.create({setup})` 在 setup 内 `agent.followup`；b) 退回「文件+提示」路径。代码已把 spawn 失败做成显式 `spawn_error`，不会静默 |
| 3 | 兄弟层级真实性：durable `parentSession` 应为同一 parent（源码如此），但侧栏缩进/层级 UI 表现需真机 | 若 UI 表现异常，功能语义仍是同父兄弟 | 真机检查会话树/侧栏 |
| 4 | detached signal（2.5 设计决策）：交接期间取消 turn 不会中止 spawn | 极端情况可能遗留文件+新会话 | 已显式设计并记录；如需强一致可改为 `exec.signal`（一行改动） |
| 5 | 内存防重复表在 HMR/重启后丢失 | 可能多写一个 HANDOFF 文件 | 接受（规格 A.3 明确内存表） |
| 6 | 交接文件写在会话 cwd：若 cwd 是仓库根，`HANDOFF-*.md` 会进入 `git status`，可能被误提交 | 仓库污染 | 建议 Lead/用户在仓库 `.gitignore` 加 `HANDOFF-*.md`（**属写作用域外，我未改**）；或在使用后清理 |
| 7 | `context_pct` 依赖 tokenMeter 已有 usage/request-header 事件：全新会话/首轮可能 `unavailable` | 阈值守卫无法评估 | 工具在该情况带 `warnings` 继续（不猜）；`force:true` 可显式放行 |
| 8 | 插件热更重复注册：沿用 `tree_send`/`tree-engine` 的 `tools.register` 直注册约定，未显式 dispose | 热更后可能重复工具 | 与既有插件同风险；刷新页面/重启宿主恢复 |

---

## 8. Lead 安装 + 真机验证建议步骤

> 以下动作**全部由 Lead 执行**（本 agent 无安装/真机/审批权限）。

1. **安装 bundle**（需要审批/full access）：
   `plugin_manager({ action: "install_bundle", target: "D:\\Codes\\dsh-tree-harness\\packages\\dsh-session-handoff" })`
   读取返回的 `application`/`warnings`；`applied` 才算生效（不是看日志）。
2. **确认工具注册**（审批-free）：
   `cordis_inspect_query({ platform: "host", provider: "Tool", method: "listTools" })` → 应出现 `session_handoff`，`parameters.required=["action"]`。
3. **确认 bundle 展示元数据**：`plugin_manager list_bundles` / `list_plugins` 中 `session-handoff` 行标题应为 "Session handoff"/"会话自交接"、图标为自绘图标（locale 由两文件提供）。
4. **活体验证 status**：在任意会话调用 `session_handoff {action:"status"}` → `context_pct` 应为该会话真实占用（或 `unavailable`），`cwd` 为真实工作区。
5. **活体验证 handoff（根级）**：
   - 调用 `session_handoff {action:"handoff", summary:"<当前任务一句话>", force:true}`（`force` 用于绕过阈值/防重复）；
   - 断言返回 `status="handed-off"`、`handoff_path` 存在、`successor.session_id` 形如 `session-<uuid>`；
   - `Get-ChildItem <cwd>/HANDOFF-*.md` 确认文件内容含模板小节；
   - 侧栏/会话树确认新会话出现且首条消息包含交接文件路径；打开新会话调用 `status` 抽查 provider/model/effort 与原会话一致。
6. **活体验证 handoff（子会话/兄弟）**：在子会话（如 teammate）里执行同样调用，期望 `successor.kind="sibling"`、`parent_session` 与原会话 parent 相同；侧栏确认同父层级。
7. **降级路径抽查（可选）**：`{action:"handoff", spawn:false}` → 返回 `file-only` 且无新会话；低于阈值（不 force）→ `rejected/below-threshold` 且不写文件。
8. **纪律补写（Lead 写作用域）**：规格 A.3 要求在 `agent.md` §0.2 工程约定 + 交接提示词中写入「上下文接近 50% 调用 `session_handoff status`，≥50% 执行 handoff」。本文件不在我的写作用域，**未改**，请 Lead 补。
9. 若需回滚：`plugin_manager({action:"remove_bundle", target:"@local/dsh-session-handoff"})`（或 `set_bundle` 禁用）；重启宿主（替换已安装包需要重启才能加载新模块代）；删除生成的 `HANDOFF-*.md`。本插件不写 profile 文件、不持久化状态，回滚无残留。

---

## 9. 边界声明（本 agent 本轮）

- 只写 `packages/dsh-session-handoff/` 与本文档；未改 `packages/dsh-session-tree`、profile、`agent.md`、`README`、`scripts/`、`docs/features-2026-11-11-spec.md`。
- **未执行任何 git 写命令**（无 add/commit/push/branch）；未安装 bundle；未重启宿主。
- 未碰密钥/凭据；未引入 npm 依赖；未 import 任何 `@deepseek-ai/*`。

## 10. 变更记录

- 2026-11-11：v0.1.0 首版实现（index.js + package.json + cordis.patch.yml + icon.svg + locale en/zh + 24 例离线测试全绿 + 本文档）；等待 Lead 安装与真机验证。
