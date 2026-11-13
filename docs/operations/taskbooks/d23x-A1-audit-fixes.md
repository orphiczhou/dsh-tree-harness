# 任务书 A1：flash 审计三条高危修复（store 锁 / nudge 状态机 / leafAdd 白名单）

> 树 `d23x` leaf `d23x-A1-audit`（role=worker）· 派发人 Lead · 2026-11-13
> 你只做本任务书范围内的事。**不要 git commit / push / tag；不要用 plugin_manager 重载插件；不要改 agent.md / CHANGELOG / README / package.json 版本字段**（Lead 统一收口）。

## 0. 环境与纪律

- 工作区：`D:\Codes\dsh-tree-harness`（master，工作树 clean 基线；HEAD `5ce5893`）。
- 包：`packages/dsh-tree-engine/`（ESM，Node 24，无外部依赖）。
- 跑测试：`cd packages/dsh-tree-engine; node --test tests/*.test.js`（当前基线 **172/172 全绿**，20 个 `.test.js`；目录形参 `node --test tests` 会假失败，勿用）。
- 写文件用 `write`/`edit` 工具（UTF-8 无 BOM）；**禁止 PowerShell `Set-Content` 写代码**。改已加载包文件后宿主不会自动重载（属 Lead 的 D12 流程），你**不要**重载。
- 中文报告；FACT/INFERENCE 分明；每条结论附命令与原始输出摘要。
- 只允许改：`packages/dsh-tree-engine/src/store.js`、`packages/dsh-tree-engine/src/engine.js`、`src/lock.js`（可新建）、`tests/*.test.js`（新增为主；既有测试断言与新语义冲突时允许最小修改，须在报告中逐条说明）。
- **禁止**改 `index.js`、`src/guards.js`、`src/state.js`（如确需，先 tree_report blocked 说明，不要自行扩散）。

## 背景（审计原文，已由 Lead 核实）

来源 `docs/archive/flaudit-report.md`（33 条问题中的 3 条，严重级）：

- **#1（P0/严重）**：`src/store.js` 规约承诺的 `.lock` 文件锁与「临界区 readState→改→writeState 纯同步不得 yield」铁律未实现。当前只有 tmp+rename（防写撕裂，不防丢更新），`withTree` 临界区内全是 await 让出点，`src/queue.js` 仅单进程内互斥。跨进程（双宿主/热更双实例）并发读-改-写为裸 last-writer-wins，无 revision/CAS，丢失更新不可检测。
- **#7（严重）**：`src/engine.js` `nudgeAppend` 强制 prune 直接赋值 `leaf.status='pruned'`，不经 `assertTransition`；对已 `done`/`archived` 叶子累计 7 次 nudge 即静默打成 `pruned`（archived 语义上不可逆），下游依赖失配永久卡死，仅一条 drift 痕迹。
- **#19（高）**：`src/engine.js` `leafAdd` 无字段白名单——建点时用 `...leaf` 透传，可预注入 `runtime:{state:'succeeded'}` 绕过依赖闸、预置 `verification:{pass:true}` 伪造验证（`milestones/events` 虽已被后置默认覆盖，但契约上仍应显式白名单）。

## 任务 1：跨进程写安全（#1）

**目标**：同一 `fsStore` 根下，两个引擎实例（模拟双宿主/热更双实例）并发读-改-写不再丢失更新；锁必须在异常路径释放；进程崩溃留下的陈旧锁可安全接管。

**要求**：

1. 新增 `src/lock.js`（纯 Node fs，无 DSH 依赖）：`acquireTreeLock(dir, {staleMs, retryMs, timeoutMs})` / `releaseTreeLock(handle)` / 供测试的 `tryAcquire` 语义。实现要点：
   - `fs.open(lockPath, 'wx')` 原子创建（`O_EXCL`），失败即已被持锁 → 按 `retryMs` 退避重试至 `timeoutMs`；超时抛 `TreeStateError` + 明确 code（如 `E_TREE_LOCK_TIMEOUT`，message 含 tree_id 与 lock 路径）。
   - 锁内容写持有者元信息（`{pid, host, ts, nonce}`）；**陈旧锁接管**：锁文件 mtime（或内容 ts）超过 `staleMs`（缺省 15s）→ 删除后重试一次（记录）；接管需避免「两个接管者同时删」——用 rename 抢占（把 stale 锁 rename 到唯一临时名，成功者继续，失败者重试）。
   - `release` 在 `finally` 中调用；仅当内容 nonce 匹配才删除（防误删他人新锁）。
2. `src/engine.js` `withTree`：读-改-写绝对临界区必须持锁。做法建议：把「acquire → store.read → fn(state) →（fn 内部已 write）→ release」包起来（`store` 增加可选 `withLock(treeId, fn)` 端口，`fsStore` 实现文件锁、`memoryStore` 实现每树 promise 链互斥，保持旧端口向后兼容）。
3. 只读命令（`leaf:get`/`validate`/列表类）**不要**加锁（避免读阻塞）；只包写路径（`withTree` 被写命令共享——按现状统一加锁可接受，但要评估读路径是否共用该函数：若共用，请拆 `withTree`（只读直读）与 `withTreeMut`（持锁）两个入口，把写命令逐个改到 `withTreeMut`；这是本任务允许的必要重构）。
4. 单进程语义不得回退：现有 172 测试全绿。

**验收测试**（新增 `tests/store-lock.test.js`，尽量确定性、无真实长 sleep）：

- (a) 两个 `createEngine`（或等价装配）各自 `fsStore(同一 tmp 根)`，对同一 tree 各并发 20 次 `nudge:append`（或 event:append），最终 `nudge_count`（或事件数）== 40，证明无丢失更新；
- (b) 操作完成后 lock 文件不存在（正常释放）；
- (c) 手工创建「陈旧」lock 文件（mtime 回拨/内容 ts 旧）→ 后续操作能接管成功；
- (d) `fn` 抛错路径：锁释放，后续操作不被阻塞；
- (e) `memoryStore` 下并发 20 次同样无丢失（in-process 串行）。

## 任务 2：nudge 强制 prune 走状态机（#7）

`nudgeAppend`（`src/engine.js`，约 345-358 行）在 `esc.forcedPrune` 为真时：

- 先 `assertTransition(leaf.status, 'pruned')`（从 `src/state.js` 导入，已 import 于文件头）→ 非法则抛 `E_STATUS_TRANSITION_INVALID`，**不写状态、不落 drift**（withTree 抛错即不 write）。
- archived 叶子：第 7 次 nudge 必须被拒（`archived` 只允许 `archived`），且 `nudge_count` 不被持久化增加（抛错在 write 前）。
- `done` 叶子：7 次后可按白名单转 `pruned`（`done → pruned` 合法）。
- 保留既有 7-strike 语义与 drift 留痕。

**验收测试**（可并入 `tests/state.test.js` 或新增 `tests/nudge-gate.test.js`）：

- archived 叶子连续 nudge 6 次 OK（不 prune）、第 7 次抛 `E_STATUS_TRANSITION_INVALID`；读回 status 仍 `archived`；
- done 叶子第 7 次转 `pruned` 成功且 drift_history 有 high/rhythm/prune 记录；
- active 叶子不回归（<7 次不 prune）。

## 任务 3：leafAdd 输入字段白名单（#19）

`leafAdd`（`src/engine.js`，约 85-163 行）：

- 定义显式白名单（建议导出常量便于测试与文档）：`leaf_id, session_id, parent, path, role, added_by, relay, taskType, dependencies, brief, dod, model, channel`（是否含 `expect_outputs` 等先 grep 全仓既有调用再定；**以既有合法调用不破坏为准**，逐项在报告中列出）。
- 白名单之外的键 → `E_SCHEMA_INVALID`，message 含非法键名与允许键清单（fail-closed）。
- 内部字段（`runtime, verification, status, created_at, events, milestones, segment_chain, drift_history, context_usage_pct, nudge_count, last_event_type, last_event_ts` 等）由引擎初始化，**永不接受调用方输入**。
- 保持既有校验顺序与错误码习惯；不要改变合法调用的返回形状。

**验收测试**（新增 `tests/leaf-add-whitelist.test.js` 或并入 `tests/write-guards.test.js`）：

- `runtime:{state:'succeeded'}` 注入 → 拒（且错误信息含 `runtime`）；
- `verification:{pass:true}` 注入 → 拒；
- 未知字段 `foo` → 拒；
- 合法 payload（含 `brief/dod/model/channel/taskType/dependencies`）仍成功；
- 攻击路径回归：先尝试注入 runtime 被拒后，正常建点 + 正常派发不回归（可复用现有 fixture）。

## 交付与报告

1. 全部测试：`node --test tests/*.test.js` 全绿（原 172 + 新增；把最终数字写进报告）。
2. `tree_report {action:"event", tree_id:"d23x", leaf_id:"d23x-A1-audit", type:"done", meta:{summary, files_changed:[...], tests:"N/N", new_tests:[...], evidence:"关键命令+输出摘要", residuals:"未做/风险"}}`。
3. 最后一条正常消息以 `TASK_RESULT: A1 PASS|FAIL` 开头，附：改动文件清单（含新增）、测试总数、每条审计项的修复要点与自证命令、未解项/风险。
4. 诚实失败优于伪报：任何一项做不到就如实报告并给出建议，不要编造测试结果。
