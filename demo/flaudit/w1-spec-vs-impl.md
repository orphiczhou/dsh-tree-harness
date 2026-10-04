# W1 规约 vs 实现审计（dsh-tree-engine）

- 审计人：只读审计 worker（flaudit-W1-spec）
- 日期：2026-10-04
- 对照物：`docs/engine-spec.md`（S0 冻结版）+ `PLAN.md`（v1.0，含 §5 验证策略层 / §7 Config 增量）⇄ `packages/dsh-tree-engine/src/{engine,state,queue,guards,verify,store,config,clock}.js` 与包根 `index.js`
- 严重度定义：**P0** 破坏规约核心保证（并发安全/信任锚/数据完整性）；**P1** 规约承诺缺失或语义偏差，影响行为保真；**P2** 文档/命名/可观测性层面偏差。
- 备注：任务指定路径 `src/index.js` 不存在；入口装配文件实际位于包根 `packages/dsh-tree-engine/index.js`（已纳入审计）。

---

## 1.【P0｜store.js:37-69 + engine.js:33-42｜证据 + 论证】

- **证据摘录（spec §2/§6）**："`tree-state.json`（真源）、`.lock`（文件锁）…临界区铁律：所有 cmd 的 readState→改→writeState 临界区**纯同步不得 yield**（withLock fn 均同步箭头函数）；文件锁 `.lock` + tmp 原子 rename"。
- **证据摘录（impl）**：`fsStore` 只实现 tmp+rename（store.js:51-56），**无任何 `.lock` 文件锁**；`withTree`（engine.js:38-41）以 `enqueue(treeId, async () => { const state = await store.read(...); return fn(state) })` 组织临界区，read→mutate→write 之间全是 `await` 让出点。
- **论证**：① 规约承诺的文件锁完全未实现；② "临界区纯同步"铁律被 async/await 打破——同一进程内 per-tree 队列（queue.js）确实串行化了 engine 自身的调用，但**跨进程**（两个 DSH 实例/插件热更双实例，index.js:194 已自证热更场景存在）或绕过 engine 的写入无任何互斥，`tree-state.json` 可被并发覆盖丢失更新。queue.js 只是单进程内互斥，不能替代规约的文件锁语义。
- **建议**：在 fsStore 内实现 `.lock`（O_EXCL 创建 + 过期回收）或 at minimum 在 write 前做 mtime/内容 CAS；文档若裁决"单写者假设成立"，须在 engine-spec 增补豁免条款并写明失效场景。

## 2.【P1｜engine-spec §2 + store.js:63-68｜call-log 10MB 轮转未实现】

- **证据摘录（spec）**："`call-log.jsonl`（append-only 观测层，10MB 轮转，绝不进 tree-state）"。
- **证据摘录（impl）**：`appendCallLog` 仅 `fsp.appendFile(...)`，无大小检查、无轮转；memoryStore 更是无限增长数组。
- **论证**：规约明确承诺 10MB 轮转；实现为无限 append，长跑树下 call-log.jsonl 无界膨胀，违背持久化布局契约（差分测试锚点 §9 的文件布局项也会不一致）。
- **建议**：append 前 stat 文件大小，超 10MB 时 rename 为 `call-log.jsonl.1`（保留 1 份）后重建；并在测试补轮转断言。

## 3.【P1｜state.js:18-25｜状态机迁移表与规约"终态"定义冲突】

- **证据摘录（spec §3）**："done/pruned/archived = 终态"；迁移表未列出 done→archived、pruned→archived。
- **证据摘录（impl）**：`done: ['pruned', 'archived', 'done']`、`pruned: ['archived', 'pruned']`、`archived: ['archived']`。
- **论证**：规约宣称三者为终态，实现却允许 done→pruned/archived、pruned→archived 的出边。这不是纯收紧而是双向偏差：要么规约的"终态"表述错（源引擎可能允许归档出边），要么实现放宽了闭集。差分测试（§9 迁移闭集断言）会在此处分叉。同类偏差：spec 迁移表写 `pending_brief → [active, pending_brief, ...]`（省略号），实现补全为含 done/pruned/archived——省略号的解释权未冻结。
- **建议**：以源引擎实跑裁决终态语义后，修正 spec 迁移表为无省略号闭集，或删去实现中的出边；二选一并在 diff.DEVIATIONS.md 登记。

## 4.【P1｜engine.js:248-282 + state.js:27｜ts 单调校验缺两条规约约束】

- **证据摘录（spec §4）**："ts 单调（≥created_at、≤now+60s、≥上一条）"。
- **证据摘录（impl）**：`if (leaf.events.length > 0 && ts < leaf.events[leaf.events.length - 1].ts) treeError('E_TS_NOT_MONOTONIC', ...)` —— 仅校验"≥上一条"。
- **论证**：缺"≥created_at"（允许事件早于节点创建）与"≤now+60s"（允许未来时间戳任意漂移，直接破坏心跳冻结误判保护所依赖的时间基准）。三条护栏只落地一条。
- **建议**：补 `ts >= leaf.created_at` 与 `Date.parse(ts) <= clock.now() + 60_000` 两条断言（新错误码如 E_TS_OUT_OF_WINDOW），挂 help_topic。

## 5.【P1｜engine-spec §4/§6 + engine.js 全表｜TAO 审计门、audit_gate、E_* ≥30 与 help_topic 映射未实现】

- **证据摘录（spec）**："TAO 审计门：audit_gate verdict ∈ required/pass/pass_with_minor/fail/skip；pass 需先有 done event；auditor 必须独立（caller===audit_session_id …→ E_BORROWED_IDENTITY）；audit_append report 数值一致性"；"错误码体系：E_*（≥30 个）全部挂 help_topic 映射"。
- **证据摘录（impl）**：engine.js 命令表（L709-721）无任何 `audit:*` 命令；leaf 字段无 `audit_gate` 写入点；错误码实际约 22 个（E_SCHEMA_INVALID、E_NAME_INVALID、E_LEAF_NOT_FOUND、E_TREE_NOT_FOUND、E_DUPLICATE_LEAF、E_INVALID_UUID_STRICT、E_DEPTH_EXCEEDED、E_DEPENDENCY_CYCLE、E_DEPENDENCY_NOT_MET、E_MAX_SESSIONS、E_NODE_BUDGET_EXCEEDED、E_SUBAGENT_BUDGET_EXCEEDED、E_BORROWED_IDENTITY、E_TS_NOT_MONOTONIC、E_SEGMENT_CHAIN_LIMIT、E_STATUS_TRANSITION_INVALID、E_PORTS_NOT_WIRED、E_PORTS_PROTOCOL、E_BACKUP_NOT_FOUND、E_BACKUP_CORRUPT、E_UNKNOWN、E_INTERNAL），且 `treeError` 仅在个别调用点（engine.js:90、106、50）传 helpTopic，绝大多数错误无 help_topic。
- **论证**：① 审计门是 worker 生命周期（spec §4）的结算闸，整体缺失意味着"auditor 独立性/借身份"规约仅剩 leafAdd/setStatus/setSession 三处 caller 校验撑着；② 错误码数量与 help_topic 覆盖率双双低于规约承诺，违反 §6 错误码体系契约。
- **建议**：S1 下一批实现 `audit:append`（verdict 闭集 + 独立性校验 + 数值一致性校验）；建 code→help_topic 映射表常量，`call()` 出错时统一查表补全 helpTopic，缺映射的码在测试中报错。

## 6.【P1｜engine.js:312-325 + guards.js:65-72｜register_session / nudge 的幂等与 caller 语义偏差】

- **证据摘录（spec §5）**："max_sessions …register_session 幂等去重不多计"。
- **证据摘录（impl）**：`registerSession`（engine.js:667-668）对已存在会话 `if (conflict) treeError('E_SCHEMA_INVALID', conflict)` —— 以错误拒绝而非幂等成功；`nudgeAppend`（engine.js:312）无 caller 校验，任何会话可对任意节点累计 nudge 直至 7-strike 强制 pruned。
- **论证**：① "幂等去重"的自然语义是重复登记返回成功且计数不变；实现返回 `{ok:false}`，调用方（工具面 tree_maintain register-session 描述还写着 "idempotent"）会误判失败。② nudge 无 caller 透传校验，构成信任锚漏洞：被 nudge 的执行者可反向 nudge 指挥者（或任意节点）触发级联 pruned——违背 §5 "caller 透传全链"承诺。
- **建议**：registerSession 对已存在且归属一致的情况返回 `{ok:true, already_registered:true}`；nudgeAppend 增加 caller 校验（parent/owner/root 白名单），错误码 E_BORROWED_IDENTITY。

## 7.【P1｜PLAN §7 ⇄ config.js:8-21｜Config 键表大面积缺位，且未知键拒绝策略会拦截规约键】

- **证据摘录（PLAN §7）**：承诺键 `verificationPolicies`、`taskTypePolicyMap`、`judgeModelDefaults`、`verifyTimeoutMinutes`、`maxVerifyAttempts`、`segmentHandoff.{enabled,thresholdPct,maxChainLength,graceMinutes}`。
- **证据摘录（impl）**：CONFIG_SCHEMA 仅含 `node_budget/max_sessions/max_subagent_spawn_per_leaf/commander_max_depth/ctx_segment_threshold/segment_max_chain_length` + 编排面 `nodeTimeoutMs/sweepIntervalMs/graceMs/bambooThresholdPct`；且 validateConfig L34 对未知键 `throw new Error('...unknown config key...')`。
- **论证**：① 规约 9 个配置键只有 0 个按同名落地（语义被拆散为 graceMs/bambooThresholdPct 等，命名/单位/嵌套结构全不同：`graceMinutes:5` 分钟 → `graceMs` 毫秒；`segmentHandoff.thresholdPct` 嵌套 → 平铺 `bambooThresholdPct`）；② "未知键拒绝"策略使**按 PLAN §7 书写的合法配置直接导致插件装载失败**（index.js:536-541 非 return 即整插件不注册），比缺功能更糟——是装载期硬故障。③ `segmentHandoff.enabled` 总开关无任何实现（config.js 无该键、engine.js 无短路点）。④ `maxVerifyAttempts:2`（验证重试上限）在 verify.js/engine.js 均无消费点。
- **建议**：要么 CONFIG_SCHEMA 补齐 PLAN §7 全部键（含别名映射），要么把未知键策略降级为告警；两份文档必须收敛到同一份键表（S0 冻结输出）。

## 8.【P1｜PLAN §5.5/§7 ⇄ index.js:41｜竹节简报宽限期 5 分钟被钳到 12 秒】

- **证据摘录（PLAN）**："`segmentHandoff.graceMinutes` | number | 5 | 交接简报宽限期"。
- **证据摘录（impl）**：`const graceMs = Math.min(opts.graceMs ?? 12_000, 12_000)`，硬上限 12 秒；且 makePorts 收到的 `opts.graceMs = envConfig.orchestra.graceMs`（index.js:545）即使配了 300_000 也会被钳断。
- **论证**：规约承诺 5 分钟宽限，实现无条件压到 12 秒（注释理由是 sweep 串行阻塞），导致 K1–K5 简报几乎必然超时降级 `no-handoff-summary`——竹节接力的核心信息传递机制在默认路径上失效，且配置无法恢复规约语义。这是**默认值/上限语义偏差**的典型。
- **建议**：宽限轮询移出 sweep 临界区（异步任务或独立队列），钳制值改为配置项 `graceMsMax` 并缺省 ≥ 规约值；至少在 diff.DEVIATIONS.md 显式登记该降级及理由。

## 9.【P1｜verify.js:157-172 + PLAN §5.3/§5.4｜onFail（retry:1→frozen）与验证重试无执行器；llm-judge 异家族强制未实现】

- **证据摘录（PLAN）**："`onFail`: 'retry:1 → frozen'"；"fail 按策略 retry（attempt+1 …）或 frozen 等待裁决（decide 出口）"；"缺省**评审者与执行者异家族**（异构验证）"；`judgeModelDefaults {family:"!executor"}`。
- **证据摘录（impl）**：`runVerifications` 仅 `return { ..., onFail: p.onFail ?? 'frozen' }` —— onFail 字符串原样透传，无任何解析/执行（无 retry 计数、无 frozen 落账、无 `decide` 命令，engine.js 命令表无此入口）；llm-judge 的 `ports.judge` 在 index.js:549 装配时根本未注入（fail-closed 恒 false），更无异家族校验逻辑。
- **论证**：规约承诺的失败处置闭环（retry/frozen/decide）与异构验证约束在实现中是"返回字符串"而已；`tree_verify` 描述宣称 "pass required before succeeded"，但 dispatchStart 依赖闸（engine.js:393）只查 `status==='done' || runtime.state==='succeeded'`，**不查 leaf.verification.pass**——验证裁决可被完全绕过（PLAN R2 风险成真）。
- **建议**：实现 onFail 解析器（`retry:N` → attempt+1 重派，超限 → runtime.frozen）；依赖闸增加 `leaf.verification?.pass === true` 判据（self-report 策略视为恒过）；llm-judge 端口装配时校验 judge 模型家族 ≠ 执行者家族。

## 10.【P2｜state.js:27-29｜事件 11 类被扩为 12 类；drift 枚举扩出 security/red】

- **证据摘录（spec §4）**："事件 11 类：done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check/review_round/subagent_spawn/progress"；"kind ∈ production/direction/rhythm × severity low/mid/high"。
- **证据摘录（impl）**：`EVENT_TYPE_ENUM` 多出 `'child_done'`；`DRIFT_KIND_ENUM` 多出 `'security'`；`DRIFT_SEVERITY_ENUM` 多出 `'red'`。
- **论证**：代码做了规约没写——扩枚举本身可能是合理增量（child_done 供父节点感知子完成），但规约是 S0 冻结闭集，差分测试的事件类型枚举断言会失败；且 `security`/`red` 无任何写入点，属于死枚举。规约侧 §5.2 审计门却引用 severity ∈ red|yellow|green（另一套），三套 severity 词汇并存。
- **建议**：冻结版修订时把 child_done/security/red 正式入规约并写明用途，或从实现删除；统一 drift severity 与 audit report severity 两套词汇。

## 11.【P2｜engine.js:679-707｜backup/restore 为"状态内嵌快照"，非规约的 backups/ 目录文件】

- **证据摘录（spec §2/§5）**："`backups/`（保留最近 10 份）"；"doBackup 保留最近 10 份；restore 前自动 before-restore 备份"。
- **证据摘录（impl）**：`backup()` 把 `structuredClone(state)`（清空 backups 后）push 进 `state.backups` 数组，随 tree-state.json 落盘；restore 后 `restored.backups = newBackups.slice(0, 10)`。
- **论证**：① 快照与真源同文件，tree-state.json 损坏即备份同灭——违背备份的故障域隔离目的；② 每次快照是全量深拷贝，状态随备份轮转呈 O(10×) 体积放大，且每次 write 都要序列化全部历史快照；③ 代码注释自己承认"文件级备份随 storageDomain 适配升级"，但规约未同步降级声明。其余语义（10 份轮转、before-restore、tree_id 校验）已对齐。
- **建议**：迁移到 `backups/` 目录独立文件（fsStore 已有目录布局基础）；过渡期在 engine-spec §2 增补"v0.3 状态内嵌快照"边界说明。

## 12.【P2｜engine.js:229 + index.js:375｜set-context 的 pct 类型契约不一致（integer vs number）】

- **证据摘录（impl）**：engine.js `if (!Number.isInteger(pct) || ...) treeError('E_SCHEMA_INVALID', 'pct must be an integer 0-100')`；index.js TREE_REPORT 参数声明 `pct: { type: 'number' }`。
- **论证**：工具面放行任意 number（如 42.7，宿主 tokenMeter 防御提取路径 index.js:178 还会 `Math.round`，但执行者自报路径不会预加工），引擎层直接拒——执行者自报小数水位将收到 E_SCHEMA_INVALID，而 sweep 宿主测量路径却接受取整值。同一信号两套类型契约。规约未定义 pct 类型，属实现自造约束且工具面与引擎不一致。
- **建议**：引擎放宽为 `Number.isFinite && 0<=pct<=100`（内部 Math.round），或工具面声明 integer 并在执行者 DoD 中写明整数自报。

## 13.【P2｜engine-spec §1/§6 ⇄ index.js:269-508｜工具面 33→8 收敛未声明 tree_help 元工具去留；spec §6 的 per-call treesRoot 参数被移除】

- **证据摘录（spec）**："当前权威计数 = 33 工具（32 包装 + 1 元工具）…本仓整合基准为 33，'29→≤8'表述按此修正为 33→≤8"；"入口 `run(cmd, args, treesRoot?)`…per-call treesRoot try/finally 防跨请求污染"。
- **证据摘录（impl）**：注册 8 工具无 tree_help 元工具；`call(cmd, args, caller, tsIso)` 签名无 treesRoot，store 在 apply 期绑定固定 dataDir（index.js:188、544）。
- **论证**：① ≤8 达成但元工具（self-describing help）消失，规约字面（33→≤8 含元工具计数语境）未交代；② per-call treesRoot 是规约明文的入口契约（测试/多根隔离依赖），实现改为构造期固定，测试只能靠 memoryStore 绕行——与"差分测试以源引擎实跑为金标准"的调用形状不再同构。
- **建议**：engine-spec 增补 S1 裁决段：tree_help 由 DSH 工具描述替代（或补实现）；treesRoot 语义改为 `createEngine({store})` 装配参数并在 §6 修订入口签名。

---

## 结论自述

逐条对照完成，共登记 13 项问题：**P0×1**（文件锁与临界区铁律未实现）、**P1×8**（call-log 轮转缺失、终态迁移偏差、ts 窗口校验缺两条、审计门/错误码体系缺位、register_session 幂等与 nudge caller 偏差、Config 键表缺位且未知键硬拒、竹节宽限 5min→12s、onFail/验证绕过与异家族缺失）、**P2×4**（枚举扩张、备份内嵌、pct 类型不一致、工具面/treesRoot 契约漂移）。最需优先处置：#1（并发安全）、#9（验证可被绕过，R2 风险成真）、#7/#8（配置与宽限语义直接违背 PLAN §7 承诺）。除本文件外未改动任何文件。
