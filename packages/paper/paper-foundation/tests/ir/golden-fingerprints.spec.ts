/**
 * TASK-T1-S2 / expert plan P0-B — golden fingerprint fixtures.
 *
 * The freeze-side fingerprints (environment / dependency edge / closure)
 * are *contract* output: two implementations of the same semantics must
 * produce byte-identical hashes, or every freeze manifest ever written
 * silently loses its meaning. This suite pins the fingerprints of the
 * canonical `validChain()` fixtures as golden constants.
 *
 * Migration rule (expert plan §13 P0-B): a deliberate semantics change
 * (a new fingerprint namespace, a new ref field entering the edge set)
 * MUST land as an explicit golden update in the same commit, never as a
 * silent hash flip. If a test here goes red and you did not intend a
 * semantics change, you changed canonical serialization without noticing —
 * that is exactly the bug this file exists to catch.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  buildEvidenceFreeze,
  dependencyClosureFingerprint,
  dependencyEdgeFingerprint,
} from '../../src/ir/index.ts'
import { backboneIr } from './fixtures.ts'

/** The golden fixture — one JSON document, committed, hand-reviewed. */
const GOLDEN_PATH = new URL('./golden/ir-fingerprints-v1.json', import.meta.url)

/** Golden document shape (versioned; see `golden_version`). */
interface GoldenDoc {
  readonly golden_version: 1
  readonly generated_from: 'validChain()/backboneIr() fixtures'
  readonly environment_hash: string
  readonly dependency_edge_hash: string
  readonly dependency_closure_hash: string
  readonly freeze_hash: string
  readonly manifest_hash: string
  readonly evidence_chain_hash: string
}

function readGolden(): GoldenDoc {
  return JSON.parse(readFileSync(fileURLToPath(GOLDEN_PATH), 'utf8')) as GoldenDoc
}

/** Live fingerprints of the canonical backbone chain. */
function liveFingerprints() {
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
  return {
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
}

describe('golden fingerprints (expert plan P0-B)', () => {
  const golden = readGolden()
  const live = liveFingerprints()

  it('the golden document is a v1 fixture with all six fingerprints', () => {
    expect(golden.golden_version).toBe(1)
    for (const key of [
      'environment_hash', 'dependency_edge_hash', 'dependency_closure_hash',
      'freeze_hash', 'manifest_hash', 'evidence_chain_hash',
    ] as const) {
      expect(golden[key]).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('environment fingerprint matches the golden bytes', () => {
    expect(live.environment_hash).toBe(golden.environment_hash)
  })

  it('dependency edge fingerprint matches the golden bytes', () => {
    expect(live.dependency_edge_hash).toBe(golden.dependency_edge_hash)
  })

  it('dependency closure fingerprint matches the golden bytes', () => {
    expect(live.dependency_closure_hash).toBe(golden.dependency_closure_hash)
  })

  it('freeze_hash / manifest_hash / evidence_chain_hash match the golden bytes', () => {
    expect(live.freeze_hash).toBe(golden.freeze_hash)
    expect(live.manifest_hash).toBe(golden.manifest_hash)
    expect(live.evidence_chain_hash).toBe(golden.evidence_chain_hash)
  })

  it('live fingerprints are stable across rebuilds (clock-independent)', () => {
    const again = liveFingerprints()
    expect(again).toEqual(live)
  })
})
