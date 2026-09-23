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
export const PAPER_LENGTH_REFERENCE = {
  /** 正文总字符数参考值（给模型的目标；参照物 52,415 的量级）。 */
  targetChars: 30_000,
  /** 低于此值才要求重写（约参照物 60%）；高于 targetChars 不阻塞。 */
  rewriteBelowChars: 18_000,
  chapters: {
    analysis: { reference: 2_000, rewriteBelow: 1_200 },
    evaluation: { reference: 1_400, rewriteBelow: 800 },
    references: { reference: 1_500, rewriteBelow: 600 },
    code: { reference: 1_500, rewriteBelow: 600 },
    restatement: { reference: 1_000, rewriteBelow: 400 },
  } as Readonly<Record<string, { readonly reference: number; readonly rewriteBelow: number }>>,
} as const


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
/** 软下限查询（参照值表可能缺键时回落到默认值）。 */
const softFloor = (key: string, fallback: number): number => PAPER_LENGTH_REFERENCE.chapters[key]?.rewriteBelow ?? fallback

const SUBSTANCE_FLOOR: Readonly<Record<string, { readonly title: string; readonly min: number; readonly hint: string }>> = {
  analysis: {
    title: '问题分析',
    min: softFloor('analysis', 1_200),
    hint: '逐问写清"归到哪类方法 + 为什么 + 难点在哪"，每问一段（参照物每问 270–600 字）',
  },
  evaluation: {
    title: '模型评价与推广',
    min: softFloor('evaluation', 800),
    hint: '四要素各一段：优点 / 局限 / 敏感性 / 推广，每段至少两三句（参照物 1,474 字）',
  },
  references: {
    title: '参考文献',
    min: softFloor('references', 600),
    hint: '至少 3 条完整条目（作者、题名、出处、年份）',
  },
  code: {
    title: '代码附录',
    min: softFloor('code', 600),
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
/**
 * W11.5 round-7（用户口径：对齐参照物；篇幅**给参考值、不设硬门禁**）。
 *
 * 参照物 `CUMCM/workspaces/5ba6e7bd5010/paper/main.md` = 52,415 字符（≈30 页量级）：
 * 问题分析 1,939、模型章 5,875（7 小节）、四问各 2.9–9.6K、评价 1,474、
 * 参考文献 3,914、附录 A–D 各 1–1.8K。
 *
 * 机制（用户明确要求）：**参考值给模型看，重写线才拦人**——
 * `reference` 是目标（写进提示，让模型知道参照物的量级）；`rewriteBelow` 是软下限，
 * 低于它才要求重写（DRIFT，带纠错与预算）；**超过参考值永不阻塞、不裁剪**。
 * 数值由参照物实测字符数按比例定出，集中在此便于对齐，不散落成魔法数。
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
    run = line.trim() === '' ? run + 1 : 0
    if (run > worst) worst = run
  }
  if (worst >= 4) {
    out.push({ chapter: 'density', title: '版面密度', reason: `正文出现 ${worst} 行连续空行（大片空白）——交付件不允许空白区，请把该处内容补齐` })
  }
  // 2) 逐章正文体量：标题之间不足下限即"几乎是空的章节"。
  //
  // 两条修正（W11.5 round-7，离线预检实测抓到的假阳性）：
  //   a) **表格算内容**。假设表、符号表、方程表、模型表、结果表本来就是这些章的正文
  //      ——harness 从规范 IR 生成它们，模型一个字都不用写。旧写法把表格行整行跳过，
  //      于是"模型假设/符号说明/方程/模型/结果表"这些以表格为正文的章全部被判成
  //      "0 字，几乎是空的"，链条在交付前被自己的门拒掉。
  //   b) **章边界只认 `##`**。`### 方程` 是「模型建立与求解」的小节，旧写法把它当新章，
  //      父章于是变成 0 字。
  // 判据因此是：既没有 120 字正文、又**一行表格都没有**，才算空白章——"非常简略的
  // 片段"针对的是散文，不是 harness 从 IR 生成的表。
  const MIN_SECTION = 120
  let title: string | null = null
  let body = 0
  let tableRows = 0
  let inCode = false
  const flush = (): void => {
    if (title !== null && body < MIN_SECTION && tableRows === 0) {
      out.push({ chapter: 'density', title: '版面密度', reason: `「${title}」正文只有 ${body} 字、没有任何表格（低于 ${MIN_SECTION} 字）——这一章几乎是空的` })
    }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) { inCode = !inCode; continue }
    const heading = /^##\s+(.+)$/.exec(trimmed)
    if (heading !== null) { flush(); title = heading[1] ?? null; body = 0; tableRows = 0; continue }
    if (title === null || inCode) continue
    if (trimmed.startsWith('|')) {
      // 表格行：分隔行（|---|）不算行，其余按单元格里的实质字符计入正文。
      const cells = trimmed.replace(/[|\s]/g, '')
      if (!/^-+$/.test(cells) && cells !== '') tableRows += 1
      body += cells.replace(/-/g, '').length
      continue
    }
    body += trimmed.replace(/\s+/g, '').length
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

// ---------------------------------------------------------------------------
// W12-B1 — 按**渲染后的正文**重跑同一套契约
// ---------------------------------------------------------------------------
//
// ## 为什么需要它（strict-11 实测出来的洞）
//
// `proseContractViolations` 读的是 `narrative`——容器里的那个字段。于是它只覆盖
// **产线链**（A-produce-chain）：兜底路径（B-e1-direct）根本没有 narrative，检查
// 静默变成空转。
//
// 而兜底稿不是终点：它之后还要过**修订轮**（review→revise）。修订轮的输入输出都是
// 自由文本，唯一守卫是 `revisionDestroysDraft`（标题集合 + 长度 ≥50%）。实测
// （strict-11）：兜底稿里写着"本稿没有模型评价与推广：这一章由 E2 产出的容器提供…"
// 的**如实说明**，被修订轮整章改写成了 1,193 字的真内容；参考文献章同样从说明变成
// 425 字的条目表。也就是说——**交付出去的那两章，是一次从未被任何契约检查过的
// 自由文本改写**。
//
// 更糟的是它改出了**伪造的验证结论**：strict-11 的结果章写
// "情形(1)在 n=29, c₁=6 时第一类错误为 0.0473，满足不超过 5% 的要求"。
// 独立复算：P(X≥6 | 29, 0.1) = **0.0637**（不满足）；0.0473 对应的是 (27,6)。
// 一个声称"通过精确二项分布验证"的数字，本身是错的。
//
// ## 这一层的定位
//
// 它**不拒绝**任何东西（兜底的意义是"总得交出点东西"）。它把最终正文里的违规
// 逐条报出来，让它们落进交付附录的**已知缺陷表**——读者看得见，而不是被蒙在鼓里。
// 判据与产线链**同一套函数**（不另写一份），只是输入换成渲染后的正文。

/** 渲染后正文里，章标题 → 契约键的对应。 */
const CHAPTER_KEY_OF_TITLE: ReadonlyArray<{ readonly title: string; readonly key: string }> = [
  { title: '问题重述', key: 'restatement' },
  { title: '问题分析', key: 'analysis' },
  { title: '结果对比与校核', key: 'results' },
  { title: '模型评价与推广', key: 'evaluation' },
  { title: '参考文献', key: 'references' },
  { title: '核心代码', key: 'code' },
  { title: '代码附录', key: 'code' },
]

/**
 * 把渲染后的论文正文按 `## ` 章标题切开，映射成契约读得懂的伪 narrative。
 *
 * 标题形态是 `## 6 问题1：最小样本量与拒收临界值` 这类（序号前缀 + 自由标题），
 * 所以先剥掉 `## `、序号与空白，再按**前缀**匹配已知章名。逐问章（`问题1：…`）
 * 不进映射——它们由 `perQuestion` 的逐问覆盖判据负责，那一条读的是 analysis。
 *
 * @param markdown - 渲染后的论文正文。
 * @returns 章键 → 该章正文（未出现的章不出现）。
 */
export function chaptersOfPaper(markdown: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = markdown.split('\n')
  let currentKey: string | null = null
  let buffer: string[] = []
  const flush = (): void => {
    if (currentKey === null) return
    // 同一章名出现两次时**追加**而不是覆盖：取并集才不会因为拆章形态变化而漏判。
    out[currentKey] = (out[currentKey] === undefined ? '' : `${out[currentKey]}\n`) + buffer.join('\n')
  }
  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading !== null) {
      flush()
      buffer = []
      const stripped = (heading[1] ?? '').replace(/^[0-9]+[.、\s]*/, '').trim()
      const hit = CHAPTER_KEY_OF_TITLE.find(c => stripped.startsWith(c.title))
      currentKey = hit === undefined ? null : hit.key
      continue
    }
    if (currentKey !== null) buffer.push(line)
  }
  flush()
  return out
}

/**
 * 对**渲染后的正文**跑同一套正文契约。
 *
 * 与 `proseContractViolations` 共用规则实现（先拆章成伪 narrative，再委托），
 * 因此两条路径的判据不可能漂移。
 *
 * @param markdown - 渲染后的论文正文。
 * @param requirements - 题面的 REQUIRED_OUTPUT 清单。
 * @returns 违规清单（章键、标题、原因）。
 */
export function proseContractViolationsOfText(
  markdown: string,
  requirements: ReadonlyArray<ContractRequirement>,
): ReadonlyArray<ProseContractViolation> {
  const narrative = chaptersOfPaper(markdown)
  return [...proseContractViolations(narrative, requirements), ...substanceViolations(narrative, requirements)]
}

/**
 * 正文里的数字字面量普查（**不含**代码块与 `{<result_id>}` 占位符）。
 *
 * ## 它存在的理由：区分"看起来验证过"与"真的验证过"
 *
 * 兜底路径（B-e1-direct）的数字来自模型的自由分析，**没有一次代码通道验证**。
 * 但交付稿会写"通过精确二项分布验证"这种句子——strict-11 就是这么写的，而且
 * 那个"验证结果"本身是错的。DEGRADED 横幅是稿子级标注，读者滑到第 7 章时早就
 * 忘了它；这一层给出**逐稿的数字暴露量**，落进已知缺陷表，让"本稿有 N 个数字、
 * 一个都没验证"成为一条可读的事实，而不是一句抬头。
 *
 * 代码块要排除：那是模型写的程序，里面的数字是**源码**，不是结论。
 * `{<result_id>}` 占位符要排除：那是零数字通道的合法形态，不是数字。
 *
 * @param markdown - 渲染后的论文正文。
 * @returns 数字字面量个数（仅正文，不含代码块与占位符）。
 */
export function numericClaimCensus(markdown: string): number {
  let inFence = false
  let total = 0
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    // 去掉 `{...}` 占位符（零数字通道的合法形态）后再数。
    const withoutPlaceholders = line.replace(/\{[^{}]*\}/g, ' ')
    const matches = withoutPlaceholders.match(/(?<![A-Za-z^])[-+]?(?:\d+\.?\d*|\.\d+)(?![A-Za-z])/g)
    if (matches !== null) total += matches.length
  }
  return total
}
