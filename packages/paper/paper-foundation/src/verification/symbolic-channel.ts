/**
 * L3 — 符号证据通道。
 *
 * ## 它解决什么
 *
 * 零数字通道是"把算术从模型手里拿走"，它管**数值**结论。但论文里还有一类结论
 * 不产生数值：解析解、极限、恒等式、边界不等式。旧形态里这些只能以**散文**形式
 * 存在，于是它们既进不了证据仓，也得不到与数值结果同等的可信地位——**上限最高
 * 的那类能力（理论分析）没有合规的表达通道**。
 *
 * 本模块给它们一条通道：把解析断言写成**可执行的校验脚本**，跑通即注册为证据，
 * 论文引用它。于是：
 *
 *   - 解析解与数值结果**同等可信**；
 *   - "抽样未见反例"不会被说成"证明了"——因为**证据级别是通道标注的，不是模型自称的**。
 *
 * ## 证据级别（必须如实标注）
 *
 * | 级别 | 含义 | 论文里的措辞 |
 * |---|---|---|
 * | `symbolic_proof` | 代入验证恒等 / 极限 / ODE 解——代数上确证 | 可以说"证明"、"恒成立" |
 * | `sampling_evidence` | 有限点抽样未见反例——**不是证明** | 只能说"抽样未见反例" |
 *
 * 措辞必须与级别匹配。把抽样证据说成"证明"是比数字算错更严重的诚实性问题，
 * 因此 `assertWordingMatchesLevel` 是一个**机械检查**，不是提示。
 *
 * ## 未执行 = 未通过（C3）
 *
 * 校验脚本跑不起来（依赖缺失、语法错、超时）时，结果**不是中性**：它落
 * `unverifiable`，与"断言失败"同级对待。一个从不执行的门禁是可见的漏洞；
 * 一个看起来是绿的未执行门禁是隐形漏洞。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/verification/symbolic-channel
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 证据级别。三档，**都不等于"没有证据"**——没有证据的东西不该进证据仓。
 *
 * | 级别 | 含义 | 论文里可以说 |
 * |---|---|---|
 * | `symbolic_proof` | 代入验证恒等 / 极限 / ODE 解 / 导数符号 —— **代数上确证** | "证明"、"恒成立" |
 * | `sampling_evidence` | 有限点抽样未见反例 —— **不是证明** | "抽样未见反例" |
 * | `structural_check` | **形式一致性**：表达式可解析、符号已声明、lhs/rhs 与自由符号一致、单位非空 | "形式一致"，**不能说"证明"** |
 *
 * 第三档是必需的：harness 能从 `EquationSpec` 直接推出的只有形式性质，
 * 把它说成"证明"是夸大，说成"抽样"是错位。给它一个诚实的名字。
 */
export const EVIDENCE_LEVELS = ['symbolic_proof', 'sampling_evidence', 'structural_check'] as const
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number]

/** 一条注册进证据仓的解析断言。 */
export interface SymbolicClaim {
  /** claim id，论文正文用它引用。 */
  readonly claim_id: string
  /** 断言脚本的相对路径（相对工作区根），如 `claims/q1_closed_form.py`。 */
  readonly script: string
  /** 该脚本覆盖的解析结论（人读的一句话）。 */
  readonly statement: string
  /** 证据级别——**由通道按脚本实际内容标注**，不由模型自称。 */
  readonly level: EvidenceLevel
  /** 执行是否通过。 */
  readonly passed: boolean
  /** 未通过/未执行时的原因（诚实上报，R5）。 */
  readonly detail: string
}

/** 一次通道执行的结果。 */
export interface SymbolicChannelResult {
  readonly claims: ReadonlyArray<SymbolicClaim>
  /** 未跑通的脚本（与"断言失败"同级，C3）。 */
  readonly unverifiable: ReadonlyArray<SymbolicClaim>
}

/**
 * 判定一个断言脚本属于哪一级证据。
 *
 * 判据是**脚本里实际用了什么**，不是模型声明了什么：
 *   - 出现 `checkodesol` / `simplify(...) == 0` / `limit(...)` / `Eq(...)` 恒等比较
 *     → 代数确证 → `symbolic_proof`
 *   - 只出现 `assert all(... for ... in sample/range/linspace)` 形态的抽样断言
 *     → `sampling_evidence`
 *   - 两者都有 → 取**较低**级别（保守：一个脚本里只要有一条抽样断言，
 *     整份证据就不该被当作纯代数确证）
 *
 * @param scriptText - 脚本全文。
 */
export function classifyEvidenceLevel(scriptText: string): EvidenceLevel {
  const hasAlgebraic = /checkodesol|simplify\s*\(|limit\s*\(|\.equals\s*\(|==\s*0\b/.test(scriptText)
  const hasSampling = /for\s+\w+\s+in\s+(range|linspace|sample|np\.|numpy\.)|all\s*\(.*for\s+/.test(scriptText)
  if (hasAlgebraic && !hasSampling) return 'symbolic_proof'
  return 'sampling_evidence'
}

/**
 * 措辞与证据级别是否匹配——**机械检查**，不是提示。
 *
 * 把抽样证据说成"证明"会让论文在评审里失去可信度，而这是**可机械检出**的：
 * `sampling_evidence` 级别的 claim，其引用处的措辞不得含"证明 / 恒成立 / 严格"。
 *
 * @param level - 证据级别。
 * @param wording - 论文里引用该 claim 的那句话。
 * @returns 违规原因；`null` 表示匹配。
 */
export function assertWordingMatchesLevel(level: EvidenceLevel, wording: string): string | null {
  if (level === 'symbolic_proof') return null
  const overclaim = /证明|恒成立|严格成立|已经证得/.exec(wording)
  if (overclaim === null) return null
  const suggested = level === 'sampling_evidence' ? '抽样未见反例' : '形式一致'
  return `证据级别为 ${level}，但措辞用了「${overclaim[0]}」——应改为"${suggested}"`
}

/**
 * 执行一个断言脚本并把它注册为证据。
 *
 * **不静默降级**：脚本缺失、非零退出、超时，全部落 `unverifiable` 并带上真实原因。
 *
 * @param rootDir - 工作区根目录。
 * @param claim - claim id / 脚本相对路径 / 陈述。
 * @param timeoutMs - 单脚本超时，默认 60s（符号计算比数值慢）。
 */
export function registerSymbolicClaim(
  rootDir: string,
  claim: { readonly claim_id: string; readonly script: string; readonly statement: string },
  timeoutMs = 60_000,
): SymbolicClaim {
  const scriptPath = isAbsolute(claim.script) ? claim.script : join(rootDir, claim.script)
  if (!existsSync(scriptPath)) {
    return {
      claim_id: claim.claim_id,
      script: claim.script,
      statement: claim.statement,
      level: 'sampling_evidence',
      passed: false,
      detail: `断言脚本不存在：${claim.script}——未执行按未通过处理（C3）`,
    }
  }
  let source: string
  try {
    source = readFileSync(scriptPath, 'utf8')
  } catch (error) {
    return {
      claim_id: claim.claim_id,
      script: claim.script,
      statement: claim.statement,
      level: 'sampling_evidence',
      passed: false,
      detail: `断言脚本不可读：${(error as Error).message}`,
    }
  }
  const level = classifyEvidenceLevel(source)
  const run = spawnSync(process.env.PYTHON ?? 'python', [scriptPath], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  if (run.error !== undefined && run.error !== null) {
    return {
      claim_id: claim.claim_id,
      script: claim.script,
      statement: claim.statement,
      level,
      passed: false,
      detail: `断言脚本未能执行：${run.error.message}——未执行按未通过处理（C3）`,
    }
  }
  if (run.status !== 0) {
    const stderr = String(run.stderr ?? '').trim()
    const stdout = String(run.stdout ?? '').trim()
    return {
      claim_id: claim.claim_id,
      script: claim.script,
      statement: claim.statement,
      level,
      passed: false,
      detail: `断言失败（退出 ${String(run.status)}）：${(stderr.length > 0 ? stderr : stdout).slice(0, 300)}`,
    }
  }
  return {
    claim_id: claim.claim_id,
    script: claim.script,
    statement: claim.statement,
    level,
    passed: true,
    detail: level === 'symbolic_proof' ? '代数确证：断言通过' : '有限点抽样未见反例（**不是证明**）',
  }
}

/**
 * 批量执行一组断言脚本。
 *
 * @param rootDir - 工作区根目录。
 * @param claims - 待注册的 claim 列表。
 * @param timeoutMs - 单脚本超时。
 */
export function runSymbolicChannel(
  rootDir: string,
  claims: ReadonlyArray<{ readonly claim_id: string; readonly script: string; readonly statement: string }>,
  timeoutMs = 60_000,
): SymbolicChannelResult {
  const results = claims.map(c => registerSymbolicClaim(rootDir, c, timeoutMs))
  return {
    claims: results,
    unverifiable: results.filter(r => !r.passed),
  }
}

/**
 * 渲染证据仓的符号通道段落——进交付物附录，让读者看到每条解析结论的证据级别。
 *
 * @param claims - 已注册的 claim。
 */
export function renderSymbolicEvidence(claims: ReadonlyArray<SymbolicClaim>): string {
  if (claims.length === 0) return ''
  const lines: string[] = []
  lines.push('')
  lines.push('## 附录：符号证据登记')
  lines.push('')
  lines.push('| claim | 结论 | 证据级别 | 状态 | 说明 |')
  lines.push('|---|---|---|---|---|')
  for (const c of claims) {
    const level = c.level === 'symbolic_proof' ? '代数确证' : (c.level === 'sampling_evidence' ? '抽样证据' : '形式一致')
    lines.push(`| ${c.claim_id} | ${c.statement.replace(/\|/g, '\\|')} | ${level} | ${c.passed ? '✅ 通过' : '❌ 未通过'} | ${c.detail.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')
  lines.push('*「代数确证」= 代入验证恒等/极限/ODE 解；「抽样证据」= 有限点抽样未见反例；「形式一致」= 表达式可解析且符号已声明。后两者都不等同于证明，措辞与级别不符会被机械检出。*')
  return lines.join('\n')
}


/**
 * L3 — **harness 侧驱动**的符号检查：从 `EquationSpec` 直接推出形式性质。
 *
 * ## 为什么不让模型手写脚本
 *
 * 容器是 JSON；把一段 Python 源码塞进 JSON 字符串要过两层转义，模型很容易写坏。
 * 而"表达式能不能解析、用到的符号有没有声明、lhs/rhs 与自由符号是否一致"这三件事
 * **完全可以从 `EquationSpec` 推出来**。因此本函数把声明喂给
 * `scripts/sympy-equation-consistency.py`，由它做代数检查——模型一行代码都不用写。
 *
 * ## 它检查的是形式，不是数学
 *
 * 产出的证据级别是 `structural_check`。**方程对不对、假设合不合理，它判不了。**
 * 把这个边界说清楚比多报几条"通过"重要得多。
 *
 * @param rootDir - 工作区根（脚本以它为 cwd 运行）。
 * @param symbols - 已声明的符号（id + token）。
 * @param equations - 已声明的方程（表达式 + lhs/rhs + 单位）。
 * @returns 每条方程的 claim；`sympy` 不可用时全部落 `unverifiable`（C3）。
 */
export function runEquationConsistency(
  rootDir: string,
  symbols: ReadonlyArray<{ readonly id: string; readonly token: string; readonly unit?: string }>,
  equations: ReadonlyArray<{
    readonly id: string
    readonly expression: string
    readonly lhs_symbols?: ReadonlyArray<string>
    readonly rhs_symbols?: ReadonlyArray<string>
    readonly unit?: string
  }>,
): SymbolicChannelResult {
  if (equations.length === 0) return { claims: [], unverifiable: [] }
  const payload = JSON.stringify({
    symbols: symbols.map(s => ({ id: s.id, token: s.token, unit: s.unit ?? '' })),
    equations: equations.map(e => ({
      id: e.id,
      expression: e.expression,
      lhs_symbols: [...(e.lhs_symbols ?? [])],
      rhs_symbols: [...(e.rhs_symbols ?? [])],
      unit: e.unit ?? '',
    })),
  })
  const run = spawnSync(process.env.PYTHON ?? 'python', [EQUATION_SCRIPT], {
    cwd: rootDir,
    input: payload,
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (run.status !== 0 || run.stdout === null || run.stdout.trim().length === 0) {
    const reason = `符号一致性检查未跑通（退出 ${String(run.status)}）：${String(run.stderr ?? '').slice(0, 200)}——未执行按未通过处理（C3）`
    return {
      claims: equations.map(e => ({
        claim_id: `SYM-${e.id}`, script: EQUATION_SCRIPT, statement: `方程 ${e.id} 的形式一致性`,
        level: 'structural_check' as const, passed: false, detail: reason,
      })),
      unverifiable: [],
    }
  }
  try {
    const parsed = JSON.parse(run.stdout) as {
      available: boolean
      reason?: string
      claims: ReadonlyArray<{ claim_id: string; statement: string; level: EvidenceLevel; passed: boolean; detail: string }>
    }
    if (!parsed.available) {
      const reason = `${parsed.reason ?? 'sympy 不可用'}——未执行按未通过处理（C3）`
      return {
        claims: equations.map(e => ({
          claim_id: `SYM-${e.id}`, script: EQUATION_SCRIPT, statement: `方程 ${e.id} 的形式一致性`,
          level: 'structural_check' as const, passed: false, detail: reason,
        })),
        unverifiable: [],
      }
    }
    const claims: SymbolicClaim[] = parsed.claims.map(c => ({
      claim_id: c.claim_id,
      script: EQUATION_SCRIPT,
      statement: c.statement,
      level: c.level,
      passed: c.passed,
      detail: c.detail,
    }))
    return { claims, unverifiable: claims.filter(c => !c.passed) }
  } catch (error) {
    return {
      claims: [],
      unverifiable: [{
        claim_id: 'SYM-parse', script: EQUATION_SCRIPT, statement: '符号一致性检查输出解析',
        level: 'structural_check', passed: false,
        detail: `输出非 JSON：${(error as Error).message}`,
      }],
    }
  }
}

/** `scripts/sympy-equation-consistency.py` 的仓库根锚点（与 V7 脚本同一约定）。 */
export const EQUATION_SCRIPT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..', '..', '..', 'scripts', 'sympy-equation-consistency.py')
})()
