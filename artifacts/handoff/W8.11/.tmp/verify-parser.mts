import { readFileSync } from 'node:fs'
import { parseE1Anchors, isUsableAnchorId } from '../../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'

const bodies = Object.values((JSON.parse(readFileSync('apps/paper-shell/src/papershell-persist-bRWlDt/paper_artifact_body.json'.replace('papershell','paper-shell'), 'utf8')) as {
  tables: { bodies: Record<string, { artifactId: string; text: string }> }
}).tables.bodies)
const e1 = bodies.find(b => b.artifactId.endsWith(':E1Analysis'))!.text

const anchors = parseE1Anchors(e1)
console.log('assumption anchors:', anchors.assumptions.length)
console.log('requirement anchors:', anchors.requirements.length)
const bad = [...anchors.assumptions, ...anchors.requirements].filter(a => !isUsableAnchorId(a.id))
console.log('non-name anchors (B5 would fire):', bad.length, JSON.stringify(bad.map(b => b.id)))
console.log()
console.log('=== before the fix, the raw indexOf scan found: ===')
const raw: string[] = []
const re = /\[\[ASSUMPTION:\s*([^\]]*)\]\]/g
let m
while ((m = re.exec(e1)) !== null) raw.push(m[1]!.trim())
console.log('raw occurrences:', raw.length, '| of which non-name:', raw.filter(x => !isUsableAnchorId(x)).length)
