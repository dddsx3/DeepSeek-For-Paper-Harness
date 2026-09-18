---
name: quality-review
description: Perform an academic writing quality check on a paper/report — word/structure/citation/format issues — and emit a review report with a pass/caution/fail verdict per item. Use when the user says "质量检查", "quality check", "审稿", or wants a manuscript reviewed before submission. Self-contained; reads the provided text and reports findings.
argument-hint: [paper-or-report-path]
---

# 学术写作质量审查

输入：论文/报告正文；输出：结构化审查报告（分类 + 严重度 + 建议）。

## 1. 审查维度（逐项给 通过/需改/失败）
- **字数**：每章篇幅相对约 900 词目标 ±30%；整体是否在投稿要求长度内；是否存在最薄弱章节（字数明显偏低）需要扩写。
- **结构**：摘要→引言→方法→结果→讨论→结论闭环；每章是否只回答一个问题；标题层级是否规范。
- **图表**：图/表序号连续且正文有引导句+一句结论；图表清单与正文一一对应。
- **引用**：所有 `\cite` 有对应条目；所有参考文献被正文引用；元数据（作者/年份/venue）完整；无伪造 DOI。
- **格式**：字体/编号/公式引用（`\eqref`）/页边距规范；无中文残留/无 Word 样式残留（LaTeX 场景）；三楼线表格、图宽是否符合目标 venue。
- **语言**：拼写、时态、单复数、口语化表达；术语与缩写首现全称一致。

## 2. 工作方式
- 先通读，再按上表逐维产出审查报告（可含 file:line）。
- 对每条"需改/失败"给出具体改法与影响面，不泛泛建议。
- 交回后重查已改项，直至达标或用户接受。

## 3. 交付
- 审查报告：分类清单（通过 / 需改 / 失败）+ 严重度 + 每项定位与建议；待人工确认的存疑项单列。