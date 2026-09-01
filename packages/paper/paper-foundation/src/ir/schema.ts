/**
 * Minimal Modeling IR — schemas (TASK 1 + TASK 1.5).
 *
 * The single canonical vocabulary the Paper workflow is allowed to reason
 * about. Every object is a **closed** zod schema: `.strict()` means an
 * unrecognised key is a hard failure, never a silently-ignored extra. That is
 * what makes "LLM free text is not the source of truth for core mathematical
 * state" (INV-010) enforceable at the type boundary instead of in a prompt.
 *
 * Two rules from task book §7 are encoded structurally, not documented:
 *
 *   1. **No repair.** A value that fails validation stays failed. There is no
 *      coercion helper, no "best effort" parser, and no second-chance path in
 *      this module. Callers that want the model to try again must call
 *      `ingestJson` again with *newly generated* text; the rejected text never
 *      becomes canonical state.
 *
 *   2. **Fail closed on missing fields.** Fields the workflow needs for
 *      provenance (`run_ref`, `unit`, `exit_status`, `criticality`, …) are
 *      required. Absence is a schema failure, never `undefined`-as-null.
 *
 * TASK 1.5 additions: `DataArtifact`, `RequirementSpec`, `SymbolSpec` are now
 * closed canonical kinds. `ProblemSpec` no longer carries nested free-text
 * `subproblems`/`required_outputs`/`constraints`; it only references
 * `requirement_refs`. `ModelSpec.variables`/`parameters` no longer carry
 * `meaning`/`unit`; semantics live in `SymbolSpec`. `RunArtifact` no longer
 * accepts an arbitrary `input_refs[]` external-locator string list — it
 * requires `input_data_refs[]` pointing at `DataArtifact`s. Old shapes are
 * rejected by `.strict()`; there is no compatibility fallback (INV-1.5-F).
 *
 * Out of scope for TASK 1.5 (see `known-risks.md`): hash-by-bytes
 * verification (TASK 3), update/replace/STALE propagation (TASK 3.5),
 * reviewer authority (TASK 5), renderer / EquationSpec / TableSpec (TASK 7 /
 * 7.5), and any general ontology / data-catalogue UI.
 */

import { z as zod } from 'zod'
import { GATE_STATUSES } from '../delivery/delivery-policy.ts'
import { deepFreeze } from './freeze.ts'
import {
  dataArtifactSchema,
  requirementSpecSchema,
  symbolSpecSchema,
} from './problem-contract.ts'
// The closed enum constants are re-exported at the bottom of this file
// straight from `problem-contract.ts`; importing them here as well only to
// re-export them is what made them read as unused.

/**
 * Closed set of IR object kinds. The first seven are task book §7; the
 * eighth (`ReviewerFinding`) exists because attack IR-010 requires a
 * malformed reviewer finding to be blocked rather than absorbed — an
 * untyped reviewer blob cannot be proven blocked, a typed one can. The
 * three new kinds (`DataArtifact`, `RequirementSpec`, `SymbolSpec`) come
 * from TASK 1.5 and freeze the canonical Problem Contract.
 */
export const IR_KINDS = [
  'ProblemSpec',
  'ModelSpec',
  'RunArtifact',
  'Result',
  'Claim',
  'VerificationResult',
  'FigureSpec',
  'ReviewerFinding',
  'DataArtifact',
  'RequirementSpec',
  'SymbolSpec',
] as const

export type IrKind = (typeof IR_KINDS)[number]

/**
 * IDs exclude control, format, surrogate and separator characters, and must
 * already be in Unicode NFC form.
 *
 * The charset rule closes log/URI injection through ids such as `"\u0000"`;
 * the NFC rule closes id aliasing, where `"caf\u00e9"` and `"cafe\u0301"` are
 * two distinct Map keys that any normalising consumer reads as one id
 * (red team RT1-04).
 */
const idSchema = zod
  .string()
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u, 'must not contain control, format, surrogate or separator characters')
  .refine(v => v === v.normalize('NFC'), 'must be in Unicode NFC form')

/**
 * A reference. Both IR-internal references (`run_ref`) and external locators
 * (`code_ref`, `stdout_ref`) are non-empty strings; which one a field holds is
 * declared in `refs.ts`, not inferred from the string's shape.
 */
const refSchema = zod.string().min(1)
/** Bounded so a single prose field cannot carry a multi-megabyte payload. */
const textSchema = zod.string().min(1).max(65_536)
const hashSchema = zod.string().min(1)
const unitSchema = zod.string().min(1)

/**
 * TASK 1.5: the nested free-text subproblem / required-output / constraint
 * shapes are deleted from this module, not merely disconnected. Their
 * `Subproblem` / `RequiredOutput` / `ModelVariable` / `ModelParameter`
 * schemas are gone and their types are no longer exported: leaving a
 * definition behind, even an unused one, is the seed of a second source of
 * truth (INV-1.5-F). The canonical truth is `RequirementSpec` (addressed by
 * `ProblemSpec.requirement_refs`) and `SymbolSpec` (addressed by
 * `ModelSpec.variable_refs` / `parameter_refs`).
 */

/**
 * Canonical `ProblemSpec`. The nested free-text subproblems / required
 * outputs / constraints arrays are gone (TASK 1.5, INV-1.5-A); the canonical
 * truth now lives in `RequirementSpec` records referenced by
 * `requirement_refs`. `raw_problem_ref` no longer points at an arbitrary
 * external locator — it points at a `DataArtifact` (role = RAW_PROBLEM),
 * which gives the problem statement a canonical identity with a declared
 * content hash (the hash itself is verified by TASK 3's Execution Gate).
 */
export const problemSpecSchema = zod
  .object({
    problem_id: idSchema,
    raw_problem_ref: refSchema,
    requirement_refs: zod.array(refSchema),
  })
  .strict()
  .refine(
    v => new Set(v.requirement_refs).size === v.requirement_refs.length,
    { message: 'ProblemSpec.requirement_refs contains duplicate references' },
  )

/**
 * Canonical `ModelSpec`. `variables[]` and `parameters[]` no longer carry
 * `meaning`/`unit` — those fields live in `SymbolSpec`. `ModelSpec` now
 * declares `variable_refs[]` (pointing at SymbolSpecs of role VARIABLE) and
 * `parameters[]` is replaced by `parameter_refs[]` whose entries are
 * `{ symbol_ref, value }` (the unit is read from the referenced SymbolSpec,
 * and the value is the parameter assignment). `equations[]`,
 * `assumptions[]`, `constraints[]` and `objective` stay as free-text by
 * design: TASK 2 owns the numeric claim extraction that turns them into
 * canonical objects, and changing that surface is out of scope here.
 */
export const modelSpecSchema = zod
  .object({
    model_id: idSchema,
    problem_refs: zod.array(refSchema),
    assumptions: zod.array(textSchema),
    variable_refs: zod.array(refSchema),
    parameter_refs: zod.array(
      zod
        .object({
          symbol_ref: refSchema,
          value: zod.number(),
        })
        .strict(),
    ),
    equations: zod.array(textSchema),
    constraints: zod.array(textSchema),
    objective: textSchema.nullable(),
    dependencies: zod.array(refSchema),
  })
  .strict()
  .refine(
    v => new Set(v.variable_refs).size === v.variable_refs.length,
    { message: 'ModelSpec.variable_refs contains duplicate references' },
  )
  .refine(
    v => new Set(v.parameter_refs.map(p => p.symbol_ref)).size === v.parameter_refs.length,
    { message: 'ModelSpec.parameter_refs contains duplicate symbol_ref' },
  )

/**
 * Canonical `RunArtifact`. The TASK 1 `input_refs[]` (an arbitrary external
 * locator list) is gone — replaced by `input_data_refs[]` pointing at
 * `DataArtifact` records with role INPUT_DATA. The other external locators
 * (`code_ref`, `stdout_ref`, `stderr_ref`, `output_refs`) are still strings
 * because their existence is verified by TASK 3, not here.
 */
export const runArtifactSchema = zod
  .object({
    run_id: idSchema,
    model_ref: refSchema,
    code_ref: refSchema,
    input_data_refs: zod.array(refSchema),
    environment: textSchema,
    /** `null` means "no seed was recorded" — an explicit statement, not an
     *  omission. TASK 3's reproducibility gate owns the policy that rejects
     *  `null`; the IR only refuses to invent one. */
    seed: zod.union([zod.number().int(), textSchema]).nullable(),
    exit_status: zod.number().int(),
    stdout_ref: refSchema,
    stderr_ref: refSchema,
    output_refs: zod.array(refSchema),
    code_hash: hashSchema,
    input_hash: hashSchema,
    output_hash: hashSchema,
  })
  .strict()

export const resultSchema = zod
  .object({
    result_id: idSchema,
    run_ref: refSchema,
    name: textSchema,
    /** zod's `number()` already rejects NaN / ±Infinity, so a JSON-hostile
     *  value can never reach canonical state through the typed path. */
    value: zod.number(),
    unit: unitSchema,
    uncertainty: zod.number().nullable(),
    source_location: textSchema,
  })
  .strict()

export const CLAIM_TYPES = ['NUMERIC', 'MODEL', 'QUALITATIVE'] as const
export type ClaimType = (typeof CLAIM_TYPES)[number]

/**
 * Closed criticality set. There is deliberately no `UNKNOWN`: a claim whose
 * criticality the model cannot decide must be recorded as `CRITICAL`, because
 * the only fail-closed default is the strictest one.
 */
export const CLAIM_CRITICALITIES = ['CRITICAL', 'NON_CRITICAL'] as const
export type ClaimCriticality = (typeof CLAIM_CRITICALITIES)[number]

/**
 * TASK 2 — Numeric Claim Binding (INV-2-A/B/C).
 *
 * A CRITICAL Claim's core number may not live in `text`. The binding is the
 * only place the canonical machine value lives; `text` is presentational.
 *
 * Structural rules ( schema-only — semantic equality lives in
 * `claim-evidence.ts` ):
 *   - `result_ref` MUST resolve to a `Result` in the store. Existence + kind
 *     is guaranteed by `IR_REF_FIELDS.Claim.result_refs` at commit time;
 *     the schema only checks shape.
 *   - `asserted_value: zod.number()` rejects NaN / ±Infinity at ingest —
 *     same path as `Result.value` (D-016).
 *   - `asserted_unit` is the unit the paper claims; equality with
 *     `Result.unit` lives in `claim-evidence.ts` (D-006).
 */
export const numericBindingSchema = zod
  .object({
    result_ref: refSchema,
    asserted_value: zod.number(),
    asserted_unit: unitSchema,
  })
  .strict()

/**
 * TASK 2 — Discriminated union over `claim_type` (INV-2-A, INV-2-E, INV-2-G).
 *
 * The discriminator lets TS narrow `claim.claim_type === 'NUMERIC'` →
 * `claim.numeric_binding` is non-null at the type level. The per-type
 * structural rules replace the old "at least one reference" refine
 * (RT2-04), so a CRITICAL claim that names nothing can no longer pass the
 * store. Semantic checks (value/unit equality, role binding) live in
 * `claim-evidence.ts`; the schema is strictly the shape contract.
 *
 * NUMERIC:
 *   - `numeric_binding` required and non-null (D-001)
 *   - `result_refs.min(1)` — store guarantees the binding's `result_ref`
 *     resolves; semantic guard (`inspectClaimEvidence`) guarantees it is
 *     *also* listed in `result_refs` (D-004).
 *
 * MODEL:
 *   - `numeric_binding` is the literal `null`; any value at that path is a
 *     schema BLOCKED (D-010). `model_refs.min(1)` (D-009).
 *
 * QUALITATIVE:
 *   - `numeric_binding` is the literal `null` (D-012). CRITICAL
 *     QUALITATIVE with empty `evidence_refs` is schema-valid; the semantic
 *     guard refuses it (D-011).
 */
export const claimSchema = zod.discriminatedUnion('claim_type', [
  zod
    .object({
      claim_id: idSchema,
      text: textSchema,
      claim_type: zod.literal('NUMERIC'),
      criticality: zod.enum(CLAIM_CRITICALITIES),
      numeric_binding: numericBindingSchema,
      evidence_refs: zod.array(refSchema),
      result_refs: zod.array(refSchema).min(1),
      model_refs: zod.array(refSchema),
    })
    .strict(),
  zod
    .object({
      claim_id: idSchema,
      text: textSchema,
      claim_type: zod.literal('MODEL'),
      criticality: zod.enum(CLAIM_CRITICALITIES),
      numeric_binding: zod.null(),
      evidence_refs: zod.array(refSchema),
      result_refs: zod.array(refSchema),
      model_refs: zod.array(refSchema).min(1),
    })
    .strict(),
  zod
    .object({
      claim_id: idSchema,
      text: textSchema,
      claim_type: zod.literal('QUALITATIVE'),
      criticality: zod.enum(CLAIM_CRITICALITIES),
      numeric_binding: zod.null(),
      evidence_refs: zod.array(refSchema),
      result_refs: zod.array(refSchema),
      model_refs: zod.array(refSchema),
    })
    .strict(),
])

export const verificationResultSchema = zod
  .object({
    verification_id: idSchema,
    target_ref: refSchema,
    verifier: textSchema,
    /** Reuses TASK 0's closed gate-status set so PASS/FAIL/BLOCKED means the
     *  same thing everywhere. No WARNING / MAYBE / LIKELY / PARTIAL. */
    status: zod.enum(GATE_STATUSES),
    evidence_refs: zod.array(refSchema),
  })
  .strict()

/** Schema-only in TASK 1 — TASK 7 owns the renderer and the style profile.
 *
 *  TASK 1.5: `data_refs` no longer resolves to `Result`-only; the canonical
 *  union is `Result | DataArtifact`. The store-level reference check lives
 *  in `refs.ts` (which encodes the per-element kind check as a `one-of`
 *  shape — see `IR_REF_FIELDS.FigureSpec.data_refs`), and the per-element
 *  runtime check in `problem-contract.ts` rejects anything outside that
 *  union (C-015).
 */
export const figureSpecSchema = zod
  .object({
    figure_id: idSchema,
    data_refs: zod.array(refSchema),
    claim_refs: zod.array(refSchema),
  })
  .strict()

/** Attack taxonomy verbatim from task book §13 (closed, not free text). */
export const ATTACK_TYPES = [
  'requirement-coverage',
  'boundary-condition',
  'unit-consistency',
  'numeric-consistency',
  'constraint-violation',
  'unsupported-claim',
  'data-provenance',
  'statistical-validity',
  'sensitivity',
  'counterexample',
] as const
export type AttackType = (typeof ATTACK_TYPES)[number]

export const FINDING_SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR'] as const
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]

export const reviewerFindingSchema = zod
  .object({
    finding_id: idSchema,
    target_ref: refSchema,
    attack_type: zod.enum(ATTACK_TYPES),
    hypothesis: textSchema,
    reason: textSchema,
    evidence_refs: zod.array(refSchema),
    proposed_check: textSchema,
    severity: zod.enum(FINDING_SEVERITIES),
  })
  .strict()

export type ProblemSpec = zod.infer<typeof problemSpecSchema>
// The legacy `Subproblem` / `RequiredOutput` / `ModelVariable` /
// `ModelParameter` aliases are deliberately dropped: their objects no
// longer exist in canonical state. Old fixtures that named them continue
// to type-check at the import site (the schemas still exist for the
// problem-contract tests), but no public API returns their inferred
// types.
export type ModelSpec = zod.infer<typeof modelSpecSchema>
export type RunArtifact = zod.infer<typeof runArtifactSchema>
export type Result = zod.infer<typeof resultSchema>
export type Claim = zod.infer<typeof claimSchema>
export type NumericClaimBinding = zod.infer<typeof numericBindingSchema>
export type VerificationResult = zod.infer<typeof verificationResultSchema>
export type FigureSpec = zod.infer<typeof figureSpecSchema>
export type ReviewerFinding = zod.infer<typeof reviewerFindingSchema>

/** Re-export the TASK 1.5 kinds so callers can `import { DataArtifact, … }
 * from './schema.ts'` (and so the schema barrel does not need a second
 * public surface). */
export { dataArtifactSchema, requirementSpecSchema, symbolSpecSchema } from './problem-contract.ts'
export {
  DATA_ARTIFACT_ROLES,
  REQUIREMENT_TYPES,
  SYMBOL_ROLES,
} from './problem-contract.ts'
export type {
  DataArtifact,
  RequirementSpec,
  SymbolSpec,
  DataArtifactRole,
  RequirementType,
  SymbolRole,
} from './problem-contract.ts'

/** Maps every IR kind to its TypeScript shape. */
export interface IrObjectMap {
  ProblemSpec: ProblemSpec
  ModelSpec: ModelSpec
  RunArtifact: RunArtifact
  Result: Result
  Claim: Claim
  VerificationResult: VerificationResult
  FigureSpec: FigureSpec
  ReviewerFinding: ReviewerFinding
  DataArtifact: import('./problem-contract.ts').DataArtifact
  RequirementSpec: import('./problem-contract.ts').RequirementSpec
  SymbolSpec: import('./problem-contract.ts').SymbolSpec
}

/**
 * Schema for every kind, keyed by kind. The mapped type keeps
 * `IR_SCHEMAS[kind]` correlated with `kind`, so the store can parse a generic
 * `IrKind` without an unchecked cast.
 */
export const IR_SCHEMAS: { readonly [K in IrKind]: zod.ZodType<IrObjectMap[K]> } = {
  ProblemSpec: problemSpecSchema,
  ModelSpec: modelSpecSchema,
  RunArtifact: runArtifactSchema,
  Result: resultSchema,
  Claim: claimSchema,
  VerificationResult: verificationResultSchema,
  FigureSpec: figureSpecSchema,
  ReviewerFinding: reviewerFindingSchema,
  DataArtifact: dataArtifactSchema,
  RequirementSpec: requirementSpecSchema,
  SymbolSpec: symbolSpecSchema,
}


/**
 * The globally-unique ID field of each kind. `readIrObjectId` is the only
 * reader, and `ir.spec.ts` asserts every kind actually declares its field, so
 * a future kind that forgets the mapping fails a test rather than silently
 * registering every object under an `undefined` ID.
 */
export const ID_FIELD_BY_KIND: Readonly<Record<IrKind, string>> = {
  ProblemSpec: 'problem_id',
  ModelSpec: 'model_id',
  RunArtifact: 'run_id',
  Result: 'result_id',
  Claim: 'claim_id',
  VerificationResult: 'verification_id',
  FigureSpec: 'figure_id',
  ReviewerFinding: 'finding_id',
  DataArtifact: 'data_id',
  RequirementSpec: 'requirement_id',
  SymbolSpec: 'symbol_id',
}

/**
 * Read the canonical ID of an already-validated IR object.
 * Only valid to call after `IR_SCHEMAS[kind].parse` succeeded.
 */
export function readIrObjectId(kind: IrKind, value: unknown): string {
  // The schema of `kind` always declares an id field (asserted by the schema
  // tests), so the field name is guaranteed present.
  return (value as Record<string, string>)[ID_FIELD_BY_KIND[kind] as string] as string
}

// Freeze the policy tables last: `ID_FIELD_BY_KIND` is declared above, and a
// `const` read before its initialiser would throw. Deep (not shallow), so
// replacing a single schema instance or ref-field spec is blocked too, not
// just replacing the whole table. Verified safe for zod 4.4.3 schemas.
deepFreeze(IR_KINDS)
deepFreeze(IR_SCHEMAS)
deepFreeze(ID_FIELD_BY_KIND)
