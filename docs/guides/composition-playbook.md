# 组合编排剧本（tree ↔ flow，2026-11-12 正式版）

> 适用基线：**tree-engine v0.8.0**、**session-tree v1.4.0**（Q4 起 `tree_send` 仅同树）、自由流程引擎 M1、DSH `0.2.2-rc.1`、profile `desktop`。
> 本文件是**执行剧本**（怎么排、怎么验、怎么止损）；评估与设计依据见 [composable-orchestration.md](../architecture/composable-orchestration.md)，实测证据见 [S1 报告](../reports/e2e-composition-relay-2026-11-12.md) 与 [v0.8.0 报告](../reports/e2e-relay-switch-2026-11-12.md)。
> 平台参数（2026-11-12 实测）：`subagent.maxDepth=5`（用户已调大；原 4）· tree-engine `commander_max_depth=3`（树的叶子嵌套层数，保持 3）· `maxActiveSubagents` 运行中 20，profile 文件已按用户授权调到 **24（重启 DSH 后生效）**。

---

## 0. 一句话

**tree 负责分层组织与验收，flow 负责确定性流水线；谁在叶子会话里等外部编排，谁就必须先关竹节（`set-relay off`）——否则上下文到 42% 时 tree 会打断正在跑的 flow（S1 已实证 `E_RUN_CANCELLED`）。**

---

## 1. 硬规则（全部必须，违反必出事故）

| # | 规则 | 原因 / 证据 |
|---|---|---|
| R1 | **leaf 在调用 `flow_run` / `tree_verify` / 长命令前，由 creator 或 root 执行 `tree_node {action:"set-relay", relay:"off"}`；完成/失败后恢复 `auto`。** | v0.8.0 起 `off` 时 sweep 只跳过竹节（不 interrupt/不改 runtime）；S1 实测 relay 会取消 flow；v0.8.0 E2E：`relay=off` 长 flow 315.4s 穿越 ≥5 次 sweep 不中断 |
| R2 | **flow 必须 gate-free**（不把 `human_gate` 放进 tree leaf 内运行的 flow）。 | flow 节点是一次性子会话，审批只能是 root+ask；子会话内 gate 必失败（E3/S1 结论） |
| R3 | **flow runId 每次唯一**；successor 重跑同一 runId 会 `E_RUN_EXISTS`。 | v0.8.0 E2E 复现；flow 结果不可复用 |
| R4 | **每次内层引擎启动前检查"剩余会话深度"**（见 §3 深度算术）；任何会另起会话的 `tree_verify`/judge/handoff 都算 +1。 | profile `maxDepth=5` 是硬上限（超限 `SubagentDepthError`） |
| R5 | **树的叶子嵌套不超过 `commander_max_depth=3`**（root leaf → commander → worker）。 | tree-engine 配置默认 3（`src/guards.js:61`，`src/engine.js:107-109` 校验）；用户指示保持 3 |
| R6 | **`tree_send` 仅同树**（v1.4.0 起禁止跨树、移除 `parent` 入参）；跨树通信改用共享文件/仓库/流程产物，不用会话消息。 | 用户 2026-11-12 决策（Q4）；安全面见评估 §8 |
| R7 | **每层证据双读**：tree 侧看 `tree_status harvest` + `tree-state`（segmentChain/drift）；flow 侧看 `flow_status` + journal（`run/ended`）。不接受单侧"看起来成功"。 | 组合事故大多来自"结果交付丢失"（S1 结论） |
| R8 | **预算前置**：并发会话数、成本、deadline 在派发前写清；超限先止损（cancel/handoff），不允许静默越过。 | 平台无预算原语；tree/flow 只做局部护栏 |

---

## 2. 剧本 A：tree → flow（两层，近期默认，先验收这个）

**适用**：一个 commander leaf 内跑一条确定性流水线（审查、批处理、多步生成），产出回收到 tree。

1. **建树**：`tree_plan {action:"create", tree_id, root_brief, root_dod, session_id: <root 会话 id>}`。
2. **建 leaf**：`tree_node {action:"add", leaf_id:"<tree>-C1-flow", parent:"<tree>-root", path:"C1", role:"commander", added_by:<creator>, taskType:"default"}`。
3. **关竹节（关键）**：`tree_node {action:"set-relay", tree_id, leaf_id:"<tree>-C1-flow", relay:"off"}`（creator/root 可设；owner 自关会被 `E_BORROWED_IDENTITY` 拒）。
4. **派发**：`tree_dispatch {action:"start", tree_id, leaf_id, prompt}`；prompt 写清：
   - 第一步 `flow_run`（**inline `flow` 参数**，gate-free；注意 `flowPath` 受 runCwd 围栏）；
   - 禁止在 leaf 内再建树/再派发（保持两层；要做三层见剧本 C）；
   - flow 结束后 `tree_report {action:"event", type:"done", meta:{summary, flow_run_id}}` 结算。
5. **收割/验证**：`tree_status {action:"harvest"}` → `tree_verify {action:"run", ...}`（taskType 自动路由）→ 需要时 `tree_status {action:"validate"}`。
6. **恢复竹节**：完成后 `set-relay auto`（若该 leaf 还要继续接活）。
7. **验收证据**：flow journal `run/ended status=succeeded`；tree `runtime.state=succeeded`、`segmentChain=[]`、drift 无 bamboo；`tree_doctor` 7/7、`tree_status validate` 0 issues。

---

## 3. 深度算术（maxDepth=5；root=0）

| 结构 | 会话深度链 | 结论 |
|---|---|---|
| tree 单层（树内 3 层叶子） | root 0 → commander 1 → worker 2 | ✅ 富余 3 层 |
| tree→flow（剧本 A） | root 0 → commander 1 → flow 节点 2 | ✅ 富余 3 层 |
| flow→tree（剧本 B） | root 0 → flow 节点 1 → tree root leaf 1（同会话）→ tree commander 2 → worker 3 | ✅ 富余 2 层 |
| tree→flow→tree（剧本 C） | root 0 → tree commander 1 → worker 2 → flow 节点 3 → 内层 tree commander 4 → 内层 worker 5 | ⚠️ 最深层 worker 已到 5；它**不能再起任何子会话**（verify judge/handoff 另起会话即 6 ✗） |
| 剧本 C + 上游 verify | 外层 commander 1 → judge 2 | ✅（只要 judge 不在最深 worker 下） |
| 任意第 4 层引擎 | …→ 5 → 子会话 6 | ❌ `SubagentDepthError` |

**结论**：`maxDepth=5` 让 **三层 tree→flow→tree 理论可达**（本会话实测上限；尚未真机验收），但**最深层不能带 verify/judge**；近期仍以剧本 A（两层）为默认验收，剧本 C 只做受控试点并记录证据。

---

## 4. 剧本 B：flow → tree（两层）

**适用**：用 flow 编排"检查/生成"步骤，其中某节点的子会话再开一棵小树执行分派。

1. flow 节点 prompt：`tree_plan` 建树 → `add` 1–2 个 leaf（**depth 预算：flow 节点本身 depth1，树最多 2 层叶子，总深度 ≤5**）→ `tree_dispatch` → 等 done → 把结果写回节点输出。
2. 节点内同样遵守 R1：**树 leaf 若要等 flow/verify，先 set-relay off**（tree_send 仅同树）。
3. 由于 flow 节点是**一次性子会话**，节点内不能靠"多轮追问"补信息——所有上下文必须一次给全；若确需多轮/续接，见 §6。
4. 验收：flow journal 节点 settled/succeeded；内层树 validate；两次证据都贴报告。

---

## 5. 剧本 C：tree → flow → tree（三层，受控试点）

**前置（缺一不可）**：R1–R8 全部满足；`maxDepth=5` 已生效；外层 tree 用 commander_max_depth=3；flow gate-free；**最深层不再起任何子会话**。

1. 外层 tree leaf 先 `set-relay off`（它要跑 flow，且 flow 内还要开内层树）。
2. 派发 prompt：`flow_run`（inline flow；节点内 `tree_plan` 建内层树 + 派发 + 等 done）→ 输出回收到 flow → 外层 leaf `tree_report done`。
3. 内层树 leaf 若也要等外部编排，继续 `set-relay off`（逐层显式关闭）。
4. 验收除 R7 双读外，额外核对：`tree_status validate` 内外两层均 0 issues；depth 无 `SubagentDepthError`；`tree_doctor` 7/7。
5. **止损**：任何一层出现 `SubagentDepthError` / `E_RUN_CANCELLED` / `E_DEPTH_EXCEEDED`，立即停三层、回退剧本 A；把深度链与失败点写进报告。

---

## 6. 一次性会话 → 非一次性会话（用户 2026-11-12 指示的兼容方向）

- **现状**：flow 节点是**一次性子会话**（`delivery:'caller'`，节点结束即 dispose）；tree leaf 是**可续接会话**（`continuable`，支持竹节/report 多轮）。一次性限制来自 flow 引擎实现，而非平台强制。
- **用户允许**：如果 flow/tree 节点收到"一次性会话限制"，可以改为**非一次性会话**。
- **当前落地方式**：
  - flow 节点若需要多轮：暂用"一次给全上下文 + 单轮产出"；把"flow 节点可选 `sessionMode:'continuable'`"列为 flow-engine 变更项（需改 `lib/session-executor.js` 的 dispatch/dispose 语义，改后要重测 journal/锁/取消）。
  - tree leaf 天然 continuable，无需改；若某 leaf 被一次性语义卡住，优先检查是否 flow 节点内再套 tree（三层），改用剧本 B/A 或把 leaf 提出来。
- **禁止**：在没有 flow-engine 改动 + 真机复测前，假设节点可以多轮/续接。

---

## 7. 预算与并发

| 项 | 当前值 | 剧本科普 |
|---|---|---|
| `subagent.maxDepth` | **5**（用户已调） | 深度算术见 §3；三层试点不要带 verify/judge 在深层 |
| tree `commander_max_depth` | **3**（保持） | 单棵树内 root→commander→worker；再深需改配置（用户未授权） |
| `maxActiveSubagents` | **20（运行中）→ 24（profile 已改，待重启生效）** | 用户授权"小幅调大"；profile `subagent.maxActiveSubagents` 已从 20 调到 24（备份 `cordis.patch.yml.bak-20261112-budget`）；**重启 DSH 后**按 24 计；剧本 C 并发峰值要预留 |
| tree 预算 | `max_sessions` / `max_nodes` 等局部护栏 | 派发前算清；接力会新增会话（W2.1 已计入预算） |
| 成本/deadline | 无平台原语 | 每层写 deadline + 失败预算；到达即 cancel，不留悬挂 |

---

## 8. 验证清单（每次组合跑完必须贴）

- [ ] tree：`tree_doctor {action:"run"}` 7/7 PASS、version=0.8.0；`tree_status {action:"validate", tree_id}` 0 issues。
- [ ] tree：`tree_status {action:"harvest"}` 返回该树事件；`tree-state` 的 `runtime.state`、`segmentChain`、`drift_history` 已截图/引用。
- [ ] flow：`flow_status` + journal `run/ended`（status / durationMs / nodeExecutions）；节点失败要带 `error.code`。
- [ ] relay：leaf `relay=off` 的证据（call-log / tree-state）；若出现 bamboo drift 即视为剧本失败。
- [ ] 日志：apply.log 无新增 `inactive context` / `sweep_error`；`tokenMeter.measure shape:` 按需记录。
- [ ] 结论按 `FACT / INFERENCE / UNKNOWN` 标注，不把"看起来成功"写成成功。

---

## 9. 已知边界与止损

1. **旧 v0.7.0 sweep 僵尸**：升级 v0.8.0 后如果没重启 DSH，旧 interval 会在 inactive context 空转；重启即清（本次已重启实测干净）。
2. **`E_RUN_EXISTS`**：successor 复用 runId → 换新 runId（R3）。
3. **`flow_status` 读侧**：被 relay 中断的 run 可能显示 `interrupted/unfinalized`，最终以 journal 为准（R7）。
4. **`leaf.status` vs `runtime.state` 脱节**：观察者看 `runtime.state`，不要拿 leaf.status 下结论。
5. **tree_send 跨树**：v1.4.0 起直接拒绝；不要写跨树消息剧本（R6）。
6. **评审/审批**：子会话 approval 固定 `never`；需要人类批准的节点只能放 root/TurnOpen 会话（R2 相关）。

---

## 10. 参考

- [组合式编排评估](../architecture/composable-orchestration.md)（约束、RACI、决策记录）
- [S1 真机 E2E](../reports/e2e-composition-relay-2026-11-12.md)（relay 打断 flow 的首证）
- [v0.8.0 relay 开关 E2E](../reports/e2e-relay-switch-2026-11-12.md)（off 生效 / auto 回归 / 权限 / sweep）
- [engine-spec v0.8.0 修订](../architecture/engine-spec.md)（relay/usagePct/sweep 行为）
- [分层解说（归档）](../architecture/composition-layers-explainer.md)（层数 vs 会话深度、角色问答）
