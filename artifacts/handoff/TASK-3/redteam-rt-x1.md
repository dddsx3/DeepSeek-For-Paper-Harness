# RT-X1 — Capture Forger

**Mandate.** Fabricate a schema-valid `ExecutionRecord` and get it into
canonical state, then get a delivery verdict out of it. The forger is
allowed to know the schema, the declared fingerprints, and the capture
seam's public shape. It is *not* allowed to produce the bytes a real run
produces — and that asymmetry is the whole point of the role.

**Surface attacked.** `captureExecution` → `ingestCapturedRecord` →
`evaluateProvenanceGate` (structural) → `runIndependentExecutionAudit`
(byte truth, via `replayExecution`).

**Regression home.** `packages/paper/paper-foundation/tests/rt-x/attacks.spec.ts`,
`describe('RT-X1 — Capture Forger')`.

## Attacks executed

### RT-X1-01 — a hand-forged record passes the STRUCTURAL gate
1. Capture honestly into a scratch store.
2. Copy the record and replace `stdout_hash` and `output_hash` with
   digests of fabricated bytes.
3. Ingest the forgery and ask the *structural* gate for a verdict.
4. **Observed: `PASS`.**

This is recorded as a **pass for the attacker by design**, not an
escape. The structural gate is deliberately cheap and byte-blind
(task book D8: the gate answers "is the record structurally complete
and attached to the right run", the replay answers "do the bytes
exist"). The test exists so the boundary is *documented and
watched*: if the structural gate ever stops passing this case, the
layering has changed and this file must be re-argued.

### RT-X1-02 — the replay audit refuses the forged byte digests
Same forgery, handed to `runIndependentExecutionAudit`.
**Observed: `FAIL` with `OUTPUT_MISMATCH` under a `replay:` reason.**
The auditor re-derives every digest from a real run instead of
trusting the record, so the fabricated pair cannot survive.

### RT-X1-03 — a fabricated `exit_status` is refused by the replay
A record declaring `exit_status: 0` and `stdout_hash` of a string the
real runner never emits.
**Observed: `FAIL`.** A declared exit status is a claim about a run,
not a fact about one; only the replay's own process exit counts.

### RT-X1-04 — the forged pipeline cannot touch canonical state on refusal
`captureExecution` with `loadCode` returning bytes whose digest does
not match the run's declared `code_hash`.
**Observed: the store is unchanged — `ir.size` is identical and
`ir.has('EXEC1')` is `false`.** Capture is total: it either writes a
verified record or nothing at all. There is no partial-write state for
a later stage to pick up and promote.

## Verdict

**3 of 4 refusals are enforcement; 1 of 4 (RT-X1-01) is a declared
boundary.** No forgery reached a delivery verdict: the only path from a
record to "deliverable" runs through the replay, and the replay
re-derives.

## Residual risk

The structural gate's PASS on forged bytes means a caller that
*consults only the gate* and skips the replay is unprotected. That is
exactly the composition TASK 4's gate registry must forbid — the
`provenance` gate is critical and mandatory, but a future caller must
not be able to treat "gate PASS" as "execution verified" while
silently omitting the replay step. Tracked in `known-risks.md`.
