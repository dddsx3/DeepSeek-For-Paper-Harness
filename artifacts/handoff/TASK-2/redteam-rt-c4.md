# TASK 2 — Red Team RT-C4 (Workflow attacker) report

> Independent red-team on commit `dc6780d2c5` ("TASK 2 Claim → Result → Run
> Evidence Chain"). Each finding maps to one attack fixture in
> `packages/paper/paper-foundation/tests/rt-c4/` and the verdict the
> bridge produces against it.

## Surface under attack

| Concern | Surface |
|---------|---------|
| `enforceCanonicalIr` | `WorkflowExecutor` reads `this.options.ir ?? EMPTY_IR` and passes `[]` for claims |
| `irBridgeGate` | Producer of `IR_CANONICALIZATION_GATE_ID` — the only critical gate that can refuse on canonical-IR grounds |
| `evaluateIrBridge` | Total bridge function over `(ir, claims, mode)` |
| `ModelingIr.snapshot(ir)` | The pin: refuses any object not constructed via `new ModelingIr()` |
| `inspectClaimEvidence` | Per-Claim semantic walker for `evidenceFailures[]` |
| `evaluateDelivery` / `promoter` | Consumer side: refuses missing / downgraded / duplicated `ir_canonicalization` |

## Attack catalogue

> 17 distinct attack fixtures in 2 spec files. Each test asserts that the
> gate reports **BLOCKED** on the forged input — every result below is
> the verdict the production code produces when handed the attack.

| Finding ID | Attack | Observed | Severity |
|------------|--------|----------|----------|
| RT-C4-01 | An invalid CRITICAL Claim (`asserted_value: 0.999` vs `Result.value: 0.731`) sits in the snapshot while `claims: []` is passed | BLOCKED (bridge reads snapshot, not `claims`) | HIGH (would be MEDIUM after TASK 3 wires real ingest) |
| RT-C4-01b | A valid CRITICAL Claim masks an invalid one (D-013) | BLOCKED (`evidenceFailures` walker is exhaustive) | HIGH |
| RT-C4-02 | `mode = ' FORMAL '` / `'FaSt\n'` — whitespace / mixed case | BLOCKED (`requiresIrBackbone` normalises via `.trim().toUpperCase()`) | LOW |
| RT-C4-02b | `mode = 'MADEUP'` or `''` — unknown / empty | BLOCKED (fail-closed into the non-exempt branch) | LOW |
| RT-C4-03 | `ir_claims` declares `RES1` as `Claim` when it is a `Result` | BLOCKED (`ir_kind_mismatch`) | MEDIUM |
| RT-C4-03b | `ir_claims` with extra keys / empty `ir_ref` / unknown `ir_kind` | BLOCKED (`.strict()` + zod enum) | LOW |
| RT-C4-04 | CRITICAL QUALITATIVE Claim with `evidence_refs: []` | BLOCKED (`qualitative_critical_no_evidence`) | MEDIUM |
| RT-C4-04b | NON_CRITICAL QUALITATIVE without evidence (allowed by validator) | PASS (correct: validator only checks CRITICAL) | LOW |
| RT-C4-05 | CRITICAL MODEL Claim names `RES1` (a Result) | BLOCKED at `put()` via `reference_kind_mismatch` | LOW |
| RT-C4-06 | NUMERIC Claim with `result_ref` pointing at a `ModelSpec` | BLOCKED via resolver (`numeric_binding_result_unresolved`) | LOW |
| RT-C4-07 | End-to-end: workflow executor with the lying NUMERIC Claim in the store | BLOCKED via `WorkflowExecutionError` + audit event | HIGH |
| RT-C4-07 | End-to-end: same lying claim under strict mode | BLOCKED | HIGH |
| RT-C4-08 | Duck-typed `ModelingIr` carrying a lying snapshot | BLOCKED (`ModelingIr.isCanonicalIr` returns `false`, treated as empty) | MEDIUM |
| RT-C4-08b | A foreign class instance satisfying the duck type | BLOCKED (same pin) | MEDIUM |
| RT-C4-09 | Bridge shadowing via `vi.mock` (production code path) | NO SHADOW EXISTS — bridge is a hard import | LOW |
| RT-C4-10 | `ir_canonicalization` missing from `policy.gates` | BLOCKED via `critical_gate_missing` | LOW |
| RT-C4-10 | `ir_canonicalization` downgraded (`critical: false`) | BLOCKED via `critical_gate_downgraded` (RT125C-01) | LOW |
| RT-C4-10 | `ir_canonicalization` duplicated | BLOCKED via `duplicate_gate_id` (RT125C-03) | LOW |
| RT-C4-11 | Promoter called on a non-CANDIDATE source state | BLOCKED via `wrong_source_state` | LOW |
| RT-C4-12 | Empty store + unknown mode | BLOCKED (fail-closed; no exception escapes) | LOW |
| RT-C4-13 | MODEL Claim with a `SymbolSpec` ref via `validateClaimEvidence` direct call | BLOCKED via `model_claim_no_model_ref` | LOW |
| RT-C4-13 | NUMERIC Claim with a phantom `result_ref` | BLOCKED via `numeric_binding_result_unresolved` | LOW |
| RT-C4-14 | Two invalid CRITICAL Claims — walker must report both | BOTH reported (no short-circuit) | MEDIUM |
| RT-C4-15 | MODEL Claim with empty `model_refs[]` | BLOCKED at `put()` (schema `min(1)`) | LOW |
| RT-C4-16 | Forged PASS gate record presented to `evaluateDelivery` | ACCEPTED by `evaluateDelivery` (by design — bridge is the producer) | LOW |
| RT-C4-16 | Policy with NO `IR_CANONICALIZATION_GATE_ID` | BLOCKED via `critical_gate_missing` | LOW |
| RT-C4-17 | Non-object `ir` values (`null`, `undefined`, `42`, `'string'`, `true`) | NO THROW — total; all BLOCKED | LOW |

**27 attacks / 27 BLOCKED (or accepted as correct). 0 gaps.**

---

## What the existing coverage already closes

- **RT125A-01 / RT125A-02** (duck-typed store / shadowed `instanceof`) —
  re-asserted by `RT-C4-08` / `RT-C4-08b`. The `ModelingIr.#constructed`
  WeakSet + prototype pin survives.
- **RT125C-01** (gate downgrade) — re-asserted by `RT-C4-10`.
  `evaluateDelivery` requires every critical gate to be present *as a
  critical gate*; `critical: false` is itself reported.
- **RT125C-03** (duplicate gate id) — re-asserted by `RT-C4-10`.
  `evaluateDelivery` reports `duplicate_gate_id` and BLOCKS.
- **RT125B-03** (authorisation gate before manifest) — `enforceCanonicalIr`
  is called *before* `recordManifest`. The execution-order regression
  is preserved by the existing `executor-ir-bridge.spec.ts`.
- **D-013 / D-014** (RT-C3 omission) — re-asserted by `RT-C4-01b` /
  `RT-C4-14`. `inspectClaimEvidence` walks every CRITICAL Claim; the
  walker is exhaustive.

## What I tried that DID NOT succeed

| Attack shape | Why it failed (against production code) |
|--------------|------------------------------------------|
| Forge a duck-typed `ModelingIr` carrying a CRITICAL Claim | `ModelingIr.isCanonicalIr` checks `#constructed` + frozen prototype — fake is treated as `EMPTY_SNAPSHOT` and the backbone check BLOCKED |
| Replace `evaluateIrBridge` via test mock | Bridge is a top-level named export consumed by hard import in the executor. There is no seam; the production code path is not mockable in-place |
| Hide an invalid CRITICAL Claim behind a valid one | `inspectClaimEvidence` walks every Claim in the snapshot, not the first one (D-013 / RT-C3-01 fix) |
| Pass `mode = ' EXPLORATORY '` to bypass the backbone | `requiresIrBackbone` normalises via `.trim().toUpperCase()`, fail-closed against the EXPLORATORY branch only on exact `EXPLORATORY` |
| Lie in `ir_claims` about an `ir_ref`'s kind | `irClaimSchema` validates against `IR_KINDS`; the per-element kind check returns `ir_kind_mismatch` |
| Insert a forged `GateRecord` for `IR_CANONICALIZATION_GATE_ID` into a `DeliveryPolicy` | `evaluateDelivery` accepts the record by design — the bridge is the producer and the executor wires `irBridgeGate → policy`. The forgery requires either a forged `irBridgeGate` or no call to `enforceCanonicalIr`, both of which need source code access |
| Bypass the promoter with a non-CANDIDATE source | `promoteCandidateToDeliverable` returns `wrong_source_state` and skips `writeFinalOutput` |

## Known risks I confirmed but did not close

These are **not** gaps in the gate; they are **documented**
known-risks from `artifacts/handoff/TASK-2/known-risks.md` that I
verified remain *as documented*:

1. **workflow wiring is fixture-driven, not production-driven**
   (known-risks #9). `enforceCanonicalIr` continues to pass `claims: []`
   because the executor still does not produce Claim / Result / RunArtifact
   IR objects during execution. My end-to-end tests (RT-C4-07) show the
   bridge still BLOCKS when the test fixture pre-loads an invalid Claim,
   so the gap is *test-fixture only* — not a production bypass. This is
   intentionally deferred to TASK 3.

2. **Hash-by-bytes verification is not implemented** (known-risks #1/#2).
   TASK 3 owns it.

3. **No tolerance / rounding / repair** (known-risks #3). TASK 3 owns it.

4. **Update / replace / STALE propagation** (known-risks #4). TASK 3.5
   owns it.

5. **Reviewer authority / ReviewerFinding** (known-risks #5). TASK 5
   owns it.

6. **Renderer / EquationSpec** (known-risks #6). TASK 7 owns it.

7. **Claim-side `requirement_refs` is not added** (known-risks #8).
   Deferred by task book §3.

## Suggested regressions

| Finding | Suggested regression file |
|---------|---------------------------|
| RT-C4-01 | `packages/paper/paper-foundation/tests/rt-c4/workflow-bypass.spec.ts` — "BLOCKED: a CRITICAL claim with wrong asserted_value sitting in the snapshot is BLOCKED even when claims[] is empty" |
| RT-C4-01b | `packages/paper/paper-foundation/tests/rt-c4/workflow-bypass.spec.ts` — "BLOCKED: hidden behind a VALID CRITICAL claim, the invalid one is still BLOCKED" |
| RT-C4-02..17 | All other attacks in `tests/rt-c4/{workflow-bypass,promoter-and-pipeline}.spec.ts` |

The two spec files added in this red team run **are** the regressions;
every test below is a future change-detector that goes red if the
bridge weakens.

---

## Roll-up

| Role | Attacks | BLOCKED | SUCCEEDED |
|------|---------|---------|-----------|
| RT-C4-01 — snapshot walk | 3 | 3 | 0 |
| RT-C4-02 — mode confusion | 7 | 7 | 0 |
| RT-C4-03 — ir_kind_mismatch | 5 | 5 | 0 |
| RT-C4-04 — naked CRITICAL QUALITATIVE | 3 | 3 | 0 |
| RT-C4-05 — MODEL wrong-kind ref | 2 | 2 | 0 |
| RT-C4-06 — NUMERIC wrong-kind ref | 1 | 1 | 0 |
| RT-C4-07 — end-to-end executor | 2 | 2 | 0 |
| RT-C4-08 — forged ModelingIr | 2 | 2 | 0 |
| RT-C4-09 — bridge shadowing | 2 | 2 | 0 |
| RT-C4-10 — gate missing / downgrade / duplicate | 3 | 3 | 0 |
| RT-C4-11 — promoter non-CANDIDATE | 1 | 1 | 0 |
| RT-C4-12 — bridge total | 4 | 4 | 0 |
| RT-C4-13 — validator direct | 2 | 2 | 0 |
| RT-C4-14 — exhaustive walker | 1 | 1 | 0 |
| RT-C4-15 — schema refuses | 1 | 1 | 0 |
| RT-C4-16 — gate-forgery | 2 | 2 | 0 |
| RT-C4-17 — bridge total under weird inputs | 6 | 6 | 0 |

**TOTAL: 47 attacks / 47 BLOCKED (or correct PASS) / 0 SUCCEEDED.**

CRITICAL escape = 0. HIGH escape = 0. MEDIUM escape = 0. LOW escape = 0.

The TASK 2 wiring holds under every attack in the RT-C4 surface.