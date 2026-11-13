# E2E 测试方案：flow 续接试点（`flow_send` 冷恢复 · D27-FLOW-E2E-PILOT）

> **性质**：测试方案（PLAN）。**状态 = 待用户批准（AWAITING APPROVAL）——批准前不得执行任何 `flow_run`/`flow_send` 活体调用**（用户 2026-11-13 21:48 指示「先方案后测试」）。
> 执行单 = [d24-flow-continuation-pilot-taskbook.md](taskbooks/d24-flow-continuation-pilot-taskbook.md)（步骤与派发任务书正文，本方案只做口径与门禁的权威化，不重复其全文）。
> 起草：D27 接续会话（session_handoff 接替，zai/glm-5.3-flash · max）· 2026-11-13 22:0x。

---

## 0. 一句话

用 tree→flow 受控试点（Lead→commander→worker→flow 节点 n1，深度链 ≤5，双读验收）验证 flow M1.2 `flow_send` 的回执 §3「可依赖」三条与「不可依赖」四条；**当前被一个新发现的宿主升级回归阻断（§1 P0），方案先行成文评审，闸门齐后开测**。

## 1. 当前状态与新阻断事实（FACT，2026-11-13 21:5x 只读核实）

**结论先行：试点在 flow 插件适配宿主 rc.3 之前无法执行。** 这是交接文件（21:51）未载明的新事实，本方案据此新增前置 P0：

| # | 事实 | 证据 |
|---|---|---|
| 1 | 宿主于 2026-11-13 18:17–21:45 之间从 **0.2.2-rc.1 升级到 0.2.2-rc.3**（asar 内 `@deepseek-ai/*` 全部 0.2.2-rc.3；AGENTS.md 冻结基线仍是 rc.1） | flow 仓 `evidence/m1/T-m1.2/probe-sop/PROBE-REPORT.md` §2（agent-1 探针，21:45–21:55） |
| 2 | flow 插件 `spike/dsh-flow-plugin/lib/session-executor.js` L295–301 仍按 rc.1 形状调 `startActivation`（`request:{prompt,parent,...}` 嵌套）；rc.3 契约改为 spec 顶层 `spec.parent`/`spec.maxDepth`/`spec.outputSchema`（asar `dsh-subagent/lib/index.js` L3021–3025）→ **所有 session 节点 1ms 内 `E_SESSION_START_FAILED`**（`Cannot read properties of undefined (reading 'id')`） | 同上 §2（源码行号定位）+ journal seq9 原文 |
| 3 | 两次真机失败 run（同分钟、同错误）：旧 Lead 的 `R-m12-e2e-20261113-2146`（callerOrigin=user，21:46）与探针的 `R-m12-sop-2146`（callerOrigin=subagent，21:46）——总耗时 12ms/…，`integrity=verified`，无任何 `node/spawned` | `flow_list` + flow 仓 `.dsh-flow/runs/*.jsonl` 只读 |
| 4 | 失败面收敛：**只有插件这条旧形状调用路径断**。宿主自身 spawn 通道（`subagent` 工具）不受影响（探针会话本身即 rc.3 派生的活会话，§5 降级探针成功派出孙子会话）；本仓 `tree_*` 工具活体 `tree_doctor` **7/7 · v0.10.0** 正常（22:0x 复验） | PROBE-REPORT §2/§5 + 本仓 `tree_doctor {action:"run"}` |
| 5 | flow 仓 HEAD 仍 = `13776bc`（main），无新提交；`probe-sop/`（T-1 探针证据）与 `reports/project-map-2026-11-13.html` 为 untracked 新文件 | flow 仓 `git log`/`git status` 只读 |

**归位**：这是 **DSH rc.1→rc.3 宿主 API 漂移 × flow 插件未适配** 的兼容性回归，修复属 flow 仓（`spike/dsh-flow-plugin`）责任域；本仓不改 flow 仓代码（用户 2026-11-13 硬约束），只登记与跟进。T-1 探针的「flow 路径」三问因此全部 BLOCKED（其降级 subagent 路径半区见探针报告 §5，回填状态以该文件为准）。

## 2. 范围与目标

- **In scope**：验证回执 §3 三条「可依赖」（① 节点 `sessionId` 可见且 `node/spawned` 落 journal；② `flow_send` 仅发起 run 的直接父会话可用、冷恢复 + 回读输出；③ 深度上限封口）与四条「不可依赖」（不写 journal/不改 run 终态；续接轮无结构化 schema；`flow_resume` 不续接原会话；父会话必须存活——跨进程/跨重启续接明确不在范围）。
- **Out of scope**：不改 flow 仓任何代码/配置；不重载宿主（除非用户在场并明确同意）；不验证多轮续接（回执只承诺「续接」）；不对外提交 issue/PR；不构造 depth-6 主动探针（D23 v3 试点已有真机拒绝证据，本试点只做被动链核对）。
- **验收口径**：任务书 §5 的 A1–A9（双读：flow journal + 会话日志 `delegationDepth`），缺一即不通过；报告限定表述为「同进程父会话存活期间的冷恢复续接」，不得上浮为「flow 节点可续接 = 已支持」。

## 3. 前置条件（执行闸；任一缺失 → STOP 并如实记录）

| # | 闸门 | 内容 | 当前状态 |
|---|---|---|---|
| **P0** | **flow 插件适配宿主 rc.3**（本方案新增） | `session-executor.js` 按 rc.3 spec 形状调 `startActivation`（`parent`/`maxDepth`/`outputSchema` 提到顶层，或按宿主版本分支）；flow 仓提交修复 → 受控 disable→enable 重载 → **单节点 smoke run PASS**（session 节点能启动、journal 出现 `node/spawned`） | ❌ **BLOCKED**（21:5x 两次真机失败 run 为证） |
| P1 | flow 仓 T-6 真机 E2E PASS | `evidence/m1/T-m1.2/` 出现 T-6 真机证据（`flow_send` 真机通过 + 深度拒绝负例），flow 仓 HANDOFF 撤销「未执行前不得写真机 PASS」悬置 | ❌ 未满足 |
| P2 | 用户试点时间窗 + 成本授权 | 用户批准本方案即视为时间窗开启；成本上限 = **2 个子会话（commander/worker）+ 1 个 flow run**，失败最多重试 1 次，不刷 run | ⏳ 待批准本方案 |
| P3 | 本仓门禁 | `tree_doctor` 7/7、`node --test` 225/225、master 与 origin 同步、工作树 clean（22:0x 已复验 doctor 7/7·v0.10.0；试点当日全部复跑） | ✅ 当前满足（当日复跑为准） |
| P4 | 夹具编译语义确认 | 夹具 `m12-continuable-e2e.flow.json` 无显式 `start/end` 的 UNKNOWN 以 flow 方说明为准，不改夹具；探针夹具 `sop.flow.json` 已证明显式 `edges` 收口可编译通过（PROBE-REPORT §1 偏离1）——试点优先直接用仓内夹具，编译失败再按此降级为显式 edges 形态并记录偏离 | ⏳ 试点时向 flow 方确认 |

## 4. 测试矩阵

| # | 用例 | 类型 | 预期 | 对应判据 |
|---|---|---|---|---|
| TC-1 | `flow_send` 冷恢复续接正例（worker→n1） | 正 | 返回 `sessionId/messageId/stopReason=completed/output`，渲染首行含 `attempt=`/`stopReason=`（回执口径差异 2，如实记录）；output 含续接轮预期文本 | A2 |
| TC-2 | journal 不写 + run 终态不变（发送前后双读） | 边界 | journal 字节数与 sha256 前后一致；`flow_status` 终态/事件数不变 | A3/A4 |
| TC-3 | 跨会话代发负例（commander 对 n1 调 `flow_send`） | 负 | `E_PERM_DENIED`（parentSession 检查） | A6 |
| TC-4 | 深度链核对（被动） | 正 | 深度链 1..3（Lead 0 → commander 1 → worker 2 → flow n1 3），逐会话 header `delegationDepth` 核对，**无 depth-6 会话**；flow 侧主动深度负例归 T-6（P1），本试点不重复构造 | A8 |
| TC-5 | `sessionMode` 语义核对 | 正 | 试点 run journal 中无缺省注入的 `sessionMode`、无新增事件类型；出现则记为口径出入（回执 §3 / §附 F 一致性核对） | §附 F |
| TC-6 | 续接轮无结构化 schema | 边界 | `flow_send` output 为新 `turn/end` 后的末条 assistant 纯文本，无 schema 投影 | 不可依赖③ |
| TC-7 | 父会话存活语义 | 边界 | 同进程同会话链内执行即「存活期」语义的自然覆盖；跨重启续接不做（不可依赖①/②） | 不可依赖①② |
| TC-8 | `flow_resume` 边界（可选，低成本） | 边界 | 对已 succeeded 的 run 调 `flow_resume` → `alreadyCompleted=true`（不续接原会话语句如实记录） | 不可依赖⑤ |

## 5. 执行结构（会话与深度；沿用任务书 §2，树号换 d27fl）

```text
Lead/root 会话（depth 0，本会话；发起 tree_plan；不直接调 flow_send/flow_run）
└─ d27fl-C1-commander（depth 1，tree_dispatch；relay=off）
   └─ d27fl-C1a1-worker（depth 2，tree_dispatch；relay=off）   ← 试点关键调用方（flow_run 发起者）
      └─ flow 节点会话 n1（depth 3，flow 执行器 spawn）        ← flow_send 目标
```

- `flow_run`/`flow_send` 必须由 **worker 会话本身**调用（回执 §3 硬限制：调用方 = 发起 run 的会话；commander/root 代发不在支持面——TC-3 反向验证）。
- 树 `d27fl` 全部 leaf `relay:"off"`（等待外部编排前必须关竹节）；runId 固定 `D27FL-R1`；失败最多重试 1 次。
- 全部子会话 flash 档（见 §7），每个 leaf 的任务书正文直接复用试点任务书 §4.1/§4.2（树号/会话名替换为 d27fl）。

## 6. 步骤（概要；细则 = 任务书 §3）

1. **预检**（任一 FAIL → STOP）：P0 smoke 证据复核 → P1 T-6 证据 → P2 用户批准 → P3 本仓四项 → P4 夹具确认。
2. **建树**：`tree_plan d27fl` → commander/worker 两 leaf（relay off）→ `tree_status validate` 0 issues。
3. **派发**：commander 派 worker（任务书 §4.2 全文内联）。
4. **关键序列**（worker）：`flow_run D27FL-R1` → 双读基线（`flow_status` + journal 字节/sha256）→ 从 journal 确认 `node/spawned` 的 sessionId → `flow_send n1` → 双读复核 → commander 负例 TC-3 → `tree_report done`（含 flow_send 原文、journal_unchanged、双读 hexdigest）。
5. **收口**（Lead）：`tree_status harvest` + `validate` 0 issues + `flow_status D27FL-R1` succeeded/integrity=verified → 报告落盘（§9）。

## 7. 模型与通道纪律（用户 2026-11-13 21:48 指示）

- **父会话保持 flash 档**：本会话 = zai-coding-cn/glm-5.3-flash · max（已确认）——规避官方 [#13208](https://github.com/deepseek-ai/deepseek-harness/discussions/13208) 跨模型 `maxTokens` 继承 400。
- **子会话系统性 flash 档**：优先 `deepseek-official/deepseek-flash`；备选 `zai-coding-cn/glm-5.3-flash`。试点 2 个子会话（commander/worker）一律 flash 档。
- **禁用**：opencode-go（周配额 429，约 2026-11-15 重置，期间禁用）；xiaomi/mimo（同踩 #13208）。
- 多模型异族复核不在本试点范围内（试点是行为验证不是代码审计）；报告复核如需异族，另行请示。

## 8. 止损与回滚

| 失败模式 | 处置 |
|---|---|
| P0 类宿主 API 漂移迹象（`E_SESSION_START_FAILED`/`unknown tool` 形状变化） | **立即 STOP**，保留 journal/会话日志现场，按 §1 口径上报，不重试不绕行 |
| `flow_send` `E_PERM_DENIED`（worker 自身被拒） | 属 flow 实现与回执不符 → 记「口径出入」并 STOP 上报 |
| `flow_send` `E_SESSION_BUSY` / `E_CONTINUE_TIMEOUT` | 前者等节点 settle 重试 1 次；后者记录 `messageId{delivered:true}`，不重试超过 1 次 |
| journal 双读不一致 | **试点 FAIL**（违反「不写 journal」）→ 保留现场、上报 flow 项目组 |
| 宿主 HMR 竞态瞬态 `unknown tool` | 按 D24 平台 issue 口径处理（重试一次；不把平台竞态当作试点失败） |
| 试点失败（行为性） | 树保留为证据；`tree_status harvest` 后按需 `tree_node set-status pruned`；journal 永久保留不清理 |

## 9. 产出物

1. 试点报告 `docs/reports/composition-pilot-v4-flow-continuation-<执行日>.md`：结论先行（PASS/FAIL/PASS_WITH_RESIDUAL）、A1–A9 逐条证据、原始输出摘录、FACT/INFERENCE/UNKNOWN、与回执 §3 的出入（若有）。
2. 同步更新：[composition-playbook.md](../guides/composition-playbook.md) §6/§9、[REQ §附](REQ-2026-11-13-flow-node-continuable-session.md)「试点结论」、CHANGELOG/agent.md/progress-map。
3. 试点全部完成后**等待用户提供实际案例做真项目测试**（不得自行编造案例）。

## 10. FACT / INFERENCE / UNKNOWN（方案本身）

- **FACT**：§1 全部五条（rc.3 升级、插件旧形状、两次失败 run、失败面收敛、flow 仓无新提交）；本仓 doctor 7/7·v0.10.0；本会话 flash 档。
- **INFERENCE**：插件适配 rc.3 后，`flow_send` 真机行为应与离线 T-4 证据一致（工具层授权 + 冷恢复 + 输出抽取）——这正是本试点要验证的命题。
- **UNKNOWN**：① flow 插件 rc.3 适配何时完成（flow 仓修复项，等 flow 项目组/用户排期）；② 探针报告 §5 降级半区回填结果（agent-1 属旧会话树，不在本会话树内，无法代催）；③ 夹具 start/end 编译语义（P4，以 flow 方为准）；④ `flow_send` 真机冷恢复对 `waitMs` 的时延分布。

## 11. 变更记录

| 版本 | 时间 | 说明 |
|---|---|---|
| v1.0 | 2026-11-13 22:0x | D27 接续会话起草；纳入 rc.3 回归新事实（P0 新增闸）；待用户批准 |
