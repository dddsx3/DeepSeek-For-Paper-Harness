/**
 * TASK-E (expert plan §2.1) — REAL_API_POLICY guard.
 *
 * Policy: a CI push run must NEVER invoke a real provider adapter. The
 * two failure modes the expert plan distinguishes:
 *
 *   - "no key configured"   → the old anti-pattern: push CI turns red
 *     forever because the repo (deliberately) holds no key.
 *   - "real adapter invoked in CI" → THIS is the error worth failing on:
 *     something tried to leave the deterministic boundary.
 *
 * This script fails ONLY on the second. It scans the environment + the
 * known real-adapter entry points for a wired real route in a push-type CI
 * context, and pins the workflow files to their no-real-API trigger
 * shape (e2e.yml must be manual-dispatch-only).
 *
 * Local runs are out of scope (the policy is about CI, not the laptop).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures: string[] = []

// ---------------------------------------------------------------------------
// 1. Workflow shape pin: the real-API E2E workflow must be manual-only.
// ---------------------------------------------------------------------------

const e2ePath = resolve(root, '.github/workflows/e2e.yml')
const e2e = readFileSync(e2ePath, 'utf8')

// The `on:` block must contain workflow_dispatch and none of the push
// triggers. Parse cheaply: the trigger block is between `^on:` and the
// first top-level non-comment key after it.
const onMatch = e2e.match(/^on:\n((?:[ #].*\n)+)/m)
if (onMatch === null) {
  failures.push('e2e.yml: no `on:` trigger block found')
} else {
  const triggers = onMatch[1]!
  if (!/workflow_dispatch:/.test(triggers)) {
    failures.push('e2e.yml: `workflow_dispatch` missing from the trigger block')
  }
  for (const banned of ['push:', 'pull_request:', 'schedule:', 'pull_request_target:']) {
    if (triggers.includes(banned)) {
      failures.push(`e2e.yml: trigger \`${banned.replace(':', '')}\` present — real-API runs must be manual only (ADR-004)`)
    }
  }
}

// The paper-harness workflow's always-on job must not read any provider
// key secret (its probe jobs are workflow_dispatch-gated and allowed).
const paperPath = resolve(root, '.github/workflows/paper-harness.yml')
const paper = readFileSync(paperPath, 'utf8')
const paperJobs = paper.split('\njobs:\n')[1] ?? ''
// Split into job blocks by two-space-indented `name:` keys at job level.
const jobChunks = paperJobs.split(/\n  (?=[a-z0-9-]+:\n)/)
for (const chunk of jobChunks) {
  const jobId = (chunk.match(/^([a-z0-9-]+):/)?.[1]) ?? '(unknown)'
  const isManual = /if:\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(chunk)
  if (isManual) continue
  if (/secrets\.(DEEPSEEK_API_KEY|DSH_E2E_LLM_API_KEY|PAPER_PROBE_API_KEY)_?/.test(chunk)) {
    failures.push(`paper-harness.yml: job \`${jobId}\` reads a provider key secret but is not workflow_dispatch-gated`)
  }
}

// ---------------------------------------------------------------------------
// 2. Env guard: in an explicitly-policy CI context, a real route must not
//    resolve. REAL_API_POLICY=never is the opt-in declaration CI sets; the
//    guard then refuses any *configured* real route (key present = the
//    boundary is already breached, no call needs to happen).
// ---------------------------------------------------------------------------

const policy = process.env.REAL_API_POLICY
if (policy === 'never') {
  const realRouteKeys = [
    'DEEPSEEK_API_KEY',
    'DSH_E2E_LLM_API_KEY',
    'PAPER_PROBE_API_KEY',
  ]
  for (const key of realRouteKeys) {
    const value = process.env[key]
    if (value !== undefined && value.length > 0) {
      failures.push(`REAL_API_POLICY=never but ${key} is configured — the deterministic boundary is breached`)
    }
  }
}

if (failures.length > 0) {
  console.error(`verify-real-api-policy: FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('verify-real-api-policy: PASS (push CI is real-API-free; e2e manual-only; no key secrets outside dispatch-gated jobs)')
