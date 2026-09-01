# TASK 2 — RT-C2 (Numeric-binding attacks) red-team report

> Independent red-team pass over the just-landed `numeric_binding`
> machinery. Companion to `redteam-rt-c1.md` (topology) and
> `redteam.md` (corpus).
>
> Out of scope by the handoff: tolerance / rounding / coercion (frozen
> as no in `known-risks.md` §3). Every equality attack here is exact
> identity; no numeric slop is implied or proposed.
>
> **Methodology.** Every attack was expressed as a vitest case in
> `packages/paper/paper-foundation/tests/rt-c2/numeric-binding-attacks.spec.ts`,
> driven at three depths when relevant: schema boundary (zod parse),
> store boundary (`put()` + `IR_REF_FIELDS`), semantic guard
> (`validateClaimEvidence`), and bridge end-to-end
> (`evaluateIrBridge`). `tsc -p packages/paper/paper-foundation` passes.
> `corepack pnpm exec vitest run --project=thread-safe
> --maxWorkers=1 --no-file-parallelism` returns **37 passed / 0 failed**.

## Per-attack ledger

Each entry lists the Finding ID used in the spec, the attack summary,
the observed verdict, severity, and a suggested regression location.

| Finding   | Attack                                                      | Observed   | Severity | Regression location                                                                                 |
|-----------|-------------------------------------------------------------|------------|----------|------------------------------------------------------------------------------------------------------|
| RT-C2-08  | `numeric_binding.result_ref` → `M1` (ModelSpec)             | **BLOCKED**| MINOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (store refuses via `result_refs` kind mismatch)        |
| RT-C2-09  | `numeric_binding.result_ref` → missing id                   | **BLOCKED**| CRITICAL | `tests/rt-c2/numeric-binding-attacks.spec.ts` (semantic guard: `numeric_binding_result_unresolved`)  |
| RT-C2-10  | `result_refs = ['RES1','RES1']` (duplicates)                | **BLOCKED**| MINOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (validator: `.includes` is set-equivalent)             |
| RT-C2-11  | `asserted_value = 0.7310000001` vs `Result.value=0.731`     | **BLOCKED**| CRITICAL | `tests/rt-c2/numeric-binding-attacks.spec.ts` (D-005 exact-identity, no FP slop)                      |
| RT-C2-12  | `asserted_unit = 'M'` vs `Result.unit = 'm'`                | **BLOCKED**| CRITICAL | `tests/rt-c2/numeric-binding-attacks.spec.ts` (D-006 string ===)                                     |
| RT-C2-13  | `asserted_unit = 'm '` (trailing whitespace) vs `'m'`        | **BLOCKED**| MAJOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (D-006, pins lack of normalisation)                   |
| RT-C2-14  | JSON ingress: `asserted_value = "0.731"` (string)           | **BLOCKED**| CRITICAL | `tests/rt-c2/numeric-binding-attacks.spec.ts` (zod 4.4.3 `z.number()` does not coerce)               |
| RT-C2-15  | JSON ingress: `result_ref = 42` (number, not string)        | **BLOCKED**| MAJOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (refSchema = `z.string().min(1)`)                       |
| RT-C2-16  | `asserted_unit = ""` (empty string)                         | **BLOCKED**| MAJOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (`unitSchema = z.string().min(1)`)                     |
| RT-C2-17  | `numeric_binding.result_ref` → `DA-RAW` (DataArtifact)      | **BLOCKED**| MINOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (store: `result_refs` kind mismatch)                   |
| RT-C2-18  | `asserted_value = NaN` / `±Infinity` JSON + typed ingress   | **BLOCKED**| CRITICAL | `tests/rt-c2/numeric-binding-attacks.spec.ts` (parse_failed + zod.number())                         |
| RT-C2-19  | `asserted_value = -0` vs `Result.value = 0` (bridge path)   | **BLOCKED**| MINOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (D-017 collapse)                                       |
| RT-C2-20  | `result_refs` contains binding's `result_ref` twice         | **BLOCKED**| MINOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (set-membership equivalence; gap observation pinned)   |
| RT-C2-21  | Extra key in binding (e.g. `bonus: true`)                    | **BLOCKED**| CRITICAL | `tests/rt-c2/numeric-binding-attacks.spec.ts` (zod `.strict()` on both ingest paths)                 |
| RT-C2-22  | `-0` against `Result.value = 0.731` (collapse-asymmetry)    | **BLOCKED**| MINOR    | `tests/rt-c2/numeric-binding-attacks.spec.ts` (D-017 only collapses at +0)                           |

## Findings: detail

### Finding IDs not surfaced as gaps (all BLOCKED)

**RT-C2-08 (numeric_binding.result_ref → ModelSpec).** The
`IR_REF_FIELDS` table for `Claim` lists `result_refs`, `model_refs`,
`evidence_refs` — but **not** `numeric_binding.result_ref` itself. The
attack landed because of `Claim.result_refs: ['M1']` failing the
`target: 'Result'` check at the store boundary, *not* because the
binding was ever inspected. The semantic guard's
`numeric_binding_result_unresolved` would also catch it; both layers
agree. No regression risk; the store is the first line of defence by
accident rather than by declaration.

**RT-C2-09 (numeric_binding.result_ref → missing id).** Same shape:
`IR_REF_FIELDS.Claim` does not declare `numeric_binding.result_ref`,
so the store's existence check does not run on the binding field
itself. The semantic guard catches it as
`numeric_binding_result_unresolved`. The attack reaches canonical
state — the Claim IS registered — but never reaches a Deliverable
because the bridge walks `inspectClaimEvidence` on every delivery.
This is the highest-leverage residual gap: a future renderer that
reads the snapshot without running the bridge could publish a phantom
binding. Suggested fix (out of scope for TASK 2, file as
RT-C2-09-followup): add `{ path: 'numeric_binding.result_ref', arity:
'single', target: 'Result' as const }` to `IR_REF_FIELDS.Claim` so
the store refuses a missing/wrong-kind binding at commit time, not
only at delivery.

**RT-C2-11 (FP drift).** The frozen D-007 policy: exact identity,
no tolerance. `0.7310000001 !== 0.731` and the guard reports
`numeric_value_mismatch`. The task book §3 row D-007 pins this; TASK
3 will own tolerance for hash-by-bytes re-runs. No regression risk.

**RT-C2-14 / RT-C2-15 / RT-C2-18 (typed-vs-JSON ingress drift).**
The strict-text (`parseStrictJson` + `scanIrValue`) and typed
(`put()` + same `scanIrValue`) paths share the same guarantees: a
string `asserted_value` is refused as `schema_invalid` (zod 4.4.3
`z.number()` does not coerce); `NaN` and `±Infinity` are refused by
JSON.parse outright (text path) and by `z.number()` (typed path);
`result_ref = 42` is refused by `refSchema = z.string().min(1)`.
The drift the user worried about does not exist.

**RT-C2-12 / RT-C2-13 / RT-C2-16 (unit strings).** `unitSchema` is
`z.string().min(1)`: any non-empty string is accepted at the
boundary (case, trailing whitespace, leading whitespace all pass).
Equality is `assertedUnit === target.unit` (ECMAScript string ===),
so `'M'`, `'m '`, and `''` against `'m'` all produce
`numeric_unit_mismatch`. The guard does the right thing without any
normalisation; a future refactor that adds `.toLowerCase()` /
`.trim()` would silently widen acceptance and break D-006.

**RT-C2-17 (binding → DataArtifact).** Same shape as RT-C2-08; the
store catches it via `Claim.result_refs: ['DA-RAW']` failing
`target: 'Result'`. The semantic guard would also catch it.

**RT-C2-19 / RT-C2-22 (-0 / +0 collapse, D-017).** The frozen policy:
`-0 === +0` (so `asserted_value: -0` against `Result.value: 0` is
PASS), but `-0 === 0.731` is false (collapse only at zero). The
bridge path PASSES with `-0`/`+0`; the validator catches `-0`/non-zero
as `numeric_value_mismatch`.

**RT-C2-20 (duplicate `result_refs`).** The schema refines
`ProblemSpec.requirement_refs` and `ModelSpec.{variable_refs,
parameter_refs}` against duplicates but **not** `Claim.result_refs`.
A `['RES1', 'RES1']` array is schema-legal and store-legal. The
validator uses `.includes` (set-membership), so duplicates are
invisible. Bridge still PASSes. This is a code-smell observation,
not an attack — duplicates cannot bind a claim to a different Result
than `RES1` because every entry collapses to the same id. **Severity:
MINOR.** Suggested regression: pin the gap with a `Schema duplicate
refine on Claim.result_refs` follow-up (e.g. `.refine(v => new
Set(v.result_refs).size === v.result_refs.length)`), matching the
existing pattern on `requirement_refs`. Out of scope for TASK 2 (the
validator's contract holds), worth filing as a future tightening.

**RT-C2-21 (extra keys / strict()).** `claimSchema` and
`numericBindingSchema` are both `.strict()`. An extra key in either
field is refused by `unrecognized_keys` on both the JSON and typed
ingest paths. No drift.

## Verdict summary

| Metric                  | Count   |
|-------------------------|---------|
| Total attacks driven    | 15      |
| BLOCKED                 | 15      |
| SUCCEEDED (real gap)    | 0       |
| Minor gap observations  | 2 (RT-C2-09 followup; RT-C2-20 duplicate-refine) |
| Test files touched      | 1 (`packages/paper/paper-foundation/tests/rt-c2/numeric-binding-attacks.spec.ts`) |
| Production source edits | 0       |

## Recommended follow-ups (none blocking TASK 2)

1. **RT-C2-09-followup** — add `numeric_binding.result_ref` to
   `IR_REF_FIELDS.Claim` with `target: 'Result'`, so the store refuses
   a phantom or wrong-kind binding at commit time. The semantic guard
   already catches it; this moves the check to the cheaper layer.
2. **RT-C2-20** — add a duplicate-refine to `Claim.result_refs`
   (mirroring `ProblemSpec.requirement_refs`). Set-membership is
   currently correct; this is purely a tightening.

Neither is a TASK 2 defect; both are hardening suggestions for the
next time the binding machinery is touched.