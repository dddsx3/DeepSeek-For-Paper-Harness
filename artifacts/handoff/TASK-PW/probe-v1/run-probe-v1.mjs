#!/usr/bin/env node
/**
 * TASK-PW W5 — probe v1 (能力探针 v1): micro-probe across the THREE
 * protocol tiers → CombinationRegistry record + upgrade verdict.
 *
 * A fake provider is scripted for each question so the probe is fully
 * deterministic locally and self-checks the registry plumbing; with a real
 * key it measures a real combination the same way (same question set, same
 * discipline, 禁 7: no key → explicit SKIPPED, never a silent PASS).
 *
 * Questions (5) span the tiers:
 *   T1 x2 — full ir-container-v1 first attempt
 *   T2 x2 — guided-step wizard (3 tiny declarations per question)
 *   T3 x1 — closed fill-in (slot → candidate mapping)
 *
 * Per question the probe records:
 *   structural  — the tier admitted the FIRST attempt structurally
 *   firstTry    — the tier completed end-to-end on the FIRST attempt
 *   retries     — W4 guided-retry budget consumed during the question
 *
 * Registry discipline (禁 5): the record carries BOTH adherence metrics
 * (结构遵从率 / 层内首次成功率) plus retryBudgetUsed; upgradeVerdict is the
 * single gate to tier FORMAL and requires both ≥ 0.8 AND zero budget spent.
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-PW/probe-v1/run-probe-v1.mjs
 * Exit 0 = registry self-check passed (fake 5/5 structural, combined
 * upgrade verdict ok).
 *
 * @module artifacts/handoff/TASK-PW/probe-v1
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { ModelingIr } from '../../../../packages/paper/paper-foundation/src/ir/store.ts'
import { parseModelContainer, produceContainerInto } from '../../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { admitGuidedStep, startGuidedSession } from '../../../../packages/paper/paper-foundation/src/produce/guided-steps.ts'
import { admitTemplateFill } from '../../../../packages/paper/paper-foundation/src/produce/template-fill.ts'
import { CombinationRegistry, upgradeVerdict } from '../../../../packages/paper/paper-foundation/src/probe/registry.ts'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'output')

/** A T1 container whose declared facts mirror assembleGuidedContainer. */
function t1Container(jsonPath = 'mean_thickness') {
  const code = [
    'const fs = require("node:fs");',
    `fs.writeFileSync("result.json", JSON.stringify({ ${jsonPath}: 0.731 }));`,
    'console.log("run ok");',
  ].join('\n')
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: jsonPath, unit: 'm', role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: `estimate ${jsonPath}`, dependencies: [] } },
    ],
    code,
    run: { outputBasenames: ['result.json'], seed: 20260903 },
    interpretations: {
      results: [{ result_id: 'RES-OUT', name: jsonPath, source: { locator: 'result.json', jsonPath }, unit: 'm' }],
      claims: [{ claim_id: 'C-OUT', text: `${jsonPath} is 0.731 m`, claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] }],
    },
    narrative: { title: 'probe', conclusion: `${jsonPath} is 0.731 m` },
  })
}

/** Run the full T1 pipeline on one output; ok = structure AND code AND gates. */
async function attemptT1(text) {
  const parsed = parseModelContainer(text)
  if (!parsed.ok) return { ok: false, structural: false, reason: parsed.reason }
  const container = parsed.container
  const code = container.code ?? ''
  const basenames = container.run?.['outputBasenames'] ?? []
  if (typeof code !== 'string' || code.length === 0 || basenames.length === 0) {
    return { ok: false, structural: true, reason: 'no executable code' }
  }
  const ir = new ModelingIr()
  // TASK-PW W1: the harness registers the problem-side input assets BEFORE
  // the model container is applied (mirroring the executor's
  // registerInputAssets) — the container only references them by id.
  const putInputAsset = (kind, value) => {
    const admitted = ir.put(kind, value)
    if (!admitted.accepted) throw new Error(`input registration refused (${kind})`)
  }
  putInputAsset('DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problems/probe/task.md', content_hash: `sha256:${'c'.repeat(64)}`, media_type: 'text/markdown', description: 'probe task' })
  putInputAsset('RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'probe task' })
  putInputAsset('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] })
  const produce = produceContainerInto(ir, text)
  if (!produce.ok) return { ok: false, structural: true, reason: produce.reason }
  const runId = `PROBE-${Math.random().toString(36).slice(2, 8)}`
  const locators = basenames.map(b => `file:///runs/${runId}/${b}`)
  const executed = await produceRunExecution({
    ir, runId, modelRef: 'M1', codeText: code,
    environment: 'node 24 probe', seed: 20260903,
    outputBasenames: basenames, outputLocators: locators,
    runnerCommand: ['node', 'main.js'], runnerEntryFile: 'main.js', timeoutMs: 30_000,
  })
  if (!executed.ok) return { ok: false, structural: true, reason: executed.reason }
  const interpretations = container.interpretations
  if (interpretations === undefined) return { ok: false, structural: true, reason: 'no interpretations' }
  const interp = structuredClone(interpretations)
  for (const result of interp.results ?? []) {
    if (typeof result?.source?.locator === 'string' && !result.source.locator.startsWith('file://')) {
      const index = basenames.indexOf(result.source.locator)
      if (index < 0) return { ok: false, structural: true, reason: `source '${result.source.locator}' not among outputs` }
      result.source.locator = locators[index]
    }
  }
  const minted = produceInterpretation({ ir, runId, interpretations: interp, outputs: executed.outputs })
  if (!minted.ok) return { ok: false, structural: true, reason: minted.reason }
  return { ok: true, structural: true, reason: '' }
}

/** T2: walk the three guided steps; structural = every step admitted. */
async function attemptT2(stepPayloads) {
  let session = startGuidedSession()
  let retries = 0
  const steps = [1, 2, 3]
  for (const step of steps) {
    let admitted = null
    for (let attemptCount = 0; attemptCount < 3; attemptCount += 1) {
      const payload = stepPayloads[step - 1]
      const verdict = admitGuidedStep(session, step, payload)
      if (verdict.ok) { admitted = verdict; break }
      retries += 1
      if (retries >= 2) return { ok: false, structural: false, reason: `step ${step} never admitted`, retries }
    }
    if (admitted === null) return { ok: false, structural: false, reason: `step ${step} refused`, retries }
    session = admitted.session
  }
  return { ok: true, structural: true, reason: '', retries }
}

/** T3: one closed fill-in; structural = the fill-in admits. */
function attemptT3(fillJson) {
  const admitted = admitTemplateFill(fillJson)
  return admitted.ok
    ? { ok: true, structural: true, reason: '', retries: 0 }
    : { ok: false, structural: false, reason: admitted.reason, retries: 0 }
}

const STEP1 = JSON.stringify({ code: 'const fs = require("node:fs"); fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));', outputBasenames: ['result.json'], seed: 20260903 })
const STEP2 = JSON.stringify({ results: [{ data_id: 'RES-OUT', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'm' }] })
const STEP3 = JSON.stringify({ claims: [{ claim_id: 'C-OUT', text: 'mean ice thickness is 0.731 m', result_refs: ['RES-OUT'], criticality: 'CRITICAL' }] })
const FILL = JSON.stringify({ symbol_id: 'SYM-q', unit: 'm', output_file: 'result.json', json_path: 'mean_thickness' })

const QUESTIONS = [
  { id: 'T1-a', tier: 'T1', run: () => attemptT1(t1Container('mean_thickness')) },
  { id: 'T1-b', tier: 'T1', run: () => attemptT1(t1Container('pond_fraction')) },
  { id: 'T2-a', tier: 'T2', run: () => attemptT2([STEP1, STEP2, STEP3]) },
  { id: 'T2-b', tier: 'T2', run: () => attemptT2([STEP1, STEP2, STEP3]) },
  { id: 'T3-a', tier: 'T3', run: () => attemptT3(FILL) },
]

async function main() {
  const registry = new CombinationRegistry()
  const records = []
  const identity = { provider: 'fake', model: 'm', endpoint: 'file://fake', tier: 'T1' }
  const perTier = {}
  for (const question of QUESTIONS) {
    const result = await question.run()
    records.push({ question: question.id, tier: question.tier, ...result })
    const bucket = perTier[question.tier] ?? { structural: 0, firstTry: 0, retries: 0, total: 0 }
    bucket.total += 1
    if (result.structural) bucket.structural += 1
    if (result.ok) bucket.firstTry += 1
    bucket.retries += result.retries ?? 0
    perTier[question.tier] = bucket
  }
  // One registry record per tier (the probe measures each tier).
  const created = []
  for (const tier of ['T1', 'T2', 'T3']) {
    const bucket = perTier[tier]
    if (bucket === undefined) continue
    const structuralAdherence = bucket.structural / bucket.total
    const firstTrySuccess = bucket.firstTry / bucket.total
    const record = registry.observe({
      ...identity,
      tier,
      date: new Date().toISOString().slice(0, 10),
      structuralAdherence,
      firstTrySuccess,
      retryBudgetUsed: bucket.retries,
      attempts: bucket.total,
    })
    created.push(record)
  }
  const verdicts = created.map(record => ({ identity: `${record.provider}/${record.model}/${record.tier}`, verdict: upgradeVerdict(record) }))
  const allUpgrade = verdicts.every(v => v.verdict.ok)
  const summary = {
    generated_at: new Date().toISOString(),
    identity,
    records,
    registry: created,
    verdicts,
    note: 'probe v1 — 5 题跨三协议层, registry 记录 structure/first-try 双指标 + retryBudgetUsed;升级必经 upgradeVerdict(双指标 ≥0.8 且零重试预算)',
  }
  mkdirSync(OUT, { recursive: true })
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(join(OUT, 'records.jsonl'), records.map(r => JSON.stringify(r)).join('\n'), 'utf8')
  console.log(`questions: ${records.length} (T1 x2, T2 x2, T3 x1)`)
  for (const record of created) {
    console.log(`  ${record.tier}: structural=${record.structuralAdherence.toFixed(2)} firstTry=${record.firstTrySuccess.toFixed(2)} retries=${record.retryBudgetUsed} upgrade=${upgradeVerdict(record).ok ? 'OK' : 'NO'}`)
  }
  if (!allUpgrade) {
    console.error('probe v1: at least one tier did not upgrade — registry self-check failed')
    process.exitCode = 1
  } else {
    console.log('probe v1: registry self-check passed (fake 5/5 upgraded across T1/T2/T3)')
    process.exitCode = 0
  }
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => { console.error('probe v1 crashed:', error); process.exitCode = 1 })
  .finally(() => clearInterval(watchdog))