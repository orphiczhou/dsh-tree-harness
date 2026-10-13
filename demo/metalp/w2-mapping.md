# W2 引擎映射分析 — 方法轮概念 ↔ 树引擎原语

> 分析员：W2（metalp 树 metalp-W2-map 叶）· 2026-10-13
> 对象：「元系统工作法」方法轮（主链 反馈→分析→策划→决策→实施→反馈 递归；分析用 1115 法；策划用固本/正源/破链/纠偏/填坑/通渠六类；决策用 APX+相位裕度+分级风险处置；实施后总体检视）
> 证据基线：`packages/dsh-tree-engine/src/`（engine.js 779 行逐读；state.js/verify.js/adversarial.js 通读）+ `docs/meta-system-argument.md`、`docs/proposals-from-agent-notes.md`、`docs/agspec-report.md`。所有行号实测，非转述。

---

## 1. 映射表：方法轮概念 ↔ 引擎原语

### 1.1 已有对应物（判定=真）

| 方法轮概念 | 引擎对应物 | 证据 | 判定 |
|---|---|---|---|
| 反馈（偏差留痕） | drift 体系：`drift:append`/`drift:list` + 全树 `drift_log`，四类 kind（production/direction/rhythm/security）× 六动作（nudge/limit/prune/**self_correct**/declare/handoff） | engine.js:595-618（driftAppend/driftList）；state.js:28-30（枚举闭集）；竹节/级联剪枝自动写 drift（engine.js:183、243-245、308-310、503-504） | **真**。引擎留痕面完整，反馈的"采集"半环已有；"回到分析"半环没有（见 1.2） |
| 纠偏（六类之一） | drift action `self_correct` 字面命中；7-strike 分级催办（3 次 mid、5 次 high、≥7 强制 pruned） | state.js:79-84（nudgeEscalation）；engine.js:317-330（nudgeAppend 自动升级剪枝） | **真**。纠偏是引擎原语级概念 |
| 破链（打断自评分通过） | llm-judge 强制异族评审 + command 模式宿主侧执行 + DoD 与验证器同模板注入 | verify.js:8（六模式）、127-137（llm-judge 经 ports.judge）、81-85（dodPrompt 同源）；meta-system-argument.md §3.3 明文"破法" | **真**。该不良链已在执行层被打断 |
| 破链（打断上下文耗尽链） | 竹节：42% 水位 → segment_pending → 先 interrupt 后 dispatch 接力，链长上限熔断 | engine.js:31（缺省 42）、232-250（setContext 刚性触发）、474-508（bambooRelay：484-487 链长 frozen、488-492 顺序铁律、502 水位清零）、553-556（sweep 自动触发） | **真**。且是 sweep 全自动 + 手动兜底双路（meta-system-argument.md §3.4 纠偏条目 3 已自证闭环） |
| 决策门禁 | done 三重闸：① caller=owner 会话独占（防 commander 谎报）② 必须先有 type=done 事件 ③ milestones 全部 audit_pass=true；外加状态机白名单 | engine.js:260-263（done 所有权）、167-175（set-status 双闸）；state.js:45-70（assertTransition/assertDoneEventGate/assertMilestoneGate） | **真**。"三重"名副其实：ownership + event gate + milestone gate 三处独立断言 |
| 依赖闸（策划的顺序治理） | dependencies 装载期形状/存在性/环检测 + 派发期 E_DEPENDENCY_NOT_MET 阻断（deps 未 succeeded 不许 dispatch） | engine.js:110-130（leafAdd 环检测 DFS）、396-403（dispatchStart 依赖闸） | **真**。"依赖拓扑驱动执行"的引擎半边已就位（自动化半边=P2 提案未立项，见 1.2） |
| 分级风险处置 L0-L4 | L1=Config 参数化；L2=onFail retry:1；L3=frozen 语义/7-strike/竹节链长熔断/sweep degraded-lazy；L4=backup/restore 全树回滚 | verify.js:12-23（onFail 枚举）；state.js:72-84；engine.js:298-299（E_SEGMENT_CHAIN_LIMIT）、574（degraded-lazy）、710-737（backup/restore 保留 10 份） | **真**。五级中 L0-L4 全部有机制实体（meta-system-argument.md §4.3 表即以这些机制为"既有机制"列建） |
| 策划-填坑（验证 FAIL→修复回灌） | adversarial attack-defense-audit ≤N 轮：FAIL findings → ports.fix 通知执行者 → 下一轮 | adversarial.js:1-11（流程注释）、43-60（轮循环与修复路径） | **真**。修复回灌环已机化 |

### 1.2 部分对应（判定=半真，需辨析）

| 方法轮概念 | 声称的对应 | 实测 | 判定 |
|---|---|---|---|
| 总体检视（实施后） | tree_verify | verify.js 是 **per-leaf DoD 裁决**（policyFor/runVerifications 按节点跑），adversarial 也是单节点靶子。**没有全树级"检视"原语**——无任何命令汇总 drift_log+events+call-log 做整轮复盘。全树复盘（retro）是 P3 提案，proposals-from-agent-notes.md:23-29 明标"未立项" | **半**。per-node 检视有、per-round 检视无 |
| 竹节 relay ≈ 局部重构 | bamboo-joint relay | relay 只续 context（换会话续同一任务，engine.js:474-508），**不重构任务结构**——不重分叶子、不改依赖、不改 DoD。真正接近"局部重构"的是 pruned 级联（engine.js:178-189）+ 重派（attempt+1，engine.js:432） | **半**。"context 续链"真，"局部重构"是引申 |
| nudge-reset ≈ 再递归 | nudge:reset | engine.js:683-692 仅做 `nudge_count=0; nudge_log=[]`——清零催办计数器，**与"开新一轮方法轮主链"毫无语义关联**。方法轮的递归是"反馈→分析→…"整环重启 | **不成立**。此对应是任务书候选清单里最弱的一个，不应写入插件设计 |
| 决策（APX） | 引擎裁决机制 | 引擎有的是**门禁**（闸住什么不许过）和**策略路由**（taskTypeMap → policyId，verify.js:27-33）；没有"候选方向集→向心评估→取舍"的原语。APX 裁决（D1-D8）只存在于 meta-system-argument.md §4.1 文档表格 | **半**。门禁≠决策：门禁管合规性，APX 管方向取舍，二者不同层 |
| 反馈→分析传导 | drift_log 等 | 偏差信号原材料齐全（drift_log、heartbeat_log、communication_log、call-log、sweep events），但**没有任何工具把这些原料加工成"分析输入"**——五问/一横一纵在引擎中零命中 | **半**。采集有、传导无 |

### 1.3 缺失（引擎确实没有，硬造之前需新增）

| 方法轮概念 | 缺什么 | 证据 |
|---|---|---|
| 1115 法（分析坐标） | 一横（相关系统展开）/一纵（稳定对象+功能坐标）/一链（传导链）/五问（方向收束）——引擎无任何对应状态、字段、工具。grep 全 src 无 "1115/五问/稳定对象" 命中 | 全仓 src 通读；meta-system-argument.md §2 为纯文档方法 |
| 相位裕度量化 | 六稳定对象 Z1-Z6 的"偏差信号→裕度"监控面只在文档（§4.2 表）。引擎有**原材料**（sessionCount engine.js:357-361、链长、sweepMode、drift 频次）但没有周期采样、没有裕度计算、没有告警阈值 | engine.js 返回值均为即时查询，无时序累积 |
| 跨轮 loop 状态 | 主链轮次（第 N 轮、当前处于哪一环节、本轮触发信号是什么）零原语。`state` 顶层字段只有 leaves/drift_log/session_registry/heartbeat_log/communication_log/backups（engine.js:56-72），无 round/loop 概念 | engine.js:56-72 init 状态形状 |
| 全树总体检视（retro） | 见 1.2 第一行；P3 提案即为此缺口 | proposals-from-agent-notes.md:23-29 |
| 递归触发表 | §5.3 表（差分差异→回分析；竹节风暴→复盘阈值…）无引擎载体；触发判定目前全靠指挥官人读日志 | meta-system-argument.md §5.3 |

### 1.4 不硬造（强行机化会失真）

| 方法轮概念 | 为什么不该进引擎 |
|---|---|
| 系统第一人称视角（"我是 dsh-tree-harness，我的存在意义是…"，meta-system-argument.md §0） | 这是**叙述性世界观**，功能是给人（或指挥官模型）提供定位语境。机化为状态字段只会得到一个永远不变的字符串，不参与任何闸门/调度判定——失真为零收益。它属于 SKILL/prompt 层的语境注入，不属于状态层 |
| APX 的"向心关系"（候选方向对稳定对象的引力/斥力） | 引力/斥力是**人的价值判断**（"Z5+Z1 强引"）。引擎能给证据（该方向动用多少预算、破坏哪些不变式——这些可测），但"+引/−斥"的赋值与权衡是裁决者的自由裁量。强行做成打分函数会把方法论降级为表格填充，且打分权重本身无真源可正源 |
| 六类策划分类（固本/正源/破链/纠偏/填坑/通渠）本身 | 这是**组织人类注意力的分类学**，不是数据结构。引擎里各类动作的实体落点散在护栏/差分测试/竹节/异族评审等处（§1.1 已逐条对应），把"六类"做成引擎枚举只会让引擎长出一个谁也不消费的标签字段 |
| 五问之"为何存在" | 目的论问题。任何机化答案都是预写文本，属于 agspec-report.md §4③ 式的"物理不可能/无意义"类 |

---

## 2. 关键论证：「方法轮插件=执行治理层，树引擎=任务执行层」是否成立

**结论：分层在代码结构上基本成立，但有三处张力需要设计时显式处理。**

### 2.1 支持证据

1. **引擎是纯逻辑核 + 端口注入，天然是"被治理"的下层。** engine.js:1-5 明言"纯逻辑，不 import DSH API"；宿主能力（subagents/timer/sessionQuery/tokenMeter）全部经 `ports` 注入（engine.js:364-366、375 needPort）。方法轮插件可以完全经 `call()` 统一入口（engine.js:760-776，永不 throw）驱动引擎，不需要侵入引擎内部——两层的接缝已经存在且稳定（这是 Z4 接口缝稳定对象的直接收益，meta-system-argument.md §2.2 Z4）。
2. **引擎的状态语义全部聚焦"单节点生命周期"，零方法论概念。** runtime 状态机 running→succeeded|failed|timeout|cancelled|frozen（engine.js:366）；leaf 状态闭集六值（state.js:15）；全部闸门（预算/深度/链长/依赖/三重闸）回答的都是"这个活能不能派、能不能结算"，从不回答"下一步该分析还是该策划"。循环顺序在引擎中零状态（见 1.3），恰说明"怎么打循环"是空位，分层是**结构性空白**而非重叠。
3. **方法论文档自身就是这么用引擎的。** meta-system-argument.md 是一轮完整方法轮的产物，而它的"实施"（S0/S1）全部落为引擎规约与代码——即方法轮把引擎当执行对象消费，实构先例已存在。

### 2.2 反对/张力证据

1. **方法论已轻微泄漏进引擎文本。** engine.js:470 注释直接引用"meta-system §4.2 Z6"作为竹节顺序铁律的出处。虽只是注释非行为，但说明"先 interrupt 后 start"这条本是方法轮决策（D2/§4.2 最紧裕度判定）的产物已经**固化为执行层铁律**——边界不是单向的：治理决策会下沉为执行不变式。这是合理下沉（裕度判定一次、闸门永久生效），但设计插件时须承认：**有些"决策"已经不可逆地住进了引擎**，插件不能重复裁决（如插件不应另设一套"是否允许派发"的判断，否则与 E_DEPENDENCY_NOT_MET/预算闸双头指挥）。
2. **执行层已内嵌一个 mini 循环。** adversarial.js 的 attack→fix→re-round 本质是"验证→反馈→修复→再验证"的闭环（adversarial.js:4-8）；sweep 竹节也是"观测→触发→交接"的自治循环（engine.js:549-556）。即执行层并非纯粹"把活干完"的被动层——**节点内的治理自动化已经存在**。方法轮插件的主权范围应明确限定在**跨节点/跨轮**（树的层面），节点内循环让给引擎，否则职责冲突。
3. **done 三重闸占据了"决策门禁"语义。** 方法轮"决策"环节若理解为"允不允许收口"，引擎已用 ownership+event+milestone 三闸回答（state.js:54-70）。插件的决策环节应处理**方向性取舍**（做哪个、先做哪个、砍哪个），与引擎的合规性门禁分层共存——这个区分必须在插件设计里写死，否则会出现插件复检 done 条件的冗余双标。

**判定**：分层成立，附三条设计约束——①插件只经工具面驱动引擎；②插件主权=跨轮/跨节点循环，节点内循环（adversarial/竹节/sweep）归引擎；③插件决策=方向取舍，合规门禁归引擎。

---

## 3. 缺失原语清单（实现方法轮插件所需，按必须/可选分级）

### 必须（没有它们方法轮不成环）

| # | 原语 | 形态 | 依据缺口 |
|---|---|---|---|
| M1 | **loop 状态**：`{round_id, phase: feedback|analysis|planning|decision|implementation|review, trigger_signals[]}` | 插件自有状态文件或引擎 state 顶层扩展字段（不动 leaves 结构） | §1.3 跨轮 loop 状态缺失；引擎 init 形状（engine.js:56-72）无此位 |
| M2 | **反馈聚合查询**：把 drift_log/heartbeat_log/sweep events/verify verdicts/communication_log 汉化为"本轮反馈条目"的只读工具 | 只读查询（可纯插件层实现，原料引擎全有，见 §1.2 末行） | 反馈→分析传导断点 |
| M3 | **总体检视（retro）工具**：全树复盘汇总（=P3 提案的 tree_maintain retro 动作或插件等价物） | 读 events/drift/call-log 产检视报告 | §1.2 总体检视半真；proposals P3 未立项 |
| M4 | **递归触发判定**：§5.3 触发表的可执行版（差分差异/竹节风暴/降级频繁/预算逼近→对应下一轮动作） | 规则表 + 对 M2 聚合结果的判定 | §1.3 递归触发表缺失 |

### 可选（增强，非闭环必需）

| # | 原语 | 价值 | 依托 |
|---|---|---|---|
| O1 | 裕度快照：周期采样 sessionCount/链长/sweepMode/预算占用入时序 | 给"相位裕度"提供可测原材料（量化公式本身留给人，见 §1.4） | sessionCount（engine.js:357-361）已有即时值 |
| O2 | 决策账本（decision log）：APX 裁决落账（候选/理由/取舍） | 可审计；但向心赋值仍属人 | call-log 只记工具调用，不裁决 |
| O3 | lessons 滚雪球（P3 全量） | 跨树经验回流 | proposals P3 |
| O4 | 1115 分析画布 schema | 结构化分析产物（表格模板），便于 M3 消费 | 纯文档/schema |
| O5 | 事件驱动派发（P2 deps-ready） | 让"策划"的依赖拓扑自动驱动实施环节 | proposals P2 未立项 |

### 明确不做（§1.4 的机化禁区）

向心力量化函数、第一人称视角字段、六类分类的引擎枚举、"为何存在"的机内答案。

---

## 4. 结论一句话

方法轮与树引擎的关系是**治理层驱动执行层**：反馈留痕、纠偏、破链、门禁、分级处置在引擎中已有扎实的原语级对应（drift/竹节/三重闸/onFail 阶梯，均逐行核实）；1115 坐标、相位裕度量化、跨轮 loop 状态、全树 retro 是真缺口（M1-M4 必须新增）；第一人称视角、向心关系、六类分类属人的判断/分类学，强行机化必然失真，应留在 SKILL/prompt 与文档层。
