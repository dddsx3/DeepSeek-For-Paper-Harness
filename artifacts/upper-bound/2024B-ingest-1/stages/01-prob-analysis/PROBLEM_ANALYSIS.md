# 2024 高教社杯全国大学生数学建模竞赛 B 题：生产过程中的决策问题
## 阶段 01 · 赛题分析（PROBLEM_ANALYSIS）

本文件把题面读成机器可核验的事实集合：第 1 节逐句表给每句话的类型与认领能力项；第 2 节逐条抄录题面硬约束原文；第 3 节固定决策与指标口径；第 4、5 节给出 ASSUMPTION / REQUIREMENT 行首锚点（门禁 B3 / B4 的锚）；第 6、8 节给出图清单与渲染声明，供阶段 5 渲染与对账。本阶段不产生任何自算数字，全部数值见 PROBLEM_FACTS.json。

### 1. 逐句表（类型：决策 / 目标 / 机制 / 数据 / 约束 / 输出）

| 编号 | 原句 | 类型 | 认领能力项 |
| --- | --- | --- | --- |
| S01 | 某企业生产某种畅销的电子产品，需要分别购买两种零配件（零配件 1 和零配件 2），在企业将两个零配件装配成成品。 | 机制 | C-MODEL-SYSTEM |
| S02 | 在装配的成品中， 只要其中一个零配件不合格，则成品一定不合格；如果两个零配件均合格， 装配出的成品也不一定合格。 | 机制 | C-MODEL-ASSEMBLY |
| S03 | 对于不合格成品， 企业可以选择报废，或者对其进行拆解，拆解过程不会对零配件造成损坏，但需要花费拆解费用。 | 机制 | C-MODEL-SCRAP |
| S04 | 问题 1 供应商声称一批零配件（零配件 1 或零配件 2）的次品率不会超过某个标称值。 | 约束 | C-Q1-PLAN |
| S05 | 企业准备采用抽样检测方法决定是否接收从供应商购买的这批零配件， 检测费用由企业自行承担。 | 机制 | C-MODEL-COST-BEAR |
| S06 | 请为企业设计检测次数尽可能少的抽样检测方案。 | 目标 | C-Q1-PLAN |
| S07 | 如果标称值为 10%，根据你们的抽样检测方案， 针对以下两种情形， 分别给出具体结果： | 数据 | C-Q1-PLAN |
| S08 | (1) 在 95%的信度下认定零配件次品率超过标称值，则拒收这批零配件； | 目标 | C-Q1-CASE95 |
| S09 | (2) 在 90%的信度下认定零配件次品率不超过标称值，则接收这批零配件。 | 目标 | C-Q1-CASE90 |
| S10 | 问题 2 已知两种零配件和成品次品率，请为企业生产过程的各个阶段作出决策： | 决策 | C-Q2-MODEL |
| S11 | (1) 对零配件（零配件 1 和/或零配件 2）是否进行检测，如果对某种零配件不检测，这种零配件将直接进入到装配环节；否则将检测出的不合格零配件丢弃； | 决策 | C-Q2-PART-DECISION |
| S12 | (2) 对装配好的每一件成品是否进行检测， 如果不检测， 装配后的成品直接进入到市场；否则只有检测合格的成品进入到市场； | 决策 | C-Q2-PRODUCT-DECISION |
| S13 | (3) 对检测出的不合格成品是否进行拆解，如果不拆解，直接将不合格成品丢弃；否则对拆解后的零配件，重复步骤(1)和步骤(2)； | 决策 | C-Q2-DISASSEMBLE-DECISION |
| S14 | (4) 对用户购买的不合格品，企业将无条件予以调换，并产生一定的调换损失（如物流成本、企业信誉等）。对退回的不合格品，重复步骤(3)。 | 约束 | C-Q2-EXCHANGE |
| S15 | 请根据你们所做的决策， 对表 1 中的情形给出具体的决策方案，并给出决策的依据及相应的指标结果。 | 输出 | C-Q2-TABLE1-CASES |
| S16 | 问题 3 对 𝑚 道工序、𝑛 个零配件，已知零配件、半成品和成品的次品率，重复问题 2， 给出生产过程的决策方案。 | 决策 | C-Q3-GENERAL |
| S17 | 图 1 给出了 2 道工序、8 个零配件的情况，具体数值由表 2 给出。 | 数据 | C-Q3-INSTANCE-DATA |
| S18 | 针对以上这种情形，给出具体的决策方案，以及决策的依据及相应指标。 | 输出 | C-Q3-INSTANCE-RESULT |
| S19 | 问题 4 假设问题 2 和问题 3 中零配件、 半成品和成品的次品率均是通过抽样检测方法（例如，你在问题 1 中使用的方法）得到的，请重新完成问题 2 和问题 3。 | 目标 | C-Q4-REDO |
| S20 | (1) 半成品、成品的次品率是将正品零配件（或者半成品）装配后的产品次品率； | 机制 | C-MODEL-DEFECT-DEF |
| S21 | (2) 不合格成品中的调换损失是指除调换次品之外的损失 （如： 物流成本、企业信誉等） 。 | 机制 | C-MODEL-EXCHANGE-LOSS |
| S22 | (3) 购买单价、 检测成本、 装配成本、 市场售价、 调换损失和拆解费用的单位均为元/件。 | 数据 | C-UNIT-DEF |

注：标为决策 / 目标 / 机制的句子（S01、S02、S03、S05、S06、S08、S09、S10、S11、S12、S13、S16、S19、S20、S21）全部被 CAPABILITY_CHECKLIST.json 中某条能力项的 source_sentence 认领；S04、S07、S14、S15、S17、S18、S22 为约束 / 数据 / 输出句，由对应能力项的 required_output 覆盖。

### 2. 硬约束清单 HARD_CONSTRAINTS（逐条抄录题面原文）

- HC-01：“请为企业设计检测次数尽可能少的抽样检测方案。”（检测次数尽可能少）
- HC-02：“(1) 在 95%的信度下认定零配件次品率超过标称值，则拒收这批零配件；”（95% 信度拒收）
- HC-03：“(2) 在 90%的信度下认定零配件次品率不超过标称值，则接收这批零配件。”（90% 信度接收）
- HC-04：“只要其中一个零配件不合格”（不合格必然传导为成品不合格）
- HC-05：“如果两个零配件均合格， 装配出的成品也不一定合格。”（合格件装配仍按成品次品率出次品）
- HC-06：“拆解过程不会对零配件造成损坏，但需要花费拆解费用。”（拆解无损但有费）
- HC-07：“如果对某种零配件不检测，这种零配件将直接进入到装配环节；否则将检测出的不合格零配件丢弃；”
- HC-08：“否则只有检测合格的成品进入到市场；”（检测时必须只让合格品上市）
- HC-09：“对用户购买的不合格品，企业将无条件予以调换”（无条件调换）
- HC-10：“半成品、成品的次品率是将正品零配件（或者半成品）装配后的产品次品率；”（次品率定义）
- HC-11：“购买单价、 检测成本、 装配成本、 市场售价、 调换损失和拆解费用的单位均为元/件。”（量纲统一）
- HC-12：“请根据你们所做的决策， 对表 1 中的情形给出具体的决策方案，并给出决策的依据及相应的指标结果。”（必须给决策 + 依据 + 指标）

### 3. 决策空间与指标口径（跨阶段对账）

- 问题 2 决策向量 (Z1, Z2, C, D) ∈ {0,1}^4，共 16 种组合；Z1、Z2 表示是否检测零配件 1 / 零配件 2，C 表示是否检测成品，D 表示不合格成品是否拆解。
- 问题 3 决策向量按节点展开：每个零配件节点、半成品节点、成品节点各含“是否检测”“是否拆解”两个二值决策；当 m = 2、n = 8 时退化为图 1 的组装结构。
- 统一指标：单位成品期望利润 EΠ = 市场售价 × 合格交付率 − 采购成本 − 检测成本 − 装配成本 − 拆解成本 − 调换损失；问题 2 / 3 / 4 全程使用同一口径，便于横向对比。
- 不确定性口径：问题 4 中次品率取抽样估计值，需给出置信区间，并对决策翻转做灵敏度与稳健性校核。

### 4. 假设锚点（门禁 B3）

[[ASSUMPTION: A-001]] 检测是无损且 100% 准确的（不存在漏检与误检），题面未给出检测错误率。
[[ASSUMPTION: A-002]] 拆解不改变零配件性质，拆解所得零配件次品率与其原始次品率相同，可重新进入装配。
[[ASSUMPTION: A-003]] 各零配件、各工序的次品相互独立；半成品 / 成品次品率是“正品件装配后仍不合格”的条件概率。
[[ASSUMPTION: A-004]] 所有数量按“每件成品”单位化，不考虑库存、产能上限、固定成本与资金时间价值。
[[ASSUMPTION: A-005]] 问题 1 的“信度”解释为频率学派置信水平，对应单侧检验显著性水平 0.05（情形 1）与 0.10（情形 2）。
[[ASSUMPTION: A-006]] 问题 1 的抽样为简单随机抽样且批量足够大，可用二项分布近似超几何分布。
[[ASSUMPTION: A-007]] 问题 4 中次品率的不确定度用二项分布置信区间刻画，决策以期望利润最大化为准则并做稳健性校核。
[[ASSUMPTION: A-008]] 调换损失按退回件数计入，不含补发合格品的生产成本（补发成本另按装配成本计入）。

### 5. 需求锚点（门禁 B4 逐问覆盖）

[[REQUIREMENT: R-Q1]] 设计检测次数尽可能少的抽样检测方案，并在标称值 10% 下分别给出情形 (1) 95% 信度拒收 与 情形 (2) 90% 信度接收 的样本量与判定结果。
[[REQUIREMENT: R-Q2]] 对表 1 的 6 种情况给出 (Z1, Z2, C, D) 决策组合、决策依据及指标结果。
[[REQUIREMENT: R-Q3]] 建立 m 道工序、n 个零配件的一般决策模型，并对图 1、表 2 的 2 工序 8 零配件实例给出决策方案与指标。
[[REQUIREMENT: R-Q4]] 在次品率由抽样检测得到的前提下重做问题 2 与问题 3，并体现估计不确定性的影响。
[[REQUIREMENT: R-OUT]] 每一问都要给出“决策方案 + 决策依据 + 指标结果”三件套，并保证全文指标口径一致。

### 6. FIGURE_MANIFEST

<!-- BEGIN FIGURE_MANIFEST -->
DATA=14
fig_q1_oc_curve_p1
fig_q1_sample_size_vs_confidence
fig_q1_sprt_boundary
fig_q1_two_cases_sample_size
fig_q2_strategy_cost_heatmap
fig_q2_optimal_cost_breakdown
fig_q2_six_cases_decisions
fig_q2_sensitivity_defect_rate
fig_q2_sensitivity_unit_cost
fig_q2_breakeven_contour
fig_q3_assembly_network_cost
fig_q3_strategy_cost_compare
fig_q4_ci_effect_on_cost
fig_q4_monte_carlo_robustness
DRAWIO=1
fig_decision_pipeline
TIKZ=1
tikz_process_route
GPTIMG=0
ALL=16
<!-- END FIGURE_MANIFEST -->

### 7. 图表类型说明（每张图在正文中至少一处说明其图表类型）

- fig_q1_oc_curve_p1：折线图（OC 曲线，横轴为真实次品率 p，纵轴为接收概率 L(p)），用于问题 1 抽样方案的接收特性。
- fig_q1_sample_size_vs_confidence：折线图（样本量—判别信度关系），比较不同信度下的最小检测次数。
- fig_q1_sprt_boundary：二维边界图（序贯抽样的接受 / 拒收 / 继续抽样边界），用于问题 1 的序贯方案对照。
- fig_q1_two_cases_sample_size：分组柱状图（95% 拒收情形与 90% 接收情形的样本量横向对比）。
- fig_q2_strategy_cost_heatmap：热力图（16 种 (Z1, Z2, C, D) 组合的期望成本横向对比）。
- fig_q2_optimal_cost_breakdown：堆叠条形图（最优策略下采购 / 检测 / 装配 / 拆解 / 调换损失的成本分解）。
- fig_q2_six_cases_decisions：分组柱状图（表 1 六种情况的最优决策组合与期望利润对照）。
- fig_q2_sensitivity_defect_rate：灵敏度折线图（零配件与成品次品率扰动下的期望利润变化）。
- fig_q2_sensitivity_unit_cost：灵敏度折线图（购买单价、检测成本、调换损失扰动下的期望利润变化）。
- fig_q2_breakeven_contour：等值线图（检测 / 拆解决策翻转的盈亏平衡边界）。
- fig_q3_assembly_network_cost：网络结构图（2 工序 8 零配件到半成品再到成品的成本流叠加在组装拓扑上）。
- fig_q3_strategy_cost_compare：分组条形图（半成品检测 / 拆解与成品检测策略组合的期望成本横向对比）。
- fig_q4_ci_effect_on_cost：带置信带的折线图（次品率置信区间对期望利润区间的影响）。
- fig_q4_monte_carlo_robustness：柱状图与收敛曲线（蒙特卡洛重复抽样下决策一致率与利润分布，用于稳健性校核）。
- fig_decision_pipeline：流程图（问题 2 的决策与物料闭环，DrawIO 风格）。
- tikz_process_route：工序流程图（TikZ 风格，零配件—半成品—成品的工序路线）。

### 8. ARCH_DECLARATION

<!-- BEGIN ARCH_DECLARATION -->
```json
{
  "fig_q1_oc_curve_p1": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["样本量方案层", "接收概率层"], "nodes": ["OC 曲线 L(p)", "标称值参考线"], "edges": [["样本量方案层", "OC 曲线 L(p)"], ["标称值参考线", "OC 曲线 L(p)"]]},
  "fig_q1_sample_size_vs_confidence": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["样本量层", "判别信度层"], "nodes": ["n-c 曲线", "置信水平参考线"], "edges": [["样本量层", "n-c 曲线"], ["判别信度层", "n-c 曲线"]]},
  "fig_q1_sprt_boundary": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["累积次品数层", "抽样件数层"], "nodes": ["接收边界", "拒收边界", "继续抽样带"], "edges": [["接收边界", "继续抽样带"], ["拒收边界", "继续抽样带"]]},
  "fig_q1_two_cases_sample_size": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["情形层", "样本量层"], "nodes": ["95% 拒收情形", "90% 接收情形"], "edges": [["情形层", "样本量层"]]},
  "fig_q2_strategy_cost_heatmap": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["策略组合层", "期望成本层"], "nodes": ["16 种决策组合", "期望成本色阶"], "edges": [["16 种决策组合", "期望成本色阶"]]},
  "fig_q2_optimal_cost_breakdown": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["成本项层", "金额层"], "nodes": ["采购", "检测", "装配", "拆解", "调换损失"], "edges": [["采购", "金额层"], ["检测", "金额层"], ["装配", "金额层"], ["拆解", "金额层"], ["调换损失", "金额层"]]},
  "fig_q2_six_cases_decisions": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["情况层", "决策层"], "nodes": ["表 1 情况 1-6", "最优决策组合"], "edges": [["表 1 情况 1-6", "最优决策组合"]]},
  "fig_q2_sensitivity_defect_rate": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["扰动因子层", "期望利润层"], "nodes": ["零配件次品率", "成品次品率"], "edges": [["零配件次品率", "期望利润层"], ["成品次品率", "期望利润层"]]},
  "fig_q2_sensitivity_unit_cost": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["扰动因子层", "期望利润层"], "nodes": ["购买单价", "检测成本", "调换损失"], "edges": [["购买单价", "期望利润层"], ["检测成本", "期望利润层"], ["调换损失", "期望利润层"]]},
  "fig_q2_breakeven_contour": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["参数平面层", "决策翻转边界层"], "nodes": ["检测决策翻转线", "拆解决策翻转线"], "edges": [["参数平面层", "检测决策翻转线"], ["参数平面层", "拆解决策翻转线"]]},
  "fig_q3_assembly_network_cost": {"style_family": "matplotlib_data_chart", "direction": "left_to_right", "layers": ["零配件层", "半成品层", "成品层"], "nodes": ["零配件 1-8", "半成品 1-3", "成品"], "edges": [["零配件 1-8", "半成品 1-3"], ["半成品 1-3", "成品"]]},
  "fig_q3_strategy_cost_compare": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["节点决策层", "期望成本层"], "nodes": ["半成品检测组合", "成品检测组合"], "edges": [["半成品检测组合", "期望成本层"], ["成品检测组合", "期望成本层"]]},
  "fig_q4_ci_effect_on_cost": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["估计区间层", "期望利润层"], "nodes": ["次品率置信区间", "利润区间带"], "edges": [["次品率置信区间", "利润区间带"]]},
  "fig_q4_monte_carlo_robustness": {"style_family": "matplotlib_data_chart", "direction": "na", "layers": ["模拟层", "稳健性层"], "nodes": ["重复抽样", "决策一致率"], "edges": [["重复抽样", "决策一致率"]]},
  "fig_decision_pipeline": {"style_family": "drawio_flow", "direction": "left_to_right", "layers": ["零配件层", "装配层", "检验与再处理层", "市场层"], "nodes": ["零配件检测", "装配", "成品检测", "合格品上市", "不合格品拆解", "报废", "退回调换"], "edges": [["零配件检测", "装配"], ["装配", "成品检测"], ["成品检测", "合格品上市"], ["成品检测", "不合格品拆解"], ["不合格品拆解", "装配"], ["不合格品拆解", "报废"], ["合格品上市", "退回调换"], ["退回调换", "不合格品拆解"]]},
  "tikz_process_route": {"style_family": "tikz_flow", "direction": "top_to_bottom", "layers": ["工序层", "检验层"], "nodes": ["工序 1", "工序 2", "成品检验"], "edges": [["工序 1", "工序 2"], ["工序 2", "成品检验"]]}
}
```
<!-- END ARCH_DECLARATION -->

### 9. 与下游阶段的接口

- 零数字通道：本阶段不产生任何自算数值；论文中出现的所有题面给定值以 PROBLEM_FACTS.json 的 raw_quote 为准。
- 逐问覆盖：阶段 2–6 的产出按 CAPABILITY_CHECKLIST.json 中 20 条能力项逐条对账，每条给出可执行的 machine_check。
- 图对账：阶段 5 渲染器仅绘制 FIGURE_MANIFEST 中列出、且已在 ARCH_DECLARATION 中声明的图；图名必须保持 fig_ / tikz_ 前缀。
- 数据画像：附件中无独立数据文件，参数全部来自题面表 1、表 2 与图 1，见 DATA_PROFILE.json。
