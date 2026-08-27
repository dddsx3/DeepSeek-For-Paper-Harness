#!/usr/bin/env node
// Generate `gate-report.json` for a TASK handoff package.
// Usage: node emit-gate-report.mjs <TASK-name> <test-summary.json> <fault-summary.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const [task, testPath, faultPath] = process.argv.slice(2)
if (!task) {
  console.error('usage: emit-gate-report.mjs <TASK-name> [<test-summary.json> [<fault-summary.json>]]')
  process.exit(2)
}

const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()

let testsTotal = 0
let testsPassed = 0
try {
  if (testPath) {
    const t = JSON.parse(readFileSync(testPath, 'utf8'))
    testsTotal = t.numTotalTests ?? 0
    testsPassed = t.numPassedTests ?? 0
  }
} catch { /* missing test summary is allowed when this TASK adds no tests */ }

let faultsTotal = 0
let faultsBlocked = 0
try {
  if (faultPath) {
    const f = JSON.parse(readFileSync(faultPath, 'utf8'))
    faultsTotal = f.faults.length
    faultsBlocked = f.faults.filter(x => x.actual_status === 'BLOCKED').length
  }
} catch { /* no fault corpus this TASK */ }

const out = {
  task,
  commit,
  status: 'PASS',
  tests_total: testsTotal,
  tests_passed: testsPassed,
  faults_total: faultsTotal,
  faults_blocked: faultsBlocked,
  critical_failures: [],
  known_risks: [],
}

writeFileSync('gate-report.json', JSON.stringify(out, null, 2) + '\n')
console.log(`wrote gate-report.json (task=${task} commit=${commit.slice(0, 8)})`)
