# 阶段 03 · 编程实现与结果说明

## 0. 本阶段做了什么

本阶段只做一件事：让数字由真跑出来的代码产生。`code/main.py` 是编排入口，工作目录为 `code/`，
执行 `python code/main.py` 会依次跑问题 1—4，并把全部结果量写进 `code/outputs.json`，
运行台账写进 `code/run_log.json`。**stdout 不承载任何结果量**，所有要进论文的数一律落在 JSON 账本里。

本阶段不画图、不写图表声明、不写数源声明——渲染是阶段 5/6 的事，`{locator, json_path}` 是阶段 4 的事。

## 1. 文件结构与职责

| 文件 | 职责 |
| --- | --- |
| `code/params.py` | 唯一常量容器。题面给定值逐条对应 `PROBLEM_FACTS.json` 的 `F-*`；模型常数逐条对应 `DECLARATION.json` 的 `model_constants`。其余脚本一律 `from params import ...`，不在函数体内写裸数字。 |
| `code/problem1.py` | 单侧二项两点设计 + 整数样本量最小化精确枚举（EQ-Q1-REJECT / EQ-Q1-ACCEPT）。同时导出 OC 曲线序列、样本量—信度序列、检测费用折算。 |
| `code/problem2.py` | 四元 0-1 决策 16 组合全枚举（EQ-Q2-YIELD / EQ-KF / EQ-KR / EQ-Q2-RECUR / EQ-COST-Q2），并导出灵敏度曲线与盈亏平衡网格。 |
| `code/problem3.py` | 装配树节点级递推（EQ-Q3-ASSY / NODE / KF / KAPPA / XI / RECUR / UNITCOST），叶节点 Z 枚举 × 半成品 (Z,D) × 成品 (Z,D) 全枚举，并做拓扑扰动扫描。 |
| `code/problem4.py` | 点估计 + Clopper-Pearson 区间 + 决策固定下的利润区间 + 重复抽样决策一致率（EQ-Q4-CI / PROFIT-RANGE / ROBUST）。 |
| `code/main.py` | 编排、异常隔离、账本落盘。 |

## 2. 四问的关键数值在哪

本阶段不在此处复写任何具体数值——数值一律以账本键路径的形式指认，供阶段 4 逐条登记：

- **问题 1**：`problem1.case95.n`、`problem1.case95.c_r`（95% 信度拒收情形的最小检测次数与判定临界次品数），
  `problem1.case90.n`、`problem1.case90.c_r`（90% 信度接收情形）；两情形在备择点处的功效与误收概率见
  `problem1.case95.power_at_alt`、`problem1.case90.accept_prob_at_alt`。检测费用归属见 `problem1.sampling_cost.*`。
- **问题 2**：`problem2.cases[i].optimal`（表 1 第 i+1 种情况的最优 (Z1,Z2,C,D)、期望成本 `U`、期望利润 `profit`
  与五类分项成本 `breakdown`），`problem2.cases[i].strategies[j]`（该情况下 16 种组合的完整对照）。
- **问题 3**：`problem3.optimal.decisions`（每个零配件/半成品/成品节点的是否检测、是否拆解），
  `problem3.optimal.profit`、`problem3.optimal.U_f`、`problem3.optimal.node_cost`（逐节点等效获取成本与合格概率）。
- **问题 4**：`problem4.ci.*`（逐部件的点估计与精确区间）、`problem4.profit_range.*`（决策固定下的利润区间）、
  `problem4.consistency_rate.*`（重复抽样下最优决策组合的一致率）、`problem4.decision_diff`（相对点估计决策的差异表）。
- **全局**：`problem2.*` 与 `problem3.*` 共用 `Π = s − U` 一支指标，金额单位元/件、比率无量纲。

## 3. 校核证据（本阶段真跑了哪些核）

1. **解析闭式 vs 分项求和**：`problem2.cases[i].optimal.breakdown` 的五个分项之和写回 `breakdown.total`，
   与闭式解 `U` 在同一容差（`params.TOL`）内比对。分项按“第 0 轮按新料口径、回收轮按回收料口径”展开，
   展开式中采购项只出现一次、回收件免采购只落在 `K_r`，故同时构成对重复计价的审计。
2. **规划式两端复核**：问题 1 的两个情形解出 (n, c_r) 之后，用精确二项尾概率重算
   `P(X >= c_r+1 | p_nom)`、`P(X >= c_r+1 | p_alt)`（情形 1）与 `P(X <= c_r | p_nom)`、`P(X <= c_r | p_alt)`（情形 2），
   写回 `case95.*` / `case90.*`，可与 α、β 直接对账。
3. **置信区间覆盖**：`problem4.ci` 的 `low <= p_hat <= high` 由 Clopper-Pearson 构造保证，
   且端点随样本量单调（区间端点直接写进账本，供阶段 4/8 逐条核）。
4. **蒙特卡洛收敛**：`problem4.convergence.checkpoints` 与 `rate_p2` / `rate_p3` 给出前缀一致率序列，
   用于核验一致率随重抽样次数收敛，并与 `problem4.consistency_threshold` 比对。
5. **拓扑稳健性**：`problem3.topology_robust` 枚举 `TOPOLOGY_VARIANTS` 中 5 种与表 2 参数相容的连接方案，
   给出各方案的最优利润、决策向量与一致率——这是 ASM-09（图 1 拓扑假设）的数据缺口所要求的显式量化。

## 4. 归因：为什么用这些方法

- 问题 1 的“检测次数尽可能少”是**离散优化**：n 是计件数，且只控单侧错误会让目标退化到 n=1，
  因此引入备择点 `p_alt = p_nom + Δ` 与功效下界 `1-β`（ASM-14），再用精确二项尾概率逐 n 枚举。
  小 n 区正态近似不可靠，主方案不用近似。
- 问题 2 的策略空间只有 `params.Q2_N_STRATEGIES` 种，期望指标有闭式，因此**全枚举**而非启发式或松弛；
  拆解回流在时间上成环但不构成无限期决策，几何级数闭式即可，不需要 MDP。
- 问题 3 的可解性来自装配树的**最优子结构**：先把每个子节点压缩成一个“每件交付件的等效获取成本”，
  父节点才退化成与问题 2 同构的局部问题。成本与合格率**自底向上聚合**（`U_u, Q_u → K_f(v), q_v, U_v`），
  交付需求量**自顶向下折算**（本实例按每件成品单位化）。
- 问题 4 的核心不是“把次品率换成区间再算一遍利润”，而是回答“次品率偏离多少会让**最优决策翻转**”。
  决策是离散的，翻转是唯一要紧的风险，因此主指标取重复抽样下最优决策组合的一致率，
  利润区间则在**决策固定下**传播，避免把“换方案”的收益混进区间。

## 5. 抽样口径（声明抽样即必须给出）

- **抽样框与方式**：供应商来料批量足够大，按简单随机抽样（ASM-06）；样本中的次品件数取二项分布近似超几何。
- **估计量**：点估计 `p_hat = x / n`（`SYM-phat`）。
- **区间**：Clopper-Pearson 精确二项区间（`EQ-Q4-CI`，ASM-16），端点用 Beta 分位数表示，
  中心取样本频率；小样本与极端比例下不失效，覆盖正确、端点单调。
- **样本量**：问题 4 的样本量复用问题 1 情形 (2) 解出的最小 n（记在 `problem4.sample_size`）；
  重复抽样时样本量不变，每次独立重抽，随机数由登记种子（`params.RANDOM_SEED`）派生的独立子流产生，
  问题 2 与问题 3 的重抽样各自使用独立子流，增加重抽样次数不会打乱既有结果。
- **与问题 1 的口径分工**：问题 1 的检测费是进货验收的抽样费用（`problem1.sampling_cost`），
  与问题 2/3 的工序检测成本是两笔账，分项独立、不重复计入。

## 6. 账本里为阶段 5 出图预留的序列结构

阶段 5 的 14 张数据图各自需要的数据结构，本阶段已按“要什么形状给什么形状”落到账本里：

- **OC 曲线**（折线图）→ `problem1.oc_curve.p_grid` / `problem1.oc_curve.accept_prob`（101 点序列）。
- **样本量—信度关系**（折线图）→ `problem1.confidence_sweep.confidence` / `n_case95` / `n_case90`。
- **两情形样本量对比**（分组柱状）→ `problem1.case95.n` 与 `problem1.case90.n`。
- **16 组合期望成本热力图**→ `problem2.cases[i].strategies[j]`（每种情况 16 条完整记录，含 `U` 与 `code`）。
- **最优策略成本分解**（堆叠条形）→ `problem2.cases[i].optimal.breakdown`（五类分项）。
- **六种情况决策对照**（分组柱状）→ `problem2.cases[i].optimal`。
- **灵敏度（次品率 / 单位成本）**（折线）→ `problem2.sensitivity_defect_rate.*`、`problem2.sensitivity_unit_cost.*`
  （各 9 个扰动点 × 对应指标序列）。
- **盈亏平衡等高线**→ `problem2.breakeven.x_values` / `y_values` / `grid`（41×41 参数网格上的决策编码）。
- **装配网络成本**（网络结构）→ `problem3.optimal.node_cost`（逐节点 `U`、`Q`、`Kf`、`Kr`、`kappa`）+ `problem3.nodes`。
- **策略对比**（分组条形）→ `problem3.strategy_compare`（16 种半成品/成品决策组合的 `U_f` 与 `profit`）。
- **置信区间对利润的影响**（带置信带折线）→ `problem4.ci` + `problem4.ci_profit_curve.p_grid` / `profit`。
- **蒙特卡洛稳健性**（柱状 + 收敛曲线）→ `problem4.convergence.checkpoints` / `rate_p2` / `rate_p3` + `problem4.consistency_rate`。

图 `fig_q1_sprt_boundary`（序贯方案对照）与两张流程图（`fig_decision_pipeline`、`tikz_process_route`）的取数来源：
序贯方案的接受/拒收/继续抽样边界可由 `problem1.case95` 的 (n, c_r) 与 α、β 在阶段 5 由账本推导；
两张流程图不依赖账本数值，节点与边已在阶段 1 的 `ARCH_DECLARATION` 中给定。

## 7. 下游必须先读的字段（运行节提示）

`outputs.json#/meta` 内：

- `ok_all`（布尔）：四问是否全部成功。
- `failed_problems`（清单）：失败的问名。
- `problems_ok`（逐问布尔）、`entry_functions`（入口函数名）、`errors`（异常与栈）。

单问失败时 `main.py` 不中止其余各问，账本仍会落盘；**下游在读到 `ok_all=false` 之前不应把账本当作完整结果使用**。
`run_log.json` 与 `outputs.json#/meta` 内容同源，供阶段 4 直接登记运行台账。

## 8. 诚实边界

1. **本阶段不声称任何检验“通过”**。上面第 3 节列的是“跑了哪些核、核的结果写回账本的哪个键”，
   判定由阶段 8 独立复核；本文件不复述任何账本之外的自算数字。
2. **ASM-09 是数据缺口下的显式假设**。图 1 原件未随阶段简报下传，连接关系由表 2 的行分组读出。
   本阶段用 `problem3.topology_robust` 枚举 5 种相容拓扑量化其影响，但无法消除该缺口——
   若一致率低于 `problem4.consistency_threshold`，问题 3 的实例结论应被表述为“依赖 ASM-09”。
3. **Z_v = 0 的分支处理**。上游 `EQ-Q3-UNITCOST` 规定“Z_v=0 时 U_v = K_f(v)，子件缺陷上递”。
   本实现对**非根节点**严格按该分支处理；对**成品节点**（根）恒走完整闭式，因为成品节点的次品会经
   无条件调换退回并产生调换损失（HC-09），若在该处取 `U_v = K_f(v)` 等于让调换损失凭空消失，
   与问题 2 的闭式解不可能退化对齐（核验项 V-08）。该处理已在代码注释中标注。
4. **Q3 的重复抽样次数**低于 `Q4重抽样次数`：问题 3 的每次重解都要在装配树上做全枚举，
   为把本阶段的前台同步运行控制在可接受时长内，问题 3 的蒙特卡洛用 `params.Q3_MC_REPS`，
   问题 2 用 `Q4重抽样次数`。两者各自独立子流、各自可复现，实际次数记在 `problem4.consistency_reps`。
5. **单件口径**：全部数量按每件成品单位化，不含库存、产能上限、固定成本与资金时间价值（ASM-04）；
   检测 100% 准确（ASM-01）、各节点次品相互独立（ASM-03）、拆解无损（ASM-02）均为假设，非实测。

## 9. 上一轮审计意见的逐条落点

1. **[major] run_log.json 无代码路径写出** —— **已改**：`code/main.py` 新增 `RUN_LOG_FILE` 与 `_write_json(RUN_LOG_FILE, meta)`，
   在同一次 `main()` 调用中把 `meta`（含 `entry_functions`、`top_level_keys`、`constant_snapshot`、`constant_notes`、
   `problems_ok`、`failed_problems`）另存为 `code/run_log.json`。`DELIVERABLES.json` 以
   `json_path = "run_log.json#/"` 登记该文件，与 `outputs.json#/meta` 同源。
2. **[minor] problem1.py 函数体内兜底默认值** —— **已改**：`problem1.solve_case_reject` / `solve_case_accept` 只接受显式传入的
   `p_nom/p_alt/alpha/beta/n_max`，由 `run()` 从 `params` 取（`P_NOMINAL`、`Q1_DELTA`、`Q1_ALPHA1/Q1_ALPHA2`、`Q1_BETA`、
   `Q1_N_MAX`），**不存在任何函数体兜底默认值**；`params` 缺失即 `ImportError`，不会静默回落到裸题面值。
3. **[minor] 单问失败仍以零码退出的歧义** —— **已改（按建议的落地方式）**：`main()` 保留“不中止”策略，
   但在 `outputs.json#/meta` 增加布尔 `ok_all`、失败问清单 `failed_problems` 与逐问状态 `problems_ok`，
   并在本文件第 7 节显式提示下游“先读 `ok_all` 再取数”；`run_log.json` 同步携带同一组字段。
4. **[minor] 上游 DECLARATION.json 的 model_constants 不可见** —— **已改**：本阶段 `code/params.py` 把 DECLARATION 的
   `model_constants` 段**逐键原名、原值**搬入 `MODEL_CONSTANTS` 字典（中文键名一致），并加 `CONSTANT_NOTES` 标注
   “已登记已启用 / 已登记未启用”两类，随 `outputs.json#/meta.constant_snapshot` 与 `run_log.json` 一并交付，
   供阶段 4 逐条与本轮登记值对齐。
