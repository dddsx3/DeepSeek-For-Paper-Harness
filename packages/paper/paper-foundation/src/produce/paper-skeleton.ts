/**
 * PaperSkeleton (DPH-PRD-v2 P0-7, W8) — the 10-section paper structure.
 *
 * PRD §5.1.4: 论文骨架 = 摘要 / 问题重述 / 问题分析 / 模型假设 / 符号
 * 说明 / 模型建立与求解 / 模型检验 / 模型评价 / 参考文献 / 代码附录.
 *
 * The skeleton is DATA (a closed list of sections with their slots), not
 * a renderer. The renderer (`renderPaperSkeleton`) fills the machine-owned
 * slots (符号表/假设表) from the canonical IR and leaves the prose slots
 * for the model. The 10 titles are the delivery contract: a paper that
 * renders the skeleton has all 10 sections present (M4 骨架完整率 100%).
 */

/** One paper section: a fixed title + which slots it carries. */
export interface SectionSpec {
  readonly id: string
  readonly title: string
  /** prose: model-written; symbols: auto from IR SymbolSpecs; assumptions:
   *  auto from IR AssumptionSpecs; requirements: auto from REQUIRED_OUTPUTs. */
  readonly kind: 'prose' | 'symbols' | 'assumptions' | 'requirements'
}

/** The closed 10-section skeleton (PRD §5.1.4). */
export const PAPER_SECTIONS: ReadonlyArray<SectionSpec> = [
  { id: 'abstract', title: '摘要', kind: 'prose' },
  { id: 'restatement', title: '问题重述', kind: 'prose' },
  { id: 'analysis', title: '问题分析', kind: 'prose' },
  { id: 'assumptions', title: '模型假设', kind: 'assumptions' },
  { id: 'symbols', title: '符号说明', kind: 'symbols' },
  { id: 'model', title: '模型建立与求解', kind: 'prose' },
  { id: 'validation', title: '模型检验', kind: 'prose' },
  { id: 'evaluation', title: '模型评价', kind: 'prose' },
  { id: 'references', title: '参考文献', kind: 'prose' },
  { id: 'code', title: '代码附录', kind: 'prose' },
]

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
 * slots rendered as tables from the IR, prose slots left as a placeholder
 * line (the model fills them — but the section EXISTS, so M4=100%).
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
    } else if (section.kind === 'requirements' || (section.id === 'restatement' && (input.requirements?.length ?? 0) > 0)) {
      // PRD §5.1.4: 问题重述 — the REQUIRED_OUTPUTs (from IR) render as
      // the "what must be produced" table under this section.
      lines.push(renderTable(['要求', '说明'], input.requirements ?? [], '(问题要求由规范 IR 自动生成)'))
      if (slot !== undefined && slot.trim() !== '') {
        lines.push('')
        lines.push(slot)
      }
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
    lines.push(`| ${row.columns.map(c => c.replace(/\|/g, '\\|')).join(' | ')} | [${row.id}]`)
  }
  return lines.join('\n')
}
