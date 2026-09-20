/**
 * text_profile 派生 — R2①（格式链，G3）.
 *
 * 照搬参照档案 §1.2 的 `_text_profile.json` schema：page / fonts / headings /
 * body + `_derived_from` + `_matched_items`。输入是**用户文字格式要求**
 * （如 `FORMAT_REQUIREMENTS.md`：题目三号黑体居中 / 一级标题四号黑体 /
 * 正文小四宋体单倍行距 / 图表五号宋体），输出是结构化 profile。
 *
 * 派生纪律（与检查一致的诚实性）：
 *   - 只把**说了的**写进 profile；没说的保持默认并在 `_matched_items` 记为
 *     `matched:false`——**绝不猜用户没给的要求**（checker 不伪装已覆盖）。
 *   - 同名要求两次派生结果**逐字节一致**（判据：同要求两次派生结果一致）。
 *
 * 中文字号表（数模竞赛惯例）：初号42 / 小初36 / 一号26 / 小一24 / 二号22 /
 * 小二18 / 三号16 / 小三15 / 四号14 / 小四12 / 五号10.5 / 小五9。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/text-profile
 */

/** 一、二级标题的字号规格（schema 复用）。 */
export interface HeadingSpec { readonly level: number; readonly size_pt: number; readonly align: 'center' | 'left'; readonly bold: boolean; readonly page_break?: boolean }

/** 中文字号 → pt（竞赛排版惯例，闭集）。 */
export const CN_FONT_SIZE_PT: Readonly<Record<string, number>> = {
  初号: 42, 小初号: 36, 一号: 26, 小一号: 24, 二号: 22, 小二号: 18,
  三号: 16, 小三号: 15, 四号: 14, 小四号: 12, 五号: 10.5, 小五号: 9,
}

export interface TextProfile {
  readonly page: {
    readonly size: string
    readonly margins: { readonly top: string; readonly right: string; readonly bottom: string; readonly left: string }
  }
  readonly fonts: { readonly cn_heading: string; readonly cn_body: string; readonly latin: string; readonly mono: string }
  readonly headings: ReadonlyArray<HeadingSpec>
  readonly body: { readonly size_pt: number; readonly line_spacing: number }
  readonly _derived_from: string
  readonly _matched_items: ReadonlyArray<{ readonly item: string; readonly matched: boolean; readonly note: string }>
}

/** 从纯文本格式要求派生结构化 profile（确定性：同输入 → 同输出）。 */
export function deriveTextProfile(requirementText: string): TextProfile {
  const text = requirementText
  const matched: Array<{ item: string; matched: boolean; note: string }> = []

  // Clause-local matching: a size/font must sit in the SAME 分句 as its
  // aspect — `.*?` crossing `；。` would let 题目's 三号 leak into 正文
  // (real test failure: 正文小四 got 16pt from 题目三号).
  const SIZE_NAME = /(?:小[初一二三四五]|[一二三四五六七八九十初])/
  const fontSizeOf = (aspect: string): number | null => {
    const forward = new RegExp(`${aspect}[^；。]*?(${SIZE_NAME.source})号?`, 'i').exec(text)
    const backward = forward ?? new RegExp(`(${SIZE_NAME.source})号?[^；。]*?(?:${aspect})`, 'i').exec(text)
    const name = backward?.[1]
    if (name === undefined) return null
    // 小四 / 小四号 都接受：查表用带 号 的键
    return CN_FONT_SIZE_PT[`${name}号`] ?? null
  }

  // fonts（从句内：黑体/宋体 与 标题/正文 同在，中间不跨 。；）
  const insideClause = (a: string, b: string): boolean => new RegExp(`${a}[^；。]*?${b}`).test(text) || new RegExp(`${b}[^；。]*?${a}`).test(text)
  const cnHeadingFont = insideClause('标题', '黑体') || insideClause('题目', '黑体') ? '黑体' : (insideClause('标题', '宋体') || insideClause('题目', '宋体') ? '宋体' : null)
  const cnBodyFont = insideClause('正文', '宋体') ? '宋体' : (insideClause('正文', '黑体') ? '黑体' : null)
  const cnHeading = cnHeadingFont ?? '黑体'
  const cnBody = cnBodyFont ?? '宋体'
  matched.push({ item: 'fonts.cn_heading', matched: cnHeadingFont !== null, note: cnHeadingFont !== null ? `匹配到 ${cnHeading}` : '未提及，用默认黑体' })
  matched.push({ item: 'fonts.cn_body', matched: cnBodyFont !== null, note: cnBodyFont !== null ? `匹配到 ${cnBody}` : '未提及，用默认宋体' })

  // body size + line spacing
  const bodySizePt = fontSizeOf('正文')
  const lineSpacing = /单倍行距|单倍/.test(text) ? 1 : (/1\.5倍|一点五倍/.test(text) ? 1.5 : (/[二两]倍行距/.test(text) ? 2 : 1.5))
  matched.push({ item: 'body.size_pt', matched: bodySizePt !== null, note: bodySizePt !== null ? `${bodySizePt}pt` : '未提及，用默认小四 12pt' })
  matched.push({ item: 'body.line_spacing', matched: /行距/.test(text), note: /行距/.test(text) ? `${lineSpacing} 倍` : '未提及，用默认 1.5 倍' })

  // page
  const margins = { top: '25mm', right: '25mm', bottom: '25mm', left: '25mm' }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const word = side === 'top' ? '上' : side === 'bottom' ? '下' : side === 'left' ? '左' : '右'
    const m = new RegExp(`(?:${word}[边距]*|页边距.{0,4}?${word})\\s*[:：]?\\s*([\\d.]+)\\s*mm`, 'i').exec(text)
    if (m !== null) margins[side] = `${m[1]}mm`
  }
  matched.push({ item: 'page.a4', matched: /A4|a4/.test(text), note: /A4|a4/.test(text) ? 'A4' : '未提及，用默认 A4' })

  // headings 1-4
  const headings: HeadingSpec[] = []
  const levelOrder = ['题目', '一级标题', '二级标题', '三级标题']
  const levelOf = (level: number): { size: number; align: 'center' | 'left'; bold: boolean } => {
    if (level === 1) {
      const size = fontSizeOf('题目') ?? 16
      return { size, align: 'center', bold: true }
    }
    const label = levelOrder[level - 1] ?? `标题${level}`
    const size = fontSizeOf(label) ?? (level === 2 ? 14 : 12)
    const bold = /标题.*?加粗|加粗.*?标题/.test(text) || level <= 2
    return { size, align: 'left', bold }
  }
  for (let level = 1; level <= 4; level += 1) {
    const spec = levelOf(level)
    headings.push({ level, size_pt: spec.size, align: spec.align, bold: spec.bold })
    matched.push({ item: `headings.level${level}`, matched: fontSizeOf(levelOrder[level - 1] ?? `标题${level}`) !== null, note: `${spec.size}pt ${spec.align} ${spec.bold ? '加粗' : '常规'}` })
  }

  return {
    page: { size: 'A4', margins },
    fonts: { cn_heading: cnHeading, cn_body: cnBody, latin: 'Times New Roman', mono: 'Consolas' },
    headings,
    body: { size_pt: bodySizePt ?? 12, line_spacing: lineSpacing },
    _derived_from: requirementText,
    _matched_items: matched,
  }
}
