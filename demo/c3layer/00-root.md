# 三层最小演示 · 根层记录（root）

- 树：`c3demo`（root leaf `c3demo-root`）
- 根会话：`7dd52e8b-a3c2-4481-a9da-8ef94b9a093e`（cwd：`D:\Codes\dsh-tree-harness`）
- 用户要求（原话）：根会话→中间层→执行层三层都能干活，并在中间层交接一次。
- 演示分层与产物：
  1. **根层（本会话）**：建树、建中间层节点并派发；写本文件；最终验收 + `report.md` 汇总。
  2. **中间层（commander，`c3demo-M1-commander`）**：写 `01-middle.md`；在本层下建执行层 worker 并派发；收割 + `tree_verify`；完成一次 `session_handoff`（force，用户明确要求）。
  3. **执行层（worker，`c3demo-M1a1-worker`）**：写 `02-execution.md`；用 `tree_report done` 登记完成。
  4. **中间层接替会话（handoff successor）**：读 HANDOFF，核对产物，写 `03-handoff-successor.md` 并向根会话回报。
- 根层验收标准：
  - 树深 = 2（`c3demo-root` → `c3demo-M1-commander` → `c3demo-M1a1-worker`）。
  - 根层与中间层两个会话都执行过 `tree_dispatch start`（每层都能继续分层）。
  - 执行层有 `done` 上报；worker 有 `tree_verify` 记录。
  - 中间层 `session_handoff` 返回 `handed-off` 且拿到 successor。
  - `01-middle.md`、`02-execution.md`、`03-handoff-successor.md` 均存在。
- 备注：中间层交接是**用户明确要求**的演示交接（非上下文 50% 触发），因此允许 `force:true`；竹节接力不参与本轮。
- 时间：2026-11-11 15:34（+08:00）
