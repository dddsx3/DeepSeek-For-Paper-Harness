/**
 * `@deepseek-ai/dsh-paper` — the Paper profile patch layer. The bundle's
 * substance is `cordis.patch.yml`; this module is the plugin the patch layer
 * needs to be an ordinary workspace member, and it states the one requirement
 * the patch cannot enforce by composition alone.
 *
 * @module @deepseek-ai/dsh-paper
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'paper-bundle'

/** Services the Paper layer cannot work without. */
export const PAPER_REQUIRED_SERVICES = ['storage', 'storageDomain', 'llm'] as const

/** One service the layer needs that the composition does not carry. */
export type MissingPaperService = typeof PAPER_REQUIRED_SERVICES[number]

/**
 * Which required services this composition is missing.
 *
 * The Paper rows pend on their injections, so a profile that stacks this layer
 * over a storage-less mode mounts them and never activates them. Naming the
 * gap turns that silence into a diagnostic a profile author can act on.
 * @param ctx - context whose composition to inspect.
 * @returns the missing service names, empty when the layer can activate.
 */
export function missingPaperServices(ctx: Context): MissingPaperService[] {
  return PAPER_REQUIRED_SERVICES.filter(service => ctx.get(service) === undefined)
}

/**
 * Report an incomplete composition once at load. The layer still mounts: the
 * services may arrive from a later patch row, and Cordis activates the Paper
 * rows when they do.
 * @param ctx - plugin context for this bundle layer.
 */
export function apply(ctx: Context): void {
  const missing = missingPaperServices(ctx)
  if (missing.length === 0) return
  ctx.logger.warn(
    `paper-bundle: this profile does not carry ${missing.join(', ')}; `
    + 'the Paper rows stay inactive until a patch row provides them',
  )
}
