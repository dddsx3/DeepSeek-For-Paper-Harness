/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-harness`.
 *
 * @module @deepseek-ai/dsh-harness/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-harness'

/** Cordis companion plugin name. */
export const name = 'harness-bundle-invariant'
/** The invariant registry must be mounted before this companion. */
export const inject = ['invariants']

// No runtime invariant: the package is a patch-list carrier plus one load-time
// diagnostic. It mounts no service, emits no events, and owns no mutable
// relation to check; each inserted row's own package carries that row's
// invariants (the Harness domains are checked by dsh-harness-foundation).
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
