import { describe, expect, it, vi } from 'vitest'
import {
  createFormalProfile,
  runPreflight,
  type PreflightAuditEvent,
} from '../../src/runtime/index.ts'

const KNOWN_CONFIGS = new Set(['prod-eu-west-1', 'prod-us-east-1'])

function fullServices(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['paper.persistence', { ok: true }],
    ['paper.artifactStore', { ok: true }],
    ['paper.audit', { ok: true }],
    ['paper.verifierRegistry', { ok: true }],
    ['paper.deliveryPolicy', { ok: true }],
    ['paper.hashProvider', { ok: true }],
  ])
}

function servicesWithout(name: string): Map<string, unknown> {
  const m = fullServices()
  m.delete(name)
  return m
}

describe('PaperPreflight — attack tests', () => {
  // A-001
  it('A-001: storage (persistence) missing → blocks startup', () => {
    const profile = createFormalProfile()
    const events: PreflightAuditEvent[] = []
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: servicesWithout('paper.persistence'),
      knownProductionConfigs: KNOWN_CONFIGS,
      auditSink: e => events.push(e),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const kinds = result.missing.map(s => s.kind)
      expect(kinds).toContain('persistence')
    }
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0]!.type).toBe('preflight_missing')
    expect(events[0]!.missing.map(s => s.kind)).toContain('persistence')
  })

  // A-002
  it('A-002: artifact store missing → blocks startup', () => {
    const profile = createFormalProfile()
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: servicesWithout('paper.artifactStore'),
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const kinds = result.missing.map(s => s.kind)
      expect(kinds).toContain('artifact_store')
    }
  })

  // A-003
  it('A-003: verifier registry missing → blocks startup', () => {
    const profile = createFormalProfile()
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: servicesWithout('paper.verifierRegistry'),
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const kinds = result.missing.map(s => s.kind)
      expect(kinds).toContain('verifier_registry')
    }
  })

  // A-004
  it('A-004: delivery policy missing → blocks startup', () => {
    const profile = createFormalProfile()
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: servicesWithout('paper.deliveryPolicy'),
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const kinds = result.missing.map(s => s.kind)
      expect(kinds).toContain('delivery_policy')
    }
  })

  // A-005
  it('A-005: unknown production configuration → blocks startup with non-empty unknownConfig', () => {
    const profile = createFormalProfile()
    const result = runPreflight(profile, {
      productionConfig: 'shadow-rogue-region-9',
      availableServices: fullServices(),
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unknownConfig.length).toBeGreaterThan(0)
      expect(result.unknownConfig[0]).toBe('shadow-rogue-region-9')
    }
  })
})

describe('PaperPreflight — happy path and aggregate missing counts', () => {
  it('all six services present and known config → ok: true', () => {
    const profile = createFormalProfile()
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: fullServices(),
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(true)
  })

  it('missing exactly one service → missing.length === 1', () => {
    const profile = createFormalProfile()
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: servicesWithout('paper.audit'),
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing.length).toBe(1)
      expect(result.missing[0]!.kind).toBe('audit')
    }
  })

  it('missing two services → missing.length === 2', () => {
    const profile = createFormalProfile()
    const services = fullServices()
    services.delete('paper.audit')
    services.delete('paper.hashProvider')
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: services,
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing.length).toBe(2)
      const kinds = result.missing.map(m => m.kind)
      expect(kinds).toContain('audit')
      expect(kinds).toContain('hash_provider')
    }
  })

  it('audit sink is called even when unknownConfig and missing both fire', () => {
    const profile = createFormalProfile()
    const sink = vi.fn()
    const result = runPreflight(profile, {
      productionConfig: 'rogue-region',
      availableServices: servicesWithout('paper.audit'),
      knownProductionConfigs: KNOWN_CONFIGS,
      auditSink: sink,
    })
    expect(result.ok).toBe(false)
    expect(sink).toHaveBeenCalledTimes(1)
    const call = sink.mock.calls[0]![0] as PreflightAuditEvent
    expect(call.type).toBe('preflight_missing')
    expect(call.missing.map(s => s.kind)).toContain('audit')
    expect(call.unknownConfig).toEqual(['rogue-region'])
  })

  it('without an audit sink, preflight still blocks (stderr-only fallback)', () => {
    const profile = createFormalProfile()
    // Capture stderr to keep test output clean
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = runPreflight(profile, {
      productionConfig: 'prod-eu-west-1',
      availableServices: servicesWithout('paper.persistence'),
      knownProductionConfigs: KNOWN_CONFIGS,
    })
    expect(result.ok).toBe(false)
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
  })
})
