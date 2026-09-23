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
    mode: 'missing',
    detail: '简报里写了"五种模板族"，但模板文件本身没进仓库——渲染器无模板可用。',
    option: '把五份模板与主题样式移植进 `src/stages/assets/diagram-templates/`，由阶段 5 的渲染器读取。',
  },
  {
    stage: 'format-profile', assetClass: 'template', reference: 'tools/docx_style_profiles/competition_zh.json + covers/cumcm.json',
    mode: 'missing',
    detail: '参考有现成的国赛样式档（A4/2.5cm 边距/SimHei 标题/SimSun 正文/12pt 1.5 倍行距/三线表 1.5-0.75-1.5pt）'
      + '与封面档（承诺书 + 9 个表单字段），本仓库没有。',
    option: '移植这两个 JSON 作为**默认画像与封面**：`_text_profile.json` 缺失或非法时回退到它，'
      + '而不是回退到"无格式"。这是"本机适配选项"的典型——参考的能力不丢，只是改成 harness 侧默认值。',
  },
  {
    stage: 'docx-export', assetClass: 'docx_engine', reference: 'tools/docx-cn-engine/(md_to_docx.js + latex_to_omml.js + new_doc.js)',
    mode: 'missing',
    detail: '阶段 11 的导出引擎（`md_to_docx.js` + `latex_to_omml.js` + `new_doc.js`）未接；'
      + '本仓库现有的 `scripts/export-docx.py` 对齐的是本仓库模板（dphpaper.cls 一系），'
      + '**不是**参考的国赛样式档，两者不可互换。',
    option: '移植引擎（Node 实现，与本仓库同运行时，可直接调用）；或复用仓库既有的 '
      + '`scripts/export-docx.py`（已在本管线里跑通，但它对齐的是本仓库模板而非国赛样式档）。'
      + '**二选一并写明**：引擎换了，样式档的对应关系也要跟着换。',
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
    mode: 'missing',
    detail: '本 harness 的图由 `figure/producer.ts` 声明驱动渲染（TS），不走 matplotlib。'
      + '所以参考的绘图库**不需要移植**——但它的**风格规范**（setup_style 的等价物）需要。',
    option: '把 `setup_style` 的**规范**（字号下限 9pt、灰度可区分、禁默认色板、300DPI）移植进 TS 渲染器；'
      + '绘图库本身不移植。**这是一次真正的适配**：能力等价物换了实现，规范一条不丢。',
  },
  {
    stage: 'prob-analysis', assetClass: 'python_compute', reference: '_utils/data_profile.py + stats_utils.py',
    mode: 'missing',
    detail: '`DATA_PROFILE.json` 要求对附件做画像，但本仓库没有画像器。',
    option: '两个选项：① 用 TS 实现基础画像（行列数、缺失率、数值列分布）；'
      + '② 调沙箱里的 Python（harness 已有 code runner，跑 `python` 是既有能力）。'
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
