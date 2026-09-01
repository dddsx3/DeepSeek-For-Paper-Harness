# TASK 3 — Invariants

## INV-3-A — Every critical-chain run carries a consistent ExecutionRecord

A `run_ref`-closed record must exist for every RunArtifact reachable
from a CRITICAL Claim (`Claim → result_refs → Result → run_ref`), and it
must agree with the run: `code_hash`, declared environment and
dependency-lock fingerprints, `input_data_refs` / `output_refs`
set-equality, and `seed`.

**Closed by**: `auditExecutionProvenance` (src/execution/audit.ts) +
`IR_REF_FIELDS.ExecutionRecord` (src/ir/refs.ts).
**Proven by**: `tests/execution/provenance-gate.spec.ts` (backbone PASS,
EX-02/EX-11 BLOCKED, EX-07 seed drift, P-01/P-04 anchors),
`tests/ir/execution-record.spec.ts` (store closure).
**Mutations**: P-01, P-04, P-07, P-08 — all killed.

## INV-3-B — Execution fields are producer-generated; forgery is re-derived away

`exit_status`, the stream digests and the output bytes hash exist only
via the capture seam (`captureExecution` over `ExecutionRunner`); no
public path writes them by hand. A schema-valid forged record that
passes the structural gate is refused by the replay, which re-derives
every digest from a fresh execution.

**Closed by**: `src/execution/capture.ts` (single producer) +
`replayExecution` (re-derivation).
**Proven by**: RT-X1-01 (structural boundary, documented) → RT-X1-02/03
(replay refusal); EX-05.
**Mutations**: P-02, P-03 — killed.

## INV-3-C — Replay determinism contract

Same code bytes + same declared fingerprints + same measured runtime
facts + same inputs + same seed ⇒ same exit status (0), same
stdout/stderr/output bytes hashes, and every Result re-derives its
declared value from the replayed output document exactly (D7, no
tolerance).

**Closed by**: `replayExecution`'s eight conditions.
**Proven by**: capture-replay PASS cases (deterministic fake + REAL
node process), EX-06 divergence, EX-06b byte-only divergence, EX-01
value mismatch.
**Mutations**: P-02, P-05 — killed.

## INV-3-D — Critical chains demand exit 0 and a recorded seed

On a FORMAL/FAST critical chain, a record with `exit_status !== 0` or
`seed === null` cannot deliver.

**Closed by**: structural audit + schema (int-typed exit, ISO times,
`finished_at > started_at` at the earliest boundary — PHASE 0 finding
F-2).
**Proven by**: provenance-gate INV-3-D test, P-03 anchor, EX-09.
**Mutations**: P-03 — killed.

## INV-3-E — Closed taxonomy, fail-closed verdict

`CODE_MISMATCH / ENVIRONMENT_MISMATCH / OUTPUT_MISMATCH / NON_ZERO_EXIT
/ MISSING_EXECUTION` × `CRITICAL / HIGH / MEDIUM`; `status = FAIL` iff
any failure has `severity !== 'MEDIUM'`. The auditor is total: a crashed
replay becomes `MISSING_EXECUTION` (CRITICAL), never a PASS.

**Closed by**: `EXECUTION_AUDIT_CATEGORIES` / `EXECUTION_AUDIT_SEVERITIES`.
**Proven by**: RT-X2-03 (hostile runner → FAIL, not throw), EX-02/08/09.
**Mutations**: P-06 (manifest integrity) — killed.

## INV-3-F — Producer ≠ Auditor

Capture and audit share no mutable state; the auditor re-derives every
digest it compares and anchors the execution manifest out-of-band
(`manifest_hash`, the TASK 2.1 trust pattern). A self-consistent
manifest fabricated from forged records carries a different hash and is
refused before any per-run verdict.

**Closed by**: module separation + `buildExecutionManifest` integrity
check + `runIndependentExecutionAudit`.
**Proven by**: RT-X1-02/03, manifest-tamper test, RT-X2-03.
**Mutations**: P-05, P-06 — killed.

## INV-3-G — Exhaustive, unmaskable delivery gate

The `provenance` gate (already-reserved critical id, D8) walks the
canonical snapshot: one valid run never masks an invalid one; the
`ir_claims` artifact subset is irrelevant. EXPLORATORY is exempt from
the gate, never from schema/store closure. The canonical-IR gate runs
first, so the gate's vacuous-PASS-on-empty is unreachable for
backbone-less stores.

**Closed by**: `criticalChainRunIds` walk + `evaluateProvenanceGate` +
executor wiring (`enforceExecutionProvenance` before `authorizeDelivery`,
gates list `['review', ir_canonicalization, provenance]`).
**Proven by**: EX-02/EX-11 E2E refusals (`/no execution provenance/`),
backbone happy path, RT-X3-02 (wrong-run record), RT-X4-01 mode rules.

## INV-3-H — No repair, no fallback, anywhere

Capture refuses on contradiction (code bytes ≠ declared hash, output set
≠ declared refs); replay refuses on drift; the gate refuses on absence.
No coercion, no tolerance, no best-effort path exists in the layer.

**Closed by**: `captureExecution` failure verdicts + replay checks +
gate; the store boundary above them.
**Proven by**: capture refusal tests, EX-03/06/06b, RT-X1-04 (canonical
state untouched on refusal).

## Inheritance

TASK 1.5R / TASK 2 / TASK 2.1 invariants and suites are untouched and
green: the execution layer is additive (one new kind, one new module
tree, one new critical gate), and the full regression (68 files /
838 tests) keeps every prior suite passing.
