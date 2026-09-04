# External Review Package — TASK 2 + TASK 2.1 (TASK 3 Unlock Audit)

> **Audit entry point.** This package contains everything needed to
> independently decide one question:
>
> **Can TASK 3 (Execution Provenance Gate) start directly after this
> audit passes, with no leftover work from TASK 2 / TASK 2.1?**

## 1. Scope under review

| Round | Commits (all pushed to `origin/main`) | Subject |
|-------|--------------------------------------|---------|
| TASK 2 | `dc6780d2c5` feat · `b7d19099fe` docs · `a7a54c8936` test · `1032dde581` docs | Claim → Result → Run Evidence Chain (structure) |
| TASK 2.1 | `e61df1df44` feat · `4f64b72315` docs | Evidence Chain Freeze Audit + Independent Verification (trust) |

Repository HEAD at packaging time: `4f64b72315`, working tree clean,
`origin/main` in sync.

## 2. Verification commands (PowerShell, repo root)

```powershell
cd "<repo>"

# types
node_modules\.bin\tsc --noEmit -p packages/paper/paper-foundation/tsconfig.json

# full regression (expected: 63 files / 775 tests PASS)
$env:NODE_OPTIONS="--max-old-space-size=4096"
corepack pnpm exec vitest run --project=thread-safe --maxWorkers=1 --no-file-parallelism packages/paper/paper-foundation/

# TASK 1.5R reference-closure fault corpus (expected 18/18)
node_modules\.bin\tsx artifacts/handoff/TASK-1.5R/run-fault-corpus.mjs "<repo>"

# TASK 2 fault corpus D-001..D-020 (expected 20/20)
node_modules\.bin\tsx artifacts/handoff/TASK-2/run-fault-corpus.mjs "<repo>"

# TASK 2 targeted mutations (expected 16/16 killed; ~4 min)
node artifacts/handoff/TASK-2/run-mutations.mjs "<repo>"

# TASK 2.1 targeted mutations (expected 8/8 killed)
node artifacts/handoff/TASK-2.1/run-mutations.mjs "<repo>"

# regenerate + re-audit the freeze snapshot (expected: audit PASS,
# manifest_hash 0b3bfbe99b4b… unchanged)
node_modules\.bin\tsx artifacts/handoff/TASK-2.1/generate-freeze.mjs "<repo>"
```

## 3. Gate results at packaging time

| Gate | Result |
|------|--------|
| tsc (paper-foundation) | 0 errors |
| Full regression | 63 files / 775 tests PASS |
| TASK 1.5R fault corpus | 18 / 18 |
| TASK 2 fault corpus D-001..D-020 | 20 / 20 |
| TASK 2 mutations M-01..M-16 | 16 / 16 killed |
| TASK 2.1 mutations E-01..E-08 | 8 / 8 killed |
| External red team (TASK 2, 4 roles) | 142 attacks / 141 BLOCKED / 1 LOW deferred / CRITICAL escape 0 |
| External attack suite (TASK 2.1, RT-E1..E4) | 13 / 13 detected |
| Freeze audit of canonical example chain | PASS (1 critical claim, 0 failures) |

## 4. TASK 3 readiness — precondition checklist

| # | Precondition | Status |
|---|--------------|--------|
| 1 | TASK 2 task-book CLOSED conditions (§11, 12 items) | 12 / 12 PASS — `handoff/TASK-2/gate-report.json` |
| 2 | TASK 2.1 CLOSED conditions (13 items) | 13 / 13 PASS — `handoff/TASK-2.1/gate-report.json` |
| 3 | Red-team CRITICAL escape = 0 (both rounds) | Yes |
| 4 | Mutation standard (all targeted mutations killed) | 24 / 24 |
| 5 | Prior-task regressions preserved (TASK 1 / 1.25 / 1.5 / 1.5R) | Yes (included in the 775) |
| 6 | All work committed and pushed; clean tree | Yes (`4f64b72315`) |
| 7 | Known risks delimit TASK 3's scope in writing | Yes — see §5 |

**Answer: YES — upon this audit's PASS verdict, TASK 3 can start
directly.** There is no unfinished TASK 2 / 2.1 work item. Every
deferred item below is either (a) TASK 3's own scope by definition, or
(b) a LOW-severity structural note that gates nothing.

## 5. Deferred items (full disclosure — none blocks TASK 3)

| Item | Severity | Why deferred | Who owns it |
|------|----------|--------------|-------------|
| Workflow wiring: `WorkflowExecutor` passes `claims: []`; canonical claims reach the IR via pre-mounted store (fixture-driven) | by design | TASK 2 task book hard scope forbade touching the executor delivery path; the real producer wiring is the execution layer's job | **TASK 3** |
| `Result.value` is not proven to originate from a real execution of `code_ref` | by design | This is precisely the TASK 3 mission (Execution Provenance Gate) | **TASK 3** |
| `environment_hash` / `dependency_lock_hash` are fingerprints of *declared* metadata, not execution proofs | by design | Same as above; they give TASK 3 stable comparison targets | **TASK 3** |
| Numeric recomputation / tolerance policy absent (equality is exact identity) | by design | TASK 2 task book §2 explicitly forbids tolerance in TASK 2; the recomputation algorithm belongs to the execution layer | **TASK 3** |
| RT-C1-27: Proxy object bypasses `scanIrValue`'s accessor check | LOW | Binding remains load-bearing through the traps; no documented workflow path can produce a Proxy; one-line hardening noted in `known-risks.md` #10 | future hardening |
| RT-C2-09: `numeric_binding.result_ref` not in `IR_REF_FIELDS.Claim` (semantic guard catches it at bridge; store does not) | MINOR | Task book §3 / phase-0 §3.2 froze the "structural ref in store, semantic equality in validator" split; adding a nested-single arity is an architectural change | future hardening |

## 6. Package layout

```
source/   changed + new production files (src/ir/*)
tests/    new + changed spec files (unit, fault corpus, red team, attacks)
handoff/TASK-2/     full TASK 2 package (summary, invariant, known-risks,
                    redteam + 4 role reports, gate-report, fault results,
                    mutation results, runners, D-001..D-020 corpus)
handoff/TASK-2.1/   full TASK 2.1 package (freeze manifest, chain map,
                    audit checklist / Agent Task Card, hash report,
                    gate-report, mutation results, task-3 preview)
```

## 7. Suggested audit focus

1. Re-run the commands in §2 and confirm every expectation.
2. Read `handoff/TASK-2.1/audit-checklist.md` — verify the Agent Task
   Card matches your intent for independent verification.
3. Attack the trust boundary yourself: tamper the manifest or the store
   and confirm `auditEvidenceFreeze` fails closed (RT-E taxonomy).
4. Confirm §5's ownership table matches your TASK 3 task book's scope.
5. Verdict: PASS → TASK 3 task book may be issued immediately.
