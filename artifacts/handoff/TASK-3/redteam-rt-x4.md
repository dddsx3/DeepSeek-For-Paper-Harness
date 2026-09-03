# RT-X4 — Gate / Workflow

**Mandate.** Attack the gate as a component: its identity, its
criticality, its mode rules, its determinism, and its right to touch
the state it reads. The other three roles attack the *evidence*; this
one attacks the *judge*.

**Surface attacked.** `requiresIrBackbone`, `evaluateProvenanceGate`,
and the gate's interaction with canonical state.

**Regression home.** `packages/paper/paper-foundation/tests/rt-x/attacks.spec.ts`,
`describe('RT-X4 — Gate / Workflow')`; the executor-level half lives
in `tests/execution/provenance-gate.spec.ts`
(`describe('the executor enforces provenance end-to-end')`).

## Attacks executed

### RT-X4-01 (EX-12) — unknown workflow modes fail closed
**Observed: `requiresIrBackbone('WEIRD') === true`,
`requiresIrBackbone(' fast ') === true`,
`requiresIrBackbone('EXPLORATORY') === false`.** Two properties in
three assertions. Unknown modes are *not* exempt — an unrecognised
mode string must not land in a permissive branch by accident. And the
whitespace case, `' fast '`, closes the "normalise your way into an
exemption" trick: only the exact `EXPLORATORY` token is exempt.
`EXPLORATORY` remains the single documented exemption, and it is
exempt from the *gate*, never from schema or store closure.

### RT-X4-02 — a store that cannot prove its identity blocks the gate
Hand the gate a duck-typed impostor (`{ get, list }`) instead of a real
`ModelingIr`.
**Observed: `BLOCKED` with `run_id: '$store'`.** The gate refuses the
*store*, not merely the runs inside it, and the failure is attributed
to a reserved id so it cannot be confused with a per-run verdict. A
caller cannot hand the gate an object it controls and have the gate
conclude "no runs, nothing to check".

### RT-X4-03 — the verdict is deterministic for the same store
Two calls on one store.
**Observed: deep-equal verdicts.** This closes the "re-run until it
passes" attack and, more importantly, makes the gate usable as
evidence: an audited verdict can be reproduced by the auditor.

### RT-X4-04 — the gate never mutates canonical state
**Observed: `ir.size` unchanged across a gate evaluation.** A gate
that writes — even helpfully, e.g. caching a verdict on the store —
would create a second writer of canonical state and a way to launder a
refusal into a record. The gate reads.

## The executor half

The gate's refusal is only meaningful if the workflow honours it.
`tests/execution/provenance-gate.spec.ts` closes that loop end to end:
a full backbone **without** an execution record is refused before any
manifest is written, and the canonical backbone **with** its record
still delivers. The first assertion was re-based in TASK 5.0.5: it
used to match the string `/no execution provenance/`, which no longer
exists anywhere in `src/` — the real message is assembled by
`evaluateDelivery` as
`critical_gate:provenance:BLOCKED:execution provenance blocked: N failure(s) [<run_id>:MISSING_EXECUTION]`.
The test now pins the stable parts (refusal, gate id and status,
failure category) instead of a sentence, so wording changes cannot
silently turn it into a no-op.

## Verdict

**4 of 4 intercepted**, plus the two executor-level end-to-end
assertions. The gate is deterministic, read-only, mode-honest, and
refuses stores it cannot identify.

## Residual risk

`requiresIrBackbone` is a pure function of a mode string; it does not
check that the *caller's* declared mode matches the runtime profile's
active mode. A mode-mismatch attack is the runtime guard's
responsibility (TASK -1, `assertRuntimeReady`) and is enforced there.
