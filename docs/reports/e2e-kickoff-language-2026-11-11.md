# 交接提示语跟随 DSH 界面语言 — 实现与真机 E2E（2026-11-11，session-tree v1.3.1）

> 需求：交接时新会话默认收到英文提示词；应改为使用 **DSH 界面语言设定**（Settings → General → Language，即 profile `cordis.patch.yml` 中 `locale` 条目的 `preference`）。
> 角色：Lead 实现 + 真机验证；验证子会话（干净上下文）只调用 `session_handoff`。

## 1. 语言来源与解析（`packages/dsh-session-tree/index.js`）

优先级（`readLocalePreference`）：

1. **活体 Loader 的 `locale` 条目**：`services.get('loader').resolve('locale').options.config.preference`；volatile 引用经 `get()` 展开；若 `resolve('locale')` 找不到（条目在 bundle 子树里），按包名 `@deepseek-ai/dsh-client-locale` 遍历 `loader.entries()` 兜底；再读 `entry.fiber.effectiveConfig.preference`。
2. **profile 配置文件**：`<profile>/cordis.patch.yml`、`<profile>/cordis.yml`，用受限 YAML 扫描只取 `locale` 条目的 `preference`（遇到下一个顶层 `- ` 条目即停，避免读到别家配置）。profile 目录候选：`DSH_PROFILE_DIR`（本机宿主进程未导出）→ **`process.cwd()`**（实测宿主进程 cwd 就是 profile 目录：tree-engine 的相对 `dataDir` 落在 `~/.dsh/profiles/desktop/tree-engine-data/` 可证）。
3. 回退 `en`（DSH 的英文 fallback，也是改动前行为）。

归一化：`zh`/`zh-CN`/`zh-TW` → `zh`；`en`/`en-US` → `en`；其它已存语言（ja/es/fr/de/ru/pt…）与无偏好 → `en`。

输出：`status` / `handoff` 返回对象新增 `interface_language`；渲染行尾追加 `lang=zh|en`。接替首条消息与交接文件的 `## Successor instructions` 块使用该语言；交接文件其余章节保持英文规范格式（稳定、可机检）。

## 2. 本机设定（证据）

`C:\Users\sir_c\.dsh\profiles\desktop\cordis.patch.yml`：

```yaml
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: zh
```

宿主进程环境实测 `PROFILE_DIR=?`（`tree-engine-data/apply.log`），因此仅靠 `DSH_PROFILE_DIR` 读不到；本轮通过 `process.cwd()` 兜底命中该文件。插件重载两次（`include:session-tree` disable→enable）。

## 3. 真机 E2E 结果

### 3.1 修复前基线（旧实现，硬编码英文）

- 验证子会话 `9cb372fb…`（父=本会话）调用 `session_handoff {action:"status"}` →
  `… next=continue lang=en`（`lang=en` 即旧逻辑回退值；旧实现无 `lang` 字段时为纯英文行）。
- `force:true` 交接 → successor `f5aa22f7-bd42-402e-b25f-96b448a8f237`，状态行 `… lang=en`。
- `node scripts/e2e/verify-kickoff-language.mjs --session f5aa22f7… --expect en` →
  **PASS**：首条 `user/message`（seq 10）为
  `You are the successor session for 9cb372fb… First read the handoff file at: …HANDOFF-9cb372fb-20261111-173611.md`。

### 3.2 修复后（v1.3.1 工作树，`lang=zh`）

- 验证子会话 `d93a8927…` 同法调用：
  - status 行：`session_handoff status: context=5.4% (threshold 50%) … successor=sibling next=continue lang=zh`
  - handoff 行：`session_handoff: wrote …HANDOFF-d93a8927-20261111-173801.md; successor ca7e834f-5145-4101-853c-a6b4b57d10ee kind=sibling preset=standard inherited=session-route lang=zh`
- `node scripts/e2e/verify-kickoff-language.mjs --session ca7e834f… --expect zh` → **PASS**：
  首条 `user/message`（seq 10）为
  `你是 d93a8927-b2db-41e5-ab91-34dbdecc8a6c 的接替会话。上一个会话因上下文预算接近上限而把工作交棒给你。 请先读取交接文件：D:\Codes\dsh-tree-harness\HANDOFF-d93a8927-20261111-173801.md …`
  （`mentions_handoff_file=true`）。
- 交接文件 `HANDOFF-d93a8927-20261111-173801.md` 的 `## Successor instructions`（:42–48）为同一段中文。
- 对照：同一验证子会话的 `status` 渲染行由 `lang=en` → `lang=zh`，成功路径无回归（`kind=sibling`、`preset=standard`、`inherited=session-route`）。

## 4. 离线回归（`packages/dsh-session-tree/test/handoff.test.js`）

**40/40 PASS**（原 34 + 新增 6）：Loader 偏好 `zh-CN` → prompt/文件中文；volatile 引用展开；`ja` → 英文回退；无偏好 → 英文（原行为）；profile `cordis.patch.yml`（`DSH_PROFILE_DIR` 路径）→ 中文；`process.cwd()` 为 profile 目录 → 中文。

测试文件在模块加载时清除 `DSH_PROFILE_DIR` 并恢复，避免开发者本机 profile（zh）污染「无偏好」用例。

## 5. 复现命令

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
# 离线
cd packages\dsh-session-tree; & $node test\handoff.test.js
# 真机（先让子会话执行 session_handoff handoff，再断言接替会话首条消息）
& $node scripts\e2e\verify-kickoff-language.mjs --session <successorId> --expect zh --json
```

## 6. 边界

- 只覆盖 `zh` / `en` 两套提示语文案；DSH 还内置 ja/es/fr/de/ru/pt，这些语言的提示语回退英文（与 DSH 自身 en fallback 一致）。
- 交接文件正文仍是英文（稳定格式）；若未来要整份文件本地化，需同步更新 `verify-handoff.mjs` 的英文标题断言。
- 界面语言在会话进行中改变时，下一次 `status`/`handoff` 调用即生效（每次调用重新解析，不缓存）。
