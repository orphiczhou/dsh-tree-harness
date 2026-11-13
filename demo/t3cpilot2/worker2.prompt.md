# 内层树 t3c4 worker 任务书（试点 v2 · 深度 5 最深层）

你是任务树 `t3c4` 的 worker 节点 `t3c4-C2a1-worker`（role=worker，**会话深度 5 = 平台 maxDepth 上限**）。
你的任务有两件：① 做**一次**有意的负向探针，验证"深度 5 再起子会话会被平台拒绝"；② 完成纯计算。**除这一次负向探针外，不得再起任何子会话。**

## 第 1 步：负向探针（只做一次，预期失败）

调用 `flow_run`，参数：
- `runId`: `"T3C3-DEPTHNEG-1"`
- `cwd`: `"D:\\Codes\\dsh-tree-harness"`
- `flow`: 内联对象（原样传）：
```json
{"dslVersion":"0.1","id":"t3c3-depth-neg","limits":{"maxNodes":4,"maxRunMs":120000},
 "nodes":[{"id":"CHILD","type":"session","timeoutMs":60000,
           "input":{"prompt":"若收到本条消息，只回答 OK。"}}],"edges":[]}
```

**预期**：深度 5 会话再起子会话 → 子会话深度 6 > maxDepth 5 → flow 节点启动失败（预期错误信息含 `subagent depth 6 exceeds maxDepth 5` / `E_SESSION_START_FAILED`）。这是**预期结果，不是故障**。

记录方式（任选实际发生的）：
- 若 `flow_run` 返回失败结果（如 `status=failed` / 带 `error`）→ `PROBE = "DEPTH_ERROR: <status + error.code/message 原文>"`；
- 若 `flow_run` 工具调用本身抛错 → `PROBE = "DEPTH_ERROR: <错误原文>"`；
- 若**意外成功**（子会话被创建）→ `PROBE = "UNEXPECTED_SUCCESS: <status 原文>"`（如实记录，不要掩盖）。
**不要重试；不要换 runId 再试；不要继续追问这次 flow。**

## 第 2 步：纯计算（不写文件、不碰 git）

1. 计算 `1×1` 到 `10×10` 的平方表，按 `1^2=1; 2^2=4; ...; 10^2=100` 的格式合成一行。
2. 给出这 10 个平方数的和（应为 385）。

## 完成动作

1. 调用 `tree_report {action:"event", tree_id:"t3c4", leaf_id:"t3c4-C2a1-worker", type:"done", meta:{summary:"深度探针 <预期失败已证实|意外成功>；10 项平方和=385", probe_result:"<PROBE 原文>", squares:"<一行平方表>", sum:385}}`。
2. 最后一条正常消息以 `WORKER_RESULT:` 开头，附：PROBE 原文、平方表、和。

## 硬边界（违反即视为试点失败）

- 只允许调用：`flow_run`（第 1 步一次）、`tree_report`（一次）。
- 禁止：`tree_plan`、`tree_node`（add）、`tree_dispatch`、`tree_verify`、`session_handoff`、写文件、git、修改仓库、任何其他起子会话的动作。
- 诚实失败优于伪报成功：探针结果原样记录，不美化。
