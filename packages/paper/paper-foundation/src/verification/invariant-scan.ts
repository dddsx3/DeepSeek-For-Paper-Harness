/**
 * DECLARED-INVARIANT SCAN — random-scan verification of model-declared
 * invariants (Lean 评估中间路径 a/d, docs/LEAN-ASSESSMENT.md §6).
 *
 * 直击 2024B 真实缺陷形态：F-002（单位/口径错误 —— 公式点值看着对，漏了一个
 * 概率因子）与 F-003（守恒/边界错误）。模型在声明里给出变量域与不变量
 * （等式/不等式/残差式），helper 在声明域上均匀采样逐点核对，违约率 > 0 即
 * 不变量不成立。固定种子 —— 同一输入同一判定，可复算。
 *
 * Shell-side helper invocation — the same pattern as v7-sympy.ts. Runs
 * `scripts/invariant-scan.py` with a JSON payload and maps its findings
 * into the verification finding shape. Pure function of the declared
 * variables/invariants, so it is unit-tested against the real script.
 */

import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** Repo root: packages/paper/paper-foundation/src/verification -> 5 levels up. */
const REPO_ROOT = join(here, '..', '..', '..', '..', '..')
/** scripts/ at the repo root (same anchor as v7-sympy.ts's V7_SCRIPT). */
export const INVARIANT_SCAN_SCRIPT = join(REPO_ROOT, 'scripts', 'invariant-scan.py')

/** 一个声明变量：均匀采样域 [low, high]；unit 可选（只进 detail，扫描本身量纲盲）。 */
export interface InvariantScanVariable {
  readonly name: string
  readonly low: number
  readonly high: number
  readonly unit?: string
}

/** 一条声明不变量：expr 应为关系式（==/!=/</<=/>/>=）或期望为 0 的残差表达式。 */
export interface DeclaredInvariant {
  readonly id: string
  readonly expr: string
  readonly vars?: ReadonlyArray<string>
  readonly description?: string
}

export interface InvariantScanInput {
  readonly variables?: ReadonlyArray<InvariantScanVariable>
  readonly invariants?: ReadonlyArray<DeclaredInvariant>
  /** 每条不变量的采样点数；缺省 20000，脚本侧上限 200000（超出截断并记 INV-003）。 */
  readonly samples?: number
  /** 采样种子，缺省 0 —— 固定种子保证同一输入同一判定（可复算纪律）。 */
  readonly seed?: number
}

export interface InvariantScanFinding {
  readonly rule: string
  readonly ok: boolean
  readonly detail: string
}

/** Run the invariant-scan helper and return its findings. */
export function runInvariantScan(input: InvariantScanInput): ReadonlyArray<InvariantScanFinding> {
  const payload = JSON.stringify(input)
  const result = spawnSync(process.env.PYTHON ?? 'python', [INVARIANT_SCAN_SCRIPT], {
    input: payload,
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (result.status !== 0) {
    // 进程层失败（python 缺失 / 脚本崩 / 超时）—— 如实降级为一条 EXEC finding，不抛。
    // stderr（脚本崩溃的 traceback）与 error（进程根本没起来，如 ENOENT）两类痕迹
    // 都可能为空，拼在一起取非空侧；状态码本身就是最后一道信息。
    const reason = `${String(result.stderr ?? '')}${String(result.error ?? '')}`.trim()
    return [{
      rule: 'INV-EXEC',
      ok: false,
      detail: `不变量扫描进程退出 ${String(result.status)}: ${reason.slice(0, 200)}`,
    }]
  }
  try {
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<InvariantScanFinding> }
    return parsed.findings
  } catch {
    return [{ rule: 'INV-PARSE', ok: false, detail: `不变量扫描输出非 JSON: ${result.stdout.slice(0, 120)}` }]
  }
}
