#!/usr/bin/env node
/**
 * TASK 3 PHASE 0 — Execution Freeze Snapshot generator (TASK-2.1's twin
 * for the execution layer).
 *
 * Builds the canonical example IR (the backboneIr fixture, which now
 * carries an ExecutionRecord via the producer-only entry — TASK 3.6
 * / INV-3-M), freezes the execution layer with `buildExecutionManifest`,
 * and emits:
 *
 *   execution-freeze-manifest.json  — the frozen execution manifest
 *   execution-hash-report.json      — the out-of-band hash registry
 *                                     (the replay_report_hash anchor)
 *
 * The script does NOT run a real replay (real-process smoke is
 * `run-real-execution-smoke.mjs` — separate job, 30s wall clock).
 * The structural audit is the entry point; the replay audit lives in
 * the same `evaluateProvenanceGate` path but the report shape is
 * surfaced for an external auditor to run via runner.
 *
 * Usage (via tsx so the TS source imports resolve):
 *   node_modules/.bin/tsx artifacts/handoff/TASK-2.1/generate-execution-freeze.mjs <repo-root>
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

const ir = backboneIr()
const store = ModelingIr.snapshot(ir)
if (store === null) throw new Error('backboneIr() did not produce a canonical store')

const manifest = buildExecutionManifest(store, { now: () => '2026-09-01T00:00:00.000Z' })
const structural = auditExecutionProvenance(store, manifest)
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
    fixture: 'tests/ir/fixtures.ts validChain() (TASK 3) incl. ExecutionRecord EXEC1',
    store_objects: store.size,
  },
  algorithm: {
    freeze_hash: 'sha256(canonicalJson({ records, runs }))',
    manifest_hash: 'sha256(canonicalJson({ manifest_version, freeze_hash, records, runs }))',
    replay_report_hash: 'sha256(canonicalJson({ manifest_hash, store_digest, failure_kinds, status })) — populated by runIndependentExecutionAudit()',
    environment_hash: 'declaredEnvironmentFingerprint(run) — TASK 2.1 derivation',
    dependency_lock_hash: 'declaredDependencyLockFingerprint(run, model) — TASK 2.1 derivation',
  },
  freeze_hash: manifest.freeze_hash,
  manifest_hash: manifest.manifest_hash,
  records: manifest.records.map(r => ({
    execution_id: r.execution_id,
    run_ref: r.run_ref,
    code_hash: r.code_hash,
    seed: r.seed,
  })),
  verification: {
    structural_audit_id: structural.audit_id,
    structural_status: structural.status,
    execution_checked: structural.execution_checked,
    replayed_at: structural.replayed_at,
    note: 'Replay audit (runIndependentExecutionAudit) is a separate run that fills replayed_at and replay_report_hash; this script only emits the structural freeze.',
  },
  usage: {
    auditor_entry: 'runIndependentExecutionAudit({ ir, runner, loadCode, timeoutMs })',
    anchor_rule: 'The out-of-band anchor is manifest_hash; producer != auditor. Any audit whose report.manifest_hash differs from the registry is rejected (RT-X1 anchor).',
  },
}
writeFileSync(join(__dirname, 'execution-hash-report.json'), JSON.stringify(hashReport, null, 2) + '\n', 'utf8')

console.log('wrote execution-freeze-manifest.json / execution-hash-report.json')
console.log(`manifest_hash = ${manifest.manifest_hash}`)
console.log(`structural audit: ${structural.status} (${structural.execution_checked} run(s) checked)`)