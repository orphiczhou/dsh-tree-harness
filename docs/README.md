# 文档索引与归档规范（docs/README.md）

> 本目录是 `dsh-tree-harness`（DSH 会话树体系）的**全部开发文档**。本文件是文档的**单一索引**，并规定新增/迁移/归档规则。
> 改完文档必须跑：`node scripts/check-doc-links.mjs` 与 `node scripts/check-md-tables.mjs`。
> 当前快照：2026-11-12 · tree-engine **v0.6.0**（9 工具 / 84-84 测试）· session-tree **v1.3.6**（公开镜像 tag `v1.3.6` = `298298d`）。

## 0. 不同读者的入口

| 你是谁 | 先看什么 | 再看什么 |
|---|---|---|
| 第一次接触（人） | [项目全景地图](project-map-2026-11-11.html)（[在线版](https://orphiczhou.github.io/dsh-tree-harness/project-map-2026-11-11.html)） | [安装指南](guides/install-guide.md) → [Skill 使用指南](guides/skills-usage.md) |
| 第一次接触（Agent） | 公开镜像仓 [AGENT-INSTALL.md](https://github.com/orphiczhou/dsh-session-tree/blob/main/AGENT-INSTALL.md) | [Skill 使用指南](guides/skills-usage.md) → 对应 Skill 正文 |
| 接手开发 | [agent.md](../agent.md)（决策/路线/约定） | [当前交接](operations/handoff-2026-11-11.md) → [架构](#1-架构与规格architecture) |
| 要发版 | [发布流程](guides/publishing.md) | [当前交接 §发布](operations/handoff-2026-11-11.md) |
| 查历史结论 | [reports/](#3-一次性报告reports) | [archive/](#4-归档archive) |

## 1. 架构与规格（architecture/）

**现行、按主题维护，不带日期后缀；改动需同步 agent.md 决策日志。**

| 文档 | 内容 | 状态 |
|---|---|---|
| [engine-spec.md](architecture/engine-spec.md) | tree-engine 行为规约（S0 冻结版）：树语义、状态机、收敛判据 | 现行·权威 |
| [tools-mapping.md](architecture/tools-mapping.md) | 上游工具 → 复合工具映射表（S0 设计稿）；**实际注册以 `packages/dsh-tree-engine/index.js` 的 schema 为准** | 设计稿（部分未实现） |
| [segment-handoff.md](architecture/segment-handoff.md) | 竹节生长机制设计（pct≥42 同一 leaf 换会话、owner 重绑、链长 5） | 现行 |
| [features-2026-11-11-spec.md](architecture/features-2026-11-11-spec.md) | 功能规格：会话自交接（A 节）+ 会话树 UI 工作区归档/隐藏/检索（B 节） | 已实现（UI 部分持续迭代） |
| [session-handoff-2026-11-11.md](architecture/session-handoff-2026-11-11.md) | 会话自交接设计与交付记录（v0.1.0 → v1.2.0 并入 → v1.3.5） | 现行·详细 |
| [session-tree-ui.md](architecture/session-tree-ui.md) | **会话树 UI 设计与迭代规范**：client.js 代码地图、改哪里的速查、GUI 迭代 7 步流程、UI 变更记录 | 现行（GUI 迭代单一方案） |
| [merge-session-tree-2026-11-11.md](architecture/merge-session-tree-2026-11-11.md) | 双包 → 单包合并记录（方案 B⁺）、host/client 契约 | 历史性架构记录 |
| [s0-decisions.md](architecture/s0-decisions.md) | S0 规范冻结的裁决记录 | 历史性架构记录 |

## 2. 指南与运维（guides/ · operations/）

| 文档 | 内容 | 维护规则 |
|---|---|---|
| [guides/install-guide.md](guides/install-guide.md) | **人类安装指南**：三种安装路线（Git 镜像仓 / 本地 monorepo / 市场）、组件矩阵、验证、升级卸载 | 随安装方式变化更新 |
| [guides/skills-usage.md](guides/skills-usage.md) | 三个随包 Skill 完整使用指南（tree-commander / tree-worker / session-handoff）：发现、触发、参数、验收、42% vs 50%、升级、排障 | 随 Skill 改动更新 |
| [guides/publishing.md](guides/publishing.md) | 发布流程与规则：唯一源码事实源、镜像仓同步、`release-plugin.mjs`、版本纪律 D6、市场/npm 现状 | 每次发版追加记录 |
| [operations/handoff-2026-11-11.md](operations/handoff-2026-11-11.md) | **当前交接/运维手册**：架构、关键路径、测试与验活命令、发布现状、已知边界、下一轮议程 | 每轮收口刷新；旧版进 archive |
| [operations/wave2-plan-2026-11-12.md](operations/wave2-plan-2026-11-12.md) | **Wave 2 开发计划**：项目地图 §9 建议与波次 + Wave-1 剩余项 + 新发现（root id 兼容、GUI 规范），含 DoD/风险/执行方式 | 下一轮执行依据；随完成情况更新 |

## 3. 一次性报告（reports/）

**命名：`<类型>-<主题>-YYYY-MM-DD.md`；报告是当时证据，结论不随代码修改回写（新结论 -> 新报告）。**

| 文档 | 内容 |
|---|---|
| [audit-tree-system-2026-11-11.md](reports/audit-tree-system-2026-11-11.md) | tree 体系一致性审计（代码 → SKILL → 文档），含 B1–B4/P1 发现与修复 |
| [skill-e2e-2026-11-11.md](reports/skill-e2e-2026-11-11.md) | 极简提示词驱动的分层执行与 50% 交接 E2E（A/B/C 组） |
| [e2e-handoff-2026-11-11.md](reports/e2e-handoff-2026-11-11.md) | `session_handoff` 真机 E2E 取证（root/sibling、继承、工作区归属） |
| [e2e-kickoff-language-2026-11-11.md](reports/e2e-kickoff-language-2026-11-11.md) | 接替提示语跟随 DSH 界面语言：实现 + 真机 E2E（en 基线 → zh PASS） |
| [skill-cleanroom-2026-11-11.md](reports/skill-cleanroom-2026-11-11.md) | Skill 文档「洁净室」三轮独立评审与修订记录 |
| [verification-2026-11-11.md](reports/verification-2026-11-11.md) | 公开前独立验证报告（T3 / D2） |
| [bug-report-dsh-pnpm-exclude.md](reports/bug-report-dsh-pnpm-exclude.md) | DSH / pnpm `minimumReleaseAgeExclude` 锁文件校验路径 bug 报告 |
| [defect-2026-10-17-subagents-rc2-api-drift.md](reports/defect-2026-10-17-subagents-rc2-api-drift.md) | DSH 0.2.1-rc.2 `subagents` API 漂移导致真机派发即死的缺陷报告 |

## 4. 归档（archive/）

**冻结：不再维护、不再引用为"现行"；保留历史证据，只允许补一行"已归档，见 XXX"。**

| 文档 | 原用途 |
|---|---|
| [handoff-2026-10-04.md](archive/handoff-2026-10-04.md) · [handoff-2026-10-14.md](archive/handoff-2026-10-14.md) | 历史交接文件（已被 operations/handoff-2026-11-11.md 取代） |
| [progress-2026-10-04.md](archive/progress-2026-10-04.md) · [e2e-report-2026-10-04.md](archive/e2e-report-2026-10-04.md) · [e2e3l-audit-2026-10-04.md](archive/e2e3l-audit-2026-10-04.md) | 2026-10-04 的进度/E2E/审计快照 |
| [agspec-report.md](archive/agspec-report.md) · [flaudit-report.md](archive/flaudit-report.md) | 子会话可观测性（A/B）与引擎设计审计（历史） |
| [proposals-from-agent-notes.md](archive/proposals-from-agent-notes.md) | 2026-10-04 的候选提案 |
| [project-restart-brief-2026-11-11.html](archive/project-restart-brief-2026-11-11.html) | 项目重启简报（依赖矩阵/重启清单，已被新文档取代） |
| [frozen-parent-plan/](archive/frozen-parent-plan/) | 冻结的上游父计划（PLAN-v1.7 + 评审报告） |

## 5. 归档与命名规则（强制）

1. **目录职责**
   - `architecture/`：现行架构/规格/设计。**按主题命名，不带日期**；改内容 = 改文件，版本/日期写在文内。
   - `guides/`：面向人/Agent 的操作指南（安装、使用、发布）。
   - `operations/`：唯一「当前交接/运维手册」放这里；被刷新取代的旧版进 `archive/`。
   - `reports/`：**一次性证据**，命名 `<类型>-<主题>-YYYY-MM-DD.md`（类型：audit / e2e / verification / cleanroom / defect / bug / progress）。
   - `archive/`：冻结历史；新增内容只允许「已归档」标注；**不删除历史证据**（删除需在 CHANGELOG 说明）。
   - `docs/project-map-*.html`：保留在 `docs/` 根，保证 GitHub Pages / 外部链接 URL 稳定。
2. **新增文档必须**：① 放进对应目录；② 更新本索引 §1–§4；③ 更新根 `README.md` 的文档索引（如有面向用户）；④ 跑链接/表格检查。
3. **跨仓引用**：公开镜像仓（`orphiczhou/dsh-session-tree`）里引用本仓文档**必须用绝对 URL**（`https://github.com/orphiczhou/dsh-tree-harness/blob/master/docs/...`），且只引用已发布/稳定路径。
4. **版本口径**：文档中的版本号、测试数、SHA 必须与包 `package.json` / `git log` 一致；发版后同步 `guides/publishing.md`、`operations/handoff-2026-11-11.md`、`agent.md`。
5. **状态词**：现行 / 设计稿（部分未实现）/ 已实现 / 历史性 / 已归档。禁止在现行文档里写「待填」。

## 6. 维护检查清单（每次提交文档前后）

```powershell
node scripts/check-doc-links.mjs     # 相对链接全部可达
node scripts/check-md-tables.mjs     # Markdown 表格列数一致
git grep -n "docs/old-path"          # 无旧路径残留（迁移后）
```
