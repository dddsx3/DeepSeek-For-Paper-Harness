#!/usr/bin/env node
/**
 * P2-2 — provider adherence probe (known-risks #3 closure).
 *
 * Measures whether a provider actually follows the ir-container-v1
 * declaration protocol (numbers only in code, jsonPath declarations over
 * real outputs). Adherence (per call, first attempt): container parses AND
 * the code really runs AND every declared Result/Claim interpretation is
 * accepted by the numeric gates. Retries are tracked separately, never
 * folded into first-attempt adherence (P2-2 attack).
 *
 * Two modes:
 *   - self-check: the fake provider (deterministic demo leaves) must yield
 *     adherence 1.0 — proving the script itself is trustworthy;
 *   - real: requires DEEPSEEK_API_KEY; ≥20 first-attempt calls; without the
 *     key the real section is explicitly SKIPPED (never counted as PASS).
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-P2/probe/run-p2-probe.mjs
 *
 * @module artifacts/handoff/TASK-P2/probe
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'
import { ModelingIr } from '../../../../packages/paper/paper-foundation/src/ir/store.ts'
import { parseModelContainer, produceContainerInto } from '../../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { legalCases } from '../demo-v2/cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'output')

function parseContainer(text) {
  const parsed = parseModelContainer(text)
  return parsed.ok ? parsed.container : null
}

/** One full protocol attempt: container → real code run → interpretation. */
async function attemptPipeline(container) {
  const text = typeof container === 'string' ? container : JSON.stringify(container)
  const parsed = parseContainer(text)
  if (parsed === null) return { ok: false, stage: 'parse', reason: 'not a schema-valid container' }
  const ir = new ModelingIr()
  const produce = produceContainerInto(ir, text)
  if (!produce.ok) return { ok: false, stage: 'produce', reason: produce.reason }
  const code = parsed.code ?? ''
  const basenames = (parsed.run?.['outputBasenames'] ?? [])
  if (typeof code !== 'string' || code.length === 0 || basenames.length === 0) {
    return { ok: false, stage: 'no-code', reason: 'container declares no executable code/outputs' }
  }
  const runId = `PROBE-${Math.random().toString(36).slice(2, 8)}`
  const locators = basenames.map(b => `file:///runs/${runId}/${b}`)
  const executed = await produceRunExecution({
    ir, runId, modelRef: 'M1', codeText: code,
    environment: 'node 24 probe',
    seed: 20260903,
    outputBasenames: basenames,
    outputLocators: locators,
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
  })
  if (!executed.ok) return { ok: false, stage: 'execution', reason: executed.reason }
  const interpretations = parsed.interpretations
  if (interpretations === undefined) return { ok: false, stage: 'no-interpretations', reason: 'no interpretation block' }
  const interp = structuredClone(interpretations)
  for (const result of interp.results ?? []) {
    if (typeof result?.source?.locator === 'string' && !result.source.locator.startsWith('file://')) {
      const index = basenames.indexOf(result.source.locator)
      if (index < 0) return { ok: false, stage: 'jsonPath', reason: `source '${result.source.locator}' not among declared outputs` }
      result.source.locator = locators[index]
    }
  }
  const minted = produceInterpretation({ ir, runId, interpretations: interp, outputs: executed.outputs })
  if (!minted.ok) return { ok: false, stage: 'interpretation', reason: minted.reason }
  return { ok: true, stage: 'full' }
}

async function main() {
  const records = []
  // ---- Self-check: fake provider must give adherence 1.0 (20 calls). ----
  for (let i = 0; i < 20; i += 1) {
    const container = legalCases[i % legalCases.length]
    const first = await attemptPipeline(container)
    records.push({ mode: 'fake', attempt: i + 1, firstTry: first.ok, stage: first.stage, reason: first.reason })
  }
  const fakeFirst = records.filter(r => r.mode === 'fake' && r.firstTry).length
  const fakeAdherence = fakeFirst / 20

  // ---- Real provider: requires DEEPSEEK_API_KEY; else explicit SKIPPED. ----
  const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
  let realSection = { status: 'SKIPPED', reason: 'DEEPSEEK_API_KEY not set — real calls not counted (P2-6: no silent PASS)', attempts: 0, adherence: null }
  if (apiKey.length > 0) {
    const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
    realSection = { status: 'RUNNING', reason: '', attempts: 0, adherence: null }
    const target = 20
    let firstOk = 0
    let retriesUsed = 0
    for (let i = 0; i < target; i += 1) {
      const leaf = legalCases[i % legalCases.length]
      const sample = JSON.parse(leaf)
      const problem = sample.narrative?.title ?? 'estimate the quantity'
      const prompt = [
        'You are writing a paper-production container. Reply with JSON ONLY in this shape:',
        '{"__dsh_paper":"ir-container-v1","entries":[...kind+value for DataArtifact RAW_PROBLEM, RequirementSpec REQUIRED_OUTPUT, ProblemSpec, SymbolSpec, ModelSpec...],"code":"node JS writing result.json with the measured number","run":{"outputBasenames":["result.json"],"seed":20260903},"interpretations":{"results":[{"result_id":"RES-OUT","name":"...","source":{"locator":"result.json","jsonPath":"..."},"unit":"..."}],"claims":[...]},"narrative":{"title":"...","conclusion":{"claims":[{"text":"... value verbatim ...","quantity_refs":["RES-OUT"]}]}}}',
        `Problem: ${problem}`,
        'Numbers appear ONLY inside "code" and quoted conclusions bound to RES-OUT. Do not write prose outside JSON.',
      ].join('\n')
      let firstTry = false
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: process.env.DEEPSEEK_PROBE_MODEL ?? 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
        })
        if (!response.ok) throw new Error(`http ${response.status}`)
        const body = await response.json()
        const raw = body?.choices?.[0]?.message?.content ?? ''
        const first = await attemptPipeline(raw)
        firstTry = first.ok
        if (!firstTry) retriesUsed += 1
      } catch (error) {
        records.push({ mode: 'real', attempt: i + 1, firstTry: false, stage: 'transport', reason: String(error).slice(0, 120) })
        continue
      }
      records.push({ mode: 'real', attempt: i + 1, firstTry, retriesUsed })
      if (firstTry) firstOk += 1
    }
    realSection = {
      status: 'COMPLETED',
      reason: '',
      attempts: target,
      firstAttemptAdherence: firstOk / target,
      retriesUsed,
      threshold: '≥0.8 keeps FORMAL; <0.8 MUST downgrade to EXPLORATORY (decision-log)',
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    fakeSelfCheck: { calls: 20, adherence: fakeAdherence, trusted: fakeAdherence === 1.0 },
    realSection,
    note: 'Adherence = (container parses AND code really runs AND all Results pass the numeric gates) / total first attempts. Retries recorded separately, never counted as first-try adherence.',
  }
  mkdirSync(OUT, { recursive: true })
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(join(OUT, 'records.jsonl'), records.map(r => JSON.stringify(r)).join('\n'), 'utf8')
  console.log(`fake self-check adherence=${fakeAdherence} (${summary.fakeSelfCheck.trusted ? 'trusted' : 'NOT TRUSTED'})`)
  console.log(`real section: ${realSection.status}${realSection.attempts > 0 ? ` adherence=${realSection.firstAttemptAdherence}` : ''}`)
  console.log('probe output ->', OUT)
  process.exitCode = summary.fakeSelfCheck.trusted ? 0 : 1
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => { console.error('probe crashed:', error); process.exitCode = 1 })
  .finally(() => clearInterval(watchdog))
