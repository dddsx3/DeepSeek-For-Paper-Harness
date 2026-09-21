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
  { id: 'data_appendix', title: '附录 A 数据与输出文件', kind: 'data_appendix' },
  { id: 'code', title: '附录 B 核心代码', kind: 'prose' },
]

/**
 * W11.5 round-8 — 哪些章带序号。
 *
 * 参照物（`CUMCM/workspaces/5ba6e7bd5010/paper/main.md`）是「## 1 问题重述」
 * 「## 2 问题分析」…「## 12 模型的评价与推广」，而**摘要 / AI 工具使用声明 /
 * 参考文献 / 附录**不带序号。逐问章（6、8、9、10）与独立校核章（7）在模型章之后
 * 由渲染器接着编号——所以序号是**渲染时递增**的，不是写死在表里的常量。
 */
const UNNUMBERED: ReadonlySet<string> = new Set(['abstract', 'ai_disclosure', 'references', 'data_appendix', 'code'])


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
   * 参照物形态（CUMCM/workspaces/5ba6e7bd5010/paper/main.md）：**每个子问题独立成章**
   * （「6 问题一：…」「7 问题一模型的独立校核」「8 问题二：…」），而不是把所有
   * 问题挤进一章。每章正文来自该问的 E1 分析段 + 该问自己的结果表。
   */
  readonly problemChapters?: ReadonlyArray<{ readonly title: string; readonly body: string; readonly rows?: ReadonlyArray<AutoRow> }>
  /** 独立校核章（参照物「7 问题一模型的独立校核」）。 */
  readonly verification?: string
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
  // 序号与表号都是**渲染时递增**的：逐问章/校核章插在模型章之后，写死常量会错位。
  let chapterNo = 0
  let tableNo = 0
  const chapter = (title: string): string => {
    chapterNo += 1
    return `## ${chapterNo} ${title}`
  }
  const table = (caption: string, headers: ReadonlyArray<string>, rows: ReadonlyArray<AutoRow>, fallback: string): string[] => {
    if (rows.length === 0) return [fallback]
    tableNo += 1
    // 参照物的题注形态：`**表 N：题注**` 独占一行，表紧随其后。
    return [`**表 ${tableNo}：${caption}**`, '', renderTable(headers, rows)]
  }
  // 小节号由渲染器统一编（`### 5.1 …`）：章内小节既有骨架自己发的（方程/模型），
  // 也有槽内容里模型写的（方法/图/逐问归因），只有在这里编号才不会撞号或跳号。
  const numberSubheadings = (text: string, subCount: number): { readonly text: string; readonly count: number } => {
    let k = subCount
    let inCode = false
    const out = text.split('\n').map((line) => {
      if (line.trim().startsWith('```')) { inCode = !inCode; return line }
      if (inCode) return line
      const match = /^###\s+(.+)$/.exec(line)
      if (match === null) return line
      k += 1
      return `### ${chapterNo}.${k} ${match[1] ?? ''}`
    }).join('\n')
    return { text: out, count: k }
  }
  lines.push(`# ${input.title}`)
  lines.push('')
  for (const section of PAPER_SECTIONS) {
    lines.push(UNNUMBERED.has(section.id) ? `## ${section.title}` : chapter(section.title))
    lines.push('')
    // 槽内容里的小节（`### 方法` / `### 结果表` / `### 问题1 的分析`）在**所有编号章**
    // 里统一编成 `<章号>.<n>`；不编号的章（摘要/参考文献/附录）保持原样——附录里
    // 的 `### 附录 A …` 是它自己的字母编号。
    const rawSlot = input.slots?.[section.id]
    const slot = rawSlot === undefined || rawSlot.trim() === '' || UNNUMBERED.has(section.id)
      ? rawSlot
      : numberSubheadings(rawSlot, 0).text
    if (section.kind === 'symbols') {
      lines.push(...table('符号说明', ['符号', '含义', '单位'], input.symbols ?? [], '(符号表由规范 IR 自动生成)'))
    } else if (section.kind === 'assumptions') {
      lines.push(...table('模型假设', ['假设', '来源', '风险', '可检验'], input.assumptions ?? [], '(假设表由规范 IR 自动生成)'))
    } else if (section.id === 'model') {
      // W11.5 baseline-20 (审计 B-2/B-3「虎头蛇尾」): the 模型建立与求解 chapter is
      // filled from the canonical IR — every EquationSpec the container declared
      // (expression + unit) and every ModelSpec (objective, constraints) — so the
      // chapter carries the ACTUAL model rather than a one-line summary, and it
      // cannot be missing while the model exists in the IR. The model's own
      // `methods` prose, when present, stays underneath.
      if ((input.equations?.length ?? 0) > 0 || (input.models?.length ?? 0) > 0) {
        // 表前一句导语：章标题下直接摆表是"脚本拼装"的观感，导语把表的来源说清楚。
        lines.push('本章先给出规范 IR 中声明的方程与模型清单，各子问题各自的模型与数值见后续逐问章。')
        lines.push('')
      }
      if ((input.equations?.length ?? 0) > 0) {
        lines.push(...table('方程清单', ['方程', '表达式', '类型', '单位'], input.equations ?? [], '(方程表由规范 IR 自动生成)'))
        lines.push('')
      }
      if ((input.models?.length ?? 0) > 0) {
        lines.push(...table('模型清单', ['模型', '目标', '约束', '引用'], input.models ?? [], '(模型表由规范 IR 自动生成)'))
        lines.push('')
      }
      if (slot !== undefined && slot.trim() !== '') {
        lines.push(slot)
      } else if ((input.equations?.length ?? 0) === 0 && (input.models?.length ?? 0) === 0) {
        lines.push('_(模型待写入)_')
      }
      // W11.5 round-7（对齐参照物结构）: 参照物是**每个子问题独立成章**
      // （「6 问题一：…」「7 问题一模型的独立校核」「8 问题二：…」），而不是把所有
      // 问题挤进一章。逐问章紧跟模型章；独立校核章**跟在第一问之后**（参照物的
      // 「7 问题一模型的独立校核」就在 6 与 8 之间）。
      const chapters = input.problemChapters ?? []
      for (let i = 0; i < chapters.length; i += 1) {
        const problemChapter = chapters[i]
        if (problemChapter === undefined) continue
        lines.push('')
        lines.push(chapter(problemChapter.title))
        lines.push('')
        if (problemChapter.body.trim() !== '') {
          lines.push(problemChapter.body)
          lines.push('')
        }
        if ((problemChapter.rows?.length ?? 0) > 0) {
          lines.push(...table(`${problemChapter.title.split('：')[0] ?? ''} 的求解结果`, ['量名', '数值', '单位'], problemChapter.rows ?? [], '(该问结果由规范 IR 注入)'))
          lines.push('')
        }
        if (i === 0 && input.verification !== undefined && input.verification.trim() !== '') {
          const first = problemChapter.title.split('：')[0] ?? '第一问'
          lines.push('')
          lines.push(chapter(`${first}模型的独立校核`))
          lines.push('')
          lines.push(input.verification)
          lines.push('')
        }
      }
      if (chapters.length === 0 && input.verification !== undefined && input.verification.trim() !== '') {
        lines.push('')
        lines.push(chapter('模型校核'))
        lines.push('')
        lines.push(input.verification)
        lines.push('')
      }
    } else if (section.id === 'restatement' && (input.requirements?.length ?? 0) > 0) {
      // PRD §5.1.4: 问题重述 — the REQUIRED_OUTPUTs (from IR) render as
      // the "what must be produced" table under this section.
      lines.push(...table('题目要求', ['要求', '说明'], input.requirements ?? [], '(问题要求由规范 IR 自动生成)'))
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

/** Render one markdown table (auto rows); the caller supplies the caption. */
function renderTable(headers: ReadonlyArray<string>, rows: ReadonlyArray<AutoRow>): string {
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
  // Defensive: a row builder that hands over `null` (an absent ModelSpec
  // objective, say) must render an empty cell, not crash the whole chain —
  // baseline-25 died on exactly that (`Cannot read properties of null`).
  const text = value === null || value === undefined ? '' : String(value)
  return text.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
}
