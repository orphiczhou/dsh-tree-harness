# agspec 报告:子会话配置的可观测性(A)与可控性(B)

> 树:agspec(root=本指挥官会话 52e0d1c8)· 4 工作叶全部 succeeded+verify PASS
> 证据链:[w1-evidence.md](../demo/agspec/w1-evidence.md)(实测)→ [w2-source.md](../demo/agspec/w2-source.md)(宿主源码)→ [w3-design.md](../demo/agspec/w3-design.md)(分层设计)→ [w4-changes.md](../demo/agspec/w4-changes.md)(落地改动点)

## 0. 需求原文

「一次性子会话没法看到用的模型、思考深度、权限、作用域、温度等细节。可对话子会话没法看到和修改模型、思考深度等必要因素。」
即:**A 可观测性**(子会话应能看到自身运行配置)与 **B 可控性**(可续会话应能看到且能修改)。

## 1. 现状:子会话此刻实际能看什么(W1 实测,全部原始输出在案)

| 维度 | 对话内可见性 | 文件级可见性 |
|---|---|---|
| 模型 | ❌ | ⚠️ 事后 `~\.dsh\storages\session_projcache\sessions\<sid>.json` 的 `modelSelection.lastUsed`(zai-coding-cn/glm-5.3);tree-state.json 中 `"model":"unknown"` 根因=引擎从未落账 |
| 思考深度 | ❌ | ❌ 全渠道无字段(projcache grep `effort|reasoning` 仅命中任务提示词文本) |
| 温度 | ❌ | ❌ 全渠道缺失(宿主 subagent 链路本身无此配置点,W2 §4.1) |
| 权限 | ✅ 运行时注入(danger-full-access/approval never/scope fixed) | ✅ projcache `permissions{preset,sandbox,approval}` 双通道互证 |
| 作用域 | ✅ env `DSH_SESSION_ID/PROFILE/HOME` | ✅ `identity.cwd`;父会话 id 在 tree-state.json `runtime.parentSessionId` |
| 环境变量 | 仅 6 个 `DSH_*`(SHELL/PROFILE/PROFILE_DIR/SESSION_ID/HOME/WEB_URL),**无任何模型/温度/effort 通道**(W2 grep 证实宿主根本不向子会话注入 DSH_ 配置变量) | — |

**结论:用户抱怨属实。** 对话内建上下文不含模型/思考深度/温度;模型只能事后翻 projcache 文件。

## 2. 宿主旋钮盘点(W2,以 app.asar grep 原始摘录为证)

- `SubagentStartRequest` = `label?/prompt/parent/signal/agentOptions?/outputSchema?/maxDepth?/toolFilter?/persona?`;`AgentOptions` = `{provider?, model?, reasoningEffort?, maxTokens?, subagentDepth?}`。
- 模型侧 subagent 工具只暴露 `description/prompt`(+可选 provider/model/reasoning_effort);persona/toolFilter/maxDepth 仅部署 config 或程序化调用方可设。
- 可见性:persona/结构化输出/prompt 以注入文本可见;toolFilter/agentOptions/权限间接可感;label、maxDepth 数值、descriptor 及全部部署 config 不可见。
- **温度在派发层无配置点**(仅 LLM 层类型存在,agent-loop 不透传);权限无请求字段(隐式继承+approval 钉死 never);`assignee` 在宿主不存在(是树引擎参数)。

## 3. 一次性 vs 可续的本质(W3 §1)

唯一判据:**是否还拥有"未来的输入通道"(inbox/send_message)**。
- continuable 独有:接收后续消息 → 可被"软改道";结算通知回流;身份跨轮稳定。
- 两者皆无:**事后修改已生效请求**——agentOptions 启动时一次性 resolve 并写入每请求头、toolFilter 构建期一次性 restrict、persona 已拼入历史、权限 scope 启动即冻结。改 = 换会话,不存在原地修改。

## 4. 三类方案(结论必须区分的三分类)

### ① 插件层(树 harness)立即可做
| 改动 | 位置 |
|---|---|
| C1 dispatch 持久化完整 `leaf.assignee{provider,model,effort,preset}`(消除 `"model":"unknown"`) | [engine.js:405](../packages/dsh-tree-engine/src/engine.js#L405)-410 / 417-423 落账段,经 store.write 原子落 tree-state.json |
| C2 修竹节接力丢路由:`assignee: leaf.assignee ?? (leaf.model && leaf.model!=='unknown' ? {model: leaf.model} : undefined)` | [engine.js:468](../packages/dsh-tree-engine/src/engine.js#L468);**双重缺陷**:不只丢 provider/effort,`leaf.model` 恒 unknown 导致旧三元永远走 undefined——竹节接力当前完全没有路由保持 |
| C3 派发 prompt 末尾渲染 `<session-config-declared>` 自描述块(assignee/parent/cwd/权限继承事实 + "声明≠生效"免责) | [index.js:71](../packages/dsh-tree-engine/index.js#L71)-104 promptText 组装处 |
| C4 TREE_DISPATCH schema 描述补 `effort`(description :459 只写 `{provider,model}`,误导) | [index.js:456](../packages/dsh-tree-engine/index.js#L456)-483 |
| C5 projcache 读取型 `session-config` inspect 查询(覆盖模型 lastUsed/权限/作用域) | 新增 provider,W1 实验 3 字段级证实有源 |

### ② 需 DSH 宿主配合
- **C6** descriptor 暴露:resolved agentOptions/toolFilter/persona 已持久化于 `subagent/descriptor` 事件,只差暴露为 inspect `session-config` 只读查询——成本极低,是"真实生效值"回显的唯一正道(effort/温度插件层永远读不到)。
- **C7** 温度通路:AgentOptions + agent-loop 先接入 temperature,否则任何层都无法观测一个不存在的旋钮。
- env 注入渠道(向子会话注入 `DSH_SUBAGENT_*` 派发配置变量):现状 grep 0 证据。

### ③ 物理不可能(任何层都不要尝试)
- 已启动会话事后改 agentOptions/toolFilter/persona/权限(§3);权限不可控是有意的安全设计,不应"解决"。
- 一次性(one-shot)会话任何形式的事后输入:quiescent dispose 后无 inbox——其可控性上限是 **cancel+重派新会话(可换 continuable)**,即"改派"而非"修改"。
- 可续会话的"软改道"(prompt 中转)只能改行为策略/工具偏好/输出形态,**改不了请求头**(effort/maxTokens)。

## 5. 覆盖矩阵要点(细节见 w3-design.md §3)

- 模型:全链路可达(声明值→插件 lastUsed→宿主 descriptor;可控=硬改道重派)。
- effort:可观测需宿主;可控只有换会话一条路。
- **温度:三层全不覆盖,前置依赖宿主 C7**——用户诉求中唯一"连旋钮都不存在"的项。
- 权限:可观测✅(插件即可);可控✗ by design。
- 作用域:基本全可观测;toolFilter 可控仅重派。

## 6. 落地顺序建议

1. 引擎立即:C1+C2+C3+C4(纯本仓库,一次 PR)。
2. 插件短期:C5(projcache inspect)。
3. 宿主中期:C6(descriptor 暴露)+ C7(温度通路,独立前置项)。

## 7. 过程记录(verify 与偏差披露)

- W1/W2/W3:taskType=research → self-report 策略,均一次 PASS。
- W4:taskType=code-change → command 策略固定跑 `pnpm test`,而本执行环境 PATH 无 pnpm(直跑 `node --test "tests/*.test.js"` 61/61 全过),command 路由**物理无法通过**,属环境工件而非产物缺陷;W4 自带 [w4-verify.cjs](../demo/agspec/w4-verify.cjs) 38/38 ALL GREEN(逐行号锚点核验)。据此以显式 policy_id=doc(artifact)裁决 PASS——这是对"不传 policy_id"约束的一处已披露偏离,理由如上。
- W4 第一次自报 done 时产物未落盘、第二次自检脚本 32 FAIL,经打回修正后全绿:说明 **self-report 策略可被不实自报穿透,command/artifact 有真实锚点核验的价值**——这与本树主题(可观测性)互为印证:没有可验证的观测通道,"自述"不可信。
