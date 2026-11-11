# 发布状态与流程

> 快照：**2026-11-11 15:00 +08:00**（GitHub / npm / 市场均为当场直查；此后变化以远端与 `git log` 为准）。
> 相关决策：**D2**（仓库内资料公开）、**D3**（npm 冻结）、**D5**（公开范围=本仓内容）、**D6**（版本纪律）、**D7**（公开前排除隐私与第三方源码）——单一事实源：[../agent.md](../../agent.md)。

---

## 1. 当前发布状态一览

| 渠道 | 对象 | 状态 | 证据 / 说明 |
|---|---|---|---|
| GitHub | `orphiczhou/dsh-tree-harness`（本仓） | 🚀 **public** | 发布前检查清单见 §6；收尾核对远端 HEAD = 本地 HEAD |
| GitHub | [`orphiczhou/dsh-session-tree`](https://github.com/orphiczhou/dsh-session-tree)（会话树插件） | ✅ 公开，**v1.3.7**，MIT，14 commits | 与仓内 `packages/dsh-session-tree/` 逐字节一致（release-plugin **19/19** SHA）；main + tag `v1.3.7` = **`91c177e`**（远端=本地） |
| GitHub | [`orphiczhou/dsh-region-probe`](https://github.com/orphiczhou/dsh-region-probe)（区域观测插件） | ✅ 公开 | 独立插件仓，与本仓无源码依赖 |
| 社区市场 | awesome-dsh-plugin **PR #6334**（会话树） | ✅ 已合并（2026-10-14） | 市场按 GitHub topic + PR listing 收录；条目为 browse-only，按 `package.json.version` 判断更新 |
| 社区市场 | awesome-dsh-plugin **PR #6435**（region-probe） | ✅ 已合并（2026-10-15） | 同上 |
| 社区市场 | imsai-sh **PR #554** | ✅ 已合并 | 同上 |
| npm | `@orphiczhou/*` 候选包名（3 个） | ⏸ **冻结**（D3），registry 均 404 | 只走 Git / `link:` 安装；解冻条件见 §4 |

行为边界：

- **本仓公开 ≠ 插件独立发包**：`dsh-tree-engine` / `dsh-agent-introspect` 目前**随本仓公开**（`packages/` 源码 + 测试 + `cordis.patch.yml`），未单独建仓、未单独发布；安装方式是 `link:` 本仓目录。
- **会话树是唯一「发布镜像」包**：本仓 `packages/dsh-session-tree/` 是唯一源码事实源，GitHub `orphiczhou/dsh-session-tree` 是它的发布副本（D1/D5）。**v1.2.0 起会话自交接也随该包发布**（原独立插件已并入并删除）；**v1.3.0 起随包发布 `session-handoff` Skill**（`package.json.files` 含 `skills`，patch 行挂 filesystem skill provider）；**v1.3.1 起接替提示语跟随 DSH 界面语言**（zh/en）；**v1.3.3 起 `spawn:false` 干跑不受阈值闸限制**。
- **不发布**：仓库外的历史 `publish/` 副本（D5 不复制进仓）、本机 profile 配置、运行时数据（`tree-engine-data/` 等）。
- **开源协议**：MIT，版权人 orphiczhou（D4）。

---

## 2. 仓库关系与同步方向

```
dsh-tree-harness/                     ← 唯一源码事实源（public）
  packages\dsh-session-tree\          ← 会话树单包源码（v1.3.7：tree_send + session_handoff + 随包 session-handoff Skill + 语言跟随 + 干跑不拦阈值）
        │
        │  scripts/release-plugin.mjs（逐文件 SHA 校验，不自动 push）
        ▼
github.com/orphiczhou/dsh-session-tree   ← 发布镜像仓（公开、tag v1.3.7、市场 listing 指向它）
        │
        ▼
awesome-dsh-plugin / imsai-sh 市场条目（browse-only，按版本判断更新）
```

- 方向是**单向**：本仓 → 公开插件仓。禁止在公开仓直接改代码后反向同步（会造成发布源漂移）。
- 本仓自身也是 public GitHub 仓（`orphiczhou/dsh-tree-harness`），与插件发布仓是**两个仓**。

---

## 3. 版本纪律（D6）

1. **改代码必须 bump version**：market 按 `package.json.version` 判断条目是否更新，不 bump = 市场不刷新，等于发了假更新。
2. **无内容变化不 bump**：会话树单包迁入本仓（D1）时内容逐字节不变，因此当时**保持 v1.0.4**，不制造假版本。
3. **有内容变化必须 bump**：2026-11-11 功能轮给会话树加入工作区排序/隐藏/召回 → bump **v1.1.0**，经 `release-plugin.mjs` 同步到公开插件仓并推送（`dcf3519`，远端=本地）。同日晚第三轮把会话自交接并入会话树（新增 `session_handoff` + 工作区/权限/预设继承修复）→ bump **v1.2.0**，同步 **16/16 SHA 一致**、推送 main + tag `v1.2.0`（`597ca31`，远端=本地）；原独立插件 `@local/dsh-session-handoff` v0.1.0 从本仓与 profile 删除，从未单独发布。第四轮 SKILL 工程化（随包 `session-handoff` Skill + skill provider patch 行）→ bump **v1.3.0**，同步 **18/18 SHA 一致**、推送 main + tag `v1.3.0`（`1086e9e`，远端=本地）。第五轮「接替提示语跟随 DSH 界面语言」→ bump **v1.3.1**，同步 **18/18 SHA 一致**、推送 main + tag `v1.3.1`（`c257d61`，远端=本地）。同日第六轮按洁净室评审补全 Skill 使用文档 → bump **v1.3.2**（`c1541e5`，18/18 SHA）；第七轮修 `spawn:false` 干跑阈值闸 + 二轮 N1–N7 → bump **v1.3.3**（`cce2975`，18/18 SHA）；第八轮做洁净室文档债最终清扫 → bump **v1.3.4**（`f784c6e`，18/18 SHA）；第三轮复核 PASS 后补 SKILL 例外说明与措辞 → bump **v1.3.5**（`1fb9193`，18/18 SHA）；第九轮文档归档 + 安装指南 → bump **v1.3.6**（`298298d`，19/19 SHA）。
3. **版本号 = 公开仓 tag = package.json.version** 三者一致；建议 SemVer：修 bug → patch，新增行为 → minor，破坏兼容 → major。
4. 发布前在包目录自查版本：

```powershell
node -p "require('./packages/dsh-session-tree/package.json').version"
```

5. `dsh-tree-engine` / `dsh-agent-introspect` 的版本号当前只在各自 `package.json` 中维护（未独立发仓，不涉及市场刷新）。

---

## 4. npm 冻结（D3）

**现状**：3 个 `@orphiczhou/*` 候选包名在 npm registry 均 **404**（2026-11-11 直查）；README 与市场条目均只提供 Git 安装方式。

**冻结原因**：

1. **Git 安装已够用**：`link:` / Git 安装已满足本机与市场用户的安装诉求，市场条目 browse-only 可用；
2. **降低泄露面**：npm token / 2FA / CI 发布链是额外凭据面，当前没有必要引入；
3. **避免双源版本漂移**：不发 npm 就不存在「npm 版本 ≠ GitHub 版本」的维护负担；
4. **与 D6 一致**：冻结期间版本判断只发生在 GitHub / market 一个面上。

**解冻条件（需项目所有者显式批准，缺一不可）**：

- [ ] 明确要发布的包与最终包名（以及是否保留 `@orphiczhou` scope）；
- [ ] 确定版本/tag 策略：npm version = GitHub tag = `package.json.version`；
- [ ] 确定发布凭据与归属（npm token / CI / `--provenance` 评估），并纳入密钥管理；
- [ ] README / 市场 listing / 安装文档全部切到「npm 一键安装」表述；
- [ ] 先用预发布 tag（如 `next`）或 dry-run 验证一次完整发布链；
- [ ] 解冻后核对 registry 元数据（repository 字段指向公开仓、MIT license、README 渲染正常）。

---

## 5. 发布同步脚本 `scripts/release-plugin.mjs`

本仓 → 公开插件仓的唯一受支持同步方式（T1 产出；纯 ESM、只用 Node 内置模块）。

```powershell
node scripts/release-plugin.mjs --target <公开插件仓工作副本目录>   # 同步 + 逐文件 SHA-256 校验
node scripts/release-plugin.mjs --check --target <目录>            # 只校验，不写
node scripts/release-plugin.mjs --help
```

参数（以 `--help` 为准）：

| 参数 | 作用 |
|---|---|
| `--target <dir>` | 目标目录（通常是公开插件仓根目录），**必填** |
| `--source <dir>` | 源包目录，缺省 `<repo>/packages/dsh-session-tree` |
| `--check` | 只校验不写入（发布前/发布后核对用） |
| `--prune` | 删除目标中源不存在的文件（清理旧发布残留） |
| `--force` | 目标 `package.json` 包名不一致时的越权覆盖（防错仓护栏） |
| `-h` / `--help` | 帮助 |

行为与护栏：

- **只写 `--target`**（外加读源目录）；不会运行任何 git（no add/commit/push/tag），只打印需在公开仓执行的命令；
- **不会 bump 版本、不会改 `package.json`**：内容变化必须在源包先 bump（D6），纯重同步保持现有版本；
- **逐文件 SHA-256 比对**：重新读取每个已写入文件，与源比对；报告 `files / match / mismatch / missing / extra`，逐个文件打印 SHA-256，运行本身可审计；
- **安全护栏**：拒绝 source=target、拒绝同步进源的子目录/父目录；目标 `package.json` 包名与源不一致时拒绝（除非 `--force`）；跳过 `node_modules` / `.git` / `.DS_Store` / `Thumbs.db`；
- **退出码**：`0` = 全部一致（或校验通过）；`1` = 用法错误 / 目标被拒 / 任一文件缺失或不一致。

实测证据（2026-11-11）：`--check` 对**仓外历史发布副本**（D5 降级为参考的 `publish/dsh-session-tree/`）→ `files=15 match=15 mismatch=0 missing=0 extra=0`，`RESULT: OK — 15/15 files byte-identical (SHA-256)`，退出码 0。同期脚本在系统临时目录完成 12/12 项自测（含幂等、`--prune`、篡改检测、错仓护栏、父目录护栏；未污染仓库），见 [merge-session-tree-2026-11-11.md](../architecture/merge-session-tree-2026-11-11.md) §6。

v1.2.0 实测：先把公开插件仓 clone 到系统临时目录，`node scripts/release-plugin.mjs --target <clone> --prune` → **`files=16 match=16 mismatch=0 missing=0 extra=0`，`RESULT: OK — 16/16 files byte-identical (SHA-256)`**；`git add -A` 后真实变更 5 文件（index.js / package.json / README×2 / 新增 test/handoff.test.js），其余文件仅 CRLF stat 噪声、未入库；commit `597ca31` + tag `v1.2.0` 推送后 `ls-remote` 核对 main 与 tag 均等于本地 HEAD。

v1.3.0 实测（SKILL 工程化）：同一 clone 流程 → **`files=18 match=18 mismatch=0 missing=0 extra=0`，`RESULT: OK — 18/18 files byte-identical (SHA-256)`**；真实变更 6 文件（README×2 / cordis.patch.yml / package.json / 新增 `skills/session-handoff/SKILL.md` / 新增 `test/skills.test.cjs`）；commit `1086e9e` + tag `v1.3.0` 推送后 `ls-remote` 核对 main 与 tag 均等于本地 HEAD。

v1.3.1 实测（接替提示语跟随界面语言）：同一 clone 流程 → **`files=18 match=18 mismatch=0 missing=0 extra=0`**；真实变更 6 文件（README×2 / index.js / package.json / skills/session-handoff/SKILL.md / test/handoff.test.js）；commit `c257d61` + tag `v1.3.1` 推送后 `ls-remote` 核对 main 与 tag 均等于本地 HEAD。

v1.3.2 / v1.3.3 / v1.3.4 / v1.3.5 / v1.3.6 实测（文档补全 + spawn:false 干跑修正 + 洁净室收口）：同一 clone 流程均 **`files=18 match=18`**；commit + tag `v1.3.2`（`c1541e5`）/ `v1.3.3`（`cce2975`）/ `v1.3.4`（`f784c6e`）/ `v1.3.5`（`1fb9193`）/ `v1.3.6`（`298298d`，19/19），推送后 `ls-remote` 核对 main 与 tag 均等于本地 HEAD。
> 2026-11-12 W2.2 发布实测（v1.3.7）：`release-plugin` **`files=19 match=19`**，tag `v1.3.7` = `91c177e`（main+tag=本地，`ls-remote` 核对通过）；本仓 `master` 同批推送。

标准发布流程：

1. 跑测试全绿（见 §6 测试项）；
2. 内容有变则 bump `packages/dsh-session-tree/package.json` 的 version（D6）；
3. `node scripts/release-plugin.mjs --target <公开仓工作副本>` → 要求 `RESULT: OK`（全部字节一致）；
4. 在公开插件仓：`git status --short` / `git diff` 复核 → `git add -A` → `git commit` → `git push origin main`（脚本会打印同样的命令）；
5. 需要 tag 时在公开仓 `git tag vX.Y.Z && git push origin vX.Y.Z`，并核对 `package.json.version` = tag；
6. 核对 GitHub 远端 HEAD 与本地一致；
7. 若版本或安装方式变化，更新 awesome-dsh-plugin / imsai-sh 的市场 listing（提 PR）。

⚠️ **禁止手工双写**：任何「本仓改一份、公开仓再改一份」的做法都会造成发布源漂移；只用脚本同步 + SHA 校验。

> 以上 1–6 步已可由 §5.1 的一条命令串起来（默认 dry-run；`--push` 才真推）。

## 5.1 一条命令发布（W2.7）

`scripts/release-all.mjs` 把 §5 的人工步骤串成一条命令：**预检 → 单向同步 + SHA-256 对账 → 本仓 commit（可选 push）→ 镜像仓 commit + tag（可选 push）→ `ls-remote` 核对**。任何一步失败立即非 0 退出，并打印「已完成步骤 / 下一步人工处置 / 回滚命令」；同步仍然只走 `release-plugin.mjs`，禁止手工双写。

### 前置条件

- 本仓在 `master` 分支，`origin` = `https://github.com/orphiczhou/dsh-tree-harness.git`（URL 不含内嵌凭据）；
- 镜像仓本地 checkout 干净、在 `main` 分支，用 `--mirror-dir <dir>` 或环境变量 `DSH_MIRROR_DIR` 指定（脚本不硬编码开发机路径）；
- 包内容有变化时先在 `packages/dsh-session-tree/package.json` bump version（D6）；**版本未 bump 时真实运行拒绝**，并提示「包内容无变化不需要发布」；
- 推送需要 **User 环境变量 `GH_TOKEN`**（脚本只在 push 时读取；dry-run 完全不读）；
- 若 `scripts/check-version-consistency.mjs`（W2.4）存在则自动调用，失败即门禁。

### 用法

```powershell
# 1) 演练（默认模式；只读预检 + 打印完整步骤计划，不写文件、不读 token）
node scripts/release-all.mjs --dry-run --mirror-dir <镜像 checkout>

# 2) 本地全链路演练（会写镜像 checkout + 本仓/镜像本地 commit/tag，但不推送）
node scripts/release-all.mjs --skip-push --mirror-dir <镜像 checkout>

# 3) 正式发布（唯一会联网写远端的模式）
node scripts/release-all.mjs --push --mirror-dir <镜像 checkout>

# 补充：跳过包测试 / 自定义 commit 摘要
node scripts/release-all.mjs --push --mirror-dir <镜像 checkout> --skip-tests --summary "会话树 v1.3.7：…"
```

| 参数 | 作用 |
|---|---|
| `--dry-run` | 只读演练（默认）；即使预检有 GATE 也返回 0，并打印 `BLOCKED` 原因 |
| `--skip-push` / `--apply` | 执行本地全链路（同步 + commit + tag），**不推送**；用于离线演练/断网环境 |
| `--push` | 执行全链路并推送本仓 + 镜像 `main`/tag（唯一会联网写远端的开关） |
| `--mirror-dir <dir>` | 公开镜像仓本地 checkout；缺省读 `DSH_MIRROR_DIR` |
| `--pkg <name>` | 包名或目录名，缺省 `@orphiczhou/dsh-session-tree` |
| `--skip-tests` | 跳过包测试（仍执行 `check-version-consistency.mjs`） |
| `--summary <text>` | 本仓发布 commit 摘要（模板 `feat/release: <pkg> vX.Y.Z — <摘要>`） |
| `--require-clean` | 工作树必须 clean；默认把未提交改动列为 WARN（会随 `git add -A` 进入发布提交） |

### 步骤、失败处理与回滚

| 步骤 | 动作 | 失败时脚本给出的回滚（节选） |
|---|---|---|
| 0 预检 | 仓库/分支/remote、镜像分支与 tag、版本关系、`--check` 内容对账、一致性脚本、测试计划 | 未产生写入；修复 GATE 后重跑 |
| 2 同步 | `release-plugin --check` → `--prune` → `--check`，要求 `files=N match=N`（当前 19） | `git -C <mirror> checkout -- . && git -C <mirror> clean -fd` |
| 3 本仓 | `git add -A` + `git commit`（`feat/release: <pkg> vX.Y.Z — <摘要>`）；`--push` 时 `git push origin master` | 未推送：`git reset --soft HEAD~1`；已推送：`git revert --no-edit <sha>` + `git push origin master` |
| 4 镜像 | `git -C <mirror> add -A` + commit + `tag vX.Y.Z`；`--push` 时 push `main` 与 tag | 未推送：`git reset --soft <sha>` / `git tag -d vX.Y.Z`；已推送：revert + 删远端 tag（确认无消费者后） |
| 5 核对 | `git ls-remote origin refs/heads/master`、`git ls-remote <mirror> refs/heads/main refs/tags/vX.Y.Z` 必须等于本地 | 重试对应 push；tag 指向不一致时先查清再处理，不覆盖已发布 tag |

退出码：`0` = 成功 / no-op / dry-run 完成；`1` = 真实运行被门禁拒绝、预检环境错误（如镜像 checkout 不存在）或任一步失败；`2` = 用法错误（未知参数、参数缺值）。

### 凭据纪律（与 agent.md §0.2 / §5 一致）

- token 从 `[Environment]::GetEnvironmentVariable('GH_TOKEN','User')`（或进程 env）读入**内存**，只在 push 时读取；
- 通过子进程环境变量 `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` 注入 `http.extraheader`（git ≥ 2.31）：**不写 git config、不进 argv、不打印、不写 remote URL**；
- 子进程输出统一 redact 后才打印；网络命令失败且疑似代理错误时，按 agent.md 约定用 `-c http.proxy=` 直连重试一次；
- 脚本不修改 profile、不安装/重载插件；发布后如需回退本机插件，按 [agent.md](../../agent.md) §6.1 的 profile 回滚步骤执行。

### 实测（2026-11-12）

真实仓 `--dry-run`：exit 0，本仓 HEAD（`e09f39b`）与镜像 HEAD（`298298d`）均未改变，输出含完整 5 步计划与预检结果；失败路径（`--mirror-dir` 指向不存在路径）exit 1 并给出 clone 命令。隔离沙箱（`git archive HEAD` 副本）完成未 bump 拒绝（exit 1，0 写入）与 bump 后 `--skip-push` 全链路成功（同步 **19/19 SHA**、本仓 commit、镜像 commit + tag `v1.3.7`），远端 `main`/tag 未变化（证明未 push）。完整原始输出摘要见 [release-automation-2026-11-12.md](../reports/release-automation-2026-11-12.md)。

---

## 6. 公开前检查清单（本仓发布 / 插件仓发布通用）

### 安全与隐私

- [ ] **密钥扫描（工作树）**：全受跟踪文件匹配 `ghp_` / `github_pat_` / `sk-` / `AKIA` / `PRIVATE KEY` / `(password|secret|api_key|token)=` 等模式 → **0 命中**；
- [ ] **密钥扫描（git 全历史）**：`git log -p --all` 或逐 commit 扫描同样模式；可疑文件名（`.env` / `*.pem` / `id_rsa` / `credentials` / `*.key` / `*.pfx`）无入库记录；
- [ ] **隐私**：`demo/` 截图不含可识别的私人会话标题 / 聊天内容 / 账号信息 / 内网地址；
- [ ] **D7 排除项**：隐私截图与从 DSH `app.asar` 摘出的第三方源码/文档**共 7 个文件已排除**（1 + 6）——不在提交中、不在 git 历史中；文档不引用/不链接这些文件。历史中若曾入库，必须先 `git filter-repo` / `filter-branch` 重写历史并复扫确认（本轮 QA 报告 [verification-2026-11-11.md](../reports/verification-2026-11-11.md) §0.3–§0.4 记录了历史位置与解除条件）；
- [ ] `.gitignore` 覆盖 `node_modules/`、`*.log`、`.env`、运行时数据等本地机密与产物。

### 仓库健康

- [ ] 无 `node_modules` / 构建产物 / 运行时数据被 git 跟踪；
- [ ] 无 >2MB 大文件（如确需保留，先确认不是隐私/第三方内容）；
- [ ] 无仓库外文件被复制进仓（D5：`publish/` 副本、仓外 `HANDOFF*.md` 等不进仓）；
- [ ] LICENSE 为 MIT 全文，`Copyright (c) 2026 orphiczhou`。

### 测试与一致性

- [ ] `packages/dsh-tree-engine`：`node --test tests/*.test.js` → **112/112**（62 引擎 + 4 技能打包 + 1 B1 回归 + 9 tree_doctor + 8 写面护栏 + 11 compat + 10 identity + 7 budget），退出码 0；
- [ ] `packages/dsh-session-tree`：`node test/handoff.test.js`（**41/41**）、`node test/skills.test.cjs`（**3/3**，随包 Skill 打包回归）、`node test/render.test.cjs`、`node test/style-guard.cjs`（**22/22**）、`node scripts/verify-bundle.mjs`（0 fail）、`node test/provider-conformance.cjs [rc.2 fixture 目录]`（fixture 解析顺序 `DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `out`，缺 fixture exit 2 可操作报错；记录见 [conformance-rc2-2026-11-12.md](../reports/conformance-rc2-2026-11-12.md)）；
- [ ] `packages/dsh-session-tree` 与公开插件仓逐文件 SHA 一致（`release-plugin.mjs`）；
- [ ] 版本/文档一致性：`node scripts/check-version-consistency.mjs`（W2.4 产出；0 失败）；
- [ ] 真机 E2E 三断言（W2.5）：`node scripts/e2e/run-release-e2e.mjs --source <id> --successor <id> --expect-kind root|sibling --expect-lang zh --wait 120000` → 三条断言全 PASS 且 `scripts/e2e/artifacts/release-<ts>.json` 落盘（失败注入演练证据见 [e2e-release-runner-2026-11-12.md](../reports/e2e-release-runner-2026-11-12.md)）；
- [ ] 真机 E2E：`scripts/e2e/verify-handoff.mjs` 对 root/sibling 接替会话断言全 PASS（报告 [e2e-handoff-2026-11-11.md](../reports/e2e-handoff-2026-11-11.md)）；
- [ ] README / handoff / publishing 中的路径、数字、状态与实际一致（版本号、测试数、装配状态、npm 404 结论）。

### 发布后核对

- [ ] 公开仓可见性 = **public**，description / topics 已设置；
- [ ] 远端 HEAD = 本地 HEAD；`git remote -v` 指向干净 HTTPS URL（不含临时凭据）；
- [ ] GitHub 页面可正常渲染 README、LICENSE、文档内相对链接无 404；
- [ ] 市场 listing 指向公开仓主分支（非 fork / 临时分支）。

> 本轮的独立验证证据见 [verification-2026-11-11.md](../reports/verification-2026-11-11.md)（QA 产出；发布门禁以该报告结论为准）。

---

## 7. 变更记录

- 2026-11-11：建立本文件（随本仓首次公开）；记录 GitHub 两仓现状、市场 PR、npm 冻结（D3）、版本纪律（D6）、同步脚本契约、公开前检查清单、D7 排除项。
- 2026-11-11（v1.1.0）：会话树新增工作区排序/隐藏/召回 → 同步公开插件仓（`dcf3519`，15/15 SHA）。
- 2026-11-11（v1.2.0，第三轮）：会话自交接 `session_handoff` 并入会话树单包并修复同工作区/权限模式/Agent 预设继承 → 同步公开插件仓 **16/16 SHA**，commit + tag `v1.2.0` = **`597ca31`**，远端=本地；原独立插件 `@local/dsh-session-handoff` 删除（从未单独发布）。
- 2026-11-11（v1.3.0，第四轮）：会话树随包发布 `session-handoff` Skill + `@deepseek-ai/dsh-skill-filesystem` patch 行（SKILL 工程化）→ 同步公开插件仓 **18/18 SHA**，commit + tag `v1.3.0` = **`1086e9e`**，远端=本地；tree-engine v0.5.0（随包 tree-commander/tree-worker Skill + B1 owner 修复）仅随本仓公开，不单独发布。
- 2026-11-11（v1.3.1，第五轮）：交接接替提示语跟随 DSH 界面语言（zh/en）+ 随包 Skill 用户指南 → 同步公开插件仓 **18/18 SHA**，commit + tag `v1.3.1` = **`c257d61`**，远端=本地。
- 2026-11-11（v1.3.2，第六轮）：按洁净室一轮评审补全 Skill 使用文档（调用样例/参数表/冒烟测试/升级与排障/英文触发词）→ **18/18 SHA**，tag `v1.3.2` = **`c1541e5`**。
- 2026-11-11（v1.3.3，第七轮）：`spawn:false` 干跑不再被阈值闸拦 + 洁净室二轮 N1–N7 修订 → **18/18 SHA**，tag `v1.3.3` = **`cce2975`**。
- 2026-11-11（v1.3.4，第八轮）：R1-B/R2-B 文档债清扫（语言验收表述、set-session 主体、英文触发词、版本矩阵）→ **18/18 SHA**，tag `v1.3.4` = **`f784c6e`**。
- 2026-11-11（v1.3.5，第九轮）：第三轮洁净室 PASS 后的收尾（SKILL 的 `spawn:false` 例外说明 + root→grandchild 措辞）→ **18/18 SHA**，tag `v1.3.5` = **`1fb9193`**。
- 2026-11-12（v1.3.6，第十轮）：文档按目录归档 + 新增人类/Agent 安装指南（`AGENT-INSTALL.md`）→ **19/19 SHA**，tag `v1.3.6` = **`298298d`**。
- 2026-11-12（v1.3.7，Wave-2 W2.2）：`test/provider-conformance.cjs` rc.2 fixture 显式解析（缺 fixture exit 2，29/29）→ **19/19 SHA**，tag `v1.3.7` = **`91c177e`**（运行时/客户端行为不变）。
- 2026-11-12（W2.7）：新增 `scripts/release-all.mjs` 一条命令发布（预检 → `release-plugin` 同步/SHA 对账 → 本仓 commit → 镜像 commit/tag → `ls-remote` 核对；默认 dry-run、`--push` 才真推、失败即停并给回滚提示）；本文件新增 §5.1，§6 清单接入版本一致性、发布 E2E 两条固定命令。演练证据见 [release-automation-2026-11-12.md](../reports/release-automation-2026-11-12.md)。
