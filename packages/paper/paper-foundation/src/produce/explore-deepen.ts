/**
 * L2 — 探索 / 择优 / 深挖（含回溯条款）。
 *
 * ## 为什么把线性流程改成分段
 *
 * 建模论文的质量差距，**大半在"选了什么方法"，小半在"执行得多好"**。线性流程
 * （第一个想法直接进深挖）把选择权交给运气：模型一旦开始写代码，探索就结束了，
 * 而它此时还没有比较过任何替代方案。
 *
 * 更糟的是**没有第三条路**。线性流程里的模型在深挖阶段发现方法不适配时只有两个
 * 选择：硬着头皮产出错的结果，或者编造成功。两者都是灾难。
 *
 * 本模块给三样东西：**多方案比较**、**可复活的落选存档**、**带回溯的失败出口**。
 *
 * ## 预算
 *
 * 探索段约占总预算 **15%**。这个数字是设计选择而非测量结论——但它有明确的
 * 上下界理由：低于 5% 等于没有比较（草图质量会退化成一两句口号），高于 25%
 * 会挤压深挖（论文的深度来自深挖，不是来自更多草图）。
 *
 * ## 与"闭集契约"的关系
 *
 * **本模块不限定可选方法。** 打分维度里的"数据匹配度"与"时间可行性"是**建议**，
 * 不是白名单；`method` 字段是自由文本。任何把候选方法收成枚举的做法，都会把
 * 刚解开的封顶重新焊回去。
 *
 * ## 与 `expand-select.ts` 的区别（避免误读为重复实现）
 *
 * 两者名字相近、层次不同：
 *
 * | 模块 | 作用面 | 时机 |
 * |---|---|---|
 * | `expand-select.ts` | **声明层**：容器候选字段的展开与选择（协议降级路径） | 产出容器时 |
 * | 本模块 | **建模层**：方法方案的选择与回溯 | 动笔之前 |
 *
 * 前者管"这个字段能不能填"，后者管"这一问该用什么方法"。前者不替代后者——
 * 一份字段填得完全正确、方法选错的论文，仍然是一份差论文。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/explore-deepen
 */

/** 探索—择优—深挖的三段。 */
/** 候选标签前缀（`候选1：` / `approach B:` 之类），规范化时剥掉。 */
// `A-Z` 已覆盖小写（正则带 `i`），写 `A-Za-z` 会被 lint 判成字符类里的重复项。
const CANDIDATE_LABEL_PREFIX = /^(?:候选|方案|方法|candidate|approach|option)\s*[0-9A-Z一二三四五六七八九十]+\s*[：:，,]?\s*/i

export const EXPLORE_STAGES = ['explore', 'select', 'deepen'] as const
export type ExploreStage = (typeof EXPLORE_STAGES)[number]

/** 探索段占总预算的比例。 */
export const EXPLORE_BUDGET_FRACTION = 0.15

/** 每个子问题至少产出的草图数（少于 2 个就没有"比较"这回事）。 */
export const MIN_CANDIDATES_PER_PROBLEM = 2

/** 每个子问题最多产出的草图数（再多是浪费预算）。 */
export const MAX_CANDIDATES_PER_PROBLEM = 3

/** 一份方案草图。**轻**是刻意的：草图写得太重，探索就变成了深挖。 */
export interface CandidateSketch {
  readonly candidate_id: string
  /** 该草图针对的子问题（ProblemSpec id）。 */
  readonly problem_ref: string
  /** 方法名——**自由文本**，不是枚举。 */
  readonly method: string
  /** 核心思路（一句话）。 */
  readonly approach: string
  /** 需要哪些数据/参数。 */
  readonly requires: ReadonlyArray<string>
  /** 主要风险：哪一步最可能走不通。 */
  readonly risk: string
  /** 预期深度：能给出什么量级的结论。 */
  readonly expectedDepth: string
}

/** 择优的四维打分。每维 0–10。 */
export interface CandidateScore {
  readonly candidate_id: string
  /** 正确性风险（分越高＝风险越低）。 */
  readonly correctnessRisk: number
  /** 深度潜力。 */
  readonly depthPotential: number
  /** 数据匹配度。 */
  readonly dataFit: number
  /** 时间可行性。 */
  readonly timeFeasibility: number
}

/** 择优的结论。 */
export interface SelectionDecision {
  readonly problem_ref: string
  readonly chosen: string
  readonly scores: ReadonlyArray<CandidateScore>
  /** 选择理由（写进 decision.md）。 */
  readonly reason: string
  /** 落选者各自的落选理由（写进 decision.md）。 */
  readonly rejected: ReadonlyArray<{ readonly candidate_id: string; readonly why: string }>
}

/** 一次回溯事件的记录（进审计轨迹）。 */
export interface BacktrackEvent {
  readonly from_candidate: string
  readonly to_candidate: string
  /** 触发回溯的失败证据——**必须带证据**，否则回溯会退化成"结果不好看就换方法"。 */
  readonly failureEvidence: string
  readonly reason: string
}

/** 打分加权（可调，但集中在常量里，便于审计）。 */
export const SCORE_WEIGHTS: Readonly<Record<'correctnessRisk' | 'depthPotential' | 'dataFit' | 'timeFeasibility', number>> = {
  correctnessRisk: 0.35,
  depthPotential: 0.3,
  dataFit: 0.2,
  timeFeasibility: 0.15,
}

/** 计算加权总分。 */
export function totalScore(score: CandidateScore): number {
  return (
    score.correctnessRisk * SCORE_WEIGHTS.correctnessRisk +
    score.depthPotential * SCORE_WEIGHTS.depthPotential +
    score.dataFit * SCORE_WEIGHTS.dataFit +
    score.timeFeasibility * SCORE_WEIGHTS.timeFeasibility
  )
}

/**
 * 探索—择优—深挖会话。
 *
 * 状态机是**显式**的：`explore → select → deepen`，深挖可回退到 `select`。
 * 阶段跃迁被断言，因此"没比较就深挖"在结构上不可能发生。
 */
export class ExploreSelectDeepenSession {
  #stage: ExploreStage = 'explore'
  readonly #sketches: CandidateSketch[] = []
  readonly #selections: SelectionDecision[] = []
  readonly #backtracks: BacktrackEvent[] = []

  /** 当前阶段。 */
  get stage(): ExploreStage {
    return this.#stage
  }

  /** 已归档的草图（含落选——落选不删除）。 */
  get archive(): ReadonlyArray<CandidateSketch> {
    return [...this.#sketches]
  }

  /** 回溯记录。 */
  get backtracks(): ReadonlyArray<BacktrackEvent> {
    return [...this.#backtracks]
  }

  /**
   * 提交一个子问题的草图集。
   *
   * 数量被约束在 [MIN, MAX]：少于 2 没有比较，多于 3 是浪费。
   *
   * @param problemRef - 子问题 id。
   * @param sketches - 该子问题的草图。
   */
  submitSketches(problemRef: string, sketches: ReadonlyArray<Omit<CandidateSketch, 'problem_ref'>>): void {
    if (this.#stage !== 'explore') {
      throw new Error(`explore-deepen: sketches can only be submitted during the explore stage (current: ${this.#stage})`)
    }
    if (sketches.length < MIN_CANDIDATES_PER_PROBLEM) {
      throw new Error(
        `explore-deepen: ${problemRef} submitted ${String(sketches.length)} sketch(es) — at least ${String(MIN_CANDIDATES_PER_PROBLEM)} are required, otherwise nothing is being compared`,
      )
    }
    if (sketches.length > MAX_CANDIDATES_PER_PROBLEM) {
      throw new Error(
        `explore-deepen: ${problemRef} submitted ${String(sketches.length)} sketches — at most ${String(MAX_CANDIDATES_PER_PROBLEM)} (exploration has a budget)`,
      )
    }
    for (const s of sketches) this.#sketches.push({ ...s, problem_ref: problemRef })
  }

  /** 进入择优阶段。 */
  beginSelection(): void {
    if (this.#stage !== 'explore') throw new Error(`explore-deepen: cannot select from stage ${this.#stage}`)
    this.#stage = 'select'
  }

  /**
   * 记录一次择优。
   *
   * @param decision - 选择结论。`chosen` 必须在打分的候选里，且落选者必须各带理由。
   */
  recordSelection(decision: SelectionDecision): void {
    if (this.#stage !== 'select') throw new Error(`explore-deepen: selections belong to the select stage (current: ${this.#stage})`)
    const ids = new Set(decision.scores.map(s => s.candidate_id))
    if (!ids.has(decision.chosen)) {
      throw new Error(`explore-deepen: chosen candidate ${decision.chosen} has no score — a selection must be justified by a comparison`)
    }
    const scored = decision.scores.filter(s => s.candidate_id !== decision.chosen)
    const rejectedIds = new Set(decision.rejected.map(r => r.candidate_id))
    for (const s of scored) {
      if (!rejectedIds.has(s.candidate_id)) {
        throw new Error(`explore-deepen: candidate ${s.candidate_id} was scored but neither chosen nor rejected with a reason`)
      }
    }
    if (decision.reason.trim().length < 8) {
      throw new Error('explore-deepen: the selection reason is too short to be a reason')
    }
    for (const r of decision.rejected) {
      if (r.why.trim().length < 4) {
        throw new Error(`explore-deepen: rejected candidate ${r.candidate_id} carries no reason`)
      }
    }
    this.#selections.push(decision)
    this.#stage = 'deepen'
  }

  /** 深挖阶段的当前选择（每个子问题一份）。 */
  selections(): ReadonlyArray<SelectionDecision> {
    return [...this.#selections]
  }

  /**
   * 回溯：深挖中发现根本性失败，携带证据回到择优，从存档里换一个方案。
   *
   * **必须带失败证据**——没有证据的"回溯"就是"结果不好看就换方法"，那是另一种
   * 不诚实。证据形态：方法不适配（哪个假设在题面上不成立）、数据支撑不了
   * （缺哪个量）、推导走不通（哪一步的代数不闭合）、结果违反物理约束（违反哪条）。
   *
   * @param event - 回溯事件。
   */
  backtrack(event: BacktrackEvent): void {
    if (this.#stage !== 'deepen') throw new Error(`explore-deepen: backtracking is only meaningful from the deepen stage (current: ${this.#stage})`)
    if (event.failureEvidence.trim().length < 16) {
      throw new Error('explore-deepen: a backtrack needs real failure evidence — "the result looked bad" is not one')
    }
    const target = this.#sketches.find(s => s.candidate_id === event.to_candidate)
    if (target === undefined) {
      throw new Error(`explore-deepen: cannot backtrack to ${event.to_candidate} — it is not in the archive`)
    }
    this.#backtracks.push({ ...event })
    this.#stage = 'select'
  }

  /** 回溯后重新择优（复用 `recordSelection`，语义上是一次新的选择）。 */
  resumeDeepen(): void {
    if (this.#stage !== 'select') throw new Error(`explore-deepen: nothing to resume from stage ${this.#stage}`)
    this.#stage = 'deepen'
  }

  /**
   * 渲染 `decision.md`——择优的可复核记录。
   *
   * 它存在的理由是让"为什么选了这个方法"从**隐性**变成**显性**：
   * 评审者（人或模型）要能看出选择是有依据的，而不是第一个想到的。
   */
  renderDecisionRecord(): string {
    const lines: string[] = ['# 方案决策记录（decision.md）', '']
    if (this.#selections.length === 0) {
      lines.push('（尚无择优记录）')
      return lines.join('\n')
    }
    for (const d of this.#selections) {
      lines.push(`## ${d.problem_ref}`)
      lines.push('')
      lines.push(`**选定**：\`${d.chosen}\` — ${d.reason}`)
      lines.push('')
      lines.push('| 候选 | 正确性风险 | 深度潜力 | 数据匹配 | 时间可行 | 加权 |')
      lines.push('|---|---|---|---|---|---|')
      for (const s of [...d.scores].sort((a, b) => totalScore(b) - totalScore(a))) {
        const mark = s.candidate_id === d.chosen ? ' ✅' : ''
        lines.push(`| ${s.candidate_id}${mark} | ${String(s.correctnessRisk)} | ${String(s.depthPotential)} | ${String(s.dataFit)} | ${String(s.timeFeasibility)} | ${totalScore(s).toFixed(2)} |`)
      }
      lines.push('')
      if (d.rejected.length > 0) {
        lines.push('**落选理由**（方案已存档，可复活）：')
        for (const r of d.rejected) lines.push(`- \`${r.candidate_id}\`：${r.why}`)
        lines.push('')
      }
    }
    if (this.#backtracks.length > 0) {
      lines.push('## 回溯记录')
      lines.push('')
      for (const b of this.#backtracks) {
        lines.push(`- \`${b.from_candidate}\` → \`${b.to_candidate}\`：${b.reason}`)
        lines.push(`  - 失败证据：${b.failureEvidence}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }
}

/**
 * 择优阶段的指令——注入 prompt 的那一段。
 *
 * 它要求三样东西，缺一不可：**四维打分**（打分让选择可比较）、**选择理由**
 * （让选择可复核）、**落选者各自的落选理由**（让被放弃的方案不冤）。
 */
export const SELECT_INSTRUCTION = [
  'SELECT among the sketches above. For EACH sub-problem:',
  '  1. Score every candidate on four dimensions, each 0–10: correctness risk (higher = safer),',
  '     depth potential, data fit, time feasibility.',
  '  2. Pick ONE and state why — in terms of the scores and of what the statement actually asks for.',
  '  3. State why each rejected candidate lost. A candidate with no stated reason is not a comparison.',
  '  4. KEEP the rejected sketches. If the chosen one fails fundamentally during deepening,',
  '     you will come back to these.',
  'Output a decision record in Markdown: one section per sub-problem, with the score table,',
  'the chosen candidate, and the rejection reasons. Be concrete — "C1 is better" is not a reason;',
  '"C1 can answer 比较优劣 because it enumerates all 16 strategies, while C2 only yields one plan" is.',
].join(String.fromCharCode(10))

/**
 * 探索阶段的指令——注入 prompt 的那一段。
 *
 * 它只说**要做什么**（产出 2–3 个草图、不要写代码），不说**用什么方法**。
 */
export const EXPLORE_INSTRUCTION = [
  'EXPLORE BEFORE YOU BUILD. For EVERY sub-problem the statement asks, write 2–3 candidate approaches as SHORT sketches (300–500 characters each) before you commit to one.',
  'Each sketch states: the method by name, the core idea in one sentence, what data/parameters it needs, the step most likely to fail, and how deep a conclusion it can support.',
  'Do NOT write code during exploration. Writing code ends exploration.',
  'Then SELECT: score the candidates on correctness risk, depth potential, data fit and time feasibility; pick one and say why; say why each rejected one lost. Keep the rejected sketches — they stay available if the chosen one fails.',
  'If, while deepening, the chosen approach hits a FUNDAMENTAL failure (method does not fit, data cannot support it, the derivation does not close, or the result violates a physical constraint), STOP and backtrack: carry the failure evidence back to selection and take the next-best archived candidate. Producing a wrong result, or pretending success, are both worse than backtracking.',
  'Method choice is entirely yours — no method is forbidden and no list is exhaustive. `skills/modeling-playbook.md` is advice, not a whitelist.',
].join('\n')


/**
 * 候选标签的**规范形式**：只保留标识部分，中文序号折成阿拉伯数字。
 *
 * 于是 `候选 C1` / `C1` / `candidate 1` 都是 `1`，`方案一` 与 `方案1` 也是 `1`——
 * 同一个方案不会因为写法不同被算成两个。
 *
 * @param label - 从行首捕获到的标识部分。
 */
export function normalizeCandidateLabel(label: string): string {
  const CJK_DIGITS: Readonly<Record<string, string>> = {
    一: '1', 二: '2', 三: '3', 四: '4', 五: '5',
    六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
  }
  const trimmed = label.trim().replace(/^c-?/i, '')
  return (CJK_DIGITS[trimmed] ?? trimmed).toLowerCase()
}

/**
 * 对**择优记录**做机械检查——把模块的结构约束真正接进主线。
 *
 * ## 为什么需要它
 *
 * 探索与择优在主线上是两次模型调用，产出是散文。若只靠 prompt 约定，一个跳过
 * 比较的模型（"我选了 C1，因为它好"）会**看起来完成了流程**——而流程的全部价值
 * 就在于那次比较真的发生了。本函数把三条结构约束变成可机械检出的缺陷：
 *
 *   1. 每个子问题至少出现 `MIN_CANDIDATES_PER_PROBLEM` 个候选；
 *   2. 有明确的选择标记；
 *   3. **落选者各自带理由**（"C1 更好"这类不算——判据是理由长度）。
 *
 * ## 它是**检出**，不是**拒绝**
 *
 * 返回的缺陷进 L6 门禁状态机（`explore_deepen` 门禁）：首次违规注入一条针对性
 * 微教学，同维度再次违规才收紧。探索是"想得更好"的机制，把它做成硬门只会
 * 制造新的零产物来源。
 *
 * @param decisionRecord - 择优节点的输出文本。
 * @param problemIds - 本次运行的子问题 id（用来判断"每个子问题都覆盖了吗"）。
 */
export function reviewDecisionRecord(
  decisionRecord: string,
  problemIds: ReadonlyArray<string>,
): ReadonlyArray<{ readonly id: string; readonly severity: 'major' | 'minor'; readonly description: string }> {
  const findings: Array<{ id: string; severity: 'major' | 'minor'; description: string }> = []
  const text = decisionRecord.trim()
  if (text.length === 0) {
    return [{ id: 'EX-0', severity: 'major', description: '择优记录为空——探索—择优这一段没有产出任何可比的内容' }]
  }
  // ── 候选计数：按"候选是**在哪里被引入**"判，不按"标签出现几次" ────────
  //
  // 两次真实教训叠在这一个判据上：
  //
  //   ① 第一版只认 `C1`，模型写"方案一/方案二"时被判成 0 个候选 —— **误报**。
  //   ② 放宽成"任何位置出现都算"后，`候选 C1：… 选定 C1。` 被算成**两个**不同
  //      候选（前缀词形态不同）—— 于是"只有一个方案"的负对照**静默通过**，
  //      那是比误报更糟的假阴性：机制被绕过了而没人知道。
  //
  // 正确的判据既不是"标签长什么样"，也不是"出现几次"，而是**候选被引入的位置**：
  // 一个方案是作为**列表项/独立行**被摆出来的（"方案一：…"），不是在被引用时
  // （"未采纳方案二：…"）。因此只看**行首**（允许列表符号与序号），且要求标签后
  // 紧跟分隔符。标签的**标识部分**做规范化，于是 `候选 C1` 与 `C1`、`方案一` 与
  // `方案1` 都是同一个候选。
  const candidateMarkers = new Set<string>()
  for (const rawLine of text.split(String.fromCharCode(10))) {
    // 去掉列表符号 / markdown 标题 / 有序列表序号，只看"这一行开头引入了什么"。
    const line = rawLine
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*#{1,6}\s*/, '')
      .trim()
    const introduced = /^(?:候选|方案|方法|candidate|approach|option)\s*([0-9A-Za-z一二三四五六七八九十]+)\s*[：:、.)）]/.exec(line)
      ?? /^(C-?\d+)\s*[：:、.)）]/.exec(line)
    if (introduced === null) continue
    candidateMarkers.add(normalizeCandidateLabel(introduced[1] ?? ''))
  }
  if (candidateMarkers.size < MIN_CANDIDATES_PER_PROBLEM) {
    findings.push({
      id: 'EX-1',
      severity: 'major',
      description: `择优记录里只出现了 ${String(candidateMarkers.size)} 个候选（少于 ${String(MIN_CANDIDATES_PER_PROBLEM)} 个）——没有比较就没有择优，被放弃的方案必须真的存在过`,
    })
  }
  // 选择标记：选定/选定为/选择/chosen/selected/pick。
  const hasChoice = /选定|选择|采纳|采用|chosen|selected|picked|choose/i.test(text)
  if (!hasChoice) {
    findings.push({ id: 'EX-2', severity: 'major', description: '择优记录里没有明确的选择标记（选定/选择/chosen/selected）——读者无法判断最终用了哪个方案' })
  }
  // 落选理由：要求出现"落选/未选/放弃/rejected/lost"这类标记，且理由不是一句话。
  const rejectedMarkers = [...text.matchAll(/(?:落选|未选|未采纳|不选|不采用|放弃|排除|rejected|lost|not chosen|why not)[：:，,\s]*([^\n]{0,120})/gi)]
  if (candidateMarkers.size >= MIN_CANDIDATES_PER_PROBLEM && rejectedMarkers.length === 0) {
    findings.push({
      id: 'EX-3',
      severity: 'minor',
      description: '择优记录里没有落选理由——被放弃的方案各自为什么输，必须写出来（"C1 更好"不算理由）',
    })
  } else {
    for (const marker of rejectedMarkers) {
      // 捕获串以"候选 id + 冒号"开头（"C2：好"），所以量长度前先把 id 剥掉——
      // 否则 "C2：好" 有 5 个字符，看起来像一条合格的理由。
      const why = (marker[1] ?? '')
        .replace(CANDIDATE_LABEL_PREFIX, '')
        .replace(/^(?:C-?\d+)\s*[：:，,]?\s*/i, '')
        .trim()
      if (why.length > 0 && why.length < 4) {
        findings.push({ id: 'EX-4', severity: 'minor', description: `落选理由过短（"${why}"）——理由要具体到"它能/不能回答题面的哪一问"` })
      }
    }
  }
  // 每个子问题都要有自己的一段。
  const covered = problemIds.filter(id => text.includes(id) || text.includes(id.replace(/^P/, '问题')))
  if (problemIds.length > 1 && covered.length < problemIds.length) {
    const missing = problemIds.filter(id => !covered.includes(id))
    findings.push({ id: 'EX-5', severity: 'minor', description: `择优记录没有覆盖全部子问题：缺 ${missing.join('、')}——每一问的方法都要单独比较` })
  }
  return findings
}
