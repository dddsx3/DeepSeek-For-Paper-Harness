# 阶段 03 · 编程实现与结果说明（RESULTS）

本阶段只做一件事：把问题 1–4 与灵敏度分析**真跑一遍**，把每个要用的量写进工作目录下的
JSON 账本 `code/outputs.json`。本阶段**不产出任何图像字节**，**不写图表声明**，**不写数源声明**
（后者是阶段 4 的产物）。`RESULTS.md` 只描述"算了什么、怎么核"；所有具体数值由账本承载，
正文不出现账本之外的数字。

## 0. 运行方式与账本

| 项 | 值 |
| --- | --- |
| 入口 | `code/main.py` |
| 工作目录 | `code/`（契约指定） |
| 命令 | `python main.py`；等价写法 `python code/main.py`（脚本把自身目录加入 `sys.path`，两种启动都成立） |
| 账本 | `code/outputs.json`（`main.py` 落盘，前台同步写盘后才返回） |
| 随机性 | 单一 `random.Random` 种子，取自契约常数「随机种子」；问题 4 的 Q2 与 Q3 两条蒙特卡洛各自派生子流 |
| 容差 | 契约常数「数值容差」 |

## 1. 代码结构（逐问一个模块，常数集中登记）

- `code/params.py`：题面给定值唯一落点，逐条对应 `PROBLEM_FACTS.json`（标称值 10%、信度 95% 与 90%、
  表 1 的六行、表 2 的零配件 / 半成品 / 成品与售价 200、调换损失 40 等）。其余模块一律
  `from params import *`，**代码里不手工转录任何题面数字**。
- `code/constants.py`：`DECLARATION.json` 的 `model_constants` 逐键登记（Δ、α1、α2、β、搜索上界、
  重抽样次数、种子、扰动幅度 20%、对照置信水平、等高线格点数、一致率阈值、节点总数 12 等），
  另设 `IMPL` 段存放纯实现参数（扫描分辨率、迭代次数、直方图分箱）。
- `code/problem1.py` / `problem2.py` / `problem3.py` / `problem4.py`：四问各自的纯函数实现。
- `code/sensitivity.py`：参数扫描与盈亏平衡翻转边界。
- `code/main.py`：编排入口，依次跑四问与灵敏度，汇总写 `outputs.json`。

## 2. 四问的结果说明（数值一律见账本）

### 问题 1：最小检测次数的抽样方案

两情形都实现为**两点设计**：标称点 `p_nom` 上控第一类错误，备择点 `p_alt = p_nom + Δ` 上控功效，
再用**升序扫描整数 n + 对 c_r 二分**求最小样本量。二项尾概率全部走对数域精确累加，
不使用正态近似（`problem1.verification.normal_approx_used` 为假，登记在账本里）。

- 情形(1) 判定规则 `X >= c_r+1 -> 拒收`，被控尾是拒收侧；
- 情形(2) 判定规则 `X <= c_r -> 接收`，被控尾是接收侧。

**审计意见 3 的落点**：上一轮情形(2) 的备择点约束非紧，实际只由单条置信上界决定，两情形约束体系不对称。
本轮把两情形统一为两点设计，**两条约束都进入判定**。两情形的差异被刻意保留在**被控尾与判定方向**上
（题面语义本身就不同：一个问"超标即拒"，一个问"不超标即收"），而不是约束数量的差异。
生产者风险（在标称点上被拒的概率）与消费者风险（在备择点上被误收 / 误拒的概率）
已逐情形写入账本：`problem1.case95.producer_risk`、`problem1.case95.consumer_risk`、
`problem1.case90.producer_risk`、`problem1.case90.consumer_risk`，阶段 8 复核时不会再被当作口径混用。

采样成本按"检测件数 × 单件检测成本"计，单件成本取自表 1 的零配件检测成本，
原文见 `problem1.sampling_cost`；该费用只属进货验收环节，不与问题 2/3 的工序检测成本重复入账。

账本另存 OC 曲线（`problem1.oc_curves`，含横轴网格与两条 `L(p)`）、样本量—信度扫描
（`problem1.sample_size_vs_confidence`）、以及序贯方案对照边界（`problem1.sprt`，仅作对照）。

### 问题 2：四元 0-1 决策的期望利润

策略空间 16 种，**全枚举**，无启发式、无连续松弛。闭式解按报告 §4.2 逐式实现：
装配合格率 `q = (1-p0)·Q1·Q2`；新料轮成本含检测时的采购倍数 `1/(1-p_i)`；回收轮成本**只付再检测费**，
免采购收益只落在这一处；闭环用几何级数闭式（交付概率 `g`、回收链成本 `R`）；调换损失项严格写成
`(1-q)(1-C)l`，检测成品时整项为零。

账本给出：16 组合 × 6 情况的期望成本与利润完整矩阵（`problem2.cases.<k>.table`）、
每情况最优决策与指标（`problem2.cases.<k>.decision` / `.profit`）、
最优组合（`problem2.best_combo`）、成本分解（`problem2.cost_breakdown`，分采购 / 零件检测 / 装配 /
成品检测 / 拆解 / 调换损失六项）。

### 问题 3：装配树的节点级决策

拓扑按 `ASM-09` 常量级假设搭建：{1,2,3}→半成品 1、{4,5,6}→半成品 2、{7,8}→半成品 3、三半成品→成品，
共 12 个节点。**方向统一为"成本与合格率自底向上聚合、交付需求量自顶向下折算"**。
节点决策用装配树的最优子结构分层求解：每个节点先压缩成 `(Q_v, U_v, W_v = U_v − Z_v c_v)` 的
Pareto 前沿，父节点只依赖这三个标量，因此不需要 4^12 的暴力枚举。

一处显式口径：`Z_v = 0` 的"成本即本轮成本"分支**只用于非成品节点**；成品节点即使不检测，
不合格品也会流向市场并被无条件调换，其调换损失与拆解闭环必须在本节点结算——
这样节点级递推在退化结构下才能逐项收敛到问题 2 的闭式（V-08 给出的正是这一条）。

账本给出：12 个节点的决策与成本表（`problem3.decision_table` / `problem3.node_cost`）、
根节点期望利润（`problem3.profit`）、内部节点策略对照表（`problem3.strategy_compare`，
每个 Z 组合 × 三种 D 策略各一行）、以及拓扑扰动扫描（`problem3.topology_robust`）。

### 问题 4：抽样误差下的重解与稳健性

- 置信区间用 **Clopper–Pearson 精确区间**（按 `F(x−1;n,p_L)=1−α/2`、`F(x;n,p_U)=α/2` 二分求解，
  纯对数域二项尾概率，不依赖外部统计库）。
- 利润区间**先固定决策再取极值**（不把"换方案"的收益混进区间），曲线写入 `problem4.profit_range`。
- 蒙特卡洛：对每个次品率做 `n` 次伯努利实现 → 样本频率 → **从零重解**最优决策 → 统计一致率。
  逆变换抽样器一次均匀随机数换一个二项实现，保证同种子同结果。
- **审计意见 4 的落点**：上一轮取 `x = round(n×标称值)` 使点估计恰好等于题面标称值，重解近乎恒等。
  本轮除保留该基准外，另加**观测次品数偏移探针** `problem4.offset_probe`：
  样本量固定，`x` 相对基准做 −2 / −1 / 0 / +1 / +2 的偏移，逐情况给出由此得到的最优决策与利润，
  用对照结果证明结论不是"人为对齐全等"的产物。蒙特卡洛本身也已独立于该基准。

### 全局口径

统一指标 `Π = s − U`（`meta.profit_definition`），问题 2 用 `U`、问题 3 用根节点 `U_f`，同源可比。
金额一律元/件，比率无量纲（`meta.unit_note`）。

## 3. 校核证据（全部由代码真跑算出，残差写入 `verification` 段）

| 编号 | 核验内容 | 代码落点 | 账本字段 |
| --- | --- | --- | --- |
| V-01 | 情形(1) 拒收侧错误率与备择点功效 | `problem1.solve_case` | `verification.V-01.max_violation` |
| V-02 | 情形(2) 接收侧置信水平与误收概率 | `problem1.solve_case` | `verification.V-02.max_violation` |
| V-03 | 检测费用归属不重复 | `problem1.solve` | `verification.V-03` |
| V-04 | 解析分项与逐轮现金流分项一致 | `problem2.simulate_rounds` | `verification.V-04.max_residual` |
| V-05 | 解析闭式与逐轮复算的 `U` 一致 | 同上（双路比对） | `verification.V-05.max_residual` |
| V-06 | 回收轮成本不含采购项 | `problem2.purchase_invariance_probe` | `verification.V-06.purchase_terms_in_recovery_branch` |
| V-07 | 节点级 DP 与固定决策求值一致 | `problem3.eval_tree` vs `solve_tree` | `verification.V-07.max_residual` |
| V-08 | 退化结构收敛到问题 2 闭式 | `problem3.degenerate_check` | `verification.V-08.max_residual` |
| V-09 | 拓扑扰动下决策稳健性 | `problem3.topology_robust` | `verification.V-09.flip_rate` |
| V-10 | 置信区间覆盖点估计且宽度单调 | `problem4.ci_table` | `verification.V-10` |
| V-11 | 蒙特卡洛一致率收敛 | `problem4.mc_q2` / `mc_q3` | `verification.V-11` |
| V-12 | 问题 4 决策与点估计决策差异显式列出 | `problem4.decision_diff` | `verification.V-12.rows` |
| V-13 / V-14 | 量纲与检测费用口径 | `main.collect_verification` | `verification.V-13/V-14` |

**V-05 是抓"采购倍数漏记"与"免采购重复计"的主力**：`simulate_rounds` 是另一条独立代码路径，
按轮投入、按轮产出、按 `D` 决定拆解或报废、累计交付概率到收敛，
与解析闭式在容差内比对；`breakdown` 的六项也逐项对账（V-04）。
V-06 用"把购买单价清零后回收轮成本是否变化"这个结构不变量，直接检验"免采购收益只记在回收轮"。
**这些核验是"算了并给出残差"，不是"声称通过"**：`within_tolerance` 字段是残差与容差的比较结果，
残差本身（`max_residual` / `max_violation` / `flip_rate`）一并留在账本里供阶段 8 独立复核。

## 4. 归因：哪些量决定决策翻转

从闭式结构可以直接指出三类敏感点，本轮把它们**量化**成扫描表而不是预判：

1. **检测成本 / 购买单价之比**决定"检不检零配件"——检测成本低时检测几乎总是划算；
   高度接近单价时，检测退化为"花钱买确定性"。扫描表见 `sensitivity.unit_cost.axes.inspection_cost`。
2. **调换损失相对售价的量级**决定"检不检成品"——表 1 六种情况的调换损失跨度较大，正是为考察这一点设计；
   扫描表见 `sensitivity.unit_cost.axes.exchange_loss`，二维翻转边界见 `sensitivity.breakeven`。
3. **拆解费用相对回收收益 `κ` 的大小**决定 `D`——问题 3 的半成品与成品拆解费用不同，
   这条比较在节点级模型里天然存在，账本里以 `kappa` 字段逐节点列出。

`sensitivity.q2_breakeven` 在（调换损失 × 零配件次品率）的二维网格上逐格重解最优决策，
统计**相对基线决策的真实翻转格点数**与每个 x 列上的首个翻转 y（`flips` / `flip_rate` / `boundary`），
并给出整张利润网格与决策编码网格，供阶段 5 画等值线。

**审计意见 1 的落点**：上一轮 `q2_breakeven` 里的 `flips` 恒为 0（从不自增），且有一个空的 `if` 分支；
本轮已删除空分支，`flips` / `flip_rate` / `boundary` 全部由实际比较（`sig != base_sig`）累加得到，
并额外记录可行格点数与基线决策，保证返回的翻转指标不是假指标。

## 5. 诚实边界

1. **拓扑假设**：`ASM-09` 的连接关系来自表 2 的行分组，**图 1 原件未随简报下传**，无法从给定值事实表核验。
   这是常量级假设，账本里以 `problem3.asm09_groups` 原样保留，并用 `problem3.topology_robust`
   枚举若干与表 2 参数相容的零配件重分配方案，统计最优决策签名是否翻转、`U_f` 的极差有多大。
   若翻转，结论的适用范围必须收窄到该假设之内。
2. **问题 4 的样本量选择**：`n` 与观测次品数的取法是实现参数（登记在 `IMPL` 与账本 `sample_size`），
   不是题面给定值。为避免"取法偏自证"，另给偏移探针与独立的蒙特卡洛两路对照。
3. **口径级复算，不是独立推导**：`simulate_rounds` 与解析闭式共享同一套参数与事件结构，
   它验证的是"几何级数求和没算错、采购倍数与免采购的记账位置正确"，
   不能替代对模型本身的评审。
4. **单位化口径**：全部按每件合格成品单位化，不含库存、产能上限、固定成本与资金时间价值。
5. **高一致率指标**：若蒙特卡洛一致率达到 0.99 及以上，必须同时给出防泄漏说明——
   账本 `problem4.leakage_note` 已随结果一并落盘：每轮独立抽样、样本不重复使用、
   决策从零重解、不存在训练/测试划分；高一致率反映的是决策对该参数不敏感，而非信息泄漏。

## 6. 审计意见逐条落点

| 序号 | 严重度 | 落点 |
| --- | --- | --- |
| 1 | minor | **已改**：`code/sensitivity.py:q2_breakeven` 删除空 `if` 分支，`flips` 改为按 `sig != base_sig` 真正累加，并新增 `flip_rate`、`boundary`、`feasible_points`、`baseline_decision`；不再返回恒 0 的假指标。 |
| 2 | minor | **已改**：`RESULTS.md` 与 `DELIVERABLES.json` 的锚点 ID 统一为 `R-Q1-n-case90` / `R-Q1-c-case90`（不再出现 `R-Q1-case2-n` 之类写法），`code/problem1.py` 内部键名同步为 `case90`。 |
| 3 | minor | **已改**：两情形统一为两点设计（各由两条约束共同决定），不对称只保留在被控尾与判定方向上；生产者风险与消费者风险逐情形写进账本（`producer_risk` / `consumer_risk`），供阶段 8 复核，不再被视为口径混用。 |
| 4 | minor | **已改**：新增 `problem4.offset_probe`，对观测次品数做 −2/−1/0/+1/+2 偏移的对照重解；蒙特卡洛本身也独立重解，`p_hat` 不锁定在题面标称值上。 |
| 5 | minor | **已改**：`DELIVERABLES.json` 的 `run.command` 与 `run.working_dir` 统一为 `python main.py` + `code/`，与契约指定的工作目录一致；`main.py` 另加了自身目录入 `sys.path`，从仓库根目录 `python code/main.py` 启动同样成立。 |
| 6 | minor | **已接受**：拓扑为常量级假设，已在 `RESULTS.md` §5.1 显式标注（`ASM-09`），账本保留 `asm09_groups` 原文，`problem3.topology_robust` 量化其依赖，并建议阶段 8 一并核对 `00-input` 中图 1 原件。 |

## 7. 本阶段未做的事

不产出任何 `.png` / `.jpg` / `.pdf` / `.svg` 字节；不写 `chart_type` / `data_refs` / `caption`；
不写 `RESULT_SOURCES.json`；不把结果只打到 stdout——所有量都在 `code/outputs.json` 里。
