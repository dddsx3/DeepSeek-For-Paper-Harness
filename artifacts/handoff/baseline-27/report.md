# 建模分析稿（E1 直通交付）

## 摘要

> **交付说明（诚实标注）**：本稿由模型的建模分析（E1）直接生成——
> 结构化规范化（E2）未通过，故**未经规范 IR 验证**：数字、引用、图表
> 均未逐条溯源。失败原因（引擎原文）：EXECUTE output refused after 7 attempt(s） — last refusal UNKNOWN: provider http 524 <!DOCTYPE html>
> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
> <!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
> <!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
> 未通过的保真检查：parse_failed。
> 请把它当作**素材**而不是成品。

## 问题重述

_（模型待写入）_

## 问题分析

_（模型待写入）_

## 模型假设

| 假设 | 来源 | 风险 | 可检验 |
|---|---|---|---|
| A1-BINOMIAL | The number of defective components in a sample of size n follows a binomial distribution with parameters n and true defe | 未评定 | 未检验 | [A1-BINOMIAL]
| A2-INDEPENDENT | Each component’s defect status is independent of others. | 未评定 | 未检验 | [A2-INDEPENDENT]
| A3-INFINITE-BATCH | The batch size is large enough that sampling without replacement can be approximated by binomial sampling. | 未评定 | 未检验 | [A3-INFINITE-BATCH]
| A4-DEFECT-INDEPENDENT | The defect events of components 1 and 2 are independent. The final product defect given both components are good is inde | 未评定 | 未检验 | [A4-DEFECT-INDEPENDENT]
| A5-PERFECT-INSPECTION | Inspection is perfect: no false positives or false negatives. | 未评定 | 未检验 | [A5-PERFECT-INSPECTION]
| A6-INFINITE-HORIZON | The production process is in steady state; we evaluate expected cost per unit of product sold. | 未评定 | 未检验 | [A6-INFINITE-HORIZON]
| A7-DISASSEMBLY-RECOVERY | Disassembly recovers both components without damage, and they re-enter the process as if they were new (but they have al | 未评定 | 未检验 | [A7-DISASSEMBLY-RECOVERY]
| A8-TREE-STRUCTURE | The assembly process forms a tree where each node (product) is assembled from a set of child nodes (components or semi-f | 未评定 | 未检验 | [A8-TREE-STRUCTURE]
| A9-INDEPENDENT-DEFECTS-MULTI | Defect events at different nodes are independent. | 未评定 | 未检验 | [A9-INDEPENDENT-DEFECTS-MULTI]
| A10-SAMPLING-ESTIMATES | The defect rates are not known true values but are estimated from samples. We can model the uncertainty using the poster | 未评定 | 未检验 | [A10-SAMPLING-ESTIMATES]
| A11-INDEPENDENT-ESTIMATES | The sampling estimates for different components/products are independent. | 未评定 | 未检验 | [A11-INDEPENDENT-ESTIMATES]

## 符号说明

_（符号表由规范 IR 自动生成）_

## 模型建立与求解

[[REQUIREMENT: R-OUT]]

This is a working analysis of the 2024 CUMCM Problem B, “Decision Problems in the Production Process.” The problem asks for a sequence of models: a sampling inspection plan (Question 1), a multi-stage production decision optimization (Question 2), an extension to a general multi-component, multi-stage assembly (Question 3), and finally a re-evaluation of Questions 2 and 3 under the uncertainty introduced by sampling-based defect rate estimates (Question 4). The core of the problem is cost-driven decision making under uncertainty, which naturally falls into statistical hypothesis testing (Question 1) and stochastic dynamic programming or decision tree analysis (Questions 2–4). The registered method family F4 (evaluation/decision with multi-criteria ranking) is not the primary fit here; the problem is fundamentally about optimal stopping/inspection under probabilistic defect rates, which is a discrete optimization/sequential decision problem (F2) combined with statistical inference (F3). However, the routing note requires me to proceed with the analysis as a working note, so I will outline the modeling approach for each sub-question, state assumptions, and describe verification strategies.

[[REQUIREMENT: R-Q1]]

**What the question asks:** Design a sampling inspection plan for a batch of components (part 1 or part 2) with a claimed maximum defect rate (nominal value 10%). The plan must minimize the number of inspected items while satisfying two error-probability constraints: (1) reject the batch with 95% confidence if the true defect rate exceeds 10%; (2) accept the batch with 90% confidence if the true defect rate is at most 10%. The plan must give concrete sample sizes and decision rules for the two scenarios.

**Method family and justification:** This is a classical acceptance sampling problem. The appropriate method is statistical hypothesis testing for a proportion. We can use the exact binomial test or its normal approximation to determine the minimum sample size n and acceptance number c such that the operating characteristic (OC) curve passes through the two required points: (p0 = 0.10, 1−α = 0.90) and (p1 = ?, β = 0.05). The problem states “认定零配件次品率超过标称值” (determine that the defect rate exceeds the nominal value) with 95% confidence, which corresponds to an upper confidence bound or a hypothesis test with significance level α = 0.05 for H0: p ≤ 0.10 vs H1: p > 0.10. The second condition is “在90%的信度下认定零配件次品率不超过标称值” (determine with 90% confidence that the defect rate does not exceed the nominal value), which corresponds to a lower confidence bound or a test with power 0.90 at p = 0.10. However, the two conditions are not symmetric: the first is a consumer’s risk (reject good batch) constraint, the second is a producer’s risk (accept bad batch) constraint. A standard approach is to set two points on the OC curve: (p0 = 0.10, Pa = 0.95) and (p1 = ?, Pa = 0.10) or similar, but the wording suggests we need a one-sided confidence interval approach. I will interpret it as: we want a sampling plan (n, c) such that if we observe x defectives, we reject if x > c. The probability of rejection when p = 0.10 should be ≤ 0.05 (i.e., we wrongly reject a batch with 10% defect rate at most 5% of the time). The probability of acceptance when p = 0.10 should be ≥ 0.90 (i.e., we correctly accept a batch with 10% defect rate at least 90% of the time). But these two conditions are actually the same: if we set α = 0.05 for p = 0.10, then the acceptance probability is 0.95, which satisfies the 90% requirement. The problem likely intends two separate plans: one for the supplier’s claim verification (consumer’s risk) and one for the producer’s own quality assurance. Actually, reading carefully: “(1) 在 95%的信度下认定零配件次品率超过标称值，则拒收” means we want to reject if we are 95% confident that p > 0.10. That is equivalent to a one-sided hypothesis test with H0: p ≤ 0.10, and we reject if the p-value < 0.05. “(2) 在 90%的信度下认定零配件次品率不超过标称值，则接收” means we accept if we are 90% confident that p ≤ 0.10. That is a different condition: it requires that the lower confidence bound for p is ≤ 0.10 with 90% confidence. These two conditions lead to different sample sizes. I will design a sequential sampling plan or a fixed-sample plan that minimizes n while satisfying both constraints. The exact binomial distribution will be used to avoid approximation errors.

[[ASSUMPTION: A1-BINOMIAL]] The number of defective components in a sample of size n follows a binomial distribution with parameters n and true defect rate p.

[[ASSUMPTION: A2-INDEPENDENT]] Each component’s defect status is independent of others.

[[ASSUMPTION: A3-INFINITE-BATCH]] The batch size is large enough that sampling without replacement can be approximated by binomial sampling.

**Model:** For a given n and acceptance number c, the probability of acceptance is Pa(p) = P(X ≤ c) where X ~ Binomial(n, p). Condition (1): We want to reject when we are 95% confident that p > 0.10. This means we need a rule such that if we observe x defectives, the one-sided upper confidence bound for p (with confidence 95%) exceeds 0.10. Equivalently, we reject if the p-value for H0: p ≤ 0.10 is less than 0.05. For an observed x, the p-value is P(X ≥ x | p=0.10). So we reject if P(X ≥ x | p=0.10) ≤ 0.05. This defines a critical value c such that we reject if x > c, where c is the largest integer with P(X > c | p=0.10) ≤ 0.05. Condition (2): We accept when we are 90% confident that p ≤ 0.10. That means the one-sided lower confidence bound for p (with 90% confidence) is ≤ 0.10. For observed x, the lower bound is the solution p_L to P(X ≥ x | p_L) = 0.10. We accept if p_L ≤ 0.10. This condition is more stringent for small x. To satisfy both, we need a plan where the acceptance region (x ≤ c) ensures that for any x in that region, the 90% lower confidence bound is ≤ 0.10, and the rejection region ensures the 95% upper confidence bound > 0.10. The minimal n can be found by searching over n and c. I will compute the exact binomial probabilities and find the smallest n such that there exists an integer c satisfying both: (i) P(X > c | p=0.10) ≤ 0.05, and (ii) for all x ≤ c, the 90% lower confidence bound for p is ≤ 0.10. The lower bound condition is equivalent to: for x = c, the lower bound ≤ 0.10. Because the lower bound increases with x, if it holds at x=c, it holds for all smaller x. So we need the Clopper-Pearson lower bound for x=c to be ≤ 0.10. The Clopper-Pearson lower bound is the solution p_L to P(X ≥ c | p_L) = 0.10. So we need P(X ≥ c | p=0.10) ≥ 0.10? Actually, if p_L ≤ 0.10, then P(X ≥ c | p=0.10) ≥ 0.10. So condition (ii) becomes P(X ≥ c | p=0.10) ≥ 0.10. Combined with (i) P(X > c | p=0.10) ≤ 0.05, we have a window for the tail probability at c. This is a standard acceptance sampling problem with two points on the OC curve: at p=0.10, we want Pa = P(X ≤ c) between 0.90 and 0.95? Wait: P(X ≤ c) = 1 - P(X > c). Condition (i) says P(X > c) ≤ 0.05, so Pa ≥ 0.95. Condition (ii) says P(X ≥ c) ≥ 0.10, which is P(X < c) ≤ 0.90, so Pa = P(X ≤ c) = P(X < c) + P(X=c) ≤ 0.90 + P(X=c). This is not a direct constraint on Pa. Actually, the lower confidence bound condition is not exactly a constraint on the OC curve; it’s a constraint on the post-sample inference. I will implement the exact confidence interval method to find the minimal n. For a given n, I can compute the acceptance set A = {x: lower 90% bound ≤ 0.10} and rejection set R = {x: upper 95% bound > 0.10}. The plan is valid if A and R are disjoint and cover all possible x. The minimal n is the smallest n for which such a partition exists. I will compute this by iterating n from 1 upward.

**Verification:** I will check that the OC curve at p=0.10 gives Pa ≈ 0.95? Actually, the conditions don’t fix Pa exactly; they fix the confidence bounds. I will simulate the sampling plan to confirm the long-run frequency of correct decisions under various true p.

[[REQUIREMENT: R-Q2]]

**What the question asks:** Given defect rates for two components and the final product, and various costs (purchase, inspection, assembly, market price, replacement loss, disassembly cost), decide at each stage: (1) inspect components or not; (2) inspect finished products or not; (3) disassemble defective finished products or not; (4) handle returned defective products by disassembly. The goal is to maximize expected profit per unit or minimize expected cost. The decisions must be made for six specific cost/defect scenarios in Table 1.

**Method family and justification:** This is a sequential decision problem under uncertainty, which can be modeled as a decision tree or a Markov decision process. Since the defect rates are given and constant, we can compute the expected cost/profit for each possible combination of binary decisions (inspect/don’t inspect, disassemble/don’t disassemble). The state space is small: each component can be inspected or not; the final product can be inspected or not; defective products can be disassembled or not. The returned products are just another source of defective products that undergo the same disassembly decision. The optimal policy can be found by enumerating all 2^3 = 8 decision combinations (for components 1 and 2 inspection, final inspection, disassembly) and computing the expected total cost per unit produced, accounting for the flow of materials. Because the process has a loop (disassembly returns components to the inspection stage), we need to solve a set of linear equations for the steady-state expected cost. Alternatively, we can compute the expected cost per unit of finished product that enters the market, considering that some components are discarded and some products are disassembled and recycled. The decision for returned products is identical to the decision for in-house defective products, so we can treat them together.

[[ASSUMPTION: A4-DEFECT-INDEPENDENT]] The defect events of components 1 and 2 are independent. The final product defect given both components are good is independent of component defects.

[[ASSUMPTION: A5-PERFECT-INSPECTION]] Inspection is perfect: no false positives or false negatives.

[[ASSUMPTION: A6-INFINITE-HORIZON]] The production process is in steady state; we evaluate expected cost per unit of product sold.

[[ASSUMPTION: A7-DISASSEMBLY-RECOVERY]] Disassembly recovers both components without damage, and they re-enter the process as if they were new (but they have already been paid for; only their inspection/assembly costs matter).

**Model:** Let the decisions be binary variables: d1, d2 for inspecting component 1, 2; dF for inspecting final product; dD for disassembling defective final products (including returns). The costs are: purchase prices c1, c2; inspection costs i1, i2, iF; assembly cost a; market price P; replacement loss L; disassembly cost D. Defect rates: p1, p2 for components; pF for final product given both components good. If a component is inspected and found defective, it is discarded. If not inspected, it goes into assembly. The final product is defective if either component is defective (and not detected) or both are good but the assembly process introduces a defect. If final inspection is performed, defective products are either discarded or disassembled; if not inspected, all products go to market, and defective ones are returned and incur loss L, then are disassembled (if dD=1) or discarded.

We need to compute the expected number of components used, inspected, discarded, etc., per unit of product sold. Because of the recycling loop, we can set up balance equations. Let’s define the process for one unit of final product demanded (sold). We start by attempting to produce one unit. We purchase components as needed. If we inspect and discard, we need to purchase more. The effective cost per unit sold can be found by considering the probability that a component entering assembly is good. If we inspect, the probability a component is good is 1 (since we discard bad ones), but we pay inspection and may discard some. The expected number of components purchased to get one good component is 1/(1-p) if we inspect. If we don’t inspect, we use one component with defect rate p. Similar logic applies to final product.

I will formulate the expected profit per unit sold as a function of the decisions. Let’s denote the effective cost of providing a good component i as C_i. If d_i = 1 (inspect), C_i = (c_i + i_i)/(1-p_i) because we need 1/(1-p_i) purchases on average to get one good one, and each purchase incurs cost c_i + i_i. If d_i = 0, C_i = c_i, but the component has defect rate p_i. Then the assembly stage receives two components with effective defect rates p1' = 0 if d1=1 else p1, and p2' similarly. The probability that the assembled product is defective is p_asm = 1 - (1-p1')(1-p2')(1-pF). If we do not inspect final product (dF=0), all products go to market. The expected revenue per unit assembled is P - p_asm * (L + cost of handling return). The return handling: if dD=1, the defective product is disassembled, costing D, and the components are fed back into the process. This effectively reduces the net cost of components because we recover them. If dD=0, the defective product is discarded, and we lose the components. So the expected cost per unit assembled must account for the recovery value. This can be solved by writing the expected total cost of producing one unit that eventually reaches the customer (either directly or after some disassembly cycles). Because disassembly returns components to the start, we can think of the process as a Markov chain where a unit in assembly can either succeed (go to market) or fail (be disassembled or discarded). If disassembled, the components re-enter the component pool, effectively reducing the number of new components needed. The expected number of times a component is used can be computed via geometric series.

Let’s define the expected cost of the components and assembly per “attempt” to produce a unit. Let C_comp be the expected cost of the two components used in one assembly attempt, given the inspection decisions. If we inspect, we pay for good components only; if not, we pay for all. Let p_attempt be the probability that an attempt results in a defective product (before final inspection). If we do final inspection and disassemble, a defective attempt incurs cost D and then the components are reused, so the expected number of attempts to get one good product (if we only ship good ones) is 1/(1-p_attempt) if we disassemble, but we also have the option to discard defective ones, which would require new components. Actually, if we disassemble, the components are not lost; we only pay the disassembly cost and then reassemble. So the expected cost per good product shipped is: C_comp + a + (p_attempt/(1-p_attempt)) * D, if we disassemble all defective attempts and never discard components. If we discard defective attempts, the cost per good product is (C_comp + a)/(1-p_attempt). If we do not inspect final product, we ship all attempts, and the expected cost per shipped product is C_comp + a + p_attempt * (L + handling), where handling is either D (if disassemble returns) or 0 (if discard returns). But returns also provide components back, so we need to be careful.

I will set up a system of equations for the expected total cost of delivering one unit to the customer, considering the infinite loop. Let V be the expected total cost (negative profit) per unit sold. We can write V in terms of the costs of one pass through the system and the expected future costs if the product is defective and disassembled. This is a standard absorbing Markov chain with “sold” as absorbing state. The expected cost satisfies:

If dF=1 (inspect final):
- With probability (1-p_asm), product is good: we pay C_comp + a + iF, and ship, earning P.
- With probability p_asm, product is defective: we pay C_comp + a + iF. Then if dD=1, we pay D and the components are returned to the pool, so we effectively restart the process, but we already have the components? Actually, disassembly recovers the components, so we don’t need to purchase new ones; we just need to reassemble them. However, the components might have been inspected originally; if we inspected them, they are known good. But after disassembly, do we need to re-inspect? The problem says: “对拆解后的零配件，重复步骤(1)和步骤(2)”, meaning we repeat the decision process for components and final product. So we can choose to re-inspect or not. But if we originally inspected and they were good, they remain good (assuming no damage). So we could skip re-inspection. The decision variables d1, d2 apply to the components at the point they enter assembly. For recovered components, we can apply the same policy. To simplify, I will assume that the policy is stationary: the same inspection/disassembly decisions apply to all components, whether new or recovered. Then the expected cost V satisfies a Bellman equation.

Let’s define the state as having a set of components ready for assembly. Since components are always paired, we can think of the process as: we need two components. We can obtain them by purchasing (and possibly inspecting) or from disassembly. The expected minimum cost to obtain a pair of components ready for assembly, given the policy, can be computed. Let C_pair be the expected cost of getting one pair of components to the assembly stage, accounting for possible inspection and discarding. If we never disassemble, C_pair = C1 + C2, where C_i is as defined earlier. If we disassemble, then when a defective product is disassembled, we recover the pair, so we only need to pay the disassembly cost D and then we have a pair again. This means the effective cost per pair used in an assembly attempt is not the full purchase cost, but rather a fraction of it, because pairs are reused. Specifically, let C_attempt be the expected cost of one assembly attempt (components + assembly + inspection). If the attempt fails and we disassemble, we pay D and get another attempt with the same components. So the expected total cost until we get a good product (if we only ship good ones) is C_attempt + p_asm * (D + C_attempt + p_asm * (D + ...)) = (C_attempt + p_asm * D) / (1 - p_asm). Here C_attempt includes the cost of the components used in the first attempt. But if we reuse components, the subsequent attempts do not incur the component purchase cost again; they only incur assembly and inspection costs. So we need to separate component cost from per-attempt cost. Let C_comp be the cost of the components for one attempt (purchase + inspection). Let C_asm = a + iF (if final inspection) or just a (if not). Then if we disassemble, the total cost for a sequence of attempts until success is: C_comp + C_asm + p_asm * (D + C_asm + p_asm * (D + C_asm + ...)) = C_comp + (C_asm + p_asm * D) / (1 - p_asm). If we do not disassemble, the cost per success is (C_comp + C_asm) / (1 - p_asm) because each attempt uses new components.

If we do not inspect final product (dF=0), we ship all attempts. Then the expected revenue per attempt is P - p_asm * L. For returned defective products, we apply the same disassembly decision. If we disassemble returns, we recover components, which can be used to offset future component purchases. This creates a feedback loop. Let’s define the net cost per unit assembled and shipped, considering that returned products provide components. Let N be the number of units assembled per unit sold. Since we ship all, N=1. But some sold units are returned, providing components. The expected number of components recovered per unit sold is p_asm * (2 if we disassemble, else 0). These recovered components reduce the need to purchase new ones. So the effective purchase cost per unit sold is reduced. We can write the material balance: total components purchased = components used in assembly - components recovered from returns. Since each assembly uses 2 components, and we assemble 1 unit per sold unit, we use 2 components per sold unit. Recovered components = 2 * p_asm * I(dD=1). So net purchased components = 2 - 2 p_asm I(dD=1). But this ignores the fact that recovered components might need re-inspection. If we re-inspect, we might discard some. So it’s simpler to write the expected total cost V as the solution to:

V = C_comp + C_asm - P + p_asm * [ L + (if dD=1 then D + V' else 0) ] + (1-p_asm)*0,
where V' is the expected future cost after disassembly. But after disassembly, we have two components ready for assembly again, so the process repeats. If the policy is stationary, V' = V - (cost of components? Actually, V includes the cost of components. After disassembly, we already have components, so we don’t need to purchase them again. So V' should be the cost from the assembly step onward, given we have components. Let’s split V into component acquisition cost and assembly-to-sale cost. Let V_comp be the expected cost to acquire a pair of components (net of recoveries). Let V_asm be the expected cost from assembly to sale, given a pair of components. Then V = V_comp + V_asm.

V_asm = a + iF (if dF=1) + (1-p_asm)*0 + p_asm * [ (if dF=1 then (if dD=1 then D + V_asm else 0) else (L + (if dD=1 then D + V_asm else 0)) ) ].
Wait, if dF=0, we don’t pay iF, but we ship the defective product and incur L, then if we disassemble the return, we pay D and get components back, which means we can subtract the component acquisition cost from future units? Actually, the returned product gives us a pair of components, which we can use for the next assembly, saving V_comp. So the net cost after return is L + D + V_asm - V_comp? That would double-count. Better to write the total expected cost per unit sold from scratch, considering the loop.

Let’s define the expected total cost of delivering one good product to the customer (or one product shipped, if we don’t inspect). We start with no components. We purchase components according to policy. We assemble. If we inspect and it’s good, we ship and done. If it’s bad, we either discard or disassemble. If we disassemble, we have components and go back to assembly step. If we ship without inspection, we may get a return, which gives us components and we go back to assembly. So the process is a cycle: assembly -> inspection/shipping -> possible return -> disassembly -> assembly. The expected cost can be computed by considering the expected number of times we go through the assembly step, and the expected number of component sets we purchase.

Let’s denote by p_good the probability that an assembly attempt yields a product that is either good (if we inspect) or shipped and not returned? Actually, if we don’t inspect, all attempts are shipped, but some are returned. The return is not a “failure” of the attempt; it’s a subsequent event. So it’s easier to model the flow of one unit from initial purchase to final acceptance by customer (no return). The customer accepts a product if it is good; if it’s bad, they return it, and we must provide a replacement. The replacement process is identical to the original process. So the total expected cost to satisfy one customer demand is the cost of the first attempt plus the expected cost of handling returns. This is a geometric series if the probability of return is constant. Let p_return be the probability that a shipped product is returned. If we inspect final, p_return = 0 because we only ship good ones. If we don’t inspect, p_return = p_asm. For each returned product, we incur L, and then we have the option to disassemble. If we disassemble, we pay D and recover components, which can be used to satisfy the replacement demand. So the replacement cost is not the full V, but V minus the cost of components we would have otherwise purchased. Let’s define C_comp as the expected cost of purchasing and inspecting one set of components (for one assembly attempt). If we disassemble returns, each return provides one set of components, so we only need to purchase new components for the first attempt and for any returns that we do not disassemble (or if we discard). Actually, if we always disassemble returns, then every return gives us a set of components, which exactly offsets the need for one new set. So the net number of component sets purchased per customer satisfied is 1 (the first one) if we never discard components? But wait: if we inspect components and discard defective ones, the number of components purchased to get one good set is more than 1. That factor is already in C_comp. The recovery of a good set from a return means we don’t need to purchase another good set. So the expected number of good sets we need to purchase from outside is 1 (for the first customer) + (number of returns that are not recovered as good sets). If we disassemble a return, we get the components back; but those components were originally good (since the product was assembled from good components? Not necessarily: if we didn’t inspect components, the returned product might have defective components. If we disassemble it, we get those components back, and if we then inspect them, we might discard some. So the recovery value depends on the inspection policy.

This is getting complex. A robust approach is to formulate the problem as a Markov decision process (MDP) with states representing the inventory of components? But there is no inventory; it’s a just-in-time system. We can instead compute the expected total cost per unit of demand by solving a system of linear equations for the expected cost starting from each possible state of having 0, 1, or 2 components? Actually, since components are always used in pairs, we can think of the state as “need to produce one unit.” The actions are the decisions. The transition probabilities are determined by defect rates. Because the state space is tiny (just the need to produce one unit, possibly with some components already available from a return), we can write the expected cost V as:

V = min over decisions of [ expected cost of one attempt + expected future cost ].

But since the decisions are fixed for a scenario, we can just compute the expected cost for a given decision vector by solving the linear equations. Let’s define:

Let x be the expected total cost to fulfill one customer demand from scratch (no components on hand).
Let y be the expected total cost to fulfill one customer demand given we already have a pair of components (e.g., from a disassembly) that are at the assembly stage, before any inspection of those components? Actually, after disassembly, we have the components, but we may choose to inspect them or not according to our policy. So y is the cost from the point of having a pair of components ready for the assembly decision.

We can write equations for x and y in terms of the decisions.

First, compute the cost of acquiring a pair of components from scratch, given inspection decisions. Let’s denote the effective cost per component i as:
If d_i = 1: we purchase and inspect. The expected number of purchases to get one good component is 1/(1-p_i). Each purchase costs c_i + i_i. So cost per good component = (c_i + i_i)/(1-p_i). This good component is then ready for assembly.
If d_i = 0: we purchase one component at cost c_i, and it has defect rate p_i. We do not inspect, so it goes directly to assembly.

Thus, the cost of a pair of components from scratch is C_pair = cost1 + cost2, where costi = (c_i + i_i)/(1-p_i) if d_i=1 else c_i. And the probability that component i is actually good when it enters assembly is q_i = 1 if d_i=1 else 1-p_i.

Now, given a pair of components (with goodness probabilities q1, q2), we assemble. The assembly cost is a. The probability the assembled product is defective is p_asm = 1 - q1*q2*(1-pF). Note: pF is the defect rate given both components are good. So if a component is bad, the product is definitely defective.

Now, if we inspect final product (dF=1): we pay iF. If the product is good (prob 1-p_asm), we ship and receive P, and the process ends. If defective (prob p_asm), we have a defective product. If we disassemble (dD=1), we pay D and recover the components. The recovered components have the same quality as they had before assembly? If we originally inspected them, they were good, so they remain good. If we didn’t inspect, they have the same defect probabilities q1, q2? Actually, if the product is defective, it could be due to a bad component or assembly defect. If we disassemble, we get the components back in their original condition (the problem says “拆解过程不会对零配件造成损坏”). So their defect status is unchanged. Therefore, after disassembly, we have a pair of components with the same q1, q2. So we are back to the state of having a pair of components ready for assembly. Thus, the expected cost from that state is y. So if we inspect and disassemble, the expected cost given we have a pair is:
y = a + iF + (1-p_asm)* (-P) + p_asm * (D + y).
Solving: y = [a + iF - (1-p_asm)P + p_asm D] / (1 - p_asm).

If we inspect final but do NOT disassemble (dD=0), then defective products are discarded. We lose the components. So we need to start over from scratch. Thus:
y = a + iF + (1-p_asm)*(-P) + p_asm * x.
And x = C_pair + y? Wait, x is the cost from scratch, which includes acquiring components and then assembling. So x = C_pair + y (if we always need to acquire components before assembly). But if we disassemble, we might not need to acquire components again. So we have:
x = C_pair + y, where y is the expected cost from the point of having components.
If dD=0, then y depends on x, so we substitute:
y = a + iF - (1-p_asm)P + p_asm x
=> x = C_pair + a + iF - (1-p_asm)P + p_asm x
=> x = (C_pair + a + iF - (1-p_asm)P) / (1 - p_asm).

If we do NOT inspect final product (dF=0): we ship all assembled products. We pay a (no iF). We receive P for each shipped product. With probability p_asm, the product is defective and will be returned, incurring loss L. Then we must handle the return. If we disassemble returns (dD=1), we pay D and recover components, so we are back to having a pair (state y). But note: the return happens after the sale, so the timing is different. The expected cost from having a pair and shipping without inspection is:
y = a + (1-p_asm)*(-P) + p_asm * ( -P + L + D + y? Wait, careful: If we ship, we get revenue P when we ship. If it’s returned, we have already received P, but then we incur L and we must provide a replacement. The replacement process is exactly the same as fulfilling a new demand, but we already have components from the return. So the expected future cost after a return is y (since we have components). However, we also have the loss L and disassembly cost D. So the net expected cost from the point of having components is:
y = a - P + p_asm * (L + D + y).
Solving: y = (a - P + p_asm (L + D)) / (1 - p_asm).

If we do not disassemble returns (dD=0), then after a return we incur L and discard the product, so we lose the components and must start from scratch (state x). So:
y = a - P + p_asm * (L + x).
And x = C_pair + y.
Substitute: x = C_pair + a - P + p_asm (L + x)
=> x = (C_pair + a - P + p_asm L) / (1 - p_asm).

These formulas cover all combinations. Note that if we inspect final and disassemble, x = C_pair + y, but y does not depend on x, so x = C_pair + [a + iF - (1-p_asm)P + p_asm D] / (1 - p_asm). If we inspect final and don’t disassemble, x = (C_pair + a + iF - (1-p_asm)P) / (1 - p_asm). If we don’t inspect final and disassemble returns, x = C_pair + (a - P + p_asm (L + D)) / (1 - p_asm). If we don’t inspect final and don’t disassemble, x = (C_pair + a - P + p_asm L) / (1 - p_asm).

But wait: in the case where we don’t inspect final and disassemble returns, the formula y = (a - P + p_asm (L + D + y)) assumes that when a return happens, we disassemble and then use the components to satisfy the replacement demand, and we don’t need to purchase new components. That is correct. However, the initial demand required purchasing components (C_pair). So x = C_pair + y. That seems right.

But there is a subtlety: when we disassemble a return, we get components back. Do we need to inspect them again? The problem says “重复步骤(1)和步骤(2)”, meaning we repeat the decision process. Our policy d1, d2 specifies whether we inspect components. If d1=1, we will inspect the recovered component 1. But if it was originally good, it will pass inspection. If it was originally bad (because we didn’t inspect it initially), then inspection will catch it and we discard it, forcing us to purchase a new one. So the effective quality of recovered components depends on whether we originally inspected them. In our state definition, we said the recovered components have the same q1, q2 as before assembly. But if we then apply the inspection policy, the cost to turn those recovered components into assembly-ready components is not zero if we inspect them and they might be bad. Actually, our C_pair already includes the cost of inspection and possible rejection. If we have a component with defect probability q, and we decide to inspect it (d=1), the expected cost to make it assembly-ready is: if it’s good (prob 1-q), we just pay inspection cost i; if it’s bad (prob q), we discard it and must purchase a new one, which costs (c + i)/(1-p) on average? Wait, if we have a component on hand, we can inspect it. If it’s good, we use it. If it’s bad, we discard it and then we need to acquire a good one from the market, which costs (c+i)/(1-p). So the expected cost to get one good component starting from a recovered component is: i + q * (c+i)/(1-p). But if we don’t inspect (d=0), we just use it as-is, cost 0. So the value of a recovered component depends on our policy. This means our previous assumption that after disassembly we are in state y with the same q1, q2 is not accurate if we then apply inspection to those components. We need to incorporate the inspection decision into the transition from “having a recovered component” to “having an assembly-ready component.”

To handle this cleanly, let’s define the expected cost to obtain an assembly-ready component i, starting from nothing, as C_i^new. And the expected cost to obtain an assembly-ready component i starting from a recovered component of unknown quality (but with the same defect rate as the original stream) as C_i^rec. If the policy is to inspect recovered components, then C_i^rec = i_i + p_i * C_i^new? Actually, if we inspect a recovered component, we pay i_i. With probability 1-p_i it’s good and we use it. With probability p_i it’s bad, we discard it, and then we need to get a new one, which costs C_i^new. So C_i^rec = i_i + p_i * C_i^new. If we do not inspect recovered components, C_i^rec = 0, but the component has defect rate p_i. Note that C_i^new itself is: if d_i=1, C_i^new = (c_i + i_i) + p_i * C_i^new? Actually, to get one good component by inspecting purchases: we buy one, inspect (cost c_i+i_i). If good (prob 1-p_i), done. If bad, we discard and repeat. So C_i^new = c_i + i_i + p_i * C_i^new => C_i^new = (c_i + i_i)/(1-p_i). If d_i=0, C_i^new = c_i, and we don’t inspect, so the component has defect rate p_i.

Now, for a pair of components from scratch, the cost is C_pair_new = C_1^new + C_2^new. The probability that component i is good when entering assembly is q_i = 1 if d_i=1 else 1-p_i.

When a defective product is disassembled, we recover two components. Their quality is the same as the quality of the components that entered that assembly attempt. If we inspected them originally, they were good, so q_i=1, meaning the recovered components are definitely good. If we didn’t inspect, they have defect rate p_i. So the expected cost to turn these recovered components into assembly-ready components is C_1^rec + C_2^rec, where C_i^rec depends on whether we inspect recovered components. But note: our policy might be to inspect new components but not recovered ones? The problem says “重复步骤(1)和步骤(2)”, which I interpret as applying the same decision rules to the recovered components. So if d_i=1, we inspect both new and recovered components. If d_i=0, we inspect neither. So C_i^rec is determined by d_i. If d_i=1, C_i^rec = i_i + p_i * C_i^new. But wait: if the recovered component came from an assembly where we had inspected components, then p_i=0 for that component, so C_i^rec = i_i. If we didn’t inspect, p_i is the original defect rate. So the cost to reuse components depends on the history. This suggests we need to track the quality of the components we have. However, because the process is memoryless in terms of defect rates (the defect rate of a component is either 0 if it was inspected and passed, or p_i if it was not inspected), we can define two types of component states: “known good” (inspected) and “unknown” (not inspected). But if we always inspect, all components in the system are known good. If we never inspect, all are unknown. If we inspect new but not recovered? That would be a different policy, but the problem says repeat steps, so the policy is consistent. Therefore, the quality of components in the system is homogeneous: either all are known good (if d_i=1) or all have defect rate p_i (if d_i=0). Because if we inspect, we discard bad ones, so only good ones circulate. If we don’t inspect, bad ones circulate. So we don’t need to track mixed qualities. This is a key insight.

Thus, if d_i=1, then every component in the system is good. So q_i = 1, and C_i^new = (c_i+i_i)/(1-p_i), C_i^rec = i_i (since p_i=0 for recovered components? Actually, if we always inspect, recovered components are good, so inspecting them costs i_i and they always pass, so C_i^rec = i_i). If d_i=0, then every component has defect rate p_i, q_i = 1-p_i, C_i^new = c_i, C_i^rec = 0 (since we don’t inspect).

Now we can write the equations for x (cost from scratch) and y (cost from having a pair of components that are ready for assembly? Actually, after disassembly, we have components, but we might need to pay C_i^rec to make them assembly-ready. So let’s define state S1: we have a pair of components that have been recovered but not yet processed according to policy. The cost to go from S1 to having an assembly-ready pair is C_rec = C_1^rec + C_2^rec. Then we proceed to assembly. So the expected cost from S1 is C_rec + y, where y is the expected cost from having an assembly-ready pair.

Let’s redefine y as the expected cost from the point of having an assembly-ready pair (i.e., components are ready to be assembled, with quality q1, q2). Then:
If we inspect final (dF=1):
y = a + iF + (1-p_asm)*(-P) + p_asm * [ if dD=1 then D + C_rec + y else x ]
If we don’t inspect final (dF=0):
y = a - P + p_asm * [ L + (if dD=1 then D + C_rec + y else x) ]

And x = C_pair_new + y.

Note that if dD=0, the defective product is discarded, so we lose the components and must start from scratch (state x). If dD=1, we disassemble, pay D, then we have recovered components, which cost C_rec to make assembly-ready, and then we are back to y.

Now we can solve these linear equations for x and y. Since y appears on both sides when dD=1, we can isolate y.

Case 1: dF=1, dD=1.
y = a + iF - (1-p_asm)P + p_asm (D + C_rec + y)
=> y (1 - p_asm) = a + iF - (1-p_asm)P + p_asm (D + C_rec)
=> y = [a + iF - (1-p_asm)P + p_asm (D + C_rec)] / (1 - p_asm)
Then x = C_pair_new + y.

Case 2: dF=1, dD=0.
y = a + iF - (1-p_asm)P + p_asm x
x = C_pair_new + y
=> x = C_pair_new + a + iF - (1-p_asm)P + p_asm x
=> x = (C_pair_new + a + iF - (1-p_asm)P) / (1 - p_asm)

Case 3: dF=0, dD=1.
y = a - P + p_asm (L + D + C_rec + y)
=> y (1 - p_asm) = a - P + p_asm (L + D + C_rec)
=> y = [a - P + p_asm (L + D + C_rec)] / (1 - p_asm)
x = C_pair_new + y.

Case 4: dF=0, dD=0.
y = a - P + p_asm (L + x)
x = C_pair_new + y
=> x = (C_pair_new + a - P + p_asm L) / (1 - p_asm)

In all cases, the expected profit per unit sold is -x (since x is expected total cost, and revenue P is already included as negative cost). We want to maximize profit, i.e., minimize x.

Now we need to compute p_asm. p_asm = 1 - q1 * q2 * (1-pF). Where q_i = 1 if d_i=1, else 1-p_i.

Also, C_pair_new = C1_new + C2_new.
C_i_new = (c_i + i_i)/(1-p_i) if d_i=1, else c_i.
C_i_rec = i_i if d_i=1, else 0. (Note: if d_i=1, recovered components are good, so inspection cost i_i is paid and they pass; if d_i=0, we don’t inspect, cost 0.)

This model is complete and consistent. It accounts for the loop and the inspection of recovered components correctly.

**Decision enumeration:** For each of the 6 scenarios in Table 1, we have 3 binary decisions (d1, d2, dF) and dD is also binary, but note that dD only matters if there are defective products. We can enumerate all 2^4 = 16 combinations, compute x for each, and select the one with minimum x (maximum profit). We must also consider that some decisions might be trivially suboptimal, but enumeration is safe.

**Verification:** I will compute the expected profit for each decision combination and verify that the optimal policy makes intuitive sense (e.g., inspect if inspection cost is low relative to defect rate and downstream costs). I will also check that the formulas reduce to simple cases (e.g., if all defect rates zero, profit = P - (c1+c2+a+iF) etc.). I will also compute key indicators like the effective defect rate of shipped products, the proportion of components discarded, etc., as required by “指标结果”.

[[REQUIREMENT: R-Q3]]

**What the question asks:** Extend the decision model to m processes and n components, with a given assembly structure (Figure 1 shows 2 processes, 8 components, with intermediate semi-finished products). The defect rates and costs are given in Table 2. We need to provide the optimal decision scheme (inspect or not at each stage, disassemble or not) and the corresponding indicators.

**Method family and justification:** This is a generalization of the two-component model to a multi-stage assembly network. The same principles apply: we have a tree-structured assembly process. Each node (component, semi-finished product, final product) has a defect rate, and we can decide to inspect at each input and output. The disassembly decision applies to defective final products (and possibly semi-finished products? The problem says “对检测出的不合格成品是否进行拆解”, so only final products are disassembled. But in a multi-stage setting, we might also detect defective semi-finished products if we inspect them. The problem statement for Q3 says “重复问题2”, so we assume the same decision types: inspect components, inspect semi-finished/finished products, disassemble defective finished products. The structure in Figure 1 has two semi-finished products (1 and 2) each assembled from 4 components, then the final product is assembled from the two semi-finished products and possibly additional components? Actually, Figure 1 shows 8 components feeding into two semi-finished products (each gets 4), and those two semi-finished products are assembled into the final product. So it’s a two-level assembly.

We can model this as a tree. For each node, we can decide whether to inspect its inputs (components or semi-finished products) and whether to inspect its output. The disassembly decision applies only to the final product. When a defective final product is disassembled, it yields the two semi-finished products (and possibly other components? The figure shows only the two semi-finished products going into the final product). Those recovered semi-finished products can then be re-inspected or reused according to policy. This creates a feedback loop similar to Q2 but with more levels.

[[ASSUMPTION: A8-TREE-STRUCTURE]] The assembly process forms a tree where each node (product) is assembled from a set of child nodes (components or semi-finished products). Defect rates are given for each node given that its children are all good.

[[ASSUMPTION: A9-INDEPENDENT-DEFECTS-MULTI]] Defect events at different nodes are independent.

**Model:** We can extend the recursive expected cost calculation. For each node k in the tree, we can compute the expected cost to produce one good unit of that node, given the decisions for its subtree. Let V_k be the expected cost to produce one good unit of node k (i.e., one unit that passes inspection if we inspect, or one unit as-is if we don’t inspect). The decisions at node k are: for each child i, whether to inspect it before assembly; whether to inspect the output of node k; and for the final product, whether to disassemble. The disassembly of the final product returns its immediate children (the semi-finished products) to the pool. So we need to compute the effective cost of a returned semi-finished product.

Because the feedback loop only occurs at the top level (final product disassembly), we can solve the system by first computing the cost of each semi-finished product as a function of the decisions within its subtree, assuming no feedback from the top. Then, for the final assembly, we incorporate the feedback of semi-finished products. This is analogous to Q2 but with more complex C_pair_new and C_rec for the semi-finished products.

Specifically, for each semi-finished product j, we can compute its “new” cost C_j^new (cost to produce one unit from scratch, given decisions in its subtree) and its “recovery” cost C_j^rec (cost to process one recovered unit of j into an assembly-ready unit). The quality of a recovered unit depends on whether we inspected its children and itself. If we always inspect at all stages, recovered units are known good. If we skip inspections, they have some defect rate. We can compute the effective defect rate of a semi-finished product produced under a given policy. Let q_j be the probability that a unit of j is good when it enters the next assembly stage. If we inspect j’s output, q_j = 1 (since we discard bad ones). If we don’t inspect, q_j = (1 - p_j) * product over children i of (q_i), where p_j is the defect rate of node j given all children are good, and q_i is the probability child i is good when it enters assembly of j. For components, q_i = 1 if inspected, else 1-p_i.

Then, for the final product F, we have children j=1..J. The assembly cost is a_F, inspection cost i_F, defect rate p_F given children good. The probability F is defective is p_asm_F = 1 - (product over j of q_j) * (1-p_F). The cost of a new set of children is sum_j C_j^new. The cost of a recovered set of children (from disassembling F) is sum_j C_j^rec. Then we can use the same formulas as Q2 to compute the overall expected cost per unit of final product sold, and optimize over the binary decisions at all nodes.

The decision space is larger: for each of the 8 components, we decide inspect or not (8 decisions). For each of the 2 semi-finished products, we decide inspect output or not (2 decisions). For the final product, we decide inspect or not (1 decision) and disassemble or not (1 decision). Total 12 binary decisions, 4096 combinations. We can enumerate or use dynamic programming to find the optimal policy. Since the tree is small, enumeration is feasible.

We must also define the indicators: expected total cost per unit, effective defect rate of shipped products, proportion of components discarded, etc.

**Verification:** I will check that the recursive formulas reduce to the Q2 model when there is only one level. I will also test the optimal policy for Table 2 by computing expected profit and comparing with intuitive benchmarks (e.g., if inspection is cheap, inspect everything).

[[REQUIREMENT: R-Q4]]

**What the question asks:** Re-do Questions 2 and 3 under the assumption that the defect rates (for components, semi-finished products, final products) are not known exactly but are estimated through the sampling inspection method from Question 1. This introduces uncertainty in the defect rates. We need to incorporate this uncertainty into the decision-making process.

**Method family and justification:** This is a decision problem under parameter uncertainty. The defect rates are now random variables with distributions derived from the sampling plan. We need to compute the expected profit integrating over the posterior distribution of defect rates, or use a robust optimization approach. Since the sampling plan in Q1 provides a confidence interval or a point estimate with a certain confidence level, we might use the worst-case or Bayesian expected cost. The problem likely expects us to use the sampling results to update our belief about defect rates and then make decisions that minimize expected cost under the posterior. Alternatively, we could use the confidence bounds from Q1 to construct a robust decision (e.g., guarantee performance at the upper confidence bound). The phrasing “零配件、半成品和成品的次品率均是通过抽样检测方法（例如，你在问题 1 中使用的方法）得到的” suggests that we have performed sampling inspections and obtained estimates (possibly with confidence intervals). We need to redesign the decision framework to account for estimation uncertainty.

[[ASSUMPTION: A10-SAMPLING-ESTIMATES]] The defect rates are not known true values but are estimated from samples. We can model the uncertainty using the posterior distribution from a Bayesian approach with a non-informative prior, or using the confidence intervals from Q1 as the range of possible true values.

[[ASSUMPTION: A11-INDEPENDENT-ESTIMATES]] The sampling estimates for different components/products are independent.

**Model:** One approach is to treat the defect rates as random variables with distributions derived from the sampling plan. For a given sample size n and number of defectives x, the posterior distribution of p is Beta(x+1, n-x+1) under a uniform prior. Then the expected cost for a given decision is the expectation of the cost function over the joint distribution of all defect rates. Since the cost function is linear in some parts and nonlinear in others (due to ratios like 1/(1-p)), we can approximate by simulation or by discretizing the distribution. Alternatively, we can use a robust approach: for each defect rate, we have a confidence interval from Q1. We can then find the decision that minimizes the maximum expected cost over the confidence intervals (minimax). The problem might expect a simpler approach: use the point estimates (e.g., the observed defect rate in the sample) as the nominal values, but then adjust the decision to be conservative based on the confidence level. For instance, if we are 95% confident that the defect rate is below some upper bound, we might use that upper bound in our cost calculations to ensure we meet a certain reliability.

Given the context of Q1, where we designed a sampling plan with specific confidence levels, it’s natural to use the upper confidence bound for defect rates when we want to be conservative about quality, or the lower bound when we want to be optimistic. The decision in Q2 and Q3 is about cost minimization; using point estimates might lead to overconfident decisions. A Bayesian decision theory approach would compute the expected cost under the posterior and choose the decision that minimizes it. This is the most principled. I will adopt the Bayesian approach: assume we have taken samples according to the Q1 plan, observed some number of defectives, and formed posterior distributions. Then for each decision combination, compute the expected cost by integrating over the posteriors. Since the defect rates are independent, the expectation can be done by Monte Carlo sampling. The optimal decision is the one with minimum expected cost.

For Q2 and Q3, we need to re-evaluate the six scenarios and the multi-stage case with this uncertainty. The sample sizes and observed defectives would need to be specified. The problem doesn’t give specific sample results, so we might need to assume that the sampling was done with the minimal n from Q1, and the observed defect rate equals the nominal value? Or we might need to design the sampling plan and then use the resulting posterior. The problem says “例如，你在问题 1 中使用的方法”, implying we can use our Q1 method. So I will assume that for each component/product, we apply the Q1 sampling plan with the given nominal defect rate (the ones in Table 1 and Table 2) and some assumed observed defect count that is consistent with the nominal rate. For instance, if nominal is 10%, we might observe x = floor(n*0.1) defectives. Then we compute the posterior Beta distribution. Then we optimize decisions.

**Verification:** I will compare the optimal decisions under uncertainty with those under certainty (from Q2/Q3). Typically, uncertainty will make inspection more attractive because it reduces risk. I will check that the expected profit under uncertainty is lower than under certainty, reflecting the cost of uncertainty.

---

**Summary of models and assumptions:**

- Q1: Exact binomial confidence interval-based sampling plan. Assumptions: binomial distribution, infinite batch, perfect inspection.
- Q2: Steady-state expected cost model with feedback loop, solved via linear equations. Assumptions: independent defects, perfect inspection, stationary policy, recovered components homogeneous.
- Q3: Recursive extension of Q2 to tree-structured assembly. Same assumptions.
- Q4: Bayesian decision theory with posterior distributions from Q1 sampling. Assumptions: Beta posteriors, independent estimates.

**Indicators to report:** For each scenario, the optimal decision vector (d1, d2, dF, dD for Q2; extended for Q3), the expected total cost per unit (or expected profit), the effective defect rate of products reaching the market, the proportion of components discarded, etc. The problem asks for “决策的依据及相应的指标结果”, so I will provide the expected profit as the main indicator, along with other operational metrics.

This analysis provides a complete roadmap for solving all four questions. The next step is to implement the computations.## 题型路由（自动）

方法族：F4

方法组件：F4×4，F3×3；主族 F4
## 方法族契约 F4(评价决策)

- 适用判定:题面含多准则评价/排序/方案比较/打分/层次
- 候选模型集(封闭,只能从中选择,禁止自创):entropy / AHP / CRITIC / delphi / TOPSIS / gray-relational / fuzzy-comprehensive / weighted-sum
- 必需假设:指标方向(正向/负向已归一)、权重来源(主观/客观/混合)
- 专项验证:权重方法封闭、聚合方法封闭、权重敏感性(专项)、排序存在且稳健、逆序检验(专项)
- 已知不适用:含回归/检验的统计问题(→F3);连续机理(→F1);离散优化(→F2)


Plan:
1. 识别题型：本题为生产决策优化问题，核心是成本/收益比较与决策，不属于F4评价决策方法族（无多准则排序/打分），应使用优化/概率模型（F2离散优化或F1机理），但按路由要求仅输出执行计划。
2. 问题1：建立基于二项分布/正态近似的抽样检验方案，最小化样本量，满足两类错误概率约束（95%拒收、90%接收），给出标称值10%下的具体抽样数。
3. 问题2：建立各阶段决策的成本收益模型，比较检测/不检测、拆解/不拆解的期望成本，对表1六种情形逐一计算最优决策及指标。
4. 问题3：将问题2模型推广到m道工序、n个零配件的一般装配结构，针对图1和表2计算具体决策方案及指标。
5. 问题4：在问题2和问题3中引入抽样检测得到的次品率不确定性，重新优化决策并给出结果。

Write a modeling analysis in prose (Markdown is fine). This is a working note to yourself — think on paper about how to solve the problem.
Cover, for EVERY sub-question the problem asks: what the question is really asking, which method family fits and why, what the model is, what assumptions you must make, and how you would check the answer.

The harness registered these requirement ids — use them VERBATIM as the anchor ids, one [[REQUIREMENT: ...]] per id:
  - R-OUT
  - R-Q1
  - R-Q2
  - R-Q3
  - R-Q4

Mark each assumption with an inline anchor on its own line: [[ASSUMPTION: <your-short-id>]] followed by the assumption sentence.
  Replace <your-short-id> with a real short id you choose. Do NOT write the literal text "<your-short-id>".
  The id is a NAME that the next step copies VERBATIM into structured records and then references. So it must be a name that can be referenced: use letters, digits, "-" or "_", with no spaces.
  Good: [[ASSUMPTION: A-EXACT-TEST]] · [[ASSUMPTION: A_BATCH_2]]. Bad: [[ASSUMPTION: ...]] (a placeholder names nothing and cannot be referenced), [[ASSUMPTION: A B]] (contains a space).
  Use the same short-id if you restate the same assumption.
Mark the start of each sub-question's reasoning with an inline anchor: [[REQUIREMENT: <id>]], using the requirement ids listed above exactly.
Be concrete about method choices and their justification. Where you must assume something the problem does not give, say so explicitly and mark it.
Do NOT output JSON. Do NOT output a container. Do NOT try to match any schema — that is the next step's job.

BEFORE YOU FINISH, CHECK (the next step refuses an analysis that misses these):
  - the analysis contains the anchor [[REQUIREMENT: R-OUT]] exactly once, on its own line, before that sub-question's reasoning
  - the analysis contains the anchor [[REQUIREMENT: R-Q1]] exactly once, on its own line, before that sub-question's reasoning
  - the analysis contains the anchor [[REQUIREMENT: R-Q2]] exactly once, on its own line, before that sub-question's reasoning
  - the analysis contains the anchor [[REQUIREMENT: R-Q3]] exactly once, on its own line, before that sub-question's reasoning
  - the analysis contains the anchor [[REQUIREMENT: R-Q4]] exactly once, on its own line, before that sub-question's reasoning
  - every assumption you state has an [[ASSUMPTION: <short-name>]] anchor on its own line, written BEFORE the sentence it marks
  - at least one assumption is marked; anchors use real names, never placeholders

## 结果对比与校核

_（本机器槽未生成内容：渲染器未提供）_

## 模型评价与推广

_（模型待写入）_

## AI 声明

_（本机器槽未生成内容：渲染器未提供）_

## 参考文献

_（模型待写入）_

## 数据附录

_（本机器槽未生成内容：渲染器未提供）_

## 代码附录

_（模型待写入）_
---

## 附录：交付标注（自动生成）

本稿以 **MARKED**（标注交付）等级交付：25 项检查未通过。内容照常可用；以下逐项列出未通过项、位置与原因，供复核与改进。

| # | 检查项 | 位置 | 原因 |
|---|---|---|---|
| 1 | critical_gate | delivery | ir_canonicalization:BLOCKED:missing IR backbone: ModelSpec,RunArtifact,Result,Claim; no CRITICAL claim in canonical IR; minimum Problem Contract not satisfied (RAW_PROBLEM DataArtifact + REQUIRED_OUTPUT RequirementSpec + SymbolSpec) |
| 2 | critical_gate | delivery | requirement_coverage:BLOCKED:requirement coverage: 5 finding(s) (required_output_unpaid: REQUIRED_OUTPUT 'R-OUT' of problem 'P1' is not covered: only 0/5 distinct CRITICAL results reach this problem (A7 v0 fail-closed)) |
| 3 | review_defect_critical | review ledger | 「摘要」里有不属于任何 Result/题面数字的数字：'524'——交付稿的结论面只能陈述运行算出来的数字（或题面给定的常数）。把该数字改成绑定 Result 的写法（`{<result_id>}` 由 harness 注入），或让它由代码算出并作为 Result 声明。 |
| 4 | review_defect_critical | review ledger | The delivered text contains a large block of raw engine error output and internal routing/contract text that is not part of the modeling analysis. This is a delivery-blocking data integrity issue. |
| 5 | review_defect_critical | review ledger | The delivered text includes the entire routing/contract specification and plan, which is not part of the required output and indicates a failure to produce a clean modeling analysis. |
| 6 | review_defect_critical | review ledger | The delivered text contains a 'Plan' section that is not part of the required output and includes instructions to the model rather than the modeling analysis itself. |
| 7 | review_defect_critical | review ledger | The delivered text contains a 'Write a modeling analysis...' instruction block that is not part of the required output and indicates the model failed to follow the prompt. |
| 8 | review_defect_critical | review ledger | The delivered text contains a 'BEFORE YOU FINISH, CHECK' instruction block that is not part of the required output and indicates the model failed to follow the prompt. |
| 9 | review_defect_critical | review ledger | The delivered text contains a '## 结果对比与校核' section with placeholder text indicating missing content. |
| 10 | review_defect_critical | review ledger | The delivered text contains a '## 模型评价与推广' section with placeholder text indicating missing content. |
| 11 | review_defect_critical | review ledger | The delivered text contains a '## AI 声明' section with placeholder text indicating missing content. |
| 12 | review_defect_critical | review ledger | The delivered text contains a '## 参考文献' section with placeholder text indicating missing content. |
| 13 | review_defect_critical | review ledger | The delivered text contains a '## 数据附录' section with placeholder text indicating missing content. |
| 14 | review_defect_critical | review ledger | The delivered text contains a '## 代码附录' section with placeholder text indicating missing content. |
| 15 | review_defect_critical | review ledger | The delivered text contains a '## 问题重述' section with placeholder text indicating missing content. |
| 16 | review_defect_critical | review ledger | The delivered text contains a '## 问题分析' section with placeholder text indicating missing content. |
| 17 | review_defect_critical | review ledger | The delivered text contains a '## 符号说明' section with placeholder text indicating missing content. |
| 18 | review_defect_critical | review ledger | The delivered text contains a '## 模型建立与求解' section that includes the entire problem statement and analysis, but the analysis is incomplete and contains internal notes. |
| 19 | review_defect_critical | review ledger | The delivered text contains a '## 模型建立与求解' section that includes the entire problem statement and analysis, but the analysis is incomplete and contains internal notes. |
| 20 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-OUT 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 21 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q1 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 22 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q2 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 23 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q3 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 24 | V4 REQUIRED_OUTPUT 覆盖 | verification | REQUIRED_OUTPUT R-Q4 无任何 CRITICAL 结果链到达(承诺未兑现) |
| 25 | e2_normalization_failed | delivery | model output is not JSON: SyntaxError: Unexpected non-whitespace character after JSON at position 40681 (line 1 column 40682)（未通过的保真检查：parse_failed） |

*标注由交付门槛自动生成（fail-soft）：未通过项不拦截交付，但必须在此如实列出。*
---

> **本交付物的验证范围（W8.9-C2）**：已机械核验的是**结构完整**（章节/符号/假设齐备）、**数字可溯源**（每个数字可追到 Result 或题面给定值）与**形式化忠实**（IR 声明逐字锚定建模分析文本）。**未**核验的是**实质正确性**——建模思路的优劣、假设的物理真伪、方法选择的恰当性，均**不在本 harness 的可判定范围内**。请读者据此评估结论。
