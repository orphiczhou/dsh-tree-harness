# 任务书 A4：现场建树的「验证授权委托」（tree-engine 新能力）

> 树 `d23x` leaf `d23x-A4-delegate`（role=worker）· 派发人 Lead · 2026-11-13
> 依赖：A1（`src/engine.js` 审计修复）与 A2（`index.js` TREE_LOG）**已完成并验收**后才派发（写作用域重叠，避免并发冲突）。
> 你只做本任务书范围内的事。**不要 git commit / push；不要用 plugin_manager 重载插件；不要改 agent.md / CHANGELOG / README / package.json 版本字段**（Lead 统一收口）。

## 0. 环境与纪律

- 工作区：`D:\Codes\dsh-tree-harness`；包 `packages/dsh-tree-engine/`（ESM，Node 24）。
- 测试：`cd packages/dsh-tree-engine; node --test tests/*.test.js`（基线见派发时的最新数字；目录形参会假失败）。
- 写文件用 `write`/`edit`（UTF-8 无 BOM），禁止 `Set-Content` 写代码。
- **允许改**：`src/engine.js`（新增 handler + tree_init 字段 + 写权判定接线）、`src/guards.js`（`LEAF_WRITE_MATRIX.verification` 增加 delegate 轴 + `assertLeafWriter` 委托判定）、`index.js`（`TREE_MAINTAIN` 增加 action + schema/render）、`tests/verify-delegate.test.js`（新增）。
- **禁止**改：`src/store.js`（A1 区域）、`TREE_LOG`（A2 区域）、`package.json`、`README.md`、`CHANGELOG.md`、`agent.md`、`docs/**`（文档由 Lead 收口）。

## 背景（D22 实测缺口）

现场建树模式（flow 节点在自己一次性会话里 `tree_plan` 建内层树）下，树 root/creator = flow 节点会话，**节点结束即 dispose**。此后外层 Lead/commander 想事后 `tree_verify` 补验证，被 `E_BORROWED_IDENTITY` 拒绝（`LEAF_WRITE_MATRIX.verification` 只允许 `creator|root`），导致「现场建树」无法事后验收。用户任务 4① 要求出方案并落地（引擎改动需单测 + 版本记录；版本由 Lead bump）。

**采用方案：显式验证授权委托（verify delegation）**——root 会话可在自己结束前把「补验证」权限授予指定的受信会话 id 列表；被授权者只能写 `verification`，不能写事件/状态/取消等（最小授权面）。

## 任务

### 1. 状态字段

- `tree_init` 初始化 `verify_delegates: []`（树级、归一化后的裸 UUID 列表）。
- 旧树（无该字段）读取侧惰性兼容：缺省视为 `[]`（不要要求迁移）。
- 变更留痕：授予/替换时向 `state.drift_log` 追加一条审计记录（`kind:'security'`、`action:'declare'`、`leaf_id: null`、`reason` 含授予对象与调用者），**不改** `drift_history` 语义。

### 2. 新命令 `tree:verify-delegate`

- 入参 `[treeId, sessionIds]`（`sessionIds` 为非空字符串数组；空数组 = 清空；非法/非 UUID v4（归一化后）→ `E_INVALID_UUID_STRICT`）。
- **授权**：仅该树 root 会话（`state.leaves['<treeId>-root'].session_id`）可调用；其他人 → `E_BORROWED_IDENTITY`（message 含 delegated/root 说明）。root 会话为 null 的树 → 拒绝并说明。
- 语义：**全量替换** `verify_delegates`（不是追加），并返回 `{tree_id, verify_delegates}`。
- 保持幂等：相同列表重复调用不报错（可仍留一条审计记录）。

### 3. 写权接线（`src/guards.js`）

- `LEAF_WRITE_MATRIX.verification` 增加 `delegate: true`（其余 kind 一律 `delegate: false`，保持冻结对象形状；`Object.freeze` 结构不变）。
- `assertLeafWriter(..., 'verification')`：当 caller 命中 `state.verify_delegates`（归一化比较）时放行；其它 kind 即使命中 delegate 列表也必须拒。
- 更新该函数上方的写权矩阵注释表（矩阵是文档化契约）。
- **不得放宽** owner 自验禁令：owner 仍不得写 verification（除非它同时是 creator/root/delegate）。

### 4. 工具面（`index.js` `TREE_MAINTAIN`）

- `action` enum 增加 `'verify-delegate'`；`parameters` 增加 `session_ids: {type:'array', items:{type:'string'}}`。
- 映射到 `engine.call('tree:verify-delegate', [tree_id, session_ids ?? []], caller)`（注意 caller 透传方式与其它 tree_maintain action 一致）。
- `output.render` 增加该分支（如 `tree_maintain: ok (verify-delegates=2)`），不破坏既有分支。
- **只改 TREE_MAINTAIN 定义**；`TREE_LOG` 禁止触碰。

### 5. 单测 `tests/verify-delegate.test.js`（至少 8 例）

1. root 授权 X → X 可 `leaf:set-verification`（写 leaf.verification 成功）；
2. 未授权会话 Y 写 verification → `E_BORROWED_IDENTITY`；
3. 非 root 会话尝试授权 → 拒（`E_BORROWED_IDENTITY`）；
4. 被授权者 X 写 `event` / `status` / `context` → 仍拒（最小授权面）；
5. 清空（`[]`）后 X 再写 verification → 拒；
6. 非法 UUID（非 v4 / 全 0）→ `E_INVALID_UUID_STRICT`；
7. 旧树无 `verify_delegates` 字段 → 读路径正常、默认无人被授权；
8. 审计留痕：授权后 `drift:list` 含 `kind:'security'` 记录；
9. （happy path）owner 仍不能自验：owner 非 creator/root/delegate 时写 verification 被拒。

## 交付与报告

1. 全量测试全绿（最终数字写报告）。
2. `tree_report {action:"event", tree_id:"d23x", leaf_id:"d23x-A4-delegate", type:"done", meta:{summary, files_changed, tests:"N/N", new_tests:"<n> 例", security_notes:"最小授权面/不可越权点", residuals}}`。
3. 最后一条消息以 `TASK_RESULT: A4 PASS|FAIL` 开头，附：改动文件、测试数字、授权模型说明（谁能授予/被授权者能做什么/不能做什么）、与既有 `E_BORROWED_IDENTITY` 语义的兼容性。
4. 诚实失败优于伪报；任何安全权衡拿不准就写入报告中由 Lead 裁决。
