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

/**
 * W11.5 round-6 (审计 T-3) — 显示用的数值归一。
 *
 * 真实产物里出现过 `2.200000000000001`、`0.09893381645356399` 这样的浮点尾差
 * 直接进正文与 PDF——读者看到的是二进制误差，不是数值。这里做**显示层**归一：
 * 四舍五入到 6 位小数并去掉尾零，只在明显变短时采用（整数与短小数原样保留）。
 * 结论槽的逐字检查同时接受原文与归一后两种写法——它们指的是同一个 Result。
 */
export function displayNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const raw = String(value)
  if (!raw.includes('.')) return raw
  const text = String(Number(value.toFixed(6)))
  return text.length < raw.length ? text : raw
}

export function numericLiterals(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(NUMBER_LITERAL)) {
    if (match.index === undefined) continue
    if (isLabelIndex(text, match.index, match[0])) continue
    out.push(match[0])
  }
  return out
}

/**
 * Label words whose trailing digit is an ORDINAL, not a quantity.
 *
 * W11.5 baseline-12 (首次真实产出实测): the twelfth real run's conclusion read
 * 「情形(1)平均检测次数为 {R-N1}，情形(2)平均检测次数为 {R-N2}」 — it had
 * learned to NAME every quantity, and was then refused for the literals `[1, 2]`,
 * which are the CASE LABELS. Two attempts were spent on that false positive.
 * The guard's contract is "no key NUMBER enters the paper except from the IR";
 * the index of a case is not one of the model's numbers, so it must not be read
 * as one. The set is closed and named: a digit directly after one of these words
 * (optionally through an opening parenthesis) is a label.
 */
const LABEL_WORDS = ['情形', '问题', '步骤', '阶段', '部分', '方案', '情况', '表', '图', '式', '例', '种', '类', '第']

/**
 * Whether the literal at `start` is an ordinal label rather than a quantity.
 *
 * Two unambiguous forms, both closed:
 *   - a BARE INTEGER wrapped in parentheses — `情形(1)`, `(2)`; a parenthesized
 *     value carries a decimal point (`(0.95)`) and stays a number;
 *   - a digit run directly after a {@link LABEL_WORDS} word — `问题1`, `第2种`.
 */
function isLabelIndex(text: string, start: number, literal: string): boolean {
  if (!/^\d+$/.test(literal)) return false
  const before = text.slice(0, start)
  if (/[（(]\s*$/u.test(before)) {
    const closer = text[start + literal.length]
    if (closer === ')' || closer === '）') return true
  }
  const labelPattern = new RegExp(`(?:${LABEL_WORDS.join('|')})\\s*[（(]?\\s*$`, 'u')
  return labelPattern.test(before)
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
 * W11.5 baseline-8 — inject a Result's value into the conclusion text.
 *
 * WHY THIS EXISTS. Until now the conclusion's numbers had to be written by the
 * model VERBATIM, which means the model had to predict the output of code it
 * had not run yet. Two consecutive real runs died on exactly that: baseline-7's
 * narrative said 29/6/76/12 while its own code computed 2/2/15/1, and
 * baseline-8's refused because the claim did not state the value `-25`. The
 * verbatim rule is right (关键数字全集 = Result 数值) but it was being satisfied
 * by transcription — the very copy the producer already refuses to trust when
 * it copies `asserted_value` from the Result instead of from prose.
 *
 * So a quantity may now be NAMED instead of copied: the text carries
 * `{<result_id>}` and the harness substitutes the run's value. The digit then
 * comes from the IR by construction, not from the model's arithmetic. Literal
 * numbers keep the old rule unchanged (they must be a bound value), and a
 * placeholder that names nothing resolvable is a REFUSAL — never a silent
 * `{R-XY}` printed into a paper.
 *
 * @param text - the claim text as the model wrote it.
 * @param resolve - the rendering for one bound id, or null when it is not bound.
 * @returns the expanded text plus every unresolvable placeholder it found.
 */
export function expandQuantityPlaceholders(
  text: string,
  resolve: (id: string) => string | null,
): { readonly text: string; readonly unknown: ReadonlyArray<string> } {
  const unknown: string[] = []
  const expanded = String(text ?? '').replace(/\{([^{}\s]+)\}/g, (whole, id: string) => {
    const value = resolve(id)
    if (value === null) {
      unknown.push(id)
      return whole
    }
    return value
  })
  return { text: expanded, unknown }
}

/** Slot key for the legacy prose conclusion (a string, not a claims array). */
const LEGACY_CONCLUSION_SLOT = -1

/**
 * R5①: the prose chapters a container may supply, with the section title each
 * one lands in.
 *
 * Exported so the production chain can refuse a report whose chapter is still
 * an unfilled placeholder BEFORE it becomes the deliverable: a paper the docx
 * pre-export gate will reject must not be handed out as if it were finished
 * (W11.5 baseline-10 — the first real A-produce-chain delivery carried an empty
 * 参考文献 chapter and the precheck refused it one step later).
 */
export const PROSE_CHAPTERS: ReadonlyArray<{ readonly id: string; readonly title: string }> = [
  { id: 'restatement', title: '问题重述' },
  { id: 'analysis', title: '问题分析' },
  { id: 'evaluation', title: '模型评价与推广' },
  { id: 'references', title: '参考文献' },
  { id: 'code', title: '代码附录' },
]

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
  /** W11.5 baseline-23: the declared equations/models, rendered into 模型建立与求解. */
  readonly equations?: ReadonlyArray<{ id: string; columns: ReadonlyArray<string> }>
  readonly models?: ReadonlyArray<{ id: string; columns: ReadonlyArray<string> }>
}

/** @internal shared assembly; `conclusionKind` routes the guards. */
function renderReport(input: {
  readonly title: string
  readonly results: ReadonlyArray<ResultRow>
  readonly narrative: Record<string, unknown>
  readonly figures: ReadonlyArray<FigureAssetRow>
  /** W11.5 baseline-14: numbers the harness-registered problem statement
   *  contains — input data, added to every allowed set. */
  readonly givenLiterals?: ReadonlyArray<string>
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
  // W11.5 baseline-14 (首次真实产出实测): a number the PROBLEM states is not a
  // claim of the model's — it is harness-registered input, and a conclusion that
  // restates it ("at the stated confidence level" reads naturally as its digit)
  // was refused three separate real runs (baseline-11/12/14, every time on the
  // problem's own confidence level or nominal rate). The literal set therefore
  // includes the numbers of the registered problem statement: still IR-traceable,
  // and it opens no hole — the per-slot verbatim check (each declared quantity's
  // value MUST be stated) is what stops a fabricated result, and a statement
  // number cannot satisfy it.
  for (const literal of input.givenLiterals ?? []) allAllowed.add(literal)

  const conclusionRaw = input.narrative['conclusion']
  // W11.5 baseline-8: the slot text AFTER placeholder injection. The checks and
  // the rendered text must be the same string — expanding only at render time
  // would let an unchecked value reach the paper.
  const expandedSlots = new Map<number, string>()
  // ---- Structured slot path (P2-4): slot-wise check + text guard. ----
  if (conclusionRaw !== undefined && typeof conclusionRaw === 'object' && !Array.isArray(conclusionRaw)) {
    const slots = (conclusionRaw as { claims?: unknown }).claims
    if (!Array.isArray(slots)) {
      return { ok: false, code: 'conflicting_conclusion_number', reason: "structured conclusion must carry a 'claims' array" }
    }
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const raw = slots[slotIndex]
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
      for (const literal of input.givenLiterals ?? []) slotAllowed.add(literal)
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
      // W11.5 baseline-8: `{<result_id>}` names a quantity instead of copying
      // its value — the harness substitutes the run's number, so the claim
      // cannot be wrong about a value the model never saw. Everything below
      // checks the EXPANDED text: an injection is a rendering of the bound
      // Result, not a way around the guard.
      const injected = expandQuantityPlaceholders(slot.text, (id) => {
        const bound = slot.quantity_refs?.includes(id) === true
          || (representation.value.kind === 'with_uncertainty'
            && representation.value.uncertainty_refs.includes(id))
        if (!bound) return null
        const result = resultById.get(id)
        if (result === undefined) return null
        if (representation.value.kind === 'with_uncertainty' && representation.value.uncertainty_refs.includes(id)) {
          return result.uncertainty === null ? null : String(result.uncertainty)
        }
        return representation.value.kind === 'rounded'
          ? formatRounded(result.value, representation.value.dp)
          : String(result.value)
      })
      if (injected.unknown.length > 0) {
        return {
          ok: false,
          code: 'conflicting_conclusion_number',
          reason: `conclusion claim names ${injected.unknown.map(id => `'{${id}}'`).join(', ')} but a placeholder may only name one of this claim's declared quantity_refs [${(slot.quantity_refs ?? []).join(', ')}] — an unresolvable name would print the braces into the paper`,
        }
      }
      const claimText = injected.text
      expandedSlots.set(slotIndex, claimText)
      // W11.5 baseline-11 (首次真实产出实测): report EVERY offender in one
      // refusal, not the first one. The eleventh real run's conclusion restated
      // two problem-given constants; the refusal named only the first ('95'),
      // the model fixed that one and the next attempt died on the second ('10'),
      // spending a whole guided retry per digit. The list costs nothing and
      // turns two corrections into one.
      const unstated: string[] = []
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
        // T-3: the table prints displayNumber(value), so a conclusion stating the
        // normalized form is stating the SAME Result — accept both spellings.
        if (!claimText.includes(valueText) && !claimText.includes(displayNumber(result.value))) unstated.push(`'${ref}' (value ${valueText})`)
      }
      if (unstated.length > 0) {
        return { ok: false, code: 'conflicting_conclusion_number', reason: `conclusion claim does not state the Result value verbatim for ${unstated.join(', ')} — write the value itself, or name it as '{<result_id>}' and the harness will inject it` }
      }
      if (representation.value.kind === 'with_uncertainty') {
        // The ± companion must also appear in the text — a with_uncertainty
        // declaration that never states the uncertainty buys nothing.
        for (const ref of representation.value.uncertainty_refs) {
          const uncertainty = resultById.get(ref)?.uncertainty ?? null
          if (uncertainty === null || !claimText.includes(String(uncertainty))) {
            return { ok: false, code: 'conflicting_conclusion_number', reason: `with_uncertainty claim for '${ref}' does not state its recorded ± ${uncertainty} value` }
          }
        }
      }
      const stray = [...new Set(numericLiterals(claimText).filter(token => !slotAllowed.has(token)))]
      if (stray.length > 0) {
        return { ok: false, code: 'conflicting_conclusion_number', reason: `conclusion claim contains numeric literal(s) [${stray.join(', ')}] outside its declared quantities [${[...slotAllowed].join(', ')}] — key numbers only from the IR (P1-3/P2-4/P3-2); a constant the problem GAVE you is not a Result, so write it in words or have your code emit it as a Result` }
      }
    }
  } else if (conclusionRaw !== undefined) {
    // ---- Legacy prose path (v1): whole-conclusion literal guard. ----
    // W11.5 baseline-8: a `{<result_id>}` name is resolved against the report
    // table here too, so a prose conclusion can state a quantity it never
    // computed.
    const injected = expandQuantityPlaceholders(String(conclusionRaw), (id) => {
      const result = resultById.get(id)
      return result === undefined ? null : String(result.value)
    })
    if (injected.unknown.length > 0) {
      return {
        ok: false,
        code: 'conflicting_conclusion_number',
        reason: `conclusion names ${injected.unknown.map(id => `'{${id}}'`).join(', ')} but no Result in the report table has that id [${[...resultById.keys()].join(', ')}] — an unresolvable name would print the braces into the paper`,
      }
    }
    expandedSlots.set(LEGACY_CONCLUSION_SLOT, injected.text)
    for (const token of numericLiterals(injected.text)) {
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
    resultsLines.push(`| ${result.name} | ${displayNumber(result.value)} | ${result.unit} | ${uncertainty} | \`${result.result_id}\` |`)
  }
  resultsLines.push('')
  resultsLines.push('### 结论')
  resultsLines.push('')
  const claimTexts: string[] = []
  if (conclusionRaw !== undefined && typeof conclusionRaw === 'object' && !Array.isArray(conclusionRaw)) {
    const slots = (conclusionRaw as { claims: Array<{ text: string; comparison?: string }> }).claims
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i] ?? { text: '' }
      // The EXPANDED text (W11.5 baseline-8): what the checks judged is what
      // the paper prints.
      const text = expandedSlots.get(i) ?? slot.text
      claimTexts.push(text)
      resultsLines.push(`- ${text}${slot.comparison === undefined ? '' : `（${slot.comparison}）`}`)
    }
  } else {
    const raw = expandedSlots.get(LEGACY_CONCLUSION_SLOT) ?? String(conclusionRaw ?? '')
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
    ...(input.givenLiterals === undefined ? {} : { givenLiterals: input.givenLiterals }),
  })
  // W11.5 round-6 (审计 T-1): 守卫拒绝时**不得把原始报错串写进论文**——真实产物里
  // 出现过整段 `_摘要自动生成被 D4 守卫拒绝（原因：claim text carries a number…）_`，
  // 评委打开论文就看到引擎内部报错。改为中性、无数字的兜底摘要，把读者引到结果表；
  // 拒绝这件事本身是机器关注点，留在审计与交付标注里，不进正文。
  const abstractLines = abstractVerdict.ok
    ? abstractVerdict.abstract
    : [
      `针对《${input.title}》，本文建立数学模型并给出结论。`,
      '',
      '正文依次给出问题重述、问题分析、模型建立与求解、结果对比与校核；全部关键数字由运行结果注入「结果对比与校核」一节的结果表，并逐条给出结论与校核声明。',
    ].join(String.fromCharCode(10))

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
      // Defensive (baseline-25/26 crashed here with `Cannot read properties of
      // null`): a column that arrives null renders an empty cell instead of
      // taking the whole production chain down after the figures are minted.
      dataLines.push(`| ${f.columns.map(c => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} | 执行输出 |`)
    }
  } else {
    dataLines.push('_(本次运行未声明输出数据文件)_')
  }

  // R5①: the prose chapters the container may supply (each rendered into its
  // own section; absent → the skeleton's visible placeholder).
  const proseSlots: Record<string, string> = {}
  for (const chapter of PROSE_CHAPTERS) {
    const value = input.narrative[chapter.id]
    if (typeof value === 'string' && value.trim() !== '') proseSlots[chapter.id] = value
  }

  const text = renderPaperSkeleton({
    title: input.title,
    ...(input.skeletonRows?.symbols === undefined ? {} : { symbols: input.skeletonRows.symbols }),
    ...(input.skeletonRows?.assumptions === undefined ? {} : { assumptions: input.skeletonRows.assumptions }),
    ...(input.skeletonRows?.requirements === undefined ? {} : { requirements: input.skeletonRows.requirements }),
    // W11.5 baseline-23: the equations/models rows reach the skeleton too —
    // they are what fills 模型建立与求解 from the IR.
    ...(input.skeletonRows?.equations === undefined ? {} : { equations: input.skeletonRows.equations }),
    ...(input.skeletonRows?.models === undefined ? {} : { models: input.skeletonRows.models }),
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
  /** W11.5 baseline-14: numbers the harness-registered problem statement
   *  contains. They are input data, not claims — see the allowed-set comment. */
  readonly givenLiterals?: ReadonlyArray<string>
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
    ...(input.givenLiterals === undefined ? {} : { givenLiterals: input.givenLiterals }),
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
