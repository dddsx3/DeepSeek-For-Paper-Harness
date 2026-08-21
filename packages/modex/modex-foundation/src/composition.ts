/** Cordis composition for the phase-two Harness foundation services. */

import type { Context } from '@deepseek-ai/cordis'
import HarnessDiagnosticsService from './diagnostics.ts'
import HarnessFoundationService from './index.ts'
import HarnessProviderService from './provider.ts'
import HarnessSettingsService from './settings.ts'
import WorkflowEngineService from './workflow.ts'
import type { HarnessSettings } from './spec.ts'

/** Cordis plugin name for the complete phase-two service set. */
export const name = 'harness-foundation-composition'
/** The composition needs the shared model and storage services. */
export const inject = ['llm', 'storageDomain']

/**
 * Install the phase-two Harness services in one dependency-ordered composition.
 * @param ctx - Context carrying the shared LLM and storage-domain services.
 * @param config - Composition defaults for the role settings namespace.
 */
export async function apply(ctx: Context, config: HarnessSettings): Promise<void> {
  await ctx.plugin(HarnessSettingsService, config)
  await ctx.plugin(HarnessProviderService)
  await ctx.plugin(HarnessDiagnosticsService)
  await ctx.plugin(HarnessFoundationService)
  await ctx.plugin(WorkflowEngineService)
}
