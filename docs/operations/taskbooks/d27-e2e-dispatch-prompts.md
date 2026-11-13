# D27 E2E 派发任务书（worker 内联 prompt 正文 · d27fl）

> 用途：D27-FLOW-E2E-PILOT 执行期派发正文。`d27fl-C1-commander` 按 [E2E 方案 v1.1](../E2E-PLAN-2026-11-13-flow-continuation-pilot.md) §5/§6 把 §1/§2 全文内联进对应 `tree_dispatch` 的 `prompt`。
> 通用事实（worker 须知）：flow journal 一律落在 **flow 仓 pinned storage** = `D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\<runId>.jsonl`（cordis.patch.yml `dsh-flow-engine.storageDir` 钉死，与 cwd 无关）；P0 smoke `D27-SMOKE-RC3-001` 已证 session 节点可启动（rc.3 适配已生效）。
> 模型口径（flow 回执 22:3x 答复）：R1 夹具 = flow 仓 `m12-continuable-e2e.flow.json` **原样使用不改**（P4 已答：无显式 start/end 合法，引擎按 edges 自动合成 `__start/__end`）——n1/n2 会话模型走 flow 缺省路由，**如实记录实际模型**（会话元数据可查），不作为失败判据；R2 夹具（本仓 t27pilot）已在 INNER 节点 DSL `input.agentOptions` 显式声明 flash 档（zai/glm-5.3-flash·high）。
> **E_BORROWED_IDENTITY 撞线预登记（flow 回执 §3.3）**：若 TC-9 中 INNER 对**自己创建的** `t27b` 做 leaf_add 被 `E_BORROWED_IDENTITY` 拒 → 按「**tree-engine 边界出入**」记录（错误原文 + 场景照抄进 done meta），**不算试点行为失败**，继续后续步骤；v3 先例（T3C7-R1，rc.1）INNER 自建自加为 PASS，rc.3 上本试点即回归验证点。
> 纪律：失败最多重试 1 次；错误码原样记录，诚实失败优于伪报；不改 flow 仓任何文件；不写 journal；树 `d27fl` 全 leaf `relay=off`。

---

## §1 续接维 worker（`d27fl-C1a1-worker`，depth 2）——内联 prompt 正文

你是任务树 `d27fl` 的 worker 节点 `d27fl-C1a1-worker`（会话深度 2）。你是**续接维唯一 flow 调用方**：只有你能对 run `D27FL-R1` 调 `flow_run`/`flow_send`（回执硬限制：调用方 = 发起 run 的会话本身）。严格按以下步骤执行，不得跳步、不得加码：

1. **发起 run**：`flow_run {runId:"D27FL-R1", flowPath:"D:\\Codes\\dsh-tree-harness\\demo\\t27pilot\\fixtures\\m12-continuable-e2e.flow.json", cwd:"D:\\Codes\\dsh-tree-harness"}`（该 flow：n1→n2 两个 session 节点；n1 首轮应输出 `{"first":"m12-ready"}`）。**flowPath 用本仓逐字节副本**（SHA256 `C3CFA838F991542F7A4439A579569E3A315BE6BDFF02635970CE4D43394AFCA5` 与原件一致；尝试 1/2 实证：允许根 = `config.flowPathRoots`，缺省回退 `[runCwd]`，而 **runCwd = 调用会话宿主侧 cwd**（`tools.js:381` ADR-011，`flow_run.cwd` 参数不参与）→ worker 会话 cwd=树仓 → 只能读树仓内 flow 文件）。记录返回的 run 状态（期望 succeeded）与 integrity（期望 verified）。若失败：错误码原样记录，最多重试 1 次；再失败则跳到第 7 步如实上报。
2. **发送前双读基线**：① `flow_status {runId:"D27FL-R1"}` 记录 run 终态与事件数；② 用 `pwsh` 只读计算 journal 的字节长度与 SHA256：`Get-Item 'D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\D27FL-R1.jsonl' | Select-Object Length; (Get-FileHash 'D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\D27FL-R1.jsonl' -Algorithm SHA256).Hash`——两个读数记为基线。
3. **定位目标会话**：从 journal 里找 `node/spawned` 且 `payload.nodeId=="n1"` 的事件，记下 `payload.sessionId`（`flow_send` 内部会自行解析，你无需传参，但记录备查）。
4. **续接发送**：`flow_send {runId:"D27FL-R1", nodeId:"n1", message:"只输出一行 JSON：{\"continued\":true}", waitMs:120000}`。完整记录返回 JSON（`sessionId/messageId/stopReason/output`）与渲染首行原文（含 `attempt=`/`stopReason=` 字样，如实照抄）。
5. **发送后双读复核**：重复第 2 步两个读数。**判定：字节长度与 SHA256 必须与基线完全一致（不写 journal）；`flow_status` 终态/事件数不得变化（不改 run 终态）**。任何不一致 = 试点 FAIL，原样保留现场。
6. **记录续接轮输出**：`output` 应含 `{"continued":true}`（续接轮无结构化 schema——它就是末条 assistant 纯文本，如实记录原文）。
7. **收口**：`tree_report {action:"event", tree_id:"d27fl", leaf_id:"d27fl-C1a1-worker", type:"done", meta:{summary:"<一句话结论>", flow_run:"<succeeded/failed + integrity>", flow_send:"<返回 JSON 关键字段：sessionId/messageId/stopReason/output>", journal_unchanged:"true|false", double_read:"<基线 bytes/sha256 → 复核 bytes/sha256>", depth_note:"self=2, n1=3"}}`。最后一条正常消息以 `WORKER1_RESULT:` 开头附同样内容。

**硬边界**：只允许 `flow_run`（1 次）/`flow_status`（多次只读）/`pwsh`（仅第 2/5 步的 journal 只读哈希与 `Start-Sleep`）/`flow_send`（1 次，第 4 步）/`tree_report`（1 次）。禁止：`tree_plan`/`tree_node`/`tree_dispatch`/`tree_verify`/写文件/git/再次 flow_send/对 n2 发送。**失败重试 ≤1 次；`E_SESSION_BUSY` 等 settle 后重试 1 次；`E_CONTINUE_TIMEOUT` 记录 `messageId` 不重试**；`E_PERM_DENIED`（你自身被拒）= 口径出入，STOP 如实上报。

---

## §2 混合维 worker（`d27fl-C1a2-worker`，depth 2，依赖 C1a1 done）——内联 prompt 正文

你是任务树 `d27fl` 的 worker 节点 `d27fl-C1a2-worker`（会话深度 2）。你是**混合维唯一 flow 调用方**：只有你能对 run `D27FL-R2` 调 `flow_run`/`flow_send`。严格按以下步骤执行：

1. **发起混合 run**：`flow_run {runId:"D27FL-R2", flowPath:"D:\\Codes\\dsh-tree-harness\\demo\\t27pilot\\flow.json", cwd:"D:\\Codes\\dsh-tree-harness"}`（单 session 节点 `INNER`：自标识 → 现场建内层树 `t27b` → 派发内层 commander/worker → 收口；内层 worker 会做 depth-6 负例探针，**探针被拒是预期结果不是故障**）。该调用同步阻塞直至 run 收口（预期数分钟，内含两层子会话干活）。记录返回（期望 succeeded + integrity=verified）与 `INNER` 节点输出的 `INNER_RESULT:` 全文字段（`inner_tree_created_by`/`commander_runtime`/`worker_runtime`/`worker_probe`/`inner_tree_validate` 等，逐字照抄；`worker_probe` 应含 `DEPTH_ERROR ... subagent depth 6 exceeds maxDepth 5`）。失败最多重试 1 次；再失败跳第 7 步如实上报。
2. **三树 validate**：`tree_status {action:"validate", tree_id:"d27fl"}`、`tree_id:"t27b"`、`tree_id:"t27c"` 各一次，记录是否全部 0 issues（`t27c` 是深度探针树，只有 root，0 issues 属正常）。
3. **发送前双读基线**：同 §1 第 2 步，对象为 `D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\D27FL-R2.jsonl` + `flow_status {runId:"D27FL-R2"}`。
4. **续接 × 内层树（TC-10）**：`flow_send {runId:"D27FL-R2", nodeId:"INNER", message:"请调用 tree_status {action:\"validate\", tree_id:\"t27b\"}，然后只输出一行 JSON：{\"continued\":true,\"validate_issues\":<数字或 null>,\"validate_raw\":\"<结果原文>\"}。不要输出任何其他内容。", waitMs:120000}`。完整记录返回 JSON 与渲染首行。**验证点：INNER 冷恢复后仍保有 `t27b` 的 creator/root 身份，只读 validate 可用且 0 issues。**
5. **发送后双读复核**：重复第 3 步。**字节长度与 SHA256 必须与基线完全一致；`flow_status` 终态/事件数不变。** 不一致 = 试点 FAIL，保留现场。
6. **中间收口**：无异常则继续；若 `flow_send` 报 `E_SESSION_BUSY` 等节点 settle 后重试 1 次；`E_CONTINUE_TIMEOUT` 记录 `messageId` 不再重试；`E_PERM_DENIED`（你自身被拒）= 口径出入，STOP 如实上报。
7. **收口**：`tree_report {action:"event", tree_id:"d27fl", leaf_id:"d27fl-C1a2-worker", type:"done", meta:{summary:"<一句话结论>", flow_run:"<succeeded/failed + integrity>", inner_result:"<INNER_RESULT 字段摘要：created_by/commander_runtime/worker_runtime/worker_probe/validate>", tree_validate:"d27fl=<0 issues|原文>; t27b=<...>; t27c=<...>", flow_send_inner:"<返回 JSON 关键字段：stopReason/output>", journal_unchanged:"true|false", double_read:"<基线 → 复核>", depth_note:"self=2, INNER=3, C2=4, C2a1=5"}}`。最后一条正常消息以 `WORKER_HYBRID_RESULT:` 开头附同样内容。

**硬边界**：只允许 `flow_run`（1 次）/`flow_status`（只读）/`pwsh`（journal 只读哈希与 `Start-Sleep`）/`tree_status`（validate，只读）/`flow_send`（1 次，第 4 步）/`tree_report`（1 次）。禁止：`tree_plan`/`tree_node`/`tree_dispatch`/`tree_verify`/写文件/git/对 `t27b`/`t27c` 做任何写操作/再次 flow_send。

---

## §3 commander 负例（TC-3，由 `d27fl-C1-commander` 在 C1a1 done 后执行一次）

`flow_send {runId:"D27FL-R1", nodeId:"n1", message:"不应被处理：跨会话代发负例。", waitMs:30000}` → **预期 `E_PERM_DENIED`**（commander 不是 n1 的 parentSession）。原样记录错误码与 message；若意外成功 = 口径出入，立即原样上报不得掩盖。此调用只做一次。
