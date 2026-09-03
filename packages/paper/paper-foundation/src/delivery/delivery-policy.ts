/**
 * Paper delivery policy (TASK 0).
 *
 * The single, deterministic decision function the rest of the pipeline uses
 * to ask: "is it safe to deliver this artifact now?". The answer is
 * computed from the eight critical gates plus a handful of coverage /
 * freshness fields, with NO weighting and NO "soft pass".
 *
 * The contract enforced here is a closed list of reasons. Anything not on
 * the list does not appear in `failures` and does not block delivery, but
 * a `BLOCKED` decision is only possible if at least one item on the list
 * triggered — by design.
 *
 * Critical rules this module guarantees:
 *   - FAST mode can skip non-critical gates only.
 *   - FAST mode CANNOT skip any critical gate. Any attempt to express
 *     "skip critical under FAST" in this module is a TASK 0 violation.
 *   - `allowed` is a deterministic function of the inputs; no randomness,
 *     no I/O. The one clock in the module is the replay-staleness window
 *     (TASK 5.0.8), and it is an explicit input (`now`) with a real
 *     default, never a hidden read of the wall clock inside the verdict.
 */

import type { RuntimeMode } from '../runtime/profile.ts'

/** Closed gate-status set. No WARNING / MAYBE / LIKELY / PARTIAL. */
export const GATE_STATUSES = ['PASS', 'FAIL', 'BLOCKED'] as const
export type GateStatus = (typeof GATE_STATUSES)[number]

/**
 * Closed list of critical gate ids. Adding a new critical gate requires
 * editing this list AND threading it through the gate registry; that is
 * intentional — criticality is a slow-moving property, not a runtime knob.
 *
 * Note: this list mirrors the high-level categories in the v2 task book.
 * The actual gate ids in the runtime are dot-prefixed strings (e.g.
 * `gate.execution`); we accept any string for `id` and reserve the type
 * alias below for the closed set.
 */
/**
 * Gate id for the canonical-IR bridge (TASK 1.25).
 *
 * Declared here, next to the critical list it joins, rather than in
 * `ir/bridge.ts`: the bridge already imports this module for `GateRecord`,
 * and a constant that lives in only one place cannot drift.
 */
export const IR_CANONICALIZATION_GATE_ID = 'ir_canonicalization'

/**
 * Gate id for the execution provenance gate (TASK 3).
 *
 * The id was already reserved in the critical list below; TASK 3 gives
 * it its producer: `src/execution/audit.ts`. Declared here, next to the
 * critical list it joins, for the same single-source reason as
 * `IR_CANONICALIZATION_GATE_ID`.
 */
export const PROVENANCE_GATE_ID = 'provenance'

export const CRITICAL_GATE_IDS = [
  'runtime_integrity',
  'execution',
  PROVENANCE_GATE_ID,
  IR_CANONICALIZATION_GATE_ID,
  'numeric_consistency',
  'stale_detection',
  'reference_validation',
  'requirement_coverage',
  'figure_data_consistency',
] as const

export type CriticalGateId = (typeof CRITICAL_GATE_IDS)[number]

/**
 * TASK 5.0.8 — the default replay-staleness window (24h).
 *
 * The task book offered "24h default" or "explicit declaration downgrade"
 * for the `delivery_replay_max_age` policy (handoff §8.3). This module
 * implements both halves: a policy built without a declared max age gets
 * this default (fail-closed), and a caller may explicitly declare
 * `deliveryReplayMaxAgeMs: null` to waive the requirement (the
 * downgrade) or a different number to override it.
 */
export const DEFAULT_REPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface GateRecord {
  readonly id: string
  readonly status: GateStatus
  readonly critical: boolean
  readonly reason?: string
  readonly observedAt: string
}

/**
 * Required-output coverage entry. `covered: false` blocks delivery with a
 * `required_output_missing` failure for `id`.
 */
export interface RequiredOutput {
  readonly id: string
  readonly covered: boolean
}

export interface DeliveryPolicy {
  readonly mode: RuntimeMode
  readonly gates: ReadonlyArray<GateRecord>
  readonly staleArtifactIds: ReadonlyArray<string>
  readonly unresolvedReferenceIds: ReadonlyArray<string>
  readonly requiredOutputs: ReadonlyArray<RequiredOutput>
  readonly runtimeProfileValid: boolean
  /**
   * TASK 5.0.8 — the freshest replay evidence this delivery consumed
   * (`ExecutionAuditReport.replayed_at`), or `null` when no replay ran.
   * `null` is a fact, not a waiver: whether `null` blocks delivery is
   * decided by `deliveryReplayMaxAgeMs`.
   */
  readonly replayedAt: string | null
  /**
   * TASK 5.0.8 — the maximum allowed age of replay evidence in
   * milliseconds. `null` is the explicit-declaration downgrade: the
   * policy declares NO replay-staleness requirement. Any non-null value
   * makes `evaluateDelivery` fail-closed on missing or stale replay
   * evidence (`replay_stale`).
   */
  readonly deliveryReplayMaxAgeMs: number | null
}

export interface DeliveryFailure {
  readonly kind: string
  readonly reason: string
}

export interface DeliveryDecision {
  readonly allowed: boolean
  readonly failures: ReadonlyArray<DeliveryFailure>
}

/**
 * Evaluate whether `policy` allows delivery.
 *
 * Rules (applied in order, all-or-nothing):
 *   1. Every gate with `critical: true` must have `status === 'PASS'`. If
 *      a non-PASS critical gate is missing, that itself is a failure
 *      (BLOCKED on the missing gate).
 *   2. `staleArtifactIds` must be empty.
 *   3. `unresolvedReferenceIds` must be empty.
 *   4. Every entry in `requiredOutputs` must have `covered: true`.
 *   5. `runtimeProfileValid` must be `true`.
 *   6. (TASK 5.0.8) When `deliveryReplayMaxAgeMs` is non-null, replay
 *      evidence (`replayedAt`) must exist and be younger than the
 *      window; otherwise `replay_stale` blocks delivery. `null` window
 *      is the explicit no-requirement downgrade.
 *
 * FAST mode only changes which non-critical gates are considered; the
 * `critical` filter above is mode-independent.
 *
 * @param policy - the policy to judge.
 * @param nowMs - injected clock for the replay-staleness rule. The
 *   verdict is otherwise a pure function of its inputs; passing a fixed
 *   time makes it deterministic in tests. Production omits it and the
 *   wall clock is read exactly once, for the staleness rule only.
 */
export function evaluateDelivery(policy: DeliveryPolicy, nowMs?: number): DeliveryDecision {
  const failures: DeliveryFailure[] = []

  // 1a. Missing critical gate check. The loop below can only reject gates it
  // was handed, so a caller that simply omitted `ir_canonicalization` was
  // approved — the contract already promised "if a non-PASS critical gate is
  // missing, that itself is a failure", but nothing enforced it. Presence is
  // now checked explicitly (TASK 1.25, INV-1.25-C).
  //
  // Presence is not just "an entry with this id exists". Red team RT125C-01
  // showed that `{id: 'ir_canonicalization', status: 'PASS', critical: false}`
  // satisfies an id-only check and is then skipped by the `critical` filter in
  // step 1b — a forged gate that both silences the missing-gate failure and
  // escapes the status check. A critical id must therefore be present *as a
  // critical gate*, and a downgraded one is itself a failure.
  const byId = new Map<string, GateRecord[]>()
  for (const gate of policy.gates) {
    const bucket = byId.get(gate.id)
    if (bucket === undefined) byId.set(gate.id, [gate])
    else bucket.push(gate)
  }
  for (const [id, gates] of byId) {
    if (gates.length > 1) {
      // Two entries for one gate id: which one wins depends on array order,
      // so the verdict would be the caller's to pick (RT125C-03).
      failures.push({ kind: 'duplicate_gate_id', reason: id })
    }
  }
  for (const id of CRITICAL_GATE_IDS) {
    const gates = byId.get(id)
    if (gates === undefined || gates.length === 0) {
      failures.push({ kind: 'critical_gate_missing', reason: id })
      continue
    }
    if (!gates.some(gate => gate.critical)) {
      failures.push({ kind: 'critical_gate_downgraded', reason: id })
    }
  }

  // 1b. Critical gate check (mode-independent; FAST does NOT skip this).
  for (const gate of policy.gates) {
    if (!gate.critical) continue
    if (gate.status === 'PASS') continue
    failures.push({
      kind: 'critical_gate',
      reason: `${gate.id}:${gate.status}${gate.reason ? `:${gate.reason}` : ''}`,
    })
  }

  // 2. Stale artifacts.
  for (const id of policy.staleArtifactIds) {
    failures.push({ kind: 'stale', reason: id })
  }

  // 3. Unresolved references.
  for (const ref of policy.unresolvedReferenceIds) {
    failures.push({ kind: 'unresolved_ref', reason: ref })
  }

  // 4. Required outputs.
  for (const out of policy.requiredOutputs) {
    if (!out.covered) {
      failures.push({ kind: 'required_output_missing', reason: out.id })
    }
  }

  // 5. Runtime profile validity.
  if (!policy.runtimeProfileValid) {
    failures.push({ kind: 'runtime_profile_invalid', reason: 'profile not valid' })
  }

  // 6. Replay staleness (TASK 5.0.8). A null window is the explicit
  //    no-requirement downgrade; any non-null window makes replay
  //    evidence mandatory AND fresh. Missing evidence is a refusal —
  //    a delivery that consumed no replay must never be treated as
  //    "within the window" by accident. The single clock read of the
  //    verdict happens here, once, from the injected `nowMs`.
  if (policy.deliveryReplayMaxAgeMs !== null) {
    if (policy.replayedAt === null) {
      failures.push({ kind: 'replay_stale', reason: 'no replay evidence (replayedAt is null)' })
    } else {
      const ageMs = (nowMs ?? Date.now()) - Date.parse(policy.replayedAt)
      if (!Number.isFinite(ageMs) || ageMs > policy.deliveryReplayMaxAgeMs) {
        failures.push({
          kind: 'replay_stale',
          reason: `replay evidence at ${policy.replayedAt} is older than the declared ${policy.deliveryReplayMaxAgeMs}ms window`,
        })
      }
    }
  }

  return { allowed: failures.length === 0, failures }
}

/**
 * Check whether a non-critical gate would be evaluated under `mode`. Used
 * by gate producers to decide whether to skip producing a non-critical
 * record in FAST mode. The decision function does NOT consult this — it
 * treats all critical gates as mandatory regardless of mode.
 *
 * Exported for symmetry and to make the FAST contract grep-able; the
 * promoter does not depend on it.
 */
export function isNonCriticalGateSkippableInMode(
  gate: GateRecord,
  mode: RuntimeMode,
): boolean {
  if (gate.critical) return false
  return mode === 'FAST'
}
