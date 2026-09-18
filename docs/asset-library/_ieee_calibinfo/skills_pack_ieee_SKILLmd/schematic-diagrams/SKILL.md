---
name: schematic-diagrams
description: Create paper illustrations — overview/method/framework/data-flow schematics and stripped-down architecture/flow diagrams — as caption-friendly vector graphics (HTML+PDF, TikZ, or Mermaid). Use when the user asks for a method overview figure, pipeline, architecture/flowchart, or a schematic for a paper. Self-contained guideline; generated diagrams are produced by the agent, no external assets needed.
argument-hint: [diagram-spec]
---

# 论文示意图 / 流程图

输入：示意图需求（内容要点、层次、约束）；输出：可直接嵌入论文的矢量示意图（PDF/SVG/PNG 高分辨率）与源。

## 1. 类型与工具（都由 agent 执行，免外部文件）
- **概览/方法示意（overview）**：美化解剖图 → TikZ 或 HTML+CSS 再矢量导出 PDF。
- **流程/数据流（flow / pipeline）**：节点+箭头，表达阶段与数据出入 → Mermaid 或 HTML 模板 → PDF。
- **架构/层级（framework / roadmap）**：分块分层表达方法组成或研究主线 → 表格化 box 布局 → PDF。

## 2. 设计规范
- 每个节点文本 ≤8 词；箭头有方向语义；分层用背景框区分。
- 符号与正文一致：论文里定义的变量/开关（如收缩映射、规范化坐标）在图里用同一命名。
- 一图一主旨；流程步骤不要堆叠进一张超大图——主线一张，分支可拆子图。
- 字体/字号与正文图一致（≥8pt），颜色沿用论文统一 palette。

## 3. 校验
- 渲染后检查：节点不重叠、文字不截断、层次不漏、箭头不绕错、无乱码。
- 图中出现的每个符号都在正文或图注中有定义。
- 导出为矢量 PDF（或 ≥300dpi 的图），给出 `\.includegraphics` 建议宽度。

## 4. 交付
- 示意图源与 PDF、与该图对应的图注文案、投 IEEE 图宽建议（双栏示意多用 1 栏或 2 栏跨栏）。