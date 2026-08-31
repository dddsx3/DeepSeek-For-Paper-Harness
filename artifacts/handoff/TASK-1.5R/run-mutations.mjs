#!/usr/bin/env node
/**
 * TASK 1.5R PHASE 5 — targeted mutation runner.
 *
 * A guard that no test notices is decoration. For each guard this script
 * deletes or weakens exactly one check in the source, runs the targeted
 * suite, and records whether the suite died. Then it restores the file.
 *
 *   killed   = the suite failed with the guard removed  (guard is load-bearing)
 *   SURVIVED = the suite stayed green                   (guard is untested)
 *
 * The task book's rule is explicit: a surviving mutation is not evidence that
 * the guard works, it is evidence that a test is missing. Survivors must be
 * fixed by adding a test, never by arguing the guard is fine.
 *
 * TASK 1.5R differs from TASK 1.5 in where the load-bearing guards live:
 * PHASE 3 moved structural existence/kind closure to the store boundary
 * (refs.ts / store.ts), so half of the anchors below are the closed policy
 * table itself, not the bridge. Each mutation is still one guard, one edit.
 *
 * The targeted suite is the IR vitest directory (which includes
 * `ref-closure.spec.ts`, `bridge-dedup.spec.ts`, `fault-corpus.spec.ts`, the
 * red-team files and the legacy suites) plus the standalone fault corpus —
 * the same two things the PHASE 6 full regression checks, minus the rest of
 * the package for speed.
 *
 * Usage:
 *   node artifacts/handoff/TASK-1.5R/run-mutations.mjs <repo-root> [M-01,M-02,...]
 *
 * Output: artifacts/handoff/TASK-1.5R/mutation-results.json
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

/** Every mutation: one guard, one surgical edit. */
const MUTATIONS = [
  // ---- store boundary (refs.ts / store.ts) — TASK 1.5R PHASE 1/2 anchors ----
  {
    id: 'M-01',
    guard: 'ProblemSpec.raw_problem_ref closes against DataArtifact at commit',
    file: src('refs.ts'),
    find: "{ path: 'raw_problem_ref', arity: 'single', target: 'DataArtifact' as const },",
    replace: "{ path: 'raw_problem_ref', arity: 'single', target: 'ANY' },",
  },
  {
    id: 'M-02',
    guard: 'ProblemSpec.requirement_refs closes against RequirementSpec at commit',
    file: src('refs.ts'),
    find: "{ path: 'requirement_refs', arity: 'many', target: 'RequirementSpec' as const },",
    replace: "{ path: 'requirement_refs', arity: 'many', target: 'ANY' },",
  },
  {
    id: 'M-03',
    guard: 'ModelSpec.variable_refs closes against SymbolSpec at commit',
    file: src('refs.ts'),
    find: "{ path: 'variable_refs', arity: 'many', target: 'SymbolSpec' as const },",
    replace: "{ path: 'variable_refs', arity: 'many', target: 'ANY' },",
  },
  {
    id: 'M-04',
    guard: 'parameter_refs[].symbol_ref nested extractor walks every entry at commit',
    file: src('refs.ts'),
    find: "    for (let i = 0; i < entries.length; i += 1) {",
    replace: "    for (let i = 0; i < 0; i += 1) {",
  },
  {
    id: 'M-05',
    guard: 'RunArtifact.input_data_refs closes against DataArtifact at commit',
    file: src('refs.ts'),
    find: "{ path: 'input_data_refs', arity: 'many', target: 'DataArtifact' as const },",
    replace: "{ path: 'input_data_refs', arity: 'many', target: 'ANY' },",
  },
  {
    id: 'M-06',
    guard: 'FigureSpec.data_refs uses the narrow Result|DataArtifact target set, not ANY',
    file: src('refs.ts'),
    find: "{ path: 'data_refs', arity: 'many', target: ['Result', 'DataArtifact'] as const },",
    replace: "{ path: 'data_refs', arity: 'many', target: 'ANY' },",
  },
  {
    id: 'M-07',
    guard: 'kind-union membership check (isAllowedTarget)',
    file: src('refs.ts'),
    find: "  if (!isAllowedTarget(target, actual)) {",
    replace: "  if (false) {",
  },
  {
    id: 'M-08',
    guard: 'store calls validateRefFields before commit',
    file: src('store.ts'),
    find: "    for (const problem of validateRefFields(kind, parsed.data, ref => this.#objects.get(ref)?.kind)) {",
    replace: "    for (const problem of []) {",
  },
  // ---- semantic guards (problem-contract.ts) — PHASE 3 anchors ----
  {
    id: 'M-09',
    guard: 'raw_problem_ref role must be RAW_PROBLEM (R-014)',
    file: src('problem-contract.ts'),
    find: "    } else if (target.role !== 'RAW_PROBLEM') {",
    replace: "    } else if (false) {",
  },
  {
    id: 'M-10',
    guard: 'input_data_refs role must be INPUT_DATA (R-015)',
    file: src('problem-contract.ts'),
    find: "      } else if (target.role !== 'INPUT_DATA') {",
    replace: "      } else if (false) {",
  },
  {
    id: 'M-11',
    guard: 'variable_refs role must be VARIABLE (R-016)',
    file: src('problem-contract.ts'),
    find: "        } else if (target.role !== 'VARIABLE') {",
    replace: "        } else if (false) {",
  },
  {
    id: 'M-12',
    guard: 'parameter_refs role must be PARAMETER (R-016)',
    file: src('problem-contract.ts'),
    find: "        } else if (target.role !== 'PARAMETER') {",
    replace: "        } else if (false) {",
  },
  {
    id: 'M-13',
    guard: 'Requirement source_data_ref == ProblemSpec.raw_problem_ref (R-017)',
    file: src('problem-contract.ts'),
    find: "        if (typeof reqSource === 'string' && reqSource !== rawRef) {",
    replace: "        if (false) {",
  },
  {
    id: 'M-14',
    guard: 'SymbolSpec same-scope token uniqueness (C-010/C-011)',
    file: src('problem-contract.ts'),
    find: "  const seen = new Map<string, { readonly scope_ref: string; readonly token: string; readonly symbol_id: string }>()",
    replace: "  return []\n  // eslint-disable-next-line no-unreachable\n  const seen = new Map<string, { readonly scope_ref: string; readonly token: string; readonly symbol_id: string }>()",
  },
]

/** The targeted suite: IR vitest dir (incl. ref-closure, bridge-dedup,
 *  fault-corpus, red-team) plus the standalone fault corpus.
 *
 *  `--no-file-parallelism` + `--maxWorkers=1` keep vitest from forking
 *  multiple workers; on this machine a parallel fork OOMs the Node process
 *  (`Fatal process out of memory`, CONTINUATION.md §2), which would read as
 *  a mutation kill that is really a machine artifact. */
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
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' } },
  )
  const corpus = spawnSync(process.execPath, [join(__dirname, 'run-fault-corpus.mjs'), repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
    console.log(`${m.id} ERROR: anchor not found`)
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
  task: 'TASK 1.5R — Canonical Reference Closure',
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
