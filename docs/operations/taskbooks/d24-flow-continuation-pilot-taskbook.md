# 任务书 · D24-flow 续接受控试点（tree→flow `flow_send` 冷恢复；**待执行**）

> **性质**：试点任务书（执行单）。**当前状态 = 待执行（NOT RUN）**——前置门禁未满足前**不得执行**。
> 前置门禁（②③ 任一缺失即 STOP，不得跳步）：
> ① flow 仓 M1.2 **代码已提交且离线全绿**（2026-11-13 19:0x 已满足：HEAD `13776bc`，kernel 287/287 · plugin 175/175 · qa-gate PASS）；
> ② flow 侧 **T-6 真机 E2E PASS**（`flow_send` 冷恢复 + 深度拒绝负例；flow 仓 `evidence/m1/T-m1.2/` 应新增真机证据，且 flow 仓 HANDOFF 放弃「未执行前不得写真机 PASS」的悬置）——**截至本任务书写就时尚未满足**；
> ③ 用户给出**试点时间窗**并确认可重载/联调；④ 本仓 `tree_doctor` 7/7、`git status` clean。
> 任务作者：`D24-FLOW-M12-PILOT` · 2026-11-13 · 依据：flow 回执 §3 口径 + 本仓 [REQ §附 F](../REQ-2026-11-13-flow-node-continuable-session.md) + [composition-playbook.md](../../guides/composition-playbook.md) §6。

---

## 0. 一句话

用 **tree→flow** 受控试点验证回执 §3「可依赖」三条：① 节点 `sessionId` 对父会话可见且 `node/spawned` 在 journal；② **调用方必须是发起 `flow_run` 的会话本身**（本试点 = tree worker），`flow_send` 冷恢复该节点会话并回读续接轮输出；③ 深度上限封口（链 ≤5，无 depth-6 会话）。同时验证「不可依赖」四条：不写 journal/不改 run 终态、续接轮无结构化 schema、`flow_resume` 仍不续接、父会话必须存活。

## 1. 边界（硬约束）

- **不改 flow 仓任何代码/配置**（用户 2026-11-13 明确）；只读其 journal/证据。
- 不新增/修改 flow 插件；不重载宿主除非用户在场并明确同意（本试点不需要重载即应可跑）。
- 试点树 `d24fl` 全部 leaf `relay:"off"`（等待外部编排前必须关竹节，playbook R1）；深度链 ≤5。
- 失败最多重试 1 次；不刷 run；不清理运行证据（journal、会话日志、树状态保留）。
- 中文报告；结论先行；FACT / INFERENCE / UNKNOWN 标注；不写「真机 PASS」以外的形容词上浮。

## 2. 执行结构（会话与深度）

```text
Lead/root 会话（depth 0，发起 tree_plan；不直接调 flow_send）
└─ d24fl-C1-commander（depth 1，tree_dispatch；relay=off）
   └─ d24fl-C1a1-worker（depth 2，tree_dispatch；relay=off）   ← 试点关键调用方
      └─ flow T-m1.2 节点会话 n1（depth 3，flow 执行器 spawn）  ← flow_send 目标
```

- `flow_run` 必须由 **`d24fl-C1a1-worker` 会话本身**调用（回执 §3 硬限制：调用方 = 发起 run 的会话；跨会话/sibling/root 代发不在支持面）。
- 目标节点：复用 flow 夹具 `D:\Codes\DSH动态流程引擎插件\evidence\m1\T-m1.2\fixtures\m12-continuable-e2e.flow.json`（n1→n2，两个 session 节点；n1 首轮输出 `{"first":"m12-ready"}`）。**先用 flow 仓 compile 语义确认该夹具可编译**（若夹具需 `start/end`，以 flow 方说明为准，不自行改夹具）。
- 深度核对：读 `%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\<sid>\session.v4.jsonl.zstd` 的 `session` 事件 `delegationDepth`（1..3）与 `parentSession` 链；确认**无 depth-6 会话**。

## 3. 步骤（含命令/工具调用序列）

### 3.1 预检（任一 FAIL → STOP 并如实记录）

1. flow 侧真机门禁：确认 flow 仓 HEAD、`evidence/m1/T-m1.2/` 出现 **T-6 真机**证据（`flow_send` 真机通过 + 深度拒绝负例）；若只有离线证据 → STOP（写 `BLOCKED: T-6 not closed`）。
2. 本仓：`tree_doctor {action:"run"}`（7/7）、`git status --short`（clean）、`node --test tests/*.test.js`（基线 **225/225**，低于基线 → STOP）。
3. 用户确认试点时间窗与「可以起 2 个子会话/1 个 flow run」的成本授权。

### 3.2 建树（Lead 会话）

```text
tree_plan   {action:"create", tree_id:"d24fl", session_id:"<Lead 会话 id>",
             root_brief:{goal:"受控试点：tree→flow flow_send 冷恢复续接", context:"..."},
             root_dod:{dod:"worker 以自身会话发起 flow_run 并对 n1 会话 flow_send 成功；journal/终态双读一致；树 validate 0 issues；报告落 docs/reports/"}}
tree_node   {action:"add", tree_id:"d24fl", leaf_id:"d24fl-C1-commander", parent:"d24fl-root", path:"C1", role:"commander", added_by:"<Lead 会话 id>", relay:"off"}
tree_node   {action:"add", tree_id:"d24fl", leaf_id:"d24fl-C1a1-worker", parent:"d24fl-C1-commander", path:"C1a1", role:"worker", added_by:"<Lead 会话 id>", relay:"off"}
tree_status {action:"validate", tree_id:"d24fl"}      # 期望 0 issues
```

### 3.3 派发（commander → worker；任务书 = 本文件第 4 节）

```text
tree_dispatch {action:"start", tree_id:"d24fl", leaf_id:"d24fl-C1-commander",
               prompt:"<commander 任务书：见 §4.1>"}
```

### 3.4 试点关键序列（由 worker 执行；commander 只轮询/收口）

1. `flow_run {runId:"D24FL-R1", flowPath:"<flow 仓>/evidence/m1/T-m1.2/fixtures/m12-continuable-e2e.flow.json", cwd:"D:\\Codes\\dsh-tree-harness"}` → 记录首行（succeeded/integrity）。
2. **双读基线**（发送前）：`flow_status {runId:"D24FL-R1"}` 记录 run 终态/事件数；读 journal 文件字节长度 + `sha256`（只读，headless 对比用）。
3. 从 journal 找 n1 的 `node/spawned.payload.sessionId`（`flow_status`/journal 均可；`flow_send` 内部会从 journal 解析，调用方无需自传 sessionId）。
4. `flow_send {runId:"D24FL-R1", nodeId:"n1", message:"只输出一行 JSON：{\"continued\":true}", waitMs:120000}` → 记录返回（`sessionId/messageId/stopReason/output`）与渲染首行。
5. **双读复核**（发送后）：`flow_status` 与 journal 字节/sha256 对比 → **必须与基线一致**（不写 journal/不改终态）。
6. 负例（时间允许）：让 **commander 会话**（非直接父）对同一 n1 调 `flow_send` → 期望 `E_PERM_DENIED`（跨会话代发被拒）。若 commander 不是目标子会话的 parentSession，则该负例天然成立。
7. `tree_report {action:"event", type:"done", meta:{summary:"...", flow_send_output:"...", journal_unchanged:"true", double_read:"..."}}`。

### 3.5 收口（Lead 会话）

```text
tree_status {action:"harvest", tree_id:"d24fl"}
tree_status {action:"validate",  tree_id:"d24fl"}      # 期望 0 issues
flow_status {runId:"D24FL-R1"}                          # 期望 succeeded / integrity=verified
```

## 4. 派发任务书正文（供 tree_dispatch prompt 内联）

### 4.1 commander（`d24fl-C1-commander`）

你是任务树 `d24fl` 的 commander。只做三件事：
1. 读取本任务书 `D:\Codes\dsh-tree-harness\docs\operations\taskbooks\d24-flow-continuation-pilot-taskbook.md`（只读）。
2. `tree_dispatch {action:"start", tree_id:"d24fl", leaf_id:"d24fl-C1a1-worker", prompt:"<§4.2 worker 任务书全文>"}`。
3. 轮询 worker leaf 的 `done` 事件（`tree_log {action:"events", leaf_id:"d24fl-C1a1-worker", type:"done", n:3}`）→ 把 worker done meta 关键字段（flow_send 输出、journal_unchanged、双读结果）转述进自己的 `tree_report done`。**禁止调用 flow_send**（验证跨会话代发被拒的负例可由你尝试一次并记录错误码）。

### 4.2 worker（`d24fl-C1a1-worker`）

你是任务树 `d24fl` 的 worker，本试点关键调用方。严格按本任务书 §3.4 执行：
- 用 **你自己的会话** 调 `flow_run`（runId `D24FL-R1`，夹具路径见 §3.4；cwd = `D:\Codes\dsh-tree-harness`）。
- 完成「发送前双读基线 → `flow_send` → 发送后双读复核」三步；journal 基线/复核用只读文件读取（`pwsh` 读取 `%USERPROFILE%\...` 不作数——flow journal 在 `<cwd>\.dsh-flow\runs\D24FL-R1.jsonl`，以实际路径为准）。
- 记录 flow_send 渲染首行原文与返回 JSON（`sessionId/messageId/stopReason/output`）。
- 若 `flow_send` 返回错误码：**不要重试超过 1 次**，把错误码原文写进 done meta 并 `tree_report done`（如实失败优于伪报）。
- 完成：`tree_report {action:"event", tree_id:"d24fl", leaf_id:"d24fl-C1a1-worker", type:"done", meta:{summary, flow_send:"...", journal_unchanged:"true|false", double_read:"...", depth_chain:"1→2→3"}}`。

## 5. 验收标准（双读；缺一即不通过）

| # | 判据 | 证据 |
|---|---|---|
| A1 | `flow_run` succeeded 且 `integrity=verified`（首轮） | `flow_status D24FL-R1` 首行 + journal hash 链 |
| A2 | `flow_send` 返回 `stopReason=completed` 且 `output` 含续接轮预期文本 | 工具返回 JSON + 渲染首行原文 |
| A3 | **发送前后 journal 字节数与 sha256 完全一致**（不写 journal） | 两次只读读数的 hexdigest 对比 |
| A4 | `flow_status` 发送前后 run 终态/事件数不变（不改 run 终态） | 两次快照对比 |
| A5 | 目标会话 `header.parentSession` = worker 会话（血缘正确） | 会话日志 `session` 事件 |
| A6 | 跨会话代发被拒（负例，时间允许）：`E_PERM_DENIED` | 工具返回原文 |
| A7 | 树 `validate` 0 issues；`tree_doctor` 7/7 | 工具返回 |
| A8 | 深度链 ≤5 且无 depth-6 会话（`delegationDepth` 逐会话核对） | 会话日志扫描结果 |
| A9 | 试点报告落 `docs/reports/` + playbook §6/§9 与 REQ §附「试点结论」更新 | git 提交 |

## 6. 失败模式与回滚

| 失败 | 处置 |
|---|---|
| flow_send `E_PERM_DENIED` | 先核对调用方是否就是 `flow_run` 的发起会话（本试点应为 worker 自己）；若是则属 flow 实现与回执不符 → 记入试点报告「口径出入」并 STOP 上报 |
| flow_send `E_SESSION_BUSY` | 目标会话仍 live（flow 节点未结束）→ 等节点 settle 后重试 1 次；仍失败则记为边界 |
| flow_send `E_CONTINUE_TIMEOUT` | 记录 `messageId{delivered:true}`；不重试超过 1 次 |
| journal 双读不一致 | **试点 FAIL**（违反「不写 journal」口径）→ 保留现场、上报 flow 项目组 |
| 宿主/插件异常（unknown tool） | 按 D24 平台 issue 口径处理（重试一次；不把平台竞态当作试点失败） |
| 试点失败 | 树保留为证据；Lead 会话 `tree_status harvest` 后按需 `tree_node set-status pruned`（root/creator 权限），journal 永久保留 |

## 7. 报告要求（试点执行后）

1. 报告路径：`docs/reports/composition-pilot-v4-flow-continuation-<日期>.md`（命名随执行日）。
2. 必含：结论先行（PASS/FAIL/PASS_WITH_RESIDUAL）、A1–A9 逐条证据、原始输出摘录、FACT/INFERENCE/UNKNOWN、`flow_send` 与回执 §3 的出入（若有）。
3. 同步更新：`docs/guides/composition-playbook.md` §6/§9（试点结论与可依赖边界）、[REQ §附](../REQ-2026-11-13-flow-node-continuable-session.md) 新增「试点结论」、CHANGELOG/agent.md/进度地图。
4. 不得写「flow 节点可续接 = 已支持」类上浮表述——限定为「同进程父会话存活期间的冷恢复续接；不写 journal；续接轮无结构化 schema」。

## 8. FACT / INFERENCE / UNKNOWN（任务书本身）

- **FACT**：flow M1.2 离线交付已提交（`2918fba`/`13776bc`，kernel 287 · plugin 175）；T-1/T-6 真机未执行；回执 §3 与实现核对 8 条一致（见 REQ §附 F）。
- **INFERENCE**：flow_send 的真机行为应与离线 T-4 证据一致（工具层授权 + 冷恢复 + 输出抽取）；试点用于验证这一点。
- **UNKNOWN**：flow 夹具 `m12-continuable-e2e.flow.json` 是否需显式 `start/end` 节点（真实编译语义以 flow 方为准）；`flow_send` 真机冷恢复对 `waitMs` 的实际时延分布；T-6 真机是否覆盖多轮续接（回执只说「续接」）。
