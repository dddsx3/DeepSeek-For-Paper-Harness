#!/usr/bin/env node
/**
 * TASK 1.5 PHASE 7 — targeted mutation runner.
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
 * Usage:
 *   node artifacts/handoff/TASK-1.5/run-mutations.mjs <repo-root>
 *
 * Output: artifacts/handoff/TASK-1.5/mutation-results.json
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')
// Optional third argument: a comma-separated subset of mutation ids, so a
// small source change does not require re-running the whole ~12 minute sweep.
const only = process.argv[3] ? process.argv[3].split(',').map(v => v.trim()).filter(Boolean) : null
const pkg = join(repoRoot, 'packages', 'paper', 'paper-foundation')
const src = (rel) => join(pkg, 'src', 'ir', rel)

/** Every mutation: one guard, one surgical edit. */
const MUTATIONS = [
  {
    id: 'M-01',
    guard: 'DataArtifact content_hash format',
    file: src('problem-contract.ts'),
    find: "  .regex(/^sha256:[0-9a-f]{64}$/, 'content_hash must be sha256:<64 lowercase hex>')",
    replace: '',
  },
  {
    id: 'M-02',
    guard: 'requirement_ref resolves to a RequirementSpec (kind check)',
    file: src('problem-contract.ts'),
    find: "      } else if (target.kind !== 'RequirementSpec') {",
    replace: '      } else if (false) {',
  },
  {
    id: 'M-03',
    guard: 'ProblemSpec raw source <-> RequirementSpec source consistency',
    file: src('problem-contract.ts'),
    find: 'if (typeof reqSource === \'string\' && reqSource !== rawRef) {',
    replace: 'if (false) {',
  },
  {
    id: 'M-04',
    guard: 'SymbolSpec same-scope token uniqueness',
    file: src('problem-contract.ts'),
    find: '  const seen = new Map<string, { readonly scope_ref: string; readonly token: string; readonly symbol_id: string }>()',
    replace: '  return []\n  // eslint-disable-next-line no-unreachable\n  const seen = new Map<string, { readonly scope_ref: string; readonly token: string; readonly symbol_id: string }>()',
  },
  {
    id: 'M-05',
    guard: 'ModelSpec.variable_refs points at a VARIABLE',
    file: src('problem-contract.ts'),
    find: "        } else if (target.role !== 'VARIABLE') {",
    replace: '        } else if (false) {',
  },
  {
    id: 'M-06',
    guard: 'ModelSpec.parameter_refs points at a PARAMETER',
    file: src('problem-contract.ts'),
    find: "        } else if (target.role !== 'PARAMETER') {",
    replace: '        } else if (false) {',
  },
  {
    id: 'M-07',
    guard: 'RunArtifact.input_data_refs points at an INPUT_DATA DataArtifact',
    file: src('problem-contract.ts'),
    find: "      } else if (target.role !== 'INPUT_DATA') {",
    replace: '      } else if (false) {',
  },
  {
    id: 'M-08',
    guard: 'FigureSpec.data_refs is Result | DataArtifact',
    file: src('problem-contract.ts'),
    find: "      } else if (target.kind !== 'Result' && target.kind !== 'DataArtifact') {",
    replace: '      } else if (false) {',
  },
  {
    id: 'M-09',
    guard: 'FORMAL/FAST minimum Problem Contract bridge check',
    file: src('bridge.ts'),
    find: '    && (!requiresBackbone || contractSatisfied)\n',
    replace: '',
  },
  {
    id: 'M-10',
    guard: 'legacy nested shape rejection (ProblemSpec strict schema)',
    file: src('schema.ts'),
    find: '    requirement_refs: zod.array(refSchema),\n  })\n  .strict()',
    replace: '    requirement_refs: zod.array(refSchema),\n  })',
  },
  // Guards added by the TASK 1.5 red team (PHASE 6). Mutating them proves the
  // fixes are covered, not just present.
  {
    id: 'M-11',
    guard: 'SymbolSpec token must be NFC (RT-D-01)',
    file: src('problem-contract.ts'),
    find: "  .refine(v => v === v.normalize('NFC'), 'token must be in Unicode NFC form')",
    replace: '',
  },
  {
    id: 'M-12',
    guard: 'orphan ModelSpec still faces the symbol guards (RT-B-01)',
    file: src('bridge.ts'),
    find: '  const orphanModelSpecs = modelSpecs.filter(m => !claimedModelIds.has(String(m[\'model_id\'])))',
    replace: '  const orphanModelSpecs: ReadonlyArray<Readonly<Record<string, unknown>>> = []',
  },
  {
    id: 'M-13',
    guard: 'ProblemSpec must reference a REQUIRED_OUTPUT (RT-C-01)',
    file: src('problem-contract.ts'),
    find: '    if (!declaresRequiredOutput) {',
    replace: '    if (false) {',
  },
  {
    id: 'M-14',
    guard: 'typed-ingress size budget (RT-A-02)',
    file: src('parse.ts'),
    find: '  if (budget.nodes > MAX_IR_VALUE_NODES) return \'too_large\'',
    replace: '  if (false) return \'too_large\'',
  },
]

/** The targeted suite: the IR unit tests plus the fault corpus. */
function runTargetedSuite() {
  // Spawn the vitest entry point directly rather than through `npx`: a bare
  // `npx` has no shell to resolve through here and exits null instead of
  // running, which would silently read as "suite passed".
  const vitest = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--project=thread-safe',
      'packages/paper/paper-foundation/tests/ir/',
    ],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
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
  task: 'TASK 1.5 — Canonical Problem Contract',
  phase: 'PHASE 7 — Targeted Mutation',
  baseline: 'green',
  // Set only when a subset was requested. A partial sweep must not be
  // mistaken for a full one in the handoff record, so the ids are recorded
  // and the output file is named accordingly.
  subset: only ?? undefined,
  totals: { total: results.length, killed, survived: results.length - killed },
  mutations: results,
}
const outName = only === null ? 'mutation-results.json' : `mutation-results-subset-${only.join('_')}.json`
writeFileSync(join(__dirname, outName), JSON.stringify(summary, null, 2))
console.log(`\nwrote ${outName}`)
console.log('\n' + JSON.stringify(summary.totals, null, 2))
process.exit(summary.totals.survived === 0 ? 0 : 1)
