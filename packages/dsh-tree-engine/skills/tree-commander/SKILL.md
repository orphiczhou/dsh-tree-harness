---
name: tree-commander
description: '把复杂任务拆成多层任务树、派独立子会话执行并逐点验收收口：tree_plan 建树 → tree_node 建 commander/worker 节点（依赖/产物/DoD）→ tree_dispatch 派发（无依赖可并行）→ tree_status harvest 收割 → tree_verify 按 taskType 自动路由验证 → tree_report 自报与收尾；每个 leaf 是独立 DSH 会话，上下文接近 50% 时自主 session_handoff 同层级接替。适用于「把这个任务拆成三层并派人做」「多层分解执行」「派一队人并行做」「继续干，快到上限就交接」「验收后收口」「根会话→中间层→执行层三层都能干活」「演示三层分解」等请求。English triggers: decompose this into layers, build a task tree, dispatch subagents, three-layer decomposition, parallel work, verify and close, hand off when running low on context.'
whenToUse: '用户要求把目标拆成多层/任务树并派多个执行者；任务可拆成可独立验证的中间产物；需要依赖拓扑（先 A 后 B）或并行推进；需要验收证据而不是一句「做完了」；任务长到单个会话装不下（要配合会话交接）；用户说「拆三层」「派人做」「多层分解」「任务树」「并行做」「分派子任务」「派一队人」「做完验收收口」「继续干，快到上限就交接」「根会话→中间层→执行层」「三层都能干活」「演示三层」。English speakers may say: split this into three layers, build the tree, dispatch workers, parallelize, verify and close the tree.'
---

# tree-commander SKILL（DSH 版 v2.2，随 tree-engine v0.8.1 分发）

> 你是树节点的指挥官（commander）。与"脚本执行者"的根本区别：**你拿到的只有目标，没有结构**——
> 分解成几个子节点、串行还是并行、谁依赖谁、各自什么 taskType，**全部由你自主决定**。
> 引擎（9 个 `tree_*` 工具）只提供护栏与账本，不预设形状。每个被派发的 leaf 都是**独立 DSH 会话**。

## 0. 你是谁 / 环境事实

- 你的会话 id：`$env:DSH_SESSION_ID`。**形态因会话层级而异**：DSH 根/主会话实测带 `session-` 前缀（如 `session-ae8a…`），dispatch 出的子会话是裸 UUID v4（如 `dacf6e74-…`）。tree-engine **v0.7.0 起引擎归一化**（剥 `session-` 前缀、存储裸 UUID 规范形），两种形态都可原样传——**不要手工截前缀或拼前缀**。它同时是你 leaf 的 owner 与你子节点的 `added_by`。
- 派发你时任务书已给出 tree_id、你的 leaf_id、目标（brief）、DoD；完成时按结算指令 `tree_report {action:"event", type:"done"}` 收尾。
- 嵌套深度 ≤3：**root → commander → worker**。worker 不能有子节点（引擎硬拦），再加层会 `E_DEPTH_EXCEEDED`。
- 9 个工具与 action 闭集（**不要发明 action**）：

| 工具 | action | 用途 |
|---|---|---|
| `tree_plan` | `create` | 建树；root leaf `<tree_id>-root` 自动创建 |
| `tree_node` | `add` / `get` / `list` / `list-all` / `set-status` / `set-session` / `set-relay` | 建节点 / 读节点 / 列 active / 列全部 / 改状态 / 重绑 owner / 开关竹节（v0.8.0） |
| `tree_dispatch` | `start` / `cancel` | 派发执行（起子会话）/ 取消 |
| `tree_report` | `context` / `event` | 上报上下文水位 / 追加事件（progress/blocked/plan/brief_echo/done/…） |
| `tree_status` | `overview` / `validate` / `sessions` / `harvest` | 全局 dump / 校验 / 会话预算 / **显式收割** |
| `tree_verify` | `run` / `dod` / `adversarial` | 跑验证 / 看 DoD / 异族红队对抗验证 |
| `tree_log` | `events` / `drift` / `heartbeat` / `communication` | 查日志（只读） |
| `tree_maintain` | `backup` / `restore` / `nudge-reset` / `register-session` | 维护，一般不用 |
| `tree_doctor` | `run` | 只读自检（`package` / `tool-count` / `skills` / `tree-data` / `stale` / `sweep` / `env` 七项；FAIL 不 throw） |

## 1. 自主分解流程（拿到目标后）

### 1.0 先判断你属于哪种 commander（**关键分支，别默认先 tree_plan**）

| 你的处境 | 正确动作 |
|---|---|
| 被 `tree_dispatch` 派发（任务书带 `tree_id` / `leaf_id` / 结算指令） | **不要 tree_plan**。先用 `tree_status {action:"overview", tree_id}` 确认树存在 → 直接在**你的 leaf 下** `tree_node add` 子节点（`parent` = 你的 leaf_id）。同 tree_id 再 create 会 `E_DUPLICATE_LEAF`；自拟新 tree_id 会把子节点建到另一棵树，root 永远收割不到（**静默分裂**）。 |
| 根会话，用户直接要求组织多会话任务，且**没有**现成 tree | 先 `tree_status {action:"overview"}` 看是否已有同题树；确认没有才 `tree_plan create`（§1.2）。 |
| 已有同 tree_id 的树但不属于你 | 不要抢建；向派发者确认应进哪棵树、挂在哪个父节点下。 |

### 1.1 先想清楚，再建点（建点即承诺）

- **产物是什么**：目标最终交付物（文件 / 结论 / 报告）拆成可独立验证的中间产物。
- **切分判据**：①可独立验证（每个子任务有自己的 DoD）；②失败可重试不影响兄弟；③粒度 = 一个执行者一次上下文内能完成（过大 → 再切，或留竹节自报）。
- **依赖拓扑**：显式声明 `dependencies:[leaf_id]`——引擎在派发时强制闸门（依赖未 succeeded → `E_DEPENDENCY_NOT_MET`）；环在装载期被拒（`E_DEPENDENCY_CYCLE`）。依赖写进节点，不要靠自己记顺序。
- **taskType 逐点定**（决定 `tree_verify` 自动路由哪套策略）：

| taskType | 验证策略 | 实际检查（批 1 缺省） |
|---|---|---|
| `research` / `question` | `research-answer` | self-report：执行者自述完成即过；DoD 文本要求「结论含出处引用」但**不核真伪**——重要结论用 `adversarial` 或人工复核 |
| `doc` | `artifact-doc` | artifact：`**/*.md` 且 ≥200 **字符**（`text.length`；不是字节），取字典序第一个匹配 |
| `code-change` | `code-change` | command：执行 `pnpm test`（300s 超时），退出码 0 |
| 其他 / 不填 / `default` | `self-report` | self-report：**执行者自述即过，不能当验收证据** |

> ⚠️ `code-change` 的缺省验证真的会跑 `pnpm test`：选它前确认工作区测试可运行，否则用它必然 FAIL——交互/脚本类难验证的产物用 `default` + 明确 DoD，再对关键产物补 `adversarial`。
> ⚠️ artifact 策略按字典序取 `**/*.md` 首个匹配（已知边界，可能命中无关 md）：把产物放到可预测路径，或用 `cwd` 收缩搜索根。

### 1.2 建树（**仅根会话 / 无现成树时**；任务书已给 tree_id 就跳过本节）

```json
{
  "action": "create",
  "tree_id": "tdemo",
  "root_brief": { "goal": "…", "context": "…", "constraints": "…" },
  "root_dod": { "dod": "…" },
  "session_id": "<你的会话 id>"
}
```

- `tree_id`：4–8 字符、小写字母开头、只含 `[a-z0-9_]`、无连字符（否则 `E_NAME_INVALID`）。
- **强烈建议传 `session_id`**：不传则 root leaf 没有 owner，root 的信任锚/SET 权限会退化。v0.7.0 起可接受带 `session-` 前缀的形态（引擎归一化为裸 UUID 后仍严格校验 v4；非法 UUID 照旧 `E_INVALID_UUID_STRICT`）——直接用 `$env:DSH_SESSION_ID`，不要手工截前缀。

每个子任务一次 `tree_node add`（commander 层）：

```json
{
  "action": "add",
  "tree_id": "tdemo",
  "leaf": {
    "leaf_id": "tdemo-C1-commander",
    "parent": "tdemo-root",
    "path": "C1",
    "role": "commander",
    "added_by": "<你的会话 id>",
    "brief": { "goal": "子任务目标" },
    "dod": { "dod": "验收标准" },
    "taskType": "doc",
    "dependencies": ["<可选，上游 leaf_id>"]
  }
}
```

worker 层（挂在 commander 下，命名用更细的 path 段）：

```json
{
  "action": "add",
  "tree_id": "tdemo",
  "leaf": {
    "leaf_id": "tdemo-C1a1-worker",
    "parent": "tdemo-C1-commander",
    "path": "C1a1",
    "role": "worker",
    "added_by": "<你的会话 id>",
    "brief": { "goal": "…" },
    "dod": { "dod": "…" },
    "taskType": "code-change"
  }
}
```

- **命名规则**：`<tree_id>-<path 段>-<name>`；`path` 段必须以**大写字母开头**（如 `C1`、`C1a1`；不能写成 `review1`），`path` 字段必须**逐字等于** leaf_id 里的路径段；可带 `-sN`/`-iN` 后缀。不写 `path` 时不校验 path。违反命名 → `E_NAME_INVALID`（helpTopic `naming_convention`）；path 与 leaf_id 不一致 → `E_SCHEMA_INVALID`（helpTopic `how_to_init`）。
- `added_by` 必须等于引擎提取的调用者 id（v0.7.0 起按**归一化**比较：`session-` 前缀与裸 UUID 视为同一会话，可原样传 `$env:DSH_SESSION_ID`；不同会话仍 `E_BORROWED_IDENTITY`）。
- 角色闭集：`commander` / `worker`（root 只由 tree_plan 创建，`auditor` 也可建但不做执行主力）。
- worker 初始状态 `pending_brief`；commander/auditor 初始 `active`。

### 1.3 派发与收割

```json
{ "action": "start", "tree_id": "tdemo", "leaf_id": "tdemo-C1a1-worker",
  "prompt": "子任务书：目标 + 关键上下文 + 约束",
  "assignee": { "provider": "deepseek-official", "model": "deepseek-v4-pro", "effort": "high" } }
```

- **必须传 `prompt`**：不传时宿主会拿 `leaf.brief`（对象）拼提示词，可能变成 `[object Object]`；`dod` 参数**不改变**子会话看到的验收标准（DoD 来自 `leaf.taskType` → 策略模板），要定制就把验收点写进 prompt。
- `assignee` 可选，只用于**模型路由**（provider/model/effort 透传给子会话并持久化）；`preset` 字段只是随 leaf 记录，宿主当前不应用到派发——不要靠它改工作模式。
- 派发即绑定：`leaf.session_id = 执行者会话`（done 事件所有权自举）、`runtime.state=running`、`attempt+1`。派发提示词由宿主适配层自动附「策略 DoD + 结算指令」。
- 无依赖的节点可立即 start（并行天然支持）；有依赖的等闸门放行。
- 派发后可选把 leaf 置 `active`（`tree_node {action:"set-status", status:"active"}`；`pending_brief→active` 合法）——自报 pct 的 `segment_pending` 状态位只在 active 时置位；不置也不影响 harvest 路径，但别把「没看到 segment_pending」当没触发。
- **收割**：引擎启动后即以 `sweepMode=timer` 注册周期 sweep（进程内 60s；宿主有 timer 服务时走宿主 timer）。启动日志若提示「宿主无 timer 服务、改用进程内 interval 兜底」，那只是提示——**不要据此假设没有后台收割**。轮询：先等 30–45s 再 `tree_status {action:"harvest"}` + `tree_node {action:"get"}`；harvest 立即强制扫一轮（不必等 60s 周期），但别假设毫秒级实时。
- 看 `runtime.state`：`pending`/`running` → 继续等；`succeeded` → 收；`timeout`/`cancelled`/`frozen` → 读 `tree_log {action:"events"}` 分析，决定重派（同 leaf 再 start，attempt+1）或新建替代节点。
- **竹节接力后的 owner 归属（v0.5.0 语义）**：接力成功后引擎会把 `leaf.session_id`（owner）**重绑给接手会话**，接手会话可以正常 `tree_report done`。若在旧版本/异常路径下接力会话写 done 被 `E_BORROWED_IDENTITY` 拒：a) 旧会话在交棒前先把当前阶段 done 写掉；或 b) 从 `tree_status {action:"harvest"}` 返回的 `swept[].events[]` 取 `event='bamboo'` 的 `sessionId`（接力会话 id），由你（creator）`tree_node {action:"set-session"}` 重绑 owner。
- **等待外部编排的节点先关竹节（v0.8.0）**：如果这个 leaf 的执行会去跑 flow / `tree_verify` / 长命令，先关掉它的竹节——`tree_node {action:"set-relay", tree_id, leaf_id, relay:"off"}`（建点时也可在 `leaf` 对象里带 `relay:"off"`；缺省 `auto`）。`relay:"off"` 时 sweep **跳过该 leaf 的竹节**（超时/收割语义不变、不改 `runtime.state`），不会 interrupt 执行会话，避免把运行中的 flow 打断（S1 实测 flow journal `cancelled / E_RUN_CANCELLED`）。外部编排结束、`tree_node {action:"get"}` 确认后改回 `relay:"auto"` 恢复竹节。**写权：仅 leaf 的 creator（added_by）或 root 会话，执行者（owner）不能自关**，越权 `E_BORROWED_IDENTITY`。
- 轮询预算：别死等一个节点；一个节点超时（nodeTimeoutMs 缺省 30 分钟）就按失败处理。
- 事件 type 是 12 值闭集：`done` / `blocked` / `plan` / `brief_echo` / `heartbeat_reply` / `nudge` / `limit` / `status_check` / `review_round` / `subagent_spawn` / `progress` / `child_done`（自造 → `E_SCHEMA_INVALID`）。

### 1.4 逐点验证再收口

每个 succeeded 的子节点：

```json
{ "action": "run", "tree_id": "tdemo", "leaf_id": "tdemo-C1a1-worker" }
```

- **不传 `policy_id`** → 按 leaf 的 `taskType` 自动路由（缺省 `self-report`）。`cwd` 缺省 = 你当前会话工作目录。
- 先预览验收标准：`tree_verify {action:"dod", tree_id, leaf_id}`。
- v0.4.0 起有对抗式验证：`tree_verify {action:"adversarial", tree_id, leaf_id, max_rounds≤5, attack_timeout_ms 30s–600s}` —— 结构检查 + 异族红队攻击（缺省 DeepSeek-V4-Pro，环境变量 `TREE_ENGINE_JUDGE_ASSIGNEE` 可配）→ FAIL 的 findings 自动回注执行者修复 → 再复审，≤3 轮（缺省）。高价值/夸大风险高的产物再用它，别对每个节点都上（慢、烧钱）。
- 裁决落账 `leaf.verification{policy_id, pass, verdicts}`；**PASS 才可视为该点收口**（协议纪律；引擎不强制）。
- ⚠️ **FAIL 不抛错**：`tree_verify` 即使不通过也正常返回 `{result:{pass:false, verdicts}}`——必须读 `result.pass` 与 `verdicts[].detail`，不要以为「没报错 = 通过」。
- ⚠️ `tree_node {action:"set-status", status:"done"}` 实际只有**两闸**：已有 done 事件 + milestones 非空且全 `audit_pass=true`；而**里程碑面没有工具写入命令**（工具面打不通 done 状态）。收口判据用 `runtime.state=succeeded` + verify PASS，不要反复尝试 set-status done。已知边界：`leaf.status` 可能停留在 `pending_brief`/`active`，与 runtime 终态脱节，**以 runtime 为准**。

## 2. 动态性：分解不是一次性承诺

- **执行中允许加节点**：上游产物出来后发现要补一步（评审/风险/补充调研）→ 直接 `tree_node add`（可带 dependencies 指向已完成节点，立即就绪）。
- **允许废弃**：某分支不需要 → `tree_node {action:"set-status", status:"pruned"}`（未 done 后代级联 pruned）。
- **禁止事后剧透式重构**：已 succeeded 的节点不改写；修正 = 新节点 + 依赖。
- 预算护栏（超了引擎会拦，提前规划）：

| 护栏 | 缺省 | 触发错误 |
|---|---|---|
| 未收口 leaf 数（`active`+`segment_pending`+`pending_brief`） | 20 | `E_NODE_BUDGET_EXCEEDED` |
| 单 leaf `subagent_spawn` 事件 | 15 | `E_SUBAGENT_BUDGET_EXCEEDED` |
| 树总会话（leaf+segment+registry 去重） | 50 | `E_MAX_SESSIONS` |
| 嵌套深度 | 3 | `E_DEPTH_EXCEEDED` |
| 单 leaf 竹节链长 | 5 → `frozen` 待裁决 | 工具面表现 `runtime.state=frozen` |

- 注：v0.7.0 起 `max_sessions` 预算**计入**竹节接力产生的 `leaf.runtime.segmentChain`（W2.1 修复）——高频接力的树按真实会话数计费，超限即拦。
- 可用 `TREE_ENGINE_CONFIG`（JSON）覆盖护栏/编排键：`node_budget` / `max_sessions` / `max_subagent_spawn_per_leaf` / `commander_max_depth` / `ctx_segment_threshold` / `segment_max_chain_length` / `nodeTimeoutMs` / `sweepIntervalMs` / `graceMs` / `bambooThresholdPct`。非法配置会让插件**装载失败**（报错含键名），不是静默回退。

## 3. 上下文 50% 自主交接（必读；每一层会话都要会）

### 3.1 两套机制，别混

- **竹节（tree-engine 主接力）**：长任务执行者用 `tree_report {action:"context", pct}` 自报水位；`pct≥42`（DSH 缺省阈值，可被 `TREE_ENGINE_CONFIG.ctx_segment_threshold` / `bambooThresholdPct` 覆盖）→（leaf 状态为 `active` 时）置 `segment_pending`，周期 sweep / `harvest` 先 interrupt 旧会话、再派新会话接手（简报 K1–K5 全文传递；leaf 不变、attempt 不变、链+1；链长 5 → `runtime.state=frozen`）。这是**同一 leaf 换会话**——v0.5.0 起引擎会把 owner（`leaf.session_id`）**重绑给接手会话**，接手会话可正常 `tree_report done`（旧版本/异常路径的兜底见 §1.3 与 §3.3）。**v0.8.0 起可 per-leaf 关掉竹节**：等待外部编排（flow / verify / 长命令）的 leaf 由你 `tree_node {action:"set-relay", relay:"off"}` 先关，结束再回 `auto`（见 §1.3）。
- **会话自交接（`session_handoff`，会话层兜底）**：把你这层会话的工作写进 `HANDOFF-*.md`，启动**同层级**新会话接替（根→新根；子会话→同父兄弟；父不活→root + `degraded=parent-inactive`）。这是**换会话继续干**，不依赖 tree-engine。

### 3.2 规则（缺省 auto → 同父兄弟接替）

1. 你是指挥官会话：每个里程碑后跑一次 `session_handoff {action:"status"}`，读真实 `context_pct`。
2. `context_pct >= 50` → **必须自主交接**，不需要上级批准：
   ```json
   { "action": "handoff",
     "summary": "树 tdemo：子节点 C1a1/C1a2 已 succeeded 且 verify PASS；C1b1 仍在 running（session …）；还差 C1b2 派发与收口。",
     "next_steps": [
       "先读 HANDOFF-*.md；跑 tree_status {action:\"harvest\"} 看剩余节点",
       "对 C1b1 的 succeeded 结果跑 tree_verify run（不传 policy_id）",
       "建并派发 C1b2（taskType=doc），收割后按 §4 收口",
       "不要重派已完成节点"
     ],
     "files": ["…"],
     "open_questions": ["…"],
     "note": "tree tdemo / leaf tdemo-C1-commander；依赖拓扑与子节点清单见 summary；叶子 owner 仍是我（旧会话），见 §3.3" }
   ```
3. **优先级**：先按竹节——竹节已把同一 leaf 接过去（后继会话已在干）就不必再会话交接；若已到 50% 仍没等到竹节（没人 harvest / 链满 frozen / 简报回收失败 / 你根本不是 running 的 leaf owner），立即 `session_handoff`。
4. 交接前把 tree_id / leaf_id / 子节点状态 / 待验收项 / 下一步写清——接替者要能**接着当指挥官**，不是从零猜。
5. 交接后**停止新增派发**：不要新旧会话同时派发同一棵树（重复派发/身份冲突）。旧会话到点让位。

> ⚠️ `session_handoff` 由会话树单包 `@orphiczhou/dsh-session-tree` 提供，不是 tree-engine 的工具。若你的工具列表里没有它（该 bundle 未装/未启用）：不要伪造调用、不要自己改 profile——继续用竹节自报，并向你的上级/用户报告「上下文接近上限，需要会话交接能力」。

### 3.3 交接后的树账本协调（不要假设 owner 自动迁移）

- `session_handoff` 只在会话层接替；tree-engine 的 `leaf.session_id`（owner）**不会自动迁移**。**竹节接力不同**：v0.5.0 起引擎会在接力成功后把 owner 重绑给接手会话（接力会话可正常写 done）；只有在旧版本/异常路径才需要 §1.3 的兜底处置。
- 后果：done 事件仅 **owner 会话**可写（`E_BORROWED_IDENTITY`）。接替会话如果直接写 done 会失败。
- 协调动作：
  1. 交接前/后（只要旧会话还能调用工具）留痕：
     ```json
     { "action": "event", "tree_id": "tdemo", "leaf_id": "tdemo-C1-commander",
       "type": "progress",
       "meta": { "handoff": { "session_id": "<接替会话 id>", "handoff_path": "<HANDOFF 绝对路径>", "reason": "context-50" } } }
     ```
  2. 若你是**子节点指挥官**：把新会话 id + 交接路径上报你的上级（progress/blocked 事件；直接父会话用原生 `send_message`，跨层（兄弟/越级）才用 `tree_send`——目标父会话须活着），请求上级决定：
     - `tree_node {action:"set-session", tree_id, leaf_id, session_id:"<接替会话 id>"}` 重绑 owner（set-session 仅 leaf 的 creator/`added_by` 可调；v0.7.0 起 `session-` 前缀与裸 UUID 都接受并归一化存储；若报 `E_BORROWED_IDENTITY`，先核对 `added_by` 是否为同一会话）；或
     - `tree_dispatch {action:"cancel"}` → `start` 重派（attempt+1，绑定新执行者）。
  3. 若你是 **root 会话**：你的上级就是用户/Lead——把「leaf owner 仍是旧会话」写进交接文件与回报，由用户决定重派或新建节点。
- 不要假设引擎会自动把新会话变成 leaf owner；也不要自己冒充新会话写 done。

## 4. 你的收尾

全部子节点 `runtime.state=succeeded` + verify PASS + 目标交付物在手：

```json
{ "action": "event", "tree_id": "tdemo", "leaf_id": "tdemo-C1-commander", "type": "done",
  "meta": { "summary": "一句话结论",
            "self_check": [
              { "item": "子节点全 succeeded + verify PASS", "pass": true, "evidence": "harvest 输出 / 各节点 verification" },
              { "item": "交付物", "pass": true, "evidence": "文件路径 / 结论" }
            ] } }
```

失败/阻塞同样报 done，并在 summary 写明原因——诚实失败优于静默卡死。你的上级会用同样方式收割你。

## 5. 错误码速查（报错先认码）

| 码 | 含义 / 动作 |
|---|---|
| `E_TREE_NOT_FOUND` | tree_id 不存在或还没 tree_plan |
| `E_NAME_INVALID` | tree_id/leaf_id 命名不符（helpTopic `naming_convention`） |
| `E_SCHEMA_INVALID` | 参数形状/角色/依赖/path 不一致等（path 不一致时 helpTopic `how_to_init`；看 message） |
| `E_DUPLICATE_LEAF` | tree 已存在（多发生在被派发的 commander 又 tree_plan；见 §1.0） |
| `E_DEPTH_EXCEEDED` | 超过 3 层；把更细分解交给 worker 内部步骤，不要加层 |
| `E_DEPENDENCY_NOT_MET` | 上游未 succeeded：等它收割，不是你的 bug |
| `E_DEPENDENCY_CYCLE` | 依赖成环，装载期就拒；改拓扑 |
| `E_BORROWED_IDENTITY` | 借身份：done 只由 owner 写；set-status 只由 owner/creator/root；set-session 只由 creator；**set-relay 只由 creator/root（v0.8.0）** |
| `E_TS_NOT_MONOTONIC` | 事件时间倒挂（仅注入 ts 时可能触发；工具路径 ts 由引擎生成，通常不触发） |
| `E_MAX_SESSIONS` / `E_NODE_BUDGET_EXCEEDED` / `E_SUBAGENT_BUDGET_EXCEEDED` | 预算护栏满：收口/剪枝后再建 |
| `E_PORTS_NOT_WIRED` / `E_PORTS_PROTOCOL` | 宿主编排端口不可用：如实上报，不要伪造子会话 |
| `E_STATUS_TRANSITION_INVALID` | 状态机不允许该迁移（看 allowed 列表） |
| `E_INVALID_UUID_STRICT` | session_id 归一化后必须是严格 UUID v4（v0.7.0 起接受可选 `session-` 前缀；非 UUID 仍拒） |

## 6. 一图流

```
拿到目标（无结构）
  → 判断角色：被派发（已有 tree_id）→ 直接挂到自己的 leaf 下；根会话且无现树 → 才 tree_plan
  → 分解设计（产物拆分 / 粒度 / 依赖拓扑 / taskType）
  → tree_plan 建树（仅根会话/无现树，传 session_id）
  → tree_node add 逐点建（dependencies 进节点，path 段大写开头）
  → tree_dispatch start 并行派发无依赖点（必传 prompt，assignee 可选路由）
  → harvest 轮询（引擎 60s 自动 sweep；harvest 可立即强制一轮）
  → [动态] 补点 / 废弃 / 重派（按执行中发现）
  → 逐点 tree_verify run（按 taskType 路由；读 result.pass，FAIL 不抛错）
  → 50% 上下文 → session_handoff（缺省 auto 同父兄弟）→ 交接后用 progress 留痕，
                    上报新会话 id，请上级 set-session 重绑或重派
  → 全绿 → done 事件（summary + self_check 证据）
```
