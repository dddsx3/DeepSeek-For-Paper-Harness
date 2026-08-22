# Agent Note: Harness foundation reuses storage and LLM seams

Status: implemented

English | [中文](2026-08-22-harness-foundation-seams.zh.md)

## Problem

The phase-two implementation needs durable workflow-run records, role settings, and a bounded provider diagnostic without introducing a second message protocol, persistence medium, or credential document inside the harness.

## Decision

The Harness rebuild ships on the upstream TypeScript/Cordis plugin architecture (`packages/*/*`, Zod schemas, storage-domain persistence, `ctx.llm` and `ctx.skills` seams). A FastAPI, Electron, or Python sidecar was considered and rejected: it would duplicate the upstream runtime and create a second source of durable state. This closes the product-form question for all later phases.

`@deepseek-ai/dsh-harness-foundation` is a host package under `packages/harness/harness-foundation`. Its versioned Zod records are declared once in `src/spec.ts` and opened through the existing `storage-domain` facility. `DomainWorkflowRunRepository` exposes typed run, node, event, artifact, and manifest operations while keeping backend details out of workflow consumers.

Role settings use the existing settings namespace mechanism and store only credential references. `HarnessProviderService` resolves roles through `ctx.llm.resolveModelInfo()` and dispatches through `ctx.llm.stream()`, so DeepSeek remains an adapter-owned implementation. `HarnessDiagnosticsService` performs a bounded cancellable request without creating a normal Session and returns only route, model, latency, and a stable status code. `WorkflowEngine` owns durable run/node state transitions and recovery reconciliation; `replayWorkflow` validates contiguous event history before recovery, and `WorkflowEngineService` runs that recovery during startup. `SignedSkillProvider` is an optional source on the existing `ctx.skills` registry; it validates manifest compatibility, declared file hashes, trust-root selection, and detached Ed25519 signatures before exposing a skill. `SkillCatalogService` owns durable install, version history, and rollback over its own `harness_skills` domain, rejects skill sets whose active tools or exclusive tag groups collide, and accepts unsigned packages only in development mode with `allowUnsigned`, never in production builds. `CatalogSkillProvider` serves the catalog's active versions through `ctx.skills`. The `harness.*` apiproxy domain exposes run control (`list/get/start/pause/resume/cancel`), resumable event reads (`events` with an `afterSeq` cursor over the durable log), and catalog operations, with structured `harness-*` error codes; both Harness services stay optional compositions. `WorkflowExecutor` drives plan, execute, the mode-bounded review loop (`resolveRunPolicy`: fast delivers after one revise round, strict allows three and fails when defects persist), and delivery with a manifest; every model call goes through the shared provider seam and every fact through the engine, so execution remains replayable. Durable events are pushed in-process as `harness/run-event` and forwarded to remote consumers through the `API_REMOTE_FORWARDED_EVENTS` allowlist (`host/remote-event` frames).

Retry, cost, and audit are separate seams the executor composes rather than logic inside the state machine. `classifyFailure` decides whether a provider failure retries, blocks, or needs a content edit; `backoffDelayMs` grows exponentially with jitter and never undercuts a provider-requested delay; a node that spends its attempts pauses for review rather than failing, so a resumed run continues from it. Cost is derived from token counts against a configured price table instead of trusted from a provider field, and `evaluateBudget` pauses a run once the day's ceiling is spent, with a raised ceiling for strict mode because it reviews more. `HarnessAuditService` owns a separate `harness_audit` domain ordered by append sequence, because two operations can land in the same millisecond and a trail that cannot state which came first is not evidence; every detail map passes through `redactSensitiveDetail` first. Context budgeting is a fourth composed seam: `compactPrompt` prices labeled prompt sections under the repo's four-character density and trims them in declared priority order, so a regenerable plan gives way before the defect list, the draft, and finally the task, while instructions are never cut. A section that reaches its keep floor is retired so the next tier gives way instead of the pass budget spinning on one section, and a prompt that still cannot fit is sent as short as the module can make it — reporting an estimate above budget — rather than dropping a required section. Whatever is elided is stored as a run artifact and referenced from the request, which is how large content stays recoverable without being resent. Budget, backoff, retention, prices, and the context utilization fraction are validated service config, not constants.

## Alternatives considered

- Adding a second Python service and database would duplicate the upstream runtime and create two sources of durable state.
- Defining a new Harness message or provider interface would duplicate `GenerateOptions`, `StreamChunk`, and `LlmFailure` already owned by `dsh-llm`.
- Storing credential values in the Harness settings record would violate the existing credentials seam and make ordinary settings reads unsafe.

## Consequences

The package requires the existing storage-domain, settings, credentials, and LLM services in a composition. The workflow state machine, transport endpoints, retry policy, and content migration remain later phases. The new domain is stamped at version 1 and rejects incompatible media through the shared storage backend.

## Testing

Both compiler faces build without errors, and the package meets the repository's per-file 100% coverage gate: schema, storage, provider, diagnostics, settings, workflow, replay, context budgeting, cost, resilience, redaction, audit, skill catalog, and apiproxy harness-domain suites all run without network access. The package invariant companion checks undeclared domain tables and persisted values against the declared schemas.

`tests/workflow.e2e.ts` is the real-API acceptance suite and self-skips without `$DEEPSEEK_API_KEY`, so a keyless lane stays green. It asserts durable facts rather than model prose — manifest, artifact, accumulated usage, audit trail, and a replay of the event log agreeing with the records — and deliberately omits a strict-mode case, whose four reviews would spend four times the calls to pin facts the unit suites already cover.
