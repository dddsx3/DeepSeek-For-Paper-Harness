/**
 * W11.5-A1 诊断（不许先改）—— 用真实保真门函数离线重放 run-2 的三次 E2 尝试。
 *
 * 数据源（全部为 run-2 真实运行落盘物，非转述）：
 *   apps/paper-shell/src/paper-shell-persist-A9n08A/paper_artifact_body.json
 *     - <node>:E1Analysis              → E1 全文
 *     - <node>:E2Normalization-attempt{1,2,3} → 三次容器全文
 * 判定：调用生产代码 `checkE1E2Fidelity`（与 executor 同一函数，N3）。
 *
 * 运行：npx tsx artifacts/handoff/W11.5/diagnose-b3-reverse.mts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkE1E2Fidelity, parseE1Anchors } from '../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'
import type { DeclaredEntry } from '../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'

const OUT = new URL('.', import.meta.url)
mkdirSync(OUT, { recursive: true })

const PERSIST_DIR = process.env.W11_5_PERSIST ?? '../../../apps/paper-shell/src/paper-shell-persist-A9n08A'
const PERSIST = new URL(`${PERSIST_DIR}/paper_artifact_body.json`, import.meta.url)
const store = JSON.parse(readFileSync(fileURLToPath(PERSIST), 'utf8')) as {
  tables: { bodies: Record<string, { text: string }> }
}
const bodies = store.tables.bodies
const nodePrefix = Object.keys(bodies).find(k => k.endsWith(':E1Analysis'))?.split(':')[0] ?? ''
const e1Text = bodies[`${nodePrefix}:E1Analysis`]?.text ?? ''
if (e1Text === '') throw new Error('E1 body not found')

/** Extract the container JSON object out of a raw model answer. */
function parseContainer(raw: string): { entries: DeclaredEntry[]; code?: string; run?: Record<string, unknown>; interpretations?: unknown } {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object found')
  // The answer may wrap the object in prose; the model is told to emit pure
  // JSON, so the outermost braces bound the payload.
  const obj = JSON.parse(raw.slice(start, end + 1)) as {
    entries?: DeclaredEntry[]
    code?: string
    run?: Record<string, unknown>
    interpretations?: unknown
  }
  return { entries: obj.entries ?? [], code: obj.code, run: obj.run, interpretations: obj.interpretations }
}

const anchors = parseE1Anchors(e1Text)
const requiredOutputIds = ['R-OUT'] // the run registered exactly one REQUIRED_OUTPUT

console.log('=== E1 ===')
console.log(`chars=${e1Text.length} assumption anchors=${anchors.assumptions.length} requirement anchors=${anchors.requirements.length}`)
console.log('assumption ids:', anchors.assumptions.map(a => a.id).join(', '))
console.log('requirement ids:', anchors.requirements.map(a => a.id).join(', '))

const report: Record<string, unknown> = {
  e1_chars: e1Text.length,
  e1_assumption_anchors: anchors.assumptions.map(a => a.id),
  e1_requirement_anchors: anchors.requirements.map(a => a.id),
  attempts: {},
}

for (const attempt of [1, 2, 3]) {
  const key = `${nodePrefix}:E2Normalization-attempt${attempt}`
  const raw = bodies[key]?.text
  if (raw === undefined) { console.log(`=== attempt ${attempt}: MISSING`); continue }
  console.log(`\n=== attempt ${attempt} (${raw.length} chars) ===`)
  let parsed: ReturnType<typeof parseContainer>
  try {
    parsed = parseContainer(raw)
  } catch (error) {
    console.log('  parse failed:', (error as Error).message)
    ;(report['attempts'] as Record<string, unknown>)[String(attempt)] = { parse_failed: (error as Error).message }
    continue
  }
  const kinds: Record<string, number> = {}
  for (const entry of parsed.entries) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1
  console.log('  entries:', JSON.stringify(kinds))
  if (parsed.code !== undefined) console.log('  code chars:', parsed.code.length)
  if (parsed.interpretations !== undefined) console.log('  interpretations present:', JSON.stringify(parsed.interpretations).length, 'chars')

  const findings = checkE1E2Fidelity({
    e1Text,
    entries: parsed.entries,
    requiredOutputIds,
  })
  for (const f of findings) {
    console.log(`  [${f.ok ? 'PASS' : 'FAIL'}] ${f.rule}: ${f.detail.slice(0, 220)}`)
  }
  ;(report['attempts'] as Record<string, unknown>)[String(attempt)] = {
    chars: raw.length,
    kinds,
    has_code: parsed.code !== undefined,
    has_interpretations: parsed.interpretations !== undefined,
    findings: findings.map(f => ({ rule: f.rule, ok: f.ok, detail: f.detail })),
  }
}

writeFileSync(new URL('./a1-diagnosis.json', OUT), JSON.stringify(report, null, 2))
console.log('\nwritten a1-diagnosis.json')
