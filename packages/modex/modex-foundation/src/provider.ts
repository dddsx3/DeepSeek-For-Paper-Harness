/** Role-based access to the harness LLM runtime. */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  GenerateOptions,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { HarnessSettings, ProviderRoute } from './spec.ts'

/** Workflow role that owns one provider route. */
export type HarnessRole = 'executor' | 'reviewer' | 'editorAi'

/** A route resolved from one immutable settings snapshot. */
export interface ResolvedRoleRoute extends ProviderRoute {
  readonly role: HarnessRole
}

/** Shared LLM seam used by workflow consumers. */
export class HarnessProviderService extends Service {
  static inject = ['llm']

  /**
   * @param ctx - Context carrying the shared LLM runtime.
   */
  constructor(ctx: Context) {
    super(ctx, 'harnessProvider')
  }

  /**
   * Resolve one role's model metadata without retaining mutable settings.
   * @param role - workflow role to resolve.
   * @param settings - detached settings snapshot.
   * @param signal - optional cancellation for model metadata lookup.
   * @returns route identity and adapter-owned model metadata.
   */
  async resolveRole(
    role: HarnessRole,
    settings: HarnessSettings,
    signal?: AbortSignal,
  ): Promise<{ route: ResolvedRoleRoute; model: LlmResolvedModelInfo }> {
    const route = this.routeOf(role, settings)
    const model = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)
    return { route, model }
  }

  /**
   * Dispatch one already assembled request through the shared runtime.
   * @param options - provider-neutral request assembled by a workflow consumer.
   * @returns the provider-neutral stream.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.ctx.llm.stream(options)
  }

  private routeOf(role: HarnessRole, settings: HarnessSettings): ResolvedRoleRoute {
    const route = settings[role]
    return { role, ...route }
  }
}

export default HarnessProviderService
