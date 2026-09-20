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

import { renderPaperSkeleton } from './paper-skeleton.ts'
import { synthesizeAbstract } from './synthesize-abstract.ts'

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

/**
 * W8.5 (B1): optional skeleton rows extracted from the IR by the caller
 * (executor). When present, the 符号说明/模型假设/问题重述 sections fill
 * their tables from canonical data; absent, the skeleton notes they are
 * IR-generated. This is the single delivery-rendering path: renderReport
 * IS the skeleton renderer now.
 */
export interface SkeletonRows {
  readonly symbols?: ReadonlyArray<{ id: string; columns: ReadonlyArray<string> }>
  readonly assumptions?: ReadonlyArray<{ id: string; columns: ReadonlyArray<string> }>
  readonly requirements?: ReadonlyArray<{ id: string; columns: ReadonlyArray<string> }>
}

/** @internal shared assembly; `conclusionKind` routes the guards. */
function renderReport(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  readonly narrative: Record<string, unknown>
  readonly figures: ReadonlyArray<FigureAssetRow>
  readonly skeletonRows?: SkeletonRows
  /** R5: executed output files for the 数据附录 auto table (basename rows). */
  readonly dataFiles?: ReadonlyArray<{ id: string; columns: ReadonlyArray<string> }>
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

  // ---- W8.5 (B1) + R5: the delivery text is the SKELETON (12 sections).
  // 模型建立与求解 keeps 方法/图; 结果对比与校核 holds the IR result table +
  // 结论; 摘要/AI 声明/数据附录 are machine-generated (R5④/R5①/D4).
  const resultsLines: string[] = []
  resultsLines.push('### 结果表（由规范 IR 注入；结论区关键数字必须与此表一致）')
  resultsLines.push('')
  resultsLines.push('| 量名 | 数值 | 单位 | 不确定度 | 来源 |')
  resultsLines.push('|---|---|---|---|---|')
  for (const result of input.results) {
    const uncertainty = result.uncertainty === null ? '' : `±${result.uncertainty}`
    resultsLines.push(`| ${result.name} | ${result.value} | ${result.unit} | ${uncertainty} | \`${result.result_id}\` |`)
  }
  resultsLines.push('')
  resultsLines.push('### 结论')
  resultsLines.push('')
  const claimTexts: string[] = []
  if (conclusionRaw !== undefined && typeof conclusionRaw === 'object' && !Array.isArray(conclusionRaw)) {
    const slots = (conclusionRaw as { claims: Array<{ text: string; comparison?: string }> }).claims
    for (const slot of slots) {
      claimTexts.push(slot.text)
      resultsLines.push(`- ${slot.text}${slot.comparison === undefined ? '' : `（${slot.comparison}）`}`)
    }
  } else {
    const raw = String(conclusionRaw ?? '')
    if (raw.trim() !== '') claimTexts.push(raw)
    resultsLines.push(raw)
  }
  resultsLines.push('')
  resultsLines.push('_校核声明：本表数字由规范 IR Result 记录渲染，结论槽数字经逐字核对；正文数字均回读结果 JSON（D4）。_')

  const modelLines: string[] = []
  const methods = input.narrative['methods']
  if (methods !== undefined) {
    modelLines.push('### 方法')
    modelLines.push('')
    modelLines.push(String(methods))
  }
  // ---- Figure slot (P2-3 / W9-E1): figures are INDEPENDENT image files
  // referenced by 题注, never base64 data-URIs (N21 — O-H-02: data-URIs die
  // in Word/PDF conversion). The caller writes each figure.svg to
  // `figures/<figureId>.svg` next to the report; the caption line 图 X：…
  // stands ALONE on its line (the format reference's 铁律: 题注独占行).
  // The data_hash 溯源表 moved OUT of the deliverable into the audit trail
  // (N24/O-H-03 — the audit view is not part of the paper). ----
  const validationLines: string[] = []
  if (input.figures.length > 0) {
    modelLines.push('')
    modelLines.push('### 图')
    modelLines.push('')
    input.figures.forEach((figure, fi) => {
      const fileName = `figures/${figure.figureId}.svg`
      const caption = figure.caption ?? figure.figureId
      modelLines.push(`![${caption}](${fileName})`)
      modelLines.push('')
      modelLines.push(`图 ${fi + 1}：${caption}`)
      modelLines.push('')
    })
  }

  // ---- R5④: 摘要由结果生成（数字全部回读 Result，D4 守卫在本模块）。 ----
  const abstractVerdict = synthesizeAbstract({
    title: input.title,
    results: input.results.map(r => ({ result_id: r.result_id, value: r.value, uncertainty: r.uncertainty })),
    claims: claimTexts.map(text => ({ text })),
    methodsNote: typeof methods === 'string' ? methods : undefined,
  })
  const abstractLines = abstractVerdict.ok
    ? abstractVerdict.abstract
    : `_摘要自动生成被 D4 守卫拒绝（原因：${abstractVerdict.reason}）。_`

  // ---- AI 声明（机器生成，固定文本，无数字） ----
  const aiLines = [
    '本论文由 DeepSeek-For-Paper-Harness 论文生产链辅助生成。',
    '正文数字由规范 IR Result 记录渲染并经数字回读核对（D4）；结论槽数字经逐字核对；',
    '图表由固定 harness 渲染器渲染；建模思路与文字内容由模型生成，实质正确性不在 harness 可判定范围内。',
  ].join(' ')

  // ---- 数据附录（执行输出文件清单，机器表） ----
  const dataLines: string[] = []
  // deterministic order: the appendix must not depend on capture order
  const dataFiles = [...(input.dataFiles ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  if (dataFiles.length > 0) {
    dataLines.push('| 文件 | 说明 |')
    dataLines.push('|---|---|')
    for (const f of dataFiles) {
      // 只列文件名与说明：run 作用域的 locator（含 run id）不进论文——
      // 既是泄漏面，也会破坏跨运行的字节确定性（T1/T2 等价性实测抓到）。
      dataLines.push(`| ${f.columns.map(c => c.replace(/\|/g, '\\|')).join(' | ')} | 执行输出 |`)
    }
  } else {
    dataLines.push('_(本次运行未声明输出数据文件)_')
  }

  // R5①: the prose chapters the container may supply (each rendered into its
  // own section; absent → the skeleton's visible placeholder).
  const proseSlots: Record<string, string> = {}
  for (const id of ['restatement', 'analysis', 'evaluation', 'references', 'code'] as const) {
    const value = input.narrative[id]
    if (typeof value === 'string' && value.trim() !== '') proseSlots[id] = value
  }

  const text = renderPaperSkeleton({
    title: input.title,
    ...(input.skeletonRows?.symbols === undefined ? {} : { symbols: input.skeletonRows.symbols }),
    ...(input.skeletonRows?.assumptions === undefined ? {} : { assumptions: input.skeletonRows.assumptions }),
    ...(input.skeletonRows?.requirements === undefined ? {} : { requirements: input.skeletonRows.requirements }),
    slots: {
      abstract: abstractLines,
      model: modelLines.join('\n'),
      results: resultsLines.join('\n'),
      ai_disclosure: aiLines,
      data_appendix: dataLines.join('\n'),
      // R5①: 散文章节由 narrative 提供（缺则渲染可见占位——预检的
      // no_placeholders 类会把它当致命拦下，绝不静默交付空槽）。
      ...proseSlots,
      ...(validationLines.length > 0 ? { validation: validationLines.join('\n') } : {}),
    },
  })
  const lines: string[] = [text, '', '---', '*机器数字由规范 IR Result 记录渲染；摘要与结论数字经自动回读核对；图表由固定 harness 渲染器渲染（骨架 v3，12 章）。*']
  return { ok: true, text: lines.join('\n') }
}

/**
 * Render the report (v2): structured conclusion slots + figure embedding.
 * `narrative.conclusion` may be a string (v1 guarded prose) or
 * `{ claims: [...] }` (P2-4 slots). R5 (12 章成型): the machine sections
 * (摘要/结果对比与校核/AI 声明/数据附录) are auto-filled by the renderer;
 * the 模型建立与求解 slot keeps 方法/结论/图.
 */
export function renderReportV2(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  readonly narrative: Record<string, unknown>
  readonly figures?: ReadonlyArray<FigureAssetRow>
  /** W8.5: IR rows for the skeleton's machine tables (optional). */
  readonly skeletonRows?: SkeletonRows
  /** R5: executed output files for the 数据附录 auto table (basename rows). */
  readonly dataFiles?: ReadonlyArray<{ id: string; columns: ReadonlyArray<string> }>
}): RenderVerdict {
  return renderReport({
    ...input,
    figures: input.figures ?? [],
    ...(input.skeletonRows === undefined ? {} : { skeletonRows: input.skeletonRows }),
    ...(input.dataFiles === undefined ? {} : { dataFiles: input.dataFiles }),
  })
}

/** v1 entry (legacy prose conclusion; no figures) — behaviour unchanged. */
export function renderV1Report(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  readonly narrative: Record<string, unknown>
}): RenderVerdict {
  return renderReport({ ...input, figures: [] })
}
