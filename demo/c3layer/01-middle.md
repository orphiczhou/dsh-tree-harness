# 三层最小演示 · 中间层记录（commander）

> 版本：定稿（2026-11-11 15:39 +08:00；派发、收割、验收、交接全部完成后的最终值）

## 1. 中间层是谁

- 角色：中间层指挥官（commander），树 `c3demo` 的第二层。
- leaf：`c3demo-M1-commander`（父 leaf `c3demo-root`）。
- 会话 id：`8fb77300-3559-453a-9596-b02f4d693b28`（`$env:DSH_SESSION_ID` 读出）。
- 父会话（根）：`7dd52e8b-a3c2-4481-a9da-8ef94b9a093e`。
- 工作区：`D:\Codes\dsh-tree-harness`；模型 `opencode-go/deepseek-v4.1-flash`，
  preset=standard，permission=danger-full-access/danger-full-access/never。

## 2. 收到的目标

用户要求：根会话→中间层→执行层三层都能真干活，并在中间层交接一次。
本层职责（来自根层派发任务书）：本层必须真干活、可核验，不能只转发——
写本文件；在本层下建执行层 worker 并派发；收割与 `tree_verify` 验收；做一次
`session_handoff`（用户明确要求，允许 `force:true`）；最后由本层 owner 写 `done`。

## 3. 本层分解

| 层 | leaf / 会话 | 角色 | taskType | 产物 |
|---|---|---|---|---|
| 中间层（我） | `c3demo-M1-commander` / `8fb77300` | commander | — | `demo/c3layer/01-middle.md` |
| 执行层 | `c3demo-M1a1-worker` / `63530e9d` | worker | `default` | `demo/c3layer/02-execution.md` |
| 接替会话 | successor `d703b780`（kind=sibling） | 会话层 | — | `demo/c3layer/03-handoff-successor.md` |

分解理由：演示只要求「三层都能干活 + 中间层交接一次」，执行层交付物单一、可
独立验证（文件存在 + 真实命令输出 + done 回流），故只拆一个 worker 点，不设
依赖、不并行，避免把演示做成调度实验。`taskType=default` → `tree_verify` 自动
路由 `self-report` 策略（演示要的是自报链路而非 artifact 取首匹配 md 的边界行为）。

## 4. 派发与执行层结果

- 建点：`tree_node {action:"add"}` → `c3demo-M1a1-worker status=pending_brief`（未传 `session_id`，由派发绑定）。
- 派发：`tree_dispatch {action:"start", leaf_id:"c3demo-M1a1-worker"}` 带完整任务书 prompt。
  引擎返回 `c3demo-M1a1-worker → running`；绑定执行层会话 `63530e9d-3eac-4fcb-9363-6efb456fe7db`。
- 结果：**成功**。第 2 次轮询期间执行层回报 done；`tree_node get` 终态
  `runtime[state=succeeded attempt=1 chain=0 sess=63530e9d]`，`ctx=0%`。
- 执行层真实输出（由其写入 02，非本层代笔）：`node --version` → `v24.20.0`；
  `Get-Date -Format o` → `2026-11-11T15:37:14.7856484+08:00`。
- 未超时、未重派：attempt=1、chain=0（无竹节接力）。

## 5. worker 产物路径

- `demo/c3layer/02-execution.md` —— 实测 **1291 字节 / 819 字符**，含「执行层」字样；
  内容含执行层会话 id、两条真实命令输出、对 `00-root.md` 与 `01-middle.md` 的存在性
  核对与一行摘要（交叉验证：其记录的 01 摘要与本文一致，说明确实读到了上游）。

## 6. 验收结果

- `tree_verify {action:"run", tree_id:"c3demo", leaf_id:"c3demo-M1a1-worker"}` → **PASS（策略 `self-report`）**。
- 机械核对（本层独立复验，不依赖 worker 自述）：文件 1291 字节 ≥ 300、
  含「执行层」、含真实 `node --version`/`Get-Date` 输出、含 00/01 摘要 → 全部满足。
- 说明：`self-report` 策略按协议「执行者自述即过，不能当验收证据」，故本层另做了
  上述文件级复验；`default` 的 DoD 本可写得更紧（artifact-doc），但 artifact 取
  `**/*.md` 字典序首匹配，`demo/c3layer/` 下会被 `00-root.md` 命中而失去意义，
  故保持 `default` + 人工复验。

## 7. 交接（用户明确要求的中间层交棒）

- 真实上下文水位：`session_handoff status` → `context=7.2%`（阈值 50%），
  远低于 42% 竹节阈值 → 已用 `tree_report {action:"context", pct:7}` 自报
  （工具只收整数，7.2 取整；未触发竹节、未换 leaf 会话）。
- 交接调用：`session_handoff {action:"handoff", force:true}`（用户明确要求，非 50% 触发）。
- **successor id：`d703b780-4981-4f66-a7c5-881b3385d51c`**
- **kind：`sibling`**（同父兄弟接替，未降级）
- **HANDOFF 路径：`D:\Codes\dsh-tree-harness\HANDOFF-8fb77300-20261111-153844.md`**
- 继承事实：`preset=standard`、`inherited=session-route`；无 `degraded`、无 `warnings`。
- 协调纪律：`session_handoff` 只换会话，不改 tree-engine 的 `leaf.session_id`（owner
  仍是旧会话 `8fb77300`）。因此 done 由**本会话（owner）**写；接替会话被明确告知
  只做只读核对与回报、不写 done、不动树账本。

## 8. 过程异常（如实记录）

1. `tree_node {action:"add"}` 与 `tree_dispatch {action:"start"}` **首次调用**均返回
   `unknown tool`（瞬时工具注册抖动，非参数问题：同参数原样重试即成功）。按
   tree-commander §5 先认码——此错误不在错误码表内、且与 HTTP/参数无关，判为可重试；
   各重试 1 次成功，无副作用（未产生重复 leaf、未重复派发；重试前已确认 leaf 不存在）。
2. `tree_report {action:"context", pct:7.2}` 被 `E_SCHEMA_INVALID: pct "7.2" must be an
   integer 0-100` 拒；按错误码改为整数 `7` 重报成功（真实 7.2%，非虚报）。

## 9. 最终值速查

- worker：`succeeded` / attempt=1 / chain=0 / sess `63530e9d`
- verify：`PASS (self-report)`
- 产物：`demo/c3layer/02-execution.md`（1291 B）
- 交接：`handed-off`，successor `d703b780`，kind=sibling，HANDOFF `HANDOFF-8fb77300-20261111-153844.md`
- 本层收口：`tree_report done`（owner=`8fb77300`）
