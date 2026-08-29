/**
 * Canonical IR Enforcement Bridge (TASK 1.25).
 *
 * TASK 1 built a store that is genuinely hard to corrupt, and TASK 0 built a
 * delivery gate that is genuinely hard to skip. Neither mattered, because the
 * paper workflow never had to touch the IR: `WorkflowExecutor.deliver()` turns
 * model text straight into an `ArtifactRecord` and a manifest. "No illegal
 * object can enter canonical state" was true; "the paper must come from
 * canonical state" was not. That is a vacuous security property, and the
 * external advisor raised it as the project's P0 escape (`IR_CAN_BE_BYPASSED`).
 *
 * This module closes it with two checks, exposed as one ordinary critical gate
 * so that TASK 0's existing machinery enforces them (FAST cannot skip
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
 * The bridge is a *reader* of the canonical store: it never mutates it and
 * never throws. Every entry point returns a decision.
 */

import { z as zod } from 'zod'
import { IR_KINDS, type IrKind } from './schema.ts'
import { ModelingIr, type IrObjectRecord } from './store.ts'
import { IR_CANONICALIZATION_GATE_ID } from '../delivery/delivery-policy.ts'
import type { GateRecord } from '../delivery/delivery-policy.ts'
import type { GateStatus } from '../delivery/delivery-policy.ts'

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
  /** Human-readable, stable, and safe to put in an audit record. */
  readonly reason: string
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

  const ok = problems.length === 0 && missingBackbone.length === 0 && !missingCriticalClaim
  return {
    status: ok ? 'PASS' : 'BLOCKED',
    claimProblems: problems,
    missingBackbone,
    missingCriticalClaim,
    reason: ok ? 'canonical IR bridge satisfied' : describe(problems, missingBackbone, missingCriticalClaim),
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
): string {
  const parts: string[] = []
  if (problems.length > 0) {
    parts.push(`${problems.length} unverifiable IR claim(s): ` + problems
      .map(p => `${p.artifact_id}->${p.ir_ref}(${p.rejection})`)
      .join(','))
  }
  if (missingBackbone.length > 0) parts.push(`missing IR backbone: ${missingBackbone.join(',')}`)
  if (missingCriticalClaim) parts.push('no CRITICAL claim in canonical IR')
  return parts.join('; ')
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
