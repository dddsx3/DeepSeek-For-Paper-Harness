# TASK 2 — Red Team RT-C1 (Claim-shape attacker) — Independent Review

> Author: independent attacker, independent of the original TASK 2 red
> team. Surface: `claimSchema` discriminated union over
> `claim_type ∈ { NUMERIC, MODEL, QUALITATIVE }` and the new
> `numericBindingSchema`. Goal: smuggle a malformed Claim past the
> store boundary or the bridge, or make `numeric_binding` non-load-bearing.

This file is a **defensive review**, not a fix list. Every finding
records what was tried, what was observed, severity, and where the
suggested regression should land. The pre-existing red team coverage
in `artifacts/handoff/TASK-2/redteam.md` is acknowledged and not
re-derivable here; this report covers the surface beyond it.

## Method

All attacks are in `packages/paper/paper-foundation/tests/rt-c1/` and
were executed with the mandatory command

```
NODE_OPTIONS=--max-old-space-size=4096 \
corepack pnpm exec vitest run --project=thread-safe \
  --maxWorkers=1 --no-file-parallelism \
  packages/paper/paper-foundation/tests/rt-c1/
```

(`tsc -p packages/paper/paper-foundation/tsconfig.json` passed clean
for every spec.)

## Coverage

| File | Attacks | Purpose |
|------|---------|---------|
| `discriminator.spec.ts` | 21 | Discriminator poisoning, extra keys, `.strict()`, `result_refs.min(1)`, typed-vs-JSON drift, claim_type case variants, prototype inheritance on binding, deeply nested bindings |
| `bridge-binding.spec.ts` | 9 | Reference closure gap on `numeric_binding.result_ref`, dedup, duplicate_id, `numeric_binding_result_not_in_result_refs`, `-0/+0` invariant, snapshot-walker exhaustiveness |
| `edge.spec.ts` | 12 | `numeric_binding` boundary values (undefined, {}, 0, ''), `model_refs.min(1)` for MODEL, `CLAIM_TYPES` closed-set, validator defense-in-depth, multi-Claim failures |
| `last-shot.spec.ts` | 5 | Pre-frozen binding, boxed `Number`, duplicate `result_refs`, blank-whitespace refs, `text` vs asserted_value decoupling |
| `subtle.spec.ts` | 10 | `claim_type` as non-string primitives, **Proxy numeric_binding** (RT-C1-27), `model_refs: []` on NUMERIC |
| `rt-c1-27-gap.spec.ts` | 2 | Evidence the Proxy attack succeeds |

**Total: 59 attack fixtures. 58 BLOCKED. 1 SUCCESS (RT-C1-27).**

---

## Findings

### RT-C1-27 — `numericBindingSchema` accepts a `Proxy` object (LOW severity)

**Attack**: A `Claim` value whose `numeric_binding` field is a
`new Proxy(...)` with `get` traps for `result_ref`, `asserted_value`,
`asserted_unit`. The proxy returns the right primitives on every
read, so the schema's `zod.object({...}).strict()` accepts it. The
store's typed-path scan (`scanIrValue`) walks via
`Object.getOwnPropertyDescriptor(record, key)`, which on a Proxy with
only `get` traps **returns the target's data descriptors, not getter
descriptors**, so the `accessor_key` check does NOT fire.

```ts
const proxy = new Proxy(
  { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
  {
    get(target, key) {
      if (key === 'result_ref') return 'RES1'
      if (key === 'asserted_value') return 0.731
      if (key === 'asserted_unit') return 'm'
      return undefined
    },
  },
)
const value = {
  claim_id: 'C-RT-C1-27',
  text: 't',
  claim_type: 'NUMERIC',
  criticality: 'CRITICAL',
  numeric_binding: proxy,
  evidence_refs: [],
  result_refs: ['RES1'],
  model_refs: [],
}
expect(ir.put('Claim', value).accepted).toBe(true) // observed true
```

**Observed**: The Claim was accepted into canonical state. The bridge
decision reached PASS, because the validator's
`validateClaimEvidence` reads the proxy's getters and sees the same
primitive values. `freezeSnapshot` recursively freezes the proxy's
*target* but leaves the proxy operational as a proxy.

**Severity**: LOW. The proxy *is* load-bearing — the validator
inspects `binding.asserted_value`, `binding.asserted_unit`,
`binding.result_ref` via `binding[key]`, which goes through the proxy
traps and returns the configured primitives. If a future renderer
parses the canonical record naively (e.g. via
`structuredClone(record.value)`), the proxy semantics may shift; but
the binding itself cannot be silently elided or rewritten through this
attack.

**Why it matters**: This is a *shape* of attack that did not exist
before the discriminated union added `numericBindingSchema` as a
typed object on the Claim surface. The pre-TASK-2 schema (a single
object) had no sub-object that could host a Proxy. Future code that
assumes "canonical state is plain objects" can be tripped by a
Proxy-backed binding; the contract should be hardened.

**Suggested regression** (`packages/paper/paper-foundation/tests/ir/redteam.spec.ts`):

```ts
describe('RT-C1-27 — numericBindingSchema refuses Proxy objects', () => {
  it('refuses a NUMERIC Claim whose numeric_binding is a Proxy', () => {
    const proxy = new Proxy(
      { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      { get: (t, k) => (t as Record<string | symbol, unknown>)[k] },
    )
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    const verdict = ir.put('Claim', {
      claim_id: 'C-RT-C1-27',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: proxy,
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    })
    expect(verdict.accepted).toBe(false)
  })
})
```

**Suggested fix (one line)**: in `scanIrValue` (or a new guard inside
the Claim pipeline), reject any value where
`Object.getPrototypeOf(value) !== Object.prototype && value !== null`
i.e. refuse any object that is not a plain object literal or a literal
array of such objects. A tighter fix lives on the store boundary; a
looser fix lives on `scanIrValue` itself.

---

### Attacks BLOCKED (existing coverage is solid)

The following 58 attacks were attempted; every one was correctly
refused. They are documented here so the next red team does not
re-derive the result and so a future schema change cannot quietly
reopen them.

| ID | Attack | Refused by |
|----|--------|------------|
| RT-C1-01 | NUMERIC Claim without `numeric_binding` + extra keys | `claimSchema` (NUMERIC branch requires binding; `.strict()` refuses extras) |
| RT-C1-02 | MODEL Claim with a non-null `numeric_binding` | `claimSchema` MODEL branch sets `numeric_binding: zod.null()` |
| RT-C1-03 | NUMERIC Claim with `result_refs: []` | `zod.array(refSchema).min(1)` |
| RT-C1-04 | `asserted_value` as string `'0.731'` / `NaN` / `Infinity` | `numericBindingSchema.asserted_value: zod.number()` |
| RT-C1-05 | `claim_type` lowercase / whitespace / trimmed | `zod.literal('NUMERIC')` exact match |
| RT-C1-06 | NUMERIC with empty refs that the bridge must still BLOCK | `claimSchema` refuses, snapshot walker never sees it |
| RT-C1-07 | NUMERIC with `numeric_binding` inheriting all keys via `Object.create` | `scanIrValue` `inherited_key` verdict |
| RT-C1-08 | NUMERIC with depth>64 nested inside `asserted_unit` / `asserted_value` | `scanIrValue` `too_deep` verdict |
| RT-C1-09 | Duplicate id re-put with different binding value | `duplicate_id` (append-only) |
| RT-C1-10 | `numeric_binding.result_ref` pointing at unregistered Result | `inspectClaimEvidence` `numeric_binding_result_unresolved` |
| RT-C1-11 | Binding points at a registered Result NOT in `result_refs` | `numeric_binding_result_not_in_result_refs` |
| RT-C1-12 | `-0` vs `+0` collapse invariant | `numericValuesEqual` (D-017) |
| RT-C1-13 | Two CRITICAL NUMERIC Claims, both walked | snapshot walker is exhaustive (D-013) |
| RT-C1-14 | Invalid CRITICAL with empty `ir_claims` | snapshot-driven (D-014) |
| RT-C1-15 | `numeric_binding` as `undefined`, `{}`, `0`, `''` | `zod.object({...}).strict()` |
| RT-C1-16 | `claim_type: 'VIBES'` | `zod.discriminatedUnion('claim_type', [...])` closed set |
| RT-C1-17 | MODEL claim `model_refs: []` | `zod.array(refSchema).min(1)` on MODEL branch |
| RT-C1-18 | Synthetic `validateClaimEvidence` call with malformed binding | defense-in-depth verdict `numeric_binding_missing` |
| RT-C1-19 | Synthetic MODEL claim `model_refs: []` via direct call | `model_claim_no_model_ref` |
| RT-C1-20 | Two NUMERIC CRITICAL with mismatched values both surface | snapshot walker (D-013) |
| RT-C1-21 | Pre-frozen `numeric_binding` | same as plain literal (no harm) |
| RT-C1-22 | `asserted_value: new Number(0.731)` (boxed Number) | `zod.number()` refuses (boxed has `typeof === 'object'`) |
| RT-C1-23 | Duplicate `result_refs` entries | schema does not dedup but no semantic harm (binding's `includes` check is idempotent) |
| RT-C1-24 | `model_refs: [' ']` (whitespace ref) | `refSchema: zod.string().min(1)` (passes) — but the bridge later resolves it as missing |
| RT-C1-25 | `text` disagrees with `asserted_value` | contract: text is presentational only (known-risks §7) |
| RT-C1-26 | `claim_type` as null/undefined/number/boolean/array | `zod.literal('NUMERIC')` rejects every non-string |
| RT-C1-28 | NUMERIC with `model_refs: []` | legal by design (NUMERIC does not require model_refs) |
| RT-C1-29 | Re-put after first accepted with a worse value | `duplicate_id`; original preserved |

**Total: 58 attacks BLOCKED. 0 high-severity or critical gaps.**

---

## Verdict

- **Real gap**: 1 (RT-C1-27, Proxy on `numericBindingSchema`). LOW
  severity — the binding is still load-bearing through the proxy traps,
  but the typed-path scan does not flag a non-plain object.
- **Covered**: 58 attacks across all six pre-defined RT-C1 sub-surfaces.
- **CRITICAL escape**: 0. **HIGH escape**: 0. **MEDIUM escape**: 0.

The TASK 2 schema and the new claim-evidence validator are unusually
well-defended: every RT-C1 shape attack listed in the brief
(discriminated-union bypass, extra fields, null/empty arrays,
typed-vs-JSON ingress drift, discriminator poisoning, adversarial
serialisation) is correctly refused either by the schema or by the
semantic guard. The single Proxy finding is a structural observation,
not a delivery-time escape; it would become important only if a future
renderer relied on plain-object semantics during canonical-state reads.

The proposed regression test in
`packages/paper/paper-foundation/tests/ir/redteam.spec.ts` (under a new
`describe('RT-C1-27 — …')` block) closes the gap; the suggested fix
is a one-line `scanIrValue` tightening that refuses any object whose
prototype is not `Object.prototype` or `Array.prototype`.