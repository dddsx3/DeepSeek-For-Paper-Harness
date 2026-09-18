---
name: research-claim-audit
description: After experiments finish, judge which claims the results actually support, which they do not, and what evidence is still missing; then audit papers for provable, consistency, and honest-wording issues. Use when the user says "analyze results", "result to claim", "does my result support this claim", "check wording/可复现性/防伪", or before writing/turning in a paper. Self-contained; verification is performed by the agent with plain Python over the supplied numbers.
argument-hint: [results-or-paper-path]
---

# 结果→声明审计 与 论文可复现/防伪审计

输入：实验数值 / 论文正文；输出：声明判断结论 + 审计报告（支持/不支持/缺证据），以及逐条修改建议。

## 1. 结果支持度判断（result→claim）
- 对每条主张，定位支撑它的结果条目；判断：`supported` / `partial` / `unsupported` / `missing evidence`。
- 区分"主结果"与"仅证明/仅一致性"号次；不再把置信度低的号次当 headline（例：某参数改正后不再显著，则必须降级仅作 provenance，严禁作为主打结论）。
- 指明还缺哪些消融/对照/鲁棒性证据，并判定下一步是 `supplement` / `pivot` / `confirm`。

## 2. 一致性审计（内联规则，agent 用普通 Python 复核数值）
- 数值可追溯：正文每个数字能从来源结果复制并回溯；无凭印象虚构。
- 声明-代码一致：结论与实现对应（方法名、公式、开关语义一致）。
- 跨问题/跨表一致：同一定义在文中多次出现的数字一致；表格粗采样值与源结果一致。
- 逻辑一致：判据方向合理（如收缩应减时间、物性变差应加时间，增量加减号方向自洽）。

## 3. 防伪与诚实措辞
- 无人工阻尼/凑数/把失败渲染成成功；对照基线公平（随机对照、控制条件对等）。
- "预检/量级参考"数值必须与正式结果分开标注，不混为正报。
- 引用真实性：参考文献必须真实存在、DOI 有效；无法核验的丢弃。
- 三层守恒/残差等若不成立必须如实报告，不掩盖。

## 4. 输出
- 逐条声明判断表（结论/依据/证据缺口）；所有审计项通过/不通过/待改。
- 不通过项给出精确改法与影响面；修复后原告（人工）复核通过为止。