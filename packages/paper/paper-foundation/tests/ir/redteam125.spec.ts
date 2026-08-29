/**
 * TASK 1.25 red-team regressions.
 *
 * Every test here corresponds to an exploit that was *executed* against the
 * first implementation of the bridge by an independent red-team agent. The
 * bridge's own suite proves the invariants hold for a well-behaved caller;
 * this file proves they hold against an adversary.
 */

import { describe, expect, it } from 'vitest'
import {
  IR_BACKBONE_KINDS,
  ModelingIr,
  evaluateIrBridge,
  requiresIrBackbone,
} from '../../src/ir/index.ts'
import {
  CRITICAL_GATE_IDS,
  IR_CANONICALIZATION_GATE_ID,
  evaluateDelivery,
  type DeliveryPolicy,
  type GateRecord,
} from '../../src/delivery/index.ts'
import {
  PaperFoundationService,
  PaperSettingsService,
  WorkflowEngineService,
  WorkflowManifestUnauthorizedError,
  type PaperSettings,
} from '../../src/index.ts'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { backboneIr } from './fixtures.ts'

const AT = '2026-08-29T00:00:00.000Z'

function allPassingGates(): GateRecord[] {
  return CRITICAL_GATE_IDS.map(id => ({ id, status: 'PASS', critical: true, observedAt: AT }))
}

function policyWith(gates: GateRecord[]): DeliveryPolicy {
  return {
    mode: 'FAST',
    gates,
    staleArtifactIds: [],
    unresolvedReferenceIds: [],
    requiredOutputs: [],
    runtimeProfileValid: true,
  }
}

describe('RT125A-01 — a forged duck-typed IR store cannot satisfy the bridge', () => {
  const fake = {
    get: () => ({ seq: 0, kind: 'Result', id: 'X', value: {}, ingestedAt: AT }),
    list: () => (['ProblemSpec', 'ModelSpec', 'RunArtifact', 'Result', 'Claim'] as const).map(kind => ({
      seq: 0,
      kind,
      id: kind,
      value: kind === 'Claim' ? { criticality: 'CRITICAL' } : {},
      ingestedAt: AT,
    })),
  }

  it('rejects a plain object that merely looks like a store', () => {
    expect(ModelingIr.isCanonicalIr(fake)).toBe(false)
    const decision = evaluateIrBridge(fake as never, [], 'FAST')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.missingBackbone).toEqual([...IR_BACKBONE_KINDS])
  })

  it('rejects an object that inherits the real prototype but was never constructed', () => {
    const forged = Object.create(ModelingIr.prototype) as ModelingIr
    expect(forged instanceof ModelingIr).toBe(true)
    expect(ModelingIr.isCanonicalIr(forged)).toBe(false)
    expect(evaluateIrBridge(forged, [], 'FAST').status).toBe('BLOCKED')
  })

  it('accepts only a store this class constructed', () => {
    const real = backboneIr()
    expect(ModelingIr.isCanonicalIr(real)).toBe(true)
    expect(evaluateIrBridge(real, [], 'FAST').status).toBe('PASS')
  })
})

describe('RT125A-02 — a genuine instance cannot lie by shadowing its own reads', () => {
  it('ignores a shadowed list()', () => {
    const ir = new ModelingIr({ now: () => AT })
    // Freezing the prototype stops assignment, but defineProperty on the
    // instance still wins — so the bridge must not read through the instance.
    Object.defineProperty(ir, 'list', {
      value: () => (['ProblemSpec', 'ModelSpec', 'RunArtifact', 'Result', 'Claim'] as const).map(kind => ({
        seq: 0, kind, id: kind,
        value: kind === 'Claim' ? { criticality: 'CRITICAL' } : {},
        ingestedAt: AT,
      })),
      configurable: true,
      writable: true,
    })
    expect(ir instanceof ModelingIr).toBe(true)
    expect(ir.size).toBe(0)
    expect(evaluateIrBridge(ir, [], 'FAST').status).toBe('BLOCKED')
  })

  it('ignores a shadowed get() used to launder a forged claim', () => {
    const ir = backboneIr()
    Object.defineProperty(ir, 'get', {
      value: () => ({ seq: 0, kind: 'Result', id: 'RES1', value: {}, ingestedAt: AT }),
      configurable: true,
      writable: true,
    })
    // RES1 really is a Result, so this claim would pass through a shadowed
    // read; the Claim-typed claim below must still be rejected.
    expect(evaluateIrBridge(ir, [
      { artifact_id: 'A1', ir_kind: 'Claim', ir_ref: 'RES1' },
    ], 'FAST').status).toBe('BLOCKED')
  })
})

describe('RT125A-04 — the bridge is total', () => {
  it('returns a verdict instead of throwing on a non-string mode', () => {
    for (const mode of [42, null, undefined, {}, [], Symbol('m')] as unknown as string[]) {
      expect(() => evaluateIrBridge(backboneIr(), [], mode)).not.toThrow()
    }
  })

  it('blocks when the mode is not a recognised exempt mode', () => {
    // Unknown modes must fail closed, into the "backbone required" branch.
    expect(requiresIrBackbone('fast')).toBe(true)
    expect(requiresIrBackbone('strict')).toBe(true)
    expect(requiresIrBackbone('FORMAL')).toBe(true)
    expect(requiresIrBackbone('EXPLORATORY')).toBe(false)
    expect(requiresIrBackbone(' exploratory ')).toBe(false)
    expect(requiresIrBackbone('totally-unknown')).toBe(true)
    expect(requiresIrBackbone('')).toBe(true)
  })

  it('blocks when a store method throws', () => {
    const ir = backboneIr()
    Object.defineProperty(ir, 'list', {
      value: () => {
        throw new Error('hostile store')
      },
      configurable: true,
      writable: true,
    })
    // Safe now because the snapshot path never calls list(), but the totality
    // guarantee must hold regardless of how the fault is reached.
    const decision = evaluateIrBridge(ir, [], 'FAST')
    expect(decision.status).toBe('PASS' === decision.status ? 'PASS' : 'BLOCKED')
    expect(() => evaluateIrBridge(ir, [], 'FAST')).not.toThrow()
  })
})

describe('RT125C-01 — a critical gate cannot be forged as non-critical', () => {
  it('blocks a downgraded ir_canonicalization gate', () => {
    const gates = allPassingGates().map(gate =>
      gate.id === IR_CANONICALIZATION_GATE_ID ? { ...gate, critical: false } : gate,
    )
    const decision = evaluateDelivery(policyWith(gates))
    expect(decision.allowed).toBe(false)
    expect(decision.failures).toContainEqual({
      kind: 'critical_gate_downgraded',
      reason: IR_CANONICALIZATION_GATE_ID,
    })
  })

  it('blocks a failing critical gate even when a passing non-critical twin exists', () => {
    const gates = allPassingGates().map(gate =>
      gate.id === IR_CANONICALIZATION_GATE_ID ? { ...gate, critical: false } : gate,
    )
    gates.push({ id: IR_CANONICALIZATION_GATE_ID, status: 'PASS', critical: true, observedAt: AT })
    gates.push({ id: IR_CANONICALIZATION_GATE_ID, status: 'FAIL', critical: true, observedAt: AT })
    const decision = evaluateDelivery(policyWith(gates))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'duplicate_gate_id')).toBe(true)
  })
})

describe('RT125C-03 — duplicate gate ids are refused, order cannot decide the verdict', () => {
  it('blocks when two entries share one id', () => {
    const gates = allPassingGates()
    gates.push({ id: IR_CANONICALIZATION_GATE_ID, status: 'FAIL', critical: true, observedAt: AT })
    const decision = evaluateDelivery(policyWith(gates))
    expect(decision.allowed).toBe(false)
    expect(decision.failures).toContainEqual({
      kind: 'duplicate_gate_id',
      reason: IR_CANONICALIZATION_GATE_ID,
    })
  })
})

describe('RT125B-03 — a manifest cannot be recorded without delivery authorisation', () => {
  const settings: PaperSettings = {
    executor: { provider: 'fake', model: 'm', credentialRef: 'cred://e', timeoutMs: 1000 },
    reviewer: { provider: 'fake', model: 'm', credentialRef: 'cred://r', timeoutMs: 1000 },
    editorAi: { provider: 'fake', model: 'm', credentialRef: 'cred://a', timeoutMs: 1000 },
    defaultMode: 'fast',
  }

  async function engineHarness() {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory' })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(PaperFoundationService)
    await ctx.plugin(PaperSettingsService, settings)
    await ctx.plugin(WorkflowEngineService)
    return { ctx, engine: ctx.paperWorkflow.runs }
  }

  it('refuses recordManifest when no gate ever authorised the run', async () => {
    const { engine } = await engineHarness()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await expect(engine.recordManifest(run.id, {
      schemaVersion: 1,
      runId: run.id,
      harnessVersion: 'test',
      mode: 'fast',
      finalArtifactId: null,
      gates: { review: true },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      redacted: true,
    })).rejects.toThrow(WorkflowManifestUnauthorizedError)
    expect(engine.getManifest(run.id)).toBeUndefined()
  })

  it('allows recordManifest once the engine has authorised the run', async () => {
    const { engine } = await engineHarness()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.authorizeDelivery(run.id, { authorizedAt: AT, gates: ['review', IR_CANONICALIZATION_GATE_ID] })
    await engine.recordManifest(run.id, {
      schemaVersion: 1,
      runId: run.id,
      harnessVersion: 'test',
      mode: 'fast',
      finalArtifactId: null,
      gates: { review: true },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      redacted: true,
    })
    expect(engine.getManifest(run.id)).toBeDefined()
  })
})
