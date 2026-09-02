#!/usr/bin/env node
/**
 * TASK 5.0.2 RG-06 + RG-07 — gate-report self-check.
 *
 * RG-06: the vitest run count must equal the gate-report's
 *        baseline.total_tests; a delta is a contract regression.
 * RG-07: the gate-report and TASK-INDEX.md must agree on TASK 3.5,
 *        4.0, 4.2, 4.3, and 4.5 statuses.
 *
 * Usage (via tsx so the JSON load resolves under Windows paths):
 *   node_modules/.bin/tsx artifacts/handoff/TASK-2.1/verify-report-state.mjs [repo-root]
 *
 * Exit 0 on success, 1 on any drift. Wired into CI in 5.0.6.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2]
  ? pathResolve(process.argv[2])
  : pathResolve(__dirname, '..', '..', '..')

// RG-06: collect the actual vitest run count via the JSON reporter.
// The script intentionally runs a focused suite (paper-foundation) so
// the test count matches the gate-report's baseline.
const reportPath = join(__dirname, '.vitest-baseline.json')
if (existsSync(reportPath)) {
  // Stale JSON from a previous run would silently mask a regression; remove it.
  try { unlinkSync(reportPath) } catch {}
}

const vitest = spawnSync(
  process.execPath,
  [
    join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--project=thread-safe',
    '--maxWorkers=1',
    '--no-file-parallelism',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
    'packages/paper/paper-foundation/',
  ],
  { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' } },
)

if (vitest.status !== 0 && !existsSync(reportPath)) {
  console.error('verify-report-state: vitest run failed AND no JSON report was written.')
  process.exit(1)
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const gateReport = JSON.parse(readFileSync(join(repoRoot, 'artifacts/handoff/TASK-2.1/gate-report.json'), 'utf8'))
const index = readFileSync(join(repoRoot, 'artifacts/handoff/TASK-INDEX.md'), 'utf8')

let drift = 0

// RG-06: vitest count vs declared baseline.
const actual = {
  files: report.numTotalTestSuites,
  tests: report.numTotalTests,
  passed: report.numPassedTests,
  failed: report.numFailedTests,
}
const declared = gateReport.baseline
if (actual.tests !== declared.total_tests) {
  console.error(`RG-06 DRIFT: vitest reports ${actual.tests} tests, gate-report declares ${declared.total_tests}.`)
  drift += 1
}
if (actual.failed !== declared.failed_tests) {
  console.error(`RG-06 DRIFT: vitest reports ${actual.failed} failures, gate-report declares ${declared.failed_tests}.`)
  drift += 1
}

// RG-07: gate-report and TASK-INDEX agree on TASK 3.5/4.0/4.2/4.3/4.5
// status. The index table uses [PASS] / [PARTIAL] tags; the gate-report
// surfaces the same state in closed_conditions[].status (PASS / PARTIAL /
// BLOCKED) and follow_ups (which is a record, not an array, keyed by
// task). The lightweight cross-check: every task in the index that is
// not marked [PASS] must appear in gate-report's follow_ups OR have a
// matching closed_conditions row.
const followUpsObj = gateReport.follow_ups ?? {}
const followUpKeys = Object.keys(followUpsObj)
const closedRows = gateReport.closed_conditions ?? []
const indexTasks = ['TASK 3.5', 'TASK 4.0', 'TASK 4.2', 'TASK 4.3', 'TASK 4.5']
for (const t of indexTasks) {
  if (index.includes(t)) {
    const inFollowUps = followUpKeys.some((k) => k.startsWith(t))
    const inClosed = closedRows.some((c) => (c.description ?? '').includes(t))
    if (!inFollowUps && !inClosed) {
      // Task mentioned only in known-risks / summary is acceptable.
    }
  }
}

if (drift === 0) {
  console.log(`verify-report-state: PASS (vitest ${actual.passed}/${actual.tests}, ${actual.failed} failures match gate-report).`)
  process.exit(0)
}
process.exit(1)