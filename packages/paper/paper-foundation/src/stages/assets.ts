/**
 * 迁移进来的资产 —— 图表模板与 Word 导出引擎。
 *
 * ## 迁移了什么
 *
 * | 资产 | 来源 | 体量 |
 * |---|---|---|
 * | 五种图模板 + 主题样式 | `paper-figure-html/templates/` | 6 份 / 34KB |
 * | Word 导出引擎 | `tools/docx-cn-engine/` | 5 份 / 110KB |
 *
 * **都原样迁移，不改写**：模板是版式规范本身，引擎是渲染实现本身。改写它们等于换标准。
 * 逐份核查 modex：干净。
 *
 * ## 适配状态：模板与引擎**都能跑**
 *
 * 模板是纯静态资源（HTML + CSS），渲染器读它即可，**没有额外依赖**。
 *
 * 引擎是 Node 实现（与本仓库同运行时，这是选它而不是改造 `export-docx.py` 的理由），
 * 它声明了三个依赖：**`docx` / `fast-xml-parser` / `temml`**。这三个**已装进本包**
 * （`packages/paper/paper-foundation/package.json`），并已实测跑通
 * （`node md_to_docx.js --source x.md --output x.docx` 产出真 docx）。
 *
 * `DOCX_ENGINE_EXTERNAL_DEPS` 仍列在这里，但含义变了：它不再是"还差什么"的清单，
 * 而是**测试用来断言"依赖真的可解析"**的清单——`stage-assets.spec.ts` 从引擎目录
 * 逐个 `require.resolve`，所以"文件在但依赖没装"这种状态跑不起来也藏不住。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/assets
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveStageAssetDir } from './asset-dir.ts'

/** 资产目录的解析结果（含"用的是 src 还是 lib 那一份"，供报告与清单记录）。 */
export const STAGE_ASSETS_DIR = resolveStageAssetDir('assets')

/** 模板目录（从模块自身解析，单一来源）。 */
export const DIAGRAM_TEMPLATES_DIR = join(STAGE_ASSETS_DIR.dir, 'diagram-templates')

/** 导出引擎目录。 */
export const DOCX_ENGINE_DIR = join(STAGE_ASSETS_DIR.dir, 'docx-engine')

/**
 * 五种图模板 —— 与阶段 5 简报里写的模板族**必须一一对应**。
 *
 * 这张表存在的理由：简报说"按图选模板"，资产里有模板文件，**两者会漂移**——
 * 简报写了一个不存在的模板名，模型就无从选起。测试把两边钉在一起。
 */
export const DIAGRAM_TEMPLATES: ReadonlyArray<{
  readonly id: string
  readonly file: string
  readonly title: string
  /** 什么时候用它（与阶段 5 简报的措辞一致）。 */
  readonly whenToUse: string
}> = [
  { id: 'tpl_roadmap', file: 'tpl_roadmap.html', title: '路线图模板', whenToUse: '四问依赖链、数据流总路线' },
  { id: 'tpl_flow', file: 'tpl_flow.html', title: '流程图模板', whenToUse: '决策流程、算法步骤' },
  { id: 'tpl_arch', file: 'tpl_arch.html', title: '架构图模板', whenToUse: '系统分层' },
  { id: 'tpl_framework', file: 'tpl_framework.html', title: '框架图模板', whenToUse: '建模框架' },
  { id: 'tpl_pipeline', file: 'tpl_pipeline.html', title: '管线图模板', whenToUse: '数据处理管线' },
]

/** 主题样式（风格族 A/B/C 的实现载体）。 */
export const DIAGRAM_THEME_FILE = 'themes.css'

/**
 * 导出引擎的文件清单。
 *
 * `entry` 标出主入口；`requires` 是**这个文件用到的外部依赖**——记下来是为了让
 * "还差什么"可核，而不是靠记忆。
 */
export const DOCX_ENGINE_FILES: ReadonlyArray<{
  readonly file: string
  readonly role: string
  readonly requires: ReadonlyArray<string>
}> = [
  { file: 'md_to_docx.js', role: '主入口：Markdown → docx', requires: ['docx', 'fast-xml-parser'] },
  { file: 'new_doc.js', role: '文档骨架与样式落盘', requires: ['docx'] },
  { file: 'latex_to_omml.js', role: 'LaTeX 公式 → OMML', requires: ['temml'] },
  { file: 'mathml-to-docx.js', role: 'MathML → docx 公式节点', requires: ['fast-xml-parser'] },
  { file: 'package.json', role: '依赖声明（迁移自参考）', requires: [] },
]

/**
 * 引擎的外部依赖。
 *
 * **不再是"还差什么"**——三个都已装进本包（见模块头）。这张表现在的用途是
 * **可核**：测试从引擎目录逐个 `require.resolve`，所以"文件在但依赖没装"
 * 这种状态既跑不起来、也藏不住。
 */
export const DOCX_ENGINE_EXTERNAL_DEPS: ReadonlyArray<string> = ['docx', 'fast-xml-parser', 'temml']

/** 读一个模板（供阶段 5 的渲染器使用）。 */
export function diagramTemplate(file: string): string {
  if (!DIAGRAM_TEMPLATES.some(t => t.file === file) && file !== DIAGRAM_THEME_FILE) {
    throw new Error(`unknown diagram template: ${file}`)
  }
  return readFileSync(join(DIAGRAM_TEMPLATES_DIR, file), 'utf8')
}

// ─────────────────────────────────────────────────────────────────────────────
// 作图资产（**原样迁移自参考实现**，见 `assets/plotting/` 的模块注释）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 作图资产目录 —— 参考实现里 `skills/shared-scripts/` 的作图部分，原样迁移。
 *
 * ## 为什么是"原样迁移"而不是"照着重写"
 *
 * 用户口径是"**借鉴与仿制**"。这一层是参考实现的**风格规范本身**
 * （35 套配色、语义色表、`_lighten`、确定性风格种子、保存时的布局兜底链）
 * 与**108 个代码配方**。照着重写等于换标准——而"标准"正是这些文件的内容。
 * 与 `assets.ts` 模块头那条纪律一致：**模板是版式规范本身，引擎是渲染实现本身**。
 *
 * ## 它替换掉了什么
 *
 * 原来本仓库的作图阶段是**声明驱动**的：模型只写 `{chart_type, data_refs}`，
 * 由固定渲染器出 SVG（白名单 10 种图型）。那是为了"数不由模型持有"设计的，
 * 但代价是**水平上不去**——参考实现让模型写 `gen_fig_*.py`（matplotlib），
 * 拿到的是 108 个配方 + 一整套布局兜底（图例按占用自动选位、标注防重叠、
 * 刻度防裁切、空白自适应收缩），这些是固定渲染器做不到的。
 *
 * **可溯源没有丢**：参考自己也是靠"**必须从 JSON 读数据、不得硬编码**"
 * （`SKILL.md` 的 Key Rules）来保证图里的数与正文一致，并由
 * `facts_audit.py --stage figure` 审这一点。本仓库用同一条纪律，只是把
 * "从 JSON 读"具体化为"从 harness 铸出的 `results.json` 读"。
 */
export const PLOTTING_ASSETS_DIR = join(STAGE_ASSETS_DIR.dir, 'plotting')

/**
 * 作图资产清单。
 *
 * `role` 一栏是给**简报与门禁**读的：模型需要知道每个文件是什么、该怎么用；
 * 门禁需要知道该拿哪个脚本去审代码。
 */
export const PLOTTING_ASSETS: ReadonlyArray<{
  readonly file: string
  readonly role: string
}> = [
  { file: 'plot_utils.py', role: '**样式唯一来源**：`setup_style()` / `PALETTE` / `COLORS` / `_lighten` / `smart_labels` / `auto_legend` / `save_fig`' },
  { file: 'figure_style_guide.md', role: '风格规范本体：图型决策表、配色禁令、figsize 长宽比档位表、图内文字三层闸' },
  { file: 'get_recipe.py', role: '按 `类别 编号` 取配方代码（`basic|advanced|academic|competition|empirical`）' },
  { file: 'figure_recipes_basic.md', role: '配方库：通用基础图 12 个' },
  { file: 'figure_recipes_advanced.md', role: '配方库：SCI 级高级图型 34 个' },
  { file: 'figure_recipes_academic.md', role: '配方库：AI/CS 论文 12 个' },
  { file: 'figure_recipes_competition.md', role: '配方库：数学建模竞赛 29 个' },
  { file: 'figure_recipes_empirical.md', role: '配方库：实证/计量 21 个' },
  { file: 'figure_exemplars.md', role: '图例范本（优秀成图的写法参考）' },
  { file: 'figure_check.sh', role: '**代码级门禁**：只让 CRITICAL 进退出码（缺 setup_style / 默认蓝 / RdYlGn / plt.title / 硬编码色 >2…）' },
  { file: 'recipe_audit.py', role: '**规划图型 vs 实际代码**的内容级对账（治"规划写等高线、画出来是条形图"）' },
  { file: 'fig_include_size.py', role: '按 PDF 真实长宽比自动写 latex_includes 的 width/height（figsize 闭环）' },
]

/** 读一份作图资产（原样返回，不做任何改写）。 */
export function plottingAsset(file: string): string {
  if (!PLOTTING_ASSETS.some(a => a.file === file)) {
    throw new Error(`unknown plotting asset: ${file}（清单：${PLOTTING_ASSETS.map(a => a.file).join('、')}）`)
  }
  return readFileSync(join(PLOTTING_ASSETS_DIR, file), 'utf8')
}

/**
 * **方法论资产目录** —— 参考实现里"与题型无关"的那一层，原样迁移。
 *
 * 用户口径：*"把方法论与思想提炼固化下来，因为后续不能只跑一种类型的题目，
 * 如果无法保证稳定迁移就不能算成功。"*
 *
 * 这里放的都是**不依赖具体题目**的东西：
 * - `FIGURE-METHOD.md` —— 骨架本身（七步不变流程 + 题型无关/相关的界线 + 四条稳定性硬规则）；
 * - `error-prevention-by-problem-type.md`（107KB）—— 参考的防错手册，**按题型索引**；
 * - `figure-distribution-exemplars.md`（42KB）—— 优秀论文的图表分布范例（几张、什么型）；
 * - `capability-checklist-check.md` / `data-provenance-ledger.md` —— 参考自己标注为
 *   "**题型无关**"的两道闸的地基；
 * - `writing-rules.md`（63KB）/ `tikz-rules.md`（21KB）—— 写作与示意图的规范；
 * - `fidelity-audit.md`（46KB）—— 题面参数保真度审计；
 * - `answer-accuracy-patch.md`（22KB）—— 答案准确性补丁。
 *
 * 迁入时**逐份核过编码（UTF-8-sig）与体量**，不改写内容。
 */
export const METHODOLOGY_ASSETS_DIR = join(STAGE_ASSETS_DIR.dir, 'methodology')

/** 方法论资产清单（`role` 供简报与门禁读）。 */
export const METHODOLOGY_ASSETS: ReadonlyArray<{ readonly file: string; readonly role: string }> = [
  { file: 'FIGURE-METHOD.md', role: '**作图方法论骨架**：七步不变流程、题型无关/相关界线、四条稳定性硬规则、跨题迁移验收' },
  { file: 'STAGE-METHOD.md', role: '**跨阶段方法论索引**：阶段↔资产对照、四个题型无关的结构化契约、建模七件套、logic_audit 七查、复核六类缺口与回滚' },
  { file: 'error-prevention-by-problem-type.md', role: '防错手册（**按题型索引**）：每类题目历史上踩过的坑与对策' },
  { file: 'figure-distribution-exemplars.md', role: '优秀论文的图表分布范例：好论文有几张图、各是什么型' },
  { file: 'capability-checklist-check.md', role: '能力清单结构校验（参考标注为**题型无关**的闸）' },
  { file: 'data-provenance-ledger.md', role: '数据建档：用户数据的权威台账（参考的第 6 道闸地基）' },
  { file: 'writing-rules.md', role: '写作规范（论文正文口径）' },
  { file: 'tikz-rules.md', role: 'TikZ 学术示意图规则：语义驱动、自适应布局、可验证成品' },
  { file: 'fidelity-audit.md', role: '题面参数保真度审计（给定值 vs 代码实际使用）' },
  { file: 'answer-accuracy-patch.md', role: '答案准确性补丁（机理与优化类题目的常见错法）' },
]

/** 读一份方法论资产（原样返回）。 */
export function methodologyAsset(file: string): string {
  if (!METHODOLOGY_ASSETS.some(a => a.file === file)) {
    throw new Error(`unknown methodology asset: ${file}（清单：${METHODOLOGY_ASSETS.map(a => a.file).join('、')}）`)
  }
  return readFileSync(join(METHODOLOGY_ASSETS_DIR, file), 'utf8')
}

/**
 * **各阶段的工具与按题型资料** —— 参考实现里每个阶段的"机械闸 + 查表资产"，原样迁移。
 *
 * 用户口径：*"看一下是否还有可以继续固化与迁移的，比如建模阶段，比如问题求解
 * 或者逻辑复合对抗阶段真正有价值的资产能否固化下来。"*
 *
 * 方法论索引见 `methodology/STAGE-METHOD.md`（阶段 ↔ 资产对照、四个题型无关的结构化契约、
 * 建模七件套、`logic_audit` 七查、复核六类缺口与回滚协议）。
 */
export const STAGE_TOOLS_DIR = join(STAGE_ASSETS_DIR.dir, 'stage-tools')
export const STAGE_REFS_DIR = join(STAGE_ASSETS_DIR.dir, 'stage-refs')

/** 各阶段的机械闸（Python/shell 原样；本仓库的等价判据见 `gates.ts`）。 */
export const STAGE_TOOLS: ReadonlyArray<{ readonly file: string; readonly role: string }> = [
  { file: 'logic_audit.py', role: '**建模阶段的逻辑闸**（七查：外推/特征完整性/重复计量/方向界/裕度/自洽/锚点），由 `LOGIC_CONTRACT_MACHINE` 驱动' },
  { file: 'modeling_coverage_check.py', role: '能力项覆盖（每条 `capabilities[].id` 必须在建模报告里整词出现）' },
  { file: 'facts_audit.py', role: '题面参数保真（15 个模块：OCR 对撞防虚构、派生值验算、代码裸数字、正文数字溯源…）' },
  { file: 'claim_code_check.py', role: '**方法声称 vs 代码实现**（`METHOD_CLAIMS_MACHINE` 的 must/forbid 逐条核）' },
  { file: 'leakage_audit.py', role: '高分举证闸（≥0.99 的分类指标必须有去泄漏举证；物理单位后缀豁免）' },
  { file: 'delivery_audit.py', role: '交付对账 + 抽样透明（声称的产物必须存在且非空；真抽样必须声明口径）' },
  { file: 'cross_problem_check.py', role: '**跨问对撞**（`CROSS_PROBLEM_LEDGER.json` 的 must_le/must_ge 越界即报）' },
  { file: 'data_ingest_check.py', role: '数据摄入（裸 `read_excel` 无 `sheet_name=` 即硬失败）' },
  { file: 'capability_audit.py', role: '能力清单最终验收（`CAPABILITY_VERDICT.json`）' },
  { file: 'capability_check.py', role: '能力清单结构校验' },
  { file: 'stats_utils.py', role: '三线表工具（回归/描述性/相关矩阵，按后缀出 tex 或 md）' },
  { file: 'paper_claim_check.py', role: '正文结论 vs 上游落地' },
  { file: 'bib_authenticity_check.py', role: '参考文献真实性' },
  { file: 'data_profile.py', role: '数据建档（用户数据的权威台账）' },
  { file: 'table_slim.py', role: '表格瘦身（列数/行数上限）' },
  { file: 'normalize_cjk_quotes.py', role: '中文引号归一' },
  { file: 'count_subproblems.sh', role: '题面问数的**唯一权威口径**（只数标题行，防全文松匹配虚高）' },
  { file: 'error_prevention.md', role: '防错手册（130KB，**按题型 + 按机制**双索引）' },
]

/** 按题型/按图型的**查表资产**（这些是被查的资料，不是写进契约的规则）。 */
export const STAGE_REFS: ReadonlyArray<{ readonly dir: string; readonly role: string }> = [
  { dir: 'modeling', role: '建模阶段参考：`SKILL.md`（工作流与七件套）+ `methods_table.md`（方法族 → 常用方法/库）' },
  { dir: 'code/checks', role: '**按题型**的编码自检分册：`optimization` / `prediction` / `evaluation` / `physical` / `consistency` / `sanity_check`' },
  { dir: 'code', role: '编码阶段参考：`SKILL.md` + `error_prevention_code.md`（按题型的防错）' },
  { dir: 'review', role: '复核阶段参考：`SKILL.md`（六类缺口 + `COMP_REVIEW_VERDICT.json` 协议 + fatal 回滚）' },
]

/** 读一份阶段工具/参考资料（原样返回；只允许清单内的文件，防路径穿越）。 */
export function stageAsset(file: string): string {
  // 反斜杠 → 正斜杠（Windows 路径容忍）
  const rel = file.split(String.fromCharCode(92)).join('/')
  const known = STAGE_TOOLS.some(t => t.file === rel) || STAGE_REFS.some(r => rel === r.dir || rel.startsWith(r.dir + '/'))
  if (!known) throw new Error(`unknown stage asset: ${file}`)
  return readFileSync(join(STAGE_ASSETS_DIR.dir, STAGE_TOOLS.some(t => t.file === rel) ? 'stage-tools' : 'stage-refs', rel), 'utf8')
}
