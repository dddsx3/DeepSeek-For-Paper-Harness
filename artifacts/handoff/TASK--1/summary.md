# TASK -1 — Production Capability Lockdown

## 1. Escape Path closed by this TASK

Before this TASK the Paper layer was a thin wrapper over the general
Harness's high-freedom capabilities (`shell`, `code runtime`, `web`,
`workflow`, `subagent`, `self-modification`, `context compaction`). A
FORMAL paper workflow could start, look like it had begun, and then
silently degrade to "general agent with paper-flavoured prompts". Two
specific escape paths are now closed:

* **Started but not really safe** — when a critical service
  (`persistence`, `artifact_store`, `audit`, `verifier_registry`,
  `delivery_policy`, `hash_provider`) is absent, OR the production
  configuration is unknown, the harness used to keep running with
  warnings. The `PaperPreflight` check now returns `ok: false` and
  the harness startup path is required to refuse to boot from it. No
  warn-and-continue. (A-001..A-005)
* **Stage can call any general capability** — a stage was free to
  invoke `shell` from `REVIEW`, mutate a `ModelSpec` from `DELIVERY`,
  or call `solver` from `PLAN`. The `CapabilityFirewall` is now a
  code-level gate: every capability request is checked against the
  per-stage whitelist, and `shell`/`web`/`self_modify` are rejected
  by name in every stage. (A-006..A-008)

## 2. New invariants established

The TASK introduces no new global INV-xxx codes (it pre-dates the
INV-xxx convention), but it establishes three local invariants that
are enforced at code level:

* **INV-T1-S1 — No silent fallback in FORMAL preflight.** A missing
  required service or unknown production configuration produces
  `{ ok: false, missing, unknownConfig }`; the function does not
  throw, but it also does not return `ok: true` with a warning.
  Enforced in `runPreflight()` in
  `packages/paper/paper-foundation/src/runtime/preflight.ts`.
* **INV-T1-S2 — `shell`, `web`, and `self_modify` are forbidden in
  every stage.** `FORBIDDEN_CAPABILITIES` is a closed set checked
  before the per-stage whitelist. Enforced in `CapabilityFirewall.check()`
  in `packages/paper/paper-foundation/src/runtime/capability-firewall.ts`.
* **INV-T1-S3 — Every capability check leaves an audit event.**
  Both `allowed: true` and `allowed: false` decisions route through
  `auditSink`. Enforced in `CapabilityFirewall.check()` (one sink
  call per `check()` call, with the same `at` timestamp).

## 3. Core modules touched

* **add** `packages/paper/paper-foundation/src/runtime/profile.ts` —
  defines `PaperRuntimeProfile`, `StagePolicy`, `Capability`,
  `RuntimeMode`, `ServiceRequirement`, plus the three factory
  functions `createFormalProfile()` / `createFastProfile()` /
  `createExploratoryProfile()`. FORMAL is the full default; FAST
  drops the `hash_provider` service; EXPLORATORY relaxes service
  validation. No `shell`/`web`/`self_modify` in any default stage
  whitelist.
* **add** `packages/paper/paper-foundation/src/runtime/preflight.ts` —
  `runPreflight()` checks that every `requiredServices` entry has a
  matching registration in `availableServices`, and that
  `productionConfig` is in `knownProductionConfigs`. Returns a
  structured `PreflightResult` and emits an audit event on failure.
* **add** `packages/paper/paper-foundation/src/runtime/capability-firewall.ts` —
  `CapabilityFirewall` class with a stateless `check()` that returns
  `CapabilityDecision` and emits an `AuditEvent` for every call.
  Decision reasons: `forbidden_capability` for `shell`/`web`/
  `self_modify`; `not_in_whitelist` for capabilities outside the
  per-stage whitelist.
* **add** `packages/paper/paper-foundation/src/runtime/index.ts` —
  barrel exporting the runtime module.
* **modify** `packages/paper/paper-foundation/src/index.ts` —
  one line added: `export * from './runtime/index.ts'`. No other
  changes to existing exports.
* **add** `packages/paper/paper-foundation/tests/runtime/profile.spec.ts` —
  11 tests covering FORMAL/FAST/EXPLORATORY profile shape.
* **add** `packages/paper/paper-foundation/tests/runtime/preflight.spec.ts` —
  10 tests covering A-001..A-005 plus the happy path and aggregate
  missing-count cases.
* **add** `packages/paper/paper-foundation/tests/runtime/firewall.spec.ts` —
  11 tests covering A-006..A-008 plus audit emission and
  statelessness guarantees.
* **add** `artifacts/handoff/TASK--1/faults/A-00{1..8}.json` —
  fault corpus fixtures (one per attack test).
* **add** `artifacts/handoff/TASK--1/faults/A-00{1..8}.verdict.json` —
  `BLOCKED` verdicts, one per attack test.
* **add** `artifacts/handoff/TASK--1/{summary.md, gate-report.json,
  changed-files.txt, tests.txt, fault-results.json,
  known-risks.md, test-summary.json}` — the handoff package.

## 4. Behaviour now BLOCKED

* Startup with `persistence` service missing → `ok: false`, audit
  event emitted (A-001).
* Startup with `artifact_store` service missing → `ok: false`
  (A-002).
* Startup with `verifier_registry` service missing → `ok: false`
  (A-003).
* Startup with `delivery_policy` service missing → `ok: false`
  (A-004).
* Startup with an unknown `productionConfig` → `ok: false`,
  `unknownConfig` is non-empty (A-005).
* `REVIEW` stage invoking `shell` → `allowed: false`,
  `reason: 'forbidden_capability'` (A-006).
* `DELIVERY` stage invoking `write_model_spec` →
  `allowed: false`, `reason: 'not_in_whitelist'` (A-007).
* `PLAN` stage invoking `solver` → `allowed: false`,
  `reason: 'not_in_whitelist'` (A-008).
* `self_modify` invoked in any stage → `allowed: false`,
  `reason: 'forbidden_capability'`.
* `web` invoked in any stage → `allowed: false`,
  `reason: 'forbidden_capability'`.

## 5. Behaviour still allowed

* `PLAN` may read the problem statement (`read_problem`).
* `MODEL` may read an artifact and write a `ModelSpec`
  (`read_artifact`, `write_model_spec`).
* `EXECUTE` may read artifacts, run code, and run the solver
  (`read_artifact`, `code_runtime`, `solver`).
* `REVIEW` may read artifacts and propose findings
  (`read_artifact`, `propose_finding`).
* `DELIVERY` may only consume verified artifacts
  (`read_verified_artifact`).
* In FAST mode, `EXECUTE` additionally allows
  `propose_finding` (single non-critical difference vs FORMAL).
* In EXPLORATORY mode, the service-level preflight is relaxed but
  the capability firewall still applies; in particular
  `shell`/`web`/`self_modify` are still rejected in every stage.

## 6. Local gate outcome

`gate-report.json`:

```json
{
  "task": "TASK--1",
  "commit": "<git rev-parse HEAD at handoff time>",
  "status": "PASS",
  "tests_total": 240,
  "tests_passed": 240,
  "faults_total": 8,
  "faults_blocked": 8,
  "critical_failures": [],
  "known_risks": []
}
```

## 7. Open known risks

See `known-risks.md` (RISK-01, RISK-02, RISK-03). All three are
explicitly out of scope for this TASK and are deferred per task
book §20/§21.
