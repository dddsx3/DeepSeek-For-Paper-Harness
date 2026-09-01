#!/usr/bin/env node
/**
 * TASK 2.1 — targeted mutation runner (E-01..E-08).
 *
 * Same discipline as TASK 1.5R / TASK 2: delete or weaken exactly one
 * guard in `evidence-freeze.ts`, run the targeted suite, and record
 * whether the suite died. Byte-exact anchors; a drifted anchor yields
 * "anchor not found" rather than a silent miss. Survivors are missing
 * tests, never "fine guards".
 *
 * Usage:
 *   node artifacts/handoff/TASK-2.1/run-mutations.mjs <repo-root> [E-01,E-02,...]
 *
 * Output: artifacts/handoff/TASK-2.1/mutation-results.json
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')
const only = process.argv[3] ? process.argv[3].split(',').map(v => v.trim()).filter(Boolean) : null
const src = (rel) => join(repoRoot, 'packages', 'paper', 'paper-foundation', 'src', 'ir', rel)

const MUTATIONS = [
  {
    id: 'E-01',
    guard: 'INV-2.1-A hash comparison runs (HASH_CHANGED fires)',
    file: src('evidence-freeze.ts'),
    find: '    if (liveChainHash !== frozen.evidence_chain_hash) {',
    replace: '    if (false) {',
  },
  {
    id: 'E-02',
    guard: 'result value/unit drift detection (RESULT_MISMATCH fires)',
    file: src('evidence-freeze.ts'),
    find: '      if (liveValue.value !== frozenResult.value || liveValue.unit !== frozenResult.unit) {',
    replace: '      if (false) {',
  },
  {
    id: 'E-03',
    guard: 'run code/environment fingerprint check (RUN_UNVERIFIED fires)',
    file: src('evidence-freeze.ts'),
    find: '      if (liveRunValue.code_hash !== frozenRun.code_hash || liveEnvHash !== frozenRun.environment_hash) {',
    replace: '      if (false) {',
  },
  {
    id: 'E-04',
    guard: 'audit verdict is computed from failures, never hardcoded PASS',
    file: src('evidence-freeze.ts'),
    find: "  const status: 'PASS' | 'FAIL' = failures.some(f => f.severity !== 'MEDIUM') ? 'FAIL' : 'PASS'",
    replace: "  const status: 'PASS' | 'FAIL' = 'PASS'",
  },
  {
    id: 'E-05',
    guard: 'numeric_binding is part of the evidence-chain hash (INV-2.1-A)',
    file: src('evidence-freeze.ts'),
    find: '      numeric_binding: binding,\n    },\n    evidence_refs: claim.evidence_refs,',
    replace: '      numeric_binding: null,\n    },\n    evidence_refs: claim.evidence_refs,',
  },
  {
    id: 'E-06',
    guard: 'manifest integrity check (RT-E4 tamper detection)',
    file: src('evidence-freeze.ts'),
    find: '  if (recomputedManifestHash !== manifest.manifest_hash) {',
    replace: '  if (false) {',
  },
  {
    id: 'E-07',
    guard: 'critical-claim failures carry CRITICAL/HIGH severity (verdict rule)',
    file: src('evidence-freeze.ts'),
    find: "    const sev = (s: 'CRITICAL' | 'HIGH') => (critical ? s : 'MEDIUM')",
    replace: "    const sev = (s: 'CRITICAL' | 'HIGH') => 'MEDIUM' as const",
  },
  {
    id: 'E-08',
    guard: 'unfrozen / vanishing claims are chain breaks (RT-E4-b self-approval)',
    file: src('evidence-freeze.ts'),
    find: '    if (live === undefined || frozen === undefined) {',
    replace: '    if (false) {',
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
      'packages/paper/paper-foundation/tests/ir/evidence-freeze.spec.ts',
      'packages/paper/paper-foundation/tests/rt-e/',
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
  task: 'TASK 2.1 — Evidence Chain Freeze Audit',
  phase: 'Targeted Mutation',
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