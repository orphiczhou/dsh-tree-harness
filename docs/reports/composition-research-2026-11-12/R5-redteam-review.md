# 红队评审：组合式会话编排体系评估与设计（v0）

> **评审对象**：`D:\Codes\dsh-tree-harness\docs\architecture\composable-orchestration-2026-11-12.md`（438 行，v0 草案）
> **评审立场**：证伪优先。文档说"可行 / 无需改动 / 低风险 / 已经分开"的地方，我去找反例；找不到的明说"未找到反证"，不拿推测冒充证据。
> **纪律**：全程只读；未改任何目标文件、未装/未启用插件、未跑 `flow_*`/`tree_*` 写操作。坐标为 `file:line` 或 asar 包内路径；凡我自己没读到行的，只写到函数名，不编造行号。
> **评审时刻**：2026-11-12（基线 `1b1f610` 之后的工作树，含 Wave-2 未提交改动）。

---

## 0. 结论先行

### 0.1 总判定

**框架可以留着当讨论地图；它的核心结论不能直接采信。**

- **对的部分（我未找到反证）**：四张图（会话谱系 / 计划 / 运行 / 投影）不可混同；`node → run → attempt → session(s)` 必须显式建模；禁止引擎互相 import；**不做**公共 adapter 包（`§6.4` 的论证成立，E1 §13.1 同结论）；"结构化嵌套今天不可行"（E3 §5.3 同结论）。
- **错的部分（有反证）**：**"运行时已经事实上分开 ⇒ 拆分不涉及运行时改动、3+6 人日、P0 零代码"这条主叙事系统性偏乐观**。我在代码与 profile 里找到 **3 处"今天就已不成立"的事实**、**2 处平台机制被误述**、**1 处旗舰验收用例在当前 profile 下不可达**。
- **计数**：**6 条严重缺陷（S1–S6）**、**9 条遗漏/权重不足（M1–M9）**、**4 条与项目既有决策的冲突**、**7 条文档内部不一致（N1–N7）**。

### 0.2 判定表（§0.1 三问 / §0.2 / §6 工期 / §7 路线 / §5 契约）

| 待判条目 | 判定 | 一句话理由 |
|---|---|---|
| §0.1-1 拆两个项目"可行，运行时今天已事实分开" | **部分成立** | bundle/依赖/状态域确实已分（E1 §3.1、§3.6）；但"分开"只在**同机同 profile 同 `hmr.root`** 下成立，拆仓会把 D1 的"本仓=唯一源码事实源"与单向镜像发布链一起推翻（S3） |
| §0.1-1 代价"3 人日 / 6 人日" | **反对（低估）** | 数字是 E1 的**自标"粗估"**（E1 §9.4/§10.3 表头即"人日（粗估）"，且 E1 §8.3 声明测试套件"未执行"），不含 HMR root、发布链、跨仓 CI、镜像仓无本地 checkout 的冷启动成本（S3、M6） |
| §0.1-2 控制面/执行面关系、RACI | **支持** | 与 E2 §9.1 逐行吻合；"不重造会话生命周期"是对的（但 tree 的竹节其实在重造"续接"语义，属措辞过强，非实质错误） |
| §0.1-3 软组合"今天可行、零代码" | **部分成立（被高估）** | 三处反证：relay 由**定时器**自主触发、flow **单槽 activeRun**、`callerOrigin=subagent` 权限降级（S1、S6） |
| §0.1-3 结构化嵌套"今天不可行" | **支持** | E3 §5.3 同结论；我另补一条更硬的机制（取消/审批的 `turnOpen` 与身份约束，S4） |
| §0.1-3 / §5 "递归形成千变万化组织形态" | **反对（在当前 profile 不可达）** | `maxDepth=4` + tree 自身 2 层 + verify/judge 各 +1 → **零余量**；P3 的验收矩阵含 verify 与审批分流，必然撞墙（S2） |
| §0.2 "方向对，但拆分不是第一动作" | **部分成立** | 方向判断我同意；但"先契约"的风险它算错了——契约**没有强制点**（S5） |
| §6.1 "拆 session-tree = M ≈3 人日" | **反对（低估）** | 漏 HMR root（profile `cordis.patch.yml:4-9`）、漏 D1 反转、漏镜像仓≠开发仓（无本地 checkout） |
| §6.3 "拆 tree-engine = L ≈6 人日" | **部分成立，但目的错** | 阻塞项清单准确（E1 §10.1）；`private:true`/`@local`/`repository` 只在 **npm 解冻（D3）** 后才有意义 → 6 人日里有一半在为解冻预付 |
| §7.1 P0「0 代码、1–2 天」 | **反对** | P0-3（relay×flow 互斥）断言的是一个**运行时行为**，靠约定拿不到：`src/engine.js:484-534` 的 `sweepTick` 用宿主测量自主 relay（S1） |
| §7.2 P1「5–8 人日」 | **部分成立** | 小改清单方向对；但 tree 侧"可选 await result + dispose"与竹节/relay 语义冲突，成本被压在"小改"里（S1、M5） |
| §7.3–7.4 P2/P3（10–15 + 15–25 人日） | **反对（过度设计）** | 合计 45–73 人日的内核,对 2 个自研引擎/1 人+AI 团队换不来运行时保证（S5） |
| §5 契约 12 条不变量"内核强制" | **反对** | 没有强制点：平台唯一可插拔执行面是 `subagents.registerProvider`（E2 §0.3 G6），两个引擎都不经它；"CI 强制"只能检查自己仓（S5） |
| §5.2 四段契约（派发/账本/观测/视图） | **支持（作为文档）** | 与 E2 §11 一致，可作实现参考；反对的是"先建内核再谈组合"的**优先级**，不是内容 |
| §5.4 身份/命名空间/lineage 三件套 | **支持** | 这是全篇最便宜、最该先做的一段；但 flow 侧 `ownerSessionId` **已经存在**（`engine-builtin.js:816,906`），P1 清单把它当"要新增"是不准确的 |

### 0.3 六个严重缺陷一览

| # | 缺陷 | 严重度 | 关键证据 |
|---|---|---|---|
| **S1** | **P0 的"relay×flow 互斥"不是约定问题，是定时器问题**：`sweepTick` 每 tick 用宿主测量对所有 running leaf 判 42% 并自主 `bambooRelay`（interrupt 旧会话 + 起新会话）。"leaf 不报 context"完全不拦这条路 | 致命（打掉 P0 的低成本前提） | `packages/dsh-tree-engine/src/engine.js:484-534`（尤其 `:517-522`）；`:526` 注释自证"宿主测量 ∨ 自报，先到者生效" |
| **S2** | **递归"组织形态"在 depth=4 下只剩 0 余量**：tree 自身吃 2 层，flow 节点 1 层，内层 tree 的 worker 恰好第 4 层；再任一 verify/judge（+1）或更深一层即 `SubagentDepthError` | 严重（旗舰用例不可达） | `profile/cordis.patch.yml:226`（`maxDepth: 4`）；`dsh-subagent/lib/types/child-agent.js:36-39`（`delegationDepthOf(parent)+1`）；`packages/dsh-tree-engine/index.js:414`（verify 会 `startChildSession`） |
| **S3** | **"拆分=零运行时代码改动"不成立**：HMR root 是 profile 里两个绝对目录，新仓不在其中 → 失去热更；更根本的是 D1「本仓=唯一源码事实源」与单向镜像发布链会被反转 | 严重（推翻"低风险") | `profile/cordis.patch.yml:4-9`；`agent.md:88`（D1）、`agent.md:188`（发布源漂移铁律）；`scripts/release-plugin.mjs:57` |
| **S4** | **审批不是"只能 root"，而是"请求方会话必须有 open turn + policy 不是 never"**。文档把机制写错，导致两个推论都站不住：①"上提到 root"在 tree 形态不可行（root 的 turn 已结束）；②"下移"需要转借 root 的 Agent 句柄 → 一个**未申明的越权面** | 严重（设计前提错误 + 漏安全面） | `dsh-user-approval/lib/index.js`：`request()` 内 `turnOpen` 校验、`decide()` 内 `effectivePolicy(session)==='never' → 'rejected'`；`dsh-subagent/lib/types/child-agent.js:184`（`parent.ctx.get('approval')===undefined ? undefined : 'never'`） |
| **S5** | **契约没有强制力**：所谓"内核强制 12 条不变量"不存在执行点；平台无注册表（`workflowEngine` 单 provider 会抛错），CI 只能检查本仓。结果是第 4 份文档债，且正好落在最容易腐烂的位置 | 严重（方法错，不是细节错） | E2 §0.3 G6、§5.2；文档自身 §5.1 "用 CI 强制"与 §6.5 "拆仓后必须有跨仓一致性 CI"互相需要，形成循环依赖 |
| **S6** | **软组合被高估**：flow 内核 `activeRun` 是**单槽**（第二个 run 覆盖第一个的 controller）；`callerOrigin=subagent` 且无法解析父 run 时权限 ceiling 被压到 `safe`；工具结果 600/4000 截断；`flow_run` 前台同步无后台 job | 严重（§4.1 的 ✅✅✅ 表不诚实） | `spike/flow-core/src/engine.js:268,2906,3029`；`spike/flow-core/src/permissions.js:448-450`；`spike/dsh-flow-plugin/lib/tools.js:34,40,341` |

---

## 1. 逐条证伪（每条给反证或缺口）

### 1.1 §0.1-1「拆两个项目/插件可行，运行时今天已事实上分开」→ **部分成立**

**成立的部分**（我复核了，未找到反证）：三个包 0 import、0 deps/peerDeps、各自 bundle 条目与 skill provider、各自状态域（E1 §1.2、§3.1；`profile/package.json` 活体三条 `link:`）。这条我背书。

**夸大的部分**，三条：

1. **"分开"是同一台机器上的配置产物，不是架构属性。** `hmr.root` 是两个绝对目录（`profile/cordis.patch.yml:4-9`：`D:/Codes/nanju-dsh/packages`、`D:/Codes/dsh-tree-harness/packages`）。session-tree 是 UI 重的包，拆到新仓后**不在 hmr root 里 → 每次改宿主半都要 disable→enable 或重启**（`agent.md:99` D12 已证明改 `index.js` 必须重载）。文档 §6.2 的"必改"清单只写了 `profile link: 路径 + disable→enable`，**没写 hmr.root**。这不是运行时故障，但直接打掉"低风险、只改文档"的定性：它改的是开发内循环。
2. **拆分与 D1 冲突**（见 §4.1）。`agent.md:88` 写明"本仓成为**唯一源码事实源**；发布 = 本仓 → 公开插件仓同步"。把 session-tree 拆成独立仓并把开发搬过去，是**反转** D1，而不是"执行 D1"。
3. **镜像仓 ≠ 开发仓。** 文档拿"镜像仓已存在、19/19 SHA 一致"作为"90% 的路已经走过"（§6.2）。但该镜像仓是**单向同步的产物**（`scripts/release-plugin.mjs:57` `DEFAULT_SOURCE = <repo>/packages/dsh-session-tree`；`agent.md:188` "禁止手工双写"），且**本机没有它的 checkout**（`D:\Codes` 下无 `dsh-session-tree` 目录）。作为独立开发仓，它没有 CI、没有开发回路、没有 hmr root。冷启动成本被算成了 0。

### 1.2 §0.1-1「3 人日 / 6 人日」→ **反对（低估）**

- 这两个数字**不是文档自己测的**，是抄 E1 §9.4 / §10.3 的估算，而 E1 那两张表的表头写的就是"人日（**粗估**）"，E1 §8.3 还声明测试规模是"静态核对，未执行"。我在文档里找不到任何"这些估算已复核"的标注——`§6.2/§6.3` 直接把 M/L 与数字并列，读者会当成已核实。
- 估算**不含**：hmr.root 迁移与开发回路重建；`check-version-consistency.mjs` 的 **23 条 check**（`agent.md:116`）从"三包×六文档"改成跨仓矩阵；`release-all.mjs` 的单向同步语义在"两个源"下失效；镜像仓从"发布目标"升格为"源码事实源"后 D6（改代码必须 bump）与 D2/D7（公开/隐私排除）的**双仓历史重写**风险。
- **最重要的不是数字偏小，而是这个数字在回答一个还没成立的问题**：拆仓的唯一驱动是文档 §9-Q2 的"生态型/市场化"，而 **D3 把 npm 冻结了**（`agent.md:90`，"解冻需用户显式批准"）。在解冻之前，"去 `private:true`、补 `repository/license/author`、上市场"这半张清单（E1 §10.1 B0b/B1）**没有交付对象**。6 人日里至少 2 人日是在为解冻预付。

### 1.3 §0.1-3 / §4.1「软组合今天可行、零代码改动」→ **部分成立（被高估，三处反证）**

文档的 §4.1 三行全是 ✅。我逐条压测：

**反证 1（S1，最硬）：relay 是定时器驱动的，不需要模型配合。**
`src/engine.js:484` `async function sweepTick()` 遍历**所有树的全部 running leaf**：

```
:517  usage = await ports.usagePct(rt.subagentSessionId)      // 宿主测量
:518  const pct = (typeof usage === 'number') ? usage : (leaf.context_usage_pct ?? 0)
:519  if (pct >= orchCfg.bambooThresholdPct && leaf.role !== 'root') {
:520    const r = await bambooRelay(treeId, leaf, rt, state)   // interrupt 旧会话 + 起新会话
```

而 `:526` 的注释自证设计意图：「竹节检查 = usagePct（宿主测量）∨ leaf.context_usage_pct（自报），**先到者生效**」；`:541` 用 `clock.scheduleInterval` 起定时器（本机 `sweepMode=timer`，`agent.md:119`）。

**后果**：文档 §7.1-P0-3「运行中 flow 的 leaf 不报 `context`、不被 harvest」**是一条无效控制**。模型不报，定时器照样按宿主测量触发 relay：旧会话被 interrupt（flow 的 `await activation.result` 随之失效）、新会话接管、flow run 无人持有 handle。这正是文档 §4.1 自己承认的"节点会话的 50% 交接/竹节会中断 flow 的 await"——但它把这条写在**限制**栏里，同时在 P0 里宣称用约定解决。
**唯一能救它的**是 `tokenMeter.measure` 在本机恒返回 `null`（`index.js:171-182` 是防御性字段提取，失败即 `null`）。这一点**未取证**，而且 `index.js:14` 自认"usagePct 端口暂缺（tokenMeter 形状未定）"。**一个把"组合可行性"押在"某个宿主 API 恰好不可用"上的 P0，不能叫低风险。**

**反证 2（S6）：flow 内核单槽 `activeRun`。**
`spike/flow-core/src/engine.js:268` `this.activeRun = null`；`:2906` `this.activeRun = { runId, controller }`；`:3029` 清空。插件侧只有一个 `createEngineResolver(...)`（`spike/dsh-flow-plugin/index.js:727`）。E3 §0（UNKNOWN 段，`:500`）已明确："`FlowEngine.activeRun` 是单槽，第二个 run 会覆盖"。
**后果**：§4.1 的「任意节点调任意引擎 ✅ 天然成立」在 **flow 套 flow**（节点里再 `flow_run`）时是错的：外层 run 的 controller 被覆盖，取消/dispose 会打到错的 run。文档没有 flow-in-flow 这一行，但这恰恰是"递归嵌套"的最小自反用例。

**反证 3（S6，权限）：`callerOrigin=subagent` → ceiling 压到 `safe`。**
`spike/flow-core/src/permissions.js:448-450`：origin 是 `subagent` 且无法解析父 run 的 tier 时，`ceiling = 'safe'`；配合 `min(callerTier, declaredTier)`（`:7-8`）→ 一个在 root 里 `relaxed` 的 flow，在 tree leaf 里调起来会**静默降级**。文档 §4.3 的约束表列了"审批 root-only、深度、并发、预算、取消、持久化"六条，**没有这一条**。

补充两条不致命但真实的削弱项：工具结果 600 字符摘要 / >4000 变 `{truncated,preview}`（`level: tools.js:34,40,341`，E3 §5.4）；`flow_run` 前台同步、不注册后台 job（E3 §5.4），意味着"派发出去等结果"这条组合路径在 M1 不存在。

### 1.4 §0.2「先契约后拆仓才是低风险顺序」→ **部分成立；方法论上反对**

顺序本身我接受（先定义边界再搬目录，永远比反过来便宜）。反对的是**它给契约设定的形态**：

- 契约被定位成"**零依赖的文档 + schema + 12 项一致性测试**"（§5.2、§7.4）。这三样在**没有第二个独立实现者**时没有约束力：两个引擎都是同一个人写的、同一个 AI 会话改的，"违反契约"不会产生任何可观测故障，只会产生一次口头纠正。
- "内核强制 I1–I12"（§5.2）在机制上不成立：唯一能截住所有派发的平台缝是 `subagents.registerProvider`（E2 §0.3 G6），而两个引擎都是**消费者**不是 provider（tree 走 `startActivation`，flow 走 `subagentProvider: 'spawn'`）。内核最多做到"用了我的库就受我管"，不用的引擎完全不受管。
- 于是最可能的结局不是"契约拦住偏差"，而是"**契约文档 + 一套只有作者会跑的测试**"——正好是文档 §6.4 自己反对的那种"公共 adapter 包"的软版本，但少了一条硬约束（包版本）。**结论：先契约可以，但契约必须缩到一页、且只写"已经必须遵守的 5 条"，不要写"将来希望强制的 12 条"。**

### 1.5 §6 拆分结论（3 / 6 人日）→ 见 1.2；单列反证两条

| 文档说法 | 反证 |
|---|---|
| §6.2「不需要改：包内源码 0 行；patch 的 providerName/包身份解析与仓库位置无关」 | 前半对（E1 §9.3）；**漏**：`hmr.root`（`profile/cordis.patch.yml:4-9`）与"镜像仓无本地 checkout"（`D:\Codes` 下无该目录）→ 新仓第一天是"无热更 + 无 CI + 无开发回路" |
| §6.2「已具备：镜像仓 19/19 SHA 一致」 | 一致的是**发布产物**，不是可开发仓；`agent.md:188` 明令"只用 `release-plugin.mjs` 单向同步，禁止手工双写"——拆仓等于废掉这条铁律的一半 |
| §6.3「tree-engine 阻塞项：`@local`/`private:true`/缺元数据/无发布管线」 | 清单准确（E1 §10.1 B0–B7）；**但**这些只在 D3 解冻后才有交付对象；且文档漏了 `agent.md:138` R14-③（`tree_maintain gc` 尚未实现）→ 拆仓后 `tree-state.json` 只增不减的历史会在新仓里变成"新仓第一天就带病" |

### 1.6 §7 路线与工期 → **反对（P0 有实质漏洞；P2/P3 过度）**

| 阶段 | 文档 | 我的判定 |
|---|---|---|
| P0（1–2 天，0 代码，6 条约定） | 含 gate 分流、relay×flow 互斥、命名/存储、预算公式、能力探测 | **P0-3 无效**（S1）；**P0-2 机制写错**（S4：不是"root+ask 才允许"，而是"请求方 turn 必须 open"）；**P0-4 前提错**（N2：flow 存储已是绝对路径单目录，不是 per-workspace）。剩 3 条（命名、预算公式、能力探测）确实可 0 代码 |
| P1（5–8 人日） | flow 加 lineage/`flow_cancel`/并发透传/artifact 引用；tree 加 relay 开关/await/事件面 | 方向对。但 **`ownerSessionId` 已存在**（`engine-builtin.js:816,906`），不需要"新增"，只需补齐 run 级；**tree 的 await+dispose 与 relay 语义互斥**（relay 会在 await 中间换会话），成本被低估 |
| P2（10–15 人日） | 两引擎服务化 + registry + 节点类型扩展 + UI 投影 | **过度**。registry 在单 owner、无第三方实现者时是纯负担；节点类型扩展（flow `ORCHESTRATOR`）会碰 flow 的"节点类型闭集"硬约束（E3 §4，`docs/04:624` 明禁） |
| P3（15–25 人日） | `NodeRuntime.spawn/await/cancel/reserve` + ScopeFactory + 真机矩阵 | **过度且不可达**：真机矩阵里的"tree→flow→tree + verify + 审批分流"在 depth=4 下撞墙（S2）；`reserve` 依赖的预算原语在平台不存在（E2 §7.3 "token/成本/时间预算——不存在"） |

**合计 45–73 人日**（P1+P2+P3）换来的运行时保证 = 0（S5）。这是本次评审最实质的反对意见：**不是"太贵"，是"贵而无用"**。

### 1.7 §5 契约建议（逐项）

| 建议 | 判定 | 依据 |
|---|---|---|
| `PlanEnvelope` 对内核不透明 | 支持 | 正确的分层直觉（内核不得解析引擎 plan） |
| `RunScope` 只由内核派生、子 scope 单调衰减 | 支持（**但无执行点**） | 衰减公式（§5.3）本身合理；问题同 S5 |
| `NodeRuntime.spawn` 提供递归 | **反对** | 内核要 spawn"引擎"就必须解析引擎（注册表 + 动态加载），平台无此机制（E2 §0.3 G6）；文档把 registry 放在 P2 且标"可选"，而 P3 依赖它 → 自身排序矛盾 |
| `RunHandle.cancel()` | 支持（作为目标） | 现状 `flow` 无 `flow_cancel`、CANCELLED 不可 resume（E3 §5.3）；但 tree 侧要 await 才有 handle，与 fire-and-forget 冲突（§7.2） |
| `TopologyProjection` 只读 | 支持 | 与平台 Agent Team 的 journal→projection 先例一致（asar `dsh-experimental-agent-team/README.zh.md`） |
| 12 条不变量 | **反对（数量与措辞）** | I2/I3/I5（预算/权限/deadline 衰减）在平台只有"结构性上限"可用，没有计量原语；把它们写成"内核强制"会让读者误以为已经安全 |
| §6.4 不做公共 adapter 包 | **支持** | E1 §13.1 同结论；这是文档最扎实的一段 |

---

## 2. 六个严重缺陷（详解）

### S1 relay 是定时器行为，P0 的"约定"拿不到它

- **证据链**：`src/engine.js:484-534`（`sweepTick`）→ `:517` 宿主测量 → `:519-522` 达阈值即 `bambooRelay`；`:541` 定时器注册；`index.js:119-170`（relay = 交棒指令 → interrupt → 起新会话）。宿主侧测量端口 `index.js:181-183`，失败即 `null`（`:171-182`），且 `index.js:14` 自认端口"暂缺、形状未定"。
- **为什么致命**：它同时打掉三件事：①§7.1-P0-3；②§4.1"tree 外层/flow 内层 ✅"（这个组合的 run 时长通常 > 单节点 600s，是最可能跑到 42% 的场景）；③"零代码过渡期"的整个承诺——你**必须**先给 tree 加一个 per-leaf relay 抑制开关（约 0.5–1 人日），否则组合的可靠性由定时器决定。
- **正确的表述**：不是"relay×flow 互斥要写成约定"，而是"**tree 的竹节是一个自主的、异步的会话替换器；任何在自己的 turn 里等待外部 run 的编排（flow、verify、长命令）都与它不兼容**"。这条一旦成立，§4.1 的三行 ✅ 至少要改成两行 ⚠️。

### S2 递归"组织形态"在 depth=4 下是零余量，不是"受限"

- **证据**：`profile/cordis.patch.yml:226` `maxDepth: 4`；`dsh-subagent/lib/types/child-agent.js:36-39` 子深度 = 父+1，超限抛 `SubagentDepthError`；`packages/dsh-tree-engine/index.js:414` `tree_verify` 的 judge **会另起子会话**（`startChildSession`，父 = 调用的 leaf）。
- **算术**（root=0）：
  - tree 三层：root 0 → commander 1 → worker 2；
  - worker 内跑 flow：节点会话 3；
  - 该节点会话兼任内层 tree 的 commander → 它的 worker = **4（正好卡满）**；
  - 在这第 4 层里做**任何**需要再起会话的动作：`tree_verify`（llm-judge/adversarial 会起 judge）= 5 ✗；`session_handoff` 接替 = 5 ✗；再嵌一层引擎 = 5 ✗。
- **结论**：文档 §7.4 的验收矩阵「tree→flow→tree（depth 3）+ 审批分流 + 崩溃恢复」**在当前 profile 下不可执行**——不是"成本高"，是"跑不起来"。要跑，必须先把 `maxDepth` 调到 ≥6，而这是 profile 改动（文档没有把它列为前置条件，反而在 §5.3 说"契约必须把它们作为硬上限，取 min"，方向正好相反）。
- **附带**：文档 §0.4-5 写"引擎互嵌 depth=4（**硬上限 8**）"——平台硬上限就是 profile 的那个 4，8 是 E4 的建议值。这是 N7（见 §5.3）。

### S3 "零运行时改动"漏了开发回路与发布链

- `hmr.root`（`profile/cordis.patch.yml:4-9`）是**两个绝对目录**；新仓不在其中 → 宿主半改动必须 `disable→enable`/重启（`agent.md:99` D12），session-tree 这种 UI 密集包的迭代成本直接上升。
- D1（`agent.md:88`）+ `agent.md:188`（单向同步、禁止双写）+ `scripts/release-plugin.mjs:57`（源固定为 `packages/dsh-session-tree`）构成一条链：拆仓 = 反转"唯一源码事实源" + 让单向同步脚本失去意义 + 让 `check-version-consistency.mjs` 的 23 条断言（`agent.md:116`）必须重构成跨仓矩阵。
- 这三项都不是"文档改写"，而是**流程与工具链重建**。文档把它们压缩进 §6.2 的三行"必改"里，代价被隐藏了。

### S4 审批的真实约束是 `turnOpen` + `policy`，不是"root-only"

- `dsh-user-approval/lib/index.js`：
  - `request(req)` 用 `req.agent.session`，**先校验 `approvalStateOf(session).turnOpen`**，否则直接抛 "approval.request() outside an open turn"；
  - `decide(req, session)` 第一句：`if (this.effectivePolicy(session) === "never") return "rejected"` —— 根本不问 answerer。
- `dsh-subagent/lib/types/child-agent.js:184`：`approvalPolicy: parent.ctx.get('approval') === undefined ? undefined : 'never'` —— 注意是**条件式**（取决于父上下文是否挂了 approval 服务），不是无条件常量。
- **两个推论**，都与文档冲突：
  1. **"把 gate 上提到 root" 只在 root 同步阻塞于工具调用时成立**（即 flow 形态：root 调 `flow_run`，turn 未结束）。tree 形态是 `delivery:'parent'` 的 fire-and-forget（§1.3 表），**root 的 turn 早已结束** → 任何"leaf 发起、root 代批"的实现都会死在 `turnOpen` 校验上，不是"没有通道"而是"通道有前置条件"。文档 §8 风险表把这条写成"不设计'子会话发起、root 补批'（**无此通道**）"——理由是错的，结论碰巧对。
  2. **"下移"存在一条文档没提的越权路径**：`approval.request` 只吃一个内存里的 `Agent` 句柄，不做调用者身份校验。任何插件只要持有 root Agent 的引用，就能以 root 的身份请求审批（且 `turnOpen` 若恰好为真就通过）。这不是"平台不支持下沉"，而是"平台不校验谁在借身份"。**这是安全面（M1），文档通篇没有安全章节。**

### S5 契约没有强制点

- 平台侧：`workflowEngine` 单 provider、第二个 `provide` 直接抛错（E2 §8.2）；无注册表（E2 §0.3 G6）；唯一可插拔执行面 `subagents.registerProvider` 是**创建会话的 provider**，两个引擎都只是消费者。
- 仓库侧：`§5.1` "用 CI 强制：依赖方向检查、契约 schema 校验、12 项一致性测试"。单仓时这些只能验证"本仓三个目录"；拆仓后要跨仓 CI，而跨仓 CI 又依赖"先拆仓"——文档 §6.5 承认"拆仓后必须有跨仓一致性 CI，否则跨仓偏斜比 monorepo 更贵"，但它把 CI 放在"拆仓后"，于是 **"先契约" 阶段的约束力 = 0**。
- 规模侧：2 个引擎、1 个维护者、0 个第三方实现者。契约的收益函数（防止异构实现漂移）在这个规模下近似为零；成本（第 4 份需要同步版本的东西）却是实打实的。

### S6 软组合的四个"静默"失效模式

| 失效 | 证据 | 用户会看到什么 |
|---|---|---|
| relay 打断 await | `engine.js:519-522` | flow 跑到一半"换了个会话继续"，run 变孤儿 |
| flow 单槽 activeRun | `flow-core/src/engine.js:268,2906` | 同时两个 run：前一个的 cancel/dispose 打到后一个 |
| 权限静默降级 | `permissions.js:448-450` | root 里能跑的 flow，塞进 leaf 后某些节点被 `perm/tier-fallback` 拒 |
| 结果截断 | `tools.js:34,40,341` | 父只能看到 600 字符摘要，机器消费必须自己去读 journal（而 journal 格式是引擎私有） |

文档把这四条分散写在"限制"栏里，没有合成一句判断：**今天的软组合适合"人看着跑一次"的演示，不适合"无人值守跑一夜"的编排。** 而这正是"组合"这个词要解决的问题。

---

## 3. 遗漏（文档没覆盖或权重明显不足）

> 要求 ≥5 条，给 9 条。按"如果只修三条，我选 M1 / M4 / M5"排序。

| # | 遗漏 | 为什么重要 / 证据 |
|---|---|---|
| **M1** | **安全：工具面就是权限面 + 调用者身份可伪造** | `tree_send` 的 `parent` 可由**模型入参**指定（`packages/dsh-session-tree/index.js:251` `args.parent`），只有"不传时"才回落到查 `header.parentSession`（`:262-269`）；随后 `subagents.prompt({parentSessionId: parent, childSessionId: target})`（`:273-283`）按**父地址**授权。也就是说：任何能调 `tree_send` 的会话（工具全局注册，§4.1 自己写了）只要同时给出 target 与其真实父 id，就能向**任意可续接会话**注入一条 steer 消息。文档 §3.2 把它当作"跨层消息能力"叙述，没有识别出这是**无调用者校验的消息注入面**；`tree_add` 还有"字段透传无白名单"（`handoff-2026-11-12.md:195` 自认 severe 属实）。此外 flow journal 落节点输出（§1.3 表），一旦节点输出里带凭据就是明文落盘——文档没有一条"账本里不许出现什么"的规则 |
| **M2** | **成本：token/时间没有账，只有"结构性上限"** | 平台无 token/时间预算原语（E2 §7.3 明确"不存在"）；`maxActiveSubagents` 是**每根 activation 树**的槽位（E2 §7.3），不是全局池——文档 §1.4 写"共享同一池，无租约"与证据不符。后果：跨引擎"父给子下预算"在平台层完全没有观测点，`reserve()` 只能是引擎自报 |
| **M3** | **存储增长 / GC / 单文件全量重写** | `tree-state.json` 是**单文件全量状态**，内含完整 `taskPrompt` 与每次 `done.meta`（我在 `wave2` 树里读到 116KB，10 棵树合计约 428KB，其中大量是 prompt 与事件 meta 的重复）；`tree_maintain gc` **尚未实现**，只是 R14 候选（`agent.md:138`）。文档 P3 要"事件日志 + 投影"，却没提垃圾回收与压缩，等于给一个已经带病的存储再加一层 |
| **M4** | **多 workspace / 多 Host / 并发写** | flow 的存储根被 profile 钉成**绝对路径** `D:/Codes/DSH动态流程引擎插件/.dsh-flow`（`cordis.patch.yml:279`，优先级最高，`lib/storage-path.js:9`）→ **所有 workspace 的 run 落同一目录**；tree 的 `.lock` **未实现**（`handoff-2026-11-12.md:195` 三条 severe 之一，已确认属实）。文档把这两条放在 §4.2 表格最后一行与 P2，实际上"双窗口开两个 workspace"就会踩到。文档 §7.1 反而写"存储根按 workspace 统一"——前提反了（N2） |
| **M5** | **运维：派发即返回 + 自报的失败率** | 这不是理论风险，是本仓刚发生的事实：Wave-2 的 8 个 leaf 里 **C1、D1b 的 attempt-1 都在"进入结算"时被节点超时中断**（`agent.md:171,174`；`runtime.history` 里有 `"state":"timeout","note":"timeout hard deadline"`），`D1-integrate` 被 pruned（`agent.md:174`）；Wave-1 的 C4 因宿主热重载崩溃中断（`agent.md:207`）。都在"靠人发现再派一次"。文档 §4.1 把这种形态标成 ✅，没有把"人肉兜底"计进运营成本 |
| **M6** | **UI / 审批在谁的界面上** | 文档 L3 只说"只读投影 + 点击跳会话"。没回答：flow 已自有右侧栏面板、tree 无面板、session-tree 占左栏（`priority -100`）、平台 Team 视图另有入口——四套视图并存时，**用户在哪里看到"这个节点属于哪个 run、第几次 attempt、花了多少、卡在哪个审批"**？审批卡是宿主 approval 的 UI（`approval-port.js:228-246` 用 `toolName/reason` 渲染），而 gate 又只能在 root，于是"多级组织形态"的审批体验实际上是"一堆没人看的卡片" |
| **M7** | **维护负担：三份账本、两套格式、一次升级两处失败** | C3（E1 §12.1）：同一批 DSH 原语两套适配，`startContinuable` 移除已让两侧**分别**失败（`agent.md:128` R3 是止血）。文档的 L1 契约**不解决**这个问题（它约束的是引擎之间，不是引擎与平台之间）；真正需要的是"适配层的双形防御规范"，而文档 §6.4 明确反对共享 adapter——反对是对的，但它没有替代方案，等于把 C3 留给未来 |
| **M8** | **机会成本** | 同样 45–73 人日可以直接做出 3 个用户可见能力：`flow_cancel(runId)`（E3 列为 P0）、flow artifact 结果引用（解决 600 字符截断）、tree 的 `gc` + `.lock`（两个已确认 severe）。这三项都能在**今天**让"组合"更可靠，而内核/注册表/12 条不变量一项都不能。文档 §9-Q3 把这写成"是否投入"的选择题，但没有把机会成本列进同一张表 |
| **M9** | **安全边界：密钥与凭据在组合链上的流动** | 项目已有硬纪律：`GH_TOKEN` 只在内存、禁止打印/落盘/进 URL（`agent.md:68`）。但组合链上出现了三个新的落盘点：flow journal（节点输出全量）、tree `taskPrompt`/`done.meta`（我读到的 state 里就有完整任务书）、handoff 文件（`HANDOFF-*.md`，`.gitignore` 仅忽略仓内）。文档没有一条"账本脱敏/禁止字段"规则 |

---

## 4. 与项目既有决策的一致性检查

| 决策 | 冲突？ | 说明 |
|---|---|---|
| **D1**「本仓=唯一源码事实源；发布=本仓→公开插件仓同步」 | **冲突（硬）** | 文档 §6.1/§6.2 建议把 session-tree 拆为独立仓（镜像仓扶正）。这不是"D1 的延续"，是**反转** D1 的核心条款。若要做，必须先改 D1（新增决策记录），而不是在架构文档里顺手改 |
| **D3**「npm 冻结，解冻需用户显式批准」 | **未对齐** | §6.3 的阻塞项一半（`private:true`、`@local`、`repository/license/author`、市场 listing）只在解冻后有对象；§9-Q2 却把"生态型/市场化"作为拆仓紧迫度的决定项。文档应显式写"在 D3 未解冻前，这些不计入工期" |
| **D5**「公开范围=本仓库内容本身」 | 未冲突，但未评估 | 拆仓后 session-tree 的公开面从"本仓子目录"变成"独立仓"，D7 的第三方源码/隐私排除清单（7 文件）需要在第二个仓的历史里重做一遍。文档无此条 |
| **D6**「改代码必须 bump；内容不变不制造假更新」 | 未冲突，但成本未计 | 拆仓后有两个版本线；`check-version-consistency` 的 23 条断言（`agent.md:116`）要重构成矩阵；`release-all.mjs` 的单向语义失效 |
| **D12**「宿主半改动必须 disable→enable」 | 已提及（§6.2） | 但漏了更前置的一条：`hmr.root`（S3） |
| **D17 / Wave-2 状态** | 未对齐 | 文档 §1.1 说 flow 状态落 `<runCwd>/.dsh-flow`（N2 错），说 tree 无 `.lock`（对，但没引 `handoff §7-9` 的"已确认 severe"） |
| **发布门禁 §5（A1–A9 独立验证、Lead 独占发布、密钥扫描全历史）** | 未评估 | 门禁是**单仓**设计的（A9 瘦身、`rev-list --objects` 全历史）。拆仓意味着门禁要跑两遍、历史重写要跑两次。文档 §6.5 只提"跨仓一致性 CI"，没提门禁 |
| **公开仓纪律（`docs/README.md:85` 跨仓引用）** | 已提及（§6.2 A7） | 这条文档是对的，我未找到反证 |

---

## 5. 补充：文档内部不一致（N1–N7，供修订时一次改掉）

| # | 位置 | 问题 |
|---|---|---|
| N1 | §1.4「session header 白名单（8 个字段）」 | 与它引用的 E2 §0.3-G3 冲突（E2 写"7 个 meta 字段，共 9 个 header 字段"）。两个数字对不上，读者无法判断哪个是取证结果 |
| N2 | §1.1「flow 状态落盘 `<runCwd>/.dsh-flow/runs/*.jsonl`」 | 与 profile 实际冲突：`cordis.patch.yml:279` 把 `storageDir` 钉成绝对路径，优先级最高（`lib/storage-path.js:9`）→ 不是 per-runCwd，而是**全 workspace 共用一个目录**。这使 §7.1-P0-4「存储根按 workspace 统一」的前提不成立 |
| N3 | §0.1/§6.1「无代码改动」 vs §7.1-P0-3 | P0 被描述为"0 代码"，但它断言的是一个运行时行为（"运行中 flow 的 leaf 不报 context、不被 harvest"），而该行为由代码（`engine.js:519`）决定，约定管不到 |
| N4 | §0.4-5「引擎互嵌 depth=4（硬上限 8）」 vs §5.3 注 | §5.3 自己纠正"当前 DSH 更紧，必须作为硬上限"，§0.4 仍写"硬上限 8"。同一文档两个上限 |
| N5 | §4.1「任意节点调任意引擎 ✅ 天然成立」 | 与 flow 单槽 `activeRun` 冲突（S6 反证 2） |
| N6 | §9 标题「建议先回答这 6 个」 | 实际列了 7 条（Q1–Q7） |
| N7 | §1.2「协议耦合…有（语义，可保留）」 vs §8 风险表「双账本 高」 | 协议耦合被标成"可保留"，但 leaf owner 与 handoff 不迁移 owner 的协调（`E_BORROWED_IDENTITY` + `set-session`）正是双账本的一个具体形态，两处定级不一致 |

---

## 6. 最小可行下一步（如果由我做，5 步；前 3 步是必须）

> 判据：每一步都要产生**可观测的判决**，而不是再写一份文档。总计约 4–6 人日，覆盖文档 P1 的 60% 价值，不碰内核。

**第 1 步（≤1 人日）｜先测 S1，不写代码。**
固定用例：tree（3 层）→ 某 leaf 内 `flow_run`（3 节点、挂一个 5 分钟的 code 节点）→ 让 leaf 上下文自然涨过 42%。
**验收**：①在 tree 日志/`tree_status` 里抓到 "bamboo" 事件的时间点，或②贴出 `tokenMeter.measure shape:` 那一行证明 `usagePct` 恒 `null`。二者取一，产出**一句判决**："relay 会/不会自主打断 flow"。这一步决定后面所有组合方案是否安全。

**第 2 步（≤1 人日）｜给 tree 加 per-leaf relay 抑制开关（唯一必须的代码改动）。**
`tree_node set-context` 已存在，加一个 `relay: 'auto'|'off'`；`sweepTick:519` 读它。
**验收**：同一用例在 `relay:'off'` 下跑到完成，`flow_run` 返回正常，`runtime.segmentChain` 为空；`relay:'auto'` 下复现第 1 步现象（证明确实是这个开关在起作用，而不是别的因素）。

**第 3 步（≤2 人日）｜只做 3 个数据面小改，不做契约、不做内核。**
(a) flow journal 补 `parentRunId/parentNodeId`（`ownerSessionId` **已有**，见 `engine-builtin.js:816,906`，只需保证 run 级一致）；
(b) `flow_cancel(runId)` + 把 `activeRun` 单槽改多槽（`flow-core/src/engine.js:268,2906`）；
(c) 结果引用：`flow_run` 返回 artifact 路径（替代 600 字符摘要）。
**验收**：从 tree leaf 起的 flow 可被 tree 侧按 `runId` 取消（贴 journal 的 `cancelled` 事件）；`flow_status` 能按父 run 聚合出子树；节点输出 >600 字符时父能从文件读到全文。

**第 4 步（≤0.5 人日）｜一页纸《组合约定 v0》，不写 schema、不建 contract 仓。**
只写 5 条：命名空间串（`root_run_id + path`）、谁写哪个账本、gate 只能在哪里出现、relay 开关的语义、结果交付走 artifact 不走摘要。
**验收**：两个引擎的 SKILL/README 各加一行指针；**出现第二个独立实现者或第二次真实组合需求之前，不升级为 schema**。

**第 5 步（0 人日）｜拆仓：不做。**
把"三个 bundle 可独立安装、互不 import"在 README 写清楚（这已经是事实），把拆仓挂到两个触发器上：①npm 解冻（D3 需用户批准）②出现第二个独立消费 session-tree 的人。**两者都未发生时，拆仓是纯支出。**

### 现在**不要**做

| 不要做 | 理由 |
|---|---|
| 不建 contract 仓 / 12 条不变量内核 / `OrchestratorRegistry` | 没有强制点（S5）；2 引擎 1 维护者规模下收益≈0，且会成为第 4 份要同步版本的东西 |
| 不为拆 tree-engine 改 `@local` scope / 去 `private:true` / 补 `repository` | D3 冻结 npm，这些只在解冻后有交付对象（§1.2） |
| 不做统一拓扑 UI（L3）、不做 tree 服务化（`await+dispose`） | tree 的 fire-and-forget 是它的**语义**不是缺陷；改 await 会与 relay/handoff 正面冲突（S1/S2） |
| 在 leaf/flow 节点内跑含 `human_gate` 的 flow | 今天必 fail-closed（`decide()` 的 never 短路）；"root 代批"在 `turnOpen` 前不成立（S4） |
| 把 §7.4 的"tree→flow→tree + verify + 审批分流"当成本轮验收 | 当前 `maxDepth=4` 下不可达（S2）；要么先调 depth 并写清代价，要么把验收降为"tree→flow"两层 |
| 不要用"文档 + 一致性测试"作为契约**唯一**形态 | 那就是 §6.4 自己反对的东西的软版本；要么有运行时强制点，要么就只写一页约定 |

---

## 7. 我支持什么（红队也要给可执行的部分）

1. **§2 四图分离** + **§5.4 identity/lineage 三件套**：这是全篇最该保留、最便宜、最该先做的一段。它不需要内核，只需要两个引擎各加两三个字段（第 3 步顺手就做完了）。
2. **§6.4 拒绝公共 adapter 包**：论证扎实（E1 §13.1 同结论）。真正的风险不是"抽象层次不够"，而是"把零耦合变成版本锁"。
3. **§3.1 的 RACI**：与 E2 §9.1 逐行吻合，可以直接当边界文档用。
4. **§0.2 的判断"拆分不是第一动作"**：结论我同意，只是理由要换成 S3/S5，而不是"先把契约写清楚"。

---

## 8. 证据索引（我实际读到的位置）

| 主题 | 坐标 |
|---|---|
| relay 由定时器自主触发（S1） | `packages/dsh-tree-engine/src/engine.js:484-534`（`:517` 测量、`:519-522` 触发、`:526` 注释、`:541` 定时器）；`src/engine.js:563-565` |
| 宿主测量端口与形状未知 | `packages/dsh-tree-engine/index.js:14`、`:171-183` |
| tree 的 verify 会起子会话（S2） | `packages/dsh-tree-engine/index.js:414`（`startChildSession`，父=调用 leaf） |
| 深度 = 父+1，超限抛错 | `asar:.../dsh-subagent/lib/types/child-agent.js:36-39` |
| 子会话 approval 被钉 `never`（条件式） | `asar:.../dsh-subagent/lib/types/child-agent.js:174-184`（`:184` 三元表达式） |
| approval 的 `turnOpen` 校验 / `never` 短路 | `asar:.../dsh-user-approval/lib/index.js`（`request()` 首段；`decide()` 首句）；策略闭集 `:37`、`APPROVAL_POLICIES`、`effectivePolicy()` |
| 平台硬上限 | `profile/cordis.patch.yml:226-227`（`maxDepth:4`、`maxActiveSubagents:20`） |
| HMR root（S3） | `profile/cordis.patch.yml:4-9` |
| flow 存储根被钉绝对路径（N2/M4） | `profile/cordis.patch.yml:272-280`；`spike/dsh-flow-plugin/lib/storage-path.js:7-10`（优先级 `storageDir > env > <runCwd>/.dsh-flow`） |
| flow 单槽 `activeRun`（S6） | `spike/flow-core/src/engine.js:268,2906,3029,3058`；插件单实例 `spike/dsh-flow-plugin/index.js:727` |
| `callerOrigin=subagent` → ceiling safe（S6） | `spike/flow-core/src/permissions.js:7-8,37-38,448-450` |
| 结果截断 600/4000（S6） | `spike/dsh-flow-plugin/lib/tools.js:34,40,341` |
| `ownerSessionId` 已存在 | `spike/dsh-flow-plugin/lib/engine-builtin.js:816,906`；`spike/flow-core/src/engine.js:3008`（`RUN_STARTED` 处写 null，需按 run 级核对） |
| `tree_send` 的 parent 可由入参指定（M1） | `packages/dsh-session-tree/index.js:251`（`args.parent`）、`:262-269`（回落查 header）、`:273-283`（`prompt({parentSessionId,parent childSessionId})`） |
| 验证模式分布与近似空过（M2 相关） | `packages/dsh-tree-engine/src/verify.js:8`（六模式）、`:13-15`（`artifact-doc` = `**/*.md` + `minSize:200`）；活体 10 棵树 29 条 verdict = self-report 11 / artifact 16 / command 2 / llm-judge 0 / human 0 / composite 0 |
| 已知边界与 severe 自认 | `docs/operations/handoff-2026-11-12.md:189`（预算口径）、`:193`（artifact 对象错位未修）、`:195`（`.lock` 未实现 / nudge 绕状态机 / leafAdd 无白名单，33 条审计 3 条 severe 属实） |
| Wave-2 的现实失败率（M5） | `agent.md:171`（C1 attempt1 超时→attempt2）、`:174`（D1b 同）、`:174`（D1-integrate pruned）、`:207`（Wave-1 C4 宿主崩溃）、`:138`（`tree_maintain gc` 仅候选） |
| 拆分与发布链（S3） | `agent.md:88`（D1）、`:90`（D3）、`:99`（D12）、`:116`（23 checks）、`:188`（单向同步铁律）；`scripts/release-plugin.mjs:57` |
| 契约的强制点缺失（S5） | `D:\Codes\_composition-research\E2-dsh-capabilities.md` §0.3-G6、§8.2、§9.1、§11 |
| 目录/测试基线 | `packages/*/package.json`（0 deps；session-tree `repository` 已指向镜像仓 `:17-24`）；E1 §1.2、§3.1、§9.4、§10.3、§11.2、§13 |
| flow 组合缺口的独立结论 | `E3-freeflow.md` §0 表项 5/6、`:202`（节点里再跑 flow）、`:290-292`（截断/前台/子会话 gate）、`:317-319`（gate/预算）、`:500`（单槽 activeRun） |

> 说明：`packages/` 与 `profile/` 路径均相对 `D:\Codes\dsh-tree-harness` 与 `%USERPROFILE%\.dsh\profiles\desktop`；`asar:` 前缀表示在 `D:\DSHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\` 下用 `scripts/asar-tool.cjs` 只读取证。
