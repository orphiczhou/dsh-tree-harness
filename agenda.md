# AGENDA — dsh-tree-harness

> 本文件是项目议程与决策记录（单一事实源）。由 **Lead（会话指挥官 + 架构师）** 维护，每轮结束时更新状态。
> 最后更新：2026-11-11（团队推进轮：T1–T4 已完成，T5 提交/发布进行中；公开推送门禁 = 验证者 A1–A9 复扫全绿 + 明确「可 push」）

---

## 0. 用户授权与团队角色（2026-11-11 起生效）

用户明确要求：**「你作为指挥官和架构师，驱动团队推进」**。自此本项目采用 Lead 驱动的团队协作模式：

| 角色 | 职责 |
|---|---|
| **Lead = 指挥官 + 架构师** | 拆分任务、定义写作用域、分派与验收；方案设计与边界决策；最终 diff 审查；**唯一拥有 git commit / push / 发布权限**；维护本文件 |
| 团队成员（teammate） | 按共享任务板执行；写作用域互斥、不碰他人文件；只报告证据，不自行提交/发布 |
| 协作纪律 | ① 任务先建板再分派，写作用域写进任务；② 有依赖的任务串行（依赖解锁后才开工）；③ 脚本/命令类改动由 Lead 复核；④ 每项交付必须有可复核证据（测试输出 / SHA / 活体读数 / 截图） |

## 1. 决策日志（Decision Log）

| ID | 日期 | 决策 | 说明 / 影响 |
|---|---|---|---|
| **D1** | 2026-11-11 | 会话树采用 **方案 B⁺ 合并** | 单包迁入本仓 `packages/dsh-session-tree/`（hmr.root 内，保留热更）；本仓成为唯一源码事实源；发布 = 本仓 → 公开插件仓同步 |
| **D2** | 2026-11-11 | **全部资料公开** | 本仓库以 public 发布到 GitHub，包含 docs/logs/skills/demo/packages 全部内容；**唯一例外**：密钥、令牌、私有凭据一律不入库（公开前强制扫描，含 git 历史） |
| **D3** | 2026-11-11 | **npm 暂不发布（冻结）** | 继续走 Git 安装；market 条目维持 browse-only / Git 安装；`@orphiczhou/*` 四个包名保持 404；解冻需用户显式批准 |
| **D4** | 2026-11-11 | License = **MIT** | 与用户其它公开插件仓（dsh-session-tree / dsh-region-probe）一致；版权人 orphiczhou |
| **D5** | 2026-11-11 | 公开范围 = **本仓库内容本身** | 仓库外 `default-workspace/publish/`、5 份 HANDOFF*.md 等不复制进仓（避免多项目/私有环境路径混入）；发布源统一到 `packages/dsh-session-tree/`，publish 副本降级为历史参考 |
| **D6** | 2026-11-11 | 发布节奏 | 版本纪律：market 按 `package.json.version` 判断更新 → 改代码必须 bump version；本次迁移**不 bump**（保持 v1.0.4 与公开插件仓一致），内容不变不制造假更新 |
| **D7** | 2026-11-11 | 公开前**安全排除清单**（覆盖 D2 的"全部资料公开"） | 独立验证（qa-verifier）+ Lead 复核确认两类必须排除项，公开仓与其 git 历史一并清除：① **隐私**：`demo/screen-2026-10-13.png`（桌面/私有会话标题/股票软件/内网 NAS 地址）；② **第三方源码再分发风险**：从 DSH app.asar 摘出的 6 个文件 `demo/agspec/_subagent-index.js`、`_tool-subagent.js`、`_tool-subagent.md`、`_driver.js`、`_fork.js`、`_spawn.js`。原件已移出仓库保存在 `default-workspace/backups/public-release-privacy-2026-11-11/`（SHA 校验）。其余资料照 D2 全部公开 |

## 2. 当前状态快照（2026-11-11 实测）

- **DSH 桌面**：`0.2.2-rc.1`；宿主 loader 账本 **248** 条；profile bundles **29** 个
- **本仓**：`master @ 2cb2d17`，**无 git remote**；未提交：tree-engine RC2 兼容层（+102/−36）、meta-loop 面板六阶段流程图（+275/−24）、README 项目关系（+5/−4）、未跟踪 `docs/defect-2026-10-17-*.md`
- **测试**：tree-engine **62/62**、meta-loop **13/13**（当前工作树，含未提交改动）
- **会话树**：本机开发态双包（`@local/dsh-session-tree` UI 半 + `@local/dsh-session-tree-tools` 工具半）运行中；发布态单包 `@orphiczhou/dsh-session-tree` **v1.0.4** 已在 GitHub 公开、两个市场 PR 已合并、npm 未发
- **活体**：`SessionTree` provider 在线；`tree_send` 工具在线；`meta-loop` 未装配；tree-engine `sweep degraded:no-timer`
- **公开面**：仓库已以 public 发布 → https://github.com/orphiczhou/dsh-tree-harness（master）；插件仓 `orphiczhou/dsh-session-tree` v1.0.4、`orphiczhou/dsh-region-probe`；npm 冻结（D3）
- **风险**：① 无 remote = 零备份；② RC2 兼容层未入库（当前宿主已无 `startContinuable`，HEAD 旧契约会死）；③ README 停留在 S0 时代

## 3. 议程（Roadmap）

| ID | 议题 | 状态 | 说明 |
|---|---|---|---|
| **R1** | 会话树合并为单包（D1 / B⁺） | ✅ 已完成 | `packages/dsh-session-tree/` 15/15 文件 SHA 与发布副本一致；profile 经 `plugin_manager` 切到单包（bundles 29→28），活体验证 `tree_send`×1 + 8 个 `tree_*` 无缺失/重复；**打开中的页面刷新一次**才加载新客户端半 |
| **R2** | 本仓公开到 GitHub（D2） | ✅ 已完成 | public 仓 **https://github.com/orphiczhou/dsh-tree-harness**（默认分支 master、7 个 topics、MIT）。2026-11-11 推送成功：**远端 HEAD `366986d` == 本地 HEAD**；推送前门禁 = 独立验证者 A1–A9 复扫全绿（报告 v1.2，PASS WITH RISKS） |
| **R3** | 止血：RC2 兼容层入库 | ✅ 已完成 | RC2 兼容层（`startContinuable`/`startActivation` 双形 + interrupt authority 兼容 + sendMessage/prompt 回退）+ 缺陷报告入库；**补单测**列后续（现测试不覆盖新分支） |
| **R4** | 文档对齐（README / handoff / publishing） | ✅ 已完成 | README 重写、LICENSE(MIT)、handoff-2026-11-11、publishing、merge 记录、验证报告 v1.1 全部落盘 |
| **R5** | npm 发布 | ⏸ 冻结（D3） | 无需动作 |
| **R6** | meta-loop 装配 / timer 降级 / 单测补强 | 📋 待排期 | 非本轮阻塞项 |

## 4. 本轮团队与任务板

| 任务 ID（板） | 主题 | Owner | 写作用域 | 依赖 |
|---|---|---|---|---|
| T1 | 合并单包 `packages/dsh-session-tree/` + 发布脚本 | merge-engineer | `packages/dsh-session-tree/`、`scripts/release-plugin.mjs`、`docs/merge-session-tree-2026-11-11.md` | — |
| T2 | profile 迁移到单包 + 回滚文档 | merge-engineer | profile（仓外）+ 上表 merge docs | T1 |
| T3 | 公开前独立验证（密钥/隐私/测试/SHA） | qa-verifier | `docs/verification-2026-11-11.md` | — |
| T4 | 公开文档包（README/LICENSE/handoff/publishing） | docs-writer | `README.md`、`LICENSE`、`docs/handoff-2026-11-11.md`、`docs/publishing.md` | — |
| T5 | 提交 + 建仓 + 推送 + 核对 | **Lead** | 全仓（git） | T1–T4 |

**任务板状态（2026-11-11）**：T1 ✅ / T2 ✅ / T3 ✅（报告 v1.1 已交付；**附录 A 的 A1–A9 复扫待历史清除后执行**，结论维持 BLOCK 直至复扫全绿）/ T4 ✅ / T5 🔄（提交与历史重写进行中）。

**验收记录（Lead 独立复跑）**：tree-engine 62/62、meta-loop 13/13（exit 0）；session-tree `render.test.cjs` exit 0、`style-guard.cjs` exit 0；`provider-conformance.cjs` 在当前环境 exit 1 —— 默认 fixture 目录为 **rc.2 之前的陈旧解包树**（`dsh-tools/lib/index.js` 已不含 JSON-Schema 引擎，被拆到 chunk），属已登记的环境依赖（merge-engineer 用 rc.2 兼容 fixture 实测 29/29），非代码回归；测试布局启发式适配列 R6。活体：`include:session-tree` → `@orphiczhou/dsh-session-tree`，enabled + fiberPhase=active；`tree_send`×1 + 8 个 `tree_*`。

## 5. 风险与回滚

1. **profile 迁移回滚**：备份 `profiles/desktop/package.json` 为 `package.json.bak-2026-11-11`；回滚 = 还原备份 → pnpm install → 重新启用两个 `@local/*` 包。客户端半需刷新页面生效。
2. **公开泄漏**：push 前必须完成 T3 的密钥扫描（工作树 + git 全历史）；发现即阻断发布并上报 Lead。
3. **热更残留**：客户端半热更会残留旧实例，迁移后建议刷新页面一次；以 `cordis_inspect_list` 的 `SessionTree` provider 与 `tree_send` 单次注册为验收判据。
4. **发布源漂移**：本仓 `packages/dsh-session-tree/` 与公开插件仓必须保持 SHA 一致；`scripts/release-plugin.mjs` 提供同步与校验，禁止手工双写。

## 6. 变更记录

- 2026-11-11：建立本文件；记录 D1–D6；启动本轮团队任务（T1–T5）。
- 2026-11-11（收口）：D7 扩展为 **7 文件**（Lead 复核发现另 3 个 DSH 源码摘录后追加）；T1–T4 全部完成；4 个逻辑 commit + **历史重写**（9 路径从全部历史清除，`.git` 3.80MB→0.64MB，旧对象/refs 0 残留）+ 验证门禁 **A1–A9 全绿（PASS WITH RISKS）**；**公开仓 `orphiczhou/dsh-tree-harness` 已创建并推送（远端 HEAD == 本地）**；npm 维持冻结（D3）。
