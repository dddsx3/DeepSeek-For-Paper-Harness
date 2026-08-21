# Agent Note: Harness foundation reuses storage and LLM seams

Status: implemented

## Problem

The phase-two implementation needs durable workflow-run records, role settings, and a bounded provider diagnostic without introducing a second message protocol, persistence medium, or credential document inside the harness.

## Decision

The Harness rebuild ships on the upstream TypeScript/Cordis plugin architecture (`packages/*/*`, Zod schemas, storage-domain persistence, `ctx.llm` and `ctx.skills` seams). A FastAPI, Electron, or Python sidecar was considered and rejected: it would duplicate the upstream runtime and create a second source of durable state. This closes the product-form question for all later phases.

`@deepseek-ai/dsh-harness-foundation` is a host package under `packages/harness/harness-foundation`. Its versioned Zod records are declared once in `src/spec.ts` and opened through the existing `storage-domain` facility. `DomainWorkflowRunRepository` exposes typed run, node, event, artifact, and manifest operations while keeping backend details out of workflow consumers.

Role settings use the existing settings namespace mechanism and store only credential references. `HarnessProviderService` resolves roles through `ctx.llm.resolveModelInfo()` and dispatches through `ctx.llm.stream()`, so DeepSeek remains an adapter-owned implementation. `HarnessDiagnosticsService` performs a bounded cancellable request without creating a normal Session and returns only route, model, latency, and a stable status code. `WorkflowEngine` owns durable run/node state transitions and recovery reconciliation; `replayWorkflow` validates contiguous event history before recovery, and `WorkflowEngineService` runs that recovery during startup. `SignedSkillProvider` is an optional source on the existing `ctx.skills` registry; it validates manifest compatibility, declared file hashes, trust-root selection, and detached Ed25519 signatures before exposing a skill. `SkillCatalogService` owns durable install, version history, and rollback over its own `harness_skills` domain, rejects skill sets whose active tools or exclusive tag groups collide, and accepts unsigned packages only in development mode with `allowUnsigned`, never in production builds. `CatalogSkillProvider` serves the catalog's active versions through `ctx.skills`. The `harness.*` apiproxy domain exposes run control (`list/get/start/pause/resume/cancel`), resumable event reads (`events` with an `afterSeq` cursor over the durable log), and catalog operations, with structured `harness-*` error codes; both Harness services stay optional compositions. Provider retry policy remains outside the state machine.

## Alternatives considered

- Adding a second Python service and database would duplicate the upstream runtime and create two sources of durable state.
- Defining a new Harness message or provider interface would duplicate `GenerateOptions`, `StreamChunk`, and `LlmFailure` already owned by `dsh-llm`.
- Storing credential values in the Harness settings record would violate the existing credentials seam and make ordinary settings reads unsafe.

## Consequences

The package requires the existing storage-domain, settings, credentials, and LLM services in a composition. The workflow state machine, transport endpoints, retry policy, and content migration remain later phases. The new domain is stamped at version 1 and rejects incompatible media through the shared storage backend.

## Testing

The host TypeScript build includes the package without errors. Schema, storage, provider, diagnostics, settings, workflow, replay, skill catalog, and apiproxy harness-domain tests run without external network access. The package invariant companion checks undeclared domain tables and persisted values against the declared schemas.
