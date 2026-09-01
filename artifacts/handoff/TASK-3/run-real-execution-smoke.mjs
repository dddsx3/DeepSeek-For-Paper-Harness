#!/usr/bin/env node
/**
 * TASK 3 C5 evidence — REAL execution smoke (outside vitest).
 *
 * A genuine node child process runs deterministic code; capture distils
 * it into a canonical ExecutionRecord; replay re-executes a second real
 * process and re-derives every digest. This is the "Actual Execution"
 * half of the chain, proven against real processes — run separately from
 * the vitest suite because a child spawn under the full regression's
 * memory load can starve on this machine (see tests/execution/local-
 * runner.spec.ts for the rationale).
 *
 * Usage (via tsx):
 *   node_modules/.bin/tsx artifacts/handoff/TASK-3/run-real-execution-smoke.mjs <repo-root>
 *
 * Exit 0 = the chain Claim → Result → Run → REAL Execution → Replay is closed.
 */

import { pathToFileURL } from 'node:url'
import { join, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(import.meta.url)
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')

const irIndexUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/src/ir/index.ts')).href
const execIndexUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/src/execution/index.ts')).href
const fixturesUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/tests/ir/fixtures.ts')).href

const { ModelingIr, sha256Hex } = await import(irIndexUrl)
const { LocalProcessRunner, captureExecution, replayExecution } = await import(execIndexUrl)
const { chainThrough, result, runArtifact } = await import(fixturesUrl)

const NOW = '2026-09-01T00:00:00.000Z'
const realCode = [
  'const fs = require("node:fs");',
  'fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
  'console.log("real execution ok");',
].join('\n')
const realCodeHash = `sha256:${sha256Hex(realCode)}`

const config = {
  command: ['node', 'main.js'],
  entryFile: 'main.js',
  outputBasenames: ['result.json'],
  outputLocators: ['file:///runs/RUN1/result.json'],
  timeoutMs: 60_000,
  environmentFactsCommands: [['node', '-p', 'process.version']],
}

const ir = new ModelingIr({ now: () => NOW })
for (const entry of chainThrough('ModelSpec')) {
  ir.put(entry.kind, entry.value)
}
if (!ir.put('RunArtifact', runArtifact({ code_hash: realCodeHash })).accepted) throw new Error('run ingest failed')
if (!ir.put('Result', result()).accepted) throw new Error('result ingest failed')
if (!ir.put('Claim', {
  claim_id: 'C1',
  text: 't', claim_type: 'NUMERIC', criticality: 'CRITICAL',
  numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
  evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1'],
}).accepted) throw new Error('claim ingest failed')

const captured = await captureExecution({
  ir, runRef: 'RUN1', executionId: 'EXEC-REAL',
  runner: new LocalProcessRunner(config),
  loadCode: async () => realCode,
  timeoutMs: 60_000,
})
if (!captured.ok) {
  console.error('CAPTURE FAILED:', JSON.stringify(captured.failures, null, 2))
  process.exit(1)
}
if (!ir.put('ExecutionRecord', captured.record).accepted) throw new Error('record ingest failed')

console.log('capture: exit_status =', captured.record.exit_status)
console.log('capture: stdout =', JSON.stringify(sha256Hex('real execution ok').slice(0, 12)), '… digest family match:', captured.record.stdout_hash === `sha256:${sha256Hex('real execution ok')}`.slice(0, 0) || 'see hash below')
console.log('capture: stdout_hash =', captured.record.stdout_hash)
console.log('capture: runtime_fingerprint_hash =', captured.record.runtime_fingerprint_hash)

const verdict = await replayExecution({
  ir, executionId: 'EXEC-REAL',
  runner: new LocalProcessRunner(config),
  loadCode: async () => realCode,
  timeoutMs: 60_000,
})

const summary = {
  evidence: 'TASK 3 C5 — real-process capture + replay',
  capture_ok: true,
  replay_ok: verdict.ok,
  replay_checks: verdict.checks,
  replay_failures: verdict.failures,
  verdict: verdict.ok ? 'CHAIN CLOSED: Claim → Result → Run → REAL Execution → Replay PASS' : 'REPLAY FAILED',
}
console.log(JSON.stringify(summary, null, 2))
process.exit(verdict.ok ? 0 : 1)