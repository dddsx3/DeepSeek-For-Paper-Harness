import { describe, expect, it } from 'vitest'
import {
  createExploratoryProfile,
  createFastProfile,
  createFormalProfile,
  FORBIDDEN_CAPABILITIES,
  type Capability,
  type StageName,
} from '../../src/runtime/index.ts'

describe('PaperRuntimeProfile — FORMAL', () => {
  const profile = createFormalProfile()

  it('declares FORMAL mode', () => {
    expect(profile.mode).toBe('FORMAL')
  })

  it('includes all six required services', () => {
    const kinds = profile.requiredServices.map(s => s.kind)
    expect(kinds).toEqual(expect.arrayContaining([
      'persistence',
      'artifact_store',
      'audit',
      'verifier_registry',
      'delivery_policy',
      'hash_provider',
    ]))
    expect(profile.requiredServices.length).toBe(6)
  })

  it('PLAN stage allows read_problem and llm_inference', () => {
    // TASK -1 rewire: PLAN runs the model once for the plan prompt, so
    // it carries the `llm_inference` capability. The narrow "read_problem
    // only" shape still holds for problem-data reads; the new entry is
    // the LLM seam, not a stage policy leak.
    const plan = profile.stagePolicies.get('PLAN')
    expect(plan).toBeDefined()
    expect([...plan!.allowedCapabilities].sort()).toEqual(['llm_inference', 'read_problem'])
  })

  it('DELIVERY stage only allows read_verified_artifact', () => {
    const delivery = profile.stagePolicies.get('DELIVERY')
    expect(delivery).toBeDefined()
    expect([...delivery!.allowedCapabilities]).toEqual(['read_verified_artifact'])
  })

  it('does not allow shell, web, or self_modify in any stage', () => {
    for (const stage of ['PLAN', 'MODEL', 'EXECUTE', 'REVIEW', 'DELIVERY'] as const) {
      const policy = profile.stagePolicies.get(stage)
      expect(policy).toBeDefined()
      for (const forbidden of FORBIDDEN_CAPABILITIES) {
        expect(policy!.allowedCapabilities.has(forbidden)).toBe(false)
      }
    }
  })

  it('lists at least five critical gate IDs', () => {
    expect(profile.criticalGateIds.length).toBeGreaterThanOrEqual(5)
  })

  it('declares a non-empty delivery policy ID', () => {
    expect(profile.deliveryPolicyId).toBeTruthy()
    expect(typeof profile.deliveryPolicyId).toBe('string')
  })
})

describe('PaperRuntimeProfile — FAST vs FORMAL', () => {
  it('FAST differs from FORMAL by at most 2 non-critical items', () => {
    const formal = createFormalProfile()
    const fast = createFastProfile()
    const formalKinds = formal.requiredServices.map(s => s.kind).sort()
    const fastKinds = fast.requiredServices.map(s => s.kind).sort()
    const diff = formalKinds.filter(k => !fastKinds.includes(k))
      .concat(fastKinds.filter(k => !formalKinds.includes(k)))
    expect(diff.length).toBeGreaterThanOrEqual(1)
    expect(diff.length).toBeLessThanOrEqual(2)
  })
})

describe('PaperRuntimeProfile — EXPLORATORY vs FORMAL', () => {
  it('EXPLORATORY differs from FORMAL on stage policies (PLAN is the change)', () => {
    const formal = createFormalProfile()
    const exploratory = createExploratoryProfile()
    const formalPlan = [...(formal.stagePolicies.get('PLAN')!.allowedCapabilities)]
    const exploratoryPlan = [...(exploratory.stagePolicies.get('PLAN')!.allowedCapabilities)]
    expect(formalPlan).not.toEqual(exploratoryPlan)
  })

  it('EXPLORATORY allows no forbidden capabilities either', () => {
    const profile = createExploratoryProfile()
    for (const stage of ['PLAN', 'MODEL', 'EXECUTE', 'REVIEW', 'DELIVERY'] as const) {
      const policy = profile.stagePolicies.get(stage)
      expect(policy).toBeDefined()
      for (const forbidden of FORBIDDEN_CAPABILITIES) {
        expect(policy!.allowedCapabilities.has(forbidden)).toBe(false)
      }
    }
  })

  it('every FORMAL stage has a strict, non-overlapping whitelist shape', () => {
    const profile = createFormalProfile()
    // TASK -1 rewire: every stage that calls the model carries the
    // `llm_inference` capability. DELIVERY never calls the model, so
    // it stays empty of LLM seams.
    const expected: ReadonlyMap<StageName, ReadonlyArray<Capability>> = new Map([
      ['PLAN', ['read_problem', 'llm_inference']],
      ['MODEL', ['read_artifact', 'write_model_spec', 'llm_inference']],
      ['EXECUTE', ['read_artifact', 'code_runtime', 'solver', 'llm_inference']],
      ['REVIEW', ['read_artifact', 'propose_finding', 'llm_inference']],
      ['DELIVERY', ['read_verified_artifact']],
    ])
    for (const [stage, caps] of expected) {
      const policy = profile.stagePolicies.get(stage)
      expect(policy).toBeDefined()
      const got = [...policy!.allowedCapabilities].sort()
      expect(got).toEqual([...caps].sort())
    }
  })
})
