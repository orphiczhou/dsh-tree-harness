# C1a2 · 未提交变更事实：SKILL 工程化（skillwork）

> 采集范围：工作区 `D:\Codes\dsh-tree-harness` 的**未提交**改动（工作树 + 索引 vs `HEAD`），逐文件核对。
> 采集方式：`git status --short`、`git diff --stat`、`git diff`、对未跟踪文件直接读取（`git ls-files -o --untracked-files=all`），新测试**只读执行**取证。
> 快照时刻：**2026-11-11T15:33:35+08:00**（采集期间 `packages/dsh-tree-engine/skills/tree-commander/SKILL.md` 仍被并发编辑：15:25 时 18,445 B → 15:33 时 19,410 B；本文件数字以该快照为准，并附 SHA256 前 12 位）。
> 隐私：未读取、未引用 D7 排除清单中的 `demo/screen-2026-10-13.png` 与 `demo/agspec/_sub-agent-index.js`、`_tool-subagent.js`、`_tool-subagent.md`、`_driver.js`、`_fork.js`、`_spawn.js`。

## 0. Unreleased 判定（依据）

- `git status --short` 显示 11 个已跟踪文件为 ` M`、2 个为 ` D`，另有 4 组未跟踪目录/文件（`?? docs/reports/skill-e2e-2026-11-11.md`、`?? packages/*/skills/`、`?? packages/*/tests|test/skills.test.*`、`?? scripts/skill-e2e/`）。
- `git log -1` 最新提交为 `0cbc31e docs: v1.2.0 合并/继承修复与真机 E2E 记录（agent.md/publishing/spec/handoff/session-handoff/README + e2e 断言器与 artifacts）`，其 `--stat` 只含 13 个 docs/e2e 文件，**不含**本文件列出的任何一个 skill 相关路径（最接近的 `scripts/e2e/*` 与 `scripts/skill-e2e/*` 是不同目录）。
- 因此本节全部条目均属**尚未提交（Unreleased）**，尚无版本 tag/CHANGELOG 条目。
- `git diff --stat` 汇总（已跟踪面）：**13 files changed, 121 insertions(+), 173 deletions(-)**。

## Added（未跟踪的新增文件）

- `packages/dsh-tree-engine/skills/tree-commander/SKILL.md` — 新建 260 行 / 19,410 B（sha256 ED50F680DA60），frontmatter 含 `name: tree-commander` + `description` + `whenToUse`（`git diff` 未见，属 `??`）；标题自述「DSH 版 v2.0，随 tree-engine v0.5.0 分发」。
- `packages/dsh-tree-engine/skills/tree-worker/SKILL.md` — 新建 154 行 / 11,884 B（sha256 56117257C5EA），`whenToUse` 明确写「上下文接近 50% 时自主 session_handoff 同层接替」；正文 6 处 `session_handoff`、5 处 `竹节`、1 处 `context_pct`。
- `packages/dsh-session-tree/skills/session-handoff/SKILL.md` — 新建 214 行 / 15,007 B（sha256 3C0FBD369E71），10 个一级/二级小节（§0 三条硬规则 → §3 参数规范 → §4 root/sibling 矩阵 → §5 继承验收 → §6 降级处理 → §9 自检清单）；正文 7 处 `context_pct`、5 处 `50%`。
- `packages/dsh-tree-engine/tests/skills.test.js` — 新建 63 行（sha256 223731805329）的 `node:test` 打包回归：断言两份 SKILL.md frontmatter/工具名/`session_handoff`+`50`、**仓根旧副本已不存在**（`existsSync(...)===false`）、patch 行含 `@deepseek-ai/dsh-skill-filesystem` / `providerName: tree-engine` / `includeDefaultRoots: false` / `bundledSkillDir`。
- `packages/dsh-session-tree/test/skills.test.cjs` — 新建 58 行（sha256 F349F3C77FA9）的 3 项断言：SKILL.md frontmatter 与 `session_handoff`/`context_pct`/`HANDOFF`/`50` 关键词、`package.json.files` 含 `"skills"`、patch 行 `providerName: session-tree` 且目录经 `@orphiczhou/dsh-session-tree/package.json` 身份解析。
- `scripts/skill-e2e/lib.mjs` — 新建 12,319 B 共享取证层：多帧 zstd 解码（扫魔数 `28 B5 2F FD` 逐帧解压、按 `type+seq` 去重）、`<available_skills>` 解析、`session_handoff` 返回解析；只读 `%USERPROFILE%\.dsh` 本地存储。
- `scripts/skill-e2e/collect-skills.mjs` — 新建 8,590 B：断言某会话 catalog 的 `atCreation` / `latest` / `evolution` / `skillLoads`。
- `scripts/skill-e2e/summarize-run.mjs` — 新建 27,000 B：汇总 `tree_*` 调用序列、`session_handoff` 返回、子会话发现与分层启发式判定。
- `scripts/skill-e2e/dump-events.mjs` — 新建 2,422 B 开发期探针（事件类型直方图）。
- `scripts/skill-e2e/_probe.mjs` — 新建 566 B 一次性探针，硬编码会话 `8ca5308b-…` 打印各 `user/message` 的 catalog 命中。
- `scripts/skill-e2e/baseline-A-skills.json`、`scripts/skill-e2e/baseline-pre-reload-skills.json` — 新建基线快照（2,737 B / 9,098 B）。
- `scripts/skill-e2e/artifacts/` — 新建 **12** 份运行证据 JSON（合计 283,681 B；`scripts/skill-e2e/` 全目录 19 文件共 346,413 B），含 `baseline-skills-2026-11-11T0722Z.json`、`stage2-skills-at-spawn.json`、`A/B/C-progress-*.json`、`progress-*.json`、`verify-handoff-B.json`。

## Changed（已跟踪文件的修改，`git diff`）

- `README.md`（+5/−4）— 包表两行版本与测试数改写：`dsh-tree-engine` `0.4.0 → 0.5.0`、`62/62 → 66/66` 并加「随包 tree-commander/tree-worker Skill」；`dsh-session-tree` `1.2.0 → 1.3.0` 并加「随包 session-handoff Skill」；命令注释改为 `tests 66 / pass 66 / fail 0（62 引擎 + 4 技能打包）`，会话树测试说明 `4 份 → 5 份` 并新增 `node test/skills.test.cjs # 3/3`。
- `agent.md`（+30/−13）— 新增 **D13** 决策行（SKILL 工程化：技能随包发布 + `@deepseek-ai/dsh-skill-filesystem` patch 行）；新增 **R10** 任务行与「§4.1 第四轮团队与任务板（T4–T7）」；交接纪律由 5 条扩为 6 条，第 4 条新增「纪律适用于每一层会话……tree-engine 内部还有 pct≥42 竹节」；状态快照改为「第四轮：SKILL 工程化收口」（`dsh-tree-engine v0.5.0`、`session-tree v1.3.0`、tree-engine 66/66、session-tree skills 3/3）；发布门禁新增第 8 条「Skill provider 与 Skill 目录」；热更纪律（D12）扩展到 patch 行改动需 `include:tree-engine`/`include:session-tree` 各 disable→enable。
- `docs/guides/publishing.md`（+2/−2）— 发布前检查清单：tree-engine `62/62 → 66/66（62 引擎 + 4 技能打包）`；session-tree 测试清单插入 `node test/skills.test.cjs`（`3/3`，随包 Skill 打包回归）。
- `docs/operations/handoff-2026-11-11.md`（+6/−6）— 交接事实表与速查 API 中 tree-engine `v0.4.0 → v0.5.0`、测试 `62/62 → 66/66`；发布流程第 1 条改为「会话树包内测试（handoff 34/34 + skills 3/3）」；阻塞项「62 项测试覆盖」改为 66。
- `packages/dsh-tree-engine/package.json`（+2/−2）— `"version": "0.4.0"` → `"0.5.0"`；description 改为「… with bundled tree-commander/tree-worker Skills (8 tree_* tools + 50%-context session handoff discipline)」。**注意：本文件未新增 `files` 字段**（见「其他」）。
- `packages/dsh-tree-engine/cordis.patch.yml`（+17/−0）— 新增 17 行注释 + 第二条 insert：`id: tree-engine-skills`、`name: '@deepseek-ai/dsh-skill-filesystem'`、`providerName: tree-engine`、`includeDefaultRoots: false`、`watch: false`、`bundledSkillDir: !!js … createRequire(baseUrl).resolve('@local/dsh-tree-engine/package.json') … join(…,'skills')`。
- `packages/dsh-tree-engine/README.md`（+9/−1）— 顶部新增「v0.5.0 增量：SKILL 工程化」小节（技能迁入包内、patch 第 2 行装载、50% 交接纪律入 skill、66/66 测试、D12 热更告警）；旧「tree-worker SKILL 重写」条目路径更新为 `packages/dsh-tree-engine/skills/tree-worker/SKILL.md`。
- `packages/dsh-session-tree/package.json`（+3/−2）— `"version": "1.2.0"` → `"1.3.0"`；description 增加「a bundled session-handoff Skill so agents discover the handoff discipline from the Skill catalog」；`files` 数组插入 `"skills"`（位于 `"locale"` 与 `"README.md"` 之间）。
- `packages/dsh-session-tree/cordis.patch.yml`（+16/−3）— 文件头注释改写为「Row 1 = Host/Client 半；Row 2 = filesystem Skill provider」；新增 `id: session-tree-skills` insert（`providerName: session-tree`、`includeDefaultRoots: false`、`watch: false`、`bundledSkillDir` 经 `@orphiczhou/dsh-session-tree/package.json` 解析）。
- `packages/dsh-session-tree/README.md`（+15/−1）— 能力表新增 `Bundled Skill (session-handoff)` 行；安装验证段补「新会话 catalog 应列 session-handoff，provider 挂不上时工具照常、只是缺目录项」；新增「### Bundled Skill」小节（打包/版本同发/缺 provider 降级）；目录树加 `skills/session-handoff/SKILL.md`；测试段加 `node test/skills.test.cjs`。
- `packages/dsh-session-tree/README.zh.md`（+16/−2）— 与英文 README 同构的中文改动（能力表「随包 Skill（`session-handoff`）」、安装验证句、新增「### 随包技能（Bundled Skill）」、目录树、测试命令），另在「实现要点/兼容闸门」段补「patch 还插入 `@deepseek-ai/dsh-skill-filesystem`」一句。

## Removed（已跟踪文件的删除）

- `skills/tree-commander/SKILL.md` — 已删除（`git diff --numstat` 记 `0 68`）；`git show HEAD:skills/tree-commander/SKILL.md` 首行为 `# tree-commander SKILL(DSH 版 v1.0)`，文件为 68 行、无 YAML frontmatter。
- `skills/tree-worker/SKILL.md` — 已删除（`0 69`）；HEAD 版本首行为 `# tree-worker SKILL(DSH 版 v1.0)`，69 行、无 frontmatter。
- 语义：仓根 `skills/` 两副本被移除，单源迁入 `packages/dsh-tree-engine/skills/`（新文件 v2.0 + frontmatter + 50% 交接纪律）；该去重由 `packages/dsh-tree-engine/tests/skills.test.js` 的 `the legacy repo-root skills/ copies are gone` 用例锁定（实测通过）。

## Tests（新增测试与实测结果）

- `packages/dsh-tree-engine/tests/skills.test.js` — 新建 4 个用例；实测 `node --test tests/skills.test.js` → `tests 4 / pass 4 / fail 0`（用例名：两 skill frontmatter、仓根旧副本已消失、patch 挂 provider）。→ 与 README「66/66 = 62 引擎 + 4 技能打包」的 +4 对得上。
- `packages/dsh-session-tree/test/skills.test.cjs` — 新建 3 个用例；实测 `node test/skills.test.cjs` → `tests 3 / pass 3 / fail 0`（frontmatter / `files` 含 `skills` / patch 行）。→ 与 README、publishing 中的「3/3」一致。
- 测试执行方式为只读（`node --test`/`node test` 不写仓库文件）；本次仅运行上述两个新增文件，**未**重跑全量 66/66 与 handoff 34/34。

## Docs（文档改动/新增）

- `docs/reports/skill-e2e-2026-11-11.md` — 新建 179 行 / 12,755 B（sha256 B163522BB794），标题「skill 工程化 · 极简提示词驱动的分层执行与 50% 交接 E2E（2026-11-11）」；含 §1 判定协议（catalog 可见性 / skill 被使用 / 三层分解 / 50% 交接）、§1.5 A/B/C 三组极简提示词原文、§2 脚本与复现命令、§3 基线（同一会话 4 次 catalog 注入：12 → 13 → 14 → 15 个 skill，即 0/3 → 3/3）、§4-A/C 结果表仍为「待填」、§4-B 已填（`session_handoff status` seq 56 `context=7.2%`、seq 105 `9.8%`，`force:true` 模拟交接 → successor `bea2eff2…`，`verify-handoff` 12/12 PASS）、§5/§6 标注「待定稿」。
- `README.md` / `agent.md` / `docs/guides/publishing.md` / `docs/operations/handoff-2026-11-11.md` — 见 Changed：均与本轮 v0.5.0 / v1.3.0、66/66、3/3、patch 行、D13/R10 对齐。
- `packages/dsh-tree-engine/README.md`、`packages/dsh-session-tree/README.md`、`packages/dsh-session-tree/README.zh.md` — 包级文档补齐「随包 Skill + provider patch 行 + 新测试」的用户可见说明。

## 其他（无法归入上面五组 / 需要下一环节注意）

- **并发写入**：采集窗口内工作树仍在变化——`docs/reports/audit-tree-system-2026-11-11.md`（56,435 B，mtime 15:33:07）与 `packages/dsh-tree-engine/skills/tree-commander/SKILL.md`（15:33:13 仍增长）在我首次 `git status` 之后才出现/变大；`logs/changelog-work/` 下另有其他 worker 的 10 个产物文件。这些**不是本 worker 的产出**，本文件只做快照记录。
- **未跟踪但不在本任务清单内**：`docs/reports/audit-tree-system-2026-11-11.md`（被 `agent.md` R10 行引用为「整体一致性审计」报告）与 `logs/changelog-work/**`（changelog 工作区中间产物）目前均为 `??`，未提交。
- **文档与实现的一处不一致（供校对）**：`agent.md` D13 称「`package.json.files` 纳入 `skills`，随包版本发布」，但 `packages/dsh-tree-engine/package.json` 的 diff 只有 version/description（该包 `private: true`、无 `files` 字段）；只有 `packages/dsh-session-tree/package.json` 真正新增了 `"skills"`。tree-engine 的 skill 目录靠 `bundledSkillDir` 解析到包内路径，不依赖 `files`。
- **另一处遗留版本号**：`docs/operations/handoff-2026-11-11.md` 的交接事实表中「会话树」行仍写 `v1.2.0`（本轮 diff 未改该行），同文件别处已按 v0.5.0/66 更新——属遗留不一致而非本轮新增。
- 本次采集**未**改动任何文件（除本产物）、未 git add/commit、未改 `package.json` 版本。
