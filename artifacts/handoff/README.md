# Handoff packages (TASK -1 → TASK 8)

Every TASK produced under the v2 task book ships a `TASK-X/` directory with
the six files mandated by §3:

| File | Purpose |
|---|---|
| `summary.md` | the five required questions answered in prose |
| `gate-report.json` | machine PASS/FAIL with the minimum fields in §3.2 |
| `changed-files.txt` | every file touched in the TASK's commit |
| `tests.txt` | raw output of the test run for this TASK |
| `fault-results.json` | per-fault verdict for the TASK's fault corpus slice |
| `known-risks.md` | deferred risks (no drive-by fixes per §20) |

The shared templates and emission scripts live in `templates/`:

- `HANDOFF-TEMPLATE.md` — directory index, requires all six files
- `summary.template.md` — prose skeleton
- `gate-report.template.json` — minimum JSON shape
- `fault-results.template.json` — fault-verdict skeleton
- `known-risks.template.md` — risk-table skeleton
- `emit-gate-report.mjs` — `gate-report.json` from test + fault summaries
- `emit-fault-results.mjs` — `fault-results.json` from a fault-corpus dir
- `collect-changed-files.mjs` — `changed-files.txt` from `git show`
- `collect-tests.mjs` — `tests.txt` + `test-summary.json` from `vitest run`

Per-TASK handoff: `TASK--1/`, `TASK-0/`, `TASK-1/`, `TASK-1.5/`, `TASK-2/`,
`TASK-3/`, `TASK-3.5/`, `TASK-4/`, `TASK-5/`, `TASK-6/`, `TASK-7/`,
`TASK-7.5/`, `TASK-8/`.

A TASK is **only** declared `LOCAL GATE PASSED` when:

1. `gate-report.json.status == "PASS"` AND
2. `gate-report.json.critical_failures.length == 0` AND
3. `fault-results.json.escaped_faults == 0`.

Otherwise the output is `TASK X BLOCKED` with the un-satisfied items listed.
