/**
 * M-QUAL 阶段 A — NumericConfig schema + 执行期 emission 物化（DP-4）.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/ir/numeric-config
 */

import { describe, expect, it } from 'vitest'
import {
  NUMERIC_CONFIG_EMISSION_BASENAME,
  numericConfigEmissionSchema,
  numericConfigFromEmission,
  numericConfigSchema,
  type EmissionSymbol,
} from '../../src/ir/numeric-config.ts'
import { numericConfig, parameterSymbol, variableSymbol } from './fixtures.ts'

describe('NumericConfig — schema', () => {
  it('a valid config round-trips', () => {
    expect(numericConfigSchema.safeParse(numericConfig()).success).toBe(true)
  })

  it('rejects duplicate discretization symbol_ref (refine 构造性反例)', () => {
    const attack = numericConfig({
      discretization: [
        { symbol_ref: 'SYM-dt', value: 0.25 },
        { symbol_ref: 'SYM-dt', value: 1.0 },
      ],
    })
    expect(numericConfigSchema.safeParse(attack).success).toBe(false)
  })

  it('rejects unknown keys and non-NFC ids (.strict())', () => {
    expect(numericConfigSchema.safeParse({ ...numericConfig(), extra: 1 }).success).toBe(false)
    expect(numericConfigSchema.safeParse(numericConfig({ config_id: 'NC\u0301-1' })).success).toBe(false)
  })
})

describe('NumericConfig — emission materialization (DP-4 执行期捕获)', () => {
  // The fixture factories return open records; the mapper's contract is the
  // closed EmissionSymbol shape (id/token/scope) these fixtures satisfy.
  const symbols = [
    parameterSymbol({ symbol_id: 'SYM-N', token: 'N' }),
    parameterSymbol({ symbol_id: 'SYM-dt', token: 'dt' }),
    parameterSymbol({ symbol_id: 'SYM-h', token: 'h' }),
    variableSymbol({ symbol_id: 'SYM-C', token: 'C' }),
  ] as unknown as EmissionSymbol[]
  const emission = {
    discretization: { N: 200, dt: 0.25 },
    physical: { h: 25 },
    choices: { time_integrator: 'explicit' },
    property_set: 'A2',
  }

  it('the emission basename is the single canonical file name', () => {
    expect(NUMERIC_CONFIG_EMISSION_BASENAME).toBe('numeric_config.json')
  })

  it('the closed emission schema accepts the documented shape and rejects extras', () => {
    expect(numericConfigEmissionSchema.safeParse(emission).success).toBe(true)
    expect(numericConfigEmissionSchema.safeParse({ ...emission, surprise: 1 }).success).toBe(false)
  })

  it('resolves tokens to declared SymbolSpec ids within scope', () => {
    const built = numericConfigFromEmission({
      configId: 'NC-RUN1',
      runRef: 'RUN1',
      scopeRefs: ['P1'],
      emission,
      symbols,
    })
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.config.discretization).toEqual([
        { symbol_ref: 'SYM-N', value: 200 },
        { symbol_ref: 'SYM-dt', value: 0.25 },
      ])
      expect(built.config.physical).toEqual([{ symbol_ref: 'SYM-h', value: 25 }])
      expect(built.config.property_set).toBe('A2')
    }
  })

  it('fails closed on a token not declared in scope (构造性反例)', () => {
    const built = numericConfigFromEmission({
      configId: 'NC-RUN1',
      runRef: 'RUN1',
      scopeRefs: ['P1'],
      emission: { ...emission, discretization: { N: 200, dt: 0.25, dX: 0.1 } },
      symbols,
    })
    expect(built.ok).toBe(false)
    if (!built.ok) {
      expect(built.failures[0]?.kind).toBe('TOKEN_UNRESOLVED')
      expect(built.failures[0]?.reason).toContain('dX')
    }
  })

  it('does not resolve tokens from a foreign scope (构造性反例)', () => {
    const foreign = parameterSymbol({ symbol_id: 'SYM-N2', scope_ref: 'P2', token: 'N' }) as unknown as EmissionSymbol
    const built = numericConfigFromEmission({
      configId: 'NC-RUN1',
      runRef: 'RUN1',
      scopeRefs: ['P1'],
      emission,
      symbols: [foreign],
    })
    expect(built.ok).toBe(false)
  })

  it('fails closed when the run\u2019s model declares no problem scope', () => {
    const built = numericConfigFromEmission({
      configId: 'NC-RUN1',
      runRef: 'RUN1',
      scopeRefs: [],
      emission,
      symbols,
    })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.failures[0]?.kind).toBe('SCOPE_UNRESOLVED')
  })
})

// ---------------------------------------------------------------------------
// W11.5-A1b — 配置发射的键解析（记号归一，歧义拒绝）
// ---------------------------------------------------------------------------

describe('NumericConfig — emission key resolution (W11.5)', () => {
  const symbols = [
    { symbol_id: 'SYM-P0', token: 'P_0', scope_ref: 'P1' },
    { symbol_id: 'SYM-N', token: 'n', scope_ref: 'P1' },
    { symbol_id: 'SYM-DT', token: 'dt', scope_ref: 'P1' },
  ] as unknown as EmissionSymbol[]
  const base = { configId: 'NC-X', runRef: 'RUN1', scopeRefs: ['P1'], symbols }

  it('按 symbol_id 作键也能解析（真实运行里模型自然写成 id）', () => {
    const built = numericConfigFromEmission({
      ...base,
      emission: { discretization: { 'SYM-N': 200 }, physical: {}, choices: {}, property_set: null },
    })
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.config.discretization).toEqual([{ symbol_ref: 'SYM-N', value: 200 }])
  })

  it('大小写/下划线记号差异可归一（`p0` → `P_0`）', () => {
    const built = numericConfigFromEmission({
      ...base,
      emission: { discretization: { p0: 0.1 }, physical: {}, choices: {}, property_set: null },
    })
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.config.discretization).toEqual([{ symbol_ref: 'SYM-P0', value: 0.1 }])
  })

  it('null 值 = 未填，条目被丢弃而不是拒绝整条链', () => {
    const built = numericConfigFromEmission({
      ...base,
      emission: { discretization: { n: null, dt: 0.25 }, physical: {}, choices: {}, property_set: null },
    })
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.config.discretization).toEqual([{ symbol_ref: 'SYM-DT', value: 0.25 }])
  })

  it('归一后歧义 → 拒绝（构造性反例：绝不猜哪个符号）', () => {
    const ambiguous = [
      { symbol_id: 'SYM-A', token: 'T_inf', scope_ref: 'P1' },
      { symbol_id: 'SYM-B', token: 'Tinf', scope_ref: 'P1' },
    ] as unknown as EmissionSymbol[]
    const built = numericConfigFromEmission({
      ...base,
      symbols: ambiguous,
      emission: { discretization: { tinf: 1 }, physical: {}, choices: {}, property_set: null },
    })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.failures[0]?.reason).toContain('more than one')
  })

  it('id 的记号变体（`S_P0` ↔ 声明 id `S-P0`）也能解析（run-4 实测形态）', () => {
    const withId = [
      { symbol_id: 'S-P0', token: 'p0', scope_ref: 'P1' },
      { symbol_id: 'S-N', token: 'n', scope_ref: 'P1' },
    ] as unknown as EmissionSymbol[]
    const built = numericConfigFromEmission({
      ...base,
      symbols: withId,
      emission: { discretization: { S_P0: 0.1 }, physical: { 'S-N': 200 }, choices: {}, property_set: null },
    })
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.config.discretization).toEqual([{ symbol_ref: 'S-P0', value: 0.1 }])
      expect(built.config.physical).toEqual([{ symbol_ref: 'S-N', value: 200 }])
    }
  })

  it('完全未知的键仍拒绝（构造性反例）', () => {
    const built = numericConfigFromEmission({
      ...base,
      emission: { discretization: { mystery: 1 }, physical: {}, choices: {}, property_set: null },
    })
    expect(built.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// W11.5 baseline-4（首次真实产出实测）—— 未解析 token 的拒绝理由必须携带
// **可用的** token/id 清单（只报"没解析到"逼着下一轮猜）。
// ---------------------------------------------------------------------------
describe('W11.5 baseline-4 — TOKEN_UNRESOLVED 理由携带可用清单', () => {
  it('拒绝理由列出全部已声明 token/id（模型一步改对）', async () => {
    const { numericConfigFromEmission } = await import('../../src/ir/numeric-config.ts')
    const built = numericConfigFromEmission({
      configId: 'NC-X', runRef: 'RUN-X', scopeRefs: ['P1'],
      emission: {
        discretization: { unknown_token: 1 },
        physical: {},
        choices: {},
        property_set: null,
      },
      symbols: [
        { symbol_id: 'S-P0', scope_ref: 'P1', token: 'p0' },
        { symbol_id: 'S-N', scope_ref: 'P1', token: 'n' },
      ],
    } as never)
    expect(built.ok).toBe(false)
    if (!built.ok) {
      const reason = built.failures[0]?.reason ?? ''
      expect(reason).toContain('declared tokens/ids')
      expect(reason).toContain('p0')
      expect(reason).toContain('S-P0')
      expect(reason).toContain('n')
    }
  })
})
