# 图表 · 示意图 · 对抗复核 · 论文 —— 连体交付包（2026 国赛 A 题 · 药材的烘干）

> 承接对象：`TASK_编程求解作战包.md` 的 P5 产出（`figures/all_results.json`、`figures/problem_*_results.json`、`RESULTS.md`、`code/`、`result1-4.xlsx`）。
> 本包把求解之后的四步 **①图表生成 → ②流程/架构图 → ③逻辑对抗复核 → ④论文撰写(Markdown)** 合成一条连续产线，一次交付。
> 图清单权威来源：`MODELING_REPORT.md §8 图表预规划`（24 张，已绑定公式/检验点 + 数据源）与 `PROBLEM_ANALYSIS.md §11`（制造规格）。
> 论文骨架来源：`skills/comp-paper-zh/SKILL.md`（国赛章节结构 + Step0–7 工作流 + facts_audit 溯源铁律）。

---

## 目录

- [⓪ 承接与启动检查](#⓪-承接与启动检查)
- [① 图表生成（paper-figure，20 张 DATA 图）](#①-图表生成paper-figure20-张-data-图)
- [② 流程与架构图（paper-figure-html / drawio，4 张形象图）](#②-流程与架构图paper-figure-html--drawio4-张形象图)
- [③ 逻辑对抗复核（comp-review）](#③-逻辑对抗复核comp-review)
- [④ 竞赛论文撰写（comp-paper-zh-docx · Markdown 正文）](#④-竞赛论文撰写comp-paper-zh-docx--markdown-正文)
- [⑤ 交付物与验收](#⑤-交付物与验收)
- [⑥ 分阶段 Prompt（P-FIG / P-DIA / P-REV / P-PAP）](#⑥-分阶段-promptp-fig--p-dia--p-rev--p-pap)
- [⑦ 现存债与"缺内容 / 依赖模型能力"标注](#⑦-现存债与缺内容--依赖模型能力标注)

---

## ⓪ 承接与启动检查

先做 probe（不满足就停，别硬往下写）：

| 检查 | 路径 | 不满足的处理 |
|---|---|---|
| 结果字典 | `figures/all_results.json` + `problem_*_results.json` 存在且含 V1–V14 | 回退到编程作战包 P5 补交付 |
| 结果汇总 | `RESULTS.md` 有逐问数值、A/B/C、t*、外推占比、守恒两层 | 同上 |
| 求解代码 | `code/problem1-4.py` 可重跑 | 同上 |
| 物性/判据 | t*∈48-72h、附录2/3/4 未混、逐点 max_rC | 先修建模/求解，不在此步掩盖 |
| 工具物化 | `_utils/`（shared-scripts 已物化）、`figure_recipes_competition.md` | 缺则先物化 |

**贯穿规则**：
- 一切数字从 `all_results.json / RESULTS.md` 拷贝并标注来源，**禁止凭印象虚构**（facts_audit 在 paper 阶段仍会再审 [15] 正文数字溯源）。
- 预检值（58.57 / 130.87 / 51.32 h）一律标注「量级参考」，正式值以独立性检验后的 `results json` 为准。
- 图/表编号连续，正文引用必须与 FIGURE_MANIFEST / 交付物一一对应。

---

## ① 图表生成（paper-figure，20 张 DATA 图）

### 输入
- `figures/all_results.json`、`problem_*_results.json`（每张图的数据源见下表）
- 数据文件：`user_data/附件1.xlsx`、`附件2.xlsx`、`result1-4.xlsx`
- 配方：`skills/shared-scripts/figure_recipes_competition.md`（+ 各基础/竞赛/进阶配方图种）
- 工具：`figure_recipes_competition.md` 指示的 `plot_utils.py` + `get_recipe.py`（建议放 `_utils/`）

### 20 张 DATA 图清单（ID · 图种=配方 · 绑定/用途 · 数据源 · 硬性验证）

| 图 | 图种（配方） | 证明什么 / 绑定 | 数据源 | 验证 |
|---|---|---|---|---|
| `fig_q1_profiles` | 多时刻径向剖面折线（基础#3）双面板 | 7 时刻 T,C 剖面；温度贯穿 vs 水分只动表层（式4.1-4.2） | 问题1解 t=100..1800s | 表1 采样值一致 |
| `fig_q1_field_contour` | 时空等高线云图（竞赛#14）双面板 | (r,t) 全场形态差异（C1 时间尺度分离） | 问题1完整解 1800×101 | 剖面图交叉一致 |
| `fig_q1_verify_analytic` | 预测vs解析+残差（竞赛#4）双面板 | 数值=Bessel+Duhamel，最大偏差1e-4℃（V3,CM6） | 数值+解析解 | 偏差轴量级 |
| `fig_q1_latent_reject` | 双轴图（基础#10） | 加 Lv 温度降到 9.10℃ 与预热平衡矛盾（H2 问责） | 潜热开关对照 | 两条T曲线分叉 |
| `fig_q1_penetration_area` | 面积图（基础#8） | Fo_h 与 Fo_m 渗透深度差异（§3.4 判据二） | 无量纲数+剖面 | C<2.549 厚度 |
| `fig_q2_profiles` | 多时刻径向剖面折线（基础#3）双面板 | 3h 内每0.5h剖面；D 大 2.73 倍效应（式4.7-4.8） | 问题2解 | 表3 采样值一致 |
| `fig_q2_field_contour` | 时空等高线云图（竞赛#14）双面板 | 变系数场 vs 问题1 | 问题2完整解 10800×101 | 与Q1对比 |
| `fig_q2_props` | 多面板对比（基础#12）四面板 | ρ,c_p,k,D 随 C 演化；D 降 94% 主导（MF1,V14） | 附录3本构 C∈[0.05,2.55] | 锚点公式一致 |
| `fig_q2_stage_transition` | 双轴图（基础#10） | 预热→恒温过渡由附件1时变自然浮现，无人工切换（R2） | 结果+附件1 | 交点标注 |
| `fig_q3_drying_curves` | 干燥特性组合图(自定义)双面板 | C(t) 干燥曲线 + 速率图；减速段起点 | 问题3完整解 | 0.15 穿越点 |
| `fig_q3_field_contour` | 栅格热图+0.15等值线（竞赛#29） | 阈值面从表面向中心推进（$t^*$ 判据） | 问题3完整解 | 等值线=计算 t* |
| `fig_q3_numerics` | 分组柱状图（基础#1） | 网格/界面D对 t* 影响；调和平均失效 | N/N/2/三种界面D | 收敛表 |
| `fig_q3_threshold_sensitivity` | 3D曲面（竞赛#6） | t* 随阈值 C* 与 h_m 超线性（M6） | 阈值×h_m 二维扫描 | 峰值位置 |
| `fig_q3_tornado` | Tornado（竞赛#2） | 单因素扰动排序；h_m 双向非对称 | h_m,C*,T_air,C_air,N | 排序单调 |
| `fig_q4_shrinkage_validation` | 预测vs观测+残差（竞赛#4）双面板 | 径向(1.10%) vs 各向同性(19.50%) 收缩 | 附件2 + 式5.8 | 终值 1.2112vs1.198 |
| `fig_q4_field_moving` | 移动边界时空热图(自定义)双面板 | 收缩域 C 场，域外留空 | 问题4解+R(t) | 右上角空白 |
| `fig_q4_profiles` | 山脊图（进阶#23） | C 剖面逐层下移、右端点随 R(t) 内缩 | t=6,12,...,48h | 末点=表面 |
| `fig_q4_attribution_waterfall` | 瀑布图（进阶#6） | 归因链：58.57→+72.31→−79.55→51.32 h（ND2） | 三配置结果 | 增量守恒 |
| `fig_q4_conservation_audit` | 守恒审计图(自定义)双面板 | 左离散残差≈0 vs ALE +3.1%；右 ρ_d 物理残差(2.22%)（EQ5） | 两种格式残差+物性 | 两面板不同轴 |
| `fig_q_tdry_compare` | 棒棒糖图（进阶#1） | 四问 t* 对比 + 题面 2–3 天参考带（B3 外部校核） | 汇总结果 | 落在带内/外标注 |

### 生成规则（强约束）
- 逐张独立脚本生成 PDF（嵌入用矢量）；图上不写"预测/实测"以外的文案，单位进坐标轴标签。
- 编号按上图顺序连续；正文引用图号与此一一对应（CM5）。
- 尺寸按图种要求的长宽比分档；**线宽≥0.9pt、刻度字号≥8pt、dpi≥300**（防论文缩图糊掉）。
- 双面板图共用 x 轴、独立 y 轴标签；每张图必须能回答"它在证明建模/求解/检验的哪一环"。
- 每张生成后立即核对：数据源字段值 × 图上数值一致（从 results json 断言）。
- 🟥 缺内容 + 👁 依赖模型：`data_fig_vision_check.py` / `screenshot_capture.py` 仅 .pyc 无法运行 → 视觉质检降级为**人工看**（坐标错位/重叠/糊）。

---

## ② 流程与架构图（paper-figure-html / drawio，4 张形象图）

### 输入
- `PROBLEM_ANALYSIS.md`、`MODELING_REPORT.md` 的结构与公式编号（§2-§5）
- 公式图包：`skills/paper-figure-html/templates/`（tpl_roadmap / tpl_flow / tpl_pipeline .html + themes.css）
- TikZ 由 `skills/paper-figure-drawio` 生成

### 4 张示意清单

| 图 | 类别 | 内容 | 生成 |
|---|---|---|---|
| `fig_roadmap` | HTML | 四问依赖链 + 数据流总路线图（附件1/附件2 → Q1..Q4 的模型关系）；FLOW_PER_PROBLEM=OFF，四问合一张 | paper-figure-html |
| `tikz_geometry_bc` | TIKZ | 圆柱几何、一维 r 坐标、两个第三类 Robin 边界物理示意（式3.5-3.6） | paper-figure-drawio → `figures/tikz_diagrams.pdf` |
| `tikz_q4_moving_domain` | TIKZ | 物理域 [0,R(t)] → η∈[0,1] 映射、对流项来源（式5.1-5.3） | 同上 |
| `tikz_fv_stencil` | TIKZ | 柱坐标控制体模板：r_{i±1/2}、半控制体、界面通量（式3.7-3.8） | 同上 |

### 强约束
- 符号与建模报告一致（C 干基、ρ 用 C、c_p/k 用 C/(C+1)、T 开尔文、AFFINE_SHRINK 开关）。
- **问题分析章节里堆叠的子问题流程图 ≤1 张**（comp-paper 铁律），四问用 `fig_roadmap` 一张表达即可。
- HTML 用 `html_pdf_check` 验证渲染；TikZ 用 `tikz_vision_check`。
- 🟥 缺内容 + 👁 依赖模型：`drawio_vision_check.py` / `html_pdf_check.py` 仅 .pyc 无法运行 → 渲染质检降级为**人工核对**（图不残缺、分层不漏、文字不重叠）。
- 产出三条路径归一：TikZ 编译为 `figures/tikz_diagrams.pdf`；`latex_includes.tex` 里写入对应 `\includegraphics` 图块（供论文嵌入）。

---

## ③ 逻辑对抗复核（comp-review）

### 输入
- `RESULTS.md`、`figures/all_results.json`、`code/`、`templates/cumcm` 无关（本轮只管数值逻辑）
- `_utils/facts_audit.py`、`any/pre_commit` forbid 正则（comp-code 传下来的方法严禁表）

### 针对本 A 题的对抗复核清单（逐条过，任一不过即打回求解/文案）

**A. 物性与方程**
- ⛔ 附录2/3/4 物性**未混用**（Q3 用附3、Q4 用附4，附4 D 小 5.39 倍）→ 用锚点 D 值复算。
- ⛔ D 的 Arrhenius 用 T+273.15（证：T=323.15K 得 D=1.3471e-8，若用摄氏 D→1e-34）。
- ⛔ ρ 用 C、c_p/k 用 C/(C+1)（证：c_p(2.55)=3415.3；写成 C 会得到 8426.8 的假值）。
- ⛔ 界面 D 先均 C 再代入（禁调和平均硬壳）。

**B. 求解数值**
- ⛔ 判据逐点 `max_r C < 0.15`，非体均（体均会差约 60% 的 t*）。
- ⛔ t* 线性插值定位（非采样取整）；t*∈48–72 h（soft，出区间须解释）。
- ⛔ 温度隐式+Thomas，两场顺序耦合单次扫描（禁 Picard/while .*> tol 及 Jacobi 型旧层更新）。
- ⛔ 守恒**两层分报不合并**：离散残差(≈0) ≠ 物理自洽 ρ_d=ρ/(1+C) 残差(2.2163%–15.4972%)。

**C. 归因与一致性（ND2 受控归因）**
- ⛔ A/B/C 三段独立：A=附3固定域(58.57参考) · B=附4固定域(130.87参考) · C=附4收缩域(51.32参考)；增量 (B−A)=+72.31 物性、 (C−B)=−79.55 收缩，**方向与量级必须合理**（收缩应减时，物性变差应加时）。
- ⛔ 逻辑约束 B1–B8 全真（C∈[0,2.55]、T∈[28,50.246]、t*Q4<t*Q3、D附3∈[1e-8,2e-8]、Bi∈(1,4)、Fo比≈34）。
- ⛔ 四问 t* 口径一致；表1-表4 粗采样值 = result1-4.xlsx 中对应格（round4）。

**D. 审慎与防造假**
- ⛔ 外推占比≈93% 已显式声明（附件1 平台段均值 49.9685℃/0.04987）。
- ⛔ 预检值标注「量级参考」vs 正式值分开放。
- ⛔ 无人工阻尼、无"凑数进 48-72h 区间"、无静默兜底（S8 报"未达"就是未达）。
- ⛔ facts_audit --stage review 重跑：53 个 OCR 数字未登记逐项补，74 个数值溯源无断链。

### 产出
- `REVIEW.md`：逐条结论表（通过 / 不通过 / 待改），不通过的给出精确改法与影响面 → 打回**编程**或**文案**修，修完复跑本清单直至全过。

---

## ④ 竞赛论文撰写（comp-paper-zh-docx · Markdown 正文）

### 输入
- 全部上游产物（图 20+4、REVIEW.md、RESULTS.md、all_results.json、result1-4.xlsx）
- 模板：`skills/comp-paper-zh/templates/cumcm/`（cumcmthesis.cls）
- 规则：`skills/shared-scripts/writing_rules.md`
- 文献：Step 3.5 预检索（用 `scholar` 脚本按关键词搜真实论文建 BibTeX 引用池）

### 国赛章节骨架（A 题 4 个子问题版；以 Markdown 写 `paper/main.md`）

```text
摘要（~1 页，含关键词；最后写）
1  问题重述           —— 复述烘干工况与四问交付要求（不加自己结论）
2  模型假设           —— 与建模约束对应 + 假设问责表（H1/H2...，如潜热排除）
3  符号说明           —— 符号表（用 Markdown 表格；后续转格式时用 longtable）
4  问题一的建模与求解  —— fig_q1_* 5 张 + 表1/表2 粗采样 + V3 解析验证（预热平衡）
5  问题二的建模与求解  —— fig_q2_* 4 张 + 表3/表4 + V14 变物性 + R2 段过渡
6  问题三的建模与求解  —— fig_q3_* 5 张 + t*(正式值) + 判据口径 + 独立性表 + 外推声明
7  问题四的建模与求解  —— fig_q4_* 5 张 + R(t)验证 + A/B/C 归因瀑布 + 守恒两层 + 域外空
8  灵敏度分析与模型检验 —— fig_q_tdry_compare + tornado + (量化:损失或相对变化)
9  模型评价与推广     —— 优缺点、D 各向同性假设、可推广到其他干燥/传热传质体系
参考文献            —— BibTeX（真实文献，禁伪造 DOI）
附录 A：代码        —— 关键求解代码（不堆全量；保留入口与核心步）
```

### 写作强规则（comp-paper 铁律）
- **页数/篇幅目标**：正文统一按 **900 字符/页** 折算；先写再抽检每章页数，最薄章节定位出来扩写，**禁止"×800/×900"两套口径**。
- **图嵌入计划**（Step 3）：按 FIGURE_MANIFEST 对账，20 张 DATA + 4 张示意**一张不缺、一张不多**；图序连续，正文每张图在出现处有引导句 + 绑定的一句结论。
- **⛔ 数据可追溯**：正文每个数字从 `all_results.json/RESULTS.md` 拷贝并注明（表/图/公式号）；落稿后跑 `facts_audit.py --stage paper`（正文数字溯源 [15]、结论一致性 [13]、源归属 [14]）；把可疑虚构数字清零。
- **⛔ 图尺寸一致性闸**：正文里每张图 `\includegraphics` 的 width/height 必须等于 `latex_includes.tex` 基准，禁止擅自放大撑页。
- **⛔ 附录不含代码块外观**（正文不写 lstlisting/verbatim 大段代码），代码进附录 A。
- **De-AI 打磨**（Step 5.5）：去模板腔、加具体量级、公式编号统一样式；全部内容完成后**最后写摘要**（信息密度高，不写废话）。
- AI 工具使用声明（若开启）如实写。

### 关键数字蓝本（写入正文前从 results json 复核，禁止直接抄本表）
t*：Q3 正式值（参考 58.57h）· Q4 正式值（参考 51.32h）· B 配置 130.87h；增量物性 +72.31 / 收缩 −79.55；附件2 预测终径 1.2112 vs 实测 1.198 cm（偏差 1.10%）；干物质残差 2.2163%–15.4972%；外推占比≈93%；离散/物理守恒两层分报。

### 产出
- `paper/main.md`（Markdown 正文，含图表引用与 KaTeX/LaTeX 公式语法）——本步交付物
- （后续格式阶段才转 LaTeX `main.tex`/docx，不在此步）

---

## ⑤ 交付物与验收

| 类别 | 产出物 | 验收 |
|---|---|---|
| 数据图 | `figures/fig_q*.pdf`（20 张） | 每张数值=results json；线宽/字号/尺寸达标；无糊图 |
| 示意图 | `figures/fig_roadmap(.html) + tikz_diagrams.pdf`(3张TikZ) | 符号一致；流程≤1 张/问题分析 |
| 复核 | `REVIEW.md`（全绿） | B1-B8 真；MC forbid 0 命中；归因增量方向合理 |
| 论文 | `paper/main.md`（Markdown 全文 + 摘要 + 参考文献 + 附录） | FIGURE_MANIFEST 对账齐；页数达标；facts_audit(paper) 0 虚构数字 |

---

## ⑥ 分阶段 Prompt（P-FIG / P-DIA / P-REV / P-PAP）

> 每段都以「加载并执行 XX 技能」开头，末尾有检查点「先停，等我确认」。

### P-FIG · 图表生成（paper-figure）

```text
加载并执行 skills 库里的 comp-paper-zh 技能中的图表环节，等价调用 paper-figure（工作目录 workspace/）。
输入：figures/all_results.json + problem_*_results.json、user_data/附件1/附件2.xlsx、result1-4.xlsx。
第一轮先只做一件事：按 MODELING_REPORT §8 的 20 张 DATA 图清单逐一给"数据源字段 → 图上要展示的值"的映射表，
到 all_results.json / RESULTS.md 里逐个验证数据点存在，再列生成顺序。我确认后你才真画。
生成规则：逐张独立脚本 → PDF 矢量；figsize 按长宽比分档、线宽≥0.9pt、刻度字≥8pt、dpi≥300；
双面板共用 x 轴；图号按 FIGURE_MANIFEST 顺序连续。每张生成后做数值断言（图上值=results json）。
其中 screenshot_capture / data_fig_vision_check 若只有 .pyc 无法跑，就把每张图渲染后"只报图上数值与源字典是否一致"，
视觉质量（坐标/重叠/糊）交给我人工确认。产出后贴交付清单给我。先停。
```

### P-DIA · 流程与架构图（paper-figure-html / drawio）

```text
继续执行 comp-paper-zh 中的示意图环节，等价调用 paper-figure-html 与 paper-figure-drawio。
产出 4 张：fig_roadmap(HTML，四问合一张,FLOW_PER_PROBLEM=OFF) + tikz_geometry_bc + tikz_q4_moving_domain + tikz_fv_stencil。
符号必须与建模报告一致（C 干基、ρ 用 C、c_p/k 用 C/(C+1)、AFFINE_SHRINK 开关）。
TikZ 编译为 figures/tikz_diagrams.pdf；把 \includegraphics 图块写进 latex_includes.tex。
约束：问题分析章节里子问题流程 ≤1 张（fig_roadmap 已覆盖，不再堆叠）。
html_pdf_check / drawio_vision_check / tikz_vision_check 若仅 .pyc 无法跑，则渲染质检降级为人工核对：
给我每张图的可视化预览用于人工确认不残缺/不漏层/不重叠。产出后贴清单。先停。
```

### P-REV · 逻辑对抗复核（comp-review）

```text
加载并执行 skills 库里的 comp-review 技能（工作目录 workspace/）。
输入 RESULTS.md、all_results.json、code/、REVIEW 前置传单。
严格按《③ 逻辑对抗复核》清单逐条走：
A 物性与方程（附录2/3/4 未混、D 用开尔文、ρ vs C/(C+1)、界面均 C）
B 求解数值（逐点 max_rC 判据、t* 线性插值、隐式温度/顺序耦合禁 Picard、守恒两层分报不合并）
C 归因一致性（A/B/C 三段独立、增量方向物性+72.31/收缩−79.55、B1-B8 全真、四问口径一致）
D 审慎防造假（外推≈93% 声明、预检量级参考、无凑数、facts_audit --stage review 补 53 个OCR/74 溯源）。
任何一项不过 → 给出精确修改法与影响面，打回求解或文案；修完复跑直至全绿。
产出 REVIEW.md：逐条结论表（通过/不通过/待改）。先停，等你过目。
```

### P-PAP · 论文撰写（comp-paper-zh-docx · Markdown）

```text
加载并执行 skills 库里的 comp-paper-zh-docx 技能，用 Markdown 写正文（工作目录 workspace/，产出 paper/main.md）。
先跑 Step0 上游校验（all_results.json / RESULTS.md / 20张数据图 / 4张示意 / latex_includes.tex 都在？子问题覆盖度？）。
再 Step1 基于 templates/cumcm 国赛骨架，按以下章节写（A 题 4 问版）：
摘要(末写)·1问题重述·2模型假设(含假设问责)·3符号说明·4问题一·5问题二·6问题三·7问题四·8灵敏度与检验·9模型评价·参考文献·附录A代码。
数字必须从 all_results.json/RESULTS.md 拷贝并标注来源；图按 FIGURE_MANIFEST 对账一张不缺、图序连续；
正文统一按 900 字符/页 折算页数并预检，最薄章节定位扩写；附录不进大段代码块；
全部完成后最后写摘要，做 De-AI 打磨，跑 facts_audit --stage paper 清零虚构数字。
生成 paper/main.md 交付，并给一章"待我人工确认"清单（存疑数字/未过校验项）。先停。
```

---

## ⑦ 现存债与"缺内容 / 依赖模型能力"标注

| 项 | 类型 | 影响 | 应对 |
|---|---|---|---|
| `data_fig_vision_check` / `screenshot_capture` | 🟥 缺内容（仅 .pyc） | ①数据图视觉质检缺失 | 降级人工验图（P-FIG 已写死） |
| `drawio_vision_check` / `html_pdf_check` / `tikz_vision_check` | 🟥 缺内容（仅 .pyc） | ②示意图渲染质检缺失 | 降级人工核对（P-DIA 已写死） |
| 自动"改进循环"技能 | 🟥 缺技能 | ④论文打磨-迭代缺内置驱动 | 用你贴修改要求→它改→你点头 替代 |
| 视觉质检 / 图/渲染复审 | 👁 依赖模型视觉 | ①②④ 的最终成图/成稿需要你或视觉能力把关 | 检查口设为人 |
| `_utils/` 物化 | 🔧 前置 | 全部 facts_audit/clip 校验脚本依赖 | 求解阶段已物化，延续即可 |
| AUDIT 现存债 | 🔧 | 53 个 OCR 未登记 / 74 个数待溯源 | 在 P-REV 一并补齐；写文档议前一并清 |

*2026 国赛 A 题 · 图表→示意图→复核→论文 连体交付 · 规格源 = MODELING_REPORT §8 + PROBLEM_ANALYSIS §11 + comp-paper-zh SKILL.md · P-FIG→P-DIA→P-REV→P-PAP 有检查点，别跳步。*