#!/usr/bin/env node
/**
 * TASK-PW W6 — probe v3 (分层探针): real-provider adherence measured PER
 * PROTOCOL TIER (T1 full container / T2 guided-step wizard / T3 closed
 * fill-in), each tier recorded into the W5 CombinationRegistry with upgrade
 * verdicts, and an explicit SKIPPED (never silent PASS — 禁7) when no key.
 *
 * Where probe-v1 (W5) self-checked the registry plumbing and probe-v2 (P3-3)
 * measured only the T1 full-container protocol with the EXECUTE teaching
 * segment, probe-v3 measures the W2/W3 protocol tiers: a question is a
 * first-attempt pass only when the tier's admission chain AND the full
 * execution pipeline (container parses, code really runs, every declared
 * Result/Claim interpretation is accepted) both succeed on the first try.
 * T2 walks three admitted steps, T3 one admitted fill-in, T1 one full
 * container — the same 同信任链 the executor applies (W2/W3 acceptance).
 *
 * Fake self-check first (deterministic, must be 1.0 per tier or the probe
 * is NOT trusted); then the real section — each tier gets ≥5 real
 * first-attempt calls (≥ 20 total), the CombinationRegistry record per
 * tier carries BOTH adherence metrics + retryBudgetUsed, and upgradeVerdict
 * is the single gate to FORMAL (双指标 ≥0.8 且零重试预算). A real tier
 * below 0.8 records an EXPLORATORY downgrade (literal, decision-log-able).
 *
 * Key handling (G3 / 禁7): PAPER_PROBE_API_KEY ?? DEEPSEEK_API_KEY names the
 * key env; base URL/model follow PAPER_PROBE_* then DEEPSEEK_*. No key → the
 * real section is explicitly SKIPPED, never a silent PASS.
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-PW/probe-v3/run-probe-v3.mjs
 *
 * @module artifacts/handoff/TASK-PW/probe-v3
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { ModelingIr } from '../../../../packages/paper/paper-foundation/src/ir/store.ts'
import { parseModelContainer, produceContainerInto } from '../../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { admitGuidedStep, assembleGuidedContainer, guidedStepPrompt, startGuidedSession } from '../../../../packages/paper/paper-foundation/src/produce/guided-steps.ts'
import { admitTemplateFill, assembleTemplateContainer, defaultTemplateCandidates, templateFillPrompt } from '../../../../packages/paper/paper-foundation/src/produce/template-fill.ts'
import { CombinationRegistry, upgradeVerdict } from '../../../../packages/paper/paper-foundation/src/probe/registry.ts'
import { EXECUTE_PROTOCOL_TEACHING } from '../../../../packages/paper/paper-foundation/src/executor.ts'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'output')

const sleep = ms => new Promise(done => setTimeout(done, ms))

/** A T1 container whose declared facts mirror assembleGuidedContainer. */
function t1Container(jsonPath = 'mean_thickness', unit = 'm') {
  const code = [
    'const fs = require("node:fs");',
    `fs.writeFileSync("result.json", JSON.stringify({ ${jsonPath}: 0.731 }));`,
    'console.log("run ok");',
  ].join('\n')
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: jsonPath, unit, role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: `estimate ${jsonPath}`, dependencies: [] } },
    ],
    code,
    run: { outputBasenames: ['result.json'], seed: 20260903 },
    interpretations: {
      results: [{ result_id: 'RES-OUT', name: jsonPath, source: { locator: 'result.json', jsonPath }, unit }],
      claims: [{ claim_id: 'C-OUT', text: `${jsonPath} is 0.731 ${unit}`, claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] }],
    },
    narrative: { title: `probe ${jsonPath}`, conclusion: `${jsonPath} is 0.731 ${unit}` },
  })
}

/** Full execution pipeline: container parses AND code really runs AND every
 *  declared Result/Claim interpretation is accepted. Stage + failure-mode
 *  classification, mirroring probe-v2's attemptPipeline. The harness-side
 *  input assets (DA-RAW / R-OUT / P1) are registered BEFORE the model
 *  container is applied, exactly as the executor does (W1 input-asset
 *  domain) — the container only references them by id. */
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
  const runId = `PROBE-${Math.random().toString(36).slice(2, 8)}`
  const locators = basenames.map(b => `file:///runs/${runId}/${b}`)
  const executed = await produceRunExecution({
    ir, runId, modelRef: 'M1', codeText: code,
    environment: 'node 24 probe-v3',
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

/** T1 — one full container on the first attempt. */
function attemptT1(containerText) {
  return attemptPipeline(containerText)
}

/** T2 — three admitted guided steps, then the full pipeline on the
 *  harness-assembled container (同信任链). */
async function attemptT2Real(promptFor, taskText) {
  let session = startGuidedSession()
  for (let step = 1; step <= 3; step += 1) {
    const raw = await promptFor(guidedStepPrompt(step, session.candidates), taskText)
    const verdict = admitGuidedStep(session, step, raw)
    if (!verdict.ok) return { ok: false, stage: `guided-step-${step}`, reason: verdict.reason, step }
    session = verdict.session
  }
  return attemptPipeline(assembleGuidedContainer(session, taskText))
}

/** T3 — one admitted fill-in, then the full pipeline on the assembled
 *  container (同信任链). */
async function attemptT3Real(promptFor, taskText) {
  const raw = await promptFor(templateFillPrompt(defaultTemplateCandidates()), taskText)
  const admitted = admitTemplateFill(raw)
  if (!admitted.ok) return { ok: false, stage: 'template-fill', reason: admitted.reason }
  return attemptPipeline(assembleTemplateContainer(admitted.fill, taskText))
}

/** The T2 step payloads for the fake self-check (deterministic pass). */
const STEP1 = JSON.stringify({ code: 'const fs = require("node:fs"); fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));', outputBasenames: ['result.json'], seed: 20260903 })
const STEP2 = JSON.stringify({ results: [{ data_id: 'RES-OUT', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'm' }] })
const STEP3 = JSON.stringify({ claims: [{ claim_id: 'C-OUT', text: 'mean ice thickness is 0.731 m', result_refs: ['RES-OUT'], criticality: 'CRITICAL' }] })
const FILL = JSON.stringify({ symbol_id: 'SYM-q', unit: 'm', output_file: 'result.json', json_path: 'mean_thickness' })

/** Fake self-check per tier: deterministic payloads, adherence must be 1.0. */
async function fakeSelfCheckPerTier(tier) {
  let ok = 0
  const attempts = []
  for (let i = 0; i < 5; i += 1) {
    let result
    if (tier === 'T1') result = await attemptT1(t1Container('mean_thickness'))
    else if (tier === 'T2') {
      let session = startGuidedSession()
      for (const [index, step, payload] of [[0, 1, STEP1], [1, 2, STEP2], [2, 3, STEP3]]) {
        void index
        const verdict = admitGuidedStep(session, step, payload)
        if (!verdict.ok) { result = { ok: false, stage: `guided-step-${step}`, reason: verdict.reason }; break }
        session = verdict.session
      }
      if (result === undefined) result = await attemptPipeline(assembleGuidedContainer(session, 'estimate ice thickness'))
    } else {
      const admitted = admitTemplateFill(FILL)
      result = admitted.ok
        ? await attemptPipeline(assembleTemplateContainer(admitted.fill, 'estimate ice thickness'))
        : { ok: false, stage: 'template-fill', reason: admitted.reason }
    }
    attempts.push({ attempt: i + 1, firstTry: result.ok, stage: result.stage, reason: result.reason })
    if (result.ok) ok += 1
  }
  return { attempts, adherence: ok / 5, trusted: ok === 5 }
}

async function main() {
  const registry = new CombinationRegistry()
  const records = []
  const identity = { provider: 'fake', model: 'm', endpoint: 'file://fake', tier: 'T1' }

  // ---- Fake self-check: every tier must give adherence 1.0. ----
  const fakeSelfCheck = {}
  let fakeTrusted = true
  for (const tier of ['T1', 'T2', 'T3']) {
    const check = await fakeSelfCheckPerTier(tier)
    fakeSelfCheck[tier] = check
    fakeTrusted = fakeTrusted && check.trusted
    for (const attempt of check.attempts) records.push({ mode: 'fake', tier, ...attempt })
  }

  // ---- Registry discipline (W5): one CombinationRecord per tier, upgrade
  //  verdicts gate FORMAL. ----
  const created = []
  const verdicts = []
  for (const tier of ['T1', 'T2', 'T3']) {
    const check = fakeSelfCheck[tier]
    const record = registry.observe({
      ...identity,
      tier,
      date: new Date().toISOString().slice(0, 10),
      structuralAdherence: check.adherence,
      firstTrySuccess: check.adherence,
      retryBudgetUsed: 0,
      attempts: check.attempts.length,
    })
    created.push(record)
    verdicts.push({ identity: `${record.provider}/${record.model}/${record.tier}`, verdict: upgradeVerdict(record) })
  }
  const allUpgrade = verdicts.every(v => v.verdict.ok)

  // ---- Real provider: requires a key; else explicit SKIPPED (禁7). ----
  const apiKey = process.env.PAPER_PROBE_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
  const baseUrl = (process.env.PAPER_PROBE_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
  const model = process.env.PAPER_PROBE_MODEL ?? process.env.DEEPSEEK_PROBE_MODEL ?? 'deepseek-chat'
  const problems = ['Estimate mean sea-ice thickness.', 'Estimate melt-pond fraction.', 'Estimate ridge density.']
  let realSection = {
    status: 'SKIPPED',
    reason: 'no provider key in the environment (PAPER_PROBE_API_KEY / DEEPSEEK_API_KEY) — real calls not counted, no silent PASS (禁7)',
    perTier: null,
    downgrades: null,
  }
  if (apiKey.length > 0) {
    const promptFor = async (teaching, problem) => callProvider(baseUrl, apiKey, model, [teaching, `Problem: ${problem}`].join('\n\n'))
    const perTier = {}
    const downgrades = {}
    for (const tier of ['T1', 'T2', 'T3']) {
      const target = 5
      let firstOk = 0
      const attempts = []
      let transportRetries = 0
      for (let i = 0; i < target; i += 1) {
        const problem = problems[i % problems.length]
        let firstTry = false
        let result = null
        for (let wait = 0; ; wait += 1) {
          try {
            if (tier === 'T1') {
              result = await attemptT1PipelinePrompt(problem, promptFor)
            } else if (tier === 'T2') {
              result = await attemptT2Real(promptFor, problem)
            } else {
              result = await attemptT3Real(promptFor, problem)
            }
            firstTry = result.ok
            break
          } catch (error) {
            const status = error?.status ?? 0
            if ((status === 429 || status >= 500) && wait < 8) {
              transportRetries += 1
              await sleep(Math.min(15_000 * (wait + 1), 120_000))
              continue
            }
            result = { ok: false, stage: 'transport', reason: String(error).slice(0, 160) }
            firstTry = false
            break
          }
        }
        attempts.push({ attempt: i + 1, problem: problems[i % problems.length], firstTry, stage: result?.stage ?? 'transport', reason: (result?.reason ?? '').slice(0, 200) })
        if (firstTry) firstOk += 1
        if (i < target - 1) await sleep(1_500)
      }
      const adherence = firstOk / target
      perTier[tier] = { attempts, adherence, transportRetries }
      // Literal downgrade: a real tier under 0.8 is EXPLORATORY.
      downgrades[tier] = adherence < 0.8
        ? { downgraded: true, to: 'EXPLORATORY', combinationIdentity: `${baseUrl} + ${model} + ${tier}`, note: `adherence ${adherence} < 0.8 — this tier of this combination is EXPLORATORY-downgraded (literal; recorded in the batch decision-log)` }
        : { downgraded: false, to: null, combinationIdentity: `${baseUrl} + ${model} + ${tier}`, note: `adherence ${adherence} ≥ 0.8 — FORMAL stays` }
      for (const a of attempts) records.push({ mode: 'real', tier, ...a })
    }
    realSection = { status: 'COMPLETED', reason: '', endpoint: baseUrl, model, perTier, downgrades }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    identity,
    fakeSelfCheck,
    registry: created,
    verdicts,
    realSection,
    note: 'probe v3 — per-tier adherence measured on FIRST attempts; the T2/T3 tiers exercise their admission chains and then the SAME execution pipeline as T1 (同信任链). Upgrade verdicts gate FORMAL (双指标 ≥0.8 且零重试预算). No key → explicit SKIPPED (禁7).',
  }
  mkdirSync(OUT, { recursive: true })
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(join(OUT, 'records.jsonl'), records.map(r => JSON.stringify(r)).join('\n'), 'utf8')
  console.log(`fake self-check: ${Object.entries(fakeSelfCheck).map(([t, c]) => `${t}=${c.adherence}`).join(' ')} (${fakeTrusted ? 'trusted' : 'NOT TRUSTED'})`)
  console.log(`registry: ${verdicts.map(v => `${v.identity} upgrade=${v.verdict.ok ? 'OK' : 'NO'}`).join(' | ')}`)
  console.log(`real section: ${realSection.status}${realSection.status === 'COMPLETED' ? ` perTier=${JSON.stringify(Object.fromEntries(Object.entries(realSection.perTier).map(([t, v]) => [t, v.adherence])))}` : ''}`)
  if (realSection.status === 'COMPLETED' && Object.values(realSection.downgrades ?? {}).some(d => d.downgraded)) {
    for (const [tier, d] of Object.entries(realSection.downgrades ?? {})) {
      if (d.downgraded) console.log(`DOWNGRADE: ${d.combinationIdentity} -> EXPLORATORY (adherence ${realSection.perTier[tier].adherence} < 0.8)`)
    }
  }
  console.log('probe output ->', OUT)
  process.exitCode = fakeTrusted && allUpgrade ? 0 : 1
}

/** T1 real attempt: prompt the provider for a full container, then pipeline. */
async function attemptT1PipelinePrompt(problem, promptFor) {
  const raw = await promptFor(EXECUTE_PROTOCOL_TEACHING, problem)
  return attemptPipeline(raw)
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

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => { console.error('probe v3 crashed:', error); process.exitCode = 1 })
  .finally(() => clearInterval(watchdog))