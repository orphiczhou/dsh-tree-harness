# C1a1 · 版本与发布事实（证据采集）

> 采集范围：本仓（`dsh-tree-harness`）；本文件内路径一律相对仓库根。
> 采集时间：2026-11-11；分支 `master`，HEAD = `0cbc31e`（`docs: v1.2.0 合并/继承修复与真机 E2E 记录…`）。
> 环境：`node v24.20.0`、`git version 2.56.1.windows.1`、PowerShell。
> 纪律：只读仓库 + 只跑既有测试；唯一写入 = 本文件（未提交、未改版本）。
> ⚠️ **采集期间工作区被并发修改**（其他 worker 在 15:35–15:37 改了 tree-engine 三个文件），tree-engine 计数因此从 66 变为 67 —— 两个快照都记录在 §3.1，冲突说明见 §5.11。

---

## 1. 包与版本（实测）

| 包目录 | `name` | `version`（工作区实测） | `version`（HEAD 提交内） | 说明 |
|---|---|---|---|---|
| `packages/dsh-tree-engine` | `@local/dsh-tree-engine` | **0.5.0** | 0.4.0 | `private: true`；0.5.0 为**未提交**改动 |
| `packages/dsh-session-tree` | `@orphiczhou/dsh-session-tree` | **1.3.0** | 1.2.0 | 唯一非 `private` 的发布包；1.3.0 为**未提交**改动 |
| `packages/dsh-meta-loop` | `@local/dsh-meta-loop` | **0.2.0** | 0.2.0 | `private: true`；与 HEAD 一致 |
| `packages/dsh-agent-introspect` | `@local/dsh-agent-introspect` | **0.1.0** | 0.1.0 | 与 HEAD 一致 |

实测四个值与任务书预期（0.5.0 / 1.3.0 / 0.2.0 / 0.1.0）**逐项一致**。

出处（文件:行）：
- `packages/dsh-tree-engine/package.json:3` → `"version": "0.5.0"`
- `packages/dsh-session-tree/package.json:3` → `"version": "1.3.0"`
- `packages/dsh-meta-loop/package.json:1`（单行 JSON）→ `"version": "0.2.0"`
- `packages/dsh-agent-introspect/package.json:3` → `"version": "0.1.0"`

HEAD 对比命令与原始结果：

```powershell
foreach ($p in @('dsh-tree-engine','dsh-meta-loop','dsh-agent-introspect','dsh-session-tree')) {
  $c = git show "HEAD:packages/$p/package.json" | Out-String
  $v = ($c | Select-String '"version"\s*:\s*"([^"]+)"').Matches.Groups[1].Value
  $w = (Get-Content "packages/$p/package.json" -Raw | Select-String '"version"\s*:\s*"([^"]+)"').Matches.Groups[1].Value
  "$p : HEAD=$v  worktree=$w"
}
# dsh-tree-engine : HEAD=0.4.0  worktree=0.5.0
# dsh-meta-loop : HEAD=0.2.0  worktree=0.2.0
# dsh-agent-introspect : HEAD=0.1.0  worktree=0.1.0
# dsh-session-tree : HEAD=1.2.0  worktree=1.3.0
```

---

## 2. 近期提交（近 12 条，逐条照抄）

命令：`git log --format="%h %ad %s" --date=short -12`（输出按时间倒序，全部为 2026-11-11）

| # | 提交 | 日期 | 主题（原样照抄） | 版本节点判定 |
|---|---|---|---|---|
| 1 | `0cbc31e` | 2026-11-11 | docs: v1.2.0 合并/继承修复与真机 E2E 记录（agent.md/publishing/spec/handoff/session-handoff/README + e2e 断言器与 artifacts） | v1.2.0 配套**文档**（无版本 bump） |
| 2 | `67fa541` | 2026-11-11 | feat(session-tree): v1.2.0 并入 session_handoff（同层级交接）+ 修复同工作区/权限模式/Agent 预设继承 | **版本节点 v1.2.0** |
| 3 | `f2f373d` | 2026-11-11 | docs: 发布 v1.1.0 记录同步（README 组件表 / handoff / publishing / agent） | v1.1.0 配套**文档** |
| 4 | `f7048a8` | 2026-11-11 | feat(session-tree): v1.1.0 工作区按最近活动排序 + 隐藏/恢复与已隐藏分区 + 归档检索召回 | **版本节点 v1.1.0** |
| 5 | `53bd2c1` | 2026-11-11 | feat(session-handoff): 会话自交接插件（session_handoff status/handoff）+ 架构规格与文档 | 功能节点（后被 `67fa541` 并入会话树、独立包删除） |
| 6 | `61ea250` | 2026-11-11 | docs: 项目代理手册更名为 agent.md（用户指定，D8）+ 重写为开工必读 + 全仓引用同步 | 文档 |
| 7 | `d67915e` | 2026-11-11 | docs(agenda): R2 收口 — 公开仓已推送并核对远端 HEAD；变更记录补全 | 文档 |
| 8 | `366986d` | 2026-11-11 | docs: T3 公开前复扫 A1-A9 全绿（PASS WITH RISKS，可公开推送） | 文档（QA） |
| 9 | `4062974` | 2026-11-11 | docs: 公开文档包与治理记录；公开前安全排除（决策 D7） | 文档（治理） |
| 10 | `67654ed` | 2026-11-11 | feat(session-tree): 合并为单包 v1.0.4（方案 B⁺）+ 发布同步脚本 + profile 迁移记录 | **版本节点 v1.0.4** |
| 11 | `3c1e89d` | 2026-11-11 | feat(meta-loop): 面板新增六阶段 SVG 流程图与阶段摘要 | 功能节点（**无版本 bump**，meta-loop 保持 0.2.0） |
| 12 | `4089a65` | 2026-11-11 | fix(tree-engine): 兼容 DSH 0.2.1-rc.2+ subagents API 漂移（真机派发恢复） | 修复节点（**无版本 bump**，未动 package.json） |

### 2.1 版本节点核实（逐条 `git show --stat` / `git show <commit>:<pkg>`）

| 线索 | 核实结果 |
|---|---|
| `67654ed` = 单包合并 **v1.0.4** | ✅ 核实。`git show --stat 67654ed`：17 文件、+5471，其中新增 `packages/dsh-session-tree/package.json`（56 行）等；`git show 67654ed:packages/dsh-session-tree/package.json` → `"version": "1.0.4"`（该包首次出现） |
| `f7048a8` = **v1.1.0** | ✅ 核实。`git show --stat f7048a8`：5 文件，`package.json` 2 行改动；`f7048a8~1` → 1.0.4，`f7048a8` → **1.1.0** |
| `67fa541` = **v1.2.0**（并入 session_handoff） | ✅ 核实。`git show --stat 67fa541`：11 文件，`packages/dsh-session-tree/package.json` 4 行改动；删除 `packages/dsh-session-handoff/*`（7 文件，含 `index.js` 761 行）；`git show 67fa541:…package.json` → **1.2.0** |
| `0cbc31e` = **v1.2.0 文档** | ✅ 核实。`git show --stat 0cbc31e`：13 文件，全为 `README.md` / `agent.md` / `docs/*` / `scripts/e2e/*`，**无 package.json** → 纯文档提交，非版本节点 |
| `4089a65` = tree-engine RC2 API 兼容修复 | ✅ 核实为修复提交。`git show --stat 4089a65`：2 文件（`packages/dsh-tree-engine/index.js`、`docs/reports/defect-2026-10-17-subagents-rc2-api-drift.md`），**未改 package.json** → 不是版本节点（tree-engine 版本仍为当时值） |
| `3c1e89d` = meta-loop 面板 | ✅ 核实为功能提交。`git show --stat 3c1e89d`：1 文件（`packages/dsh-meta-loop/panel/index.html`，+275/−24），**未改 package.json** → 不是版本节点（meta-loop 保持 0.2.0） |

补充：tree-engine 的 0.4.0 由更早提交 `5db7b28`（2026-10-14，`tree-engine package.json 版本对齐 0.4.0`）设定；0.5.0 只存在于工作区（未提交）。

### 2.2 tag 情况

```powershell
git tag                                              # 无输出
(git tag | Measure-Object -Line).Lines               # 0
git describe --tags                                  # fatal: No names found, cannot describe anything.
```

**本仓无 tag**（符合预期）。注意：`docs/guides/publishing.md` 中的 tag `v1.2.0` 指**公开插件仓** `orphiczhou/dsh-session-tree`，不是本仓。

---

## 3. 测试计数（实测，命令 + 原始结果行）

### 3.1 tree-engine（预期 66/66 = 62 引擎 + 4 技能）

实际可用命令（PowerShell，包目录内执行；`node` 侧 glob 展开）：

```powershell
Push-Location packages\dsh-tree-engine
node --test tests/*.test.js
Pop-Location
```

**快照 A（采集开始时，约 15:31–15:32）**——原始结果（尾部）：

```
ℹ tests 66
ℹ suites 0
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2095.2963
```

退出码 0 → **66/66，与任务书预期一致**。

拆分核实（快照 A，证明 62 + 4 的来源）：

```powershell
node --test tests/skills.test.js
# ℹ tests 4 / ℹ pass 4 / ℹ fail 0

# 其余 8 个测试文件（adversarial/diff/engine/guards/orchestrator/queue/state/verify）
node --test tests/adversarial.test.js tests/diff.test.js tests/engine.test.js tests/guards.test.js tests/orchestrator.test.js tests/queue.test.js tests/state.test.js tests/verify.test.js
# ℹ tests 62 / ℹ pass 62 / ℹ fail 0
```

→ 快照 A：62 引擎 + 4 技能 = 66。

**快照 B（15:38:05，并发改动后复测）**——同一命令，原始结果：

```
ℹ tests 67
ℹ pass 67
ℹ fail 0
```

拆分：`node --test tests/skills.test.js` → `4 / 4 / 0`；其余 8 文件 → **63 / 63 / 0**。→ 快照 B：**63 引擎 + 4 技能 = 67**。

变化原因（非测试本身不稳定）：15:35:55–15:37:05 间另一 worker 修改了 `packages/dsh-tree-engine/src/engine.js`（+3）、`index.js`（44 行改动）、`tests/orchestrator.test.js`（+19），此后 `git status` 才出现这三个 `M` 项。**引用计数时必须指明是哪个快照。**

### 3.2 session-tree（预期 3/3）

```powershell
Push-Location packages\dsh-session-tree
node test/skills.test.cjs
Pop-Location
```

原始结果：

```
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8.5069
```

退出码 0 → **3/3，与预期一致**。

补充实测（文档称 34/34）：`node test/handoff.test.js` → `ℹ tests 34 / ℹ pass 34 / ℹ fail 0`，退出码 0。

### 3.3 meta-loop（可选，预期 13/13）

```powershell
Push-Location packages\dsh-meta-loop
node --test tests/*.test.js
Pop-Location
```

原始结果：

```
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 289.2085
```

退出码 0 → **13/13，与预期一致**。

### 3.4 汇总表

| 目标 | 命令（原样） | 原始计数行 | 退出码 | 预期 | 一致性 |
|---|---|---|---|---|---|
| tree-engine（快照 A，约 15:31） | `node --test tests/*.test.js`（包目录内） | `tests 66` / `pass 66` / `fail 0` | 0 | 66/66 | ✅ |
| tree-engine 拆分 A | `node --test tests/skills.test.js` | `4 / 4 / 0` | 0 | 4 技能 | ✅ |
| tree-engine 拆分 A | 其余 8 文件同上 | `62 / 62 / 0` | 0 | 62 引擎 | ✅ |
| tree-engine（快照 B，15:38:05，并发改动后） | 同命令 | `tests 67` / `pass 67` / `fail 0` | 0 | —（已漂移） | ⚠️ 快照 A 之后 +1 |
| tree-engine 拆分 B | `node --test tests/skills.test.js` | `4 / 4 / 0` | 0 | 4 技能 | ✅ |
| tree-engine 拆分 B | 其余 8 文件同上 | `63 / 63 / 0` | 0 | —（原 62） | ⚠️ +1 |
| session-tree | `node test/skills.test.cjs`（包目录内） | `3 / 3 / 0` | 0 | 3/3 | ✅ |
| session-tree 补充 | `node test/handoff.test.js` | `34 / 34 / 0` | 0 | 文档 34/34 | ✅ |
| meta-loop | `node --test tests/*.test.js`（包目录内） | `13 / 13 / 0` | 0 | 13/13 | ✅ |

**本轮未复测**（不在任务书要求项内，仅文档出处）：render `133/133 + 9/9 + 11/11`、style-guard `22/22`、verify-bundle `0 fail`、provider-conformance `29/29`。

---

## 4. 发布状态（每条带书面出处）

| 结论 | 出处 | 原文要点 |
|---|---|---|
| **npm 未发布（D3 冻结）** | `docs/guides/publishing.md:18` | npm 行：`⏸ **冻结**（D3），registry 均 404`；只走 Git / `link:` 安装 |
| npm 冻结依据 | `docs/guides/publishing.md:64-66`（§4） | 4 个 `@orphiczhou/*` 候选包名 npm registry 均 **404**（2026-11-11 直查） |
| npm 未发布的产品口径 | `README.md:22`、`README.md:28` | 会话树行「**npm 未发布**」；状态口径「`npm 未发布` = 刻意的安装策略…决策 D3」 |
| **GitHub 公开仓 v1.2.0 已发布** | `docs/guides/publishing.md:13`（§1 表） | `orphiczhou/dsh-session-tree` ✅ 公开，**v1.2.0**，MIT，7 commits；main + tag `v1.2.0` = **`597ca31`**（远端=本地） |
| v1.2.0 发布细节（16/16 SHA） | `docs/guides/publishing.md:52`（§3）、`:117`（§5）、`:174`（§7） | 同步 **16/16 SHA 一致**、推送 main + tag `v1.2.0`（`597ca31`）；`files=16 match=16 mismatch=0 missing=0 extra=0`，`RESULT: OK — 16/16 files byte-identical (SHA-256)` |
| **市场（marketplace）已收录** | `docs/guides/publishing.md:15` | awesome-dsh-plugin **PR #6334**（会话树）✅ **已合并（2026-10-14）**；browse-only，按 `package.json.version` 判断更新 |
| 市场另有两条（旁证同机制） | `docs/guides/publishing.md:16-17` | PR #6435（region-probe，2026-10-15）、imsai-sh PR #554，均 ✅ 已合并 |
| README 组件表口径 | `README.md:19-22` | tree-engine 0.5.0 / **66/66**；meta-loop 0.2.0 / **13/13**；agent-introspect 0.1.0 / 无单测；session-tree **1.3.0** / 包内测试 |
| README 会话树发布口径 | `README.md:22` | 🌐 GitHub 公开（**v1.3.0**）、社区市场已收录；**npm 未发布** |
| 本仓自身公开 | `docs/guides/publishing.md:12` | `orphiczhou/dsh-tree-harness`（本仓）🚀 **public** |
| 另三包随仓公开、未单独发仓 | `docs/guides/publishing.md:22`、`:60` | `dsh-tree-engine` / `dsh-meta-loop` / `dsh-agent-introspect` 随本仓公开，未单独建仓、安装走 `link:` |
| §6 测试清单（书面数字） | `docs/guides/publishing.md:152-154` | tree-engine **66/66（62 引擎 + 4 技能打包）**；meta-loop **13/13**；session-tree `handoff 34/34`、`skills.test.cjs 3/3`、`style-guard 22/22` |
| 极简提示词 E2E 报告 | `docs/reports/skill-e2e-2026-11-11.md:5`、`:145`、`:150` | 状态「**阶段 2 进行中（初稿）**」；`atCreation` 3/3 skill 可见；B 组记 tree-engine `66/66 PASS`、session-tree `skills.test 3/3` + `handoff 34/34` |

---

## 5. 未能核实 / 存在冲突

1. **GitHub 已发布版本冲突（v1.2.0 ↔ v1.3.0）**：`docs/guides/publishing.md:13/52/174` 三处一致写 **v1.2.0**（tag `v1.2.0` = `597ca31`），而 `README.md:22`、`agent.md:95/96/135` 写 **v1.3.0 已发布**。`publishing.md` §7 变更记录（`:172-174`）**没有 v1.3.0 条目**，§1/§3 也未更新 → **v1.3.0 是否已在公开插件仓发布，仓内书面证据无法确认**（本轮未联网核对远端）。
2. **本仓无 tag**：`git tag` 为空、`(git tag | Measure-Object -Line).Lines` = 0、`git describe --tags` 报 `fatal: No names found` → 本仓无 tag（预期行为）；publishing.md 中的 tag 属于公开插件仓，不能当作本仓 tag。
3. **工作区版本高于 HEAD（未提交 bump）**：session-tree 1.3.0（HEAD 1.2.0）、tree-engine 0.5.0（HEAD 0.4.0），`git diff -- packages/dsh-session-tree/package.json` 证实 `- "version": "1.2.0"` / `+ "version": "1.3.0"`。HEAD 最近提交仍是 v1.2.0 轮 → 写变更记录时须注明这两个版本号**尚未入库**，否则 git 历史与磁盘对不上。
4. **README 内部数字自相矛盾**：`README.md:22` 写「包内 **4 份**测试（handoff/render/style-guard/verify-bundle）」，`README.md:96` 写「自带 **5 份**测试」并列出 handoff / skills / render / style-guard / verify-bundle。实测 `test/skills.test.cjs` 存在且 3/3 → **5 份为准**，`:22` 的「4 份」是漏列 skills 的陈旧表述。
5. **skill-e2e 文档数字只能作旁证**：该文件 `:5` 自述「阶段 2 进行中（初稿）」；A 组（`:130-140`）与 C 组（`:161-169`）全为「待填」，§5/§6「待定稿」（`:173-179`）；`:150` 的 66/66 等数字来自 B 组子会话自报 → 不能当独立实测证据。
6. **市场当前展示的版本未知**：`publishing.md:15` 只证明 listing 于 2026-10-14 合并、且「按 `package.json.version` 判断更新」；仓内没有 2026-11-11 之后的市场条目版本快照 → 未能核实市场当前显示 1.2.0 还是 1.3.0。
7. **未复测的文档数字**：render `133/133 + 9/9 + 11/11`、style-guard `22/22`、verify-bundle `0 fail`、provider-conformance `29/29`（`README.md:100-108`、`publishing.md:154`）本轮未运行，仅有文档出处。
8. **技能测试依赖未跟踪文件**：`packages/dsh-tree-engine/tests/skills.test.js`、`packages/dsh-session-tree/test/skills.test.cjs`、两包 `skills/` 目录均为 `git status` 的未跟踪项（`??`）；同时根 `skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md` 显示已删除（`D`）。→ 66/66 与 3/3 依赖尚未提交的搬迁，**按 HEAD 检出无法复现这两个技能测试**。
9. **版本节点线索核实结论**：任务书给的 6 条线索全部核实到（§2.1），无「未能核实」的版本节点；但 `4089a65`（tree-engine 修复）与 `3c1e89d`（meta-loop 面板）虽被列为线索，实测**未 bump 任何 package.json**，按「版本节点」口径不是版本提交。
10. **环境版本小差异（不影响结论）**：`README.md:37` 写 DSH 自带 Node「实测 v24.21.0」，本轮实测 `node --version` = **v24.20.0**。测试计数在 v24.20.0 下复现成功（66/66、3/3、13/13），差异只影响「实测快照」的精确性。
11. **采集期间工作区被并发修改（tree-engine 66 → 67，最重要的一条）**：本 worker 首测（约 15:31）为 **66/66（62 引擎 + 4 技能）**；15:35:55–15:37:05 期间另一 worker 修改了 `packages/dsh-tree-engine/src/engine.js`（+3）、`index.js`（44 行）、`tests/orchestrator.test.js`（+19），并出现未跟踪目录 `demo/c3layer/`；15:38:05 复测为 **67/67（63 引擎 + 4 技能）**。→ README/publishing 的 66/66 是**快照 A** 时点的真实值，写最终 changelog 时必须固定时点（或同时写 66→67 的变化），否则「测试 66/66」会与当时的磁盘状态不符。
