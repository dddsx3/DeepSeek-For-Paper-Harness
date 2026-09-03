/**
 * Canonical Claim Evidence Semantic Validator (TASK 2).
 *
 * The store (`store.ts` + `refs.ts`) already guarantees that every IR-internal
 * reference in a Claim resolves to a registered object of the right kind, and
 * the schema (`schema.ts`) already enforces the per-type structural contract
 * (NUMERIC requires `numeric_binding`, MODEL requires `model_refs.min(1)`, …).
 * What the store and schema *cannot* enforce — because doing so requires
 * cross-object knowledge that is unavailable at `put()` time — is the semantic
 * binding between the claim and the result it cites:
 *
 *   - NUMERIC: `numeric_binding.result_ref` is in the store as a `Result`;
 *     `numeric_binding.result_ref` is also in the claim's `result_refs[]`;
 *     `numeric_binding.asserted_value` is identical to `Result.value`;
 *     `numeric_binding.asserted_unit` is identical to `Result.unit`.
 *   - MODEL: at least one `model_refs[]` entry resolves to a registered
 *     `ModelSpec`.
 *   - QUALITATIVE (CRITICAL only): at least one `evidence_refs[]` entry
 *     exists (semantically: "no naked CRITICAL QUALITATIVE claim").
 *
 * Out of scope (per task book §1 / §2):
 *   - Hash-by-bytes verification (TASK 3) — the binding's `asserted_value`
 *     is read against `Result.value`, not against any external bytes.
 *   - Tolerance / rounding / coercion — every equality is exact identity
 *     (`Number(a) === Number(b)`, with the documented `-0/+0` collapse
 *     and the `NaN`-impossible guarantee inherited from the schema).
 *   - Update / replace / STALE engine (TASK 3.5) — append-only.
 *   - Reviewer authority (TASK 5) — semantic guards only look at the
 *     claim itself, not at ReviewerFinding evidence.
 *   - Renderer / EquationSpec (TASK 7) — `text` is purely presentational
 *     here; no text is parsed to recover the canonical number.
 *
 * The validator is total: it never throws, never mutates, and is a pure
 * function of its inputs. The bridge calls {@link inspectClaimEvidence}
 * once per delivery; tests may call {@link validateClaimEvidence} on a
 * single Claim for direct unit checks.
 */

import type { IrObjectRecord } from './store.ts'

// ---------------------------------------------------------------------------
// Closed failure kinds
// ---------------------------------------------------------------------------

/**
 * Why a Claim failed its semantic evidence check.
 *
 * Closed set: an attacker cannot invent a verdict; a missing value here is a
 * programming error in the guard.
 *
 * The kinds fall in two camps:
 *   - **schema-shaped** ones (`numeric_binding_missing`,
 *     `numeric_binding_present_on_non_numeric`) are normally caught by the
 *     store boundary already; the validator repeats them so a non-store
 *     ingest path (a future renderer, a synthetic test driver) cannot
 *     bypass them. They are unreachable via the canonical store by
 *     construction and are reported here only if the caller somehow
 *     handed the validator a value that bypassed `claimSchema.parse`.
 *   - **semantic** ones (the rest) are the validator's reason for
 *     existing; they are *never* caught by the schema.
 */
export const CLAIM_EVIDENCE_FAILURE_KINDS = [
  // schema-shaped (defence in depth — schema catches first when present)
  'numeric_binding_missing',
  'numeric_binding_present_on_non_numeric',
  // semantic guards
  'numeric_binding_result_unresolved',
  'numeric_binding_result_not_in_result_refs',
  'numeric_value_mismatch',
  'numeric_unit_mismatch',
  'model_claim_no_model_ref',
  'qualitative_critical_no_evidence',
] as const

export type ClaimEvidenceFailureKind = (typeof CLAIM_EVIDENCE_FAILURE_KINDS)[number]

export interface ClaimEvidenceFailure {
  readonly kind: ClaimEvidenceFailureKind
  readonly path: string
  readonly reason: string
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolver shape consumed by {@link validateClaimEvidence}.
 *
 * The validator does not own canonical state — the store does — so it reads
 * the world through a resolver, the same shape every other guard uses. The
 * resolver decides whether `ref` exists and what kind it is; the guard
 * never inspects IDs against an in-memory map of its own.
 *
 *   - `Result`  carries `value` and `unit` so the binding can be checked
 *     without a second resolver trip.
 *   - `ModelSpec`, `DataArtifact`, `RequirementSpec`, `RunArtifact` carry
 *     only the kind discriminator — the guard only needs to know the kind
 *     to enforce `model_refs.min(1)`.
 *   - `undefined` means "not registered" — a claim may not bind to a
 *     missing object (D-002 / D-003). Existence is also guaranteed by the
 *     store boundary; this branch is fail-closed (unreachable via the
 *     canonical store, kept as a defence-in-depth verdict so a synthetic
 *     driver cannot smuggle in a phantom ref).
 */
export type ClaimEvidenceResolver = (ref: string) =>
  | { readonly kind: 'Result'; readonly value: number; readonly unit: string }
  | { readonly kind: 'ModelSpec' }
  | { readonly kind: 'DataArtifact' }
  | { readonly kind: 'RequirementSpec' }
  | { readonly kind: 'RunArtifact' }
  | undefined

// ---------------------------------------------------------------------------
// Equality semantics for asserted_value vs Result.value
// ---------------------------------------------------------------------------

/**
 * Equality policy for numeric binding equality.
 *
 * `Object.is` would catch `NaN` equality but flag `-0` vs `0`. We
 * deliberately collapse `-0` to `+0` because:
 *
 *   1. JSON has no `NaN`/`Infinity`/negative-zero surface — zod already
 *      rejects both at ingest, so the equality never runs on `NaN` or
 *      `±Infinity`. Equality on `NaN` is moot: the schema rejects it.
 *   2. JSON-derived numbers are stored as `+0` on round-trip; collapsing
 *      `-0` to `+0` is the only policy that preserves JSON-round-trip
 *      equality.
 *   3. The task book §7 row D-017 explicitly freezes the `-0 / 0`
 *      policy.
 *
 * `Number(a) === Number(b)` is exactly that: the literal ECMAScript
 * equality of two numbers after their numeric coercion, which (a) makes
 * `-0 === +0` true and (b) never sees `NaN`.
 *
 * Tests in `tests/ir/claim-evidence.spec.ts` pin both halves of the
 * contract; future refactors must not silently switch to `Object.is`.
 */
export function numericValuesEqual(a: number, b: number): boolean {
  return a === b
}

// ---------------------------------------------------------------------------
// validateClaimEvidence
// ---------------------------------------------------------------------------

/**
 * Run every semantic guard on a single Claim.
 *
 * Inputs are expected to be schema-valid (the store boundary guarantees
 * that for any value the validator sees in production); the validator
 * still defends in depth against a malformed `numeric_binding` shape so a
 * non-store ingest path cannot bypass the contract.
 *
 * Returns every problem it finds so one ingest reports the whole closure
 * rather than one error at a time.
 *
 * @param claim - the Claim value (already deep-frozen by the store).
 * @param resolve - resolver the guard uses to inspect referenced objects.
 * @param claimId - the claim_id (kept on the path for stable audit
 *   attribution). Defaults to the claim's own `claim_id` when present.
 */
export function validateClaimEvidence(
  claim: Readonly<Record<string, unknown>>,
  resolve: ClaimEvidenceResolver,
  claimId?: string,
): ReadonlyArray<ClaimEvidenceFailure> {
  const problems: ClaimEvidenceFailure[] = []
  const id = claimId ?? stringOrUnknown(claim['claim_id'])
  const basePath = `Claim.${id}`

  const claimType = claim['claim_type']
  if (claimType !== 'NUMERIC' && claimType !== 'MODEL' && claimType !== 'QUALITATIVE') {
    // Unreachable via the canonical store: the discriminated union schema
    // refuses anything that is not one of the three literals. Fail-closed
    // by emitting *both* schema-shaped failures below so a future caller
    // that bypasses the schema sees something specific to debug, and so the
    // audit record is consistent with what the store would have written.
    problems.push({
      kind: 'numeric_binding_missing',
      path: `${basePath}.claim_type`,
      reason: `unknown claim_type: ${String(claimType)}`,
    })
    return problems
  }

  const criticality = claim['criticality']
  const isCritical = criticality === 'CRITICAL'
  const binding = claim['numeric_binding']
  const resultRefs = toStringArray(claim['result_refs'])
  const evidenceRefs = toStringArray(claim['evidence_refs'])
  const modelRefs = toStringArray(claim['model_refs'])

  if (claimType === 'NUMERIC') {
    if (!isObject(binding)) {
      problems.push({
        kind: 'numeric_binding_missing',
        path: `${basePath}.numeric_binding`,
        reason: 'NUMERIC Claim must declare a numeric_binding object',
      })
    } else {
      const resultRef = stringOrUnknown(binding['result_ref'])
      const assertedValue = binding['asserted_value']
      const assertedUnit = stringOrUnknown(binding['asserted_unit'])

      if (typeof assertedValue !== 'number') {
        // Schema guarantees zod.number(); kept as defence in depth so a
        // caller that handed us a non-store value still gets a verdict.
        problems.push({
          kind: 'numeric_value_mismatch',
          path: `${basePath}.numeric_binding.asserted_value`,
          reason: `numeric_binding.asserted_value must be a number (got ${typeof assertedValue})`,
        })
      }

      const target = resultRef === undefined ? undefined : resolve(resultRef)
      if (target === undefined) {
        // Unreachable via the canonical store (refs.ts guarantees
        // result_refs resolves to a Result). Fail-closed.
        problems.push({
          kind: 'numeric_binding_result_unresolved',
          path: `${basePath}.numeric_binding.result_ref`,
          reason: resultRef === undefined
            ? 'numeric_binding.result_ref is missing'
            : `numeric_binding.result_ref '${resultRef}' is not a registered Result`,
        })
      } else if (target.kind !== 'Result') {
        // D-003 — binding points at a non-Result. Schema/store should
        // have caught this via refs.ts; reported here for symmetry with
        // D-003.
        const r = resultRef ?? ''
        problems.push({
          kind: 'numeric_binding_result_unresolved',
          path: `${basePath}.numeric_binding.result_ref`,
          reason: `numeric_binding.result_ref '${r}' resolves to ${target.kind}, expected Result`,
        })
      } else {
        if (resultRef === undefined || !resultRefs.includes(resultRef)) {
          problems.push({
            kind: 'numeric_binding_result_not_in_result_refs',
            path: `${basePath}.numeric_binding.result_ref`,
            reason: `numeric_binding.result_ref '${resultRef ?? ''}' is not in Claim.result_refs [${resultRefs.join(',')}]`,
          })
        }
        if (typeof assertedValue === 'number' && !numericValuesEqual(assertedValue, target.value)) {
          problems.push({
            kind: 'numeric_value_mismatch',
            path: `${basePath}.numeric_binding.asserted_value`,
            reason: `numeric_binding.asserted_value ${assertedValue} !== Result '${resultRef}' value ${target.value}`,
          })
        }
        if (assertedUnit !== target.unit) {
          problems.push({
            kind: 'numeric_unit_mismatch',
            path: `${basePath}.numeric_binding.asserted_unit`,
            reason: `numeric_binding.asserted_unit '${assertedUnit ?? ''}' !== Result '${resultRef}' unit '${target.unit}'`,
          })
        }
      }
    }
  } else {
    // MODEL or QUALITATIVE — `numeric_binding` must be the literal null.
    // Schema catches this first; the validator defends in depth.
    if (binding !== null) {
      problems.push({
        kind: 'numeric_binding_present_on_non_numeric',
        path: `${basePath}.numeric_binding`,
        reason: `${claimType} Claim must have numeric_binding === null`,
      })
    }
  }

  if (claimType === 'MODEL') {
    // The schema enforces model_refs.min(1) for MODEL claims. The
    // semantic guard verifies the *resolved* refs include a ModelSpec —
    // a CRITICAL MODEL with a phantom ModelSpec ref would still pass the
    // schema but be caught here (D-009).
    if (modelRefs.length === 0) {
      problems.push({
        kind: 'model_claim_no_model_ref',
        path: `${basePath}.model_refs`,
        reason: 'MODEL Claim must reference at least one ModelSpec',
      })
    } else {
      for (const ref of modelRefs) {
        const target = resolve(ref)
        if (target === undefined) {
          // Unreachable via the canonical store (refs.ts guarantees
          // model_refs resolves to a ModelSpec). Fail-closed.
          problems.push({
            kind: 'model_claim_no_model_ref',
            path: `${basePath}.model_refs.${ref}`,
            reason: `model_ref '${ref}' is not a registered ModelSpec`,
          })
          break
        }
        if (target.kind !== 'ModelSpec') {
          problems.push({
            kind: 'model_claim_no_model_ref',
            path: `${basePath}.model_refs.${ref}`,
            reason: `model_ref '${ref}' resolves to ${target.kind}, expected ModelSpec`,
          })
          break
        }
      }
    }
  }

  if (claimType === 'QUALITATIVE' && isCritical) {
    // D-011 — a CRITICAL qualitative claim with zero evidence_refs is a
    // "naked prose assertion"; the schema permits it (a non-CRITICAL
    // qualitative claim with zero evidence_refs is a perfectly fine draft
    // note), so the semantic guard owns the verdict.
    if (evidenceRefs.length === 0) {
      problems.push({
        kind: 'qualitative_critical_no_evidence',
        path: `${basePath}.evidence_refs`,
        reason: 'CRITICAL QUALITATIVE Claim must declare at least one evidence_ref',
      })
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// inspectClaimEvidence
// ---------------------------------------------------------------------------

/**
 * Walk every Claim in the canonical snapshot and report every semantic
 * failure across the closure.
 *
 * Used by the bridge as a single delivery-time check: one resolver trip
 * per Claim, one merged failure list across the store. The bridge's own
 * contract is the only place this is called in production; tests may
 * call it directly to assert "the closure is internally consistent".
 *
 * Total: never throws. An internal resolver miss is reported as a
 * `numeric_binding_result_unresolved` / `model_claim_no_model_ref` /
 * `numeric_binding_result_not_in_result_refs` failure, not an exception.
 */
export function inspectClaimEvidence(
  store: ReadonlyMap<string, IrObjectRecord>,
): ReadonlyArray<ClaimEvidenceFailure> {
  const problems: ClaimEvidenceFailure[] = []
  const resolve = resolverFromStore(store)
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    // The store hands us `IrObjectRecord<Claim>`, which `value` is the
    // discriminated-union object. The validator only reads it, so the
    // type-narrowing happens at the validator level.
    const claim = record.value as Readonly<Record<string, unknown>>
    const claimId = stringOrUnknown(claim['claim_id'])
    for (const failure of validateClaimEvidence(claim, resolve, claimId)) {
      problems.push(failure)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Exported so critical gates (P1-3 numeric_consistency) run the SAME
 *  semantic guards against the canonical store that ingest would run. */
export function resolverFromStore(
  store: ReadonlyMap<string, IrObjectRecord>,
): ClaimEvidenceResolver {
  return (ref: string) => {
    const record = store.get(ref)
    if (record === undefined) return undefined
    if (record.kind === 'Result') {
      const value = record.value as { value: number; unit: string }
      return { kind: 'Result', value: value.value, unit: value.unit }
    }
    if (record.kind === 'ModelSpec') return { kind: 'ModelSpec' }
    if (record.kind === 'DataArtifact') return { kind: 'DataArtifact' }
    if (record.kind === 'RequirementSpec') return { kind: 'RequirementSpec' }
    if (record.kind === 'RunArtifact') return { kind: 'RunArtifact' }
    // Other kinds (`FigureSpec`, `VerificationResult`, `ReviewerFinding`,
    // `ProblemSpec`, `SymbolSpec`) are not on the claim-evidence path;
    // returning undefined closes them off without exposing a partially
    // typed object.
    return undefined
  }
}

function stringOrUnknown(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toStringArray(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry)
  }
  return out
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}