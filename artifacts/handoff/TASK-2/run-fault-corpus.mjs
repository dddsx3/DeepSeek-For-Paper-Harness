#!/usr/bin/env node
/**
 * TASK 2 — fault corpus driver (D-001..D-020).
 *
 * Reads `faults/D-*.json` and `faults/D-*.verdict.json`, runs every
 * fixture through a real `ModelingIr`, then runs the bridge. The
 * runner is total (no `process.exit` on first failure) so a single
 * crashed fixture doesn't hide a green neighbour.
 *
 * Usage:
 *   node artifacts/handoff/TASK-2/run-fault-corpus.mjs <repo-root>
 *
 * Exit code: 0 when every verdict matches, 1 otherwise. The summary
 * is written to stdout in a stable, parse-friendly shape.
 *
 * Implementation note: this file is run via `tsx` (the package's dev
 * runtime, `node_modules/.bin/tsx`) so it can `import` the ESM/TS
 * source under `packages/paper/paper-foundation/src/ir/index.ts`
 * directly. Node's native ESM would refuse the `.ts` extension
 * without `--experimental-strip-types`, which is not stable across
 * LTS releases.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const repoRootArg = process.argv[2]
if (typeof repoRootArg !== 'string' || repoRootArg.length === 0) {
  console.error('usage: run-fault-corpus.mjs <repo-root>')
  process.exit(2)
}
const repoRoot = resolve(repoRootArg)

const irUrl = pathToFileURL(resolve(repoRoot, 'packages/paper/paper-foundation/src/ir/index.ts')).href
const irModule = await import(irUrl)
const { evaluateIrBridge, ModelingIr } = irModule

const faultDir = resolve(repoRoot, 'artifacts/handoff/TASK-2/faults')
const names = readdirSync(faultDir)
  .filter(n => n.endsWith('.json') && !n.endsWith('.verdict.json'))
  .sort()

const results = []
let failures = 0
for (const name of names) {
  const id = name.replace(/\.json$/, '')
  const fixture = JSON.parse(readFileSync(join(faultDir, name), 'utf8'))
  const verdict = JSON.parse(readFileSync(join(faultDir, name.replace('.json', '.verdict.json')), 'utf8'))

  const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
  const refused = []
  for (const entry of fixture.ingest) {
    const v = ir.put(entry.kind, entry.value)
    if (!v.accepted) refused.push({ kind: entry.kind, failures: v.failures })
  }
  const decision = evaluateIrBridge(ir, fixture.ir_claims ?? [], fixture.mode)

  const verdictMatch = decision.status === verdict.expected_status
  const reasonMatches = (verdict.expected_reason_matches ?? []).every(n => decision.reason.includes(n))
  const haystack = refused.flatMap(e => e.failures.map(f => `${f.path}:${f.kind}:${f.reason}`)).join(' | ')
  const ingestMatches = (verdict.expected_ingest_reason_matches ?? []).every(n => haystack.includes(n))

  const pass = verdictMatch && reasonMatches && ingestMatches
  if (!pass) failures += 1

  results.push({
    id, verdict, status: decision.status, pass,
    failures: {
      status: verdictMatch ? null : `expected ${verdict.expected_status}, got ${decision.status}`,
      reason: reasonMatches ? null : `missing needle(s) in reason "${decision.reason}"`,
      ingest: ingestMatches ? null : `missing needle(s) in ingest haystack "${haystack}"`,
    },
  })
}

const summary = {
  total: results.length,
  passed: results.length - failures,
  failed: failures,
  verdicts: results,
}
console.log(JSON.stringify(summary, null, 2))
process.exit(failures === 0 ? 0 : 1)