# TASK 1 — Minimal Modeling IR

## 1. Escape Path closed by this TASK

The escape path closed here is **"whatever the model emits is the state the
workflow reasons about"**. Before TASK 1 there was no object a verifier could
point at: a `Result` was a sentence in a paper, a `Run` was a line of stdout,
and "the claim matches the number" was a judgement call made in prose. Every
downstream gate — provenance, staleness, numeric consistency, coverage — needs
a stable object to refer to, and without one the only possible enforcement is
a prompt asking the model to be careful.

TASK 1 replaces that with one closed ingress path:

```
model text
  ↓ parseStrictJson          (strict JSON, size-capped, no repair, prototype-safe)
  ↓ scanIrValue              (structural scan: depth, forbidden/inherited/symbol/accessor keys)
  ↓ IR_SCHEMAS[kind].parse   (closed zod schema, no extra keys)
  ↓ validateRefFields        (every declared ref must resolve, kind-checked)
  ↓ global id uniqueness     (one index across all kinds)
  ↓ ModelingIr.put           (the only mutation entry point; total, never throws)
canonical state (deep-frozen records, append-only, #private store)
```

Everything that fails any stage is refused with a closed failure kind and an
audit event. There is no partial insert, no coercion, and no second-chance
path: the model may be asked to **regenerate** and the new text re-enters at
the top, but the rejected text itself can never become canonical state.

The ten attack scenarios (IR-001..IR-010) from task book §7 are all closed:

- IR-001 invalid JSON → `parse_failed` at the parser, before any schema runs.
- IR-002 duplicate id → `duplicate_id`, within a kind **and** across kinds.
- IR-003 nonexistent `result_ref` → `unresolved_reference`.
- IR-004 nonexistent `run_ref` → `unresolved_reference`.
- IR-005 nonexistent `model_ref` / `problem_refs` → `unresolved_reference`.
- IR-006 Claim without `criticality` → `schema_invalid` at path `criticality`.
- IR-007 Figure `data_ref` that does not exist → `unresolved_reference`.
- IR-008 Result without `unit` → `schema_invalid` at path `unit`.
- IR-009 Run without `exit_status` → `schema_invalid` at path `exit_status`.
- IR-010 malformed reviewer finding → `parse_failed` or `schema_invalid`.
  `ReviewerFinding` is a first-class IR kind precisely so that "malformed" is
  a *refusal* rather than an absorbed blob.

## 2. Red-team round (mandatory, ≥3 agents, real environment)

Per the working protocol, four independent sub-agents attacked the running
implementation in the real repo (adversarial scripts executed, then removed;
`src/ir/**` verified byte-identical to a pristine backup afterwards). Their
findings and the minimal fixes are below. Every exploit below was **executed
and demonstrated before fixing**; every fix ships with regression tests in
`tests/ir/redteam.spec.ts` (12 new tests) plus tightened suites elsewhere.

| Finding | Severity | Exploit (executed) | Fix |
|---|---|---|---|
| RT1-01 / RT2-01 | MAJOR → BLOCKER | Record envelope (`{kind,id,seq,...}`) was not frozen, so `record.kind` could be rewritten to spoof the next ingest's reference-kind check. TypeScript `private` erased at runtime, leaving the backing `Map` writable: arbitrary injection/deletion of canonical state. | ECMAScript `#private` fields (`#objects`/`#seq`/`#audit`/`#now`); the record is `Object.freeze`d as a whole. |
| RT2-02 / RT3-01 | MAJOR → BLOCKER | `IR_REF_FIELDS`, `IR_SCHEMAS`, `IR_KINDS`, `ID_FIELD_BY_KIND` were mutable module singletons read live by `put()`: one assignment (`IR_REF_FIELDS.Result = []`) made every store accept dangling refs. | `deepFreeze` (cycle-safe) applied to every policy table at module scope; frozen-ness asserted by tests. |
| RT3-02 | MAJOR | `ModelingIr.prototype.put` reassignment hijacked every instance. | `Object.freeze(ModelingIr)` and `Object.freeze(ModelingIr.prototype)` at module scope. |
| RT3-03 | MAJOR | zod's `.strict()` walks the prototype chain both ways: one polluted `Object.prototype` key DoS'd every ingest, and an object *inheriting* all required fields passed a fully-required schema while being `{}`. | `scanIrValue` rejects inherited enumerable keys (`inherited_key`), own symbol keys (`symbol_key`), and accessor properties (`accessor_key`) on both ingress paths. |
| RT2-03 / RT3-05 | MAJOR | `put()` skipped the forbidden-key scan that `ingestJson()` ran: identical bytes, opposite verdicts. | `scanIrValue` runs inside `put()`, so both doors apply the same rules. |
| RT1-02 | MAJOR | `JSON.parse` ran before the depth cap, so an 8 MB payload killed the process (V8 heap exhaustion) instead of being refused. | `MAX_IR_JSON_CHARS = 1 MiB` enforced *before* parsing (`input_too_large`). |
| RT1-03 / RT2-06 | MINOR → MAJOR | `put()` threw instead of refusing when `audit`/`now` threw or a hostile kind's `toString` ran; the accept path committed before auditing. | `put()` is total (blanket refusal on `internal_error`); accept-path audit fires **before** commit; kind rendering never calls user code; refusal audits are best-effort. |
| RT2-04 | MAJOR | A `CRITICAL` claim with zero references passed — "all references resolve" was vacuously true. | `claimSchema` refine: a `CRITICAL` claim must reference ≥1 of evidence/result/model refs (TASK 2 narrows per claim type). |
| RT1-04 | MINOR | Ids accepted `\u0000`, lone surrogates, zero-width chars; `"café"` and `"cafe\u0301"` were distinct ids that any normalising consumer reads as one. | `idSchema`: excludes control/format/surrogate/separator code points, must be NFC-normalised. |
| RT2-07 | MINOR | Every blocked audit event reported `id: null`, so repeated bad emissions couldn't be correlated. | Best-effort `id` extraction for schema-level and unknown-kind refusals. |
| RT1-05 | MINOR | Single prose fields could be megabytes. | `textSchema` capped at 65 536 chars. |
| RT4-05 | MEDIUM | The fault-corpus runner had zero `expect()` calls: a green run said nothing. | Runner now asserts every fixture was exercised and every verdict is `BLOCKED`. |
| RT4-01 | MEDIUM | The ref-table completeness test only checked three literal strings were absent — it stayed green when a real ref field was deleted. | Dedicated test asserts the table contains exactly the reference fields the schemas define, per kind. |

A fourth red-team agent ran 17 mutations (each guard removed one at a time,
suite re-run, then restored): **17 / 17 mutations were killed** — the suite
cannot lose a guard without failing. That agent's verdict was `NO ESCAPE
FOUND` after the fixes were applied to its own surface.

## 3. New invariants established

| ID | Invariant | Enforced at |
|----|-----------|-------------|
| INV-IR-01 | An IR object exists in canonical state only if it passed JSON parse, structural scan, schema validation, reference resolution, and global id uniqueness. | `store.ts` `put()`; no other mutation path exists. |
| INV-IR-02 | All ids are globally unique across every kind. | `store.ts` one `Map` indexed by id. |
| INV-IR-03 | Every declared IR reference resolves **at ingest time**, to an object of the declared kind. | `refs.ts` `IR_REF_FIELDS` + `validateRefFields`. |
| INV-IR-04 | Unrecognised keys are rejected, never ignored. | every schema is `.strict()`. |
| INV-IR-05 | Canonical state is immutable: deep-frozen snapshots inside frozen records. | `store.ts` `freezeSnapshot` + `Object.freeze(record)`. |
| INV-IR-06 | Canonical state is append-only and unreachable from outside. | `#private` fields; no delete/replace/update method. |
| INV-IR-07 | Claim criticality is closed; there is no `UNKNOWN`. | `CLAIM_CRITICALITIES = ['CRITICAL','NON_CRITICAL']`. |
| INV-IR-08 | Verification status is the same closed set as TASK 0's gates. | `verificationResultSchema.status` reuses `GATE_STATUSES`. |
| INV-IR-09 | Acceptance is audited before commit; refusal is always audited (best-effort). | `store.ts` ordering + try/catch in `#refuse`. |
| INV-IR-10 | No repair, coercion, or second-guess entry point exists in the IR surface. | `attack.spec.ts` greps exported names + prototype. |
| INV-IR-11 | Prototype-polluting keys never reach a schema, from either ingress door. | `scanIrValue` (called by `parseStrictJson` consumers and by `put()`). |
| INV-IR-12 | Ingest is total: `put()` never throws; injected-dependency faults are `internal_error` refusals. | `put()` try/catch + safe kind/error rendering. |
| INV-IR-13 | The policy tables are frozen at runtime, not just `readonly` at compile time. | `deepFreeze` at module scope; frozen-ness asserted. |
| INV-IR-14 | A `CRITICAL` claim must reference something; `NON_CRITICAL` may stand alone. | `claimSchema` refine. |
| INV-IR-15 | Ids are charset-bounded and NFC-normalised. | `idSchema` regex + refine. |

## 4. Core modules touched

| File | Change | Description |
|------|--------|-------------|
| `src/ir/schema.ts` | add | Eight closed zod schemas, `IrObjectMap`, `IR_SCHEMAS`, `ID_FIELD_BY_KIND`, `readIrObjectId`, table freezing, id charset/NFC rules, CRITICAL-claim refine. |
| `src/ir/parse.ts` | add | `parseStrictJson` (strict, size-capped, non-repairing, non-throwing) + `scanIrValue` (depth/forbidden/inherited/symbol/accessor scan). |
| `src/ir/refs.ts` | add | `IR_REF_FIELDS` (closed reference table, frozen) + `validateRefFields`. |
| `src/ir/store.ts` | add | `ModelingIr` with `#private` internals, frozen records, total `put()`, closed failure kinds, audit events, class/prototype freezing. |
| `src/ir/freeze.ts` | add | Cycle-safe `deepFreeze` shared by the policy tables. |
| `src/ir/index.ts` | add | Barrel re-export. |
| `src/index.ts` | modify | One line added: `export * from './ir/index.ts'`. |
| `tests/ir/fixtures.ts` | add | Shared legal fixtures: one object per kind + `validChain()` in dependency order. |
| `tests/ir/parse.spec.ts` | add | Parser + scan coverage: every failure reason, size cap, depth cap, forbidden/inherited/symbol/accessor keys, adversarial inputs. |
| `tests/ir/schema.spec.ts` | add | Every kind parses / rejects extra keys; required fields, closed enums, NaN/Infinity, nested-id uniqueness. |
| `tests/ir/refs.spec.ts` | add | Missing / kind-mismatch / ANY targets; external locators stay unresolved; multiple problems reported at once. |
| `tests/ir/store.spec.ts` | add | Ingest order, lookups, immutability, duplicate ids, audit events, default options, refusal leaves state untouched. |
| `tests/ir/attack.spec.ts` | add | IR-001..IR-010 matrix + no-repair / no-update-path invariant greps. |
| `tests/ir/redteam.spec.ts` | add | Regressions for every executed red-team exploit (12 tests). |
| `artifacts/handoff/TASK-1/faults/IR-00{1..10}.json` | add | Ten fault fixtures with `expected_status: BLOCKED`. |
| `artifacts/handoff/TASK-1/run-fault-corpus.mjs` | add | In-process runner that exercises each fixture and **asserts** every verdict is BLOCKED and every fixture ran. |

No other module was modified. No export was renamed. No TASK -1 / TASK 0 file
was edited — `delivery-policy.ts` is read-only imported for `GATE_STATUSES`.

## 5. Behaviour now BLOCKED

- Any model output that is not strictly valid JSON, or exceeds 1 MiB of text.
- Any value with an unrecognised key, missing required field, out-of-enum
  value, inherited enumerable key, own symbol key, accessor property, or
  graph deeper than 64 levels — on **either** ingress door.
- Any object whose id is already registered — by any kind.
- Any object referencing an unregistered id, or an id registered as the wrong
  kind. Registering the target afterwards does **not** retroactively admit the
  rejected object.
- NaN / ±Infinity result values; non-finite parameter values.
- Ids containing control/format/surrogate/separator code points or non-NFC
  text; prose fields longer than 65 536 chars.
- A `CRITICAL` claim with no references at all.
- Any attempt to update, replace, or delete canonical state; any write to the
  policy tables; any prototype hijack of `ModelingIr`.
- A reviewer that answers with prose, with a verdict-shaped object
  (`paper_passed`), or with an out-of-taxonomy `attack_type` / `severity`.
- Any input that makes the audit sink, the clock, or a hostile `toString`
  throw — the ingest is refused with `internal_error`, never left half-done.

## 6. Behaviour still allowed

- Asking the model to **regenerate** and re-submitting the new text through
  `ingestJson`. That is a new input, not a repair.
- Empty reference arrays on non-critical claims and on evidence fields
  (`VerificationResult.evidence_refs: []`).
- `objective: null` and `seed: null` — explicit statements, not omissions;
  TASK 3's reproducibility gate owns the `seed: null` policy.
- `ANY`-targeted evidence references pointing at any registered kind.
- Reading canonical state freely (`get`, `has`, `kindOf`, `list`, `size`).

## 7. Gate

| Check | Result |
|---|---|
| `packages/paper` suite | 43 files, **420 passed / 420** (302 baseline, +118 new) |
| Per-file coverage of `src/ir/{parse,refs,schema,store,freeze}.ts` | **100%** statements / branches / functions / lines |
| Fault corpus IR-001..IR-010 | **10 / 10 blocked**, `escape_rate = 0`, runner asserts each verdict |
| Red team round 1 (4 agents, real execution) | 16 findings → all fixed or deferred with an owner TASK; mutation suite 17/17 kills |
| `critical_failures` | none |
