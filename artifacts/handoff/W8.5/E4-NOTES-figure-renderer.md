# NOTES: figure/renderer.ts（W8.5-E4，§9 第 9/12 份）

## ① 这模块保证什么不变量

- **图表是数字的投影，不是装饰**：`data_refs` 必须解析到 store 的 `Result`（`renderer.ts:70-90`），每个 series 直接携带 `value/unit/uncertainty`——图上的每个点都可追到一条 IR 记录。**DataArtifact 被显式拒绝**（`:83-88`，"v1 renderer draws numeric Results only"）——拒绝而非跳过，保持契约诚实。
- **确定性渲染**：`renderFigureSvg` 无时间/随机（注释 `:107`），`data_hash = sha256(canonicalJson(input))`（`:100`）——同一 IR → 同一 SVG → 同一哈希，与 W1 的"同输入同输出"承诺一致。
- **chart_type 白名单**（`:66-68`）：闭合集合，白名单外 fail-closed。

## ② 我不同意什么（本轮实质批评）

**"DataArtifact 拒绝"是把架构缺口伪装成契约诚实。** 代码注释说"拒绝保持诚实"——但 PRD F7 与 M5 指标要的恰恰是"从真实附件画图"（时序曲线/散点）。把拒绝写成"诚实"的措辞掩盖了一个事实：**当前 renderer 的输入模型（`Series` = 每点一个 `value`）根本没有"一条曲线"的概念**——它只有"N 个独立标量点，用 polyline 串起来"（`:141-156`，x 坐标由**序号**生成而非数据 x 值）。这个"x=序号"的设计意味着它**结构上不可能**画真实时序曲线（时间列在 x 轴）——拒绝 DataArtifact 是必然，不是选择。

结论：W9 的图形重构不是"加 DataArtifact 支持"，而是**替换输入模型**（引入 (x[], y[]) 序列语义）——拒绝分支会被那个新模型自然消解，而不是被"允许"。

## ③ 删掉它会坏在哪

`figure_data_consistency` 门与 `FigureSpec.data_hash` 校验（TASK 4.3）锚在 `buildRenderInput` 的哈希上；交付报告的图数据溯源表也消费同一 `data_hash`——删掉它，图上任何一个数字就重新变成不可追溯。

## ④ 一句话对外

"图上每个点必须来自一条 IR 结果记录"——它是把'好看的图'与'可审计的图'区分开的那道门；当前版本的局限是它只认得出散点，认不出曲线。
