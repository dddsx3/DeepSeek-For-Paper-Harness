#!/usr/bin/env node
/**
 * TASK 3 — targeted mutation runner (P-01..P-08, task book §8).
 *
 * Same discipline as TASK 1.5R / 2 / 2.1: weaken exactly one guard,
 * run the targeted suite, restore. Byte-exact anchors; a drifted
 * anchor yields "anchor not found". Survivors are missing tests.
 *
 * Usage:
 *   node artifacts/handoff/TASK-3/run-mutations.mjs <repo-root> [P-01,...]
 *
 * Output: artifacts/handoff/TASK-3/mutation-results.json
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')
const only = process.argv[3] ? process.argv[3].split(',').map(v => v.trim()).filter(Boolean) : null
const exec = (rel) => join(repoRoot, 'packages', 'paper', 'paper-foundation', 'src', 'execution', rel)

const MUTATIONS = [
  {
    id: 'P-01',
    guard: 'code hash check (record must freeze the run\'s declared code digest)',
    file: exec('audit.ts'),
    find: '      if (record.code_hash !== run.code_hash) {',
    replace: '      if (false) {',
  },
  {
    id: 'P-02',
    guard: 'output hash check (replayed output bytes must reproduce output_hash)',
    file: exec('replay.ts'),
    find: '  if (computedOutputHash !== record.output_hash) { // P-02',
    replace: '  if (false) { // P-02',
  },
  {
    id: 'P-03',
    guard: 'exit status check (NON_ZERO_EXIT fires)',
    file: exec('audit.ts'),
    find: '      if (record.exit_status !== 0) {',
    replace: '      if (false) {',
  },
  {
    id: 'P-04',
    guard: 'declared environment fingerprint check (ENVIRONMENT_MISMATCH fires)',
    file: exec('audit.ts'),
    find: '      if (declaredEnvironmentFingerprint(run) !== record.environment_hash) {',
    replace: '      if (false) {',
  },
  {
    id: 'P-05',
    guard: 'replay runs during the independent audit (skip = replay never runs)',
    file: exec('audit.ts'),
    find: '  for (const record of manifest.records) { // P-05 anchor: skipping the loop = replay never runs',
    replace: '  for (const record of [] as FrozenExecutionRecord[]) { // P-05 anchor: skipping the loop = replay never runs',
  },
  {
    id: 'P-06',
    guard: 'execution manifest integrity check (forged manifest refused)',
    file: exec('audit.ts'),
    find: '  if (recomputed !== manifest.manifest_hash) {',
    replace: '  if (false) {',
  },
  {
    id: 'P-07',
    guard: 'seed binding check (EX-07 seed drift fires)',
    file: exec('audit.ts'),
    find: '      if (record.seed !== run.seed) {',
    replace: '      if (false) {',
  },
  {
    id: 'P-08',
    guard: 'dependency drift check (EX-04 dependency fingerprint fires)',
    file: exec('audit.ts'),
    find: '      if (declaredDependencyLockFingerprint(run, model) !== record.dependency_lock_hash) {',
    replace: '      if (false) {',
  },
]

function runTargetedSuite() {
  const vitest = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--project=thread-safe',
      '--maxWorkers=1',
      '--no-file-parallelism',
      'packages/paper/paper-foundation/tests/execution/capture-replay.spec.ts',
      'packages/paper/paper-foundation/tests/execution/provenance-gate.spec.ts',
      'packages/paper/paper-foundation/tests/rt-x/',
      'packages/paper/paper-foundation/tests/ir/execution-record.spec.ts',
    ],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' } },
  )
  return {
    ok: vitest.status === 0,
    detail: { vitest: vitest.status === 0 ? 'pass' : `exit ${vitest.status}` },
  }
}

const results = []
console.log('Baseline (unmutated) check...')
const baseline = runTargetedSuite()
if (!baseline.ok) {
  console.error('Baseline suite is not green; refusing to mutate.', JSON.stringify(baseline.detail))
  process.exit(2)
}
console.log('baseline green\n')

for (const m of MUTATIONS) {
  if (only !== null && !only.includes(m.id)) continue
  const original = readFileSync(m.file, 'utf8')
  if (!original.includes(m.find)) {
    results.push({ ...m, status: 'ERROR', reason: 'anchor not found in source' })
    console.log(`${m.id} ERROR: anchor not found`)
    continue
  }
  writeFileSync(m.file, original.replace(m.find, m.replace))
  const outcome = runTargetedSuite()
  writeFileSync(m.file, original) // restore first, always

  const status = outcome.ok ? 'SURVIVED' : 'killed'
  results.push({ id: m.id, guard: m.guard, status, detail: outcome.detail })
  console.log(`${m.id} ${status === 'killed' ? 'killed  ' : 'SURVIVED'} — ${m.guard}`)
}

const killed = results.filter(r => r.status === 'killed').length
const summary = {
  task: 'TASK 3 — Execution Provenance Gate',
  phase: 'PHASE 6 — Targeted Mutation',
  baseline: 'green',
  subset: only ?? undefined,
  totals: { total: results.length, killed, survived: results.length - killed },
  mutations: results,
}
const outName = only === null ? 'mutation-results.json' : `mutation-results-subset-${only.join('_')}.json`
writeFileSync(join(__dirname, outName), JSON.stringify(summary, null, 2))
console.log(`\nwrote ${outName}`)
console.log('\n' + JSON.stringify(summary.totals, null, 2))
process.exit(summary.totals.survived === 0 ? 0 : 1)