# `@deepseek-ai/dsh-harness-foundation`

Phase-two foundation for the Harness extension. This package owns the versioned workflow-run records, the shared `storage-domain` declaration, a repository over that domain, role-settings schemas, and a bounded diagnostics service over `ctx.llm`.

The package deliberately reuses the harness LLM vocabulary and storage services. It does not create a second message protocol, a second persistence backend, or a regular Session for diagnostics. Credential fields are references only; credential values are resolved by the existing credentials seam at the provider boundary.

## Scope

- `workflowRunDomainSpec`: version 1 durable records for runs, nodes, events, artifacts, and manifests.
- `DomainWorkflowRunRepository`: typed access to the shared storage-domain service.
- `HarnessDiagnosticsService`: cancellable, bounded provider probe that returns only status, route, model, latency, and a stable code.
- `HarnessFoundationService`: lifecycle owner for the workflow domain.
- `WorkflowEngine`: durable run/node transitions and process-recovery reconciliation.
- `WorkflowEngineService`: Cordis lifecycle service exposing the engine to later consumers.

The engine owns state facts and recovery only. Provider retry policy, user interface, event transport, and migration logic are later phases.
