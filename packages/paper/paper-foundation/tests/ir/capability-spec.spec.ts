/**
 * M-QUAL 阶段 B — CapabilitySpec schema（三条硬 refine + 阈值 refine，
 * 每条配构造性反例——v-structure.ts 的既有测试纪律）.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/ir/capability-spec
 */

import { describe, expect, it } from 'vitest'
import {
  capabilitySpecSchema,
  falsifiableThresholdSchema,
} from '../../src/ir/capability-spec.ts'
import { capabilitySpec } from './fixtures.ts'

const VALID = capabilitySpec()

describe('CapabilitySpec — positive', () => {
  it('a machine capability with one threshold parses', () => {
    expect(capabilitySpecSchema.safeParse(VALID).success).toBe(true)
  })

  it('a semantic capability without thresholds parses', () => {
    const semantic = capabilitySpec({
      capability_id: 'CAP-SEM',
      judge: 'semantic',
      machine_check: null,
      falsifiable_thresholds: [],
      criterion: '归因两贡献反号（需人读）。',
    })
    expect(capabilitySpecSchema.safeParse(semantic).success).toBe(true)
  })
})

describe('CapabilitySpec — refine 1: judge=machine requires >=1 threshold', () => {
  it('rejects a machine capability with an empty threshold list (构造性反例)', () => {
    const attack = capabilitySpec({ falsifiable_thresholds: [] })
    const parsed = capabilitySpecSchema.safeParse(attack)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some(i => i.message.includes('>=1 falsifiable_threshold'))).toBe(true)
    }
  })
})

describe('CapabilitySpec — refine 2: semantic must not declare machine_check', () => {
  it('rejects a semantic capability carrying machine_check (构造性反例)', () => {
    const attack = capabilitySpec({
      judge: 'semantic',
      machine_check: 'CONSTRAINT',
      falsifiable_thresholds: [],
    })
    const parsed = capabilitySpecSchema.safeParse(attack)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some(i => i.message.includes('must not declare machine_check'))).toBe(true)
    }
  })
})

describe('CapabilitySpec — refine 3: EXISTENCE depth requires a disclaimer (N10)', () => {
  it('rejects EXISTENCE depth without existence_disclaimer (构造性反例)', () => {
    const attack = capabilitySpec({
      machine_check: 'EXISTENCE',
      verification_depth: 'EXISTENCE',
      existence_disclaimer: null,
    })
    const parsed = capabilitySpecSchema.safeParse(attack)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some(i => i.message.includes('existence_disclaimer'))).toBe(true)
    }
  })

  it('accepts EXISTENCE depth with an explicit disclaimer', () => {
    const ok = capabilitySpec({
      machine_check: 'EXISTENCE',
      verification_depth: 'EXISTENCE',
      existence_disclaimer: '仅验证交付文件存在，不代表内容正确（N10）。',
    })
    expect(capabilitySpecSchema.safeParse(ok).success).toBe(true)
  })
})

describe('CapabilitySpec — refine 4: EXISTENCE depth pairs with machine_check=EXISTENCE', () => {
  it('rejects EXISTENCE depth with a different machine_check (构造性反例)', () => {
    const attack = capabilitySpec({
      machine_check: 'DELIVERY',
      verification_depth: 'EXISTENCE',
      existence_disclaimer: '有免责句但类别不配对。',
    })
    const parsed = capabilitySpecSchema.safeParse(attack)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some(i => i.message.includes('pairs with machine_check=EXISTENCE'))).toBe(true)
    }
  })
})

describe('CapabilitySpec — closed sets and threshold refines', () => {
  it('rejects an unknown family / operator / probe id (.strict() 闭集)', () => {
    expect(capabilitySpecSchema.safeParse(capabilitySpec({ family: 'F9' })).success).toBe(false)
    expect(capabilitySpecSchema.safeParse(capabilitySpec({ probe_refs: ['P-99'] })).success).toBe(false)
    expect(capabilitySpecSchema.safeParse(capabilitySpec({ machine_check: 'vibes' })).success).toBe(false)
    const unknownKey = { ...VALID, extra: 1 }
    expect(capabilitySpecSchema.safeParse(unknownKey).success).toBe(false)
  })

  it('rejects a plain LT threshold without a threshold value (构造性反例)', () => {
    const bad = {
      subject_ref: 'Result:RES1',
      operator: 'LT',
      threshold: null,
      tolerance: null,
      unit: 'm',
      at_config_ref: null,
    }
    expect(falsifiableThresholdSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects REL_LT without a positive tolerance (构造性反例)', () => {
    const bad = {
      subject_ref: 'Result:RES1',
      operator: 'REL_LT',
      threshold: 1.3471e-8,
      tolerance: null,
      unit: 'm^2/s',
      at_config_ref: null,
    }
    expect(falsifiableThresholdSchema.safeParse(bad).success).toBe(false)
    const zero = { ...bad, tolerance: 0 }
    expect(falsifiableThresholdSchema.safeParse(zero).success).toBe(false)
  })

  it('accepts REL_LT with a positive tolerance (2026-A 开尔文判据形态)', () => {
    const ok = {
      subject_ref: 'Result:RES1',
      operator: 'REL_LT',
      threshold: 1.3471e-8,
      tolerance: 1e-3,
      unit: 'm^2/s',
      at_config_ref: null,
    }
    expect(falsifiableThresholdSchema.safeParse(ok).success).toBe(true)
  })
})
