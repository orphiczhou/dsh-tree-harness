# 随包 Skill 完整使用指南（tree-commander / tree-worker / session-handoff）

> 适用版本：`packages/dsh-tree-engine` **v0.5.0**、`packages/dsh-session-tree` **v1.3.2** 及以上（公开插件仓同步 tag `v1.3.2`）。
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
# packages/dsh-tree-engine/cordis.patch.yml（节选）
- insert:
    - id: tree-engine-skills
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: tree-engine
        includeDefaultRoots: false
        watch: false
        bundledSkillDir: !!js process.env.__<解析自 @local/dsh-tree-engine/package.json>/skills
```

（session-tree 同模式，`providerName: session-tree`，解析 `@orphiczhou/dsh-session-tree/package.json`。）

> **前置条件**：组合里必须有 `@deepseek-ai/dsh-skill-filesystem`（DSH 内置包，随桌面版发布）。没有它时插件与工具仍可用，只是 Skill 目录少这三条。

---

## 2. 安装（本机开发版与 Git 安装两种）

### 2.1 本机开发（profile 的 `hmr.root`）

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

### 2.3 改完代码/配置后的重载（重要，实测）

- 宿主半 `index.js` 或 `cordis.patch.yml` 改动：对 bundle 条目做一次 **disable→enable**（Plugins 页面开关，或 `plugin_manager({action:"set_plugin", target:"include:session-tree", enabled:false})` 再 `true`）；只保存文件不会重新求值（Loader 按包名缓存宿主模块）。
- 只改 `skills/*/SKILL.md` 正文：无需重载，下一次会话目录/`skill` 工具加载即读到新内容（实测目录描述可热更新）。

---

## 3. 确认 Skill 已进会话（30 秒自检）

任选一种：

1. **看目录**：新开一个会话，问它「你看到的 Skill 有哪些？」——应含 `tree-commander`、`tree-worker`、`session-handoff`。会话系统提示里的 `<available_skills>` 就是权威目录。
2. **看日志**（可脚本化）：会话日志 `~/.dsh/sessions/<workspace-encoding>/<sessionId>/session.v4.jsonl.zstd`（多帧 zstd）中，`user/message` 的 `<system-reminder><available_skills>` 块应出现上述名字。本仓脚本：
   ```powershell
   node scripts/skill-e2e/collect-skills.mjs <sessionId> --expect-at latest --json
   ```
3. **让 agent 加载**：直接说「用 session-handoff skill」/「用 tree-commander skill」，agent 会调用 `skill {name:"…"}` 读正文后再执行。

排障：三条都不出现 → 检查 ① 包是否装（`plugin_manager list_plugins`）；② profile 是否同时有 `@deepseek-ai/dsh-skill-filesystem`（**随 DSH 桌面版内置，不要单独安装**）；③ 是否在改完 patch 后没做 disable→enable；④ 是否是**新开**会话（目录在会话启动时注入，旧会话不刷新）。

### 3.1 五分钟冒烟（第一次用就照这个顺序）

1. 装 bundle → 确认 Plugins 行已启用；
2. **新开**一个会话，问「你看到的 Skill 有哪些」→ 应看到 `session-handoff`（若同时装了 tree-engine，还有 `tree-commander`/`tree-worker`）；
3. 说「交接一下，先看 status」→ agent 调 `session_handoff {action:"status"}`，渲染行应含 `context=…% (threshold 50%) … lang=zh|en`；
4. 说「写个交接文件，先别开新会话」→ agent 用 `spawn:false`，你得到一个 `HANDOFF-*.md`（这一步不触发阈值/防重复问题）；
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
# 1) 建树（仅根会话/尚未被派发时）
tree_plan {action:"create", tree_id:"chlog", root_brief:{goal:"补齐 CHANGELOG"}, root_dod:{accept:"tests green, CHANGELOG 有 Unreleased 段"}}

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
- 预算：树总会话数 ≤50（不含竹节接力会话）。

---

## 6. tree-worker：被派发后做什么

1. 读任务书，`tree_report {action:"event", type:"brief_echo"}` 回述目标与 DoD（确认理解）。
2. `tree_report {action:"event", type:"plan"}` 给出交付路径，然后干活。
3. 期间 `tree_report {action:"progress"}` 报关键进展；`tree_report {action:"context", pct:N}` 报上下文水位（整数 0–100）。
4. 交付后 `tree_verify`（由 commander 跑或自己跑），再 `tree_report {action:"event", type:"done"}` 结算。
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
| 会话自交接（session-tree） | 任意会话 `session_handoff status` 显示 `context_pct ≥50` | 同层级新会话（root→root，子→同父兄弟） | 竹节已换棒则不用再交接；**已到 50% 仍没等到竹节**（如 commander 不 harvest）→ 立即交接，并在 `tree_report progress` 留痕 |

---

## 9. 版本与升级

- 三个 Skill 随包版本走：`dsh-tree-engine` 0.5.0 / `dsh-session-tree` 1.3.2（公开插件仓 tag `v1.3.2`；Skill 自 1.3.0 起，接替提示语语言跟随自 1.3.1 起）。
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
- 设计/实现：`docs/session-handoff-2026-11-11.md`、`docs/e2e-handoff-2026-11-11.md`、`docs/e2e-kickoff-language-2026-11-11.md`
- 一致性与 E2E：`docs/audit-tree-system-2026-11-11.md`、`docs/skill-e2e-2026-11-11.md`
- 脚本：`scripts/skill-e2e/collect-skills.mjs`、`scripts/skill-e2e/summarize-run.mjs`、`scripts/e2e/verify-handoff.mjs`、`scripts/e2e/verify-kickoff-language.mjs`
- 命令速查与热更纪律：`agent.md` §0.2 / D12；版本与发布：`docs/publishing.md`
