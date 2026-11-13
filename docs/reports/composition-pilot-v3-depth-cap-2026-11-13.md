# 受控试点 v3：tree-engine v0.8.1 深度上限真机回归（depth 6 应被拒绝）

> 性质：一次性证据报告（结论不回写）。试点配置入仓：[demo/t3cpilot3/](../../demo/t3cpilot3/)。
> 承接 [试点 v2](composition-pilot-v2-live-create-2026-11-13.md) §5/§5.1：v2 实测「depth 5 再起子会话 → depth 6 未被拒绝」，v0.8.1 修复了 tree 派发路径的 `request.maxDepth` 注入，但**深度 6 拒绝的真机回归当时未做**（v2 报告 §10 第 1 条列为待办）。本试点补上该回归。
> 用户 2026-11-13 指示：任务 1 = v0.8.1 深度上限真机回归（depth 6 应被拒）。

---

## 0. 结论先行（三句）

1. **PASS**：depth 5 的内层 worker 用 `tree_plan` 现场建探针树 `t3c9` + `tree_dispatch` 派发，被宿主**拒绝**——工具返回 `E_PORTS_PROTOCOL: ports.dispatch failed: subagent depth 6 exceeds maxDepth 5`（原文，见 §4.3）；**没有 depth-6 会话被创建**（探针 leaf 的 `session_id` 为空、无子会话目录，见 §4.2/§4.4）。
2. **主链完整**：外层树 `t3c7` → flow `T3C7-R1` → 内层树 `t3c8` 现场建树，深度链 **1→2→3→4→5** 由 5 个会话 header `delegationDepth` 逐条实证；flow `T3C7-R1` **succeeded / integrity=verified**（150.3s）；`t3c7`/`t3c8`/`t3c9` 三树 `validate` **PASS (0 issues)**。
3. **边界（诚实）**：本回归只封 tree 派发路径；**flow 执行器仍未传 `maxDepth`**（`flow_run` 起 flow 节点仍不受上限约束，属跨仓需求单 REQ-2026-11-13）。本轮另有两个新发现（宿主 HMR 重载竞态导致工具面瞬态缺失；tree 派发 `assignee` 跨模型时宿主按调用方 `maxTokens` 下发导致小上限供应商 400），见 §6。

---

## 1. 验收速览

| 断言 | 结果 | 证据 |
|---|---|---|
| depth-5 worker 的 tree 派发被拒 | **PASS** | worker done meta `probe_result` 原文（§4.3） |
| 无 depth-6 会话被创建 | **PASS** | `t3c9-P1-probe.session_id=undefined`、`status=pending_brief`；工作区 234 会话中 depth≥6 仅 D22 旧会话 `f351d7ee`（2026-11-13 13:48，父 `3ed0f91d`） |
| 主链 flow 收口 + 完整性 | **PASS** | `flow_status T3C7-R1: succeeded · integrity=verified · perm=safe`；journal `run/ended` |
| 深度链 1..5 | **PASS** | 5 个会话 header：depth 1/2/3/4/5（§2） |
| 三树 validate | **PASS 0 issues ×3** | `tree_status validate t3c7/t3c8/t3c9` |
| `relay=off`（跑 flow 的外层 leaf / 内层 leaf） | **PASS** | 派发前读回 `relay=off`；`segmentChain=[]`、`drift_history=[]` |

耗时：`t3c7-C1` 派发 15:52:03 → 收口约 15:56:36（约 **4.5 分钟**）；flow `T3C7-R1` **150.3s**（INNER 节点 150.28s）。

---

## 2. 结构与深度链（FACT）

| 层 | 角色 / 节点 | 会话 id（短） | `delegationDepth` | 父会话 | 创建时刻（本地 +8） |
|---|---|---|---|---|---|
| 0 | Lead 根会话（接替会话） | `4f881251` | — | — | — |
| 1 | 外层树 `t3c7-C1-commander` | `a3624bf7` | **1** | `session-4f881251` | 15:52:03 |
| 2 | 外层树 `t3c7-C1a1-worker`（跑 flow） | `e1fab5d8` | **2** | `a3624bf7` | 15:52:25 |
| 3 | flow 节点 `INNER`（一次性会话） | `0fe0c3e7` | **3** | `e1fab5d8` | 15:53:05 |
| 4 | 内层树 `t3c8-C2-commander` | `8724600d` | **4** | `0fe0c3e7` | 15:53:42 |
| 5 | 内层树 `t3c8-C2a1-worker`（最深层 / 探针发起者） | `a1e3462f` | **5** | `8724600d` | 15:53:49 |
| — | 探针派发目标（`t3c9-P1-probe`） | **（无会话）** | — | — | — |

深度来源：`~/.dsh/sessions/--D-Codes-dsh-tree-harness--/<id>/session.v4.jsonl.zstd` 首行 header（`delegationDepth` / `parentSession`），逐会话读取，非推断。树内嵌套（`commander_max_depth=3`）：`t3c7` root→C1→C1a1、`t3c8` root→C2→C2a1，均 3 层合规。

---

## 3. 时间线（本地 +8h）

| 时刻 | 事件 |
|---|---|
| 15:52:03 | Lead 派发外层 `t3c7-C1-commander`（`relay=auto`；C1a1 `relay=off` 已预置） |
| 15:52:25 | C1 派发 `t3c7-C1a1-worker`；C1a1 起 `flow_run T3C7-R1` |
| 15:53:05 | flow 节点 `INNER` spawn（depth=3） |
| 15:53:2x | `INNER` 现场 `tree_plan create t3c8`（root owner=`0fe0c3e7`），add C2/C2a1，派发 C2 |
| 15:53:42 / 15:53:49 | C2（depth 4）/ C2a1（depth 5）创建 |
| 15:54:0x | C2a1 执行探针：`tree_plan create t3c9`（root owner=`a1e3462f`）→ `tree_node add t3c9-P1-probe` → `tree_dispatch start` |
| 15:54:12 | **派发被拒**（`E_PORTS_PROTOCOL / subagent depth 6 exceeds maxDepth 5`）；worker 写 done meta（`probe_result` 原文 + `sum=385`） |
| 15:54:1x | 内层 commander 收口（转述 worker 结果）；INNER 读 commander succeeded + `tree_status validate t3c8` → 0 issues；`INNER_RESULT` 输出 |
| 15:54:xx | flow `T3C7-R1` `run/ended status=succeeded`（durationMs=150316） |
| 15:55:48 | C1a1 写 done（flow status/integrity/INNER_RESULT 摘要） |
| 15:56:36 | C1 写 done（转述 worker 自报消息）→ 外层链收口 |
| 15:57+ | Lead 复核：三树 validate PASS、会话 depth 链、探针 leaf 无会话、tree_log 机读实证（§4.5） |

---

## 4. 关键证据（双读）

### 4.1 tree-state（FACT，`~/.dsh/profiles/desktop/tree-engine-data/`）

- `t3c7`：root `4f881251`；C1 `runtime=succeeded`；C1a1 `runtime=succeeded`（done meta 含 `flow_run_id=T3C7-R1`、`flow_status="succeeded; integrity=verified"`）。
- `t3c8`：**root `session_id=0fe0c3e7`（= flow 节点会话，现场建树）**；C2 `succeeded`；C2a1 `succeeded`。
- `t3c9`：root `session_id=a1e3462f`（= depth 5 worker，现场建树）；`t3c9-P1-probe.session_id=undefined`、`status=pending_brief`、无 events → **从未被派发**。
- 各 leaf `segment_chain=[]`、`runtime.segmentChain=[]`、`drift_history=[]`（无竹节接力、无 drift）。

### 4.2 探针树（FACT）

```json
{"t3c9-root":   {"session_id": "a1e3462f-bf7b-4a9e-8609-dca6db021d49", "status": "active"},
 "t3c9-P1-probe": {"session_id": undefined, "status": "pending_brief", "events": []}}
```
→ 派发失败发生在「创建子会话」之前，探针节点保持未派发态。

### 4.3 worker done meta 原文（FACT，tree-state + `tree_log events` 双读一致）

```json
{"summary":"深度 6 派发 已被拒；10 项平方和=385",
 "probe_result":"DEPTH_ERROR: code=E_PORTS_PROTOCOL message=ports.dispatch failed: subagent depth 6 exceeds maxDepth 5",
 "probe_tree":"t3c9",
 "squares":"1^2=1; 2^2=4; 3^2=9; 4^2=16; 5^2=25; 6^2=36; 7^2=49; 8^2=64; 9^2=81; 10^2=100",
 "sum":385}
```

内层 commander 的 done meta（转述，标明来源）：
`worker_probe: "DEPTH_ERROR: code=E_PORTS_PROTOCOL message=ports.dispatch failed: subagent depth 6 exceeds maxDepth 5"`。

### 4.4 会话证据（FACT）

- 工作区会话总数 234；`delegationDepth>=6` 的会话**只有** `f351d7ee`（`parentSession=3ed0f91d`，创建时间 **13:48:13**，属 D22 试点 v2 的历史证据，父会话是当轮 depth-5 worker）。
- depth-5 worker `a1e3462f` 的**子会话列表为空**（无 depth-6 会话）。
- 链上 5 个会话 header 见 §2 表。

### 4.5 flow 证据（FACT）

- `flow_status T3C7-R1` → `succeeded · integrity=verified · perm=safe · engine=flow-core@5a313fe9`；`INNER [session] succeeded session=0fe0c3e7`。
- journal `D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\T3C7-R1.jsonl`（14 事件）：
  - `node/spawned` `nodeId=INNER` `sessionId=0fe0c3e7-…`
  - `node/settled` `INNER status=succeeded durationMs=150280`
  - `run/ended` `{"status":"succeeded","outputs":null,"error":null,"stats":{"nodeExecutions":3,"retries":0,"durationMs":150316,"maxObservedConcurrency":1,"permTier":"safe"}}`
- `INNER_RESULT`（原文关键行）：`self_id: 0fe0c3e7…`、`identity_consistent: true`、`inner_tree_created_by: flownode-self`、`commander_runtime: succeeded`、`worker_runtime: succeeded`、`inner_tree_validate: 0 issues`。

### 4.6 运行环境（FACT）

- `tree_doctor {action:"run"}` → `7 checks · pass=7 warn=0 fail=0 · version=0.8.1`。
- `apply.log` 含 `subagent depth cap: 5 (request.maxDepth injected on every child session start)`（v0.8.1 注入生效）。
- 本试点核心证据（探针 15:54:12、flow 收口 15:54:2x）发生在**新代码 HMR 重载之前**（首条热重载日志 15:56:19），即 depth-6 拒绝证据属于 **v0.8.1 已加载实现**，未被本轮并行改动污染。

---

## 5. 修复前后对照（本回归的判据来源）

| 项 | v2（修复前，v0.8.0） | v3（本试点，v0.8.1） |
|---|---|---|
| depth-5 worker 起子会话方式 | `flow_run`（flow 执行器，仍无 maxDepth） | `tree_dispatch`（tree-engine，已注入 `request.maxDepth=5`） |
| 结果 | **子会话被创建**（`f351d7ee`，`delegationDepth=6`） | **被宿主拒绝**：`E_PORTS_PROTOCOL … subagent depth 6 exceeds maxDepth 5` |
| 无会话残留 | depth-6 会话真实存在 | 探针 leaf 无 session，无 depth-6 会话 |
| 结论 | 深度 6 未被拒（安全缺口） | **tree 派发路径已封口** |

根因链（已在 v2 报告 §5 实证）：`dsh-subagent` 服务只校验调用方显式传入的 `request.maxDepth`；v0.8.1 让 tree 派发/竹节接力/攻击会话统一经 `buildStartRequest` 注入 `maxDepth`（缺省 5，`TREE_ENGINE_CONFIG.max_subagent_depth` 可覆盖）。本回归给出**行为级**闭环证据。

---

## 6. 未覆盖边界与新发现（诚实清单）

1. **flow 执行器仍未封口**（既有边界，非本轮回归目标）：`flow_run` 起的节点会话（`session-executor.js`）仍不传 `maxDepth`，故「depth 5 的 worker 再起 flow 节点 → depth 6」**仍不会被拒**。属跨仓需求单 [REQ-2026-11-13](../operations/REQ-2026-11-13-flow-node-continuable-session.md) §附；本仓不代改 flow 代码。
2. **新发现①（平台/宿主）HMR 重载竞态**：本轮并行改动 `packages/dsh-tree-engine/**` 触发宿主 HMR 反复重装插件（apply.log 当日 113 次 apply），重载窗口内旧实例 dispose 会「反注册」新实例刚注册的工具 → 调用方偶发 `unknown tool`（tree_status/tree_doctor/tree_log/tree_node 均出现过，重试或稍后恢复；C1 会话也记录到 2 次瞬时错误）。影响：热更期间工具面不稳定；**建议**：宿主侧 dispose/register 顺序串行化，或插件侧 apply 幂等注册（`tools.register` 同名覆盖而非报错）。当前规避：改动收敛后做受控 disable→enable（D12）。
3. **新发现②（跨模型派发）`maxTokens` 继承**：`tree_dispatch` 的 `assignee` 只传 `{provider, model, reasoningEffort}`（`buildStartRequest` 未传 maxTokens），宿主按**调用方会话**的 `maxTokens=384000` 下发子会话请求 → 目标模型上限 131072 的供应商（如 `zai-coding-cn/glm-5.3`、`xiaomi/mimo-v2.6-pro`）首个请求即 400（`max_tokens参数非法` / `max_completion_tokens is too large`）。影响：异族模型指派不可用；当前规避=只用接受 384k 的通道（deepseek-official / opencode-go）。**建议**：宿主在 `startActivation/startContinuable` 按目标模型 clamp maxTokens，或 tree-engine 允许 `assignee.maxTokens` 透传。
4. 内层 commander 无法机读 worker done meta（`tree_node get` 不含 events；其任务书未允许 `tree_log`）→ 采用二手转述并在 meta 标注来源。该缺口正是本轮任务 4①（tree_log render 机读化）要修的，已在本轮实现并活体验证（见任务 4 报告/CHANGELOG）。
5. 本试点未触发 42% 竹节接力（外层上下文远低于阈值），`relay=off` 的抗打断能力不在本轮重新声称。

---

## 7. 复现步骤

1. 建外层树：`tree_plan create t3c7`（`session_id=<root 会话 id>`）→ add `t3c7-C1-commander`（parent=root, path=C1）→ add `t3c7-C1a1-worker`（parent=C1, path=C1a1, `relay:"off"`）→ 读回 relay。
2. 派发：`tree_dispatch start t3c7/t3c7-C1-commander`，prompt 指向 [commander1.prompt.md](../../demo/t3cpilot3/commander1.prompt.md)。
3. flow：`flow_run {runId:"T3C7-R1", flowPath:"<repo>/demo/t3cpilot3/flow.json", cwd:"<repo>"}`（由 C1a1 执行）。
4. flow 节点 `INNER` 按 [inner-node.prompt.md](../../demo/t3cpilot3/inner-node.prompt.md)：自标识 → `tree_plan create t3c8` → add C2/C2a1 → 派发 C2 → 轮询收口。
5. 探针：内层 worker（depth 5）按 [worker2.prompt.md](../../demo/t3cpilot3/worker2.prompt.md)：`pwsh $env:DSH_SESSION_ID` → `tree_plan create t3c9` → `tree_node add t3c9-P1-probe` → `tree_dispatch start`（**预期被拒**），记录错误原文，然后算平方和并 done。
6. 验收：`tree_status validate t3c7/t3c8/t3c9`；`flow_status T3C7-R1` + journal；`~/.dsh/sessions` header 深度链；tree-state 核对探针 leaf 无 session。
7. 清理/保留：树 `t3c7`/`t3c8`/`t3c9` 与 flow journal `T3C7-R1` **保留**作为证据。

## 8. FACT / INFERENCE / UNKNOWN

- **FACT**：depth-5 tree 派发被拒（错误原文）；无 depth-6 会话；深度链 1..5；flow succeeded/integrity=verified；三树 validate 0 issues；探针 leaf 无 session；`relay=off` 读回；`subagent depth cap: 5` 注入日志；`tree_log` 已可机读 done meta（§4.3 双读）。
- **INFERENCE**：tree 派发路径的深度封口已生效；flow→tree 组合中「最深层再起 flow 节点」仍无平台兜底（属 flow 执行器，待跨仓修复）。
- **UNKNOWN**：① 宿主 HMR 竞态的确切触发条件与宿主侧修复方案（本轮仅观测+规避）；② 跨模型 `maxTokens` 问题是否在 `subagent` 工具路径同样存在（本轮仅在 tree 派发路径复现，未单独验证工具路径）；③ 若 `TREE_ENGINE_CONFIG.max_subagent_depth` 被调到 <5 的组合行为（本轮未压）。
