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
- `SignedSkillProvider`: optional signed-package source registered through the existing `ctx.skills` provider seam.
- `SkillCatalogService`: durable install, version history, rollback, and conflict detection for skill packages.
- `CatalogSkillProvider`: serves the catalog's active versions through `ctx.skills`.

The `harness.*` apiproxy domain (`api/harness.ts`) exposes run control (`harness.runs.*`), resumable event reads with an `afterSeq` cursor, and catalog operations (`harness.skills.*`) with structured `harness-*` error codes; the engine service is named `harnessWorkflow` to avoid the upstream `workflowEngine` name.

The engine owns state facts and recovery only. Signed packages must pass manifest, file-hash, compatibility, trust-root, and Ed25519 checks before loading; unsigned packages load only in development mode with `allowUnsigned` and are refused in production builds. Catalog installs reject skill sets that would declare one tool twice or activate mutually exclusive tag groups. Provider retry policy, user interface, event transport, and migration logic are later phases.

The package ships on the upstream TypeScript/Cordis plugin architecture; no FastAPI, Electron, or Python sidecar is planned.
