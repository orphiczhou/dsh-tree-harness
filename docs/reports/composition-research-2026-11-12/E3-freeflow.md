# E3 · 自由流程引擎（DSH 动态流程引擎插件）只读分析

> **角色**：SOTA 专家团 E3（自由流程引擎分析员）
> **对象**：`D:\Codes\DSH动态流程引擎插件`（DSH 动态流程引擎，M1 阶段）
> **基线**：`main` @ `acae470`（2026-11-11 项目地图提交）；工作区 2 个未跟踪 HANDOFF 文件（非本次产生）
> **方法**：只读。读 `docs/README.md` → `HANDOFF-M1.md` → `docs/00` → 按关键词定位 `docs/04`、`docs/11`、代码与证据；未 git 写、未安装/重载插件、未运行任何 `flow_*`、未改目标项目任何文件。
> **标签**：`FACT`=源码/证据直接可见；`INFERENCE`=由事实推导（非项目自述）；`UNKNOWN`=未取证。
> **路径约定**：`F:` = `D:\Codes\DSH动态流程引擎插件\`；`T:` = `D:\Codes\dsh-tree-harness\`；`A:` = `D:\DSHarness\resources\app.asar\dsh\`。

---

## 0. 结论先行

| # | 问题 | 结论 | 标签 |
|---|---|---|---|
| 1 | 它是什么 | 两层：**纯 JS 确定性内核** `spike/flow-core`（零 `@deepseek-ai/*` import、零 npm 依赖）+ **Host-only Cordis bundle** `spike/dsh-flow-plugin`（4 个模型工具 + 会话执行器 + 只读面板）。流程=JSON DSL，节点=真实 DSH 子会话，逐事件 journal + 崩溃续跑。 | FACT |
| 2 | 节点模型 | 每个 `session` 节点 = **一次性前台子会话**：`startActivation({provider,label,delivery:'caller',signal,request:{prompt,parent,cwd,outputSchema,agentOptions}})` → `await activation.result` → `finally dispose()`。**无多轮、无续接、无消息通道**。 | FACT |
| 3 | 「一级子会话群」 | 所有节点会话的 `parent` 都是**发起 `flow_run` 的那个活 Agent**（`exec.agent`），因此节点会话是调用方的**同级平铺子代（depth+1）**，节点之间互不可见、互不发消息；一层流程只消耗 1 层 depth。 | FACT |
| 4 | 现有嵌套能力 | **M1 无 subflow、无递归、无节点内再编排**。节点类型是编译期闭集（9 种，`docs/04` 明确"M1 不允许自定义节点类型"）；`subflow` 仅在类型表里标 **M3**，代码中不存在。`loop` 也未实现（`E_NODE_UNSUPPORTED`）。 | FACT |
| 5 | 引擎级组合 | **今天没有可被外部引擎调用的接口**：无 Cordis Service、无事件面、无 run handle、无 cancel(runId)、无 executor 注册。唯一稳定公共底座 = DSH 会话原语（`startActivation`/`readSession`）。组合只能**模型/提示词层**（leaf 里调 `flow_run`，或 flow 节点里调 `tree_*`）或**同进程 import flow-core 库**（未打包、未承诺）。 | FACT/INFERENCE |
| 6 | 组合契约主缺口 | ①节点执行器抽象未对外开放；②journal 无 ownerSessionId（lineage 只在 sidecar 写、无人读）；③无按 runId 取消（只有调用方 `exec.signal`，且 CANCELLED 不可 resume）；④预算不跨引擎记账、宿主并发上限未接入；⑤工具结果被截断（节点 600 字符 / outputs 4000 字符），机器消费只能读 journal；⑥无 UI/事件嵌入契约。 | FACT |
| 7 | 可直接复用 | ①`flow_*` 四工具的入参/错误码/快照契约；②journal（sha256 链 + `verifyJournal` + owner.lock）与四级输出抽取；③`createEngine({executor})` + `SessionExecutor` 契约（内核可直接被同进程编排器当"确定性 DAG 子引擎"）；④项目已有一份对 tree-harness 的四种组合方案论证（证据充分，可作组织形态设计的输入）。 | FACT |

**一句话**：它是一个**"会话即节点"的确定性单层 DAG 执行器**——内核质量与审计面很强，但它是"被模型调用的工具"，不是"可被别的编排器调用的服务"；要做递归嵌套的组织形态，**必须先补服务化 + lineage + 取消/预算传播**，否则只能做提示词层的软组合。

---

## 1. 事实基线（版本/仓库/测试/安装）

| 项 | 值 | 证据 | 标签 |
|---|---|---|---|
| 仓库 | `D:\Codes\DSH动态流程引擎插件`，分支 `main`，HEAD `acae470` | `git log --oneline -1` | FACT |
| 标签 | `req-v1.4` / `prd-v1.3` / `arch-v2.2` / `m1-plan-v1.5` / `m1-start`；**无 `m1-done`** | `git tag` | FACT |
| M1 收口 | **未收口**：R-m1-05c（真人 approve）、T11 A37 强杀、T13 定稿、T14 tag 未完成 | `docs/11-M1实施计划.md:524-530`；`HANDOFF-M1.md:8-10` | FACT |
| 内核测试 | `267/267 pass, fail 0, skipped 0`（floor 267） | `spike/flow-core/test/baseline-manifest.json:11`；`evidence/m1/T14/qa-gate-verify-after-manifest-2026-11-11.txt`（RESULT: PASS） | FACT |
| 插件测试 | `114/114 pass`（floor 114） | 同上 `:41` | FACT |
| 门禁 | `tools/qa-gate.mjs` PASS / 0 warnings | 同上证据文件尾部 | FACT |
| 宿主 | 项目文档基线 `DSH 0.2.2-rc.1`、desktop profile；当前运行版未由本报告复核 | `spike/dsh-flow-plugin/README.md:3` | FACT（文档）/ UNKNOWN（当前宿主版本） |
| 安装形态 | profile `link:` 安装为 bundle：`@local/dsh-flow-engine` → `spike/dsh-flow-plugin`；与 `@local/dsh-tree-engine`、`@orphiczhou/dsh-session-tree` **同 profile 共存** | `C:\Users\sir_c\.dsh\profiles\desktop\package.json`（dependencies / dsh.profile.bundles） | FACT |
| 运行配置 | profile 里 flow 行：`engine: flow-core`、`nodeTimeoutMs 600000`、`maxNodes 32`、`maxRunMs 1800000`、`storageDir: D:/Codes/DSH动态流程引擎插件/.dsh-flow` | 同 profile `cordis.patch.yml:272-280` | FACT |
| 宿主容量 | 同 profile：`maxDepth: 4`、`maxActiveSubagents: 20`（**注意：项目证据文档多处写 maxDepth=3，已漂移**） | 同 profile `:223-227`；对照 `docs/00-执行摘要.md:36`、`evidence/m1/tree-harness/INTEGRATION-DESIGN.md:328` | FACT |
| 代码规模 | `flow-core/src/engine.js` 161 KB、`schema.js` 64 KB；插件 `lib/tools.js` 55 KB、`index.js` 36 KB、`client.js` 68 KB | 文件字节数 | FACT |

---

## 2. 架构总览

### 2.1 分层与模块

```
flow_run / flow_status / flow_resume / flow_list          ← 模型可见工具（全局注册，无 toolFilter）
  └─ dsh-flow-plugin（Host bundle，零 @deepseek-ai/* import）
       ├─ lib/session-executor.js   SessionExecutor → ctx.subagents.startActivation（唯一"节点=会话"实现）
       ├─ lib/core-adapter.js       引擎选择/加载/新鲜度（相对路径 import flow-core，sha256 审计）
       ├─ lib/tools.js              工具面 + 存储根 + 权限/来源 + 锚点 + 结果渲染
       ├─ lib/storage-path.js       .dsh-flow 根解析 + B1 路径围栏
       ├─ lib/anchor-store.js       storageDomain 最小外部锚点（可降级）
       ├─ lib/approval-port.js      ctx.approval 适配（human_gate 裁决通道）
       ├─ lib/panel-view.js / client.js  只读面板（3 条 GET + 右侧栏 slot）
       └─ lib/engine-builtin.js     诊断兜底引擎（非交付路径）
  └─ spike/flow-core（纯 ESM，零 DSH import，可离线测试）
       ├─ index.js        compile / fold / createEngine / verifyJournal / adaptLegacyFlow
       ├─ src/engine.js   FlowEngine：调度/门禁/重试/超时/取消/adopt/gate/resume
       ├─ src/schema.js   DSL 编译期校验 + JSON Schema 子集
       ├─ src/scheduler.js 稳定拓扑序 / 环检测 / 就绪-跳过
       ├─ src/journal.js append-only JSONL + sha256 链 + fold + owner.lock
       ├─ src/executors.js SessionExecutor 契约 + Bridge/Judge/Fake/Demo
       └─ src/{extract,gates,permissions,native-schema,graph-patch,template,expr,events,clock,util,errors}.js
```

- 架构红线有测试守护：`src/` 零 `@deepseek-ai/*`、时间只经注入 clock、无 `eval/new Function`、不读 `process.env`（`F:spike/flow-core/test/architecture.test.js:40-77`）。**FACT**
- 模块依赖方向：`engine → scheduler → (expr|schema) → util/errors`；`journal` 只依赖 `util/errors`（`F:spike/flow-core/README.md:76-77`）。**FACT**

### 2.2 流程 DSL 形状

两种形状，同一内核（`adaptLegacyFlow` 翻译）：

| 形状 | 来源 | 关键字段 | 证据 |
|---|---|---|---|
| 文档形（legacy） | `docs/04` / PRD 口径 | `id/vars/outputs/defaults/limits/nodes[{id,type,label,input{prompt,agentOptions,timeoutMs},output{var,schema,extract},retry}],edges[{from,to,when?}]` | `F:spike/dsh-flow-plugin/README.md:99-127`；`F:spike/flow-core/index.js:384-528` |
| 内核形（native） | flow-core 原生 | `variables/budgets/defaults/nodes[{id,type,config{executor,prompt,timeoutMs,retry,onError,requireVars,outputSchema},io{inputs,outputs,setVariables}}],edges` | `F:spike/flow-core/README.md:79-118` |

- 引用语法 `@vars.x / @nodes.<id>.output / @nodes.<id>.outputs.<k> / @result / @input / @flow.var`；算子闭集纯函数，**无 eval**（`F:spike/flow-core/README.md:120-127`）。**FACT**
- 编译期一次列全 violations（`E_DSL_INVALID` + `violations[]`）：环/悬挂边/不可达/端点/变量/join 入度/预算/schema 白名单（`F:spike/flow-core/index.js:301-340`；`F:docs/04-架构设计.md:790-808`）。**FACT**
- **节点类型是闭集**：`start/session/code/condition/join/end/judge/human_gate/loop`（`F:spike/flow-core/src/schema.js:36-50`）。`docs/04` 明确"M1 不允许自定义节点类型（否则硬约束失效）"（`F:docs/04-架构设计.md:624`）。**FACT**
- `condition` 在文档里被描述为"编译期语法糖"，代码里是**真实原生节点**（`F:spike/flow-core/src/engine.js:98`、`:1537-1568`）→ 文档/实现漂移，不影响对外契约。**FACT（漂移）**
- L2 运行时扩图只保**契约**：`graphPatch` 数据结构 + 校验存在，执行入口一律 `E_L2_NOT_IMPLEMENTED`（`F:spike/flow-core/src/graph-patch.js:15,113-116`；D13）。**FACT**

### 2.3 引擎状态机

| 维度 | 值 | 证据 |
|---|---|---|
| run 终态 | `succeeded \| failed \| completed_with_errors \| cancelled`；`suspended` 为**非终态**（等待 gate） | `F:spike/flow-core/src/engine.js:82-92` |
| run 中间态 | `running`；崩溃重放合成 `interrupted`（不落盘）；读侧无 `run/ended` 且无 pending gate → running/interrupted | `F:spike/flow-core/index.js:723-727` |
| 节点态 | `pending/running/succeeded/failed/skipped/interrupted/waiting`（waiting 为 gate 扩展） | `F:spike/flow-core/src/journal.js:1197-1214`；`F:spike/flow-core/src/engine.js:1921` |
| 边态 | `pending/taken/not_taken`（`edge/selected` 落账） | `F:spike/flow-core/README.md:146-152` |
| 终态约束 | 非全部节点终态不得 `succeeded`；停滞 → `E_SCHEDULER_STALL`（G9） | `F:spike/flow-core/README.md:280` |
| 取消 | 外部 `signal` → run `cancelled`；**CANCELLED 不得 resume 复活** | `F:spike/flow-core/src/engine.js:2900-2905,3036,3119-3121` |

### 2.4 调度、并发与失败语义

| 项 | 实现 | 证据 | 标签 |
|---|---|---|---|
| 拓扑序 | Kahn；tie-break = 定义顺序 + id 字典序（确定性单测锁定） | `F:spike/flow-core/src/scheduler.js`；`README.md:272-280` | FACT |
| 真并发 | M1 已实现 `_executeConcurrent`：有效并发 = `max(1, min(DSL, 部署上限 3, 宿主上限−余量))`；超限**编译期/运行期 fail-closed 不静默钳** | `F:spike/flow-core/src/engine.js:562-589,2210-2265` | FACT |
| 批提交 | settleBuffer 按逻辑序 `(rank,nodeId)` 批提交，保证 fold 可复现 | `F:spike/flow-core/src/engine.js:2322-2382`；ADR-010 `F:docs/04:292-313` | FACT |
| 分支/汇合 | 普通节点多入边=OR；`join`=all-only（`mode:"any"` 编译拒） | `F:spike/flow-core/README.md:146-152` | FACT |
| 失败策略 | `stop`（缺省）/ `continue-null`；`retry.max` + 上游 `retryable:false` | `F:spike/flow-core/README.md:360-363`；`F:spike/flow-core/src/engine.js:104-127` | FACT |
| 背压 | `ACTIVATION_LIMIT_REACHED` 不计失败，250–5000ms ×5 退避 | `F:spike/flow-core/src/engine.js:129-134` | FACT |
| 墙钟 | run 级定时器 → abort 在跑节点 → `E_GATE_BUDGET_DURATION` | `F:spike/flow-core/src/engine.js:2962,3040-3042` | FACT |

### 2.5 节点执行器与 IO 契约（内核侧）

```ts
executor.run({
  node, input, signal, budget, runId, attempt,
  ctx: { onSpawned(sessionId), journal, events, clock, variables, nodeViews, resolve, executorContext }
}) → { output?, structured?, sessionId?, stopReason?, meta?, error?{code,message,retryable?} }
executor.adopt?({ node, sessionId, attempt, input, ctx }) → {sessionId, output, stopReason:'completed'} | null
executor.dispose?(nodeId, attempt)
```

- 契约与 docs/04 的 `NodeExecutor{validate,start→NodeHandle,adopt}` 的映射见 `F:spike/flow-core/README.md:186-198`（实现采用更简单的 `run()`，无长驻 handle；取消经 `signal`，释放由执行器 finally 负责）。**FACT**
- `stopReason` 采用 DSH 词汇：`completed` 成功；`cancelled/timeout` 分别映射 `E_NODE_CANCELLED/E_NODE_TIMEOUT`；其余失败（`F:spike/flow-core/src/engine.js:1476-1490`）。**FACT**
- 输出抽取四级阶梯（structured → ```json 围栏 → `FLOW_RESULT:` → 显式 text）单一实现，失败 `E_OUTPUT_INVALID{stage,reason}`、超限 `E_OUTPUT_TOO_LARGE`（不截断）（`F:spike/flow-core/src/extract.js`；`F:spike/flow-core/src/engine.js:1491-1521`）。**FACT**
- `judge` 是 `session` 的受控特化：引擎合成闭集 schema（choice/rationale/confidence），`onInvalid∈{fallback,retry-once,fail}`，只写 fallbackVar，不写状态（`F:spike/flow-core/src/executors.js:399-560`；`F:spike/flow-core/src/schema.js:277-341`）。**FACT**
- DSH 侧 `outputSchema` 只接受受限子集（`type/oneOf/properties/required/additionalProperties/items/enum/const` + 注解）；非白名单 keyword 在**工具层与内核编译期**双重拦截（`F:spike/dsh-flow-plugin/lib/tools.js:61-83`；`F:spike/flow-core/src/native-schema.js`）。**FACT**

### 2.6 门禁、权限与人工门禁

| 门禁 | 行为 | 证据 |
|---|---|---|
| G1 编译期 | DSL/schema/预算/类型/引用一次列全 | `F:docs/04-架构设计.md:790-808` |
| G4 输出 schema | 节点输出不符 → 节点失败 → 重试/失败策略 | `F:spike/flow-core/src/engine.js`（`_resolveOutputs` 1218-1241） |
| HB-7 硬帽 | `maxNodes≤32 / maxWallClockMs≤1.8e6 / nodeTimeoutMs≤6e5 / maxRetriesTotal≤16 / maxConcurrency≤3`，超帽**编译期拒绝** | `F:spike/flow-core/src/schema.js:58-72` |
| permTier | 两档 `safe/relaxed`；`effectiveTier = min(callerTier, declaredTier)` 在 `run/created` **取锁前冻结**；运行期只读（HB-4） | `F:spike/flow-core/src/permissions.js`；`F:spike/flow-core/src/engine.js:2884-2896,3006-3007` |
| callerOrigin | 工具层从 `exec.agent.session.header` 解析 `user/subagent/unknown(+supervisor)`；未命中父 run 的 subagent **保守 safe**；supervisor 拒建 run | `F:spike/dsh-flow-plugin/lib/tools.js:148-185,661-670` |
| human_gate | `RUNNING → gate/opened → SUSPENDED →(flow_resume{gate})→ RUNNING`；approval 不可用即 fail-closed（`E_APPROVAL_UNAVAILABLE`），**绝不调用方自批**（HB-5） | `F:spike/flow-core/src/engine.js:599-626,943-1077`；`F:spike/dsh-flow-plugin/lib/approval-port.js` |
| gate 恢复 | `approvalRef` 只认本进程 approval 端口 mint 过的（跨进程/重启 fail-closed，M1 残留） | `F:spike/flow-core/src/engine.js:3191-3206`；`F:docs/11-M1实施计划.md:520` |

### 2.7 Journal、崩溃续跑与锚点

| 项 | 实现 | 证据 |
|---|---|---|
| 位置 | `<storageRoot>/runs/<runId>.jsonl`（根 = `<runCwd>/.dsh-flow`，`runCwd` 只由宿主解析） | `F:spike/dsh-flow-plugin/lib/storage-path.js:136-233`；`F:docs/08-需求说明.md:324` |
| 格式 | `{v,seq,ts,run,event,payloadHash,prevHash,hash[,order]}`，每行 write+fsync | `F:spike/flow-core/src/journal.js:1-30,309-341` |
| 事件闭集 | `run/created,started,resumed,ended`；`var/init,set`；`node/start,spawned,adopted,adopt-skipped,settled,retry`；`edge/selected`；`expr/error`；`budget/exceeded`；`gate/opened,decided,cancelled`；`perm/tier-resolved,fallback,denied`；预留 `supervisor/action,graph/patched` | `F:spike/flow-core/src/journal.js:48-78` |
| 双序 v2 | `order{epoch,rank,nodeId,attempt,cls,sub}`：逻辑序 vs 完成序分离，两段式 replay | `F:spike/flow-core/src/journal.js:965+`；ADR-010 |
| 单写者 | `owner.lock`（`wx` + pid 存活探测 + stale 接管；拒 symlink） | `F:spike/flow-core/src/journal.js:603-644` |
| resume | 已完成节点不重跑；interrupted 有 sessionId → 优先 `adopt`（不重发 prompt），否则 attempt+1 重跑 | `F:spike/flow-core/src/engine.js:3065-3080,1719-1840`；`F:spike/dsh-flow-plugin/lib/session-executor.js:316-381` |
| at-least-once | 崩溃瞬间在跑的节点可能执行两次；adopt 是唯一"恰好一次"手段 | `F:spike/flow-core/README.md:257-270` |
| 外部锚点 | 可选 `storageDomain` domain `flow_anchor`：`create/finalize/read` 交叉校验；服务缺失=可见降级（integrity 恒 unverified） | `F:spike/dsh-flow-plugin/lib/anchor-store.js`；`F:docs/04-架构设计.md:538-` |
| 读路径 | `flow_status/list/resume` 先 hash 链 + 单 `run/created` + 锚点校验；失败 `corrupted` 且**不渲染 output** | `F:spike/dsh-flow-plugin/lib/tools.js:465-597` |

### 2.8 与 DSH 内置 `workflowEngine` 的关系

- **不占用该缝**：`ctx.workflowEngine` 已被 `dsh-workflow-ptc` 占用（一个 context 只能一个 engine）；本项目另立 `flow_*` 工具面（ADR-001，`F:docs/04-架构设计.md:172-181`）。**FACT**
- 内置 `workflow` 的语义是"模型现写 JS 脚本 fan-out 子代理"，明示无 journaling/resume、无保存/嵌套工作流、仅前台（`F:docs/00-执行摘要.md:11,40`）。**FACT（引用官方 README）**
- M1 交付形态 = **工具面 + `createEngine` 工厂**；`ctx.flowEngine` Service 是 **M2 计划**，文档已如实标注 service-less（`F:docs/04-架构设计.md:1602-1622`）。**FACT**

---

## 3. 节点模型（重点章节）

### 3.1 「节点 = 会话」的实际实现（step-by-step）

| 步 | 动作 | 证据 | 标签 |
|---|---|---|---|
| 1 | 工具层取活父 Agent：`exec.agent`（缺失抛 `E_SESSION_UNAVAILABLE`） | `F:spike/dsh-flow-plugin/lib/tools.js:1100-1103` | FACT |
| 2 | 引擎 `_invokeExecutor` 建**节点级 AbortController**（超时/取消仲裁），渲染模板，调执行器 | `F:spike/flow-core/src/engine.js:1295-1396` | FACT |
| 3 | 执行器调 `ctx.subagents.startActivation({provider:'spawn', label:'flow:<run>/<node>#<attempt>', delivery:'caller', signal, request:{prompt:[{type:'text',text}], parent, cwd?, outputSchema?, agentOptions?}})` | `F:spike/dsh-flow-plugin/lib/session-executor.js:236-266` | FACT |
| 4 | 拿到 `childId` 立即 `onSpawn` → journal `node/spawned{sessionId}`（adopt 锚点 + 权限索引 + UI 链接） | `F:spike/flow-core/src/engine.js:1353-1372`；`F:spike/dsh-flow-plugin/lib/session-executor.js:272-279` | FACT |
| 5 | `await activation.result`（被调用方 signal 包裹），`stopReason!=='completed'` → 节点失败 | `F:spike/dsh-flow-plugin/lib/session-executor.js:291-300` | FACT |
| 6 | 输出归一：`result.output` 若是 content blocks 数组，**只拼 text 块**（剔除 reasoning/工具块）；空 → NO_OUTPUT | `F:spike/dsh-flow-plugin/lib/session-executor.js:158-178` | FACT |
| 7 | `finally dispose()`（幂等）；超时/取消由引擎再补一次 `executor.dispose` | `F:spike/dsh-flow-plugin/lib/session-executor.js:280-312`；`F:spike/flow-core/src/engine.js:1426-1432` | FACT |
| 8 | 引擎侧抽取 → fullSchema 校验 → 写变量/端口 → `node/settled` → 选边 → 推进 | `F:spike/flow-core/src/engine.js:1953-2137,1218-1270` | FACT |

**要点**：节点会话是**一次 attempt = 一次 activation**；引擎从不持有长驻 handle，也**不能** `sendMessage`/`interrupt` 某个节点会话（引擎不是 Agent）。**FACT**（`F:spike/dsh-flow-plugin/README.md:238`）

- 带 `outputSchema` 时宿主把终态绑定在 `structured_output` 工具调用上（纯文本 → `stopReason=error`），插件用提示词尾注缓解（`F:spike/dsh-flow-plugin/lib/session-executor.js:52-54`；T10-fix `3c3d2e7`）。**FACT**
- 节点会话**会登记到父会话的 subagent catalog**（`delivery:'caller'` 不改变登记；QA 真机实测 4 条 catalog fact）→ 在 UI 子代理面板可观测（`F:docs/00-执行摘要.md:33-36`；`F:spike/dsh-flow-plugin/README.md:233-237`）。**FACT**

### 3.2 「一级子会话群」约束是什么

| 维度 | 事实 | 证据 | 标签 |
|---|---|---|---|
| 父级 | 所有节点会话的 `parent` = **调用 `flow_run` 的那个 Agent**；不是上一个节点，也不是引擎自建 root | `F:spike/flow-core/src/executors.js:325-335`（`parentAgent: runtime.parentAgent`） | FACT |
| 层级 | 因此同一次 run 的所有节点会话是**同一层（调用方 depth+1）的平铺集合**；节点之间无父子关系 | 同上 + `F:spike/flow-core/README.md:199-206` | FACT |
| 边 | 节点间数据只经**变量池/端口/模板**流动，**不靠会话互发消息** | `F:docs/00-执行摘要.md:22`；`F:spike/flow-core/README.md:106-110` | FACT |
| 取消 | 节点级 AbortController 由引擎仲裁；run 取消时传播到在跑节点并 dispose | `F:spike/flow-core/src/engine.js:1320-1333,1426-1432` | FACT |
| 深度占用 | 一层 flow 只消耗 **1 层**会话 depth（节点不再派生，除非节点内部自己调工具/起子会话） | `F:docs/04-架构设计.md:221`（C2） | FACT |
| 容量 | 节点会话占宿主 `maxActiveSubagents` 名额；并发受三层 min 限制（≤3） | `F:spike/flow-core/src/engine.js:562-589` | FACT |

> **推论**：所谓"一级子会话群"= **一个调用方会话 + 一层平铺节点会话**。这既是它的简单性来源，也是它**不能直接承载多层组织形态**的结构原因：任何"节点里再有一个团队/流程"都必须由该节点会话自己去调工具（模型层），无法由引擎结构化表达。**INFERENCE**

### 3.3 嵌套 / 子流程 / 递归：现状（逐项证据）

| 问题 | 结论 | 证据 | 标签 |
|---|---|---|---|
| DSL 有 `subflow` 节点吗 | **没有**。类型表里 `subflow` 标 M3，代码 `NODE_TYPES` 不含 | `F:docs/04-架构设计.md:619`；`F:spike/flow-core/src/schema.js:36-50`；全仓 grep `subflow` 仅文档/证据命中 | FACT |
| 支持递归流程吗 | **不支持**，且文档明确"内联展开，不支持递归（M3）" | `F:docs/04-架构设计.md:619` | FACT |
| 节点里能再跑一个 flow 吗 | 代码层面**没有禁止**（子会话若拿到 `flow_*` 工具即可调），但：①未设计/未文档化；②`callerOrigin=subagent` → tier 被压回 safe、`human_gate` 必失败；③深度每层 +1；④存储根按节点会话 cwd 推导，可能落到另一个 `.dsh-flow` | `F:spike/dsh-flow-plugin/lib/tools.js:161-185,653-670`；`F:docs/04-架构设计.md:221`；`F:docs/reviews/R2c-安全增量复审.md` F-02 | FACT（可行性）/ UNKNOWN（真机未验） |
| 自定义节点类型 | **禁止**（M1 设计决定） | `F:docs/04-架构设计.md:624`；`F:spike/flow-core/src/schema.js:36-50` | FACT |
| 自定义执行器（按 `config.executor` 名） | 内核 `_resolveExecutor` **支持按名取注册表**，但 `createEngine` 只注入 `{default,session,judge}` 三个，未暴露注册入口；未知名 → `E_NODE_EXECUTOR_MISSING` | `F:spike/flow-core/src/engine.js:1271-1280,813-818`；`F:spike/flow-core/index.js:783-818` | FACT |
| 深度预算检查 | **无显式检查**；靠宿主 `SubagentDepthError` → 执行器映射 `E_SESSION_START_FAILED` | `F:spike/dsh-flow-plugin/lib/session-executor.js:267-270`；`F:docs/04-架构设计.md:221` 要求 fail-closed（M1 不做嵌套故未实现） | FACT |
| profile 当前 maxDepth | **4**（证据文档写 3，已漂移）→ 理论可容纳 root→flow 节点→树 leaf→树 worker | profile `cordis.patch.yml:226`；对照 `F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md:328,345-352` | FACT |

### 3.4 有没有「引擎无关的执行器接口」

**有，但它是对内核的，不是对外部编排器的。**

| 层次 | 形态 | 对外可用性 | 证据 | 标签 |
|---|---|---|---|---|
| 执行器契约 | `SessionExecutor.run(nodeSpec, input, scope)` + 可选 `adopt/dispose`；`scope={parentAgent,cwd,signal,runId,attempt,label,onSpawn}` | 文档化（flow-core README §5/§9、插件 README §6） | `F:spike/flow-core/README.md:154-206`；`F:spike/dsh-flow-plugin/README.md:141-165` | FACT |
| 桥接适配 | `createBridgeExecutor`：模板渲染 + nativeSchema/agentOptions 注入 + `onSpawn` 透传 | 内核内部 | `F:spike/flow-core/src/executors.js:286-351` | FACT |
| 引擎工厂 | `createEngine({executor, config, log}) → {kind, run, resume, status, list}`，**只接受一个 executor**（映射为 default+session） | 公开导出（flow-core/index.js） | `F:spike/flow-core/index.js:783-818,837-1057` | FACT |
| 执行器注册表 | `new FlowEngine({executors:{...}})` 可按类型/名注册 | 类公开导出，但**不在 `createEngine` 契约内**、未文档化 | `F:spike/flow-core/src/engine.js:240-275,1271-1280` | FACT |
| 事件面 | `FlowEngine.on/onAny`（EventBus） | `createEngine` 返回对象**不含 `on`** → 工厂路径拿不到事件 | `F:spike/flow-core/src/engine.js:277-290,837-1057` | FACT |
| 服务面 | `ctx.flowEngine` Service（start/resume/list/on + handle{cancel,dispose}） | **M2 计划，未实现** | `F:docs/04-架构设计.md:1602-1622` | FACT |

> 结论：**"引擎无关"只到 executor 这一层**——换执行器可以换掉"节点怎么跑"，但换不掉"节点能是什么"（类型闭集）、"谁来调用引擎"（只有工具或同进程 import）。**INFERENCE**

### 3.5 会话生命周期、多轮与"监督会话"

| 能力 | 状态 | 证据 | 标签 |
|---|---|---|---|
| 节点内多轮（sendMessage 续接） | **未实现**："引擎不是 Agent，不能作消息 sender；每节点=一次性子会话" | `F:spike/dsh-flow-plugin/README.md:238` | FACT |
| 节点崩溃认领 adopt | 已实现（readSession → 末条 turn/end completed → 末条 assistant text → 24h 窗） | `F:spike/dsh-flow-plugin/lib/session-executor.js:316-381` | FACT |
| supervisor（监督会话） | **未实现**：仅保留 `supervisor` 权限类型/事件位，M2 实跑 | `F:docs/04-架构设计.md:618,167`（ADR-008）；`F:spike/flow-core/src/permissions.js:35,188-192` | FACT |
| loop 节点 | **未实现**（硬上限已落地，执行 `E_NODE_UNSUPPORTED`） | `F:spike/flow-core/src/schema.js:86-89,886-895`；`F:spike/flow-core/src/engine.js:101` | FACT |
| 后台 run | **未实现**：`flow_run` 在工具调用内前台跑完；`ctx.jobs` 仅探测回显 | `F:spike/dsh-flow-plugin/README.md:20-21`；`F:spike/dsh-flow-plugin/index.js:685` | FACT |

---

## 4. 依赖与耦合

### 4.1 依赖的 DSH 原语（按必需性）

| 服务 | 必需？ | 用途 | 缺失行为 | 证据 |
|---|---|---|---|---|
| `tools` | ✅ | 注册 4 个工具 | 一个工具都不注册（fail-closed） | `F:spike/dsh-flow-plugin/index.js:47,656-663` |
| `subagents` | ✅ | `startActivation` 起节点会话 | 同上 | 同上；`lib/session-executor.js:216-225` |
| `agents` / `sessionQuery` | ✅（装载期检查） | `agents` 是 subagents 依赖；`sessionQuery.readSession` 供 adopt | 同上；缺 `readSession` → 只降级 adopt（可见告警） | `F:spike/dsh-flow-plugin/index.js:658-682` |
| `workingDirectory` | ⚪ 可选 | 解析 runCwd（存储根） | 退回 `exec.cwd` | `F:spike/dsh-flow-plugin/lib/tools.js:244-261` |
| `storageDomain` | ⚪ 可选 | 外部锚点（ADR-018） | integrity 恒 unverified（降级可见，不拒 run） | `F:spike/dsh-flow-plugin/index.js:690-708` |
| `approval` | ⚪ 可选 | human_gate 裁决通道 | `E_APPROVAL_UNAVAILABLE`（fail-closed，不自批） | `F:spike/dsh-flow-plugin/index.js:709-726` |
| `webServer` | ⚪ 可选 | 只读面板 3 条 GET | 面板降级，工具面不受影响 | `F:spike/dsh-flow-plugin/index.js:586-624` |
| `hmr` | ⚪ 可选 | 清 flow-core 模块缓存 | 退回 `?v=` 时间戳 | `F:spike/dsh-flow-plugin/lib/core-adapter.js:93-121` |
| `jobs` / `timer` | ❌ 未使用 | 仅在 `flow_status.ports` 回显布尔 | — | `F:spike/dsh-flow-plugin/index.js:684-689` |

### 4.2 是否依赖 tree-engine / session-tree / tree_send / session_handoff / client UI

| 对象 | 结论 | 证据 | 标签 |
|---|---|---|---|
| `dsh-tree-engine` | **不依赖**（无 import、无 inject、无工具调用） | 插件 `index.js`/`lib/*.js` 的 import 全集只有 node 内置 + 相对文件；`inject` 不含 tree | FACT |
| `dsh-session-tree`（`session_handoff`） | **不依赖** | 同上；全仓 grep 无该工具名（仅文档提及） | FACT |
| `tree_send` | **不依赖**，flow 也没有等价能力（跨会话发消息） | 同上 | FACT |
| client UI | **可选**：`client.js` 用 `slots` + `sidebarRight` 注册右侧栏页面；无 UI 也能跑（工具面/引擎独立） | `F:spike/dsh-flow-plugin/client.js:1-20,1739-1780`；`F:spike/dsh-flow-plugin/index.js:586-624` | FACT |
| 宿主内置 `workflowEngine` | **不占用、不依赖**（ADR-001） | `F:docs/04-架构设计.md:172-181` | FACT |
| 外部 npm | **零**（`flow-core` 只用 node 内置；插件同样零 `@deepseek-ai/*`） | `F:spike/flow-core/package.json`；`F:spike/flow-core/test/architecture.test.js:40-49` | FACT |

> 注意：**"不依赖"≠"不能共存"**。三个插件（flow / tree / session-tree）在同一 profile 里都装了（`package.json` bundles），互调只能经 DSH 会话原语或模型工具。**FACT**

### 4.3 profile 安装与 bundle patch 机制

| 机制 | 事实 | 证据 | 标签 |
|---|---|---|---|
| 安装 | `plugin_manager install_bundle` → profile 依赖 `@local/dsh-flow-engine: link:<bundle 目录>`；HMR 生效，无需重启 GUI | `F:spike/dsh-flow-plugin/README.md:176-193` | FACT |
| bundle patch | 插件自带 `cordis.patch.yml` `insert` 一行 `id: dsh-flow-engine`（含默认 config）；profile 另有同名 `id` 的 config 块（部署覆盖） | `F:spike/dsh-flow-plugin/cordis.patch.yml`；profile `:272-280` | FACT（两层存在）/ UNKNOWN（深合并 vs 整体替换语义未取证） |
| 重载 | 同版本重装返回 `already-installed` → 必须 remove + install；或 disable→enable | `F:spike/dsh-flow-plugin/README.md:191-193` | FACT |
| 打包耦合 | 内核靠**相对路径** `../../flow-core/` 加载；ADR-017 的 vendoring（`scripts/vendor-core.mjs`/`vendor/`）**未实施** → 换目录/独立安装会断 | `F:spike/dsh-flow-plugin/lib/core-adapter.js:39-45`；`F:docs/11-M1实施计划.md:494`；`HANDOFF-M1.md:187-188` | FACT |
| 负载痕迹 | 每次 run 另写 `<runId>.adapter.json`（引擎/内核 sha256/callerSessionId/cwd），工具不读它 | `F:spike/dsh-flow-plugin/lib/tools.js:196-227,794-801` | FACT |

---

## 5. 组合能力现状

> 本节回答两个方向：**flow 作为别人节点** / **别人作为 flow 节点**。判定标准：是否有受支持、可编程、可审计的接口（不是"模型愿意调就行"）。

### 5.1 方向 A：flow 作为另一个编排引擎的节点

| 通道 | 可行性 | 机制 | 限制 | 标签 |
|---|---|---|---|---|
| **A1 模型工具层**（推荐/现状唯一受支持） | ✅ 可用 | 外层引擎的节点会话里由模型调 `flow_run(flowPath, runId, vars)`；结果作为该会话输出回流 | 依赖模型服从提示词（非确定）；工具结果被摘要截断；`runId` 需外层约定；gate 在 delegated child 内不可用 | FACT（工具全局注册：`F:spike/dsh-flow-plugin/index.js:730-749`）/ INFERENCE（可靠性） |
| **A2 同进程库调用** | ⚠️ 技术上可行、未承诺 | `import { createEngine } from '<...>/spike/flow-core/index.js'`，自备 executor；内核零 DSH 依赖、时钟可注入 | 未发布/npm 私有；路径相对打包；session 节点仍需活 `parentAgent`；无事件订阅（工厂不返回 `on`）；两套 journal 格式 | FACT（导出：`F:spike/flow-core/index.js:783`）/ INFERENCE（可用性） |
| **A3 引擎/服务层** | ❌ 今天不行 | 需要 `ctx.flowEngine.start() → handle{id,result,cancel,dispose}` + `on(event)` | 该合同只在 `docs/04 §10.3` 作为 **M2 计划**存在；当前 `apply()` 只注册工具 | FACT（`F:docs/04-架构设计.md:1602-1622`；`F:spike/dsh-flow-plugin/index.js:636-767`） |

**A1 的已知具体行为**（外层引擎需要知道的）：
- `flow_run` 参数只有 `flow/flowPath/vars/runId/cwd`，**没有** parent/meta/lineage 字段（`F:spike/dsh-flow-plugin/lib/tools.js:641-650`）→ 外层只能靠 `runId` 命名约定 + `vars` 传 `{tree_id,leaf_id}`。
- 返回是**模型视图**：节点 output 截断 600 字符、outputs >4000 字符变 `{truncated,preview}`（`F:spike/dsh-flow-plugin/lib/tools.js:28-48,332-347`）→ 机器消费必须读 journal 文件。
- `flow_run` 前台同步执行（工具调用内跑完），不注册后台 job（`F:spike/dsh-flow-plugin/README.md:20-21`）。
- delegated child 里跑含 `human_gate` 的 flow **必失败**（宿主把子会话 approval 钉死 `never`；flow 侧 fail-closed）——已在项目内真机证实（`F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md:274-290`）。

### 5.2 方向 B：另一个引擎作为 flow 的节点

| 通道 | 可行性 | 说明 | 标签 |
|---|---|---|---|
| B1 引擎级节点（新 node type / 注册执行器） | ❌ 不行 | 节点类型编译期闭集；`docs/04` 明写"M1 不允许自定义节点类型"；`createEngine` 不暴露 executor 注册；`config.executor` 非文档化扩展点 | FACT |
| B2 prompt 级（`session` 节点内让子会话当"commander"，调别的引擎工具） | ✅ 可行（零改动） | 节点输出由 **outputSchema + 抽取阶梯**收口；外层只看终态；子树/别的引擎账本与 flow 账本**无事务关系** | FACT（能力）/ INFERENCE（可靠性） |
| B3 把别的引擎的 run 映射成 flow 节点（下沉适配器） | ⚠️ 需双方改造 | 需要对方提供 `await result + dispose`、id 映射、完成信号；项目已论证结构性冲突（节点数预算、输出契约、attempt 语义、状态机、身份） | FACT（论证：`F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md:217-239,255-268`） |

### 5.3 项目已有的组合论证（直接可用的事实输入）

项目内已有一份 62 KB 只读论证 `F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md`（HEAD `d0f0e1e` 时点），核心结论：

| 方案 | 拓扑 | 改动 | 结论 | 证据 |
|---|---|---|---|---|
| **A** | tree 外层 / flow 内层（leaf 调 `flow_run`） | 0 代码 + 6 项 P0 契约 | **M1 采用** | `:150-184,367-377` |
| **A+/C-light** | flow 外层 / tree 内层（flow 节点=tree commander） | 0 代码 + 模板 | **M2 试点** | `:185-216` |
| **B** | flow 节点 = tree node（影子树） | flow 5–7 人日 + tree 5–8 人日 | 暂缓（结构冲突多） | `:217-239` |
| **C** | 双向 service 嵌套 | 15–25 人日 + 两仓协同 | M3 | `:241-251` |

三条硬约束（跨引擎组合的**真实天花板**，建议作为组织形态设计的输入）：

| # | 约束 | 对组合的含义 | 证据 |
|---|---|---|---|
| a | delegated child 的 approval 被宿主钉死 `never`，子会话无人工交互；`flow_resume{gate}` 的 `approvalRef` 只认同进程 mint | **含 gate 的 flow 只能在 root+ask 会话跑**；tree leaf / flow 节点 / 任何子会话内必然 fail-closed；不能"leaf 发起、root 事后补批" | `F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md:274-290`（含宿主 `dsh-subagent`/`dsh-user-approval` 行号） |
| b | flow 确定性 journal vs tree 竹节/漂移语义 | 竹节 = interrupt 旧会话再起新会话；旧会话若卡在 `flow_run` 内 → 工具批 abort 经 `exec.signal` → run **CANCELLED 且不可 resume**；两本账无共同事务边界，只能按 id 关联 | `:292-320` |
| c | 预算/深度叠加 | 公式 `T + F + relay + verify + handoff ≤ 20`，建议 `T+F ≤ 17`；深度按会话层叠加（profile 现为 4）；flow 单节点 ≤600s、run ≤30min | `:322-355` |

> 注：该论证基于 tree 仓 `HEAD 0cbc31e` + 工作树 0.5.0（未提交）、宿主 `maxDepth=3`。**当前 profile 已改为 `maxDepth=4`**，深度表可放宽一层；其余结论未变。**FACT（漂移点）**

### 5.4 组合契约缺口清单（free-flow 视角）

| # | 契约维度 | 现状（fact） | 缺什么 | 对"递归嵌套组织形态"的影响 | 归属 |
|---|---|---|---|---|---|
| 1 | **节点执行器抽象** | `SessionExecutor` 仅内核内部契约；`createEngine` 单 executor；节点类型闭集 | 可注册的节点执行器/类型（至少"外部引擎节点"适配槽），含 `start/adopt/cancel/dispose` 生命周期 | 别的引擎无法成为 flow 的一等节点，只能塞进 prompt | flow 侧（M2+，需 CR） |
| 2 | **持久化命名空间** | 所有 run 平铺 `<root>/runs/*.jsonl`，单锚点 domain；journal 格式随引擎（flow-core vs builtin）不互通 | run 归属命名空间（owner/namespace/树路径）、跨引擎统一索引或清单 | 组织形态下 run 数量爆炸、无法按子树聚合/清理；崩溃恢复要扫全目录 | flow 侧 + 平台（存储服务） |
| 3 | **预算/配额** | HB-7 硬帽；运行期 `min(DSL, 部署 3, 宿主 8−2)`；**插件未把 profile 的 20 传进来**；无跨 run 记账 | 父引擎向子 flow 下发预算（节点数/墙钟/token）；运行中预算回传；宿主并发租约 | 组合层无法做总盘控制，只能事后发现失败；"嵌套层数×并发"容易击穿 20 | flow 侧（P1-2）+ 平台 |
| 4 | **权限/审批** | `permTier` 冻结 + callerOrigin ceiling；gate 只在 root+ask 可用；D19（插件自有 UI 人工通道）已选 M1.1 未做 | delegated child 可用的人工通道，或把 gate 上提到外层 | 任何"树内/节点内的门禁"目前都不可用，必须设计成分流 | flow 侧（D19）/ 平台 |
| 5 | **取消传播** | 只有调用方 `exec.signal`；无 `flow_cancel`；`engine.cancel()` 单槽且插件不用；CANCELLED 不可 resume | 按 `runId` 的取消 API（跨会话/跨进程）；取消后可选"可恢复/不可恢复"语义；父子级联策略 | 外层引擎无法只杀一个子 flow；只能 interrupt 整个会话，代价过大 | flow 侧（M2 工具面）+ 平台 |
| 6 | **会话 lineage** | journal `run/started.ownerSessionId` **恒 null**；`callerSessionId` 只写 sidecar、无人读；`node/spawned.sessionId` 有 | journal 级 `ownerSessionId/parentRunId/parentNodeId`；读侧投影可查 | 无法从 flow 账本反查"谁发起/属于哪个树节点"，组织形态的审计链断裂 | flow 侧（低成本，价值高） |
| 7 | **结果交付契约** | 工具结果摘要截断（600/4000）；全量只在 journal | 机器可消费的结果引用（artifact/文件句柄）或 `status` 的结构化全量 | 外层引擎拿不到完整产物，必须自己读文件并解析 journal 格式 | flow 侧（M2） |
| 8 | **事件面** | `FlowEngine.on/onAny` 存在，但 `createEngine` 不暴露；无 `ctx.emit` | 可订阅的 run/node 事件（或稳定轮询契约） | 外层无法做实时编排/监督会话；只能轮询 `flow_status` | flow 侧（M2 Service） |
| 9 | **调用者身份** | 从 session header 嗅探 origin/depth；无签名、无显式 caller 声明 | 显式 caller 元数据（sessionId/外部 runId/角色），由调用方或平台注入 | 无法做"谁有权限续跑/取消"；同存储根的任何会话都能 `flow_resume` | flow + 平台 |
| 10 | **UI 嵌入** | 自带右侧栏只读面板（`/flow-panel` 3 条 GET + `sidebarRight` slot） | 给外部编排器的视图契约（按 owner 过滤、深度链接、嵌入 seat） | 组织形态需要"树 + 流程"统一视图，目前是两个独立面板 | 双方 |
| 11 | **多轮/交互节点** | 节点=一次性会话；无 sendMessage | 可续接节点（长任务、对话式审批、监督会话） | 无法表达"节点内多轮协商/人工澄清" | flow（依赖平台 sender） |
| 12 | **深度预检** | 无；靠宿主报错 | 组合层可查询/预留 depth 预算 | 深层嵌套只能在运行期失败 | 平台（暴露 depth 预算） |

---

## 6. 状态、边界与路线

### 6.1 M1 完成度（`docs/11 §13` 看板摘要）

| 任务 | 状态 | 关键产出 |
|---|---|---|
| T0–T9 | ✅ | 治理；R-13 修；nativeSchema；抽取阶梯；存储/B1/锚点；adopt；judge；human_gate；permTier；并发 ≤3（双序 journal） |
| T10 A36 真机 | ✅（含 fix） | 2 节点/条件分支真机；`structured_output` 交付提示修复 |
| T11 A37 强杀 | ⏸ **待用户时间窗**（杀前准备已完成） | 未执行，不得写"已通过" |
| T12 只读面板 | ✅（真机 R-m1-07 壳层已取证） | 右侧栏页面 + 只读流程图 |
| T13 QA | 🚧 收尾（Phase1/1b/2a/2c/2d/2e/2f 完成；2b 待 R-m1-05c） | `T13-REPORT-DRAFT.md` PASS_WITH_RESIDUAL |
| T14 收口 | 🚧 | manifest 重建 267/114；`m1-done` **未打**（门禁 = R-m1-05c + T11，或用户 CR 接受残留） |
| T14-E2E | ✅ | 74 用例：PASS 72 / FAIL 0 / SKIP 2（SKIP 即上面两项） |

证据：`F:docs/11-M1实施计划.md:507-531`；`F:HANDOFF-M1.md:5-10`；`F:spike/flow-core/test/baseline-manifest.json`；`F:evidence/m1/T14/qa-gate-verify-after-manifest-2026-11-11.txt`。**FACT**

### 6.2 当前未收口事项

| 项 | 状态 | 影响组合的要点 | 证据 |
|---|---|---|---|
| R-m1-05c 真人 approve | 阻塞（需 root+ask 交互） | 证明"宿主 approval 通道可用于 gate"；未闭环前 gate 只有离线/模拟证据 | `F:evidence/m1/T14/R-M1-05C-NOT-FOUND-2026-11-11.md`；`docs/11:524` |
| T11 A37 强杀 | 待用户 | 证明"真进程 kill → resume"，组合里"崩溃恢复"承诺的前提 | `F:evidence/m1/realmachine/T11-PREP-2026-11-11.md` |
| CR-CAND-01..07 | 待裁决/追认 | CR-03 `storageDir` 部署前置（直接影响跨 workspace 组合）；CR-06 `structured_output` 波动；CR-07 D19 插件 UI 人工通道（选 M1.1） | `F:evidence/m1/T14/CR-ADJUDICATION-BRIEF-2026-11-11.md:23-57` |
| 跨进程 pending gate resume | 残留（fail-closed） | 组合里"重启后续跑带 gate 的 run"不可用 | `F:docs/11-M1实施计划.md:520` |
| `oneOf` 能力缺口 | 残留 | fullSchema 子集不含 oneOf（宿主白名单含）→ 复杂输出契约受限 | `HANDOFF-M1.md:186` |

### 6.3 QA 残留（MVP 15 项）现状映射（摘要）

| 残留 | 归属/处置 | 现状 | 证据 |
|---|---|---|---|
| #1 adopt 未在真实执行器实现 | M1/T5 | ✅ 已实现 | `docs/11:486` |
| #2 journal 前缀截断不可检测 | M1/T4 锚点 | ✅ 最小锚点已交付（服务缺失时降级） | `docs/11:487` |
| #3 无真并发 | M1/T9 | ✅ 并发 ≤3 | `docs/11:488` |
| #4 抽取阶梯未在内核 | M1/T3 | ✅ 单一实现 | `docs/11:489` |
| #5 内核直连缺 A38 白名单 | M1/T2 | ✅ nativeSchema 下沉编译期 | `docs/11:490` |
| #6 陈旧数字/表述 | 文档 | 部分（本报告已标注深度漂移等） | `docs/11:491` |
| #7 A19/A34 无专门测试 | M1/T3/T9 | ✅ | `docs/11:492` |
| #8 无 snapshot、resume 全量重放 | M2 | 未做 | `docs/11:493` |
| #9 打包耦合（相对路径内核） | M1 治理 / ADR-017 | ⚠️ **未实施 vendoring** | `HANDOFF-M1.md:187-188` |
| #10 `ctx.flowEngine` Service | M2 | 未做 | `docs/11:495` |
| #11 无脱敏/保留期 | M2 | 未做 | `docs/11:496` |
| #12 多 profile storageDir/卸载残留 | 文档+M2 | profile 现显式钉根（CR-03 A） | `docs/11:497`；profile `:272-280` |
| #13 R-13 owner.lock 泄漏 | M1 首项 | ✅ 修复 | `docs/11:498` |
| #14 R-14 CLI runId 穿越 | M1 顺手修 | 工具面已封；CLI 直连仍存（非产品面） | `docs/07:229` |
| #15 builtin legacy journal 无 hash 链 | M2 | 未做（builtin 仅兜底） | `docs/11:500` |

### 6.4 已知边界（组合相关，逐条）

| 边界 | 证据 | 标签 |
|---|---|---|
| 前台同步：一次工具调用跑完，无后台 run/kill | `F:spike/dsh-flow-plugin/README.md:20-21,101` | FACT |
| 无 `ctx.flowEngine` Service、无事件订阅出口 | `F:docs/04-架构设计.md:1602-1622`；`F:spike/flow-core/index.js:837-1057` | FACT |
| 节点=一次性会话，无多轮/续接 | `F:spike/dsh-flow-plugin/README.md:238` | FACT |
| 节点会话 at-least-once（崩溃可能重跑），adopt 可缓解 | `F:spike/flow-core/README.md:257-270` | FACT |
| loop / supervisor / L2 执行 / 可编辑画布未实现 | `F:docs/11-M1实施计划.md:44-55` | FACT |
| 工具结果摘要截断（600/4000） | `F:spike/dsh-flow-plugin/lib/tools.js:28-48,332-347` | FACT |
| `flow_run.cwd` 不决定存储根；存储根=宿主解析 runCwd | `F:docs/08-需求说明.md:324`；`F:spike/dsh-flow-plugin/lib/storage-path.js:136-233` | FACT |
| 同存储根的任何活会话都能 `flow_resume`（无 owner 校验） | `F:spike/dsh-flow-plugin/lib/tools.js:906-1033`（只校验根/锚点/签名，不校验 caller） | FACT（代码）/ INFERENCE（风险） |
| `delivery:'caller'` 的子会话仍登记父 catalog（可观测） | `F:docs/00-执行摘要.md:33-36` | FACT |
| 宿主 `outputSchema` 受限子集；`structured_output` 交付波动 | `F:spike/dsh-flow-plugin/README.md:219-226`；CR-06 | FACT |
| 外部 bundle 不能 import `@deepseek-ai/*` | `F:spike/dsh-flow-plugin/README.md:14`；`architecture.test.js:40-49` | FACT |
| 包未发布（`private: true`），仅本地 link | `F:spike/flow-core/package.json`；`F:spike/dsh-flow-plugin/package.json` | FACT |

### 6.5 M2+ 路线中与"组合/嵌套"相关的项

| 里程碑 | 内容 | 对组合的意义 | 证据 |
|---|---|---|---|
| M2 | `ctx.flowEngine` Service（start/resume/list/on + handle.cancel/dispose） | **最关键**：别的引擎第一次有受支持的编程入口 | `F:docs/04-架构设计.md:1602-1622,1750` |
| M2 | `flow_validate` / `flow_cancel` 工具面 | 校验与按 run 取消 | `F:docs/04-架构设计.md:1750` |
| M2 | 后台 run（`ctx.jobs`，可 kill/续跑） | 组合层可 fire-and-forget + 管理生命周期 | 同上 |
| M2 | supervisor 实跑（受限动作+预算+留痕） | "监督会话"诉求的落点 | `F:docs/04-架构设计.md:1750`；ADR-008 |
| M2 | 可编辑画布 / L2 评估 / 脱敏保留期 / 快照 | UI 与运行时扩图 | 同上 |
| M2–M3 | 与 tree 的 B/C 方案（需树仓服务化：service、await+dispose、每树锁、relay 开关、事件面） | 引擎级双向嵌套的前置 | `F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md:409-419` |
| M3 | Dify 导入器、`subflow` 内联展开（不支持递归）、定时/Webhook | 真"子流程"节点仍只在 M3 类型表 | `F:docs/04-架构设计.md:619`；`F:docs/00-执行摘要.md:125` |
| M1.1 | D19 插件自有 UI 人工通道（已选） | 让 gate 在非 root 会话可用（组合的关键使能） | `F:evidence/m1/T14/CR-ADJUDICATION-BRIEF-2026-11-11.md:52-57` |

---

## 7. 组合契约需求清单（free-flow 视角）

### 7.1 它需要基础层/平台提供什么

| 类别 | 具体需求 | 现状/证据 | 优先级 |
|---|---|---|---|
| **会话语义** | ①`startActivation` 稳定形状（provider/label/delivery/signal/request{prompt,parent,cwd,outputSchema,agentOptions}）+ `childId` + `await result` + `dispose`；②`result.output` 归一（blocks→text）；③`structured_output` 语义可预期；④`readSession` 可读冷会话（adopt 前提）；⑤深度/容量错误**可区分**（现在 depth 错误被吞成 `E_SESSION_START_FAILED`） | `F:spike/dsh-flow-plugin/lib/session-executor.js:236-313,316-381`；错误映射 `:267-270` | P0 |
| **消息** | 节点会话续接/多轮（`sendMessage`）与"节点内再协商"能力 | 未实现；引擎非 Agent（`README.md:238`） | P1 |
| **Lineage** | ①journal 记录 `ownerSessionId/parentRunId/parentNodeId`（现 `run/started.ownerSessionId` 恒 null）；②会话侧可查"我属于哪个 run/节点"；③跨账本稳定 join key | `F:spike/flow-core/src/engine.js:3008`；sidecar 只写不读 `F:lib/tools.js:196-227` | **P0（低成本高价值）** |
| **取消** | ①按 `runId` 的取消通道（跨会话/跨进程/跨引擎）；②取消→CANCELLED 语义与"可否恢复"显式化（现 CANCELLED 禁 resume）；③父子级联策略（父 run 失败能否停子 flow） | `F:spike/flow-core/src/engine.js:3119-3121`；插件无 `flow_cancel` | **P0** |
| **预算** | ①宿主运行时暴露 `maxActiveSubagents/maxDepth`（现在插件用默认 8−2）；②父引擎可向子 flow 下发预算；③并发租约/预留（避免 tree 与 flow 互撞）；④跨 run 预算汇总 | `F:spike/flow-core/src/engine.js:272-274,562-589`；`F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md:322-355` | **P0/P1** |
| **调用者身份** | 结构化 caller 元数据（sessionId / delegationDepth / 外部 run+node id / 角色），替代 header 嗅探；"谁可以 resume/cancel"的归属规则 | `F:spike/dsh-flow-plugin/lib/tools.js:161-185`；resume 无 owner 校验 | P1 |
| **存储** | 命名空间/多租户式根（按 owner 或树路径）；跨引擎统一 run 索引；保留期/GC | 平铺 `runs/`；单 anchor domain | P1 |
| **UI/事件** | ①可订阅事件面（run/node/gate）；②可嵌入的视图 seat + 按 owner 过滤；③深度链接（node sessionId ↔ 子代理面板） | 只有自有右侧栏面板；`createEngine` 无 `on` | P1/P2 |
| **审批** | delegated child 的人工通道（宿主级或插件级 D19） | 现在 leaf/节点内 gate 必失败 | P0（若组织形态需要门禁下沉） |

### 7.2 它愿意（且能够）暴露什么

| 表面 | 形态 | 稳定性 | 说明 | 证据 |
|---|---|---|---|---|
| `flow_run/status/resume/list` | 4 个模型工具（全局注册，无 toolFilter） | 交付契约（M1 冻结口径） | 入参/错误码/快照形状文档化；结果为人读摘要 | `F:spike/dsh-flow-plugin/README.md:60-97` |
| run 快照 | `{runId,status,flowId,engine,nodes[{id,type,status,sessionId,durationMs,output,error}],outputs,gates,permTier,integrity,journalPath,storageRoot}` | 稳定（读侧投影） | 可作为跨引擎对账的公共结构 | `F:spike/flow-core/index.js:636-700`；`F:spike/dsh-flow-plugin/lib/tools.js:823-903` |
| journal | append-only JSONL + sha256 链 + `verifyJournal(entries)` + 事件闭集 | 稳定（写侧唯一真源） | 外部可只读审计；**不可跨引擎 resume**（格式随引擎） | `F:spike/flow-core/src/journal.js:48-78,882-`；`F:spike/flow-core/index.js:183` |
| 内核库 | `compile/fold/createEngine/verifyJournal/extractOutput/…`（零 DSH 依赖） | 导出但非发布契约 | 同进程复用"确定性 DAG + journal"最省耦合 | `F:spike/flow-core/index.js:141-264` |
| `createEngine` 工厂 | `{kind,run,resume,status,list}` + 单 `SessionExecutor` | 集成契约（README §6/§9） | 可替换执行器（换成"别的引擎的会话启动器"） | `F:spike/flow-core/index.js:783-1057` |
| 只读面板 | `GET /flow-panel/runs`、`/runs/:id`、`/runs/:id/events`（GET-only，Host/Origin allowlist） | M1 增量 | 外部可复用其投影逻辑（`panel-view.js` 纯函数） | `F:spike/dsh-flow-plugin/index.js:403-530,531-630` |
| M2 Service（计划） | `ctx.flowEngine.start(flow,opts)→handle{id,status,result,cancel,dispose}` + `resume/list/on` | **未实现** | 这是组合最想要的形态，应在组织形态设计中作为**前置依赖**提出 | `F:docs/04-架构设计.md:1606-1622` |

### 7.3 建议的最小契约集（给组织形态设计）

| 阶段 | 契约 | 理由 |
|---|---|---|
| **现在（文档/约定层，零代码）** | ①组合方向选 A 或 A+（模型工具层）；②gate 分流（含 gate 的 flow 只 root 跑）；③relay/handoff 与运行中 flow 互斥；④`runId` 命名 + `vars` 携带外部节点 id；⑤存储根按 workspace 统一；⑥版本 pin + 能力探测 | 项目已有 P0 清单（`INTEGRATION-DESIGN.md:367-377`），可直接复用 |
| **M1.1** | D19 插件 UI 人工通道（让非 root 会话也能人工裁决） | 解锁"树内/节点内门禁" |
| **M2（flow 侧小改）** | ①journal 写 `ownerSessionId` + `parentRunId/parentNodeId`；②`flow_cancel(runId)`；③`hostMaxActiveSubagents/margin` 透传；④`flow_run` 加 `meta/lineage` 入参；⑤结果全量引用（artifact） | 都是小改，但决定组合是否可审计/可控 |
| **M2（flow 侧大件）** | `ctx.flowEngine` Service + `on()` 事件 + run handle | 引擎级组合的唯一入口 |
| **M3（跨仓）** | flow 侧外部执行器/节点类型注册槽 + tree 侧服务化 + 双向 id 映射 | 真·递归嵌套 |

---

## 8. 证据索引（主张 → file:line）

| 主张 | 证据 |
|---|---|
| 4 工具全局注册、apply 装配 | `F:spike/dsh-flow-plugin/index.js:47,636-767,730-749` |
| 工具定义与参数 | `F:spike/dsh-flow-plugin/lib/tools.js:633-820,823-903,906-1033,1036-1106` |
| 节点=一次 activation（起/等/释放） | `F:spike/dsh-flow-plugin/lib/session-executor.js:236-313` |
| 输出 blocks 归一 | `F:spike/dsh-flow-plugin/lib/session-executor.js:158-178` |
| adopt 7 条件 | `F:spike/dsh-flow-plugin/lib/session-executor.js:316-381` |
| callerOrigin/ceiling | `F:spike/dsh-flow-plugin/lib/tools.js:148-185`；`F:spike/flow-core/src/permissions.js:405-490` |
| 存储根解析 / B1 围栏 | `F:spike/dsh-flow-plugin/lib/storage-path.js:136-233,302-385` |
| 引擎加载（相对路径 + sha256 + hmr evict） | `F:spike/dsh-flow-plugin/lib/core-adapter.js:39-45,93-158,169-194` |
| 面板只读路由 | `F:spike/dsh-flow-plugin/index.js:403-530,531-630`；`F:spike/dsh-flow-plugin/lib/panel-view.js` |
| 引擎 run/resume/status/list 装配 | `F:spike/flow-core/index.js:783-1057` |
| run 主循环/冻结权限/ownerSessionId=null | `F:spike/flow-core/src/engine.js:2880-3063`（null 在 `:3008`） |
| CANCELLED 不可 resume | `F:spike/flow-core/src/engine.js:3119-3121` |
| 并发三层取 min | `F:spike/flow-core/src/engine.js:562-589` |
| 执行器解析/调用/归一 | `F:spike/flow-core/src/engine.js:1271-1280,1295-1433,1453-1521` |
| 节点类型闭集 / HB-7 | `F:spike/flow-core/src/schema.js:36-50,58-72` |
| journal 事件闭集 / hash / 锁 | `F:spike/flow-core/src/journal.js:48-78,309-341,448-520,603-644` |
| 桥接执行器（模板/nativeSchema） | `F:spike/flow-core/src/executors.js:286-351` |
| 架构红线测试 | `F:spike/flow-core/test/architecture.test.js:40-77` |
| 节点类型表（subflow=M3、禁止自定义） | `F:docs/04-架构设计.md:607-624` |
| NodeExecutor 设计契约（未实现为 handle） | `F:docs/04-架构设计.md:1089-1136,1138-1208` |
| M2 Service 合同 | `F:docs/04-架构设计.md:1602-1622` |
| maxDepth 默认 1 / 嵌套 fail-closed 要求 | `F:docs/04-架构设计.md:221` |
| M1 看板/残留归属 | `F:docs/11-M1实施计划.md:482-503,507-531` |
| 测试 floor | `F:spike/flow-core/test/baseline-manifest.json:11,41`；`F:evidence/m1/T14/qa-gate-verify-after-manifest-2026-11-11.txt` |
| 跨引擎组合论证（A/A+/B/C、三硬约束、P0/P1） | `F:evidence/m1/tree-harness/INTEGRATION-DESIGN.md:21-31,134-142,150-268,274-355,367-388,409-419` |
| CR 裁决底稿（storageDir/D19） | `F:evidence/m1/T14/CR-ADJUDICATION-BRIEF-2026-11-11.md:23-31,46-57` |
| 宿主容量与 flow 配置（当前 profile） | `C:\Users\sir_c\.dsh\profiles\desktop\cordis.patch.yml:223-227,272-280`；`...\package.json`（bundles/dependencies） |

---

## 9. 未验证 / 不确定清单

1. **UNKNOWN**：`flow_run`（gate-free）在 tree leaf 内跑通的端到端真机证据——项目自述只有 gate 失败路径（`INTEGRATION-DESIGN.md:531`）。
2. **UNKNOWN**：会话中断是否必然把 abort 传到工具批 `exec.signal`（决定组合时是"CANCELLED"还是"孤儿 run"）（同文件 `:532`）。
3. **UNKNOWN**：竹节 `interrupt` 与 flow `finally dispose` 的竞态（`:533`）。
4. **UNKNOWN**：`session_handoff` 与运行中 flow 的组合行为（`:534`）。
5. **UNKNOWN**：同一插件实例内**多 run 并发**的取消语义——`FlowEngine.activeRun` 是单槽（`engine.js:268,2906`），第二个 run 会覆盖；插件从不调 `cancel()`，但若未来 Service 暴露 cancel，这点必须改。
6. **UNKNOWN**：深层嵌套（如 flow 节点内再 `flow_run`）时存储根实际落点（`resolveHostCwd` 取节点会话 cwd）与 R2c-F02 残留的真实影响。
7. **UNKNOWN**：当前运行宿主版本是否仍为 `0.2.2-rc.1`；本报告未读活体 Service 目录，未跑任何工具。
8. **UNKNOWN**：`maxDepth` 从 3→4 的变更时间与原因（profile 有历史备份，本次未追）。
9. **INFERENCE**：所有"组合可行性"判断基于代码静态路径 + 项目自述证据，不含本报告新增真机验证。
