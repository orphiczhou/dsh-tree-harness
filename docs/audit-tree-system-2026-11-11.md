# tree 体系一致性审计（代码 ↔ SKILL ↔ 文档）

- **日期**：2026-11-11（第四轮：SKILL 工程化收口）
- **审计员**：tree-auditor（独立审计，teammate）
- **任务**：task-5 —— tree-engine / session-tree 的**当前代码事实** vs 两份 tree SKILL（含 T4 迁入包内的新 draft）、README、package.json、docs/ 的一致性；输出可执行差距清单。
- **基线**：`git HEAD = 0cbc31e`（tree-engine v0.4.0 / session-tree v1.2.0）。
- **快照说明（重要）**：审计期间 T4（skill-engineer）与 Lead 正在并发修改工作树。本文 `file:line` 指向**审计时刻工作树**（约 2026-11-11 15:25–15:35）：tree-engine `package.json#0.5.0`、session-tree `package.json#1.3.0`、三份包内 SKILL.md 已落盘（mtime 15:21–15:25），仓根 `skills/` 已删除（git status 显示 `D skills/...`）。若后续继续改动，请以本文"宣称 vs 代码事实"两列为准重新对行号。
- **方法**：静态逐行比对 + 实际跑测试 + 用引擎公开 API 复现实机语义（详见 §9）。

---

## 0. 结论摘要

| 级别 | 数量 | 含义 |
|---|---|---|
| **BLOCK** | **4** | 发布/使用前必须修：会误导模型或直接导致树任务无法收口 |
| **需修** | **12** | 文档/工具描述与实现不符，会造成错误操作或验收失真 |
| **建议** | **15** | 精确度、可发现性、可维护性问题 |

**BLOCK 一览（详情见 §2）**

| # | 结论 | 主要证据 |
|---|---|---|
| B1 | **竹节接力后 leaf owner 不迁移 → 接力会话写 `done` 被 `E_BORROWED_IDENTITY` 拒，leaf 只能等 30 分钟 timeout**；两份 SKILL 把它描述成正常换棒、并称 done→succeeded | `src/engine.js:417`（首次派发绑定 owner）vs `src/engine.js:492-500`（接力只改 `runtime`，不改 `leaf.session_id`）；`src/engine.js:260-263`；复现输出（§9.3） |
| B2 | **热更新说明自相矛盾且与实测相反**：包 README（中英）称"停用/启用也拿不到新代码"，与 agent.md D12/根 README 的"disable→enable 实测有效（发布流程要求）"直接冲突 | `packages/dsh-session-tree/README.md:248`、`README.zh.md:248` vs `agent.md:86`（D12）、`agent.md:141`、`README.md:143`；`docs/session-handoff-2026-11-11.md:43` |
| B3 | **T4 两份新 SKILL 宣称"本机无 timer 服务 / 没有后台自动收割，必须显式 harvest"——与代码和活体日志相反**：`systemClock()` 永远带 `scheduleInterval`，生产路径 `sweepMode` 恒为 `timer`（进程内 setInterval 每 60s 自动 sweep） | `index.js:774-781`（只打 degrade 日志，clock 仍用 `systemClock()`）、`src/clock.js:14-22`、`src/engine.js:573-578`；`apply.log`："timer resolve failed … engine ready (sweepMode=timer)"；本地复现 §9.4 |
| B4 | **tree-commander v2 没有"被派发的 commander 不要 tree_plan"分支**：三层分解 E2E 中第二层 commander 照 SKILL 先 `tree_plan create` → 同 tree_id `E_DUPLICATE_LEAF`，换 tree_id 则把子节点建到另一棵树（静默分裂） | `packages/dsh-tree-engine/skills/tree-commander/SKILL.md:7,50-63,241`；`src/engine.js:54`（duplicate 拒绝）；T6 三层场景（task-6） |

> 结论：**tree-engine 8 工具面本身稳定（66/66 测试全绿）**；主要风险集中在 **"竹节接力的结算语义"** 和 **"SKILL 里不可执行/与实测相反的操作指令"**。B1/B3/B4 会直接影响 T6 的「三层分解 + 50% 交接」E2E 判定，建议 Lead 在发布前处置。

---

## 1. 审计范围与验证结果

| 对象 | 快照 | 验证 |
|---|---|---|
| `packages/dsh-tree-engine` | v0.5.0（工作树） | `node --test tests/*.test.js` → **66/66**（62 引擎 + 4 skills 打包回归），0 fail |
| `packages/dsh-session-tree` | v1.3.0（工作树） | `test/handoff.test.js` **34/34**；`test/render.test.cjs` 133/133 + 9/9 + 11/11；`test/style-guard.cjs` 全绿；`test/skills.test.cjs` 3/3；`verify-bundle.mjs` 0 fail |
| `provider-conformance.cjs` | — | 失败（已知：依赖 rc.2 fixture，见 agent.md:97 备注，不计缺陷） |
| 包内 SKILL | 3 份已落盘 | 本会话 Skill 目录已出现 `session-handoff` / `tree-commander` / `tree-worker`（活体证明 patch row 2 生效） |
| 工具面 | 8 个 `tree_*` + `tree_send` + `session_handoff` | 与 package README 宣称一致（数量/名称/action 闭集见 §5/§7） |

---

## 2. BLOCK（发布前必须处置）

### B1 — 竹节接力后 `done` 所有权断裂（代码缺陷 + SKILL 描述失真）

**代码事实**

- 首次派发：`dispatch:start` 把 **执行者会话绑为 owner**：`packages/dsh-tree-engine/src/engine.js:417` `leaf.session_id = session.sessionId`。
- 竹节接力：`bambooRelay` 只更新 `runtime.subagentSessionId` / `runtime.segmentChain`，**没有更新 `leaf.session_id`**：`src/engine.js:492-500`（`rt.segmentChain.push(...)`、`rt.subagentSessionId = ...`）。
- `done` 事件只允许 owner 写：`src/engine.js:260-264`（`caller !== leaf.session_id` → `E_BORROWED_IDENTITY`）；而成功回流仅在 `runtime.state === 'running'` 时发生：`src/engine.js:280-283`。

**复现（§9.3 原样输出）**

```
dispatch#1 → leaf.session_id = workerSession
set-context 60 → segment_pending=false（worker 初始 pending_brief）
sweep → bamboo relay 到 relaySession（briefState=ok）
after relay: leaf.session_id === OLD workerSession? true
done by RELAY session -> ok=false code=E_BORROWED_IDENTITY
done by OLD session  -> ok=true
```

**影响**

1. 接力后的新会话按派发提示词里的**结算指令**调用 `tree_report done` 会失败 → leaf 保持 `running`，只能等 `nodeTimeoutMs`（缺省 30 分钟）判 timeout；commander 的"全绿收口"永远等不到。
2. 两份 SKILL 均把竹节描述为"同一 leaf 换会话、正常机制"（`tree-commander:161`、`tree-worker:60`），且 `tree-worker:49,153` 说 "done 事件副作用 → runtime.succeeded"（未标注仅首次派发成立）→ 会诱导 commander 无限轮询。
3. 现有 E2E（e2erly）能"成功"是因为任务在**交接前**已由旧会话写了 done；长任务必踩。

**建议动作（二选一，建议都做）**

- **代码修**（1 行）：`bambooRelay` 里 dispatch 成功后同步 `leaf.session_id = session.sessionId`（并补测试：接力后新会话 done→succeeded）。**推荐**——这才是"同一 leaf 换会话"的语义本意。
- **SKILL 修**：在 commander §1.3 / worker §2、§4.3 明写："竹节接力后 owner 仍是旧会话；接力会话写 done 会被拒。旧会话应在交棒前写 done，或 commander 从 harvest 的 `relay.sessionId` 取新会话 id 后 `tree_node set-session` 重绑"。

### B2 — 热更新说明三处互相矛盾（用户/发布门禁会走错流程）

| 文档 | 原文主张 | 冲突对象 |
|---|---|---|
| `packages/dsh-session-tree/README.md:248` | "editing the Host half requires restarting DSH — **disabling/enabling the bundle**, reinstalling it, or pointing its entry at a new file path **all serve the cached module**. Only a new package name bypasses that cache." | `agent.md:86` D12："必须对 entry 做一次 **disable→enable**（`plugin_manager set_plugin`）或重启 DSH"；`agent.md:141` 第 4 条发布门禁同旨 |
| `packages/dsh-session-tree/README.zh.md:248` | 同上（"停用再启用…拿到的都还是缓存里那一代"） | 同上 |
| `README.md:141` | "停用/启用、卸载重装、换入口文件路径都**拿不到新代码**，只能重启进程或换新包名" | 同句后半括号里又写"对 `include:session-tree` 做一次 disable→enable 后才加载新实现"——**同一句自相矛盾**；`README.md:143` 又要求走 disable→enable |

**判定**：实测（agent.md D12 + docs/session-handoff §0.3-5）是 **disable→enable 有效、必须做**；三份 README 的"停用/启用无效"是**错误且有害**的（会让人跳过发布流程唯一有效步骤，或误以为只能重启）。

**建议**：统一为："Host 半改动后必须 (a) 重启 DSH，或 (b) 对该 bundle entry `plugin_manager({action:"set_plugin", enabled:false})` → `enabled:true`（实测有效、发布流程采用）；**单纯重装/换入口路径**拿不到新代码。客户端半只需刷新页面。"

### B3 — SKILL 的 timer / degraded-lazy 主张与代码、活体日志相反

**SKILL 宣称**

- `packages/dsh-tree-engine/skills/tree-commander/SKILL.md:123`："当前本机宿主无 timer 服务：tree-engine 启动为 `sweep degraded:no-timer` … **没有后台自动收割/自动竹节**——必须由你周期性显式 harvest"；`:244` "degraded-lazy 下必须显式 tree_status harvest"。
- `packages/dsh-tree-engine/skills/tree-worker/SKILL.md:61`："必须由指挥官显式 `tree_status {action:"harvest"}` 才触发"；`:149` 同。
- 历史版本 `skills/tree-worker/SKILL.md`（HEAD）:26 同类表述的变体。

**代码事实**

- `packages/dsh-tree-engine/index.js:774-781`：`ctx.timer` 取不到时**只写日志** `sweep:degraded:no-timer`，随后 `const clock = systemClock()`；`src/clock.js:14-22` 的 `systemClock()` **永远提供 `scheduleInterval`（setInterval）**；`src/engine.js:573-578` 只要 `clock.scheduleInterval` 是函数就进入 `sweepMode = 'timer'` 并注册 60s 周期。→ **degraded-lazy 分支在生产装配路径不可达**。
- 活体证据：`%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\apply.log`：
  ```
  apply() entered (v0.4.0)
  timer resolve failed: cannot get property "timer" without inject
  sweep:degraded:no-timer — harvest relies on tool calls / tree_status {action:"harvest"}
  engine ready (sweepMode=timer)
  apply complete: 8/8 registered
  ```
  即日志说 degraded、实际 `sweepMode=timer`。
- 本地复现（§9.4）：`startSweep() → {"sweepMode":"timer","hasStop":"function"}`。

**影响**：T6 若按 SKILL 结论把"必须手动 harvest"写进验收脚本，会误判自动竹节/超时行为；commander 也可能在自动 relay 之外再手动触发，产生竞争。**根因是代码缺陷**（fallback 与日志语义不符），**SKILL 只是忠实记录了错误日志**。

**建议**：代码修——timer 不可用时不要把 `systemClock().scheduleInterval` 当"宿主 timer"；要么真降级（`clock.scheduleInterval = undefined` 并保持 degraded-lazy），要么改日志为 "using in-process interval fallback (sweepMode=timer)"。SKILL 同步改为："timer 服务缺失时引擎用进程内 60s 周期兜底；`tree_status {action:"harvest"}` 可立即触发，不要假设实时性。"

### B4 — tree-commander v2 缺少"已存在树 → 禁止再 tree_plan"分支（三层 E2E 直接踩）

**SKILL 现状**：`packages/dsh-tree-engine/skills/tree-commander/SKILL.md:7` 标题即"tree_plan 建树 → …"；§1.2 标题"**建树（先 plan，再逐点 add）**"（:50），样例直接 `tree_plan {action:"create", tree_id:"tdemo", session_id:"<你的会话 id>"}`（:52-63）；§6 一图流第一行"tree_plan 建树（传 session_id）"（:241）。

**代码事实**：`tree_plan create` 对已存在 tree 直接 `E_DUPLICATE_LEAF`（`src/engine.js:53-54`）；`tree_plan` 无 caller 限制，任何会话都能建新树（`index.js:456-478`）。被 `tree_dispatch` 派发的 commander 会话，任务书里**已经带 tree_id/leaf_id**（`index.js:73` 结算指令模板），它若按 SKILL 执行 `tree_plan`：同 id → 报错卡住；自拟新 id → 把 C 层节点建到另一棵树，root 永远收割不到（静默分裂）。

**建议**：§1.2 开头加分支（必须）：
> "先看任务书：① 若已给 `tree_id` 且 `tree_status {action:"overview"}` 能读到该树 → **不要 tree_plan**，直接在本 leaf 下 `tree_node add`；② 只有你是根会话、且没有现成 tree_id 时，才 `tree_plan create`。"

并把 §6 一图流改为"（仅根/无现树时）tree_plan 建树"。T6 的三层分解（根→commander→worker）必须覆盖该分支。

---

## 3. 需修（P1，不阻塞发布但会误导操作/验收）

> 编号 P1-01…P1-12，证据与建议逐条给出。

### P1-01 `tree_verify` 工具描述两处事实错误（模型面直接可见）

- `packages/dsh-tree-engine/index.js:604-606` 描述："Verdicts recorded to leaf.verification; **pass required before succeeded**" 与 "cwd = **node workspace (from leaf.path resolved against exec cwd)**"。
- 代码事实：① `done`/`succeeded` **不检查** `leaf.verification`：`src/engine.js:162-193`（setStatus 只有 transition + done event + milestones）、`:280-283`（done 事件直接 succeeded）；全仓无 `leaf.verification.pass` 消费点（grep 仅写入 `setVerification`，`src/engine.js:213-229`）。② `tree_verify` 的 cwd 是 `args.cwd ?? exec?.cwd ?? process.cwd()`（`index.js:635`），**从不解析 leaf.path**。
- 影响：模型会以为 verify FAIL 会阻断 succeeded（实际不会），也会以为按 leaf 工作区验证（实际按调用者 cwd）。
- 建议：改描述为"裁决落账 leaf.verification，**不阻断 runtime.succeeded**（协议纪律：commander 应 verify PASS 再收口）"；cwd 描述改为"args.cwd → 调用者 exec.cwd → process.cwd；**不自动解析 leaf.path**"。若希望硬闸，应实现于 setStatus/done 回流。

### P1-02 `tree_node` 描述宣称的 done 三重闸在工具面不可达

- `index.js:483-485` 描述："set-status enforces … done gates (done event first + all milestones audit_pass)"；`src/state.js:62-70` 要求 milestones 非空且全 `audit_pass`。
- 工具面**没有任何 milestone 写入 action**（`tree_node` add/get/list/list-all/set-status/set-session，`index.js:489`；`leaf:add` 还把 `milestones` 覆盖成 `[]`，`src/engine.js:146-150`）。测试自己承认需"store 直改注入"（`tests/engine.test.js:243` 注释）。
- 结论：`tree_node {action:"set-status", status:"done"}` 在工具面**永远 E_SCHEMA_INVALID**（milestones 空）；`tree-engine README:17` 的"done 三重闸/闭集状态机全量继承"对工具面不成立。
- 建议：工具描述/README 标注"里程碑面无写入命令；收口以 `runtime.state=succeeded` + verify 为准"（T4 已在 `tree-commander:138` 写明，工具描述仍需改）；或补 `milestone-add` action。
- 附带：`src/engine.js` 实际只有 **2 道闸**（done event + milestones），`docs/engine-spec.md:40` 与旧 SKILL 宣称的第三道"树结构 validate"未实现。

### P1-03 `tree_dispatch` 三个参数/描述与实际行为不符

| 项 | 描述/参数 | 代码事实 | 影响 |
|---|---|---|---|
| `dod` | `index.js:537` schema + 描述 `start:{prompt?, assignee?, dod?}`；SKILL commander `:112-115` 样例也传了 `dod` | 派发端口只用**策略 DoD**：`index.js:72` `verifier.dodPrompt(spec.policyId ?? spec.taskType ?? 'default')`；`spec.dod` 只在 verifier 为 null 时用（生产不可达），`src/engine.js:405-410` 传了但被忽略 | 传 `dod` 不改变子会话看到的验收标准（来自 taskType 策略），易误以为已定制 |
| `assignee.preset` | schema 宣称 `{provider?,model?,effort?,preset?}`，`:526-536` | `index.js:91-97` 只把 provider/model/effort 转 `agentOptions`；preset 仅存 `leaf.assignee`（`src/engine.js:419-427`），**从不应用** | SKILL `:118` 已澄清"只是随 leaf 记录"；工具描述应同步 |
| `<session-config-declared>` | 描述称"is appended to the dispatch prompt" | `src/engine.js:436-448` 只拼进 `rt.taskPrompt`；首次派发走 `ports.dispatch({prompt: spec.prompt ?? leaf.brief})`（`:405-410`），声明的自描述块**只出现在竹节接力提示词** | 首次子会话看不到 declared 块（`self_spec` 相关证据仅接力后出现） |

- 建议：① 从 tool schema 删除 `dod`（或实现 spec.dod 注入）；② 描述 preset 为 "recorded on leaf only"；③ declared 描述改"persisted for relay prompts; first dispatch prompt is prompt+DoD+settlement"；④ SKILL commander 样例删除 `dod`。
- 附带：`prompt` 缺省时 `prompt: spec.prompt ?? leaf.brief` 会拿到 **brief 对象**，`index.js:77` 模板字符串把它变成 `[object Object]`——建议 commander SKILL 强制"dispatch 必传 prompt"（当前 SKILL 已传 prompt，但未写"缺省时 brief 不生效"）。

### P1-04 `tree_verify` 描述仍写 batch-1 三种模式（实现已六种）

- `index.js:604`："batch-1 modes: self-report | artifact | command"；实际 `src/verify.js:8` `MODES = ['self-report','artifact','command','llm-judge','composite','human']`，`DEFAULT_POLICIES` 4 套 + `DEFAULT_TASK_TYPE_MAP` 5 项（`verify.js:11-33`）。
- 建议：描述同步六模式，并注明 `llm-judge` 端口未装配时 fail-closed（`verify.js:127-138`）、`human` 在 approval=never 下 = frozen 待裁（`verify.js:139-143`）。

### P1-05 身份/授权校验覆盖与 SKILL 的"护栏"表述不符（存在越权写面）

- 旧 worker SKILL（HEAD `skills/tree-worker/SKILL.md:51`）称"借身份拦截：caller ≠ owner/creator 的**身份类操作全拒**"；T4 新版已收窄到 done（`tree-worker:80`），但代码事实仍是：
  - **有 caller 校验**：`leaf_add`（added_by，`src/engine.js:136`）、`set-session`（added_by，`:200`）、`set-status`（owner/creator/root，`:166-170`）、`done` event（owner，`:260-264`）。
  - **无 caller 校验**：`leaf:set-context`（`:232-250`，任意会话可改别人水位并触发竹节）、`leaf:set-verification`（`:213-229`，任意会话可写裁决）、`event:append` 非 done 类型（`:253-287`，可伪造 progress/brief_echo）、`dispatch:cancel`（`:455-467`，可取消别人 running 节点）、`tree_verify run`（`index.js:690`，可对任意 leaf 落账）、`drift/heartbeat/communication`（`:595-681`，不可达/无校验）。
- 影响：worker/commander 可互相篡改；"借身份全拒"的护栏承诺不成立。建议：对 leaf 写操作统一 `assertCallerIs(caller, leaf.session_id/added_by)`；SKILL 护栏表按实现写（done 仅 owner；set-status owner/creator/root；set-session creator）。
- 附带：`caller` 提取失败时 `assertCallerIs(undefined, undefined)` 会**通过**（`src/guards.js:65-72`），与 README v0.2/v0.1 边界"提取不到 → fail-closed"（`packages/dsh-tree-engine/README.md:87,99`）不符。

### P1-06 `max_sessions=50` 实测漏计竹节接力会话（护栏数字失真）

- `src/guards.js:34-45` 只统计 `leaf.session_id` + `leaf.segment_chain` + `session_registry`；竹节接力写入的是 `runtime.segmentChain`（`src/engine.js:499`），`leaf.segment_chain` 只由未暴露的 `segment:append` 命令写入（`src/engine.js:290-314`，`index.js` 无对应 action）。
- `dispatch:start` 也不检查 sessionBudget（`src/engine.js:388-452` 无 budget 调用）。
- 影响：`tree-commander:151`/`tree-worker:84`/README 的"树总会话 ≤50"在高频接力场景**不成立**；`validate`（`:343-346`）也不会发现。
- 建议：把 `rt.segmentChain` 纳入 `sessionBudget`/`validate`，或在 SKILL/README 标注"该上限不含竹节接力会话（已知实现边界）"。

### P1-07 `register-session` 的 "idempotent" 宣称与实现相反

- 工具描述：`index.js:732` "register-session (bypass session into budget, **idempotent**)"；README `:17` "旁路登记幂等"。
- 实现：重复注册直接 `E_SCHEMA_INVALID`（`src/engine.js:698-700`），测试明确断言第二次 `ok=false`（`tests/engine.test.js:180-184`）。
- 建议：改描述为"已登记则拒绝（调用方按已存在处理）"，或实现真正幂等（返回既有登记）。

### P1-08 包 README/根 README 的"单行 Cordis row / 测试份数"在 SKILL 工程化后过时

| 位置 | 现文 | 事实 |
|---|---|---|
| `packages/dsh-session-tree/README.md:267` | "the **single** Cordis row this bundle contributes" | `cordis.patch.yml` 现在是 **2 行**（`session-tree` + `session-tree-skills`，:18-26） |
| `packages/dsh-session-tree/README.zh.md:267` | "本 bundle 贡献的**唯一一条** Cordis 行" | 同上 |
| `README.md:22` | session-tree 测试列 "**包内 4 份测试**" | 现有 **5 份**（新增 `test/skills.test.cjs`，同 README:96 已写 5 份） |
| `README.md:150` | tree-engine `tests/` "（**8 个 .test.js** + 偏差登记）" | 现有 **9 个**（新增 `skills.test.js`） |
| `README.md:155` | 目录树列 "demo/ logs/ **skills/**" | 仓根 `skills/` 已删除（git status `D skills/...`） |

### P1-09 `docs/tools-mapping.md` 的 action 表与已实现 8 工具 schema 不匹配（README 仍把它当工具面真源）

- `packages/dsh-tree-engine/README.md:3`："工具面：[docs/tools-mapping.md]"。
- `docs/tools-mapping.md:12-19`（S0 设计表）宣称的 action：`tree_plan create/import/configure`、`tree_node …milestone-add/milestone-update/milestone-set-result`、`tree_dispatch start/cancel/retry/handoff`、`tree_report event/drift/heartbeat/nudge/context/last-event/communication`、`tree_verify gate/append/policy-verdict`、`tree_status overview/subtree/node/stats/validate/sessions`、`tree_maintain backup/restore/migrate/register-session/nudge-reset/archive/gc`。
- 实际 schema（`index.js:464,489,533,561,583,610,708,736`）：`tree_plan [create]`、`tree_node [add,get,list,list-all,set-status,set-session]`、`tree_dispatch [start,cancel]`、`tree_report [context,event]`、`tree_status [overview,validate,sessions,harvest]`、`tree_verify [run,dod,adversarial]`、`tree_log [events,drift,heartbeat,communication]`、`tree_maintain [backup,restore,nudge-reset,register-session]`。
- 影响：任何人/模型照 tools-mapping 调 `tree_report {action:"drift"}` 等会报 unknown action；README 又把它标为工具面。建议：加"v0.4.0 已实现子集"列或改为"设计目标 vs 已实现"两表，README 链接改标"（S0 设计；实际 schema 以 index.js 为准）"。

### P1-10 `docs/session-handoff-2026-11-11.md` 的操作性章节过时（独立包已删）

- 文档头部/§0.4 仍以 v1.2.0 为"当前状态"（`:1,6,18,47-50`），而工作树 package 已 1.3.0（随包 Skill）；建议加"→ v1.3.0 随包 Skill"一行。
- **§8 回滚指令指向已删除的包**：`:322` `plugin_manager({action:"remove_bundle", target:"@local/dsh-session-handoff"})`；该包已删除、profile bundle 已移除——照做会得到 "not found"。应改为 `@orphiczhou/dsh-session-tree` / `include:session-tree` 的 disable。
- §2.1 `status` 返回样例（`:85-103`）缺 v1.2.0 新增字段 `agent_preset` / `permission` / `workspace`（代码：`index.js:669-704`）；§5 测试命令仍 `cd packages/dsh-session-handoff`（`:230-235`，§1-§9 已被 `:52` 标注为 provenance，但 §8 是操作步骤）。
- 建议：将 §1–§9 整体标 "v0.1.0 历史（勿执行）"，或修正 §8/§5/§2.1。

### P1-11 T4 新 SKILL 的事实性错误批次（必须删/改的具体行）

（这是 D 区要求的具体修正，逐条见 §8；此处只列结论）

- `tree-commander:123,244`、`tree-worker:61,149`：timer/无自动 sweep 主张错误（=B3）。
- `tree-commander:104`：`E_NAME_INVALID` 的 helpTopic 是 `naming_convention`，`how_to_init` 只用于 path 不一致的 `E_SCHEMA_INVALID`（`src/engine.js:89-91,102-108`）。
- `tree-commander:122`：`failed` 状态代码中**从不赋值**（`src/engine.js` grep `failed` 仅在注释）；实际只有 `running/succeeded/timeout/cancelled/frozen`。
- `tree-commander:138`："三重闸"→实现只有 2 闸（见 P1-02）。
- `tree-commander:153`：`E_SEGMENT_CHAIN_LIMIT` 由未暴露的 `segment:append` 抛（`src/engine.js:298-300`）；竹节链满的工具面表现是 `runtime.state=frozen`（`src/engine.js:484-487`），不是该错误码。
- `tree-commander:43`：artifact `minSize` 比较的是 `text.length`（UTF-8 读取后的**字符数**），不是"字节"（`src/verify.js:100`）。
- `tree-worker:53`："宿主测量接入前是唯一信号"已过时：`usagePct` 端口已接（`index.js:175-191`，v0.3.9）。
- `tree-worker:136`："等指挥官 nudge"不可执行：`nudge:append` 有引擎命令但**无工具 action**（`index.js:736` 只有 nudge-reset）。
- `tree-worker:21`/`tree-commander:17`：worker 不能有子节点是对的（`src/engine.js:96`），但 `tree_dispatch` **不校验 caller 角色**（`src/engine.js:388-452` 只有 leaf 非 root/依赖闸），"引擎会硬拦"对 dispatch 不成立。
- `tree-worker:135`："指挥官巡逻会看到"——无哨兵/巡逻实现（heartbeat/communication 命令未暴露为工具）；应是"commander harvest / tree_log events 可看到"。
- `tree-worker:49,153` / `tree-commander:137`：done→succeeded 仅当 `runtime.state==='running'`，且 FAIL 时 `tree_verify` 不抛错（返回 `{result:{pass:false}}`，`index.js:690-698`）——commander 必须读 `.result.pass`，本条建议加入 §1.4。

### P1-12 版本/日志/发布面的一致性

- `packages/dsh-tree-engine/index.js:807` 注册日志仍打印 `v0.3.3`（package 已 0.5.0；`diag` 打印 v0.4.0，`index.js:762`）——活体验收时按 console 判断版本会误判。
- `packages/dsh-tree-engine/README.md:45` v0.4.0 节 "测试：61 项全绿"，但 v0.4.0 时代实际引擎测试为 **62**（本次 `62 引擎 + 4 skills = 66`；引擎逻辑未改）。
- `packages/dsh-tree-engine/README.md:105` 运行测试命令硬编码本机 node 路径 `C:\Users\sir_c\...\node.exe`（此机存在，但不可移植）。
- `agent.md:87` D13 称"`package.json.files` 纳入 `skills`"：session-tree 已加（`packages/dsh-session-tree/package.json:38`），**tree-engine package.json 无 `files` 字段**（`:1-17`）——若未来发布到 npm，`skills/` 不会被包含。
- `agent.md:32` 已更新 66/66；`README.md:19` 已更新 66/66（工作树）——一致，无需改。

---

## 4. 建议（P2/P3，不阻塞但应记录）

| # | 建议 | 证据 |
|---|---|---|
| P2-01 | 竹节阈值 42 应标注"DSH 缺省；可被 `TREE_ENGINE_CONFIG.ctx_segment_threshold` / `bambooThresholdPct` 覆盖"；`src/guards.js:24`（源缺省 85）与 `src/engine.js:31`（DSH 注入 42）并存，硬编码 42 会误导自建部署 | `skills/*:160,60`、`packages/dsh-tree-engine/README.md:91` |
| P2-02 | `set-context` 的 `segment_pending` 仅在 `leaf.status==='active'` 时置位（`src/engine.js:240`），而 worker 初始 `pending_brief` 且 dispatch 不改 status → 自报后状态位不翻；新 worker SKILL 已注明"可能不翻"，compander SKILL `:161` 仍写无条件"leaf 置 segment_pending"，建议对齐 | 复现 §9.3 `segment_pending=false` |
| P2-03 | `tree_commander`/`tree_worker` 应列出 12 类事件闭集（`src/state.js:27`）：`done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check/review_round/subagent_spawn/progress/child_done`；自造 type → `E_SCHEMA_INVALID` | `src/engine.js:257` |
| P2-04 | `tree-maintain` 的 `nudge-reset` 依赖的 `nudge:append` 无工具；在 nudge 工具补齐前，SKILL 不应把 nudge 作为可等待信号 | `index.js:736,748`、`src/engine.js:316-330` |
| P2-05 | `tree-engine` 节序错乱（v0.5.0 → v0.3 → v0.3.1 → v0.3.2 → v0.4.0 → v0.3.9 → v0.3.8）；建议按版本重排或顶部加"最新在 v0.5.0 / 历史章节降序" | `README.md:5,13,37,47,58` |
| P2-06 | `tree-engine README` 的 v0.3/v0.2/v0.1"边界"段落已被后续版本解决（如"tree_verify 未注册"），建议加"历史边界，已解决"标注避免误读 | `README.md:66-72,81-87,95-100` |
| P2-07 | `docs/engine-spec.md` 与实现差异需登记：事件"11 类"（实际 12，缺 `child_done`，:49 vs `src/state.js:27`）、done 三重闸第三项"树结构校验"未实现（:40）、leaf"5 件套"中 `report_protocol/autonomy/self_audit` 无实现字段（:25）、`audit_gate/audit_append` 命令未实现（:48,52） | 同左 |
| P2-08 | `packages/dsh-session-tree/README.md:118` 称 tree_send "delivers … that is **not** your direct parent or direct child"，但同文 :152 又示例"Parent → child"；工具描述（`index.js:193-197`）是"including a sibling"（正确）。建议 README 改为"包括兄弟；直接父/子也可（但内置 send_message 已覆盖）" | 同左 |
| P2-09 | `docs/session-handoff-2026-11-11.md` §2.6 说"交接文件写成功后记录"防重复表；§3 顺序是先写文件再 spawn——因此 **spawn_error 之后重试会被 recent-handoff 拒**。建议在 `session-handoff` SKILL 的 `spawn_error` 行补"需 `force:true` 或等 5 分钟" | `index.js:1183-1184,1221-1225` |
| P2-10 | `session-handoff` SKILL §5 列了 `maxTokens` 为继承事实，但 `status` 返回不含 maxTokens（只在 handoff 的 `successor.max_tokens`）；建议在验收清单注明去哪看 | `index.js:826-840,669-704` |
| P2-11 | `session-handoff` SKILL §2 的"本机实测样例"建议标注"样例随宿主版本可能变"，避免读者把行格式当契约；工具 `render` 是 400 字符截断的单行（`index.js:939`） | 已验证 render 输出与样例一致（§9.5） |
| P2-12 | `tree-engine README:54` 说 worker SKILL 重写"用 **drift 申报**替代 autonomy_override"，但工具面无 drift 写入（见 P1-05/P2-04）；应改为"用 `tree_report {action:'event', type:'progress', meta:{drift:{...}}}` 申报（工具面无 drift 写入命令）" | `index.js:702-727`（tree_log 只有 list） |
| P2-13 | 根 README 文档索引仍以 v1.2.0 指 session-handoff（`README.md:167`），可加"v1.3.0 随包 Skill"；`agent.md:76` D2 的"docs/logs/skills/demo/packages 全部内容"应删 `skills/`（仓根已删） | 同左 |
| P2-14 | `tree_status harvest` 的 render 只在 `v?.swept` 时展示事件；`sweepMode` 在无事件时不显示——建议 harvest 永远输出 `sweepMode`（当前 `index.js:588` 分支 else 不含） | `index.js:588-598` |
| P2-15 | 工具 `tree_report` 的 schema `pct: {type:'number'}` 允许小数，但引擎要求整数（`src/engine.js:234`）；建议 schema 加 `multipleOf:1` / description 写整数（SKILL 已写整数） | `index.js:563` |

---

## 5. A 区差距表（tree-engine 代码 ↔ 两份 tree SKILL）

> 仓根旧版（HEAD `skills/tree-*.md`）已由 T4 迁入包内并改写；下表同时覆盖：①旧版（HEAD，历史文档仍可能引用）②新版（`packages/dsh-tree-engine/skills/**`，T4 draft，审计时 mtime 15:25）。"代码事实"列给 `file:line`。

| # | SKILL 宣称（旧/新） | 代码事实 | 判定 |
|---|---|---|---|
| A-01 | 旧 worker:5 / 新 worker:138：`tree_leaf_autonomy_override` 不存在，用 drift 申报 | 无 autonomy 命令（正确）；但**无 drift:append 工具**（`index.js:716-721` 只 list） | 旧版"用 drift 申报"不可执行；新版改为 progress+meta（正确）。README:54 仍写 drift 申报 → P2-12 |
| A-02 | 旧 worker:26 / 新 worker:53："宿主测量接入前是唯一信号" | `usagePct` 已接入（`index.js:175-191`，use tokenMeter.measure；sweep `:551-553` 先到者生效） | 过时，P1-11 |
| A-03 | worker:60 / commander:161：pct≥42 → 置 segment_pending 并接力 | 状态位仅 active 时置（`engine.js:240`）；接力在 sweep 中按 `leaf.context_usage_pct` 或宿主测量触发（`:549-556`）；worker 缺省 pending_brief | 部分失真（P2-02） |
| A-04 | 旧 worker:51："caller≠owner/creator 的身份类操作全拒" | 仅 done/leaf_add/set-status/set-session 校验；set-context/set-verification/event/dispatch-cancel/verify 无校验（`engine.js:213,232,253,455`；`index.js:690`） | 旧版过宽；新版已收窄但仍需代码补护栏（P1-05） |
| A-05 | 旧 commander:31：`brief/dod` 写入 "worker 首读" | dispatch 用 `spec.prompt ?? leaf.brief`（`engine.js:406`），brief 对象会被拼成 `[object Object]`（`index.js:77`）；`leaf.dod` 不进提示词（DoD 来自 policy，`index.js:72`） | 旧版失真；新版已删"首读"，但样例仍传 dod（P1-03） |
| A-06 | 旧 commander:39："等 45 秒起 harvest（30 秒/轮）" | 无 45/30 常量；sweep 周期 `sweepIntervalMs=60s`（`engine.js:369-374`）；timeout 30min（`:369`） | 数字无出处（新版改 30–45s，仍建议绑定 60s 说明） |
| A-07 | 旧 commander:43：verify 不传 policy_id 按 taskType 路由 | 正确：`index.js:622-634` → `verify.js:76-78`（research/question→research-answer，doc→artifact-doc，code-change→code-change，default→self-report） | ✅ |
| A-08 | 旧 worker:49 / 新 skills：状态机闭集、done 需 done event+milestones | 正确但 tool 面不可达（P1-02）；`tree_verify` PASS 不参与 succeeded（P1-01） | 需修（提示） |
| A-09 | old/new：事件 ts 单调、相等放行 | 代码 `if (ts < last.ts)`（`engine.js:272`）→ 相等放行；但工具路径 `tsIso` 恒由引擎生成，**该约束不可触发** | 表述无害但"护栏"名不符实（P2-03 类） |
| A-10 | 旧 commander:50 / 新 commander:149-153：active≤20、spawn≤15、sessions≤50、depth≤3、链长5 | 对应 `guards.js:19-25`、`engine.js:298-300,484-487`；**sessions 漏计 relay 链**（P1-06）；链长错误码表述不准（P1-11） | 数字对 4/5，第 3 项失真 |
| A-11 | 新 commander:104：naming `<tree_id>-<path 段>-<name>`；path 逐字等于 leaf_id 路径段 | `LEAF_NAME_RE` 实测：`tree1-C1-worker`/`tree1-C1a1-worker` OK；`tree1-review1-worker`、`tree1-worker-x` INVALID；path 段必须**大写开头**（`[A-Z]\d*(?:[a-z]\d*)*`）；不写 path 时不校验（`engine.js:89-108`） | 需补边界（path 段不能用小写词；`Tree_id` 4-8 字符） |
| A-12 | 新 commander:114（dispatch 样例带 `dod`） | `dod` 不生效（P1-03） | 需删 |
| A-13 | 新 commander:137 / 新 worker:90："PASS 才可收口 / verify 裁决" | 引擎不强制（P1-01）；且 `tree_verify run` FAIL 不抛错（`index.js:690-698`） | 标"协议纪律"可接受，但需给 commander 读 `.result.pass` 的命令示例 |
| A-14 | 新 commander:138 / 新 worker:82：set-status done 三重闸；里程碑无工具 | 正确指出"里程碑面无工具"；"三重"实为 2（P1-02） | 小修 |
| A-15 | 新 commander:123/244、worker:61/149：无 timer / 无后台收割 | 实际 `sweepMode=timer`（B3） | **BLOCK** |
| A-16 | 新 commander §1.2/§6：tree_plan 建树无条件 | 被派发 commander 已有 tree_id；重复 create → E_DUPLICATE_LEAF；换 id → 树分裂（B4） | **BLOCK** |
| A-17 | 新 commander:186-202 / worker:119-131：交接后 owner 不迁移、需 set-session/cancel→start | 与代码一致（`engine.js:417` vs `:492-500`；`set-session` `:196-210` 需 caller===added_by + strict UUID） | ✅ 但**漏了竹节接力后的同一问题**（B1） |
| A-18 | 新 commander:118：assignee.preset 仅记录、不应用 | 代码一致（`index.js:91-97`，`engine.js:419-427`） | ✅ |
| A-19 | 新 commander:63 / worker:15：DSH_SESSION_ID = 裸 UUID v4 | 实测本会话 `$env:DSH_SESSION_ID=00a0b6f1-ed23-4607-9294-d8fdf192834e`（裸 v4） | ✅ |
| A-20 | 新 commander:43：artifact `**/*.md` ≥200 字节 | `text.length` = 字符数（`verify.js:98-100`）；取 `files.sort()[0]`（:98） | 措辞需改"字符"（P1-11） |
| A-21 | 新 commander:122：运行时状态含 `failed` | 代码从不赋值 `failed`（仅注释 `engine.js:366`）；实际 `running/succeeded/timeout/cancelled/frozen` | 小修 |
| A-22 | 新 commander:153：链满触发 `E_SEGMENT_CHAIN_LIMIT` | 该错误只在未暴露的 `segment:append`（`engine.js:298`）；竹节链满 → `frozen`（`:484-487`） | 小修 |
| A-23 | 新 commander:47/worker:59：pct 整数 0-100 | 正确（`engine.js:234`） | ✅ |
| A-24 | 新 worker:21：worker 用 tree_dispatch 会被硬拦 E_SCHEMA_INVALID | dispatch 不校验 caller 角色；硬拦的是"worker 不能有子节点"的 `tree_node add`（`engine.js:96`） | 措辞小修 |
| A-25 | 新 worker:135：指挥官"巡逻"会看到 blocked | 无哨兵/巡逻实现；`tree_log {action:"events"}` 可查（`index.js:716`） | 措辞小修 |

**命令行样例核对（旧版逐条）**

| 旧 SKILL 命令 | 是否存在 | 备注 |
|---|---|---|
| commander:25 `tree_node {action:"add", …}` | ✅ | 但 leaf 样例 path/brief 需按 A-11/A-05 修正 |
| commander:37 `tree_dispatch {action:"start"}` | ✅ | — |
| commander:39 `tree_status {action:"harvest"}` + `tree_node {action:"get"}` | ✅ | `harvest` 调 `engine.sweepTick()`（`index.js:590-593`） |
| commander:43 `tree_verify {action:"run"}` | ✅ | FAIL 不抛错（P1-01） |
| commander:48 `tree_node {action:"set-status", status:"pruned"}` | ✅ | 级联 pruned（`engine.js:178-189`） |
| commander:55 `tree_report {action:"event", type:"done"}` | ✅ | 仅 owner；meta 自由 |
| worker:17 `tree_report type:"brief_echo"` | ✅ | 12 类之一（`state.js:27`） |
| worker:18 `type:"plan"` / :19 `type:"progress"` | ✅ | — |
| worker:28 `tree_report {action:"context", pct}` | ✅ | pct 必须整数（`engine.js:234`） |
| worker:36 `type:"blocked"` | ✅ | — |
| worker:5 autonomy_override | ❌ 不存在（已正确标注） | ✅ 该项无漂移 |
| 未出现但文档提到的 `drift_append` / `nudge` / `heartbeat_append` / `communication_log` / `segment_append` / `audit_*` | ❌ 无工具 action（引擎 table 有部分命令但未暴露） | 见 P1-05/P2-04/P2-12 |

---

## 6. B 区：tree-engine README / package.json / 测试 / 路径引用

### 6.1 README ↔ package.json ↔ 测试

| 项 | 宣称 | 事实 | 判定 |
|---|---|---|---|
| 版本 | 顶部 `## v0.5.0 增量`（`README.md:5`）；package.json `0.5.0`（`package.json:3`） | 一致 | ✅ |
| 工具数 | "工具面（全量 8 个）"（`:15`） | `index.js:803` 注册 8 个；与 schema 一致 | ✅ |
| 测试数 | 顶部 `66/66`（62 引擎 + 4 skills）（`:10`） | 实测 66/66（62 + 4） | ✅（v0.5.0 节已更新） |
| 历史测试数 | v0.4.0 节 "61 项全绿"（`:45`） | v0.4.0 时代人工计数为 62；当前引擎测试 62 | ⚠️ off-by-one（P1-12） |
| 运行命令 | 硬编码 `C:\Users\sir_c\...\node.exe`（`:105`） | 本机存在但不可移植；应写 `node --test tests/*.test.js` + 可选 bundled 说明 | ⚠️ P1-12/P2 |
| 版本日志 | — | `index.js:807` console 仍打印 `v0.3.3`；`diag` 打印 v0.4.0（`:762`）；package 0.5.0 | ⚠️ P1-12 |
| 行为基准链接 | `docs/engine-spec.md`（`:3`） | 该文档为 S0 冻结/上游行为，已与实现有差异（P2-07） | ⚠️ 建议加差异声明 |
| 工具面链接 | `docs/tools-mapping.md`（`:3`） | action 表大量未实现（P1-09） | ⚠️ P1 |
| 边界章节 | v0.3 边界"tree_verify 未注册/验证层第二批未实现"（`:66-72`） | 已有 v0.3.9/v0.4.0/v0.5.0 实现 | ⚠️ 建议标"历史"（P2-06） |
| 节序 | v0.4.0 在 v0.3.2 与 v0.3.9 之间（`:37→:47`） | 非时间序 | ⚠️ P2-05 |

### 6.2 仓根 `skills/` 迁入包内后需更新的路径引用（file:line 清单）

T4 已删除仓根 `skills/`（git status `D skills/tree-commander/SKILL.md`、`D skills/tree-worker/SKILL.md`）。以下文档仍引用旧路径：

| 文件:行 | 现引用 | 处置建议 |
|---|---|---|
| `README.md:155` | 目录树 "demo/ logs/ **skills/**" | 删除 `skills/` 或改为"（skills 已随包：`packages/*/skills/`）" |
| `docs/flaudit-report.md:18` | "协议 \| skills/tree-commander/SKILL.md、skills/tree-worker/SKILL.md" | 历史审计：加注"（旧路径；已迁入 packages/dsh-tree-engine/skills/）" |
| `docs/handoff-2026-10-04.md:80` | "已闭合（v0.3.9）：skills/tree-worker/SKILL.md…" | 历史交接：加路径注记即可（勿改历史结论） |
| `docs/proposals-from-agent-notes.md:35` | "改动面：纯文档(skills/tree-commander/SKILL.md)" | 历史提案：加注 |
| `docs/segment-handoff.md:23` | "skills/tree-worker/SKILL.md:50、:70、:686–688、:728" | 行号来自旧 54KB SKILL，当前 SKILL 仅 154 行——历史设计文档；建议加"行号为上游旧版"或改指新路径 |
| `demo/flaudit/w4-skillops.md:3,10,19,27,35` | 旧路径 + 旧行号（`:30/:41/:49/:38`） | 历史 demo 产物，可保留；若作为公开资料建议加注 |
| `docs/frozen-parent-plan/PLAN-v1.7.md:51,115,253` | `default-skills/tree-worker/SKILL.md`（上游 Proma-Easy 资产） | **不需改**（非本仓路径），但建议注明"上游资产" |
| `agent.md:76` | D2 "包含 docs/logs/**skills**/demo/packages" | 改为"docs/logs/demo/packages（skills 随包）" |
| `agent.md:87,132` | 已写"迁入包内/仓根移除" | ✅ 无需改 |
| `packages/dsh-tree-engine/README.md:7` | "`skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md`"（相对包内省略前缀） | 建议改 "本包 `skills/...`" 避免与仓根混淆 |
| `packages/dsh-tree-engine/README.md:54` | 已注明 "v0.5.0 起位于本包 `packages/dsh-tree-engine/skills/tree-worker/SKILL.md`" | ✅ 但同句"drift 申报"需改（P2-12） |
| `packages/dsh-session-tree/README.md:34,205,270` / `README.zh.md:34,205,270` | 新路径 `skills/session-handoff/SKILL.md` | ✅ 正确（包内相对路径） |
| `docs/skill-e2e-2026-11-11.md:15-16` | 新路径 | ✅（T6 新文档） |

### 6.3 测试/打包一致性

- `packages/dsh-tree-engine/tests/skills.test.js:50-53` 断言仓根旧 skills 不存在（已通过）；`:55-63` 断言 patch 含 providerName/includeDefaultRoots/bundledSkillDir（已通过）。
- `packages/dsh-session-tree/test/skills.test.cjs` 3/3 通过；`README.md:296` 的说明与之一致。
- `verify-bundle.mjs` 仍 0 fail（含新 patch 两行）。
- 注意：`packages/dsh-tree-engine/package.json` 无 `files` 字段（P1-12 末项）。

---

## 7. C 区：session-tree（v1.2.0/v1.3.0）代码 ↔ README/README.zh/docs

### 7.1 工具注册条件

| 文档宣称 | 代码事实 | 判定 |
|---|---|---|
| `README.md:78`："`tree_send` 需要 `tools`、`subagents`、`sessionQuery`；`session_handoff` 需要 `tools`、`subagents`、`agents`、`tokenMeter`；缺服务插件照常加载" | `index.js:1253-1256` 两次 `ctx.inject`（同上四件套）；`apply` 无整体失败路径 | ✅ 一致 |
| — | 注意：`session_handoff` 把 `tokenMeter` 列为**硬注册条件**，而 `collectFacts` 对 tokenMeter 缺失本可降级（`index.js:315-335`：notes + unavailable） | 设计不一致（低风险）：若某组合无 tokenMeter，工具直接不可见，而非"可用但 pct unavailable"。README 已如实写条件，故不算文档漂移；建议代码改为可选服务或文档说明取舍 |

### 7.2 `tree_send` 文档 vs 代码

| 文档 | 代码事实 | 判定 |
|---|---|---|
| 参数 `target`/`message` 必填；`delivery` enum `steer`(默认)/`queue`；`parent` 可选（省略则读 target 日志的 parentSession）——`README.md:120-125` | `index.js:198-222` schema 完全一致；`makeTreeSendExecute` `:243-293` 行为一致（`parent` 缺省时 `filterSessions` 读 `header.parentSession`，缺失即报"not a subagent session"） | ✅ |
| 返回 `{messageId, parent, delivery}`，仅受理不等回复（`README.md:127-131`） | `index.js:223-240,284-288` 一致；render 文本 `tree_send: delivered to <target> (parent <parent>, <delivery>)`（`:234-240`） | ✅ |
| 失败前缀 `tree_send:`（`README.md:164`） | `:260,266,290` 一致 | ✅ |
| "Root → grandchild 无路径，会 `subagent/parent-unavailable`"（`:154`） | 代码把 target 的 **direct parent 地址**作为投递地址（`:273-283`）；若 parent 不活/服务拒绝则抛错。语义与文档兼容 | ✅（行为依赖宿主服务） |
| 工具描述"including a sibling that is neither your direct child nor your direct parent"（`index.js:193-197`） | 代码不限制 adjacent 目标（parent→child 也可，README `:152` 有示例） | 表述正确；README `:118` 的"NOT direct parent or child"易误读（P2-08） |
| 无 `tree_send` 的事后验证/回执 | 代码返回受理 id；文档已明示（`:127,160`） | ✅ |

### 7.3 `session_handoff` 文档 vs 代码

| 文档宣称 | 代码事实 | 判定 |
|---|---|---|
| 继承矩阵：root→agents.create + workspace attach；sibling→startActivation（同父、无需 workspace attach）；degraded root→meta.parentSession；无 agents→文件+spawn_error（`README.md:175-195`、`docs/session-handoff:31-35,145-153`） | `planSuccessor` `:546-586`、`spawnSuccessor` `:850-933`、`attachToWorkspace` `:507-532`、`buildSuccessorSetup` `:627-667`、`appendInheritedPolicy` `:609-615`——逐项一致 | ✅ |
| 继承字段：cwd/workspace/agentPreset/permission(sandbox+approval)/provider/model/reasoningEffort/maxTokens（`README.md:185-193`） | `inheritanceFacts` `:826-840` + `buildAgentOptions` `:589-596` + status 返回 `agent_preset/permission/workspace`（`:669-704`） | ✅ |
| `threshold_pct` 默认 50；低于阈值 rejected 不写文件；5 分钟重复 rejected；`force` 双绕（`README.md:197`、`docs:109-110,169-171`） | `:1087,1099-1133`；`state.set` 在**文件写成功后、spawn 前**（`:1183`） | ✅；仅 spawn_error 后重试需 force（P2-09） |
| `spawn:false` → `file-only`；文件写失败→整体报错；spawn 失败→保留文件+`spawn_error`（`docs:111-112`） | `:1111-1116,1175-1183,1201-1206,1210-1214,1241-1246` | ✅ |
| `render` 单行、不倾倒文件内容（`docs:81`、SKILL §2/§5） | `renderSummary` `:936-983`（单行、<=400 字符）；实测输出见 §9.5 | ✅ |
| 工具描述"status … the successor plan (root or sibling)"（`:993-1003`）、`kind` root/sibling/auto（`:1013-1020`） | `normalizeKind` `:141-144`；`planSuccessor` 矩阵 | ✅ |
| 文档 §2.1 的 status 样例缺 `agent_preset/permission/workspace`（`docs:85-103`） | 代码返回三字段（`:683-696`） | 文档过时（P1-10） |
| 文档 §8 回滚目标 `@local/dsh-session-handoff`（`docs:322`） | 包已删除、profile bundle 已移除；当前 bundle 是 `@orphiczhou/dsh-session-tree` | 操作指令失效（P1-10） |
| 文档标题/状态 v1.2.0（`docs:1,6,18,47`） | 工作树 package 1.3.0（随包 Skill） | 版本说明过时（P1-10） |
| SKILL §2 样例 `context=18.7% … permission=danger-full-access/danger-full-access/never` | 以 `renderSummary` 复算一致（§9.5） | ✅（建议标"样例"以免当契约） |

### 7.4 热更/缓存说明

- 见 **BLOCK-2**：`packages/dsh-session-tree/README.md:248`、`README.zh.md:248` 与 `agent.md:86/141`、`README.md:143` 冲突；`docs/session-handoff:43` 与 agent.md 一致（disable→enable 有效）。
- README 其余热更说明正确：客户端半只需刷新页面（`:242-246`）、Loader 按包名缓存（`:248` 前半段结论正确，只是 remediation 写错）。
- `docs/session-handoff:299` 的"热更重复注册、未显式 dispose"风险与代码一致（`apply` 直接 `tools.register`，`index.js:1255,1259` 无 dispose）。

### 7.5 `docs/e2e-handoff-2026-11-11.md` 与测试计数

- `docs/session-handoff:48` 的 handoff 34/34、render 全绿、style-guard 22/22、verify-bundle 0 fail —— 本次复跑全部成立（§9）。
- 真机 E2E 数字（root 14/14、sibling 12/12）无法在审计环境复跑，按文档采信（标注"未复核"）。

---

## 8. D 区：给 T4 三份新 SKILL 的具体修正（可直接改）

### 8.1 `packages/dsh-tree-engine/skills/tree-commander/SKILL.md`

| 行 | 现状 | 修正 |
|---|---|---|
| :7/:50/:241 | "tree_plan 建树"无分支 | **加"派发场景分支"**（B4）：任务书已给 tree_id 且有树 → 跳过 plan；只有根/无树才 create |
| :43 | artifact "≥200 字节" | 改"≥200 字符（UTF-8 文本 `text.length`，非字节）" |
| :104 | "看 `helpTopic=how_to_init`" | 改"`E_NAME_INVALID` 的 helpTopic=`naming_convention`；path 段不符才是 `E_SCHEMA_INVALID`（helpTopic=`how_to_init`）"；并补 path 段规则：**大写开头**，如 `C1`/`C1a1`，其余写法 INVALID |
| :112-115 | dispatch 样例含 `dod` | 删 `dod`（不生效）；可加一句"DoD 由 leaf.taskType → 策略决定；`leaf.dod` 不进提示词" |
| :119 | "派发提示词自动附 DoD+结算指令" | 改"附**策略 DoD**（来自 taskType）+ 结算指令；不在 DoD 内" |
| :122 | 状态列 `failed/timeout/...` | 删 `failed`；列 `running/succeeded/timeout/cancelled/frozen` |
| :123/:244 | "无 timer/无后台收割/必须显式 harvest" | **按 B3 改**："timer 服务缺失时引擎用进程内 60s 周期兜底（sweepMode=timer）；harvest 可立即触发，别依赖实时性" |
| :137 | "PASS 才可视为收口（协议纪律）" | 补："`tree_verify` FAIL **不会抛错**，返回 `result.pass=false`；commander 必须自己读 `.result.pass` 再决定打回" |
| :138 | "三重闸" | 改"两闸（done 事件 + milestones 全 audit_pass）；里程碑面无工具命令 → set-status done 不可达，收口以 runtime.succeeded 为准" |
| :151 | 树总会话 ≤50 | 加脚注"**不含竹节接力会话**（`runtime.segmentChain` 未计入，已知实现边界）" |
| :153 | `E_SEGMENT_CHAIN_LIMIT` | 改"车节链满 → `runtime.state=frozen`（工具面无该错误码；`E_SEGMENT_CHAIN_LIMIT` 属未暴露的 segment:append）" |
| :161 | "pct≥42 → leaf 置 segment_pending" | 加"（仅 leaf 为 `active` 时置位；初始 `pending_brief` 不翻，但 harvest 仍按 pct 触发）" |
| §3.3 | 交接后协调只覆盖 session_handoff | **补竹节接力行**（B1）："竹节接力后同样 owner 不迁移 → 接力会话写 done 会被拒；处理：旧会话交棒前先写 done，或 commander 用 harvest 返回的 `relay.sessionId` 调 set-session 重绑" |
| §3.3 :198 | "或用 `tree_send` 发给上级" | 改"直接父会话用原生 `send_message`；跨层（兄弟/越级）才用 `tree_send`（需目标父会话活着）" |
| 新增 | 事件类型 | 加 12 类事件闭集表（P2-03），强调自造 type → E_SCHEMA_INVALID |

### 8.2 `packages/dsh-tree-engine/skills/tree-worker/SKILL.md`

| 行 | 现状 | 修正 |
|---|---|---|
| :21 | "tree_dispatch … 引擎会硬拦 E_SCHEMA_INVALID" | 改"worker 不能建子节点（`tree_node add` 硬拦 E_SCHEMA_INVALID）；`tree_dispatch` 本身不校验 caller 角色——协议纪律：不要用" |
| :49/:153 | "done → runtime.succeeded"（无条件） | 加"仅当 leaf 仍处于 `running` 且你是**首次派发**的 owner；竹节接力后的新会话写 done 会被拒（§4.3）" |
| :53 | "宿主测量接入前是唯一信号" | 删；改"自报是主信号；宿主 tokenMeter 测量接入后先到者生效（本机已接）" |
| :60 | "task-specific 简报全文 + 同一 DoD" | 改"若宽限内收到 K1–K5 则全文附带，否则 `no-handoff-summary` 降级（不保证送达）"；"同一 DoD"→"同一 taskType 策略 DoD" |
| :61/:149 | 无 timer / 必须显式 harvest | 按 B3 改（同 commander:123） |
| :82 | 状态机行含 "done 需里程碑全过" | 加"（工具面无法完成 set-status done；结算以 runtime.succeeded 为准）" |
| :84 | 预算表 50 | 加"（不含竹节接力会话，见 commander §2 脚注）" |
| :135 | "指挥官收割/巡逻会看到" | 改"commander `tree_status harvest` / `tree_log {action:"events"}` 可看到" |
| :136 | "等指挥官 nudge" | 删 nudge（无工具 action）；改"发 progress 说明疑点，等 commander 决定" |
| 新增 | 事件类型 | 加 12 类闭集（brief_echo/plan/progress/blocked/done 为常用；其余保留类型别自造） |
| §4.3 | owner 不迁移协调 | 补"竹节接力"分支（同 B1） |

### 8.3 `packages/dsh-session-tree/skills/session-handoff/SKILL.md`

| 行 | 现状 | 修正 |
|---|---|---|
| :150 | spawn_error 后"不要重复刷交接（5 分钟防重复）" | 补"需要立即重试时用 `force:true`（用户明确要求），否则等 5 分钟；重试前先修 hosts 服务问题" |
| :126 | maxTokens 列为继承事实 | 注明"maxTokens 只在 handoff 成功返回的 `successor.max_tokens` 可见；status 不报" |
| :37 | "本机实测样例" | 建议改为"样例（随宿主版本可能变）"，避免读者当契约 |
| :34 | "返回是一行文本" | 准确（`render` 400 字符截断）；可补"完整对象见工具返回值"（已 :57 有） |
| :181-182 | 全层级纪律提到 tree 协调 | 已正确引用 tree SKILL；可在 §8 表加一列"tree leaf owner 需要 commander set-session 重绑（见 tree-worker §4.3）" |
| 新增 | 发现性 | `description`/`whenToUse` 已覆盖"继续干/快到上限/交接给新会话/上下文 50%"，**无需改**（本会话 Skill 目录已命中） |

**发现性（极简提示词）评价**：三份 SKILL 的 frontmatter/`whenToUse` 已覆盖 T6 三组提示词（A「拆成三层派人做」、B「继续干/快上限就交接」、C「三层都能干活+中间交接」）；本会话 `<available_skills>` 已实际出现三条目录项，**发现性达标**。剩余风险是"被看到"≠"按正确流程执行"（B1/B3/B4 的执行语义）。

---

## 9. 证据附录（本次实际执行）

### 9.1 测试运行

```text
# packages/dsh-tree-engine
ℹ tests 66 / pass 66 / fail 0        # 62 引擎 + 4 skills 打包（新增 tests/skills.test.js）

# packages/dsh-session-tree
test/handoff.test.js      ℹ tests 34 / pass 34 / fail 0
test/skills.test.cjs      ℹ tests 3  / pass 3  / fail 0
test/render.test.cjs      133/133 + 9/9 + 11/11，合计失败 0
test/style-guard.cjs      ALL CHECKS PASSED
scripts/verify-bundle.mjs OK — 0 failing check(s)
provider-conformance.cjs  失败（已知 rc.2 fixture 依赖，见 agent.md:97）
```

### 9.2 活体证据

- `apply.log` 末段：`apply() entered (v0.4.0)` → `timer resolve failed: cannot get property "timer" without inject` → `sweep:degraded:no-timer …` → `engine ready (sweepMode=timer)` → `apply complete: 8/8 registered`。
- 本会话 `<available_skills>` 出现 `session-handoff` / `tree-commander` / `tree-worker`（patch row 2 生效的活体证据）。
- `$env:DSH_SESSION_ID = 00a0b6f1-ed23-4607-9294-d8fdf192834e`（裸 UUID v4，支持 SKILL "本机实测"表述）。

### 9.3 竹节接力 / done 所有权复现（memoryStore + 假会话 id）

```text
dispatch# 1  → attempt=1
set-context 60 → segment_pending=false   （worker 初始 pending_brief）
sweep → [{event:"bamboo", relay:"ok", briefState:"ok", sessionId:<relay>}]
leaf.session_id === workerSession(old)? true
runtime.state=running, rt.subagentSessionId===relay, rt.segmentChain.length=1, leaf.segment_chain.length=0
done by RELAY session -> ok=false code=E_BORROWED_IDENTITY
done by OLD session  -> ok=true
```

### 9.4 sweepMode 复现

```text
createEngine({store:memoryStore(), clock:systemClock()}); startSweep()
→ {"sweepMode":"timer","hasStop":"function"}
```

### 9.5 `session_handoff` render 复算（与 SKILL §2/§5 样例比对）

```text
STATUS:    session_handoff status: context=18.7% (threshold 50%) pressure=186666/1000000 model=opencode-go/deepseek-v4.1-flash effort=max preset=standard permission=danger-full-access/danger-full-access/never successor=sibling next=continue
HANDOFF:   session_handoff: wrote C:/w/HANDOFF-x-20261111-150000.md; successor session-1 kind=root preset=standard workspace=ws-1 inherited=session-route
REJECTED:  session_handoff rejected: context 12.5% is below threshold 50% (pass force:true to override)
SPAWNERR:  session_handoff: wrote C:/w/HANDOFF-x.md; successor FAILED: no successor path available
FILEONLY:  session_handoff: wrote C:/w/HANDOFF-x.md (no successor spawned)
```

---

## 10. 边界与未覆盖

1. **未改任何代码/配置/SKILL/文档（除本审计报告）**；未 git 提交。
2. 真机 E2E 数字（handoff root 14/14、sibling 12/12）未复跑，采信 `docs/e2e-handoff-2026-11-11.md`。
3. 活体 tree-engine 数据（`floweng/prj_mw4k` tree-state）仅用于旁证，未作为语义依据；`apply.log` 最后 apply 时间为 2026-11-10，当前活体模块代际可能早于工作树代码（D12 缓存），故"活体行为"结论以源码 + 本地引擎复现为准。
4. 并发快照：T4 在 15:21–15:25 写入三份 SKILL，Lead 同步改 README/版本；本报告对 SKILL 行号的引用基于该快照；若 T4 继续调整，需复核 §8。
5. `provider-conformance.cjs` 失败是已知环境 fixture 问题，不计入本次 gap。
