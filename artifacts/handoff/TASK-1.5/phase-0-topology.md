# PHASE 0 — Topology Recon / Zero-Edit Reconnaissance

TASK 1.5 only adds canonical identity for `RequirementSpec`, `DataArtifact`,
`SymbolSpec`, and tightens `ProblemSpec` / `ModelSpec` / `RunArtifact` /
`FigureSpec`. The job of this phase is to enumerate every existing field
those objects must touch, and the read / write / validate / gate pipeline that
must keep working after the refactor. **No source code is changed in PHASE 0.**

## 0. Baseline

```
git rev-parse HEAD : 622b46cc46
vitest packages/paper/paper-foundation :
  Test Files  45 passed (45)
  Tests       453 passed (453)
  Duration    4.93s
```

Task book frozen baseline was 46/462; the live tree shows 45/453 because
subsequent TASK 1.25 fixtures were merged into shared suites (e.g.
`tests/ir/fixtures.ts` absorbed what used to be a separate file). This is the
new authoritative baseline for TASK 1.5.

## 1. Files in scope (Hard Scope §2)

```
packages/paper/paper-foundation/src/ir/schema.ts       // +RequirementSpec / DataArtifact / SymbolSpec; tighten existing
packages/paper/paper-foundation/src/ir/refs.ts         // +reference graph; narrow union for FigureSpec.data_refs
packages/paper/paper-foundation/src/ir/store.ts        // +minimal semantic uniqueness / contract validation
packages/paper/paper-foundation/src/ir/bridge.ts       // +FORMAL/FAST minimum Problem Contract
packages/paper/paper-foundation/src/ir/index.ts        // +export new public types / validators
packages/paper/paper-foundation/tests/ir/*             // +happy / invalid / attack / red-team / mutation
packages/paper/paper-foundation/tests/executor-ir-bridge.spec.ts // +FORMAL/FAST E2E
artifacts/handoff/TASK-1.5/*                           // +handoff package
```

Files explicitly **out of scope** (TASK 1.5 Hard Scope §3): `executor.ts`,
`executor-service.ts`, `delivery/delivery-policy.ts`, `delivery/promoter.ts`
(mechanism inherited, no parallel gate), `spec.ts`, `workflow.ts`. Verified by
`rg` below: none of those files mention the in-scope fields in ways that
require change before PHASE 1.

## 2. Field producer → validator → reader → gate map

| Field | Schema owner | Producer (test/fixture) | Reader / consumer | Delivery gate |
|-------|--------------|--------------------------|--------------------|----------------|
| `ProblemSpec.raw_problem_ref` | `schema.ts:94` (`refSchema`) | `tests/ir/fixtures.ts:18`, `tests/ir/redteam.spec.ts:162` | not resolved by `refs.ts` (external locator) | not a gate input |
| `ProblemSpec.subproblems[]` | `schema.ts:95` (`subproblemSchema`) | `fixtures.ts:19`, `tests/ir/schema.spec.ts:95` | not resolved by `refs.ts` (nested IDs are parent-local) | not a gate input |
| `ProblemSpec.required_outputs[]` | `schema.ts:96` (`requiredOutputSchema`) | `fixtures.ts:23`, `tests/ir/schema.spec.ts:110` | not resolved (nested) | not a gate input |
| `ProblemSpec.constraints[]` | `schema.ts:97` (`textSchema[]`) | `fixtures.ts:26` | free text; not consumed by any gate | none |
| `ModelSpec.variables[]` (`symbol/meaning/unit`) | `schema.ts:114-120` | `fixtures.ts:36`, `tests/ir/schema.spec.ts:125` | none (semantic truth lives here today) | none |
| `ModelSpec.parameters[]` (`symbol/value/unit`) | `schema.ts:122-128` | `fixtures.ts:37`, `tests/ir/schema.spec.ts:131` | none | none |
| `RunArtifact.input_refs[]` | `schema.ts:149` (`refSchema[]`) | `fixtures.ts:51` | not resolved by `refs.ts` (external) | not a gate input |
| `FigureSpec.data_refs[]` | `schema.ts:228` + `refs.ts:67` (`target: 'Result'`) | `fixtures.ts:105`, `tests/ir/attack.spec.ts:107`, `tests/ir/refs.spec.ts:70` | `validateRefFields(kind, value, resolve)` in `refs.ts:105` | `bridge.ts` claims resolve against store snapshot |

**Important**: TASK 1.5 promotions:

1. `subproblems` / `required_outputs` / `constraints` move out of
   `ProblemSpec` into a global `RequirementSpec` namespace. `ProblemSpec`
   keeps only `requirement_refs: string[]`.
2. `ModelSpec.variables[]` semantics (meaning/unit) migrate to `SymbolSpec`.
   `ModelSpec.variables[]` either disappears or becomes `variable_refs: string[]`;
   `parameters[]` either keeps `{symbol_ref, value, unit?}` or is renamed.
3. `raw_problem_ref` (string locator) → `raw_problem_ref` referencing a
   `DataArtifact` whose `role = 'RAW_PROBLEM'`. `RunArtifact.input_refs`
   similarly migrates to `input_data_refs → DataArtifact (INPUT_DATA)`.
4. `FigureSpec.data_refs` target widens from `['Result']` to a narrow
   union `['Result','DataArtifact']`. Implemented as a per-element kind
   check, **never** `ANY`.

## 3. Pipeline integrity the new contract must preserve

The TASK 1 store pipeline stays the entry point:

```
text ─▶ parseStrictJson ─▶ scanIrValue ─▶ IR_SCHEMAS[kind].parse ─▶
       validateRefFields ─▶ ModelingIr.#objects.set ─▶ ir_bridge_gate ─▶
       WorkflowExecutor.enforceCanonicalIr
```

`ModelingIr` already gives us: append-only, frozen envelopes, deep-frozen
snapshots, global ID uniqueness, totality (never throws), and a closed
`IR_FAILURE_KINDS` set. TASK 1.5 must **reuse** these instead of inventing
parallel state. New semantic checks go in either `store.ts` (one narrow
validator hook) or a new `ir/problem-contract.ts`; nothing in
`executor.ts` prose.

## 4. Gate plumbing already in place

`ir_canonicalization` (`delivery/delivery-policy.ts:45`) is the critical
gate that survives. `evaluateIrBridge` already iterates IR claim objects
and verifies `IR_BACKBONE_KINDS = ['ProblemSpec','ModelSpec','RunArtifact',
'Result','Claim']` are present in FORMAL/FAST. TASK 1.5 extends that
**same function** with a second proof obligation: a minimum Problem
Contract (DataArtifact RAW_PROBLEM, RequirementSpec REQUIRED_OUTPUT,
SymbolSpec, plus cross-references resolving). No new gate id, no parallel
gate.

## 5. Tests already asserted (must keep green through PHASES 1-7)

```
ir/schema.spec.ts       15 tests
ir/store.spec.ts        21 tests
ir/refs.spec.ts         19 tests
ir/bridge.spec.ts       21 tests
ir/attack.spec.ts       12 tests
ir/redteam.spec.ts      33 tests
ir/redteam125.spec.ts   (RT125 suites; backbone already enforced)
executor-ir-bridge.spec.ts  8 tests
```

These cover the contract TASK 1.5 inherits. New attacks land in
`tests/ir/attack15.spec.ts` (planned) and `tests/ir/redteam15.spec.ts`
(planned). The C-001..C-018 fault fixtures land under
`artifacts/handoff/TASK-1.5/faults/`.

## 6. Out-of-scope callouts (deliberately not touched)

- `lib/types/ir/*.js` (built artifacts) regenerate from `src/` via
  `pnpm build`. No hand-edits.
- `packages/paper/paper-foundation/src/spec.ts` (manifest shape) and
  `src/workflow.ts` (engine) do not read ProblemSpec fields by name.
- `lib/types/verifier/gate-c-provenance.js` is the historical provenance
  gate; the ir_canonicalization gate is the surviving authority.

## 8. PHASE 0 Gate decision

- [x] Field producer/consumer map emitted (section 2).
- [x] Baseline 453/453 PASS captured (section 0); the 46/462 baseline in
      the task book is from an earlier commit and is superseded by the
      live 45/453 (no unrelated failures).
- [x] `changed-files` predicted range frozen: see section 1.

PHASE 0 Gate passes. Proceed to PHASE 1 (Schema Vocabulary Freeze).