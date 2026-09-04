/**
 * P1-3 → P2-4 — template-report renderer (v1 prose guard, v2 conclusion
 * slots + figure embedding).
 *
 * The FORMAL deliverable is a *template report*: machine numbers are
 * rendered from the canonical Result records (IR → report), never typed by
 * hand. Prose conclusions are guarded; since P2-4 the model may instead
 * declare a STRUCTURED conclusion (`{ claims: [{ text, quantity_refs,
 * uncertainty_refs?, comparison? }] }`), whose every quantity_ref number
 * must match the result table verbatim inside the claim text. At least one
 * layer always guards the conclusion (P2 禁6): a structured slot is
 * checked slot-wise AND still passes through the text literal guard with
 * the slot's own allowed set; a legacy string conclusion keeps the v1
 * whole-conclusion guard.
 *
 * Figures (P2-3): each rendered figure's real SVG bytes are embedded as a
 * self-contained data URI and the provenance appendix lists data_hash /
 * source Results / renderer version / file sha256 — no figure is copied by
 * hand into the report.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce
 */

import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'

/** One canonical Result row, injected from the IR (never from prose). */
export interface ResultRow {
  readonly result_id: string
  readonly name: string
  readonly value: number
  readonly unit: string
  readonly uncertainty: number | null
}

/**
 * P3-2 (E6 sign-off A): the CLOSED set of representation declarations a
 * conclusion claim may carry. `verbatim` is the P2-4 default; `rounded` and
 * `with_uncertainty` are the ONLY ways a non-verbatim number may enter the
 * conclusion, and each is deterministically checked against the IR values
 * before the slot is allowed. The default zero-tolerance semantics are not
 * relaxed on any path: an undeclared ≈/rounding stays a refusal (禁2/禁6).
 */
export type SlotRepresentation =
  | { readonly kind: 'verbatim' }
  | { readonly kind: 'rounded'; readonly dp: number }
  | { readonly kind: 'with_uncertainty'; readonly uncertainty_refs: ReadonlyArray<string> }

/** A structured conclusion claim (P2-4 slot; P3-2 adds `representation`). */
export interface ConclusionSlot {
  readonly text: string
  /** Result ids whose value must appear verbatim in `text` — unless the
   *  claim carries a `representation` declaration that widens this. */
  readonly quantity_refs: ReadonlyArray<string>
  readonly uncertainty_refs?: ReadonlyArray<string>
  readonly comparison?: string
  /** P3-2: the explicit representation contract for this claim. */
  readonly representation?: SlotRepresentation
}

/** One rendered figure asset ready for embedding. */
export interface FigureAssetRow {
  readonly figureId: string
  readonly caption?: string
  readonly svg: string
  readonly data_hash: string
  readonly resultRefs: ReadonlyArray<string>
  readonly rendererVersion: string
}

export type RenderVerdict =
  | { ok: true; text: string }
  | { ok: false; code: 'conflicting_conclusion_number'; reason: string }

// A numeric literal whose leading '-' belongs to a unit exponent ('km^-1')
// or an identifier ('x-1') is excluded by the two lookbehinds; a genuinely
// signed number ('-0.731') keeps its sign (preceding char is a space).
const NUMBER_LITERAL = /(?<![A-Za-z^])(?<![A-Za-z^]-)[-+]?(?:\d+\.?\d*|\.\d+)(?![A-Za-z])/gu

function numericLiterals(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(NUMBER_LITERAL)) out.push(match[0])
  return out
}

/**
 * P3-2: format a source value at the declared decimal places using the ONE
 * rounding rule this harness knows — half-up on the decimal string, the same
 * function used to validate the claim, so a declared `rounded: { dp }` slot
 * can only contain exactly this rendering (声明即契约). Negative numbers,
 * scientific notation, and non-finite values carry no v1 promise and are
 * refused fail-closed (任务书 §7 风险 3 / D-P3.2).
 */
function formatRounded(value: number, dp: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  const plain = String(value)
  if (plain.includes('e') || plain.includes('E')) return null
  // Normalize through fixed-point so 0.731@dp2 -> 0.73 with half-up carried
  // on the decimal digits (0.005@dp2 -> 0.01, never banker's rounding).
  const scaled = Number(value.toFixed(20))
  const fixed = scaled.toFixed(dp)
  if (fixed.includes('e') || fixed.includes('E')) return null
  return fixed
}

/**
 * P3-2: parse and validate a raw `representation` declaration. Returns the
 * normalized declaration or a refusal reason — never upgrades a malformed
 * declaration to verbatim (fail-closed, 攻击 4: negative dp / science form).
 */
function parseRepresentation(raw: unknown): { ok: true; value: SlotRepresentation } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, value: { kind: 'verbatim' } }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'representation must be an object with a closed-set kind (verbatim | rounded | with_uncertainty)' }
  }
  const kind = (raw as { kind?: unknown }).kind
  if (kind === 'verbatim') return { ok: true, value: { kind: 'verbatim' } }
  if (kind === 'rounded') {
    const dp = (raw as { dp?: unknown }).dp
    if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 20) {
      return { ok: false, reason: `rounded representation requires an integer dp 0..20 (v1: negative/scientific fail-closed), got ${JSON.stringify(dp)}` }
    }
    return { ok: true, value: { kind: 'rounded', dp } }
  }
  if (kind === 'with_uncertainty') {
    const refs = (raw as { uncertainty_refs?: unknown }).uncertainty_refs
    if (!Array.isArray(refs) || refs.length === 0 || refs.some(r => typeof r !== 'string')) {
      return { ok: false, reason: 'with_uncertainty representation requires a non-empty uncertainty_refs string array' }
    }
    return { ok: true, value: { kind: 'with_uncertainty', uncertainty_refs: refs } }
  }
  return { ok: false, reason: `representation kind '${String(kind)}' is outside the closed set (verbatim | rounded | with_uncertainty)` }
}

/** @internal shared assembly; `conclusionKind` routes the guards. */
function renderReport(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  readonly narrative: Record<string, unknown>
  readonly figures: ReadonlyArray<FigureAssetRow>
}): RenderVerdict {
  const resultById = new Map(input.results.map(r => [r.result_id, r]))
  const allAllowed = new Set<string>()
  for (const result of input.results) {
    allAllowed.add(String(result.value))
    if (result.uncertainty !== null) allAllowed.add(String(result.uncertainty))
  }

  const conclusionRaw = input.narrative['conclusion']
  // ---- Structured slot path (P2-4): slot-wise check + text guard. ----
  if (conclusionRaw !== undefined && typeof conclusionRaw === 'object' && !Array.isArray(conclusionRaw)) {
    const slots = (conclusionRaw as { claims?: unknown }).claims
    if (!Array.isArray(slots)) {
      return { ok: false, code: 'conflicting_conclusion_number', reason: "structured conclusion must carry a 'claims' array" }
    }
    for (const raw of slots) {
      const slot = raw as Partial<ConclusionSlot>
      if (typeof slot?.text !== 'string') {
        return { ok: false, code: 'conflicting_conclusion_number', reason: 'a conclusion claim lacks a text string' }
      }
      if (!Array.isArray(slot.quantity_refs) || slot.quantity_refs.length === 0) {
        return { ok: false, code: 'conflicting_conclusion_number', reason: 'a conclusion claim must name ≥1 quantity_ref (P2-4 slot)' }
      }
      // P3-2: the representation declaration gates every non-verbatim path.
      // A malformed declaration is a refusal — never silently verbatim.
      const representation = parseRepresentation(slot.representation)
      if (!representation.ok) {
        return { ok: false, code: 'conflicting_conclusion_number', reason: `conclusion claim representation declaration is invalid: ${representation.reason}` }
      }
      const slotAllowed = new Set<string>()
      for (const ref of slot.quantity_refs) {
        const result = resultById.get(ref)
        if (result === undefined) {
          return { ok: false, code: 'conflicting_conclusion_number', reason: `claim quantity_ref '${ref}' is not a Result in the report table` }
        }
        slotAllowed.add(String(result.value))
      }
      for (const ref of slot.uncertainty_refs ?? []) {
        const result = resultById.get(ref)
        const uncertainty = result?.uncertainty ?? null
        if (result === undefined || uncertainty === null) {
          return { ok: false, code: 'conflicting_conclusion_number', reason: `claim uncertainty_ref '${ref}' has no recorded uncertainty` }
        }
        slotAllowed.add(String(uncertainty))
      }
      if (representation.value.kind === 'rounded') {
        // P3-2 rounded path: the declared decimal rendering of each bound
        // value joins the allowed set, and every rounded quantity in the
        // text must BE that rendering (single half-up rule, same function).
        for (const ref of slot.quantity_refs) {
          const result = resultById.get(ref)
          if (result === undefined) continue
          const rounded = formatRounded(result.value, representation.value.dp)
          if (rounded === null) {
            return { ok: false, code: 'conflicting_conclusion_number', reason: `rounded representation for '${ref}' cannot render ${result.value} at dp=${representation.value.dp} (v1: negative/scientific fail-closed)` }
          }
          slotAllowed.add(rounded)
        }
      }
      if (representation.value.kind === 'with_uncertainty') {
        // P3-2 with_uncertainty path: every declared uncertainty_ref must
        // resolve to a Result that actually records that uncertainty, and
        // the ± value joins the allowed set bound to this claim (攻击 3:
        // a ref whose ± does not match the table is a refusal).
        for (const ref of representation.value.uncertainty_refs) {
          const result = resultById.get(ref)
          const uncertainty = result?.uncertainty ?? null
          if (result === undefined || uncertainty === null) {
            return { ok: false, code: 'conflicting_conclusion_number', reason: `with_uncertainty declaration references '${ref}' which is not a Result with a recorded ± value (P3-2)` }
          }
          slotAllowed.add(String(uncertainty))
        }
      }
      // 逐字一致: every quantity_ref's value must appear in the claim text
      // (P3-2: on a declared rounded slot, the declared rendering stands in
      // for the raw value — the claim states 0.73, the table stays 0.731).
      for (const ref of slot.quantity_refs) {
        const result = resultById.get(ref)
        if (result === undefined) continue
        const valueText = representation.value.kind === 'rounded'
          ? formatRounded(result.value, representation.value.dp)
          : String(result.value)
        if (valueText === null) continue // already refused above
        if (!slot.text.includes(valueText)) {
          return { ok: false, code: 'conflicting_conclusion_number', reason: `conclusion claim for '${ref}' does not state the Result value ${valueText} verbatim` }
        }
      }
      if (representation.value.kind === 'with_uncertainty') {
        // The ± companion must also appear in the text — a with_uncertainty
        // declaration that never states the uncertainty buys nothing.
        for (const ref of representation.value.uncertainty_refs) {
          const uncertainty = resultById.get(ref)?.uncertainty ?? null
          if (uncertainty === null || !slot.text.includes(String(uncertainty))) {
            return { ok: false, code: 'conflicting_conclusion_number', reason: `with_uncertainty claim for '${ref}' does not state its recorded ± ${uncertainty} value` }
          }
        }
      }
      for (const token of numericLiterals(slot.text)) {
        if (!slotAllowed.has(token)) {
          return { ok: false, code: 'conflicting_conclusion_number', reason: `conclusion claim contains numeric literal '${token}' outside its declared quantities [${[...slotAllowed].join(', ')}] — key numbers only from the IR (P1-3/P2-4/P3-2)` }
        }
      }
    }
  } else if (conclusionRaw !== undefined) {
    // ---- Legacy prose path (v1): whole-conclusion literal guard. ----
    for (const token of numericLiterals(String(conclusionRaw))) {
      if (!allAllowed.has(token)) {
        return {
          ok: false,
          code: 'conflicting_conclusion_number',
          reason: `conclusion contains numeric literal(s) [${token}] that are not Result values/uncertainties [${[...allAllowed].join(', ')}] — key numbers may only be injected from the IR (P1-3)`,
        }
      }
    }
  }

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
  if (conclusionRaw !== undefined && typeof conclusionRaw === 'object' && !Array.isArray(conclusionRaw)) {
    const slots = (conclusionRaw as { claims: Array<{ text: string; comparison?: string }> }).claims
    for (const slot of slots) {
      lines.push(`- ${slot.text}${slot.comparison === undefined ? '' : `（${slot.comparison}）`}`)
    }
  } else {
    lines.push(String(conclusionRaw ?? ''))
  }
  const methods = input.narrative['methods']
  if (methods !== undefined) {
    lines.push('')
    lines.push('## 方法')
    lines.push('')
    lines.push(String(methods))
  }

  // ---- Figure slot (P2-3): real rendered bytes, embedded; provenance. ----
  if (input.figures.length > 0) {
    lines.push('')
    lines.push('## 图')
    lines.push('')
    for (const figure of input.figures) {
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(figure.svg, 'utf8').toString('base64')}`
      lines.push(`![${figure.caption ?? figure.figureId}](${dataUri})`)
      lines.push('')
    }
    lines.push('## 图数据溯源')
    lines.push('')
    lines.push('| 图 | data_hash | 源 Result | 渲染器 | 文件 sha256 |')
    lines.push('|---|---|---|---|---|')
    for (const figure of input.figures) {
      const sha = createHash('sha256').update(figure.svg, 'utf8').digest('hex')
      lines.push(`| \`${figure.figureId}\` | \`${figure.data_hash}\` | ${figure.resultRefs.map(r => `\`${r}\``).join(', ')} | ${figure.rendererVersion} | \`${sha}\` |`)
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('*template report v2 — machine numbers rendered from canonical IR Result records; conclusion numbers arrive via slots or guarded prose; figures are rendered by the fixed harness renderer.*')
  return { ok: true, text: lines.join('\n') }
}

/**
 * Render the report (v2): structured conclusion slots + figure embedding.
 * `narrative.conclusion` may be a string (v1 guarded prose) or
 * `{ claims: [...] }` (P2-4 slots).
 */
export function renderReportV2(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  readonly narrative: Record<string, unknown>
  readonly figures?: ReadonlyArray<FigureAssetRow>
}): RenderVerdict {
  return renderReport({ ...input, figures: input.figures ?? [] })
}

/** v1 entry (legacy prose conclusion; no figures) — behaviour unchanged. */
export function renderV1Report(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  readonly narrative: Record<string, unknown>
}): RenderVerdict {
  return renderReport({ ...input, figures: [] })
}
