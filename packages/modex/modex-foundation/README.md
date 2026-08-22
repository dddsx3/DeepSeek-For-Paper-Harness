# `@deepseek-ai/dsh-harness-foundation`

Phase-two foundation for the Harness extension. This package owns the versioned workflow-run records, the shared `storage-domain` declaration, a repository over that domain, role-settings schemas, and a bounded diagnostics service over `ctx.llm`.

The package deliberately reuses the harness LLM vocabulary and storage services. It does not create a second message protocol, a second persistence backend, or a regular Session for diagnostics. Credential fields are references only; credential values are resolved by the existing credentials seam at the provider boundary.

## Scope

- `workflowRunDomainSpec`: version 1 durable records for runs, nodes, events, artifacts, and manifests.
- `DomainWorkflowRunRepository`: typed access to the shared storage-domain service.
- `HarnessDiagnosticsService`: cancellable, bounded provider probe that returns only status, route, model, latency, and a stable code.
- `HarnessFoundationService`: lifecycle owner for the workflow domain.
- `WorkflowEngine`: durable run/node transitions and process-recovery reconciliation.
- `replayWorkflow`: contiguous event-log replay with fail-closed transition validation.
- `WorkflowEngineService`: Cordis lifecycle service that replays and recovers active runs during startup.
- `WorkflowExecutor` / `HarnessExecutorService`: drives runs through plan, execute, the mode-bounded review loop, and delivery with a manifest; fast mode delivers after its revise rounds, strict mode fails when defects persist.
- `resolveRunPolicy`: mode-bounded revise rounds and node attempt ceilings.
- `classifyFailure` / `backoffDelayMs`: provider failures routed to retry, block, or revision, with exponential backoff that never undercuts a provider-requested delay.
- `resolveModelPrice` / `computeCostUsd` / `evaluateBudget`: cost derived from token counts against a configured price table, judged against a daily ceiling that strict mode raises.
- `HarnessAuditService`: durable audit trail in its own `harness_audit` domain, ordered by append sequence and pruned by a retention window.
- `redactSensitiveText` / `redactSensitiveValue` / `redactSensitiveDetail`: credential masking applied before anything becomes durable or diagnostic.
- `SignedSkillProvider`: optional signed-package source registered through the existing `ctx.skills` provider seam.
- `SkillCatalogService`: durable install, version history, rollback, and conflict detection for skill packages.
- `CatalogSkillProvider`: serves the catalog's active versions through `ctx.skills`.

The `harness.*` apiproxy domain (`api/harness.ts`) exposes run control (`harness.runs.*`), resumable event reads with an `afterSeq` cursor, and catalog operations (`harness.skills.*`) with structured `harness-*` error codes; the engine service is named `harnessWorkflow` to avoid the upstream `workflowEngine` name. Durable events are also pushed in-process through the `harness/run-event` Cordis event, allowlisted in `API_REMOTE_FORWARDED_EVENTS`, so remote consumers receive them as `host/remote-event` frames over the existing downlink.

A node retries only failures a retry can fix; credential, routing, and request-validity failures fail the run at once, and a node that spends its attempts pauses for review instead of failing, so a resumed run continues from it. A run refuses to start another model call once the day's ceiling is spent: it pauses and records the refusal. Audit detail and provider text are redacted on the way in, so no credential value reaches the trail.

The engine owns state facts and recovery only. Signed packages must pass manifest, file-hash, compatibility, trust-root, and Ed25519 checks before loading; unsigned packages load only in development mode with `allowUnsigned` and are refused in production builds. Catalog installs reject skill sets that would declare one tool twice or activate mutually exclusive tag groups. Provider retry policy, user interface, event transport, and migration logic are later phases.

The package ships on the upstream TypeScript/Cordis plugin architecture; no FastAPI, Electron, or Python sidecar is planned.
