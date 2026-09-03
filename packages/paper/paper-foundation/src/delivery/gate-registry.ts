/**
 * Critical gate registry (TASK 3 repair 3.R2 / INV-3-K / INV-3-L).
 *
 * Single, audited dispatch for every critical gate. Producers register
 * at module init; the registry exposes one function — `buildDeliveryPolicy`
 * — that the executor MUST use to assemble the policy it hands to
 * `evaluateDelivery`. There is no path that produces a `GateRecord`
 * for a critical id that bypasses this registry, and there is no path
 * that omits a critical id from the policy without `evaluateDelivery`
 * reporting it as a failure.
 *
 * Producers that are not yet implemented are registered as
 * `UNIMPLEMENTED`; `evaluateDelivery` reports such a producer as
 * `producer_unimplemented` (a closed DeliveryFailure kind). This is
 * the explicit state: a gate that the registry knows but the
 * implementation does not — never a silent PASS.
 *
 * The frozen task book v1.0 §2.4 ("禁止第二套 gate 系统 / 禁止平行
 * 判定函数决定交付") is closed at the source by this module:
 *   - The executor no longer calls `irBridgeGate` or
 *     `executionProvenanceGate` directly. It calls
 *     `buildDeliveryPolicy` and then `evaluateDelivery`.
 *   - No `if (gate.status === 'PASS') return` in the delivery path.
 *   - A producer cannot be in `CRITICAL_GATE_IDS` and not registered
 *     here; the runner asserts this at module init.
 */
import { ModelingIr } from '../ir/store.ts'
import { computeStaleReport } from '../ir/stale.js'
import { executionProvenanceGate } from '../execution/audit.ts'
import { irBridgeGate, requiresIrBackbone } from '../ir/bridge.ts'
import { numericConsistencyFindings } from './numeric-consistency.ts'
import { referenceValidationFindings } from './reference-validation.ts'
import { executionGateFindings } from './execution-gate.ts'
import { requirementCoverageFindings } from './requirement-coverage.ts'
import { runtimeIntegrityFindings } from './runtime-integrity.ts'
import { figureConsistencyFindings } from './figure-consistency.ts'
import {
  CRITICAL_GATE_IDS,
  DEFAULT_REPLAY_MAX_AGE_MS,
  type DeliveryPolicy,
  type GateRecord,
} from './delivery-policy.ts'

export {
  CRITICAL_GATE_IDS,
  evaluateDelivery,
  type DeliveryDecision,
  type DeliveryFailure,
  type DeliveryPolicy,
  type GateRecord,
} from './delivery-policy.ts'

/** A gate producer is either a function or the literal UNIMPLEMENTED. */
export type GateProducer = ((mode: string, ir: ModelingIr) => GateRecord) | typeof UNIMPLEMENTED

export const UNIMPLEMENTED = Symbol.for('paper.UNIMPLEMENTED_GATE_PRODUCER')

interface RegisteredGate {
  readonly id: string
  readonly critical: boolean
  readonly producer: GateProducer
}

const registry = new Map<string, RegisteredGate>()

/** Register (or replace) one critical gate's producer. */
export function registerCriticalGate(
  id: string,
  producer: GateProducer,
): void {
  if (!CRITICAL_GATE_IDS.includes(id as (typeof CRITICAL_GATE_IDS)[number])) {
    throw new Error(
      `registerCriticalGate('${id}'): id is not in CRITICAL_GATE_IDS; refusing to register an off-list gate (INV-3-L)`,
    )
  }
  registry.set(id, { id, critical: true, producer })
}

/** Whether a critical gate has a real (non-UNIMPLEMENTED) producer. */
export function hasImplementedGate(id: string): boolean {
  const gate = registry.get(id)
  return gate !== undefined && gate.producer !== UNIMPLEMENTED
}

/** All registered critical gate ids (the contract subset of CRITICAL_GATE_IDS). */
export function registeredCriticalGateIds(): ReadonlyArray<string> {
  return [...registry.keys()].sort()
}

/**
 * Machine-readable implementation ledger (5.0-R / R2.2). Enumerates, in
 * CRITICAL_GATE_IDS order, whether each critical gate currently has a
 * real producer or is registered as UNIMPLEMENTED. `verify-report-state.mjs`
 * (RG-09) loads this to keep gate-report.json's `gates_impl` section in
 * lockstep with the code — "which gate is a stub" stops being prose.
 */
export function criticalGateImplementationReport(): ReadonlyArray<{
  readonly id: string
  readonly implementation: 'real' | 'unimplemented'
}> {
  return CRITICAL_GATE_IDS.map((id) => {
    const entry = registry.get(id)
    return {
      id,
      implementation: entry !== undefined && entry.producer !== UNIMPLEMENTED
        ? 'real'
        : 'unimplemented',
    }
  })
}

/**
 * Assert at module init that every member of CRITICAL_GATE_IDS is
 * registered — and that the registry never lies about being empty.
 * Importing `runRegistryStartupAssert` is enough to fail fast on
 * developer error: a critical id accidentally dropped from the
 * registry would be invisible to `evaluateDelivery`.
 */
export function runRegistryStartupAssert(): void {
  const missing: string[] = []
  for (const id of CRITICAL_GATE_IDS) {
    if (!registry.has(id)) missing.push(id)
  }
  if (missing.length > 0) {
    throw new Error(
      `CRITICAL_GATE_IDS has members not registered: [${missing.join(', ')}] (INV-3-L)`,
    )
  }
}

// ---------------------------------------------------------------------------
// Default registrations (module init)
// ---------------------------------------------------------------------------

registerCriticalGate('ir_canonicalization', (_mode, ir) =>
  irBridgeGate(ir, collectStoredClaims(ir), _mode, new Date().toISOString()))

/**
 * P1-1 (task book P1-1): the bridge's `claims` argument — every artifact
 * the workflow declares to be an IR object — is now read from the canonical
 * store instead of the hard-coded empty list the registry shipped with.
 * Claims enter the store only through the producer/capture doors, so a
 * store without claims (pre-P1 data paths) behaves exactly as before.
 */
function collectStoredClaims(ir: ModelingIr): ReadonlyArray<unknown> {
  return ir
    .list()
    .filter(record => record.kind === 'Claim')
    .map(record => record.value)
}

registerCriticalGate('provenance', (_mode, ir) =>
  executionProvenanceGate(ir, new Date().toISOString()))

// 5.0-R (R1-1 / A-2, author-delegated): the six producers that shipped as
// minimal "TASK 4.0 stub" functions always returned PASS regardless of the
// store (numeric_consistency did not even read `ir`). A critical gate that
// cannot fail is not a gate — it is a pretend-PASS (INV-3-O). Per the
// ratification record (artifacts/handoff/TASK-5.0-R/v1.1-ratification.md
// decision 1), all six are now registered as UNIMPLEMENTED so FORMAL/FAST
// delivery is BLOCKED with `producer_unimplemented` until P1 lands real
// semantics. EXPLORATORY stays exempt (mode-level design). stale_detection
// below is a REAL producer (computeStaleReport) and stays.
// P1: runtime_integrity is a REAL gate — every committed ExecutionRecord
// must carry well-formed runtime fingerprints/digests (the profile-readiness
// half is enforced upstream by assertRuntimeReady / runtimeProfileValid).
registerCriticalGate('runtime_integrity', (_mode, ir) => {
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { id: 'runtime_integrity', critical: true, status: 'BLOCKED', reason: 'no canonical store', observedAt: new Date().toISOString() }
  }
  const findings = runtimeIntegrityFindings(store)
  if (findings.length === 0) {
    return { id: 'runtime_integrity', critical: true, status: 'PASS', reason: 'captured runtime fingerprints are well-formed', observedAt: new Date().toISOString() }
  }
  const first = findings[0]!
  return {
    id: 'runtime_integrity', critical: true, status: 'BLOCKED',
    reason: `runtime integrity: ${findings.length} finding(s) (${first.kind}: ${first.reason})`,
    observedAt: new Date().toISOString(),
  }
})
registerCriticalGate('execution', (_mode, ir) => {
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { id: 'execution', critical: true, status: 'BLOCKED', reason: 'no canonical store', observedAt: new Date().toISOString() }
  }
  const findings = executionGateFindings(store)
  if (findings.length === 0) {
    return { id: 'execution', critical: true, status: 'PASS', reason: 'every CRITICAL claim chain reaches a captured, fresh run', observedAt: new Date().toISOString() }
  }
  const first = findings[0]!
  return {
    id: 'execution', critical: true, status: 'BLOCKED',
    reason: `execution gate: ${findings.length} finding(s) (${first.kind}: ${first.reason})`,
    observedAt: new Date().toISOString(),
  }
})
// P1-3: numeric_consistency is a REAL gate — it walks every NUMERIC Claim
// in the store and runs the claim-evidence semantic guards (exact value +
// unit equality, role binding; R1-3 frozen, no tolerance layer yet).
registerCriticalGate('numeric_consistency', (_mode, ir) => {
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { id: 'numeric_consistency', critical: true, status: 'BLOCKED', reason: 'no canonical store', observedAt: new Date().toISOString() }
  }
  const findings = numericConsistencyFindings(store)
  if (findings.length === 0) {
    return { id: 'numeric_consistency', critical: true, status: 'PASS', reason: 'no numeric inconsistency found', observedAt: new Date().toISOString() }
  }
  const first = findings[0]!
  return {
    id: 'numeric_consistency', critical: true, status: 'BLOCKED',
    reason: `numeric inconsistency: ${findings.length} finding(s) (${first.path}: ${first.reason})`,
    observedAt: new Date().toISOString(),
  }
})
registerCriticalGate('stale_detection', (_mode, ir) => {
  // TASK 3.5: walk the IR closure, derive STALE evidence (S-001..S-009),
  // and refuse delivery if any critical-chain run is STALE.
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { id: 'stale_detection', critical: true, status: 'BLOCKED', reason: 'no canonical store', observedAt: new Date().toISOString() }
  }
  const report = computeStaleReport(store)
  if (report.stale.length === 0) {
    return { id: 'stale_detection', critical: true, status: 'PASS', reason: 'no STALE evidence detected', observedAt: new Date().toISOString() }
  }
  return {
    id: 'stale_detection', critical: true, status: 'BLOCKED',
    reason: `stale: ${report.stale.length} finding(s) (${report.stale.slice(0, 3).map(s => s.id + ':' + s.reason).join(',')})`,
    observedAt: new Date().toISOString(),
  }
})
// P1-4: reference_validation is a REAL gate — an independent re-walk of
// every IR object's declared reference fields (the store closes refs at
// admission; the gate re-verifies per delivery).
registerCriticalGate('reference_validation', (_mode, ir) => {
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { id: 'reference_validation', critical: true, status: 'BLOCKED', reason: 'no canonical store', observedAt: new Date().toISOString() }
  }
  const findings = referenceValidationFindings(store)
  if (findings.length === 0) {
    return { id: 'reference_validation', critical: true, status: 'PASS', reason: 'all IR-internal references resolve', observedAt: new Date().toISOString() }
  }
  const first = findings[0]!
  return {
    id: 'reference_validation', critical: true, status: 'BLOCKED',
    reason: `reference validation: ${findings.length} finding(s) (${first.path}: ${first.reason})`,
    observedAt: new Date().toISOString(),
  }
})
// P1-4: requirement_coverage is a REAL gate (A7 v0 frozen) — every
// ProblemSpec's REQUIRED_OUTPUTs must be paid by distinct reaching CRITICAL
// results (fail-closed count bound).
registerCriticalGate('requirement_coverage', (_mode, ir) => {
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { id: 'requirement_coverage', critical: true, status: 'BLOCKED', reason: 'no canonical store', observedAt: new Date().toISOString() }
  }
  const findings = requirementCoverageFindings(store)
  if (findings.length === 0) {
    return { id: 'requirement_coverage', critical: true, status: 'PASS', reason: 'every REQUIRED_OUTPUT is covered (A7 v0)', observedAt: new Date().toISOString() }
  }
  const first = findings[0]!
  return {
    id: 'requirement_coverage', critical: true, status: 'BLOCKED',
    reason: `requirement coverage: ${findings.length} finding(s) (${first.requirementId}: ${first.reason})`,
    observedAt: new Date().toISOString(),
  }
})
// P1 (decision-log D3): figure gate is vacuously real until P2 — no FigureSpec
// means nothing to check (PASS); any FigureSpec is BLOCKED p2-pending (fail-closed).
registerCriticalGate('figure_data_consistency', (_mode, ir) => {
  const store = ModelingIr.snapshot(ir)
  if (store === null) {
    return { id: 'figure_data_consistency', critical: true, status: 'BLOCKED', reason: 'no canonical store', observedAt: new Date().toISOString() }
  }
  const findings = figureConsistencyFindings(store)
  if (findings.length === 0) {
    return { id: 'figure_data_consistency', critical: true, status: 'PASS', reason: 'no FigureSpec present (P2 defines figure semantics)', observedAt: new Date().toISOString() }
  }
  const first = findings[0]!
  return {
    id: 'figure_data_consistency', critical: true, status: 'BLOCKED',
    reason: `figure data consistency: ${findings.length} finding(s) (${first.figureId}: ${first.reason})`,
    observedAt: new Date().toISOString(),
  }
})

// Fail-fast at module init (INV-3-L).
runRegistryStartupAssert()

// ---------------------------------------------------------------------------
// The single, audited assembly path
// ---------------------------------------------------------------------------

/** Modes whose backbone is not required (TASK 1.25 / D8). */
export type RegistryMode = 'FORMAL' | 'FAST' | 'EXPLORATORY'

export interface BuildDeliveryPolicyInput {
  readonly mode: string
  readonly ir: ModelingIr
  readonly now?: () => string
  /**
   * Whether the runtime guard reports a readied profile (TASK 5.0.11).
   * The verdict belongs to the guard, which owns readiness; the registry
   * has no way to observe it, so the caller must state it.
   *
   * Omitting it is a **refusal, not a pass** (INV-3-O): a policy built
   * without being told the guard's state must not assert that the
   * profile was validated. The previous hardcoded `true` made
   * `evaluateDelivery`'s `runtime_profile_invalid` failure unreachable
   * from production — dead safety code, which is worse than no code
   * because it reads like coverage.
   */
  readonly runtimeProfileValid?: boolean
  /**
   * TASK 5.0.8 — the freshest replay evidence this delivery consumed
   * (`ExecutionAuditReport.replayed_at`), offered by the composition
   * that actually ran the replay. The registry never invents evidence:
   * when this is absent the policy carries NO replay obligation (see
   * the return wiring below), and when it is present the policy
   * enforces replay freshness fail-closed.
   */
  readonly replayEvidence?: { readonly replayedAt: string | null }
  /**
   * TASK 5.0.8 — the caller's replay-staleness window in milliseconds,
   * or `null` for the explicit no-requirement downgrade. Only consulted
   * when `replayEvidence` is present: a caller that declares a window
   * without evidence is refused by the policy (missing evidence is a
   * `replay_stale` failure). Omitted + evidence present → the
   * `DEFAULT_REPLAY_MAX_AGE_MS` (24h) window applies.
   */
  readonly deliveryReplayMaxAgeMs?: number | null
}

/**
 * The only function the executor may call to assemble a policy. It runs
 * each critical producer once, in CRITICAL_GATE_IDS order, attaches the
 * result to the policy, and returns a `DeliveryPolicy` that
 * `evaluateDelivery` knows how to interpret.
 *
 * Critical producers that return a non-critical gate are passed through
 * as-is: `evaluateDelivery`'s own criticality check (RT125C-01) catches
 * the downgraded attempt.
 */
export function buildDeliveryPolicy(input: BuildDeliveryPolicyInput): DeliveryPolicy {
  const mode = input.mode
  const ir = input.ir
  const now = input.now ?? (() => new Date().toISOString())

  // The backbone check (`requiresIrBackbone`) is a mode-level
  // precondition: EXPLORATORY does not need a critical backbone, and
  // an empty store in that mode is not a fail-closed violation. When
  // the backbone is NOT required, every critical gate is reported as
  // `PASS` with a reason that names the exemption — the registry
  // remains the single source of truth (no parallel paths) and
  // `evaluateDelivery` still does its critical-id presence check.
  const backboneRequired = requiresIrBackbone(mode)

  const gates: GateRecord[] = []
  for (const id of CRITICAL_GATE_IDS) {
    const entry = registry.get(id)
    if (entry === undefined) {
      // The startup assert makes this branch unreachable in production;
      // it is here so the type system stays sound.
      throw new Error(`CRITICAL_GATE_IDS member '${id}' not registered (INV-3-L)`)
    }
    if (entry.producer === UNIMPLEMENTED) {
      if (!backboneRequired) {
        gates.push({
          id, critical: true, status: 'PASS',
          reason: 'exempt: backbone not required for this mode',
          observedAt: now(),
        })
      } else {
        gates.push({
          id, critical: true, status: 'BLOCKED',
          reason: 'producer_unimplemented',
          observedAt: now(),
        })
      }
      continue
    }
    if (!backboneRequired) {
      // Match the contract: a backbone-less store in EXPLORATORY mode
      // does not wire real producers. The verdict is still PASS, but
      // the gate's own semantics get a deterministic reason.
      gates.push({
        id, critical: true, status: 'PASS',
        reason: 'exempt: backbone not required for this mode',
        observedAt: now(),
      })
      continue
    }
    gates.push(entry.producer(mode, ir))
  }

  return {
    mode: input.mode as 'FORMAL' | 'FAST' | 'EXPLORATORY',
    gates,
    // TASK 3.5 will populate these from the STALE engine. Until then
    // the policy fields are honest empty arrays — the canonical IR +
    // provenance checks do not need them, and the other 7 critical
    // gates are UNIMPLEMENTED so delivery is blocked at the registry
    // level anyway.
    staleArtifactIds: [],
    unresolvedReferenceIds: [],
    requiredOutputs: [],
    // TASK 5.0.11: supplied by the caller from the runtime guard's real
    // readiness state — never invented here. A caller that does not
    // pass it is declaring that it does not know, and "does not know"
    // is a refusal (see the field's docs on BuildDeliveryPolicyInput).
    runtimeProfileValid: input.runtimeProfileValid ?? false,
    // TASK 5.0.8: replay evidence is never invented either. A policy
    // built without `replayEvidence` carries no replay obligation
    // (`deliveryReplayMaxAgeMs: null`) — the executor's per-run path
    // performs no replay, and replay-freshness enforcement belongs to
    // the composition that ran the auditor and can offer the evidence.
    // The moment evidence is offered without an explicit window, the
    // 24h `DEFAULT_REPLAY_MAX_AGE_MS` applies, and missing/stale
    // evidence becomes a `replay_stale` refusal.
    replayedAt: input.replayEvidence?.replayedAt ?? null,
    deliveryReplayMaxAgeMs: input.replayEvidence === undefined
      ? null
      : ('deliveryReplayMaxAgeMs' in input ? input.deliveryReplayMaxAgeMs : DEFAULT_REPLAY_MAX_AGE_MS),
  }
}