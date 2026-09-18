# # 示例论文题目（course-work 题型，T3 最小面适合）

Estimate mean sea-ice thickness.

请给出：mean ic

## 摘要

_(模型待写入)_

## 问题重述

| 要求 | 说明 |
|---|---|
| # 示例论文题目（course-work 题型，T3 最小面适合）

Estimate mean sea-ice thickness.

请给出：mean ice thickness 的估计值（含单位）与一行结论。
## 题型路由（自动）

方法族：F3

T3 固定填充面（回归用）：不读题面，故不参与方法族路由（PRD v2 F2/P0-2）
## 方法族契约 F3(数据驱动/统计)

- 适用判定:题面含回归/时间序列/分类/聚类/假设检验/数据表
- 候选模型集(封闭,只能从中选择,禁止自创):linear-regression / polynomial-regression / logistic-regression / ARIMA / gray-GM(1,1) / regression-tree / random-forest / k-means / hierarchical-clustering / t-test / chi-square-test / ANOVA
- 必需假设:样本独立性、误差分布假设(正态性或明确替代)
- 专项验证:候选模型封闭、残差存在、拟合指标、过拟合告警、数据源引用
- 已知不适用:含物理机理的连续模型(→F1);含离散决策变量(→F2);多准则评价(→F4)
 | REQUIRED_OUTPUT | [R-OUT]

## 问题分析

_(模型待写入)_

## 模型假设

| 假设 | 来源 | 风险 | 可检验 |
|---|---|---|---|
| homogeneous slab | MODELING_CHOICE | MEDIUM | 否 | [ASM-1]

## 符号说明

| 符号 | 含义 | 单位 |
|---|---|---|
| SYM-q | mean_thickness | m | [SYM-q]

## 模型建立与求解

### 结果表（由规范 IR 注入；结论区关键数字必须与此表一致）

| 量名 | 数值 | 单位 | 不确定度 | 来源 |
|---|---|---|---|---|
| mean_thickness | 0.731 | m |  | `RES-OUT` |

### 结论

mean_thickness is 0.731 m

## 模型检验

_(模型待写入)_

## 模型评价

_(模型待写入)_

## 参考文献

_(模型待写入)_

## 代码附录

_(模型待写入)_


---
*机器数字由规范 IR Result 记录渲染；结论数字经槽位或守卫散文注入；图表由固定 harness 渲染器渲染（骨架 v2）。*

> **本交付物的验证范围（W8.9-C2）**：已机械核验的是**结构完整**（章节/符号/假设齐备）、**数字可溯源**（每个数字可追到 Result 或题面给定值）与**形式化忠实**（IR 声明逐字锚定建模分析文本）。**未**核验的是**实质正确性**——建模思路的优劣、假设的物理真伪、方法选择的恰当性，均**不在本 harness 的可判定范围内**。请读者据此评估结论。