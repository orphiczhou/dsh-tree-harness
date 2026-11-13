# @local/dsh-tree-engine

树形任务分解执行引擎（DSH 宿主插件）。行为基准：[docs/architecture/engine-spec.md](../../docs/architecture/engine-spec.md)（S0 冻结）；工具面契约以本包 `index.js` 的 9 个工具 schema 为准（[docs/architecture/tools-mapping.md](../../docs/architecture/tools-mapping.md) 是 S0 设计表，含未实现的 action，仅供设计参考）。

## v0.10.0 增量：flash 审计第二批（信任闸 / 竹节预算与唯一性 / 护栏注入面 / 灾备 / GC）

**背景（2026-11-13 D24 轮 / `docs/archive/flaudit-report.md` 剩余项）**：D23 已修 #1/#7/#19；本轮修 **#8**（done 事件回流使依赖闸可绕过三重闸）、**#15**（验证裁决落账无一致性校验）、**#20**（竹节接力绕过会话唯一/预算、账目分裂）、**#21**（audit_meta 护栏可放宽/可写坏）、**#22**（subagent_spawn 预算事件无 owner 归属）、**#28**（fsStore 损坏不可恢复）、**#30**（无 GC / call-log 无界），顺带修 **#23**（竹节阈值回退键名死回退）。**测试 213 → 225/225**（新增 `audit-p2a.test.js` 12 例；`write-guards` 矩阵快照 +1 键）。

- **依赖闸（#8，R1 复核 P1-1 收口）**：`dispatch:start` 的 dependencies 判定只认**正向结算信号**——依赖 leaf `status==='done'`（done 三重闸正门）**或** `verification.pass===true`（验证裁决 PASS）才放行；`verification.pass===false` 永不放行（`E_DEPENDENCY_NOT_MET`，message 标 `verification=FAIL`）；**「自报 done 事件翻出的 `runtime.succeeded`」不再作为依赖结算信号**（原主旁路：worker 只需 owner 身份自报一条 done 即可零验证放行下游，R1 复核已实证）。`sweep` 的 done 事件回流增加**当前 attempt 判据**（`event.ts >= runtime.dispatchedAt`，`dispatchedAt=0` 的旧状态保持兼容）——重派/接力后旧 done 事件不再把新 attempt 直接判 succeeded。操作契约同步：指挥官推进下游前必须 `tree_verify`（落 PASS 裁决）或让上游走三重闸收口（SKILL 契约已同步）。
- **验证裁决落账（#15，R1 复核 P3-3 收口）**：`leaf:set-verification` 增加主体/一致性校验：`policyId` 若在场须字符串；`verdicts` 须为「每项带 boolean `pass` 的对象」数组；**`pass` 必须等于 verdicts 的 AND**（`{pass:true, verdicts:[{pass:false}]}` 之类的伪造裁决 → `E_SCHEMA_INVALID`）；**显式空 `verdicts` + `pass:true` = 无证据 PASS，同样拒绝**（省略 verdicts 的受信方自证调用保持兼容）；`rounds` 须为对象数组（adversarial 逐轮裁决透传）。鉴权（creator/root/delegate，owner 自验拒）不回归。
- **竹节接力预算与唯一性（#20）**：`bambooRelay` 接力前先做 `sessionBudget` 探针（新会话将 +1），满额 → 节点 `frozen` + `security/high` drift（不再静默烧链）；接力 dispatch 返回的 sessionId 必须过 `findSessionConflict`（全树会话唯一），冲突 → 中断新会话（回滚）、`frozen`、`security/high` drift，不把冲突会话绑定为 owner。账本口径明确：**接力账本 = `runtime.segmentChain`（唯一写入点），`leaf.segment_chain` = 手写 segment:append 通道账本**，两本账互斥（`validate` F1③ 强制），预算/唯一性判定取并集。
- **护栏注入面（#21/#23，R1 复核 P2-2/P3-4 收口）**：`engine init` 的第 5 参 `audit_meta` 现经 `validateAuditMeta()`（`src/config.js`）——与 Config 同款严格校验（未知键/类型/范围 fail-closed，`E_SCHEMA_INVALID`），**编排键（nodeTimeoutMs 等）显式拒收**；「比基线更宽松」的护栏上调**只允许真正被逐树消费的 `ctx_segment_threshold`**（写 `security/high` drift：`audit_meta uplift: key base -> value`），**recorded-only 键（node_budget 等）的上调一律拒绝**——「已放宽」留痕不得指向不会被消费的护栏（误导审计真相；部署方放宽走 `TREE_ENGINE_CONFIG`，由 init 的 config uplift 留痕兜底）。`set-context` 阈值读取修复：回退键由错误的 camelCase `cfg.ctxSegmentThreshold` 改为 `cfg.ctx_segment_threshold`（#23 死回退），并对旧树 `audit_meta` 中非法阈值（字符串/越界）做防御性回退，不再静默失效。
- **预算事件归属（#22）**：`LEAF_WRITE_MATRIX` 新增 `event:subagent_spawn` = **仅 owner**（creator/root 代写 → `E_BORROWED_IDENTITY`），封堵「向他人 leaf 注入 spawn 事件耗尽 15 次预算」的 DoS 向量；普通事件（owner/creator）语义不变。
- **灾备（#28，R1 复核 P2-3 收口）**：`fsStore.read` 在主文件损坏（写中断/半截 JSON）或缺失时**回退尝试 `.tmp` 原子写副本**（`writeFile` 成功、`rename` 前崩溃留下的最新完整态）；两者均坏才抛原错误（不静默返回 null）；下次写会把修复后的 state 落回主文件。**恢复不再静默**：损坏路径的恢复会先把损坏原件复制为 `.corrupt-<时间戳>` 取证副本，并向 `call-log.jsonl` 追加 `state.recovered` 留痕（来源/损坏副本路径/解析错误摘要）。
- **GC 与观测滚动（#30）**：`tree_maintain` 新增 `action:"gc"`（参数 `keep`，缺省 20、钳制 0–500；**仅 root 会话**）——只截断 **archived** 叶子的 `events`（保留最近 `keep` 条 + 全部 `done` 事件）/`drift_history`/`runtime.history`，并把 `tree.drift_log` 截到 `keep×5`（下限 100），gc 自身写 `security/low` drift 留痕；非 archived 叶子零改动。`fsStore.appendCallLog` 增加 **10MB 滚动**（`call-log.jsonl` → `.1`，旧 `.1` 覆盖），观测层不再无界膨胀。

## v0.9.0 增量：硬安全与可观测性收口（跨进程写互斥 / 状态机强制路径 / 建点白名单 / 日志机读化 / 验证授权委托）

**背景（2026-11-13 D23 轮 / flash 审计三条高危 + D22 两个次要发现）**：① flash 审计 #1/#7/#19 查实——`.lock` 文件锁未实现（跨进程 last-writer-wins 丢更新）、`nudgeAppend` 强制 prune 绕 `assertTransition`（archived 可被静默打成 pruned）、`leafAdd` 无字段白名单（可预注入 `runtime/verification` 伪造状态）；② D22 发现 `tree_log {action:"events"}` 只回计数（done meta 不可机读）、现场建树后 root 会话 dispose 导致事后 `tree_verify` 被 `E_BORROWED_IDENTITY` 拒。本轮全部修复/补能力，**测试 172 → 213/213**（新增 `store-lock` 8 / `nudge-gate` 6 / `leaf-add-whitelist` 8 / `tree-log-render` 5 / `verify-delegate` 14 共 41 例（含 R1 复核回归 4 例））。

- **跨进程写互斥（#1）**：新增 `src/lock.js`——`tree-state.lock` 用 `fs.writeFile(..., {flag:'wx'})`（O_EXCL）原子建锁，锁内容 `{pid,host,ts,nonce}`；`release` 校验 nonce 防误删他人新锁；**陈旧锁接管**（mtime/内容 ts 超过 `staleMs`=15s → `rename` 到唯一临时名抢占，成功者继续并落 `tree-lock-takeover.log`）；活持有者由 `store.withLock` 心跳（`utimes`，staleMs/2 封顶 5s）刷新，长临界区不被误判陈旧；超时抛 `E_TREE_LOCK_TIMEOUT`（含 tree_id 与锁路径）。`src/store.js` 端口增加 `withLock`（fsStore=文件锁；memoryStore=每树 promise 链；旧实现保持兼容）；`src/engine.js` 拆 **`withTree`（只读直读、不加锁）** 与 **`withTreeMut`（enqueue + withLock，18 个写命令与 `sweepTick` 全部改走它）**，嵌套写命令零调用（无自锁）。
- **nudge 强制 prune 走状态机（#7）**：第 7 次 nudge 强制 prune 前 `assertTransition(leaf.status,'pruned')`——archived 叶子被拒（`E_STATUS_TRANSITION_INVALID`；抛错在 write 前，`nudge_count` 不持久化增加、无 drift），`done→pruned` 等白名单迁移照常并留 high/rhythm/prune drift。
- **建点字段白名单（#19）**：`leaf:add` 仅接受 `leaf_id / session_id / parent / path / role / added_by / relay / taskType / dependencies / brief / dod / model / channel` 13 键（导出 `LEAF_ADD_ALLOWED_FIELDS`）；白名单外键 `E_SCHEMA_INVALID`（message 含非法键名与允许清单）；`runtime / verification / status / events / milestones / segment_chain / drift_history / context_usage_pct / nudge_count` 等内部字段由引擎初始化，**永不接受调用方输入**。
- **`tree_log` 事件机读化（D22 次要发现）**：`tree_log {action:"events"}` 的 render 从「仅 `tree_log: N entries`」改为**一行一条**（`[ts] leaf_id type meta=<紧凑 JSON>`），done 事件 meta（summary/probe_result 等）可被 agent 直接读取；events 只渲尾部 50 条并给截断提示，单条 meta 超 800 字符截断；drift/heartbeat/communication 同样一行一条；返回对象结构不变、首行 `tree_log:` 前缀保留。
- **验证授权委托（D22 次要发现）**：`tree_maintain` 新增 `action:"verify-delegate"`（参数 `session_ids: string[]`，全量替换语义、`[]` 清空）——**仅树 root 会话可授予**（root.session_id；root 为 null 的树拒绝并说明）；被授权者**只能写 `leaf.verification`**（`LEAF_WRITE_MATRIX.verification.delegate=true`，其余 7 种 kind 一律 ❌；owner 自验禁令不放宽）；变更落 `drift_log`（kind=`security` / action=`declare` / leaf_id=null）。用于「现场建树模式 root 会话 dispose 后，由受信会话补 `tree_verify`」；旧树缺 `verify_delegates` 字段读侧惰性缺省 `[]`。
- **R1 异族红队复核（Qwen 系）修复**：① `leaf:add` 对既存 `leaf_id` 由「直接覆盖」改为拒绝（`E_DUPLICATE_LEAF`）——旧行为可擦除 archived/pruned 终态、done 事件与 drift 审计痕、重置 nudge_count（抵销 #7 不可逆语义）；② `nudge:reset` 补鉴权（owner/creator/root，越权 `E_BORROWED_IDENTITY`；工具面已传 caller）——封堵 reset+nudge 循环绕过第 7 次；③ root 信任锚叶子拒绝 nudge（7-strike 不得摘除 root）；④ `model`/`channel` 若在场必须是字符串（防对象经 relay assignee 流入宿主）；⑤ 文件锁心跳间隔改为 `staleMs/3`（下限 100ms，旧 1000ms 下限在 `staleMs<1s` 时可致双临界区）。回归测试 +4。
- **活体验证（2026-11-13）**：受控 disable→enable 后 `tree_doctor` 7/7 · version=0.9.0；活体 `tree_maintain {action:"verify-delegate"}` 授予→读回→清空 + `drift_log` 审计记录可见；`tree_log events` 活体读出 done meta（`probe_result` 原文）；`tree-state.lock` 操作后无残留；试点树 `t3c7/t3c8/t3c9/d23x` validate 0 issues。

## v0.8.1 增量：派发/接力子会话显式携带深度上限（`request.maxDepth`）

**背景（D22 三层组合 v2 真机实证，2026-11-13）**：`@deepseek-ai/dsh-subagent` 的 `startActivation` / `startContinuable`
**只校验调用方显式传入的 `request.maxDepth`**（asar 实证 `lib/index.js:1402/1405`；配置读取 `resolveMaxDepth` 仅被模型工具
`dsh-tool-subagent:452-462` 使用）。tree 派发此前不传该字段 → 组合路径上深度无平台兜底（实测深度 5 的 worker 再起子会话
成功创建 depth 6 会话，未抛 `SubagentDepthError`）。**修复：tree 派发、竹节接力与攻击审计会话统一显式传 `maxDepth`。**

- **新增配置键 `max_subagent_depth`**（`src/config.js` + `src/guards.js`）：缺省 **5**，可经 `TREE_ENGINE_CONFIG` 覆盖（整数 1–100）；
  非法值装载期失败（含键名）。写入树的 `audit_meta` 便于事后核对。
- **派发/接力注入端口**（`src/engine.js`）：`dispatch:start` 与竹节 relay 的 `ports.dispatch` spec 均带 `maxDepth`（relay 不能绕过上限）。
- **请求体构造抽纯函数**（`src/compat.js` 新增 `buildStartRequest`）：`index.js` 的 `startChildSession` 统一经它生成
  `{prompt,parent,agentOptions?,maxDepth?}`；`maxDepth` 缺省时不产生该字段（保持旧宿主形状），非法值 fail-closed；
  攻击审计会话（`runAttackSession`）同样走该构造。
- **测试**：新增 `tests/depth-budget.test.js`（4 例：缺省 5 / 配置覆盖 7 + audit_meta / 竹节 relay 同样携带 / 配置非法值拒绝）；
  `tests/compat.test.js` 11 → **14 例**（`buildStartRequest` 注入、缺省省略、非法值 fail-closed）。全量
  `node --test tests/*.test.js` = **172/172**（62 引擎 + 4 技能打包 + 1 B1 回归 + 9 tree_doctor + 8 写面护栏 + 14 compat + 10 identity + 7 budget + 12 relay + 17 token-meter + 7 usage-port + 9 validate + 8 sweep + 4 depth-cap）。
- **兼容性**：`maxDepth` 缺省 5 与 desktop profile `subagent.maxDepth=5` 对齐；若宿主配置更低（如 3），tree 派发超过该深度会以
  `E_PORTS_PROTOCOL` fail-closed（不再静默越界）。**flow 节点会话的 spawn 属 flow 引擎执行器**（同样未传 `maxDepth`），
  不在本包修复范围——已按用户指示写成跨仓需求单（`docs/operations/REQ-2026-11-13-flow-node-continuable-session.md` §9）。

## v0.8.0 增量：P0/P1 修复（per-leaf relay 开关 / usagePct 真实接入 / sweep 跨实例生命周期）

S1 真机 E2E（`docs/reports/e2e-composition-relay-2026-11-12.md`）实证的三个缺陷的代码修复；**本包内**只改引擎/工具/SKILL，仓级文档由 Lead 收口。

- **P0-A per-leaf relay 开关**（`src/engine.js` + `src/guards.js` + `index.js`）：`tree_node` 新增 `action:"set-relay"`，参数 `{tree_id, leaf_id, relay:"auto"|"off"}`（缺省 `auto`，持久化到 `leaf.relay`）；`tree_node add` 时也可直接带 `relay:"off"` 建点。`sweepTick` 在竹节判定前检查 `leaf.relay==='off'` 并**跳过该 leaf 的竹节**——其余收割/超时语义不变、不改 `runtime.state`，因此等待外部编排（flow run / `tree_verify` / 长命令）的 leaf 不会被 relay 打断（修复 flow journal `cancelled / E_RUN_CANCELLED`）。写权与既有写面一致并锁死：**creator/root 可改，owner 不得自关**（`LEAF_WRITE_MATRIX.relay = {owner:false, creator:true, root:true}`，越权 `E_BORROWED_IDENTITY`）。
- **P0-B usagePct 修复**（新增 `src/token-meter.js` + `index.js`）：旧实现直接 `services.tokenMeter` 属性访问——宿主代理对未 inject 的服务抛错，catch 后恒 null（`ctx.get` 兜底在同一 try 内不可达，S1 实测 22 条 `tokenMeter.measure unavailable`）。现在 `resolveTokenMeter` 逐路径独立 try 安全获取（`ctx.get('tokenMeter')` → `services.tokenMeter` → `ctx.tokenMeter`，绝不让属性访问抛穿）；百分比提取抽纯函数 `extractUsagePct`（支持 `pct / contextPct / context.pct / pressure.pct / usage.pct`，0–1 归一、0–100 截断、非法 `null`），首次成功打 `tokenMeter.measure shape:` 日志，失败只打一次。tokenMeter 服务可用时竹节即可拿到宿主测量信号（自报仍先到者生效）。
- **P1-C sweep 跨模块实例生命周期**（新增 `src/sweep.js` + `index.js`）：模块级 `currentStopSweep` 在热更 reload 后不可达 → 旧 sweep interval 变僵尸（实测 24 条 `inactive context` + 14 条 `sweep_error` + tree-state tmp rename 竞态）。现在停止器存放在跨实例注册表 `globalThis[Symbol.for('dsh-tree-engine.sweeps')]`（按 `dataDir` 键）：新 apply 启动 sweep 前先停旧实例、`stop` 幂等且清理注册表、`ctx.on('dispose')` 可用时卸载清理；stop 异常不吞（无 `onError` 钩子时向上抛，不静默制造第二个 sweep）。
- **P1-D relay parent Agent 兜底**（`index.js` + `src/engine.js`）：热更后进程内 Agent 缓存（`parents` Map）为空 → relay dispatch 必失败。现在竹节 relay 的 dispatch spec 带上持久 `parentSessionId`，缓存未命中时按该 id 从 `agents` 服务安全重解析活 Agent；重解析失败保持原错误 `E_PORTS_PROTOCOL`（不伪造 parent、不静默降级）。
- **测试**：新增 `tests/relay.test.js`（12 例：开关持久化/非法值/写权矩阵/leaf:add/off 时 sweep 跳过/控制组/灰度粒度/收割语义不变/工具面 schema/P1-D 重解析/双信号取高）、`tests/token-meter.test.js`（17 例：五种形状/0-1 归一/截断/非法/异常 getter/安全获取/活 Session 解析/容量折算/双读面综合）、`tests/usage-port.test.js`（7 例：端口级活 Session 契约/快照拒绝/属性抛错回落/measure 异常/agents 兜底——覆盖 F3 原始缺陷路径）、`tests/validate.test.js`（9 例：relay 后 validate PASS/连续接力/segment 通道/三类真重复/F2 工具层 issues 可读与 render）、`tests/sweep.test.js`（8 例：两次 start 停旧/多键隔离/stop 幂等/异常不吞/globalThis 注册表/入参校验）；更新 `tests/write-guards.test.js` 矩阵快照与 W2.1 validate 口径相关用例（`tests/identity.test.js` / `tests/budget.test.js`）。全量 `node --test tests/*.test.js` = **165/165**（62 引擎 + 4 技能打包 + 1 B1 回归 + 9 tree_doctor + 8 写面护栏 + 11 compat + 10 identity + 7 budget + 53 v0.8.0）。
- **v0.8.0 收口（首轮真机 E2E findings F1/F2/F3，2026-11-12）**：
  - **F3（P0-B 剩余）**：`tokenMeter.measure(session)` 的入参是**活 Session**（`session.seq`/`eventAt`/`snapshotEvents`），旧实现传 `sessionQuery.readSession` 快照 → `session.snapshotEvents is not a function` 仍恒 null。现 `usagePct` 先 `resolveLiveSession`（`ctx.get('sessions').get(id)` 首要、`agents.get(id).session` 兜底；只认活 Session 形状，绝不把快照塞给 tokenMeter）→ `contextPressure(session)`（provider 报量/容量，占用率最权威）+ `measure(session)`（replay 测量）双读面 → `resolveUsagePct`（显式 pct 字段 → pressureTokens/contextWindow → totalTokens/contextWindow）；无活 Session/无容量 → null 回落自报，失败日志只打一次，首次成功仍打 `tokenMeter.measure shape:`。**双信号取高**：sweep 的竹节判定改成 `max(宿主测量, 自报)`——测量可用的同时不再覆盖自报（旧 `pct = usage ?? self` 会让「执行者自报已到点、测量尚未反映」的会话失去竹节）。
  - **F1（W2.1 存量假阳性）**：竹节 relay 的合法形态（当前 `session_id` 同时是本 leaf 接力链最新会话）不再被 `validate` 误报 `session_duplicate`；每个 leaf 的每个会话集合只豁免一次自身当前会话，同一 id 在自有链里重复出现、跨 leaf 复用仍照旧 FAIL。`s1rl1`/`rly8b`/`rly8c` 形态有单测覆盖。
  - **F2（validate 工具层 TypeError）**：`tree_status{action:"validate"}` 的失败形态是 `{ok:false, issues}`（无 error 对象），旧代码走 `toError(r)` 读 `r.error.code` → `TypeError: Cannot read properties of undefined`。现在 `queryResultToTool` 只对带 `error` 的结果抛错，`{ok:false, issues}` 原样返回；render 展示前 3 条 issue 摘要（`session_duplicate@leaf` 等）。
- **SKILL**（v2.2）：tree-commander/tree-worker 竹节小节补充 `tree_node {action:"set-relay", relay:"off"}` 用法（等待外部编排的 leaf 由指挥官关竹节；执行者不得自关）。
- **已知边界（UNKNOWN / 未在本包修复）**：host 侧 `inject` 列表未加 `tokenMeter`（服务可用性由宿主装配决定，本包只做安全获取 + 回落）；flow 侧 successor 重跑同 runId 命中 `E_RUN_EXISTS` 属跨引擎语义，未在 tree 侧改 flow 代码。

## v0.7.0 增量：Wave 2 引擎完整性（预算计竹节链 / RC2 兼容层单测 / root 会话 id 兼容）

- **W2.1 会话预算计入竹节链**（`src/guards.js`）：`sessionBudget` 计数集合并入 `leaf.runtime.segmentChain`（竹节接力产生的历史会话；此前只统计 `leaf.session_id` + `leaf.segment_chain` + `session_registry`，高频接力的树会漏计、`max_sessions` 护栏失效）。`findSessionConflict` 与 `engine.js` 的 `validate()` 同步纳入 `runtime.segmentChain`，并按归一化 id 去重——同一会话跨 `leaf.session_id` / `leaf.segment_chain` / `runtime.segmentChain` / `session_registry` 只算一次。
- **W2.3 RC2 兼容层单测**（新增 `src/compat.js`）：把宿主 `subagents` 服务的双形探测（legacy `startContinuable` / 现役 rc.2 `startActivation` / 两形都缺 fail-closed）与 interrupt authority 候选顺序抽成**纯逻辑模块**（无宿主服务、无 IO、无 `@deepseek-ai/*` 依赖），`index.js` 只做装配，legacy 优先语义冻结。新增 `tests/compat.test.js`（11 例：两形返回形状解析 / 探测优先级 / interrupt 候选顺序 / 负例）。
- **W2.6 root 会话 id 兼容**（`src/guards.js` + `src/engine.js`）：DSH 根/主会话的 `DSH_SESSION_ID` 带 `session-` 前缀，而 dispatch 返回的 childId 是裸 UUID。修复前 `tree_plan` 传真实 id 即 `E_INVALID_UUID_STRICT`，root 信任锚比较（`root.session_id` 裸 UUID vs caller 带前缀）永不等值导致 root 写权退化、skills 指导的「裸 UUID」写法会 `E_BORROWED_IDENTITY`。现在引擎**写入侧归一化存储（裸 UUID 规范形）、比较侧归一化比较**（`normalizeSessionId` / `sameSession`，历史 state 里带前缀旧值同样兼容）；UUID v4 严格性不放宽（归一化后仍严格校验）。新增 `tests/identity.test.js`（10 例）。
- **测试**：新增 `tests/budget.test.js`（7 例）。全量 `node --test tests/*.test.js` = **112/112**（62 引擎 + 4 技能打包 + 1 B1 回归 + 9 tree_doctor + 8 写面护栏 + 11 compat + 10 identity + 7 budget）。

## v0.6.0 增量：只读自检工具 `tree_doctor`（第 9 个工具）

- **新增只读自检工具 `tree_doctor`**（`src/doctor.js` 纯逻辑 + `index.js` 注册）：用户反馈「工具 / Skill 没出现」时不再靠猜——一次调用给出 7 项结构化检查与修复提示。**零写副作用**：只读文件与 `store.read/list`，树不变式校验复用引擎 `validate`（经 `engine.table.validate` 直调，不落 call-log），不写任何树状态/日志。
- **7 项检查**（每项 `{id, status: PASS|WARN|FAIL, detail, hint?}`，顺序固定）：
  1. `package`：`package.json` 的 name/version 与 README 最新版本节（`## vX.Y.Z …`）是否一致——版本漂移的直接证据；
  2. `tool-count`：注册工具应为 **9**（8 既有 + `tree_doctor`），与 `index.js` 的 `TOOLS` 导出逐名核对（清单单一来源，不两处维护）；
  3. `skills`：包内 `skills/tree-commander|tree-worker/SKILL.md` 存在且 frontmatter `name:` 对应；`cordis.patch.yml` 挂载 `@deepseek-ai/dsh-skill-filesystem` 且 `providerName: tree-engine`；
  4. `tree-data`：state 根目录可读、树数/节点数/损坏文件数；给定 `tree_id` 时校验格式、存在性与不变式（复用引擎 validate，不复制逻辑）；
  5. `stale`：给定树时统计 `runtime.state==='running'` 且超过 `nodeTimeoutMs` 的节点、`segment_pending` 数（只读），提示 `tree_status {action:"harvest"}`；
  6. `sweep`：报告 `sweepMode`（timer）与「harvest 可立即强制一轮」提示；
  7. `env`：bundled 测试 node 路径、DSH 版本（`runtime.json` / `DSH_VERSION`）、node 版本；**探测不到只 WARN，永不 FAIL**。
- **FAIL 不 throw**：doctor 是诊断器不是门禁。返回 `{ok:true, action:"run", version, tool_count, checks:[...], summary:{pass,warn,fail}, hint}`；只有非法 `action` 抛错。工具面渲染为单行摘要，完整 JSON 在返回值里。
- **用法**：

  ```text
  tree_doctor                        # 静态检查（tree-data/stale 走无树路径）
  tree_doctor { tree_id: "wave1" }   # 额外校验指定树 + 统计停滞节点
  tree_doctor: 7 checks · pass=5 warn=1 fail=1 · version=0.6.0
  ```

- **写权矩阵接入（同一批次，来自 P1-05 修复的联调发现）**：`tree_verify` 的 4 处落账（adversarial `record`、普通 verify 的 `leaf:set-verification`、两处 verify 后 `progress` 事件）现在都传入真实 `caller`——verification 允许 creator/root、非 done 事件允许 owner/creator，此前缺 caller 会被 fail-closed 拒为 `E_BORROWED_IDENTITY`。
- **测试**：`tests/doctor.test.js` 9 例（正常树全 PASS + 零写副作用 / 缺 SKILL.md → FAIL / patch 缺 provider → FAIL / 非法与不存在 tree_id → FAIL 且不 throw / 无 tree_id 只做静态检查 / 工具数 8·缺名·重复·未注入 → FAIL / stale 超时 → WARN / env·sweep 探测不到 → WARN / `TOOLS` 9 项 + 真实包自检）。全量 `node --test tests/*.test.js` = **84/84**。

## v0.5.1 增量：SKILL 勘误（owner 语义 + 通用样例）

- `skills/tree-commander/SKILL.md` §3.1 与 `skills/tree-worker/SKILL.md` §1/§4.3：竹节接力后的 owner 说法统一为 **v0.5.0 起自动重绑给接手会话**（与 `src/engine.js` 实现、§1.3/§3.3 一致）；`session_handoff` 仍不迁移 owner，需 commander `set-session` 重绑。
- 两份 SKILL 的交接样例改为通用路径（不再引用本仓内部 `packages/...`），v1 用户可照抄。
- 无代码行为变化；`node --test tests/*.test.js` 仍 **67/67**。

## v0.5.0 增量：SKILL 工程化（包内技能 + skill provider + 50% 交接纪律）+ 审计修复

- **技能迁入包内**：`skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md`（此前在仓根 `skills/`，未被任何 skill provider 加载）。现在随包发布、随包版本迭代。
- **活体装载**：`cordis.patch.yml` 第二条 insert 挂载 `@deepseek-ai/dsh-skill-filesystem`（`providerName: tree-engine`、`includeDefaultRoots: false`、`bundledSkillDir` 经安装包身份解析到本包 `skills/`）——新会话的 Skill 目录里能看到 `tree-commander` / `tree-worker`，模型不必被点名工具也能按 skill 工作。
- **会话交接纪律入 skill**：每个被派发的 leaf 是独立 DSH 会话；除引擎竹节（`tree_report {action:"context"}` 自报，pct≥42 触发接力）外，skill 要求会话在 `session_handoff {action:"status"}` 的 `context_pct ≥ 50` 时**自主交接**给同层级新会话（`session_handoff` 由会话树单包提供，缺省 auto：子会话→同父兄弟），并在 `tree_report {action:"progress"}` 里留下交接文件与新会话 id，供 commander 继续收割。
- **B1 修复（v0.5.0，审计 BLOCK）**：竹节接力成功后把 `leaf.session_id` 重绑到接手会话——此前接力会话写 `done` 会被 `E_BORROWED_IDENTITY` 拒、leaf 只能等 `nodeTimeoutMs` timeout；现在接力会话可正常收口（回归测试见 `tests/orchestrator.test.js` "B1 回归"）。
- **工具描述与审计对齐**：`tree_verify`（六种模式、FAIL 不抛错/不阻断 succeeded、cwd 来自 exec）、`tree_dispatch`（dod 不生效、assignee.preset 不生效、接力 owner 重绑）、`tree_node`（里程碑面无工具命令、收口以 runtime.succeeded 为准）、`tree_report`（宿主 tokenMeter 已接入）、`tree_status`（harvest 语义）与实际实现对齐；启动日志版本号与 sweep 兜底说明修正（timer 服务缺失时仍有进程内 60s 间隔，sweepMode=timer）。
- **测试**：**67/67**（62 引擎 + 4 技能打包 `tests/skills.test.js` + 1 竹节 owner 回归）。
- ⚠️ 宿主半/配置热更：patch 行改动需对 `include:tree-engine` 做一次 disable→enable（Loader 按包名缓存宿主模块，见仓库 [agent.md](../../agent.md) D12）。

## v0.3（S1 第三批）——**8/8 工具面齐 + 验证层第一批**

- **工具面（全量 8 个）**：tree_plan / tree_node / tree_dispatch / tree_report / tree_status / **tree_verify** / **tree_log** / **tree_maintain**。
- **验证策略层第一批**（src/verify.js）：self-report / artifact（glob+minSize+regex+jsonSchema）/ command（退出码+超时硬杀=verdict fail）；策略装载期校验（未知 mode/缺 glob/run → 报错含键名不静默）；DoD 前置注入生成器（与验证器同模板）；AND 短路；端口 fail-closed。
- **核心命令补齐**：event:list、drift:append/list（三层纠偏枚举）、heartbeat:append/tail（哨兵巡逻）、communication:log/list（外部通信可观测，防心跳误判冻结）、nudge:reset、tree:register-session（旁路登记；重复登记以 E_SCHEMA_INVALID 拒绝，调用方按已存在处理）、backup/restore（状态内快照×10，恢复前快照+tree_id 匹配校验；文件级随 storageDomain 适配）。
- **测试**：**40 项全绿**。

## v0.3.1 增量（S1 第四批）：差分金标准落地

- **tests/diff.test.js**：同输入序列喂源引擎（`D:\Codes\tree-harness\tree-engine.cjs` 直连 require）与本引擎，投影逐字段深度相等——**首跑全链一致**（init → leaf add → brief_echo → set-context → segment append；非法输入三例行为一致）。
- **差分驱动修正**（源规则实测对齐）：path 精确规则（`path ≡ leaf_id 的 path 段`，如 'C1'）；root leaf `added_by=null`、`model/channel='unknown'`；源 `run(cmd, args, treesRoot?, caller?)` 签名。
- **冻结偏差登记**：[tests/diff.DEVIATIONS.md](tests/diff.DEVIATIONS.md)（D-v1 错误字段名 / D-v2 E_CALLER_REQUIRED 待移植 / D-v3 startup_notice 由派发提示词承担 / D-v4 完整性签名列尾批）。
- **测试**：**43 项全绿**。
- ⚠️ 工程教训：PowerShell `Set-Content` 会以系统编码毁 UTF-8 中文文件——测试文件一律用 write/edit 工具维护。

## v0.3.2 增量：五项 API 形状升级为源码级验证

经 `scripts/asar-tool.cjs` 直读 `app.asar` 实现源，修正宿主适配三处：
1. **dispatch 端口**按权威 `ContinuableStartSpec {provider*, label*, request{prompt: ContentBlock[]}, signal}` 传参，返回取 **childId**（原实现传参形状错误）；
2. **callerOf** → `exec.agent?.session`（dsh-tools 实证）；
3. **timer** → `ctx.timer` 直用（cordis-plugin-timer `ctx.mixin("timer")` 实证；保留 ctx.get 兜底）。

证据落盘：[docs/architecture/engine-spec.md §8](../../docs/architecture/engine-spec.md)；smoke 清单收窄至 5 项装载实测。

## v0.4.0 增量：对抗式验证(异族攻击-防御-审计迭代,≤3 轮)

- **tree_verify {action:"adversarial"}**:每轮 = 结构检查(既有 policy/taskType 路由)+ **异族红队攻击会话**(缺省 DeepSeek-V4-Pro,`TREE_ENGINE_JUDGE_ASSIGNEE` 可配;与执行者异族防同源偏置——随感 #33/#30)→ FAIL 则 findings 回注执行者修复 → 下一轮;≤max_rounds(1-5,缺省 3)。
- **裁决回收双通道**:文件握手为主(judge 把裁决 JSON 写引擎指定绝对路径,轮询文件——确定性免疫会话形状/时序)+ readSession ATTACK_VERDICT 提取为辅;超时 fail-closed(缺省 300s,`attack_timeout_ms` 30s–600s 可调,超时后终局再收一次)。
- **修复回注双路径**:①交棒通道 prompt 原执行者(父会话活)②**同叶自动重派修复会话**(原父会话死时兜底;轮询其 succeeded 再进下一轮,attempt 递增留痕)。
- **裁决落账**:`leaf:set-verification` 透传 rounds 逐轮(structural/attack/findings/fixed)。
- **hostGlob P0 修复**(advtx E2E 抓出):①'**' 零段匹配(顶层文件可命中)②返回绝对路径(此前相对路径按引擎进程 cwd 解析→ENOENT);Set 去重;单测回归(export hostGlob)。
- **E2E 四轮迭代实证(tree advtx)**:GLM worker 埋两雷(光速 10 倍错误 + 100% 夸大)→ DeepSeek 红队 100% 命中并挖出逻辑矛盾 → **全自动**(无人工干预)重派修复会话真实清除埋雷 → 复审;终态 3 轮 FAIL 属红队逐轮升级(攻强守弱),闭环每环均被观测。已知行为:对抗强度螺旋下 max_rounds 可能耗尽,终态 FAIL=如实反映"仍有可攻击点"。
- **测试**:61 项全绿(含攻防循环/结构跳过攻击/端口 fail-closed/rounds 落账/hostGlob 回归)。

## v0.3.9 增量：竹节简报回收 + 验证 batch-2 + usagePct + Config 校验 + 差分扩面（handoff §7 任务 3–8 主体）

- **K1–K5 交棒简报回收 + 宽限**（任务 4）：promptHandoff 发交棒指令后按 grace 轮询 readSession（上限 min(graceMs,12s)），防御性提取含 K1/K2/K5 标记的简报全文；超时/不可提取 → no-handoff-summary 降级。**E2E 真机实证（tree e2erly）：chain 0→2，bamboo(ok) 全文回收，attempt=1，succeeded**。
- **usagePct 宿主测量接入**（任务 5）：tokenMeter.measure（readSession 快照 → measure → pct/context.pct/pressure.pct 防御提取，0–1 归一）；首调用经 apply.log 冻结返回形状；任何失败返回 null → 自报信号生效（先到者生效）。
- **验证层 batch-2**（任务 6）：`llm-judge`（ports.judge 异族评审，rubric 必填，fail-closed）/ `composite`（checks[] 平铺 AND 链，嵌套 composite 装载期拒）/ `human`（approval=never 降级 = frozen 待裁：pass=false+pending，人工经 policy_id 显式覆盖裁决）。
- **Config schema 装载期校验**（任务 8，src/config.js）：TREE_ENGINE_CONFIG JSON 全键类型/范围校验，未知键拒绝；非法即装载失败（apply 终止、工具不注册），报错含键名；护栏键进 config、编排键进 orchestra 自动拆分。
- **差分扩面**（任务 7 主体）：52 组 LCG 生成调用序列（合法+非法混合）逐调用 ok 一致 + 终态投影一致；新冻结偏差 **D-v5**（源可恢复错误自动 drift）/ **D-v6**（源 leaf add 必填 model）登记 [diff.DEVIATIONS.md](tests/diff.DEVIATIONS.md)。
- **tree-worker SKILL 重写**（任务 3，`skills/tree-worker/SKILL.md`，v0.5.0 起位于本包 `packages/dsh-tree-engine/skills/tree-worker/SKILL.md`）：8 工具语法、开工四步/竹节协议/护栏表/一图流；**剔除 tree_leaf_autonomy_override 漂移引用**（用 drift 申报替代）。
- **E2E**：e2ev39（依赖闸+路由+validate 全过）+ e2erly（竹节 relay 专项，简报全文回收）。
- **测试**：**56 项全绿**（52 + 4：llm-judge 三态/human 降级+composite 展开/Config 校验）。剩余：observeSession 事件面（§7-9，宿主形状未冻结）与 llm-judge 宿主 judge 端口装配（评审会话派发）列下批。

## v0.3.8 增量：dependencies enforcement + taskType 验证路由（handoff §7 任务 1/2）

- **节点 `dependencies` 引擎侧 enforcement**：leaf:add 装载期校验（string[] / 存在性 / 自指 / 重复 / DFS 环检测纵深防御）；`dispatch:start` 前置依赖闸——所有依赖节点须 `status=done ∨ runtime.state=succeeded`，否则 `E_DEPENDENCY_NOT_MET`（含各依赖当前状态明细）。
- **`leaf.taskType` 验证策略自动路由**：leaf:add 存字段（字符串校验）；派发端口透传 taskType（DoD 注入按类型取模板）；tree_verify 缺省 policy_id 时按 `leaf.taskType → taskTypeMap → default` 解析（research/question→research-answer，doc→artifact-doc，code-change→code-change）；裁决经新命令 `leaf:set-verification` 持久化到 `leaf.verification{ts,policy_id,pass,verdicts}` + progress 事件观测。
- **E2E 真机实证（tree e2edep，单代际）**：B2 依赖 B1——B1 未完成时 dispatch B2 被拒（E_DEPENDENCY_NOT_MET 原文含状态明细）；B1 done 事件回流 succeeded 后同调用放行；B2 产物 [demo/e2edep-notes.md](../../demo/e2edep-notes.md)；verify 无 policy_id 路由至 artifact 模式（policy_id 落账为请求键 "doc"，verdicts.mode=artifact 证明模板命中）；validate 0 issues。
- **测试**：**52 项全绿**（47 + 5 新增：装载期拦截 / 环不误伤 / 依赖闸双向 / set-verification 落账 / taskType 校验）。
- ⚠️ 工程教训复现：pwsh `Set-Content -Encoding utf8` 仍引入 BOM + mojibake（GBK 读入）——文件改动一律 write/edit 工具，本轮已用 git checkout 恢复重做。

## v0.3 边界（诚实声明）

1. 装载 smoke 未做（同 v0.2：startContinuable/prompt/interrupt 形状、caller 提取、timer 注入——今晚装载后实测）；
2. 验证层第二批（llm-judge/composite/human）未实现——策略引用即装载报错（fail-closed）；
3. 节点级 verification.policy 解析未流经核心 bambooRelay spec（竹节接手提示词的 DoD 暂走 default 策略）；
4. command 模式经 child_process（宿主侧执行不经执行者 ✓）；DSH subprocess 服务适配为 smoke 后可选项；
5. backup/restore 为状态内快照（语义对齐：轮转 10/恢复前快照/跨树校验；文件级落盘随 storageDomain）。

## v0.2（S1 第二批）

- **核心**（`src/`，纯逻辑不 import DSH API）：v0.1 全部 + **编排层**——`dispatch:start/cancel`（runtime 状态机 pending→running→succeeded|failed|timeout|cancelled|frozen）、`sweep:tick`（超时硬截止 + lastOutputAt 收割时刷新误判保护 + 竹节自动接力）、竹节流程（K1–K5 简报指令 → **先 interrupt 后 dispatch** → 基准重置 → attempt 不变）、链长上限 frozen、sweep timer/degraded-lazy 双模式、`attachPorts` 热装配。
- **工具面**：tree_plan / tree_node / **tree_dispatch** / tree_report / tree_status（8 中的 5 个；tree_status 含 harvest 显式收割）。
- **持久化**：fsStore @ `<DSH_PROFILE_DIR>/tree-engine-data/`（tmp+rename 原子写）。
- **测试**：`node --test tests/*.test.js`（**33 项全绿**，含假时钟硬截止窗口断言、误判保护、竹节顺序铁律断言）。

## v0.2 边界（诚实声明）

1. `startContinuable` / `prompt` / `interrupt` 精确 spec 形状未 smoke——装载后 `tree_dispatch` 单节点实测修正（S1 smoke 清单第一项）；
2. usagePct 端口暂缺（tokenMeter 形状未定）→ 竹节依赖执行者自报 `tree_report {context}`（源引擎语义；宿主测量接入后先到者生效）；
3. 交棒简报全文回收未接入（v0.2 promptHandoff 返回 null → `no-handoff-summary` 降级接手；smoke 后经 readSession 提取 K1–K5）；
4. tree_verify / tree_log / tree_maintain 未注册（下一批）；
5. caller 会话 id 从 exec 尽力提取，缺 extraction 时 caller 校验操作 fail-closed。

## v0.1（S1 第一批）

- **核心**（`src/`，纯逻辑不 import DSH API）：闭集状态机 + done 三重闸 + 7-strike + macp2 护栏三件套 + UUID 严格校验 + caller 防借身份 + per-tree 串行队列 + 时钟注入缝 + 竹节触发/接力登记（42 阈值 + 链长熔断）+ `call()` 永不 throw 契约。
- **工具面**：tree_plan / tree_node / tree_report / tree_status（8 工具中的 4 个）。
- **测试**：`node --test tests/*.test.js`（24 项全绿）。

## v0.1 边界（诚实声明）

1. 持久化 = 进程内内存 store（storageDomain / 插件数据目录适配在下一批随 smoke 结论落地）；
2. tree_dispatch（subagents 派发 + 竹节自动接力 sweep）、tree_verify / tree_log / tree_maintain 未注册（下一批）；
3. caller 会话 id 从工具 exec 上下文尽力提取，提取不到时 caller 校验操作 fail-closed（E_BORROWED_IDENTITY）；
4. 路径一致性校验为简化判据（path 尾段 = leaf_id 去 prefix 层级），精确判据随差分测试冻结。

## 运行测试

```powershell
& 'C:\Users\sir_c\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' --test tests/*.test.js
```
