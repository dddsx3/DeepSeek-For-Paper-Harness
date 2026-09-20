/**
 * W11.5 诊断器 —— 把一次真实运行的 E2 尝试**离线重放整条接收链**，逐次给出
 * 精确拒绝点（阶段 + code + reason）。
 *
 * 与 `diagnose-b3-reverse.mts` 的分工：那个只跑保真门（判定 E1↔容器），本脚本
 * 跑**容器接收 → 真实执行 → interpretation 铸造**的完整链——因为修掉保真问题后，
 * 拒绝点会移到下游（run-1 的 attempt 2 就是 `schema_violation`）。
 *
 * 用法：W11_5_PERSIST=../../../apps/paper-shell/src/paper-shell-persist-XXXX \
 *        npx tsx artifacts/handoff/W11.5/diagnose-attempts.mts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ModelingIr, sha256Hex } from '../../../packages/paper/paper-foundation/src/ir/index.ts'
import { produceContainerInto } from '../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { normalizeInterpretationLocators } from '../../../packages/paper/paper-foundation/src/executor.ts'
import { checkE1E2Fidelity } from '../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'

const OUT = new URL('.', import.meta.url)
mkdirSync(OUT, { recursive: true })

const PERSIST_DIR = process.env.W11_5_PERSIST ?? '../../../apps/paper-shell/src/paper-shell-persist-A9n08A'
const store = JSON.parse(readFileSync(fileURLToPath(new URL(`${PERSIST_DIR}/paper_artifact_body.json`, import.meta.url)), 'utf8')) as {
  tables: { bodies: Record<string, { text: string }> }
}
const bodies = store.tables.bodies
const e1Key = Object.keys(bodies).find(k => k.endsWith(':E1Analysis')) ?? ''
const task = process.env.W11_5_TASK ?? 'solve the sampling-inspection problem'
const problemHash = `sha256:${sha256Hex(task)}`

interface AttemptResult {
  readonly attempt: number
  readonly chars: number
  readonly stage: string
  readonly code: string
  readonly reason: string
  readonly kindCounts?: Record<string, number>
}

const results: AttemptResult[] = []
for (const attempt of [1, 2, 3]) {
  const key = Object.keys(bodies).find(k => k.endsWith(`E2Normalization-attempt${attempt}`))
  if (key === undefined) continue
  const raw = bodies[key]?.text ?? ''
  const ir = new ModelingIr()
  for (const [kind, value] of [
    ['DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problems/w11.5/task.md', content_hash: problemHash, media_type: 'text/markdown', description: task.slice(0, 512) }],
    ['RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'give the result' }],
    ['ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] }],
  ] as const) {
    ir.put(kind, value as Record<string, unknown>)
  }

  // The executor's REAL order is fidelity → container → run → interpretation.
  // Running the stages out of order makes this instrument report a LATER
  // refusal than the pipeline actually hit (measured: run-5 attempt 3 looked
  // like a full pass here while the real run refused it at the fidelity gate).
  const entries = (() => {
    try {
      const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { entries?: Array<{ kind: string; value: Record<string, unknown> }> }
      return parsed.entries ?? []
    } catch { return [] }
  })()
  const e1Text = bodies[e1Key]?.text ?? ''
  const fidelity = checkE1E2Fidelity({ e1Text, entries, requiredOutputIds: ['R-OUT'] })
  const failed = fidelity.filter(f => !f.ok)
  if (failed.length > 0) {
    results.push({
      attempt,
      chars: raw.length,
      stage: 'fidelity',
      code: 'E1_E2_FIDELITY_VIOLATION',
      reason: failed.map(f => `${f.rule}: ${f.detail}`).join(' | '),
    })
    continue
  }

  const admitted = produceContainerInto(ir, raw)
  if (!admitted.ok) {
    results.push({ attempt, chars: raw.length, stage: 'container', code: admitted.code, reason: admitted.reason })
    continue
  }
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
    run?: Record<string, unknown>
    code?: string
    interpretations?: unknown
    entries: Array<{ kind: string; value: Record<string, unknown> }>
  }
  const kindCounts: Record<string, number> = {}
  for (const entry of parsed.entries) kindCounts[entry.kind] = (kindCounts[entry.kind] ?? 0) + 1
  const basenames = (parsed.run?.outputBasenames as string[] | undefined) ?? []
  const runId = `RUN-ATT${attempt}`
  const modelRef = parsed.entries.find(e => e.kind === 'ModelSpec')?.value['model_id'] as string ?? 'M1'
  const runVerdict = await produceRunExecution({
    ir,
    runId,
    modelRef,
    codeText: parsed.code ?? '',
    environment: 'diag',
    seed: typeof parsed.run?.seed === 'number' ? parsed.run.seed : null,
    outputBasenames: basenames,
    outputLocators: basenames.map(b => `file:///runs/${runId}/${b}`),
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 60_000,
  })
  if (!runVerdict.ok) {
    results.push({ attempt, chars: raw.length, stage: 'run', code: runVerdict.code, reason: runVerdict.reason, kindCounts })
    continue
  }
  if (parsed.interpretations === undefined) {
    results.push({ attempt, chars: raw.length, stage: 'interpretation', code: 'MISSING_INTERPRETATIONS', reason: 'container declares no interpretations block', kindCounts })
    continue
  }
  const norm = normalizeInterpretationLocators(parsed.interpretations as Record<string, unknown>, basenames, runVerdict.outputs.map(o => o.locator))
  if (!norm.ok) {
    results.push({ attempt, chars: raw.length, stage: 'interpretation', code: norm.code, reason: norm.reason, kindCounts })
    continue
  }
  const minted = produceInterpretation({ ir, runId, interpretations: norm.value, outputs: runVerdict.outputs.map(o => ({ locator: o.locator, bytes: o.bytes })) })
  results.push(minted.ok
    ? { attempt, chars: raw.length, stage: 'PASS', code: 'OK', reason: `results=${minted.resultIds.join(',')} claims=${minted.claimIds.join(',')}`, kindCounts }
    : { attempt, chars: raw.length, stage: 'interpretation', code: minted.code, reason: minted.reason, kindCounts })
}

for (const r of results) {
  console.log(`attempt ${r.attempt} (${r.chars} chars) → [${r.stage}] ${r.code}: ${r.reason.slice(0, 300)}`)
  if (r.kindCounts !== undefined) console.log('   entries:', JSON.stringify(r.kindCounts))
}
writeFileSync(new URL('./attempts-diagnosis.json', OUT), JSON.stringify({ persist: PERSIST_DIR, results }, null, 2))
