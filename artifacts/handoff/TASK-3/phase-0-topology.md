# TASK 3 — PHASE 0 Topology Reconnaissance (zero-edit)

> Task book v1.0 ratified (`8d3158abe2`). This document records the
> producer/consumer facts that pin the implementation, the baseline, and
> the two conformance findings (F-1, F-2) discovered before any
> production edit. No production code was touched in this phase.

## 1. Baseline (frozen)

- HEAD `8d3158abe2` (task book commit), working tree clean.
- paper-foundation: **63 files / 775 tests PASS**, tsc clean.
- Prior corpora: 1.5R 18/18, TASK-2 D-corpus 20/20; mutations 16/16 + 8/8 killed.

## 2. RunArtifact producer/consumer map (the object TASK 3 attaches to)

| Field | Producer | Consumers today | TASK 3 impact |
|-------|----------|-----------------|---------------|
| `run_id` | fixtures only (no real producer) | refs closure (`Result.run_ref`), provenance reachability | ExecutionRecord.run_ref closes here |
| `code_ref` | fixtures | none (external locator, TASK 3 now loads bytes) | capture/replay `loadCode` seam |
| `code_hash` | fixtures | none verified | capture re-derives from bytes; record must equal |
| `input_data_refs` | fixtures | problem-contract INPUT_DATA role guard | record set-equality |
| `environment` / `seed` | fixtures | TASK 2.1 declared fingerprints | record fingerprints must equal |
| `output_refs` | fixtures | none (external) | output bytes hash + replay re-derivation |
| `exit_status` | fixtures (declared) | none | INV-3-D: must be 0 on critical chain, producer-generated |
| `stdout_ref` / `stderr_ref` | fixtures | none | stdout/stderr BYTES hashes captured; locators stay external |

**No real producer exists** — same finding as TASK 2 PHASE 0. TASK 3's
`src/execution/capture.ts` becomes the first real producer path (runner
seam), which is exactly the wiring the task book un-froze.

## 3. Delivery-path reconnaissance (gate wiring point)

- `WorkflowExecutor.enforceCanonicalIr()` (ir_canonicalization) runs
  **before** review verdict + `authorizeDelivery` (TASK 1.25, RT125B-02).
- TASK 3 inserts `enforceExecutionProvenance()` immediately after it,
  before `authorizeDelivery`; gates list grows to
  `['review', ir_canonicalization, provenance]`.
- `requiresIrBackbone(mode)` (case-insensitive, EXPLORATORY exempt) is
  reused for the provenance gate's mode rule — one mode vocabulary
  helper, no second implementation (D8).
- Gate id `'provenance'` is already present in `CRITICAL_GATE_IDS`
  (delivery-policy.ts:50) — zero list edits; only a named constant is
  exported.

## 4. Enumeration points that PHASE 1 must keep green

1. `tests/ir/redteam.spec.ts` RT4-01 — per-kind `IR_REF_FIELDS` map is
   hardcoded → add `ExecutionRecord: ['run_ref', 'input_data_refs']`.
2. `tests/ir/redteam.spec.ts` "omits every external locator" — lists
   `input_refs` / `output_refs` as external names → record field naming
   must avoid `input_refs` (see F-1).
3. `tests/ir/schema.spec.ts` — iterates `IR_KINDS` requiring
   `validObjectFor(kind)` + `validChain()` parse → fixtures must cover
   the new kind.
4. `tests/ir/fixtures.ts` `chainThrough(kind)` uses `lastIndexOf` →
   appending ExecutionRecord at the **end** of `validChain()` keeps
   every existing `chainThrough('RunArtifact'|'Result'|…)` prefix
   byte-stable, while `backboneIr()` (used by all executor-level tests)
   gains the record — which is what makes the new provenance gate pass
   on the happy path without touching those tests.
5. `evaluateIrBridge` is NOT modified — the 1.5R / TASK-2 fault corpora
   and bridge suites stay byte-identical. The provenance gate is a
   separate critical gate consumed by the executor (D8).

## 5. Conformance findings (PHASE 0)

- **F-1 (naming)**: task book D2 field `input_refs` is renamed to
  `input_data_refs`. The existing external-locator vocabulary test
  reserves `input_refs` as an external name; RunArtifact already set the
  `input_data_refs` precedent for store-closed DataArtifact arrays.
  Semantics identical (→ DataArtifact, set-equal to the run's); no
  boundary change. Recorded here per the freeze discipline instead of a
  silent v1.1.
- **F-2 (time inversion)**: EX-09 (finished_at < started_at) is
  enforced at the **schema** layer (earliest possible fail-closed), not
  only in the audit; the audit keeps no duplicate check. Stronger than
  the task book's minimum; recorded for the audit trail.

## 6. Proposed schema delta (goes live in PHASE 1)

Exactly task book D2 with the F-1 rename:

```ts
ExecutionRecord {
  execution_id, run_ref → RunArtifact,
  code_hash sha256:<hex>,                      // == RunArtifact.code_hash
  environment_hash <64hex>,                    // == 2.1 declared fingerprint
  runtime_fingerprint_hash <64hex>,            // runner-measured facts
  dependency_lock_hash <64hex>,                // == 2.1 declared fingerprint
  input_data_refs → DataArtifact[],            // set-equal to run's
  output_refs external[],                      // set-equal to run's
  output_hash <64hex>, stdout_hash, stderr_hash,
  exit_status int, seed int|string|null,
  started_at ISO, finished_at ISO              // finished > started (schema refine)
}
```

`IR_REF_FIELDS.ExecutionRecord = [run_ref → RunArtifact, input_data_refs → DataArtifact]`;
`output_refs` stays external (D6).

**PHASE 0 Gate: PASSED** — recon + delta recorded; PHASE 1 may start.
