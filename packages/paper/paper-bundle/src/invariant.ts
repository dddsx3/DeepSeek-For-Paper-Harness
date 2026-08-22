/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-paper`.
 *
 * @module @deepseek-ai/dsh-paper/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-paper'

/** Cordis companion plugin name. */
export const name = 'paper-bundle-invariant'
/** The invariant registry must be mounted before this companion. */
export const inject = ['invariants']

// No runtime invariant: the package is a patch-list carrier plus one load-time
// diagnostic. It mounts no service, emits no events, and owns no mutable
// relation to check; each inserted row's own package carries that row's
// invariants (the Paper domains are checked by dsh-paper-foundation).
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
