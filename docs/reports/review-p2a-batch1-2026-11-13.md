# 对抗式代码复核报告：D24 P2-A 批次（#8 / #15 / #20 / #21 / #22 / #28 / #30 + #23）

- 日期：2026-11-13
- 复核者：异族独立复核者（DeepSeek-V4-Pro，子会话）
- 对象：`D:\Codes\dsh-tree-harness` 未提交改动
  - `packages/dsh-tree-engine/src/{engine,guards,config,store}.js`
  - `packages/dsh-tree-engine/index.js`
  - `packages/dsh-tree-engine/tests/write-guards.test.js`
  - 新增 `packages/dsh-tree-engine/tests/audit-p2a.test.js`
- 基准报告：`docs/archive/flaudit-report.md`（33 条）
- 方式：只读 + 只跑测试 + 仓外临时脚本实证；**未修改任何现有源文件/测试/文档**，未改 git。

## 结论

**verdict：PASS_WITH_RISKS**

- P1：1 条；P2：3 条；P3：6 条；UNKNOWN：4 条。
- 核心判断：本批次 7 项修复**方向正确、无回归、测试 225/225**，但 **#8 的主旁路（自报 done → runtime.succeeded → 依赖闸放行，全程无验证）并未被真正闭合**——本轮只补了「verification.pass===false 拒绝」这一半，没补「必须 verification.pass===true 才放行」的另一半。因此最重的一条风险仍是 #8 原洞残留。

---

## 一、实际执行的命令与测试结果

```
cd D:\Codes\dsh-tree-harness
git status
git diff --stat
git diff
cd packages\dsh-tree-engine
node --test tests/*.test.js
```

测试结果（截取尾部）：

```
ℹ tests 225
ℹ pass 225
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 4398.0631
[status: completed, exit code: 0]
```

**基线 225/225 通过**，与期望一致。

另写仓外临时脚本（`%TEMP%\dsh-review-p2a-verify.mjs`，已删除）实证两条关键假设：

```
[#8] C1 dispatch ok: true session: sess-1
[#8] owner self-report done ok: true
[#8] C1 after done: status= pending_brief runtime.state= succeeded verification= null
[#8] C2 dispatch WITHOUT any verification on dep: true (UNBLOCKED — #8 primary bypass still open)
[#21] init with audit_meta node_budget=500 ok: true
[#21] state.audit_meta.node_budget = 500
[#21] uplift drift present: true
[#21] leaves added before budget hit: 4 lastErr= E_NODE_BUDGET_EXCEEDED (cfg.node_budget=5 enforced → audit_meta 500 is inert for node_budget)
```

---

## 二、逐条结论

| 条目 | 修复内容摘要 | 复核结论 |
|---|---|---|
| #8 | 依赖闸加「verification.pass===false 拒绝」+ sweep 回流加 stale-done 判据 | **部分修复（主旁路未闭合，P1）** |
| #15 | verdicts/pass AND 一致性 + 形状校验 | **已修复（残留 P3）** |
| #20 | 接力前预算探针 + 接力后冲突回滚 + 单账本口径 | **已修复（残留 P3）** |
| #21 | audit_meta 严格校验 + 放宽留痕 | **已修复（误导性留痕 P2）** |
| #22 | subagent_spawn 仅 owner | **已修复（无合法面破坏）** |
| #28 | fsStore .tmp 灾备恢复 | **已修复（静默无留痕 P2）** |
| #30 | tree:gc + call-log 滚动 | **已修复（残留 P3）** |
| #23 | 阈值回退键名死回退 | **已修复** |

---

## 三、发现明细（P1 / P2 / P3）

### P1-1（#8 主旁路未闭合）：依赖闸仍接受「无验证的自报 done → succeeded」

- **位置**：`src/engine.js:596-597`（`depState`：`if (dep.status === 'done' || dep.runtime?.state === 'succeeded') return 'done'`）；配合 `src/engine.js:451-454`（`event:append done` → `runtime.state='succeeded'`）。
- **触发条件（FACT，已实证）**：worker（owner）对自身 leaf 自报一条 `done` 事件（仅需 owner 身份，无任何 milestone/verification 闸）→ `runtime.state` 被置 `succeeded`；随后任何 `dependencies` 指向它的下游 leaf 派发，依赖闸判定 `depState==='done'`，放行。
- **影响**：原审计 #8 的「严重」级信任边界洞本质未闭合——`done 三重闸`（done 事件 + milestones 全 audit_pass + status done）依然只守 `set-status done` 正门；编排主路径（依赖闸）仍把「自报 done 翻出的 succeeded」当作结算信号。本轮只堵了「已 FAIL 仍放行」，没堵「从未验证也能放行」。verified-FAIL 之后的 `verification.pass===false` 拦截生效，但 `verification === null`（从未跑过 tree_verify）时照常放行。
- **建议修复**：依赖闸应要求**正向判据**——`dep.verification?.pass === true`（或 `dep.status === 'done'` 走三重闸正门），而非仅「非 FAIL」。即：`if (dep.verification?.pass === true) return 'done'`（配合 status done 兼容），`verification` 缺省/非 true 一律 `not_done`。此改动会把「无验证 happy path」从放行改为拦截，需同步确认既有多层编排用例（tests 与 skills）是否依赖「无验证即放行」的旧语义（见 UNKNOWN-3）。

---

### P2-1（#8 stale-done 判据脆弱）：`>=` 等值放行 + 非单调墙钟

- **位置**：`src/engine.js:769-771`。
- **触发条件**：
  1. **时钟回拨**：`rt.dispatchedAt = clock.now()`（生产 = `Date.now()`，非单调，flaudit #31 已点名）。NTP 回拨后重派，`dispatchedAt` 变小，旧 attempt 的 done 事件 `ts >= dispatchedAt` 恒真 → 旧 done 被误判为当前 attempt 的结算信号，新 attempt 直接 `succeeded`。
  2. **同毫秒等值**：`doneEvent.ts`（ISO 毫秒精度）与重派后 `dispatchedAt` 相等时，`>=` 放行。同一毫秒内「旧 done + 立即重派」会把旧 done 回流到新 attempt。
- **影响**：stale-done 防护是 best-effort，两个窄窗口可使其失效，重派后的节点被错误判 succeeded（早结算 / 假结算）。属 INFERENCE（未实证复现，依赖真实时钟回拨或同毫秒竞态）。
- **建议修复**：done 事件落账时记录 `attempt` 序号（或重派时归档/清空旧 done 事件），比较用 attempt 而非墙钟；或 `>` 严格大于 + 超时基准改单调钟（与 #31 一起收敛）。

---

### P2-2（#21 放宽留痕误导）：非 `ctx_segment_threshold` 的 audit_meta 键被标记「已放宽」但实际 inert

- **位置**：`src/config.js:82-84`（uplift 收集，对所有数值键 `v > base` 即标记）；`src/engine.js:411`（全仓库唯一消费 `state.audit_meta` 的位置，只读 `ctx_segment_threshold`）。
- **触发条件（FACT，已实证）**：`init(..., { node_budget: 500 })` → 通过校验、写入 `state.audit_meta.node_budget=500`、产 `security/high` drift「audit_meta uplift: node_budget 20 -> 500」。但 `activeLeafBudget`/`sessionBudget`/`spawnBudget` 等护栏读的是 `cfg`（引擎构造期配置），**不读** `state.audit_meta`。实测 `cfg.node_budget=5` 时第 5 个 leaf 即 `E_NODE_BUDGET_EXCEEDED`，audit_meta 的 500 完全未生效。
- **影响**：① 审计记录失真——drift 声称「guard relaxed」，实际护栏未被放宽（方向是 fail-safe，不构成提权，但污染审计真相）；② 反向语义缺口——guards.js 头注释宣称「全部可被 audit_meta / Config 覆盖」，实际只有 `ctx_segment_threshold` 被接线，若意图是 audit_meta 可逐树覆盖全部护栏，则其余护栏静默忽略覆盖（见 UNKNOWN-2）。
- **建议修复**：二选一——(a) 让 uplift 检测只对**真正被消费**的键生效（当前仅 `ctx_segment_threshold`），其余键要么拒收要么改注「recorded-only, not enforced」；(b) 若设计意图是 audit_meta 全量覆盖，则把 `activeLeafBudget/sessionBudget/spawnBudget/relay/segment` 的 `cfg` 参数替换为 `state.audit_meta`（每树读取），并在 docs 明示。

---

### P2-3（#28 静默恢复无审计留痕）

- **位置**：`src/store.js:69-78`（`read` 的 `.tmp` 回退）。
- **触发条件**：主文件损坏（半截 JSON / 外部写坏）→ `read` 静默返回 `.tmp` 副本，**不产生任何 drift / call-log / security 事件**；下一次 `write` 会用恢复后的 state 覆盖主文件，「修复」损坏现场。
- **影响**：① 运营/审计方无从知晓「发生过损坏并被自动恢复」；② 被覆盖的主文件即损坏的取证物，覆盖后取证信息永久丢失。对安全/审计敏感系统，静默灾备恢复属于「恢复无痕」。属 FACT（代码路径确定无留痕）。
- **建议修复**：`.tmp` 回退发生时，向 `state.drift_log`（或独立 `recovery_log`/call-log）追加一条 `kind:'security', severity:'high', action:'declare'` 记录（含恢复来源路径与 hash），并在回写主文件前保留损坏原件的 `.corrupt` 副本。

---

### P3-1（#20 自链重复不被 relay 冲突检查拦截）

- **位置**：`src/engine.js:719`（`findSessionConflict(state, session.sessionId, leaf.leaf_id)` 排除当前 leaf）。
- **触发条件**：宿主/适配层在接力时返回一个**已在本 leaf 自身历史**（`segment_chain`/`runtime.segmentChain`/当前 `session_id`）里的 session id（例如复用被 interrupt 的旧 id）。排除当前 leaf 后，冲突检查不命中，`rt.segmentChain.push` 会写入重复 id。
- **影响**：节点在「旧会话已被 interrupt」的情况下继续自认 running（绑定的还是那个已死会话），最终超时；`validate` 事后报 `session_duplicate`。属 INFERENCE（需宿主返回异常 id）。非跨 leaf 越权，severity 低。
- **建议修复**：relay 冲突检查在 `excludeLeafId` 之外，额外断言「新 id 不等于当前 `rt.subagentSessionId` 且不在本 leaf 既有 chain 内」。

---

### P3-2（#30 gc 破坏面与审计事件裁剪）

- **位置**：`src/engine.js:1013`（keep 钳 0-500）、`1027-1038`（events 保留 done + 尾部 keep、drift/history 仅尾部 keep）。
- **触发条件**：`keep=0`（schema 允许 number，钳后合法）→ archived leaf 的 `drift_history`/`runtime.history` 全部清空、非 done 事件全清；`keep>0` 时 `subagent_spawn/blocked/plan/progress` 等非 done 事件超出尾部 keep 即被裁剪。
- **影响**：`subagent_spawn`（预算历史）、`blocked`（升级历史）等审计事件被裁剪——与「done 事件作为审计锚点」只保护 done 的取舍一致，属**有意的破坏性维护**（root-only 授权兜底）。属设计取舍而非缺陷，但 `keep=0` 的破坏强度应至少要求显式确认。属 FACT（代码路径确定）。
- **建议修复**：`keep` 下限由 0 提为 1（拒绝 0），或 keep=0 需额外 `confirm` 参数；文档明示非 done 审计事件会随 gc 丢失。

---

### P3-3（#15 空 verdicts 允许 pass=true 无证据）

- **位置**：`src/engine.js:312`（`if (result.verdicts.length > 0)` 才做一致性检查）。
- **触发条件**：`{ pass: true, verdicts: [] }`（或省略 verdicts）→ 跳过一致性校验，落 `verification.pass=true`。
- **影响**：creator/root/delegate（本就有权写 verification 的受信方）可记录「无任何 per-mode 证据的 PASS」。不构成越权（写权已在 D23 收敛），但使「pass 与 verdicts 一致性」这一 #15 目标在空 verdicts 下形同虚设。属 FACT。
- **建议修复**：若目标是「PASS 必须有 ≥1 条 pass verdict 佐证」，则要求 `verdicts` 非空；否则在注释明示「空 verdicts = 受信方无证据自证」。

---

### P3-4（#21 audit_meta 接受 orchestra 键但 inert）

- **位置**：`src/config.js:32-48`（`validateConfig` 对 `audit_meta` 同样接受 `nodeTimeoutMs/sweepIntervalMs/graceMs/bambooThresholdPct` 等编排键）。
- **触发条件**：`audit_meta: { nodeTimeoutMs: 1000 }` → 通过校验写入 state，但 `orchCfg` 来自 `opts.orchestra`，audit_meta 里的编排键永不消费。
- **影响**：inert（fail-safe，无法放宽任何东西），但属静默接受的无效输入。属 FACT。
- **建议修复**：`validateAuditMeta` 用「护栏键子集」而非全量 `CONFIG_SCHEMA` 校验，编排键显式拒收。

---

### P3-5（call-log 滚动并发与 keep 浮点）

- **位置**：`src/store.js:98-105`；`index.js` `tree_maintain` 的 `keep: {type:'number'}`。
- **触发条件**：① 多写者并发 `appendCallLog` 同时触发滚动，`rename(p, p+'.1')` 一者失败（`.catch(()=>{})` 吞掉），随后两路 `appendFile(p)`（O_APPEND）——当前行不丢，但 `.1` 仅保留 1 份，历史被压缩到 ~2 段（设计如此）。② `keep` 传浮点（如 `2.5`）→ `Number.isInteger` false → 静默取默认 20，非报错。
- **影响**：观测层不影响业务（双层吞错）；属边界体验而非安全。属 FACT。
- **建议修复**：`keep` schema 改 `integer`；滚动注释明示「仅保留 1 份历史」。

---

### P3-6（#22 无合法调用面破坏——已确认无回归）

- **位置**：`src/guards.js:164`、`174-183`。
- **结论（FACT）**：全仓搜索 `subagent_spawn` 写入点，仅 `src/engine.js:437`（eventAppend，owner 自报）与测试；无任何宿主/装配层「代 owner 写 subagent_spawn」的既有调用。故改为 owner-only 不破坏合法调用面，且正确封堵 creator/root 向他人 leaf 注入 15 次 spawn 事件的预算 DoS。**本条无遗留问题**。

---

## 四、UNKNOWN（我验证不了/需裁决）

1. **「两本账互斥」的精确口径**：`engine.js:730-733` 注释称「validate F1③ 强制同一 id 不得同时出现在两本账」。实际 `validate`（`engine.js:536-544`）只做通用 `session_duplicate` 去重（`seen` Map + `selfChainSeen` 豁免当前 owner 一次），并无名为「F1③」的专用跨账本互斥断言。合并 `segment_chain`/`runtime.segmentChain` 会改变已冻结的 validate 语义——是否合并需用户裁决，本复核未展开。
2. **audit_meta 的设计意图**：guards.js 头注释「全部可被 audit_meta / Config 覆盖」与实际「仅 ctx_segment_threshold 被消费」不一致。若意图是「audit_meta 逐树覆盖全部护栏」，则其余护栏存在静默忽略覆盖的语义缺口（连带 P2-2）；若意图只是「记录快照 + 仅阈值可覆盖」，则 uplift 检测与注释需收敛。我无法判定原始意图，标记 UNKNOWN。
3. **若采纳 P1-1 建议（依赖闸要求 verification.pass===true）的回归面**：会改变「无验证 happy path」行为，可能影响依赖「自报 done 即放行下游」的既有编排/测试/技能。需全量回归确认（本复核未改代码、未做此回归）。
4. **`.tmp` 陈旧副本状态回退**：在遵守 `.lock` 文件锁纪律（单写者）下，`.tmp` 仅短暂存在于「writeFile→rename」之间，理论上永不比主文件旧；只有绕锁并发写（flaudit #1 域）才会读到陈旧/混杂 `.tmp`。属低置信理论风险，未实证。

---

## 五、总体评价

- **正向**：本批 7 项修复实现质量整体扎实，校验均 fail-closed、留痕方向正确、无回归（225/225）；#15/#20/#22/#23 基本闭合；#28/#30 从「不可恢复/无界」变为「可恢复/有界」。
- **最需跟进**：P1-1（#8 主旁路未闭合）——本轮只补了「FAIL 拒绝」，未补「PASS 才放行」，原审计标记「严重」的信任边界洞仍然存在；建议下一批优先按「正向 verification.pass===true 判据」收口，并同步评估回归面（UNKNOWN-3）。

---

## 六、复核跟进（2026-11-13 D25 收口记录）

接手会话 `D25-AUDIT-P2A-FINISH` 按本报告跟进，收口情况如下（全部改动见分支 `wip/d24-p2a-batch1`，合回 master 前 225/225 + 门禁全绿）：

### P1-1（#8 主旁路）——已闭合，选型说明

- **最终形态**：`dispatch:start` 依赖闸只认**正向结算信号**：`dep.status === 'done'`（三重闸正门）**或** `dep.verification?.pass === true`；`verification.pass===false` 永不放行（保留）；**裸 `runtime.state==='succeeded'` 不再结算依赖**。中途态的 `require_dependency_verification` 配置开关（缺省关）已删除——信任闸不提供「配置即可 reopen」的降级口（原审计 #8 定级「严重」，可配置回退等于把洞留在默认路径上）。
- **取舍**（D25 二次复核 P3-6 措辞更正）：复核者两备选——①「依赖闸只认 status==='done'」：会把「`tree_verify` PASS 后指挥官推进下游」这一正常操作契约也拦死（下游派发将强制要求额外一次 `leaf:set-status done`），且与既有 verify-delegate 流程冲突面更大；②「done 事件回流过 milestone 闸」：`assertMilestoneGate` 对空 milestones = **REJECT**（D25 二次复核指正：本报告初版此处写「对无 milestones worker 仍留洞」是**事实错误**——不是留洞，是把普通 worker **永久拦死**），同样不可操作。故取**两路正向判据并集**：三重闸（人工/编排显式收口）与验证 PASS（机器裁决落账）都是强信号，缺一不放行。二次复核进一步观察：milestones 无工具写入命令、`status=done` 路径经工具面实际不可达，**有效判据实质 = `verification.pass===true`**，比本节文字表述更严（安全结论不变）。
- **信任模型影响（UNKNOWN-3 回答）**：「无验证 happy path」从放行改为拦截。回归面实测：既有 225 用例中仅 `engine.test.js` 依赖闸用例的最后一段依赖旧语义（runtime.succeeded 直改放行），已按新契约改写为「拦截 → 落 PASS → 放行」；`audit-p2a` #8 用例天然兼容（FAIL 拒 / PASS 放）。操作契约同步：`tree-commander` SKILL §切分判据与错误码表、`skills-usage.md` §9、包 README v0.10.0 节、CHANGELOG——指挥官推进下游前的标准动作 = 收割上游 → `tree_verify` 落 PASS → 再派。

### P2-2（#21 误导留痕）——已闭合（取建议 (a) 的拒绝分支）

`validateAuditMeta` 只允许**真正被逐树消费**的 `ctx_segment_threshold` 放宽（留 drift）；recorded-only 键（`node_budget` 等）的上调一律 `E_SCHEMA_INVALID`（message 标 recorded-only）；编排键显式拒收（顺带闭合 P3-4）。未取建议 (b)（audit_meta 全量接线）：护栏逐树覆盖会把「部署级护栏」降格为「任何 init 调用方可变」，与 #21 的 fail-closed 方向相悖；部署方放宽走 `TREE_ENGINE_CONFIG`，由 init 的 `config uplift` 留痕兜底。

### P2-3（#28 恢复无痕）——已闭合

损坏路径恢复：先复制损坏原件为 `.corrupt-<时间戳>` 取证副本（下次 write 覆盖主文件前保住现场），再向 `call-log.jsonl` 追加 `state.recovered`（来源 / 损坏副本路径 / 解析错误摘要，双层吞错铁律保持）。取 call-log 而非 `state.drift_log`：`read` 必须保持只读（恢复发生在读路径，写 state 会引入锁序问题）。测试补齐留痕断言（audit-p2a #28 用例 (a)）。

### P3-3（空 verdicts 无证据 PASS）——已闭合

`leaf:set-verification`：显式空 `verdicts` + `pass:true` → `E_SCHEMA_INVALID`（无证据 PASS）；省略 `verdicts` 的旧调用（受信方自证）保持兼容（verify.js 各模式实际产出恒带 verdicts；adversarial 透传路径实证不受影响——其真实产出恒含 llm-judge 项）。

### 未跟进（登记后续批次）

P2-1（stale-done 的 `>=` 等值/时钟回拨窄窗口）、P3-1（relay 自链重复）、P3-2（gc keep=0 破坏强度确认）、P3-5（call-log keep 浮点/并发）、UNKNOWN-1（两本账互斥口径裁决）、UNKNOWN-4（`.tmp` 陈旧副本理论风险）——按本报告 §三 原建议留 batch2，不在本批扩散。

### D25 二次复核（收口验证，2026-11-13 20:5x）

- **复核者**：异族独立子会话（deepseek-official / **deepseek-v4-pro**，只读 + 门禁复跑；前任死于 opencode-go 429 周配额，本轮按交接纪律改用 deepseek-official 通道）。
- **verdict**：**PASS_WITH_RISKS（无新增 P1/P2，P1-1 确认真闭合）**。
- **门禁复跑全绿**（复核者独立执行）：tests 225/225 · release-gate 14/14 · check-version-consistency 23 checks OK（1 WARN：project-map 3 处历史段 v0.7.0/0.8.0，属设计内白名单观察项）· doc-links OK · md-tables OK · `require_dependency_verification` 零功能残留（仅 agent.md/本报告历史叙述）。
- **关键确认**：① #8 新闸三重证据——裸 `runtime.succeeded` 不再结算；verification 写面 owner=false（creator/root/delegate 才可写，且 `leaf:set-verification` 不是工具 action，只能经 `tree_verify` 内部落账）；`status=done` 工具面不可达（`assertMilestoneGate` 空 milestones=REJECT，milestones 无工具写入命令）——**有效判据实质 = `verification.pass===true`，比「两路并集」文档表述实际更严**；② #21 fail-closed 且部署路径未误伤（config 侧 `TREE_ENGINE_CONFIG` 放宽的 init `config uplift` 留痕第二来源仍工作）；③ #28 优先恢复语义未破坏（copyFile/appendCallLog 均 best-effort，异常不抛穿）；④ #15 两条落账路径（普通/adversarial）兼容空-verdicts 校验；⑤ 三处测试为「加强/按更严契约重写」，无弱化凑绿。
- **二次复核新发现（全部 P3，登记 batch2）**：
  - P3-6 选型理由事实错误（已当场更正：engine.js 注释 / CHANGELOG / agent.md / 本报告 §四处——「milestone 闸回流对无 milestones worker 留洞」系误写，实际 = `assertMilestoneGate` 空 milestones REJECT 即**永久拦死**）；
  - P3-7 #28 ENOENT+.tmp 恢复（主文件缺失分支）仍无留痕，「恢复不再静默」仅覆盖损坏路径；
  - P3-8 `.corrupt-<ts>` 副本永不清理 + 并发同毫秒同路径/重复日志；
  - P3-9 pruned 依赖但 `verification.pass===true` 仍放行下游（非回归，新门比旧门严；是否排除 pruned/archived 依赖待裁决）；
  - P3-10 config-uplift 基线不一致（`ctx_segment_threshold` 引擎缺省 42 vs `DEFAULT_GUARDS` 85）——预存在；
  - P3-11 测试覆盖缺口：`createAdversarial → record → setVerification` 无端到端用例；config uplift 第二来源无专项断言；
  - P3-12 agent.md D25 行悬空引用（**已当场消解**：本节即二次复核结论与 D12 活体读数正文）；
  - P3-13 project-map 3 处历史版本漂移 WARN（历史快照段，设计内可接受）。

### D12 受控重载活体读数（2026-11-13 20:53，本会话实机）

- `plugin_manager set_bundle @local/dsh-tree-engine` disable（applied，tree Skill 即时下架）→ enable（applied，Skill 即时回挂）——HMR 热更不可靠面（#13207）按纪律规避。
- `tree_doctor {action:"run"}` → **7 checks · pass=7 warn=0 fail=0 · version=0.10.0**；带 `tree_id:"d25gcq"` 复跑同读数（树校验通过）。
- `tree_maintain {action:"gc", tree_id:"d25gcq"}` → **ok（gc archived=0 keep=20 events_cut=0 drift_cut=0 history_cut=0）**；`tree_log {action:"drift"}` 读到 1 条 `kind=security severity=low action=limit reason="gc: archived leaves trimmed (keep=20) …"`——新 gc 代码路径与留痕活体确认（非破坏探针：0 archived）。
- 探针树 `d25gcp`（首建，root session 为 null → gc 正确拒 `E_BORROWED_IDENTITY`，顺带验证 root-only 授权失败路径）与 `d25gcq` 留存运行时数据目录备查；无业务树被触碰。
