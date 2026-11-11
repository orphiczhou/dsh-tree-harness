# W3 设计:子会话配置可观测性(A)+可控性(B)分层改进方案

输入依据(全部为本文仓库/宿主源码实证,非空谈):

- **w1** = `demo/agspec/w1-evidence.md`(子会话内实测:env/文件/工具面三渠道取证)
- **w2** = `demo/agspec/w2-source.md`(宿主 app.asar 源码盘点,含 `SubagentStartRequest`/`AgentOptions`/`ContinuableStartSpec` 原始摘录)
- **engine** = `packages/dsh-tree-engine/src/engine.js`;**spec** = `docs/architecture/engine-spec.md`

---

## 1. 一次性 vs 可续会话差异的本质分析

### 1.1 结构性差异(源码事实)

w2 §3 引 `dsh-subagent/lib/typert.host.js:347` 的 `ContinuableStartSpec`:continuable 有 `childId`(可指定稳定 id)、强制 sessionPersistence(`lib/index.js:1986-1989` 否则 `PERSISTENCE_UNAVAILABLE`)、冷恢复(descriptor 驱动,`lib/index.js:1898-1940`)、Agent inbox 轮队列(`lib/index.js:1583-1587`)、send_message 回报指引(`lib/index.js:599-604`)。one-shot 是 `drivePublishedRun` 单次 followup + quiescent dispose(`dsh-subagent-in-process-driver/lib/index.js:195-229`)。

### 1.2 本质:哪些能力**先天只属于可续会话**

判据只有一条:**该会话是否还拥有"未来的输入通道"**。

| 能力 | continuable | one-shot | 为什么 |
|---|---|---|---|
| 事后接收新消息(prompt 中转) | ✅ inbox 轮队列 + send_message(w2 §3 表"回报指引"行) | ❌ quiescent dispose 后无 inbox | 输入通道是 inbox;one-shot dispose 即拆除 |
| 被"软改道"(下一条消息改变行为) | ✅ 消息内可携带"改用工具 X/换输出风格/换子路由"指令 | ❌ 同上 | 软改道 = 消息 + 模型自愿遵从 |
| 结算通知回父(异步结果回流) | ✅ `dsh-tool-subagent/lib/index.js:525-533` 结算通知 | 部分(前台 await / job 一次性回调) | 持久 Session 才有"完成时刻"事件 |
| 身份跨轮稳定(childId) | ✅ spec.childId 可指定 | ❌ 随机 UUID(driver `lib/index.js:166`) | 树引擎 cancel+重派依赖可寻址性,而重派本身是**新建会话**,故此项非本质差异(见 1.4) |

### 1.3 两者都无:**事后修改已生效的请求 = 物理不可能**

对**任何**已启动的子会话(无论 one-shot 还是 continuable):

1. `agentOptions` 在启动时经 `resolveChildAgentOptions`(`dsh-subagent/lib/index.js:436-452`)一次性解析,之后由 `dsh-agent-loop/lib/index.js:1171-1176` 写入**每个请求头**。请求发出即生效;改它需要改 LLM 请求头,而请求头只由 AgentOptions 派生,AgentOptions 只在 start/冷恢复时设置——不存在运行中 setter(grep 无证据,w2 §4.4 同法可复核)。
2. `toolFilter` 经 `childCtx.tools.restrict`(`dsh-subagent/lib/index.js:522`)在 childCtx 构建时一次性收窄;运行中无 un-restrict API。
3. `persona` 是启动时系统提示段(`lib/index.js:517-521`);系统提示已拼接进历史,不可追溯修改。
4. 权限更甚:连启动请求都没有该字段(w2 §4.2,`SubagentStartRequest` 无 permission/sandbox),由父状态经 `captureDelegatedPolicyOverrides`(`lib/index.js:535-562`)隐式继承且 approval 钉死 `'never'`;本会话运行时注入也自证 "permission scope was fixed when you were started and cannot be widened"(w1 实验 4 附加证据)。
5. 温度:宿主根本没有通路(w2 §4.1,`dsh-agent-loop` 只处理 reasoningEffort/maxTokens),谈不上运行中改。

因此"运行中修改"的正确分类是:
- **改已生效请求** → 两者皆物理不可能,唯一出路是**换会话**(cancel + 带 assignee 重派,即新请求)。
- **改未生效的后续行为**(下一轮用什么策略、注意什么)→ 仅 continuable 可做(prompt 中转"软改道")。

### 1.4 与树引擎的关系

树引擎的节点↔会话是一对多(`runtime.history`、`segmentChain`,engine.js:412/473),所以树引擎天然具备"换会话"原语——这是它比裸 subagent 工具多出的可控性来源。

---

## 2. 三层方案设计

### 层 ① 派发端注入(prompt 自描述块)— 解决 A(可观测性)

**作用层:树引擎(立即)+ 可选插件渲染。依赖:无宿主改动。**

做法:`tree_dispatch`/`tree_node add` 的 prompt 在引擎侧(或 ports.dispatch 适配器)追加一段自描述块,例如:

```
<session-config-declared>
role/taskType: research | label: agspec/agspec-W3-design
assignee: {provider: zai-coding-cn, model: glm-5.3, effort: default}  (未指定字段=由树引擎/宿主默认解析)
注意:声明值是"派发意图",运行时真实生效值可能因宿主 resolveChildAgentOptions 爖0-w2§1.4 而不同;
真实值请用层②查询确认。
</session-config-declared>
```

- 引擎现状依据:engine.js:405-409 `ports.dispatch({... assignee: spec?.assignee ...})` 已透传 assignee;但 `leaf.model` 等未渲染进 prompt,且 w1 实验 3 证实 tree-state.json 里 `"model": "unknown"` 未填——即引擎自己都没把意图记录完整。第一步应先在 dispatch 时把 `spec.assignee` 持久化到 leaf(消除 unknown),再渲染进 prompt。
- 权限/作用域:prompt 注入 "cwd=…、parent session=…、权限继承自父且 approval=never"(与 w1 实验 4 的运行时注入互为印证;注意这不是新权限,只是把已有事实写进对话上下文)。
- 局限(必须如实声明):这是**声明值**不是**生效值**。`resolveChildAgentOptions` 会先取父路由再被 per-request 覆盖(w2 §1.4 表 agentOptions 行),若引擎传的 assignee 在宿主侧被 agentPreset/父覆盖,声明即失真。温度层①根本无法声明(宿主无配置点,w2 §4.1)。

### 层 ② 会话内自检工具(查询生效配置)— 解决 A

**插件能做的(依赖:文件系统读权限):**

一个工具插件(或 cordis_inspect provider)暴露 `session-config` 查询方法,读 `~\.dsh\storages\session_projcache\sessions\<DSH_SESSION_ID>.json`,返回 w1 实验 3 已证实的字段:
- `modelSelection.lastUsed`(模型,事后值)
- `subagentModelSelectionPolicy`(可切换路由表)
- `permissions{preset,sandbox,approval}` + `sandboxMode`(权限)
- `identity.cwd`、`subagent.identity.label`、`agentTeam.id`(作用域)
- 附带 `tokenUsage`/`contextPressure`(上下文水位)

插件层**做不到**的:
- reasoningEffort/温度:文件里根本没有(w1:projcache grep `effort|reasoning` 仅命中任务提示词文本;温度全渠道缺失)——无源可读。
- 请求级真实 agentOptions 回显:生效值在 `dsh-agent-loop` 请求头层面(w2 §2.2),不落 projcache,插件只能给 lastUsed 事后近似。

**必须宿主做的(依赖:DSH 宿主改码):**

- cordis inspect provider 增加 `session-config` 方法,回显**本会话请求级**真实值:resolved agentOptions{provider,model,reasoningEffort,maxTokens}、toolFilter、persona 摘要、descriptor 快照(w2 §1.4 表 descriptor 行:这些在宿主 `subagent/descriptor` 事件里**已经持久化**,只差暴露成只读查询——成本极低)。w1 实验 4 证明 inspect provider 机制可用(probe 报 "not registered" 说明查询路由存在)。
- 温度:宿主先把 temperature 接入 subagent 链路(w2 §4.1:GenerateOptions 有字段、agent-loop 无通路),否则任何层都无法观测一个不存在的旋钮。

### 层 ③ 运行中改道 — 解决 B(可控性)

**continuable 会话:prompt 中转"软改道"(树引擎/父会话立即可用,依赖 send_message)。**
向子会话发消息:"后续推理请…… / 本节点剩余工作改用工具 X / 请在结论中按 schema 输出"。能改:行为策略、工具选择偏好、输出形态、(配合层②路由表 + 宿主 modelSelectionSettings)模型自主切换建议。不能改:请求头 reasoningEffort/maxTokens、toolFilter、persona、权限、温度(1.3 节物理不可能清单)。

**硬改道:树引擎 cancel + 带 assignee 重派(树引擎已有,需补 assignee 持久化)。**
`dispatchCancel`(engine.js:430-442)+ 再次 `dispatch{assignee}`(engine.js:405-410)。代价:上下文清零(靠 handoffBrief 携带简报)。**已知缺陷**:竹节接力 `bambooRelay` 在 engine.js:468 只恢复 `leaf.model ? {model} : undefined`——丢失 provider 与 effort,即运行中自动接力会静默降级路由。修复:dispatch 时把完整 assignee{provider,model,effort} 存 leaf,bambooRelay 原样透传。这是层③最重要的一处引擎级修复。

**一次性会话为什么做不了:**
- 软改道:one-shot `drivePublishedRun` 单次 followup + quiescent dispose(w2 §3 表),无 inbox、无 send_message 通道;它的唯一"输入"是启动 prompt,而启动 prompt 在启动前就已定稿。
- 硬改道"原地重启"也不存在:cancel 后旧会话已 dispose,引擎只能重派新会话——但**新会话可以换 one-shot 为 continuable**,即对一次性任务的可控性上限就是"改派",不是"修改"。

---

## 3. 覆盖矩阵(层 × w1 缺失项)

| w1 缺失项 | 层① 派发注入 | 层② 自检工具 | 层③ 运行中改道 | 最终可达状态 |
|---|---|---|---|---|
| 模型 | ✅ 声明值(assignee.model 持久化后) | ✅ 插件:lastUsed 事后值;✅✅ 宿主:descriptor 真实值 | ✅ 硬改道 cancel+重派;软改道建议切换 | 全可观测+可控 |
| 思考深度 effort | ✅ 声明值 | ❌ 插件(无源);✅✅ 宿主(descriptor/请求头回显) | ✅ 仅硬改道(换会话重派);软改道改不了请求头 | 可观测(宿主做);可控仅换会话 |
| 温度 | ❌ 无配置点可声明 | ❌ 无源可读 | ❌ 宿主未接入 subagent 链路 | **三层全不覆盖——前置依赖:宿主先在 AgentOptions/agent-loop 增加 temperature 通路(w2 §4.1)** |
| 权限 | ✅ 声明继承事实(approval=never 等) | ✅ 插件即可(projcache `permissions`/`sandboxMode`,w1 实验 3) | ❌ 物理不可改(1.3-4;scope fixed at start) | 可观测✅;可控✗(by design) |
| 作用域(cwd/session/parent/toolFilter) | ✅(parent id、cwd、toolFilter 声明) | ✅ 插件(identity/subagent.identity/agentTeam);toolFilter 真实值需宿主(仅行为可感,w2 §2.2) | 部分:toolFilter 不可运行中改;parent/label 不可改;行为性作用域可软改道 | 基本全可观测;toolFilter 可控仅重派 |

矩阵显示的三个硬边界:温度是"宿主无旋钮"问题,层①②③都无法独立解决;权限是"有意的安全设计"(delegation scope 固定),不应"解决"其可控性;思考深度的可控性只有换会话一条路。

---

## 4. 落地优先级建议

1. **引擎立即**:dispatch 持久化完整 assignee 到 leaf + prompt 渲染自描述块 + 修 engine.js:468 竹节丢 provider/effort 缺陷(层①③,纯本仓库)。
2. **插件短期**:projcache 读取型 session-config inspect provider(层②,覆盖模型 lastUsed/权限/作用域)。
3. **宿主中期**:descriptor 暴露为 inspect session-config(真实 agentOptions/toolFilter/persona);温度通路接入为独立前置项。
