/**
 * RT-C4 follow-on — promoter + pipeline + spot-checks.
 *
 * Covers scenarios that don't fit in workflow-bypass.spec.ts:
 *   - Direct promoter bypass (RT-C4-04 from the redteam.md)
 *   - Duplicate gate ids (RT125C-03)
 *   - Critical gate downgrade via ir_canonicalization (RT125C-01)
 *   - Empty IR store with mode mismatch
 *   - The bridge evaluated against itself (no ir at all)
 *   - Resolver partial-kind coverage (ReviewerFinding, FigureSpec,
 *     VerificationResult, ProblemSpec, SymbolSpec are not on the
 *     claim-evidence path — claim must not silently accept them).
 */

import { describe, expect, it } from 'vitest'
import {
  CRITICAL_GATE_IDS,
  IR_CANONICALIZATION_GATE_ID,
  evaluateDelivery,
  type DeliveryDecision,
  type DeliveryPolicy,
  type GateRecord,
} from '../../src/delivery/delivery-policy.ts'
import {
  promoteCandidateToDeliverable,
} from '../../src/delivery/promoter.ts'
import {
  ModelingIr,
  evaluateIrBridge,
  inspectClaimEvidence,
  irBridgeGate,
  validateClaimEvidence,
} from '../../src/ir/index.ts'
import {
  backboneIr,
  claim,
  chainThrough,
  numericClaim,
  qualitativeClaim,
} from '../ir/fixtures.ts'

const AT = '2026-09-01T00:00:00.000Z'

function freshIr(): ModelingIr {
  return new ModelingIr({ now: () => AT })
}

// ===========================================================================
// RT-C4-10 — Promoter refuses to deliver when ir_canonicalization is
// missing / downgraded / duplicated.
// ===========================================================================
describe('RT-C4-10 — promoter enforces ir_canonicalization presence as critical', () => {
  const allPassExcept: GateRecord[] = (excludeId: string): GateRecord[] => {
    const out: GateRecord[] = []
    for (const id of CRITICAL_GATE_IDS) {
      if (id === excludeId) continue
      out.push({ id, status: 'PASS', critical: true, observedAt: AT })
    }
    return out
  }

  it('BLOCKED: ir_canonicalization is missing entirely', () => {
    const policy: DeliveryPolicy = {
      mode: 'FAST',
      gates: allPassExcept(IR_CANONICALIZATION_GATE_ID),
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
    }
    const decision: DeliveryDecision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate_missing')).toBe(true)
  })

  it('BLOCKED: ir_canonicalization is downgraded (critical: false) — RT125C-01', () => {
    const policy: DeliveryPolicy = {
      mode: 'FAST',
      gates: [
        ...allPassExcept(IR_CANONICALIZATION_GATE_ID),
        { id: IR_CANONICALIZATION_GATE_ID, status: 'PASS', critical: false, observedAt: AT },
      ],
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
    }
    const decision: DeliveryDecision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate_downgraded')).toBe(true)
  })

  it('BLOCKED: ir_canonicalization is duplicated', () => {
    const policy: DeliveryPolicy = {
      mode: 'FAST',
      gates: [
        ...allPassExcept(IR_CANONICALIZATION_GATE_ID),
        { id: IR_CANONICALIZATION_GATE_ID, status: 'PASS', critical: true, observedAt: AT },
        { id: IR_CANONICALIZATION_GATE_ID, status: 'PASS', critical: true, observedAt: AT },
      ],
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
    }
    const decision: DeliveryDecision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'duplicate_gate_id')).toBe(true)
  })
})

// ===========================================================================
// RT-C4-11 — Promoter cannot be called on a non-CANDIDATE source state.
// (Sanity: the promoter is not the bypass.)
// ===========================================================================
describe('RT-C4-11 — promoter refuses to mint from non-CANDIDATE state', () => {
  it('wrong_source_state: an artifact in VERIFIED cannot be promoted', async () => {
    const policy: DeliveryPolicy = {
      mode: 'FAST',
      gates: CRITICAL_GATE_IDS.map(id => ({ id, status: 'PASS', critical: true, observedAt: AT })),
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
    }
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(true)

    const result = await promoteCandidateToDeliverable(
      {
        id: 'A1',
        state: 'VERIFIED',
        createdAt: AT,
        contentHash: 'sha256:x',
      } as never,
      policy,
      decision,
      {
        audit: () => undefined,
        now: () => AT,
        writeFinalOutput: async () => undefined,
      },
      '/tmp/out.txt',
      'payload',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('wrong_source_state')
  })
})

// ===========================================================================
// RT-C4-12 — The bridge's evidence walker is total and never throws.
// ===========================================================================
describe('RT-C4-12 — bridge is total (never throws)', () => {
  it('PASS: returns PASS on a clean backboneIr', () => {
    const decision = evaluateIrBridge(backboneIr(), [], 'fast')
    expect(decision.status).toBe('PASS')
    expect(decision.evidenceFailures.length).toBe(0)
  })

  it('BLOCKED: empty store + FORMAL is BLOCKED with missingBackbone reported', () => {
    const decision = evaluateIrBridge(new ModelingIr(), [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.missingBackbone.length).toBe(5)
    expect(decision.missingCriticalClaim).toBe(true)
  })

  it('BLOCKED: empty store + unknown mode is BLOCKED (fail-closed)', () => {
    const decision = evaluateIrBridge(new ModelingIr(), [], 'made-up-mode')
    expect(decision.status).toBe('BLOCKED')
  })

  it('BLOCKED: throws in evaluateInner become BLOCKED, not exception', () => {
    // Pass an ir that fails ModelingIr.isCanonicalIr — that path is in
    // `evaluateInner` after `try`, but `ModelingIr.snapshot(ir)` returns null
    // without throwing. Confirm that the decision is BLOCKED without an
    // exception leaking out.
    const decision = evaluateIrBridge({} as never, [], 'fast')
    expect(decision.status).toBe('BLOCKED')
  })
})

// ===========================================================================
// RT-C4-13 — validateClaimEvidence direct: phantom refs in MODEL claims.
// ===========================================================================
describe('RT-C4-13 — validator: phantom model_refs and result_refs', () => {
  it('BLOCKED: MODEL claim references a SymbolSpec that is not a ModelSpec', () => {
    const resolver = (ref: string) => {
      if (ref === 'SYM-x') return { kind: 'SymbolSpec' as never } // wrong kind
      return undefined
    }
    const claimRecord = {
      claim_id: 'C-WRONG-KIND',
      text: 'A model claim with a wrong-kind ref.',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: ['SYM-x'],
    }
    const result = validateClaimEvidence(claimRecord as never, resolver as never)
    expect(result.some(f => f.kind === 'model_claim_no_model_ref')).toBe(true)
  })

  it('BLOCKED: NUMERIC claim names a non-existent result_ref', () => {
    const resolver = () => undefined
    const claimRecord = {
      claim_id: 'C-PHANTOM',
      text: 'Phantom.',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: {
        result_ref: 'NOT-EXIST',
        asserted_value: 0.0,
        asserted_unit: 'm',
      },
      evidence_refs: [],
      result_refs: ['NOT-EXIST'],
      model_refs: [],
    }
    const result = validateClaimEvidence(claimRecord as never, resolver as never)
    expect(result.some(f => f.kind === 'numeric_binding_result_unresolved')).toBe(true)
  })
})

// ===========================================================================
// RT-C4-14 — inspectClaimEvidence walks every Claim, even duplicates.
// ===========================================================================
describe('RT-C4-14 — walker is exhaustive', () => {
  it('reports failure for both halves of two invalid CRITICAL claims', () => {
    const ir = freshIr()
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', numericClaim({
      claim_id: 'C-LIE-A',
      text: 'A lies.',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.1, asserted_unit: 'm' },
      evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1'],
    })).accepted).toBe(true)
    expect(ir.put('Claim', numericClaim({
      claim_id: 'C-LIE-B',
      text: 'B lies.',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.2, asserted_unit: 'm' },
      evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1'],
    })).accepted).toBe(true)

    // inspectClaimEvidence takes a ReadonlyMap snapshot, not the ir itself.
    const snapshot = ModelingIr.snapshot(ir)
    expect(snapshot).not.toBeNull()
    const failures = inspectClaimEvidence(snapshot as never)
    // both lies must produce a numeric_value_mismatch
    const mismatches = failures.filter(f => f.kind === 'numeric_value_mismatch')
    expect(mismatches.length).toBe(2)
  })
})

// ===========================================================================
// RT-C4-15 — claim with no model_refs in MODEL claim shape: kind-mismatch
// via store schema. Verify the schema refuses before the validator runs.
// ===========================================================================
describe('RT-C4-15 — MODEL claim with empty model_refs is refused at the schema', () => {
  it('store refuses to admit MODEL claim with model_refs: [] (D-009)', () => {
    const ir = freshIr()
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    const verdict = ir.put('Claim', qualitativeClaim({
      claim_id: 'C-MODEL-EMPTY',
      text: 'A model claim without refs.',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: null,
      model_refs: [], // schema: model_refs.min(1)
    }))
    expect(verdict.accepted).toBe(false)
  })
})

// ===========================================================================
// RT-C4-16 — Gate-forgery attempt: present a forged PASS record to
// evaluateDelivery. The policy-level checks catch this only if the gate
// was missing; but the *bridge* (irBridgeGate) is the only producer, so
// a forged record at this layer is irrelevant — the executor calls
// irBridgeGate itself.
// ===========================================================================
describe('RT-C4-16 — gate-forgery', () => {
  it('a forged PASS record for ir_canonicalization is accepted by evaluateDelivery', () => {
    // Sanity: a hand-built policy that contains a forged PASS record for
    // IR_CANONICALIZATION_GATE_ID is allowed by evaluateDelivery (because
    // the policy is trusted as input). This is by design: the bridge is the
    // producer; the policy is just a transport. The executor wires
    // irBridgeGate → policy so the forgery has no caller in production.
    const policy: DeliveryPolicy = {
      mode: 'FAST',
      gates: CRITICAL_GATE_IDS.map(id => ({ id, status: 'PASS', critical: true, observedAt: AT })),
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
    }
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(true)
  })

  it('a policy with NO IR_CANONICALIZATION_GATE_ID is BLOCKED — the bridge cannot be silently bypassed', () => {
    const gatesWithoutCanonicalization = CRITICAL_GATE_IDS
      .filter(id => id !== IR_CANONICALIZATION_GATE_ID)
      .map(id => ({ id, status: 'PASS', critical: true, observedAt: AT }))
    const policy: DeliveryPolicy = {
      mode: 'FAST',
      gates: gatesWithoutCanonicalization,
      staleArtifactIds: [],
      unresolvedReferenceIds: [],
      requiredOutputs: [],
      runtimeProfileValid: true,
    }
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate_missing')).toBe(true)
  })
})

// ===========================================================================
// RT-C4-17 — The bridge is total under weird inputs.
// ===========================================================================
describe('RT-C4-17 — bridge is total under weird inputs', () => {
  it('BLOCKED: a non-object ir throws nothing — ModelingIr.snapshot returns null → BLOCKED', () => {
    // The try/catch in evaluateIrBridge would catch a throw. ModelingIr.snapshot
    // does not throw — it returns null. We confirm.
    expect(() => evaluateIrBridge(null as never, [], 'fast')).not.toThrow()
    expect(() => evaluateIrBridge(undefined as never, [], 'fast')).not.toThrow()
    expect(() => evaluateIrBridge(42 as never, [], 'fast')).not.toThrow()
    expect(() => evaluateIrBridge('string' as never, [], 'fast')).not.toThrow()
    expect(() => evaluateIrBridge(true as never, [], 'fast')).not.toThrow()
    const d1 = evaluateIrBridge(null as never, [], 'fast')
    const d2 = evaluateIrBridge(undefined as never, [], 'fast')
    const d3 = evaluateIrBridge({} as never, [], 'fast')
    expect(d1.status).toBe('BLOCKED')
    expect(d2.status).toBe('BLOCKED')
    expect(d3.status).toBe('BLOCKED')
  })

  it('BLOCKED: an empty claims array still walks the snapshot', () => {
    const ir = freshIr()
    expect(irBridgeGate(ir, [], 'fast', AT).status).toBe('BLOCKED')
  })
})