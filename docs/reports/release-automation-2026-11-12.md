# 发布自动化（W2.7）实现与演练记录

> 日期：**2026-11-12** · 任务：W2.7 发布自动化（一条命令）+ `publishing.md` 更新
> 基线：本仓 `master` `e09f39b` · 包 `@orphiczhou/dsh-session-tree@1.3.6` · 公开镜像 `orphiczhou/dsh-session-tree` 的 `main` + tag `v1.3.6` = `298298d`
> 结论：`scripts/release-all.mjs` 已实现并在**隔离沙箱**完成全链路本地演练（同步 / SHA 对账 / 本仓 commit / 镜像 commit + tag / no-op 判定）；**未执行任何真实推送、未提交本仓 git**，发布由 Lead 在最终 bump 后以 `--push` 执行。
> 关联：[发布流程 §5.1](../guides/publishing.md) · [版本一致性脚本](../../scripts/check-version-consistency.mjs)（W2.4）· [发布 E2E runner](../../scripts/e2e/run-release-e2e.mjs)（W2.5）

## 1. 实现摘要

新建 `scripts/release-all.mjs`（纯 ESM、零第三方依赖），把 `publishing.md` §5 的人工流程串成一条命令：

| 步骤 | 动作 | 写操作 |
|---|---|---|
| 0 预检 | 仓库根 / 分支 = `master` / `origin` 校验 / 工作树状态 / 包与版本 / 镜像 checkout（`main`、clean、remote、tag）/ `release-plugin --check` 内容对账 / 版本推进（D6）/ 可选 `check-version-consistency.mjs` / 测试计划 | 无（`--check` 只读） |
| 2 同步 | `release-plugin --check` → `--prune`（同步）→ `--check` 复核；要求 `files=N match=N mismatch=0 missing=0 extra=0` 且 `RESULT: OK` | 镜像工作树 |
| 3 本仓 | `git add -A` + `git commit -m "feat/release: <pkg> vX.Y.Z — <摘要>"`；仅 `--push` 时 `git push origin master` | 本仓本地提交/远端 |
| 4 镜像 | `git -C <mirror> add -A` + `sync: <pkg>@<ver> …` commit + `tag vX.Y.Z`；仅 `--push` 时 push `main` 与 tag | 镜像提交/tag/远端 |
| 5 核对 | `git ls-remote origin refs/heads/master`、`git ls-remote <mirror> refs/heads/main refs/tags/vX.Y.Z` 必须与本地一致 | 无 |

- **模式**：默认 `--dry-run`（只读）；`--skip-push` / `--apply` 执行本地全链路但不推送；只有显式 `--push` 才联网写远端。
- **失败即停**：任一步非 0 立即停止，打印「已完成步骤 / 下一步人工处置 / 回滚命令」；失败发生在写操作前时明确写「仓库与镜像均未改变」。回滚提示按实际已完成的提交/tag 生成（`git reset --soft`、`git tag -d`、已推送时改用 `git revert`、远端 tag 删除警告等）。
- **版本纪律（D6）**：内容有变化但 `version` 未 bump → 真实运行在预检阶段拒绝（exit 1）；内容无变化且版本等于镜像 tag → 「包内容无变化不需要发布」no-op。
- **工作树语义**：发布提交本身承载待发内容（step 3 `git add -A`），因此默认把未提交改动列为 WARN 并逐条打印（`--require-clean` 可改为门禁）；未合并冲突仍是硬门禁。镜像 checkout 则要求 clean，唯一例外是**上一次失败运行遗留的、与源内容完全一致的同步产物**（可恢复续跑）。
- **Windows 行尾**：fresh clone 常见 CRLF checkout，会让 `release-plugin --check` 报全部 `MISMATCH`；预检对 mismatch 文件做「LF 归一后」复核，只有行尾差异时按内容一致处理（sync 会写回 LF），避免误判版本门禁。
- **凭据纪律**：`GH_TOKEN` 只在 push 时从进程 env 或 `[Environment]::GetEnvironmentVariable('GH_TOKEN','User')` 读入内存；经子进程环境变量 `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` 注入 `http.extraheader`（git ≥ 2.31），**不写 git config、不进 argv、不打印、不写 remote URL**；所有子进程输出统一 redact。检测到代理且网络失败时，按 agent.md 约定用 `-c http.proxy=` 直连重试一次。
- **不改 profile**：脚本不安装/重载插件、不修改用户 profile。

`--help` 列出的参数：`--dry-run`、`--skip-push` / `--apply`、`--push`、`--mirror-dir`、`--pkg`、`--skip-tests`、`--summary`、`--require-clean`。

## 2. 演练环境与边界

- Node：bundled `v24.21.0`；Git for Windows；工作目录 `D:\Codes\dsh-tree-harness`。
- 镜像 checkout：临时目录中 `git clone https://github.com/orphiczhou/dsh-session-tree.git`（`main` = `298298d`，tag `v1.3.6`；演练后核对仍为 pristine）。
- 沙箱：`git archive HEAD`（`e09f39b`）导出到临时目录 + `git init -b master` + 假 origin（真实 URL，但全程未 push），脚本副本与镜像都在临时目录；**未在真实仓执行任何写模式**。
- 真实仓演练时的并发事实：同一 wave 的其他 leaf 正在改 `packages/dsh-tree-engine/*`、`packages/dsh-session-tree/test/provider-conformance.cjs`、`docs/*` 等（工作树 20+ 项未提交改动），因此真实仓 dry-run 会命中「版本未 bump」与「一致性脚本失败」两个 GATE——这是预期的最终发布前置条件，不是 W2.7 缺陷。
- 未执行：`--push`、真实 `git commit/tag/push`、profile 变更、包源码/`package.json` 修改。

## 3. 演练命令与原始输出摘要

### 3.1 语法 / 导入

```powershell
node --check scripts/release-all.mjs
node -e "import('./scripts/release-all.mjs').then(()=>console.log('IMPORT OK'))"
```

结果：两条命令均 **exit 0**，输出 `IMPORT OK`（模块有 main 守卫，`import` 不执行发布）。

凭据注入形状（单测式检查、不联网、不打印 token）：

```text
gitEnv('dummy-token-for-test') →
  GIT_CONFIG_COUNT=1 / GIT_CONFIG_KEY_0=http.extraheader /
  GIT_CONFIG_VALUE_0 以 "Authorization: Basic " 开头 /
  环境 JSON 不含明文 token / GIT_TERMINAL_PROMPT=0
TOKEN ENV INJECTION OK (argv untouched, plaintext absent)   # exit 0
```

### 3.2 真实仓 dry-run（必做证据）

```powershell
node scripts/release-all.mjs --dry-run --mirror-dir <temp>\mirror
```

结果：**exit 0**；本仓 HEAD `e09f39b…` 与镜像 HEAD `298298d…` 前后均未变（无 git 写）。输出含完整 5 步计划与预检结果，关键行：

```text
  [OK] 仓库根 D:\Codes\dsh-tree-harness
  [OK] 分支 master
  [OK] origin orphiczhou/dsh-tree-harness
  [WARN] 工作树有 26 项未提交改动：将随「本仓 git add -A」进入发布提交（--require-clean 可改为拒绝）
  [OK] 包 @orphiczhou/dsh-session-tree@1.3.6（19 个文件）
  [OK] 镜像 orphiczhou/dsh-session-tree @ 298298d（分支 main，最新 tag v1.3.6）
  [WARN] 内容对账 files=19 match=0 mismatch=19 missing=0 extra=0（与镜像有实质差异）
  [OK] 镜像工作树 clean
  [GATE] 版本未 bump：包内容已变化但 version 仍为 1.3.6（镜像 tag v1.3.6）→ 先 bump packages/dsh-session-tree/package.json 的 version（D6），再重跑
  [GATE] scripts/check-version-consistency.mjs 失败（exit 1）
  [OK] 测试计划 5 条（dry-run 只打印，实跑执行）
== DRY-RUN RESULT ==
BLOCKED — 2 个发布门禁未通过；真实运行会在任何写操作之前停止（exit 1）
DRY-RUN: 未写入任何文件、未运行 git 写命令、未读取 GH_TOKEN。
```

说明：`mismatch=19` 是 Windows CRLF checkout 噪声（18 个文件仅行尾差异）+ 1 个真实内容改动（并发 leaf 修改的 `test/provider-conformance.cjs`）；脚本已按 LF 归一识别。`check-version-consistency.mjs` 的失败来自并发未完成改动（tree-engine 正在 bump），发布前最终态应通过。

### 3.3 失败路径：镜像目录不存在

```powershell
node scripts/release-all.mjs --dry-run --mirror-dir <temp>\no-such-mirror
```

结果：**exit 1**（结构性错误，任何写入之前停止）；关键行：

```text
release-all: FAILED
步骤: 预检
原因: 镜像 checkout 不存在: …\no-such-mirror
已完成: 无（尚未进入写操作）
下一步人工处置: 先 clone：git clone https://github.com/orphiczhou/dsh-session-tree.git "…"，并确认分支 main。
回滚命令（按需、按反向顺序；执行前先确认目标路径与 SHA）:
  - 无自动回滚动作：失败发生在任何写操作之前（预检/测试/门禁），本仓与镜像均未改变。
```

### 3.4 沙箱：内容变化但版本未 bump → 拒绝

沙箱内修改包文件、保持 `version=1.3.6`（镜像 tag `v1.3.6`），执行 `--skip-push --skip-tests`：

```text
  [WARN] 内容对账 files=19 match=17 mismatch=2 missing=0 extra=0（与镜像有实质差异）
  [GATE] 版本未 bump：包内容已变化但 version 仍为 1.3.6（镜像 tag v1.3.6）→ 先 bump …（D6），再重跑
release-all: FAILED
原因: 版本未 bump：…
已完成: 无（尚未进入写操作）
=== exit=1 ===
```

核对：沙箱提交数不变、镜像 HEAD 不变、镜像工作树 clean（**0 写入**）。

### 3.5 沙箱：bump 后 `--skip-push` 全链路（不推送）

沙箱 `version` bump 到 `1.3.7` 后执行：

```powershell
node scripts/release-all.mjs --skip-push --skip-tests --mirror-dir <temp>\mirror
```

结果：**exit 0**，关键行：

```text
  [OK] 版本推进 v1.3.6 → v1.3.7
== 步骤 2: 同步 packages → 镜像（release-plugin，单向 + SHA-256） ==
  [OK] 同步完成：files=19 match=19 mismatch=0 missing=0 extra=0（SHA-256 全部一致）
== 步骤 3: 本仓提交（不推送） ==
  [OK] 本仓提交 07e66ae → 7840604
  [SKIP] 未推送本仓（未给 --push）
== 步骤 4: 镜像仓提交 + tag v1.3.7（不推送） ==
  [OK] 镜像提交 298298d → bfe3825
  [OK] 已创建 tag v1.3.7
  [SKIP] 未推送镜像（未给 --push）
== 步骤 5: 远端核对（ls-remote） ==
  [SKIP] 未推送（未给 --push）：跳过远端核对；本地提交/tag 已生成。
== 发布完成 ==
  提示: 本次为本地演练（未给 --push），未联网写远端；发布时由 Lead 用 --push 执行。
```

「未推送」的外部验证：发布后对公开仓 `ls-remote` 仍为 `298298d refs/heads/main`，`refs/tags/v1.3.7` **不存在**；镜像本地 `tag v1.3.7` = 新镜像 HEAD。

### 3.6 沙箱：READY dry-run 与发布后 no-op

- bump 到 `1.3.8` 后 dry-run：`[OK] 版本推进 v1.3.6 → v1.3.8`、`DRY-RUN RESULT: READY`、**exit 0**，沙箱与镜像 HEAD 均未变。
- 已发布 `v1.3.7` 后 dry-run：`[OK] 包内容无变化不需要发布（版本 1.3.7 = 镜像 tag v1.3.7，SHA 全一致）`、`NO-OP`、**exit 0**、0 写入。

### 3.7 演练中发现的真实边界（已修）

首次沙箱 `--skip-push` 执行在镜像 commit 时失败：fresh clone 没有 `user.name/user.email`（`Author identity unknown`，exit 128）。该次失败正确打印了「已完成：2 同步 + 3 本仓提交」以及 `git reset --soft` / 镜像 `checkout -- . + clean -fd` 回滚提示；修复方式：

1. 预检增加本仓与镜像的 `git var GIT_AUTHOR_IDENT` 门禁，缺失时提前给出配置命令（不再等到 commit 才失败）；
2. 允许**可恢复续跑**：镜像工作树若只有「上次失败运行同步出的、与源内容完全一致」的未提交改动，则允许继续提交（其余 dirty 仍为门禁）。

配置临时镜像身份后重跑成功；沙箱源仓出现两条同版本 release commit（第一次失败 + 重试），属演练重试记录，真实发布前由 Lead 只执行一次。

## 4. 未执行真实推送的说明

- 本 leaf 的写作用域只允许新增脚本与文档；**没有**执行 `git commit/tag/push`、没有改 `package.json`、没有改 profile。
- `--push` 分支未在真实仓/真实镜像上执行（token 未读取、未打印）；首次真实发布由 **Lead** 在以下条件满足后执行：
  1. 全量测试与 `check-version-consistency.mjs` / `run-release-e2e.mjs` 通过；
  2. `packages/dsh-session-tree/package.json` 已 bump（D6）；
  3. 镜像 checkout 干净、`main`、已配置 git 身份；
  4. User 环境变量 `GH_TOKEN` 可用；
  5. `node scripts/release-all.mjs --dry-run --mirror-dir <dir>` 显示 `READY`。
- 正式命令：`node scripts/release-all.mjs --push --mirror-dir <镜像 checkout>`；失败时按脚本打印的回滚提示处理（本报告 §1）。

## 5. 已知边界

1. **市场 listing 不自动化**：awesome-dsh-plugin / imsai-sh 的版本/安装方式变化仍需人工提 PR（D3/D6 现状）。
2. **tag 不覆盖**：镜像已存在同版本 tag 且指向不同 commit 时硬失败，要求人工确认；不自动 force/覆盖已发布 tag。
3. **Git 身份是前置条件**：镜像 checkout 必须已有 `user.name/user.email`（fresh clone 常见缺失）；脚本在预检给出明确门禁。
4. **Windows 行尾**：CRLF checkout 下 `--check` 的 mismatch 可能是纯行尾差异；脚本按 LF 归一判定，但 `--check` 原始输出仍会显示 mismatch（sync 后字节一致）。
5. **dry-run 语义**：dry-run 只做只读预检；即使有 GATE 也 exit 0（打印 `BLOCKED`），结构性错误（如镜像目录不存在）才 exit 1。这是为了让演练不因「尚未 bump」而中断。
6. **`--skip-push` 会写本地**：它执行同步 + 本地 commit/tag（不推送），只应在一次性 checkout/沙箱中使用；真实仓演练请用 `--dry-run`。
7. **真实 push 路径未实测**：token 只按代码路径实现（env 注入 + redact），本报告不声称已验证真实联网推送成功；首次执行由 Lead 留证。
8. **并发写入**：真实仓 dry-run 的 GATE 来自同 wave 未完成改动（版本/一致性），发布前最终态应清零；脚本本身可重复执行（失败后已完成的同步/提交/tag 会复用或明确报冲突）。

## 6. 文档与检查

- `docs/guides/publishing.md`：新增 **§5.1 一条命令发布（W2.7）**（前置条件 / 用法与参数表 / 步骤与回滚 / 退出码 / 凭据纪律 / 实测），§6 检查清单新增两条固定命令（`node scripts/check-version-consistency.mjs`、`node scripts/e2e/run-release-e2e.mjs`），§7 变更记录追加 W2.7 行。
- `docs/README.md` §3 报告索引新增本文件。
- 检查结果：

```text
$ node scripts/check-doc-links.mjs
checked 69 files (skipped 4 historical artifacts)
LINK CHECK OK

$ node scripts/check-md-tables.mjs docs/guides/publishing.md docs/reports/release-automation-2026-11-12.md docs/README.md
TABLE CHECK OK

$ node --check scripts/release-all.mjs
（exit 0）
```

`check-doc-links.mjs` 只扫描 `git ls-files` 中的已跟踪文件；本报告在本 leaf 收口时尚未提交（Lead 统一提交），因此另用同一套相对链接规则单独复核本报告的 3 条相对链接（0 missing），提交后会被常驻检查覆盖。

