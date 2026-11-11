# 树仓缺陷报告（2026-10-17）：DSH 0.2.1-rc.2 升级后 `subagents` API 漂移导致真机派发即死

> 来源：Nanju 项目 live 全链路 E2E 首日真机派发（跨仓缺陷，由 Nanju 会话热修后报告）。
> 影响：`tree_dispatch start`（节点派发）、竹节接力（promptHandoff/interrupt）、`tree_verify adversarial`（judge 会话派发）在 **DSH desktop 0.2.1-rc.2** 下全部不可用。

## 1. 现象

```
Error: E_PORTS_PROTOCOL: ports.dispatch failed: services.subagents.startContinuable is not a function
```

宿主 `subagents` 服务（live cordis_inspect 实测）在 rc.2 只暴露：

- `startActivation(spec: SubagentActivationSpec & { childId? })` → `{ childId, messageId?, result, dispose }`
  - `spec = { provider, label, childId?, request: { prompt, parent, agentOptions?, agentPreset?, maxDepth?, outputSchema?, cwd? }, signal, delivery: 'parent'|'caller' }`
  - provider 名 `spawn`/`fork`（由 `@deepseek-ai/dsh-subagent-spawn-in-process` 等注册；`prepareContinuable` 存在 ⇒ 走本地 continuable 子会话）
- `interrupt(childSessionId, authority)`；`authority = { kind:'ancestor', agent } | { kind:'user', parentSessionId }`（旧 `{kind:'parent',parentSessionId}` 已废）
- `sendMessage(senderAgent, targetId, content[], { signal })` / `@Remote prompt(request, signal)`；旧 `subagents.prompt({requestId,parentSessionId,childSessionId,mode,delivery,content})` 不再是本地调用面
- 无 `startContinuable`

对照：树引擎 v0.4.0 的 `ports` 按旧契约实现（tree-engine/index.js `makePorts.dispatch/interrupt/promptHandoff` 与 `runAttackSession` 的 `startContinuable`），故 2026-10-17 20:11 桌面端升级到 rc.2 后全部失效。

## 2. 已做的热修（**需本仓正式合入 + 补测试**）

文件：`packages/dsh-tree-engine/index.js`（仅此文件，未改其他文件）

1. 新增模块级帮助函数：`resolveAgentsService` / `pickLiveAncestorAgent` / `startChildSession` / `interruptChildCompat`：
   - `startChildSession`：**双形探测**——`subagents.startContinuable` 存在则走 legacy（旧宿主行为不变），否则 `startActivation({provider,label,request:{prompt,parent,agentOptions},signal,delivery:'parent'})` 取 `childId`；两形都缺 fail-closed 报协议错。
   - `interruptChildCompat`：依次尝试 `{kind:'ancestor',agent}`（活父 Agent）、`{kind:'user',parentSessionId}`、legacy `{kind:'parent',parentSessionId}`。
2. `ports.dispatch` 改走 `startChildSession`（行为与旧一致：assignee → request.agentOptions）。
3. `ports.interrupt` 改走 `interruptChildCompat`。
4. `ports.promptHandoff`：有活父 Agent 时走 `sendMessage`，否则回退旧 `prompt(request, signal)`。
5. `runAttackSession`（adversarial judge）改走 `startChildSession`；裁决回收后的 interrupt 改走 `interruptChildCompat`。

## 3. 验证证据

- 本地：`node --test tests/engine.test.js tests/guards.test.js tests/verify.test.js` → 32/32 PASS（既有 mock-port 测试不覆盖该路径）。
- live（Nanju E2E，rc.2）：`tree_dispatch start` 由失败转为返回 running，子会话真实创建并完成（见 nanju 仓 `docs/live-e2e-report.md` §4/§5）。
- live adversarial：judge 会话真实派发并在约 198s 后写出裁决文件（`tree-engine-data/attack/livee2f_livee2f-W2-ux_advisor_r1.json`）——**旧观察“非 glm judge 启动即死”在 rc.2 + 本热修后已不成立**（仍超缺省 300s 边缘、且攻击目标受 artifact 错位影响）。

## 4. 仍需本仓处理

1. 正式合入上述兼容层，并补单测：fake `services.subagents` 覆盖 `startActivation` 分支、interrupt authority 顺序、sendMessage/legacy prompt 回退（mock-port 不会走这些分支）。
2. 与 rc.2 契约对齐后，考虑删除 legacy 分支（待旧宿主支持窗口结束）。
3. 关联树仓既有缺口：① `tree_verify {action:"run"}` 无 verify-on-succeeded 前置闸（Nanju E2E 实证：未派发棒也 PASS 落账）；② artifact 策略默认 cwd/字典序首匹配可命中 `node_modules`/scaffold README（nanju 侧 R5/R9）；③ P8 提案（adversarial 攻击目标改产物 diff / 最近结构通过之后的事件窗口）获得 live 直接证据。
