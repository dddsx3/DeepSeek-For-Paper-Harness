/**
 * V7 package: sympy-based dimensional/domain/residual check (W7).
 *
 * Shell-side helper invocation — the same pattern as the bundle's data
 * profiler. Runs `scripts/sympy-v7-check.py` with a JSON payload and
 * maps its findings into the verification finding shape. The check is a
 * pure function of the model's declared symbols/equations/results, so it
 * can be unit-tested via the script's own tests.
 */

import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** Repo root: packages/paper/paper-foundation/src/verification -> 5 levels up. */
const REPO_ROOT = join(here, '..', '..', '..', '..', '..')
/** scripts/ at the repo root (same anchor as bundle.ts's PROFILE_SCRIPT). */
export const V7_SCRIPT = join(REPO_ROOT, 'scripts', 'sympy-v7-check.py')

export interface V7Finding {
  readonly rule: string
  readonly ok: boolean
  readonly detail: string
}

export interface V7Input {
  readonly symbols?: ReadonlyArray<{ id: string; unit?: string; domain?: string }>
  readonly equations?: ReadonlyArray<{ id: string; expression?: string; unit?: string }>
  readonly results?: ReadonlyArray<{ id: string; value?: number; unit?: string }>
  readonly residuals?: ReadonlyArray<number>
}

/** Run the sympy helper and return its findings. */
export function runV7Check(input: V7Input): ReadonlyArray<V7Finding> {
  const payload = JSON.stringify(input)
  const result = spawnSync(process.env.PYTHON ?? 'python', [V7_SCRIPT], {
    input: payload,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) {
    return [{
      rule: 'V7-EXEC',
      ok: false,
      detail: `sympy 检查进程退出 ${result.status}: ${String(result.stderr ?? '').slice(0, 200)}`,
    }]
  }
  try {
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<V7Finding> }
    return parsed.findings
  } catch {
    return [{ rule: 'V7-PARSE', ok: false, detail: `sympy 输出非 JSON: ${result.stdout.slice(0, 120)}` }]
  }
}
