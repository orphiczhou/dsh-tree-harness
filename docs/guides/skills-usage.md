# 随包 Skill 完整使用指南（tree-commander / tree-worker / session-handoff）

> 适用版本：`packages/dsh-tree-engine` **v0.13.1**、`packages/dsh-session-tree` **v1.9.0** 及以上（公开镜像 tag `v1.4.0` = `0343f0c`，21/21 SHA；v1.4.1–v1.9.0 未发布镜像）。
> 本文是「怎么用」的单一入口：从安装、确认 Skill 已进会话目录，到三层任务树、逐层干活、50% 交接、语种与排障，全部给可复制的样例。实现与设计说明见文末索引。

---

## 1. Skill 从哪来、随哪个包发布

| Skill | 所在包 | 随包文件 | 职责 |
|---|---|---|---|
| `tree-commander` | `packages/dsh-tree-engine` | `skills/tree-commander/SKILL.md` | 把目标拆成多层任务树、派独立子会话、逐点验收收口 |
| `tree-worker` | `packages/dsh-tree-engine` | `skills/tree-worker/SKILL.md` | 执行一个 leaf：按任务书与 DoD 交付、自报进度/水位、竹节与 50% 交接 |
| `session-handoff` | `packages/dsh-session-tree` | `skills/session-handoff/SKILL.md` | 任意层会话在上下文约 50% 时写交接文件并启动同层级接替会话 |

三个 Skill 都是**插件包的一部分**（`package.json.files` 含 `skills`），与工具同版本发布；由各包的 `cordis.patch.yml` 第 2 条 insert 挂载宿主机的 filesystem Skill provider：

```yaml
# packages/dsh-tree-engine/cordis.patch.yml（真实行，按可读性折行；实际为单行）
- insert:
    - id: tree-engine-skills
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: tree-engine
        includeDefaultRoots: false
        watch: false
        bundledSkillDir: !!js process.getBuiltinModule('node:path').join(
          process.getBuiltinModule('node:path').dirname(
            process.getBuiltinModule('node:module')
              .createRequire(baseUrl).resolve('@local/dsh-tree-engine/package.json')
          ), 'skills')
```

> 安装时直接用包内 patch 文件即可，**不需要手抄**这一行；这里贴出来是为了说明「`bundledSkillDir` 经安装包身份解析、不是字符串拼 `baseUrl`」——这也是为什么改包名/换目录不会让 Skill 失联。

（session-tree 同模式，`providerName: session-tree`，解析 `@orphiczhou/dsh-session-tree/package.json`。）

> **前置条件**：组合里必须有 `@deepseek-ai/dsh-skill-filesystem`（DSH 内置包，随桌面版发布）。没有它时插件与工具仍可用，只是 Skill 目录少这三条。

---

## 2. 安装（本机开发版与 Git 安装两种）

### 2.1 本机开发（profile 的 `hmr.root`）

> ⚠️ 改 profile 文件前先备份（`package.json`、`cordis.patch.yml` 各复制一份 `.bak-<日期>`）；**优先用 Plugins 页面 / `plugin_manager`**，不要在 DSH 运行中盲改配置。改坏了可用备份还原后重启。

1. 把仓库 `packages/` 目录加入 profile `cordis.patch.yml` 的 `hmr.root`（本机为 `D:/Codes/dsh-tree-harness/packages`）。
2. 在 profile 的 `package.json` 增加两个依赖（`link:` 到本仓包目录）：
   ```json
   {
     "dependencies": {
       "@local/dsh-tree-engine": "link:D:/Codes/dsh-tree-harness/packages/dsh-tree-engine",
       "@orphiczhou/dsh-session-tree": "link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree"
     }
   }
   ```
3. `pnpm install`（在 profile 目录）后重启 DSH 或对两个 bundle 条目做一次 disable→enable。
4. Plugins 页面应出现 **Tree engine** 与 **Session tree** 两行。

### 2.2 Git 安装（会话树单包，公开插件仓）

Plugins → **Add plugin** → Git URL：

```
https://github.com/orphiczhou/dsh-session-tree
```

安装后 `session_handoff` / `tree_send` 与 `session-handoff` Skill 一起生效。`tree-commander` / `tree-worker` 属于本仓 `@local/dsh-tree-engine`（未单独对外发布），从本仓安装或把 `packages/dsh-tree-engine` 作为本地路径添加。

`tree-engine` 不是一个独立仓库，所以不能像 session-tree 那样在 **Add plugin** 里直接粘一个 Git URL。可复制的安装步骤（PowerShell，路径按自己的环境改）：

```powershell
# 1) 克隆本仓（只取一次；以后 git pull 即可升级）
git clone https://github.com/orphiczhou/dsh-tree-harness.git D:\Codes\dsh-tree-harness

# 2) profile 的 cordis.patch.yml：把 packages/ 加进 hmr.root（已有则跳过）
#    - id: hmr
#      config:
#        root:
#          - "D:/Codes/dsh-tree-harness/packages"

# 3) profile 的 package.json：加两个 link 依赖（只装 tree-engine 的话第二行可省）
#    { "dependencies": {
#        "@local/dsh-tree-engine": "link:D:/Codes/dsh-tree-harness/packages/dsh-tree-engine",
#        "@orphiczhou/dsh-session-tree": "link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree"
#    } }

# 4) 在 profile 目录安装依赖
pnpm install

# 5) 让 Loader 重载（或重启 DSH）
#    plugin_manager set_plugin include:tree-engine enabled:false → true
#    plugin_manager set_plugin include:session-tree enabled:false → true

# 6) 新开会话自检：应看到 tree-commander / tree-worker（+ session-handoff）
```

> 也可以只装 `session-tree`（§2.2 的 Git URL），这样只有 `session-handoff` 一个 Skill；`tree-commander` / `tree-worker` 需要 tree-engine 这一包。

### 2.3 改完代码/配置后的重载（重要，实测）

- 宿主半 `index.js` 或 `cordis.patch.yml` 改动：对 bundle 条目做一次 **disable→enable**（Plugins 页面开关，或 `plugin_manager({action:"set_plugin", target:"include:session-tree", enabled:false})` 再 `true`）；只保存文件不会重新求值（Loader 按包名缓存宿主模块）。
- 只改 `skills/*/SKILL.md` 正文：无需重载，下一次会话目录/`skill` 工具加载即读到新内容（实测目录描述可热更新）。

---

## 3. 确认 Skill 已进会话（30 秒自检）

任选一种：

1. **看目录**：新开一个会话，问它「你看到的 Skill 有哪些？」——应含 `tree-commander`、`tree-worker`、`session-handoff`。会话系统提示里的 `<available_skills>` 就是权威目录。
2. **看日志**（可脚本化）：会话日志 `~/.dsh/sessions/<workspace-encoding>/<sessionId>/session.v4.jsonl.zstd`（多帧 zstd）中，`user/message` 的 `<system-reminder><available_skills>` 块应出现上述名字。先把本仓 clone 到本地，再跑（`--expect` 按实际安装的包选择；缺省脚本期望三个全在）：
   ```powershell
   # 只装了 session-tree（Git 安装）
   node scripts/skill-e2e/collect-skills.mjs <sessionId> --expect session-handoff --expect-at latest --json
   # 两个包都装了
   node scripts/skill-e2e/collect-skills.mjs <sessionId> --expect tree-commander,tree-worker,session-handoff --expect-at latest --json
   ```
3. **让 agent 加载**：直接说「用 session-handoff skill」/「用 tree-commander skill」，agent 会调用 `skill {name:"…"}` 读正文后再执行。

排障：三条都不出现 → 检查 ① 包是否装（`plugin_manager list_plugins`）；② profile 是否同时有 `@deepseek-ai/dsh-skill-filesystem`（**随 DSH 桌面版内置，不要单独安装**）；③ 是否在改完 patch 后没做 disable→enable；④ 是否是**新开**会话（目录在会话启动时注入，旧会话不刷新）。

> **安装后自检（推荐）：`tree_doctor {action:"run"}`**（tree-engine ≥ 0.13.1）。它是第 9 个 `tree_*` 工具、**只读零写副作用**：一次给出 7 项检查（`package` / `tool-count` / `skills` / `tree-data` / `stale` / `sweep` / `env`）与 `summary{pass,warn,fail}` + 一行 `hint`；传 `tree_id`（如 `tree_doctor {action:"run", tree_id:"wave1"}`）会额外校验该树并统计停滞节点。**FAIL 不 throw**——它是诊断器不是门禁，装完/重载后先跑它，比逐项猜「工具或 Skill 为什么没出现」快。

### 3.1 五分钟冒烟（第一次用就照这个顺序）

1. 装 bundle → 确认 Plugins 行已启用；
2. **新开**一个会话，问「你看到的 Skill 有哪些」→ 应看到 `session-handoff`（若同时装了 tree-engine，还有 `tree-commander`/`tree-worker`）；
3. 说「交接一下，先看 status」→ agent 调 `session_handoff {action:"status"}`，渲染行应含 `context=…% (threshold 50%) … lang=zh|en`；
4. 说「写个交接文件，先别开新会话」→ agent 用 `spawn:false`，你得到一个 `HANDOFF-*.md`（**干跑不被阈值闸拦**，50% 以下也能写；5 分钟内第二次仍会被防重复闸拒）；
5. 想看完整接替：说「force 交接一次」→ 返回 `successor <id> kind=…`；5 分钟内再交接会被 `recent-handoff` 拒绝，**这是防重复闸，不是故障**；新会话在 50% 以下被 `below-threshold` 拒绝同样是预期。

---

## 4. 用法总览：最小提示词 → 预期动作

| 你说（极简，不用点名工具） | 命中 Skill | 预期行为 |
|---|---|---|
| 「把这个任务拆成三层并派人做，验证通过再收口」 | `tree-commander` | `tree_plan` 建树 → `tree_node add` 建 commander/worker → `tree_dispatch` 逐层派发 → `tree_status harvest` 收割 → `tree_verify` 验收 |
| 「继续干，快到上限就交接」 | `session-handoff`（+ 当前层 Skill） | 先 `session_handoff {action:"status"}` 读占用；≥50% 时 `handoff` 写文件并启动同层接替 |
| 「按任务书干活/执行这个 leaf/自报进度」 | `tree-worker` | `tree_report` 上报 brief_echo/plan/progress/context；按 DoD 交付后 `done` |
| 「多层分解执行」「派一队人并行做」 | `tree-commander` | 同上（依赖拓扑/并行由模型决定） |
| 「根会话→中间层→执行层三层都能干活，并在中间层交接一次」 | `tree-commander` + `session-handoff` | 建三层树并在中间层会话执行一次真实交接 |

Skill 只是**纪律与范例**，工具名仍以工具面为准；模型看不到 Skill 时工具依然存在，但容易漏掉「50% 交接」「done 所有权」「竹节阈值」等约定。

---

## 5. tree-commander：三层任务树完整样例

目标：给仓库补一段 CHANGELOG，拆三层并派人做完。

```text
# 1) 建树（仅根会话/尚未被派发时；强烈建议传 session_id = $env:DSH_SESSION_ID）
tree_plan {action:"create", tree_id:"chlog", session_id:"<你的会话id（$env:DSH_SESSION_ID，裸 UUID）>", root_brief:{goal:"补齐 CHANGELOG"}, root_dod:{dod:"tests green, CHANGELOG 有 Unreleased 段"}}

# 2) 建中间层 commander（path 段必须大写开头；命名 <prefix>-<Role><seq>-<name>）
tree_node {action:"add", tree_id:"chlog", leaf:{leaf_id:"chlog-C1-commander", parent:"chlog-root", path:"C1", role:"commander", added_by:"<你的会话id>", taskType:"doc"}}

# 3) 派发（无依赖可并行；assignee 可选 provider/model/effort）
tree_dispatch {action:"start", tree_id:"chlog", leaf_id:"chlog-C1-commander", prompt:"作为 C1 指挥官：调研本仓版本与变更，拆出 facts/写作/验收三个 worker，派发并收口。"}

# 4) 中间层会话继续分层（它拿到的 tree_id 已存在 → 不要 tree_plan）
tree_node {action:"add", tree_id:"chlog", leaf:{leaf_id:"chlog-C1a1-worker", parent:"chlog-C1-commander", path:"C1a1", role:"worker", added_by:"<中间层会话id>", taskType:"code-change"}}
tree_dispatch {action:"start", tree_id:"chlog", leaf_id:"chlog-C1a1-worker", prompt:"…"}

# 5) 收割与验收
tree_status {action:"harvest", tree_id:"chlog"}
tree_verify {action:"run", tree_id:"chlog", leaf_id:"chlog-C1a1-worker"}     # 返回 result.pass；FAIL 不抛错
tree_log {action:"events", tree_id:"chlog", leaf_id:"chlog-C1a1-worker"}

# 6) 收口：done 事件 → runtime.state=succeeded；commander 读 verify .pass 后放行
tree_report {action:"event", type:"done", tree_id:"chlog", leaf_id:"chlog-C1a1-worker"}
```

要点（详见 `tree-commander` Skill）：

- **三层上限**：root → commander → worker；worker 不能建子节点。
- **被派发的 commander 不要再 `tree_plan`**（树已存在；再 create 会 `E_DUPLICATE_LEAF` 或把节点建到另一棵树）。
- `tree_verify` 的 FAIL **不会**阻止 `succeeded`，commander 必须自己读 `result.pass`。
- 竹节接力：worker 用 `tree_report {action:"context", pct:N}` 自报水位，引擎在 **pct≥42** 自动换会话继续同一 leaf；接力后 owner 会重绑给接手会话（v0.5.0 起）。
- 预算：树总会话数 ≤50（v0.7.0 起**计入**竹节接力会话 `runtime.segmentChain`；`runtime.history` 中接力前旧会话暂不计，详见 §8.1）。

---

## 6. tree-worker：被派发后做什么

1. 读任务书，`tree_report {action:"event", type:"brief_echo"}` 回述目标与 DoD（确认理解）。
2. `tree_report {action:"event", type:"plan"}` 给出交付路径，然后干活。
3. 期间 `tree_report {action:"progress"}` 报关键进展；`tree_report {action:"context", pct:N}` 报上下文水位（整数 0–100）。
4. 交付后由 **commander 跑 `tree_verify`**（worker 不自跑；拿到 verdicts 后按 findings 修产物），再 `tree_report {action:"event", type:"done"}` 结算。
5. **上下文接近 50% 时**：按 `session-handoff` Skill 自主交接（见 §7），并在 `tree_report {action:"progress"}` 里写明交接文件与新会话 id，供 commander 继续收割。
6. 卡住：`tree_report {action:"event", type:"blocked", meta:{reason}}`，等 commander 决定；不要自己改树结构。

---

## 7. session-handoff：50% 自主交接完整样例

### 7.1 判断与执行

```text
# 1) 先读真实占用（不要凭感觉）
session_handoff {action:"status"}
#    → session_handoff status: context=68.4% (threshold 50%) … preset=standard permission=... successor=sibling next=handoff lang=zh

# 2) ≥50% 时交接（root 会话会自动走 root 接替；子会话走同父兄弟）
session_handoff {action:"handoff",
  summary:"一句话说明任务当前状态",
  next_steps:["下一步 1","下一步 2"],
  files:["改动过的文件路径"],
  open_questions:["未决问题"],
  note:"可选补充"}
#    → session_handoff: wrote <cwd>\HANDOFF-<短id>-<时间>.md; successor <id> kind=sibling preset=standard inherited=session-route lang=zh
```

- 阈值默认 50，可用 `threshold_pct` 覆盖；`force:true` 只在用户明确要求提前交接时用。
- 子会话在父 Agent 活着时生成**同父兄弟**（同层）；父已不在时降级为根级并显式 `degraded:"parent-inactive"`。
- 5 分钟内重复交接会被拒（`recent-handoff`）；需要立刻再写一份时才 `force:true`。

### 7.2 接替会话继承什么

工作目录 / 侧栏工作区归属 / Agent 预设（工作模式 → 工具集）/ 权限模式（sandbox+approval）/ 模型 / 思考等级 / `maxTokens`；返回值里可逐项核对 `successor.agent_preset`、`successor.permission`、`successor.workspace`、`successor.max_tokens`、`warnings[]`。

### 7.3 接替提示语的语言（v1.3.1）

接替会话首条消息跟随 **DSH 界面语言**（Settings → General → Language，`locale.preference`）：

- 界面语言中文 → `你是 <源会话> 的接替会话……请先读取交接文件：<绝对路径>`
- 界面语言英文 → `You are the successor session … First read the handoff file at: <path>`
- 其它语言/未设置 → 英文（DSH 的 fallback 一致）。

`status`/`handoff` 渲染行尾带 `lang=zh|en`，返回对象含 `interface_language`；验收脚本：

```powershell
node scripts/e2e/verify-kickoff-language.mjs --session <successorId> --expect zh --json
node scripts/e2e/verify-handoff.mjs --source <源会话> --successor <接替会话> --expect-kind sibling|root
```

### 7.4 验收三件事

1. 返回行 `successor <id>` 存在且 `kind` 符合层级；
2. 接替会话首轮**真的读了** HANDOFF 文件（不是只回 READY）；
3. 继承事实无 `unavailable`、无 `degraded`、`warnings[]` 为空（或逐项解释）。

---

## 8. 跨层协调：竹节 42% 与会话交接 50%

| 机制 | 触发 | 归属 | 关系 |
|---|---|---|---|
| 竹节接力（tree-engine） | worker `tree_report {action:"context", pct≥42}` | 同一 leaf 换会话继续，`leaf.session_id` 重绑给接手会话（v0.5.0） | 先按竹节：引擎自动换棒，leaf 不中断 |
| 会话自交接（session-tree） | 任意会话 `session_handoff status` 显示 `context_pct ≥50` | 同层级新会话（root→root，子→同父兄弟） | 竹节已换棒则不用再交接；**已到 50% 仍没等到竹节**（如链满 `frozen` / 简报回收失败 / 你已不是 running 的 leaf owner）→ 立即交接，并在 `tree_report progress` 留痕 |

### 8.1 预算与 id 口径（v0.7.0）

- **root 会话 id 带 `session-` 前缀也可用（v0.7.0 归一化）**：DSH 根/主会话的 `$env:DSH_SESSION_ID` 形如 `session-<uuid>`，被派发子会话是裸 UUID v4。tree-engine v0.7.0 起在**写入侧**归一化（剥 `session-` 前缀、小写、存裸 UUID 规范形），**比较侧**用 `normalizeSessionId` / `sameSession`——`tree_plan` 的 `session_id`、`tree_node add` 的 `added_by`、`tree_report` 的调用者身份都**原样传即可**，不要手工截/拼前缀。**UUID v4 严格性不放宽**：归一化后仍非 v4 照旧 `E_INVALID_UUID_STRICT`。
- **`max_sessions` 计入竹节接力（v0.7.0）**：树会话上限 50 的计数集合 = `leaf.session_id` ∪ `leaf.segment_chain` ∪ `leaf.runtime.segmentChain` ∪ `session_registry`（按归一化会话 id 去重）——一次竹节接力多一个会话就多计 1，超限即 `E_MAX_SESSIONS`。**已知边界**：`leaf.runtime.history` 中接力**前**的旧会话暂不计入（下一轮「`runtime.history` 预算口径」议题）。

---

## 9. 版本与升级

- 三个 Skill 随包版本走：`dsh-tree-engine` 0.13.1 / `dsh-session-tree` 1.9.0（公开镜像 tag `v1.4.0` = `0343f0c`；v1.4.1–v1.8.3 未发布镜像）。
- **session-tree 1.9.0**：Tree Runs **Hierarchy | Dependency 双视图（B 方案）** —— Hierarchy 仍是默认主视图（组织从属）；新增 Dependency 视图只画声明依赖，按最长路径分列（`depGraphLayout`）、列顶层级带 `level N (可立即派发/收口)`、入度 ≥ 2 的节点显示 join 徽标「等 N 个前置」（`depJoinCountsOf`）；视图切换在工具栏最前，持久化到 localStorage `dsh.session-tree.graph-view`（脏值回落 hierarchy）。`graphCanvasOf` 改为复用 `graphDrawEdgesOf(leaves, view)`，依赖视图的列右侧 lane 也计入画布宽度，避免 v1.8.4 那类裁切复发。`tree-state.json` 契约、投影字段、依赖闸语义均未改动。测试 panel-render **107 → 113/113**（V2-50..55）。
- **session-tree 1.8.4**：Tree Runs **依赖虚线消失修复** —— v1.8.3 的同列 lane 落在最后一列右侧、超出 `layout.graphW`（wave2 484 / lane 486..526），被 `svg viewBox` 裁掉；新增 `graphCanvasOf(leaves, rootLeafId, layout)` 把路由点纳入画布（canvas / svg width·viewBox / Fit 全用它；wave2 484→578、d27fl 752→766）；测试 panel-render 105→**107/107**（V2-48..49）。
- **session-tree 1.8.3**：Tree Runs **关系图可读性 A 方案** —— 点亮边置顶（`st-tr2-edges-back` / `st-tr2-edges-front` 两层 + 16% 同色 halo）、依赖边障碍感知正交路由 + 圆角弧（`depRoutePoints`：列间空道 / 同列右侧 lane；`roundedPathOf(points, 10)`；反向依赖保留贝塞尔但强制前层）、lane 扇出防重叠、不新增 hook；B/C 升级方案见 `docs/operations/panel-v2/ROADMAP-relations-2026-11-17.md`；测试 panel-render 101→**105/105**。
- **session-tree 1.8.2**：Tree Runs **依赖关系可读性**（用户反馈「图里面的节点之间的虚线是啥意思？被挡住了看不清关系」）—— 虚线 = `dependencies` 声明依赖（目标等前置结算才可派发）、实线 = `parent` 父子从属；边先于节点绘制会被遮挡，故每条边挂 `<title>`（`A is parent of B` / `B depends on A`）、选中节点只提亮它的边（无关边压到 0.12），图例与 hint 写明语义；叶属性栅格新增 `Blocks`（反向依赖）与 `Dependencies` 成对（17→18 项）；测试 panel-render 98→**101/101**（V2-41..43）。安装/重载后页头应显示 `v1.8.2`。
- **session-tree 1.8.1**：Tree Runs **图内节点点击失效**修复（用户反馈「我要的是点击图上的各个节点，显示详细信息」）—— 视口在 `pointerdown` 就 `setPointerCapture`，浏览器把随后的 `click` 重定向到捕获元素，节点自身 `onClick` 永不触发（叶表行没有捕获，所以「点列表才出详情」）；改为拖拽阈值（`GRAPH_PAN_THRESHOLD` 4px，曼哈顿距离）之后才武装捕获、`endPan` 释放，未拖动时点击走原生路径；测试 panel-render 95→**98/98**（V2-38..40）。安装/重载后页头应显示 `v1.8.1`。
- **session-tree 1.8.0**：Tree Runs 树图区**高度可调 + 打开即 Fit 全图**（用户反馈「一条缝」）—— ① 视口显式高度（默认 420px / 拖拽 220–900px / `localStorage` 记忆）替代旧 `max-height:520px`（flex 列里自动最小尺寸为 0，会被挤成一条缝）；② 10px 分隔条可拖、双击复位；③ 打开/换树/改高度按视口 `fitZoomOf` 自动 Fit（幂等记忆，不夺用户手动缩放）；测试 panel-render 90→**95/95**（V2-33..37）、style-guard 50→**51/51**。安装/重载后页头应显示 `v1.8.0`。
- **tree-engine 0.13.1**：新增第 9 个工具之后的**洁净室修复版（D41）**—— ① 引擎新增导出纯函数 `settleTextFor(role, treeId, leafId)`：派发尾部的结算指令按 role 分支，commander/auditor 被允许在本树内使用 `tree_node / tree_dispatch / tree_verify / tree_status / tree_log` 继续分解与验收（旧版对所有 leaf 统一追加「除此之外不得操作树」，被派发的 commander 因此撞上自相矛盾的说明书），worker 与缺省角色保持最小权限；`dispatch:start` 与竹节接力都把 `role` 传给 ports。② 渲染可机读：`tree_verify {action:"dod"}` 改为 `DoD preview (<policy>)`（旧版读 `result.pass` 恒显示 `FAIL ()`）、`run` 补 `verdicts[].detail`、`tree_status overview` 显示 `leaves=N [runtime 分布] root=<id>`、`harvest` 无运行叶显示 `all settled`、`tree_node list/list-all` 一行一叶（12 行封顶）。③ `tree_verify {action:"run"}` 缺 `leaf_id` 直接报错（旧版静默跑 self-report 且不落账 = 假验收）。④ 随包 Skill 正文升到 **v2.5**（tree-commander 16 项 / tree-worker 10 项修订：失败恢复矩阵、parent vs dependencies 与水平依赖示例、`dependencies` 空数组必须省略、`session_id` 不传的后果、逐叶 verify 闭环、证据链与可机检 DoD、观测与面板、drift 申报只进事件流、owner 不随 handoff 迁移）。测试数 258→**262/262**（新增 `tests/tool-render.test.js` 4 例）。安装/重载后 `tree_doctor` 应显示 `version=0.13.1`。
- **tree-engine 0.13.0**：新增第 9 个工具之后的**树级展示状态版（用户反馈轮）**—— ① `src/panel-view.js` 新增 `treeStateOf(leaves, rootLeafId)`：`tree_plan` 的 root 是容器叶、永远没有 done 事件（raw 恒 `active`），故 root 只参与**失败**判定，不参与「在跑/未开始」判定；子叶 running/segment_pending → running，有 pending → pending，全部结算 → succeeded，单叶树回落 root 展示态；② `projectTreeSummary` 新增 `state`、`projectTreeDetail` 新增顶层 `state`，列表徽标与详情共用权威字段（客户端不再自行按 counts 猜）；③ 真实 36 棵树 running 徽标 29→**7**（succeeded 23 / failed 4 / pending 2），4 棵 failed 均有子叶 `runtime.state=timeout` 实据；测试数 257→**258/258**（新增 `treeStateOf` 15 条断言）。安装/重载后 `tree_doctor` 应显示 `version=0.13.0`。
- **tree-engine 0.12.0**：新增第 9 个工具之后的**面板投影派生展示态版（D34）**—— ① `src/panel-view.js` 新增 `runtimeStateOf`/`displayStateOf`：`runtime.state` 失败类（failed/timeout/cancelled）优先，其余按 `verification.pass===true` → `runtime.state=succeeded` → `pruned` → `segment_pending` → `last_event_type=done` → `active→running` → raw 别名归一 → `pending_brief/pending/缺失→pending`；② `projectLeaf.status` 改为派生展示态并新增 `state`/`rawStatus`/`runtimeState` 三键，`projectTreeDetail.root` 同步；③ `statusCounts`/`stats.byStatus` 同口径（真实 141 叶里 55 叶 `pending_brief & succeeded & pass` 不再显示 pending）；测试数 256→**257/257**（`tests/panel-view.test.js` 29→30 例，另 5 条断言改新契约）。安装/重载后 `tree_doctor` 应显示 `version=0.12.0`。
- **tree-engine 0.11.0**：新增第 9 个工具之后的 `/tree-panel` 只读 HTTP 投影路由版（D30）—— ① 三端点 `GET /tree-panel/trees`、`/trees/<treeId>`、`/trees/<treeId>/events`（webServer 可选注入，缺席降级、不阻断工具面；跨实例幂等注册先 dispose 再 register）；② Host/Origin/Sec-Fetch-Site 三重校验 + `no-store` + 不回 ACAO；③ 投影纯函数 `src/panel-view.js` 脱敏截断——不透出 prompt/meta/环境变量，assignee 只留 provider/model/effort，preview 120/200 字符上限；④ 工具面仍 9 工具不变（`session-tree` v1.5.0 的 Tree Runs 面板数据源即此路由）；测试数 227→**256/256**（新增 `tests/panel-view.test.js` 29 例）。安装/重载后 `tree_doctor` 应显示 `version=0.11.0`。
- **tree-engine 0.10.1**：新增第 9 个工具之后的 flash 审计第二批修复版（D24/D25）+ **宿主 rc.3 扁平 spec 适配（D28）**—— ① 依赖闸「已验证失败不放行」+ **依赖只认正向结算信号（三重闸 done ∨ verification.pass=true；自报 done 不再放行下游，#8 主旁路闭合）** + sweep stale-done 判据；② `leaf:set-verification` verdicts/pass 一致性校验 + 空 verdicts 的无证据 PASS 拒绝（#15）；③ 竹节接力会话预算预检 + 唯一性回滚 + 单账本口径（#20）；④ `audit_meta` 严格校验 + 消费键放宽留痕 / recorded-only 键上调拒收 / 编排键拒收 + 阈值回退修复（#21/#23）；⑤ `subagent_spawn` 仅 owner（#22）；⑥ `fsStore.read` `.tmp` 灾备恢复 + 损坏原件取证副本与 call-log 留痕（#28）；⑦ `tree_maintain {action:"gc"}`（archived 账本截断）+ call-log 10MB 滚动（#30）；⑧ `startActivation` rc.3 扁平 spec（`buildActivationSpec`，嵌套形状真机派发全量失败修复）；测试数 213→**227/227**（0.10.0 为 225/225，compat 14→16）。安装/重载后 `tree_doctor` 应显示 `version=0.10.1`。
- **tree-engine 0.9.0**：新增第 9 个工具之后的硬安全与可观测性收口版（D23）—— ① 跨进程 `.lock` 文件锁（写路径 `withTreeMut`：O_EXCL + nonce + 陈旧接管 + 心跳；只读 `withTree` 不加锁）；② nudge 第 7 次强制 prune 走状态机（archived 被 `E_STATUS_TRANSITION_INVALID` 拒）；③ `leaf:add` 13 键字段白名单（内部字段永不接受输入）；④ `tree_log {action:"events"}` 事件 meta 机读化（done meta 可读）；⑤ `tree_maintain {action:"verify-delegate"}` 验证授权委托（仅 root 授予、被授权者只能写 `leaf.verification`）；测试数 172→**213/213**。安装/重载后 `tree_doctor` 应显示 `version=0.9.0`。
- **tree-engine 0.8.1**：新增第 9 个工具之后的深度预算修复版（D22）—— ① 新增 `max_subagent_depth` 配置（缺省 5，`TREE_ENGINE_CONFIG` 可覆盖，非法值装载期失败）；② `tree_dispatch`/竹节接力/攻击审计会话显式传宿主 `request.maxDepth`（宿主只在显式传入时校验深度，此前组合路径无平台兜底）；③ 新增 `buildStartRequest` 纯函数 + 4 例 depth-cap + 3 例 compat 测试；测试数 165→**172/172**。安装/重载后 `tree_doctor` 应显示 `version=0.8.1`。
- **tree-engine 0.8.0**：新增第 9 个工具之后的组合修复版 —— ① per-leaf relay 开关（`tree_node {action:"set-relay", relay:"auto"|"off"}`，等待 flow/verify/长命令的 leaf 设 `off`，sweep 只跳过竹节）；② usagePct 测量端口修复（宿主 tokenMeter 安全获取 + 5 形状提取）；③ sweep 跨实例（热更僵尸）生命周期；④ relay parent 安全重解析；Skill 正文升到 **v2.2**；测试数 112→**165/165**。安装/重载后推荐先跑一次 `tree_doctor` 自检（见 §3）。
- **tree-engine 0.7.0**：新增第 9 个工具（`tree_doctor`）之后的引擎收口版 —— ① W2.1 会话预算计入竹节链 `runtime.segmentChain`；② W2.3 RC2 兼容层单测 11 例；③ W2.6 root/主会话 id 归一化（可选 `session-` 前缀）；Skill 正文升到 **v2.1**；测试数 84→**112/112**。
- **tree-engine 0.6.0**：新增第 9 个工具 **`tree_doctor`**（只读自检，7 检查项）+ leaf 写面护栏（`LEAF_WRITE_MATRIX`），测试数 67→84。
- **Skill 版本差（v2.5）**：`tree-commander` / `tree-worker` SKILL 正文为 **v2.5**（随 tree-engine v0.13.1 分发：洁净室与三路审计修订——失败恢复矩阵 / parent vs dependencies / `dependencies` 空数组必须省略 / `session_id` 与 root owner / 逐叶 verify / 证据链与可机检 DoD / 观测与 Tree Runs 面板 / drift 申报只进事件流 / owner 不随 handoff 迁移；工具面仍是 9 个）：工具面 9 个、`session-` 前缀归一化、`max_sessions` 计入竹节链、per-leaf relay 开关）；`session-handoff` SKILL 随 session-tree **v1.4.0**（补 `tree_send` 仅同树 / 无 `parent` 入参说明）。
- **版本差异速查**：
  - **1.3.0**：随包 `session-handoff` Skill + skill provider patch 行（此前无 Skill）；
  - **1.3.1**：接替提示语跟随 DSH 界面语言（zh/en；`lang=` + `interface_language`）；
  - **1.3.2**：Skill 使用文档补全（样例/参数表/冒烟/排障/英文触发词）；
  - **1.3.3**：`spawn:false` 干跑不再被阈值闸拦；文档路径与样例修正；
  - **1.3.4**：洁净室文档债清扫（语言验收表述、set-session 主体、英文触发词、版本矩阵）；
  - **1.3.5**：SKILL 补 `spawn:false` 例外说明；README root→grandchild 措辞修正；
  - **1.3.6**：文档按目录归档（`docs/README.md` 索引）+ 新增人类安装指南 / Agent 安装指南（`AGENT-INSTALL.md`）；无代码行为变化。
- **1.4.0**：**Q4 安全收紧**——`tree_send` 仅同树投递、移除 `parent` 入参、调用者谱系校验（跨树 `E_CROSS_TREE_SEND`）；`session-handoff` SKILL 同步说明。
- **1.4.1**：rail 收起态 hook 数量崩溃修复（React #300/#310，F8）；无 Skill 变化。
- **1.5.0**：**Tree Runs 面板**——composer.dock 入口 pill（order:6）+ 右栏页签席位 kind `tree-runs`（右栏服务缺席降级 `shell.overlay`），数据 = 同源 fetch `/tree-panel/*`。
- **1.6.0**：**Tree Runs 面板 v2（Flow Runs 同布局）**——入口 pill 与 Flow Runs 同视觉逐值对齐、面板体左右分栏同屏（左列表列 + 右详情区），Detail = 字段栅格 + 依赖 DAG TreeGraph 树图（缩放平移/Fit/LOD）+ LeafTable 8 列 + 事件尾；panel-render 58→**73/73**。
- **1.6.1**：**面板无样式根因修复**——样式表自打 `data-plugin` 归属（宿主把无标 `<style>` 视为无主）+ 守卫旗标烧毁改序 + **陈旧 sheet 就地刷新**（热升级后 head 里残留旧表会让 v2 的 `st-tr2-*` 全部无规则）+ 入口 pill 改**内联样式逐值照抄 Flow Runs**；style-guard 34 → **50/50**（当前版本）。
- 升级包后：宿主半/patch 有变化 → disable→enable；只改 Skill 正文 → 新会话直接读到。
- 会话树公开插件仓：`orphiczhou/dsh-session-tree`（tag = 版本号）；本仓 `packages/dsh-session-tree` 是唯一源码事实源。

---

## 10. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 新会话看不到三个 Skill | 包未装 / 无 `dsh-skill-filesystem` / patch 改动未重载 | 查 Plugins 列表；查 profile 是否有该 provider；disable→enable 后重试 |
| `unknown tool session_handoff` | 会话树 bundle 未启用 | 不要自造工具；检查 `@orphiczhou/dsh-session-tree` |
| 树任务第二层报 `E_DUPLICATE_LEAF` | 被派发的 commander 又 `tree_plan create` | 已存在的树 → 跳过 `tree_plan`，直接 `tree_node add` |
| worker 写 `done` 被 `E_BORROWED_IDENTITY` 拒 | 旧版本竹节未重绑 owner | 升级 tree-engine ≥0.5.0；旧会话交棒前先写 done，或 commander 用 harvest 的 `relay.sessionId` 调 `tree_node set-session` |
| 接替会话首条是英文但界面是中文 | 旧版插件（<1.3.1）或语言文件读不到 | 升级 `dsh-session-tree` ≥1.3.2（语言跟随自 1.3.1 起）；`status` 行看 `lang=`；确认 profile 有 `locale` 配置 |
| `tree_report {action:"context"}` 报 `E_SCHEMA_INVALID` | `pct` 传了小数 | 传 0–100 整数 |

---

## 11. 索引

- 技能正文：`packages/dsh-tree-engine/skills/tree-commander/SKILL.md`、`…/tree-worker/SKILL.md`、`packages/dsh-session-tree/skills/session-handoff/SKILL.md`
- 设计/实现：`docs/architecture/session-handoff-2026-11-11.md`、`docs/reports/e2e-handoff-2026-11-11.md`、`docs/reports/e2e-kickoff-language-2026-11-11.md`
- 一致性与 E2E：`docs/reports/audit-tree-system-2026-11-11.md`、`docs/reports/skill-e2e-2026-11-11.md`
- 脚本：`scripts/skill-e2e/collect-skills.mjs`、`scripts/skill-e2e/summarize-run.mjs`、`scripts/e2e/verify-handoff.mjs`、`scripts/e2e/verify-kickoff-language.mjs`
- 命令速查与热更纪律：`agent.md` §0.2 / D12；版本与发布：`docs/guides/publishing.md`
