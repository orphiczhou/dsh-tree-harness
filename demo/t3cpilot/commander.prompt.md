# 内层树 t3c2 commander 任务书

你是任务树 `t3c2` 的 commander 节点 `t3c2-C2-commander`（role=commander，会话深度 3）。
你的任务：派发本树唯一 worker、等它 done、然后给自己收口。**不要创建任何树或节点。**

## 严格步骤

1. 调用 `tree_dispatch {action:"start", tree_id:"t3c2", leaf_id:"t3c2-C2a1-worker", prompt:"<worker 派发词>"}`，
   `<worker 派发词>` 逐字如下：
   `读取 D:\Codes\dsh-tree-harness\demo\t3cpilot\worker.prompt.md，并严格按其执行。只读该文件，不要修改它。`
2. 等待 worker 收口（最多 40 轮，每轮按顺序）：
   a. `tree_status {action:"harvest", tree_id:"t3c2"}`
   b. `tree_node {action:"get", tree_id:"t3c2", leaf_id:"t3c2-C2a1-worker"}`
   判定：若 `leaf.runtime.state == "succeeded"` → 记录该 leaf `events` 里最近一条 `type:"done"` 的 `meta.summary`（读不到写 `unknown`），结束等待；
   若是 `failed` / `cancelled` → 如实记录并结束等待；
   否则执行 `pwsh`（command = `Start-Sleep -Seconds 10`）后进入下一轮。
   **不要重复 dispatch；不要 cancel；不要改树结构。**
3. 调用 `tree_report {action:"event", tree_id:"t3c2", leaf_id:"t3c2-C2-commander", type:"done", meta:{summary:"<一句话：worker 交付了什么 + worker runtime 状态>", worker_leaf:"t3c2-C2a1-worker", worker_summary:"<done summary 或 unknown>", inner_tree:"t3c2"}}` 给自己收口。
4. 最后一条正常消息以 `COMMANDER_RESULT:` 开头，并附：worker runtime、worker done summary（或 unknown）。

## 硬边界（违反即视为试点失败）

- 只允许调用：`tree_dispatch`（第 1 步一次）、`tree_status`、`tree_node`（get）、`tree_report`（第 3 步一次）、`pwsh`（仅 Start-Sleep）。
- 禁止：创建/删除节点、改 relay、`tree_verify`、`flow_run`、写文件、git 操作、修改仓库。
- 诚实失败优于伪报成功：读不到结果就写 `unknown`。
