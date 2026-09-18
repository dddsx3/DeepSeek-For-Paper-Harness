---
name: rebuttal
description: Submission rebuttal pipeline — parse external reviewer comments, enforce that each concern is covered and grounded, draft a safe text-only rebuttal within venue limits, and manage follow-up rounds. Use when the user says "rebuttal", "reply to reviewers", "response to reviewers", or has a decision/review to answer. Self-contained; works from the supplied reviews and paper.
argument-hint: [reviews-and-paper-path]
---

# 审稿回复（Rebuttal）

输入：外审意见 + 论文/修改后的材料；输出：条理清晰、篇幅合规、逐点覆盖且有据可依的回复稿，并管理多轮。

## 1. 流程
1. **解析外审**：逐条编号意见，分类——修改请求 / 澄清疑问 / 表示不理解 / 攻击性意见；标注每条严重度与对应论文章节。
2. **覆盖与依据（enforce）**：每一条意见都要有回应（同意+改 / 不同意+明确理由 / 数据不支持则坦陈），回应须能定位到论文的具体证据或改动，不以空话搪塞。
3. **起草回复**：每条用"感谢指出 → 具体回应（引用证据/已改处）→ 变更说明"结构；不超过 venue 回复字/词限制。
4. **多轮管理**：记录轮次、已解决/新增意见、最终版回复；变动同步更新论文。

## 2. 写作守则
- **text-only、安全**：不出现攻击/反讽；对"建议"表示感谢但不无条件照单全收，除非确有改进。
- **grounding**：每处回应给出论文/数据/图表的明确落点，杜绝无出处断言。
- **篇幅与格式**：贴合目标 venue 的字数/格式要求（含 Markdown/纯文本/LaTeX 表格式）。
- 每条意见状态：addressed / will-fix / clarify / rebut-with-evidence。

## 3. 交付
- 按意见编号的回复稿（每条含状态、回应、证据落点、diff 到论文的改动）；每轮结束给用户一致性核对。