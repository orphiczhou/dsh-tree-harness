# 安装指南（人类版）— dsh-tree-harness 三组件

> 目标读者：想在自己机器上装这套「会话树 + 树执行引擎」的人。
> 给 AI Agent 的安装指南在公开镜像仓根目录：[AGENT-INSTALL.md](https://github.com/orphiczhou/dsh-session-tree/blob/main/AGENT-INSTALL.md)。
> 当前快照：2026-11-12 · DSH desktop `0.2.2-rc.1` 实测 · tree-engine **0.6.0** / session-tree **1.3.6** / agent-introspect **0.1.0**。

## 1. 先选路线

| 你想装什么 | 推荐路线 | 会得到 |
|---|---|---|
| 只要侧栏会话树 + 交接（大多数用户） | **路线 A：Git URL 装 session-tree** | 会话树 UI、`tree_send`、`session_handoff`、`session-handoff` Skill |
| 要完整的树体系（派任务树/竹节/验收） | **路线 B：本地链接 monorepo** | A 的全部 + `tree-engine` 9 个 `tree_*` 工具 + `tree-commander`/`tree-worker` Skill + `self_spec` |
| 已经在开发/改这个项目 | 路线 B（`hmr.root` + `link:`） | 源码热更工作流 |

> 重要：`tree-engine` 与 `agent-introspect` 是 monorepo 里的 `@local/*` 包，**没有独立 GitHub 仓库、npm 也冻结**，所以不能像 session-tree 那样粘一个 Git URL 装；只能走路线 B。

## 2. 路线 A：只装 session-tree（Git URL / 市场 / 本地路径）

前提：DSH 桌面版可用，能打开 Plugins 页面。

1. 左侧 **Plugins** → **Add plugin** → 粘贴：
   `https://github.com/orphiczhou/dsh-session-tree`
2. 确认。侧栏会变成会话树（左侧标题变成 **会话树** / **Sessions**）。
3. 命令行等价写法：
   ```sh
   dsh plugin add orphiczhou/dsh-session-tree
   # 指定 profile：
   dsh plugin --profile <profile-name> add orphiczhou/dsh-session-tree
   # 本地已 clone 的包目录（绝对路径）：
   dsh plugin --profile <name> add /absolute/path/to/dsh-session-tree
   ```
4. 需要固定版本时用 pnpm git ref：`github:orphiczhou/dsh-session-tree#v1.3.6`。

> 社区目录（如 dshmarket）按 `package.json.version` 判断更新；DSH 本身没有官方内置商店，安装入口始终是 Git URL / 本地路径 / npm 包名。

## 3. 路线 B：装完整树体系（session-tree + tree-engine + agent-introspect）

前提：本机有 git、pnpm（DSH 自带 runtime 即可）、能改 profile 目录（`%USERPROFILE%\.dsh\profiles\<name>`）。

```powershell
# 1) 克隆唯一源码仓（只取一次，升级时 git pull）
git clone https://github.com/orphiczhou/dsh-tree-harness.git D:\Codes\dsh-tree-harness

# 2) 把 packages/ 加进 profile 的 hmr.root（cordis.patch.yml，已有则合并）
#    - id: hmr
#      config:
#        root:
#          - "D:/Codes/dsh-tree-harness/packages"

# 3) profile 的 package.json 增加三个 link 依赖（保留原有条目）
#    { "dependencies": {
#        "@local/dsh-tree-engine": "link:D:/Codes/dsh-tree-harness/packages/dsh-tree-engine",
#        "@local/dsh-agent-introspect": "link:D:/Codes/dsh-tree-harness/packages/dsh-agent-introspect",
#        "@orphiczhou/dsh-session-tree": "link:D:/Codes/dsh-tree-harness/packages/dsh-session-tree"
#    } }

# 4) 在 profile 目录安装依赖
pnpm install

# 5) 让 Loader 重载宿主半（或重启 DSH）
#    Plugins 页面对 include:tree-engine / include:session-tree / include:agent-introspect
#    各做一次 disable → enable；命令行等价：
#    plugin_manager set_plugin include:tree-engine enabled:false → true
#    （session-tree / agent-introspect 同理）

# 6) 新开会话，按 §5 验证
```

**改 profile 前先备份**：`package.json`、`cordis.patch.yml` 各复制一份 `.bak-<日期>`；不要在 DSH 运行中盲改配置。

## 4. 装完/改完怎么重载（最常见坑）

| 改了什么 | 怎么生效 |
|---|---|
| 宿主半 `index.js`、`cordis.patch.yml`、新增工具/服务 | **disable → enable** 对应 bundle（或重启 DSH）。Loader 按包名缓存宿主模块，只保存文件不会重载 |
| 客户端半 `client.js`、locale、icon | 刷新页面 |
| `skills/*/SKILL.md` 正文 | 下一次**新开**会话生效（Skill 目录在会话启动时注入） |
| Skill provider 的 patch 行 | disable → enable bundle（patch 行属于宿主侧） |

> 热重载安全：`packages/` 在 `hmr.root` 内时，**不要直接覆盖写宿主半文件**——HMR 可能读到半写文件导致宿主崩溃。改前 disable，或写 `.tmp` 再原子 rename。

## 5. 验收清单（新会话里跑）

1. **工具面**：让 agent 列工具 → 至少看到 `tree_send`、`session_handoff`；完整树体系还应看到 9 个 `tree_*`（含 `tree_doctor`）。
2. **自检**（完整树体系）：`tree_doctor {action:"run"}` → 一行 `tree_doctor: 7 checks · pass=… · version=0.6.0`；`FAIL` 项按提示修。
3. **交接**：`session_handoff {action:"status"}` → 渲染含 `context=…% (threshold 50%) … preset=… permission=… lang=zh|en`，无副作用。
4. **Skill 目录**（新会话问「你看到哪些 Skill」）→ `session-handoff`；完整体系还有 `tree-commander`、`tree-worker`。
5. **侧栏**：标题变成「会话树 / Sessions」，有子会话的行可展开、子代理嵌套显示。
6. **语言**：中文界面下接替会话首条消息应为中文，`status` 行尾 `lang=zh`。

## 6. 升级 / 卸载 / 回滚

- **Git 安装升级**：`dsh plugin remove orphiczhou/dsh-session-tree` → 重新 `add`（可带 `#vX.Y.Z` 固定版本）→ disable→enable → 新开会话。
- **路线 B 升级**：`git -C <monorepo> pull` → 在 profile 里 `pnpm install` → 三个 bundle disable→enable → 新开会话。
- **卸载**：`dsh plugin --profile <name> remove orphiczhou/dsh-session-tree`；完整体系再移除 profile 里三个 link 依赖与 `hmr.root` 条目，`pnpm install`。
- **回滚**：装回上一个 tag，或还原 profile 备份后重启。
- **版本纪律**：包内容有变化必须 bump `package.json.version`；市场按 version 判断更新。

## 7. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 工具/Skill 都没出现 | bundle 未启用 / 宿主缓存 / 装错 profile | 确认 Profiles 行已启用；disable→enable；换正确 profile |
| `unknown tool session_handoff` | bundle 未装/未启用 | 装路线 A；看 Plugins 行 `session-tree` |
| 工具在但 Skill 不在 | Skill 目录是**按会话注入**的；或 provider patch 行没重载 | **新开**会话；disable→enable |
| `below-threshold` 被拒 | 上下文 <50% 且没加 `force` | 这是保护闸；用户明确要提前交接才 `force:true`；`spawn:false` 干跑不受此闸拦（仍受 5 分钟防重复闸） |
| 5 分钟内第二次被 `recent-handoff` 拒 | 防重复闸 | 正常；用户要求才 `force:true` |
| 中文界面接替首条是英文 | 旧版（<1.3.1）或读不到 `locale.preference` | 升级到 ≥1.3.6；看 `status` 的 `lang=`；检查 profile 的 `locale` 配置 |
| 侧栏没变化 | 同时开着旧 standalone UI / 旧版本 | 只保留一个会话树 bundle，disable 重复项后重载 |
| 完整体系但 `tree_*` 缺失 | tree-engine 没 link / 没重载 | 重做路线 B 第 2–5 步；检查 `include:tree-engine` 条目 |

> 旧独立插件 `@local/dsh-session-handoff` 已并入 session-tree（v1.2.0），不要与新包同时启用——同名工具/Skill 会互相遮蔽。

## 8. 延伸阅读

- [Skill 使用指南](skills-usage.md)（三个 Skill 的触发/参数/验收/42% vs 50%）
- [发布流程](publishing.md)（源码仓 → 镜像仓、版本纪律）
- [项目全景地图](../project-map-2026-11-11.html)（[在线版](https://orphiczhou.github.io/dsh-tree-harness/project-map-2026-11-11.html)）
- [文档总索引](../README.md)
