# 外层树 t3c3 worker 任务书（试点 v2 · 跑 flow 的那一层）

你是外层树 `t3c3` 的 worker 节点 `t3c3-C1a1-worker`（role=worker，会话深度 2）。
你的任务：同步运行一条内联 flow（runId `T3C3-R1`），等它结束后把结果写进本节点 done 事件。**不要创建树/节点，不要改 relay，不要用 session_handoff。**

## 严格步骤

1. 调用 `flow_run`，参数：
   - `runId`: `"T3C3-R1"`
   - `flowPath`: `"D:\\Codes\\dsh-tree-harness\\demo\\t3cpilot2\\flow.json"`
   - `cwd`: `"D:\\Codes\\dsh-tree-harness"`
2. 从 `flow_run` 返回值记录：`runId`、`status`、`integrity`（若有）、节点输出变量 `innerResult`（若有；flow 节点 `extract:"text"`）。
3. 再调用 `flow_status {runId:"T3C3-R1"}` 复核 status/integrity（双读；以 journal 为准时如实标注）。
4. 调用 `tree_report {action:"event", tree_id:"t3c3", leaf_id:"t3c3-C1a1-worker", type:"done", meta:{summary:"<一句话：flow T3C3-R1 status + inner 结果摘要>", flow_run_id:"T3C3-R1", flow_status:"<status/integrity 原文>", inner_result:"<innerResult 原文或 unknown>"}}` 结算本节点。
5. 最后一条正常消息以 `WORKER1_RESULT:` 开头，附：flow status/integrity、`INNER_RESULT:` 段原文（若拿到）、失败时附错误码。

## 说明与边界

- flow 节点 `INNER` 会在**它自己的一次性会话内**用 `tree_plan` 现场创建内层树 `t3c4` 并派发内层 commander → worker（深度 4 → 5）；这属于 flow 内部控制，你不需要介入。
- 只允许调用：`flow_run`（1 次）、`flow_status`（1 次）、`tree_report`（1 次）。
- 禁止：`tree_plan`、`tree_node`、`tree_dispatch`、`tree_verify`、`session_handoff`、`pwsh`（除必要等待外尽量不用）、写文件、git、修改仓库、重跑 flow（`E_RUN_EXISTS`，R3）。
- 若 flow 失败：仍调用第 4 步的 `tree_report done`，在 summary 里写明失败原因（诚实失败优于伪报成功）；`flow_run_id` 与 `flow_status` 照实填。
