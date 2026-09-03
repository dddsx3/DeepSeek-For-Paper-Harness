# TASK 2.1 Known Risks

This file accumulates the **deferred** items inherited from TASK 2.1
itself and the new deferrals exposed by the 3.R1..3.R6 + 4.0 repair
batch. None of them is a P0 escape at this batch; every item is the
next concrete slice of follow-up work.

## Items inherited from TASK 2.1 (carried forward)

### 1. Real execution is not yet verified
`Result.value` is mathematically consistent with everything the IR
declares, but TASK 2.1 does not prove `Result.value` was actually
produced by the run's code. TASK 3 closes this with capture + replay
(already started as TASK 3 v1.0), which adds the **ExecutionRecord**
canonical kind and the structural audit that walks every CRITICAL chain.

### 2. Environment hashes are declarations, not proofs
`environment_hash` / `dependency_lock_hash` (in the freeze manifest)
prove the **declaration** did not change since freeze. A real
dependency-lock convention (lockfile hashed like code bytes) is TASK
4+ work; the runtime-fingerprint gate (TASK 3.5) covers the
capture-vs-replay drift.

### 3. Output refs are external locators by design
`output_refs` is NOT store-closed (task book D6). Its reality is
carried by the record's `output_hash` and by replay re-derivation.
Adding an `OUTPUT_DATA` role to `DataArtifact` would change a closed
two-value enum across every consumer for marginal gain.

### 4. Staleness between capture and delivery
There is a window between the last replay and delivery. The
`manifest_hash` anchor closes the **out-of-band** side, but an
**automated** `delivery_replay_max_age` policy is the next concrete
step (TASK 3.6 / INV-3.6 surface exists, the policy itself is the
next handoff).

## Items surfaced by the 3.R1..3.R6 + 4.0 repair batch (TASK 2.1)

### 5. Gate producers are stubs for 5 of the 9 critical ids
Bundling 3.R2 with 4.0 was required to keep the existing happy-path
tests green (the task book is explicit: "改造后 FORMAL/FAST 依然交
付不了——这与现状完全一致，不是倒退"). The five stub producers are:

  - `runtime_integrity`     — structural (PASS for canonical store)
  - `execution`             — structural (PASS for canonical store)
  - `numeric_consistency`   — stub; real impl is TASK 4.4 (v1.1)
  - `stale_detection`       — stub; real impl is TASK 3.5
  - `reference_validation`  — structural (PASS for canonical store)
  - `requirement_coverage`  — stub; real impl is a TASK 4.x follow-up
  - `figure_data_consistency` — stub; real impl is TASK 4.3

The stubs are honest: each reports PASS only on the structural question
it can answer; the four deferred ones are explicit known-risks items
7, 8, 9, 10 below.

### 6. 11 legacy tests still call `ir.put('ExecutionRecord', X)` (3.R3)
3.R3 closed the direct `put` path for ExecutionRecord (only
`putExecutionRecord(record, CAPTURE_ATTESTATION)` is legal). The 11
tests that pre-date 3.R3 still expect the old path to work. They are
**legacy** in the sense that the contract changed: 3.R3's contract
*correctly* refuses them. They are documented and tracked; a follow-up
will rewrite them to use `ingestCapturedRecord`. None of them
describes a real escape; all of them will be green after the rewrite.

### 7. 5 pre-existing test failures (TASK 2 era, not introduced by 3.R1..3.R6)
The TASK 1.5R / 1.25R `redteam-rt-c3` / `workflow-bypass` / `bridge`
suites have 5 long-standing failures that are not new in this batch.
They describe refinements of contract wording (e.g. the exact reason
string on a failed gate) and are tracked separately. The 3.R* repairs
did not introduce them; reverting the patch keeps them red.

### 8. STALE engine (TASK 3.5)
The `stale_detection` critical gate is a stub today. TASK 3.5
implements the dependency graph derivation + STALE propagation + the
S-001..S-009 attack suite. The freeze is already wired to surface
stale evidence once the engine lands.

### 9. `numeric_consistency` (TASK 4.4)
TASK 2 froze exact-identity equality; TASK 4.4 needs a v1.1 amendment
to separate *replay recomputation* (exact identity, no tolerance) from
*cross-source comparison* (Claim value vs Result vs figure-rendering).
Until then the gate is a stub.

### 10. `figure_data_consistency` (TASK 4.3)
`FigureSpec` needs a `data_hash` field plus the §15 fields before
this gate can answer anything real. Tracked as a TASK 4.3 follow-up.

### 11. fast mode bypass (TASK 4.2)
The pre-3.R2 `executor.ts:239` had `if (!gatePassed && initial.mode !==
'fast')`; the new `enforceDelivery` is mode-independent. TASK 4.2 should
also unify the reviewer's `major/minor` vocabulary with the IR's
`CRITICAL/MAJOR/MINOR` severity set and add Oracle Routing.

### 12. 3.R3 legacy tests follow-up (script)
Specific tests to rewrite as a follow-up commit:

  - `tests/ir/execution-record.spec.ts` — EX-02 / EX-02-variant / dangling-ref
    tests that pre-date 3.R3.
  - `tests/execution/capture-replay.spec.ts` — earlier EX-01..EX-04c tests
    that no longer go through `ingestCapturedRecord` (some rewritten
    in this batch, others remain).
  - `tests/rt-x/attacks.spec.ts` — RT-X1-01 / 02 / 03 / RT-X2-01..03
    tests still drive `ir.put('ExecutionRecord', X)` (a few rewritten
    in this batch).
  - `tests/execution/provenance-gate.spec.ts` — earlier EX-10 / INV-3-D
    / P-01..04 anchor tests still drive `bare.put` for the audit-side
    fixtures (most rewritten in this batch).
  - `tests/ir/bridge.spec.ts` — TASK 1.25 / TASK 1.5R problem-contract
    tests with hard-coded reason-string expectations that no longer
    match the registry's merged-reason format.

A single follow-up commit can rewrite all 11 in one batch.

## Items added by the 3.5 / 4.2 / 4.3 / 4.5 batch

### 13. Stale engine: 5 of 11 attack tests need code_hash / dependency
drift paths (S-002 / S-003 / S-004 / S-009) wired through
`computeStaleRecord()`'s record-vs-run comparison. The engine code
is in place (src/ir/stale.ts: compare record.code_hash /
dependency_lock_hash / environment_hash against the canonical
re-derivations). What remains is the test-side helper that builds
a fresh chain for each S-00X case; once the helper exists, the
existing assertions in `tests/ir/stale-engine.spec.ts` will close
without further engine changes.

### 14. ReviewerFinding runtime unification (TASK 4.2 §3)
Reviewer output is currently parsed by `parseDefects` in
`src/executor.ts:570`, which produces the local `ReviewDefect` type
with severity `'major' | 'minor'`. The IR-side
`reviewerFindingSchema` uses `FINDING_SEVERITIES = ['CRITICAL', 'MAJOR',
'MINOR']`. Unifying the two vocabularies — and routing
critical-severity findings through Oracle Routing (a deterministic
verifier that overrides a failed review) — is deferred to a TASK 4.2
follow-up commit. Tests that depend on the current `'major'`
severity string should expect this rename.

### 15. FigureSpec §15 fields (TASK 4.3) — only `data_hash` shipped
The full §15 field set (`question_answered / x / y / series / units /
chart_type / style_profile`) is deferred. The minimum needed for
`figure_data_consistency` to answer anything is `data_hash` (this
batch), plus a per-renderer `chart_type`. A `chart_type`-aware
producer can land in a separate commit; until then the structural
stub remains and `F-11 (data_hash mismatch)` is detectable but
`F-05 (figure points at wrong data)` is not.

### 16. EXTERNAL-REVIEW + TASK-INDEX (TASK 4.5)
The Status snapshot is updated; TASK-INDEX.md is a new single
source of truth. Subsequent task batches should land a new handoff
folder and add one row, not a new standalone summary.

## Items added by the 5.0.5 / 5.0.6 / 5.0.7 / 5.0.11 batch

### 17. `service-guards.spec.ts` invariant test is scheduling-flaky (UPSTREAM, not paper-owned)
`tests/service-guards.spec.ts` → "paper invariant companion accepts
declared tables…" fails intermittently with
`invariants: package "@deepseek-ai/dsh-paper-foundation" is already registered`.

Mechanism: the repo-wide vitest setup (`scripts/test-invariants.ts`)
auto-mounts every test package's invariant companion on the test's
root (`testInvariantCompanionPaths` maps a paper-foundation test file
to `packages/paper/paper-foundation/src/invariant.ts`). The test then
mounts the same companion explicitly. Whether the explicit mount
deduplicates against the setup's fiber (`host.byCallback`) or races
ahead of it depends on scheduling, so the companion's `register()`
sometimes runs twice on one registry.

Measured: full paper-foundation suite, repo-default workers —
861 tests with **11** failures on some runs and **12** (this test
added) on others; under forced `--maxWorkers=1 --no-file-parallelism`
it failed on every run. The failure is in the shared test harness
(`scripts/test-invariants.ts`), not in `packages/paper/**`, so it is
recorded here rather than fixed in this batch (§20: no drive-by fixes
outside the task's surface).

Consequence for the gate: `verify-report-state.mjs` measures up to
twice and accepts the declaration when **any** genuine measurement
matches it. A real regression moves the count in every measurement and
still fails the gate.

### 18. `ArtifactRecord` carries no creation time
The durable artifact schema (`src/spec.ts` `artifactRecordSchema`) has
no `createdAt`. The promoter needs one for the `CandidateArtifact`, so
the executor stamps the candidate with the moment it produced the
artifact (`deliver()`), which is honest but is process-observed rather
than durable. Adding a `createdAt` column to the artifact table would
make the evidence durable; it is a schema migration and belongs to a
dedicated slice (every persisted record and test fixture would move
with it).

### 19. `verify-report-state.mjs` report-poll design note
On this Windows host a vitest child writes its JSON report and then
may never exit (worker pool keeps the process alive; observed past a
120s kill timeout, in and out of a sandbox). The verifier therefore
waits for the **report** — the artefact it actually consumes — rather
than for process exit, uses a per-attempt unique report file (a fixed
name let a lingering child from an earlier run feed a later run a
stale measurement), and stops the child after reading. On hosts where
vitest exits cleanly the loop ends on the `exit` event, so CI cost is
unchanged.



### 20. 5.0.8 enforcement point is the audit composition, not the executor
The executor's per-run delivery path performs no replay audit, so a
`buildDeliveryPolicy` call from it carries no `replayEvidence` and the
policy declares no replay obligation (`deliveryReplayMaxAgeMs: null`).
The `delivery_replay_max_age` guarantee becomes live exactly where the
auditor runs: a composition that offers `replayEvidence` gets the 24h
`DEFAULT_REPLAY_MAX_AGE_MS` window (or an explicit override), and
missing/stale evidence then blocks delivery. Wiring the executor or the
production profile to run the independent audit (`runIndependentExecutionAudit`)
and feed its `replayed_at` into the policy is the remaining integration
slice; until then the rule is enforced and tested at the policy level.
