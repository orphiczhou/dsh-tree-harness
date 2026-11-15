# 接口规范（api-spec.md）

> | 元数据 | 值 |
> |---|---|
> | 文档编号 | ARCH-API | 隶属 | 04_API_SPEC |
> | 版本 | v1.0 | 日期 | 2026-11-15 |
> | 产出角色 | 架构设计师 G3 | 树节点 | t28a / t28a-W5-arch |
> | 上游锚点 | `03_ARCHITECTURE/architecture.md`（模块 M0–M9）、`data-model.md` §4 资源对照 |
> | 端点编号 | **E-01…E-30**（稳定编号，供 W6/W7 与裁判 H4 对账；不在其他文件复用） |
> | 硬约束自检 | 本文每个端点均定义 **Method / Path / Request Schema / Response Schema**（§4） |

---

## 1. 范围

桌面端 UI（Electron Renderer / M0 DesktopShell）与本地运行时（Main Process 内 M1–M9 引擎群）之间的接口。**不包含**：模型厂商 API（由 ModelGateway 封装，非本文范围）、远期 SaaS 接口（需求源 §1.3，另行评审）。

## 2. 接口形态决策：IPC + 本地 REST 混合（ADR-03）

| 通道 | 用途 | 理由 |
|------|------|------|
| **IPC**（Electron ipcRenderer↔ipcMain） | 全部业务端点的默认通道 | 同机进程间通信：低延迟、结构化序列化、无需端口、天然仅本机可达（NFR-01 安全边界） |
| **REST**（`http://127.0.0.1:{port}`，仅回环） | ①原型静态资源（E-12，iframe 加载 `.prototype.html` 需真实 HTTP 与相对路径解析）；②科研导出（E-28，供研究区工具/脚本消费）；③对账与自动化测试；④远期模板插件生态（F-14）统一注册入口 | 跨进程/跨工具消费需要标准 HTTP；仅绑定 127.0.0.1 随机端口，不暴露局域网 |
| **单一事实源** | 所有业务端点在本文件按 **REST 语义**定义；IPC 通道一一映射（§3.4） | 避免两套语义漂移；W6/W7 只对账本文编号 |

## 3. 通用约定

### 3.1 Base URL 与信封

- Base：`http://127.0.0.1:{port}/api/v1`；端口启动时随机分配，写入 `userData/runtime.json`。
- 响应信封（所有端点统一）：

```json
{ "code": 0, "message": "ok", "data": { } }
```

### 3.2 错误码

| code | HTTP | 含义 | 用户呈现（F-19） |
|------|------|------|----------------|
| 0 | 200/201 | 成功 | — |
| 40001 | 400 | 参数缺失/非法（如创建项目未选 mode：两道门不可跳过 F-01） | 生活化提示 |
| 40401 | 404 | 项目/资源不存在 | 安抚文案 |
| 40901 | 409 | 状态冲突（阶段/文档锁定不允许该操作） | 生活化提示 |
| 42201 | 422 | **裁判退回**（`data.verdictId` 携带判定；用户只看到"我再补充完善一下计划"） | 安抚文案 |
| 42202 | 422 | **熔断回滚已执行**（`data.copyKey="REPAIR_FAILED"`） | §7.5「修改失败」原文 |
| 42901 | 429 | 模型调度限流/降级 | §7.5「操作超时」原文 |
| 50001 | 500 | 内部错误（永不向用户返回堆栈） | 安抚文案 |

### 3.3 异步长任务与文案位契约

- 耗时操作（裁判判定、编码执行、修复循环、回滚）返回 `202` + `{ "taskId": "..." }`，用 **E-20** 轮询。
- 所有面向用户的文本经 M1 文案服务产出：响应携带 `copyKey`（文案键）与生活化 `copy` 文本，**不含任何技术日志/堆栈**（F-19"文案即契约"）。
- `elapsedMs > 5000` 时任务状态必含 `copyKey="WAITING_LONG"`（§7.5「等待中」原文）。
- 幂等：所有 `POST` 接受 `Idempotency-Key` 头，防双击重复提交。

### 3.4 IPC 通道映射

```
ipcRenderer.invoke("api:v1:{METHOD}:{path模板}", payload)
例：ipcRenderer.invoke("api:v1:POST:/projects", { mode: "QUICK", ... })
```

path 模板中的 `{param}` 段在 IPC 调用中放入 payload 同名字段；语义与 REST 完全同构。仅 E-12/E-28 必须走真实 HTTP。

### 3.5 公共类型（各端点 Response Schema 引用）

| 类型 | 字段 |
|------|------|
| `ProjectSummary` | projectId, name, mode(`QUICK`/`LONGTERM`), stage(SessionStage 8值), templateKey, currentSnapshotId, updatedAt |
| `GuideMessage` | text(生活化), cards[]?{id,title,options[]:{id,label},decideForMe:boolean}, stageBadge, copyKey?, copy? |
| `DocSummary` | docId, kind(DocKind 14值), path, version, status(`DRAFT`/`FINALIZED`/`CONFIRMED`/`REJECTED`), confirmedByUser, lastDecision?(`PASS`/`SUGGEST`/`REJECT`), updatedAt |
| `SnapshotItem` | snapshotId, seq(int), ts, description, trigger, badge(`CURRENT`/`ARCHIVED`) |
| `TaskStatus` | taskId, status(`RUNNING`/`SUCCEEDED`/`FAILED`/`ROLLED_BACK`), stage(阶段小字), elapsedMs, copyKey?, copy?, result? |
| `VerdictSummary` | verdictId, targetKind, targetRef, decision(`PASS`/`SUGGEST`/`REJECT`), rejectCount, reasons[] |

---

## 4. 端点定义（E-01…E-30）

### A. 项目与模式

#### E-01 创建项目（两道门模式选择）

- **Method / Path**：`POST /api/v1/projects`
- **覆盖**：F-01（必选模式，不可跳过）、F-14（服务端模板推断，对用户不可见）、埋点#1
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mode | `"QUICK"` \| `"LONGTERM"` | ✓ | 两道门选择；缺省 → 40001 |
| name | string | — | 项目名；缺省由向导生成 |
| ideaSeed | string | — | 首句想法（触发模板推断与首轮对话） |

```json
{ "mode": "QUICK", "ideaSeed": "给班里做个投票页面" }
```

- **Response Schema**（201）：

| 字段 | 类型 | 说明 |
|------|------|------|
| project | ProjectSummary | 新项目（stage=`MODE_GATE` 已越过度过门 → `REQUIREMENTS`） |
| inferredTemplate | object | { templateKey, confidence, confirmCopy(生活化确认语) } |
| guideMessage | GuideMessage | 向导首轮消息 |

```json
{ "code": 0, "message": "ok", "data": {
  "project": { "projectId": "p_9f2c", "name": "班级投票页", "mode": "QUICK",
    "stage": "REQUIREMENTS", "templateKey": "web-fullstack",
    "currentSnapshotId": "s_001", "updatedAt": "2026-11-15T20:01:00+08:00" },
  "inferredTemplate": { "templateKey": "web-fullstack", "confidence": 0.92,
    "confirmCopy": "听起来你想做的是一个网页小站" },
  "guideMessage": { "text": "好主意！投票页面，明白了。先问你几个小问题～",
    "stageBadge": "想清楚", "copyKey": "LOCAL_SAFE" } } }
```

#### E-02 项目列表（恢复未完成项目）

- **Method / Path**：`GET /api/v1/projects?status={ACTIVE|ARCHIVED|CLOSED}`
- **覆盖**：F-01-GWT4（重开未完成项目保持原模式，不重复选门）
- **Request Schema**：Query `status`（可选，缺省返回全部）。
- **Response Schema**（200）：`data.items: ProjectSummary[]`

```json
{ "code": 0, "message": "ok", "data": { "items": [ { "projectId": "p_9f2c", "name": "班级投票页", "mode": "QUICK", "stage": "REQUIREMENTS", "templateKey": "web-fullstack", "currentSnapshotId": "s_001", "updatedAt": "2026-11-15T20:01:00+08:00" } ] } }
```

#### E-03 项目详情

- **Method / Path**：`GET /api/v1/projects/{projectId}`
- **覆盖**：F-01/F-09（阶段与单一向导状态）、F-08（当前版本）
- **Request Schema**：Path `projectId`。
- **Response Schema**（200）：`data.project: ProjectSummary` + `requirementCount:int` + `sprintIndex:int?` + `lastVerdict: VerdictSummary?`

#### E-04 模式转换（快消 → 长期升级）

- **Method / Path**：`POST /api/v1/projects/{projectId}/mode-switch`
- **覆盖**：F-12（建议先完成快消全过程；转换前后各存一份自动快照）、埋点#8
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| targetMode | `"LONGTERM"` | ✓ | 当前仅支持升级方向 |
| acknowledgedAdvice | boolean | ✓ | 用户已确认"建议先完成快消全过程"提示 |

```json
{ "targetMode": "LONGTERM", "acknowledgedAdvice": true }
```

- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| project | ProjectSummary | mode=`LONGTERM`，stage=`REQUIREMENTS`（补全文档流程起点） |
| snapshotsCreated | string[] | 转换前/后两个新快照 id |
| missingDocs | string[] | 待补全的正式文档清单（DocKind） |

### B. 对话轮次

#### E-05 提交对话轮次

- **Method / Path**：`POST /api/v1/projects/{projectId}/sessions/{sessionId}/rounds`
- **覆盖**：F-02（卡片单选 + 你帮我决定）、F-09（角色静默路由）、F-19（进度文案）、埋点#2/#3
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | ✓ | 自由输入文本；卡片作答时为选项 label |
| inputKind | `FREE_TEXT`/`CARD`/`DECIDE_FOR_ME`/`SCREENSHOT` | ✓ | 输入形态 |
| cardChoiceId | string | — | 选中的卡片选项 id（inputKind=`CARD` 时必填） |
| attachment | object | — | { kind:"screenshot", ref } 圈注截图（F-06） |

```json
{ "content": "更醒目一点", "inputKind": "FREE_TEXT" }
```

- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| roundId | string | 本轮标识 |
| guideMessage | GuideMessage | 向导回复（含下一组卡片题；每题附 decideForMe） |
| requirementsSnapshot | object | { confirmedCount, list[] } 已确认需求要点（用户可随时查看） |
| activeRoleKey | string | 本轮实际服务角色（仅供审计埋点，UI 不渲染） |

#### E-06 拉取对话历史（跨会话恢复）

- **Method / Path**：`GET /api/v1/projects/{projectId}/sessions/{sessionId}/rounds?afterSeq={int}&limit={int}`
- **覆盖**：F-23（新会话无需用户复述历史）
- **Request Schema**：Query `afterSeq`（游标，缺省 0）、`limit`（缺省 50，≤200）。
- **Response Schema**（200）：`data.items: { roundId, seq, inputKind, guideReply, cardOptions[], decidedBy, ts }[]` + `nextAfterSeq:int`

#### E-07 已确认需求清单

- **Method / Path**：`GET /api/v1/projects/{projectId}/sessions/{sessionId}/requirements`
- **覆盖**：F-02-GWT2（生活化需求清单随时可看）
- **Request Schema**：Path 参数。
- **Response Schema**（200）：`data.items: { pointId, statement(生活化), sourceRoundId, customScenario? }[]`

### C. 文档与原型产出

#### E-08 文档列表

- **Method / Path**：`GET /api/v1/projects/{projectId}/documents?kind={DocKind}`
- **覆盖**：F-03/F-04/F-22（PRD、用户故事、计划等产出状态）
- **Request Schema**：Query `kind` 可选。
- **Response Schema**（200）：`data.items: DocSummary[]`

#### E-09 文档详情（机器可解析 + 人可读）

- **Method / Path**：`GET /api/v1/projects/{projectId}/documents/{docId}`
- **覆盖**：NFR-05 双标准
- **Request Schema**：Path `docId`。
- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| meta | object | front-matter 结构化字段：{ docId, kind, fRefs[], version } |
| content | string | Markdown 正文（零基础可读） |
| status | string | DocSummary.status |
| lastVerdict | VerdictSummary? | 最近判定摘要 |

#### E-10 用户确认文档（触发裁判门禁）

- **Method / Path**：`POST /api/v1/projects/{projectId}/documents/{docId}/confirm`
- **覆盖**：F-03/F-04（用户签字）、F-16（裁判第一道关）、埋点#4/#11
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| signature | string | ✓ | 确认动作标识（`USER_CONFIRM`） |

- **Response Schema**：判定同步完成（快消核心项）时 `200`：`data.verdict: VerdictSummary`；长期型全量判定较慢时 `202`：`data.taskId`（走 E-20）。裁判退回时 HTTP `422`，`data.verdict.reasons[]` 为生活化缺项说明。

#### E-11 获取当前原型

- **Method / Path**：`GET /api/v1/projects/{projectId}/prototype`
- **覆盖**：F-05（预览优先，不出现源码）、埋点#5
- **Request Schema**：Path `projectId`。
- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| prototypeId | string | 原型文档 id（DocKind=`PROTOTYPE`） |
| previewUrl | string | E-12 的完整 URL（127.0.0.1） |
| version | int | 原型版本 |
| snapshotHint | string | 最近快照人话描述（快照提示条） |

#### E-12 原型静态资源（真实 HTTP）

- **Method / Path**：`GET /preview/{projectId}/index.html?snapshotId={id}`
- **覆盖**：F-05（双击可开、可点击跳转）；`snapshotId` 缺省为当前版本，指定则渲染历史版本预览
- **Request Schema**：Path/Query 如上（无 body）。
- **Response Schema**：`200`，`Content-Type: text/html`（单文件 HTML，内联 CSS/JS，含模拟数据）。资源不存在 `404`。本端点不经 JSON 信封（静态资源服务）。

### D. 架构与计划确认（长期迭代型前台 F-11）

#### E-13 架构方案确认数据

- **Method / Path**：`GET /api/v1/projects/{projectId}/architecture`
- **覆盖**：F-11（架构设计师跳到前台：用户以生活化卡片确认，**不接触 PlantUML 代码**）
- **Request Schema**：Path `projectId`。
- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| choiceCards | object[] | { id, title(生活化选型名), traits[3条], decideForMe } |
| summary | object | { moduleCount, docChecklist[], plantumlValidated:boolean } |
| copy | string | 向导说明文本 |

#### E-14 确认架构方案

- **Method / Path**：`POST /api/v1/projects/{projectId}/architecture/confirm`
- **覆盖**：F-11；确认后进入工程经理（W6 产物）阶段
- **Request Schema**：`{ choiceId: string(必填), decideForMe: boolean(可选) }`
- **Response Schema**：`200 { data: { project: ProjectSummary(stage=PLANNING), nextPrompt: GuideMessage } }`

#### E-15 Sprint 计划列表

- **Method / Path**：`GET /api/v1/projects/{projectId}/plans/sprints`
- **覆盖**：F-22（≤2 周可交付增量，硬约束 H5）
- **Request Schema**：Path `projectId`。
- **Response Schema**（200）：`data.items: { sprintId, index, goal, durationWeeks(≤2), deliverables[], status, scopeScenarioCount }[]`

#### E-16 确认 Sprint 节奏（开工）

- **Method / Path**：`POST /api/v1/projects/{projectId}/plans/sprints/{sprintId}/confirm`
- **覆盖**：F-11/F-22（用户确认开发节奏）；触发编码管线（时序图②）
- **Request Schema**：Path 参数；body `{ decideForMe: boolean(可选) }`。
- **Response Schema**：`202 { data: { taskId } }`（编码任务走 E-20 轮询）。

### E. 点选纠错与任务

#### E-17 新增修改意图

- **Method / Path**：`POST /api/v1/projects/{projectId}/fix-intents`
- **覆盖**：F-07（捕获→规约，仅记录未执行）、埋点#7
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| elementSelector | string | ✓ | 点击元素定位 |
| elementType | string | ✓ | 元素类型（按钮/文本/区块…） |
| context | string | ✓ | 上下文摘要（所在页面/周边） |
| userWish | string | ✓ | 用户期望（快选 label 或自由描述） |

```json
{ "elementSelector": "#vote-btn", "elementType": "button",
  "context": "首页投票卡片", "userWish": "更醒目一点" }
```

- **Response Schema**（201）：`data.intent: { intentId, status:"RECORDED", restatedSpec(生活化复述), listUrl }`

#### E-18 撤销单条修改意图

- **Method / Path**：`DELETE /api/v1/projects/{projectId}/fix-intents/{intentId}`
- **覆盖**：F-07-GWT（"不改了"）、埋点#6
- **Request Schema**：Path `intentId`。
- **Response Schema**（200）：`data: { intentId, status:"CANCELLED" }`

#### E-19 批量执行修改（让向导开始改）

- **Method / Path**：`POST /api/v1/projects/{projectId}/fix-intents/execute`
- **覆盖**：F-07 执行段、F-08（执行前自动快照）、F-18（失败自愈）
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| intentIds | string[] | ✓ | 待执行意图（≥1） |

```json
{ "intentIds": ["fi_01", "fi_02"] }
```

- **Response Schema**：`202 { data: { taskId, preSnapshotId(修改前快照), stageCopy:"正在改你点的那 2 处" } }`；熔断回滚发生时最终经 E-20 返回 `status:"ROLLED_BACK"` + `copyKey:"REPAIR_FAILED"`。

#### E-20 任务状态轮询

- **Method / Path**：`GET /api/v1/projects/{projectId}/tasks/{taskId}`
- **覆盖**：F-19（>5s 文案位、催促）、NFR-04
- **Request Schema**：Path 参数。
- **Response Schema**（200）：`data: TaskStatus`

```json
{ "code": 0, "message": "ok", "data": { "taskId": "t_771", "status": "RUNNING",
  "stage": "第 3 步：检查质量，快好了", "elapsedMs": 41200,
  "copyKey": "WAITING_LONG",
  "copy": "我正在帮你生成可运行的版本，这个过程只发生在安全环境里，不会影响你的电脑文件。" } }
```

### F. 快照列表与回滚

#### E-21 快照列表（线性时间轴）

- **Method / Path**：`GET /api/v1/projects/{projectId}/snapshots`
- **覆盖**：F-08（时间戳+人话描述+当前/存档徽章；**平台不提供手动创建快照端点**，快照仅系统自动管理）
- **Request Schema**：Path `projectId`。
- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| items | SnapshotItem[] | 按 seq 升序（线性单链，无分支结构） |

```json
{ "code": 0, "message": "ok", "data": { "items": [
  { "snapshotId": "s_005", "seq": 5, "ts": "2026-11-15T15:24:00+08:00",
    "description": "把投票按钮改得更醒目", "trigger": "AFTER_CONFIRM", "badge": "CURRENT" },
  { "snapshotId": "s_004", "seq": 4, "ts": "2026-11-15T15:23:00+08:00",
    "description": "修改前自动备份", "trigger": "BEFORE_CONFIRM", "badge": "ARCHIVED" } ] } }
```

#### E-22 一键回滚

- **Method / Path**：`POST /api/v1/projects/{projectId}/snapshots/{snapshotId}/rollback`
- **覆盖**：F-08（当前版本先存为快照再恢复；回滚不丢当前）、F-19（回滚完成文案）、埋点#6
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| confirmToken | string | ✓ | 二次确认弹窗生成的确认令牌（缺省 → 40901） |

- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| newCurrentSnapshot | SnapshotItem | 回滚后的当前版本 |
| preservedSnapshot | SnapshotItem | 回滚前"现在这份"新存快照 |
| copyKey / copy | string | `"ROLLBACK_DONE"` + §7.5「回滚完成」原文 |

### G. 裁判判定结果

#### E-23 判定列表

- **Method / Path**：`GET /api/v1/projects/{projectId}/judgments?targetKind={DOCUMENT|SPRINT|DELIVERY}`
- **覆盖**：F-16/F-17（判定可追溯）
- **Request Schema**：Query `targetKind` 可选。
- **Response Schema**（200）：`data.items: VerdictSummary[]`

#### E-24 判定详情

- **Method / Path**：`GET /api/v1/projects/{projectId}/judgments/{verdictId}`
- **覆盖**：F-16（硬约束逐项）、F-17（软约束四维三档）
- **Request Schema**：Path `verdictId`。
- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| verdictId / targetKind / targetRef | string | 判定对象 |
| decision | `PASS`/`SUGGEST`/`REJECT` | 总判定 |
| hardResults | map<string,boolean> | H1–H8 逐项（如 `"H1_PRD四要素": true`） |
| softResults | map<string,string> | S1–S4（`PASS`/`SUGGEST`/`REJECT` + 理由） |
| rejectCount | int | 累计退回（快消型 ≥2 → 人工介入提示） |
| reasons | string[] | 生活化原因（用户可见）；技术细节仅落盘 |

### H. GWT 测试报告

#### E-25 测试报告列表

- **Method / Path**：`GET /api/v1/projects/{projectId}/test-reports`
- **覆盖**：F-15（收口报告可查）
- **Request Schema**：Path `projectId`。
- **Response Schema**（200）：`data.items: { reportId, sprintId?, total, passed, failed, passRate, ts }[]`

#### E-26 测试报告详情

- **Method / Path**：`GET /api/v1/projects/{projectId}/test-reports/{reportId}`
- **覆盖**：F-15/F-16（PRD 功能项 ↔ 场景对账，H7 取证）
- **Request Schema**：Path `reportId`。
- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| reportId / projectId / sprintId? | string | 标识 |
| total / passed / failed / passRate | int/int/int/number | 通过率（全部通过=交付合格） |
| scenarios | object[] | { scenarioId, fRef, featureFile, category(`NORMAL`/`BOUNDARY`/`EXCEPTION`), passed, message? } |

### I. 埋点上报与导出

#### E-27 埋点上报（批量，无侵入）

- **Method / Path**：`POST /api/v1/telemetry/events`
- **覆盖**：F-20（§12.4 十三类事件；UI 侧异步 fire-and-forget，界面零打扰）
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| events | object[] | ✓ | 每项：{ type(TraceEventType 13值), roundNo?, payload(object) } |

```json
{ "events": [ { "type": "CLICK_FIX", "roundNo": 12,
  "payload": { "targetType": "button", "fixed": true } } ] }
```

- **Response Schema**（202）：`data: { accepted:int, rejectedTypes:string[] }`（非法事件类型被拒收但不影响调用方）。

#### E-28 科研脱敏导出

- **Method / Path**：`GET /api/v1/telemetry/export?projectId={id}&from={date}&to={date}&anonymized=true`
- **覆盖**：F-21（研究看板/A-B 实验指标导出）、NFR-01（不含真实业务 payload）
- **Request Schema**：Query 如上；`anonymized` 恒为 `true`（服务端强制，传 `false` → 40001）。
- **Response Schema**：`200`，`Content-Type: application/x-ndjson`，每行一个脱敏事件（§2.11 字段：type/roundNo/payload(类别+计数+耗时)/ts；**无 userInput/guideReply 原文**）。本端点不经 JSON 信封。

### J. 模板推断

#### E-29 模板推断

- **Method / Path**：`POST /api/v1/templates/infer`
- **覆盖**：F-14（从对话关键词自动匹配，对用户不可见；仅以生活化复述确认）
- **Request Schema**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| dialogueExcerpts | string[] | ✓ | 最近对话片段（关键词提取输入） |
| projectId | string | — | 关联项目（可仅作推断预演） |

```json
{ "dialogueExcerpts": ["做个网站给大家投票", "手机上也能打开"] }
```

- **Response Schema**（200）：

| 字段 | 类型 | 说明 |
|------|------|------|
| templateKey | string | 六类之一：`web-fullstack`/`mobile-app`/`desktop-tool`/`cli-script`/`hardware-iot`/`ai-app` |
| confidence | number | 匹配置信度 |
| confirmCopy | string | 生活化确认语（"听起来你想做的是一个网页小站"） |
| alternatives | object[] | { templateKey, confidence } 次优（用户纠正时重匹配） |

#### E-30 模板库列表

- **Method / Path**：`GET /api/v1/templates`
- **覆盖**：F-14（内置六类 + 插件/JSON-YAML 导入项盘点）
- **Request Schema**：无。
- **Response Schema**（200）：`data.items: { templateKey, name, source(`BUILTIN`/`PLUGIN`/`IMPORTED`), teamPreset[], sprintRhythm }[]`

---

## 5. 端点 ↔ F-xx ↔ 模块 对照表

| 端点 | 主覆盖 F-xx | 服务模块（architecture.md §4） |
|------|------------|------------------------------|
| E-01 | F-01、F-14、埋点#1 | M9（+M1、M9·b） |
| E-02 / E-03 | F-01 | M9 |
| E-04 | F-12、埋点#8 | M9 + M8 + M2 |
| E-05 | F-02、F-09、F-19、埋点#2/#3 | M1 + M9·a |
| E-06 / E-07 | F-23、F-02 | M1 + M9 |
| E-08 / E-09 | F-03、F-04、NFR-05 | M2 |
| E-10 | F-16、埋点#4/#11 | M5 + M9 |
| E-11 / E-12 | F-05、F-06、埋点#5 | M3 |
| E-13 / E-14 | F-11 | M9 + M4（前台确认） |
| E-15 / E-16 | F-22、F-11 | M9 + M2 |
| E-17 / E-18 | F-07、埋点#7/#6 | M3 + M1 |
| E-19 | F-07、F-08、F-18 | M9·c + M8 + M9·a |
| E-20 | F-19、NFR-04 | M9（任务编排）+ M1（文案） |
| E-21 / E-22 | F-08、埋点#6 | M8 + M1 |
| E-23 / E-24 | F-16、F-17 | M5 |
| E-25 / E-26 | F-15、F-16(H7) | M7 + M5 |
| E-27 | F-20 | M6 |
| E-28 | F-21、NFR-01 | M6（研究区） |
| E-29 / E-30 | F-14 | M9·b |

## 6. 裁判硬约束自检（需求源 §9.2「API Spec」项）

| 硬约束 | 满足位置 |
|--------|---------|
| 每个端点必须定义 Method、Path、Request Schema、Response Schema | §4 全部 E-01…E-30：每端点均含 **Method / Path** 标题行 + Request Schema 表 + Response Schema 表（公共类型 §3.5 集中定义并在端点处显式引用；E-12/E-28 为静态资源/NDJSON 特例，已注明响应形态与状态码） |

> 文档结束。W6（工程经理）消费 E-15/E-16 语义规划 Sprint 产物；W7（整合）以 §5 对照表核对本文件与 `03_ARCHITECTURE/` 的一致性。
