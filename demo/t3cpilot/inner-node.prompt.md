# INNER 流程节点任务书（一次性会话）

你是三层组合试点（tree `t3c1` → flow → tree `t3c2`）里的 flow 节点会话（节点 id = `INNER`）。
目标：在**已存在**的内层任务树 `t3c2` 中派发 commander 节点、等它收口，然后把结果返回给 flow。

## 已由 Lead 预置的静态事实（不要重复创建）

- 内层树 `t3c2` 已存在，含两个叶子：`t3c2-C2-commander`（role=commander，未派发）、`t3c2-C2a1-worker`（role=worker，未派发）。
- 你的会话深度 = 2（root → 外层 commander `t3c1-C1-commander` → 你）；内层 commander 会挂在**你**下面（深度 3），worker 再深一层（深度 4）。平台 maxDepth=5，够用。

## 严格步骤

1. 调用 `tree_dispatch {action:"start", tree_id:"t3c2", leaf_id:"t3c2-C2-commander", prompt:"<commander 派发词>"}`，
   其中 `<commander 派发词>` 见本节末尾，**逐字复制**到 `prompt` 参数。
2. 等待 commander 收口（最多 40 轮，每轮按顺序）：
   a. `tree_status {action:"harvest", tree_id:"t3c2"}`
   b. `tree_node {action:"get", tree_id:"t3c2", leaf_id:"t3c2-C2-commander"}`
   判定：若 `leaf.runtime.state == "succeeded"` → 结束等待；若是 `failed` / `cancelled` → 如实记录并结束等待；
   否则执行 `pwsh`（command = `Start-Sleep -Seconds 10`）后进入下一轮。
   **不要重复 dispatch；不要 cancel；不要改树结构。**
3. 最后一条正常消息（assistant text）必须以如下三行开头（后续可再附证据）：
   `INNER_RESULT: <一句话：commander 最终 runtime.state + 是否拿到 worker 结果>`
   `commander_runtime: <succeeded|failed|cancelled|unknown>`
   `worker_runtime: <从同一次 tree_node get / tree_status harvest 的 leaves 读取；读不到写 unknown，不得编造>`
4. 若任何工具报错：最后消息改为 `INNER_RESULT: FAILED <错误码/错误信息>`，并附已完成步骤。

## commander 派发词（逐字复制进第 1 步的 prompt 参数）

读取 D:\Codes\dsh-tree-harness\demo\t3cpilot\commander.prompt.md，并严格按其中的步骤执行。只读该文件，不要修改它。

## 硬边界（违反即视为试点失败）

- 只允许调用：`tree_dispatch`（仅第 1 步一次）、`tree_status`、`tree_node`（get）、`pwsh`（仅 Start-Sleep）。
- 禁止：创建/删除树或叶子、改 relay、调用 `flow_run`、调用 `tree_verify`、写文件、git 操作、修改仓库。
- 你的最终文本会作为 flow 节点输出（`extract: "text"`），所以最后消息必须是第 3 步要求的格式。
