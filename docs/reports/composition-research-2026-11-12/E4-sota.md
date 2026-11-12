# E4 · 组合式 Agent 编排架构研究

**严格树形任务分解引擎 + 自由 DAG 流程引擎 + 会话图基础层，如何解耦成可组合、可递归嵌套的插件体系**

- 角色：SOTA 专家团 · E4（组合式 Agent 编排架构研究员）
- 日期：2026-11-12
- 方法：官方文档 / 源码 / issue + 论文 + 工程模式分析
- 证据标记：`[F]` 生产框架或官方文档事实；`[P]` 论文 / 实证结论；`[E]` 工程推断（本报告）

> **一句话结论**：不要把三者做成三个互相调用的引擎。正确形态是 **一个会话/事件底座 + 一个编排 ABI + N 个可递归的编排插件**；树引擎和 DAG 引擎都只是 `OrchestrationEngine` 的实现，任何插件都可以把另一个插件的一次运行当作自己的一个节点。递归嵌套不靠引擎互相 import，只靠内核的 `NodeRuntime.spawn()`。

---

## 0. 结论先行

### 0.1 五条判断

1. **组合的单位不是「图」，而是「一次有独立身份的 run」。** 子编排必须拿到新的 `run_id`、新的 `path`、新的 `checkpoint namespace`，而不是被父图 inline 展开。Temporal 的 child workflow、BPMN 的 callActivity、LangGraph 的 subgraph-as-node 都在不同程度上验证了这一点；Argo 的 `templateRef` 则是反例——它复用模板但不产生独立执行身份，因此不适合做「需要独立取消/独立恢复的运行时可递归嵌套」（Argo 自身支持模板递归，但仍在同一 Workflow 执行内）。[F]
2. **嵌套的第一原则是「换命名空间，不换执行器」。** 父引擎不应知道子引擎是树还是 DAG，只拿到一个 `RunHandle`；子引擎也不应知道父引擎是谁，只拿到一个 `RunScope`。LangGraph 的 `checkpoint_ns`、Microsoft Agent Framework 的 qualified port ID、Temporal 的独立 Event History 都是同一件事的不同实现。[F]
3. **预算 / 权限 / 取消只能「单调衰减」，不能每层重置。** Erlang 监督树明确警告：嵌套监督者的重启强度是**相乘**的（10 × 10 = 100 次），这是嵌套系统最容易被忽视的预算泄漏。[F] 所以 `child.budget ≤ parent.available`、`child.permissions ⊆ parent.permissions`、`child.deadline ≤ parent.deadline` 必须是内核不变量，而不是引擎自觉。
4. **持久化事实源只能有一个。** 会话事件日志（append-only）记录「谁在何时被谁创建/结束」；任务树 / DAG 是**投影**，不能反向拥有 session 生命周期。Airflow SubDAG 的教训正是：把嵌套单元做成「另一个可独立调度的 DAG」会带来双调度器、槽位占用和状态不一致，最终被移除，换成纯 UI 分组的 TaskGroup（[Astronomer](https://www.astronomer.io/docs/learn/2.x/subdags)、[AIP-34](https://cwiki.apache.org/confluence/pages/viewpage.action?pageId=148645525)）。[F]
5. **递归边界默认要小。** 论文 ADaPT 在「执行器失败才分解」的策略下，最大分解深度取 **3** 就拿到了显著收益（ALFWorld +28.3、WebShop +27、TextCraft +33 个百分点，[arXiv](https://arxiv.org/abs/2311.05772)）。[P] 工程上建议：LLM 自主分解 `max_depth=3`，引擎互嵌 `max_depth=4`，硬上限 8；没有「预算递减 + 绝对 deadline + 无进展检测」的递归不允许上线。

### 0.2 推荐形态

```text
┌──────────────────────────── L3 呈现层 ────────────────────────────┐
│ TopologyProjection（nodes / edges / groups / capabilities）        │
│ Inspector · Replay · Approvals · Cost view                        │
└───────────────────────────────▲───────────────────────────────────┘
                                │ 只读投影，不读引擎数据库
┌───────────────────────────────┴───────────────────────────────────┐
│ L1 编排内核（microkernel，薄）                                     │
│ EngineRegistry · Negotiation · ScopeFactory · BudgetLedger        │
│ CancelBroker · EventLog · ArtifactStore · NodeRuntime             │
└───────▲───────────────────────▲───────────────────────▲───────────┘
        │ 只依赖 contract        │ 只依赖 contract        │ 只依赖 contract
┌───────┴────────┐      ┌────────┴─────────┐      ┌───────┴──────────┐
│ tree engine    │      │ dag engine       │      │ external adapter │
│ 严格树 / DoD    │      │ 自由 DAG / join  │      │ Temporal / Argo  │
└───────▲────────┘      └────────▲─────────┘      └───────▲──────────┘
        │                        │                        │
        └──────────── L0 会话图 / 事件底座 ────────────────┘
             session lineage · append-only journal · context refs
```

### 0.3 三个最有价值模式 + 契约必备 + 最大风险

- **最有价值模式 1：子编排作为节点（Sub-orchestrator as a Node）**——子引擎是一次独立 run，父引擎只看见一个 handle。
- **最有价值模式 2：Scope 衰减（Attenuated RunScope）**——预算 / 权限 / deadline / 取消令牌随嵌套单调收紧。
- **最有价值模式 3：拓扑投影覆盖层（Topology Projection Overlay）**——UI 只消费统一投影，天然支持任意引擎嵌套。
- **契约必备**：`EngineDescriptor` + `negotiate`（版本/能力协商）、`PlanEnvelope`（opaque spec + 类型化接口）、`NodeSpec`（kind/executor/plan）、`RunScope`（run/path/depth/deadline/budget/permissions/cancel/session/trace）、`NodeRuntime.execute/spawn/await/cancel/reserve`、`NodeOutcome`、`CheckpointRef`、`OrchestrationEvent`、`TopologyProjection`，以及 12 条不变量。
- **最大风险**：**会话图与任务图双重记账**，叠加**嵌套 scope 不衰减**。前者导致幽灵节点、重复会话、恢复错位；后者导致预算爆炸、权限越界、父取消后子仍在跑。二者都不是模型问题，是架构问题。

---

## 1. 问题、术语与证据边界

### 1.1 三个正交关注点（先拆概念，再拆代码）

| 关注点 | 回答的问题 | 事实源 | 典型载体 | 混在一起的后果 |
|---|---|---|---|---|
| **计划图**（Plan Graph） | 应该做什么？依赖/验收是什么？ | 计划对象（不可变版本） | 树 `parent/children`；DAG `deps` | 计划改动被当成执行事实，审计失真 |
| **运行图**（Run Graph） | 实际跑了什么？第几次尝试？状态如何？ | 引擎事件 / checkpoint | run / attempt / checkpoint | 与计划互相覆盖，无法重放 |
| **会话图**（Session Graph） | 谁和谁对话？上下文从哪继承？ | 会话事件日志（append-only） | session / thread / lineage | 会话父子被当成任务依赖，双重记账 |

> **关键澄清**：会话图不是任务图的存储，任务图也不是会话的父子关系。三者只通过稳定 id 关联：`plan_node_id → run_id → session_id`。任何一层都不能写另一层的生命周期。[E]

很多框架把三者压成一个对象，短期省事，长期一定出问题：

- AutoGen 的 `SocietyOfMindAgent` 每次调用都跑一遍 inner team，然后 `Team.reset()`；内层团队是**临时**的，不保留跨调用状态。[F]
- LangGraph 的 subgraph 默认「per-invocation」：每次调用继承父 checkpointer、拿一个唯一 namespace，但调用结束不留累计状态；要跨调用记忆必须显式 `checkpointer=True`。[F]
- Airflow 的 SubDAG 曾是「另一个 DAG + 独立调度实体」，最终因为槽位占用/死锁/参数漂移被移除。[F]

### 1.2 什么叫「可组合、可递归嵌套」

本报告用四个可测试的性质定义：

1. **可替换**：把 tree engine 换成 dag engine，内核、UI、会话层不改代码，只换 descriptor / adapter。
2. **可嵌套**：A 引擎的一个节点可以执行 B 引擎的一次完整 run；B 内还可以再执行 A；不需要 A import B。
3. **可隔离**：子 run 的状态、预算、权限、取消、命名空间与父隔离，但可被父观察和收口。
4. **可独立演进**：两个引擎可以独立发版，只要 contract 的 major 不变；capability 以协商方式加减。

### 1.3 证据边界

- `[F]` 只表示「官方文档/源码/issue 这样写」，不表示「它是对的」；很多框架的默认值恰恰是反模式（如 Temporal `ParentClosePolicy` 默认 `Terminate`、ADK `LoopAgent` 在 Python 里 `max_iterations` 默认 `None`）。
- `[P]` 只表示「论文在其实验设置下得到该结论」，不外推到所有任务。
- `[E]` 是本报告的工程推断，落地前应做小规模 A/B 或混沌测试。
- **从 §4 开始的设计建议（架构、契约、边界、反模式修复）默认是 `[E]`**；只有引用具体框架行为时标 `[F]`、引用论文时标 `[P]`。
- 局限：官方文档迭代快，个别页面在抓取时返回 404/需登录；本文优先采用官方文档、源码、issue 与论文，无法直接抓取时以检索到的官方摘要/同源页面为准，关键数字均给出 URL。

---

## 2. 模式目录（Pattern Catalog）

### 2.1 十个模式总表

> 表内是模式归纳（`[E]` 为主）；具体框架行为见 2.3 / 2.4，未标注的框架事实以官方文档为准。

| # | 模式 | 组合单位 | 子编排有独立身份？ | 状态 / 持久化 | 预算 / 取消 | 代表实现 |
|---|---|---|---|---|---|---|
| P1 | **子编排作为工具**（Sub-orchestration as Tool） | 一次调用 | 否（调用栈内） | 调用内可见；结束即丢 | 随调用栈；取消靠运行时 | OpenAI `Agent.as_tool()`；Strands agents-as-tools；AutoGen v0.2 nested chat |
| P2 | **控制权转移**（Handoff / Transfer） | 一次对话所有权转移 | 否（同一 run 内） | 对话历史随转移 | 预算应随控制权转移；取消需显式 | OpenAI handoffs；ADK `transfer_to_agent`；Strands Swarm |
| P3 | **子图作为节点**（Subgraph as Node） | 编译后的图 | 半独立（namespace 级） | checkpointer 三模式：per-invocation / per-thread / stateless | 图级 recursion limit；取消靠 runtime | LangGraph；MS Agent Framework `WorkflowExecutor` |
| P4 | **子执行体**（Child Execution） | 一次独立 run / 流程实例 | 是 | 独立 Event History / 流程实例状态 | 独立 timeout/retry；ParentClosePolicy | Temporal child workflow；BPMN callActivity |
| P5 | **模板引用 / 内联组合**（TemplateRef / Embedded） | 模板 / 内嵌子流程 | 否（同一执行） | 共享父执行状态 | 共享父预算；无独立取消 | Argo `templateRef`；BPMN embedded subprocess |
| P6 | **层级管理器**（Hierarchical Manager） | 管理者 Agent 的一次委派 | 否（通常同 run） | 依赖对话/任务状态 | turn / iteration 上限 | CrewAI hierarchical；ADK agent tree；AutoGen Selector |
| P7 | **事件编排 / 共享总线**（Choreography） | 消息 / 事件 | 否（无中心调度） | 由参与者各自维护 | 很难做全局预算/取消 | MetaGPT SOP message pool；AgentScope MsgHub；Swarm |
| P8 | **监督树**（Supervision Tree） | 子进程 / 子监督者 | 是（进程级） | 进程状态；重启而非 checkpoint | 重启强度 + shutdown timeout | Erlang/OTP supervisor |
| P9 | **微内核 + 能力握手**（Microkernel + Capability） | 插件 + 契约 | N/A（元模式） | 插件自管 | 由宿主 scope 提供 | 微内核；MCP `initialize`；LSP `initialize` |
| P10 | **拓扑投影覆盖层**（Projection Overlay） | 视图节点 / 分组 | 否（只读） | 由事件派生 | 只展示，不执行 | Airflow TaskGroup；LangGraph `stream.subgraphs`；MS AF 事件归因 |

### 2.2 逐模式简析

**P1 子编排作为工具（最轻）**
把子代理/子流程包成一个工具，调用者拿返回值，控制权不转移。Strands 明确说 agents-as-tools 是 hub-and-spoke，每个 specialist 有独立 context window，适合「噪音大的工具不要污染主上下文」；OpenAI 的 manager 模式同理：中央编排者保留对用户回复的所有权。[F]
**适用**：一次性、有界、可总结的调研/校验/生成。
**不适用**：需要跨调用记忆、需要独立取消、需要断点续跑的长任务。

**P2 控制权转移（handoff）**
OpenAI 把 handoff 定义为「控制转移到 specialist，由它拥有该分支的最终回复」，并把「agents as tools」作为对照：后者 manager 保留控制权。ADK 的 `transfer_to_agent` 和 Strands Swarm 的 handoff 是同一语义。[F]
**关键差别**：handoff 是**转移**不是**调用**——原 agent 不会拿回结果；预算、权限、trace 必须跟着控制权走，否则会出现「A 把活转给 B，账单记在 A，取消打在 A」的错位。
**反模式**：把 handoff 当嵌套用。handoff 不产生子 run，无法单独恢复/取消。

**P3 子图作为节点（同运行时内最自然）**
LangGraph 支持两种组合：把编译后的 subgraph 直接 `add_node`（父子共享 state key），或在节点函数里 `subgraph.invoke()`（不同 schema，手工映射）。持久化有三种模式：默认 per-invocation（继承父 checkpointer、唯一 namespace、支持 interrupt，但每次从新开始）、`checkpointer=True`（per-thread，跨调用累计）、`checkpointer=False`（stateless，无 durable execution）。[F]
Microsoft Agent Framework 把子工作流包成 `WorkflowExecutor` / `BindAsExecutor` / `AsAIAgent`，子工作流有独立执行上下文，消息只通过边进出，checkpoint 时父把子状态一起序列化。[F]
**适用**：同一运行时、同一语言、团队分图开发。
**风险**：namespace 冲突（见 AP4）；并行调用 per-thread 子图会写同一 namespace。

**P4 子执行体（隔离最强）**
Temporal child workflow 是独立 Workflow Execution，有独立 Event History；父可以 await 也可以不 await；父关闭时按 `ParentClosePolicy` 处理子（`Abandon` / `RequestCancel` / `Terminate`，默认 `Terminate`）。[F]
BPMN callActivity 在进入时创建**新的流程实例**，调用外部流程定义（默认取最新版本），通过 input/output mapping 传变量；embedded subprocess 则共享同一流程实例的变量作用域。[F]
**适用**：长任务、独立扩缩容、独立版本、跨团队/跨语言。
**代价**：额外的执行记录/延迟；父事件历史里会有子状态事件，Temporal 建议单个父不要 spawn 超过 1,000 个子工作流。[F]

**P5 模板引用 / 内联组合（复用但不隔离）**
Argo 的 `WorkflowTemplate` 是集群里的模板库，`steps` / `dag` 通过 `templateRef` 引用另一个 WorkflowTemplate 的 template；template 会被内联进**同一个 Workflow 执行**，不产生独立执行身份。[F]
BPMN embedded subprocess 同理：共享父流程实例的变量作用域，边界事件可以挂在子流程上，但没有独立实例 id。
**适用**：静态复用、组织 DAG、UI 折叠。
**不适用**：想把它当「子 run」做独立取消、独立恢复、独立计费——它没有身份。

**P6 层级管理器（最像「组织」）**
CrewAI 的 hierarchical process 需要 `manager_llm` 或 `manager_agent`；任务不是预先分配的，manager 负责 planning、delegation、validation。[F]
ADK 的 agent tree 用 `sub_agents` 表达父子关系，`transfer_to_agent` 控制对话转移；`SequentialAgent` / `ParallelAgent` / `LoopAgent` 是确定性的 workflow agents，不靠模型决定执行顺序。[F]
**适用**：开放式任务、需要动态分工。
**风险**：manager 的「规划」本身消耗预算且不可复现；终止条件容易缺失（见 MAST）。

**P7 事件编排 / 共享总线（最松）**
MetaGPT 把 SOP 编码进角色与动作，角色通过共享 message pool 发布/订阅消息（`_watch` 指定关注的动作类型），没有中心调度器。[P/F]
AgentScope 提供 `sequential_pipeline` / `fanout_pipeline` / `MsgHub` 作为编排语法糖，本质是函数/类组合，不是一等子编排。[F]
**适用**：角色职责稳定、消息驱动、松耦合。
**不适用**：需要全局预算、全局取消、确定性重放——没有中心就很难收口。

**P8 监督树（边界策略的最佳参考）**
Erlang supervisor 的 child spec 按顺序启动、逆序终止；重启策略 `one_for_one` / `one_for_all` / `rest_for_one`；`intensity` + `period` 限制重启频率，超过就终止所有子进程并把自己终止，让上层监督者处理；`shutdown` 定义优雅终止超时；`auto_shutdown` 支持「重要子进程结束后整棵子树退出」。[F]
**它不是工作流 API，而是「父拥有子生命周期」的语义模型**：这正是嵌套编排最需要的边界策略。

**P9 微内核 + 能力握手（元模式）**
微内核模式：核心系统只做最小稳定功能 + 插件注册/契约/编排，插件独立、互不依赖。[F]
MCP 的 lifecycle 是现成的能力协商样板：`initialize` 交换 protocol version + capabilities，版本不兼容就断开；请求要有超时，超时后发 cancellation 并停止等待。[F]
**这就是 `EngineDescriptor` + `negotiate` 的直接参照。**

**P10 拓扑投影覆盖层（UI 解耦）**
Airflow 的 TaskGroup 是「纯 UI 分组概念」：同一 TaskGroup 的任务仍在同一个 DAG、同一个 scheduler 里，只是在 UI 上折叠成一个组。这取代了 SubDAG（另一个 DAG + 独立调度实体）。[F]
LangGraph 的 `stream.subgraphs` 暴露每个嵌套 run 的 `path`，不用解析 namespace 字符串；MS AF 把子工作流的中间事件归因到 `WorkflowExecutor` 的 id，以保持封装。[F]
**规则**：UI 只读投影；投影只由事件派生；引擎不提供 UI。

### 2.3 Agent 框架对比（组合 / 嵌套 / 持久化 / 预算 / 取消 / UI）

> 下表未标注的格子为官方文档事实 `[F]`；「无统一」表示未见一等原语，不等于绝对不可能。

| 框架 | 组合方式 | 嵌套表达 | 持久化 | 预算 / 上限 | 取消 | UI 可观测性 |
|---|---|---|---|---|---|---|
| **AutoGen AgentChat** | Team = participants + termination condition；RoundRobin / Selector / MagenticOne | `SocietyOfMindAgent` 把 inner team 包成一个 agent；每次调用后 `Team.reset()`；2024 年官方讨论称 nested chat 设计仍在演进 | **Team 无内建 checkpoint**（迁移指南明确）；需外部实现 | termination condition / `max_turns`；无统一 token ledger | 无统一级联语义；依赖运行时 | AutoGen Studio 可视化 team，但不构成拓扑契约 |
| **OpenAI Agents SDK** | handoff（转移控制权）vs agents-as-tools（manager 保留控制权）；`Agent.as_tool()` | 子 agent 作为工具或 handoff 目标；handoff 携带对话历史 | Sessions（SQLite / SQLAlchemy / Conversations API）；`RunState` 可序列化用于 HITL | `maxTurns` 默认 **10**，超过抛 `MaxTurnsExceededError`；无 token 预算原语 | 运行时取消（AbortSignal / asyncio）；无 parent-close policy | Traces 面板显示 span / handoff；无通用拓扑契约 |
| **LangGraph** | subgraph as node（共享 state）或 node 内调用（不同 schema 手工映射） | 编译后的 graph 作为节点；`Command(graph=Command.PARENT)` 可跳回父图 | checkpointer 三模式：per-invocation（默认，继承父、唯一 ns、支持 interrupt）/ per-thread（累计）/ stateless | 图级 recursion limit；预算靠应用层 | 无统一 cancel API；`interrupt()` 是暂停不是取消 | LangSmith / Studio 展示 subgraph namespace / path |
| **CrewAI** | Crew（sequential / hierarchical）+ Flow（`@start` / `@listen` / `@router`） | Crew 在 Flow 方法里 `kickoff()`，属于代码级组合，不是一等子图 | Flow `@persist`：`kickoff(inputs={"id":uuid})` 恢复，`restore_from_state_id` 分叉；Crew 无工作流级 checkpoint | Agent 级 `max_iter` / `max_rpm` / `max_execution_time`；Flow 无统一预算 | 无统一级联；依赖 Python 取消 | 平台 tracing / 日志；无统一拓扑契约 |
| **Google ADK** | agent tree（`sub_agents`）+ workflow agents（Sequential / Parallel / Loop）+ `AgentTool` | 子 agent 可共享上下文（sub-agent）或隔离上下文（AgentTool）；`transfer_to_agent` 转移 | SessionService（内存 / DB / Vertex）；state 前缀 `app:` / `user:` / `temp:`；模板 workflow 已被 graph workflow 取代 | `LoopAgent.max_iterations`：Python 默认 **None**（不设就无限循环，必须靠 escalate 退出） | 调用级取消；无 parent-close policy | `adk web` 开发 UI 展示事件流 / agent 树 |
| **AWS Strands** | agents-as-tools / Graph / Swarm / Workflow(as tool)；三种模式可互相嵌套 | agent 作为 tool（隔离 context）或 swarm handoff（共享 context） | 无内建 durable checkpoint；`invocation_state` 在同一次调用内共享 | Swarm：`max_handoffs` / `max_iterations` / `execution_timeout`；Graph：`max_node_executions` / `node_timeout` | 以超时为主；无统一级联 | 日志 / traces；无通用拓扑契约 |
| **MS Agent Framework** | Workflow = executors + edges；`WorkflowExecutor` / `BindAsExecutor` / `AsAIAgent` | 子工作流作为 executor，任意深度；子有独立执行上下文，消息只通过边进出 | 父 checkpoint 序列化子状态；`FileCheckpointStorage` | 无统一 ledger；靠 executor / timeout | 运行取消；**子失败时父默认继续**（C#），需显式处理 | 子事件归因到 `WorkflowExecutor` id；无通用拓扑契约 |
| **AgentScope** | `sequential_pipeline` / `fanout_pipeline` / `MsgHub` | 函数/类语法糖，不是一等子编排 | 无内建 durable checkpoint | 无统一；应用层 | 无统一 | 日志 / Studio（调试） |
| **MetaGPT** | SOP 角色流水线 + 共享 message pool 发布/订阅 | 角色 `_watch` 订阅消息；无嵌套引擎概念 | 无 durable checkpoint | 固定 SOP 轮次 / 重试（如 Engineer 调试最多 3 次） | 无统一 | 日志 |

### 2.4 持久化工作流引擎对比（嵌套语义）

| 引擎 | 组合 / 嵌套 | 子执行有独立身份？ | 持久化 | 预算 / 上限 | 取消 | UI |
|---|---|---|---|---|---|---|
| **Temporal** | Parent → Child Workflow；可 await 或不 await | 是：独立 Workflow Execution + Event History | Event-sourced history；Continue-As-New；deterministic replay + versioning | 各自 timeout / retry；无 token 预算；单父建议 ≤1,000 子 | `ParentClosePolicy`（Abandon / RequestCancel / Terminate 默认）；`cancellationType` 四值；Activity 随 Workflow 取消 | Web UI 显示 parent/child 链接 |
| **Argo Workflows** | `steps` / `dag` 通过 `templateRef` 引用 WorkflowTemplate；模板可递归 | 否：模板内联进同一 Workflow 执行 | Workflow status / artifacts；无 per-template checkpoint | Workflow 级 timeout；递归上限（社区称默认 100，`DISABLE_MAX_RECURSION` 可关）；间接递归可绕过（issue #11499） | 删除/终止 Workflow 级联到 Pod；无 per-template 策略 | Argo UI 以树形展示 steps |
| **BPMN / Camunda** | embedded subprocess（共享变量作用域）vs callActivity（新流程实例、外部定义） | callActivity：是；embedded：否 | 流程实例状态 + history；流程定义有版本 | timer / boundary event；无 token 预算 | terminate end event、boundary event、compensation；callActivity 可被中断 | Camunda Operate / Tasklist 显示调用层级 |
| **Airflow** | TaskGroup（纯 UI 分组）取代 SubDAG（独立 DAG + 独立调度） | 否 | metadata DB 的 task 状态；无 checkpoint | pool slot / concurrency / retries；SubDAG 会占满槽位导致死锁 | task kill / clear；无级联策略 | Grid / Graph 视图可折叠 TaskGroup |

---

## 3. 关键机制：这些框架到底教了什么

### 3.1 嵌套身份与命名空间：先发身份证，再谈组合

| 机制 | 身份 | 命名空间 | 隔离级别 |
|---|---|---|---|
| Temporal child workflow | 独立 `run_id` + `workflow_id` | 独立 Event History（同 Namespace） | 状态/历史完全隔离，只能 Signal 通信 |
| BPMN callActivity | 新流程实例 id | 独立变量作用域 + in/out mapping | 变量默认复制，输出可裁剪 |
| LangGraph subgraph | 每次调用一个 namespace | `calling_node` 加位置后缀（如 `1`）；建议用唯一 node name 做稳定命名 | state 可共享（as node）或手工映射（in node） |
| MS AF sub-workflow | `WorkflowExecutor` id | request port 加前缀：`SubWorkflow.GuessNumber` | 子状态独立；父 checkpoint 一起序列化 |
| Argo templateRef | 无独立 run id | 同一个 Workflow 的 step 路径 | 共享执行；没有独立恢复点 |

**工程规则**：
- 每个子 run 的 `checkpoint_ns = root_run_id + "/" + join(node_path, "/")`，必须由内核生成，不允许引擎用「自增计数器」单独生成。[E]
- 端口/队列/锁的 key 也必须带 `path`；MS AF 的 qualified port ID 就是正面例子。[F]
- 反例：Argo 的 `templateRef` 没有独立身份，所以它适合「静态复用」，不适合「运行时递归嵌套 + 独立取消」。[E]

### 3.2 持久化：checkpoint 的三种语义，别混着叫「持久化」

| 语义 | 含义 | 代表 | 恢复行为 | 适用 |
|---|---|---|---|---|
| **无状态调用** | 子编排就是函数调用，结束即丢 | LangGraph `checkpointer=False`；P1 | 崩溃后从头重跑 | 短、幂等、可重放 |
| **单次调用内 durable** | 调用内可 interrupt/resume，但跨调用不累计 | LangGraph 默认 per-invocation；MS AF 子工作流在父 checkpoint 内 | 父恢复时子恢复到调用内位置 | 多 agent 单次任务、HITL |
| **跨调用持久** | 子有自己的 thread/instance，累计状态 | LangGraph `checkpointer=True`；Temporal child；BPMN callActivity | 从子自己的 checkpoint/实例恢复 | 长任务、多轮、独立扩缩容 |

关键事实：
- LangGraph 明确警告：per-thread 子图**不支持并行工具调用**；同一子图在同一节点被并行调用会写同一 namespace 导致冲突（`MULTIPLE_SUBGRAPHS`，[文档](https://docs.langchain.com/oss/python/langgraph/errors/MULTIPLE_SUBGRAPHS)）。[F]
- MS AF 明确警告：同一个 `WorkflowExecutor` 的所有并发执行**共享同一个底层 workflow 实例**，所以子工作流内的 executor 应当无状态，否则并发互相干扰。[F]
- AutoGen 的 Team 没有内建 checkpoint；嵌套 team 每次调用后 reset。[F]
- Temporal 的 Continue-As-New **不会携带**正在运行的 child workflow；父 continue 后，旧的子不会自动进入新实例。[F]

**契约结论**：内核只存 `CheckpointRef`（store / namespace / run_id / seq / hash / schema_version），不存引擎私有状态；引擎必须声明 `persistence` 与 `determinism`，不能假装自己能 resume。[E]

### 3.3 预算：不是四个数字，是一本账

| 来源 | 预算原语 | 默认/关键值 | 教训 |
|---|---|---|---|
| OpenAI Agents SDK | `maxTurns` | **10** | 轮次上限是最低成本的防失控；超过抛错而不是静默继续 |
| Google ADK | `LoopAgent.max_iterations` | Python 默认 **None** | 不设上限就无限循环；必须靠 `escalate` 退出 |
| Strands Swarm | `max_handoffs` / `max_iterations` / `execution_timeout` | 由调用方设置 | handoff 型系统要同时限制「跳几次」和「总共跑多久」 |
| Strands Graph | `max_node_executions` / `node_timeout` | 由调用方设置 | 图执行要有节点级超时与总执行次数上限 |
| CrewAI | Agent `max_iter` / `max_rpm` / `max_execution_time` | Agent 级 | 预算是 agent 属性，不是 workflow 属性；嵌套时容易丢 |
| Temporal | Workflow / Activity timeout + RetryPolicy | 各自独立 | 父的 timeout 不自动等于子的 timeout；要显式设置 |
| Erlang OTP | `intensity` + `period` | 默认 1 次 / 5 秒 | **嵌套监督者的重启次数是相乘的**：上层 10 × 下层 10 = 100 次 |

Erlang 文档的原话值得每个做嵌套编排的人读一遍：

> "If your application has multiple levels of supervision, do not set the restart intensities to the same values on all levels. Keep in mind that the total number of restarts (before the top level supervisor gives up and terminates the application) will be the product of the intensity values of all the supervisors above the failing child process."（[Erlang supervisor](https://www.erlang.org/doc/system/sup_princ.html)）[F]

这直接推翻了「每层都设 retry=3 很安全」的直觉：4 层嵌套就是 3^4 = 81 次尝试。**预算必须是绝对账本，不是每层相对倍数。**[E]

### 3.4 取消：传播、观察、关闭策略是三件事

Temporal 把取消拆得很清楚，值得直接借鉴：

- `ParentClosePolicy`：父关闭时对子做什么——`Abandon`（不受影响）、`RequestCancel`（发取消请求）、`Terminate`（强制终止，**默认**，[文档](https://docs.temporal.io/parent-close-policy)）。[F]
- `cancellationType`：取消请求是否传播给子、以及何时向父报告子的取消——`ABANDON` / `TRY_CANCEL` / `WAIT_CANCELLATION_REQUESTED` / `WAIT_CANCELLATION_COMPLETED`（[API](https://typescript.temporal.io/api/enums/proto.coresdk.child_workflow.ChildWorkflowCancellationType)）。[F]
- Activity 与 Workflow 的差异：Workflow 被取消时，Activity **总是**被取消；但 child workflow 在 `ABANDON` 下可以继续。[F]

结构化并发给出了更根本的规则：

- 父任务不能凭空 spawn 子任务，必须先开 nursery；nursery 不退出直到所有子退出。[F]
- 子任务抛异常 → 立即取消同 nursery 的其他任务 → 等它们清理完 → 再把异常抛给父。[F]
- 取消在 checkpoint 处生效，清理期间不会被暴力杀死；不允许「无人监管的后台任务」。[F]

**契约结论**：
- `CancelState` 必须随 `RunScope` 传播；引擎在每个步骤边界和副作用前调 `runtime.checkCancel(scope)`，已取消则抛 `Cancelled`。
- 取消必须带 `cancel_id`（epoch）；取消后到达的旧结果按 epoch 丢弃。
- 父关闭默认 `CANCEL`（不是 `ABANDON`）；只有显式 `detach` + lease + reaper 才允许子比父活得久。
- 取消是「请求 + 宽限 + 强制」三段，不是布尔开关。

### 3.5 递归：上限、按需分解、以及「间接递归」的坑

- **Argo**：模板可以递归调用自身，官方 coin-flip 例子就是「 tails 就再调用 coinflip」。[F] 但 issue #11499 指出**间接递归**（A→B→A）没有被正确阻止，控制器会无限递归；社区分析称有最大深度（默认 100）和 `DISABLE_MAX_RECURSION` 开关（[issue #11499](https://github.com/argoproj/argo-workflows/issues/11499)）。[F]
- **ADaPT**：不是无条件递归，而是「执行器失败才让 planner 分解」；`d_max=3`；在 ALFWorld / WebShop / TextCraft 上分别提升 28.3 / 27 / 33 个百分点；论文强调多级分解和「按执行器能力自适应」的重要性。[P]
- **HTN 的启示**：经典 Hierarchical Task Network 用 method 把复合任务分解成子任务，但依赖手工 plan library；ADaPT 的贡献是让 LLM 自动产生分解，并用 executor 失败作为「何时展开」的信号。[P] 对 strict tree engine 的含义是：分解规则可以插拔，但「叶子是否可执行」必须由 executor / verifier 判定，不能由 planner 自说自话。[E]
- **ADK LoopAgent**：Python 默认 `max_iterations=None`，不设就无限循环；官方文档明确要求实现终止机制（max iterations 或 sub-agent escalate）。[F]
- **MAST**：分析 7 个框架、200+ traces、14 类失败模式，其中包含「未意识到终止条件」；论文的结论是很多失败来自组织/协调设计，而不是单模型能力。[P]
- **Cognition**：多 agent 并行的核心风险是 context 碎片化——子 agent 看不到彼此的行动和隐含决策，最后合并时冲突；Claude Code 的子 agent 主要用于「调查/回答」，不并行写代码，且不与主 agent 并行。[P]

**综合判断**：
- 递归深度不是「越多越细越好」，而是「任务复杂度 × 上下文可传递性」的函数。
- 默认 3 层（LLM 自主分解），4 层（引擎互嵌），8 层硬上限；再深必须有人工批准和确定性引擎。
- 必须有「无进展检测」：连续 3 次相同状态 hash / 相同错误签名 → 停分支，而不是继续分解。

### 3.6 UI：投影而不是绑定

| 做法 | 代表 | 结果 |
|---|---|---|
| 把嵌套单元做成独立调度实体 | Airflow SubDAG | 占槽位、死锁、参数漂移；被移除 |
| 只做 UI 分组，任务留在同一 DAG | Airflow TaskGroup | 视图折叠，调度不变；成为推荐做法 |
| 事件归因到子编排 executor | MS AF `WorkflowExecutor` id | 保持封装，父流只看到有意义的中间事件 |
| 暴露嵌套 run 的 path | LangGraph `stream.subgraphs` | UI 不用解析 namespace 字符串 |
| 引擎自带 UI | 各框架 Studio / Web UI | 只能看自己；换引擎就要换 UI |

**契约结论**：UI 只消费 `TopologyProjection`；节点带 `engine_id`、`parent_node_id`、`run_id`、`session_id`、`capabilities`；`CONTAINMENT` 边表达嵌套，`DEPENDENCY` 边表达 DAG。引擎不提供 UI，UI 不读引擎 DB。[E]

---

## 4. 推荐架构：Kernel + Contract + Engines + Projection

### 4.1 分层与职责

| 层 | 职责 | 不应该做的事 | 事实源 |
|---|---|---|---|
| **L0 会话图 / 事件底座** | session lineage、append-only journal、context refs、artifact refs | 不调度、不决定任务依赖、不拥有 run 状态机 | session events |
| **L1 编排内核** | 注册引擎、协商能力、构造 scope、预算账本、取消代理、事件日志、投影 | 不实现具体调度算法；不解析引擎 plan spec；不做业务重试 | run/event log |
| **L2 引擎插件** | tree 调度、DAG 调度、外部引擎 adapter、叶子执行器（LLM/tool/human） | 不 import 另一个引擎；不直接写 session 生命周期；不自己生成全局 id | 引擎自己的 checkpoint / 外部系统 |
| **L3 呈现层** | 拓扑、成本、审批、回放、检查 | 不读引擎数据库；不把 UI 分组当执行实体 | `TopologyProjection` |

### 4.2 依赖规则（用 CI 强制）

```text
contract      (零依赖：类型 + 不变量 + 错误码)
   ▲    ▲    ▲
   │    │    └── ui-projection (只依赖 contract)
   │    └─────── engine-tree / engine-dag / adapter-temporal / adapter-argo
   │             (只依赖 contract + 各自 vendor SDK)
   └──────────── kernel (只依赖 contract + registry + storage ports)
```

禁止：
- `engine-tree` import `engine-dag`（反之亦然）。
- `kernel` 里出现 `if (engine.type === "dag")`。
- `ui` import 任何 engine 包。
- 引擎之间共享可变单例（MS AF 的并发 warning 就是这个问题）。[F]

### 4.3 一次异构嵌套的完整时序

场景：tree engine 的某个节点 `research` 交给 dag engine 执行；dag 里有一个叶子调用外部工具。

```text
1. kernel: registry.load(tree), registry.load(dag)
2. kernel: tree.negotiate({contract 1.x, caps, limits}) -> ok
3. kernel: dag.negotiate(...) -> ok
4. user: kernel.start(treePlan, rootScope)
5. tree engine: 执行节点 research（kind=ORCHESTRATOR, executor=engine:dag）
6. tree engine -> runtime.spawn(node, childScope)
   kernel: childScope = derive(parentScope, node):
     run_id = new; path += research; depth+1; deadline=min(...);
     budget.reserve(...); permissions.attenuate(...); cancel=childToken;
     session = NEW (or FORK); checkpoint_ns = root/path
7. kernel -> dag.start(dagPlan, childScope) -> RunHandle
8. dag engine: 调度节点；叶子 -> runtime.execute(leaf, scope)
   kernel -> leaf executor (tool/LLM/human) -> NodeOutcome
9. dag engine: emit events; kernel append; projector upsert nodes/edges
10. tree engine: runtime.await(handle) -> NodeOutcome
    - SUCCEEDED: 继续父树
    - FAILED: 按 node.on_failure 决定 PROPAGATE / ABSORB / COMPENSATE
11. cancel: user -> kernel.cancel(root) -> tree.cancel -> kernel.cancel(dagHandle)
    -> dag.cancel(leaves) -> CancelAck（grace 30s，超时 force）
12. checkpoint: tree 在节点边界保存 CheckpointRef（含 child handle 引用）
    resume: kernel.resume(tree, ref) -> 若 dag 支持 resume，则 resume(handle)；
            否则按声明 fail-closed 或重跑子树
```

### 4.4 与 DSH 现有概念的映射（工程推断）

| 研究概念 | DSH 现有对应 | 差距 / 需要补的 |
|---|---|---|
| tree engine | `tree_plan` / `tree_node` / `tree_dispatch` / `tree_verify` | 已有严格树、DoD、验收；缺统一 `RunScope` 与引擎契约 |
| DAG engine | 无（需插件） | 需实现 `OrchestrationEngine`，支持 join / 条件 / 循环上限 |
| session graph | session lineage / `session_handoff` | 已 append-only；需与 run graph 建立 `run_id ↔ session_id` 投影 |
| budget / cancel | 分散在工具参数/运行器 | 需提升为 scope 级账本与令牌 |
| topology UI | `tree_status` / `tree_log` + 面板 | 需统一 `TopologyProjection`，支持异构引擎分组 |

> 这张表是 `[E]`，不是事实；落地前应先做 contract spike，而不是先接第二个引擎。

**与 E2 契约的对齐建议**（E2 指同批 `E2-dsh-capabilities.md` 的 `编排契约 v0`）：[E]

- E2 的 `DshAdapter.spawnNode(SpawnNodeSpec)` 可以看作本报告 `NodeRuntime.execute` 在 DSH 平台上的**叶子适配器**：它负责把「一个节点」变成一次 `agents.create / subagents.startActivation`，但不负责树/DAG 的调度语义。E4 的 `OrchestrationEngine` 在其上，二者不冲突。
- 只要 `runId / nodeId / attempt` 三个字段语义一致，tree 与 dag 就可以共享同一个 DSH adapter，不必各写一套 spawn；E2 的 `idempotencyKey = sha256(runId,nodeId,attempt,'spawn')` 可以直接作为本报告 `dedupe_key` 的实现。
- E2 的 `OrchestrationStore`（RunRecord / NodeRecord）对应本报告的 `EventLog` + 投影存储；建议 RunRecord 的 `kind: 'tree' | 'dag'` 改为 `engine_id` + `capabilities`，否则内核/UI 会重新长出 `if kind === 'dag'` 的分支，正好落进 AP2。

---

## 5. 编排契约（核心交付物）

> 目标：**两个异构引擎互相嵌套时，只需要实现本契约，不需要互相 import，也不需要内核理解对方的 plan 格式。**
> 记法说明：下面用 TypeScript 风格写，但它不是 TypeScript；`?` 可选，`[]` 数组，`|` 枚举，`int` / `Timestamp` / `Json` 为中立类型。

### 5.1 设计原则

1. **最小接口**：引擎只暴露 describe / negotiate / validate / start / resume / signal / cancel / status / events / checkpoint / dispose。
2. **Opaque plan**：`PlanEnvelope.spec` 对内核不透明；内核只校验信封和接口 schema。
3. **能力协商**：能力是显式声明 + 协商交集；未知的**必需**能力 fail-closed。
4. **单调衰减**：子 scope 的预算/权限/deadline 只能 ≤ 父；内核强制。
5. **单一写者**：每类事实只有一个写者；事件 append-only，投影只读。
6. **稳定路径**：`run_id` + `path` 是跨引擎、跨恢复、跨 UI 的通用坐标。

### 5.2 对象模型

#### 5.2.1 EngineDescriptor / Capability

```ts
type Semver = string;        // MAJOR.MINOR.PATCH
type Timestamp = string;     // RFC3339 UTC
type Json = unknown;
type int = number;           // 中立整数

// 基础引用类型（跨进程可序列化）
type ValueRef = { ref: string } | { literal: Json };
type RunRef = { run_id: string; engine_id: string; path: PathSegment[] };
type ArtifactRef = { uri: string; hash: string; media_type: string; size?: int };
type ArtifactNamespace = { store: string; prefix: string };
type TraceContext = { trace_id: string; span_id: string; baggage?: Record<string, string> };
type Unsubscribe = () => void;
type Signal = { name: string; payload?: Json };
type Ack = { accepted: boolean; reason?: string };
type EventPage = { events: OrchestrationEvent[]; next_cursor?: string };
type HumanGate = { gate_id: string; question: string; options?: string[]; schema?: Json; deadline?: Timestamp };
type Decision = { decision: "APPROVE" | "REJECT" | "AMEND"; by: string; reason?: string; at: Timestamp };

interface EngineDescriptor {
  engine_id: string;              // 全局唯一，如 "tree.strict"
  impl_version: Semver;
  contract_version: Semver;       // 实现的编排契约版本
  capabilities: Capability[];     // 声明能力；协商后取交集
  node_kinds: string[];           // "TASK" | "ORCHESTRATOR" | "HUMAN_GATE" | ...
  determinism: "DETERMINISTIC" | "REPLAYABLE_EFFECTS" | "BEST_EFFORT";
  persistence: "NONE" | "CHECKPOINT" | "EVENT_SOURCED";
  limits: {
    max_depth: int;               // 本引擎能接受的最大嵌套深度
    max_fanout: int;              // 单节点最大并发子节点数
    max_nodes: int;               // 单 run 最大节点数
    max_runtime_ms: int;
  };
  endpoint?: string;              // "inproc://..." | "grpc://..." | "http://..."
}

interface Capability {
  name: string;                   // "checkpoint.resume" | "cancel.cascade" |
                                  // "budget.reserve" | "topology.group" |
                                  // "human.gate" | "detach.child" |
                                  // "replay.deterministic" | "stream.events"
  version: Semver;
  params_schema?: Json;           // JSON Schema；无参数可省略
}
```

#### 5.2.2 PlanEnvelope / NodeSpec

```ts
interface PlanEnvelope {
  plan_id: string;
  plan_version: Semver;
  engine_id: string;
  schema_version: Semver;         // 计划 DSL 版本
  spec: Json;                     // 引擎私有；内核不解析（opaque）
  interface: {
    inputs: Json;                 // JSON Schema
    outputs: Json;                // JSON Schema
  };
  defaults: NodeDefaults;         // 未填字段的默认值
  annotations?: {
    title?: string;
    labels?: Record<string, string>;
    ui_group?: string;            // 仅提示，不参与执行
  };
}

interface NodeDefaults {
  timeout_ms?: int;
  retry?: RetryPolicy;
  budget_share?: BudgetShare;
  isolation?: Isolation;
  on_failure?: "PROPAGATE" | "ABSORB" | "COMPENSATE";
}

interface NodeSpec {
  node_id: string;                // plan 内唯一；重试不变
  kind: "TASK" | "ORCHESTRATOR" | "HUMAN_GATE" | "JOIN" | "COMPENSATE";
  executor: ExecutorRef;          // 叶子 / 工具 / 人 / 另一个引擎
  plan?: PlanEnvelope;            // kind=ORCHESTRATOR 时必填
  inputs: Record<string, ValueRef>;
  deps?: string[];                // DAG 依赖；树引擎可省略
  when?: string;                  // 受限表达式，禁止任意代码
  retry?: RetryPolicy;
  timeout_ms?: int;
  budget_share?: BudgetShare;     // 相对父 available 的比例或绝对值
  isolation?: Isolation;
  on_failure?: "PROPAGATE" | "ABSORB" | "COMPENSATE";
  output_schema?: Json;
  labels?: Record<string, string>;
}

interface ExecutorRef {
  type: "leaf" | "tool" | "human" | "engine";
  ref: string;                    // 工具名 / 人类队列 / engine_id
  version?: Semver;               // 版本钉住，便于回滚
}

interface RetryPolicy {
  max_attempts: int;
  backoff_ms: int;
  jitter: "NONE" | "FULL" | "EQUAL";
  retry_on: ErrorClass[];         // 只对这些错误类重试
}

interface BudgetShare {
  tokens?: int;
  cost_usd?: number;
  tool_calls?: int;
  wall_ms?: int;
  fraction?: number;              // 0..1；与绝对值二选一
}

interface Isolation {
  session: "NEW" | "FORK" | "REUSE";
  workspace: "NONE" | "WORKTREE" | "SANDBOX";
  secrets: "NONE" | "INHERIT" | "EXPLICIT"; // EXPLICIT 需 secret_refs
  secret_refs?: string[];
}
```

#### 5.2.3 RunScope / BudgetGrant / PermissionSet / CancelState

```ts
interface RunScope {
  run_id: string;                 // 本次 run 唯一 id（内核生成并登记）
  root_run_id: string;
  parent_run_id?: string;
  path: PathSegment[];            // [{node_id, attempt, engine_id}]
  depth: int;                     // orchestrator 跳数；内核强制 +1
  engine_id: string;
  deadline: Timestamp;            // 绝对时间；min(parent.deadline, now+timeout)
  budget: BudgetGrant;            // 只读快照；增减走 NodeRuntime
  permissions: PermissionSet;
  cancel: CancelState;            // 只读状态；检查走 NodeRuntime
  session: SessionRef;
  trace: TraceContext;
  artifacts: ArtifactNamespace;
  policy: RunPolicy;
}

interface PathSegment {
  node_id: string;
  attempt: int;
  engine_id: string;
}

interface BudgetUsage {
  tokens?: int;
  cost_usd?: number;
  tool_calls?: int;
  wall_ms?: int;
  fanout?: int;
}

interface BudgetGrant {
  limits: BudgetUsage;            // 本 run 的硬上限（绝对值）
  used: BudgetUsage;
  reserved: BudgetUsage;          // 已预留给子 run 的额度
  available: BudgetUsage;         // limits - used - reserved
  reservation_id?: string;        // 当前节点在父账本里的预留凭据
}

// 内核侧账本实现；跨进程时由 adapter 映射为 RPC。
// scope 里只带 BudgetGrant 快照，避免把可变对象序列化给引擎。
interface BudgetLedger {
  reserve(scopeRunId: string, delta: BudgetUsage, ttl_ms: int): Reservation;
  commit(r: Reservation, actual: BudgetUsage): void;
  release(r: Reservation): void;
  snapshot(scopeRunId: string): BudgetGrant;
}

interface Reservation {
  reservation_id: string;
  scope_run_id: string;
  delta: BudgetUsage;
}

interface PermissionSet {
  grants: string[];               // "tool:web.search" | "fs:read:D:/x" | "net:api.x"
  denies: string[];               // 继承自父，不可清除
  sandbox: {
    fs_read: string[];
    fs_write: string[];
    network: string[];
    env: string[];
  };
  secret_refs: string[];          // 只引用，不内联
  approval_ref?: string;          // 人工升级凭据
  mode: "READ_ONLY" | "WORKSPACE_WRITE" | "FULL";
}

interface CancelState {
  cancel_id: string;              // 单调 epoch
  requested: boolean;
  mode: "GRACEFUL" | "FORCE";
  deadline: Timestamp;
  reason: string;
}

interface SessionRef {
  session_id: string;
  parent_session_id?: string;
  thread_id?: string;
  checkpoint_ns: string;          // 内核生成：root_run_id + "/" + path
}

interface RunPolicy {
  max_depth: int;
  max_children: int;
  max_retries: int;
  reserve_floor: BudgetUsage;     // 不分配给子 run 的保底额度
  allow_detach: boolean;
  on_parent_close: "CANCEL" | "ABANDON" | "TERMINATE";
  grace_ms: int;
}
```

#### 5.2.4 Checkpoint / Outcome / Error / Event / Projection

```ts
interface CheckpointRef {
  store: string;                  // "file" | "sqlite" | "s3" | ...
  namespace: string;              // 内核生成，稳定路径
  run_id: string;
  seq: int;
  hash: string;                   // 内容 hash，防篡改/防串
  schema_version: Semver;
  engine_id: string;
}

type NodeStatus =
  | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED"
  | "SKIPPED" | "SUSPENDED" | "REJECTED" | "BUDGET_EXHAUSTED";

interface NodeOutcome {
  status: NodeStatus;
  outputs: Record<string, ValueRef>;
  artifacts: ArtifactRef[];
  usage: BudgetUsage;
  checkpoint?: CheckpointRef;
  error?: ErrorEnvelope;
  child_runs?: RunRef[];
}

interface ErrorEnvelope {
  class: ErrorClass;
  code: string;                   // 稳定错误码，供策略匹配
  message: string;
  retryable: boolean;
  path: string;                   // 出错节点路径，便于定位
  cause?: ErrorEnvelope;
  partial?: boolean;              // 是否允许 partial output
}

type ErrorClass =
  "RETRYABLE" | "FATAL" | "CANCELLED" | "TIMEOUT" |
  "BUDGET" | "PERMISSION" | "CONTRACT" |
  "DEPENDENCY" | "VERIFICATION";

interface OrchestrationEvent {
  event_id: string;               // ULID/UUID；去重键
  schema_version: Semver;
  type: EventType;
  run_id: string;
  root_run_id: string;
  node_path: string;
  engine_id: string;
  seq: int;                       // 每 run 单调
  ts: Timestamp;
  payload: Json;
  causation_id?: string;          // 触发它的事件
}

type EventType =
  "RUN_QUEUED" | "RUN_STARTED" | "RUN_SUSPENDED" | "RUN_RESUMED" |
  "RUN_ENDED" | "NODE_SCHEDULED" | "NODE_STARTED" | "NODE_OUTPUT" |
  "NODE_FAILED" | "NODE_RETRY" | "BUDGET_RESERVED" | "BUDGET_RELEASED" |
  "CANCEL_REQUESTED" | "CANCEL_ACKED" | "CHECKPOINT_SAVED" |
  "HUMAN_GATE_REQUESTED" | "HUMAN_GATE_DECIDED";

interface TopologyProjection {
  revision: int;                  // 单调；UI 按 diff 应用
  root_run_id: string;
  generated_at: Timestamp;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: TopologyGroup[];
  capabilities: {
    can_cancel: boolean;
    can_resume: boolean;
    can_inspect: boolean;
    can_open_session: boolean;
    can_approve: boolean;
  };
}

interface TopologyNode {
  node_id: string;
  parent_node_id?: string;
  engine_id: string;
  kind: NodeSpec["kind"];
  title: string;
  status: NodeStatus | "PENDING" | "RUNNING" | "BLOCKED";
  run_id?: string;                // 子编排节点
  session_id?: string;
  started_at?: Timestamp;
  ended_at?: Timestamp;
  usage?: BudgetUsage;
  badges?: string[];              // "resumed" | "partial" | "detached" ...
}

interface TopologyEdge {
  edge_id: string;
  from: string;
  to: string;
  kind: "CONTAINMENT" | "DEPENDENCY" | "DATA" | "HANDOFF" | "CANCEL";
  status: "PENDING" | "ACTIVE" | "DONE" | "FAILED" | "SKIPPED";
}

interface TopologyGroup {
  group_id: string;
  engine_id: string;
  node_ids: string[];
  collapsed: boolean;
  label: string;
}
```

### 5.3 引擎接口

```ts
interface OrchestrationEngine {
  describe(): EngineDescriptor;
  negotiate(req: NegotiationRequest): NegotiationResult;
  validate(plan: PlanEnvelope): ValidationReport;
  start(plan: PlanEnvelope, scope: RunScope): RunHandle;
  resume(handle: RunHandle, checkpoint: CheckpointRef, scope: RunScope): RunHandle;
  signal(handle: RunHandle, signal: Signal): Ack;
  cancel(handle: RunHandle, req: CancelRequest): CancelAck;
  status(handle: RunHandle): RunSnapshot;
  events(handle: RunHandle, cursor: string, limit: int): EventPage;
  checkpoint(handle: RunHandle): CheckpointRef | null;
  dispose(handle: RunHandle): void;
}

interface NegotiationRequest {
  contract_versions: Semver[];    // 内核支持的版本区间
  capabilities: Capability[];     // 内核/父 run 需要的能力
  limits: { max_depth: int; max_fanout: int; max_nodes: int };
  require_resume?: boolean;       // 父要求可恢复时，子不支持则拒
}

interface NegotiationResult {
  accepted: boolean;
  contract_version: Semver;
  capabilities: Capability[];     // 实际可用能力（交集）
  limits: { max_depth: int; max_fanout: int; max_nodes: int };
  reason?: string;                // 拒绝原因，稳定错误码
}

interface ValidationReport {
  ok: boolean;
  errors: Array<{ code: string; path: string; message: string }>;
  warnings: string[];
  required_capabilities: string[];
}

interface RunHandle {
  run_id: string;
  engine_id: string;
  accepted_at: Timestamp;
  resume_token?: string;
}

interface RunSnapshot {
  run_id: string;
  status: NodeStatus | "RUNNING" | "PENDING" | "SUSPENDED";
  progress?: { done: int; total?: int };
  usage: BudgetUsage;
  checkpoint?: CheckpointRef;
  children?: RunRef[];
}

interface CancelRequest {
  cancel_id: string;
  mode: "GRACEFUL" | "FORCE";
  deadline: Timestamp;
  reason: string;
}

interface CancelAck {
  cancel_id: string;
  status: "ACKED" | "ALREADY_DONE" | "REJECTED";
  forced?: boolean;
}
```

### 5.4 节点执行接口（内核实现，引擎调用）

这是整个架构的**依赖倒置点**：引擎不调用另一个引擎，只调用内核给的 `NodeRuntime`。内核负责路由到叶子执行器或目标引擎。

```ts
interface NodeRuntime {
  // 等待完成（语义上同步）：叶子或子编排执行完返回
  execute(node: NodeSpec, scope: RunScope): Promise<NodeOutcome>;

  // 异步 spawn：用于并行 fan-out；随后 await
  spawn(node: NodeSpec, scope: RunScope): Promise<RunHandle>;
  await(handle: RunHandle, deadline: Timestamp): Promise<NodeOutcome>;

  cancel(handle: RunHandle, req: CancelRequest): Promise<CancelAck>;

  // 取消检查：步骤边界 / 副作用前调用；已取消则抛 Cancelled
  checkCancel(scope: RunScope): void;
  onCancel(scope: RunScope, cb: () => void): Unsubscribe;

  // 预算预留/提交/释放
  reserve(scope: RunScope, delta: BudgetUsage): Promise<Reservation>;
  commit(scope: RunScope, r: Reservation, actual: BudgetUsage): Promise<void>;
  release(scope: RunScope, r: Reservation): Promise<void>;

  // 事件与 checkpoint
  emit(event: OrchestrationEvent): Promise<void>;
  checkpoint(scope: RunScope): Promise<CheckpointRef>;
}
```

**语义要点**：
- `spawn` 必须先从父账本 `reserve` 一段预算；没有预留的 spawn 直接拒绝。
- `execute` 对子编排等价于 `spawn + await`，但父引擎不应假设子引擎是同步的。
- `cancel` 幂等；同一个 `cancel_id` 重复调用返回 `ALREADY_DONE`。
- `checkpoint` 只返回引用；内核不解释内容。

### 5.5 端口（Ports）

```ts
interface StateStore {
  get(ns: string, key: string): Promise<{ value: Json; version: int } | null>;
  put(ns: string, key: string, value: Json, ifVersion?: int): Promise<int>; // CAS
  list(ns: string, prefix: string, cursor?: string): Promise<{ keys: string[]; next?: string }>;
  watch(ns: string, prefix: string): AsyncIterable<{ key: string; version: int }>;
}

interface EventLog {
  append(event: OrchestrationEvent): Promise<int>;      // 返回 seq；按 event_id 去重
  read(runId: string, afterSeq: int, limit: int): Promise<EventPage>;
}

interface ArtifactStore {
  put(bytes: Uint8Array, mediaType: string): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<Uint8Array>;
}

interface ApprovalPort {
  request(scope: RunScope, gate: HumanGate): Promise<Decision>;
}

interface Clock {
  now(): Timestamp;
  sleepUntil(ts: Timestamp, cancel: CancelState): Promise<void>;
}
```

**命名空间规则**：`StateStore` 的 `ns`、`CheckpointRef.namespace`、`EventLog` 的 `run_id`、端口 id，全部由内核用 `root_run_id + path` 派生。引擎不得自行发明全局 key。[E]

### 5.6 不变量（内核强制，引擎不得绕过）

| # | 不变量 | 语义 | 违反后果 |
|---|---|---|---|
| I1 | **单一写者** | session 生命周期只由会话层写；run 生命周期只由引擎写；投影只由 projector 写 | 双重记账、幽灵节点 |
| I2 | **预算衰减** | `child.limits ≤ parent.available - reserve_floor`（reserve_floor 由内核策略配置）；兄弟预留总和 ≤ 父 available | 成本爆炸、超卖 |
| I3 | **权限衰减** | `child.grants ⊆ parent.grants`；`denies` 继承且不可清除；secret 只引用 | 权限越界、密钥泄漏 |
| I4 | **深度单调** | `child.depth = parent.depth + 1`；内核取 `min(engine.max_depth, policy.max_depth)` | 递归失控 |
| I5 | **deadline 单调** | `child.deadline ≤ parent.deadline`；不允许「每层重新计时」 | 永久运行 |
| I6 | **取消级联** | 父取消 → 非 detached 子全部收到 cancel；取消后禁止 spawn；旧 epoch 结果丢弃 | 孤儿、取消后写入 |
| I7 | **稳定身份** | `run_id` 全局唯一；`node_id` 在 plan 内稳定；重试不改 node_id | 恢复错位、UI 重复 |
| I8 | **命名空间隔离** | `checkpoint_ns / journal_ns / port_id = f(root_run_id, path)` | checkpoint 串写、端口串话 |
| I9 | **恢复诚实** | 引擎声明 `determinism/persistence`；不支持的 resume 必须拒绝，不得静默从头跑 | 重复副作用 |
| I10 | **协商 fail-closed** | 未知 major / 必需能力缺失 → 拒绝；不得静默降级语义 | 行为不可预测 |
| I11 | **事件至少一次 + 去重** | 每个状态转换都有事件；消费端按 `event_id` 去重 | 投影丢状态 |
| I12 | **UI 只读** | 投影不能反向修改引擎；UI 不读引擎 DB | UI 绑死、越权 |

### 5.7 协商与版本

**握手规则**（参照 MCP lifecycle 的版本/能力协商）：[F]

```text
kernel -> engine: negotiate({
  contract_versions: ["1.2", "1.1"],   // 内核支持
  capabilities: [                       // 父 run 需要
    {name:"cancel.cascade", version:"1.0"},
    {name:"checkpoint.resume", version:"1.0"}
  ],
  limits: {max_depth:4, max_fanout:8, max_nodes:256},
  require_resume: true
})

engine -> kernel: {
  accepted: true,
  contract_version: "1.2",
  capabilities: [{name:"cancel.cascade",version:"1.0"},
                 {name:"checkpoint.resume",version:"1.0"}],
  limits: {max_depth:6, max_fanout:4, max_nodes:1024}
}

kernel 取 min -> 生效 limits: {max_depth:4, max_fanout:4, max_nodes:256}
```

- 引擎只能**收窄** limits，不能放宽：内核取 `min`。
- major 不兼容 → 拒绝；minor 不兼容 → 取交集；未知可选能力 → 忽略。
- `require_resume=true` 且引擎无 `checkpoint.resume` → 拒绝（fail-closed）。
- 版本维度：`contract_version`、`plan.schema_version`、`checkpoint.schema_version`、`event.schema_version`、`capability.version`；每一维独立演进。
- 事件消费者必须忽略未知字段；checkpoint 迁移必须显式版本化，不允许「猜格式」。
- 参考 Kubernetes CRD 的多版本 + conversion 思路：旧版本可读，写入走 storage version，转换显式化。[F]

### 5.8 最小互嵌证明（两个异构引擎）

只要下面 8 条成立，就足以让 A、B 两个引擎互相嵌套：

1. A 能 `describe()`，B 能 `describe()`；内核能读到两者的 `contract_version` / `capabilities` / `limits`。
2. 内核能 `negotiate` 出交集；A 和 B 都不需要知道对方的类型。
3. A 的 plan 里有一个 `NodeSpec{kind:"ORCHESTRATOR", executor:{type:"engine", ref:B}, plan:BPlan}`。
4. A 调 `runtime.spawn(node, childScope)`；内核构造 childScope，调 `B.start(BPlan, childScope)`。
5. B 调 `runtime.execute(leaf, scope)` 执行叶子；内核路由到工具/LLM/人。
6. B 发事件；内核 append；projector 用 `CONTAINMENT` 边把 B 的节点挂到 A 的节点下。
7. A 调 `runtime.await(handle)` 拿 `NodeOutcome`；失败按 `on_failure` 处理。
8. 取消/恢复都走同一组 `cancel` / `resume` / `checkpoint` 接口；B 不支持就 fail-closed。

### 5.9 契约一致性测试（上线门槛）

| # | 测试 | 通过标准 |
|---|---|---|
| T1 | start → await → outcome | 状态、输出、usage 正确 |
| T2 | 父取消 → 子取消 → 迟到结果 | 子收到 cancel；旧 epoch 结果被丢弃 |
| T3 | 预算 reserve/commit/release | 不超卖；未用额度回到父账本 |
| T4 | 深度超限 | 内核拒绝 spawn，错误码稳定 |
| T5 | checkpoint/resume | 同一 path 恢复；无重复副作用 |
| T6 | 并行兄弟 | 每个兄弟 namespace 唯一；无串写 |
| T7 | 权限衰减 | 子无法获得父没有的 grant；deny 继承 |
| T8 | 未知能力/版本 | fail-closed，不静默降级 |
| T9 | 事件重复投递 | 投影幂等，revision 单调 |
| T10 | 投影一致性 | 从事件重建的拓扑 = 引擎 status 的拓扑 |
| T11 | 引擎替换 | 换引擎不改内核/UI 代码 |
| T12 | A→B→A 递归 | 深度/预算正确，取消级联，无死锁 |

---

## 6. 递归嵌套边界策略

### 6.1 深度

| 场景 | 建议 `max_depth` | 依据 |
|---|---|---|
| LLM 自主分解（planner/executor） | **3** | ADaPT 的 `d_max=3`；再深收益递减、上下文碎片化 |
| tree engine ↔ dag engine 互嵌 | **4**（默认） | 1 层根编排 + 3 层分解；覆盖大多数任务 |
| 确定性流水线嵌套 | **8**（硬上限） | 纯确定性编排可以更深，但要有审批 |
| 无界循环 / 递归模板 | **禁止** | 必须改成 `max_iterations` + budget |
| 计数口径 | **orchestrator 跳数** | 顺序流水线的 10 个 stage 不算 10 层；只有「引擎套引擎」才 +1 |

补充：
- 深度限制必须由**内核**执行，不能只写在引擎 descriptor 里；引擎的 `max_depth` 只作为上限输入，内核取 `min`。
- 深度与 fan-out 分开限制：宽而浅（parallel research）和窄而深（recursive refine）是两种风险。
- 每个分支可以有独立的 `depth_budget`（从父继承，不能重置）。

### 6.2 预算

**账本模型**：

```text
available = limits - used - reserved
child.limit = min(floor(available * share), available - reserve_floor)
Σ siblings.reserved ≤ 0.8 * available
reserve_floor = 20% * available      // 留给收口、验证、补偿（按当前可用额算）
```

**示例**：root 1,000,000 tokens；已用 100,000；available 900,000。
- 单个子节点 `share=0.5` → 450,000；reserve_floor=180,000；不会把 900k 全给出去。
- 4 路 fan-out，每路 `share=0.2` → 每路 180,000；总和 720,000 ≤ 0.8 × 900,000。

**规则**：
- 预算是**绝对账本**，不是每层倍数；retry 也记账。
- `retry_budget` 单独限制（例如 root 的 20%），防止「每层 3 次」相乘。
- `deadline` 是绝对时间；子 `timeout_ms` 只能缩小剩余时间，不能重置。
- `fanout` 也是预算：每个节点 `max_children`，每个 run `max_nodes`。
- 预算耗尽的行为必须声明：`PARTIAL`（返回部分结果）或 `FAILED`（整体失败）。

### 6.3 权限

- **衰减格**：`child.grants = parent.grants ∩ requested`；`child.denies = parent.denies ∪ new_denies`；子永远不能「加回」父没有的权限。
- **secret 只引用**：`secret_refs` 不内联；子只能拿到父已授权的引用。
- **沙箱只能更窄**：`fs_read/fs_write/network` 子集；默认 `READ_ONLY`，写操作要显式升级。
- **升级必须人工**：`approval_ref` 只能由 `ApprovalPort` 产生；模型不能自批（这一点上，DSH 的 `confirmed_by_human` 防伪是正确方向）。[E]
- **隔离模式**：子编排默认 `session=NEW`；并行探索用 `FORK`；只有多轮对话续接才 `REUSE`。代码修改默认 `workspace=WORKTREE`。
- **工具 allowlist**：按节点授权，不按引擎授权；handoff 时权限随控制权走，不能留在原 agent。

### 6.4 停止条件

| 条件 | 检测器 | 默认阈值 | 动作 |
|---|---|---|---|
| DoD / 验收通过 | verifier / acceptance | 1 次通过 | `SUCCEEDED` |
| 预算耗尽 | 预算账本 | 任一维度归零 | `BUDGET_EXHAUSTED`（部分或失败） |
| 深度超限 | 内核 | `max_depth` | 拒绝 spawn，`CONTRACT` 错误 |
| 绝对 deadline | Clock | 到点 | `TIMEOUT` + 取消子树 |
| 无进展 | 状态 hash / 错误签名 | 连续 3 次相同 | 停分支，标记 `STALLED` |
| 验证器连续否决 | verifier | 2 次 | 升级人工 / 换策略 |
| fan-out 超限 | scheduler | `max_children` | 排队或拒绝 |
| 循环无上限 | 引擎 | 必须配置 `max_iterations` | 未配置则 `validate` 拒绝 |
| handoff 乒乓 | hop counter | 例如 8 次 | 停止并回报 |
| 人工停止 | CancelState | — | `CANCELLED` |

**关键**：ADK 的 `LoopAgent` 默认 `max_iterations=None` 是反面教材；任何「循环/递归」原语在 `validate` 阶段就应该拒绝「没有上限」的计划。[F][E]

### 6.5 失败语义

| 场景 | 默认 | 可选 | 说明 |
|---|---|---|---|
| 树节点失败 | `PROPAGATE` + 取消兄弟 | `ABSORB` / `COMPENSATE` | 树的 DoD 依赖所有子节点，默认 fail-fast |
| DAG 分支失败 | 控制依赖 `PROPAGATE`；可选分支 `ABSORB` | join 按 quorum | 不要把「可选分支」和「关键路径」混为一谈 |
| 子 run 取消 | `CANCELLED`，不重试 | — | 取消不是失败，不要计入失败率 |
| 子 run 超时 | 幂等则重试，否则失败 | `RETRYABLE` / `FATAL` | 重试消耗同一预算 |
| 预算耗尽 | `PARTIAL`（若声明允许）否则 `FAILED` | — | 部分结果必须显式标注 |
| 权限拒绝 | `PERMISSION`，不重试 | 升级人工 | 不要用重试掩盖权限问题 |
| 契约违反 | `CONTRACT`，fail-closed | — | 记录并告警，不静默降级 |
| 验证失败 | `VERIFICATION` | 重新规划 / 人工 | 不要直接判成功 |

**父失败时子怎么办**：默认取消所有未完成子（结构化并发）；只有显式 `detach` 的子才允许继续，但必须有 lease + reaper + 独立预算，且不能写回父的 checkpoint。[E]

### 6.6 终止性论证（为什么这些边界能保证停）

设：
- `D` = 最大 orchestrator 深度；
- `B` = 根预算（取最紧的那个维度）；
- `ε` = 最小可消耗单位；每次 spawn 必须预留 `≥ ε`；
- `deadline` 绝对且单调；
- 取消后禁止 spawn；
- 循环引擎必须有 `max_iterations`。

则：
1. 任意 run 树的深度 ≤ `D`；
2. 任意路径上的 spawn 次数 ≤ `B/ε`（预算严格递减）；
3. 循环次数 ≤ `max_iterations`；
4. 所有 run 在 `deadline` 前结束或被取消。

因此总节点数有限，系统必然终止。**缺少 `ε`（零成本 spawn）或缺少 `max_iterations`，证明不成立**——这就是为什么「预算下限」和「循环上限」是契约的一部分，而不是可选优化。

### 6.7 参数建议（起步值，按负载调）

| 参数 | 默认 | 硬上限 | 说明 |
|---|---|---|---|
| `max_depth` | 4 | 8 | LLM 自主分解用 3 |
| `max_children` / node | 8 | 32 | 超过则排队 |
| `max_nodes` / run | 256 | 2000 | 防止爆炸 |
| `max_attempts` / node | 3 | 5 | 只对 `RETRYABLE` |
| `retry_budget` | root 的 20% | 30% | 防嵌套相乘 |
| `reserve_floor` | available 的 20% | 30% | 留给收口/验证/补偿 |
| `cancel_grace_ms` | 30,000 | 120,000 | 优雅取消窗口 |
| `detached_lease_ms` | 900,000 | 3,600,000 | 孤儿回收 |
| `no_progress_threshold` | 3 | 5 | 相同状态/错误 |
| `verifier_veto` | 2 | 3 | 连续否决升级 |
| `human_gate_timeout` | 30 min | 24 h | 交互/批处理不同 |

---

## 7. 反模式（Anti-Patterns）

### AP1 双重记账：会话图与任务图都声称自己拥有生命周期

**症状**
- 任务树显示节点 `RUNNING`，会话图显示 session 已 `CLOSED`。
- 同一个逻辑节点在 UI 出现两次（一个来自 tree，一个来自 session）。
- 恢复时从 task graph 读一个状态、从 session graph 读另一个状态，互相覆盖。
- 对账 job 定期「修数据」，越修越乱。

**根因**
- 创建子任务和创建子会话是两个独立事务，没有唯一 `run_id` 关联。
- 两层都写 `status`，都认为自己是 source of truth。
- 用「session 父子」直接推导「task 依赖」，或反过来。

**证据**
- Airflow SubDAG 曾是「另一个 DAG + 独立调度实体」，带来槽位/参数/边界 case，最终被 TaskGroup 取代。[F]
- LangGraph per-thread 子图并行调用同一 namespace 会 checkpoint 冲突（`MULTIPLE_SUBGRAPHS`）。[F]
- MS AF 并发 `WorkflowExecutor` 共享同一 workflow 实例，子 executor 必须无状态。[F]

**修复**
- 定一条铁律：**session 层只写 session 事件；engine 只写 run 事件；projector 只读**。
- 用一个 `run_id` 作为唯一关联键；task 节点只存 `run_id` / `session_id` 作为属性，不拥有其状态。
- 幂等 spawn：`dedupe_key = hash(root_run_id, node_path, plan_version)`；重复 spawn 返回同一 handle。
- 投影对账只做「事件 → 视图」，不做「视图 → 视图」。

### AP2 引擎互相 import / 循环依赖

**症状**
- tree engine 为了执行子流程 `import dag`；dag engine 为了「子任务」`import tree`。
- kernel 里出现 `switch(engineType)`。
- 两个引擎版本必须一起发；升级一个就崩另一个。
- 单元测试必须同时启动两个引擎。

**根因**
- 把「组合」实现成「直接调用」，而不是「通过契约 + 运行时」。
- 没有依赖倒置；引擎把另一个引擎当成库，而不是插件。

**证据**
- 微内核模式要求 plug-in 独立、互不依赖，核心只负责注册/契约/编排。[F]
- 六边形架构用 ports & adapters 把领域逻辑与技术实现隔离。[F]

**修复**
- `contract` 包零依赖；引擎只依赖 contract。
- 所有跨引擎调用走 `NodeRuntime`；引擎拿不到另一个引擎的类型。
- 依赖规则进 CI（dependency-cruiser / ArchUnit / import-linter），违反即失败。
- 引擎注册按 capability，不按类型；内核不做 `if engine == "dag"`。

### AP3 嵌套 scope 泄漏：预算、权限、取消、孤儿

**症状**
- 子 run 的预算从根重新开始，嵌套越深花得越多。
- 每层 `retry=3`，4 层就是 81 次尝试。
- 父取消后子还在跑，甚至继续写结果。
- 子继承了父的全部环境变量/密钥，权限没有收窄。
- 父结束后留下孤儿 session，没人回收。

**根因**
- scope 是「复制」而不是「派生」；没有衰减不变量。
- 取消只是标记父状态，没有向子传播。
- 没有 orphan reaper / lease。

**证据**
- Erlang：嵌套监督者的重启强度相乘（10 × 10 = 100）。[F]
- Temporal：`ParentClosePolicy` 默认 `Terminate`，说明「父关闭后子怎么办」必须显式设计。[F]
- Airflow SubDAG 占满 worker slot 导致死锁，是资源泄漏的另一种形态。[F]
- MS AF：子工作流未处理异常时，父默认继续执行（C#），不处理就会「看起来成功」。[F]

**修复**
- `ScopeFactory.derive(parent, node)` 只做减法：预算预留、权限交集、deadline 取 min、depth+1。
- `CancelState` 随 scope 传播；`runtime.checkCancel` 在每个边界检查；取消后所有写操作带 epoch，旧 epoch 丢弃。
- 孤儿回收：`detach` 必须带 lease；reaper 扫描过期 run；父关闭默认 `CANCEL`。
- 预算/权限/取消的 conformance tests（T2/T3/T7）作为发版门槛。

### AP4 命名空间碰撞：checkpoint / journal / port 串写

**症状**
- 两个并行子图写同一个 checkpoint key，恢复时加载错状态。
- 两个嵌套 run 的 journal 文件同名，replay 重复或丢事件。
- 子工作流的 human-in-loop 请求端口和父的端口冲突，响应路由到错的人。
- 位置型 namespace（`node|1`）在重排后错位。

**根因**
- namespace 用自增计数器/短 id，而不是稳定路径。
- 引擎自己生成全局 key，内核不校验。
- 并行兄弟没有强制隔离。

**证据**
- LangGraph：per-thread 子图并行调用会写同一 namespace；位置型后缀在重排时会错位，建议用唯一 node name 做稳定命名。[F]
- MS AF：子工作流的 request port 必须加 `SubWorkflow.` 前缀，才能把响应路由回正确实例。[F]
- Temporal：child workflow 有独立 Event History，天然隔离。[F]

**修复**
- 统一 `namespace = root_run_id + "/" + join(node_path, "/")`，由内核生成。
- 端口 id = `namespace + "/" + local_port_id`；禁止裸端口名。
- 并行兄弟的 `node_id` 必须不同；plan 校验时检查重复。
- 恢复时校验 `CheckpointRef.namespace` 与当前 path 一致；不一致直接拒绝。

### AP5 UI 绑死单一引擎：把视图当执行实体

**症状**
- UI 直接查引擎数据库；换引擎就要重写 UI。
- 嵌套引擎的节点在 UI 不可见，或者被压成一个不透明节点。
- 取消按钮只对某个引擎有效；resume 按钮对另一个引擎报错。
- 把「分组/折叠」当成「子流程」，点击分组触发重新执行。

**根因**
- 没有投影契约；UI 和引擎共享内部模型。
- 把 UI 分组（TaskGroup）误当成执行实体（SubDAG）。

**证据**
- Airflow：SubDAG 是独立调度实体，TaskGroup 只是 UI 分组；后者成为推荐做法。[F]
- MS AF：子工作流中间事件归因到 `WorkflowExecutor` id，保持封装。[F]
- LangGraph：`stream.subgraphs` 暴露 path，UI 不需要解析 namespace。[F]

**修复**
- UI 只消费 `TopologyProjection`；节点带 `engine_id` / `parent_node_id` / `capabilities`。
- `CONTAINMENT` 边表达嵌套；`DEPENDENCY` 边表达 DAG；`HANDOFF` 边表达控制权转移。
- 按钮由 `capabilities` 驱动（can_cancel / can_resume / can_approve），不按引擎类型硬编码。
- 投影 revision 单调；UI 做增量更新，断线重连拉全量。

### 7.6 失败案例速查

| 案例 | 现象 | 教训 | 来源 |
|---|---|---|---|
| Argo 间接递归 | A→B→A 可绕过递归保护，控制器无限递归 | 递归保护要覆盖**调用图**，不只是直接自调用 | issue #11499 |
| ADK `LoopAgent` | Python `max_iterations=None`，不设就无限循环 | 循环原语必须有默认上限或 `validate` 拒绝 | ADK 文档 |
| Airflow SubDAG | 子 DAG 占满 worker slot → 死锁；独立参数/调度漂移 | 不要把嵌套单元做成第二个调度实体 | Astronomer / AIP-34 |
| LangGraph `MULTIPLE_SUBGRAPHS` | per-thread 子图并行调用写同一 namespace | 并行必须分配唯一 namespace | LangGraph 文档 |
| MS AF 并发子工作流 | 多个并发执行共享同一 workflow 实例 | 子 executor 必须无状态，或每次执行新实例 | MS AF 文档 |
| Temporal Continue-As-New | 父 continue 后旧 child 不进入新实例 | 长任务要设计 child 的归属与迁移 | Temporal 文档 |
| AutoGen Team | 无内建 checkpoint；嵌套 team 每次 reset | 嵌套不等于持久化；要显式设计状态 | 迁移指南 / API 文档 |
| Argo WorkflowTemplate 嵌套 | WorkflowTemplate 不能以 `workflowTemplateRef` 嵌套另一个 WorkflowTemplate | 静态复用与运行时嵌套是两件事 | discussion #13221 |

---

## 8. 落地路线（建议）

### 8.1 三阶段

| 阶段 | 交付 | 退出标准 |
|---|---|---|
| **P0 契约冻结（1–2 周）** | `contract` 包：对象模型 + 12 条不变量 + 错误码；`TopologyProjection` schema；conformance test 骨架 | 两个 mock engine（tree/dag）能互相嵌套跑通 T1–T5 |
| **P1 tree engine 参考实现** | 严格树、DoD、验收、预算/取消、session 适配 | 单引擎生产可用；预算/取消/恢复测试全绿 |
| **P2 dag engine + 外部 adapter** | 自由 DAG、join/条件/循环上限；Temporal 或 Argo adapter | A→B→A 递归、跨引擎取消、跨引擎恢复通过 |
| **P3 投影与 UI** | `TopologyProjection` 投影器；UI 覆盖层；成本/审批/回放 | 换引擎 UI 不改；嵌套节点可见；取消/恢复按钮正确 |

### 8.2 验收指标

- 嵌套 run 成功率 ≥ 单引擎基线（不因嵌套显著下降）。
- **孤儿 run 率 = 0**（父结束后无未回收子）。
- **预算超卖 = 0**（所有 run 的 `used ≤ limits`）。
- 取消确认 p95 ≤ 5s（grace 内）；强制终止 p99 ≤ 30s。
- 恢复成功率 ≥ 99%（支持 resume 的引擎）；重复副作用 = 0。
- 投影延迟 p95 ≤ 1s；投影与引擎状态对账差异 = 0。
- 双引擎互嵌的契约测试覆盖 T1–T12。

### 8.3 不建议做的事

- 不要造一个「通用工作流 DSL」让所有引擎都解释；plan 必须是 opaque，引擎各自解释。
- 不要让内核实现调度算法；内核只做 registry / scope / budget / cancel / event / projection。
- 不要让 UI 直接查引擎 DB；不要为每个引擎写一套 UI。
- 不要让引擎互相 import；不要共享可变单例。
- 不要给「递归」默认无限；不要给「循环」默认 `None`。
- 不要用 session 父子关系替代 task 依赖；也不要用 task 依赖替代会话 lineage。

---

## 9. 参考与证据索引

> 访问时间：2026-11-12。`[F]` 官方文档/源码/issue；`[P]` 论文；`[E]` 工程推断（仅用于本报告的设计建议，不在下表）。

| # | 来源 | 类型 | 用于 | URL |
|---|---|---|---|---|
| 1 | AutoGen `SocietyOfMindAgent` API | F | 嵌套 team、每次 reset | https://microsoft.github.io/autogen/0.5.3/reference/python/autogen_agentchat.agents.html#autogen_agentchat.agents.SocietyOfMindAgent |
| 2 | AutoGen PR #4110 | F | nested team 实现 | https://github.com/microsoft/autogen/pull/4110 |
| 3 | AutoGen discussion #4234 | F | nested chat 设计仍在演进 | https://github.com/microsoft/autogen/discussions/4234 |
| 4 | MS Agent Framework migration guide | F | AutoGen Team 无 checkpoint | https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/ |
| 5 | OpenAI Agents SDK multi-agent | F | handoff vs agents-as-tools | https://openai.github.io/openai-agents-python/multi_agent/ |
| 6 | OpenAI Agents SDK running agents | F | `maxTurns` 默认 10 | https://openai.github.io/openai-agents-js/guides/running-agents/ |
| 7 | OpenAI Agents SDK sessions | F | 会话持久化 | https://openai.github.io/openai-agents-python/sessions/ |
| 8 | LangGraph subgraphs | F | 两种组合、三种持久化 | https://docs.langchain.com/oss/python/langgraph/use-subgraphs |
| 9 | LangGraph `MULTIPLE_SUBGRAPHS` | F | namespace 冲突 | https://docs.langchain.com/oss/python/langgraph/errors/MULTIPLE_SUBGRAPHS |
| 10 | LangGraph interrupts | F | `interrupt` / `Command(resume)` | https://docs.langchain.com/oss/python/langgraph/interrupts |
| 11 | LangGraph `Command` | F | `Command.PARENT` 跨图导航 | https://reference.langchain.com/python/langgraph/types/Command |
| 12 | CrewAI processes | F | sequential / hierarchical | https://docs.crewai.com/en/concepts/processes |
| 13 | CrewAI flows | F | 事件驱动 Flow | https://docs.crewai.com/en/concepts/flows |
| 14 | CrewAI flow state | F | `@persist` 恢复/分叉 | https://docs.crewai.com/en/guides/flows/mastering-flow-state |
| 15 | Google ADK workflow agents | F | Sequential / Parallel / Loop | https://adk.dev/agents/workflow-agents/ |
| 16 | Google ADK LoopAgent | F | `max_iterations=None`、escalate | https://adk.dev/agents/workflow-agents/loop-agents/ |
| 17 | Google ADK multi-agent patterns | F | 层级/顺序/并行/循环 | https://adk.dev/workflows/patterns/ |
| 18 | Strands multi-agent patterns | F | agents-as-tools / Graph / Swarm / Workflow | https://strandsagents.com/docs/user-guide/sdk/multi-agent/multi-agent-patterns/ |
| 19 | Strands Graph | F | `max_node_executions` / timeout | https://strandsagents.com/docs/user-guide/sdk/tools/vended-tools/graph/ |
| 20 | Strands Swarm API | F | `max_handoffs` / `max_iterations` / `execution_timeout` | http://strandsagents.com/docs/api/python/strands.vended_tools.swarm.swarm/ |
| 21 | MS Agent Framework sub-workflows | F | WorkflowExecutor、checkpoint、qualified port、并发警告 | https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/advanced/sub-workflows |
| 22 | AgentScope pipeline | F | sequential / fanout / MsgHub | https://doc.agentscope.io/tutorial/task_pipeline.html |
| 23 | MetaGPT paper | P | SOP / 角色 / 共享消息池 | https://arxiv.org/abs/2308.00352 |
| 24 | Temporal child workflows | F | 独立 Event History、Continue-As-New | https://docs.temporal.io/child-workflows |
| 25 | Temporal Parent Close Policy | F | Abandon / RequestCancel / Terminate | https://docs.temporal.io/parent-close-policy |
| 26 | Temporal `ChildWorkflowCancellationType` | F | 四种取消传播语义 | https://typescript.temporal.io/api/enums/proto.coresdk.child_workflow.ChildWorkflowCancellationType |
| 27 | Temporal workflow versioning | F | deterministic replay / patching | https://docs.temporal.io/workflow-versioning |
| 28 | Argo WorkflowTemplates | F | `templateRef` / `workflowTemplateRef` | https://argo-workflows.readthedocs.io/en/latest/workflow-templates/ |
| 29 | Argo recursion | F | 模板递归 | https://argo-workflows.readthedocs.io/en/latest/walk-through/recursion/ |
| 30 | Argo issue #11499 | F | 间接递归未阻止 | https://github.com/argoproj/argo-workflows/issues/11499 |
| 31 | Argo discussion #13221 | F | WorkflowTemplate 不能嵌套 WorkflowTemplate | https://github.com/argoproj/argo-workflows/discussions/13221 |
| 32 | Camunda call activities | F | 新流程实例、变量映射 | https://docs.camunda.io/docs/components/modeler/bpmn/call-activities/ |
| 33 | Airflow SubDAGs（Astronomer） | F | 槽位/死锁/参数漂移 | https://www.astronomer.io/docs/learn/2.x/subdags |
| 34 | Airflow AIP-34 TaskGroup | F | TaskGroup 是 UI 分组 | https://cwiki.apache.org/confluence/pages/viewpage.action?pageId=148645525 |
| 35 | Airflow SubDAG removal | F | 3.0 移除 SubDAG | https://apache.googlesource.com/airflow/+/d8c7d28411bea04ae5771fc1e2973d92eb0a144e/newsfragments/41390.significant.rst |
| 36 | Erlang supervisor | F | 重启强度、逆序终止、shutdown | https://www.erlang.org/doc/system/sup_princ.html |
| 37 | ADaPT paper | P | 按需分解、`d_max=3`、收益 | https://arxiv.org/abs/2311.05772 |
| 38 | ADaPT (ar5iv) | P | 表格中的 `dmax=3` | https://ar5iv.labs.arxiv.org/html/2311.05772 |
| 39 | MAST paper | P | 14 类失败模式、200+ traces、7 框架 | https://arxiv.org/abs/2503.13657 |
| 40 | MAST (ar5iv) | P | 终止/验证失败模式 | https://ar5iv.labs.arxiv.org/html/2503.13657 |
| 41 | Cognition "Don't Build Multi-Agents" | P | context 碎片化、共享完整 trace | https://cognition.ai/blog/dont-build-multi-agents |
| 42 | Microkernel pattern | F | 核心 + 插件 + 注册表 + 契约 | https://www.oreilly.com/library/view/software-architecture-patterns/9781491971437/ch03.html |
| 43 | Hexagonal architecture | F | ports & adapters | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html |
| 44 | Saga pattern | F | orchestration vs choreography | https://microservices.io/patterns/data/saga.html |
| 45 | Structured concurrency | F | nursery、取消、错误传播 | https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/ |
| 46 | MCP lifecycle | F | 版本/能力协商、超时、取消 | https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle |
| 47 | Kubernetes CRD versioning | F | 多版本 + conversion | https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/ |
| 48 | LSP specification | F | `initialize` 能力协商 | https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#initialize |
| 49 | Google ADK sessions / state | F | `app:` / `user:` / `temp:` 状态作用域 | https://adk.dev/sessions/ |
| 50 | AutoGen 0.2 nested chat | F | `register_nested_chats` 作为早期嵌套形态 | https://microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/ |

---

## 10. 附：给评审的一页纸

**如果只能记三件事**：

1. **子编排 = 一次独立 run + 一个稳定 path + 一个独立 namespace**；不是 inline 展开，也不是共享单例。
2. **scope 只做减法**：预算、权限、deadline、取消都随嵌套收紧；任何「每层重置」都会在 4 层后爆炸。
3. **UI 只读投影**：`CONTAINMENT` / `DEPENDENCY` / `HANDOFF` 三种边，足以画出任意异构嵌套；不要为每个引擎写 UI。

**如果只能改一处**：

> 先把「会话图 / 任务图 / 运行图」三者的写者分开，再谈插件化。否则无论契约多漂亮，都会退化成双重记账。

**如果只能加一条测试**：

> A 引擎 → B 引擎 → A 引擎，父取消，检查：子全部取消、无迟到写入、预算不超卖、投影正确、恢复可重入。
