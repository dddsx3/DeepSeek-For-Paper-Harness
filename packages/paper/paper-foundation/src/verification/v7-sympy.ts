/**
 * V7 package: sympy-based dimensional/domain/residual check (W7).
 *
 * Shell-side helper invocation — the same pattern as the bundle's data
 * profiler. Runs `scripts/sympy-v7-check.py` with a JSON payload and
 * maps its findings into the verification finding shape. The check is a
 * pure function of the model's declared symbols/equations/results, so it
 * can be unit-tested via the script's own tests.
 *
 * 接链（形态 6 镜像修复）：判定侧（runV7Check）曾长期没有任何调用方。
 * 本模块现在同时提供调用侧的三个纯 seam——`v7InputFromStore`（IR 行 →
 * V7Input）、`v7ObservationsOf`（findings → 观察级标注）与组合入口
 * `v7AdvisoryFindings`——使 executor 的接入点只剩守卫 + try/catch。
 * 接入语义是**观察级**（P2 原则 / GATE-FP 纪律）：发现进 fail-soft 交付
 * 标注流（归宿 = 已知缺陷表），绝不新增硬拒绝路径。
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

/**
 * 调用侧（接链）的输入行：只依赖 `{ kind, value }` 这个最小结构，不 import
 * IR store 的类型。这样本模块与 ir/ 保持解耦（v-structure.ts 的先例是
 * type-only import；这里连类型都不需要——映射只认字段，不认 schema），
 * 单测里也无需构造完整的 IrObjectRecord 信封。
 */
export interface V7StoreRow {
  readonly kind: string
  readonly value: Record<string, unknown>
}

/**
 * 纯映射：IR 行快照 → V7Input。**这是接链的判定侧与调用侧之间缺的那半环**
 * （形态 6：`runV7Check` 写好了却从未被调用，因为没人做这个映射）。
 *
 * 映射口径（只映射存在且非空的字段，缺什么跳什么——声明永远比检查器宽）：
 *   - `SymbolSpec` → `{ id: symbol_id, unit, domain }`（unit/domain 非空才带上；
 *     domain 直接透传封闭枚举，脚本身只认 PROBABILITY / NONNEGATIVE_*，其余忽略）；
 *   - `EquationSpec` → `{ id: equation_id, expression, unit }`；
 *   - `Result` → `{ id: result_id, value, unit }`（value 必须真的是 number 才带上）；
 *   - `residuals` 无 IR 来源（Result 只有 value/uncertainty），**刻意不造**——
 *     脚本对缺 residuals 的响应是 RES-001 ok「未传入残差序列(跳过)」。
 *
 * @returns 组装好的 V7Input；`null` 表示"声明里没有任何 v7 能锚定的东西"。
 *   触发口径是 **符号表或结果至少一个非空**：脚本的每条检查（DIM/DOM/RES）
 *   都以符号或结果为锚，只有方程时 DIM-001 需要的符号单位匹配天然为空、
 *   整次检查空转——返回 null 让调用侧省掉一次 python spawn，而不是跑一场
 *   注定全绿的戏。
 */
export function v7InputFromStore(records: ReadonlyArray<V7StoreRow>): V7Input | null {
  const symbols: Array<{ id: string; unit?: string; domain?: string }> = []
  const equations: Array<{ id: string; expression?: string; unit?: string }> = []
  const results: Array<{ id: string; value?: number; unit?: string }> = []
  for (const record of records) {
    const v = record.value
    // 无 id 的行无从对账（finding 的 detail 要点名对象），直接跳过。
    if (record.kind === 'SymbolSpec') {
      const id = typeof v['symbol_id'] === 'string' ? v['symbol_id'] : ''
      if (id === '') continue
      const symbol: { id: string; unit?: string; domain?: string } = { id }
      if (typeof v['unit'] === 'string' && v['unit'] !== '') symbol.unit = v['unit']
      if (typeof v['domain'] === 'string' && v['domain'] !== '') symbol.domain = v['domain']
      symbols.push(symbol)
    } else if (record.kind === 'EquationSpec') {
      const id = typeof v['equation_id'] === 'string' ? v['equation_id'] : ''
      if (id === '') continue
      const equation: { id: string; expression?: string; unit?: string } = { id }
      if (typeof v['expression'] === 'string' && v['expression'] !== '') equation.expression = v['expression']
      if (typeof v['unit'] === 'string' && v['unit'] !== '') equation.unit = v['unit']
      equations.push(equation)
    } else if (record.kind === 'Result') {
      const id = typeof v['result_id'] === 'string' ? v['result_id'] : ''
      if (id === '') continue
      const result: { id: string; value?: number; unit?: string } = { id }
      if (typeof v['value'] === 'number') result.value = v['value']
      if (typeof v['unit'] === 'string' && v['unit'] !== '') result.unit = v['unit']
      results.push(result)
    }
  }
  if (symbols.length === 0 && results.length === 0) return null
  return { symbols, equations, results }
}

/**
 * 一条进入 fail-soft 交付标注流的观察级条目。字段与 `gradeDelivery` 的
 * 输入（`{ kind, reason }`）对齐，executor 不需要任何二次加工。
 */
export interface V7Observation {
  readonly kind: string
  readonly reason: string
}

/**
 * 观察级标注前缀。它同时出现在 kind 与 reason 里，理由不同：
 *   - kind 前缀 `V7_` 让条目在已知缺陷表/交付附录里成组可辨（且与 V1–V4 的
 *     rule 命名家族相邻，executor 的 location 映射会把它归到 verification）；
 *   - reason 前缀「观察级」是对读者的显式声明：这条**不阻断交付**，它的归宿是
 *     修复或在已知缺陷表里显式接受，不是拒绝——GATE-FP 纪律要求级别如实。
 */
export const V7_OBSERVATION_KIND_PREFIX = 'V7_'
export const V7_OBSERVATION_REASON_PREFIX = '观察级（sympy 符号通道，不阻断交付）：'

/**
 * findings → 观察级标注。**只保留未通过项**（ok 项是"检查跑了且无发现"的
 * 回执，不是缺陷，进标注流是噪声）；`V7-EXEC` / `V7-PARSE`（python/sympy
 * 缺席、输出损坏）同样是 ok:false，因此与真发现同路——**未执行按未通过的
 * 观察处理（C3），链路绝不因符号计算环境缺席而特殊化**。
 */
export function v7ObservationsOf(findings: ReadonlyArray<V7Finding>): ReadonlyArray<V7Observation> {
  return findings
    .filter(f => !f.ok)
    .map(f => ({
      kind: f.rule.startsWith('V7-')
        ? `${V7_OBSERVATION_KIND_PREFIX}${f.rule.slice(3)}`
        : `${V7_OBSERVATION_KIND_PREFIX}${f.rule}`,
      reason: `${V7_OBSERVATION_REASON_PREFIX}${f.detail}`,
    }))
}

/**
 * executor 的**唯一**调用入口：store 行快照 → 观察级标注（可能触发一次
 * python spawn）。它把"映射 → 运行 → 过滤 → 标注"四步收进一个纯 seam，
 * 调用侧（executor.ts）只剩守卫 + try/catch 三行。空输入（null）不 spawn。
 *
 * 本函数**不吞异常**——调用侧必须自己 try/catch（观察级语义是调用侧的纪律：
 * 任何异常都降级为一条观察，绝不向上抛）。
 */
export function v7AdvisoryFindings(records: ReadonlyArray<V7StoreRow>): ReadonlyArray<V7Observation> {
  const input = v7InputFromStore(records)
  return input === null ? [] : v7ObservationsOf(runV7Check(input))
}
