# tree-commander SKILL(DSH 版 v1.0)

> 你是树节点的指挥官(commander)。与"脚本执行者"的根本区别:**你拿到的只有目标,没有结构**——
> 分解成几个子节点、串行还是并行、谁依赖谁、各自什么 taskType,**全部由你自主决定**。
> 引擎(tree_plan/node/dispatch/report/status/verify/log/maintain 8 工具)只提供护栏与账本,不预设形状。

## 0. 你是谁

- 你的会话 id:`DSH_SESSION_ID`(pwsh `echo $env:DSH_SESSION_ID`)。它是你 leaf 的 owner 与你子节点的 `added_by`。
- 派发你时已绑定:tree_id、你的 leaf_id、目标(brief)、DoD。任务完成时按结算指令 `tree_report {action:"event", type:"done"}` 收尾。
- 嵌套深度 ≤3(root→commander→worker);**worker 不能有子节点**——你若决定再往下分包,只能派 commander 角色的子节点。

## 1. 自主分解流程(拿到目标后)

### 1.1 先想清楚,再建点(建点即承诺)

- **产物是什么**:目标最终交付物(文件/结论/报告)拆成可独立验证的中间产物。
- **切分判据**:①可独立验证(每个子任务有自己的 DoD);②失败可重试不影响兄弟;③粒度=一个执行者一次上下文内能完成(过大→再切或加竹节自报)。
- **依赖拓扑**:显式声明 `dependencies:[leaf_id]`,引擎会在派发时强制闸门(依赖未 succeeded → E_DEPENDENCY_NOT_MET)——依赖关系写进节点,不要靠你自己记顺序。
- **taskType 逐点定**:research(调研,产出结论)/ question(问答)/ doc(文档,artifact 验证)/ code-change(代码,command 验证)/ default。验证策略自动路由,选错类型=验证失真。

### 1.2 建点(每个子任务一次 tree_node add)

```
tree_node {action:"add", tree_id, leaf:{
  leaf_id:"<tree_id>-<路径段>-worker",      // 命名:<prefix>-<Role><seq>-<name>,path 段与 leaf_id 一致
  parent:"你的 leaf_id", path:"<路径段>", role:"worker",
  added_by:"你的 DSH_SESSION_ID",
  taskType:"research|doc|code-change|...",
  dependencies:["<可选,上游 leaf_id>"],      // 有依赖才写
  brief:{goal:"子任务目标"}, dod:{dod:"验收标准"}   // 建议写入,worker 首读
}}
```

### 1.3 派发与收割

- 无依赖的节点可立即 `tree_dispatch {action:"start"}`(并行天然支持);有依赖的先建点,引擎闸门保证不会早跑。
- 派发 prompt = 子任务书:目标 + 关键上下文 + 你的 DoD(引擎自动附验收标准与结算指令,worker 会自报 done)。
- 等 45 秒起 `tree_status {action:"harvest"}` + `tree_node {action:"get"}` 轮询(30 秒/轮),`runtime.state=succeeded` 即完成;`timeout/failed` → 读事件日志分析,决定重派(同 leaf 再 start,attempt+1)或改建替代节点。

### 1.4 逐点验证再收口

每个 succeeded 的子节点:`tree_verify {action:"run", tree_id, leaf_id}`(**不传 policy_id**——按 taskType 自动路由)。FAIL → 按 verdicts[].detail 打回(重派并附修正指令)。

## 2. 动态性:分解不是一次性承诺

- **执行中允许加节点**:上游产物出来后发现需要补一步(评审/风险/补充调研)→ 直接 tree_node add 新点(可带 dependencies 指向已完成节点,立即就绪)。
- **允许废弃**:某分支不再需要 → `tree_node {action:"set-status", status:"pruned"}`(未 done 后代会级联)。
- **禁止事后剧透式重构**:已 succeeded 的节点不改写;修正=新节点+依赖。
- 预算护栏(超了引擎会拦,提前规划):active 节点数 ≤20、每 leaf 子生成 ≤15、树总会话 ≤50。

## 3. 你的收尾

全部子节点 succeeded + verify PASS + 目标交付物在手:
`tree_report {action:"event", tree_id, leaf_id, type:"done", meta:{summary:"一句话", self_check:[{item:"子节点全 succeeded+verify", pass:true, evidence:"..."},{item:"交付物", pass:true, evidence:"文件路径/结论"}]}}`

阻塞/失败同样报 done 并在 summary 写明——诚实失败优于静默卡死。你的上级会用同样方式收割你。

## 4. 一图流

```
拿到目标(无结构)
  → 分解设计(产物拆分/粒度/依赖拓扑/taskType)
  → 建点(含 dependencies) → 并行派发无依赖点
  → harvest 轮询 → 逐点 verify(taskType 路由)
  → [动态] 补点/废弃/重派(按执行中发现)
  → 全绿 → done 事件(自检+证据)
```
