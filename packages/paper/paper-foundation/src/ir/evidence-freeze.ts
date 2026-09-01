/**
 * Evidence Chain Freeze & Independent Audit (TASK 2.1).
 *
 * TASK 2 made every CRITICAL numeric Claim *structurally* bound to a
 * canonical Result. TASK 2.1 makes that binding *verifiable by an
 * independent auditor*: the chain (Claim → Result → RunArtifact) is
 * fingerprinted at freeze time, and a read-only auditor can later
 * re-derive every fingerprint from a live snapshot and prove — or
 * refute — that the evidence chain is exactly the one that was frozen.
 *
 * Three properties, one per phase of the task book:
 *
 *   PHASE 0 — **Freeze snapshot.** {@link buildEvidenceFreeze} walks a
 *     canonical snapshot and emits {@link EvidenceFreezeManifest}: every
 *     Claim (with its numeric binding), every Result (value / unit /
 *     producer / timestamp), every RunArtifact (code hash + derived
 *     environment and dependency-lock fingerprints), plus a per-claim
 *     `evidence_chain_hash` (INV-2.1-A) and two manifest-level hashes.
 *
 *   PHASE 1 — **Independent audit.** {@link auditEvidenceFreeze} is a
 *     pure, total, READ-ONLY function over (snapshot, manifest). It
 *     never mutates the store, never repairs a claim, never invents
 *     evidence (RT-E4: producer ≠ auditor). It returns an
 *     {@link EvidenceAuditReport} whose closed failure taxonomy is
 *     MISSING_RESULT / RESULT_MISMATCH / RUN_UNVERIFIED / HASH_CHANGED /
 *     CHAIN_BROKEN.
 *
 *   PHASE 2 — **Freeze integrity (INV-2.1-A).** Every claim's
 *     `evidence_chain_hash` covers the claim (including its numeric
 *     binding), every referenced Result (value + unit), every referenced
 *     Run (code / environment / dependency fingerprints), and the
 *     claim's evidence refs. Any change to any of those — in the store
 *     OR in the manifest — flips the hash and the audit FAILs.
 *
 * Deliberate non-goals (documented in the handoff known-risks):
 *   - **Execution reality**: that `Result.value` was actually produced
 *     by the code `code_hash` names is TASK 3 (Execution Provenance
 *     Gate). The environment / dependency hashes here are freeze-time
 *     *fingerprints of declared metadata*, not proofs of execution.
 *   - **Whole-store freezing**: the freeze covers evidence chains, not
 *     the entire store. Adding an unrelated VerificationResult after a
 *     freeze does not (and should not) fail a claim audit.
 *   - **Out-of-band anchoring**: a self-consistent manifest can be
 *     fabricated by re-freezing a tampered store. `manifest_hash` is
 *     the value an external auditor compares against the freeze-hash
 *     registry (`freeze-hash-report.json`) received out-of-band.
 *     Producer ≠ auditor: the agent that produced the evidence can
 *     never be the one that anchors its hash.
 */

import { createHash } from 'node:crypto'
import type { Claim, NumericClaimBinding } from './schema.ts'
import type { IrObjectRecord } from './store.ts'

// ---------------------------------------------------------------------------
// Hashing primitives
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialisation: object keys sorted lexicographically,
 * arrays in order, no whitespace. Two structurally equal values always
 * produce the same bytes, so `sha256(canonicalJson(v))` is a stable
 * fingerprint. `-0` serialises as `0` (JSON has no negative zero), and
 * `NaN` / `±Infinity` cannot appear in canonical state (zod rejects them
 * at ingest), so number formatting is not a drift source.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`
  }
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  const source = value as Record<string, unknown>
  const keys = Object.keys(source).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`
}

/** sha256 hex digest of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Freeze manifest types (PHASE 0)
// ---------------------------------------------------------------------------

/** One frozen Claim with its INV-2.1-A evidence-chain fingerprint. */
export interface FrozenClaim {
  readonly claim_id: string
  readonly claim_type: string
  readonly criticality: string
  /** Convenience flag: `criticality === 'CRITICAL'`. */
  readonly critical: boolean
  readonly evidence_refs: ReadonlyArray<string>
  readonly result_refs: ReadonlyArray<string>
  readonly numeric_binding: NumericClaimBinding | null
  readonly evidence_chain_hash: string
  /** Store ingest timestamp of the claim record. */
  readonly timestamp: string
}

/** One frozen Result. `producer` is the run that produced it. */
export interface FrozenResult {
  readonly result_id: string
  readonly run_ref: string
  readonly value: number
  readonly unit: string
  readonly producer: string
  readonly timestamp: string
}

/**
 * One frozen RunArtifact. `environment_hash` and `dependency_lock_hash`
 * are freeze-time fingerprints over the run's *declared* metadata —
 * they make any metadata drift visible, but they are not proofs of
 * execution (TASK 3 owns that).
 */
export interface FrozenRun {
  readonly run_id: string
  readonly model_ref: string
  readonly code_hash: string
  readonly environment_hash: string
  readonly dependency_lock_hash: string
  readonly timestamp: string
}

/**
 * The freeze snapshot. `freeze_hash` covers the evidence content only
 * (not `generated_at`, so two freezes of the same store produce the
 * same freeze_hash regardless of clock). `manifest_hash` covers the
 * freeze content *including* `freeze_hash` — it is the out-of-band
 * anchor an external auditor compares against the hash registry.
 */
export interface EvidenceFreezeManifest {
  readonly manifest_version: 1
  readonly generated_at: string
  readonly freeze_hash: string
  readonly manifest_hash: string
  readonly claims: ReadonlyArray<FrozenClaim>
  readonly results: ReadonlyArray<FrozenResult>
  readonly runs: ReadonlyArray<FrozenRun>
}

export interface EvidenceFreezeOptions {
  /** Clock for `generated_at`; injectable so freezes stay reproducible. */
  readonly now?: () => string
}

// ---------------------------------------------------------------------------
// Freeze builders (PHASE 0)
// ---------------------------------------------------------------------------

function environmentFingerprint(run: Readonly<Record<string, unknown>>): string {
  return sha256Hex(canonicalJson({ environment: run['environment'], seed: run['seed'] }))
}

function dependencyLockFingerprint(
  run: Readonly<Record<string, unknown>>,
  model: Readonly<Record<string, unknown>> | undefined,
): string {
  return sha256Hex(canonicalJson({
    input_data_refs: run['input_data_refs'],
    parameter_refs: model?.['parameter_refs'] ?? [],
    assumptions: model?.['assumptions'] ?? [],
    unresolved_model: model === undefined ? run['model_ref'] : undefined,
  }))
}

/**
 * TASK 3 (D4): the declared-environment fingerprint derivations are
 * exported so the execution layer's capture and replay compute
 * *identical* fingerprints from the same RunArtifact — one derivation,
 * one meaning. Renamed publicly; the freeze side uses the same functions.
 */
export function declaredEnvironmentFingerprint(run: Readonly<Record<string, unknown>>): string {
  return environmentFingerprint(run)
}

export function declaredDependencyLockFingerprint(
  run: Readonly<Record<string, unknown>>,
  model: Readonly<Record<string, unknown>> | undefined,
): string {
  return dependencyLockFingerprint(run, model)
}

function chainDigest(store: ReadonlyMap<string, IrObjectRecord>, claim: Claim): string {
  const binding = claim.claim_type === 'NUMERIC' ? claim.numeric_binding : null
  const resultRefs = [...new Set([...claim.result_refs, ...(binding ? [binding.result_ref] : [])])]

  const resultEntries = resultRefs.map(ref => {
    const record = store.get(ref)
    if (record === undefined || record.kind !== 'Result') return { result_id: ref, missing: true }
    return {
      result_id: ref,
      value: record.value.value,
      unit: record.value.unit,
      run_ref: record.value.run_ref,
    }
  })

  const runIds = [...new Set(resultEntries
    .filter(entry => !('missing' in entry))
    .map(entry => (entry as { run_ref: string }).run_ref))]

  const runEntries = runIds.map(runId => {
    const record = store.get(runId)
    if (record === undefined || record.kind !== 'RunArtifact') return { run_id: runId, missing: true }
    const modelRecord = store.get(record.value.model_ref)
    return {
      run_id: runId,
      code_hash: record.value.code_hash,
      environment_hash: environmentFingerprint(record.value),
      dependency_lock_hash: dependencyLockFingerprint(record.value, modelRecord?.value),
    }
  })

  return sha256Hex(canonicalJson({
    claim: {
      claim_id: claim.claim_id,
      claim_type: claim.claim_type,
      criticality: claim.criticality,
      evidence_refs: claim.evidence_refs,
      result_refs: claim.result_refs,
      numeric_binding: binding,
    },
    evidence_refs: claim.evidence_refs,
    results: resultEntries,
    run_reference: runEntries,
  }))
}

/**
 * Build the freeze manifest from a canonical snapshot.
 *
 * Total: never throws; a snapshot that is not a canonical store must be
 * refused by the caller (`ModelingIr.snapshot` returns `null` there).
 * Deterministic: two freezes of the same store produce byte-identical
 * `freeze_hash` / `manifest_hash` (only `generated_at` may differ, and
 * it is excluded from both hashes).
 */
export function buildEvidenceFreeze(
  store: ReadonlyMap<string, IrObjectRecord>,
  options: EvidenceFreezeOptions = {},
): EvidenceFreezeManifest {
  const claims: FrozenClaim[] = []
  const results: FrozenResult[] = []
  const runs: FrozenRun[] = []

  for (const record of store.values()) {
    if (record.kind === 'Claim') {
      const claim = record.value as Claim
      claims.push({
        claim_id: claim.claim_id,
        claim_type: claim.claim_type,
        criticality: claim.criticality,
        critical: claim.criticality === 'CRITICAL',
        evidence_refs: [...claim.evidence_refs],
        result_refs: [...claim.result_refs],
        numeric_binding: claim.claim_type === 'NUMERIC' ? claim.numeric_binding : null,
        evidence_chain_hash: chainDigest(store, claim),
        timestamp: record.ingestedAt,
      })
    } else if (record.kind === 'Result') {
      results.push({
        result_id: record.value.result_id,
        run_ref: record.value.run_ref,
        value: record.value.value,
        unit: record.value.unit,
        producer: record.value.run_ref,
        timestamp: record.ingestedAt,
      })
    } else if (record.kind === 'RunArtifact') {
      const modelRecord = store.get(record.value.model_ref)
      runs.push({
        run_id: record.value.run_id,
        model_ref: record.value.model_ref,
        code_hash: record.value.code_hash,
        environment_hash: environmentFingerprint(record.value),
        dependency_lock_hash: dependencyLockFingerprint(record.value, modelRecord?.value),
        timestamp: record.ingestedAt,
      })
    }
  }

  const byId = <T>(a: T, b: T, key: keyof T) =>
    String(a[key]).localeCompare(String(b[key]))
  claims.sort((a, b) => byId(a, b, 'claim_id'))
  results.sort((a, b) => byId(a, b, 'result_id'))
  runs.sort((a, b) => byId(a, b, 'run_id'))

  const freeze_hash = sha256Hex(canonicalJson({ claims, results, runs }))
  const manifest_hash = sha256Hex(canonicalJson({
    manifest_version: 1,
    freeze_hash,
    claims,
    results,
    runs,
  }))

  return {
    manifest_version: 1,
    generated_at: (options.now ?? (() => new Date().toISOString()))(),
    freeze_hash,
    manifest_hash,
    claims,
    results,
    runs,
  }
}

// ---------------------------------------------------------------------------
// Audit (PHASE 1) — read-only, total, closed failure taxonomy
// ---------------------------------------------------------------------------

/** Closed failure categories. An attacker cannot invent a verdict. */
export const EVIDENCE_AUDIT_CATEGORIES = [
  'MISSING_RESULT',
  'RESULT_MISMATCH',
  'RUN_UNVERIFIED',
  'HASH_CHANGED',
  'CHAIN_BROKEN',
] as const
export type EvidenceAuditCategory = (typeof EVIDENCE_AUDIT_CATEGORIES)[number]

/** Closed severity set. `MEDIUM` never flips the audit verdict. */
export const EVIDENCE_AUDIT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM'] as const
export type EvidenceAuditSeverity = (typeof EVIDENCE_AUDIT_SEVERITIES)[number]

export interface EvidenceAuditFailure {
  readonly claim_id: string
  readonly category: EvidenceAuditCategory
  readonly severity: EvidenceAuditSeverity
  /** Stable, human-readable cause; safe for an audit record. */
  readonly reason: string
}

export interface EvidenceAuditReport {
  readonly audit_id: string
  readonly status: 'PASS' | 'FAIL'
  /**
   * Number of CRITICAL claims examined (the success criterion is
   * "100% critical claims audited"). Non-critical claims are also
   * audited, but their failures carry severity MEDIUM and never flip
   * the verdict.
   */
  readonly claims_checked: number
  readonly failures: ReadonlyArray<EvidenceAuditFailure>
  /**
   * The manifest hash the audit ran against. The external auditor
   * compares this against the out-of-band freeze-hash registry —
   * equality proves the manifest is the frozen one, not a fabrication
   * (RT-E4: producer ≠ auditor).
   */
  readonly manifest_hash: string
}

/**
 * Audit a live canonical snapshot against a frozen manifest.
 *
 * Read-only: the store is never mutated (the snapshot map is only read).
 * Total: never throws. Fail-closed: manifest tampering, missing claims,
 * value drift, run drift, and any chain break all produce FAIL.
 *
 * Severity policy (closed):
 *   - failures on a CRITICAL claim: MISSING_RESULT / RESULT_MISMATCH →
 *     CRITICAL; RUN_UNVERIFIED / HASH_CHANGED / CHAIN_BROKEN → HIGH.
 *   - the same categories on a NON_CRITICAL claim → MEDIUM (recorded,
 *     but the audit can still PASS — the task book's verdict rule is
 *     "any CRITICAL claim failure → FAIL").
 *   - manifest-level tampering → a single CRITICAL failure attributed
 *     to claim_id `'<manifest>'`.
 */
export function auditEvidenceFreeze(
  store: ReadonlyMap<string, IrObjectRecord>,
  manifest: EvidenceFreezeManifest,
): EvidenceAuditReport {
  const failures: EvidenceAuditFailure[] = []
  const push = (claim_id: string, category: EvidenceAuditCategory, severity: EvidenceAuditSeverity, reason: string) =>
    failures.push({ claim_id, category, severity, reason })

  // Manifest integrity first: a tampered manifest invalidates every
  // per-claim verdict, so the audit refuses as a whole (RT-E4).
  const recomputedManifestHash = sha256Hex(canonicalJson({
    manifest_version: manifest.manifest_version,
    freeze_hash: manifest.freeze_hash,
    claims: manifest.claims,
    results: manifest.results,
    runs: manifest.runs,
  }))
  if (recomputedManifestHash !== manifest.manifest_hash) {
    push('<manifest>', 'HASH_CHANGED', 'CRITICAL',
      `manifest_hash mismatch: frozen '${manifest.manifest_hash}' vs recomputed '${recomputedManifestHash}'`)
    return report(store, manifest, failures, 0)
  }

  // claims_checked counts CRITICAL claims from BOTH sides of the
  // comparison: a critical claim that exists only in the store (added
  // after the freeze — the self-approval attack) or only in the
  // manifest (vanishing claim) is a chain break, and it must be counted.
  const manifestById = new Map(manifest.claims.map(c => [c.claim_id, c]))
  const liveIds = new Set<string>()
  for (const record of store.values()) {
    if (record.kind === 'Claim') liveIds.add((record.value as Claim).claim_id)
  }
  const allIds = [...new Set([...manifestById.keys(), ...liveIds])].sort()
  const criticalCount = allIds.filter(id => {
    const liveCritical = liveClaim(store, id)?.criticality === 'CRITICAL'
    const manifestCritical = manifestById.get(id)?.critical === true
    return liveCritical || manifestCritical
  }).length

  for (const claimId of allIds) {
    const liveRecord = store.get(claimId)
    const live = liveRecord !== undefined && liveRecord.kind === 'Claim'
      ? liveRecord.value as Claim
      : undefined
    const frozen = manifestById.get(claimId)
    const critical = (live?.criticality ?? frozen?.criticality) === 'CRITICAL'
    const sev = (s: 'CRITICAL' | 'HIGH') => (critical ? s : 'MEDIUM')

    if (live === undefined || frozen === undefined) {
      push(claimId, 'CHAIN_BROKEN', sev('CRITICAL'),
        live === undefined
          ? 'claim present in the frozen manifest but absent from the live store'
          : 'claim present in the live store but absent from the frozen manifest (unfrozen evidence)')
      continue
    }

    // Claim-content drift: criticality or claim_type changed.
    if (live.criticality !== frozen.criticality || live.claim_type !== frozen.claim_type) {
      push(claimId, 'HASH_CHANGED', sev('HIGH'),
        `claim metadata drift: frozen (${frozen.claim_type}/${frozen.criticality}) vs live (${live.claim_type}/${live.criticality})`)
    }

    // Result layer: every referenced result (explicit refs + binding)
    // must exist on both sides with identical value and unit.
    const binding = live.claim_type === 'NUMERIC' ? live.numeric_binding : null
    const frozenBinding = frozen.numeric_binding
    const liveRefs = [...new Set([...live.result_refs, ...(binding ? [binding.result_ref] : [])])]
    const frozenRefs = [...new Set([...frozen.result_refs, ...(frozenBinding ? [frozenBinding.result_ref] : [])])]
    for (const ref of new Set([...liveRefs, ...frozenRefs])) {
      const liveResult = store.get(ref)
      const liveIsResult = liveResult !== undefined && liveResult.kind === 'Result'
      const frozenResult = manifest.results.find(r => r.result_id === ref)

      if (!liveIsResult || frozenResult === undefined) {
        push(claimId, 'MISSING_RESULT', sev('CRITICAL'),
          liveIsResult
            ? `result '${ref}' exists in the store but is not in the frozen manifest`
            : `result '${ref}' is referenced by the evidence chain but not resolvable`)
        continue
      }
      const liveValue = liveResult.value as { value: number; unit: string; run_ref: string }
      if (liveValue.value !== frozenResult.value || liveValue.unit !== frozenResult.unit) {
        push(claimId, 'RESULT_MISMATCH', sev('CRITICAL'),
          `result '${ref}' drift: frozen (${frozenResult.value} ${frozenResult.unit}) vs live (${liveValue.value} ${liveValue.unit})`)
      }

      // Run layer: the result's producing run must verify on both sides.
      const runRef = liveValue.run_ref
      const liveRun = store.get(runRef)
      const liveIsRun = liveRun !== undefined && liveRun.kind === 'RunArtifact'
      const frozenRun = manifest.runs.find(r => r.run_id === runRef)
      if (!liveIsRun || frozenRun === undefined) {
        push(claimId, 'RUN_UNVERIFIED', sev('HIGH'),
          liveIsRun
            ? `run '${runRef}' exists in the store but is not in the frozen manifest`
            : `run '${runRef}' is referenced by result '${ref}' but not resolvable`)
        continue
      }
      const liveRunValue = liveRun.value as { code_hash: string; environment: string; seed: unknown }
      const liveEnvHash = sha256Hex(canonicalJson({ environment: liveRunValue.environment, seed: liveRunValue.seed }))
      if (liveRunValue.code_hash !== frozenRun.code_hash || liveEnvHash !== frozenRun.environment_hash) {
        push(claimId, 'RUN_UNVERIFIED', sev('HIGH'),
          `run '${runRef}' fingerprint drift: frozen code '${frozenRun.code_hash.slice(0, 12)}…'/env '${frozenRun.environment_hash.slice(0, 12)}…' vs live code '${liveRunValue.code_hash.slice(0, 12)}…'/env '${liveEnvHash.slice(0, 12)}…'`)
      }
    }

    // INV-2.1-A: the whole chain fingerprint must be byte-stable.
    const liveChainHash = chainDigest(store, live)
    if (liveChainHash !== frozen.evidence_chain_hash) {
      push(claimId, 'HASH_CHANGED', sev('HIGH'),
        `evidence_chain_hash drift: frozen '${frozen.evidence_chain_hash.slice(0, 16)}…' vs live '${liveChainHash.slice(0, 16)}…'`)
    }
  }

  return report(store, manifest, failures, criticalCount)
}

function liveClaim(store: ReadonlyMap<string, IrObjectRecord>, id: string): Claim | undefined {
  const record = store.get(id)
  return record !== undefined && record.kind === 'Claim' ? record.value as Claim : undefined
}

function report(
  store: ReadonlyMap<string, IrObjectRecord>,
  manifest: EvidenceFreezeManifest,
  failures: EvidenceAuditFailure[],
  claimsChecked: number,
): EvidenceAuditReport {
  const status: 'PASS' | 'FAIL' = failures.some(f => f.severity !== 'MEDIUM') ? 'FAIL' : 'PASS'
  const digest = sha256Hex(canonicalJson([...store.keys()].sort()))
  return {
    audit_id: `AUD-${sha256Hex(`${manifest.manifest_hash}|${digest}`).slice(0, 16)}`,
    status,
    claims_checked: claimsChecked,
    failures,
    manifest_hash: manifest.manifest_hash,
  }
}
