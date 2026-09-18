---
name: literature-novelty
description: Research related work, verify citation authenticity, and check whether an idea/results are novel against recent literature before submission. Use when the user asks for a literature review (文献综述), needs to fetch/verify papers, or wants a novelty check (查新). Self-contained; uses the agent's web/search and the user's citation list. No external library required.
argument-hint: [topic-or-bibkeys]
---

# 文献综述 · 引用核验 · 查新

输入：研究主题 / 关键词/引用键列表；输出：分主题文献综述、引用真实性核验表、novelty 判定。

## 1. 文献综述（literature review）
1. 按主题分簇，优先一级来源（期刊/会议原始论文、官方数据库 DOI）而非二手转述。
2. 检索时按 venue 分级从权威源往下（工程领域可优先 IEEE Xplore/ScienceDirect/ACM/Springer，再到泛网）。
3. 每条综述给：主题归属、贡献一句话、与本方法/结果的关系（承接/对比/空白）。
4. 输出：分簇综述 + 每簇 1–3 篇代表文献 + 关系说明。

## 2. 引用真实性核验（anti-fake citation）
- 逐条核验：标题/作者/年份/venue/DOI 是否真实存在、能够检索到。
- 无 DOI 与不可核验的条目：标注"无法核验"，倾向丢弃而非保留。
- 不添加猜测 DOI；引用键与测绘条目一一对应。
- 输出核验表：通过 / 存疑 / 需人工复核。

## 3. 查新（novelty check）
- 用主题短语在权威库检索近期（近 1–3 年）相关工作，判断：同类已办 / 有前导但可差异化 / 无明显前作。
- 给出差异化要点：若他人已办，指出本方法在"目标/机制/数据/评价"维度上的不同。
- 输出：novelty 结论 + 最接近的相关工作清单 + 差异化论证。

## 4. 交付
- 综述、核验表、查新结论三部分；标注需人工确认的条目。