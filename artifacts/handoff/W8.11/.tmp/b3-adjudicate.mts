// W8.11-B3 — 用真实落盘的数据裁决 B3 正向剩余失败的性质。
// 判据**预先写死**（任务书 §B3）：相似度 ≥0.99 且首分歧为单字符/空白类 → 近失；
// <0.99 或分歧点为实词替换/语序 → 真改写。
import { readFileSync } from 'node:fs'
import { foldForAnchorMatch, diagnoseSpanMismatch } from '../../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'

const dir = 'apps/paper-shell/src/paper-shell-persist-bRWlDt/'
const bodies = Object.values((JSON.parse(readFileSync(dir + 'paper_artifact_body.json', 'utf8')) as {
  tables: { bodies: Record<string, { artifactId: string; text: string }> }
}).tables.bodies)

const e1 = bodies.find(b => b.artifactId.endsWith(':E1Analysis'))!.text
const c3 = bodies.find(b => b.artifactId.endsWith(':E2Normalization-attempt3'))!.text
console.log('E1 chars:', e1.length, '| container3 chars:', c3.length)

const container = JSON.parse(c3) as { entries: Array<{ kind: string; value: Record<string, unknown> }> }
const anchored = container.entries.filter(e => e.kind === 'AssumptionSpec' || e.kind === 'EquationSpec')
console.log('checked entries:', anchored.length)

// apply the SAME fold the checker uses
const foldedE1 = foldForAnchorMatch(e1)
let exact = 0, foldOk = 0, missing = 0
const fails: Array<{ id: string; span: string; sim: string; firstDiff: string }> = []
for (const e of anchored) {
  const id = String(e.value['assumption_id'] ?? e.value['equation_id'] ?? '?')
  const span = e.value['e1_span']
  if (typeof span !== 'string' || span.trim().length === 0) { missing += 1; fails.push({ id, span: '(未声明)', sim: '-', firstDiff: '-' }); continue }
  if (e1.includes(span.trim())) { exact += 1; continue }
  if (foldedE1.includes(foldForAnchorMatch(span))) { foldOk += 1; continue }
  fails.push({ id, span: span.slice(0, 70), sim: '', firstDiff: '' })
}
console.log()
console.log('=== attempt 3 (the terminal attempt) ===')
console.log('exact            :', exact)
console.log('folded-only match:', foldOk)
console.log('missing e1_span  :', missing)
console.log('still failing    :', fails.length)
console.log()
for (const f of fails) {
  const diag = f.span === '(未声明)' ? '-' : diagnoseSpanMismatch(f.span, e1)
  console.log(`${f.id}: ${diag}`)
  console.log(`   span: ${JSON.stringify(f.span)}`)
}
