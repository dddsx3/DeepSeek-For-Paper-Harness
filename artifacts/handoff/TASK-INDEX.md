# Task Index — DeepSeek-For-Paper-Harness

> Single source of truth for which tasks have shipped, what their handoff
> directory contains, and which follow-ups are pending. Every handoff
> `summary.md` cross-references this file. New tasks MUST add a row on
> landing and update the "head" column to the commit that closed the
> task's local gate.

## Landed tasks

| Task | Head commit | Handoff | Local gate | Follow-ups |
|------|-------------|---------|------------|-------------|
| TASK 1.25  (IR canonical gate + executor) | `2775ccf3e0` | `artifacts/handoff/TASK-1.25/` | PASS (B-001..B-005) | — |
| TASK 1.5   (Reference Closure) | `2775ccf3e0` | `artifacts/handoff/TASK-1.5/` | PASS (18/18) | — |
| TASK 1.5R  (Canonical Closure + RT4-01) | `2775ccf3e0` | `artifacts/handoff/TASK-1.5R/` | PASS (12/12) | — |
| TASK 2     (Claim → Result evidence) | `ffad0e63bf` | `artifacts/handoff/TASK-2/` | PASS (10/10) | — |
| TASK 2.1   (Evidence Freeze + Audit) | `4f64b72315` | `artifacts/handoff/TASK-2.1/` | PASS (C1..C10) | Follow-ups item 12 (legacy test rewrite) |
| TASK 3     (Execution Provenance Gate v1.0) | `8d3158abe2` task book / `ffad0e63bf` impl | `artifacts/handoff/TASK-3/` | PASS (C1..C10) | — |
| TASK 3.5   (STALE engine) | `adc50eaebd` | `artifacts/handoff/TASK-2.1/` (audit batch) | PARTIAL (7/11 stale align) | Wired producer; S-002 closed; S-003/S-004/S-009 need the 5.0.4 forge factory |
| TASK 3.6   (Replay–Delivery staleness) | `4064a28baf` | `artifacts/handoff/TASK-2.1/` | PASS (report shape) | The `delivery_replay_max_age` policy itself is the next handoff (5.0.8) |
| TASK 4.0   (Gate registry + 5 stub producers) | `cf462f928b` | (folded into TASK 3) | PARTIAL (5 stubs) | Each stub awaits its real implementation (5.0.1 / 4.3 / 4.4) |
| TASK 4.2   (fast mode bypass removal) | `52b7aded26` | n/a | PASS (executor line) | Reviewer schema unification DONE (5.0.3c); Oracle Routing follow-up |
| TASK 4.3   (FigureSpec data_hash) | `adc50eaebd` | n/a | PASS (schema) | §15 other fields are the follow-up |
| TASK 5.0   (Second-repair batch: 5.0.5/6/7/8/11 + capture-path rewrites) | (this batch) | `artifacts/handoff/TASK-5.0/handoff.md` | PARTIAL (5 sub-tasks landed; 5.0.1/4/10 DEFERRED on v1.1) | 5.0.9 FigureSpec data_hash comparison; 5.0.1/5.0.4/5.0.10 await v1.1 |

## Pending tasks (not yet started)

| Task | Status | Hard gate before start |
|------|--------|-------------------------|
| TASK 4.4  (numeric tolerance) | DEFERRED | v1.1 task-book amendment separating replay recomputation (exact identity) from cross-source comparison (with tolerance) |
| TASK 4     (Fault Corpus v1) | REJECT (per TASK-4 准入评审) | TASK 4.4 + 3 stale-engine follow-ups + 11 legacy test rewrites |

## Map of handoff assets

```
artifacts/handoff/
├── EXTERNAL-REVIEW.md      ← single status document, updated by every batch
├── TASK-INDEX.md            ← this file
├── TASK-1.25/  (RT125B-01..05)   + summary / invariant / gate-report
├── TASK-1.5/   (RT-A/B, redteam) + summary / known-risks / 18 fault JSON
├── TASK-1.5R/  (RT-01, RT4-01)  + 12/12 mutation report / freeze manifest
├── TASK-2/     (RT-C1..4)       + 20 fault JSON / 8/8 mutation / audit
├── TASK-2.1/   (3.R1..3.R6)     + 10 critical 12 closed + 8 mutations + freeze
├── TASK-3/     (TASKBOOK v1.0 + EX-01..12 + RT-X1..X4)  + handoff + runners
└── TASK-4/     (准入评审, rejected until 4.4 ships)
```

## How to add a new task

1. Land the implementation + tests.
2. Create `artifacts/handoff/TASK-N/` with `summary.md`, `invariant.md`,
   `gate-report.json`, `known-risks.md`, and (if attack work happened)
   `redteam.md` and `faults/`.
3. Add a row to this file under "Landed tasks", with the head commit
   (or "staged" while the change sits uncommitted).
4. Update EXTERNAL-REVIEW's "Status snapshot" with a one-line summary.
5. Reference the task's gate-report CLOSED conditions from
   `summary.md`'s verification matrix.

## Notes for the next reviewer

- The TASK 2.1 audit batch (3.R1..3.R6) is the most recent *fully closed*
  surface. Read it first if you only have time for one task.
- The TASK 3 entry-point is `TASKBOOK.md` v1.0 (frozen before any code was
  written); the implementation lives across the 3.R* commits.
- Mutation runners (`run-mutations.mjs`) and the fault-corpus driver
  (`run-fault-corpus.mjs`) are stable entry-points for verification.
- The real-process smoke (`run-real-execution-smoke.mjs`) is its own job
  with a 30-60s wall-clock budget; it runs the canonical
  backboneIR through capture + replay against a real node child.
