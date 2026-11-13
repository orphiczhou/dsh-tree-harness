# 内层树 t3c8 worker 任务书（试点 v3 · 深度 5 最深层）

你是任务树 `t3c8` 的 worker 节点 `t3c8-C2a1-worker`（role=worker，**会话深度 5 = `subagent.maxDepth` 上限**）。
你的任务：① 做**一次**深度负向探针——用 **tree 派发**方式起子会话，验证 tree-engine v0.8.1 之后「深度 5 再派发 → 深度 6」会被宿主拒绝；② 完成纯计算。除这一次探针外，**不得再起任何子会话**。

## 第 1 步：深度负向探针（只做一次，预期被拒）

按顺序执行，**每步只做一次，不要重试**：

1. 取自身会话 id：`pwsh` 参数 `command` = `Write-Output $env:DSH_SESSION_ID`，去掉首尾空白，记为 `SELF_ID`（读不到就记 `missing` 并在探针结果里如实标注；不可编造）。
2. `tree_plan {action:"create", tree_id:"t3c9", session_id:"<SELF_ID>", root_brief:{goal:"深度 6 拒绝探针（预期不创建子会话）", context:"worker at depth 5 tries tree dispatch"}, root_dod:{dod:"预期提交即被宿主 SubagentDepthError 拒绝"}}`
3. `tree_node {action:"add", tree_id:"t3c9", leaf:{leaf_id:"t3c9-P1-probe", parent:"t3c9-root", path:"P1", role:"worker", added_by:"<SELF_ID>", taskType:"default"}}`
4. `tree_dispatch {action:"start", tree_id:"t3c9", leaf_id:"t3c9-P1-probe", prompt:"若收到本条消息，只回答 OK（本探针预期不会创建会话）。"}`

**预期**：第 4 步被拒绝——tool 返回错误 / 或 `{ok:false, error:{code:"E_PORTS_PROTOCOL", message:"... subagent depth 6 exceeds maxDepth 5 ..."}}`。这是**预期结果，不是故障**。

记录方式（任选实际发生的，原文照抄）：
- 若工具返回错误对象 → `PROBE = "DEPTH_ERROR: code=<code> message=<message 原文>"`
- 若工具调用本身抛错 → `PROBE = "DEPTH_ERROR: <错误原文>"`
- 若**意外成功**（返回 `running` / 创建了会话）→ `PROBE = "UNEXPECTED_SUCCESS: <返回原文>"`（如实记录，不要掩盖）
**不要重试；不要换 leaf/tree 再试；不要 cancel；不要继续追问这次派发。**

## 第 2 步：纯计算（不写文件、不碰 git）

1. 计算 `1×1` 到 `10×10` 的平方表，按 `1^2=1; 2^2=4; ...; 10^2=100` 的格式合成一行。
2. 给出这 10 个平方数的和（应为 385）。

## 完成动作

1. 调用 `tree_report {action:"event", tree_id:"t3c8", leaf_id:"t3c8-C2a1-worker", type:"done", meta:{summary:"深度 6 派发 <已被拒|意外成功>；10 项平方和=385", probe_result:"<PROBE 原文>", probe_tree:"t3c9", squares:"<一行平方表>", sum:385}}`。
2. 最后一条正常消息以 `WORKER2_RESULT:` 开头，附：PROBE 原文、平方表、和、`self_id`。

## 硬边界（违反即视为试点失败）

- 只允许调用：`pwsh`（第 1 步 1 次 `$env:DSH_SESSION_ID`）、`tree_plan`（1 次 create t3c9）、`tree_node`（add 1 次）、`tree_dispatch`（1 次 start）、`tree_report`（1 次）。
- 禁止：`flow_run`、`tree_verify`、`session_handoff`、`tree_status`、`tree_node` 其它 action、写文件、git、修改仓库、再派发第二个会话。
- 诚实失败优于伪报成功：探针结果原样记录，不美化。
