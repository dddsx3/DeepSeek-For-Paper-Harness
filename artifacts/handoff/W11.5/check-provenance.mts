import { checkCodeProvenance, SHELL_PROVENANCE_TARGETS } from '../../../apps/paper-shell/src/code-provenance.ts'
import { resolve } from 'node:path'

const targets = SHELL_PROVENANCE_TARGETS.map(t => ({ ...t, dir: resolve(t.dir) }))
const r = checkCodeProvenance(targets)
console.log('ok =', r.ok)
if (!r.ok) console.log(JSON.stringify(r.problems, null, 2))
