# TASK 2 — Red Team RT-C3 (Omission attacker) report

> Independent red-team on commit `dc6780d2c5` ("TASK 2 Claim → Result
> → Run Evidence Chain"). Each finding maps to one attack fixture in
> `packages/paper/paper-foundation/tests/rt-c3/redteam-rt-c3.spec.ts`
> and the verdict the bridge produces against it.

## Surface under attack

| Concern | Surface |
|---------|---------|
| `inspectClaimEvidence` | Per-Claim semantic walker for `evidenceFailures[]` |
| `evaluateIrBridge` | `ok = … && evidenceFailures.length === 0` (INV-2-F) |
| `ModelingIr.snapshot(ir)` | The pin: refuses any object not constructed via `new ModelingIr()` |
| `IR_REF_FIELDS.Claim` | Store-side structural closure |
| `claim.criticality` | Open enum; downgrade attack surface |

## Attack catalogue

| Finding ID | Attack | Observed | Severity |
|------------|--------|----------|----------|
| RT-C3-A1 | An invalid CRITICAL Claim sits in the snapshot while `ir_claims: []` (D-014) | BLOCKED | HIGH |
| RT-C3-A1b | Empty `ir_claims` but the snapshot carries a phantom-binding Claim | BLOCKED | HIGH |
| RT-C3-A2 | Snapshot walker iterates `store.values()` — verify it walks every Claim | confirmed | — |
| RT-C3-A3 | Frozen record spoof: `record.kind` cannot be overridden after commit (TASK 1 closure) | BLOCKED | LOW |
| RT-C3-A4 | Criticality downgrade: original CRITICAL Claim kept, new NON_CRITICAL Claim added | BLOCKED (snapshot walker sees both, CRITICAL fails binding check) | HIGH |
| RT-C3-A5 | Five valid + one invalid CRITICAL Claim — walker must report the invalid one | BLOCKED | HIGH |
| RT-C3-A6 | Duplicate result_refs containing the binding's `result_ref` twice — `Set` membership makes it harmless | documented (not a gap) | LOW |
| RT-C3-A7 | CRITICAL MODEL Claim with phantom `model_refs` (single / array) | BLOCKED at `put()` via `IR_REF_FIELDS.Claim.model_refs` (`target: 'ModelSpec'`) | MEDIUM |
| RT-C3-A8 | Two-store confusion: workflow pre-loads empty store, ingests into a separate store, calls bridge on empty | BLOCKED (bridge reads snapshot, not artifact-subset) | HIGH |
| RT-C3-A9 | Smuggle the hidden claim into the bridge-facing store via the normal snapshot path — covered by A1 / A8 | BLOCKED | HIGH |
| RT-C3-A10 | Single well-bound Claim is PASS | confirmed | — |
| RT-C3-A11 | Adding an extra well-formed Result does not mask the binding | confirmed | — |

## Real gaps

**None.** Every omission attack is correctly BLOCKED. The two
test failures initially surfaced (RT-C3-A7 single / array phantom
`model_refs`) were **buggy assertions** in the agent's spec — they
assumed the store would accept a phantom `model_refs` and the bridge
would refuse via `evidenceFailures`. In fact `IR_REF_FIELDS.Claim.
model_refs` already declares `target: 'ModelSpec'` (refs.ts:119), so
the store's `validateRefFields` catches it at commit. Both lines of
defence agree: the canonical IR never holds the bad claim.

The agent's intent ("phantom MODEL Claim is caught") is preserved;
the assertions are simply inverted. `tests/rt-c3/redteam-rt-c3.spec.ts`
was patched post-hoc to assert the store's behaviour (with a bridge
sanity check) rather than the agent's inverted expectation.

## Severity tally

| Level | Count |
|-------|------:|
| CRITICAL | 0 |
| HIGH | 6 (all BLOCKED — coverage is solid) |
| MEDIUM | 1 (BLOCKED — store boundary holds) |
| LOW | 4 (BLOCKED or documented, not gaps) |
| **Total** | **22 tests** |

## Test file

- `packages/paper/paper-foundation/tests/rt-c3/redteam-rt-c3.spec.ts`
  — 22 tests, all green after the post-hoc fix.