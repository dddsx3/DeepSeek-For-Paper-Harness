# TASK-P1 — known-risks（诚实边界；每条含防再犯规则）

> 纪律 A1：红字在册 > 假绿。以下每项都是真实存在或观察到的边界，
> 全部 fail-closed（宁可 BLOCK 不可静默放行）。P1 收口于 2026-09-04。

## 1. executor 未内嵌 code-run/interpretation 整链（D7）
produceFromExecute 只做"EXECUTE 容器 → store + 审计"。真实代码执行、
Result/Claim 生产与交付评估目前由 pipeline composition（demo runner）
权威承担；executor 的 EXECUTE 节点语义仍是"产容器"。真实 agent 工作流
若直接开 produceFromExecute 会得到无 run 证据的 store（execution 门在
FORMAL 下必 BLOCK——fail-closed，不会假绿，但也不能交付）。
- 防再犯：开 produceFromExecute 的部署必须自行编排 code-run（P2 内嵌
  前如此）；任何"EXECUTE 容器后直接声称可 FORMAL 交付"的路径都被门拦。

## 2. firewall capability 的 code-run 白名单未并入 executor（D7 边界）
P1-2 任务书 "EXECUTE 经 firewall 请求 code-run"：capability 白名单未
改动（FORBIDDEN_CAPABILITIES 原样）。demo 的 runner 命令是部署方固定
的 `node main.js`（非模型可写），无 shell-web 面。
- 防再犯：模型永不可选择 runner 命令/入口；runnerCommand 由组合层注入。

## 3. 真实 provider 遵从率尚未采集（首次路径依赖）
P1-5 demo 用确定性 fake provider（容器内容由 cases 构造），真实大模型
对 ir-container-v1 协议的遵从率没有 ≥20 次调用的实测。不达标即降级该
provider 到 EXPLORATORY。
- 防再犯：P1 收口后首个真实 provider 实验必须记录遵从率并入库。

## 4. A7 coverage 计数界的对应性缺口（P1-4 D1，P3 收窄）
REQUIRED_OUTPUT 与 result 的文本↔结果一一对应在 IR v1 不可判定，v0 取
COUNT 界（N outputs 需 ≥N distinct reaching results）。over-promise 被
拦（见 pass-corpus OVER-PROMISE 击杀），但"文本上声称 A 实际证明 B"的
语义替换在 v0 不可察（P3 引入 reviewer 语义核对）。
- 防再犯：v0 只承诺计数闭包；语义闭包显式列为 P3。

## 5. numeric 一致性无容差（R1-3 冻结，4.4/P3 容差层）
`a === b` + 单位相等精确比较，无容差/单位换算（'m' vs 'cm' 直接 BLOCK）。
科学论文含换算单位的结论会被拦——fail-closed 方向正确，但误杀面真实。
- 防再犯：P3 容差层落地前，单位必须显式一致；pass corpus 保护基线。

## 6. renderer 结论区数字守卫是保守文本分析（D5）
结论区自由书写被严格限制为 Result 值/uncertainty 集合。合法的"方法性"
数字若误入 conclusion（如样本数 'n=120'）会被拒——宁可拒不可错放；
v1.1 可引入结构化 conclusion 槽位替代纯文本。
- 防再犯：写 conclusion 只引用结果数字；方法细节放 methods 区。

## 7. figure_data_consistency 是 vacuous v0（D3，待作者复签）
无 FigureSpec → PASS；有 FigureSpec → BLOCKED（P2 语义未定义）。
figure-less 论文可交付；任何带图论文在 P2 前不可 FORMAL 交付。
- 防再犯：P2 实现 FigureSpec data_hash 真校验后解除 vacuous。

## 8. mutate-on-Windows 残留风险沿用（5.0-R known-risks item 10）
本批未在本机跑 mutations wrapper；demo/corpus 的真 spawn 均在 tsx 直接
进程下完成（非 vitest worker）。提交前 git status 全量核对照旧。

## 9. ExecutionRecord 只能走 capture 门（INV-3-M）——P1 期间无新通道
interpretation/execution producer 均不创建 ExecutionRecord；replay/
audit 的 loadCode 域是 async（正常），stale 门 loadCode 是同步（P1-4 已
去 hack）。两类 loadCode 语义不可混用。
- 防再犯：新代码如需"读代码字节"，先确认是 capture/replay 域（async）
  还是 stale/delivery 域（sync，须在调用前预解析）。
