# W1 子会话可观测性实验取证

- 取证会话(本子会话):`DSH_SESSION_ID = 6c0d6f3b-7a00-480f-8748-7e280a4f4c95`(标签 `tree:agspec/agspec-W1-evidence`,continuable 子会话)
- 父会话:`52e0d1c8-4a43-49c9-9f00-1df375cbba49`(由任务指令注入,并在 tree-state.json 中得到文件级证实,见实验 3)
- 取证时间:2026-10-05 15:34–15:38 (+08:00)
- 所有输出均为真实命令执行结果粘贴;无密钥(本会话环境未发现任何密钥类变量,见实验 2)。

---

## 实验 1:DSH_* 环境变量

命令:
```powershell
Get-ChildItem env:DSH_* | Format-Table -AutoSize
```

原始输出:
```
Name            Value
----            -----
DSH_SHELL       1
DSH_PROFILE     desktop
DSH_PROFILE_DIR C:\Users\sir_c\.dsh\profiles\desktop
DSH_SESSION_ID  6c0d6f3b-7a00-480f-8748-7e280a4f4c95
DSH_HOME        C:\Users\sir_c\.dsh
DSH_WEB_URL     http://127.0.0.1:19387
```

逐个判断:

| 变量 | 暴露什么 | 是否暴露模型/温度/思考深度/权限/作用域 |
|---|---|---|
| DSH_SHELL=1 | 标记当前在 DSH 托管 shell 中 | 否 |
| DSH_PROFILE=desktop | 当前 profile 名 | 否(仅间接指向 profile 目录) |
| DSH_PROFILE_DIR | profile 目录路径 | 否(但该目录下有 tree-engine-data,见实验 3) |
| DSH_SESSION_ID | 本会话 id | ✅ 作用域/会话 id 维度唯一的环境变量 |
| DSH_HOME | .dsh 根目录 | 否(但指向 storages/sessions 等文件所在,是文件取证入口) |
| DSH_WEB_URL | GUI 地址 | 否 |

结论:环境变量层面 **没有任何模型 / 温度 / 思考深度 / 权限变量**;作用域(会话 id、profile、cwd 由系统提示注入)可见。

## 实验 2:全量环境变量扫描(可疑变量名)

命令:
```powershell
Get-ChildItem env: | Where-Object { $_.Name -notlike 'DSH_*' } | ForEach-Object { ...名字全打印,疑似密钥值脱敏... }
```

原始输出(节选,完整名单无 ANTHROPIC_*/OPENAI_*/*API_KEY*/*TOKEN* 命中):
```
ALLUSERSPROFILE=C:\ProgramData
APPDATA=C:\Users\sir_c\AppData\Roaming
... (PATH、PROCESSOR_*、USERNAME=sir_c、TEMP 等常规系统变量)
EFC_15964_*  (6 个,宿主内部标记)
ELECTRON_RUN_AS_NODE=1
GIT_PAGER=cat / PAGER=cat / NO_COLOR=1
ZES_ENABLE_SYSMAN=1
```

结论:环境中 **不存在** ANTHROPIC_*、OPENAI_*、*_API_KEY、*_TOKEN、MODEL、TEMPERATURE 之类变量;模型路由信息完全不在进程环境里(密钥也不在 env, presumably 在 .credentials.yaml,未读取值)。

## 实验 3:会话相关文件取证(核心发现)

命令:
```powershell
# a) 在 DSH_HOME 下反查本会话 id
Get-ChildItem $env:DSH_HOME -Recurse -File -Filter *.json | Select-String -Pattern $sid -List
```
原始输出:
```
Path
----
C:\Users\sir_c\.dsh\profiles\desktop\tree-engine-data\agspec\tree-state.json
C:\Users\sir_c\.dsh\storages\session_projcache\sessions\52e0d1c8-4a43-49c9-9f00-1df375cbba49.json
C:\Users\sir_c\.dsh\storages\session_projcache\sessions\6c0d6f3b-7a00-480f-8748-7e280a4f4c95.json
```

```powershell
# b) 读自己的 projcache JSON(6c0d...json,10327 字节,ConvertFrom-Json 因中文截断报错,
#    改用原文分段/Select-String,以下为关键 row 原文摘录)
```

**本会话 projcache 文件 `storages\session_projcache\sessions\6c0d6f3b-....json` 中实际存在的行(原始片段):**

权限/沙箱(✅ 可见,且是结构化字段):
```json
"sandboxMode": { "ver": 1, "seq": 34, "val": "danger-full-access" },
"permissions": { "ver": 2, "seq": 34, "val": {
  "preset": "danger-full-access", "sandbox": "danger-full-access",
  "approval": "never", "seeded": false } },
```

模型(✅ 可见 —— lastUsed,即"上一次实际使用的模型",非启动期显式声明):
```json
"modelSelection": { "ver": 2, "seq": 34, "val": {
  "lastUsed": { "provider": "zai-coding-cn", "model": "glm-5.3" },
  "pending": null } },
"agentPreset": { "ver": 1, "seq": 34, "val": "cordis" },
```

候选模型策略(✅ 可见,允许本会话切换到的路由清单):
```json
"subagentModelSelectionPolicy": [ {"provider":"deepseek-official","model":"deepseek-flash"},
  {"deepseek-official","deepseek-v4-pro"}, {"zai-coding-cn","glm-5.3"},
  {"zai-coding-cn","glm-5.3-flash"}, {"deepseek-account",...}, {"opencode-go",...},
  {"xiaomi","mimo-v2.6-flash"|"mimo-v2.6-pro"}, {"minimax-cn","MiniMax-M2.7-highspeed"|"MiniMax-M3"} ]
```

作用域(✅ 可见):
```json
"identity": { "cwd": "D:\\Codes\\dsh-tree-harness", ... },
"subagent": { "identity": { "mode": "continuable", "label": "tree:agspec/agspec-W1-evidence", "seq": 0 } },
"agentTeam": { "id": "6c0d6f3b-7a00-480f-8748-7e280a4f4c95", ... },
```

用量上下文(附带可见):`tokenUsage`(uncachedInput 18143 / output 539 / cacheRead 35648)、`contextPressure`(contextWindow 1000000)、`sessionStats`(ttftMs 14046 等)。

**温度/思考深度:对该文件 `Select-String 'temperature|effort|reasoning'` 唯一命中是任务提示词文本本身(即用户抱怨的那句话),没有任何配置字段存温度或 reasoning effort。**

```powershell
# c) tree-state.json(7112 字节)中本会话节点,原始片段:
```
```json
"agspec-W1-evidence": { "added_by": "52e0d1c8-4a43-49c9-9f00-1df375cbba49",
  "runtime": { "state":"running",
    "subagentSessionId":"6c0d6f3b-7a00-480f-8748-7e280a4f4c95",
    "parentSessionId":"52e0d1c8-4a43-49c9-9f00-1df375cbba49", ... },
  "session_id": "6c0d6f3b-7a00-480f-8748-7e280a4f4c95" }
"agspec-root": { "session_id": "52e0d1c8-...", "model": "unknown", "channel": "unknown", ... }
```
→ 父会话 id 在文件级可见;但树里记录的 `model`/`channel` 字段本身是 `"unknown"`(树引擎没填)。

工作区 `D:\Codes\dsh-tree-harness` 内 glob `**/*.json` 仅命中 `logs\attack-log.json` 与 `packages\dsh-tree-engine\*\init|dtest|dtwo\tree-state.json`(测试夹具),不含本会话运行配置。

**注意(取证边界)**:这些文件在 `DSH_HOME` 用户目录下而非会话注入的上下文里——子会话"能看到"的前提是自己主动用 shell 去翻文件;对话内建上下文(系统提示/环境变量)并不包含模型、权限、温度。

## 实验 4:工具面试探

本会话可用工具面(摘自系统提示工具清单,共 40+):pwsh、read/write/edit、glob/grep、web_search/web_fetch、subagent/send_message、tree_report/tree_log/tree_node/tree_plan/tree_send/tree_status/tree_verify/tree_dispatch/tree_maintain、workflow、cordis_inspect_list/cordis_inspect_query、ask_user_question、create_goal/get_goal/update_goal、present、why_* 系列等。

试探命令(经 cordis_inspect_query 调用不存在的 provider `nonexistent_probe_provider`,方法名也编造为 `getSessionRuntimeConfig`):

真实报错原文:
```
Error: Host Cordis inspect provider "nonexistent_probe_provider" is not registered
```

附加证据(权限侧,来自本回合系统注入的运行时上下文,非猜测):
```
Current DSH file policy: danger-full-access.
Approval prompts are disabled in this session: actions that require approval are rejected automatically.
You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session.
```
→ 与 projcache 中 `permissions.preset=danger-full-access / approval=never` 互相印证。另:工具层面存在 `list_subagent_models`(可枚举 provider/model 目录),即"模型目录可查询、自身生效配置不在对话上下文"。

## 实验 5:结论表

| 维度 | 可见性 | 出处/来源 |
|---|---|---|
| 模型 | **部分可见** | 对话上下文 ✗;环境变量 ✗;文件 ✅:`session_projcache\sessions\<sid>.json` 的 `modelSelection.lastUsed = {zai-coding-cn, glm-5.3}`、`agentPreset=cordis`、候选路由表 `subagentModelSelectionPolicy`;`list_subagent_models` 工具可查目录。tree-state.json 中 `model:"unknown"` 未填 |
| 思考深度(reasoning effort) | **不可见** | 实验 1/2/3 均无;projcache grep `effort|reasoning` 仅命中任务提示词文本 |
| 温度 | **不可见** | 同上,任何 DSH_* 变量、会话 JSON、tree-state 均无 temperature 字段 |
| 权限 | **可见(双通道)** | 运行时上下文注入("danger-full-access / approval disabled / scope fixed at start")+ 文件 `permissions{preset,sandbox,approval}`、`sandboxMode` |
| 作用域 | **可见** | `DSH_SESSION_ID`、`DSH_PROFILE(_DIR)`、`DSH_HOME`;projcache `identity.cwd`、`subagent.identity.label`;系统提示工作目录注入 |
| 会话 id | **可见** | `DSH_SESSION_ID` env(实验 1)、projcache `agentTeam.id`、tree-state `session_id` |
| 父会话 id | **部分可见** | 对话内仅靠父代理在任务 prompt 中口头注入(`Your parent agent id is 52e0d1c8-...`);文件级 ✅:tree-state.json `runtime.parentSessionId` / `added_by` |
| token/上下文用量 | 可见(附带) | projcache `tokenUsage` / `contextPressure`(contextWindow=1000000)/ `sessionStats` |

**一句话结论**:子会话的权限、作用域、会话/父会话 id 是可观测的(env + 注入 + 文件三通道);模型只能靠翻 `~\.dsh\storages\session_projcache\sessions\<sid>.json` 里的 `modelSelection.lastUsed` 事后看到;**温度与思考深度在子会话可见的一切渠道中均不存在**——用户抱怨属实。
