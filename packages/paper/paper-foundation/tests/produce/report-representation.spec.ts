/**
 * P3-2 (E6 sign-off A) — representation declarations on conclusion slots.
 *
 * The default zero-tolerance semantics stay: an undeclared ≈/rounding is
 * still refused (攻击 1), and a declared rounding must match the single
 * half-up rule exactly (攻击 2: dp:2 but text says 0.729 while 0.731
 * rounds to 0.73). with_uncertainty must bind to a Result that records
 * that ± value (攻击 3). Malformed declarations — negative dp, science
 * forms — are refused fail-closed, never upgraded to verbatim (攻击 4).
 * ROUNDED-LEGAL is the E6 positive leaf: ≈0.73 with rounded {dp:2} and a
 * source 0.731 renders DELIVER-clean.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/produce/report-representation
 */

import { describe, expect, it } from 'vitest'
import { renderReportV2 } from '../../src/produce/report-renderer.ts'

const results = [
  { result_id: 'RES-ICE', name: 'mean_thickness', value: 0.731, unit: 'm', uncertainty: 0.012 },
  { result_id: 'RES-POND', name: 'pond_fraction', value: 0.042, unit: '1', uncertainty: null },
]

describe('P3-2 ROUNDED-LEGAL positive path', () => {
  it('≈0.73 with rounded {dp:2} against source 0.731 renders', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is ≈0.73 m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'rounded', dp: 2 },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.text).toContain('≈0.73')
  })

  it('a rounded declaration whose dp also matches the raw value stays legal (dp:3)', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is 0.731 m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'rounded', dp: 3 },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(true)
  })
})

describe('P3-2 attacks (each must be refused)', () => {
  it('attack 1: ≈0.73 with NO representation declaration is refused (default zero-tolerance)', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'Mean ice thickness is ≈0.73 m.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      // 0.73 is neither the bound 0.731 nor any declared rendering.
      expect(verdict.reason).toContain('RES-ICE')
    }
  })

  it('attack 2: declared rounded {dp:2} but the text states 0.729 — refused', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is 0.729 m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'rounded', dp: 2 },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      // 0.729 is not 0.731's canonical dp:2 rendering (0.73): refused on
      // the binding check — the claim never states the declared value.
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('verbatim')
    }
  })

  it('attack 3: with_uncertainty referencing a Result whose ± does not match is refused', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Thickness is 0.731 ± 0.5 m.',
            quantity_refs: ['RES-ICE'],
            // RES-POND has NO recorded uncertainty at all — the declared
            // ref cannot resolve to a ± row.
            representation: { kind: 'with_uncertainty', uncertainty_refs: ['RES-POND'] },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('RES-POND')
    }
  })

  it('attack 3b: with_uncertainty stating a ± value that disagrees with the table is refused', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Thickness is 0.731 ± 0.5 m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'with_uncertainty', uncertainty_refs: ['RES-ICE'] },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      // The declared ref resolves (RES-ICE has ±0.012) but the text states
      // 0.5 and never the recorded ±0.012 — the ±-binding check refuses
      // before the literal guard even sees the stray 0.5.
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('RES-ICE')
      expect(verdict.reason).toContain('0.012')
    }
  })

  it('attack 4: negative dp in the declaration is refused fail-closed', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is 0.7 m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'rounded', dp: -1 },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('dp')
    }
  })

  it('attack 4b: an out-of-set representation kind is refused', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is 0.731 m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'significant_figures', figures: 2 } as never,
          }],
        },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('closed set')
    }
  })

  it('attack 4c: scientific-notation source values are refused on the rounded path (v1 fail-closed)', () => {
    const sciResults = [
      { result_id: 'RES-SCI', name: 'flux', value: 1e-7, unit: 'm/s', uncertainty: null },
    ]
    const verdict = renderReportV2({
      title: 't',
      results: sciResults,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Flux is 0.0 m/s.',
            quantity_refs: ['RES-SCI'],
            representation: { kind: 'rounded', dp: 1 },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('fail-closed')
    }
  })
})

describe('P3-2 with_uncertainty positive path', () => {
  it('0.731 ± 0.012 bound through a with_uncertainty declaration renders', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is 0.731 m (±0.012).',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'with_uncertainty', uncertainty_refs: ['RES-ICE'] },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.text).toContain('0.731 m (±0.012)')
    }
  })
})

describe('P3-2 regressions (P2-4 semantics unchanged)', () => {
  it('TOO-GOOD-V2 re-run: 0.732 vs table 0.731 with no declaration stays red', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: { claims: [{ text: 'Mean ice thickness is 0.732 m.', quantity_refs: ['RES-ICE'] }] },
      },
    })
    expect(verdict.ok).toBe(false)
  })

  it('verbatim declaration keeps the P2-4 binding semantics', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [{
            text: 'Mean ice thickness is 0.731 m.',
            quantity_refs: ['RES-ICE'],
            representation: { kind: 'verbatim' },
          }],
        },
      },
    })
    expect(verdict.ok).toBe(true)
  })

  it('a rounded declaration does not license numbers of OTHER slots (slot-wise isolation)', () => {
    const verdict = renderReportV2({
      title: 't',
      results,
      narrative: {
        conclusion: {
          claims: [
            {
              text: 'Mean ice thickness is ≈0.73 m.',
              quantity_refs: ['RES-ICE'],
              representation: { kind: 'rounded', dp: 2 },
            },
            {
              // Second slot carries NO declaration: 0.042 is the only
              // allowed number; borrowing 0.73 here must be refused.
              text: 'Pond fraction is 0.042; thickness ≈0.73.',
              quantity_refs: ['RES-POND'],
            },
          ],
        },
      },
    })
    expect(verdict.ok).toBe(false)
  })
})
