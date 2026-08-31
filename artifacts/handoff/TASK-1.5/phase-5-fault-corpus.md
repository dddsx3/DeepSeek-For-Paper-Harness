# TASK 1.5 — PHASE 5: Fault Corpus C-001..C-018

- pinned main: `622b46cc46396399862d393afb98253503828aed`
- runner: `artifacts/handoff/TASK-1.5/run-fault-corpus.mjs <repo-root>`
- fixtures: `artifacts/handoff/TASK-1.5/faults/C-001..C-018.json` (+ `.verdict.json`)
- fixture generator: `artifacts/handoff/TASK-1.5/faults/generate.py`
- fixture driver: `packages/paper/paper-foundation/tests/ir/run-fault.ts`
- machine-readable result: `artifacts/handoff/TASK-1.5/fault-results.json`

## Result

**18/18 PASS** — C-001..C-017 all reach `BLOCKED`, C-018 reaches `PASS`.

## How the runner asserts

A fixture is not "printed JSON". Each `C-0xx.json` is executed by spawning
`tests/ir/run-fault.ts` under `node --import tsx/esm`, which builds the real
`ModelingIr` store, ingests the fixture chain in the declared order, and calls
the real `evaluateIrBridge`. The runner then checks three things:

1. `observed.status === verdict.expected_status` — the verdict is a real
   bridge decision, not a claim about one.
2. every `expected_reason_matches` keyword appears in the bridge `reason`
   string. Pinning the failure *path* and *kind* (e.g.
   `requirement_refs.R-SUB:cross_source_requirement`) stops a fixture from
   passing because some unrelated guard happened to fire.
3. every `expected_ingest_reason_matches` keyword appears in the ingest log of
   the refused objects.

Point 3 was added during this phase and matters for a specific class of
fixture. When an object is rejected at ingest — a `DataArtifact` with a bad
`content_hash`, say — the bridge can only report the downstream symptom
(`'DA-RAW' is not a registered DataArtifact` / `minimum Problem Contract not
satisfied`). That symptom is identical whether the object was refused for a
missing hash, a truncated hash, or an entirely unrelated schema break. An
assertion on the symptom alone would stay green under a regression that
silently stopped validating hashes. C-006 and C-007 therefore also pin the
root cause (`content_hash` appears in the ingest refusal).

A thrown or faulted bridge is itself recorded as a failure rather than being
swallowed — the totality invariant must not regress silently.

## Corpus table

| ID | Attack | Expected | Observed | Pinned keywords |
|----|--------|----------|----------|-----------------|
| C-001 | legacy nested `subproblems`/`required_outputs` on ProblemSpec | BLOCKED | BLOCKED | `Problem Contract` + `RAW_PROBLEM` |
| C-002 | `requirement_refs` points at unregistered id | BLOCKED | BLOCKED | `requirement_refs.R-DOES-NOT-EXIST` + `unresolved_reference` |
| C-003 | `requirement_ref` resolves to a Claim | BLOCKED | BLOCKED | `requirement_refs.C1` + `reference_kind_mismatch` |
| C-004 | RequirementSpec `source_data_ref` is INPUT_DATA, not the ProblemSpec raw source | BLOCKED | BLOCKED | `requirement_refs.R-SUB` + `cross_source_requirement` |
| C-005 | `raw_problem_ref="file://problem.md"` instead of a DataArtifact id | BLOCKED | BLOCKED | `raw_problem_ref` + `unresolved_reference` |
| C-006 | DataArtifact without `content_hash` | BLOCKED | BLOCKED | `unresolved_reference` + `minimum Problem Contract not satisfied` + `RAW_PROBLEM` (+ ingest root cause `content_hash`) |
| C-007 | `content_hash="sha256:1234"` (truncated) | BLOCKED | BLOCKED | same as C-006 (+ ingest root cause `content_hash`) |

> C-006 / C-007 were re-pinned during PHASE 6: their original verdicts
> expected `"missing IR backbone"`, but a schema-rejected DataArtifact
> produces a different bridge reason. The keyword was corrected and the
> ingest-level root cause was added so the fixture cannot pass on a symptom
> that some unrelated breakage would also produce.
| C-008 | RAW_PROBLEM DataArtifact reused as RunArtifact input | BLOCKED | BLOCKED | `input_data_refs.DA-RAW` + `reference_kind_mismatch` |
| C-009 | RunArtifact uses legacy `input_refs` external strings | BLOCKED | BLOCKED | `missing IR backbone` + `RunArtifact` |
| C-010 | same problem scope, token `x`, two different meanings | BLOCKED | BLOCKED | `duplicate_symbol_token` + `P1/x` |
| C-011 | same problem scope, token `x`, unit `m` vs `s` | BLOCKED | BLOCKED | `duplicate_symbol_token` + `P1/x` |
| C-012 | `variable_refs` points at a PARAMETER SymbolSpec | BLOCKED | BLOCKED | `variable_refs.SYM-rho` + `symbol_role_mismatch` |
| C-013 | `parameter_refs[].symbol_ref` points at a VARIABLE SymbolSpec | BLOCKED | BLOCKED | `parameter_role_mismatch` + `parameter_refs.SYM-x` |
| C-014 | ModelSpec re-embeds `variables` with `meaning`/`unit` | BLOCKED | BLOCKED | `missing IR backbone` + `ModelSpec` |
| C-015 | `FigureSpec.data_refs` points at a ModelSpec | BLOCKED | BLOCKED | `figure_target_not_union` + `data_refs.M1` |
| C-016 | FORMAL, old 5-kind backbone, no Requirement/Data/Symbol | BLOCKED | BLOCKED | `Problem Contract` + `RAW_PROBLEM` |
| C-017 | FAST (case-insensitive), same as C-016 — no fast bypass | BLOCKED | BLOCKED | `Problem Contract` + `RAW_PROBLEM` |
| C-018 | full contract + existing backbone | PASS | PASS | (none) |

## Defects the corpus exposed while it was being built

The corpus was not a rubber stamp; four guards did not exist and were added
because a fixture reached the wrong verdict.

1. **C-015 was rejected by the store for the wrong reason.**
   `IR_REF_FIELDS.FigureSpec.data_refs` declared `'Result'` as its only legal
   target, so the store-level `validateRefFields` refused the fixture before
   the contract guard ever saw it. That left the `Result | DataArtifact` union
   unenforced: a `Result`-shaped object that was not a `Result` would pass.
   Fix: `refs.ts` now declares `data_refs` as `'ANY'` at the store level, and
   the exact union is enforced by the contract guard via
   `figure_target_not_union`. The store no longer over-claims a constraint it
   cannot check, and the guard owns the one it can.

2. **C-004 had no raw-source ↔ requirement-source consistency check.**
   `RequirementSpec.source_data_ref` could point at any DataArtifact, so a
   requirement could be sourced from run input while the ProblemSpec pointed at
   a different raw problem. That is exactly the "silently change the problem
   being solved" drift TASK 1.5 exists to close. Fix: new
   `cross_source_requirement` failure.

3. **C-008 did not constrain the DataArtifact *role*, only the kind.**
   `RunArtifact.input_data_refs` accepted any DataArtifact, so a RAW_PROBLEM
   artifact could be laundered into run input. Fix: `reference_kind_mismatch`
   now also fires when role is not `INPUT_DATA`.

4. **C-010/C-011 replaced the wrong object.**
   The fixture builder substituted the attack value into the canonical chain,
   which deleted `SYM-x` and left `ModelSpec.variable_refs` dangling — the
   fixture then failed for a reason unrelated to duplicate tokens. Fix: the
   duplicate-token attacks now *append* the second SymbolSpec instead of
   replacing the first, so the canonical chain still resolves and the only
   remaining defect is the actual duplicate.

## Verdict-keyword alignment

Reason strings are emitted as `where.path:kind` (for example
`problem.requirement_refs.R-SUB:cross_source_requirement`). They deliberately
do not carry human-readable role descriptions, so several verdicts that
originally pinned prose such as `"expected PARAMETER"` could never match.
Those verdicts were rewritten to pin the fields the reason actually contains.
This is a fixture-authoring fix, not a guard fix — no guard was weakened to
make a fixture pass.
