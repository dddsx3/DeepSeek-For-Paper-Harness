/**
 * W7 — V5 adversarial-review adjudication tests.
 *
 * PRD §6.4 V5: 独立通道必须找出 ≥1 个问题,每个带可解析 ref;
 * 零发现 = 无效审查 (ReviewEvidence 已支持).
 *
 * Cases:
 *   - valid review (>=1 resolvable finding with a real span) passes;
 *   - zero findings -> INVALID (the review never attacked);
 *   - a dangled target/evidence ref is discarded, not counted;
 *   - a fabricated text_span (absent from the paper) is discarded.
 */

import { describe, expect, it } from 'vitest'
import { adjudicateAdversarialReview, MIN_ADVERSARIAL_FINDINGS } from '../../src/verification/v5-adversarial.ts'
import type { AdversarialInput } from '../../src/verification/v5-adversarial.ts'

const PAPER = '结论：最优厚度为 0.731 米，采样时长为 42.2 秒。mean_thickness 由 RES1 给出。'

function baseInput(overrides: Partial<AdversarialInput> = {}): AdversarialInput {
  return {
    findings: [{
      finding_id: 'F1',
      target_ref: 'RES1',
      evidence_refs: ['RES1'],
      reason: '最优厚度为 0.731 米',
      severity: 'CRITICAL',
      attack_type: 'numeric-consistency',
    }],
    paperText: PAPER,
    refResolves: ref => ref === 'RES1',
    ...overrides,
  }
}

describe('V5 对抗性审查', () => {
  it('a review finding >=1 resolvable + real span passes', () => {
    const verdict = adjudicateAdversarialReview(baseInput())
    expect(verdict.valid).toBe(true)
    expect(verdict.findings_valid).toBe(1)
    expect(verdict.findings_discarded).toHaveLength(0)
  })

  it('zero findings = INVALID review (the channel never attacked)', () => {
    const verdict = adjudicateAdversarialReview(baseInput({ findings: [] }))
    expect(verdict.valid).toBe(false)
    expect(verdict.detail).toContain('零发现')
  })

  it('a dangling target ref is discarded, not counted (hallucinated finding)', () => {
    const verdict = adjudicateAdversarialReview(baseInput({
      findings: [{ finding_id: 'F1', target_ref: 'RES-NOPE', evidence_refs: ['RES1'], reason: 'x' }],
    }))
    expect(verdict.valid).toBe(false)
    expect(verdict.findings_discarded).toHaveLength(1)
    expect(verdict.findings_discarded[0]?.reason).toContain('悬空')
  })

  it('a fabricated text_span absent from the paper is discarded', () => {
    const verdict = adjudicateAdversarialReview(baseInput({
      findings: [{ finding_id: 'F1', target_ref: 'RES1', evidence_refs: ['RES1'], reason: '该句在论文中根本不存在——伪造攻击' }],
    }))
    expect(verdict.valid).toBe(false)
    expect(verdict.findings_discarded[0]?.reason).toContain('伪造')
  })

  it('MIN_ADVERSARIAL_FINDINGS is 1 (PRD V5: ≥N 个问题)', () => {
    expect(MIN_ADVERSARIAL_FINDINGS).toBe(1)
  })

  it('multiple findings: valid ones count, discarded ones are listed', () => {
    const verdict = adjudicateAdversarialReview(baseInput({
      findings: [
        { finding_id: 'OK1', target_ref: 'RES1', evidence_refs: ['RES1'], reason: '最优厚度为 0.731 米' },
        { finding_id: 'BAD1', target_ref: 'GHOST', evidence_refs: [], reason: 'x' },
      ],
    }))
    expect(verdict.findings_valid).toBe(1)
    expect(verdict.findings_discarded.map(d => d.id)).toEqual(['BAD1'])
    expect(verdict.valid).toBe(true)
  })
})
