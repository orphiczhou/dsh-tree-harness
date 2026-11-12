# 组合式会话编排体系评估与设计（v0.1 · 红队修订）

> 状态：**评估/设计草案（候选态）**，不是已批准决策。
> 产出人：Lead（指挥官 + 架构师）· 日期：2026-11-12 · 基线：本仓 `master` @ `1b1f610`；DSH `0.2.2-rc.1`；profile `desktop`。
> 方法：4 位专家只读取证（E1 仓库耦合 / E2 DSH 平台 asar / E3 自由流程引擎 / E4 SOTA 组合模式）→ Lead 综合 v0 → **1 位红队专家证伪评审** → v0.1 修订。证据标记：`FACT` / `INFERENCE` / `UNKNOWN`；专家报告在仓外 `D:\Codes\_composition-research\`（不入库）。
> 修订说明：v0.1 按红队 S1–S6 严重缺陷、M1–M9 遗漏、N1–N7 内部不一致修订；**主叙事从"拆分低风险/零代码过渡"纠偏为"先测一个关键未知 + 一个必须的代码开关 + 三个数据面小改 + 一页约定"**。红队报告：`D:\Codes\_composition-research\REDTEAM-review.md`。

---

## 0. 结论先行（修订后）

### 0.1 对三个问题的直接回答

| # | 问题 | 结论（置信度） |
|---|---|---|
| 1 | 把会话树（UI + 会话操作插件）与树形任务约束 tree-harness **拆成两个独立项目/插件**，是否可行？ | **运行时层面：可行，且今天已事实独立**（3 个独立 bundle / 3 条独立 `link:` / 各自 patch 与 skill provider / 各自状态域 / **0 跨包 import、0 dependencies/peerDependencies**）。**但"拆仓=零运行时改动、约 3+6 人日"不成立**：拆仓会移出 profile `hmr.root`（两个**绝对目录**，新仓不在其中→失去热更）、**反转 D1「本仓=唯一源码事实源」**、废掉单向镜像发布链与检查清单、镜像仓不是开发仓（本机无 checkout / 无 CI）、发布门禁要跑两遍。**建议：现在不拆**，把事实写清楚并挂两个触发器（npm 解冻 / 出现第二个独立消费方）。 |
| 2 | **tree-harness 和 DSH 内置子智能体插件之间是什么关系？** | **控制面 / 执行面**。平台负责会话创建/恢复、消息投递、中断、血缘、权限/审批继承、会话日志、事件观察、令牌计量、存储与 UI 槽位；tree-engine 负责**任务拓扑与治理**（任务树、依赖闸、派发策略、DoD/验证、竹节接力、预算、账本）。E2 结论：**DSH 是「会话运行时 + 能力总线」，不是编排引擎**；编排层应定位为 DSH 之上的**任务账本 + 对账器 + 只读视图**。需修正的措辞：竹节接力（interrupt 旧会话→起新会话）**部分重造了"续接"语义**，它是 tree-engine 的会话轮换策略（平台没有等价物），不能简单说成"完全不重造"。 |
| 3 | 让 tree-harness 与自由流程引擎**互相组合、递归嵌套**，形成各种组织形态，是否可行？ | **方向可行，但当前可靠性被高估、递归旗舰用例在当前 profile 下不可达**。① **软组合**（节点会话调另一引擎工具）今天"能演示"，**不能无人值守**：tree 的竹节是**定时器自主触发**的会话替换器（会打断 flow 的 `await`）、flow 的 `activeRun` **单槽**（flow 套 flow 会互相覆盖取消）、`callerOrigin=subagent` 会把权限 ceiling 静默压到 `safe`、工具结果 600/4000 截断、前台同步无后台 job。② **结构化嵌套**今天不可行（两侧无服务面/事件/取消 handle/executor 注册），且"契约 12 条不变量内核强制"**没有执行点**（平台唯一可插拔执行面是 `subagents.registerProvider`，两个引擎都只是消费者）。③ **递归**：`maxDepth=4` + tree 自身 2 层 + flow 节点 1 层 = 内层 worker 正好第 4 层，再任一 verify/judge（会另起会话）或 handoff 即 `SubagentDepthError`——**"tree→flow→tree + verify + 审批分流"在当前 profile 不可达**。要三层组合必须先调大 `maxDepth` 并写清风险与代价。 |

### 0.2 一句话判断（修订）

**方向对（分层、四图分离、禁止引擎互 import、不做公共 adapter 包都成立）；但第一动作既不是拆仓，也不是 45–73 人日的"契约内核"。** 正确顺序是：**先测一个决定后续所有方案是否安全的关键未知（竹节定时器会不会自主打断运行中的 flow）→ 加一个必须的代码开关（per-leaf relay 抑制）→ 做三个数据面小改（lineage、cancel/多槽、结果引用）→ 写一页组合约定**（合计约 4–6 人日）；拆仓、内核、注册表、统一拓扑 UI、tree 服务化**现在都不做**（理由与触发条件见 §6、§7）。

### 0.3 推荐目标形态（North Star，方向参考，非本轮承诺）

```text
┌────────────────────── L3 呈现层（只读投影） ──────────────────────┐
│ 会话谱系树（session-tree） + 各引擎只读拓扑投影 / Inspect          │
│ 统一查看：run / node / attempt / session / 成本 / 审批              │
└──────────────────────────────▲────────────────────────────────────┘
                               │ TopologyProjection（只读，不反向写）
┌──────────────────────────────┴────────────────────────────────────┐
│ L1 编排契约（当前只落"一页 5 条必须规则"；目标态才是 ABI/协商）      │
└───────▲───────────────────────▲───────────────────────▲────────────┘
        │ 只依赖契约            │ 只依赖契约            │ 只依赖契约
┌───────┴────────┐     ┌────────┴────────┐     ┌────────┴─────────┐
│ tree-engine    │     │ flow-engine     │     │ agent-team /    │
│ 严格树/DoD/竹节 │     │ 自由 DAG/journal│     │ 外部 adapter    │
└───────▲────────┘     └────────▲────────┘     └────────▲─────────┘
        └──────────── L0 会话/事件底座（DSH 平台）──────────────┘
          session lineage · subagents · approval · storage · UI slots
```

### 0.4 五个设计判断（保留；第 5 条按平台事实修正）

1. **组合的单位是"一次有独立身份的 run"，不是"一张图"**。子编排必须有独立 `run_id` / `path` / 命名空间；inline 展开无法独立取消/恢复/计费。
2. **换命名空间，不换执行器**：父引擎只拿子引擎的 `RunHandle`，不知道对方是树还是 DAG。
3. **预算/权限/取消只能单调衰减，不能每层重置**（Erlang 监督树重启强度相乘是反例：4 层 × retry 3 = 81 次尝试）。
4. **持久化事实源只能有一个**：session 生命周期归会话层，run 生命周期归引擎；任务树/DAG/组织图都是**投影**。
5. **递归边界默认要小**：LLM 自主分解 `depth=3` 是研究建议值；**当前 DSH profile 的硬上限是 `maxDepth=4`**（不是 8——8 只是目标态建议的硬帽，实际以 profile 为准，内核/约定必须取 min）。没有"预算递减 + 绝对 deadline + 无进展检测"的递归不允许上线。

### 0.5 你的设想到分层的映射（逐条回应）

| 你的设想 | 对应分层 | 评估（修订后） |
|---|---|---|
| 「会话树是基础，可以显示树形的会话关系和简单的分级调用，依赖于 DSH 的子智能体插件」 | **L0 平台 + L1 session-tree（观察/通用会话面）** | ✅ 判断正确。会话谱系是平台事实；session-tree 只做只读渲染 + 通用会话操作（`tree_send`/`session_handoff`），**不应**承载编排语义、也不应依赖引擎。 |
| 「tree harness 是严格约束化的树形分解体系」 | **L2 编排引擎** | ✅ 正确。它是跑在会话原语之上的控制面（任务树/DoD/验证/竹节/预算），不是"子智能体插件"的同类。 |
| 「自由流程基于简单的子会话能力……在一级子会话群里建立起流程约束」 | **L2 编排引擎（DAG 型）** | ✅ 描述准确：flow M1 的节点就是**同级平铺的一级子会话**，引擎只加变量/边/门禁/journal 约束，不建层级。 |
| 「tree harness 和自由流程可以相互组合，某个节点的会话再调用子自由会话或者子 tree harness」 | **L1 契约 / NodeRuntime（结构化嵌套）；当前可行的是"节点会话调工具"的软组合** | ⚠️ 修订：软组合**可演示、不可无人值守**（relay 定时器、flow 单槽、权限降级、结果截断）；结构化嵌套需要服务化 + 契约，当前不可行。 |
| 「组合形成各种递归结构 / 千变万化的组织形态」 | **L3 拓扑投影 + 组合代数（拓扑 × 执行语义 × 治理）** | ⚠️ 目标方向成立，但受平台硬约束限制（审批 turnOpen/never、`maxDepth=4`、并发槽位、无预算原语）；递归必须先解决 scope 衰减与取消级联，且当前旗舰三层用例不可达。 |

### 0.6 红队复核后的修正摘要（S1–S6 处置）

| # | 红队缺陷 | 本文处置 |
|---|---|---|
| S1 | **竹节是定时器/自报驱动的会话替换器**：`sweepTick` 用 `usagePct`（宿主测量，当前恒 null）∨ 自报对所有 running leaf 判 42% 并 relay（`src/engine.js:560-567`；定时器 `:587-588`），"leaf 不报 context"只挡自报、挡不住未来修好的宿主测量 | **真机实测（2026-11-12）**：自报即可触发 relay 并打断运行中的 flow（flow journal `cancelled / E_RUN_CANCELLED`）；宿主测量因 inject 缺陷恒 null；timer 自主路径受 reload 残影影响不可靠。→ P0"relay×flow 互斥"作废；**per-leaf relay 抑制开关列为必须项**（第 2 步）；§4.1 定级 ⚠️ |
| S2 | **递归旗舰用例不可达**：`maxDepth=4` + tree 2 层 + flow 1 层 = 第 4 层满；verify/judge/handoff 各 +1 即超限（`index.js:414` judge 另起会话） | §4.3 给出深度算术；§7 验收降为"tree→flow"两层；三层组合需先调 `maxDepth`（列为显式前置+代价） |
| S3 | **拆仓不是零运行时改动**：`hmr.root` 是绝对目录、D1 反转、镜像仓非开发仓、门禁/工具链重做 | §6 重写：拆分真实成本 + 与 D1/D3 冲突；建议现在不拆，挂触发器 |
| S4 | **审批机制被误述**：真实约束 = 请求方会话 `turnOpen` + `policy ≠ never`（`dsh-user-approval` `request()`/`decide()`；`child-agent.js:185` 条件式钉 never） | §1.4/§3 修正；新增 §8 安全章（"root 代批"在 fire-and-forget 形态下不成立；**借用 root Agent 句柄请求审批是未申明的越权面**） |
| S5 | **契约无强制点**：内核/注册表/12 条不变量没有执行面，只会变成第 4 份文档债 | §5.2 收缩为"一页 5 条必须规则"；内核/注册表降级为"条件满足后再评估"（§7.6） |
| S6 | **软组合被高估**：flow `activeRun` 单槽（`flow-core/src/engine.js:268`）、`callerOrigin=subagent` ceiling→`safe`（`permissions.js:448-451`）、结果截断、前台同步 | §4.1 改为"可演示、不可无人值守"并列出四类静默失效；flow 套 flow 明确标 ❌（多槽修复前） |

---

## 1. 现状事实基线

### 1.1 四个共存的组件（同 profile，独立安装）

| 组件 | 版本/形态 | 工具面 | 状态落盘 | UI | 与其它组件的关系 |
|---|---|---|---|---|---|
| `@orphiczhou/dsh-session-tree` | v1.3.7，公开插件（镜像仓已发布） | `tree_send`、`session_handoff`（2 个） | 无自有状态（交接写工作区 `HANDOFF-*.md`） | 左栏会话谱系树（`sidebar.workspaces` 槽位，客户端半） | **0 代码依赖**任何引擎；UI 数据 100% 来自 DSH 客户端 slot props（`useSessions`），无 Host RPC |
| `@local/dsh-tree-engine` | v0.8.0，本仓私有包 | 9 个 `tree_*` | `<profile>/tree-engine-data/<tree_id>/tree-state.json`（单文件全量状态） | 无（仅工具/Inspect 读数） | 依赖 DSH `subagents/sessionQuery/tools`；对 session-tree 仅**软依赖**（叙事 + 可选 `session_handoff` 兜底）；v0.8.0 已加 per-leaf relay 开关 |
| `@local/dsh-flow-engine`（自由流程） | M1，独立项目 `D:\Codes\DSH动态流程引擎插件` | 4 个 `flow_*` | **profile 钉死的绝对路径单目录** `D:/Codes/…/.dsh-flow/runs/*.jsonl`（不是 per-workspace） | 自有右侧栏只读面板 | 0 代码依赖树/会话树；使用同一批 DSH 会话原语 |
| `@deepseek-ai/dsh-experimental-agent-team`（平台内置，实验性） | DSH 自带 | `spawn_teammate` / `send_message` / 团队任务板工具 | 持久会话存储 + Lead journal（roster/tasks） | 平台自带 Team 视图（projection） | 平台原生"组织形态"第四种：roster + 扁平任务板（依赖 DAG、CAS）+ 冷恢复；上限 16 成员 / 256 任务；**非树、无验证、无预算** |

> `FACT`（E1 §1–2；E3 §1；E2 §9.2；本会话 profile 实测 4 个 bundle 共存）。

### 1.2 三个"大组件"的真实依赖矩阵（E1 审计结论）

| 耦合类型 | session-tree ↔ tree-engine | 结论 |
|---|---|---|
| 代码 import | **0 命中** | 无 |
| npm dependencies / peerDependencies | **全空** | 无 |
| 共享模块 / 测试 fixture | **0** | 无 |
| 文档叙事 | README/AGENT-INSTALL/CHANGELOG/项目地图交叉引用 | 有（可拆，M） |
| 协议 | leaf owner 模型专为「`session_handoff` 不迁移 owner」留了协调协议（`E_BORROWED_IDENTITY` + `tree_node set-session`），两份 SKILL 大量篇幅教模型协调 | 有（语义，可保留；注意它本身就是"双账本"的一个具体形态） |
| 工具链 | `check-version-consistency.mjs` 把三包 × 六文档绑成 20+ 条断言，且以 tree-engine 的 package.json 作为"这是本仓"前提 | 有（拆分主要成本之一） |

> `FACT`（E1 §3、§7、§13）。**"拆成两个独立插件"在运行时已经成立**：不同 bundle 条目、不同 patch insert、不同 skill provider、不同状态域、独立版本号。"monorepo"只是目录约定（无根 package.json、无 workspace 配置）。

### 1.3 两种编排风格互为补充（组合价值的来源）

| 维度 | tree-engine（严格树） | flow-engine（自由 DAG） |
|---|---|---|
| 执行方式 | **派发即返回**（fire-and-forget，`delivery:'parent'`）+ 节点自报 + harvest | **前台 await**（`delivery:'caller'`，`await run.result` → `dispose`） |
| 完成信号 | 节点 `tree_report{type:'done'}` 回流 | `activation.result` 终态 |
| 状态机 | 任务树（leaf/依赖/DoD/attempt/竹节链） | DAG run（node/edge/journal/attempt/adopt） |
| 会话轮换 | **竹节接力：定时器/自报触发，interrupt 旧会话→起新会话**（leaf 不变） | 一次 attempt 一个会话；崩溃用 adopt 只读认领 |
| 治理能力 | 依赖闸、DoD/验证（6 模式 + 对抗式）、预算、竹节 | 变量池/端口、条件/join、门禁 G1–G12、structured output、permTier、human_gate |
| 确定性 | 无确定性承诺（分解/接力/测量都非确定） | DET-1/2（同输入同图同并发 → fold 深相等） |
| 关键弱点 | 无 resume、无派发并发闸、`.lock` 未实现、竹节是自主会话替换器 | 单层平铺、无 subflow/递归、节点无多轮、前台同步、单槽 activeRun、结果截断 |

> `FACT`（E1 §5–6；E3 §3–4）。**一句话：tree 擅长"自适应地决定怎么拆、什么时候换人"，flow 擅长"确定地规定按什么顺序、什么门禁、如何恢复"。**

### 1.4 平台硬约束（修订版）

| 约束 | 值/机制 | 对组合的含义 |
|---|---|---|
| 会话深度 | profile `maxDepth=4`（`cordis.patch.yml:226`）；子深度 = 父 + 1，超限抛 `SubagentDepthError` | tree 2 层 + flow 1 层已到第 4 层；verify/judge/handoff 再 +1 即超限。**这是硬上限，不是建议值** |
| 并发子会话 | `maxActiveSubagents=20`（进程内激活槽位，**不是全局累计预算**，无租约） | 跨引擎 fan-out 互相挤占；嵌套预算无法在平台层观测 |
| 审批（精确机制） | ① `approval.request()` 要求**请求方会话的 turn 处于打开状态**（否则抛 "outside an open turn"）；② 子会话若有 approval 服务则 `approvalPolicy` 被**条件式钉死 `'never'`**（`child-agent.js:185`）；③ policy=never 时 `decide()` 直接返回 `rejected`，不问 answerer | **不是"只能 root"，而是"请求方要有打开 turn + policy≠never"**：flow 形态（root 同步 await）可以 gate；tree 的 fire-and-forget 形态下 root 的 turn 已结束 → **"leaf 发起、root 代批"必死在 `turnOpen`**。子会话内 gate 仍必失败 |
| 权限/预设继承 | `meta.agentPreset` **只写 header、不挂载组合**；须 `setup()` 自 mount 并补写 `permission/preset`、`sandbox/mode`、`approval/policy`（`source:'delegation'`）；仅复制父**显式** sandbox 覆盖 | 程序创建的节点会话不会自动获得父工具集/权限，引擎必须显式继承 |
| 会话元数据 | header 是闭集白名单：**7 个 meta 字段（共 9 个 header 字段）**，未知 meta **静默丢弃**；无 tags/labels | 无法在会话上标注 `runId/nodeId`；只能引擎账本 + `label` + 首条 prompt 前缀 |
| 会话事件 | 第三方**不能注册新的 session event type**（冷恢复读路径直接拒） | 引擎状态必须落自有 storage；跨引擎关联只能靠 id + 自有账本 |
| 调用者身份 | initiator 是进程内 AsyncLocalStorage；无 durable/跨进程身份 | 跨引擎"谁发起/谁有权取消"必须由账本自建 |
| 消息幂等 | 无 exactly-once；accepted-but-unlogged 会丢；activation inbox 不跨进程 | 调度器必须自建 `idempotencyKey` + outbox/inbox 对账 |
| 工作区归属 | `agents.create`/`startActivation` 不挂 workspace；只有 API controller/schedule 调 `attachSession` | 程序创建的节点会话会落 Ungrouped；派发后必须显式 attach |
| 组合注册表 | 平台无注册表；`workflowEngine` 单 provider（第二个 engine 会被 Cordis 拒）；唯一可插拔执行面是 `subagents.registerProvider` | 跨引擎组合需要自建注册表——**但这也意味着"契约内核"没有天然强制点**（S5） |
| 工作流缝 | `ctx.workflowEngine` 被 PTC 占用（同 context 单 engine） | flow 不能占该缝，只能另立工具面（已如此） |
| 开发回路 | `hmr.root` 是 profile 里两个**绝对目录**（`D:/Codes/nanju-dsh/packages`、`D:/Codes/dsh-tree-harness/packages`） | 拆仓移出 hmr.root → 失去热更，宿主半改动必须 disable→enable/重启 |
| API 漂移 | `startContinuable` 已被移除一次（rc.2 换 `startActivation`，`interrupt` authority 也变） | 契约必须能力探测 + 形状防御，不能按版本号判断 |
| 平台无预算原语 | 无 token/成本/时间预算服务（workflow 明确 "No token-budget vocabulary"） | "父给子下预算"没有平台观测点，reserve 只能引擎自报 |

> `FACT`（E2 §0.3/§4/§7/§9；E3 §4/§6；红队 S1–S4/M2/M4；Lead 抽检 `profile/cordis.patch.yml:4-9,226-227,272-280`、`dsh-user-approval/lib/index.js:153-201`、`dsh-subagent/lib/types/child-agent.js:180-186`）。

### 1.5 现实失败率与运营成本（红队 M5）

不是理论风险：Wave-2 的 8 个 leaf 里 **C1、D1b 的 attempt-1 都在结算阶段被节点超时中断**，`D1-integrate` 被 pruned；Wave-1 的 C4 因宿主热重载崩溃中断（`agent.md:171,174,207`）。当前形态高度依赖"人发现 → 再派一次"的兜底。任何把 fire-and-forget 标成 ✅ 的评估，都必须把这一项人肉成本计入。

---

## 2. 概念模型：四种"图"不要混成一张

| 图 | 回答什么问题 | 事实源 | 生命周期所有者 |
|---|---|---|---|
| **会话谱系图**（Session Graph） | 谁创建了谁？上下文从哪继承？ | DSH 会话日志（`parentSession` / `origin`） | **平台**（session-tree 只读渲染） |
| **任务计划图**（Plan Graph） | 应该做什么？依赖/验收是什么？ | tree-state（leaf/parent/DoD）或 flow DSL | 引擎（计划对象） |
| **运行图**（Run Graph） | 实际跑了什么？第几次？状态？ | tree `runtime` / flow journal | 引擎（run 状态机） |
| **组织形态图**（Projection） | 整体长什么样？成本/审批/进度？ | 由上述三类**只读投影**合成 | 投影层（不可反向写） |

**关键映射（必须成为组合约定的一部分）**：

```text
plan_node_id → run_id → attempt(s) → session_id(s)
```

- 一棵**任务树 ≠ 一棵会话树**：tree-engine 的一个 leaf 在竹节接力下可对应**多个会话**；leaf 不变、会话换。
- 一个 **flow 节点** = 一次 attempt = 一个一次性会话（当前语义）。
- 任何"一个节点 = 一个会话"的假设都只在一层成立。组合契约必须显式建模 `node ↔ session(s)` 的多对多/时序关系。
- **谱系判定的两个陷阱**（`FACT`，E2 §3.5）：① 普通 `fork` 也保留 `parentSession`，判断"是不是子智能体"要看 `origin === 'subagent'`；② 第三方不能在会话 header 存业务元数据（白名单静默丢弃），也不能注册新 event type——`runId/nodeId` 只能存引擎账本 + `label`/首条 prompt 前缀。
- 红队补充：leaf owner 与 handoff 不迁移 owner 的协调（`E_BORROWED_IDENTITY` + `set-session`）**正是双账本的一个具体形态**，不能既标"可保留"又把"双账本"标高风险——二者是同一问题的两面。

---

## 3. tree-harness 与 DSH 子智能体插件的关系（专章）

### 3.1 三层职责边界（RACI）

| 能力 | DSH 平台 | tree-engine | 说明 |
|---|---|---|---|
| 会话创建/恢复 | **R/A** | C | `agents.create/resume` |
| 消息投递/唤醒 | **R/A** | C | `sendMessage`/`prompt` |
| 中断 | **R** | C | 只停当前 turn |
| 权限级联 | **R/A** | C（快照请求） | `sandbox/mode`/`approval/policy`/`permission/preset` |
| 日志/持久化 | **R/A** | I | 不要自建会话日志 |
| 谱系发现 | **R** | C | `listChildren`/`traceSession` |
| 任务树/DAG 语义 | — | **R/A** | 平台无 |
| 依赖/就绪/重试 | — | **R/A** | 平台无 |
| DoD/验证 | — | **R/A** | 平台无 |
| 预算记账 | — | **R/A** | 平台无 |
| 调用者身份（durable） | — | **R/A** | 平台无 |
| 拓扑 UI | C（槽位） | **R/A** | 平台只给容器 |
| 跨引擎注册 | — | **R/A** | 平台无 |
| 工作区归属 | C（API） | **R** | 需显式 attach |

### 3.2 代码级证据

- **tree-engine 的宿主适配**：`ctx.inject(['tools','subagents','sessionQuery'])`（`index.js:809`）；引擎核心不 import DSH API，只经 `ports`（`src/engine.js:372-383`）；派发走 `startActivation`（rc.2 形）/`startContinuable`（legacy 形）双形探测 + 返回形状防御（`src/compat.js`，11 测）。
- **派发的结构前提**：`startActivation` 的 `request.parent` 必须是**活 Agent**；`tree_dispatch` 必须由活会话经工具调用发起，竹节接力复用捕获的 `exec.agent` 引用（`index.js:41-44,74-118`）。这不是缺陷，而是"编排由会话发起"的语义。
- **竹节接力**：`sendMessage`/`prompt` 交棒指令 → **interrupt 旧会话** → 起新会话；owner 重绑（`index.js:119-170`；`src/engine.js:484-521`）。红队提醒：这是**会话替换器**，任何在自己的 turn 里等待外部 run 的编排（flow、verify、长命令）都与它不兼容。
- **为什么需要 `tree_send`**：`ctx.subagents.sendMessage(sender,target,...)` 按"精确活发送者"授权，只允许直接父子相邻；跨层/兄弟没有路径。`tree_send` 改用 `subagents.prompt(request,signal)`（按持久父地址授权）实现跨层消息，仍要求目标父会话活着（`session-tree/index.js:40-53,243-293`）。
- **session-tree 的 UI**：纯客户端渲染，数据来自 slot props（`useSessions`），**无 Host RPC**（`client.js:22-33`），另发布只读 Inspect provider `SessionTree`（`client.js:1828-1935`）。
- **平台原生 Agent Team 的启示**：它把"持久日志（Lead journal 拥有 roster/tasks）→ 严格回放投影 → 客户端视图"作为先例；每个服务方法都接收**精确的活调用方 Agent**，只有 Lead 能 spawn/reassign/interrupt（asar `dsh-experimental-agent-team/README.zh.md`）。这与"单一事实源 + 投影 + 显式调用者身份"一致，但它是 experimental、扁平任务板、无验证/无预算，**不能直接复用**。

### 3.3 结论

1. **tree-engine 不是"另一个子智能体插件"**，而是跑在会话原语之上的**编排引擎**；它没有、也不应该重新实现会话树。反之，子智能体插件不理解、也不应该理解任务树。
2. **session-tree 是"会话底座的可视化与通用操作层"**，不是编排层；把约束语义塞进 session-tree，或让它依赖 tree-engine，都会破坏"底座可被任意编排引擎复用"这一目标。
3. 竹节等会话轮换策略由 tree-engine 自己实现，属**有意的编排策略**；但它的存在意味着"平台负责会话生命周期"这句话要加限定：**平台负责单个会话的生命周期，引擎负责"何时换会话"的策略**——两者必须在账本里可区分（`attempt`/`segmentChain` 不得与会话生命周期混为一谈）。

---

## 4. 组合能力评估（修订版）

### 4.1 软组合（agent-mediated）：**可演示，不可无人值守**

| 方向 | 做法 | 判定 | 四类静默失效 |
|---|---|---|---|
| tree 外层 / flow 内层 | tree leaf 会话提示词调 `flow_run` | ⚠️ 演示可用 | ① **relay 会打断 await 中的 flow（2026-11-12 真机实证）**：leaf 自报 pct=45 即触发 relay；宿主测量因 inject 缺陷当前恒 null，但修好后会自主触发；旧会话 interrupt → flow journal `cancelled / E_RUN_CANCELLED`，后续节点未执行、结果丢失（非孤儿，但不可续用） |
| flow 外层 / tree 内层（A+） | flow 的 session 节点当"tree commander" | ⚠️ 受限可用 | ② **flow 单槽 `activeRun`**（`flow-core/src/engine.js:268`）：同时两个 run 时前一个的 cancel/dispose 打到后一个 → **flow 套 flow 不安全**；③ **权限 ceiling**：`callerOrigin=subagent` 且无法解析父 run 时 ceiling 压到 `safe`（`permissions.js:448-451`），root 能跑的 flow 在 leaf 里可能被静默降级；④ **结果截断**：节点输出 600 字符 / outputs >4000 变 `{truncated,preview}` |
| 任意节点调任意引擎 | 节点会话本身是普通 Agent | ⚠️ 同上 | 再加：`flow_run` 前台同步、不注册后台 job；门禁只在 root 可用 |

> 结论：**今天的软组合适合"人看着跑一次"的演示，不适合"无人值守跑一夜"的编排。** 过渡期把它作为官方形态（契约化 + 模板化 + 纪律化）可以，但必须写明这四条失效模式与人工兜底。
>
> **S1 真机实测（2026-11-12，报告 [e2e-composition-relay-2026-11-12.md](../reports/e2e-composition-relay-2026-11-12.md)）**：① 宿主 `usagePct` 恒 null（apply.log 22 条 `tokenMeter.measure unavailable`；inject 缺 `tokenMeter`，catch 直接 return null）；② **自报 `pct=45` 即可触发 relay，flow `S1RELAY-R1` 实测 `run/ended cancelled / E_RUN_CANCELLED / durationMs=61863`**（N1 succeeded 38646ms / N2 cancelled / N3 未执行）；③ timer 自主路径在 reload 残影下"偶发可用、整体不可靠"（24 条 `inactive context` / 快照 14 条 `sweep_error` / tree-state 写竞态）；④ flow 在 leaf 内可正常起（callerOrigin=subagent / permTier=safe / depth 未撞墙），阻塞点不是权限/深度而是 **relay 语义 + 结果交付**；⑤ successor 重跑同 runId 命中 `E_RUN_EXISTS`，flow 结果不可复用。

### 4.2 结构化嵌套（engine-mediated）：**今天不可行**

| 缺什么 | 证据 | 影响 |
|---|---|---|
| 对外 Service / run handle | 两侧都只注册模型工具；活体 Service 目录无 `treeEngine`/`flowEngine` | 引擎 A 无法程序化启动/等待/取消引擎 B |
| `cancel(runId)` 与取消级联 | flow 只有调用方 `exec.signal`；无 `flow_cancel`；CANCELLED 不可 resume；单槽 activeRun | 父无法只杀一个子 run；取消不传播 |
| 完成信号可等待 | tree 是 fire-and-forget + 自报；flow 是 await result | tree 无法作为"可 await 的节点"；flow 无法等 tree 终态 |
| 执行器/节点类型注册 | flow 节点类型编译期闭集（9 种，`docs/04` 明禁自定义）；`createEngine` 单 executor | 别的引擎无法成为 flow 的一等节点 |
| 命名空间与 lineage | flow journal `run/started.ownerSessionId` 写 null（run 级）；`callerSessionId` 只写 sidecar 无人读；journal 平铺 `runs/` | 无法按父 run/子树聚合、无法审计"谁发起" |
| 事件面 | `FlowEngine.on/onAny` 存在但工厂不暴露；无 `ctx.emit` | 父只能轮询 |
| 每树锁 / 多实例安全 | tree `.lock` 未实现 | 程序化第二实例会丢更新 |
| 预算传播 | flow 未接 profile 的 20；tree 无派发并发闸；无跨 run 账本 | 嵌套预算不可控 |
| 审批下沉 | 子会话 approval 钉 `never`（条件式） | 任何子会话内 gate 不可用 |
| 契约强制点 | 平台无注册表；唯一可插拔面 `subagents.registerProvider` 不被两引擎使用 | **"内核强制 12 条不变量"没有执行点**，契约只能靠自觉 |

### 4.3 递归的硬天花板（修订：给出算术）

| 约束 | 当前值/机制 | 递归含义 |
|---|---|---|
| 审批 | 请求方 turnOpen + policy≠never；子会话钉 never | 递归结构里**只有一个 gate 层**（发起 flow_run 且 turn 未结束的那层）；tree 的 fire-and-forget 形态下"root 代批"不成立 |
| 会话深度 | profile `maxDepth=4`；子深度=父+1 | **算术（root=0）**：tree root 0 → commander 1 → worker 2 → flow 节点 3 → 内层 tree worker **4（满）**；再 verify/judge/handoff/再嵌一层 = 5 ✗。**旗舰用例"tree→flow→tree + verify + 审批分流"不可达**；近期验收应降为"tree→flow"两层 |
| 并发会话 | `maxActiveSubagents=20`（进程内激活槽位，无租约） | 嵌套 fan-out 互相挤占；跨引擎无预算观测 |
| 预算 | 各引擎独立记账；平台无 token/时间预算原语 | 父无法给子下发预算；嵌套越深越容易超支 |
| 取消 | 无跨进程/跨引擎 | 父取消后子可能变孤儿（运行到自身墙钟上限） |
| 持久化 | 两套格式（tree-state vs flow journal） | 无跨引擎事务；只能按 id 关联、分别恢复 |

> 若目标必须是三层以上组合：**前置条件 = 调大 `maxDepth`（profile 改动）+ 写清风险（并发/成本/审批）+ 分阶段真机验证**；这不是"配置一下"的事。

### 4.4 结论

组合的第一性问题**不是"接口不够"，而是"会话替换器 vs await 编排"的语义冲突**：tree 的竹节会在任意时刻替换会话，而 flow/verify 等编排在自己的 turn 里等待外部结果。只要这个冲突不解决，"组合的可靠性由定时器决定"。因此路线第一步必须是**测清 relay 行为并加抑制开关**，而不是先写契约。

---

## 5. 目标架构与契约（方向参考；当前只落"一页约定"）

### 5.1 分层与依赖规则

| 层 | 职责 | 依赖规则 |
|---|---|---|
| L0 会话/事件底座 | 平台：会话生命周期、lineage、消息、审批、存储、UI slots | 第三方只经公开原语 |
| L1 编排契约 | 当前 = **一页 5 条必须规则**；目标态才做类型/不变量/协商 | 零运行时依赖；不依赖平台内部包 |
| L2 编排引擎 | tree / flow / agent-team adapter / 外部引擎 adapter | ✅ 只依赖 L1；❌ 禁止互相 import；❌ 禁止写会话生命周期 |
| L3 呈现层 | 会话谱系树 + 各引擎只读拓扑投影 | ✅ 只读投影；❌ 不读引擎数据库；❌ 不把 UI 分组当执行实体 |

### 5.2 契约 v0：先只写"已经必须遵守的 5 条"

> 红队结论：没有第二个独立实现者、没有运行时强制点时，12 条不变量 + schema + 一致性测试 = 第 4 份文档债。**先写 5 条"今天就已经成立/必须成立"的规则**，出现第二个实现者或第二次真实组合需求后再升级为 schema/ABI。

1. **命名空间串**：`run_id` 全局唯一；`node_path = root_run_id + "/" + …`；引擎不得自造全局 key。
2. **账本单一写者**：session 生命周期只由会话层写；task/run 生命周期只由所属引擎写；投影只读。禁止双写、禁止用会话父子推导任务依赖。
3. **gate 位置**：gate 只能出现在"发起 flow_run 且 turn 未结束"的会话（当前=root/上层同步调用者）；delegated child 内不得出现 human_gate（fail-closed，不伪造 human）。
4. **relay 开关语义**：运行中等待外部编排（flow/verify/长命令）的 leaf 必须 `relay: off`；开关由 tree-engine 提供并被 `sweepTick` 尊重。
5. **结果交付**：跨引擎结果只走 artifact/文件引用或引擎只读 status，**不依赖工具返回摘要**（600/4000 截断）。

**目标态 ABI（仅方向，不在本轮实现）**：`EngineDescriptor/negotiate`、`PlanEnvelope`、`NodeSpec`、`RunScope`（run/path/depth/deadline/budget/permissions/cancel/session）、`NodeRuntime.execute/spawn/await/cancel`、`RunHandle`、`NodeOutcome`、`CheckpointRef`、`OrchestrationEvent`、`TopologyProjection`；12 条不变量（I1 单一写者…I12 UI 只读）。E2 的"四段契约"（派发 `DshAdapter.spawnNode` / 账本 `OrchestrationStore` / 观测 `Observer/Reconciler` / 视图 `UiBridge`）是 DSH 特化的参考实现。**这些在 §7.6 的触发条件满足前不建设。**

### 5.3 Scope 衰减（目标态；当前无执行点）

```text
child.budget  = min(floor(parent.available × share), parent.available − reserve_floor)
reserve_floor = 20% × parent.limit
child.grants  ⊆ parent.grants
child.deadline ≤ parent.deadline
child.depth   = parent.depth + 1        # 当前硬上限 = profile maxDepth(4)，不是 8
```

起步参数（目标态建议，按负载再调）：LLM 自主分解 `depth=3`；引擎互嵌 `depth≤4`（平台硬限）；`max_children=8`；`max_nodes/run=256`；`max_attempts=3`；`retry_budget=20%`；`cancel_grace=30s`；`no_progress_threshold=3`。

### 5.4 identity / lineage 三件套（全篇最便宜、最该先做）

- `run_id` 全局唯一；`node_id` 在 plan 内稳定；`attempt` 单调。
- 每个引擎必须写：`owner_session_id`（发起会话）、`parent_run_id`/`parent_node_id`（嵌套父）、`node → session_ids[]`（含竹节/重试产生的多会话）。
- flow 侧 `ownerSessionId` **已存在**于 `engine-builtin.js:816,906`（run 级还有一处写 null 需核对），不是"从零新增"；tree 侧需补 run 级父引用。
- 会话侧可查"我属于哪个 run/节点"（引擎只读接口/Inspect），反向关联靠稳定 id，不靠字符串嗅探。

### 5.5 呈现层：投影而不是绑定

- session-tree 保持"会话谱系树 + 通用会话操作"的底座定位，**不 import 任何引擎**。
- 各引擎发布**只读 `TopologyProjection`**；呈现层把"会话谱系"与"编排拓扑"叠加展示。
- 过渡期各自保留面板（现状）即可——**统一 UI 不是现在的优先级**（红队 M6：四套视图并存时，用户"在哪看节点/attempt/审批"是产品问题，不是先做投影就能解决）。
- 平台 Agent Team 的 journal→projection 先例说明"持久日志派生视图"可行。

### 5.6 组织形态组合代数（方向）

组织形态 = **拓扑**（树 / DAG / 扁平团队 / 流水线 / map-reduce / 递归）× **执行语义**（fire-and-forget actor vs await 确定性）× **治理**（权限/审批、预算、DoD/验证、人工门禁）。不同引擎只是这些维度的不同组合；组合协议让任意节点承载任意引擎的一次 run。**当前能做到的是"软组合的形态拼接"，可靠的结构化递归要等 §7.6 条件。**

---

## 6. 拆分与仓库策略（修订）

### 6.1 判定

| 问题 | 判定 |
|---|---|
| 运行时能否拆成两个独立插件？ | **能，且今天已经独立**（3 bundle / 3 link / 独立状态域 / 0 代码依赖） |
| "拆仓 = 零运行时改动、约 3+6 人日"？ | **不成立**（见 6.2）：漏掉 hmr.root、D1 反转、镜像仓冷启动、发布门禁/工具链重建；3/6 人日是 E1 的**自标粗估**且未含这些 |
| 现在就该拆吗？ | **不建议现在拆**。维持 monorepo + "三个 bundle 可独立安装、互不 import"的事实写清楚；拆仓挂两个触发器（见 6.4） |
| 拆完是否还需要总仓？ | 若拆：契约放独立小仓或本仓 `contracts/`（文档 + schema + 一致性测试），三插件独立发版；但**先有强制点或第二个实现者再建** |

### 6.2 拆分真实成本（红队 S3 修正）

| 成本项 | 说明 |
|---|---|
| hmr.root 迁移 | profile `hmr.root` 是两个**绝对目录**（`cordis.patch.yml:4-9`）；新仓不在其中 → 失去热更，宿主半每次改动必须 disable→enable/重启（session-tree 是 UI 密集包，迭代成本显著上升） |
| D1 反转 | `agent.md:88` 明写"本仓=唯一源码事实源；发布=本仓→公开插件仓同步"。把 session-tree 开发搬去独立仓 = **反转 D1**，必须先新增决策记录，而不是在架构文档里顺手改 |
| 镜像仓 ≠ 开发仓 | 镜像仓是单向同步**产物**（`release-plugin.mjs:57`），本机无 checkout、无 CI、无开发回路；"19/19 SHA 一致"只证明发布产物一致，不证明可开发 |
| 工具链重建 | `check-version-consistency.mjs`（20+ 条断言、以 engine 包为"本仓"前提）、`release-all.mjs` 单向同步语义在"两个源"下失效；跨仓一致性 CI 要新建 |
| 发布门禁翻倍 | A1–A9 独立验证、密钥扫描**全历史**、`rev-list --objects` 瘦身等是单仓设计；拆仓要跑两遍，历史重写也要两遍（D2/D7/D5） |
| D3 冻结 | npm 冻结期间，`private:true`/`@local`/`repository/license/author`/市场 listing 这半张清单**没有交付对象**；6 人日里至少 2 人日是为解冻预付 |
| 已有边界 | `tree_maintain gc` 未实现 → 拆仓后"新仓第一天就带病"（存储只增不减） |

> 结论：**拆分是"生态型目标"的手段，不是当前技术债的解**。在 npm 解冻与第二个独立消费方出现之前，拆仓是纯支出。

### 6.3 与既有决策的冲突（必须先改决策记录）

| 决策 | 冲突 | 处理 |
|---|---|---|
| **D1** 本仓=唯一源码事实源 / 单向镜像 | **硬冲突** | 拆 session-tree 前必须新增决策记录（如 D18）明确反转与迁移 |
| **D3** npm 冻结 | 未对齐 | 明确"解冻前不把去 private/补元数据/市场 listing 计入工期" |
| **D5/D2/D7** 公开范围与排除清单 | 未评估 | 第二仓历史需重做密钥扫描与 7 文件排除（历史重写两次） |
| **D6** 版本纪律 | 未计成本 | 两条版本线 + 检查脚本矩阵 |
| **D12** 宿主半热更 | 已提及但漏 hmr.root | 见 6.2 |
| 发布门禁 §5 | 未评估 | 拆仓 = 门禁跑两遍（A1–A9、全历史扫描） |

### 6.4 建议

1. **现在不拆仓**；在 README/agent.md 写清楚"三个 bundle 可独立安装、互不 import、独立状态域"（这已经是事实，不需要搬家）。
2. **挂两个触发器**：① **npm 解冻（D3 需用户显式批准）**；② **出现第二个独立消费 session-tree 的人/项目**。两者都未发生时，不做拆分。
3. 若触发：先改 D1 决策记录 → 先拆 session-tree（成本较低）→ 再评估 tree-engine；同时把 hmr.root、发布门禁、跨仓 CI 纳入工期。
4. **不建 contract 仓**（红队 S5）；最多在本仓 `docs/` 放一页组合约定（§5.2 五条）。

### 6.5 为什么不做"公共 adapter 包"

把 DSH 原语适配（起会话/投递/水位/id 归一化）抽成公共包会让两侧互相绑版本：DSH API 已发生 `startContinuable` 被移除的漂移，公共 adapter 会放大 blast radius。**反对成立**；替代方案不是"共享 adapter"，而是"每个引擎各自做双形防御 + 启动自检（像 `tree_doctor`）+ 一页约定"。

---

## 7. 落地路线（红队修订版：先判决、再小改、后约定；内核/拆仓不做）

### 7.1 第 1 步 ✅ 已执行（2026-11-12 真机）｜先测 S1，不写代码

**执行结果**（报告：[docs/reports/e2e-composition-relay-2026-11-12.md](../reports/e2e-composition-relay-2026-11-12.md)；证据：tree `s1rl1` / flow `S1RELAY-R1`）：

1. **宿主 `usagePct` 恒 `null`（FACT）**：apply.log 同型 `tokenMeter.measure unavailable: cannot get property "tokenMeter" without inject` 共 22 条；根因 = `index.js:183` 直读 `services.tokenMeter`，但 `apply()` 只 inject 了 `tools/subagents/sessionQuery`（`:809`），catch 直接 `return null`，`ctx.get` 兜底不可达。→ 红队 S1 所担心的"宿主测量自主触发"在本 build **不成立**（不是因为安全，而是因为实现缺陷）。
2. **relay 会打断运行中的 flow（FACT）**：leaf 自报 `pct=45` 后进入 `flow_run`，harvest 返回 `s1rl1:bamboo(ok)`；flow journal 实测 `run/ended status=cancelled / error=E_RUN_CANCELLED / durationMs=61863 / nodeExecutions=3`（N1 succeeded 38646ms / N2 cancelled / N3 pending）。→ **自报即可触发 relay，且 flow 结果丢失**。
3. **定时器自主路径"偶发可用、整体不可靠"（FACT+INFERENCE）**：本次在无工具调用窗口观测到 relay #2 自主成功；但同进程有 reload 残影 sweep 循环（73 次 apply / 24 条 `inactive context` / 快照 14 条 `sweep_error` / tree-state 写竞态 ENOENT）。timer 打断 flow 未直接观测（与 harvest 同 `sweepTick` 分支，属 INFERENCE）。
4. **附带测试发现（需修）**：successor 重跑同一 runId 命中 `E_RUN_EXISTS`（flow 结果不可复用）；`usagePct` 端口缺陷；sweep 僵尸循环；`E_RUN_CANCELLED` 消息 `[object Object]`。

**判决**：**relay 会打断运行中的 flow（经 sweep/harvest 路径实证）**；§7.2 的 per-leaf relay 抑制开关因此是**必须项**，不能靠"宿主测量恰好不可用"兜底。本次也确认 flow 在 leaf 内可正常起（callerOrigin=subagent / permTier=safe / depth 未撞墙），组合的阻塞点不在权限/深度而在 **relay 语义 + 结果交付**。

**v0.8.0 独立复验（2026-11-12，报告 [e2e-relay-switch-2026-11-12.md](../reports/e2e-relay-switch-2026-11-12.md)）**：① `relay:"off"` 生效——`rly8a` 树 leaf 关 relay 后 flow `RLY8A-R1` 跑满 **315.4s / succeeded / integrity=verified**，期间 ≥5 次定时 sweep + 1 次 harvest 均未触发 relay（segmentChain 空、drift 无 bamboo）；② auto 回归——`rly8b`（定时 sweep）与 `rly8c`（harvest）均触发 relay，flow `cancelled / E_RUN_CANCELLED`，复现 S1；③ set-relay 权限正负例 PASS（creator/root 可设、owner 拒 `E_BORROWED_IDENTITY`、非法值 `E_SCHEMA_INVALID`）；④ sweep 注册表对 v0.8.0 实例 PASS（5 次 `previous sweep disposed`），升级前 v0.7.0 僵尸需重启 DSH 清除（已知边界）；⑤ `usagePct` 服务获取已修但首轮 `measure()` 入参契约不匹配 → 仍恒 null（F3）；收口后改为**活 Session + `contextPressure`/`measure` 双读面**，活体 apply.log 已出现 `tokenMeter.measure shape: {"pressure":{"pressureTokens":52509,"contextWindow":1000000},...}`（P0-B 真机 PASS）；同时 `sweepTick` 改 `max(宿主测量, 自报)`，避免测量可用后覆盖自报触发（单测锁死）。

### 7.2 第 2 步（≤1 人日）｜tree 加 per-leaf relay 抑制开关（**S1 实测后必须项；v0.8.0 已实现，D19**）

`tree_node set-context` 已存在，加 `relay: 'auto' | 'off'`；`sweepTick` 的竹节分支读它（`src/engine.js:564-567`）。
**验收**：同一用例在 `relay:'off'` 下跑到完成、`flow_run` 返回正常、`runtime.segmentChain` 为空；`relay:'auto'` 下复现第 1 步现象（证明开关确实起作用）。

### 7.3 第 3 步（≤2 人日）｜只做 3 个数据面小改

(a) flow journal 补 `parentRunId/parentNodeId`（`ownerSessionId` 已有，只需 run 级一致；核对 `flow-core/src/engine.js:3008` 的 null 写入）；
(b) `flow_cancel(runId)` + `activeRun` 单槽改多槽（`flow-core/src/engine.js:268`）——**flow 套 flow 的前置**；
(c) 结果引用：`flow_run` 返回 artifact 路径（替代 600 字符摘要）。
**验收**：从 tree leaf 起的 flow 可被 tree 侧按 `runId` 取消（贴 journal `cancelled` 事件）；`flow_status` 能按父 run 聚合；节点输出 >600 字符时父能从文件读全文。

### 7.4 第 4 步（≤0.5 人日）｜一页《组合约定 v0》

只写 §5.2 的 5 条，不写 schema、不建 contract 仓、不建 12 条不变量。两个引擎的 SKILL/README 各加一行指针。**出现第二个独立实现者或第二次真实组合需求之前，不升级为 schema。**

### 7.5 第 5 步（0 人日）｜拆仓：不做

把"三个 bundle 可独立安装、互不 import"在 README 写清楚；拆仓挂 §6.4 的触发器。

### 7.6 目标态路线（条件满足后再评估，不作为承诺）

| 条件 | 才考虑 | 代价警告 |
|---|---|---|
| ① 真机验证 relay 可抑制 + ② 有第二次真实跨引擎组合需求 | 才评估"服务化"（flow `ctx.flowEngine` / tree `ctx.treeEngine` + handle/events） | tree 服务化会与 fire-and-forget/竹节语义正面冲突，需 CR |
| ③ 出现第二个独立实现者 / 多引擎并存成为常态 | 才评估轻量注册表（单一 owner + 软探测） | 无强制点时只是文档；不要 12 条不变量内核 |
| ④ 用户明确要三层以上组织形态 | 才调 `maxDepth` 并做真机矩阵 | 并发/成本/审批风险同步放大；先写 profile 变更与回滚 |
| ⑤ npm 解冻 + 生态型目标 | 才评估拆仓 | 见 §6 成本清单（D1 反转、门禁翻倍） |

**合计本轮 ~4–6 人日**，覆盖原 v0 P1 清单约 60% 的价值，不碰内核。

---

## 8. 安全与数据面（新增；红队 M1/M9）

### 8.1 工具面 = 权限面（当前存在越权注入面）

- `tree_send` 的 `parent` **可由模型入参指定**（`session-tree/index.js:251`）；不传时才回落到查目标 header 的 `parentSession`（`:262-269`），随后 `subagents.prompt({parentSessionId: parent, childSessionId: target})` 按**父地址**授权（`:273-283`）。
- 后果：**任何能调 `tree_send` 的会话**（工具全局注册）只要同时给出 target 与其真实父 id，就能向任意可续接会话注入一条 steer 消息。这不是"跨层消息能力"，而是**无调用者校验的消息注入面**。
- 建议（需用户决策，可能改行为）：`tree_send` 校验调用者与 target 的谱系关系（同树/同祖先），或移除显式 `parent` 入参、只允许 Host 内部解析；至少记录调用者并限制跨树。
- 同类：`tree_node add` 字段透传无白名单（`handoff-2026-11-12.md:195` 自认 severe 属实）→ 字段白名单化。

### 8.2 审批句柄可被借用（未申明的越权面）

- `approval.request()` 只接收一个内存里的 `Agent` 句柄，**不做调用者身份校验**；任何插件只要持有 root Agent 的引用，就能以 root 身份请求审批（若 turnOpen 恰好为真则通过）。
- 后果：任何"审批下沉/代批"设计都可能演变成**借身份**；必须在设计上禁止，而不是靠"没有通道"的假设。
- 规则：审批只能由"当前 turn 的真实发起会话"请求；编排引擎不得持有/转借其他会话的 Agent 句柄。

### 8.3 账本脱敏（三个新落盘点）

- flow journal 落**节点输出全量**；tree `tree-state.json` 落完整 `taskPrompt`/`done.meta`（单文件全量，含任务书文本）；handoff 文件（`HANDOFF-*.md`）落会话摘要。三者都可能带凭据/敏感内容。
- 规则建议：账本禁止字段清单（token/密钥/URL 凭据）；节点 prompt 不要求携带秘密；必要时对账本做字段级脱敏；`GH_TOKEN` 等只允许内存（沿用 `agent.md:68` 纪律）。

### 8.4 其他

- 多 Host / 多 workspace：tree `.lock` 未实现、flow 存储根被钉绝对路径 → 双窗口并发会互相踩；在解决前**单实例使用**。
- `maxActiveSubagents` 是进程内激活槽位，不能当累计预算；跨引擎嵌套 fan-out 会挤占，需人工限额。

---

## 9. 风险与反模式（修订）

| 级别 | 风险 | 缓解 |
|---|---|---|
| 高 | **relay 打断外部编排（2026-11-12 已实证）** | flow 被测为 `cancelled / E_RUN_CANCELLED`；第 2 步 relay 抑制开关（必须项）；运行中等待外部编排的 leaf 必须 `relay: off`；successor 换 runId 或支持 `flow_resume` |
| 高 | **`usagePct` 端口缺陷**（inject 缺 `tokenMeter` → 测量恒 null） | 修 inject/取值路径并保留 `tokenMeter.measure shape:` 日志；否则"是否自主 relay"无法观测 |
| 高 | **双账本**（会话图 vs 任务/运行图都声称拥有生命周期） | 单一写者；`run_id` 唯一关联；幂等 spawn；投影只读 |
| 高 | **scope 不衰减 / 预算无原语** | 目标态内核强制；当前用引擎自限额 + 人工公式，不承诺平台级保证 |
| 高 | **递归深度满额** | 近期验收降为两层；三层需先调 maxDepth + 风险说明 |
| 高 | **审批机制误用**（turnOpen/never/句柄借用） | §1.4 精确表述；§8.2 规则；不在 delegated child 内放 gate |
| 中 | **sweep 僵尸循环 / 单实例写竞态**（73 次 apply 残影、24 条 inactive context、tree-state tmp rename ENOENT） | dispose 时保存并调用上一代 `stop()`；托管宿主 timer 或落盘句柄；同 profile 单实例锁 |
| 中 | **flow 单槽 activeRun** | 多槽修复前列为"flow 套 flow 不安全" |
| 中 | **权限静默降级**（ceiling→safe） | 组合前检查 `permTier`；文档/SKILL 标注 |
| 中 | **消息幂等缺失** | `idempotencyKey` + outbox/inbox；以会话日志为到达证据 |
| 中 | **工作区归属 / 元数据无处安放** | 派发后 attachSession；`sessionId ↔ run/node` 账本映射 |
| 中 | **存储增长 / 单文件全量重写 / 无 GC** | `tree_maintain gc` 补齐前限制树数量；账本轮转 |
| 中 | **维护负担：两套平台适配、一次升级两处失败** | 各自双形防御 + 启动自检；不抽公共 adapter |
| 中 | **发布/拆仓风险** | 现在不拆；触发器 + 先改 D1 |
| 低 | 工具面膨胀/Skill 冲突 | 组合层提供"何时用哪个引擎"的路由模板 |
| 低 | 统一 UI 缺失 | 各自面板并存；先回答"用户在哪看什么"，再做投影 |

**反模式**：引擎互相 import；用会话父子推导任务依赖；把 UI 分组当执行实体；用 `result` Promise 当权威（崩溃/跨进程即失忆）；把业务元数据塞 session header；把"文档 + 一致性测试"当契约唯一形态。

---

## 10. 决策记录与待决事项（2026-11-12 用户指示后）

> 记录规则：用户明确"先做 / 记录待决 / 等更多信息"的项，状态如下；未表态的保持待定。决策日志见 `agent.md` D18。

| # | 事项 | 状态（2026-11-12） |
|---|---|---|
| 1 | 先做第 1 步**真机压测**（tree→flow，观察 relay 是否自主打断；需要一次真实会话/配额） | **✅ 已完成（2026-11-12）**：结论见 §7.1；报告 [e2e-composition-relay-2026-11-12.md](../reports/e2e-composition-relay-2026-11-12.md)（relay 会打断 flow；宿主测量恒 null；timer 路径不可靠） |
| 2 | 给 tree-engine 加 **per-leaf relay 抑制开关**（唯一必须的代码改动，约 1 人日） | **✅ 已实施并真机验收（2026-11-12，D19，tree-engine v0.8.0）**：`tree_node {action:"set-relay", relay:"auto"\|"off"}`；`off` 时 sweep 只跳过竹节；单测 165/165；E2E（[报告](../reports/e2e-relay-switch-2026-11-12.md)）：relay:'off' 长 flow 315.4s 穿越 ≥5 次 sweep 不被中断、auto 回归/权限正负例 PASS；同轮收口 F1 validate 假阳性、F2 validate TypeError、F3 usagePct measure 契约（活体 `tokenMeter.measure shape:` 已出现） |
| 3 | **递归目标**：近期接受"tree→flow"两层组合（不改 maxDepth），还是明确要三层以上（需先调 `maxDepth`、写风险与回滚） | 待用户表态 |
| 4 | **安全面**：`tree_send` 的显式 `parent` 注入面是否先加调用者/谱系校验（可能改变跨树消息用法） | 待用户表态 |
| 5 | **拆仓/内核**：现在不拆仓、不建契约内核/注册表，挂两个触发器（npm 解冻 / 第二个独立消费方） | **已记录待决**（用户 2026-11-12 指示"等更多信息后决策"；触发器见 §6.4、§7.6） |

**本轮配套产物**（2026-11-12 用户指示）：专家取证报告已入库 [docs/reports/composition-research-2026-11-12/](../reports/composition-research-2026-11-12/README.md)；插件源码目录地图 [docs/reports/audit-plugin-sources-2026-11-12.md](../reports/audit-plugin-sources-2026-11-12.md) 与开发会话索引 [docs/reports/audit-dev-sessions-2026-11-12.md](../reports/audit-dev-sessions-2026-11-12.md) 已整理，并汇总为拆分准备指南 [docs/guides/split-preparation.md](../guides/split-preparation.md)——为未来拆分做向导准备，不代表已决定拆分。

---

## 11. 证据索引

| 主题 | 证据 |
|---|---|
| 三包零代码依赖 / 拆分影响面 | E1 报告 `E1-coupling.md`；本仓 `packages/*/package.json`、`scripts/check-version-consistency.mjs` |
| DSH 平台原语 / 缺口 G1–G12 / 四段契约 | E2 报告 `E2-dsh-capabilities.md`；asar `dsh-subagent`/`dsh-agent`/`dsh-session`/`dsh-session-query`/`dsh-user-approval`/`dsh-storage-domain`/`dsh-experimental-agent-team` |
| 自由流程 M1 事实 | E3 报告 `E3-freeflow.md`；`D:\Codes\DSH动态流程引擎插件\spike\flow-core`、`spike\dsh-flow-plugin`、`evidence\m1\tree-harness\INTEGRATION-DESIGN.md` |
| SOTA 组合模式/契约/反模式 | E4 报告 `E4-sota.md`（59 URL） |
| 红队证伪评审（S1–S6/M1–M9/N1–N7） | `REDTEAM-review.md` |
| tree-engine 宿主适配/竹节/verify | `packages/dsh-tree-engine/index.js:41-197,313-414,809`；`src/engine.js:372-588`；`src/compat.js` |
| session-tree 纯客户端渲染/两工具 | `packages/dsh-session-tree/client.js:22-33,2012`；`index.js:40-53,243-293,1109-1385` |
| 审批机制 / 子会话 never / 深度 | asar `dsh-user-approval/lib/index.js:153-201`；`dsh-subagent/lib/types/child-agent.js:180-186`；profile `cordis.patch.yml:4-9,226-227,272-280` |
| flow 单槽 / 权限 ceiling / 存储根 | `flow-core/src/engine.js:268,3008`；`permissions.js:448-451`；`spike/dsh-flow-plugin/lib/storage-path.js:7-10` |
| 跨引擎既有论证（A/A+/B/C） | `INTEGRATION-DESIGN.md` §5、§6、§8 |

---

## 附录 A：术语

- **软组合**：由节点会话（Agent）自己调用另一个引擎的工具，引擎之间无接口依赖。
- **结构化嵌套**：父引擎通过契约/内核 `spawn` 子引擎的一次 run，并持有 handle（await/cancel/observe）。
- **双账本**：会话谱系与任务/流程图各自认为自己拥有节点生命周期，导致状态冲突。
- **Scope 衰减**：子 run 的预算/权限/deadline/取消只能比父更紧，不能重置或放大。
- **投影**：从持久事件日志派生的只读视图，UI 唯一消费面，不反向写。
- **会话替换器**：在不结束逻辑任务的前提下 interrupt 旧会话、启动新会话继续（tree 的竹节）；与"在 turn 内等待外部结果"的编排语义冲突。

## 附录 B：红队缺陷处置对照

| 红队项 | 处置位置 |
|---|---|
| S1 relay 定时器 | §0.6、§4.1、§4.4、§7.1–7.2 |
| S2 深度满额 | §0.6、§4.3、§7.6、§10-Q3 |
| S3 拆仓成本/D1 | §0.6、§6.2–6.4 |
| S4 审批机制/安全 | §1.4、§3.2、§8.2 |
| S5 契约无强制点 | §0.6、§5.2、§6.5、§7.4–7.6 |
| S6 软组合高估 | §0.6、§4.1、§9 |
| M1 安全（tree_send/权限面） | §8.1、§8.2 |
| M2 预算无原语/槽位语义 | §1.4、§4.3、§5.3、§8.4 |
| M3 存储增长/GC | §6.2、§9 |
| M4 多 workspace/多 Host | §8.4、§9 |
| M5 现实失败率 | §1.5 |
| M6 UI/审批归属 | §5.5、§9 |
| M7 维护负担（两套适配） | §6.5、§9 |
| M8 机会成本 | §0.2、§7 |
| M9 账本脱敏 | §8.3 |
| N1–N7 内部不一致 | 已在 §1.1（flow 存储根）、§1.4（header 7/9、depth 硬限）、§0.4-5、§4.1、§10、§2 修正 |
