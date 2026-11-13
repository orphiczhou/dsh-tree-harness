# 三层组合受控试点 v2：flow 节点现场建树 + maxDepth=5 边界压测（2026-11-13）

> 性质：一次性证据报告（结论不回写）；剧本依据 [composition-playbook.md](../guides/composition-playbook.md) §5。试点配置与提示词已入仓：[demo/t3cpilot2/](../../demo/t3cpilot2/)。
> 承接 [D21 试点 v1](composition-pilot-tree-flow-tree-2026-11-13.md)：v1 的内层树由 Lead **预置**（偏离 D1），本试点把该偏离补上，并首次压深度边界。
>
> **结论先行（分三句）**：
> 1. **PASS**：flow 节点 `INNER` 在自身一次性会话内用 `tree_plan` **现场创建**内层树 `t3c4`（`session_id`/`added_by` 用自标识，`self_spec` 与 `$env:DSH_SESSION_ID` 双通道一致），派发 commander → worker 并收口；深度链 **1→2→3→4→5** 由各会话 header `delegationDepth` 实证；flow `T3C3-R1` **succeeded / integrity=verified**；两树 `validate` **0 issues**；无 drift、无 bamboo 接力。
> 2. **发现（平台/插件边界）**：深度 6 探针**没有被拒绝**——`f351d7ee` 会话被成功创建（header `delegationDepth=6`）。根因是 `dsh-subagent` 服务只在调用方显式传 `request.maxDepth` 时才校验；flow 执行器与 tree 派发都不传 → profile 的 `subagent.maxDepth=5` 对**插件编程派发路径不生效**（详见 §5）。
> 3. **两个次要发现**：① 现场建树的验证归属缺口（creator=flow 节点会话结束即 dispose，Lead 事后无法补 `tree_verify`：`E_BORROWED_IDENTITY`）；② `tree_log {action:"events"}` 工具面只回计数、done 事件 meta 不可机读（下游只能二手转述）。

---

## 1. 结论速览

| 断言 | 结果 | 证据 |
|---|---|---|
| flow 节点内 `tree_plan` 现场建树（补齐 v1 偏离 D1） | **PASS** | `t3c4-root.owner = 263d4c4e`（= flow 节点 `INNER` 会话 id）；tree-state |
| flow 节点自标识（`self_spec` + `$env:DSH_SESSION_ID`） | **PASS（双通道一致）** | INNER 输出 `self_id/session=self_spec_session=env_session_id=263d4c4e…`、`identity_consistent: true` |
| 深度链到 5（root 0 → … → 内层 worker 5） | **PASS** | 6 个会话 header：depth 1/2/3/4/5/6（§3 表）；`maxDepth` 口径见 §5 |
| flow 收口 + 完整性 | **PASS** | `flow_status T3C3-R1: succeeded · integrity=verified · perm=safe`；journal `run/ended` |
| 两树 validate | **PASS 0 issues ×2** | `tree_status validate t3c3/t3c4` |
| `relay=off`（跑 flow 的外层 leaf） | **PASS（设置/读回/恢复）** | 派发前 `relay=off` 读回；完成后恢复 `auto`；`segmentChain=[]`、`drift_history=[]` |
| 最深 worker 不再起正常子会话 | **PASS（纪律）**，但探针**意外成功** | worker done meta：`UNEXPECTED_SUCCESS`；见 §5 |
| 内层叶事后补 verify | **不可用（归属缺口）** | `E_BORROWED_IDENTITY: caller "session-" cannot write verification on leaf "t3c4-C2-commander" (allowed: creator\|root)` |

耗时：外层 C1 派发 13:45:45 → C1 done 13:52:31，**约 406s**；flow `T3C3-R1` 339.3s。

---

## 2. 结构与会话深度链（FACT）

| 层 | 角色 / 节点 | 会话 id（短） | `delegationDepth` | 父会话 | 创建时刻（本地 +8） |
|---|---|---|---|---|---|
| 0 | Lead 根会话 | `831faad8` | — | — | 会话级 |
| 1 | 外层树 `t3c3-C1-commander` | `e5af3372` | **1** | `session-831faad8` | 13:45:45 |
| 2 | 外层树 `t3c3-C1a1-worker`（跑 flow） | `5b1a8c4b` | **2** | `e5af3372` | 13:45:57 |
| 3 | flow 节点 `INNER`（一次性会话） | `263d4c4e` | **3** | `5b1a8c4b` | 13:46:09 |
| 4 | 内层树 `t3c4-C2-commander` | `aefdd3ef` | **4** | `263d4c4e` | 13:47:04 |
| 5 | 内层树 `t3c4-C2a1-worker`（最深层） | `3ed0f91d` | **5** | `aefdd3ef` | 13:47:17 |
| 6 | 深度探针子会话（**预期应被拒绝**） | `f351d7ee` | **6** | `3ed0f91d` | 13:48:13 |

深度来源：`~/.dsh/sessions/--D-Codes-dsh-tree-harness--/<id>/session.v4.jsonl.zstd` 首行 header（`delegationDepth` / `parentSession`），逐会话读取，非推断。
树内嵌套（`commander_max_depth=3`）：`t3c3` root→C1→C1a1、`t3c4` root→C2→C2a1，均 3 层，合规。

---

## 3. 时间线（本地 +8h）

| 时刻 | 事件 |
|---|---|
| 13:45:16 | Lead `tree_plan create t3c3`；13:45:2x 建 C1/C1a1（C1a1 `relay=off` 读回） |
| 13:45:45 | 派发 C1；13:45:57 C1 派发 C1a1 |
| 13:46:09 | C1a1 起 `flow_run T3C3-R1`；flow 节点 `INNER` spawn（`#9`），depth=3 |
| 13:46:50 | **`INNER` 现场 `tree_plan create t3c4`**（root owner=`263d4c4e`） |
| 13:47:04 / 13:47:17 | `INNER` 派发内层 commander（depth 4）→ commander 派发 worker（depth 5） |
| 13:48:13 | worker 发深度探针 `flow_run T3C3-DEPTHNEG-1`；**子会话 `f351d7ee` 被创建（depth 6）** |
| 13:48:24 | 探针 run `failed`：`E_OUTPUT_INVALID / TEXT_NOT_DECLARED`（**原因不是深度**） |
| 13:49:31 | 内层 worker done（平方和 385 + 探针原始记录） |
| 13:50:30 | 内层 commander done（转述探针结果） |
| 13:51:48 | flow `INNER` succeeded；`run/ended status=succeeded`（339.3s） |
| 13:52:09 / 13:52:31 | 外层 worker done / C1 done；两树 validate PASS |
| 13:53 | Lead 恢复 C1a1 `relay=auto`；外层两叶 verify PASS（self-report） |

---

## 4. 关键证据（双读）

### 4.1 tree 侧（FACT）

- `tree_status {action:"validate", tree_id:"t3c3"}` → **PASS (0 issues)**；`t3c4` → **PASS (0 issues)**。
- tree-state（`~/.dsh/profiles/desktop/tree-engine-data/`）：
  - `t3c3-root.session_id=831faad8`；C1 `succeeded`（attempt=1，`segmentChain=[]`，`drift_history=[]`）；C1a1 `succeeded`（同）。
  - **`t3c4-root.session_id=263d4c4e`（flow 节点会话）**——现场建树的直接证据；C2 `succeeded`；C2a1 `succeeded`（`relay=off`）。
- 内层 worker done meta（原文，来自 tree-state）：
  `probe_result: "UNEXPECTED_SUCCESS: status=failed, error=E_OUTPUT_INVALID: 节点 CHILD 输出抽取失败（stage=text, reason=TEXT_NOT_DECLARED）; CHILD [session] failed session=f351d7ee-… 11054ms —— 子会话已创建并运行，未出现预期的 subagent depth 6 exceeds maxDepth 5"`、`sum: 385`、`squares: 1^2=1; …; 10^2=100`。
- 内层 commander done meta：转述同上，`worker runtime=succeeded`。

### 4.2 flow 侧（FACT）

- `flow_status T3C3-R1` → `succeeded · integrity=verified · perm=safe · engine=flow-core@5a313fe9`；`INNER [session] succeeded session=263d4c4e`。
- journal（`D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\T3C3-R1.jsonl`，14 事件）`run/ended`：
  ```json
  {"status":"succeeded","outputs":null,"error":null,
   "stats":{"nodeExecutions":3,"retries":0,"durationMs":339285,"maxObservedConcurrency":1,"permTier":"safe"}}
  ```
- `INNER` 节点输出（原文摘录）：`INNER_RESULT: inner tree t3c4 was created live by this flow-node session…`、`self_id: 263d4c4e-…`、`identity_consistent: true`、`inner_tree_created_by: flownode-self`、`inner_tree_validate: 0 issues`。
- 探针 journal（`T3C3-DEPTHNEG-1.jsonl`，11 事件）：`node/spawned` `sessionId=f351d7ee-…`（**spawn 成功**）；`node/settled status=failed error.code=E_OUTPUT_INVALID`；`run/ended failed`。
- 说明：`flow_run` 返回的 `outputs={}`——`extract:"text"` 的节点输出写入 `varWrites.innerResult`（journal `__end` 可见），run 级 `outputs` 需 DSL 显式映射；与 v1 行为一致。

### 4.3 深度探针的会话证据（FACT）

- `~/.dsh/sessions/…/f351d7ee-…/session.v4.jsonl.zstd` 首行：`{"type":"session","id":"f351d7ee-…","parentSession":"3ed0f91d-…","origin":"subagent","delegationDepth":6,…}` —— **depth 6 会话真实存在**。

### 4.4 运行环境与日志（FACT）

- `tree_doctor {action:"run"}` → `7 checks · pass=7 warn=0 fail=0 · version=0.8.0`（试点后）。
- `apply.log` 本日（2026-11-13）**无** `E_DEPTH_EXCEEDED` / `SubagentDepthError` / `E_RUN_CANCELLED` / `sweep_error` / `inactive context` 新增行（现存同类行均为 2026-11-12 旧记录）。
- 本轮无 bamboo relay 触发（外层上下文远低于 42%），`segmentChain=[]`、`drift_history=[]` 与之一致。

---

## 5. 发现：`subagent.maxDepth=5` 在插件编程派发路径不生效（FACT + 根因）

**事实**：profile `cordis.patch.yml` 的 `dsh-subagent` 配置为 `maxDepth: 5`；但深度 5 会话再起子会话（→ depth 6）**成功**，未抛 `SubagentDepthError`。

**根因（asar 只读实证）**：

| 层 | 代码 | 行为 |
|---|---|---|
| 服务端 `startActivation` | `@deepseek-ai/dsh-subagent/lib/index.js:1402` `assertSubagentMaxDepth(spec.request.maxDepth)` | 只校验**调用方显式传入**的 `request.maxDepth`，缺省不设上限 |
| 服务端 `startContinuable` | 同文件 `:1405` `resolveChildDepth(parent, request.maxDepth)` | 同上（`maxDepth` 缺省 → `childDepth` 无上限） |
| 配置读取 | 同文件 `:3038-3045` `resolveMaxDepth(configured)` 注释："Resolve a delegation tool's depth policy against the current user setting" | 该方法**仅供工具层**使用；服务端方法不会自动读配置 |
| 模型工具 `subagent` | `@deepseek-ai/dsh-tool-subagent/lib/index.js:452-462`：`const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth)` 然后 `request = {…, maxDepth}` | **工具路径**才注入 `maxDepth` → 上限生效 |
| tree 派发（本仓） | `packages/dsh-tree-engine/index.js:134-140` 构造 `{provider,label,parent,promptText,agentOptions}`，**无 maxDepth** | 树派发不受 `maxDepth=5` 约束 |
| flow 节点会话 | `spike/dsh-flow-plugin/lib/session-executor.js:250-266` 构造 `request = {prompt,parent,cwd?,outputSchema?,agentOptions?}`，**无 maxDepth** | flow 节点会话同样不受约束 |

**结论（INFERENCE，边界清晰）**：`subagent.maxDepth` 是**模型工具 `subagent` 的委派策略**，不是跨插件的硬上限；任何插件直接调用 `ctx.subagents.startActivation/startContinuable` 时，深度预算需**自行传入** `request.maxDepth`。因此：
- v1/剧本 §3 的「`maxDepth=5` 是硬上限，第 5 层不能再起子会话（否则 `SubagentDepthError`）」表述**只在工具路径成立**，对 tree/flow 组合路径**不成立**（本试点实测 depth 6 成功创建）。
- 组合深度安全目前靠**纪律**（剧本 §3 的深度算术）而非平台强制。

**影响面**：tree→flow→tree 嵌套、flow→tree 嵌套、tree 内 verify/judge/handoff 的另起会话均在“无上限”侧；若编排失控可突破 24 并发预算之外的**深度**预期（并发预算 `maxActiveSubagents` 仍会兜住总量，但深度语义已变）。

**建议修复（2026-11-13 当晚：第 1、3 项已实施，第 2 项转需求单）**：
1. ~~tree-engine：`dispatch` 构造 request 时传 `maxDepth`~~ → **已实施（tree-engine v0.8.1）**：`DEFAULT_GUARDS.max_subagent_depth=5`（`TREE_ENGINE_CONFIG` 可覆盖，1–100 校验）、`dispatch:start`/竹节 relay/攻击审计会话均显式传 `request.maxDepth`、`src/compat.js` 新增 `buildStartRequest` 纯函数（`index.js startChildSession` 统一走它）；新增 `tests/depth-budget.test.js`（4 例）与 compat 3 例，全量 **172/172**。
2. flow 执行器（转 flow 项目组需求单）：`session-executor` 构造 request 时传 `maxDepth`（来源：flow 配置项，缺省 5）——**未实施，不得代改 flow 仓**；已写入 [REQ-2026-11-13](../operations/REQ-2026-11-13-flow-node-continuable-session.md) §9。
3. 文档：修正 playbook §3/§7 的“硬上限”表述（本轮已改）。

**修复后的行为边界（FACT/INFERENCE）**：tree 派发的子会话现在会带 `request.maxDepth=5`（或配置值）→ 从根深度 0 起最多到 depth 5；若在 flow 节点（如 depth 3）内建树再派发，到 depth 5 为止、再派发将以 `E_PORTS_PROTOCOL` fail-closed（宿主 `SubagentDepthError`）。**flow 节点 spawn 本身的深度仍不受 tree 修复影响**（属 flow 执行器，仍无上限），故 tree→flow→tree 组合里「最深 worker 再起 flow 节点」仍是未封口路径，直到 flow 侧修复。

---

## 5.1 修复落地与活体验证（2026-11-13 晚，tree-engine v0.8.1）

用户 2026-11-13 拍板「现在就修」。**代码**（`packages/dsh-tree-engine`，`0.8.0` → **`0.8.1`**）：

| 改动 | 位置 | 说明 |
|---|---|---|
| 新增配置 `max_subagent_depth`（缺省 **5**，1–100 校验） | `src/guards.js` / `src/config.js` | `TREE_ENGINE_CONFIG` 可覆盖；非法值装载期失败含键名；随 `audit_meta` 持久化 |
| 派发/接力 spec 携带 `maxDepth` | `src/engine.js`（`dispatch:start`、`bambooRelay`） | 接力不能绕过上限 |
| 请求体构造抽纯函数 `buildStartRequest` | `src/compat.js` | `maxDepth` 缺省不产生字段（旧宿主形状）；非法值 fail-closed |
| 子会话启动统一注入 | `index.js`（`startChildSession` / `subagentDepthCap` / `runAttackSession`） | apply 期解析配置，攻击审计会话同样受限 |

**测试**：新增 `tests/depth-budget.test.js`（4 例：缺省 5 / 配置覆盖 + `audit_meta` / 竹节 relay 携带 / 配置非法值拒绝）；`tests/compat.test.js` 11 → 14 例（`buildStartRequest` 三形态）。全量 `node --test tests/*.test.js` = **172/172**（20 个 `.test.js`）。

**活体验证（FACT）**：
- bundle `@local/dsh-tree-engine` **disable → enable**（`plugin_manager set_bundle`，`application=applied`）后：`tree_doctor` → **7/7 PASS · version=0.8.1**；`apply.log` 出现 `apply() entered (v0.8.1)`、`subagent depth cap: 5 (request.maxDepth injected on every child session start)`、`previous sweep disposed (hot-reload zombie)`、9/9 工具注册。
- **冒烟派发**：新建树 `dlv1` → dispatch `dlv1-C1-worker` → 子会话 `688f025e` `runtime=succeeded`，其会话 header `delegationDepth=1`、`parentSession=session-831faad8…`（root）；done meta `env_id` 与自报一致 → 注入 `maxDepth` 未破坏派发链路。
- 既有试点树 `t3c3` / `t3c4` 与 `dlv1` 在重载后 `tree_status validate` 均 **PASS (0 issues)**。

**未覆盖（诚实边界）**：① 深度 6 **拒绝**的真机回归未做——需要重建一条 depth 4→5 的链路再去 spawn depth 6（成本约一次三层试点）；当前证据 = 单测覆盖「dispatch/relay spec 携带 maxDepth」+「buildStartRequest 注入值」+ 宿主 asar 代码路径（`request.maxDepth` 超限即 `SubagentDepthError`）；② flow 节点 spawn 仍不受 tree 修复约束（属 flow 执行器，见 §5 第 2 项与 REQ §9）。

---

## 6. 次要发现

1. **现场建树的验证归属缺口（FACT）**：内层树 `t3c4` 的 creator/root = flow 节点会话 `263d4c4e`，节点结束后 dispose，Lead 事后 `tree_verify run` 被 `E_BORROWED_IDENTITY` 拒绝（allowed: creator|root）。→ 现场建树模式需要：a) flow 节点收口前自己 verify；b) 或 tree-engine 增加「验证授权委托」能力；c) 或接受 runtime+validate 作为验收口径（本轮采用 c，并在报告标注）。
2. **`tree_log {action:"events"}` 不可机读（FACT）**：返回仅 `tree_log: N entries`（计数），不含事件 meta；内层 commander 无法机读 worker 的 done meta，只能二手转述（其 done meta 已如实标注“不可机读”）。→ 工具面渲染改进候选（不阻塞）。
3. **`tree_status harvest` 输出为各树计数摘要**（本轮两树均显示 `∅` 直到事件落账），收割需配合 `tree_node get` / tree-state 双读（与 v1 一致）。

---

## 7. 与剧本 C 的对齐（相对 v1 的偏离已消除）

| # | 剧本 C 要求 | v1（t3cpilot） | v2（本轮） |
|---|---|---|---|
| D1 | 内层树由 flow 节点内 `tree_plan` 现场创建 | 偏离（Lead 预置） | **已消除**：`t3c4-root.owner=flow 节点会话` |
| D2 | 深度链到 5 | 深度 4 | **已达成**：depth 1..5 实证 |
| D3 | relay=off 抗打断 | 设置但 42% 未触发（ctx≈4.1%） | 同（外层 C1a1 上下文未到 42%，本试点不重复声称） |
| 新增 | maxDepth=5 边界（压测） | 未做 | **已做**：positively 到 5；depth 6 **未被拒绝**（发现 §5） |

---

## 8. FACT / INFERENCE / UNKNOWN

- **FACT**：flow 节点现场建 `t3c4` 成功（root owner=flow 会话）；自标识双通道一致；深度 1–5 链；depth 6 子会话被创建；flow succeeded/integrity=verified；两树 validate 0 issues、无 drift/chain；外层 verify 2/2 PASS（self-report）；内层 verify 不可写（归属）；`tree_log events` 不可机读。
- **INFERENCE**：`subagent.maxDepth` 仅为工具层策略（代码 + 行为双重证据）；tree/flow 组合的深度安全需插件自管。
- **UNKNOWN**：① 若 tree-engine 传入 `request.maxDepth=5`，flow 节点（depth 3）派发内层 commander（depth 4）仍可行、内层 worker（depth 5）可行，但 worker 的探针（depth 6）应被拒——待修复后回归验证；② 深度 6 会话被创建后是否在 `maxActiveSubagents` 预算外产生残留（本探针会话已 dispose，未见残留）；③ 内层树验证归属的通用解法（需设计）。

---

## 9. 复现步骤

1. 建外层树：`tree_plan create t3c3`（`session_id=<root 会话 id>`）→ `tree_node add t3c3-C1-commander`（parent=root，path=C1）→ `tree_node add t3c3-C1a1-worker`（parent=C1，path=C1a1，`relay:"off"`）→ 读回 relay。
2. 派发：`tree_dispatch start t3c3/t3c3-C1-commander`，prompt 指向 [commander1.prompt.md](../../demo/t3cpilot2/commander1.prompt.md)。
3. flow：`flow_run {runId:"T3C3-R1", flowPath:"<repo>/demo/t3cpilot2/flow.json", cwd:"<repo>"}`（由 C1a1 执行）。
4. flow 节点 `INNER` 按 [inner-node.prompt.md](../../demo/t3cpilot2/inner-node.prompt.md)：自标识 → `tree_plan create t3c4` → add C2/C2a1 → 派发 C2 → 轮询收口。
5. 深度探针：内层 worker（depth 5）按 [worker2.prompt.md](../../demo/t3cpilot2/worker2.prompt.md) 发一次 `flow_run T3C3-DEPTHNEG-1`（预期失败，实测未拒绝）并记录。
6. 验收：`tree_status validate` 两树、`flow_status T3C3-R1` + journal、tree-state、`~/.dsh/sessions` header 深度链；完成后恢复 `relay=auto`。
7. 清理/保留：树 `t3c3`（3 节点）、`t3c4`（3 节点）与 flow journal `T3C3-R1`/`T3C3-DEPTHNEG-1` **保留**作为证据（`tree_maintain gc` 未实现）。

## 10. 后续建议（按优先级）

1. ~~**tree-engine 深度预算修复**（候选 v0.8.1）~~ → **已完成（tree-engine v0.8.1，2026-11-13 晚）**：dispatch/竹节接力/攻击会话显式传 `request.maxDepth`（缺省 5，可配 `max_subagent_depth`）+ `buildStartRequest` 纯函数；单测 172/172（depth-cap 4 + compat 3）。活体验证需 reload 后 `tree_doctor` version=0.8.1；深度 6 拒绝的真机回归需另起一次含 depth-5 链的受控试点（本轮未重复烧会话）。
2. **flow 执行器同问题**：已写入跨仓需求单（见 [REQ-2026-11-13](../operations/REQ-2026-11-13-flow-node-continuable-session.md) §附），由 flow 项目组响应。
3. **现场建树验收归属**：设计 flow 节点收口前 verify 或「验证授权委托」。
4. 工具面可机读性：`tree_log events` 返回事件 meta（或 `tree_node get` 返回 events 摘要）。
5. 更新 [composition-playbook.md](../guides/composition-playbook.md) §3/§5/§6/§7/§9（本轮已更新）。
