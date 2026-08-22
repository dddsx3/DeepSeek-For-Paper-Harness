/**
 * Directory links that work on every host the harness builds on.
 *
 * Windows reserves directory symlinks for elevated processes or Developer
 * Mode, so `symlink(..., 'dir')` fails with EPERM on an ordinary developer or
 * CI account. NTFS junctions carry the same reparse semantics for directories
 * — `realpath` resolves through them, so escape checks and module resolution
 * behave identically — and need no privilege. POSIX hosts keep ordinary
 * symlinks.
 *
 * Only directories are covered on purpose: a junction cannot target a file, so
 * a caller that needs a file to resolve elsewhere links its parent directory
 * instead of reaching for an unprivileged file-symlink trick that does not
 * exist on Windows.
 * @module
 */

import { symlink, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const symlinkAsync = promisify(symlink)

/** The directory-link flavor this host can create without elevation. */
const TYPE = process.platform === 'win32' ? 'junction' : 'dir'

/**
 * Link one directory so both paths resolve to the same real directory.
 * @param target - existing directory the link points at.
 * @param path - link to create.
 */
export function linkDirectorySync(target: string, path: string): void {
  symlinkSync(resolve(target), path, TYPE)
}

/**
 * Link one directory so both paths resolve to the same real directory.
 * @param target - existing directory the link points at.
 * @param path - link to create.
 * @returns resolution once the link exists.
 */
export function linkDirectory(target: string, path: string): Promise<void> {
  return symlinkAsync(resolve(target), path, TYPE)
}
