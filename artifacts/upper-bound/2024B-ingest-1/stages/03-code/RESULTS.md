# 阶段 03 · 编程实现与结果说明（RESULTS）

本文件说明**代码算了什么、怎么算、怎么自查**；一切具体数值由账本 `code/outputs.json` 承载，
正文只以账本路径引用（门禁 numbers_traced）。账本由 `python code/main.py` 真跑生成，
路径由 `__file__` 定位，与工作目录无关。

## 0. 本阶段做了什么 / 没做什么

**做了**：逐问的可执行实现（`code/problem1.py` … `code/problem4.py`）、灵敏度扫描（`code/sensitivity.py`）、
同源复算与结构核验（`code/verification.py`）、编排入口（`code/main.py`）、唯一的题面给定值落点（`code/params.py`）。

**没做**：不产出任何图像字节（无 `plt.savefig` / `save_fig`）；不写图表声明（无 `chart_type` / `data_refs` / `caption`）；
不写 `RESULT_SOURCES.json`（那是下一阶段数源声明的产物）。`DELIVERABLES.json` 里的 `data_arrays` 只是
**数据可用性清单**（路径 + 行数 + 说明），不含图名，不构成图表声明。

## 1. 算法与常数来源

- 问题 1：单侧二项两点设计 + 整数样本量最小化搜索。判定口径逐字对应 `EQ-Q1-REJECT` / `EQ-Q1-ACCEPT`；
  二分只用于加速搜索顺序，不改变可行域边界。序贯方案（SPRT）只作为对照数据输出，不进入主方案（ASM-11）。
  结果：`outputs.json:problem1.case95.n`、`outputs.json:problem1.case90.n`，检测费用折算见 `outputs.json:problem1.sampling_cost`。
- 问题 2：`(Z1,Z2,C,D)` 共 16 种组合全枚举，期望利润取 argmax。`Kf` 统一写作
  `A + Σ_i [ z_i(a_i+c_i)/(1-p_i) + (1-z_i)a_i ]`——**检测费只出现一次**（见 §7 审计落点 1）。
  结果：`outputs.json:problem2.cases[*].decision`、`outputs.json:problem2.six_cases.profit`、
  `outputs.json:problem2.cost_breakdown.values`。
- 问题 3：节点级递推 + 帕累托前沿筛选（父节点对 `U` 单调减、对 `Q` 单调增，故筛选不损失全局最优）。
  叶节点 `D` 恒为 0（无子件可回收，`κ=0`），内部节点 `z=0` 走 `U_v = K_f(v)` 退化分支。
  结果：`outputs.json:problem3.decision_table`、`outputs.json:problem3.profit`、`outputs.json:problem3.node_cost`。
- 问题 4：抽样估计 → Clopper-Pearson 精确区间 → 决策固定下的利润区间 → 重抽样一致率。
  抽样口径完整写在 `outputs.json:problem4.sampling_spec`（设计、样本量、区间、重抽样规则、种子、随机源）。
- 常数读取纪律：题面给定值只在 `code/params.py` 出现一次（表 1、表 2、标称值与两个信度）；
  模型常数按 `DECLARATION.json :: model_constants` 的键名逐条登记；发动机自定的网格常数在 `params.py` 第 6 节集中登记。
  本阶段**不再宣称**“代码里不出现题面数字”，而是“题面数字在 params.py 有唯一落点”（见 §7 审计落点 5）。

## 2. 独立复算通道（逐轮现金流）

`problem2.chain_unit_cost` 是一套不依赖闭式的“傻瓜版”逐轮展开器：第 0 轮投新料 → 失败付处置费 →
`D=1` 进入回收轮回（回收轮的失败继续拆解）、`D=0` 报废并重新投料，累计期望成本与期望合格产出后取比值。
`problem3` 的节点递推由 `evaluate_full` 提供正向核算通道，与帕累托求解器的结果互相印证。

## 3. 校核表（全部为代码自检，措辞只描述“算了什么”）

| 编号 | 内容 | 账本路径 |
| --- | --- | --- |
| V-01 | 情形(1) 两条尾约束的最大违反量 | `outputs.json:verification.v01_max_violation` |
| V-02 | 情形(2) 两条尾约束的最大违反量 | `outputs.json:verification.v02_max_violation` |
| V-03 | 问题1 抽样费用与工序检测成本的分账残差 | `outputs.json:verification.v03_residual` |
| V-04 | 六种情况分项恒等式 `Σ分项 = U` 的最大残差 | `outputs.json:verification.v04_max_residual` |
| V-05 | 闭式 vs 逐轮复算的最大残差（96 个策略组合） | `outputs.json:verification.v05_max_residual` |
| V-06 | 回收轮成本中的采购项（应为 0）与残差 | `outputs.json:verification.v06_recycle_purchase_residual` |
| V-07 | 问题3 节点分项恒等式的最大残差 | `outputs.json:verification.v07_max_residual` |
| V-08 | 退化为两零配件一成品时与问题2 闭式的残差 | `outputs.json:verification.v08_degenerate_residual` |
| V-09 | 拓扑扰动下决策一致率的最小值 | `outputs.json:verification.v09_topology_min_agreement` |
| V-10 | 区间覆盖点估计标志 + 样本量翻倍后的宽度变化 | `outputs.json:verification.v10_cover_ok`、`outputs.json:verification.v10_width_shrink` |
| V-11 | 一致率收敛曲线尾批与总体之差 | `outputs.json:verification.v11_conv_gap` |
| V-12 | 决策差异表行数 | `outputs.json:verification.v12_diff_rows` |
| V-13 | 量纲扫描（金额列元/件、比率列无量纲） | `outputs.json:verification.v13_unit_scan_pass` |
| V-14 | 问题1 检测费用的重复计入量 | `outputs.json:verification.v14_duplicate_inspection_cost` |

**诚实边界**：以上全部是同一份代码内部的复算与结构扫描，**不是独立验证**；它们能抓住符号错、方向错、
重复计价与数值实现错，抓不住建模口径本身的错。断言式结论留给后续阶段。

## 4. 数组型数据（供阶段 5 取数）

- 问题 1：`problem1.oc_curve`（p / L_case95 / L_case90）、`problem1.sample_size_vs_confidence`（含登记对照置信水平）、
  `problem1.sprt_boundary`（m / accept_line / reject_line）、`problem1.two_cases_sample_size`。
- 问题 2：`problem2.strategy_matrix`（6 情况 × 16 组合的 unit_cost 与 profit 矩阵）、`problem2.six_cases`、
  `problem2.cost_breakdown.values`（6 × 5 分项）、`problem2.cases[*].all_strategies`。
- 问题 3：`problem3.node_cost`（12 节点逐节点量）、`problem3.strategy_compare`（半成品决策组合 × U_f）、
  `problem3.topology_robust.variants`。
- 问题 4：`problem4.ci_nodes`（12 节点区间）、`problem4.ci_effect_curve`、`problem4.consistency.convergence`、
  `problem4.consistency_q3.convergence`、`problem4.decision_diff`。
- 灵敏度：`sensitivity.defect_rate`、`sensitivity.unit_cost`（各 9 个扰动点 × 多因子曲线）、
  `sensitivity.breakeven.decision_code_grid`（41 × 41 决策码网格）与 `flip_points`。

## 5. 防泄漏说明（分类口径）

`problem4.consistency.rate` 与 `problem4.consistency_q3.rate` 是**决策一致率**，不是机器学习分类指标，
但仍按 ≥0.99 的申报口径给出防泄漏说明：基准决策来自**点估计重解**（`problem4.point_decision_q2` /
`point_decision_q3`），重抽样样本由登记种子的独立随机流生成，两者不共用同一批数据；
一致率的分子只统计“重抽样后重解得到的决策是否等于基准”，基准本身不参与重抽样，
不存在“同一数据既定基准又评估”的泄漏。收敛曲线 `convergence` 只用于展示随重复次数的稳定性。

## 6. 已知局限

- 问题 3 的装配树连接关系来自 ASM-09 的显式假设（图 1 原件未随简报下传），其影响由
  `problem3.topology_robust` 的逐变体利润与一致率量化，`min_agreement` 是这一风险的直接读数。
- 问题 3 的蒙特卡洛重抽样次数单独登记为 `Q4_RESAMPLE_Q3`（问题 3 每次重解的开销远大于问题 2），
  与 `Q4_RESAMPLE` 不同源；两者都在 `problem4.sampling_spec` 中写明。
- 所有指标为单件成品口径，不含库存、产能、固定成本与资金时间价值（ASM-04）。
- 未做检测不完美（ASM-01）与批次相关性（ASM-03）的灵敏度。

## 7. 上一轮审计问题的逐条落点

1. **[fatal] Kf 重复计零配件 2 检测费** —— 已改。`problem2.evaluate` 统一为对称形式
   `buy_i = z_i*(a_i+c_i)/(1-p_i) + (1-z_i)*a_i`，检测费只出现一次；分项分解同步改写并在
   `problem2.cases[*].breakdown_residual` 与 `outputs.json:verification.v04_max_residual` 给出残差读数；
   `problem4` 与 `problem2` 现在共用同一个 `evaluate`，不存在两处不同 Kf。
2. **[major] main.py 不跑 sensitivity / 不写 meta** —— 已改。`main.py` 显式 `import sensitivity` 并调用
   `sensitivity.run(...)`，同时写 `outputs.json:meta`（profit_definition / unit_note / model_constants /
   problem_facts_in_use）；`DELIVERABLES.json` 中所有 `sensitivity.*` 与 `meta.*` 路径均真实存在。
3. **[minor] DELIVERABLES.json 的 figure_data 越界** —— 已改。清单中不再有 `figure_data`，
   改为不带图名的 `data_arrays`（路径 + 行数 + 说明），图名与图表声明留给阶段 5。
4. **[minor] 校核字段两套命名** —— 已改。统一为顶层点分路径 `outputs.json:verification.v01_max_violation` 等，
   RESULTS.md 的校核表与 `DELIVERABLES.json` 的 `result_keys` 逐字一致；模块内部只保留 `checks` 子段。
5. **[minor] problem2.py 内联表 1** —— 已改。删除内联兜底数组，改为 `from params import TABLE1`；
   拓扑常量（`TOPO_BASE` / `TOPO_VARIANTS`）移入 `params.py` 并注明来自 ASM-09 显式假设；
   RESULTS.md 不再宣称“代码里不出现题面数字”，改为“题面数字在 params.py 有唯一落点”。
6. **[minor] 账本写到 os.getcwd()** —— 已改。`main.py` 用 `HERE = os.path.dirname(os.path.abspath(__file__))`
   拼账本路径，`python code/main.py` 从仓库根或从 `code/` 启动都落到同一处 `code/outputs.json`。
