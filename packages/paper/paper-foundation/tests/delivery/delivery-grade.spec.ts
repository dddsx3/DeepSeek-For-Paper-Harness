/**
 * P0-3 (PRD v2 §3.3, W2): fail-soft delivery grade tests.
 *
 * The preregistered acceptance case: a paper with content and unpassed
 * gates must deliver as MARKED with an honest appendix — not BLOCKED,
 * and not CLEAN either.
 */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_CONTENT_CHARS,
  contentExists,
  gradeDelivery,
  renderDeliveryAppendix,
} from '../../src/delivery/delivery-grade.ts'
import type { FatalConditions } from '../../src/delivery/delivery-grade.ts'

const noFatal: FatalConditions = { emptyContent: false, executionFailed: false, referenceCatastrophe: false }

describe('gradeDelivery — the three grades', () => {
  it('no failures and no fatal conditions → CLEAN', () => {
    const decision = gradeDelivery([], noFatal)
    expect(decision.grade).toBe('CLEAN')
    expect(decision.annotations).toHaveLength(0)
  })

  it('failures with content → MARKED, never BLOCKED (the P0-3 acceptance case)', () => {
    const decision = gradeDelivery(
      [
        { kind: 'critical_gate', reason: 'numeric_consistency:FAIL:0.731 has no Result' },
        { kind: 'required_output_missing', reason: 'R-OUT' },
      ],
      noFatal,
    )
    expect(decision.grade).toBe('MARKED')
    expect(decision.annotations).toHaveLength(2)
    expect(decision.annotations[0]?.kind).toBe('critical_gate')
  })

  it('empty content → BLOCKED (fatal condition 1)', () => {
    const decision = gradeDelivery([{ kind: 'review', reason: 'empty final delivery' }], {
      ...noFatal,
      emptyContent: true,
    })
    expect(decision.grade).toBe('BLOCKED')
  })

  it('execution failure → BLOCKED (fatal condition 2)', () => {
    const decision = gradeDelivery([], { ...noFatal, executionFailed: true })
    expect(decision.grade).toBe('BLOCKED')
  })

  it('reference catastrophe → BLOCKED (fatal condition 3)', () => {
    const decision = gradeDelivery([], { ...noFatal, referenceCatastrophe: true })
    expect(decision.grade).toBe('BLOCKED')
  })

  it('fatal conditions trump content + gate passes (defense in depth)', () => {
    // Even with ZERO gate failures, an empty draft cannot be CLEAN — the
    // fatal probe is not a gate; it is a precondition.
    const decision = gradeDelivery([], { ...noFatal, emptyContent: true })
    expect(decision.grade).toBe('BLOCKED')
  })

  it('unknown failure kinds degrade to MARKED annotations, never new BLOCKED reasons (closed fatal list)', () => {
    const decision = gradeDelivery(
      [{ kind: 'some_future_gate', reason: 'anything' }],
      noFatal,
    )
    expect(decision.grade).toBe('MARKED')
    expect(decision.annotations[0]?.kind).toBe('some_future_gate')
  })

  it('BLOCKED verdicts still carry their annotations (audit must explain the verdict)', () => {
    const decision = gradeDelivery(
      [{ kind: 'execution', reason: 'code run refused: timeout' }],
      { ...noFatal, executionFailed: true },
    )
    expect(decision.grade).toBe('BLOCKED')
    expect(decision.annotations[0]?.reason).toContain('timeout')
  })

  it('locations map failure kinds to their binding points', () => {
    const decision = gradeDelivery(
      [{ kind: 'critical_gate', reason: 'x' }],
      noFatal,
      { critical_gate: 'review #4' },
    )
    expect(decision.annotations[0]?.location).toBe('review #4')
  })
})

describe('renderDeliveryAppendix — appendix, never inline', () => {
  it('CLEAN ships no appendix', () => {
    expect(renderDeliveryAppendix('CLEAN', [])).toBe('')
  })

  it('MARKED appendix lists every unpassed item with location and reason', () => {
    const text = renderDeliveryAppendix('MARKED', [
      { kind: 'numeric_consistency', reason: '0.731 has no Result', location: 'delivery' },
      { kind: 'review', reason: 'critical defect unresolved', location: 'review #4' },
    ])
    expect(text).toContain('MARKED')
    expect(text).toContain('numeric_consistency')
    expect(text).toContain('0.731 has no Result')
    expect(text).toContain('review #4')
    expect(text).toContain('| 1 |')
    expect(text).toContain('| 2 |')
  })

  it('markdown table pipes in reasons are escaped (no broken appendix rows)', () => {
    const text = renderDeliveryAppendix('MARKED', [
      { kind: 'k', reason: 'a|b|c', location: 'x' },
    ])
    expect(text).toContain('a\\|b\\|c')
  })

  it('BLOCKED appendix is explanatory, not a delivery', () => {
    const text = renderDeliveryAppendix('BLOCKED', [
      { kind: 'empty_content', reason: '<200 chars body', location: 'final output' },
    ])
    expect(text).toContain('BLOCKED')
    expect(text).toContain('不予交付')
  })
})

describe('contentExists — the empty-content probe', () => {
  it('threshold is 200 non-whitespace characters', () => {
    expect(EMPTY_CONTENT_CHARS).toBe(200)
  })

  it('whitespace-only text is empty content', () => {
    expect(contentExists('   \n\t  \n ')).toBe(false)
  })

  it('short real text is still empty (<200)', () => {
    expect(contentExists('结论：均值 0.731 米。')).toBe(false)
  })

  it('a real paragraph counts as content', () => {
    expect(contentExists('结论'.repeat(101))).toBe(true)
  })

  it('the appendix itself does not rescue an empty body (probe runs on body, caller contract)', () => {
    // The function is pure: the caller passes the BODY text. An appendix
    // of annotations alone is not content — this documents the contract.
    const appendixOnly = renderDeliveryAppendix('MARKED', [
      { kind: 'a'.repeat(250), reason: 'r', location: 'x' },
    ])
    expect(appendixOnly.replace(/\s+/g, '').length >= 200).toBe(true)
    expect(contentExists('')).toBe(false)
  })
})
