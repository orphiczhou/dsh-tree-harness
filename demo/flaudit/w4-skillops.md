# W4 审计报告：SKILL 协议漂移 + 可运维性（flaudit-W4-skillops）

审计对象：`skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md` vs `packages/dsh-tree-engine/src/engine.js`、`verify.js`；运维审计 `store.js`、`clock.js`。时间：2026-10-04。

---

## 一、协议漂移（SKILL vs engine/verify 实际行为）

### D1【高】pct≥42 竹节阈值承诺存在死回退，可能永不触发
- 位置：engine.js:31 与 engine.js:234（对照 skills/tree-worker/SKILL.md:30）
- 证据摘录：
  - engine.js:31 `const cfg = { ...DEFAULT_GUARDS, ctx_segment_threshold: 42, segment_max_chain_length: 5, ...opts.config }`
  - engine.js:234 `const threshold = state.audit_meta?.ctx_segment_threshold ?? cfg.ctxSegmentThreshold`
  - SKILL.md:30 "**pct ≥ 42**：引擎将把你置为 segment_pending 并启动接力"
- 论证：cfg 里写入的键名是 snake_case `ctx_segment_threshold`，而 234 行的回退读的是 camelCase `cfg.ctxSegmentThreshold`——该键永远 undefined。正常路径靠 `state.audit_meta`（init 时从 cfg 展开）兜住；但任何 audit_meta 缺失/旧的树状态（schema 迁移、手工构造、init 前写坏）下 threshold=undefined，`pct >= undefined` 恒为 false，setContext 的竹节置位静默失效，SKILL 承诺的 42 触发线落空（sweep 侧 engine.js:366 用的是正确的 snake_case 键，两条路径不一致）。同类对照：guards.js:24 `ctx_segment_threshold: 85`（源缺省）说明该值本就依赖引擎构造期覆盖，键名拼写错误使覆盖链脆弱。
- 建议：234 行改为 `cfg.ctx_segment_threshold ?? 42`；补一条单测覆盖 audit_meta 缺失场景。

### D2【中】"简报会被后继全文接收"是过度承诺——引擎允许无简报静默接力
- 位置：skills/tree-worker/SKILL.md:41 vs engine.js:444-452
- 证据摘录：
  - SKILL.md:41 "简报 ≤2K tokens:后继凭它 + 原任务书继续,写好简报 = 你的工作不白做"（66 行图流亦称"简报会被后继全文接收"）
  - engine.js:451 `if (brief == null) { brief = null; briefState = 'no-handoff-summary' }` 后照常 dispatch（461 行 prompt = `rt.taskPrompt ?? leaf.brief`，简报仅作附加）
- 论证：engine 的 bambooRelay 在 promptHandoff 超时/异常/返回空时走 `no-handoff-summary` 分支，接力照常进行，K1–K5 简报并不保证到达后继。SKILL 把简报表述为接力必达物，执行者可能把关键状态只写进简报而不落盘，一旦走 fallback 分支即丢失（注释"简报宽限…照常接手"是引擎有意设计，但 SKILL 未同步这一风险）。
- 建议：SKILL 补充"简报可能丢失，关键产物/结论必须落盘为文件或在 progress 事件中留证，简报只是加速器"；或引擎在 no-handoff-summary 时向 drift_log 写 high 级留痕供指挥官补偿。

### D3【中】事件 ts"单调"语义与实现不符：等值放行 + 字典序比较
- 位置：skills/tree-worker/SKILL.md:49 vs engine.js:266-268
- 证据摘录：
  - SKILL.md:49 "事件 ts 单调 | 倒挂时间戳被拒"
  - engine.js:267 `if (leaf.events.length > 0 && ts < leaf.events[leaf.events.length - 1].ts)`（ts 为 caller 可经 `tsIso` 注入的字符串，比较是字符串字典序）
- 论证：①引擎只拒绝严格更早（`<`），相等时间戳放行，非严格单调；②比较对象是任意字符串：若 caller 提供非 UTC 规范形（如 `2026-10-04T23:59:46+08:00` 与 `2026-10-04T15:59:46Z` 混用），字典序与真实时序脱钩，"倒挂被拒"护栏失效甚至误拒合法时间戳。默认路径 nowIso 产出统一格式没问题，但工具面宣称的保证强于实现。
- 建议：SKILL 改述为"严格更早的等格式 UTC 时间戳被拒"；引擎侧可 `Date.parse` 归一后比较并对无法解析的 ts 报 E_SCHEMA_INVALID。

### D4【低】"引擎自动附验收标准与结算指令"并非引擎核心职责，依赖宿主装配
- 位置：skills/tree-commander/SKILL.md:38 vs engine.js:400-405、verify.js:81-85
- 证据摘录：
  - SKILL.md:38 "派发 prompt = 子任务书…(引擎自动附验收标准与结算指令,worker 会自报 done)"
  - engine.js:400-401 `ports.dispatch({ ..., prompt: spec?.prompt ?? leaf.brief, dod: spec?.dod ?? leaf.dod, ... })` —— 只透传 dod；结算指令文本在 verify.js:81-85 `dodPrompt()`（且只生成 DoD 列表，不含结算指令），是否拼进 prompt 由宿主 ports.dispatch 决定
- 论证：引擎核心从不生成或追加"验收标准+结算指令"文本，dod 只作为字段传给端口；若宿主装配层漏拼 dodPrompt/结算模板，SKILL 对 commander 承诺的"自动附"不成立，worker 收不到 DoD 与 done 结算指令，收割链（自报 done→succeeded 回流，engine.js:275）断裂。
- 建议：SKILL 注明"由宿主装配层（ports.dispatch）保证"；或在 dispatchStart 内当 prompt 为 brief 时主动拼 dodPrompt 输出，减少装配漂移面。

---

## 二、可运维性（store.js / clock.js）

### O1【高】fsStore 无损坏恢复路径：state 损坏 = 树不可用，且备份嵌在同一 state 内随之陪葬
- 位置：store.js:42-50（read）、engine.js:679-707（backup/restore）
- 证据摘录：
  - store.js:44-48 `const txt = await fsp.readFile(...); return JSON.parse(txt)` … 仅 ENOENT 回 null，`throw e` 其余
  - engine.js:684 `state.backups.push({ ..., state: structuredClone(state) })` —— 备份存于 tree-state.json 自身
- 论证：进程崩溃/磁盘满导致 JSON 半截时，read() 抛 SyntaxError → 引擎 E_INTERNAL，该树所有操作死锁且无降级（不会回退到 .tmp 或任何副本）；而 10 份备份恰恰内嵌在同一个损坏文件里，restore 也救不了。注释（678 行）自认"文件级备份随 storageDomain 适配升级"，即当前实现只有语义、没有真正的灾备能力。重启恢复仅覆盖"文件完好"这一种世界。
- 建议：read 失败时尝试 `tree-state.json.tmp` / `*.bak` 副本；或备份落独立文件（backup-<name>.json），state 内只存索引。

### O2【中】备份内嵌导致状态膨胀与写放大
- 位置：engine.js:683-688 + store.js:51-56
- 证据摘录：engine.js:687 `if (state.backups.length > 10) state.backups.splice(...)`；store.js:54 `await fsp.writeFile(tmp, JSON.stringify(state), 'utf-8')`
- 论证：每次 backup 后 state 体积≈11×工作集，此后**每一次** store.write（任何事件、nudge、context 上报）都全量序列化 10 份历史快照——树越大写越慢，call-log 高频追加的树会被拖垮。另有跨次快照去重缺失：连续两次 backup 之间几乎无变化也整克隆。
- 建议：备份写旁路文件；或快照只存与上一份的增量/哈希链。

### O3【中】无 GC：观测/事件数据无界增长（唯一例外 heartbeat 500 条）
- 位置：store.js:63-68、engine.js:270/573/630、对照 engine.js:599
- 证据摘录：engine.js:599 `if (state.heartbeat_log.length > 500) state.heartbeat_log.splice(0, ...)` —— 全文件唯一上限；而 `leaf.events`（270）、`state.drift_log`（573）、`state.communication_log`（630）与 call-log.jsonl（append-only）均无任何轮转/归档。
- 论证：长生命周期树（竹节多段、重复 nudge/重派）下 events/drift 线性累积，叠合 O2 的备份放大，tree-state.json 无界膨胀；call-log.jsonl 设计上 append-only 但也没有按大小切分，排查工具与磁盘都被拖累。任务说明宣称 store 层有"GC"，实际代码中不存在。
- 建议：为 events/drift/communication 提供 `archived` 截断命令（done/archived 节点事件归档）；call-log 按大小滚动。

### O4【中】并发安全只到单进程：fsStore 无文件锁，双宿主同目录必然丢更新
- 位置：store.js:37-69、engine.js:33-42（enqueue）
- 证据摘录：engine.js:38 `return enqueue(treeId, async () => { const state = await store.read(treeId); ... })` —— 串行仅在本进程 Map 队列内；fsStore 的 read/write 无任何 advisory lock/版本号。
- 论证：两个 DSH 宿主进程指向同一 rootDir（或宿主崩溃后另一进程接管）时，read-modify-write 交叉执行，后写者整树覆盖前写者（事件、runtime 状态静默丢失）。schema_version 字段存在（engine.js:57）但从未用于写冲突检测。
- 建议：write 前后带 mtime/版本比对（CAS），冲突返回 E_WRITE_CONFLICT 重试；或 OS 文件锁。

### O5【中】clock 时间源为墙钟（Date.now），超时计算对时钟回拨不设防
- 位置：clock.js:16、engine.js:510-512
- 证据摘录：
  - clock.js:16 `now: () => Date.now()`
  - engine.js:510-512 `const baseline = Math.max(rt.dispatchedAt, rt.lastOutputAt); const now = clock.now(); if (now - baseline >= orchCfg.nodeTimeoutMs)`（nodeTimeoutMs=30min，engine.js:364）
- 论证：Date.now 非单调，NTP 步进回拨后 `now - baseline` 变负，硬截止被无限推迟（节点挂死也不 timeout）；反之大幅前跳会误杀健康节点。注释声称"超时判定 = max(dispatchedAt,lastOutputAt)+timeout ≤ now"且 sweep 每 tick 刷 lastOutputAt，但 lastOutputAt 端口失败时静默沿用旧值（engine.js:508 catch 吞掉），告警责任被推给"宿主装配层"，引擎侧无任何留痕。
- 建议：超时基准改用单调钟（`performance.now` / 注入第二时钟）；lastOutputAt 读取失败时写 drift 留痕。

### O6【低】verify.js 绕过注入时钟直接用 Date.now，虚拟时钟下 verdict 时长失真
- 位置：verify.js:88,90 等（`const t0 = Date.now()` 遍布 runCheck）vs clock.js 设计意图（"假时钟断言载体"）
- 证据摘录：verify.js:88 `const t0 = Date.now()`；engine 各处均走注入的 `clock.now()`，唯验证层硬编码墙钟。
- 论证：引擎整体把时钟当注入缝以便测试/回放，验证层的 durationMs 与 command timeout（ports.exec 的 timeoutMs 由实现方解释，尚可）之外的自计时不受 VirtualClock 控制，确定性回放/测试断言 duration 不可行。属一致性问题，非正确性缺陷。
- 建议：createVerifier 接受可选 `clock`，缺省回 Date.now。

### O7【低】sweep 竹节检查与 setContext 触发条件不对称，可对非 active 叶重复接力
- 位置：engine.js:235 vs engine.js:522
- 证据摘录：setContext 要求 `leaf.status === 'active'` 才置 segment_pending（235）；sweepTick 竹节分支只查 `rt.state === 'running'` 与 `leaf.role !== 'root'`（521-522），不查 leaf.status。
- 论证：status 已是 segment_pending/pruned 但 runtime 仍 running 的叶（cancel 竞态、级联 prune 期间），sweep 仍会再次触发 bambooRelay，segment_chain 被额外消耗（上限 5，engine.js:454），极端情况提前 frozen。
- 建议：sweep 竹节分支补 `leaf.status === 'active'` 守卫，与 setContext 对齐。

---

## 结论自述

共 10 项发现：漂移 4 项（D1 高危：42 阈值死回退键名错位；D2 简报必达过度承诺；D3 ts 单调语义弱于宣称；D4 "自动附 DoD"实为宿主职责），运维 6 项（O1 损坏不可恢复+备份陪葬、O2 备份内嵌写放大、O3 无 GC、O4 无跨进程锁、O5 墙钟超时不设防、O6/O7 一致性小缺陷）。产物：本文件 `demo/flaudit/w4-skillops.md`，未改动其他任何文件。
