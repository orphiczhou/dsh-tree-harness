# 试点报告 v4：flow 续接（`flow_send` 冷恢复）+ flow×tree 混合流程双维 E2E（D27-FLOW-E2E-PILOT）

> **结论先行：PASS_WITH_RESIDUAL**——续接维（TC-1..8）与混合维（TC-9..11）**全部行为判据 PASS**（含全部 journal 双读字节级一致、冷恢复续接两次成功、depth-6 负例被正确拒绝、无 depth-6 会话）；唯一 residual = **A6（跨会话代发负例）错误码原文因 flow 工具错误面渲染缺口不可观测**，按「代码路径 + 正例对照 + journal 零写入」间接闭环为 PASS_WITH_RESIDUAL。全程无止损触发、无行为失败。
> 执行：D27 接续会话（Lead，zai/glm-5.3-flash·max）+ 任务树 `d27fl`（指挥官 agent-2 / C1a1 / C1a2，全 flash 档）+ 取证子会话（doc-sync、depth-scan）· 2026-11-13 22:2x–23:3x。
> 依据：[E2E 方案 v1.1](../operations/E2E-PLAN-2026-11-13-flow-continuation-pilot.md)（用户已批准）+ [派发任务书](../operations/taskbooks/d27-e2e-dispatch-prompts.md) + flow 回执（[FOLLOWUP-RESPONSE](../operations/FOLLOWUP-RESPONSE-2026-11-13-rc3-adapted.md)）。

---

## 0. 一句话

在宿主 rc.3 × flow 插件适配 × tree-engine v0.10.1（本轮 rc.3 扁平 spec 适配）环境下，用 tree→flow 受控试点验证了 flow M1.2 回执 §3 的「可依赖」三条与「不可依赖」四条**全部成立**：`flow_send` 冷恢复续接两次成功（含「续接 × 内层树」新组合）、不写 journal/不改 run 终态（字节级双读）、跨会话代发被拒、深度封口有效（depth-6 负例被拒）；试点本身还**暴露并当场修复了本仓 tree-engine 同款 rc.3 回归**（v0.10.1）。

## 1. 验收判据总表（A1–A12；双读 = flow journal + 会话日志）

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| A1 | R1 succeeded + integrity=verified + `node/spawned` 落 journal | **PASS** | `flow_status D27FL-R1`：succeeded/integrity=verified；journal 事件序列含 `node/spawned n1/n2`；n1=`bfc3cc8a`（首轮 `{"first":"m12-ready"}`）、n2=`f253b4b7`（`{"second":true}`） |
| A2 | `flow_send` 冷恢复 completed + 续接轮输出 | **PASS** | worker 调用（唯一 1 次）：渲染首行 `[flow_send] run=D27FL-R1 node=n1 session=bfc3cc8a attempt=1 stopReason=completed`；返回 `messageId=9c027315`、`output={"continued":true}`（末条 assistant 纯文本，无 schema 投影=不可依赖③同时得证） |
| A3 | journal 字节+SHA256 发送前后一致 | **PASS** | R1：基线=复核=**11320 字节 / SHA256 `C80BFAEF…39040`**；R2（TC-10 后）：基线=复核=**16290 字节 / 14 行 / SHA256 `149049b7…2382`**；Lead 负例调用后 R1 仍逐字一致 |
| A4 | run 终态/事件数不变 | **PASS** | 发送前后 `flow_status` 均 succeeded/integrity=verified；事件序列无新增 |
| A5 | 目标会话 parentSession = worker（血缘） | **PASS** | worker（C1a1 自己，sess=a6fd41f0）调用 `flow_send` 成功续接 = parentSession 检查通过的血缘实证；n1 sessionId 与 journal `node/spawned` 一致 |
| A6 | 跨会话代发 `E_PERM_DENIED` | **PASS_WITH_RESIDUAL** | commander 与 Lead（root，必非 parent）各打一次均只见占位渲染 `[flow_send] run=? …`——**flow 工具错误面渲染缺口**（错误码不可观测，跨仓反馈项已登记）；间接闭环：`continuation.js:262` 代码路径 + 正例对照 + **Lead 负例调用后 journal 仍 11320 字节逐字一致（零写入=拒绝生效）** |
| A7 | 树 validate 0 issues + doctor 7/7 | **PASS** | `d27fl`/`t27b`/`t27c` 全 0 issues（Lead 复验）；`tree_doctor` 7/7 · **v0.10.1**（受控重载后） |
| A8 | 深度链 ≤5、无 depth-6 会话 | **PASS** | 续接维 self=2/n1=3；混合维 self=2→INNER=3→C2=4→C2a1=5；header 级逐会话取证见 §5（depth-scan 子会话回填） |
| A9 | 报告落盘 + 文档同步 | **PASS** | 本报告 + §8 同步清单（提交 `2d933fb` 后续提交） |
| A10 | 混合 run succeeded + 三树 0 issues | **PASS** | `flow_status D27FL-R2`：succeeded/integrity=verified（INNER 164866ms）；`d27fl`/`t27b`/`t27c` validate 全 0 issues（t27c 探针树仅 root 属正常） |
| A11 | TC-10 续接 × 内层树 | **PASS** | INNER 冷恢复后仍以 `t27b` creator/root 身份只读 validate：`output={"continued":true,"validate_issues":0,"validate_raw":"validate PASS (0 issues)"}`（`tree_status` 只读在续接轮可用；身份判据按 session id，冷恢复不变）；journal 双读一致 |
| A12 | 混合链深度 + depth-6 负例 | **PASS** | C2a1（depth 5）`tree_dispatch` 一次性提交即拒：`E_PORTS_PROTOCOL: ports.dispatch failed: subagent depth 6 exceeds maxDepth 5`（预期结果，非故障）；平方和=385；无 depth-6 会话 |

**汇总：11 PASS + 1 PASS_WITH_RESIDUAL（A6，residual=原文不可观测性，非行为缺口）。TC-5（sessionMode 零注入）经 journal 全文检索 0 命中得证；TC-8（`flow_resume` 边界）为方案内可选项，本轮未执行（成本/信息量权衡，留作后续可选）。**

## 2. 执行实录（会话链与尝试次数）

```text
Lead（be9f4f06，depth 0，zai/glm-5.3-flash·max）
├─ smoke：D27-SMOKE-RC3-001（22:2x，单 session 节点 7336ms PASS → P0 闸解除）
├─ d27fl-C1-commander（7b770460，depth 1，relay=off）——4 轮上报（1 轮暴露 + 3 轮解锁推进）
│  ├─ d27fl-C1a1-worker attempt1（13e097a4）/ attempt2（4bacd512）：E_FLOW_PATH_INVALID ×4（flowPathRoots 未解锁）
│  ├─ d27fl-C1a1-worker attempt3（a6fd41f0，depth 2）：R1 全链 PASS（flow_run + flow_send + 双读）
│  │   └─ flow n1（bfc3cc8a，depth 3）← flow_send 冷恢复成功
│  └─ d27fl-C1a2-worker（321b1876，depth 2，依赖闸经 Lead tree_verify PASS 结算）：R2 全链 PASS
│      └─ flow INNER（626e9e58，depth 3）→ 内层树 t27b：C2（48935242，depth 4）→ C2a1（f9eac533，depth 5）
│                                    └─ 探针树 t27c（root + probe leaf，dispatch 被拒）
```

- 运行环境：DSH 桌面 **0.2.2-rc.3**；flow 插件已适配（flow 仓 `0f60e18`）；tree-engine **v0.10.1**（本仓 rc.3 扁平 spec 适配，`90f3c5b`）；夹具 = flow 仓 m12 逐字节副本（SHA256 `C3CFA838…4AFCA5` 一致）+ 本仓 `demo/t27pilot/`（INNER 节点 `input.agentOptions` 显式 flash 档 zai/glm-5.3-flash·high）。
- 全程 relay=off、失败重试 ≤1、零 cancel、零伪报；5 项口径出入全部留痕（§6）。

## 3. 续接维要点（TC-1..8）

- **冷恢复续接（TC-1/TC-6）**：`flow_send` 对已 succeeded run 的 n1 会话冷恢复成功，`stopReason=completed`、`output={"continued":true}` 为末条 assistant 纯文本（无 schema 投影）——回执「可依赖②」与「不可依赖③」同时实证。
- **不写 journal / 不改终态（TC-2 = A3/A4）**：11320 字节 / SHA256 发送前后逐字一致；`flow_status` 终态与事件数不变；Lead 负例调用后再次复核仍一致（三重复核）。
- **跨会话代发拒绝（TC-3 = A6）**：见 A6 行——拒绝行为有效（journal 零写入），原文不可观测为工具面渲染缺口（residual）。
- **sessionMode（TC-5）**：两份 journal 全文检索 `sessionMode` **0 命中**、无新增事件类型——「缺省不注入、不新增事件」口径实证。
- **父会话存活语义（TC-7）**：同进程同会话链内续接成功即覆盖「存活期」语义；跨重启续接未做（不可依赖①②，方案边界）。
- **TC-8（`flow_resume` 边界）**：可选未执行。

## 4. 混合维要点（TC-9..11，用户 22:0x 指示新增）

- **TC-9 混合链整链回归**：INNER（depth 3）自标识双通道一致（self_spec = `$env:DSH_SESSION_ID` = `626e9e58`）→ `tree_plan t27b` 现场建树 → 自加两叶（**无 `E_BORROWED_IDENTITY`/`E_INVALID_UUID_STRICT`**——flow 回执预登记的撞线情形未发生：leaf_add 归属树创建者，INNER 自建自加合法；rc.1→rc.3 回归保持）→ 派发 C2/C2a1 → 收口。`inner_tree_created_by=flownode-self`、commander/worker 均 succeeded、`inner_tree_validate=0 issues`。
- **TC-10 续接 × 内层树（新能力组合，本试点核心增量）**：worker 对已建内层树的 INNER 节点 `flow_send`（messageId=`f5f6619d`，stopReason=completed），INNER 冷恢复后以 creator/root 身份完成 `t27b` 只读 validate——**节点会话冷恢复后对自建树的操作身份完整保留**；journal 字节级不变。
- **TC-11 深度 + depth-6 负例**：链 2→3→4→5 全程受控；C2a1 depth-6 探针一次性提交即拒（原文 `E_PORTS_PROTOCOL: ports.dispatch failed: subagent depth 6 exceeds maxDepth 5`）；`worker_sum=385`；探针树 t27c 无越权会话。

## 5. 深度链 header 级取证（A8/A12；depth-scan 子会话，多帧 zstd 解码复用 `verify-handoff.mjs` decodeSessionLog）

| sessionId(8) | 角色 | delegationDepth 实测 | parent 实测(8) | 期望一致 |
|---|---|---|---|---|
| 7b770460 | d27fl-C1-commander | 1 | be9f4f06（root） | ✅ |
| a6fd41f0 | d27fl-C1a1-worker（attempt3） | 2 | 7b770460 | ✅ |
| bfc3cc8a | flow n1 | 3 | a6fd41f0 | ✅ |
| 321b1876 | d27fl-C1a2-worker | 2 | 7b770460 | ✅ |
| 626e9e58 | flow INNER | 3 | 321b1876 | ✅ |
| 48935242 | t27b-C2-commander | 4 | 626e9e58 | ✅ |
| f9eac533 | t27b-C2a1-worker | 5 | 48935242 | ✅ |

链路自洽：`be9f4f06 → 7b770460(1) → {a6fd41f0(2)→bfc3cc8a(3)；321b1876(2)→626e9e58(3)→48935242(4)→f9eac533(5)}`，parent 指针与 depth 逐级 +1 完全对应，**7/7 通过**。两字段实测均落首条 `session` 事件（`delegationDepth`/`parentSession`）；13 个近期会话全部解码成功（0 失败）。

**无 depth-6 断言**：22:45 后有更新的 11 个会话 + 强制纳入的 smoke（9fd42ebf）与 doc-sync 子会话（3cdf8e30）共 13 个全部解码，实测最大 `delegationDepth`=5（f9eac533）——**不存在 delegationDepth ≥ 6 的新会话**（A8/A12 满足；depth-6 探针被拒 + 链上无越级会话双证）。

## 6. 暴露问题与口径出入清单（本轮 E2E 的「暴露问题」产出，供与 batch2 一起处置）

### 6.1 已当场修复（本轮闭环）

| # | 问题 | 处置 |
|---|---|---|
| F1 | **tree-engine 派发路径 rc.1 嵌套形状**（与 flow 插件同款）：`E_PORTS_PROTOCOL: reading 'id'`，指挥官首派即暴露 | **v0.10.1 修复**（`buildActivationSpec` 扁平化，227/227，受控重载活体 7/7，提交 `90f3c5b`）；教训：离线单测（fake ports）对宿主 API 形状漂移不可见，真机 E2E 是唯一暴露面 → 候选改进：`tree_doctor` env 检查或 release gate 增加「宿主 startActivation 形状 smoke」 |

### 6.2 跨仓反馈项（flow 侧域，已登记 REQ §附 A 复查 #5）

| # | 问题 | 建议 |
|---|---|---|
| F2 | **flow_send 错误面渲染缺口**：任何失败/拒绝（含 `E_PERM_DENIED`、run 不存在）均渲染为 `[flow_send] run=? …(no assistant text…)`，错误码/message 不可观测——负例判据从调用方侧永远取不到原文 | 错误结果渲染暴露 `code`/`message`（与正例渲染行同层级） |
| F3 | **flow_send 对不存在 run 的退化渲染**（F2 的子case，单列便于回归） | 同上 |
| F4 | `flowPathRoots/runCwd` 语义（ADR-011：runCwd=调用会话宿主侧 cwd，`flow_run.cwd` 参数不参与允许根校验，`tools.js:381`）——「cwd=flow 仓」两次假设被证伪；**文档建议**：flow_run 工具 description 明示「flowPath 必须位于调用会话 cwd（或 flowPathRoots）内」 | 文档 + 可选：`E_FLOW_PATH_INVALID` message 附允许根列表 |

### 6.3 本仓改进候选（与 batch2 相邻，等用户指令一起弄）

| # | 问题 | 候选处置 |
|---|---|---|
| F5 | **verify-delegate 授权面不含 verify 管线的 `event:progress` 写**（delegate 可写 `leaf.verification` 但管线先写 leaf 通信日志 `event:progress`（owner|creator）→ delegate 被拒）——委托验证在「非 creator 指挥官」场景走不通 | 引擎侧：verify 管线的 progress 写纳入 delegate 白名单，或管线对无权限的 progress 写降级为静默跳过（security 留痕权衡待裁决） |
| F6 | **依赖闸操作契约的易踩坑**：下游派发前置 = `tree_verify` 落 PASS（D25 契约），本轮 Lead 任务书误禁 verify 导致混合维被阻两轮——SKILL 已载但任务书模板未内置「派下游前 verify」步骤 | tree-commander SKILL 任务书模板补「依赖闸结算步骤」；`tree_dispatch` 对 `E_DEPENDENCY_NOT_MET` 的 message 已含判据提示（本轮有效） |
| F7 | worker 观测缺口：`tree_node get` 不暴露 events、`tree_log` 不在 leaf 许可清单 → 内层 worker 结果需 commander 转达（本轮合法证据通道，多一跳） | 观测面候选改进（batch2 相邻） |

### 6.4 口径出入（非失败，如实留痕）

1. worker 以 `pwsh` 对 journal 两次只读 UTF-8 提取（flow 输出截 INNER_RESULT 324 字符，零写入）；
2. `worker_probe` 实码 `E_PORTS_PROTOCOL`（任务书预期子串已包含）；
3. INNER 节点实际模型未查（无跨会话元数据查询口；`agentOptions` 已在 DSL 声明，flow 缺省路由未实测）；
4. F2 渲染缺口（同上）；
5. F5 委托面（同上）。

## 7. 与 flow 回执 §3 口径对照（试点实证结果）

| 回执条目 | 试点实证 |
|---|---|
| 可依赖① sessionId 可见 + `node/spawned` 落 journal | ✅（n1/INNER 均实证） |
| 可依赖② `flow_send` 仅发起 run 的直接父会话可用（冷恢复 + 回读） | ✅（worker 两次成功；跨会话被拒见 A6，residual=原文不可观测） |
| 可依赖③ 深度封口 | ✅（depth-6 一次性提交即拒） |
| 不可依赖① 跨进程/跨重启续接 | ✅ 边界成立（未做也不承诺） |
| 不可依赖② 无驻留语义 | ✅（保留 sessionId → 冷恢复形态） |
| 不可依赖③ 续接轮无结构化 schema | ✅（末条 assistant 纯文本） |
| 不可依赖④ `flow_send` 不写 journal / 不改终态 | ✅（两次字节级双读 + Lead 负例三重复核） |
| 不可依赖⑤ `flow_resume` 不续接原会话 | ⏳ TC-8 可选未执行（边界以代码与离线证据为准） |

## 8. 产出物与文档同步

- 本报告；夹具副本 `demo/t27pilot/fixtures/m12-continuable-e2e.flow.json`（SHA256 与原件一致）；`demo/t27pilot/`（flow.json + 3 prompts）；派发任务书 `docs/operations/taskbooks/d27-e2e-dispatch-prompts.md`；暴露清单（§6，并入 batch2 邻接清单待用户指令）；REQ §附 A 复查 #5；playbook §6/§9 试点结论；progress-map §2.4 收官行；agent.md D28/D29 记录。
- 运行证据（保留勿清理）：journal `D27FL-R1.jsonl`（11320B）/`D27FL-R2.jsonl`（16290B）/`D27-SMOKE-RC3-001.jsonl`；树 `d27fl`/`t27b`/`t27c`；会话日志（7b770460/13e097a4/4bacd512/a6fd41f0/321b1876/bfc3cc8a/626e9e58/48935242/f9eac533）。
- **下一步**：等待用户提供实际案例做真项目测试（不得自行编造）。

## 9. FACT / INFERENCE / UNKNOWN

- **FACT**：§1 全表；两次 `flow_send` 冷恢复成功；三树 0 issues；depth-6 负例原文；journal 三重字节级一致；rc.3 双回归（flow+tree）各自修复并真机验证。
- **INFERENCE**：A6 的 `E_PERM_DENIED` 推定成立（代码路径 + 正例对照 + 零写入）；INNER `agentOptions` flash 档已透传（DSL→spec 顶层为 flow 离线断言覆盖，实模型未查）。
- **UNKNOWN**：① `flow_send` 冷恢复时延分布（本轮 completed 即回，未专门测 waitMs 边界）；② A6 原文（等 F2 修复后可复测）；③ TC-8；④ flowPathRoots 配置项在 rc.3 升级后是否曾变化（profile 22:08 变更前后未对照，不影响本试点结论）。

## 10. 变更记录

| 版本 | 时间 | 说明 |
|---|---|---|
| v1.0 | 2026-11-13 23:3x | D27 Lead 收官成文：双维 PASS_WITH_RESIDUAL；暴露清单 F1–F7 |
