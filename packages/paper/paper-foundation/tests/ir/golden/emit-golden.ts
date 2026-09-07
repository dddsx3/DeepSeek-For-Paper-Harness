/**
 * TASK-T1-S2 / expert plan P0-B — emit the golden fingerprint fixture.
 *
 * One-shot generator: writes `golden/ir-fingerprints-v1.json` from the
 * canonical backbone chain. Run it ONLY when a deliberate fingerprint
 * semantics change lands (new namespace, new edge field) — the updated
 * golden must ship in the same commit as the semantics change, and the
 * commit message must name the change (migration rule, golden spec header).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  ModelingIr,
  buildEvidenceFreeze,
  dependencyClosureFingerprint,
  dependencyEdgeFingerprint,
} from '../../../src/ir/index.ts'
import { backboneIr } from '../fixtures.ts'

const ir: ModelingIr = backboneIr()
const snapshot = ModelingIr.snapshot(ir)!
const freeze = buildEvidenceFreeze(snapshot, { now: () => '2026-09-08T00:00:00.000Z' })
const run = [...snapshot.values()].find(r => r.kind === 'RunArtifact')!
const modelRecord = snapshot.get((run.value as { model_ref: string }).model_ref)
const model = modelRecord?.value as Readonly<Record<string, unknown>> | undefined
const edge = {
  input_data_refs: (run.value as { input_data_refs: ReadonlyArray<string> }).input_data_refs,
  parameter_refs: (model?.['parameter_refs'] ?? []) as ReadonlyArray<unknown>,
  assumption_refs: (model?.['assumption_refs'] ?? []) as ReadonlyArray<string>,
  equation_refs: (model?.['equation_refs'] ?? []) as ReadonlyArray<string>,
}

const doc = {
  golden_version: 1,
  generated_from: 'validChain()/backboneIr() fixtures',
  environment_hash: freeze.runs[0]!.environment_hash,
  dependency_edge_hash: dependencyEdgeFingerprint(edge),
  dependency_closure_hash: dependencyClosureFingerprint(edge, ref => {
    const record = snapshot.get(ref)
    return record === undefined ? undefined : record.value as Readonly<Record<string, unknown>>
  }),
  freeze_hash: freeze.freeze_hash,
  manifest_hash: freeze.manifest_hash,
  evidence_chain_hash: freeze.claims[0]!.evidence_chain_hash,
}

const out = resolve(import.meta.dirname, 'ir-fingerprints-v1.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`golden written: ${out}`)
console.log(`  edge     ${doc.dependency_edge_hash.slice(0, 16)}…`)
console.log(`  closure  ${doc.dependency_closure_hash.slice(0, 16)}…`)
console.log(`  freeze   ${doc.freeze_hash.slice(0, 16)}…`)
