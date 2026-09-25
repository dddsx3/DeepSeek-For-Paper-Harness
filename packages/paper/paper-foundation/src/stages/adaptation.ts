/**
 * 数字资产**适配台账** —— 每一类参考依赖的能力，都必须有本机适配选项。
 *
 * ## 这份台账要防的缺陷：**"只删了指令，没给替代"**
 *
 * 参考的 SKILL.md 依赖一批本 harness 没有的能力（文件工具、Python 门禁脚本、`_utils/`
 * 规则语料、模板、绘图库）。把"用 `cat _utils/writing_rules.md` 读规则"这句删掉很容易，
 * 但**那不等于适配**——它只是让指令消失了，而模型**仍然需要那份知识**。
 *
 * 我已经犯过一次：S3 的简报里只放了我**手写的摘要**，而参考的规则语料（`writing_rules.md`、
 * `error_prevention.md` 130KB、`figure_style_guide.md` 81KB、`figure_recipes_*.md` 41–135KB
 * 各一份）**一条都没进来**。那是简化，不是适配。
 *
 * 所以这份台账是**逐项声明**：每个阶段需要什么资产、怎么适配的、适配到什么程度、
 * 没适配的**本机选项是什么**。它进测试——`missing` 项必须写明 `option`，否则测试失败。
 *
 * ## 三种适配方式（都不是"删掉"）
 *
 * | 方式 | 含义 | 例 |
 * |---|---|---|
 * | `inlined` | 资产内容**内联进该阶段的简报** | 规则语料 → 简报的"本步知识"节 |
 * | `ported` | 资产**移植进仓库**并由 harness 使用 | 模板 → 渲染器资产；样式档 → 导出器 |
 * | `harness-side` | 原本由模型做的动作改由 **harness 执行** | 门禁脚本 → TS 门禁；文件读写 → harness |
 * | `tool-fetchable` | 资产**已在仓库**，由**只读工具按需取用**（参考 `cat` 的工具化） |
 * | `missing` | **尚未适配** —— 必须给出 `option`（本机怎么补） | 需要数值计算的 Python 库 |
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/adaptation
 */

import { STAGES, type StageId } from './registry.ts'

/** 参考资产的类别（按"依赖的能力"分，不按文件分）。 */
export type AssetClass =
  | 'rule_corpus'      // _utils/*.md 规则语料（写作规范、图表规范、防错清单…）
  | 'gate_script'      // _utils/*.py|*.sh 门禁脚本
  | 'file_io'          // 模型自己读写文件
  | 'template'         // 模板（HTML/TikZ/样式档/封面档）
  | 'python_compute'   // 需要 Python 生态的计算（绘图库、统计库、数据画像）
  | 'cli_flag'         // CLAUDE.md 的 MH_* 开关
  | 'arg_passing'      // $ARGUMENTS 取参数
  | 'docx_engine'      // Word 导出引擎

/** 一个阶段的某一类资产依赖，及其适配。 */
export interface AssetAdaptation {
  readonly stage: StageId
  readonly assetClass: AssetClass
  /** 参考里对应的具体文件/脚本（便于逐个核对，不是泛指）。 */
  readonly reference: string
  readonly mode: 'inlined' | 'ported' | 'harness-side' | 'tool-fetchable' | 'missing'
  /** 本机怎么适配的（`missing` 时写**可执行的补齐方案**）。 */
  readonly detail: string
  /**
   * 只有 `missing` 才需要：本机的补齐选项。
   * **空字符串即测试失败**——没有选项的 `missing` 就是"只删了指令"。
   */
  readonly option?: string
}

/**
 * 适配台账。
 *
 * 每一行都是"参考依赖 X → 本机用 Y"。**没有任何一行写"删掉"**。
 */
export const ADAPTATIONS: ReadonlyArray<AssetAdaptation> = [
  // ── 规则语料：当前最大的缺口（我 S3 只放了手写摘要） ──────────────────────
  {
    stage: 'paper', assetClass: 'rule_corpus', reference: '_utils/writing_rules.md + shared-references/writing-principles.md',
    mode: 'tool-fetchable',
    detail: '语料**已恢复**到 `src/stages/skill-docs/writing-rules.md`（58KB，索引在 `skill-docs.ts`）。'
      + '**不内联**：58KB 塞进 prompt 会把简报淹掉；参考原本也是让模型按需 `cat`。',
    option: '接线只读工具 `read_skill_doc(id)`（参考的 `cat _utils/x.md` 的工具化，与 `check_container` 同一条路）。'
      + '**工具落地前简报不点名这些文档**——点名一份取不到的文档就是新的"无法被遵守的指令"。',
  },
  {
    stage: 'result-sources', assetClass: 'file_io', reference: '参考：all_results.json 由代码写出，模型从不转录数值',
    mode: 'harness-side',
    detail: '**数不由模型持有**（用户口径）：模型只写 RESULT_SOURCES.json 声明定位，'
      + 'harness 真跑 code/main.py 后从产物字节里按 locator+json_path 铸出 results.json 账本'
      + '（execute-and-mint.ts，复用既有 resolveJsonPath）。前后一致与可追溯由此保证；'
      + '2024B 实测把数值转录交给模型时，两次被输出上限截断。',
  },
  {
    stage: 'figure-declare', assetClass: 'rule_corpus', reference: '_utils/figure_style_guide.md + figure_recipes_*.md',
    mode: 'tool-fetchable',
    detail: '语料**已恢复**到 `src/stages/skill-docs/`（figure-style-guide 80KB + 五份配方）。'
      + '本阶段是新拆出来的（建模代码与图表声明分属两阶段），语料依赖与原图表阶段同源，'
      + '由 `read_skill_doc` 按需取用。',
    option: '同 `read_skill_doc` 工具；本管线的模型调用没有工具回路，所以简报不点名这些文档。',
  },
  {
    stage: 'figure', assetClass: 'rule_corpus', reference: '_utils/figure_style_guide.md(81KB) + figure_recipes_*.md(41–135KB×5) + figure_exemplars.md(41KB)',
    mode: 'tool-fetchable',
    detail: '语料**已恢复**到 `src/stages/skill-docs/`（`figure-style-guide.md` 80KB + '
      + '`figure-exemplars.md` 41KB + 五份 `figure-recipes-*.md` 合计 362KB）。'
      + '**不内联**：五份配方合计 362KB。',
    option: '同 `read_skill_doc` 工具；模型按自己声明的 `chart_type` 取**对应那一份**（不是全读）。',
  },
  {
    stage: 'code', assetClass: 'rule_corpus', reference: '_utils/error_prevention_code.md(130KB) + references/checks/*.md(7份)',
    mode: 'tool-fetchable',
    detail: '语料**已恢复**到 `src/stages/skill-docs/`（`code-error-prevention.md` + '
      + '`code-checks-*.md` 七份检查清单 + 总索引）。',
    option: '同 `read_skill_doc` 工具；模型先读总索引，再按本题的方法类型取相关的那几份。',
  },
  // ── 门禁脚本：已做 harness-side，但 10 条能力仍缺 ─────────────────────────
  {
    stage: 'prob-analysis', assetClass: 'gate_script', reference: '_utils/capability_check.py + facts_audit.py',
    mode: 'harness-side',
    detail: '`figure_manifest_anchors` 与字节地板已实现为 TS 门禁；`capability_check` 显式给 code 2（无法判定）。',
    option: '实现 `capability_check`：需要先把逐句表定义成机器可读形态（句 → 类型 → 认领它的能力项 id）。',
  },
  {
    stage: 'modeling', assetClass: 'gate_script', reference: '_utils/modeling_coverage_check.py + count_subproblems.sh',
    mode: 'harness-side',
    detail: '`modeling_floor` 已实现；`count_subproblems` 的等价物是 `GateInput.problemCount`；`modeling_coverage` 给 code 2。',
    option: '实现 `modeling_coverage`：能力项 id 必须在 `MODELING_REPORT.md` 里被引用（逐条核对落地）。',
  },
  {
    stage: 'code', assetClass: 'gate_script', reference: '_utils/delivery_audit.py + leakage_audit.py + claim_code_check.py + data_ingest_check.py',
    mode: 'harness-side',
    detail: '`leakage_audit`（≥0.99 且无去泄漏证据即硬失败）与 `code_parity` 已实现；`delivery_audit` 给 code 2。',
    option: '实现 `delivery_audit`：核对 `DELIVERABLES.json` 声明的每个交付物**真的存在且非空**——'
      + '需要先定本 harness 的交付物清单形态（与 Result 的对应）。',
  },
  {
    stage: 'paper', assetClass: 'gate_script', reference: '_utils/paper_claim_check.py + writing_check.sh',
    mode: 'harness-side',
    detail: '字节地板/页数地板/LaTeX 残留已实现；`paper_claim_check` 给 code 2。',
    option: '**优先级最高**：`paper_claim_check` 是阶段 7"装配而非推理"这一前提的机械强制手段，'
      + '而零数字通道已有实现它所需的能力（Result/Claim ↔ 正文数字的对应），只待接上。',
  },
  // ── 模板：尚未移植 ────────────────────────────────────────────────────────
  {
    stage: 'diagram', assetClass: 'template', reference: 'paper-figure-html/templates/tpl_*.html(5份) + themes.css',
    mode: 'ported',
    detail: '五份模板 + 主题样式**已原样迁移**到 `src/stages/assets/diagram-templates/`（6 份 / 34KB，'
      + '模板是版式规范本身，不改写）。模板与阶段 5 简报的模板族**由测试钉成一一对应**'
      + '——简报写了不存在的模板名，模型就无从选起。渲染器已接上（`diagram-render.ts`）：'
      + '按图 id 前缀选模板，并把**模板身份与摘要**写进 `diagram-manifest.json`——'
      + '改了模板，清单即失效，所以"这张图按哪份模板画的"是可核的事实。'
      + '布局语义固化在 `figure/architecture.ts`（方案 B：确定性分层布局 → SVG，不引浏览器）。',
    option: '',
  },
  {
    stage: 'format-profile', assetClass: 'template', reference: 'tools/docx_style_profiles/competition_zh.json + covers/cumcm.json',
    mode: 'ported',
    detail: '两份 JSON **已原样迁移**到 `src/stages/assets/docx-profiles/`（数据不改写——改写数据等于换标准）；'
      + '适配的是用法：`resolveDocxProfile` 把阶段 9 的画像**叠加在国赛默认之上**，'
      + '缺失/非法/无识别字段时回退到默认并**给出具名原因**，绝不回退到"无格式"。'
      + '导出前校核（占位符/图片链接/表格列数）也已实现为 TS（`docxPrecheckFatal`）。',
  },
  {
    stage: 'docx-export', assetClass: 'docx_engine', reference: 'tools/docx-cn-engine/(md_to_docx.js + latex_to_omml.js + new_doc.js)',
    mode: 'ported',
    detail: '引擎文件**已迁移**到 `src/stages/assets/docx-engine/`（5 份 / 110KB）；'
      + '它的三个依赖 `docx` / `fast-xml-parser` / `temml` **已装进本包**'
      + '（`packages/paper/paper-foundation/package.json`），已实测跑通（`md_to_docx.js` 产出真 docx）。'
      + '导出走 `docx-export.ts`：校核 → 栅格化 → 引擎渲染，三段各有具名失败。'
      + '**没有换成 `export-docx.py`**：它对齐的是本仓库模板（dphpaper.cls 一系），'
      + '与迁移进来的国赛样式档不是同一套标准，混用会产出"样式档说 A、渲染器按 B 做"的文档。',
    option: '',
  },
  {
    stage: 'docx-export', assetClass: 'python_compute', reference: '参考的图由 matplotlib 直接出 PNG（350 DPI）',
    mode: 'harness-side',
    detail: '**参考侧不存在这一步**：它的图是位图，直接嵌进 Word。本 harness 的图是 SVG'
      + '（`figure/renderer.ts` 的确定性输出，矢量、与分辨率无关），而迁移进来的引擎只嵌位图'
      + '（png/jpg/gif/bmp）——不补这一步，Word 里会是 "[unsupported image]" 占位符。'
      + '所以由 harness 侧补一次 SVG → PNG 栅格化（`cairosvg`，**300 DPI**，'
      + '与参考的图质量地板一致），依赖探测复用既有的 `probeExportDeps`（cairosvg 早就在那张表里，'
      + 'purpose 写的正是"SVG → PNG（300dpi 图嵌入）"）。栅格化不可用时**具名拒绝导出**，'
      + '不静默嵌占位符。图链接的 `.svg → .png` 只发生在导出用的派生副本 `_export.md` 上，'
      + '`paper/main.md` 保持原样。',
    option: '',
  },
  {
    stage: 'format-check', assetClass: 'gate_script', reference: 'docx-format-check/SKILL.md 的五类检查（代码块/公式编号/三线表/图片引用/噪声）',
    mode: 'harness-side',
    detail: '`format_check_report`（报告 ≥200 字节、**即使全过也要出报告**）已实现为 TS 门禁；'
      + '五类检查本身与"就地安全修复"（`（）`→` ()`、`$$X$$`→`$X$`、围栏语言标记只有 100% 可推断才补）尚未实现。',
    option: '把五类检查写成 TS 纯函数（都只读 Markdown 文本，无需 Python）；'
      + '安全修复必须带**逐字比对**（改动前后除目标模式外必须完全相同），否则"自动修复"会变成"自动改坏"。',
  },
  {
    stage: 'format-check', assetClass: 'file_io', reference: 'docx-format-check/SKILL.md: 就地编辑 TARGET_FILE 的 Markdown',
    mode: 'harness-side',
    detail: '模型不写文件；安全修复由 harness 施加，且必须可回滚（保留改动前的文本用于比对）。',
  },
  // ── Python 计算：未接，但有明确的适配选项 ────────────────────────────────
  {
    stage: 'figure', assetClass: 'python_compute', reference: '_utils/plot_utils.py(104KB, setup_style 强制) + get_recipe.py',
    mode: 'harness-side',
    detail: '本 harness 的图由 `figure/producer.ts` 声明驱动渲染（TS），不走 matplotlib，'
      + '所以绘图库**不移植**。它的**规范**已经迁移——`figure-style-guide.md`(80KB) 与五份配方'
      + '在 `skill-docs/` 里，由 `read_skill_doc` 取用；简报的禁令（禁 plt.title / 禁默认色板 /'
      + '≥300DPI / 字号 ≥9pt）也逐条写进了阶段 4 的 `forbidden`。'
      + '**规范已做成可核的门禁**（这一步就是补齐）：`figure_style_rules` 只读 SVG 字节，'
      + '判三条——印刷质量（字号/边界/对比度，复用 `checkFigureQuality`）、配色禁令'
      + '（tab10 / RdYlGn / RdBu_r / dark_background / CSS 颜色名）、图内不得有标题。'
      + '顺带修掉一个**代码与自己的契约相反**的地方：标量渲染路径原本把 caption 画进了 SVG，'
      + '而模块头的契约写着"从不输出 caption 到 SVG 内部"——契约是对的（参考禁 plt.title），'
      + '改的是代码。',
    option: '',
  },
  {
    stage: 'prob-analysis', assetClass: 'python_compute', reference: '_utils/data_profile.py + stats_utils.py',
    mode: 'missing',
    detail: '`DATA_PROFILE.json` 要求对附件做画像，但本仓库没有画像器。'
      + '**这一条仍然缺**，而且缺的不是算法而是**接线位置**：阶段 1 是模型阶段，'
      + '`runStages` 对它只调 `callModel` 并落盘，没有 harness 侧的钩子；'
      + '把画像器挂上去要给阶段执行器加一个"模型阶段也可以有 harness 侧后处理"的机制——'
      + '那是 S6（CLI 接线）范围内的一次设计，不是阶段 4/5/10/11 执行体的一部分。'
      + '**不假装已经适配**：写一个用不上的 TS 画像器，正是"模块做好不等于进了主线"那类缺陷。',
    option: '两个选项：① 给阶段执行器加 harness 侧后处理钩子，用 TS 实现基础画像'
      + '（行列数、缺失率、数值列分布）；② 调沙箱里的 Python（harness 已有 code runner，跑 `python` 是既有能力）。'
      + '**优先 ①**——画像不需要统计生态，而 ② 会把"能跑代码"扩到 pipeline 内部，那是另一层权限。',
  },
  // ── 已适配好的（列出来是为了让台账完整，不是凑数） ────────────────────────
  {
    stage: 'prob-analysis', assetClass: 'file_io', reference: 'SKILL.md: 用 Write 写 PROBLEM_ANALYSIS.md',
    mode: 'harness-side',
    detail: '模型只产出**内容**；harness 落盘到 `stages/NN-id/` 并把上游产物内联给下一阶段。'
      + '本管线的模型调用没有通用文件工具（round-5 的教训：宪法里"用 read_file 读 skills/x.md"是'
      + '一条无法被遵守的指令）。',
  },
  {
    stage: 'modeling', assetClass: 'file_io', reference: 'SKILL.md: 用 Write 写 MODELING_REPORT.md',
    mode: 'harness-side',
    detail: '同上；且上游的 `PROBLEM_ANALYSIS.md` 由 harness **内联**进简报（不是"让模型去读"）。',
  },
  {
    stage: 'review', assetClass: 'file_io', reference: 'SKILL.md: cat 大型 JSON 被禁止，只能 summarize/Grep',
    mode: 'harness-side',
    detail: '参考禁止模型 `cat` 大 JSON——本机更彻底：模型**从不读文件**，'
      + 'harness 只内联它需要的切片（大产物按需截取，见 S5 的注入策略）。',
  },
  {
    stage: 'improve', assetClass: 'cli_flag', reference: 'CLAUDE.md: MH_FAST_MODE / MH_AI_DISCLOSURE',
    mode: 'harness-side',
    detail: 'harness 选项（`--mode fast` 等）；本阶段是自创技能，不依赖参考的开关。',
  },
  {
    stage: 'format-profile', assetClass: 'arg_passing', reference: 'SKILL.md: $ARGUMENTS 传目标文件',
    mode: 'harness-side',
    detail: '阶段输入由 harness 注入（`consumes` 在注册表里声明），模型不取参数。',
  },
]

/** 台账里**尚未适配**的项（需要补齐）。 */
export function missingAdaptations(): ReadonlyArray<AssetAdaptation> {
  return ADAPTATIONS.filter(a => a.mode === 'missing')
}

/** 某阶段涉及的资产类别（用于"这个阶段的适配齐了没有"）。 */
export function assetClassesOf(stage: StageId): ReadonlyArray<AssetClass> {
  return [...new Set(ADAPTATIONS.filter(a => a.stage === stage).map(a => a.assetClass))]
}

/**
 * 每个阶段都必须在台账里有记录吗？
 *
 * **不是**。台账只记"参考依赖了某类资产"的阶段；一个阶段没有任何一行，含义是
 * "它不依赖参考的任何外部资产"（如阶段 8/11 是自创技能）。但**依赖了却没记录**是缺陷。
 *
 * @returns 有技能内容但台账里一行都没有的阶段（供人工核对，不自动判失败）。
 */
export function stagesWithoutAdaptationRows(): ReadonlyArray<StageId> {
  return STAGES.filter(s => ADAPTATIONS.every(a => a.stage !== s.id)).map(s => s.id)
}
