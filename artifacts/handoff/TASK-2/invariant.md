# TASK 2 — Invariants

> Each invariant is one paragraph; the test or mutation that proves
> it is listed at the end. Re-runnable: every entry below has a
> matching `tests/ir/*` regression or one of M-01..M-16.

## INV-2-A — CRITICAL NUMERIC Claim must have a machine binding

A CRITICAL Claim whose `claim_type` is `NUMERIC` declares
`numeric_binding = { result_ref, asserted_value, asserted_unit }`,
and the binding is non-null at the type level. `text` is not the
source of the core number; the binding is.

**Closed set**: `numericBindingSchema` (src/ir/schema.ts) —
discriminatedUnion `claim_type === 'NUMERIC'` branch.
**Regression**: M-01 (drop binding requirement — killed),
`tests/ir/redteam.spec.ts > NON_CRITICAL NUMERIC without
numeric_binding is BLOCKED`, D-001 fault corpus entry.

## INV-2-B — `numeric_binding.result_ref` resolves to a Result, and is in `result_refs`

The binding's `result_ref` must (a) resolve to a `Result` in the
canonical store, and (b) appear in the Claim's own `result_refs[]`.
Either check failing is a `BLOCKED`.

**Closed set**: `validateClaimEvidence` (src/ir/claim-evidence.ts).
**Regression**: M-10 (kill the result_ref membership check — killed),
M-11 (kill the resolve check — killed), D-002, D-003, D-004 fault
corpus entries.

## INV-2-C — asserted_value / asserted_unit exactly match `Result`

`asserted_value === Result.value` (frozen equality: `a === b`,
collapsing `-0/+0`); `asserted_unit === Result.unit`. No tolerance,
no rounding, no coercion.

**Closed set**: `numericValuesEqual` (src/ir/claim-evidence.ts).
**Regression**: M-02, M-03, M-15, M-16 — all killed. D-005, D-006,
D-007, D-017 fault corpus entries.

## INV-2-D — Result → RunArtifact → ModelSpec → ProblemSpec closure is the IR's job, not the Claim gate's

The Claim evidence validator **does not re-derive** the closure; the
store's `IR_REF_FIELDS` already requires `Result.run_ref →
RunArtifact`, and `RunArtifact.model_ref → ModelSpec`. The validator
reads the closure through its resolver and checks the *semantic*
binding on top.

**Closed set**: existing `IR_REF_FIELDS` (src/ir/refs.ts) +
`validateClaimEvidence`'s resolver (src/ir/claim-evidence.ts).
**Regression**: TASK 1.5R's 12-CLOSED-condition test set; re-runs
green under TASK 2.

## INV-2-E — MODEL and QUALITATIVE claim-type contracts

- MODEL Claim: `numeric_binding === null`, `model_refs.min(1)`,
  every model_ref resolves to a registered `ModelSpec`.
- QUALITATIVE CRITICAL Claim: `numeric_binding === null`,
  `evidence_refs.length ≥ 1`.

**Closed set**: `claimSchema` discriminator branches + semantic
guards for the empty-evidence case.
**Regression**: M-06 (allow MODEL with binding — killed), M-07
(allow QUALITATIVE zero evidence — killed), M-09 (drop MODEL
model_refs.min(1) — killed), M-12, M-14 (drop MODEL semantic check —
killed), D-009, D-010, D-011, D-012 fault corpus entries.

## INV-2-F — FORMAL / FAST blocks on any invalid CRITICAL Claim

`evaluateIrBridge` walks every CRITICAL Claim in the canonical
snapshot (not the artifact-subset). One valid + one invalid CRITICAL
Claim is BLOCKED (D-013). The bridge refuses delivery when
`evidenceFailures.length > 0`.

**Closed set**: `inspectClaimEvidence` (src/ir/claim-evidence.ts) +
`ok = … && evidenceFailures.length === 0` (src/ir/bridge.ts).
**Regression**: M-04 (kill the walker — killed), M-05 (replace walker
with artifact-subset — killed), M-13 (drop the `ok` clause — killed),
D-013, D-014 fault corpus entries, `tests/ir/bridge.spec.ts >
D-013 / D-014`.

## INV-2-G — No repair / fallback / parse-from-text

A Claim's `numeric_binding` is the only source of the canonical
machine value. The validator does not parse `text`; the schema does
not coerce; the bridge does not fall back to "trust the model".
An invalid Claim is *unreachable in canonical state* once the store
boundary refuses it; once it passes the store, the bridge refuses
delivery.

**Closed set**: every schema-level `.strict()` + discriminated
discriminator + the absence of any text-parsing helper in
`claim-evidence.ts`.
**Regression**: M-01, M-02, M-03, M-05, M-06, M-07, M-10..M-16 —
all killed.

## INV-2-H — EXPLORATORY is exempt from the backbone, not from the shape contract

EXPLORATORY mode does not require the canonical backbone (Problem →
Model → Run → Result → CRITICAL Claim). It **does** still require
every object in the store to be schema-valid + ref-closed +
type-valid (schema enforces shape; bridge does not relax
`evidenceFailures` for EXPLORATORY).

**Closed set**: the bridge's `requiresBackbone` exemption is
*only* applied to the backbone / minimum-contract checks; the
`evidenceFailures` check runs unconditionally.
**Regression**: implicit in every `ok = … && evidenceFailures.length === 0`
case; explicit re-runs green.