// T3-focused real verification: 8 fill-in calls, serial, log per attempt.
import { writeFile, mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { ModelingIr } from 'file:///D:/deepseek%20modex/deepseek-harness/packages/paper/paper-foundation/src/ir/store.ts'
import { parseModelContainer, produceContainerInto } from 'file:///D:/deepseek%20modex/deepseek-harness/packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from 'file:///D:/deepseek%20modex/deepseek-harness/packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from 'file:///D:/deepseek%20modex/deepseek-harness/packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { admitTemplateFill, assembleTemplateContainer, defaultTemplateCandidates, templateFillPrompt } from 'file:///D:/deepseek%20modex/deepseek-harness/packages/paper/paper-foundation/src/produce/template-fill.ts'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const API_KEY = process.env.PAPER_PROBE_API_KEY
const BASE = 'https://api.y-api.bestvirtualgoods.com/v1'
const MODEL = 'deepseek/deepseek-v4-flash'
const LOG = '/tmp/t3-verify.log'

async function callProvider(prompt) {
  const r = await fetch(`${BASE}/chat/completions`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 300 }) })
  if (!r.ok) { const e = new Error(`http ${r.status}`); e.status = r.status; throw e }
  const b = await r.json()
  return b?.choices?.[0]?.message?.content ?? ''
}

async function attemptPipeline(text) {
  const parsed = parseModelContainer(text)
  if (!parsed.ok) return { ok: false, stage: 'parse', reason: parsed.reason }
  const ir = new ModelingIr()
  for (const [kind, value] of [
    ['DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problems/probe/task.md', content_hash: `sha256:${'c'.repeat(64)}`, media_type: 'text/markdown', description: 'probe task' }],
    ['RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'probe task' }],
    ['ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] }],
  ]) { if (!ir.put(kind, value).accepted) return { ok: false, stage: 'produce', reason: 'input registration refused' } }
  const produce = produceContainerInto(ir, text)
  if (!produce.ok) return { ok: false, stage: 'produce', reason: produce.reason }
  const container = parsed.container
  const code = container.code ?? ''
  const basenames = container.run?.['outputBasenames'] ?? []
  const runId = `PROBE-${Math.random().toString(36).slice(2, 8)}`
  const locators = basenames.map(b => `file:///runs/${runId}/${b}`)
  const executed = await produceRunExecution({ ir, runId, modelRef: 'M1', codeText: code, environment: 'node 24 t3-verify', seed: 20260903, outputBasenames: basenames, outputLocators: locators, runnerCommand: ['node', 'main.js'], runnerEntryFile: 'main.js', timeoutMs: 30_000 })
  if (!executed.ok) return { ok: false, stage: 'execution', reason: executed.reason }
  const interp = structuredClone(container.interpretations ?? {})
  for (const result of interp.results ?? []) {
    if (typeof result?.source?.locator === 'string' && !result.source.locator.startsWith('file://')) {
      const index = basenames.indexOf(result.source.locator)
      if (index < 0) return { ok: false, stage: 'jsonPath', reason: `source not among outputs` }
      result.source.locator = locators[index]
    }
  }
  const minted = produceInterpretation({ ir, runId, interpretations: interp, outputs: executed.outputs })
  if (!minted.ok) return { ok: false, stage: 'interpretation', reason: minted.reason }
  return { ok: true, stage: 'full' }
}

async function main() {
  const problems = ['Estimate mean sea-ice thickness.', 'Estimate melt-pond fraction.', 'Estimate ridge density.']
  let pass = 0; const rows = []
  for (let i = 0; i < 8; i += 1) {
    const problem = problems[i % problems.length]
    let result = { ok: false, stage: 'transport', reason: 'no call' }
    for (let w = 0; ; w += 1) {
      try {
        const raw = await callProvider([templateFillPrompt(defaultTemplateCandidates()), `Problem: ${problem}`].join('\n\n'))
        result = await attemptPipeline(assembleTemplateContainer((admitTemplateFill(raw)).ok ? admitTemplateFill(raw).fill : (() => { throw new Error('fill refused') })(), problem))
        break
      } catch (e) {
        const st = e?.status ?? 0
        if ((st === 429 || st >= 500) && w < 6) { await sleep(10_000 * (w + 1)); continue }
        result = { ok: false, stage: 'transport', reason: String(e).slice(0, 120) }
        break
      }
    }
    if (result.ok) pass += 1
    const row = { i: i + 1, problem, ok: result.ok, stage: result.stage, reason: (result.reason ?? '').slice(0, 120) }
    rows.push(row)
    await appendFile(LOG, JSON.stringify(row) + '\n')
    if (i < 7) await sleep(2_000)
  }
  await appendFile(LOG, `SUMMARY pass=${pass}/8\n`)
  console.log(`T3 verify pass=${pass}/8`)
}
main().catch(e => console.error('crash', e))
