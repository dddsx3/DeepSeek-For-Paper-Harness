# Handoff Package Index

This directory contains the handoff artifacts for the corresponding TASK. The
structure is fixed by `DeepSeek-For-Paper-Harness：Skills 前单人开发封闭任务书 v2` §3 and §21 — every TASK must produce all six files; no field is optional.

## Required files

| File | Purpose | Schema reference |
|------|---------|------------------|
| `summary.md` | Human-readable outcome of the TASK | §3 five required questions |
| `gate-report.json` | Machine-readable PASS/FAIL summary | §3.2 minimum format |
| `changed-files.txt` | Full list of files modified by the TASK | Local gate |
| `tests.txt` | Output of the test run (vitest) | Local gate |
| `fault-results.json` | Per-fault PASS/FAIL for this TASK's fault corpus | §3 + §TASK-N |
| `known-risks.md` | Discovered-but-deferred risks (NO drive-by fixes) | §20 + §21 |

## Completion rules

The TASK is **only** accepted when **both** of the following hold:

1. The local gate machine-checked by `gate-report.json` reports
   `status: "PASS"` and `critical_failures: []`.
2. A human red-team review (separate pass) finds no escape path.

Until then the output is `TASK X BLOCKED` with a list of un-satisfied items.

The scripts that emit these files live in `artifacts/handoff/templates/`
(`emit-gate-report.mjs`, `emit-fault-results.mjs`, `collect-changed-files.mjs`).
