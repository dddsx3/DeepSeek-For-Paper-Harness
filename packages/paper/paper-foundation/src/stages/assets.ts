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
