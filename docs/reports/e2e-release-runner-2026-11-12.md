# 发布前真机 E2E 统一 runner（W2.5，2026-11-12）

> 任务：W2.5 真机 E2E 常态化（项目地图 §9.2 推荐 C）——发布前「一次运行三条真机断言全 PASS 且 artifacts 落盘」。
> 结论：**runner 已落地并离线取证通过**；本次**没有执行真机三断言**（按任务边界：不发起子会话、不消耗模型配额），真机触发在发布时由 Lead/人工执行（§8）。
> 写作用域：只新建 `scripts/e2e/run-release-e2e.mjs` 与本报告，并在 `docs/README.md` §3 加一行索引；三条既有断言脚本、`docs/guides/publishing.md`、包源码均未改动。

## 1. 结论与产出

| 项 | 状态 | 证据 |
|---|---|---|
| runner（零第三方依赖） | 完成 | `scripts/e2e/run-release-e2e.mjs`（v1.0.0） |
| 语法与用法 | PASS | `node --check` exit 0；`--help` exit 0；无参数 exit 2 |
| 离线故障注入 A：不存在的会话 id | PASS（能 FAIL） | 整体 exit 1；`scripts/e2e/artifacts/release-20261111T170038Z.json` |
| 离线故障注入 B：伪造 artifact | PASS（能 FAIL） | replay 一致性检查 1/5 通过，exit 1 |
| replay 正样本（既有 PASS artifacts） | PASS | 2/2 artifacts，exit 0；`scripts/e2e/artifacts/release-20261111T170041Z.json` |
| replay 期望不匹配 + 历史 FAIL artifact | PASS（能 FAIL） | 2/2 FAIL，exit 1；`scripts/e2e/artifacts/release-20261111T170043Z.json` |
| 成功路径落盘（读既有会话日志，非门禁） | PASS | kickoff 0 / collect-skills 0，artifact 与 evidence 正常（§6.6） |
| 文档链接 / 表格检查 | PASS | `LINK CHECK OK` / `TABLE CHECK OK` |
| 真机三条断言 | **未执行（按设计）** | 需真实会话与配额；发布前由 Lead 触发，见 §8 |

关键产出：

1. `scripts/e2e/run-release-e2e.mjs`：串联 `verify-handoff` / `verify-kickoff-language` / `collect-skills`（可选 `summarize-run`），统一落盘 + PASS/FAIL 表 + `--json` 机读。
2. 本报告：参数表、流水线、artifacts 布局、故障注入证据、真机触发方式与边界。
3. 三条既有脚本语义未变：runner 只以子进程方式调用，不复制其解码/断言逻辑（避免出现第二事实源）。
4. 发布记录可直接引用：`artifacts.release-<ts>.json` + 终端 PASS/FAIL 表。

## 2. 背景与设计取舍

现状是三条脚本各自独立、参数手工拼、结果不汇总：`verify-handoff.mjs`（接替会话继承/归属，多帧 zstd + projcache + workspace.json）、`verify-kickoff-language.mjs`（接替首条 `user/message` 语种）、`collect-skills.mjs`（会话可见 skill 列表，可加 `summarize-run.mjs` 看工具/分层/交接序列）。发布前需要一次运行、一次判定、一份留证。

设计取舍：

- **只编排、不复制**：runner 不重写解码与断言逻辑，子脚本升级自动受益；三条脚本的退出码语义原样传递（0 = PASS，1 = FAIL，2 = 无法判定）。
- **判定以 (退出码 + artifact) 为准**：`exit 0` 但预期 artifact 缺失/不可解析也判 FAIL——发布门禁要求「artifacts 落盘」，不能让「跑了但没留证」算过。
- **证据保真**：每个子脚本的 stdout/stderr 全量落 `raw/`，汇总只放摘要与关键引用；失败时终端 `FAILURE DETAIL` 指明是哪条断言、哪个失败项。
- **零会话副作用**：runner 只 spawn 本机 `node` 子进程跑只读脚本；不发起 DSH 会话、不写 profile、不改仓库脚本。
- **零第三方依赖**：只用 `node:child_process` / `node:fs` / `node:path` / `node:os` / `node:url`；默认用 `process.execPath`（谁启动 runner 就用哪个 node，bundled node 亦可）。

## 3. 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `--source <sessionId>` | 无（必填） | 被交接的源会话 id，允许带/不带 `session-` 前缀 |
| `--successor <sessionId>` | 无（必填） | 接替会话 id |
| `--expect-kind root 或 sibling` | `root` | 传给 `verify-handoff` 的期望接替类型 |
| `--expect-lang zh 或 en` | `zh` | 传给 `verify-kickoff-language` 的期望语种 |
| `--skill-session <sessionId>` | 等于 `--successor` | `collect-skills`（及 `--summarize`）的目标会话 |
| `--wait <ms>` | `0` | 传给 `verify-handoff` 的等待；默认 0 = 快速失败，真机建议 `120000` |
| `--json` | 关 | 仅输出汇总 JSON 到 stdout（文件照常落盘） |
| `--artifacts-dir <dir>` | `scripts/e2e/artifacts/release-<ts>/` | 子 artifacts 目录；汇总固定为「目录去尾分隔符 + `.json`」 |
| `--summarize` | 关 | 追加 `summarize-run.mjs`（信息性，失败不改变整体判定） |
| `--fail-fast` | 关 | 首个必需断言失败即停，其余标 `SKIP` |
| `--timeout <ms>` | `180000` | 单个子脚本超时；超时按 FAIL 记录（防挂住） |
| `--replay <artifact.json>` | 无 | 离线复核既有 JSON artifact，可重复；**不能替代真机断言** |
| `--help` / `-h` | — | 打印用法，exit 0 |

用法错误（缺参数、非法枚举值、`--replay` 文件不存在）→ stderr 打 `usage:` + exit 2，不执行任何子脚本。

## 4. 断言流水线

顺序执行，任一必需步骤失败 → 整体 exit 1（默认继续跑完其余步骤以收集完整证据，`--fail-fast` 可提前停）。

| 序 | 步骤 id | 调用 | 断言内容 | artifact |
|---|---|---|---|---|
| 1 | `verify-handoff` | `verify-handoff.mjs --source --successor --expect-kind --wait --json --out` | cwd / 工作区归属 / 首帧权限·sandbox·approval / request-header / agentPreset / 工具数 / 交接提示点名 source / HANDOFF 读取证据 | `<dir>/verify-handoff.json` |
| 2 | `verify-kickoff-language` | `verify-kickoff-language.mjs --session --expect --json` | 接替首条 `user/message` 语种 == 期望；并记录是否点名 HANDOFF 文件 | `<dir>/verify-kickoff-language.json` |
| 3 | `collect-skills` | `collect-skills.mjs --session --json --out` | 会话 catalog 含默认三个目标 skill（tree-commander / tree-worker / session-handoff）；给 atCreation/latest/evolution/skillLoads | `<dir>/collect-skills.json` |
| 4（可选） | `summarize-run` | `summarize-run.mjs --session --json --out` | 工具序列 / 分层 / 交接序列（仅信息，不参与判定） | `<dir>/summarize-run.json` |

判定映射：

| 子脚本退出码 | 步骤状态 | 对整体 |
|---|---|---|
| 0 且 artifact 已解析 | `PASS` | 通过 |
| 1 | `FAIL` | exit 1 |
| 2（日志缺失/无法判定） | `UNJUDGEABLE` | exit 1 |
| 超时或 spawn 失败 | `TIMEOUT` / `FAIL` | exit 1 |
| 0 但预期 artifact 缺失 | `FAIL` | exit 1（防「跑了没留证」） |

## 5. artifacts 布局

```text
scripts/e2e/artifacts/
├─ release-<ts>/                        # 默认子 artifacts 目录（同名 dir 已存在时自动 -2 后缀）
│  ├─ verify-handoff.json               # verify-handoff --out
│  ├─ verify-kickoff-language.json      # 由 --json stdout 落盘（解析失败时保留 raw_stdout/raw_stderr）
│  ├─ collect-skills.json               # collect-skills --out
│  ├─ summarize-run.json                # 仅 --summarize
│  └─ raw/
│     ├─ <step>.stdout.txt              # 原始输出（全量，证据保真）
│     └─ <step>.stderr.txt
└─ release-<ts>.json                    # 汇总：目录名 + .json（--artifacts-dir 自定义时同样规则）
```

`<ts>` 为 UTC 秒级时间戳（如 `20261111T170038Z`），与既有 `*-1604Z.json` 命名习惯一致。

汇总 JSON 关键字段：

| 字段 | 内容 |
|---|---|
| `tool` / `version` / `mode` / `real_machine` | 固定 `release-e2e`；`mode=live` 或 `replay`；`real_machine` 区分真机与离线 |
| `timestamp` / `node` / `dsh_home` / `repo_root` | 运行环境 |
| `params` | 全部入参 + `artifacts_dir` / `summary`（仓内给相对路径） |
| `steps[]` | 每步 `exitCode` / `pass` / `status` / `artifact` / `artifactWritten` / `evidence` / `stderr_first` / `raw`（stdout/stderr 路径） |
| `overall` | `verdict`、必需步数、通过/失败/跳过、`exitCode`、`optional_failed` |
| `artifacts.files` / `declared` / `raw` | 实际写出的文件、声明位置（含未产出者）、原始日志路径 |
| `notes[]` | 运行口径（不发起会话、wait 语义、退出码映射等） |

`evidence` 是该步的「关键证据引用」：handoff 记录 `pass/total`、失败断言 id+expected/actual、三个日志/注册表路径；kickoff 记录 `language/expect/seq/excerpt`；collect-skills 记录每会话 `missing/latestCount/skillLoads` 与日志路径；summarize 记录会话/树/节点/交接计数。

## 6. 离线取证（本次实测）

环境：Windows，`node v24.21.0`（bundled），`DSH_HOME=C:\Users\sir_c\.dsh`，仓库 `master e09f39b`。

### 6.1 语法与用法

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --check scripts/e2e/run-release-e2e.mjs          # exit 0
& $node scripts/e2e/run-release-e2e.mjs --help           # exit 0（4536 bytes 用法）
& $node scripts/e2e/run-release-e2e.mjs                  # exit 2（不执行）
```

无参数时 stderr：

```text
release-e2e: --source and --successor are required (or use --replay <artifact.json>)
usage: node scripts/e2e/run-release-e2e.mjs --source <id> --successor <id> [--expect-kind root|sibling] ...
```

其余负路径同样 exit 2：`--expect-kind bogus` → `--expect-kind must be root|sibling, got bogus`；`--replay nope.json` → `--replay file(s) not found: nope.json`。

### 6.2 故障注入 A：不存在的会话 id（快速失败，不挂住）

```powershell
& $node scripts/e2e/run-release-e2e.mjs --source 00000000-0000-4000-8000-000000000000 `
  --successor 11111111-1111-4111-8111-111111111111 --wait 2000
```

实测：**exit 1，耗时约 3.3 s**（`--wait 2000` 下两个日志缺失仍快速返回，未挂住），原始输出：

```text
RESULT      STEP                      EXIT  EVIDENCE
UNJUDGEABLE verify-handoff            2     not judged (see stderr)
UNJUDGEABLE verify-kickoff-language   2     not judged (see stderr)
FAIL        collect-skills            1     sessions 0/1 ok; missing: tree-commander, tree-worker, session-handoff

FAILURE DETAIL
- verify-handoff (exit 2): UNJUDGEABLE
    脚本在写出 artifact 前退出（无 JSON 可汇总），见 stderr
    stderr: verify-handoff: source session log not found for 00000000-0000-4000-8000-000000000000 under C:\Users\sir_c\.dsh\sessions
- verify-kickoff-language (exit 2): UNJUDGEABLE
    stderr: no session log found for 11111111-1111-4111-8111-111111111111 (workspace encoding may differ)
- collect-skills (exit 1): FAIL
    session 11111111-1111-4111-8111-111111111111: missing tree-commander, tree-worker, session-handoff (no session log)

SUMMARY: FAIL (0/3 required PASS) -> scripts/e2e/artifacts/release-20261111T170038Z.json
```

落盘证据（仓内，未提交）：

- `scripts/e2e/artifacts/release-20261111T170038Z.json`（8359 B）：`overall.verdict=FAIL`、`exitCode=1`、`required=3 / passed=0 / failed=3`；每步 `evidence` 带失败原因与 `stderr_first`。
- `scripts/e2e/artifacts/release-20261111T170038Z/`：`collect-skills.json`（845 B）、`verify-kickoff-language.json`（raw 包装，exit 2 时无可用 JSON）、`raw/*.stdout.txt` / `raw/*.stderr.txt`（例如 `verify-handoff.stderr.txt` 121 B 即上面那行）。

结论：三条断言各自失败都被点名、整体非 0、证据落盘，满足「故障注入能 FAIL」。

### 6.3 故障注入 B：伪造/自相矛盾的 artifact（replay 拦截）

伪造 `%TEMP%\fake-handoff-artifact.json`：`summary` 自称 `PASS`、`total=14 pass=13 fail=1`，但 `assertions` 只有 2 条且其中 `tools_count` 为 fail。用自定义目录复核：

```powershell
& $node scripts/e2e/run-release-e2e.mjs --replay "$env:TEMP\fake-handoff-artifact.json" --artifacts-dir "$env:TEMP\rel-e2e-fake"
```

实测 **exit 1**，输出：

```text
RESULT      KIND                    CHECKS   ARTIFACT
FAIL        verify-handoff          1/5      C:\Users\sir_c\AppData\Local\Temp\fake-handoff-artifact.json

FAILURE DETAIL
- verify-handoff: C:\Users\sir_c\AppData\Local\Temp\fake-handoff-artifact.json
    total-consistent: summary.total=14 assertions=2
    count-consistent: stored=13/1 recomputed=1/1
    verdict-consistent: stored=PASS
    assertions-pass: failed: tools_count

SUMMARY: FAIL (0/1 artifacts re-evaluated) -> C:\Users\sir_c\AppData\Local\Temp\rel-e2e-fake.json
```

同时验证了 `--artifacts-dir` 覆盖：子文件（`replay.json`）落在自定义目录，汇总按「目录 + .json」落到 `rel-e2e-fake.json`。

### 6.4 replay 正样本（既有 artifacts 可离线复核）

既有 `scripts/e2e/artifacts/e2e-fixed-root-55543cfc.json`（root，14/14 PASS）与 `e2e-fixed-sibling-da32ce81.json`（sibling，12/12 PASS）是历史真机取证，可直接离线复核：

```powershell
& $node scripts/e2e/run-release-e2e.mjs `
  --replay scripts/e2e/artifacts/e2e-fixed-root-55543cfc.json `
  --replay scripts/e2e/artifacts/e2e-fixed-sibling-da32ce81.json
```

实测 **exit 0**：

```text
RESULT      KIND                    CHECKS   ARTIFACT
PASS        verify-handoff          5/5      scripts/e2e/artifacts/e2e-fixed-root-55543cfc.json
PASS        verify-handoff          5/5      scripts/e2e/artifacts/e2e-fixed-sibling-da32ce81.json

SUMMARY: PASS (2/2 artifacts re-evaluated) -> scripts/e2e/artifacts/release-20261111T170041Z.json
```

replay 的 5 项检查：`summary` 存在、`total` 与断言数一致、`pass/fail` 与逐条重算一致、`verdict` 与重算一致、断言全 PASS（若显式传 `--expect-kind` 还会核对 artifact 内的期望一致）。

### 6.5 replay 负样本：历史 FAIL artifact + 期望不匹配（`--json` 机读）

```powershell
& $node scripts/e2e/run-release-e2e.mjs `
  --replay scripts/e2e/artifacts/e2e-baseline-crosscheck-b9d5bacc-to-887b8cd1.json `
  --replay scripts/e2e/artifacts/e2e-fixed-root-55543cfc.json `
  --expect-kind sibling --json
```

实测 **exit 1**，stdout 只有 JSON（117 行；无 PASS/FAIL 表混入）。两处失败都被点名：

- 历史基线 `e2e-baseline-crosscheck`：`summary.verdict=FAIL`（4/12），`assertions-pass` 列出 8 个失败断言（`workspace_attribution`、`first_frame_permission_preset`、`first_frame_sandbox_mode`、`first_frame_approval_policy`、`agent_preset`、`tools_count`、`handoff_prompt_names_source`、`handoff_file_read`）；同时 `expect-kind-match: artifact=root requested=sibling` 不符。
- `e2e-fixed-root`：自身 14/14 自洽，但 `expect-kind-match` 不符（artifact 是 root，本次要求 sibling）→ 整体 FAIL。

落盘：`scripts/e2e/artifacts/release-20261111T170043Z.json` 与目录内 `replay.json`；`overall.verdict=FAIL`、`replayed=2 / passed=0 / failed=2`。

> **边界标注（重要）**：replay 只复核既有 JSON 的存储判定与内部一致性，**不读取会话日志、不产生新证据，不能替代真机断言**。发布门禁仍以真机三断言 PASS 为准；replay 的用途是离线回归 runner/证据自洽性（CI 可跑）。

### 6.6 成功路径落盘验证（读本机既有会话日志，不发起会话）

故障注入只能证明「会 FAIL」。为确认成功路径的 artifact 写入与 evidence 解析，用本机既有会话日志做一次只读 drill（**不新建会话、不消耗配额**）。该会话不是 handoff successor，所以 handoff 步按设计 UNJUDGEABLE，只验证另外两步的成功链路：

```powershell
& $node scripts/e2e/run-release-e2e.mjs --source 00000000-0000-4000-8000-000000000000 `
  --successor 49f74cab-2f5d-42b6-bfbf-ab180f5b6ad4 --artifacts-dir "$env:TEMP\rel-e2e-partial2"
```

```text
RESULT      STEP                      EXIT  EVIDENCE
UNJUDGEABLE verify-handoff            2     not judged (see stderr)
PASS        verify-kickoff-language   0     language=zh expect=zh seq=10
PASS        collect-skills            0     sessions 1/1 ok; missing: none

SUMMARY: FAIL (2/3 required PASS) -> C:\Users\sir_c\AppData\Local\Temp\rel-e2e-partial2.json
```

落盘：`verify-kickoff-language.json`（621 B，`language=zh / expect=zh / pass=true / first_message_seq=10`）与 `collect-skills.json`（3217 B，1/1 会话命中三个目标 skill），证明「子脚本 exit 0 → runner 落 artifact → evidence 可解析」这条成功链路成立。**该 drill 不是发布门禁证据**（临时目录、源会话为占位 id）；真机三断言仍需按 §8 触发。

### 6.7 文档检查

```powershell
& $node scripts/check-doc-links.mjs
& $node scripts/check-md-tables.mjs
& $node scripts/check-md-tables.mjs docs/reports/e2e-release-runner-2026-11-12.md docs/README.md
```

结果：`LINK CHECK OK`（69 files，跳过 4 个历史 artifacts）、`TABLE CHECK OK`（注意：`check-md-tables.mjs` 无参数时不检查任何文件，因此本报告与 `docs/README.md` 额外显式传入复核）。

## 7. 与既有 artifacts 的配合方式

- **真机运行**：每次产出一套新的 `release-<ts>/` + `release-<ts>.json`，不覆盖历史；同一秒重复运行自动加 `-2` 后缀。
- **离线复核**：任何 `verify-handoff` / `collect-skills` / `kickoff-language` / `release-e2e` 的 JSON 都可用 `--replay` 重新判定；历史 PASS 样本（`e2e-fixed-root` / `e2e-fixed-sibling`）可作回归锚点。
- **反向核对**：`e2e-baseline-*` 这类历史 FAIL artifact 可用于验证「replay 不会把 FAIL 洗成 PASS」。
- **发布记录**：贴 `release-<ts>.json` 路径 + PASS/FAIL 表（3 条必需，可选第 4 行 `summarize-run`）即可（`--json` 给机器，`real_machine` 字段区分真机/离线）。

## 8. 真机执行的触发方式（发布前由 Lead/人工）

1. 让被测会话完成一次 `session_handoff`（root 或 sibling），等接替会话跑完首轮、日志落盘。
2. 记录源会话 id 与接替会话 id（允许 `session-` 前缀）。
3. 执行：

   ```powershell
   & $node scripts/e2e/run-release-e2e.mjs --source <sourceId> --successor <successorId> `
     --expect-kind root --expect-lang zh --wait 120000
   ```

   - 语种基线为英文时用 `--expect-lang en`；sibling 接替用 `--expect-kind sibling`。
   - 想同时看工具/分层/交接序列：加 `--summarize`（失败不影响判定）。
   - 接替会话与 skill 采集目标不同：加 `--skill-session <id>`。
4. 三条必需断言全 PASS 且 artifacts 落盘 → 整体 exit 0；把 `artifacts.release-<ts>.json` 路径与 PASS 表写入发布记录。任一 FAIL/UNJUDGEABLE → exit 1，按 `FAILURE DETAIL` 修复后用新时间戳重跑（保留失败 artifact）。
5. `docs/guides/publishing.md` §6 的检查清单条目由另一个 leaf 统一添加，命令固定为 `node scripts/e2e/run-release-e2e.mjs`（本报告不修改该文件）。

## 9. 已知边界与风险

- **真实会话依赖**：真机断言需要 `<DSH_HOME>/sessions/<workspace-encoded>/<id>/session.v4.jsonl.zstd` 已存在；workspace 编码目录不同会直接 exit 2（不会挂起）。
- **模型配额 / 429**：真机链路可能 429 或首轮未完成；runner 不重试（失败即证据），由人重跑；沿用地图 §9.2 推荐 C——发布前人工触发、CI 不跑真机。
- **wait 只作用于 verify-handoff**：另外两条脚本无等待参数；`--wait` 默认 0 让错误 id 快速失败，真机发布建议 `120000`。
- **超时护栏**：`--timeout` 默认 180 s，防止日志未落盘时无限等待；超时按 FAIL 记录并保留已捕获输出。
- **collect-skills 默认期望**是三个目标 skill（runner 未改语义）；只清点不判定时请直接调 `collect-skills --no-default-expect`。
- **replay 的局限**：只验 JSON 自洽，不重新解码会话日志；伪造得足够自洽的 artifact 无法被 replay 识别——它只是离线回归工具。
- **未提交的 artifacts**：本次 drill 产出的 `release-20261111T170038Z` / `release-20261111T170041Z` / `release-20261111T170043Z`（目录 + 同名 `.json`）是 untracked 运行产物；若不入库，链接式引用会失效，报告中以行内代码路径引用。
- **并发写**：本 leaf 与其它 wave2 leaf 共用同一工作树；runner 只写自己的 artifacts 目录，不触碰他人文件。

## 10. 复现命令汇总

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

# 语法 / 用法
& $node --check scripts/e2e/run-release-e2e.mjs
& $node scripts/e2e/run-release-e2e.mjs --help

# 故障注入（快速失败，exit 1）
& $node scripts/e2e/run-release-e2e.mjs --source 00000000-0000-4000-8000-000000000000 `
  --successor 11111111-1111-4111-8111-111111111111 --wait 2000

# replay 正样本（exit 0）
& $node scripts/e2e/run-release-e2e.mjs `
  --replay scripts/e2e/artifacts/e2e-fixed-root-55543cfc.json `
  --replay scripts/e2e/artifacts/e2e-fixed-sibling-da32ce81.json

# replay 负样本（exit 1，机读）
& $node scripts/e2e/run-release-e2e.mjs `
  --replay scripts/e2e/artifacts/e2e-baseline-crosscheck-b9d5bacc-to-887b8cd1.json `
  --expect-kind sibling --json

# 真机（发布前，由 Lead/人工触发）
& $node scripts/e2e/run-release-e2e.mjs --source <sourceId> --successor <successorId> `
  --expect-kind root --expect-lang zh --wait 120000
```
