# TASK 1.5 — PHASE 6: Red Team

- pinned main: `622b46cc46396399862d393afb98253503828aed`
- regressions: `packages/paper/paper-foundation/tests/ir/redteam15.spec.ts` (24 tests, all green)
- mutation evidence: `mutation-results.json` (PHASE 7)

Four independent roles, each executing attacks rather than reasoning about
them. Every finding below was reproduced against the code before it was
reported; each CRITICAL was turned into a failing regression before the fix
was accepted.

## Result

**CRITICAL escapes found: 3. All closed. Remaining CRITICAL escape count: 0.**

| Role | Attacks executed | Escapes found | Severity | Status |
|------|------------------|---------------|----------|--------|
| RT-A schema / parser | 6 | 1 (oversized arrays) | HIGH | closed |
| RT-B reference graph | 5 | 1 (orphan ModelSpec) | CRITICAL | closed |
| RT-C workflow bypass | 4 | 1 (globally-counted contract) | CRITICAL | closed |
| RT-D semantic drift | 3 | 1 (Unicode token collision) | CRITICAL | closed |

Three findings were probed and **found already closed** — prototype
pollution, non-finite numbers, and type confusion on the closed enums. They
are recorded with evidence so the next red team does not re-derive them, and
their tests are kept so a future refactor cannot silently reopen them.

---

## RT-D-01 — CRITICAL — same-scope token uniqueness was byte-exact

**Attack.** `findDuplicateSymbolTokens` keys on `` `${scope}\u0000${token}` ``
compared with `===`, while `symbolTokenSchema` accepted any string free of
control / format / surrogate / separator characters. That charset admits
combining marks, so `é` (U+00E9) and `é` (`e` + U+0301) both pass the schema,
are *canonically equivalent*, and are *byte-distinct*.

**Exploit.** One problem scope holding two SymbolSpecs for "the same" symbol:

- `SYM-x` — token `é`, meaning *"distance along track"*, unit `m`
- `SYM-decomp` — token `é`, meaning *"a different quantity"*, unit `s`

Both ingested cleanly. `findDuplicateSymbolTokens` returned `[]`. The bridge
returned **PASS** in FORMAL. This is the exact failure TASK 1.5 exists to
prevent: the same symbol silently carrying two meanings.

**Fix.** `symbolTokenSchema` now requires Unicode NFC, matching every other
identifier in the IR. This is stronger than normalising at comparison time:
NFC is a *canonical* form, so after the requirement canonical equivalence
collapses onto byte equality and the existing check becomes sound. It also
fails closed at the earliest point — the second spelling is refused at ingest
and never enters canonical state at all.

**Residual (accepted, recorded in `known-risks.md`).** NFC does not fold
*compatibility* equivalents, so Latin `a`, Cyrillic `а` (U+0430) and
fullwidth `ａ` (U+FF41) remain three distinct tokens. That is the same policy
the IR already applies to object IDs; folding it needs a confusable table
that is out of scope here.

---

## RT-B-01 — CRITICAL — a ModelSpec owned by no ProblemSpec skipped every symbol guard

**Attack.** The bridge filtered ModelSpecs per ProblemSpec:

```ts
modelSpecs.filter(m => m['problem_refs'].includes(problem['problem_id']))
```

A ModelSpec whose `problem_refs` is `[]` is claimed by *nobody*, so it was
handed to no ProblemSpec's contract walk.

**Exploit.** `ModelSpec` with `problem_refs: []`, `variable_refs: ['SYM-rho']`
where `SYM-rho` is a **PARAMETER**, and `parameter_refs: [{symbol_ref: 'SYM-x'}]`
where `SYM-x` is a **VARIABLE**. Both are precisely the mismatches C-012 and
C-013 exist to catch. The store ingested it (it has nothing to say about
ModelSpec symbol refs), the bridge never examined it, and delivery returned
**PASS** with a parameter being solved for as a variable.

**Fix.** The ModelSpec symbol walk is extracted into
`validateModelSpecSymbols` and the bridge now calls it a second time for the
orphans — ModelSpecs no ProblemSpec claims. The per-problem walk is unchanged,
so no failure is reported twice.

A ModelSpec that declares no problem *and uses no symbol* still passes. That
is not a loophole: there is nothing for the symbol guards to check. The escape
was an unowned model that used another problem's symbols.

---

## RT-C-01 — CRITICAL — the minimum contract was counted globally, not bound to a problem

**Attack.** `minimumProblemContractSatisfied` only asked whether the *store*
contained ≥1 RAW_PROBLEM DataArtifact, ≥1 ProblemSpec, ≥1 REQUIRED_OUTPUT
RequirementSpec and ≥1 SymbolSpec. Nothing required those objects to be
connected to each other.

**Exploit.** A ProblemSpec with `requirement_refs: []` — declaring that the
problem asks for nothing at all — alongside a REQUIRED_OUTPUT RequirementSpec
that no ProblemSpec references. `contractSatisfied` was `true`. FORMAL
delivery returned **PASS**. Choosing not to declare requirements was
indistinguishable from declaring them.

**Fix, two parts.**

1. `validateProblemContract` now requires each ProblemSpec's
   `requirement_refs` to include at least one RequirementSpec of type
   `REQUIRED_OUTPUT`, emitting the pre-declared-but-never-fired
   `missing_required_output_requirement` failure.
2. The contract summary binds its own pieces: `requiredOutputRequirements`
   lists only REQUIRED_OUTPUT specs some ProblemSpec actually references, and
   `problemSpecs` lists only ProblemSpecs that declare one. A stray
   requirement no longer buys anything.

Both FAST and FORMAL are covered — the bypass was not mode-specific.

---

## RT-A-02 — HIGH — the size budget was bypassable by choosing the ingress path

**Attack.** `MAX_IR_JSON_CHARS` (1 MiB) is enforced *inside*
`parseStrictJson`, so it only ever guarded the text path. A value handed to
`put()` as a live object went straight to `scanIrValue`, which bounded depth
but not size.

**Exploit.** 120 000 `requirement_refs` ≈ 1.3 MB of JSON:

- via `ingestJson` → refused, `input_too_large`
- via `put` → **accepted**

Same payload, two verdicts, decided by which door it came through. That is
the fail-open-by-inconsistency this module was written to prevent (RT2-03 /
RT3-05), one dimension over: those cared about shape, this about size.

**Fix.** `scanIrValue` now walks under a shared node budget
(`MAX_IR_VALUE_NODES = 100_000`) and returns a new `too_large` verdict. One
budget covering both breadth and depth, so a wide array and a deep tree cost
the same and neither escapes the other's cap.

---

## Probed, found already closed

**Prototype pollution.** A `__proto__` key in an ingest payload is refused
with `malformed_value` / `forbidden_key`, and `Object.prototype` is
unmodified afterwards.

**Non-finite numbers.** The concern was that `z.number()` accepts `NaN` and
±Infinity — a parameter value of `NaN` would poison every downstream
computation silently, with the symbol bound, the role correct and the
contract satisfied. Zod's number schema already rejects all three. Tests
retained as guard coverage.

**Type confusion on the closed enums.** `role: 'RAW_PROBLEM '` (trailing
space), `role: 'raw_problem'`, `role: 0`, uppercase-hex `content_hash`, and a
trailing-space `content_hash` are all refused at the schema layer.

---

## RT-B-02 — MEDIUM — accepted by design

`IR_REF_FIELDS.ProblemSpec` is empty, so the store admits a ProblemSpec whose
`raw_problem_ref` and `requirement_refs` name nothing; only the bridge
resolves them.

This was left alone deliberately. Declaring them in the table would make the
store refuse those objects before the contract guards ever ran, which means
C-002, C-003 and C-005 would pass because the *store* blocked them and the
contract guard would become untestable — PHASE 7 mutation of the requirement
kind check would have nothing to kill. The bridge is the choke point and
fails closed, so this is defence in depth, not an escape. Recorded in
`known-risks.md` with the reasoning.

---

## A regression this phase uncovered on the way in

The red team could not run at all at first: `tests/ir/` was failing 50 of 173
tests. PHASE 1 had rewritten `fixtures.ts` with `SymbolSpec` placed *before*
`ProblemSpec` in `validChain()`, so `SymbolSpec.scope_ref` could never
resolve, and every suite that seeded from the chain inherited the breakage.
PHASE 2–5 had only exercised the fault corpus, which builds its own chains and
stayed green, so nothing caught it.

Fixed by ordering ProblemSpec before SymbolSpec, and by replacing the
`validChain().slice(0, 3)` literals — which silently changed meaning when
four kinds were inserted ahead of ProblemSpec — with `chainThrough(kind)`,
which names the endpoint instead of the index. Hardcoded `ir.size` assertions
in four suites were likewise re-derived from the chain.
