/**
 * P2-3 — figure production acceptance (declaration-driven; numbers never
 * authored by the model; P2 禁2/禁3).
 *
 * The producer derives the render input from the store, hashes it into
 * data_hash, mints the FigureSpec and renders deterministic SVG bytes.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/figure-producer
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { produceFigures } from '../../src/figure/producer.ts'
import { figureConsistencyFindings } from '../../src/delivery/figure-consistency.ts'
import { chainThrough } from '../ir/fixtures.ts'

/** chainThrough('Claim') + a second Result so line charts have two points. */
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
    uncertainty: null,
    source_location: 'file:///runs/RUN1/result.json#ridge',
  })
  if (!second.accepted) throw new Error('RES2 refused')
  return ir
}

const GOOD = [
  {
    figure_id: 'FIG-A',
    chart_type: 'line',
    data_refs: ['RES1', 'RES2'],
    caption: 'Thickness profile (0.731 and 0.9)',
    x_label: 'survey cell',
    y_label: 'thickness (m)',
  },
]

describe('P2-3 produceFigures', () => {
  it('mints a consistent FigureSpec and deterministic SVG bytes', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, GOOD)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.figureIds).toEqual(['FIG-A'])
    expect(verdict.assets[0]!.svg).toContain('<svg')
    expect(verdict.assets[0]!.data_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    // The minted figure passes the real gate (hash matches the store).
    const record = ir.list().find(r => r.kind === 'FigureSpec' && r.id === 'FIG-A')
    const figure = record!.value as { data_hash: string }
    expect(figure.data_hash).toBe(verdict.assets[0]!.data_hash)
    expect(figureConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })

  it('rendering is deterministic: identical input -> identical bytes (golden)', () => {
    const a = produceFigures(twoResultStore(), GOOD)
    const b = produceFigures(twoResultStore(), GOOD)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.assets[0]!.svg).toBe(b.assets[0]!.svg)
    expect(a.assets[0]!.data_hash).toBe(b.assets[0]!.data_hash)
  })

  it('attack 1: a caption/axis numeric literal that is not a referenced value is refused', () => {
    const ir = twoResultStore()
    const verdict = produceFigures(ir, [
      { figure_id: 'FIG-B', chart_type: 'bar', data_refs: ['RES1'], caption: 'Thickness is 0.8 m' },
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('figure_declaration_invalid')
  })

  it('an out-of-whitelist chart_type is refused', () => {
    const verdict = produceFigures(twoResultStore(), [
      { figure_id: 'FIG-C', chart_type: 'pie', data_refs: ['RES1'] },
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('figure_data_invalid')
      expect(verdict.reason).toContain('whitelist')
    }
  })

  it('a dangling data_ref is refused', () => {
    const verdict = produceFigures(twoResultStore(), [
      { figure_id: 'FIG-D', chart_type: 'scatter', data_refs: ['GHOST'] },
    ])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('figure_data_invalid')
      expect(verdict.reason).toContain('GHOST')
    }
  })

  it('a duplicate figure_id and an empty data_refs are refusals with no partial writes', () => {
    const ir = twoResultStore()
    const dup = produceFigures(ir, [GOOD[0]!, GOOD[0]!])
    expect(dup.ok).toBe(false)
    const empty = produceFigures(ir, [{ figure_id: 'FIG-E', chart_type: 'bar', data_refs: [] }])
    expect(empty.ok).toBe(false)
    expect(ir.list().filter(r => r.kind === 'FigureSpec')).toHaveLength(0)
  })
})
