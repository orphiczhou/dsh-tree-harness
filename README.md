# dsh-tree-harness

> **DSH（DeepSeek Harness）树形任务分解执行 Harness + 插件集合**。
> A tree-structured task decomposition & execution harness for DeepSeek Harness, plus a small collection of DSH plugins.

本仓不是一个单一插件，而是一组围绕「树形任务执行」的包、规约与文档：任务分解 → 分层派发（子智能体嵌套）→ 执行 → 分任务类型验证 → 收割回流，外加治理层（方法轮）、自省层与会话树视图。

- 许可证：**MIT**（见 [LICENSE](LICENSE)）
- 状态与测试数字为 **2026-11-11 实测快照**（各包 `package.json` 版本为准）
- 公开范围：**仓库内资料公开**（公开前已排除隐私截图与第三方源码，见 [agent.md](agent.md) 决策 D7）
- 代码零 npm 依赖：不 import 任何 `@deepseek-ai/*` 包，仅通过宿主 `ctx` 使用 DSH 原生服务（`subagents` / `timer` / `storage` / `tools` / `sessionQuery` 等）

---

## 组件与状态

| 包 | 版本 | 能力 | 测试 | 当前状态 |
|---|---|---|---|---|
| [`packages/dsh-tree-engine`](packages/dsh-tree-engine/) | 0.5.0 | 执行层：8 个 `tree_*` 工具（`tree_plan` / `tree_node` / `tree_dispatch` / `tree_report` / `tree_status` / `tree_verify` / `tree_log` / `tree_maintain`），含依赖编排、竹节接力（上下文自动换棒）、对抗式验证、差分金标准；**随包 tree-commander/tree-worker Skill** | **67/67** | ✅ 运行中（本机 desktop profile 已装载） |
| [`packages/dsh-meta-loop`](packages/dsh-meta-loop/) | 0.2.0 | 治理层：六阶段方法轮 + **G1–G11** 机械门禁 + `/metaloop/` Web 面板 + M4 递归触发表 | **13/13** | ⏸ 未装配（不在 profile bundles，按需装载） |
| [`packages/dsh-agent-introspect`](packages/dsh-agent-introspect/) | 0.1.0 | 自省层：`self_spec` 工具，投影当前会话的 model / permissions / sandbox / cwd / token 用量 | —（无单测） | ✅ 运行中 |
| [`packages/dsh-session-tree`](packages/dsh-session-tree/) | 1.3.0 | 会话树单包：左栏嵌套会话树 + `tree_send` 跨层级消息工具 + **`session_handoff` 会话自交接**（同层级接替，继承工作区 / Agent 预设（工作模式）/ 权限模式 / 模型 / 思考等级）+ **随包 `session-handoff` Skill**（Skill 目录可发现）；工作区排序 / 隐藏恢复 / 检索召回 | 包内 5 份测试（handoff 34/34、render 全绿、style-guard 22/22、verify-bundle 0 fail） | 🌐 GitHub 公开（**v1.3.0**）、社区市场已收录；**npm 未发布** |

状态口径：

- **运行中** = 当前本机 desktop profile 已装载，并通过活体检查（`cordis_inspect_*` 读到对应工具 / provider）。
- **未装配** = 源码与测试在本仓，但不在 profile 的 `dsh.profile.bundles` 里；装载即可用，无需改代码。
- **npm 未发布** = 刻意的安装策略（只走 Git / `link:`），见 [docs/publishing.md](docs/publishing.md)；决策 D3。

---

## 快速开始

### 前置

- **DSH 桌面版 `0.2.2-rc.1`**（Cordis 插件宿主 + Web GUI）
- DSH 自带的 Node v24 runtime（实测 v24.21.0），无需额外安装；各包无 npm 依赖
- 本仓 `packages/` 建议放在 desktop profile 的 `hmr.root` 覆盖范围内（本机即为 `D:/Codes/dsh-tree-harness/packages`），客户端半改动刷新页面即可；**宿主半（`index.js`）改动在本机实测需对该 bundle 做一次 disable→enable（或用新包名/重启 DSH）才加载新实现**——Loader 对已导入宿主模块按包名缓存，逐条证据见 [agent.md](agent.md) §0.2。

### 安装到 profile

两种方式，二选一：

**A. `link:` 依赖 + 一次性 pnpm install**（开发态推荐）

```jsonc
// %USERPROFILE%\.dsh\profiles\desktop\package.json（示例，按实际 profile 调整）
{
  "dsh": {
    "profile": {
      "bundles": [
        "@local/dsh-tree-engine",
        "@local/dsh-agent-introspect",
        "@orphiczhou/dsh-session-tree"
        // 注意：bundle 顺序即装载顺序；meta-loop 如要装配，在此追加 "@local/dsh-meta-loop"
      ]
    }
  },
  "dependencies": {
    "@local/dsh-tree-engine": "link:D:/Codes/dsh-tree-harness/packages/dsh-tree-engine",
    "@local/dsh-agent-introspect": "link:D:/Codes/dsh-tree-harness/packages/dsh-agent-introspect",
    "@orphiczhou/dsh-session-tree": "link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree"
  }
}
```

然后使用 DSH 自带 runtime 的 pnpm 安装：

```powershell
node "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
```

新增包后需一次 `pnpm install`；客户端半改动刷新页面生效；宿主半（`index.js`）改动需 disable→enable 该 bundle 条目（或重启 DSH）——2026-11-11 实测 hmr.root 并未让已加载包的宿主模块重新求值。

**B. `plugin_manager` 热装载**

```jsonc
// 伪调用：实际以当前宿主 plugin_manager 工具参数为准
plugin_manager({ action: "install_bundle", target: "D:/Codes/dsh-tree-harness/packages/dsh-tree-engine" })
```

每个包自带 `cordis.patch.yml`，向 profile 贡献一条 `insert` 行（id 分别为 `tree-engine` / `meta-loop` / `agent-introspect` / `session-tree`）。`plugin_manager` 需要宿主授予较高权限；若只想改源码热更，走方式 A 即可。

### 跑测试

```powershell
cd packages/dsh-tree-engine
node --test tests/*.test.js     # tests 67 / pass 67 / fail 0（62 引擎 + 4 技能打包 + 1 B1 回归）

cd ../dsh-meta-loop
node --test tests/*.test.js     # tests 13 / pass 13 / fail 0
```

⚠️ **不要写成 `node --test tests`**：Node 24 会把 `tests` 当文件路径，报 `test at tests:1:1` 的假失败。要机器可读计数加 `--test-reporter=tap`，且**必须放在位置参数之前**（放后面会被静默忽略）。

会话树单包（`packages/dsh-session-tree/`）自带 5 份测试：

```powershell
cd packages/dsh-session-tree
node test/handoff.test.js      # 宿主半 session_handoff：34/34（交接层级矩阵/继承/工作区归属/闸门/失败可追溯）
node test/skills.test.cjs      # 随包 Skill 打包回归：3/3（frontmatter/files/patch 行）
node test/render.test.cjs      # 确定性夹具渲染检查（133/133 + 夹具自检 9/9 + 实时附加 11/11）
node test/style-guard.cjs      # 样式注入 / SSR 边界检查：22/22
node scripts/verify-bundle.mjs # 清单自检：0 fail
node test/provider-conformance.cjs [asar 解包目录]
# 默认读 %TEMP%\dsh-asar-inspect\out（一份含 dsh/node_modules/... 的 DSH 解包树）；
# 缺该目录时会 ENOENT，属环境依赖，不是代码失败
# DSH 0.2.2-rc.1 需 rc.2 兼容解包 fixture 才能得到 29/29 判定（细节见 docs/merge-session-tree-2026-11-11.md §5）
```

### 验证运行

| 手段 | 用途 |
|---|---|
| `self_spec` | 返回当前会话的 model / permissions / sandbox / cwd / token 投影（effort、温度显式标注不可读） |
| `cordis_inspect_list` / `cordis_inspect_query` | 可编程活体观测：列出 provider、查询 host Tool / Service / Config 与 client provider |
| `tree_status {action:"validate"}` | 校验树状态（迁移闭集 / 依赖 / 会话 id 唯一性等） |
| `tree_status {action:"harvest"}` | 显式收割（当前宿主无 `timer` 服务时的降级路径） |

---

## 架构要点

### 宿主半 / 客户端半

一个 DSH bundle 由两半组成，声明都在 `package.json`：

- **宿主半**：`dsh.bundle.patch` 指向 `cordis.patch.yml`。bundle 装载时向 profile 追加一行 `insert`（`id` + 包名），Loader 据此 import 宿主模块（`exports["."]`）。
- **客户端半**：`dsh.client`（`platform: "web"`，可带 `inject` 客户端包，如 `@deepseek-ai/dsh-client-ui-sidebar`）。浏览器侧经 `window.__ModuleLoader__.load({id, factory})` 物化；缺 `inject` 依赖则客户端半边不加载，而宿主半边照常。

客户端半契约（踩坑记录，写进 [docs/handoff-2026-10-14.md](docs/handoff-2026-10-14.md) §5）：

- `factory` 必须 `return module.exports`（插件对象含 `apply`），否则整页客户端启动冲突；
- 所有 DOM 副作用放在 `apply(ctx)` 里；
- 客户端半热更会**残留旧实例**：用单例注册表 + 令牌仲裁压制，彻底干净仍需刷新一次页面。

### 随包 Skill（SKILL 工程化，v0.5.0 / v1.3.0）

Skill 是插件工程的一部分，与工具同包、同版本、同发布：

| 包 | 随包 Skill | 挂载方式 |
|---|---|---|
| `packages/dsh-tree-engine` v0.5.0 | `skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md` | `cordis.patch.yml` 第 2 行 insert `@deepseek-ai/dsh-skill-filesystem`（`providerName: tree-engine`、`includeDefaultRoots:false`、`bundledSkillDir` 经安装包身份解析到包内 `skills/`） |
| `packages/dsh-session-tree` v1.3.0 | `skills/session-handoff/SKILL.md` | 同模式，`providerName: session-tree` |

- 效果：新会话的 Skill 目录直接出现 `tree-commander` / `tree-worker` / `session-handoff`，模型在**极简提示词**下即可发现「分层分解 / 逐层干活 / 上下文 50% 自主交接」的用法，不需要先把工具名喂给它；真机验证见 [docs/skill-e2e-2026-11-11.md](docs/skill-e2e-2026-11-11.md)。
- 打包回归：`packages/dsh-tree-engine/tests/skills.test.js`（4 项）与 `packages/dsh-session-tree/test/skills.test.cjs`（3 项）校验 frontmatter、`package.json.files`、patch provider 行与旧路径清理。
- 发布：会话树单包的 `skills/` 随 `package.json.files` 发布到公开插件仓（v1.3.0，18/18 SHA）；tree-engine 为仓内插件，Skill 随本仓公开。
- 热更：新增/修改 patch 行受 D12 约束——对相应 bundle entry 做一次 disable→enable 或重启 DSH。

### Loader 包名缓存（关键机制）

DSH Loader 对**宿主模块按包名缓存**：

- 已装载包的 `index.js` 改动 → **单纯保存文件不会重新求值**（即使包在 `hmr.root` 内；2026-11-11 实测：改 `packages/dsh-session-tree/index.js` 后活体工具仍是旧实现）。对相应 bundle 条目做一次 disable→enable（`plugin_manager({action:"set_plugin", target:"include:session-tree", enabled:false})` 再 `enabled:true`；tree-engine 用 `include:tree-engine`）可加载新模块；重启 DSH 同样有效。
- 新包名没有缓存 → 普通安装即可生效。
- 本仓 `packages/` 虽位于 profile 的 `hmr.root` 内（本机 `D:/Codes/dsh-tree-harness/packages`），但**不要把 hmr.root 当作宿主半热更保证**：客户端半（`client.js`）刷新页面即生效；宿主半（`index.js`）与 **bundle patch**（新增/修改 insert 行，例如 Skill provider）改动请走 disable→enable 该 bundle 条目或重启 DSH，并逐条验证活体工具面/Skill 目录。
- 由于缓存按包名生效，把新功能并入**已有**包时不会自动替换已加载的旧宿主半；安装/升级后必须重载该 bundle 条目（本机实测 disable→enable 有效；其它路径未经实测不要依赖）。

### 目录结构

```
packages/
  dsh-tree-engine/       执行层：src/ 纯逻辑 + index.js 宿主适配 + tests/（9 个 .test.js + 偏差登记）
  dsh-meta-loop/         治理层：src/core.js + index.js + client.js + panel/ + tests/
  dsh-agent-introspect/  自省层：index.js（self_spec）
  dsh-session-tree/      会话树单包（发布产物，与公开插件仓同步；含 tree_send + session_handoff）
docs/                    规约、设计、交接、发布与审计文档
demo/  logs/             演示产物、运行日志（SKILL 资产已随包迁入 packages/*/skills/）
scripts/                 asar-tool / release-plugin（发布同步校验）
```

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [agent.md](agent.md) | **项目代理手册（开工必读）**：角色授权（Lead=指挥官+架构师）、决策 D1–D13、路线图、工程命令、发布门禁与回滚 |
| [docs/handoff-2026-11-11.md](docs/handoff-2026-11-11.md) | **当前交接**：决策 D1–D7、关键路径、测试/验活命令、发布流程、风险与回滚、下一轮议程 |
| [docs/session-handoff-2026-11-11.md](docs/session-handoff-2026-11-11.md) | 会话自交接：v0.1.0 设计 + **v1.2.0 并入会话树/继承修复 + v1.3.0 随包 Skill**（工作区、权限模式、Agent 预设、模型/思考等级） |
| [docs/e2e-handoff-2026-11-11.md](docs/e2e-handoff-2026-11-11.md) | 交接真机 E2E 取证：修复前 root FAIL 5/12 基线 → 修复后 root PASS 14/14 / sibling PASS 12/12 |
| [docs/skill-e2e-2026-11-11.md](docs/skill-e2e-2026-11-11.md) | Skill 工程化真机 E2E：极简提示词 → skill 识别 → 三层分解/逐层干活/中间层 50% 交接（A/B/C 组） |
| [docs/audit-tree-system-2026-11-11.md](docs/audit-tree-system-2026-11-11.md) | tree 体系一致性审计：4 BLOCK / 12 需修 / 15 建议（file:line 证据 + 修复状态） |
| [docs/publishing.md](docs/publishing.md) | **发布状态与流程**：GitHub 两仓、社区市场、npm 冻结、版本纪律、公开前检查清单 |
| [PLAN.md](PLAN.md) | 开发方案（工作版）：范围、接口缝、验证策略层、里程碑 |
| [docs/engine-spec.md](docs/engine-spec.md) | 引擎行为规约（S0 冻结）：工具面、数据模型、状态机闭集、断言 |
| [docs/tools-mapping.md](docs/tools-mapping.md) | 工具面整合表：上游工具 → 8 个复合工具的映射与 action 集 |
| [docs/segment-handoff.md](docs/segment-handoff.md) | 竹节生长机制设计（上下文接力 / 竞争语义 / 配置键） |
| [docs/meta-loop-design.md](docs/meta-loop-design.md) | 六阶段方法轮与门禁设计 |
| [docs/meta-system-argument.md](docs/meta-system-argument.md) | 元系统工作法论证（1115 分析、六类策划、APX、相位裕度） |
| [docs/project-restart-brief-2026-11-11.html](docs/project-restart-brief-2026-11-11.html) | 项目重启简报（单文件 HTML，离线可读，含系统全景/依赖矩阵/发布现状） |
| [docs/handoff-2026-10-14.md](docs/handoff-2026-10-14.md) | 上一版交接（历史参考，已被 11-11 版取代） |

---

## 已知边界（诚实清单）

1. **meta-loop 未装配**：`/metaloop/` 面板与胶囊入口当前不可用（不在 profile bundles）。源码、测试、面板 HTML 均在仓内，装载即加载。
2. **tree-engine sweep 降级**：当前宿主没有 `timer` 服务 → 启动日志 `sweep degraded:no-timer`，超时收割依赖显式工具调用（`tree_status` / `tree_report` / harvest），**不是后台自动扫描**。
3. **npm 冻结（决策 D3）**：`@orphiczhou/*` 候选包名在 npm registry 均 404；安装只走 Git / `link:`。解冻需项目所有者显式批准（条件见 [docs/publishing.md](docs/publishing.md)）。
4. **RC2 兼容层尚未补单测**：DSH 0.2.1-rc.2 起 `subagents.startContinuable` 被移除，tree-engine 已加双形探测兼容层（`startContinuable` / `startActivation` 等）并已运行；但新增分支暂未被现有 62 项测试覆盖，补测列为后续任务。
5. **provider-conformance 测试依赖 DSH asar 解包 fixture，且存在版本布局漂移**：默认 `%TEMP%\dsh-asar-inspect\out` 不存在时会 ENOENT；DSH `0.2.2-rc.1` 把 schema 引擎拆到 shared chunk，而测试的 region 提取启发式仍按旧版内联布局——需要 rc.2 兼容解包 fixture（逐字节 shipped chunk）才能得到 29/29 判定（详见 [docs/merge-session-tree-2026-11-11.md](docs/merge-session-tree-2026-11-11.md) §5）。属测试环境依赖，不是包内容缺陷；布局适配留待下次版本 bump。
6. 更细的历史边界（`artifact` glob 取首个匹配可能命中 `node_modules`、`leaf.status` 与 runtime 终态脱节、flash 审计积压、`tree_maintain gc` 未实现等）见 [docs/handoff-2026-11-11.md](docs/handoff-2026-11-11.md) §7。

---

## License

[MIT](LICENSE) © 2026 orphiczhou
