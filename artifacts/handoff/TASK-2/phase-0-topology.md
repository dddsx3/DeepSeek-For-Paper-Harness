# TASK 2 — PHASE 0 Topology Reconnaissance

> Zero-edit reconnaissance. No production code was touched. All facts below
> are taken from the current state of the repository at HEAD
> `673063fd18` (TASK 1.5R / handoff agent notes / docs only).

## 0. 一句话

Every CRITICAL Claim today is a **prose-shaped** IR object: `text +
claim_type + criticality + evidence_refs + result_refs + model_refs`. The
schema only requires "at least one reference", so a NUMERIC CRITICAL Claim
with `result_refs = []` and only a model reference is *schema-legal* —
`"accuracy is 97.3%"` passes through the canonical store, the bridge says
PASS, the executor delivers. The number lives in free text and has no
machine binding to a canonical `Result`. Everything below is the evidence.

## 1. Producer / consumer / fixtures map

### 1.1 Producers (who actually emits Claim/Result)

| Producer | What it produces today | Status |
|----------|-----------------------|--------|
| `WorkflowExecutor.deliver()` (src/executor.ts:305-312) | `ArtifactRecord` (text blob) only — never touches `ModelingIr.put('Claim', …)` | **No real Claim/Result producer exists in the workflow path** |
| `WorkflowExecutor.storeArtifact()` (src/executor.ts:498-512) | `ArtifactRecord` with `kind: 'text'`; bypasses IR | Same |
| `tests/ir/fixtures.ts:163-174` (`claim`) and 150-161 (`result`) | Test fixtures | Only realistic producers |
| `backboneIr()` (tests/ir/fixtures.ts:277-286) | Hard-codes `validChain()` ingest | Test only |

**Conclusion**: the workflow path `WorkflowExecutor.execute()` calls
`enforceCanonicalIr(runId, initial.mode)` with **empty claims array** at
src/executor.ts:289 (`irBridgeGate(this.options.ir ?? EMPTY_IR, [], mode,
...)`). The comment at src/executor.ts:226-228 is explicit:

> Claims are empty for now: TASK 2 introduces the Claim→Result→Run
> evidence chain that populates them, and INV-1.25-A is exercised by
> the bridge suite directly until then.

The current *only* way CRITICAL claims reach `ModelingIr` is via fixture-
based tests. PHASE 3 of TASK 2 must add real workflow wiring (the executor
either ingests the canonical IR for itself or accepts a pre-populated
store the workflow composition built — task book §1 hard-scope
explicitly permits "workflow wiring").

### 1.2 Consumers (who reads Claim / Result after store)

| Consumer | File / line | What it reads today | TASK 2 impact |
|----------|-------------|--------------------|---------------|
| Bridge — `hasCriticalClaim` | src/ir/bridge.ts:354-361 | Iterates store, checks `kind === 'Claim'` and `claim.criticality === 'CRITICAL'`. Returns true on **first** match; does not validate the claim's evidence. | **PHASE 3 must replace this with "every CRITICAL Claim passes `validateClaimEvidence`"** — the new contract is per-claim, not aggregate. |
| Bridge — `evaluateIrBridge` | src/ir/bridge.ts:207-323 | Aggregates `claimProblems` (IR-claim wiring only), `missingBackbone`, `missingCriticalClaim`, `contractFailures`, `contractSatisfied` into one verdict. The single boolean `ok = … && !missingCriticalClaim && …` is the delivery gate. | The new "all CRITICAL claims valid" check must land **before** the `ok =` line, otherwise one valid CRITICAL claim can mask another invalid one (D-013). |
| Bridge — `inspectProblemContract` | src/ir/bridge.ts:300, +500.. | Walks Problem/Model/Run/Requirement/Symbol guards. Does **not** touch Claims. | TASK 2 will add a sibling `inspectClaimEvidence` reader of the snapshot; the bridge adds its failures to the same `IrBridgeDecision.contractFailures` (or to a new `evidenceFailures` field — decided in PHASE 3, see §4). |
| Executor — `enforceCanonicalIr` | src/executor.ts:288-302 | Calls `irBridgeGate` with `[]` claims array, so today only the IR-object-shape audit runs. | Real workflow wiring: PHASE 3 mounts a pre-populated store (the fixture pattern already used in `executor-ir-bridge.spec.ts`) **or** the executor builds it from canonical sources. Both belong in PHASE 3, not in the schema work. |
| Store — `validateRefFields` | src/ir/refs.ts:191-224, +table 89-142 | For `Claim`, enforces `evidence_refs: ANY`, `result_refs: Result[]`, `model_refs: ModelSpec[]` — *existence* and *kind* only. | Numeric binding does **not** introduce a new ref field at the store boundary; the binding's `result_ref` is enforced through the existing `result_refs` array (must contain the binding's `result_ref`), and the asserted-value/unit equality is a semantic guard, not a structural one. See §3 schema diff. |
| `problem-contract.ts` guards | src/ir/problem-contract.ts:283-441 | Walks Problem → Model → Run → Data/Requirement/Symbol, no Claim. | TASK 2 adds a parallel `validateClaimEvidence(claims, resolve)` and an `inspectClaimEvidence(store)` snapshot walker. |

### 1.3 Fixtures that already exist and need updating

| Fixture | File | Current shape | TASK 2 change |
|---------|------|---------------|---------------|
| `claim()` | tests/ir/fixtures.ts:163-174 | `claim_type: 'NUMERIC', criticality: 'CRITICAL', evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1']` (no `numeric_binding`) | Add a `numericBinding({ result_ref, asserted_value, asserted_unit })` factory; have `claim()` attach it whenever `claim_type === 'NUMERIC'`. Same for `modelClaim()` and `qualitativeClaim()`. |
| `result()` | tests/ir/fixtures.ts:150-161 | `result_id: 'RES1', run_ref: 'RUN1', name: 'mean_thickness', value: 0.731, unit: 'm', uncertainty: 0.012, source_location: …` | **Unchanged** (Result is already structurally complete — the bug is Claim-side, not Result-side). |
| `backboneIr()` | tests/ir/fixtures.ts:277-286 | Ingest full `validChain()` | **Unchanged** — but the canonical NUMERIC claim will gain a `numeric_binding` after PHASE 1. |
| `chainThrough('Claim')` etc. | tests/ir/fixtures.ts:261-266 | Prefix helper | Unchanged. |

## 2. Claim-related file locations (the precise edit surface)

| File | What lives there | What TASK 2 changes |
|------|------------------|---------------------|
| `packages/paper/paper-foundation/src/ir/schema.ts:212-243` | `CLAIM_TYPES`, `CLAIM_CRITICALITIES`, `claimSchema` | **PHASE 1**: discriminated union over `claim_type` with `numeric_binding: { result_ref, asserted_value, asserted_unit } | null`, `requirement_refs: refSchema[]` optional. Strip the `.refine(…)` "at least one of evidence/result/model" line — replaced by per-type contract. |
| `packages/paper/paper-foundation/src/ir/refs.ts:116-120` | `Claim` entry in `IR_REF_FIELDS` | Add `requirement_refs: many → RequirementSpec` if/when PHASE 0 reconfirms it's needed. Likely PHASE 0 → keep narrow: stay with `evidence_refs / result_refs / model_refs` for the store boundary; `requirement_refs` is a semantic-only link (the existing `requirement_refs` on **ProblemSpec** already proves chain; task book §3 makes the Claim-side one optional for CRITICAL only). |
| `packages/paper/paper-foundation/src/ir/problem-contract.ts` | PROBLEM_CONTRACT_FAILURE_KINDS, validateProblemContract | PHASE 2: add sibling `CLAIM_EVIDENCE_FAILURE_KINDS` and `validateClaimEvidence` in a **new module** `claim-evidence.ts` (recommended by task book §1 / hard-scope table) — keeps separation. |
| `packages/paper/paper-foundation/src/ir/bridge.ts:354-361` | `hasCriticalClaim` | **PHASE 3**: replace with `allCriticalClaimsValid` walker that calls `inspectClaimEvidence`. |
| `packages/paper/paper-foundation/src/ir/bridge.ts:286-293, 305-309` | `missingCriticalClaim`, `ok = …` | **PHASE 3**: add an `evidenceFailures` array to `IrBridgeDecision`; the `ok =` line adds `&& evidenceFailures.length === 0`. |
| `packages/paper/paper-foundation/src/ir/index.ts` | Re-exports | PHASE 1+2 export `numericBindingSchema`, `claim-evidence.ts` symbols. |
| `packages/paper/paper-foundation/src/executor.ts:226-228, 288-302` | `enforceCanonicalIr`, comments | **PHASE 3**: workflow wiring (mount or build a populated store). |
| `packages/paper/paper-foundation/tests/ir/*` | 13 spec files | PHASE 4/5 fixtures and assertions. |

## 3. Proposed schema delta (PHASE 1 — non-binding preview)

> Nothing below is committed. PHASE 0 only writes the proposal; PHASE 1
> is gated on PHASE 0 sign-off.

### 3.1 `claimSchema` shape change

Today (TASK 1.5R, schema.ts:223-243):

```ts
export const claimSchema = zod
  .object({
    claim_id: idSchema,
    text: textSchema,
    claim_type: zod.enum(CLAIM_TYPES),
    criticality: zod.enum(CLAIM_CRITICALITIES),
    evidence_refs: zod.array(refSchema),
    result_refs: zod.array(refSchema),
    model_refs: zod.array(refSchema),
  })
  .strict()
  .refine(
    c => c.criticality !== 'CRITICAL'
      || c.evidence_refs.length + c.result_refs.length + c.model_refs.length > 0,
    { message: 'a CRITICAL Claim must reference at least one Result, ModelSpec or evidence object' },
  )
```

Proposed (PHASE 1):

```ts
/** Closed shape for NUMERIC Claim's machine binding. */
// New idSchema for the binding (reuses existing id charset + NFC).
export const numericBindingSchema = zod
  .object({
    result_ref: refSchema,
    asserted_value: zod.number(),     // zod already rejects NaN / ±Infinity
    asserted_unit: unitSchema,
  })
  .strict()

/** Discriminated union keyed on `claim_type`. */
export const claimSchema = zod.discriminatedUnion('claim_type', [
  zod.object({
    claim_id: idSchema,
    text: textSchema,
    claim_type: zod.literal('NUMERIC'),
    criticality: zod.enum(CLAIM_CRITICALITIES),
    numeric_binding: numericBindingSchema,                 // required, non-null
    evidence_refs: zod.array(refSchema),
    result_refs: zod.array(refSchema).min(1),              // must include binding.ref
    model_refs: zod.array(refSchema),
  }).strict(),
  zod.object({
    claim_id: idSchema,
    text: textSchema,
    claim_type: zod.literal('MODEL'),
    criticality: zod.enum(CLAIM_CRITICALITIES),
    numeric_binding: zod.null(),                           // forbidden: schema BLOCKED if present
    evidence_refs: zod.array(refSchema),
    result_refs: zod.array(refSchema),
    model_refs: zod.array(refSchema).min(1),               // MODEL claims must point at >=1 ModelSpec
  }).strict(),
  zod.object({
    claim_id: idSchema,
    text: textSchema,
    claim_type: zod.literal('QUALITATIVE'),
    criticality: zod.enum(CLAIM_CRITICALITIES),
    numeric_binding: zod.null(),
    evidence_refs: zod.array(refSchema),                   // CRITICAL QUALITATIVE: semantic check enforces >=1
    result_refs: zod.array(refSchema),
    model_refs: zod.array(refSchema),
  }).strict(),
])
```

Why discriminated union:
- TS type-narrowing carries through: `claim.claim_type === 'NUMERIC'`
  implies `claim.numeric_binding` is non-null. Replaces the need for
  per-call `if (!numeric)` guards in user code.
- `.strict()` is preserved on every branch; one extra key → hard fail.
- `asserted_value: zod.number()` rejects NaN / ±Infinity at the same
  path as `Result.value` (the existing `tests/ir/schema.spec.ts:68-72`
  covers this pattern for Result; extend for the binding).
- The `.refine(…)` "at least one reference" line is **deleted**: per-type
  contracts replace it. NUMERIC's contract is enforced via the
  semantic validator + `result_refs.min(1)`.

### 3.2 What stays in `IR_REF_FIELDS` for Claim

- `evidence_refs: ANY` — unchanged
- `result_refs: many → Result` — unchanged
- `model_refs: many → ModelSpec` — unchanged
- `numeric_binding.result_ref` is **not** a new IR-internal ref column;
  it is *enforced through* `result_refs` (must contain it) and
  `numeric_binding.asserted_value` is *enforced through*
  `Result.value` identity (semantic guard). This is the
  task-book-§3 "structural ref in store, semantic equality in
  validator" split.

`requirement_refs` is **not** added in TASK 2 (task book §3 says it is
*recommended*; "若经 PHASE 0 发现现有模型对 requirement mapping 不成熟，
可把它作为 TASK 2 mandatory only for FORMAL/FAST"). The bridge
walks Problem → Requirement chains already; per-claim requirement
linkage is deferred to TASK 3's "claim-to-problem mapping" stage.

### 3.3 New module: `src/ir/claim-evidence.ts`

Recommended (task book §1 hard-scope row 3: "src/ir/claim-evidence.ts
(推荐新增)"):

```ts
export const CLAIM_EVIDENCE_FAILURE_KINDS = [
  'numeric_binding_missing',            // NUMERIC + CRITICAL without binding → schema BLOCKED (belt)
  'numeric_binding_result_unresolved',  // semantic: binding.result_ref not in canonical store (unreachable via store boundary, kept fail-closed)
  'numeric_binding_result_not_in_result_refs', // semantic: binding.result_ref ∉ claim.result_refs
  'numeric_value_mismatch',             // semantic: asserted_value !== Result.value (Object.is / JSON-safe number)
  'numeric_unit_mismatch',              // semantic: asserted_unit !== Result.unit
  'model_claim_no_model_ref',           // semantic: MODEL Claim with empty model_refs (D-009)
  'qualitative_critical_no_evidence',   // semantic: QUALITATIVE CRITICAL with empty evidence_refs (D-011)
  'numeric_binding_present_on_non_numeric', // MODEL/QUALITATIVE with binding → schema BLOCKED
] as const

export interface ClaimEvidenceProblem { kind: ...; path: ...; reason: ... }

/** Pure function. Reads snapshot; never mutates. */
export function validateClaimEvidence(
  claim: Readonly<Record<string, unknown>>,
  resolve: (ref: string) => { kind: 'Result', value: number, unit: string } | { kind: 'ModelSpec' } | { kind: 'DataArtifact', ... } | … | undefined,
): ReadonlyArray<ClaimEvidenceProblem>

/** Walk the snapshot; report every CRITICAL Claim problem. */
export function inspectClaimEvidence(
  store: ReadonlyMap<string, IrObjectRecord>,
): ReadonlyArray<ClaimEvidenceProblem>
```

Equality semantics for `asserted_value === Result.value`:
- `Object.is` would catch `NaN` equality but flag `-0` vs `0`. Per task
  book §7 row D-017 "−0 / 0 边界", we **freeze** the policy as
  `Number(a) === Number(b)` (a single `+0 / -0` collapse is the safe
  choice for results whose value originated from JSON; pure `Object.is`
  is rejected because it makes `-0 === 0` false and breaks JSON
  round-trip equality). `NaN === NaN` is **false** under that rule
  too — but `zod.number()` already rejects NaN at ingest, so the
  equality never runs on NaN.
- This is documented in the new module header; tests will pin both
  `-0` collapse and `NaN`-impossible.

### 3.4 Bridge change

`evaluateIrBridge` gets a new step:

```ts
const evidenceFailures = requiresBackbone
  ? inspectClaimEvidence(store)
  : []
const ok = problems.length === 0
  && missingBackbone.length === 0
  && !missingCriticalClaim
  && contractFailures.length === 0
  && (!requiresBackbone || contractSatisfied)
  && evidenceFailures.length === 0         // NEW — D-013 / INV-2-F
```

`hasCriticalClaim` is **retained** (still used by "at least one
CRITICAL Claim exists" semantics) but is no longer sufficient on its
own — the new walker handles "every CRITICAL Claim is valid". Two
distinct checks, both must pass in FORMAL/FAST.

`IrBridgeDecision` gains `readonly evidenceFailures:
ReadonlyArray<ClaimEvidenceFailure>`. `describe()` adds a
`N claim evidence failures: …` line.

## 4. Open questions (must be answered before Phase 1 sign-off)

1. **Where do `evidenceFailures` go on `IrBridgeDecision`?** Two options:
   (a) new top-level field (matches `contractFailures` shape, doesn't
   change existing field ordering); (b) union into `contractFailures`
   with a `where: 'claim'` discriminator. Task book §1 hard-scope
   table row 5 allows "可审计子判定" of the existing critical gate.
   **Recommendation: (a)** — keeps the existing audit shape stable.
2. **Claim-evidence validator placement.** `src/ir/claim-evidence.ts`
   (recommended by task book) vs appended to `problem-contract.ts`.
   **Recommendation: new file** — keeps validator per its kind, easier
   to load in isolation for unit tests, and matches the existing
   `problem-contract.ts` per-file convention.
3. **`-0`/`+0` equality.** See §3.3. **Recommendation: `Number(a) ===
   Number(b)`**; explicitly reject `NaN === NaN` (zod already does).
4. **NON_CRITICAL NUMERIC binding policy.** Task book §3 row 4 says
   binding is required for **NUMERIC + CRITICAL**. NON_CRITICAL
   NUMERIC may omit the binding. PHASE 1 will keep the schema:
   `numeric_binding` is required on every NUMERIC regardless of
   criticality (the semantic gate only enforces value/unit for
   CRITICAL); this is simpler and the extra cost (test fixture
   update) is one-line. **Recommendation: require binding on every
   NUMERIC** for schema simplicity; verify semantics on CRITICAL
   only.

## 5. Baseline evidence (PHASE 0 Gate requires "record baseline")

- HEAD: `673063fd18` (docs only — agent notes).
- Working tree clean (`git status` shows `## main...origin/main`, no
  diff).
- TASK 1.5R / handoff produced:
  - 49 files / 522 tests green (per HANDOFF-AGENT-NOTES.md §1.2).
  - 18/18 fault corpus, 14/14 mutations, 4 red-team roles with
    CRITICAL escape = 0.
- TASK 2 must preserve all of these; PHASE 6 re-runs the full
  `packages/paper/paper-foundation/` suite and confirms no
  regression in TASK 1/1.25/1.5/1.5R coverage.

> **PHASE 0 Gate**: this report + the proposed schema diff is the
> only artifact PHASE 0 emits. No production edits begin until the
> user (or the next reviewer) signs off on the diff in §3.