# E2E 测试方案：flow 续接 + flow×tree 混合流程试点（`flow_send` 冷恢复 · D27-FLOW-E2E-PILOT）

> **性质**：测试方案（PLAN）。**状态 = 待用户批准（AWAITING APPROVAL，v1.1）——批准前不得执行任何 `flow_run`/`flow_send` 活体调用**（用户 2026-11-13 21:48 指示「先方案后测试」；22:0x 用户指示**补充 flow×tree 混合流程测试维**，见 §4.2）。
> 执行单 = [d24-flow-continuation-pilot-taskbook.md](taskbooks/d24-flow-continuation-pilot-taskbook.md)（续接维步骤与派发任务书正文，本方案只做口径与门禁的权威化，不重复其全文）。
> 起草：D27 接续会话（session_handoff 接替，zai/glm-5.3-flash · max）· 2026-11-13 22:0x · v1.1 同日补混合维。

---

## 0. 一句话

用 tree→flow 受控试点验证 flow M1.2 `flow_send` 的回执 §3「可依赖」三条与「不可依赖」四条（**续接维**），并整体重跑 v3 配置回归 **tree→flow→tree 混合流程** + 新增「续接 × 内层树」用例（**混合维**，用户 22:0x 指示新增）；深度链全程 ≤5，双读验收。**当前被一个新发现的宿主升级回归阻断（§1 P0），方案先行成文评审，闸门齐后开测**。

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

- **In scope（续接维 §4.1）**：验证回执 §3 三条「可依赖」（① 节点 `sessionId` 可见且 `node/spawned` 落 journal；② `flow_send` 仅发起 run 的直接父会话可用、冷恢复 + 回读输出；③ 深度上限封口）与四条「不可依赖」（不写 journal/不改 run 终态；续接轮无结构化 schema；`flow_resume` 不续接原会话；父会话必须存活——跨进程/跨重启续接明确不在范围）。
- **In scope（混合维 §4.2，用户 2026-11-13 22:0x 指示新增）**：① tree→flow→tree 混合链在**宿主 rc.3 修复后**的整链回归（v3 证据链建在 rc.1 上，升级后未复验）；② `flow_send` 续接「已内建内层树的节点会话」——续接轮内该节点会话对其内层树的 tree_* 只读操作可用性（内层树 creator/root 身份随冷恢复保持的验证）；③ 混合链深度核对（含 v3 配置内置的 depth-6 负例，作为宿主升级后 tree 派发深度预算的回归确认）。
- **Out of scope**：不改 flow 仓任何代码/配置；不重载宿主（除非用户在场并明确同意；P0 修复后的重载由 flow 侧/用户执行）；不验证多轮续接（回执只承诺「续接」）；不对外提交 issue/PR；续接维不构造 depth-6 主动探针（混合维按 v3 配置整体重跑时保留其内置负例，属回归而非新增设计）。
- **验收口径**：§7 的 A1–A12（双读：flow journal + 会话日志 `delegationDepth`），缺一即不通过；报告限定表述为「同进程父会话存活期间的冷恢复续接」，不得上浮为「flow 节点可续接 = 已支持」。

## 3. 前置条件（执行闸；任一缺失 → STOP 并如实记录）

| # | 闸门 | 内容 | 当前状态 |
|---|---|---|---|
| **P0** | **flow 插件适配宿主 rc.3**（本方案新增） | `session-executor.js` 按 rc.3 spec 形状调 `startActivation`（`parent`/`maxDepth`/`outputSchema` 提到顶层，或按宿主版本分支）；flow 仓提交修复 → 受控 disable→enable 重载 → **单节点 smoke run PASS**（session 节点能启动、journal 出现 `node/spawned`） | ❌ **BLOCKED**（21:5x 两次真机失败 run 为证） |
| P1 | flow 仓 T-6 真机 E2E PASS | `evidence/m1/T-m1.2/` 出现 T-6 真机证据（`flow_send` 真机通过 + 深度拒绝负例），flow 仓 HANDOFF 撤销「未执行前不得写真机 PASS」悬置 | ❌ 未满足 |
| P2 | 用户试点时间窗 + 成本授权 | 用户批准本方案即视为时间窗开启；成本上限（v1.1 双维合计）= **外层树 3 个 leaf**（commander + 续接维 worker + 混合维 worker）+ **2 个 flow run**（R1 续接夹具 / R2 混合夹具）+ **4 个 flow 派生会话**（n1、INNER、t27b 内层树两 leaf）+ 每维失败最多重试 1 次，不刷 run | ⏳ 待批准本方案（v1.1） |
| P3 | 本仓门禁 | `tree_doctor` 7/7、`node --test` 225/225、master 与 origin 同步、工作树 clean（22:0x 已复验 doctor 7/7·v0.10.0；试点当日全部复跑） | ✅ 当前满足（当日复跑为准） |
| P4 | 夹具编译语义确认 | 夹具 `m12-continuable-e2e.flow.json` 无显式 `start/end` 的 UNKNOWN 以 flow 方说明为准，不改夹具；探针夹具 `sop.flow.json` 已证明显式 `edges` 收口可编译通过（PROBE-REPORT §1 偏离1）——试点优先直接用仓内夹具，编译失败再按此降级为显式 edges 形态并记录偏离 | ⏳ 试点时向 flow 方确认 |

## 4. 测试矩阵

### 4.1 续接维（tree→flow `flow_send` 冷恢复）

| # | 用例 | 类型 | 预期 | 对应判据 |
|---|---|---|---|---|
| TC-1 | `flow_send` 冷恢复续接正例（worker→n1） | 正 | 返回 `sessionId/messageId/stopReason=completed/output`，渲染首行含 `attempt=`/`stopReason=`（回执口径差异 2，如实记录）；output 含续接轮预期文本 | A2 |
| TC-2 | journal 不写 + run 终态不变（发送前后双读） | 边界 | journal 字节数与 sha256 前后一致；`flow_status` 终态/事件数不变 | A3/A4 |
| TC-3 | 跨会话代发负例（commander 对 n1 调 `flow_send`） | 负 | `E_PERM_DENIED`（parentSession 检查） | A6 |
| TC-4 | 深度链核对（被动） | 正 | 深度链 1..3（Lead 0 → commander 1 → worker 2 → flow n1 3），逐会话 header `delegationDepth` 核对，**无 depth-6 会话**；flow 侧主动深度负例归 T-6（P1）与混合维 v3 内置负例，续接维不重复构造 | A8 |
| TC-5 | `sessionMode` 语义核对 | 正 | 试点 run journal 中无缺省注入的 `sessionMode`、无新增事件类型；出现则记为口径出入（回执 §3 / §附 F 一致性核对） | §附 F |
| TC-6 | 续接轮无结构化 schema | 边界 | `flow_send` output 为新 `turn/end` 后的末条 assistant 纯文本，无 schema 投影 | 不可依赖③ |
| TC-7 | 父会话存活语义 | 边界 | 同进程同会话链内执行即「存活期」语义的自然覆盖；跨重启续接不做（不可依赖①/②） | 不可依赖①② |
| TC-8 | `flow_resume` 边界（可选，低成本） | 边界 | 对已 succeeded 的 run 调 `flow_resume` → `alreadyCompleted=true`（不续接原会话语句如实记录） | 不可依赖⑤ |

### 4.2 混合维（tree→flow→tree，用户 2026-11-13 22:0x 指示新增）

**配置来源**：整体复用已验证的 v3 受控试点配置 [demo/t3cpilot3/](../../demo/t3cpilot3/)（`flow.json` 单 session 节点 `INNER` 读 `inner-node.prompt.md` → `tree_plan` 现场建内层树 → 派发 → 收口，内含 depth-6 负例探针），**树号换新 `t27a`（外层）/`t27b`（内层）/`t27c`（负例探针树）** 避免与证据树 t3c7/t3c8/t3c9 冲突；prompt 副本落 `demo/t27pilot/`（执行期生成，仅改树号与路径引用）。v3 证据链建在 rc.1 上，本维 = **宿主 rc.3 修复后（P0）的整链回归 + M1.2 续接能力的组合扩展**。

| # | 用例 | 类型 | 预期 | 对应判据 |
|---|---|---|---|---|
| TC-9 | 混合链整链回归：外层树 worker（depth 2）→ `flow_run R2` → 节点 `INNER`（depth 3）内现场建内层树 `t27b`（depth 4..5）→ 收口 | 正 | `flow_status R2` succeeded / integrity=verified；`t27a`/`t27b`/`t27c` validate 0 issues；行为与 v3 报告判据一致（rc.3 上复验） | A10 |
| TC-10 | **续接 × 内层树**：worker 对 `INNER` 节点会话 `flow_send`（发送前后双读），续接轮 prompt = 对内层树 `t27b` 做 `tree_status {action:"validate"}` 只读操作并一行 JSON 回报 | 正 | 返回 `stopReason=completed` 且 output 含 validate 结果（0 issues）；**节点会话冷恢复后仍保有 `t27b` creator/root 身份**（tree_* 写面护栏按 session id 判定，内层树状态在 profile 落盘、sessionId 冷恢复不变）；journal 双读仍一致 | A11/A3/A4 |
| TC-11 | 混合链深度核对 + depth-6 负例（v3 内置）：全链 `delegationDepth` = 1（commander）→ 2（worker）→ 3（INNER）→ 4（t27b-C2）→ 5（t27b-C2a1）；C2a1 内 `tree_dispatch` 探针 | 负 | 无 depth-6 会话；探针被拒 `E_PORTS_PROTOCOL` 且 message 含 `subagent depth 6 exceeds maxDepth 5`（宿主 rc.3 升级后 tree 派发深度预算回归确认） | A12 |

**执行顺序**：续接维（R1）先行 → 混合维（R2）→ TC-10 续接 INNER。两维由不同 worker leaf 承载（上下文隔离，防单 leaf 竹节/超限）。

## 5. 执行结构（会话与深度；沿用任务书 §2 + v3 混合链，树号 d27fl / t27b）

```text
Lead/root 会话（depth 0，本会话；发起 tree_plan d27fl；不直接调 flow_send/flow_run）
└─ d27fl-C1-commander（depth 1，tree_dispatch；relay=off）
   ├─ d27fl-C1a1-worker（depth 2；relay=off）      ← 续接维调用方：flow_run R1 → flow_send n1（TC-1..8）
   └─ d27fl-C1a2-worker（depth 2；relay=off；依赖 C1a1 done） ← 混合维调用方：flow_run R2 → flow_send INNER（TC-9..11）
      ├─ flow 节点会话 n1（depth 3，flow 执行器 spawn）              ← R1 的 flow_send 目标
      └─ flow 节点会话 INNER（depth 3，flow 执行器 spawn）           ← R2 的 flow_send 目标
         └─ 内层树 t27b-C2-commander（depth 4）→ t27b-C2a1-worker（depth 5，depth-6 负例探针）
```

- `flow_run`/`flow_send` 必须由**发起该 run 的 worker 会话本身**调用（回执 §3 硬限制：调用方 = 发起 run 的会话；commander/root/兄弟 leaf 代发不在支持面——TC-3 反向验证）。
- 树 `d27fl` 全部 leaf `relay:"off"`（等待外部编排前必须关竹节）；runId：续接维 `D27FL-R1`、混合维 `D27FL-R2`；每维失败最多重试 1 次。
- 全部子会话 flash 档（见 §8）；续接维 leaf 任务书正文复用试点任务书 §4.1/§4.2（树号/会话名替换为 d27fl）；混合维 leaf 任务书 = v3 配置 `commander1/worker1/inner-node/commander2/worker2.prompt.md` 副本（仅改树号 t27a/t27b/t27c 与 runId，落 `demo/t27pilot/`）+ 追加 TC-10 续接指令。

## 6. 步骤（概要；细则 = 任务书 §3 + v3 配置 prompts）

1. **预检**（任一 FAIL → STOP）：P0 smoke 证据复核 → P1 T-6 证据 → P2 用户批准 → P3 本仓四项 → P4 夹具确认（R1 用 flow 仓夹具；R2 用本仓 v3 配置副本）。
2. **建树**：`tree_plan d27fl` → commander + 两 worker leaf（relay off，C1a2 依赖 C1a1）→ `tree_status validate` 0 issues。
3. **续接维派发**：commander 派 C1a1（任务书 §4.2 全文内联）→ `flow_run D27FL-R1` → 双读基线 → `flow_send n1` → 双读复核 → commander 负例 TC-3 → `tree_report done`。
4. **混合维派发**：commander 派 C1a2（v3 prompt 副本 + TC-10 指令内联）→ `flow_run D27FL-R2`（INNER 现场建 t27b）→ 三树 validate → `flow_send INNER`（TC-10 续接 × 内层树）→ journal 双读 → `tree_report done`。
5. **收口**（Lead）：`tree_status harvest` + `validate`（d27fl/t27a/t27b/t27c 全 0 issues）+ `flow_status R1/R2` 均 succeeded/integrity=verified → 报告落盘（§9）。

## 7. 验收判据（双读：flow journal + 会话日志 `delegationDepth`；续接维 A1–A9 = 任务书 §5，混合维 A10–A12 为 v1.1 新增；缺一即不通过）

| # | 判据 | 证据 |
|---|---|---|
| A1–A9 | 任务书 §5 原判据（run succeeded/integrity=verified；`flow_send` completed+输出；journal 字节/sha256 双读一致；run 终态不变；血缘 parentSession=worker；跨会话代发 `E_PERM_DENIED`；树 validate 0 issues + doctor 7/7；深度链 ≤5 无 depth-6；报告落盘+文档同步） | 任务书 §5 |
| A10 | 混合维 `D27FL-R2` succeeded / integrity=verified；`t27a`/`t27b`/`t27c` validate 0 issues（v3 判据在 rc.3 上复验） | `flow_status` + `tree_status validate` |
| A11 | TC-10 续接轮：`flow_send` 返回 completed 且 output 含 `t27b` validate 结果（0 issues）；INNER 冷恢复后保有 `t27b` creator/root 身份（只读 validate 成功即证）；journal 双读一致 | 工具返回 JSON + journal hexdigest 对比 |
| A12 | 混合链深度核对：`delegationDepth` 1→2→3→4→5 逐会话核对，无 depth-6 会话；depth-6 负例探针被拒 `E_PORTS_PROTOCOL`（message 含 `subagent depth 6 exceeds maxDepth 5`） | 会话日志扫描 + C2a1 done meta 原文 |

## 8. 模型与通道纪律（用户 2026-11-13 21:48 指示）

- **父会话保持 flash 档**：本会话 = zai-coding-cn/glm-5.3-flash · max（已确认）——规避官方 [#13208](https://github.com/deepseek-ai/deepseek-harness/discussions/13208) 跨模型 `maxTokens` 继承 400。
- **子会话系统性 flash 档**：优先 `deepseek-official/deepseek-flash`；备选 `zai-coding-cn/glm-5.3-flash`。试点全部 leaf（commander / 两 worker / 内层树两 leaf，经 tree_dispatch `assignee` 显式指定）一律 flash 档；flow 节点会话（n1/INNER）由 flow 执行器 spawn，其模型/路由由 flow 配置决定，如实记录（若不可控则记为口径边界）。
- **禁用**：opencode-go（周配额 429，约 2026-11-15 重置，期间禁用）；xiaomi/mimo（同踩 #13208）。
- 多模型异族复核不在本试点范围内（试点是行为验证不是代码审计）；报告复核如需异族，另行请示。

## 9. 止损与回滚

| 失败模式 | 处置 |
|---|---|
| P0 类宿主 API 漂移迹象（`E_SESSION_START_FAILED`/`unknown tool` 形状变化） | **立即 STOP**，保留 journal/会话日志现场，按 §1 口径上报，不重试不绕行 |
| `flow_send` `E_PERM_DENIED`（worker 自身被拒） | 属 flow 实现与回执不符 → 记「口径出入」并 STOP 上报 |
| `flow_send` `E_SESSION_BUSY` / `E_CONTINUE_TIMEOUT` | 前者等节点 settle 重试 1 次；后者记录 `messageId{delivered:true}`，不重试超过 1 次 |
| journal 双读不一致 | **试点 FAIL**（违反「不写 journal」）→ 保留现场、上报 flow 项目组 |
| 混合维 INNER 建树失败 / depth-6 负例未被拒 | 前者按 v3 §6 失败模式处置并记 rc.3 回归出入；**后者 = 宿主升级回归新证据**，立即 STOP 上报（不得当作试点内失败吞掉） |
| 宿主 HMR 竞态瞬态 `unknown tool` | 按 D24 平台 issue 口径处理（重试一次；不把平台竞态当作试点失败） |
| 试点失败（行为性） | 树保留为证据；`tree_status harvest` 后按需 `tree_node set-status pruned`；journal 永久保留不清理 |

## 10. 产出物

1. 试点报告 `docs/reports/composition-pilot-v4-flow-continuation-and-hybrid-<执行日>.md`：结论先行（PASS/FAIL/PASS_WITH_RESIDUAL）、A1–A12 逐条证据、原始输出摘录、FACT/INFERENCE/UNKNOWN、与回执 §3 的出入（若有）、rc.3 修复后混合链回归结论。
2. 同步更新：[composition-playbook.md](../guides/composition-playbook.md) §6/§9、[REQ §附](REQ-2026-11-13-flow-node-continuable-session.md)「试点结论」、CHANGELOG/agent.md/progress-map、demo/t27pilot/ 配置入库。
3. 试点全部完成后**等待用户提供实际案例做真项目测试**（不得自行编造案例）。

## 11. FACT / INFERENCE / UNKNOWN（方案本身）

- **FACT**：§1 全部五条（rc.3 升级、插件旧形状、两次失败 run、失败面收敛、flow 仓无新提交）；本仓 doctor 7/7·v0.10.0；本会话 flash 档；v3 混合判据建在 rc.1 上（升级后未复验）。
- **INFERENCE**：插件适配 rc.3 后，`flow_send` 真机行为应与离线 T-4 证据一致（工具层授权 + 冷恢复 + 输出抽取）——这正是本试点要验证的命题；INNER 冷恢复后 session id 不变，内层树 creator/root 判据（按 session id）应保持。
- **UNKNOWN**：① flow 插件 rc.3 适配何时完成（flow 仓修复项，等 flow 项目组/用户排期，跟进单已备）；② 探针报告 §5 降级半区回填结果（agent-1 属旧会话树，不在本会话树内，无法代催）；③ 夹具 start/end 编译语义（P4，以 flow 方为准）；④ `flow_send` 真机冷恢复对 `waitMs` 的时延分布；⑤ 冷恢复节点会话对**升级前创建**的内层树工具面状态是否完全等价（TC-10 用升级后新建的 t27b 回答升级后场景；跨升级续接不在范围）；⑥ flow 节点会话（n1/INNER）的模型路由是否可由 flow 配置指定为 flash 档（不可控则记口径边界）。

## 12. 变更记录

| 版本 | 时间 | 说明 |
|---|---|---|
| v1.0 | 2026-11-13 22:0x | D27 接续会话起草；纳入 rc.3 回归新事实（P0 新增闸）；待用户批准 |
| v1.1 | 2026-11-13 22:1x | **应用户指示补充 flow×tree 混合流程测试维**：新增 §4.2（TC-9 混合链回归 / TC-10 续接×内层树 / TC-11 深度+depth-6 负例）、验收 A10–A12、执行结构加 C1a2 worker 与 t27b 内层树、成本授权更新（3 leaf + 2 run + 4 flow 派生会话）、止损加「depth-6 未被拒=宿主回归新证据」条款；配合《rc.3 回归跟进单》成文 |
