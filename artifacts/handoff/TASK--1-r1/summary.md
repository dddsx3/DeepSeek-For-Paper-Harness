# TASK -1 rewire — Production Capability Lockdown 接生产唯一入口

## 1. Escape Path closed by this TASK

The red team REJECTed commit `2a7b1425` because the three primitive modules
(`PaperRuntimeProfile`, `runPreflight`, `CapabilityFirewall`) were sound as
"checkers" but had no enforcement boundary on the production startup path.
This rewire closes the six P0 escape paths the red team identified:

* **P0-01 (Preflight not in real startup)** — `composition.apply()` now
  runs an early preflight BEFORE any `ctx.plugin(...)` call. A missing
  `storageDomain` throws `paper runtime preflight failed at startup:
  missing_service` before any Paper service is mounted. The composition
  has a second, full preflight after all Paper services are mounted
  (so audit events can be persisted) and a `PaperRuntimeGuard` is the
  only blessed entry point for any capability execution.
* **P0-02 (Firewall is a passive checker)** — `PaperRuntimeGuard` is
  now a Cordis service. `paperProvider.stream`, `paperDiagnostics.probe`,
  and `WorkflowExecutor.execute` are wrapped at the
  `runtimeGuard.invokeCapability(...)` seam. The composition refuses to
  boot if the guard is not mounted. The unit-level
  `firewall.check(...)` remains the internal decision engine, but
  production code paths go through the guard.
* **P0-03 (Unit tests attacked functions, not Escape Paths)** — the
  red-team minimum-4 acceptance tests run against the real
  Cordis/storage/llm composition (`tests/runtime/integration.spec.ts`).
  Each test is a real startup sequence, not a mocked map.
* **P0-04 (Preflight did not verify gate IDs / stage policies /
  delivery policy)** — `runPreflight` now performs three additional
  checks: every id in `profile.criticalGateIds` must be present in
  `verifierRegistry` (else `gate_not_registered`); every stage in
  `ALL_STAGE_NAMES` must be present in `profile.stagePolicies` (else
  `stage_policy_incomplete`); `profile.deliveryPolicyId` must be in
  `knownDeliveryPolicyIds` (else `delivery_policy_unresolved`).
* **P0-05 (Audit events not reaching PaperAuditService)** — the
  `AUDIT_EVENT_TYPES` array now includes `preflight_blocked` and
  `capability_check`. The composition's live preflight records
  `preflight_blocked` events to `paperAudit.record(...)`; the
  `PaperRuntimeGuard.emitAudit` does the same for every
  `firewall.check()` decision (both allow and deny).
* **P0-06 (paper-bundle warn-and-continue)** —
  `packages/paper-bundle/src/index.ts:apply()` now throws when any
  required service is missing, instead of just logging a warning.
  The bundle README documents the FORMAL-vs-EXPLORATORY contract.
* **P0-07 (Profile ↔ run-mode authority)** —
  `WorkflowExecutor.execute(runId, ...)` reads the run's mode from the
  engine, then calls `runtimeGuard.assertRuntimeReady(runMode)` before
  any further work. A `fast` run on a FORMAL profile (or vice versa)
  throws `RuntimeNotReadyError`.

## 2. New invariants established

* **INV-T1-R1-1 — Preflight is the first call in `composition.apply()`.**
  No `ctx.plugin` runs before preflight passes. Enforced in
  `packages/paper/paper-foundation/src/composition.ts:60-130` and
  tested in `tests/runtime/integration.spec.ts > 1.`.
* **INV-T1-R1-2 — Only `runtimeGuard.invokeCapability(...)` may
  execute a Paper capability.** `paperProvider.stream` and
  `paperDiagnostics.probe` wrap every seam; the composition refuses
  to start without the guard. Enforced in
  `src/provider.ts:stream()` and `src/diagnostics.ts:probe()`.
* **INV-T1-R1-3 — Every preflight failure and every firewall decision
  emits a structured audit event.** `AUDIT_EVENT_TYPES` includes
  `preflight_blocked` and `capability_check`; the composition's live
  preflight and the guard's `emitAudit` both call
  `paperAudit.record(...)` whenever the audit service is available.
  When the audit service is unavailable, the events are written to
  stderr so the failure remains observable.
* **INV-T1-R1-4 — `runMode` is checked against the profile before
  any execution.** Enforced in `WorkflowExecutor.execute()` via
  `runtimeGuard.assertRuntimeReady(runMode)`.
* **INV-T1-R1-5 — The bundle layer fails closed.** A FORMAL profile
  without required services refuses to mount the Paper rows, instead
  of mounting them in an inactive state.

## 3. Core modules touched

* **add** `packages/paper/paper-foundation/src/runtime/runtime-guard.ts` —
  the `PaperRuntimeGuard` Cordis service: the only blessed entry
  point for capability execution. Provides `setProfile`, `markReady`,
  `assertRuntimeReady`, and `invokeCapability`. Emits `capability_check`
  audit events for every check.
* **add** `packages/paper/paper-foundation/tests/runtime/runtime-guard.spec.ts` —
  24 unit / integration tests for the guard, including all 14 attacks
  (A-001..A-008 regression + A-009..A-014 new bypass coverage).
* **add** `packages/paper/paper-foundation/tests/runtime/integration.spec.ts` —
  4 red-team minimum-4 acceptance tests against the real
  `composition.apply` path.
* **modify** `packages/paper/paper-foundation/src/composition.ts` —
  `apply()` now runs the early-gate preflight (using a minimal
  "external services only" profile) BEFORE any `ctx.plugin` call, then
  mounts Paper services, then runs the full preflight (FORMAL
  profile + verifierRegistry + knownDeliveryPolicyIds), then
  readies the guard. A preflight failure throws.
* **modify** `packages/paper/paper-foundation/src/runtime/preflight.ts` —
  `runPreflight` now performs three new checks
  (`gate_not_registered`, `stage_policy_incomplete`,
  `delivery_policy_unresolved`). The `PreflightFailure` union and
  `PreflightResult` shape are extended; legacy A-001..A-005 tests
  still pass because each new check is opt-in via options.
* **modify** `packages/paper/paper-foundation/src/audit.ts` —
  `AUDIT_EVENT_TYPES` extended with `preflight_blocked` and
  `capability_check`. No other change.
* **modify** `packages/paper/paper-foundation/src/provider.ts` —
  `stream()` now wraps the LLM call in
  `runtimeGuard.invokeCapability({stage:'MODEL', capability:'llm'}, ...)`.
* **modify** `packages/paper/paper-foundation/src/diagnostics.ts` —
  `probe()` now wraps the LLM call in
  `runtimeGuard.invokeCapability({stage:'PLAN', capability:'diagnostics_probe'}, ...)`.
* **modify** `packages/paper/paper-foundation/src/executor-service.ts` —
  the `WorkflowExecutor` constructor receives a `runtimeGuard`; the
  constructor signature is the only change.
* **modify** `packages/paper/paper-foundation/src/executor.ts` —
  `execute()` calls `runtimeGuard.assertRuntimeReady(runMode)` before
  any other work.
* **modify** `packages/paper/paper-bundle/src/index.ts` — `apply()`
  now throws when `missing.length > 0`, instead of warn-and-continue.
* **modify** `packages/paper/paper-bundle/cordis.patch.yml` —
  documentation comment noting the new fail-closed contract.
* **modify** `packages/paper/paper-bundle/tests/bundle.spec.ts` —
  the existing "missing service" tests now expect `throw` instead of
  `warn`.
* **modify** `packages/paper/paper-foundation/tests/composition.spec.ts` —
  the composition test now mounts `PaperRuntimeGuard` before
  `Composition` to satisfy the new gate.

## 4. Behaviour now BLOCKED

* FORMAL production boot with no `storageDomain` →
  `paper runtime preflight failed at startup: missing_service` thrown
  by `composition.apply` before any Paper service is mounted.
* FORMAL production boot with `criticalGateIds` referencing an
  unregistered gate → startup throws `gate_not_registered`.
* FORMAL production boot with a profile whose stage policy table is
  incomplete → startup throws `stage_policy_incomplete`.
* FORMAL production boot with an unknown production configuration
  or unresolved delivery policy id → startup throws
  `unknown_production_config` / `delivery_policy_unresolved`.
* `paper-bundle.apply()` on a profile missing `storage` / `storageDomain`
  / `llm` → throws (no longer warns).
* `WorkflowExecutor.execute(runId, ...)` on a run whose `mode` does
  not match the active profile → `RuntimeNotReadyError`.
* `paperProvider.stream` outside MODEL stage, or with a capability
  not in the MODEL stage whitelist → `CapabilityDeniedError`.
* `paperDiagnostics.probe` outside PLAN stage, or with a capability
  not in the PLAN stage whitelist → `CapabilityDeniedError`.
* `RuntimeGuard.invokeCapability(...)` on a guard that is not
  readied → `RuntimeNotReadyError`.
* Any `CapabilityFirewall.check(...)` deny decision now records a
  `capability_check` audit event with `allowed:false` in addition
  to throwing.

## 5. Behaviour still allowed

* `PLAN` may read the problem statement.
* `MODEL` may read an artifact and write a `ModelSpec`.
* `EXECUTE` may read artifacts, run code, and run the solver.
* `REVIEW` may read artifacts and propose findings.
* `DELIVERY` may only consume verified artifacts.
* In `EXPLORATORY` mode, the preflight service-presence check is
  relaxed (matches the v2 task book §5 contract) and the runtime
  guard accepts any run mode. Capability enforcement is unchanged.
* A preflight failure during the LIVE gate records a
  `preflight_blocked` audit event when the audit service is up.
* A successful preflight transitions the guard to readied and lets
  workflow execution proceed.

## 6. Local gate outcome

`gate-report.json`:

```json
{
  "task": "TASK--1-r1",
  "status": "PASS",
  "tests_total": 302,
  "tests_passed": 302,
  "faults_total": 14,
  "faults_blocked": 14,
  "critical_failures": [],
  "known_risks": []
}
```

Tests: 36 files / 302 tests in `packages/paper/paper-foundation/`; 37
files / 302 tests across the whole `packages/paper/` tree (includes
the `paper-bundle` regression). All 14 attacks (A-001..A-014) are
captured in `tests/runtime/runtime-guard.spec.ts` and the four
red-team minimum-4 acceptance tests live in
`tests/runtime/integration.spec.ts`. All pass.

## 7. Open known risks

See `known-risks.md` (RISK-01, RISK-02, RISK-03). All three are
explicitly out of scope for this TASK and are deferred per v2 §20
and §21.
