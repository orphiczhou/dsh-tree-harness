# v0.8.0 独立真机 E2E：per-leaf relay 开关 / auto 回归 / set-relay 权限 / usagePct / sweep 生命周期（2026-11-12）

> 任务：共享任务板 `task-5`。执行者：teammate `e2e-verifier`（会话 `c82a74aa-01f9-4077-9548-a87c96daeba6`）。
> 环境：DSH `0.2.2-rc.1` · profile `desktop` · tree-engine **v0.8.0** 活体（`include:tree-engine` 于 2026-11-12T09:52:10Z 重载，apply.log `apply() entered (v0.8.0)`）· flow-engine M1 活体 · `sweepMode=timer`（无宿主 timer 服务 → 进程内 60s interval 兜底）。
> 测试树：`rly8a`（off）· `rly8b`（auto / 定时 sweep）· `rly8c`（auto / harvest 显式）——**全部保留作证据**，未动 `s1rl1` / `wave1` / `wave2`。
> flow run：`RLY8A-R1`（succeeded）· `RLY8B-R1`（cancelled）· `RLY8C-R1`（cancelled）。
> 证据目录：`%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\`（apply.log / `<tree>\tree-state.json` / `call-log.jsonl`）、`D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\`（journal）、快照 `D:\Codes\_composition-research\e2e-relay-switch\snapshot-20261112-180925\`。
> 纪律：只读其它文件；未改 profile、未装/重载插件、未 commit；写作用域仅本报告 + 上述 scratch。

---

## 0. 结论先行（逐项判决）

| # | 验证项 | 判决 | 一句话证据 |
|---|---|---|---|
| 1 | **relay:'off' 生效**（P0-A） | **PASS** | `rly8a` leaf `relay=off`（09:58:49.512Z 设置，早于 flow 启动）；flow `RLY8A-R1` 跑满 **315.4s** 到终态 **succeeded / integrity=verified**（N1 117873ms + N2 197579ms），期间 ≥5 次定时 sweep + 1 次 harvest 均未触发 relay：`runtime.segmentChain=[]`、`drift_history` 无 bamboo、`tree_status harvest` 返回 `rly8a:∅` |
| 2 | **auto 回归**（默认 auto → relay 复现） | **PASS** | `rly8b`：定时 sweep 触发 `bamboo relay #1`（09:59:23.053Z，to `233ae416`），`segmentChain=[233ae416]`，flow `RLY8B-R1` journal `run/ended status=cancelled / error=E_RUN_CANCELLED / durationMs=19126`；`rly8c`：**harvest 显式触发** `rly8c:bamboo(ok)`，drift `bamboo relay #1`（10:06:20.647Z），flow `RLY8C-R1` `cancelled / E_RUN_CANCELLED / durationMs=24857` |
| 3 | **set-relay 权限面** | **PASS** | creator：`rly8a` 显式设 off 返回 ok（09:58:49.512Z）；root：`rly8b`（root leaf session=`c82a74aa…`）auto→off→auto 往返 ok；owner 负例：leaf 会话自行 set-relay → `E_BORROWED_IDENTITY: caller "94b72a19" cannot write relay on leaf "rly8a-C1-flow" (allowed: creator\|root) — borrowed identity rejected`；非法值：`E_SCHEMA_INVALID: relay "on" must be "auto" or "off"`；工具 schema 枚举 `['auto','off']`（index.js:530-533，单测 A9 锁定） |
| 4 | **usagePct 修复**（P0-B） | **PARTIAL（finding）** | **服务获取已修好**：v0.8.0 首次调用报错从旧版 `cannot get property "tokenMeter" without inject` 变为 `tokenMeter.measure unavailable: session.snapshotEvents is not a function → self-report only`（09:59:09.764Z）——证明 `resolveTokenMeter` 已成功拿到 tokenMeter 并真正调用了 `measure()`；**但 `measure(snap)` 入参契约不匹配**（readSession 快照无 `snapshotEvents` 方法）→ `usagePct` 仍恒 null，`tokenMeter.measure shape:` 日志 0 条，竹节仍只由自报驱动 |
| 5 | **sweep 生命周期**（P1-C） | **PASS（v0.8.0 侧）/ UNKNOWN（单实例绝对证明）** | 每次 v0.8.0 apply 均 `previous sweep disposed (hot-reload zombie)`（共 5 条 = 5 次 v0.8.0 apply）；**升级前 v0.7.0 僵尸**（Lead 已定位 09:44:23/30/37/44 四次 HMR）仍在本进程内以 `inactive context` 报错，测试期间 apply.log `inactive context` 由 24 → **188**（+164 全为旧实例，见 §7）；"同 profile 仅一个活跃 sweep 循环"未能从工具面直接证明（UNKNOWN + 可复核方法见 §7.4） |
| 6 | **回归** | **PASS（含 1 项新发现）** | `tree_doctor{action:"run"}` 两次均 `7 checks · pass=7 · version=0.8.0`；`tree_status validate rly8a` → **PASS 0 issues**；**`rly8b`/`rly8c` validate FAIL**（`session_duplicate: runtime.segmentChain duplicates rly8b-C1-flow`，且工具面被 `TypeError` 掩盖）——经 `s1rl1` 复现确认是 **v0.7.0 W2.1 存量校验缺陷**（任何竹节接力过的 leaf 必触发），非 v0.8.0 回归；单测 **145/145**（Lead 已跑；本报告另有独立复跑结果见 §8.3） |

**一句话判决：v0.8.0 的三个 P0/P1 目标中，P0-A（per-leaf relay 开关）真机 PASS 且效果强于预期（长 flow 全程穿越多次 sweep 不被中断）；P1-C（sweep 注册表）对 v0.8.0 自身实例 PASS、但升级前旧僵尸只能靠重启 DSH 清除（已知边界）；P0-B（usagePct）服务获取已修好、measure 调用契约仍不匹配（finding）。**

---

## 1. 测试设计（实际执行）

三棵树均为 root + 1 个 commander leaf，leaf 由本会话（`c82a74aa…`）创建（creator），`rly8b`/`rly8c` 另把本会话写入 root leaf（root 身份），用于分别验证 creator 与 root 写权。

| 树 | leaf | relay 设置 | 触发方式 | flow | 目的 |
|---|---|---|---|---|---|
| `rly8a` | `rly8a-C1-flow`（session `94b72a19…`） | 派发后由 creator 设 **off**（09:58:49.512Z，flow 启动前 9.1s） | 1 次 harvest + ≥5 次定时 sweep | `RLY8A-R1`（2 串行 session 节点，各 ≥1200 字） | off 不触发 relay，flow 应跑完 |
| `rly8b` | `rly8b-C1-flow`（session `2088fb0c…`） | 默认 **auto** | 定时 sweep 自主触发 | `RLY8B-R1`（同型） | auto 复现 S1：relay 打断 flow |
| `rly8c` | `rly8c-C1-flow`（session `d3225e54…`） | 默认 **auto** | **harvest 显式触发** | `RLY8C-R1`（1 节点 ≥1200 字） | 任务要求的 harvest→relay 路径 |

- 派发 prompt 均为严格三步/四步：① `tree_report{action:"context",pct:45}`（自报 > 阈值 42）；② （仅 rly8a）owner 自设 set-relay 负例探测；③ `flow_run{runId, flow:<inline DSL>}`（gate-free、inline `flow` 参数——`flowPath` 有 runCwd 围栏）；④ `tree_report{action:"event",type:"done"}` 回报。
- 全部 flow DSL 内联（`storage.configSource:"config"`、`flowSource.kind:"inline"`、`runCwd:"D:\Codes\dsh-tree-harness"`，见 journal `run/created`）。
- 旧僵尸干扰为已知变量（§10），所有结论以 **flow journal 终态 + tree-state 的 segmentChain/drift + 新会话 id** 为主证据，不以日志噪声下结论。

---

## 2. 用例 A：`relay:'off'` 不触发竹节，长 flow 跑满终态 → **PASS**

### 2.1 关键时间线（UTC）

| 时间 | 事件 | 证据 |
|---|---|---|
| 09:57:40.305 | 建树 `rly8a` | tree-state `created_at` |
| 09:58:38.719 | 派发 leaf，会话 `94b72a19` | `call-log.jsonl` `dispatch:start ok` |
| 09:58:46.044 | leaf 自报 pct=45 → `segment_pending` | drift：`context_usage_pct 45% >= threshold 42%, auto segment_pending (bamboo-joint handoff)` |
| **09:58:49.512** | **creator 设 `relay:"off"`（ok）** | rly8a `call-log.jsonl`：`{"ts":"2026-11-12T09:58:49.512Z","cmd":"leaf:set-relay","ok":true,"caller":"c82a74aa-…"}` |
| 09:58:58.599 | flow `RLY8A-R1` 创建（在 relay=off 之后 9.1s） | journal `seq=1 run/created` |
| 09:58:58.641 | N1 spawn（会话 `88dfd7e6`） | journal `seq=9 node/spawned N1` |
| ~09:59:50 | **我发起 `tree_status{action:"harvest"}`**（全树 sweep） | 工具输出：`rly8a:∅`（另见 §2.3） |
| 10:00:56.483 | N1 succeeded（**117873ms**） | journal `seq=10 node/settled N1 status=succeeded` |
| 10:00:56.529 | N2 spawn（会话 `6d96e839`） | journal `seq=13 node/spawned N2` |
| ~10:04:14 | N2 succeeded（**197579ms**）→ `run/ended succeeded` | flow journal；leaf 回执原文 |
| 10:04:21.482 | leaf 上报 done，runtime → succeeded | tree-state `events[0].ts` |

### 2.2 终态证据（原文）

`flow_status RLY8A-R1`：

```text
flow_status RLY8A-R1: succeeded (rly8a.flow, engine=flow-core@5a313fe9) integrity=verified perm=safe
- N1 [session] succeeded session=88dfd7e6-4d0c-4959-9c91-edc005896671
- N2 [session] succeeded session=6d96e839-337a-4aa7-a1dc-2164f69910b5
```

leaf 回执（会话 `94b72a19` 消息，原文节选）：

```text
flow_run RLY8A-R1: succeeded (RLY8A relay-off E2E: 2 serial long session nodes, engine=flow-core@5a313fe9) integrity=verified perm=safe
- N1 [session] succeeded session=88dfd7e6-… 117873ms
- N2 [session] succeeded session=6d96e839-… 197579ms
```

tree-state（`…\tree-engine-data\rly8a\tree-state.json`，字段原文）：

- `leaves["rly8a-C1-flow"].relay = "off"`
- `runtime.state = "succeeded"`，`runtime.subagentSessionId = "94b72a19-…"`，**`runtime.segmentChain = []`**、`runtime.history` 无 `bamboo-relay` note
- `drift_history` 仅 1 条 = set-context 的 `auto segment_pending`（09:58:46.044Z），**无 bamboo relay 记录**
- `events[0] = {type:"done", ts:"2026-11-12T10:04:21.482Z", meta.summary:"OWNER_SET_RELAY=E_BORROWED_IDENTITY: …; FLOW_STATUS=succeeded (RLY8A relay-off E2E: …)"}`

### 2.3 为什么这条证据强

- flow 运行 **315.4s**，覆盖 **≥5 个 60s 定时 sweep 周期 + 1 次显式 harvest**（全树串行 sweep），每一次都读到该 leaf `runtime.state=running`、`context_usage_pct=45 ≥ 42`；若 off 未生效，按 S1 行为第二次 sweep 内即会 interrupt 旧会话。实测 `segmentChain=[]` + flow succeeded 证明 **off 分支在这些 sweep 中被执行**。
- 附带：**owner 自设被拒**（负例）发生在 flow 启动之前，不影响后续 `relay:off` 的持久状态（tree-state `relay:"off"`）。
- 反例对照组（同一构建、同型 leaf、auto）：`rly8b` 在 pct=45 后 **第一次定时 sweep 即 relay** 并取消 flow（§3）。

---

## 3. 用例 B1：auto + **定时 sweep 自主**触发 relay → 复现 S1（PASS）

### 3.1 证据链（causal chain）

同一次 60s 定时 sweep（09:59:09.7）内：

1. `usagePct` 被调用（当前 v0.8.0 实例，见 §6）→ 返回 null → 回落自报 `pct=45`；
2. `pct(45) ≥ 42` 且 `role=commander ≠ root` → `bambooRelay`：
   ```
   2026-11-12T09:59:22.994Z handoff brief: grace 12000ms expired for 2088fb0c → no-handoff-summary
   ```
   （`promptHandoff` 于 ~09:59:10.99 成功发出，12s 宽限到期 → 无简报照常接力）
3. interrupt 旧会话 `2088fb0c` → flow 被取消 → dispatch 新会话 `233ae416`。

### 3.2 终态证据

flow journal `RLY8B-R1.jsonl`（`D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\RLY8B-R1.jsonl`）：

```json
{"seq":10,"event":"node/settled","payload":{"nodeId":"N1","status":"failed","error":{"code":"E_RUN_CANCELLED"}}}
{"seq":11,"event":"run/ended","payload":{"status":"cancelled","error":{"code":"E_RUN_CANCELLED"},"stats":{"durationMs":19126}}}
```

tree-state `rly8b`：

- `runtime.segmentChain = ["233ae416-28a2-4e63-a9df-394e0ccb91eb"]`
- `drift_history[1] = {ts:"2026-11-12T09:59:23.053Z", to_session:"233ae416-…", reason:"bamboo relay #1 (no-handoff-summary)"}`
- `runtime.history = [{sessionId:null,state:"pending"},{sessionId:"2088fb0c…",state:"running",note:"bamboo-relay"},{sessionId:"233ae416…",state:"running",note:"done event"}]`

后继会话 `233ae416` 重跑同一任务时命中 **`E_RUN_EXISTS`**（与 S1 组合语义缺口一致），done summary 原文：

```text
FLOW_STATUS=flow ? failed: E_RUN_EXISTS: run "RLY8B-R1" 已存在 journal（禁止复用；续跑请用 flow_resume）
```

→ **auto 回归 PASS：relay 触发（drift+segmentChain+新会话）且 flow 变为 `cancelled / E_RUN_CANCELLED`，S1 结论在 v0.8.0 未回退。**

---

## 4. 用例 B2：auto + **harvest 显式**触发 relay（任务要求的路径）→ PASS

`rly8c` leaf 于 10:05:49.584Z 自报 pct=45；我在 **~10:06:08Z** 调用 `tree_status{action:"harvest"}`，工具返回原文：

```text
tree_status: harvest c3demo:∅ | chglog:∅ | chlog:∅ | floweng:∅ | prj_mw4k:∅ | rkmes:∅ | rly8a:∅ | rly8b:∅ | rly8c:bamboo(ok) | rsipoc:∅ | s1rl1:∅ | tchlog:∅ | wave1:∅ | wave2:∅ (sweepMode=timer)
```

同一次 harvest 内的证据：

```text
2026-11-12T10:06:20.534Z handoff brief: grace 12000ms expired for d3225e54 → no-handoff-summary
```
（harvest 内 `promptHandoff` 成功 → 12s 宽限 → 到期 → interrupt → dispatch；drift `bamboo relay #1` @10:06:20.647Z，to `5e743bff`）

flow `RLY8C-R1`（`flow_status` 原文）：

```text
flow_status RLY8C-R1: cancelled (rly8c.flow, engine=flow-core@5a313fe9) integrity=verified perm=safe
- N1 [session] failed session=b7241c79-bcaf-4e9c-9e57-deea9c7974b6 error=E_RUN_CANCELLED
error: E_RUN_CANCELLED: run 被取消：[object Object]
```

journal 尾部原文：`{"seq":10,"event":"node/settled",...N1 status=failed E_RUN_CANCELLED}` / `{"seq":11,"event":"run/ended",... status=cancelled, durationMs=24857}`。

tree-state `rly8c`：`runtime.segmentChain=[5e743bff-…]`；drift `bamboo relay #1`；`runtime.state=running`（后继会话随后 done）。

→ **harvest 路径与定时路径行为一致（同一 `sweepTick` 分支），任务要求的显式触发 PASS。**

---

## 5. set-relay 权限面（工具面真机 + 单测交叉）

| 角色 | 操作 | 实测结果（原文） |
|---|---|---|
| **creator**（本会话创建 leaf） | `rly8a` set `off` | `tree_node: rly8a-C1-flow status=segment_pending · relay=off`（call-log `ok:true`，09:58:49.512Z） |
| **root**（本会话为 `rly8b` root leaf session） | `rly8b` set `off` → `auto` 往返 | 两次均 `relay=off` / `relay=auto` 成功（`rly8b` root `session_id=c82a74aa…`） |
| **owner（执行者自己）** | leaf `94b72a19` 对自身 set-relay off | `Error: E_BORROWED_IDENTITY: caller "94b72a19" cannot write relay on leaf "rly8a-C1-flow" (allowed: creator\|root) — borrowed identity rejected` |
| **非法值** | `relay:"on"` | `Error: E_SCHEMA_INVALID: relay "on" must be "auto" or "off"` |

- 工具 schema：`tree_node.parameters.properties.relay.enum = ["auto","off"]`、`action.enum` 含 `"set-relay"`（`packages/dsh-tree-engine/index.js:530-533`；单测 `tests/relay.test.js` A9 锁定工具面、A2 锁非法值、A3 锁 owner/陌生人/缺 caller 拒绝）。
- `leaf:add` 也接受创建期 `relay:"off"`（A4），本次真机走 set-relay 后置路径。
- **结论：PASS**（正例 creator/root、负例 owner、非法值各 1 条以上真机证据；陌生人/缺 caller 由单测 A3 覆盖）。

---

## 6. usagePct 修复（P0-B）→ **PARTIAL：获取已修好，measure 契约仍不匹配（finding）**

### 6.1 实测日志（apply.log，原文）

```text
2026-11-12T09:59:09.764Z tokenMeter.measure unavailable: session.snapshotEvents is not a function → self-report only
```

- 这是 **v0.8.0 实例**产生的新形态错误（旧版只有 `cannot get property "tokenMeter" without inject`）；它证明代码已走到 `meter.measure(snap)` 调用点 → **`resolveTokenMeter` 成功拿到了 tokenMeter 服务**（`ctx.get('tokenMeter')` 路径可用），P0-B 的"安全获取"目标达成。
- **但调用契约不匹配**：`index.js` `usagePct` 传入的是 `services.sessionQuery.readSession(sessionId)` 的快照，而 tokenMeter 的 `measure()` 期望带 `snapshotEvents()` 等方法的对象 → 抛错 → catch 返回 null。`tokenMeter.measure shape:` 日志 **0 条**（全库 grep：`@($log|Select-String 'measure shape').Count = 0`）。
- 对照：apply.log 中另 31 条 `measure unavailable` 均为**旧格式**（`without inject` / `inactive context`），来自 §7 的 v0.7.0 僵尸实例；唯一一条 v0.8.0 形态即上句。

### 6.2 对竹节的实际影响（本次真机可判定）

- 09:59:09 的 sweep 中 `usagePct` 返回 null → 回落 leaf 自报 `context_usage_pct=45` → 触发 relay（§3）。**"先到者生效"语义正确、无异常**；`usagePct` 修好与否不改变本次 relay 结论，但**宿主测量仍不可用**，S1 风险评估中的"测量信号缺失"依旧成立。
- 建议（不计入 v0.8.0 判决）：把 `measure()` 的入参改为宿主期望的形状（或 `measure()` 无参/自定义快照），并保留首次 `shape:` 日志；修复前 usagePct 语义 = **恒 null（优雅降级，不崩溃）**。

---

## 7. sweep 生命周期（P1-C）→ v0.8.0 侧 PASS；旧僵尸=已知边界

### 7.1 v0.8.0 起不再新增僵尸（过程证据）

apply.log 版本时间线（原文摘录）：

```text
2026-11-12T09:44:23.586Z apply() entered (v0.7.0)
2026-11-12T09:44:30.776Z apply() entered (v0.7.0)
2026-11-12T09:44:37.471Z apply() entered (v0.7.0)
2026-11-12T09:44:44.890Z apply() entered (v0.7.0)
2026-11-12T09:44:50.894Z apply() entered (v0.8.0); PROFILE_DIR=?
2026-11-12T09:44:50.894Z previous sweep disposed (hot-reload zombie)
2026-11-12T09:47:52.498Z previous sweep disposed (hot-reload zombie)
2026-11-12T09:47:58.402Z previous sweep disposed (hot-reload zombie)
2026-11-12T09:52:10.013Z apply() entered (v0.8.0); PROFILE_DIR=?
2026-11-12T09:52:10.013Z previous sweep disposed (hot-reload zombie)
```

- **5 条 `previous sweep disposed` = 5 次 v0.8.0 apply 每次成功停掉前一个 v0.8.0 实例**的 sweep（跨模块实例注册表生效）。
- 仅 v0.8.0 形态错误（§6.1）证明当前实例的 sweep 正常工作；`tree-status harvest` 多次调用均正常返回（`sweepMode=timer`），无重复写竞态导致的自伤。

### 7.2 旧僵尸仍在（升级前 v0.7.0 实例，重启前不可清除）

- Lead 已定位：`engine-dev` 写文件触发 4 次 **v0.7.0 HMR 重载**（09:44:23/30/37/44），它们启动的 interval **不在 v0.8.0 注册表**（旧代码无该机制）→ 升级后以 `inactive context` 僵尸形式存活。
- 本次实测（测试期间被"唤醒"，因为出现了 running leaf）：
  - `inactive context` 条数 **24 → 188**（+164，全部在 09:52:10 重载之后；样例：`2026-11-12T09:59:30.696Z ports.promptHandoff failed for 94b72a19-…: cannot get required service "sessionQuery" in inactive context`）。
  - 新树 call-log 也出现旧实例的 `sweep_error`：`rly8a` 65 条 / `rly8b` 9 条 / `rly8c` 9 条；其中既有 `no live parent Agent …`（dispatch 失败），也有 `ENOENT: rename tree-state.json.tmp → tree-state.json`（多 sweep 并发写竞态）。
  - **旧实例来源的判别**：这些 `sweep_error` 的 stack 行号**互不相同**（`index.js:87:21` / `index.js:92:21`；`engine.js:492/502/505/523/557/567/570/588`）→ 同一进程内至少 4 个不同代码版本的模块实例在各自 sweep；而当前 v0.8.0 源码对应行号唯一。
  - 旧僵尸的 `promptHandoff/interrupt` **全部因 inactive context 失败**，因此 **不会真正打断任何会话**——`rly8a` 的 flow succeeded 即是反证。
- **已知边界：升级前遗留的 v0.7.0 sweep 僵尸只能通过「重启 DSH 进程」清除；本会话按纪律不重启/不重载。** 重启后按 §7.4 复核即可获得干净基线。

### 7.3 判决

- **P1-C（v0.8.0 自身）PASS**：新实例启动前旧 v0.8.0 sweep 被 stop（5/5），不再产生 v0.8.0 形态的僵尸错误。
- **单实例绝对性 UNKNOWN**：工具面无法直接枚举"当前活跃 interval 数"；但"v0.8.0 不再新增 + 旧错误行号多版本"已足以判定噪声来源为升级前实例。

### 7.4 可复核命令（重启 DSH 后执行）

```powershell
$log = Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\tree-engine-data\apply.log"
# 重启后：以下两个计数在 5 分钟观察窗内应保持不增（无旧僵尸）
@($log | Select-String 'inactive context').Count
Get-ChildItem "$env:USERPROFILE\.dsh\profiles\desktop\tree-engine-data" -Directory |
  ForEach-Object { $cl = Join-Path $_.FullName 'call-log.jsonl'
    if (Test-Path $cl) { "{0}: sweep_errors={1}" -f $_.Name, @(Get-Content $cl | Select-String 'sweep_error').Count } }
```

---

## 8. 回归（tree_doctor / validate / 单测）

### 8.1 tree_doctor（两次实测）

```text
tree_doctor: 7 checks · pass=7 warn=0 fail=0 · version=0.8.0
```
（测试开始 17:5x 与结束 18:1x 各一次，均通过；7 检查 = package/tool-count/skills/tree-data/stale/sweep/env。）

### 8.2 tree_status validate

| 树 | 结果 | 说明 |
|---|---|---|
| `rly8a`（无 relay） | **PASS 0 issues** | `tree_status: validate PASS (0 issues)` |
| `rly8b`（relay #1） | **FAIL（被工具层掩盖）** | `tree_status{validate}` 返回 `Error: Cannot read properties of undefined (reading 'code')` |

**根因（独立复现，非 v0.8.0 回归）**：直接调用 `engine.table.validate(['rly8b'])` 得到真实 issue：

```json
{"ok":false,"issues":[{"type":"session_duplicate","leaf_id":"rly8b-C1-flow","detail":"runtime.segmentChain duplicates rly8b-C1-flow"}]}
```

- 原因：竹节接力后 `leaf.session_id = 新会话` 且同一会话同时被 push 进 `runtime.segmentChain`；`validate` 先对 `session_id` 记 `seen`，再遍历 `runtime.segmentChain` 时把"当前执行者"判成重复（W2.1 引入 segmentChain 校验时的口径缺陷）。
- **存量证据**：对 v0.7.0 时期已接力的 `s1rl1` 直接 validate 同样报 `session_duplicate: runtime.segmentChain duplicates s1rl1-C1-relay`；其余 9 棵旧树 validate 全 0 issues。→ 只要 leaf 发生过竹节接力，validate 必 FAIL；`rly8a`（无接力）通过。
- **次生缺陷（工具层）**：`tree_status` 对 validate 走 `if (!r.ok) throw toError(r)`；但 validate 的失败形态是 `{ok:false, issues}`（无 `error` 对象），`toError` 读 `r.error.code` → `TypeError`。**用户/Agent 看到的是内部异常而不是 issue 清单**（建议：validate 失败时原样返回 `issues`，或给 validate 结果补 `error`）。
- 两项都建议记入下一轮（是否为 v0.8.0 引入：否，W2.1 存量；但 v0.8.0 的 relay 用例会必然暴露它，发布说明应注明）。

### 8.3 单测

- Lead 提供：`node --test tests/*.test.js` → **145/145 全绿**（v0.8.0，含 relay 开关 / token-meter / sweep 注册表新增用例）。
- **本次独立复跑（e2e-verifier，独立 node 进程）**：`cd packages/dsh-tree-engine; node --test tests/*.test.js` → 尾部原文：

  ```text
  ℹ tests 145
  ℹ suites 0
  ℹ pass 145
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 1870.6188
  ```

  与 Lead 口径一致（145/145，0 fail）。

---

## 9. Findings 汇总（供下一轮决策）

| ID | 发现 | 严重度 | 归属 | 证据 |
|---|---|---|---|---|
| **F1** | `validate` 对"已竹节接力"leaf 报 `session_duplicate` 假阳性（`session_id` 与 `runtime.segmentChain` 中同一会话重复计数） | **P1** | v0.7.0 W2.1 存量 | §8.2；`s1rl1` 复现 |
| **F2** | `tree_status{action:"validate"}` 用 `toError` 包装 `{ok:false,issues}` → `TypeError: Cannot read properties of undefined (reading 'code')`，issue 清单不可见 | **P1** | index.js 工具层 | §8.2 原文 |
| **F3** | `usagePct`：服务获取已修好，但 `meter.measure(readSession 快照)` 契约不匹配（`session.snapshotEvents is not a function`）→ 仍恒 null；`shape:` 日志从未出现 | **P1** | v0.8.0 P0-B 剩余项 | §6.1 |
| **F4** | `flow_status` 对**仍在运行**的 run 会显示 `interrupted / integrity=unfinalized`（基于 journal 的派生视图；N2 后来实际 `succeeded`）——读侧语义易误判为"被中断" | P2（文档） | flow-engine 读侧 | §2.1：mid-run 查询 vs 终态 `succeeded` |
| **F5** | 竹节 relay 后 successor 重跑同 runId 必 `E_RUN_EXISTS`（结果不可复用），S1 组合语义缺口在 v0.8.0 未变 | P2 | tree×flow 组合语义 | §3.2 `rly8b` done summary 原文 |
| **F6** | 升级前 v0.7.0 sweep 僵尸只能重启清除（P1-C 对"未来实例"有效，无法回溯停止未注册旧实例） | 已知边界 | 生命周期 | §7.2；Lead 诊断 |

---

## 10. 已知边界与干扰项（明确声明，避免误判）

1. **旧僵尸干扰（Lead 2026-11-12 诊断，已纳入）**：09:44:23/30/37/44 四次 v0.7.0 HMR 启动的 sweep interval 不在 v0.8.0 全局注册表内，升级后仍以 `inactive context` 形式存活；它们会周期性尝试对 running leaf 执行 relay（`promptHandoff`/`interrupt` 全部失败），并并发写 tree-state 产生 `ENOENT`。**这些日志/竞态不是 v0.8.0 回归**；其 interrupt 失败 → 不会真正打断会话（`rly8a` flow succeeded 反证）。
2. `rly8a` 的 harvest 时点（~09:59:50）与 `rly8b` 的定时 relay（09:59:23）接近；`rly8b` 的 relay 是**定时 sweep**触发而非该次 harvest（harvest 返回 `rly8b:∅`，因此任务要求的 harvest 路径另用 `rly8c` 补齐并 PASS）。
3. `flow_status` 在 run 运行中读取会显示 `interrupted/unfinalized`（见 F4）；本报告所有 flow 终态均以 **run 结束后** 的 `flow_status` + journal `run/ended` 为准。
4. `pct=45` 为人为自报（未真实跑满 42% 上下文）；relay 判定只看 pct 端口，机制结论不受影响。
5. 测试期间 `tree_doctor` / `validate` / `harvest` 与定时 sweep、旧僵尸并发，个别计数为时点值；关键证据均给出时间戳。

---

## 11. 复核指引

| 项 | 值 |
|---|---|
| 树 / leaf | `rly8a` / `rly8a-C1-flow`（off，succeeded）；`rly8b` / `rly8b-C1-flow`（auto，relay #1）；`rly8c` / `rly8c-C1-flow`（auto，harvest relay #1） |
| 会话 id | rly8a 执行者 `94b72a19-5375-4d3a-bfbb-617596fd15c6`；rly8a flow 节点 `88dfd7e6-…`、`6d96e839-…`；rly8b 执行者 `2088fb0c-0542-4a44-b902-d433abb252e3` → successor `233ae416-28a2-4e63-a9df-394e0ccb91eb`；rly8c 执行者 `d3225e54-f96b-4220-8374-35754c18f580` → successor `5e743bff-b7ff-4b3b-8816-7cea921e5a50`；rly8c flow N1 `b7241c79-bcaf-4e9c-9e57-deea9c7974b6` |
| tree-state | `%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\{rly8a,rly8b,rly8c}\tree-state.json` |
| flow journal | `D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\{RLY8A-R1,RLY8B-R1,RLY8C-R1}.jsonl`（`flow_status` 可直接读） |
| apply.log | `%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\apply.log`（重载 09:52:10Z；`measure unavailable` 09:59:09.764Z；grace 09:59:22.994Z / 10:06:20.534Z） |
| 证据快照 | 仓外：`D:\Codes\_composition-research\e2e-relay-switch\snapshot-20261112-180925\`（apply.log / 3×tree-state / 3×call-log / 3×journal / adapter）；**入库副本**：`docs/reports/artifacts/composition-rly8-2026-11-12/`（同内容） |
| 单测独立复跑 | `cd packages/dsh-tree-engine; node --test tests/*.test.js`（bundled node；预期 145/145） |
| 清理 | 测试树与 flow run **全部保留**作证据；未改 profile、未装/重载插件、未 commit；未动既有 `s1rl1`/`wave1`/`wave2` |

### 11.1 本次新增的取证副本（scratch）

```text
D:\Codes\_composition-research\e2e-relay-switch\snapshot-20261112-180925\
  apply.log.snapshot                  (109,173 B)
  tree-state.rly8a.json / rly8b / rly8c
  call-log.rly8a.jsonl / rly8b / rly8c
  RLY8A-R1.journal.jsonl (84,081 B，含 N2 输出全文)
  RLY8B-R1.journal.jsonl / RLY8C-R1.journal.jsonl
  *.adapter.json
```

> 报告生成：write（UTF-8 无 BOM）。结论以本次真机读数为准；对 v0.8.0 的判决不因旧僵尸噪声而放宽或收紧。
