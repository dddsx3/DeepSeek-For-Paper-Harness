# RT-X2 — Replay Saboteur

**Mandate.** The capture is honest; attack the *replay* instead. Change
the runtime, mutate the outputs between the two runs, or make the
replay crash — and see whether any of those produce a PASS. The
saboteur owns everything downstream of the record: the runner seam, the
process environment, and the failure paths of the auditor.

**Surface attacked.** `replayExecution` and
`runIndependentExecutionAudit`, both through the `ExecutionRunner`
seam.

**Regression home.** `packages/paper/paper-foundation/tests/rt-x/attacks.spec.ts`,
`describe('RT-X2 — Replay Saboteur')`.

## Attacks executed

### RT-X2-01 — swapping the runtime between capture and replay
Capture with `runtimeFacts: { runtime: 'deterministic-fake' }`, replay
with `runtimeFacts: { runtime: 'other-runtime-vX' }`.
**Observed: `ok: false`, `ENVIRONMENT_MISMATCH`.** The runtime
fingerprint is re-derived at replay time from what actually ran, not
copied from the record — so a runtime swap is a drift, not a detail.
This is the D4 "measured fingerprint beats declared fingerprint"
decision, proven against an attacker rather than asserted.

### RT-X2-02 — silent output mutation between capture and replay
Replay emitting `mean_thickness: 0.731000001` where the capture froze
`0.731`.
**Observed: `ok: false`, `OUTPUT_MISMATCH`.** Worth stating plainly:
this is *not* a numeric-tolerance check. The comparison is byte
identity over the canonical JSON (task book §2.1: no tolerance, no
rounding, no coercion). A one-ulp drift is a failed replay, and the
project's position is that this is correct — whether a *cross-source*
comparison should get a tolerance band is the deferred TASK 4.4
question, and it is explicitly **not** this code path.

### RT-X2-03 — making replay throw its way to a PASS
A runner whose `run()` unconditionally throws.
**Observed: the audit reports `FAIL` with a non-empty failure list.**
This is the important one for fail-closed posture: an exception inside
the replay is not "no verdict", and it is certainly not "no news is
good news". A crashed replay is a failed replay.

## Verdict

**3 of 3 intercepted.** The replay's trust model holds under a hostile
runner: it derives, it does not believe, and it converts its own
failures into refusals.

## Residual risk

The saboteur here controls the runner *implementation* handed to the
auditor, not the runner *selection*. In a real composition the runner
is chosen by the runtime profile; an attacker who can swap the runner
binding between capture and replay without touching `runtimeFacts`
would be attacking the composition layer (TASK -1's firewall), not
this gate. Not exercisable from inside this package.
