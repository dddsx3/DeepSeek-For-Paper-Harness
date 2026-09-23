// 一次性小工具：用 harness 自己的判据检查一份候选容器（检查点人工核查用）。
import { readFileSync } from 'node:fs'
import { checkCandidateContainer } from '../packages/paper/paper-foundation/src/produce/self-check.ts'

const [containerPath, e1Path] = process.argv.slice(2)
if (containerPath === undefined) { console.error('usage: tsx scripts/.check-container.mts <container.json> [e1.txt]'); process.exit(2) }
const containerText = readFileSync(containerPath, 'utf8')
const e1Text = e1Path === undefined ? undefined : readFileSync(e1Path, 'utf8')
const v = checkCandidateContainer(containerText, {
  scopeRefs: ['P1', 'P2', 'P3', 'P4'],
  ...(e1Text === undefined ? {} : { e1Text }),
  requiredOutputIds: ['R-Q1', 'R-Q2', 'R-Q3', 'R-Q4'],
})
console.log('admissible:', v.admissible)
console.log('summary:', v.summary)
console.log('problems:')
for (const p of v.problems) console.log('  -', p)
console.log('notChecked:')
for (const n of v.notChecked) console.log('  ·', n)
const parsed = JSON.parse(containerText)
console.log('--- 结构 ---')
console.log('entries:', Array.isArray(parsed.entries) ? parsed.entries.length : 'MISSING')
const kinds = {}
for (const e of parsed.entries ?? []) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
console.log('kinds:', JSON.stringify(kinds))
console.log('has code:', typeof parsed.code === 'string', '| code chars:', parsed.code?.length ?? 0)
console.log('run.outputBasenames:', JSON.stringify(parsed.run?.outputBasenames ?? null), '| seed:', parsed.run?.seed ?? null)
console.log('interpretations.results:', parsed.interpretations?.results?.length ?? 0)
console.log('interpretations.figures:', parsed.interpretations?.figures?.length ?? 0)
console.log('narrative keys:', Object.keys(parsed.narrative ?? {}).join(', '))
