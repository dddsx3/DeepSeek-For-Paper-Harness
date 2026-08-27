import { describe, expect, it, vi } from 'vitest'
import {
  CapabilityFirewall,
  createFormalProfile,
  type AuditEvent,
} from '../../src/runtime/index.ts'

function makeFirewall() {
  const profile = createFormalProfile()
  const events: AuditEvent[] = []
  const sink = (e: AuditEvent) => { events.push(e) }
  return { profile, events, sink, firewall: new CapabilityFirewall(profile, sink) }
}

describe('CapabilityFirewall — attack tests', () => {
  // A-006
  it('A-006: REVIEW stage requesting shell is denied as forbidden_capability', () => {
    const { firewall, events } = makeFirewall()
    const decision = firewall.check({ stage: 'REVIEW', capability: 'shell', at: '2026-08-28T00:00:00Z' })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toBe('forbidden_capability')
    }
    expect(events.some(e => e.allowed === false && e.capability === 'shell' && e.stage === 'REVIEW')).toBe(true)
  })

  // A-007
  it('A-007: DELIVERY stage requesting write_model_spec is denied as not_in_whitelist', () => {
    const { firewall, events } = makeFirewall()
    const decision = firewall.check({ stage: 'DELIVERY', capability: 'write_model_spec', at: '2026-08-28T00:00:00Z' })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toBe('not_in_whitelist')
    }
    expect(events.some(e => e.allowed === false && e.capability === 'write_model_spec' && e.stage === 'DELIVERY')).toBe(true)
  })

  // A-008
  it('A-008: PLAN stage requesting solver is denied as not_in_whitelist', () => {
    const { firewall, events } = makeFirewall()
    const decision = firewall.check({ stage: 'PLAN', capability: 'solver', at: '2026-08-28T00:00:00Z' })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toBe('not_in_whitelist')
    }
    expect(events.some(e => e.allowed === false && e.capability === 'solver' && e.stage === 'PLAN')).toBe(true)
  })
})

describe('CapabilityFirewall — forbidden capability surface', () => {
  it('self_modify is denied in every stage', () => {
    const { firewall, events } = makeFirewall()
    for (const stage of ['PLAN', 'MODEL', 'EXECUTE', 'REVIEW', 'DELIVERY'] as const) {
      const decision = firewall.check({ stage, capability: 'self_modify', at: '2026-08-28T00:00:00Z' })
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toBe('forbidden_capability')
      }
    }
    // Five self_modify attempts, five audit events
    expect(events.filter(e => e.capability === 'self_modify').length).toBe(5)
  })

  it('web is denied in MODEL stage', () => {
    const { firewall, events } = makeFirewall()
    const decision = firewall.check({ stage: 'MODEL', capability: 'web', at: '2026-08-28T00:00:00Z' })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toBe('forbidden_capability')
    }
    expect(events.some(e => e.capability === 'web' && e.stage === 'MODEL' && e.allowed === false)).toBe(true)
  })
})

describe('CapabilityFirewall — audit and statelessness', () => {
  it('allowed requests are also recorded in the audit trail', () => {
    const { firewall, events } = makeFirewall()
    const decision = firewall.check({ stage: 'MODEL', capability: 'write_model_spec', at: '2026-08-28T00:00:00Z' })
    expect(decision.allowed).toBe(true)
    expect(events.some(e => e.type === 'capability_check' && e.allowed === true && e.capability === 'write_model_spec' && e.stage === 'MODEL')).toBe(true)
  })

  it('denied requests record an audit event with type=capability_check', () => {
    const { firewall, events } = makeFirewall()
    firewall.check({ stage: 'REVIEW', capability: 'shell', at: '2026-08-28T00:00:00Z' })
    const denial = events.find(e => e.allowed === false)
    expect(denial).toBeDefined()
    expect(denial!.type).toBe('capability_check')
  })

  it('auditSink is called exactly once per check (no duplication)', () => {
    const sink = vi.fn()
    const fw = new CapabilityFirewall(createFormalProfile(), sink)
    fw.check({ stage: 'PLAN', capability: 'read_problem', at: '2026-08-28T00:00:00Z' })
    fw.check({ stage: 'REVIEW', capability: 'shell', at: '2026-08-28T00:00:00Z' })
    fw.check({ stage: 'DELIVERY', capability: 'write_model_spec', at: '2026-08-28T00:00:00Z' })
    expect(sink).toHaveBeenCalledTimes(3)
  })

  it('repeated identical requests both pass (no state, no idempotency cache)', () => {
    const { firewall } = makeFirewall()
    const req = { stage: 'MODEL', capability: 'write_model_spec', at: '2026-08-28T00:00:00Z' }
    const a = firewall.check(req)
    const b = firewall.check(req)
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
    expect(a).toEqual(b)
  })

  it('repeated identical denied requests both fail (no state poisoning to allowed)', () => {
    const { firewall } = makeFirewall()
    const req = { stage: 'PLAN', capability: 'solver', at: '2026-08-28T00:00:00Z' }
    const a = firewall.check(req)
    const b = firewall.check(req)
    expect(a.allowed).toBe(false)
    expect(b.allowed).toBe(false)
  })

  it('EXPLORATORY profile still denies self_modify in MODEL', () => {
    const events: AuditEvent[] = []
    const firewall = new CapabilityFirewall({
      ...createFormalProfile(),
      mode: 'EXPLORATORY',
      stagePolicies: new Map([
        ['PLAN', { stage: 'PLAN', allowedCapabilities: new Set(['read_problem', 'read_artifact']) }],
        ['MODEL', { stage: 'MODEL', allowedCapabilities: new Set(['read_artifact', 'write_model_spec']) }],
        ['EXECUTE', { stage: 'EXECUTE', allowedCapabilities: new Set(['read_artifact', 'code_runtime', 'solver']) }],
        ['REVIEW', { stage: 'REVIEW', allowedCapabilities: new Set(['read_artifact', 'propose_finding']) }],
        ['DELIVERY', { stage: 'DELIVERY', allowedCapabilities: new Set(['read_verified_artifact']) }],
      ]),
      requiredServices: [],
      criticalGateIds: [],
      deliveryPolicyId: 'delivery.exploratory',
    }, e => events.push(e))
    const decision = firewall.check({ stage: 'MODEL', capability: 'self_modify', at: '2026-08-28T00:00:00Z' })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toBe('forbidden_capability')
    }
    expect(events.some(e => e.allowed === false && e.capability === 'self_modify')).toBe(true)
  })
})
