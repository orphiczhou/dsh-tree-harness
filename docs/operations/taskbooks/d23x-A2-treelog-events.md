# 任务书 A2：`tree_log {action:"events"}` 事件 meta 机读化

> 树 `d23x` leaf `d23x-A2-treelog`（role=worker）· 派发人 Lead · 2026-11-13
> 你只做本任务书范围内的事。**不要 git commit / push；不要用 plugin_manager 重载插件；不要改 agent.md / CHANGELOG / README / package.json 版本字段**（Lead 统一收口）。

## 0. 环境与纪律

- 工作区：`D:\Codes\dsh-tree-harness`；包 `packages/dsh-tree-engine/`（ESM，Node 24）。
- 测试：`cd packages/dsh-tree-engine; node --test tests/*.test.js`（基线 **172/172**；目录形参会假失败）。
- 写文件用 `write`/`edit`（UTF-8 无 BOM），禁止 `Set-Content` 写代码。
- **只允许改**：`packages/dsh-tree-engine/index.js` 中 `TREE_LOG` 定义（约 801-826 行）+ 新增 `tests/tree-log-render.test.js`；测试若需轻微调整既有断言（如 grep 到既有 render 断言），须在报告逐条说明。
- **禁止**改 `src/**`、其它工具定义、SKILL/README。若发现必须改引擎返回结构才能完成，先 tree_report blocked，不要扩散。
- 中文报告；FACT/INFERENCE 分明；附命令与原始输出摘要。

## 背景（D22 实测发现，报告 §6）

`tree_log {action:"events"}` 的引擎返回已含 `events:[{leaf_id, type, ts, meta}]`（`src/engine.js` `eventList`，约 644-656 行），但工具面 `output.render` 只渲染 `tree_log: N entries` 一行计数 → **模型/调用方只能看到计数，done 事件 meta（如 summary/probe_result）不可机读**，下游只能二手转述。这是 D22 试点里内层 commander 无法机读 worker done meta 的直接原因。

## 任务：render 输出可机读 + 单测

1. `TREE_LOG.output.render` 改造（保持 `output.schema: {type:'object'}` 与返回对象不变；**不改变引擎语义**）：
   - `events`：首行保留 `tree_log: <N> event(s)`（兼容既有调用/报告阅读），随后每事件一行，格式建议：
     `[<ts>] <leaf_id> <type> meta=<紧凑 JSON>`；`meta` 用 `JSON.stringify`，单行截断上限约 800 字符（超出以 `…(+K chars)` 结尾），`meta` 为空对象时省略 `meta=`。
   - 截断保护：事件过多时只渲染**最后 50 条**，并在末尾追加 `…(+<K> earlier events truncated; use leaf_id/type filters)`。**必须保留**能覆盖「取最近 done 事件 meta」场景的尾部事件。
   - `drift` / `heartbeat` / `communication` 同样给出一行一条的紧凑机读形式（字段：ts/leaf_id/kind/severity/action/reason 等按实际后端返回），首行计数前缀保持 `tree_log:`。
   - 空结果仍为 `tree_log: 0 entries`（或 `tree_log: 0 event(s)`，与既有测试兼容——先 grep 现有断言）。
   - 不要渲染整个 state、不要无限长输出。
2. 单测 `tests/tree-log-render.test.js`（node:test + assert）：
   - 从 `../index.js` 导入 `TOOLS`，取 `tree_log` 的 `output.render`；
   - 构造 `{events:[{leaf_id:'x-C1-commander', type:'done', ts:'2026-11-13T00:00:00Z', meta:{summary:'ok', probe_result:'DENIED'}}]}` → 断言输出含 `probe_result` 与 `DENIED`（meta 可机读核心断言）；
   - 60 条事件 → 断言只含最后 50 条 + 截断提示；尾部 done 事件 meta 仍在；
   - 超长 meta（如 2000 字符）→ 断言被截断且总行长度受控；
   - drift/heartbeat/communication 各一条 → 断言关键字段可见；
   - 空数组 → 断言不抛错且计数为 0。
3. 全量测试：原 172 + 新增全绿（最终数字写报告）。
4. 兼容性说明：返回对象结构不变；仅 render 文本变化（调用方若解析 render 文本，属文本增强，不破坏前缀 `tree_log:`）。

## 交付与报告

1. `tree_report {action:"event", tree_id:"d23x", leaf_id:"d23x-A2-treelog", type:"done", meta:{summary, files_changed, tests:"N/N", new_tests:"<n> 例", evidence:"render 示例输出原文（含 done meta）", compatibility:"返回结构不变说明"}}`。
2. 最后一条消息以 `TASK_RESULT: A2 PASS|FAIL` 开头，附 render 前后示例、测试数字、兼容性结论。
3. 诚实失败优于伪报：做不到就如实说明。
