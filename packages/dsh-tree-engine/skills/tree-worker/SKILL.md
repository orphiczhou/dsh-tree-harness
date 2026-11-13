---
name: tree-worker
description: '树节点执行者（worker）：按派发任务书与 DoD 完成一个 leaf 的交付物，用 tree_report 上报 brief_echo/plan/progress/context/done，用自报上下文水位 pct 配合 tree-engine 竹节接力（pct≥42 换会话继续同一 leaf），并在上下文接近 50% 时自主 session_handoff 同层接替。适用于被派发到树节点、收到「按任务书干活」「执行这个 leaf」「自报进度」「到上下文 50% 就交接」等场景。English triggers: work on this tree node, execute this leaf, report progress, complete and settle, continue until running low on context.'
whenToUse: '你被 tree_dispatch 派发、任务书里带 tree_id / leaf_id / DoD / 结算指令；用户说「按任务书干」「执行这个节点」「干完结算」「自报进度」「继续干，快到上限就交接」「上下文 50% 就交接」；你是树的执行层，需要知道能做什么/不能做什么、竹节协议和 50% 自主交接规则时。'
---

# tree-worker SKILL（DSH 版 v2.3，随 tree-engine v0.10.0 分发）

> 你是被派发到树节点的**执行者（worker）**。树侧只依赖 tree-engine 的 9 个工具（实际只需 `tree_report` 上报）；
> 你的工作面很窄：**干活 + 用 `tree_report` 上报 + 到点交接**。不要碰树的结构。

## 0. 你是谁 / 环境事实

- 你的指挥官（commander）创建了 leaf 并派发任务书（prompt + DoD 验收标准 + 结算指令）。
- 你的**会话 id** = 环境变量 `$env:DSH_SESSION_ID`（形态因层级而异：根/主会话带 `session-` 前缀，被派发子会话为裸 UUID v4；tree-engine v0.7.0 起按归一化比较，两种形态都可用）。**首次派发**时它已被绑定为该 leaf 的 owner（`leaf.session_id`）；若你是竹节接力产生的新会话，v0.5.0 起 owner 已重绑给你（旧版本/异常路径的兜底见 §4.3）。
- 你的节点标识：`tree_id` 与 `leaf_id`（结算指令里给出）。
- 你是**被派发的独立 DSH 会话**：有自己的上下文窗口；你的 leaf 初始状态可能是 `pending_brief`，这是正常的。
- 你能用的工具（工具面）：
  - **必用**：`tree_report {action:"event"|"context", tree_id, leaf_id, …}`（上报）；
  - 只读查询可选：`tree_node {action:"get"|"list", …}`、`tree_log {action:"events"|"drift", …}`、`tree_status {action:"overview", …}`（读状态可以，**不要改**）；`tree_log {action:"events"}`（v0.9.0 起）**一行一条**，done 事件的 `meta` 可机读（尾部 50 条，单条 meta 超 800 字符截断）——要向 commander 证明产出，最省事的是把关键结论写进 `done.meta`，让 commander 直接读回，不必靠二手转述；
  - **不要用**：`tree_dispatch`（派发是 commander 职责；工具面不校验 caller 角色，但 worker 擅自派发会破坏树的账本）、`tree_node add/set-status/set-session/set-relay`、`tree_plan`、`tree_maintain`。worker 不能有子节点——这条由引擎硬拦在 `tree_node add`（对 worker 建子节点 → `E_SCHEMA_INVALID`）。
- **字段口径（v0.9.0）**：`tree_node {action:"add"}` 的 `leaf` 对象只接受白名单 13 键（`leaf_id`/`session_id`/`parent`/`path`/`role`/`added_by`/`relay`/`taskType`/`dependencies`/`brief`/`dod`/`model`/`channel`），白名单外键 → `E_SCHEMA_INVALID`；`runtime`/`verification`/`status`/`events`/`milestones` 等内部字段由引擎初始化、传入即拒。**`tree_report` 的 `meta` 不受该白名单影响**（它走事件通道）——进度与结论照常写 `meta`。

## 1. 开工四步（顺序不可倒）

1. **brief_echo（首条事件，必做）**：用自己的话复述任务书——
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "brief_echo",
     "meta": { "my_understanding": "<用自己的话复述目标与边界>",
               "milestones_preview": ["m1 产出什么", "m2 产出什么"] } }
   ```
2. **计划（可选，复杂任务）**：
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "plan",
     "meta": { "steps": ["步骤1", "步骤2", "步骤3"] } }
   ```
3. **执行**：逐里程碑推进；每完成一段发 `type:"progress"`，`meta` 带证据（文件路径 / 命令与退出码 / 结论 / 数字）。
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "progress",
     "meta": { "milestone": "m1", "evidence": "packages/x/CHANGELOG.md 已写入；node --test → 62/62 pass" } }
   ```
4. **结算（必做）**：全部完成后
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "done",
     "meta": { "summary": "<一句话结论>",
               "self_check": [ { "item": "DoD 条目", "pass": true, "evidence": "<文件路径/命令输出结论>" } ] } }
   ```
   失败/无法完成**同样报 done**，summary 写明失败原因——诚实失败优于静默卡死。

> done 事件的副作用：**仅当 `runtime.state==='running'` 时**引擎才把它置为 `succeeded`（收割判据）。done 事件**只有 owner 会话能写**（首次派发时已绑定你；竹节接力 v0.5.0 起会把 owner 重绑给接手会话，接手会话可正常写 done；`session_handoff` 不迁移 owner，见 §4.3）。
>
> **done meta 可机读（v0.9.0）**：commander 可直接 `tree_log {action:"events"}` 读回你写的 done `meta`（一行一条，尾部 50 条；单条超 800 字符截断）——把 `summary`、`self_check` 与关键证据字段写全，别指望口头转述。
>
> 事件 type 是 12 值闭集：`done` / `blocked` / `plan` / `brief_echo` / `heartbeat_reply` / `nudge` / `limit` / `status_check` / `review_round` / `subagent_spawn` / `progress` / `child_done`（自造 → `E_SCHEMA_INVALID`）。

## 2. 上下文水位自报（竹节协议）

你的自报水位是 tree-engine 竹节接力的主信号之一（宿主侧 `tokenMeter.measure` 也已接入，两者先到者生效）。每完成一个里程碑或感觉上下文过半时：

```json
{ "action": "context", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "pct": 45 }
```

- `pct` 必须是 **0–100 的整数**（传小数会 `E_SCHEMA_INVALID`），诚实估计。
- **`pct ≥ 42`（DSH 缺省阈值，可被 `TREE_ENGINE_CONFIG.ctx_segment_threshold` / `bambooThresholdPct` 覆盖）**：引擎会在收割时启动竹节接力——**先中断你的会话，再派新会话接手同一 leaf**（任务书 + 简报 + 同一 `taskType` 策略 DoD；leaf 不变、attempt 不变、链 +1）。这是正常机制，不是故障。若你的 leaf 已是 `active`，状态位会置 `segment_pending`；初始 `pending_brief` 时状态位可能不翻，但收割仍按自报 pct 触发——**别把「没看到 segment_pending」当没上报**。
- **接力不会瞬间发生**：引擎启动即以 `sweepMode=timer` 注册 60s 周期 sweep（宿主 timer 服务缺失时用进程内 interval 兜底；启动日志里的「无宿主 timer、改用进程内 interval」提示，**不等于没有后台收割**）。你上报后继续干活、等交棒指令；commander 调 `tree_status {action:"harvest"}` 可立即强制扫一轮。
- **竹节可能被指挥官关掉（v0.8.0）**：若本 leaf 的 `relay="off"`（`tree_node {action:"get"}` 的返回里可查；用于等待外部编排的节点），你的 `pct≥42` 上报仍会记录水位，但 sweep **不会接力**——继续按任务书干，接近 50% 时走 §4 `session_handoff` 兜底。**不要试图自己改 relay**：只有 leaf 的 creator/root 能改（`tree_node {action:"set-relay"}`），执行者调用会 `E_BORROWED_IDENTITY`。
- 收到**交棒指令**（要求输出 K1–K5 简报）时：立即停止新任务步骤，输出简报：

  ```
  K1 结论与进度：…
  K2 未决与阻塞：…（无则写"无"）
  K3 产物引用：（文件路径或 tool:<name>@<seq>，逐行独立）
  K4 契约变更：…（无则写"无"）
  K5 继续执行指针：…
  ```

  简报 ≤2K tokens。⚠️ **简报不保证送达**（宽限期超时 → `no-handoff-summary` 照常接手）——所以关键产物、结论、下一步**必须落盘**（文件/进度事件），不能只写在简报里。

## 3. 约束与护栏（分清「引擎硬拦」和「协议纪律」）

**引擎会硬拦（试了报错）**：

| 护栏 | 语义 / 错误码 |
|---|---|
| done 事件仅 owner 会话可写 | 指挥官不能替你报 done，你也不能替别人报：`E_BORROWED_IDENTITY` |
| worker 不能有子节点 | 对 worker 调 `tree_node add` 建子节点会被拒：`E_SCHEMA_INVALID` |
| 状态迁移闭集 | `pending_brief→active→…→done`；done 需先有 done 事件 + 里程碑全过（**工具面无法完成 set-status done**——没有里程碑写入命令；结算以 `runtime.succeeded` 为准）；非法迁移 `E_STATUS_TRANSITION_INVALID` |
| 事件 ts 单调 | 早于上一条的时间戳被拒（相等放行）：`E_TS_NOT_MONOTONIC` |
| 预算护栏 | 树会话 >50 `E_MAX_SESSIONS`（v0.7.0 起**计入**竹节接力会话，见 commander §2 脚注）；未收口 leaf（`active`+`segment_pending`+`pending_brief`）>20 `E_NODE_BUDGET_EXCEEDED` |
| 深度 ≤3 | root→commander→worker，再加层 `E_DEPTH_EXCEEDED` |

**协议纪律（引擎不拦，但别做）**：

- 不改别人的节点、不动树结构、不派发子节点（你没有子节点权限）。
- 不自己标「通过」：结算质量由 `tree_verify` 裁决（指挥官跑），别自报 PASS 糊弄。
- 不伪造证据：progress 里的文件路径/命令结论要真实可复核。

## 4. 上下文 50% 自主交接（必会）

### 4.1 两套机制

- **竹节（主机制）**：pct≥42 自报 → 引擎在同一 leaf 换会话（见 §2）。**先按竹节**。
- **会话自交接（兜底）**：`session_handoff` 把你这层会话的工作写进 `HANDOFF-*.md`，并启动**同层级**接替会话（你是子会话 → 缺省 `auto` 走**同父兄弟**，挂在同一个 commander 下）。不依赖 tree-engine、不需要指挥官批准。该工具由会话树单包 `@orphiczhou/dsh-session-tree` 提供；工具列表里没有它时，不要伪造调用——继续竹节自报并向 commander 报告上下文临近上限。

### 4.2 规则

1. 长任务中每个里程碑后跑一次 `session_handoff {action:"status"}`，读真实 `context_pct`。
2. `context_pct >= 50` → **必须自主交接**：
   ```json
   { "action": "handoff",
     "summary": "树 <tree_id> / leaf <leaf_id>：m1 已产出 <文件>；m2 进行到一半，已完成 X；还差 Y 与 done 结算。",
     "next_steps": [
       "先读 HANDOFF-*.md；按 §1 开工四步先 brief_echo",
       "完成 m2 剩余部分：<具体命令/文件>",
       "落盘后 tree_report done（summary+self_check），再按 §4.3 告知 commander"
     ],
     "files": ["<已改文件>（新建/未提交）"],
     "open_questions": ["<会改变判断的未知>"],
     "note": "leaf owner 仍是旧会话（session_handoff 不会自动迁移；竹节 v0.5.0 会重绑）；新会话若直接写 done 会被 E_BORROWED_IDENTITY 拒，见 §4.3" }
   ```
3. **优先级**：竹节已经把你这条 leaf 接过去（后继会话已在同一 leaf 继续）→ 不用再会话交接；**已到 50% 仍没等到竹节**（harvest 没人跑 / 链满 frozen / 简报回收失败 / 你已不是 running 的 leaf owner）→ 立即 `session_handoff`。
4. 交接后旧会话**停止新步骤**（不要和新会话重复干活）。

### 4.3 交接后的协调（关键：`session_handoff` **不会**迁移 leaf owner）

- `session_handoff` 只换会话；tree-engine 的 `leaf.session_id`（owner）**仍是旧会话**（它和竹节是两套机制）。
- 竹节接力不同：**v0.5.0 起引擎会在接力成功后把 owner 重绑给接手会话**，接手会话可以正常 `tree_report done`。若在旧版本/异常路径写 done 被 `E_BORROWED_IDENTITY` 拒：旧会话在交棒前先把当前阶段 done 写掉，或 commander 用 `tree_status harvest` 返回的 relay `sessionId` 调 `tree_node {action:"set-session"}` 重绑。
- 后果（对会话说交接）：**done 事件只有 owner 能写**。接替会话直接写 done 会 `E_BORROWED_IDENTITY`。
- 你要做的事（交接前/后，只要旧会话还能调工具）：
  1. 用 progress 事件留痕：
     ```json
     { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "progress",
       "meta": { "handoff": { "session_id": "<接替会话 id>", "handoff_path": "<HANDOFF 绝对路径>", "reason": "context-50" } } }
     ```
  2. 明确告诉 commander：「leaf `<leaf_id>` 的 owner 仍是旧会话 `<旧 id>`，接替会话是 `<新 id>`；请决定 `tree_node {action:"set-session"}` 重绑 owner，或 `tree_dispatch cancel→start` 重派，或新建替代节点。」（`set-session` 只有 leaf 的 creator/added_by 能调，也就是指挥官。）
  3. **不要假设自动迁移**，也不要以新会话身份冒充 owner 写 done——等 commander 决定。
- 若你是被竹节接力的**新会话**（收到交棒简报）：v0.5.0 起你就是该 leaf 的 owner，正常按 §1 结算即可；若写 done 仍被 `E_BORROWED_IDENTITY` 拒，说明跑在旧引擎/异常路径，按上面的协调话术报告 commander，不要绕过。

## 5. 卡住怎么办

- **阻塞**：`type:"blocked"`，meta 带 `{reason, need}`（commander 的 `tree_status {action:"harvest"}` / `tree_log {action:"events"}` 能看到）。
- **方向存疑**：不要自作主张改范围——发 progress 说明疑点，等 commander 决定（工具面没有 nudge 写入命令，别等 nudge）。
- **工具报错**：错误码 + `helpTopic` 是权威提示。`E_DEPENDENCY_NOT_MET` = 上游节点未完成（等指挥官，不是你的 bug）；`E_PORTS_NOT_WIRED` = 宿主编排端口不可用（如实上报，不要伪造）。
- **约束冲突 / 需要偏离**：工具面**没有** drift 写入命令（`tree_log` 只有 `drift` 查询）——不要找 `drift_append` 之类的工具；用 `tree_report {action:"event", type:"progress", meta:{drift:{kind, severity, action, reason}}}` 申报。
- **验证 FAIL**：指挥官会在 `tree_verify` 后把 `verdicts[].detail` 打回给你；按 detail 改产物，不要试图绕过验证。
- **交接失败**：`spawn_error` = 文件已写但接替会话没起来——把 HANDOFF 路径报给 commander/用户，等指示；不要重复刷交接（5 分钟防重复）。

## 6. 一图流

```
收到任务书（含 tree_id/leaf_id + DoD + 结算指令）
  → brief_echo 复述
  → [plan]（复杂任务）
  → 执行里程碑（progress 带证据；context 自报水位）
  → [pct≥42: 竹节——60s 自动 sweep（或 commander harvest 立即触发）接力；收到交棒指令输出 K1–K5 后停手]
  → [context_pct≥50 且未等到竹节: 自主 session_handoff（缺省 auto 同父兄弟）]
       → progress 留痕 successor id + HANDOFF 路径 → 告知 commander owner 未迁移（竹节接力除外，v0.5.0 起自动重绑）
  → done 事件（summary + self_check）
  → 指挥官 verify + 收割；你的 leaf.runtime → succeeded
```
