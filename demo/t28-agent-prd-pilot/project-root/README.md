# README.md —— 项目总览

> | 元数据 | 值 |
> |---|---|
> | 文档编号 | ROOT-00 | 隶属 | project-root（文档体系根） |
> | 版本 | v1.0 | 日期 | 2026-11-15 |
> | 生成口径 | **自动生成**（对应平台 M2 DocGenEngine 文档体系总览产物；本项目以 t28a 树 W7 整合收口会话模拟该生成器产出） |
> | 覆盖范围 | 开编程前文档体系全量（01_PRD…07_VERSIONS 七目录 + 体系根 `00_AGENT_ROLES.md`）；**不含任何产品代码** |
> | 上游锚点 | `../inputs/00_INPUT_INTENT.md`（一句话意图 + 用户四项裁决）、`../00_AGENT_ROLES.md`（角色职责地图） |
> | 状态声明 | **开编程前文档全部就绪，编码未开始**（见 §6） |

---

## 1. 项目一句话

> **做一个桌面应用，让完全不会编程的普通人，只靠自然语言对话，就能把想法变成能运行、可迭代的软件。**

**自举说明**：本项目是一次**真项目自举测试**——被设计对象 = 平台自身。需求源《向导Agent多智能体协同开发平台 v0.2》（`../inputs/prd-v0.2-source.md`）所描述的软件产品，正是本次软件工程设计的主题；本目录下的全部文档，就是该平台"开编程前文档体系"（PRD §5.2 完整目录，长期迭代型全量，用户裁决 #2）的一次真实生成结果。树内每个叶子会话扮演平台中的一个向导 Agent 角色（需求分析师 / UI/UX 顾问 / 架构设计师 / 工程经理 / 测试契约 / 整合收口），角色分工见 `../00_AGENT_ROLES.md` §7.1。

## 2. 文档地图（PRD §5.2 八目录一览）

| 路径 | 内容 | 负责人角色 | 行数规模 |
|------|------|-----------|---------|
| `/`（根） | `README.md` 本总览（自动生成口径） | 整合收口（t28a-W7，借 P8 收口语义） | 1 文件 |
| `../00_AGENT_ROLES.md`（体系根） | Agent 角色职责地图：向导 4 角色 G1–G4、编程 8 角色池 P1–P8、裁判门禁 H1–H8/S1–S4、自愈分工、树节点映射 | 提炼员（t28a-W1，元任务） | 337 行 |
| `01_PRD/` | `prd.md`（产品需求文档，F-01…F-24 + NFR-01…05）、`user-stories.md`（US-01…23，INVEST）、`dialogue-simulated.md`（模拟访谈纪要，I-xx 溯源） | 需求分析师 G1（t28a-W2） | 3 文件 / 855 行 |
| `02_UX_DESIGN/` | `sitemap.md`（P0–P6 前台 + R1–R5 研究区）、`user-flows.md`（UF-01…05）、`interaction-spec.md`（动效/文案契约/5s 阈值）、`design-system.md`（色板/组件/禁词表）、`prototype-feedback-simulated.md`（模拟原型反馈 3 轮）、`wireframes/*.prototype.html`（4 个可交互单文件原型） | UI/UX 顾问 G2（t28a-W3） | 9 文件 / 1711 行 |
| `03_ARCHITECTURE/` | `architecture.md`（Electron 选型 ADR-01…07、M0–M9 模块、依赖图、F→模块映射）、`class-diagram.puml`（27 类）、`data-model.md`（零数据库文件体系）、`sequence-diagrams/seq-01…04.puml`（4 张时序图） | 架构设计师 G3（t28a-W5） | 7 文件 / 1306 行 |
| `04_API_SPEC/` | `api-spec.md`（IPC + 本地 REST 混合，E-01…E-30 端点，Method/Path/Request/Response Schema 全定义） | 架构设计师 G3（t28a-W5） | 1 文件 / 529 行 |
| `05_PROJECT_PLAN/` | `sprint-plan.md`（S0…S15 十六个 Sprint、4 里程碑版本）、`team-config.md`（编程 8 角色激活配置，H6）、`workflow.md`（Sprint 内六步流水线 + 自愈流程） | 工程经理 G4（t28a-W6） | 3 文件 / 754 行 |
| `06_TESTS/` | `test-plan.md`（四层测试策略 + §5 覆盖映射总表）、`features/feature-01…14.feature`（Gherkin 机读场景 89 条：正常 37 / 边界 26 / 异常 26） | 测试工程师 P5 契约（t28a-W4） | 15 文件 / 902 行 |
| `07_VERSIONS/` | `changelog.md`（版本变更记录：v0.0.0 文档体系就绪 + v0.0.1…v1.0.0 规划态骨架；编码期由 M2 `appendChangelog()` 自动追加） | 整合收口（t28a-W7，按 F-22 约定建档） | 1 文件 |

**合计**：project-root 内 40 个文件、约 6132 行（不含本 README 与 changelog 建档后的增量）。全部文档满足 NFR-05 双标准：机器可解析（编号锚点 + front-matter + 机读表格）+ 人可阅读（生活化正文）。

## 3. 关键编号锚点速查

### 3.1 功能需求 F-xx（24 项，定义于 `01_PRD/prd.md` §5）

| 编号 | 功能 | 优先级 | 主责模块 | 关键端点 | 主责 Sprint |
|------|------|-------|---------|---------|------------|
| F-01 | 启动两道门模式选择 | P0 | M1 | E-01/E-02/E-03 | S0 |
| F-02 | 需求对话与多轮需求挖掘 | P0 | M1 | E-05/E-07 | S1 |
| F-03 | 精简PRD产出（快消型） | P0 | M2 | E-09/E-10 | S2 |
| F-04 | 完整PRD与用户故事产出（长期型） | P1 | M2 | E-08/E-09/E-10 | S6 |
| F-05 | 可交互HTML原型生成 | P0 | M3 | E-11/E-12 | S3 |
| F-06 | 原型视觉模型辅助审查 | P0 | M3 | E-11 | S3 |
| F-07 | 点选纠错 | P1 | M3+M9 | E-17…E-20 | S10 |
| F-08 | 时间轴自动快照与线性回滚 | P0 | M8 | E-21/E-22 | S4 |
| F-09 | 向导Agent角色切换与静默路由 | P0 | M1 | E-05 | S1 |
| F-10 | 快消型自动化执行管线 | P0 | M9 | E-10/E-20 | S4+S5 |
| F-11 | 长期迭代型规范化执行管线 | P1 | M9 | E-13…E-16 | S7+S8 |
| F-12 | 模式转换（快消→长期升级） | P1 | M9 | E-04 | S9 |
| F-13 | 编程Agent团队激活与协作 | P0 | M9 | —（后台） | S4+S8+S11 |
| F-14 | 工程模板体系与自动推断 | P1 | M9·b | E-29/E-30（+E-01 推断） | S11 |
| F-15 | GWT测试场景生成与测试收口 | P0 | M2+M7 | E-25/E-26 | S5+S6 |
| F-16 | 裁判Agent硬约束门禁 | P0 | M5 | E-10/E-23/E-24 | S2+S5+S8 |
| F-17 | 裁判Agent软约束评估 | P1 | M5 | E-23/E-24 | S9 |
| F-18 | 异常自愈与熔断回滚 | P1 | M9·c | E-19/E-20/E-22 | S10 |
| F-19 | 心理防御文案与进度安抚 | P0 | M1 | E-05/E-20 | S1 |
| F-20 | 全量埋点采集 | P2 | M6 | E-27 | S13 |
| F-21 | 后台分析看板与实验支持 | P2 | M6+M0 | E-28 | S14 |
| F-22 | Sprint规划与版本管理 | P1 | M9+M2 | E-15/E-16 | S8 |
| F-23 | 跨版本与跨会话上下文交接 | P1 | M9 | E-06/E-07 | S12 |
| F-24 | Figma设计稿导入（远期可选） | P2 | M3 | —（远期，@deferred） | S15 |

> 注：F↔端点对应关系为「主覆盖」口径；逐端点完整覆盖见 `04_API_SPEC/api-spec.md` §5 对照表，粒度性差异已在 `../00_CONSISTENCY-REPORT.md` §5 登记。

### 3.2 端点 E-xx（30 个，定义于 `04_API_SPEC/api-spec.md` §4）

| 分组 | 端点 | 覆盖 F-xx |
|------|------|----------|
| A 项目与模式 | E-01 创建项目 / E-02 项目列表 / E-03 项目详情 / E-04 模式转换 | F-01、F-12、F-14 |
| B 对话轮次 | E-05 提交轮次 / E-06 拉取历史 / E-07 需求清单 | F-02、F-09、F-19、F-23 |
| C 文档与原型 | E-08 文档列表 / E-09 文档详情 / E-10 确认文档 / E-11 当前原型 / E-12 原型静态资源 | F-03、F-04、F-05、F-06、F-16、NFR-05 |
| D 架构与计划 | E-13/E-14 架构确认 / E-15/E-16 Sprint 计划与开工 | F-11、F-22 |
| E 点选与任务 | E-17/E-18/E-19 修改意图 / E-20 任务轮询 | F-07、F-08、F-18、F-19 |
| F 快照 | E-21 快照列表 / E-22 一键回滚 | F-08、F-19 |
| G 判定 | E-23 判定列表 / E-24 判定详情 | F-16、F-17 |
| H 测试报告 | E-25/E-26 测试报告 | F-15、F-16(H7) |
| I 埋点 | E-27 上报 / E-28 科研导出 | F-20、F-21、NFR-01 |
| J 模板 | E-29 推断 / E-30 模板库 | F-14 |

### 3.3 模块 M0–M9（定义于 `03_ARCHITECTURE/architecture.md` §4）

| 模块 | 名称（类名） | 主责 F-xx |
|------|-------------|----------|
| M0 | 桌面壳与渲染层 DesktopShell | （呈现端协同：F-19/F-21） |
| M1 | 对话路由层 DialogueRouter | F-01、F-02、F-09、F-19 |
| M2 | 文档生成引擎 DocGenEngine | F-03、F-04、F-15（生成侧） |
| M3 | 原型生成引擎 PrototypeEngine | F-05、F-06、F-07（捕获）、F-24 |
| M4 | PlantUML 规约引擎 PlantUmlEngine | F-11（主约束） |
| M5 | 裁判引擎 JudgeEngine | F-16、F-17 |
| M6 | 埋点采集层 TelemetryCollector | F-20、F-21 |
| M7 | GWT 测试执行器 GwtTestRunner | F-15（执行侧） |
| M8 | 快照管理器 SnapshotManager | F-08 |
| M9 | 会话与编排层 Orchestrator（M9·a ModelGateway / M9·b TemplateRegistry / M9·c RepairLoop） | F-10、F-11、F-12、F-13、F-14、F-18、F-22、F-23 |

### 3.4 用户故事 US-xx（23 条，定义于 `01_PRD/user-stories.md` §2）

P0 全量 12 条（US-01…12 ↔ F-01/02/03/05/06/08/09/10/13/15/16/19）；P1 代表 8 条（US-13…20 ↔ F-04/11/12/07/14/18/22/23）+ US-23（F-17，研究者视角）；P2 代表 2 条（US-21/22 ↔ F-20/21）。**F-24 不拆故事**（远期可选豁免，`user-stories.md` §4 有据）。每条 US-xx 恰好映射 1 个 F-xx。

### 3.5 Sprint S0–S15（16 个 × 2 周，定义于 `05_PROJECT_PLAN/sprint-plan.md` §2）

| 阶段 | Sprint | 版本 | 主题 |
|------|--------|------|------|
| Phase 1 MVP | S0→S5 | v0.0.1→**v0.1.0**① | 两道门→需求对话→精简PRD+裁判→原型→快照+快消编排→GWT 收口 MVP 闭环 |
| Phase 2 长期迭代型 | S6→S8 | v0.1.1/v0.1.2→**v0.2.0**② | 完整PRD+Feature落盘→PlantUML主约束→Sprint管线+版本管理 |
| Phase 3 体系完善 | S9→S12 | v0.2.1…v0.2.3→**v0.3.0**③ | 模式转换+软约束→点选纠错+自愈→模板体系→跨会话交接 |
| Phase 4 数据与科研 | S13→S15 | v0.3.1/v0.3.2→**v1.0.0**④ | 埋点→看板+实验→Figma可选+科研收口 |

### 3.6 GWT feature 文件（14 个，`06_TESTS/features/`，89 场景）

| 文件 | 覆盖 F-xx | 场景数 |
|------|----------|--------|
| feature-01-mode-gate | F-01 | 4 |
| feature-02-requirement-and-docs | F-02、F-03、F-04 | 10 |
| feature-03-prototype-review | F-05、F-06 | 7 |
| feature-04-pick-to-fix | F-07 | 4 |
| feature-05-snapshot-rollback | F-08 | 4 |
| feature-06-single-guide | F-09 | 3 |
| feature-07-pipeline-and-team | F-10、F-11、F-13、F-14、F-22 | 20 |
| feature-08-mode-upgrade | F-12 | 4 |
| feature-09-tests-and-referee | F-15、F-16、F-17 | 12 |
| feature-10-self-heal | F-18 | 4 |
| feature-11-reassurance | F-19 | 6 |
| feature-12-context-handover | F-23 | 3 |
| feature-13-research-data | F-20、F-21 | 6 |
| feature-14-figma-import（@deferred） | F-24 | 2 |

场景编号 `F-xx-NN` 24 族连续无断裂；三态分布 正常 37 / 边界 26 / 异常 26；逐项映射见 `06_TESTS/test-plan.md` §5。

## 4. 如何阅读

### 4.1 零基础读者路径（不写代码的人，约 30 分钟）

1. **先读本文件 §1–§2**：知道这个项目是什么、有哪些文档；
2. **读 `01_PRD/prd.md` §1–§3**：项目定位、给谁用、两种模式（快消型/长期迭代型）——开头即可看懂"给谁用、做什么"（NFR-05 验收点）；
3. **双击打开 `02_UX_DESIGN/wireframes/` 下任一 `.prototype.html`**：亲眼看看产品长什么样、能点什么；
4. **读 `02_UX_DESIGN/sitemap.md` §3–§4**：认识 7 个用户前台页面（P0–P6）；
5. （可选）读 `06_TESTS/features/*.feature` 的中文场景——每条都是"给…当…当…那么…"的人话验收场景。

> 零基础读者**不需要**读：`03_ARCHITECTURE/`、`04_API_SPEC/`、`class-diagram.puml`——PlantUML 与 API 规约对用户完全透明（PRD 需求源 §8.4 承诺，由 `02_UX_DESIGN` 的生活化文档承接）。

### 4.2 工程读者路径（编码期 Agent / 工程师）

1. `01_PRD/prd.md` §4 编号体系 + §5.1 功能索引（对账锚点）→ §5.2 逐功能 GWT 验收标准；
2. `01_PRD/user-stories.md` §4 覆盖矩阵（US↔F 一一映射）；
3. `03_ARCHITECTURE/architecture.md`：§3 选型（ADR-01…07）→ §4 模块 M0–M9 → §5 依赖图 → §6 F→模块映射；
4. `04_API_SPEC/api-spec.md`：§3 通用约定（信封/错误码/文案位契约/IPC 映射）→ §4 端点逐个实现 → §5 对照表；
5. `03_ARCHITECTURE/data-model.md`（文件体系布局）+ `class-diagram.puml`（H8 结构强约束）+ 4 张时序图；
6. `05_PROJECT_PLAN/`：sprint-plan §3 逐 Sprint 工作包（含角色分工/端点/验收判据）→ team-config → workflow；
7. `06_TESTS/`：test-plan §5 覆盖映射 → `features/*.feature`（编码前验收契约，收口判据 = 89/89 全量通过）；
8. 编码期每 Sprint 收口后查 `07_VERSIONS/changelog.md`（F-22-03 自动追加）。

**对账口径**：任何文档间编号争议，以 `../00_CONSISTENCY-REPORT.md`（裁判软约束四维复核）为仲裁记录；上游文件问题只登记不代改。

## 5. 状态声明

| 项 | 状态 |
|----|------|
| **编码** | **未开始**。本目录不含任何产品源代码（`wireframes/*.prototype.html` 为文档体系内的可交互原型，PRD §5.2 明确其属文档不算编码） |
| **开编程前文档** | **全部就绪**：01_PRD / 02_UX_DESIGN / 03_ARCHITECTURE / 04_API_SPEC / 05_PROJECT_PLAN / 06_TESTS 七目录齐备 + 07_VERSIONS 本日建档；裁判依赖闸已逐级通过（W2∥W3 → 第一道关 → W5 → 门禁 → W6 → 门禁 → W7） |
| **下一步** | 用户确认 `05_PROJECT_PLAN/`（Sprint 计划与节奏，F-22-01 / F-11-02）后，自 S0 起进入编码期；每 Sprint 收口以 GWT 89 场景 100% 通过 + 裁判校验为判据 |
| **一致性复核** | `../00_CONSISTENCY-REPORT.md`（2026-11-15）：四维软约束逐项给证据；发现矛盾/缺口共 **13** 条，全部 minor、无 blocker，均只登记未代改 |

---

> 文档结束。本 README 由整合收口会话按 M2 DocGenEngine 自动生成口径产出；编码开始后每次 Sprint 收口由 M2 `appendChangelog()` 维护 `07_VERSIONS/changelog.md`，本文件仅在文档体系结构变化时重新生成。
