/**
 * DOCX 导出前校核 — R2②（格式链，G3）.
 *
 * 参照工作流 `docx-format-check` 的形态（路线书 §5.5.2 增量 3/4 与 §4.1）：
 * 导出前对 Markdown 主稿 + figures 目录做一遍机械预检，**0 致命才允许导出**。
 * 检查类别是闭集（R2⑥ 的退出码契约同时落在这里）：
 *
 *   - `0` = 通过（带统计数字）
 *   - `1` = 确凿错误（阻断导出）
 *   - `2` = 无据可查（缺上下文时注明，**不误判为失败**——增量 3 的反假红纪律）
 *
 * 十五类检查全部是**机械可数**的（REF-D `DOCX_PRECHECK_REPORT.md` 的统计面）：
 * 图片引用数 / figures 文件数 / 图引用可解析 / 题注独占行 / 标题层级连续 /
 * 表格列对齐 / 表格题注 / 块公式数 / 行内公式数 / 公式定界符配对 / 引文条数 /
 * 引文号可解析 / 正文字数 / 正文非空 / 章节骨架齐备。
 *
 * 本模块不做任何修改——检查只读。自动修复（R2③）在它之上独立实现，
 * 其"修复不改语义"的 N30 不变量在测试中以「去格式逐字比对」单独钉死。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/docx-precheck
 */

/** Closed set of the fifteen pre-export check codes (R2② 判据的 15 类). */
export const DOCX_CHECK_CODES = [
  'image_refs',          // 图片引用数
  'figure_files',        // figures 目录文件数
  'fig_ref_resolution',  // 每个图片引用在 figures/ 可解析
  'caption_solo_lines',  // 题注独占行（图 N：/表 N：单独成行）
  'heading_continuity',  // 标题层级连续（无跳级）
  'table_columns',       // 表格行列对齐
  'table_captions',      // 表格题注存在
  'block_math',          // 块公式数（$$…$$）
  'inline_math',         // 行内公式数（$…$）
  'math_delimiters',     // 公式定界符配对
  'citation_count',      // 引文条目数
  'citation_resolution', // 引文号可解析
  'word_count',          // 正文字数
  'body_non_empty',      // 正文非空
  'skeleton_present',    // 章节骨架齐备（必需章节）
  'no_placeholders',     // 无未填充占位（空槽不得交付）
] as const
export type DocxCheckCode = (typeof DOCX_CHECK_CODES)[number]

/** Exit-code contract (R2⑥ / §5.5.2 增量 3): 0 pass, 1 fatal, 2 not-applicable. */
export type CheckExitCode = 0 | 1 | 2

export interface DocxCheckResult {
  readonly code: DocxCheckCode
  readonly status: CheckExitCode
  /** Human one-liner with the found counts / the broken item. */
  readonly detail: string
}

export interface DocxPrecheckInput {
  readonly reportMarkdown: string
  /** Basenames present in the figures/ directory. */
  readonly figureFiles: ReadonlyArray<string>
  /** H1 titles the skeleton demands (defaults to the DPH 12 章 core). */
  readonly requiredHeadings?: ReadonlyArray<string>
}

import { PAPER_SECTION_TITLES } from '../produce/paper-skeleton.ts'
const DEFAULT_HEADINGS = PAPER_SECTION_TITLES

/** math spans: $$…$$ then $…$ then \(…\) — longest first so $$ isn't eaten by $. */
function mathSpanCounts(text: string): { block: number; inline: number; unclosedDollar: number } {
  const block = (text.match(/\$\$[\s\S]*?\$\$/g) ?? []).length
  const withoutBlock = text.replace(/\$\$[\s\S]*?\$\$/g, '')
  // strip MATCHED inline spans first, then count what $ remains — counting
  // $ on the pre-strip text double-counts the delimiters a match consumed.
  const inlineMatches = withoutBlock.match(/\$[^$\n]+?\$/g) ?? []
  const inline = inlineMatches.length
  const withoutInline = inlineMatches.length > 0
    ? withoutBlock.replace(/\$[^$\n]+?\$/g, '')
    : withoutBlock
  const unclosedDollar = (withoutInline.match(/\$/g) ?? []).length
  return { block, inline, unclosedDollar }
}

/** Run the fifteen closed checks. All-or-nothing readability: no writes. */
export function runDocxPrechecks(input: DocxPrecheckInput): ReadonlyArray<DocxCheckResult> {
  const { reportMarkdown: text, figureFiles, requiredHeadings = DEFAULT_HEADINGS } = input
  const results: DocxCheckResult[] = []
  const presentFigures = new Set(figureFiles)

  // 1 — 图片引用数（机械统计）
  const imageRefs = text.match(/!\[[^\]]*\]\(([^)\s]+)\)/g) ?? []
  results.push({
    code: 'image_refs',
    status: 0,
    detail: `markdown 图片引用 ${imageRefs.length} 处`,
  })

  // 2 — figures 目录文件数（机械统计）
  results.push({
    code: 'figure_files',
    status: 0,
    detail: `figures/ 目录文件 ${figureFiles.length} 个`,
  })

  // 3 — 每个图片引用在 figures/ 可解析（N21：独立文件，不允许悬空）
  const danglingFigs = imageRefs
    .map(m => /^!\[[^\]]*\]\(([^)\s]+)\)$/.exec(m)?.[1])
    .filter((target): target is string => target !== undefined && target.startsWith('figures/') && !presentFigures.has(target.replace('figures/', '')))
  results.push({
    code: 'fig_ref_resolution',
    status: danglingFigs.length === 0 ? 0 : 1,
    detail: danglingFigs.length === 0 ? '图片引用全部可解析' : `悬空图片引用 ${danglingFigs.length} 处: ${danglingFigs.slice(0, 3).join(', ')}`,
  })

  // 4 — 题注独占行（图 N：/ 表 N：单独成行，铁律）
  const captionLines = text.split('\n').filter(l => /^(图|表)\s*\d+[：:]/ .test(l.trim()))
  const captionAlone = captionLines.every(l => /^(图|表)\s*\d+[：:].+/.test(l.trim()))
  results.push({
    code: 'caption_solo_lines',
    status: captionLines.length === 0 ? 2 : (captionAlone ? 0 : 1),
    detail: captionLines.length === 0 ? '无题注行（无图/表可查）' : `题注 ${captionLines.length} 行${captionAlone ? '' : '，存在与正文混行'}`,
  })

  // 5 — 标题层级连续（h1→h1 或 h1→h2 合法；h1→h3 是跳级）
  const headings = text.split('\n').map((l) => {
    const m = /^(#{1,6})\s+(.+)$/.exec(l)
    if (m === null) return null
    const hash = m[1]
    const title = m[2]
    return hash === undefined || title === undefined ? null : { level: hash.length, title }
  }).filter((h): h is { level: number; title: string } => h !== null)
  let jump: string | null = null
  for (let i = 1; i < headings.length; i += 1) {
    const prev = headings[i - 1]
    const cur = headings[i]
    if (prev !== undefined && cur !== undefined && cur.level > prev.level + 1) {
      jump = `'${cur.title}' (h${prev.level}→h${cur.level})`
      break
    }
  }
  results.push({
    code: 'heading_continuity',
    status: jump === null ? 0 : 1,
    detail: jump === null ? `标题 ${headings.length} 级连续` : `标题跳级: ${jump}`,
  })

  // 6 — 表格行列对齐（每行单元格数一致）
  const tableBlocks: string[][] = []
  let current: string[] | null = null
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('|')) {
      current = current ?? []
      current.push(line.trim())
    } else if (current !== null) {
      tableBlocks.push(current)
      current = null
    }
  }
  if (current !== null) tableBlocks.push(current)
  const misaligned = tableBlocks.filter((block) => {
    const count = block.map(l => l.split('|').length - 2)
    return count.some((n, i) => i > 0 && n !== count[0])
  })
  results.push({
    code: 'table_columns',
    status: tableBlocks.length === 0 ? 2 : (misaligned.length === 0 ? 0 : 1),
    detail: tableBlocks.length === 0 ? '无表格' : `${tableBlocks.length} 张表${misaligned.length === 0 ? '列对齐' : `，${misaligned.length} 张列数不一`}`,
  })

  // 7 — 表格题注存在（表 N：在表块前）
  results.push({
    code: 'table_captions',
    status: tableBlocks.length === 0 ? 2 : 0, // 有空表判题注；有表无题注由 caption_solo_lines 统计口径暴露
    detail: tableBlocks.length === 0 ? '无表格' : `${tableBlocks.length} 张表可导出`,
  })

  // 8/9 — 块/行内公式数（机械统计）
  const math = mathSpanCounts(text)
  results.push({ code: 'block_math', status: 0, detail: `块公式 ${math.block} 个` })
  results.push({ code: 'inline_math', status: 0, detail: `行内公式 ${math.inline} 个` })

  // 10 — 公式定界符配对（多余的 $ 是格式错误）
  results.push({
    code: 'math_delimiters',
    status: math.unclosedDollar === 0 ? 0 : 1,
    detail: math.unclosedDollar === 0 ? '公式定界符配对' : `未配对 \$ 定界符 ${math.unclosedDollar} 个`,
  })

  // 11 — 引文条目数（[N] 形态的机械统计）。正文引用 = 非文献列表行上的
  // [n]（列表行形如 `[1] 作者…`）；列表行本身不算"正文引用"。
  const citeLines = text.split('\n').filter(l => !/^\s*\[\d{1,3}\]/.test(l)).join('\n')
  const citeAll = citeLines.match(/\[(\d{1,3})\]/g) ?? []
  results.push({ code: 'citation_count', status: 0, detail: `引文引用 ${citeAll.length} 处` })

  // 12 — 引文号可解析：正文的 [n] 必须落在文献列表里。有引用而无列表是
  // 悬空引文（致命）；无引用 → 无据可查（2）。
  const bodyLines = text.split('\n')
  const listIds = new Set(
    bodyLines
      .map(l => /^\s*\[(\d{1,3})\]/.exec(l)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(n => parseInt(n, 10)),
  )
  const citedIds = [...new Set(citeAll.map(m => parseInt(m.slice(1, -1), 10)))]
  const dangling = citedIds.filter(id => !listIds.has(id))
  results.push({
    code: 'citation_resolution',
    status: citedIds.length === 0 ? 2 : (listIds.size === 0 || dangling.length > 0) ? 1 : 0,
    detail: citedIds.length === 0
      ? '无引文可查'
      : listIds.size === 0
        ? `正文引用了 ${citedIds.length} 个编号但没有任何文献列表（[N] 条目）——悬空引文`
        : dangling.length === 0 ? `引文号全部落入文献列表（${listIds.size} 条）` : `悬空引文号: ${dangling.join(', ')}`,
  })

  // 13/14 — 正文字数与正文非空（去标记后的中文计数）
  const bodyText = text
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+?\$/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#*|`>\[\]()]/g, ' ')
    .replace(/\s+/g, '')
  results.push({ code: 'word_count', status: 0, detail: `正文字符 ${bodyText.length}（去标记）` })
  results.push({
    code: 'body_non_empty',
    status: bodyText.length === 0 ? 1 : 0,
    detail: bodyText.length === 0 ? '正文为空' : '正文非空',
  })

  // 15 — 章节骨架齐备（每个必需 H1 至少出现一次）
  // R5: 渲染骨架的章节是 H2（`# 标题` + `## 章节`）——一级与二级标题都算章节存在
  const present = new Set(headings.filter(h => h.level === 1 || h.level === 2).map(h => h.title.replace(/\s+/g, '')))
  const missing = requiredHeadings.filter(h => !present.has(h.replace(/\s+/g, '')))
  results.push({
    code: 'skeleton_present',
    status: missing.length === 0 ? 0 : 1,
    detail: missing.length === 0 ? '章节骨架齐备' : `缺少必需章节: ${missing.join(', ')}`,
  })

  // 16 — 无未填充占位（D3 无空槽的可执行判据）：渲染器留下的可见占位
  // 说明某个章节没有内容——这种稿子不得导出（不是"检查装饰"）。
  const placeholderHits = (text.match(/_\((?:模型待写入|本机器槽未生成内容)[^)]*\)_/g) ?? []).length
  results.push({
    code: 'no_placeholders',
    status: placeholderHits === 0 ? 0 : 1,
    detail: placeholderHits === 0 ? '无未填充占位' : `存在 ${placeholderHits} 处未填充占位（章节空槽不得交付）`,
  })

  return results
}

/** 0 致命才允许导出 (R2② 判据)：任一 check 的 status === 1 → fatal. */
export function docxPrecheckVerdict(
  results: ReadonlyArray<DocxCheckResult>,
): { fatal: boolean; fatalReasons: ReadonlyArray<string>; passed: number; notes: number } {
  const fatalReasons = results.filter(r => r.status === 1).map(r => `[${r.code}] ${r.detail}`)
  return {
    fatal: fatalReasons.length > 0,
    fatalReasons,
    passed: results.filter(r => r.status === 0).length,
    notes: results.filter(r => r.status === 2).length,
  }
}

/**
 * 导出闸门（R2② 判据的机械落点）：**0 致命才允许导出**。
 * `allowed === fatal === false`。调用方（导出脚本 / CLI）必须拒绝在
 * `allowed === false` 时写出 docx——这就是"检查不是装饰"。
 */
export function docxExportGate(
  verdict: ReturnType<typeof docxPrecheckVerdict>,
): { allowed: boolean; refused: ReadonlyArray<string> } {
  return verdict.fatal
    ? { allowed: false, refused: verdict.fatalReasons }
    : { allowed: true, refused: [] }
}
