import { describe, expect, it, vi } from 'vitest'
import {
  CRITICAL_GATE_IDS,
  evaluateDelivery,
  makeCandidateArtifact,
  promoteCandidateToDeliverable,
  type PromoterAuditEvent,
  type DeliveryPolicy,
  type GateRecord,
  type PromoterDeps,
} from '../../src/delivery/index.ts'

function allPassingGates(): GateRecord[] {
  return CRITICAL_GATE_IDS.map(id => ({
    id,
    status: 'PASS' as const,
    critical: true,
    observedAt: '2026-08-28T00:00:00.000Z',
  }))
}

function okPolicy(overrides: Partial<DeliveryPolicy> = {}): DeliveryPolicy {
  return {
    mode: 'FORMAL',
    gates: allPassingGates(),
    staleArtifactIds: [],
    unresolvedReferenceIds: [],
    requiredOutputs: [],
    runtimeProfileValid: true,
    replayedAt: null,
    deliveryReplayMaxAgeMs: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<PromoterDeps> = {}) {
  const audit = vi.fn<(e: PromoterAuditEvent) => void>()
  const writeFinalOutput = vi.fn(async (_path: string, _body: string) => {})
  const deps: PromoterDeps = {
    audit,
    now: () => '2026-08-28T00:02:00.000Z',
    writeFinalOutput,
    ...overrides,
  }
  return { deps, audit, writeFinalOutput }
}

describe('Promoter — Candidate -> Deliverable', () => {
  it('happy path: candidate + allowed decision + FORMAL → delivers, audit promotion_succeeded, finalOutputPath set', async () => {
    const candidate = makeCandidateArtifact({
      id: 'art-1',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:c1',
    })
    const policy = okPolicy()
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(true)

    const { deps, audit, writeFinalOutput } = makeDeps()
    const result = await promoteCandidateToDeliverable(
      candidate,
      policy,
      decision,
      deps,
      '/out/art-1.pdf',
      'PAYLOAD',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.artifact.state).toBe('DELIVERABLE')
    expect(result.artifact.finalOutputPath).toBe('/out/art-1.pdf')
    expect(result.artifact.promotedAt).toBe('2026-08-28T00:02:00.000Z')
    expect(result.artifact.verifiedAt).toBe('2026-08-28T00:02:00.000Z')
    expect(writeFinalOutput).toHaveBeenCalledTimes(1)
    expect(writeFinalOutput).toHaveBeenCalledWith('/out/art-1.pdf', 'PAYLOAD')
    expect(audit).toHaveBeenCalledTimes(1)
    const ev = audit.mock.calls[0]?.[0]
    expect(ev?.type).toBe('promotion_succeeded')
  })

  it('writeFinalOutput is called EXACTLY once on success (no double-write)', async () => {
    const candidate = makeCandidateArtifact({
      id: 'art-2',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:c2',
    })
    const policy = okPolicy()
    const decision = evaluateDelivery(policy)
    const { deps, writeFinalOutput } = makeDeps()
    await promoteCandidateToDeliverable(candidate, policy, decision, deps, '/out/x', 'P')
    expect(writeFinalOutput).toHaveBeenCalledTimes(1)
  })

  it('failure path: decision.allowed=false → writeFinalOutput NOT called, audit promotion_failed', async () => {
    const candidate = makeCandidateArtifact({
      id: 'art-3',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:c3',
    })
    // Inject a stale id so decision.allowed = false.
    const policy = okPolicy({ staleArtifactIds: ['stale-1'] })
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    const { deps, audit, writeFinalOutput } = makeDeps()
    const result = await promoteCandidateToDeliverable(
      candidate, policy, decision, deps, '/out/x', 'P',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('verification_not_passed')
    expect(writeFinalOutput).toHaveBeenCalledTimes(0)
    expect(audit).toHaveBeenCalledTimes(1)
    const ev = audit.mock.calls[0]?.[0]
    expect(ev?.type).toBe('promotion_failed')
  })

  it('FAST mode bypass attempt: critical gate missing from policy.gates → fast_mode_bypass_attempt', async () => {
    const candidate = makeCandidateArtifact({
      id: 'art-4',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:c4',
    })
    // FAST mode, decision is allowed, but a critical gate is missing.
    const policy = okPolicy({ mode: 'FAST' })
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(true)
    // Remove the execution gate record to simulate a FAST bypass attempt.
    const slimPolicy: DeliveryPolicy = {
      ...policy,
      gates: policy.gates.filter(g => g.id !== 'execution'),
    }
    const { deps, audit, writeFinalOutput } = makeDeps()
    const result = await promoteCandidateToDeliverable(
      candidate, slimPolicy, decision, deps, '/out/x', 'P',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('fast_mode_bypass_attempt')
    expect(writeFinalOutput).toHaveBeenCalledTimes(0)
    const ev = audit.mock.calls[0]?.[0]
    expect(ev?.type).toBe('promotion_failed')
  })

  it('wrong source state: calling promote() with a non-CANDIDATE artifact → wrong_source_state', async () => {
    const candidate = makeCandidateArtifact({
      id: 'art-5',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:c5',
    })
    // Caller is sloppy and passes the original candidate but mutates state to VERIFIED.
    const fakeVerified = { ...candidate, state: 'VERIFIED' as const, verifiedAt: '2026-08-28T00:01:00.000Z' }
    const policy = okPolicy()
    const decision = evaluateDelivery(policy)
    const { deps, writeFinalOutput } = makeDeps()
    const result = await promoteCandidateToDeliverable(
      fakeVerified, policy, decision, deps, '/out/x', 'P',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('wrong_source_state')
    expect(writeFinalOutput).toHaveBeenCalledTimes(0)
  })

  it('deliverable artifact has finalOutputPath set exactly when state = DELIVERABLE (already enforced by the schema; double-check here)', async () => {
    const candidate = makeCandidateArtifact({
      id: 'art-6',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:c6',
    })
    const policy = okPolicy()
    const decision = evaluateDelivery(policy)
    const { deps } = makeDeps()
    const result = await promoteCandidateToDeliverable(
      candidate, policy, decision, deps, '/out/six.pdf', 'P6',
    )
    if (!result.ok) throw new Error('expected success')
    expect(result.artifact.finalOutputPath).toBe('/out/six.pdf')
    expect(result.artifact.state).toBe('DELIVERABLE')
  })

  it('all required critical gate records must be present in FORMAL mode (sanity for the FAST-only bypass guard)', async () => {
    // This is the positive case that demonstrates the FAST-only bypass
    // guard is targeted, not a blanket restriction: FORMAL with the full
    // gate set still succeeds.
    const candidate = makeCandidateArtifact({
      id: 'art-7',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:c7',
    })
    const policy = okPolicy({ mode: 'FORMAL' })
    const decision = evaluateDelivery(policy)
    const { deps } = makeDeps()
    const result = await promoteCandidateToDeliverable(
      candidate, policy, decision, deps, '/out/seven.pdf', 'P7',
    )
    expect(result.ok).toBe(true)
  })
})
