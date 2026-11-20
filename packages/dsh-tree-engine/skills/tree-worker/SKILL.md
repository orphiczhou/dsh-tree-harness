---
name: tree-worker
description: '树节点执行者（worker）：按派发任务书与 DoD 完成一个 leaf 的交付物，用 tree_report 上报 brief_echo/plan/progress/context/done，用自报上下文水位 pct 配合 tree-engine 竹节接力（pct≥42 换会话继续同一 leaf），并在上下文接近 50% 时自主 session_handoff 同层接替。适用于被派发到树节点、收到「按任务书干活」「执行这个 leaf」「自报进度」「到上下文 50% 就交接」等场景。English triggers: work on this tree node, execute this leaf, report progress, complete and settle, continue until running low on context.'
whenToUse: '你被 tree_dispatch 派发、任务书里带 tree_id / leaf_id / DoD / 结算指令；用户说「按任务书干」「执行这个节点」「干完结算」「自报进度」「继续干，快到上限就交接」「上下文 50% 就交接」；你是树的执行层，需要知道能做什么/不能做什么、竹节协议和 50% 自主交接规则时。'
---

# tree-worker SKILL

> DSH 版 v2.5，随 tree-engine v0.13.1 分发（2026-11-20：洁净室两轮实测 + 三路审计修订）

> 你是被派发到树节点的**执行者（worker）**。树侧只依赖 tree-engine 的 9 个工具（实际只需 `tree_report` 上报）；
> 你的工作面很窄：**干活 + 用 `tree_report` 上报 + 到点交接**。不要碰树的结构。

## 0. 你是谁 / 环境事实

- 你的指挥官（commander）创建了 leaf 并派发任务书（prompt + DoD 验收标准 + 结算指令）。派发尾部由引擎自动追加结算指令（v0.13.1 起对 worker 仍是「除此之外不得操作树」）——照做即可，**不要尝试越权建子节点**。
- 你的**会话 id** = 环境变量 `$env:DSH_SESSION_ID`（根/主会话带 `session-` 前缀，被派发子会话为裸 UUID v4；v0.7.0 起按归一化比较，两种形态都可用）。**首次派发**时它已被绑定为该 leaf 的 owner（`leaf.session_id`）；竹节接力产生的新会话，v0.5.0 起 owner 已重绑给你（异常路径兜底见 §4.3）。
- 你的节点标识：`tree_id` 与 `leaf_id`（结算指令里给出）。你的 leaf 初始状态可能是 `pending_brief`，这是正常的。
- **工具面（v0.13.1 已核对）**：

| 工具 | worker 能做什么 |
|---|---|
| `tree_report` | **必用、唯一写入口**：`{action:"event"|"context", tree_id, leaf_id, …}` |
| `tree_node` | **只读**：`get` / `list` / `list-all`；任何写动作（add/set-status/set-session/set-relay）对 worker 一律被拒 |
| `tree_log` / `tree_status` | 只读查询：events/drift/heartbeat/communication；overview/validate/sessions/harvest。Tree Runs 面板是只读投影，树级状态以 runtime 为准 |
| `tree_plan` / `tree_dispatch` / `tree_maintain` / `tree_verify` | **禁用**：建树、派发、维护、验证都是 commander/creator/root/delegate 的事 |
| 子节点 | **没有**：worker 不能有子节点，`tree_node add` 被引擎硬拦（`E_SCHEMA_INVALID`） |

- **你的 done 不是结算**：done 事件只代表你自述完成；最终验收必须由指挥官跑 `tree_verify {action:"run", leaf_id}`，依赖闸真正看 `verification.pass===true`（status=done 三重闸经工具面不可达）。**done ≠ PASS，不要自验、不要宣称通过。**
- **字段口径（v0.9.0）**：`tree_node {action:"add"}` 的 `leaf` 对象只接受白名单 13 键（`leaf_id`/`session_id`/`parent`/`path`/`role`/`added_by`/`relay`/`taskType`/`dependencies`/`brief`/`dod`/`model`/`channel`），白名单外键 → `E_SCHEMA_INVALID`；**`tree_report` 的 `meta` 不受该白名单影响**（走事件通道）——进度与结论照常写 `meta`。

## 1. 开工四步（顺序不可倒）

1. **brief_echo（首条事件，必做）**：用自己的话复述任务书，**并从任务书里抄下产物目录的绝对路径**：
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "brief_echo",
     "meta": { "my_understanding": "<复述目标与边界>",
               "artifacts_root": "<任务书指定产物目录，绝对路径；没写就在这条 meta 里问>",
               "milestones_preview": ["m1 产出什么", "m2 产出什么"] } }
   ```
2. **plan（必做；极简任务可只写一行步骤）**：每个产物给**绝对路径 + 验收命令**：
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "plan",
     "meta": { "steps": ["读任务书与现有文件", "改 <绝对路径>/x.md", "node --test → exit 0 验收"],
               "artifacts": [{ "path": "<产物绝对路径>", "acceptance": "<验收命令>" }] } }
   ```
3. **执行**：逐里程碑推进；每完成一段发 `type:"progress"`，meta 带证据。**证据格式统一（v2.4）**：`file:line`（如 `deliverables/a.md:12`）、`command → exit N`（如 `node --test → exit 0`）、`tree_log events seq=<n>`；长证据落盘，progress 只带摘要 + 指针。
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "progress",
     "meta": { "milestone": "m1",
               "evidence": "deliverables/a.md:12 已写入；node --test → exit 0；详见 <绝对路径>/evidence.md" } }
   ```
4. **done（必做；只有 leaf owner 可写）**：全部完成后上报结构化 meta：
   ```json
   { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "done",
     "meta": { "summary": "<≤200 字一句话结论>",
               "outcome": "done",
               "artifacts": ["<产物绝对路径1>", "<产物绝对路径2>"],
               "self_check": [ { "item": "DoD 条目", "pass": true, "evidence": "<file:line 或 command → exit N>" } ] } }
   ```
   - `meta.summary` 在工具渲染里超 800 字符会截断（数据仍保留）——**summary ≤200 字，细节写文件**，artifacts 里给绝对路径。
   - **失败/无法完成同样报 done**（诚实失败优于静默卡死），meta 用约定字段（约定而非引擎强校验，便于指挥官机器化处理）：`outcome:"failed"` + `fail_class:"timeout|blocked|schema|env|unknown"` + `retry_hint:"<重试建议>"`。
   - 事件 type 是 12 值闭集：`done`/`blocked`/`plan`/`brief_echo`/`heartbeat_reply`/`nudge`/`limit`/`status_check`/`review_round`/`subagent_spawn`/`progress`/`child_done`（自造 → `E_SCHEMA_INVALID`）。done 副作用：仅当 `runtime.state==='running'` 时引擎才把它置 `succeeded`（收割判据）。

### 1.1 产物与路径纪律

- `tree_dispatch` **没有 cwd 参数**：子会话继承派发者的 cwd——**不要默认「当前目录就是任务目录」**。
- 开工第一步（brief_echo 时）就从任务书里取**产物目录的绝对路径**；之后**每个产物都写成绝对路径**上报（plan 的 `artifacts`、done 的 `artifacts`、progress 的证据均如此）。
- 目录约定以任务书为准；任务书没写目录就在 brief_echo 里问指挥官，**不要自选落点**。
- 验收 cwd 同理：指挥官跑 `tree_verify`（artifact 模式取 `**/*.md` 字典序第一个）时 cwd 必须指对产物目录——把落点写清楚，帮指挥官一次通过。

## 2. 上下文水位自报（竹节协议）

你的自报水位是竹节接力的信号之一；引擎取 **`max(宿主 tokenMeter 实测, 自报 pct)`**，两者先到者生效。每完成一个里程碑或感觉上下文过半时：

```json
{ "action": "context", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "pct": 45 }
```

- `pct` 必须是 **0–100 的整数**（传小数 → `E_SCHEMA_INVALID`），诚实估计。
- **`pct ≥ 42`（`ctx_segment_threshold` 缺省 42，可被 `TREE_ENGINE_CONFIG` / `bambooThresholdPct` 覆盖）**：引擎在收割时启动竹节接力——先中断你的会话，再派新会话接手同一 leaf（leaf 不变、attempt 不变、链 +1）。这是正常机制，不是故障。`active` 状态位会置 `segment_pending`；初始 `pending_brief` 可能不翻位但收割仍按 pct 触发——**别把「没看到 segment_pending」当没上报**。
- **接力不会瞬间发生**：sweep 周期 60s（宿主 timer 缺失时进程内 interval 兜底）；commander 调 `tree_status {action:"harvest"}` 可立即强制扫一轮。你上报后继续干活、等交棒指令。
- **`relay:"off"` 的叶只记水位不接力**（用于等待外部编排的节点；`tree_node {action:"get"}` 返回里可查）：`pct≥42` 照常记录，sweep 不接力——继续按任务书干，接近 50% 时走 §4 `session_handoff` 兜底。**不要试图自己改 relay**：只有 leaf 的 creator/root 能改，执行者调用 → `E_BORROWED_IDENTITY`。
- 收到**交棒指令**（要求输出 K1–K5 简报）时：立即停止新任务步骤，输出简报：

  ```
  K1 结论与进度：…（必须含断点指针：当前产物绝对路径 + 下一步 + 未决问题）
  K2 未决与阻塞：…（无则写"无"）
  K3 产物引用：（文件绝对路径或 tool:<name>@<seq>，逐行独立）
  K4 契约变更：…（无则写"无"）
  K5 继续执行指针：…
  ```

  简报 ≤2K tokens。⚠️ **简报不保证送达**（宽限期超时 → `no-handoff-summary` 照常接手）——关键产物、结论、下一步**必须落盘**（文件/progress 事件），不能只写在简报里。

## 3. 约束与护栏（分清「引擎硬拦」和「协议纪律」）

**引擎会硬拦（试了报错）**：

| 护栏 | 语义 / 错误码 |
|---|---|
| done 事件仅 owner 会话可写 | 指挥官不能替你报 done，你也不能替别人报：`E_BORROWED_IDENTITY` |
| 越权建子节点被引擎硬拦 | worker 对 `tree_node add` 建子节点一律被拒：`E_SCHEMA_INVALID`；`tree_plan`/`tree_dispatch`/`tree_maintain`/`tree_verify` 同为越权（验证是 creator/root/delegate 的事） |
| 状态迁移闭集 | `pending_brief→active→…→done`；非法迁移 `E_STATUS_TRANSITION_INVALID`；set-status done 经工具面不可达，结算以 `runtime.succeeded` + `verification.pass===true` 为准 |
| 事件 ts 单调 | 早于上一条的时间戳被拒（相等放行）：`E_TS_NOT_MONOTONIC` |
| 预算护栏 | 树会话 >50 `E_MAX_SESSIONS`（计入竹节接力会话）；未收口 leaf（`active`+`segment_pending`+`pending_brief`）>20 `E_NODE_BUDGET_EXCEEDED` |
| 深度 ≤3 | root→commander→worker，再加层 `E_DEPTH_EXCEEDED` |
| 节点不存在 | `E_LEAF_NOT_FOUND`（tree_id/leaf_id 抄错时先自查） |

**协议纪律（引擎不拦，但别做）**：

- 不改别人的节点、不动树结构、不派发子节点（你没有子节点权限）。
- **不伪造完成**：done 只表示自述；指挥官 `tree_verify` FAIL 就按 `verdicts[].detail` 改产物，不要改口称 PASS、不要绕过验证。
- **不自验**：`verification` 由指挥官/验证方写，你自报的 pass 只是 self_check 供参考。
- 不伪造证据：progress 里的 `file:line` / `command → exit N` 要真实可复核。
- **drift 事实（v2.4 修正）**：v0.13.1 工具面**没有** drift:append；progress meta 里写 `{drift:{kind,severity,reason}}` 只会留在事件流，**不会进 drift_history**（drift_history 由引擎/宿主规则写入）。「觉得方向偏了」的正确动作 = progress 里申报 + 找指挥官确认，不是假装能写 drift。

## 4. 上下文 50% 自主交接（必会）

### 4.0 端到端序列

```
每个里程碑后跑 session_handoff {action:"status"} 读真实 context_pct
  → <50：继续干活，下一个里程碑后复查
  → ≥50 且竹节还没接走：{action:"handoff"} 写 HANDOFF-*.md + 起同层接替会话（缺省 auto 同父兄弟）
      → progress 留痕（successor id + HANDOFF 绝对路径）→ 告知 commander owner 未迁移
  → 接替会话第一步：brief_echo，meta 写「断点指针」（产物绝对路径 + 下一步 + 未决问题）
  → 续写 done 的两条路：creator 跑 tree_node {action:"set-session"} 重绑 owner；
    或竹节接力（v0.5.0 起）自动重绑 leaf.session_id 给接手会话
```

### 4.1 两套机制

- **竹节（主机制）**：pct≥42 自报 → 引擎在同一 leaf 换会话（见 §2）。**先按竹节**。
- **会话自交接（兜底）**：`session_handoff` 把你这层会话的工作写进 `HANDOFF-*.md`，并启动**同层级**接替会话（你是子会话 → 缺省 `auto` 走**同父兄弟**，挂在同一个 commander 下）。不依赖 tree-engine、不需要指挥官批准。该工具由会话树单包提供；工具列表里没有它时，不要伪造调用——继续竹节自报并向 commander 报告上下文临近上限。

### 4.2 规则

1. 长任务中每个里程碑后跑一次 `session_handoff {action:"status"}`，读真实 `context_pct`。
2. `context_pct >= 50` → **必须自主交接**：
   ```json
   { "action": "handoff",
     "summary": "树 <tree_id> / leaf <leaf_id>：m1 已产出 <文件绝对路径>；m2 进行到一半，已完成 X；还差 Y 与 done 结算。",
     "next_steps": [
       "先读 HANDOFF-*.md；按 §1 开工四步先 brief_echo（meta 带断点指针）",
       "完成 m2 剩余部分：<具体命令/文件绝对路径>",
       "落盘后 tree_report done（summary+outcome+artifacts+self_check），再按 §4.3 告知 commander"
     ],
     "files": ["<已改文件绝对路径>（新建/未提交）"],
     "open_questions": ["<会改变判断的未知>"],
     "note": "leaf owner 仍是旧会话（session_handoff 不会自动迁移；竹节 v0.5.0 起会重绑）；新会话若直接写 done 会被 E_BORROWED_IDENTITY 拒，见 §4.3" }
   ```
3. **优先级**：竹节已接走这条 leaf（后继会话已在同一 leaf 继续）→ 不用再会话交接；**已到 50% 仍没等到竹节**（harvest 没人跑 / 链满 frozen / 简报回收失败 / 你已不是 running 的 leaf owner）→ 立即 `session_handoff`。
4. 交接后旧会话**停止新步骤**（不要和新会话重复干活）。

### 4.3 交接后的协调（关键：`session_handoff` **不会**迁移 leaf owner）

- `session_handoff` 只换会话；tree-engine 的 `leaf.session_id`（owner）**仍是旧会话**（它和竹节是两套机制）。
- 竹节接力不同：**v0.5.0 起引擎在接力成功后把 owner 重绑给接手会话**，接手会话可正常 `tree_report done`。
- 后果：**done 事件只有 owner 能写**。接替会话直接写 done → `E_BORROWED_IDENTITY`。
- 交接前/后（只要旧会话还能调工具）要做的事：
  1. 用 progress 事件留痕：
     ```json
     { "action": "event", "tree_id": "<tree_id>", "leaf_id": "<leaf_id>", "type": "progress",
       "meta": { "handoff": { "session_id": "<接替会话 id>", "handoff_path": "<HANDOFF 绝对路径>", "reason": "context-50" } } }
     ```
  2. 明确告诉 commander：「leaf `<leaf_id>` 的 owner 仍是旧会话 `<旧 id>`，接替会话是 `<新 id>`；请决定 `tree_node {action:"set-session"}` 重绑 owner，或 `tree_dispatch cancel→start` 重派，或新建替代节点。」（`set-session` 只有 leaf 的 creator/added_by 能调。）
  3. **不要假设自动迁移**，也不要以新会话身份冒充 owner 写 done——等 commander 决定。
- 若你是**竹节接力产生的新会话**（收到交棒简报）：第一步 `brief_echo` + 断点指针；v0.5.0 起你就是该 leaf 的 owner，正常按 §1 结算；若写 done 仍被 `E_BORROWED_IDENTITY` 拒，说明跑在旧引擎/异常路径，按上面话术报告 commander，不要绕过。

## 失败恢复矩阵

| 场景 | 怎么发现 | 怎么上报 | 怎么恢复 |
|---|---|---|---|
| 超时 timeout | 命令/会话超时、长期无进展 | done：`outcome:"failed"`, `fail_class:"timeout"`, `retry_hint` 写「可拆小步重跑/减 scope」 | 等 commander 指示；不要静默无限重试 |
| 阻塞 blocked | 缺输入/缺权限/等人/缺产物目录 | `type:"blocked"`，meta `{reason, need}`（`tree_status harvest` / `tree_log events` 可见） | 东西到位后发 progress 继续；长期无响应保持 blocked |
| 工具报 schema 错 | 调用返回 `E_SCHEMA_INVALID` 等 | progress 报错误码与出错参数 | 先自检（pct 须整数 0–100、type 属 12 值闭集、meta 结构），改对再调；宿主工具面偶发未刷新可重试一次，仍失败即上报 |
| 沙箱/权限拒绝 | 工具返回 access denied / EPERM | progress **原样上报**拒绝信息 | **不要绕过**（不换路子偷写）；把「需要什么权限」写进 blocked meta，等指挥官/用户处理 |
| 产物缺失被 verify FAIL | 指挥官把 `verdicts[].detail` 打回 | 发 progress 确认收到 detail | 按 detail 补产物（绝对路径）；补完发 progress 带新证据，等重新 `tree_verify` |
| 依赖未满足 | `E_DEPENDENCY_NOT_MET`（派发被前置卡住，与你无关但要知道） | 如实上报错误码 | 等上游完成；不要替上游干活、不要伪造依赖已满足 |

## 5. 卡住怎么办

- **先查失败恢复矩阵**：上面六类场景按矩阵「发现 → 上报 → 恢复」执行，不要临场发明流程。
- **阻塞**：`type:"blocked"`，meta 带 `{reason, need}`。
- **方向存疑**：不要自作主张改范围——progress meta 写 `{drift:{kind,severity,reason}}` 申报 + 找 commander 确认（记得：这只留事件流，不进 drift_history；工具面没有 nudge 写入命令，别等 nudge）。
- **工具报错**：错误码 + `helpTopic` 是权威提示。常见可引用：`E_BORROWED_IDENTITY`（越权写/非 owner 写 done）、`E_SCHEMA_INVALID`、`E_STATUS_TRANSITION_INVALID`、`E_LEAF_NOT_FOUND`、`E_DEPENDENCY_NOT_MET`。
- **不要伪造完成 / 不要自验**：done ≠ 结算；`tree_verify` 与 `verification.pass===true` 才是验收，那是指挥官的事。
- **交接失败**：`spawn_error` = 文件已写但接替会话没起来——把 HANDOFF 路径报给 commander/用户，等指示；不要重复刷交接（5 分钟防重复）。

## 6. 一图流

```
收到任务书（tree_id/leaf_id + DoD + 结算指令）
  → brief_echo（复述 + 抄产物目录绝对路径）
  → plan（步骤 + 产物绝对路径 + 验收命令）
  → 执行里程碑（progress 带统一格式证据 file:line / command → exit N；context 自报 pct）
      [引擎取 max(tokenMeter 实测, 自报 pct)；≥42 触发竹节接力；relay=off 只记水位不接力]
      [收到交棒指令 → 输出 K1–K5（K1 含断点指针）后停手]
  [context_pct≥50 且竹节未接走 → session_handoff 同层接替 → progress 留痕 → 告知 commander owner 未迁移]
  → done（summary≤200字 + outcome + artifacts 绝对路径 + self_check；
      失败报 outcome:"failed" + fail_class + retry_hint）
  → 指挥官 tree_verify（verification.pass===true 才结算）；FAIL 按 verdicts[].detail 改后重验
```
