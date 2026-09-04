#!/usr/bin/env node
/**
 * P3-3 — probe v2: real-provider adherence to ir-container-v1 WITH the
 * EXECUTE protocol teaching segment (known-risks #3 closure attempt).
 *
 * Adherence is a property of the protocol + teaching COMBINATION, so this
 * probe teaches exactly what the EXECUTE instruction carries (imported from
 * `EXECUTE_PROTOCOL_TEACHING` — they cannot drift apart) and measures:
 * per first-attempt call — container parses AND the code really runs AND
 * every declared Result/Claim interpretation is accepted. Retries are
 * recorded separately and NEVER folded into first-attempt adherence.
 *
 * Question set (task book §3 P3-3): the P2 trio + FIGURED-ICE (figure) + a
 * new rounding/uncertainty leaf (covers the P3-2 declaration path). ≥20
 * real first attempts, serial pacing (the provider may rate-limit; a 429
 * waits and retries transport only — never counted as a first attempt).
 *
 * Failure-mode classification (archived with the records):
 *   declaration-drift / escape-attempt / run-failure / numeric-gate-refusal /
 *   transport-error.
 *
 * Downgrade is LITERAL: adherence < 0.8 records the provider+protocol+
 * teaching combination identity as EXPLORATORY-downgraded in the summary
 * (the config path lands in the caller's decision-log entry).
 *
 * Key handling (G3): DEEPSEEK_API_KEY names the key ENV; the probe also
 * accepts PAPER_PROBE_API_KEY / PAPER_PROBE_BASE_URL / PAPER_PROBE_MODEL so
 * a non-DeepSeek endpoint can be measured under the same discipline. No key
 * → the real section is explicitly SKIPPED, never a silent PASS (禁7).
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-P3/probe-v2/run-probe-v2.mjs
 *
 * @module artifacts/handoff/TASK-P3/probe-v2
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { ModelingIr } from '../../../../packages/paper/paper-foundation/src/ir/store.ts'
import { parseModelContainer, produceContainerInto } from '../../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { EXECUTE_PROTOCOL_TEACHING } from '../../../../packages/paper/paper-foundation/src/executor.ts'
import { legalCases } from '../../TASK-P2/demo-v2/cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'output')

const sleep = ms => new Promise(done => setTimeout(done, ms))

/** The fifth question: rounding/uncertainty declaration leaf (P3-2 path). */
const ROUNDED_PROBLEM = {
  id: 'ROUNDED-LEGAL',
  problem: 'Estimate mean sea-ice thickness and report it rounded to two decimals with its uncertainty.',
  quantityName: 'mean ice thickness',
}

function parseContainer(text) {
  const parsed = parseModelContainer(text)
  return parsed.ok ? parsed.container : null
}

/** Classify one failed attempt into the closed failure-mode set. */
function classifyFailure(stage, reason) {
  if (stage === 'transport') return 'transport-error'
  if (stage === 'parse' || stage === 'produce') return 'declaration-drift'
  if (stage === 'no-code' || stage === 'execution') return 'run-failure'
  if (stage === 'jsonPath' || stage === 'interpretation') {
    // The interpretive layer refuses undeclared numbers, unresolvable
    // jsonPaths, and schema-foreign run keys — escapes and gate refusals.
    if (reason.includes('not among declared outputs') || reason.includes('jsonPath')) return 'numeric-gate-refusal'
    return 'escape-attempt'
  }
  return 'escape-attempt'
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

/** The prompt carries the EXECUTE teaching segment VERBATIM (no drift). */
function probePrompt(problem) {
  return [
    EXECUTE_PROTOCOL_TEACHING,
    `Problem: ${problem}`,
  ].join('\n\n')
}

async function callProvider(baseUrl, apiKey, model, prompt) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
  })
  if (!response.ok) {
    const err = new Error(`http ${response.status}`)
    err.status = response.status
    throw err
  }
  const body = await response.json()
  return body?.choices?.[0]?.message?.content ?? ''
}

const problems = [
  ...legalCases.map(c => JSON.parse(c).narrative?.title),
  ROUNDED_PROBLEM.problem,
]

async function main() {
  const records = []
  // ---- Self-check: fake provider must give adherence 1.0 (20 calls). ----
  for (let i = 0; i < 20; i += 1) {
    const container = legalCases[i % legalCases.length]
    const first = await attemptPipeline(container)
    records.push({ mode: 'fake', attempt: i + 1, firstTry: first.ok, stage: first.stage, reason: first.reason, failureMode: first.ok ? null : classifyFailure(first.stage, first.reason ?? '') })
  }
  const fakeFirst = records.filter(r => r.mode === 'fake' && r.firstTry).length
  const fakeAdherence = fakeFirst / 20

  // ---- Real provider: requires a key; else explicit SKIPPED (禁7). ----
  const apiKey = process.env.PAPER_PROBE_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
  const baseUrl = (process.env.PAPER_PROBE_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
  const model = process.env.PAPER_PROBE_MODEL ?? process.env.DEEPSEEK_PROBE_MODEL ?? 'deepseek-chat'
  let realSection = {
    status: 'SKIPPED',
    reason: 'no provider key in the environment (PAPER_PROBE_API_KEY / DEEPSEEK_API_KEY) — real calls not counted, no silent PASS (禁7)',
    attempts: 0,
    firstAttemptAdherence: null,
    failureModes: null,
    downgrade: null,
  }
  if (apiKey.length > 0) {
    const target = 20
    let firstOk = 0
    const failureModes = { 'declaration-drift': 0, 'escape-attempt': 0, 'run-failure': 0, 'numeric-gate-refusal': 0, 'transport-error': 0 }
    let transportRetries = 0
    for (let i = 0; i < target; i += 1) {
      const problem = problems[i % problems.length]
      let firstTry = false
      let stage = 'transport'
      let reason = ''
      // Transport loop: rate limits are waited out, never counted as attempts.
      for (let wait = 0; ; wait += 1) {
        try {
          const raw = await callProvider(baseUrl, apiKey, model, probePrompt(problem))
          const first = await attemptPipeline(raw)
          firstTry = first.ok
          stage = first.stage
          reason = first.reason ?? ''
          break
        } catch (error) {
          const status = error?.status ?? 0
          if ((status === 429 || status >= 500) && wait < 8) {
            transportRetries += 1
            await sleep(Math.min(15_000 * (wait + 1), 120_000))
            continue
          }
          stage = 'transport'
          reason = String(error).slice(0, 160)
          break
        }
      }
      const failureMode = firstTry ? null : classifyFailure(stage, reason)
      if (failureMode !== null) failureModes[failureMode] += 1
      records.push({ mode: 'real', attempt: i + 1, problem: problems[i % problems.length], firstTry, stage, reason: reason.slice(0, 200), failureMode })
      if (firstTry) firstOk += 1
      // Serial pacing between calls (the provider may rate-limit).
      if (i < target - 1) await sleep(1_500)
    }
    const adherence = firstOk / target
    realSection = {
      status: 'COMPLETED',
      reason: '',
      endpoint: baseUrl,
      model,
      attempts: target,
      firstAttemptAdherence: adherence,
      transportRetries,
      failureModes,
      downgrade: adherence < 0.8
        ? {
          downgraded: true,
          to: 'EXPLORATORY',
          combinationIdentity: `${baseUrl} + ${model} + ir-container-v1 + EXECUTE_PROTOCOL_TEACHING v0`,
          note: 'adherence < 0.8 — this provider+protocol+teaching combination is EXPLORATORY-downgraded (literal, not aspirational; recorded in the batch decision-log)',
        }
        : { downgraded: false, to: null, combinationIdentity: `${baseUrl} + ${model} + ir-container-v1 + EXECUTE_PROTOCOL_TEACHING v0`, note: 'adherence ≥ 0.8 — FORMAL stays' },
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    fakeSelfCheck: { calls: 20, adherence: fakeAdherence, trusted: fakeAdherence === 1.0 },
    realSection,
    teachingSegment: 'EXECUTE_PROTOCOL_TEACHING v0 (imported verbatim from src/executor.ts — instruction and probe cannot drift)',
    failureModeVocabulary: ['declaration-drift', 'escape-attempt', 'run-failure', 'numeric-gate-refusal', 'transport-error'],
    note: 'Adherence = (container parses AND code really runs AND all Results pass the numeric gates) / total FIRST attempts. Transport retries are waited out, never counted as attempts. Same-question re-runs may be re-attempted; retries never fold into first-attempt adherence.',
  }
  mkdirSync(OUT, { recursive: true })
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(join(OUT, 'records.jsonl'), records.map(r => JSON.stringify(r)).join('\n'), 'utf8')
  console.log(`fake self-check adherence=${fakeAdherence} (${summary.fakeSelfCheck.trusted ? 'trusted' : 'NOT TRUSTED'})`)
  console.log(`real section: ${realSection.status}${realSection.attempts > 0 ? ` adherence=${realSection.firstAttemptAdherence}` : ''}`)
  if (realSection.status === 'COMPLETED' && realSection.failureModes) {
    console.log(`failure modes: ${JSON.stringify(realSection.failureModes)}`)
  }
  if (realSection.downgrade?.downgraded) {
    console.log(`DOWNGRADE: ${realSection.downgrade.combinationIdentity} -> EXPLORATORY (adherence ${realSection.firstAttemptAdherence} < 0.8)`)
  }
  console.log('probe output ->', OUT)
  process.exitCode = summary.fakeSelfCheck.trusted ? 0 : 1
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => { console.error('probe crashed:', error); process.exitCode = 1 })
  .finally(() => clearInterval(watchdog))
