# 复核任务书 R1：flash 审计三条修复的独立红队复核（异族模型）

> 复核对象：tree-engine 包内 **A1 交付**（flash 审计 #1/#7/#19 修复）。复核人模型必须异于实现模型（实现=deepseek-v4-pro；你=Qwen 系）。
> 性质：**只读复核 + 红队攻击**。不要修改仓库任何文件（发现问题的修复由 Lead 决定）；不要 git、不要重载插件。

## 0. 环境

- 工作区：`D:\Codes\dsh-tree-harness`（工作树含本轮未提交改动，属正常）。
- 包：`packages/dsh-tree-engine`；测试：`cd packages/dsh-tree-engine; node --test tests/*.test.js`（当前应 **195/195**）。
- 改动文件（用 `git diff` 与 `git status` 看实物）：
  - 新增 `src/lock.js`（文件锁）
  - 改 `src/store.js`（`withLock` 端口：fsStore 文件锁 + memoryStore promise 链）
  - 改 `src/engine.js`（`withTree` 只读 / `withTreeMut` 持锁写；`nudgeAppend` 强制 prune 前 `assertTransition`；`leafAdd` 字段白名单 `LEAF_ADD_ALLOWED_FIELDS`）
  - 新增 `tests/store-lock.test.js`(8) / `tests/nudge-gate.test.js`(4) / `tests/leaf-add-whitelist.test.js`(6)
- 审计原文：`docs/archive/flaudit-report.md` #1/#7/#19（可作判据）。

## 1. 复核目标（按威胁模型）

### A. 跨进程写安全（#1）
- 攻击面：两个"引擎实例"（同 fsStore 根）并发写同一树 → 是否还会丢更新？锁是否真正保护「read→改→write」而非只保护 write？
- 边界：`sweepTick`、`dispatchStart`、`bambooRelay`（在 sweep 锁内调用）是否都处在锁内？只读命令会不会意外持锁阻塞？
- 锁自身：O_EXCL 是否原子（writeFile flag wx）？release 是否可能误删他人新锁（nonce 校验）？陈旧接管 rename 抢占是否恰一胜者？活持有者心跳（utimes）是否会与 staleMs 判定冲突？超时错误是否清晰？
- 死锁/自锁：`withTreeMut` 内是否存在对另一写命令的嵌套调用（文件锁不可重入）？`enqueue`（进程内队列）与文件锁的层叠顺序是否可能反转导致死锁？
- 崩溃语义：进程在持锁中被 kill → 后续是否可在 staleMs 后恢复（可写小脚本模拟）。

### B. nudge 状态机（#7）
- archived 叶子第 7 次 nudge 是否被 `E_STATUS_TRANSITION_INVALID` 拒绝、且 **nudge_count 不被持久化增加、无 drift 写入**（抛错在 write 前）？
- done→pruned 是否照常（白名单允许）？active/pending_brief/segment_pending 的第 7 次行为是否与 `STATUS_TRANSITIONS` 一致（segment_pending→pruned 非法应拒）？
- 是否有绕过路径（如 `nudge:reset` + 重复、并发 nudge）？

### C. leafAdd 白名单（#19）
- 白名单外键（`runtime` / `verification` / `milestones` / `events` / `status` / `foo`）是否都被 `E_SCHEMA_INVALID` 拒？错误信息是否含非法键名与允许清单？
- 是否存在"合法键夹带内部语义"的绕过（如 `brief`/`dod`/`model`/`channel` 里塞对象）？
- 白名单是否误伤合法调用（对照 SKILL 文档与既有测试中的 leaf:add 载荷）？
- 攻击链复现：修复前「预置 runtime:{state:'succeeded'} 绕依赖闸」现在是否确实不可行（写小 node 脚本用 memoryStore 直接调引擎表验证，不要改仓库文件——脚本放 `%TEMP%`）。

## 2. 交付

- 每条发现按：`[严重度 P0/P1/P2] 标题 / 证据（文件:行 + 复现命令或脚本输出原文）/ 影响 / 建议`。
- 必须给出**明确结论**：三条是否可判"已修复"（PASS / PASS WITH RISKS / FAIL），以及独立运行的全量测试数字（195/195？）。
- 最后一条消息以 `REVIEW_R1: PASS|PASS_WITH_RISKS|FAIL` 开头，后附发现清单与结论段落。
- 诚实优于客气：找不到问题就说明你攻击过哪些面；发现新问题不要放过。
