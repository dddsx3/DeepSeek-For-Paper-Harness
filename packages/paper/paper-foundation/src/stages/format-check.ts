/**
 * 阶段 10 的执行体 —— **Markdown 格式自检与就地安全修复**（确定性，不消耗模型调用）。
 *
 * ## 五类检查（转写自参考的 `docx-format-check/SKILL.md`）
 *
 * | 类 | 查什么 | 能不能机械判 |
 * |---|---|---|
 * | `fence` 代码块完整性 | 围栏成对、无裸代码段、语言标记是否可推断 | 能 |
 * | `formula` 公式编号语法 | `$$` 成对、行内 `$$X$$`、块公式 `\tag{}` 编号连续 | 能 |
 * | `table` 三线表格式 | 分隔行齐全、各行列数一致 | 能 |
 * | `pseudo_label` 伪标题/伪题注/伪公式号 | 章节标题、图表注、独行公式号被写成 `- ` 列表项 | 能 |
 * | `noise` Markdown 噪声 | 转义残留、HTML 标签、游离数学符号、加粗滥用 | 能 |
 *
 * **图片引用闭合、LaTeX 残留、引用闭合、字数**不在这里查——那些归阶段 11 的
 * 导出前校核（简报的 `forbidden` 明说"不得与导出前校核重复"）。两处都查会让
 * "哪一处是权威"变得说不清。
 *
 * ## 修复必须**逐字可比**（否则"自动修复"就是"自动改坏"）
 *
 * 只做三类**确定的等价改写**：
 *
 * 1. 空的全角括号 `（）` → ` ()`；
 * 2. **同一行内**的 `$$X$$` → `$X$`（整行只有 `$$X$$` 时是块公式，**不动**）；
 * 3. 代码围栏的语言标记，**只有 100% 可推断时才补**（Python 语法特征 / shell 提示符），
 *    推不出来就留裸围栏——猜错语言标记会让高亮与转写都错，比不补更糟。
 *
 * 每一次修复都过一道 `assertVerbatim`：把改动前后的**目标模式**各自遮成同一个哨兵，
 * 遮完必须**逐字节相同**。这一条是"只改了该改的"的机械证明，不是承诺。
 *
 * ## 非阻塞
 *
 * 未消解的人工项照写报告，**不阻断**（参考的明确纪律，也是本阶段的前提）。
 * 只有"`paper/main.md` 不存在"这类基础设施缺失才抛错——那不是格式问题，是没有输入。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/format-check
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stagePathOf } from './figure-render.ts'

/** 阶段 7 的正文路径（相对阶段目录）。 */
export const PAPER_MAIN = 'paper/main.md'

/** 本阶段的报告文件名。 */
export const FORMAT_CHECK_REPORT = 'DOCX_FORMAT_CHECK_REPORT.md'

/** 修复前的正文留档（回滚证据：**改动前长什么样**的唯一副本）。 */
export const BEFORE_COPY = '_before/main.md'

/** 五类检查的名字（与简报逐条对应）。 */
export const FORMAT_CHECK_CLASSES = ['fence', 'formula', 'table', 'pseudo_label', 'noise'] as const
export type FormatCheckClass = (typeof FORMAT_CHECK_CLASSES)[number]

/** 一类检查的结论。 */
export interface FormatCheckFinding {
  readonly cls: FormatCheckClass
  /** 人读的类名（进报告的表头）。 */
  readonly title: string
  readonly status: 'passed' | 'repaired' | 'manual'
  /** 修了几处（`repaired` 时 > 0）。 */
  readonly repairs: number
  /** 仍需人工处理的项（`manual` 时非空）。 */
  readonly manual: ReadonlyArray<string>
  /** 机械判据的结论摘要（进报告）。 */
  readonly detail: string
}

/** 一次修复。 */
export interface RepairRecord {
  readonly kind: string
  readonly count: number
  /** 前若干处改动（before → after），进报告当证据。 */
  readonly samples: ReadonlyArray<{ readonly before: string; readonly after: string }>
}

/** 本阶段的结果。 */
export interface FormatCheckResult {
  readonly findings: ReadonlyArray<FormatCheckFinding>
  readonly repairs: ReadonlyArray<RepairRecord>
  /** 修复后的正文（已落盘）。 */
  readonly markdown: string
  readonly reportPath: string
}

/** 代码围栏的起始行。 */
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/

/** Python 语法特征（用于语言标记的 100% 推断）。 */
const PYTHON_HINTS = /^\s*(?:import\s+\w|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+|for\s+.+:\s*$|if\s+.+:\s*$|elif\s+.+:\s*$|else:\s*$|try:\s*$|except\b|with\s+.+:\s*$|print\(|return\b|@\w+)/m
/** shell 提示符或命令特征。 */
const SHELL_HINTS = /^\s*(?:\$\s+\w|#!\s*\/bin\/(?:ba|z|k)?sh|(?:python3?|pip3?|node|npm|npx|git|cd|ls|mkdir|cat|cp|mv|rm|export|make)\s)/m

/**
 * 逐字可比性证明：改动前后把**目标模式**遮成同一个哨兵，遮完必须逐字节相同。
 *
 * @param before - 改动前。
 * @param after - 改动后。
 * @param pattern - 被改写的模式。
 * @param replacement - 改写成的形态（同样要被遮掉——它是"该改的地方"）。
 * @throws 遮完仍不相等时抛错（说明这次修复动了目标之外的东西）。
 */
export function assertVerbatim(
  before: string,
  after: string,
  pattern: RegExp,
  replacement: string,
): void {
  const sentinel = '\u0000'
  const maskedBefore = before.replace(pattern, sentinel)
  const maskedAfter = after.split(replacement).join(sentinel)
  if (maskedBefore !== maskedAfter) {
    throw new Error('自动修复动了目标模式之外的文本 —— 逐字比对失败（"自动修复"不能变成"自动改坏"）')
  }
}

/** 应用一类修复并记录。 */
function applyRepair(
  text: string,
  kind: string,
  pattern: RegExp,
  replacement: string,
): { text: string; record: RepairRecord } {
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) return { text, record: { kind, count: 0, samples: [] } }
  const next = text.replace(pattern, replacement)
  assertVerbatim(text, next, pattern, replacement)
  return {
    text: next,
    record: {
      kind,
      count: matches.length,
      samples: matches.slice(0, 3).map(m => ({ before: m[0], after: m[0].replace(pattern, replacement) })),
    },
  }
}

/** 把围栏块切出来（`{ open, body, close, tagged }`）。 */
interface FenceBlock {
  readonly openLine: string
  readonly body: string
  readonly tagged: boolean
}

/** 收集所有成对的围栏块（未闭合的最后一个由 `fence` 检查单独报）。 */
function fenceBlocks(markdown: string): { blocks: ReadonlyArray<FenceBlock>; unclosed: number } {
  const lines = markdown.split('\n')
  const blocks: FenceBlock[] = []
  let open: { line: string; marker: string; tag: string } | null = null
  let body: string[] = []
  let unclosed = 0
  for (const line of lines) {
    const m = FENCE_OPEN.exec(line)
    if (open === null) {
      if (m !== null) {
        open = { line, marker: m[2] ?? '', tag: m[3] ?? '' }
        body = []
      }
      continue
    }
    if (m !== null && (m[2] ?? '').startsWith(open.marker[0] ?? '`')) {
      blocks.push({ openLine: open.line, body: body.join('\n'), tagged: open.tag !== '' })
      open = null
      body = []
      continue
    }
    body.push(line)
  }
  if (open !== null) unclosed += 1
  return { blocks, unclosed }
}

/** 推断围栏语言：**只有 100% 可推断才给**。 */
function inferFenceLanguage(body: string): string | null {
  const code = body.replace(/\n+$/, '')
  if (code.trim() === '') return null
  const python = PYTHON_HINTS.test(code)
  const shell = SHELL_HINTS.test(code)
  // 两种特征同时命中 = 推不出来（宁可留裸围栏，也不给错标记）
  if (python && !shell) return 'python'
  if (shell && !python) return 'bash'
  return null
}

/** 三线表：连续的 `|` 行块。 */
function tableBlocks(markdown: string): ReadonlyArray<ReadonlyArray<string>> {
  const out: string[][] = []
  let current: string[] = []
  for (const line of markdown.split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) { current.push(line.trim()); continue }
    if (current.length > 0) { out.push(current); current = [] }
  }
  if (current.length > 0) out.push(current)
  return out
}

/** 五类检查 + 三类安全修复。 */
export function runFormatChecks(markdown: string): {
  readonly findings: ReadonlyArray<FormatCheckFinding>
  readonly repairs: ReadonlyArray<RepairRecord>
  readonly markdown: string
} {
  const repairs: RepairRecord[] = []
  let text = markdown

  // ── 类 1：代码块完整性（含"可推断才补语言标记"的修复） ──────────────────
  const fences = fenceBlocks(text)
  const untagged = fences.blocks.filter(b => !b.tagged)
  const inferred = untagged.map(b => inferFenceLanguage(b.body))
  const inferable = inferred.filter(l => l !== null).length
  // 逐个补：只补推得出来的那些，且逐处过逐字比对。
  let fenceRepairs = 0
  const fenceSamples: Array<{ before: string; after: string }> = []
  {
    const lines = text.split('\n')
    let open: { marker: string; tag: string; index: number; body: string[] } | null = null
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? ''
      const m = FENCE_OPEN.exec(line)
      if (open === null) {
        if (m !== null) open = { marker: m[2] ?? '', tag: m[3] ?? '', index: i, body: [] }
        continue
      }
      if (m !== null && (m[2] ?? '').startsWith(open.marker[0] ?? '`')) {
        if (open.tag === '') {
          const lang = inferFenceLanguage(open.body.join('\n'))
          if (lang !== null) {
            const before = lines[open.index] ?? ''
            const after = `${(FENCE_OPEN.exec(before)?.[1] ?? '')}${open.marker}${lang}`
            lines[open.index] = after
            fenceRepairs += 1
            if (fenceSamples.length < 3) fenceSamples.push({ before: before.trim(), after: after.trim() })
          }
        }
        open = null
        continue
      }
      open.body.push(line)
    }
    const next = lines.join('\n')
    if (fenceRepairs > 0) {
      // 遮掉**所有**围栏起始行后必须逐字节相同：证明这次改动只落在围栏行上
      // （第一版只遮"原本无标记"的行，于是"补了标记的行"在两边被遮得不一样，
      // 比对必然失败——比对写错会把正确改动判成改坏）。
      const sentinel = '\u0000'
      const maskFences = (s: string): string => s.replace(/^(\s*)(`{3,}|~{3,})\s*[A-Za-z0-9_+-]*\s*$/gm, sentinel)
      if (maskFences(text) !== maskFences(next)) {
        throw new Error('围栏语言标记的补写动了围栏行之外的文本 —— 逐字比对失败')
      }
      text = next
      repairs.push({ kind: '代码围栏语言标记（仅 100% 可推断）', count: fenceRepairs, samples: fenceSamples })
    }
  }
  const fenceFinding: FormatCheckFinding = {
    cls: 'fence',
    title: '代码块完整性',
    status: fences.unclosed > 0 ? 'manual' : fenceRepairs > 0 ? 'repaired' : 'passed',
    repairs: fenceRepairs,
    manual: fences.unclosed > 0
      ? [`有 ${String(fences.unclosed)} 个围栏未闭合 —— 未闭合的代码块会吞掉后面的正文，必须人工定位`]
      : [],
    detail: `${String(fences.blocks.length)} 个围栏块、未闭合 ${String(fences.unclosed)} 个；`
      + `无标记 ${String(untagged.length)} 个，其中 ${String(inferable)} 个可 100% 推断语言`
      + `（已补 ${String(fenceRepairs)} 个，其余保持裸围栏——猜错标记比不补更糟）`,
  }

  // ── 类 2：公式编号语法（`$$X$$` 行内 → `$X$`） ────────────────────────
  // 只动"同一行内还有别的文字"的那种（前面必须紧挨一个非空白字符）；整行只有
  // `$$…$$` 的是块公式，**不许动**。修复函数用回调形态显式拼替换串——用
  // `replace(pattern, '$1')` 会把 `$1` 当字面量，那是最难看出来的一类改坏。
  const inlineDollar = /(?<=\S)[^\S\n]*\$\$([^\n$]+?)\$\$/gu
  const inlineMatches = [...text.matchAll(inlineDollar)]
  let formulaCount = 0
  const formulaSamples: Array<{ before: string; after: string }> = []
  if (inlineMatches.length > 0) {
    const rewritten = text.replace(inlineDollar, (_m, inner: string) => ` $${inner}$`)
    // 逐字比对：把两边的行内 `$$X$$` 都遮成同一个哨兵，遮完必须完全相同。
    const sentinel = '\u0000'
    const maskedBefore = text.replace(inlineDollar, sentinel)
    const maskedAfter = rewritten.replace(/ \$[^\n$]+\$/gu, sentinel)
    if (maskedBefore !== maskedAfter) {
      throw new Error('行内块公式的改写动了目标模式之外的文本 —— 逐字比对失败')
    }
    formulaCount = inlineMatches.length
    for (const m of inlineMatches.slice(0, 3)) {
      formulaSamples.push({ before: m[0], after: ` $${m[1] ?? ''}$` })
    }
    text = rewritten
    repairs.push({ kind: '行内 `$$X$$` → `$X$`（块公式不动）', count: formulaCount, samples: formulaSamples })
  }
  // 块公式编号：`\tag{n}` 必须从 1 起连续。
  const tags = [...text.matchAll(/\\tag\{(\d+)\}/g)].map(m => Number(m[1] ?? '0'))
  const tagGaps: string[] = []
  tags.forEach((n, i) => {
    if (n !== i + 1) tagGaps.push(`第 ${String(i + 1)} 处 \\tag{${String(n)}}（应为 ${String(i + 1)}）`)
  })
  const dollarBalance = (text.match(/\$\$/g) ?? []).length
  const formulaFinding: FormatCheckFinding = {
    cls: 'formula',
    title: '公式编号语法',
    status: tagGaps.length > 0 || dollarBalance % 2 !== 0 ? 'manual' : formulaCount > 0 ? 'repaired' : 'passed',
    repairs: formulaCount,
    manual: [
      ...(dollarBalance % 2 !== 0 ? [`块公式定界符 \$\$ 出现 ${String(dollarBalance)} 次（奇数）—— 有未闭合的块公式`] : []),
      ...(tagGaps.length > 0 ? [`\\tag 编号不连续：${tagGaps.slice(0, 3).join('、')}`] : []),
    ],
    detail: `块公式定界符 ${String(dollarBalance)} 个（偶数才闭合）、\\tag 编号 ${String(tags.length)} 处；`
      + `行内 \$\$X\$\$ 修掉 ${String(formulaCount)} 处`,
  }

  // ── 类 3：三线表格式 ────────────────────────────────────────────────
  const tables = tableBlocks(text)
  const tableProblems: string[] = []
  tables.forEach((block, i) => {
    const widths = new Set(block.map(row => row.split('|').length))
    if (widths.size > 1) tableProblems.push(`第 ${String(i + 1)} 张表列数不一致（${[...widths].join('/')} 列）`)
    if (block.length >= 2 && !/^\|[\s:|-]+\|$/.test(block[1] ?? '')) {
      tableProblems.push(`第 ${String(i + 1)} 张表缺三线表分隔行（第二行不是 |---|---|）`)
    }
  })
  const tableFinding: FormatCheckFinding = {
    cls: 'table',
    title: '三线表格式',
    status: tableProblems.length > 0 ? 'manual' : 'passed',
    repairs: 0,
    manual: tableProblems.slice(0, 5),
    detail: `${String(tables.length)} 张表；列数与分隔行逐张核对`,
  }

  // ── 类 4：伪标题 / 伪题注 / 伪公式号（A0） ───────────────────────────
  const pseudo: string[] = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // `- 1.2 模型假设` / `- 表 3：…` / `- (1)` —— 标题/题注/公式号被写成列表项
    if (/^\s*[-*+]\s+(?:\d+(?:\.\d+)*\s+\S|表\s*\d+|图\s*\d+|\(\d+\)|\d+\.\s*\S)/.test(line)) {
      pseudo.push(`第 ${String(i + 1)} 行：${line.trim().slice(0, 40)}`)
    }
  })
  const pseudoFinding: FormatCheckFinding = {
    cls: 'pseudo_label',
    title: '伪标题/伪题注/伪公式号',
    status: pseudo.length > 0 ? 'manual' : 'passed',
    repairs: 0,
    manual: pseudo.slice(0, 5),
    detail: '扫描"章节标题 / 表注 / 图注 / 独行公式号被写成 - 列表项"的形态',
  }

  // ── 类 5：Markdown 噪声（含空全角括号的等价改写） ────────────────────
  // 空的全角括号 `（）` 不承载任何内容，改成半角是**确定的等价改写**；
  // 非空的 `（…）` 一律不动（那里面是内容，改标点就是改排版语义）。
  const parenRepair = applyRepair(text, '空的全角括号 `（）` → `()`', /（）/g, '()')
  if (parenRepair.record.count > 0) {
    text = parenRepair.text
    repairs.push(parenRepair.record)
  }
  const parenRepairs = parenRepair.record.count
  const noise: string[] = []
  const escaped = (text.match(/\\[\\`*_{}[\]()#+.!-]/g) ?? []).length
  if (escaped > 0) noise.push(`转义残留 ${String(escaped)} 处（\\* / \\_ / \\[ 之类）`)
  const htmlTags = [...text.matchAll(/<\/?(?:div|span|img|br|p|table|font)\b[^>]*>/gi)].map(m => m[0])
  if (htmlTags.length > 0) noise.push(`HTML 标签 ${String(htmlTags.length)} 处：${htmlTags.slice(0, 3).join('、')}`)
  const boldRuns = (text.match(/\*\*/g) ?? []).length
  const boldLines = lines.filter(l => l.trim().startsWith('**') && l.trim().endsWith('**') && l.trim().length > 40)
  if (boldLines.length > 3) noise.push(`整行加粗 ${String(boldLines.length)} 行（超过 3 行即视为滥用；表题注整行加粗是合规体例，不计入）`)
  const noiseFinding: FormatCheckFinding = {
    cls: 'noise',
    title: 'Markdown 噪声',
    status: noise.length > 0 ? 'manual' : parenRepairs > 0 ? 'repaired' : 'passed',
    repairs: parenRepairs,
    manual: noise,
    detail: `转义残留 ${String(escaped)}、HTML 标签 ${String(htmlTags.length)}、加粗标记 ${String(boldRuns)} 个（成对才闭合）；`
      + `空全角括号改写 ${String(parenRepairs)} 处`,
  }

  return {
    findings: [fenceFinding, formulaFinding, tableFinding, pseudoFinding, noiseFinding],
    repairs,
    markdown: text,
  }
}

/** 渲染报告（固定三段：自动修复 / 仍需人工 / 结论）。 */
export function renderFormatCheckReport(
  findings: ReadonlyArray<FormatCheckFinding>,
  repairs: ReadonlyArray<RepairRecord>,
  source: string,
): string {
  const icon = (s: FormatCheckFinding['status']): string =>
    s === 'passed' ? '✅ 通过' : s === 'repaired' ? '⚠️ 修复后通过' : '⚠️ 需人工'
  const L: string[] = []
  L.push('# DOCX 格式自检报告', '')
  L.push(`**目标文件**：\`${source}\``)
  L.push(`**检查类数**：${String(findings.length)}（${FORMAT_CHECK_CLASSES.join(' / ')}）`)
  L.push(`**自动修复合计**：${String(repairs.reduce((n, r) => n + r.count, 0))} 处`, '')
  L.push('## 检查结果汇总', '')
  L.push('| 类别 | 检查项 | 状态 | 修复次数 |')
  L.push('|------|--------|------|----------|')
  for (const f of findings) {
    L.push(`| ${f.cls} | ${f.title} | ${icon(f.status)} | ${String(f.repairs)} |`)
  }
  L.push('')
  for (const f of findings) L.push(`- **${f.title}**（\`${f.cls}\`）：${f.detail}`)
  L.push('')
  L.push('## 自动修复的问题', '')
  if (repairs.length === 0) {
    L.push('无（没有命中任何可安全改写的模式）。')
  } else {
    for (const r of repairs) {
      L.push(`### ${r.kind}（${String(r.count)} 处）`, '')
      L.push('逐处过"改动前后遮掉目标模式后逐字节相同"的比对，即**只改了该改的地方**：', '')
      for (const s of r.samples) L.push(`- \`${s.before}\` → \`${s.after}\``)
      L.push('')
    }
  }
  L.push('## 仍需人工处理的问题', '')
  const manual = findings.flatMap(f => f.manual.map(m => `- （${f.cls}）${m}`))
  if (manual.length === 0) L.push('无。')
  else L.push(...manual)
  L.push('')
  L.push('## 结论', '')
  const blocking = findings.filter(f => f.status === 'manual').length
  L.push(blocking === 0
    ? '✅ **通过**：五类检查全部成立，可安全进入 docx-export。'
    : `⚠️ **修复后通过**（有 ${String(blocking)} 类仍需人工）：本阶段是**非阻塞**的——`
      + '未消解的人工项照写报告，不阻断导出链。上面逐条列出的项需要在导出前由人确认。')
  L.push('')
  return L.join('\n')
}

/**
 * 跑阶段 10：检查 → 就地安全修复 → 出报告。
 *
 * **就地**：修复直接施加在 `07-paper/paper/main.md` 上（参考的 SKILL 就是就地改
 * `TARGET_FILE`），修复前的文本另存到本阶段目录的 `_before/main.md`——那是"改动前
 * 长什么样"的唯一副本，也是回滚证据。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 结论 + 修复记录 + 报告路径。
 */
export async function runFormatCheckStage(stagesRoot: string): Promise<FormatCheckResult> {
  const paperDir = stagePathOf(stagesRoot, 'paper')
  const ownDir = stagePathOf(stagesRoot, 'format-check')
  const mainPath = join(paperDir, PAPER_MAIN)
  const original = await readFile(mainPath, 'utf8').catch(() => null)
  if (original === null) {
    throw new Error(`阶段 7 没有产出 ${PAPER_MAIN} —— 本阶段没有可自检的正文`)
  }

  const { findings, repairs, markdown } = runFormatChecks(original)

  await mkdir(join(ownDir, '_before'), { recursive: true })
  await writeFile(join(ownDir, BEFORE_COPY), original, 'utf8')
  if (markdown !== original) await writeFile(mainPath, markdown, 'utf8')

  const report = renderFormatCheckReport(findings, repairs, `07-paper/${PAPER_MAIN}`)
  const reportPath = join(ownDir, FORMAT_CHECK_REPORT)
  await writeFile(reportPath, report, 'utf8')
  return { findings, repairs, markdown, reportPath }
}
