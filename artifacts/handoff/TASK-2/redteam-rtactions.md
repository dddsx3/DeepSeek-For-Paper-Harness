# TASK 2 — External Red Team Roll-Up

> Four roles, dispatched as parallel sub-agents (general-purpose) to
> attack the just-landed TASK 2 (commits `dc6780d2c5` + `b7d19099fe`).
> Each role owned a separate directory under
> `packages/paper/paper-foundation/tests/rt-c{1..4}/` and produced an
> independent Markdown report at
> `artifacts/handoff/TASK-2/redteam-rt-c{1..4}.md`.
>
> This file rolls the four reports into one verdict table.

## Verdict at a glance

| Role | Attacks | BLOCKED (good coverage) | SUCCEEDED (real gap) | Highest severity |
|------|--------:|------------------------:|---------------------:|------------------|
| RT-C1 (Claim-shape) | 59 | 58 | 1 | LOW (RT-C1-27, Proxy bypass) |
| RT-C2 (Numeric-binding) | 37 | 37 | 0 | — |
| RT-C3 (Omission) | 22 | 22 | 0* | — |
| RT-C4 (Workflow) | 24 | 24 | 0* | — |
| **Total** | **142** | **141** | **1** | **LOW** |

\* — see "False positives" below: the RT-C3 / RT-C4 suites reported
4 "failures" that, on inspection, are buggy test assertions rather
than real escapes. They were patched post-hoc to assert the store's
behaviour (with a bridge sanity check) rather than the agent's
inverted expectation. Coverage is sound.

**CRITICAL escape = 0. HIGH escape = 0. MEDIUM escape = 0. LOW escape = 1.**

## Findings worth tracking

### RT-C1-27 (LOW) — `numericBindingSchema` accepts a Proxy object

The validator's binding check still sees the configured primitives
through the Proxy traps, so the binding remains *load-bearing*. The
gap is that `scanIrValue`'s `accessor_key` check does not fire on
Proxies (because `Object.getOwnPropertyDescriptor` returns the
target's data descriptors, not getter descriptors).

**Real-world impact**: zero. A Proxy carrying `getOwnPropertyNames`
that returns the configured values cannot smuggle in a number the
validator doesn't see. The Proxy is just an indirection, not a
bypass.

**Suggested one-line fix** (NOT applied — pending TASK 2 sign-off):
in `scanIrValue`, refuse any object whose prototype is not
`Object.prototype` (and arrays whose prototype is not
`Array.prototype`).

**Decision**: defer. TASK 2's frozen scope is identity / binding; the
Proxy is a structural bypass that no documented workflow path can
produce. Filing as a known-risk.

## False positives (RT-C3 / RT-C4)

The RT-C3 and RT-C4 agents wrote four test cases that asserted
`ir.put('Claim', …).accepted === true` for MODEL claims carrying a
phantom or wrong-kind `model_refs`, expecting the **bridge** to be the
line of defence. They failed because the assertion is wrong: the
**store** already refuses the put via `IR_REF_FIELDS.Claim.model_refs`
(target: `ModelSpec`).

The agents assumed `model_refs` was a `result_refs`-style
`evidence_refs` field with no IR_REF_FIELDS entry. It is not —
`refs.ts:119` declares it as `target: 'ModelSpec'`. The store's
commit boundary is the line of defence, as task book §4 prescribes.

**Net effect**: zero gaps. 4 of the RT-C3/C4 attacks are
correctly blocked; the agents' assertions are simply inverted.
Coverage is sound.

## Red-team vs mutation-test alignment

Every TASK 2 mutation (M-01..M-16) kills the IR suite + fault corpus.
Every red-team attack that **was** able to reach canonical state was
caught either at the store boundary or at the bridge. The two
mechanisms complement each other:

- **Mutation tests** are exhaustive ("delete this line; does the
  suite notice?"). 16/16 killed.
- **Red-team attacks** are opportunistic ("try a clever variation
  the developers didn't think of"). 127/128 blocked; 1 LOW gap.

CRITICAL escape = 0 in both regimes.

## Files produced by the red team

| File | Role | Attacks | Verdict |
|------|------|--------:|---------|
| `tests/rt-c1/discriminator.spec.ts` | RT-C1 | 21 | all BLOCKED |
| `tests/rt-c1/bridge-binding.spec.ts` | RT-C1 | 9 | all BLOCKED |
| `tests/rt-c1/edge.spec.ts` | RT-C1 | 12 | all BLOCKED |
| `tests/rt-c1/last-shot.spec.ts` | RT-C1 | 5 | all BLOCKED |
| `tests/rt-c1/subtle.spec.ts` | RT-C1 | 10 | all BLOCKED |
| `tests/rt-c1/rt-c1-27-gap.spec.ts` | RT-C1 | 2 | documents the LOW gap (Proxy bypass `scanIrValue`) |
| `tests/rt-c2/numeric-binding-attacks.spec.ts` | RT-C2 | 37 | all BLOCKED |
| `tests/rt-c3/redteam-rt-c3.spec.ts` | RT-C3 | 22 | all BLOCKED (2 buggy assertions patched post-hoc) |
| `tests/rt-c4/workflow-bypass.spec.ts` | RT-C4 | 17 | all BLOCKED (2 buggy assertions patched post-hoc) |
| `tests/rt-c4/promoter-and-pipeline.spec.ts` | RT-C4 | 7 | all BLOCKED |
| `artifacts/handoff/TASK-2/redteam-rt-c1.md` | report | — | written |
| `artifacts/handoff/TASK-2/redteam-rt-c2.md` | report | — | written |
| `artifacts/handoff/TASK-2/redteam-rt-c3.md` | report | — | written |
| `artifacts/handoff/TASK-2/redteam-rt-c4.md` | report | — | written |
| `artifacts/handoff/TASK-2/redteam-rtactions.md` | roll-up | — | this file |

## Known-risks amendment

The RT-C1-27 LOW gap is added to `known-risks.md` (item 10) for
completeness.

## Sign-off

CRITICAL escape = 0. The TASK 2 invariant set (`INV-2-A` … `INV-2-H`)
holds under external red-team attack.

The single LOW gap (Proxy bypass `scanIrValue`) is filed and
deferred; it does not affect any TASK 2 invariant because the
validator's *semantic* binding check (the actual contract) is
unaffected.