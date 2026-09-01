# TASK 3 Preview — Execution Provenance Gate

> **Status: PREVIEW ONLY — TASK 3 is NOT started.** Per the house STOP
> RULE, TASK 3 requires its own task book and an External Attack Gate
> sign-off on TASK 2 / 2.1 first. This document records what TASK 2.1
> discovered about the remaining risk and sketches the shape of the
> next layer, so the task book author can start from facts, not blanks.

## The remaining risk, stated precisely

TASK 2 proved structural binding; TASK 2.1 proved the binding is
frozen and auditable. Neither proves the deepest fact:

> `Result.value` may be mathematically consistent with everything the
> IR declares, yet **not originate from any real execution** of the
> code that `RunArtifact.code_hash` names.

Concretely: an agent can hand-write a `Result` (value 0.731), a
`RunArtifact` (code_hash pointing anywhere), and a well-bound CRITICAL
Claim — and every gate built so far says PASS, because every gate
reasons over declared canonical state, not over reality.

## What TASK 3 must close

```
Claim
 │ numeric_binding (TASK 2)
Result
 │ run_ref (TASK 1.5R store closure)
RunArtifact
 │ code_hash / environment / dependency locks (TASK 2.1 fingerprints)
Actual Execution          ← the missing link
```

Sketch of the gate (subject to the real task book):

1. **Re-execution**: run the bytes named by `code_ref` in the declared
   environment; TASK 3 owns verifying `code_ref` / `stdout_ref` /
   `output_refs` exist and hash to the recorded values.
2. **Value recomputation**: recompute the quantity the Result declares
   and compare with `Result.value` — this is where a *documented*
   numeric-consistency policy finally lives (TASK 2 deliberately
   forbade tolerance/rounding; TASK 3 owns the algorithm, including
   the recorded `uncertainty`).
3. **Exit / seed policy**: `RunArtifact.exit_status === 0` and a
   non-null `seed` become enforced requirements for FORMAL/FAST
   delivery instead of declared metadata.
4. **Provenance verdict**: a new critical gate (`execution` /
   `provenance` ids already reserved in `CRITICAL_GATE_IDS`) wired
   through the existing delivery-policy machinery — no second gate
   system.

## What TASK 2.1 already contributes to TASK 3

- `environment_hash` / `dependency_lock_hash` fingerprints give TASK 3
  a stable target to compare a real execution environment against.
- The freeze/audit pattern (freeze → out-of-band hash → independent
  read-only audit) is the template for replay-verification evidence:
  TASK 3's re-execution records can be frozen and audited the same way.
- The failure taxonomy pattern (closed categories + severities +
  fail-closed verdict) extends naturally to execution findings.

## 30-day priority (from the TASK 2.1 task book)

| Week | Milestone |
|------|-----------|
| 1 | ✅ TASK 2.1 Phase 0–2 — Freeze Manifest + Auditor v0 (done) |
| 2 | External Attack Suite expansion (50+ automated attacks on the trust layer) |
| 3 | TASK 3 — Execution Provenance (needs its own task book) |
| 4 | Paper Harness Verification Stack v1 — "Agent-native scientific evidence verification infrastructure" |
