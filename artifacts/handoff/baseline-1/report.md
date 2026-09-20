# 建模分析稿（E1 直通交付）

## 摘要

> **交付说明（诚实标注）**：本稿由模型的建模分析（E1）直接生成——
> 结构化规范化（E2）未通过，故**未经规范 IR 验证**：数字、引用、图表
> 均未逐条溯源。失败原因（引擎原文）：DRIFT guidance budget exhausted
> 未通过的保真检查：B3 正向（声明须逐字锚定 E1）。
> 请把它当作**素材**而不是成品。

## 问题重述

_(模型待写入)_

## 问题分析

_(模型待写入)_

## 模型假设

| 假设 | 来源 | 风险 | 可检验 |
|---|---|---|---|
| A1-BINOMIAL | （见模型建立与求解节） | 未评定 | 未检验 | [A1-BINOMIAL]
| A1-RANDOM-SAMPLE | （见模型建立与求解节） | 未评定 | 未检验 | [A1-RANDOM-SAMPLE]
| A1-ACCEPT-LEVEL | （见模型建立与求解节） | 未评定 | 未检验 | [A1-ACCEPT-LEVEL]
| A1-REJECT-LEVEL | （见模型建立与求解节） | 未评定 | 未检验 | [A1-REJECT-LEVEL]
| A2-INDEPENDENT | （见模型建立与求解节） | 未评定 | 未检验 | [A2-INDEPENDENT]
| A2-ASSEMBLY | （见模型建立与求解节） | 未评定 | 未检验 | [A2-ASSEMBLY]
| A2-DISASSEMBLY | （见模型建立与求解节） | 未评定 | 未检验 | [A2-DISASSEMBLY]
| A2-RETURN | （见模型建立与求解节） | 未评定 | 未检验 | [A2-RETURN]
| A2-NO-SALVAGE | （见模型建立与求解节） | 未评定 | 未检验 | [A2-NO-SALVAGE]
| A3-TREE | （见模型建立与求解节） | 未评定 | 未检验 | [A3-TREE]
| A3-PROPAGATION | （见模型建立与求解节） | 未评定 | 未检验 | [A3-PROPAGATION]
| A3-DISASSEMBLY-TREE | （见模型建立与求解节） | 未评定 | 未检验 | [A3-DISASSEMBLY-TREE]
| A4-BETA-PRIOR | （见模型建立与求解节） | 未评定 | 未检验 | [A4-BETA-PRIOR]
| A4-INDEPENDENT-POSTERIOR | （见模型建立与求解节） | 未评定 | 未检验 | [A4-INDEPENDENT-POSTERIOR]
| A4-SAMPLING-COST | （见模型建立与求解节） | 未评定 | 未检验 | [A4-SAMPLING-COST]

## 符号说明

(符号表由规范 IR 自动生成)

## 模型建立与求解

[[REQUIREMENT: R-OUT]]

## 总体判断：本题适用 F4 评价决策方法族

本题是 2024 年高教社杯 B 题“生产过程中的决策问题”。题面核心是：

- 问题 1：设计抽样检测方案，在给定信度下判断零配件次品率是否超过标称值——这是典型的统计假设检验与抽样方案设计问题，属于 F3（统计推断/检验）方法族。
- 问题 2–4：在已知或估计次品率、成本、售价、调换损失、拆解费用等参数下，对“是否检测零配件、是否检测成品、是否拆解不合格成品、是否调换”等离散决策进行优化——这是离散决策优化问题，属于 F2（离散优化/决策分析）方法族，可用决策树、动态规划或期望成本最小化模型处理。

题面中不存在多准则评价、排序、打分或层次比较的需求，因此不采用 entropy、AHP、CRITIC、TOPSIS、灰色关联、模糊综合评价等 F4 方法。下面按子问题逐一说明建模思路。

---

## 问题 1：抽样检测方案设计

### 问题实质

供应商声称一批零配件的次品率不超过标称值 \(p_0\)（如 10%）。企业要通过抽样检测决定接收或拒收。检测费用由企业承担，要求检测次数尽可能少。

这本质上是两个单侧假设检验问题：

- 情形 (1)：在 95% 信度下认定次品率超过标称值，则拒收。即检验
  \[
  H_0: p \le p_0 \quad \text{vs} \quad H_1: p > p_0
  \]
  显著性水平 \(\alpha = 0.05\)，当样本给出足够证据拒绝 \(H_0\) 时拒收。

- 情形 (2)：在 90% 信度下认定次品率不超过标称值，则接收。即检验
  \[
  H_0: p > p_0 \quad \text{vs} \quad H_1: p \le p_0
  \]
  或等价地，在置信水平 90% 下判断 \(p \le p_0\)。

### 方法选择

采用基于二项分布的精确检验或正态近似检验，并配合最小样本量设计。为控制检测次数，可考虑序贯抽样方案（如 Wald 序贯概率比检验，SPRT），它在平均意义上比固定样本量方案更省检测次数。

[[ASSUMPTION: A1-BINOMIAL]]
零配件是否合格相互独立，且每件零配件的次品状态服从参数为 \(p\) 的伯努利分布，因此样本中不合格品数服从二项分布。

[[ASSUMPTION: A1-RANDOM-SAMPLE]]
抽样是简单随机抽样，样本能代表整批零配件。

### 模型

设样本量为 \(n\)，不合格品数为 \(X \sim \text{Bin}(n, p)\)。

**情形 (1)**：在 \(\alpha = 0.05\) 下检验 \(H_0: p \le 0.10\)。拒绝域为
\[
X \ge c,
\]
其中 \(c\) 是满足
\[
P_{p=0.10}(X \ge c) \le 0.05
\]
的最小整数。若观测到 \(X \ge c\)，则在 95% 信度下认定 \(p > 0.10\)，拒收。

**情形 (2)**：在 90% 信度下认定 \(p \le 0.10\)。可构造单侧置信上限。若观测到 \(X = k\)，则 \(p\) 的 \(100(1-\alpha)\%\) 单侧置信上限 \(\hat p_U\) 满足
\[
P_{p=\hat p_U}(X \le k) = \alpha.
\]
若 \(\hat p_U \le 0.10\)，则在 90% 信度下认定 \(p \le 0.10\)，接收。

**最小样本量**：情形 (2) 需要保证当真实次品率低到某个可接受水平（如 \(p_1\)）时，能以较高概率（如 90%）通过检验。这需要设定两个参数：可接受质量水平 \(p_1\) 和对应的接收概率。题目未给出 \(p_1\)，需要假设。

[[ASSUMPTION: A1-ACCEPT-LEVEL]]
为确定最小样本量，假设当真实次品率不超过某个较低水平 \(p_1\)（例如 5%）时，企业希望以至少 90% 的概率接收该批零配件。

在情形 (1) 中，若只要求“在 95% 信度下认定超过标称值则拒收”，则最小样本量由显著性水平 \(\alpha=0.05\) 和标称值 \(p_0=0.10\) 决定。例如，要使在 \(p=0.10\) 时能以至少 95% 概率不误拒，同时使在某个更高的次品率 \(p_2\)（如 20%）时能以较高概率拒收，需要设定 \(p_2\) 和检验功效。

[[ASSUMPTION: A1-REJECT-LEVEL]]
为确定情形 (1) 的最小样本量，假设当真实次品率达到 \(p_2 = 20\%\) 时，企业希望以至少 90% 的概率拒收该批零配件。

### 具体结果（标称值 10%）

以正态近似为例，情形 (1) 的拒绝域近似为
\[
\frac{\hat p - 0.10}{\sqrt{0.10 \times 0.90 / n}} \ge z_{0.95} = 1.645.
\]
若要求 \(p=0.20\) 时功效为 90%，则
\[
n \approx \left( \frac{z_{0.95}\sqrt{0.10 \times 0.90} + z_{0.90}\sqrt{0.20 \times 0.80}}{0.20 - 0.10} \right)^2.
\]
代入 \(z_{0.95}=1.645\)，\(z_{0.90}=1.282\)，得
\[
n \approx \left( \frac{1.645 \times 0.3 + 1.282 \times 0.4}{0.10} \right)^2
= \left( \frac{0.4935 + 0.5128}{0.10} \right)^2
\approx (10.063)^2 \approx 101.3.
\]
取 \(n = 102\)。精确二项检验下样本量可能略有不同，需用二项分布精确计算。

情形 (2) 的样本量由置信区间宽度决定。若要求当观测到 0 个不合格品时，90% 单侧置信上限不超过 10%，则
\[
(1 - 0.10)^n \le 0.10 \quad \Rightarrow \quad n \ge \frac{\ln 0.10}{\ln 0.90} \approx 21.85,
\]
取 \(n = 22\)。但若观测到不合格品，则置信上限会超过 10%，无法接收。因此更实际的设计需要指定可接受的合格判定数。

### 检验方法

- 用二项分布精确计算拒绝域和置信限，避免正态近似的误差。
- 用序贯抽样（SPRT）进一步减少平均检测次数。

---

## 问题 2：生产各阶段决策

### 问题实质

给定零配件 1、零配件 2、成品的次品率，以及购买单价、检测成本、装配成本、市场售价、调换损失、拆解费用，要求对以下决策作出选择：

1. 是否检测零配件 1、零配件 2；
2. 是否检测成品；
3. 对检测出的不合格成品是否拆解；
4. 对用户退回的不合格品是否拆解（重复步骤 3）。

目标是最小化期望总成本或最大化期望利润。

### 方法选择

这是典型的离散决策优化问题，适用 F2 方法族。可用决策树或动态规划，以期望利润最大化为目标，枚举所有决策组合（检测/不检测、拆解/不拆解），计算每种组合的期望利润，选择最优者。

### 模型

设：

- \(p_1, p_2\)：零配件 1、2 的次品率；
- \(c_1, c_2\)：零配件 1、2 的购买单价；
- \(d_1, d_2\)：零配件 1、2 的检测成本；
- \(p_f\)：成品次品率（在零配件均合格条件下）；
- \(c_a\)：装配成本；
- \(d_f\)：成品检测成本；
- \(s\)：市场售价；
- \(l\)：调换损失；
- \(r\)：拆解费用。

决策变量：

- \(x_1, x_2 \in \{0,1\}\)：是否检测零配件 1、2；
- \(y \in \{0,1\}\)：是否检测成品；
- \(z \in \{0,1\}\)：对不合格成品是否拆解（不拆解则丢弃）。

**关键逻辑**：

- 若检测零配件 \(i\)，则不合格零配件被丢弃，进入装配的零配件均合格，但需支付检测成本 \(d_i\) 和购买成本 \(c_i\)（购买后检测，不合格丢弃，相当于合格零配件的有效成本为 \(c_i/(1-p_i)\)）。
- 若不检测零配件 \(i\)，则不合格零配件进入装配，导致成品不合格。
- 成品次品率取决于零配件是否检测：
  - 若两个零配件都检测，则成品次品率为 \(p_f\)；
  - 若零配件 \(i\) 不检测，则成品次品率会升高，因为零配件不合格必然导致成品不合格。
- 若检测成品，则不合格成品不会进入市场，但需支付检测成本 \(d_f\)；不合格成品可选择拆解或丢弃。
- 若不检测成品，则不合格成品进入市场，产生调换损失 \(l\)，退回的不合格品再决定是否拆解。
- 拆解后回收零配件，可重复利用，但需支付拆解费用 \(r\)。

**期望利润计算**：

对每种决策组合，计算期望利润：

\[
\text{期望利润} = \text{期望收入} - \text{期望成本}
\]

其中期望收入来自合格成品销售，期望成本包括零配件购买、检测、装配、成品检测、调换损失、拆解费用等。

### 假设

[[ASSUMPTION: A2-INDEPENDENT]]
零配件 1 和零配件 2 的次品事件相互独立。

[[ASSUMPTION: A2-ASSEMBLY]]
若两个零配件均合格，成品仍以概率 \(p_f\) 不合格；若任一零配件不合格，成品必不合格。

[[ASSUMPTION: A2-DISASSEMBLY]]
拆解过程不损坏零配件，拆解后的零配件可重新用于装配，且其合格状态与拆解前相同。

[[ASSUMPTION: A2-RETURN]]
用户退回的不合格品可被拆解，拆解后的零配件可重新进入生产流程。

[[ASSUMPTION: A2-NO-SALVAGE]]
报废或丢弃的零配件、成品无残值。

### 决策方案与指标

对表 1 中 6 种情形，分别枚举所有决策组合，计算期望利润，选择最优组合。具体计算可用程序实现。决策依据是期望利润最大化。

---

## 问题 3：多工序、多零配件的一般情形

### 问题实质

将问题 2 推广到 \(m\) 道工序、\(n\) 个零配件，已知零配件、半成品和成品的次品率，要求给出生产过程的决策方案。图 1 和表 2 给出了 2 道工序、8 个零配件的具体情形。

### 方法选择

仍是离散决策优化问题，适用 F2 方法族。由于工序和零配件数量增加，决策空间变大，可用动态规划或树搜索（如分支定界）求解。对于图 1 的具体情形，决策空间有限，可枚举所有组合。

### 模型

将生产过程建模为装配树：

- 叶子节点为零配件，有次品率、购买单价、检测成本；
- 内部节点为半成品或成品，有次品率（在子节点均合格的条件下）、装配成本、检测成本、拆解费用；
- 根节点为成品，有市场售价、调换损失。

决策变量：每个零配件节点是否检测，每个半成品/成品节点是否检测，每个不合格半成品/成品是否拆解。

**次品率传播**：

- 若某节点的所有子节点均检测且合格，则该节点的次品率为其标称次品率；
- 若某子节点不检测，则该子节点的次品会传播到父节点，使父节点的次品率升高。

**期望成本计算**：

从叶子到根递归计算期望成本和期望合格品数量。对每个节点，根据是否检测、是否拆解，计算其期望成本和产出合格品的概率。

### 假设

[[ASSUMPTION: A3-TREE]]
生产过程可表示为装配树，各零配件和半成品的次品事件相互独立。

[[ASSUMPTION: A3-PROPAGATION]]
若某节点的任一子节点不合格，则该节点必不合格；若所有子节点均合格，则该节点以标称次品率不合格。

[[ASSUMPTION: A3-DISASSEMBLY-TREE]]
拆解半成品或成品可回收其所有直接子节点，且不损坏子节点。

### 决策方案与指标

对表 2 的具体情形，枚举所有决策组合，计算期望利润，选择最优组合。决策依据是期望利润最大化。

---

## 问题 4：次品率由抽样检测得到时的重新决策

### 问题实质

假设问题 2 和问题 3 中的零配件、半成品和成品的次品率均是通过问题 1 的抽样检测方法得到的，要求重新完成问题 2 和问题 3。

### 方法选择

这是统计推断与决策优化的结合。次品率不再是已知常数，而是带有不确定性的估计值。适用 F3（统计推断）与 F2（决策优化）的混合方法。

### 模型

将次品率视为随机变量，其分布由抽样检测结果决定。例如，若抽样 \(n\) 件发现 \(k\) 件不合格，则次品率 \(p\) 的后验分布为 Beta 分布：

\[
p \mid \text{data} \sim \text{Beta}(k+1, n-k+1)
\]

（在均匀先验下）。

[[ASSUMPTION: A4-BETA-PRIOR]]
假设次品率的先验分布为均匀分布 \(\text{Beta}(1,1)\)，抽样检测后得到后验分布 \(\text{Beta}(k+1, n-k+1)\)。

然后，在决策优化中，用期望值代替确定性次品率。即对每个决策组合，计算期望利润时对次品率取期望：

\[
\text{期望利润} = E_{p_1, p_2, p_f, \ldots}[\text{利润}(p_1, p_2, p_f, \ldots)]
\]

这可以通过蒙特卡洛模拟或数值积分实现。

### 假设

[[ASSUMPTION: A4-INDEPENDENT-POSTERIOR]]
各零配件、半成品和成品的次品率后验分布相互独立。

[[ASSUMPTION: A4-SAMPLING-COST]]
抽样检测成本已计入问题 1 的检测费用，在问题 4 的决策中不再重复计算。

### 决策方案与指标

对问题 2 的表 1 和问题 3 的表 2，用后验分布的期望次品率重新计算各决策组合的期望利润，选择最优组合。决策依据是期望利润最大化。

---

## 检验方法总结

- **问题 1**：用二项分布精确检验验证拒绝域和置信限；用模拟验证序贯抽样方案的平均样本量和错误率。
- **问题 2–3**：用枚举或动态规划验证最优决策；对最优决策进行敏感性分析，检查次品率、成本参数变化时决策是否稳健。
- **问题 4**：用蒙特卡洛模拟验证期望利润计算的准确性；比较确定性模型与随机模型的最优决策差异。

## 结果对比与校核

_(本机器槽未生成内容：渲染器未提供)_

## 模型评价与推广

_(模型待写入)_

## AI 声明

_(本机器槽未生成内容：渲染器未提供)_

## 参考文献

_(模型待写入)_

## 数据附录

_(本机器槽未生成内容：渲染器未提供)_

## 代码附录

_(模型待写入)_
---

## 附录：交付标注（自动生成）

本稿以 **MARKED**（标注交付）等级交付：12 项检查未通过。内容照常可用；以下逐项列出未通过项、位置与原因，供复核与改进。

| # | 检查项 | 位置 | 原因 |
|---|---|---|---|
| 1 | critical_gate | delivery | ir_canonicalization:BLOCKED:missing IR backbone: ModelSpec,RunArtifact,Result,Claim; no CRITICAL claim in canonical IR; minimum Problem Contract not satisfied (RAW_PROBLEM DataArtifact + REQUIRED_OUTPUT RequirementSpec + SymbolSpec) |
| 2 | critical_gate | delivery | requirement_coverage:BLOCKED:requirement coverage: 1 finding(s) (required_output_unpaid: REQUIRED_OUTPUT 'R-OUT' of problem 'P1' is not covered: only 0/1 distinct CRITICAL results reach this problem (A7 v0 fail-closed)) |
| 3 | review_defect_critical | review ledger | The text explicitly states that the problem is not applicable to the F4 evaluation decision method family, but the routing contract requires the use of F4 methods. This is a structural deviation from the required method family. |
| 4 | review_defect_critical | review ledger | The text contains unsupported numerical results for sample sizes (n=102, n=22) without any source or calculation verification. |
| 5 | review_defect_critical | review ledger | The text contains unsupported numerical results for sample sizes (n=102, n=22) without any source or calculation verification. |
| 6 | review_defect_critical | review ledger | The text includes placeholders such as '(模型待写入)' and '(本机器槽未生成内容：渲染器未提供)' indicating incomplete sections. |
| 7 | review_defect_critical | review ledger | The text includes placeholders such as '(模型待写入)' and '(本机器槽未生成内容：渲染器未提供)' indicating incomplete sections. |
| 8 | review_defect_critical | review ledger | The text does not provide the required decision schemes and indicator results for the six cases in Table 1, despite claiming to do so. |
| 9 | review_defect_critical | review ledger | The text does not provide the required decision schemes and indicator results for the specific case in Table 2, despite claiming to do so. |
| 10 | review_defect_critical | review ledger | The text does not provide the required re-completed decision schemes for Problems 2 and 3 under the assumption that defect rates are obtained via sampling, despite claiming to do so. |
| 11 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-OUT 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 12 | e2_normalization_failed | delivery | B3 正向（声明须逐字锚定 E1）: A1-BINOMIAL: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 52.8%，首分歧 @28，span「品状态服从参数为p的伯努利分布,」vs E1「品状态服从参数为(p)的伯努利分」〕；A1-ACCEPT-LEVEL: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 49.1%，首分歧 @3，span「为确定最小样本量,假设」vs E1「为确定情形(1)的最小」〕；A1-REJECT-LEVEL: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 45.5%，首分歧 @25，span「当真实次品率达到p2=20\%时」vs E1「当真实次品率达到(p2=20\%」〕；A2-ASSEMBLY: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 41.0%，首分歧 @16，span「格,成品仍以概率pf不合格;若任」vs E1「格,成品仍以概率(pf)不合格;」〕；A4-BETA-PRIOR: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 24.2%，首分歧 @15，span「验分布为均匀分布\text{Be」vs E1「验分布为均匀分布(\text{B」〕；EQ-BINOMIAL: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 20.6%，首分歧 @5，span「设样本量为n,不合格品数为」vs E1「设样本量为(n),不合格品」〕；EQ-CRITICAL: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 7.5%，首分歧 @2，span「其中c是满足\[P_」vs E1「其中(c)是满足\[」〕；EQ-CONF-UPPER: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 5.6%，首分歧 @4，span「若观测到X=k,则p的1」vs E1「若观测到(X\gec),」〕；EQ-N1-APPROX: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 6.5%，首分歧 @3，span「若要求p=0.20时功」vs E1「若要求当观测到0个不合」〕（未通过的保真检查：B3 正向（声明须逐字锚定 E1）） |

*标注由交付门槛自动生成（fail-soft）：未通过项不拦截交付，但必须在此如实列出。*
---

> **本交付物的验证范围（W8.9-C2）**：已机械核验的是**结构完整**（章节/符号/假设齐备）、**数字可溯源**（每个数字可追到 Result 或题面给定值）与**形式化忠实**（IR 声明逐字锚定建模分析文本）。**未**核验的是**实质正确性**——建模思路的优劣、假设的物理真伪、方法选择的恰当性，均**不在本 harness 的可判定范围内**。请读者据此评估结论。
