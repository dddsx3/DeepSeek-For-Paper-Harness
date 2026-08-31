# TASK 1.5 — PHASE 7: Targeted Mutation

- runner: `artifacts/handoff/TASK-1.5/run-mutations.mjs <repo-root>`
- machine-readable result: `mutation-results.json`
- targeted suite: `tests/ir/` (vitest) **plus** the C-001..C-018 fault corpus

## Result

**14 mutations, 14 killed, 0 survived.**

The task book requires 10 classes; 14 were run. Ten are the mandated guards,
four are the guards the PHASE 6 red team added, so the fixes are proven
covered rather than merely present.

| ID | Guard removed / weakened | Killed by |
|----|--------------------------|-----------|
| M-01 | `DataArtifact.content_hash` sha256 format | fault corpus |
| M-02 | `requirement_refs` resolves to a RequirementSpec (kind) | fault corpus |
| M-03 | ProblemSpec raw source ↔ RequirementSpec source consistency | fault corpus |
| M-04 | SymbolSpec same-scope token uniqueness | fault corpus |
| M-05 | `variable_refs` points at a VARIABLE | both |
| M-06 | `parameter_refs` points at a PARAMETER | both |
| M-07 | `input_data_refs` points at an INPUT_DATA DataArtifact | fault corpus |
| M-08 | `FigureSpec.data_refs` is `Result \| DataArtifact` | fault corpus |
| M-09 | FORMAL/FAST minimum Problem Contract bridge check | vitest |
| M-10 | legacy nested-shape rejection (ProblemSpec `.strict()`) | both |
| M-11 | SymbolSpec token must be NFC (RT-D-01) | vitest |
| M-12 | orphan ModelSpec still faces the symbol guards (RT-B-01) | vitest |
| M-13 | ProblemSpec must reference a REQUIRED_OUTPUT (RT-C-01) | vitest |
| M-14 | typed-ingress size budget (RT-A-02) | vitest |

"Both" means the IR unit suite and the fault corpus each independently
detected the mutation.

## Why the targeted suite includes the fault corpus

Nine of the ten mandated guards are exercised *only* by the fault corpus. The
IR unit suite verifies the guards in isolation; the corpus verifies that a
real delivery attempt is actually refused. Running either alone would leave
mutations alive — M-01 through M-04 and M-07 through M-08 were killed by the
corpus alone.

## M-09 survived the first run, and that was the point

On the first pass, **M-09 survived**: deleting `contractSatisfied` from the
bridge verdict left every suite green.

That is not a claim that the guard is unnecessary — it is proof of a coverage
hole, and the task book is explicit about how to answer it: add the test,
never argue the guard is fine.

The reason it survived is instructive. The per-element `contractFailures` had
grown, through the PHASE 6 fixes, to cover nearly everything the minimum
contract checks. In particular RT-C-01 made `missing_required_output_requirement`
fire on C-016 and C-017, so those fixtures stayed BLOCKED without
`contractSatisfied`. Almost every path to an unsatisfied contract now also
produces a per-element failure.

The one exception: **a store with no SymbolSpec at all.** Every per-element
guard passes, because there is no symbol to get wrong — no dangling ref, no
wrong role, no scope violation. Only the minimum contract itself notices that
the paper never declared what its symbols mean. `RT-C-02` in
`redteam15.spec.ts` covers exactly that case, and M-09 is now killed.

The general lesson is worth recording: as per-element guards accumulate, they
silently take over the work of the summary-level gate, and the summary gate's
own test coverage erodes without anything going red. Mutation testing is the
only thing that surfaces it.

## Method

For each mutation the runner rewrites one exact source anchor, runs the
targeted suite, restores the file, and records pass/fail. The file is
restored *before* the result is interpreted, so a crash cannot leave the
working tree mutated. An anchor that no longer matches is reported as an
error rather than silently skipped, so a mutation cannot quietly stop testing
anything after a refactor.
