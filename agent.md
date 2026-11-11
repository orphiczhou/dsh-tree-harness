# AGENT.MD — dsh-tree-harness 项目代理手册

> **所有接手本项目的 AI Agent 的开工必读**，同时是项目**单一事实源**：角色授权 / 决策日志 / 路线图 / 工程约定 / 发布门禁。
> 文件名由用户在 2026-11-11 明确指定为 **`agent.md`**（此前误建为 `agenda.md`，已 `git mv` 更名，见 §7）。
> 由 **Lead（指挥官 + 架构师）** 维护，每轮收尾更新。
> 最后更新：2026-11-11（第三轮：会话自交接并入会话树 v1.2.0 + 同工作区归属/权限模式/Agent 预设继承修复 + 真机 E2E）

---

## 0. 角色与授权（用户 2026-11-11 明确）

用户原话：**「你作为指挥官和架构师，驱动团队推进」**。自此本项目采用 Lead 驱动的团队协作模式：

| 角色 | 职责 |
|---|---|
| **Lead = 指挥官 + 架构师** | 拆分任务、定义写作用域、分派与验收；方案设计与边界决策；最终 diff 审查；**唯一拥有 git commit / push / 发布权限**；维护本文件 |
| 团队成员（teammate） | 按共享任务板执行；写作用域互斥、不碰他人文件；只报告证据，不自行提交/发布 |
| 协作纪律 | ① 先建任务板再分派，写作用域写进任务；② 有依赖的任务串行；③ 脚本/命令类改动由 Lead 复核；④ 每项交付必须有可复核证据（测试输出 / SHA / 活体读数）；⑤ 新会话开工前先读本文件 |

## 0.1 新 Agent 开工顺序（30 秒）

1. 读本文件（决策 / 约定 / 门禁）；
2. 读 [docs/handoff-2026-11-11.md](docs/handoff-2026-11-11.md)（当前状态 / 路径 / 命令）；
3. `git log --oneline -8` + `git status`，确认 HEAD 与工作树；
4. 跑基线测试（见 §0.2），确认与最近记录一致；
5. 改代码/发布前，先读 [docs/publishing.md](docs/publishing.md)（发布流程/版本纪律/检查清单）。

## 0.2 工程命令速查（本机实测有效）

```powershell
# 测试（bundled node；勿用目录形参 node --test tests —— Node 24 会报 test at tests:1:1 假失败）
node --test tests/*.test.js            # packages/dsh-tree-engine → 62/62
node --test tests/*.test.js            # packages/dsh-meta-loop  → 13/13
node test/handoff.test.js              # packages/dsh-session-tree → 34/34（宿主半 session_handoff）
node test/render.test.cjs              # packages/dsh-session-tree → 全绿（参考 133 + 自检 9 + 实时 11）
node test/style-guard.cjs              # packages/dsh-session-tree → 22/22
node scripts/verify-bundle.mjs         # packages/dsh-session-tree → 0 fail
node test/provider-conformance.cjs     # 需 rc.2 兼容的 asar 解包 fixture（默认目录若为旧版会快速失败，属环境依赖）

# 活体验证（唯一可编程观测通道；本会话若没有 cordis_inspect，用 spawn 子会话探针）
cordis_inspect_list / cordis_inspect_query    # host Tool/Service/Config、client providers
# 或派一个 subagent，让它调用 session_handoff {action:"status"} 并回报原始渲染行

# E2E 断言器（多帧 zstd 解码 + projcache/workspace.json）
node scripts/e2e/verify-handoff.mjs --source <id> --successor <id> --expect-kind root|sibling [--wait 120000]

# 会话树单向发布同步（只写 --target，不执行 git、不 push）
node scripts/release-plugin.mjs --check --source packages/dsh-session-tree --target <公开插件仓本地 checkout>
```

- node 路径：`%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
- `packages/` 位于 profile 的 `hmr.root`（`D:/Codes/dsh-tree-harness/packages`）。**实测（2026-11-11 第三轮）：改了已加载包的宿主半 `index.js` 后，活体工具仍是旧实现；必须对 `include:session-tree` 做一次 `plugin_manager set_plugin enabled:false → true`（或重启 DSH）才加载新代码。客户端半改动刷新页面生效。**
- git push 需要凭据：token 从 **User 环境变量 `GH_TOKEN`** 在内存中取用（`[Environment]::GetEnvironmentVariable('GH_TOKEN','User')` + `http.extraheader`），**禁止打印、禁止落盘、禁止写进 remote URL**；GitHub 访问需按 handoff 用 `-c http.proxy=` 等逐命令覆盖失效代理。

## 0.3 会话交接纪律（上下文接近 50% 时必做）

会话自交接能力自 **v1.2.0** 起并入会话树单包（工具 `session_handoff`，与 `tree_send` 同 bundle；独立包 `packages/dsh-session-handoff/` 已删除；详见 [docs/session-handoff-2026-11-11.md](docs/session-handoff-2026-11-11.md)）：

1. **接近 50% 上下文**（或明显感觉接近上限）时，先调 `session_handoff {action:"status"}` 读真实占用与继承事实；
2. `context_pct ≥ 50` 时执行 `session_handoff {action:"handoff", summary, next_steps, files, open_questions}` —— 它会写 `HANDOFF-*.md` 到当前工作区，并启动**同层级**接替会话：**同工作区归属 / 同 Agent 预设（工作模式，工具集相同）/ 同权限模式（沙箱+审批）/ 同模型 / 同思考等级**；
3. 子会话自动走「兄弟」接替（同父层级，出现在父会话下）；根会话走根级接替并被挂进同一侧栏工作区；父不活时降级为「根运行时 + 保留 durable 父血缘」并在返回里显式 `degraded:"parent-inactive"`；
4. 交接文件属运行时产物（`.gitignore` 已忽略 `HANDOFF-*.md`），需要长期留存的结论请整理进 `docs/` 或 `agent.md`；
5. 非致命继承失败（预设挂不上/权限写不进/工作区挂载失败）不会打断交接，但会出现在 `warnings[]` 与 `successor.preset_error` / `permission_error` / `workspace.reason` 里——看到就查，别忽略。

---

## 1. 决策日志（Decision Log）

| ID | 日期 | 决策 | 说明 / 影响 |
|---|---|---|---|
| **D1** | 2026-11-11 | 会话树采用 **方案 B⁺ 合并** | 单包迁入本仓 `packages/dsh-session-tree/`（hmr.root 内，保留热更）；本仓成为唯一源码事实源；发布 = 本仓 → 公开插件仓同步 |
| **D2** | 2026-11-11 | **全部资料公开** | 本仓库以 public 发布到 GitHub，包含 docs/logs/skills/demo/packages 全部内容；**唯一例外**：密钥、令牌、私有凭据一律不入库（公开前强制扫描，含 git 历史） |
| **D3** | 2026-11-11 | **npm 暂不发布（冻结）** | 继续走 Git 安装；market 条目维持 browse-only / Git 安装；`@orphiczhou/*` 候选包名保持 404；**解冻需用户显式批准** |
| **D4** | 2026-11-11 | License = **MIT** | 与用户其它公开插件仓（dsh-session-tree / dsh-region-probe）一致；版权人 orphiczhou |
| **D5** | 2026-11-11 | 公开范围 = **本仓库内容本身** | 仓库外 `default-workspace/publish/`、5 份 HANDOFF*.md 等不复制进仓（避免多项目/私有环境路径混入）；发布源统一到 `packages/dsh-session-tree/`，publish 副本降级为历史参考 |
| **D6** | 2026-11-11 | 发布节奏 | market 按 `package.json.version` 判断更新 → 改代码必须 bump version；单包迁移**不 bump**（保持 v1.0.4 与公开插件仓一致），内容不变不制造假更新 |
| **D7** | 2026-11-11 | 公开前**安全排除清单**（覆盖 D2 的"全部资料公开"） | 公开仓与其 **git 历史**一并清除：① **隐私**：`demo/screen-2026-10-13.png`（桌面/私有会话标题/股票软件/内网 NAS 地址）；② **第三方源码再分发风险**：6 个从 DSH app.asar 摘出的全文副本（`demo/agspec/_subagent-index.js`、`_tool-subagent.js`、`_tool-subagent.md`、`_driver.js`、`_fork.js`、`_spawn.js`）。原件已移出仓库保存在 `default-workspace/backups/public-release-privacy-2026-11-11/`（SHA 校验 + 重写前完整 bundle）。其余资料照 D2 全部公开 |
| **D8** | 2026-11-11 | **项目代理手册文件名 = `agent.md`** | 用户明确指定；原 `agenda.md` 已 `git mv` 更名，全仓引用同步更新。本文件即代理手册 |
| **D9** | 2026-11-11 | **新功能：会话自交接（context handoff）** | 用户需求：会话接近 **50%** 上下文时自己写交接文件，并启动**同层级**新会话接替。架构规格冻结于 [docs/features-2026-11-11-spec.md](docs/features-2026-11-11-spec.md) A 节；v0.1.0 实现 = host-only 独立插件 `packages/dsh-session-handoff/`（工具 `session_handoff`）；**已被 D11 取代（并入会话树 v1.2.0，独立包删除）** |
| **D10** | 2026-11-11 | **新功能：会话树工作区归档/隐藏 + 最近活动排序** | 用户需求：工作区越积越多；工作区可隐藏/归档、按最新会话倒序；「…」菜单可操作已归档会话与已归档工作区；归档后可看/查/召回。规格 = spec B 节；实现 = `packages/dsh-session-tree/client.js` v1.0.4→**1.1.0**，工作区隐藏为**纯客户端 localStorage 状态**（Host 无工作区归档 API） |
| **D11** | 2026-11-11 | **交接并入 tree 体系 + 同工作区/权限模式/Agent 预设继承修复（v1.2.0）** | 用户原话：「交接插件不要单独做插件，功能合并到 tree 体系里面，树的各个层级，包括根，都能同层级交接」「交接功能有瑕疵，没有定位同工作区。还有交接后的接手会话的权限，工作模式，思考等级，模型等都要和交接出手会话一样。」落地：`session_handoff` host 实现迁入 `packages/dsh-session-tree/index.js`（与 `tree_send` 同 host 半、两次 `ctx.inject`），独立包删除，版本 1.1.0→**1.2.0**。修复：root/degraded 接替会话创建后 `workspaceRegistry.resolveByPath(cwd)`→`Workspace.attachSession`（同工作区归属）；`meta.agentPreset` + `setup(agentCtx,agent)` 内 `agentPresets.mount` + `agent-preset/selected`（工作模式/工具集继承）；`permission/preset`、`sandbox/mode`、`approval/policy`（`source:'delegation'`）在发布前追加（权限模式继承）；模型/思考等级沿用 `agentOptions`。兄弟路径本就由委派继承，零改动。证据：[docs/e2e-handoff-2026-11-11.md](docs/e2e-handoff-2026-11-11.md)（修复前 root FAIL 5/12、修复后 root PASS 14/14 + sibling PASS 12/12） |
| **D12** | 2026-11-11 | **宿主半热更纪律（实测修正）** | 本机实测：`packages/` 虽在 `hmr.root`，改**已加载包的宿主半 `index.js`** 后活体工具仍跑旧实现（Loader 按包名缓存已导入模块）；必须对该 bundle entry 做一次 disable→enable（`plugin_manager set_plugin`）或重启 DSH，再用活体工具面验收。客户端半仍只需刷新页面。此前「约 25s 热更」的表述仅适用于部分场景/新模块，不再作为承诺 |

---

## 2. 当前状态快照（2026-11-11 第三轮收口）

- **DSH 桌面**：`0.2.2-rc.1`；宿主 loader 账本 **245** 条（前后未变）；profile bundles **27** 个（移除独立 handoff bundle 后 28→27）
- **本仓**：public `master`，本轮提交 **`67fa541`**（feat: v1.2.0 合并/继承修复）+ 本 docs 收口提交（`git log -1`）；工作树 clean；remote = `https://github.com/orphiczhou/dsh-tree-harness.git`
- **公开面**：仓库 https://github.com/orphiczhou/dsh-tree-harness（public / master / MIT / 7 topics）；插件仓 `orphiczhou/dsh-session-tree` **v1.2.0**（已发布：handoff 合并 + 工作区/权限/预设继承修复）、`orphiczhou/dsh-region-probe`；**npm 冻结（D3）**
- **组件**：`dsh-tree-engine` v0.4.0（8 工具）、`dsh-meta-loop` v0.2.0（未装配）、`dsh-agent-introspect` v0.1.0、`dsh-session-tree` **v1.2.0**（含 `tree_send` + `session_handoff`）、~~`dsh-session-handoff` v0.1.0~~（已并入并删除）
- **测试**：tree-engine **62/62**、meta-loop **13/13**；session-tree handoff **34/34**、render 全绿（133 + 9 + 11）、style-guard **22/22**、verify-bundle **0 fail**；provider-conformance 依赖 rc.2 兼容 fixture（旧 fixture 会快速失败，非代码回归）
- **会话树**：**单包** `packages/dsh-session-tree/` **v1.2.0**（host 半 49,740 B：`tree_send` + `session_handoff`；test 4 份）；本机 profile 单包已重载（`include:session-tree` disable→enable），活体 `session_handoff` status 渲染含 `preset=/permission=`（新实现指纹）+ `tree_send` 在线；旧 `include:session-handoff` entry 已从 profile 移除
- **真机 E2E**：root 路径修复前 FAIL 5/12 → 修复后 **PASS 14/14**（同工作区 `6f48f173…`、权限三元组/Agent 预设/模型/工具数 164=164、首轮读 HANDOFF 并回 READY）；sibling 路径 **PASS 12/12**；见 [docs/e2e-handoff-2026-11-11.md](docs/e2e-handoff-2026-11-11.md)
- **未装配**：`@local/dsh-meta-loop`（源码/13 测试/面板均在仓内，按需装载；`/metaloop/` 面板当前不可用）
- **降级项**：tree-engine `sweep degraded:no-timer`（宿主无 timer 服务 → 收割依赖显式工具调用）
- **RC2 兼容层**：已在 HEAD 中（DSH 0.2.1-rc.2 起 `subagents.startContinuable` 被移除；见 [docs/defect-2026-10-17-subagents-rc2-api-drift.md](docs/defect-2026-10-17-subagents-rc2-api-drift.md)）；**新增分支尚未补单测**（R6）

## 3. 路线图（Roadmap）

| ID | 议题 | 状态 | 说明 |
|---|---|---|---|
| **R1** | 会话树合并为单包（D1 / B⁺） | ✅ 已完成 | 单包 15/15 SHA 一致；profile 切单包；活体验证通过；**已打开的页面刷新一次**才加载新客户端半 |
| **R2** | 本仓公开到 GitHub（D2） | ✅ 已完成 | public 仓已建并推送；**远端 HEAD `d67915e` == 本地**；推送前门禁 = 独立验证 A1–A9 全绿（报告 v1.2，PASS WITH RISKS） |
| **R3** | 止血：RC2 兼容层入库 | ✅ 已完成 | 兼容层 + 缺陷报告入库；**补单测**列 R6 |
| **R4** | 文档对齐（README / handoff / publishing） | ✅ 已完成 | README/License/handoff-2026-11-11/publishing/merge 记录/验证报告 v1.2 全部落盘 |
| **R5** | npm 发布 | ⏸ 冻结（D3） | 无需动作；解冻需用户批准 |
| **R6** | meta-loop 装配 / timer 降级 / RC2 单测补强 / provider-conformance 布局适配 | 📋 待排期 | 下一轮候选；均非阻塞 |
| **R7** | 会话自交接（D9） | ✅ 已完成（v0.1.0）→ 已被 R9 取代 | 原 host-only 插件 `packages/dsh-session-handoff/`（`session_handoff` status/handoff，24/24 测试）；已装 profile 并活体验证（兄弟接替 E2E 成功）。**v1.2.0 起并入会话树单包，独立包删除** |
| **R8** | 会话树工作区归档/隐藏 + 最近活动排序（D10） | ✅ 已完成 | `packages/dsh-session-tree` **v1.1.0**：工作区按最近活动排序（可切 Host 顺序）、工作区隐藏/恢复（localStorage 持久化）、已隐藏工作区三分区态、搜索召回、`…` 菜单整合；`render.test.cjs` **153 PASS / 0 FAIL**（133 gating 全保留 + 26 新增）、style-guard 22/22、verify-bundle OK；**需刷新页面生效**（客户端半） |
| **R9** | **交接并入 tree 体系 + 同工作区/权限模式/Agent 预设继承修复（D11）** | ✅ 已完成 | `packages/dsh-session-tree` **v1.2.0**：`session_handoff` 并入 host 半；root/degraded 接替会话 `attachSession` 到同一 workspace；`meta.agentPreset` + `setup` 内挂载预设组成；`permission/preset`+`sandbox/mode`+`approval/policy`（`source:'delegation'`）发布前追加；模型/思考等级继续用 `agentOptions`。测试 handoff **34/34**、render 全绿、style-guard 22/22、verify-bundle 0 fail；真机 E2E root **PASS 14/14**、sibling **PASS 12/12**；独立包删除、profile bundle 28→27；发布公开插件仓 v1.2.0（哈希见 §2/§7） |

## 4. 本轮团队与任务板（2026-11-11 第三轮，已收口）

| 任务 | 主题 | Owner | 结果 |
|---|---|---|---|
| T1 | 合并实现 + 继承修复（index.js / package.json / README） | **Lead** | ✅ `packages/dsh-session-tree/index.js` 并入 handoff（49,740 B）+ 工作区挂载 + Agent 预设挂载 + 权限三元组发布前追加；v1.2.0 |
| T2 | 测试迁移与扩展（handoff.test.js） | test-engineer | ✅ **34/34**（24 移植 + 10 新增：工作区三态/预设挂载/四类继承事件/preset_error/workingDirectory_error/兄弟不回归）；render 全绿、style-guard 22/22 |
| T3 | 真机 E2E 取证与断言器 | e2e-verifier | ✅ 修复前 root FAIL 5/12、sibling PASS 12/12；修复后 root **PASS 14/14**、sibling **PASS 12/12**；`scripts/e2e/verify-handoff.mjs` + 5 份 artifacts + 报告 |
| T4 | profile 切换（移除独立 bundle）+ 发布（插件仓 v1.2.0 / 本仓提交） | **Lead** | ✅ `include:session-handoff` bundle 移除、`include:session-tree` disable→enable 重载；公开插件仓 v1.2.0 同步推送 + tag；本仓提交（哈希见 §2/§7） |

## 5. 发布门禁（不可跳过）

1. **密钥扫描**：工作树 + **git 全历史**（模式见 verification 报告附录）；0 真实密钥才放行。
2. **隐私/第三方源码排除**：D7 清单必须从工作树 **和全部历史** 清除（`filter-branch` 重写）；重写前先做仓外 bundle 备份 + 原件备份。
3. **独立验证 A1–A9**：由非作者角色复扫（A1 `ls-files` / A2 路径不存在 / A3 历史文件头 / A4 `--diff-filter=A` / A5 `rev-list --objects` / A6 密钥 / A7 `.gitignore` / A8 refs / A9 瘦身），全绿 + 明确「可 push」才允许推送。
4. **Lead 独占发布**：commit / push / 建仓 / 历史重写只能 Lead 执行；token 只在内存中使用（禁止打印/落盘/写入 URL），push 后 remote 配置为干净 https。
5. **推送后核对**：远端 HEAD == 本地 HEAD（API + `ls-remote` 双证），并抽查移除路径在远端 404。
6. 详细清单与版本纪律见 [docs/publishing.md](docs/publishing.md) §3/§6。

## 6. 风险与回滚

1. **profile 迁移回滚**：备份 `%USERPROFILE%\.dsh\profiles\desktop\package.json.bak-2026-11-11`；回滚 = 还原备份 → pnpm install → `plugin_manager` 重新启用两个 `@local/*` 包 → 刷新页面（步骤见 [docs/merge-session-tree-2026-11-11.md](docs/merge-session-tree-2026-11-11.md) §9）。
2. **发布源漂移**：本仓 `packages/dsh-session-tree/` 与公开插件仓必须保持 SHA 一致；只用 `scripts/release-plugin.mjs` 单向同步，禁止手工双写。
3. **历史重写风险**：重写前必须已有仓外 bundle（`default-workspace/backups/public-release-privacy-2026-11-11/repo-pre-scrub-2026-11-11.bundle`）；重写后核对 `rev-list --objects --all` 与 `fsck`。
4. **客户端热更残留 / 宿主半不重载**：热更会残留旧实例；以 `cordis_inspect_list` 中 `SessionTree` provider + `tree_send` 单次注册为验收判据，异常时刷新页面。**宿主半实测不随文件改动重载**（D12）：改 `index.js` 后必须对 `include:session-tree` 做一次 disable→enable；新实现活体指纹 = `session_handoff status` 渲染行含 `preset=` 与 `permission=`（旧实现没有这两个字段）。
5. **npm 冻结**：任何 `npm publish` 动作都视为解冻，需用户显式批准（D3）。
6. **继承失败被忽略**：交接可能返回 `handed-off` 但 `warnings[]` 非空（例如 `successor.preset_error`、`workspace.reason`）。这类接替会话仍可用但继承不完整；E2E/验收时必须同时看 `successor.agent_preset/permission/workspace` 与 `warnings`，不能只看 `status==='handed-off'`。
7. **重复注册 / 旧实现遮蔽**：合并期间新旧两个 bundle 可能同时注册 `session_handoff`（工具层会按层遮蔽，不报错）。切换顺序 = 先让合并版可用 → 验证活体指纹 → 再移除旧 bundle；不要只看“工具存在”就认为新实现生效。

## 7. 变更记录

- 2026-11-11：建立本文件（初名 `agenda.md`）；记录 D1–D6；启动团队任务 T1–T5。
- 2026-11-11（收口）：D7 扩展为 **7 文件** + 2 个瘦身路径；T1–T4 完成；4 个逻辑 commit + **历史重写**（9 路径从全部历史清除，`.git` 3.80MB→0.64MB）；独立验证 **A1–A9 全绿（PASS WITH RISKS）**；**公开仓 `orphiczhou/dsh-tree-harness` 创建并推送（远端 HEAD == 本地）**；npm 维持冻结。
- 2026-11-11（更名）：用户更正文件名 → **本文件 `git mv agenda.md agent.md`**（D8）；全仓引用同步更新；状态快照与任务板按收口实测刷新。
- 2026-11-11（功能轮）：实现并验收两个新功能（D9/D10）：**会话自交接**（新插件 `dsh-session-handoff`，文档 [docs/session-handoff-2026-11-11.md](docs/session-handoff-2026-11-11.md)，规格 [docs/features-2026-11-11-spec.md](docs/features-2026-11-11-spec.md)）+ **会话树 v1.1.0**（工作区排序/隐藏/召回）。验收：handoff 24/24；会话树 153 PASS/0 FAIL、style-guard 22/22；tree-engine 62/62、meta-loop 13/13；真机 E2E 兄弟接替成功。`.gitignore` 增 `HANDOFF-*.md`（运行时交接产物不入库）。
- 2026-11-11（发布）：monorepo master 已推送；**公开插件仓 `orphiczhou/dsh-session-tree` v1.1.0 已同步并推送（`dcf3519`，远端=本地）**；`dsh-session-handoff` 仅本机安装（未对外发布，R7 后续可考虑随仓传播）。
- 2026-11-11（第三轮）：用户要求「交接并入 tree 体系、各层级同层交接」并指出真机缺陷「未定位同工作区、接手会话权限/工作模式/思考等级/模型未继承」。落地 D11/R9：handoff 并入 `packages/dsh-session-tree` **v1.2.0**（独立包删除），修复工作区归属（`attachSession`）与继承（`meta.agentPreset` + `setup` 挂载 + 权限三元组 `source:'delegation'`）；测试 handoff 34/34、render/style/verify-bundle 全绿；真机 E2E root 14/14 + sibling 12/12；profile bundle 28→27；公开插件仓 v1.2.0 发布（哈希见 §2）。同时记录 D12（宿主半热更实测不生效，需 disable→enable）。
