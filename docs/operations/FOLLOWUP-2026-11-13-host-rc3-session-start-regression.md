# 跨仓跟进单：宿主 0.2.2-rc.1→rc.3 升级后 flow 插件 session 节点全部 `E_SESSION_START_FAILED`（`startActivation` 调用形状漂移）

> **性质**：跨仓跟进单（tree-harness → flow 项目组，2026-11-13 22:1x）。**单向材料**：tree 侧不改 flow 仓代码（用户硬约束），本单供 flow 侧核实与修复排期；全部证据可只读复核。
> 送达方式：由用户转交。调查与成文：D27 接续会话（zai/glm-5.3-flash·max）；根因定位的源码行号取证来自 flow 仓 T-1 探针报告（agent-1，21:45–21:55）。

---

## 0. 一句话结论

宿主于 **2026-11-13 18:17–21:45 之间升级 0.2.2-rc.1 → 0.2.2-rc.3**，`startActivation` 契约从「`request:{prompt,parent,...}` 嵌套」改为「`spec` 顶层 `parent`/`maxDepth`/`outputSchema`」；flow 插件 `spike/dsh-flow-plugin/lib/session-executor.js` 仍按 rc.1 形状调用 → `spec.parent === undefined` → **所有 flow run 的 session 节点在 1ms 内 `E_SESSION_START_FAILED`**。修复属 flow 插件责任域；修复前任何含 session 节点的 flow run 均不可用。

## 1. 现象（FACT）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 两次真机失败 run（同分钟 21:46、逐字节相同错误）：tree 侧 Lead 会话的 `R-m12-e2e-20261113-2146`（callerOrigin=user）+ flow 仓 T-1 探针 `R-m12-sop-2146`（callerOrigin=subagent） | flow 仓 `.dsh-flow/runs/R-m12-*.jsonl`（只读） |
| 2 | 失败形态：run 总耗时 12ms；失败节点 `durationMs=1`、`sessionId:null`、`E_SESSION_START_FAILED`；journal 10 条事件、integrity=verified、**无任何 `node/spawned`**（计数=0） | journal seq9 原文见 §7 |
| 3 | 错误原文：`startActivation(spawn) failed: Cannot read properties of undefined (reading 'id')` | 同上 |
| 4 | 排除调用者维度：user 与 subagent 两种 callerOrigin 同分钟同错；今天凌晨同形状（`R-mrun2-20261113-02`，01:54，callerOrigin=subagent）SUCCEEDED → 是**环境变化**而非调用者形状误判 | `flow_list` + journal |
| 5 | 宿主版本：asar 内 `@deepseek-ai/*` 全部 **0.2.2-rc.3**；flow 仓 AGENTS.md 冻结基线仍 rc.1；最后已知成功 = M1.1 真机 18:17（`R-m11-ui-20261113-1817` succeeded），最早观测失败 = 21:46 | asar 只读 + `flow_list` |

## 2. 根因定位（证据链，源码行号）

1. **rc.3 契约（宿主侧）**：asar `dsh-subagent/lib/index.js` `startActivation(spec)`——L3021 `assertSubagentMaxDepth(spec.maxDepth)`（maxDepth 在 **spec 顶层**）；L3024 `this.ctx.get("agents")?.get(spec.parent.id) !== spec.parent`（**parent 在 spec 顶层**，undefined 即抛 `Cannot read properties of undefined (reading 'id')`，与实测逐字一致）；L3025 `assertObjectJsonSchema(spec.outputSchema)`（顶层）。
2. **插件调用形状（rc.1 时代）**：`spike/dsh-flow-plugin/lib/session-executor.js` **L295–301**——`subagents.startActivation({ provider, label, delivery:'caller', signal, request:{ prompt, parent, cwd?, outputSchema?, agentOptions?, maxDepth? } })` → rc.3 下 `spec.parent === undefined` → 必然 TypeError。
3. **升级窗口收敛**：18:17（最后一次真机成功）→ 21:45/21:46（首次失败）之间的「最后一次重载」即宿主升级点。

## 3. 影响面（收敛结论）

- **受影响**：所有含 **session 节点** 的 flow run（节点子会话无法创建，1ms 失败）；下游依赖节点产出的编排全部不可用。
- **不受影响**：宿主自身 spawn 通道（`subagent` 工具）——探针会话本身即 rc.3 派生的活会话，且降级探针成功派出过孙子会话；tree-harness 仓 `tree_*` 工具活体 `tree_doctor` 7/7·v0.10.0（rc.3 上复验）；非 session 节点的 flow 编排（如纯计算/门禁节点）未见异常（M1.1 门禁 run 在升级前的 18:17 走通，升级后未测，列入待复验）。
- **`flow_send` 续接路径（INFERENCE，待验证）**：续接走 `subagents.sendMessage`/`coldResume`，不经 `startActivation`，预计不受本次漂移影响——但因 session 节点起不来，目前无法真机验证；修复后随 T-6 一并覆盖。

## 4. 修复建议（供 flow 侧裁剪）

1. **适配 rc.3 spec 形状**：`session-executor.js` 的 `startActivation` 调用改为顶层字段（`{ provider, label, delivery:'caller', signal, prompt, parent, cwd?, outputSchema?, agentOptions?, maxDepth? }`），或按宿主版本特征分支（如探测 `spec.parent` 形状）做双形状兼容。
2. **补调用形状回归测试**：单测断言插件构造的 `startActivation` 请求对象形状（parent/maxDepth/outputSchema 位置），防再次漂移时离线测试仍绿。
3. **AGENTS.md 基线刷新**：flow 仓冻结基线 rc.1 → rc.3（升级已实际发生，基线滞留会误导后续排查）。
4. **受控重载**：修复提交后按既定纪律受控 disable→enable（用户在场）。
5. **修复后验收**：① 单节点 smoke run——session 节点能启动、journal 出现 `node/spawned`；② 重跑 T-1 探针（flow 路径三问）；③ T-6 真机 E2E（`flow_send` 冷恢复 + 深度拒绝负例），解除「未执行前不得写真机 PASS」悬置。

## 5. 与 tree-harness 侧的衔接

- 我方《flow 续接试点 E2E 测试方案》（[E2E-PLAN-2026-11-13-flow-continuation-pilot.md](E2E-PLAN-2026-11-13-flow-continuation-pilot.md) v1.1）已把「**P0 = flow 插件适配 rc.3 并重载后单节点 smoke run PASS**」列为第一道执行闸（证据以 flow 仓 smoke 产物为准）；P1 = T-6 真机 PASS。两闸齐备 + 用户批准后我方即开测（续接维 + flow×tree 混合维）。
- 我方试点结果将回写 [REQ §附](REQ-2026-11-13-flow-node-continuable-session.md)，继续遵循「不改 flow 仓代码」边界。

## 6. 时间线（2026-11-13）

| 时间 | 事件 |
|---|---|
| 18:17 | 最后已知真机成功（M1.1 UI gate run `R-m11-ui-20261113-1817` succeeded） |
| 18:17–21:45 | **宿主升级窗口**（rc.1 → rc.3，asar 版本为证；具体重载时刻未逐条考证，以升级窗口论） |
| 21:45–21:55 | flow 仓 T-1 探针执行（agent-1）：flow 路径三问全部 BLOCKED |
| 21:46 | 两次 `E_SESSION_START_FAILED` 失败 run（user/subagent 双 callerOrigin 对照） |
| 22:1x | tree 侧只读核实 + 本跟进单成文（D27） |

## 7. 证据索引

| 证据 | 位置 |
|---|---|
| 探针报告（根因定位全文 + journal seq9 原文） | flow 仓 `evidence/m1/T-m1.2/probe-sop/PROBE-REPORT.md`（untracked，建议随修复提交入库） |
| 失败 run journal ×2 | flow 仓 `.dsh-flow/runs/R-m12-e2e-20261113-2146.jsonl`、`R-m12-sop-2146.jsonl` |
| journal seq9（逐字） | `{"event":"node/settled",...,"payload":{"nodeId":"n1","attempt":1,"status":"failed","error":{"code":"E_SESSION_START_FAILED","message":"startActivation(spawn) failed: Cannot read properties of undefined (reading 'id')",...}}}` |
| rc.3 契约源码行 | asar `dsh-subagent/lib/index.js` L3021–3025 |
| 插件旧形状源码行 | flow 仓 `spike/dsh-flow-plugin/lib/session-executor.js` L295–301 |
| tree 侧登记 | tree-harness 仓 [REQ §附 A 复查 #4](REQ-2026-11-13-flow-node-continuable-session.md)、agent.md §1 D27 行 |

## 8. 边界与约束

- tree 侧**不改 flow 仓任何代码/配置**（用户 2026-11-13 硬约束）；本单所有 flow 仓读操作均为只读。
- 本单不构成对 flow 排期的催办，仅提供事实与建议；修复优先级由 flow 项目组/用户裁决。
- FACT / INFERENCE / UNKNOWN 已逐处标注：§3 `flow_send` 不受影响的判断为 INFERENCE（待真机验证）；升级窗口的具体重载时刻为 UNKNOWN。
