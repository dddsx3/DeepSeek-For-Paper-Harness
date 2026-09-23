/**
 * L6-c — 闭环协议（分派 → 修复 → 复验 → 消解）。
 *
 * ## 两侧各缺一半
 *
 * - 一边的现有形态是**硬阻断**：findings 一律 BLOCKED，代价是零产物。它把
 *   "findings 有归宿"实现了，但归宿是"整条产线不出东西"——那不是闭环，
 *   是**用更严重的失败掩盖原失败**。
 * - 另一边的现有形态是**无消费方**：检测到了，定位到 `文件:行号`，给出具体修法，
 *   然后没有任何机制消费这份 verdict。修复循环的评审对象是**稿件文风**，
 *   它的运行日志里完全没有提到那些 major。
 *
 * 本模块是**两侧都没有的那一层**：带预算、带 fingerprint 复验、带 ESCALATE 语义、
 * 且已知缺陷对用户可见。
 *
 * ## 状态机
 *
 * ```
 *   open ──①分派──► [修复者] ──②复验(重跑同一 checker，比对 fingerprint)──►
 *                                                                    │
 *                     fingerprint 变了 ──────────────────────────► fixed
 *                     fingerprint 没变 ───────────────────────────► 回 ② 或进 ④
 *                     checker 跑不起来 ───────────────────────────► unverifiable
 *                     预算耗尽 ──────────────────────────────────► ESCALATE（不是 CLEAN）
 * ```
 *
 * ④ 消解：**显式接受是一等公民**。修不掉的东西写进交付物附录的"已知缺陷表"，
 * 而不是消失。
 *
 * ## 三条不可协商的约束
 *
 * - **C1** 交付前必须复验 fingerprint，不接受"我改过了"。
 * - **C2** 闭环预算耗尽的语义是 `ESCALATE`，**绝不是** `CLEAN`。
 * - **C3** checker 跑不起来（未执行）与未通过**同级**，不是中性状态。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/closure
 */

import {
  TERMINAL_FINDING_STATES,
  dispatchOf,
  type Finding,
  type FindingState,
  type RecheckOutcome,
} from './finding.ts'

/**
 * 闭环内部持有的**可变**视图。
 *
 * `Finding` 对外是只读契约（读者不该改它），但闭环层必须推进状态。把可变性
 * 限制在这个内部类型里，契约的只读性就不会被"顺手改一下"侵蚀。
 */
interface MutableFinding {
  id: string
  category: string
  severity: Finding['severity']
  checker: string
  where: Finding['where']
  evidence: string
  fingerprint: string
  fixHint: string
  state: FindingState
  attempts: number
}

/**
 * C1 —— 复验必须比对 fingerprint，不接受"我改过了"。
 *
 * 实测依据：一份真实运行的修复清单**逐条真实落地**（独立抽验 5/5），但最后一轮
 * 之后没有任何独立复评；另一份的"改进轮"是**空操作**（round0 与 round1 字节完全相同，
 * md5 一致，diff 0 行），却仍产出了一份格式正确、门禁全绿的交付物。
 * **两种形态都会在 fingerprint 复验下暴露。**
 */
export const C1_FINGERPRINT_RECHECK_REQUIRED = true

/**
 * C2 —— 预算耗尽的语义是 ESCALATE，不是 CLEAN。
 *
 * 实测依据：一份真实运行在 `{"current_round":1,"status":"in_progress"}` 状态下
 * **交付了**——不是"判定为通过"，是"没跑完就交了"。
 */
export const C2_BUDGET_EXHAUSTED_IS_ESCALATE = true

/**
 * C3 —— checker 未执行与未通过同级。
 *
 * 实测依据：一份运行的数据门禁结论停在 `🔄 待自检`（未执行），交付照常发生；
 * 另一份的通过条件是**被检查者自己写进产物的一个字符串**（`<!-- DATA_CHECK_PASSED -->`）。
 * 门禁的演化是"未执行 → 自证"，后者**更危险**，因为它看起来是绿的。
 */
export const C3_NOT_EXECUTED_EQUALS_NOT_PASSED = true

/** 闭环层的预算。 */
export interface ClosureBudget {
  /** 总修复轮次上限（所有 finding 共享）。 */
  readonly maxRounds: number
  /** 单条 finding 的修复尝试上限（防震荡）。 */
  readonly maxAttemptsPerFinding: number
}

export const DEFAULT_CLOSURE_BUDGET: ClosureBudget = { maxRounds: 2, maxAttemptsPerFinding: 2 }

/** 闭环的终局。 */
export const CLOSURE_OUTCOMES = ['CLEAN', 'MARKED', 'ESCALATE'] as const
export type ClosureOutcome = (typeof CLOSURE_OUTCOMES)[number]

/** 一次复验的记录（进审计轨迹）。 */
export interface RecheckRecord {
  readonly findingId: string
  readonly before: string
  readonly after: string | null
  readonly changed: boolean
  readonly checkerFailed: boolean
  readonly round: number
}

/** 闭环的最终报告。 */
export interface ClosureReport {
  readonly outcome: ClosureOutcome
  /** 全部 finding 的终态快照。 */
  readonly findings: ReadonlyArray<Finding>
  readonly rechecks: ReadonlyArray<RecheckRecord>
  readonly roundsUsed: number
  /** 仍未消解的 finding（`open`）——非空则 outcome 必为 ESCALATE。 */
  readonly unresolved: ReadonlyArray<Finding>
  /** 给人工接管的缺口清单（ESCALATE 时非空）。 */
  readonly gapList: ReadonlyArray<string>
}

/**
 * 闭环会话。
 *
 * 它**不自己跑 checker，也不自己修东西**——那两件事由调用方通过 `recheck` 与
 * `repair` 注入。这样本模块是纯逻辑、可确定性测试的：给定同一串复验结果，
 * 必然得到同一个终局。
 */
export class ClosureSession {
  readonly #findings: MutableFinding[]
  readonly #budget: ClosureBudget
  readonly #rechecks: RecheckRecord[] = []
  #roundsUsed = 0

  /**
   * @param findings - 检出队列（初始全为 `open`）。
   * @param budget - 预算；默认 {@link DEFAULT_CLOSURE_BUDGET}。
   */
  constructor(findings: ReadonlyArray<Finding>, budget: ClosureBudget = DEFAULT_CLOSURE_BUDGET) {
    // 快速失败：id 撞车会让 `resolve` 反复命中同一条，重复项永远留在 open，
    // 终局被误判为 ESCALATE。这类缺陷一旦静默，排查成本极高——所以在入口就红。
    const seen = new Set<string>()
    for (const f of findings) {
      if (seen.has(f.id)) {
        throw new Error(
          `closure: duplicate finding id ${f.id} (${f.checker} / ${f.category}) — ids must be unique per occurrence; pass \`occurrence\` to makeFinding`,
        )
      }
      seen.add(f.id)
    }
    this.#findings = findings.map(f => ({ ...f, where: f.where }))
    this.#budget = budget
  }

  /** 当前全部 finding（只读视图）。 */
  get findings(): ReadonlyArray<Finding> {
    return this.#findings
  }

  /** 仍未消解的 finding。 */
  openFindings(): ReadonlyArray<Finding> {
    return this.#findings.filter(f => !TERMINAL_FINDING_STATES.has(f.state))
  }

  /**
   * 一条 finding 的分派结果——**分派规则是代码，不是倡议**。
   *
   * @param finding - 待分派的 finding。
   */
  dispatchOf(finding: Finding): { readonly assignee: string; readonly forbidden: string; readonly matched: boolean } {
    return dispatchOf(finding.where.artifactScope)
  }

  /** 预算是否已耗尽。 */
  budgetExhausted(): boolean {
    return this.#roundsUsed >= this.#budget.maxRounds
  }

  /**
   * 复验一条 finding：重跑**同一个** checker，比对 fingerprint。
   *
   * C1 是这里的实现：`changed === true` 才算"修好了"。`checker_failed` 落
   * `unverifiable`（C3：与未通过同级）。
   *
   * @param findingId - 目标 finding。
   * @param outcome - 复验结果（由调用方重跑 checker 得到）。
   */
  recheck(findingId: string, outcome: RecheckOutcome): RecheckRecord {
    const finding = this.#findings.find(f => f.id === findingId)
    if (finding === undefined) {
      throw new Error(`closure: unknown finding ${findingId}`)
    }
    if (outcome.kind === 'checker_failed') {
      this.#setState(finding, 'unverifiable')
      const record: RecheckRecord = {
        findingId,
        before: finding.fingerprint,
        after: null,
        changed: false,
        checkerFailed: true,
        round: this.#roundsUsed,
      }
      this.#rechecks.push(record)
      return record
    }
    const changed = outcome.value !== finding.fingerprint
    if (changed) {
      this.#setState(finding, 'fixed')
    }
    const record: RecheckRecord = {
      findingId,
      before: finding.fingerprint,
      after: outcome.value,
      changed,
      checkerFailed: false,
      round: this.#roundsUsed,
    }
    this.#rechecks.push(record)
    return record
  }

  /**
   * 记录一次修复尝试。**每次尝试都计入同一预算**——防震荡：
   * 否则"改坏了再改回来"可以无限循环。
   *
   * @param findingId - 目标 finding。
   * @returns 是否还有尝试额度。
   */
  recordAttempt(findingId: string): boolean {
    const finding = this.#findings.find(f => f.id === findingId)
    if (finding === undefined) throw new Error(`closure: unknown finding ${findingId}`)
    finding.attempts += 1
    return finding.attempts < this.#budget.maxAttemptsPerFinding
  }

  /** 开始新一轮（推进预算）。 */
  beginRound(): void {
    this.#roundsUsed += 1
  }

  /**
   * 消解一条 finding：**显式接受是一等公民**。
   *
   * @param findingId - 目标 finding。
   * @param state - 终态：`accepted` / `rejected` / `fixed`。
   * @param note - 接受/驳回的理由与证据（写进交付物附录）。
   */
  resolve(findingId: string, state: Extract<FindingState, 'accepted' | 'rejected' | 'fixed'>, note: string): void {
    const finding = this.#findings.find(f => f.id === findingId)
    if (finding === undefined) throw new Error(`closure: unknown finding ${findingId}`)
    finding.state = state
    if (note.trim().length > 0) {
      // 理由并入证据字段——附录渲染读的就是它，不需要第二个字段。
      finding.evidence = `${finding.evidence}｜处置：${note}`
    }
  }

  /**
   * 收口，给出终局。
   *
   * **C2 在这里落地**：只要还有 `open` 的 finding，终局就是 `ESCALATE`——
   * 预算耗尽**不能**变成 CLEAN。`ESCALATE` 不是"失败"，它是一条正常的出口：
   * 交出"未完成包"（已产出的中间物 + 缺口清单 + 建议动作），交人工接管。
   */
  close(): ClosureReport {
    const unresolved = this.openFindings()
    let outcome: ClosureOutcome
    if (unresolved.length > 0) {
      outcome = 'ESCALATE'
    } else if (this.#findings.length === 0) {
      outcome = 'CLEAN'
    } else {
      outcome = 'MARKED'
    }
    const gapList = unresolved.map((f) => {
      const d = this.dispatchOf(f)
      return `${f.severity.toUpperCase()} ${f.category} @ ${f.where.files.join('、')} — 建议分派：${d.assignee}${d.forbidden.length > 0 ? `（${d.forbidden}）` : ''}；证据：${f.evidence}`
    })
    return {
      outcome,
      findings: [...this.#findings],
      rechecks: [...this.#rechecks],
      roundsUsed: this.#roundsUsed,
      unresolved,
      gapList,
    }
  }

  #setState(finding: MutableFinding, state: FindingState): void {
    finding.state = state
  }
}

/**
 * 渲染"未完成包"的缺口清单——`ESCALATE` 的交付物形态。
 *
 * 它和"已知缺陷表"是两件事：已知缺陷表是**已接受**的缺陷（有归宿），
 * 缺口清单是**未消解**的缺陷（没归宿）。前者可以交付，后者必须交人工。
 *
 * @param report - 闭环报告。
 */
export function renderEscalationPackage(report: ClosureReport): string {
  const lines: string[] = []
  lines.push('# 未完成包（ESCALATE）')
  lines.push('')
  lines.push(`本次运行以 **ESCALATE** 收口：闭环层在 ${String(report.roundsUsed)} 轮预算内**未能消解全部 findings**。`)
  lines.push('')
  lines.push('这不是失败——已产出的中间物全部保留，下面是缺口清单与建议动作。请人工接管剩余项。')
  lines.push('')
  lines.push(`## 缺口清单（${String(report.unresolved.length)} 项未消解）`)
  lines.push('')
  if (report.gapList.length === 0) {
    lines.push('（无）')
  } else {
    report.gapList.forEach((g, i) => lines.push(`${String(i + 1)}. ${g}`))
  }
  lines.push('')
  lines.push('## 复验记录')
  lines.push('')
  lines.push('| finding | 复验前指纹 | 复验后指纹 | 是否改变 | checker 状态 |')
  lines.push('|---|---|---|---|---|')
  for (const r of report.rechecks) {
    lines.push(`| ${r.findingId} | \`${r.before}\` | ${r.after === null ? '—' : `\`${r.after}\``} | ${r.changed ? '✅ 是' : '❌ 否'} | ${r.checkerFailed ? '未跑通' : '正常'} |`)
  }
  lines.push('')
  lines.push('*判据：复验指纹未改变 = 未修复。"我改过了"不作为证据（C1）。*')
  return lines.join('\n')
}
