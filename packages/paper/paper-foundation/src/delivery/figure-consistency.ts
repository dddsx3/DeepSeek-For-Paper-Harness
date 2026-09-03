/**
 * P2-3 — figure_data_consistency gate v1 (REAL; decision-log D3 vacuous
 * lifted — D3-closed recorded with the P2 commits).
 *
 * Per FigureSpec the gate re-derives the canonical render input from the
 * store and compares:
 *   1. data_hash == sha256(canonicalJson(render input)) — a schema-bypassed
 *      figure whose hash names different bytes is F-11 stale / 换数据 (attack 3).
 *   2. every data_ref resolves to a numeric Result the v1 renderer can draw
 *      (attack 2 — a dangling/kind-mismatched ref cannot ride).
 * A figure with no findings has real, reproducible bytes behind it.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery
 */

import type { IrObjectRecord } from '../ir/store.ts'
import { figureRenderInput } from '../figure/renderer.ts'

export interface FigureConsistencyFinding {
  readonly figureId: string
  readonly reason: string
}

export function figureConsistencyFindings(
  store: ReadonlyMap<string, IrObjectRecord> | null,
): ReadonlyArray<FigureConsistencyFinding> {
  if (store === null) return []
  const findings: FigureConsistencyFinding[] = []
  for (const record of store.values()) {
    if (record.kind !== 'FigureSpec') continue
    const figure = record.value as {
      figure_id: string
      data_refs: ReadonlyArray<string>
      data_hash?: unknown
      chart_type?: string
      caption?: string
      x_label?: string
      y_label?: string
    }
    if (typeof figure.data_hash !== 'string') {
      findings.push({
        figureId: figure.figure_id,
        reason: `figure '${figure.figure_id}' carries no data_hash (schema now requires one — a schema-bypassed write)`,
      })
      continue
    }
    const derived = figureRenderInput(store, {
      data_refs: figure.data_refs,
      ...(figure.chart_type === undefined ? {} : { chart_type: figure.chart_type }),
      ...(figure.caption === undefined ? {} : { caption: figure.caption }),
      ...(figure.x_label === undefined ? {} : { x_label: figure.x_label }),
      ...(figure.y_label === undefined ? {} : { y_label: figure.y_label }),
    })
    if (!derived.ok) {
      findings.push({
        figureId: figure.figure_id,
        reason: `figure '${figure.figure_id}' cannot derive its render input: ${derived.reason}`,
      })
      continue
    }
    if (derived.data_hash !== figure.data_hash) {
      findings.push({
        figureId: figure.figure_id,
        reason: `figure '${figure.figure_id}' declares data_hash ${figure.data_hash} but the store re-derives ${derived.data_hash} (换数据 or stale data)`,
      })
    }
  }
  return findings
}
