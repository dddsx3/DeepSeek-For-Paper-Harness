/**
 * W9-A1 — the data-figure ledger reader.
 *
 * 台账分离（参考实现 M1）：图只读台账，不在绘图路径里现算。台账是
 * `DataArtifact` 指向的真实数据文件（CSV / JSON），由**注入的解析器**读入。
 * 渲染器保持纯函数：内容进来说，数字嵌进规范 RenderInput，data_hash 因此
 * 覆盖实际画出的每一个值（N20：数字仍全部来自 store，未放宽）。
 *
 * xlsx 的转换发生在 DataArtifact 登记/捕获时（组合层职责——shell 已有
 * Python/openpyxl 通路）；本模块只解析文本格式（CSV / JSON），零依赖、确定性。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure/ledger
 */

/** One parsed ledger table: column names + rows of string cells. */
export interface LedgerTable {
  readonly columns: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
}

/**
 * Parse CSV text (RFC-4180 subset: quoted cells with `,`/`"`/newlines).
 * The first row is the header. Pure; deterministic.
 *
 * @param text - the ledger file content.
 */
export function parseCsv(text: string): LedgerTable {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1 } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; continue }
    if (ch === '\r') continue
    cell += ch
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  const header = rows[0] ?? []
  return { columns: header, rows: rows.slice(1) }
}

/**
 * Parse a JSON ledger: either `[[...]]` array-of-arrays (first row header)
 * or `{columns:[...], rows:[[...]]}`. Numbers stay numbers; everything else
 * is stringified. Pure; deterministic.
 *
 * @param text - the ledger file content.
 */
export function parseJsonTable(text: string): LedgerTable {
  const value = JSON.parse(text) as unknown
  if (Array.isArray(value)) {
    const header = (value[0] as ReadonlyArray<unknown> ?? []).map(c => String(c))
    return { columns: header, rows: (value.slice(1) as ReadonlyArray<ReadonlyArray<unknown>>).map(r => r.map(cellToString)) }
  }
  const obj = value as { columns?: ReadonlyArray<unknown>; rows?: ReadonlyArray<ReadonlyArray<unknown>> }
  if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
    return { columns: obj.columns.map(c => String(c)), rows: obj.rows.map(r => r.map(cellToString)) }
  }
  throw new Error('JSON ledger must be an array-of-arrays or {columns, rows}')
}

function cellToString(v: unknown): string {
  return String(v ?? '')
}

/**
 * Parse a ledger by media type. Unknown types refuse (fail-closed) rather
 * than guessing — a silently mis-parsed ledger would put wrong numbers on a
 * figure while claiming provenance.
 *
 * @param mediaType - the DataArtifact's declared media_type.
 * @param content - the file content.
 */
export function parseLedger(mediaType: string, content: string): LedgerTable {
  const mt = mediaType.toLowerCase()
  if (mt.includes('csv') || mt.includes('text/plain')) return parseCsv(content)
  if (mt.includes('json')) return parseJsonTable(content)
  // xlsx 必须在登记时转换为 CSV/JSON（组合层职责）——此处拒绝是诚实的：
  // 静默猜测解析方式会把错的数字画到图上还声称有溯源。
  throw new Error(`ledger media_type '${mediaType}' is not parseable here (supported: csv, json; convert xlsx at registration time)`)
}

/**
 * Extract one 2D series from a ledger table by column names.
 *
 * @param table - the parsed ledger.
 * @param xColumn - column name for the x axis.
 * @param yColumn - column name for the y axis.
 * @param label - series label.
 * @param errorColumn - optional column for error bars.
 */
export interface ExtractedSeries {
  /** Numeric x values (numeric axis), when the x column parses as numbers. */
  readonly x?: number[]
  /** Category labels (categorical axis), when the x column is non-numeric. */
  readonly xLabels?: string[]
  readonly y: number[]
  readonly error?: number[]
}

export function seriesFromLedger(
  table: LedgerTable,
  xColumn: string,
  yColumn: string,
  label: string,
  errorColumn?: string,
): ExtractedSeries {
  void label // the series label is applied by the caller (RenderSeries2D.label)
  const xi = table.columns.indexOf(xColumn)
  const yi = table.columns.indexOf(yColumn)
  if (xi < 0) throw new Error(`ledger column '${xColumn}' not found (have: ${table.columns.join(', ')})`)
  if (yi < 0) throw new Error(`ledger column '${yColumn}' not found (have: ${table.columns.join(', ')})`)
  const ei = errorColumn === undefined ? -1 : table.columns.indexOf(errorColumn)
  if (errorColumn !== undefined && ei < 0) throw new Error(`ledger column '${errorColumn}' not found`)
  // W9-B3（测试抓到的缺口）：类别轴（地块名 A1/B2…）是合法的柱状图 x 轴。
  // 判定：整列的数值可解析性——x 列全数值 → 数值轴；否则 → 类别轴。
  // 判定一次、整列一致（不逐行混合），避免同一轴两种语义。
  const xNumeric = table.rows.every(row => row[xi] === undefined || row[xi] === '' || Number.isFinite(Number(row[xi])))
  const x: number[] = []
  const xLabels: string[] = []
  const y: number[] = []
  const error: number[] = []
  for (const row of table.rows) {
    const yv = Number(row[yi])
    if (!Number.isFinite(yv)) continue // non-numeric y rows (labels/notes) are skipped, deterministically
    if (xNumeric) {
      const xv = Number(row[xi])
      if (!Number.isFinite(xv)) continue
      x.push(xv)
    } else {
      xLabels.push(row[xi] ?? '')
    }
    y.push(yv)
    if (ei >= 0) {
      const ev = Number(row[ei])
      error.push(Number.isFinite(ev) ? ev : 0)
    }
  }
  if (y.length === 0) throw new Error(`ledger produced no numeric rows for x='${xColumn}' y='${yColumn}'`)
  return {
    ...(xNumeric ? { x } : { xLabels }),
    y,
    ...(error.length > 0 ? { error } : {}),
  }
}
