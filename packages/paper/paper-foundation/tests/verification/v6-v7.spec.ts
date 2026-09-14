/**
 * W7 — V6 model-choice + V7 sympy packaging tests.
 *
 * V6 (PRD §6.4): 须 ≥2 候选模型 + 选型理由 + 放弃理由 (模型比较是
 *   数模评审得分点). Counter-examples: single candidate, chosen model
 *   outside the set (自创), missing choice reason, unreasoned rejection.
 * V7 (PRD §6.4): 量纲/残差/定义域 via the sympy helper. The packaging
 *   layer (`runV7Check`) is exercised against the real script; the
 *   dimensional mismatch must surface (ok:false) and the script path
 *   must resolve inside the repo.
 */

import { describe, expect, it } from 'vitest'
import { modelChoiceCheck, MIN_CANDIDATES } from '../../src/verification/v6-model-choice.ts'
import type { ModelChoiceInput } from '../../src/verification/v6-model-choice.ts'
import { runV7Check, V7_SCRIPT } from '../../src/verification/v7-sympy.ts'
import { existsSync } from 'node:fs'

const GOOD_CHOICE: ModelChoiceInput = {
  family: 'F3',
  candidates: ['linear-regression', 'ARIMA', 'random-forest'],
  chosen: 'linear-regression',
  choice_reason: '样本量小且线性显著,样本独立,残差高斯,选线性回归最简单可解释。',
  rejected: [
    { model: 'ARIMA', reason: '数据为截面非时序' },
    { model: 'random-forest', reason: '样本 20 不足,易过拟合' },
  ],
}

describe('V6 模型选择可解释性', () => {
  it('a well-reasoned 3-candidate choice passes', () => {
    expect(modelChoiceCheck(GOOD_CHOICE).every(f => f.ok)).toBe(true)
  })

  it('COUNTER-EXAMPLE: a single candidate (no comparison)', () => {
    const f = modelChoiceCheck({ ...GOOD_CHOICE, candidates: ['linear-regression'] })
    expect(f.find(x => x.rule.includes('候选集'))?.ok).toBe(false)
  })

  it('COUNTER-EXAMPLE: a chosen model outside the set (自创模型)', () => {
    const f = modelChoiceCheck({ ...GOOD_CHOICE, chosen: 'my-custom-nn' })
    expect(f.find(x => x.rule.includes('选中'))?.ok).toBe(false)
  })

  it('COUNTER-EXAMPLE: missing choice reason', () => {
    const f = modelChoiceCheck({ ...GOOD_CHOICE, choice_reason: '就选它' })
    expect(f.find(x => x.rule.includes('选型理由'))?.ok).toBe(false)
  })

  it('COUNTER-EXAMPLE: an unreasoned rejection', () => {
    const f = modelChoiceCheck({
      ...GOOD_CHOICE,
      rejected: [{ model: 'ARIMA', reason: '不好' }],
    })
    expect(f.find(x => x.rule.includes('放弃理由'))?.ok).toBe(false)
  })

  it('MIN_CANDIDATES is 2', () => {
    expect(MIN_CANDIDATES).toBe(2)
  })
})

describe('V7 sympy packaging', () => {
  it('the script resolves inside the repo', () => {
    expect(existsSync(V7_SCRIPT)).toBe(true)
  })

  it('a dimensional mismatch (result unit not declared) is caught', () => {
    const findings = runV7Check({
      symbols: [{ id: 's1', unit: 'm', domain: 'REAL' }],
      equations: [],
      results: [{ id: 'r1', value: 1, unit: 's' }],
      residuals: [],
    })
    const bad = findings.find(f => !f.ok)
    expect(bad?.rule).toBe('DIM-002')
    expect(bad?.detail).toContain('未在符号表中声明')
  })

  it('a clean dimensional setup passes', () => {
    const findings = runV7Check({
      symbols: [{ id: 's1', unit: 'm', domain: 'REAL' }],
      equations: [{ id: 'e1', expression: 'x=1', unit: 'm' }],
      results: [{ id: 'r1', value: 1, unit: 'm' }],
      residuals: [],
    })
    expect(findings.filter(f => !f.ok && f.rule !== 'RES-001')).toHaveLength(0)
  })

  it('a PROBABILITY-domain boundary violation is caught', () => {
    const findings = runV7Check({
      symbols: [{ id: 's1', unit: 'p', domain: 'PROBABILITY' }],
      equations: [],
      results: [{ id: 'r1', value: 1.7, unit: 'p' }],
      residuals: [],
    })
    expect(findings.some(f => !f.ok && f.rule === 'DOM-001')).toBe(true)
  })
})
