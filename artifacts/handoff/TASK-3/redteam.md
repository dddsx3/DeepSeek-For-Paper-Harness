# TASK 3 — Red-team report (RT-X1..RT-X4)

Task book §9 mandates four external roles attacking the Execution
Provenance Gate in the real environment, with every exploit becoming a
regression *before* the fix. This file is the index; each role has its
own report.

| Role | Mandate | Attacks | Verdict | Report |
|---|---|---|---|---|
| **RT-X1** Capture Forger | fabricate schema-valid records and get a delivery verdict out of them | 4 | 3 refused, 1 is a **declared boundary** (RT-X1-01) | [redteam-rt-x1.md](redteam-rt-x1.md) |
| **RT-X2** Replay Saboteur | tamper with the runner / replay environment; crash the replay | 3 | 3/3 intercepted | [redteam-rt-x2.md](redteam-rt-x2.md) |
| **RT-X3** Provenance Omission | hide runs, cover the wrong run, submit holed records | 4 | 4/4 intercepted | [redteam-rt-x3.md](redteam-rt-x3.md) |
| **RT-X4** Gate / Workflow | attack the judge: identity, criticality, mode rules, determinism, mutation | 4 | 4/4 intercepted | [redteam-rt-x4.md](redteam-rt-x4.md) |

Corpus driver: `artifacts/handoff/TASK-3/run-fault-corpus.mjs`.
Last recorded run: **48 tests, 48 passed, 0 failed — "ALL ATTACKS
INTERCEPTED"** (`execution-results.json`).
Mutation run: **8/8 killed** (`mutation-results.json`, P-01..P-08).

## The one finding that is not a refusal

**RT-X1-01 is a pass for the attacker, and it is supposed to be.** A
hand-forged record — schema-valid, correctly attached, with fabricated
`stdout_hash` / `output_hash` — passes the *structural* gate
(`evaluateProvenanceGate`) and is refused only by the *replay*
(`runIndependentExecutionAudit`).

That is the D8 layering, not a hole:

- the gate is cheap and byte-blind; it answers "is the record
  structurally complete and attached to the obligation-bearing run",
  and it runs on every delivery;
- the replay is expensive and byte-exact; it answers "do those bytes
  actually exist", and it re-derives every digest from a real run.

The test is written to *watch that boundary*, and it is named so a
reader cannot skim past it ("a hand-forged record passes the
STRUCTURAL gate…" / "…but the replay audit refuses the forged byte
digests"). The consequence is stated as a risk rather than buried:
any caller that consults the gate and skips the replay is
unprotected, and TASK 4's gate registry must make that composition
impossible rather than merely discouraged.

## What each role actually established

- **Forgery is bounded by derivation, not by validation.** Every
  refusal in RT-X1 comes from the auditor recomputing something the
  forger claimed. Schema validation alone would have lost all four.
- **A crashed replay is a failed replay** (RT-X2-03). The auditor's
  wrapper converts an exception into a FAIL; there is no third state.
- **Absence is not a defence** (RT-X3-01/02). The obligation set is
  derived from claims, never from the records that happen to exist,
  and coverage is per-run so one good run cannot mask a bad one.
- **The judge is read-only and deterministic** (RT-X4-03/04), refuses
  stores it cannot identify (RT-X4-02), and grants no exemption to an
  unrecognised mode (RT-X4-01).

## Method notes

- Attacks are *executed*, not argued: each is a named `it()` in
  `tests/rt-x/attacks.spec.ts` asserting the observable verdict.
- No production code was edited inside the attack suite by design
  (the file's own header states it).
- The two executor-level end-to-end assertions live in
  `tests/execution/provenance-gate.spec.ts`, because they need a full
  composition; they are part of the same corpus run.

## Follow-ups this report hands forward

1. The gate-passes-forgery boundary (above) must be closed at the
   *composition* level in TASK 4.
2. `Claim.criticality` is trusted by the obligation derivation
   (INV-3-J). Mis-declared criticality is a TASK 5 Oracle Routing
   concern, out of scope here.
3. Replay comparison is exact identity by mandate (task book §2.1).
   Whether cross-source comparison deserves a tolerance band is the
   deferred TASK 4.4 / 5.0.10 question and must not be smuggled into
   the replay path.
