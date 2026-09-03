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

/** A structured conclusion claim (P2-4 slot). */
export interface ConclusionSlot {
  readonly text: string
  /** Result ids whose value must appear verbatim in `text`. */
  readonly quantity_refs: ReadonlyArray<string>
  readonly uncertainty_refs?: ReadonlyArray<string>
  readonly comparison?: string
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
      // 逐字一致: every quantity_ref's value must appear in the claim text.
      for (const ref of slot.quantity_refs) {
        const valueText = String(resultById.get(ref)!.value)
        if (!slot.text.includes(valueText)) {
          return { ok: false, code: 'conflicting_conclusion_number', reason: `conclusion claim for '${ref}' does not state the Result value ${valueText} verbatim` }
        }
      }
      for (const token of numericLiterals(slot.text)) {
        if (!slotAllowed.has(token)) {
          return { ok: false, code: 'conflicting_conclusion_number', reason: `conclusion claim contains numeric literal '${token}' outside its bound quantities [${[...slotAllowed].join(', ')}] — key numbers only from the IR (P1-3/P2-4)` }
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
