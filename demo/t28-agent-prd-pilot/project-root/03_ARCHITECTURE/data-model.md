# 数据模型设计（data-model.md）

> | 元数据 | 值 |
> |---|---|
> | 文档编号 | ARCH-04 | 隶属 | 03_ARCHITECTURE |
> | 版本 | v1.0 | 日期 | 2026-11-15 |
> | 产出角色 | 架构设计师 G3 | 树节点 | t28a / t28a-W5-arch |
> | 一致性基准 | `class-diagram.puml`（类与字段一一对应）；需求源 §13.3 原则「能用文件就别用数据库」 |
> | 存储决策 | ADR-02：零数据库。文件目录结构承载内容，JSON/JSONL 索引承载可查询元数据，**索引可从内容重建** |

---

## 1. 设计原则

| # | 原则 | 说明 |
|---|------|------|
| D1 | 文件即真相 | 文档内容（`.md`/`.html`/`.puml`/`.feature`）是人可读的权威数据；JSON 索引只是加速查询的元数据层 |
| D2 | 索引可重建 | 删除任何 `*.json` 索引后，引擎扫描目录内容即可完整重建（崩溃恢复兜底） |
| D3 | 追加流用 JSONL | 对话轮次、埋点事件只追加不修改，天然防篡改、便于审计（需求源 §12.1 全量采集） |
| D4 | 原子写入 | 所有 JSON 写入 = 写 `{name}.tmp` → 原子重命名；杜绝半写文件 |
| D5 | 快照 = 目录拷贝 | 快照内容是项目文件树的完整拷贝（排除 `snapshots/` 自身），恢复即目录替换 |
| D6 | 脱敏分层 | 业务内容只存项目目录；`research/` 下只存脱敏后的事件流（NFR-01，不含真实业务 payload） |

## 2. 实体与字段（与 class-diagram.puml 一致）

### 2.1 Project（`projects/{projectId}/project.json`）

| 字段 | 类型 | 必填 | 说明 | 类图属性 |
|------|------|------|------|---------|
| id | string(uuid) | ✓ | 项目唯一标识 | id |
| name | string | ✓ | 项目名（生活化，用户可改） | name |
| mode | `QUICK` / `LONGTERM` | ✓ | 两道门选择结果（F-01） | mode |
| templateKey | string | ✓ | 推断模板键（六类之一，F-14，对用户不可见） | templateKey |
| status | `ACTIVE`/`ARCHIVED`/`CLOSED` | ✓ | 项目状态 | status |
| rootPath | string | ✓ | 项目目录绝对路径 | rootPath |
| stage | SessionStage 8 值 | ✓ | 当前阶段（状态机） | stage |
| currentSnapshotId | string | ✓ | 当前版本快照 | —（经 Snapshot.seq 推导，冗余存储加速查询） |
| createdAt / updatedAt | ISO8601 | ✓ | 时间戳 | createdAt / updatedAt |

### 2.2 Session / DialogueRound（`projects/{id}/sessions/{sessionId}.jsonl`，逐行一条 Round）

| 字段 | 类型 | 必填 | 说明 | 类图属性 |
|------|------|------|------|---------|
| sessionId | string | ✓ | 会话标识（文件名） | Session.id |
| roundId | string | ✓ | 轮次标识 | DialogueRound.id |
| seq | int | ✓ | 轮次序号（自增） | seq |
| userInput | string | ✓ | 用户原始输入（业务内容，不进科研导出） | userInput |
| inputKind | `FREE_TEXT`/`CARD`/`DECIDE_FOR_ME`/`SCREENSHOT` | ✓ | 输入形态（卡片选择为主 F-02） | inputKind |
| guideReply | string | ✓ | 向导回复正文 | guideReply |
| cardOptions | string[] | — | 本轮卡片选项 | cardOptions |
| activeRoleKey | string | ✓ | 本轮实际服务的角色键（用户不可见，F-09 审计用） | —（审计冗余） |
| decidedBy | `USER`/`DECIDE_FOR_ME` | ✓ | 决策归属 | decidedBy |
| ts | ISO8601 | ✓ | 时间戳 | ts |
| contextSummary | string | — | 会话级上下文摘要（跨会话交接 F-23，存文件尾 meta 行） | Session.contextSummary |

### 2.3 Document（内容 = 文档体系原文件；索引 = `projects/{id}/documents.json`）

| 字段 | 类型 | 必填 | 说明 | 类图属性 |
|------|------|------|------|---------|
| id | string | ✓ | 文档标识 | id |
| kind | DocKind 14 值 | ✓ | PRD/USER_STORY/ARCHITECTURE/CLASS_DIAGRAM/…/PROTOTYPE | kind |
| path | string | ✓ | 相对项目根的路径（如 `01_PRD/prd.md`） | path |
| version | int | ✓ | 版本号（每次定稿 +1） | version |
| status | `DRAFT`/`FINALIZED`/`CONFIRMED`/`REJECTED` | ✓ | 生命周期状态 | status |
| confirmedByUser | boolean | ✓ | 用户确认/签字（触发裁判门禁） | confirmedByUser |
| lastVerdictId | string | — | 最近一次裁判判定 | —（关联 JudgeVerdict） |
| updatedAt | ISO8601 | ✓ | — | — |

内容格式约定（NFR-05 双标准）：Markdown 文档头部为 YAML front-matter（机器可解析：`doc_id/kind/f_refs/version`），正文为零基础可读的生活化语言。

### 2.4 Snapshot（`projects/{id}/snapshots/index.json` + `snapshots/{snapshotId}/` 文件树）

| 字段 | 类型 | 必填 | 说明 | 类图属性 |
|------|------|------|------|---------|
| id | string | ✓ | 快照标识（目录名） | id |
| seq | int | ✓ | **线性序号**（单链递增，无分支 F-08） | seq |
| trigger | `INITIAL_GENERATED`/`BEFORE_CONFIRM`/`AFTER_CONFIRM`/`MODE_SWITCH`/`BEFORE_ROLLBACK` | ✓ | 四类自动时机 | trigger |
| description | string | ✓ | 一句自然语言描述（"画好第一版页面"） | description |
| ts | ISO8601 | ✓ | 时间戳 | ts |
| archived | boolean | ✓ | 回滚后旧快照转"存档"，仅存档不参与当前版本 | archived |
| contentHash | string | ✓ | 文件树哈希（回滚前完整性校验） | contentHash |

线性规则：`index.json` 为按 `seq` 排序的单链数组；回滚 = 新增一条 `BEFORE_ROLLBACK` 快照（保存当前）→ 将目标快照内容拷回工作区；不产生任何分支结构。

### 2.5 AgentRole / TeamConfig（`roles/index.json` + `roles/{roleKey}.prompt.md`；项目级激活集 `projects/{id}/team-config.json`）

| 字段（roles/index.json 每角色一条） | 类型 | 说明 | 类图属性 |
|------|------|------|---------|
| roleKey | string | `G1_ANALYST`…`G4_ENG_MANAGER`、`P1_ARCHITECT`…`P8_PM` | AgentRole.roleKey |
| family | `GUIDE`/`CODING` | 向导系/编程系（继承的两个子类） | family |
| displayName | string | 角色名（仅后台文档可见） | displayName |
| systemPromptPath | string | 独立 System Prompt 文件（NFR-03） | systemPromptPath |
| modelBinding | string | 模型配置键（§3.3 绑定表） | modelBinding |
| activation | object | 激活时机/条件（G 系按阶段，P 系按条件池） | activationStage / activationCondition |

TeamConfig：`{ id, projectId, activatedRoleKeys[], collaborationFlow, activatedAt }`（类图 TeamConfig o-- AgentRole 的落盘形态）。

### 2.6 Sprint（`05_PROJECT_PLAN/sprint-plan.md` 正文 + `projects/{id}/plans.json` 状态索引）

| 字段 | 类型 | 说明 | 类图属性 |
|------|------|------|---------|
| id | string | Sprint 标识 | id |
| index | int | 序号（第 N 期） | index |
| goal | string | 本期目标（生活化表述） | goal |
| durationWeeks | int ≤2 | 硬约束 H5：≤2 周可交付增量 | durationWeeks |
| status | `PLANNED`/`CONFIRMED`/`RUNNING`/`DELIVERED` | 状态机 | status |
| deliverables | string[] | 可交付增量清单 | deliverables |
| scopeScenarioIds | string[] | 本期验收 GWT 场景集 | —（关联 GwtScenario） |

### 2.7 GwtScenario（内容 = `06_TESTS/features/feature-NN.feature`；索引 = `projects/{id}/gwt-index.json`）

| 字段 | 类型 | 说明 | 类图属性 |
|------|------|------|---------|
| id | string | 场景标识 | id |
| fRef | string | 对应 PRD 功能项（`F-xx`，H7 对账锚点） | fRef |
| featureFile | string | `.feature` 文件路径 | featureFile |
| category | `NORMAL`/`BOUNDARY`/`EXCEPTION` | 三类覆盖（F-15） | category |
| given / when / then | string[] | GWT 三段步骤（与 feature 文件正文一致） | given / when / then |
| lastPassed | boolean | 最近一次运行结果 | lastPassed |

### 2.8 TestReport / JudgeVerdict（`projects/{id}/test-reports/{reportId}.json`、`projects/{id}/judgments/{verdictId}.json`）

TestReport：`{ id, projectId, sprintId, total, passed, failed, results:[{scenarioId, passed, message}], ts }`（类图 TestReport，`passRate = passed/total`）。

JudgeVerdict：

| 字段 | 类型 | 说明 | 类图属性 |
|------|------|------|---------|
| id | string | 判定标识 | id |
| targetKind / targetRef | string | 判定对象（`DOCUMENT:01_PRD/prd.md`、`SPRINT:sprint-01`、`DELIVERY:version-1`） | targetKind / targetRef |
| hardResults | map<string,boolean> | H1–H8 逐项布尔结果（硬约束不可通融） | hardResults |
| softResults | map<string,string> | S1–S4 四维：`PASS`/`SUGGEST`/`REJECT` + 理由（软约束 AI 评估） | softResults |
| decision | `PASS`/`SUGGEST`/`REJECT` | 总判定 | decision |
| rejectCount | int | 累计退回次数（快消型 ≥2 触发人工介入 §9.3） | rejectCount |
| reasons | string[] | 退回原因（生活化转述给用户） | reasons |
| ts | ISO8601 | — | ts |

### 2.9 Template（`templates/{key}.json`，内置 6 类 + 插件导入）

`{ key, name, teamPreset[], docChecklist[], workflow, sprintRhythm, builtin }`（类图 Template；F-14：模板预定义团队配置/文档清单/协作流程/Sprint 节奏；`importFrom` 支持 JSON/YAML 导入与第三方注册）。

### 2.10 ModificationIntent（`projects/{id}/fix-intents/{intentId}.json`）

| 字段 | 类型 | 说明 | 类图属性 |
|------|------|------|---------|
| id | string | 意图标识 | id |
| elementSelector | string | 点选元素定位（CSS selector/坐标） | elementSelector |
| elementType | string | 元素类型（按钮/文本/区块…） | elementType |
| context | string | 元素上下文（所在页面/周边元素摘要） | context |
| userWish | string | 用户期望原文（快选 + 自由描述） | userWish |
| spec | string | G2 转写后的修改规约（编程Agent输入） | spec |
| status | `RECORDED`/`EXECUTING`/`DONE`/`CANCELLED`/`FAILED` | 两段式状态（先记录后执行） | status |
| snapshotId | string | 执行前强制快照的引用（F-07 联动 F-08） | —（关联 Snapshot） |

### 2.11 TraceEvent（`projects/{id}/trace/events-YYYYMMDD.jsonl` 追加流；脱敏导出 `research/export/*.jsonl`）

| 字段 | 类型 | 说明 | 类图属性 |
|------|------|------|---------|
| id | string | 事件标识 | id |
| projectId | string | 项目标识 | projectId |
| type | TraceEventType 13 值 | 与需求源 §12.4 清单一一对应（PROJECT_CREATED/ROUND_SUBMITTED/ROLE_SWITCHED/PRD_CONFIRMED/PROTOTYPE_CONFIRMED/USER_UNDO/CLICK_FIX/MODE_SWITCHED/CODING_EXECUTED/REPAIR_TRIGGERED/JUDGE_VERDICT/SATISFACTION_MARKED/PROJECT_CLOSED） | type |
| roundNo | int | 关联轮次（可空） | roundNo |
| payload | object | 事件明细（**脱敏后**只含类别/计数/耗时，不含业务原文） | payload |
| anonymized | boolean | 是否已脱敏 | anonymized |
| ts | ISO8601 | 时间戳 | ts |

## 3. 存储形态：文件目录结构 vs JSON 索引

### 3.1 平台级目录（应用数据根 `userData/`）

```
userData/
├── roles/                        # 角色库（NFR-03）
│   ├── index.json                #   角色→Prompt文件→模型绑定 索引
│   └── {roleKey}.prompt.md       #   每角色独立 System Prompt 文件
├── templates/                    # 模板库（F-14）
│   ├── web-fullstack.json        #   内置六类模板
│   ├── ...
│   └── plugins/                  #   第三方模板插件注册目录
└── research/                     # 科研区（脱敏后, 不含业务内容 NFR-01）
    └── export/*.jsonl            #   脱敏事件流导出
```

### 3.2 项目级目录（`projects/{projectId}/`）

```
projects/{projectId}/
├── project.json                  # 项目元数据（§2.1）
├── requirements.json             # 已确认需求清单（F-02, 生活化）
├── sessions/                     # 会话轮次（§2.2, JSONL 追加流）
│   └── {sessionId}.jsonl
├── documents.json                # 文档索引（§2.3）
├── gwt-index.json                # GWT 场景索引（§2.7）
├── plans.json                    # Sprint 状态索引（§2.6）
├── team-config.json              # 团队配置（§2.5）
├── fix-intents/                  # 点选纠错意图（§2.10）
│   └── {intentId}.json
├── judgments/                    # 裁判判定（§2.8）
│   └── {verdictId}.json
├── test-reports/                 # GWT 测试报告（§2.8）
│   └── {reportId}.json
├── trace/                        # 埋点事件（§2.11, 按日分文件追加）
│   └── events-YYYYMMDD.jsonl
├── snapshots/                    # 快照（§2.4）
│   ├── index.json                #   线性序列索引
│   └── {snapshotId}/             #   项目文件树完整拷贝
└── workspace/                    # 项目文档体系本体（即 PRD §5.2 的 project-root 内容）
    ├── 01_PRD/                   #   prd.md, user-stories.md
    ├── 02_UX_DESIGN/             #   sitemap/user-flows/wireframes/*.prototype.html/…
    ├── 03_ARCHITECTURE/          #   architecture.md, *.puml, data-model.md
    ├── 04_API_SPEC/              #   api-spec.md
    ├── 05_PROJECT_PLAN/          #   sprint-plan.md, team-config.md, workflow.md
    ├── 06_TESTS/                 #   features/*.feature, step-definitions/, test-plan.md
    ├── 07_VERSIONS/              #   changelog.md
    └── README.md
```

### 3.3 内容文件 vs JSON 索引分工表

| 数据 | 形态 | 位置 | 可重建 |
|------|------|------|-------|
| PRD/架构/计划/测试等文档正文 | Markdown（front-matter 结构化） | `workspace/01…07_*` | 是（内容即真相） |
| 原型 | 单文件 HTML | `workspace/02_UX_DESIGN/wireframes/` | 是 |
| PlantUML 规约 | `.puml` 文本 | `workspace/03_ARCHITECTURE/` | 是 |
| GWT 场景 | `.feature` 文本 | `workspace/06_TESTS/features/` | 是 |
| 对话轮次 | JSONL 追加流 | `sessions/` | 否（追加流本身是真相） |
| 埋点事件 | JSONL 追加流 | `trace/` | 否（同上） |
| 快照内容 | 目录拷贝 | `snapshots/{id}/` | 否（拷贝本身是真相） |
| 项目/文档/场景/Sprint 元数据 | JSON 索引 | `*.json` | **是**（D2，可由内容重建） |
| 判定/测试报告 | JSON 文件 | `judgments/`、`test-reports/` | 否（运行产物，独立真相） |

### 3.4 一致性协议

- **原子写**：JSON/JSONL 索引写入走 `{name}.tmp` → rename（D4）；JSONL 追加使用单写者（Orchestrator 串行化）追加。
- **快照一致性**：`autoSnapshot` 时冻结写入 → 拷贝 `workspace/` → 计算 contentHash → 追加 index；回滚时先校验目标 contentHash 再原子替换。
- **索引重建**：`documents.json`/`gwt-index.json`/`plans.json` 丢失时由各引擎扫描 `workspace/` front-matter 重建；`project.json` 为手工元数据，不参与重建但纳入每份快照。

## 4. 类 ↔ 存储 ↔ API 资源对照表（供 W7 与裁判对账）

| 类图类 | 存储位置 | API 资源（api-spec.md） |
|--------|---------|------------------------|
| Project | `project.json` | E-01/E-02/E-03/E-04 `/projects` |
| Session / DialogueRound | `sessions/*.jsonl` | E-05/E-06/E-07 `/projects/{id}/sessions/...` |
| Document | `workspace/**` + `documents.json` | E-08/E-09/E-10 `/documents` |
| 原型（Document:PROTOTYPE） | `workspace/02_UX_DESIGN/wireframes/` | E-11/E-12 `/prototype`、`/preview` |
| Sprint | `plans.json` + sprint-plan.md | E-15/E-16 `/plans/sprints` |
| ModificationIntent | `fix-intents/*.json` | E-17/E-18/E-19/E-20 `/fix-intents`、`/tasks` |
| Snapshot | `snapshots/` | E-21/E-22 `/snapshots` |
| JudgeVerdict | `judgments/*.json` | E-23/E-24 `/judgments` |
| TestReport | `test-reports/*.json` | E-25/E-26 `/test-reports` |
| TraceEvent | `trace/*.jsonl` | E-27/E-28 `/telemetry` |
| Template | `templates/*.json` | E-29/E-30 `/templates` |
| AgentRole / TeamConfig | `roles/`、`team-config.json` | —（后台内部，无用户端点） |
| GwtScenario | `06_TESTS/features/` + `gwt-index.json` | 经 E-25/E-26 间接暴露 |

## 5. 数据保留与脱敏（NFR-01 / NFR-02）

| 规则 | 落点 |
|------|------|
| 用户项目数据默认保存 30 天，可手动删除 | 清理策略扫描 `projects/` 的 `updatedAt`；设置页（P5）提供删除入口 |
| 科研导出必须脱敏、不含真实业务 payload | `TelemetryCollector.anonymize()`：丢弃 `userInput`/`guideReply` 原文，仅保留类别、计数、耗时、阶段；`research/export/` 与项目目录物理分离 |
| 数据存于本地的说明 | P0/P5「本地安心位」文案：「你的内容保存在你自己的电脑上。」（`sitemap.md` §6） |

> 文档结束。与 `architecture.md`（§4 模块）、`class-diagram.puml`（类与字段）、`04_API_SPEC/api-spec.md`（资源与端点）三方一致。
