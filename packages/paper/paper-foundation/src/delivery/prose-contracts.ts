/**
 * W11.5 round-4 — 要素级写作契约（审计 §3.2 第 1+2 步）。
 *
 * 审计的实证：baseline-23 的「问题分析」207 字符、「模型评价」185 字符、参考文献
 * 1 篇、问题3/4 的利润为 0 且无过程——**全部机械放行**。根因在 `executor.ts` 的
 * 章节检查只问一句"是不是非空字符串"：
 *
 *     return typeof value !== 'string' || value.trim() === ''
 *
 * 于是模板只锁住了"有哪些章"，没锁住"每章要装什么"。本模块把五个散文章从
 * "自由发挥"改成"要素化契约"：**要素在不在、逐问覆盖到没到**（机械可判），
 * 而不是"写得好不好"（实质正确性，W8.9-C2 明确保留给模型）。
 *
 * 刻意不做的事：**不设字数下限**。审计明确要求"设要素门槛而非字门槛，避免模型
 * 灌水"——一段 200 字但逐问归因、四要素齐备的分析是合格的下限。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/prose-contracts
 */

export interface ProseContractViolation {
  /** The narrative key the chapter is written in (e.g. `analysis`). */
  readonly chapter: string
  /** Chinese title, for the refusal message the model reads. */
  readonly title: string
  readonly reason: string
}

/** One required output, as the contract needs to see it. */
export interface ContractRequirement {
  readonly requirementId: string
  readonly statement: string
}

/**
 * The ordinals a requirement can be named by: `R-Q2` is 问题2, and a paper may
 * spell it 问题 2 / 第2问 / (2). All spellings of the same question count.
 */
function ordinalsOf(requirementId: string): ReadonlyArray<string> {
  const match = /^R-Q(\d+)$/.exec(requirementId)
  if (match === null) return [requirementId]
  const n = match[1] ?? ''
  return [`问题${n}`, `问题 ${n}`, `第${n}问`, `第 ${n}问`, `(${n})`, `（${n}）`, requirementId]
}

/** Whether the text names this requirement in any accepted spelling. */
function namesRequirement(text: string, requirementId: string): boolean {
  return ordinalsOf(requirementId).some(spelling => text.includes(spelling))
}

/** Closed element sets: each element is satisfied by any of its spellings. */
const EVALUATION_ELEMENTS: ReadonlyArray<{ readonly name: string; readonly spellings: ReadonlyArray<string> }> = [
  { name: '优点', spellings: ['优点', '优势', '长处', 'advantage', 'strength'] },
  { name: '局限', spellings: ['局限', '不足', '缺点', '适用范围', 'limitation', 'weakness', 'caveat'] },
  { name: '敏感性', spellings: ['敏感性', '灵敏度', '稳健', '鲁棒', 'sensitiv', 'robust'] },
  { name: '推广', spellings: ['推广', '拓展', '可移植', 'generaliz', 'extend', 'transferab'] },
]

/** Method-family keywords a reference must touch at least one of (weak association). */
const METHOD_KEYWORDS: ReadonlyArray<string> = [
  '抽样', '检验', '序贯', '贝叶斯', '决策', '优化', '动态规划', '仿真', '模拟', '回归',
  'binomial', 'sequential', 'bayes', 'decision', 'optimiz', 'sampling', 'simulation',
  'regression', 'statistic', 'hypothesis', 'monte',
]

/** Reference entries: every `[N]` marker starts one (line-per-entry or inline). */
function referenceEntries(text: string): ReadonlyArray<string> {
  return (text.match(/\[\d+\][^[]*/g) ?? []).map(s => s.trim())
}

/**
 * The requirements the per-question chapters are held to.
 *
 * `R-OUT` is the whole-paper output (its statement is the entire problem), so it
 * is not a "question" a per-question passage can be missing: only `R-Q<n>` ids
 * take part in the per-question coverage checks.
 */
function perQuestion(requirements: ReadonlyArray<ContractRequirement>): ReadonlyArray<ContractRequirement> {
  return requirements.filter(r => /^R-Q\d+$/.test(r.requirementId))
}

/**
 * The element-level findings for one run's narrative.
 *
 * @param narrative - the container's narrative block (already merged across attempts).
 * @param requirements - every REQUIRED_OUTPUT registered for this run; the prose
 *        chapters are held to "one passage per question", which is the mechanical
 *        half of the audit's complaint (207 字的问题分析没覆盖任何一问).
 */
/**
 * 每一章的最低实质篇幅（字符数）。
 *
 * 参照物：`CUMCM/workspaces/5ba6e7bd5010/paper/main.md`（52,415 字符，问题分析
 * 1,939 字符、模型评价 1,474、参考文献 3,914）。用户口径：**建模水平可以不那么高，
 * 但交付文件的质量必须对齐参照物——不允许大片空白、不允许非常简略的片段**。
 *
 * 这是"要素门槛"之外的**下限地板**：要素齐备但只有一句话，仍然是不可读的交付物。
 * 地板按"该章至少要说清什么"定，不按"写得漂亮"定——锁下限，不判上限。
 */
const SUBSTANCE_FLOOR: Readonly<Record<string, { readonly title: string; readonly min: number; readonly hint: string }>> = {
  analysis: {
    title: '问题分析',
    min: 600,
    hint: '逐问写清"归到哪类方法 + 为什么 + 难点在哪"，每问一段（参照物每问 270–600 字）',
  },
  evaluation: {
    title: '模型评价与推广',
    min: 500,
    hint: '四要素各一段：优点 / 局限 / 敏感性 / 推广，每段至少两三句（参照物 1,474 字）',
  },
  references: {
    title: '参考文献',
    min: 120,
    hint: '至少 3 条完整条目（作者、题名、出处、年份）',
  },
  code: {
    title: '代码附录',
    min: 200,
    hint: '说明代码实现了哪几问、关键函数做什么、结果文件怎么产生（正文代码块由 harness 从真实代码渲染）',
  },
  restatement: {
    title: '问题重述',
    min: 200,
    hint: '用自己的话重述题目背景与各问要求，不是把题面原文贴一遍',
  },
}

/** 要素门槛 + 实质地板：两层的违规一起报，模型一次改到位。 */
export function substanceViolations(
  narrative: Readonly<Record<string, unknown>>,
  requirements: ReadonlyArray<ContractRequirement>,
): ReadonlyArray<ProseContractViolation> {
  // The floors are a competition-paper standard: they apply when the statement
  // actually asks several questions (the case the audit measured). A
  // single-question problem is not held to a four-chapter word count.
  if (perQuestion(requirements).length === 0) return []
  const out: ProseContractViolation[] = []
  for (const [key, floor] of Object.entries(SUBSTANCE_FLOOR)) {
    const value = narrative[key]
    if (typeof value !== 'string' || value.trim() === '') continue // 空章由 placeholder_chapter 报
    const substantive = value.replace(/\s+/g, '').length
    if (substantive >= floor.min) continue
    out.push({
      chapter: key,
      title: floor.title,
      reason: `${floor.title}只有 ${substantive} 字（低于 ${floor.min} 字的下限）——交付件不允许"非常简略的片段"：`
        + floor.hint,
    })
  }
  return out
}

/**
 * W11.5 round-5 — 空白/密度判据（对齐参照系统 `pdf_page_density_check`）。
 *
 * 用户口径：交付件"绝不允许大片空白、非常简略的片段"。实质地板管的是**模型写的
 * 散文章**，这一条管的是**渲染后的成品**：任何一章正文（去掉表格与代码块）不足
 * 下限，或出现连续多行空行，都算空白区，一律拒。
 *
 * 只对多问题论文生效（单问题夹具不是竞赛论文）。
 */
export function blankAreaViolations(
  delivered: string,
  requirements: ReadonlyArray<ContractRequirement>,
): ReadonlyArray<ProseContractViolation> {
  if (perQuestion(requirements).length === 0) return []
  const out: ProseContractViolation[] = []
  const lines = delivered.split(String.fromCharCode(10))
  // 1) 连续空行：渲染器或模型留下的空白块。
  let run = 0
  let worst = 0
  for (const line of lines) {
    run = line.trim() === "" ? run + 1 : 0
    if (run > worst) worst = run
  }
  if (worst >= 4) {
    out.push({ chapter: "density", title: "版面密度", reason: `正文出现 ${worst} 行连续空行（大片空白）——交付件不允许空白区，请把该处内容补齐` })
  }
  // 2) 逐章正文体量：标题之间去掉表格/代码块后不足下限，即"几乎是空的章节"。
  const MIN_SECTION = 120
  let title: string | null = null
  let body = 0
  let inCode = false
  const flush = (): void => {
    if (title !== null && body < MIN_SECTION) {
      out.push({ chapter: "density", title: "版面密度", reason: `「${title}」正文只有 ${body} 字（低于 ${MIN_SECTION} 字）——这一章几乎是空的` })
    }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) { inCode = !inCode; continue }
    const heading = /^#{2,3}\s+(.+)$/.exec(trimmed)
    if (heading !== null) { flush(); title = heading[1] ?? null; body = 0; continue }
    if (title === null || inCode) continue
    if (trimmed.startsWith("|")) continue
    body += trimmed.replace(/\s+/g, "").length
  }
  flush()
  return out
}

export function proseContractViolations(
  narrative: Readonly<Record<string, unknown>>,
  requirements: ReadonlyArray<ContractRequirement>,
): ReadonlyArray<ProseContractViolation> {
  const out: ProseContractViolation[] = []
  const textOf = (key: string): string => (typeof narrative[key] === 'string' ? String(narrative[key]) : '')

  // 问题分析 — every sub-problem must be attributed (which family/method, why).
  const analysis = textOf('analysis')
  if (analysis.trim() !== '') {
    const missing = perQuestion(requirements).filter(r => !namesRequirement(analysis, r.requirementId))
    if (missing.length > 0) {
      out.push({
        chapter: 'analysis',
        title: '问题分析',
        reason: `问题分析没有逐问归因：缺 ${missing.map(r => `${r.requirementId}（${r.statement.slice(0, 24)}…）`).join('、')}`
          + '。每问至少写清"归到哪类方法 + 为什么 + 难点在哪"一段——审稿人按问读，缺一问就是没分析。',
      })
    }
  }

  // 模型评价 — four elements, each a real passage (competition-paper standard).
  const evaluation = textOf('evaluation')
  if (evaluation.trim() !== '' && perQuestion(requirements).length > 0) {
    const evaluationLower = evaluation.toLowerCase()
    const missingElements = EVALUATION_ELEMENTS.filter(
      element => !element.spellings.some(s => evaluationLower.includes(s.toLowerCase())),
    )
    if (missingElements.length > 0) {
      out.push({
        chapter: 'evaluation',
        title: '模型评价与推广',
        reason: `模型评价缺要素：${missingElements.map(e => e.name).join('、')}`
          + '。这一章固定四要素——优点 / 局限 / 敏感性 / 推广，每项一段（"结果可靠、可推广"这类一句话不算）。',
      })
    }
  }

  // 参考文献 — a real bibliography, at least weakly tied to the methods used.
  const references = textOf('references')
  if (references.trim() !== '' && perQuestion(requirements).length > 0) {
    const entries = referenceEntries(references)
    if (entries.length < 3) {
      out.push({
        chapter: 'references',
        title: '参考文献',
        reason: `参考文献只有 ${entries.length} 条（少于 3 条）：建模论文要给出方法与数据来源的出处，`
          + '每条形如 "[1] 作者. 题名. 出处. 年."，并用正文引用它。',
      })
    } else if (!METHOD_KEYWORDS.some(k => references.toLowerCase().includes(k.toLowerCase()))) {
      out.push({
        chapter: 'references',
        title: '参考文献',
        reason: '参考文献与本文所用方法没有可辨的关联：至少一条要指向你实际用的方法'
          + '（抽样检验 / 序贯 / 贝叶斯 / 决策 / 优化 / 仿真 …）。',
      })
    }
  }

  // 代码附录 — must say which questions the code solves.
  const code = textOf('code')
  if (code.trim() !== '' && perQuestion(requirements).length > 0) {
    const missing = perQuestion(requirements).filter(r => !namesRequirement(code, r.requirementId))
    if (missing.length > 0) {
      out.push({
        chapter: 'code',
        title: '代码附录',
        reason: `代码附录没有说明实现了哪几问：缺 ${missing.map(r => r.requirementId).join('、')}`
          + '。逐问点名（"问题2 的 16 组合枚举由 solve_q2() 完成"），读者才知道结果从哪段代码来。',
      })
    }
  }

  return [...out, ...substanceViolations(narrative, requirements)]
}
