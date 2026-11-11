# W5 边界基线 — 已知问题/边界清单 + 独立源码审计发现

- 日期:2026-10-04(深夜)
- 执行者:只读审计 worker(flaudit-W5-boundary)
- 输入:docs/archive/handoff-2026-10-04.md §6、docs/archive/e2e3l-audit-2026-10-04.md、docs/architecture/segment-handoff.md、docs/archive/proposals-from-agent-notes.md + 通读 packages/dsh-tree-engine/src/(engine.js 748 行、verify.js、guards.js、state.js、store.js、queue.js、config.js、clock.js 全量)
- 纪律:除本文件外未改动任何文件。

## ① 已知问题/边界精确清单(编号 | 位置 | 一句话)

| # | 位置 | 边界/问题 |
|---|------|-----------|
| B1 | handoff §6.1 | 进程重启/热更后 running 节点竹节接力失效(parents 缓存丢),需 cancel→start 重派;活 Agent 反查方案待升级 |
| B2 | handoff §6.7 | sweep 用裸 setInterval 未托管 disposal(timer 注入缝已有,宿主现状未接) |
| B3 | handoff §6.7 | backup/restore 为状态内快照(非文件级);完整性签名(D-v4)、E_CALLER_REQUIRED(D-v2)、D-v5(源可恢复错误自动 drift)、D-v6(源 leaf add 必填 model)未移植/新登记 |
| B4 | handoff §6.8 | tree_maintain gc 动作未实现,垃圾测试树需手动删目录 |
| B5 | handoff §6.9 / e2e3l 异常#2 | artifact 验证对象错位:verify glob `**/*.md` 字典序取首个匹配(node_modules 文件先于 demo/ 产物),pass=true 与被验证产物无关——中等,待修 |
| B6 | handoff §6.10 / e2e3l 异常#1 | leaf.status 与 runtime 终态脱节:runtime succeeded 后 status 停留 pending_brief/active,误导只读观察者,建议回流时同步 set-status |
| B7 | handoff §6.5 / §7.5 | usagePct 宿主测量"主体接入"但自报仍是二级信号,observeSession 事件面(收割路径②)待宿主形状冻结——唯一剩项 |
| B8 | handoff §6.6 / §7.6 | llm-judge 引擎侧 fail-closed 已闭合,但宿主 judge 端口(评审会话派发)未装配;human 模式 approval=never 恒 frozen 待裁 |
| B9 | handoff §6.2/§6.3/§6.4(已闭合) | dependencies enforcement(v0.3.8)、taskType 验证路由(v0.3.8)、promptHandoff K1–K5 回收+graceMinutes(v0.3.9)——基线中记为已闭合,不在待修面 |
| B10 | handoff §6.11 / proposals P1–P7 | 备选提案未立项:P1 链长 5→3 / P2 deps-ready 自动派发 / P3 retro 经验回流 / P4 assignee 路由进 SKILL / P5 judge 端口 / P6 成本回灌 / P7 双轨 race |
| B11 | segment-handoff §3 | 竹节机制四差距:阈值 42 vs 源 85、触发可靠性(自报软信号)、自动化程度、规约缺位——部分已落(S0 议题并入待 PLAN 冻结) |
| B12 | segment-handoff §7 | 五项宿主侧验证项未全部实测(tokenMeter 形状、模型窗口元数据、压缩触发点、interrupt authority 形状、简报回收通路) |
| B13 | e2e3l 异常#3 | 跨分支依赖的 leaf:add 存在竞态(C2 在 C1b 创建前引用即 E_LEAF_NOT_FOUND),需执行者容忍重试 |
| B14 | e2e3l 异常#4 | done 之后出现尾部写入(set-verification 晚于 done),时序上验证系事后补做,终态不受影响 |
| B15 | e2e3l 异常#5 | root 无 runtime/events/verification(契约内排除,仅观察) |
| B16 | handoff §4.4/§4.7 | ctx.timer 插件上下文访问即抛(inspect 通道 bug 事实#5);pnpm minimumReleaseAgeExclude 校验 bug 拦装载 |

## ② 已知审计已发现问题清单(供去重)

| # | 来源 | 摘要 |
|---|------|------|
| A1 | e2e3l 异常#1 / handoff B6 | leaf.status 陈旧(worker pending_brief、commander active,无 set-status 调用) |
| A2 | e2e3l 异常#2 / handoff B5 | doc artifact 验证指向 `node_modules\@local\dsh-tree-engine\tests\diff.DEVIATIONS.md`,与真实产物错位,pass=true 有水份 |
| A3 | e2e3l 异常#3 | E_SCHEMA_INVALID/E_LEAF_NOT_FOUND 失败试探噪声;跨分支 add 竞态需重试 |
| A4 | e2e3l 异常#4 | verification 事后补写(15:15:00 晚于 done 15:12:26/15:14:32) |
| A5 | e2e3l 异常#5 | root 无 runtime/events/verification |
| A6 | handoff §6.7(差分) | D-v4/D-v2 未移植;D-v5/D-v6 新登记(52 组序列) |
| A7 | proposals P1 旁证 | e2erly chain=2 后继出现"重复完成已 done 综述"的认知偏差信号 |

## ③ 独立新发现(通读 src/ 后,上述文档均未覆盖)

### N1 [高] leaf:add 对传入 leaf 对象未做字段白名单,可预注入 runtime/verification 绕过依赖闸与伪造验证

- **位置**:engine.js:146-150(`state.leaves[leaf_id] = { ...leaf, status: ... }`)
- **证据摘录**:`state.leaves[leaf_id] = { ...leaf, status: leaf.role === 'worker' ? 'pending_brief' : 'active', created_at: ..., events: [], ... }` —— 展开 `...leaf` 原样保留调用方附带的任意键;对照 dispatchStart 的依赖闸 engine.js:393 `const depDone = (d) => state.leaves[d]?.status === 'done' || state.leaves[d]?.runtime?.state === 'succeeded'`。
- **论证**:leafAdd 仅校验 leaf_id/role/parent/dependencies/taskType/session_id,未剔除 `runtime`、`verification`、`milestones` 等引擎内部字段。恶意或错误的 caller 在 add 被依赖节点时携带 `runtime: { state: 'succeeded' }`,依赖闸即视为已成功放行下游 dispatch——节点从未运行。同理可预置 `verification: { pass: true }` 与 `milestones: [{ audit_pass: true }]` 直接满足 done 三重闸。这是信任边界洞,且无需 borrowed identity(是 caller 自己 add 的节点)。
- **建议**:leafAdd 建点时做字段白名单(仅接受 brief/dod/taskType/dependencies/assignee/model 等 spec 字段),内部字段(runtime/verification/events/milestones/segment_chain/drift_history/nudge_count/context_usage_pct)一律由引擎初始化,传入即 E_SCHEMA_INVALID。

### N2 [高] bambooRelay 跳过全部会话唯一性/预算校验,且接力会话只记入 runtime.segmentChain,validate 与 sessionBudget 全盲

- **位置**:engine.js:444-477(bambooRelay,无 findSessionConflict/sessionBudget 调用;:468 `rt.segmentChain.push(session.sessionId)`);guards.js:34-45(sessionBudget 只数 `leaf.session_id` + `leaf.segment_chain` + registry);state.js 对应 validate(engine.js:328-349 同样只看 `leaf.segment_chain ?? []`)
- **证据摘录**:对照 segmentAppend(engine.js:296-299)有完整 `findSessionConflict` + `sessionBudget` 校验,而 bambooRelay 对 `ports.dispatch` 返回的新 sessionId 直接 `rt.segmentChain.push(...)`,并 `rt.subagentSessionId = session.sessionId`——但从不写回 `leaf.segment_chain`,也从不调用 guards。
- **论证**:后果有三:(a) macp2 会话预算对竹节接力会话完全失明,`max_sessions: 50` 护栏可被长竹节链静默击穿;(b) 新 sessionId 若与其他 leaf 的 session_id/registry 冲突,引擎不拦(与 segmentAppend、registerSession 的语义不一致);(c) `leaf:list`/`validate`/审计读 `segment_chain` 看不到任何接力历史,真源出现两套并行账(runtime.segmentChain vs leaf.segment_chain),与"tree-state.json 是唯一真源"的审计基线相悖。
- **建议**:bambooRelay 在 push 前补 findSessionConflict + sessionBudget;接力落账同步 `leaf.segment_chain.push(newSessionId)`(或 validate/sessionBudget 改为读 runtime.segmentChain,二选一,但必须单一真源)。

### N3 [高] leaf:set-verification 无任何 caller 鉴权,任意会话可覆写任意节点的验证裁决

- **位置**:engine.js:213-224(setVerification 签名无 caller 参数;table 注册 `call(cmd, args, caller)` 时该命令直接丢弃 caller);对照 setStatus(engine.js:162-170)有 owner/creator/root 三方授权
- **证据摘录**:`async function setVerification(args) { const [treeId, leafId, result] = args ... leaf.verification = { ts, policy_id, pass, ... } }` —— 对比 eventAppend(engine.js:255-258)对 done 事件明确"移除 added_by 代写权"防 commander 谎报 worker done。
- **论证**:done 事件的所有权闸(V10-trust-anchor-fix)只堵了"谎报完成事件",但结算凭据的另一半——verification.pass——任何 caller 都能写。commander(或任意持有 tree_id 的会话)可在 worker 未完成时写入 `{pass: true, verdicts: [...]}`,让下游依赖闸、收割汇总、审计读取全部采信伪造裁决。验证层的可信度依赖此入口的鉴权,当前为零。
- **建议**:setVerification 增加 caller 授权(leaf.session_id ∨ added_by ∨ root,与 setStatus 同款),或至少限定 owner session + 宿主装配层(引擎内部 verify 流程以内部调用标识写入)。

### N4 [中] setContext 竹节自触发以 `status === 'active'` 为闸,worker(pending_brief)永远无法自报触发竹节

- **位置**:engine.js:235 `if (pct >= threshold && leaf.role !== 'root' && leaf.status === 'active')`
- **证据摘录**:leafAdd engine.js:147 `status: leaf.role === 'worker' ? 'pending_brief' : 'active'`;e2e3l 审计 B 项实录 4 个 worker 全程 `status=pending_brief`。
- **论证**:源引擎语义(segment-handoff §2,tree-engine.cjs:2294-2313)是"非 root 且 active → segment_pending";本仓 worker 建点即 pending_brief 且因 B6(status 不随 runtime 收敛)终身停留该态,故自报路径 set-context 的竹节触发对实际跑长任务的 worker 角色恒假——只有 commander/root 之外的 active 节点(commander)能触发。执行者自报这一级竹节信号对 worker 完全失效,只剩 sweep 宿主测量兜底;若 usagePct 端口未接(degraded 场景),worker 长任务将既不自报也不被接力。
- **建议**:触发条件改为按 runtime 判活(`leaf.runtime?.state === 'running'` ∨ status ∈ {active, pending_brief}),并在测试中补一条"worker set-context ≥ 阈值 → segment_pending"断言。

### N5 [中] sweep 临界区内 await 慢端口(promptHandoff 宽限轮询、dispatch),per-tree 队列被长占,全树命令停摆

- **位置**:engine.js:485-537(sweepTick 在 `enqueue(treeId, ...)` 内逐 leaf await bambooRelay);bambooRelay engine.js:450 `await ports.promptHandoff(...)`(宿主实现按 graceMs 宽限轮询,orchCfg.graceMs 缺省 5 分钟)+ :461 `await ports.dispatch(...)`
- **证据摘录**:`results.push(await enqueue(treeId, async () => { ... const r = await bambooRelay(treeId, leaf, rt, state) ... }))` —— queue.js:16-24 的 per-tree 串行队列保证同一 tree 所有命令按提交序串行,无任何让出。
- **论证**:一次竹节接力期间(简报宽限最长 graceMs=5min + 新会话启动耗时),该树的全部 tree_node/tree_dispatch/tree_status/tree_verify 调用排队阻塞,指挥官与审计会话同时卡死;多节点同时达阈值时阻塞按接力数叠加。临界区的意义是保护状态读写一致性,而慢 I/O(端口调用)被包进了同一把锁——这是"锁内做 I/O"反模式。e2e3l 未暴露是因为竹节从未触发(审计 E 项:context_usage_pct 全 0)。
- **建议**:sweep 内先在锁内快照待接力节点并置中间态,释放队列后于锁外执行 promptHandoff/dispatch,再重新 enqueue 落账;或 bambooRelay 拆为"锁内登记 pending → 锁外 IO → 锁内 commit"三段。

### N6 [中] createEngine 从不调用 validateConfig/validatePolicies 的宿主装配链,且 init 的 audit_meta 展开允许调用方逐树覆写护栏绕过 Config 校验

- **位置**:engine.js:31 `const cfg = { ...DEFAULT_GUARDS, ctx_segment_threshold: 42, segment_max_chain_length: 5, ...opts.config }`(无 validateConfig);:60 `audit_meta: { ...cfg, ...(auditMeta ?? {}) }`
- **证据摘录**:config.js 提供 `validateConfig`(未知键拒绝、范围校验)与 `configFromEnv`,但 engine.js 全文无 import/调用(grep 证实 createEngine 仅存在 config.js 无引用);setContext engine.js:234 `const threshold = state.audit_meta?.ctx_segment_threshold ?? cfg.ctx_segment_threshold` 直接采信落账的 audit_meta。
- **论证**:两条旁路:(a) 引擎构造参数 opts.config 不经校验(写错键名静默无效、类型错静默生效),config.js 的"不静默回退"纪律在主路径上落空;(b) tree_init 的 auditMeta 参数以展开方式覆写 cfg——init 调用方可将 ctx_segment_threshold 设为 1(每 tick 必触发竹节风暴)、max_sessions 设为 10000 等逐树生效,绕过全部护栏校验,而后续 setContext 又把这份被污染的 audit_meta 当权威阈值。
- **建议**:createEngine 对 opts.config 调 validateConfig;init 对 auditMeta 白名单化(仅允许阈值/护栏数值且经同一 schema 校验),拒绝未知键。

### N7 [低] eventAppend 的 ts 单调性用 ISO 字符串字典序比较,跨格式/时区偏移时间戳会误判

- **位置**:engine.js:267 `if (leaf.events.length > 0 && ts < leaf.events[leaf.events.length - 1].ts)`
- **证据摘录**:`"2026-10-04T23:00:00+08:00" < "2026-10-04T16:00:00Z"` 按字典序为 true(实为同一时刻之后),而 `"2026-10-04T15:00:00.000Z"` 与 `"2026-10-04T15:00:00Z"` 精度不同亦可比错。
- **论证**:引擎自身 nowIso 恒产出 UTC 毫秒 Z 格式故现状自洽,但 call() 契约接受外部 tsIso 注入(差分回放场景),格式不受控;一旦混入带偏移或降精度的时间戳,合法事件被 E_TS_NOT_MONOTONIC 拒绝或乱序事件被放行,影响事件时序审计结论(如 e2e3l E 项的"done 早于 verification"判读)。
- **建议**:比较前 `Date.parse()` 归一为毫秒数再比,解析失败退回字典序并告警。

### N8 [低] bambooRelay 丢失原派发 assignee(spec.provider/model/reasoningEffort),后继会话模型路由漂移

- **位置**:engine.js:461-465(bambooRelay 的 ports.dispatch 只传 `assignee: leaf.model ? { model: leaf.model } : undefined`);对照 dispatchStart engine.js:400-405 透传 `spec?.assignee`
- **证据摘录**:首次派发可带完整 `{provider, model, reasoningEffort}`(树节点 add 的 assignee 字段,tree_node 工具 schema 载明);接力时仅从 `leaf.model` 重建 `{model}`——provider/reasoningEffort 丢弃,leaf.model 未设则整个 assignee 为 undefined(宿主默认路由)。
- **论证**:竹节接力后同一节点可能换模型续跑,长任务中途模型能力/上下文窗口突变,竹节设计初衷(同任务无缝续做)被破坏;P4(assignee 路由)落地后该问题会被放大——judge/verify 类节点中途降级模型直接影响裁决质量。文档仅有 P4/P6 谈路由与成本,未指出接力路径本身丢路由。
- **建议**:rt 增存 `assignee`(首次派发时快照),bambooRelay 原样透传;或在 leaf 上持久化完整 assignee 对象而非仅 model。

## 附:独立性声明

以上 N1–N8 均为通读 packages/dsh-tree-engine/src/ 八文件后的独立发现;已与 §①② 全部条目(handoff §6 十一条、e2e3l 异常 #1–#5、差分 D-v2/v4/v5/v6、proposals P1–P7、segment-handoff 差距四点)逐一比对,无一重复。B9 标记的已闭合项不构成待修面。
