# 三层最小演示 · 中间层接替会话记录（handoff successor）

- 本文件写入者：中间层接替会话（successor of `8fb77300`）
- 采集时间：2026-11-11 15:39:08（+08:00）
- 只读核对，不操作树账本；本文件是本会话唯一写入。

## 1. 继承事实（`self_spec` + `$env:DSH_SESSION_ID` 实测）

| 项 | 值 |
|---|---|
| 本会话 id | `d703b780-4981-4f66-a7c5-881b3385d51c` |
| 前序（已交接）会话 | `8fb77300-3559-453a-9596-b02f4d693b28` |
| 父（根）会话 | `7dd52e8b-a3c2-4481-a9da-8ef94b9a093e` |
| 工作目录 | `D:\Codes\dsh-tree-harness` |
| 模型 / 思考等级 | `opencode-go/deepseek-v4.1-flash` · `max` |
| Agent 预设 | `standard` |
| 权限 | `danger-full-access` / approval `never` · sandbox `danger-full-access` |
| HANDOFF 文件 | `HANDOFF-8fb77300-20261111-153844.md` |

**关键约束**：本会话的 `$env:DSH_TREE_ID` 与 `$env:DSH_LEAF_ID` 均为空，说明接替会话
**不是 leaf owner**（tree leaf owner 仍是旧会话 `8fb77300`）。因此本会话不写 `done`、
不调用 `tree_dispatch` / `tree_report` / `set-status`，与 HANDOFF 的 Decisions 一致。

## 2. 树的只读核对

`tree_status {action:"overview", tree_id:"c3demo"}` → `ok (sweepMode=timer)`；`tree_node list-all` → 3 leaves。

| leaf | 角色 | status | runtime | 上下文 |
|---|---|---|---|---|
| `c3demo-root` | 根（会话自持） | active | 未派发 | 0% |
| `c3demo-M1-commander` | 中间层 commander | active | `state=running attempt=1 chain=0 sess=8fb77300` | 7% |
| `c3demo-M1a1-worker` | 执行层 worker | pending_brief | `state=succeeded attempt=1 chain=0 sess=63530e9d` | 0% |

口径说明（只说事实，不美化）：worker 的正式 `status` 字段仍是 `pending_brief`，但
`runtime.state=succeeded`。结算以 done 事件的 runtime 状态为准（`set-status done` 不在
工具面暴露），所以这与 HANDOFF 记录的「done 且 succeeded」并不矛盾，但字段层面二者
不同，汇报时不应混为一谈。

## 3. 产物核对（哈希 / 字节数 / mtime 实测）

| 文件 | 字节 | sha256（前 16 位） | mtime |
|---|---|---|---|
| `00-root.md` | 1560 | `aee44c6b786db2da` | 2026-11-11T15:34:40 |
| `01-middle.md` | 2500 | `e8799104e7663cd5` | 2026-11-11T15:35:58 |
| `02-execution.md` | 1291 | `04d5613314d8cc8e` | 2026-11-11T15:37:29 |

- `02-execution.md` 确由执行层会话 `63530e9d` 写入，含 `$ node --version` → `v24.20.0`
  与 `Get-Date -Format o` 的真实输出；1291 字节与 HANDOFF 记录一致。
- **可复现性验证**：本会话独立执行 `node --version` 同样得到 `v24.20.0`，与 02 内记录的
  值一致，说明该输出是可复现的真实命令结果，不是编造文本（版本号一致不代表同一进程，
  但排除了「随手写个假版本号」这一常见失真）。
- 00/01/02 三文件由前序会话与执行层会话产出，本会话**未做任何修改**；上表哈希是写本文件
  之前采集的，可作后续比对基线。

## 4. 核对用的原始命令

```powershell
# 哈希 / 字节数 / mtime（写 03 之前采集）
Get-ChildItem 'D:\Codes\dsh-tree-harness\demo\c3layer' -File |
  ForEach-Object { '{0} | {1} bytes | {2} | {3:o}' -f $_.Name, $_.Length,
    (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.LastWriteTime }
node --version
Get-Date -Format o
```

实测尾部输出：

```text
02-execution.md | 1291 bytes | 04d5613314d8cc8e83467b0789560308425eb2cee67d6cc348ad0565de498f28 | 2026-11-11T15:37:29.9022520+08:00
node: v24.20.0
now : 2026-11-11T15:39:08.5278503+08:00
cwd : D:\Codes\dsh-tree-harness
```

## 5. 接管结论

1. **中间层 → 执行层链路成立**：`01-middle.md` 记录了分解与派发（中间层只拆一个 worker 点，
   `taskType=default` → `tree_verify` 路由 `self-report`），`02-execution.md` 由真实执行层会话
   产出且命令输出可复现，worker `runtime.state=succeeded`，树深 2。
2. **中间层交接成立**：`8fb77300` 按用户明确要求以 `force:true` 交接，HANDOFF 文件存在，
   本会话即 successor，已读 HANDOFF 并按其 Next steps 继续（只做核对与回报）。
3. **边界**：本会话不代写根层验收、不改 00/01/02、不碰树账本。`00-root.md` 列出的根层
   验收项（`tree_verify` 记录、`report.md` 汇总、最终验收）仍由根会话 `7dd52e8b` 负责。
4. **待根会话收口的一条提醒**：worker 的 `status` 与 `runtime.state` 不一致（见 §2），
   若根层演示要展示「干净」的状态，应在汇报里明确以 runtime 状态为结算口径，
   而不是声称 leaf 的 `status` 已是 done。
