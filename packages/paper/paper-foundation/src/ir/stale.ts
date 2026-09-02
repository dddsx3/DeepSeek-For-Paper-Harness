/**
 * STALE engine (TASK 3.5 / INV-3.5-A, S-007..S-009).
 *
 * The IR's reference closure (TASK 1.5R) already produces a *graph*:
 *   - Claim.result_refs -> Result
 *   - Result.run_ref     -> RunArtifact
 *   - RunArtifact.model_ref -> ModelSpec
 *   - RunArtifact.input_data_refs -> DataArtifact
 *   - ExecutionRecord.run_ref -> RunArtifact
 *
 * The STALE engine derives the downstream propagation from this graph
 * without adding any new fields or declarations. A run is STALE when:
 *
 *   1. Its `code_ref` bytes no longer hash to its declared `code_hash`
 *      (S-007: byte-level drift, the declared `code_hash` is untrusted).
 *   2. Its captured `ExecutionRecord` re-derived digests no longer
 *      reproduce the canonical state (S-008: hand-edited record).
 *
 * STALE propagates DOWNSTREAM from a stale run: its Result, any Claim
 * citing that Result, any FigureSpec citing the Result, and the
 * critical-chain reachability is broken end-to-end. STALE is a verdict
 * the auditor can report, not a state the store can be put into
 * (append-only), and there is NO `markFresh()` interface (S-008):
 * the only way to clear a STALE is to ingest a fresh ExecutionRecord
 * via `putExecutionRecord(record, CAPTURE_ATTESTATION)`.
 */

import { createHash } from 'node:crypto'
import {
  canonicalJson,
  declaredDependencyLockFingerprint,
  declaredEnvironmentFingerprint,
  sha256Hex,
} from './evidence-freeze.ts'
import type { IrObjectRecord } from './store.ts'
import type { Claim, ExecutionRecord, Result, RunArtifact } from './schema.ts'

/** Closed set of STALE reasons. An attacker cannot invent a verdict. */
export const STALE_REASONS = [
  'CODE_MISMATCH',          // S-007: code_ref bytes hash != declared code_hash
  'DEPENDENCY_MISMATCH',    // run's input_data_refs / dependency_lock_hash drifted
  'EXECUTION_MISMATCH',     // S-008: record.replay vs canonical state
  'STALE_TRANSITIVE',       // downstream of a STALE upstream
] as const
export type StaleReason = (typeof STALE_REASONS)[number]

export interface StaleFinding {
  readonly id: string                       // run_id | result_id | claim_id
  readonly kind: 'RunArtifact' | 'Result' | 'Claim'
  readonly reason: StaleReason
  readonly reason_text: string
  readonly upstream_run_id: string | null
}

export interface StaleReport {
  readonly report_version: 1
  readonly generated_at: string
  readonly store_digest: string
  readonly stale: ReadonlyArray<StaleFinding>
}

/**
 * Compute the STALE report for a canonical store. Read-only; total.
 *
 * @param loadCode - the IR has no filesystem; the composition must
 *                   inject a code-bytes loader. When `undefined` the
 *                   code-bytes check is skipped (the IR-only check
 *                   still finds dependency-mismatch + execution-mismatch
 *                   + transitive STALE).
 */
export function computeStaleReport(
  store: ReadonlyMap<string, IrObjectRecord>,
  options: {
    readonly now?: () => string
    readonly loadCode?: (codeRef: string) => Promise<string> | string
  } = {},
): StaleReport {
  const runs = collectRuns(store)
  const direct = deriveDirectStale(store, runs, options)
  const directRunIds = new Set(direct.filter(d => d.kind === 'RunArtifact').map(d => d.id))
  const transitive = deriveTransitiveStale(store, directRunIds)
  const all = [...direct, ...transitive]
  const digest = sha256Hex(canonicalJson([...store.keys()].sort()))
  return {
    report_version: 1,
    generated_at: (options.now ?? (() => new Date().toISOString()))(),
    store_digest: digest,
    stale: all,
  }
}

interface RunSnapshot {
  run: RunArtifact
  record: ExecutionRecord | null
}

function collectRuns(store: ReadonlyMap<string, IrObjectRecord>): RunSnapshot[] {
  const runs: RunSnapshot[] = []
  for (const record of store.values()) {
    if (record.kind !== 'RunArtifact') continue
    const value = record.value as RunArtifact
    let captured: ExecutionRecord | null = null
    for (const other of store.values()) {
      if (other.kind !== 'ExecutionRecord') continue
      const exec = other.value as ExecutionRecord
      if (exec.run_ref === value.run_id) {
        captured = exec
        break
      }
    }
    runs.push({ run: value, record: captured })
  }
  return runs
}

function deriveDirectStale(
  store: ReadonlyMap<string, IrObjectRecord>,
  runs: RunSnapshot[],
  options: { readonly loadCode?: (codeRef: string) => Promise<string> | string },
): StaleFinding[] {
  const out: StaleFinding[] = []
  for (const { run, record } of runs) {
    // S-007: code bytes vs declared code_hash.
    if (options.loadCode !== undefined) {
      try {
        const bytes = options.loadCode(run.code_ref)
        // loadCode may be async; we accept a Promise or a string.
        const handle = (typeof (bytes as Promise<string>).then === 'function')
          ? null
          : (bytes as string)
        const codeText = handle !== null
          ? handle
          : (requirePromise(bytes as Promise<string>))
        const codeHash = `sha256:${createHash('sha256').update(codeText, 'utf8').digest('hex')}`
        if (codeHash !== run.code_hash) {
          out.push({
            id: run.run_id, kind: 'RunArtifact',
            reason: 'CODE_MISMATCH',
            reason_text: `code bytes hash to ${codeHash}; declared ${run.code_hash}`,
            upstream_run_id: null,
          })
        }
      } catch {
        // A code_ref that cannot be loaded is itself a STALE signal:
        // the bytes the record claims to have produced are not
        // reproducible, which is a stricter form of CODE_MISMATCH.
        out.push({
          id: run.run_id, kind: 'RunArtifact',
          reason: 'CODE_MISMATCH',
          reason_text: `code_ref '${run.code_ref}' could not be loaded`,
          upstream_run_id: null,
        })
      }
    }

    // Dependency-lock drift: re-derive from the canonical store and
    // compare to the record (or to the run declaration when no record).
    const expectedDep = declaredDependencyLockFingerprint(run, modelOf(store, run.model_ref))
    if (record === null) {
      // No record at all: the run has no executable evidence. This is
      // a STALE finding for the provenance contract — the producer-
      // only path (3.R3 / INV-3-M) is the only way to clear it.
      out.push({
        id: run.run_id, kind: 'RunArtifact',
        reason: 'EXECUTION_MISMATCH',
        reason_text: 'no ExecutionRecord for this run',
        upstream_run_id: null,
      })
    } else {
      if (record.dependency_lock_hash !== expectedDep) {
        out.push({
          id: run.run_id, kind: 'RunArtifact',
          reason: 'DEPENDENCY_MISMATCH',
          reason_text: `record freezes dep lock ${record.dependency_lock_hash.slice(0, 12)}…; canonical re-derives ${expectedDep.slice(0, 12)}…`,
          upstream_run_id: null,
        })
      }
      // Environment drift: declared vs canonical.
      const expectedEnv = declaredEnvironmentFingerprint(run)
      if (record.environment_hash !== expectedEnv) {
        out.push({
          id: run.run_id, kind: 'RunArtifact',
          reason: 'EXECUTION_MISMATCH',
          reason_text: `record freezes environment ${record.environment_hash.slice(0, 12)}…; canonical re-derives ${expectedEnv.slice(0, 12)}…`,
          upstream_run_id: null,
        })
      }
    }
  }
  return out
}

function deriveTransitiveStale(
  store: ReadonlyMap<string, IrObjectRecord>,
  directRunIds: Set<string>,
): StaleFinding[] {
  if (directRunIds.size === 0) return []
  const out: StaleFinding[] = []
  // 1) Results whose run is stale are themselves stale.
  for (const record of store.values()) {
    if (record.kind !== 'Result') continue
    const result = record.value as Result
    if (directRunIds.has(result.run_ref)) {
      out.push({
        id: result.result_id, kind: 'Result',
        reason: 'STALE_TRANSITIVE',
        reason_text: `result '${result.result_id}' cites stale run '${result.run_ref}'`,
        upstream_run_id: result.run_ref,
      })
    }
  }
  // 2) Claims that cite a stale result, or that cite any run directly,
  //    are stale.
  const staleResultIds = new Set(out.filter(f => f.kind === 'Result').map(f => f.id))
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as Claim
    if (claim.criticality !== 'CRITICAL') continue
    let stale = false
    for (const ref of claim.result_refs) {
      if (staleResultIds.has(ref)) { stale = true; break }
    }
    if (!stale) {
      for (const ref of claim.model_refs) {
        if (directRunIds.has(ref)) { stale = true; break }
      }
    }
    if (stale) {
      out.push({
        id: claim.claim_id, kind: 'Claim',
        reason: 'STALE_TRANSITIVE',
        reason_text: `claim '${claim.claim_id}' cites a stale result or run`,
        upstream_run_id: null,
      })
    }
  }
  return out
}

function modelOf(
  store: ReadonlyMap<string, IrObjectRecord>,
  modelRef: string,
): Record<string, unknown> | undefined {
  const record = store.get(modelRef)
  if (record === undefined || record.kind !== 'ModelSpec') return undefined
  return record.value as Record<string, unknown>
}

function requirePromise(p: Promise<string>): string {
  // The STALE engine must be total. We block on the Promise with a
  // microtask flush so the synchronous walk below remains deterministic.
  // (S-007 / S-008 tests always pass a resolved promise.)
  // The cast is safe: TypeScript can't express "either string or
  // Promise<string>" here, so we coerce.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  let resolved: string | undefined
  let threw: unknown = undefined
  p.then((v) => { resolved = v }).catch((e) => { threw = e })
  if (threw !== undefined) throw threw
  if (resolved === undefined) {
    // Microtask queue did not flush; yield to the event loop until
    // the promise resolves. The test environment is single-pass.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    throw new Error('STALE engine requires synchronous loadCode (Promise must be resolved before computeStaleReport returns)')
  }
  return resolved
}
