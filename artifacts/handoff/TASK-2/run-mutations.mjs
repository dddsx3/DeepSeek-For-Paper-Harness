#!/usr/bin/env node
/**
 * TASK 2 — targeted mutation runner.
 *
 * Same logic as TASK 1.5R's runner: for each guard we delete or weaken
 * exactly one check, runs the IR vitest suite + the fault corpus, then
 * restores. The byte-exact anchor is mandatory: any anchor that drifts
 * (refactor, lint auto-fix, hand-edit) yields "anchor not found" rather
 * than a silent miss.
 *
 * Usage:
 *   node artifacts/handoff/TASK-2/run-mutations.mjs <repo-root> [M-01,M-02,...]
 *
 * Output:
 *   artifacts/handoff/TASK-2/mutation-results.json
 *
 * Exit code 0 when every mutation is killed, 1 otherwise.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')
const only = process.argv[3] ? process.argv[3].split(',').map(v => v.trim()).filter(Boolean) : null
const pkg = join(repoRoot, 'packages', 'paper', 'paper-foundation')
const src = (rel) => join(pkg, 'src', 'ir', rel)

/** One mutation = one guard, one surgical edit. The 7 mandated mutations
 *  from the task book §10 come first; the rest are defensive coverage
 *  of every other guard added in PHASE 1..4. */
const MUTATIONS = [
  // ----- 6 (well, 7) mandated by task book §10 ------------------------
  {
    id: 'M-01',
    guard: 'NUMERIC binding requirement (PHASE 1 discriminated union)',
    file: src('schema.ts'),
    find: "      numeric_binding: numericBindingSchema,\n",
    replace: "      // MUTATED: binding requirement removed\n      numeric_binding: numericBindingSchema.optional(),\n",
  },
  {
    id: 'M-02',
    guard: 'NUMERIC value equality (numericValuesEqual)',
    file: src('claim-evidence.ts'),
    find: "        if (typeof assertedValue === 'number' && !numericValuesEqual(assertedValue, target.value)) {\n",
    replace: "        if (false) {\n",
  },
  {
    id: 'M-03',
    guard: 'NUMERIC unit equality',
    file: src('claim-evidence.ts'),
    find: "        if (assertedUnit !== target.unit) {\n",
    replace: "        if (false) {\n",
  },
  {
    id: 'M-04',
    guard: 'snapshot walker inspects every CRITICAL Claim (D-013 reduction)',
    file: src('claim-evidence.ts'),
    find: "  for (const record of store.values()) {\n    if (record.kind !== 'Claim') continue\n",
    replace: "  for (const [index, record] of [...store.values()].entries()) {\n    if (record.kind !== 'Claim') continue\n    if (index > 0) break\n",
  },
  {
    id: 'M-05',
    guard: 'bridge walks the canonical snapshot, not artifact-subset (D-014 reduction)',
    file: src('bridge.ts'),
    find: "  const evidenceFailures = inspectClaimEvidence(store)\n",
    replace: "  // MUTATED: artifact-subset walker\n  const evidenceFailures: ReadonlyArray<import('./claim-evidence.ts').ClaimEvidenceFailure> = []\n",
  },
  {
    id: 'M-06',
    guard: 'MODEL Claim cannot carry numeric_binding (schema literal null)',
    file: src('schema.ts'),
    find: "      numeric_binding: zod.null(),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n      model_refs: zod.array(refSchema).min(1),\n",
    replace: "      numeric_binding: zod.unknown(),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n      model_refs: zod.array(refSchema).min(1),\n",
  },
  {
    id: 'M-07',
    guard: 'CRITICAL QUALITATIVE with zero evidence_refs is BLOCKED',
    file: src('claim-evidence.ts'),
    find: "      problems.push({\n        kind: 'qualitative_critical_no_evidence',\n",
    replace: "      // MUTATED: silent\n      // ",
  },

  // ----- Defensive coverage of every other guard ----------------------
  {
    id: 'M-08',
    guard: 'NUMERIC requires result_refs.min(1) at the schema boundary',
    file: src('schema.ts'),
    find: "      result_refs: zod.array(refSchema).min(1),\n",
    replace: "      result_refs: zod.array(refSchema),\n",
  },
  {
    id: 'M-09',
    guard: 'MODEL requires model_refs.min(1) at the schema boundary',
    file: src('schema.ts'),
    find: "      model_refs: zod.array(refSchema).min(1),\n",
    replace: "      model_refs: zod.array(refSchema),\n",
  },
  {
    id: 'M-10',
    guard: 'binding.result_ref must be in claim.result_refs',
    file: src('claim-evidence.ts'),
    find: "        if (resultRef === undefined || !resultRefs.includes(resultRef)) {\n",
    replace: "        if (false) {\n",
  },
  {
    id: 'M-11',
    guard: 'numeric_binding.result_ref must resolve to a Result',
    file: src('claim-evidence.ts'),
    find: "        problems.push({\n          kind: 'numeric_binding_result_unresolved',",
    replace: "        // MUTATED: silent\n        // ",
  },
  {
    id: 'M-12',
    guard: 'MODEL with phantom model_refs is BLOCKED',
    file: src('claim-evidence.ts'),
    find: "          problems.push({\n            kind: 'model_claim_no_model_ref',\n",
    replace: "          // MUTATED: silent\n          // ",
  },
  {
    id: 'M-13',
    guard: 'bridge refuses delivery when any CRITICAL Claim is invalid (INV-2-F)',
    file: src('bridge.ts'),
    find: "    && evidenceFailures.length === 0\n",
    replace: "    && false\n",
  },
  {
    id: 'M-14',
    guard: 'MODEL with empty model_refs is BLOCKED (semantic)',
    file: src('claim-evidence.ts'),
    find: "    if (modelRefs.length === 0) {\n      problems.push({\n        kind: 'model_claim_no_model_ref',\n        path: `${basePath}.model_refs`,\n        reason: 'MODEL Claim must reference at least one ModelSpec',\n      })\n    } else {",
    replace: "    if (false) {\n      problems.push({\n        kind: 'model_claim_no_model_ref',\n        path: `${basePath}.model_refs`,\n        reason: 'MODEL Claim must reference at least one ModelSpec',\n      })\n    } else {",
  },
  {
    id: 'M-15',
    guard: 'numericValuesEqual collapses -0/+0 (D-017 frozen policy)',
    file: src('claim-evidence.ts'),
    find: "export function numericValuesEqual(a: number, b: number): boolean {\n  return a === b\n}",
    replace: "export function numericValuesEqual(a: number, b: number): boolean {\n  return Object.is(a, b)\n}",
  },
  {
    id: 'M-16',
    guard: 'value mismatch branch in validator runs (defence in depth vs M-02)',
    file: src('claim-evidence.ts'),
    find: "if (typeof assertedValue === 'number' && !numericValuesEqual(assertedValue, target.value)) {\n",
    replace: "if (false) {\n",
  },
]

/** Targeted suite: the IR directory plus the standalone fault corpus. */
function runTargetedSuite() {
  const vitest = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--project=thread-safe',
      '--maxWorkers=1',
      '--no-file-parallelism',
      'packages/paper/paper-foundation/tests/ir/',
    ],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' } },
  )
  const corpus = spawnSync(
    process.execPath,
    [join(__dirname, 'run-fault-corpus.mjs'), repoRoot],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const vitestOk = vitest.status === 0
  const corpusOk = corpus.status === 0
  return {
    ok: vitestOk && corpusOk,
    detail: {
      vitest: vitestOk ? 'pass' : `exit ${vitest.status}`,
      faultCorpus: corpusOk ? 'pass' : `exit ${corpus.status}`,
    },
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
    console.log(`${m.id} ERROR: anchor not found in ${m.file.split(/[\\/]/).pop()}`)
    continue
  }
  writeFileSync(m.file, original.replace(m.find, m.replace))
  const outcome = runTargetedSuite()
  writeFileSync(m.file, original) // restore first, always

  const status = outcome.ok ? 'SURVIVED' : 'killed'
  results.push({ id: m.id, guard: m.guard, status, detail: outcome.detail })
  console.log(
    `${m.id} ${status === 'killed' ? 'killed  ' : 'SURVIVED'} — ${m.guard}`
    + (outcome.ok ? '' : `  (${JSON.stringify(outcome.detail)})`),
  )
}

const killed = results.filter(r => r.status === 'killed').length
const summary = {
  task: 'TASK 2 — Claim → Result → Run Evidence Chain',
  phase: 'PHASE 5 — Targeted Mutation',
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