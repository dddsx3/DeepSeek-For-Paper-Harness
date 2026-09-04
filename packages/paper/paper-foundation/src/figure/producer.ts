/**
 * P2-3 — figure production (declaration-driven; numbers never authored).
 *
 * The model declares STRUCTURE for a figure inside the container's
 * `interpretations.figures`: `{ figure_id, chart_type, data_refs,
 * caption?, x_label?, y_label? }`. The producer derives the canonical
 * render input from the store (referenced Results carry the numbers),
 * computes data_hash = sha256(canonicalJson(input)), and mints the
 * FigureSpec — the model can never write a data_hash of its own (P2 禁2).
 * Captions/axis labels are guarded like the report conclusion: a numeric
 * literal that is not one of the referenced Result values is a refusal,
 * never a silent edit (P2-3 attack 1).
 *
 * All-or-nothing: declarations are validated and every record schema-
 * checked before the first store write.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure
 */

import { IR_SCHEMAS } from '../ir/schema.ts'
import { FIGURE_STYLE_PROFILE, figureRenderInput, renderFigureSvg } from './renderer.ts'
import { ModelingIr } from '../ir/store.ts'

export interface FigureDeclaration {
  readonly figure_id: string
  readonly chart_type?: 'line' | 'scatter' | 'bar' | 'table'
  readonly data_refs: ReadonlyArray<string>
  readonly claim_refs?: ReadonlyArray<string>
  readonly caption?: string
  readonly x_label?: string
  readonly y_label?: string
}

export type FigureProductionVerdict =
  | { ok: true; figureIds: ReadonlyArray<string>; assets: ReadonlyArray<{ figureId: string; svg: string; data_hash: string }> }
  | { ok: false; code: 'figure_declaration_invalid' | 'figure_data_invalid' | 'record_schema_violation' | 'store_refused'; reason: string }

const NUMBER_LITERAL = /(?<![A-Za-z^])(?<![A-Za-z^]-)[-+]?(?:\d+\.?\d*|\.\d+)(?![A-Za-z])/gu

/**
 * P3-4 (E7 sign-off A): the uniqueness key of one figure asset —
 * (sorted data_refs, chart_type, style_profile). A second declaration with
 * an identical key is a duplicate asset (the OVER-PROMISE family in figure
 * form: same data, same chart, same style = zero new information), refused
 * at production time with zero partial writes. Different chart_type over
 * the same refs (line + bar) stays legal — that is a new view, not a copy.
 */
function figureUniquenessKey(data_refs: ReadonlyArray<string>, chart_type: string | undefined): string {
  return `${[...data_refs].sort().join('|')}::${chart_type ?? 'line'}::${FIGURE_STYLE_PROFILE}`
}

/** Guard caption/axis labels: numeric literals must be referenced values. */
function guardLabelNumbers(decl: FigureDeclaration, allowed: ReadonlyArray<string>): string | null {
  const texts = [decl.caption ?? '', decl.x_label ?? '', decl.y_label ?? '']
  const allowedSet = new Set(allowed)
  const found = new Set<string>()
  for (const text of texts) {
    for (const match of text.matchAll(NUMBER_LITERAL)) found.add(match[0])
  }
  for (const token of found) {
    if (!allowedSet.has(token)) return token
  }
  return null
}

/** Mint FigureSpec records + their rendered SVG bytes from declarations. */
export function produceFigures(
  ir: ModelingIr,
  declarations: ReadonlyArray<unknown>,
): FigureProductionVerdict {
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { ok: false, code: 'figure_data_invalid', reason: 'figure production requires a canonical store' }
  }
  // Structural validation + dedupe.
  const seen = new Set<string>()
  const seenKeys = new Set<string>()
  const records: Array<Record<string, unknown>> = []
  const assets: Array<{ figureId: string; svg: string; data_hash: string }> = []
  for (const raw of declarations) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, code: 'figure_declaration_invalid', reason: 'a figure declaration is not an object' }
    }
    const decl = raw as FigureDeclaration
    if (typeof decl.figure_id !== 'string' || decl.figure_id.length === 0) {
      return { ok: false, code: 'figure_declaration_invalid', reason: 'figure declaration lacks a figure_id' }
    }
    if (seen.has(decl.figure_id)) {
      return { ok: false, code: 'figure_declaration_invalid', reason: `figure_id '${decl.figure_id}' declared more than once` }
    }
    seen.add(decl.figure_id)
    if (!Array.isArray(decl.data_refs) || decl.data_refs.length === 0 || decl.data_refs.some(r => typeof r !== 'string')) {
      return { ok: false, code: 'figure_declaration_invalid', reason: `figure '${decl.figure_id}' needs a non-empty data_refs array of Result ids` }
    }
    // P3-4 uniqueness key: the same (sorted refs, chart_type, style) as an
    // already-declared figure is a duplicate asset — refused before any
    // record is minted (零部分写入, 禁5).
    const uniqKey = figureUniquenessKey(decl.data_refs, decl.chart_type)
    if (seenKeys.has(uniqKey)) {
      return { ok: false, code: 'figure_declaration_invalid', reason: `figure '${decl.figure_id}' duplicates an earlier declaration's uniqueness key (sorted data_refs + chart_type + style_profile) — same data, same chart, same style carries no new information (P3-4/E7, 禁5)` }
    }
    seenKeys.add(uniqKey)
    const derived = figureRenderInput(store, {
      data_refs: decl.data_refs,
      ...(decl.chart_type === undefined ? {} : { chart_type: decl.chart_type }),
      ...(decl.caption === undefined ? {} : { caption: decl.caption }),
      ...(decl.x_label === undefined ? {} : { x_label: decl.x_label }),
      ...(decl.y_label === undefined ? {} : { y_label: decl.y_label }),
    })
    if (!derived.ok) {
      return { ok: false, code: 'figure_data_invalid', reason: `figure '${decl.figure_id}': ${derived.reason}` }
    }
    // Numeric guard on captions/labels (P2-3 attack 1).
    const allowedValues = derived.input.series.map(s => String(s.value))
    const stray = guardLabelNumbers(decl, allowedValues)
    if (stray !== null) {
      return { ok: false, code: 'figure_declaration_invalid', reason: `figure '${decl.figure_id}' caption/axis label contains numeric literal '${stray}' that is not a referenced Result value [${allowedValues.join(', ')}]` }
    }
    const record: Record<string, unknown> = {
      figure_id: decl.figure_id,
      data_refs: [...decl.data_refs],
      claim_refs: [...(decl.claim_refs ?? [])],
      ...(decl.chart_type === undefined ? {} : { chart_type: decl.chart_type }),
      ...(decl.caption === undefined ? {} : { caption: decl.caption }),
      ...(decl.x_label === undefined ? {} : { x_label: decl.x_label }),
      ...(decl.y_label === undefined ? {} : { y_label: decl.y_label }),
      data_hash: derived.data_hash,
    }
    const check = IR_SCHEMAS.FigureSpec.safeParse(record)
    if (!check.success) {
      const issue = check.error.issues[0]
      return { ok: false, code: 'record_schema_violation', reason: `figure '${decl.figure_id}' violates FigureSpec schema — ${issue?.message ?? 'invalid'}` }
    }
    records.push(record)
    assets.push({ figureId: decl.figure_id, svg: renderFigureSvg(derived.input), data_hash: derived.data_hash })
  }

  const figureIds: string[] = []
  for (const record of records) {
    const admitted = ir.put('FigureSpec', record)
    if (!admitted.accepted) {
      const failure = admitted.failures[0]
      return {
        ok: false,
        code: 'store_refused',
        reason: failure !== undefined
          ? `FigureSpec '${String(record['figure_id'])}' refused: ${failure.kind}: ${failure.reason}`
          : 'store refused the FigureSpec',
      }
    }
    figureIds.push(String(record['figure_id']))
  }
  return { ok: true, figureIds, assets }
}
