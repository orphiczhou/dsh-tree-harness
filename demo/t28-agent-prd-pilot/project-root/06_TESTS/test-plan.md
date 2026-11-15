# 测试计划（test-plan）——向导Agent与编程Agent多智能体协同开发平台

> 文档编号：TEST-01 | 隶属：06_TESTS | 版本：v1.0 | 日期：2026-11-15
> 产出角色：测试工程师（向导Agent团队，t28a-W4-gwt）
> 上游文档：`01_PRD/prd.md`（F-xx 唯一来源，§10 PRD-测试强对应体系）、`01_PRD/user-stories.md`（US-xx）、`02_UX_DESIGN/user-flows.md`（UF-01~05）、`02_UX_DESIGN/interaction-spec.md`（文案契约 §4、阈值体系 §5）
> 硬约束声明：**每个 PRD 功能项（F-xx）必须有对应的 GWT 场景，缺失即退回**（prd.md §10 / §9.2）。本文件 §5 覆盖映射总表（24 行全覆盖）即为该硬约束的验收证据。

---

## 1. 测试目标与被测对象

- **被测对象**：《向导Agent与编程Agent多智能体协同开发平台》自身（自举案例），范围 = PRD §5 全部 24 项功能（F-01…F-24）。
- **测试目标**：把 PRD §5.2 每项功能的「验收标准（GWT 要点）」句落实为可机读、可执行、可对账的 GWT 场景集，作为编码前验收契约（需求源裁决 #4：GWT 测试文档纳入）。
- **口径**：场景中的界面元素与提示文案与 `02_UX_DESIGN/interaction-spec.md` 一致；五条心理防御文案（§4.1）为逐字契约，场景中引用时一字不改。

## 2. 测试分层（GWT 验收为收口判据）

| 层 | 名称 | 内容 | 判据地位 |
|----|------|------|---------|
| L1 | **GWT 验收场景**（`features/*.feature`） | 89 个场景，覆盖 24 项功能的正常路径/边界条件/异常输入 | **交付收口的唯一判据：全量通过 = 交付合格**（PRD F-15/F-10） |
| L2 | 覆盖映射对账（本文件 §5） | F-xx ↔ feature 文件 ↔ Scenario 编号三向映射，24 行全覆盖 | 裁判硬约束证据：任一 F-xx 无场景条目 = 门禁退回（F-16-03） |
| L3 | 文案契约一致性检查 | 五条心理防御文案逐字比对（interaction-spec §4.1）、界面禁词负面清单（§9：源码/控制台/报错堆栈/分支图/百分比进度等） | 检查失败 = 退回修改 |
| L4 | 人工/裁判抽检 | 裁判 Agent 软约束四维度（逻辑一致性/可测试性/完整性/可读性）抽检场景可检验性 | 结论三档：通过/建议改进/退回（F-17） |

分层说明：L1 是收口判据，L2 是 L1 的完备性证明，L3/L4 是质量补充；四层全部通过方可进入下一阶段。

## 3. 执行方式（自动运行 GWT 场景产出通过率报告）

1. **运行方式**：GWT 测试执行器对 `06_TESTS/features/` 下全部 14 个 `.feature` 文件自动运行（`.feature` 为机读文本，场景以 Scenario 为最小执行单元）。
2. **通过率报告字段**：总场景数、通过/未通过数、通过率、每条未通过场景的编号与失败步骤；报告按 F-xx 聚合。
3. **收口规则**：报告通过率 = 100%（89/89）方可判定交付合格；任一场景未通过即触发 §6 退回流程。
4. **场景标识约定**：每个 Scenario 命名为 `F-xx-NN 简述`，并携带 Gherkin 标签 `@F-xx` 与 `@正常|@边界|@异常`（机读对账用）；`@deferred` 标签表示远期可选（仅 F-24 文件级）。

## 4. 场景统计

| 维度 | 数值 |
|------|------|
| feature 文件数 | 14（feature-01 … feature-14，按功能域组织） |
| 场景总数 | **89**（正常 37 / 边界 26 / 异常 26） |
| P0 功能 12 项 | 场景 48 条，每项 3–6 条（F-19 最密 6 条，覆盖五段文案全落位） |
| P1 功能 9 项 | 场景 32 条，每项 3–4 条 |
| P2 功能 3 项 | 场景 9 条（F-20×3、F-21×3、F-24×2@deferred） |
| 三态覆盖 | 24 项功能全部覆盖正常+边界+异常三类（F-24 异常类=未配置不影响主流程的负面保障） |

## 5. 覆盖映射总表（F-xx ↔ feature 文件 ↔ Scenario，24 行全覆盖）

| F-xx | 功能名称（优先级） | feature 文件 | Scenario 编号 | 场景数 | 正常/边界/异常 |
|------|-------------------|--------------|---------------|--------|----------------|
| F-01 | 启动两道门模式选择（P0） | features/feature-01-mode-gate.feature | F-01-01…F-01-04 | 4 | 2/1/1 |
| F-02 | 需求对话与多轮需求挖掘（P0） | features/feature-02-requirement-and-docs.feature | F-02-01…F-02-04 | 4 | 2/1/1 |
| F-03 | 精简PRD产出·快消型（P0） | features/feature-02-requirement-and-docs.feature | F-03-01…F-03-03 | 3 | 1/1/1 |
| F-04 | 完整PRD与用户故事·长期型（P1） | features/feature-02-requirement-and-docs.feature | F-04-01…F-04-03 | 3 | 1/1/1 |
| F-05 | 可交互HTML原型生成（P0） | features/feature-03-prototype-review.feature | F-05-01…F-05-03 | 3 | 1/1/1 |
| F-06 | 原型视觉模型辅助审查（P0） | features/feature-03-prototype-review.feature | F-06-01…F-06-04 | 4 | 2/1/1 |
| F-07 | 点选纠错（P1） | features/feature-04-pick-to-fix.feature | F-07-01…F-07-04 | 4 | 2/1/1 |
| F-08 | 时间轴自动快照与线性回滚（P0） | features/feature-05-snapshot-rollback.feature | F-08-01…F-08-04 | 4 | 2/1/1 |
| F-09 | 向导Agent角色切换与静默路由（P0） | features/feature-06-single-guide.feature | F-09-01…F-09-03 | 3 | 1/1/1 |
| F-10 | 快消型自动化执行管线（P0） | features/feature-07-pipeline-and-team.feature | F-10-01…F-10-04 | 4 | 2/1/1 |
| F-11 | 长期迭代型规范化执行管线（P1） | features/feature-07-pipeline-and-team.feature | F-11-01…F-11-04 | 4 | 2/1/1 |
| F-12 | 模式转换·快消→长期升级（P1） | features/feature-08-mode-upgrade.feature | F-12-01…F-12-04 | 4 | 2/1/1 |
| F-13 | 编程Agent团队激活与协作（P0） | features/feature-07-pipeline-and-team.feature | F-13-01…F-13-04 | 4 | 2/1/1 |
| F-14 | 工程模板体系与自动推断（P1） | features/feature-07-pipeline-and-team.feature | F-14-01…F-14-04 | 4 | 2/1/1 |
| F-15 | GWT测试场景生成与测试收口（P0） | features/feature-09-tests-and-referee.feature | F-15-01…F-15-04 | 4 | 2/1/1 |
| F-16 | 裁判Agent硬约束门禁（P0） | features/feature-09-tests-and-referee.feature | F-16-01…F-16-05 | 5 | 1/2/2 |
| F-17 | 裁判Agent软约束评估（P1） | features/feature-09-tests-and-referee.feature | F-17-01…F-17-03 | 3 | 1/1/1 |
| F-18 | 异常自愈与熔断回滚（P1） | features/feature-10-self-heal.feature | F-18-01…F-18-04 | 4 | 1/2/1 |
| F-19 | 心理防御文案与进度安抚（P0） | features/feature-11-reassurance.feature | F-19-01…F-19-06 | 6 | 2/2/2 |
| F-20 | 全量埋点采集（P2） | features/feature-13-research-data.feature | F-20-01…F-20-03 | 3 | 1/1/1 |
| F-21 | 后台分析看板与实验支持（P2） | features/feature-13-research-data.feature | F-21-01…F-21-03 | 3 | 1/1/1 |
| F-22 | Sprint规划与版本管理（P1） | features/feature-07-pipeline-and-team.feature | F-22-01…F-22-04 | 4 | 2/1/1 |
| F-23 | 跨版本与跨会话上下文交接（P1） | features/feature-12-context-handover.feature | F-23-01…F-23-03 | 3 | 1/1/1 |
| F-24 | Figma设计稿导入·远期可选（P2，@deferred） | features/feature-14-figma-import.feature | F-24-01…F-24-02 | 2 | 1/0/1 |

**映射统计**：24/24 行全覆盖，无缺失项。P0 12 项均 ≥3 场景（密度 3–6）；P1 9 项均 ≥2 场景（实际 3–4）；P2 3 项均 ≥1 场景。合计 89 场景。

## 6. 退回与重跑规则（对齐 PRD §9.3：长期迭代型不限退回必须通过）

1. **退回触发**：任一 GWT 场景未通过、任一 F-xx 缺失场景条目（L2 对账失败）、或文案契约检查失败（L3），即由裁判退回编程/需求侧修复（联动 F-15-03、F-16-02/03）。
2. **退回次数**：
   - **长期迭代型**（本项目模式，裁决 #2）：**不限退回次数，必须通过后方可进入下一阶段**（F-16-05）；
   - 快消型：同一文档退回 2 次上限后提示人工介入（F-16-04），本规则仅在快消模式下生效。
3. **重跑范围**：修复后**先重跑失败场景，再全量重跑 89 条场景**（回归优先），防止修复引入新回归；全量通过 = 100% 方可收口。
4. **重跑记录**：每次运行产出带时间戳的通过率报告并按 F-xx 聚合留档，退回-修复-重跑链路可追溯（支撑裁判判定与 §9.3 长期迭代型审计）。
5. **失败安抚口径**：测试未通过属于系统内部流程，不向零基础用户暴露细节；用户侧仅见「修改失败」「操作超时」等指定安抚文案（F-19，联动 F-18）。

## 7. 豁免与延期说明

| 项 | 处理 | 依据 |
|----|------|------|
| F-24 Figma设计稿导入 | 场景保留 2 条（F-24-01 正常 / F-24-02 异常保障），文件级标注 `@deferred`，豁免本期交付排期；**不豁免** F-24-02（未配置 Figma 主流程不受影响的负面保障始终有效） | 需求源标注「远期可选增强」；prd.md §8 将其列入「远期规划（不在本期承诺）」；PRD §10 P2 密度规则 ≥1 已满足 |
| 其余 23 项 | 无豁免，全量进验收主线 | PRD §5 全部按优先级分期但均需场景覆盖 |

## 8. 对账声明（供裁判门禁与 W7 使用）

- 本目录 `features/` 14 个文件、89 个场景与 PRD §5.2 的 24 项功能逐项对应，编号引用关系见 §5 总表，可机读复核（`@F-xx` 标签 grep 即可对账）；
- 场景引用的界面元素与提示文案来源：`02_UX_DESIGN/interaction-spec.md`（§3–§9）、`02_UX_DESIGN/user-flows.md`（UF-01~05）；五条心理防御文案逐字一致；
- 本文件与 feature 文件为纯文档交付（机读 Gherkin 文本），不含可执行代码，无需运行环境。
