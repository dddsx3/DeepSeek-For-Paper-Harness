---
name: figure-generation
description: Generate publication-quality figures and tables from results data, matching journal-vector standards (SVG/PDF export, print-safe font and line sizes, consistent palette). Use when the user says "generate figures", "make plots", "画图/作图", or needs paper figures. Self-contained; relies on the agent producing matplotlib/Plotly code per these rules — no external template files required.
argument-hint: [results-data-path-or-summary]
---

# 出版级图表生成

输入：结果数据（数值/表格/json/CSV 或摘要）；输出：可直接入论文的矢量图（PDF/SVG）与表格。

## 0. 环境自足
- 用 Python + matplotlib（或等价的 agent 可执行绘图库）；无需任何本技能之外的自定义文件。
- 配色不用默认彩虹表（见 §3 palette）。

## 1. 流程
1. 先产出"图清单"：每张图的类型、用途、数据来源，交人工勾选确认后再画。
2. 逐张用脚本生成矢量图（`pdf`/`svg`），打印式检查通过后进入下一步。
3. 统一风格与字号，最后导出/嵌入论文。

## 2. 图表类型选择（按数据语义）
- 时间/位置曲线 → 折线（多序列用区分布）；分布 → 箱线/提琴；占比 → 堆叠/饼（慎用、<7 类）；趋势 → 折线+置信带；关系 → 散点+拟合；对比 → 并排柱状；单序列 → 山脊/棒棒糖；敏感性 → tornado/heatmap。
- 双面板共用 x 轴、独立 y 轴标签；每张图必须能回答它证明哪一研究环节。

## 3. 视觉规范（内联 palette + 尺寸）
- 语义化 palette（供选用）：
  - `science/engineering`: `['#0072B2','#D55E00','#009E73','#CC79A7','#F0E442','#56B4E9','#000000']`
  - `nature`: 低饱和，如 `['#5B9BD5','#ED7D7D','#70AD47','#FFC000','#A9A9A9']`
  - 无障碍：并在图例加符号/线型区分，不只靠颜色。
- 导出：**线宽 ≥0.9pt，刻度/坐标字号 ≥8pt**，位图 dpi ≥300；优先矢量。
- `figsize` 按长宽比分档：单栏窄图约 `(3.4,2.6)`，双栏整幅图约 `(6.9,3.5)`；按需输出 `\.includegraphics` 的宽高基准。

## 4. 可追溯与一致性（规则，无外部依赖）
- 图上每个数值与来源数据逐点一致（生成时断言），禁止手工改轴。
- 图号连续、正文引用与清单一一对应；双栏论文图宽基准统一，禁擅自放大撑页。
- 同一变量跨图单位/刻度口径一致。

## 5. 自检（口头执行后交付）
- [ ] 每张图可解释；[ ] 字号线宽达标；[ ] 无坐标错位/文字重叠/图内乱码；[ ] 数值与源数据一致；[ ] 配色统一。
- 交付图清单 + 各图断言结果，视觉终审交人工。

## 产出
- 矢量图文件（pdf/svg）、每张图的来源+断言说明、嵌入论文用的图清单（图号/内容/宽度）。