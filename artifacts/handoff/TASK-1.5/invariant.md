# TASK 1.5 — Canonical Problem Contract: invariants

Each invariant below names the code that enforces it and the test that fails
if it is broken. An invariant without both is a claim, not an invariant.

## INV-1.5-A — ProblemSpec carries no nested requirement text

The canonical statement of "the problem asks for X" lives in `RequirementSpec`,
referenced by id. `ProblemSpec` no longer carries `subproblems`,
`required_outputs` or `constraints`; the strict zod schema refuses them with
no compatibility fallback.

- enforced by: `problemSpecSchema` (`.strict()`) in `schema.ts`
- proven by: C-001 (fault corpus); `schema.spec.ts` "rejects a nested
  subproblems / required_outputs block outright"
- mutation: M-10 (removing `.strict()`) killed

## INV-1.5-B — the raw problem is a DataArtifact, never a locator string

`ProblemSpec.raw_problem_ref` must resolve to a registered `DataArtifact` of
role `RAW_PROBLEM`. A `file://` string, a Result, or an `INPUT_DATA` artifact
is refused.

- enforced by: `validateProblemContract` (`unresolved_reference`,
  `reference_kind_mismatch`) in `problem-contract.ts`
- proven by: C-005, C-008
- mutation: M-02 killed

## INV-1.5-C — SymbolSpec is the only source of symbol semantics

A `meaning` / `unit` pair exists exactly once, on a `SymbolSpec`. `ModelSpec`
references symbols by id and cannot re-embed their semantics.

- enforced by: `modelSpecSchema` (`.strict()`, no `variables` / `parameters`
  with meaning/unit) and `validateModelSpecSymbols`
- proven by: C-014, C-012, C-013
- mutation: M-10, M-05, M-06 killed

## INV-1.5-D — one token means one thing inside one problem scope

Two `SymbolSpec` records in the same `scope_ref` may not share a `token`. The
comparison is byte-exact **and** sound, because tokens are required to be in
Unicode NFC: NFC is a canonical form, so canonical equivalence collapses onto
byte equality.

- enforced by: `symbolTokenSchema` (NFC refine) and
  `findDuplicateSymbolTokens`
- proven by: C-010, C-011, and RT-D-01 (the case that byte-exact comparison
  alone did not catch)
- mutation: M-04, M-11 killed

## INV-1.5-E — a ModelSpec may only use symbols of the problems it names

`variable_refs` must point at `VARIABLE` symbols, `parameter_refs` at
`PARAMETER` symbols, and both must be scoped to one of that ModelSpec's
`problem_refs`. A ModelSpec whose `problem_refs` names no registered
ProblemSpec is *not* exempt — it is validated separately.

- enforced by: `validateModelSpecSymbols`, called both from
  `validateProblemContract` and from the bridge for orphan models
- proven by: C-012, C-013, and RT-B-01
- mutation: M-05, M-06, M-12 killed

## INV-1.5-F — no compatibility fallback creates a second source of truth

Every removed field is removed from the schema and refused, not deprecated,
coerced, defaulted or logged-and-continued. There is no code path that reads
the legacy shape.

- enforced by: `.strict()` schemas; no `fallbackToText` / `useLegacyValue` /
  `warnAndContinue` anywhere in `src/`
- proven by: C-001, C-009, C-014; `grep` for legacy fallback identifiers
  returns nothing
- mutation: M-10 killed

## INV-1.5-G — FORMAL and FAST both prove the minimum Problem Contract

Delivery requires ≥1 RAW_PROBLEM DataArtifact, ≥1 ProblemSpec that itself
references a REQUIRED_OUTPUT RequirementSpec, and ≥1 SymbolSpec — bound to
each other, not merely present somewhere in the store. Neither mode can
satisfy this with the old 5-kind backbone.

- enforced by: `minimumProblemContractSatisfied` + the bound contract summary
  in `inspectProblemContract`, and `(!requiresBackbone || contractSatisfied)`
  in the bridge
- proven by: C-016 (FORMAL), C-017 (FAST), RT-C-01, RT-C-02
- mutation: M-09, M-13 killed

## INV-1.5-H — the Figure data reference is a closed union

`FigureSpec.data_refs` resolves to a `Result` or a `DataArtifact` and nothing
else. The store-level table declares `ANY` because it can express only one
target per field; the union is enforced by the contract guard, which is the
delivery choke point.

- enforced by: `validateProblemContract` (`figure_target_not_union`)
- proven by: C-015; `refs.spec.ts` documents the delegation
- mutation: M-08 killed

## INV-1.5-I — declared content hashes are machine-checkable

`DataArtifact.content_hash` must match `sha256:<64 lowercase hex>`. A
free-text placeholder cannot pose as a hash. Verifying the hash against
actual bytes is TASK 3 and is explicitly out of scope.

- enforced by: `sha256ContentHashSchema`
- proven by: C-006 (missing), C-007 (truncated), plus the upper-case-hex and
  trailing-space rejections
- mutation: M-01 killed

## INV-1.5-J — both ingresses enforce the same structural and size budget

`ingestJson` (text) and `put` (typed) apply the same scan: depth, forbidden
keys, inherited keys, symbol keys, accessors, and now a shared node budget.
Identical payloads cannot receive different verdicts based on which door they
entered.

- enforced by: `parseStrictJson` (`MAX_IR_JSON_CHARS`) and `scanIrValue`
  (`MAX_IR_JSON_DEPTH`, `MAX_IR_VALUE_NODES`)
- proven by: RT-A-02, and the TASK 1 red-team regressions retained in
  `parse.spec.ts` / `redteam.spec.ts`
- mutation: M-14 killed
