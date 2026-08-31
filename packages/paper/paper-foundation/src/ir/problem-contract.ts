/**
 * Canonical Problem Contract (TASK 1.5).
 *
 * Three new closed kinds live alongside the eight TASK 1 kinds:
 *
 *   - {@link DataArtifact} — the canonical wrapper around an external locator.
 *     `content_hash` is constrained to `sha256:<64 lowercase hex>` so a free-text
 *     placeholder cannot pose as a hash. Provenance-by-bytes is deliberately
 *     deferred to TASK 3 (Execution/Provenance Gate); this module only enforces
 *     canonical identity and declared format.
 *
 *   - {@link RequirementSpec} — a globally addressable statement of "the
 *     problem asks for X". `requirement_type` is one of three closed enum
 *     values, so a Requirement cannot smuggle a fourth kind of fact past the
 *     store. Its `source_data_ref` must point at a DataArtifact, never at a
 *     Result / Claim / ModelSpec — that kind mismatch is detected by
 *     {@link validateRefFields} via the per-field `target` set in `refs.ts`.
 *
 *   - {@link SymbolSpec} — the single source of truth for a problem's
 *     variable / parameter semantics. A `SymbolSpec` carries `meaning` and
 *     `unit` once; `ModelSpec` references it. Two `SymbolSpec` records inside
 *     the same `scope_ref` may not share a `token` (same-scope uniqueness is
 *     enforced in {@link problemContractGuards}).
 *
 * The previous "nested inside `ProblemSpec`" shapes are removed from the
 * canonical schema: ProblemSpec no longer carries
 * `subproblems / required_outputs / constraints`, and ModelSpec no longer
 * carries `variables`/`parameters` with embedded meaning/unit. They are
 * rejected by the strict zod schema, with no compatibility fallback
 * (INV-1.5-F). New fields `requirement_refs` and `variable_refs` /
 * `parameter_refs` point at the canonical objects instead.
 *
 * Cross-cutting semantic guards (raw source ↔ requirement source consistency,
 * symbol role binding, parameter role binding, …) live in
 * {@link problemContractGuards}. They are deliberately separate from the
 * store's shape-level validation, so the store can refuse schema-invalid
 * objects on its own and a second pass can refuse contract-invalid objects
 * without coupling the two failures.
 *
 * Out of scope (per task book §3): hash-by-bytes verification (TASK 3),
 * update/replace/STALE propagation (TASK 3.5), reviewer authority (TASK 5),
 * renderer / EquationSpec / TableSpec (TASK 7 / 7.5), ontology or data
 * catalogue UI, and any "compatibility fallback" that would keep the old
 * fields alive as a parallel truth source.
 */

import { z as zod } from 'zod'

// ---------------------------------------------------------------------------
// Reuse the TASK 1 invariants: id charset + NFC, bounded text.
// ---------------------------------------------------------------------------

const idSchema = zod
  .string()
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u, 'must not contain control, format, surrogate or separator characters')
  .refine(v => v === v.normalize('NFC'), 'must be in Unicode NFC form')

const refSchema = zod.string().min(1)

const textSchema = zod.string().min(1).max(65_536)

// ---------------------------------------------------------------------------
// DataArtifact
// ---------------------------------------------------------------------------

/**
 * Closed set of roles a DataArtifact may play. `RAW_PROBLEM` is the wrapper
 * for the externally-located problem statement; `INPUT_DATA` is the wrapper
 * for an externally-located data file consumed by a RunArtifact. Adding a new
 * role requires editing this enum AND threading the role check through every
 * consumer; the closed shape is the whole point.
 */
export const DATA_ARTIFACT_ROLES = ['RAW_PROBLEM', 'INPUT_DATA'] as const
export type DataArtifactRole = (typeof DATA_ARTIFACT_ROLES)[number]

/**
 * Strict shape for a declared content hash. The `sha256:` prefix is mandatory
 * so the format is distinguishable from raw hex used elsewhere (e.g.
 * RunArtifact.code_hash can be the future TASK 3 bytes hash, but it is not
 * declared here); 64 lowercase hex digits is the only body accepted. A
 * malformed value (`'sha256:1234'`, `'md5:…'`, `'cafebabe'`) fails schema
 * validation — the store reports `schema_invalid` and refuses the object
 * (attack C-006, C-007).
 */
const sha256ContentHashSchema = zod
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'content_hash must be sha256:<64 lowercase hex>')

export const dataArtifactSchema = zod
  .object({
    data_id: idSchema,
    role: zod.enum(DATA_ARTIFACT_ROLES),
    locator: refSchema,
    content_hash: sha256ContentHashSchema,
    media_type: refSchema,
    description: textSchema,
  })
  .strict()

export type DataArtifact = zod.infer<typeof dataArtifactSchema>

// ---------------------------------------------------------------------------
// RequirementSpec
// ---------------------------------------------------------------------------

/**
 * Closed set of requirement kinds. A Requirement is either a SUBPROBLEM
 * (a part of the question that needs its own answer), a REQUIRED_OUTPUT
 * (a deliverable the solver must produce), or a CONSTRAINT (a property the
 * answer must satisfy). The closed set is what makes "the paper quietly
 * added a fourth kind of requirement" structurally impossible (attack
 * C-002 / INV-1.5-A).
 */
export const REQUIREMENT_TYPES = ['SUBPROBLEM', 'REQUIRED_OUTPUT', 'CONSTRAINT'] as const
export type RequirementType = (typeof REQUIREMENT_TYPES)[number]

export const requirementSpecSchema = zod
  .object({
    requirement_id: idSchema,
    // The data artifact this requirement was extracted from. Almost always
    // the RAW_PROBLEM; the cross-check that ProblemSpec.raw_problem_ref and
    // RequirementSpec.source_data_ref agree lives in
    // {@link problemContractGuards}.
    source_data_ref: refSchema,
    requirement_type: zod.enum(REQUIREMENT_TYPES),
    statement: textSchema,
  })
  .strict()

export type RequirementSpec = zod.infer<typeof requirementSpecSchema>

// ---------------------------------------------------------------------------
// SymbolSpec
// ---------------------------------------------------------------------------

/**
 * Closed set of symbol roles. A `VARIABLE` is a quantity the model solves
 * for; a `PARAMETER` is a fixed quantity the model consumes. The two are
 * not interchangeable: a ModelSpec.variable_refs must point at VARIABLEs,
 * and a ModelSpec.parameter_refs at PARAMETERs. The check is in
 * {@link problemContractGuards}; the schema only carries the role so the
 * store knows which kind it admitted.
 */
export const SYMBOL_ROLES = ['VARIABLE', 'PARAMETER'] as const
export type SymbolRole = (typeof SYMBOL_ROLES)[number]

/**
 * A symbol token. Closed character set: no whitespace, no control / format /
 * surrogate / separator characters, and — like every other identifier in the
 * IR — required to be in Unicode NFC form.
 *
 * The NFC requirement is load-bearing, not cosmetic. Tokens are compared
 * byte-for-byte by {@link findDuplicateSymbolTokens}, and NFC is a *canonical*
 * form: two NFC strings are canonically equivalent if and only if they are
 * byte-identical. Without the requirement, `é` (U+00E9) and `é`
 * (`e` + U+0301) are two distinct tokens that a reader sees as one symbol, so
 * a single scope could hold two SymbolSpecs for "the same" symbol with
 * different meanings and the uniqueness guard would report nothing (red team
 * RT-D-01). Requiring NFC collapses canonical equivalence onto byte equality
 * and makes the existing check sound.
 *
 * NFC deliberately does not fold *compatibility* equivalents (fullwidth `ａ`
 * or Cyrillic `а` stay distinct from Latin `a`). That is the same policy the
 * IR already applies to object IDs, and folding it would need a confusable
 * table that is out of scope here — see `known-risks.md`.
 */
const symbolTokenSchema = zod
  .string()
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u, 'token must not contain control, format, surrogate or separator characters')
  .refine(v => v === v.normalize('NFC'), 'token must be in Unicode NFC form')

export const symbolSpecSchema = zod
  .object({
    symbol_id: idSchema,
    // The ProblemSpec this symbol lives in. Two SymbolSpecs in the same
    // scope may not share a token; cross-scope collisions are allowed because
    // the same physical quantity may legitimately appear in two problems.
    scope_ref: refSchema,
    token: symbolTokenSchema,
    meaning: textSchema,
    unit: refSchema,
    role: zod.enum(SYMBOL_ROLES),
  })
  .strict()

export type SymbolSpec = zod.infer<typeof symbolSpecSchema>

// ---------------------------------------------------------------------------
// Semantic guards
// ---------------------------------------------------------------------------

/**
 * Why a Problem Contract guard refused a valid-shape object.
 *
 * Closed set, so an attacker cannot invent a verdict; a missing value here is
 * a programming error in the guard.
 *
 * TASK 1.5R (PHASE 3): every `unresolved_reference` /
 * `reference_kind_mismatch` member that used to be produced here is removed.
 * The store's commit boundary owns existence + kind closure (refs.ts /
 * store.ts), so a bridge verdict can no longer observe a missing or
 * wrong-kind edge — any reference that survives into the snapshot resolved
 * with the right kind by construction. The bridge keeps the semantic
 * failures only (role / source / scope / uniqueness / minimum contract).
 */
export const PROBLEM_CONTRACT_FAILURE_KINDS = [
  'cross_source_requirement',
  'duplicate_symbol_token',
  'symbol_role_mismatch',
  'parameter_role_mismatch',
  'unbound_parameter_symbol',
  'unbound_variable_symbol',
  'unbound_requirement',
  'unbound_data_artifact',
  'missing_required_output_requirement',
] as const
export type ProblemContractFailureKind = (typeof PROBLEM_CONTRACT_FAILURE_KINDS)[number]

export interface ProblemContractProblem {
  readonly kind: ProblemContractFailureKind
  readonly path: string
  readonly reason: string
}

/** Kind resolver used by the guards. */
export type ProblemContractResolver = (ref: string) =>
  | { readonly kind: 'DataArtifact'; readonly role: DataArtifactRole }
  | { readonly kind: 'RequirementSpec'; readonly requirement_type: RequirementType }
  | { readonly kind: 'SymbolSpec'; readonly role: SymbolRole; readonly scope_ref: string }
  | { readonly kind: 'ProblemSpec' }
  | { readonly kind: 'ModelSpec' }
  | { readonly kind: 'RunArtifact' }
  | { readonly kind: 'Result' }
  | { readonly kind: 'Claim' }
  | { readonly kind: 'FigureSpec' }
  | undefined

/**
 * Validate the Problem Contract for one ProblemSpec and its dependents.
 *
 * Inputs are assumed to be already-schema-valid; the store runs the schema
 * first and only asks the guards about the survivors. Returns every problem
 * it finds so one ingest reports the whole closure rather than one error at
 * a time.
 *
 * TASK 1.5R (PHASE 3): the store's commit boundary owns reference existence
 * and kind closure, so every branch below is a *semantic* guard. A resolver
 * returning `undefined` (or a kind the guard does not expect) is treated as
 * an unbound semantic object, not as a structural failure.
 *
 * Closed policy (cannot be relaxed without editing this function):
 *   - ProblemSpec.raw_problem_ref MUST resolve to a DataArtifact with role
 *     RAW_PROBLEM (C-005). Store guarantees the DataArtifact kind, so the
 *     only failure left here is the role: a `role=INPUT_DATA` artifact
 *     bound as the raw problem is an unbound data artifact (R-014).
 *   - Every RequirementSpec referenced by `requirement_refs` MUST have a
 *     source_data_ref equal to the ProblemSpec's raw_problem_ref (C-004).
 *     Existence, kind, and non-empty refs are guaranteed by the store; the
 *     cross-source check is what remains (R-017).
 *   - Every SymbolSpec referenced by a ModelSpec.variable_refs MUST be a
 *     VARIABLE (C-012) and MUST live in the same ProblemSpec scope; kind is
 *     store-guaranteed (R-016).
 *   - Every SymbolSpec referenced by a ModelSpec.parameter_refs MUST be a
 *     PARAMETER (C-013) and MUST live in the same ProblemSpec scope.
 *   - Within a single ProblemSpec scope, SymbolSpec tokens are unique
 *     (C-010 / C-011).
 *   - RunArtifact.input_data_refs MUST resolve to a DataArtifact of role
 *     INPUT_DATA (C-008 / C-009); kind is store-guaranteed (R-015).
 *   - FigureSpec.data_refs are fully store-guaranteed (`Result | DataArtifact`
 *     is a closed target set in refs.ts); the bridge has no figure check at
 *     all (PHASE 3).
 *
 * The resolver is the only function that decides whether `ref` exists and
 * what kind it is; the guard never inspects IDs against an in-memory map of
 * its own, so the store's append-only invariant is not duplicated here.
 *
 * The bridge passes `requirementSpecs` so the cross-source check can read
 * each referenced RequirementSpec's `source_data_ref`. Without that, the
 * guard can only check the *kind* of `RequirementSpec.source_data_ref`,
 * not whether the ProblemSpec and the RequirementSpec agree on which
 * DataArtifact is the source of truth (C-004).
 */
export function validateProblemContract(input: {
  readonly problem: Readonly<Record<string, unknown>>
  readonly modelSpecs?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly runArtifacts?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly figureSpecs?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly requirementSpecs?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly resolve: ProblemContractResolver
}): ReadonlyArray<ProblemContractProblem> {
  const problems: ProblemContractProblem[] = []
  const { problem, modelSpecs = [], runArtifacts = [], figureSpecs = [], requirementSpecs = [], resolve } = input

  // ProblemSpec.raw_problem_ref MUST resolve to a DataArtifact with role
  // RAW_PROBLEM. C-005 / R-014. Existence and kind are guaranteed by the
  // store; a resolver miss would mean the store let an unclosed ref through,
  // which is impossible — reported as unbound rather than structural.
  const rawRef = problem['raw_problem_ref']
  if (typeof rawRef !== 'string' || rawRef.length === 0) {
    problems.push({
      kind: 'unbound_data_artifact',
      path: 'raw_problem_ref',
      reason: 'ProblemSpec.raw_problem_ref must be a non-empty string',
    })
  } else {
    const target = resolve(rawRef)
    if (target === undefined || target.kind !== 'DataArtifact') {
      // Unreachable via the canonical store: `raw_problem_ref` resolves at
      // commit time to a DataArtifact. Kept fail-closed (unbound, not
      // structural) so a resolver regression cannot turn into a PASS.
      problems.push({
        kind: 'unbound_data_artifact',
        path: 'raw_problem_ref',
        reason: `'${rawRef}' is not a RAW_PROBLEM DataArtifact`,
      })
    } else if (target.role !== 'RAW_PROBLEM') {
      // R-014: kind is right (DataArtifact), role is wrong. This is the
      // load-bearing semantic guard — store accepts, bridge blocks.
      problems.push({
        kind: 'unbound_data_artifact',
        path: 'raw_problem_ref',
        reason: `'${rawRef}' is a ${target.role} DataArtifact, expected RAW_PROBLEM`,
      })
    }
  }

  // Every requirement_ref MUST resolve to a RequirementSpec. C-002. Existence
  // and kind are store-guaranteed; this loop keeps the REQUIRED_OUTPUT
  // minimum-contract count and the cross-source check (R-017).
  const reqRefs = problem['requirement_refs']
  let declaresRequiredOutput = false
  if (!Array.isArray(reqRefs)) {
    problems.push({
      kind: 'unbound_requirement',
      path: 'requirement_refs',
      reason: 'ProblemSpec.requirement_refs must be an array',
    })
  } else {
    for (const ref of reqRefs) {
      if (typeof ref !== 'string' || ref.length === 0) {
        problems.push({
          kind: 'unbound_requirement',
          path: 'requirement_refs',
          reason: `requirement ref must be a non-empty string, got ${typeof ref}`,
        })
        continue
      }
      const target = resolve(ref)
      if (target === undefined || target.kind !== 'RequirementSpec') {
        // Unreachable via the canonical store: requirement_refs resolves at
        // commit time to a RequirementSpec. Fail-closed as unbound.
        problems.push({
          kind: 'unbound_requirement',
          path: `requirement_refs.${ref}`,
          reason: `'${ref}' is not a registered RequirementSpec`,
        })
      } else {
        if (target.requirement_type === 'REQUIRED_OUTPUT') declaresRequiredOutput = true
        // C-004: every RequirementSpec's source_data_ref must agree with
        // ProblemSpec.raw_problem_ref (the source of truth for what the
        // paper is solving). A Requirement extracted from a different
        // artifact is exactly the "switch the requirement text" attack
        // INV-1.5-A exists to prevent (R-017).
        const reqRecord = requirementSpecs.find(r => r['requirement_id'] === ref)
        const reqSource = reqRecord?.['source_data_ref']
        if (typeof reqSource === 'string' && reqSource !== rawRef) {
          problems.push({
            kind: 'cross_source_requirement',
            path: `requirement_refs.${ref}`,
            reason: `RequirementSpec '${ref}' source_data_ref='${reqSource}' disagrees with ProblemSpec.raw_problem_ref='${rawRef}'`,
          })
        }
      }
    }

    // RT-C-01: the ProblemSpec itself must declare what the problem asks
    // for. Counting REQUIRED_OUTPUT RequirementSpecs anywhere in the store
    // is not enough — a stray requirement that no ProblemSpec references
    // would satisfy the minimum contract while the declared problem asks
    // for nothing, which is the "silently change the problem being solved"
    // outcome in its purest form.
    if (!declaresRequiredOutput) {
      problems.push({
        kind: 'missing_required_output_requirement',
        path: 'requirement_refs',
        reason: 'ProblemSpec.requirement_refs must reference at least one RequirementSpec of type REQUIRED_OUTPUT',
      })
    }
  }

  // ModelSpec contracts: every variable_ref is a SymbolSpec VARIABLE; every
  // parameter_ref is a SymbolSpec PARAMETER. C-012 / C-013 / R-016.
  for (const failure of validateModelSpecSymbols(modelSpecs, resolve)) {
    problems.push(failure)
  }

  // RunArtifact contracts: every input_data_ref resolves to an INPUT_DATA
  // DataArtifact. C-008 / C-009 / R-015. Existence and kind are
  // store-guaranteed; the role check is the load-bearing semantic guard.
  for (const run of runArtifacts) {
    const runId = run['run_id']
    const inputDataRefs = run['input_data_refs']
    if (!Array.isArray(inputDataRefs)) {
      problems.push({
        kind: 'unbound_data_artifact',
        path: `RunArtifact.${runId}.input_data_refs`,
        reason: 'input_data_refs must be an array of DataArtifact references',
      })
      continue
    }
    for (const ref of inputDataRefs) {
      const target = resolve(ref)
      if (target === undefined || target.kind !== 'DataArtifact') {
        // Unreachable via the canonical store: input_data_refs resolves at
        // commit time to a DataArtifact. Fail-closed as unbound.
        problems.push({
          kind: 'unbound_data_artifact',
          path: `RunArtifact.${runId}.input_data_refs.${ref}`,
          reason: `'${ref}' is not a registered DataArtifact`,
        })
      } else if (target.role !== 'INPUT_DATA') {
        // R-015: kind is right (DataArtifact), role is wrong. A RAW_PROBLEM
        // artifact must not be reused as a run input (C-008).
        problems.push({
          kind: 'unbound_data_artifact',
          path: `RunArtifact.${runId}.input_data_refs.${ref}`,
          reason: `'${ref}' is a ${target.role} DataArtifact, expected INPUT_DATA`,
        })
      }
    }
  }

  // FigureSpec contracts: PHASE 3 — deleted entirely. The store's commit
  // boundary closes `data_refs` to the narrow `Result | DataArtifact` union
  // (refs.ts `IR_REF_FIELDS.FigureSpec`), so `unresolved_reference` and
  // `figure_target_not_union` were unreachable here. There is no semantic
  // guard left for figures: renderer policy is TASK 7, out of scope.
  void figureSpecs

  return problems
}

/**
 * Symbol contract for a batch of ModelSpecs: every `variable_ref` resolves to
 * a `VARIABLE` SymbolSpec, every `parameter_refs[].symbol_ref` resolves to a
 * `PARAMETER` SymbolSpec, and both are scoped to one of that ModelSpec's
 * `problem_refs`. C-012 / C-013.
 *
 * TASK 1.5R (PHASE 3): existence + kind closure moved to the store boundary,
 * so the guards below are purely semantic. A `variable_ref` pointing at a
 * SymbolSpec of role PARAMETER is `symbol_role_mismatch`; a SymbolSpec that
 * exists but lives in another problem's scope is `unbound_variable_symbol` /
 * `unbound_parameter_symbol`. Resolver misses are unreachable via the
 * canonical store (fail-closed as unbound, not structural).
 *
 * Exported separately from {@link validateProblemContract} because the
 * ProblemSpec walk hands it only the ModelSpecs a ProblemSpec claims, and a
 * ModelSpec whose `problem_refs` names no registered ProblemSpec is claimed by
 * nobody (red team RT-B-01). The bridge therefore calls this again for the
 * orphans — otherwise an unowned ModelSpec can use a PARAMETER as a
 * solved-for variable and reach delivery unchallenged.
 */
export function validateModelSpecSymbols(
  modelSpecs: ReadonlyArray<Readonly<Record<string, unknown>>>,
  resolve: ProblemContractResolver,
): ReadonlyArray<ProblemContractProblem> {
  const problems: ProblemContractProblem[] = []
  for (const model of modelSpecs) {
    const modelId = model['model_id']
    const modelScope = model['problem_refs']

    const variableRefs = model['variable_refs']
    if (Array.isArray(variableRefs)) {
      for (const ref of variableRefs) {
        const target = resolve(ref)
        if (target === undefined || target.kind !== 'SymbolSpec') {
          // Unreachable via the canonical store: variable_refs resolves at
          // commit time to a SymbolSpec. Fail-closed as unbound.
          problems.push({
            kind: 'unbound_variable_symbol',
            path: `ModelSpec.${modelId}.variable_refs.${ref}`,
            reason: `'${ref}' is not a registered SymbolSpec`,
          })
        } else if (target.role !== 'VARIABLE') {
          // R-016: kind is right (SymbolSpec), role is wrong. This is the
          // load-bearing semantic guard — store accepts, bridge blocks.
          problems.push({
            kind: 'symbol_role_mismatch',
            path: `ModelSpec.${modelId}.variable_refs.${ref}`,
            reason: `'${ref}' is a ${target.role} SymbolSpec, expected VARIABLE`,
          })
        } else if (!symbolScopeMatches(target, modelScope)) {
          problems.push({
            kind: 'unbound_variable_symbol',
            path: `ModelSpec.${modelId}.variable_refs.${ref}`,
            reason: `SymbolSpec '${ref}' is not scoped to any of ModelSpec.${modelId}.problem_refs`,
          })
        }
      }
    }

    const parameterRefs = model['parameter_refs']
    if (Array.isArray(parameterRefs)) {
      for (const entry of parameterRefs) {
        if (entry === null || typeof entry !== 'object') {
          problems.push({
            kind: 'unbound_parameter_symbol',
            path: `ModelSpec.${modelId}.parameter_refs`,
            reason: 'parameter_refs entry must be { symbol_ref, value }',
          })
          continue
        }
        const ref = (entry as Record<string, unknown>)['symbol_ref']
        if (typeof ref !== 'string') {
          problems.push({
            kind: 'unbound_parameter_symbol',
            path: `ModelSpec.${modelId}.parameter_refs`,
            reason: 'parameter_refs entry must declare symbol_ref string',
          })
          continue
        }
        const target = resolve(ref)
        if (target === undefined || target.kind !== 'SymbolSpec') {
          // Unreachable via the canonical store: parameter symbol_refs
          // resolve at commit time to a SymbolSpec. Fail-closed as unbound.
          problems.push({
            kind: 'unbound_parameter_symbol',
            path: `ModelSpec.${modelId}.parameter_refs.${ref}`,
            reason: `'${ref}' is not a registered SymbolSpec`,
          })
        } else if (target.role !== 'PARAMETER') {
          // R-016 (parameter side): kind is right (SymbolSpec), role is
          // wrong — store accepts, bridge blocks.
          problems.push({
            kind: 'parameter_role_mismatch',
            path: `ModelSpec.${modelId}.parameter_refs.${ref}`,
            reason: `'${ref}' is a ${target.role} SymbolSpec, expected PARAMETER`,
          })
        } else if (!symbolScopeMatches(target, modelScope)) {
          problems.push({
            kind: 'unbound_parameter_symbol',
            path: `ModelSpec.${modelId}.parameter_refs.${ref}`,
            reason: `SymbolSpec '${ref}' is not scoped to any of ModelSpec.${modelId}.problem_refs`,
          })
        }
      }
    }
  }
  return problems
}

/**
 * Same-scope SymbolSpec token uniqueness. The store cannot enforce this from
 * a single put() call because the closure may straddle many records. Run
 * this once after every batch of SymbolSpec ingests — the resolver-based
 * guards above do not cover it because they look one symbol at a time.
 *
 * Returns every duplicate token, one per offender, so the audit trail can
 * attribute the failure to the second occurrence (the first is presumed
 * legitimate).
 */
export function findDuplicateSymbolTokens(
  symbolSpecs: ReadonlyArray<Readonly<Record<string, unknown>>>,
): ReadonlyArray<{ readonly scope_ref: string; readonly token: string; readonly symbol_id: string }> {
  const seen = new Map<string, { readonly scope_ref: string; readonly token: string; readonly symbol_id: string }>()
  const duplicates: { scope_ref: string; token: string; symbol_id: string }[] = []
  for (const spec of symbolSpecs) {
    const id = spec['symbol_id']
    const scope = spec['scope_ref']
    const token = spec['token']
    if (typeof id !== 'string' || typeof scope !== 'string' || typeof token !== 'string') continue
    const key = `${scope}\u0000${token}`
    const prior = seen.get(key)
    if (prior !== undefined) {
      duplicates.push({ scope_ref: scope, token, symbol_id: id })
      continue
    }
    seen.set(key, { scope_ref: scope, token, symbol_id: id })
  }
  return duplicates
}

/**
 * Minimum Problem Contract obligation FORMAL and FAST must satisfy before
 * the bridge emits PASS.
 *
 * Required pieces (task book §9):
 *   - ≥1 DataArtifact with role RAW_PROBLEM
 *   - ≥1 ProblemSpec whose raw_problem_ref resolves to that DataArtifact
 *   - ≥1 RequirementSpec with type REQUIRED_OUTPUT
 *   - ≥1 SymbolSpec scoped to one of the ProblemSpecs
 *   - Every ModelSpec symbol ref resolves with the correct role
 *   - Every RunArtifact input_data_ref resolves to an INPUT_DATA DataArtifact
 *   - The existing Problem → Model → Run → Result → CRITICAL Claim backbone
 *
 * The set is intentionally conservative: adding a fourth mandatory element
 * belongs in a future task. Today the contract proves the minimum
 * semantic-closure invariant: the paper cannot reach delivery without
 * declaring the problem, the data the problem lives in, what the problem
 * asks for, and what its symbols mean.
 */
export interface MinimumProblemContract {
  readonly rawProblemDataArtifacts: ReadonlyArray<string>
  readonly inputDataArtifacts: ReadonlyArray<string>
  readonly problemSpecs: ReadonlyArray<string>
  readonly requirementSpecs: ReadonlyArray<string>
  readonly requiredOutputRequirements: ReadonlyArray<string>
  readonly symbolSpecs: ReadonlyArray<string>
}

export const EMPTY_MINIMUM_PROBLEM_CONTRACT: MinimumProblemContract = Object.freeze({
  rawProblemDataArtifacts: [],
  inputDataArtifacts: [],
  problemSpecs: [],
  requirementSpecs: [],
  requiredOutputRequirements: [],
  symbolSpecs: [],
})

export function minimumProblemContractSatisfied(contract: MinimumProblemContract): boolean {
  return contract.rawProblemDataArtifacts.length >= 1
    && contract.problemSpecs.length >= 1
    && contract.requiredOutputRequirements.length >= 1
    && contract.symbolSpecs.length >= 1
}

/**
 * Whether `symbol`'s scope_ref is among `modelScope` (a model may declare
 * multiple problem_refs; a symbol may live in any of them).
 */
function symbolScopeMatches(
  symbol: { readonly scope_ref: string },
  modelScope: unknown,
): boolean {
  if (!Array.isArray(modelScope)) return false
  return modelScope.includes(symbol.scope_ref)
}
