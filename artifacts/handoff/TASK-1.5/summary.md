# TASK 1.5 — Canonical Problem Contract

**Verdict: local gates pass. Ready for the External Attack Gate.**

- pinned main: `622b46cc46396399862d393afb98253503828aed`
- package: `packages/paper/paper-foundation`
- regression: `packages/paper` 47 files / 488 tests green
- fault corpus: C-001..C-018, 18/18
- mutation: 14 guards, 14 killed, 0 survived
- type checks: `tsc -b tsconfig.host.json` and `tsconfig.client.json`, both exit 0

The task's finish line is not "three schemas were added". It is that a model
can no longer quietly change the problem it is solving — by rewording a
requirement, swapping a data locator, or re-interpreting a symbol — inside a
canonical workflow. Everything below is in service of that, and the red team
section records three genuine ways it could still be done before this task
closed them.

---

## 1. How the old fields were removed / isolated

They were **deleted**, not deprecated. There is no compatibility fallback
anywhere in `src/`: no `fallbackToText`, no `useLegacyValue`, no
`warnAndContinue`. The choice was deliberate — a fallback that reads the old
shape is a second source of truth with a nicer name.

| Removed | Replaced by |
|---------|-------------|
| `ProblemSpec.subproblems[]` / `required_outputs[]` / `constraints[]` | `ProblemSpec.requirement_refs[]` → `RequirementSpec` |
| `ModelSpec.variables[]` / `parameters[]` with embedded `meaning` / `unit` | `ModelSpec.variable_refs[]` / `parameter_refs[{symbol_ref, value}]` → `SymbolSpec` |
| `RunArtifact.input_refs[]` (external locator strings) | `RunArtifact.input_data_refs[]` → `DataArtifact` |
| `ProblemSpec.raw_problem_ref` as a free-text `file://` locator | `raw_problem_ref` → `DataArtifact` of role `RAW_PROBLEM` |

Two details matter beyond the field swaps.

First, the legacy `Subproblem` / `RequiredOutput` / `ModelVariable` /
`ModelParameter` schemas were deleted from `schema.ts` entirely rather than
left behind as unused definitions. They had been kept with
`eslint-disable no-unused-vars`, which silenced the linter but not the
compiler, and an unused definition is how a second truth source gets
reintroduced by accident later.

Second, removal is enforced by `.strict()` schemas, so the old shapes fail at
ingest with `Unrecognized key`. The guarantee moved from "the nested block may
not contain duplicate ids" to "there is no nested block to hold a duplicate".

## 2. Which new canonical objects are mandatory

Three new closed kinds, all mandatory for FORMAL and FAST delivery:

- **`DataArtifact`** — canonical wrapper around an external locator. Role is
  one of `RAW_PROBLEM` | `INPUT_DATA`. `content_hash` must match
  `sha256:<64 lowercase hex>`, so a free-text placeholder cannot pose as a
  hash.
- **`RequirementSpec`** — a globally addressable statement of "the problem
  asks for X". Type is one of `SUBPROBLEM` | `REQUIRED_OUTPUT` | `CONSTRAINT`,
  so a fourth kind of requirement cannot be smuggled in.
- **`SymbolSpec`** — the single source of truth for a problem's variable and
  parameter semantics. Role is one of `VARIABLE` | `PARAMETER`; `meaning` and
  `unit` live here and nowhere else.

The minimum contract FORMAL and FAST must prove:

- ≥1 `DataArtifact` of role `RAW_PROBLEM`
- ≥1 `ProblemSpec` that **itself references** a `REQUIRED_OUTPUT`
  `RequirementSpec`
- ≥1 `SymbolSpec`
- and every element-level guard below

## 3. Which real E2E proves FORMAL and FAST cannot bypass it

**C-016 and C-017** in the fault corpus. Both build the *old* TASK 1.25
5-kind backbone completely — Problem → Model → Run → Result → CRITICAL Claim,
every reference resolving, nothing malformed — and omit the Requirement /
Data / Symbol contract. That is the exact shape that used to reach delivery.

- C-016 runs FORMAL → **BLOCKED**
- C-017 runs the same store through `fast` (case-insensitive) → **BLOCKED**

The bypass is therefore not mode-specific, and it is not a matter of the
backbone being incomplete. The old graph is fully present and still refused.

C-018 is the counterweight: the full contract plus the backbone **PASSes**,
which is what stops the corpus from proving only that the gate can refuse
things.

These are real executions, not JSON printouts. Each fixture is spawned as a
process that builds a real `ModelingIr` and calls the real
`evaluateIrBridge`; the runner asserts the verdict, keywords inside the bridge
reason, and — where the refusal happens at ingest — the ingest-level root
cause.

## 4. What the red team actually found

Four independent roles. **Three CRITICAL escapes and one HIGH**, all closed.
Three further attacks were probed and found already closed.

### RT-D-01 (CRITICAL) — one symbol, two meanings

Same-scope token uniqueness compared tokens byte-for-byte, but the token
schema admitted combining marks. So `é` (U+00E9) and `é` (`e` + U+0301) were
both legal, canonically equivalent, and byte-distinct.

One problem scope held two SymbolSpecs for "the same" symbol — one meaning
*distance along track* in metres, the other *a different quantity* in
seconds — and the uniqueness guard reported nothing. FORMAL delivery passed.
This is the exact failure the task exists to prevent.

Fixed by requiring tokens to be in Unicode NFC. That is stronger than
normalising at comparison time: NFC is a canonical form, so canonical
equivalence collapses onto byte equality and the existing check becomes sound.
It also fails closed earlier — the second spelling is refused at ingest and
never enters canonical state.

### RT-B-01 (CRITICAL) — an unowned model skipped every symbol guard

The bridge handed each ProblemSpec only the ModelSpecs whose `problem_refs`
named it. A ModelSpec with `problem_refs: []` was claimed by nobody, so it was
validated by nobody.

A model could therefore declare no problem, use a PARAMETER as a solved-for
variable and a VARIABLE as a parameter — precisely the mismatches C-012 and
C-013 exist to catch — and be delivered unchallenged.

Fixed by extracting the symbol walk into `validateModelSpecSymbols` and
calling it again for the orphan models. A model that declares no problem *and
uses no symbol* still passes; there is nothing to check. The escape was an
unowned model using another problem's symbols.

### RT-C-01 (CRITICAL) — the contract counted objects instead of binding them

The minimum contract asked only whether the store *contained* the pieces,
never whether they were connected. A ProblemSpec with `requirement_refs: []`
— declaring that the problem asks for nothing — alongside a REQUIRED_OUTPUT
that nobody referenced, satisfied it. FORMAL delivery passed. Not declaring
requirements was indistinguishable from declaring them.

Fixed in two parts: each ProblemSpec must itself reference a REQUIRED_OUTPUT;
and the contract summary binds its own pieces, so a stray requirement no
longer buys anything.

### RT-A-02 (HIGH) — the size budget depended on which door you used

`MAX_IR_JSON_CHARS` is enforced inside `parseStrictJson`, so it only guarded
the text path. A value handed to `put()` as a live object was never measured.
120 000 `requirement_refs` was refused as text and accepted as an object — the
same payload, two verdicts, decided by the ingress. That is the same
fail-open-by-inconsistency the module was written to prevent, one dimension
over: the earlier findings concerned shape, this one size.

Fixed by giving `scanIrValue` a shared node budget covering breadth and depth
together.

### Probed, already closed

Prototype pollution (refused with `forbidden_key`, `Object.prototype`
unmodified), non-finite numbers (zod's number schema rejects `NaN` and
±Infinity — worth knowing, because a `NaN` parameter would poison downstream
computation silently), and type confusion on the closed enums (trailing-space
role, lowercase role, numeric role, uppercase hex hash, trailing-space hash —
all refused).

## 5. A note on how the red team found these

It could not run at first: `tests/ir/` was failing 50 of 173 tests. PHASE 1
had rewritten `fixtures.ts` with `SymbolSpec` placed before `ProblemSpec` in
`validChain()`, so `scope_ref` could never resolve. PHASE 2–5 had exercised
only the fault corpus, which builds its own chains and stayed green, so
nothing caught it.

Two structural fixes came out of that. The chain is now ordered, and the
`validChain().slice(0, 3)` literals — which silently changed meaning when four
kinds were inserted ahead of ProblemSpec — are replaced by `chainThrough(kind)`,
which names the endpoint instead of the index. Hardcoded `ir.size`
assertions in four suites were likewise re-derived from the chain.

The lesson: a suite that only exercises its own fixtures is blind to breakage
in the shared ones.

## 6. Mutation: 14/14, and the one that survived

Fourteen guards were mutated; fourteen were killed. Ten are the mandated
classes, four are the guards this task's red team added, so the fixes are
proven covered rather than merely present.

Nine of the ten mandated guards are killed **only** by the fault corpus, which
is why the targeted suite includes it. The unit suite verifies guards in
isolation; the corpus verifies that a real delivery attempt is refused.

**M-09 survived the first run**, and that is the most useful result in this
phase. Deleting `contractSatisfied` from the bridge verdict left every suite
green. Per the task book, a surviving mutation is answered with a test, never
with an argument.

The reason is worth recording. The per-element `contractFailures` had grown,
through the RT-C-01 fix, to cover nearly everything the minimum contract
checks — enough that C-016 and C-017 stayed BLOCKED without it. The one case
it does not cover is **a store with no SymbolSpec at all**: every element-level
guard passes because there is no symbol to get wrong. Only the summary gate
notices that the paper never declared what its symbols mean. `RT-C-02` covers
exactly that, and M-09 is now killed.

The general hazard: as element-level guards accumulate, they silently take
over the summary gate's work, and the summary gate's own coverage erodes with
nothing going red. Mutation testing is the only thing that surfaces it.

## 7. Deferred

Recorded in `known-risks.md` with owners. The headline item: **hashes are
validated for format only** — nothing reads the referenced bytes or compares
the digest, so provenance-by-bytes is not yet established (TASK 3). Also
deferred: compatibility-equivalent (homoglyph) symbol tokens are not folded;
ProblemSpec reference fields are deliberately absent from `IR_REF_FIELDS`;
and EXPLORATORY mode does not require the minimum contract, by design.

## 8. Handoff package

```
artifacts/handoff/TASK-1.5/
  summary.md            this file
  invariant.md          INV-1.5-A..J, each with its enforcement and its test
  changed-files.txt     every file touched, with the reason
  tests.txt             test inventory and how to run each suite
  test-summary.json     machine-readable counts
  gate-report.json      per-phase gate verdicts and closed conditions
  fault-results.json    C-001..C-018 observed vs expected
  mutation-results.json 14 mutations, killed/survived
  known-risks.md        deferred work with owners
  run-fault-corpus.mjs  fault corpus runner
  run-mutations.mjs     PHASE 7 mutation runner
  faults/C-001..C-018.*
  phase-0-topology.md
  phase-5-fault-corpus.md
  phase-6-redteam.md
  phase-7-mutation.md
  baseline-summary.txt
```
