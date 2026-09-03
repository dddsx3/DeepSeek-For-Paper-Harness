/**
 * P2-3 — STALE propagates to figures (attack 4: a figure that draws a
 * stale Result cannot ride into delivery). The engine's header promised
 * FigureSpec propagation for four batches; this pins the code.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/ir/stale-figure
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { computeStaleReport } from '../../src/ir/stale.ts'
import { chainThrough } from '../ir/fixtures.ts'

function figureStore(): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of chainThrough('Claim')) {
    if (entry.kind === 'ExecutionRecord') continue
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) throw new Error(`load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  // RES1 is cited by the figure; RUN1 (RES1's run) has NO ExecutionRecord,
  // which is a direct EXECUTION_MISMATCH (S-008) under the stale engine.
  const put = ir.put('FigureSpec', {
    figure_id: 'FIG1',
    data_refs: ['RES1'],
    claim_refs: [],
    chart_type: 'line',
    data_hash: `sha256:${'c'.repeat(64)}`,
  })
  if (!put.accepted) throw new Error(`figure put failed: ${JSON.stringify(put.failures)}`)
  return ir
}

describe('P2-3 STALE figure propagation', () => {
  it('a figure drawing a stale Result is STALE_TRANSITIVE', () => {
    const snapshot = ModelingIr.snapshot(figureStore())
    const report = snapshot === null ? null : computeStaleReport(snapshot)
    expect(report).not.toBeNull()
    const stale = report!.stale
    expect(stale.some(f => f.kind === 'RunArtifact' && f.reason === 'EXECUTION_MISMATCH')).toBe(true)
    expect(stale.some(f => f.kind === 'Result' && f.id === 'RES1')).toBe(true)
    const figure = stale.find(f => f.kind === 'FigureSpec' && f.id === 'FIG1')
    expect(figure).toBeDefined()
    expect(figure!.reason).toBe('STALE_TRANSITIVE')
  })
})
