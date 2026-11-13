# 复核任务书 R2：tree_log 机读化 + 发布门禁的独立复核（异族模型）

> 复核对象：**A2**（`tree_log` render 机读化）与 **A3**（发布前真机 E2E 门禁）。复核人模型必须异于实现模型（实现=deepseek-flash / qwen3.8-flash；你=GLM 系）。
> 性质：**只读复核 + 对抗性测试**。不要修改仓库文件；不要 git；不要重载插件；不要对真实镜像 `--push/--apply`。

## 0. 环境

- 工作区：`D:\Codes\dsh-tree-harness`；工作树含本轮未提交改动（正常）。
- 相关文件：
  - A2：`packages/dsh-tree-engine/index.js`（仅 `TREE_LOG.output.render`）、`packages/dsh-tree-engine/tests/tree-log-render.test.js`（5 例）
  - A3：`scripts/e2e/lib/release-gate.mjs`（新）、`scripts/e2e/lib/release-gate.test.mjs`（10 例）、`scripts/release-all.mjs`（门禁接入）、`docs/guides/publishing.md`（§5.2 等）
- 命令：`cd packages/dsh-tree-engine; node --test tests/*.test.js`（应 195/195）；`node --test scripts/e2e/lib/release-gate.test.mjs`（应 10/10）。

## 1. 复核目标

### A2：tree_log render
- 机读性：done 事件 meta（如 summary/probe_result）是否原样出现在 render 文本？多行/引号/中文/嵌套对象是否可读？
- 兼容性：返回对象结构是否未变（`{events:[...]}`）？首行 `tree_log:` 前缀是否保留？空数组/未定义字段是否安全？
- 截断：>50 条只渲染尾部 50 条 + 提示，尾部 done meta 是否仍可见？超长 meta 截断是否有明确标记？是否会因巨大 payload 卡死渲染？
- 安全性：render 是否会泄露不该出现的内容（如完整 state、密钥）？是否会抛异常（JSON.stringify 循环引用/undefined/BigInt）？
- 对抗输入：`events` 含 `meta: undefined`、`ts: null`、`leaf_id: 中文/超长`、`meta` 为循环引用对象（构造后调用 render）是否会 crash？

### A3：发布门禁
- 语义正确性：8 项检查是否覆盖任务要求（三断言全 PASS + 新鲜度 + schema）？`overall.verdict`/`required`/`failed` 判定是否与真实 artifact schema 一致？
- 逃逸路径：`--skip-e2e-gate` 是否必须给 reason（缺 reason exit 2）？真实模式失败是否 exit 1 且**先于任何写操作**（检查 release-all.mjs 调用顺序）？dry-run 语义是否按要求（FAIL 显示 BLOCKED 但 exit 0）？
- 边界：artifacts 目录不存在 / 多个 artifact 时选最新是否正确 / 文件名时间戳与内部 timestamp 冲突 / 未来时间 / `--max-e2e-age-hours` 非法值。
- 回归风险：门禁是否误阻断正常发布（用现有 artifact `scripts/e2e/artifacts/release-20261112T171827Z.json` 实测 dry-run：`node scripts/release-all.mjs --dry-run --mirror-dir <存在的临时/镜像目录>`；镜像不存在时按脚本既有语义记录，不要写真实镜像）。
- 对抗：构造 artifact 使 `overall.verdict=PASS` 但 handoff evidence 的 passed<total（应 FAIL）；`required:false` 的 PASS 步骤是否被误算入？steps 顺序/缺 id 是否安全？

## 2. 交付

- 发现按 `[P0/P1/P2] 标题 / 证据（文件:行 + 命令输出原文）/ 影响 / 建议`。
- 明确结论：A2、A3 各自 PASS / PASS WITH RISKS / FAIL；独立跑出的测试数字。
- 最后一条消息以 `REVIEW_R2: PASS|PASS_WITH_RISKS|FAIL` 开头，附发现清单。
- 诚实优于客气；对抗输入要实际跑（脚本放 `%TEMP%`，不要污染仓库）。
