# DSH 插件源码目录地图审计（按发布单元拆分 · 向导准备）

> 审计者：`source-scout`（只读审计）
> 审计时刻：2026-11-12 17:03–17:16 (+08:00)
> 审计对象：DSH 桌面 profile 已装配 / 关联的 12 个插件源码目录 + 历史目录，以及承载它们的 6 个项目根
> 纪律：**未安装/未启用任何插件、未改 profile、未执行任何 git 写操作、未触碰他人在改文件**；只读命令含 `git remote/rev-parse/tag/log/ls-remote` 与 `git --no-optional-locks status`（不写 index）；本报告是本次唯一写入。
> 标注约定：**[FACT]** 直接读到的文件/命令输出；**[UNKNOWN]** 本次无法取证；**UNKNOWN** 项集中在附录 C。
> 上下文：拆分判定与成本基线见 [composable-orchestration.md §6](../architecture/composable-orchestration.md)（本仓）与仓外 `D:\Codes\_composition-research\E1-coupling.md`（E1 报告，本仓三包影响面）。

---

## 0. 结论先行

### 0.1 一句话

**DSH 插件生态的源码并不在"一个仓"里：12 个插件目录中只有 3 个在本仓（25%），9 个散落在 5 个仓外项目/目录（75%）；"按发布单元拆分"真正的成本不在拆代码（E1 已证三包间 0 代码依赖），而在①hmr.root 只覆盖 2 个绝对目录、②发布元数据/镜像通道只有会话树一条、③单仓工具链与 D1 决策前提。** [FACT + INFERENCE，依据 §2 表、§5 阻塞清单]

### 0.2 关键读数

| 读数 | 值 | 证据 |
|---|---|---|
| profile bundles | **26**（其中生态相关 14：`@local/*` 8 + `@orphiczhou/dsh-session-tree` + `dsh-startup-secret` + 4 个第三方 npm） | `C:\Users\sir_c\.dsh\profiles\desktop\package.json:6-34` [FACT] |
| profile dependencies | **16**（**12 个 `link:`** + 4 个 npm 冻结） | 同文件 `:36-53` [FACT] |
| hmr.root 覆盖目录 | **2 个绝对目录**：`D:/Codes/nanju-dsh/packages`、`D:/Codes/dsh-tree-harness/packages` | `cordis.patch.yml:4-9` [FACT] |
| 审计插件源码目录 | **12**：本仓 3 + 仓外 9（分布在 5 个仓外项目/目录） | §2 [FACT] |
| 在 hmr.root 内的插件 | **5/12**（tree-engine、session-tree、agent-introspect、nanju-core、nanju-ui）；仓外 7 个全部不在 | §2 表 2 [FACT] |
| 有公开镜像仓的插件 | **2/12**（session-tree、region-probe）+ 1 个私有双仓（meta-adapter） | §2 表 3，本次 `git ls-remote` 实测 [FACT] |
| 非 `private:true` 的插件 | **2/12**（session-tree、agent-introspect） | §2 表 3 [FACT] |
| 拆分标注 | 在拆分范围内 **4 目录**（+`flow-core` 兄弟目录）／范围相邻 5／不相关 3／历史参考 8 处 | §2、§4 [FACT] |
| 基线仓状态 | 本仓 `master` HEAD **`1b1f610`**；工作树 2 处未提交（`agent.md`、`docs/README.md`，属其他任务，本次未触碰） | `git -C D:\Codes\dsh-tree-harness rev-parse/log/status` [FACT] |

### 0.3 最大拆分阻塞项（排序）

1. **hmr.root 迁移**：新仓不在 `cordis.patch.yml:4-9` 两个绝对目录内 → 失去热更；宿主半改动必须 disable→enable/重启（D12）。本仓三包拆走任一个都会触发（§6.2 明列此成本）。[FACT]
2. **发布元数据与通道**：12 个目录中 10 个 `private:true`、10 个 `@local/*`；**11/12 缺 `repository`**（9 缺 license、10 缺 author），npm 冻结（D3）期间这些字段"没有交付对象"。只有会话树同时具备公开镜像仓与全套合法元数据。[FACT + §6.2]
3. **单仓工具链前提**：`scripts/check-version-consistency.mjs` 以 tree-engine 的 `package.json` 存在作为"这是不是本仓"的判据（E1 §7.1 `:103-106`）；`release-plugin.mjs` / `release-all.mjs` 只镜像 `packages/dsh-session-tree`。拆任一包要先重构这两套。[FACT，引 E1]
4. **flow-engine 不是自包含发布单元**：插件以相对路径 `../../flow-core` 加载兄弟目录的"纯内核"（`lib/core-adapter.js:26`），profile 又固定 `engine: flow-core` 与绝对 `storageDir`（`cordis.patch.yml:272-280`）。拆"自由流程引擎"前必须先把 flow-core 打包/定契约。[FACT]
5. **状态目录四处分布**：profile 内 4 个（tree-engine、meta-adapter、nanju-core、nanju-ui）、项目目录内 2 个（flow、Gemini-Eyes）、工作区 1 个（session-tree 的 `HANDOFF-*.md`）、包目录内 1 个（RSI `plugin/runs`）；拆分要先定状态归属与迁移，否则"新仓第一天就带病"。[FACT]

### 0.4 与既定结论的关系

- E1 已证：三包"**两个独立插件**已经事实上成立"（3 bundle / 3 link / 0 代码依赖 / 独立状态域，E1 §0.2、§3.6、§13.3）。本报告不推翻该结论，只把它扩展到**12 个目录的全景**：仓外插件同样是"link + bundle"独立装配，拆分不改变安装形态，但**天然不具备本仓的热更/工具链/发布门禁**。[FACT + INFERENCE]
- §6.4 的现行判定仍是"**现在不拆仓**，挂两个触发器（npm 解冻 / 第二个独立消费方）"。本报告为触发后的执行提供目录级向导，不构成拆仓建议。[INFERENCE]

---

## 1. 审计基线与方法

### 1.1 证据面

| 证据类 | 命令/文件（只读） |
|---|---|
| profile 装配面 | `C:\Users\sir_c\.dsh\profiles\desktop\package.json`（bundles `:6-34`、dependencies `:36-53`）、`cordis.patch.yml`（288 行；hmr `:4-9`；harness-rsi `:248-265`；flow `:272-280`；nanju `:285-288`）、`pnpm-workspace.yaml` |
| 源码目录身份 | 各目录 `package.json`（name/version/private/repository/license/author/files/dsh.bundle/dsh.client/scripts）、顶层清单（client.js / skills / test(s) / src / patch） |
| git 只读 | `git remote get-url origin`、`git --no-optional-locks rev-parse --abbrev-ref HEAD`、`rev-parse --short HEAD`、`tag --sort=-creatordate`、`--no-optional-locks status --porcelain --untracked-files=no`；公开镜像用 `git -c http.proxy= -c https.proxy= ls-remote --heads --tags <url>` |
| 交叉引用 | 本仓 `agent.md`（D1/D3/D12/D17、§2 发布面）、`docs/architecture/composable-orchestration.md §6`、仓外 E1 报告 |

### 1.2 边界与未取证

- **未展开**：4 个第三方 npm 冻结包（`dsh-thoughtdag@0.5.26`、`dshmarket@1.73.5`、`dsh-orb@0.2.1`、`@tt-a1i/archify-dsh@1.1.0`）的源码——属"不相关（第三方 npm 冻结，D3）"，只记录装配事实（§2 表 3 末尾）。
- **未验证**：私有仓 `orphiczhou/meta-adapter-src` 的远端可访问性（未使用任何凭据）；Gemini-Eyes 本地 HEAD 是否领先其第三方 origin（未 fetch）；`check-version-consistency.mjs` 等脚本未执行（不能确认其仍全绿，引 E1 静态结论）。
- **DSH 版本**：`0.2.2-rc.1` 引自 `agent.md:110`，本次未活体复核。
- **路径漂移**：任务线索中的"多个 `dsh-meta-adapter-N` 历史目录"在 `D:\Codes`（深度 3）/`default-workspace`（深度 2）/`D:\桌面`/`C:\Users\sir_c\Documents` 全盘名匹配后**只找到 1 个额外副本**（`D:\桌面\元方法论\dsh-meta-adapter`，v0.3.0），见 §4 H-2。[FACT]

---

## 2. 主表：12 个插件源码目录

> 行号 `#` 在三张表中保持一致。表 1 = 身份/位置/git；表 2 = profile 装配/工程面；表 3 = 发布元数据/镜像/拆分标注。
> 缩写：`P` = `private:true`；`L` = `@local` scope；`缺元` = 缺 `repository`/`license`/`author` 中至少一项（表 3 细分）；`patch` = 包内 `cordis.patch.yml`。

### 表 1｜身份、源码路径、git

| # | 包名@版本 | 源码绝对路径 | 承载项目根（是否 git） | git remote / branch / HEAD |
|---|---|---|---|---|
| 1 | `@local/dsh-tree-engine@0.7.0` | `D:\Codes\dsh-tree-harness\packages\dsh-tree-engine` | `D:\Codes\dsh-tree-harness`（git ✅） | `https://github.com/orphiczhou/dsh-tree-harness.git` / `master` / `1b1f610` |
| 2 | `@orphiczhou/dsh-session-tree@1.3.7` | `D:\Codes\dsh-tree-harness\packages\dsh-session-tree` | 同上（git ✅） | 同上 / `master` / `1b1f610` |
| 3 | `@local/dsh-agent-introspect@0.1.0` | `D:\Codes\dsh-tree-harness\packages\dsh-agent-introspect` | 同上（git ✅） | 同上 / `master` / `1b1f610` |
| 4 | `@local/dsh-flow-engine@0.1.0`（+ 兄弟 `@local/flow-core-mvp@0.1.0`） | `D:\Codes\DSH动态流程引擎插件\spike\dsh-flow-plugin`（内核 `...\spike\flow-core`） | `D:\Codes\DSH动态流程引擎插件`（git ✅，**无 remote**） | 无 origin / `main` / `acae470` |
| 5 | `@local/dsh-meta-adapter@0.4.53` | `D:\Codes\dsh-meta-adapter` | 自身即仓（git ✅） | `https://github.com/orphiczhou/meta-adapter-src.git`（私有）/ `master` / `4bd326d`（2026-11-09 round-41b） |
| 6 | `@local/dsh-harness-rsi@0.2.0` | `D:\Codes\RSI\dsh-harness-rsi\plugin` | `D:\Codes\RSI\dsh-harness-rsi`（git ✅，**无 remote**） | 无 origin / `master` / `9cb4e0c` |
| 7 | `@local/dsh-region-probe@0.1.0` | `C:\Users\sir_c\Documents\deepseek-harness\default-workspace\region-probe` | `default-workspace`（**无 git**） | 无 |
| 8 | `@local/dsh-nanju-core@0.3.0` | `D:\Codes\nanju-dsh\packages\dsh-nanju-core` | `D:\Codes\nanju-dsh`（git ✅，**无 remote**） | 无 origin / `main` / `e0cff15` |
| 9 | `@local/dsh-nanju-ui@0.1.0` | `D:\Codes\nanju-dsh\packages\dsh-nanju-ui` | 同上（git ✅） | 无 origin / `main` / `e0cff15` |
| 10 | `@local/dsh-td-tweak@0.3.1` | `...\default-workspace\dsh-td-tweak` | `default-workspace`（**无 git**） | 无 |
| 11 | `@local/dsh-gemini-eyes-bundle@0.1.0` | `...\default-workspace\Gemini-Eyes` | 自身即仓（git ✅） | `https://github.com/ConsoleSun/Gemini-Eyes.git`（**第三方上游**）/ `main` / `705a7ea`（本地 tag `v0.2.0`） |
| 12 | `dsh-startup-secret@1.5.2` | `...\default-workspace\startup-plugin\package` | `default-workspace`（**无 git**）；另有 git 副本 `...\default-workspace\dsh-startup-secret` | 副本 remote `https://github.com/huzhengcai471-crypto/dsh-startup-secret.git`（第三方）/ `main` / `f159b63`；**副本与链接副本 package.json 不同 hash** |

> 说明：本仓三包的包目录内均**无独立 `.git`**，版本证据统一取本仓仓级 git（E1 §1.1 同口径）。[FACT]
> 12 个包**全部通过 `link:` 挂载**（`package.json:37-50`），无一走 Git URL 安装；4 个第三方包走 npm 冻结版本。[FACT]

### 表 2｜profile 装配与工程面

| # | profile `link:` | profile bundle | patch 文件（行数 / insert） | 客户端半 | skills | tests | 状态目录 | 在 hmr.root |
|---|---|---|---|---|---|---|---|---|
| 1 | `:46` | `:31` | 20 行 / 2（自身 + skill provider `tree-engine`） | 无 | `skills/` 2（tree-commander、tree-worker） | `tests/` 14 × `.test.js` | `<profile>\tree-engine-data`（`index.js:5`、`src/doctor.js:207`） | ✅ |
| 2 | `:47` | `:29` | 26 行 / 2（自身 + skill provider `session-tree`） | ✅ `client.js`（web，2 模块依赖） | `skills/` 1（session-handoff） | `test/` 5 文件 + `scripts/verify-bundle.mjs` | 无自有（写工作区 `HANDOFF-*.md`） | ✅ |
| 3 | `:37` | `:12` | 3 行 / 1（仅自身） | 无 | 无 | 无 | 无（只读 `~/.dsh/storages/session_projcache`，`index.js:22-25`） | ✅ |
| 4 | `:38` | `:27` | 13 行 / 1（仅自身；profile `:272-280` 覆盖 config） | ✅ `client.js` | 无 | `test/` 11 × `.test.mjs` | `D:/Codes/DSH动态流程引擎插件/.dsh-flow`（profile `:279`；`index.js:15`） | ❌ |
| 5 | `:41` | `:22` | 3 行 / 1（仅自身） | ✅ `client.js` + `panel/` | `skills/` 1（meta-run-intake；**挂载方式 UNKNOWN**，见 §6 H-6） | `tests/` 1 + `src/**/*.test.js` 89 | `<profile>\dsh-meta-adapter-data`（`index.js:8`）+ `...-runs-backup-20261106` | ❌ |
| 6 | `:40` | `:21` | 18 行 / 1（含默认 config；profile `:248-265` 覆盖 `workspaceRoot` 绝对路径） | 无 | 项目级 `skills/rsi-harness`（**不在包内**） | `test/` 25 × `.test.js` | `<workspaceRoot>\runs` + `.dsh/harness-library`；`plugin/runs/_preflight` 落在包内 | ❌ |
| 7 | `:44` | `:11` | 3 行 / 1（仅自身） | ✅ `client.js` | 无 | `test/contract.cjs` | 无（`client.js:29` 自述 read-only/no storage） | ❌ |
| 8 | `:42` | **无**（patch `:287-288` `disabled:true`） | 3 行 / 1（仅自身） | 无 | 无 | `tests/` | `<profile>\nanju-core-data`（`index.js:405`、`src/tools.js:79`） | ✅ |
| 9 | `:43` | **无**（patch `:285-286` `disabled:true`） | 3 行 / 1（仅自身） | ✅ `client.js` + `host/` | 无 | `tests/` | `<profile>\.nanju-ui-data`（`index.js:28`、`host/ui-state.js:4`） | ✅ |
| 10 | `:45` | `:32` | 3 行 / 1（仅自身） | ✅ `client.js` | 无 | 无 | 未发现 | ❌ |
| 11 | `:39` | `:25` | 38 行 / **0 自身 insert**；insert `@deepseek-ai/dsh-mcp-client`（id `gemini-web`） | 无（纯 bundle 包装 + Python MCP） | 无 | `tests/`（Python） | 项目内 `.cache/`、`media/`；cookie `C:/Users/sir_c/.config/gemini-web-mcp/cookies.json`（patch `:33`） | ❌ |
| 12 | `:50`（`link:`，非 `@local` scope） | `:26` | 12 行 / 1（仅自身） | ✅ `lib/client.js`（`dsh.client.inject: settings`） | 无 | `test/` 5 × smoke `.mjs` | 未发现 | ❌ |

> 行号均指 `C:\Users\sir_c\.dsh\profiles\desktop\package.json` 与 `cordis.patch.yml`。[FACT]
> 8/9 的"停用"证据：两包**不在** 26 条 bundles 列表；patch `:285-288` 以 `- id: nanju-ui / nanju-core` + `disabled: true` 覆盖（说明 loader 曾见过这两个 id）。[FACT]
> 11 的 `dsh.client` 字段不存在（package.json 无 `dsh.client`）；其 patch 的作用是给 profile 插入 MCP 客户端而不是插入自身，故"bundle 包装器"而非"插件体"。[FACT]

### 表 3｜发布元数据、公开镜像、发布方式、拆分标注

| # | private | scope | repository / license / author | 公开镜像（本次 `ls-remote` 实测） | 发布方式 | 拆分标注 |
|---|---|---|---|---|---|---|
| 1 | **P** | `@local` | 三项全缺 | 无（`publishing.md:22` 口径：不单独建仓） | link + 随本仓公开；npm 冻结 D3 | **在拆分范围内**（E1：工作量 L，6 人日） |
| 2 | 否 | `@orphiczhou` | repo + MIT + author ✅ | `orphiczhou/dsh-session-tree`：`main`=`91c177e3…`，`v1.3.7`=`91c177e3…` | link + 本仓→镜像单向同步（`release-plugin.mjs`）；npm 冻结 | **在拆分范围内**（E1：工作量 M，3 人日） |
| 3 | 否 | `@local` | license MIT；缺 repo/author | 无 | link + 随本仓公开；npm 冻结 | **在拆分范围内**（本仓第三包，建议随本仓保留） |
| 4 | **P** | `@local` | 三项全缺（内核 `flow-core` 同） | 无 | link（工作副本）；npm 冻结 | **在拆分范围内**（用户点名"自由流程引擎"；非自包含，见 B-4/B-12） |
| 5 | **P** | `@local` | 三项全缺 | **私有双仓**：`orphiczhou/meta-adapter-src`（真源码，本地 origin）+ `orphiczhou/meta-adapter`（文档/账本）；tag `round-41/round-41v13/round-40…`，无 semver | link（本机工作副本）；私有源仓 | 范围相邻（独立发布单元，不属本仓拆分） |
| 6 | **P** | `@local` | 三项全缺 | 无 | link；npm 冻结 | 范围相邻 |
| 7 | **P** | `@local` | 三项全缺 | `orphiczhou/dsh-region-probe`：`main`=`c42e5e52…`，**无 tag** | link；发布副本 `publish\region-probe` v1.0.0 | 范围相邻（已有镜像，但元数据未补齐） |
| 8 | **P** | `@local` | 三项全缺 | 无 | link；**当前停用** | 范围相邻（休眠） |
| 9 | **P** | `@local` | 三项全缺 | 无 | link；**当前停用** | 范围相邻（休眠） |
| 10 | **P** | `@local` | 三项全缺 | 无 | link；npm 冻结 | 不相关（UI 微调） |
| 11 | **P** | 无 scope | 三项全缺 | origin = `ConsoleSun/Gemini-Eyes`（**第三方上游**，非本仓镜像） | link；上游第三方仓 | 不相关（MCP 桥，不属拆分对象） |
| 12 | **P** | 无 scope | license MIT + author「二次创作作者」；缺 repo | 无；另有第三方上游副本仓 `huzhengcai471-crypto/dsh-startup-secret` | link；上游第三方仓副本 | 不相关（启动界面动画） |

> 补充（不相关，未展开源码）：`dsh-thoughtdag@0.5.26`（bundle `:23`；本地源码副本 `...\default-workspace\thoughtdag`，origin `chenxiachan/thoughtdag` 第三方，HEAD `6bab033`）、`dshmarket@1.73.5`（bundle `:24`；profile 状态 `.dsh-market/`）、`dsh-orb@0.2.1`（bundle `:28`；profile 状态 `orb-*.json`）、`@tt-a1i/archify-dsh@1.1.0`（bundle `:30` + patch `:237-243` 的 skill provider `archify-plugin`）。四者均为 **npm 冻结版本安装、无 `link:`、源码未展开（UNKNOWN）**。[FACT]

---

## 3. 本仓 vs 仓外边界（项目根视角）

| 项目根 | 角色 | git | 文档/交接/构建入口 | 承载包 |
|---|---|---|---|---|
| `D:\Codes\dsh-tree-harness` | **本仓**（唯一源码事实源，D1） | `orphiczhou/dsh-tree-harness` / `master` / `1b1f610` | `agent.md`、`README.md`、`scripts/{check-version-consistency,release-plugin,release-all,e2e}/`、`docs/{architecture,guides,operations,reports}/`；**无根 `package.json`、无 `pnpm-workspace.yaml`**（monorepo 是目录约定，E1 §1.1 复核一致） | 1、2、3 |
| `D:\Codes\DSH动态流程引擎插件` | 仓外（flow 项目） | git ✅ **无 remote** / `main` / `acae470` | `README.md`、`AGENTS.md`、`HANDOFF.md` + 3 份 `HANDOFF-*.md`、4 份 `NEXT-SESSION-PROMPT*.md`；`spike/{dsh-flow-plugin,flow-core}`；状态 `spike/../.dsh-flow/` | 4 |
| `D:\Codes\dsh-meta-adapter` | 仓外（私有源仓工作副本） | `orphiczhou/meta-adapter-src`（私有）/ `master` / `4bd326d`；tag `round-*` | `REPO-LINKS.md`（双仓导航）、`docs/`、`overlays/`、`panel/`、`templates/`、`scripts/`（含 `hmr:touch`、`hmr:status`、多套 `test:*`） | 5 |
| `D:\Codes\RSI\dsh-harness-rsi` | 仓外（RSI 项目） | git ✅ **无 remote** / `master` / `9cb4e0c`（`D:\Codes\RSI` 本身无 git） | `README.md`、`HANDOFF.md`、`START-PROMPT.md`、`docs/`、`skills/rsi-harness/`、`tasks/`、`tasks-real/`、`runs/` | 6 |
| `D:\Codes\nanju-dsh` | 仓外（nanju 项目） | git ✅ **无 remote** / `main` / `e0cff15` | `README.md`、`HANDOFF.md`、`PLAN.md`、`docs/`、`skills/`、`packages/`、`tests/`、根 `package.json` | 8、9 |
| `...\default-workspace` | 仓外散装目录（4 处） | 仅 Gemini-Eyes 是 git 仓 | 各目录 README；Gemini-Eyes 另有 `INSTALL-FOR-AGENTS.md`、`pyproject.toml`；startup 有 `INSTALL.md`/`DESKTOP.md`/`RELEASE-NOTES-1.5.2.md` | 7、10、11、12 |

> 结论：**只有本仓有"工程化"的测试/发布/版本一致性工具链**；5 个仓外项目里 3 个连 `remote` 都没有（flow、RSI、nanju），meta-adapter 的源在私有仓且用 `round-*` 而非 semver 标签。拆分若把包移入这些项目，"发布/门禁/CI"要新建而不是迁移。[FACT + INFERENCE]

---

## 4. 历史 / 退役目录（**历史参考，不参与拆分**）

| # | 目录 | 内容/版本证据 | 判定 |
|---|---|---|---|
| H-1 | `D:\Codes\tree-harness` | git ✅ `orphiczhou/proma-patches` / `release-0.13.16-hardening` / `7f99cf2` / tag `v0.17.0`；含 `tree-engine.cjs`（316,687 B）+ 4 个 `.bak-*` + `.tree-engine-secret/` | **历史参考**（旧 tree-engine 单文件实现；仍是 `packages/dsh-tree-engine/tests/diff.test.js:26,69` 的差分基准路径依赖） |
| H-2 | `D:\桌面\元方法论\dsh-meta-adapter` | `@local/dsh-meta-adapter@0.3.0`、无 git（真源为 v0.4.53） | 历史副本（**任务线索中的"多个 `dsh-meta-adapter-N` 目录"仅此 1 个 + 1 个状态备份**，见 §8 漂移） |
| H-3 | `...\default-workspace\dsh-session-tree` | `@local/dsh-session-tree@1.0.0`、无 git | 历史副本；**仍是 `node_modules/@local/dsh-session-tree` junction 的指向**（死配置，见 §8 H-2） |
| H-4 | `...\default-workspace\dsh-session-tree-tools` | 仅 4 文件（`index.js`/`cordis.patch.yml`/`package.json`/`icon.svg`）、无 git | 历史（旧"会话树工具"独立包） |
| H-5 | `...\default-workspace\publish\dsh-session-tree`、`...\publish\region-probe` | v1.0.4、v1.0.0；无 git；同目录 5 个 `_push*.ps1`/`_mirror*.ps1` | 历史发布副本（D5 明确降级为历史参考） |
| H-6 | `...\default-workspace\tree-harness` | `analysis/`、`scripts/`、`FINDINGS.md` | 历史分析产物 |
| H-7 | `<profile>\dsh-meta-adapter-data-runs-backup-20261106` | 状态备份目录 | 状态备份（非源码） |
| H-8 | `<profile>\node_modules\@local\dsh-meta-loop` | junction 指向 `D:\Codes\dsh-tree-harness\packages\dsh-meta-loop` → **目标不存在** | **死链**（meta-loop 已按 agent.md 记录删除） |

---

## 5. 拆分阻塞项清单

> 分"全局（跨包）"与"单包"两组；每条给证据坐标。**S = 阻塞拆分立项；M = 拆前必须处理；S/M 与 E1 的 S/M/L 人日口径无关。**

### 5.1 全局阻塞项

| ID | 级别 | 事实 | 证据 | 对拆分的影响 |
|---|---|---|---|---|
| **B-1** | S | `hmr.root` 是两个**绝对目录**；12 个插件目录仅 5 个在内 | `cordis.patch.yml:4-9`；§2 表 2 | 拆出即失去热更；宿主半每次改动需 disable→enable（D12）；UI 密集包迭代成本显著上升（§6.2） |
| **B-2** | S | 10/12 为 `private:true`；10 个 `@local`；`repository` 仅会话树有（11/12 缺）；`license` 仅 3 个有（会话树/agent-introspect/startup）；`author` 仅 2 个有（会话树/startup） | §2 表 3 | 公开仓/市场 listing 前置缺失；npm 冻结（D3）下无交付对象（§6.2 把"去 private/补元数据/市场 listing"列为本轮不可计入工期的预付项） |
| **B-3** | S | 工具链是单仓前提：版本一致性脚本以 tree-engine 包为"本仓"判据；发布脚本只认 `packages/dsh-session-tree` | `scripts/check-version-consistency.mjs`（E1 §7.1 `:51-71,103-106`）；`release-plugin.mjs:57`；`release-all.mjs:48,539,729-738`（E1 §3.3） | 拆任一包需重构两套脚本 + 新建跨仓一致性 CI（§6.2"工具链重建"） |
| **B-4** | S | D1"本仓=唯一源码事实源；发布=本仓→公开插件仓单向同步"与"开发搬去独立仓"**硬冲突** | `agent.md:88`；`composable-orchestration.md §6.3` | 拆前必须先新增决策记录（如 D18）明确反转与迁移，不能顺手改架构文档 |
| **B-5** | M | 发布门禁是单仓设计：A1–A9 独立验证、全历史密钥扫描、D5/D2/D7 排除清单 | `agent.md:176-183`；§6.2/§6.3 | 拆仓要跑两遍门禁、历史重写两遍 |
| **B-6** | M | 状态目录分布不一致：profile 内 4（tree-engine、meta-adapter、nanju-core、nanju-ui；另有第三方 dshmarket/orb 状态文件）、项目目录内 2（flow、Gemini）、工作区内 1（session-tree 的 `HANDOFF-*.md`）、包目录内 1（RSI `plugin/runs`） | §2 表 2；`cordis.patch.yml:248-254,279` | 拆分前要定"状态属于发布单元还是工作区"，并迁移/兼容旧路径 |

### 5.2 单包阻塞项

| ID | 包 | 级别 | 事实与证据 |
|---|---|---|---|
| **B-7** | tree-engine | S | `@local` 不可发布 scope + `private:true` + 缺元数据，且四处联动：`package.json:2,4`、`cordis.patch.yml:13,20`、`src/doctor.js:34`（`EXPECTED_PACKAGE_NAME`）、`tests/doctor.test.js:40,62-63`（E1 B0/B1） |
| **B-8** | tree-engine | M | 差分测试硬编码外部仓：`tests/diff.test.js:26` `SOURCE_ENGINE_PATH='D:/Codes/tree-harness/tree-engine.cjs'`，`:69` `require()` 无存在性守卫 → 新仓/新机器 112 项中 3 项必挂（E1 §8.2） |
| **B-9** | tree-engine | M | `tests/skills.test.js:18,50-53` 用 `pkgDir/../..` 当仓根 → 包移到仓根后断言"碰巧通过但语义失效"（E1 §8.2） |
| **B-10** | tree-engine | M | `src/doctor.js:74` 提示串写死 `packages/dsh-tree-engine/package.json`；`tool-count` 断言绑 `TOOLS.length` 与 README 版本节（E1 B5/B7） |
| **B-11** | session-tree | — | 精确影响面已由 E1 §9.2 A1–A13 列出（docs/脚本/README/Skill 共 13 处，≈3 人日）。本报告仅补充：其**已在 hmr.root**（拆走触发 B-1）、**已具备合法元数据与镜像仓**（拆它性价比最高，E1 §13.2） |
| **B-12** | flow-engine | S | **非自包含**：`lib/core-adapter.js:26` 以 `../../flow-core/{index.js,src/index.js,src/engine.js,engine.js}` 相对路径加载"纯内核"并调用 `hmr.evict` 清缓存；profile 固定 `engine: flow-core`（`cordis.patch.yml:274`）；`flow-core` 自身 `@local/flow-core-mvp@0.1.0`、`private:true`、无 repo/license/author，且不在 profile 的 bundle/link 面（只经相对路径被加载） |
| **B-13** | flow-engine | M | `storageDir: 'D:/Codes/DSH动态流程引擎插件/.dsh-flow'` 绝对路径写死在 profile（`:279`）→ 换仓/换机即失效 |
| **B-14** | meta-adapter | M | 私有源仓治理：`REPO-LINKS.md` 自述"资产分两个私有仓"（真源码 `meta-adapter-src`，95 commits、`round-*` tag、`src/core/v2`；文档/账本 `meta-adapter`）；无 semver；`docs/CHANGELOG*` 与脚本中 147 处绝对路径（多为历史记录）；脚本硬编码 profile 数据目录（`scripts/crossref-audit.cjs:20`、`export-run.cjs:10`、`hmr-touch.cjs:21`，部分有 env 覆盖） |
| **B-15** | RSI | M | 测试硬编码 `D:/Codes/RSI/dsh-harness-rsi/tasks/...`（`test/paths.test.js:36`、`test/runner.test.js:849,854,905`）；`workspaceRoot: 'D:/codes/RSI/dsh-harness-rsi'` 由 profile 绝对路径固定（`cordis.patch.yml:254`）；`plugin/runs/` 状态落在包目录内（发布须 `files` 白名单或迁出） |
| **B-16** | nanju ×2 | L | 两包 `link:` 存在但**当前停用**：不在 bundles（`package.json:6-34`），patch 显式 `disabled:true`（`:285-288`）；`dsh-nanju-ui/client.js:1091` 硬编码外部路径 `D:/Codes/multi-agent-collab-platform/02_UX_DESIGN/user-flows.md`（文件存在、属另一项目；常量仅导出，未证运行必需） |
| **B-17** | Gemini-Eyes | L | 第三方 origin（`ConsoleSun/Gemini-Eyes`）+ patch 硬编码本机默认值：`uv.exe='D:/Python314/Scripts/uv.exe'`、`cwd='C:/Users/sir_c/.../Gemini-Eyes'`、`GEMINI_COOKIE_FILE='C:/Users/sir_c/.config/gemini-web-mcp/cookies.json'`（`cordis.patch.yml:30-33`，均有 env 覆盖）；`.venv/`、`.cache/`、`pytest-*` 落在源码树 |
| **B-18** | startup-secret | L | 链接副本无 git；另有 git 副本（第三方 origin）且两份 `package.json` hash 不同；无 `repository`、author 为占位串；包名无 scope |

### 5.3 硬编码外部路径速查（拆分前需清零或加守卫）

| 位置 | 路径 | 性质 |
|---|---|---|
| `packages/dsh-tree-engine/tests/diff.test.js:26,69` | `D:/Codes/tree-harness/tree-engine.cjs` | 测试硬依赖（无守卫） |
| `packages/dsh-tree-engine/tests/skills.test.js:18,50-53` | `pkgDir/../..` | 仓根假设 |
| `.../dsh-session-tree/AGENT-INSTALL.md`（5 处） | `D:/Codes/dsh-tree-harness/...` | 文档（可改绝对 URL） |
| `D:\Codes\RSI\dsh-harness-rsi\plugin\test\paths.test.js:36` 等 | `D:/Codes/RSI/dsh-harness-rsi/tasks/...` | 测试硬依赖 |
| `D:\Codes\nanju-dsh\packages\dsh-nanju-ui\client.js:1091`、`src/flowchart-data.js:4` | `D:/Codes/multi-agent-collab-platform/02_UX_DESIGN/user-flows.md` | 外部项目常量（导出，非运行必需） |
| `.../Gemini-Eyes/cordis.patch.yml:30-33` | `D:/Python314/...`、`C:/Users/sir_c/...` | 运行默认值（env 可覆盖） |
| `D:\Codes\dsh-meta-adapter\scripts\crossref-audit.cjs:20` 等 | `C:/Users/sir_c/.dsh/profiles/desktop/dsh-meta-adapter-data` | 脚本默认值（部分 env 可覆盖） |
| `<profile>\cordis.patch.yml:8-9,254,279` | hmr 两目录、RSI workspaceRoot、flow storageDir | **profile 级绝对路径**（拆分/换机必改） |

---

## 6. 漂移与卫生发现（拆分前应清理）

| ID | 发现 | 证据 | 建议 |
|---|---|---|---|
| **H-1** | 死 junction：`node_modules/@local/dsh-meta-loop` → `D:\Codes\dsh-tree-harness\packages\dsh-meta-loop`（目标不存在） | `cmd /c dir /AL ...\node_modules\@local`；目录清单 | 清理（meta-loop 已删，见 `agent.md` 第 208 行记录） |
| **H-2** | 死配置：`node_modules/@local/dsh-session-tree` junction → `default-workspace\dsh-session-tree`（v1.0.0）；profile 实际使用 `@orphiczhou/dsh-session-tree`（v1.3.7），两包名并存 | same as above；`package.json:29,47` | 清理或明确"仅保留 @orphiczhou" |
| **H-3** | 死 patch 覆盖：`- id: session-handoff / disabled: true`，但该独立 bundle 已在 D11 删除 | `cordis.patch.yml:281-282`；`agent.md:98` | 删除该条目 |
| **H-4** | nanju 双包：有 `link:`、无 bundle、patch 显式 `disabled:true` → "已安装但休眠"，状态目录仍在写 | `package.json:42-43`；`cordis.patch.yml:285-288` | 明确去留；若保留，文档标注"停用" |
| **H-5** | 版本号漂移：`region-probe` 本地 link 源 `0.1.0`，发布副本 `publish\region-probe` `1.0.0`，但两者 `index.js` SHA 相同 | 两目录 package.json + `Get-FileHash` | 统一版本源（发布前 bump 纪律 D6） |
| **H-6** | `meta-adapter` 的 `skills/meta-run-intake` 挂载来源未定位：patch 无 skill provider 行、`index.js` grep `skill`=0，但该技能在当前会话 Skill 目录可见 | `D:\Codes\dsh-meta-adapter\{cordis.patch.yml,index.js,skills/meta-run-intake/SKILL.md}` | UNKNOWN；拆分/搬家前先定位挂载路径 |
| **H-7** | 工具链已知漂移（引 E1）：`scripts/skill-e2e/summarize-run.mjs:55` 工具清单仍 8 个（缺 `tree_doctor`） | E1 §8.2 | 顺手修 |
| **H-8** | 本仓工作树 2 处未提交（`agent.md`、`docs/README.md`），属其他任务写作用域 | `git status --porcelain --untracked-files=no` | 本次未触碰；由 Lead 收口 |

---

## 7. 与 §6（拆分与仓库策略）约束的对照

| §6 成本项 | 本图证据 | 影响 |
|---|---|---|
| hmr.root 迁移 | B-1：仅 2 个绝对目录；5/12 在覆盖内 | 拆本仓任一人包即触发；仓外包本来就无热更 |
| D1 反转 | B-4：`agent.md:88` 明写唯一源码事实源 | 拆 session-tree 前必须新增决策记录 |
| 镜像仓 ≠ 开发仓 | 会话树镜像 `main`=`91c177e`（仅发布产物）；`publish\*` 无 `.git` | 镜像仓只证发布一致，不构成开发回路 |
| 工具链重建 | B-3：版本一致性 + 发布脚本单仓前提 | 拆分后要新建跨仓 CI |
| 发布门禁翻倍 | B-5 | A1–A9 + 全历史扫描跑两遍 |
| D3 冻结 | 11/12 `private:true`；市场 listing 缺失 | 去 private/补元数据的投入在解冻前无交付对象 |
| 已有边界 | `tree_doctor` 无 `gc`（§6.2）；RSI `runs/` 只增不减 | 拆仓后"新仓第一天就带病" |

> 对照结论：**§6.1 的三条判定不变**——运行时已独立、现在不建议拆、要拆先改 D1。本图新增的只是"若拆，哪些目录在范围、哪些不在"。[INFERENCE]

---

## 8. 建议下一步

1. **本轮不拆**（沿用 §6.4）：把本报告作为"触发后执行向导"，先清 H-1～H-5（约 0.5 人日）消除绑定漂移。
2. **若用户要求排期**，顺序建议：**session-tree（M，已有镜像+元数据）→ flow-engine（先把 `flow-core` 打包成独立发布单元或写入契约，见 B-12）→ tree-engine（L，8 项改造）**；`agent-introspect` 随本仓保留（最小、无独立发布需求）。
3. **拆前必做**：新增决策记录反转 D1；hmr 策略二选一（把新仓目录加入 `hmr.root`，或接受 disable→enable 成本并写进发布流程）；状态目录归属表（§5.1 B-6）先冻结。
4. **不纳入拆分**：meta-adapter（私有源仓治理独立）、RSI、nanju（睡眠态）、td-tweak / Gemini-Eyes / startup-secret（不相关）。
5. **文档收口**：`docs/README.md` 的报告索引、`agent.md`/`CHANGELOG.md` 口径更新由 Lead 执行（不在本次写作用域）。

---

## 附录 A｜可复现的只读枚举命令（本次已实跑，PowerShell）

```powershell
# 只读：枚举 profile 下所有 link: 插件的源码位置/包身份/git 状态，并打印 hmr.root 与 bundles 数。
# 注意：请在 UTF-8 控制台下运行（或保留 [Console]::OutputEncoding 一行），否则中文路径显示为乱码。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$p = "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
$j = Get-Content -Raw -Encoding UTF8 -LiteralPath $p | ConvertFrom-Json
foreach ($d in $j.dependencies.PSObject.Properties | Where-Object { $_.Value -like 'link:*' }) {
  $dir = $d.Value.Substring(5); $pj = Join-Path $dir 'package.json'; $name=''; $ver=''
  if (Test-Path -LiteralPath $pj) { $m = Get-Content -Raw -Encoding UTF8 -LiteralPath $pj | ConvertFrom-Json; $name=$m.name; $ver=$m.version }
  $hasGit = Test-Path -LiteralPath (Join-Path $dir '.git')
  if ($hasGit) { $r=(git -C $dir remote get-url origin 2>$null); $b=(git -C $dir --no-optional-locks rev-parse --abbrev-ref HEAD 2>$null); $h=(git -C $dir --no-optional-locks rev-parse --short HEAD 2>$null) } else { $r=''; $b=''; $h='' }
  "{0} | {1}@{2} | {3} | git={4} remote={5} branch={6} HEAD={7}" -f $d.Name, $name, $ver, $dir, $hasGit, $r, $b, $h
}
"bundles=$($j.dsh.profile.bundles.Count)"
(Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Split-Path $p) 'cordis.patch.yml') |
  Select-String -Pattern '(?s)id: hmr.*?root:\s*(.*?)\n- id:' ).Matches.Value
```

> 实测输出（2026-11-12）：12 条 `link:` 行，其中 10 个 `@local` + `@orphiczhou/dsh-session-tree` + `dsh-startup-secret`；`bundles=26`；`hmr.root` 两目录如 §0.2。公开镜像另用：
> `git -c http.proxy= -c https.proxy= ls-remote --heads --tags https://github.com/orphiczhou/dsh-session-tree.git`（本次得 `main`=`91c177e3…`、`v1.3.7`=`91c177e3…`）。

## 附录 B｜证据索引（file:line 速查）

| 主题 | 坐标 |
|---|---|
| profile bundles / dependencies / link | `C:\Users\sir_c\.dsh\profiles\desktop\package.json:6-34`、`:36-53` |
| hmr.root 两绝对目录 | 同目录 `cordis.patch.yml:4-9` |
| harness-rsi 绝对 workspaceRoot | `cordis.patch.yml:248-265`（`:254`） |
| flow-engine config（engine/storageDir） | `cordis.patch.yml:272-280`（`:274,279`） |
| nanju 停用覆盖 / session-handoff 残留覆盖 | `cordis.patch.yml:281-282`、`:285-288` |
| 本仓三包身份/元数据 | `packages/{dsh-tree-engine,dsh-session-tree,dsh-agent-introspect}/package.json` |
| 两 bundle 的 skill provider | `packages/dsh-tree-engine/cordis.patch.yml:14-20`；`packages/dsh-session-tree/cordis.patch.yml:20-26` |
| flow 内核加载器 | `D:\Codes\DSH动态流程引擎插件\spike\dsh-flow-plugin\lib\core-adapter.js:26` |
| flow 状态目录 | `...\dsh-flow-plugin\index.js:15`；profile `:279` |
| meta-adapter 状态目录 | `D:\Codes\dsh-meta-adapter\index.js:8`；双仓导航 `REPO-LINKS.md` |
| RSI 测试硬编码 | `D:\Codes\RSI\dsh-harness-rsi\plugin\test\paths.test.js:36`、`test\runner.test.js:849` |
| nanju-ui 外部路径 | `...\dsh-nanju-ui\client.js:1091`、`src\flowchart-data.js:4` |
| Gemini-Eyes 硬编码默认值 | `...\Gemini-Eyes\cordis.patch.yml:30-33` |
| 历史 tree-engine 基准 | `D:\Codes\tree-harness\tree-engine.cjs`；`packages/dsh-tree-engine/tests/diff.test.js:26,69` |
| E1 报告（外部） | `D:\Codes\_composition-research\E1-coupling.md` §0.2/§3.6/§7.1/§8.2/§9.2/§13 |

## 附录 C｜UNKNOWN 清单

1. 4 个第三方 npm 冻结包（thoughtdag/dshmarket/dsh-orb/archify）的**源码目录**：未展开（不相关，D3）；本地仅见 thoughtdag 的第三方源码副本。
2. `orphiczhou/meta-adapter-src` 私有仓远端可访问性与本机 HEAD 是否一致：未用凭据验证（仅本地 `4bd326d`）。
3. Gemini-Eyes 本地 `705a7ea` 相对第三方 origin 是否领先：未 fetch。
4. `meta-adapter` 的 `skills/meta-run-intake` 挂载来源（patch/代码均无 skill provider 证据）。
5. startup 链接副本与 git 副本的完整差异范围（只比了 `package.json` hash 与版本 1.5.2）。
6. 任务线索"多个 `dsh-meta-adapter-N` 历史目录"仅找到 1 个（`D:\桌面\元方法论\dsh-meta-adapter`，v0.3.0）+ 1 个状态备份；其余可能已删除或不在本次搜索根内。
