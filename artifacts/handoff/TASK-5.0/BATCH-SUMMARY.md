# TASK 5.0 batch — delivery package

**Commit**: `69f82d7547` (5.0.5/6/7/11 + capture-path rewrites) plus the
follow-up 5.0.8 commit (see git log). Note: `origin/main` was moved to
`ebfd11c18d` during mid-batch repository housekeeping; the local branch
still carries every commit and is 30 ahead of that remote reset.
**Date**: 2026-09-03
**Scope**: TASK 5.0.5 + 5.0.6 + 5.0.7 + 5.0.8 + 5.0.11, the 3.R3
capture-path rewrites (5.0.3a), and one load-bearing upstream
test-harness fix.

## What was picked up and why

The TASK 5.0 handoff (`artifacts/handoff/TASK-5.0/handoff.md`, read
end-to-end together with TASK-INDEX, EXTERNAL-REVIEW and the RG-06/RG-07
verifier) paused mid-flight on 5.0.5: the executor called
`promoteCandidateToDeliverable` but referenced a `persistFinal` that did
not exist, a `FINAL_OUTPUT_PATH` that was not declared, a `decision`
variable that was never bound, and passed a `RunPolicy` where the promoter
requires a `DeliveryPolicy` — 7 tsc errors, 12 executor-level test
failures. This batch closes that and continues through the sub-task
order as far as the frozen v1.0 task book allows (5.0.1 / 5.0.4 / 5.0.10
stay DEFERRED until the v1.1 amendment is signed).

## Landed sub-tasks

- **5.0.5 promoter wiring (DONE)** — `enforceDelivery` returns the one
  `{policy, decision}` verdict and the promoter receives that same pair
  (INV-3-K, no re-evaluation); `persistFinal` + `FINAL_OUTPUT_PATH`
  added; `persistFinal` is reachable only through the promoter's
  `writeFinalOutput` (INV-014) and records path/bytes/digest on the
  audit trail; audit vocabulary gained `promotion_succeeded`,
  `promotion_failed`, `final_output_written`; unknown promoter events
  are refused, not relabelled.
- **5.0.6 test:task3 + CI (DONE)** — the aggregator pointed at a
  non-existent path (`artifacts/handoff/TASK-3.1/run-3-of-3.ts`); it now
  chains fault-corpus → mutations → replay-smoke → report-state, and
  `.github/workflows/paper-harness.yml` runs all four on PR/push.
- **5.0.7 §12 handoff (DONE)** — `redteam.md` + `redteam-rt-x1..x4.md`
  extracted from the executed attack suite, `baseline-summary.txt`
  regenerated from a real run.
- **5.0.11 runtimeProfileValid (DONE)** — `buildDeliveryPolicy` takes the
  guard's real readiness and defaults to REFUSAL when not told (INV-3-O;
  the hardcoded `true` made `runtime_profile_invalid` unreachable);
  `PaperRuntimeGuard.isReady()` added; RG-08 regression tests added.
- **5.0.3a capture-path closure (DONE)** — `store.spec` full-chain ingest
  moved onto `putExecutionRecord(record, CAPTURE_ATTESTATION)`;
  provenance-gate capture-path tests onto `ingestCapturedRecord`.
- **5.0.8 delivery_replay_max_age (DONE)** — `DeliveryPolicy` carries a
  `replayedAt` / `deliveryReplayMaxAgeMs` pair; `evaluateDelivery`
  refuses missing or stale replay evidence under any declared window
  (`replay_stale`, deterministic under an injected clock — EX-25..27);
  `buildDeliveryPolicy` never invents evidence (no evidence → no
  obligation; evidence offered without a window → 24h
  `DEFAULT_REPLAY_MAX_AGE_MS`; explicit `null` → waiver). The
  enforcement point is the composition that runs the auditor and can
  offer `ExecutionAuditReport.replayed_at`.
- **5.0.2 re-synchronisation** — gate-report baseline updated to the
  measured suite; every number now traces to a real run.

## Verification evidence

- `tsc -p packages/paper/paper-foundation/tsconfig.json --noEmit` — clean.
- `verify-report-state.mjs` (RG-06 + RG-07) — **PASS**
  (`vitest 860/871, 11 failures match gate-report`), run and re-run.
- Suite: 71 files / 871 tests / **11 documented failures** (was 26 at the
  start of the 5.0 batch): 7 pre-existing IR-contract tests in
  `redteam15.spec.ts`, 4 stale-engine alignment tests blocked on the
  v1.1 forge factory (5.0.4). Zero capture-path or executor failures.
- Push note: the earlier `f5bb654578..69f82d7547` push was superseded by
  the mid-batch remote reset of `origin/main` to `ebfd11c18d`; see the
  inventory in the delivery message.

## Load-bearing upstream fix (declared, not drive-by)

`scripts/test-invariants.ts`: `service-guards.spec.ts` added to
`MANUAL_INVARIANT_TEST_EXCEPTIONS`. The suite constructs its own
invariant topology by hand; racing the setup's auto-mount made the
failure count non-deterministic (11 vs 12, "package is already
registered"). Root cause, measurements and consequences are documented
in `artifacts/handoff/TASK-2.1/known-risks.md` items 17–19.

## Next pickup point

1. **5.0.9** FigureSpec `data_hash` required + real comparison (F05/F11).
2. **5.0.1 / 5.0.4 / 5.0.10** remain blocked on v1.1 ratification.

## Files in this package

See `file-list.txt` (repo-relative paths, A = added, M = modified).
