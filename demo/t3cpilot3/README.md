# tree → flow → tree 受控试点 v3（t3cpilot3，2026-11-13）

本目录是 **2026-11-13 受控试点 v3** 的可复现配置：验证 **tree-engine v0.8.1 深度预算修复**——深度 5 的会话再派发子会话（→ 深度 6）应被宿主拒绝，而不是像 v2 那样被创建。

**与 v2（`demo/t3cpilot2/`）的唯一关键差异**：第 5 层 worker 的负向探针从「`flow_run` 起 flow 节点」改为「`tree_plan` 现场建小树 + `tree_dispatch` 派发 leaf」——因为 v0.8.1 修复的正是 **tree 派发路径**注入 `request.maxDepth`（flow 执行器仍未修，属 flow 项目组需求单，故 flow 探针在 v0.8.1 下仍不会被拒，不能作为本修复的验收探针）。

## 结构（预期深度链）

| 层 | 节点 | 预期 delegationDepth |
|---|---|---|
| 0 | Lead 根会话 | — |
| 1 | 外层树 `t3c7-C1-commander` | 1 |
| 2 | 外层树 `t3c7-C1a1-worker`（跑 flow） | 2 |
| 3 | flow 节点 `INNER` | 3 |
| 4 | 内层树 `t3c8-C2-commander` | 4 |
| 5 | 内层树 `t3c8-C2a1-worker`（最深） | 5 |
| — | worker 再 `tree_dispatch`（探针） | **预期被拒（无 depth 6 会话）** |

## 文件

| 文件 | 作用 |
|---|---|
| `flow.json` | 内联 flow DSL（1 个 session 节点 `INNER`） |
| `inner-node.prompt.md` | flow 节点：自标识 → `tree_plan` 现场建 `t3c8` → 建 C2/C2a1 → 派发 C2 → 轮询收口 |
| `commander1.prompt.md` | 外层树 `t3c7` commander |
| `worker1.prompt.md` | 外层树 worker（跑 `flow_run T3C7-R1`） |
| `commander2.prompt.md` | 内层树 `t3c8` commander |
| `worker2.prompt.md` | 内层树 worker（**depth 5**）：`tree_plan` 建 `t3c9` + `tree_dispatch` → 预期 `E_PORTS_PROTOCOL` + `subagent depth 6 exceeds maxDepth 5`；平方和 |

## 验收

1. worker2 done meta 的 `probe_result` 含错误原文（`E_PORTS_PROTOCOL` 且 message 含 `subagent depth 6 exceeds maxDepth 5`）；
2. `~/.dsh/sessions/--D-Codes-dsh-tree-harness--/` 中**不存在** delegationDepth=6 的新会话（创建时刻窗口内只应有 1..5 五个新会话）；
3. `tree_status {action:"validate", tree_id:"t3c7"}` / `t3c8` / `t3c9` 均 0 issues；
4. `flow_status T3C7-R1` succeeded/integrity=verified。

保留物：树 `t3c7`/`t3c8`/`t3c9` 与 flow journal `T3C7-R1` 为证据，勿清理。
