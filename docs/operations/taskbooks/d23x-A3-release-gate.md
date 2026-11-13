# 任务书 A3：发布门禁收紧——真机三断言 E2E + artifact 归档固化为发布前必跑

> 树 `d23x` leaf `d23x-A3-gate`（role=worker）· 派发人 Lead · 2026-11-13
> 你只做本任务书范围内的事。**不要 git commit / push / tag；不要用 plugin_manager 重载插件；不要改 agent.md / CHANGELOG / README / package.json 版本字段**。

## 0. 环境与纪律

- 工作区：`D:\Codes\dsh-tree-harness`；Node 24（`node` 已在 PATH）。
- 写文件用 `write`/`edit`（UTF-8 无 BOM），禁止 `Set-Content` 写代码。
- **只允许改/建**：
  - `scripts/release-all.mjs`（发布自动化，W2.7，默认 dry-run）
  - `scripts/e2e/lib/release-gate.mjs`（新建：纯函数门禁逻辑）
  - `scripts/e2e/lib/release-gate.test.mjs`（新建：node:test 单测）
  - `docs/guides/publishing.md`（门禁章节）
- **禁止**改 `scripts/e2e/run-release-e2e.mjs`、`verify-*.mjs`、任何 `packages/**`、SKILL、README。
- 中文报告；FACT/INFERENCE 分明；附命令与原始输出。

## 背景

- 发布前真机三断言 runner 已存在：`scripts/e2e/run-release-e2e.mjs`（编排 `verify-handoff.mjs` / `verify-kickoff-language.mjs` / `collect-skills.mjs`，汇总 artifact 写入 `scripts/e2e/artifacts/release-<UTC>.json`）。最近一次真机 PASS artifact：`scripts/e2e/artifacts/release-20261112T171827Z.json`（2026-11-13 跑出，12/12 + zh + 1/1）。
- 现状：artifact 是「跑过就归档」，但**发布流程（`scripts/release-all.mjs` / `docs/guides/publishing.md`）没有把它变成硬门禁**——发布时可能没有新鲜的真机证据也照常同步/提交/推送。
- 本轮目标（用户任务 2 后半）：把「三断言真机 E2E + artifact 归档」固化为发布前必跑/必校验，并 dry-run 验证门禁本身有效。

## 任务

1. **门禁纯逻辑** `scripts/e2e/lib/release-gate.mjs`（ESM，无副作用，便于单测）：
   - 输入：`artifactsDir`、可选 `artifactPath`、`now`（可注入，测试用）、`maxAgeHours`（缺省 168=7 天）。
   - 行为：选最新 `release-*.json`（或指定文件）→ 读取解析 → 校验：
     a. JSON 可解析、含汇总字段（先读现有 artifact 结构定 schema，不要臆测）；
     b. 三条断言全部 PASS（handoff 断言计数通过、kickoff 语言 PASS、skills 计数 PASS——按 artifact 实际字段实现）；
     c. freshness：artifact 时间（文件名 UTC 或内部时间）距今 ≤ maxAgeHours；
   - 返回结构化 `{ok, artifactPath, ageHours, checks:[{name, ok, detail}], hint}`，**不抛异常**（由调用方决定 exit code）。
2. **接入 `scripts/release-all.mjs`**：
   - 在**任何写操作之前**（预检阶段）运行门禁；失败 → exit 非 0，打印每条失败项 + 可操作提示（先跑 `node scripts/e2e/run-release-e2e.mjs --source <id> --successor <id> --wait 120000` 生成新 artifact）。
   - 新增 CLI：`--e2e-artifact <path>`（指定 artifact）、`--max-e2e-age-hours <n>`（覆盖缺省 168）、`--skip-e2e-gate` + 必填 `--skip-e2e-reason <text>`（显式豁免，输出醒目标注「E2E GATE SKIPPED: <reason>」）。dry-run 同样执行门禁（先证明门禁有效）。
   - 不改变既有发布步骤语义（同步/SHA/commit/tag/ls-remote 顺序保持）。
3. **单测** `scripts/e2e/lib/release-gate.test.mjs`（node:test）：
   - 新鲜且三断言全 PASS → ok=true；
   - 断言失败 → ok=false 且 checks 指出失败项；
   - artifact 过期（now 注入）→ ok=false；
   - 目录无 artifact / 指定文件不存在 / JSON 损坏 → ok=false + hint；
   - 边界：maxAgeHours 自定义生效。
   - 跑法：`node --test scripts/e2e/lib/release-gate.test.mjs`。
4. **文档** `docs/guides/publishing.md`：
   - 新增「发布前真机 E2E 门禁（强制）」章节：顺序（先跑 runner → 生成 artifact → `release-all` 校验）、命令、失败处理、豁免纪律（`--skip-e2e-gate` 仅限紧急且必须记录 reason）。
   - 在 §3/§6 既有检查清单里加入对应条目（找到实际章节号，不要臆造编号）。
5. **dry-run 验证**：
   - 找到本地发布镜像 checkout（线索：`docs/guides/publishing.md` 与 `scripts/release-all.mjs` 的 `--mirror-dir` 说明；历史路径 `%USERPROFILE%\Documents\deepseek-harness\default-workspace\publish\dsh-session-tree` 可能不是 git repo——以脚本实际要求为准，可用临时目录或 `--check` 语义验证，不要求真推）。
   - `node scripts/release-all.mjs --dry-run --mirror-dir <目录>` 实跑：应执行门禁并显示 PASS（现有 artifact 新鲜）；再用构造的过期/失败 artifact（临时目录）演示 FAIL 与提示。**不要 `--push`、不要 `--apply` 到真实镜像**（如需 apply 演练仅限临时目录并说明）。

## 交付与报告

1. `tree_report {action:"event", tree_id:"d23x", leaf_id:"d23x-A3-gate", type:"done", meta:{summary, files_changed, tests:"N/N", gate_demo:"pass/fail 两次原始输出摘要", dryrun:"命令+exit code+关键输出", residuals}}`。
2. 最后一条消息以 `TASK_RESULT: A3 PASS|FAIL` 开头，附：门禁语义、命令示例、dry-run 实测输出摘要、对既有发布流程的兼容性说明。
3. 诚实失败优于伪报；不清楚 artifact schema 就先读实物再写代码。
