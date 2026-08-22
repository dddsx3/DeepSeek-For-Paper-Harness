# `@deepseek-ai/dsh-harness-foundation`

English | [中文](README.zh.md)

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
- `compactPrompt` / `estimateTextTokens`: prompt sections priced under the repo's four-character density and trimmed by declared priority so a request fits the model's window.
- `HarnessAuditService`: durable audit trail in its own `harness_audit` domain, ordered by append sequence and pruned by a retention window.
- `redactSensitiveText` / `redactSensitiveValue` / `redactSensitiveDetail`: credential masking applied before anything becomes durable or diagnostic.
- `SignedSkillProvider`: optional signed-package source registered through the existing `ctx.skills` provider seam.
- `SkillCatalogService`: durable install, version history, rollback, and conflict detection for skill packages.
- `CatalogSkillProvider`: serves the catalog's active versions through `ctx.skills`.
- `verifyReleaseManifest` / `isInRollout` / `verifyReleaseArtifacts`: release manifests judged against a trust root, a harness floor, a staged rollout bucket, and per-artifact content hashes.
- `HarnessReleaseService`: durable staging, activation, health confirmation, and rollback of releases, with startup reconciliation of a version that never reported healthy.
- `migrateLegacySettings` / `migrateLegacyRun` / `migrateLegacyNode` / `migrateLegacyEvent`: pure translation from predecessor documents and rows into credential-reference settings and current durable records.
- `LegacyMigrationRunner` / `HarnessMigrationService`: dry-run, resumable, non-destructive import with per-legacy-id completion marks and migration audit events.
- `cleanseSkillBody` / `needsCleansing`: reviewable removal of provider-specific markup, command-line instructions, permission-bypass instructions, and reasoning-channel assumptions.

The `harness.*` apiproxy domain (`api/harness.ts`) exposes run control (`harness.runs.*`), resumable event reads with an `afterSeq` cursor, and catalog operations (`harness.skills.*`) with structured `harness-*` error codes; the engine service is named `harnessWorkflow` to avoid the upstream `workflowEngine` name. Durable events are also pushed in-process through the `harness/run-event` Cordis event, allowlisted in `API_REMOTE_FORWARDED_EVENTS`, so remote consumers receive them as `host/remote-event` frames over the existing downlink.

A request is fitted to the role's context window before it is sent: the lowest-priority sections give way first (a regenerable plan, then the defect list, then the draft, then the task, never the instruction), a trimmed section keeps its head and tail, and once every trimmable section reaches its floor the prompt is sent as short as it can be made rather than silently dropping a required section. When anything is elided the untrimmed prompt is stored as a run artifact and the request carries its reference, so the full text stays recoverable without being resent.

A node retries only failures a retry can fix; credential, routing, and request-validity failures fail the run at once, and a node that spends its attempts pauses for review instead of failing, so a resumed run continues from it. A run refuses to start another model call once the day's ceiling is spent: it pauses and records the refusal. Audit detail and provider text are redacted on the way in, so no credential value reaches the trail.

The engine owns state facts and recovery only. Signed packages must pass manifest, file-hash, compatibility, trust-root, and Ed25519 checks before loading; unsigned packages load only in development mode with `allowUnsigned` and are refused in production builds. Catalog installs reject skill sets that would declare one tool twice or activate mutually exclusive tag groups.

An update is a signed manifest of content-addressed artifacts, and nothing is activated that has not verified: schema, harness floor, trust root, detached Ed25519 signature, then each artifact's size and SHA-256. Whether an install is offered a staged release is a pure function of its install identity and the version, so an install that is in a rollout stays in it across restarts instead of re-drawing a lot each start, and a held-back install can still be offered the next version. `HarnessReleaseService` records which version is staged, which is active, which it replaced, and which has reported itself healthy; a version that was activated but never confirmed healthy is rolled back to its predecessor on the next start, so a bad release cannot strand an installation on itself. Staging, activation, and rollback all reach the audit trail. The service records release state and decides what should be active — moving artifacts into place and restarting the process belong to the installer that calls it.

Legacy migration is explicit and non-destructive. The pure translators fail on unknown enums rather than guessing, lift inline API keys into credential placements, and leave only references in settings. `LegacyMigrationRunner.plan()` previews with the same translation `apply()` commits; `harness_migration` records completion only after one legacy run's records land, so a stopped pass resumes by legacy id and never deletes or edits its source. `cleanseSkillBody` reports each provider-specific markup or instruction rewrite by rule and line; a person reviews that report before the resulting `system.md` is signed and installed. The composition mounts the migration service but never scans or imports anything during startup.

The package ships on the upstream TypeScript/Cordis plugin architecture; no FastAPI, Electron, or Python sidecar is planned. [`@deepseek-ai/dsh-harness`](../harness-bundle/README.md) is the profile bundle that composes these services as loader rows.

## Model Experience

### Workflow node request

#### What the model sees

One plain-text request per node, assembled from labeled sections joined by a blank line: `Task: <input>` first, then the node's own material (`Plan:`, `Current text:`, `Delivered text:`, `Defects:`), then a single instruction line. The review node's instruction states the exact reply shape it will parse, so a defect list is machine-readable without a tool call. Nothing else is added: there is no persona, no tool catalog, and no conversation history, because each node is its own request rather than a turn in a growing transcript. When the request had to be shortened, it ends with an `<artifact_ref kind="text" id="…" sha256="…" />` naming the stored untrimmed prompt.

##### Review node request

```markdown
Task: draft the migration note

Delivered text:
<the text under review>

List defects, or return an empty list. Respond with JSON only in this shape:
{"defects":[{"severity":"major|minor","description":"..."}]}
```

#### Token effect

Content is priced before it is sent, at four characters per token plus four tokens of section framing — the same heuristic `dsh-token-meter` applies — and the whole request is fitted to `contextUtilization` (0.8 by default) of the role's context window. Over budget, the most expendable section is halved first in declared order (plan, then defects, then draft, then the task statement), keeping each section's head and tail with a `… N characters elided …` note between them and never falling below 200 characters; an instruction is never cut. A prompt that still cannot fit is sent as short as the module can make it and reports an estimate above budget rather than dropping a required section.

#### KV Cache effect

Each node opens a fresh request, so nothing accumulates across a run and there is no growing prefix to reuse between nodes. Within a run the `Task:` section is byte-identical across every node and sits first, so a provider-side prefix cache can hold it while the varying material and the instruction follow; a retry of the same node re-sends the same bytes and hits that prefix. A compaction pass rewrites the middle of a section, which invalidates any cached prefix from that section onward — one more reason bulk is stored as an artifact and referenced instead of resent.

## Known Limitations and Deferred Work

- **The token estimate is a heuristic, not the provider's tokenizer** — a request fitted here can still exceed the real count; that arrives as a `CONTEXT_WINDOW_EXCEEDED` failure, which blocks the run rather than re-fitting and resending it.
- **The release service records state; it does not install anything** — verification, staging, activation, health, and rollback are durable decisions, while placing artifacts on disk and restarting the process belong to the caller.
- **Self-update stays off until a deployment names a trust root** — with no trusted key every manifest is refused, which is the intended default rather than a gap to close with `allowUnsigned`.
- **The audit trail prunes by retention window only** — there is no export path and no tamper-evident chaining between records yet.
- **Legacy SQLite extraction is caller-owned** — this package translates untrusted rows after a reader supplies them; it does not open an unknown predecessor database or load opaque binaries.
- **Content cleansing is mechanical, not editorial approval** — every rewrite is reported and the result remains unsigned until a person reviews it.
