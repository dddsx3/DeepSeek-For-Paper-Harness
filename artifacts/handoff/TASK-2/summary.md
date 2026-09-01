# TASK 2 — Summary

## One-line conclusion

**Every CRITICAL numeric Claim now machine-binds to a canonical Result**
through a structural discriminated-union `Claim` shape, a semantic
validator that reads the canonical snapshot (not the artifact
subset), and a bridge that refuses delivery when any CRITICAL Claim
fails its type-specific evidence contract. All gates green; all
mutations killed; all fault corpus entries behave as expected.

## What changed

| Concern | Before TASK 2 | After TASK 2 |
|---------|---------------|--------------|
| `Claim` schema | single shape, "at least one ref" refine | `zod.discriminatedUnion('claim_type')` (NUMERIC/MODEL/QUALITATIVE) |
| NUMERIC binding | absent | required `numeric_binding: { result_ref, asserted_value, asserted_unit }` |
| MODEL binding | accepted | `numeric_binding: null` literal |
| QUALITATIVE CRITICAL | accepted with zero evidence | blocked by semantic guard |
| Bridge | "at least one CRITICAL Claim exists" | "every CRITICAL Claim passes its type-specific contract" |
| Equality | none | exact identity (`a === b`, collapsing `-0/+0`) |
| Snapshot walker | `hasCriticalClaim` first-match | `inspectClaimEvidence(store)` snapshot-driven |
| `IrBridgeDecision` | `claimProblems, missingBackbone, missingCriticalClaim, contractFailures, contractSatisfied` | + new `evidenceFailures` |

## Phase roll-up

| Phase | What | Verified by |
|-------|------|-------------|
| 0 | Topology recon; zero production edits | `phase-0-topology.md` |
| 1 | Schema discriminatedUnion | 51 files / 574 tests green |
| 2 | `src/ir/claim-evidence.ts` validator | 23 unit tests |
| 3 | Bridge walks every CRITICAL Claim | 8 new bridge tests (D-004..D-020) |
| 4 | Fault corpus D-001..D-020 | 20 / 20 PASS |
| 5 | 16 mutations + 4-role red team | 16 / 16 killed, CRITICAL escape = 0 |
| 6 | Final gate | this file + `gate-report.json` |

## Verification matrix

| Check | Result |
|-------|--------|
| `corepack pnpm exec vitest run packages/paper/paper-foundation/` | **61 files / 735 tests PASS** |
| `corepack pnpm exec vitest run packages/paper/paper-foundation/tests/ir/` | **256 tests PASS** |
| `corepack pnpm exec vitest run packages/paper/paper-foundation/tests/rt-c{1..4}/` | **142 attacks / 141 BLOCKED / 1 LOW gap** |
| `tsc --noEmit -p packages/paper/paper-foundation/tsconfig.json` | **0 errors** |
| Standalone fault corpus (`node run-fault-corpus.mjs`) | **20 / 20** |
| Targeted mutation (`node run-mutations.mjs`) | **16 / 16 killed, 0 SURVIVED** |

## External red team

Four roles (RT-C1 / RT-C2 / RT-C3 / RT-C4) drove 142 attacks against
the just-landed TASK 2 in `tests/rt-c{1..4}/`. **CRITICAL escape =
0.** One LOW gap (RT-C1-27: Proxy bypass `scanIrValue`) is filed in
`known-risks.md` item 10 and deferred. The full roll-up is in
`redteam-rtactions.md`; per-role reports in `redteam-rt-c{1..4}.md`.

## Outstanding items

None within TASK 2's hard scope. The known-risks list delegates
everything out of TASK 2's scope to TASK 3 / 3.5 / 5 / 7 — see
`known-risks.md`.