# 发布状态与流程

> 快照：**2026-11-11 15:00 +08:00**（GitHub / npm / 市场均为当场直查；此后变化以远端与 `git log` 为准）。
> 相关决策：**D2**（仓库内资料公开）、**D3**（npm 冻结）、**D5**（公开范围=本仓内容）、**D6**（版本纪律）、**D7**（公开前排除隐私与第三方源码）——单一事实源：[../agent.md](../agent.md)。

---

## 1. 当前发布状态一览

| 渠道 | 对象 | 状态 | 证据 / 说明 |
|---|---|---|---|
| GitHub | `orphiczhou/dsh-tree-harness`（本仓） | 🚀 **public** | 发布前检查清单见 §6；收尾核对远端 HEAD = 本地 HEAD |
| GitHub | [`orphiczhou/dsh-session-tree`](https://github.com/orphiczhou/dsh-session-tree)（会话树插件） | ✅ 公开，**v1.2.0**，MIT，7 commits | 与仓内 `packages/dsh-session-tree/` 逐字节一致（release-plugin **16/16** SHA）；main + tag `v1.2.0` = **`597ca31`**（远端=本地） |
| GitHub | [`orphiczhou/dsh-region-probe`](https://github.com/orphiczhou/dsh-region-probe)（区域观测插件） | ✅ 公开 | 独立插件仓，与本仓无源码依赖 |
| 社区市场 | awesome-dsh-plugin **PR #6334**（会话树） | ✅ 已合并（2026-10-14） | 市场按 GitHub topic + PR listing 收录；条目为 browse-only，按 `package.json.version` 判断更新 |
| 社区市场 | awesome-dsh-plugin **PR #6435**（region-probe） | ✅ 已合并（2026-10-15） | 同上 |
| 社区市场 | imsai-sh **PR #554** | ✅ 已合并 | 同上 |
| npm | `@orphiczhou/*` 候选包名（4 个） | ⏸ **冻结**（D3），registry 均 404 | 只走 Git / `link:` 安装；解冻条件见 §4 |

行为边界：

- **本仓公开 ≠ 插件独立发包**：`dsh-tree-engine` / `dsh-meta-loop` / `dsh-agent-introspect` 目前**随本仓公开**（`packages/` 源码 + 测试 + `cordis.patch.yml`），未单独建仓、未单独发布；安装方式是 `link:` 本仓目录。
- **会话树是唯一「发布镜像」包**：本仓 `packages/dsh-session-tree/` 是唯一源码事实源，GitHub `orphiczhou/dsh-session-tree` 是它的发布副本（D1/D5）。**v1.2.0 起会话自交接也随该包发布**（原独立插件已并入并删除）。
- **不发布**：仓库外的历史 `publish/` 副本（D5 不复制进仓）、本机 profile 配置、运行时数据（`tree-engine-data/` 等）。
- **开源协议**：MIT，版权人 orphiczhou（D4）。

---

## 2. 仓库关系与同步方向

```
dsh-tree-harness/                     ← 唯一源码事实源（public）
  packages\dsh-session-tree\          ← 会话树单包源码（v1.2.0：tree_send + session_handoff）
        │
        │  scripts/release-plugin.mjs（逐文件 SHA 校验，不自动 push）
        ▼
github.com/orphiczhou/dsh-session-tree   ← 发布镜像仓（公开、tag v1.2.0、市场 listing 指向它）
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
3. **有内容变化必须 bump**：2026-11-11 功能轮给会话树加入工作区排序/隐藏/召回 → bump **v1.1.0**，经 `release-plugin.mjs` 同步到公开插件仓并推送（`dcf3519`，远端=本地）。同日晚第三轮把会话自交接并入会话树（新增 `session_handoff` + 工作区/权限/预设继承修复）→ bump **v1.2.0**，同步 **16/16 SHA 一致**、推送 main + tag `v1.2.0`（`597ca31`，远端=本地）；原独立插件 `@local/dsh-session-handoff` v0.1.0 从本仓与 profile 删除，从未单独发布。
3. **版本号 = 公开仓 tag = package.json.version** 三者一致；建议 SemVer：修 bug → patch，新增行为 → minor，破坏兼容 → major。
4. 发布前在包目录自查版本：

```powershell
node -p "require('./packages/dsh-session-tree/package.json').version"
```

5. `dsh-tree-engine` / `dsh-meta-loop` / `dsh-agent-introspect` 的版本号当前只在各自 `package.json` 中维护（未独立发仓，不涉及市场刷新）。

---

## 4. npm 冻结（D3）

**现状**：4 个 `@orphiczhou/*` 候选包名在 npm registry 均 **404**（2026-11-11 直查）；README 与市场条目均只提供 Git 安装方式。

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

实测证据（2026-11-11）：`--check` 对**仓外历史发布副本**（D5 降级为参考的 `publish/dsh-session-tree/`）→ `files=15 match=15 mismatch=0 missing=0 extra=0`，`RESULT: OK — 15/15 files byte-identical (SHA-256)`，退出码 0。同期脚本在系统临时目录完成 12/12 项自测（含幂等、`--prune`、篡改检测、错仓护栏、父目录护栏；未污染仓库），见 [merge-session-tree-2026-11-11.md](merge-session-tree-2026-11-11.md) §6。

v1.2.0 实测：先把公开插件仓 clone 到系统临时目录，`node scripts/release-plugin.mjs --target <clone> --prune` → **`files=16 match=16 mismatch=0 missing=0 extra=0`，`RESULT: OK — 16/16 files byte-identical (SHA-256)`**；`git add -A` 后真实变更 5 文件（index.js / package.json / README×2 / 新增 test/handoff.test.js），其余文件仅 CRLF stat 噪声、未入库；commit `597ca31` + tag `v1.2.0` 推送后 `ls-remote` 核对 main 与 tag 均等于本地 HEAD。

标准发布流程：

1. 跑测试全绿（见 §6 测试项）；
2. 内容有变则 bump `packages/dsh-session-tree/package.json` 的 version（D6）；
3. `node scripts/release-plugin.mjs --target <公开仓工作副本>` → 要求 `RESULT: OK`（全部字节一致）；
4. 在公开插件仓：`git status --short` / `git diff` 复核 → `git add -A` → `git commit` → `git push origin main`（脚本会打印同样的命令）；
5. 需要 tag 时在公开仓 `git tag vX.Y.Z && git push origin vX.Y.Z`，并核对 `package.json.version` = tag；
6. 核对 GitHub 远端 HEAD 与本地一致；
7. 若版本或安装方式变化，更新 awesome-dsh-plugin / imsai-sh 的市场 listing（提 PR）。

⚠️ **禁止手工双写**：任何「本仓改一份、公开仓再改一份」的做法都会造成发布源漂移；只用脚本同步 + SHA 校验。

---

## 6. 公开前检查清单（本仓发布 / 插件仓发布通用）

### 安全与隐私

- [ ] **密钥扫描（工作树）**：全受跟踪文件匹配 `ghp_` / `github_pat_` / `sk-` / `AKIA` / `PRIVATE KEY` / `(password|secret|api_key|token)=` 等模式 → **0 命中**；
- [ ] **密钥扫描（git 全历史）**：`git log -p --all` 或逐 commit 扫描同样模式；可疑文件名（`.env` / `*.pem` / `id_rsa` / `credentials` / `*.key` / `*.pfx`）无入库记录；
- [ ] **隐私**：`demo/` 截图不含可识别的私人会话标题 / 聊天内容 / 账号信息 / 内网地址；
- [ ] **D7 排除项**：隐私截图与从 DSH `app.asar` 摘出的第三方源码/文档**共 7 个文件已排除**（1 + 6）——不在提交中、不在 git 历史中；文档不引用/不链接这些文件。历史中若曾入库，必须先 `git filter-repo` / `filter-branch` 重写历史并复扫确认（本轮 QA 报告 [verification-2026-11-11.md](verification-2026-11-11.md) §0.3–§0.4 记录了历史位置与解除条件）；
- [ ] `.gitignore` 覆盖 `node_modules/`、`*.log`、`.env`、运行时数据等本地机密与产物。

### 仓库健康

- [ ] 无 `node_modules` / 构建产物 / 运行时数据被 git 跟踪；
- [ ] 无 >2MB 大文件（如确需保留，先确认不是隐私/第三方内容）；
- [ ] 无仓库外文件被复制进仓（D5：`publish/` 副本、仓外 `HANDOFF*.md` 等不进仓）；
- [ ] LICENSE 为 MIT 全文，`Copyright (c) 2026 orphiczhou`。

### 测试与一致性

- [ ] `packages/dsh-tree-engine`：`node --test tests/*.test.js` → **62/62**，退出码 0；
- [ ] `packages/dsh-meta-loop`：`node --test tests/*.test.js` → **13/13**，退出码 0；
- [ ] `packages/dsh-session-tree`：`node test/handoff.test.js`（**34/34**）、`node test/render.test.cjs`、`node test/style-guard.cjs`（**22/22**）、`node scripts/verify-bundle.mjs`（0 fail）、`node test/provider-conformance.cjs [asar 解包目录]`（后者需 rc.2 兼容 asar fixture，见 [merge-session-tree-2026-11-11.md](merge-session-tree-2026-11-11.md) §5）；
- [ ] `packages/dsh-session-tree` 与公开插件仓逐文件 SHA 一致（`release-plugin.mjs`）；
- [ ] 真机 E2E：`scripts/e2e/verify-handoff.mjs` 对 root/sibling 接替会话断言全 PASS（报告 [e2e-handoff-2026-11-11.md](e2e-handoff-2026-11-11.md)）；
- [ ] README / handoff / publishing 中的路径、数字、状态与实际一致（版本号、测试数、装配状态、npm 404 结论）。

### 发布后核对

- [ ] 公开仓可见性 = **public**，description / topics 已设置；
- [ ] 远端 HEAD = 本地 HEAD；`git remote -v` 指向干净 HTTPS URL（不含临时凭据）；
- [ ] GitHub 页面可正常渲染 README、LICENSE、文档内相对链接无 404；
- [ ] 市场 listing 指向公开仓主分支（非 fork / 临时分支）。

> 本轮的独立验证证据见 [verification-2026-11-11.md](verification-2026-11-11.md)（QA 产出；发布门禁以该报告结论为准）。

---

## 7. 变更记录

- 2026-11-11：建立本文件（随本仓首次公开）；记录 GitHub 两仓现状、市场 PR、npm 冻结（D3）、版本纪律（D6）、同步脚本契约、公开前检查清单、D7 排除项。
- 2026-11-11（v1.1.0）：会话树新增工作区排序/隐藏/召回 → 同步公开插件仓（`dcf3519`，15/15 SHA）。
- 2026-11-11（v1.2.0，第三轮）：会话自交接 `session_handoff` 并入会话树单包并修复同工作区/权限模式/Agent 预设继承 → 同步公开插件仓 **16/16 SHA**，commit + tag `v1.2.0` = **`597ca31`**，远端=本地；原独立插件 `@local/dsh-session-handoff` 删除（从未单独发布）。
