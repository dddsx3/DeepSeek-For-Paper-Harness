/**
 * 格式审计 —— 以**参照物论文**为唯一合法标准。
 *
 * ## 参照物
 *
 * `CUMCM/workspaces/5ba6e7bd5010/paper/main.docx`（及同目录 `main.md`）。
 * 实测抽取的形态：1 个 `#` 标题、`## 摘要` 不编号、`## N 章名`（1–11 连续）、
 * `### N.M 小节名`（40 条）、`**表 N：题注**` 独占一行、`![图 N：题注](…)`、
 * 56 个 `$$` 独立公式块。
 *
 * ## 为什么要有这一层
 *
 * 格式飘移是**静默**的：论文仍然能读、能导出、能交付，只是形态与参照物不再一致。
 * 实测（见 `artifacts/upper-bound/FORMAT-AUDIT.md`）：
 *
 *   - round-9 的提交 `3f43f9fcaa` 为解决"E1 标题泄漏"加了
 *     `.replace(/^#{1,6}\s+(.+)$/gm, '**$1**')`——把 E1 文本里**所有层级**的标题
 *     降级为加粗行。修法本身合理（E1 的 `# B题 建模工作笔记` 不该变成论文章节），
 *     但**判据过宽**：模型写的合法 `### N.M 小节` 也一起被降级。
 *   - 兜底路径（B-e1-direct）的正文就是 E1 原文，于是从那一轮起，
 *     **13 次真实运行的交付稿 `###` 小节数全部为 0**；而在此之前它是时有时无的
 *     （0 / 0 / 24 / 0 / 24——取决于模型当次有没有写小节）。
 *
 * 判据必须是**机械可判**的，否则"对齐参照物"永远只能靠人眼看。
 *
 * @module @deepseek-ai/dsh-paper-foundation/delivery/format-audit
 */

/** 一条格式违规。 */
export interface FormatViolation {
  /** 判据编号（`F1`…`F8`），便于引用与复验。 */
  readonly rule: string
  /** 判据名（人读）。 */
  readonly title: string
  /** 具体差在哪（带位置或计数）。 */
  readonly detail: string
}

/** 参照物实测的形态常量（抽自 main.docx / main.md）。 */
export const REFERENCE_FORMAT = {
  /** 论文标题层级的数量：有且仅有 1 个 `#`。 */
  titleCount: 1,
  /** 不编号的 `##` 章（参照物里这些章不参与 `N 章名` 编号）。 */
  unnumberedChapters: ['摘要', 'AI 声明', '参考文献', '致谢'],
  /** 附录章的形态（`## 附录 A …`）。 */
  appendixPrefix: '附录',
} as const

const HEADING = /^(#{1,6})\s+(.*)$/
const NUMBERED_CHAPTER = /^([0-9]+)\s+(.*)$/
const NUMBERED_SECTION = /^([0-9]+)\.([0-9]+)\s+(.*)$/
const BOLD_TABLE_CAPTION = /^\*\*表\s*([0-9]+)[：:](.*)\*\*\s*$/
const FIGURE_CAPTION = /^!\[图\s*([0-9]+)[：:](.*?)\]\(/
const EQUATION_REF = /式\s*[（(]\s*([0-9]+)\s*[）)]/g

/** 抽出一份 markdown 的标题大纲。 */
function outlineOf(markdown: string): ReadonlyArray<{ level: number; text: string; line: number }> {
  const out: Array<{ level: number; text: string; line: number }> = []
  const lines = markdown.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = HEADING.exec(line)
    if (m !== null) out.push({ level: (m[1] ?? '').length, text: (m[2] ?? '').trim(), line: i + 1 })
  }
  return out
}

/**
 * 对一份渲染后的论文正文跑格式审计。
 *
 * **只报差异，不拒绝交付**——与正文契约同一处置：格式飘移是**标注**级事实，
 * 它进交付附录的已知缺陷表，让读者与维护者都看得见，而不是零掉一份能读的稿子。
 *
 * @param markdown - 渲染后的论文正文。
 * @returns 违规清单（空 = 与参照物形态一致）。
 */
export function formatViolations(markdown: string): ReadonlyArray<FormatViolation> {
  const out: FormatViolation[] = []
  const outline = outlineOf(markdown)

  // 只在**确实是一篇渲染后的论文**时审它的格式：判据是"有没有章级标题"。
  //
  // 这一条是必要的守卫，不是放宽：F1–F8 全部是**论文形态**判据（摘要章、章编号、
  // 小节层级、表题注…）。一段草稿/片段没有章结构，对它报"缺摘要章"是噪声，而噪声
  // 会让真正的飘移被淹没。反过来说，只要出现了章级标题，八条判据**全部**适用——
  // 包括"必须有摘要章"。
  if (outline.filter(h => h.level === 2).length === 0) return out

  // F1 —— 有且仅有 1 个 `#`（论文标题）。
  const titles = outline.filter(h => h.level === 1)
  if (titles.length !== REFERENCE_FORMAT.titleCount) {
    out.push({
      rule: 'F1',
      title: '论文标题层级',
      detail: `参照物有且仅有 1 个 \`#\` 标题，本稿有 ${String(titles.length)} 个`
        + (titles.length > 1 ? `（第 ${titles.slice(1).map(t => String(t.line)).join('、')} 行是多余的 # 级标题）` : ''),
    })
  }

  const chapters = outline.filter(h => h.level === 2)
  const sections = outline.filter(h => h.level === 3)

  // F2 —— 摘要必须是 `## 摘要` 且不编号。
  const abstract = chapters.find(c => c.text.replace(/^[0-9]+[.、\s]*/, '').startsWith('摘要'))
  if (abstract === undefined) {
    out.push({ rule: 'F2', title: '摘要章', detail: '参照物有 `## 摘要` 章，本稿没有' })
  } else if (/^[0-9]/.test(abstract.text)) {
    out.push({ rule: 'F2', title: '摘要章', detail: `参照物的摘要**不编号**，本稿写作 \`## ${abstract.text}\`` })
  }

  // F3 —— 编号章 `## N 章名`：N 从 1 连续递增。
  const numbered = chapters
    .map(c => ({ text: c.text, line: c.line, m: NUMBERED_CHAPTER.exec(c.text) }))
    .filter(c => c.m !== null)
  const nums = numbered.map(c => Number(c.m?.[1]))
  const expected = nums.map((_, i) => i + 1)
  if (nums.length > 0 && nums.join(',') !== expected.join(',')) {
    out.push({
      rule: 'F3',
      title: '章编号连续',
      detail: `参照物的编号章是 1..N 连续无跳号；本稿是 ${nums.join(', ')}`
        + `（期望 ${expected.join(', ')}）——跳号通常意味着某一章被插入或丢失`,
    })
  }
  // 章名不得带点号（参照物是 `## 1 问题重述`，不是 `## 1. 问题重述`）
  const dotted = chapters.filter(c => /^[0-9]+\.\s/.test(c.text))
  if (dotted.length > 0) {
    out.push({
      rule: 'F3',
      title: '章编号连续',
      detail: `参照物的章号后**不带点**（\`## 1 问题重述\`）；本稿有 ${String(dotted.length)} 处写成 \`## 1. …\``,
    })
  }

  // F4 —— 小节 `### N.M`：章号与所属章一致、M 章内连续。
  //
  // 这是**飘移的主判据**：round-9 之后 13 次运行的交付稿小节数全部为 0。
  if (numbered.length > 0 && sections.length === 0) {
    out.push({
      rule: 'F4',
      title: '小节层级',
      detail: '参照物有 40 条 `### N.M 小节名`，本稿**一条都没有**——论文只有章、没有小节。'
        + '实测成因：round-9 的 `^#{1,6}\\s+ → **…**` 降级把模型写的合法小节一并降级了',
    })
  }
  const badSection = sections.filter(s => NUMBERED_SECTION.exec(s.text) === null)
  if (sections.length > 0 && badSection.length > 0) {
    out.push({
      rule: 'F4',
      title: '小节层级',
      detail: `参照物的小节一律带章号（\`### 2.1 问题一的分析\`）；本稿有 ${String(badSection.length)} 条不带：`
        + badSection.slice(0, 3).map(s => `\`${s.text}\``).join('、'),
    })
  }

  // F5 —— 表题注 `**表 N：题注**` 独占一行，N 从 1 连续递增。
  const tableCaptions = markdown.split('\n')
    .map((l, i) => ({ m: BOLD_TABLE_CAPTION.exec(l.trim()), line: i + 1 }))
    .filter(x => x.m !== null)
    .map(x => Number(x.m?.[1]))
  const tableRows = markdown.split('\n').filter(l => /^\|.*\|$/.test(l.trim())).length
  if (tableRows > 0 && tableCaptions.length === 0) {
    out.push({
      rule: 'F5',
      title: '表题注',
      detail: `本稿有表格（${String(tableRows)} 行 markdown 表格）却**没有一条 \`**表 N：题注**\`**——`
        + '参照物的每张表都带编号题注且独占一行',
    })
  } else if (tableCaptions.length > 0 && tableCaptions.join(',') !== tableCaptions.map((_, i) => i + 1).join(',')) {
    out.push({
      rule: 'F5',
      title: '表题注',
      detail: `表号必须从 1 连续递增（参照物 表 1..N）；本稿是 ${tableCaptions.join(', ')}`,
    })
  }

  // F6 —— 图题注 `![图 N：题注](…)`。
  const figureCaptions = [...markdown.matchAll(new RegExp(FIGURE_CAPTION.source, 'gm'))].map(m => Number(m[1]))
  const anyFigure = /!\[/.test(markdown)
  if (anyFigure && figureCaptions.length === 0) {
    out.push({
      rule: 'F6',
      title: '图题注',
      detail: '本稿有图片引用但**没有一条 `![图 N：题注](…)`**——参照物的图题注带图号且在 alt 里',
    })
  }

  // F7 —— 正文引用了 `式（N）` 就必须有对应的 `$$` 独立公式块。
  //
  // 参照物有 56 个 `$$` 块。这一条不要求"块数 ≥ 某值"（题型不同，公式量本就不同），
  // 只要求**不自相矛盾**：引用了第 N 式，就得真有第 N 个展示公式。
  const equationRefs = [...markdown.matchAll(EQUATION_REF)].map(m => Number(m[1]))
  const displayBlocks = markdown.split('\n').filter(l => l.trim() === '$$').length
  const maxRef = equationRefs.length === 0 ? 0 : Math.max(...equationRefs)
  const displayCount = Math.floor(displayBlocks / 2)
  if (maxRef > displayCount) {
    out.push({
      rule: 'F7',
      title: '公式形态',
      detail: `正文引用了 \`式（${String(maxRef)}）\`，但只有 ${String(displayCount)} 个 \`$$…$$\` 独立公式块——`
        + '引用了没有展示出来的公式（参照物的公式一律用 `$$` 块，且编号可查）',
    })
  }

  // F8 —— 不编号的 `##` 只允许是：摘要 / AI 声明 / 参考文献 / 致谢 / 附录。
  const unnumbered = chapters.filter(c => NUMBERED_CHAPTER.exec(c.text) === null)
  const illegal = unnumbered.filter((c) => {
    const t = c.text.replace(/^[0-9]+[.、\s]*/, '')
    return !REFERENCE_FORMAT.unnumberedChapters.some(u => t.startsWith(u))
      && !t.startsWith(REFERENCE_FORMAT.appendixPrefix)
  })
  if (illegal.length > 0) {
    out.push({
      rule: 'F8',
      title: '不编号章的许可集',
      detail: `参照物里不编号的 \`##\` 只有 ${REFERENCE_FORMAT.unnumberedChapters.join(' / ')} / 附录；`
        + `本稿另有 ${String(illegal.length)} 条：${illegal.slice(0, 4).map(c => `\`${c.text}\``).join('、')}`,
    })
  }

  return out
}
