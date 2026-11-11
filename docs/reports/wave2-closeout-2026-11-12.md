# Wave 2 收口证据报告（2026-11-12）

> **性质**：一次性证据报告（结论不回写）。记录 tree `wave2` 八项（W2.1–W2.8）的完成证据、代码/测试增量、脚本退出码与 W2.6 活体前后对比；此后代码或文档变化以新报告/新交接为准。
> **基线**：本仓 `master` `e09f39b`（Wave-2 计划 + GUI 规范 + D16/R13 记录）；Wave-2 全部改动在工作树、**未提交 git、未推送远端**（由 Lead 收口）。
> **实测环境**：DSH 桌面 `0.2.2-rc.1`；bundled Node **v24.21.0**；`tree_doctor` 活体 `version=0.7.0`、`sweepMode=timer`；本机 `locale.preference: zh`。
> **执行者**：tree `wave2` 各 leaf（worker）+ Lead 验收；本报告由 leaf `wave2-D1b-handoff` 汇总（只读引用，不重跑重型命令）。

---

## 0. 结论（置顶）

| 项 | 结论 |
|---|---|
| Wave-2 八项 | **W2.1–W2.8 全部完成**（W2.5 真机三断言本体、W2.7 真实推送为已知边界，见 §7） |
| tree-engine | **v0.6.0 → v0.7.0**；9 个 `tree_*` 工具不变；**112/112** 测试（14 个 `.test.js`）；活体已重载 |
| session-tree | **v1.3.6 → v1.3.7 已发布**（`test/provider-conformance.cjs` rc.2 fixture 适配在 `release-plugin` 同步范围内，按 D6 bump）；运行时/客户端代码未改；公开镜像 `main` + tag `v1.3.7` = `91c177e`（19/19 SHA，`ls-remote` 远端=本地） |
| 工具链 | 新增 `check-version-consistency.mjs`（23 checks）/ `release-all.mjs`（默认 dry-run）/ `e2e/run-release-e2e.mjs`（三条断言编排） |
| 新增测试 | 84 → **112**（+28：compat 11 + identity 10 + budget 7），原 84 项**零回归** |
| 发布状态 | **未提交、未推送**；`release-all.mjs` 仅在隔离沙箱完成全链路演练 |
| 真机 E2E | runner 已落地并通过离线故障注入；**三条真机断言本体未执行**（发布前由 Lead/人工触发） |

---

## 1. 范围与验收口径

- 计划与 DoD：[wave2-plan-2026-11-12.md](../operations/wave2-plan-2026-11-12.md) §1（W2.1–W2.8 逐项退出条件）。
- 决策记录：[agent.md](../../agent.md) D17（Wave 2 决策与落地摘要）。
- 本报告只做**证据汇总**：每项给出可复核的文件路径 / 命令输出 / 既有报告链接；不新增结论、不改写既有报告。
- 「完成」的判定 = 计划 §1 的退出条件已满足，或未满足部分被明确登记为**已知边界**（§7）。

---

## 2. W2.1–W2.8 结论表

| ID | 项 | 状态 | 证据 |
|---|---|---|---|
| **W2.1** | 会话预算计入竹节链 | ✅ 完成 | `packages/dsh-tree-engine/src/guards.js`（预算计数集合补 `leaf.runtime.segmentChain`，与 `leaf.session_id` / `leaf.segment_chain` / `session_registry` 归一化去重）+ `src/engine.js`（validate 同步）；`tests/budget.test.js` **7 例**；超限拒绝路径有覆盖 |
| **W2.2** | provider-conformance rc.2 fixture | ✅ 完成 | `packages/dsh-session-tree/test/provider-conformance.cjs`（fixture 解析 `DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `out`；缺 fixture / 布局不符 exit 2）→ **29/29 PASS, exit 0**；来源与 SHA-256 见 [conformance-rc2-2026-11-12.md](conformance-rc2-2026-11-12.md) |
| **W2.3** | RC2 兼容层单测 | ✅ 完成 | 双形探测纯逻辑抽到 `packages/dsh-tree-engine/src/compat.js`；`tests/compat.test.js` **11 例**（双形探测 / interrupt authority 顺序 / sendMessage-prompt 回退）；总数 84 → **112/112**；未引入宿主依赖 |
| **W2.4** | Skill/README/代码版本一致性检查 | ✅ 完成 | `scripts/check-version-consistency.mjs`：**23 checks**（包版本 / 工具数 / 测试数 / README / SKILL frontmatter / 文档索引 / project-map 当前锚点）；`--json`、`--run-tests`；**故意改错能 FAIL**（故障注入自证，见 §5.1）；已接入 `release-all.mjs` 预检与发布清单 |
| **W2.5** | 真机 E2E 常态化 runner | ✅ 落地（本体未跑） | `scripts/e2e/run-release-e2e.mjs`：串联 `verify-handoff` / `verify-kickoff-language` / `collect-skills`（可选 `summarize-run`），统一 artifacts + PASS/FAIL 表 + `--json` + `--replay`；离线故障注入 A/B 均能 FAIL、replay 正/负样本符合预期；**真机三断言本体未执行**（需真实会话与配额）——见 [e2e-release-runner-2026-11-12.md](e2e-release-runner-2026-11-12.md) |
| **W2.6** | root 会话 id 兼容 | ✅ 完成 | 写入侧归一化（剥 `session-` 前缀、小写、存裸 UUID）+ 比较侧 `normalizeSessionId` / `sameSession`（`added_by` / owner / caller），历史带前缀旧值兼容；`tests/identity.test.js` **10 例**；UUID v4 严格性未放宽；**活体前后对比见 §6** |
| **W2.7** | 发布自动化（一条命令） | ✅ 落地（真推未跑） | `scripts/release-all.mjs`：预检 → 同步/SHA-256 对账 → 本仓 commit（可选 push）→ 镜像 commit + tag（可选 push）→ `ls-remote` 核对；默认 `--dry-run`，仅 `--push` 联网写；失败即停 + 回滚提示 + 凭据纪律；隔离沙箱完成 bump/no-bump/全链路演练——见 [release-automation-2026-11-12.md](release-automation-2026-11-12.md) |
| **W2.8** | GUI 迭代规范落地 | ✅ 完成 | `docs/architecture/session-tree-ui.md` 现行：交互方案 + `client.js` code map + 改哪里速查 + **7 步迭代流程** + UI 变更记录；本轮无 UI 代码改动 |

---

## 3. 代码变更清单（文件级）

### 3.1 `packages/dsh-tree-engine`（v0.6.0 → v0.7.0）

| 文件 | 变更 |
|---|---|
| `package.json` | `version` 0.6.0 → **0.7.0** |
| `src/guards.js` | W2.1：会话预算计数补 `runtime.segmentChain` 并归一化去重（与 `leaf.session_id` / `leaf.segment_chain` / `session_registry` 合并）；W2.6：比较侧统一 `normalizeSessionId` / `sameSession` |
| `src/engine.js` | W2.1：validate 预算口径同步；W2.6：写入/比较路径接入 id 归一化 |
| `src/compat.js` | **新增**：RC2 双形探测（`startContinuable` / `startActivation`）与 authority 顺序抽成纯逻辑，供 `index.js` 与测试共用 |
| `index.js` | 工具描述/装配对齐 v0.7.0（9 工具不变）；接入 `compat.js` 与 id 归一化 |
| `src/doctor.js` | 自检口径跟随 v0.7.0（版本/工具数） |
| `tests/compat.test.js` | **新增，11 例**（W2.3） |
| `tests/identity.test.js` | **新增，10 例**（W2.6） |
| `tests/budget.test.js` | **新增，7 例**（W2.1） |
| `README.md` | 追加 v0.7.0 段落（9 工具 / 112 测试 / Wave-2 三项修复） |
| `skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md` | SKILL **v2.1**：9 工具、id 归一化说明、预算口径、竹节/交接协议对齐 |

### 3.2 `packages/dsh-session-tree`（版本与代码不变）

| 文件 | 变更 |
|---|---|
| `test/provider-conformance.cjs` | W2.2：fixture 显式解析、rc.2 布局判定、缺 fixture exit 2 + 可操作报错（断言数量与语义未改） |
| `package.json` / `index.js` / `client.js` / `skills/` | 运行时/客户端**未改**；`package.json` 随 D6 bump 到 **1.3.7**（镜像发布物仅 `test/provider-conformance.cjs` 适配 + 版本引用更新） |

### 3.3 工具链脚本（本仓 `scripts/`）

| 文件 | 说明 |
|---|---|
| `scripts/check-version-consistency.mjs` | **新增**（W2.4）；约 40 KB、零第三方依赖；23 checks；`--json` / `--run-tests` / `--root` |
| `scripts/e2e/run-release-e2e.mjs` | **新增**（W2.5）；约 34 KB；三条断言编排 + artifacts + `--replay` / `--fail-fast` / `--timeout` |
| `scripts/release-all.mjs` | **新增**（W2.7）；约 54 KB；预检/同步/双仓 commit/tag/`ls-remote`；默认 dry-run |
| `scripts/e2e/artifacts/release-20261111T1700{38,41,43}Z.*` | 新增**离线演练产物**（untracked；故障注入 A/B 与 replay 正/负样本） |

### 3.4 文档（本轮新增/刷新）

| 文件 | 说明 |
|---|---|
| `docs/reports/conformance-rc2-2026-11-12.md` | W2.2 取证（29/29、fixture 来源/SHA-256、缺 fixture 行为） |
| `docs/reports/e2e-release-runner-2026-11-12.md` | W2.5 runner 参数/流水线/artifacts/故障注入/边界 |
| `docs/reports/release-automation-2026-11-12.md` | W2.7 实现与沙箱演练、失败路径、凭据纪律 |
| `docs/reports/wave2-closeout-2026-11-12.md` | 本报告（收口证据） |
| `docs/operations/handoff-2026-11-12.md` | 当前交接/运维手册（旧稿归档到 `docs/archive/handoff-2026-11-11.md`） |
| `README.md` / `docs/project-map-2026-11-11.html` | 交付面口径刷新（v0.7.0 / 112/112 / 9 工具；地图 §9 标记 Wave-2 完成） |
| `docs/README.md` / `agent.md` / `CHANGELOG.md` / `docs/guides/skills-usage.md` / `docs/operations/wave2-plan-2026-11-12.md` / `docs/architecture/engine-spec.md` | 由 D1a / C1 并行更新（D17、发布流程、SKILL 指南、版本记录） |

---

## 4. 测试增量（84 → 112）

基线 84 项 = 62 引擎 + 4 技能打包 + 1 B1 回归 + 9 `tree_doctor` + 8 写面护栏。本轮新增 3 个测试文件、28 项，**原 84 项零回归**：

| 测试文件 | 本次运行 | 其中本轮新增 |
|---|---:|---:|
| `tests/engine.test.js` | 17 | 0 |
| `tests/orchestrator.test.js` | 13 | 0 |
| `tests/verify.test.js` | 10 | 0 |
| `tests/doctor.test.js` | 9 | 0 |
| `tests/write-guards.test.js` | 8 | 0 |
| `tests/state.test.js` | 6 | 0 |
| `tests/adversarial.test.js` | 5 | 0 |
| `tests/guards.test.js` | 5 | 0 |
| `tests/queue.test.js` | 4 | 0 |
| `tests/skills.test.js` | 4 | 0 |
| `tests/diff.test.js` | 3 | 0 |
| `tests/compat.test.js` | **11** | **+11** |
| `tests/identity.test.js` | **10** | **+10** |
| `tests/budget.test.js` | **7** | **+7** |
| **合计（14 个 `.test.js`）** | **112** | **+28** |

实测：`node --test tests/*.test.js` → `tests 112 / pass 112 / fail 0`（exit 0，约 2.6 s）。分类口径：62 引擎 + 4 技能打包 + 1 B1 回归 + 9 tree_doctor + 8 写面护栏 + 11 compat + 10 identity + 7 budget = 112。

会话树包内测试（**版本未变，未回归**）：`handoff.test.js` **41/41**；`skills.test.cjs` **3/3**；`render.test.cjs` **133/133 + 9/9 + 11/11**；`style-guard.cjs` **22/22**；`verify-bundle.mjs` **0 fail**；`provider-conformance.cjs`（rc.2 fixture）**29/29**。

---

## 5. 工具链三条脚本实测退出码

> 均为**既有报告与本次轻量复跑**的结果；未重跑真机/推送类重型命令。

### 5.1 `scripts/check-version-consistency.mjs`（W2.4）

| 场景 | 退出码 | 证据 |
|---|---|---|
| 静态检查（当前工作树，文档收口后） | **0** | `VERSION CHECK OK (23 checks)`；23/23 全过（含 README / agent.md / docs 索引 / project-map 当前锚点） |
| 故障注入（并行的 tree-engine bump 未完成、文档口径未跟上） | **1** | 首轮实测 `VERSION CHECK FAILED (23 checks, 10 failed)`，逐条点名文件与行号（README / agent.md / docs/README / skills-usage / project-map）——证明脚本不是「永远绿」 |
| `--json` / `--run-tests` | 见脚本实现 | 只读，无副作用；`--run-tests` 追加执行测试并比对数量 |

要点：它把「包版本 / 工具数 / 测试数 / README / SKILL frontmatter / docs 索引 / project-map 当前锚点」放在同一张断言表里；故障注入能 FAIL 是 W2.4 的退出条件之一。

### 5.2 `scripts/e2e/run-release-e2e.mjs`（W2.5，引用 runner 报告）

| 场景 | 退出码 | 证据 |
|---|---|---|
| `--help` | **0** | `e2e-release-runner-2026-11-12.md` §6.1 |
| 无参数（用法错误） | **2** | 同上 |
| 故障注入 A：不存在的会话 id | **1** | `--wait 2000` 快速失败，不挂住；artifact `release-20261111T170038Z.json` |
| 故障注入 B：伪造/自相矛盾 artifact（replay） | **1** | 一致性检查 1/5 通过；`release-20261111T170043Z.json` |
| replay 正样本（既有 PASS artifacts 2 份） | **0** | `release-20261111T170041Z.json` |
| 真机三条断言（source/successor 真实会话） | **未执行** | 需真实会话与配额；发布前由 Lead/人工触发 |

### 5.3 `scripts/release-all.mjs`（W2.7，引用发布自动化报告）

| 场景 | 退出码 | 证据 |
|---|---|---|
| 真实仓 `--dry-run --mirror-dir <clone>` | **0** | 只读预检；本仓 `e09f39b` 与镜像 `298298d` 前后不变；打印 2 个 GATE（版本未 bump / 一致性脚本失败，属并发未完成态） |
| 镜像目录不存在（dry-run） | **1** | 结构性错误，写入前停止，给出 clone 命令 |
| 沙箱：内容变化但版本未 bump（`--skip-push --skip-tests`） | **1** | D6 门禁；0 写入 |
| 沙箱：bump 到 1.3.7 后 `--skip-push --skip-tests` | **0** | 同步 **19/19 SHA**、本仓 commit、镜像 commit + tag `v1.3.7`；远端 `ls-remote` 未变（未推送） |
| `--push`（真实发布） | **未执行** | 由 Lead 在最终 bump 后执行 |

---

## 6. W2.6 活体前后对比（Lead 实测，原文照录）

**修复前**：`tree_plan {session_id:"session-ae8a7881-1155-479d-8cb6-08724125af26"}` → `E_INVALID_UUID_STRICT: must be strict UUID v4`。

**修复后**（host 自动重载 tree-engine 后）：

- 同一调用成功建树；检查 state 得 `root.session_id="ae8a7881-1155-479d-8cb6-08724125af26"`（归一化裸 UUID）。
- `tree_node add` 以 `added_by` = 裸 UUID、caller = `session-` 前缀**混合形态**成功。
- `tree_node set-status` root 写权通过。
- 测试树随后删除。

**归一化语义**：`normalizeSessionId` 统一小写（UUID 大小写不敏感，测试断言 `sameSession(大写, 小写)=true`）；UUID v4 严格性**不放宽**——归一化后仍非 v4 仍报 `E_INVALID_UUID_STRICT`。

---

## 7. 已知边界与下一轮候选（引用当前交接）

完整清单见 [handoff-2026-11-12.md](../operations/handoff-2026-11-12.md) §7 / §8；与本轮直接相关的 5 条：

1. **W2.5 真机三断言本体未执行**：runner 已落地并通过离线故障注入，真机链路需真实会话与配额，发布前由 Lead/人工触发，CI 不跑真机。
2. **W2.7 真推未执行**：脚本只在隔离沙箱完成本地全链路（同步 19/19、双仓 commit、tag、no-op 判定）；本仓与镜像远端均未改变。
3. **预算口径漏接力前旧会话**：`max_sessions` 已计入 `runtime.segmentChain`（W2.1），但接力前旧会话仅存 `runtime.history`，暂不计（每个发生过接力的 leaf 约漏 1 个首派会话）。
4. **relay / dispatch 不预检预算**：只有 `leaf:add` / `set-session` / `segment:append` / `tree:register-session` 拒绝超限；高频接力仍可静默越过上限（Wave 3 候选）。
5. **RC2 conformance 依赖本机 fixture**：`%TEMP%` 目录可被清理、随 DSH 版本布局漂移；报告已记录 SHA-256，缺 fixture exit 2 可操作报错。

---

## 8. 复跑与自检（本报告落盘时）

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

# tree-engine 全量
cd packages\dsh-tree-engine; & $node --test tests/*.test.js      # tests 112 / pass 112 / fail 0

# 会话树包内（版本未变）
cd ..\dsh-session-tree
& $node test/handoff.test.js      # 41/41
& $node test/skills.test.cjs      # 3/3
& $node test/style-guard.cjs      # ALL CHECKS PASSED

# 版本/文档一致性（W2.4）
cd ..\..; & $node scripts/check-version-consistency.mjs          # 23 checks

# 文档自检
& $node scripts/check-doc-links.mjs
& $node scripts/check-md-tables.mjs README.md docs/operations/handoff-2026-11-12.md docs/reports/wave2-closeout-2026-11-12.md
```

- 说明：`check-doc-links.mjs` 只扫描 **git 已跟踪**文件。收尾期间并行 staging 已把「旧交接删除 + 新档案/新报告新增」写进索引，因此实测 **`LINK CHECK OK`（74 文件，exit 0）**；若在纯工作树未 staged 状态下运行，脚本会因索引仍列旧路径报 ENOENT（`git add` 后自愈）。工作树版链接自检（不依赖索引）同样通过：`WORKTREE LINK CHECK OK（66 个 md/html）`。
- 文档自检实测：`check-md-tables.mjs` → `TABLE CHECK OK`；project-map 单文件离线自检 → `HTML OFFLINE CHECK OK`（http 外链 0 / `<script src` 0 / `<link` 0 / `<img` 0 / id 唯一；hero、组件表、指标卡三处 `v0.7.0 · 9 工具 · 112/112` 抽查通过）。
- 本报告不重跑 `run-release-e2e.mjs` 真机、`release-all.mjs --push`：前者需真实会话，后者会写远端。

---

## 9. 结论边界

- 本报告记录的是 **2026-11-12 工作树快照**：Wave-2 改动**未提交、未推送**；提交后的 SHA/数字以 `git log` 与包 `package.json` 为准。
- 「完成」不等于「发布」：W2.5 真机、W2.7 真推是发布动作，必须由 Lead 在最终检查后执行；本报告不构成发布证明。
- 后续若修改本轮文件，请开**新报告**（reports 是一次性证据，不回写本文件）。

## 8. 收口后发布记录（2026-11-12）

Wave 2 收口提交后执行（Lead）：

- **本仓 `master`**：Wave-2 三笔提交 + 文档收口（远端 `orphiczhou/dsh-tree-harness` 已推送；`git ls-remote` 核对）。
- **公开镜像 `orphiczhou/dsh-session-tree`**：`release-plugin.mjs` 同步 **`files=19 match=19`**；commit + tag **`v1.3.7`**（`91c177e`）；push `main` + tag；`ls-remote` 核对远端 = 本地（`main` 与 tag 同 SHA）。
- **版本纪律**：`packages/dsh-session-tree` `1.3.6 → 1.3.7`（D6；内容变化 = W2.2 `test/provider-conformance.cjs`，运行时/客户端代码未变）。
- **未执行**：`release-all.mjs --push` 真推（本轮以 dry-run/沙箱演练验证自动化，真推走既有手工流程）；真机 E2E 三断言本体（发布前由人工触发）。
