/**
 * TASK 1.25 — Canonical IR Enforcement Bridge.
 *
 * The escape this closes is architectural, not a schema bug: the paper
 * workflow could reach Deliverable while `ModelingIr` was empty, because
 * `WorkflowExecutor.deliver()` turns model text straight into a manifest.
 * These tests drive the *real* bridge, the *real* delivery policy and the
 * *real* promoter together, so "workflow ignores the IR" is exercised as one
 * end-to-end attempt rather than as three isolated units.
 */

import { describe, expect, it } from 'vitest'
import {
  IR_BACKBONE_KINDS,
  IR_KINDS,
  ModelingIr,
  evaluateIrBridge,
  irBridgeGate,
  irClaimSchema,
} from '../../src/ir/index.ts'
import {
  CRITICAL_GATE_IDS,
  IR_CANONICALIZATION_GATE_ID,
  evaluateDelivery,
  makeCandidateArtifact,
  promoteCandidateToDeliverable,
  type DeliveryPolicy,
  type GateRecord,
} from '../../src/delivery/index.ts'
import { chainThrough, claim, modelClaim, modelSpec, problemSpec, result } from './fixtures.ts'

const AT = '2026-08-29T00:00:00.000Z'

/** A store holding the full legal chain: Problem → Model → Run → Result → Claim. */
function fullIr(): ModelingIr {
  const ir = new ModelingIr({ now: () => AT })
  for (const entry of chainThrough('Claim')) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

/** Every critical gate PASS except `ir_canonicalization`, which comes from the bridge. */
function policyWith(
  ir: ModelingIr,
  mode: 'FORMAL' | 'FAST' | 'EXPLORATORY',
  claims: ReadonlyArray<unknown> = [],
): DeliveryPolicy {
  const gates: GateRecord[] = CRITICAL_GATE_IDS
    .filter(id => id !== IR_CANONICALIZATION_GATE_ID)
    .map(id => ({ id, status: 'PASS', critical: true, observedAt: AT }))
  gates.push(irBridgeGate(ir, claims, mode, AT))
  return {
    mode,
    gates,
    staleArtifactIds: [],
    unresolvedReferenceIds: [],
    requiredOutputs: [],
    runtimeProfileValid: true,
    replayedAt: null,
    deliveryReplayMaxAgeMs: null,
  }
}

async function attemptDelivery(ir: ModelingIr, mode: 'FORMAL' | 'FAST' | 'EXPLORATORY', claims: ReadonlyArray<unknown> = []) {
  const policy = policyWith(ir, mode, claims)
  const decision = evaluateDelivery(policy)
  const candidate = makeCandidateArtifact({
    id: 'paper-1',
    createdAt: AT,
    contentHash: 'sha256:paper',
  })
  const writes: string[] = []
  const promoted = await promoteCandidateToDeliverable(
    candidate,
    policy,
    decision,
    { audit: () => {}, now: () => AT, writeFinalOutput: async (p, c) => { writes.push(`${p}:${c}`) } },
    '/tmp/paper.pdf',
    'final paper text',
  )
  return { decision, promoted, writes }
}

describe('INV-1.25-B — the workflow cannot reach Deliverable without canonical IR', () => {
  it('blocks delivery in FORMAL mode when the IR is empty', async () => {
    const { decision, promoted, writes } = await attemptDelivery(new ModelingIr(), 'FORMAL')
    expect(decision.allowed).toBe(false)
    expect(decision.failures.map(f => f.kind)).toContain('critical_gate')
    expect(decision.failures.some(f => f.reason.includes(IR_CANONICALIZATION_GATE_ID))).toBe(true)
    expect(promoted.ok).toBe(false)
    expect(writes).toEqual([])
  })

  it('blocks delivery in FAST mode too — critical gates are not skippable', async () => {
    const { decision, promoted } = await attemptDelivery(new ModelingIr(), 'FAST')
    expect(decision.allowed).toBe(false)
    expect(promoted.ok).toBe(false)
  })

  it('does not block EXPLORATORY, where no mathematical fact exists yet', async () => {
    const { decision, promoted } = await attemptDelivery(new ModelingIr(), 'EXPLORATORY')
    expect(decision.allowed).toBe(true)
    expect(promoted.ok).toBe(true)
  })

  it('names every missing backbone kind', () => {
    const decision = evaluateIrBridge(new ModelingIr(), [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.missingBackbone).toEqual([...IR_BACKBONE_KINDS])
    expect(decision.missingCriticalClaim).toBe(true)
  })

  it('blocks when only part of the backbone is present', () => {
    const ir = new ModelingIr({ now: () => AT })
    // Pre-register the dependencies ProblemSpec / ModelSpec now require
    // (TASK 1.5R). The test still asserts what it always did: a partial
    // backbone of Problem + Model leaves Run / Result / Claim missing.
    for (const entry of chainThrough('ModelSpec')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.missingBackbone).toEqual(['RunArtifact', 'Result', 'Claim'])
    expect(decision.status).toBe('BLOCKED')
  })

  it('blocks when the backbone is present but no claim is CRITICAL', () => {
    // TASK 3 repair (3.R1): a NUMERIC claim can no longer declare
    // NON_CRITICAL, so to test the backbone-without-critical-claim branch
    // we use a MODEL claim (which the new contract allows to be
    // NON_CRITICAL with a rationale). The canonical-IR bridge still
    // blocks on `missingCriticalClaim`.
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', modelClaim({
      claim_id: 'C-NC', criticality: 'NON_CRITICAL', criticality_rationale: 'draft',
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.missingBackbone).toEqual([])
    expect(decision.missingCriticalClaim).toBe(true)
    expect(decision.status).toBe('BLOCKED')
  })

  it('allows delivery once the canonical backbone exists', async () => {
    const { decision, promoted, writes } = await attemptDelivery(fullIr(), 'FORMAL')
    expect(decision.allowed).toBe(true)
    expect(promoted.ok).toBe(true)
    if (promoted.ok) expect(promoted.artifact.state).toBe('DELIVERABLE')
    expect(writes).toHaveLength(1)
  })
})

describe('INV-1.25-A — a text artifact cannot pose as an IR object', () => {
  it('accepts a claim whose ir_ref resolves to the claimed kind', () => {
    const ir = fullIr()
    const decision = evaluateIrBridge(ir, [
      { artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'RES1' },
    ], 'FORMAL')
    expect(decision.claimProblems).toEqual([])
    expect(decision.status).toBe('PASS')
  })

  it('rejects a claim whose ir_ref was never registered', () => {
    const ir = fullIr()
    const decision = evaluateIrBridge(ir, [
      { artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'RES-GHOST' },
    ], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.claimProblems[0]).toMatchObject({
      ir_ref: 'RES-GHOST',
      rejection: 'ir_ref_not_registered',
      actual: null,
    })
  })

  it('rejects a claim that names a real object of the wrong kind', () => {
    const ir = fullIr()
    // RES1 exists, but it is a Result, not a Claim.
    const decision = evaluateIrBridge(ir, [
      { artifact_id: 'A1', ir_kind: 'Claim', ir_ref: 'RES1' },
    ], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.claimProblems[0]).toMatchObject({
      rejection: 'ir_kind_mismatch',
      actual: 'Result',
    })
  })

  it('rejects a hand-rolled "claim" that is really a text blob', () => {
    const ir = fullIr()
    const decision = evaluateIrBridge(ir, [
      { type: 'claim', content: 'the answer is 0.731' },
    ], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.claimProblems).toHaveLength(1)
  })

  it('rejects a malformed claim without throwing', () => {
    const ir = fullIr()
    for (const bad of [null, 'RES1', 42, [], {}, { artifact_id: 'A1' }]) {
      expect(() => evaluateIrBridge(ir, [bad], 'FORMAL')).not.toThrow()
      expect(evaluateIrBridge(ir, [bad], 'FORMAL').status).toBe('BLOCKED')
    }
  })

  it('rejects a claim with an invented ir_kind', () => {
    expect(irClaimSchema.safeParse({ artifact_id: 'A1', ir_kind: 'Vibes', ir_ref: 'X' }).success).toBe(false)
    // The closed kind set is the same one the store enforces.
    expect(IR_KINDS).not.toContain('Vibes')
  })

  it('rejects a claim with extra keys', () => {
    const parsed = irClaimSchema.safeParse({
      artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'RES1', trust_me: true,
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]!.code).toBe('unrecognized_keys')
  })

  it('reports every bad claim, not just the first', () => {
    const ir = fullIr()
    const decision = evaluateIrBridge(ir, [
      { artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'GHOST-1' },
      { artifact_id: 'A2', ir_kind: 'Claim', ir_ref: 'RES1' },
      { artifact_id: 'A3', ir_kind: 'Result', ir_ref: 'GHOST-2' },
    ], 'FORMAL')
    expect(decision.claimProblems).toHaveLength(3)
    expect(decision.claimProblems.map(p => p.artifact_id)).toEqual(['A1', 'A2', 'A3'])
  })

  it('blocks promotion when any claim is unverifiable, even with a full backbone', async () => {
    const { decision, promoted } = await attemptDelivery(fullIr(), 'FORMAL', [
      { artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'GHOST' },
    ])
    expect(decision.allowed).toBe(false)
    expect(promoted.ok).toBe(false)
  })
})

describe('INV-1.25-C — a critical gate cannot be omitted to pass', () => {
  it('blocks delivery when ir_canonicalization is simply not passed', () => {
    const policy: DeliveryPolicy = {
      mode: 'FORMAL',
      gates: CRITICAL_GATE_IDS
        .filter(id => id !== IR_CANONICALIZATION_GATE_ID)
        .map(id => ({ id, status: 'PASS', critical: true, observedAt: AT })),
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
      replayedAt: null,
      deliveryReplayMaxAgeMs: null,
    }
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures).toContainEqual({
      kind: 'critical_gate_missing',
      reason: IR_CANONICALIZATION_GATE_ID,
    })
  })

  it('blocks when every critical gate is omitted', () => {
    const decision = evaluateDelivery({
      mode: 'FORMAL',
      gates: [],
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
      replayedAt: null,
      deliveryReplayMaxAgeMs: null,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.failures.filter(f => f.kind === 'critical_gate_missing')).toHaveLength(
      CRITICAL_GATE_IDS.length,
    )
  })

  it('ir_canonicalization is part of the closed critical set', () => {
    expect(CRITICAL_GATE_IDS).toContain(IR_CANONICALIZATION_GATE_ID)
  })
})

describe('the bridge is a reader, never a writer', () => {
  it('leaves canonical state untouched', () => {
    const ir = fullIr()
    const before = ir.size
    evaluateIrBridge(ir, [{ artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'RES1' }], 'FORMAL')
    evaluateIrBridge(ir, [{ artifact_id: 'A2', ir_kind: 'Result', ir_ref: 'GHOST' }], 'FORMAL')
    expect(ir.size).toBe(before)
    expect(ir.has('GHOST')).toBe(false)
  })

  it('emits a gate record with a stable id and criticality', () => {
    const gate = irBridgeGate(new ModelingIr(), [], 'FORMAL', AT)
    expect(gate.id).toBe(IR_CANONICALIZATION_GATE_ID)
    expect(gate.critical).toBe(true)
    expect(gate.status).toBe('BLOCKED')
    expect(gate.observedAt).toBe(AT)
    expect(gate.reason).toContain('missing IR backbone')
  })
})

/**
 * TASK 2 — every CRITICAL Claim must satisfy its type-specific evidence
 * contract (INV-2-F). The bridge now reports per-Claim evidence failures
 * on `IrBridgeDecision.evidenceFailures` and refuses delivery when any
 * CRITICAL Claim is invalid even if a sibling CRITICAL Claim would have
 * passed on its own (D-013 / task book §8).
 */
describe('TASK 2 — every CRITICAL Claim must satisfy type-specific evidence', () => {

  function irWithValidBinding(claimOverrides: Record<string, unknown> = {}): ModelingIr {
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', claim(claimOverrides)).accepted).toBe(true)
    return ir
  }

  it('D-019: a NUMERIC CRITICAL Claim with binding matching its Result is PASS', () => {
    const ir = irWithValidBinding()
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('PASS')
    expect(decision.evidenceFailures).toEqual([])
  })

  it('D-005: asserted_value different from Result.value is BLOCKED with one evidence failure', () => {
    const ir = irWithValidBinding({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.732, asserted_unit: 'm' },
    })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
    expect(decision.evidenceFailures.every(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })

  it('D-006: asserted_unit different from Result.unit is BLOCKED', () => {
    const ir = irWithValidBinding({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'cm' },
    })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_unit_mismatch')).toBe(true)
  })

  it('D-004: numeric_binding.result_ref not in claim.result_refs is BLOCKED', () => {
    // First register a second Result the binding could point at but the
    // claim does not list in result_refs.
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Result', { ...result(), result_id: 'RES2', run_ref: 'RUN1' }).accepted).toBe(true)
    // Build the claim by hand so result_refs contains RES1 (the schema
    // requires min(1)) while the binding points at RES2.
    const claimValue = claim({
      result_refs: ['RES1'],
      numeric_binding: { result_ref: 'RES2', asserted_value: 0.731, asserted_unit: 'm' },
    })
    expect(ir.put('Claim', claimValue).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_binding_result_not_in_result_refs')).toBe(true)
  })

  it('D-013: one valid CRITICAL Claim + one invalid CRITICAL Claim → whole delivery BLOCKED', () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    // The valid sibling: a well-bound NUMERIC CRITICAL Claim.
    expect(ir.put('Claim', claim({ claim_id: 'C-GOOD' })).accepted).toBe(true)
    // The invalid sibling: a NUMERIC CRITICAL Claim with a value mismatch.
    // Schema requires numeric_binding, so the only way to "miss" the value
    // is a unit/value delta — we vary `asserted_value`.
    expect(ir.put('Claim', claim({
      claim_id: 'C-BAD',
      numeric_binding: { result_ref: 'RES1', asserted_value: 9.999, asserted_unit: 'm' },
      text: 'spoofed number',
      result_refs: ['RES1'],
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    // The bridge must surface the failing claim, not just "no CRITICAL claim".
    expect(decision.evidenceFailures.some(f => f.path.includes('C-BAD'))).toBe(true)
    expect(decision.missingCriticalClaim).toBe(false)
  })

  it('D-014: an invalid CRITICAL Claim NOT listed in ir_claims is still BLOCKED (snapshot-driven)', () => {
    // Empty ir_claims array — the workflow declared no IR objects. The
    // bridge, however, still walks the snapshot, so an invalid CRITICAL
    // Claim already in the store must surface. This closes the omission
    // attack from task book §8 row 3.
    const ir = irWithValidBinding({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.732, asserted_unit: 'm' },
    })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })

  it('D-020: a FORMAL multi-Claim happy path with mixed types PASSES', async () => {
    // Two CRITICAL Claims (one NUMERIC, one MODEL), both legal.
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', claim({ claim_id: 'C-NUM' })).accepted).toBe(true)
    // MODEL claim must declare model_refs and a literal null binding.
    expect(ir.put('Claim', {
      claim_id: 'C-MOD',
      text: 'The model assumes a homogeneous slab.',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: ['M1'],
    }).accepted).toBe(true)
    const { decision, promoted } = await attemptDelivery(ir, 'FORMAL')
    expect(decision.allowed).toBe(true)
    expect(promoted.ok).toBe(true)
  })

  it('D-011: a CRITICAL QUALITATIVE claim with empty evidence_refs is BLOCKED', () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', {
      claim_id: 'C-QUAL-BAD',
      text: 'A naked qualitative assertion.',
      claim_type: 'QUALITATIVE',
      criticality: 'CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'qualitative_critical_no_evidence')).toBe(true)
  })
})
