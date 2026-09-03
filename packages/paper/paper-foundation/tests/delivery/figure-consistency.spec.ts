/**
 * P2-3 — figure_data_consistency gate v1 (REAL; D3 vacuous lifted).
 *
 * A figure's data_hash must equal the hash of the canonical render input
 * the store re-derives from its data_refs; data_refs must resolve to
 * numeric Results. The vacuous-era tests ("any figure BLOCKs", p2-pending)
 * are replaced by the real contract.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/figure-consistency
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { figureConsistencyFindings } from '../../src/delivery/figure-consistency.ts'
import { figureRenderInput } from '../../src/figure/renderer.ts'
import { backboneIr, chainThrough } from '../ir/fixtures.ts'
import type { IrObjectRecord } from '../../src/ir/store.ts'

/** A canonical chain WITHOUT a FigureSpec (chainThrough('Claim')). */
function noFigureStore(): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of chainThrough('Claim')) {
    if (entry.kind === 'ExecutionRecord') continue
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) throw new Error(`load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  return ir
}

/** chainThrough('Claim') + a CONSISTENT FigureSpec (hash derived from the store). */
function consistentFigureStore(): ModelingIr {
  const ir = noFigureStore()
  const snapshot = ModelingIr.snapshot(ir)
  const derived = figureRenderInput(snapshot, { data_refs: ['RES1'], chart_type: 'line', caption: 'Ice thickness 0.731' })
  if (!derived.ok) throw new Error(`cannot derive render input: ${derived.reason}`)
  const admitted = ir.put('FigureSpec', {
    figure_id: 'FIG1',
    data_refs: ['RES1'],
    claim_refs: [],
    chart_type: 'line',
    caption: 'Ice thickness 0.731',
    data_hash: derived.data_hash,
  })
  if (!admitted.accepted) throw new Error(`figure put failed: ${JSON.stringify(admitted.failures)}`)
  return ir
}

describe('P2-3 figure_data_consistency (real v1)', () => {
  it('a store with no FigureSpec has no findings', () => {
    expect(figureConsistencyFindings(ModelingIr.snapshot(noFigureStore()))).toHaveLength(0)
  })

  it('a consistent figure (derived data_hash) has no findings (blue path)', () => {
    expect(figureConsistencyFindings(ModelingIr.snapshot(consistentFigureStore()))).toHaveLength(0)
  })

  it('a figure whose data_hash names different bytes is a finding (换数据 / attack 3)', () => {
    const ir = noFigureStore()
    const put = ir.put('FigureSpec', {
      figure_id: 'FIG1',
      data_refs: ['RES1'],
      claim_refs: [],
      data_hash: `sha256:${'e'.repeat(64)}`,
    })
    expect(put.accepted).toBe(true)
    const findings = figureConsistencyFindings(ModelingIr.snapshot(ir))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]!.reason).toContain('re-derives')
  })

  it('a schema-bypassed FigureSpec with NO data_hash is refused at admission (attack 5)', () => {
    const ir = noFigureStore()
    const put = ir.put('FigureSpec', { figure_id: 'FIG1', data_refs: ['RES1'], claim_refs: [] })
    expect(put.accepted).toBe(false)
    // The store's schema pass refuses the record; zod reports the missing
    // required value (undefined where a sha256 string is required).
    const failures = (put as { failures?: ReadonlyArray<{ reason: string }> }).failures ?? []
    expect(failures.length).toBeGreaterThan(0)
  })

  it('a dangling data_ref is a finding (attack 2)', () => {
    const map = new Map<string, IrObjectRecord>([
      ['FIG1', { seq: 1, kind: 'FigureSpec', id: 'FIG1', value: { figure_id: 'FIG1', data_refs: ['GHOST'], claim_refs: [], data_hash: `sha256:${'f'.repeat(64)}` } as never, ingestedAt: 'x' } as unknown as IrObjectRecord],
    ])
    const findings = figureConsistencyFindings(map)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]!.reason).toContain('GHOST')
  })

  it('an inconsistent figure raises the figure prefix at the delivery gate (strict/fast)', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    // The canonical backbone carries figure F1 whose fixture data_hash does
    // NOT match the store's re-derived input -> figure_data_consistency BLOCKs.
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: backboneIr(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('figure_data_consistency:BLOCKED:'))).toBe(true)
  })

  it('a figure-less chain does not raise the figure prefix at the delivery gate', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: noFigureStore(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('figure_data_consistency:BLOCKED:'))).toBe(false)
  })
})
