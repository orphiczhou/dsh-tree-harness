# dsh-tree-harness 树引擎设计与实现完整盘点审计报告(flaudit)

- 日期:2026-10-04 深夜
- 执行:root 指挥官 + 5 个 flash 级 worker(flaudit-W1~W5,全部 succeeded + verify PASS)
- 方法:只读盘点,证据分层(spec/PLAN/SKILL ⇄ src/ 八文件 ⇄ 既有审计文档),5 份论据文件在 `demo/flaudit/`
- 严重度:严重(信任边界/核心保证被击穿)> 高(承诺缺失或有真实绕过面)> 中(语义偏差/可靠性)> 低(一致性/观测)

---

## 一、盘点范围

| 层 | 素材 |
|---|---|
| 规约 | docs/architecture/engine-spec.md(S0 冻结版)、PLAN.md(§5 验证策略层/§7 Config) |
| 交接文档 | docs/archive/handoff-2026-10-04.md(§6 已知边界 B1–B16)、docs/architecture/segment-handoff.md、docs/archive/proposals-from-agent-notes.md |
| 既有审计 | docs/archive/e2e3l-audit-2026-10-04.md(异常#1–#5,artifact 错位等——本报告去重不重复) |
| 实现 | packages/dsh-tree-engine/src/{engine,state,queue,guards,verify,store,config,clock}.js + 包根 index.js(注:src/index.js 不存在,入口装配在包根) |
| 协议 | skills/tree-commander/SKILL.md、skills/tree-worker/SKILL.md |

---

## 二、逐维度论证

### 维度① 设计承诺 vs 实现一致性

**1.【P0/严重｜store.js:37-69 + engine.js:33-42】规约承诺的 `.lock` 文件锁与"临界区纯同步"铁律完全未实现。**
spec §2/§6 写明"`.lock`(文件锁)…临界区 readState→改→writeState 纯同步不得 yield";实现只有 tmp+rename(防写撕裂,不防丢更新),withTree 临界区内全是 await 让出点,queue.js 仅单进程互斥。跨进程(双宿主/热更双实例,index.js:194 自证热更场景存在)并发读-改-写为裸 last-writer-wins,无 revision/CAS,丢失更新不可检测。→ 建议:实现 .lock(O_EXCL+过期回收)或 write 前 mtime/revision CAS;若裁决"单写者假设成立",spec 须增补豁免条款。

**2.【高｜PLAN §7 ⇄ config.js:8-21】PLAN 承诺的 9 个配置键 0 个按名落地,且未知键硬拒会拦截按 PLAN 书写的合法配置。**
`verificationPolicies/taskTypePolicyMap/judgeModelDefaults/verifyTimeoutMinutes/maxVerifyAttempts/segmentHandoff.*` 全部缺位,语义被拆散改名(graceMinutes:5→graceMs、segmentHandoff.thresholdPct→平铺 bambooThresholdPct);validateConfig 对未知键 throw,导致按 PLAN 写的配置在装载期直接使插件注册失败(index.js:536-541)。`segmentHandoff.enabled` 总开关无实现,`maxVerifyAttempts` 无消费点。→ 两份文档必须收敛为同一份键表,或未知键降级为告警。

**3.【高｜engine-spec §4/§6 ⇄ engine.js 全表】TAO 审计门(audit_gate)、错误码 ≥30 且全部挂 help_topic 两项契约均未达成。**
命令表无任何 audit:* 命令,leaf 无 audit_gate 写入点,"auditor 独立性"规约仅剩三处 caller 校验撑着;错误码实测约 22 个,treeError 仅个别调用点传 helpTopic。→ 补 audit:append 与 code→help_topic 映射表,缺映射的码在测试报错。

**4.【P1｜engine-spec §2 ⇄ store.js:63-68】call-log 10MB 轮转未实现**,appendFile 无大小检查,长跑树无界膨胀。→ 超限 rename 滚动保留 1 份。

**5.【P1｜state.js:18-25 ⇄ spec §3】"终态"定义冲突**:spec 称 done/pruned/archived 为终态,实现允许 done→pruned/archived、pruned→archived 出边;spec 迁移表还留有省略号,闭集未冻结。差分测试会在此分叉。→ 以源引擎实跑裁决后修订一侧并登记 diff.DEVIATIONS。

**6.【P2｜state.js:27-29、engine.js:229+index.js:375、engine-spec §1/§6】三处契约漂移**:事件 11 类被扩为 12(多 child_done),drift 扩出 security/red 死枚举且与 audit severity 三套词汇并存;set-context 的 pct 引擎要求 integer、工具面声明 number,执行者自报小数将 E_SCHEMA_INVALID;tree_help 元工具消失、per-call treesRoot 入口契约被改为构造期固定,与"差分以源引擎实跑为金标准"的调用形状不再同构。→ 冻结版修订时逐项裁决入规约或删除。

### 维度② 状态机与并发正确性

**7.【严重｜engine.js:316-321 ⇄ state.js:18-25】nudgeAppend 强制 prune 直接赋值 status,不经 assertTransition。**
对已 done/archived 叶子累计 7 次 nudge 即静默打成 pruned(archived 语义上不可逆),下游依赖失配永久卡死,仅一条 drift 痕迹。→ 强制路径也走 assertTransition;archived 拒绝 nudge。

**8.【严重｜engine.js:393 + 275-278 + 497-502】done 事件回流使依赖闸可绕过 done 三重闸(编排主路径的旁门)。**
依赖闸 `depDone` 接受 `runtime.state==='succeeded'`;而 eventAppend 的 done 事件只校验 `caller===leaf.session_id`,不查 milestone 闸、不置 status=done——执行者自报一条 done 事件即可翻 succeeded 放行下游。三重闸(done 事件+milestones 全 audit_pass)只守 `leaf:set-status done` 正门。sweep reflux(497-502)进一步把任何带 done 事件的 running 叶子兜底翻 succeeded,扩大缺口。→ 依赖闸只认 status==='done',或让回流同样过 milestone 闸并收敛双轨为单一事实源。

**9.【高｜engine.js:386-389 + 302】dispatchStart 不检查 leaf.status**:pruned/archived/done 叶子只要 runtime 非 running 即可再派发;随后 segmentAppend 无迁移检查覆写 status='segment_pending',done→segment_pending 非法边可达,frozen(待裁决)可被单方面解除。→ 增加 status 白名单;segmentAppend 经 assertTransition。

**10.【高｜engine.js:178-189】级联 prune 不处理 runtime**:运行中子节点被级联置 pruned 但 runtime 仍 running,既不 ports.interrupt 也不豁免 sweep 扫描——孤儿会话继续耗名额至 30min 超时;其后 done 事件仍可回流翻 succeeded,产生 status=pruned+runtime=succeeded 矛盾节点。→ cascade 内 interrupt+置 cancelled,并过 assertTransition。

**11.【中｜engine.js:489-529】sweepTick 在 per-tree 临界区内 await 外部端口**(lastOutputAt/usagePct/promptHandoff 整条接力链,promptHandoff 无硬超时):锁持有时间不可控,同树全部命令(含执行者自报 done)排队,执行者收不到结算反而更易被下一轮 sweep 误判——自我加剧的活锁。→ 端口调用加超时,或拆"锁内登记→锁外 IO→锁内 commit"三段。

**12.【中｜engine.js:400-414 + 461-464】attempt 计数两处失真**:(a) ports.dispatch 宿主侧已启动但回包抛错时 attempt 不增,幽灵会话不受 spawn 事件闸计数;(b) 竹节接力不计 attempt 且 segmentChain 不清零,叠加 #9 的 frozen 可绕过,形成"frozen→重派→接力5次→frozen"无总上限的循环泵。→ dispatch 两段式落账;增加含接力的每叶总派发预算。

**13.【低｜engine.js:266-269】事件 ts 单调仅"≥上一条",且允许调用方经 tsIso 注入任意字符串**:一条未来时间戳可把锚点推到 2100 年,永久 DoS 该叶事件通道;eventList 全局排序可被时序欺骗,误导"done 早于 verification"类审计判读。→ 限 tsIso 内部时钟路径或归一 Date.parse 比较。

### 维度③ 验证层完备性

**14.【高｜verify.js:90 + 27-33/76-78】self-report 永真 + taskType 三级回落兜底构成缺省绕过面**:拼错/未知的 taskType 一律回落 self-report,"owner 自报 done + self-report pass"全链路无独立证据。→ 回落时打 fallback 标记并 drift 留痕,default 回落至少追加最小 artifact 检查。

**15.【高｜engine.js:213-224】验证裁决落账接口 setVerification 完全无 caller 鉴权**(对照 setStatus 三方校验、done 事件所有权闸):任意会话可对任意 leaf 直接写 `{pass:true}`,且 verdicts 与 pass 无一致性校验——verify.js 全部防绕过设计在落账层被一键击穿。与既有审计 A4(验证事后补写)同域但更深层:A4 是时序瑕疵,本条是信任边界洞。→ caller 授权与 setStatus 同款 + verdicts/pass 一致性校验。

**16.【高｜verify.js:95-108】artifact 验证只查 glob 字典序第一个文件**:已知审计 B5 记录的是"node_modules 抢先导致错位"这一实例,本审计定位到根因——`files.sort()[0]` 算法本身,宽 glob 下既可投放无关文件绕过、也会漏检真实交付物。→ 逐文件全检或按最近修改取候选,宽 glob 装载期告警。

**17.【中｜verify.js:127-137 + 115-119】两个误判面**:llm-judge 的 minScore 只透传不校验(judge 返回 pass:true 即过,"min 0.8"文案具误导性);command 超时判定靠 `/timeout/i` 消息正则,且 run 字符串无白名单。→ 引擎侧与校验 score;端口返回结构化 timedOut。

**18.【中｜verify.js:157-172 ⇄ PLAN §5.3/§5.4】onFail('retry:1→frozen')只是透传字符串,无解析/执行器,无 retry 计数、无 frozen 落账、无 decide 出口;llm-judge 端口未装配且无异家族校验。叠加 #8:tree_verify 裁决根本不进 dispatchStart 依赖闸——"pass required before succeeded"承诺在编排主路径不成立(PLAN R2 风险成真)。→ 实现 onFail 解析器;依赖闸加 verification.pass 判据。

### 维度④ 资源与预算护栏漏洞

**19.【高｜engine.js:146-150 + 393】leafAdd 无字段白名单,建点时预注入 `runtime:{state:'succeeded'}` 即可绕依赖闸,预置 `verification:{pass:true}`+milestones 即满足三重闸**——无需 borrowed identity,从未运行的节点即可放行下游(W5 独立发现 N1,全树最重信任边界洞之一)。→ 建点白名单,内部字段由引擎初始化。

**20.【高｜engine.js:444-477 ⇄ 296-299】bambooRelay 跳过 findSessionConflict/sessionBudget,且接力会话只入 runtime.segmentChain 不写 leaf.segment_chain**:max_sessions 护栏对竹节接力完全失明,可被长链静默击穿;validate/审计读到的是分裂的两套账,违背"tree-state.json 唯一真源"基线。→ relay 前补双校验,账目收敛单一真源。

**21.【中｜guards.js:19-25 + config.js + engine.js:234-235】护栏 20/15/50 只是缺省不是不变量**:CONFIG_SCHEMA 可合法放宽到 500/100/1000 且无提升留痕;audit_meta 覆写 ctx_segment_threshold 不经 validateConfig,写坏(字符串/>100)使 `pct>=threshold` 恒 false,竹节段接静默失效。→ audit_meta 覆盖键走同款校验,护栏上调强制 drift 记录。

**22.【中｜guards.js:48-58 + engine.js:261-263】subagent_spawn 事件写入无 caller 归属校验**:任意会话可向他人 leaf 注入 spawn 事件,15 次即 DoS 冻结其 spawn 能力——预算反成攻击向量;预算读改写依赖单进程队列,跨进程 TOCTOU 使其为软约束。→ spawn 事件限定 owner;并发语义文档化。

### 维度⑤ SKILL 与引擎行为漂移

**23.【高｜engine.js:31 vs 234 ⇄ worker SKILL:30】竹节阈值 42 存在死回退**:cfg 写 snake_case `ctx_segment_threshold`,回退读 camelCase `cfg.ctxSegmentThreshold`(恒 undefined);audit_meta 缺失的树上 pct≥42 置位静默失效,SKILL 承诺的触发线落空(sweep 侧 engine.js:366 用的是正确键,两条路径不一致)。→ 234 行改 `cfg.ctx_segment_threshold ?? 42` + 单测覆盖。

**24.【中｜worker SKILL:41 ⇄ engine.js:444-452】"简报会被后继全文接收"是过度承诺**:promptHandoff 超时/空时走 no-handoff-summary 照常接力,简报不保证必达;执行者若把关键状态只写进简报即丢失。→ SKILL 补"关键产物必须落盘",引擎在降级时 drift high 留痕。

**25.【中｜worker SKILL:49 ⇄ engine.js:266-268】"ts 单调倒挂被拒"弱于宣称**:等值放行(非严格单调),且对注入 ts 做字符串字典序比较(与 #13 同根)。→ 措辞修正 + 归一比较。

**26.【低｜commander SKILL:38 ⇄ engine.js:400-405、verify.js:81-85】"引擎自动附验收标准与结算指令"实为宿主装配层职责**,引擎核心只透传 dod;装配漏拼则收割链断裂。→ SKILL 注明职责边界。

**27.【中｜engine.js:235 + 147 ⇄ segment-handoff §2】setContext 竹节自触发要求 status==='active',而 worker 建点即 pending_brief 且因 B6(status 不随 runtime 收敛)终身停留该态——执行者自报触发竹节对实际跑长任务的 worker 恒失效**,只剩 sweep 宿主测量兜底;degraded 场景(usagePct 未接)则完全无竹节。→ 触发条件改按 runtime 判活。

### 维度⑥ 可运维性

**28.【高｜store.js:42-50 + engine.js:684】fsStore 无损坏恢复路径,且备份内嵌同一 state 文件随之陪葬**:JSON 半截时 read 抛 SyntaxError,该树所有操作死锁无降级;10 份备份在同一个损坏文件里,restore 救不了——当前实现只有备份语义、没有灾备能力。→ read 失败尝试 .tmp/.bak 副本;备份落独立文件。

**29.【中｜engine.js:683-688 + store.js:51-56】备份内嵌导致写放大**:每次 backup 后 state≈11×工作集,此后每次写(任意事件/nudge/上报)都全量序列化全部历史快照。→ 旁路文件或增量/哈希链。

**30.【中｜engine.js:599 对照其余】无 GC**:heartbeat 有 500 上限,而 leaf.events、drift_log、communication_log、call-log 全部无界(叠加 #29 加速膨胀);tree_maintain gc 动作未实现(已知 B4,本条把范围精确到逐数据结构)。→ 提供 archived 截断命令,call-log 按大小滚动。

**31.【中｜clock.js:16 + engine.js:510-512】墙钟 Date.now 非单调**:NTP 回拨使 `now-baseline` 为负,30min 硬截止永不触发(节点挂死不超时);lastOutputAt 端口失败被静默吞错。另 verify.js:88 绕过注入时钟硬用 Date.now,虚拟时钟下回放失真(低)。→ 超时基准改单调钟;失败写 drift 留痕。

**32.【低｜engine.js:461-465 ⇄ 400-405】bambooRelay 丢原 assignee**:接力只从 leaf.model 重建 {model},provider/reasoningEffort 丢弃——同一节点中途换模型续跑,破坏竹节"同任务无缝续做"初衷,flaudit 树自身即强制全 flash 的场景下该风险有直接现实意义。→ rt 快照 assignee 原样透传。

**33.【低｜engine.js:522 vs 235】sweep 竹节分支不查 leaf.status==='active'**,与 setContext 触发条件不对称,非 active 叶可重复接力耗尽 segment_chain 提前 frozen。→ 补守卫对齐。

---

## 三、与已知边界清单的对照(新发现 vs 已知)

### 3.1 已知清单覆盖、本审计深化或改判的

| 已知项 | 本审计的深化/改判 |
|---|---|
| B5/A2 artifact 验证错位(现象) | #16 定位根因:`files.sort()[0]` 算法缺陷,不止 node_modules 抢先,是可绕过+漏检的双重缺陷 |
| B6/A1 status 与 runtime 脱节(现象) | #8/#10/#27 指出它不是观感问题:依赖闸接受 runtime.succeeded 使其成为**闸门绕过通道**;且使 worker 自报竹节恒失效(#27)——严重度应从"中等,待修"上调 |
| B3 备份为状态内快照(已知) | #28/#29 补充后果:损坏全陪葬+写放大 11×,災备能力实质为零 |
| B1 竹节重启失效(已知) | #20 补充:即使不重启,接力会话本身已绕过全部预算/唯一性校验且账目分裂 |
| B8 judge 端口未装配(已知) | #17/#18 补充:minScore 即使装配了也不被校验;onFail 整条失败处置闭环无执行器 |
| B11 竹节阈值 42 vs 源 85(已知差异) | #23 发现独立于该差异的死回退 bug(键名错位),audit_meta 缺失即触发 |
| §6.4 claim "graceMinutes 已闭合"(B9) | W1 改判:**未闭合**——5 分钟宽限被 index.js:41 无条件钳到 12 秒,#8 条(K1–K5 简报默认路径几乎必然降级 no-handoff-summary) |

### 3.2 已知清单完全未覆盖的新发现(核心增量)

最重的一批全部集中在**信任边界**与**编排主路径闸门**:

1. **#8 依赖闸可被自报 done 绕过**(严重)——三重闸只守正门;
2. **#19 leafAdd 字段注入绕依赖闸/伪造验证**(高)——建点即预置内部字段;
3. **#15 setVerification 无鉴权**(高)——done 所有权闸只堵了"事件"一半,"裁决"另一半失守;
4. **#7 nudge 强制 prune 穿透终态**(严重)与 **#9 frozen 可单方面解除**(高);
5. **#20 竹节接力预算失明 + 账目分裂**(高);
6. **#1 规约核心的文件锁/临界区铁律未实现**(P0);
7. **#2 配置键表缺位且未知键硬拒=装载期硬故障**(高);
8. 其余:级联 prune 孤儿(#10)、sweep 锁内慢 IO 活锁(#11)、attempt 循环泵(#12)、self-report 回落面(#14)、护栏可放宽/可注入(#21/#22)、阈值死回退(#23)、损坏不可恢复(#28)、无 GC(#30)、墙钟超时(#31)、assignee 丢失(#32)。

以上 33 条(合并同根后)均经 W5 与 B1–B16、A1–A7 逐一比对,无一与既有文档重复;e2e3l 已发现的 artifact 错位、跨分支 add 竞态(A3)、root 无 runtime(A5)等未重复列入。

### 3.3 对 §6 已知边界清单完整性的论证结论

**§6 清单不完整,且系统性偏"现象层"**:它如实记录了跑 e2e3l 时**观察到**的症状(status 脱节、artifact 错位、竞态重试),但缺三类盲区:(a)**信任边界类**——所有无 caller 校验的写口(setVerification/nudge/spawn 事件/leafAdd 字段/audit_meta)当时未构成故障故不可见,但构成可绕过面;(b)**未触发路径类**——竹节全程未触发(context 全 0),其上的 relay 旁路、锁内 IO、简报钳制全部不可见;(c)**规约对照类**——§6 是运行时边界,不覆盖"spec 承诺 vs 代码"的静默缺口(文件锁、审计门、配置键表)。建议 §6 后续按本报告 3.2 的 8 条优先项扩容,并增加"写口鉴权矩阵"作为例行盘点维度。

---

## 四、总结论

- 引擎的**单进程happy path 质量合格**:状态迁移表白名单、queue 链尾清理、verify 模式 fail-closed、guards 计数函数本身实现正确;e2e3l 记录的症状也基本属实。
- 但**信任模型与编排主路径存在结构性缺口**:done 三重闸不守依赖闸(#8)、验证裁决落账无鉴权(#15)、建点可注入内部字段(#19)、竹节接力绕过预算(#20)——四条叠加意味着"引擎账本"在对抗性或粗心调用者面前不构成可信事实源;规约的核心承诺(文件锁、审计门、配置键表、简报宽限)大面积未落地(#1/#3/#2/§6.4 改判)。
- **修复优先级建议**:P0 批次 #1、#8、#15、#19(信任边界+主闸门)→ 第二批 #9/#20/#23/#28(正确性+竹节+灾备)→ 第三批其余。同时先做一件零成本的事:把 spec/PLAN/SKILL 三份文档收敛到同一份键表与闸门语义(S0 冻结补丁),否则修代码会持续被文档追认错误。

## 附:论据文件索引

- demo/flaudit/w1-spec-vs-impl.md(13 项:P0×1/P1×8/P2×4)
- demo/flaudit/w2-state-concurrency.md(8 项:严重2/高3/中2/低1 + 5 备忘)
- demo/flaudit/w3-verify-guards.md(8 项:高3/中4/低1)
- demo/flaudit/w4-skillops.md(10 项:漂移4/运维6)
- demo/flaudit/w5-boundary-baseline.md(B1–B16 + A1–A7 + N1–N8)
