/**
 * W11.5 A5 — offline attempt diagnosis for one real run.
 *
 * Reads the shell's own audit trail + persisted receive bodies and writes a
 * compact attempt-by-attempt archive (real-run-N.attempts.json): which of the
 * 3 attempts failed, with which refusal code, and (for E2 attempts) the
 * fidelity verdicts. Follows the executor's REAL order — fidelity before
 * admission (run-5's lesson: a diagnose script that replays stages out of
 * order can "pass" a run the real executor refused).
 *
 * Usage: npx tsx diagnose-attempts.mts <persistDir> <runId> <outPath>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [persistDir, runId, outPath] = process.argv.slice(2)
if (persistDir === undefined || runId === undefined || outPath === undefined) {
  console.error('usage: diagnose-attempts.mts <persistDir> <runId> <outPath>')
  process.exit(2)
}

const audit = JSON.parse(readFileSync(join(persistDir, 'paper_audit.json'), 'utf-8'))
const entries: Array<{ seq: number; ts: string; eventType: string; detail: Record<string, unknown> }> = Object.values(audit.tables.entries)
  .filter((e: { runId?: string | null }) => e.runId === runId)
  .sort((a: { seq: number }, b: { seq: number }) => a.seq - b.seq)

const bodyPath = join(persistDir, 'paper_artifact_body.json')
let bodies: Record<string, { text: string }> = {}
try {
  bodies = JSON.parse(readFileSync(bodyPath, 'utf-8')).tables.bodies ?? {}
} catch { /* runs without persisted bodies keep their audit-only archive */ }

const attempts: unknown[] = []
let current: { attempt: number; refusals: unknown[]; fidelity: unknown[]; e2_chars?: number } | null = null
let attemptNo = 0

for (const e of entries) {
  const d = e.detail as Record<string, unknown>
  if (e.eventType === 'ir_entry_written' && d.kind === 'E2Normalization') {
    attemptNo += 1
    current = { attempt: attemptNo, refusals: [], fidelity: [], e2_chars: d.chars as number | undefined }
    attempts.push(current)
    continue
  }
  if (current === null) continue
  if (e.eventType === 'ir_entry_written' && d.kind === 'FidelityFinding') {
    current.fidelity.push({ id: d.id, ok: d.ok, detail: String(d.detail ?? '').slice(0, 300) })
  }
  if (e.eventType === 'container_refused' || e.eventType === 'provider_retry') {
    current.refusals.push({ code: d.code, attempt: d.attempt, reason: String(d.reason ?? '').slice(0, 300) })
  }
  if (e.eventType === 'e1_direct_delivery') {
    attempts.push({ terminal: 'e1_direct_delivery', failedRules: d.failedRules, reason: d.reason, e1_chars: d.e1_chars, assumptions: d.assumptions })
  }
  if (e.eventType === 'gate_failed') {
    attempts.push({ terminal: 'gate_failed', reason: String(d.reason ?? '').slice(0, 300) })
  }
}

// Attempt bodies for post-hoc inspection (truncate; the full text stays in the
// shell persist dir, the archive only needs enough to re-diagnose).
const attemptBodies: Record<string, string> = {}
for (const [key, art] of Object.entries(bodies)) {
  if (key.includes(runId) && key.includes('E2Normalization-attempt')) {
    attemptBodies[key.split(':E2Normalization-')[1] ?? key] = art.text.slice(0, 4000)
  }
}

const archive = { runId, generatedAt: new Date().toISOString(), attempts, attemptBodies }
writeFileSync(outPath, JSON.stringify(archive, null, 2), 'utf-8')
console.log(`archived ${attempts.length} records -> ${outPath}`)
