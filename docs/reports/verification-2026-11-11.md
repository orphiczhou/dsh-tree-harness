# 公开前独立验证报告（T3 / 决策 D2）

> **验证者**：qa-verifier（独立验证角色：只读仓库与运行环境，仅写本文件）
> **仓库**：`D:\Codes\dsh-tree-harness`，当前分支 `master`，**复扫后 HEAD `40629745f1df16d67706223bb73ce67d1e67055c`（30 commits，工作树 clean）**；历史重写前 HEAD 为 `2cb2d17…`（26 commits，仅作前后对照）
> **验证时间窗口**：2026-11-11 12:35:32 — 12:46（+08:00）；其中**推送前复扫（A1–A9）为 12:44:59 — 12:45:36**
> **报告版本**：**v1.2**（2026-11-11 12:47+08:00；v1.1 为 D7 扩大更新；v1.2 为**历史清除后复扫结果回填**——附录 A 已全部填实测，结论升级）
> **结论等级**：**PASS WITH RISKS（可公开推送）** —— 历史清除已完成并复扫通过（附录 A）

---

## 0. 结论（置顶）

### 0.1 结论等级

**PASS WITH RISKS（可公开推送）**：**附录 A 的 A1–A9 已于 2026-11-11 12:44:59 — 12:45:36 在冻结 HEAD `4062974` 上全部实测通过**，D7 的 7 个文件与 2 个瘦身路径已从**工作树 + 全部 git 历史**清除，`HEAD`/`objects`/`fsck` 均干净。

- 复扫期间 Lead **冻结 git 历史**（新 HEAD 固定为 `40629745f1df16d67706223bb73ce67d1e67055c`，30 commits，工作树 clean），本报告所有复扫结论均针对该 HEAD。
- 残留风险均为**已披露/已接受**项（见 §8）：R1 本机路径/用户名（D2 显式接受）、R2 推送前无远端备份（push 后消失）、R4 建议开启 GitHub secret scanning。**不再存在 BLOCK 级问题。**
- 条件：推送前需把本报告 v1.2 的更新（仅 `docs/reports/verification-2026-11-11.md` 一个文件）提交为一个普通 docs commit；该变更不含密钥、不新增/删除任何文件路径，故**不影响 A1–A5/A9 的结构性结论**（见附录 A 说明）。
- 历史沿革：v1.0 发现 BLOCK-1（隐私截图）；D7 复核扩大后 v1.1 增补 BLOCK-2 至 6 文件 + 2 个瘦身路径；本 v1.2 记录清除后复扫 → 升级为 PASS WITH RISKS。

> **🔒 公开推送结论：可 push。** 前置动作只有一条——先把本报告 v1.2 更新 commit 进 master（普通 commit，非历史重写），然后即可 push。详细证据见**附录 A**。

### 0.2 BLOCK 级问题清单（醒目）

| ID | 类型 | 对象 | 处置状态 |
|---|---|---|---|
| **BLOCK-1** | **隐私** | `demo/screen-2026-10-13.png` | **✅ 已处置完成**（Lead/D7，2026-11-11 12:44 复核）：工作树移除 + 历史重写清除；原件已移出仓库备份（SHA 已校验） |
| **BLOCK-2** | **第三方源码再分发风险** | `demo/agspec/` 下 6 个文件：`_subagent-index.js`、`_tool-subagent.js`、`_tool-subagent.md`、`_driver.js`、`_fork.js`、`_spawn.js` | **✅ 已处置完成**（Lead/D7，同上）：本项由 Lead 判定并两轮复核（初判 3 个 → 复核扩为 6 个）；本报告提供其存在、SHA 与历史位置证据，复扫确认已全部清除 |

- **处置实测结果（2026-11-11 12:44:59 起，见附录 A）**：7 个文件工作树全部不存在（A2 全 False）、`git ls-files` 0 命中（A1）、**全历史 diff 的文件头 0 命中**（A3 file-header）、`git rev-list --objects --all` 0 命中（A5）、逐路径 `git log` 0 提交（A3b）；重写前提交 `2cb2d17…`/`6de30d1`/`439976f`/`82f7b82`/`dc7c27d` 在新对象库中**均不存在**（`git cat-file --batch-all-objects` 前缀扫描 0；`git fsck` 无 unreachable/dangling）。

- **BLOCK-1 详情**（脱敏描述，不复制画面内容）：该截图（1,903.4 KB，2886×2004；SHA-256 `f7af16c8d75fa6430bb767897d5c42fc61e779be89e12413c791e3b237ee6db3`）含：① 左侧会话列表约 20 条**私有会话标题**（个人项目/研究主题，含 GitHub URL 片段与内网 NAS IPv4 片段）；② Windows 桌面真实文件与图标（个人文件夹、个人证券交易软件图标、系统资源悬浮窗）；③ 应用窗口标题。聊天区与右侧文档面板为本项目技术内容（该部分本身可公开）。
- **BLOCK-2 详情**：6 个文件为从 DSH `app.asar` 摘出的第三方源码/文档全文（`demo/agspec/w2-source.md` 自述「= `@deepseek-ai/...` 全文/README」；新扩大的 `_driver.js`/`_fork.js`/`_spawn.js` 头部均带 `@deepseek-ai/...` import 与 `@module @deepseek-ai/...` 标记，2026-11-11 12:40 复核确认），再分发许可未经核实 → 随公开仓发布存在风险（许可判断属 Lead 决策，本报告不替代法律判断）。
- **明确保留（不在剔除清单）**：`demo/agspec/_extract.cjs`（自写提取工具，1,323 B）——Lead 已确认保留。

### 0.3 BLOCK 文件在 git 历史中的位置（历史清除范围）

| 文件 | 大小 / SHA-256（2026-11-11 12:39-12:40 实测） | 引入 commit |
|---|---|---|
| `demo/screen-2026-10-13.png` | 1,949,061 B / `f7af16c8d75fa6430bb767897d5c42fc61e779be89e12413c791e3b237ee6db3` | `6de30d1` |
| `demo/agspec/_subagent-index.js` | 135,247 B / `651bf066fa867c88a5fd74133a5392a55aa6e5ee926ef865e1b8a3f73f67ad8a` | `439976f` |
| `demo/agspec/_tool-subagent.js` | 34,544 B / `2137f59d40e2e14c65c246edb5b211d2798aba96a33377fe86ace0710eebe817` | `439976f` |
| `demo/agspec/_tool-subagent.md` | 16,774 B / `8b342061bf0351ad6a2e7481590fcd6d7b6440cff0d7384167cf88b4971cad89` | `439976f` |
| `demo/agspec/_driver.js` | 10,494 B / `bcf80a8ce3f4d5c561b5ca507ab41e043ef9a9f0f313089825c2a7de64a8e331` | `439976f` |
| `demo/agspec/_fork.js` | 2,416 B / `0f154775743bbbfdeae4b1a9afb37688305c032c1a29eda2a64fed8d52ea6944` | `439976f` |
| `demo/agspec/_spawn.js` | 1,574 B / `ed69b1c89c85e390d2863b7352f5540129229d8210e70e4119dee37ae284f371` | `439976f` |

命令（2026-11-11T12:38:35 / 12:40:50+08:00）：

```powershell
git --no-pager log --all --oneline --follow -- <file>   # 逐文件
Get-FileHash -LiteralPath <file> -Algorithm SHA256      # 逐文件
```

输出摘要（**历史重写前**快照）：7 个文件曾全部存在于旧 HEAD 可达历史（`screen-*`→`6de30d1`，6 个第三方源码→`439976f`），当时均受 git 跟踪；以下 SHA/commit 均为重写前坐标。

**清除后复扫（2026-11-11 12:44:59+08:00 起，新 HEAD `4062974`，详见附录 A）**：上述 7 个路径 + 2 个瘦身路径——`git ls-files`、`git log --all --diff-filter=A --name-only`、`git rev-list --objects --all` **三处均 0 命中**；`git log -p --all` 中**文件头 0 命中**（42 条正文命中全部来自文档/commit message 对「已移除文件」的名称说明，见附录 A 说明②）、逐路径 `git log` 均 0 提交；旧提交对象全部不可达（`2cb2d17`/`6de30d1`/`439976f`/`82f7b82`/`dc7c27d` 前缀在对象库中 0 个）。**即：历史中不再存在这些文件的任何内容对象。**

**历史瘦身项（非安全，Lead 追加，随历史重写一并清除）**

| 路径 | 当前工作树 | 历史 blob / 大小 | 历史位置 |
|---|---|---|---|
| `scripts/asar-err.txt` | **不存在**（已被 `.gitignore` 忽略） | `6365dc52…` / **6,902,314 B**（旧 PowerShell 报错转储） | `dc7c27d` 引入 → `2cb2d17` 删除 |
| `scripts/asar-out.txt` | **不存在**（已被 `.gitignore` 忽略） | `e69de29b…` / **0 B**（空文件） | `dc7c27d` 引入 → `2cb2d17` 删除 |

```powershell
git --no-pager rev-list --objects --all | Where-Object { $_ -match 'scripts/asar-(out|err)\.txt$' }  # 再 git cat-file -s <blob>
```

输出摘要（2026-11-11T12:41:30+08:00，重写前）：如上两行；6.9MB 大 blob 仅存于历史、工作树已无（`.gitignore` L17-18 有对应条目）。
**清除后复扫**：对象库最大 blob **87,653 B**，`blobs_over_1MB = 0` → 6.9MB 大 blob 已彻底回收（A9）。

### 0.4 解除条件（✅ 均已满足，2026-11-11 12:45）

| # | 条件 | 状态 |
|---|---|---|
| 1 | D7 的 **7 个文件**从**工作树**移除（等价备份在仓外，SHA 见 §0.3） | ✅ A2 全部 False |
| 2 | D7 的 **7 个文件**从**全部 git 历史**清除 | ✅ A3 文件头 0 / A4 0 / A5 0 / 逐路径 log 0 / 旧对象前缀 0 |
| 3 | **历史瘦身**：2 个 asar blob（含 6,902,314 B）回收 | ✅ A9：max blob 87,653 B，无 >1MB blob |
| 4 | **附录 A** 复扫通过（路径 0 命中 + 全量密钥复扫 0 真实命中） | ✅ A1–A9 全绿（12:44:59 — 12:45:36） |
| 5 | 结论降级 **PASS WITH RISKS** → 可 push | ✅ 本版本已升级（RISK 见 §8） |

---

## 1. 验证快照与范围

### 1.1 仓库快照（2026-11-11T12:35:39+08:00）

```powershell
git status --porcelain=v1 -b; git rev-list --all --count; git rev-parse HEAD; git remote -v
```

输出摘要：

- 分支 `master`；**无 git remote**（`git remote -v` 空）
- commit 数 **26**（`git rev-list --all --count`）
- HEAD `2cb2d17af13ab995c5260cb694e99d391d52b78e`
- 工作树状态：已修改 `.gitignore`、`README.md`、`packages/dsh-tree-engine/index.js`；未跟踪 `agent.md`、`docs/reports/defect-2026-10-17-subagents-rc2-api-drift.md`、`docs/archive/project-restart-brief-2026-11-11.html` 以及 T1/T4 产出（验证过程中陆续落盘，见 1.3）

### 1.2 验证环境

```powershell
git --version; $PSVersionTable.PSVersion; [Environment]::OSVersion.VersionString
node --version   # bundled node
(Get-Item 'D:\DSHarness\DeepSeek Harness.exe').VersionInfo
```

输出摘要（2026-11-11T12:39:07+08:00 / 12:36:02+08:00）：

- git `2.56.0.windows.4`；Windows PowerShell `5.1.26100.9711`（.NET 4.0.30319.42000）；Windows NT `10.0.26300.0`
- bundled node `v24.21.0`（`%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）
- DSH 桌面 `D:\DSHarness\DeepSeek Harness.exe`：FileVersion **0.2.2-rc.1**，ProductVersion 0.2.2.0，FileDescription "DeepSeek Harness"

### 1.3 扫描面（关键：含未提交的新增文件）

| 轮次 | 时间戳 | tracked | untracked（非忽略） | 合计 |
|---|---|---|---|---|
| 工作树扫描 #1 | 12:36:13 | 96 | 18 | 114 |
| 工作树扫描 #2（终轮） | 12:38:30 | 96 | 21 | 117 |

- 未跟踪文件在验证期间持续增加：T1 `packages/dsh-session-tree/`（15 文件）、T4 `LICENSE`/`docs/operations/handoff-2026-11-11.md`、T1 `scripts/release-plugin.mjs`、`agent.md`、2 份 docs —— **均已纳入扫描**。
- 文本文件按 UTF-8 逐行扫描；3 个受跟踪 PNG 单独做**字节级**扫描（见 2.2）；受跟踪文件中**无 UTF-16 BOM 文件**（实测 0）。
- 被 git 忽略的文件实际存在数：**0**（`git status --ignored --porcelain` 无 `!!` 条目）。
- 未纳入：本报告自身（写入时不存在；按设计不含密钥/隐私值）；验证之后新产生的改动（以附录 A 复扫为准）。

---

## 2. 密钥扫描（最高优先级）

### 2.1 工作树（受跟踪 + 未忽略未跟踪；两轮）

模式（大小写不敏感处理）：`gh[pousr]_…`、`github_pat_…`、`sk-…`、`AKIA…`、`-----BEGIN … PRIVATE KEY-----`、`(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S{8,}`、`token\s*[:=]`、`xox[baprs]-…`、`AIza…`、`glpat-…`、`npm_…`、`hf_…`、`Bearer …`。命中只记录「文件:行 + 模式名」，**不输出命中值**。

```powershell
# 12:36:13（114 文件）与 12:38:30（117 文件）各一轮，逐行正则匹配
```

输出摘要：

- **HITS = 1（两轮相同）**：
  - `token_assign` @ `某客户端插件 client.js:28`（该插件已移除，非本项目组件）
  - 人工判读：该行是运行时单例所有权 token（`INSTANCE_TOKEN = ${CLIENT_REV}#${Date.now()}` 的消费点），**不是凭据**；上下文见同文件 L18-20 注释「单实例仲裁」。
- **真实密钥命中：0**。
- 读取错误：0 个文件。

### 2.2 二进制 / 图片

```powershell
# 对 3 个受跟踪 PNG 做 ISO-8859-1 字节级匹配（同 2.1 模式子集），并检查 PNG 文本块类型
```

输出摘要（12:37:52+08:00 / 12:39:16+08:00）：

- `demo/crop-topstrip-fixed.png`（25,951 B）：0 命中
- `demo/crop-topstrip.png`（28,019 B）：0 命中
- `demo/screen-2026-10-13.png`（1,949,061 B）：0 命中
- PNG 元数据：三张均只含 `pHYs`，**无 `tEXt`/`iTXt`/`zTXt`/`eXIf`**（无嵌入注释/作者信息）

### 2.3 git 全历史

```powershell
git --no-pager log -p --all --no-color   # 逐行流式扫描（含新增与删除行；唯一分支 master）
```

输出摘要（2026-11-11T12:36:48+08:00，耗时 826 ms）：

- 总行数 **19,886**；`^commit` 头 **26** 个（与 commit 数一致，覆盖 `--all` 全部历史）
- 预过滤候选行 43 行；**唯一命中**：`82f7b823 | 某客户端插件 client.js | token_assign`（同 2.1 的良性运行时 token；该文件在该 commit 引入，插件已移除）
- **真实密钥命中：0**
- 注：`git log -p` 同时扫描新增/删除行，因此「历史上曾提交后删除的密钥」也在覆盖范围内。

### 2.4 可疑文件名（当前树 + 全历史）

```powershell
git ls-files
git --no-pager log --all --name-only --format=''   # 历史出现过的全部路径，去重
```

输出摘要（12:36:59+08:00）：

- 历史出现过的文件：**104** 个；当前跟踪 96 个；历史有而当前无：8 个（均为旧测试遗留 `packages/dsh-tree-engine/11111111-…/*` 与 `scripts/asar-*.txt`，**非机密**）
- 匹配 `.env*` / `.npmrc` / `.netrc` / `id_rsa*` / `credentials*` / `secret*` / `*.pem|key|pfx|p12|keystore|jks|ppk|kdbx|ovpn|pcap` 的文件名：**当前树 0 个；全历史 0 个**
- 工作树内（含忽略区）真实存在的同类本地文件：**0 个**

### 2.5 `.gitignore` 与本地机密

- **初次检查（12:36:20+08:00）**：`node_modules/` ✓；但**未覆盖** `.env*`、`*.pem`、`*.p12`、`id_rsa*` → 已报告 Lead。
- **复查（12:38:31+08:00，D7 后）**：已补齐 `.env`、`.env.*`、`!.env.example`、`*.pem`、`*.p12`、`id_rsa*` ✓（`Get-Content .gitignore` 实测）。
- 结论：当前无本地机密文件、无忽略区残留；`.gitignore` 纵深防御已按建议补齐。

### 2.6 密钥扫描结论

**0 个真实密钥命中**（工作树两轮 + 全历史 + 二进制 + 本地文件/忽略区 + 可疑文件名）。唯一命中为良性运行时实例 token。**密钥维度无 BLOCK。**

> **历史重写后最终状态复扫**（2026-11-11 12:45，见附录 A6）：工作树 **113** 文件 + 全历史 **30** commits / 23,724 diff 行——仍为 **0 真实密钥**，命中仍只有同一条良性运行时 token（某客户端插件 `client.js:28`，该插件已移除）。

---

## 3. 隐私扫描

### 3.1 三张 demo 图片逐张结论

方法：`read_image` 逐张目视判读（12:36:20 — 12:36:40+08:00），另做 SHA-256 记录（12:39:16+08:00）。

| 文件 | 尺寸/大小 | 画面上可见内容（类别级） | 结论 |
|---|---|---|---|
| `demo/screen-2026-10-13.png` | 2886×2004 / 1,903.4 KB / SHA-256 `f7af16c8…ee6db3` | 左侧私有会话列表；Windows 桌面（个人文件夹、个人证券交易软件图标、资源悬浮窗）；应用窗口标题；聊天区+右侧文档（本项目技术内容） | **需处理（BLOCK-1）** |
| `demo/crop-topstrip.png` | 3600×270 / 27.4 KB / SHA-256 `06f20d18…09749b` | 仅应用顶栏：`Application`/`Edit`、胶囊「对话｜思维图｜元方法」、标题「dsh-tree-harness 依赖 enforceme…」、「20 subagents」「Agent Team」「Creator mode」 | **可公开** |
| `demo/crop-topstrip-fixed.png` | 3600×270 / 25.3 KB / SHA-256 `236413ca…5cd281` | 同上（修复后顶栏布局；无私有信息） | **可公开** |

- 引用检查：`git --no-pager grep -n -E 'screen-2026-10-13|crop-topstrip'` → 受跟踪文件 **0 引用**（exit 1）。`screen-2026-10-13.png` 为孤立素材，移除不影响文档链接。
- 说明：本报告**不复述**截图中的私有标题/文件夹名/IP 等具体文字（避免二次泄漏）。

### 3.2 BLOCK-1 处置状态

**已移交 Lead 处置（D7）**：工作树移除 + 历史清除；原件已复制到仓外备份目录并由 Lead 校验 SHA。备份 SHA 可与本报告 §3.1 记录的 `f7af16c8…` 对照。
**硬门禁**：清除后必须在**附录 A**复扫确认 `screen-2026` 在 `git log -p master` 与工作树中 **0 命中**。

### 3.3 补充：PII 正则扫描（非任务原列项，作为风险披露）

```powershell
# 对 tracked + untracked 全量文本扫描：本机绝对路径 / 用户名 / 盘符项目路径 / email / 私网 IP
```

输出摘要（2026-11-11T12:37:59+08:00，115 文件）：

- `C:\Users\<user>\` 形式的本机绝对路径：**16 行 / 7 个文件**
- 本机用户名（`sir_c`）：**17 行 / 7 个文件**
- `D:\Codes\…` 本地项目路径：**21 行 / 11 个文件**
- email：**0**；私网 IPv4：**0**
- **最终 HEAD 复扫（2026-11-11 12:45:35，113 个 tracked 文件）**：`C:\Users\<user>\` **26 行/9 文件**、用户名 **27 行/9 文件**、`D:\Codes\` **30 行/14 文件**（增量主要来自新增 `docs/architecture/merge-session-tree-2026-11-11.md` 与本报告自身）；email **0**、私网 IPv4 **0**。
- 判读：属「本机环境路径/用户名披露」，**经 D2「全部资料公开」决策显式接受**，列为 RISK-LOW（§8 R1），非 BLOCK。

---

## 4. 仓库健康

```powershell
git ls-files | Measure-Object
git ls-files | ForEach-Object { (Get-Item $_).Length }   # 逐文件大小
Get-ChildItem .git -Recurse -Force -File | Measure-Object -Property Length -Sum
git count-objects -vH; git rev-list --all --count
```

输出摘要（12:35:56 / 12:37:05 / 12:39:07+08:00）：

- 受跟踪文件 **96** 个；跟踪文件总大小 **3.01 MB**
- **>2 MB 的受跟踪文件：0 个**；最大为 `demo/screen-2026-10-13.png` 1,903.4 KB（= BLOCK-1 移除项），其后 `demo/agspec/_subagent-index.js` 132.1 KB（= BLOCK-2 移除项），再后 `docs/archive/frozen-parent-plan/PLAN-v1.7.md` 85.6 KB
- **无 node_modules / 构建产物**：`git ls-files` 中匹配 `node_modules|dist|build|out|coverage|target|vendor/` 及 `*.tgz|zip|exe|dll|map|woff|ttf` 等 → **NONE**
- `.git` 目录总大小 **3.80 MB**；`count-objects -vH`：**317 objects / 3.74 MiB**，0 pack（全 loose）；commit **26**
- 结论：仓库体积健康、无构建产物污染。**无 remote**（零备份）记入 RISK（§8 R2）。

**历史清除后最终状态复扫（2026-11-11 12:45:31，HEAD `4062974`）**：

- 受跟踪文件 **113** 个；跟踪文件总大小 **1,411,789 B ≈ 1.35 MB**；最大单文件 **85.6 KB**（`docs/archive/frozen-parent-plan/PLAN-v1.7.md`）；**>2 MB 文件 0 个**；`demo/agspec/` 下仅剩 6 个保留文件（`_extract.cjs` + w1–w4），7 个 D7 文件均不在树中。
- `.git` 目录 **0.64 MB（652.49 KiB）**；`count-objects -vH`：**360 objects / 1 pack / size-pack 609.35 KiB**；commit **30**（原 26 + 4 个本轮 commit）；`git fsck --full --no-reflogs` **0 行输出（干净）**；`unreachable/dangling` **0**；reflog **0 条**；无 alternates。
- 最大 blob **87,653 B**，`blobs_over_1MB = 0` → 历史 6.9MB 垃圾 blob 已回收；`.git` 体积 3.80 MB → **0.64 MB**（-83%）。

---

## 5. 测试基线

命令（bundled node；显式 `tests/*.test.js` 文件形参，未用 `node --test tests` 目录形参）：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
# workdir: packages\dsh-tree-engine
& $node --test tests/*.test.js
```

输出摘要：

| 套件 | 时间戳 | tests | pass | fail | 退出码 | duration |
|---|---|---|---|---|---|---|
| `packages/dsh-tree-engine` | 12:36:50 — 12:36:52 | 62 | **62** | 0 | **0** | 1900.47 ms |

- node：`v24.21.0`
- 运行对象是**当前工作树（含未提交改动）**，与当时 `agent.md` §2 的「62/62、13/13」一致（另有一套 13 项测试属当时仓内一个已移除的独立插件，非本项目组件）。
- 结论：**测试基线通过**（无 fail / 无 cancelled / 无 skipped）。
- **最终 HEAD 复扫（2026-11-11 12:45:32，HEAD `4062974`，工作树 clean）**：tree-engine **62/62 exit 0**、另一已移除插件 13/13 exit 0——与重写前一致，代码改动已随 4 个 commit 入库后仍全绿。

---

## 6. 合并包一致性（T1 产出 vs 发布源）

对象：源 `C:\Users\sir_c\Documents\deepseek-harness\default-workspace\publish\dsh-session-tree`（15 文件）↔ 目标 `D:\Codes\dsh-tree-harness\packages\dsh-session-tree`（15 文件，验证时为 untracked）。

方法：两侧逐文件 `git hash-object`（**不带 `-w`**，只读、不写对象库）比对。

```powershell
# 12:37:20 与 12:38:01 各比对一次（两次结果一致，确认 T1 未再变更）
git hash-object -- <src>/<rel>; git hash-object -- <dst>/<rel>
```

输出摘要（2026-11-11T12:37:20+08:00；12:38:01+08:00 复验）：

- 文件清单：src 15 / dst 15；**仅在一侧存在：0**
- **内容哈希一致：15 / 15；不一致：0**
- 包元数据：两侧 `name=@orphiczhou/dsh-session-tree`，`version=1.0.4`（符合 D6 不 bump）

| 文件 | blob SHA-1（=两侧相同） |
|---|---|
| `.gitignore` | `c023bb18ed5fde4becbbf7f4b01fd3b9f8a691a5` |
| `client.js` | `02a7f4e1dac5a9ad8ae6d2c389f924e75aac1c75` |
| `cordis.patch.yml` | `30a1c65a472011979621607309f0d7dccba50310` |
| `icon.svg` | `5fe691edba196364eb8db19ff35dbcaad625d9aa` |
| `index.js` | `cb2afa7a4f0a1b0c809bf28e36014a42a0a9db9f` |
| `LICENSE` | `d06e23ffcbb0f48f3c1c781d4f6fb31593a637a5` |
| `locale/en.json` | `b26c1611125ac272a94ffa25a2e498b0426cb141` |
| `locale/zh.json` | `30d2f227e32fe4e3fc2083a2cf5e536dd0e33c59` |
| `package.json` | `331cac56c74adb2346df9d111148cf52b7c5ddc7` |
| `README.md` | `21e4d978ba105dada986b3381414165b3e5c997f` |
| `README.zh.md` | `c5cd1aa2f385ae76999a598880aae8eac19b828e` |
| `scripts/verify-bundle.mjs` | `0e4eeca6d4498116a607853a2c7347f7bcdf6fc3` |
| `test/provider-conformance.cjs` | `adc18cdbb94890e93b4d206021b53ef4fd1a3d2a` |
| `test/render.test.cjs` | `5c13929deceebb2127200e4279fc4e3a84ed961f` |
| `test/style-guard.cjs` | `f597415ba7366f747e3803393e2c0dd144104054` |

- 备注：目标目录在验证时尚未纳入版本控制；上表 blob SHA-1 为内容寻址哈希，commit 后可用 `git ls-tree` 复核同一组值。
- 结论：**合并包与发布源逐字节一致**。

---

## 7. 活体快照（运行环境）

> 本节为 **2026-11-11 12:37 的活体快照**（T2 profile 迁移动作之前）。profile 迁移属本机装配状态，不影响公开仓内容的验证结论；迁移后活体复核由 merge-engineer 的 T2 任务负责。

### 7.1 `cordis_inspect_list`（客户端/宿主 Inspect Provider）

```text
客户端 provider：Service, Event, Builtin, Slots, Theme, Regions, meta-adapter-ui, nanju-ui, SessionTree
宿主 provider：Service, Event, Config, Tool
```

判读：

- **`SessionTree` ✓ 在线**（提供 `snapshot`：rows/groupCount/rowCount）
- **`Regions` ✓ 在线**（提供 `outline`/`snapshot`/`failures`）
- **某已移除插件的 `*-ui` provider ✗ 不在线**（该插件非本项目组件，源码已随 2026-11-11 清理移除；非发布阻塞）
- 另有 `meta-adapter-ui`、`nanju-ui` 两个已装配插件 provider（与本次发布无直接关系，仅记录环境事实）

### 7.2 宿主 Config 目录总量

```text
cordis_inspect_query platform=host provider=Config method=listConfigs input={"limit":1}
→ entries[0].id="include", name="cordis:include", total=248, nextOffset=1
```

- **total = 248**（与 `agent.md` §2 的「宿主 loader 账本 248 条」一致），时间 12:37:31+08:00。

### 7.3 宿主 subagents Service 方法表（RC2 契约核对）

```text
cordis_inspect_query platform=host provider=Service method=listService input={"service":"subagents"}
```

输出摘要：15 个方法条目 / 16 个签名：

`resolveMaxDepth`、**`startActivation`（2 个重载）**、`waitForChildren`、**`sendMessage`**、**`interrupt`**、`drainDescendants`、`drainChildren`、`listChildren`、`listDescendants`、`prompt`(@Remote)、`interruptByParent`(@Remote)、`registerProvider`、`getProvider`、`list`

判读（逐项核对任务要求）：

- **无 `startContinuable`** ✓（任务要求确认其不存在——RC2 宿主已移除旧契约，`packages/dsh-tree-engine` 的 RC2 兼容层正是为此）
- **有 `startActivation` ✓ / `sendMessage` ✓ / `interrupt` ✓**
- 结论：**活体契约与 RC2 兼容层假设一致**。

### 7.4 DSH 桌面版本

`D:\DSHarness\DeepSeek Harness.exe` → FileVersion **0.2.2-rc.1**（ProductVersion 0.2.2.0），与 `agent.md` §2 一致。

---

## 8. 风险清单（非 BLOCK，公开后仍存在）

| ID | 等级 | 风险 | 证据 / 建议 |
|---|---|---|---|
| R1 | LOW | 本机路径/用户名披露：`C:\Users\<user>\` 16 行/7 文件、`sir_c` 17 行/7 文件、`D:\Codes\` 21 行/11 文件 | 经 **D2「全部资料公开」** 显式接受；如需降噪可后续替换为占位路径（非阻塞，勿在推送前改动已锁定内容） |
| R2 | MED | **推送前无 git remote = 零备份** | 历史重写前已做仓外 `git bundle` 备份（Lead 侧，3.58MB，不在仓内）；**push 后立即核对远端 HEAD 并配置分支保护**；本项随推送完成即消除 |
| R3 | LOW | **历史重写已完成**：全部 commit SHA 已变化（新 HEAD `4062974`，30 commits）；本报告 §0.3/§2.3 中 `2cb2d17`/`6de30d1`/`439976f`/`82f7b82` 等均为 **pre-rewrite 坐标** | 发布核对以新 HEAD 为准；`packages/dsh-session-tree` v1.0.4 不 bump（D6），market 判定不受影响 |
| R4 | LOW | 密钥防护仅依赖 `.gitignore` + 人工扫描，无 CI 侧 secret scanning | 建议 push 后开启 GitHub secret scanning / push protection 作为纵深（非阻塞） |
| R5 | ~~LOW~~ **已关闭** | 移除 BLOCK-2 后 `demo/agspec/w2-source.md` 的摘录清单可能留下指向已删文件的悬空引用 | **2026-11-11 12:41 复查：已解决**——该文件已更新（工作区 M），新增「公开仓说明（D7）」块覆盖全部 6 个第三方文件并注明「已移除」+ 备份位置，且明确 `_extract.cjs` 保留 |
| R6 | INFO | 某已移除插件的 client provider 未装配（该插件非本项目组件） | 属装配状态而非发布缺陷；本报告仅记录活体事实 |
| R7 | — | ~~历史清除尚未执行~~ **已关闭（2026-11-11 12:44 完成）** | 附录 A 全绿；旧 HEAD/对象/refs 全部不可达 |
| R8 | INFO | `.git/refs/original/` 为 filter-branch 留下的**空目录**（0 条 refs；`for-each-ref` 只有 `refs/heads/master`；无对象泄漏） | 纯装饰性残留，不影响 push（push 只传对象与 refs）；可选 `Remove-Item .git/refs/original` 清理 |
| R9 | INFO | `git log -p` 正文出现已删除文件名（附录 A3 的 42 条正文命中） | 全部来自 `agent.md` D7 说明、`demo/agspec/w2-source.md` 移除说明、本报告与 commit message——**属 D7 透明记录，不是内容泄漏**；文件内容/对象均为 0 |

---

## 附录 A：推送前硬门禁（复扫记录）— **✅ PASS（2026-11-11 12:44:59 — 12:45:36）**

> 执行前提：Lead 完成「D7 的 7 个文件工作树移除 + 全部改动提交 + git 历史清除（含 2 个瘦身路径）」并通知；复扫时 **HEAD `40629745f1df16d67706223bb73ce67d1e67055c`、30 commits、工作树 clean**，Lead 承诺复扫期间冻结历史。
> 复扫正则（覆盖 7 个剔除路径 + 2 个瘦身路径）：`'screen-2026|_subagent-index|_tool-subagent|_driver\.js|_fork\.js|_spawn\.js|asar-(out|err)\.txt'`

| 项 | 检查 | 实测结果（2026-11-11 +08:00） | 结论 |
|---|---|---|---|
| A1 | `git ls-files \| Select-String <正则>` | 12:44:59：tracked=**113**，**hits=0** | ✅ |
| A2 | `Test-Path` 9 路径 | 7 个 D7 文件 **全部 False**；2 个瘦身路径 **False**；保留项 `_extract.cjs`/`w2-source.md`/2 张 crop = True | ✅ |
| A3 | `git --no-pager log -p --all`：**文件头**扫描（`diff --git` / `--- a/` / `+++ b/` / rename / new / deleted） | 23,724 行 / 30 个 commit 头；**文件头命中 = 0**；正文命中 42（见说明①） | ✅ |
| A3b | 9 路径逐路径 `git log --all --oneline -- <path>` | 每个路径 **commits = 0** | ✅ |
| A3c | 重写前对象残留扫描 | `git cat-file --batch-all-objects` 前缀：`2cb2d17`/`6de30d1`/`439976f`/`82f7b82`/`dc7c27d` → **0 个对象**；旧 HEAD `git cat-file -e` = **False** | ✅ |
| A4 | `git log --all --diff-filter=A --name-only \| Select-String`（历史新增文件名） | **hits = 0** | ✅ |
| A5 | `git rev-list --objects --all \| Select-String`（历史对象路径） | **hits = 0** | ✅ |
| A6 | 全量密钥复扫（工作树 tracked+untracked / `git log -p --all` / 二进制 PNG） | 工作树 113 文件 **1 良性命中**（某已移除插件 `client.js:28` 运行时 token）；历史 23,724 行 / 30 commits **1 良性命中**（`c60f8996`|client.js，同一 token）；2 个 PNG 字节级 **0**；**0 真实密钥** | ✅ |
| A7 | `.gitignore` D7 条目 | `.env` / `.env.*` / `*.pem` / `*.p12` / `id_rsa*` 各 1 条，**全部在** | ✅ |
| A8 | 新 HEAD / 时间戳 | HEAD `40629745f1df16d67706223bb73ce67d1e67055c`；**30 commits**；`git status` clean；refs 仅 `refs/heads/master`；packed-refs 仅 master；reflog **0 条**；`ORIG_HEAD` 不存在 | ✅ |
| A9 | 历史瘦身效果 | `count-objects`：**360 objects / 1 pack / 609.35 KiB**；`.git` **0.64 MB（652.49 KiB）**（重写前 3.80 MB / 317 objects）；最大 blob **87,653 B**、`blobs_over_1MB = 0`；`git fsck --full --no-reflogs` **0 行**、unreachable/dangling **0** | ✅ |
| A10 | 结构完整性补充（非原门禁项） | `demo/agspec/` 仅剩 6 个保留文件；2 张 crop SHA-256 与重写前一致（`06f20d18…` / `236413ca…`）；最终 HEAD 测试 tree-engine **62/62**（另一已移除插件 13/13，exit 0） | ✅ |

**结论：A1–A9（含补充 A3b/A3c/A10）全部通过 → §0.1 升级为 PASS WITH RISKS，可 push。**

**说明（独立判读）**：
① **A3 的语义口径**：`git log -p` 正文出现文件名字符串 ≠ 文件存在。实测**文件头命中 0**（7 个文件从未作为 diff 的 a/b 路径出现）、**对象路径命中 0**、**逐路径提交 0**，证明旧文件内容已不在历史；42 条正文命中全部是**文档对「已移除文件」的名称说明**（`agent.md` D7、`demo/agspec/w2-source.md` 移除说明、本报告 §0.2/§0.3、`docs/archive/handoff-2026-10-14.md` 对 asar 文件的说明，以及 `.gitignore` 新增行的 commit 上下文），**非内容泄漏**（R9）。
② **保留的分析笔记**：`demo/agspec/w2-source.md` 仍含对这些第三方源码的**分析笔记**（D2 公开范围）；源码全文文件已不在树/历史。该笔记是否保留由 Lead 决定，不属本门禁。
③ **残留装饰**：`.git/refs/original/` 为空目录（0 refs、无对象），不构成泄漏（R8）。
④ **本报告更新不影响结论**：v1.2 修改仅新增文字（把附录 A 从 PENDING 填为 PASS），**不新增/删除任何文件路径**；本报告内容已做同套密钥自扫（0 命中）。因此 A1–A5/A9 的结构性结论对「提交本报告后的新 HEAD」同样成立；唯一变化是 HEAD 会因该 docs-only commit 再前进一格。

---

## 附录 B：方法与局限

- **只读纪律**：未执行任何 git 写命令（add/commit/push/reset/rm/filter 均无）；未修改除本报告外的任何文件；未访问外部网络；未下载/安装任何东西。
- **扫描实现**：PowerShell 5.1 逐行正则（UTF-8，含 BOM 自动识别）；命中仅记录「模式名+文件:行」，**输出不含命中值**；git 历史用 `git log -p --all` 流式扫描（历史重写前 26 commit、重写后复扫 30 commit，含删除行）。
- **覆盖边界**：① PNG 以字节级扫描替代文本扫描（重写前 3 张 / 复扫时 2 张，0 命中）；② 密钥扫描是**模式匹配**，不是熵/语义全检（可能漏掉非常规格式凭据，但对常见凭据族覆盖完整）；③ 隐私目视仅覆盖 3 张 demo 图 + PII 正则，**未**对全部 docs 做人工通读（其余内容按 D2 公开）；④ 复扫时已入库的 v1.1 报告已纳入工作树扫描（113 文件）；v1.2 的修改另做同套密钥自扫（0 命中），且不含私有画面文字（按脱敏原则撰写）。
- **时间口径**：全部为本机 +08:00；「输出摘要」为命令原始输出的摘录，非二次改写。
- **结论边界**：本报告只回答「可否公开推送」的**技术证据**问题；D7 的许可/法务判断、GitHub 侧设置、push 操作均属 Lead 职责。

---

## 附录 C：证据时间线

| 时间（+08:00） | 项 | 结果 |
|---|---|---|
| 12:35:32 | 开始验证（读 agent.md：D2 全部公开 + 密钥例外） | — |
| 12:35:39 | 仓库基线：26 commits / HEAD 2cb2d17 / 无 remote | 记录 |
| 12:35:56 | `git ls-files` / 大文件 / `.git` 体积 | 96 文件 / 3.01 MB / 0 个 >2MB / .git 3.80 MB |
| 12:36:13—12:36:14 | **工作树密钥扫描 #1**（114 文件） | 1 良性命中，0 真实密钥 |
| 12:36:20 | `.gitignore` 初检 | 缺 `.env*` 等（已报 Lead，D7 补齐） |
| 12:36:20—12:36:40 | `read_image` 三张 demo 图 | **BLOCK-1：screen 需处理**；2 张 crop 可公开 |
| 12:36:48 | **git 全历史密钥扫描**（19,886 行 / 26 commits） | 1 良性命中（82f7b823），0 真实密钥 |
| 12:36:50—12:36:53 | 测试基线 | tree-engine 62/62 exit 0；另一已移除插件 13/13 exit 0 |
| 12:36:59 | 历史文件名清单（104 个） | 可疑文件名 0 个 |
| 12:37:20 | **合并包哈希比对 #1** | 15/15 一致，v1.0.4 |
| 12:37:31 | 活体：Config total / subagents Service | total=248；无 startContinuable，有 startActivation/sendMessage/interrupt |
| 12:37:52 | PNG 字节级扫描 | 0 命中；仅 pHYs 块 |
| 12:37:59 | PII 正则扫描 | 本机路径 16 行/7 文件；用户名 17 行/7 文件；email 0 |
| 12:38:01 | **合并包哈希比对 #2（复验）** | 15/15 一致（T1 稳定） |
| 12:38:30—12:38:31 | **工作树密钥扫描 #2（终轮，117 文件）** | 1 良性命中，0 真实密钥 |
| 12:38:31 | `.gitignore` 复查（D7 后） | `.env*`/`*.pem`/`*.p12`/`id_rsa*` 已补齐 ✓ |
| 12:38:35 | BLOCK 文件历史位置核查 | screen→6de30d1；3 个第三方源码→439976f |
| 12:39:07 | 环境元数据 | git 2.56.0 / PS 5.1 / node v24.21.0 / DSH 0.2.2-rc.1 |
| 12:39:16 | BLOCK 文件 SHA-256 基线 | 见 §0.2 / §3.1 |
| 12:40 | 本报告 v1.0 写入 | BLOCK；附录 A PENDING |
| 12:40:50 | D7 扩大复核：`_driver.js`/`_fork.js`/`_spawn.js` 头部 `@deepseek-ai` import + `@module` 确认；SHA-256 记录 | BLOCK-2 扩为 6 文件 |
| 12:41:30 | 历史瘦身项核查：`scripts/asar-err.txt` 历史 blob 6,902,314 B、`asar-out.txt` 0 B；均已不在工作树/.gitignore 覆盖 | 记录 |
| 12:41:50 | R5 复查：`w2-source.md` 已加 D7「已移除」说明 | R5 关闭 |
| 12:42 | 本报告 **v1.1** 更新（BLOCK-2 6 文件 + 瘦身项 + 附录 A 7+2 路径 + A9） | BLOCK；附录 A PENDING |
| 12:44:30 | Lead 通知历史清除完成（HEAD `4062974`、30 commits、工作树 clean）；**开始 A1–A9 复扫** | — |
| 12:44:59 | A1/A2/A7/A8（路径、refs、gitignore） | A1 **0**；A2 9 路径全 False；A7 全在；refs 仅 master；reflog 0 |
| 12:45:00—12:45:02 | A3/A4/A5 + 旧对象残留 | **文件头 0**；A4 **0**；A5 **0**；9 路径 log 全 0；旧 HEAD 不存在 |
| 12:45:02—12:45:03 | A9 对象库 / fsck / 瘦身 | 360 objects / 1 pack / **609.35 KiB**；`.git` 0.64 MB；max blob 87,653 B；fsck 0 行、unreachable 0 |
| 12:45:03—12:45:05 | A6 密钥复扫（工作树 113 文件 + 历史 23,724 行/30 commits + 2 PNG） | 各 1 条良性命中，**0 真实密钥** |
| 12:45:31 | 最终树结构 / 保留文件 / 大文件核查 | `demo/agspec` 仅 6 个保留文件；**0 个 >2MB**；tracked 113 / 1.35 MB |
| 12:45:32 | 最终 HEAD 测试复跑 | tree-engine **62/62**、另一已移除插件 **13/13**，exit 0 |
| 12:45:35 | crop SHA / PII 复扫 | crop SHA 与重写前一致；PII 用户名 27 行/9 文件、email 0、私网 IP 0 |
| 12:46 | **复扫结论：A1–A9 全绿 → PASS WITH RISKS** | **可 push** |
| 12:47 | 本报告 **v1.2** 写入（结论升级 + 附录 A 实测回填） | PASS WITH RISKS |

---

*报告结束。本文件为 T3（task-2）唯一交付物；未修复任何问题（BLOCK 均移交 Lead），未执行 git 写操作。*

## 附录 D：报告变更记录

| 版本 | 时间（+08:00） | 变更 |
|---|---|---|
| v1.0 | 2026-11-11 12:40 | 首版：工作树/历史密钥扫描、3 图隐私判读、仓库健康、测试基线、合并包哈希、活体快照；BLOCK-1（隐私截图）、BLOCK-2（3 个第三方源码）；附录 A 初版 A1–A8 |
| v1.1 | 2026-11-11 12:42 | 依 Lead 通知：BLOCK-2 由 3 个文件扩大为 **6 个**（新增 `_driver.js`/`_fork.js`/`_spawn.js`，附 SHA 与历史位置）；D7 追加 2 个历史瘦身路径（`scripts/asar-out.txt`/`asar-err.txt`，含 6.9MB 历史 blob）；附录 A 更新为 7+2 路径并新增 A9（瘦身效果）；R5 关闭；新增本变更记录 |
| **v1.2** | **2026-11-11 12:47** | **历史清除后复扫回填**：A1–A9（+A3b/A3c/A10）全绿 → 结论 **BLOCK → PASS WITH RISKS（可 push）**；附录 A 填实测输出与新 HEAD `4062974`；§0.2 两项 BLOCK 标「已处置完成」、§0.4 全满足；R2/R3/R7 更新、新增 R8/R9；§4/§5/§7 补最终 HEAD 复扫数据 |
