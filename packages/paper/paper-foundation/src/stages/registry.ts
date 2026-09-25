/**
 * 11 阶段注册表 —— **把设计落成代码，而不是散文**。
 *
 * 每一列都是**判据的来源**，少一列对应的事就退化成"靠人记得"：
 * `kind` 少了 → 确定性阶段被当模型阶段跑（阶段 4/5/10/11 不需要模型调用）；
 * `consumes` 少了 → 回滚时不知道该作废谁；`produces` 少了 → "产出齐没齐"只能靠人看
 * （参考工作流的 `DELIVERABLES.json` 就是这一列）；`contractRules` 少了 → 判据漂移
 * （**当前头号拒绝"参考文献↔方法"曾经就没有归属**）；`rollbackTo` 少了 → 回滚只能整链重跑；
 * `guidedFallback` 少了 → 弱模型兜底无处落地。
 *
 * ## 与既有 T1/T2/T3 的关系：两个正交的轴
 *
 * **阶段**回答"产出什么、按什么顺序、契约与门禁"；**档位**回答"对这个模型给多少引导"。
 * 阶段是主路径，档位是**阶段内部的降级机制**（`guidedFallback`）。"任何模型都能交付"
 * 由档位阶梯承接，不在阶段层重复实现。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/registry
 */

/** 阶段 id（顺序即流水线顺序）。 */
export const STAGE_IDS = [
  'prob-analysis', 'modeling', 'code', 'figure-declare', 'figure', 'diagram', 'review',
  'paper', 'improve', 'format-profile', 'format-check', 'docx-export',
] as const
export type StageId = (typeof STAGE_IDS)[number]

/** 一份可校验的产出（对齐参考工作流 `DELIVERABLES.json` 的条目形态）。 */
export interface DeliverableSpec {
  /** 相对 `stages/<NN-id>/` 的文件名。 */
  readonly file: string
  readonly kind: 'md' | 'json' | 'py' | 'svg' | 'docx' | 'xlsx' | 'dir'
  readonly minBytes?: number
  readonly desc: string
  /**
   * `true` = 这份产物由 **harness 铸出**（阶段 3 的 `results.json`），不在模型的
   * 回答信封契约里——模型只声明"数在哪"，数由真实执行产生。缺省 false。
   */
  readonly harnessMinted?: true
}

/**
 * 正文契约规则的**归属**。id 与 `delivery/prose-contracts.ts` 的规则一一对应。
 *
 * 之所以要在注册表里再列一遍：**规则定义在哪、在哪被检查是两件事**。`prose_contract`
 * 覆盖的八章横跨阶段 2 与阶段 7，不逐条挂靠就会出现"最常触发的拒绝找不到自己的门"。
 */
export type ContractRuleId =
  | 'analysis_per_question' | 'evaluation_four_elements' | 'references_method_keyword'
  | 'code_appendix_names_questions' | 'floor_analysis' | 'floor_evaluation'
  | 'floor_code' | 'floor_references' | 'floor_restatement' | 'blank_area'

/** 一个阶段。 */
export interface StageSpec {
  readonly id: StageId
  readonly index: number
  /** `deterministic` = 纯 harness 计算，**不得消耗模型调用**。 */
  readonly kind: 'model' | 'deterministic'
  readonly title: string
  /** 参考工作流里的技能 id（阶段 8/11 参考没有技能，这两段是自写）。 */
  readonly skillId: string
  readonly consumes: ReadonlyArray<string>
  readonly produces: ReadonlyArray<DeliverableSpec>
  /** 门禁 id（S2 实现，0/1/2 语义）。 */
  readonly gates: ReadonlyArray<string>
  readonly contractRules: ReadonlyArray<ContractRuleId>
  /** 本阶段失败时**可以回滚到**哪些阶段（必须更早）。 */
  readonly rollbackTo: ReadonlyArray<StageId>
  readonly guidedFallback?: 'T2' | 'T3'
  /** 本阶段的**成立前提**（一句话；有的前提被门禁机械强制）。 */
  readonly premise?: string
}

const D = (
  file: string,
  kind: DeliverableSpec['kind'],
  desc: string,
  minBytes?: number,
  harnessMinted?: true,
): DeliverableSpec =>
  ({ file, kind, desc, ...(minBytes === undefined ? {} : { minBytes }), ...(harnessMinted === undefined ? {} : { harnessMinted }) })

/** 阶段表。顺序、产物名、字节地板与门禁 id 对齐参考工作流。 */
export const STAGES: ReadonlyArray<StageSpec> = [
  {
    id: 'prob-analysis', index: 1, kind: 'model', title: '赛题分析', skillId: 'comp-prob-analysis',
    consumes: ['00-input/problem.txt', '00-input/attachments.json'],
    produces: [
      D('PROBLEM_ANALYSIS.md', 'md', '赛题分析：逐句表 + 硬约束 + FIGURE_MANIFEST + 假设/需求锚点', 1500),
      D('CAPABILITY_CHECKLIST.json', 'json', '跨阶段契约：required_output / machine_check / source_sentence'),
      D('PROBLEM_FACTS.json', 'json', '题面给定值事实表（防读题读错，与零数字通道正交）'),
      D('DATA_PROFILE.json', 'json', '附件数据画像'),
    ],
    gates: ['prob_analysis_floor', 'figure_manifest_anchors', 'capability_check'],
    contractRules: [], rollbackTo: [], guidedFallback: 'T3',
    premise: '本阶段的自由分析**就是 E1**：带 `[[ASSUMPTION: id]]` / `[[REQUIREMENT: id]]` 行首锚点，'
      + '是保真门 B3/B4/B5 的锚。拆掉它，保真门与"逐问段 → 章节"的路由都失去依据。',
  },
  {
    id: 'modeling', index: 2, kind: 'model', title: '建模求解', skillId: 'comp-modeling',
    consumes: ['01-prob-analysis/PROBLEM_ANALYSIS.md', '01-prob-analysis/CAPABILITY_CHECKLIST.json'],
    produces: [
      D('DECLARATION.json', 'json', 'IR 声明（Symbol/Assumption/Equation/ModelSpec）——**2a 次调用**'),
      D('MODELING_REPORT.md', 'md', '建模求解报告（富散文：推理、被否方案、难点）——**2b 次调用**', 1500),
    ],
    gates: ['modeling_floor', 'modeling_coverage', 'modeling_self_check'],
    contractRules: ['analysis_per_question', 'evaluation_four_elements', 'floor_analysis', 'floor_evaluation'],
    rollbackTo: ['prob-analysis'], guidedFallback: 'T2',
    premise: '**两次调用，不是一次**：2a 只声明 IR 条目（小、结构化、可被 check_container 自检）；'
      + '2b 只写富散文（无 JSON，**结构上不可能撞 parse_failed**）。合成一次会回到 E2 的 40KB 规模。',
  },
  {
    id: 'code', index: 3, kind: 'model', title: '编程实现', skillId: 'comp-code',
    consumes: ['02-modeling/MODELING_REPORT.md', '02-modeling/DECLARATION.json'],
    produces: [
      D('code/main.py', 'py', '编排入口：依次跑各问并汇总', 500),
      D('code/', 'dir', '逐问实现：`problem*.py`，文件数 ≥ 题面问数（逐问奇偶校验）'),
      D('RESULTS.md', 'md', '结果说明', 1024),
      D('DELIVERABLES.json', 'json', '机器可校验的产出清单（kind/min_rows/min_bytes/desc）'),
      D('RESULT_SOURCES.json', 'json', '**数在哪**：`[{result_id, name, locator, json_path, unit}]`——模型只声明定位，不写数值'),
      D('results.json', 'json', '**harness 铸出的数**：真跑代码后按 locator+json_path 从产物字节读出（模型从头到尾不持有数值）', undefined, true),
    ],
    gates: ['code_parity', 'results_minted', 'delivery_audit', 'leakage_audit', 'no_render'],
    contractRules: ['code_appendix_names_questions', 'floor_code'],
    rollbackTo: ['modeling', 'prob-analysis'], guidedFallback: 'T2',
    premise: '**建模代码与图表声明分属两个阶段**（2024B 实测：合在一个阶段把回答顶过输出上限，'
      + '且图声明会诱导模型转写数值）。**数从哪来不由模型持有**：模型在 RESULT_SOURCES.json '
      + '里只写"哪个文件、哪个路径"，harness 真跑代码后从产物字节里铸出 results.json——'
      + '前后一致（图画的数=代码产出的数）且可追溯（每个数定位到一次真实执行）。',
  },
  {
    id: 'figure-declare', index: 4, kind: 'model', title: '图表声明', skillId: 'comp-figure-declare',
    consumes: ['03-code/results.json', '01-prob-analysis/PROBLEM_ANALYSIS.md'],
    produces: [D('FIGURE_DECLARATIONS.json', 'json', '数据图的**声明**（figure_id/chart_type/data_refs/caption）；渲染是下一阶段的事')],
    gates: ['figure_declaration_complete'],
    contractRules: [], rollbackTo: ['code'], guidedFallback: 'T2',
    premise: '**声明与渲染分属两阶段、与建模代码分属两阶段**：本阶段只引用 harness 铸出的 '
      + 'Result id 组织图，不写渲染代码、不产出图像字节、不写任何数值（题注里的数'
      + '也会被守卫拒绝）。分叉计划必须用 plan_deviations 申报。',
  },
  {
    id: 'figure', index: 5, kind: 'deterministic', title: '图表生成', skillId: 'paper-figure',
    consumes: ['04-figure-declare/FIGURE_DECLARATIONS.json', '03-code/results.json', '01-prob-analysis/PROBLEM_ANALYSIS.md'],
    produces: [
      D('figures/', 'dir', '按声明渲染的图（声明驱动，不写渲染代码）'),
      D('figure-manifest.json', 'json', '渲染清单：图 id → 文件 → 数据引用 → 渲染哈希'),
    ],
    gates: ['figure_manifest_reconcile', 'figure_style_rules'],
    contractRules: [], rollbackTo: ['figure-declare', 'code'],
    premise: '**渲染是 harness 的事**：模型只声明 `chart_type/data_refs/caption`，'
      + '图里的每个数都必须先作为 Result 存在。这一条由 `figure_declaration_complete`'
      + '（每条 ref 都要解析到真有的 Result）与 `figure_style_rules`（字号/配色/无图内标题）'
      + '机械强制——没有它们，"声明驱动"只是一句设计意图。',
  },
  {
    id: 'diagram', index: 6, kind: 'deterministic', title: '流程与架构图绘制', skillId: 'paper-figure-html',
    consumes: ['01-prob-analysis/PROBLEM_ANALYSIS.md'],
    produces: [
      D('figures/fig_roadmap.svg', 'svg', '流程 / 架构 / 路线图（按清单逐张渲染）'),
      D('diagram-manifest.json', 'json', '架构图清单：图 id → 模板 → 模板摘要 → 风格族；含够不到的图'),
    ],
    gates: ['diagram_manifest_reconcile', 'diagram_geometry'],
    contractRules: [], rollbackTo: ['prob-analysis'],
    premise: '**结构也要声明**：`FIGURE_MANIFEST` 只给图名（参考里就是如此），给不出层/'
      + '节点/连线。所以阶段 1 另立一份 `ARCH_DECLARATION` 块——与阶段 4 同一条纪律。'
      + 'TikZ 几何族需要 LaTeX 引擎，本仓库没有：那几张**如实标注够不到**，门禁给 `2` 不给 `0`。',
  },
  {
    id: 'review', index: 7, kind: 'model', title: '逻辑对抗复核', skillId: 'comp-review',
    consumes: ['02-modeling/MODELING_REPORT.md', '03-code/RESULTS.md', '01-prob-analysis/PROBLEM_ANALYSIS.md'],
    produces: [
      D('COMP_REVIEW.md', 'md', '逻辑对抗复核（含 L5 三视角评审）'),
      D('COMP_REVIEW_VERDICT.json', 'json', 'findings[] + fatal_count —— **fatal>0 必须回滚**'),
    ],
    gates: ['review_fatal_count'],
    contractRules: [], rollbackTo: ['modeling', 'code'], guidedFallback: 'T3',
    premise: '**L5 由本阶段承载**，不是与它并列的第二套评审：三视角（reviewPersonasOf）在本阶段内部跑，'
      + '外加 comp-review 的 fatal_count 门。',
  },
  {
    id: 'paper', index: 8, kind: 'model', title: '论文撰写', skillId: 'comp-paper-zh-docx',
    consumes: ['01-prob-analysis/PROBLEM_ANALYSIS.md', '02-modeling/MODELING_REPORT.md', '03-code/RESULTS.md', '05-figure/figure-manifest.json'],
    produces: [D('paper/main.md', 'md', '论文正文（单文件）', 5120)],
    gates: ['paper_floor', 'paper_page_floor', 'no_latex_residue', 'upstream_min_chars', 'paper_claim_check'],
    contractRules: ['references_method_keyword', 'floor_references', 'floor_restatement', 'blank_area'],
    rollbackTo: ['modeling', 'code', 'prob-analysis'], guidedFallback: 'T3',
    premise: '**本阶段 = 装配（上游产物 → 论文），不产生新的建模推理**，所以能一次写完而不重犯散文'
      + '单体问题。这个前提**被机械强制**：`paper_claim_check=0 才准写` 要求每条将写进论文的结果'
      + '在上游已有已核验的落地。',
  },
  {
    id: 'improve', index: 9, kind: 'model', title: '论文改进循环', skillId: 'auto-paper-improvement-loop',
    consumes: ['08-paper/paper/main.md', '07-review/COMP_REVIEW_VERDICT.json'],
    produces: [
      D('PAPER_IMPROVEMENT_STATE.json', 'json', '改进状态：轮次、缺陷数序列、终止原因'),
      D('paper/_improvement_rounds/', 'dir', '每一轮的稿子（保留全部轮次）'),
    ],
    gates: ['improve_terminated'],
    contractRules: [], rollbackTo: ['paper'],
    premise: '**终止条件是两条，不是"超时"**（round-5 的结论：缺的不是额度，是终止条件）：'
      + '① **批准即收口**——检查器报零缺陷时立即停；② **三轮无进展即停**——"进展" = 缺陷数**严格下降**，'
      + '连续三轮无下降则停并**如实报告未收敛**（不自行宣布定稿）。',
  },
  {
    id: 'format-profile', index: 10, kind: 'model', title: '解析格式要求', skillId: 'format-profile',
    consumes: ['00-input/FORMAT_REQUIREMENTS.md'],
    produces: [D('_text_profile.json', 'json', '**只此一个文件**；严格单文件产出', 300)],
    gates: ['profile_single_file', 'profile_valid_json'],
    contractRules: [], rollbackTo: [], guidedFallback: 'T3',
    premise: '输入实测是**自由文本**（"论文题目：三号黑体字，居中显示"），所以是模型阶段；'
      + '但字号/字体术语是**有限词表**，常见措辞走确定性快路，只有未识别措辞回退模型。',
  },
  {
    id: 'format-check', index: 11, kind: 'deterministic', title: 'Markdown 格式自检与修复', skillId: 'docx-format-check',
    consumes: ['08-paper/paper/main.md'],
    produces: [D('DOCX_FORMAT_CHECK_REPORT.md', 'md', '五类检查报告（**即使全过也要出报告**）', 200)],
    gates: ['format_check_report'],
    contractRules: [], rollbackTo: [],
    premise: '**非阻塞**：未消解的人工项照写报告，`exit 0`。',
  },
  {
    id: 'docx-export', index: 12, kind: 'deterministic', title: '格式检查与导出', skillId: 'docx-export',
    consumes: [
      '08-paper/paper/main.md', '10-format-profile/_text_profile.json',
      '05-figure/figure-manifest.json', '06-diagram/diagram-manifest.json',
    ],
    produces: [
      D('paper/main.docx', 'docx', '目标格式交付物'),
      D('DOCX_EXPORT_REPORT.md', 'md', '导出报告：依赖探测 / 画像来源与回退原因 / 栅格化 / 校核结论', 200),
    ],
    gates: ['docx_precheck', 'docx_exported'],
    contractRules: [], rollbackTo: [],
    premise: '参考工作流里本阶段没有技能（只有引擎与产物形态），**本阶段的技能是自写的**。',
  },
]

/** 按 id 取阶段。 */
export function stageOf(id: StageId): StageSpec {
  const found = STAGES.find(s => s.id === id)
  if (found === undefined) throw new Error(`unknown stage id: ${id}`)
  return found
}

/** 阶段目录名（`01-prob-analysis`）。 */
export function stageDirName(spec: StageSpec): string {
  return `${String(spec.index).padStart(2, '0')}-${spec.id}`
}

/** 需要模型调用的阶段（预算按这个集合估）。 */
export const MODEL_STAGES: ReadonlyArray<StageSpec> = STAGES.filter(s => s.kind === 'model')

/** 纯 harness 阶段 —— **不得消耗模型调用**。 */
export const DETERMINISTIC_STAGES: ReadonlyArray<StageSpec> = STAGES.filter(s => s.kind === 'deterministic')
