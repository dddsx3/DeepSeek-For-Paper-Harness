/**
 * Config-consistency check — M-QUAL 阶段 A（DP-2/DP-4 落地；Q1-B4 的 N-1）.
 *
 * 抓"校核配置 ≠ 交付配置"这一**跨产物关系**断言——既有九门全部只看单个
 * 产物的内部自洽，参考工作流 2026-A 的 F1 major（校核 dt=0.25 / 交付
 * dt=1.0，两侧各自合法）正是从这条缝里溜走的。本模块是对 `execution` 门
 * （G2）走查的扩展：抵达之后，比对配置。**不新增 gate id**（N4；
 * `CRITICAL_GATE_IDS` 保持 9 项）。
 *
 * 三类对象对（Q1-B4 §1.2，映射到 DPH 语义）：
 *
 *   - **C-1 校核 ↔ 交付**：同一 ModelSpec 的两组配置逐字段比对
 *     （discretization/physical 按 symbol_ref、choices 按 key、property_set）。
 *     "校核 run" = 携带配置但**不**喂任何 CRITICAL claim 的 run（cross_check
 *     的 DPH 形态）；"交付 run" = 喂 CRITICAL claim 的 run。任何字段不一致
 *     → `config_mismatch`（标注，D-1——交付产物本身可能是正确的，拒交付
 *     会否掉一个可用产物；但标注必须携带**两侧的具体数值**）。
 *   - **C-2 声明 ↔ 实际**：配置条目 vs 该 run 的 ModelSpec.parameter_refs
 *     绑定值。声明 dt=0.5 而实跑 dt=0.2（`[P-08][4]`）→
 *     `config_declared_actual_mismatch`（元数据错误 = 记录失真，D-3）。
 *   - **C-3 跨段 ↔ 主答案**：同模型内多个交付 run 的配置差（归因表混用
 *     不同配置）。**已声明的差异不罚（D-5）**：声明载体 = `ExperimentSpec`
 *     的 `run_refs`——被设计为受控算例的 run（显式登记于 experiment）之间
 *     的配置差是方法的一部分；未登记的差异 → `config_mismatch`。
 *
 * **D-6（最重要的一条）**：CRITICAL 链上的 run 没有可解析配置 →
 * `config_evidence_missing`。"IR 没有配置字段"的现状由此变成**可检测的
 * 标注**，而不是静默的假绿（D-2 的"交付无任何校核证据"在 DPH 语义下与
 * D-6 同一形态——配置证据即记录——故合并）。
 *
 * **契约激活条件（phase-in，显式声明）**：store 中**没有任何** NumericConfig
 * 时本检查零发现（历史 store 早于该契约，豁免在 PASS 理由中可见）。一旦
 * 生产链捕获到第一份配置（DP-4：代码 emit `numeric_config.json` →
 * `numericConfigFromEmission`），契约即激活——此后每条 CRITICAL 链的 run
 * 都必须有配置证据，部分覆盖恰好是要抓的形态。
 *
 * **fail-soft 对账（M-QUAL H-G）**：本检查的任何 RED 都经由既有
 * `critical_gate` 失败通路降为 MARKED 标注（质量闸提升下限，不抬高门槛）；
 * 不把配置缺失加进 fatal 闭集。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/config-consistency
 */

import type { IrObjectRecord } from '../ir/store.ts'
import type { NumericConfig } from '../ir/numeric-config.ts'

export interface ConfigConsistencyFinding {
  readonly kind:
    | 'config_evidence_missing'
    | 'config_mismatch'
    | 'config_declared_actual_mismatch'
  /** The run the finding binds to (the delivery/verification side). */
  readonly runId: string
  /** The config field (or 'config') the finding names. */
  readonly field: string
  readonly reason: string
}

interface RunFacts {
  readonly modelRef: string
  /** Whether the run feeds at least one CRITICAL claim chain. */
  readonly delivery: boolean
}

/** Runs on CRITICAL chains + the models those runs belong to. */
function criticalChainRuns(store: ReadonlyMap<string, IrObjectRecord>): Map<string, RunFacts> {
  const runModel = new Map<string, string>()
  for (const record of store.values()) {
    if (record.kind !== 'RunArtifact') continue
    runModel.set(record.value.run_id, record.value.model_ref)
  }
  const delivery = new Set<string>()
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as { criticality: string; result_refs: ReadonlyArray<string> }
    if (claim.criticality !== 'CRITICAL') continue
    for (const resultRef of claim.result_refs) {
      const result = store.get(resultRef)
      if (result === undefined || result.kind !== 'Result') continue
      const runRef = (result.value as { run_ref: string }).run_ref
      if (runModel.has(runRef)) delivery.add(runRef)
    }
  }
  const out = new Map<string, RunFacts>()
  for (const [runId, modelRef] of runModel) {
    out.set(runId, { modelRef, delivery: delivery.has(runId) })
  }
  return out
}

/** Runs explicitly designed as experiment instances (the D-5 declaration). */
function experimentDeclaredRuns(store: ReadonlyMap<string, IrObjectRecord>): Set<string> {
  const declared = new Set<string>()
  for (const record of store.values()) {
    if (record.kind !== 'ExperimentSpec') continue
    for (const runRef of record.value.run_refs) declared.add(runRef)
  }
  return declared
}

/** Configs by the run they record. */
function configsByRun(store: ReadonlyMap<string, IrObjectRecord>): Map<string, NumericConfig> {
  const out = new Map<string, NumericConfig>()
  for (const record of store.values()) {
    if (record.kind !== 'NumericConfig') continue
    const config = record.value
    out.set(config.run_ref, config)
  }
  return out
}

/** One flattened comparable entry: section + key + value. */
function configEntries(config: NumericConfig): Map<string, { value: number | string | null; token: string }> {
  const entries = new Map<string, { value: number | string | null; token: string }>()
  for (const e of config.discretization) entries.set(`discretization.${e.symbol_ref}`, { value: e.value, token: e.symbol_ref })
  for (const e of config.physical) entries.set(`physical.${e.symbol_ref}`, { value: e.value, token: e.symbol_ref })
  for (const e of config.choices) entries.set(`choices.${e.key}`, { value: e.value, token: e.key })
  entries.set('property_set', { value: config.property_set, token: 'property_set' })
  return entries
}

/**
 * Walk the canonical store and report every config-consistency violation.
 * Pure, total, read-only. See the module header for the C/D taxonomy, the
 * contract activation rule and the fail-soft disposition.
 */
export function configConsistencyFindings(
  store: ReadonlyMap<string, IrObjectRecord> | null,
): ReadonlyArray<ConfigConsistencyFinding> {
  if (store === null) return []
  const findings: ConfigConsistencyFinding[] = []

  const configs = configsByRun(store)
  if (configs.size === 0) return findings // contract inactive (pre-M5 store)

  const runs = criticalChainRuns(store)
  const declared = experimentDeclaredRuns(store)

  // D-6: every CRITICAL-chain run must carry resolvable config evidence.
  for (const [runId, facts] of runs) {
    if (!facts.delivery) continue
    if (!configs.has(runId)) {
      findings.push({
        kind: 'config_evidence_missing',
        runId,
        field: 'config',
        reason: `run '${runId}' feeds a CRITICAL claim chain but records no NumericConfig — unverified configuration is not deliverable evidence (D-6; the config contract is active because ${configs.size} config(s) exist in this store)`,
      })
    }
  }

  // C-1 / C-3: field-level comparison of every config pair of one model.
  const byModel = new Map<string, Array<{ runId: string; config: NumericConfig }>>()
  for (const [runId, config] of configs) {
    const modelRef = runs.get(runId)?.modelRef
    // A config whose run is unknown is a dangling run_ref — reference
    // validation owns that verdict; skip here to avoid double reporting.
    if (modelRef === undefined) continue
    const bucket = byModel.get(modelRef) ?? []
    bucket.push({ runId, config })
    byModel.set(modelRef, bucket)
  }

  for (const [modelRef, bucket] of byModel) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i]
        const b = bucket[j]
        if (a === undefined || b === undefined) continue
        // D-5: a config difference between two runs explicitly designed as
        // experiment instances is a declared controlled experiment.
        if (declared.has(a.runId) && declared.has(b.runId)) continue
        const ae = configEntries(a.config)
        const be = configEntries(b.config)
        for (const [field, av] of ae) {
          const bv = be.get(field)
          if (bv === undefined) {
            findings.push({
              kind: 'config_mismatch',
              runId: b.runId,
              field,
              reason: `runs '${a.runId}' and '${b.runId}' of model '${modelRef}' disagree on '${field}': '${a.runId}' declares ${JSON.stringify(av.value)} but '${b.runId}' does not record it (C-1; both values must be reported, not a fingerprint)`,
            })
            continue
          }
          if (av.value !== bv.value) {
            const crossSection = a.config.run_ref !== b.config.run_ref && factsBothDelivery(a.runId, b.runId, runs)
            findings.push({
              kind: 'config_mismatch',
              runId: b.runId,
              field,
              reason: `runs '${a.runId}' and '${b.runId}' of model '${modelRef}' disagree on '${field}': ${JSON.stringify(av.value)} vs ${JSON.stringify(bv.value)}${crossSection ? ' (cross-section within one answer — declare it via an ExperimentSpec or unify, C-3/D-4)' : ' (the check must not endorse a delivery it did not run at, C-1/D-1)'}`,
            })
          }
        }
        for (const [field, bv] of be) {
          if (ae.has(field)) continue
          findings.push({
            kind: 'config_mismatch',
            runId: a.runId,
            field,
            reason: `runs '${a.runId}' and '${b.runId}' of model '${modelRef}' disagree on '${field}': '${b.runId}' declares ${JSON.stringify(bv.value)} but '${a.runId}' does not record it (C-1)`,
          })
        }
      }
    }
  }

  // C-2: emitted config entries vs the run's model's declared parameters.
  const parameterValues = new Map<string, Map<string, number>>() // modelRef -> symbol_ref -> value
  for (const record of store.values()) {
    if (record.kind !== 'ModelSpec') continue
    const model = record.value as { model_id: string; parameter_refs: ReadonlyArray<{ symbol_ref: string; value: number }> }
    const values = new Map<string, number>()
    for (const p of model.parameter_refs) values.set(p.symbol_ref, p.value)
    parameterValues.set(model.model_id, values)
  }
  for (const [runId, config] of configs) {
    const modelRef = runs.get(runId)?.modelRef
    if (modelRef === undefined) continue
    const declaredParams = parameterValues.get(modelRef)
    if (declaredParams === undefined) continue
    for (const [section, entries] of [['discretization', config.discretization], ['physical', config.physical]] as const) {
      for (const entry of entries) {
        const declaredValue = declaredParams.get(entry.symbol_ref)
        if (declaredValue === undefined) continue // symbol not bound as a parameter — nothing to compare
        if (declaredValue !== entry.value) {
          findings.push({
            kind: 'config_declared_actual_mismatch',
            runId,
            field: `${section}.${entry.symbol_ref}`,
            reason: `run '${runId}' emitted ${section} '${entry.symbol_ref}' = ${entry.value} but its model '${modelRef}' declares ${declaredValue} (C-2: the recorded value is not the value that was declared to run — record distortion, D-3)`,
          })
        }
      }
    }
  }

  return findings
}

function factsBothDelivery(a: string, b: string, runs: Map<string, RunFacts>): boolean {
  const fa = runs.get(a)
  const fb = runs.get(b)
  return fa?.delivery === true && fb?.delivery === true
}
