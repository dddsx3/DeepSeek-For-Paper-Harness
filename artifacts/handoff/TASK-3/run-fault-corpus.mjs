#!/usr/bin/env node
/**
 * TASK 3 — execution fault corpus driver (EX-01..EX-12 + RT-X1..X4).
 *
 * The corpus lives as executable attack specs (`tests/execution/` +
 * `tests/rt-x/`), where each EX id is a named test asserting the
 * observable BLOCK/FAIL verdict. This driver runs those suites through
 * vitest, parses the machine-readable result, and emits
 * `execution-results.json` — the auditable artifact for CLOSED C7.
 *
 * Usage:
 *   node artifacts/handoff/TASK-3/run-fault-corpus.mjs <repo-root>
 *
 * Exit 0 when every attack is intercepted (suite green), 1 otherwise.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')

const suite = spawnSync(
  process.execPath,
  [
    join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--project=thread-safe',
    '--maxWorkers=1',
    '--no-file-parallelism',
    '--reporter=json',
    '--outputFile.json=' + join(__dirname, '.vitest-corpus.json'),
    'packages/paper/paper-foundation/tests/execution/',
    'packages/paper/paper-foundation/tests/rt-x/',
  ],
  { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' } },
)

// The corpus suites are all-green by design (every attack is intercepted),
// so a non-zero vitest exit already means an attack escaped or a test broke.
let parsed = null
try {
  parsed = JSON.parse(readFileSync(join(__dirname, '.vitest-corpus.json'), 'utf8'))
} catch (error) {
  console.error('could not parse the vitest JSON report:', error instanceof Error ? error.message : error)
}

const summary = {
  task: 'TASK 3 — Execution Provenance Gate',
  phase: 'PHASE 5 — Execution Fault Corpus (EX-01..EX-12 + RT-X1..X4)',
  corpus: 'tests/execution/ + tests/rt-x/ (each EX/RT-X id is a named regression)',
  vitest_exit: suite.status,
  vitest_stderr_tail: (suite.stderr ?? '').split('\n').slice(-3).join('\n'),
  total_tests: parsed?.numTotalTests ?? null,
  passed: parsed?.numPassedTests ?? null,
  failed: parsed?.numFailedTests ?? null,
  pending: parsed?.numPendingTests ?? null,
  verdict: suite.status === 0 && (parsed === null || parsed.numFailedTests === 0)
    ? 'ALL ATTACKS INTERCEPTED'
    : 'ATTACK ESCAPED OR SUITE BROKEN',
  expectation: 'Every EX-01..EX-12 and RT-X test asserts the attack is BLOCKED/FAIL; a green suite is the evidence.',
}
writeFileSync(join(__dirname, 'execution-results.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.verdict === 'ALL ATTACKS INTERCEPTED' ? 0 : 1)