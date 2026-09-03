#!/usr/bin/env node
/**
 * P1-5 — FORMAL end-to-end demo + pass corpus (CI job body).
 *
 * 题目 → P1-1 container (contract kinds) → P1-2 REAL code run (captured
 * ExecutionRecord) → P1-3 interpretation (Result/Claim minted from the
 * REAL output bytes) → v1 template report (IR-injected table, guarded
 * conclusion) → FORMAL nine-gate delivery (code bytes S-007 checked via
 * loadCode from the persisted run dir) → report file written with sha256.
 *
 * 3 legal leaves must DELIVER (False Block Rate baseline 0/3); 2 wrong
 * leaves must be KILLED (renderer guard + coverage gate).
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-P1/demo/run-p1-demo.mjs
 * Exit 0 = corpus green. Everything runs inside main() with a watchdog and
 * an explicit exit code (top-level await hazards, DISCIPLINE C14).
 */

import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelingIr } from '../../../../packages/paper/paper-foundation/src/ir/store.ts'
import {
  parseModelContainer,
  produceContainerInto,
} from '../../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { renderV1Report } from '../../../../packages/paper/paper-foundation/src/produce/report-renderer.ts'
import { buildDeliveryPolicy } from '../../../../packages/paper/paper-foundation/src/delivery/gate-registry.ts'
import { evaluateDelivery } from '../../../../packages/paper/paper-foundation/src/delivery/delivery-policy.ts'
import { containerFor, legalCases, wrongCases } from './cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = join(here, 'output')

/** file:///runs/RUN-X/main.js -> <OUT_ROOT>/runs/RUN-X/main.js on disk. */
function codeRefToDisk(ref) {
  return join(OUT_ROOT, ref.replace('file://', ''))
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Run one paper leaf through the full FORMAL pipeline.
 * @returns {{ok: true, reportText: string, sha256: string, gateFailures: string[]}
 *          | {ok: false, refusedAt: string, code?: string, reason: string}}
 */
async function runLeaf(caseDef) {
  const container = containerFor(caseDef)
  const text = JSON.stringify(container)
  const runId = `RUN-${caseDef.id}`

  // ---- P1-1: contract kinds into the canonical store. ----
  const ir = new ModelingIr()
  const produce = produceContainerInto(ir, text)
  if (!produce.ok) {
    return { ok: false, refusedAt: 'produceContainerInto', code: produce.code, reason: produce.reason }
  }

  // Persist the code so S-007 can re-read REAL bytes at delivery time.
  const parsed = parseModelContainer(text)
  if (!parsed.ok) return { ok: false, refusedAt: 'parse', reason: parsed.reason }
  const containerParsed = parsed.container
  const code = containerParsed.code ?? ''
  const codeDisk = codeRefToDisk(`file:///runs/${runId}/main.js`)
  mkdirSync(dirname(codeDisk), { recursive: true })
  await writeFile(codeDisk, code, 'utf8')

  // ---- P1-2: run the code for real and capture the ExecutionRecord. ----
  const outputLocator = `file:///runs/${runId}/result.json`
  const declaredBytes = new Map([[outputLocator, JSON.stringify({ [caseDef.quantity.key]: caseDef.quantity.value })]])
  const executed = await produceRunExecution({
    ir,
    runId,
    modelRef: 'M1',
    codeText: code,
    environment: 'node 24 deterministic demo (no external inputs)',
    // Fixed reproducible seed: the provenance gate refuses a critical
    // run without one (INV-3-D — 'critical-chain execution has seed
    // null'). Deterministic demo code + a fixed seed is reproducible.
    seed: 20260903,
    outputBasenames: ['result.json'],
    outputLocators: [outputLocator],
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
    declaredOutputBytes: declaredBytes,
  })
  if (!executed.ok) {
    return { ok: false, refusedAt: 'produceRunExecution', code: executed.code, reason: executed.reason }
  }

  // ---- P1-3: interpret the REAL output bytes into Result + Claim. ----
  const interpretations = structuredClone(containerParsed.interpretations ?? {})
  if (interpretations.results?.[0]?.source) {
    interpretations.results[0].source.locator = outputLocator
  }
  const interpreted = produceInterpretation({
    ir,
    runId,
    interpretations,
    outputs: executed.outputs,
  })
  if (!interpreted.ok) {
    return { ok: false, refusedAt: 'produceInterpretation', code: interpreted.code, reason: interpreted.reason }
  }

  // ---- v1 template report (numbers injected from the IR). ----
  const snapshot = ModelingIr.snapshot(ir)
  const results = [...(snapshot?.values() ?? [])]
    .filter(r => r.kind === 'Result')
    .map(r => r.value)
  const rendered = renderV1Report({
    title: caseDef.title,
    results: results.map(r => ({
      result_id: r.result_id,
      name: r.name,
      value: r.value,
      unit: r.unit,
      uncertainty: r.uncertainty,
    })),
    narrative: (containerParsed.narrative ?? {}) ,
  })
  if (!rendered.ok) {
    return { ok: false, refusedAt: 'renderV1Report', code: rendered.code, reason: rendered.reason }
  }

  // ---- FORMAL nine-gate delivery, S-007 with real code bytes. ----
  const policy = buildDeliveryPolicy({
    mode: 'FORMAL',
    ir,
    runtimeProfileValid: true,
    loadCode: ref => readFileSync(codeRefToDisk(ref), 'utf8'),
  })
  const decision = evaluateDelivery(policy)
  const gateFailures = decision.failures.map(f => f.reason)
  if (gateFailures.length > 0) {
    return { ok: false, refusedAt: 'delivery gates', reason: gateFailures.join('; ') }
  }

  const reportText = rendered.text
  return { ok: true, reportText, sha256: sha256(reportText), gateFailures: [] }
}

async function main() {
  const summary = { legal: [], wrong: [], falseBlockRate: null }
  let exit = 0

  for (const caseDef of legalCases) {
    try {
      const outcome = await runLeaf(caseDef)
      if (!outcome.ok) {
        summary.legal.push({ id: caseDef.id, status: 'FALSE_BLOCK', refusedAt: outcome.refusedAt, reason: outcome.reason })
        exit = 1
        continue
      }
      const caseOut = join(OUT_ROOT, caseDef.id)
      mkdirSync(caseOut, { recursive: true })
      await writeFile(join(caseOut, 'report.md'), outcome.reportText, 'utf8')
      await writeFile(join(caseOut, 'sha256.txt'), outcome.sha256, 'utf8')
      summary.legal.push({ id: caseDef.id, status: 'PASS', sha256: outcome.sha256 })
      console.log(`[PASS] ${caseDef.id}: delivered report.md sha256=${outcome.sha256}`)
    } catch (error) {
      summary.legal.push({ id: caseDef.id, status: 'ERROR', reason: String(error) })
      exit = 1
    }
  }

  for (const caseDef of wrongCases) {
    try {
      const outcome = await runLeaf(caseDef)
      if (outcome.ok) {
        summary.wrong.push({ id: caseDef.id, status: 'ESCAPED' })
        exit = 1
        continue
      }
      // A wrong leaf must be refused. Whether the refusal happens at the
      // renderer (TOO-GOOD) or at the delivery gates (OVER-PROMISE) is the
      // leaf's own contract; both are legitimate kills.
      summary.wrong.push({ id: caseDef.id, status: 'KILLED', refusedAt: outcome.refusedAt, code: outcome.code, reason: outcome.reason })
      console.log(`[KILL] ${caseDef.id}: refused at ${outcome.refusedAt}${outcome.code === undefined ? '' : ` (${outcome.code})`}`)
    } catch (error) {
      summary.wrong.push({ id: caseDef.id, status: 'ESCAPED', reason: String(error) })
      exit = 1
    }
  }

  const legalPass = summary.legal.filter(c => c.status === 'PASS').length
  summary.falseBlockRate = `${(summary.legal.length - legalPass)}/${summary.legal.length}`
  console.log(`\nlegal PASS ${legalPass}/${summary.legal.length} (False Block Rate ${summary.falseBlockRate})`)
  const killed = summary.wrong.filter(c => c.status === 'KILLED').length
  console.log(`wrong KILLED ${killed}/${summary.wrong.length}`)
  const allGatesReal = await import('../../../../packages/paper/paper-foundation/src/delivery/gate-registry.ts').then(m => m.criticalGateImplementationReport())
  console.log(`gates_impl: ${allGatesReal.filter(g => g.implementation === 'real').length}/9 real`)
  await writeFile(join(OUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')

  if (legalPass !== legalCases.length || killed !== wrongCases.length || exit !== 0) {
    console.error('P1-5 demo: NOT all legal leaves delivered and/or not all wrong leaves killed')
    process.exitCode = 1
  } else {
    console.log('P1-5 demo: corpus green — FORMAL delivery reachable end to end')
    process.exitCode = 0
  }
}

// Watchdog keeps the process alive until main() settles (DISCIPLINE C14).
const watchdog = setInterval(() => { /* no-op */ }, 30_000)
main()
  .catch((error) => {
    console.error('P1-5 demo crashed:', error)
    process.exitCode = 1
  })
  .finally(() => clearInterval(watchdog))
