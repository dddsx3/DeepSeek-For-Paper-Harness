/**
 * P1 — figure_data_consistency gate v0 (vacuous; decision-log D3).
 *
 * P2 will define FigureSpec semantics (data_hash comparison etc.). Until
 * then the gate is vacuously honest: a store with NO FigureSpec has nothing
 * for the figure-data contract to check and PASSes; the moment any FigureSpec
 * exists the gate BLOCKs with a p2-pending reason (fail-closed — a figure
 * whose data consistency is not yet defined must never ride along as
 * "checked"). This keeps the FORMAL delivery path open for P1-5 demos
 * (which carry no figures) without pretending figure data is validated.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery
 */

import type { IrObjectRecord } from '../ir/store.ts'

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
    const figure = record.value as { figure_id?: string }
    findings.push({
      figureId: String(figure.figure_id ?? '?'),
      reason: 'FigureSpec semantics are P2 territory; a figure in the IR cannot be validated yet (fail-closed)',
    })
  }
  return findings
}
