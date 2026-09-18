# calibinfo 项目 · 数字资产适配清点

> 仓库：`github.com/dddsx3/mode-resolved-calibration`（calibinfo，Python 库）
> 项目领域：**线性化逆问题的「模式解析标定置信度」分析**（Schur 补 ΔFisher 信息 / 标定保持谱 / gauge 响应 / 标定分配）
> 数据基准：OpenIllumination 受控污染 + DiLiGenT sanity + 合成效度面板
> 现状：**已有 10 张手稿图（`paper/figures/`）+ 复现基准（`docs/REPRODUCIBILITY|EXPERIMENTS|WORDING.md`）+ 实验层（`experiments/*.py`）；论文正文待写**（CITATION 注明 "research paper forthcoming"）。

本文把数字资产库（`D:\modex\_assets_extracted\`）与该仓库逐层匹配，标注「高度可用 / 部分可用 / 不适用 / 缺口」并给出落点。生产建议：**写作/图表走英文 SCI 通用链路，复现/防伪走共享审计脚本，IEEE 版式走缺口补齐项。**

---

## 一、领域判断（决定匹配策略）

| 维度 | calibinfo 实际 | 结论 |
|---|---|---|
| 论文类型 | 数学/统计/算法型 SCI（非数值模拟竞赛） | 用 `paper-write-nature` 英文链路，**不用** `comp-*` 国赛链路 |
| 内容特征 | 公式密集（Schur 补、广义特征值、gauge） | 写作需 LaTeX+amsmath；图表需出版级 |
| 最强卖点 | **可复现性**（checksums/reproduce/冻结点）+ 声明-代码一致性 | 复用资产库审计脚本可成卖点 |
| 目标方向 | 计算成像 / 逆问题 / 估计（IEEE TCI/TIP 类，或 ARR→ICML） | IEEE 版式需补齐 |

---

## 二、高度可用（直接上手）

### A. 写作链路（英文 SCI · LaTeX）
| 资产 | 用法 | calibinfo 落点 |
|---|---|---|
| `skills/paper-write-nature/SKILL.md` | hourglass 结构、reader-first、出版级英文，逐节写 LaTeX | 论文正文骨架（**主入口**） |
| `skills/paper-write/SKILL.md` | 按大纲逐节生成 LaTeX | 对 formula-heavy 章节精细起草 |
| `skills/paper-write-nature-docx/SKILL.md` | 同上但输出 Markdown→Word | 编辑部要 Word 时用 |
| `skills/paper-plan/SKILL.md` | 由文献综述+实验结果生成论文大纲 | 先把 MODELS/SCHUR/SPECTRUM 映射成章节 |
| `skills/literature-review/SKILL.md` | 英文文献综述撰写+真实性核验 | Related Work |
| `skills/arxiv/SKILL.md` | arXiv 检索/下载/摘要到本地库 | 补引 Fisher information / optimal design 文献 |
| `skills/novelty-check/SKILL.md` | 查新核实是否已有人做过 | 提交前 novelty 自证 |

### B. 图表（出版级，仓库已 10 图可重制统一风格）
| 资产 | 用法 |
|---|---|
| `skills/nature-figure/SKILL.md` | Nature 级 matplotlib 图（NOAA 配色/SVG-PDF导出）——**统一 10 张已有手稿图风格** |
| `skills/paper-figure/SKILL.md` + `skills/shared-scripts/figure_style_guide.md` | `science` 配色（IEEE/工程经典）+ SciencePlots `science/ieee` 一行切换 |
| `skills/paper-figure-html/SKILL.md` + `tpl_*` | `overview_schematic`、方法流程图（HTML→矢量PDF） |
| `skills/paper-figure-drawio/SKILL.md` | schematic 的 TikZ 化（图1 overview 改造） |
| `skills/mermaid-diagram/SKILL.md` | 方法/数据流 Mermaid 图 |
| `skills/paper-illustration/SKILL.md` | 用于"架构示意/AI 插图"（可选） |

### C. 结果→声明 → 可复现审计（与仓库原有 assets 强对应）
| 资产 | 用法 | 对应仓库能力 |
|---|---|---|
| `skills/analyze-results/SKILL.md` | 已有实验数值统计、比较表 | `results/` 汇总 |
| `skills/result-to-claim/SKILL.md` | 判读结果支撑哪些声明、缺哪些证据 | 呼应 `docs/WORDING.md` + 已 retire 的 arm-A 声明（防误引） |
| `skills/ablation-planner/SKILL.md` | 主结果过后的消融设计 | 分层/阈值/预算消融 |
| `skills/shared-scripts/facts_audit.py` | 数值可追溯、正文数字溯源 | 复用 `reproduce_paper.sh` 冻结点 |
| `skills/shared-scripts/claim_code_check.py` / `cross_problem_check.py` / `paper_claim_check.py` | 声明-代码一致性、跨问题一致性 | 强化复现声明 |
| `skills/shared-scripts/logic_audit.py` | 逻辑一致性审计 | 审 gauge/守恒断言 |
| `skills/shared-scripts/bib_authenticity_check.py` | 参考文献真实性 | 投稿前清伪引 |
| `skills/shared-scripts/data_profile.py` / `leakage_audit.py` | 数据画像 / 泄漏审计 | OpenIllumination 受控污染复现 |

### D. 论文工程与投稿
| 资产 | 用法 |
|---|---|
| `skills/paper-compile/SKILL.md` | pdflatex 编译英文 LaTeX→PDF |
| `skills/quality-check/SKILL.md` | 字数/结构/引用/格式审查报告 |
| `skills/editor-agent/SKILL.md` | 论文编辑器代理（读写/跑代码/编译/导出） |
| `rebuttal/SKILL.md` + `arxiv` | 应对审稿；投稿前挂预印本 |
| `skills/shared-scripts/compile_check.sh` / `compile_utils.sh` | 编译校验（公式/宏包） |

---

## 三、部分可用（需改造/仅借鉴）

| 资产 | 说明 |
|---|---|
| `skills/comm-lit-review/` | 不适用——它是**通信**域文献库（IEEE Xplore/JSAC/ToN），本项目是成像/逆问题；仅其"按 venue 分级检索"方法可借鉴 |
| `skills/experiment-bridge/` `experiment-plan/` `research-refine/` | 面向 ML/GPU 实验。本项目实验已冻结，只在"扩展实验/消融"时借 plan 流程 |
| `skills/shared-scripts/writing_rules.md` / `error_prevention.md` | 通用写作/防错规则，与下述 comp 无关，可借鉴其检查点 |
| `skills/course-paper|paper-write-zh|paper-compile-zh` | 仅当目标含中文会议时才用 |

---

## 四、不适用（明确排除，避免误用）

- `comp-code / comp-modeling / comp-paper-zh|en / comp-prob-analysis / comp-compile-zh / comp-stats-topic`：**国赛数学建模竞赛链**，格式/流程与本项目无关。
- `docx-format-check / format-profile / docx-cn-engine`：中文 docx 排版链，非 IEEE 场景。
- `comm-lit-review`：域不对（见上）。
- `course-* / patent-* / grant-proposal / humanities-* / thesis-proposal`：非研究论文投稿路线。
- `dse-loop / monitor-experiment / run-experiment`：面向 GPU/自动迭代，本项目为离线复现。

---

## 五、缺口（资产库没有，需补齐）—— 尤其 IEEE 场景

| 缺口 | 影响与补齐 |
|---|---|
| **IEEEtran.cls 双栏模板** | 资产库无任何 IEEE 模板（已全库核验）。需从 IEEE 官网/CTAN 获取 `IEEEtran.cls`，`paper-compile` 可编译它 |
| **IEEE 数字引用样式 .bst** | 无 `IEEEtran.bst`；参考文献需套 IEEE 数字制，或用 `plainnat`+自定义 |
| **IEEE 投稿 checklist / 双栏 author block 技能** | 需人工按期刊模板核对 |
| 数学公式专项技能 | 资产库无专职"数学公式排版"技能；用 LaTeX + amsmath 自行排版（`paper-write-nature` 可承载） |

---

## 六、给 calibinfo 的落地路线建议

1. `literature-review`/`arxiv` 补 Related Work → `novelty-check` 查新
2. `paper-plan` 把 ΔF/Spectrum/Gauge/Allocation → 章节大纲
3. `analyze-results`/`result-to-claim` 固定"**arm D 为主、arm A 仅作 frozen provenance 且不引 stratified severity**"的措辞（与 `docs/WORDING.md §6` 一致）
4. `paper-write-nature` 写正文 → `nature-figure`/`figure_style_guide`(science 配色) 统一 10 图 → `paper-figure-*` 画 schematic/流程
5. `facts_audit`/`claim_code_check`/`bib_authenticity_check` 跑一遍（卖点：完整可复现）
6. `paper-compile` 编译 → `quality-check` 审查 → 补齐 IEEEtran 后投 IEEE（或 `arxiv` 预印本 → ARR/ICML）