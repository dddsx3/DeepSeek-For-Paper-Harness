/**
 * P1-4 — requirement_coverage gate v0.1 (real; closure algorithm A7 frozen
 * v0 — see TASK-P1 decision-log).
 *
 * Closure v0 (frozen 2026-09-03, author-delegated execution; fail-closed on
 * ambiguity per task book P1-4 risk 4):
 *
 *   A ProblemSpec's REQUIRED_OUTPUTs are covered when every REQUIRED_OUTPUT
 *   of that problem is paid by a CRITICAL Claim whose evidence chain
 *   terminates in a Model of that problem:
 *     Claim(CRITICAL) -> result_refs -> Result -> run_ref -> RunArtifact
 *     -> model_ref -> ModelSpec.problem_refs ∋ ProblemSpec.id
 *
 * The mechanical correspondence requirement-text <-> result is not
 * decidable in IR v1, so v0 takes the fail-closed COUNT bound: a problem
 * with N REQUIRED_OUTPUTs needs at least N DISTINCT reaching CRITICAL
 * results. A problem with zero reaching results is always BLOCKED. This is
 * deliberately conservative — a paper that proves more than it promised
 * still passes, a paper that promises more than it proves is blocked — and
 * the correspondence gap is recorded in known-risks for P3. SUBPROBLEM /
 * CONSTRAINT requirements are not coverage-gated in v0 (reviewer
 * territory). Each problem closes on its own (multi-subproblem =
 * multi-ProblemSpec).
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery
 */

import type { IrObjectRecord } from '../ir/store.ts'

export interface CoverageFinding {
  readonly problemId: string
  readonly requirementId: string
  readonly reason: string
}

/** Distinct CRITICAL results whose run's model references each problem. */
function reachingResultsByProblem(store: ReadonlyMap<string, IrObjectRecord>): Map<string, Set<string>> {
  const modelProblems = new Map<string, ReadonlyArray<string>>()
  for (const record of store.values()) {
    if (record.kind !== 'ModelSpec') continue
    const model = record.value as { model_id: string; problem_refs: ReadonlyArray<string> }
    modelProblems.set(model.model_id, model.problem_refs)
  }
  const out = new Map<string, Set<string>>()
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as { criticality: string; result_refs: ReadonlyArray<string> }
    if (claim.criticality !== 'CRITICAL') continue
    for (const resultRef of claim.result_refs) {
      const result = store.get(resultRef)
      if (result === undefined || result.kind !== 'Result') continue
      const run = store.get((result.value as { run_ref: string }).run_ref)
      if (run === undefined || run.kind !== 'RunArtifact') continue
      const modelRef = (run.value as { model_ref: string }).model_ref
      for (const problemId of modelProblems.get(modelRef) ?? []) {
        const set = out.get(problemId) ?? new Set<string>()
        set.add(resultRef)
        out.set(problemId, set)
      }
    }
  }
  return out
}

/** A null store (no canonical state) has nothing to check. */
export function requirementCoverageFindings(
  store: ReadonlyMap<string, IrObjectRecord> | null,
): ReadonlyArray<CoverageFinding> {
  if (store === null) return []
  const reaching = reachingResultsByProblem(store)
  const findings: CoverageFinding[] = []
  for (const record of store.values()) {
    if (record.kind !== 'ProblemSpec') continue
    const problem = record.value as { problem_id: string; requirement_refs: ReadonlyArray<string> }
    const outputs = problem.requirement_refs
      .map(ref => store.get(ref))
      .filter((r): r is IrObjectRecord<'RequirementSpec'> => r !== undefined && r.kind === 'RequirementSpec'
        && (r.value as { requirement_type: string }).requirement_type === 'REQUIRED_OUTPUT')
      .map(r => (r.value as { requirement_id: string }).requirement_id)
    if (outputs.length === 0) continue
    const paid = reaching.get(problem.problem_id)?.size ?? 0
    if (paid < outputs.length) {
      for (const requirementId of outputs) {
        findings.push({
          problemId: problem.problem_id,
          requirementId,
          reason: `REQUIRED_OUTPUT '${requirementId}' of problem '${problem.problem_id}' is not covered: only ${paid}/${outputs.length} distinct CRITICAL results reach this problem (A7 v0 fail-closed)`,
        })
      }
    }
  }
  return findings
}
