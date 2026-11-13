# [平台 Issue 草稿] 子会话路由切换时 `maxTokens` 无条件继承父会话：小上限供应商首请求即 400

> **状态：已提交官方（2026-11-13 20:22，用户批准）** —— deepseek-ai/deepseek-harness Discussions **[#13208](https://github.com/deepseek-ai/deepseek-harness/discussions/13208)**（公开版已脱敏：本机路径/会话 id 以占位符表示；本文件保留为内部完整版，§9 证据路径为本机真实路径）。
> 起草：D24-FLOW-M12-PILOT 会话（2026-11-13）。
> 建议严重度：**P2**（跨模型派发/异族交叉复核不可用；有绕行，但会浪费会话与 turn，且错误语义误导）。
> 同批另一份：[ISSUE-draft-hmr-reload-race.md](ISSUE-draft-hmr-reload-race.md)（HMR 重载与工具准入，[#13207](https://github.com/deepseek-ai/deepseek-harness/discussions/13207)）。

---

## 1. 一句话

DSH desktop **0.2.2-rc.1** 的 `subagents.startActivation` 系列在「只改路由（provider/model）、不显式传 `maxTokens`」时，会把父会话的 `maxTokens`（本机 **384000**）原样继承给子会话；目标模型输出上限为 **131072** 的供应商（本机实测：`zai-coding-cn/glm-5.3`、`xiaomi/mimo-v2.6-pro`）**首个请求即 400**，子会话在 turn 1 就死掉，而派发调用本身返回「成功 → running」，诊断信息只在子会话日志里。

## 2. 环境（FACT）

| 项 | 值 |
|---|---|
| 宿主 | DSH desktop runtime **0.2.2-rc.1**；`@deepseek-ai/dsh-subagent` **0.2.2-rc.1**、`@deepseek-ai/dsh-tool-subagent` 0.2.2-rc.1 |
| 父会话路由 | `opencode-go/deepseek-v4.1-flash`，`reasoningEffort=max`，**`maxTokens=384000`**（Lead 会话 `session-4f881251-…` 的 `request/header` 原文） |
| 目标供应商（失败） | `zai-coding-cn`（glm-5.3 系列）；`xiaomi`（mimo-v2.6-pro）—— 两者输出上限 **131072**（错误原文自报） |
| 目标供应商（成功） | `deepseek-official`、`opencode-go`（本机实测接受 384000） |
| 派发入口 | 本仓 `tree_dispatch`（`assignee:{provider,model,effort}`，无 `maxTokens` 字段）→ 宿主 `subagents.startActivation` |
| OS | Windows x64；宿主内置 Node v24.x |

## 3. 现象（FACT，会话日志原文）

Lead 会话 `session-4f881251-b7c9-4da1-9614-fbc762c0e7df`（父）派发同一 leaf `d23x-A2-treelog` 的三次尝试：

| # | 派发时间（UTC，seq） | assignee | 子会话 | 子会话 `request/header.config` | 结果 |
|---|---|---|---|---|---|
| 1 | 07:48:26.123（seq 199） | `zai-coding-cn` / `glm-5.3` / effort `high` | `93279331-9ef6-4d69-afc9-e4475668975f`（created 07:48:26.130） | `{maxTokens:384000, provider:"zai-coding-cn", model:"glm-5.3", reasoningEffort:"high"}` | **turn 1 失败** |
| 2 | 07:49:53.565（seq 281） | `xiaomi` / `mimo-v2.6-pro` / effort `high` | `d4dcf70e-de2f-4660-b8e9-fdb4d5a5c9c9`（created 07:49:53.577） | `{maxTokens:384000, provider:"xiaomi", model:"mimo-v2.6-pro", reasoningEffort:"high"}` | **turn 1 失败** |
| 3 | 07:51:46.306（seq 331） | `deepseek-official` / `deepseek-flash` / effort `max` | `4c9e4134-…`（created 07:51:46.321） | `{maxTokens:384000, provider:"deepseek-official", model:"deepseek-flash", …}` | **completed** ✅ |

### 3.1 原始错误（子会话 `turn/end` 原文）

尝试 1（`93279331…`，`turn/end` seq 19）：

```text
{"data":{"turn":1,"reason":{"kind":"error","error":{"message":"400: {\"code\":\"1210\",\"message\":\"max_tokens参数非法：限制数值范围[1,131072]\"}","code":"INVALID_REQUEST"}}}}
```

尝试 2（`d4dcf70e…`，`turn/end` seq 19）：

```text
{"data":{"turn":1,"reason":{"kind":"error","error":{"message":"400: {\"code\":\"400\",\"message\":\"Param Incorrect\",\"param\":\"max_completion_tokens is too large: 384000. This model supports at most 131072 completion tokens, whereas you provided 384000.\",\"type\":\"\"}","code":"INVALID_REQUEST"}}}}
```

### 3.2 调用方看到什么（误导性）

- `tree_dispatch` 工具返回：`tree_dispatch: d23x-A2-treelog → running`（**成功**）——派发阶段不校验路由能力。
- 随后宿主注入通知：`Background subagent 93279331-… failed before it finished. It left no closing message.`（Lead 会话 seq 204/211）。
- 具体 provider 错误只在**子会话日志**可见；调用方需自行解码会话日志才能定位，易误判为「子会话模型不听话/任务书问题」。
- 证据：Lead 会话 seq 198/199（第一次 dispatch 调用参数）、seq 200（`subagent/catalog` childId）、seq 281（第二次 dispatch，prompt 内已写明「第 1 次因模型通道 max_tokens 限制失败」）、seq 331（第三次成功派发）。

## 4. 复现步骤（可操作）

前置：父会话 `request/header.config.maxTokens` > 131072（本机缺省 384000）。

1. 在父会话调用（本仓工具面）：

   ```text
   tree_dispatch {action:"start", tree_id:"<已存在的树>", leaf_id:"<已存在 leaf>",
                  assignee:{provider:"zai-coding-cn", model:"glm-5.3", effort:"high"}}
   ```

2. 观察：工具返回 `… → running`；数秒后收到 `Background subagent <id> failed before it finished` 通知。
3. 解码子会话日志确认 `request/header.config.maxTokens` 与 `turn/end.reason.error`（多帧 zstd；可用本仓 `scripts/skill-e2e/lib.mjs#decodeSessionLog`，或等价脚本）：

   ```powershell
   # 以本仓只读解码器为例（node ESM）
   node -e "import('./scripts/skill-e2e/lib.mjs').then(m=>{const r=m.findSessionLog('<childSessionId>',{workspaceEncoding:'--D-Codes-dsh-tree-harness--'});const d=m.decodeSessionLog(r.file);console.log(d.events.filter(e=>e.type==='request/header'||e.type==='turn/end').slice(0,3).map(e=>JSON.stringify(e.data).slice(0,400)).join('\n'))})"
   ```

4. 期望：错误原文如 §3.1；把 assignee 换成 `deepseek-official`/`opencode-go` 的模型即可成功（应用层绕行）。
5. 旁证：同一父会话下 `opencode-go/qwen3.8-flash`、`deepseek-official/deepseek-v4-pro`、`deepseek-official/deepseek-flash` 的子会话 `maxTokens=384000` 均 **completed**（`07927fbd`/`f8d73fe7`/`4c9e4134`），说明问题由**目标模型上限**触发，而非 384000 本身非法。

## 5. 根因（代码定位，FACT）

`@deepseek-ai/dsh-subagent@0.2.2-rc.1` `lib/types/child-agent.js`：

- `:49-62` `parentAgentOptionsForDelegation(parent)`：从父 `requestHeader().config` 取 `provider/model/reasoningEffort`，并**保留 `parent.options` 里的 `maxTokens`**（`createdOptions`）。
- `:74-92` `resolveChildAgentOptions(parent, requested, childDepth)`：
  - `:84` `...parentMaxTokens !== undefined ? { maxTokens: parentMaxTokens } : {}` —— **无条件继承父 maxTokens**；
  - `:88-90` `routeChanged = resolved.provider !== parentProvider || resolved.model !== parentModel; if (routeChanged && requested?.reasoningEffort === undefined) delete resolved.reasoningEffort`
    —— 路由变更时**只清理 reasoningEffort，不清理 maxTokens**（语义不对称）；
  - `:85` `...requested` 可覆盖，说明调用方显式传 `maxTokens` 时可规避（本仓 `tree_dispatch` 目前不传，见 `packages/dsh-tree-engine/index.js:126-139`）。
- 缺失的环节：宿主没有把 `maxTokens` 与「目标模型输出上限」做一致性校验/钳制；`dsh-tool-subagent` 的 `preflightChildLlmRoute()`（`lib/index.js:113-130`）只预检路由可用性，不校验 maxTokens。
- 注：`dsh-tool-subagent` 的 `agentOptions` schema **已暴露 `maxTokens`**（`lib/index.js:306-310`），说明平台已有透传通道，只是 `startActivation` 的继承逻辑没有区分「换了路由」的情况。

## 6. 影响面

- **跨模型/异族派发不可用**：本机 `zai-coding-cn`（glm-5.3 系列）与 `xiaomi`（mimo-v2.6-pro）全部失败；项目纪律要求「实现与复核异族」（复核需用不同模型）直接受阻。
- **浪费**：本次 2 次失败派发 = 2 个会话 + 约 3.5 分钟（含诊断），并使任务书 prompt 里出现「第 1 次因模型通道失败」的噪声。
- **误导性**：派发返回成功、错误只在子会话日志中；如果没有会话日志解码能力，调用方无法区分「模型/任务失败」与「平台路由参数失败」。
- **影响所有 `startActivation` 调用方**（tree-engine、flow 插件、session-handoff 等）——只要「改路由不传 maxTokens」就会命中；反过来，`subagent` 工具路径因暴露 `agentOptions.maxTokens`，可由调用方自行规避。
- 失败与目标模型上限绑定：任何 output-token cap < 父 maxTokens 的供应商都会复现。

## 7. 建议修复（供宿主考核）

- **A（推荐，最小且与既有意图一致）**：`resolveChildAgentOptions` 中，`routeChanged && requested?.maxTokens === undefined` 时**删除继承来的 `maxTokens`**（与 `reasoningEffort` 处理对称），让目标模型用自身默认输出上限。效果：跨路由派发不再携带父上限；同路由子会话行为不变。
- **B（更完整）**：按目标模型的 output-token cap 钳制（host 侧模型元数据已有候选输出上限字段——模型列表接口会归一化 `output-token cap`），即 `min(parentMaxTokens, targetCap)`；需要对 `startActivation` 增加一次模型能力解析（可复用 `preflightChildLlmRoute` 的位置）。
- **C（调用方临时绕行，不改宿主也可用）**：① 使用 `subagent` 工具并显式传 `agentOptions.maxTokens`（≤目标上限）；② 本仓可在后续小版本允许 `tree_dispatch.assignee.maxTokens` 透传（`packages/dsh-tree-engine/index.js:126-139` 加一个可选字段），但这是**应用层绕行**，其他 `startActivation` 调用方仍会踩坑。
- **D（诊断兜底）**：`startActivation` 在子会话首个请求因 provider 参数错误失败时，把 provider 错误摘要回传到派发工具的 `tool/result`/通知中（当前只有「failed before it finished」），减少盲诊断。

## 8. 风险与替代

- A 的副作用：路由变更后子会话输出上限回落到目标模型默认值（通常正是期望行为）；若调用方确实想指定，可显式传 `maxTokens`（`requested` 覆盖路径仍在）。
- B 的副作用：需要模型元数据在 startActivation 时可解析；若供应商未声明上限则回退 A 或保持现状（保守）。
- 若宿主暂不修：必须在 HMR/组合编排文档写明「跨 provider/model 派发必须显式指定 `maxTokens`」，并在工具层对已知小上限供应商做默认值映射（应用层硬编码，不推荐）。

## 9. 证据路径

| 证据 | 路径 |
|---|---|
| 子会话 1（glm-5.3） | `%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\93279331-9ef6-4d69-afc9-e4475668975f\session.v4.jsonl.zstd`（`session.createdAt=07:48:26.130Z`、`request/header`、`turn/end` seq 19） |
| 子会话 2（mimo-v2.6-pro） | `%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\d4dcf70e-de2f-4660-b8e9-fdb4d5a5c9c9\session.v4.jsonl.zstd`（created 07:49:53.577Z、`turn/end` seq 19） |
| 成功对照（3 个） | `07927fbd`（opencode-go/qwen3.8-flash）、`f8d73fe7`（deepseek-official/deepseek-v4-pro）、`4c9e4134`（deepseek-official/deepseek-flash），均 `maxTokens=384000` 且 `turn/end completed` |
| 父会话派发链 | `%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\session-4f881251-b7c9-4da1-9614-fbc762c0e7df\session.v4.jsonl.zstd`（seq 198/199/200/204/211/281/331） |
| 本仓派发代码（不传 maxTokens） | `packages/dsh-tree-engine/index.js:126-139`（`agentOptions` 仅 provider/model/effort） |
| 本仓历次记录 | [docs/reports/composition-pilot-v3-depth-cap-2026-11-13.md](../reports/composition-pilot-v3-depth-cap-2026-11-13.md) §6 新发现②；[docs/operations/progress-map-2026-11-13.md](progress-map-2026-11-13.md)（平台侧边界） |
| 宿主代码（asar 只读摘录） | `dsh-subagent/lib/types/child-agent.js:49-92`；`dsh-tool-subagent/lib/index.js:60-130,306-310`；`dsh-tool-subagent/README.*`（agentOptions/maxTokens 契约） |

## 10. FACT / INFERENCE / UNKNOWN

- **FACT**：两次 400 的原文、时间、父/子路由与 `maxTokens` 值；子会话 `request/header` 证实继承 384000；`reasoningEffort` 被 assignee 正确覆盖为 `high`（说明路由字段覆盖机制生效，唯独 maxTokens 未处理）；三次派发均同一 leaf；第三（deepseek-official）成功；父会话 `request/header.maxTokens=384000`。
- **INFERENCE**：根因是 `resolveChildAgentOptions` 对 `maxTokens` 的「无条件继承 + 路由变更不清理」；`dsh-tool-subagent` 工具路径同样会继承（其 `requested` 未含 maxTokens 时），但**本轮未实测该路径**（仅 tree_dispatch 路径复现）。
- **UNKNOWN**：① 其他供应商/模型的确切 output cap 清单（本轮仅由错误原文知 131072）；② `subagent` 工具路径是否同样复现（未做对照实验）；③ 宿主是否有意在路由变更时保留 maxTokens（若是设计决策，文档化缺失也需修正）。
