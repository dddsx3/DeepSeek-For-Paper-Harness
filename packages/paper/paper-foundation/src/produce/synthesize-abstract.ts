/**
 * 摘要自动生成 — R5④（论文成型，D4 数字回读）.
 *
 * 路线书 D4：正文每个数字可回溯结果 JSON；不存在只存在于散文中的数字。
 * 摘要由 harness 从**已验证的结论槽**（其文本已被逐字核对含 Result 值）与
 * 结果表**机械拼接**而成：harness 自己写的数字全部来自 Result/不确定度。
 *
 * 守卫（本模块的负对照）：摘要中出现的**每一个数字片段**必须落在
 * `allowedTokens`（Result 值 + 不确定度值）；结论槽文本带外部数字 → 整段
 * 拒绝（绝不悄悄改数字）；`methodsNote` 若含外部数字则整段剔除（方法叙述
 * 不是摘要素材）。摘要生成是确定性的：同输入 → 同输出。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/synthesize-abstract
 */

export interface AbstractResult {
  readonly result_id: string
  readonly value: number
  readonly uncertainty: number | null
}

export interface AbstractClaim {
  /** Once the renderer's verbatim check passes, every digit-run IS a value. */
  readonly text: string
}

export interface AbstractInput {
  readonly title: string
  readonly results: ReadonlyArray<AbstractResult>
  readonly claims: ReadonlyArray<AbstractClaim>
  /** Optional method note; dropped wholesale if it carries a foreign number. */
  readonly methodsNote: string | undefined
  /** W11.5 baseline-23: numbers the registered problem statement contains —
   *  input data, not claims (the same allowance the conclusion guard makes). */
  readonly givenLiterals?: ReadonlyArray<string>
}

export type AbstractVerdict =
  | { ok: true; abstract: string }
  | { ok: false; reason: string }

/** All digit-runs in a text (including decimals like 0.731 / 109 / 1.5e3? 只数字串). */
function digitRunsOf(text: string): ReadonlyArray<string> {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map(m => m[0])
}

/**
 * Synthesize the abstract. Every number in the output must be a Result value
 * or an uncertainty — otherwise the whole synthesis refuses (D4 guard).
 */
export function synthesizeAbstract(input: AbstractInput): AbstractVerdict {
  const allowed = new Set<string>()
  for (const r of input.results) {
    allowed.add(String(r.value))
    if (r.uncertainty !== null) allowed.add(String(r.uncertainty))
  }
  for (const literal of input.givenLiterals ?? []) allowed.add(literal)
  if (allowed.size === 0 && input.results.length > 0) {
    return { ok: false, reason: 'no distinguishable Result values to anchor the abstract' }
  }

  const lines: string[] = []
  lines.push(`针对《${input.title}》，本文建立定量模型并给出关键结论。`)
  lines.push('')

  const claims: string[] = []
  for (const claim of input.claims) {
    if (digitRunsOf(claim.text).some(d => !allowed.has(d))) {
      return { ok: false, reason: `claim text carries a number outside the Result/uncertainty set: …${claim.text.slice(0, 60)}…` }
    }
    claims.push(`- ${claim.text}`)
  }
  if (claims.length === 0) {
    lines.push('结论见正文结果表。')
  } else {
    lines.push('关键结论：')
    lines.push(...claims)
  }

  if (input.methodsNote !== undefined && input.methodsNote.trim() !== '') {
    const note = input.methodsNote.trim()
    if (digitRunsOf(note).every(d => allowed.has(d))) {
      lines.push('', `方法要点：${note}`)
    }
    // a note with foreign numbers is dropped whole — the abstract stays D4-clean
  }

  const abstract = lines.join('\n')
  const foreign = digitRunsOf(abstract).filter(d => !allowed.has(d))
  if (foreign.length > 0) {
    return { ok: false, reason: `abstract carries foreign numbers: ${[...new Set(foreign)].join(', ')}` }
  }
  return { ok: true, abstract }
}
