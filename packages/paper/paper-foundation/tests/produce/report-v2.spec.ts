/**
 * P2-4 — v2 template report (structured conclusion slots + figure embed).
 *
 * v1 prose guard stays as the fallback layer (P2 禁6 — at least one layer
 * always guards the conclusion). v2 slots require every quantity_ref value
 * to appear verbatim in the claim text and forbid stray numeric literals.
 * The P1 kills must NOT survive the version upgrade: TOO-GOOD (0.732 vs
 * table 0.731) stays red in the slot path too.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/produce/report-v2
 */

import { describe, expect, it } from 'vitest'
import { renderReportV2, renderV1Report } from '../../src/produce/report-renderer.ts'

const results = [
  { result_id: 'RES-ICE', name: 'mean_thickness', value: 0.731, unit: 'm', uncertainty: 0.012 },
  { result_id: 'RES-POND', name: 'pond_fraction', value: 0.042, unit: '1', uncertainty: null },
]

describe('P2-4 structured conclusion slots', () => {
  it('a slot whose text states the bound value verbatim renders', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'Mean ice thickness is 0.731 m.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.text).toContain('0.731')
  })

  it('attack (TOO-GOOD v2 re-run): a slot text stating a different number is refused', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'Mean ice thickness is 0.732 m.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      // Refusal fires on the binding check (0.732 is not the bound value,
      // so the claim does not state it verbatim) — the kill is the same.
      expect(verdict.reason).toContain('RES-ICE')
    }
  })

  it('attack 3: a slot that never states its bound value is refused (no direct-text pass)', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'The thickness is consistent with the survey.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('verbatim')
  })

  it('a slot with two bound quantities allows both values', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{ text: 'Mean thickness 0.731 m; pond fraction 0.042.', quantity_refs: ['RES-ICE', 'RES-POND'] }],
        },
      },
    })
    expect(verdict.ok).toBe(true)
  })
})

describe('P2-4 v1 guard still applies to legacy prose (禁6 fallback layer)', () => {
  it('a legacy string conclusion keeps the whole-conclusion guard', () => {
    expect(renderV1Report({ title: 't', results, narrative: { conclusion: '0.7 is off.' } }).ok).toBe(false)
    expect(renderV1Report({ title: 't', results, narrative: { conclusion: 'Mean ice thickness is 0.731 m.' } }).ok).toBe(true)
  })
})

describe('P2-4 figure embedding + provenance appendix', () => {
  const figure = {
    figureId: 'FIG-1',
    caption: 'Ice profile',
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10"/></svg>\n',
    data_hash: `sha256:${'a'.repeat(64)}`,
    resultRefs: ['RES-ICE'],
    rendererVersion: 'okabe-ito-v1/svg',
  }
  it('embeds the real rendered bytes and lists provenance', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: { conclusion: { claims: [{ text: 'Mean ice thickness is 0.731 m.', quantity_refs: ['RES-ICE'] }] } },
      figures: [figure],
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.text).toContain('data:image/svg+xml;base64,')
      expect(verdict.text).toContain('## 图数据溯源')
      expect(verdict.text).toContain('`FIG-1`')
      expect(verdict.text).toContain('a'.repeat(64))
    }
  })
})
