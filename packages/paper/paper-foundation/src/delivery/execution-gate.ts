/**
 * P1-4 — execution gate v0.1 (real; replaces the "structural stub").
 *
 * Real check (task book P1-4): every CRITICAL claim's evidence chain —
 * Claim -> result_refs -> Result -> run_ref -> RunArtifact — must reach a
 * RunArtifact that carries a committed, non-STALE ExecutionRecord. A claim
 * chain whose run has NO record (the model "claims it ran" without
 * evidence) or whose record disagrees with the run declaration is BLOCKED.
 *
 * Claims with no result_refs (MODEL/QUALITATIVE without numeric binding)
 * are not execution-gated in v0 — their coverage is requirement_coverage /
 * reviewer territory; documented here and in known-risks so the boundary is
 * explicit, not silent.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery
 */

import type { IrObjectRecord } from '../ir/store.ts'
import { computeStaleReport } from '../ir/stale.js'

export interface ExecutionGateFinding {
  readonly claimId: string
  readonly kind: 'no_record_for_run' | 'record_stale' | 'dangling_evidence'
  readonly reason: string
}

/** A null store (no canonical state) has nothing to check. */
export function executionGateFindings(
  store: ReadonlyMap<string, IrObjectRecord> | null,
): ReadonlyArray<ExecutionGateFinding> {
  if (store === null) return []
  const findings: ExecutionGateFinding[] = []
  const runsWithRecord = new Set<string>()
  for (const record of store.values()) {
    if (record.kind === 'ExecutionRecord') {
      const exec = record.value as { run_ref: string }
      runsWithRecord.add(exec.run_ref)
    }
  }
  const staleRuns = new Set(
    computeStaleReport(store)
      .stale.filter(f => f.kind === 'RunArtifact')
      .map(f => f.id),
  )

  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as {
      claim_id: string
      criticality: string
      result_refs: ReadonlyArray<string>
    }
    if (claim.criticality !== 'CRITICAL' || claim.result_refs.length === 0) continue
    for (const resultRef of claim.result_refs) {
      const resultRecord = store.get(resultRef)
      if (resultRecord === undefined || resultRecord.kind !== 'Result') {
        findings.push({
          claimId: claim.claim_id,
          kind: 'dangling_evidence',
          reason: `result_ref '${resultRef}' does not resolve to a Result`,
        })
        continue
      }
      const result = resultRecord.value as { run_ref: string }
      const runRecord = store.get(result.run_ref)
      if (runRecord === undefined || runRecord.kind !== 'RunArtifact') {
        findings.push({
          claimId: claim.claim_id,
          kind: 'dangling_evidence',
          reason: `Result '${resultRef}' cites run '${result.run_ref}' which is not a RunArtifact`,
        })
        continue
      }
      if (!runsWithRecord.has(result.run_ref)) {
        findings.push({
          claimId: claim.claim_id,
          kind: 'no_record_for_run',
          reason: `CRITICAL claim '${claim.claim_id}' cites run '${result.run_ref}' with no ExecutionRecord — the model cannot claim an execution that was never captured (P1-2)`,
        })
        continue
      }
      if (staleRuns.has(result.run_ref)) {
        findings.push({
          claimId: claim.claim_id,
          kind: 'record_stale',
          reason: `run '${result.run_ref}' has an ExecutionRecord that disagrees with its declaration (STALE)`,
        })
      }
    }
  }
  return findings
}
