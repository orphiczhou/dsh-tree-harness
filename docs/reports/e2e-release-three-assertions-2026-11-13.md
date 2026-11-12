# 发布前三断言真机 E2E（2026-11-13，含验证器假 FAIL 修复）

> 性质：一次性证据报告（结论不回写）；此后代码/文档变化以新报告与交接为准。
> 结论先行：**真机三断言本轮首次实际执行并 PASS（3/3 必需 + 汇总 4/4）**；执行中发现并修复 `verify-handoff.mjs` 的**英文-only 接替提示识别缺陷**（中文界面下两条断言假 FAIL）；同时补强 `release-all.mjs` 发布测试门禁（5 → 9 条）并 dry-run 对账通过。

---

## 0. 结论与证据速览

| 项 | 结论 | 证据（可复核） |
|---|---|---|
| 真机三断言 | **PASS**（verify-handoff 12/12、kickoff-language zh、collect-skills 1/1） | [汇总 artifact](../../scripts/e2e/artifacts/release-20261112T171827Z.json)、[verify-handoff artifact](../../scripts/e2e/artifacts/release-20261112T171827Z/verify-handoff.json) |
| 首跑失败（修复前） | FAIL：`handoff_prompt_present` / `handoff_prompt_names_source` 两条假 FAIL | [首跑汇总](../../scripts/e2e/artifacts/release-20261112T171506Z.json) |
| 缺陷根因 | `verify-handoff.mjs` 只认英文提示措辞；session-tree v1.3.1 起 kickoff 跟随界面语言（本机 zh） | 代码对比：`analyzeHandoffPrompt` 旧正则 `/You are the successor session for/`；产物实现 `packages/dsh-session-tree/index.js` `buildSuccessorPrompt` |
| 修复 | 新增语言无关识别模块 `scripts/e2e/lib/handoff-prompt.mjs`（zh/en）；`verify-handoff.mjs` 改为消费该模块；新增 6 例单测 | `node --test scripts/e2e/lib/handoff-prompt.test.mjs` → 6/6 PASS |
| 发布测试门禁 | 候选清单 5 → **9** 条（补 tree-send / meta / provider-conformance / 工具链回归）；9/9 实跑通过；dry-run 打印正确 | 见 §4；`node scripts/release-all.mjs --dry-run --mirror-dir <镜像 checkout>` exit 0 |

**标签**：以上均为 **FACT**（机读件与退出码为证）。推断/未知项见 §7。

---

## 1. 执行环境（本轮实测）

| 项 | 值 |
|---|---|
| DSH 桌面 | `0.2.2-rc.1`（`agent.md` 基线；本轮未重解包复核版本号） |
| GUI | `http://127.0.0.1:10721`（DSH 2026-11-13 01:00 重启后） |
| 平台参数 | `subagent.maxDepth=5`、`maxActiveSubagents=24`、tree `commander_max_depth=3` |
| profile | `desktop`；tree-engine v0.8.0（`tree_doctor` 7/7）；session-tree v1.4.0 |
| 源会话 | `session-bff3c54c-a11e-4efe-bf4f-d254af6075cc`（上一轮 Lead 会话，handoff 触发者） |
| 接替会话 | `session-612f0535-1ea0-4170-9528-4095e605a0c8`（本轮 Lead，root 接替） |
| 界面语言 | zh（`locale.preference`；kickoff-language 断言 `language=zh`） |
| 工作区 | `D:\Codes\dsh-tree-harness`（workspace `6f48f173-d9bf-485c-9425-67faeddc4653`） |

---

## 2. 首跑：FAIL（修复前，2026-11-13T17:15:06Z ≈ 01:15 +08）

命令：

```bash
node scripts/e2e/run-release-e2e.mjs \
  --source session-bff3c54c-a11e-4efe-bf4f-d254af6075cc \
  --successor session-612f0535-1ea0-4170-9528-4095e605a0c8 \
  --expect-kind root --expect-lang zh --summarize
```

结果（exit 1）：`verify-handoff` 10/12，两条失败：

| 断言 | 实际 | 应有 |
|---|---|---|
| `handoff_prompt_present` | `isHandoffPrompt=false`（`handoffFile` 已识别到 `HANDOFF-bff3c54c-20261113-010944.md`） | `true` |
| `handoff_prompt_names_source` | `namedSource=null` | `session-bff3c54c-…` |

另外两项 PASS：`verify-kickoff-language`（zh/seq=10）、`collect-skills`（1/1）。

### 2.1 根因（FACT）

- 接替提示由 `packages/dsh-session-tree/index.js` `buildSuccessorPrompt` 生成，**zh/en 两套措辞**（v1.3.1 起跟随界面语言；本机 zh）。
- `scripts/e2e/verify-handoff.mjs` 旧实现只匹配英文：
  - `isHandoffPrompt = /You are the successor session for/i && /First read the handoff file at/i`
  - `PROMPT_SOURCE_RE = /You are the successor session for\s+([A-Za-z0-9._:-]+)/i`
- zh 提示原文（摘录）：`你是 session-bff3c54c-… 的接替会话。` / `请先读取交接文件：…HANDOFF-…md`
  → 英文正则全部落空 ⇒ 假 FAIL。**这不是 session_handoff 的回归，而是验证器覆盖缺口。**

---

## 3. 修复（FACT）

| 文件 | 变更 |
|---|---|
| `scripts/e2e/lib/handoff-prompt.mjs` | **新增**：语言无关识别（`HANDOFF_PROMPT_PATTERNS` zh/en；`analyzeHandoffText` / `analyzeHandoffPrompt`），输出 `{isHandoffPrompt, language, namedSource, handoffFileMentioned, textHead}` |
| `scripts/e2e/lib/handoff-prompt.test.mjs` | **新增** 6 例 `node:test`：zh 提示、en 提示（不回归）、zh 兜底 origin（「上一个会话」→ 不点名源）、普通消息不误判、半截措辞不误判、summary 取值与 600 字符截断 |
| `scripts/e2e/verify-handoff.mjs` | 删除本地英文-only 正则/函数，改 import 新模块；两条断言的 `actual` 增加 `language`；报告 `handoffPrompt` 增 `language`；人读摘要行增 `(language=…)` |

测试：

```bash
node --test scripts/e2e/lib/handoff-prompt.test.mjs     # 6/6 PASS (exit 0)
node --check scripts/e2e/verify-handoff.mjs             # OK
```

复跑（同一命令）：**PASS**，exit 0：

```
RESULT      STEP                      EXIT  EVIDENCE
PASS        verify-handoff            0     assertions 12/12 PASS
PASS        verify-kickoff-language   0     language=zh expect=zh seq=10
PASS        collect-skills            0     sessions 1/1 ok; missing: none
PASS        summarize-run (optional)  0     checks 0/10; sessions=1; trees=0 nodes=0 handoffs=-
SUMMARY: PASS (3/3 required PASS) -> scripts/e2e/artifacts/release-20261112T171827Z.json
```

关键读数（PASS artifact）：`handoffPrompt={isHandoffPrompt:true, language:"zh", namedSource:"session-bff3c54c-a11e-4efe-bf4f-d254af6075cc", handoffFileMentioned:"…HANDOFF-bff3c54c-20261113-010944.md"}`；`handoff_file_read` 强证据 8 条。

### 3.1 修复边界（重要）

- 本次修复只改了**验证器与工具链**（repo-level `scripts/`），**没有改 session-tree 包内代码**，因此 v1.4.0 包内容不变、**不需要 bump 版本 / 重新发布**。
- 该缺陷也解释了「真机三断言此前未执行」的隐性风险：若在中文界面首次执行，会被误读为产品回归；现在有了 zh/en 双语言断言与单测锁死。

---

## 4. 发布测试门禁补强（release-all.mjs）

### 4.1 变更（FACT）

- `packages/dsh-session-tree` 候选测试清单 **5 → 8 条**：新增 `test/meta.test.cjs`、`test/tree-send.test.js`、`test/provider-conformance.cjs`。
- 新增**工具链回归**入口（cwd = 仓库根）：`scripts/e2e/lib/handoff-prompt.test.mjs` ⇒ 合计 **9** 条。
- `provider-conformance` 标注为**环境依赖**：`exit 2` = 本机缺可用的 rc.2 fixture（配置环境不足，非断言失败）→ 记 `[SKIP]` 并继续；`exit 1` = 断言失败 → 仍然阻断发布。
- dry-run 计划行会显式标注「环境依赖」与「cwd: 仓库根」，`runTests()` 按每条命令的 `cwd` 执行。

### 4.2 实跑（FACT，2026-11-13 01:2x）

| 测试 | 结果 |
|---|---|
| `test/handoff.test.js` | exit 0（41/41） |
| `test/skills.test.cjs` | exit 0（3/3） |
| `test/style-guard.cjs` | exit 0 |
| `test/render.test.cjs` | exit 0（151/151） |
| `test/meta.test.cjs` | exit 0（41/41） |
| `test/tree-send.test.js` | exit 0（25/25） |
| `test/provider-conformance.cjs` | exit 0（29/29，fixture = `%TEMP%\dsh-asar-inspect\out-rc2-compat`） |
| `scripts/verify-bundle.mjs` | exit 0（0 failing） |
| `scripts/e2e/lib/handoff-prompt.test.mjs` | exit 0（6/6） |

dry-run（`node scripts/release-all.mjs --dry-run --mirror-dir D:\Codes\_release\dsh-session-tree-mirror`，exit 0）关键输出：

```
[OK] 内容对账 files=21 match=21 mismatch=0 missing=0 extra=0（与镜像逐字节一致）
[OK] 包内容无变化不需要发布（版本 1.4.0 = 镜像 tag v1.4.0，SHA 全一致）
[OK] 测试计划 9 条（dry-run 只打印，实跑执行）
1b. 测试（包目录内 + 工具链回归）:
      node test/handoff.test.js
      …（meta / tree-send）
      node test/provider-conformance.cjs   # 环境依赖：缺 rc.2 fixture（exit 2）记 SKIP，断言失败（exit 1）仍阻断
      node scripts/verify-bundle.mjs
      node scripts/e2e/lib/handoff-prompt.test.mjs（cwd: 仓库根）
```

版本一致性检查：`VERSION CHECK OK (23 checks)`；1 条既有 warn（`docs/project-map-2026-11-11.html` 内 tree-engine v0.7.0 表述漂移）与本轮改动无关。

---

## 5. 与「发布前」门禁的关系（诚实口径）

- session-tree **v1.4.0 已于 2026-11-13 先行发布**（镜像 tag `v1.4.0` = `0343f0c`，本仓发布提交 `d8b9f7c`，21/21 SHA）。本轮三断言属于**发布后补验**（补上此前「真机三断言未执行」的缺口），不是发布前置条件。
- 下次发布流程（D6 bump 后）：`node scripts/e2e/run-release-e2e.mjs --source <id> --successor <id> --expect-kind root --expect-lang zh` → `node scripts/release-all.mjs --dry-run --mirror-dir <dir>` → `--push`。**在中文界面下跑必须使用本轮修复后的验证器**。

---

## 6. 文件清单（本轮）

- 新增：`scripts/e2e/lib/handoff-prompt.mjs`、`scripts/e2e/lib/handoff-prompt.test.mjs`
- 修改：`scripts/e2e/verify-handoff.mjs`、`scripts/release-all.mjs`
- 新增证据：`scripts/e2e/artifacts/release-20261112T171506Z{.json,/}`（修复前 FAIL）、`release-20261112T171827Z{.json,/}`（修复后 PASS）

---

## 7. UNKNOWN / 未覆盖

1. **DSH 版本号未重解包复核**（沿用 `agent.md` 的 `0.2.2-rc.1` 基线）；只影响环境注记，不影响断言逻辑。
2. `provider-conformance` 的 rc.2 fixture 来自 `%TEMP%`，属可清理的临时环境；已按「环境依赖」降级为 SKIP（exit 2），但**若该测试在 CI/干净机器上长期缺失，等于事实未覆盖**——发布记录应注明当天 fixture 路径。
3. 本次三断言只验证「root 接替」链路（source bff3c54c → successor 612f0535）；**sibling 路径**最近一次真机验证仍是 2026-11-11 报告（`docs/reports/e2e-handoff-2026-11-11.md`），本轮未重跑。
4. `run-release-e2e.mjs` 的 `--replay` 离线复核未在本轮作为判据（只做真机 live 路径）。
