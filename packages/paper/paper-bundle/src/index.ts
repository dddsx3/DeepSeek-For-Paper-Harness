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
 * Refuse to mount the Paper layer when the composition cannot carry it.
 * TASK -1 rewire: warn-and-continue is forbidden in a FORMAL profile. The
 * layer is now an all-or-nothing seam — a profile that stacks this layer
 * over a storage-less mode must either add the storage rows in its own
 * patch or pick an `EXPLORATORY` profile that does not require the full
 * preflight surface.
 * @param ctx - plugin context for this bundle layer.
 */
export function apply(ctx: Context): void {
  const missing = missingPaperServices(ctx)
  if (missing.length === 0) return
  throw new Error(
    `paper-bundle: profile does not carry required services: ${missing.join(', ')}; `
    + 'paper rows cannot be activated. (TASK -1 rewire: warn-and-continue is forbidden in FORMAL)',
  )
}
