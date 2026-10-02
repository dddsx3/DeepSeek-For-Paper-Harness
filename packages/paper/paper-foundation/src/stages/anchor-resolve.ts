/**
 * 结果锚点替换 —— 把论文正文里的 `{R-…}` 换成**账本里的值**。
 *
 * ## 为什么必须有这一步
 *
 * 契约（阶段 2 起）一直要求"要报结果的地方写锚点，不写数"：形如 `{R-Q2-case5-profit}`。
 * 但**没有任何环节把锚点换成值**——`docx_precheck` 只认 `{<result_id>}` 这种尖括号形态，
 * `numbers_traced` 又把 `{…}` 整段剥掉（那是为了不误判 JSON）。于是锚点会**原样印进 Word**：
 * 论文正文里出现 `{R-Q2-case5-profit}` 字样，而这是最终交付物。
 *
 * 这是"零数字通道"缺的最后一段：数字只能由 harness 从**真实执行的产物字节**里取
 * （阶段 4 铸账本），再由 harness 填进正文——模型从头到尾不持有一个数值。
 * 参考实现里这段是有的（`report-renderer` 的 render-time 替换），本 harness 漏了。
 *
 * ## 三条纪律
 *
 * 1. **只替换散文，不碰代码块**：附录 A 是代码，里面的 `{…}` 是 Python 字面量。
 * 2. **替换不了就留着**：账本里没有的 id、或值是数组/矩阵（不能内联成数值）时**原样保留**，
 *    由门禁 `paper_claim_check` 判硬失败。**不许猜、不许置空**——静默改字比留下可见的
 *    错误更糟（前者会印出一句读起来通顺但错的论文）。
 * 3. **精度有界**：按 4 位有效小数格式化，且该格式化结果与账本真值的偏差在千分之几以内
 *    （`addRoundedVariants` 把同一批变体加进 `numbers_traced` 的白名单，两边必须同步）。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readMintedResults } from './execute-and-mint.ts'
import { stagePathOf } from './figure-render.ts'

/** 锚点替换报告（门禁读它来给出"替换了几条、哪几条没换成"的证据）。 */
export const ANCHOR_REPORT_FILE = '_anchor-report.json'

/** 正文里的结果锚点：`{R-…}`。id 形态与 `RESULT_SOURCES.json` 的 `result_id` 一致。 */
const ANCHOR_RE = /\{(R-[A-Za-z0-9_][A-Za-z0-9_.-]*)\}/g

/** 一条账目的最小投影（只用到这三列）。 */
export interface LedgerRow {
  readonly result_id: string
  readonly name?: string
  readonly value?: unknown
  readonly unit?: string
}

/** 一条没换成的原因。 */
export interface UnresolvedAnchor {
  readonly id: string
  /** 为什么没换（直接给模型看，所以要说人话）。 */
  readonly reason: string
}

/** 替换结论。 */
export interface AnchorOutcome {
  /** 替换后的正文。 */
  readonly text: string
  /** 成功替换的锚点（去重后按出现顺序）。 */
  readonly resolved: ReadonlyArray<{ readonly id: string; readonly value: number }>
  /** 没能替换的锚点（**门禁据此判硬失败**）。 */
  readonly unresolved: ReadonlyArray<UnresolvedAnchor>
}

/**
 * 把 Markdown 里的**围栏代码块**整段置空（保留换行数，行号映射不变）。
 *
 * 判据只看行首的 ``` 或 ~~~：附录 A 的代码块用 ``` 围起来，块内的 `{…}` 是代码不是锚点。
 * 用置空而不是删除，是为了让调用方的行号仍然对得上原文。
 *
 * @param markdown - 原文。
 * @returns 同长度（按行）的文本，代码块内容被换成空行。
 */
export function blankFencedCode(markdown: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (fence === null) {
      if (m !== null) { fence = m[1] ?? '```'; out.push('') } else out.push(line)
      continue
    }
    out.push('')
    if (m !== null && (m[1] ?? '').startsWith(fence[0] ?? '`')) fence = null
  }
  return out.join('\n')
}

/**
 * 取出一段文本里的锚点 id（**散文里的**，代码块由调用方先置空）。
 *
 * @param prose - 已剥代码块的文本。
 * @returns 按出现顺序去重的 id。
 */
export function anchorsIn(prose: string): ReadonlyArray<string> {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of prose.matchAll(new RegExp(ANCHOR_RE.source, 'g'))) {
    const id = m[1]
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * 把一个结果值格式化成正文里的数。
 *
 * 4 位有效小数、去尾零——`15.8765432` → `15.8765`，`0.5` → `0.5`。
 * 极小/极大值走科学计数法（`7.0089e-08` → `7.0089e-8`），否则正文里会出现一长串 0。
 *
 * @param value - 账本里的数值（调用方保证是有限数）。
 * @returns 可读的数值字面量。
 */
export function formatResultValue(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs < 1e-4 || abs >= 1e7) {
    // 科学计数法：`toExponential(4)` → `7.0089e-8`（去尾零，指数去前导 0）
    const [mantissa, exponent] = value.toExponential(4).split('e')
    const trimmed = String(Number(mantissa))
    return `${trimmed}e${String(Number(exponent))}`
  }
  return String(Number(value.toFixed(4)))
}

/**
 * 把正文里的结果锚点换成账本里的值。
 *
 * @param markdown - `paper/main.md` 的原文。
 * @param rows - 账本（`results.json` 的 `results`）。
 * @returns 替换后的正文 + 成功/失败清单。
 */
export function substituteResultAnchors(
  markdown: string,
  rows: ReadonlyArray<LedgerRow>,
): AnchorOutcome {
  const byId = new Map<string, LedgerRow>()
  for (const row of rows) byId.set(row.result_id, row)
  const prose = blankFencedCode(markdown)
  const resolved: Array<{ id: string; value: number }> = []
  const unresolved: UnresolvedAnchor[] = []
  const ids = anchorsIn(prose)
  for (const id of ids) {
    const row = byId.get(id)
    if (row === undefined) {
      unresolved.push({ id, reason: '账本里没有这个 result_id（数只能来自阶段 4 铸出的账本）' })
      continue
    }
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) {
      unresolved.push({
        id,
        reason: '该结果是数组/矩阵/记录，不能内联成一个数值 —— 它属于图表或表格，'
          + '正文要引用它就写成"见图 N"或"见表 N"',
      })
      continue
    }
    resolved.push({ id, value: row.value })
  }
  if (resolved.length === 0) return { text: markdown, resolved, unresolved }
  // **只在散文区替换**：逐行判断该行是否落在代码块里（用同一套围栏扫描，避免
  // 二次实现导致两边判据漂移——第一次就踩过"附录代码里的 {} 被当成锚点"）。
  const proseLines = prose.split('\n')
  const rawLines = markdown.split('\n')
  const formatted = new Map(resolved.map(r => [r.id, formatResultValue(r.value)]))
  const out = rawLines.map((line, i) => {
    if (proseLines[i] !== line) return line // 这一行在代码块里 → 不动
    return line.replace(new RegExp(ANCHOR_RE.source, 'g'), (whole, id: string) => formatted.get(id) ?? whole)
  })
  return { text: out.join('\n'), resolved, unresolved }
}

/** 替换报告的形态（门禁与测试共用）。 */
export interface AnchorReport {
  readonly resolved: number
  readonly unresolved: ReadonlyArray<UnresolvedAnchor>
}

/**
 * 解析替换报告；坏文件按 `null` 处理（**不因此阻断**——门禁自己还会扫一遍正文）。
 *
 * @param raw - `_anchor-report.json` 的文本，可能为 `null`。
 * @returns 报告；读不出来返回 `null`。
 */
export function parseAnchorReport(raw: string | null): AnchorReport | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const o = parsed as Record<string, unknown>
    const resolved = typeof o['resolved'] === 'number' ? o['resolved'] : 0
    const list = Array.isArray(o['unresolved']) ? o['unresolved'] : []
    const unresolved = list.flatMap((x): ReadonlyArray<UnresolvedAnchor> => {
      if (typeof x !== 'object' || x === null) return []
      const e = x as Record<string, unknown>
      const id = typeof e['id'] === 'string' ? e['id'] : ''
      const reason = typeof e['reason'] === 'string' ? e['reason'] : ''
      return id === '' ? [] : [{ id, reason }]
    })
    return { resolved, unresolved }
  } catch {
    return null
  }
}

/** 论文正文在阶段目录里的相对路径（与注册表的 `produces` 逐字一致）。 */
export const PAPER_MAIN_FILE = 'paper/main.md'

/**
 * 把 `paper/main.md` 里的结果锚点换成账本真值（harness 侧后处理，模型不参与）。
 *
 * 幂等：替换后的正文里没有锚点了，再跑一次是空操作（`replace` 也保证只换散文区）。
 * 账本不在时**什么都不做**——门禁会给 `2`（无法判定），而不是静默放行。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 替换统计（`total` 为 0 表示正文里本来就没有锚点）。
 */
export async function resolvePaperAnchors(
  stagesRoot: string,
): Promise<{ readonly total: number; readonly resolved: number; readonly unresolved: number }> {
  const ledger = await readMintedResults(stagesRoot)
  if (ledger === null) return { total: 0, resolved: 0, unresolved: 0 }
  const path = join(stagePathOf(stagesRoot, 'paper'), PAPER_MAIN_FILE)
  const original = await readFile(path, 'utf8').catch(() => null)
  if (original === null) return { total: 0, resolved: 0, unresolved: 0 }
  const outcome = substituteResultAnchors(original, ledger.results)
  const total = outcome.resolved.length + outcome.unresolved.length
  if (total === 0) return { total: 0, resolved: 0, unresolved: 0 }
  if (outcome.resolved.length > 0) await writeFile(path, outcome.text, 'utf8')
  await writeFile(
    join(stagePathOf(stagesRoot, 'paper'), ANCHOR_REPORT_FILE),
    `${JSON.stringify({ resolved: outcome.resolved.length, unresolved: outcome.unresolved }, null, 2)}\n`,
    'utf8',
  ).catch(() => { /* 报告写不了不影响正文替换本身；门禁自己还会扫正文 */ })
  return { total, resolved: outcome.resolved.length, unresolved: outcome.unresolved.length }
}
