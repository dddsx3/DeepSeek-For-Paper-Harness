// 按**产出链的合并规则**重建 narrative，再跑正文契约——检查点核查用。
// 只复现合并那几行（E1 逐问段 → analysis；E1 框架段 → methods；真实代码 → code），
// 不复现整条链——目的是让"检查点看到的"与"产出链判的"是同一个东西。
import { readFileSync } from 'node:fs'
import { proseContractViolations, substanceViolations } from '../packages/paper/paper-foundation/src/delivery/prose-contracts.ts'
import { frameworkOf, perQuestionSectionsOf } from '../packages/paper/paper-foundation/src/produce/per-question.ts'

const [containerPath, e1Path] = process.argv.slice(2)
// 与 `parseModelContainer` 同款宽容：模型常把容器包在 ```json 围栏里，
// 那是**渲染差异**不是内容违规，harness 会剥一层。核查脚本必须同样剥，
// 否则"我的检查器说不可解析"与"harness 说可以"会打架（第一次就撞上了）。
const raw = readFileSync(containerPath as string, 'utf8')
const NLCH = String.fromCharCode(10)
const unfenced = raw.trim()
  .replace(new RegExp('^```[a-zA-Z]*' + NLCH + '?'), '')
  .replace(new RegExp(NLCH + '?```$'), '')
const parsed = JSON.parse(unfenced)
const e1 = readFileSync(e1Path as string, 'utf8')
const reqs = ['R-Q1', 'R-Q2', 'R-Q3', 'R-Q4'].map(id => ({ requirementId: id, statement: '（略）' }))
const narrative: Record<string, unknown> = { ...(parsed.narrative ?? {}) }
const NL = String.fromCharCode(10)
const perQ = perQuestionSectionsOf(e1, reqs)
if (perQ.length > 0) {
  const own = typeof narrative['analysis'] === 'string' ? (narrative['analysis'] as string).trim() : ''
  narrative['analysis'] = [perQ.join(NL + NL), ...(own === '' ? [] : ['', '### 逐问归因（模型自述）', '', own])].join(NL)
}
const fw = frameworkOf(e1)
if (fw !== '') {
  const own = typeof narrative['methods'] === 'string' ? (narrative['methods'] as string).trim() : ''
  narrative['methods'] = [fw, ...(own === '' ? [] : ['', own])].join(NL + NL)
}
const code = typeof parsed.code === 'string' ? parsed.code.trim() : ''
if (code !== '') {
  const note = typeof narrative['code'] === 'string' ? (narrative['code'] as string).trim() : ''
  narrative['code'] = [...(note === '' ? [] : [note, '']), '```javascript', code, '```'].join(NL)
}
console.log('=== 合并后各章字数（vs 地板）===')
const FLOOR: Record<string, number> = { analysis: 1200, evaluation: 800, references: 600, code: 600, restatement: 200, methods: 0 }
for (const k of Object.keys(FLOOR)) {
  const n = String(narrative[k] ?? '').replace(/\s+/g, '').length
  const f = FLOOR[k]
  console.log(`  ${k.padEnd(13)} ${String(n).padStart(6)}  ${f > 0 ? `地板 ${String(f)} → ${n >= f ? 'PASS' : 'FAIL'}` : '(无地板)'}`)
}
console.log()
console.log('=== 合并后正文契约（产出链真正会跑的判据）===')
const v = [...proseContractViolations(narrative, reqs), ...substanceViolations(narrative, reqs)]
if (v.length === 0) console.log('  零违规 → 产出链的 prose_contract 会**放行**')
for (const x of v) console.log(`  [${x.chapter}] ${x.title}: ${x.reason}`)
