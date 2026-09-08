// Debug: replicate the server's EXACT module state
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url)) // scripts/
const serverHere = resolve(here, '../apps/cockpit')
const shellRoot = resolve(serverHere, '../paper-shell')
const persistBase = resolve(shellRoot, 'src')
console.log('persistBase:', persistBase, 'exists:', existsSync(persistBase))
const dirs = readdirSync(persistBase).filter(n => n.startsWith('paper-shell-persist-'))
console.log('dirs:', dirs.length)
let withWorkflow = 0
for (const name of dirs) {
  const p = resolve(persistBase, name, 'paper_workflow.json')
  if (existsSync(p)) {
    withWorkflow += 1
    const doc = JSON.parse(readFileSync(p, 'utf8'))
    const runCount = Object.keys(doc.tables?.runs ?? {}).length
    if (runCount > 0) console.log(name, 'runs:', runCount)
  }
}
console.log('dirs with paper_workflow.json:', withWorkflow)
