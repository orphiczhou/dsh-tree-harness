# AGENT.MD — dsh-tree-harness 项目代理手册

> **所有接手本项目的 AI Agent 的开工必读**，同时是项目**单一事实源**：角色授权 / 决策日志 / 路线图 / 工程约定 / 发布门禁。
> 文件名由用户在 2026-11-11 明确指定为 **`agent.md`**（此前误建为 `agenda.md`，已 `git mv` 更名，见 §7）。
> 由 **Lead（指挥官 + 架构师）** 维护，每轮收尾更新。
> 最后更新：2026-11-11（团队推进轮收口：会话树合并 / 仓库公开 / npm 冻结全部落地）

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
node test/render.test.cjs              # packages/dsh-session-tree → 107 断言
node test/style-guard.cjs              # packages/dsh-session-tree → 22 断言
node test/provider-conformance.cjs     # 需 rc.2 兼容的 asar 解包 fixture（默认目录若为旧版会快速失败，属环境依赖）

# 活体验证（唯一可编程观测通道）
cordis_inspect_list / cordis_inspect_query    # host Tool/Service/Config、client providers

# 会话树单向发布同步（只写 --target，不执行 git、不 push）
node scripts/release-plugin.mjs --check --source packages/dsh-session-tree --target <公开插件仓本地 checkout>
```

- node 路径：`%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
- `packages/` 位于 profile 的 `hmr.root`（`D:/Codes/dsh-tree-harness/packages`）→ 宿主代码改动约 25s 热更；客户端半改动需刷新页面。
- git push 需要凭据：token 从 **User 环境变量 `GH_TOKEN`** 在内存中取用（`http.extraheader`），**禁止打印、禁止落盘、禁止写进 remote URL**；GitHub 访问需按 handoff 用 `-c http.proxy=` 等逐命令覆盖失效代理。

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

---

## 2. 当前状态快照（2026-11-11 收口实测）

- **DSH 桌面**：`0.2.2-rc.1`；宿主 loader 账本 **248** 条；profile bundles **28** 个
- **本仓**：public `master`，HEAD **`d67915e`（32 commits）**，工作树 clean；remote = `https://github.com/orphiczhou/dsh-tree-harness.git`
- **公开面**：仓库 https://github.com/orphiczhou/dsh-tree-harness（public / master / MIT / 7 topics）；插件仓 `orphiczhou/dsh-session-tree` v1.0.4、`orphiczhou/dsh-region-probe`；**npm 冻结（D3）**
- **测试**：tree-engine **62/62**、meta-loop **13/13**；session-tree render/style-guard exit 0；provider-conformance 依赖 rc.2 兼容 fixture（旧 fixture 会快速失败，非代码回归）
- **会话树**：已合并为**单包** `packages/dsh-session-tree/`（15 文件逐字节 = 已发布版 v1.0.4）；本机 profile 已切单包（bundles 29→28，`plugin_manager` applied）；活体 `tree_send`×1 + 8 个 `tree_*` 无缺失/重复；`SessionTree` provider 在线
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

## 4. 本轮团队与任务板（已收口）

| 任务 | 主题 | Owner | 结果 |
|---|---|---|---|
| T1 | 合并单包 + 发布同步脚本 | merge-engineer | ✅ 15/15 SHA 一致；包内测试 3/3；脚本自测 12/12 |
| T2 | profile 迁移 + 活体验证 + 回滚文档 | merge-engineer | ✅ bundles 29→28；`tree_send`×1 + 8 工具；回滚步骤在 merge 文档 §9 |
| T3 | 公开前独立验证（密钥/隐私/测试/SHA/活体） | qa-verifier | ✅ 报告 v1.2；**A1–A9 全绿 → PASS WITH RISKS**；0 真实密钥 |
| T4 | 公开文档包 | docs-writer | ✅ README/LICENSE/handoff/publishing |
| T5 | 提交 + 建公开仓 + 推送 + 核对 | **Lead** | ✅ 4 逻辑 commit + 历史重写 + push；远端 HEAD == 本地 |

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
4. **客户端热更残留**：热更会残留旧实例；以 `cordis_inspect_list` 中 `SessionTree` provider + `tree_send` 单次注册为验收判据，异常时刷新页面。
5. **npm 冻结**：任何 `npm publish` 动作都视为解冻，需用户显式批准（D3）。

## 7. 变更记录

- 2026-11-11：建立本文件（初名 `agenda.md`）；记录 D1–D6；启动团队任务 T1–T5。
- 2026-11-11（收口）：D7 扩展为 **7 文件** + 2 个瘦身路径；T1–T4 完成；4 个逻辑 commit + **历史重写**（9 路径从全部历史清除，`.git` 3.80MB→0.64MB）；独立验证 **A1–A9 全绿（PASS WITH RISKS）**；**公开仓 `orphiczhou/dsh-tree-harness` 创建并推送（远端 HEAD == 本地）**；npm 维持冻结。
- 2026-11-11（更名）：用户更正文件名 → **本文件 `git mv agenda.md agent.md`**（D8）；全仓引用同步更新；状态快照与任务板按收口实测刷新。
