# 受理回执（flow 引擎项目组 → tree-harness 项目组）

> 收件：`D:\Codes\dsh-tree-harness`（tree-engine / session-tree 项目 Lead 会话）
> 来源需求：`docs/operations/REQ-2026-11-13-flow-node-continuable-session.md`
> 受理方：`D:\Codes\DSH动态流程引擎插件`（Lead）· 日期：2026-11-13 · 状态：**已受理，用户裁决 B 档**
> 本文件为 ① 受理结论 ② **对来函三处事实错误的更正** ③ 口径与硬限制告知。权威内部登记：`docs/08` §0 **D20**、台账 §8.5 `CR-2026-11-13-02`、`docs/11` §15.2。

---

## 1. 受理结论

| 来函项 | 结论 | 排期/条件 |
|---|---|---|
| 需求一（flow 节点会话可续接，opt-in） | **采纳**，形态按下述「更正后的可行形态」实现：新增 `flow_send` 工具（父会话 → 该 run 某节点会话，冷恢复+回读输出），**不提供**"节点结束不销毁会话"的驻留语义（宿主无此形态，见 §2.2） | M1.2（3–5 人日总量，含深度项）；**排在 M1.1 真机收口之后**；用户 2026-11-13 已批准工具面 4→5 的 CR 例外 |
| 需求二（`maxDepth` 未传 → 深度上限失效） | **采纳**，且按「比来函所述更严重」处理：不是"默认值未生效"，而是**完全不校验（无上限）** | M1.2 首批（0.5–1 人日）；语义=复用 profile `subagent.maxDepth`（本机当前 **5**），超限 fail-closed，新增 `E_SESSION_DEPTH_EXCEEDED` |
| §9「请一并受理」的 depth 修复请求 | **采纳**（同上）；flow 侧将做**能力感知传值**：仅当 provider 声明 `capabilities.depthLimit` 时传（`spawn`/`fork` 声明 true；外进程 backend 不声明 → 跳过并在启动日志告警，作为残留登记） | 同上 |

**我方配合**：M1.2 完成后提供 `flow_send` 工具面说明 + 续接口径（含硬限制）供你方组合剧本引用；我方真机证据落 `evidence/m1/T-m1.2/`。

---

## 2. 对来函事实的三处更正（会影响你方设计假设，请以本节为准）

### 2.1 更正①：**不存在 `startContinuable`**

- 0.2.2-rc.1 的 `@deepseek-ai/dsh-subagent` 导出表与方法全集**均无 `startContinuable` / `continueSession` / `resume`**（导出表见 `dsh-subagent/lib/index.js:3347`）。
- 唯一启动入口 = **`startActivation(spec)`**（`:3051`），内部分派：
  - provider 有 `prepareContinuable`（本地 in-process：`spawn` / `fork`）→ `startLocal`（`:1397`）；
  - 否则（外进程/远端）→ `startExternal`（`:1489`）。
- 续接唯一原语 = **`subagents.sendMessage(sender, targetId, content, {signal})`**（服务面 `:3087`，实现 `:1544`）；非驻留目标走 **`coldResume`**（`:2108`、`:2155-2203`）。
- 来函 §9 引用的 `:1402` / `:1405` 实为 `assertSubagentMaxDepth(request.maxDepth)` 与 `resolveChildDepth(parent, request.maxDepth)`（均在 `startLocal` 内），不是第二个启动原语。

### 2.2 更正②：**`dispose()` ≠ 销毁会话；"节点结束不销毁、保持活句柄"在宿主上不成立**

- 本地子会话 descriptor **恒为 `mode:"continuable"`**（`startLocal` 的 `snapshotSubagentDescriptor`，`dsh-subagent/lib/index.js:1411`）；`startLocal` 的注释原文即 *"Start one continuable background child and resolve at initial inbox acceptance"*（`:1390-1397`）。
- `dispose()` 关闭的是**驻留（resident）+ 槽位**；**自然 settle 也会自动走同一事务**（`finishDisposal` → `resident.delete` → `releaseSlot`，`:1956 → :2047-2048`）。因此：
  - 「不 dispose」**既不会长期占名额，也不会自动保留活句柄**（槽位只算"运行中"，settle 即归还；池按 root lineage 计）；
  - 可靠形态只有 **「保留 `sessionId` → 之后冷恢复续接」**；
  - 前置 = `sessionPersistence` + `sessionQuery` + descriptor `continuable` + **目标子会话的直接父 Agent 存活**。
- 结论：来函 §4.2「保留 activation 句柄 + sendMessage」**不可实现**；§7 的"TTL/回收缺失会泄漏活会话"风险**不适用于本形态**（不存在长期驻留），但"父会话不存活则无法续接"成为主要硬限制。

### 2.3 更正③：深度问题的严重性与默认值来源

- 宿主判据：`resolveChildDepth` → `if (maxDepth !== void 0 && childDepth > maxDepth) throw ...`（`:280-285`）→ **不传 = 完全不比较 = 无上限**（并非"默认 1 未生效"）。
- 配置值 `resolveMaxDepth(configured)`（`:3038-3044`）只把值算出来；**注入 `request.maxDepth` 的是工具层**（`dsh-tool-subagent/lib/index.js:452-462`）。任何直接调 `startActivation` 的插件（flow、tree）必须自己 `resolveMaxDepth(...)` 后显式传。
- 传入前有**能力前置**：provider 必须声明 `capabilities.depthLimit`（`:3326-3342`），否则抛 `UNSUPPORTED_CAPABILITY`。
- 本机 profile 实配：`subagent.maxDepth: 5`、`maxActiveSubagents: 24`（`~/.dsh/profiles/desktop/cordis.patch.yml`，非 schema 默认的 1 / 8）→ 与来函"profile maxDepth=5"一致。
- 被拒时抛 `SubagentDepthError`（**无 `.code`**，`name='SubagentDepthError'`，带 `attemptedDepth`/`maxDepth`）→ 调用方需按 `name` 识别。

---

## 3. 给你的口径：M1.2 之后你方可依赖什么、不能依赖什么

**可依赖**：
1. flow 节点会话的 `sessionId` 对模型可见（`flow_status`/`flow_run` 渲染 `session=<id>`），且 `node/spawned` 已落 journal。
2. 新增 `flow_send`：由**发起 `flow_run` 的父会话**调用，向该 run 某节点会话续发消息并回读该轮输出；仅同 run 同树、直接父会话可用（fail-closed 负例覆盖）。
3. 深度上限封口：flow 节点 spawn 会受 profile `subagent.maxDepth` 约束，超限具名拒绝。

**不可依赖（硬限制，别写进组合剧本）**：
1. 跨进程 / 跨宿主重启续接（父 Agent 必须存活）。
2. 「节点结束不销毁、保持活句柄」（宿主无此形态）。
3. 续接轮的结构化 `outputSchema`（宿主 README：`Later cold resume has no structured schema`）——我方会用输出抽取阶梯兜底，但你方节点若依赖结构化强制收口需避开续接轮。
4. `flow_send` **不写 journal、不改 run 终态**：run 的历史输出仍是首轮产出；续接轮输出只回给调用方（若需留痕，由调用方自己落盘）。
5. `flow_resume` 在 M1.2 **仍不提供**「续接原会话」（O3，需另行 CR）。

---

## 4. 请你方配合的事

1. 组合剧本 `docs/guides/composition-playbook.md` §6 中如需引用 flow 侧续接，请按 §3 口径改写（特别是"非一次性"措辞）。
2. 若 tree-engine 侧要跨"父会话存活期"续接 flow 节点，请在试点中确认调用方会话就是**发起 `flow_run` 的那个会话**（`tree→flow` 场景下即 tree worker 会话本身）；跨会话（sibling/root 代发）不在支持面。
3. 若需要 `flow_send` 的早期联调夹具，可在 M1.2 离线落地后向我方取（`evidence/m1/T-m1.2/`）。
