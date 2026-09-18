---
name: en-paper-writing
description: Draft an English research manuscript section by section with publication-quality writing, hourglass structure, and reader-first logic. Use when the user says "write paper", "draft paper", "write the paper in English", or has an outline/results and wants the manuscript written. Fully self-contained; needs only the agent's writing engine and any citations supplied in-context.
argument-hint: [outline-or-notes]
---

# 英文论文写作（reader-first · hourglass）

输入：论文大纲/笔记/结果；输出：结构完整、出版级英文的论文正文（可直接给 LaTeX 或 Markdown 正文章节）。

## 0. 原则（Writing rules）
- **hourglass 结构**：开篇宽（背景+问题）→ 收窄（方法）→ 最窄（单点贡献/结论）→ 再放宽（impact/limitation）。
- **Reader-first**：每段第一句给出该段论点，随后是证据；先给结论再给推导。
- **出版级英文**：客观、精炼、无套话；动词主动、少用 being 化名词；时态规范（方法/结果过去式，普遍真理现在式）。

## 1. 流程
1. 若有大纲/计划，先按大纲确认章节；无则先产出 8–10 节骨架并由用户确认。
2. 逐节起草，核心难写节（方法、结果、讨论）优先。
3. 单一主线：每个 section 只回答一个问题；每句支撑主句。
4. 完成后**最后写摘要**（信息密度最高、不写废话）。
5. De-AI 打磨：去模板腔，加具体量级与数值引用，统一术语与公式编号。

## 2. 章节骨架（通用）
```
Abstract（末写） · Introduction · Related Work · Method ·
Results / Experiments · Discussion / Limitations · Conclusion ·
References（真实文献，禁伪造 DOI）
```

## 3. 写作守则（内联，无需外部文件）
- 摘要：研究动机→方法→关键结果（带数值）→意义；不含引用、不含公式编号。
- 贡献点用短句列 3–5 条可核验项。
- 图表在首次出现处有引导句 + 一句结论（"Fig.1 shows …"）。
- 所有数字来自给定结果，注明来源，**禁止虚构**。
- 公式用 `\begin{equation}`，正文用 `\eqref` 引用，符号前后一致。

## 4. 自我质检（写完后口头执行）
- 结构：摘要→引言→方法→结果→结论是否闭环；每章是否 900 词左右目标的 ±30%。
- 一致性：术语、符号、缩写首次出现时全称一致；贡献点与结论一致。
- 引用：所有 `\cite` 都有条目，参考文献全部正文被引。
- 语言：无口语、无 You/we 滥用、无中文残留。
- 将这些检查结果与正文一并交付，标注待人工确认项。

## 产出
- 可按章节或整体交付的英文论文（正文文本；如需 LaTeX 则含 `\cite`/`\eqref`/图表占位）。
- 附：章节清单、写作守则自检结果、存疑数字列表。