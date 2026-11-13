# dsh-tree-harness

> **DSH（DeepSeek Harness）树形任务分解执行 Harness + 插件集合**。
> A tree-structured task decomposition & execution harness for DeepSeek Harness, plus a small collection of DSH plugins.

本仓不是一个单一插件，而是一组围绕「树形任务执行」的包、规约与文档：任务分解 → 分层派发（子智能体嵌套）→ 执行 → 分任务类型验证 → 收割回流，外加自省层与会话树视图。

> 🗺️ **项目全景地图**：一页看懂本项目的组件全景、工具面、真机流程、机制与已知边界——[docs/project-map-2026-11-11.html](docs/project-map-2026-11-11.html)（单文件 HTML，离线可读；[在线版](https://orphiczhou.github.io/dsh-tree-harness/project-map-2026-11-11.html)）。
> **Project map**: one page covering components, tool surface, real-machine flows and known boundaries — open [docs/project-map-2026-11-11.html](docs/project-map-2026-11-11.html).

- 许可证：**MIT**（见 [LICENSE](LICENSE)）
- 状态与测试数字为 **2026-11-12 实测快照**（各包 `package.json` 版本为准；Wave-2 收口见 [docs/reports/wave2-closeout-2026-11-12.md](docs/reports/wave2-closeout-2026-11-12.md)）
- 公开范围：**仓库内资料公开**（公开前已排除隐私截图与第三方源码，见 [agent.md](agent.md) 决策 D7）
- 代码零 npm 依赖：不 import 任何 `@deepseek-ai/*` 包，仅通过宿主 `ctx` 使用 DSH 原生服务（`subagents` / `timer` / `storage` / `tools` / `sessionQuery` 等）

---

## 组件与状态

| 包 | 版本 | 能力 | 测试 | 当前状态 |
|---|---|---|---|---|
| [`packages/dsh-tree-engine`](packages/dsh-tree-engine/) | 0.8.1 | 执行层：9 个 `tree_*` 工具（`tree_plan` / `tree_node` / `tree_dispatch` / `tree_report` / `tree_status` / `tree_verify` / `tree_log` / `tree_maintain` / **`tree_doctor` 只读自检**），含依赖编排、竹节接力（上下文自动换棒）、对抗式验证、差分金标准、leaf 写面护栏（`LEAF_WRITE_MATRIX`）；Wave-2 增补：**W2.1** 会话预算计入竹节链（`runtime.segmentChain` 归一化去重）、**W2.3** RC2 兼容层抽 `src/compat.js`（双形探测 + 11 测）、**W2.6** root/主会话 id 归一化（`session-` 前缀与裸 UUID 等价比较）；**v0.8.0 组合修复**：per-leaf relay 开关（`tree_node {action:"set-relay"}`）、tokenMeter 测量端口修复、sweep 跨实例（热更僵尸）生命周期、relay parent 重解析；**v0.8.1 深度预算**：派发/竹节接力/攻击审计会话显式传 `request.maxDepth`（缺省 5，`TREE_ENGINE_CONFIG.max_subagent_depth` 可覆盖；此前插件派发路径无平台深度兜底）；**随包 tree-commander/tree-worker Skill v2.2** | **172/172** | ✅ 运行中（本机 desktop profile 已装载，活体 v0.8.1） |
| [`packages/dsh-agent-introspect`](packages/dsh-agent-introspect/) | 0.1.0 | 自省层：`self_spec` 工具，投影当前会话的 model / permissions / sandbox / cwd / token 用量 | —（无单测） | ✅ 运行中 |
| [`packages/dsh-session-tree`](packages/dsh-session-tree/) | **1.4.0** | 会话树单包：左栏嵌套会话树 + **会话界面底部元数据条（model / reasoning effort / 上下文 %；子会话补官方缺失的 model/effort，只读子会话用标题栏 chip 兜底）** + `tree_send` 跨层级消息工具（**v1.4.0 起仅同树投递、移除 `parent` 入参、调用者谱系校验**）+ **`session_handoff` 会话自交接**（同层级接替，继承工作区 / Agent 预设 / 权限模式 / 模型 / 思考等级）+ **随包 `session-handoff` Skill**；**接替提示语跟随 DSH 界面语言（zh/en）**；工作区排序 / 隐藏恢复 / 检索召回 | 包内 8 个测试入口（handoff **41/41**、tree-send **25/25**、meta **41/41**、render **151/151** + 9/9 + 11/11、style-guard 26/26、verify-bundle 0 fail、provider-conformance **29/29**） | 🌐 GitHub 公开（镜像 **v1.4.0** = `0343f0c`，main + tag，**21/21 SHA**）、社区市场已收录；**npm 未发布** |

状态口径：

- **运行中** = 当前本机 desktop profile 已装载，并通过活体检查（`cordis_inspect_*` 读到对应工具 / provider）。
- **npm 未发布** = 刻意的安装策略（只走 Git / `link:`），见 [docs/guides/publishing.md](docs/guides/publishing.md)；决策 D3。

---

## 快速开始

> **只想用 Skill、不想读源码？** 直接看 [docs/guides/skills-usage.md](docs/guides/skills-usage.md)——三个随包 Skill（`tree-commander` / `tree-worker` / `session-handoff`）的安装、发现、最小提示词、三层任务树、50% 交接、语言与排障都在那一页。

### 三条安装路线（按需选择）

| 路线 | 适合 | 得到 | 入口 |
|---|---|---|---|
| **A. Git URL 装 session-tree** | 普通用户/只想要会话树与交接 | 侧栏会话树 + `tree_send` + `session_handoff` + `session-handoff` Skill | [Plugins 页粘贴仓库 URL](docs/guides/install-guide.md#2-路线-a只装-session-treegit-url--市场--本地路径)；**Agent 看 [AGENT-INSTALL.md](packages/dsh-session-tree/AGENT-INSTALL.md)** |
| **B. 本地链接 monorepo（全栈）** | 要完整树体系（任务树/竹节/验收）或参与开发 | A 的全部 + tree-engine 9 个 `tree_*` 工具 + `tree-commander`/`tree-worker` Skill + `self_spec` | [安装指南 §3](docs/guides/install-guide.md#3-路线-b装完整树体系session-tree--tree-engine--agent-introspect) |
| **C. 市场/社区目录** | 已在第三方 DSH 插件目录里浏览 | 同 A（按 `package.json.version` 判断更新） | 市场 listing 指向公开镜像仓 |

> 完整、逐步的人类安装指南：[docs/guides/install-guide.md](docs/guides/install-guide.md)。给 AI Agent 的安装/验收/排障矩阵：[packages/dsh-session-tree/AGENT-INSTALL.md](packages/dsh-session-tree/AGENT-INSTALL.md)（随包发布到公开镜像仓）。

### 前置

- **DSH 桌面版 `0.2.2-rc.1`**（Cordis 插件宿主 + Web GUI）
- DSH 自带的 Node v24 runtime（实测 v24.21.0），无需额外安装；各包无 npm 依赖
- 本仓 `packages/` 建议放在 desktop profile 的 `hmr.root` 覆盖范围内（本机即为 `D:/Codes/dsh-tree-harness/packages`），客户端半改动刷新页面即可；**宿主半（`index.js`）改动在本机实测需对该 bundle 做一次 disable→enable（或用新包名/重启 DSH）才加载新实现**——Loader 对已导入宿主模块按包名缓存，逐条证据见 [agent.md](agent.md) §0.2。

### 安装到 profile

两种方式，二选一：

**A. `link:` 依赖 + 一次性 pnpm install**（开发态推荐）

```jsonc
// %USERPROFILE%\.dsh\profiles\desktop\package.json（示例，按实际 profile 调整）
{
  "dsh": {
    "profile": {
      "bundles": [
        "@local/dsh-tree-engine",
        "@local/dsh-agent-introspect",
        "@orphiczhou/dsh-session-tree"
        // 注意：bundle 顺序即装载顺序；新增 bundle 追加到此处
      ]
    }
  },
  "dependencies": {
    "@local/dsh-tree-engine": "link:D:/Codes/dsh-tree-harness/packages/dsh-tree-engine",
    "@local/dsh-agent-introspect": "link:D:/Codes/dsh-tree-harness/packages/dsh-agent-introspect",
    "@orphiczhou/dsh-session-tree": "link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree"
  }
}
```

然后使用 DSH 自带 runtime 的 pnpm 安装：

```powershell
node "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
```

新增包后需一次 `pnpm install`；客户端半改动刷新页面生效；宿主半（`index.js`）改动需 disable→enable 该 bundle 条目（或重启 DSH）——2026-11-11 实测 hmr.root 并未让已加载包的宿主模块重新求值。

**B. `plugin_manager` 热装载**

```jsonc
// 伪调用：实际以当前宿主 plugin_manager 工具参数为准
plugin_manager({ action: "install_bundle", target: "D:/Codes/dsh-tree-harness/packages/dsh-tree-engine" })
```

每个包自带 `cordis.patch.yml`，向 profile 贡献一条 `insert` 行（id 分别为 `tree-engine` / `agent-introspect` / `session-tree`）。`plugin_manager` 需要宿主授予较高权限；若只想改源码热更，走方式 A 即可。

### 跑测试

```powershell
cd packages/dsh-tree-engine
node --test tests/*.test.js     # tests 172 / pass 172 / fail 0（62 引擎 + 4 技能打包 + 1 B1 回归 + 9 tree_doctor + 8 写面护栏 + 14 compat + 10 identity + 7 budget + 12 relay + 17 token-meter + 7 usage-port + 9 validate + 8 sweep + 4 depth-cap）
```

> 14 个 `.test.js`；Wave-2 新增 `tests/compat.test.js`（11）、`tests/identity.test.js`（10）、`tests/budget.test.js`（7），原 84 项不回归；v0.8.0 再增 relay/token-meter/usage-port/validate/sweep 至 19 个 `.test.js` / 165 项。

⚠️ **不要写成 `node --test tests`**：Node 24 会把 `tests` 当文件路径，报 `test at tests:1:1` 的假失败。要机器可读计数加 `--test-reporter=tap`，且**必须放在位置参数之前**（放后面会被静默忽略）。

会话树单包（`packages/dsh-session-tree/`）自带 8 个测试入口（其中 `provider-conformance` 依赖 DSH asar 解包 fixture，属环境依赖）：

```powershell
cd packages/dsh-session-tree
node test/handoff.test.js      # 宿主半 session_handoff：41/41（交接层级矩阵/继承/工作区归属/闸门/失败可追溯）
node test/tree-send.test.js    # v1.4.0 同树投递/谱系校验：25/25（跨树/显式 parent/fail-closed）
node test/meta.test.cjs        # 会话元数据纯函数/只读判定（model/effort/context%）：41/41
node test/skills.test.cjs      # 随包 Skill 打包回归：3/3（frontmatter/files/patch 行）
node test/render.test.cjs      # 确定性夹具渲染检查（151/151 + 夹具自检 9/9 + 实时附加 11/11）
node test/style-guard.cjs      # 样式注入 / SSR 边界检查：26/26
node scripts/verify-bundle.mjs # 清单自检：0 fail
node test/provider-conformance.cjs [asar 解包目录]
# fixture 解析顺序：DSH_RC2_FIXTURE_DIR → %TEMP%\dsh-asar-inspect\out-rc2-compat → out
# rc.2 兼容 fixture（schema 引擎内联布局）→ 29/29，exit 0
# 缺 fixture 或只拿到当前宿主的 shared-chunk 拆包布局 → exit 2 + 可操作报错（不崩溃）；
# 属测试环境依赖，不是包内容缺陷（取证见 docs/reports/conformance-rc2-2026-11-12.md）
```

### 验证运行

| 手段 | 用途 |
|---|---|
| `self_spec` | 返回当前会话的 model / permissions / sandbox / cwd / token 投影（effort、温度显式标注不可读） |
| `cordis_inspect_list` / `cordis_inspect_query` | 可编程活体观测：列出 provider、查询 host Tool / Service / Config 与 client provider |
| `tree_status {action:"validate"}` | 校验树状态（迁移闭集 / 依赖 / 会话 id 唯一性等） |
| `tree_status {action:"harvest"}` | 显式收割：立即强制一轮（不必等定时 sweep；后台 `timer` 仍在跑） |
| `tree_doctor {action:"run"}` | **只读自检**（7 项：package / tool-count / skills / tree-data / stale / sweep / env）；给 `tree_id` 时额外校验该树并统计停滞节点；FAIL 不 throw，只返回 `summary` + `hint` |
| `node scripts/check-version-consistency.mjs` | **版本/文档一致性检查（W2.4，23 checks）**：包版本、工具数、测试数、README / SKILL / 文档索引口径是否互相对齐；`--json` 机读，`--run-tests` 追加执行测试并比对数量；0 失败才算过 |

---

## 架构要点

### 宿主半 / 客户端半

一个 DSH bundle 由两半组成，声明都在 `package.json`：

- **宿主半**：`dsh.bundle.patch` 指向 `cordis.patch.yml`。bundle 装载时向 profile 追加一行 `insert`（`id` + 包名），Loader 据此 import 宿主模块（`exports["."]`）。
- **客户端半**：`dsh.client`（`platform: "web"`，可带 `inject` 客户端包，如 `@deepseek-ai/dsh-client-ui-sidebar`）。浏览器侧经 `window.__ModuleLoader__.load({id, factory})` 物化；缺 `inject` 依赖则客户端半边不加载，而宿主半边照常。

客户端半契约（踩坑记录，写进 [docs/archive/handoff-2026-10-14.md](docs/archive/handoff-2026-10-14.md) §5）：

- `factory` 必须 `return module.exports`（插件对象含 `apply`），否则整页客户端启动冲突；
- 所有 DOM 副作用放在 `apply(ctx)` 里；
- 客户端半热更会**残留旧实例**：用单例注册表 + 令牌仲裁压制，彻底干净仍需刷新一次页面。

### 随包 Skill（SKILL 工程化，v0.8.1 / v1.4.0）

Skill 是插件工程的一部分，与工具同包、同版本、同发布：

| 包 | 随包 Skill | 挂载方式 |
|---|---|---|
| `packages/dsh-tree-engine` v0.8.1 | `skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md` | `cordis.patch.yml` 第 2 行 insert `@deepseek-ai/dsh-skill-filesystem`（`providerName: tree-engine`、`includeDefaultRoots:false`、`bundledSkillDir` 经安装包身份解析到包内 `skills/`） |
| `packages/dsh-session-tree` v1.4.0 | `skills/session-handoff/SKILL.md` | 同模式，`providerName: session-tree` |

- 效果：新会话的 Skill 目录直接出现 `tree-commander` / `tree-worker` / `session-handoff`，模型在**极简提示词**下即可发现「分层分解 / 逐层干活 / 上下文 50% 自主交接」的用法，不需要先把工具名喂给它；真机验证见 [docs/reports/skill-e2e-2026-11-11.md](docs/reports/skill-e2e-2026-11-11.md)。
- 版本：`tree-commander` / `tree-worker` 两份 SKILL 随 tree-engine **v0.8.0 升到 Skill v2.2**（9 工具、会话 id 归一化、预算口径、per-leaf relay 开关 `tree_node {action:"set-relay"}`）；`session-handoff` SKILL 随会话树 **v1.4.0**（补 `tree_send` 仅同树 / 无 `parent` 入参说明）。
- 打包回归：`packages/dsh-tree-engine/tests/skills.test.js`（4 项）与 `packages/dsh-session-tree/test/skills.test.cjs`（3 项）校验 frontmatter、`package.json.files`、patch provider 行与旧路径清理。
- 发布：会话树单包的 `skills/` 随 `package.json.files` 发布到公开插件仓（v1.4.0 = `0343f0c`，release-plugin **21/21 SHA** 一致）；tree-engine 为仓内插件，Skill 随本仓公开。
- 热更：新增/修改 patch 行受 D12 约束——对相应 bundle entry 做一次 disable→enable 或重启 DSH。

### Loader 包名缓存（关键机制）

DSH Loader 对**宿主模块按包名缓存**：

- 已装载包的 `index.js` 改动 → **单纯保存文件不会重新求值**（即使包在 `hmr.root` 内；2026-11-11 实测：改 `packages/dsh-session-tree/index.js` 后活体工具仍是旧实现）。对相应 bundle 条目做一次 disable→enable（`plugin_manager({action:"set_plugin", target:"include:session-tree", enabled:false})` 再 `enabled:true`；tree-engine 用 `include:tree-engine`）可加载新模块；重启 DSH 同样有效。
- 新包名没有缓存 → 普通安装即可生效。
- 本仓 `packages/` 虽位于 profile 的 `hmr.root` 内（本机 `D:/Codes/dsh-tree-harness/packages`），但**不要把 hmr.root 当作宿主半热更保证**：客户端半（`client.js`）刷新页面即生效；宿主半（`index.js`）与 **bundle patch**（新增/修改 insert 行，例如 Skill provider）改动请走 disable→enable 该 bundle 条目或重启 DSH，并逐条验证活体工具面/Skill 目录。
- 由于缓存按包名生效，把新功能并入**已有**包时不会自动替换已加载的旧宿主半；安装/升级后必须重载该 bundle 条目（本机实测 disable→enable 有效；其它路径未经实测不要依赖）。

### 目录结构

```
packages/
  dsh-tree-engine/       执行层：src/ 纯逻辑（含 compat.js / guards.js / token-meter.js / sweep.js）+ index.js 宿主适配 + tests/（20 个 .test.js + 偏差登记）
  dsh-agent-introspect/  自省层：index.js（self_spec）
  dsh-session-tree/      会话树单包（发布产物，与公开镜像仓同步；含 tree_send + session_handoff）
docs/                    规约、设计、交接（operations/）、一次性报告（reports/）、发布与审计文档
demo/  logs/             演示产物、运行日志（SKILL 资产已随包迁入 packages/*/skills/）
scripts/                 asar-tool / release-plugin / release-all（W2.7 一条命令发布）/ check-version-consistency（W2.4）
                         / check-doc-links / check-md-tables / e2e/run-release-e2e（W2.5 三条真机断言编排）
```

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [agent.md](agent.md) | **项目代理手册（开工必读）**：角色授权（Lead=指挥官+架构师）、决策 D1–D17、路线图 R1–R14、工程命令、发布门禁与回滚 |
| [docs/README.md](docs/README.md) | **文档总索引 + 归档规范**：按 architecture / guides / operations / reports / archive 分类，新增或迁移文档先读这里 |
| [docs/guides/install-guide.md](docs/guides/install-guide.md) | **人类安装指南**：三条安装路线（Git 镜像仓 / 本地 monorepo 全栈 / 市场）、组件矩阵、验收、升级卸载 |
| [packages/dsh-session-tree/AGENT-INSTALL.md](packages/dsh-session-tree/AGENT-INSTALL.md) | **AI Agent 安装指南**（随包发布到公开镜像仓）：预检、装/重载/验收/排障矩阵、回滚与回报模板 |
| [docs/project-map-2026-11-11.html](docs/project-map-2026-11-11.html) | **项目全景地图（单文件 HTML）**：图文混合讲清组件/架构/真机流程/机制/边界，并分析下一步功能（离线可看，内联 SVG；[在线版](https://orphiczhou.github.io/dsh-tree-harness/project-map-2026-11-11.html)） |
| [docs/operations/handoff-2026-11-12.md](docs/operations/handoff-2026-11-12.md) | **当前交接**：Wave-2 收口状态、决策速查（D1–D14/D16/D17）、关键路径、测试/验活命令、发布流程、风险与回滚、已知边界、下一轮议程 |
| [docs/operations/wave2-plan-2026-11-12.md](docs/operations/wave2-plan-2026-11-12.md) | **Wave 2 开发计划**：项目地图 §9 的下一步建议/波次安排 + Wave-1 剩余项 + 新发现，逐项给 DoD 与风险 |
| [docs/reports/wave2-closeout-2026-11-12.md](docs/reports/wave2-closeout-2026-11-12.md) | **Wave-2 收口证据报告**：W2.1–W2.8 结论表、代码变更清单、测试增量 84→112 逐文件拆分、三条脚本实测退出码、W2.6 活体前后对比 |
| [docs/reports/conformance-rc2-2026-11-12.md](docs/reports/conformance-rc2-2026-11-12.md) | W2.2 provider-conformance rc.2 fixture 取证：29/29 复验、fixture 来源与 SHA-256、缺 fixture 的 exit 2 行为 |
| [docs/reports/e2e-release-runner-2026-11-12.md](docs/reports/e2e-release-runner-2026-11-12.md) | W2.5 发布前真机 E2E 统一 runner：三条断言的编排/汇总/artifacts、离线故障注入、replay 边界与真机触发方式 |
| [docs/reports/release-automation-2026-11-12.md](docs/reports/release-automation-2026-11-12.md) | W2.7 发布自动化：一条命令（预检 → 同步/SHA → 本仓 commit → 镜像 commit/tag → `ls-remote`）、失败即停与回滚提示、凭据纪律、沙箱演练 |
| [docs/architecture/session-tree-ui.md](docs/architecture/session-tree-ui.md) | **会话树 UI 设计与迭代规范**：client.js 代码地图、改哪里速查、GUI 迭代 7 步流程、变更记录 |
| [docs/guides/skills-usage.md](docs/guides/skills-usage.md) | **随包 Skill 完整使用指南**：三个 Skill 的安装/发现/最小提示词/三层任务树/50% 交接/语言/排障/索引（GitHub 用户入口） |
| [docs/architecture/session-handoff-2026-11-11.md](docs/architecture/session-handoff-2026-11-11.md) | 会话自交接：v0.1.0 设计 + **v1.2.0 并入会话树/继承修复 + v1.3.0 随包 Skill + v1.3.1 语言跟随 + v1.3.5 洁净室收口** |
| [docs/reports/e2e-handoff-2026-11-11.md](docs/reports/e2e-handoff-2026-11-11.md) | 交接真机 E2E 取证：修复前 root FAIL 5/12 基线 → 修复后 root PASS 14/14 / sibling PASS 12/12 |
| [docs/reports/e2e-kickoff-language-2026-11-11.md](docs/reports/e2e-kickoff-language-2026-11-11.md) | 接替提示语语言真机 E2E：修复前 `lang=en` 基线 → v1.3.1 `lang=zh` + 接替首条中文 PASS |
| [docs/reports/skill-cleanroom-2026-11-11.md](docs/reports/skill-cleanroom-2026-11-11.md) | Skill 文档洁净室多轮评审：独立子会话对 GitHub 用户材料的第一/二/三轮检查与修订记录 |
| [docs/reports/skill-e2e-2026-11-11.md](docs/reports/skill-e2e-2026-11-11.md) | Skill 工程化真机 E2E：极简提示词 → skill 识别 → 三层分解/逐层干活/中间层 50% 交接（A/B/C 组） |
| [docs/reports/audit-tree-system-2026-11-11.md](docs/reports/audit-tree-system-2026-11-11.md) | tree 体系一致性审计：4 BLOCK / 12 需修 / 15 建议（file:line 证据 + 修复状态） |
| [docs/guides/publishing.md](docs/guides/publishing.md) | **发布状态与流程**：GitHub 两仓、社区市场、npm 冻结、版本纪律、公开前检查清单 |
| [PLAN.md](PLAN.md) | 开发方案（工作版）：范围、接口缝、验证策略层、里程碑 |
| [docs/architecture/engine-spec.md](docs/architecture/engine-spec.md) | 引擎行为规约（S0 冻结）：工具面、数据模型、状态机闭集、断言 |
| [docs/architecture/tools-mapping.md](docs/architecture/tools-mapping.md) | 工具面整合表（**S0 设计稿**）：上游工具 → 复合工具的映射与设计 action 集；实际注册的 9 个工具以 `index.js` schema 为准 |
| [docs/architecture/segment-handoff.md](docs/architecture/segment-handoff.md) | 竹节生长机制设计（上下文接力 / 竞争语义 / 配置键） |
| [docs/archive/project-restart-brief-2026-11-11.html](docs/archive/project-restart-brief-2026-11-11.html) | 项目重启简报（单文件 HTML，离线可读，含系统全景/依赖矩阵/发布现状） |
| [docs/archive/handoff-2026-11-11.md](docs/archive/handoff-2026-11-11.md) | 上一版交接（**已归档**：已被 2026-11-12 版取代；Wave-1 状态与历史证据保留） |
| [docs/archive/handoff-2026-10-14.md](docs/archive/handoff-2026-10-14.md) | 更早一版交接（历史参考：客户端模块契约 / DSH API 踩坑 / 工程纪律） |

---

## 已知边界（诚实清单）

1. **tree-engine sweep**：宿主 `timer` 服务可用时用它的 interval；不可用时 `systemClock()` 的**进程内 60s interval 兜底**（`sweepMode` 恒为 `timer`）。`tree_status {action:"harvest"}` 仍可立即强制一轮；不要假设 harvest 是唯一收割手段。（早期版本的 `degraded:no-timer` 说明已过时。）
2. **npm 冻结（决策 D3）**：`@orphiczhou/*` 候选包名在 npm registry 均 404；安装只走 Git / `link:`。解冻需项目所有者显式批准（条件见 [docs/guides/publishing.md](docs/guides/publishing.md)）。
3. **RC2 兼容层已补单测（v0.7.0，后续 v0.8.0 全套 165/165）**：DSH 0.2.1-rc.2 起 `subagents.startContinuable` 被移除，tree-engine 的双形探测已抽到 `src/compat.js`，`tests/compat.test.js` **11 例**覆盖双形探测 / interrupt authority 顺序 / sendMessage-prompt 回退（全套 165/165）；宿主再升级仍建议先 `cordis_inspect_query` 读方法表。
4. **provider-conformance 依赖 DSH asar 解包 fixture，且存在版本布局漂移**：fixture 解析顺序 `DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `out`；rc.2 兼容布局（schema 引擎内联）→ **29/29**，缺 fixture 或只拿到当前宿主的 shared-chunk 拆包布局 → **exit 2 + 可操作报错**（不再崩溃）。属测试环境依赖，不是包内容缺陷；fixture 来源与 SHA-256 见 [docs/reports/conformance-rc2-2026-11-12.md](docs/reports/conformance-rc2-2026-11-12.md)，布局背景见 [docs/architecture/merge-session-tree-2026-11-11.md](docs/architecture/merge-session-tree-2026-11-11.md) §5。
5. **Wave-2 预算口径边界**：`max_sessions` 已计入 `runtime.segmentChain`（W2.1），但接力前旧会话只存 `runtime.history`、暂不计（每个发生过接力的 leaf 约漏 1 个首派会话）；且 `bambooRelay` / `dispatch:start` 本身不预检预算，只有 `leaf:add` / `set-session` / `segment:append` / `tree:register-session` 拒绝超限——高频接力仍可静默越过上限。详见 [docs/operations/handoff-2026-11-12.md](docs/operations/handoff-2026-11-12.md) §7。
6. 更细的历史边界（`artifact` glob 取首个匹配可能命中 `node_modules`、`leaf.status` 与 runtime 终态脱节、flash 审计积压、`tree_maintain gc` 未实现等）见 [docs/operations/handoff-2026-11-12.md](docs/operations/handoff-2026-11-12.md) §7。

---

## License

[MIT](LICENSE) © 2026 orphiczhou
