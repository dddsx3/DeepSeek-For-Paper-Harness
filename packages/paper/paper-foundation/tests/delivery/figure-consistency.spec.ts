/**
 * P1 — figure_data_consistency vacuous gate (decision-log D3).
 *
 * No FigureSpec -> PASS (P2 defines figure semantics); any FigureSpec in the
 * store -> BLOCKED p2-pending (fail-closed). This is what lets the P1-5
 * FORMAL demo (which carries no figures) deliver through all nine gates.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/figure-consistency
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { figureConsistencyFindings } from '../../src/delivery/figure-consistency.ts'
import { chainThrough } from '../ir/fixtures.ts'
import type { IrObjectRecord } from '../../src/ir/store.ts'

/** A canonical chain WITHOUT a FigureSpec (chainThrough('Claim') stops before it). */
function noFigureStore(): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of chainThrough('Claim')) {
    if (entry.kind === 'ExecutionRecord') continue
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) throw new Error(`load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  return ir
}

describe('P1 figure_data_consistency (vacuous v0)', () => {
  it('a store with no FigureSpec has no findings', () => {
    expect(figureConsistencyFindings(ModelingIr.snapshot(noFigureStore()))).toHaveLength(0)
  })

  it('any FigureSpec is a finding (P2 semantics not yet defined, fail-closed)', () => {
    const map = new Map<string, IrObjectRecord>([
      ['FIG1', { seq: 1, kind: 'FigureSpec', id: 'FIG1', value: { figure_id: 'FIG1' } as never, ingestedAt: 'x' } as unknown as IrObjectRecord],
    ])
    const findings = figureConsistencyFindings(map)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]!.figureId).toBe('FIG1')
  })

  it('a figure-less chain does not raise the figure prefix at the delivery gate', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: noFigureStore(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('figure_data_consistency:BLOCKED:'))).toBe(false)
  })
})
