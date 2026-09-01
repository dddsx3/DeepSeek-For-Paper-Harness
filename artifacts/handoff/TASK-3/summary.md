# TASK 3 — Summary

## One-line conclusion

**The Execution Provenance Gate is closed**: every Result reachable from
a CRITICAL Claim's chain now requires a canonical `ExecutionRecord`
(IR kind #12) produced only through the capture seam, verified
structurally by the new `provenance` critical gate at delivery, and
verified at byte level by an independent replay auditor. A REAL node
process was captured, replayed, and verified end-to-end (C5 evidence).

## The chain, closed

```
Claim ─(TASK 2 binding)→ Result ─(1.5R closure)→ RunArtifact
                                                    │ run_ref / input closure (store)
                                            ExecutionRecord          ← canonical kind #12
                                                    │
                                            ExecutionRunner seam     ← the only way code runs
                                                    │
                                            Replay Verifier          ← byte truth (8 conditions)
                                                    │
                                            ExecutionAuditReport     ← closed taxonomy, fail-closed
                                                    │
                                        provenance critical gate      ← delivery refuses without it
```

## What was built

| Phase | Deliverable | Verified by |
|-------|-------------|-------------|
| 0 | Topology recon + conformance findings F-1/F-2 (recorded, not silently patched) | `phase-0-topology.md` |
| 1 | `ExecutionRecord` canonical kind #12 (schema/refs/fixtures/ID map) | `tests/ir/execution-record.spec.ts` 14/14 |
| 2 | `src/execution/runner.ts` seam + `capture.ts` (the only producer; no hand-written `exit_status` path exists) | `capture-replay.spec.ts` |
| 3 | `replay.ts` — 8 PASS conditions + D7 Result-value extraction | `capture-replay.spec.ts` |
| 4 | `audit.ts` — manifest + structural audit + `provenance` gate + executor wiring | `provenance-gate.spec.ts` 15/15 |
| 5 | EX-01..EX-12 + RT-X1..X4 attack suite | `tests/rt-x/` — 48 corpus tests green |
| 6 | Mutations P-01..P-08 | **8/8 killed, 0 survived** |
| 7 | Full regression + handoff | 68 files / 838 tests PASS |

## Verification matrix

| Check | Result |
|-------|--------|
| `tsc --noEmit` (paper-foundation) | 0 errors |
| Full regression | **68 files / 838 tests PASS** (TASK 2.1 baseline 63/775 preserved) |
| Fault corpus (EX + RT-X, via `run-fault-corpus.mjs`) | **48 / 48 intercepted** |
| Targeted mutations P-01..P-08 | **8 / 8 killed, 0 survived** |
| Real-process smoke (`run-real-execution-smoke.mjs`) | **CHAIN CLOSED — replay PASS on a real node child** |
| Execution freeze manifest (`generate-execution-freeze.mjs`) | structural audit PASS, `manifest_hash = 22c5a958…` |

## Mutation-testing lessons (recorded for the next round)

- **P-08 SURVIVED** on first run: the audit-side dependency guard had no
  direct test (EX-04/04b only exercised replay). Fixed with EX-04c
  (survivor = missing test, never "the guard is fine").
- **P-03/P-04 falsely "killed"** on first run by a 30s real-process
  timeout flake — a machine artifact masquerading as a kill. Fixed by
  moving the real-process smoke out of the vitest suite
  (`local-runner.spec.ts` keeps the pure-logic contract; the smoke is a
  standalone script). Mutation runs are now deterministic.
- **P-02 masked by the value-extraction check** (diverging bytes also
  diverged the parsed value). Fixed with EX-06b: whitespace-only byte
  divergence that ONLY the output-hash check can catch.

## Honest boundaries (full ledger in known-risks.md)

- Delivery-gate ≠ replay: the delivery gate is structural; byte truth is
  the independent auditor's replay. A forger who copies every declared
  fingerprint passes the gate (RT-X1-01, documented) and is refused by
  replay (RT-X1-02).
- Runtime-fingerprint pinning covers capture-vs-replay drift; pinning
  "declared == reality" needs a dependency-manifest convention (TASK 4+).
- There is a staleness window between the last replay and delivery; the
  manifest_hash anchor lets an external auditor close it out-of-band.
