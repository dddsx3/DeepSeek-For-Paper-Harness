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
import type { ExecutorConfig } from './executor-service.ts'
import type { AuditConfig } from './audit.ts'
import type { ReleaseConfig } from './release-service.ts'
import type { MigrationConfig } from './migration.ts'
import type { PaperSettings } from './spec.ts'

/** Cordis plugin name for the complete phase-two service set. */
export const name = 'paper-foundation-composition'
/** The composition needs the shared model and storage services. */
export const inject = ['llm', 'storageDomain']

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
 * @param ctx - Context carrying the shared LLM and storage-domain services.
 * @param config - Role settings plus optional audit and execution policy.
 */
export async function apply(ctx: Context, config: CompositionConfig): Promise<void> {
  await ctx.plugin(PaperSettingsService, config)
  await ctx.plugin(PaperProviderService)
  await ctx.plugin(PaperDiagnosticsService)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  await ctx.plugin(PaperAuditService, config.auditPolicy ?? {})
  await ctx.plugin(PaperExecutorService, config.executionPolicy ?? {})
  await ctx.plugin(PaperReleaseService, config.releasePolicy ?? {})
  // The service exposes an explicit runner but never starts a migration itself:
  // importing legacy state is an operator action preceded by a dry run.
  await ctx.plugin(PaperMigrationService, config.migrationPolicy ?? {})
}
