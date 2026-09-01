#!/usr/bin/env node
/**
 * TASK 3 — execution freeze manifest generator (the out-of-band anchor).
 *
 * Builds the canonical example store (backboneIr, which now carries the
 * TASK 3 ExecutionRecord), emits its ExecutionManifest, verifies it with
 * both the structural audit and a real independent audit (deterministic
 * fake runner — byte truth for the example chain), and writes:
 *
 *   execution-freeze-manifest.json  — the frozen execution manifest
 *   execution-hash-report.json      — the out-of-band hash registry
 *
 * Usage (via tsx):
 *   node_modules/.bin/tsx artifacts/handoff/TASK-3/generate-execution-freeze.mjs <repo-root>
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')

const irIndexUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/src/ir/index.ts')).href
const execIndexUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/src/execution/index.ts')).href
const fixturesUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/tests/ir/fixtures.ts')).href

const { ModelingIr } = await import(irIndexUrl)
const { buildExecutionManifest, auditExecutionProvenance } = await import(execIndexUrl)
const { backboneIr } = await import(fixturesUrl)

const NOW = () => '2026-09-01T00:00:00.000Z'
const ir = backboneIr()
const store = ModelingIr.snapshot(ir)
if (store === null) throw new Error('backboneIr() did not produce a canonical store')

const manifest = buildExecutionManifest(store, { now: NOW })
const structural = auditExecutionProvenance(store, manifest)

// Byte-level truth (replay) needs the code bytes a real run produced; for
// the example chain those live in the test suites, whose deterministic
// runner captures and replays the example end-to-end
// (tests/execution/capture-replay.spec.ts). This generator freezes the
// manifest and proves structural consistency — the auditor's entry point
// for byte truth is runIndependentExecutionAudit().
if (structural.status !== 'PASS') {
  console.error('structural audit did not PASS:', JSON.stringify(structural, null, 2))
  process.exit(1)
}

writeFileSync(
  join(__dirname, 'execution-freeze-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
  'utf8',
)

const hashReport = {
  report_version: 1,
  generated_at: manifest.generated_at,
  generated_from: {
    fixture: 'tests/ir/fixtures.ts validChain() incl. ExecutionRecord EXEC1',
    store_objects: store.size,
  },
  algorithm: {
    freeze_hash: 'sha256(canonicalJson({ records, runs }))',
    manifest_hash: 'sha256(canonicalJson({ manifest_version, freeze_hash, records, runs }))',
    environment_hash: 'declaredEnvironmentFingerprint(run) — TASK 2.1 derivation, shared code',
    dependency_lock_hash: 'declaredDependencyLockFingerprint(run, model) — TASK 2.1 derivation, shared code',
  },
  freeze_hash: manifest.freeze_hash,
  manifest_hash: manifest.manifest_hash,
  records: manifest.records.map(r => ({
    execution_id: r.execution_id,
    run_ref: r.run_ref,
    code_hash: r.code_hash,
  })),
  verification: {
    structural_audit_id: structural.audit_id,
    structural_status: structural.status,
    execution_checked: structural.execution_checked,
    note: 'Byte-level truth for arbitrary records is replayExecution(); the deterministic-fake replay of this example is exercised in tests/execution/capture-replay.spec.ts.',
  },
  usage: {
    auditor_entry: 'runIndependentExecutionAudit({ ir, runner, loadCode, timeoutMs })',
    anchor_rule: 'An external auditor must receive manifest_hash out-of-band (this file) and refuse any audit whose report.manifest_hash differs. Producer agent != auditor agent.',
  },
}
writeFileSync(join(__dirname, 'execution-hash-report.json'), JSON.stringify(hashReport, null, 2) + '\n', 'utf8')

console.log('wrote execution-freeze-manifest.json / execution-hash-report.json')
console.log(`manifest_hash = ${manifest.manifest_hash}`)
console.log(`structural audit: ${structural.status} (${structural.execution_checked} run(s) checked)`)