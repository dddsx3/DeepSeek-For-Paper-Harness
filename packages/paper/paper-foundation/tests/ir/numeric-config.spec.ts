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
