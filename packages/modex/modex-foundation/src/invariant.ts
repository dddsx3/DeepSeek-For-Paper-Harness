/** Runtime invariant companion for the Harness workflow-run domain. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { workflowRunDomainSpec } from './spec.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-harness-foundation'

/** Cordis companion plugin name. */
export const name = 'harness-foundation-invariant'
/** The invariant registry must be mounted before this companion. */
export const inject = ['invariants']

const install: InvariantInstaller = (ctx: Context, fail: (message: string) => never) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== workflowRunDomainSpec.name) return
    if (!Object.hasOwn(workflowRunDomainSpec.tables, change.table)) {
      fail(`Harness domain emitted a change for undeclared table '${change.table}'`)
    }
    if (change.operation === 'put') {
      const table = workflowRunDomainSpec.tables[change.table as keyof typeof workflowRunDomainSpec.tables]
      const parsed = table.valueSchema.safeParse(change.value)
      if (!parsed.success) {
        fail(`Harness domain table '${change.table}' emitted a value that fails its durable schema`)
      }
    }
  })
}

/**
 * Register the package-owned invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
