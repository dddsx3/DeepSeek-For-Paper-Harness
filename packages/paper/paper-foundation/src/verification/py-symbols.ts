/**
 * PY-SYMBOLS — Python AST 符号表（`claim_code_check` 的符号级判据）。
 *
 * 门禁原来只在源码文本里搜 `METHOD_CLAIMS_MACHINE` 的 must 签名。2024B 实跑里
 * 建模阶段声明 `beta_posterior` / `clopper_pearson_interval`，代码却实现成
 * `_beta_params` / `_posterior` —— 文本判据永远找不到，连续多轮硬失败。根因是
 * 判据层次：用"字符串是否出现"代理"方法是否实现"，两者只在模型恰好同名时重合。
 *
 * 本模块调用 `scripts/py-symbols.py` 用标准库 `ast` 建符号表（所有 def/class，
 * 含私有、方法与嵌套），返回 `{ok, defs, classes, errors}`。`ok: false` 表示
 * 通道本身没跑成（python 缺失 / 脚本崩 / 输出非 JSON）；门禁据此退回纯文本判定，
 * 绝不因符号表不可用而崩。
 *
 * Shell-side helper invocation — the same pattern as invariant-scan.ts / v7-sympy.ts.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** Repo root: packages/paper/paper-foundation/src/verification -> 5 levels up. */
const REPO_ROOT = join(here, '..', '..', '..', '..', '..')
/** scripts/ at the repo root (same anchor as invariant-scan.ts's script). */
export const PY_SYMBOLS_SCRIPT = join(REPO_ROOT, 'scripts', 'py-symbols.py')

/** 一个 Python 函数/方法定义（`async def` 同样收录）。 */
export interface PySymbolDef {
  /** 定义名（不含类名）。 */
  readonly name: string
  /** 源文件相对名（输入键原样返回）。 */
  readonly file: string
  /** 限定名：`Class.method`、`outer.<locals>.inner`。 */
  readonly qualname: string
  /** 函数体（去掉 docstring）覆盖的物理行数，含语句之间的空行与注释行。 */
  readonly body_lines: number
  /** 同一行范围里非空且非整行注释的行数。 */
  readonly non_doc_lines: number
  /**
   * **AST 级空壳判定**：函数体（去 docstring）只由 `pass` / `...` /
   * `raise NotImplementedError(...)` 组成。不用行数阈值——实测一行真实实现
   * （列表推导 return）会被"≥2 行"判据误杀。
   */
  readonly stub: boolean
  /** `ast.get_docstring()` 的结果；无 docstring 为 null。 */
  readonly docstring: string | null
}

/** 一个 Python 类定义。 */
export interface PySymbolClass {
  readonly name: string
  readonly file: string
}

/** 单个文件解析失败（SyntaxError 等），不影响其它文件的符号。 */
export interface PySymbolsError {
  readonly file: string
  readonly error: string
}

/** `runPySymbols` 的结果；`ok: false` 表示通道没跑成（门禁据此退回纯文本判定）。 */
export interface PySymbols {
  readonly ok: boolean
  readonly defs: ReadonlyArray<PySymbolDef>
  readonly classes: ReadonlyArray<PySymbolClass>
  readonly errors: ReadonlyArray<PySymbolsError>
}

const EMPTY: PySymbols = { ok: false, defs: [], classes: [], errors: [] }

/**
 * 对给定源码建符号表。
 *
 * 进程层失败（python 缺失 / 脚本崩 / 超时）与输出非 JSON 都映射成
 * `{ok: false, errors: [...]}` 返回，**不抛**——门禁的职责是判定产物，
 * 不是把环境故障升级成崩溃。单个文件解析失败由脚本记进 `errors`，此时
 * `ok` 仍为 true（其余文件的符号可用）。
 *
 * @param files - `[相对文件名, 源码]` 列表（通常是本阶段的 `code/*.py`）。
 * @returns 符号表；通道不可用时 `ok: false` 且 `errors` 说明原因。
 */
export function runPySymbols(files: ReadonlyArray<readonly [string, string]>): PySymbols {
  const payload = JSON.stringify({ files: Object.fromEntries(files) })
  const result = spawnSync(process.env.PYTHON ?? 'python', [PY_SYMBOLS_SCRIPT], {
    input: payload,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) {
    // stderr（脚本 traceback）与 error（进程根本没起来，如 ENOENT）两类痕迹都可能
    // 为空，拼在一起取非空侧；状态码本身就是最后一道信息。
    const reason = `${String(result.stderr ?? '')}${String(result.error ?? '')}`.trim()
    return {
      ...EMPTY,
      errors: [{ file: '<exec>', error: `符号表进程退出 ${String(result.status)}: ${reason.slice(0, 200)}` }],
    }
  }
  try {
    const parsed = JSON.parse(result.stdout) as PySymbols
    return {
      ok: parsed.ok === true,
      defs: Array.isArray(parsed.defs) ? parsed.defs : [],
      classes: Array.isArray(parsed.classes) ? parsed.classes : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
    }
  } catch {
    return {
      ...EMPTY,
      errors: [{ file: '<parse>', error: `符号表输出非 JSON: ${String(result.stdout).slice(0, 120)}` }],
    }
  }
}
