# Paper Workflow

English | [中文](paper.zh.md)

[dsh-paper-foundation](../../packages/paper/paper-foundation) is the Paper extension's durable core, and [dsh-paper](../../packages/paper/paper-bundle) is the profile layer that composes it. A Paper *run* is a deliverable produced by a short pipeline — plan, execute, review, revise, deliver — where every fact is durable before it is acted on, so a run survives a process restart and can be replayed from its event log. The subsystem deliberately owns no message protocol, no second persistence medium, and no credential document: model calls go through `ctx.llm`, records live in `storage-domain` units, routes name credential *references*, and skills reach the model through `ctx.skills`.

Source: [`packages/paper/paper-foundation/src/spec.ts`](../../packages/paper/paper-foundation/src/spec.ts)

## Durable records

Five versioned domains carry the subsystem's state, each opened through the shared `storage-domain` facility:

| Domain | Version | Holds |
|---|---|---|
| `paper_workflow` | 1 | runs, nodes, the append-only event log, artifacts, and delivery manifests |
| `paper_skills` | 0 | installed skill packages with their version history |
| `paper_audit` | 0 | the audit trail, keyed by append sequence |
| `paper_releases` | 0 | this install's identity plus every staged release record |
| `paper_migration` | 0 | per-legacy-id completion marks and the last completed migration pass |

A run holds its mode (`fast` or `strict`), the harness version, and a config hash; a node holds its kind, attempt count, and status. Events are the authority: `replayWorkflow` refuses a history with a sequence gap, a foreign run id, or an illegal transition, so recovery either agrees with the records or fails loud rather than resuming from a state nobody can justify.

## Mode-bounded review

`resolveRunPolicy` turns the mode into two numbers: how many revise rounds a run may spend (one in `fast`, three in `strict`) and how many attempts a node gets (three). Fast mode delivers after its rounds even with defects outstanding and marks the gate result accordingly; strict mode fails the run instead. The reviewer answers with a JSON defect list because a defect must be readable without a tool call, and each defect becomes a durable public event before the next revise round starts.

## Composed policy seams

Retry, cost, audit, and context budgeting are separate modules the executor composes, not branches inside the state machine:

- `classifyFailure` routes a provider failure to retry, block, or revision; credential, routing, and request-validity failures block at once, and `backoffDelayMs` grows exponentially with jitter and never undercuts a provider-requested delay.
- `computeCostUsd` derives spend from token counts against a configured price table rather than trusting a provider-reported cost field, and `evaluateBudget` pauses a run once the day's ceiling is spent (raised for strict mode, which reviews more).
- `PaperAuditService` orders its trail by append sequence, because two operations can share a millisecond and a trail that cannot state which came first is not evidence; `redactSensitiveDetail` runs before anything becomes durable.
- `compactPrompt` prices labeled sections at four characters per token and trims them in declared priority order, storing whatever it elides as a run artifact referenced from the request.

## Skills and releases

A skill package is a directory with `skill.json`, `system.md`, and optional tool declarations; `loadSignedSkill` checks schema, harness compatibility, trust root, detached Ed25519 signature, and each declared file's SHA-256 before the package can load. `SkillCatalogService` keeps one directory per installed version, re-validates a version before rolling back to it, and refuses installs whose active set would declare one tool twice or activate mutually exclusive tag groups.

A release is a signed manifest of content-addressed artifacts. `verifyReleaseManifest` judges the manifest, `verifyReleaseArtifacts` checks each artifact's size before its hash, and `isInRollout` resolves a staged rollout as a pure function of install identity and version, so an install stays on the same side of a rollout across restarts. `PaperReleaseService` records what is staged, active, replaced, and healthy; a version activated but never confirmed healthy is rolled back to its predecessor on the next start. Moving artifacts into place and restarting the process belong to the installer that calls the service.

## Legacy migration and content cleansing

`legacy.ts` is the pure translation boundary for predecessor data: it normalizes run and node enums, stamps new records, infers a provider from a deployment-owned path-segment table, and turns an inline legacy API key into a `CredentialPlacement`. The migrated settings document contains only `credentialRef`; the caller hands each placement to the existing credentials seam. Unknown enum values fail instead of being guessed, and an interrupted legacy run maps to `paused`, because work stopped mid-flight remains resumable.

`LegacyMigrationRunner.plan()` translates every bundle without writing, and `apply()` invokes the same translation before it commits. The source is never deleted or marked in place. Progress lives in `paper_migration`: a legacy id receives a completion mark only after its run, nodes, and contiguous event log land. If the process stops before that mark, the next pass retries the idempotent keyed writes and skips event sequences already present; if it stops after the mark, the next pass skips the bundle. Every start, committed record, skip, refusal, and completion reaches `paper_audit`. The composition mounts the service but never starts a migration — preview and commit are explicit operator actions.

`cleanseSkillBody` removes operating instructions that name a predecessor command-line tool or bypass the live permission surface, drops directives that assume a parseable provider reasoning channel, and turns provider-specific XML-style blocks into neutral fenced blocks while keeping their contents. Every rewrite reports the stable rule id, original line, and excerpt. A person reviews that report before the cleansed `system.md` is signed and installed; cleansing model-visible text is never a silent catalog side effect.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpaperaudit--paperauditservice"></a>

### `ctx.paperAudit` — `PaperAuditService`

Durable audit trail over its own storage domain.

```ts cordis-catalog
/**
 * Append one entry, redacting its detail first, then prune expired entries.
 * @param entry - the operation to record.
 * @returns the persisted entry.
 */
async record(entry: AuditEntryInput): Promise<AuditRecord>

/**
 * Read the trail in append order.
 * @param runId - when given, only entries belonging to that run.
 * @returns the matching entries, oldest first.
 */
list(runId?: string): AuditRecord[]
```

Source: [`packages/paper/paper-foundation/src/audit.ts`](../../packages/paper/paper-foundation/src/audit.ts)

<a id="ctxpaperdiagnostics--paperdiagnosticsservice"></a>

### `ctx.paperDiagnostics` — `PaperDiagnosticsService`

LLM service wrapper for bounded, non-session diagnostics.

```ts cordis-catalog
/**
 * Execute one short request without creating a Session or persisting content.
 * @param request - provider route, model, and timeout policy.
 * @returns status and non-sensitive timing/error facts.
 */
async probe(request: DiagnosticsRequest): Promise<DiagnosticsResult>
```

Source: [`packages/paper/paper-foundation/src/diagnostics.ts`](../../packages/paper/paper-foundation/src/diagnostics.ts)

<a id="ctxpaperexecutor--paperexecutorservice"></a>

### `ctx.paperExecutor` — `PaperExecutorService`

Lifecycle owner of the node executor over the durable engine.

Source: [`packages/paper/paper-foundation/src/executor-service.ts`](../../packages/paper/paper-foundation/src/executor-service.ts)

<a id="ctxpaperfoundation--paperfoundationservice"></a>

### `ctx.paperFoundation` — `PaperFoundationService`

Owns the phase-two workflow domain and exposes its repository.

Source: [`packages/paper/paper-foundation/src/index.ts`](../../packages/paper/paper-foundation/src/index.ts)

<a id="ctxpapermigration--papermigrationservice"></a>

### `ctx.paperMigration` — `PaperMigrationService`

Lifecycle owner of the migration domain and its runner factory.

```ts cordis-catalog
/**
 * Build a runner over this installation's durable records.
 * @param resolvers - id translation for the legacy ids being imported.
 * @returns a runner for one migration pass.
 */
runner(resolvers: Pick<LegacyRecordOptions, 'resolveRunId' | 'resolveNodeId' | 'resolveArtifactId'>): LegacyMigrationRunner

/**
 * Every completion mark recorded so far, oldest first.
 * @returns a snapshot of the migration marks.
 */
marks(): MigrationMark[]

/**
 * Note that a pass finished, so an operator can tell a fresh installation
 * from one that has already imported its predecessor's data.
 * @param report - the committed pass to record.
 * @returns the durable state after recording.
 */
async notePass(report: MigrationReport): Promise<MigrationState>
```

Source: [`packages/paper/paper-foundation/src/migration.ts`](../../packages/paper/paper-foundation/src/migration.ts)

<a id="ctxpaperprovider--paperproviderservice"></a>

### `ctx.paperProvider` — `PaperProviderService`

Shared LLM seam used by workflow consumers.

```ts cordis-catalog
/**
 * Resolve one role's model metadata without retaining mutable settings.
 * @param role - workflow role to resolve.
 * @param settings - detached settings snapshot.
 * @param signal - optional cancellation for model metadata lookup.
 * @returns route identity and adapter-owned model metadata.
 */
async resolveRole( role: PaperRole, settings: PaperSettings, signal?: AbortSignal, ): Promise<{ route: ResolvedRoleRoute; model: LlmResolvedModelInfo }>

/**
 * Dispatch one already assembled request through the shared runtime.
 * @param options - provider-neutral request assembled by a workflow consumer.
 * @returns the provider-neutral stream.
 */
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

Types: [GenerateOptions](llm-streaming.md) · [LlmResolvedModelInfo](llm-streaming.md) · [StreamChunk](llm-streaming.md)

Source: [`packages/paper/paper-foundation/src/provider.ts`](../../packages/paper/paper-foundation/src/provider.ts)

<a id="ctxpaperrelease--paperreleaseservice"></a>

### `ctx.paperRelease` — `PaperReleaseService`

Durable staging, activation, health confirmation, and rollback of releases.

```ts cordis-catalog
/**
 * Verify one manifest and record it as staged. Verification failure and a
 * rollout this install is not part of are both refusals, so nothing unstaged
 * can later be activated.
 * @param raw - manifest as read from a feed, still untrusted.
 * @returns the staged record.
 */
async stage(raw: unknown): Promise<ReleaseRecord>

/**
 * Activate one staged version, remembering the version it replaced so an
 * unhealthy start can return to it.
 * @param version - staged version to activate.
 * @returns the activated record.
 */
async activate(version: string): Promise<ReleaseRecord>

/**
 * Mark the active version healthy. Until this lands, the next start treats
 * the version as unproven and returns to its predecessor.
 * @returns the confirmed record, or `undefined` when no version is active.
 */
async confirmHealthy(): Promise<ReleaseRecord | undefined>

/**
 * Return to a previously staged version.
 * @param toVersion - version to activate; omitted uses the recorded predecessor.
 * @returns the version now active.
 * @throws when no predecessor is recorded or the target was never staged.
 */
async rollback(toVersion?: string): Promise<string>

/**
 * List every staged release, oldest first.
 * @returns a snapshot of the staged table.
 */
list(): ReleaseRecord[]
```

Source: [`packages/paper/paper-foundation/src/release-service.ts`](../../packages/paper/paper-foundation/src/release-service.ts)

<a id="ctxpapersettings--papersettingsservice"></a>

### `ctx.paperSettings` — `PaperSettingsService`

Role settings service with immutable per-read snapshots.

```ts cordis-catalog
/**
 * Detached settings snapshot for one operation, so a mid-operation change
 * cannot alter the routes a run already started with.
 * @returns a deep copy of the currently resolved settings.
 */
snapshot(): PaperSettings
```

Source: [`packages/paper/paper-foundation/src/settings.ts`](../../packages/paper/paper-foundation/src/settings.ts)

<a id="ctxpaperskillcatalog--skillcatalogservice"></a>

### `ctx.paperSkillCatalog` — `SkillCatalogService`

Durable skill package catalog. Validates packages at install, stores one directory per version, re-validates the target before rollback, and refuses installs whose active set would conflict.

```ts cordis-catalog
/**
 * Validate and install one package version. Installing the same version
 * again is idempotent; a new version of the same id keeps prior versions.
 * @param directory - Package directory containing skill.json.
 * @returns the updated catalog record.
 */
async install(directory: string): Promise<InstalledSkillRecord>

/**
 * Switch one skill back to a previously installed version after
 * re-validating the stored copy.
 * @param id - Installed skill id.
 * @param toVersion - Version to activate.
 * @returns the updated catalog record.
 */
async rollback(id: string, toVersion: string): Promise<InstalledSkillRecord>

/**
 * List every installed record.
 * @returns snapshot of the installed table.
 */
list(): InstalledSkillRecord[]

/**
 * Resolve one installed record by id.
 * @param id - Installed skill id.
 * @returns the record, or `undefined` when absent.
 */
get(id: string): InstalledSkillRecord | undefined

/**
 * Directories of every record's active version, for provider wiring.
 * @returns active version directories.
 */
activeDirectories(): string[]

/**
 * Validate and load every record's active version.
 * @returns validated active packages, in record order.
 */
async activeSkills(): Promise<ValidatedSignedSkill[]>
```

Source: [`packages/paper/paper-foundation/src/skill-catalog.ts`](../../packages/paper/paper-foundation/src/skill-catalog.ts)

<a id="ctxpaperworkflow--workflowengineservice"></a>

### `ctx.paperWorkflow` — `WorkflowEngineService`

Cordis service exposing the durable workflow engine to later consumers.

Source: [`packages/paper/paper-foundation/src/workflow.ts`](../../packages/paper/paper-foundation/src/workflow.ts)

<a id="paper-events"></a>

### `paper/*` events

<a id="paperrun-event--emit"></a>

#### `paper/run-event` — emit

One workflow event became durable. Emitted after the append committed, carrying the exact persisted record; listener failures are contained.

```ts cordis-catalog
/**
 * One workflow event became durable. Emitted after the append committed,
 * carrying the exact persisted record; listener failures are contained.
 * @param event - the persisted workflow event.
 * @mode emit
 */
'paper/run-event'(event: WorkflowEvent): void
```

Source: [`packages/paper/paper-foundation/src/types.ts`](../../packages/paper/paper-foundation/src/types.ts)

<a id="paper-skill-events"></a>

### `paper-skill/*` events

<a id="paper-skillcatalog-changed--emit"></a>

#### `paper-skill/catalog-changed` — emit

One installed skill record changed through install or rollback. Emitted after the record is durable; listener failures are contained.

```ts cordis-catalog
/**
 * One installed skill record changed through install or rollback. Emitted
 * after the record is durable; listener failures are contained.
 * @param record - the updated catalog record.
 * @mode emit
 */
'paper-skill/catalog-changed'(record: InstalledSkillRecord): void
```

Source: [`packages/paper/paper-foundation/src/skill-catalog.ts`](../../packages/paper/paper-foundation/src/skill-catalog.ts)
<!-- END GENERATED cordis-surface -->
