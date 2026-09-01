# TASK 2.1 — Summary

## One-line conclusion

**The Evidence Chain is now frozen and independently auditable**: every
CRITICAL claim's chain (Claim → Result → Run) carries a stable
`evidence_chain_hash` (INV-2.1-A), a read-only auditor re-derives every
fingerprint from a live snapshot and fails closed on any drift
(substitution / replay / partial evidence / self-approval), and the
manifest's `manifest_hash` is the out-of-band trust anchor that makes
"producer ≠ auditor" enforceable.

## Layer positioning

| Layer | Task | Question it answers |
|-------|------|--------------------|
| Evidence Structure | TASK 2 | Is the claim *structurally* bound to a canonical Result? |
| **Evidence Trust** | **TASK 2.1** | **Is the binding still the frozen one — provable to an independent auditor?** |
| Execution Reality | TASK 3 | Was the Result actually produced by the run's code? |

## What was built

| Phase | Deliverable | Where |
|-------|-------------|-------|
| 0 | Freeze manifest (claim/result/run layers + per-chain hashes) | `src/ir/evidence-freeze.ts` `buildEvidenceFreeze` + `evidence-freeze-manifest.json` |
| 1 | Evidence Auditor (read-only, total, closed failure taxonomy) | `src/ir/evidence-freeze.ts` `auditEvidenceFreeze` |
| 2 | INV-2.1-A freeze integrity (hash flips on any chain change) | `tests/ir/evidence-freeze.spec.ts` + `evidence-chain-map.md` |
| 3 | External attack suite RT-E1..E4 (13 attacks, all detected) | `tests/rt-e/evidence-attacks.spec.ts` |
| 4 | Agent Task Card + audit procedure | `audit-checklist.md` |
| 5 | TASK 3 preview (roadmap only — NOT started, per STOP RULE) | `task-3-preview.md` |

## Verification matrix

| Check | Result |
|-------|--------|
| `tsc --noEmit -p packages/paper/paper-foundation/tsconfig.json` | **0 errors** |
| Unit suite `tests/ir/evidence-freeze.spec.ts` | **27 / 27 PASS** |
| Attack suite `tests/rt-e/evidence-attacks.spec.ts` | **13 / 13 detected** |
| Targeted mutations E-01..E-08 | **8 / 8 killed, 0 survived** |
| Freeze of the canonical example chain → audit | **PASS (1 critical claim, 0 failures)** |
| Full paper-foundation regression | **63 files / 775 tests PASS** (TASK 2 baseline 61/735 preserved) |

## Artifact map

```
artifacts/handoff/TASK-2.1/
├── evidence-freeze-manifest.json   ← the frozen snapshot (generated)
├── evidence-chain-map.md           ← human-readable chain + hashes (generated)
├── audit-checklist.md              ← Agent Task Card + audit procedure (Phase 4)
├── freeze-hash-report.json         ← out-of-band hash registry (generated)
├── summary.md / invariant.md / gate-report.json / task-3-preview.md
├── generate-freeze.mjs             ← regenerates the three generated artifacts
├── run-mutations.mjs               ← E-01..E-08 runner
└── mutation-results.json           ← 8/8 killed evidence
```

## Known limits (honest ledger)

- `environment_hash` / `dependency_lock_hash` are freeze-time
  fingerprints over **declared** metadata. They prove "the declaration
  did not change", not "the code ran". TASK 3 owns execution reality.
- The freeze covers evidence chains, not the entire store; adding an
  unrelated object post-freeze does not fail a claim audit (by design).
- A self-consistent manifest fabricated from tampered evidence passes a
  naive audit; only the out-of-band `manifest_hash` comparison (Step 0.3
  of the checklist) refuses it. This is the RT-E4 trust boundary.
