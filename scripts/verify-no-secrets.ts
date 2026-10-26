/**
 * Secret hygiene gate (2026-10-27 governance).
 *
 * Scans every git-TRACKED file for credential-shaped literals. Rationale:
 * two real provider keys were once committed under
 * artifacts/upper-bound/2024B-ingest-1/ (run-mh.sh, run-3-to-6.sh) and a
 * third sat in an untracked loop script; the git history was rewritten to
 * purge the first two (2026-10-27). This gate keeps that class of accident
 * from re-entering the repository.
 *
 * Scope: tracked files only. Untracked local state (runs/, .env.*) is
 * deliberately out of scope — git itself is the boundary this gate guards,
 * and real keys legitimately live in local env files.
 *
 * Threshold calibration: the shortest known placeholder runs 24 chars and
 * the longest placeholder-with-dashes 28 chars (sk-user-delegated-caller-guard),
 * so the alnum/dash run threshold sits at 30. Real relay keys observed in
 * this repo are 48+ chars. If a future fixture needs a longer dummy, add its
 * exact value to ALLOWED_VALUES — never weaken a pattern.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: 'openai-style key', regex: /\bsk-[A-Za-z0-9_-]{30,}\b/g },
  { name: 'opencode-style key', regex: /\boc_sk_[A-Za-z0-9_-]{16,}\b/g },
  { name: 'github token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { name: 'gitlab token', regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'aws access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack token', regex: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/g },
]

/** Exact literal values that are known dummies meeting a length threshold. */
const ALLOWED_VALUES: ReadonlySet<string> = new Set([])

/** Tracked paths exempted wholesale (recorded fixtures only — keep minimal). */
const EXEMPT_PATHS: ReadonlySet<string> = new Set([])

const BINARY_EXTENSION =
  /\.(png|jpe?g|gif|bmp|webp|ico|pdf|zip|7z|gz|xz|exe|dll|blob|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|jar|wasm|node|bin|pdb|xlsx?|docx?|pptx?|db|sqlite3?)$/i

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString()
  .split('\0')
  .filter(Boolean)

const failures: string[] = []
let scanned = 0

for (const relative of files) {
  if (EXEMPT_PATHS.has(relative)) continue
  if (BINARY_EXTENSION.test(relative)) continue
  let text: string
  try {
    text = readFileSync(resolve(root, relative), 'utf8')
  } catch {
    continue
  }
  scanned += 1
  const lines = text.split('\n')
  for (const { name, regex } of PATTERNS) {
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(regex)) {
        if (ALLOWED_VALUES.has(match[0])) continue
        failures.push(`${relative}:${index + 1}: ${name} (${match[0].slice(0, 10)}…)`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`verify-no-secrets: FAIL — ${failures.length} credential-shaped literal(s) in tracked files.`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('  Move the value to a gitignored .env.<profile> file or an env var, then re-run.')
  process.exit(1)
}
console.log(`verify-no-secrets: PASS (${scanned} tracked text files scanned, no credential-shaped literals)`)
