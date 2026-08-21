/** Cordis service exposing the workflow executor. */

import { Context, Service } from '@deepseek-ai/cordis'
import { WorkflowExecutor } from './executor.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessExecutor: HarnessExecutorService
  }
}

/** Lifecycle owner of the node executor over the durable engine. */
export class HarnessExecutorService extends Service {
  static inject = ['harnessWorkflow', 'harnessProvider', 'harnessSettings']

  private executor: WorkflowExecutor | undefined

  /** @param ctx - Context carrying the engine, provider, and settings services. */
  constructor(ctx: Context) {
    super(ctx, 'harnessExecutor')
  }

  /** Build the executor from the composed services. */
  protected [Service.init](): void {
    this.executor = new WorkflowExecutor(
      this.ctx.harnessWorkflow.runs,
      this.ctx.harnessProvider,
      this.ctx.harnessSettings,
    )
  }

  /** @returns the initialized workflow executor. */
  get runs(): WorkflowExecutor {
    if (this.executor === undefined) throw new Error('harness executor is not initialized')
    return this.executor
  }
}

export default HarnessExecutorService
