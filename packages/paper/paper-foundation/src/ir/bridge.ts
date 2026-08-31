/**
 * Canonical IR Enforcement Bridge (TASK 1.25 + TASK 1.5).
 *
 * TASK 1 built a store that is genuinely hard to corrupt, and TASK 0 built a
 * delivery gate that is genuinely hard to skip. Neither mattered, because the
 * paper workflow never had to touch the IR: `WorkflowExecutor.deliver()` turns
 * model text straight into an `ArtifactRecord` and a manifest. "No illegal
 * object can enter canonical state" was true; "the paper must come from
 * canonical state" was not. That is a vacuous security property, and the
 * external advisor raised it as the project's P0 escape (`IR_CAN_BE_BYPASSED`).
 *
 * This module closes it with three checks, exposed as one ordinary critical
 * gate so that TASK 0's existing machinery enforces them (FAST cannot skip
 * critical gates; `promoter` is the only mint of a DeliverableArtifact):
 *
 *   INV-1.25-A **no fake IR** — anything the workflow claims to be an IR
 *     object must carry a canonical IR identity that resolves to a record of
 *     the claimed kind. A `{ type: 'claim', content: '...' }` text artifact
 *     can no longer pose as a Claim.
 *
 *   INV-1.25-B **no bypass** — in FORMAL and FAST mode, delivery requires a
 *     canonical IR backbone (Problem → Model → Run → Result → Claim, plus at
 *     least one CRITICAL claim). EXPLORATORY is exempt because no
 *     mathematical facts exist yet, but A still applies to it.
 *
 *   INV-1.5 *Canonical Problem Contract* (TASK 1.5) — in FORMAL and FAST
 *     mode, delivery additionally requires that the backbone objects form a
 *     closed Problem Contract: ≥1 RAW_PROBLEM `DataArtifact`, ≥1
 *     `ProblemSpec` whose `raw_problem_ref` resolves to it, ≥1
 *     `RequirementSpec` of type REQUIRED_OUTPUT, ≥1 `SymbolSpec`, and every
 *     `ModelSpec.variable_refs` / `ModelSpec.parameter_refs[].symbol_ref`
 *     resolves with the correct role to a `SymbolSpec` in the same problem
 *     scope. EXPLORATORY is still exempt from the *minimum* contract, but
 *     every individual ProblemContract object it declares must already be
 *     schema-valid and reference-consistent (the store guarantees both:
 *     TASK 1.5R closed every IR-internal reference at commit time).
 *
 * TASK 1.5R (PHASE 3): the bridge is no longer the first line of structural
 * reference validity. `ModelingIr.put()` refuses any missing or wrong-kind
 * IR-internal reference (refs.ts / store.ts), so the snapshot this bridge
 * reads cannot contain a dangling or wrong-kind edge. The bridge therefore
 * keeps only the *semantic* guards — DataArtifact roles (RAW_PROBLEM /
 * INPUT_DATA), SymbolSpec roles (VARIABLE / PARAMETER) + scope ownership,
 * Requirement source consistency, same-scope token uniqueness, and the
 * FORMAL/FAST minimum contract. It emits no `unresolved_reference` /
 * `reference_kind_mismatch` contract failure (those kinds are removed from
 * the contract failure set); the sole remaining `unresolved_reference` is
 * the total-failure sentinel in {@link evaluateIrBridge} when evaluation
 * itself faults.
 *
 * The bridge is a *reader* of the canonical store: it never mutates it and
 * never throws. Every entry point returns a decision.
 */

import { z as zod } from 'zod'
import { IR_KINDS, type IrKind } from './schema.ts'
import { ModelingIr, type IrObjectRecord } from './store.ts'
import { IR_CANONICALIZATION_GATE_ID } from '../delivery/delivery-policy.ts'
import type { GateRecord } from '../delivery/delivery-policy.ts'
import type { GateStatus } from '../delivery/delivery-policy.ts'
import {
  type DataArtifactRole,
  type MinimumProblemContract,
  EMPTY_MINIMUM_PROBLEM_CONTRACT,
  findDuplicateSymbolTokens,
  minimumProblemContractSatisfied,
  validateModelSpecSymbols,
  validateProblemContract,
  type ProblemContractResolver,
} from './problem-contract.ts'

/**
 * What a store that cannot prove its identity is treated as: nothing at all.
 * Blocking is the only safe reading of "I was handed something that claims to
 * be canonical state but is not".
 */
const EMPTY_SNAPSHOT: ReadonlyMap<string, IrObjectRecord> = new Map()

/** The gate this bridge reports through (single source: delivery policy). */
export { IR_CANONICALIZATION_GATE_ID }

/**
 * Workflow modes that may reach delivery **without** a canonical backbone.
 *
 * Only EXPLORATORY is exempt: it is the mode in which the model has not yet
 * committed to any mathematical fact, so demanding facts would be a category
 * error rather than a safety property. Everything else — including modes this
 * module has never heard of — requires the backbone. An unknown mode must fail
 * closed, never into the exempt branch.
 *
 * Comparison is case-insensitive on purpose. The project carries two mode
 * vocabularies: `RuntimeMode` (`'FORMAL' | 'FAST' | 'EXPLORATORY'`, used by
 * the runtime profile and preflight) and the persisted run mode
 * (`'fast' | 'strict'`, used by `WorkflowExecutor`). A case-sensitive check
 * silently exempted every legacy run and turned the whole bridge into a
 * no-op — an escape found by wiring the bridge into the executor, not by
 * reading the bridge.
 */
export const IR_BACKBONE_EXEMPT_MODES = ['EXPLORATORY'] as const
export type IrBackboneExemptMode = (typeof IR_BACKBONE_EXEMPT_MODES)[number]

/**
 * Whether `mode` must carry a canonical backbone to reach delivery.
 * @param mode - run mode in either vocabulary; unrecognised values require it.
 */
export function requiresIrBackbone(mode: string): boolean {
  const normalized = mode.trim().toUpperCase()
  return !(IR_BACKBONE_EXEMPT_MODES as ReadonlyArray<string>).includes(normalized)
}

/**
 * A workflow-level declaration that some artifact *is* an IR object.
 *
 * Closed: an unrecognised key is a hard failure. `ir_kind` comes from the
 * closed IR kind set, so a caller cannot invent a ninth kind that no gate
 * inspects.
 */
export const irClaimSchema = zod
  .object({
    artifact_id: zod.string().regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u),
    ir_kind: zod.enum(IR_KINDS),
    ir_ref: zod.string().regex(/^\S+$/),
  })
  .strict()

export type IrClaim = zod.infer<typeof irClaimSchema>

/** The minimal canonical backbone a delivered paper must be able to point at. */
export const IR_BACKBONE_KINDS = [
  'ProblemSpec',
  'ModelSpec',
  'RunArtifact',
  'Result',
  'Claim',
] as const satisfies ReadonlyArray<IrKind>

export type IrBackboneKind = (typeof IR_BACKBONE_KINDS)[number]

/** Why a claim was rejected. Closed set. */
export const IR_CLAIM_REJECTIONS = [
  'ir_ref_not_registered',
  'ir_kind_mismatch',
] as const
export type IrClaimRejection = (typeof IR_CLAIM_REJECTIONS)[number]

export interface IrClaimProblem {
  readonly artifact_id: string
  readonly ir_ref: string
  /**
   * The kind the workflow *claimed*, verbatim. Not narrowed to `IrKind`:
   * a malformed claim may name a kind that does not exist, and the audit
   * trail must record what was claimed, not a plausible substitute.
   */
  readonly ir_kind: string
  readonly rejection: IrClaimRejection
  /** The kind the ref actually resolved to, or `null` when it is missing. */
  readonly actual: IrKind | null
}

export interface IrBridgeDecision {
  readonly status: GateStatus
  readonly claimProblems: ReadonlyArray<IrClaimProblem>
  /** Backbone kinds with no canonical object, in `IR_BACKBONE_KINDS` order. */
  readonly missingBackbone: ReadonlyArray<IrBackboneKind>
  readonly missingCriticalClaim: boolean
  /**
   * TASK 1.5: per-element Problem Contract failures that survive the
   * shape-level guards. Cross-cutting contract failures (e.g. duplicate
   * symbol tokens) are reported here too, so the executor / auditor sees the
   * whole closure in one place rather than chasing failures across
   * validators.
   */
  readonly contractFailures: ReadonlyArray<ContractFailure>
  /** TASK 1.5: summary of the minimum Problem Contract pieces present. */
  readonly contract: MinimumProblemContract
  /** TASK 1.5: whether the minimum Problem Contract is satisfied. */
  readonly contractSatisfied: boolean
  /** Human-readable, stable, and safe to put in an audit record. */
  readonly reason: string
}

/**
 * TASK 1.5: a single Problem Contract failure surfaced by the bridge.
 *
 * The `kind` is drawn from {@link ProblemContractFailureKind}; the bridge
 * converts the path + reason into a stable audit record. `where` is one of
 * `'problem'`, `'model'`, `'run'`, `'figure'`, or `'global'` — the field
 * that the failure is anchored to — so a future audit UI can group errors
 * by source object without re-parsing the path string.
 */
export interface ContractFailure {
  readonly kind: import('./problem-contract.ts').ProblemContractFailureKind
  readonly path: string
  readonly reason: string
  readonly where: 'problem' | 'model' | 'run' | 'figure' | 'global'
}

/**
 * Evaluate the canonical-IR bridge for one delivery attempt.
 *
 * Total: never throws, never mutates `ir`.
 *
 * @param ir - the canonical store the workflow must have been writing to.
 * @param claims - every artifact the workflow declares to be an IR object.
 * @param mode - workflow mode; backbone is required in FORMAL and FAST only.
 */
export function evaluateIrBridge(
  ir: ModelingIr,
  claims: ReadonlyArray<unknown>,
  mode: string,
): IrBridgeDecision {
  // Totality: a throw here would surface as a crash in the executor, which is
  // neither a refusal nor auditable, and leaves the run stuck at `running`
  // (red team RT125A-04). Anything unexpected becomes BLOCKED instead.
  try {
    return evaluateInner(ir, claims, mode)
  } catch (error) {
    return {
      status: 'BLOCKED',
      claimProblems: [],
      missingBackbone: [...IR_BACKBONE_KINDS],
      missingCriticalClaim: true,
      contractFailures: [{ kind: 'unbound_data_artifact', path: '$', reason: 'bridge evaluation faulted', where: 'global' }],
      contract: EMPTY_MINIMUM_PROBLEM_CONTRACT,
      contractSatisfied: false,
      reason: `bridge evaluation faulted: ${error instanceof Error ? error.message : 'non-Error throw'}`,
    }
  }
}

function evaluateInner(
  ir: ModelingIr,
  claims: ReadonlyArray<unknown>,
  mode: string,
): IrBridgeDecision {
  // Read canonical state through the class, never through `ir.get()` /
  // `ir.list()`: both can be replaced on a genuine instance with
  // Object.defineProperty, or satisfied by a forged duck-typed object handed
  // over an untyped service slot (red team RT125A-01 / RT125A-02). A store
  // that cannot prove its identity is treated as empty — which blocks every
  // mode that requires a backbone.
  const store = ModelingIr.snapshot(ir) ?? EMPTY_SNAPSHOT

  const problems: IrClaimProblem[] = []

  for (const claim of claims) {
    const parsed = irClaimSchema.safeParse(claim)
    // A claim that is not even a well-formed claim cannot be an IR object.
    // Refuse it rather than skipping it: a malformed declaration is an
    // attempt to describe canonical state, not an absent one.
    if (!parsed.success) {
      problems.push({
        artifact_id: readArtifactId(claim),
        ir_ref: readRef(claim),
        ir_kind: readKind(claim),
        rejection: 'ir_ref_not_registered',
        actual: null,
      })
      continue
    }

    const record = store.get(parsed.data.ir_ref)
    if (record === undefined) {
      problems.push({
        artifact_id: parsed.data.artifact_id,
        ir_ref: parsed.data.ir_ref,
        ir_kind: parsed.data.ir_kind,
        rejection: 'ir_ref_not_registered',
        actual: null,
      })
      continue
    }
    if (record.kind !== parsed.data.ir_kind) {
      problems.push({
        artifact_id: parsed.data.artifact_id,
        ir_ref: parsed.data.ir_ref,
        ir_kind: parsed.data.ir_kind,
        rejection: 'ir_kind_mismatch',
        actual: record.kind,
      })
    }
  }

  const requiresBackbone = requiresIrBackbone(mode)
  const missingBackbone: IrBackboneKind[] = []
  let missingCriticalClaim = false

  if (requiresBackbone) {
    const counts = countKinds(store)
    for (const kind of IR_BACKBONE_KINDS) {
      if (counts.get(kind) === undefined) missingBackbone.push(kind)
    }
    missingCriticalClaim = !hasCriticalClaim(store)
  }

  // TASK 1.5: minimum Problem Contract + per-element guards. Run for every
  // mode — EXPLORATORY may have an empty contract, but every object it does
  // declare must already be schema-valid and reference-consistent (the store
  // guarantees both; the guards below only add the semantic checks).
  const contractReport = inspectProblemContract(store)
  const contractFailures = contractReport.failures
  const contract = contractReport.contract
  const contractSatisfied = minimumProblemContractSatisfied(contract)

  const ok = problems.length === 0
    && missingBackbone.length === 0
    && !missingCriticalClaim
    && contractFailures.length === 0
    && (!requiresBackbone || contractSatisfied)

  return {
    status: ok ? 'PASS' : 'BLOCKED',
    claimProblems: problems,
    missingBackbone,
    missingCriticalClaim,
    contractFailures,
    contract,
    contractSatisfied,
    reason: ok
      ? 'canonical IR bridge satisfied'
      : describe(problems, missingBackbone, missingCriticalClaim, contractFailures, contractSatisfied, requiresBackbone),
  }
}

/**
 * Render the bridge decision as the gate record TASK 0's delivery policy
 * consumes, so the IR requirement is enforced by the existing critical-gate
 * machinery rather than by a second, parallel gate system.
 */
export function irBridgeGate(
  ir: ModelingIr,
  claims: ReadonlyArray<unknown>,
  mode: string,
  observedAt: string,
): GateRecord {
  const decision = evaluateIrBridge(ir, claims, mode)
  return {
    id: IR_CANONICALIZATION_GATE_ID,
    status: decision.status,
    critical: true,
    reason: decision.reason,
    observedAt,
  }
}

function countKinds(store: ReadonlyMap<string, IrObjectRecord>): Map<IrKind, number> {
  const counts = new Map<IrKind, number>()
  for (const record of store.values()) {
    counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1)
  }
  return counts
}

function hasCriticalClaim(store: ReadonlyMap<string, IrObjectRecord>): boolean {
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as { criticality?: string }
    if (claim.criticality === 'CRITICAL') return true
  }
  return false
}

function describe(
  problems: ReadonlyArray<IrClaimProblem>,
  missingBackbone: ReadonlyArray<IrBackboneKind>,
  missingCriticalClaim: boolean,
  contractFailures: ReadonlyArray<ContractFailure>,
  contractSatisfied: boolean,
  requiresBackbone: boolean,
): string {
  const parts: string[] = []
  if (problems.length > 0) {
    parts.push(`${problems.length} unverifiable IR claim(s): ` + problems
      .map(p => `${p.artifact_id}->${p.ir_ref}(${p.rejection})`)
      .join(','))
  }
  if (missingBackbone.length > 0) parts.push(`missing IR backbone: ${missingBackbone.join(',')}`)
  if (missingCriticalClaim) parts.push('no CRITICAL claim in canonical IR')
  if (contractFailures.length > 0) {
    parts.push(`${contractFailures.length} Problem Contract failure(s): `
      + contractFailures.map(f => `${f.where}.${f.path}:${f.kind}`).join(','))
  }
  if (requiresBackbone && !contractSatisfied) {
    parts.push('minimum Problem Contract not satisfied (RAW_PROBLEM DataArtifact + REQUIRED_OUTPUT RequirementSpec + SymbolSpec)')
  }
  return parts.join('; ')
}

/**
 * Walk every ProblemSpec / ModelSpec / RunArtifact / FigureSpec in `store`
 * and produce:
 *   - the per-element failures reported by `validateProblemContract`, and
 *   - the summary {@link MinimumProblemContract} used by `contractSatisfied`.
 *
 * The contract is computed across the whole store rather than per put(),
 * because:
 *
 *   - `ProblemSpec.requirement_refs` references `RequirementSpec` records
 *     that may be ingested either before or after the ProblemSpec itself.
 *   - `ModelSpec.variable_refs` / `ModelSpec.parameter_refs[].symbol_ref`
 *     reference `SymbolSpec` records that likewise may arrive in any order.
 *
 * TASK 1.5R (PHASE 3): the store boundary (refs.ts / store.ts) owns
 * existence + kind closure for every reference, including `FigureSpec.data_refs`
 * (a closed `Result | DataArtifact` target set). The bridge owns only the
 * semantic walk below; there is deliberately no figure check left here.
 *
 * The bridge owns this walk because it is already the choke point that the
 * executor reaches before delivery. Putting it here means the store's
 * single-object put() does not need a "second pass" call site, and every
 * delivery attempt gets exactly one uniform audit view of the contract.
 */
function inspectProblemContract(
  store: ReadonlyMap<string, IrObjectRecord>,
): { failures: ReadonlyArray<ContractFailure>; contract: MinimumProblemContract } {
  const resolver = makeResolver(store)
  const problems: ContractFailure[] = []

  // Single source of truth for the minimum contract pieces present.
  const dataArtifactsByRole = new Map<DataArtifactRole, string[]>()
  const problemSpecIds: string[] = []
  const requirementSpecIds: string[] = []
  const requiredOutputRequirementIds: string[] = []
  const symbolSpecIds: string[] = []

  const problemsList = problemSpecIds // type-only alias to keep diff small

  // Bucket records by kind for the per-shape walks.
  const problemSpecs: Readonly<Record<string, unknown>>[] = []
  const modelSpecs: Readonly<Record<string, unknown>>[] = []
  const runArtifacts: Readonly<Record<string, unknown>>[] = []
  const symbolSpecs: Readonly<Record<string, unknown>>[] = []
  const requirementSpecs: Readonly<Record<string, unknown>>[] = []

  for (const record of store.values()) {
    switch (record.kind) {
      case 'DataArtifact':
        dataArtifactsByRole.set(record.value.role, [...(dataArtifactsByRole.get(record.value.role) ?? []), record.value.data_id])
        break
      case 'ProblemSpec':
        problemSpecs.push(record.value as Readonly<Record<string, unknown>>)
        problemSpecIds.push(record.value.problem_id)
        break
      case 'ModelSpec':
        modelSpecs.push(record.value as Readonly<Record<string, unknown>>)
        break
      case 'RunArtifact':
        runArtifacts.push(record.value as Readonly<Record<string, unknown>>)
        break
      case 'RequirementSpec':
        requirementSpecIds.push(record.value.requirement_id)
        if (record.value.requirement_type === 'REQUIRED_OUTPUT') {
          requiredOutputRequirementIds.push(record.value.requirement_id)
        }
        requirementSpecs.push(record.value as Readonly<Record<string, unknown>>)
        break
      case 'SymbolSpec':
        symbolSpecs.push(record.value as Readonly<Record<string, unknown>>)
        symbolSpecIds.push(record.value.symbol_id)
        break
    }
  }

  // Per-ProblemSpec guards. FigureSpecs are deliberately not passed: PHASE 3
  // removed the figure kind check (store closes `data_refs` to the narrow
  // union), and renderer policy is TASK 7.
  for (const problem of problemSpecs) {
    for (const failure of validateProblemContract({
      problem,
      modelSpecs: modelSpecs.filter(m => Array.isArray(m['problem_refs']) && (m['problem_refs'] as string[]).includes(problem['problem_id'] as string)),
      runArtifacts,
      requirementSpecs,
      resolve: resolver,
    })) {
      problems.push({ kind: failure.kind, path: failure.path, reason: failure.reason, where: 'problem' })
    }
  }

  // RT-B-01: a ModelSpec whose `problem_refs` names no registered ProblemSpec
  // is claimed by no ProblemSpec, so the walk above hands it to nobody and
  // every symbol guard is skipped. Validate the orphans explicitly — an
  // unowned model using a PARAMETER as a solved-for variable must not reach
  // delivery just because it declined to name a problem.
  const claimedModelIds = new Set(
    modelSpecs
      .filter(m => Array.isArray(m['problem_refs'])
        && (m['problem_refs'] as ReadonlyArray<unknown>).some(r => problemSpecIds.includes(r as string)))
      .map(m => String(m['model_id'])),
  )
  const orphanModelSpecs = modelSpecs.filter(m => !claimedModelIds.has(String(m['model_id'])))
  for (const failure of validateModelSpecSymbols(orphanModelSpecs, resolver)) {
    problems.push({ kind: failure.kind, path: failure.path, reason: failure.reason, where: 'model' })
  }

  // Cross-cutting: duplicate symbol tokens within the same scope.
  for (const dup of findDuplicateSymbolTokens(symbolSpecs)) {
    problems.push({
      kind: 'duplicate_symbol_token',
      path: `${dup.scope_ref}/${dup.token}`,
      reason: `SymbolSpec '${dup.symbol_id}' repeats token '${dup.token}' in scope '${dup.scope_ref}'`,
      where: 'global',
    })
  }

  // RT-C-01: the minimum contract binds its pieces to a ProblemSpec rather
  // than counting them across the store. A REQUIRED_OUTPUT that no ProblemSpec
  // references is not evidence that anybody declared what the problem asks
  // for, and a ProblemSpec that references no REQUIRED_OUTPUT has declared
  // nothing — crediting either would let an empty problem reach delivery
  // whenever some unrelated requirement happened to exist.
  const requiredOutputIds = new Set(
    requirementSpecs
      .filter(r => r['requirement_type'] === 'REQUIRED_OUTPUT')
      .map(r => String(r['requirement_id'])),
  )
  const boundRequirementIds = new Set<string>()
  const problemIdsDeclaringOutput = new Set<string>()
  for (const problem of problemSpecs) {
    const refs = problem['requirement_refs']
    if (!Array.isArray(refs)) continue
    let declaresOutput = false
    for (const ref of refs) {
      if (typeof ref !== 'string') continue
      boundRequirementIds.add(ref)
      if (requiredOutputIds.has(ref)) declaresOutput = true
    }
    if (declaresOutput) problemIdsDeclaringOutput.add(String(problem['problem_id']))
  }

  return {
    failures: problems,
    contract: {
      rawProblemDataArtifacts: dataArtifactsByRole.get('RAW_PROBLEM') ?? [],
      inputDataArtifacts: dataArtifactsByRole.get('INPUT_DATA') ?? [],
      problemSpecs: problemSpecIds.filter(id => problemIdsDeclaringOutput.has(id)),
      requirementSpecs: requirementSpecIds,
      requiredOutputRequirements: requiredOutputRequirementIds.filter(id => boundRequirementIds.has(id)),
      symbolSpecs: symbolSpecIds,
    },
  }
  // `problemsList` is a type-only alias used so `problemSpecIds` is part of
  // the contract while keeping the local list type narrow. Suppress the
  // unused-binding lint without disturbing the readers above.
  void problemsList
}

/**
 * Build a resolver that hands the contract guards a uniformly typed view of
 * every kind the guard understands. The resolver is *only* used by the
 * guards; it is not exposed outside the bridge.
 */
function makeResolver(store: ReadonlyMap<string, IrObjectRecord>): ProblemContractResolver {
  return (ref) => {
    const record = store.get(ref)
    if (record === undefined) return undefined
    switch (record.kind) {
      case 'DataArtifact':
        return { kind: 'DataArtifact', role: record.value.role }
      case 'RequirementSpec':
        return { kind: 'RequirementSpec', requirement_type: record.value.requirement_type }
      case 'SymbolSpec':
        return { kind: 'SymbolSpec', role: record.value.role, scope_ref: record.value.scope_ref }
      case 'ProblemSpec': return { kind: 'ProblemSpec' }
      case 'ModelSpec': return { kind: 'ModelSpec' }
      case 'RunArtifact': return { kind: 'RunArtifact' }
      case 'Result': return { kind: 'Result' }
      case 'Claim': return { kind: 'Claim' }
      case 'FigureSpec': return { kind: 'FigureSpec' }
      default:
        // Unreachable: the store only contains kinds in IR_KINDS, and all
        // eleven are covered above. Returning undefined makes the guard
        // report an unresolved reference rather than crashing the bridge.
        return undefined
    }
  }
}

/** Best-effort reads used only to name a malformed claim in the audit trail. */
function readArtifactId(claim: unknown): string {
  return readField(claim, 'artifact_id') ?? '<unreadable-artifact>'
}
function readRef(claim: unknown): string {
  return readField(claim, 'ir_ref') ?? '<unreadable-ref>'
}
function readKind(claim: unknown): string {
  return readField(claim, 'ir_kind') ?? '<unclaimed-kind>'
}

function readField(claim: unknown, field: string): string | null {
  if (claim === null || typeof claim !== 'object') return null
  const value = (claim as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}
