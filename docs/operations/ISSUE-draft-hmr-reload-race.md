# [平台 Issue 草稿] HMR 热重载替换工具注册：在途步骤对已注册工具的调用被判 `UNKNOWN_TOOL`

> **状态：已提交官方（2026-11-13 20:22，用户批准）** —— deepseek-ai/deepseek-harness Discussions **[#13207](https://github.com/deepseek-ai/deepseek-harness/discussions/13207)**（公开版已脱敏：本机路径/会话 id 以占位符表示；本文件保留为内部完整版，§9 证据路径为本机真实路径）。
> 起草：`D24-FLOW-M12-PILOT` 会话（2026-11-13）。
> 建议严重度：**P2**（开发态 `hmr.root` 热更路径；发布物与非热更运行不受影响，但会造成工具面瞬态失败、审计误判和重试成本）。
> 同批另一份：[ISSUE-draft-max-tokens-inheritance.md](ISSUE-draft-max-tokens-inheritance.md)（跨模型 `maxTokens` 继承，[#13208](https://github.com/deepseek-ai/deepseek-harness/discussions/13208)）。

---

## 1. 一句话

DSH desktop **0.2.2-rc.1** 在 `hmr.root` 热重载插件时，旧插件实例的 ctx disposer 移除其工具层、新实例随后注册新层；若某个模型步的 **tool admission 快照**跨越了这次替换，该步内对同名工具的调用会被 `dsh-tools` 的准入守卫判为 **`UNKNOWN_TOOL`**（模型侧文本 `Error: unknown tool "<name>"`），尽管该工具实际上已（重新）注册、下一个模型步立即可用。

## 2. 环境（FACT）

| 项 | 值 |
|---|---|
| 宿主 | DSH desktop runtime **0.2.2-rc.1**（`app.asar` 内 `dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime` 0.2.2-rc.1） |
| 关键包 | `@deepseek-ai/dsh-tools` 0.2.2-rc.1、`@deepseek-ai/dsh-hmr` 0.2.2-rc.1、`@deepseek-ai/dsh-subagent` 0.2.2-rc.1 |
| profile | `desktop`；`cordis.patch.yml` 的 `hmr.root` 含 `D:/Codes/dsh-tree-harness/packages`（开发态） |
| 插件（受害者） | `@orphiczhou/dsh-tree-engine` v0.8.1（本地 HMR 源，9 个 `tree_*` 工具）；同窗口还有 `dsh-session-tree` 等插件 |
| 触发动作 | 多子会话并行修改 `packages/dsh-tree-engine/**`（源码/测试/文档），宿主连续 HMR 重装插件 |
| OS / Node | Windows x64；宿主内置 Node v24.x |

## 3. 现象（FACT，全部为会话日志原文）

### 3.1 调用方拿到的错误

会话 `a3624bf7-0735-40ae-9c47-03b71bf91f0f`（tree `t3c7` 的 C1 指挥官，`delegationDepth=1`）的 `tool/result` 原文：

| seq | 时间（UTC） | 原文 |
|---|---|---|
| 194 | 2026-11-13T07:56:07.164Z | `Error: unknown tool "tree_node"` |
| 204 | 2026-11-13T07:56:20.083Z | `Error: unknown tool "tree_node"` |
| 212 | 2026-11-13T07:56:29.742Z | `Error: unknown tool "tree_report"` |

Lead 会话 `session-4f881251-b7c9-4da1-9614-fbc762c0e7df` 在同一窗口共 **15 次**同类错误（`tool/result`）：

| seq | 时间（UTC） | 工具 |
|---|---|---|
| 439 / 441 / 443 | 07:56:13.018 / .026 / .033 | `tree_status` ×3（同一步并行调用） |
| 453 | 07:56:21.557 | `tree_status` |
| 465 / 467 / 469 | 07:56:37.242 / .252 / .260 | `tree_status` ×3 |
| 483 / 485 / 487 | 07:56:53.580 / .588 / .596 | `tree_doctor` ×3 |
| 509 | 07:57:14.052 | `tree_status` |
| 521 / 523 / 525 | 07:57:30.534 / .543 / .552 | `tree_node` ×2 + `tree_log` |
| 757 | 08:08:10.628 | `tree_node` |

**恢复方式**：同会话下一次调用即成功（`a3624bf7` seq 194 失败 → seq 199（07:56:10.253）同一 `tree_node` 成功；seq 212 `tree_report` 失败 → seq 217（07:56:36.214）成功）。即**错误是瞬态的、可重试的**。

### 3.2 与热重载窗口的时间相关性（FACT）

tree-engine 自带诊断日志 `%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\apply.log` 显示 2026-11-13 15:56 连续重载（本地时间 = UTC+8）：

| apply 轮次（本地时间） | 之后的 `unknown tool`（本地时间） | 间隔 |
|---|---|---|
| 15:56:06.462 | 15:56:07.164（tree_node） | +0.70 s |
| 15:56:19.735 | 15:56:20.083（tree_node）、15:56:21.557（tree_status） | +0.35 s / +1.82 s |
| 15:56:29.213 | 15:56:29.742（tree_report） | +0.53 s |
| 15:56:52.632 | 15:56:53.580（tree_doctor ×3） | +0.95 s |
| 15:57:1x–15:57:3x 继续重载 | 15:57:14 / 15:57:30 批次 | 同窗口 |

`apply.log` 统计（`apply() entered` 计数）：**2026-11-13 当日 35 次 apply**（35 次 complete，对称）；**32 条 `previous sweep disposed (hot-reload zombie)`**（说明同一天存在多次旧实例残留/接替）。全日志累计 133 次进入 / 132 次完成（1 次无对应完成行，发生在 11-11 批次，非本日窗口）。

> 计数口径更正：D23 试点 v3 报告 §6 写的「当日 113 次 apply」为误计（`apply` 相关行数而非 `apply() entered` 次数）；实测为 **35 次**。本文件以实测为准。

### 3.3 apply.log 顺序异常（FACT，旁证注册序列非原子）

2026-11-13 有 **13 次** `apply complete: 9/9 registered` 与同一毫秒的 `register OK: tree_*` 交错（完成行先于部分注册行），例如：

```text
2026-11-13T07:57:11.660Z apply complete: 9/9 registered
2026-11-13T07:57:11.660Z register OK: tree_log
2026-11-13T07:57:11.660Z register OK: tree_doctor
```

```text
2026-11-13T08:08:26.005Z apply complete: 9/9 registered
2026-11-13T08:08:26.005Z register OK: tree_log
2026-11-13T08:08:26.005Z register OK: tree_verify
2026-11-13T08:08:26.005Z register OK: tree_doctor
2026-11-13T08:08:26.005Z register OK: tree_maintain
```

（说明：不同 apply 轮次的日志在同一毫秒交错，或同一轮 apply 的注册回调异步落到完成点之后。）

## 4. 复现步骤（可操作）

前置：profile `cordis.patch.yml` 的 `hmr.root` 已包含插件包目录（本机即 `D:/Codes/dsh-tree-harness/packages`）；桌面宿主已启动且插件 active。

1. 开一个会话，循环调用 `tree_status {action:"overview"}`（每 300–500 ms 一次，持续约 30 s，可用同一模型步内多次工具调用模拟）。
2. 并行（另一进程/另一会话）对插件包做**两次无害写入**，触发连续 HMR 重载：

   ```powershell
   $f = 'D:\Codes\dsh-tree-harness\packages\dsh-tree-engine\index.js'
   $original = [IO.File]::ReadAllText($f)
   Add-Content -LiteralPath $f -Value "`n"; Start-Sleep -Milliseconds 400
   # 再改回（避免污染工作树）
   [IO.File]::WriteAllText($f, $original, [Text.UTF8Encoding]::new($false))
   ```

   （任何会触发模块重载的写入均可；不要改代码语义。改完务必恢复并 `git status` 确认 clean。）
3. 期望：循环中的调用出现 `Error: unknown tool "tree_status"`；同窗口 `apply.log` 出现多条 `apply() entered`。重试即恢复。
4. 取证命令：

   ```powershell
   $log = "$env:USERPROFILE\.dsh\profiles\desktop\tree-engine-data\apply.log"
   (Get-Content $log | Where-Object { $_ -match '^2026-11-13T.*apply\(\) entered' }).Count          # 当日重载次数
   (Get-Content $log | Where-Object { $_ -match '^2026-11-13T.*hot-reload zombie' }).Count          # 旧实例残留处置次数
   ```

   会话日志为多帧 zstd（`<DSH_HOME>\sessions\<workspace>\<sessionId>\session.v4.jsonl.zstd`），可用本仓只读解码器
   `scripts/skill-e2e/lib.mjs#decodeSessionLog` 或等价脚本读取 `tool/result` 的 `content[0].text`。

## 5. 根因（代码定位，FACT）

1. **插件注册工具绑定插件 ctx 生命周期**：`@deepseek-ai/dsh-tools@0.2.2-rc.1` `lib/index.js:433-445` `register()` 返回
   `this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, {...}))` —— 注册进「调用方 ctx 的层」，插件 ctx dispose 时该层被移除。
   本仓插件调用点：`packages/dsh-tree-engine/index.js:1015` `services.tools.register(tool)`（9 个工具）；`:1000-1009` 挂 `ctx.on('dispose')`。
2. **模型步的工具准入快照按注册对象身份校验**：`dsh-tools/lib/index.js:542-572` `resolve(context)` 把当前 visible 工具做成 `admitted` 快照；
   `:564-570` 的 `toolSet.view(scope)` 只在 **`current.visible.get(name) === definition` 且 `current.registrations.get(name) === view.registrations.get(name)`** 时返回该工具
   —— 即「同名但被重新注册（新对象）」也会被剔除。
3. **执行侧据此报 UNKNOWN_TOOL**：同文件 `:530-534` `executable()` 返回 undefined；`lib/shared-DTdn5dXO.js:575-586` `ToolNotFoundError`
   （`code:"UNKNOWN_TOOL"`，message `unknown tool "<name>"`；`:583`）。
4. **hot reload 恰好制造了「同名新对象」**：卸载 → 重新 apply → `register()` 产生新 registration 对象；跨重载的模型步因此命中第 2 条的身份不等。
5. 旁证：`dsh-hmr` 自身有串行 reload 队列（`@deepseek-ai/dsh-hmr/lib/index.js` 注释「Serialized module and profile-configuration reloads」、`runReload`），
   但**在途模型步不会因 reload 而暂停**，dispose/register 与模型步之间没有「排空（drain）」或「可重试」语义。

## 6. 影响面

- **工具面瞬态失败**：任何通过 `tools.register` 注册工具、且处于 `hmr.root` 开发态的插件（本次为 tree-engine 9 个工具；同机制对 `session_handoff` 等工具历史上也出现过，见 `docs/reports/skill-e2e-2026-11-11.md` §8 第 241 行记录）。
- **误判风险**：错误文案是 `unknown tool`（通常表示「没有这个工具/配置错误」，不可重试语义），实际是热更竞态（可重试）→ 模型可能采取错误的降级/绕行；审计会话可能把平台问题记成插件缺陷。
- **成本**：重试消耗额外 turn；本次单个窗口内 2 个会话共 18 次失败调用（另 1 次 `bash` 未知工具，未确认同因）。
- **不涉及**：发布物（非 HMR 运行）、生产 profile（无 `hmr.root` 变更）——影响面限于本机开发态。

## 7. 建议修复（供宿主考核）

- **A（推荐，最小语义改动）**：把「因热重载导致的注册替换」与「真的没有该工具」区分开。`dsh-tools` 在 `executable()` 失败时，若
  该名字在**本步快照里存在但当前 registration 已换对象**（热重载典型特征），返回**可重试**错误码（如 `E_TOOL_REGISTRY_RELOADED`/`retryable:true`），
  由 agent-loop 对该工具调用自动重试一次（短延迟），或至少让模型看到「插件正在热更，请重试」。
- **B（体验最优，实现稍重）**：HMR 卸载**等待在途步骤排空**再 dispose（或至少在 dispose 前广播 `tools/change` 并等待当前 tool batch settle），
  即「旧注册对象保持可用直到无人引用」；Cordis 的 effect/层机制可支持引用计数式延迟回收。
- **C（插件侧兜底，不解决根因）**：插件在 `apply()` 中幂等注册（同名覆盖），并在 dispose 前等待本实例在途调用结束——只能减少窗口，不能消除宿主在途步骤的快照失效。
- **D（文档/诊断）**：在 HMR 文档中写明「热重载会使在途步骤的工具准入失效」；`apply.log` 增加 reload 起止与在途步骤信息，便于诊断。

## 8. 风险与替代

- 若宿主不做改动，短期规避（已在项目内执行）：改动收敛后做**受控 disable→enable**；HMR 频繁改动期间避免长轮询/并行工具调用，失败按「重试一次」处理。
- A 方案风险：区分「热重载导致的替换」与「插件主动重新注册工具」需要额外元数据（注册来源/版本），实现时建议由 `dsh-hmr` 在 reload 期间设置短暂标记（如 `tools.reloading` 计数），而不是猜时间窗。
- B 方案风险：排空等待可能延长 reload 时间；需设上限（超时后照常 dispose 并接受瞬态失败）。

## 9. 证据路径

| 证据 | 路径 |
|---|---|
| apply.log（重载计数/僵尸/交错） | `%USERPROFILE%\.dsh\profiles\desktop\tree-engine-data\apply.log`（2026-11-13 段；本文件 §3.2 统计为当日实测） |
| 会话 `a3624bf7…`（3 次错误 + 恢复） | `%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\a3624bf7-0735-40ae-9c47-03b71bf91f0f\session.v4.jsonl.zstd`（seq 194/204/212；199 恢复） |
| Lead 会话（15 次错误） | `%USERPROFILE%\.dsh\sessions\--D-Codes-dsh-tree-harness--\session-4f881251-b7c9-4da1-9614-fbc762c0e7df\session.v4.jsonl.zstd`（seq 439–525、757） |
| 本仓既有记录（同一现象首次登记） | [docs/reports/composition-pilot-v3-depth-cap-2026-11-13.md](../reports/composition-pilot-v3-depth-cap-2026-11-13.md) §6 新发现①（含计数口径更正） |
| 历史同类记录 | [docs/reports/skill-e2e-2026-11-11.md](../reports/skill-e2e-2026-11-11.md) §8 第 241 行（`unknown tool tree_node`，当时登记为待观察） |
| 宿主代码（asar 只读摘录） | `dsh-tools/lib/index.js:433-445,530-534,542-572`；`dsh-tools/lib/shared-DTdn5dXO.js:575-586`；`dsh-hmr/lib/index.js`（串行 reload 队列） |

## 10. FACT / INFERENCE / UNKNOWN

- **FACT**：上述错误文本、seq、时间、工具名；apply.log 计数（35/32/13）与交错原文；错误均在 apply 后 0.3–2 s 内出现；同会话重试即恢复；宿主 `dsh-tools` 的准入守卫代码按 registration 对象身份校验（`:564-570`）。
- **INFERENCE**：错误由「hot reload 替换工具注册对象 → 跨重载模型步的快照身份失配」导致（代码路径与时序均吻合；未用宿主单测直接复现）。
- **UNKNOWN**：① 宿主侧是否已有排空/重试设计（未在 asar 内发现；未向宿主确认）；② `f3cbb828` 会话 2026-11-13T10:49:35Z 的 `unknown tool "bash"` 是否同因（未单独取证）；③ 精确触发条件（哪些 reload 会落在模型步内）依赖步长与 debounce=100 ms 的交互，未做参数化实验。
