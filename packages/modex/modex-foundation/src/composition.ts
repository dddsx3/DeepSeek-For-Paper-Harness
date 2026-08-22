/** Cordis composition for the phase-two Harness foundation services. */

import type { Context } from '@deepseek-ai/cordis'
import HarnessDiagnosticsService from './diagnostics.ts'
import HarnessFoundationService from './index.ts'
import HarnessProviderService from './provider.ts'
import HarnessSettingsService from './settings.ts'
import WorkflowEngineService from './workflow.ts'
import HarnessExecutorService from './executor-service.ts'
import HarnessAuditService from './audit.ts'
import type { ExecutorConfig } from './executor-service.ts'
import type { AuditConfig } from './audit.ts'
import type { HarnessSettings } from './spec.ts'

/** Cordis plugin name for the complete phase-two service set. */
export const name = 'harness-foundation-composition'
/** The composition needs the shared model and storage services. */
export const inject = ['llm', 'storageDomain']

/** Composition config: role settings plus the audit and execution policies. */
export interface CompositionConfig extends HarnessSettings {
  /** Audit retention policy; omitted uses the service default. */
  readonly auditPolicy?: AuditConfig
  /** Budget, backoff, and pricing policy; omitted uses the service defaults. */
  readonly executionPolicy?: ExecutorConfig
}

/**
 * Install the phase-two Harness services in one dependency-ordered composition.
 * The audit trail mounts before the executor so every run is recorded from its
 * first event.
 * @param ctx - Context carrying the shared LLM and storage-domain services.
 * @param config - Role settings plus optional audit and execution policy.
 */
export async function apply(ctx: Context, config: CompositionConfig): Promise<void> {
  await ctx.plugin(HarnessSettingsService, config)
  await ctx.plugin(HarnessProviderService)
  await ctx.plugin(HarnessDiagnosticsService)
  await ctx.plugin(HarnessFoundationService)
  await ctx.plugin(WorkflowEngineService)
  await ctx.plugin(HarnessAuditService, config.auditPolicy ?? {})
  await ctx.plugin(HarnessExecutorService, config.executionPolicy ?? {})
}
