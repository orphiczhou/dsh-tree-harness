# W2.2 provider-conformance rc.2 fixture 取证报告

> **执行者**：tree `wave2` / leaf `wave2-B1-conformance`（worker）
> **仓库**：`D:\Codes\dsh-tree-harness`，分支 `master`，基线 HEAD `e09f39b`；本 leaf 只改 `packages/dsh-session-tree/test/provider-conformance.cjs` 与本报告（`docs/README.md` 仅加一行索引）。工作树中其他未提交文件属并行任务，不在本报告范围。
> **取证时间**：2026-11-12 00:38 — 00:55（+08:00）
> **结论**：`node test/provider-conformance.cjs` → **29/29 PASS，exit 0**；fixture = `%TEMP%\dsh-asar-inspect\out-rc2-compat`。缺 fixture / 非 rc.2 布局时改为 **exit 2 + 可操作错误信息（无崩溃堆栈）**；断言语义与数量均未改动。

---

## 0. 结论（置顶）

| 项 | 结果 |
|---|---|
| 断言 | **29/29 PASS**（A 6 + B 7 + C 11 + D 5，含 5 项负向对照） |
| 退出码 | **0** |
| 使用 fixture | `C:\Users\sir_c\AppData\Local\Temp\dsh-asar-inspect\out-rc2-compat`（`source: known default`） |
| fixture 兼容性 | **rc.2 兼容**：`dsh-tools/lib/index.js` 内联 `lib/types/json-schema.js` region + `validateJsonSchemaValue`；`dsh-util-values` 原文（无 import） |
| 另一套 `out` | **不兼容**：是 DSH `0.2.2-rc.1` 的拆包布局（`index.js` 从 `./shared-DTdn5dXO.js` 转出引擎），本测试的 region 提取启发式读不到 → 明确拒绝，不再崩溃 |
| 断言改动 | **无**（只改 fixture 定位、错误信息、文档注释；29 个 `check()` 调用逐项未动） |
| 文档检查 | `check-doc-links.mjs` / `check-md-tables.mjs` 均通过（见 §8） |

**关键结论一句话**：29/29 是真实的；它依赖一份**放在本机 `%TEMP%`、可被清理、且随 DSH 版本布局漂移**的 asar 解包 fixture——本报告固定其来源、文件清单与 SHA-256，脚本缺它时给出可操作报错而不是让测试"看起来失败"。

---

## 1. 验收口径

- **W2.2**（`docs/operations/wave2-plan-2026-11-12.md:20`）：按文档步骤得到 29/29；缺 fixture 时错误信息明确；fixture 来源/校验记录进报告。
- 断言数量目标 29 来自现有脚本结构（见 §7 的分布），**不是**本次新加的门槛；本次不新增、不删减、不修改任何断言。

---

## 2. 脚本需要的 fixture 契约

`test/provider-conformance.cjs` 不是"跑真实的 DSH"，而是把 **shipped** JSON-Schema 引擎原文提出来参与判定，因此它要求解包树包含：

| 相对路径 | 要求 | 用途 |
|---|---|---|
| `dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js` | 含 `//#region lib/types/json-schema.js` 且含 `function validateJsonSchemaValue(`（**内联**） | 截取 region 作为 `assertSupportedJsonSchema` / `validateJsonSchemaValue` 的实现 |
| `dsh/node_modules/@deepseek-ai/dsh-util-values/lib/index.js` | 原文，**无 import**，末尾一个 `export { ... }` | 整段 lift，得到 `snapshotJsonValue` 及其闭包 |

这就是本报告所说的 **「rc.2 兼容」**：rc.2 时代的 DSH 构建把 schema 引擎内联在 `dsh-tools/lib/index.js`；新版（本机安装的 `0.2.2-rc.1`）把它拆到 `dsh-tools/lib/shared-*.js`，`index.js` 只做 re-export。测试若拿到拆包布局，region 启发式必然失败。

---

## 3. 两套 fixture 的探测结果

探测时间 2026-11-12；两套目录均位于 `%TEMP%\dsh-asar-inspect`（`C:\Users\sir_c\AppData\Local\Temp\dsh-asar-inspect`）。

| 目录 | 文件 | 大小 (B) | 布局判定 |
|---|---|---|---|
| `out-rc2-compat` | `dsh-tools/lib/index.js` | 24 075 | **rc.2 兼容**：region 标记在，`validateJsonSchemaValue` 在（该文件 = shipped shared chunk 的逐字节副本） |
| `out-rc2-compat` | `dsh-util-values/lib/index.js` | 29 403 | 可用（无 import） |
| `out` | `dsh-tools/lib/index.js` | 27 415 | **不兼容**：`from "./shared-DTdn5dXO.js"` 转出 `assertSupportedJsonSchema` / `validateJsonSchemaValue`；region 不在本文件 |
| `out` | `dsh-tools/lib/shared-DTdn5dXO.js` | 24 075 | 引擎在这里（与 `out-rc2-compat` 的 `index.js` **逐字节相同**） |
| `out` | `dsh-util-values/lib/index.js` | 29 403 | 可用（与 rc2 目录同内容） |

- `out` 是**完整解包**（含 shared chunk），只是布局不同；`out-rc2-compat` 是把 shared chunk 放到 `index.js` 面（rc.2 面）的兼容副本。
- `out-rc2-compat` 的 `dsh-tools/lib/index.js` 与 `out` 的 `shared-DTdn5dXO.js`：**SHA-256 完全相同**——说明兼容目录没有改写引擎字节，只是换了摆放位置。

---

## 4. fixture 来源链、时间与 SHA-256

### 4.1 来源链（本次复验，2026-11-12）

1. 本机安装的 DSH：`D:\DSHarness\resources\app.asar`（`@deepseek-ai/dsh-desktop-runtime`，`version = 0.2.2-rc.1`；文件 213 202 918 B，mtime `2026-11-04 17:30:40`，SHA-256 `5fa8a6b21bceb8f3e99e30efa2270efd0cc773a11e42aa0488f804a64b34e637`）。
2. 从该 asar **按条目解包**（复用 `%TEMP%\dsh-asar-inspect\extract-fixture.cjs`，本次解到独立临时目录做对照，未改动现有 fixture）：
   - `dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`（27 415 B，SHA-256 `1889cb…a2bd`）
   - `dsh/node_modules/@deepseek-ai/dsh-tools/lib/shared-DTdn5dXO.js`（24 075 B，SHA-256 `d02f0d…2cf0`）
   - `dsh/node_modules/@deepseek-ai/dsh-util-values/lib/index.js`（29 403 B，SHA-256 `8b4ffd…3e8b`）
3. 三者与现有 fixture 的 SHA-256 一一对上（见 §4.3 表）：`out/dsh-tools/lib/index.js` = asar 的 `index.js`；`out-rc2-compat/dsh-tools/lib/index.js` = asar 的 `shared-DTdn5dXO.js`；两套的 `dsh-util-values` = asar 原文。
4. 与 `docs/architecture/merge-session-tree-2026-11-11.md` §5 的记录一致：该节记载 rc.2 兼容 fixture 的 `dsh-tools/lib/index.js` blob SHA `58335e4727992241ab843dbdcab7e57d6ae71574`、`dsh-util-values/lib/index.js` blob SHA `8d802d5c28c96454880a4ef749a3160c6800d2ea`；本次实测 blob SHA **相同**。

### 4.2 生成/解包时间（文件系统实测）

| 文件 | 大小 (B) | mtime（+08:00） |
|---|---|---|
| `%TEMP%\dsh-asar-inspect\extract-fixture.cjs` | 2 645 | 2026-11-11 12:36:53 |
| `out\dsh\...\dsh-tools\lib\index.js` | 27 415 | 2026-11-11 12:36:56 |
| `out\dsh\...\dsh-tools\lib\shared-DTdn5dXO.js` | 24 075 | 2026-11-11 12:37:15 |
| `out\dsh\...\dsh-util-values\lib\index.js` | 29 403 | 2026-11-11 12:36:56 |
| `out-rc2-compat\dsh\...\dsh-tools\lib\index.js` | 24 075 | 2026-11-11 12:37:15 |
| `out-rc2-compat\dsh\...\dsh-util-values\lib\index.js` | 29 403 | 2026-11-11 12:36:56 |
| 目录 `out` / `out-rc2-compat` | — | 2026-11-11 12:36:56 / 12:37:30 |

### 4.3 SHA-256（复验基线）

| 文件（相对 `%TEMP%\dsh-asar-inspect\`） | SHA-256 | git blob（对照文档） |
|---|---|---|
| `out-rc2-compat\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js` | `d02f0d8f36878313b0dae3a1bba5b77f7db4cffc77a0b72772048a36bacf2cf0` | `58335e4727992241ab843dbdcab7e57d6ae71574` |
| `out-rc2-compat\dsh\node_modules\@deepseek-ai\dsh-util-values\lib\index.js` | `8b4ffdf40126d48bd22017b4671f7e90612d01833fc865f7a0b60d3de4183e8b` | `8d802d5c28c96454880a4ef749a3160c6800d2ea` |
| `out\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js` | `1889cbf718d64518dd83245d4dba1e1f080b2c5326259c3ed5b1be7a7666a2bd` | `9a5ac05cd1ee4dbb4a793d691fd3d0068d8dd0fd` |
| `out\dsh\node_modules\@deepseek-ai\dsh-tools\lib\shared-DTdn5dXO.js` | `d02f0d8f36878313b0dae3a1bba5b77f7db4cffc77a0b72772048a36bacf2cf0` | `58335e4727992241ab843dbdcab7e57d6ae71574` |
| `out\dsh\node_modules\@deepseek-ai\dsh-util-values\lib\index.js` | `8b4ffdf40126d48bd22017b4671f7e90612d01833fc865f7a0b60d3de4183e8b` | `8d802d5c28c96454880a4ef749a3160c6800d2ea` |
| `extract-fixture.cjs` | `e9759c71056a9c1d643d90a25fc4ba425753c3670f857d61d5a7cb7b807f9a48` | — |

> `git hash-object` 的 blob SHA 与旧记录对齐，用于证明"引擎代码是 shipped 原文"；SHA-256 是本次新增的稳定校验口径（不依赖 git）。

---

## 5. 复验记录

### 5.1 环境

| 项 | 值 |
|---|---|
| Node | bundled **v24.21.0**（`C:\Users\sir_c\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`） |
| 工作目录 | `D:\Codes\dsh-tree-harness\packages\dsh-session-tree` |
| 脚本 | `test/provider-conformance.cjs`，SHA-256 `a8ee301eae94e203e22a5609cc20be2391c376337a8bdc45dcd3f57af757f7aa` |
| 仓库基线 | `master` @ `e09f39b` |

### 5.2 命令与结果

```powershell
cd D:\Codes\dsh-tree-harness\packages\dsh-session-tree
& "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" test/provider-conformance.cjs
# exit 0
```

完整输出（2026-11-12 实跑，末行为汇总）：

```text
=== SessionTree inspect provider: conformance against the SHIPPED schema engine ===
  fixture: C:\Users\sir_c\AppData\Local\Temp\dsh-asar-inspect\out-rc2-compat (source: known default)
  engine: loaded from C:\Users\sir_c\AppData\Local\Temp\dsh-asar-inspect\out-rc2-compat\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js

=== A. optional injection must degrade silently ===
  PASS  ctx has no inject() at all: apply() does not throw  — null
  PASS  ctx has no inject() at all: sidebar.workspaces still registered  — 1 registration(s)
  PASS  ctx.inject() never calls back (service absent): apply() does not throw  — null
  PASS  ctx.inject() never calls back (service absent): sidebar.workspaces still registered  — 1 registration(s)
  PASS  ctx.inject() calls back with no service (scoped miss): apply() does not throw  — null
  PASS  ctx.inject() calls back with no service (scoped miss): sidebar.workspaces still registered  — 1 registration(s)

=== B. provider registration + manifest subset ===
  PASS  sidebar.workspaces still registered alongside the provider  — 1 registration(s)
  PASS  exactly one inspect provider registered  — 1
  PASS  manifest.id is "SessionTree"  — SessionTree
  PASS  manifest.description is non-empty (Host requires it)
  PASS  exactly one method named "snapshot"
  PASS  method.description is non-empty (Host requires it)
  PASS  input+output schemas pass the shipped subset checker  — null

=== C. query("snapshot", {}) judged by the shipped validator ===
  PASS  unknown method is rejected loudly
  PASS  returns a plain object
  PASS  rowCount matches the DOM  — 6 vs 6
  PASS  groupCount counts only data-kind="workspace"  — 3
  PASS  row order follows document order
  PASS  depth comes from data-depth  — 2
  PASS  paddingLeft is the computed value  — 32px
  PASS  invisible row reported not visible  — {"key":"ws:/Z1","kind":"session","depth":1,"paddingLeft":"19px","label":"游离会话","secondary":"","state":"idle","expanded":false,"color":"rgb(230, 232, 238)","background":"rgba(0, 0, 0, 0)","fontWeight":"400","top":130,"height":0,"visible":false}
  PASS  computed background is reported  — rgba(59, 130, 246, 0.08)
  PASS  answer survives snapshotJsonValue (the Host runs it first)
  PASS  answer passes the shipped output validator  —

=== D. negative controls: the validator must reject tampering ===
  PASS  extra row field is rejected (additionalProperties: false)  — "output.rows[0].unexpectedField" is not a declared property (additionalProperties: false)
  PASS  missing required row field is rejected  — missing required property "output.rows[0].visible"
  PASS  wrong scalar type is rejected  — "output.rows[0].depth" must be a number
  PASS  extra root field is rejected  — "output.extra" is not a declared property (additionalProperties: false)
  PASS  an unsupported keyword would have been caught at publish time  — unsupported JSON schema: schema.properties.rows.items.properties.key.format is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)

==================== ALL CHECKS PASSED (29/29) ====================
fixture: C:\Users\sir_c\AppData\Local\Temp\dsh-asar-inspect\out-rc2-compat
```

统计：`PASS` 行 **29**、`FAIL` 行 **0**、exit **0**。

### 5.3 改动前的原始失败（留档，证明问题真实存在）

默认路径仍是旧默认 `%TEMP%\dsh-asar-inspect\out` 时（改动前）：

```text
=== SessionTree inspect provider: conformance against the SHIPPED schema engine ===
conformance run crashed: Error: json-schema region not found in dsh-tools (file=C:\Users\sir_c\AppData\Local\Temp\dsh-asar-inspect\out\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js, bytes=27415, lines=666, start=-1, declaredAt=-1, end=-1)
    at extractShippedEngine (D:\Codes\dsh-tree-harness\packages\dsh-session-tree\test\provider-conformance.cjs:64:11)
    ...
[exit code: 1]
```

即：旧默认目录（新版拆包布局）会让测试**以堆栈崩溃**的方式退出，容易被误读成"包内容缺陷"。

---

## 6. 缺 fixture / 非 rc.2 时的错误表现（实测）

改动后三种场景均实测（2026-11-12）：

| 场景 | 触发方式 | 行为 | exit |
|---|---|---|---|
| 已知默认路径都不存在 | 把 `TEMP` 指向空目录后直接运行 | 列出两个候选目录及各自缺失项 + 获取步骤，无堆栈 | **2** |
| 显式传入非 rc.2 目录 | `node test/provider-conformance.cjs %TEMP%\dsh-asar-inspect\out` | 指出 `out` 的 `dsh-tools/lib/index.js` 无内联 region（引擎在 `./shared-*.js`），并给获取步骤 | **2** |
| 环境变量指定 rc.2 目录 | `$env:DSH_RC2_FIXTURE_DIR='<dir>'` 后运行 | 正常 29/29，打印 `source: env DSH_RC2_FIXTURE_DIR` | 0 |

缺 fixture 的 stderr 摘要（原文，`<TEMP>` 为实际临时目录）：

```text
[fixture] fixture 缺失或不兼容 rc.2（missing or not rc.2-compatible）：
  provider-conformance 需要一份「rc.2 兼容」的 DSH asar 解包目录（内联 json-schema 引擎 + dsh-util-values）。

已检查（checked）:
  - ...\out-rc2-compat  [known default]
      missing ...\dsh\node_modules\@deepseek-ai
  - ...\out  [known default]
      missing ...\dsh\node_modules\@deepseek-ai

获取步骤（how to provide the fixture）:
  1) 解包 rc.2 版 DSH app.asar 的两个文件到 ...\out-rc2-compat
     node "...\extract-fixture.cjs" "<rc.2 app.asar>" "...\out-rc2-compat" "dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js" "dsh/node_modules/@deepseek-ai/dsh-util-values/lib/index.js"
  2) 或指向已有的 rc.2 兼容目录（本次记录见 docs/reports/conformance-rc2-2026-11-12.md）:
     $env:DSH_RC2_FIXTURE_DIR = '<dir>'   # PowerShell；或 node test/provider-conformance.cjs <dir>
  3) 若只有新版 DSH（引擎在 dsh-tools/lib/shared-*.js），在解包副本里把该 shared chunk 复制为 dsh-tools/lib/index.js
     （out-rc2-compat 就是这样构造的：逐字节 verbatim，不改安装目录本身）；
     单纯重跑不会成功，本脚本不会把缺 fixture 当成断言失败。
```

显式传入 `out` 时的原因行：

```text
      not rc.2-compatible: dsh-tools/lib/index.js has no inline "lib/types/json-schema.js" region (newer build: the engine lives in ./shared-*.js) [region=false, validateJsonSchemaValue=false]
```

**退出码语义**：`0` = 29/29；`1` = 断言失败或脚本内部崩溃；`2` = fixture 配置问题（缺失/不兼容）。缺 fixture **不计**为断言失败。

---

## 7. 脚本改动（逐项）

只改 `packages/dsh-session-tree/test/provider-conformance.cjs`，且限定在 fixture 定位 / 错误信息 / 文档注释：

1. **定位顺序**：CLI 参数（沿用原约定 `argv[2]`）→ `DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `%TEMP%\dsh-asar-inspect\out`。显式指定的候选（CLI/env）不可用即报错，**不静默回退**；默认候选逐个探测，取第一个可用。
2. **兼容性预检**：`probeFixture()` 检查两个文件存在，并检查 `dsh-tools/lib/index.js` 是否内联 region + `validateJsonSchemaValue`；能识别"新版拆包布局"并给出原因，不再等到 `extractShippedEngine` 抛堆栈。
3. **报错**：`FixtureError` 在 `main().catch` 中单独处理——打印候选、缺失项、获取步骤，exit 2，无堆栈。
4. **成功路径**：打印 `fixture: <实际路径> (source: ...)`，汇总行改为 `ALL CHECKS PASSED (29/29)` 并在末尾再打印一次 fixture 路径（便于 CI 日志取证）。
5. **计数**：新增仅用于汇总显示的 `checks` 计数器；`check()` 的判定逻辑与 29 个调用点**未改动**。
6. `extractShippedEngine(pkgs)` 改为接收解析出的包目录参数（原模块级 `PKGS` 常量删除）；提取逻辑本身未动。

断言分布（与改动前一致）：A 6 + B 7 + C 11 + D 5 = **29**。

---

## 8. 文档检查

```powershell
cd D:\Codes\dsh-tree-harness
node scripts/check-doc-links.mjs
node scripts/check-md-tables.mjs
```

实测输出（2026-11-12，bundled node v24.21.0，均 exit 0）：

```text
checked 69 files (skipped 4 historical artifacts)
LINK CHECK OK
TABLE CHECK OK
```

本报告同时按 `docs/README.md` §5 规则登记到 §3 报告表。

---

## 9. 环境依赖与漂移说明（重要）

1. **fixture 不在仓库内**：它位于 `%TEMP%`，可能被系统清理；仓库只保存脚本 + 本报告。`%TEMP%` 被清后重跑会得到 exit 2 的可操作报错，而不是 29/29。
2. **随 DSH 版本漂移**：DSH 只要改变 `dsh-tools` 的打包布局（内联 ↔ shared chunk）、region 标记、或 `dsh-util-values` 的导出形状，本测试的提取启发式就需要适配。本机安装的是 `0.2.2-rc.1`（拆包布局），所以**必须**用兼容副本才能得到 29/29；这不是包内容缺陷。
3. **兼容副本不伪造引擎**：`out-rc2-compat/dsh-tools/lib/index.js` 与 asar 内 `shared-DTdn5dXO.js` **逐字节相同**（SHA-256 一致），测试验证的仍是 shipped 代码原文；差异只在"文件摆在哪个路径"。
4. **重建方法**（本机已有 `extract-fixture.cjs`）：
   ```powershell
   node "$env:TEMP\dsh-asar-inspect\extract-fixture.cjs" "D:\DSHarness\resources\app.asar" "$env:TEMP\dsh-asar-inspect\out-rc2-compat" `
     "dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js" `
     "dsh/node_modules/@deepseek-ai/dsh-util-values/lib/index.js"
   # 若该版本是拆包布局（index.js 只有 re-export），把同目录的 shared-*.js 复制为 index.js：
   Copy-Item "$env:TEMP\dsh-asar-inspect\out-rc2-compat\dsh\node_modules\@deepseek-ai\dsh-tools\lib\shared-DTdn5dXO.js" `
             "$env:TEMP\dsh-asar-inspect\out-rc2-compat\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js" -Force
   ```
5. **长期建议**（不在本 leaf 写作用域）：把提取启发式升级为"内联 region 或 shared chunk 均可"，并在 DSH 版本 bump 时把 fixture 的 SHA-256 固化进测试或 CI。当前按任务要求**不修改其它测试语义**。
6. **不要提交 `%TEMP%` fixture**：它含第三方 shipped 源码全文，且体积/版本都会漂移；仓库只需本报告的来源链与 SHA-256。

---

## 10. 复验清单（DoD 对照）

| DoD / 必做项 | 证据 | 结果 |
|---|---|---|
| 先读脚本、弄清 fixture 布局/29 断言/当前失败原因 | §2、§5.3；29 = A6+B7+C11+D5 | 完成 |
| 探测两套 fixture、判断 rc.2 兼容性 | §3、§4.3（SHA-256/blob 对照） | 完成 |
| 改脚本：env → 默认路径 → 可操作报错；成功打印 29/29 + 路径 | §6、§7 | 完成（实测三种场景） |
| 实跑 29/29 PASS，exit 0 | §5.2 完整输出 | **29/29** |
| 报告：来源/时间/清单/SHA-256/命令/结果/缺 fixture 表现/漂移说明 | 本文件 §4–§9 | 完成 |
| `docs/README.md` §3 加一行索引 | `docs/README.md` §3 | 完成 |
| `check-doc-links.mjs` + `check-md-tables.mjs` | §8 | 通过 |
