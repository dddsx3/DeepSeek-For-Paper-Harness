#!/usr/bin/env node
/**
 * TASK-P1C — second-model-family T3 qualification probe (expert plan P1-B/C).
 *
 * Measures z-ai/glm-5.3-free (the relay-routed second model family) on the
 * T3 closed-set fill-in protocol under the NEW IR contract (TASK-T1/S2:
 * AssumptionSpec/EquationSpec canonical objects, SymbolSpec shape/domain
 * required), and adjudicates with the TASK-Q2 STATISTICAL gate:
 *
 *     qualified ⇔ LCB₉₅(first-try success) ≥ 0.80 AND ESCAPE = 0 AND retry budget = 0
 *
 * n = 14 first attempts (the zero-failure stop-rule floor: 14 all-success
 * licenses p > 0.80; anything less cannot qualify even at 100%). Serial
 * discipline: one in-flight request at a time (the relay key's hard
 * concurrency ceiling), 429/5xx exponential backoff, transport failures
 * recorded as TRANSPORT (excluded from the model's adherence but reported).
 *
 * Every attempt runs the FULL trust chain: T3 fill-in admission → container
 * assembly → container parse → harness input-asset registration → produce →
 * REAL node child code run → interpretation minting. First-try only: a fill
 * that needs re-prompting is a failure (NONE/DRIFT), never a retry.
 *
 * SKIPPED (禁7): no key → explicit skip, never a silent PASS.
 *
 * @module artifacts/handoff/TASK-E/run-p1c-probe
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { ModelingIr } from '../../../packages/paper/paper-foundation/src/ir/store.ts'
import { parseModelContainer, produceContainerInto } from '../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { admitTemplateFill, assembleTemplateContainer, defaultTemplateCandidates, templateFillPrompt } from '../../../packages/paper/paper-foundation/src/produce/template-fill.ts'
import { evaluateQualification, exactLowerConfidenceBound } from '../../../packages/paper/paper-foundation/src/probe/qualification.ts'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'output-p1c')

const sleep = ms => new Promise(done => setTimeout(done, ms))

/** The NEW-contract T3 pipeline: fill-in → container → produce → run → mint. */
async function attemptPipeline(text) {
  const parsed = parseModelContainer(text)
  if (!parsed.ok) return { ok: false, stage: 'parse', reason: parsed.reason }
  const ir = new ModelingIr()
  const putInputAsset = (kind, value) => {
    const admitted = ir.put(kind, value)
    if (!admitted.accepted) throw new Error(`input registration refused (${kind})`)
  }
  putInputAsset('DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problems/probe/task.md', content_hash: `sha256:${'c'.repeat(64)}`, media_type: 'text/markdown', description: 'probe task' })
  putInputAsset('RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'probe task' })
  putInputAsset('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] })
  const produce = produceContainerInto(ir, text)
  if (!produce.ok) return { ok: false, stage: 'produce', reason: produce.reason }
  const container = parsed.container
  const code = container.code ?? ''
  const basenames = container.run?.['outputBasenames'] ?? []
  if (typeof code !== 'string' || code.length === 0 || basenames.length === 0) {
    return { ok: false, stage: 'no-code', reason: 'container declares no executable code/outputs' }
  }
  const runId = `P1C-${Math.random().toString(36).slice(2, 8)}`
  const locators = basenames.map(b => `file:///runs/${runId}/${b}`)
  const executed = await produceRunExecution({
    ir, runId, modelRef: 'M1', codeText: code,
    environment: 'node 24 p1c-probe',
    seed: 20260903,
    outputBasenames: basenames,
    outputLocators: locators,
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
  })
  if (!executed.ok) return { ok: false, stage: 'execution', reason: executed.reason }
  const interpretations = container.interpretations
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

/** One T3 first attempt against the real provider. */
async function attemptT3(getText, problem) {
  const raw = await getText()
  const admitted = admitTemplateFill(raw)
  if (!admitted.ok) {
    // Closed refusal codes, not regex guesses: the two smuggle prohibitions
    // (container shape / numbers in text) are ESCAPE — zero tolerance;
    // shape/candidate misses are the tier's guidance gaps (NONE family,
    // W4) — the model produced fill-shaped output but not a legal one.
    const code = admitted.code
    const failure = code === 't3_container_forbidden' || code === 't3_number_forbidden'
      ? 'ESCAPE'
      : 'NONE'
    return { ok: false, stage: 'template-fill', reason: `${code}: ${admitted.reason}`, failure }
  }
  const pipeline = await attemptPipeline(assembleTemplateContainer(admitted.fill, problem))
  return { ...pipeline, failure: pipeline.ok ? 'SUCCESS' : 'DRIFT' }
}

/** One serial provider call (OpenAI-compatible, non-stream), backoff on 429/5xx. */
async function callProvider(baseUrl, apiKey, model, prompt, attempt = 1) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
  })
  if (!response.ok) {
    const status = response.status
    if ((status === 429 || status >= 500) && attempt < 6) {
      await sleep(Math.min(1_500 * 2 ** (attempt - 1), 60_000))
      return callProvider(baseUrl, apiKey, model, prompt, attempt + 1)
    }
    const err = new Error(`http ${status} ${(await response.text().catch(() => '')).slice(0, 120)}`)
    err.status = status
    throw err
  }
  const body = await response.json()
  return { text: body?.choices?.[0]?.message?.content ?? '', usage: body?.usage }
}

async function main() {
  const apiKey = process.env.PAPER_PROBE_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
  const baseUrl = (process.env.PAPER_PROBE_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? '').replace(/\/$/, '')
  const model = process.env.PAPER_PROBE_MODEL ?? 'z-ai/glm-5.3-free'

  // ---- Fake self-check first: the T3 chain must be 1.0 on deterministic
  //      payloads, or the probe itself is not trusted (probe-v3 discipline). ----
  const FAKE_FILL = JSON.stringify({ symbol_id: 'SYM-q', unit: 'm', output_file: 'result.json', json_path: 'mean_thickness' })
  let fakeOk = 0
  for (let i = 0; i < 5; i += 1) {
    const admitted = admitTemplateFill(FAKE_FILL)
    if (!admitted.ok) throw new Error(`fake self-check failed at fill: ${admitted.reason}`)
    const result = await attemptPipeline(assembleTemplateContainer(admitted.fill, 'estimate ice thickness'))
    if (result.ok) fakeOk += 1
    else console.error(`fake self-check attempt ${i + 1}: ${result.stage} ${result.reason}`)
  }
  const fakeTrusted = fakeOk === 5
  console.log(`fake self-check: T3 ${fakeOk}/5 (${fakeTrusted ? 'trusted' : 'NOT TRUSTED'})`)

  const records = []
  const summary = {
    generated_at: new Date().toISOString(),
    probe: 'TASK-P1C — second model family, T3 statistical qualification (expert plan P1-B/C)',
    endpoint: baseUrl || '(default deepseek)',
    model,
    fake_self_check: { t3: fakeOk / 5, trusted: fakeTrusted },
    real: null,
    qualification: null,
  }

  if (apiKey.length === 0 || baseUrl.length === 0) {
    summary.real = { status: 'SKIPPED', reason: 'no provider key/base URL (PAPER_PROBE_API_KEY + PAPER_PROBE_BASE_URL) — no silent PASS (禁7)' }
    console.log('real section: SKIPPED (no key)')
  } else {
    const TARGET = 14 // stop-rule floor: 14 all-success licenses p > 0.80
    const problems = [
      'Estimate mean sea-ice thickness.',
      'Estimate melt-pond fraction.',
      'Estimate ridge density.',
      'Estimate snow accumulation rate.',
      'Estimate albedo seasonal amplitude.',
      'Estimate surface meltwater run-off.',
      'Estimate ocean heat flux under ice.',
    ]
    const attempts = []
    let tokensIn = 0
    let tokensOut = 0
    let transportRetries = 0
    let escapeCount = 0
    for (let i = 0; i < TARGET; i += 1) {
      const problem = problems[i % problems.length]
      // The prompt the tier itself presents: the T3 fill-in teaching +
      // closed candidates (the same templateFillPrompt the executor uses).
      const fillPrompt = templateFillPrompt(defaultTemplateCandidates())
      let result = null
      let usage = undefined
      for (let wait = 0; ; wait += 1) {
        try {
          const call = await callProvider(baseUrl, apiKey, model, [fillPrompt, `Problem: ${problem}`].join('\n\n'))
          usage = call.usage
          result = await attemptT3(async () => call.text, problem)
          break
        } catch (error) {
          const status = error?.status ?? 0
          // status 0 = network-level fault (fetch failed) — retryable, same
          // backoff family as 429/5xx; only after the budget is spent does
          // the attempt count as TRANSPORT (never as the model's failure).
          const retryable = status === 0 || status === 429 || status >= 500
          if (retryable && wait < 4) {
            transportRetries += 1
            await sleep(Math.min(5_000 * (wait + 1), 60_000))
            continue
          }
          result = { ok: false, stage: 'transport', reason: `${String(error).slice(0, 140)} (status ${status})`, failure: 'TRANSPORT' }
          break
        }
      }
      if (usage !== undefined) {
        tokensIn += usage.prompt_tokens ?? 0
        tokensOut += usage.completion_tokens ?? 0
      }
      if (result?.failure === 'ESCAPE') escapeCount += 1
      attempts.push({
        attempt: i + 1,
        problem,
        outcome: result?.failure ?? 'DRIFT',
        stage: result?.stage ?? 'transport',
        reason: (result?.reason ?? '').slice(0, 200),
      })
      console.log(`  ${String(i + 1).padStart(2)}/${TARGET} ${result?.failure === 'SUCCESS' ? 'PASS' : result?.failure ?? '?'} ${result?.stage ?? ''} ${(result?.reason ?? '').slice(0, 60)}`)
      if (i < TARGET - 1) await sleep(1_500)
    }
    const successes = attempts.filter(a => a.outcome === 'SUCCESS').length
    const verdict = evaluateQualification({
      outcomes: attempts.map(a => a.outcome),
      escapeCount,
      retryBudgetUsed: 0,
    })
    summary.real = {
      status: 'COMPLETED',
      target: TARGET,
      successes,
      attempts,
      transport_retries: transportRetries,
      usage: { input_tokens: tokensIn, output_tokens: tokensOut },
    }
    summary.qualification = {
      qualified: verdict.qualified,
      n: verdict.n,
      successes: verdict.successes,
      lcb95: verdict.lcb95,
      p_min: verdict.pMin,
      reasons: verdict.reasons,
      failures_by_class: verdict.failuresByClass,
      point_estimate_note: `${successes}/${verdict.n} point ${(successes / verdict.n).toFixed(3)}; the CLAIM is the bound, not the point (expert plan §6)`,
      stop_rule: `zero-failure floor n=14 (LCB(14,14)=${exactLowerConfidenceBound(14, 14).toFixed(3)}); with failures the exact beta path adjudicates`,
    }
    console.log(`real section: COMPLETED — ${successes}/${TARGET} first-try`)
    console.log(`qualification: ${verdict.qualified ? 'QUALIFIED (T3, p_min 0.80)' : 'NOT QUALIFIED'} — LCB95=${verdict.lcb95.toFixed(3)} p_min=${verdict.pMin}`)
    for (const reason of verdict.reasons) console.log(`  reason: ${reason}`)
  }

  mkdirSync(OUT, { recursive: true })
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(join(OUT, 'records.jsonl'), records.map(r => JSON.stringify(r)).join('\n'), 'utf8')
  console.log('probe output ->', OUT)
  process.exitCode = fakeTrusted ? 0 : 1
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => { console.error('p1c probe crashed:', error); process.exitCode = 1 })
  .finally(() => clearInterval(watchdog))
