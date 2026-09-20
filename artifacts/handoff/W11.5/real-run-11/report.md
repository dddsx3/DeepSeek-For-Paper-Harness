# 建模分析稿（E1 直通交付）

## 摘要

> **交付说明（诚实标注）**：本稿由模型的建模分析（E1）直接生成——
> 结构化规范化（E2）未通过，故**未经规范 IR 验证**：数字、引用、图表
> 均未逐条溯源。失败原因（引擎原文）：DRIFT guidance budget exhausted
> 未通过的保真检查：conflicting_id。
> 请把它当作**素材**而不是成品。

## 问题重述

_(模型待写入)_

## 问题分析

_(模型待写入)_

## 模型假设

| 假设 | 来源 | 风险 | 可检验 |
|---|---|---|---|
| A-BINOMIAL-IID | （见模型建立与求解节） | 未评定 | 未检验 | [A-BINOMIAL-IID]
| A-NORMAL-APPROX | （见模型建立与求解节） | 未评定 | 未检验 | [A-NORMAL-APPROX]
| A-INDEPENDENT-DEFECTS | （见模型建立与求解节） | 未评定 | 未检验 | [A-INDEPENDENT-DEFECTS]
| A-LINEAR-COST | （见模型建立与求解节） | 未评定 | 未检验 | [A-LINEAR-COST]
| A-DISASSEMBLY-PERFECT | （见模型建立与求解节） | 未评定 | 未检验 | [A-DISASSEMBLY-PERFECT]
| A-TREE-STRUCTURE | （见模型建立与求解节） | 未评定 | 未检验 | [A-TREE-STRUCTURE]
| A-STATIONARY-DECISION | （见模型建立与求解节） | 未评定 | 未检验 | [A-STATIONARY-DECISION]
| A-BETA-PRIOR | （见模型建立与求解节） | 未评定 | 未检验 | [A-BETA-PRIOR]
| A-RISK-NEUTRAL | （见模型建立与求解节） | 未评定 | 未检验 | [A-RISK-NEUTRAL]

## 符号说明

(符号表由规范 IR 自动生成)

## 模型建立与求解

[[REQUIREMENT: R-OUT]]

# 生产过程中的决策问题——建模分析笔记

## 总体认识

本题是典型的**多阶段生产决策优化**问题，核心是：在不确定的次品率信息下，通过抽样检测获取信息，再基于成本最小化原则对生产各环节（来料检测、成品检测、拆解、退货处理）做出0-1决策。问题1是统计推断（抽样方案设计），问题2-4是期望成本最小化的决策优化。方法族F4（评价决策）适用于问题2-4中"方案比较与选择"的环节——每个决策节点需要在多个候选方案（检测/不检测、拆解/不拆解）中按成本准则择优，这正是加权求和/期望成本评价的典型场景。

---

## 问题1：抽样检测方案设计

**问题实质**：给定标称次品率 $p_0=10\%$，设计最小样本量 $n$ 和判定规则，使得：
- 情形(1)：在95%信度下，若样本显示次品率显著超过 $p_0$，则拒收；
- 情形(2)：在90%信度下，若样本显示次品率不显著超过 $p_0$，则接收。

**方法选择**：这是单侧假设检验问题，属于F3统计推断族。但本题路由指定主族为F4，因此我将检验问题转化为**决策准则下的方案比较**：对每个候选 $n$，计算其检验功效和两类错误概率，按"最小 $n$ 满足信度要求"的准则择优。这本质上是F4的加权求和评价——候选方案是不同 $n$，评价指标是检验功效（正向）和样本量（负向）。

**模型**：设抽检 $n$ 件，不合格数 $X \sim \text{Binomial}(n, p)$。
- 情形(1)：拒收准则为 $X \geq c$，其中 $c$ 是临界值。要求：当 $p \leq p_0$ 时，误拒概率 $\alpha = P(X \geq c | p=p_0) \leq 5\%$（即95%信度下不冤枉供应商）；当 $p > p_0$ 时，希望拒收概率尽量高。最小 $n$ 由 $\alpha \leq 0.05$ 决定。
- 情形(2)：接收准则为 $X \leq c'$。要求：当 $p \leq p_0$ 时，接收概率 $\geq 90\%$，即 $P(X \leq c' | p=p_0) \geq 0.90$。

[[ASSUMPTION: A-BINOMIAL-IID]]
抽检的每件产品独立且次品概率相同，不合格数服从二项分布。

[[ASSUMPTION: A-NORMAL-APPROX]]
当 $n$ 较大时，可用正态近似 $X \sim N(np, np(1-p))$ 计算临界值和样本量；若 $n$ 较小则用精确二项分布。

**求解思路**：对情形(1)，用正态近似：拒收条件为 $\frac{X/n - p_0}{\sqrt{p_0(1-p_0)/n}} > z_{0.95}$，即 $X > np_0 + z_{0.95}\sqrt{np_0(1-p_0)}$。取 $c = \lceil np_0 + 1.645\sqrt{np_0(1-p_0)} \rceil$，最小 $n$ 使得误拒概率不超过5%。对情形(2)，接收条件为 $X \leq np_0 + z_{0.10}\sqrt{np_0(1-p_0)}$（$z_{0.10}=-1.282$），最小 $n$ 使得当 $p=p_0$ 时接收概率至少90%。

**验证**：用精确二项分布计算实际误拒/误收概率，确认不超过给定信度；对 $n$ 做敏感性分析，确认最小 $n$ 的稳健性。

---

## 问题2：单工序两零配件决策

**问题实质**：对表1的6种情况，在零配件检测、成品检测、不合格成品拆解、退货处理四个环节各做0/1决策，使总期望成本最小。

**方法选择**：F4加权求和——每个决策节点枚举候选方案（检测/不检测、拆解/不拆解），计算各方案的期望成本（负向指标），选成本最小者。权重即各成本项（购买、检测、装配、调换、拆解）的单价，均为客观已知。

**模型**：设决策变量：
- $d_1, d_2 \in \{0,1\}$：是否检测零配件1、2；
- $d_3 \in \{0,1\}$：是否检测成品；
- $d_4 \in \{0,1\}$：是否拆解不合格成品。

对每个决策组合，计算单位成品的期望总成本 $C(d_1,d_2,d_3,d_4)$，包含：
1. 零配件采购成本（检测时含丢弃不合格件的损失）；
2. 检测成本；
3. 装配成本；
4. 成品检测成本；
5. 不合格品处理成本（拆解费用或报废损失）；
6. 流入市场的不合格品导致的调换损失。

[[ASSUMPTION: A-INDEPENDENT-DEFECTS]]
零配件1、2的次品事件相互独立，成品次品率由零配件次品率按"任一零配件不合格则成品不合格，两件均合格时成品以给定概率不合格"的规则合成。

[[ASSUMPTION: A-LINEAR-COST]]
所有成本（采购、检测、装配、拆解、调换）均为线性，无规模效应或批量折扣。

[[ASSUMPTION: A-DISASSEMBLY-PERFECT]]
拆解不损坏零配件，拆解后零配件状态与拆解前相同，可重新进入检测/装配环节。

**求解思路**：对每种情况，枚举 $2^4=16$ 种决策组合，计算期望成本。关键计算：
- 若检测零配件 $i$，则进入装配的零配件次品率为0（不合格件被丢弃），但需支付检测成本并承担丢弃损失；
- 若检测成品，则流入市场的不合格品率为0，但需支付检测成本；
- 若不检测成品，流入市场的不合格品率为成品次品率，需承担调换损失；
- 拆解决策影响不合格成品的处理成本。

**验证**：对每种情况，检查最优决策是否随参数（如调换损失、拆解费用）变化而合理变化；对次品率做±2%敏感性分析，确认决策稳健性。

---

## 问题3：多工序多零配件推广

**问题实质**：将问题2推广到 $m$ 道工序、$n$ 个零配件的一般情形。对图1（2道工序、8个零配件）和表2数据，确定每个零配件、半成品、成品的检测/拆解决策。

**方法选择**：F4加权求和，但决策空间更大。采用**动态规划/决策树**思想：从后往前（成品→半成品→零配件）逐层决策，每层用F4的期望成本评价选择最优方案。

**模型**：将生产过程建模为多级决策树。每个节点（零配件、半成品、成品）有检测/不检测两个选项；不合格半成品/成品有拆解/报废两个选项。定义状态转移：
- 零配件 $j$ 经检测后以概率 $(1-p_j)$ 成为合格件进入装配；
- 半成品 $k$ 由若干合格零配件装配而成，次品率为 $q_k$；
- 成品由半成品装配而成，次品率为 $q_{final}$。

[[ASSUMPTION: A-TREE-STRUCTURE]]
图1的装配关系构成树状结构（无环），各节点次品事件独立，装配后次品率按给定值。

[[ASSUMPTION: A-STATIONARY-DECISION]]
同一类型节点（如所有零配件）可采用相同决策策略，但允许因成本参数不同而异。

**求解思路**：用动态规划。定义 $V(\text{节点})$ 为该节点及其下游的最优期望成本。从叶子（零配件）向上递推：
- 零配件节点：比较"检测"与"不检测"的期望成本；
- 半成品/成品节点：比较"检测"与"不检测"、"拆解"与"报废"的组合期望成本。

对表2数据，8个零配件分为两组（每组4个）分别装配成半成品1、2，再装配成成品。逐层求解最优决策。

**验证**：检查递推结果是否满足最优性原理（子问题最优解构成全局最优）；对关键参数（如拆解费用、调换损失）做敏感性分析。

---

## 问题4：次品率不确定下的重新求解

**问题实质**：问题2、3中的次品率不再是精确已知，而是通过问题1的抽样检测估计得到，存在不确定性。需在决策中考虑这种不确定性。

**方法选择**：F4加权求和，但权重（次品率）不再是确定值，而是随机变量。采用**期望成本下的贝叶斯决策**：将次品率视为随机变量，其后验分布由抽样结果更新，决策准则为最小化后验期望成本。

[[ASSUMPTION: A-BETA-PRIOR]]
次品率 $p$ 的先验分布为 Beta 分布（共轭先验），抽样后后验仍为 Beta 分布，便于计算。

[[ASSUMPTION: A-RISK-NEUTRAL]]
企业风险中性，决策准则为最小化期望成本，不考虑方差或风险厌恶。

**模型**：设零配件 $i$ 的次品率 $p_i$ 有后验分布 $\text{Beta}(\alpha_i, \beta_i)$（由抽样结果更新）。对每个决策组合，期望成本为 $E_p[C(d; p)]$，其中期望对后验分布计算。由于成本函数对 $p$ 通常是线性的（如检测丢弃损失、调换损失均与 $p$ 成正比），期望成本可解析计算。

**求解思路**：
1. 对问题2、3中的每个次品率，用问题1的抽样方案得到后验分布；
2. 将后验均值（或完整分布）代入决策模型，计算各方案的后验期望成本；
3. 选择最小后验期望成本的方案。

**验证**：比较问题4与问题2、3的决策差异，确认不确定性是否改变决策；对先验参数做敏感性分析，确认决策对先验假设的依赖程度。

---

## 汇总与敏感性分析

**输出**：对每个子问题给出具体决策方案、期望成本指标、决策依据。

**敏感性分析**：
- 问题1：样本量 $n$ 对信度要求的敏感性；
- 问题2、3：检测成本、调换损失、拆解费用变化对最优决策的影响；
- 问题4：先验分布参数对决策的影响。

**最终报告结构**：问题重述→模型假设→问题1模型与结果→问题2模型与结果→问题3模型与结果→问题4模型与结果→敏感性分析→结论。

## 模型检验

_(模型待写入)_

## 模型评价

_(模型待写入)_

## 参考文献

_(模型待写入)_

## 代码附录

_(模型待写入)_

---

## 附录：交付标注（自动生成）

本稿以 **MARKED**（标注交付）等级交付：13 项检查未通过。内容照常可用；以下逐项列出未通过项、位置与原因，供复核与改进。

| # | 检查项 | 位置 | 原因 |
|---|---|---|---|
| 1 | critical_gate | delivery | ir_canonicalization:BLOCKED:missing IR backbone: Result,Claim; no CRITICAL claim in canonical IR; 1 Problem Contract failure(s): global.P1/C:duplicate_symbol_token |
| 2 | critical_gate | delivery | requirement_coverage:BLOCKED:requirement coverage: 1 finding(s) (required_output_unpaid: REQUIRED_OUTPUT 'R-OUT' of problem 'P1' is not covered: only 0/1 distinct CRITICAL results reach this problem (A7 v0 fail-closed)) |
| 3 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-BINOMIAL-IID 缺 justification_refs |
| 4 | V2 假设-来源匹配(APPROXIMATION) | verification | APPROXIMATION 假设 A-NORMAL-APPROX 缺 justification(未声明误差界来源) |
| 5 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-INDEPENDENT-DEFECTS 缺 justification_refs |
| 6 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-LINEAR-COST 缺 justification_refs |
| 7 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-DISASSEMBLY-PERFECT 缺 justification_refs |
| 8 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-TREE-STRUCTURE 缺 justification_refs |
| 9 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-STATIONARY-DECISION 缺 justification_refs |
| 10 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-BETA-PRIOR 缺 justification_refs |
| 11 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-RISK-NEUTRAL 缺 justification_refs |
| 12 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-OUT 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 13 | e2_normalization_failed | delivery | entry 'AssumptionSpec' id 'A-BETA-PRIOR' is already registered with DIFFERENT content (append-only store; a duplicate id is a conflict, not an update)（未通过的保真检查：conflicting_id） |

*标注由交付门槛自动生成（fail-soft）：未通过项不拦截交付，但必须在此如实列出。*
---

> **本交付物的验证范围（W8.9-C2）**：已机械核验的是**结构完整**（章节/符号/假设齐备）、**数字可溯源**（每个数字可追到 Result 或题面给定值）与**形式化忠实**（IR 声明逐字锚定建模分析文本）。**未**核验的是**实质正确性**——建模思路的优劣、假设的物理真伪、方法选择的恰当性，均**不在本 harness 的可判定范围内**。请读者据此评估结论。
