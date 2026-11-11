# 备选提案 — 来自《AI Agent 使用体验随感》的可落地项(2026-10-04)

> 来源:用户随感 d:\桌面\AI Agent使用体验随感.txt(45 条),与本仓树形 harness 逐条对照后的筛选结果。
> 性质:**备选提案清单,未立项**——后续按需选择实现;实现时在本文件勾选并链接提交。
> 结构:每项 = 提案内容 / 依据(随感条目)/ 改动面 / 代价与风险 / 验收方式。

## P1 竹节链长收紧 5→3

- **内容**:`segment_max_chain_length` 缺省从 5 降为 3(含首节),SKILL 写明理由。
- **依据**:#38——大模型概率本质下每次交接都丢信息,不超过 2 次交接(链长 3)以保认知完整、避免认知偏移。**实证旁证**:e2erly 中 chain=2 的后继出现"重复完成已 done 的综述"行为(认知偏差信号)。
- **改动面**:engine.js 缺省值一行 + config.js 范围注释 + segment-handoff.md 文档 + 既有测试改期望。注意源引擎为 5(差分域外参数,不影响差分)。
- **代价/风险**:超长任务更早 frozen(需指挥官接管重派);与源引擎缺省分歧要登记 DEVIATIONS。
- **验收**:单测改绿 + 一条 config 覆盖示例;E2E 不必新跑。

## P2 事件驱动派发(deps-ready 自动 start)

- **内容**:`tree_dispatch {action:"start", when:"deps-ready"}`——登记待派发,依赖全部 succeeded 时引擎自动派发(sweep 回流钩子处触发),消灭指挥官轮询。
- **依据**:#4——树上节点可条件触发;依赖拓扑应驱动执行而非靠人记顺序。**实证旁证**:e2e3l 中 C2 轮询 ~80 秒等 C1b 完成才能放行 C2a。
- **改动面**:leaf 增加 `pending_dispatch` 字段(runtime 内);done→succeeded 回流点(event:append 与 sweep 双处)检查下游待派发节点;tree_dispatch schema 加 when;防重入。
- **代价/风险**:回流路径加逻辑(热路径,须小心临界区);取消语义(cancel 一个 deps-ready 节点=撤销登记);预算护栏在自动派发时同样生效。
- **验收**:单测(依赖完成即自动 running;未完成登记不派发;cancel 撤销)+ 双节点 E2E 复跑 e2edep 模式(负例:依赖未完成时 when 登记成功但确实不跑)。

## P3 经验回收 retro(lessons 滚雪球)

- **内容**:tree_maintain 新动作 `retro`——树全绿后由指挥官(或独立会话)提炼:分解理由、verify FAIL→重派修正对、优质 worker prompt,追加 `tree-engine-data/lessons.jsonl`(树间共享);commander 建点时可按 taskType 检索同类 lessons 注入提示词。
- **依据**:#2(名言浓缩滚雪球)/ #9(经验汇总分发 PDCA)/ #17(自举的最小起点)/ #35(方法论内化到流程)。
- **改动面**:tree_maintain 动作 + 存储一条 jsonl + SKILL 指引;检索注入做薄(建点时 tree_maintain {action:"lessons", taskType} 查询最近 N 条)。
- **代价/风险**:经验质量参差→需"人校准"或 verify 门(先落 raw,提炼交给下批);jsonl 无限增长→按条数滚动。
- **验收**:E2E 后 lessons.jsonl 有真实条目;第二次同类树建点时能取回注入。

## P4 assignee 模型路由策略进 commander SKILL

- **内容**:SKILL 增一节:judge/verify 环节用最强可用模型(防子模型误判改错),调研/执行用性价比模型;引擎无需改(agentOptions 已支持 per-node 路由)。
- **依据**:#33(次级模型误判必须 SOTA 亲自复核)/ #44(SOTA 规划+次级执行)。
- **改动面**:纯文档(skills/tree-commander/SKILL.md)。
- **代价/风险**:无;注意与 llm-judge 宿主端口(P5)联动——judge 端口派发时就按此路由。
- **验收**:文档评审即可。

## P5 llm-judge 宿主评审端口装配

- **内容**:verify.js 的 `ports.judge` 宿主侧实现——派评审 subagent(带 rubric + 产物,要求单行 JSON 裁决),轮询 readSession 提取,超时 fail-closed。
- **依据**:#30(生成与审计都由 Agent 完成)/ #32(矩阵覆盖验证、多轮审计至收敛)/ #28(生产者/检验者分工)。
- **改动面**:index.js makePorts 增加 judge 端口(参照 promptHandoff 的轮询回收模式);DRIFT:评审会话会占用树会话预算吗?(经 registry 旁路登记即可,不占 leaf)。
- **代价/风险**:评审会话本身耗时(10-60s)与费用;JSON 提取鲁棒性;评审者与执行者需异族(不同模型)防同源偏置。
- **验收**:单测(fake judge 已绿,补宿主装配烟测)+ E2E 一例 code-change 节点走 llm-judge PASS。

## P6 节点成本回灌(token/耗时入 leaf)

- **内容**:收割回流时从会话元数据/tokenMeter 取 token 用量与耗时写入 leaf(如 `leaf.cost={tokens_ms, wall_ms}`);树收口报告与 call-log 汇总。
- **依据**:#39 延伸——闭环要把"代价"也翻译成文字回灌;#1(剪枝要按代价剪——race/重派决策的原料)。
- **改动面**:ports 增加 cost 端口(防御提取,缺省 null);runtime 回流点写账;tree_status overview 汇总。
- **代价/风险**:会话计量字段形状未冻结(同 usagePct,首调冻结策略);不阻塞主链(尽力而为)。
- **验收**:E2E 后 tree-state 有 cost 字段或显式 null(降级可见)。

## P7 双轨竞争派发(race)

- **内容**:同一 leaf 允许登记两个候选执行(track-a/track-b 并行),首个 verify PASS 者胜,另一路 cancel;失败方可作对照保留于事件流。
- **依据**:#1(平行时间线并行试错+剪枝)/ #31(fork=搜索动作)。
- **改动面**:runtime 支持 multi-track(状态机扩展,当前单 subagentSessionId 假设要破);verify 结果路由;成本=双份 token。
- **代价/风险**:**改动面最大**,涉及 runtime 核心结构;建议排在 P2/P5 之后评估;先在 SKILL 层用"两个 leaf + commander 手动择优"模拟(已可行)。
- **验收**:构造必败+必胜双轨 E2E,胜者采纳败者 cancel,leaf 单终态。

## 已印证项(无需行动,存档对照)

#38 竹节=交接文档(segment-handoff)/ #39 闭环=后果翻译为文字(done 回流+verify 落账)/ #3·#36 树形结构化与层级任务核心抽象(整个引擎)/ #28·#29 层级+检验者分工+人锚方向(三角色+验证层)/ #31 fork 剪枝(attempt/pruned)/ #45 元系统工作法(属外部方法论，其材料已随废弃插件移除)。

## 中长期观察项(不立项,记方向)

- #24·#25 人脑三层模拟(脑干=定时 sweep / 小脑=skill / 大脑=commander)——架构雏形已同构;「本地小模型做脑干」为宿主层选项。
- #17 自举——P3 retro 是最小起点;先积累成长记录,再谈 harness 改自己。
- #43 探索思维版 Proma——树投影导出为思维路径文档(leaf+事件序列→人可读路径),低成本可试。
- #34 需求再修正环——human 验证(frozen 待裁)接 GUI 审批通道,即「演示给人看→修→再看」。

## 选择建议(实现顺序若全采纳)

P4(纯文档,零风险)→ P1(一行+测试)→ P2(事件驱动,高频痛点)→ P5(judge 端口,补 batch-2 闭环)→ P3(经验回流)→ P6(成本)→ P7(race,评估后再定)。
