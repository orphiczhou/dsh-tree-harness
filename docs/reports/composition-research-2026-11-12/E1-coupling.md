# E1 仓库级耦合审计：`dsh-session-tree` ↔ `dsh-tree-engine`

> 审计者：E1 仓库级耦合审计师（只读）
> 审计对象：`D:\Codes\dsh-tree-harness` @ `1b1f610`（2026-11-12 02:05:02 +0800）
> 审计时刻：2026-11-12 13:28–13:40 (+08:00)
> 纪律：未修改 target 仓任何文件；未运行任何写状态命令（未装/未启用插件、无 git 写、未跑测试套件）；宿主 asar 仅只读解析。
> 标注约定：**[FACT]** = 直接读到的代码/文件/命令输出；**[INFERENCE]** = 由多条 FACT 推出的结论；**[UNKNOWN]** = 本次无法取证。

---

## 0. 结论先行

### 0.1 一句话

**三个包之间不存在任何代码级依赖**（无 import、无 dependencies/peerDependencies、无共享模块、无共享 fixture）；所有耦合都落在**叙事（Skill/README）、协议（leaf owner 与 handoff 的协调规则）、工具链（版本一致性脚本与发布脚本）**三层。[FACT]

### 0.2 判定表

| 问题 | 判定 | 置信 | 关键证据 |
|---|---|---|---|
| 拆成「两个独立插件」（同一 profile 共存）是否可行？ | **已经事实上成立**，无需拆代码 | 高 | 两条独立 patch insert / 两个独立 skill provider / 两个独立 profile bundle 条目 / 两个独立状态域 |
| 把 `session-tree` 拆成独立仓库 + 独立发布插件 | **可行（工作量 M）** | 高 | 镜像仓已存在且 19/19 SHA 一致；包内自带 `scripts/verify-bundle.mjs`；6 个测试入口只 import `../index.js`；无任何 npm 依赖 |
| 把 `tree-engine` 拆成独立仓库 + 独立发布插件 | **有条件可行（工作量 L）** | 中高 | 不是"搬家"而是"新建项目"：`@local/*` 私有 scope、`private:true`、无 repository/license/CI、`tests/diff.test.js` 硬编码外部仓路径、版本一致性脚本以其为存在前提 |
| `tree-engine` 对 `tree_send`/`session_handoff` 的依赖强度 | **软依赖（叙事 + 协议），非硬依赖** | 高 | tree-engine 侧 `grep tree_send` = 0 命中代码、`session_handoff` 仅 3 处显式包名叙事 + 1 条技能文本断言；缺该包时 SKILL 明确要求降级 |
| 反之 `session-tree` 对 `tree-engine` 的依赖 | **更弱（纯文档）** | 高 | session-tree 全包 `tree-engine` 提及 24 处（`index.js` 1 处注释 + README/README.zh 6 + SKILL 4 + AGENT-INSTALL 13），**运行时代码 0 处调用** |

### 0.3 三个最大耦合点（按拆解成本排序）

| # | 耦合点 | 性质 | 位置 | 拆解成本 |
|---|---|---|---|---|
| **C1** | **协议耦合**：tree-engine 的 leaf owner 模型（`E_BORROWED_IDENTITY` + `tree_node set-session`）专门为「`session_handoff` 不迁移 owner」留了协调协议，两份 SKILL 用大量篇幅教模型协调这两套 handoff | 语义/协议 | `packages/dsh-tree-engine/src/guards.js:116,149`；`src/engine.js:198-205`；`skills/tree-commander/SKILL.md:198,200-215`；`skills/tree-worker/SKILL.md:121-134` | **S**（保留文本即可，无需改代码） |
| **C2** | **工具链耦合**：`scripts/check-version-consistency.mjs` 把三包版本 + 6 份文档 + 项目地图绑成 20 条断言网，且**以 tree-engine 的 package.json 作为"这是不是本仓"的前置判据** | 构建/发布 | `scripts/check-version-consistency.mjs:51-55,56-60,61-71,103-106`；20 条 check 中 ~9 条含 session-tree 断言 | **M**（拆 session-tree）/ **L**（拆 tree-engine：脚本前提失效） |
| **C3** | **隐性共享接口但各写一套适配**：两包对同一批 DSH 宿主原语（起会话/投递消息/上下文测量/会话 id 归一化）各自实现，没有共享代码；DSH 升级要改两处（rc.2 `startContinuable` 移除已暴露过一次） | 运行时适配 | `tree-engine/index.js:313-347` vs `session-tree/index.js:563,972`；`tree-engine/index.js:187`(tokenMeter.measure) vs `session-tree/index.js:318`(tokenMeter.contextPressure)；`engine.js:53-55` vs `index.js:163-168` | **M**（若抽公共层）/ **0**（若不动，现状可共存） |

---

## 1. 审计对象与基线

### 1.1 仓库基线 [FACT]

```
$ git rev-parse --short HEAD
1b1f610
$ git log -1 --pretty='%h %ad %s'
1b1f610 2026-11-12 02:05:02 +0800 docs: record session-tree v1.3.7 release (mirror tag 91c177e, 19/19 SHA) ...
```

`packages/` 下只有三个包（无 `node_modules` 落地、无 `pnpm-workspace.yaml`、**无根 `package.json`**）——本仓的 "monorepo" 是**目录约定**，不是包管理器构造。[FACT]
> 直接推论：拆分**不需要**改任何 workspace 配置（没有 workspace 可拆）；包是经 profile 的 `link:` 逐条挂载的（§3.6）。[INFERENCE]

| 包 | 版本 | private | deps | peerDeps | 客户端半 | 发布状态 |
|---|---|---|---|---|---|---|
| `@local/dsh-tree-engine` | 0.7.0 | **true** | 无 | 无 | **无** | 仅随本仓公开（npm 冻结 D3） |
| `@orphiczhou/dsh-session-tree` | 1.3.7 | 无 | 无 | 无 | 有（`client.js`） | 公开镜像仓 + 社区市场 |
| `@local/dsh-agent-introspect` | 0.1.0 | 无 | 无 | 无 | 无 | 仅随本仓公开 |

> 命令：`Get-ChildItem packages -Recurse -File -Filter package.json | ConvertFrom-Json` → `deps=`/`peer=` 全空；`private=True` 仅 tree-engine。[FACT]

### 1.2 三个包在运行时的真实形态

| 维度 | tree-engine | session-tree | agent-introspect |
|---|---|---|---|
| Cordis bundle | `dsh.bundle.patch` → `cordis.patch.yml` | 同 | 同 |
| patch insert 行数 | 2（自身 + skill provider） | 2（自身 + skill provider） | 1（仅自身） |
| skill providerName | `tree-engine` | `session-tree` | — |
| 状态落盘 | `<DSH_PROFILE_DIR>/tree-engine-data/` | 无自有状态（交接文件写入工作区 `HANDOFF-*.md`） | 无（只读 projcache） |
| 工具数 | 9 | 2 | 1 |

证据：`packages/dsh-tree-engine/package.json:20-25`、`packages/dsh-tree-engine/cordis.patch.yml:11-20`、`packages/dsh-tree-engine/index.js:201,801,849-853`；`packages/dsh-session-tree/package.json:44-57`、`packages/dsh-session-tree/cordis.patch.yml:17-26`、`packages/dsh-session-tree/index.js:1376-1386`；`packages/dsh-agent-introspect/cordis.patch.yml:1-3`、`index.js:113-116`。[FACT]

---

## 2. 三个包的入口 / exports / 注入 / 注册（逐项）

### 2.1 入口与 exports

| 包 | `exports` | 说明 |
|---|---|---|
| tree-engine | `"."` → `./index.js`；`"./engine"` → `./src/engine.js`；`"./package.json"` | 宿主半单入口 + 纯逻辑引擎子入口（供测试与外部复用）<br>`package.json:7-11` |
| session-tree | `"."` → `./index.js`；`"./client"` → `./client.js`；`"./package.json"`；`"./cordis.patch.yml"`；`"./locale/*.json"` | 宿主半 + 浏览器半 + 补丁/语言包<br>`package.json:25-31` |
| agent-introspect | `"."` → `./index.js`；另 `main: index.js` | `package.json:6-7` |

### 2.2 `ctx.inject` 注入的宿主服务名（Cordis 服务名，不是 npm 包名）

| 文件:行 | 注入服务 | 注册内容 |
|---|---|---|
| `tree-engine/index.js:809` | `['tools','subagents','sessionQuery']` | 9 个 `tree_*` 工具（`:849-853` 循环注册）；另 `ctx.timer` 走 mixin + `ctx.get('timer')` 兜底（`:819-826`） |
| `session-tree/index.js:1379` | `['tools','subagents','sessionQuery']` | `tree_send`（`:1381`） |
| `session-tree/index.js:1383` | `['tools','subagents','agents','tokenMeter']` | `session_handoff`（`:1385`） |
| `agent-introspect/index.js:113` | `['tools']` | `self_spec`（`:116`） |
| `session-tree/client.js:2012` | `['slots','sessions','uiWorkspace','sidebarRight','locale']` | 客户端半（槽位注册见 `:2035-2037`，priority **-100** 抢占 `sidebar.workspaces`） |

> **重要区分**：`package.json` 的 `dsh.client.inject` 是**客户端模块级依赖**（先加载哪些模块），与 `client.js` 里 `inject: [...]` 的**Cordis 服务名**是两套机制。[FACT]
> session-tree 声明模块级依赖 2 个：`@deepseek-ai/dsh-client-ui-sidebar`、`@deepseek-ai/dsh-client-ui-workspace`（`package.json:52-56`）；同一字段在宿主自带 `dsh-client-ui-subagent/package.json:30-37` 也是包名数组，可确证语义。[FACT]

### 2.3 注册的工具 / Provider / 事件

| 包 | 工具 | Provider | 事件订阅 |
|---|---|---|---|
| tree-engine | `tree_plan` `tree_node` `tree_dispatch` `tree_report` `tree_status` `tree_verify` `tree_log` `tree_maintain` `tree_doctor`（`index.js:801` 冻结数组） | 无 | 无（`index.js` 中 4 处 `.on(` 全是 `child_process`，`:271-274`） |
| session-tree | `tree_send`（定义 `index.js:191`，execute `:243-293`）、`session_handoff`（`HANDOFF_TOOL` 定义 `index.js:1109`，execute `:1194-1374`） | 客户端 Cordis **Inspect** provider：id `SessionTree`、method `snapshot`（`client.js:1828-1829,1917-1993`） | 无 |
| agent-introspect | `self_spec`（`index.js:54`） | 无 | 无 |

### 2.4 patch 行与元数据

```
packages/dsh-tree-engine/cordis.patch.yml
 12  - id: tree-engine            name: '@local/dsh-tree-engine'
 14  - id: tree-engine-skills     name: '@deepseek-ai/dsh-skill-filesystem'
 17      providerName: tree-engine   includeDefaultRoots:false  watch:false
 20      bundledSkillDir: ... resolve('@local/dsh-tree-engine/package.json') ... 'skills'
packages/dsh-session-tree/cordis.patch.yml
 18  - id: session-tree           name: '@orphiczhou/dsh-session-tree'
 20  - id: session-tree-skills    name: '@deepseek-ai/dsh-skill-filesystem'
 23      providerName: session-tree  includeDefaultRoots:false  watch:false
 26      bundledSkillDir: ... resolve('@orphiczhou/dsh-session-tree/package.json') ... 'skills'
```
[FACT] 两条 skill provider **互相独立**：不同 `providerName`、各自解析自己的包身份，不存在交叉依赖。

`files` 白名单：tree-engine 含 `index.js/src/skills/cordis.patch.yml/icon.svg/README.md`（`package.json:12-19`，**不含 tests**）；session-tree 含 `index.js/client.js/cordis.patch.yml/icon.svg/locale/skills/README.md/README.zh.md/AGENT-INSTALL.md/LICENSE`（`package.json:32-43`，**不含 `test/` 与 `scripts/`**）。但 `release-plugin.mjs` 按目录全量镜像（不读 `files`），故公开镜像仓实际携带 `test/` 与 `scripts/verify-bundle.mjs`——两侧清单口径不一致，是拆分独立仓时必须显式决定的一项。[FACT + INFERENCE]

> 旁证：`docs/operations/handoff-2026-11-12.md:162` 明确记录这一差异——"`release-plugin.mjs` 按**目录全量**同步（19 文件，含测试脚本）"。[FACT]

---

## 3. 跨包引用矩阵（六类，不是五类）

> 说明：任务书要求区分「代码 import / 文档叙事 / 发布脚本 / Skill 叙事 / 测试 fixture / profile 配置」——按此六类逐条给证据。搜索词：`tree-engine|session-tree|agent-introspect|tree_send|session_handoff`，排除 `node_modules`。

### 3.1 类 1：代码 import —— **0 命中** [FACT]

```
$ Select-String packages/**/*.{js,cjs,mjs} -Pattern "from '(@local|@orphiczhou)/|require\('(@local|@orphiczhou)"
→ NO cross-package import statements found
```
三包 `import` 目标只有 `node:*` 内置模块、`../src/*`、`../index.js`。三包 `package.json` 的 `dependencies`/`peerDependencies` 全空（§1.1）。[FACT]

### 3.2 类 2：文档叙事（本仓顶层文档）

| 文件 | session-tree 相关提及 | tree-engine 相关提及 | 是否需随拆分改 |
|---|---:|---:|---|
| `README.md` | 33 | 30 | 需（组件表 `:22-24`、装法 `:41-42,65-75,92-95`、Skill 表 `:157-164`、目录树 `:180-182`） |
| `agent.md` | 58 | 29 | 需（决策 `D1:88` `D11:98` `D13:100`、状态 `:112-119`、工程命令 `:34-39`、风险 `:187-190`） |
| `CHANGELOG.md` | 35 | 49 | 需（版本分节混排：session-tree 1.3.x 各节 + tree-engine 在 `[Unreleased]` 下 `:37`） |
| `docs/README.md` | 8 | 3 | 需（快照行 `:5`、合并记录 `:29`） |
| `docs/guides/publishing.md` | 20 | 5 | 需（`:22` "tree-engine 不单独建仓"、`:23` "会话树是唯一发布镜像包"、`:60` 版本维护口径） |
| `docs/guides/install-guide.md` | 24 | 13 | 需（`:11-15` 路线 A/B、`:36-95` 路线 B） |
| `docs/guides/skills-usage.md` | 32 | 65 | 需（`:12` 三 Skill 归属表、`:71` "tree-engine 不是一个独立仓库"） |
| `docs/operations/handoff-2026-11-12.md` | 23 | 22 | 需（`:21-23` 组件行、`:86` 运行时数据、`:99-114` 测试命令） |
| `docs/project-map-2026-11-11.html` | 85 | 128 | 需（被 `check-version-consistency.mjs:712-734` 断言） |
| `docs/architecture/*` | 119 | 12 | 部分（`merge-session-tree-2026-11-11.md` 80 处 = 历史合并记录，建议只加"已拆分"注记） |
| `docs/reports/*`、`docs/archive/*` | ~200 | ~120 | **不需**（历史证据，只读留档） |

> 计数为文件内 token 出现次数（含自指），命令见附录 A1。[FACT]

### 3.3 类 3：发布脚本

| 脚本 | session-tree | tree-engine | 结论 |
|---|---:|---:|---|
| `scripts/release-plugin.mjs` | 11 | **0** | 只镜像 `packages/dsh-session-tree`（`DEFAULT_SOURCE` `:57`），完全不知道 tree-engine [FACT] |
| `scripts/release-all.mjs` | 6 | **0** | 同理；`pkgDir = join(REPO_ROOT,'packages',short)`（`:539`）、`DEFAULT_PKG='@orphiczhou/dsh-session-tree'`（`:48`）、测试候选清单硬编码 `dsh-session-tree` 的 5 个入口（`:729-738`）[FACT] |
| `scripts/check-version-consistency.mjs` | 28 | 62 | **强耦合**：见 §7.1 |
| `packages/dsh-session-tree/scripts/verify-bundle.mjs` | 28 | **0** | 只校验自身包（`pkgDir` 缺省 `join(here,'..')`，`:38`）[FACT] |

### 3.4 类 4：Skill 叙事（最实质的一层）

**tree-engine → session-tree（3 处显式包名 + 多条工具名）**

| 位置 | 原文要点 | 缺包时的行为 |
|---|---|---|
| `skills/tree-commander/SKILL.md:198` | "⚠️ `session_handoff` 由会话树单包 `@orphiczhou/dsh-session-tree` 提供，不是 tree-engine 的工具。若工具列表里没有它：不要伪造调用、不要自己改 profile——继续用竹节自报，并向你的上级/用户报告" | 显式降级指令 [FACT] |
| `skills/tree-worker/SKILL.md:100` | 同上（"不依赖 tree-engine、不需要指挥官批准"） | 显式降级指令 [FACT] |
| `skills/tree-commander/SKILL.md:211` | 跨层通信："直接父会话用原生 `send_message`，**跨层（兄弟/越级）才用 `tree_send`**——目标父会话须活着" | 有原生替代路径 [FACT] |
| `skills/tree-worker/SKILL.md:104,116,121-124,153` | 交接规则、note 模板、owner 不迁移的协调话术、一图流 | 叙事层 [FACT] |
| `README.md:37,45` | "`session_handoff` 由会话树单包提供"；"会话交接纪律入 skill" | 叙事层 [FACT] |

**session-tree → tree-engine（1 处注释 + 1 处表格 + SKILL 2 处）**

| 位置 | 原文要点 |
|---|---|
| `packages/dsh-session-tree/index.js:813-814` | 注释："The Host process runs with the profile directory as its cwd (**tree-engine's relative dataDir proves it**)" —— 仅作证据引用，无代码依赖 [FACT] |
| `packages/dsh-session-tree/AGENT-INSTALL.md:27` | 排障表："`tree_plan`/.../`tree_doctor` ❌ these live in `@local/dsh-tree-engine`, monorepo-only" [FACT] |
| `packages/dsh-session-tree/skills/session-handoff/SKILL.md:26,181-182,187` | "若还有 tree-engine 的竹节接力…本技能是会话层兜底"；交接协调表；"tree-commander/tree-worker 由另一个包提供，**不随本插件包发布**" [FACT] |
| `packages/dsh-session-tree/README.md:45-46,260` / `README.zh.md:45-46,260` | 指向源码仓 `docs/guides/skills-usage.md` 与 "monorepo-only tree-engine" [FACT] |

> **方向性结论**：叙事耦合是**单向为主**（tree-engine 依赖 session-tree 的能力），反向只有"指路"性质。[INFERENCE，依据上两表]

### 3.5 类 5：测试 fixture / 测试脚本

| 位置 | 内容 | 是否跨包 |
|---|---|---|
| `tree-engine/tests/*.test.js`（14 个） | 只 import `../src/*` 与 `../index.js`；fixture 自建临时目录 | 否 [FACT] |
| `tree-engine/tests/skills.test.js:45` | `assert.match(body, /session_handoff/, ...)` —— **文本断言**，不要求 session-tree 安装 | 叙事断言 [FACT] |
| `tree-engine/tests/skills.test.js:18,50-53` | `repoRoot = pkgDir/../..`，断言"仓根旧 skills/ 副本已删除" | **假定 monorepo 两级目录结构** [FACT] |
| `tree-engine/tests/diff.test.js:26,69` | `SOURCE_ENGINE_PATH='D:/Codes/tree-harness/tree-engine.cjs'`，`require()` 无存在性守卫 | **依赖第三个仓**（与 session-tree 无关，但影响 tree-engine 独立可移植性）[FACT] |
| `tree-engine/tests/doctor.test.js:39-44,62-63` | 自建 patch/README/package.json 夹具，断言 `providerName: tree-engine` 与 `@local/dsh-tree-engine/package.json` | 包名硬编码 [FACT] |
| `session-tree/test/*`（6 入口） | 只 import `../index.js`、`node:*`；`provider-conformance.cjs` 依赖 DSH asar 解包 fixture（`:35,53,307-311`，缺则 exit 2） | 否（与 tree-engine 无关）[FACT] |
| `scripts/skill-e2e/summarize-run.mjs:55` | `TREE_TOOLS = [8 个工具]`（**缺 `tree_doctor`，已漂移**）+ 解析 `session_handoff` 调用 | 分析器同时假定两包工具族存在 [FACT] |
| `scripts/e2e/verify-handoff.mjs` | 1 处 `session_handoff`；`run-release-e2e.mjs` 0 命中 | 弱 [FACT] |

### 3.6 类 6：profile 配置（活体证据，仓外只读）

`C:\Users\sir_c\.dsh\profiles\desktop\package.json`（活体 desktop profile）[FACT]

```
 6  "bundles": [ ... 29  "@orphiczhou/dsh-session-tree",  31  "@local/dsh-tree-engine", ... ]
37  "@local/dsh-agent-introspect": "link:D:/Codes/dsh-tree-harness/packages/dsh-agent-introspect",
46  "@local/dsh-tree-engine":       "link:D:/Codes/dsh-tree-harness/packages/dsh-tree-engine",
47  "@orphiczhou/dsh-session-tree":  "link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree",
```

结论：**三个独立 install spec + 三个独立 bundle 条目**；任何一包被移除/停用，另两包的安装与加载不受影响（Loader 按包名独立缓存，`agent.md:66` D12）。[FACT + INFERENCE]

---

## 4. 共同依赖的 DSH 原语：共用 vs 重实现

### 4.1 原语调用矩阵（逐条 file:line）

| DSH 原语 | tree-engine | session-tree | 是否"同一能力两种实现" |
|---|---|---|---|
| `tools.register` | `index.js:850`（9 次循环） | `index.js:1381,1385` | 同模式，各自实现 |
| `subagents.startContinuable`（legacy） | `index.js:323`（compat 优先） | — | tree 独有 |
| `subagents.startActivation`（rc.2 现役） | `index.js:327`（`delivery:'parent'`） | `index.js:972`（`delivery:'parent'`，request 里多带 `cwd`） | **同原语，两份 spec 拼装** |
| `subagents.sendMessage` | `index.js:143`（竹节交棒优先通道） | — | tree 独有 |
| `subagents.prompt` | `index.js:148`（交棒兜底）、`:660`（攻击修复回注） | `index.js:273`（`tree_send` 主通道） | **同一底层调用，两处独立封装** |
| `subagents.interrupt` | `index.js:335-347` + `src/compat.js:132-139`（authority 三候选） | — | tree 独有 |
| `sessionQuery.filterSessions` | `index.js:124,135` | `index.js:255` | 同查询形状 |
| `sessionQuery.readSession` | `index.js:159,174,185,433` | — | tree 独有 |
| `tokenMeter` | **`measure(snap)`** `index.js:187` | **`contextPressure(session)`** `index.js:318` | **⚠ 同一服务的两个不同 API** |
| `agents.get` | `index.js:301,309`（活祖先 Agent 查找） | `index.js:554`（判断父是否存活） | 各自实现 |
| `agents.create` | — | `index.js:1018`（root 接替会话） | sess 独有 |
| `agentPresets.mount` | — | `index.js:637`（工作模式继承） | sess 独有 |
| `workspaceRegistry.resolveByPath` / `Workspace.attachSession` | — | `index.js:493,515,523` | sess 独有 |
| `workingDirectory.get/set` | — | `index.js:358,659` | sess 独有 |
| `session.append('permission/preset' …)` | — | `index.js:612-614,640` | sess 独有 |
| `timer.interval` | `index.js:823`（sweep 60s 兜底） | — | tree 独有 |
| `loader.entries/resolve`（locale） | — | `index.js:791-807` | sess 独有 |
| 工具 exec 上下文 `exec.agent` / `exec.cwd` / `exec.signal` | `index.js:671`(`exec.agent`)、`:646`(`exec.cwd`) | `index.js:257`(`exec.signal`)、`:147,158`(`exec.agent`) | 同机制 |
| `agentLoop` | **0 调用** | **0 调用** | 两包都不碰 agent loop（`grep '.agentLoop'` 全仓 packages = 0） |
| `storage` 服务 | **0 调用**（直连 fs：`src/store.js` 的 `fsStore`，原子写 tmp+rename） | **0 调用**（直连 `node:fs/promises`） | 各自落盘，不经宿主 storage [FACT] |
| `projcache`（会话投影缓存文件） | 0 | 0 | 仅 `agent-introspect/index.js:22-28,78-89` 直读 `~/.dsh/storages/session_projcache/` |

### 4.2 四处"同源不同实现"的具体分叉

| # | 能力 | tree-engine 做法 | session-tree 做法 | 后果 |
|---|---|---|---|---|
| D1 | **会话 id 归一化** | `src/engine.js:53-55` 写入侧 `normalizeSessionId`，state 存裸 UUID；比较侧 `sameSession`（`guards.js` 注释 `:8-9`） | `index.js:163-168` `shortSessionId` 只剥 `session-` 前缀做**文件名**（8 字符） | 两套规则，语义不同但同源；任一侧改规则不会同步 [INFERENCE] |
| D2 | **continuable 能力探测** | `src/compat.js:96-105` 三值 `legacy\|activation\|none`，**legacy 优先**，两形皆缺 fail-closed 抛 `E_PORTS_PROTOCOL` | `index.js:559-564` 只探测 `typeof subagents.startActivation === 'function'`，**无 legacy 分支**，缺则 sibling 降级为 root | 旧宿主上：tree 报协议错、sess 静默降级——**同一宿主两种行为** [FACT+INFERENCE] |
| D3 | **消息投递** | `index.js:133-170` `promptHandoff`：先 `sendMessage(liveAncestor,…)`，失败回退 `prompt({mode:'continuable',delivery:'queue'})` | `index.js:243-293` `tree_send`：直接 `prompt({mode:'continuable',delivery:args.delivery})`，父地址由 `sessionQuery` 解析 | 同一底层 `prompt` 请求形状在两个文件里各写一遍（`requestId` 前缀都不同：`tree-engine-handoff-` vs `session-tree-`）[FACT] |
| D4 | **上下文水位** | `tokenMeter.measure(snap)` + 防御性字段猜测（`index.js:187-192`，候选 `pct\|contextPct\|context.pct\|pressure.pct\|usage.pct`），失败返回 `null` → 回退执行者自报 | `tokenMeter.contextPressure(session)`（`index.js:318`），取 `pressureTokens/contextWindow` 求百分比 | 宿主 token-meter 文档推荐的同步 API 是 `contextPressure(session)`（asar `dsh-token-meter/README.md:48`）；tree 侧走的是 `measure()` 的另一条路径 [FACT+INFERENCE] |

### 4.3 handoff 文件生成：**没有共用，也没有复用**

| 机制 | 谁做 | 产物 | 载体 |
|---|---|---|---|
| 竹节接力（bamboo） | tree-engine（`src/engine.js:484-521`） | **不写文件**；向旧会话投递 K1–K5 简报指令（`index.js:36-39`），`readSession` 提取简报文本（`index.js:52-71`），全文注入新会话 prompt（`index.js:81-83`） | 会话日志 |
| 会话自交接（session_handoff） | session-tree（`index.js:1194-1374`，工具定义 `:1109`） | `<cwd>/HANDOFF-<shortid>-<stamp>.md`（`:1302`，`renderHandoffFile`） | 工作区文件 |

> 两套 handoff 协议**互不复用**：tree-engine 的 `HANDOFF_INSTRUCTION` 用 K1–K5；session-handoff 的文件格式是 `Task/Progress/Next steps/Files/…` 段落。唯一交集是 SKILL 里要求模型**人工协调**两者优先级（`tree-worker/SKILL.md:99-100,118`）。[FACT]

---

## 5. tree-engine 与「DSH 内置子智能体插件」的真实关系

### 5.1 内置插件的实际 API（宿主 asar 只读取证）

```
$ node scripts/asar-tool.cjs "D:\DSHarness\resources\app.asar" grep "dsh-subagent/lib/index\.js" "startActivation|sendMessage|prompt\(|interrupt"
@deepseek-ai/dsh-subagent/lib/index.js:3051  async startActivation(spec)
@deepseek-ai/dsh-subagent/lib/index.js:3087  async sendMessage(sender, targetId, content, options)
@deepseek-ai/dsh-subagent/lib/index.js:3202  async prompt(request, signal)
@deepseek-ai/dsh-subagent/lib/index.js:3120  interrupt(targetSessionId, authority)
@deepseek-ai/dsh-subagent/lib/index.js:3208  throw new RemoteError("subagent/parent-unavailable", ...)
```

[FACT] 由此确证三件事：
1. `startContinuable` 在当前宿主**已不存在**（0 命中）→ tree-engine `src/compat.js` 的 legacy 分支是**死代码保底**，`session-tree` 只认 `startActivation` 是**当前唯一正确形状**；
2. `prompt(request, signal)` 的入参确实是 `{parentSessionId, childSessionId, delivery, requestId}`（`:3203,3212`），并强制"父会话必须活着"（`:3208`）——这正是 session-tree `tree_send` 能寻址兄弟、但要求父仍活的根因（`index.js:40-53` 注释已如实声明）；
3. `session-tree/index.js:275` 传入的 `mode:'continuable'` 与 `content` 字段在宿主实现里不被 `prompt` 解构（`：3203` 只取 4 个字段）→ **冗余字段，非契约** [INFERENCE]。

### 5.2 dispatch 如何创建/继续会话

| 步骤 | 位置 | 行为 |
|---|---|---|
| 捕获活父 Agent | `index.js:41-44,85-96` | 首次派发从工具 `exec.agent` 捕获，存 `parents` 内存表（不序列化）；竹节接力复用 |
| 拼任务书 | `index.js:78-83` | DoD + 结算指令（要求调用 `tree_report`）+ 交接简报（若有） |
| 起会话 | `index.js:313-331` | `detectStartMechanism` → legacy `startContinuable` / 现役 `startActivation({delivery:'parent'})` |
| 记录 | `src/engine.js:422-425` | 派发即把执行者绑为 leaf owner（`rt.subagentSessionId` + `leaf.session_id = 执行者`） |

### 5.3 bamboo relay 如何复用 sendMessage / resume

`src/engine.js:484-521`（`bambooRelay`）[FACT]：

```
490  brief = await ports.promptHandoff(rt.subagentSessionId)     → index.js:133-170（sendMessage 优先，prompt 兜底 + 12s 宽限轮询）
499  await ports.interrupt(rt.subagentSessionId, rt.parentSessionId)
502  await ports.dispatch({... handoffBrief: brief, segmentIndex: n+1 ...})
509  rt.segmentChain.push(session.sessionId)
510  rt.subagentSessionId = session.sessionId
513  leaf.session_id = session.sessionId        ← v0.5.0 起 owner 重绑（审计 B1 修复）
515  leaf.context_usage_pct = 0
```

> 结论：**竹节接力不复用 session-tree 的任何东西，也不复用 DSH 的"resume"概念**——它是"interrupt 旧会话 + 起新会话 + 手工搬运简报"三件套；`sendMessage`/`prompt` 只用于让旧会话先吐出简报。[FACT]

### 5.4 leaf 的 owner 迁移

| 场景 | owner 是否迁移 | 证据 |
|---|---|---|
| 首次派发 | 绑为执行者 | `src/engine.js:425`（`leaf.session_id = session.sessionId`） |
| 竹节接力 | **自动重绑** | `src/engine.js:511-513` + `README.md:37` |
| `session_handoff`（会话树） | **不迁移**，需 commander 用 `tree_node {action:"set-session"}` 重绑 | `tree-node` 命令表 `src/engine.js:759`、写权矩阵 `src/guards.js:149`（`set-session` 仅 creator）、错误码 `src/guards.js:116`、SKILL `tree-worker:121-124`、`tree-commander:200-215` |

> 这是**协议级耦合的实体**：tree-engine 专门保留了一个工具动作（`set-session`）和一个错误码（`E_BORROWED_IDENTITY`）来与 session-tree 的行为对齐。[FACT+INFERENCE]

### 5.5 commander Skill 是否要求用 `tree_send` 给 leaf 发消息

**不是强制**。`tree-commander/SKILL.md:211` 原文：直接父会话用**原生 `send_message`**，只有"跨层（兄弟/越级）"才用 `tree_send`。[FACT]
→ 即 `tree_send` 在 tree-engine 叙事中是**可选增强**，不是协议必需。

### 5.6 session_handoff 纪律是否被 tree-engine 的 runtime/leaf/验收假设

| 假设点 | 是否被代码假设 | 证据 |
|---|---|---|
| runtime 依赖 `session_handoff` 调用 | **否** | `grep session_handoff packages/dsh-tree-engine/index.js src/` = 0（仅 SKILL/README/测试） |
| 验收（verify）依赖 | **否** | `tree_verify` 只看 `leaf.verification`/artifact/command，`src/verify.js` 无 handoff 概念 |
| leaf 状态机依赖 | **否** | `src/state.js` 枚举无 handoff |
| 叙事假设"模型会先试竹节再交接" | **是** | `tree-worker/SKILL.md:118`、`tree-commander/SKILL.md:194` |

---

## 6. session-tree 是否隐含 tree-engine 概念

### 6.1 结论：**不隐含**（两棵"树"是不同的树）[FACT]

| 检查项 | 结果 |
|---|---|
| `client.js` 出现 `leaf\|dispatch\|DoD\|tree_\|task tree` | **0 命中**（`grep` 确认） |
| `client.js` 读取 `tree-engine-data` | **0 命中** |
| `index.js` 引用 tree-engine 的 state / 工具 | **0 命中**（仅 1 处注释引用其 dataDir 作为"cwd=profile"的证据，`:813`） |

**"session tree" = DSH 会话谱系**（`parentId` + `origin:'subagent'`）；**"task tree" = tree-engine 自有 JSON 状态机**（`<profile>/tree-engine-data/`）。二者共享的只是"树"这个词。[FACT]

### 6.2 client.js 的数据来自哪里

| 数据 | 来源 | 证据 |
|---|---|---|
| 会话行 + 谱系 | **槽位 props**：`useSessions(sel)` → `state.byId` / `state.projectionsBySession`（`parentId`、`origin:'subagent'`、`subagentCatalog`） | 头注释 `client.js:22-33`；行归一化 `:440-468` |
| 工作区分组 | `useWorkspaces()` → Host 有序 `WorkspaceView[]`（按 `sessionIds` 成员，不按 cwd） | `:7-15,641-653,1020` |
| 标题刷新 | **Host RPC**：`ctx.get('remote').session.list({})`（可选服务，失败仅打日志） | `:1058-1077` |
| 会话打开 | `ctx.uiWorkspace.openSession(...)`（root）/ `openResource('dsh-resource://subagentchat/...')`（子会话） | `:36-39,513-525,1237-1270` |
| pin/unpin | `ctx.remote.workspace.pinSession`（可选，`:1290-1315`） | `:1282-1315` |
| 调试快照 | 自有 Inspect provider `SessionTree`（可选注入 `cordisInspect`） | `:1902-1997,2012` |

### 6.3 隐含依赖（**与 tree-engine 无关，但拆分必须知道**）

| 依赖 | 声明状态 | 证据 | 影响 |
|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-subagent`（提供 `subagentchat` 资源协议） | **未在 `dsh.client.inject` 声明** | 地址格式抄自宿主 `dsh-client-ui-subagent/lib/client.js:698-704`（session-tree 注释 `:507-524`）；asar 只读取证：该包 `lib/client.js:708,733,762` 定义 `dsh-resource://subagentchat/` 协议 | 组合缺该 UI 包时，点子会话可能打不开；本机活体正常 [FACT + UNKNOWN(是否必要)] |
| `sidebarRight` 服务 | 已注入但未声明对应模块 | `client.js:2012` | 同上，风险低于上条 [INFERENCE] |

---

## 7. 打包 / 发布 / 版本工具链耦合

### 7.1 `scripts/check-version-consistency.mjs`（最重的工具链耦合）[FACT]

```
 51  const PACKAGES = { engine: 'packages/dsh-tree-engine/package.json',
 53                      session: 'packages/dsh-session-tree/package.json',
 54                      introspect: 'packages/dsh-agent-introspect/package.json' }
 56  const SKILLS   = [ tree-commander, tree-worker, session-handoff ]        ← 跨两包
 61  const DOCS     = { readme, agent, docsReadme, skillsUsage, changelog, map,
 68                    engineReadme, sessionReadme, introspectReadme }        ← 跨两包
103  if (!existsSync(path.join(root, PACKAGES.engine.rel))) { exit 2 }       ← 以 engine 为"本仓"判据
233  TOOLS 静态解析（engine index.js 的 TOOLS 数组）→ 工具数 9
321  package.json description 必须写 "(9 tree_* tools)"
390  README 组件表 → 逐包版本
457  agent.md 状态行 → 两包版本 + 测试数
542  docs/README 快照行 → 两包版本
565  skills-usage 头部/§9 → 两包版本
626  tree-engine README 最新版本节
652  session-tree README 当前发布
661  docs/README 会话树测试计数
697  CHANGELOG 当前版本条目
712  项目地图 hero（tree-engine vX · N 工具 · T/T）
735  项目地图组件表（三包）
755  项目地图测试指标
776  --run-tests：跑 tree-engine 测试并与文档数比对
```

- 该脚本 **20 条 check**，其中约 **9 条**直接断言 session-tree、**6 条**断言 tree-engine、**5 条**同时断言两者（块级计数，见附录 A2）。[FACT]
- **致命前提**：`:103-106` 若 `packages/dsh-tree-engine/package.json` 不存在直接 `exit 2` —— 即"tree-engine 搬走"会让这个仓级脚本**整体失效**，而"session-tree 搬走"只是删一半断言。[FACT]

### 7.2 发布管线

| 管线 | 覆盖 | tree-engine aware? |
|---|---|---|
| `release-plugin.mjs` | 目录全量镜像 `packages/dsh-session-tree` → 公开仓；逐文件 SHA-256 复核 | 否（0 命中）[FACT] |
| `release-all.mjs` | 预检 → `release-plugin` 同步 → 本仓 commit → 镜像 commit/tag → `ls-remote`；默认 dry-run | 否（0 命中）[FACT] |
| 镜像仓 `orphiczhou/dsh-session-tree` | v1.3.7 = `91c177e`，19/19 SHA | 该仓**不含** tree-engine [FACT] `publishing.md:13,124` |
| npm | **冻结**（D3） | 三包均未上 npm [FACT] `publishing.md:60` |

### 7.3 profile bundle / skill provider

- 三个 bundle 条目、三条 `link:` 依赖，各自独立（§3.6）。[FACT]
- 两个 skill provider 各自 `providerName` + 各自 `bundledSkillDir`（§2.4）→ **无交叉**。[FACT]
- 运行时数据目录：`tree-engine-data/` 在 profile 下（`handoff-2026-11-12.md:86`），与 session-tree 无关 → 拆仓**不需要迁移状态**。[FACT]

### 7.4 文档绑定叙事（决定拆分成本的真正大头）

| 叙事 | 位置 | 强度 |
|---|---|---|
| "tree-engine 不是一个独立仓库，不能像 session-tree 那样粘 Git URL" | `docs/guides/skills-usage.md:71`；`install-guide.md:15`；`AGENT-INSTALL.md:31` | **强**（用户可见的安装路径） |
| "会话树是唯一发布镜像包" | `publishing.md:23` | 强 |
| "两个能力不会再各自漂移或装成不匹配的版本" | `session-tree/README.md:287`（讲 handoff 并入） | 中 |
| "三分层组件"结构图（执行层/自省层/树） | `README.md:22-24,180-182`；`agent.md:21-23` | 中 |

---

## 8. 测试耦合（移除一包会不会弄挂另一包）

### 8.1 结论：**不会**（无 import、无共享 fixture、无进程内联动）[FACT]

| 检查 | 结果 |
|---|---|
| session-tree 测试 import tree-engine | 0（6 个入口只 import `../index.js` / `node:*`） |
| tree-engine 测试 import session-tree | 0（14 个文件只 import `../src/*`、`../index.js`、`node:*`） |
| 共享 fixture 目录 | 无 |
| tree-engine 测试断言 session-tree **存在** | 无；仅 `tests/skills.test.js:45` 断言 SKILL **文本里提到** `session_handoff`（字符串） |
| session-tree 测试断言 tree-engine | 无（`skills.test.cjs` 只查自身 frontmatter/files/patch） |

### 8.2 但有两个"独立的坑"

| 坑 | 位置 | 触发条件 | 归属 |
|---|---|---|---|
| 差分测试硬编码外部仓 | `tree-engine/tests/diff.test.js:26,69` | 任何没有 `D:/Codes/tree-harness/tree-engine.cjs` 的机器 → `MODULE_NOT_FOUND`，112 项中 diff 的 3 项失败 | tree-engine（拆仓必修）[FACT] |
| 仓根路径假设 | `tree-engine/tests/skills.test.js:18,50-53` | 包移到仓根后 `pkgDir/../..` 指到仓外，断言仍"碰巧"通过但语义失效 | tree-engine（拆仓应改）[FACT+INFERENCE] |

> 附带发现：`scripts/skill-e2e/summarize-run.mjs:55` 的工具清单仍是 8 个（缺 `tree_doctor`）——测试工具链已轻微漂移，拆分时应顺手修。[FACT]

### 8.3 测试规模（静态核对，未执行）[FACT]

- tree-engine：14 个 `.test.js`，静态 `test(` 声明 **111** 处 + 1 处循环生成 2 例（`skills.test.js:33-48`）= **112**，与 `agent.md:34` 的 112/112 自洽。[INFERENCE，未执行]
- session-tree：6 个入口（`test/handoff.test.js`、`skills.test.cjs`、`render.test.cjs`、`style-guard.cjs`、`provider-conformance.cjs`、`scripts/verify-bundle.mjs`）。

---

## 9. 拆分影响面 A：`session-tree` → 独立仓库 / 独立发布插件

### 9.1 判定：**可行（工作量 M）** —— 90% 的路已经走过

已具备的条件 [FACT]：

1. 公开镜像仓存在且与包目录**逐字节一致**（19/19 SHA，`publishing.md:124`）。
2. 包内自带 `scripts/verify-bundle.mjs`（10 项 bundle 契约自检）；注意 `package.json.files` **未列** `scripts/`，但 `release-plugin` 按目录全量镜像，故镜像仓/独立仓可直接使用。
3. 6 个测试入口全部包内自足（无跨包 import）。
4. `package.json` 无 dependencies/peerDependencies，`exports` 完整（`.`/`./client`/patch/locale）。
5. 客户端半只依赖 DSH 客户端服务，不依赖 tree-engine。

### 9.2 必须改的引用点（精确清单）

| # | 位置 | 现状 | 改法 | 成本 |
|---|---|---|---|---|
| A1 | `scripts/release-plugin.mjs:57` | `DEFAULT_SOURCE=<repo>/packages/dsh-session-tree` | 独立仓后该脚本随包迁走或退役；本仓删除 | S |
| A2 | `scripts/release-all.mjs:48,539,729-738` | `DEFAULT_PKG` + `join(REPO_ROOT,'packages',short)` + 5 个测试入口 | 同上，迁到独立仓（`pkgDir` 改仓根） | S |
| A3 | `scripts/check-version-consistency.mjs:53,59,69` + ~9 条 check | 断言 session-tree 版本/README/CHANGELOG/项目地图/测试数 | 删除 session 相关条目；保留 engine/introspect；`facts/package-json` 循环改为两包 | **M** |
| A4 | `README.md:22-24,41-42,65-75,92-95,157-164,180-182` | 三组件表 + 双路线装法 + profile 片段 + 目录树 | 改为"本仓 = 执行层 + 自省层；会话树见独立仓" | **M** |
| A5 | `agent.md:34-39,66,72-77,88,98,100,112-119,187-190` | 工程命令含 session-tree 6 入口；决策 D1/D11/D13；状态卡 | 拆出工程命令节、把 D1/D11/D13 标注"已迁出" | **M** |
| A6 | `CHANGELOG.md`（35 处，`:5-35` 全是 session-tree 1.3.x） | 混排 | 拆成两份 CHANGELOG；本仓保留历史链接 | S |
| A7 | `docs/README.md:5,29`；`docs/guides/{publishing,install-guide,skills-usage}.md` | 快照行、"唯一发布镜像包"、路线 A/B | 改写为跨仓引用（绝对 URL，遵循 `docs/README.md:85` 的跨仓引用纪律） | **M** |
| A8 | `docs/operations/handoff-2026-11-12.md:21-23,66,99-114` | 组件行 + 测试命令 | 更新指引 | S |
| A9 | `docs/project-map-2026-11-11.html`（85 处） | 组件卡 + 指标 | 移除/改链；同步脚本 `:712-755` | S |
| A10 | `tree-engine/skills/tree-commander:198`、`tree-worker:100`、`tree-engine/README.md:45` | "会话树单包 `@orphiczhou/dsh-session-tree` 提供" | **语义不变**（包名/仓库可以不同），只需可选地把"单包"改为"插件包"；**保留降级措辞** | **XS** |
| A11 | `session-tree/README.md:45-46,260`、`README.zh.md`、`AGENT-INSTALL.md:13-14,27,51-78` | 指向 monorepo 的路线 B 与 `docs/guides` | 改为"完整树体系在另一个仓"的绝对 URL | S |
| A12 | profile `desktop/package.json:29,47` | `link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree` | 换成新仓路径或 Git URL；`include:session-tree` 需 disable→enable（Loader 按包名缓存，`agent.md:66`） | S（运维） |
| A13 | `docs/architecture/merge-session-tree-2026-11-11.md`（80 处） | 历史合并记录 | **不动**，加一行"2026-11-XX 已迁出独立仓" | XS |

### 9.3 不需要改的（重要减负项）

- `packages/dsh-session-tree/**` 源码：0 行需要改（无 tree-engine 引用，除 1 处注释可保留）。
- `packages/dsh-tree-engine/index.js`、`src/**`：0 行需要改。
- `cordis.patch.yml`：`providerName`/包名/路径解析全部与仓库位置无关（`resolve('@orphiczhou/dsh-session-tree/package.json')`）。
- 两个测试套件：互不影响。
- 运行时数据：session-tree 无自有状态目录；`tree-engine-data` 属 tree-engine。

### 9.4 估算

| 项 | 人日（粗估） |
|---|---|
| 文档改写（A4–A9、A11） | 1.5–2 |
| 脚本改造 + 自测（A1–A3） | 0.5–1 |
| Skill 措辞 + 测试回归（A10） | 0.25 |
| 发布演练（镜像 → 独立仓 CI/标签） | 0.5 |
| **合计** | **≈ 3 人日（M）** |

---

## 10. 拆分影响面 B：`tree-engine` → 独立项目 / 独立发布插件

### 10.1 判定：**有条件可行（工作量 L）** —— 这不是"搬家"，是"新建项目"

阻塞/必改项 [FACT]：

| # | 事实 | 位置 | 为什么是阻塞 |
|---|---|---|---|
| B0 | 包名 `@local/dsh-tree-engine` | `package.json:2`；`cordis.patch.yml:13,20`；`src/doctor.js:34`（`EXPECTED_PACKAGE_NAME`）；`tests/doctor.test.js:40,62-63`；`scripts/check-version-consistency.mjs:52` | `@local` 是不可发布的 scope；改名校验器/测试/补丁四处联动 |
| B0b | `"private": true` | `package.json:4` | 宿主 plugin-manager 对**官方目录** bundle 明确拒绝 `private === true`（asar `dsh-plugin-manager/lib/index.js:1035`：`manifest.private === true … throw`）。本地 link + patch 不受影响（活体已证），但上市场/官方目录必须先去掉 [FACT + INFERENCE] |
| B1 | 无 `repository` / `license` / `author` | `package.json`（全文 27 行，仅 name/version/private/type/description/exports/files/dsh/icon） | 公开仓/市场 listing 所需元数据缺失（对比 `session-tree/package.json:6-24`） |
| B2 | 无发布管线 | 三个 release 脚本 0 命中 tree-engine | 需新建 CI/发布脚本（可直接复用 `release-plugin.mjs` 形态） |
| B3 | `tests/diff.test.js:26,69` 硬编码 `D:/Codes/tree-harness/tree-engine.cjs` | 同左 | 新仓无此兄弟仓 → 112 项中 3 项必挂；需 vendor 基准或加 `existsSync` skip |
| B4 | `tests/skills.test.js:18,50-53` 用 `pkgDir/../..` 当仓根 | 同左 | 移到仓根后路径语义失效（断言仍通过但失真） |
| B5 | `src/doctor.js:74` 提示串写死 `packages/dsh-tree-engine/package.json` | 同左 | 用户可见误导 |
| B6 | `scripts/check-version-consistency.mjs:103-106` 以 engine 包为"本仓"判据 | 同左 | 反向：engine 一旦离开，**本仓脚本整体 exit 2**，必须重构 |
| B7 | `src/doctor.js` 的 `tool-count` 断言绑 `TOOLS.length` 与 README 版本节（`:70-99,120`） | 同左 | 与文档强绑，迁出后需自带文档或放宽 |

### 10.2 可保留/无需改

- 9 个工具名、`providerName: tree-engine`、状态目录 `tree-engine-data/`：与仓库位置无关，**保持不变**即可平滑迁移。[FACT]
- 随包 Skill 对 session-tree 的 3 处引用**无需改**（它引用的是包名，不是路径）；仅建议把"单包"改为"插件包"。[INFERENCE]
- 引擎 `src/*` 纯逻辑零外部依赖（`src/compat.js` 头注释 `:6` 自证"不 import 任何 `@deepseek-ai/*`"）。[FACT]

### 10.3 估算

| 项 | 人日（粗估） |
|---|---|
| 清单改造（改名/去 private/补元数据/patch 两行/skill provider 路径） | 0.5 |
| 校验器与测试适配（B3–B7，含 112 项回归） | 1.5 |
| 新仓骨架 + CI + 发布脚本（可抄 session-tree 的） | 1.5 |
| 本仓侧文档/脚本重构（§9.2 的 A3–A9 反向版 + 三分体→两分体） | 2 |
| 安装/重载演练（link 路径变更 + disable→enable + `tree_doctor` 7 检查） | 0.5 |
| **合计** | **≈ 6 人日（L）** |

---

## 11. `tree_send` / `session_handoff` 应留在哪一侧？依赖强度判定

### 11.1 归属建议：**留在 session-tree（基础层）** —— 有代码与决策双重依据

| 论据 | 证据 | 类型 |
|---|---|---|
| 两能力**已按用户决策**并入同一宿主半，理由写明"bundle 是一个可安装单位，合并省掉第二个 install spec，并保证两能力一起走" | `session-tree/index.js:15-19`；`agent.md:98`（D11 用户原话） | FACT |
| `tree_send` 是 `subagents.prompt` 的**薄封装**（定义 50 行 + execute 51 行），只依赖 `tools/subagents/sessionQuery` 三服务，零 UI 依赖 | `index.js:191-241`（定义）、`:243-293`（`filterSessions:255` → `prompt:273`） | FACT |
| `session_handoff` 依赖 6 个宿主服务 + 写工作区文件 + 起会话，属"会话生命周期"能力，与"会话树/会话寻址"同域 | `index.js:308-379`（`collectFacts`）、`:966-1049`（`spawnSuccessor`）、`:1302`（写文件） | FACT |
| 拆成第三个插件会把"一次安装得到树+交接"退化为两次安装，与 D11 相反 | `agent.md:98`；`install-guide.md:11-12` | FACT+INFERENCE |

### 11.2 tree-engine 对它们的依赖强度：**软依赖**

| 维度 | 是否硬依赖 | 证据 |
|---|---|---|
| 代码 import / 调用 | **否** | 0 处引用（§3.1、§5.6） |
| 工具存在性 | **否** | 9 个 `tree_*` 工具都能独立注册；`session-tree` 未装时 `ctx.inject(['tools','subagents','sessionQuery'])` 与 tree-engine 的注入互不影响 |
| 关键链路（竹节） | **否** | bamboo 用自研 `promptHandoff`（`index.js:133-170`），不用 `session_handoff` |
| 叙事/纪律 | **是** | 3 处显式包名 + SKILL 大量协调规则；缺包时 SKILL 要求"降级 + 上报"（`tree-commander:198`、`tree-worker:100`） |
| 一致性风险 | **是** | leaf owner 不迁移 ⇒ 必须靠 `set-session` 人工重绑（`guards.js:149`）；两套 handoff 并存会诱使模型选错（`tree-worker:118` 已用优先级规则缓解） |

> **一句话**：拆掉 session-tree 不会让 tree-engine 报错，但会让"50% 上下文兜底"这条**用户可见能力**从产品里消失，并使 leaf owner 迁移失去对应的对话层解释。[INFERENCE]

---

## 12. 三个最大耦合点 + 风险清单

### 12.1 最大耦合点（复述，带坐标）

1. **协议耦合（C1）**：`E_BORROWED_IDENTITY` + `tree_node set-session` ↔ `session_handoff` 不迁移 owner。
   `src/guards.js:116,149` · `src/engine.js:198-205,511-513` · `tree-commander/SKILL.md:200-215` · `tree-worker/SKILL.md:121-134`
2. **工具链耦合（C2）**：`check-version-consistency.mjs` 的三包 × 六文档断言网 + engine 存在性前提。
   `scripts/check-version-consistency.mjs:51-71,103-106`（20 checks，±9 与 session-tree 相关）
3. **隐性共享接口（C3）**：同一批 DSH 原语两套适配（起会话 / 投递 / 水位 / id 归一化），零共享代码。
   `tree-engine/index.js:313-347,187` · `session-tree/index.js:243-293,318,559-564,972` · `engine.js:53-55` vs `index.js:163-168`

### 12.2 风险与未知

| 级别 | 项 | 说明 |
|---|---|---|
| 中 | DSH 升级二次维护 | `startContinuable` 已从宿主移除（asar 取证）；tree-engine 有 `src/compat.js` 兜底、session-tree 只认 `startActivation`（`index.js:563`）—— 下一次 API 漂移，两包**分别**失败，症状不同 [FACT+INFERENCE] |
| 中 | `tokenMeter` 双 API | tree 用 `measure()`（字段防御猜测，`:187-192`），sess 用 `contextPressure()`（`:318`）；宿主文档推荐后者（asar `dsh-token-meter/README.md:48`）→ tree 侧测量可能长期返回 `null` 而静默退化为自报 [INFERENCE] |
| 中 | 差分测试外部仓 | `tests/diff.test.js:69` 无守卫，拆分/新机器必挂 [FACT] |
| 低 | `summarize-run.mjs` 工具清单漂移 | 8 个工具（缺 `tree_doctor`）[FACT] |
| 低 | `session-tree` 未声明 `dsh-client-ui-subagent` | 子会话打开依赖其资源协议（asar `client.js:708,762`）[FACT+UNKNOWN] |
| UNKNOWN | 宿主 `plugin_manager` 是否会在"非官方目录"的 Git-URL 安装路径上拒绝 `private:true` | 只确认官方目录校验（asar `dsh-plugin-manager/lib/index.js:1035`）；本机 link 安装可用，未做 Git-URL 装 tree-engine 实验（纪律禁止装插件） |
| UNKNOWN | DSH 0.2.2-rc.1 是否对 `subagents.prompt` 的 `mode/content` 冗余字段做严格校验 | 宿主实现 `:3203` 只解构 4 字段，未见校验；无负例实验 |

---

## 13. 给下游（E2/E3）的三条硬结论

1. **不要按"拆代码"立项**：拆的是**发布单元与文档体系**，不是模块。任何"抽公共 adapter 包"的方案都会立刻引入双向依赖，把现状的零代码耦合变成真耦合。[INFERENCE，依据 §3.1、§4]
2. **拆 session-tree 的性价比远高于拆 tree-engine**：前者是"把已有镜像仓扶正 + 改文档/脚本"（≈3 人日），后者是"新建公开发布项目"（≈6 人日，且要先解决 `@local` scope 与 `private:true`）。[INFERENCE，依据 §9.4、§10.3]
3. **拆分不改变用户安装形态**：今天就已经是 3 条独立 `link:` + 3 个独立 bundle 条目（profile 活体取证），拆分只是把"同一个仓里的三个目录"变成"两个仓里的三个目录"。若目标是"两个独立插件"，**已经达成，不需要任何代码改动**。[FACT，依据 §3.6]

---

## 附录 A：复现命令（全部只读）

```powershell
# A0 基线
git -C D:\Codes\dsh-tree-harness rev-parse --short HEAD
Get-ChildItem D:\Codes\dsh-tree-harness\packages -Directory | Select-Object Name

# A1 文档提及计数（示例：README）
$t = Get-Content -Raw D:\Codes\dsh-tree-harness\README.md
([regex]::Matches($t,'session-tree|tree_send|session_handoff')).Count
([regex]::Matches($t,'tree-engine|tree_plan|tree_dispatch|tree_node|tree_report|tree_verify|tree_status|tree_doctor')).Count

# A2 check-version-consistency 各 check 的包提及计数
$t = Get-Content -Raw D:\Codes\dsh-tree-harness\scripts\check-version-consistency.mjs
[regex]::Split($t,"(?=^check\(')",'Multiline') | ForEach-Object {
  if ($_ -match "^check\('([^']+)'") { "{0}  session={1} engine={2}" -f $Matches[1],
    ([regex]::Matches($_,'session-tree|sessionReadme|v\.session')).Count,
    ([regex]::Matches($_,'tree-engine|v\.engine')).Count } }

# A3 跨包 import 检查（应为 0）
Get-ChildItem D:\Codes\dsh-tree-harness\packages -Recurse -File -Include *.js,*.cjs,*.mjs |
  Select-String -Pattern 'from .(@local/dsh-tree-engine|@orphiczhou/dsh-session-tree|@local/dsh-agent-introspect)'

# A4 宿主 API 只读取证（asar，不写任何文件）
cd D:\Codes\dsh-tree-harness
node scripts/asar-tool.cjs "D:\DSHarness\resources\app.asar" grep "dsh-subagent/lib/index\.js" "startActivation|sendMessage|prompt\(|interrupt"
node scripts/asar-tool.cjs "D:\DSHarness\resources\app.asar" grep "dsh-client-ui-subagent/lib/client\.js" "subagentchat"
node scripts/asar-tool.cjs "D:\DSHarness\resources\app.asar" grep "dsh-plugin-manager/lib/index\.js" "private.*bundle|bundle.*private"

# A5 活体 profile（只读）
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Pattern 'dsh-session-tree|dsh-tree-engine|dsh-agent-introspect'
```

## 附录 B：核心证据索引（file:line 速查）

| 主题 | 坐标 |
|---|---|
| tree-engine 工具注册 | `packages/dsh-tree-engine/index.js:801,809,849-853` |
| tree-engine 宿主半无 client | `packages/dsh-tree-engine/package.json`（无 `dsh.client`）、包内无 `client.js` |
| tree-engine 状态目录 | `index.js:201`；`docs/operations/handoff-2026-11-12.md:86` |
| tree-engine compat 双形 | `index.js:313-347`；`src/compat.js:96-139` |
| 竹节 relay + owner 重绑 | `src/engine.js:484-521`（尤其 `:511-513`） |
| owner 写权矩阵 / 借用身份 | `src/guards.js:116,149`；`src/engine.js:198-205,759` |
| tree-engine 抄 session_handoff 的叙事 | `skills/tree-commander/SKILL.md:198,211`；`skills/tree-worker/SKILL.md:100`；`README.md:45` |
| session-tree 两工具入口 | `index.js:191-241`、`:243-293`、`:729`(HANDOFF_TOOL) |
| session-tree apply/注入 | `index.js:1376-1386` |
| session-tree 客户端注入/槽位 | `client.js:2012,2035-2037` |
| session-tree 客户端数据源 | `client.js:22-33,1058-1077` |
| session-tree 对 tree-engine 的唯一注释 | `index.js:813-814` |
| session-tree 模块级 client 依赖 | `package.json:52-56` |
| 两 patch 行 | `dsh-tree-engine/cordis.patch.yml:11-20`；`dsh-session-tree/cordis.patch.yml:17-26` |
| 版本一致性脚本 | `scripts/check-version-consistency.mjs:51-71,103-106,233-254,712-755,776-810` |
| 发布脚本（仅 session-tree） | `release-plugin.mjs:57`；`release-all.mjs:48,539,729-738` |
| 包内 bundle 自检 | `packages/dsh-session-tree/scripts/verify-bundle.mjs:38,65,101-118` |
| 活体 profile 三条目 | `C:\Users\sir_c\.dsh\profiles\desktop\package.json:12,29,31,37,46,47` |
| 发布/范围口径 | `docs/guides/publishing.md:13,22-24,60,124`；`docs/guides/install-guide.md:11-15,36-95` |
| 拆分相关决策 | `agent.md:88`(D1 合并)、`:98`(D11 handoff 并入)、`:100`(D13 skill 随包) |
