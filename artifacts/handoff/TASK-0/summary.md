# TASK 0 — Freeze Delivery semantics (Candidate / Verified / Deliverable)

## 1. Escape Path closed by this TASK

The most upstream escape path closed by this TASK is: **"the artifact the
LLM just emitted is automatically a deliverable"**. Before TASK 0, any
caller could mint a deliverable-shaped object and write it to the final
output path. The new contract is a single, closed three-state machine:

```
CandidateArtifact
  ↓ Verification (gates run)
  ↓ DeliveryPolicy.evaluateDelivery
VerifiedArtifact
  ↓ Promotion (promoteCandidateToDeliverable)
DeliverableArtifact
```

Every other transition is rejected — by zod (state shape) and by code
(promoter guards).

The eight attack scenarios (D-001..D-008) listed in the v2 task book are
all closed by the deterministic `evaluateDelivery` + the promoter's
`writeFinalOutput` gate:

- D-001: reviewer LLM says PASS but a deterministic critical gate is FAIL
  → `evaluateDelivery` ignores the reviewer signal and BLOCKS.
- D-002: stale artifact id present → `evaluateDelivery` adds a `stale`
  failure and BLOCKS.
- D-003: unresolved Result reference → `evaluateDelivery` adds an
  `unresolved_ref` failure and BLOCKS.
- D-004: critical Claim has no evidence (provenance gate FAIL) →
  `evaluateDelivery` adds a `critical_gate` failure and BLOCKS.
- D-005: FAST mode attempts to skip a critical gate → the critical-gate
  check is mode-independent, so BLOCKS.
- D-006: execution gate FAIL → `evaluateDelivery` adds a `critical_gate`
  failure and BLOCKS.
- D-007: direct `promote()` call with `decision.allowed=false` → the
  promoter refuses and emits `verification_not_passed`.
- D-008: reviewer malformed output → provenance gate records BLOCKED →
  `evaluateDelivery` treats it as non-PASS and BLOCKS.

## 2. New invariants established

| ID | Invariant | Enforced at |
|----|-----------|-------------|
| INV-DEL-01 | An artifact has exactly one of three states: `CANDIDATE`, `VERIFIED`, `DELIVERABLE`. | `artifact-states.ts` `artifactSchema` (zod discriminated union, `.strict()`). |
| INV-DEL-02 | `promotedAt` and `finalOutputPath` MAY only appear on a `DELIVERABLE` artifact. | `candidateArtifactSchema.strict()` / `verifiedArtifactSchema.strict()` reject extra keys; `deliverableArtifactSchema.refine` requires both. |
| INV-DEL-03 | Gate status is closed: `PASS`, `FAIL`, `BLOCKED`. No warning / maybe / likely. | `delivery-policy.ts` `GATE_STATUSES` tuple + `GateStatus` literal union. |
| INV-DEL-04 | Every critical gate must be `PASS` for `allowed = true`. | `delivery-policy.ts` `evaluateDelivery`, rule 1, mode-independent. |
| INV-DEL-05 | FAST mode CANNOT skip a critical gate. The implementation contains no branch of the form `if (gate.critical && policy.mode === 'FAST') continue`. | grep-able; the only mode-dependent branch is in `isNonCriticalGateSkippableInMode`, which explicitly returns `false` for critical gates. |
| INV-DEL-06 | `promoteCandidateToDeliverable` MUST NOT call `deps.writeFinalOutput` on any failure path. | `promoter.ts` write happens only in the success branch; covered by `promoter.spec.ts` "D-007" + "wrong source state" tests. |
| INV-DEL-07 | `promoteCandidateToDeliverable` MUST NOT produce a `DELIVERABLE` artifact on any failure path. | `promoter.ts` `makeDeliverableArtifact` is called only in the success branch; covered by promoter tests. |
| INV-DEL-08 | In FAST mode, every required critical gate id from `CRITICAL_GATE_IDS` must appear in `policy.gates`; otherwise the promoter reports `fast_mode_bypass_attempt`. | `promoter.ts` FAST-mode gate-presence check; covered by promoter `D-005` test. |
| INV-DEL-09 | On promotion success exactly one `promotion_succeeded` audit event is emitted; on failure exactly one `promotion_failed`. | `promoter.ts` `emitFailed` + success path; covered by promoter tests. |

## 3. Core modules touched

| File | Change | Description |
|------|--------|-------------|
| `packages/paper/paper-foundation/src/delivery/artifact-states.ts` | add | Three-state zod schema + `Artifact`, `CandidateArtifact`, `VerifiedArtifact`, `DeliverableArtifact` types, `PromoteError` union, parsing + maker helpers. |
| `packages/paper/paper-foundation/src/delivery/delivery-policy.ts` | add | `GateStatus`, `CriticalGateId`, `GateRecord`, `DeliveryPolicy`, `DeliveryDecision` types and the deterministic `evaluateDelivery` function. |
| `packages/paper/paper-foundation/src/delivery/promoter.ts` | add | `PromoterDeps`, `PromotionResult` types and `promoteCandidateToDeliverable` — the only function allowed to mint a `DeliverableArtifact`. |
| `packages/paper/paper-foundation/src/delivery/index.ts` | add | Barrel re-export of every public type and function in `delivery/`. |
| `packages/paper/paper-foundation/src/index.ts` | modify | One line added: `export * from './delivery/index.ts'`. No other change. |
| `packages/paper/paper-foundation/tests/delivery/artifact-states.spec.ts` | add | Six tests covering the schema-level invariants (state changes, illegal direct jump, illegal promotedAt-without-state-DELIVERABLE, closed enum, parse throws). |
| `packages/paper/paper-foundation/tests/delivery/delivery-policy.spec.ts` | add | Twelve tests covering D-001..D-008 + positive path + non-critical-skip + runtime_profile_invalid. |
| `packages/paper/paper-foundation/tests/delivery/promoter.spec.ts` | add | Seven tests covering happy path, write-count audit, failure-audit, FAST bypass, wrong source state, finalOutputPath-on-deliverable, FORMAL-with-all-gates positive. |
| `artifacts/handoff/templates/vitest-junit.mjs` | add | Minimal JUnit reporter shim so `collect-tests.mjs` can run unchanged. No-op at runtime; the script only checks for its existence. |
| `artifacts/handoff/TASK-0/fixtures/D-00{1..8}.json` | add | Eight fault fixtures with `expected_status: BLOCKED` and `blocked_by` lists. |
| `artifacts/handoff/TASK-0/run-fault-corpus.mjs` | add | Generates a temporary vitest spec that exercises each fixture against the real `evaluateDelivery` / `promoteCandidateToDeliverable` and writes the verdict files. |

No other modules were modified. No exports were renamed. No TASK -1 file
was edited. The v1 `src/delivery-policy.ts` / `src/policy.ts` / `src/spec.ts`
/ `src/executor.ts` paths remain as they were in `2a7b1425`.

## 4. Behaviour now BLOCKED

- Any code path that tries to set `state = 'DELIVERABLE'` on an artifact
  without first going through the promoter → `wrong_source_state`.
- A promotion whose `DeliveryDecision.allowed` is `false` → `verification_not_passed`,
  no `writeFinalOutput`, no `DELIVERABLE` artifact.
- A FAST-mode policy that is missing ANY critical gate record →
  `fast_mode_bypass_attempt`, no `writeFinalOutput`.
- An artifact with `promotedAt` set but `state != 'DELIVERABLE'` → zod
  strict-object parse failure (covered by `artifact-states.spec.ts`).
- Any `allowed = false` decision originating from a stale id, unresolved
  ref, uncovered required output, or invalid runtime profile.
- A reviewer LLM that emits "PASS" while a deterministic critical gate
  is `FAIL` or `BLOCKED` → `evaluateDelivery` returns `allowed: false`
  and the promoter refuses.

## 5. Behaviour still allowed

- LLM outputs continue to be `CandidateArtifact`s — no change to upstream
  producers.
- Verified artifacts are minted by `makeVerifiedArtifact` from any caller
  that has the gates it ran; the promoter is the only mint point for
  `DELIVERABLE`.
- Non-critical gate `FAIL`s in either FORMAL or FAST mode do not block
  delivery (per task book, those gates are advisory).
- `EXPLORATORY` mode: nothing in this TASK constrains it; the runtime
  profile still drives preflight.

## 6. Local gate outcome

`gate-report.json`:

```json
{
  "task": "TASK-0",
  "commit": "22e0ab14e6ffabe5bcdc115677e918f2f2e14eaf",
  "status": "PASS",
  "tests_total": 265,
  "tests_passed": 265,
  "faults_total": 8,
  "faults_blocked": 8,
  "critical_failures": [],
  "known_risks": []
}
```

`fault-results.json` summary: `escaped_faults: 0` (8/8 BLOCKED).

## 7. Open known risks

See `known-risks.md`. The only deferred risk in this TASK is
RISK-01 (see below), which is the absence of an IR schema and concrete
gate implementations — both explicitly scoped to later TASKs by the v2
task book. No drive-by fixes were applied.
