# TASK 1.5R — Invariants (canonical store boundary + bridge responsibility split)

These are the load-bearing invariants PHASE 1/2/3 restored and the tests that
pin each one. A change that breaks one of these must break a test, not just
a documentation claim.

## Store boundary (`refs.ts` + `store.ts`)

**INV-1.5R-A — Every IR-internal reference closes at commit.**
`ModelingIr.put()` runs `validateRefFields(kind, parsed.data, …)` for every
kind, and `IR_REF_FIELDS` declares every IR-internal reference with a target
no wider than necessary:

| object field | target | pinned by |
|---|---|---|
| `ProblemSpec.raw_problem_ref` | `DataArtifact` | R-001 (missing), M-01 |
| `ProblemSpec.requirement_refs` | `RequirementSpec` | R-002 (missing), R-003 (kind), M-02 |
| `ModelSpec.variable_refs` | `SymbolSpec` | R-004 (missing), R-005 (kind), M-03 |
| `ModelSpec.parameter_refs[].symbol_ref` | `SymbolSpec` (nested path) | R-006 (missing), R-007 (kind), M-04 |
| `RunArtifact.input_data_refs` | `DataArtifact` | R-008 (missing), R-009 (kind), M-05 |
| `FigureSpec.data_refs` | `['Result','DataArtifact']` narrow union, **never `ANY`** | R-010/R-011 (blocked), R-012/R-013 (PASS), M-06 |
| `RequirementSpec.source_data_ref` | `DataArtifact` | refs.spec.ts |
| `SymbolSpec.scope_ref` | `ProblemSpec` | ref-closure seeding |
| `ModelSpec.problem_refs` / `dependencies`, `Result.run_ref`, Claim/Verification/Reviewer refs | TASK 1 policy unchanged | legacy suites |

**INV-1.5R-B — Append-only + no forward-reference repair.**
A ref can only resolve to an id already registered; ingest must follow
dependency topology. The store never queues a repair. Pinned by the
append-only design tests (`store.spec.ts`) and by every fixture that seeds
through `chainThrough(kind)`.

**INV-1.5R-C — Totality + fail-closed.**
`put()` returns a verdict for every input; a throwing extractor / resolver /
clock / audit sink becomes `internal_error`, never an escape. Pinned by
`store.spec.ts` totality cases and `bridge.spec.ts` malformed-claim cases.

**INV-1.5R-D — Duplicate-id + reference failures report together.**
Both are collected in one `put()` and both appear in `failures`.
Pinned by `store.spec.ts` (`['duplicate_id','unresolved_reference']`).

**INV-1.5R-E — The snapshot is closed.**
A full walk of `ModelingIr.snapshot()` with `validateRefFields` finds zero
missing / wrong-kind edges. Pinned by `bridge-dedup.spec.ts` *every declared
ref in a closed snapshot resolves with an allowed kind*.

## Bridge responsibility split (`bridge.ts` + `problem-contract.ts`)

**INV-1.5R-F — The bridge is not a structural sanitizer.**
The bridge emits **no** `unresolved_reference` / `reference_kind_mismatch`
contract failure; those kinds are removed from `PROBLEM_CONTRACT_FAILURE_KINDS`
and the FigureSpec kind walk is deleted (the store closes the union).
Pinned by `bridge-dedup.spec.ts` (semantic-kinds-only assertion).

**INV-1.5R-G — Semantic guards stay load-bearing.**
The bridge still owns:

| guard | failure kind | pinned by |
|---|---|---|
| `raw_problem_ref` role must be RAW_PROBLEM | `unbound_data_artifact` | R-014, M-09 |
| `input_data_refs` role must be INPUT_DATA | `unbound_data_artifact` | R-015, M-10 |
| `variable_refs` role must be VARIABLE | `symbol_role_mismatch` | R-016, M-11 |
| `parameter_refs` role must be PARAMETER | `parameter_role_mismatch` | R-016 (parameter side), M-12 |
| symbol scope ownership (`symbolScopeMatches`) | `unbound_variable_symbol` / `unbound_parameter_symbol` | bridge-dedup scope test, RT-B-01 |
| Requirement `source_data_ref` == `ProblemSpec.raw_problem_ref` | `cross_source_requirement` | R-017, M-13 |
| same-scope symbol token uniqueness (NFC) | `duplicate_symbol_token` | RT-D-01 + M-14 direct unit |
| ProblemSpec references ≥1 REQUIRED_OUTPUT | `missing_required_output_requirement` | RT-C-01 |
| FORMAL/FAST minimum contract (≥1 RAW_PROBLEM, ≥1 ProblemSpec, ≥1 REQUIRED_OUTPUT, ≥1 SymbolSpec) | `contractSatisfied=false` | RT-C-02 |
| 5-kind backbone + ≥1 CRITICAL claim | `missingBackbone` / `missingCriticalClaim` | bridge.spec.ts INV-1.25-B |
| orphan ModelSpec still faces symbol guards | `symbol_role_mismatch` etc. | RT-B-01 |

**INV-1.5R-H — Reader-only + total.**
`evaluateIrBridge` never mutates the store and never throws; a fault becomes
`BLOCKED` with a sentinel contract failure (now `unbound_data_artifact`,
since `unresolved_reference` is no longer a valid contract-failure kind).
Pinned by `bridge.spec.ts` (reader, never writer) and the malformed-input
cases.

**INV-1.5R-I — EXPLORATORY still per-object strict.**
EXPLORATORY is exempt from the *minimum contract* only; every object it
declares is store-closed and bridge-guarded. Pinned by `bridge.spec.ts`
(EXPLORATORY passes with empty IR) + redteam15 RT-C-02 (semantic guards run
in every mode).

## Policy constants

- `IR_REF_FIELDS`, `IR_KINDS`, `IR_SCHEMAS`, `ID_FIELD_BY_KIND` are
  deep-frozen; `ModelingIr` and its prototype are frozen (RT3-02).
- `PROBLEM_CONTRACT_FAILURE_KINDS` is the closed set of bridge failures —
  no attacker-invented verdict.
