/** Harness phase-two foundation: durable run storage and bounded diagnostics. */

import { Context, Service } from '@deepseek-ai/cordis'
import { DomainWorkflowRunRepository } from './store.ts'
import { workflowRunDomainSpec } from './spec.ts'

export * from './spec.ts'
export * from './store.ts'
export * from './diagnostics.ts'
export * from './settings.ts'
export * from './provider.ts'
export * from './state-machine.ts'
export * from './workflow.ts'

/** Cordis plugin name. */
export const name = 'harness-foundation'

/** Services required before the foundation can initialize. */
export const inject = ['storageDomain']

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessFoundation: HarnessFoundationService
  }
}

/** Owns the phase-two workflow domain and exposes its repository. */
export class HarnessFoundationService extends Service {
  static inject = ['storageDomain']

  private repository: DomainWorkflowRunRepository | undefined

  /**
   * @param ctx - Context carrying the shared storage-domain facility.
   */
  constructor(ctx: Context) {
    super(ctx, 'harnessFoundation')
  }

  /** Open the versioned domain and close it with the service lifecycle. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workflowRunDomainSpec)
    const repository = new DomainWorkflowRunRepository(domain)
    this.repository = repository
    this.ctx.effect(() => async () => {
      this.repository = undefined
      await repository.close()
    }, 'harness-foundation.close')
  }

  /**
   * Return the initialized run repository.
   * @returns the repository owned by this service.
   */
  get runs(): DomainWorkflowRunRepository {
    if (this.repository === undefined) {
      throw new Error('harness foundation is not initialized')
    }
    return this.repository
  }
}

export default HarnessFoundationService
