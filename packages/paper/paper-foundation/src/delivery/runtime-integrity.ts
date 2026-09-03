/**
 * P1 — runtime_integrity gate v0.1 (real).
 *
 * The runtime-guard half of this gate (profile readiness) is already
 * enforced upstream by `assertRuntimeReady` + `runtimeProfileValid`; the
 * IR half reads REAL captured facts: every committed ExecutionRecord must
 * carry a well-formed runtime fingerprint and code/output digests (capture
 * derives these as sha256 hex; the schema already locks 64 lowercase hex —
 * the gate re-verifies per delivery and defends a synthetic/non-canonical
 * store that could bypass the schema). A store with no ExecutionRecord has
 * no runtime claims to uphold and passes.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery
 */

import type { IrObjectRecord } from '../ir/store.ts'

export interface RuntimeIntegrityFinding {
  readonly executionId: string
  readonly kind: 'malformed_runtime_fingerprint' | 'malformed_digest'
  readonly reason: string
}

const DIGEST = /^(?:sha256:)?[0-9a-f]{64}$/u

/** A null store (no canonical state) has nothing to check. */
export function runtimeIntegrityFindings(
  store: ReadonlyMap<string, IrObjectRecord> | null,
): ReadonlyArray<RuntimeIntegrityFinding> {
  if (store === null) return []
  const findings: RuntimeIntegrityFinding[] = []
  for (const record of store.values()) {
    if (record.kind !== 'ExecutionRecord') continue
    const exec = record.value as {
      execution_id: string
      runtime_fingerprint_hash: string
      code_hash: string
      output_hash: string
    }
    if (!DIGEST.test(exec.runtime_fingerprint_hash)) {
      findings.push({
        executionId: exec.execution_id,
        kind: 'malformed_runtime_fingerprint',
        reason: `runtime_fingerprint_hash '${String(exec.runtime_fingerprint_hash).slice(0, 16)}…' is not a digest`,
      })
    }
    if (!DIGEST.test(exec.code_hash) || !DIGEST.test(exec.output_hash)) {
      findings.push({
        executionId: exec.execution_id,
        kind: 'malformed_digest',
        reason: 'code_hash / output_hash is not a digest',
      })
    }
  }
  return findings
}
