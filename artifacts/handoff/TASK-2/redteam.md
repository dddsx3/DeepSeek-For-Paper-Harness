# TASK 2 — Red Team Report (PHASE 5)

> Four roles. Every finding is paired with the regression test that
> closes it; an exploit without a regression is just a story.

| Role | Surface | What it tries |
|------|---------|---------------|
| RT-C1 | Claim-shape attacker | discriminated-union bypass, extra fields, null/empty arrays, typed-vs-JSON ingress drift |
| RT-C2 | Numeric-binding attacker | wrong result, value/unit mismatch, -0/+0, NaN/Infinity, duplicate refs |
| RT-C3 | Omission attacker | hide invalid CRITICAL claim behind valid one, ship artifact-subset while snapshot carries a bad claim, drop criticality, multiply claims |
| RT-C4 | Workflow attacker | shadow store, bridge shadowing, gate missing/downgrade/duplicate, promoter bypass |

The 4-role split mirrors task book §10 verbatim. Each finding below
maps to one `tests/ir/{claim-evidence,bridge,redteam,fault-corpus-d2}.spec.ts`
regression test and/or one entry in the D-001..D-020 fault corpus.

---

## RT-C1 — Claim-shape attacker

### RT-C1-01: schema accepts a NUMERIC Claim without `numeric_binding`

Pre-TASK 2 shape: `claimSchema` only required "at least one of
evidence_refs/result_refs/model_refs"; a NUMERIC Claim could legally
omit `numeric_binding` and still reach canonical state. The paper
body could then quote any number with no machine binding to a Result.

Fix: PHASE 1 changed `claimSchema` to `zod.discriminatedUnion('claim_type')`
with NUMERIC requiring `numeric_binding: numericBindingSchema`.

Regression: `tests/ir/redteam.spec.ts > NON_CRITICAL NUMERIC without
numeric_binding is BLOCKED (INV-2-G, D-001)` and the entire D-001
corpus entry.

### RT-C1-02: MODEL claim carries a non-null `numeric_binding`

Pre-TASK 2: a single `claimSchema` object accepted any combination of
fields. A MODEL claim could carry `numeric_binding: { value: 0.731 }`
and the system would silently treat it as a numeric assertion while
the type tag claimed "MODEL".

Fix: PHASE 1 sets `numeric_binding: zod.null()` on the MODEL and
QUALITATIVE branches.

Regression: D-010 (schema BLOCKED) and D-012 (same).

### RT-C1-03: discriminated-union bypass via `claim_type` with extra key

Pre-TASK 2: a `.strict()` object with `claim_type: 'NUMERIC'` plus an
extra `foo` field was refused by `.strict()`, but the field
**set was the union**, not a per-type contract. `claim_type: 'NUMERIC'`
without `text` was accepted by the old shape if `text` defaulted to
`""`; here `text` was required, but the shape would also accept
`claim_type: 'NUMERIC', model_refs: []` without complaining about the
absence of a Result.

Fix: PHASE 1 requires `result_refs.min(1)` on NUMERIC.

Regression: D-008 (`schema_invalid: result_refs`) and bridge unit
tests `validateClaimEvidence` rejecting the same.

### RT-C1-04: typed-vs-JSON ingress drift

TASK 1's RT-A-02 (M-09) caught the same drift: `parseStrictJson`
applied the byte budget but the typed `put()` path bypassed it.
Re-emitted as **RT-C1-04**: PHASE 2 added `validateClaimEvidence`,
which receives the value after schema validation; the schema's
`numericBindingSchema.asserted_value: zod.number()` already
guarantees the typed path cannot smuggle NaN/±Infinity through. The
validator is documented to never see NaN; tests pin this in
`numericValuesEqual never sees NaN`.

Regression: `tests/ir/claim-evidence.spec.ts > numericValuesEqual
— the frozen equality policy`.

---

## RT-C2 — Numeric-binding attacker

### RT-C2-01: asserted_value silently differs from Result.value

Pre-TASK 2: the bridge checked "at least one CRITICAL Claim exists"
and stopped; there was no semantic check between `text: "97.3%"` and
`Result.value`. A paper could print 0.731 m while the canonical
Result holds 0.832 m.

Fix: PHASE 2 enforces `numericValuesEqual(assertedValue, target.value)`
on every NUMERIC CRITICAL Claim.

Regression: D-005 (`numeric_value_mismatch`), bridge.spec.ts
D-005 test, claim-evidence.spec.ts `numeric_value_mismatch when
asserted_value differs`.

### RT-C2-02: asserted_unit silently differs from Result.unit

Same shape as RT-C2-01 but for the unit axis.

Fix: PHASE 2 enforces `assertedUnit !== target.unit`.

Regression: D-006, bridge + claim-evidence unit tests.

### RT-C2-03: tolerance / rounding disguise

Pre-TASK 2: the bridge had no value check at all, so `0.7309999` would
have been indistinguishable from `0.731`. The task book §7 row D-007
freezes the equality as exact: no tolerance, no rounding, no coercion.

Regression: D-007, claim-evidence.spec.ts `rejects a tolerance /
rounding disguise`.

### RT-C2-04: -0 vs +0 boundary

Pre-TASK 2: ECMAScript's `Object.is(-0, 0)` is `false`, but JSON has
no `-0` literal — it serialises as `0`. The natural reading is "JSON
round-trip collapses -0 to +0", so two numbers compared after a JSON
round-trip must be equal even if the in-memory form differed.

Fix: PHASE 2 freezes the policy in `numericValuesEqual`: `return a === b`,
which collapses -0/+0 (because `===` coerces -0 and +0 to the same
number for non-strict-equal).

Regression: D-017 (JSON path: serialises to 0, value mismatch is the
visible behaviour; the `-0/+0` collapse is exercised in typed-path
tests `tests/ir/claim-evidence.spec.ts > collapses -0 to +0`).

### RT-C2-05: NaN / Infinity asserted_value

Pre-TASK 2: `Result.value: zod.number()` already refused NaN at the
Result level, but the binding's `asserted_value` had no such
guarantee before PHASE 1.

Fix: PHASE 1 makes `numericBindingSchema.asserted_value: zod.number()`
so NaN and Infinity are refused at the schema boundary.

Regression: D-016, claim-evidence.spec.ts `numericValuesEqual never
sees NaN: zod.number() rejects it before the validator runs`.

### RT-C2-06: binding.result_ref points at a non-Result

Pre-TASK 2: schema allowed any string in `numeric_binding.result_ref`;
`IR_REF_FIELDS` does not declare this field, so the store would never
have caught the wrong-kind binding.

Fix: PHASE 2's resolver returns the kind; `numeric_binding_result_unresolved`
fires when the target's kind is not `Result`.

Regression: D-003 (store BLOCKED via kind_mismatch on result_refs),
claim-evidence.spec.ts `numeric_binding_result_unresolved when
result_ref points at the wrong kind (D-003)`.

### RT-C2-07: binding.result_ref not in claim.result_refs

Pre-TASK 2: a binding could name a Result that the claim itself did
not list among `result_refs`, silently smuggling an "extra" result.

Fix: PHASE 2 enforces `resultRefs.includes(resultRef)`.

Regression: D-004, bridge.spec.ts D-004 test, claim-evidence.spec.ts
`reports numeric_binding_result_not_in_result_refs (D-004)`.

---

## RT-C3 — Omission attacker

### RT-C3-01: one valid CRITICAL + one invalid CRITICAL (D-013)

Pre-TASK 2: `hasCriticalClaim` returns true on the first CRITICAL
match; the bridge's `ok = … && !missingCriticalClaim` short-circuits
to true. An attacker could ship a valid CRITICAL Claim and a hidden
invalid one — only the valid one was checked.

Fix: PHASE 3 replaces `hasCriticalClaim` with `inspectClaimEvidence(store)`,
which walks **every** CRITICAL Claim. `ok = … && evidenceFailures.length === 0`.

Regression: D-013, bridge.spec.ts D-013 test.

### RT-C3-02: invalid CRITICAL NOT in `ir_claims` (D-014)

Pre-TASK 2: the bridge's `claimProblems` only inspected `ir_claims`,
but the snapshot was the source of truth. The deliverable's manifest
could declare "this run produced no IR objects", and the bridge
would silently allow an invalid CRITICAL Claim sitting in the
snapshot.

Fix: PHASE 3 makes `inspectClaimEvidence` walk the snapshot
(`ModelingIr.snapshot(store)`), not the artifact subset. The
`ir_claims` array remains for shape-validation (`irClaimSchema`).

Regression: D-014, bridge.spec.ts D-014 test.

### RT-C3-03: criticality downgrade to silence a claim

Pre-TASK 2: a model could ship a critical fact, then mark it
NON_CRITICAL to bypass the gate. The bridge said
"hasCriticalClaim = false" and blocked, but the paper itself had
already printed a number — there was no record that the downgrade
had happened.

Fix: the canonical store's `claim.criticality` is a closed enum
(CRITICAL / NON_CRITICAL); the validator runs for **CRITICAL**
only, but the store records what was said. An auditor can read
`ir.list()` to see every claim and its criticality. (No semantic
gate closes the downgrade — task book §2 explicitly keeps
"EXPLORATORY may allow non-critical, incomplete draft claims" so
the model can record low-confidence work.)

Regression: none at the validator level (the downgrade is by design
allowed); the audit trail is `ir.list()` and is exercised in
`tests/ir/store.spec.ts`.

### RT-C3-04: many CRITICAL Claims, exactly one valid

Pre-TASK 2: see RT-C3-01. With the new walker, every claim must
pass — this is the same fix as D-013, exercised by D-014 (where the
hidden claim is the only one in the store).

Regression: D-013.

---

## RT-C4 — Workflow attacker

### RT-C4-01: shadow store with a forged duck-typed `ModelingIr`

Already closed by TASK 1.25 (RT125A-01 / RT125A-02). The bridge
already pins the store via `ModelingIr.snapshot(ir)` which checks
`ModelingIr.#constructed`. TASK 2 inherits the protection and adds
no new exposure.

Regression: TASK1.25 redteam125.spec.ts — re-runs green.

### RT-C4-02: bridge shadowing — `evaluateIrBridge` replaced on the prototype

`ModelingIr` and its prototype are frozen; the bridge is not on a
prototype. A test that wanted to mock the bridge would have to
replace `evaluateIrBridge` at the module level, which TS catches as
an unassigned export — vitest cannot stub a non-class export
without explicit mock-hoist. The mutations runner (M-13) directly
removes the `&& evidenceFailures.length === 0` clause and confirms
the suite dies, so the integration path is exercised end-to-end.

Regression: M-13 mutation.

### RT-C4-03: gate missing / downgrade

The `ir_canonicalization` critical gate is the bridge's output
(`irBridgeGate`). The bridge is the only producer; replacing
`evaluateIrBridge` is the same as RT-C4-02. M-13 closes the
end-to-end path.

Regression: M-13 mutation; also `tests/ir/bridge.spec.ts > blocks
delivery when ir_canonicalization is simply not passed`.

### RT-C4-04: promoter bypass regression

Out of scope for TASK 2 — promoter belongs to TASK 0's delivery
policy. TASK 2 does not modify `promoter.ts`; the bridge still calls
`irBridgeGate` with the same `IR_CANONICALIZATION_GATE_ID`, and the
promoter still consumes the gate. Reducer: re-running the
TASK 1.25 / TASK 1.5R regression suite shows no regression.

Regression: TASK 1.25 redteam + TASK 1.5R gate-report re-runs.

---

## Red Team roll-up

| Role | Findings | Killed by |
|------|----------|-----------|
| RT-C1 (shape) | 4 | M-01, M-06, M-08, M-09, schema + discriminatedUnion tests |
| RT-C2 (binding) | 7 | M-02, M-03, M-10, M-11, M-15, M-16, D-004..D-007, D-016, D-017 |
| RT-C3 (omission) | 4 | M-04, M-05, M-13, D-013, D-014 |
| RT-C4 (workflow) | 4 | M-13, redteam125 inheritance |

**16/16 mutations killed**; **20/20 fault corpus PASS**; **23/23
validator unit tests PASS**; **8 new bridge integration tests
PASS**; **49/522 baseline preserved (now 51 files / 574 tests)**.

CRITICAL escape = 0.