/**
 * W11.5-A3 — 数字核对步（路径 B / E1 直通稿的自洽扫描）.
 *
 * 目标（新总书 §3.1-A3）：把"绕过零数字通道"变成"**事后核对**零数字通道"。
 *
 * **为什么不是"运行交付物自带的代码"**（如实记录的设计偏差）：A3 原稿假设
 * 交付物自带可运行代码，但 E1 是**纯散文分析**——真实运行的 E1 全文
 * （W10-MQUAL run-2，4786 字符）**不含任何代码块**，路径 B 的交付物因此没有
 * "自带代码"可跑。运行时代的数字核对只能发生在**路径 A**（生产链本来就在
 * 跑代码、经 jsonPath 回读数字，即是同一件事的更强形态）。故本模块实现路径 B
 * 真正可获得的那一类核对：**稿件自洽性**。
 *
 * **只抓一类、且零误报面最小**：稿件**自相矛盾**的算式。形如
 * `$q_f=0.9^8\times0.9\times0.9\times0.9\approx0.478$` —— 全部操作数是字面
 * 数字，等号/约等号给出结果，而该结果与算式求值不符。这一类**不依赖任何外部
 * 真值**：稿件与自己矛盾，就是错的（这是"正确的稿 → 零误报"成立的根据——
 * 正确的稿不会自相矛盾）。
 *
 * 真实样本（第零次内测交付物 `artifacts/handoff/neizero/report.md`）：
 *   - `0.9^8\times0.9\times0.9\times0.9\approx0.478` → 实为 0.3138 → **抓**
 *   - `0.872\times0.9\times0.9=0.706` → 0.70632 → 通过（**不误报**）
 *   - `0.197\times4=0.79` → 0.788 → 通过（半 ULP 容差吸收两位小数四舍五入）
 *
 * **明确不抓**（避免"量具失效"形态 4，如实声明覆盖边界）：
 *   - 与**错误代码**一致的错数字（V=32.06 vs 正文 21.87 那一类）——需运行
 *     代码，属路径 A 的 jsonPath 回读；
 *   - 方法错配（Wald vs CP 的 0.128 vs 0.160）——需重算，不属自洽性；
 *   - 表格/正文之间的同义冲突——标签语义不可机械判定，硬抓必出误报。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/digit-check
 */

export interface DigitContradictionFinding {
  readonly kind: 'arithmetic_self_contradiction'
  /** The math segment the contradiction was found in (trimmed, bounded). */
  readonly expression: string
  /** The value the draft states. */
  readonly stated: number
  /** The value the draft's own operands produce. */
  readonly computed: number
  readonly reason: string
}

/** Operators and how they fold into the evaluator. */
const OPERATOR_TOKENS: ReadonlyArray<{ readonly pattern: RegExp; readonly op: string }> = [
  { pattern: /\\times|\\cdot|\\ast|\*/g, op: '*' },
  { pattern: /\\div|\//g, op: '/' },
  { pattern: /\\pm|\+/g, op: '+' },
  { pattern: /-/g, op: '-' },
  { pattern: /\^|\*\*/g, op: '^' },
]

/** Split a math segment into [lhs..., statedValue] on `=`/`\approx`. */
function splitOnEquals(segment: string): string[] {
  return segment.split(/\\approx|\\approx|≈|=/g).map(part => part.trim()).filter(p => p.length > 0)
}

/** Number of decimals in a numeric literal ('0.706' → 3, '0.79' → 2). */
function decimalsOf(literal: string): number {
  const dot = literal.indexOf('.')
  return dot < 0 ? 0 : literal.length - dot - 1
}

/**
 * Evaluate a pure arithmetic expression whose operands are numeric literals.
 * Returns null when the expression is not purely numeric (a symbol, a unit, a
 * LaTeX command, a percent sign …) — those are skipped, never guessed at.
 */
function evaluatePureArithmetic(expression: string): { value: number; decimals: number } | null {
  // A leading symbol assignment (`q`, `q_f`, `V`) is stripped: the VALUE side
  // is what this check compares.
  // Normalise the SUPPORTED operator commands to symbols FIRST: `\times`
  // contains letters, and the "no letters" guard below exists to reject
  // symbols/units/text — running it before normalisation made every real
  // LaTeX expression out of scope (found by this module's own tests on the
  // first run: the scanner found nothing at all).
  const expr = expression
    .replace(/\\times|\\cdot|\\ast/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pm/g, '+')
    .trim()
  if (expr.length === 0) return null
  // Percentages, units and any remaining letter (a symbol, \text{…}, a prose
  // word) make the arithmetic non-bare: skip — never guess.
  if (/[%％]|[A-Za-z]/.test(expr)) return null

  // Tokenise: numbers, operators, parentheses.
  type Token = { kind: 'num'; value: number; decimals: number } | { kind: 'op'; op: string } | { kind: 'open' } | { kind: 'close' }
  const tokens: Token[] = []
  let index = 0
  while (index < expr.length) {
    const rest = expr.slice(index)
    const numMatch = /^\d+(?:\.\d+)?/.exec(rest)
    if (numMatch !== null) {
      tokens.push({ kind: 'num', value: Number.parseFloat(numMatch[0]), decimals: decimalsOf(numMatch[0]) })
      index += numMatch[0].length
      continue
    }
    const opMatch = OPERATOR_TOKENS
      .map(o => ({ op: o.op, match: new RegExp(`^(?:${o.pattern.source})`).exec(rest) }))
      .find(candidate => candidate.match !== null)
    if (opMatch !== undefined && opMatch.match !== null) {
      tokens.push({ kind: 'op', op: opMatch.op })
      index += opMatch.match[0].length
      continue
    }
    if (rest.startsWith('(') || rest.startsWith('{')) { tokens.push({ kind: 'open' }); index += 1; continue }
    if (rest.startsWith(')') || rest.startsWith('}')) { tokens.push({ kind: 'close' }); index += 1; continue }
    if (/^\s/.test(rest)) { index += 1; continue }
    // Anything else (a leftover backslash command, a Chinese character) makes
    // this expression out of scope: skip, never guess.
    return null
  }

  // Recursive-descent evaluation with standard precedence and REAL
  // parentheses. The first version dropped parentheses, which produced a
  // false positive on the real deliverable (`0.81	imes(4+18)=17.82` is
  // CORRECT: 0.81×22=17.82; a flat evaluator read it as 0.81×4+18=21.24).
  // A digit check that cries wolf on correct arithmetic is worse than none.
  let cursor = 0
  const peek = (): Token | undefined => tokens[cursor]
  const eat = (): Token | undefined => { const t = tokens[cursor]; cursor += 1; return t }
  const parseExpr = (): number | null => {
    let left = parseTerm()
    if (left === null) return null
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && (token.op === '+' || token.op === '-')) {
        eat()
        const right = parseTerm()
        if (right === null) return null
        left = token.op === '+' ? left + right : left - right
        continue
      }
      return left
    }
  }
  const parseTerm = (): number | null => {
    let left = parseFactor()
    if (left === null) return null
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && (token.op === '*' || token.op === '/')) {
        eat()
        const right = parseFactor()
        if (right === null) return null
        left = token.op === '*' ? left * right : left / right
        continue
      }
      return left
    }
  }
  const parseFactor = (): number | null => {
    const base = parsePrimary()
    if (base === null) return null
    const token = peek()
    if (token?.kind === 'op' && token.op === '^') {
      eat()
      const exponent = parseFactor() // right-associative
      if (exponent === null) return null
      return base ** exponent
    }
    return base
  }
  const parsePrimary = (): number | null => {
    const token = eat()
    if (token === undefined) return null
    if (token.kind === 'num') return token.value
    if (token.kind === 'open') {
      const inner = parseExpr()
      const close = eat()
      if (inner === null || close?.kind !== 'close') return null
      return inner
    }
    return null
  }
  const value = parseExpr()
  if (value === null || cursor !== tokens.length || !Number.isFinite(value)) return null
  const numbers = tokens.filter((t): t is { kind: 'num'; value: number; decimals: number } => t.kind === 'num')
  if (numbers.length < 3) return null
  const operatorCount = tokens.filter(t => t.kind === 'op').length
  if (operatorCount < 2) return null
  const decimals = numbers.reduce((max, n) => Math.max(max, n.decimals), 0)
  return { value, decimals }
}

/**
 * Scan a delivered draft for arithmetic self-contradictions.
 *
 * Pure, total, read-only. Returns one finding per contradicted statement;
 * an empty array means the draft's own arithmetic is self-consistent (it does
 * NOT mean the numbers are right — that claim needs the executable path).
 */
export function digitSelfContradictionFindings(text: string): ReadonlyArray<DigitContradictionFinding> {
  const findings: DigitContradictionFinding[] = []
  // Math segments only: `$...$` and `$$...$$`. Prose numbers have no stated
  // computation, so judging them here would be guesswork.
  const segments = [...text.matchAll(/\$\$([^$]+)\$\$|\$([^$]+)\$/g)].map(m => m[1] ?? m[2] ?? '')
  for (const segment of segments) {
    const parts = splitOnEquals(segment)
    if (parts.length < 2) continue
    const last = parts[parts.length - 1] ?? ''
    const statedMatch = /^\d+(?:\.\d+)?$/.exec(last.trim())
    if (statedMatch === null) continue
    const stated = Number.parseFloat(statedMatch[0])
    // The value side may itself be a chain (`q=0.872\times0.9\times0.9=0.706`):
    // the part before the last `=` is the expression.
    const expression = parts[parts.length - 2] ?? ''
    const computed = evaluatePureArithmetic(expression)
    if (computed === null) continue
    // Half-ULP of the STATED precision: a two-decimal statement may differ by
    // up to 0.005 through rounding alone. No invented threshold — the
    // tolerance is exactly the rounding the draft's own notation implies.
    const tolerance = 0.5 * 10 ** -decimalsOf(statedMatch[0]) * 1.05
    const deviation = Math.abs(computed.value - stated)
    if (deviation <= tolerance) continue
    findings.push({
      kind: 'arithmetic_self_contradiction',
      expression: segment.trim().slice(0, 200),
      stated,
      computed: computed.value,
      reason: `稿件自相矛盾：表达式「${segment.trim().slice(0, 120)}」按自身操作数求值为 ${computed.value}，稿内却写 ${stated}（差 ${deviation.toFixed(6)}，超出该写法四舍五入所能解释的 ${tolerance}）`,
    })
  }
  return findings
}
