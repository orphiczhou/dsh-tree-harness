# INNER 流程节点任务书（试点 v2：现场建树 + 深度 5 边界）

你是三层组合试点 v2（外层树 `t3c3` → flow → 内层树 `t3c4`）里的 flow 节点会话（节点 id = `INNER`，会话深度 3）。
与 v1（t3cpilot）的关键区别：**内层树不再由 Lead 预置，必须由你在本会话内用 `tree_plan` 现场创建**（`session_id` / `added_by` 用你自己的会话 id）。这是本试点要验证的核心能力。

## 第 0 步：自标识协议（必须先做，只做一次）

1. 调用 `self_spec`（无参数），记录返回中的 `spec.session_id` 值（可能带 `session-` 前缀；读不到就记 `missing`）。
2. 调用 `pwsh`，参数 `command` = `Write-Output $env:DSH_SESSION_ID`，记录输出（去掉首尾空白；空则记 `missing`）。
3. 归一化比较：两者都去掉可选前缀 `session-` 后应完全一致。
   - 若两者都 `missing` → 立即结束，最后消息为 `INNER_RESULT: FAILED self-id-unavailable`，不要继续。
   - 若只缺一个 → 用存在的那一个继续，并在最终输出里如实标注。
   - 若两者都存在但归一化后不一致 → 立即结束，最后消息为 `INNER_RESULT: FAILED identity-mismatch self_spec=<a> env=<b>`。
4. 记你选定的原始值（保留原样，不要手工拼/截 `session-` 前缀）为 `SELF_ID`，后续 `session_id` 与 `added_by` 都原样传 `SELF_ID`（引擎会自己做归一化）。

## 第 1 步：现场创建内层树 `t3c4`

调用 `tree_plan`：
```json
{"action":"create","tree_id":"t3c4","session_id":"<SELF_ID>",
 "root_brief":{"goal":"内层树：验证 flow 节点现场建树 + 深度 5 边界","context":"由 flow 节点 INNER 现场创建；commander 派发 worker 完成平方表与深度探针"},
 "root_dod":{"dod":"内层 commander 与 worker 的 runtime.state 均为 succeeded，worker 记录深度 6 派发的预期失败证据"}}
```
（把 `<SELF_ID>` 替换为第 0 步得到的值。）

## 第 2 步：建两个叶子（added_by 原样传 `SELF_ID`）

1. `tree_node {action:"add", tree_id:"t3c4", leaf:{leaf_id:"t3c4-C2-commander", parent:"t3c4-root", path:"C2", role:"commander", added_by:"<SELF_ID>", taskType:"default"}}`
2. `tree_node {action:"add", tree_id:"t3c4", leaf:{leaf_id:"t3c4-C2a1-worker", parent:"t3c4-C2-commander", path:"C2a1", role:"worker", added_by:"<SELF_ID>", taskType:"default", relay:"off"}}`

若任一步报错（尤其 `E_BORROWED_IDENTITY` / `E_INVALID_UUID_STRICT`），**不要编造、不要换 id 重试**：把错误码与 message 原样写入最终消息 `INNER_RESULT: FAILED <code> <message>` 并结束（这本身就是本试点的有效证据）。

## 第 3 步：派发内层 commander（只派发一次）

`tree_dispatch {action:"start", tree_id:"t3c4", leaf_id:"t3c4-C2-commander", prompt:"读取 D:\\Codes\\dsh-tree-harness\\demo\\t3cpilot2\\commander2.prompt.md，并严格按其步骤执行。只读该文件，不要修改它。"}`

## 第 4 步：等待收口（最多 40 轮）

每轮按顺序：
a. `tree_status {action:"harvest", tree_id:"t3c4"}`
b. `tree_node {action:"get", tree_id:"t3c4", leaf_id:"t3c4-C2-commander"}`
判定：`leaf.runtime.state == "succeeded"` → 结束等待；`failed` / `cancelled` / `frozen` → 记录后结束等待；否则 `pwsh`（`Start-Sleep -Seconds 10`）后下一轮。
**不要重复 dispatch；不要 cancel；不要改 relay；不要改树结构。**

## 第 5 步：读取结果

- `tree_node {action:"get", tree_id:"t3c4", leaf_id:"t3c4-C2a1-worker"}` 读 worker 的 `runtime.state` 与它 `events` 里最近一条 `type:"done"` 的 `meta`（取 `summary` / `probe_result` / `sum`；读不到写 `unknown`，不得编造）。
- `tree_status {action:"validate", tree_id:"t3c4"}` 记录结果是否 0 issues。

## 第 6 步：最后一条正常消息（assistant text）格式

必须以如下行开头（每行一个字段，后续可再附证据说明）：

```
INNER_RESULT: <一句话：内层树是否由本会话现场创建成功 + commander/worker 终态>
self_id: <SELF_ID 原样>
self_spec_session: <self_spec 读到的值或 missing>
env_session_id: <$env:DSH_SESSION_ID 读到的值或 missing>
identity_consistent: <true|false|single-channel>
inner_tree_created_by: <flownode-self | unknown>
commander_runtime: <succeeded|failed|cancelled|frozen|unknown>
worker_runtime: <succeeded|failed|cancelled|frozen|unknown>
worker_probe: <worker done meta 里的 probe_result，或 unknown>
worker_sum: <worker done meta 里的 sum，或 unknown>
inner_tree_validate: <0 issues 或原文>
```

## 硬边界（违反即视为试点失败）

- 只允许调用：`self_spec`（1 次）、`pwsh`（仅第 0 步的 `$env:DSH_SESSION_ID` 与等待用的 `Start-Sleep`）、`tree_plan`（1 次 create `t3c4`）、`tree_node`（add 2 次 / get）、`tree_dispatch`（1 次）、`tree_status`（harvest/validate）。
- 禁止：`flow_run`、`tree_verify`、`session_handoff`、写文件、git 操作、修改仓库、创建 `t3c3` 相关节点、cancel 任何节点、再派发第二个会话。
- 若工具报错且无法继续：最后消息以 `INNER_RESULT: FAILED <错误码/错误信息>` 开头，并附已完成步骤。
- 你的最终文本会作为 flow 节点输出（`extract: "text"`），格式必须符合第 6 步。
