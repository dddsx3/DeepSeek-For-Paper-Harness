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
 * Usage (via tsx — the runner uses TypeScript parameter properties, so
 * Node's strip-only .ts import mode cannot load it):
 *   node_modules/.bin/tsx artifacts/handoff/TASK-3/run-real-execution-smoke.mjs <repo-root>
 *
 * Exit 0 = the chain Claim → Result → Run → REAL Execution → Replay is closed.
 *
 * Structure note (5.0.6 CI fix): everything runs inside `main()` with an
 * explicit exit code and a ref'd watchdog. Top-level awaits are only the
 * module imports. Under tsx on some Node 24 hosts an emptied event loop
 * with a pending top-level await reports "unsettled top-level await" and
 * exits 13 while the work is still finishing — moving the flow off the
 * top level and keeping the watchdog alive until `main()` settles makes
 * the outcome an explicit 0/1/2 instead of a platform-dependent 13.
 */

import { pathToFileURL } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Accept a Git-Bash/MSYS path (`/d/repo`) as well as a native one
 * (`D:\repo`), matching verify-report-state.mjs. On Windows,
 * `path.resolve('/d/repo')` yields `D:\d\repo` and the whole import
 * graph vanishes with ERR_MODULE_NOT_FOUND.
 */
function resolveRepoRoot(raw) {
  const msys = /^\/([A-Za-z])\/(.*)$/.exec(raw)
  return pathResolve(msys === null ? raw : `${msys[1]}:\\${msys[2]}`)
}

// TASK 3 C5 CI fix (5.0.6 wiring exposed this): `fileURLToPath` returns
// the FILE's path, not its directory — three `..` from the file lands
// in <repo>/artifacts, so the CI invocation (no argv) tried to import
// <repo>/artifacts/packages/... and died with ERR_MODULE_NOT_FOUND.
// The base must be the script's directory; three `..` from there is the
// repo root.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? resolveRepoRoot(process.argv[2]) : pathResolve(here, '..', '..', '..')

const irIndexUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/src/ir/index.ts')).href
const execIndexUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/src/execution/index.ts')).href
const fixturesUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/tests/ir/fixtures.ts')).href

const { ModelingIr, sha256Hex, CAPTURE_ATTESTATION } = await import(irIndexUrl)
const { LocalProcessRunner, captureExecution, replayExecution } = await import(execIndexUrl)
const { chainThrough, result, runArtifact } = await import(fixturesUrl)

/** Whole-flow wall clock: the capture + replay of two real children is
 *  normally a few seconds; 180s means something genuinely stalled. */
const WATCHDOG_MS = 180_000

async function main() {
  const NOW = '2026-09-01T00:00:00.000Z'
  const mark = message => console.log(`[smoke] ${new Date().toISOString()} ${message}`)
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
    trace: (message) => mark(`trace ${message}`),
  }

  // CI stall probe (5.0.6): on ubuntu runners the capture below used to
  // hang with no output until the watchdog. Run the real child ONCE
  // through the production runner before the capture so a stall can be
  // attributed to a specific await instead of the whole phase.
  mark('probe: running the real child through LocalProcessRunner')
  const probe = await new LocalProcessRunner(config).run({
    code: realCode,
  })
  mark(`probe: exit_status=${probe.exitStatus} stdout=${JSON.stringify(probe.stdout)}`)

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

  mark('capture: starting captureExecution')
  const captured = await captureExecution({
    ir, runRef: 'RUN1', executionId: 'EXEC-REAL',
    runner: new LocalProcessRunner(config),
    loadCode: async () => realCode,
    timeoutMs: 60_000,
  })
  mark('capture: captureExecution resolved')
  if (!captured.ok) {
    console.error('CAPTURE FAILED:', JSON.stringify(captured.failures, null, 2))
    return 1
  }
  // 3.R3 / INV-3-M: ExecutionRecord cannot be put directly — it must
  // enter canonical state through the producer-only door carrying the
  // capture attestation. This evidence script predates 3.R3 and was
  // silently broken by it (5.0.6 CI wiring exposed the break); the
  // rewrite below mirrors the `backboneIr()` fixture.
  const ingest = ir.putExecutionRecord(captured.record, CAPTURE_ATTESTATION)
  if (!ingest.accepted) {
    console.error('RECORD INGEST FAILED:', JSON.stringify(ingest.failures, null, 2))
    return 1
  }

  console.log('capture: exit_status =', captured.record.exit_status)
  console.log('capture: stdout =', JSON.stringify(sha256Hex('real execution ok').slice(0, 12)), '… digest family match: see hash below')
  console.log('capture: stdout_hash =', captured.record.stdout_hash)
  console.log('capture: runtime_fingerprint_hash =', captured.record.runtime_fingerprint_hash)

  mark('replay: starting replayExecution')
  const verdict = await replayExecution({
    ir, executionId: 'EXEC-REAL',
    runner: new LocalProcessRunner(config),
    loadCode: async () => realCode,
    timeoutMs: 60_000,
  })
  mark('replay: replayExecution resolved')

  const summary = {
    evidence: 'TASK 3 C5 — real-process capture + replay',
    capture_ok: true,
    replay_ok: verdict.ok,
    replay_checks: verdict.checks,
    replay_failures: verdict.failures,
    verdict: verdict.ok ? 'CHAIN CLOSED: Claim → Result → Run → REAL Execution → Replay PASS' : 'REPLAY FAILED',
  }
  console.log(JSON.stringify(summary, null, 2))
  return verdict.ok ? 0 : 1
}

const watchdog = setTimeout(() => {
  console.error(`run-real-execution-smoke: stalled — capture/replay did not settle within ${WATCHDOG_MS / 1000}s`)
  console.error(`run-real-execution-smoke: node=${process.version} platform=${process.platform} arch=${process.arch} execPath=${process.execPath}`)
  process.exit(2)
}, WATCHDOG_MS)

main()
  .then(code => {
    clearTimeout(watchdog)
    process.exit(code)
  })
  .catch(error => {
    clearTimeout(watchdog)
    console.error(error)
    process.exit(1)
  })
