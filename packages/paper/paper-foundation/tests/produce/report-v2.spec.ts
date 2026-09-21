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

describe('W11.5 baseline-8 — naming a quantity instead of copying it', () => {
  it('a slot that NAMES its bound quantity renders the run value (the model never had to know it)', () => {
    // 第七/第八次真实运行都死在同一处：结论里写死的数字不是运行算出来的
    // （29/6/76/12 vs 2/2/15/1；-25 缺失）。模型在**运行之前**写结论，本来
    // 就无从知道输出值；`{<result_id>}` 让 harness 把值注入，数字按构造来自 IR。
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'Mean ice thickness is {RES-ICE} m.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
    if (verdict.ok) {
      expect(verdict.text).toContain('Mean ice thickness is 0.731 m.')
      expect(verdict.text).not.toContain('{RES-ICE}')
    }
  })

  it('a named quantity honours the declared rounded rendering', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is {RES-ICE} m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'rounded', dp: 2 },
          }],
        },
      },
    })
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
    if (verdict.ok) expect(verdict.text).toContain('Mean ice thickness is 0.73 m.')
  })

  it('attack: a name that is not one of the claim quantities is refused (braces never print)', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'The value is {RES-POND}.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('RES-POND')
    }
  })

  it('a legacy prose conclusion can name a quantity too, and a bad name is refused', () => {
    const good = renderReportV2({
      title: 't',
      results,
      narrative: { conclusion: 'Mean ice thickness is {RES-ICE} m.' },
    })
    expect(good.ok, good.ok ? '' : good.reason).toBe(true)
    if (good.ok) expect(good.text).toContain('0.731')
    const bad = renderReportV2({
      title: 't',
      results,
      narrative: { conclusion: 'Mean ice thickness is {RES-NOPE} m.' },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('RES-NOPE')
  })

  it('naming does not weaken the guard: a stray literal is still refused', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'Mean ice thickness is {RES-ICE} m, i.e. 0.9 m.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('0.9')
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
  it('references figures as INDEPENDENT files with 题注 (W9-E1/N21: no base64 inline)', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: { conclusion: { claims: [{ text: 'Mean ice thickness is 0.731 m.', quantity_refs: ['RES-ICE'] }] } },
      figures: [figure],
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      // W9-E1: the caller writes figures/FIG-1.svg next to the report; the
      // paper references the FILE and carries a standalone caption line.
      expect(verdict.text).toContain('](figures/FIG-1.svg)')
      expect(verdict.text).toContain('图 1：')
      // N21: no base64 data-URI may appear in the deliverable
      expect(verdict.text).not.toContain('data:image/svg+xml;base64,')
      // W9-D2/O-H-03: the data_hash 溯源表 is audit-trail material, not paper body
      expect(verdict.text).not.toContain('## 图数据溯源')
    }
  })
})
