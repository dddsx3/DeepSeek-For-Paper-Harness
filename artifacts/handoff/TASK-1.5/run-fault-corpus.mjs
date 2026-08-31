#!/usr/bin/env node
/**
 * TASK 1.5 Fault Corpus Runner (C-001..C-018).
 *
 * Each fault fixture builds a small canonical scenario (a `ModelingIr` plus
 * the mode under test) and asserts the bridge reaches the expected verdict.
 * The runner never lets an exception escape: a thrown / faulted bridge is
 * itself BLOCKED (the totality invariant must not regress).
 *
 * Usage:
 *   node artifacts/handoff/TASK-1.5/run-fault-corpus.mjs <repo-root>
 *
 * The output is `artifacts/handoff/TASK-1.5/fault-results.json`.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')

// A repo root that does not exist makes every fixture fail with a spawn
// ENOENT, which reads exactly like 18 real regressions. Git Bash's `$(pwd)`
// yields `/d/...`, which `path.resolve` turns into `D:\d\...` — a plausible
// looking path that is not there. Fail loudly instead.
if (!statSync(repoRoot, { throwIfNoEntry: false })) {
  console.error(`repo root does not exist: ${repoRoot}`)
  console.error('pass an absolute Windows-style path, e.g. node run-fault-corpus.mjs "D:/repo"')
  process.exit(2)
}

const faultDir = join(__dirname, 'faults')
const faultNames = readdirSync(faultDir)
  .filter(name => name.endsWith('.json') && !name.endsWith('.verdict.json'))
  .sort()

const results = {
  task: 'TASK 1.5 — Canonical Problem Contract',
  phase: 'PHASE 5 — Fault Corpus',
  pinned_main: spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD']).stdout.toString().trim(),
  startedAt: new Date().toISOString(),
  corpus: [],
  totals: { total: 0, passed: 0, failed: 0 },
}

for (const name of faultNames) {
  results.totals.total += 1
  const verdictName = name.replace(/\.json$/, '.verdict.json')
  const verdictPath = join(faultDir, verdictName)
  if (!statSync(verdictPath, { throwIfNoEntry: false })) {
    results.corpus.push({ id: name.replace('.json', ''), status: 'ERROR', reason: `missing verdict file ${verdictName}` })
    results.totals.failed += 1
    continue
  }
  const verdict = JSON.parse(readFileSync(verdictPath, 'utf8'))
  // `process.execPath` rather than the bare name `node`: the child inherits
  // this process's environment, and a PATH that resolves `node` for the shell
  // does not always resolve it for a spawned child. Spawning by name produced
  // ENOENT for all 18 fixtures while the same command worked from a terminal,
  // which is a failure mode that looks exactly like 18 real regressions.
  const cmd = [process.execPath, '--import', 'tsx/esm', join(repoRoot, 'packages/paper/paper-foundation/tests/ir/run-fault.ts'), name]
  const proc = spawnSync(cmd[0], cmd.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FAULT_FIXTURE_DIR: faultDir },
  })
  // `spawnSync` reports a failure to *spawn* by returning `error` with a null
  // status and no stdout/stderr at all. Reading `proc.stderr` unconditionally
  // here turned a spawn failure into a crash in the runner, which is the worst
  // possible outcome for a harness whose only job is to report verdicts.
  if (proc.error !== undefined || proc.status !== 0) {
    const detail = proc.error !== undefined
      ? `spawn failed: ${proc.error.code ?? 'unknown'} ${proc.error.message}`
      : `runner exited ${proc.status}: ${(proc.stderr ?? '').trim().slice(0, 800)}`
    results.corpus.push({
      id: name.replace('.json', ''),
      status: 'FAILED',
      reason: detail,
    })
    results.totals.failed += 1
    continue
  }
  const stdout = (proc.stdout ?? '').trim()
  if (stdout.length === 0) {
    results.corpus.push({
      id: name.replace('.json', ''),
      status: 'FAILED',
      reason: `runner produced no verdict on stdout (status ${proc.status})`,
    })
    results.totals.failed += 1
    continue
  }
  const observed = JSON.parse(stdout.split('\n').pop())
  const expectedMatches = verdict.expected_reason_matches ?? []
  const reasonMatches = expectedMatches.every(needle => observed.reason.includes(needle))

  // TASK 1.5: the bridge reason reports the *downstream* symptom (an unresolved
  // reference), while the ingest log reports the *root cause* (the object was
  // refused at put() time). A fault fixture that only asserts the symptom can
  // pass for the wrong reason, so fixtures may additionally pin the root cause.
  const ingestNeedles = verdict.expected_ingest_reason_matches ?? []
  const refused = (observed.ingest?.log ?? []).filter(entry => entry.accepted === false)
  const ingestHaystack = refused
    .flatMap(entry => (entry.failures ?? []).map(f => `${f.path}:${f.reason}`))
    .join(' | ')
  const ingestMatches = ingestNeedles.every(needle => ingestHaystack.includes(needle))

  const ok = observed.status === verdict.expected_status
    && reasonMatches
    && ingestMatches
  observed.reason_matches = expectedMatches
  observed.ingest_reason_matches = ingestNeedles
  const failedReasons = []
  if (observed.status !== verdict.expected_status) {
    failedReasons.push(`expected status ${verdict.expected_status}, observed ${observed.status}`)
  }
  if (!reasonMatches) failedReasons.push('reason keyword mismatch')
  if (!ingestMatches) failedReasons.push('ingest root-cause mismatch')
  results.corpus.push({
    id: name.replace('.json', ''),
    expected: verdict,
    observed,
    status: ok ? 'PASS' : 'FAILED',
    failed_reasons: failedReasons,
  })
  if (ok) results.totals.passed += 1
  else results.totals.failed += 1
}

results.completedAt = new Date().toISOString()
writeFileSync(join(__dirname, 'fault-results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results.totals, null, 2))
process.exit(results.totals.failed === 0 ? 0 : 1)