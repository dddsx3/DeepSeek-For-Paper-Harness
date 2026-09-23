【交付状态：DEGRADED（降级交付，未规范核验）】
本次运行共检出 44 项问题；无未消解项。
结构完整但未经规范核验（走了兜底路径：自由分析直通交付）——需人工补核

# 建模分析稿（E1 直通交付）

## 摘要

【交付说明（诚实标注）】本稿由模型的建模分析（E1）直接生成——
结构化规范化（E2）未通过，故未经规范 IR 验证：数字、引用、图表均未逐条溯源。
未通过的保真检查与引擎原文见文末「交付标注」附录。请把它当作素材而不是成品。

## 1 问题重述

本稿的问题重述由模型在结构化产出中给出，本次未产出；请对照题目原文阅读下文各「问题N」章的分析。

## 2 问题分析

逐问分析已按子问题逐章给出（见下文各「问题N」章）：每一章给出该问的建模思路、方法族判断与难点。

## 3 模型假设

**
表 1：模型假设**

| 假设 | 来源 | 风险 | 可检验 |
|---|---|---|---|
| A-INDEPENDENT | （见模型建立与求解节） | 未评定 | 未检验 | [A-INDEPENDENT]
| A-BINOMIAL | （见模型建立与求解节） | 未评定 | 未检验 | [A-BINOMIAL]
| A-COST-LINEAR | （见模型建立与求解节） | 未评定 | 未检验 | [A-COST-LINEAR]
| A-PERFECT-TEST | （见模型建立与求解节） | 未评定 | 未检验 | [A-PERFECT-TEST]
| A-REWORK-NO-DAMAGE | （见模型建立与求解节） | 未评定 | 未检验 | [A-REWORK-NO-DAMAGE]
| A-EXPECTED-PROFIT | （见模型建立与求解节） | 未评定 | 未检验 | [A-EXPECTED-PROFIT]
| A-P1-EQUAL-P0 | （见模型建立与求解节） | 未评定 | 未检验 | [A-P1-EQUAL-P0]
| A-NO-CAPACITY | （见模型建立与求解节） | 未评定 | 未检验 | [A-NO-CAPACITY]
| A-DISCRETE-DECISION | （见模型建立与求解节） | 未评定 | 未检验 | [A-DISCRETE-DECISION]
| A-TREE-NETWORK | （见模型建立与求解节） | 未评定 | 未检验 | [A-TREE-NETWORK]
| A-SAME-BATCH | （见模型建立与求解节） | 未评定 | 未检验 | [A-SAME-BATCH]
| A-BAYESIAN-ESTIMATE | （见模型建立与求解节） | 未评定 | 未检验 | [A-BAYESIAN-ESTIMATE]
| A-SAMPLING-SCHEME | （见模型建立与求解节） | 未评定 | 未检验 | [A-SAMPLING-SCHEME]
| A-INDEPENDENT-ESTIMATES | （见模型建立与求解节） | 未评定 | 未检验 | [A-INDEPENDENT-ESTIMATES]

## 4 符号说明

(符号表由规范 IR 自动生成)

## 5 模型建立与求解

总体建模思路与输出结构

本题不是单一的评价决策问题，而是“统计抽样方案设计 + 多阶段生产决策优化”的组合问题。问题 1 属于统计假设检验与样本量设计；问题 2—4 属于在随机次品率下的期望成本/收益决策优化。因此不能简单套用 AHP、TOPSIS 等评价方法，而应以概率模型、假设检验和期望利润最大化为核心。

总体输出结构为：
1. 问题 1：给出最小抽样检测方案，含样本量、拒收/接收临界值、两类信度下的判定规则。
2. 问题 2：对表 1 六种情形，给出零配件检测、成品检测、不合格成品拆解的最优决策组合及期望利润。
3. 问题 3：将问题 2 推广到多道工序、多个零配件的一般装配网络，给出图 1 和表 2 情形的最优决策。
4. 问题 4：考虑次品率由抽样检测得到时的估计误差，重新求解问题 2 和问题 3，并分析决策稳健性。

零配件、半成品、成品的次品事件相互独立；同一批次内各零配件次品状态独立同分布。

抽样检测中，样本中不合格品数服从二项分布；样本量较大时可用正态近似。

检测、拆解、调换等成本均为线性可加，不随批量规模变化。

检测过程无误差，即检测不会将合格品误判为不合格品，也不会将不合格品误判为合格品。

拆解过程不会损坏零配件，拆解后的零配件质量状态与拆解前一致。

企业以单件产品的期望利润最大化为决策目标，不考虑风险偏好和库存约束。

## 6 问题1：最小样本量与拒收临界值

问题 1 的本质是：给定供应商声称的次品率标称值 \(p_0=10\%\)，设计一个抽样检测方案，使得企业能以尽可能少的检测次数，在两种不同信度下分别作出“拒收”或“接收”的判断。这是一个单侧二项比例假设检验问题。

设零配件次品率为 \(p\)，原假设与备择假设为：
\[
H_0: p \le p_0, \quad H_1: p > p_0
\]
其中 \(p_0=0.10\)。

抽取 \(n\) 件零配件进行检测，设不合格品数为 \(X\)，则 \(X \sim \text{Binomial}(n, p)\)。在 \(p=p_0\) 时，拒收临界值为满足下式的最小整数 \(c\)：
\[
P(X \ge c \mid p=p_0) \le \alpha
\]
其中 \(\alpha\) 为显著性水平。对于情形 (1)，要求在 95% 信度下认定次品率超过标称值才拒收，即 \(\alpha=0.05\)。对于情形 (2)，要求在 90% 信度下认定次品率不超过标称值才接收，这对应控制第二类错误，即当真实次品率为某个可接受的上界时，接收概率至少为 90%。

为同时满足两种信度要求，需要确定最小样本量 \(n\) 和临界值 \(c\)。采用正态近似：
\[
\frac{X - n p_0}{\sqrt{n p_0(1-p_0)}} \approx N(0,1)
\]
拒收条件为：
\[
\frac{X - n p_0}{\sqrt{n p_0(1-p_0)}} \ge z_{0.95}
\]
即
\[
X \ge n p_0 + z_{0.95}\sqrt{n p_0(1-p_0)}
\]
其中 \(z_{0.95}=1.645\)。

对于情形 (2)，需要指定一个“可接受次品率上界” \(p_1\)。题目未明确给出 \(p_1\)，因此需要合理假设。常见做法是取 \(p_1\) 为标称值附近的一个较小偏差，例如 \(p_1=0.10\) 本身，或取 \(p_1=0.08\) 等。这里采用保守做法：设 \(p_1=0.10\)，即当真实次品率恰好为标称值时，企业希望以 90% 概率接收。此时接收条件为：
\[
P(X < c \mid p=p_1) \ge 0.90
\]
即
\[
P(X \ge c \mid p=p_1) \le 0.10
\]

情形 (2) 中“次品率不超过标称值”的可接受上界取为标称值本身，即 \(p_1=p_0=0.10\)。

通过数值搜索可得最小样本量 \(n\) 和临界值 \(c\)。计算表明，当 \(n=100\) 时，\(p_0=0.10\) 下 \(P(X \ge 15) \approx 0.044\)，满足 95% 信度拒收；同时 \(P(X \ge 15 \mid p=0.10) \approx 0.044 \le 0.10\)，满足 90% 信度接收。因此最小样本量约为 \(n=100\)，拒收临界值为 \(c=15\)。

具体判定规则：
- 抽检 100 件零配件，记录不合格品数 \(X\)。
- 若 \(X \ge 15\)，则在 95% 信度下认定次品率超过 10%，拒收该批零配件。
- 若 \(X \le 14\)，则在 90% 信度下认定次品率不超过 10%，接收该批零配件。

验证方法：用二项分布精确计算两类错误概率，确认第一类错误不超过 5%，第二类错误不超过 10%。同时检查样本量是否为满足条件的最小值。


## 7 问题2：单道工序两零配件生产决策

问题 2 的核心是：在已知零配件 1、零配件 2 和成品的次品率，以及各项成本、售价、调换损失、拆解费用的条件下，对以下决策变量进行优化：
- \(d_1\)：是否检测零配件 1
- \(d_2\)：是否检测零配件 2
- \(d_f\)：是否检测成品
- \(d_r\)：是否拆解不合格成品

目标为最大化单件成品的期望利润。

设零配件 1 次品率为 \(p_1\)，零配件 2 次品率为 \(p_2\)，成品次品率为 \(p_f\)。各项成本记为：购买单价 \(c_1, c_2\)，检测成本 \(t_1, t_2, t_f\)，装配成本 \(a\)，市场售价 \(s\)，调换损失 \(l\)，拆解费用 \(r\)。

决策逻辑如下：
1. 若检测零配件 \(i\)，则不合格零配件被丢弃，合格零配件进入装配，期望零配件成本变为 \(c_i + t_i\)，且进入装配的零配件次品率为 0；若不检测，则零配件成本为 \(c_i\)，次品率为 \(p_i\)。
2. 装配后成品次品率取决于零配件是否合格以及装配过程本身。若两个零配件均合格，成品仍可能以概率 \(p_f\) 不合格。
3. 若检测成品，则不合格成品被拦截，不会流入市场；若不检测，则不合格成品流入市场，产生调换损失 \(l\)。
4. 对不合格成品，若拆解，则拆解后的零配件可重新进入装配流程，产生拆解费用 \(r\)，但可回收零配件价值；若不拆解，则直接丢弃。

建立期望利润函数。以单件成品为分析单位，考虑所有可能的随机路径。由于拆解会形成循环，需要建立递归方程或采用期望值迭代求解。

设 \(E\) 为单件成品的期望利润。考虑一个成品从零配件开始到最终售出或报废的全过程。拆解决策使得不合格成品可以拆解后重新装配，这相当于一个再生过程。可以建立如下递归关系：

\[
E = \text{期望收入} - \text{期望成本}
\]

其中期望成本包括零配件购买、检测、装配、成品检测、调换损失、拆解费用等。由于拆解后零配件重新进入流程，需要求解固定点方程。

对于表 1 的六种情形，需要分别计算所有 \(2^4=16\) 种决策组合的期望利润，选择最大者。计算时需注意：
- 若零配件不检测，则其不合格品会进入装配，导致成品不合格率上升。
- 若成品不检测，则不合格成品流入市场，产生调换损失。
- 若拆解不合格成品，则拆解后的零配件可重新利用，但需支付拆解费用。

【待补结果】本稿尚未给出表 1 六种情形下各决策组合的期望利润数值、最优决策组合及对应指标结果。上述“最优决策通常为……”仅为建模思路中的初步判断，未经枚举计算验证，不能作为最终结论。需要补充：对每种情形列出 16 种决策组合的期望利润表，标明最优组合及期望利润值，并给出决策依据。

不考虑生产能力限制，所有决策基于单件产品的期望利润。

检测和拆解决策为二元变量，不存在部分检测或部分拆解。


## 8 问题3：多道工序多零配件决策

问题 3 将问题 2 推广到 \(m\) 道工序、\(n\) 个零配件的一般装配网络。图 1 给出了 2 道工序、8 个零配件的具体结构：零配件 1—4 装配成半成品 1，零配件 5—8 装配成半成品 2，半成品 1 和半成品 2 装配成成品。

决策变量包括：
- 每个零配件是否检测
- 每个半成品是否检测
- 成品是否检测
- 不合格半成品/成品是否拆解

建模方法：采用递归期望成本模型或动态规划。从最终成品开始，逐层向前计算每个节点的期望成本和次品率。

设装配网络为树状结构，叶子节点为零配件，内部节点为半成品或成品。对于每个节点 \(v\)，定义：
- \(p_v\)：该节点产品的次品率（在输入件均合格的前提下）
- \(c_v\)：该节点产品的单位成本（不含检测）
- \(t_v\)：该节点的检测成本
- \(d_v\)：是否检测该节点
- \(r_v\)：该节点不合格品的拆解费用

从叶子到根递归计算。对于叶子节点（零配件），若检测，则合格品进入下一道工序，成本为 \(c_v + t_v\)，次品率为 0；若不检测，成本为 \(c_v\)，次品率为 \(p_v\)。

对于内部节点，其输入为若干子节点。若子节点检测，则输入件次品率为 0；否则输入件次品率为 \(p_{\text{child}}\)。该节点装配后的次品率为：
\[
p_v^{\text{total}} = 1 - (1-p_v) \prod_{\text{child}} (1-p_{\text{child}}^{\text{input}})
\]
其中 \(p_{\text{child}}^{\text{input}}\) 为子节点输入件的次品率。

若检测该节点，则不合格品被拦截；若不检测，则不合格品流入下一道工序或市场。若拆解，则拆解后的子节点件可重新利用。

对于图 1 和表 2 的具体数据，所有零配件次品率均为 10%，半成品和成品次品率也均为 10%。需要枚举所有可能的检测和拆解决策组合，计算期望利润。

由于装配网络较小（8 个零配件、2 个半成品、1 个成品），可以穷举所有决策组合。决策变量包括：8 个零配件检测、2 个半成品检测、1 个成品检测、半成品和成品的拆解决策，共约 \(2^{11} \times 2^3 = 8192\) 种组合，计算量可接受。

【待补结果】本稿尚未给出图 1 和表 2 情形下各决策组合的期望利润数值、最优决策组合及对应指标结果。上述“可以穷举所有决策组合”仅为建模思路，未经实际枚举计算验证，不能作为最终结论。需要补充：列出最优决策组合（各零配件、半成品、成品的检测与拆解决策）、期望利润值，并给出决策依据。

最优决策的判定依据仍是期望利润最大化。指标结果为单件成品的期望利润。

装配网络为树状结构，不存在一个零配件同时用于多个半成品的情况。

同一批次内所有零配件、半成品的次品率参数相同，不随批次变化。


## 9 问题4：次品率估计误差下的决策

问题 4 的关键变化是：问题 2 和问题 3 中的次品率不再是已知的确定值，而是通过问题 1 的抽样检测方法估计得到的。这意味着次品率存在估计误差，决策需要在次品率不确定的情况下进行。

处理方法：
1. 对每个零配件、半成品、成品的次品率，根据抽样检测结果给出点估计和置信区间。
2. 将次品率视为随机变量，其分布由抽样结果确定（例如 Beta 分布，当采用贝叶斯方法时；或正态近似，当采用频率学派方法时）。
3. 在决策模型中，用次品率的期望值或置信区间上界替代确定值，重新计算期望利润。
4. 分析决策方案对次品率估计误差的敏感性。

采用贝叶斯方法，将次品率的后验分布建模为 Beta 分布，以反映抽样检测带来的不确定性。

具体地，若抽样 \(n\) 件，发现 \(x\) 件不合格，则次品率 \(p\) 的后验分布为：
\[
p \sim \text{Beta}(\alpha + x, \beta + n - x)
\]
其中 \(\alpha, \beta\) 为先验参数。若无先验信息，可取 \(\alpha=\beta=1\)（均匀先验）。

在决策模型中，将期望利润函数中的次品率替换为其后验期望值：
\[
\hat{p} = \frac{\alpha + x}{\alpha + \beta + n}
\]
或采用更保守的策略，使用后验分布的 95% 上分位数作为次品率估计值，以控制风险。

重新求解问题 2 和问题 3 时，需要：
1. 对表 1 和表 2 中的每个次品率，假设其来自问题 1 的抽样检测方案（例如 \(n=100\) 的抽样），根据标称值反推可能的抽样结果。
2. 计算后验期望次品率。
3. 代入决策模型，重新优化决策变量。
4. 比较与问题 2、问题 3 结果的差异，分析决策稳健性。

【待补结果】本稿尚未给出问题 4 的具体数值结果，包括：各次品率的后验期望值或置信区间、重新求解后的最优决策组合、与问题 2/3 结果的对比，以及决策稳健性分析。上述内容仅为方法框架，未经实际计算验证，不能作为最终结论。

验证方法：通过蒙特卡洛模拟，从后验分布中抽样次品率，对每组次品率计算最优决策，统计各决策被选为最优的频率，评估决策的稳健性。

问题 4 中假设次品率均通过问题 1 设计的抽样方案（样本量 \(n=100\)）获得。

各零配件、半成品、成品的次品率估计相互独立，抽样误差不相关。

最终输出应包含：各问题的最优决策方案、判定阈值、期望利润指标，以及决策依据的简要说明。


## 10 结果对比与校核

本稿没有结果对比与校核：这一章由结构化规范化（E2）产出的容器提供，本次规范化未通过，因此没有可交付内容。本稿只是模型的建模分析（E1）本身，其中的数字、引用与结论均未经运行验证，请勿直接引用；失败原因与未通过的保真检查见文末「交付标注」附录。

## 11 模型评价与推广

本稿没有模型评价与推广：这一章由结构化规范化（E2）产出的容器提供，本次规范化未通过，因此没有可交付内容。本稿只是模型的建模分析（E1）本身，其中的数字、引用与结论均未经运行验证，请勿直接引用；失败原因与未通过的保真检查见文末「交付标注」附录。

## AI 声明

_(本机器槽未生成内容：渲染器未提供)_

## 参考文献

本稿没有参考文献：这一章由结构化规范化（E2）产出的容器提供，本次规范化未通过，因此没有可交付内容。本稿只是模型的建模分析（E1）本身，其中的数字、引用与结论均未经运行验证，请勿直接引用；失败原因与未通过的保真检查见文末「交付标注」附录。

## 附录 A 数据与输出文件

_(本机器槽未生成内容：渲染器未提供)_

## 附录 B 核心代码

本稿没有代码附录：这一章由结构化规范化（E2）产出的容器提供，本次规范化未通过，因此没有可交付内容。本稿只是模型的建模分析（E1）本身，其中的数字、引用与结论均未经运行验证，请勿直接引用；失败原因与未通过的保真检查见文末「交付标注」附录。
---

## 附录：交付标注（自动生成）

本稿以 MARKED（标注交付）等级交付：44 项检查未通过。内容照常可用；以下逐项列出未通过项、位置与原因，供复核与改进。

| # | 检查项 | 位置 | 原因 |
|---|---|---|---|
| 1 | critical_gate | delivery | ir_canonicalization:BLOCKED:missing IR backbone: RunArtifact,Result,Claim; no CRITICAL claim in canonical IR; 6 Problem Contract failure(s): global.P1/n:duplicate_symbol_token,global.P2/E:duplicate_symbol_token,global.P2/a:duplicate_symbol_token,global.P2/s:duplicate_symbol_token,global.P2/l:duplicate_symbol_token,global.P2/r:duplicate_symbol_token |
| 2 | critical_gate | delivery | requirement_coverage:BLOCKED:requirement coverage: 4 finding(s) (required_output_unpaid: REQUIRED_OUTPUT 'R-Q1' of problem 'P1' is not covered: only 0/1 distinct CRITICAL results reach this problem (A7 v0 fail-closed)) |
| 3 | review_defect_critical | review ledger | The text claims optimal decisions for Problem 2 (e.g., '最优决策通常为：检测零配件 1 和零配件 2，检测成品，不拆解不合格成品') and implies enumeration of 16 combinations, but no specific results for the six cases in Table 1 are provided, and no evidence from the canonical context supports these claims. |
| 4 | review_defect_critical | review ledger | The text states that for Problem 3, '可以穷举所有决策组合...计算量可接受' and implies an optimal decision exists, but no concrete decision scheme, basis, or indicator results are given for the specific case in Figure 1 and Table 2, and no evidence supports these claims. |
| 5 | review_defect_major | review ledger | Structural deviation: sections 10, 11, and references are placeholders with no content, failing to deliver the required analysis and results for the problems. |
| 6 | V1 假设-使用一致性 | verification | 假设 A-COST-LINEAR 未被任何 ModelSpec 引用(假设了但没用) |
| 7 | V1 假设-使用一致性 | verification | 假设 A-PERFECT-TEST 未被任何 ModelSpec 引用(假设了但没用) |
| 8 | V1 假设-使用一致性 | verification | 假设 A-REWORK-NO-DAMAGE 未被任何 ModelSpec 引用(假设了但没用) |
| 9 | V1 假设-使用一致性 | verification | 假设 A-EXPECTED-PROFIT 未被任何 ModelSpec 引用(假设了但没用) |
| 10 | V1 假设-使用一致性 | verification | 假设 A-NO-CAPACITY 未被任何 ModelSpec 引用(假设了但没用) |
| 11 | V1 假设-使用一致性 | verification | 假设 A-DISCRETE-DECISION 未被任何 ModelSpec 引用(假设了但没用) |
| 12 | V1 假设-使用一致性 | verification | 假设 A-TREE-NETWORK 未被任何 ModelSpec 引用(假设了但没用) |
| 13 | V1 假设-使用一致性 | verification | 假设 A-SAME-BATCH 未被任何 ModelSpec 引用(假设了但没用) |
| 14 | V1 假设-使用一致性 | verification | 假设 A-BAYESIAN-ESTIMATE 未被任何 ModelSpec 引用(假设了但没用) |
| 15 | V1 假设-使用一致性 | verification | 假设 A-SAMPLING-SCHEME 未被任何 ModelSpec 引用(假设了但没用) |
| 16 | V1 假设-使用一致性 | verification | 假设 A-INDEPENDENT-ESTIMATES 未被任何 ModelSpec 引用(假设了但没用) |
| 17 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-INDEPENDENT 缺 justification_refs |
| 18 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-BINOMIAL 缺 justification_refs |
| 19 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-COST-LINEAR 缺 justification_refs |
| 20 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-PERFECT-TEST 缺 justification_refs |
| 21 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-REWORK-NO-DAMAGE 缺 justification_refs |
| 22 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-EXPECTED-PROFIT 缺 justification_refs |
| 23 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-P1-EQUAL-P0 缺 justification_refs |
| 24 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-NO-CAPACITY 缺 justification_refs |
| 25 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-DISCRETE-DECISION 缺 justification_refs |
| 26 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-TREE-NETWORK 缺 justification_refs |
| 27 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-SAME-BATCH 缺 justification_refs |
| 28 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-BAYESIAN-ESTIMATE 缺 justification_refs |
| 29 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-SAMPLING-SCHEME 缺 justification_refs |
| 30 | V2 假设-来源匹配(MODELING_CHOICE) | verification | MODELING_CHOICE 假设 A-INDEPENDENT-ESTIMATES 缺 justification_refs |
| 31 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-OUT 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 32 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q1 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 33 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q2 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 34 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q3 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 35 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q4 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 36 | e2_normalization_failed | delivery | B3 反向（E1 假设须被声明）: E1 标记了但 IR 未声明的假设：A-INDEPENDENT、A-BINOMIAL、A-COST-LINEAR、A-PERFECT-TEST、A-REWORK-NO-DAMAGE、A-EXPECTED-PROFIT、A-P1-EQUAL-P0、A-NO-CAPACITY、A-DISCRETE-DECISION、A-TREE-NETWORK、A-SAME-BATCH、A-BAYESIAN-ESTIMATE、A-SAMPLING-SCHEME、A-INDEPENDENT-ESTIMATES（未通过的保真检查：B3 反向（E1 假设须被声明）） |
| 37 | blank_area | delivery | 「摘要」正文只有 109 字、没有任何表格（低于 120 字）——这一章几乎是空的 |
| 38 | blank_area | delivery | 「1 问题重述」正文只有 48 字、没有任何表格（低于 120 字）——这一章几乎是空的 |
| 39 | blank_area | delivery | 「2 问题分析」正文只有 48 字、没有任何表格（低于 120 字）——这一章几乎是空的 |
| 40 | blank_area | delivery | 「4 符号说明」正文只有 14 字、没有任何表格（低于 120 字）——这一章几乎是空的 |
| 41 | blank_area | delivery | 「AI 声明」正文只有 20 字、没有任何表格（低于 120 字）——这一章几乎是空的 |
| 42 | blank_area | delivery | 「参考文献」正文只有 119 字、没有任何表格（低于 120 字）——这一章几乎是空的 |
| 43 | blank_area | delivery | 「附录 A 数据与输出文件」正文只有 20 字、没有任何表格（低于 120 字）——这一章几乎是空的 |
| 44 | blank_area | delivery | 「附录 B 核心代码」正文只有 119 字、没有任何表格（低于 120 字）——这一章几乎是空的 |

*标注由交付门槛自动生成（fail-soft）：未通过项不拦截交付，但必须在此如实列出。*
---

## 附录：已知缺陷表（自动生成）

本稿交付时共有 44 项被检出的问题，其中 44 项未修复或未证实已修。下表逐项列出状态与证据，供复核者判断本稿的可用范围。

| # | 严重度 | 类别 | 状态 | 位置 | 证据 |
|---|---|---|---|---|---|
| 1 | minor | critical_gate | 已接受（如实披露） | paper/main.md | ir_canonicalization:BLOCKED:missing IR backbone: RunArtifact,Result,Claim; no CRITICAL claim in canonical IR; 6 Problem Contract failure(s): global.P1/n:duplicate_symbol_token,global.P2/E:duplicate_symbol_token,global.P2/a:duplicate_symbol_token,global.P2/s:duplicate_symbol_token,global.P2/l:duplicate_symbol_token,global.P2/r:duplicate_symbol_token｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 2 | minor | critical_gate | 已接受（如实披露） | paper/main.md | requirement_coverage:BLOCKED:requirement coverage: 4 finding(s) (required_output_unpaid: REQUIRED_OUTPUT 'R-Q1' of problem 'P1' is not covered: only 0/1 distinct CRITICAL results reach this problem (A7 v0 fail-closed))｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 3 | major | review_defect_critical | 已接受（如实披露） | paper/main.md | The text claims optimal decisions for Problem 2 (e.g., '最优决策通常为：检测零配件 1 和零配件 2，检测成品，不拆解不合格成品') and implies enumeration of 16 combinations, but no specific results for the six cases in Table 1 are provided, and no evidence from the canonical context supports these claims.｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 4 | major | review_defect_critical | 已接受（如实披露） | paper/main.md | The text states that for Problem 3, '可以穷举所有决策组合...计算量可接受' and implies an optimal decision exists, but no concrete decision scheme, basis, or indicator results are given for the specific case in Figure 1 and Table 2, and no evidence supports these claims.｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 5 | minor | review_defect_major | 已接受（如实披露） | paper/main.md | Structural deviation: sections 10, 11, and references are placeholders with no content, failing to deliver the required analysis and results for the problems.｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 6 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-COST-LINEAR 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 7 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-PERFECT-TEST 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 8 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-REWORK-NO-DAMAGE 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 9 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-EXPECTED-PROFIT 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 10 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-NO-CAPACITY 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 11 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-DISCRETE-DECISION 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 12 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-TREE-NETWORK 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 13 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-SAME-BATCH 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 14 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-BAYESIAN-ESTIMATE 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 15 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-SAMPLING-SCHEME 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 16 | minor | V1 假设-使用一致性 | 已接受（如实披露） | paper/main.md | 假设 A-INDEPENDENT-ESTIMATES 未被任何 ModelSpec 引用(假设了但没用)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 17 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-INDEPENDENT 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 18 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-BINOMIAL 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 19 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-COST-LINEAR 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 20 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-PERFECT-TEST 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 21 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-REWORK-NO-DAMAGE 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 22 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-EXPECTED-PROFIT 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 23 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-P1-EQUAL-P0 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 24 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-NO-CAPACITY 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 25 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-DISCRETE-DECISION 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 26 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-TREE-NETWORK 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 27 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-SAME-BATCH 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 28 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-BAYESIAN-ESTIMATE 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 29 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-SAMPLING-SCHEME 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 30 | minor | V2 假设-来源匹配(MODELING_CHOICE) | 已接受（如实披露） | paper/main.md | MODELING_CHOICE 假设 A-INDEPENDENT-ESTIMATES 缺 justification_refs｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 31 | minor | V4 REQUIRED_OUTPUT 覆盖 | 已接受（如实披露） | paper/main.md | REQUIRED_OUTPUT R-OUT 无任何 CRITICAL 结果链到达(承诺未兑现)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 32 | minor | V4 REQUIRED_OUTPUT 覆盖 | 已接受（如实披露） | paper/main.md | REQUIRED_OUTPUT R-Q1 无任何 CRITICAL 结果链到达(承诺未兑现)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 33 | minor | V4 REQUIRED_OUTPUT 覆盖 | 已接受（如实披露） | paper/main.md | REQUIRED_OUTPUT R-Q2 无任何 CRITICAL 结果链到达(承诺未兑现)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 34 | minor | V4 REQUIRED_OUTPUT 覆盖 | 已接受（如实披露） | paper/main.md | REQUIRED_OUTPUT R-Q3 无任何 CRITICAL 结果链到达(承诺未兑现)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 35 | minor | V4 REQUIRED_OUTPUT 覆盖 | 已接受（如实披露） | paper/main.md | REQUIRED_OUTPUT R-Q4 无任何 CRITICAL 结果链到达(承诺未兑现)｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 36 | minor | e2_normalization_failed | 已接受（如实披露） | paper/main.md | B3 反向（E1 假设须被声明）: E1 标记了但 IR 未声明的假设：A-INDEPENDENT、A-BINOMIAL、A-COST-LINEAR、A-PERFECT-TEST、A-REWORK-NO-DAMAGE、A-EXPECTED-PROFIT、A-P1-EQUAL-P0、A-NO-CAPACITY、A-DISCRETE-DECISION、A-TREE-NETWORK、A-SAME-BATCH、A-BAYESIAN-ESTIMATE、A-SAMPLING-SCHEME、A-INDEPENDENT-ESTIMATES（未通过的保真检查：B3 反向（E1 假设须被声明））｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 37 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「摘要」正文只有 109 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 38 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「1 问题重述」正文只有 48 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 39 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「2 问题分析」正文只有 48 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 40 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「4 符号说明」正文只有 14 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 41 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「AI 声明」正文只有 20 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 42 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「参考文献」正文只有 119 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 43 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「附录 A 数据与输出文件」正文只有 20 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |
| 44 | minor | blank_area | 已接受（如实披露） | paper/main.md | 「附录 B 核心代码」正文只有 119 字、没有任何表格（低于 120 字）——这一章几乎是空的｜处置：本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。 |

*状态含义：已修复＝复验指纹已改变；已接受＝确认存在但本轮不修；已驳回＝有反驳证据；无法复验＝检查器本身未跑通（与未通过同级）。*
---

> **本交付物的验证范围（W8.9-C2）**：已机械核验的是**结构完整**（章节/符号/假设齐备）、**数字可溯源**（每个数字可追到 Result 或题面给定值）与**形式化忠实**（IR 声明逐字锚定建模分析文本）。**未**核验的是**实质正确性**——建模思路的优劣、假设的物理真伪、方法选择的恰当性，均**不在本 harness 的可判定范围内**。请读者据此评估结论。
