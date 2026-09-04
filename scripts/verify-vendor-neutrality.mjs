#!/usr/bin/env node
/**
 * Vendor-decoupling guard (machine-checkable anti-regression).
 *
 * Policy: the repo must not PRESET any LLM vendor endpoint. A vendor's URL
 * may appear only in these allowlisted places:
 *   - `PUBLIC_BASE_URL` in llm-deepseek/src/index.ts — the one named
 *     constant, exported for compositions that deliberately target the
 *     vendor, never used as a fallback;
 *   - `llm-deepseek/tests/**` — adapter unit tests exercising URL handling
 *     against mock/fake endpoints and recorded fixtures;
 *   - `*.snapshot.yml` / recorded replay corpora — reproducibility data for
 *     the llm-replay path (no network).
 *
 * Everything else — compositions (`cordis.yml`), workflows (`.github/`),
 * runtime source outside the adapter, examples — must carry no hardcoded
 * vendor base URL. CI runs this script; a violation fails the gate.
 *
 * Usage: node scripts/verify-vendor-neutrality.mjs
 * Exit 0 = clean. Exit 1 = a preset vendor endpoint leaked back in.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Endpoint patterns that constitute a vendor preset. */
const VENDOR_ENDPOINT_PATTERNS = [
  /api\.deepseek\.com/,
  /api\.openai\.com/,
  /api\.anthropic\.com/,
  /generativelanguage\.googleapis\.com/,
  /api\.x\.ai/,
  /api\.mistral\.ai/,
]

/** Path prefixes where a vendor URL is allowlisted. Every entry carries the
 *  reason it is NOT a preset route:
 *  - named constants exported for compositions that DELIBERATELY target the
 *    vendor (never used as a fallback anywhere);
 *  - test helpers that GATE a suite to an endpoint the environment names, or
 *    mock-server fixtures (no production routing);
 *  - documentation stating the vendor's documented endpoint as reference
 *    information while the required-endpoint rule is also stated;
 *  - recorded replay/onboarding snapshots (reproducibility data, no network).
 */
const ALLOWLIST_PREFIXES = [
  // llm adapter: the one named constant + its unit tests + build output.
  'packages/llm/llm-deepseek/src/index.ts', // PUBLIC_BASE_URL named constant (deliberate-reference only)
  'packages/llm/llm-deepseek/tests/', // adapter unit tests + fixtures
  'packages/llm/llm-deepseek/lib/', // build output of the above
  'packages/llm/llm-deepseek/README.md', // docs: states required-endpoint rule alongside
  'packages/llm/llm-deepseek/README.zh.md', // docs: same, Chinese
  // web-search provider: named constant + docs + its tests.
  'packages/web/web-search-deepseek/src/provider.ts', // DEEPSEEK_DEFAULT_BASE_URL named constant (deliberate-reference only)
  'packages/web/web-search-deepseek/README.md', // docs: states required-endpoint rule alongside
  'packages/web/web-search-deepseek/README.zh.md', // docs: same, Chinese
  'packages/web/web-search-deepseek/tests/', // provider unit tests + fixtures
  // UI placeholder text + its golden snapshots: the shown placeholder is
  // display copy, not a route; the effective value comes from settings.
  'packages/client/ui-settings-models/src/client/ProviderEditor.tsx', // input placeholder copy
  'packages/client/ui-settings-models/tests/', // placeholder assertions
  'packages/client/ui-settings-plugins/tests/', // same
  'apps/web/tests/snapshots/', // onboarding snapshot: recorded display copy
  // pi-ai: catalog/discovery fixtures assert vendor CATALOG data shape.
  'packages/llm/llm-pi-ai/tests/',
  // host apiproxy unit test: a URL passed INTO discovery as test input.
  'packages/host/apiproxy/tests/',
  // subagent suites that by design exercise a specific vendor integration:
  // the claude-code real e2e pins the OFFICIAL endpoint because the Claude
  // Code CLI itself only speaks it; the codex bridge is a test-only HTTP
  // shim. Both are env-gated, opt-in suites.
  'packages/subagent/subagent-claude-code/tests/',
  'packages/subagent/subagent-codex/tests/',
  // probe scripts read the endpoint from ENV; the literal is the legacy
  // fallback default of the (already-archived) probe records. Kept so the
  // archived artifacts keep matching their scripts.
  'artifacts/handoff/TASK-P2/probe/',
  'artifacts/handoff/TASK-P3/probe-v2/',
]

const SEARCH_SCOPES = [
  'packages', 'apps', 'examples', 'scripts', '.github', 'artifacts',
]

/** A violation record. */
function violation(file, line, match) {
  return { file, line, snippet: String(match).slice(0, 160) }
}

const findings = []
for (const pattern of VENDOR_ENDPOINT_PATTERNS) {
  // -I: case-insensitive is unnecessary (hostnames are lowercase); plain grep
  // semantics via git keep the scan to TRACKED files only — no node_modules.
  const result = spawnSync('git', [
    '-C', repoRoot,
    'grep', '-n', '-E', pattern.source, '--',
    ...SEARCH_SCOPES.map(scope => `${scope}/`),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status > 1) {
    console.error(`verify-vendor-neutrality: git grep failed: ${result.stderr}`)
    process.exit(1)
  }
  for (const raw of result.stdout.split('\n')) {
    if (raw === '') continue
    const colon = raw.indexOf(':')
    const secondColon = raw.indexOf(':', colon + 1)
    const file = raw.slice(0, colon)
    const line = raw.slice(colon + 1, secondColon)
    const text = raw.slice(secondColon + 1)
    const match = pattern.exec(text)
    if (match === null) continue
    if (ALLOWLIST_PREFIXES.some(prefix => file.startsWith(prefix))) continue
    findings.push(violation(file, line, match))
  }
}

if (findings.length > 0) {
  console.error('verify-vendor-neutrality: PRESET VENDOR ENDPOINT(S) FOUND —')
  console.error('the repo must not default any deployment to a single LLM vendor.')
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}: ${finding.snippet}`)
  }
  console.error('')
  console.error('If this is a NEW allowed location (recorded constants/fixtures only),')
  console.error('extend ALLOWLIST_PREFIXES in scripts/verify-vendor-neutrality.mjs with the')
  console.error('reasoning inline. Otherwise route through configuration/environment')
  console.error('(e.g. DSH_E2E_LLM_BASE_URL) instead of a preset URL.')
  process.exit(1)
}

console.log('verify-vendor-neutrality: PASS — no preset vendor endpoints outside the allowlist.')
