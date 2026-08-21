/** Minimal, cancellable connectivity diagnostics over the shared LLM service. */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  LlmError,
  type LlmFailure,
} from '@deepseek-ai/dsh-llm'

/** Request for one bounded provider probe. */
export interface DiagnosticsRequest {
  readonly provider: string
  readonly model: string
  readonly timeoutMs: number
}

/** Stable result returned to settings and health consumers. */
export interface DiagnosticsResult {
  readonly ok: boolean
  readonly provider: string
  readonly model: string
  readonly latencyMs: number
  readonly code: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessDiagnostics: HarnessDiagnosticsService
  }
}

/** LLM service wrapper for bounded, non-session diagnostics. */
export class HarnessDiagnosticsService extends Service {
  static inject = ['llm']

  /**
   * @param ctx - Context carrying the shared LLM runtime.
   */
  constructor(ctx: Context) {
    super(ctx, 'harnessDiagnostics')
  }

  /**
   * Execute one short request without creating a Session or persisting content.
   * @param request - provider route, model, and timeout policy.
   * @returns status and non-sensitive timing/error facts.
   */
  async probe(request: DiagnosticsRequest): Promise<DiagnosticsResult> {
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
      throw new TypeError('diagnostics timeoutMs must be a positive safe integer')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, request.timeoutMs)
    const started = Date.now()
    try {
      const options = {
        provider: request.provider,
        model: request.model,
        messages: [createUserMessage({
          content: [{ type: 'text' as const, text: 'Return the single word OK.' }],
          source: { kind: 'user' as const },
        })],
        maxTokens: 4,
        signal: controller.signal,
      }
      for await (const chunk of this.ctx.llm.stream(options)) {
        if (chunk.type !== 'finish') continue
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
          return this.failureResult(request, started, chunk.reason.failure)
        }
        return {
          ok: true,
          provider: request.provider,
          model: request.model,
          latencyMs: Math.max(0, Date.now() - started),
          code: 'OK',
        }
      }
      return this.failureResult(request, started, {
        code: controller.signal.aborted ? 'ABORTED' : 'INCOMPLETE_RESPONSE',
        message: controller.signal.aborted
          ? 'diagnostics request timed out or was cancelled'
          : 'provider returned no terminal result',
      })
    } catch (error: unknown) {
      return this.failureResult(request, started, normalizeFailure(error, controller.signal))
    } finally {
      clearTimeout(timer)
    }
  }

  private failureResult(
    request: DiagnosticsRequest,
    started: number,
    failure: LlmFailure,
  ): DiagnosticsResult {
    return {
      ok: false,
      provider: request.provider,
      model: request.model,
      latencyMs: Math.max(0, Date.now() - started),
      code: failure.code,
    }
  }
}

export default HarnessDiagnosticsService

function normalizeFailure(error: unknown, signal: AbortSignal): LlmFailure {
  if (error instanceof LlmError) return error.failure
  return {
    code: signal.aborted ? 'ABORTED' : 'DIAGNOSTICS_FAILED',
    message: signal.aborted ? 'diagnostics request timed out or was cancelled' : 'diagnostics request failed',
  }
}
