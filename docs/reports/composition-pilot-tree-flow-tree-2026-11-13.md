# 三层组合受控试点：tree → flow → tree（2026-11-13）

> 性质：一次性证据报告（结论不回写）；剧本依据 [composition-playbook.md](../guides/composition-playbook.md) §5。试点配置与提示词已入仓：[demo/t3cpilot/](../../demo/t3cpilot/)。
> **结论先行：PASS（受控范围内）**。外层树 `t3c1` 的 commander 叶子在 `relay=off` 下同步跑完一条内联 flow（run `T3C1-R1`，`integrity=verified`），flow 节点在内层树 `t3c2` 中派发 commander → worker 并等待收口；内外两层树 `tree_status validate` 均 **0 issues**，四个会话深度链最大 **4 ≤ maxDepth 5**，全程无 `SubagentDepthError` / `E_RUN_CANCELLED` / bamboo drift。

---

## 1. 结论速览

| 断言 | 结果 | 证据 |
|---|---|---|
| 三层引擎真实组合（tree→flow→tree） | **PASS** | flow journal `T3C1-R1` 14 事件；内层树 `t3c2` 两个叶子 runtime 均 succeeded |
| 外层 leaf `relay=off` 已生效 | **PASS（设置/校验/恢复）** | `tree_node set-relay relay=off` → 返回 `relay=off`；派发前 get 读数 `relay=off`；完成后恢复 `auto`；`segmentChain=[]`、`drift_history=[]` |
| flow gate-free（R2） | **PASS** | DSL 无 `human_gate` 节点；`permTier=safe` |
| 深度（R4/R5） | **PASS** | 会话深度链 max=4（root 0 → C1 1 → flow 节点 2 → 内层 commander 3 → 内层 worker 4） |
| 双读证据（R7） | **PASS** | tree：`tree_status validate` ×2 + tree-state；flow：`flow_status` + journal `run/ended` |
| 最深层不带 verify/judge | **PASS** | 内层 worker（深度 4）只做 `tree_report done`，未起任何子会话 |

**未覆盖/边界（诚实口径）**：① `relay=off` 的 **42% 阈值抗打断**在本试点**未被实际压到**（外层 commander 实测上下文约 4.1%），该项安全性仍以 v0.8.0 E2E（315.4s 长 flow 穿越 ≥5 次 sweep 不中断）为据；② 内层树由 Lead **预置**、flow 节点只负责派发/等待（不是 flow 节点内 `tree_plan` 现场建树），原因见 §4；③ 深度只到 4，未压 maxDepth 边界。

---

## 2. 结构与会话深度链

| 层 | 角色 / 节点 | 会话 id（短） | 深度 | 父会话 | 时间（本地 2026-11-13） |
|---|---|---|---|---|---|
| 0 | Lead 根会话 | `612f0535` | 0 | — | 全程 |
| 1 | 外层树 `t3c1` commander `t3c1-C1-commander` | `3f021457` | 1 | `612f0535` | 01:29:53 派发 → 01:32:52 done |
| 2 | flow 节点 `INNER`（一次性会话） | `b71b9cb0` | 2 | `3f021457` | flow journal `node/spawned seq=9` |
| 3 | 内层树 `t3c2` commander `t3c2-C2-commander` | `f7ca5b4a` | 3 | `b71b9cb0` | 01:30:59 派发 → 01:32:03 done |
| 4 | 内层树 `t3c2` worker `t3c2-C2a1-worker` | `7bf6773a` | 4 | `f7ca5b4a` | 01:31:10 派发 → 01:31:29 done |

深度算术核对（playbook §3）：`maxDepth=5`；本链最深 4 ⇒ 余量 1。tree 内嵌套深度（`commander_max_depth=3`）：`t3c2-root` → commander（depth 2）→ worker（depth 3），合规。

---

## 3. 执行时间线（UTC；本地 +8h）

| 时刻（UTC） | 事件 |
|---|---|
| 17:29:24 | `tree_plan` 建 `t3c1`；17:29:32 建 `t3c2`（两树叶子由 Lead 预置，`added_by=612f0535`） |
| 17:29:53.418 | 派发 `t3c1-C1-commander`（`relay=off` 已在派发前设置并读回） |
| 17:29:53–17:32:13 | C1 同步执行 `flow_run`（flow `run/created` → `node/spawned INNER`） |
| 17:30:59.487 | flow 节点 `tree_dispatch` 派发内层 commander `t3c2-C2-commander` |
| 17:31:10.977 | 内层 commander 派发 worker `t3c2-C2a1-worker` |
| 17:31:29.002 | worker done（18.0s） |
| 17:32:03.174 | 内层 commander done（`tree_report done`，含 `worker_summary`） |
| 17:32:13 左右 | flow `INNER` 节点 settled（durationMs **139817**）；`run/ended status=succeeded` |
| 17:32:52.776 | C1 done（`tree_report done`，含 `flow_run_id=T3C1-R1`）；外层 leaf runtime=succeeded |

试点总耗时：**约 179 秒**（C1 派发 → C1 done）；flow 节点耗时 **139.8s**。

---

## 4. 关键证据（双读）

### 4.1 tree 侧（FACT）

- `tree_status {action:"validate", tree_id:"t3c1"}` → **PASS（0 issues）**；`t3c2` → **PASS（0 issues）**。
- 叶子终态（tree-state）：C1 `runtime.state=succeeded`、`attempt=1`、`segmentChain=[]`、`drift_history=[]`、`history=[pending → running(done event)]`；内层 commander / worker 同样 `succeeded`、`attempt=1`、无 drift。
- done 事件（原文）：
  - `t3c1-C1-commander`：`flow T3C1-R1 succeeded；内层结果 内层 commander 最终 runtime.state=succeeded，已拿到 worker 结果（1..10 平方表与 10 项平方和=385）`
  - `t3c2-C2-commander`：`worker 交付 1..10 平方表与 10 项平方和=385，runtime=succeeded`
  - `t3c2-C2a1-worker`：`10 项平方和=385；平方表已产出`
- 竹节：C1 `segmentChain=[]`、`drift_history=[]`，**无 bamboo relay**（符合 R1 预期；`relay=off` 已按要求在完成后恢复 `auto`）。

### 4.2 flow 侧（FACT）

- `flow_status {runId:"T3C1-R1"}` → `succeeded (t3c1-inner-tree-pilot, engine=flow-core@5a313fe9) integrity=verified perm=safe`；`INNER [session] succeeded session=b71b9cb0…`。
- journal（`D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\T3C1-R1.jsonl`）14 事件；`run/ended` payload：

```json
{"status":"succeeded","outputs":null,"error":null,
 "stats":{"nodeExecutions":3,"retries":0,"durationMs":139834,"maxObservedConcurrency":1,"permTier":"safe"}}
```

- `flow/created`：`flowId=t3c1-inner-tree-pilot`、`flowHash=sha256:9ae98dd4…`、`runCwd=D:\Codes\dsh-tree-harness`、`flowSource.kind=file`、`storage.root=D:\Codes\DSH动态流程引擎插件\.dsh-flow`（ADR-011：storage 根≠runCwd，已知边界）。
- `INNER` 节点输出（`extract:"text"`，摘录）：`INNER_RESULT: 内层 commander 最终 runtime.state=succeeded，已拿到 worker 结果… commander_runtime: succeeded / worker_runtime: succeeded`。

### 4.3 运行环境与日志（FACT）

- `tree_doctor {action:"run"}` → `7 checks · pass=7 warn=0 fail=0 · version=0.8.0`（试点前）。
- `apply.log` 今日（2026-11-12T17:00 重启后）**无** `E_DEPTH_EXCEEDED` / `SubagentDepthError` / `E_RUN_CANCELLED`；唯一相关行是 `17:31:02 tokenMeter.measure shape: {"pressure":{"contextWindow":1000000},"measurement":{…"totalTokens":41160…}}` → 外层 commander 上下文约 **4.1%**，故 42% 竹节阈值未被触发（见 §1 边界①）。
- flow 权限：`permTier=safe`、`callerOrigin=subagent`（gate-free，R2 合规）。

---

## 5. 与剧本 C 的偏离（记录，不粉饰）

| # | 剧本 C 要求 | 本试点实际 | 原因 / 影响 |
|---|---|---|---|
| D1 | 内层树由 **flow 节点内 `tree_plan`** 建 | 内层树由 Lead **预置**，flow 节点只派发/等待 | flow 节点是一次性会话，**无法可靠获知自身 session id**（`tree_node add` 的 `added_by` 必须 === caller；`self_spec` 的 `session=` 字段为空，只有 projcache 路径含 id）。列为改进项：tree-engine 支持"会话自标识"或 flow 节点注入 session id。 |
| D2 | 深度链到 5（tree commander → worker → flow → 内层 commander → 内层 worker） | 深度链到 **4**（外层 commander 直接跑 flow，未加外层 worker 层） | 受控试点优先降风险；三层引擎组合语义已完整覆盖，深度余量 1 记录在案。 |
| D3 | R1 relay=off 抗打断 | 设置了 off 且无 drift/chain，但 42% 未触发 | 外层 commander 实测上下文 4.1%；抗打断能力引用 v0.8.0 E2E 报告，本试点不重复声称。 |

**非目标**：本试点不验证 `E_DEPTH_EXCEEDED` 失败路径、不做 5 层压测、不覆盖 sibling handoff。

---

## 6. FACT / INFERENCE / UNKNOWN

- **FACT**：三层引擎真实跑通；内层树 2 叶子 succeeded；flow integrity=verified；两树 validate 0 issues；深度 max=4；无 depth/cancel 错误；elapsed ~179s；flow 节点 139.8s。
- **INFERENCE**：组合可复现性较高（同一配置可从 `demo/t3cpilot/` 原样重跑）；一次性 flow 节点内调用 tree 工具链无权限/端口障碍（本深度下）。
- **UNKNOWN**：① flow 节点内 `tree_plan` 建树的确切可行姿势（session id 获取）；② 深度 5 边界下内层 worker 的行为（本轮未压）；③ relay 42% 触发在真实长 flow 内的组合影响（需 v0.8.0 报告条件重跑）；④ `flow_status` 对运行中 run 的 `interrupted/unfinalized` 读侧语义（本轮运行中读数即为 interrupted，最终以 journal 为准，复现了已知边界）。

---

## 7. 复现步骤

1. 预置：`tree_plan create t3c1`（root brief/dod）→ `tree_node add t3c1-C1-commander`（role=commander，`added_by=<root session uuid>`）→ `tree_node set-relay t3c1/t3c1-C1-commander relay=off`。
2. 预置内层：`tree_plan create t3c2` → add `t3c2-C2-commander`（parent=root）→ add `t3c2-C2a1-worker`（parent=commander）。
3. 派发 C1：`tree_dispatch start t3c1/t3c1-C1-commander`，prompt 要求 `flow_run {runId:"T3C1-R1", flowPath:"<repo>/demo/t3cpilot/flow.json", cwd:"<repo>"}`，成功后 `tree_report done`（含 `flow_run_id` / `inner_result`）。
4. 观察与收割：`tree_status harvest` / `tree_node get` 轮询到 C1 `runtime.state=succeeded`；随后 `tree_status validate` 两树、`flow_status T3C1-R1`、读 journal。
5. 恢复：`tree_node set-relay ... relay=auto`。

试点文件：[flow.json](../../demo/t3cpilot/flow.json)、[inner-node.prompt.md](../../demo/t3cpilot/inner-node.prompt.md)、[commander.prompt.md](../../demo/t3cpilot/commander.prompt.md)、[worker.prompt.md](../../demo/t3cpilot/worker.prompt.md)。

---

## 8. 保留物与清理

- 树 `t3c1`（2 节点）、`t3c2`（3 节点）保留在 `tree-engine-data/` 作为证据；如需清理先 `tree_maintain backup`（`gc` 未实现，见交接 §7.11）。
- flow run `T3C1-R1` journal 保留在 flow 引擎 storage（`D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\T3C1-R1.jsonl`）。
