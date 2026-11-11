# 公开前独立验证报告（T3 / 决策 D2）

> **验证者**：qa-verifier（独立验证角色：只读仓库与运行环境，仅写本文件）
> **仓库**：`D:\Codes\dsh-tree-harness`，当前分支 `master`，HEAD `2cb2d17af13ab995c5260cb694e99d391d52b78e`（**历史重写前快照**）
> **验证时间窗口**：2026-11-11 12:35:32 — 12:40（+08:00）
> **报告版本**：v1.1（2026-11-11 12:42+08:00；依 Lead 通知将 D7 清单由 4 个文件扩大为 **7 个**，并追加 2 个历史瘦身路径，附录 A 复扫清单同步更新）；**附录 A（推送前硬门禁）为 PENDING，待 Lead 完成历史清除后由验证者复扫填写**
> **结论等级**：**BLOCK（暂缓公开推送）**

---

## 0. 结论（置顶）

### 0.1 结论等级

**BLOCK**：**当前状态不能公开推送**。

发现 **2 项 BLOCK 级问题**，均已移交 Lead 处置（`agenda.md` 决策 **D7**，2026-11-11）。在 D7 全部执行完成（工作树排除 + **git 历史清除**）并通过**附录 A 复扫**之前，本报告不判定 PASS。

> ⚠️ **公开推送前必须确认历史清除完成。** 本次 BLOCK 文件均存在于 git 历史（见 0.3）；仅从工作树删除不够——`git log -p` 仍可检出，一旦 push 即永久公开、不可撤回。
>
> **注**：本报告交付完成（T3 任务完成）**不等于**发布放行；放行判定以 **附录 A 全部通过**为准（复扫完成前，本报告结论维持 BLOCK）。

### 0.2 BLOCK 级问题清单（醒目）

| ID | 类型 | 对象 | 处置状态 |
|---|---|---|---|
| **BLOCK-1** | **隐私** | `demo/screen-2026-10-13.png` | **已移交 Lead 处置（D7）**：工作树移除 + 历史清除；原件已移出仓库备份（SHA 已校验） |
| **BLOCK-2** | **第三方源码再分发风险** | `demo/agspec/` 下 6 个文件：`_subagent-index.js`、`_tool-subagent.js`、`_tool-subagent.md`、`_driver.js`、`_fork.js`、`_spawn.js` | **已移交 Lead 处置（D7）**：同上（本项由 Lead 判定并两轮复核：初判 3 个，2026-11-11 复核后扩大为 6 个；本报告提供其存在、SHA 与历史位置证据） |

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

输出摘要：7 个文件**全部**存在于当前 HEAD 可达历史（`screen-*`→`6de30d1`，6 个第三方源码→`439976f`），且当前均受 git 跟踪（`git ls-files` 可见）。历史重写后全部 commit SHA 都会变化，本报告其它 SHA 均为**重写前**快照。

**历史瘦身项（非安全，Lead 追加，随历史重写一并清除）**

| 路径 | 当前工作树 | 历史 blob / 大小 | 历史位置 |
|---|---|---|---|
| `scripts/asar-err.txt` | **不存在**（已被 `.gitignore` 忽略） | `6365dc52…` / **6,902,314 B**（旧 PowerShell 报错转储） | `dc7c27d` 引入 → `2cb2d17` 删除 |
| `scripts/asar-out.txt` | **不存在**（已被 `.gitignore` 忽略） | `e69de29b…` / **0 B**（空文件） | `dc7c27d` 引入 → `2cb2d17` 删除 |

```powershell
git --no-pager rev-list --objects --all | Where-Object { $_ -match 'scripts/asar-(out|err)\.txt$' }  # 再 git cat-file -s <blob>
```

输出摘要（2026-11-11T12:41:30+08:00）：如上两行；6.9MB 大 blob 仅存于历史、工作树已无（`.gitignore` L17-18 有对应条目）。

### 0.4 解除条件

1. D7 清单 **7 个文件**从**工作树**移除（并做等价备份，Lead 已执行，SHA 见 §0.2/§0.3）。
2. D7 清单 **7 个文件**从**全部 git 历史**清除（filter-repo/filter-branch 类重写；本仓无 remote，重写安全）。
3. **历史瘦身**：`scripts/asar-out.txt`、`scripts/asar-err.txt` 两个历史 blob（含 6,902,314 B 大文件）随历史重写一并回收（非安全项）。
4. 本报告**附录 A** 复扫通过（7 个文件名在历史与工作树 **0 命中** + 2 个瘦身路径对象 **0 命中** + 全量密钥复扫 0 真实命中）。
5. 复扫通过后，结论降级为 **PASS WITH RISKS**（RISK 清单见 §8），方可 push。

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
- 工作树状态：已修改 `.gitignore`、`README.md`、`packages/dsh-meta-loop/panel/index.html`、`packages/dsh-tree-engine/index.js`；未跟踪 `agenda.md`、`docs/defect-2026-10-17-subagents-rc2-api-drift.md`、`docs/project-restart-brief-2026-11-11.html` 以及 T1/T4 产出（验证过程中陆续落盘，见 1.3）

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

- 未跟踪文件在验证期间持续增加：T1 `packages/dsh-session-tree/`（15 文件）、T4 `LICENSE`/`docs/handoff-2026-11-11.md`、T1 `scripts/release-plugin.mjs`、`agenda.md`、2 份 docs —— **均已纳入扫描**。
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
  - `token_assign` @ `packages/dsh-meta-loop/client.js:28`
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
- 预过滤候选行 43 行；**唯一命中**：`82f7b823 | packages/dsh-meta-loop/client.js | token_assign`（同 2.1 的良性运行时 token；该文件在该 commit 引入）
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
- **>2 MB 的受跟踪文件：0 个**；最大为 `demo/screen-2026-10-13.png` 1,903.4 KB（= BLOCK-1 移除项），其后 `demo/agspec/_subagent-index.js` 132.1 KB（= BLOCK-2 移除项），再后 `docs/frozen-parent-plan/PLAN-v1.7.md` 85.6 KB
- **无 node_modules / 构建产物**：`git ls-files` 中匹配 `node_modules|dist|build|out|coverage|target|vendor/` 及 `*.tgz|zip|exe|dll|map|woff|ttf` 等 → **NONE**
- `.git` 目录总大小 **3.80 MB**；`count-objects -vH`：**317 objects / 3.74 MiB**，0 pack（全 loose）；commit **26**
- 结论：仓库体积健康、无构建产物污染。**无 remote**（零备份）记入 RISK（§8 R2）。

---

## 5. 测试基线

命令（bundled node；显式 `tests/*.test.js` 文件形参，未用 `node --test tests` 目录形参）：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
# workdir: packages\dsh-tree-engine
& $node --test tests/*.test.js
# workdir: packages/dsh-meta-loop
& $node --test tests/*.test.js
```

输出摘要：

| 套件 | 时间戳 | tests | pass | fail | 退出码 | duration |
|---|---|---|---|---|---|---|
| `packages/dsh-tree-engine` | 12:36:50 — 12:36:52 | 62 | **62** | 0 | **0** | 1900.47 ms |
| `packages/dsh-meta-loop` | 12:36:52 — 12:36:53 | 13 | **13** | 0 | **0** | 229.78 ms |

- node：`v24.21.0`
- 运行对象是**当前工作树（含未提交改动）**，与 `agenda.md` §2 的「62/62、13/13」一致。
- 结论：**测试基线通过**（无 fail / 无 cancelled / 无 skipped）。

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

### 7.1 `cordis_inspect_list`（客户端/宿主 Inspect Provider）

```text
客户端 provider：Service, Event, Builtin, Slots, Theme, Regions, meta-adapter-ui, nanju-ui, SessionTree
宿主 provider：Service, Event, Config, Tool
```

判读：

- **`SessionTree` ✓ 在线**（提供 `snapshot`：rows/groupCount/rowCount）
- **`Regions` ✓ 在线**（提供 `outline`/`snapshot`/`failures`）
- **`meta-loop-ui` ✗ 不在线**（与 `agenda.md` §2「meta-loop 未装配」一致；非发布阻塞）
- 另有 `meta-adapter-ui`、`nanju-ui` 两个已装配插件 provider（与本次发布无直接关系，仅记录环境事实）

### 7.2 宿主 Config 目录总量

```text
cordis_inspect_query platform=host provider=Config method=listConfigs input={"limit":1}
→ entries[0].id="include", name="cordis:include", total=248, nextOffset=1
```

- **total = 248**（与 `agenda.md` §2 的「宿主 loader 账本 248 条」一致），时间 12:37:31+08:00。

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

`D:\DSHarness\DeepSeek Harness.exe` → FileVersion **0.2.2-rc.1**（ProductVersion 0.2.2.0），与 `agenda.md` §2 一致。

---

## 8. 风险清单（非 BLOCK，公开后仍存在）

| ID | 等级 | 风险 | 证据 / 建议 |
|---|---|---|---|
| R1 | LOW | 本机路径/用户名披露：`C:\Users\<user>\` 16 行/7 文件、`sir_c` 17 行/7 文件、`D:\Codes\` 21 行/11 文件 | 经 **D2「全部资料公开」** 显式接受；如需降噪可后续替换为占位路径（非阻塞，勿在推送前改动已锁定内容） |
| R2 | MED | **无 git remote = 零备份**；历史重写期间若误操作无远端可恢复 | 推送前先在本地保留完整备份（Lead 侧操作）；推送后立即确认 remote/分支保护 |
| R3 | LOW | 历史重写导致**全部 commit SHA 变化**；本报告 HEAD/commit 数/文件数为 pre-rewrite 快照 | 发布核对以重写后新 HEAD 为准；`packages/dsh-session-tree` v1.0.4 不 bump（D6），market 判定不受影响 |
| R4 | LOW | 密钥防护仅依赖 `.gitignore` + 人工扫描，无 CI 侧 secret scanning | 建议 push 后开启 GitHub secret scanning / push protection 作为纵深（非阻塞） |
| R5 | ~~LOW~~ **已关闭** | 移除 BLOCK-2 后 `demo/agspec/w2-source.md` 的摘录清单可能留下指向已删文件的悬空引用 | **2026-11-11 12:41 复查：已解决**——该文件已更新（工作区 M），新增「公开仓说明（D7）」块覆盖全部 6 个第三方文件并注明「已移除」+ 备份位置，且明确 `_extract.cjs` 保留 |
| R6 | INFO | `meta-loop-ui` client provider 未装配（agenda 已记录） | 属装配状态而非发布缺陷；本报告仅记录活体事实 |
| R7 | — | **历史清除尚未执行**（BLOCK 解除条件） | 见 **附录 A**（PENDING）；清除完成后由验证者复扫 |

---

## 附录 A：推送前硬门禁（复扫记录）— **PENDING**

> **触发条件**：Lead 完成「D7 **7 个文件**工作树移除 + 全部改动提交 + git 历史清除（含 2 个瘦身路径）」后，通知 qa-verifier 执行本附录。
> **A1–A9 全部通过前，本报告结论维持 BLOCK，禁止 push。**
> 复扫正则（统一使用，覆盖 7 个剔除路径 + 2 个瘦身路径）：
> `'screen-2026|_subagent-index|_tool-subagent|_driver\.js|_fork\.js|_spawn\.js|asar-(out|err)\.txt'`

| 项 | 检查 | 通过标准 | 状态 / 结果 |
|---|---|---|---|
| A1 | `git ls-files \| Select-String <复扫正则>`（工作树跟踪清单） | 0 行 | ⏳ PENDING |
| A2 | `Test-Path` D7 的 7 个文件（2 个瘦身路径按「不存在」计） | 全部 False | ⏳ PENDING |
| A3 | `git --no-pager log -p master \| Select-String <复扫正则>`（**全历史逐行**） | **0 命中** | ⏳ PENDING |
| A4 | `git --no-pager log --all --diff-filter=A --name-only \| Select-String <复扫正则>`（历史新增文件名） | 0 命中 | ⏳ PENDING |
| A5 | `git --no-pager rev-list --objects --all \| Select-String <复扫正则>`（**历史对象路径**） | 0 命中 | ⏳ PENDING |
| A6 | 全量密钥复扫（工作树 tracked+untracked / `git log -p master` / 二进制 PNG） | 0 真实命中（良性运行时 token 除外） | ⏳ PENDING |
| A7 | `.gitignore` 仍含 D7 条目（`.env*`、`*.pem`、`*.p12`、`id_rsa*`） | 全部存在 | ⏳ PENDING |
| A8 | 记录复扫时的**新 HEAD** 与时间戳（重写后 SHA 全变） | 写入本表 | ⏳ PENDING |
| A9 | 历史瘦身效果：`git count-objects -vH` / `.git` 体积 / `git rev-list --all --count` | 无 6.9MB 大 blob；记录 `.git` 体积变化（重写前 3.80 MB / 317 objects） | ⏳ PENDING |

（复扫完成后，本节将填写「时间戳 / 新 HEAD / 每项实测输出摘要 / 最终结论」，并把 §0.1 降级为 PASS WITH RISKS。）

---

## 附录 B：方法与局限

- **只读纪律**：未执行任何 git 写命令（add/commit/push/reset/rm/filter 均无）；未修改除本报告外的任何文件；未访问外部网络；未下载/安装任何东西。
- **扫描实现**：PowerShell 5.1 逐行正则（UTF-8，含 BOM 自动识别）；命中仅记录「模式名+文件:行」，**输出不含命中值**；git 历史用 `git log -p --all` 流式扫描（覆盖 `--all` 全部 26 commit，含删除行）。
- **覆盖边界**：① 3 个 PNG 以字节级扫描替代文本扫描（0 命中）；② 密钥扫描是**模式匹配**，不是熵/语义全检（可能漏掉非常规格式凭据，但对常见凭据族覆盖完整）；③ 隐私目视仅覆盖 3 张 demo 图 + PII 正则，**未**对全部 docs 做人工通读（其余内容按 D2 公开）；④ 本报告写入后自身未纳入扫描（报告不含密钥/私有画面文字，按脱敏原则撰写）。
- **时间口径**：全部为本机 +08:00；「输出摘要」为命令原始输出的摘录，非二次改写。
- **结论边界**：本报告只回答「可否公开推送」的**技术证据**问题；D7 的许可/法务判断、GitHub 侧设置、push 操作均属 Lead 职责。

---

## 附录 C：证据时间线

| 时间（+08:00） | 项 | 结果 |
|---|---|---|
| 12:35:32 | 开始验证（读 agenda.md：D2 全部公开 + 密钥例外） | — |
| 12:35:39 | 仓库基线：26 commits / HEAD 2cb2d17 / 无 remote | 记录 |
| 12:35:56 | `git ls-files` / 大文件 / `.git` 体积 | 96 文件 / 3.01 MB / 0 个 >2MB / .git 3.80 MB |
| 12:36:13—12:36:14 | **工作树密钥扫描 #1**（114 文件） | 1 良性命中，0 真实密钥 |
| 12:36:20 | `.gitignore` 初检 | 缺 `.env*` 等（已报 Lead，D7 补齐） |
| 12:36:20—12:36:40 | `read_image` 三张 demo 图 | **BLOCK-1：screen 需处理**；2 张 crop 可公开 |
| 12:36:48 | **git 全历史密钥扫描**（19,886 行 / 26 commits） | 1 良性命中（82f7b823），0 真实密钥 |
| 12:36:50—12:36:53 | 测试基线 | tree-engine 62/62 exit 0；meta-loop 13/13 exit 0 |
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

---

*报告结束。本文件为 T3（task-2）唯一交付物；未修复任何问题（BLOCK 均移交 Lead），未执行 git 写操作。*

## 附录 D：报告变更记录

| 版本 | 时间（+08:00） | 变更 |
|---|---|---|
| v1.0 | 2026-11-11 12:40 | 首版：工作树/历史密钥扫描、3 图隐私判读、仓库健康、测试基线、合并包哈希、活体快照；BLOCK-1（隐私截图）、BLOCK-2（3 个第三方源码）；附录 A 初版 A1–A8 |
| v1.1 | 2026-11-11 12:42 | 依 Lead 通知：BLOCK-2 由 3 个文件扩大为 **6 个**（新增 `_driver.js`/`_fork.js`/`_spawn.js`，附 SHA 与历史位置）；D7 追加 2 个历史瘦身路径（`scripts/asar-out.txt`/`asar-err.txt`，含 6.9MB 历史 blob）；附录 A 更新为 7+2 路径并新增 A9（瘦身效果）；R5 关闭；新增本变更记录 |
