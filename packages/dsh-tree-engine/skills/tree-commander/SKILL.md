---
name: tree-commander
description: '把复杂任务拆成多层任务树、派独立子会话执行并逐点验收收口：tree_plan 建树 → tree_node 建 commander/worker 节点（依赖/产物/DoD）→ tree_dispatch 派发（无依赖可并行）→ tree_status harvest 收割 → tree_verify 按 taskType 自动路由验证 → tree_report 自报与收尾；每个 leaf 是独立 DSH 会话，上下文接近 50% 时自主 session_handoff 同层级接替。适用于「把这个任务拆成三层并派人做」「多层分解执行」「派一队人并行做」「继续干，快到上限就交接」「验收后收口」「根会话→中间层→执行层三层都能干活」「演示三层分解」等请求。English triggers: decompose this into layers, build a task tree, dispatch subagents, three-layer decomposition, parallel work, verify and close, hand off when running low on context.'
whenToUse: '用户要求把目标拆成多层/任务树并派多个执行者；任务可拆成可独立验证的中间产物；需要依赖拓扑（先 A 后 B）或并行推进；需要验收证据而不是一句「做完了」；任务长到单个会话装不下（要配合会话交接）；用户说「拆三层」「派人做」「多层分解」「任务树」「并行做」「分派子任务」「派一队人」「做完验收收口」「继续干，快到上限就交接」「根会话→中间层→执行层」「三层都能干活」「演示三层」。English speakers may say: split this into three layers, build the tree, dispatch workers, parallelize, verify and close the tree.'
---

# tree-commander SKILL（DSH 版 v2.5，随 tree-engine v0.13.1 分发（2026-11-20：洁净室两轮实测 + 三路审计修订；v2.5 补第二轮 skc2 的三处排障））

> 你是树节点的指挥官（commander）。与"脚本执行者"的根本区别：**你拿到的只有目标，没有结构**——
> 分解成几个子节点、串行还是并行、谁依赖谁、各自什么 taskType，**全部由你自主决定**。
> 引擎（9 个 `tree_*` 工具）只提供护栏与账本，不预设形状。每个被派发的 leaf 都是**独立 DSH 会话**。

## 0. 你是谁 / 环境事实

- 你的会话 id：`self_spec` 或 `$env:DSH_SESSION_ID`（Windows PowerShell）。**形态因会话层级而异**：根/主会话带 `session-` 前缀，dispatch 子会话是裸 UUID v4；引擎 v0.7.0 起归一化（剥前缀、存裸 UUID 规范形），两种形态都可原样传——**不要手工截/拼前缀**。它同时是你 leaf 的 owner 与你子节点的 `added_by`。
- 派发你时任务书已给出 tree_id、你的 leaf_id、目标（brief）、DoD；完成时按结算指令 `tree_report {action:"event", type:"done"}` 收尾。
- 嵌套深度 ≤3：**root → commander → worker**。worker 不能有子节点（引擎硬拦 `workers cannot have children`），再加层会 `E_DEPTH_EXCEEDED`。
- **工具返回的 `render` 是给人看的摘要，机读细节（状态/裁决/计数）以返回对象为准。**
- 9 个工具与 action 闭集（**不要发明 action**）：

| 工具 | action | 用途 |
|---|---|---|
| `tree_plan` | `create` | 建树；root leaf `<tree_id>-root` 自动创建；`session_id` 必传（见 §1.2） |
| `tree_node` | `add` / `get` / `list` / `list-all` / `set-status` / `set-session` / `set-relay` | 建节点 / 读节点 / 列 active / 列全部 / 改状态 / 重绑 owner / 开关竹节（v0.8.0） |
| `tree_dispatch` | `start` / `cancel` | 派发执行（起子会话）/ 取消 |
| `tree_report` | `context` / `event` | 上报上下文水位 / 追加事件（progress/blocked/plan/brief_echo/done/…，12 值闭集） |
| `tree_status` | `overview` / `validate` / `sessions` / `harvest` | 见下方四种 action 用途 |
| `tree_verify` | `run` / `dod` / `adversarial` | 跑验证（run 必传 leaf_id）/ 看 DoD（预览）/ 异族红队对抗验证 |
| `tree_log` | `events` / `drift` / `heartbeat` / `communication` | 查日志（只读） |
| `tree_maintain` | `backup` / `restore` / `nudge-reset` / `register-session` / `verify-delegate` / `gc` | 维护：`verify-delegate` = root 授予受信会话补验证写权（全量替换、`[]` 清空）；`gc` = root 裁剪 archived leaf 的无界 events/drift/runtime.history（保留 N 条 + 全部 done 事件，也裁树级 drift_log） |
| `tree_doctor` | `run` | 只读自检（package/tool-count/skills/tree-data/stale/sweep/env 七项；FAIL 不 throw） |

- `tree_status` 四种 action 用途：
  - `overview`：树级全局 dump（v0.13.1 起真实渲染 `leaves=N [runtime 分布] root=<id>`）。
  - `validate`：返回 invariants 校验 `{ok, issues}`；收口前必跑（见 §4）。
  - `sessions`：会话预算预检，返回 `count/max`；派发前先查（见 §2.2）。
  - `harvest`：立即扫一轮（不等周期 sweep）；无运行叶时渲染 `harvest all settled`；**它会忽略 tree_id 全库扫描**，别当单树操作。

### 0.1 观测三件套与结算权威

- `tree_status` 看**树级派生状态**：哪些 leaf 在 running、哪些 succeeded、预算还剩多少。
- `tree_log` 看**事件/漂移**：`events`（最近事件，done 的 `meta` 可机读，单条渲染超 800 字符截断但数据仍在）、`drift`（状态/身份漂移留痕）、`heartbeat`（心跳尾）、`communication`（通信日志）。
- Tree Runs 面板（tree-engine v0.11.0 起 `/tree-panel/*`，session-tree v1.8.x 客户端）是**只读**面板：树级派生状态（runtime 结算优先）、分层从属图、点节点属性。**面板不能替代 verify**——验收必须 `tree_verify`。
- **结算权威是 `runtime.state`**：`leaf.status` 是启封态（可能停留在 `pending_brief`/`active`，与 runtime 终态脱节），判定一个 leaf 是否完成永远以 `runtime.state` 为准。

## 1. 自主分解流程（拿到目标后）

### 1.0 先判断你属于哪种 commander（**关键分支，别默认先 tree_plan**）

| 你的处境 | 正确动作 |
|---|---|
| 被 `tree_dispatch` 派发（任务书带 `tree_id` / `leaf_id` / 结算指令） | **不要 tree_plan**。直接在**你的 leaf 下** `tree_node add` 子节点（`parent` = 你的 leaf_id）。引擎 v0.13.1 起派发给 commander/auditor 的结算指令**允许继续用 tree_node/tree_dispatch/tree_verify/tree_status/tree_log 管树**。同 tree_id 再 create 会 `E_DUPLICATE_LEAF`；自拟新 tree_id 会把子节点建到另一棵树，root 永远收割不到（**静默分裂**）。 |
| 根会话，用户直接要求组织多会话任务，且**没有**现成 tree | **先向用户确认 tree_id**（4–8 字符、小写字母开头、只含 `[a-z0-9_]`）再 `tree_plan create`（§1.2）。没有枚举树的工具，别试图「查同题树」。 |
| 已有同 tree_id 的树但不属于你 | 不要抢建；向派发者确认应进哪棵树、挂在哪个父节点下。 |

### 1.1 先想清楚，再建点（建点即承诺）

- **产物是什么**：目标最终交付物（文件 / 结论 / 报告）拆成可独立验证的中间产物。
- **切分判据**：①可独立验证（每个子任务有自己的 DoD）；②失败可重试不影响兄弟；③粒度 = 一个执行者一次上下文内能完成（过大 → 再切，或留竹节自报）。
- **parent vs dependencies（两种语义，别混）**：

| | parent（组织从属） | dependencies（派发前置门） |
|---|---|---|
| 语义 | 严格树的从属：指挥官→成员 | 派发前闸门：前置结算前拒派 |
| 表达 | 节点挂在哪个父下 | `dependencies:[leaf_id,...]` |
| 数据 | 不传数据 | **不传数据、无条件表达式、无 join** |
| 典型 | root→commander→worker | 水平串联：A 完成才派 B |

- **水平依赖不能靠 parent 套娃表达**——要靠 dependencies 平铺挂同一个父（通常是 root）。示例：A/B/C 三个 worker 平铺挂 root，`B.dependencies=[A]`、`C.dependencies=[B]`：

```json
{ "leaf_id": "t-A-worker", "parent": "t-root", "path": "A", "role": "worker", "added_by": "<你>" }
{ "leaf_id": "t-B-worker", "parent": "t-root", "path": "B", "role": "worker", "added_by": "<你>", "dependencies": ["t-A-worker"] }
{ "leaf_id": "t-C-worker", "parent": "t-root", "path": "C", "role": "worker", "added_by": "<你>", "dependencies": ["t-B-worker"] }
```

- **依赖闸有效判据**（engine.js 确认）：`status==='done'` **或** `verification.pass===true`。但 status=done 的三重闸经工具面**实际不可达**（milestones 无工具可写）→ **有效判据实质 = 每个被依赖叶 `verification.pass===true`**。所以推进下游前必须对**每个**被依赖叶逐一 `tree_verify` 到 PASS（E1 教训：只自报 done 不算数，会 `E_DEPENDENCY_NOT_MET`）。
- **worker 不能有子节点**（`workers cannot have children`）：需要再细分就把该点设成 commander，或把细分写进 worker 的任务书让它内部执行。
- **taskType 逐点定**（决定 `tree_verify` 自动路由哪套策略）：

| taskType | 验证策略 | 实际检查（缺省） |
|---|---|---|
| `research` / `question` | `research-answer` | self-report：执行者自述完成即过；DoD 文本要求「结论含出处引用」但**不核真伪**——重要结论用 `adversarial` 或人工复核 |
| `doc` | `artifact-doc` | artifact：`**/*.md` 且 ≥200 **字符**（`text.length`，不是字节），取**字典序第一个**匹配 |
| `code-change` | `code-change` | command：执行 `pnpm test`（300s 超时），退出码 0 |
| 其他 / 不填 / `default` | `self-report` | self-report：**执行者自述即过，不能当验收证据** |

> ⚠️ `code-change` 的缺省验证真的会跑 `pnpm test`：选它前确认工作区测试可运行，否则必然 FAIL——难验证的产物用 `default` + 明确 DoD，再补 `adversarial`。⚠️ artifact 策略按字典序取 `**/*.md` 首个匹配（可能命中无关 md）：把产物放到可预测路径，或用 `cwd` 收缩搜索根（见 §1.4 假阳性规避）。

### 1.2 建树（**仅根会话 / 无现成树时**；任务书已给 tree_id 就跳过本节）

```json
{ "action": "create", "tree_id": "tdemo",
  "root_brief": { "goal": "…", "context": "…", "constraints": "…" },
  "root_dod": { "dod": "…" },
  "session_id": "<你的会话 id>" }
```

- `tree_id`：4–8 字符、小写字母开头、只含 `[a-z0-9_]`、无连字符（否则 `E_NAME_INVALID`）。
- **`session_id` 必传**：不传 → root owner 为 null → root 专属能力（`verify-delegate` / `gc` / `register-session`）全部 `E_BORROWED_IDENTITY`。取法：`self_spec` 或 `$env:DSH_SESSION_ID`（Windows PowerShell）；v0.7.0 起带 `session-` 前缀与裸 UUID 都接受并归一化——直接原样传，不要手工截前缀。

每个子任务一次 `tree_node add`：

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
    "taskType": "doc",
    "dependencies": ["<有依赖才写；无依赖必须整键省略>"]
  }
}
```

- **命名三段规则**：`<tree_id>-<path 段>-<name>`；`path` 段首字符**必须大写**（如 `C1`、`C1a1`；不能 `review1`），且**逐字等于 leaf_id 中间段**；`name` 段**必填**。可带 `-sN`/`-iN` 后缀。违反命名 → `E_NAME_INVALID`；path 与 leaf_id 不一致 → `E_SCHEMA_INVALID`。
- **`dependencies` 无依赖时必须省略整键——不要传空数组**：传 `[]` 会被拒（`dependencies must be a non-empty array of leaf_id strings`，`E_SCHEMA_INVALID`）。
- `added_by` 必须等于引擎提取的调用者 id（v0.7.0 起归一化比较，`session-` 前缀与裸 UUID 视为同一会话，可原样传 `$env:DSH_SESSION_ID`；不同会话仍 `E_BORROWED_IDENTITY`）。
- **`leaf` 对象字段白名单（v0.9.0）**：只接受 13 个键——`leaf_id` / `session_id` / `parent` / `path` / `role` / `added_by` / `relay` / `taskType` / `dependencies` / `brief` / `dod` / `model` / `channel`；白名单外一律 `E_SCHEMA_INVALID`。`runtime` / `verification` / `status` / `created_at` / `events` / `milestones` / `segment_chain` / `drift_history` / `context_usage_pct` / `nudge_count` 等内部字段由引擎初始化，**不接受调用方输入**。
- 角色闭集：`root` / `commander` / `worker` / `auditor`（root 只由 tree_plan 创建；auditor 可建但不做执行主力）。worker 初始状态 `pending_brief`；commander/auditor 初始 `active`。taskType 选型见 §1.1 表。

### 1.3 派发与收割

```json
{ "action": "start", "tree_id": "tdemo", "leaf_id": "tdemo-C1a1-worker",
  "prompt": "子任务书：目标 + 关键上下文 + 约束（所有路径写绝对路径）",
  "assignee": { "provider": "deepseek-official", "model": "deepseek-v4-pro", "effort": "high" } }
```

- **必须传 `prompt`**：不传会退化成 `leaf.brief`，brief 是对象时会被拼成 `[object Object]`。**没有 `cwd` 参数**（子会话继承派发者 cwd）→ 任务书里文件/目录路径一律写**绝对路径**，别指望子会话知道相对路径。
- `assignee` 可选，只做**模型路由**：provider/model/effort 透传给子会话并持久化。**先查路由再选**——`list_subagent_models`（看授权 provider/model）或 `model_route_query`（按财务优先级排序的渠道推荐）；被宿主策略门拒绝时按列表顺序换下一项。若同一渠道**连续两次 spawn 即死**（宿主只报 `failed ... no closing message`，引擎侧 events=0、`runtime.state` 仍 `running`、无错误码），不要再试该渠道：`cancel` 后换列表下一项（换 provider 或 model），这条死法不会留下引擎日志，只能靠宿主通知判断。`preset` 字段只是随 leaf 记录，宿主当前不应用到派发——不要靠它改工作模式。
- `dod` 参数**不会**传给子会话（子会话拿到的是 taskType 对应策略文本）：要定制验收点就写进 prompt（见 §1.6 可机检 DoD 模板）。
- 派发即绑定：`leaf.session_id = 执行者会话`、`runtime.state=running`、`attempt+1`。派发尾部由引擎自动追加结算指令，v0.13.1 起**按 role 区分**：commander/auditor 被允许继续用 tree_node/tree_dispatch/tree_verify/tree_status/tree_log；worker 仍是「除此之外不得操作树」。
- 无依赖的节点可立即 start（并行天然支持）；有依赖的等闸门放行（依赖叶 verify PASS，见 §1.1）。**重派前先 cancel**：对 running 叶再 start 会被拒（`already running (cancel or wait harvest first)`）→ 先 `tree_dispatch {action:"cancel"}` 或等 harvest 到终态，再 start（attempt+1）。
- **收割**：引擎启动即以 `sweepMode=timer` 注册周期 sweep（进程内 60s；有宿主 timer 服务走宿主 timer）。启动日志若提示「宿主无 timer 服务、改用进程内 interval 兜底」只是提示，**不要据此假设没有后台收割**。轮询：先等 30–45s 再 `tree_status {action:"harvest"}` + `tree_node {action:"get"}`；harvest 立即强制扫一轮，但**会忽略 tree_id 全库扫描**——把它当「全库立即扫」，别当单树操作，也别假设毫秒级实时。
- 看 `runtime.state`：`pending`/`running` → 继续等；`succeeded` → 收；`timeout`/`cancelled`/`frozen` → 读 `tree_log {action:"events"}` 分析，按 §2.3 失败恢复矩阵处置。**例外**：宿主通知子会话 `failed ... no closing message` 而 `runtime.state` 仍是 `running`、events 为 0 时，剧本不会自己变 timeout，`harvest` 也会报 `all settled` → 按 §2.3「spawn 即死」行处理（cancel + 换渠道），别原地等。
- **done meta 要短小**：`tree_report {action:"event", type:"done", meta:{summary}}` 的 `meta` 渲染超 800 字符会截断（数据仍在）——summary 一句话，细节落盘到交付物文件。事件 type 是 12 值闭集：`done` / `blocked` / `plan` / `brief_echo` / `heartbeat_reply` / `nudge` / `limit` / `status_check` / `review_round` / `subagent_spawn` / `progress` / `child_done`（自造 → `E_SCHEMA_INVALID`）。

### 1.4 逐点验证再收口

每个 succeeded 的子节点：

```json
{ "action": "run", "tree_id": "tdemo", "leaf_id": "tdemo-C1a1-worker", "cwd": "<产物目录，可选>" }
```

- **run 必须传 leaf_id**：v0.13.1 起缺 leaf_id 直接报错（旧版会静默跑 self-report 且不落账）——永远显式写 leaf_id。
- **不传 `policy_id`** → 按 leaf 的 `taskType` 自动路由（缺省 `self-report`）。`cwd` 缺省 = **调用者当前会话工作目录**（不是 `leaf.path`）。
- **cwd 配方**：先让 worker 在 done meta 或交付物文件里报出产物的**绝对路径**，你再 `cwd=<产物目录>` 收缩搜索根；否则 artifact 按字典序取 `**/*.md` **第一个**匹配，cwd 指错会**假阳性**（verify PASS 但验的是无关文件）。**同目录多 `.md` 也假阳性**：即使 cwd 正确，字典序第一的若是你自己的自检清单而不是 worker 产物，仍会 PASS 到无关文件（第二轮洁净室实测命中）→ 把目标文件复制到独占目录（如 `verify-tmp/<name>.md`），`cwd` 指向该目录再验。
- 先预览验收标准：`tree_verify {action:"dod", tree_id, leaf_id}`。**`dod` 是策略预览**（v0.13.1 渲染 `tree_verify: DoD preview (<policy>) …`），**不是裁决**——真正裁决走 `run`。
- v0.4.0 起有对抗式验证：`tree_verify {action:"adversarial", tree_id, leaf_id, max_rounds≤5, attack_timeout_ms 30s–600s}`——结构检查 + 异族红队攻击 → FAIL 的 findings 自动回注执行者修复 → 再复审 ≤3 轮。高价值/夸大风险高的产物再用，别每个节点都上（慢、烧钱）。
- 裁决落账 `leaf.verification{policy_id, pass, verdicts}`；**PASS 才可视为该点收口**（协议纪律；引擎不强制）。
- ⚠️ **FAIL 不抛错**：`tree_verify` 不通过也正常返回 `{result:{pass:false, verdicts}}`——必须读 `result.pass` 与 `verdicts[].detail`，不要以为「没报错 = 通过」。**这只对 verification 写权者成立**：`pass:false` 返回仅当调用者有 verification 写权（creator / root / delegate），无写权抛 `E_BORROWED_IDENTITY`。
- ⚠️ `tree_node {action:"set-status", status:"done"}` 实际只有两闸（done 事件 + milestones 全 `audit_pass=true`），而里程碑面没有工具写入命令 → **工具面打不通 done 状态**。收口判据用 `runtime.state=succeeded` + verify PASS，不要反复尝试 set-status done。

### 1.5 现场建树的验证归属（v0.9.0）

flow 节点在自己的会话里 `tree_plan` 现场建树时，creator/root 就是该 flow 节点会话；节点结束即 dispose。此后外层 Lead/commander 再补 `tree_verify` 会被 `E_BORROWED_IDENTITY` 拒（`verification` 只允许 creator | root）。**前提是 tree_plan 传了 session_id——不传则 root owner 为 null，连 verify-delegate 都授不出去**。两条出路：

- **a) 收口前 verify（缺省）**：创建者在结束前自己跑 `tree_verify` 落账到 `leaf.verification`；结束后按 `runtime.state=succeeded` + `tree_status {action:"validate"}` 收口（报告标注该口径）。
- **b) 验证授权委托（v0.9.0）**：root 会话结束前执行

  ```json
  { "action": "verify-delegate", "tree_id": "<tree_id>", "session_ids": ["<受信会话 id>"] }
  ```

  之后被授权者即可补 `tree_verify`。语义：**仅 root 会话可授予**（root 的 `session_id` 为 null → 拒；非 root → `E_BORROWED_IDENTITY`）；`session_ids` **全量替换**（非追加），`[]` 清空；入参按归一化裸 UUID 严格校验 v4；**最小授权面**——被授权者只能写 `leaf.verification`，event/status/context/relay/set-session 一律拒（`E_BORROWED_IDENTITY`）；变更落 `drift_log`（kind=`security`、action=`declare`、leaf_id=null）。

### 1.6 证据链与可机检 DoD

- **证据格式（写进验收）**：文件证据 `path:line`（如 `docs/plan.md:12`）；命令证据 `command → exit N`（如 `node --test → exit 0`）；事件证据 `tree_log events seq`（引用事件序号）。
- **DoD 写进 dispatch prompt 的可机检断言模板**——`leaf.dod` **不会自动送达子会话**，所以把可判真假的断言直接写进 prompt：

  ```text
  完成判定（可机检）：
  - deliverables/x.md 存在且 ≥200 字符
  - 命令 `node --test` 退出码 0；结论引用来源见 docs/plan.md:12-18
  ```

  每条断言都要能被 `tree_verify`（artifact/command/self-report）或你人工复核判真假；避免「做完了」「处理好了」这类不可判的措辞。

## 2. 动态性与预算

### 2.1 执行中动态：分解不是一次性承诺

- **执行中允许加节点**：上游产物出来后要补一步 → 直接 `tree_node add`（可带 dependencies 指向已完成节点，立即就绪）。
- **允许废弃**：某分支不需要 → `tree_node {action:"set-status", status:"pruned"}`（未 done 后代级联 pruned）。
- **禁止事后剧透式重构**：已 succeeded 的节点不改写；修正 = 新节点 + 依赖。

### 2.2 预算护栏与预检

- **派发前预检**：`tree_status {action:"sessions", tree_id}` 看 `count/max`，逼近上限先收口/剪枝再派。
- **两类深度上限**：leaf 嵌套 ≤3（root→commander→worker，再加层 `E_DEPTH_EXCEEDED`）；**宿主子会话深度上限 `max_subagent_depth` 默认 5**，超限宿主拒（包装成 `E_PORTS_PROTOCOL`）。

| 护栏 | 缺省 | 触发错误 |
|---|---|---|
| 未收口 leaf 数（`active`+`segment_pending`+`pending_brief`） | 20 | `E_NODE_BUDGET_EXCEEDED` |
| 单 leaf `subagent_spawn` 事件 | 15 | `E_SUBAGENT_BUDGET_EXCEEDED` |
| 树总会话（leaf+segment+registry 去重） | 50 | `E_MAX_SESSIONS` |
| 单 leaf 竹节链长 | 5 → `frozen` 待裁决 | 工具面表现 `runtime.state=frozen` |

- **逐树可放宽的护栏只有 `ctx_segment_threshold`（竹节阈值，DSH 缺省 42）**——它是唯一「被逐树消费」的键；其余护栏（`node_budget` 等）的「放宽」一律拒绝（recorded-only，误导审计真相）。部署级覆盖（如 `max_subagent_depth` 整数 1–100）走 `TREE_ENGINE_CONFIG`，那是**部署方**装载期的事，不是运行期改的；非法配置让插件**装载失败**（含键名），不是静默回退。v0.7.0 起 `max_sessions` **计入**竹节链 `segmentChain`——高频接力按真实会话数计费，超限即拦。

### 2.3 失败恢复矩阵

| 症状 | 怎么发现 | 怎么处置 |
|---|---|---|
| timeout（超时） | `runtime.state=timeout`；`tree_log events` 见超时事件 | `tree_dispatch cancel`（若还挂着）→ 同 leaf 再 `start`（attempt+1），或新建替代节点 |
| spawn 即死（渠道不可用） | 宿主通知 `failed ... no closing message`；`runtime.state` 仍 `running`、`tree_log events` 为 0、`harvest` 报 `all settled`、无引擎错误码 | `tree_dispatch cancel` → **换 assignee 渠道/模型**再 `start`（同渠道连试两次即死就别再试）；这不是你的简报问题，重试原文无效 |
| cancelled（被取消） | `runtime.state=cancelled` | 看 events 找取消原因；需要就重派（attempt+1） |
| frozen（链满 / 验证 onFail） | `runtime.state=frozen` | 读 events/drift 定位；`tree_maintain nudge-reset` 或按裁决人工重派 |
| 状态损坏 | `tree_status validate` 报 issues；`tree_log drift` 见异常 | `tree_maintain backup` 定期快照 → `restore` 回滚（失败 `E_BACKUP_NOT_FOUND` / `E_BACKUP_CORRUPT`） |
| nudge 7-strike prune | `tree_log events` 见 nudge 事件到第 7 次；leaf 变 `archived` | 已被 prune 的 leaf 状态机拒（`E_STATUS_TRANSITION_INVALID`）；按需重派或新建 |
| 依赖未满足 | 派发报 `E_DEPENDENCY_NOT_MET` | 对**每个**被依赖叶逐一 `tree_verify` 到 PASS，再派 |

> 只处置上面这些**可观测**状态；不要对宿主内部未暴露的行为做任何承诺（比如「宿主一定会自动重试」）。

## 3. 上下文 50% 自主交接（必读；每一层会话都要会）

### 3.1 两套机制，别混

- **竹节（tree-engine 主接力）**：长任务执行者 `tree_report {action:"context", pct}` 自报水位；触发取 `max(tokenMeter 实测, 自报 pct)` ≥ `ctx_segment_threshold`（默认 42）→（leaf 为 active 时）置 `segment_pending`，周期 sweep / `harvest` 先 interrupt 旧会话、再派新会话接手（简报 K1–K5 全文传递；leaf 不变、attempt 不变、链+1；链长 5 → `runtime.state=frozen`）。这是**同一 leaf 换会话**——v0.5.0 起引擎把 owner（`leaf.session_id`）**重绑给接手会话**，接手会话可正常 `tree_report done`。**v0.8.0 起可 per-leaf 关竹节**：等待外部编排（flow / verify / 长命令）的 leaf 由 creator/root `tree_node {action:"set-relay", relay:"off"}` 先关，结束再回 `auto`（执行者不能自关，越权 `E_BORROWED_IDENTITY`）。
- **会话自交接（`session_handoff`，会话层兜底）**：把你这层工作写进 `HANDOFF-*.md`，启动**同层级**新会话接替（根→新根；子会话→同父兄弟；父不活→root + `degraded=parent-inactive`）。这是**换会话继续干**，不依赖 tree-engine。**它不迁移 leaf owner**（见 §3.3）。

### 3.2 规则（缺省 auto → 同父兄弟接替）

1. 你是指挥官会话：每个里程碑后跑一次 `session_handoff {action:"status"}`，读真实 `context_pct`。
2. `context_pct >= 50` → **必须自主交接**，不需要上级批准：

   ```json
   { "action": "handoff",
     "summary": "树 tdemo：子节点 C1a1/C1a2 已 succeeded 且 verify PASS；C1b1 仍在 running（session …）；还差 C1b2 派发与收口。",
     "next_steps": [
       "先读 HANDOFF-*.md；跑 tree_status {action:\"harvest\"} 看剩余节点",
       "对 C1b1 的 succeeded 结果跑 tree_verify run（不传 policy_id，必传 leaf_id）",
       "建并派发 C1b2（taskType=doc），收割后按 §4 收口",
       "不要重派已完成节点"
     ],
     "files": ["…"],
     "open_questions": ["…"],
     "note": "tree tdemo / leaf tdemo-C1-commander；依赖拓扑与子节点清单见 summary；leaf owner 仍是旧会话，见 §3.3" }
   ```

3. **优先级**：先按竹节——竹节已把同一 leaf 接过去就不必再会话交接；若已到 50% 仍没等到竹节（没人 harvest / 链满 frozen / 简报回收失败 / 你根本不是 running 的 leaf owner），立即 `session_handoff`。
4. 交接前把 tree_id / leaf_id / 子节点状态 / 待验收项 / 下一步写清——接替者要能**接着当指挥官**，不是从零猜。
5. 交接后**停止新增派发**：不要新旧会话同时派发同一棵树。旧会话到点让位。

> ⚠️ `session_handoff` 由会话树单包 `@orphiczhou/dsh-session-tree` 提供，不是 tree-engine 的工具。若工具列表里没有它：不要伪造调用、不要自己改 profile——继续用竹节自报，并向上级/用户报告「上下文接近上限，需要会话交接能力」。

### 3.3 交接后的树账本协调（**所有权不迁移**）

- `session_handoff` 只在会话层接替；tree-engine 的 `leaf.session_id`（owner）**不会自动迁移**。**竹节接力不同**：v0.5.0 起引擎会在接力成功后把 owner 重绑给接手会话（接力会话可正常写 done）。
- 后果：done 事件仅 **owner 会话**可写（`E_BORROWED_IDENTITY`）。接替会话直接写 done 会失败。
- **交接后继续写 done 的两个可行序列**：
  1. **creator 重绑**：旧会话把接替会话 id + HANDOFF 路径上报 creator/上级，由 creator `tree_node {action:"set-session", tree_id, leaf_id, session_id:"<接替会话 id>"}` 重绑 owner（set-session 仅 leaf 的 creator/`added_by` 可调），之后接替会话写 done。
  2. **竹节接力**：走竹节（而非 session_handoff）的同一 leaf 换会话，引擎自动重绑 owner（v0.5.0），接替会话直接写 done，无需 set-session。
- 协调动作：
  1. 交接前/后（只要旧会话还能调工具）留痕：

     ```json
     { "action": "event", "tree_id": "tdemo", "leaf_id": "tdemo-C1-commander", "type": "progress",
       "meta": { "handoff": { "session_id": "<接替会话 id>", "handoff_path": "<HANDOFF 绝对路径>", "reason": "context-50" } } }
     ```

  2. 若你是**子节点指挥官**：把新会话 id + 交接路径上报上级（progress/blocked 事件；直接父会话用原生 `send_message`，跨层才用 `tree_send`——目标父会话须活着），请上级 `set-session` 重绑，或 `tree_dispatch cancel` → `start` 重派（attempt+1）。
  3. 若你是 **root 会话**：上级就是用户/Lead——把「leaf owner 仍是旧会话」写进交接文件与回报，由用户决定重派或新建节点。
- 不要假设引擎会自动把新会话变成 leaf owner；也不要自己冒充新会话写 done。
- **relay off 适用场景**：leaf 会去跑 flow / `tree_verify` / 长命令等外部编排时，先 `set-relay off` 防竹节打断（flow journal 可能被 interrupt 成 `cancelled / E_RUN_CANCELLED`）；编排结束、`tree_node get` 确认后再回 `auto`。

## 4. 你的收尾

**收口清单**（全绿才算收口）：

1. `tree_status {action:"validate", tree_id}` 返回 `{ok:true}`（issues 为空）。
2. **逐叶** `tree_verify run`（必传 leaf_id）到 PASS——不是「看面板算数」。
3. 树级状态以 `runtime.state` 为准（全部 `succeeded`），**不要看 `leaf.status`**（可能停留在 `pending_brief`/`active` 脱节）。
4. 目标交付物在手，且证据可机检（见 §1.6）。

全部满足后写 done：

```json
{ "action": "event", "tree_id": "tdemo", "leaf_id": "tdemo-C1-commander", "type": "done",
  "meta": { "summary": "一句话结论",
            "self_check": [
              { "item": "子节点全 succeeded + verify PASS", "pass": true, "evidence": "harvest 输出 / 各节点 verification" },
              { "item": "交付物", "pass": true, "evidence": "文件路径 / 结论" } ] } }
```

**失败收尾**同样报 done，用结构化字段（这是**约定，不是引擎强校验**，但上级能机读）：

```json
{ "action": "event", "tree_id": "tdemo", "leaf_id": "tdemo-C1-commander", "type": "done",
  "meta": { "summary": "一句话失败原因", "outcome": "failed",
            "fail_class": "budget | timeout | dependency | code | data | unknown",
            "retry_hint": "下一步怎么重试（重派哪个 leaf / 改哪个依赖 / 换哪个 taskType）",
            "evidence": "tree_log events seq / 报错码 / 文件路径" } }
```

诚实失败优于静默卡死；summary 要短（800 字符渲染截断），细节落盘到文件或 evidence 路径。你的上级用同样方式收割你。

## 5. 错误码速查（报错先认码）

| 码 | 含义 / 处置动作 |
|---|---|
| `E_TREE_NOT_FOUND` | tree_id 不存在或还没 tree_plan；核对任务书 tree_id |
| `E_NAME_INVALID` | tree_id/leaf_id 命名不符（helpTopic `naming_convention`）；按 §1.2 三段规则改 |
| `E_SCHEMA_INVALID` | 参数形状 / 角色 / 依赖传空数组 / path 与 leaf_id 不一致 / leaf 白名单外键；看 message |
| `E_DUPLICATE_LEAF` | **树重复创建 与 leaf 重加**都报它；被派发的 commander 别 tree_plan（§1.0），重加前先 `tree_node get` 确认 |
| `E_LEAF_NOT_FOUND` | leaf_id 不存在；核对拼写，用 `tree_node list` 查真名 |
| `E_DEPTH_EXCEEDED` | 超过 3 层（root→commander→worker）；把更细分解交给 worker 内部步骤，不要加层 |
| `E_DEPENDENCY_NOT_MET` | 上游未正向结算（依赖叶 verify PASS 才算；自报 done 不算）：逐叶 `tree_verify` 落 PASS 再派 |
| `E_DEPENDENCY_CYCLE` | 依赖成环，装载期拒；改拓扑 |
| `E_BORROWED_IDENTITY` | 借身份：done 只由 owner 写；set-status 由 owner/creator/root；set-session 只由 creator；set-relay 只由 creator/root；verify-delegate 只由 root、被授权者只能写 verification |
| `E_TS_NOT_MONOTONIC` | 事件时间倒挂（仅注入 ts 时可能触发；工具路径 ts 由引擎生成，通常不触发） |
| `E_MAX_SESSIONS` / `E_NODE_BUDGET_EXCEEDED` / `E_SUBAGENT_BUDGET_EXCEEDED` | 预算护栏满：先 `tree_status sessions` 看 count/max，收口/剪枝后再建 |
| `E_PORTS_NOT_WIRED` / `E_PORTS_PROTOCOL` | 宿主编排端口不可用 / 子会话深度超限（`max_subagent_depth`=5）：如实上报，不要伪造子会话 |
| `E_STATUS_TRANSITION_INVALID` | 状态机不允许该迁移（看 allowed 列表）；nudge 第 7 次强制 prune 也走状态机——`archived` 叶子被拒（`nudge_count` 不持久化增加、不落 drift） |
| `E_INVALID_UUID_STRICT` | session_id 归一化后必须严格 UUID v4（v0.7.0 起接受可选 `session-` 前缀；非 UUID 仍拒） |
| `E_BACKUP_NOT_FOUND` / `E_BACKUP_CORRUPT` | `tree_maintain restore` 找不到备份文件 / 备份损坏：重新 `backup` 或放弃 restore，按重派处置 |

## 6. 一图流

```
拿到目标（无结构）
  → 判断角色：被派发（已有 tree_id）→ 直接在自己 leaf 下 add 子节点；根会话且无现树 → 先向用户确认 tree_id 再 tree_plan（传 session_id）
  → 分解设计（产物拆分 / 粒度 / parent 从属 vs dependencies 水平依赖 / taskType）
  → tree_plan 建树（仅根会话/无现树，session_id 必传）
  → tree_node add 逐点建（无依赖就省略 dependencies 键；path 段大写开头且逐字等于 leaf_id 中间段；worker 无子节点）
  → tree_dispatch start 并行派发无依赖点（必传 prompt + 绝对路径；assignee 先查 list_subagent_models / model_route_query）
  → harvest 轮询（引擎 60s 自动 sweep；harvest 立即强制一轮但全库扫）；重派前先 cancel
  → [动态] 补点 / 废弃 / 重派（按执行中发现；失败见 §2.3 恢复矩阵）
  → 逐叶 tree_verify run（必传 leaf_id；按 taskType 路由；读 result.pass，FAIL 不抛错；cwd 指向产物目录）
  → 50% 上下文 → 先竹节（同 leaf 换会话，owner 自动重绑）；等不到就 session_handoff（换会话不迁移 owner）→
                     交接后请 creator set-session 重绑，或走竹节接力再写 done
  → 全绿（validate ok + 逐叶 verify PASS + runtime 全 succeeded）→ done 事件（summary 短 + self_check 证据；失败用 outcome/fail_class/retry_hint）
```
