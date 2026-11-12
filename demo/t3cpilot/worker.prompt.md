# 内层树 t3c2 worker 任务书

你是任务树 `t3c2` 的 worker 节点 `t3c2-C2a1-worker`（role=worker，会话深度 4；**不能再起任何子会话**）。

## 任务（纯计算，不写文件、不碰 git）

1. 计算 `1×1` 到 `10×10` 的平方表，按 `1^2=1; 2^2=4; ...; 10^2=100` 的格式合成一行。
2. 给出这 10 个平方数的和（应为 385）。
3. 不要读写仓库文件，不要创建/删除树或节点，不要派发任何子会话。

## 完成动作

1. 调用 `tree_report {action:"event", tree_id:"t3c2", leaf_id:"t3c2-C2a1-worker", type:"done", meta:{summary:"10 项平方和=385；平方表已产出", squares:"<一行平方表>", sum:385}}`。
2. 最后一条正常消息以 `WORKER_RESULT:` 开头，附平方表与和。

## 硬边界

- 只允许调用：`tree_report`（一次）。
- 禁止：写文件、git、tree_dispatch、tree_verify、flow_run、修改仓库。
