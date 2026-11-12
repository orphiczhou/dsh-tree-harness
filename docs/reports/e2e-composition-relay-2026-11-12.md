# S1 真机 E2E：竹节 relay 是否自主打断运行中的 flow（2026-11-12）

> 任务：共享任务板 `task-1`。执行者：teammate `relay-e2e`（会话 `52215c2c-aead-431d-996e-476661f00868`）。
> 环境：DSH `0.2.2-rc.1` · profile `desktop` · tree-engine **v0.7.0** 活体 · flow-engine M1 活体 · `maxDepth=4`。
> 证据目录：`D:\Codes\_composition-research\e2e-s1\`（evidence.json / 快照）+ 运行态 `%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\s1rl1\` + flow journal `D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\S1RELAY-R1.jsonl`。

---

## 0. 结论先行（一句话判决）

**① 宿主 `tokenMeter.measure` 路径不可用，`usagePct` 恒 `null`（FACT）——relay 只能由 leaf 自报 `tree_report{action:"context"}` 触发；② relay 一旦真正执行，会打断 leaf 内正在 await 的 flow：flow journal 实测 `run/ended status=cancelled / error=E_RUN_CANCELLED / durationMs=61863`（FACT）；③ "定时器自主触发"只部分成立：定时器 sweep 确实自主发起过 relay 并成功换会话，但当前进程存在多个 reload 残影 sweep 循环，24 条 `inactive context` 失败 + 14 条 `sweep_error`，自主路径"偶发可用、多数失败"（FACT + 1 处 INFERENCE）。**

一句话可判定版本：**relay 会打断运行中的 flow（经 sweep/harvest 路径实证）；但"定时器无人干预自主打断 flow"在本次真机未直接观测到，且定时器 relay 路径因 reload 残影而不可靠。**

---

## 1. 测试设计（实际执行）

- 树：`s1rl1`（root `s1rl1-root`，owner = 我的会话 `52215c2c-…`；commander leaf `s1rl1-C1-relay`）。
- 派发：`tree_dispatch` → leaf 会话 S1 = `5b815d47-ee6f-4348-abba-461be0eb2c0c`。派发 prompt 指示严格三步：
  1. 第一个工具调用即 `tree_report{action:"context", pct:45}`（自报水位，> 阈值 42%）。
  2. 随即 `flow_run{flow:<inline DSL>, runId:"S1RELAY-R1"}` 并等待（前台同步）。
  3. 结算 `tree_report{action:"event", type:"done"}`。
- 测试 flow：3 个 `session` 节点串行（N1→N2→N3）、**gate-free**、每节点要求 ≥1200 字结构化 JSON 输出；文件 `D:\Codes\_composition-research\e2e-s1\s1-relay.flow.json`。
  - 注：`flowPath` 有"必须在 runCwd 内"围栏（`spike\dsh-flow-plugin\lib\storage-path.js:390-448`），leaf 的 runCwd=`D:\Codes\dsh-tree-harness`，故改走 **inline `flow` 参数**；文件保留作为 DSL 证据（`run/created.payload.storage.runCwd` 证实）。
- 触发：先等定时器 sweep（自然窗口 ~60s），再在 flow 运行中调用 `tree_status{action:"harvest"}` 走同一条 `sweepTick` 代码路径强制触发。

---

## 2. 证据一：宿主 `usagePct` 是否返回数值 → **否，恒 null**

`%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\apply.log`（当前装载实例最后一次测量，第 **1055** 行，原文）：

```text
2026-11-11T17:01:29.241Z tokenMeter.measure unavailable: cannot get property "tokenMeter" without inject → self-report only
```

- 同型记录在 apply.log 中共 **22 条**（行 603/674/717/788-792/821-822/851/879-881/943/959/975/1006-1007/1038-1039/1055），说明不是偶发。
- 代码原因（可复核）：`packages/dsh-tree-engine/index.js:181-197` 的 `usagePct` 端口：
  - `:183` 直接读 `services.tokenMeter`——而 `apply()` 的注入只声明了 `['tools','subagents','sessionQuery']`（`index.js:809`），**未 inject `tokenMeter`** → 访问即抛 `cannot get property "tokenMeter" without inject`；
  - `:194` catch 直接 `return null`，因此 `ctxRef?.get('tokenMeter')` 兜底**永远不可达**；
  - `sweepTick` 里 `pct = (typeof usage === 'number') ? usage : (leaf.context_usage_pct ?? 0)`（`src/engine.js:562-566`）。
- 本次实测佐证：leaf 只调用了 `tree_report context pct:45`，tree-state 里 `context_usage_pct: 45`，随后 sweep 即按 45 触发 relay；**没有任何一次宿主测量命中**。
- 结论：**S1 红队担心的"leaf 不报 context 也拦不住"在当前 build 下不成立**（宿主测量恒 null，只能靠自报）；但组合安全仍不成立——自报即可触发。

---

## 3. 证据二：relay 打断运行中的 flow → **会（FACT）**

时间线（UTC；本地 = +08:00）：

| 时间 (UTC) | 事件 | 证据 |
|---|---|---|
| 09:13:09.020 | tree `s1rl1` 创建 | `tree_plan` 返回；state `created_at` |
| 09:13:38.954 | 派发 leaf，S1 会话 `5b815d47…` | call-log `dispatch:start ok`；runtime.history |
| 09:13:52.170 | S1 自报 `pct=45` → drift `auto segment_pending` | state `drift_history[0]`：`"context_usage_pct 45% >= threshold 42%, auto segment_pending (bamboo-joint handoff)"` |
| 09:14:01.810 | flow run 创建 / 09:14:01.819 started | journal `seq=1` `run/created`（callerOrigin=subagent / permTier=safe） |
| 09:14:40.473 | 节点 N1 成功（**38646ms**） | journal `seq=10` `node/settled N1 status=succeeded durationMs=38646` |
| 09:14:40.510 | N2 spawn 开始 | journal `seq=13` `node/spawned N2 session=6512f116…` |
| ~09:14:51 | **我调用 `tree_status{action:"harvest"}`**（tool 返回 `s1rl1:bamboo(ok)`） | 工具输出原文：`tree_status: harvest … s1rl1:bamboo(ok) … (sweepMode=timer)` |
| 09:15:03.686 | relay #1：handoff 简报宽限 12s 到期 → interrupt 旧会话 S1 | apply.log 第 1072 行：`handoff brief: grace 12000ms expired for 5b815d47 → no-handoff-summary` |
| **09:15:03.670 / .674** | **N2 `node/settled failed E_RUN_CANCELLED`；`run/ended status=cancelled / error=E_RUN_CANCELLED / durationMs=61863 / nodeExecutions=3`** | journal `seq=14/15`（原文见下） |
| 09:15:03.754 | drift：`bamboo relay #1 (no-handoff-summary)` → `to_session: d257b262…` | state `drift_history[1]`；runtime.history 记 S1 `note:"bamboo-relay"` |

journal 关键两行原文（snapshot：`D:\Codes\_composition-research\e2e-s1\S1RELAY-R1.journal.snapshot.jsonl`）：

```json
{"seq":14,"event":"node/settled","payload":{"nodeId":"N2","status":"failed","error":{"code":"E_RUN_CANCELLED","message":"run 被取消：[object Object]"}…}}
{"seq":15,"event":"run/ended","payload":{"status":"cancelled","outputs":null,"error":{"code":"E_RUN_CANCELLED",…},"stats":{"durationMs":61863,"nodeExecutions":3,"permTier":"safe"}}}
```

`flow_status S1RELAY-R1` 工具输出原文摘要：

```text
[permTier=safe]
flow_status S1RELAY-R1: cancelled (s1.relay.flow, engine=flow-core@5a313fe9) integrity=verified perm=safe
- N1 [session] succeeded session=b4f38486-… (38646ms)
- N2 [session] failed session=6512f116-… error=E_RUN_CANCELLED
- N3 [session] pending
outputs: {}
error: E_RUN_CANCELLED: run 被取消：[object Object]
```

**判定链**：S1 被 interrupt（`ports.interrupt`，`index.js:119-131`）→ `flow_run` 传给引擎的 `exec.signal` 被中止（`lib/tools.js:788` `signal: exec?.signal`）→ flow-core 取消在途 run（journal 完整落盘，integrity=verified）。即：**relay 会打断运行中的 flow，并把 flow 变成 cancelled（结果丢失、N3 未执行）**。

---

## 4. 证据三：定时器自主路径 → **会自主发起，但当前不可靠（残影循环）**

### 4.1 失败侧（多数）

- call-log（`tree-engine-data\s1rl1\call-log.jsonl`）中 **sweep_error 共 14 条**，其中 12 条为：
  `no live parent Agent: dispatch must be invoked via tree_dispatch tool call (exec.agent); bamboo relay requires the dispatcher session still live`
  —— 定时 sweep 自主判定到 45% 并进入 `bambooRelay`，但该 sweep 循环所属引擎实例没有本次 dispatch 的 parent Agent 缓存（热更残影）。
- `apply.log` 中 **`inactive context` 失败共 24 条**，例如第 1056-1057 行原文：
  `ports.promptHandoff failed for 5b815d47-…: cannot get required service "sessionQuery" in inactive context` /
  `ports.interrupt failed for 5b815d47-…: cannot get required service "subagents" in inactive context`
  即多个旧插件实例的 sweep 定时器仍在跑，但其 scoped 服务上下文已 inactive。
- 简历：apply.log 共 **73 条 `apply() entered`**（最新三次：`16:52:17Z v0.6.0`、`16:52:47Z v0.7.0`、`17:00:28Z v0.7.0`），说明本进程经历过大量 reload；`currentStopSweep` 是**模块级变量**，reload 后新模块实例拿不到旧 stop 句柄 → 旧 interval 成为僵尸循环（`index.js:843` 的 `previous sweep disposed` 只在同一模块实例内有效）。

### 4.2 成功侧（偶发）

**Relay #2 是在我没有发起任何工具调用的窗口内自主发生的**（我最后一次相关工具调用是 ~09:15:04 的 harvest 返回；下一次工具调用在 09:16 之后）：

- apply.log 第 1079 行：`2026-11-12T09:15:45.690Z handoff brief: grace 12000ms expired for d257b262 → no-handoff-summary` → 说明有一次**活跃上下文**的 `promptHandoff` 在 09:15:33.69 启动（12s 宽限）并成功走完；
- state `drift_history[2]`：`2026-11-12T09:15:45.726Z … "bamboo relay #2 (no-handoff-summary)" to_session: c5cd5492-b8db-4614-bdeb-c6fba092d7e2`；
- runtime.history 中 S2 `d257b262…` 的 `endedAt` = 09:15:45.726、`note:"bamboo-relay"`，随后 S3 `c5cd5492…` 被起并最终 `done`（state succeeded）。

→ **定时器 sweep 在本机"偶发可用"**；但该次自主 relay 打断的 S2 当时不在 `flow_run` 内（它在重跑任务时命中 `E_RUN_EXISTS`），所以「定时器自主打断运行中的 flow」**本次未直接观测到**（INFERENCE：harvest 与 timer 走同一 `sweepTick` 分支 `src/engine.js:529-581`，harvest 的打断效果可外推到 timer——前提是 timer 路径别先失败）。

### 4.3 附带：并发 sweep 写竞态

call-log 末尾 2 条（09:18:50.408Z）：
`ENOENT: no such file or directory, rename '…\s1rl1\tree-state.json.tmp' → '…\tree-state.json'`
——多个 sweep 循环并发写同一 tree-state（`fsStore.write` tmp+rename，`src/store.js:51-56`）时互相吞掉 tmp。同一目录双写有丢更新风险。

---

## 5. 证据四：flow 在 leaf 内**能起来**（不是权限/深度阻塞）

- journal `run/created`：`callerOrigin:"subagent"`、`permissions.flowTier:"safe"`、`storage.root:"D:\Codes\DSH动态流程引擎插件\.dsh-flow"`、`storage.runCwd:"D:\Codes\dsh-tree-harness"`、`storage.configSource:"config"`；
- 节点 N1 真起了子会话 `b4f38486-…` 并 **38646ms** 后输出结构化 JSON 成功（output 全文在 journal `seq=10`），证明 depth/权限/工具可见性均未阻塞（tree root→leaf→flow node 未撞 `maxDepth=4`）。
- `flow_run` 失败/丢失行为：
  - 旧会话 S1 的 `await flow_run` 被 interrupt 取消（返回给 S1 的 flow 结果丢失）；
  - 竹节接手的 S2 重跑同一任务时命中 **`E_RUN_EXISTS`**（runId 逐字固定 `S1RELAY-R1`，journal 已存在）→ 结果既不能复用也不能续跑（需 `flow_resume`，但 successor 未获授权/未执行）——**组合语义缺口**。

## 6. 证据五：其它观测

- leaf 终态：`runtime.state=succeeded`、`events` 有 `done`（09:16:06.143Z，summary 为 `flow_run 失败(错误码 E_RUN_EXISTS)…`），但 `leaf.status` 仍为 **`segment_pending`**——已知边界"leaf.status 与 runtime 终态脱节"（handoff §7-8）再现。
- 会话链（可复核）：S1 `5b815d47-…`（被 relay #1 interrupt）→ S2 `d257b262-…`（被 relay #2 interrupt）→ S3 `c5cd5492-…`（done）。flow 节点会话：N1 `b4f38486-…`（succeeded）、N2 `6512f116-…`（cancelled）、N3 未起。
- tree-state 快照：`D:\Codes\_composition-research\e2e-s1\tree-state.s1rl1.snapshot.json`；call-log 快照：`call-log.s1rl1.snapshot.jsonl`；apply.log 快照：`apply.log.snapshot`。

---

## 7. 修复建议（按优先级）

| # | 建议 | 理由（本次证据） |
|---|---|---|
| **P0** | **加 per-leaf relay 抑制开关**：`tree_node set-context` 支持 `relay:'auto'\|'off'`，`sweepTick` 的竹节分支读它；等待外部编排（flow/verify/长命令）的 leaf 必须 `relay:'off'` | relay 确实会打断 flow（§3）；当前没有任何手段关掉某个 leaf 的竹节 |
| **P0** | **修复 `usagePct` 端口**：`ctx.inject([...,'tokenMeter'])` 或改为只在 `try{ctx.get('tokenMeter')}` 内取；修好后首次调用打 `tokenMeter.measure shape:` 日志（现只有 unavailable 分支） | 宿主测量恒 null（§2），S1 的风险评估因此失真 |
| **P1** | **修复 sweep 僵尸循环**：在 `ctx.on('dispose')` / apply 清理点保存并调用上一代 `stop()`；或把 sweep 托管到宿主 timer 服务并将 stop 句柄落盘/全局注册；同进程多实例共享 `tree-engine-data` 需加单实例锁 | 73 次 apply 残影导致 24 条 inactive-context 失败 + 14 条 sweep_error + tree-state 写竞态（§4） |
| **P1** | **relay 前 parent 解析兜底**：`parents` 缓存未命中时，用 `state.runtime.parentSessionId` 经 `agents.get()` 重新解析活 Agent，而不是直接抛 `no live parent Agent` | timer 路径 zombie 实例的 dispatch 必失败（§4.1） |
| **P2** | **结果交付**：relay 后 successor 对同一 runId 必 `E_RUN_EXISTS`；需要 runId 规则（relay 时换 runId 或允许 `flow_resume`）或改走 artifact 引用（组合文档 §7.3c） | §5 的 `E_RUN_EXISTS` 实测 |
| **P2** | 修 `E_RUN_CANCELLED` 的 `[object Object]` 消息（`message:"run 被取消：[object Object]"`） | journal seq=14/15 可复核 |

---

## 8. 判决对组合方案的含义

- 组合文档 §4.1「tree 外层 / flow 内层 ⚠️ 演示可用、不可无人值守」的**判定成立且更严重**：不只是"可能被打断"，而是**一旦自报水位（或未来宿主测量修好）就必然被打断**，且 flow 结果随之丢失（cancelled + `E_RUN_EXISTS` 无法复用）。
- 组合文档 §7.1 第 1 步的两个验收选项：本次**同时满足**——①采到 bamboo 事件（drift/segmentChain，harvest 路径）；②证明宿主测量 null（apply.log）。因此**第 2 步（per-leaf relay 开关）应认定为必须项**，不能靠"宿主测量不可用"这一实现缺陷来兜底。
- **UNKNOWN/局限（诚实标注）**：
  1. 本次未真实跑到 42% 上下文，pct=45 为人为自报（但 relay 判定只看 pct 端口，测量来源不影响机制结论）；
  2. 「定时器自主打断运行中的 flow」未直接观测（自主 relay #2 不在 flow 内）——是 INFERENCE（同一 sweepTick 分支）；
  3. 定时器路径为何"偶发可用"（哪个实例的循环活跃）未完全定位——与 reload 残影相关，需下一轮专项。

---

## 9. 复核指引

| 项 | 值 |
|---|---|
| 树 / leaf | `s1rl1` / `s1rl1-C1-relay`（`tree_node{action:"get"}` 只读复核） |
| 运行态 | `%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\s1rl1\tree-state.json` |
| flow run | `S1RELAY-R1`（`flow_status` 可直接读；journal `D:\Codes\DSH动态流程引擎插件\.dsh-flow\runs\S1RELAY-R1.jsonl`） |
| apply.log | `%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\apply.log`（行 1055 / 1072 / 1079 / 1056-1070） |
| 会话 id | S1 `5b815d47-ee6f-4348-abba-461be0eb2c0c`、S2 `d257b262-2ca0-4d63-8ebd-7c32e3ac737e`、S3 `c5cd5492-b8db-4614-bdeb-c6fba092d7e2` |
| 证据快照 | 仓外原始：`D:\Codes\_composition-research\e2e-s1\{evidence.json, tree-state.s1rl1.snapshot.json, call-log.s1rl1.snapshot.jsonl, apply.log.snapshot, S1RELAY-R1.journal.snapshot.jsonl, S1RELAY-R1.adapter.snapshot.json, s1-relay.flow.json, collect-evidence.mjs}`；**入库副本**：`docs/reports/artifacts/composition-s1-2026-11-12/`（同内容，不含 collect-evidence.mjs） |
| 清理 | 未删除任何测试树/run（保留证据）；未改 profile、未装/重载插件、未 commit |

> **Lead 复核补记（2026-11-12 17:2x，独立只读核对）**：apply.log 现 1082 行，`apply() entered` **73** 条、`tokenMeter.measure unavailable` **22** 条、`inactive context` **24** 条，与报告一致；flow journal `S1RELAY-R1.jsonl` 15 条事件中 seq=14 `E_RUN_CANCELLED` / seq=15 `run/ended cancelled` 与报告引用一致；tree-state `s1rl1` 的 `segmentChain` 两段（`d257b262…`、`c5cd5492…`）与 drift `bamboo relay #1/#2` 一致。唯一差异：call-log 在快照（17:18:50）后又追加 1 条，活体现为 **15 条 `sweep_error` / 3 条 ENOENT**（报告快照时点 14/2）——不影响判决。
