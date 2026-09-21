/**
 * PaperSkeleton (DPH-PRD-v2 P0-7, W8; 路线书 R5①/D3) — the 12-chapter paper
 * structure, aligned to the reference deliverable (REF-D: 摘要 / 问题重述 /
 * 问题分析 / 模型假设 / 符号说明 / 模型建立与求解 / 结果对比与校核 / 模型评价与
 * 推广 / AI 声明 / 参考文献 / 数据附录 / 代码附录).
 *
 * The skeleton is DATA (a closed list of sections with their slots), not
 * a renderer. The renderer (`renderPaperSkeleton`) fills the machine-owned
 * slots (符号表/假设表/要求表 + 摘要/结果/AI 声明/数据附录) from the canonical
 * IR and leaves the prose slots for content. The 12 titles are the
 * delivery contract: a paper that renders the skeleton has all 12 sections
 * present (路线书 D3: 12 章 + 摘要 + AI 声明 + 参考文献 + 附录，无空槽 —
 * 机器槽自动填，散文槽由内容提供，缺则渲染占位标注，不再静默缺失).
 */

/** One paper section: a fixed title + which slots it carries. */
export interface SectionSpec {
  readonly id: string
  readonly title: string
  /**
   * prose: 模型/外部内容写入（缺则占位标注，不静默缺失）;
   * symbols/assumptions/requirements: auto from canonical IR;
   * abstract/results/ai_disclosure/data_appendix: auto from renderer inputs
   * (machine-generated content — 摘要数字必须回读 Result).
   */
  readonly kind: 'prose' | 'symbols' | 'assumptions' | 'requirements' | 'abstract' | 'results' | 'ai_disclosure' | 'data_appendix'
}

/** The closed 12-section skeleton (路线书 D3). */
export const PAPER_SECTIONS: ReadonlyArray<SectionSpec> = [
  { id: 'abstract', title: '摘要', kind: 'abstract' },
  { id: 'restatement', title: '问题重述', kind: 'prose' },
  { id: 'analysis', title: '问题分析', kind: 'prose' },
  { id: 'assumptions', title: '模型假设', kind: 'assumptions' },
  { id: 'symbols', title: '符号说明', kind: 'symbols' },
  { id: 'model', title: '模型建立与求解', kind: 'prose' },
  { id: 'results', title: '结果对比与校核', kind: 'results' },
  { id: 'evaluation', title: '模型评价与推广', kind: 'prose' },
  { id: 'ai_disclosure', title: 'AI 声明', kind: 'ai_disclosure' },
  { id: 'references', title: '参考文献', kind: 'prose' },
  { id: 'data_appendix', title: '数据附录', kind: 'data_appendix' },
  { id: 'code', title: '代码附录', kind: 'prose' },
]

/** The 12 section titles, for skeleton-presence gates (precheck etc). */
export const PAPER_SECTION_TITLES: ReadonlyArray<string> = PAPER_SECTIONS.map(s => s.title)

/** A single IR-derived row for a machine-owned table. */
export interface AutoRow {
  readonly id: string
  readonly columns: ReadonlyArray<string>
}

export interface PaperSkeletonInput {
  readonly title: string
  /** Auto rows for the 符号说明 section (from SymbolSpecs). */
  readonly symbols?: ReadonlyArray<AutoRow>
  /** Auto rows for the 模型假设 section (from AssumptionSpecs). */
  readonly assumptions?: ReadonlyArray<AutoRow>
  /** Auto rows for a REQUIRED_OUTPUTs table in 问题重述. */
  readonly requirements?: ReadonlyArray<AutoRow>
  /** W11.5 baseline-20 (审计 B-2/B-3): the declared equations, rendered into
   *  模型建立与求解 — the chapter is IR-backed, not model prose. */
  readonly equations?: ReadonlyArray<AutoRow>
  /** The declared models (objective / constraints / refs), same chapter. */
  readonly models?: ReadonlyArray<AutoRow>
  /**
   * W8.5 (B1): real content per section id. A prose section with a slot
   * uses it verbatim; without one it renders the placeholder. This is how
   * the delivery chain fills 结论/方法/图表 into the skeleton — one
   * renderer, one path.
   */
  readonly slots?: Readonly<Record<string, string>>
}

/**
 * Render the skeleton to markdown: every section title present, machine
 * slots rendered from the IR + renderer-provided auto content, prose slots
 * filled from `slots` or a visible placeholder (the section EXISTS — D3).
 */
export function renderPaperSkeleton(input: PaperSkeletonInput): string {
  const lines: string[] = []
  lines.push(`# ${input.title}`)
  lines.push('')
  for (const section of PAPER_SECTIONS) {
    lines.push(`## ${section.title}`)
    lines.push('')
    const slot = input.slots?.[section.id]
    if (section.kind === 'symbols') {
      lines.push(renderTable(['符号', '含义', '单位'], input.symbols ?? [], '(符号表由规范 IR 自动生成)'))
    } else if (section.kind === 'assumptions') {
      lines.push(renderTable(['假设', '来源', '风险', '可检验'], input.assumptions ?? [], '(假设表由规范 IR 自动生成)'))
    } else if (section.id === 'model') {
      // W11.5 baseline-20 (审计 B-2/B-3「虎头蛇尾」): the 模型建立与求解 chapter is
      // filled from the canonical IR — every EquationSpec the container declared
      // (expression + unit) and every ModelSpec (objective, constraints) — so the
      // chapter carries the ACTUAL model rather than a one-line summary, and it
      // cannot be missing while the model exists in the IR. The model's own
      // `methods` prose, when present, stays underneath.
      if ((input.equations?.length ?? 0) > 0) {
        lines.push('### 方程')
        lines.push('')
        lines.push(renderTable(['方程', '表达式', '类型', '单位'], input.equations ?? [], '(方程表由规范 IR 自动生成)'))
        lines.push('')
      }
      if ((input.models?.length ?? 0) > 0) {
        lines.push('### 模型')
        lines.push('')
        lines.push(renderTable(['模型', '目标', '约束', '引用'], input.models ?? [], '(模型表由规范 IR 自动生成)'))
        lines.push('')
      }
      if (slot !== undefined && slot.trim() !== '') {
        lines.push(slot)
      } else if ((input.equations?.length ?? 0) === 0 && (input.models?.length ?? 0) === 0) {
        lines.push('_(模型待写入)_')
      }
    } else if (section.id === 'restatement' && (input.requirements?.length ?? 0) > 0) {
      // PRD §5.1.4: 问题重述 — the REQUIRED_OUTPUTs (from IR) render as
      // the "what must be produced" table under this section.
      lines.push(renderTable(['要求', '说明'], input.requirements ?? [], '(问题要求由规范 IR 自动生成)'))
      if (slot !== undefined && slot.trim() !== '') {
        lines.push('')
        lines.push(slot)
      }
    } else if (section.kind === 'abstract' || section.kind === 'results' || section.kind === 'ai_disclosure' || section.kind === 'data_appendix') {
      // machine-generated sections: the renderer SUPPLIES their content;
      // a missing supply is a visible gap marker, never a silent skip.
      lines.push(slot !== undefined && slot.trim() !== '' ? slot : '_(本机器槽未生成内容：渲染器未提供)_')
    } else if (slot !== undefined && slot.trim() !== '') {
      lines.push(slot)
    } else {
      lines.push('_(模型待写入)_')
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Render one markdown table (auto rows) with a fallback note. */
function renderTable(headers: ReadonlyArray<string>, rows: ReadonlyArray<AutoRow>, fallback: string): string {
  if (rows.length === 0) return fallback
  const lines: string[] = []
  lines.push(`| ${headers.join(' | ')} |`)
  lines.push(`|${headers.map(() => '---').join('|')}|`)
  for (const row of rows) {
    lines.push(`| ${row.columns.map(cellText).join(' | ')} | [${row.id}]`)
  }
  return lines.join('\n')
}

/**
 * One table cell as a SINGLE markdown line.
 *
 * W11.5 baseline-10 (首次 A-produce-chain 交付): the 问题重述 table injects the
 * requirement's `statement` verbatim, and for a competition problem that
 * statement IS the whole problem text — hundreds of characters with embedded
 * newlines. Printed as-is it split one row across many physical lines and the
 * table stopped being a table: the docx pre-export gate refused the first real
 * chain-delivered paper with `table_columns` ("6 张表，1 张列数不一") — a defect
 * in the harness's own injection, not in the model's text.
 *
 * Newlines collapse to a space and pipes are escaped; nothing is dropped, so
 * the statement stays readable and the row stays one row.
 */
function cellText(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
}
