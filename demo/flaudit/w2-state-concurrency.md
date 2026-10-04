# W2 状态机与并发正确性审计 — dsh-tree-engine (state.js / engine.js / queue.js)

审计范围：`packages/dsh-tree-engine/src/state.js`(84行)、`engine.js`(748行)、`queue.js`(28行)，交叉参照 `guards.js`、`store.js`（只读，未改动）。审计基线：状态迁移表完整性、非法迁移处理、回流路径、临界区（读-改-写/CAS/事件顺序）、依赖闸门绕过、attempt 计数边界。

---

## 问题清单

### 1.【严重|engine.js:312-325|nudgeAppend 绕过状态迁移表，done/archived 叶子可被打成 pruned】

- **位置**：`engine.js:316-321`（对照 `state.js:18-25`）
- **证据摘录**：
  ```js
  leaf.nudge_count = (leaf.nudge_count ?? 0) + 1
  const esc = nudgeEscalation(leaf.nudge_count)
  if (esc.forcedPrune) {
    leaf.status = 'pruned'     // 直接赋值，未调 assertTransition
  ```
  而迁移表规定 `done: ['pruned','archived','done']` 合法、但 `archived: ['archived']`，`segment_pending` 只能回 `active`；`nudgeAppend` 完全不检查 `leaf.status` 当前值。
- **论证**：对一个已 `done`（或 `archived`）的叶子连续 nudge 7 次，`status` 被静默覆盖为 `pruned`。已结算节点被回炉成 prune 终态，其 runtime 若为 `succeeded`，下游依赖闸（`engine.js:393` 接受 `status==='done'`）随即失配，依赖它的节点被永久卡死（`E_DEPENDENCY_NOT_MET`），且无任何事件/回滚痕迹（仅 drift_history 一条）。这是显式白名单状态机被内部写路径旁路的教科书案例。
- **建议**：强制路径也走 `assertTransition(leaf.status,'pruned')`；对 `archived`（不可逆终态）直接拒绝 nudge；`done` 叶子 nudge 应报错而非降级。

### 2.【严重|engine.js:383-421 + 255-258 + 393|done 事件回流使依赖闸门可绕过 done 三重闸】

- **位置**：`engine.js:392-398`（依赖闸）、`engine.js:275-278`（事件回流）、`engine.js:497-502`（sweep 二次回流）
- **证据摘录**：
  ```js
  const depDone = (d) => state.leaves[d]?.status === 'done' || state.leaves[d]?.runtime?.state === 'succeeded'
  ```
  而事件回流：
  ```js
  if (type === 'done' && leaf.runtime?.state === 'running') { ...; leaf.runtime.state = 'succeeded' }
  ```
  `event:append` 的 done 事件只校验 `caller === leaf.session_id`（engine.js:256），**不校验 milestone 闸（assertMilestoneGate）也不把 leaf.status 置 done**。
- **论证**：dispatchStart 在派发时把执行会话绑定为 `leaf.session_id`（engine.js:412，注释明说"派发即绑定执行者为节点 owner"）。于是执行者只需自报一条 `type=done` 事件（无需任何 milestone/audit_pass），runtime 即翻 `succeeded`；下游节点的依赖闸读到 `runtime.state==='succeeded'` 放行。`done 三重闸`（done 事件 + milestones 全 audit_pass）只保护 `leaf:set-status done` 这一条正门，编排主路径（依赖闸）却接受零验证的旁门——闸门形同虚设。sweepTick 的"sweep reflux"（497-502）进一步把任何带 done 事件的 running 叶子兜底翻 succeeded，扩大同一缺口。
- **建议**：依赖闸只认 `status==='done'`；或让 done 事件回流同样过 `assertMilestoneGate`，并把 `leaf.status` 一并置 `done`，使双轨收敛为单一事实源。

### 3.【高|engine.js:383-421|dispatchStart 不检查 leaf.status，pruned/archived/done 叶子可再派发】

- **位置**：`engine.js:386-389`
- **证据摘录**：
  ```js
  const leaf = mustLeaf(state, leafId)
  if (leaf.role === 'root') treeError('E_SCHEMA_INVALID', 'cannot dispatch root leaf')
  const rt = runtimeOf(leaf)
  if (rt.state === 'running') treeError(...)   // 唯一的闸：runtime 状态
  ```
- **论证**：唯一的重派闸是 `rt.state !== 'running'`。已被级联 prune（问题5）、7-strike 强制 pruned、甚至 `done` 的叶子，只要 runtime 处于 `cancelled/timeout/failed/frozen/pending`，都能再次 `dispatch:start`。派发后 `segmentAppend`（engine.js:302）还会无迁移检查地把 `leaf.status` 覆写为 `segment_pending`——一个 `done` 叶子经由"再派发+竹节"变成 `segment_pending`，穿过迁移表中不存在的 `done→segment_pending` 边。prune/冻结语义（"frozen for adjudication"）可被同树任意有 caller 权限的会话单方面解除。
- **建议**：dispatchStart 增加 `leaf.status` 白名单（active / segment_pending / pending_brief），终态直接拒绝；segmentAppend 改为经 `assertTransition`。

### 4.【高|store.js:18-56 + engine.js:33-42|无 CAS/revision 的读-改-写：跨进程丢失更新，串行队列只护单进程】

- **位置**：`engine.js:33-42`（withTree→enqueue）、`store.js:24-25 / 51-56`
- **证据摘录**：
  ```js
  return enqueue(treeId, async () => { const state = await store.read(treeId); return fn(state) })
  // store.write: trees.set(...) / fsp.rename(tmp, statePath)   —— 无版本比对
  ```
- **论证**：并发正确性完全押在 `queue.js` 的 per-tree 进程内 Promise 链上；`fsStore` 是裸 last-writer-wins。任何第二个进程/宿主实例（GUI 与 CLI 并存、双开 harness、restore 工具直写）对同一 `tree-state.json` 执行 read-modify-write 即产生经典丢失更新——且 engine 注释（`engine.js:3`）自述"全部临界区经 per-tree 串行队列"仅在单进程成立。整个 state 无 `revision`/`etag` 字段，写侧无 compare-and-swap 钩子，竞态既无法防御也无法检测。文件锁亦不存在（fsStore 只有 tmp+rename，防的是写撕裂不是丢更新）。
- **建议**：state 增加 `revision` 单调计数；`store.write` 增加 `expectedRevision` 参数或 `compareAndWrite` 端口；至少在文件实现上加锁文件/独占句柄，并在文档中把"单进程"约束升级为显式前提。

### 5.【高|engine.js:178-189|级联 prune 不处理 runtime：运行中的子会话变孤儿，后续仍可 reflux succeeded】

- **位置**：`engine.js:179-188`（cascade）、`engine.js:497-502`（sweep reflux）
- **证据摘录**：
  ```js
  const cascade = (parentId) => { ... l.status = 'pruned' ... }   // 只改 status，不动 leaf.runtime
  // sweep: if (done event) { rt.state = 'succeeded'; events.push({..., event:'succeeded'}) }
  ```
- **论证**：父节点 `set-status pruned` 时，运行中的子节点 status 被级联置 `pruned`，但 `leaf.runtime.state` 仍为 `running`，其 subagent 既未被 `ports.interrupt`（对比 `dispatchCancel` engine.js:431、`bambooRelay` engine.js:459 都先 interrupt），也不从 sweep 的 running 扫描中豁免——孤儿会话继续消耗并发名额直到 30 分钟硬超时。若执行者在被 prune 后仍写入 done 事件，`eventAppend` 回流（engine.js:275）会把它翻成 `succeeded`：一个 `status='pruned'`、`runtime='succeeded'` 的矛盾节点诞生，验证/收割语义被污染。cascade 也不检查迁移合法性（`pending_brief→pruned` 在迁移表中本不存在，见 state.js:19-25——pending_brief 允许 pruned，此点合法；但 `segment_pending→pruned` 不在白名单内，级联照样覆写）。
- **建议**：cascade 内对 `runtime.state==='running'` 的节点调用 `ports.interrupt` 并置 `rt.state='cancelled'`（记 history note 'cascade prune'）；cascade 路径同样过 `assertTransition` 或在迁移表中补录 `segment_pending→pruned` 使表与实现一致。

### 6.【中|engine.js:489-529|sweepTick 在临界区内 await 外部端口：锁持有时间不可控，队列队头阻塞】

- **位置**：`engine.js:504-524`（临界区内 `await ports.lastOutputAt / usagePct / bambooRelay→ports.dispatch/interrupt/promptHandoff`）
- **证据摘录**：
  ```js
  results.push(await enqueue(treeId, async () => { ...
    const t = await ports.lastOutputAt(rt.subagentSessionId)   // 网络/IO 在锁内
    ...
    if (pct >= ...) { const r = await bambooRelay(...) }        // relay 内含两次外部 dispatch
  ```
- **论证**：`queue.js:16-25` 的队列保证是"临界区按提交序串行"，但没有超时/让出机制。sweep 对每个 running 叶子在锁内做最多 3 次外部 IO（lastOutputAt、usagePct、必要时 promptHandoff+interrupt+dispatch 整条接力）。端口挂起（如 zai/subagent 宿主无响应、promptHandoff 无超时上限——engine.js:450 注释"超时/空→照常接手"却未设 deadline）时，同一树的全部命令（含执行者自报 done 的 `event:append`）排队等待，执行者收不到结算，反而更容易被下一轮 sweep 误判超时——自我加剧的活锁。`enqueue` 的 `tail.then` 清理也依赖该 promise 完成，长期挂起时 `tails` 永不释放。
- **建议**：端口调用加 `Promise.race` 超时；或将外部 IO（读日志/用量）移出临界区，只在锁内做状态判定与写回；`promptHandoff` 明确硬超时（对齐 graceMs 语义）。

### 7.【中|engine.js:404+414|attempt 计数在 ports.dispatch 抛错时自增不一致；竹节接力不计 attempt 形成隐形无限重试】

- **位置**：`engine.js:400-414`、`engine.js:461-464`
- **证据摘录**：
  ```js
  const session = await ports.dispatch({ ..., attempt: rt.attempt + 1 })   // 400-405
  ...
  rt.attempt += 1                     // 414：仅在 dispatch 成功后
  // bambooRelay: attempt: rt.attempt   （接力不 ++）
  ```
- **论证**：两个边界。(a) `ports.dispatch` 若在宿主侧**实际已启动**子会话但返回时抛错/超时（网络回包丢失），`rt.attempt` 不增、`rt.state` 不变，宿主留下一个无人认领的活会话，而引擎允许立即重派——attempt 失真、幽灵会话累积，`max_subagent_spawn_per_leaf` 的 spawn 事件闸（事件型）也计不到它。(b) 竹节接力设计上"不改 attempt"，但接力同样消耗一个真实子会话且链长上限仅 5；`segmentChain` 达限置 `frozen`（engine.js:454-456）是唯一刹车，而问题3表明 frozen 可被再次 dispatch:start 绕过，绕过后 attempt+1 但 segmentChain 清零了吗？——没有清零逻辑，`rt.segmentChain` 保留，5 次接力后再度 frozen，形成"frozen→手动重派→接力5次→frozen"的合法循环泵，无总尝试上限。
- **建议**：dispatch 协议加两段式（返回承诺 sessionId 先落账再启动），或至少在 dispatch 异常时记录 `rt.ghostSessions[]`；为每叶增加总派发预算（含接力），frozen 重派需显式 adjudication 动作清链。

### 8.【低|engine.js:266-269|事件 ts 单调依赖 ISO 字符串比较与调用方自报 ts，跨时钟可写入乱序】

- **位置**：`engine.js:266-269`
- **证据摘录**：
  ```js
  const ts = tsIso ?? nowIso(clock)
  if (leaf.events.length > 0 && ts < leaf.events[leaf.events.length - 1].ts) { E_TS_NOT_MONOTONIC }
  ```
- **论证**：`tsIso` 由调用方透传（`call(cmd,args,caller,tsIso)`），字符串字典序比较对同为 UTC ISO 串安全，但调用方可传任意同格式假值（如未来时间），一次性把时钟锚点推到 2100 年，此后引擎自身 `nowIso` 的事件全部被拒（E_TS_NOT_MONOTONIC），叶子事件通道被永久 DoS；无需特权校验（eventAppend 对非 done 事件无 caller 检查）。另外 `eventList` 的全局排序（engine.js:559）在多叶乱序 ts 下生成与写入序不一致的"事件顺序"，依赖事件序做审计回放的消费者（如 V10-status-event-sync 的 done-event-before-status 检查）可被时序欺骗。
- **建议**：非 done 事件也校验 caller 或限制 tsIso 仅内部时钟路径可用；ts 比较改为数值毫秒并夹取 `ts = max(ts, last.ts)`（或直接忽略调用方 ts）。

---

## 附：其余核对项（未列问题）

- **迁移表完整性**：`state.js:18-25` 覆盖枚举闭集，`assertTransition`（state.js:45-52）对 from/to 均做枚举校验，`archived` 唯一吸收态正确。缺口在**引擎内部写路径不走 assertTransition**（问题1/3/5），表本身质量合格。
- **done 三重闸**：`assertDoneEventGate` + `assertMilestoneGate`（state.js:55-70）只挂在 `setStatus`（engine.js:172-175）；`validate`（engine.js:343-345）补了 status=done 无 done 事件的反向一致性，但反向（有 done 事件 + status≠done）不查，与问题2同源。
- **queue.js**：链尾吞错、空表清理（`tails.get(treeId)===tail` 判定防竞态删除）实现正确；"禁重入"仅注释约定无运行时检测（同树嵌套 enqueue 会死锁且无诊断），风险低但建议加重入哨兵。
- **backup/restore**（engine.js:679-707）：restore 不校验 `restored.schema_version`，也不清 `leaves[*].runtime` 中的旧会话绑定；恢复后旧 runtime 可能指向已死会话——建议恢复时将全部非终态 runtime 置 `pending`。
- **nudgeReset**（engine.js:652-661）与 **setVerification**（engine.js:213-224）均无 caller 校验：任意会话可清零他人 7-strike 计数、改写 `verification.pass`——在单宿主信任模型下可接受，但与 R2"防借身份"基调不一致，记为低危备忘。

## 变更摘要

- 新增 `demo/flaudit/w2-state-concurrency.md`（本文件），共 8 条问题（严重 2 / 高 3 / 中 2 / 低 1）+ 5 项核对备忘。
- 未改动审计对象及任何其他文件（只读审计）。
