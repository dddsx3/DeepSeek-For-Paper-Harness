/**
 * P1-3 — v1 template-report renderer.
 *
 * The FORMAL deliverable is a *template report*: the machine numbers are
 * rendered from the canonical Result records (IR → report), never typed by
 * hand. The model's free prose lives in named narrative sections; the
 * conclusion section is guarded so a number that is not one of the Result
 * values is a rendering refusal, not a silent paper claim (task book P1-3:
 * "结论区禁关键数值自由书写").
 *
 * Guard rule (v0, conservative): every numeric literal appearing in the
 * `conclusion` narrative section must exactly equal some Result value
 * (String(value) match, with the result uncertainty allowed as a separate
 * '±…' token). Other sections are free prose — methods describe parameters,
 * not results, and a false-positive ban there would kill legitimate writing.
 * The guard refuses (returns a finding) rather than silently editing.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce
 */

/** One canonical Result row, injected from the IR (never from prose). */
export interface ResultRow {
  readonly result_id: string
  readonly name: string
  readonly value: number
  readonly unit: string
  readonly uncertainty: number | null
}

export type RenderVerdict =
  | { ok: true; text: string }
  | { ok: false; code: 'conflicting_conclusion_number'; reason: string }

const NUMBER_LITERAL = /[-+]?(?:\d+\.?\d*|\.\d+)/gu

/** Render the v1 template report. `narrative` is the container's raw block. */
export function renderV1Report(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  /** raw container narrative block (e.g. { conclusion, methods }). */
  readonly narrative: Record<string, unknown>
}): RenderVerdict {
  const resultValues = new Set(input.results.map(r => String(r.value)))

  // ---- Conclusion guard: every numeric literal must be a Result value. ----
  const conclusion = input.narrative['conclusion']
  if (conclusion !== undefined) {
    const conflicts: string[] = []
    const tokens: string[] = []
    for (const match of String(conclusion).matchAll(NUMBER_LITERAL)) tokens.push(match[0])
    for (const token of tokens) {
      // Allow the guard's own syntax: nothing special — a literal that is
      // not a Result value is a conflict. Units and words are untouched.
      if (!resultValues.has(token) && !token.startsWith('±')) {
        conflicts.push(token)
      }
    }
    if (conflicts.length > 0) {
      const uniq = [...new Set(conflicts)]
      return {
        ok: false,
        code: 'conflicting_conclusion_number',
        reason: `conclusion contains numeric literal(s) [${uniq.join(', ')}] that are not Result values [${[...resultValues].join(', ')}] — key numbers may only be injected from the IR (P1-3)`,
      }
    }
  }

  // ---- Template assembly: the table is IR-injected, prose is bound. ----
  const lines: string[] = []
  lines.push(`# ${input.title}`)
  lines.push('')
  lines.push('## 结果表（由规范 IR 注入；结论区关键数字必须与此表一致）')
  lines.push('')
  lines.push('| 量名 | 数值 | 单位 | 不确定度 | 来源 |')
  lines.push('|---|---|---|---|---|')
  for (const result of input.results) {
    const uncertainty = result.uncertainty === null ? '' : `±${result.uncertainty}`
    lines.push(`| ${result.name} | ${result.value} | ${result.unit} | ${uncertainty} | \`${result.result_id}\` |`)
  }
  lines.push('')
  lines.push('## 结论')
  lines.push('')
  lines.push(String(conclusion ?? ''))
  const methods = input.narrative['methods']
  if (methods !== undefined) {
    lines.push('')
    lines.push('## 方法')
    lines.push('')
    lines.push(String(methods))
  }
  lines.push('')
  lines.push('---')
  lines.push('*v1 template report — machine numbers rendered from canonical IR Result records; prose conclusion may not introduce key numbers.*')
  return { ok: true, text: lines.join('\n') }
}
