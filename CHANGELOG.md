# Changelog

本文件记录本仓各包的重要变更：未发布变更归入 `Unreleased`，版本号取自各包 `package.json`，日期为北京时间。

## [1.3.2] — 2026-11-11 · Skill 使用文档补全（session-tree，洁净室评审修订）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.1` → **`1.3.2`**（公开插件仓同步发布；代码无行为变化，内容 = README/SKILL 文档与打包回归）；`packages/dsh-tree-engine` **0.5.0 → 0.5.1**（SKILL 勘误，代码无变化，未单独发布）。
- **洁净室第二轮前修订（tree-engine SKILL 勘误，v0.5.1）**：`tree-commander` §3.1 与 `tree-worker` §1/§4.3 的竹节 owner 说法统一为「v0.5.0 起自动重绑给接手会话」（与实现及 §1.3/§3.3 一致）；交接样例路径通用化（不再引用 monorepo 内部路径）；`session-handoff` SKILL 的跨包引用标注归属。
- **根 README / handoff 文档勘误**：`已知边界` 的 sweep 降级说法改为「进程内 60s 兜底、sweepMode=timer」；`docs/handoff-2026-11-11.md` 的版本/测试数/热更口径刷新到 v1.3.2 + 67/67，补第四/五轮摘要；`docs/skills-usage.md` 补 tree-engine 可复制安装命令（clone + hmr.root + link + pnpm + reload）。
- **公开插件仓 README（中英）补全「使用随包 Skill」要素**（洁净室第一轮评审缺口 G1–G12）：
  - 新增 handoff **调用样例 + 参数表**（`summary` 必填；`next_steps` / `files` / `open_questions` / `note` / `kind` / `spawn` / `threshold_pct` / `force`）与一行预期返回；
  - 新增**冒烟测试**说明（新会话 `below-threshold`、`force` / `spawn:false`、5 分钟 `recent-handoff` 都是预期而非故障）；
  - 明确 `@deepseek-ai/dsh-skill-filesystem` **随桌面版内置**、Skill 目录在**会话启动时注入**（需新开会话）；
  - 从 <1.2.0 升级：先停用独立 `@local/dsh-session-handoff` bundle，避免同名工具/Skill 遮蔽；
  - 指向源码仓的脚本改为**绝对链接**（`collect-skills.mjs`、`verify-kickoff-language.mjs`、`docs/skills-usage.md`），不再声称脚本在本插件仓内；
  - 顶部加版本与特性时间线（v1.3.0 Skill / v1.3.1 语言 / v1.3.2 文档）；功能表 `lang=zh\|en` 管道转义修复；SKILL.md 改为直链；Dev 文件树补 `test/skills.test.cjs`；疑难排查补充「Skill 在目录但不用它」「升级后行为仍旧」两条。
- **`session-handoff` SKILL.md**：frontmatter 补英文触发词（continue / running out of context / hand off to a fresh session / around 50 percent / handoff）；§3 样例路径改为通用示例（不再引用 monorepo 内部路径）；§8 注明 `tree-commander` / `tree-worker` 由 `@local/dsh-tree-engine` 提供、不在本包。
- **`docs/skills-usage.md`**：适用版本升到 1.3.2；新增「§3.1 五分钟冒烟」；修正 `dsh-session-tree` 名称与升级建议。

### 验证

- `packages/dsh-session-tree/test/handoff.test.js` **40/40**、`test/skills.test.cjs` **3/3**、render/style-guard/verify-bundle 全绿（文档变更后复跑）。
- 洁净室评审：两个独立子会话（无本会话上下文）分别评审公开插件仓与本仓文档；本版按第一轮缺口修订，第二轮由**新的**独立子会话复核（结果见发布记录与 `docs/skill-cleanroom-2026-11-11.md`）。

## [1.3.1] — 2026-11-11 · 交接提示语跟随 DSH 界面语言（session-tree）

### 新增

- **接替提示语本地化**：`session-handoff` 生成的接替会话首条消息不再固定英文，改为读取 DSH 界面语言（Settings → General → Language，即 profile 中 `locale` 条目的 `locale.preference`）。
  - 来源优先级：① 活体 Loader 的 `locale` 条目（`options.config.preference`；volatile 引用经 `get()` 展开；按包名 `@deepseek-ai/dsh-client-locale` 兜底查嵌套条目）→ ② profile `cordis.patch.yml` / `cordis.yml`（`DSH_PROFILE_DIR` 优先，否则用宿主进程 cwd——实测宿主 cwd 即 profile 目录）→ ③ 英文回退。
  - 语言归一化：`zh*` → 中文提示语；`en*` → 英文；其它已存语言与无偏好 → 英文（与 DSH 自身 fallback 一致）。
- `status` / `handoff` 返回对象新增 `interface_language`，渲染行尾新增 `lang=zh|en`；交接文件 `## Successor instructions` 块与提示语同语言（正文其余章节保持英文规范格式）。
- 新增验收脚本 `scripts/e2e/verify-kickoff-language.mjs`：解码接替会话日志首条 `user/message`，判定语种并断言（`--expect zh|en`）。
- 新增真机证据报告 [docs/e2e-kickoff-language-2026-11-11.md](docs/e2e-kickoff-language-2026-11-11.md)（修复前 `lang=en` 基线 → 修复后 `lang=zh` + 接替首条中文 PASS）。
- 新增用户向完整指南 [docs/skills-usage.md](docs/skills-usage.md)：三个随包 Skill 的安装、发现、最小提示词、三层任务树、50% 交接、语言与排障。

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.0` → **`1.3.1`**（公开插件仓同步发布）。
- 测试：`packages/dsh-session-tree/test/handoff.test.js` 由 34 → **40** 用例（新增：Loader 偏好 zh-CN、volatile 引用、ja 回退、无偏好英文、`DSH_PROFILE_DIR` profile 文件、`process.cwd()` profile 文件）；测试在模块加载时清除并恢复 `DSH_PROFILE_DIR`，避免开发者本机 profile 污染「无偏好」用例。
- 文档：两包 README 增补「接替提示语语言」与随包 Skill 使用步骤；`skills/session-handoff/SKILL.md` 增补首条消息语言说明与验收口径；`docs/session-handoff-2026-11-11.md` §5.1 增补 `interface_language`/语言解析说明。

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

- 新增 `docs/audit-tree-system-2026-11-11.md`（56431 B）：tree 体系一致性审计（代码 ↔ SKILL ↔ 文档），基线 `HEAD=0cbc31e`，结论为 BLOCK 4 / 需修 12 / 建议 15；其中 B1（接力后 owner 不迁移）、B3（sweep 说法与代码相反）、B4（被派发的 commander 不应再 `tree_plan`）已在本轮修复，其余条目状态见报告。
- 新增 `docs/skill-e2e-2026-11-11.md`（35712 B）：极简提示词驱动下的分层执行与 50% 交接 E2E，含 §1.6 总览、§4 A/B/C 双轮（修正前/后）、§5 限制、§6 结论、§7 证据索引与复现命令。
- 同步更新 `README.md`、`agent.md`、`docs/publishing.md`、`docs/tools-mapping.md`、`docs/handoff-2026-11-11.md`、`docs/session-handoff-2026-11-11.md` 及两包 `README.md`（含 `packages/dsh-session-tree/README.zh.md`），补充技能装配、继承语义与工具映射。

### 验证（本轮收口）

- **Skill 活体链路**：新会话 `<available_skills>` 可见 `session-handoff` / `tree-commander` / `tree-worker`（3/3）；基线（重载前）为 0/3（`docs/skill-e2e-2026-11-11.md` §3）。
- **A 组（三层分解）**：提示词「把『增补一段 CHANGELOG』拆成三层并派人做完，验证通过再收口」→ 建 `chglog` 树，root→commander→worker 三层；中间层会话自行 `tree_node add` 并派发 6 个 worker（B4 修复生效），全部 `tree_verify PASS`；**全树收口 PASS**（7 个非 root 节点 runtime 全 succeeded、verification 全 true，`tree_status {action:"validate"}` 0 issues，root done 已登记）；期间出现真实 **FAIL→PASS** 闭环（独立验收首轮因 HEAD 断言在提交后失真判 FAIL，修复后 reverify PASS）；中间层 attempt1 超时后由 attempt2 续跑收口（B1 相关路径真机可用）；真实产出 `CHANGELOG.md`。
- **B 组（继续干活 + 交接）**：`session_handoff status` 两次正确判读（7.2%/9.8% < 50% → 继续）；`force:true`（模拟阈值）触发 sibling 接替 `bea2eff2…`，`verify-handoff` **12/12 PASS**（同工作区/预设/权限/模型/工具数/首轮读 HANDOFF）。
- **C 组（三层干活 + 中间层交接）**：tree 解释（`c3demo`，10/10 checks，三层产物 `demo/c3layer/`）与会话链解释（三层真实计算 21→42→43）分别 PASS；两例中间层交接 successor `d703b780…` / `ac7c53bf…`，`verify-handoff` 均 **12/12 PASS**。
- **未达成/限制**（如实披露）：真实 50% 阈值未跑到——三次交接均为 `force:true` 模拟（上下文实际 6–10%）；提示词 C 存在「会话链 vs tree 任务树」层级歧义；B/C 子会话读到共享工作区 E2E 文档存在观察者偏差；A-修正前/C-修正前曾被宿主 429 配额中断（环境原因）。详见 `docs/skill-e2e-2026-11-11.md` §5。

### 版本与发布说明

- 当前四个包版本：`@local/dsh-tree-engine` 0.5.0、`@orphiczhou/dsh-session-tree` 1.3.0、`@local/dsh-meta-loop` 0.2.0、`@local/dsh-agent-introspect` 0.1.0；后两者本轮未改动。
- 本轮变更已提交到本仓 `master`（提交哈希见 `git log`；上一版 HEAD 为 `0cbc31e`，对应 tree-engine 0.4.0 / session-tree 1.2.0）。提交后发布公开插件仓 v1.3.0。
- npm 维持冻结（决策 D3）：`@orphiczhou/*` 候选包名在 registry 均为 404，本轮没有 npm 发布，安装仍走 Git / `link:`。
- GitHub 插件镜像仓 `orphiczhou/dsh-session-tree` 已发布 **v1.3.0**（tag `v1.3.0` = `1086e9e`，远端 `main` 为同一 commit，release-plugin 18/18 SHA；2026-11-11 以 `git ls-remote` 核对）；上一版 **v1.2.0**（`597ca31`）为历史记录。
