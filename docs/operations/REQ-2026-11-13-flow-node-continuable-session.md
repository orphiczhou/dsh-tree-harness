# 跨仓需求单：flow 节点会话支持「非一次性 / 可续接」（continuable）

> **提出方**：`D:\Codes\dsh-tree-harness`（tree-engine / session-tree 项目，Lead 会话）
> **受理方**：`D:\Codes\DSH动态流程引擎插件`（自由流程引擎项目组）
> **日期**：2026-11-13 · **状态**：待受理（本文件只登记需求，不改动 flow 仓任何代码/配置）
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

## 附：受理跟进（tree-harness 侧只读核查，不改 flow 仓代码）

| 核查时间 | 方式 | 结果 |
|---|---|---|
| 2026-11-13 15:42（D23 轮开工） | flow 仓 `git log --oneline -5` / `git status --short` / 需求目录文件列表 | **未受理**：副本 `evidence/requirements/REQ-2026-11-13-continuable-session.md` 仍为 **untracked**（`??`）；无回执文件；flow 仓近期提交（m1.1 B' 真机批次准备等）未引用本需求单 |
| 2026-11-13 16:24（收口前复查） | 同上 + 全仓 grep `continuable / REQ-2026-11-13 / tree-harness` | **仍未受理**：无新增提交/回执；需求目录仅本文件（3749 B，2026-11-13 14:51 递交）与 `决策记录.md` |

**结论（FACT）**：截至 2026-11-13 16:24（+08），flow 项目组尚未对本需求单作出受理/拒绝表示。tree-harness 侧按用户指示**不修改 flow 仓代码**、不代提交流；本文件与 flow 仓副本保持同源。**后续**：由用户/项目组排期；若需提醒，仅建议在 flow 仓 `evidence/requirements/` 追加状态说明（不 commit，无写权）。
