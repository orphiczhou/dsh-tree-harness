# W2: DSH 宿主派发子会话的可配置旋钮 — 源码权威盘点

方法：`node scripts/asar-tool.cjs D:\DSHarness\resources\app.asar grep/cat <关键词>` 直读宿主 app.asar 内编译前源码（`/dsh/node_modules/@deepseek-ai/...`）。下文每条结论均附文件路径与行号的原始摘录。本文不编造：未 grep 到即记"无证据"。

---

## 1. SubagentStartRequest 全字段清单

### 1.1 原始 grep 摘录（SubagentStartRequest 定义）

```
--- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/typert.host.js:778-779
"name": "SubagentStartRequest",
"declaration": "export interface SubagentStartRequest {
    readonly label?: string;
    readonly prompt: ContentBlock[];
    readonly parent: Agent;
    readonly signal: AbortSignal;
    readonly agentOptions?: AgentOptions;
    readonly outputSchema?: ObjectJsonSchema;
    readonly maxDepth?: number;
    readonly toolFilter?: ToolRestriction;
    readonly persona?: string;
}"
```

（同文重复出现在 `/dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js:7230-7231`。）

### 1.2 AgentOptions 定义

```
--- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/typert.host.js:242-243（以及
    dsh-agent-preset-registry / dsh-api-session-controller / dsh-commands / dsh-goal /
    dsh-session-reference / dsh-user-questions / dsh-cordis-host-runner 等各包的 typert.host.js 同款）
"declaration": "export interface AgentOptions {
    provider?: string;
    model?: string;
    reasoningEffort?: ReasoningEffortId;
    maxTokens?: number;
    subagentDepth?: number;
}"
```

### 1.3 ResolvedSubagentStartRequest（宿主内部加一层 descriptor）

```
--- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/typert.host.js:610-611
"declaration": "export interface ResolvedSubagentStartRequest extends SubagentStartRequest {
    readonly descriptor: SubagentDescriptorData;
}"
```

### 1.4 字段表

| 字段 | 类型 | 默认值（来源） | 语义 | 谁可传 |
|---|---|---|---|---|
| `label` | `string?` | 无默认（可选） | 展示用标签；一次性后台 job / continuable 子会话名。**模型不可直接传**：subagent 工具把 `args.description`（"3-5 词展示描述"）填入 `label`（`dsh-tool-subagent/lib/index.js:510` `label: args.description`；`529` 同） | 父会话经工具的 `description` 参数；树引擎经 `ctx.subagents` API；ContinuableStartSpec 顶层必填 `label` |
| `prompt` | `ContentBlock[]`（必填） | 无 | 初始任务内容 | 父会话（工具 `prompt` 参数）/树引擎 |
| `parent` | `Agent`（必填） | 无 | 派发父 agent，宿主在 `execute` 内取 `exec.agent` 填入（`dsh-tool-subagent/lib/index.js:491,515`） | 仅宿主内部 |
| `signal` | `AbortSignal`（必填） | `exec.signal` 或后台 job 的 controller.signal（`dsh-tool-subagent/lib/index.js:543-551,559`） | 取消信号 | 仅宿主内部 |
| `agentOptions` | `AgentOptions?` | 继承父路由：`resolveChildAgentOptions` 先取父 provider/model/reasoningEffort/maxTokens，再被 per-request 覆盖，再盖 `subagentDepth`（`dsh-subagent/lib/index.js:436-452`） | 子 agent 的 LLM 路由/推理强度/输出上限/派发深度 | 父会话（工具的 `provider`/`model`/`reasoning_effort` 参数，需 `modelSelectionSettings: true`；见 `dsh-tool-subagent/lib/index.js:412-425`）+ 部署 config 的 `agentOptions`；树引擎可整体传 |
| `outputSchema` | `ObjectJsonSchema?` | 无 | 结构化输出：挂 `structured_output` 捕获工具 + 提示段（`dsh-subagent-in-process-driver/lib/index.js:177,36-108`）。**subagent 工具不暴露此字段**（工具 schema 只有 description/prompt/[provider/model/reasoning_effort]/run_in_background，`dsh-tool-subagent/lib/index.js:401-430`）；workflow 工具内部使用 | 仅程序化调用方（宿主内部/插件，如 dsh-tool-workflow）；ContinuableStartSpec 明确 Omit 此字段 |
| `maxDepth` | `number?`（非负安全整数，`assertSubagentMaxDepth`，`dsh-subagent/lib/index.js:120-122`） | 部署级：`dsh-subagent` Config `maxDepth` 默认 **1**（`z.number()...default(1).volatile()`，`lib/index.js:2822`）；工具 config 可覆写或 `'provider-managed'` | 派发深度绝对上限；超出抛 `SubagentDepthError`（`lib/index.js:379-405`） | 部署 config（`dsh-tool-subagent` Config `maxDepth`）；**父会话/模型不可传** |
| `toolFilter` | `ToolRestriction?`（`{allow?: string[], deny?: string[]}`，见 `dsh-tool-subagent/lib/index.js:265-268`；两者皆空则报错 `lib/index.js:370`） | 无（不配置即不限制） | 子作用域工具白/黑名单：`childCtx.tools.restrict(composition.toolFilter)`（`dsh-subagent/lib/index.js:522`） | 仅部署 config（工具 `execute` 从 `config.toolFilter` 填入，`dsh-tool-subagent/lib/index.js:518`）；模型不可传 |
| `persona` | `string?` | 无 | 覆盖式人设系统提示段：`deployment:persona-prefix`（`dsh-subagent/lib/index.js:517-521`） | 仅部署 config（`config.persona`，`dsh-tool-subagent/lib/index.js:517`）；模型不可传 |
| （Resolved）`descriptor` | `SubagentDescriptorData` | 宿主生成 | 快照 {mode, provider, label, agentProvider?, agentModel?, agentReasoningEffort?, persona?, toolFilter?}，持久化到子会话日志（`subagent/descriptor` 事件），冷恢复重建用（`lib/index.js:1684-1693,1916-1932`） | 仅宿主内部 |

### 1.5 派发工具（模型可见）的输入 schema

```
--- /dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js:398-430（节选）
parameters: {
    description: { type:"string", required:true, description:"A short (3-5 word) description..." },
    prompt: { type:"string", required:true, ... },
    ...modelSelectionEnabled ? { provider{...}, model{...}, reasoning_effort{...} } : {},
    ...backgroundEnabled ? { run_in_background: { type:"boolean", ... } } : {}
}
```

### 1.6 dsh-tool-subagent 部署 Config（宿主侧旋钮，模型不可见）

```
--- /dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js:252-270
const Config = z.object({
    provider: z.string().required(),
    toolName: z.string().default("subagent"),
    modelSelectionSettings: z.boolean().default(false),
    enableRunInBackground: z.boolean().default(true),
    backgroundMode: z.union(["one-shot", "continuable"]).default("one-shot"),
    agentOptions: z.object({ provider, model, reasoningEffort, maxTokens: step(1).min(1)... }).default(void 0),
    persona: z.string(),
    toolFilter: z.object({ allow: z.array(z.string()).default(void 0), deny: ... }).default(void 0),
    maxDepth: z.union([z.natural().max(MAX_SAFE_INTEGER), z.const("provider-managed")])
});
```

```
--- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js:2821-2823
static Config = z.object({
    maxDepth: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1).volatile(),
    maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8).volatile()
});
```

### 1.7 能力开关（提供方必须声明支持，否则启动前拒绝）

```
--- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/typert.host.js:707
"declaration": "export interface SubagentCapabilities {
    readonly agentOptions: boolean;
    readonly outputSchema: boolean;
    readonly depthLimit: boolean;
    readonly toolFilter: boolean;
    readonly persona: boolean;
}"
--- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js:2523-2529
const NO_START_CAPABILITIES = Object.freeze({ agentOptions:false, outputSchema:false, depthLimit:false, toolFilter:false, persona:false });
```

进程外后端能力为全 false，需要任一 start 特性的请求在 `start` 前即被拒绝（"never accepted-then-ignored"，`lib/index.js:2517-2522`）。in-process 后端全 true（`dsh-subagent-spawn-in-process/lib/index.js:23-29`）。

---

## 2. 子会话对配置的感知（可见性）

### 2.1 以注入文本形式可见（子模型直接读到）

- **delegation scope 声明（每个 in-process 子会话恒定注入）**：
  ```
  --- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js:487
  const SUBAGENT_DELEGATION_CONTEXT = "You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. ..."
  （经 childCtx.systemPrompt.context({name:"subagent:delegation", ...}) 注入，lib/index.js:512-516）
  ```
  注意：这是**运行时上下文贡献而非系统提示段**，且不带任何 per-child 参数值——只声明"作用域已固定"，不回显具体配置。
- **persona**：作为系统提示段 `deployment:persona-prefix` 直接进入子的系统提示（`lib/index.js:517-521`）→ 子可见原文。
- **结构化输出要求**（仅 outputSchema 路径）：提示段 `STRUCTURED_OUTPUT_INSTRUCTION` + `structured_output` 工具 schema（`dsh-subagent-in-process-driver/lib/index.js:21-27,50-84`）→ 子可见。
- **continuable 回报指引**（仅 continuable）：初始 prompt 末尾追加 "Your parent agent id is ..." 文本（`lib/index.js:599-604`）→ 子可见父会话 id。
- **prompt 本身**：显然可见。

### 2.2 以行为/环境差异间接可感知（无文本回显）

- **toolFilter**：子只看到"工具存在与否"（`childCtx.tools.restrict`），无任何回显文本（`lib/index.js:522`）。
- **agentOptions（provider/model/reasoningEffort/maxTokens）**：写入子的 `AgentOptions` 并记入请求头（requestHeader config，见 `dsh-agent-loop/lib/index.js:1171-1176` 将 reasoningEffort/maxTokens 应用到每个请求头）。子会话正文不回显；只能间接感知（模型自我认知、max-tokens 截断行为）。maxDepth/subagentDepth 无注入。
- **权限/sandbox 继承**：`captureDelegatedPolicyOverrides(parent)`（`lib/index.js:535-542`）只捕获父的显式 sandbox override（auto/danger-full-access preset + `sandboxPolicy.overrideOf`），并把审批策略钉死为 `'never'`；以 `source:'delegation'` 的 `sandbox/mode`、`approval/policy`、`permission/preset` 事件写进子日志（`appendDelegatedPolicyOverrides`，`lib/index.js:552-562`）。子感知方式是运行时上下文快照（如本会话开头的 "Current DSH file policy: danger-full-access" / "Approval prompts are disabled"）——这是宿主 runtime-context 机制，不是启动请求字段。
- **cwd 继承**：`childSessionMeta` 把父 header 的 cwd 带给子（`lib/index.js:474`）；子经 `pwd` 等可观测。

### 2.3 完全不可见（子会话无任何感知渠道）

- `label`（仅展示/编目用）。
- `signal`（纯宿主取消机制；中止时表现为 turn 被取消）。
- `maxDepth` 数值本身（只在超限抛错时以错误形式暴露给**父**，`SubagentDepthError`）。
- `descriptor`（持久化元数据，供冷恢复；不进子上下文）。
- 部署 config 的 `backgroundMode`/`toolName`/`enableRunInBackground`/`modelSelectionSettings`/`maxActiveSubagents`。
- **环境变量渠道：无证据**。在 `@deepseek-ai/dsh-subagent*` 全部文件中 grep `DSH_` 仅命中 typert 生成的 schema 标识符（`_deepseek_ai_dsh_subagent_...`），不存在向子进程/子会话注入 `DSH_*` 派发配置环境变量的代码。DSH_* 受管环境变量属于 shell 工具（dsh-tool-bash/pwsh README），与子会话派发无关。

---

## 3. 一次性（run_to_completion / one-shot）vs 可续（continuable）启动差异

```
--- /dsh/node_modules/@deepseek-ai/dsh-subagent/lib/typert.host.js:347
"declaration": "export interface ContinuableStartSpec {
    readonly provider: string;
    readonly label: string;              // 顶层必填
    readonly childId?: SessionId;        // 可指定稳定子 id
    readonly request: Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>;
    readonly signal: AbortSignal;        // 提到 spec 顶层
}"
```

| 维度 | one-shot（`ctx.subagents.start(provider, request)`） | continuable（`ctx.subagents.startContinuable(spec)`） |
|---|---|---|
| 请求字段 | 完整 SubagentStartRequest，含 `outputSchema`、`signal`、`label` | request 为 Omit<label/signal/outputSchema>：**无 outputSchema（不支持结构化输出）**，label/signal 上移到 spec |
| 生命周期 | 一轮一结果：`drivePublishedRun` 单次 followup + whenIdle + quiescent dispose（`dsh-subagent-in-process-driver/lib/index.js:195-229`） | 持久 Session + 至多一个进程内 Activation；Agent inbox 是唯一轮队列（`lib/index.js:1583-1587`） |
| 前台/后台 | `run_in_background: true` 走普通父属 job（`jobs.start({kind:"subagent"...})`，`dsh-tool-subagent/lib/index.js:534-555`）；默认前台等结果 | `run_in_background` 省略即默认 true，立即返回 `started subagent <childId>`；结算通知 + `send_message` 续派（`dsh-tool-subagent/lib/index.js:525-533`；README.md:58-60） |
| 持久化 | 不要求 sessionPersistence | **必须**有 `sessionPersistence`，否则 `PERSISTENCE_UNAVAILABLE`（`lib/index.js:1986-1989`） |
| childId | 随机 UUID（driver `lib/index.js:166`） | `spec.childId ?? randomUUID()`，可由调用方指定稳定 id（`lib/index.js:1677`） |
| seed | fork 提供方可带 seed（driver `options.seed`） | `host.prepareContinuable(provider, {sessionId, parent, signal})` 产 seed（`lib/index.js:1697-1701`） |
| 回报指引 | 无 | 有 send_message 父 id 指引（`lib/index.js:599-604,1738`） |
| 冷恢复 | 无 | descriptor 驱动 coldResume 重建 agentOptions/composition（`lib/index.js:1898-1940`） |
| 编目 | — | `establishCatalogChild` 写入父会话子代理编目（`lib/index.js:1743`） |

共同点：两条路径都走 `applyChildComposition`（persona/toolFilter/delegation 注入）与 `captureDelegatedPolicyOverrides`（driver `lib/index.js:169-176`；continuation `lib/index.js:1694`），深度解析/agentOptions 解析同源。

---

## 4. 温度、权限、作用域是否存在对应配置点（grep 证据）

### 4.1 温度：**不存在派发级配置点**
- `grep dsh-subagent/lib/index temperature` → 0 hits；`grep "dsh-subagent-in-process-driver|dsh-tool-subagent" temperature` → 0 hits。
- `AgentOptions`（1.2 节）无 temperature。
- temperature 只存在于 LLM 层通用类型：
  ```
  --- /dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js:313
  GenerateOptions { provider; model; reasoningEffort?; messages; system?; tools?; ...; temperature?: number; maxTokens?: number; ... }
  --- /dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js:341
  LlmCallConfig { provider; model; reasoningEffort?; temperature?: number; maxTokens?: number; stop?: string[] }
  ```
  但 `dsh-agent-loop`（把 AgentOptions 变请求头）只处理 reasoningEffort/maxTokens（`lib/index.js:1171-1176`），无 temperature 通路。结论：派发子会话**无法配置温度**；temperature 旋钮在宿主中未接入 subagent 链路。

### 4.2 权限：**无启动请求字段；存在隐式继承机制**
- SubagentStartRequest 无 permission/sandbox/approval 字段（1.1 节）。
- 唯一机制是 `captureDelegatedPolicyOverrides`（2.2 节摘录）：父的 auto/danger-full-access preset 与显式 sandbox override 继承，approval 钉死 `'never'`。即"权限旋钮"由父会话当时的权限状态决定，不是派发参数。

### 4.3 作用域（scope）：**存在两类作用域旋钮**
- 工具作用域：`toolFilter`（allow/deny）——SubagentStartRequest 字段，但只有部署 config 能设（1.4/1.6）。
- 权限作用域陈述：`SUBAGENT_DELEGATION_CONTEXT`（2.1）恒定注入，无参数。

### 4.4 其他 grep 词的结论
- `assignee`：`grep dsh-tool-subagent assignee` → 0 hits。宿主派发层无 assignee 概念（该词只属于本树引擎的 tree_dispatch 工具参数，非宿主旋钮）。
- `scope`：宿主侧体现为 cordis scope 链 + 上述 toolFilter/delegation 机制。
- `sandbox`/`permission`：仅在 `captureDelegatedPolicyOverrides`/`appendDelegatedPolicyOverrides` 及 shell 工具的 `sandbox_permissions` 工具参数中出现；后者是命令工具旋钮，不是子会话派发旋钮。

---

## 5. 结论速览

1. 宿主派发子会话的请求级旋钮共 9 字段（label/prompt/parent/signal/agentOptions/outputSchema/maxDepth/toolFilter/persona）+ 内部 descriptor；模型直接可传的只有 description/prompt/provider/model/reasoning_effort/run_in_background；persona、toolFilter、maxDepth、agentOptions(部分)、outputSchema 只能由部署 config 或程序化调用方设置。
2. 子会话可感知：persona 原文、结构化输出指令、continuable 父 id 指引、恒定 delegation 声明、prompt；间接感知：toolFilter（工具面）、agentOptions（行为/请求头）、权限继承（runtime-context 快照）、cwd；不可感知：label、maxDepth 数值、signal、descriptor、全部部署 config 字段。无 DSH_* 环境变量注入渠道（grep 0 证据）。
3. one-shot 支持 outputSchema 且单轮；continuable 剥离 label/signal/outputSchema、必填 label+childId 可指定、强制持久化、冷恢复与 send_message 结算。
4. 温度：无派发配置点（仅 LLM 层类型存在）；权限：无请求字段、仅父状态隐式继承且审批钉死 never；作用域：toolFilter（部署级）+ 恒定 delegation 声明。

证据文件（原为本仓库本地抽取副本，便于复核）：

> ⚠️ **公开仓说明（2026-11-11，决策 D7）**：下列 6 个「DSH 第三方源码全文摘录」文件**已从公开仓库及其 git 历史中移除**（避免再分发第三方源码），原件保存在维护者本机
> `default-workspace/backups/public-release-privacy-2026-11-11/`，不入库。本笔记中的 `@deepseek-ai/...` 包路径 + 行号即复现依据；
> 提取工具 `demo/agspec/_extract.cjs`（自写代码）保留在仓内。
>
> - `demo/agspec/_subagent-index.js`（= `@deepseek-ai/dsh-subagent/lib/index.js` 全文）— 已移除
> - `demo/agspec/_tool-subagent.js`（= `@deepseek-ai/dsh-tool-subagent/lib/index.js` 全文）— 已移除
> - `demo/agspec/_tool-subagent.md`（= 该包 README）— 已移除
> - `demo/agspec/_driver.js`（= `@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js`）— 已移除
> - `demo/agspec/_spawn.js`（= `@deepseek-ai/dsh-subagent-spawn-in-process/lib/index.js`）— 已移除
> - `demo/agspec/_fork.js`（= `@deepseek-ai/dsh-subagent-fork-in-process/lib/index.js`）— 已移除
