/**
 * P3-4 (E7 sign-off A) — figure semantic checks + the `table` chart type.
 *
 * Uniqueness key (sorted data_refs, chart_type, style_profile): a second
 * declaration with the same key is refused at production time with ZERO
 * partial writes (攻击1, 禁5 — the OVER-PROMISE family in figure form);
 * line + bar over the same refs stays legal. The `table` chart type is a
 * first-class figure: one row per data_ref (量名/值/单位/不确定度), numbers
 * only from the store; captions/rows carrying refs-external numbers refuse
 * (攻击2). `pie` stays outside the whitelist (攻击3) and DataArtifact refs
 * refuse at the renderer layer (攻击4 — D-P2.3 does not regress).
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/figure-semantic
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { produceFigures } from '../../src/figure/producer.ts'
import { figureConsistencyFindings } from '../../src/delivery/figure-consistency.ts'
import { figureRenderInput } from '../../src/figure/renderer.ts'
import { chainThrough } from '../ir/fixtures.ts'

function twoResultStore(): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of chainThrough('Claim')) {
    if (entry.kind === 'ExecutionRecord') continue
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) throw new Error(`load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  const second = ir.put('Result', {
    result_id: 'RES2',
    run_ref: 'RUN1',
    name: 'ridge thickness',
    value: 0.9,
    unit: 'm',
    uncertainty: 0.02,
    source_location: 'file:///runs/RUN1/result.json#ridge',
  })
  if (!second.accepted) throw new Error('RES2 refused')
  return ir
}

describe('P3-4 uniqueness key (E7)', () => {
  it('attack 1: a second figure with the same (refs, chart_type, style) is refused with zero partial writes', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, [
      { figure_id: 'FIG-A', chart_type: 'line', data_refs: ['RES1', 'RES2'] },
      { figure_id: 'FIG-A-DUP', chart_type: 'line', data_refs: ['RES1', 'RES2'] },
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('figure_declaration_invalid')
      expect(verdict.reason).toContain('uniqueness key')
    }
    expect(ir.list().filter(r => r.kind === 'FigureSpec')).toHaveLength(0)
  })

  it('the same refs in a different order is still the same key (sorted refs)', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, [
      { figure_id: 'FIG-A', chart_type: 'line', data_refs: ['RES1', 'RES2'] },
      { figure_id: 'FIG-B', chart_type: 'line', data_refs: ['RES2', 'RES1'] },
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('uniqueness key')
  })

  it('positive: line + bar over the same refs are different keys and both render', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, [
      { figure_id: 'FIG-LINE', chart_type: 'line', data_refs: ['RES1', 'RES2'] },
      { figure_id: 'FIG-BAR', chart_type: 'bar', data_refs: ['RES1', 'RES2'] },
    ])
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.figureIds).toEqual(['FIG-LINE', 'FIG-BAR'])
    expect(figureConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })

  it('different refs with the same chart_type are different keys', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, [
      { figure_id: 'FIG-C', chart_type: 'bar', data_refs: ['RES1'] },
      { figure_id: 'FIG-D', chart_type: 'bar', data_refs: ['RES2'] },
    ])
    expect(verdict.ok).toBe(true)
  })
})

describe('P3-4 table chart type', () => {
  it('positive: a table figure renders one row per data_ref with store values', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, [
      { figure_id: 'FIG-T', chart_type: 'table', data_refs: ['RES1', 'RES2'], caption: 'Measured quantities' },
    ])
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    const svg = verdict.assets[0]!.svg
    expect(svg).toContain('<svg')
    expect(svg).toContain('量名')
    expect(svg).toContain('数值')
    expect(svg).toContain('不确定度')
    // Store values verbatim in the rows.
    expect(svg).toContain('0.731')
    expect(svg).toContain('0.9')
    expect(svg).toContain('±0.02')
    // The minted figure passes the consistency gate like any other.
    expect(figureConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })

  it('table rendering is deterministic (golden)', () => {
    const a = produceFigures(twoResultStore(), [
      { figure_id: 'FIG-T', chart_type: 'table', data_refs: ['RES1', 'RES2'] },
    ])
    const b = produceFigures(twoResultStore(), [
      { figure_id: 'FIG-T', chart_type: 'table', data_refs: ['RES1', 'RES2'] },
    ])
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.assets[0]!.svg).toBe(b.assets[0]!.svg)
    expect(a.assets[0]!.data_hash).toBe(b.assets[0]!.data_hash)
  })

  it('attack 2: a table caption carrying a refs-external number is refused', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, [
      { figure_id: 'FIG-T2', chart_type: 'table', data_refs: ['RES1'], caption: 'Thickness is 0.8 m' },
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('figure_declaration_invalid')
      expect(verdict.reason).toContain('0.8')
    }
    expect(ir.list().filter(r => r.kind === 'FigureSpec')).toHaveLength(0)
  })

  it('attack 3: pie stays outside the closed chart_type set', () => {
    const verdict = produceFigures(twoResultStore(), [
      { figure_id: 'FIG-P', chart_type: 'pie', data_refs: ['RES1'] },
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('figure_data_invalid')
      expect(verdict.reason).toContain('whitelist')
    }
  })
})

describe('P3-4 renderer data discipline (全量绘制核对 / 禁4)', () => {
  it('attack 4: a figure referencing a DataArtifact is refused at the render-input layer', () => {
    const ir = twoResultStore()
    const artifact = ir.put('DataArtifact', {
      data_id: 'DATA-1',
      role: 'INPUT_DATA',
      locator: 'file:///runs/RUN1/input.csv',
      content_hash: `sha256:${'b'.repeat(64)}`,
      media_type: 'text/csv',
      description: 'Survey line observations for RUN1.',
    })
    if (!artifact.accepted) throw new Error('DATA-1 refused')
    const derived = figureRenderInput(ModelingIr.snapshot(ir), {
      data_refs: ['DATA-1'],
      chart_type: 'table',
    })
    expect(derived.ok).toBe(false)
    if (!derived.ok) expect(derived.reason).toContain('DataArtifact')
  })

  it('every series row reads its source ref back (no undrawn ref, no extra values)', () => {
    const store = ModelingIr.snapshot(twoResultStore())
    const refs = ['RES1', 'RES2']
    const derived = figureRenderInput(store, { data_refs: refs, chart_type: 'table' })
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    // 全量绘制: one series row per declared ref, values equal the store's.
    expect(derived.input.series).toHaveLength(2)
    const res1 = store!.get('RES1')!.value as { value: number }
    const res2 = store!.get('RES2')!.value as { value: number }
    expect(derived.input.series.map(s => s.value)).toEqual([res1.value, res2.value])
  })
})
