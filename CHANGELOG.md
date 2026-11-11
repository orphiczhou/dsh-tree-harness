# Changelog

本文件记录本仓各包的重要变更：未发布变更归入 `Unreleased`，版本号取自各包 `package.json`，日期为北京时间。

## [1.3.7] — 2026-11-12 · provider-conformance rc.2 fixture 解析（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.6` → **`1.3.7`**（公开镜像仓同步发布；**运行时/客户端代码无行为变化**）。
- **W2.2**：`test/provider-conformance.cjs` 改为显式 fixture 解析（CLI 参数 → `DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `out`）；缺 fixture / 非 rc.2 布局时**以 exit 2 + 可操作报错退出**（此前为崩溃堆栈），正常路径 29/29；断言数量与语义未改。
- 包内 README（中/英）与 `AGENT-INSTALL.md` 版本引用同步到 `v1.3.7`（快照行、pin 示例）。

### 验证

- `node test/provider-conformance.cjs` → **29/29 PASS, exit 0**（fixture 来源与 SHA-256 见 [docs/reports/conformance-rc2-2026-11-12.md](docs/reports/conformance-rc2-2026-11-12.md)）；handoff **41/41**、skills **3/3**、render 全绿、style-guard 22/22、verify-bundle 0 fail。
- 发布：`release-plugin.mjs` 同步公开镜像仓（`files=19 match=19`），tag **v1.3.7 = `91c177e`**（main+tag=本地；`ls-remote` 核对通过）。

## [1.3.6] — 2026-11-12 · 文档归档 + 人类/Agent 安装指南（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.5` → **`1.3.6`**（公开插件仓同步发布；代码无行为变化）。
- **文档按目录归档**：`docs/` 重构为 `architecture/`（架构/规格）、`guides/`（安装/使用/发布）、`operations/`（当前交接/运维）、`reports/`（一次性报告，`<类型>-<主题>-YYYY-MM-DD.md`）、`archive/`（冻结历史）；新增 [docs/README.md](docs/README.md) 作为**单一索引 + 归档规范**；项目地图 HTML 保留在 `docs/` 根保证 GitHub Pages URL 稳定。
- **新增人类安装指南** [docs/guides/install-guide.md](docs/guides/install-guide.md)：三条安装路线（Git 镜像仓 / 本地 monorepo 全栈 / 市场）、组件矩阵、重载语义、验收与升级卸载。
- **新增 AI Agent 安装指南** `packages/dsh-session-tree/AGENT-INSTALL.md`（随包发布到镜像仓）：决策树、两条安装路线、profile 安全规则、重载语义表、7 项验收清单、升级/卸载/回滚、排障矩阵、回报模板。
- README（根 / 包内中英）补「安装路线选择」与 Agent 指南入口；`package.json.files` 纳入 `AGENT-INSTALL.md`（镜像仓文件数 18 → **19**）。
- 文档内所有相对链接随迁移重写（新增 `scripts/check-doc-links.mjs` 做常驻校验）。

### 验证

- `node scripts/check-doc-links.mjs`（LINK CHECK OK）、`node scripts/check-md-tables.mjs`（TABLE CHECK OK）。
- session-tree 测试入口保持全绿：handoff **41/41**、skills **3/3**、render 全绿、style-guard 22/22、verify-bundle 0 fail；tree-engine **84/84**。
- 发布：`release-plugin.mjs` 同步公开镜像仓（`files=19 match=19`），tag **v1.3.6 = `298298d`**（main+tag=本地）。

## [Unreleased]

### 2026-11-12 · Wave 2 收口（tree-engine v0.7.0 + 工具链/发布流程）

**`packages/dsh-tree-engine`（`0.6.0` → `0.7.0`）**

- **W2.1 会话预算计入竹节链**：`max_sessions` 计数集合补 `leaf.runtime.segmentChain`，与 `leaf.session_id` / `leaf.segment_chain` / `session_registry` 合并后按归一化会话 id 去重（`src/guards.js`）；`src/engine.js` 的 `validate` 同步纳入 `runtime.segmentChain`（跨集合重复检查）。
- **W2.3 RC2 兼容层抽离 + 单测**：`startContinuable` / `startActivation` 双形探测的纯逻辑抽到 `src/compat.js`（`index.js` 装配）；新增 `tests/compat.test.js` **11 例**，不引入宿主依赖。
- **W2.6 root/主会话会话 id 归一化**：DSH 根/主会话 id 带 `session-` 前缀、被派发子会话为裸 UUID v4；引擎**写入侧**归一化（剥前缀、小写、存裸 UUID 规范形），**比较侧** `normalizeSessionId` / `sameSession`（`src/guards.js`）接入 `added_by` / owner / caller 校验。`tree_plan` / `tree_node add` / `tree_report` 直接传 `$env:DSH_SESSION_ID` 即可。**UUID v4 严格性不放宽**（归一化后非 v4 仍 `E_INVALID_UUID_STRICT`）；历史带前缀旧值可读。活体：修复前 root 会话 `tree_plan` 带 `session-` 前缀 → `E_INVALID_UUID_STRICT`；修复后同一调用成功、root 存裸 UUID、`tree_node add` 混合形态 `added_by` 可用。
- 测试：`node --test tests/*.test.js` **84 → 112/112**（14 个 `.test.js`：62 引擎 + 4 技能打包 + 1 B1 回归 + 9 `tree_doctor` + 8 写面护栏 + 11 compat + 10 identity + 7 budget；新增 `tests/budget.test.js` 7 例、`tests/identity.test.js` 10 例）。
- 随包 SKILL 同步到 **v2.1 / 随 tree-engine v0.7.0**（9 个 `tree_*` 工具、`session-` 前缀归一化说明、`max_sessions` 计入竹节链）；`src/doctor.js` 版本提示串与 `index.js` 启动日志（v0.7.0）同步。

**工具链 / 脚本**

- **W2.2** `packages/dsh-session-tree/test/provider-conformance.cjs`：显式 fixture 解析（`DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `out`），缺 fixture 时 **exit 2 + 可操作报错**；得到 **29/29**（session-tree 包本体 v1.3.6 不变）。
- **W2.4** 新增 `scripts/check-version-consistency.mjs`（只读）：**23 checks**（package.json / `TOOLS` 导出与工具名 / 3 份 SKILL frontmatter / 根 README、`agent.md`、`docs/README.md`、`docs/guides/skills-usage.md` 的版本、工具数与测试数、包 README、CHANGELOG、项目地图）；支持 `--json` / `--run-tests` / `--root`；故障注入可 FAIL 自证。
- **W2.5** 新增 `scripts/e2e/run-release-e2e.mjs`：发布前三条真机断言（`verify-handoff` / `verify-kickoff-language` / `collect-skills`）统一编排、PASS/FAIL 汇总、artifacts 落盘（`scripts/e2e/artifacts/release-<ts>/`），支持 `--replay` 离线复核既有 artifact（**不替代真机断言**）。
- **W2.7** 新增 `scripts/release-all.mjs`：预检 → `release-plugin` 同步/SHA 对账 → 本仓 commit → 镜像 commit/tag → `ls-remote` 核对；**默认 dry-run**，`--apply` / `--skip-push` 走本地全链路，`--push` 才联网写远端；失败即停并给回滚提示。

**文档 / 报告**

- 新增报告：[docs/reports/conformance-rc2-2026-11-12.md](docs/reports/conformance-rc2-2026-11-12.md)、[docs/reports/e2e-release-runner-2026-11-12.md](docs/reports/e2e-release-runner-2026-11-12.md)、[docs/reports/release-automation-2026-11-12.md](docs/reports/release-automation-2026-11-12.md)；收口报告 `docs/reports/wave2-closeout-2026-11-12.md`。
- 文档口径统一到 tree-engine **v0.7.0 / 9 工具 / 112-112**：`agent.md`（D17 / §2 快照 / §3 R13–R14 / §4.2 任务板 / §7）、`docs/README.md`（快照 + engine-spec 修订说明 + reports/archive 索引）、`docs/guides/skills-usage.md`（版本、预算与 id 口径）、`docs/operations/wave2-plan-2026-11-12.md`（执行状态表）、`docs/architecture/engine-spec.md`（§5 后**追加** v0.7.0 修订段，不重写冻结正文）。
- W2.8 GUI 迭代规范 [docs/architecture/session-tree-ui.md](docs/architecture/session-tree-ui.md)（已在 `e09f39b` 建立）7 步流程现行；新交接 `docs/operations/handoff-2026-11-12.md`，旧 `handoff-2026-11-11.md` 归档。

**未发布说明**

- `packages/dsh-session-tree` **1.3.6 → 1.3.7**（W2.2 测试适配；公开镜像 tag `v1.3.7` = `91c177e`，19/19 SHA）；运行时行为不变，包内测试入口全绿（handoff 41/41、skills 3/3、render 133+9+11、style-guard 22/22、verify-bundle 0 fail、provider-conformance 29/29）。
- **本轮无 npm 动作**（D3 冻结）；**已执行**：本仓 `master` 推送（Wave-2 三笔提交 + 本发布记录提交）+ 公开镜像 **v1.3.7** 发布（`release-plugin` 19/19 SHA、tag `91c177e`、`ls-remote` 远端=本地）。`release-all.mjs` 本轮以 dry-run/沙箱演练验证（真推走既有手工流程）；`run-release-e2e.mjs` 的真机三断言本体待发布前人工触发。

### 变更

- **移除已废止的 meta-loop 插件及其资料（与本项目无关）**：删除 `packages/dsh-meta-loop/`、`demo/metalp/`、`docs/meta-loop-design.md`、`docs/meta-system-argument.md`；并从 `README.md`、`agent.md`、`docs/guides/publishing.md`、项目地图等当前材料中清除该插件信息。本项目组件口径 = `dsh-tree-engine` + `dsh-session-tree` + `dsh-agent-introspect` 三个包。
- 项目全景地图（`docs/project-map-2026-11-11.html`）提升为 GitHub 项目介绍入口：README 标题区新增入口段，`agent.md` 开工顺序新增同一链接。
- **tree-engine `0.5.1` → `0.6.0`：新增只读自检工具 `tree_doctor`（第 9 个工具）**。`src/doctor.js` 纯逻辑 + `index.js` 注册；7 项检查（`package` / `tool-count` / `skills` / `tree-data` / `stale` / `sweep` / `env`），每项 `{id, status: PASS|WARN|FAIL, detail, hint?}`；返回 `summary{pass,warn,fail}` + 一行 `hint`，传 `tree_id` 时额外校验树并统计停滞节点。**只读零写副作用**（不写树状态/日志），**FAIL 不 throw**（诊断器不是门禁；只有非法 `action` 抛错）。治「工具或 Skill 为什么没出现」只能靠猜。`tests/doctor.test.js` 9 例。
- **leaf 写面护栏统一（P1-05）**：`src/guards.js` 新增 `LEAF_WRITE_MATRIX` + `assertLeafWriter(caller, leaf, kind)`，并接入 `set-context` / `set-verification` / 非 done `event` / `dispatch:cancel` / `status` / `set-session` 六类写操作；非授权统一 `E_BORROWED_IDENTITY`（未知 kind fail-closed；缺失 caller 不再放行）。矩阵：context=owner/root、verification=creator/root、event(done)=owner only、event(其它)=owner/creator、cancel=owner/creator/root、status=owner/creator/root、set-session=creator only。`tests/write-guards.test.js` 8 例负例/回归；`index.js` 同步补 `tree_verify` 落账的真实 caller 接线。
- **口径刷新（文档与项目地图）**：根 `README.md`、`agent.md`、`docs/guides/skills-usage.md`、本 CHANGELOG 与 `docs/project-map-2026-11-11.html` 统一到 **tree-engine v0.6.0 / 9 个 `tree_*` 工具 / 84-84 测试**；HTML 的工具面图新增 `tree_doctor` 卡片、写面护栏由「缺口」改为「已实现」、§9 把 doctor 与护栏标记为 **Wave 1 已完成**，并保持单文件离线（0 `<script>` / 0 `<link>` / 无 http 资源）。

### 验证

- `packages/dsh-tree-engine`：`node --test tests/*.test.js` → **84/84**（62 引擎 + 4 技能打包 + 1 B1 回归 + 9 `tree_doctor` + 8 写面护栏）。
- `packages/dsh-session-tree`：handoff **41/41**、skills **3/3**、render 全绿（133/133 + 9/9 + 11/11）、style-guard **22/22**、verify-bundle **0 fail**。
- 文档表格门禁：`node scripts/check-md-tables.mjs README.md agent.md CHANGELOG.md docs/guides/skills-usage.md docs/operations/handoff-2026-11-11.md docs/project-map-2026-11-11.html` → Tables OK。
- 版本与测试数字为 2026-11-11 工作树实测；本次改动**未提交 git**。

## [1.3.5] — 2026-11-11 · 第三轮洁净室收尾（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.4` → **`1.3.5`**（公开插件仓同步发布；代码无行为变化）。
- `session-handoff` SKILL §0 补充例外说明：低于 50% 会被阈值闸拒，**但 `spawn:false` 干跑不被拦**（5 分钟内重复仍受防重复闸）。
- README（英文）修正 root→grandchild 表述：拒绝原因是「调用者不是目标的直接父会话」，不再写成「D 不是那个父会话自己的孩子」。

### 验证

- handoff **41/41**、skills **3/3**；其余测试无改动。
- 洁净室第三轮：**PASS**（N1–N7 全部确认修复、G1–G12 无回归、5 分钟路径 5/5），见 [docs/reports/skill-cleanroom-2026-11-11.md](docs/reports/skill-cleanroom-2026-11-11.md)。

## [1.3.4] — 2026-11-11 · 洁净室最终文档清扫（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.3` → **`1.3.4`**（公开插件仓同步发布；代码无行为变化，内容 = README/SKILL 文案与语言验收表述修正）。
- **R1-B / R2-B 文档债清扫**：
  - README（中英）语言验收表述修正：`status`/`handoff` 的 `lang=` 与 `interface_language` 可直接断言；独立 `verify-kickoff-language.mjs` 会**解码接替会话首条消息**（此前误写为「无需解码」）。
  - `session-handoff` SKILL：`set-session` 重绑主体改为「leaf 的 creator/上级（通常是父 commander）」——交接者无权重绑自己的 leaf。
  - `docs/guides/skills-usage.md`：新增 profile 修改备份警示；`tree_plan` 样例补 `session_id` 并对齐 `root_dod` 字段；worker 验收改为「commander 跑 verify」；竹节等待原因改为「链满 frozen / 简报回收失败 / 已非 running owner」；补版本差异速查（1.3.0→1.3.3）；`collect-skills.mjs` 自检命令补 `--expect`；patch YAML 改为真实行并注明「无需手抄」。
  - `tree-commander` / `tree-worker` SKILL：补英文触发词；版本头 `v0.5.1`；旧 `sweep:degraded:no-timer` 日志串改为中性描述。
  - 根 README / `docs/operations/handoff-2026-11-11.md` / `docs/guides/publishing.md` / `docs/architecture/session-handoff-2026-11-11.md` / `agent.md`：版本矩阵清扫到 v1.3.4/cce2975 链、测试入口 6 个、历史 `v1.0.4`/`3 份 cjs` 残留修正。
- `packages/dsh-tree-engine` 仍为 **0.5.1**（SKILL 勘误，含英文触发词；代码无变化）。

### 验证

- handoff **41/41**、skills **3/3**、render/style-guard/verify-bundle 全绿；tree-engine **67/67**。
- 洁净室第三轮独立复核见 [docs/reports/skill-cleanroom-2026-11-11.md](docs/reports/skill-cleanroom-2026-11-11.md)。

## [1.3.3] — 2026-11-11 · `spawn:false` 干跑不被阈值闸拦 + 洁净室二轮修订（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.2` → **`1.3.3`**（公开插件仓同步发布）。
- **行为修正**：`session_handoff {action:"handoff", spawn:false}` 现在**不受 below-threshold 阈值闸拦截**——它是只写交接文件的干跑，低于 50% 也应能产出预览 recap；防重复闸（5 分钟）仍生效。此前阈值闸先于 `spawn:false` 分支，导致新会话按文档单发 `spawn:false` 会被误拒（洁净室二轮 N1，中等严重度）。`force:true` 语义不变（既绕阈值闸，也会真正启动接替会话）。
- 测试：handoff 由 40 → **41** 用例（新增「spawn=false 在阈值以下也能只写文件」）。
- **洁净室二轮其余修订**（N2–N7）：README 中英例题改为中性路径（不再出现 monorepo `packages/`/`docs/`）、去掉与「无插件市场」自相矛盾的 marketplace 问题；SKILL 的 status/handoff 渲染样例补 `lang=zh` 段、去掉过期测试数字；`package.json.files` 补 `README.zh.md`（npm 分发时中文版不丢失）；tree_send 示例路径中性化。

### 验证

- `test/handoff.test.js` **41/41**；skills 3/3、render/style-guard/verify-bundle 全绿。
- 洁净室二轮（v1.3.2 基线）：公开插件仓 12/12 项修复 ✅、无新增死链；本版修掉其 N1–N7 后进入第三轮独立复核。

## [1.3.2] — 2026-11-11 · Skill 使用文档补全（session-tree，洁净室评审修订）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.1` → **`1.3.2`**（公开插件仓同步发布；代码无行为变化，内容 = README/SKILL 文档与打包回归）；`packages/dsh-tree-engine` **0.5.0 → 0.5.1**（SKILL 勘误，代码无变化，未单独发布）。
- **洁净室第二轮前修订（tree-engine SKILL 勘误，v0.5.1）**：`tree-commander` §3.1 与 `tree-worker` §1/§4.3 的竹节 owner 说法统一为「v0.5.0 起自动重绑给接手会话」（与实现及 §1.3/§3.3 一致）；交接样例路径通用化（不再引用 monorepo 内部路径）；`session-handoff` SKILL 的跨包引用标注归属。
- **根 README / handoff 文档勘误**：`已知边界` 的 sweep 降级说法改为「进程内 60s 兜底、sweepMode=timer」；`docs/operations/handoff-2026-11-11.md` 的版本/测试数/热更口径刷新到 v1.3.2 + 67/67，补第四/五轮摘要；`docs/guides/skills-usage.md` 补 tree-engine 可复制安装命令（clone + hmr.root + link + pnpm + reload）。
- **公开插件仓 README（中英）补全「使用随包 Skill」要素**（洁净室第一轮评审缺口 G1–G12）：
  - 新增 handoff **调用样例 + 参数表**（`summary` 必填；`next_steps` / `files` / `open_questions` / `note` / `kind` / `spawn` / `threshold_pct` / `force`）与一行预期返回；
  - 新增**冒烟测试**说明（新会话 `below-threshold`、`force` / `spawn:false`、5 分钟 `recent-handoff` 都是预期而非故障）；
  - 明确 `@deepseek-ai/dsh-skill-filesystem` **随桌面版内置**、Skill 目录在**会话启动时注入**（需新开会话）；
  - 从 <1.2.0 升级：先停用独立 `@local/dsh-session-handoff` bundle，避免同名工具/Skill 遮蔽；
  - 指向源码仓的脚本改为**绝对链接**（`collect-skills.mjs`、`verify-kickoff-language.mjs`、`docs/guides/skills-usage.md`），不再声称脚本在本插件仓内；
  - 顶部加版本与特性时间线（v1.3.0 Skill / v1.3.1 语言 / v1.3.2 文档）；功能表 `lang=zh\|en` 管道转义修复；SKILL.md 改为直链；Dev 文件树补 `test/skills.test.cjs`；疑难排查补充「Skill 在目录但不用它」「升级后行为仍旧」两条。
- **`session-handoff` SKILL.md**：frontmatter 补英文触发词（continue / running out of context / hand off to a fresh session / around 50 percent / handoff）；§3 样例路径改为通用示例（不再引用 monorepo 内部路径）；§8 注明 `tree-commander` / `tree-worker` 由 `@local/dsh-tree-engine` 提供、不在本包。
- **`docs/guides/skills-usage.md`**：适用版本升到 1.3.2；新增「§3.1 五分钟冒烟」；修正 `dsh-session-tree` 名称与升级建议。

### 验证

- `packages/dsh-session-tree/test/handoff.test.js` **40/40**、`test/skills.test.cjs` **3/3**、render/style-guard/verify-bundle 全绿（文档变更后复跑）。
- 洁净室评审：两个独立子会话（无本会话上下文）分别评审公开插件仓与本仓文档；本版按第一轮缺口修订，第二轮由**新的**独立子会话复核（结果见发布记录与 `docs/reports/skill-cleanroom-2026-11-11.md`）。

## [1.3.1] — 2026-11-11 · 交接提示语跟随 DSH 界面语言（session-tree）

### 新增

- **接替提示语本地化**：`session-handoff` 生成的接替会话首条消息不再固定英文，改为读取 DSH 界面语言（Settings → General → Language，即 profile 中 `locale` 条目的 `locale.preference`）。
  - 来源优先级：① 活体 Loader 的 `locale` 条目（`options.config.preference`；volatile 引用经 `get()` 展开；按包名 `@deepseek-ai/dsh-client-locale` 兜底查嵌套条目）→ ② profile `cordis.patch.yml` / `cordis.yml`（`DSH_PROFILE_DIR` 优先，否则用宿主进程 cwd——实测宿主 cwd 即 profile 目录）→ ③ 英文回退。
  - 语言归一化：`zh*` → 中文提示语；`en*` → 英文；其它已存语言与无偏好 → 英文（与 DSH 自身 fallback 一致）。
- `status` / `handoff` 返回对象新增 `interface_language`，渲染行尾新增 `lang=zh|en`；交接文件 `## Successor instructions` 块与提示语同语言（正文其余章节保持英文规范格式）。
- 新增验收脚本 `scripts/e2e/verify-kickoff-language.mjs`：解码接替会话日志首条 `user/message`，判定语种并断言（`--expect zh|en`）。
- 新增真机证据报告 [docs/reports/e2e-kickoff-language-2026-11-11.md](docs/reports/e2e-kickoff-language-2026-11-11.md)（修复前 `lang=en` 基线 → 修复后 `lang=zh` + 接替首条中文 PASS）。
- 新增用户向完整指南 [docs/guides/skills-usage.md](docs/guides/skills-usage.md)：三个随包 Skill 的安装、发现、最小提示词、三层任务树、50% 交接、语言与排障。

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.0` → **`1.3.1`**（公开插件仓同步发布）。
- 测试：`packages/dsh-session-tree/test/handoff.test.js` 由 34 → **40** 用例（新增：Loader 偏好 zh-CN、volatile 引用、ja 回退、无偏好英文、`DSH_PROFILE_DIR` profile 文件、`process.cwd()` profile 文件）；测试在模块加载时清除并恢复 `DSH_PROFILE_DIR`，避免开发者本机 profile 污染「无偏好」用例。
- 文档：两包 README 增补「接替提示语语言」与随包 Skill 使用步骤；`skills/session-handoff/SKILL.md` 增补首条消息语言说明与验收口径；`docs/architecture/session-handoff-2026-11-11.md` §5.1 增补 `interface_language`/语言解析说明。

### 验证（真机）

- 修复前（旧实现，2026-11-11 17:36）：验证子会话 `9cb372fb…` 的 status/handoff 渲染行均 `lang=en`；接替 `f5aa22f7…` 首条消息英文 → `verify-kickoff-language --expect zh` **FAIL**（基线）。
- 修复后（17:38 起）：同一流程 status/handoff 均 `lang=zh`；接替 `ca7e834f…` 首条消息中文（含交接文件绝对路径）→ `verify-kickoff-language --expect zh` **PASS**；交接文件 `## Successor instructions` 为合法 UTF-8 中文。
- 离线：handoff **40/40**；真机独立复核（由接替会话 `f5aa22f7…` 自行读取日志复算）确认两轮结论与上述一致。

### 已知边界

- 仅提供 `zh` / `en` 两套提示语文案；DSH 内置的 ja/es/fr/de/ru/pt 已存语言回退英文。
- 中文提示语之后仍可能跟一段英文的框架后缀（`Your parent agent id is …`，由 `@deepseek-ai/dsh-subagent` 的 continuable 子会话装饰生成，非本插件内容）；语种判定按正文，不影响「首条提示跟随界面语言」。
- HMR 重载瞬间可能出现一次 `unknown tool session_handoff`（注册空窗），重试即恢复；非本版本回归。

## [Unreleased] — 2026-11-11 · SKILL 工程化（session-tree 1.3.0 / tree-engine 0.5.0）

### 新增

- 包内 SKILL 单源：`packages/dsh-session-tree/skills/session-handoff/SKILL.md`（15495 B）、`packages/dsh-tree-engine/skills/tree-commander/SKILL.md`（22040 B）、`packages/dsh-tree-engine/skills/tree-worker/SKILL.md`（13449 B），三份技能文档随所属包发布，不再从仓库根加载。
- 两包 `cordis.patch.yml` 各新增一条 `@deepseek-ai/dsh-skill-filesystem` 装配：`providerName` 分别为 `session-tree` / `tree-engine`，`includeDefaultRoots: false`、`watch: false`，`bundledSkillDir` 指向包内 skills 目录，使技能随插件活体加载、进入会话可用技能目录。
- `packages/dsh-tree-engine/package.json` 新增 `files` 清单（含 skills；该字段在本轮改动前的 HEAD（`0cbc31e`）中不存在）；`packages/dsh-session-tree/package.json` 的 `files` 数组新增 skills 项，两包均确保技能目录进入发布物。
- 新增技能打包回归测试：`packages/dsh-tree-engine/tests/skills.test.js`（4 用例：两份 SKILL frontmatter 合法、仓根旧副本已消失、bundle patch 挂载 filesystem provider）、`packages/dsh-session-tree/test/skills.test.cjs`（3 用例：SKILL frontmatter 合法、`files` 含 skills、bundle patch 挂载 provider）。
- 技能 E2E 工具链 `scripts/skill-e2e/`：`collect-skills.mjs`（判定技能是否出现在会话目录）、`dump-events.mjs`、`summarize-run.mjs`、`lib.mjs`、`_probe.mjs`；`scripts/skill-e2e/artifacts/` 存基线、A/B/C 分组 progress 与 skills-at-spawn/postfix 对照快照。

### 变更

- 版本：`packages/dsh-tree-engine` 由 `0.4.0` → `0.5.0`，`packages/dsh-session-tree` 由 `1.2.0` → `1.3.0`；两包 `description` 改述为「随包提供 SKILL」。
- 竹节接力结算语义（审计 B1）：`packages/dsh-tree-engine/src/engine.js` 在接力启动接手会话后写入 `leaf.session_id = session.sessionId`，done 所有权随会话迁移，修复接力会话写 `done` 被 `E_BORROWED_IDENTITY` 拒、leaf 只能等超时的问题。
- `packages/dsh-tree-engine/index.js` 工具描述与实现对齐：`tree_plan` 限定仅未被派发的顶层会话可 `create`；`tree_node` 说明 `done` 由 done 事件加 `tree_verify` 结算、`path` 段须大写；`tree_dispatch` 注明 `dod` 不进子会话提示词、`assignee.preset` 不生效；`tree_report` 标注宿主 tokenMeter 已接线（与自报水位先到先判）与 12 类事件闭集；`tree_verify` 的 `cwd` 改由调用方或显式参数指定。
- sweep 语义：无宿主 timer 服务时由 `systemClock()` 进程内 60 s 间隔兜底（`sweepMode` 恒为 `timer`），`tree_status {action:"harvest"}` 仍可立即收割；`apply.log` 启动标记更新为 `v0.5.0`。

### 移除

- 仓库根的两份技能副本（tree-commander、tree-worker）移除：技能文档单源迁入所属包，避免仓根与包内副本漂移（相对 `0cbc31e` 为删除，本轮提交中移除）。
- 移除 `sweep:degraded:no-timer` 降级路径及 `tree_status` 旧描述中「降级模式依赖显式 harvest」「显式收割是唯一手段」的说法。
- `tree_verify` 不再声称「verify 通过」是 `succeeded` 的前置条件：`FAIL` 只回 `result.pass=false`，不抛错也不阻断运行时状态，需由 commander 读取判定。

### 测试与工具

- `packages/dsh-tree-engine`：`node --test tests/*.test.js` → **67/67 通过**（63 个引擎用例 + 4 个技能用例）；`node --test tests/skills.test.js` 单独 4/4。
- `packages/dsh-session-tree`：`node test/skills.test.cjs` → **3/3**；`node test/handoff.test.js` → **34/34**。
- `packages/dsh-tree-engine/tests/orchestrator.test.js` 新增竹节接力 owner 重绑的 B1 回归用例：接力后由接手会话上报 `done` 可正常结算。
- 上述命令在 `node v24.20.0` 下实测，退出码均为 0；`scripts/skill-e2e/` 采集脚本对真机会话日志做 zstd 多帧解压、按 `type+seq` 去重后比对技能目录。

### 文档

- 新增 `docs/reports/audit-tree-system-2026-11-11.md`（56431 B）：tree 体系一致性审计（代码 ↔ SKILL ↔ 文档），基线 `HEAD=0cbc31e`，结论为 BLOCK 4 / 需修 12 / 建议 15；其中 B1（接力后 owner 不迁移）、B3（sweep 说法与代码相反）、B4（被派发的 commander 不应再 `tree_plan`）已在本轮修复，其余条目状态见报告。
- 新增 `docs/reports/skill-e2e-2026-11-11.md`（35712 B）：极简提示词驱动下的分层执行与 50% 交接 E2E，含 §1.6 总览、§4 A/B/C 双轮（修正前/后）、§5 限制、§6 结论、§7 证据索引与复现命令。
- 同步更新 `README.md`、`agent.md`、`docs/guides/publishing.md`、`docs/architecture/tools-mapping.md`、`docs/operations/handoff-2026-11-11.md`、`docs/architecture/session-handoff-2026-11-11.md` 及两包 `README.md`（含 `packages/dsh-session-tree/README.zh.md`），补充技能装配、继承语义与工具映射。

### 验证（本轮收口）

- **Skill 活体链路**：新会话 `<available_skills>` 可见 `session-handoff` / `tree-commander` / `tree-worker`（3/3）；基线（重载前）为 0/3（`docs/reports/skill-e2e-2026-11-11.md` §3）。
- **A 组（三层分解）**：提示词「把『增补一段 CHANGELOG』拆成三层并派人做完，验证通过再收口」→ 建 `chglog` 树，root→commander→worker 三层；中间层会话自行 `tree_node add` 并派发 6 个 worker（B4 修复生效），全部 `tree_verify PASS`；**全树收口 PASS**（7 个非 root 节点 runtime 全 succeeded、verification 全 true，`tree_status {action:"validate"}` 0 issues，root done 已登记）；期间出现真实 **FAIL→PASS** 闭环（独立验收首轮因 HEAD 断言在提交后失真判 FAIL，修复后 reverify PASS）；中间层 attempt1 超时后由 attempt2 续跑收口（B1 相关路径真机可用）；真实产出 `CHANGELOG.md`。
- **B 组（继续干活 + 交接）**：`session_handoff status` 两次正确判读（7.2%/9.8% < 50% → 继续）；`force:true`（模拟阈值）触发 sibling 接替 `bea2eff2…`，`verify-handoff` **12/12 PASS**（同工作区/预设/权限/模型/工具数/首轮读 HANDOFF）。
- **C 组（三层干活 + 中间层交接）**：tree 解释（`c3demo`，10/10 checks，三层产物 `demo/c3layer/`）与会话链解释（三层真实计算 21→42→43）分别 PASS；两例中间层交接 successor `d703b780…` / `ac7c53bf…`，`verify-handoff` 均 **12/12 PASS**。
- **未达成/限制**（如实披露）：真实 50% 阈值未跑到——三次交接均为 `force:true` 模拟（上下文实际 6–10%）；提示词 C 存在「会话链 vs tree 任务树」层级歧义；B/C 子会话读到共享工作区 E2E 文档存在观察者偏差；A-修正前/C-修正前曾被宿主 429 配额中断（环境原因）。详见 `docs/reports/skill-e2e-2026-11-11.md` §5。

### 版本与发布说明

- 本轮涉及包版本：`@local/dsh-tree-engine` 0.5.0、`@orphiczhou/dsh-session-tree` 1.3.0、`@local/dsh-agent-introspect` 0.1.0（未改动）；另一独立插件（非本项目组件，已于 2026-11-11 移除）本轮同样未改动。
- 本轮变更已提交到本仓 `master`（提交哈希见 `git log`；上一版 HEAD 为 `0cbc31e`，对应 tree-engine 0.4.0 / session-tree 1.2.0）。提交后发布公开插件仓 v1.3.0。
- npm 维持冻结（决策 D3）：`@orphiczhou/*` 候选包名在 registry 均为 404，本轮没有 npm 发布，安装仍走 Git / `link:`。
- GitHub 插件镜像仓 `orphiczhou/dsh-session-tree` 已发布 **v1.3.0**（tag `v1.3.0` = `1086e9e`，远端 `main` 为同一 commit，release-plugin 18/18 SHA；2026-11-11 以 `git ls-remote` 核对）；上一版 **v1.2.0**（`597ca31`）为历史记录。
