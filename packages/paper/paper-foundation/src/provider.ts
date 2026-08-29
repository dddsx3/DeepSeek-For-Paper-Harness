/** Role-based access to the harness LLM runtime. */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  GenerateOptions,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { PaperSettings, ProviderRoute } from './spec.ts'

/** Workflow role that owns one provider route. */
export type PaperRole = 'executor' | 'reviewer' | 'editorAi'

/** A route resolved from one immutable settings snapshot. */
export interface ResolvedRoleRoute extends ProviderRoute {
  readonly role: PaperRole
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperProvider: PaperProviderService
  }
}

/** Shared LLM seam used by workflow consumers. */
export class PaperProviderService extends Service {
  static inject = ['llm']

  /**
   * @param ctx - Context carrying the shared LLM runtime.
   */
  constructor(ctx: Context) {
    super(ctx, 'paperProvider')
  }

  /**
   * Resolve one role's model metadata without retaining mutable settings.
   * @param role - workflow role to resolve.
   * @param settings - detached settings snapshot.
   * @param signal - optional cancellation for model metadata lookup.
   * @returns route identity and adapter-owned model metadata.
   */
  async resolveRole(
    role: PaperRole,
    settings: PaperSettings,
    signal?: AbortSignal,
  ): Promise<{ route: ResolvedRoleRoute; model: LlmResolvedModelInfo }> {
    const route = this.routeOf(role, settings)
    const model = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)
    return { route, model }
  }

  /**
   * Dispatch one already assembled request through the shared runtime.
   * Every call goes through `PaperRuntimeGuard.invokeCapability` so the
   * `MODEL` stage capability firewall can veto it; bypassing the guard
   * (calling `ctx.llm.stream` directly) is the explicit red-team path A-010.
   * @param options - provider-neutral request assembled by a workflow consumer.
   * @returns the provider-neutral stream.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const guard = this.ctx.get('paperRuntimeGuard')
    if (guard === undefined) {
      throw new Error('paper runtime guard is not available')
    }
    return guard.invokeCapability<AsyncIterable<StreamChunk>>(
      { stage: 'MODEL', capability: 'llm' },
      { fn: () => this.ctx.llm.stream(options) },
    )
  }

  private routeOf(role: PaperRole, settings: PaperSettings): ResolvedRoleRoute {
    const route = settings[role]
    return { role, ...route }
  }
}

export default PaperProviderService
