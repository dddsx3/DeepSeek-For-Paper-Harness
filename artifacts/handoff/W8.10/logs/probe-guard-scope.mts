// E2 scope check: apply the guard's OWN rule to every workspace package the
// paper-shell CLI loads through package exports, not just the one target.
import { checkProvenance, SHELL_PROVENANCE_TARGETS } from '../../../../apps/paper-shell/src/code-provenance.ts'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'

const repoRoot = process.cwd()
const req = createRequire(join(repoRoot, 'apps', 'paper-shell', 'cli-probe.cjs'))
const deps = ['@deepseek-ai/cordis','@deepseek-ai/dsh-storage','@deepseek-ai/dsh-storage-json','@deepseek-ai/dsh-storage-domain','@deepseek-ai/dsh-paper-foundation','@deepseek-ai/dsh-llm']

console.log('declared guard targets:', SHELL_PROVENANCE_TARGETS.map(t => t.name).join(', '))
console.log('')
for (const d of deps) {
  let pkgPath
  try { pkgPath = req.resolve(`${d}/package.json`) } catch { console.log(`${d}: NOT RESOLVABLE`); continue }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const dir = dirname(pkgPath)
  const exp = pkg.exports?.['.'] ?? pkg.exports
  const entry = typeof exp === 'string' ? exp : exp?.import ?? exp?.default
  const covered = SHELL_PROVENANCE_TARGETS.some(t => t.name === d)
  if (!entry) { console.log(`${d}: no '.' export (entry unresolved)  covered=${covered}`); continue }
  const rel = entry.replace(/^\.\//, '')
  const r = checkProvenance({ name: d, dir, entry: rel })
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${d.padEnd(38)} covered=${String(covered).padEnd(5)} ${r.detail}`)
}
