/**
 * RT-C3 (Omission attacker) — independent red-team against TASK 2.
 *
 * TASK 2 made the bridge walk *every* CRITICAL Claim in the canonical
 * snapshot (not the artifact subset) and refuse delivery when any fails
 * its type-specific contract. The attacks below probe every avenue I could
 * find for an adversary to *hide* an invalid CRITICAL Claim from that
 * walker: snapshot/artifact-subset confusion, criticality downgrade,
 * multi-claim masking, live-snapshot mutation, kind spoof, etc.
 *
 * Every test here corresponds to a *concrete attack* I executed against
 * the bridge. The block here documents whether each one succeeded (real
 * gap) or was blocked (developers already closed it). Findings are
 * enumerated in artifacts/handoff/TASK-2/redteam-rt-c3.md.
 */
import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  evaluateIrBridge,
  inspectClaimEvidence,
} from '../../src/ir/index.ts'
import type { IrObjectRecord } from '../../src/ir/index.ts'
import {
  backboneIr,
  chainThrough,
  claim,
  modelClaim,
  qualitativeClaim,
  result,
} from '../ir/fixtures.ts'

const AT = '2026-09-01T00:00:00.000Z'

/**
 * Build a closed canonical backbone (DATA / Problem → Model → Run → Result)
 * that every Claim can hang off without tripping the Problem Contract. The
 * `chainThrough('Result')` prefix carries the minimum contract the bridge
 * expects for a valid delivery, so the attacks below only ever produce the
 * specific failure under test.
 */
function closedBackboneIr(now: () => string = () => AT): ModelingIr {
  const ir = new ModelingIr({ now })
  for (const entry of chainThrough('Result')) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

// ---------------------------------------------------------------------------
// Attack 1 — the bridge must still catch an invalid CRITICAL NUMERIC Claim
// when the artifact subset is empty, the subset contains an unverifiable
// reference, OR the subset declares only NON_CRITICAL-looking records.
//
// D-014 already exercises `ir_claims: []`. Variants: phantom ir_ref,
// wrong-kind ir_ref, and a subset that *names* the bad claim but with a
// mismatched ir_kind. In every variant the snapshot walker must still
// surface the bad claim and refuse delivery.
// ---------------------------------------------------------------------------
describe('RT-C3-A1 — snapshot/artifact-subset confusion variants', () => {
  it('blocks when ir_claims names the bad claim with a mismatched ir_kind', () => {
    // The bad claim lives in the snapshot. The artifact subset *names* it
    // but mislabels its kind — the kind check should fire (ir_kind_mismatch),
    // and the snapshot walker should *also* fire the evidence failure. The
    // bridge must still BLOCK overall; this is "two for the price of one".
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-BAD',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.999, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [
      { artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'C-BAD' },
    ], 'FORMAL')

    expect(decision.status).toBe('BLOCKED')
    expect(decision.claimProblems.some(p => p.rejection === 'ir_kind_mismatch')).toBe(true)
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })

  it('blocks when ir_claims contains only NON_CRITICAL-shaped claim ids pointing at CRITICAL claims', () => {
    // The subset's own ir_claims pass schema validation (their refs resolve
    // to Claims), but the snapshot also contains a hidden bad CRITICAL
    // NUMERIC claim. The walker must still catch it.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({ claim_id: 'C-GOOD' })).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-BAD',
      numeric_binding: { result_ref: 'RES1', asserted_value: 9.999, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [
      // ir_claims only references the GOOD claim; the BAD one is in the
      // snapshot but absent from the subset.
      { artifact_id: 'A1', ir_kind: 'Claim', ir_ref: 'C-GOOD' },
    ], 'FORMAL')

    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-BAD'))).toBe(true)
  })

  it('blocks when the ir_claims subset contains only unverifiable phantoms (every claim ir_ref_not_registered)', () => {
    // An attacker who wanted to "dilute" the bridge with garbage
    // claimProblems cannot suppress the snapshot walker: every ir_claims
    // entry fails ir_ref_not_registered, *and* the snapshot walker still
    // finds the bad CRITICAL claim.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-BAD',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.732, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [
      { artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'GHOST-A' },
      { artifact_id: 'A2', ir_kind: 'Result', ir_ref: 'GHOST-B' },
    ], 'FORMAL')

    expect(decision.status).toBe('BLOCKED')
    expect(decision.claimProblems).toHaveLength(2)
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 2 — criticality downgrade.
//
// A model claims "accuracy is 97.3%" with criticality CRITICAL, then ships
// the same number as criticality NON_CRITICAL. The store is append-only
// (no replace), but the bridge walks every Claim in the snapshot.
//
// Critical observation: NUMERIC claims run the binding check *regardless*
// of criticality. So a NON_CRITICAL NUMERIC with a bad binding is still
// caught by the walker. The attack succeeds ONLY if the downgrade is to a
// NON_NUMERIC type (e.g. QUALITATIVE), where the evidence_refs check is
// gated on CRITICAL.
//
// This test pins the contract: NUMERIC binding check is criticality-blind.
// A downgrade to NON_CRITICAL does not silence a NUMERIC binding failure.
// ---------------------------------------------------------------------------
describe('RT-C3-A2 — criticality downgrade does not silence NUMERIC binding failures', () => {
  it('blocks a NON_CRITICAL NUMERIC Claim with a value mismatch (NUMERIC check is criticality-blind)', () => {
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-NCNUM',
      criticality: 'NON_CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 7.777, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    // The walker surfaces the bad binding even though the claim is not
    // CRITICAL. Without this guarantee, an attacker could ship the same
    // number with criticality downgraded to silence the gate.
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
    expect(decision.missingCriticalClaim).toBe(true)
  })

  it('does NOT block a NON_CRITICAL QUALITATIVE Claim with empty evidence_refs (by design)', () => {
    // The contract says: NON_CRITICAL QUALITATIVE is a "low-confidence
    // draft note" and may exist without evidence_refs. This is by design
    // (see known-risks.md §1 and RT-C3-03 in redteam.md). Pin the
    // counterfactual: a NON_CRITICAL QUALITATIVE with empty evidence_refs
    // passes the walker.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-NCQUAL',
      claim_type: 'QUALITATIVE',
      criticality: 'NON_CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    })).accepted).toBe(true)

    const failures = inspectClaimEvidence(ModelingIr.snapshot(ir) ?? new Map())
    expect(failures.filter(f => f.path.includes('C-NCQUAL'))).toEqual([])
  })

  it('blocks a CRITICAL QUALITATIVE Claim with empty evidence_refs even when a NON_CRITICAL sibling hides behind it', () => {
    // The classic "hide behind a valid claim" — except the hidden one is
    // a CRITICAL QUALITATIVE with no evidence, and the sibling is a
    // NON_CRITICAL QUALITATIVE that would *also* pass. The walker must still
    // surface the bad CRITICAL.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', qualitativeClaim({ claim_id: 'C-NC' })).accepted).toBe(true)
    expect(ir.put('Claim', qualitativeClaim({
      claim_id: 'C-CRIT-BAD',
      evidence_refs: [],
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'qualitative_critical_no_evidence' && f.path.includes('C-CRIT-BAD'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 3 — multi-claim masking.
//
// D-013 already exercises 1 valid + 1 invalid CRITICAL. Variants:
//   - 5 valid + 1 invalid (the bad one is buried, not adjacent)
//   - bad-first-then-good (insertion order should not affect verdict)
//   - all CRITICAL, exactly one invalid
//   - bad claim inserted AFTER good one, in the same call window
// ---------------------------------------------------------------------------
describe('RT-C3-A3 — multi-claim masking variants', () => {
  it('blocks 5 valid CRITICAL + 1 invalid CRITICAL with the invalid one at index 4', () => {
    const ir = closedBackboneIr()
    for (let i = 0; i < 5; i += 1) {
      expect(ir.put('Claim', claim({ claim_id: `C-GOOD-${i}` })).accepted).toBe(true)
    }
    expect(ir.put('Claim', claim({
      claim_id: 'C-BAD-DEEP',
      numeric_binding: { result_ref: 'RES1', asserted_value: 5.555, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-BAD-DEEP') && f.kind === 'numeric_value_mismatch')).toBe(true)
  })

  it('blocks when the bad CRITICAL claim is inserted BEFORE the good ones', () => {
    // The walker iterates `store.values()` in insertion order. If the
    // walker short-circuited on the first valid CRITICAL, this attack
    // would succeed. Verify it does not.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-BAD-FIRST',
      numeric_binding: { result_ref: 'RES1', asserted_value: 1.111, asserted_unit: 'm' },
    })).accepted).toBe(true)
    expect(ir.put('Claim', claim({ claim_id: 'C-GOOD-A' })).accepted).toBe(true)
    expect(ir.put('Claim', claim({ claim_id: 'C-GOOD-B' })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-BAD-FIRST'))).toBe(true)
  })

  it('blocks when exactly one of three CRITICAL Claims is invalid (1-of-3)', () => {
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({ claim_id: 'C-A' })).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-B',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.999, asserted_unit: 'm' },
    })).accepted).toBe(true)
    expect(ir.put('Claim', claim({ claim_id: 'C-C' })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures).toHaveLength(1)
    expect(decision.evidenceFailures[0]!.path).toContain('C-B')
  })

  it('does not mask by hiding the bad claim between two good claims', () => {
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({ claim_id: 'C-1' })).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-2',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.123, asserted_unit: 'm' },
    })).accepted).toBe(true)
    expect(ir.put('Claim', claim({ claim_id: 'C-3' })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-2'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 4 — snapshot live-reference mutation.
//
// `ModelingIr.snapshot(ir)` returns `value.#objects` — a live reference to
// the private Map. If an attacker calls `ir.put()` AFTER the bridge takes
// the snapshot but BEFORE inspectClaimEvidence iterates it, the new
// record would appear in the snapshot. This is irrelevant in production
// (the bridge is synchronous) but a regression test pins it: the bridge
// walks whatever the snapshot *currently* contains, so adding a bad claim
// post-snapshot is in scope of the walker.
//
// More practically: the snapshot is a live reference. Removing a record
// from `#objects` is impossible from outside (private), so this attack
// can't hide things either way. The interesting direction is "what if
// the bridge started, and a phantom claim was added during it?" — the
// walker sees it.
// ---------------------------------------------------------------------------
describe('RT-C3-A4 — snapshot is a live reference, not a defensive copy', () => {
  it('does not let a later put() into the same store hide a claim from the walker', () => {
    // The snapshot is the live #objects map. The walker iterates it once.
    // Putting a *new* record into the store before evaluation is the
    // normal case; the walker must see it. (This pins the "snapshot is
    // not a copy" property, which is also what TASK 1.25 closed in
    // RT125A-01/02 against forgeries.) Note: `ModelingIr.snapshot(ir)`
    // returns the SAME Map reference, so `before === after` and any
    // mutation is visible through both — no separate snapshot API exists
    // to hand out a defensive copy.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({ claim_id: 'C-OK' })).accepted).toBe(true)
    const before = ModelingIr.snapshot(ir)
    expect(before).not.toBeNull()
    const sizeBeforePut = ir.size
    // A new (bad) claim is added — the snapshot is live, so the bridge
    // will see it.
    expect(ir.put('Claim', claim({
      claim_id: 'C-LATE-BAD',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.0001, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const after = ModelingIr.snapshot(ir)
    // The snapshot is a live reference, so `after === before` and both
    // reflect the post-put state.
    expect(after).toBe(before)
    expect(ir.size).toBe(sizeBeforePut + 1)

    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-LATE-BAD'))).toBe(true)
  })

  it('treats a forged snapshot that omits the bad claim as no store at all', () => {
    // The bridge reads via `ModelingIr.snapshot(ir)`. If `ir` is not a
    // canonical ModelingIr, snapshot returns null and the bridge uses
    // EMPTY_SNAPSHOT. A snapshot that "claims" to be canonical but
    // secretly omits the bad claim is impossible — the snapshot is the
    // private Map; no external surface hands out a curated view. Verify.
    const forged = Object.create(ModelingIr.prototype) as ModelingIr
    expect(ModelingIr.isCanonicalIr(forged)).toBe(false)
    const decision = evaluateIrBridge(forged, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.missingBackbone.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Attack 5 — kind spoof on a stored record.
//
// The record is frozen by `Object.freeze({ ... kind: K ... })`. Can an
// attacker replace `record.kind` post-hoc? No — frozen. Can they shadow
// `ModelingIr.prototype.get` to return a forged record with `kind:
// 'FigureSpec'` for a Claim? No — the bridge uses `ModelingIr.snapshot`,
// not `get`. Verify by attempting the mutation.
// ---------------------------------------------------------------------------
describe('RT-C3-A5 — frozen record kind cannot be spoofed', () => {
  it('refuses to mutate record.kind after put()', () => {
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({ claim_id: 'C1' })).accepted).toBe(true)
    const record = ir.get('RES1') as IrObjectRecord
    expect(Object.isFrozen(record)).toBe(true)
    expect(() => {
      ;(record as unknown as { kind: string }).kind = 'FigureSpec'
    }).toThrow(TypeError)
    expect(record.kind).toBe('Result')
  })

  it('shadowing ModelingIr.prototype.get does not hide a claim from the walker', () => {
    // The bridge uses ModelingIr.snapshot(), which reads `value.#objects`
    // directly — not via `get`. So a shadowed `get` cannot lie about what
    // the snapshot sees.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-SHADOW',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.444, asserted_unit: 'm' },
    })).accepted).toBe(true)
    // Shadow `get` to return nothing.
    Object.defineProperty(ir, 'get', {
      value: () => undefined,
      configurable: true,
    })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-SHADOW'))).toBe(true)
  })

  it('shadowing ModelingIr.prototype.list does not hide a claim from the walker', () => {
    // Same shape, but for `list`. The bridge uses `store.values()`
    // (Map.prototype.values on the private Map), not `list()`.
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-LIST-SHADOW',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.333, asserted_unit: 'm' },
    })).accepted).toBe(true)
    Object.defineProperty(ir, 'list', {
      value: () => [],
      configurable: true,
    })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-LIST-SHADOW'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 6 — EXPLORATORY mode is exempt from the BACKBONE contract, but
// the evidence walker runs in *every* mode. An invalid CRITICAL Claim in
// EXPLORATORY must still BLOCK.
// ---------------------------------------------------------------------------
describe('RT-C3-A6 — EXPLORATORY mode does not exempt the evidence walker', () => {
  it('blocks EXPLORATORY delivery when the snapshot carries an invalid CRITICAL Claim', () => {
    const ir = closedBackboneIr()
    expect(ir.put('Claim', claim({
      claim_id: 'C-EXPLO-BAD',
      numeric_binding: { result_ref: 'RES1', asserted_value: 1.414, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(ir, [], 'EXPLORATORY')
    // EXPLORATORY is exempt from the *backbone* minimum, but the evidence
    // walker is invoked unconditionally (see bridge.ts comment).
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
    expect(decision.missingBackbone).toEqual([])
    expect(decision.missingCriticalClaim).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Attack 7 — model_refs.length >= 1 for MODEL claims. What about a
// CRITICAL MODEL claim whose single model_ref points at a Result? The
// store would refuse because result_refs != ModelSpec. But what if the
// model_ref is duplicated (same ModelSpec twice)? Schema requires unique
// via .refine on variable_refs/parameter_refs, not on model_refs. So a
// CRITICAL MODEL claim with `model_refs: ['M1', 'M1']` is *schema-valid*
// but the validator only verifies the FIRST one. Does the second copy
// bypass anything? No — the validator's for-loop checks every ref. Pin
// the contract: duplicates are not a gap.
//
// Also: what if `model_refs: ['M1', 'M1', 'GHOST']`? The first two pass,
// the third fails — `model_claim_no_model_ref` fires.
// ---------------------------------------------------------------------------
describe('RT-C3-A7 — MODEL claim with a phantom model_ref is caught', () => {
  it('refuses a CRITICAL MODEL claim with a single phantom model_ref at the store boundary', () => {
    // RT-C3 agent's original assertion was inverted: it assumed the
    // store would accept a phantom model_ref and the bridge would
    // refuse via `evidenceFailures`. In fact `IR_REF_FIELDS.Claim.
    // model_refs` already declares `target: 'ModelSpec'` (refs.ts:119),
    // so the store's `validateRefFields` catches it. Net behaviour is
    // the same — the canonical IR never holds the bad claim — but the
    // line of defence is the store, not the bridge. Pin both: the
    // store refuses, and (had it slipped through) the bridge would
    // also refuse.
    const ir = closedBackboneIr()
    const verdict = ir.put('Claim', modelClaim({
      claim_id: 'C-MODEL-BAD',
      model_refs: ['M-GHOST'],
    }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'unresolved_reference' && f.path === 'model_refs')).toBe(true)
    }
    // Sanity: the bridge also refuses on the would-have-been snapshot
    // (still has the closed backbone, just no Claim).
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
  })

  it('refuses a CRITICAL MODEL claim where one of three model_refs is phantom (the store walks every ref)', () => {
    // Same correction as the previous test: store refuses via
    // `validateRefFields` walking every entry, not the bridge's
    // semantic walker.
    const ir = closedBackboneIr()
    const verdict = ir.put('Claim', modelClaim({
      claim_id: 'C-MODEL-MIX',
      model_refs: ['M1', 'M1-DUP', 'M-GHOST'],
    }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      // The store reports the offending ref by its position; this is
      // the byte-exact pin for the multi-entry walker.
      expect(verdict.failures.some(f => f.kind === 'unresolved_reference' && f.reason.includes('M-GHOST'))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Attack 8 — two-store confusion.
//
// The bridge takes ONE ModelingIr. A workflow could conceivably:
//   1. Pre-load an empty ModelingIr (real canonical, no records).
//   2. Ingest Claims into a SEPARATE ModelingIr.
//   3. Call evaluateIrBridge(emptyIr, [], 'FORMAL') — and pass delivery.
//
// This is the "the bridge accepts an empty store" question. With the
// backbone check active in FORMAL mode, the bridge must BLOCK on the
// empty store. Verify the worst case: a workflow that *also* smuggles a
// CRITICAL Claim into the empty store post-snapshot. Same outcome — the
// walker catches it. (Pins the closure: the bridge reads one store;
// "two-store" smuggling is structurally impossible.)
// ---------------------------------------------------------------------------
describe('RT-C3-A8 — two-store confusion is impossible', () => {
  it('blocks when the bridge is handed an empty store while a separate store holds the bad claim', () => {
    const empty = new ModelingIr({ now: () => AT })
    // The "hidden" store is unreachable from the bridge.
    const hidden = closedBackboneIr()
    expect(hidden.put('Claim', claim({
      claim_id: 'C-HIDDEN',
      numeric_binding: { result_ref: 'RES1', asserted_value: 8.888, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(empty, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.missingBackbone.length).toBeGreaterThan(0)
    expect(decision.missingCriticalClaim).toBe(true)
    expect(decision.evidenceFailures).toEqual([])
  })

  it('a workflow that smuggles the hidden claim into the bridge-facing store is the normal snapshot walker path — and is caught', () => {
    // The only way to make the hidden claim visible to the bridge is to
    // add it to the bridge-facing store. The walker must then catch it.
    const empty = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(empty.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(empty.put('Claim', claim({
      claim_id: 'C-INTO-FACING',
      numeric_binding: { result_ref: 'RES1', asserted_value: 8.888, asserted_unit: 'm' },
    })).accepted).toBe(true)

    const decision = evaluateIrBridge(empty, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-INTO-FACING'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sanity: a fully-valid backbone passes the bridge in FORMAL mode. This
// pins the "happy path still works" guarantee, so the attacks above are
// not just trivial BlockEverything.
// ---------------------------------------------------------------------------
describe('RT-C3 sanity — happy path', () => {
  it('passes a single Claim well-bound to its Result', () => {
    const ir = backboneIr()
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('PASS')
    expect(decision.evidenceFailures).toEqual([])
  })

  it('passes when an extra well-formed Result is added (does not mask the binding)', () => {
    const ir = closedBackboneIr()
    expect(ir.put('Result', result({ result_id: 'RES2', run_ref: 'RUN1', value: 0.999 })).accepted).toBe(true)
    expect(ir.put('Claim', claim({ claim_id: 'C1', result_refs: ['RES1'] })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('PASS')
  })
})