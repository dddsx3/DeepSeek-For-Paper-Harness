/**
 * P1-3 — Result/Claim production (interpretation of real executed outputs).
 *
 * After P1-1 wrote the model's declared contract kinds and P1-2 REALLY ran
 * the model's code (captured ExecutionRecord), the store holds runs but no
 * Result/Claim records. The model cannot be allowed to invent those: the
 * whole point of the numeric pipeline is that the digits only ever flow
 * real-output → Result → Claim (INV-2-A/B, "关键数字全集 = Result 数值",
 * decision-log D4).
 *
 * This component closes the gap with an *interpretation* contract: the
 * model declares STRUCTURE — which executed output file + json path carries
 * each quantity, what unit the quantity has, and which claims the paper
 * makes over which results — and the producer reads the VALUES from the
 * real executed bytes, then mints canonical Result + Claim records:
 *
 *   - Result.value / unit: read from the executed output bytes + the model's
 *     unit interpretation. A missing file, a broken JSON, an unresolvable
 *     path or a non-number is a refusal (the run produced no such result).
 *   - Claim (NUMERIC): the asserted value/unit are COPIED from the bound
 *     Result record, never from prose — the model cannot mis-transcribe a
 *     number it just saw. Its text/role/criticality are the paper's
 *     interpretation.
 *
 * All-or-nothing (DISCIPLINE D12): every interpretation is structurally
 * validated, every output is parsed and every minted record schema-checked
 * BEFORE the first store write.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce
 */

import { z as zod } from 'zod'
import { ModelingIr } from '../ir/store.ts'
import { IR_SCHEMAS } from '../ir/schema.ts'
import { readIrObjectId } from '../ir/index.ts'
import { produceFigures } from '../figure/producer.ts'

/** One executed output file's bytes (P1-2's capture outcome). */
export interface OutputBytes {
  readonly locator: string
  readonly bytes: string
}

/** The interpretation block the model attaches to its container (P1-3). */
export const interpretationSchema = zod
  .object({
    results: zod
      .array(
        zod
          .object({
            result_id: zod.string().min(1),
            name: zod.string().min(1),
            source: zod.object({
              locator: zod.string().min(1),
              /** Dot path into the JSON output (e.g. 'mean_thickness'). */
              jsonPath: zod.string().min(1),
            }),
            unit: zod.string().min(1),
            uncertainty: zod.number().nullable().optional(),
          })
          .strict(),
      )
      .optional(),
    claims: zod
      .array(
        zod
          .object({
            claim_id: zod.string().min(1),
            text: zod.string().min(1),
            claim_type: zod.enum(['NUMERIC', 'MODEL', 'QUALITATIVE']),
            criticality: zod.enum(['CRITICAL', 'NON_CRITICAL']),
            result_refs: zod.array(zod.string()).optional(),
            model_refs: zod.array(zod.string()).optional(),
            evidence_refs: zod.array(zod.string()).optional(),
            criticality_rationale: zod.string().optional(),
          })
          .strict(),
      )
      .optional(),
    // P2-3 (slice B): structural figure declarations. The producer derives
    // data_hash from the store and renders the bytes — numbers never come
    // from the model (see src/figure/producer.ts).
    figures: zod
      .array(
        zod
          .object({
            figure_id: zod.string().min(1),
            chart_type: zod.enum(['line', 'scatter', 'bar']),
            data_refs: zod.array(zod.string()).min(1),
            claim_refs: zod.array(zod.string()).optional(),
            caption: zod.string().max(4096).optional(),
            x_label: zod.string().max(256).optional(),
            y_label: zod.string().max(256).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()

export type InterpretationFailureCode =
  | 'interpretation_invalid'     // structure violates interpretationSchema
  | 'run_missing'                // cited run is not a RunArtifact in the store
  | 'result_source_missing'      // declared locator not among executed outputs
  | 'result_source_invalid'      // output unparsable / path missing / not a number
  | 'claim_binding_unknown'      // NUMERIC claim's bound Result does not exist
  | 'figure_declaration_invalid' // figure structure/guard refusal (P2-3)
  | 'figure_data_invalid'        // figure data/dangling/type refusal (P2-3)
  | 'record_schema_violation'    // a minted Result/Claim fails its closed IR schema
  | 'store_refused'              // store admission (incl. 1.5R closure) refused

/** One minted figure's render assets (P2-3 slice B). */
export interface MintedFigure {
  readonly figureId: string
  readonly data_hash: string
  readonly svg: string
}

export type InterpretationVerdict =
  | {
      ok: true
      resultIds: ReadonlyArray<string>
      claimIds: ReadonlyArray<string>
      figures: ReadonlyArray<MintedFigure>
    }
  | { ok: false; code: InterpretationFailureCode; reason: string }

interface ParsedInterpretation {
  results: Array<{
    result_id: string
    name: string
    source: { locator: string; jsonPath: string }
    unit: string
    uncertainty: number | null
  }>
  claims: Array<{
    claim_id: string
    text: string
    claim_type: 'NUMERIC' | 'MODEL' | 'QUALITATIVE'
    criticality: 'CRITICAL' | 'NON_CRITICAL'
    result_refs: ReadonlyArray<string>
    model_refs: ReadonlyArray<string>
    evidence_refs: ReadonlyArray<string>
    criticality_rationale?: string
  }>
}

/** Resolve a dotted path ('a.b.c') inside a parsed JSON object. */
export function resolveJsonPath(root: unknown, path: string): unknown {
  let cursor = root
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/**
 * Mint canonical Result + Claim records from a P1-3 interpretation over the
 * REAL executed output bytes. Values are read from the bytes, never from the
 * model's prose. All-or-nothing: full dry pass before the first write.
 */
export function produceInterpretation(input: {
  readonly ir: ModelingIr
  /** the run the results belong to (P1-2's RunArtifact id). */
  readonly runId: string
  /** the container's raw `interpretations` block. */
  readonly interpretations: unknown
  /** executed output bytes (locator -> content) from the capture outcome. */
  readonly outputs: ReadonlyArray<OutputBytes>
}): InterpretationVerdict {
  const { ir, runId, interpretations, outputs } = input
  const parsed = interpretationSchema.safeParse(interpretations)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue !== undefined
      ? issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      : ''
    return {
      ok: false,
      code: 'interpretation_invalid',
      reason: `interpretations block violates interpretationSchema — ${at}${issue?.message ?? 'invalid'}`,
    }
  }
  const block = parsed.data
  if ((block.results?.length ?? 0) === 0 && (block.claims?.length ?? 0) === 0) {
    return {
      ok: false,
      code: 'interpretation_invalid',
      reason: 'interpretations block declares no results and no claims',
    }
  }
  const spec: ParsedInterpretation = {
    results: (block.results ?? []).map(r => ({
      ...r,
      uncertainty: r.uncertainty ?? null,
    })),
    claims: (block.claims ?? []).map(c => {
      const { criticality_rationale, ...rest } = c
      return {
        ...rest,
        ...(criticality_rationale === undefined ? {} : { criticality_rationale }),
        result_refs: c.result_refs ?? [],
        model_refs: c.model_refs ?? [],
        evidence_refs: c.evidence_refs ?? [],
      }
    }),
  }

  const outputBytes = new Map(outputs.map(o => [o.locator, o.bytes]))

  // ---- Dry pass 0: the run the results cite must exist. ----
  const runRecord = ir.get(runId)
  if (runRecord === undefined || runRecord.kind !== 'RunArtifact') {
    return {
      ok: false,
      code: 'run_missing',
      reason: `run '${runId}' is not a RunArtifact in the store — results must cite a REAL executed run (P1-2 first)`,
    }
  }

  // ---- Dry pass A: parse every declared result OUT of the real bytes. ----
  const mintedResults: Array<{
    result_id: string
    run_ref: string
    name: string
    value: number
    unit: string
    uncertainty: number | null
    source_location: string
  }> = []
  const resultById = new Map<string, { value: number; unit: string }>()
  const seenResultIds = new Set<string>()
  for (const declared of spec.results) {
    if (seenResultIds.has(declared.result_id)) {
      return {
        ok: false,
        code: 'interpretation_invalid',
        reason: `result_id '${declared.result_id}' declared more than once`,
      }
    }
    seenResultIds.add(declared.result_id)
    const bytes = outputBytes.get(declared.source.locator)
    if (bytes === undefined) {
      return {
        ok: false,
        code: 'result_source_missing',
        reason: `result '${declared.result_id}' reads '${declared.source.locator}' but the executed run produced no such output (produced: [${[...outputBytes.keys()].join(',')}])`,
      }
    }
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(bytes)
    } catch (error) {
      return {
        ok: false,
        code: 'result_source_invalid',
        reason: `result '${declared.result_id}': output '${declared.source.locator}' is not valid JSON (${String(error).split('\n')[0]})`,
      }
    }
    const value = resolveJsonPath(parsedJson, declared.source.jsonPath)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return {
        ok: false,
        code: 'result_source_invalid',
        reason: `result '${declared.result_id}': path '${declared.source.jsonPath}' in '${declared.source.locator}' does not resolve to a finite number (got ${String(value)})`,
      }
    }
    mintedResults.push({
      result_id: declared.result_id,
      run_ref: runId,
      name: declared.name,
      value,
      unit: declared.unit,
      uncertainty: declared.uncertainty,
      source_location: `${declared.source.locator}#${declared.source.jsonPath}`,
    })
    resultById.set(declared.result_id, { value, unit: declared.unit })
  }

  // ---- Dry pass B: mint every Claim. NUMERIC binding values are copied
  // from the bound Result — the model cannot mis-transcribe a number. ----
  const mintedClaims: Array<Record<string, unknown>> = []
  const seenClaimIds = new Set<string>()
  for (const declared of spec.claims) {
    if (seenClaimIds.has(declared.claim_id)) {
      return {
        ok: false,
        code: 'interpretation_invalid',
        reason: `claim_id '${declared.claim_id}' declared more than once`,
      }
    }
    seenClaimIds.add(declared.claim_id)
    if (declared.claim_type === 'NUMERIC') {
      if (declared.result_refs.length === 0) {
        return {
          ok: false,
          code: 'interpretation_invalid',
          reason: `NUMERIC claim '${declared.claim_id}' must name ≥1 result_ref (D-001)`,
        }
      }
      const bound = resultById.get(declared.result_refs[0]!)
      if (bound === undefined) {
        return {
          ok: false,
          code: 'claim_binding_unknown',
          reason: `NUMERIC claim '${declared.claim_id}' binds result '${declared.result_refs[0]}' which is neither produced by this interpretation nor already in the store`,
        }
      }
      mintedClaims.push({
        claim_id: declared.claim_id,
        text: declared.text,
        claim_type: 'NUMERIC',
        // schema (3.R1 / INV-3-I) requires CRITICAL for NUMERIC claims; a
        // NON_CRITICAL declaration fails the closed schema and is refused
        // here with the same code (fail-closed, never a silent upgrade).
        criticality: 'CRITICAL',
        numeric_binding: {
          result_ref: declared.result_refs[0],
          asserted_value: bound.value,
          asserted_unit: bound.unit,
        },
        evidence_refs: [...declared.evidence_refs],
        result_refs: [...declared.result_refs],
        model_refs: [...declared.model_refs],
      })
    } else {
      mintedClaims.push({
        claim_id: declared.claim_id,
        text: declared.text,
        claim_type: declared.claim_type,
        criticality: declared.criticality,
        ...(declared.criticality_rationale === undefined
          ? {}
          : { criticality_rationale: declared.criticality_rationale }),
        numeric_binding: null,
        evidence_refs: [...declared.evidence_refs],
        result_refs: [...declared.result_refs],
        model_refs: [...declared.model_refs],
      })
    }
  }

  // ---- Dry pass C: every minted record must satisfy its closed schema. ----
  for (const record of mintedResults) {
    const check = IR_SCHEMAS.Result.safeParse(record)
    if (!check.success) {
      const issue = check.error.issues[0]
      return {
        ok: false,
        code: 'record_schema_violation',
        reason: `minted Result '${record.result_id}' violates its closed IR schema — ${issue?.message ?? 'invalid'}`,
      }
    }
  }
  for (const record of mintedClaims) {
    const check = IR_SCHEMAS.Claim.safeParse(record)
    if (!check.success) {
      const issue = check.error.issues[0]
      return {
        ok: false,
        code: 'record_schema_violation',
        reason: `minted Claim '${String(record['claim_id'])}' violates its closed IR schema — ${issue?.message ?? 'invalid'}`,
      }
    }
  }

  // ---- Write phase: results first, then claims (claims reference results).
  const resultIds: string[] = []
  for (const record of mintedResults) {
    const admitted = ir.put('Result', record)
    if (!admitted.accepted) {
      const failure = admitted.failures[0]
      return {
        ok: false,
        code: 'store_refused',
        reason: failure !== undefined
          ? `Result '${record.result_id}' refused: ${failure.kind}: ${failure.reason}`
          : `Result '${record.result_id}' refused by the store`,
      }
    }
    resultIds.push(record.result_id)
  }
  const claimIds: string[] = []
  for (const record of mintedClaims) {
    const admitted = ir.put('Claim', record)
    if (!admitted.accepted) {
      const failure = admitted.failures[0]
      return {
        ok: false,
        code: 'store_refused',
        reason: failure !== undefined
          ? `Claim '${String(record['claim_id'])}' refused: ${failure.kind}: ${failure.reason}`
          : `Claim '${String(record['claim_id'])}' refused by the store`,
      }
    }
    claimIds.push(String(readIrObjectId('Claim', record)))
  }
  // P2-3 (slice B): structural figure declarations are minted AFTER the
  // Results they draw exist in the store (data_refs must resolve).
  const figures: MintedFigure[] = []
  if ((block.figures?.length ?? 0) > 0) {
    const minted = produceFigures(ir, block.figures ?? [])
    if (!minted.ok) {
      return { ok: false, code: minted.code, reason: minted.reason }
    }
    for (const asset of minted.assets) {
      figures.push({ figureId: asset.figureId, data_hash: asset.data_hash, svg: asset.svg })
    }
  }

  return { ok: true, resultIds, claimIds, figures }
}
