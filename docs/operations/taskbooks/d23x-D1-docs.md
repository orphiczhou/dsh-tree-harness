# 任务书 D1：文档同步（SKILL / engine-spec / composition-playbook）

> 树 `d23x` leaf `d23x-D1-docs`（role=worker）· 派发人 Lead · 2026-11-13
> 背景：本轮 tree-engine 有 5 项代码变更（见下），文档需同步。**只改 4 个文件**，不要碰 README / agent.md / CHANGELOG / package.json / docs/project-map-*.html / docs/operations/**（这些由 Lead 收口）。**不要 git commit/push、不要重载插件、不要改代码。**

## 0. 环境

- 工作区：`D:\Codes\dsh-tree-harness`；当前工作树含本轮未提交改动（正常）。
- 用 `read`/`write`/`edit`（UTF-8 无 BOM）；中文；每条改动要与**代码实物**一致（先读代码再写文档，禁止臆造）。
- 校验：`node scripts/check-doc-links.mjs` 与 `node scripts/check-md-tables.mjs` 必须保持 OK。

## 1. 本轮代码事实（已实现并测试 209/209 全绿；以此为准，细节请回读代码）

| # | 变更 | 代码位置 |
|---|---|---|
| 1 | **跨进程文件锁**：写命令走 `withTreeMut`（进程内队列 + `store.withLock` 文件锁，`.lock` = `tree-state.lock`，O_EXCL + nonce + 陈旧接管 staleMs=15s + 心跳）；只读命令 `withTree` 不加锁 | `src/lock.js`、`src/store.js`、`src/engine.js` |
| 2 | **nudge 强制 prune 走状态机**：第 7 次 nudge 强制 prune 前 `assertTransition`；archived 被拒（`E_STATUS_TRANSITION_INVALID`，nudge_count 不持久化增加） | `src/engine.js` nudgeAppend |
| 3 | **leaf:add 字段白名单**：13 个允许键（leaf_id/session_id/parent/path/role/added_by/relay/taskType/dependencies/brief/dod/model/channel）；白名单外键 `E_SCHEMA_INVALID`；内部字段（runtime/verification/status/events/milestones/…）由引擎初始化 | `src/engine.js` `LEAF_ADD_ALLOWED_FIELDS` |
| 4 | **`tree_log` 事件机读化**：render 从「仅计数」改为一行一条（events 尾部 50 条、meta 紧凑 JSON、超 800 字符截断）；done 事件 meta（summary/probe_result 等）可机读；返回对象结构不变 | `index.js` TREE_LOG |
| 5 | **验证授权委托（新）**：`tree_maintain {action:"verify-delegate", tree_id, session_ids[]}`；仅树 root 会话可授予（root.session_id；null → 拒）；全量替换、`[]` 清空；被授权者**只能写 leaf.verification**（`LEAF_WRITE_MATRIX.verification.delegate=true`，其余 kind 一律 ❌）；变更落 `drift_log`（kind=`security`/action=`declare`/leaf_id=null）；用于「现场建树后 root 会话 dispose，事后由受信会话补 `tree_verify`」 | `index.js` TREE_MAINTAIN、`src/engine.js` verifyDelegate、`src/guards.js` |

## 2. 只改这 4 个文件

### 2.1 `packages/dsh-tree-engine/skills/tree-commander/SKILL.md`
- 工具表/命令速查：`tree_maintain` 的 action 列表补 `verify-delegate`（说明仅 root 可授予、全量替换、最小授权面、审计留痕）；`tree_log` 说明改为「events 可读 done meta（一行一条，尾部 50 条）」。
- 新增小节（放在「现场建树/组合编排」或「验证」附近，按现有结构就近插入，不要打乱编号）：
  **「现场建树的验证归属（v0.9.0）」**——flow 节点现场建树后其会话 dispose，事后 `tree_verify` 会被 `E_BORROWED_IDENTITY` 拒（verification 只允许 creator|root）；两条出路：a) **收口前 verify**（创建者在结束前自己 `tree_verify` 并落账）；b) **验证授权委托**（root 会话结束前 `tree_maintain {action:"verify-delegate", tree_id, session_ids:["<受信会话>"]}`，被授权者之后可补 `tree_verify`；只能写 verification）。
- 错误码表：`E_STATUS_TRANSITION_INVALID` 的说明补充 nudge 强制 prune 路径（archived 第 7 次 nudge 被拒）。
- 若涉及 `leaf:add` 字段清单，补一句「只接受白名单 13 字段，内部字段会被拒（v0.9.0）」并列出允许键。

### 2.2 `packages/dsh-tree-engine/skills/tree-worker/SKILL.md`
- `tree_log {action:"events"}` 说明：done meta 可机读（一行一条）；如 worker 需向 commander 证明产出，可让 commander 直接读 done meta。
- 若写到 `leaf:add`/`tree_report` 字段：`tree_report` 的 meta 不受 leaf:add 白名单影响（它走事件）；`leaf:add` 只接受白名单键——核对现有例子是否含非法键（如有，改为合法）。
- 保持 frontmatter 的 `name`/`description`/`whenToUse` **原样不改**（版本一致性脚本校验其长度，改了有风险）。

### 2.3 `docs/architecture/engine-spec.md`
- §2 数据模型：tree-state 增加 `verify_delegates: []`（树级、归一化裸 UUID、全量替换）；说明旧树缺字段读侧惰性缺省。
- §5 护栏总表：新增「跨进程写互斥」行（`.lock` 文件锁 + 陈旧接管 + 心跳；只读不加锁）与「leaf:add 字段白名单」行。
- §6 并发与入口契约：补充 `withTree`（只读直读）vs `withTreeMut`（enqueue + 文件锁）分层；锁超时错误码 `E_TREE_LOCK_TIMEOUT`。
- §4 或 §3 附近：补充 `verify-delegate` 命令与写权矩阵 delegate 轴（verification 独有）。
- 保持既有小节编号不动；新增内容就近插入。

### 2.4 `docs/guides/composition-playbook.md`
- 「深度算术」/§3 相关：补 v3 实测结论——**tree 派发路径已在 v0.8.1 封口**（depth 5 再 `tree_dispatch` → `E_PORTS_PROTOCOL / subagent depth 6 exceeds maxDepth 5`，无 depth-6 会话；证据 `docs/reports/composition-pilot-v3-depth-cap-2026-11-13.md`）；**flow 执行器仍未封口**（`flow_run` 起 flow 节点不受限，待跨仓需求单）。
- 「验证归属 / 收口」相关：补 v0.9.0 `verify-delegate` 用法与「收口前 verify」两条路；引用 `tree_maintain {action:"verify-delegate", session_ids:[...]}`。
- 若文中提到 `tree_log` 不可机读的旧表述，更新为已可机读（v0.9.0）。
- 不要改版本号口径以外的历史段落；如引用试点 v2 结论仍成立则保留并标注。

## 3. 交付

1. 两个校验脚本 OK：`node scripts/check-doc-links.mjs`、`node scripts/check-md-tables.mjs`。
2. 全量测试仍 209/209（文档改动不应影响，跑一次确认）。
3. `tree_report {action:"event", tree_id:"d23x", leaf_id:"d23x-D1-docs", type:"done", meta:{summary, files_changed, checks:"links OK / tables OK", tests:"209/209"}}`。
4. 最后一条消息以 `TASK_RESULT: D1 PASS|FAIL` 开头，附：每个文件改了什么（小节/要点）、校验输出。
5. 诚实失败优于伪报；发现文档与代码矛盾先记录再按代码修正，并在报告中列出矛盾点。
