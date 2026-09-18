// E2 negative control: does checkProvenance actually FAIL on a stale entry?
// Uses a synthetic temp package so no protected repo file is touched.
import { checkProvenance } from '../../../../apps/paper-shell/src/code-provenance.ts'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'dsh-guard-nc-'))
mkdirSync(join(root, 'src', 'deep'), { recursive: true })
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'src', 'deep', 'x.ts'), 'export const a = 1\n')
writeFileSync(join(root, 'lib', 'index.js'), 'export const a = 1\n')

const older = new Date(Date.now() - 60_000)
const newer = new Date()
utimesSync(join(root, 'lib', 'index.js'), older, older)   // entry OLDER than src
utimesSync(join(root, 'src', 'deep', 'x.ts'), newer, newer)

const stale = checkProvenance({ name: 'synthetic-stale', dir: root, entry: 'lib/index.js' })
console.log('CASE 1 (entry older than src) -> ok =', stale.ok, '|', stale.detail)

utimesSync(join(root, 'lib', 'index.js'), newer, newer)   // entry NEWER
const fresh = checkProvenance({ name: 'synthetic-fresh', dir: root, entry: 'lib/index.js' })
console.log('CASE 2 (entry newer than src) -> ok =', fresh.ok, '|', fresh.detail)

const missing = checkProvenance({ name: 'synthetic-missing', dir: root, entry: 'lib/nope.js' })
console.log('CASE 3 (entry missing)         -> ok =', missing.ok, '|', missing.detail)
