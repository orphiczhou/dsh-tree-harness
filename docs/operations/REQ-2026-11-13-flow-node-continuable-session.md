# 跨仓需求单：flow 节点会话支持「非一次性 / 可续接」（continuable）

> **提出方**：`D:\Codes\dsh-tree-harness`（tree-engine / session-tree 项目，Lead 会话）
> **受理方**：`D:\Codes\DSH动态流程引擎插件`（自由流程引擎项目组）
> **日期**：2026-11-13 · **状态**：**已受理并对接受控**（flow 项目组 2026-11-13 16:21 回执；用户裁决 **B 档**；flow 侧 **M1.2 离线交付已提交**（`2918fba`/`13776bc`，kernel 287/287 · plugin 175/175），**真机 T-6 待收口**）——本文件只登记需求，不改动 flow 仓任何代码/配置
> **用户指示**（2026-11-13）："不要改动，这话不是你这个项目的活，你把需求写下来，联系那边项目组响应。"
>
> 本仓镜像（权威副本）：`dsh-tree-harness/docs/operations/REQ-2026-11-13-flow-node-continuable-session.md`

---

## 1. 一句话

flow 的 session 节点目前是**一次性子会话**（单轮、节点结束即 dispose）；tree ↔ flow 组合场景需要**可选**的「可续接会话」模式（节点结束不销毁、允许后续 sendMessage 续接同一会话），默认行为必须保持现状不变。

## 2. 现状（FACT，附代码位置）

| 事实 | 证据 |
|---|---|
| 节点会话由 `subagents.startActivation({provider:'spawn', delivery:'caller'})` 创建 | `spike/dsh-flow-plugin/lib/session-executor.js:258-270` |
| 节点会话的单轮结果 `await activation.result` 后，**`finally` 中 `dispose()`** 释放 | 同文件 `:280-313`（`dispose` 定义 `:280-289`，调用在 `finally` `:310-312`） |
| 节点失败/超时/取消同样走 dispose，不留活会话 | 同上 |
| `flow_resume` 的恢复语义是**重跑节点**（attempt+1、新会话），不是续接原会话 | flow 仓 `docs/04-架构设计.md` / journal 行为；ADR-015 adopt 仅做**只读认领**（`session-executor.js:316-381`） |
| 一次性语义是 flow 引擎实现选择，非平台强制（tree leaf 天然 continuable） | tree 仓 `docs/guides/composition-playbook.md` §6 |

## 3. 需求场景（为什么需要）

| # | 场景 | 今天的代价 |
|---|---|---|
| S1 | 节点需要**多轮**产出：先派发子任务/等外部编排，拿到结果后再做第二次决策或补救 | 只能在单 turn 内轮询工具；轮询预算用尽即失败，无法跨 turn 续接 |
| S2 | 节点需要**人工/外部回执**（gate 在 tree leaf 内不可用，R2） | 只能放 root 会话；节点内轻量回执不可行 |
| S3 | 节点超时/中断后想**接着原会话继续**而非重跑 | resume=新会话重跑，成本翻倍且丢失上下文 |
| S4 | tree→flow→tree 组合中，内层树收口时间可能晚于 flow 节点轮询预算（本仓 2026-11-13 试点 v2 场景） | 节点 dispose 后无法二次接续，只能整条 run 重跑 |

## 4. 需求描述（建议形态，具体设计由 flow 项目组定）

1. 节点级可选配置：`sessionMode: "caller" | "continuable"`（缺省 `caller` = 现状，**逐字节兼容**）。
2. `continuable` 模式下：
   - 执行器改用可续接原语（`subagents.startContinuable` 或等价），或保留 activation 句柄 + `subagents.sendMessage` 能力；
   - 节点的 **run 终态** 与 **会话生命周期** 解耦：run 结束/节点 settled 后不立即 dispose，由显式策略回收（run 结束、TTL、或调用方显式 close）；
   - journal 记录 `sessionId` 与 `sessionMode`，保持 hash 链与「run 终态唯一权威」不变；
   - 取消（`exec.signal` abort）仍必须释放会话，不得泄漏。
3. `flow_resume`/adopt 语义需明确：continuable 会话在 resume 时是「续接原会话」还是「新建会话」，二者必须文档化并有验收用例。
4. 预算/并发口径：continuable 会话应计入 `maxActiveSubagents` 等预算，并有回收兜底（防悬挂会话）。
5. 兼容性：`sessionMode` 缺省时不改变任何现有行为（现有 147/147 插件用例、278/278 内核用例必须原样通过）。

## 5. 非目标

- 不改 journal v2 双序/哈希链、不改 gate（human_gate）语义、不改 permTier 计算。
- 不要求跨进程/跨重启续接（可作为后续独立提案）。
- 不强制所有节点默认 continuable（保持 opt-in）。

## 6. 建议验收标准（供受理方裁剪）

| # | 验收点 |
|---|---|
| A1 | `sessionMode` 缺省时行为与现状逐字节一致（现有测试全绿，无新增警告） |
| A2 | `continuable` 节点：单轮结束后可通过续接消息继续同一会话并产出最终 output；节点终态判定与 journal 一致 |
| A3 | 超时/取消路径仍 dispose（无泄漏；可用会话查询验证无残留活会话） |
| A4 | `flow_resume` / adopt 语义文档化 + 边界用例（含 `E_ADOPT_*` 不变） |
| A5 | journal 记录 mode/sessionId，hash 链校验通过，0-tests 假绿拦截仍生效 |
| A6 | 真机 E2E（至少 1 条：节点多轮续接 → run succeeded） |

## 7. 风险与替代方案（我方已知）

- **不改的代价可接受部分**：单 turn 内轮询 + 外部产物落盘可覆盖多数编排场景（本仓试点已用此法）。
- **替代方案**：节点内再起子会话（受 `maxDepth=5` 与预算限制，且属于组合深化，不适合作为通用解）。
- **主要风险**：会话回收责任从 flow 执行器转移到调用方后，若 TTL/回收策略缺失会泄漏活会话（预算护栏会先撞上，表现为 `ACTIVATION_LIMIT_REACHED`）。

## 8. 对接方式（请 flow 项目组响应）

1. 受理：在 flow 仓 `docs/09-PRD输入与待决策清单.md` 或 `docs/08-需求说明.md` 登记本条需求（编号/CR），并按 flow 仓 `AGENTS.md` 的 Lead 独占 docs 纪律处理。
2. 回执：把受理结论（采纳/不采纳/排期）写回 flow 仓 `evidence/requirements/` 下同主题文件，或经用户转达本仓 Lead 会话。
3. 我方配合：提供 tree 侧工具面兼容说明、组合试点配置（`demo/t3cpilot2/`）与组合剧本（`docs/guides/composition-playbook.md` §6），可协助设计验收用例。
4. **本文不构成开工授权**：是否启动、何时启动由用户裁决（用户 2026-11-13 已明确本周期不动 flow 仓代码）。

## 9. 附：同路径的深度上限发现（请一并受理）

2026-11-13 三层试点 v2 实测：深度 5 的 worker 再起 flow 节点（应为 depth 6）**未被平台拒绝**，子会话被成功创建（`delegationDepth=6`）。
根因：`dsh-subagent` 服务端仅校验调用方显式传入的 `request.maxDepth`（`lib/index.js:1402/1405`；配置读取 `resolveMaxDepth` 仅供工具层 `dsh-tool-subagent:452-462` 使用）；
flow 执行器构造 request 时**未传 `maxDepth`**（`spike/dsh-flow-plugin/lib/session-executor.js:250-266`）→ profile `subagent.maxDepth=5` 对 flow 节点会话不生效。

**请求**：flow 执行器在构造 `request` 时传入 `maxDepth`（来源：flow 配置项，缺省 5；与 tree-engine 侧同类修复对齐）。
**影响**：flow→tree / tree→flow→tree 组合的深度安全目前依赖人工纪律；无上限可能导致编排失控（并发预算仍兜底，但深度语义失效）。
**进展（2026-11-13 晚）**：tree-harness 侧已修复并发布到本仓工作树（**tree-engine v0.8.1**：dispatch/竹节接力/攻击会话显式传 `request.maxDepth`，缺省 5、`TREE_ENGINE_CONFIG.max_subagent_depth` 可覆盖；测试 172/172）。flow 侧仍待受理——**tree 修复不会约束 flow 节点的 spawn**，故 `tree→flow→tree` 最深 worker 再起 flow 节点仍是未封口路径。
**证据**：`dsh-tree-harness/docs/reports/composition-pilot-v2-live-create-2026-11-13.md` §5（含 asar 代码行与实测会话 header）。

## 10. 证据索引

- flow 节点一次性语义：`D:\Codes\DSH动态流程引擎插件\spike\dsh-flow-plugin\lib\session-executor.js:258-313`
- adopt 只读认领边界：同文件 `:316-381`
- tree 组合剧本 §6（一次性→非一次性方向，用户 2026-11-12 已示意）：`D:\Codes\dsh-tree-harness\docs\guides\composition-playbook.md:85-93`
- 本仓试点 v2（内层树由 flow 节点现场创建）：`D:\Codes\dsh-tree-harness\demo\t3cpilot2\`、报告 `docs/reports/composition-pilot-v2-live-create-2026-11-13.md`
- 本仓试点 v3（v0.8.1 深度封口真机回归，含 flow 侧仍未封口的复述）：`docs/reports/composition-pilot-v3-depth-cap-2026-11-13.md`

## 附：受理跟进与回执摘要（tree-harness 侧只读核查，不改 flow 仓代码）

### A. 受理状态（FACT）

| 时间 | 事件 | 证据 |
|---|---|---|
| 2026-11-13 14:51 | 本需求单递交 flow 仓 `evidence/requirements/REQ-2026-11-13-continuable-session.md`（副本） | flow 仓 untracked 文件 |
| 2026-11-13 15:42 / 16:24 | tree-harness 两次只读核查：**未受理**（无回执、无提交引用） | D23 轮记录 |
| **2026-11-13 16:21** | **flow 项目组出具受理回执** `RECEIPT-2026-11-13-to-tree-harness.md`（7031 B）：**已受理，用户裁决 B 档**；权威登记 flow 仓 `docs/08` §0 D20、台账 §8.5 `CR-2026-11-13-02`、`docs/11` §15.2 | 仓内副本 [RECEIPT-2026-11-13-from-flow-engine.md](RECEIPT-2026-11-13-from-flow-engine.md)（与 flow 仓副本 **SHA256 完全一致**：`F6ED66893B6EEDD449A1BC7AC3E04E987488A49DD9CAA87D56E71A3CB55D3F4A`） |
| 2026-11-13 17:38 | flow 仓另增通知站插件需求单（与本单无关） | `REQ-2026-11-13-notification-hub-plugin.md` |
| 2026-11-13 18:41（本仓复查） | flow 仓 `git log` 仍未见 M1.2 提交；**回执已到、正在做**（用户告知） | flow 仓 `git status`/`git log` 只读 |
| **2026-11-13 18:52（本仓复查，只读）** | flow 仓工作树 `git status` + `evidence/m1/T-m1.2/` + `spike/dsh-flow-plugin/lib/continuation.js` | **M1.2 已实质实现（未提交）**：① 深度封口 `session-executor.js`（`resolveProfileMaxDepth` + provider 能力守卫 + `E_SESSION_DEPTH_EXCEEDED` 映射，证据 `T-2-DEPTH.md`）；② `flow_send` 续接入口 `lib/continuation.js`（纯函数抽象：授权→发送→轮询→抽取；不写 journal；证据 `T-4-FLOW-SEND.md`）；③ 证据与 mutation 原始输出在 `evidence/m1/T-m1.2/`（含 T-3-SESSION-MODE、GLM 复核两份）；④ 插件套件当前 `169/170`，唯一失败 = `m1-judge.test.mjs:140` 的「4 件套」计数断言（`flow_send` 加入后工具面 4→5 的已知残留，待 flow Lead 裁决）。**回执 §1 排期正在兑现。** | flow 仓工作树/证据目录只读核查 |

| **2026-11-13 19:0x（D24 接续会话复查 #2，只读）** | flow 仓 `git log`/`git status`/`evidence/m1/T-m1.2/`/`lib/continuation.js` 只读核查 | **M1.2 离线交付已提交**：`2918fba`（2026-11-13 18:49:28，T-2/T-3/T-4 代码+证据+测试）+ `13776bc`（18:53:52，docs/11 v1.37 与口径同步）；HEAD=`13776bc`（分支 `main`），工作树仅剩历史 HANDOFF 与报告 HTML 未跟踪，**无未提交代码**。基线：内核 **287/287**、插件 **175/175**、qa-gate PASS（floor 287/175）；18:52 记的 `m1-judge.test.mjs:140` 4→5 计数残留**已修**（插件 170→175 全绿）。**未完成**：T-1 续接探针、T-6 真机 E2E（flow 仓 HANDOFF-M1 明写「需用户在场 + 最后一次重载；未执行前不得写真机 PASS」）。**结论：回执 §1 排期已兑现到「离线交付」；真机未收口，不等同可依赖。** 详见 §附 F。 | flow 仓 `git show --stat 2918fba/13776bc`、`evidence/m1/T-m1.2/raw/lead-*.txt`、`HANDOFF-M1.md` 只读 |

| **2026-11-13 21:00（D26 接续会话复查 #3，只读）** | flow 仓 `git log`/`git status` 只读 + `evidence/m1/T-m1.2/` 目录清单 + 联调夹具全文核对；本仓 `tree_doctor` 与 225 测试基线复跑 | flow 仓 HEAD 仍=`13776bc`（main），工作树仅历史 HANDOFF×5 与报告 HTML 未跟踪，**无新提交**；`evidence/m1/T-m1.2/` 仍只有 T-2/T-3/T-4 离线证据 + 夹具 + GLM 复核，**无 T-6 真机文件 → 试点前置② 仍未满足，维持等待态不抢跑**；夹具 `m12-continuable-e2e.flow.json` 与 §附 F 描述逐字一致（n1→n2 两 session 节点；n1 首轮 prompt 出 `{"first":"m12-ready"}`、schema required `first:string`；n2 出 `{"second":true}`、required `second:boolean`；**无显式 start/end**——试点任务书 §8 的 UNKNOWN 未消解，届时以 flow 方说明为准，不改夹具）；本仓门禁：`tree_doctor` 7/7 · v0.10.0、`node --test` 225/225（4.7s）、master=4338bd0 与 wip/d24-p2a-batch1=699e02d 均与 origin 同步（0/0）、树 clean。T-1 续接探针同样未见执行痕迹 | flow 仓 git 只读 + 证据目录 glob + fixtures 只读 + `tree_doctor {action:"run"}` + `node --test tests/*.test.js` |

| **2026-11-13 21:5x（D27 接续会话复查 #4，只读）** | flow 仓 `git log`/`git status` + `evidence/m1/T-m1.2/probe-sop/` 新增目录只读 + 本仓 flow run 清单（`flow_list`）+ `tree_doctor` 复验 | **T-1 探针已执行但 flow 路径被环境回归阻断**：宿主于 18:17–21:45 之间升级 **0.2.2-rc.1 → 0.2.2-rc.3**，flow 插件 `spike/dsh-flow-plugin/lib/session-executor.js` L295–301 仍按 rc.1 形状调 `startActivation`（`request:{parent,...}` 嵌套），rc.3 契约在 spec 顶层读 `spec.parent` → **所有 session 节点 1ms 内 `E_SESSION_START_FAILED`**。两次真机失败 run（同分钟同错误）：`R-m12-e2e-20261113-2146`（21:46，callerOrigin=user）+ `R-m12-sop-2146`（21:46，callerOrigin=subagent，探针 run），均 `integrity=verified`、无 `node/spawned`。失败面收敛：**仅插件旧形状调用路径断**；宿主自身 spawn 通道与本仓 `tree_*` 工具不受影响（`tree_doctor` 7/7 于 rc.3 上复验通过）。flow 仓 HEAD 仍=`13776bc`，`probe-sop/`（探针证据，PROBE-REPORT §2 含 asar 源码行号定位）与 `reports/project-map-2026-11-13.html` 为 untracked 新文件。**影响：试点前置在 §附 F 两条之上新增「插件适配 rc.3」P0 闸；修复属 flow 仓责任域，本仓不改 flow 代码，已在 [E2E-PLAN-2026-11-13-flow-continuation-pilot.md](E2E-PLAN-2026-11-13-flow-continuation-pilot.md) §1/§3 登记** | flow 仓 git/evidence 只读 + `flow_list` + probe-sop/PROBE-REPORT.md 只读 + `tree_doctor {action:"run"}` |

| **2026-11-13 22:3x–23:0x（D27 执行轮复查 #5）** | flow 回执核对（`FOLLOWUP-RESPONSE-2026-11-13-rc3-adapted.md`）+ Lead smoke + 建树 d27fl + E2E 指挥官两轮派发（agent-2） | **回执要点**：flow 修复入库 `0f60e18`/`1fae8fc`；**P4 已答**——夹具无显式 start/end 合法（引擎按 edges 自动合成 `__start/__end`，实证于失败 run journal seq1）；节点模型可经 DSL `input.agentOptions` 指定（本仓 t27pilot INNER 已显式 flash 档）；**E_BORROWED_IDENTITY × TC-9 撞线预登记**（撞线按 tree-engine 边界出入记，不算试点失败）；对账口径（t27b 两 leaf = INNER 派生的孙会话）。**P0 实证**：Lead smoke `D27-SMOKE-RC3-001`（22:2x）succeeded/`node/spawned` 落 journal → 适配已生效（重载 #5 已发生）。**执行暴露两问题（记入暴露清单）**：① `E_FLOW_PATH_INVALID`——flowPathRoots/runCwd 允许根不覆盖「cwd=树仓 + flowPath=flow 仓」组合，R1 cwd 改指 flow 仓解锁（旧 Lead 21:46 run 即此形态，回溯印证）；② flow_send 对**不存在 run** 返回退化为 `[flow_send] run=? …(no assistant text…)` 而非干净 not-found 错误码（跨仓反馈项，低severity）。**本仓同款 rc.3 回归**：指挥官派发暴露 tree-engine 嵌套形状 `E_PORTS_PROTOCOL: reading 'id'` → **v0.10.1 修复**（buildActivationSpec，227/227，受控重载活体 7/7）→ 指挥官重派成功运行中。**依赖闸操作契约教训**：指挥官派下游 leaf 前必须 `tree_verify` 落 PASS（D25 契约/SKILL 已载），本轮任务书误禁导致混合维被阻一轮，已解禁续行 | 本仓 smoke journal + `tree_doctor`/`tree_status` 活体 + flow 回执文件 + agent-2 done meta |

### B. 回执要点（FACT，以 flow 回执原文为准）

| 来函项 | flow 结论 | 排期/条件 |
|---|---|---|
| 需求一（节点会话可续接，opt-in） | **采纳**，形态更正为：新增 **`flow_send` 工具**（发起 `flow_run` 的父会话 → 该 run 某节点会话，**冷恢复 + 回读输出**）；**不提供**"节点结束不销毁/保持活句柄"的驻留语义（宿主无此形态） | M1.2（3–5 人日，含深度项）；排在 M1.1 真机收口之后；工具面 4→5 的 CR 例外已获用户批准 |
| 需求二（`maxDepth` 未传 → 深度上限失效） | **采纳**，且比来函所述更严重：**不是默认值未生效，而是完全不校验（无上限）** | M1.2 首批（0.5–1 人日）；语义 = 复用 profile `subagent.maxDepth`（本机 5），超限 fail-closed，新增 `E_SESSION_DEPTH_EXCEEDED`；flow 侧按**能力感知**传值（仅 provider 声明 `capabilities.depthLimit` 时传） |
| §9 深度修复请求 | **采纳**（同上） | 同上 |

### C. 回执对来函的三处事实更正（FACT；本仓文档已按此口径改写，见 [composition-playbook.md](../guides/composition-playbook.md) §6）

1. **不存在 `startContinuable`**：宿主启动唯一入口 = `startActivation`；续接唯一原语 = `subagents.sendMessage` → 非驻留目标走 `coldResume`。本单原文引用的 `:1402/:1405` 实为 `assertSubagentMaxDepth` / `resolveChildDepth`（均在 `startLocal` 内）。
2. **`dispose()` ≠ 销毁会话**：`dispose` 只释放驻留 + 槽位（自然 settle 也走同一事务）→ 可靠形态只能是「保留 `sessionId` → 之后冷恢复续接」；前置 = `sessionPersistence` + `sessionQuery` + descriptor `continuable` + **目标子会话的直接父 Agent 存活**。故"保留 activation 句柄 + sendMessage"不可实现。
3. **深度语义**：不传 `maxDepth` = **完全不比较 = 无上限**；配置值由**工具层**注入，任何直呼 `startActivation` 的插件须自己 `resolveMaxDepth(...)` 后显式传，且有 provider 能力前置。

### D. 我方配合事项（回执 §4；待办）

1. ✅ 组合剧本 [composition-playbook.md](../guides/composition-playbook.md) §6 已按回执 §3 口径改写（"非一次性"措辞作废，改为 `flow_send` 冷恢复 + 硬限制清单）。
2. ⏳ 若 tree-engine 侧要跨"父会话存活期"续接 flow 节点：调用方必须是**发起 `flow_run` 的会话本身**（tree→flow 场景即该 tree worker），跨会话（sibling/root 代发）不在支持面——待 M1.2 联调时在试点中确认。
3. ✅ M1.2 离线落地后已取得联调夹具（`evidence/m1/T-m1.2/fixtures/m12-continuable-e2e.flow.json`）与三份任务证据 + 两份 GLM 复核；口径核对见 §附 F。
4. ✅ 回执已双份留存：本仓 [RECEIPT-2026-11-13-from-flow-engine.md](RECEIPT-2026-11-13-from-flow-engine.md)（SHA256 与 flow 仓副本一致）+ flow 仓 `evidence/requirements/RECEIPT-2026-11-13-to-tree-harness.md`。

### E. 约束（延续用户指示）

tree-harness 侧**不修改 flow 仓代码**、不代提交流；本文件与 flow 仓副本保持同源。flow 侧 M1.2 的实现与真机证据由 flow 项目组负责（其 `evidence/m1/T-m1.2/`）。本仓后续动作：M1.2 落地后（a）按新口径补一次 tree→flow 续接受控试点；（b）若 flow_send 形态与 §3 口径有出入，再更新本节与 playbook。

### F. M1.2 离线交付核对（tree 侧只读，2026-11-13 19:0x；供试点前复用）

**结论先行**：回执 §3 的「可依赖 / 不可依赖」口径与本仓只读看到的实现**一致**（无实质出入，仅两处实现细节需在试点报告里如实标注）；**T-6 真机未完成前不做续接试点**（避免把「离线绿」误当「可依赖」）。

| 回执 §3 条目 | flow 实现（FACT，只读核对） | 判定 |
|---|---|---|
| 可依赖① `sessionId` 可见且 `node/spawned` 落 journal | `lib/tools.js` `flow_send` 执行器调 `inspectRunIntegrity` 后由 `findSpawnedSessionId(entries,{nodeId,attempt})` 解析；**不允许调用方直接传 sessionId** | ✅ 一致（比回执更严：解析失败 `E_INVALID_ARGUMENT`） |
| 可依赖② `flow_send` 仅发起 run 的直接父会话可用 | `lib/continuation.js:262` `header.parentSession === caller` 才放行，否则 `E_PERM_DENIED`；`live===true` → `E_SESSION_BUSY`；发送前快照+轮询 `readSession` 至新 `turn/end` | ✅ 一致（跨会话/兄弟/root 代发均被 parentSession 检查拒） |
| 可依赖③ 深度上限封口 | `lib/session-executor.js` 取 `resolveMaxDepth(undefined)`（profile=5）+ provider `capabilities.depthLimit` 能力守卫；`SubagentDepthError` → 新具名 `E_SESSION_DEPTH_EXCEEDED` | ✅ 一致 |
| 不可依赖① 跨进程/跨重启续接 | 未涉及（`flow_send` 依赖调用期 `exec.agent` + 宿主 `sendMessage` 冷恢复，父 Agent 不存活即不可用） | ✅ 一致（真机未验） |
| 不可依赖② 不提供「节点结束不销毁」驻留语义 | 未实现驻留；仅「保留 sessionId → 冷恢复」 | ✅ 一致 |
| 不可依赖③ 续接轮无结构化 `outputSchema` | `flow_send` 输出 = 新 `turn/end` 且 `reason.kind==='completed'` 后、基线下标之后的末条 assistant text（无 schema 投影） | ✅ 一致 |
| 不可依赖④ `flow_send` 不写 journal / 不改 run 终态 | `execute` 仅 `resolveRunTarget(create:false)` + `inspectRunIntegrity`（读路径）+ `readSession`；用例 7 做磁盘 journal 字节级断言 | ✅ 一致 |
| 不可依赖⑤ `flow_resume` 仍不续接原会话 | 本批未改 `flow_resume` 语义 | ✅ 一致 |

**实现细节差异（试点报告需如实标注，不影响口径）**：
1. 新增错误码 `E_SESSION_BUSY` / `E_CONTINUE_TIMEOUT` 为**插件层** `E_*`，未登记 flow-core `errors.js`（与 `E_SESSION_START_FAILED`/`E_ADOPT_*` 同属插件层，不进内核闭集）；
2. `flow_send` 渲染首行用 `attempt=<n>`/`stopReason=<…>` 替代契约建议的 `turn=<n>`（返回契约无 turn 字段）；
3. 消息上限 `MAX_MESSAGE_CHARS=256KB`（回执未写，属 flow 侧对抗复核新增的防滥用约束——本仓组合剧本引用时应写「≤256KB」）。

**离线联调夹具（已可取，只读）**：`D:\Codes\DSH动态流程引擎插件\evidence\m1\T-m1.2\fixtures\m12-continuable-e2e.flow.json`（n1→n2 两 session 节点，节点 n1 首轮出 `{"first":"m12-ready"}`；真机 E2E 时父会话对 n1 sessionId 发第二条消息）。**注意**：该夹具无显式 `start`/`end` 节点（flow-core 对首尾节点的隐式处理），试点时若用本仓夹具需先经 flow 侧确认编译语义，不自行猜测。

**本仓下一步（等信号，不抢跑）**：
- 触发条件（2026-11-13 22:1x 更新）= **① flow 插件适配宿主 rc.3 `startActivation` spec 形状并重载后单节点 smoke run PASS（当前 BLOCKED，跟进单已交用户转交 flow 项目组，见 §附 A 复查 #4）+ ② flow 侧 T-6 真机 PASS**；~~③ 用户批准 E2E 测试方案并给出试点时间窗~~（**✅ 22:1x 已批准 v1.1 = P2 通过**：方案定稿 + 时间窗开启 + 双维成本授权）。①②齐备后按 [E2E 方案 v1.1](E2E-PLAN-2026-11-13-flow-continuation-pilot.md)（续接维 TC-1..8 + 混合维 TC-9..11）执行 tree→flow 续接受控试点（relay=off、深度链 ≤5、树 validate 0 issues、journal+`flow_send` 双读、报告落 `docs/reports/`）。
- 在那之前只做**离线准备**：组合剧本 §6/§9 已可按 §3 口径引用；**不执行任何 `flow_run`/`flow_send` 活体调用**（21:46 的两次失败 run 已证明当前环境下 session 节点必然启动失败）。
