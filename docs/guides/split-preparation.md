# 拆分准备指南（Split Preparation Guide）

> **状态**：准备文档，**不表示已决定拆分**。决策见 `agent.md` D18：拆仓/契约内核**记录待决，等更多信息后决策**；本指南只在触发器满足、用户批准后作为执行向导使用。
> 日期：2026-11-12 · 基线：本仓 `master` @ `1b1f610`；DSH `0.2.2-rc.1`；profile `desktop`。
> 依据：[composable-orchestration.md](../architecture/composable-orchestration.md) §6（拆分与仓库策略）；[audit-plugin-sources-2026-11-12.md](../reports/audit-plugin-sources-2026-11-12.md)（源码目录地图）；[audit-dev-sessions-2026-11-12.md](../reports/audit-dev-sessions-2026-11-12.md)（开发会话索引）；[composition-research-2026-11-12/](../reports/composition-research-2026-11-12/README.md)（E1–E4 + 红队）。

---

## 0. 结论先行

1. **拆分的真正成本不在"拆代码"**：E1 已证三包之间 **0 代码依赖**、3 个独立 bundle / `link:` / 状态域——"两个独立插件"运行时刻已经成立。成本在**决策变更（D1 反转）+ 开发回路（hmr.root）+ 发布链/工具链重建 + 门禁双跑 + 状态归属**。
2. **当前全景**：审计到的 **12 个插件源码目录**中，本仓 3 个、仓外 9 个（分属 5 个项目根）；全部走 profile `link:`；**仅 5/12 在 hmr.root 覆盖内**；**11/12 缺 `repository`**、10/12 `private:true`、10 个 `@local` scope；公开镜像只有会话树一条（region-probe 次之、meta-adapter 为私有双仓）。
3. **若未来触发拆分**，建议顺序：**session-tree（M，已有镜像+元数据）→ flow-engine（先解决 `flow-core` 自包含）→ tree-engine（L）**；`agent-introspect` 随本仓保留；仓外的 meta-adapter / RSI / nanju / region-probe 等**不纳入本仓拆分**（各有独立治理）。
4. **现在不做**：拆仓、契约内核、注册表、统一拓扑 UI、tree 服务化。触发器见 §9。

---

## 1. 拆分对象与目录地图（摘要）

> 完整表（12 目录 × 身份/装配/元数据/镜像/拆分标注/阻塞项）见 [audit-plugin-sources-2026-11-12.md](../reports/audit-plugin-sources-2026-11-12.md) §2、§5。

### 1.1 在拆分范围内的 4 个目录

| 包 | 源码位置 | 版本 | 在 hmr.root | git | 发布面 | 拆分前置（详见 §4） |
|---|---|---|---|---|---|---|
| `@orphiczhou/dsh-session-tree` | `packages/dsh-session-tree` | 1.3.7 | ✅ | 本仓 | 公开镜像 `orphiczhou/dsh-session-tree`（`main`=tag `v1.3.7`=`91c177e`） | 改 D1 决策；hmr 策略；A1–A13 引用点（≈3 人日量级） |
| `@local/dsh-tree-engine` | `packages/dsh-tree-engine` | 0.7.0 | ✅ | 本仓 | 无（随本仓公开） | `@local`/`private`/元数据/CI；硬编码测试（B-7–B-10，≈6 人日量级） |
| `@local/dsh-agent-introspect` | `packages/dsh-agent-introspect` | 0.1.0 | ✅ | 本仓 | 无 | **建议随本仓保留**（最小，无独立发布需求） |
| `@local/dsh-flow-engine`（+`flow-core`） | `D:\Codes\DSH动态流程引擎插件\spike\{dsh-flow-plugin,flow-core}` | 0.1.0 | ❌ | 项目 git **无 remote** | 无 | **非自包含**：`lib/core-adapter.js:26` 相对路径加载 `../../flow-core`；profile 绝对 `storageDir`（B-12/B-13） |

### 1.2 范围相邻与不相关（不在本仓拆分内）

| 类别 | 对象 | 说明 |
|---|---|---|
| 范围相邻（独立治理） | `meta-adapter`（私有双仓 `meta-adapter-src`）、`RSI`（无 remote）、`region-probe`（无 git、有公开镜像）、`nanju-core/ui`（当前停用） | 各有独立项目/发布路径；拆分时只做"不要互相绑死"的契约约束 |
| 不相关 | `td-tweak`、`Gemini-Eyes`（第三方上游）、`startup-secret`（第三方上游副本） | 不属于本生态拆分对象 |
| 历史参考 | `D:\Codes\tree-harness`（Proma 版旧 tree-engine，差分测试基准）、`default-workspace` 旧发布副本、死 junction（`dsh-meta-loop` / `@local/dsh-session-tree`） | 不参与拆分；但仍被 `tests/diff.test.js` 引用，拆前需加守卫/迁移 |

---

## 2. 决策前置（必须先于任何代码迁移）

| # | 前置 | 现状 | 动作 |
|---|---|---|---|
| P1 | **D1 反转** | `agent.md:88` 明写"本仓=唯一源码事实源；发布=本仓→公开插件仓单向同步"。拆仓 = 反转该条款 | 新增正式决策记录（D19 或修订 D1）；写清"哪个仓是哪个包的事实源" |
| P2 | **D3 npm 解冻** | 仍冻结（`agent.md:90`） | 解冻前不把"去 `private`/补 `repository,license,author`/市场 listing"计入工期 |
| P3 | **D5/D2/D7 门禁** | 单仓设计（A1–A9、全历史密钥扫描、7 文件排除清单） | 拆仓 = 门禁跑两遍 + 第二仓历史重写/清理；先确认排除清单在第二仓同样成立 |
| P4 | **D6 版本纪律** | 单版本线 + 版本一致性脚本 | 拆仓后两条版本线；`check-version-consistency` 需改跨仓矩阵（以其为"本仓"判据的 `:103-106` 会失效） |
| P5 | **hmr 策略** | `hmr.root` 是 profile 里**两个绝对目录**（`cordis.patch.yml:4-9`） | 二选一：①把新仓目录加入 `hmr.root`；②接受 disable→enable/重启成本并写进发布流程 |
| P6 | **状态归属** | 状态目录四处分布：profile 内（tree-engine/meta-adapter/nanju）、项目内（flow/Gemini）、工作区（`HANDOFF-*.md`）、包内（RSI `plugin/runs`） | 先冻结"状态属于发布单元还是工作区"，定迁移/兼容策略 |

---

## 3. 拆分工作流（模板，按发布单元执行）

> 顺序原则：先决策与预清理，再搬代码；每一步都必须有可复核证据。

1. **决策与冻结**：新增决策记录（P1）；记下源仓 commit + 全量测试绿快照；备份 profile（`package.json` / `cordis.patch.yml`）。
2. **预清理**：清死 junction / 死 patch 覆盖 / 版本漂移（源报告 §6 H-1–H-5）；把硬编码外部路径清零或加存在性守卫（源报告 §5.3）。
3. **新仓骨架**：`package.json` 元数据（`repository`/`license`/`author`/`files`）；改 scope（若需发布）；`private` 去留；README/AGENT-INSTALL；CI（测试 + 契约 schema + 版本一致性）。
4. **源码迁移与测试适配**：包内源码通常 0 行改动；但要修：`tests/diff.test.js` 外部仓硬编码、`tests/skills.test.js` 的 `pkgDir/../..` 仓根假设、`src/doctor.js` 提示串、`tests/doctor.test.js` 包名断言。
5. **发布链改造**：`release-plugin.mjs` / `release-all.mjs` / `check-version-consistency.mjs` 的源路径与断言；若拆 session-tree，镜像仓从"发布目标"升格为"开发仓"（需先建 CI/开发回路，而不是只迁源码）。
6. **开发回路**：profile `link:` 切到新仓；`hmr.root` 或 disable→enable 策略；`include:*` 重载验收。
7. **双仓门禁**：A1–A9 独立验证、全历史密钥扫描、D7 排除、`ls-remote` 核对远端=本地、tag 双仓。
8. **收口与回滚演练**：`agent.md` D1/D18、`docs/README`、handoff 更新；演练"profile 还原 + link 切回 + disable→enable"。

---

## 4. 单包拆分清单

### 4.1 `dsh-session-tree`（建议最先；工作量 M，≈3 人日 + hmr/门禁追加）

- **已就绪**：公开镜像仓存在（`main`=tag `v1.3.7`=`91c177e`，19/19 SHA 口径见 `publishing.md`）；包内自带 `scripts/verify-bundle.mjs`；6 个测试入口自足；无 npm 依赖；客户端半只依赖 DSH 客户端服务；合法元数据齐全。
- **必改引用点**：E1 §9.2 A1–A13 全列（发布脚本 / 版本一致性脚本 / README/agent.md/CHANGELOG/docs/项目地图 / profile link）。
- **新增成本（v0.1 修订）**：hmr.root 迁移/接受 reload；D1 反转决策；镜像仓扶正为开发仓（CI/开发回路/门禁）。
- **验收**：新仓测试全绿 + `verify-bundle` 0 fail + `ls-remote` = 本地；profile 重载后侧栏树与 `tree_send`/`session_handoff` 正常；`tree_doctor` 7 checks。

### 4.2 `dsh-tree-engine`（工作量 L，≈6 人日 + 门禁追加）

- **阻塞项**：`@local` scope 不可发布 + `private:true` + 缺 `repository/license/author`（四处联动：`package.json`、patch、`src/doctor.js:34`、`tests/doctor.test.js`）；无发布管线；`tests/diff.test.js:26,69` 硬编码 `D:/Codes/tree-harness/tree-engine.cjs`（无守卫→新仓 112 项中 3 项必挂）；`tests/skills.test.js` 仓根假设；`src/doctor.js` 提示串；版本一致性脚本以本包为"本仓"判据。
- **保留不变**：9 个工具名、`providerName: tree-engine`、状态目录名、SKILL 对 session-tree 的包名引用。
- **验收**：新仓 112/112（或替换 diff 基准后全绿）+ `tree_doctor` 7 checks + 至少一次真机 dispatch/relay 复测。

### 4.3 `dsh-flow-engine`（先解决自包含）

- **阻塞项**：插件以相对路径加载兄弟 `../../flow-core`（`lib/core-adapter.js:26`，含 hmr evict）；profile 固定 `engine: flow-core` 与**绝对** `storageDir`（`cordis.patch.yml:272-280`）；项目 git **无 remote**。
- **动作**：把 `flow-core` 打包成独立发布单元（或 vendoring 进插件包，ADR-017 未实施）；统一 `storageDir` 策略（按 workspace 或可配置）；建公开仓/CI；补元数据。
- **不在本轮**：flow M1 未收口（R-m1-05c / T11 / T13 / T14），拆分不应先于收口。

### 4.4 `dsh-agent-introspect`

- **建议随本仓保留**：单工具（`self_spec`）、无自有状态、无发布需求；拆分收益≈0。

---

## 5. 开发会话追溯（拆分时的上下文来源）

> 完整索引见 [audit-dev-sessions-2026-11-12.md](../reports/audit-dev-sessions-2026-11-12.md)；公开仓只登记 session id/路径/≤30 字摘要，不复制正文。

| 项目 | 会话规模（顶层/子） | 关键会话入口（示例） | 对应文档 |
|---|---|---|---|
| dsh-tree-harness | 190（8/182） | `ae8a7881…`（Wave-2 收口）、`bff3c54c…`（接替）、`ae2d557b…`（handoff 主线） | `docs/operations/handoff-2026-11-12.md`；根目录 11 份 `HANDOFF-*.md`（文件名即 session id） |
| flow 项目 | 105（9/96） | `006b07da…`（起点）、`089efdfa…`（M1 主）、`76961080…`/`5e66b298…`（接替） | flow 仓 `HANDOFF.md`、`HANDOFF-M1.md`、`docs/README.md` |
| nanju-dsh | 109（8/101） | `11f22b1b…`（开工）、`473c0b27…`（11-06 收口） | nanju `HANDOFF.md`、`docs/handoff-*` |
| RSI | 35（5/30） | `dbea485e…`（R1 启动）、`e8e0aa20…`（决策） | `dsh-harness-rsi/docs/00-runlog.md`、`HANDOFF.md` |
| meta-adapter | 1,173（21/1,152，开发在 `D:\桌面\元方法论`） | `c09d4cd9…`（109 turns 总指挥）、七领域子指挥官 | 元方法论 `AGENTS.md`、`工程日志/`、`REPO-LINKS.md`（私有，勿摘录） |
| 旧 tree-harness | 0（UNKNOWN） | — | 旧仓 `.context/handoff-*`（早于 DSH 会话库 2026-10-01） |

- **敏感标注**：Clash/代理配置、opencode-go 凭证、公开前密钥审计三类会话**只登记 id，不摘录**；`%USERPROFILE%\.dsh\.credentials.yaml` 与 `storages/workspace.json` 本身敏感，禁止整文件入库。
- **打开方式**（只读）：projcache `storages/session_projcache/sessions/<id>.json`（标题/首句/turns，免解压）优先；需要正文时按 `.dsh/sessions/<mangled>/<id>/session.v4.jsonl.zstd` 多帧 zstd 解码（脚本思路见报告 §6）。

---

## 6. 拆分后的目标形态（分发/版本/兼容）

- 每个插件 = 独立 bundle + 独立 `link:`/Git 安装；**互不 import**；共享的只有[一页组合约定](../architecture/composable-orchestration.md) §5.2（5 条规则），不建公共 adapter 包/契约内核（无强制点，见评估文档 S5）。
- 版本：契约/能力探测优先，不按版本号判断（DSH API 漂移已发生）；拆仓后必须有跨仓一致性检查（至少：契约规则 + 各仓测试快照 + 三方版本矩阵）。
- 发布：npm 仍冻结（D3）；Git/market 安装；镜像仓只放发布产物，不做开发源。

---

## 7. 验收清单（DoD）

- [ ] 决策记录已更新（D1 反转/D19 或等价），并写清"事实源/发布通道/回滚"。
- [ ] 源仓测试全绿快照 + 目标仓测试全绿（含原 112/112 或等价替换后的数字）。
- [ ] 硬编码路径清零或加守卫（源报告 §5.3 全表）。
- [ ] profile `link:` / bundle / patch / skill provider 切换后活体验收（工具面 + Inspect + `apply.log`）。
- [ ] hmr 策略落地（新仓加入 root 或接受 reload 并写进流程）。
- [ ] 发布门禁两遍全绿（A1–A9、密钥全历史、D7 排除）+ `ls-remote` 远端=本地。
- [ ] 状态目录归属与迁移方案落地（不丢历史树/flow run）。
- [ ] 回滚演练：profile 备份还原 + link 切回 + disable→enable + 镜像 tag 说明。

---

## 8. 回滚方案

1. 备份 `profile/package.json`、`profile/cordis.patch.yml`（沿用既有 `.bak-*` 惯例）。
2. 把 `link:` 切回原路径（本仓 `packages/<pkg>` 或原项目目录），`include:<bundle>` 做 disable→enable（D12）。
3. 客户端半刷新页面；`tree_doctor` / `cordis_inspect` 验收。
4. 镜像仓：保留旧 tag；新 tag 仅记录，不回滚远端历史（如必须，按 publishing.md 流程处理）。
5. 数据：tree-state/flow journal 不随代码回滚删除；按 §2 P6 的归属表处理。

---

## 9. 触发器与"现在不做"

**触发器（两者都满足前，本指南不执行）**：
1. **npm 解冻（D3，需用户显式批准）**，或出现明确的生态/市场发布需求；
2. **出现第二个独立消费方**（第二个项目/人需要独立安装/开发某一个包），或用户明确要求拆分。

**现在不做**：拆仓、契约内核/注册表、统一拓扑 UI、tree 服务化（`await+dispose`）、把 session-tree 变成依赖引擎的 UI。理由与证据见 [composable-orchestration.md](../architecture/composable-orchestration.md) §6–§8。

---

## 附录 A：参考材料索引

| 文档 | 用途 |
|---|---|
| [architecture/composable-orchestration.md](../architecture/composable-orchestration.md) | 评估与设计 v0.1（分层/契约/风险/最小路线/S1 测试计划） |
| [reports/audit-plugin-sources-2026-11-12.md](../reports/audit-plugin-sources-2026-11-12.md) | 12 个插件源码目录地图、拆分阻塞项、硬编码路径、漂移发现 |
| [reports/audit-dev-sessions-2026-11-12.md](../reports/audit-dev-sessions-2026-11-12.md) | 开发会话索引、会话→文档对照、敏感标注、只读解码方式 |
| [reports/composition-research-2026-11-12/](../reports/composition-research-2026-11-12/README.md) | E1 仓库耦合 / E2 DSH 平台 / E3 自由流程 / E4 SOTA / R5 红队 |
| `agent.md` | D1/D3/D5/D6/D12/D17/D18、发布门禁、工程命令 |
| `docs/guides/publishing.md` | 发布流程/版本纪律/检查清单 |
