# RT-X3 — Provenance Omission

**Mandate.** Never forge anything. Instead, make the obligation
disappear: hide a run from the gate, cover the wrong run, or hand over
a record with holes in it. This is the quietest attack in the corpus —
no bad bytes, just absence — and historically the easiest to win,
because "no record" and "nothing to check" look identical to a naive
counter.

**Surface attacked.** `evaluateProvenanceGate` and the `ExecutionRecord`
schema, over `ModelingIr` stores built from `chainThrough(...)`.

**Regression home.** `packages/paper/paper-foundation/tests/rt-x/attacks.spec.ts`,
`describe('RT-X3 — Provenance Omission')`.

## Attacks executed

### RT-X3-01 (EX-11) — a critical-chain run with no record cannot hide
A complete Problem → Model → Run → Result → CRITICAL Claim chain with
no `ExecutionRecord` at all.
**Observed: `BLOCKED`, first failure `{ run_id: 'RUN1', category: 'MISSING_EXECUTION', severity: 'CRITICAL' }`.**
The gate's obligation set is derived from the claims, not from the
records — a store with zero records is not a store with zero
obligations. This is the single most important assertion in the
corpus: it is the difference between "count what exists" and "check
what is required".

### RT-X3-02 — a record attached to the WRONG run leaves the right run uncovered
Register a second `RunArtifact` (`RUN2`) and attach a well-formed
record to it, hoping the gate counts records globally.
**Observed: `BLOCKED`, with a `RUN1`-scoped `MISSING_EXECUTION`
failure still present.** One valid run must never mask an invalid one
(task book §13 rule 6); coverage is per-run.

### RT-X3-03 (EX-08) — a partial record dies at the schema
Delete `stdout_hash` from an otherwise valid record and `put` it.
**Observed: `put` refused (`accepted: false`).** A record missing a
byte digest is not a record with a nullable digest. There is no
"partially proven" state to reason about downstream.

### RT-X3-04 — non-critical claims place no provenance obligation
A `QUALITATIVE` claim declaring `NON_CRITICAL` **with** a
`criticality_rationale`.
**Observed: `PASS` with `execution_checked: 0`.** This is a legitimate
exit from the obligation set, and the test pins both halves of it:
the rationale is mandatory (3.R1 / INV-3-I — the old
"NON_CRITICAL QUALITATIVE with no rationale" route is closed at the
schema), and once no claim is critical the gate is *vacuously* PASS
rather than silently skipping. The distinction matters: `execution_checked: 0`
is an observable number, so "nothing was required" and "nothing was
checked because it was inconvenient" are different lines in the
report.

## Verdict

**4 of 4 intercepted.** Omission does not reduce the obligation set;
only a non-critical, rationale-carrying claim does, and that is
observable in the report.

## Residual risk

The obligation set is derived from `Claim.criticality`. A claim whose
criticality is *wrong* (a numeric claim mis-declared as
`NON_CRITICAL`) removes the execution requirement without tripping
anything here — the classifier decides criticality, and the gate
trusts it (INV-3-J). Attacking the classifier is TASK 5's Oracle
Routing surface, not this one.
