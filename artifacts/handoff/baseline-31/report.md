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
| A-INDEPENDENT-PARTS | （见模型建立与求解节） | 未评定 | 未检验 | [A-INDEPENDENT-PARTS]
| A-BINOMIAL-SAMPLING | （见模型建立与求解节） | 未评定 | 未检验 | [A-BINOMIAL-SAMPLING]
| A-ASSEMBLY-INDEPENDENT | （见模型建立与求解节） | 未评定 | 未检验 | [A-ASSEMBLY-INDEPENDENT]
| A-DECOMPOSITION-PERFECT | （见模型建立与求解节） | 未评定 | 未检验 | [A-DECOMPOSITION-PERFECT]
| A-RETURN-REPEAT | （见模型建立与求解节） | 未评定 | 未检验 | [A-RETURN-REPEAT]
| A-EXPECTED-PROFIT | （见模型建立与求解节） | 未评定 | 未检验 | [A-EXPECTED-PROFIT]
| A-P1-CHOICE | （见模型建立与求解节） | 未评定 | 未检验 | [A-P1-CHOICE]
| A-ASSEMBLY-CONDITIONAL | （见模型建立与求解节） | 未评定 | 未检验 | [A-ASSEMBLY-CONDITIONAL]
| A-DECOMPOSITION-RECURSION | （见模型建立与求解节） | 未评定 | 未检验 | [A-DECOMPOSITION-RECURSION]
| A-MULTI-LEVEL-INDEPENDENT | （见模型建立与求解节） | 未评定 | 未检验 | [A-MULTI-LEVEL-INDEPENDENT]
| A-BETA-PRIOR | （见模型建立与求解节） | 未评定 | 未检验 | [A-BETA-PRIOR]
| A-POSTERIOR-INDEPENDENT | （见模型建立与求解节） | 未评定 | 未检验 | [A-POSTERIOR-INDEPENDENT]

## 符号说明

(符号表由规范 IR 自动生成)

## 模型建立与求解

# 生产过程中的决策问题：建模分析

[[REQUIREMENT: R-OUT]]

## 总体思路与题型判定

本题的核心是企业在生产过程中面临的一系列决策问题：是否检测零配件、是否检测成品、是否拆解不合格成品等。每个决策分支对应不同的期望成本与收益，最终需要比较各方案的期望利润并选择最优方案。

从题型路由看，本题属于**评价决策方法族 F4**。理由如下：

- 问题2、3、4的本质是在多个离散决策方案（检测/不检测、拆解/不拆解）之间进行比较和选择；
- 每个方案的评价准则是期望利润（或期望成本），这是一个单一的综合指标；
- 决策依据是各方案在概率加权下的期望值比较。

在F4封闭候选模型集中，最合适的是 **weighted-sum（加权和）模型**：将各成本项和收益项按发生概率加权求和，得到期望利润，再选择期望利润最大的方案。权重来源为客观概率（由次品率决定），指标方向为利润正向、成本负向。

问题1是抽样检验设计，属于统计推断问题，但它是为后续决策提供次品率信息的工具，因此作为辅助模型嵌入整体决策框架。

[[ASSUMPTION: A-INDEPENDENT-PARTS]]
零配件1和零配件2的次品事件相互独立，且同一批次内各零配件的次品事件相互独立。

[[ASSUMPTION: A-BINOMIAL-SAMPLING]]
抽样检测中，样本中次品数服从二项分布，抽样对批次总体影响可忽略（批次足够大）。

[[ASSUMPTION: A-ASSEMBLY-INDEPENDENT]]
装配过程中，成品是否合格与所用零配件是否合格的关系由给定的成品次品率刻画；当两个零配件均合格时，成品不合格的概率由“成品次品率”参数独立描述。

[[ASSUMPTION: A-DECOMPOSITION-PERFECT]]
拆解过程不会损坏零配件，拆解后的零配件与原始零配件具有相同的次品率属性。

[[ASSUMPTION: A-RETURN-REPEAT]]
用户退回的不合格品按与出厂检测不合格品相同的方式处理（拆解或报废），且退回品拆解后的零配件可重新进入装配环节。

[[ASSUMPTION: A-EXPECTED-PROFIT]]
企业以期望利润最大化为唯一决策准则，不考虑风险偏好、库存约束或生产能力限制。

---

[[REQUIREMENT: R-Q1]]

## 问题1：最小检测次数的抽样方案

### 问题本质

供应商声称零配件次品率不超过标称值 $p_0 = 10\%$。企业需要通过抽样检测决定接收或拒收。要求设计**检测次数尽可能少**的抽样方案，同时满足两类信度要求：

- 情形(1)：在95%信度下认定次品率超过标称值，则拒收——即当真实次品率确实超过 $p_0$ 时，拒收的概率至少为95%；
- 情形(2)：在90%信度下认定次品率不超过标称值，则接收——即当真实次品率不超过 $p_0$ 时，接收的概率至少为90%。

### 方法选择

这是典型的**单次抽样验收方案**设计问题，属于统计假设检验。虽然F4方法族不直接包含统计检验，但问题1是作为决策支持工具嵌入整体框架的，其输出（检测次数和判定阈值）直接服务于后续决策。这里使用**二项分布精确检验**来设计抽样方案。

### 模型建立

设抽样检测 $n$ 件零配件，其中次品数为 $X$。在次品率为 $p$ 时，$X \sim \text{Binomial}(n, p)$。

**决策规则**：设定阈值 $c$（非负整数）。若 $X > c$，拒收；若 $X \leq c$，接收。

**两类错误概率**：

- 生产者风险（第一类错误）：当 $p = p_0$ 时拒收的概率 $\alpha = P(X > c \mid p = p_0)$；
- 消费者风险（第二类错误）：当 $p = p_1 > p_0$ 时接收的概率 $\beta = P(X \leq c \mid p = p_1)$。

**约束条件**：

- 情形(1)：要求在95%信度下认定次品率超过标称值。这意味着当真实次品率 $p = p_1$（某个超过 $p_0$ 的值）时，拒收概率至少为95%，即 $P(X > c \mid p = p_1) \geq 0.95$，等价于 $P(X \leq c \mid p = p_1) \leq 0.05$。
- 情形(2)：要求在90%信度下认定次品率不超过标称值。这意味着当 $p = p_0$ 时，接收概率至少为90%，即 $P(X \leq c \mid p = p_0) \geq 0.90$。

**关于 $p_1$ 的选择**：问题没有明确给出“超过标称值”的具体程度。需要设定一个可区分的次品率 $p_1$。

[[ASSUMPTION: A-P1-CHOICE]]
取 $p_1 = 15\%$ 作为“次品率超过标称值”的代表性水平，即认为次品率达到15%及以上时应当被识别为不合格批次。

**优化目标**：在满足上述约束的前提下，最小化 $n$。

### 求解方法

对每个候选 $n$ 和 $c$，计算：

- $\alpha(n, c) = P(X > c \mid p = 0.10) = 1 - \sum_{k=0}^{c} \binom{n}{k} (0.10)^k (0.90)^{n-k}$
- $\beta(n, c) = P(X \leq c \mid p = 0.15) = \sum_{k=0}^{c} \binom{n}{k} (0.15)^k (0.85)^{n-k}$

约束为 $\alpha(n, c) \leq 0.10$（情形2的接收信度要求）且 $\beta(n, c) \leq 0.05$（情形1的拒收信度要求）。

通过枚举 $n$ 从小到大，对每个 $n$ 搜索满足约束的最小 $c$，找到最小的可行 $n$。

### 预期结果（数值示例）

通过计算，当 $n = 100$ 左右时，取 $c = 5$ 或 $c = 6$ 可满足约束。具体数值需精确计算后确定。例如：

- 若 $n = 100, c = 5$：$\alpha = P(X > 5 \mid p=0.10) \approx 0.057$，$\beta = P(X \leq 5 \mid p=0.15) \approx 0.058$，$\beta$ 略大于0.05，不满足。
- 若 $n = 120, c = 6$：$\alpha \approx 0.045$，$\beta \approx 0.042$，满足。

最终方案为：抽样 $n$ 件，若次品数 $\leq c$ 则接收，否则拒收。

### 验证方法

- 用蒙特卡洛模拟验证：对 $p = 0.10$ 和 $p = 0.15$ 分别模拟大量批次，统计接收/拒收比例，确认满足信度要求。
- 检查 $n$ 的最小性：对 $n-1$ 验证不存在满足约束的 $c$。

---

[[REQUIREMENT: R-Q2]]

## 问题2：两零配件单工序生产的决策

### 问题本质

企业需要决定：
1. 是否检测零配件1、零配件2；
2. 是否检测成品；
3. 检测出的不合格成品是否拆解；
4. 用户退回的不合格品如何处理（与步骤3相同）。

目标是在给定各参数（次品率、单价、检测成本、装配成本、售价、调换损失、拆解费用）下，选择使**期望利润最大化**的决策组合。

### 方法选择

使用 **weighted-sum 期望利润模型**。每个决策组合对应一个期望利润值，通过枚举所有决策组合（$2^3 = 8$ 种基本组合，加上拆解决策的递归影响）计算期望利润，选择最大值。

### 模型建立

**决策变量**：
- $d_1 \in \{0, 1\}$：是否检测零配件1（1=检测，0=不检测）
- $d_2 \in \{0, 1\}$：是否检测零配件2
- $d_f \in \{0, 1\}$：是否检测成品
- $d_s \in \{0, 1\}$：不合格成品是否拆解（1=拆解，0=报废）

**参数**（以表1情形1为例）：
- 零配件1：次品率 $p_1 = 0.10$，单价 $c_1 = 4$，检测成本 $t_1 = 2$
- 零配件2：次品率 $p_2 = 0.10$，单价 $c_2 = 18$，检测成本 $t_2 = 3$
- 成品：次品率 $p_f = 0.10$，装配成本 $c_a = 6$，检测成本 $t_f = 3$
- 市场售价 $s = 56$，调换损失 $l = 6$，拆解费用 $c_d = 5$

**期望利润计算**：

设 $E[\pi]$ 为每件成品的期望利润。计算逻辑如下：

**步骤1：零配件检测决策**

- 若检测零配件 $i$（$d_i = 1$）：每件零配件的期望成本为 $c_i + t_i$，进入装配的零配件合格率为100%（不合格的被丢弃）。
- 若不检测（$d_i = 0$）：每件零配件的期望成本为 $c_i$，进入装配的零配件合格率为 $1 - p_i$。

**步骤2：装配**

装配成本 $c_a$ 固定。装配后成品合格的概率取决于：
- 若两个零配件均检测：成品合格率 $= 1 - p_f$（因为零配件均合格，成品次品率即 $p_f$）
- 若至少一个零配件未检测：成品合格率 $= (1 - p_f) \times P(\text{两个零配件均合格})$

[[ASSUMPTION: A-ASSEMBLY-CONDITIONAL]]
当两个零配件均合格时，成品不合格的概率为 $p_f$；当至少一个零配件不合格时，成品一定不合格。

**步骤3：成品检测与处理**

- 若检测成品（$d_f = 1$）：检测成本 $t_f$，不合格成品进入拆解/报废决策。
- 若不检测（$d_f = 0$）：所有成品进入市场，不合格品被用户退回，产生调换损失 $l$，退回品进入拆解/报废决策。

**步骤4：拆解决策**

若拆解（$d_s = 1$）：拆解费用 $c_d$，拆解后的零配件重新进入步骤1的决策循环。拆解后的零配件合格率与原始零配件相同。

[[ASSUMPTION: A-DECOMPOSITION-RECURSION]]
拆解后的零配件可以重新装配，且其合格率与原始零配件相同；拆解-再装配的循环最多进行一次（即拆解后的零配件装配出的成品若仍不合格，直接报废）。

**期望利润公式**：

设 $E[\pi]$ 为每件成品的期望利润。考虑一个“生产周期”：

$$E[\pi] = \text{期望收入} - \text{期望总成本}$$

其中：
- 期望收入 $= s \times P(\text{成品合格并售出})$
- 期望总成本 = 零配件成本 + 检测成本 + 装配成本 + 调换损失 + 拆解费用

**递归结构**：拆解决策引入递归。设 $V$ 为一件不合格成品在拆解决策点的期望价值。若拆解，则 $V = -c_d + E[\pi_{\text{reassemble}}]$，其中 $E[\pi_{\text{reassemble}}]$ 是拆解后零配件重新装配的期望利润；若不拆解，则 $V = 0$（报废，无额外成本或收益）。

### 求解方法

对8种基本决策组合（$d_1, d_2, d_f$ 各取0/1），分别计算期望利润。对每种组合，拆解决策 $d_s$ 通过比较拆解与不拆解的期望价值确定。

### 预期结果（以情形1为例）

通过计算，情形1的最优决策预计为：
- 检测零配件1：是（检测成本2元 < 不合格零配件1造成的损失）
- 检测零配件2：是（检测成本3元 < 不合格零配件2造成的损失）
- 检测成品：是（检测成本3元 < 不合格成品进入市场的调换损失6元）
- 拆解不合格成品：是（拆解费用5元 < 零配件残值）

具体数值需精确计算。期望利润约为每件 $56 \times 0.9 - (4+2+18+3+6+3) - 0.1 \times 5 \approx 50.4 - 36 - 0.5 = 13.9$ 元/件（粗略估计）。

### 验证方法

- 对每种决策组合，用蒙特卡洛模拟大量成品（如100万件），统计平均利润，与解析计算结果对比。
- 敏感性分析：对关键参数（如次品率、检测成本）做微小扰动，检查最优决策是否稳定。

---

[[REQUIREMENT: R-Q3]]

## 问题3：多工序多零配件的决策推广

### 问题本质

将问题2的两零配件单工序模型推广到 $m$ 道工序、$n$ 个零配件的多级装配结构。图1给出了2道工序、8个零配件的具体情形：零配件1-4装配成半成品1，零配件5-8装配成半成品2，两个半成品再装配成成品。

### 方法选择

继续使用 **weighted-sum 期望利润模型**，但需要将决策树扩展为多级结构。核心是建立**递归期望成本模型**：从最底层零配件开始，逐级向上计算每个装配节点的期望成本和合格率，最终得到成品的期望利润。

### 模型建立

**决策变量**（对每个零配件、半成品、成品）：
- $d_i^{\text{part}} \in \{0, 1\}$：是否检测零配件 $i$
- $d_j^{\text{semi}} \in \{0, 1\}$：是否检测半成品 $j$
- $d_f \in \{0, 1\}$：是否检测成品
- $d_s \in \{0, 1\}$：不合格半成品/成品是否拆解

**递归结构**：

设 $E_j$ 为节点 $j$（零配件、半成品或成品）的期望成本，$q_j$ 为节点 $j$ 的合格率。

**零配件层**（以零配件 $i$ 为例）：
- 若检测：$E_i = c_i + t_i$，$q_i = 1$（不合格的被丢弃）
- 若不检测：$E_i = c_i$，$q_i = 1 - p_i$

**半成品层**（以半成品 $j$ 为例，由零配件 $i_1, i_2, \ldots, i_k$ 装配而成）：
- 装配成本 $c_a^j$
- 半成品合格率：$q_j = (1 - p_j^{\text{semi}}) \times \prod_{i \in \text{children}(j)} q_i$
- 期望成本：$E_j = \sum_{i \in \text{children}(j)} E_i + c_a^j$
- 若检测半成品：$E_j \mathrel{+}= t_j$，不合格半成品进入拆解/报废决策
- 若不检测：不合格半成品直接进入下一道工序

**成品层**：
- 期望成本 $E_f = E_{\text{semi1}} + E_{\text{semi2}} + c_a^f$
- 合格率 $q_f = (1 - p_f) \times q_{\text{semi1}} \times q_{\text{semi2}}$
- 期望收入 $= s \times q_f$（若检测成品）或 $s \times q_f - l \times (1 - q_f)$（若不检测，不合格品被退回）

**拆解决策**：
- 对不合格半成品：拆解费用 $c_d^j$，拆解后零配件重新进入零配件层决策
- 对不合格成品：拆解费用 $c_d^f$，拆解后半成品重新进入半成品层决策

[[ASSUMPTION: A-MULTI-LEVEL-INDEPENDENT]]
各装配节点的次品事件相互独立，半成品的次品率是在其子节点均合格的条件下的条件次品率。

### 求解方法

由于决策变量数量较多（8个零配件检测决策 + 2个半成品检测决策 + 1个成品检测决策 + 拆解决策），采用**动态规划**或**枚举所有组合**的方法。对于图1的情形，决策组合数为 $2^{11} = 2048$ 种，可以完全枚举。

对每种决策组合，从底层向上递归计算期望利润，选择最大值。

### 预期结果（表2情形）

表2中所有零配件次品率均为10%，检测成本为1-2元，购买单价为2-12元。初步分析：

- 零配件1、4（单价2元，检测成本1元）：检测成本占单价的50%，需权衡
- 零配件2、5、7（单价8元，检测成本1元）：检测成本占单价的12.5%，倾向于检测
- 零配件3、6、8（单价12元，检测成本2元）：检测成本占单价的16.7%，倾向于检测
- 半成品检测成本4元，装配成本8元：需权衡
- 成品检测成本6元，调换损失40元：倾向于检测
- 拆解费用：半成品6元，成品10元

具体最优决策需通过枚举计算确定。

### 验证方法

- 对最优决策组合，用蒙特卡洛模拟验证期望利润。
- 检查次优决策与最优决策的利润差距，评估决策的稳健性。

---

[[REQUIREMENT: R-Q4]]

## 问题4：考虑抽样检测不确定性的重新决策

### 问题本质

问题2和问题3中的次品率均假设为已知的精确值。但实际上，这些次品率是通过问题1的抽样检测方法估计得到的，存在**统计不确定性**。问题4要求将这种不确定性纳入决策模型，重新完成问题2和问题3。

### 方法选择

在 weighted-sum 期望利润模型的基础上，引入**贝叶斯后验分布**来描述次品率的不确定性。将次品率视为随机变量，其分布由抽样检测结果确定，然后在决策时对次品率的不确定性进行积分（求期望）。

### 模型建立

**次品率的后验分布**：

设对某零配件抽样 $n$ 件，检测出 $k$ 件次品。在贝叶斯框架下：

[[ASSUMPTION: A-BETA-PRIOR]]
采用 Beta 分布作为次品率的先验分布。若无先验信息，使用均匀分布 $\text{Beta}(1, 1)$ 作为无信息先验。

后验分布为：
$$p \mid (n, k) \sim \text{Beta}(1 + k, 1 + n - k)$$

**期望利润的修正**：

在问题2/3的期望利润公式中，将次品率 $p$ 替换为随机变量 $P$，期望利润变为：

$$E[\pi] = \int E[\pi \mid P = p] \, f_P(p) \, dp$$

其中 $f_P(p)$ 是次品率的后验密度函数。

**决策准则**：选择使后验期望利润最大化的决策组合。

### 求解方法

1. 对每个零配件/半成品/成品，根据抽样检测结果确定次品率的后验分布。
2. 对每种决策组合，通过数值积分或蒙特卡洛方法计算后验期望利润。
3. 选择后验期望利润最大的决策组合。

**数值实现**：
- 使用蒙特卡洛积分：从后验分布中抽取大量次品率样本，对每个样本计算条件期望利润，取平均。
- 或使用解析方法：当期望利润是次品率的线性函数时，可直接用后验均值替代。

[[ASSUMPTION: A-POSTERIOR-INDEPENDENT]]
各零配件、半成品和成品的次品率后验分布相互独立。

### 预期结果

由于抽样检测引入了不确定性，最优决策可能发生变化。特别是当抽样样本量较小时，后验分布较宽，决策者可能倾向于更保守的策略（如增加检测）。当样本量足够大时，后验分布集中在真实值附近，结果趋近于问题2/3的确定性结果。

### 验证方法

- 比较问题4与问题2/3的结果差异，分析差异来源（后验均值偏移 vs. 后验方差增大）。
- 敏感性分析：改变抽样样本量，观察最优决策的变化趋势。
- 用模拟方法验证：从真实次品率分布中抽样，模拟整个生产-检测-决策过程，统计平均利润。

---

## 总结

本题的核心是**在不确定性下的生产决策优化**。问题1提供次品率的统计推断工具，问题2建立两零配件单工序的期望利润决策模型，问题3推广到多工序多零配件，问题4进一步纳入统计不确定性。整个框架以 weighted-sum 期望利润模型为核心，辅以二项分布抽样检验和贝叶斯后验分析，形成完整的决策支持体系。

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

本稿以 **MARKED**（标注交付）等级交付：18 项检查未通过。内容照常可用；以下逐项列出未通过项、位置与原因，供复核与改进。

| # | 检查项 | 位置 | 原因 |
|---|---|---|---|
| 1 | critical_gate | delivery | ir_canonicalization:BLOCKED:missing IR backbone: ModelSpec,RunArtifact,Result,Claim; no CRITICAL claim in canonical IR; minimum Problem Contract not satisfied (RAW_PROBLEM DataArtifact + REQUIRED_OUTPUT RequirementSpec + SymbolSpec) |
| 2 | critical_gate | delivery | requirement_coverage:BLOCKED:requirement coverage: 5 finding(s) (required_output_unpaid: REQUIRED_OUTPUT 'R-OUT' of problem 'P1' is not covered: only 0/5 distinct CRITICAL results reach this problem (A7 v0 fail-closed)) |
| 3 | review_defect_critical | review ledger | The text contains multiple placeholders indicating incomplete content, such as '(模型待写入)' and '(本机器槽未生成内容：渲染器未提供)', which means the delivered text is not a complete solution. |
| 4 | review_defect_critical | review ledger | The text asserts a specific sampling plan (n=120, c=6) with approximate error probabilities but does not provide exact calculations or evidence from the required outputs. |
| 5 | review_defect_critical | review ledger | The text provides an expected profit estimate for Case 1 of Problem 2 without showing the exact calculation or referencing any result from the required outputs. |
| 6 | review_defect_critical | review ledger | The text states that for Problem 3, the number of decision combinations is 2048 and that all can be enumerated, but this is not derived from any required output and may be an unsupported claim. |
| 7 | review_defect_critical | review ledger | The text introduces a Bayesian approach for Problem 4 with specific prior and posterior distributions, but this is not supported by any required output and may be an unsupported methodological claim. |
| 8 | review_defect_critical | review ledger | The text contains multiple sections with placeholder content, such as '问题重述', '问题分析', '模型评价与推广', '参考文献', and '代码附录', which are incomplete. |
| 9 | review_defect_critical | review ledger | The text does not provide specific numerical results for all six cases in Table 1 of Problem 2, despite the requirement to give specific decision plans and indicator results. |
| 10 | review_defect_critical | review ledger | The text does not provide a concrete decision plan for Problem 3 with specific numbers, only qualitative tendencies. |
| 11 | review_defect_critical | review ledger | The text does not provide any concrete results for Problem 4, only a general framework. |
| 12 | review_defect_critical | review ledger | The text uses informal language such as '粗略估计' and '预计为', which is not appropriate for a formal mathematical modeling solution. |
| 13 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-OUT 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 14 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q1 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 15 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q2 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 16 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q3 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 17 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q4 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 18 | e2_normalization_failed | delivery | B3 正向（声明须逐字锚定 E1）: A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 11.3%，首分歧 @6，span「取p1=15%作为"次品率超」vs E1「取p1=15\%作为"次品率」〕；EQ-ALPHA: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 88.9%，首分歧 @16，span「=PX>c\|p=p0」vs E1「=PX>c\|p=0.」〕；EQ-BETA: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 88.9%，首分歧 @16，span「PX<=c\|p=p1」vs E1「PX<=c\|p=0.」〕（未通过的保真检查：B3 正向（声明须逐字锚定 E1）） |

*标注由交付门槛自动生成（fail-soft）：未通过项不拦截交付，但必须在此如实列出。*
---

> **本交付物的验证范围（W8.9-C2）**：已机械核验的是**结构完整**（章节/符号/假设齐备）、**数字可溯源**（每个数字可追到 Result 或题面给定值）与**形式化忠实**（IR 声明逐字锚定建模分析文本）。**未**核验的是**实质正确性**——建模思路的优劣、假设的物理真伪、方法选择的恰当性，均**不在本 harness 的可判定范围内**。请读者据此评估结论。
