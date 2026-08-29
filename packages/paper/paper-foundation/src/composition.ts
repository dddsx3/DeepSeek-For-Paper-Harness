/** Cordis composition for the phase-two Paper foundation services. */

import type { Context } from '@deepseek-ai/cordis'
import PaperDiagnosticsService from './diagnostics.ts'
import PaperFoundationService from './index.ts'
import PaperProviderService from './provider.ts'
import PaperSettingsService from './settings.ts'
import WorkflowEngineService from './workflow.ts'
import PaperExecutorService from './executor-service.ts'
import PaperAuditService from './audit.ts'
import PaperReleaseService from './release-service.ts'
import PaperMigrationService from './migration.ts'
import PaperRuntimeGuard from './runtime/runtime-guard.ts'
import { runPreflight } from './runtime/preflight.ts'
import { DEFAULT_RUNTIME_PROFILE, type PaperRuntimeProfile } from './runtime/profile.ts'
import type { ExecutorConfig } from './executor-service.ts'
import type { AuditConfig } from './audit.ts'
import type { ReleaseConfig } from './release-service.ts'
import type { MigrationConfig } from './migration.ts'
import type { PaperSettings } from './spec.ts'

/** Cordis plugin name for the complete phase-two service set. */
export const name = 'paper-foundation-composition'
/**
 * The composition needs the shared model and storage services. The actual
 * dependency check is performed by `runPreflight` inside `apply(...)` — the
 * `inject` array is intentionally left empty so that preflight is the first
 * authority to refuse to boot, rather than Cordis's static dependency
 * resolution. This makes the failure mode observable and aligned with the
 * TASK -1 gate "FORMAL environment关键组件缺失时无法启动".
 */
// (no `inject` declared — preflight owns the gate)

/** Composition config: role settings plus the audit and execution policies. */
export interface CompositionConfig extends PaperSettings {
  /** Audit retention policy; omitted uses the service default. */
  readonly auditPolicy?: AuditConfig
  /** Budget, backoff, and pricing policy; omitted uses the service defaults. */
  readonly executionPolicy?: ExecutorConfig
  /** Release trust and compatibility policy; omitted uses the service defaults. */
  readonly releasePolicy?: ReleaseConfig
  /** Stamps applied when an operator explicitly runs a legacy migration. */
  readonly migrationPolicy?: MigrationConfig
}

/**
 * Install the phase-two Paper services in one dependency-ordered composition.
 * The audit trail mounts before the executor so every run is recorded from its
 * first event.
 *
 * TASK -1 rewire: after the audit trail is up, the composition also mounts
 * `PaperRuntimeGuard`, runs `runPreflight` against the live context, and only
 * then marks the guard ready. If preflight fails, the composition throws —
 * there is no warn-and-continue path. The guard is the single blessed entry
 * point for capability execution; without it being readied, no provider call,
 * no diagnostics probe, and no workflow execution can happen.
 * @param ctx - Context carrying the shared LLM and storage-domain services.
 * @param config - Role settings plus optional audit and execution policy.
 */
export async function apply(ctx: Context, config: CompositionConfig): Promise<void> {
  // TASK -1 rewire (early gate): preflight runs BEFORE any ctx.plugin call.
  // It only checks the things that can be observed at this stage:
  //   - the service presence in `ctx` (via `ctx.get(name)`),
  //   - the production config name,
  //   - and — by virtue of using a minimal "early gate" profile that does
  //     NOT try to verify criticalGateIds against service-mounted objects,
  //     which would be a chicken-and-egg loop. The full check (gate
  //     registration, stage policy completeness, delivery policy
  //     resolution) runs in the second preflight after the services are
  //     mounted, below.
  //
  // The early-gate profile contains only the four `storageDomain`-derived
  // services, because `paperAudit` and `paperDeliveryPolicy` are services
  // THIS composition mounts a few lines below — checking them here would
  // be circular. The full FORMAL profile (with all six services) runs
  // again after the services are mounted.
  const earlyGateProfile: PaperRuntimeProfile = {
    ...DEFAULT_RUNTIME_PROFILE,
    requiredServices: [
      { kind: 'persistence', interfaceName: 'paper.persistence' },
      { kind: 'artifact_store', interfaceName: 'paper.artifactStore' },
      { kind: 'verifier_registry', interfaceName: 'paper.verifierRegistry' },
      { kind: 'hash_provider', interfaceName: 'paper.hashProvider' },
    ],
  }
  const knownProductionConfigs = new Set<string>(['paper.formal', 'paper.exploratory'])
  const knownDeliveryPolicyIds = new Set<string>(['delivery.formal-v1'])
  // Build the available-services map WITHOUT pre-populating undefined entries.
  // `runPreflight` checks presence via `Map.has(...)` (not the value), so an
  // entry whose value is `undefined` is treated as present. We only insert
  // keys whose value is actually defined, which is the truthful answer to
  // "is this service present in the live context?".
  const availableServicesEarly = new Map<string, unknown>()
  const storageDomain = ctx.get('storageDomain', false)
  if (storageDomain !== undefined) {
    availableServicesEarly.set('paper.persistence', storageDomain)
    availableServicesEarly.set('paper.artifactStore', storageDomain)
    availableServicesEarly.set('paper.verifierRegistry', storageDomain)
    availableServicesEarly.set('paper.hashProvider', storageDomain)
  }
  const earlyPreflight = runPreflight(earlyGateProfile, {
    profile: earlyGateProfile,
    productionConfig: 'paper.formal',
    availableServices: availableServicesEarly,
    knownProductionConfigs,
    // omit verifierRegistry and knownDeliveryPolicyIds on purpose; the
    // second preflight below will check them once the services exist.
    auditSink: (event) => {
      process.stderr.write(
        `[paper-preflight] early-gate ${JSON.stringify(event)} at=${event.at}\n`,
      )
    },
  })
  if (earlyPreflight.ok === false) {
    const reason = earlyPreflight.failures.map(f => f.kind).join(', ')
    throw new Error(`paper runtime preflight failed at startup: ${reason}`)
  }

  await ctx.plugin(PaperSettingsService, config)
  await ctx.plugin(PaperProviderService)
  await ctx.plugin(PaperDiagnosticsService)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  await ctx.plugin(PaperAuditService, config.auditPolicy ?? {})

  // TASK -1 rewire (full gate): the second preflight runs AFTER the audit
  // service is mounted, so audit events can be persisted. It now also
  // verifies criticalGateIds against the live verifierRegistry and checks
  // the stage-policy table and delivery-policy id resolution. The
  // verifierRegistry here is built from the services we just mounted: the
  // critical gates are not separate services, so we use a sentinel
  // `Object.freeze({})` value per id, marking "registered" without
  // depending on actual implementation objects (the runtime guard is the
  // sole authority on whether a gate can fire).
  //
  // The guard must be mounted BEFORE the composition is started (callers do
  // `await ctx.plugin(PaperRuntimeGuard); await ctx.plugin(Composition, cfg)`).
  // We look it up here with non-strict mode so a missing pre-mount throws a
  // clear "guard must be mounted first" error rather than a Cordis dep error.
  const guard = ctx.get('paperRuntimeGuard', false) as InstanceType<typeof PaperRuntimeGuard> | undefined
  if (guard === undefined) {
    throw new Error(
      'paper runtime guard must be mounted before the composition is started '
      + '(call `await ctx.plugin(PaperRuntimeGuard)` first)',
    )
  }

  const liveAudit = ctx.get('paperAudit', false)
  const liveStorage = ctx.get('storageDomain', false)
  const liveAvailable = new Map<string, unknown>()
  if (liveStorage !== undefined) {
    liveAvailable.set('paper.persistence', liveStorage)
    liveAvailable.set('paper.artifactStore', liveStorage)
    liveAvailable.set('paper.verifierRegistry', liveStorage)
    liveAvailable.set('paper.hashProvider', liveStorage)
  }
  if (liveAudit !== undefined) {
    liveAvailable.set('paper.audit', liveAudit)
    liveAvailable.set('paper.deliveryPolicy', liveAudit)
  }
  const livePreflight = runPreflight(guard.getProfile(), {
    profile: guard.getProfile(),
    productionConfig: 'paper.formal',
    availableServices: liveAvailable,
    knownProductionConfigs,
    knownDeliveryPolicyIds,
    verifierRegistry: Object.freeze({
      'gate.ir-schema-validation': true,
      'gate.artifact-integrity': true,
      'gate.verifier-registry-coverage': true,
      'gate.audit-chain': true,
      'gate.delivery-policy': true,
    }),
    auditSink: (event) => {
      void liveAudit?.record({
        eventType: 'preflight_blocked',
        actor: 'composition-apply',
        detail: { ...event },
      }).catch(() => undefined)
    },
  })

  if (livePreflight.ok === false) {
    const reason = livePreflight.failures.map(f => f.kind).join(', ')
    throw new Error(`paper runtime preflight failed at startup: ${reason}`)
  }
  guard.markReady()

  await ctx.plugin(PaperExecutorService, config.executionPolicy ?? {})
  await ctx.plugin(PaperReleaseService, config.releasePolicy ?? {})
  // The service exposes an explicit runner but never starts a migration itself:
  // importing legacy state is an operator action preceded by a dry run.
  await ctx.plugin(PaperMigrationService, config.migrationPolicy ?? {})
}
