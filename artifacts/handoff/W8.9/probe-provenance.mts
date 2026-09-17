import { checkCodeProvenance, SHELL_PROVENANCE_TARGETS } from '../../../apps/paper-shell/src/code-provenance.ts'
import { join } from 'node:path'
const repoRoot = process.cwd()
const targets = SHELL_PROVENANCE_TARGETS.map(t => ({ ...t, dir: join(repoRoot, t.dir) }))
const v = checkCodeProvenance(targets)
console.log('ok =', v.ok)
for (const c of v.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`)
if (!v.ok) console.log('remediation:', v.remediation)
