# 组合式编排分层与问答解说（归档）

> **性质**：问答整理归档（2026-11-12，接续会话中 Lead 的只读解说），**不是决策记录**，不改变任何已批准决策。
> **基线**：本仓 `master`（含 tree-engine **v0.8.0** / session-tree **v1.3.7**）；DSH `0.2.2-rc.1`；profile `desktop`。
> **依据**：[composable-orchestration.md](composable-orchestration.md)（组合评估 v0.1）、[S1 组合 E2E](../reports/e2e-composition-relay-2026-11-12.md)、[v0.8.0 relay 开关 E2E](../reports/e2e-relay-switch-2026-11-12.md)、tree-engine SKILL/源码。
> **配套图解**：[composition-layers.html](composition-layers.html)（自包含可交互 HTML，6 个标签页）。
> **说明**：问答按原意压缩整理，保留事实依据；拿不准的平台机制保留 `UNKNOWN` 标注，不猜。代码/报告更新后以代码为准。

---

## 0. 一页速览

| 问题 | 结论 |
|---|---|
| 本项目的"树任务引擎"插件是哪个？ | `packages/dsh-tree-engine`（包名 `@local/dsh-tree-engine`，bundle id `tree-engine`，现 v0.8.0；9 个 `tree_*` 工具 + 随包 Skill） |
| 组合"层数"怎么数？ | 按**引擎嵌套次数**：tree→flow = 2 层引擎；不是会话父子层级 |
| 会话深度怎么变？ | 每嵌一层引擎，只在**调用内层引擎的那个会话**下面 **+1 层** |
| "管理者"是额外一层会话吗？ | **不是**。管理者 = 调用内层引擎的那个会话本身（它既是外层节点，又是内层父会话）；**引擎是插件/服务，不是会话，不占层** |
| root 会话是不是 commander？ | 职责上是"总指挥官"，账本角色是 **`root`**；它派发出去的下层会话才是 `commander` |
| commander 能否当 flow 管理者？ | **能**（S1 真机就是 commander 叶子当 flow 锚点）；比用 worker 当锚点**省一层** |
| commander 能否再挂 commander 继续拆树？ | 机制允许，但默认 `commander_max_depth=3` 下第二层 commander 已到末端，**不能再有子节点**；要更深需改配置（1–5） |
| commander 能否自己干活 / 起子会话校验？ | **能**。正式验收优先 `tree_verify`；需要独立审计节点可用 `auditor`；普通子会话可做临时交叉校验，但不在树账本内 |

---

## 1. 问答记录（按轮次）

### R1｜树任务引擎对应哪个插件？

**问**：本项目 dsh-tree-harness 的树任务引擎，体现在插件上是哪个？是 `dsh-tree-engine` 么？

**答**：是。三个层面确认：

| 层面 | 体现 |
|---|---|
| 源码/包 | `packages/dsh-tree-engine/`：宿主半 `index.js`（注册工具、装配 `tools`/`subagents`/`sessionQuery` 端口）+ 纯逻辑内核 `src/`（`engine.js` 任务树状态机、`guards.js` 预算/写面护栏、`verify.js` 验证、`store.js` 持久化、`doctor.js` 自检、`compat.js` 宿主 API 双形兼容） |
| Cordis bundle | `cordis.patch.yml` 的 `id: tree-engine`（+ `tree-engine-skills`）；profile 以 `link:` 装入；状态落 `<profile>/tree-engine-data/<tree_id>/tree-state.json` |
| 工具面 | 9 个 `tree_*`：`tree_plan / tree_node / tree_dispatch / tree_report / tree_status / tree_verify / tree_log / tree_maintain / tree_doctor` + 随包 Skill `tree-commander` / `tree-worker` |

易混淆项：
- `packages/dsh-session-tree`（`@orphiczhou/dsh-session-tree`）= **会话树 UI + 会话操作插件**（`tree_send`、`session_handoff`），不是任务引擎；
- `D:\Codes\tree-harness\tree-engine.cjs` = 旧 Prome 时代单文件引擎，仅作差分测试基线，不是当前运行插件；
- `@local/dsh-flow-engine`（自由流程，独立项目）= 另一个编排引擎，不要与 tree-engine 混为一谈。

> 工程纪律：`packages/` 在 profile 的 `hmr.root` 内；改宿主半文件后需对该 bundle 做 disable→enable（或重启 DSH）才加载新实现（D12）。

### R2｜红队报告后的结论：能否做、可行性、困难点、代价

**问**：红队报告之后的结论，简单说明能否做、可行性、困难点、代价。

**答**（一句话）：**方向能做，但别现在拆仓、别先建大内核；先花 4–6 人日做三件小事验证清楚，再谈大形态。**

| 设想 | 结论 |
|---|---|
| session-tree 与 tree-harness 拆成两个独立项目/插件 | **运行时已事实分开**（0 代码依赖、独立 bundle/link/状态域），但"拆仓=零运行时改动、约 3+6 人日"不成立：hmr.root 绝对目录、反转 D1、镜像仓非开发仓、发布门禁/工具链重做、npm 冻结使一半清单无交付对象 → **建议现在不拆**，挂触发器（npm 解冻 / 出现第二个独立消费方） |
| tree-harness 与 DSH 子智能体插件的关系 | **控制面 / 执行面**：平台=会话运行时+能力总线（不是编排引擎）；tree-engine=任务拓扑+治理+账本；session-tree=观察+通用会话操作 |
| 互相组合、递归嵌套、千变万化 | **软组合**（节点会话调另一引擎工具）可演示、**不可无人值守**；**结构化嵌套**当前不可行（无服务面/事件/cancel handle/executor 注册/强制点）；**递归旗舰用例**受 `maxDepth=4` 限制 |

**困难点（红队挖出）**：
1. 竹节是**定时器自主行为**（`sweepTick` 按宿主测量/自报判 42% 后 interrupt 换会话），会打断运行中的 flow —— 靠"约定不报 pct"无效，必须有 per-leaf relay 开关；
2. flow `activeRun` **单槽** → flow 套 flow 不安全；`callerOrigin=subagent` 时权限 ceiling 静默压到 `safe`；
3. 审批真实约束是"请求方会话 `turnOpen` + policy≠never"，不是"只能 root"；"root 代批"在 fire-and-forget 形态下不成立；存在**借用 root Agent 句柄**的越权面；
4. 平台无预算原语、无 durable 调用者身份、无会话标签/事件扩展；深度/并发是两套硬上限；
5. 契约"12 条不变量内核强制"**没有执行点**（平台唯一可插拔面 `subagents.registerProvider` 未被两引擎使用）；
6. 拆仓成本被低估（见上）。

**代价**：拆仓真实成本高于 3+6 人日（热更/门禁/工具链/D1 反转）；"契约内核"45–73 人日被红队判"贵而无用"；推荐最小路线 ≈4–6 人日：① 真机压测 relay；② tree 加 per-leaf relay 开关；③ 三个数据面小改（父子 run 引用、`flow_cancel`+多槽、结果 artifact 引用）；④ 一页组合约定；⑤ 拆仓/内核/统一 UI 不做。

> **状态更新（2026-11-12 晚）**：② 已在 tree-engine v0.8.0 实现并通过真机 E2E（`relay:'off'` 下 315s flow 跑满）；① 已执行（S1 E2E）；`usagePct` 服务获取已修但 `measure()` 契约仍不匹配；其余仍待推进。详见两份 E2E 报告。

### R3｜两个待决问题（A 递归目标 / B tree_send 安全面）

**问**：解说两个待决问题——A 递归目标两层还是三层；B `tree_send` 是否加调用者/谱系校验。

**答（A）**：
- **选项**：A1 两层验收（不改 `maxDepth`，推荐）｜A2 调大 `maxDepth` 上三层｜A3 两层进验收 + 三层只做专项试验。
- **建议 A1**：两层（tree→flow，或 flow→tree）已有真机证据（S1 + v0.8.0 relay 开关）；三层保守算术零余量（tree 2 层 + flow 1 层 = 第 4 层满，verify/judge/handoff 再起会话即超限）。调 `maxDepth` 不会解决审批问题（delegated child approval 钉 `never`；gate 依赖请求方 turnOpen）。
- **前置条件**：先重启 DSH 清 v0.7.0 sweep 僵尸；运行 flow 的 leaf 必须由 creator/root 设 `relay:'off'`（owner 自己设会被 `E_BORROWED_IDENTITY` 拒）；`E_RUN_EXISTS` / `validate` 假阳性列为已知残留。
- **UNKNOWN**：verify 的 judge 会话精确落在第 4 还是第 5 层取决于谁调用 `tree_verify`（judge 是调用者子会话），需真机矩阵；调大 `maxDepth` 的平台侧副作用未实测。
- **待拍板**：是否有真实三层业务；是否接受"两层+三层不承诺"；若坚持三层是否接受改 profile/重启/回滚；flow→tree 是否同时试点。

**答（B）**：
- **现状（FACT）**：`tree_send` 的 `parent` 可由模型入参指定（`session-tree/index.js:251`）；不传时回落到 target header 的 `parentSession`（`:262-269`）；随后 `subagents.prompt({parentSessionId, childSessionId, ...})` 按**父地址**授权（`:273-283`）。工具全局注册 → **任何能调 `tree_send` 的会话，只要知道 target 与真实父 id，就能向任意可续接会话注入 steer/queue 消息**。这是"无调用者校验的消息注入面"（§8.1）。
- **选项**：B1 只审计（0.5 人日）｜**B2 同谱系校验 + 审计（推荐，1–2 人日）**｜B3 引擎级白名单（重，违背会话树不绑引擎）｜B4 移除工具（破坏树内跨层通讯）。
- **建议 B2 轻量版**：caller 与 target 共享同一谱系根；显式 `parent` 必须等于真实父；fail-closed；加审计。保留树内跨层/兄弟投递。
- **UNKNOWN**：平台 `prompt()` 是否有额外调用者授权（代码只见按父地址 + principal 记录）；`deliverSubagentPrompt` 是否校验 parent-child 关系；是否存在正当跨树用法；`traceSession` 大 corpus 性能。
- **待拍板**：威胁模型（是否立刻 fail-closed）；是否允许同谱系限制；谱系无法判定时 fail-closed 还是放行+警告；是否同批修 `tree_node add` 字段白名单。

### R4｜"两层业务"是什么意思？举例

**答**：不是"会话父子两层"，而是**两个编排引擎各管一层、只嵌套一次**：外层引擎一次 run 里，某个节点整包交给内层引擎的一次完整 run。类似"项目经理用树状分解派活，其中某个活本身是一条标准流水线"。

例 1（tree→flow，已真机验证）：代码库模块化重构验收。外层 tree 按模块拆 leaf（可并行、有依赖、各自 DoD）；其中"billing 数据迁移校验"leaf 内跑一张固定 flow（冻结基线 → 迁移 → 抽样对账 → 回滚预案），顺序/门禁/失败恢复由 flow 引擎管。
例 2（flow→tree）：版本发布。外层 flow（构建 → 灰度 → 全量 → 回滚决策）；"灰度观察"节点会话被指定为 tree commander，现场按客户/区域拆 worker 并行检查、逐项验收、汇总 JSON 回给 flow。
例 3（三层，不建议进近期验收）：产品线交付 → 某 leaf 跑发布 flow → flow 的"灰度验证"节点内再建一棵树。当前深度零余量。

**两层验收具体验什么**：tree→flow 的 flow 完整 `succeeded`、结果回传 leaf、tree 正常收口（leaf `relay:'off'`）；不验三层、内层 gate、跨引擎预算/取消传播。

### R5｜叶子会话能否作为其下 flow 的管理者，直接驱动 +1 层流程会话？

**答**：**能，而且这是唯一形态**——引擎总把"调用它的那个会话"当父会话。
- tree leaf 调 `flow_run` → flow 节点会话 = leaf 的子会话（+1 层），**没有额外的"flow 管理者会话"**；leaf 是发包人/父会话/锚点，flow 引擎才是逐节点调度员。
- leaf **不能**逐节点干预：`flow_run` 前台阻塞等结果；flow 节点是一次性会话（不可续接、无消息通道）；中途只能等/信号取消。
- 反向 `flow 节点 → tree`：节点会话调 `tree_plan/tree_dispatch/harvest/verify`，tree worker = 节点子会话（+1）；节点是**真管理者**（自己派/收/验），受 600s/一次性/上下文限制；该方向真机未验证（UNKNOWN）。
- **深度账**：每嵌一层引擎只 +1；S1 实测 tree leaf→flow 节点 = depth 2。三层是否可行取决于**挂载点深度**（挂在浅 leaf 有余量；挂在深 leaf 零余量）。
- **前提**：管理者会话必须全程活着；运行时 leaf 必须 `relay:'off'`，禁 handoff；gate 仍不可用。

> 图解见 [composition-layers.html](composition-layers.html) 标签页 ②③。

### R6｜HTML 图解：到底几层、多画的是哪一层？

**答**：多出来的是**一个并不存在的"管理者会话"**。实际结构中管理者 = 调用内层引擎的那个会话本身，它直接当内层节点的父会话。图示对照：

```text
❌ 多画一层                     ✅ 实际
d0 根会话                      d0 根会话
d1 tree 叶子                   d1 tree 叶子 ★ 管理者
d2 "flow 管理者会话"(不存在)    d2 ├─ flow 节点会话
d3 flow 节点会话                   └─ flow 节点会话
```

HTML 有 6 个标签页：单层 tree / 单层 flow / 两层 tree→flow / 两层 flow→tree / 三层 / 多画一层对照；并标注"引擎是插件/服务，不是会话，不占层"。

### R7｜tree 的 commander 也可以作为 flow 的管理者吧？

**答**：**能，且 S1 真机就是这种情况**——`s1rl1` 里调用 `flow_run` 的叶子角色本身是 commander（`s1rl1-C1-relay`）；flow 节点挂在它下面 depth 2。
- 对 flow 引擎而言，commander/worker/root 都是会话，无区别；tree 角色只约束 `tree_*` 写面。
- **省一层**：commander(d1) 当锚点 → flow 节点 d2；若用 d2 的 worker 当锚点 → flow 节点 d3。所以"把 flow 挂在 commander 上比挂在 worker 上省一层"。
- **代价**：commander 被 `flow_run` 前台占住，运行期间不能 harvest/verify/派发自己的子树；作为锚点必须 `relay:'off'`，不能靠竹节换会话；建议让它"薄"（只发包+等结果），重活交给子树。
- 审计层的深度：`tree_verify` 的 judge 是**调用 verify 的会话**的子会话；flow 的 judge 节点与其它节点同级；深度预算按"锚点深度 + 引擎层 + 最深分支上每起一个会话的审计/交接"算；self-report/artifact/command 不起会话、不占层。

### R8｜用户让根会话启动树形任务时，根会话就是 commander 吗？

**答**：**职责上是"总指挥官"，账本角色是 `root`，不是 `commander`。**
- `tree_plan` 创建 root leaf `<tree_id>-root`，`role:"root"`；传 `session_id`（建议 `$env:DSH_SESSION_ID`）后 root leaf 的 owner = 根会话（不传则无 owner，信任锚/SET 权限退化）。
- root leaf **不能被 dispatch**（引擎拒绝）；**不参与竹节**；根会话拥有 creator/root authority（add 节点、set-relay/set-session、裁决收口）。
- 真正的 `commander` 是根会话 `tree_node add` 出来、再 `tree_dispatch` 派发出的子会话；被派发的 commander 不得再 `tree_plan`（避免建第二棵树/静默分裂）。
- 嵌套时同理：**谁调用 `tree_plan`，谁就是那棵内层树的"根会话"**（如 flow 节点会话），与原身份叠加、不额外占层。

### R9｜root 拆整棵树，还是 commander 继续拆？commander 能否下挂 commander、能否干活/起子会话校验？

**答**：
1. **拆树方式**：两种都支持；**推荐分层拆**——root 定顶层骨架（顶层 commander、依赖、DoD/taskType）并派发；被派发的 commander 不再 `tree_plan`，直接在自己的 leaf 下 `tree_node add` 子节点并继续拆。root 硬要预建整棵树/多级再派发，机制上可以（`tree_node add` 只要求 parent 非 worker、深度不超、caller==added_by），但不推荐；树支持执行中动态加节点/剪枝。
2. **commander 下挂 commander**：
   - 机制允许（只有 **worker 不能有子节点**；角色闭集 `commander / worker / auditor`）；
   - 但默认 `commander_max_depth=3`：`root(1) → C1(2) → C2(3)`，C2 已是末端，**不能再有子节点**（会 `E_DEPTH_EXCEEDED`），所以"继续拆树"到这一层就停；
   - 要真正多层拆，需改 `TREE_ENGINE_CONFIG.commander_max_depth`（允许 1–5）——同时注意 DSH 会话深度 `maxDepth=4`、预算（active leaf≤20 / 树会话≤50 / 宿主并发≤20）、SKILL 规范与命名/审计复杂度。
3. **commander 干活**：可以（它本身是 leaf，有 brief/DoD/`tree_report done`；角色只影响树权限与子节点规则）。同时等外部编排时先 `set-relay off`。
4. **对子树结果做校验的三条路**：

| 方式 | 是否进树账本 | 适用 |
|---|---|---|
| `tree_verify` 对子 leaf（推荐） | ✅ 写 `leaf.verification` | self-report / artifact / command / **llm-judge / adversarial**（后两者自动起 judge/攻击会话，挂在调用 verify 的会话下）；FAIL 不抛错，读 `result.pass` |
| 建 `auditor` leaf 并派发 | ✅ 是树节点 | 需要独立审计节点、留痕/依赖/DoD；占深度与预算，不做执行主力 |
| 普通子会话做临时交叉校验 | ❌ 不在树账本 | 一次性抽查；无 DoD/verify/预算记账，结论需自行写回 `tree_report`/产物 |

---

## 2. 图解索引

| 材料 | 说明 |
|---|---|
| [composition-layers.html](composition-layers.html) | 自包含交互式 HTML；标签页：① 单层 tree｜② 单层 flow｜③ 两层 tree→flow（★核心）｜④ 两层 flow→tree｜⑤ 三层（深度零余量）｜⑥ 多画一层对照（红/绿并排） |
| 关键更正 | 不存在的"flow 管理者会话"就是容易被多画出的那一层；实际管理者 = 调用内层引擎的会话本身 |

---

## 3. 关键口径与易错点

1. **引擎不是会话，不占层**：tree 引擎、flow 引擎都是插件/服务；只有它们派出的**节点会话**占会话深度。
2. **两种"层数"分开**：组合层数 = 引擎嵌套次数（tree→flow = 2）；会话深度 = 会话父子链长度（每嵌一层引擎 +1）。
3. **三套角色别混**：`root`（树创建者/所有者，不可派发、不参与竹节）｜`commander`（可拆/可派/可验收，也可自己干活）｜`worker`（只执行，不能有子节点；派发是 commander 职责）｜另外 `auditor`（审计节点，非主力）。
4. **两套深度上限**：tree 的 `commander_max_depth=3`（可配 1–5）是**任务树逻辑深度**；DSH 的 `maxDepth=4` 是**会话链深度**，两者独立，递归组合时容易先撞会话上限。
5. **两层典型**：tree 叶子/commander 当 flow 父会话（flow 节点 +1）；flow 节点当 tree commander（tree worker +1）。**都不要额外再加"管理者会话"。**
6. **审计/判断会话算深度**：只有会新起会话的验证（llm-judge/adversarial/handoff/再嵌引擎）才 +1；self-report/artifact/command 不占。
7. **组合运行前提**：运行 flow/长命令的 leaf 设 `relay:'off'`（creator/root 才能设）；运行期间禁 `session_handoff`；delegated child 的审批被钉 `never`，gate 只能在"发起 flow 且 turn 未结束"的会话；flow 节点一次性、不可续接、不可逐节点 steer。
8. **已知残留（引用报告，不重复展开）**：S1 `E_RUN_CANCELLED`；relay 后 successor `E_RUN_EXISTS`；`validate` 对已接力 leaf 假阳性；`usagePct.measure()` 契约不匹配（仍恒 null）；v0.7.0 sweep 僵尸需重启清除。

---

## 4. 待决事项（归档时点：2026-11-12）

| # | 事项 | 状态 | 详见 |
|---|---|---|---|
| A | 递归目标：近期只验收两层（不改 `maxDepth`），还是调大上三层 | **待用户拍板** | [composable-orchestration.md](composable-orchestration.md) §10-Q3；本文 §R3(A) |
| B | `tree_send` 安全面：是否先加调用者/谱系校验（会改变跨树消息用法） | **待用户拍板** | 评估 §8.1/§10-Q4；本文 §R3(B) |
| C | 拆仓 / 建契约内核：是否接受"现在不做、挂触发器" | 待用户确认 | 评估 §6/§10-Q5；[split-preparation.md](../guides/split-preparation.md) |
| D | 其他产品/工程残留：flow 套 flow 多槽、结果 artifact 引用、`E_RUN_EXISTS` 组合语义、usagePct 契约 | 待排期 | 评估 §7；两份 E2E 报告 |

---

## 5. 关联文档与证据

| 主题 | 文档 |
|---|---|
| 组合评估与设计（主文档） | [composable-orchestration.md](composable-orchestration.md) |
| 分层图解（HTML） | [composition-layers.html](composition-layers.html) |
| 专家取证报告集（E1–E4 + 红队） | [../reports/composition-research-2026-11-12/README.md](../reports/composition-research-2026-11-12/README.md) |
| S1 真机 E2E（relay 打断 flow） | [../reports/e2e-composition-relay-2026-11-12.md](../reports/e2e-composition-relay-2026-11-12.md) |
| v0.8.0 relay 开关 E2E | [../reports/e2e-relay-switch-2026-11-12.md](../reports/e2e-relay-switch-2026-11-12.md) |
| 拆分准备指南 | [../guides/split-preparation.md](../guides/split-preparation.md) |
| 树引擎规范 / 竹节机制 | [engine-spec.md](engine-spec.md)、[segment-handoff.md](segment-handoff.md) |
| 随包 Skill 正文 | `packages/dsh-tree-engine/skills/tree-commander/SKILL.md`、`.../tree-worker/SKILL.md` |

> 本文件为问答解说归档，新增链接均已按 docs/README 规范登记；如后续决策/实现变化，请更新本文件或新建报告，不要把新结论回写历史证据。
