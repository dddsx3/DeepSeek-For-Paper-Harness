# TASK 1.25 — Canonical IR Enforcement Bridge

## 1. The escape this task closes

Raised by the external advisor as the project's new **P0 architecture escape**,
`IR_CAN_BE_BYPASSED` (a direct consequence of RISK-14 in the TASK 1 handoff):

```
            ┌──────────────────────┐
            │ very solid ModelingIr │
            └──────────┬───────────┘
                       │  nobody is required to use it
                       ▼
LLM → raw executor → text artifact → review → paper
```

> "非法对象无法进入 canonical state" is true, but "论文必须来自 canonical state"
> is not. That is a vacuous security property.

**Forensics before fixing** confirmed the advisor's diagnosis against the
running code: `WorkflowExecutor.deliver(runId, text)` stored the model's final
text as `ArtifactRecord{kind:'text'}` and built a manifest from it without
consulting `ModelingIr` even once. No gate, no schema, no reference ever stood
between the model's prose and the delivered paper.

**Scope discipline.** Per the advisor, this task does NOT extend the ontology
(TASK 1.5) and does NOT build the Claim→Result→Run evidence chain (TASK 2). It
answers one question only: *can the workflow still reach Deliverable while
ignoring the IR?* After this task: no, in FORMAL and FAST mode.

## 2. The three invariants

| ID | Invariant | Enforced by |
|----|-----------|-------------|
| INV-1.25-A | **no fake IR** — anything the workflow claims to be an IR object must carry a canonical identity: `irClaimSchema {artifact_id, ir_kind, ir_ref}`, and `ModelingIr.get(ir_ref)` must exist with `record.kind === ir_kind`. A `{type:'claim', content:'…'}` blob can no longer pose as a Claim. | `src/ir/bridge.ts` `evaluateIrBridge` |
| INV-1.25-B | **no bypass** — in FORMAL and FAST mode, delivery requires a canonical backbone: `ProblemSpec ≥ 1, ModelSpec ≥ 1, RunArtifact ≥ 1, Result ≥ 1, Claim ≥ 1`, plus ≥ 1 `CRITICAL` claim. EXPLORATORY is exempt (no fact asserted yet); A still applies to it. | same, via `requiresIrBackbone` |
| INV-1.25-C | **no missing / downgraded / duplicated critical gate** — `evaluateDelivery` previously inspected only the gates it was handed and only skipped non-critical ones, so a caller could (a) omit `ir_canonicalization` entirely, or (b) forge it with `critical: false`. Both are now failures, as are duplicate gate ids, whose verdict would otherwise depend on array order. | `src/delivery/delivery-policy.ts` `evaluateDelivery` step 1a |

INV-1.25-C is the one place TASK 1.25 touches TASK 0 code; it is in scope
because without it INV-A/B are unenforceable (a gate that can be forgotten or
downgraded is not a gate). TASK 0 itself stays CLOSED. Note that the old
docstring already *promised* "if a non-PASS critical gate is missing, that
itself is a failure" — nothing implemented it. That comment-to-code gap is
exactly the kind of thing the red-team round is for.

## 3. Mechanism — no new gate machinery

`ir_canonicalization` is an ordinary member of TASK 0's `CRITICAL_GATE_IDS`.
The bridge (`src/ir/bridge.ts`) evaluates it and emits a `GateRecord`; from
there TASK 0's existing machinery does the rest: FAST cannot skip critical
gates, and `promoter` — the only mint of `DeliverableArtifact` — refuses on
any non-PASS.

The `WorkflowExecutor` is wired in three places, all minimal:

1. `ExecutorOptions.ir?: ModelingIr` — the canonical store, injected by
   composition. **A composition that mounts no store is treated as an empty
   one**: in FORMAL/FAST that means "no canonical state", so the run is
   blocked rather than waved through. An optional dependency that defaulted to
   "allow" would itself have been the escape.
2. `enforceCanonicalIr(runId, mode)` runs **before** the review verdict is
   applied — the red team (RT125B-02) found that checking after review
   persisted a manifest even for rejected text. On failure it audits
   `ir_bridge_blocked`, fails the run, and throws `gate-failed`.
3. `engine.authorizeDelivery(runId, {gates})` — delivery is now an
   *authorised* act. `recordManifest` refuses (`WorkflowManifestUnauthorizedError`)
   unless the engine has recorded an authorization naming the gates that
   passed (RT125B-03): a manifest cannot be written by a path that never went
   through the gates.

IR claims are `[]` in the executor for now — TASK 2 introduces the evidence
chain that populates them, and INV-1.25-A is exercised directly by the bridge
suite until then. That is stated here rather than glossed: A is *mechanism
complete* but *input-vacuous* until TASK 2, while B is fully live today.

## 4. Red-team round (mandatory, real execution)

The bridge's own suite (21 tests) proves the invariants hold for a
well-behaved caller. The red-team round proved they hold against an adversary,
and found **two real product holes** plus harness defects, all folded into
`tests/ir/redteam125.spec.ts` (13 regressions):

| Finding | Class | Exploit (executed) | Fix |
|---|---|---|---|
| RT125C-01 | product | `{id:'ir_canonicalization', status:'PASS', critical:false}` satisfied the id-presence check and was then skipped by the `critical` filter — a forged gate that both silenced the missing-gate failure and escaped the status check. | `evaluateDelivery` now requires each critical id to be present **as a critical gate**; a downgraded one is a `critical_gate_downgraded` failure. |
| RT125C-03 | product | two entries sharing one id made the verdict depend on array order. | `duplicate_gate_id` failure for any id with more than one record. |
| RT125B-02 | product | bridge ran *after* review, so a rejected run still persisted a manifest. | bridge moved before the review verdict; failed runs leave no manifest. |
| RT125B-03 | product | `recordManifest` accepted a manifest from a path that never passed a gate. | delivery authorization is recorded durably; `recordManifest` throws `WorkflowManifestUnauthorizedError` without it. |
| RT125A-01..04 | product | duck-typed / hostile / throwing stores fed to the bridge. | bridge reads only `get`/`list` through a narrow surface and never trusts a store beyond one call; `evaluateIrBridge` is total. |
| harness | agent defect | red-team harness mounted `WorkflowEngineService` without `PaperFoundationService` (its `inject`), and imported `IR_CANONICALIZATION_GATE_ID` from the wrong barrel so the constant was `undefined` — several assertions silently passed on `undefined === undefined` comparisons. | fixed in the spec; noted because a silently-`undefined` constant in an adversarial test is itself a lesson: assert imports resolve before trusting a green run. |

Mutation-style spot checks were also applied: removing the bridge call from
`enforceCanonicalIr` or the `critical_gate_missing` loop turns the executor and
policy suites red (asserted by `bridge.spec.ts` "a critical gate cannot be
omitted" and the executor tests that now expect `gate-failed` without a store).

## 5. Verification summary

| Check | Result |
|---|---|
| `packages/paper` suite | 46 files, **462 passed / 462** (420 before TASK 1.25, +42) |
| Fault corpus B-001..B-008 | **8/8 BLOCKED**, `escape_rate = 0`, runner asserts verdicts |
| Red-team regressions | 13/13 in `tests/ir/redteam125.spec.ts` |
| Delivery without canonical IR (FORMAL/FAST) | blocked end-to-end: bridge → policy → promoter, no `DeliverableArtifact`, no manifest, no file write |
| EXPLORATORY without IR | allowed (by design) |

## 6. What is still open (honest ledger)

- **INV-1.25-A is mechanism-complete but input-vacuous until TASK 2**: the
  executor currently passes `claims: []`, because the workflow does not yet
  *make* IR claims. B is fully live. TASK 2 must populate claims from the
  paper text, and its fault corpus must include a forged-claim attack.
- The executor passes no IR artifacts into the run yet, so the backbone in B
  must be registered by whoever composes the executor — wiring
  `PaperIrBridge`/`ModelingIr` into `executor-service.ts` composition is part
  of this task, and a composition that forgets it gets blocked, not skipped.
- `subproblem_id`/`output_id` scoping, external-locator hashing, and the other
  TASK 1.5 / TASK 3 items are unchanged from `TASK-1/known-risks.md`.

Sequence after this task, per the advisor: **TASK 1.5 → TASK 2**, with the
External Attack Gate as the final arbiter of TASK 1.25.
