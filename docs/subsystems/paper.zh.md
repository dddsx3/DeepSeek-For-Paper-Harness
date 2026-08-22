# Paper 工作流

[English](paper.md) | 中文

[dsh-paper-foundation](../../packages/paper/paper-foundation) 是 Paper 扩展的持久化内核，[dsh-paper](../../packages/paper/paper-bundle) 是把它组合起来的 profile 层。一次 Paper *运行*就是由一条短流水线产出的交付物——plan、execute、review、revise、deliver——其中每条事实在被依赖之前都已持久化，因此运行能跨进程重启存活，并可从其事件日志回放。该子系统刻意不拥有消息协议、第二个持久化介质或凭据文档：模型调用走 `ctx.llm`，记录存放在 `storage-domain` 单元中，路由只写凭据*引用*，技能通过 `ctx.skills` 到达模型。

来源：[`packages/paper/paper-foundation/src/spec.ts`](../../packages/paper/paper-foundation/src/spec.ts)

## 持久记录

五个版本化域承载该子系统的状态，每个都通过共享的 `storage-domain` 设施打开：

| 域 | 版本 | 承载内容 |
|---|---|---|
| `paper_workflow` | 1 | 运行、节点、只追加事件日志、产物与交付清单 |
| `paper_skills` | 0 | 已安装的技能包及其版本历史 |
| `paper_audit` | 0 | 审计追踪，按追加序号为键 |
| `paper_releases` | 0 | 本安装的身份，以及每一条已暂存的发布记录 |
| `paper_migration` | 0 | 按旧版 id 记录的完成标记，以及最近一次完成的迁移轮次 |

一次运行持有其模式（`fast` 或 `strict`）、harness 版本与配置哈希；一个节点持有其种类、尝试次数与状态。事件是权威来源：`replayWorkflow` 会拒绝存在序号缺口、外来运行 id 或非法转换的历史，因此恢复要么与记录一致，要么直接报错，而不会从无人能解释的状态继续。

## 按模式限轮的复核

`resolveRunPolicy` 把模式转换为两个数字：一次运行可用的修订轮数（`fast` 为一轮，`strict` 为三轮）与每个节点的尝试上限（三次）。fast 模式在轮数用尽后即便仍有缺陷也会交付，并相应标记闸门结果；strict 模式则让运行失败。复核方以 JSON 缺陷清单作答，因为缺陷必须在不借助工具调用的情况下可读；每条缺陷都会在下一轮修订开始前成为持久的公开事件。

## 被组合的策略接缝

重试、成本、审计与上下文预算是执行器组合的独立模块，而不是状态机内部的分支：

- `classifyFailure` 把提供方失败分派为重试、阻断或修订；凭据、路由与请求合法性类失败立即阻断，`backoffDelayMs` 带抖动指数增长且永不低于提供方要求的等待时间。
- `computeCostUsd` 由 token 数按配置价格表推导花费，而不是信任提供方返回的成本字段；`evaluateBudget` 在当日上限用尽后暂停运行（strict 模式上限更高，因为它复核更多）。
- `PaperAuditService` 按追加序号排序其追踪，因为两次操作可能落在同一毫秒，而无法说明先后的追踪不构成证据；`redactSensitiveDetail` 在任何内容持久化之前执行。
- `compactPrompt` 以每 4 字符 1 token 为带标签的分段定价，并按声明的优先级顺序裁剪，同时把被省略的内容存为运行产物，并从请求中引用它。

## 技能与发布

技能包是一个包含 `skill.json`、`system.md` 与可选工具声明的目录；`loadSignedSkill` 在允许加载前校验 schema、harness 兼容性、信任根、分离式 Ed25519 签名，以及每个声明文件的 SHA-256。`SkillCatalogService` 为每个已安装版本保留一个目录，在回滚到某版本前重新校验它，并拒绝会导致活跃集合中同一工具被声明两次、或互斥标签组同时激活的安装。

发布是一份"内容寻址产物"的签名清单。`verifyReleaseManifest` 判定清单，`verifyReleaseArtifacts` 先核对每个产物的大小再核对其哈希，`isInRollout` 把灰度解析为"安装身份 + 版本号"的纯函数，因此一台安装在重启后仍位于灰度的同一侧。`PaperReleaseService` 记录哪个版本已暂存、已激活、被替换以及已健康；激活后从未确认健康的版本会在下次启动时回滚到其前任。把产物就位与重启进程属于调用该服务的安装器。

## 历史迁移与内容清洗

`legacy.ts` 是旧版数据的纯翻译边界：它归一化运行与节点枚举、给新记录加戳、依据部署方维护的 URL 路径段表推断 provider，并把旧版内联 API key 转为 `CredentialPlacement`。迁移后的 settings 文档只包含 `credentialRef`；调用方把每条 placement 交给既有 credentials seam。未知枚举直接失败而不是猜测；被中断的旧运行映射为 `paused`，因为半途停止的工作仍可恢复。

`LegacyMigrationRunner.plan()` 翻译所有 bundle 但不写入，`apply()` 在提交前调用同一套翻译。旧来源既不删除，也不在原处打标。进度只写入 `paper_migration`：只有当运行、节点与连续事件日志全部落盘后，旧版 id 才获得完成标记。如果进程在标记前停止，下一轮会重试按键幂等的写入，并跳过已存在的事件序号；如果进程在标记后停止，下一轮会跳过整个 bundle。每次开始、写入记录、跳过、拒绝与完成都会进入 `paper_audit`。组合只挂载服务，绝不自动启动迁移——预览与提交都是显式的运维操作。

`cleanseSkillBody` 会删除点名旧版命令行工具或绕过实时权限面的操作指令，移除把 provider reasoning 当作可解析通道的指令，并把 provider 专用 XML 风格区块转换为通用 fenced block，同时保留区块内容。每次改写都报告稳定规则 id、原始行号与摘录。人工审核报告之后，清洗后的 `system.md` 才能被签名并安装；模型可见文本的清洗绝不是目录安装时的静默副作用。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [GenerateOptions](llm-streaming.zh.md) · [LlmResolvedModelInfo](llm-streaming.zh.md) · [StreamChunk](llm-streaming.zh.md)

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
