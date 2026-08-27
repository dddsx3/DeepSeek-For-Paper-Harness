#!/usr/bin/env node
// Run the test suite and capture a JUnit-style summary plus the raw output
// into `tests.txt` / `test-summary.json` (for `emit-gate-report.mjs`).
import { execSync, spawnSync } from 'node:child_process'
import { writeFileSync, existsSync } from 'node:fs'

const repo = process.cwd()
const reporterPath = 'artifacts/handoff/templates/vitest-junit.mjs'

if (!existsSync(reporterPath)) {
  console.error(`missing ${reporterPath}; ensure you are at the repo root`)
  process.exit(2)
}

const res = spawnSync(
  process.execPath,
  ['./node_modules/vitest/vitest.mjs', 'run', '--reporter=verbose', '--reporter=json', '--outputFile=test-results.json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)

const stdout = (res.stdout ?? '') + (res.stderr ?? '')
writeFileSync('tests.txt', stdout)

let summary = { numTotalTests: 0, numPassedTests: 0 }
try {
  // vitest json output is an object keyed by test-file path
  const j = JSON.parse(require('node:fs').readFileSync('test-results.json', 'utf8'))
  const files = Object.values(j)
  for (const f of files) {
    summary.numTotalTests += (f.numTotalTests ?? 0)
    summary.numPassedTests += (f.numPassedTests ?? 0)
  }
} catch { /* keep zeroed */ }
writeFileSync('test-summary.json', JSON.stringify(summary, null, 2))
console.log(`tests: ${summary.numPassedTests}/${summary.numTotalTests} passed; exit=${res.status}`)
process.exit(res.status ?? 0)
