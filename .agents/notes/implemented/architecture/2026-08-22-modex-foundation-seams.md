# Agent Note: Harness foundation reuses storage and LLM seams

Status: implemented

## Problem

The phase-two implementation needs durable workflow-run records, role settings, and a bounded provider diagnostic without introducing a second message protocol, persistence medium, or credential document inside the harness.

## Decision

`@deepseek-ai/dsh-harness-foundation` is a host package under `packages/harness/harness-foundation`. Its versioned Zod records are declared once in `src/spec.ts` and opened through the existing `storage-domain` facility. `DomainWorkflowRunRepository` exposes typed run, node, event, artifact, and manifest operations while keeping backend details out of workflow consumers.

Role settings use the existing settings namespace mechanism and store only credential references. `HarnessProviderService` resolves roles through `ctx.llm.resolveModelInfo()` and dispatches through `ctx.llm.stream()`, so DeepSeek remains an adapter-owned implementation. `HarnessDiagnosticsService` performs a bounded cancellable request without creating a normal Session and returns only route, model, latency, and a stable status code. `WorkflowEngine` owns durable run/node state transitions and recovery reconciliation; provider retry policy remains outside the state machine.

## Alternatives considered

- Adding a second Python service and database would duplicate the upstream runtime and create two sources of durable state.
- Defining a new Harness message or provider interface would duplicate `GenerateOptions`, `StreamChunk`, and `LlmFailure` already owned by `dsh-llm`.
- Storing credential values in the Harness settings record would violate the existing credentials seam and make ordinary settings reads unsafe.

## Consequences

The package requires the existing storage-domain, settings, credentials, and LLM services in a composition. The workflow state machine, transport endpoints, retry policy, and content migration remain later phases. The new domain is stamped at version 1 and rejects incompatible media through the shared storage backend.

## Testing

The host TypeScript build includes the package without errors. Schema, storage, provider, diagnostics, and settings tests run without external network access. The package invariant companion checks undeclared domain tables and persisted values against the declared schemas.
