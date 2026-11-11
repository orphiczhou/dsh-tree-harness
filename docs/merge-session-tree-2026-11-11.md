# 会话树合并为单包 — 合并记录（2026-11-11 / 任务 T1）

- **任务**：`task-1`（T1），owner `merge-engineer`
- **决策依据**：D1（方案 B⁺：单包迁入本仓 `packages/dsh-session-tree/`，本仓成为唯一源码事实源）、D5（publish 副本降级为历史参考，不复制进仓）、D6（本次迁移**不 bump**，包内容与发布副本逐字节一致）
- **结论**：`packages/dsh-session-tree/` 是已发布单包 `@orphiczhou/dsh-session-tree@1.0.4` 的**逐字节副本**（15/15 文件 `git hash-object` 一致）；包内 3 个测试全部通过；发布同步脚本 `scripts/release-plugin.mjs` 已落地并在系统临时目录完成 12/12 项自测。
- **profile 迁移（T2）**：本机 desktop profile 已从两个 `@local` 开发包切换到单包 `@orphiczhou/dsh-session-tree`（link 本仓），活体验证通过（`tree_send` ×1、8 个 `tree_*` 齐全、Config entry 存在）；见 §8，回滚步骤见 §9。

---

## 1. 源与 provenance

| 项 | 值 |
|---|---|
| 源路径 | `C:\Users\sir_c\Documents\deepseek-harness\default-workspace\publish\dsh-session-tree\` |
| 包名 / 版本 | `@orphiczhou/dsh-session-tree` / **1.0.4** |
| 公开仓 | `git+https://github.com/orphiczhou/dsh-session-tree.git`（v1.0.4 已发布；**npm 未发布**，按 D3 冻结） |
| 迁移前的独立核对 | 发布副本 9 个根文件 git blob SHA 与 GitHub main 核对 **9/9 一致**（Lead 在本轮前完成） |
| 迁移方式 | **递归复制发布副本**（`Copy-Item -Recurse`），不重新生成、不改写任何文件 |
| 目标路径 | `D:\Codes\dsh-tree-harness\packages\dsh-session-tree\`（`hmr.root` 内，保留热更） |
| 文件数 / 总字节 | 15 个文件 |

迁移后本仓该目录即**唯一发布源**：以后的改动只发生在 `packages/dsh-session-tree/`，再经 `scripts/release-plugin.mjs` 单向同步到公开插件仓。

## 2. 目标目录结构（与发布副本完全一致）

```
packages/dsh-session-tree/
├── .gitignore                    219 B
├── LICENSE                     1 067 B
├── README.md                  20 544 B
├── README.zh.md               19 166 B
├── client.js                  74 265 B   # 浏览器半（侧栏会话树 UI）
├── cordis.patch.yml              632 B   # 单条 insert row
├── icon.svg                      642 B
├── index.js                    6 146 B   # Host 半（tree_send 工具）
├── package.json                1 435 B   # name/version/dsh.bundle/dsh.client 合一
├── locale/en.json                196 B
├── locale/zh.json                185 B
├── scripts/verify-bundle.mjs   7 994 B   # 包内 manifest 自检
└── test/
    ├── render.test.cjs        70 453 B   # 107 参考断言 + 自检 + 实时附加
    ├── provider-conformance.cjs 16 289 B # 对 shipped JSON-Schema 引擎的一致性
    └── style-guard.cjs        13 681 B   # 样式自愈守卫
```

## 3. 旧双包 → 单包映射

迁移前本机 profile 装的是两个开发态 `@local` 包（目录**保留、未删除**，仅从 profile 卸载）：

| 旧包 | 目录 | 作用 | 关键文件 |
|---|---|---|---|
| `@local/dsh-session-tree` | `default-workspace/dsh-session-tree/` | 浏览器半：左栏会话树 UI | `client.js` 74 260 B、`index.js` 1 028 B（**空 apply**）、`cordis.patch.yml` |
| `@local/dsh-session-tree-tools` | `default-workspace/dsh-session-tree-tools/` | Host 半：`tree_send` 工具 | `index.js` 5 466 B、`cordis.patch.yml` |

**patch 层映射**（两条 insert row → 一条）：

```yaml
# 旧：@local/dsh-session-tree/cordis.patch.yml
- insert:
    - id: session-tree
      name: '@local/dsh-session-tree'

# 旧：@local/dsh-session-tree-tools/cordis.patch.yml
- insert:
    - id: session-tree-tools
      name: '@local/dsh-session-tree-tools'

# 新：packages/dsh-session-tree/cordis.patch.yml
- insert:
    - id: session-tree
      name: '@orphiczhou/dsh-session-tree'
```

**语义映射**：

| 维度 | 旧双包 | 新单包 |
|---|---|---|
| profile bundles | 2 条（UI + Tools） | 1 条（`@orphiczhou/dsh-session-tree`） |
| Loader patch rows | 2 行（`session-tree` + `session-tree-tools`） | 1 行（`session-tree`） |
| 安装规格 | 2 个 install spec | 1 个 install spec |
| Host `index.js` | 空 apply（UI 包）+ `tree_send`（Tools 包） | 合并为一个：`name='session-tree'`，`apply(ctx)` 内 `ctx.inject(['tools','subagents','sessionQuery'])` 注册 `tree_send` |
| 浏览器半 | `client.js`（module id `@local/dsh-session-tree`） | 同一份 `client.js`，module id 随包名改为 `@orphiczhou/dsh-session-tree` |
| 运行时行为 | UI 渲染 + `tree_send` 各注册一次 | **不变**：UI 渲染 + `tree_send` 各注册一次 |

> **重要说明**：本次工作是「把已发布的合并产物搬进本仓」，不是「现场重新做一次合并」。因此**不要求**新单包与旧双包逐字节相同——合并的权威产物就是公开发布的 v1.0.4 单包本身。旧双包的 `index.js` 注释中记录的「Host 模块缓存 / 禁止双注册」设计理由，已由单包 `index.js` 的头部注释承接。

## 4. 内容一致性验证（逐字节）

方法：对源与目标逐个文件执行 `git hash-object`（blob SHA-1，只看文件内容，不受换行/编码转换影响），并比对两侧文件集合。

| 文件 | git blob SHA-1（源 = 目标） |
|---|---|
| `.gitignore` | `c023bb18ed5fde4becbbf7f4b01fd3b9f8a691a5` |
| `client.js` | `02a7f4e1dac5a9ad8ae6d2c389f924e75aac1c75` |
| `cordis.patch.yml` | `30a1c65a472011979621607309f0d7dccba50310` |
| `icon.svg` | `5fe691edba196364eb8db19ff35dbcaad625d9aa` |
| `index.js` | `cb2afa7a4f0a1b0c809bf28e36014a42a0a9db9f` |
| `LICENSE` | `d06e23ffcbb0f48f3c1c781d4f6fb31593a637a5` |
| `locale/en.json` | `b26c1611125ac272a94ffa25a2e498b0426cb141` |
| `locale/zh.json` | `30d2f227e32fe4e3fc2083a2cf5e536dd0e33c59` |
| `package.json` | `331cac56c74adb2346df9d111148cf52b7c5ddc7` |
| `README.md` | `21e4d978ba105dada986b3381414165b3e5c997f` |
| `README.zh.md` | `c5cd1aa2f385ae76999a598880aae8eac19b828e` |
| `scripts/verify-bundle.mjs` | `0e4eeca6d4498116a607853a2c7347f7bcdf6fc3` |
| `test/provider-conformance.cjs` | `adc18cdbb94890e93b4d206021b53ef4fd1a3d2a` |
| `test/render.test.cjs` | `5c13929deceebb2127200e4279fc4e3a84ed961f` |
| `test/style-guard.cjs` | `f597415ba7366f747e3803393e2c0dd144104054` |

**结果：`TOTAL=15 MATCH=15 MISMATCH=0`；两侧文件集合完全一致（无 target-only / source-only 文件）。**

→ 满足 D6：包内容未改写、`version` 保持 `1.0.4`，它仍是公开发布副本的真实副本。

## 5. 包内测试结果

运行时：bundled node `v24.21.0`
（`%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`），工作目录 `packages/dsh-session-tree/`。

| 测试 | 命令 | 退出码 | 断言 |
|---|---|---|---|
| 渲染 | `node test/render.test.cjs` | **0** | 参考套件对齐 **107/107**、夹具/套件自检 **9/9**、实时会话库附加 **11/11**；合计失败 **0** 项 |
| Provider 一致性 | `node test/provider-conformance.cjs` | **0** | **29/29** PASS（A 6 + B 7 + C 11 + D 5），含 5 项负向对照（篡改必须被 shipped validator 拒绝） |
| 样式自愈守卫 | `node test/style-guard.cjs` | **0** | **22/22** PASS（A 19 + B 2 + C 1） |

**provider-conformance 的环境说明（重要，如实记录）**：
该测试从本机 DSH 安装的 `app.asar` 中提取 **shipped** JSON-Schema 引擎参与判定，官方用法是传入已解包的 asar 目录（默认 `%TEMP%\dsh-asar-inspect\out`）。

- 本机 `%TEMP%` 中该 fixture 已不存在（临时目录被清理），直接运行先是 `ENOENT`；
- 重新按 rc.2 布局解包后仍失败：DSH **0.2.2-rc.1** 把引擎拆到 `dsh-tools/lib/shared-DTdn5dXO.js`，而测试的 region 提取启发式期望它内联在 `dsh-tools/lib/index.js`（旧版布局）。这是**测试的环境依赖随 DSH 版本漂移**，不是包内容缺陷；
- 为得到有效判定，用**逐字节 verbatim 的 shipped shared chunk** 构造了 rc.2 兼容 fixture（`%TEMP%\dsh-asar-inspect\out-rc2-compat`，其中 `dsh-tools/lib/index.js` = shipped `shared-DTdn5dXO.js`，blob SHA `58335e4727992241ab843dbdcab7e57d6ae71574`；`dsh-util-values/lib/index.js` = shipped 原文，blob SHA `8d802d5c28c96454880a4ef749a3160c6800d2ea`），随后 **29/29 全绿**。被验证的引擎代码是 shipped 代码的原文；
- **包内文件未做任何修改**（SHA 表见 §4）。后续维护提示：该测试的布局启发式需要在公开插件仓下一次版本 bump 时适配 DSH 0.2.2+ 的 chunk 布局（本次 D6 约束下不改内容，仅记录）。

## 6. 发布同步流程

唯一事实源 = 本仓 `packages/dsh-session-tree/`；公开插件仓 = 它的镜像。**禁止手工双写**。

```powershell
# 1) 改代码后先按 D6 纪律 bump packages/dsh-session-tree/package.json 的 version
# 2) 包内自检与测试
node packages/dsh-session-tree/scripts/verify-bundle.mjs
node packages/dsh-session-tree/test/render.test.cjs
node packages/dsh-session-tree/test/provider-conformance.cjs
node packages/dsh-session-tree/test/style-guard.cjs

# 3) 同步到公开插件仓的本地 checkout（逐文件 SHA-256 校验，不执行 git）
node scripts/release-plugin.mjs --target <public-repo-checkout>

# 4) 人工在公开仓执行脚本打印的 git 命令（Lead/维护者独占）
#    git status --short / git add -A / git commit -m "sync: ..." / git push origin main
```

脚本行为（`scripts/release-plugin.mjs`，纯 ESM、仅 Node 内置模块）：

- `--target <dir>`：镜像目标目录；`--source <dir>` 可覆盖源（默认本仓 `packages/dsh-session-tree`）；
- 复制后**逐文件**重新读取目标并与源做 SHA-256 比对；输出每个文件的完整 SHA；`files/match/mismatch/missing/extra` 统计；
- **绝不运行 git、绝不 push、绝不改 version**；只打印公开仓需要执行的 git 命令；
- `--check`：只校验不写；`--prune`：删除目标中多余文件（不加时为严格模式：有多余文件即非零退出）；`--force`：放行「目标 `package.json` 包名不符」的错仓告警；
- 安全护栏：拒绝 source==target、拒绝写进 source 子目录、拒绝写进 source 的父目录；
- 缺省（无 `--target`）打印用法与 `--help` 并以非零退出；`--help` 退出 0。

**自测（系统临时目录，未污染仓库）**：12/12 项通过 —— `--help`(0)、无参数用法(1)、首次同步 15/15、独立 `git hash-object` 复核 15/15、幂等重跑 15/15、多余文件严格失败(1)、`--prune` 清除后 15/15、篡改后 `--check` 报 1 处 MISMATCH(1)、重同步修复 15/15、错仓包名拒绝(1)、`--force` 放行 15/15、父目录护栏拒绝(1)。临时目录已清理。

## 7. 明确不做的事

- **不改包内容、不 bump 版本**：保持 `@orphiczhou/dsh-session-tree@1.0.4`（D6；避免 market 误判更新）；
- **不删除旧包目录**：`default-workspace/dsh-session-tree/`、`default-workspace/dsh-session-tree-tools/` 原样保留；
- **不动本仓其它内容**：`packages/` 下其它包、根 `README.md`、`LICENSE`、`agenda.md`、`.gitignore`、他人未提交的改动一律不碰；
- **不执行任何 git 写命令**（add/commit/push/reset/checkout 由 Lead 独占）；
- **不发布 npm**（D3 冻结）。

## 8. profile 迁移记录（T2，2026-11-11）

**目标**：本机 desktop profile 从「两个 `@local` 开发包」切换到「单包 `@orphiczhou/dsh-session-tree`（link 本仓 `packages/dsh-session-tree`）」。

**备份**：

- `C:\Users\sir_c\.dsh\profiles\desktop\package.json` → `package.json.bak-2026-11-11`（同目录）
- 迁移前 live 文件 SHA-1（`git hash-object`）：`2768fd5899f89c6fdd07428e010441d311bd5165`（与备份核对一致）
- 迁移后 live 文件 SHA-1：`e62b408864eed3818927f2e8a627315b1e86bee7`

**执行方式**：走 `plugin_manager`（HMR 生效，每次返回 `changed=true` / `application=applied` / pnpm `exitCode=0`），未手改 profile 清单：

1. `plugin_manager remove_bundle target=@local/dsh-session-tree-tools`
2. `plugin_manager remove_bundle target=@local/dsh-session-tree`
3. `plugin_manager install_bundle target=D:/Codes/dsh-tree-harness/packages/dsh-session-tree`
   → `stage=enable`、`target=@orphiczhou/dsh-session-tree`、`version=1.0.4`、`enabled=true`、`application=applied`
   （绝对路径安装 → pnpm 记录 `+ @orphiczhou/dsh-session-tree 1.0.4 <- D:\Codes\dsh-tree-harness\packages\dsh-session-tree`）

**迁移前后 profile 差异**（`C:\Users\sir_c\.dsh\profiles\desktop\package.json`）：

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| `dsh.profile.bundles` 数量 | 29 | 28 |
| 会话树 bundle | `@local/dsh-session-tree-tools`（index 4）、`@local/dsh-session-tree`（index 5） | `@orphiczhou/dsh-session-tree`（index 27，末尾；启用时自动追加） |
| 会话树 dependencies | 2 条 link（指向 default-workspace 旧包目录） | 1 条 `"@orphiczhou/dsh-session-tree": "link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree"` |
| profile `node_modules` 解析 | 两个旧包 junction | `@orphiczhou/dsh-session-tree` → 本仓 packages 目录，`name/version` = `@orphiczhou/dsh-session-tree` / `1.0.4` |
| 旧包目录（`default-workspace/dsh-session-tree{,-tools}`） | 保留 | **保留未删**（12 / 4 个文件） |

**活体验证**（`cordis_inspect_query`，platform=host；迁移后读取）：

| 检查项 | 结果 |
|---|---|
| `Tool.listTools`：`tree_send` 出现次数 | **1**（恰好一次，无重复注册） |
| `Tool.listTools`：`tree_plan` / `tree_node` / `tree_dispatch` / `tree_report` / `tree_status` / `tree_verify` / `tree_log` / `tree_maintain` | **8/8 各 ×1**（`tree_*` 合计 9 = `tree_send` + 8） |
| `Config.listConfigs` name=`@orphiczhou/dsh-session-tree` | 1 entry：`id=include:session-tree`、`patchId=session-tree`、**status=`absent`**（该 entry 未声明 config schema，`absent` 表示无配置；loader 已装配） |
| `Config.listConfigs` name=`@local/dsh-session-tree` | `entries=[]`、`total=0`（旧 entry 已消失） |
| `Config.listConfigs` name=`@local/dsh-session-tree-tools` | `entries=[]`、`total=0`（旧 entry 已消失） |
| 迁移前基线（对照） | `include:session-tree` → `@local/dsh-session-tree`（absent）；`include:session-tree-tools` → `@local/dsh-session-tree-tools`（absent）；`tree_send` ×1 |

**客户端半**：本次即时生效的是 Host 半；迁移前已打开的页面仍持有旧的 client 实例。**刷新页面一次**后才会加载新单包的 `client.js`（左栏会话树 UI + `SessionTree` inspect provider）。

**残留说明**：profile `node_modules` 下两个旧 `@local/*` junction 未随清单移除（已不在 dependencies/bundles 中，不参与组合与加载；属 pnpm 未清理的孤儿 junction）。无功能影响，未手动删除（避免误删 junction 指向的旧包目录）。

## 9. 回滚步骤（T2）

前提：已备份 `package.json.bak-2026-11-11`（SHA-1 `2768fd5899f89c6fdd07428e010441d311bd5165`）。
回滚顺序：**解除新单包 → 还原清单 → 重建依赖 → 重新启用两个旧包 → 刷新页面**。

```powershell
# 0) 解除新单包（HMR 下立即应用，同时移除 link 依赖）
#    plugin_manager action=remove_bundle target=@orphiczhou/dsh-session-tree

# 1) 还原迁移前的 profile 清单，并核对 SHA
Copy-Item "C:\Users\sir_c\.dsh\profiles\desktop\package.json.bak-2026-11-11" `
          "C:\Users\sir_c\.dsh\profiles\desktop\package.json" -Force
git hash-object -- "C:\Users\sir_c\.dsh\profiles\desktop\package.json"
#    期望：2768fd5899f89c6fdd07428e010441d311bd5165

# 2) 按还原后的清单重建依赖（bundled runtime 的 pnpm）
node "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install `
     --dir "C:\Users\sir_c\.dsh\profiles\desktop"

# 3) 重新启用两个旧 bundle（二选一）
#    a) 不重启：plugin_manager action=set_bundle target=@local/dsh-session-tree-tools enabled=true
#                plugin_manager action=set_bundle target=@local/dsh-session-tree enabled=true
#    b) 或重启 DSH 桌面应用：启动时按还原后的清单组合（最确定）
```

4. **刷新页面**：客户端半从旧包重新加载（否则页面仍持有迁移后的实例）。
5. **回滚验收**：`Tool.listTools` 中 `tree_send` ×1；`Config.listConfigs` 重新出现两个 `@local/*` entry（status=`absent`），不再出现 `@orphiczhou/*`。

注意：

- 旧包目录**未删除**，回滚不需要恢复文件，只需恢复清单与依赖；
- 若第 2 步后 profile `node_modules` 仍缺旧包 junction，可重跑 pnpm install，或直接用 `plugin_manager install_bundle` 指向两个旧包目录的绝对路径；
- 回滚属 profile 级变更，影响该 profile 下**所有会话**；Host 半即时生效，客户端半需刷新页面。
