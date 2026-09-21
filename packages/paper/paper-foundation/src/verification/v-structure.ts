/**
 * Verification layer V1–V4 (DPH-PRD-v2 §6.4, W6) — structural checks.
 *
 * All four are STRUCTURE checks: they inspect the canonical IR's shape
 * (references/fields/closure), not the math. They are pure functions over
 * the store (the same `ReadonlyMap<string, IrObjectRecord>` shape the
 * existing gate registry consumes), so they can be unit-tested with a
 * constructed counter-example each — the W6 exit criterion.
 *
 *   V1 假设-使用一致性:  every AssumptionSpec must be referenced by
 *      at least one ModelSpec.assumption_refs / EquationSpec.  An
 *      unreferenced assumption is a red flag (assumed but never used).
 *   V2 假设-来源匹配:    source_type dictates the ref shape:
 *      GIVEN           → justification must trace to a DataArtifact
 *      APPROXIMATION   → justification_refs non-empty (the error bound
 *                        lives in the statement; numeric validation is
 *                        V7's domain)
 *      MODELING_CHOICE → justification_refs non-empty
 *   V3 假设-结论敏感性:  risk_level=HIGH assumptions must carry
 *      sensitivity_refs (≥1 experiment Result), making "is the
 *      assumption reasonable" computable as a structural fact.
 *   V4 模型-题面覆盖:    every REQUIRED_OUTPUT must be paid by
 *      Claim→Result→RunArtifact→ModelSpec reaching results (per
 *      problem), AND every symbol a model references must resolve to a
 *      SymbolSpec (no invented physical quantities).
 *
 * These are the family-independent complement to the W5 contract
 * validators (专项验证规则, 核验表 Part B item 3).
 */

import type { IrObjectRecord } from '../ir/store.ts'

export interface VerificationFinding {
  readonly rule: string
  readonly ok: boolean
  readonly detail: string
}

type Store = ReadonlyMap<string, IrObjectRecord>
/** What callers may pass: a Map (gate-registry shape) or a ModelingIr
 *  (which exposes `list()`; normalized by `toMap` at runtime). */
export type StoreInput = Store | { list(): ReadonlyArray<IrObjectRecord> }

/** Normalize the caller's store into a Map. Accepts a real Map (the
 *  gate-registry shape) OR a ModelingIr (has `list()`); both are common
 *  in this codebase. The verifier never mutates the store. */
function toMap(store: StoreInput): ReadonlyMap<string, IrObjectRecord> {
  if (store instanceof Map) return store
  const m = new Map<string, IrObjectRecord>()
  for (const r of (store as { list(): ReadonlyArray<IrObjectRecord> }).list()) {
    m.set(String((r.value as { [k: string]: unknown }).id ?? Object.values(r.value)[0] ?? ''), r)
  }
  return m
}

/** V1: unreferenced assumptions. */
export function v1AssumptionUsage(store: StoreInput): ReadonlyArray<VerificationFinding> {
  const findings: VerificationFinding[] = []
  const referenced = new Set<string>()
  for (const record of toMap(store).values()) {
    if (record.kind === 'ModelSpec') {
      for (const ref of (record.value as { assumption_refs?: ReadonlyArray<string> }).assumption_refs ?? []) referenced.add(ref)
    }
    if (record.kind === 'EquationSpec') {
      // EquationSpec has no direct assumption link in v1 IR; the usage
      // anchor is ModelSpec.assumption_refs (T1.2 unique owner).
    }
  }
  for (const record of toMap(store).values()) {
    if (record.kind !== 'AssumptionSpec') continue
    const a = record.value as { assumption_id: string; status: string }
    if (a.status === 'OBSOLETE') continue // obsolete assumptions may be orphaned by design
    if (!referenced.has(a.assumption_id)) {
      findings.push({ rule: 'V1 假设-使用一致性', ok: false, detail: `假设 ${a.assumption_id} 未被任何 ModelSpec 引用(假设了但没用)` })
    }
  }
  return findings
}

/** V2: assumption source-type -> required ref shape. */
export function v2AssumptionSource(store: StoreInput): ReadonlyArray<VerificationFinding> {
  const findings: VerificationFinding[] = []
  for (const record of toMap(store).values()) {
    if (record.kind !== 'AssumptionSpec') continue
    const a = record.value as {
      assumption_id: string
      source_type: string
      justification_refs?: ReadonlyArray<string>
    }
    const justs = a.justification_refs ?? []
    if (a.source_type === 'GIVEN') {
      const hasData = justs.some(ref => toMap(store).get(ref)?.kind === 'DataArtifact')
      findings.push({
        rule: 'V2 假设-来源匹配(GIVEN)',
        ok: hasData,
        detail: hasData ? `GIVEN 假设 ${a.assumption_id} 追到 DataArtifact` : `GIVEN 假设 ${a.assumption_id} 的 justification 未追到任何 DataArtifact`,
      })
    } else if (a.source_type === 'APPROXIMATION') {
      findings.push({
        rule: 'V2 假设-来源匹配(APPROXIMATION)',
        ok: justs.length > 0,
        detail: (justs.length > 0
          ? `APPROXIMATION ${a.assumption_id} 有 justification(误差界声明于其中,V7 做数值校验)`
          : `APPROXIMATION 假设 ${a.assumption_id} 缺 justification(未声明误差界来源)`),
      })
    } else if (a.source_type === 'MODELING_CHOICE') {
      findings.push({
        rule: 'V2 假设-来源匹配(MODELING_CHOICE)',
        ok: justs.length > 0,
        detail: justs.length > 0 ? `MODELING_CHOICE ${a.assumption_id} 有 justification` : `MODELING_CHOICE 假设 ${a.assumption_id} 缺 justification_refs`,
      })
    }
    // DERIVED: derived from equations — the chain is EquationSpec.depends_on;
    // structural presence is covered by V1 usage; skip here.
  }
  return findings
}

/** V3: HIGH-risk assumptions must have sensitivity experiments. */
export function v3AssumptionSensitivity(store: StoreInput): ReadonlyArray<VerificationFinding> {
  const findings: VerificationFinding[] = []
  for (const record of toMap(store).values()) {
    if (record.kind !== 'AssumptionSpec') continue
    const a = record.value as { assumption_id: string; risk_level: string; sensitivity_refs?: ReadonlyArray<string> }
    if (a.risk_level !== 'HIGH') continue
    const sens = a.sensitivity_refs ?? []
    findings.push({
      rule: 'V3 假设-结论敏感性(HIGH)',
      ok: sens.length > 0,
      detail: sens.length > 0
        ? `HIGH 假设 ${a.assumption_id} 挂 ${sens.length} 个敏感性实验`
        : `HIGH 假设 ${a.assumption_id} 无任何敏感性实验——无法判断结论对它的依赖`,
    })
  }
  return findings
}

/** V4: symbol provenance + REQUIRED_OUTPUT coverage. */
export function v4ModelCoverage(store: StoreInput): ReadonlyArray<VerificationFinding> {
  const findings: VerificationFinding[] = []
  const symbolKinds = new Set<string>()
  for (const record of toMap(store).values()) {
    if (record.kind === 'SymbolSpec') {
      symbolKinds.add(String((record.value as { symbol_id: string }).symbol_id))
    }
  }
  // (a) every symbol a model references must resolve to a SymbolSpec.
  for (const record of toMap(store).values()) {
    if (record.kind !== 'ModelSpec') continue
    const m = record.value as {
      model_id: string
      variable_refs?: ReadonlyArray<string>
      parameter_refs?: ReadonlyArray<{ symbol_ref: string }>
    }
    for (const ref of m.variable_refs ?? []) {
      if (!symbolKinds.has(ref)) {
        findings.push({ rule: 'V4 符号来源', ok: false, detail: `模型 ${m.model_id} 引用符号 ${ref} 但 store 中无 SymbolSpec——凭空引入物理量` })
      }
    }
    for (const p of m.parameter_refs ?? []) {
      if (!symbolKinds.has(p.symbol_ref)) {
        findings.push({ rule: 'V4 符号来源', ok: false, detail: `模型 ${m.model_id} 引用参数 ${p.symbol_ref} 但 store 中无 SymbolSpec` })
      }
    }
  }
  // (b) every REQUIRED_OUTPUT paid by a reaching CRITICAL result chain.
  const modelProblems = new Map<string, ReadonlyArray<string>>()
  for (const record of toMap(store).values()) {
    if (record.kind === 'ModelSpec') {
      const mv = record.value as { model_id: string; problem_refs: ReadonlyArray<string> }
      modelProblems.set(String(mv.model_id), mv.problem_refs)
    }
  }
  const reachingByProblem = new Map<string, Set<string>>()
  const reach = (problemIds: ReadonlyArray<string>, resultRef: string): void => {
    for (const problemId of problemIds) {
      const set = reachingByProblem.get(problemId) ?? new Set<string>()
      set.add(resultRef)
      reachingByProblem.set(problemId, set)
    }
  }
  for (const record of toMap(store).values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as {
      criticality: string
      result_refs: ReadonlyArray<string>
      model_refs?: ReadonlyArray<string>
    }
    if (claim.criticality !== 'CRITICAL') continue
    // 归属口径同 requirement_coverage：出处链（run→model）+ 结论自报的 model_refs。
    // 一个容器只有一次运行，只有前者时"每问一个模型"的容器永远只覆盖第一问。
    const claimedProblems = (claim.model_refs ?? []).flatMap(ref => modelProblems.get(ref) ?? [])
    for (const resultRef of claim.result_refs) {
      const result = toMap(store).get(resultRef)
      if (result?.kind !== 'Result') continue
      const run = toMap(store).get((result.value as { run_ref: string }).run_ref)
      if (run?.kind !== 'RunArtifact') continue
      const modelRef = (run.value as { model_ref: string }).model_ref
      reach(modelProblems.get(modelRef) ?? [], resultRef)
      reach(claimedProblems, resultRef)
    }
  }
  for (const record of toMap(store).values()) {
    if (record.kind !== 'RequirementSpec') continue
    const req = record.value as { requirement_id: string; requirement_type: string; source_data_ref?: string }
    if (req.requirement_type !== 'REQUIRED_OUTPUT') continue
    const problemId = linkRequirementToProblem(toMap(store), record)
    const reached = problemId === null ? 0 : (reachingByProblem.get(problemId)?.size ?? 0)
    findings.push({
      rule: 'V4 REQUIRED_OUTPUT 覆盖',
      ok: reached >= 1,
      detail: reached >= 1
        ? `REQUIRED_OUTPUT ${req.requirement_id} 由 ${reached} 个 CRITICAL 结果链支撑`
        : `REQUIRED_OUTPUT ${req.requirement_id} 无任何 CRITICAL 结果链到达(承诺未兑现)`,
    })
  }
  return findings
}

/** ProblemSpec a RequirementSpec belongs to (via source_data_ref → DA-RAW →
 *  ProblemSpec.raw_problem_ref): a light walk used by V4(b). */
function linkRequirementToProblem(store: ReadonlyMap<string, IrObjectRecord>, reqRecord: IrObjectRecord): string | null {
  const dataRef = String((reqRecord.value as { source_data_ref?: string }).source_data_ref ?? '')
  for (const record of toMap(store).values()) {
    if (record.kind !== 'ProblemSpec') continue
    const p = record.value as { problem_id: string; raw_problem_ref: string }
    if (p.raw_problem_ref === dataRef) return p.problem_id
  }
  return null
}

/** Run all four structural checks in one pass. */
export function runVerificationV1V4(store: StoreInput): ReadonlyArray<VerificationFinding> {
  return [
    ...v1AssumptionUsage(store),
    ...v2AssumptionSource(store),
    ...v3AssumptionSensitivity(store),
    ...v4ModelCoverage(store),
  ]
}
