/**
 * W8.12 — the E1 direct delivery path ("E1 直通交付", Wave-3 audit §四).
 *
 * 事故（Wave-3 审计的核心发现）：fail-soft 的 `MARKED` 保护评估的是**评审循环
 * 结束后的文本**，而 E2 规范化失败发生在**更早的 EXECUTE 生产节点**——重试耗尽
 * 后直接 `gate-failed`，**根本走不到 `gradeDelivery`**。于是 E1 的成果（模型
 * 已反复证明的能力：W8.8 run#4 自主指出方法族方向、W8.11 run-1 产出 19665
 * 字符的结构化分析）被整个丢弃，用户拿到零。
 *
 * **墙挪了位置，但还是同一堵墙**：交付的前提不是"E1 写得好"，而是"E2 形式化
 * 成功"。E2 把"精确记账"变成了比"基础写作"更硬的门槛。
 *
 * 修法（把 E2 从交付前提降级为增强项）：
 *   E2 成功 → IR 生产 → 全链路验证 → CLEAN / MARKED（现状，不动）
 *   E2 失败（重试耗尽）→ E1 满足 contentExists → 渲染 E1 直通稿 → 交付 MARKED
 *   E1 也为空 → 才是真正的零内容 → BLOCKED
 *
 * **为什么不违背红线 N18**（不得为让 fidelity 通过而放宽判定）：fidelity 门
 * **一条都没动**——它照常运行、照常拒绝不合格容器、findings 照常上审计轨迹。
 * 改变的是**这些 findings 的去向**：从"终结运行"变为"进 MARKED 附录"。这正是
 * PRD v2 §3.3 的原话："门不再决定'是否交付'，而是决定'交付时标注什么'"。
 * fail-soft 的精神是**诚实标注**，而本路径的附录比任何 CLEAN 稿都更诚实。
 *
 * **为什么不违背红线 N10/N6**：附录逐字写明"未经规范化 IR 验证；数字、引用、
 * 图表未逐条溯源"。交付物自我声明它是素材不是成品。
 *
 * 判定实验（W8.12 §七，`artifacts/handoff/W8.12/experiment-e1-render.mts`）：
 * 用 B2 落盘的真实 E1 全文（19665 字符）渲染 → 21099 字符、10 章节全在、
 * 16 条假设入表、仅 3/10 占位符——摘要有具体数字（n=29,c=6；期望利润 20.78
 * 元/件），模型节有完整 LaTeX 推导。**E1 的成果是真实的。**
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/e1-direct
 */

import { renderPaperSkeleton } from './paper-skeleton.ts'
import { parseE1Anchors } from './e1-e2.ts'
import { frameworkOf, perQuestionChaptersOf } from './per-question.ts'

/**
 * Why the normalized path failed — verbatim from the audit trail, so the
 * delivered appendix quotes the store's own reason rather than a paraphrase.
 */
export interface E1DirectInput {
  /** E1's full analysis (the text the fidelity gate judged). */
  readonly e1Text: string
  /** Paper title. */
  readonly title: string
  /** The terminal reason the container path failed (verbatim). */
  readonly failureReason: string
  /** Fidelity rules that failed on the last attempt (rule names). */
  readonly failedRules: ReadonlyArray<string>
  /** The gate that refused (`ir_producer`). */
  readonly gate: string
  /**
   * The run's REQUIRED_OUTPUTs, when the caller has them.
   *
   * With them, the draft is assembled into the **reference form** — a framework
   * chapter plus one chapter per sub-problem (see `per-question.ts`), exactly as
   * the produce-chain path renders it. Without them the draft falls back to the
   * flat skeleton, because inventing question boundaries would be worse than
   * delivering one long analysis chapter.
   */
  readonly requirements?: ReadonlyArray<{ readonly requirementId: string; readonly statement: string }>
}

/** The rendered draft plus the counts a caller needs for its audit entry. */
export interface E1DirectDraft {
  readonly markdown: string
  /** Assumptions extracted from E1's own `[[ASSUMPTION: id]]` anchors. */
  readonly assumptionsCount: number
  /** Whether E1 carries any `[[REQUIREMENT: id]]` anchors at all. */
  readonly requirementAnchors: number
  /** How many per-problem chapters the draft actually rendered. */
  readonly problemChapters: number
}

/**
 * Render the E1 analysis into the closed 10-section skeleton.
 *
 * 结构容错（**不依赖 E1 的标题形态**）：E1 的内部结构随运行方差很大
 * （W8.11 实测 4299–19665 字符，标题层级不一致），故本函数只做**有把握**的
 * 三件事，其余全部交给骨架的占位符——占位符是诚实的（"模型待写入"），
 * 猜错的结构才是撒谎：
 *
 *   1. **模型建立与求解** ← E1 全文（它就是建模分析，这是它的家）
 *   2. **模型假设** ← 从 `[[ASSUMPTION: id]]` 行解析出的表（B3 的锚点语法
 *      正是为此设计的，逐字可查）
 *   3. **摘要** ← 一段**如实**的说明 + E1 若有"汇总/结论"性质的末节则附上
 *
 * @param input - E1 text, title, and the verbatim failure facts.
 */
export function renderE1DirectDraft(input: E1DirectInput): E1DirectDraft {
  const anchors = parseE1Anchors(input.e1Text)
  const assumptions = anchors.assumptions.map((a) => {
    // The anchor line is `[[ASSUMPTION: id]] sentence…` — the sentence after
    // the marker is the assumption statement E1 wrote.
    const lineStart = input.e1Text.lastIndexOf('\n', a.at) + 1
    const line = input.e1Text.slice(lineStart, input.e1Text.indexOf('\n', a.at) < 0 ? undefined : input.e1Text.indexOf('\n', a.at))
    const statement = line.replace(/\[\[ASSUMPTION:\s*[^\]]*\]\]\s*/, '').trim()
    return { id: a.id, columns: [a.id, statement.slice(0, 120) || '（见模型建立与求解节）', '未评定', '未检验'] }
  })

  // 摘要只放**无数字**的说明：引擎原文里的拒绝理由本身带数字（"只有 1076 字"），
  // 抄进摘要会被数字门当成"结论面出现不属于任何 Result 的数字"。原文逐字引用放在
  // 交付附录里（那里是标注区，本来就承载门禁原文）。
  // 刻意**不用 markdown 的 `>` 与 `**`**：pandoc 的强调解析在 `**` 紧邻中日韩字符
  // 时会失败——一次真实 PDF 导出实测：这段抬头原样出现在交付的 PDF 里（字面的
  // `>` 与星号）。交付说明是**生成物**，它的形态必须在每一种下游渲染器里都成立。
  const note = [
    '【交付说明（诚实标注）】本稿由模型的建模分析（E1）直接生成——',
    '结构化规范化（E2）未通过，故未经规范 IR 验证：数字、引用、图表均未逐条溯源。',
    '未通过的保真检查与引擎原文见文末「交付标注」附录。请把它当作素材而不是成品。',
  ].join('\n')

  // W11.5 round-7（对齐参照物）：能拆就拆成"框架章 + 每问一章"，拆不动才退回
  // 扁平骨架。两条交付路径因此呈现**同一形态**——兜底稿不再是一整章流水账。
  const requirements = input.requirements ?? []
  const problemChapters = perQuestionChaptersOf(input.e1Text, requirements)
  const framework = frameworkOf(input.e1Text)
  // 拆出逐问章后，"模型建立与求解"节只放**统一框架**（假设、符号、方法），
  // 否则每问的分析会在正文里出现两遍。没有框架段时退回全文，宁可重复不丢内容。
  const modelSlot = problemChapters.length > 0 && framework !== '' ? framework : input.e1Text

  // W11.5 baseline-r9（真实运行实测）: 兜底稿的"空章"此前渲染成机器占位
  // `_(模型待写入)_`——Word 导出的 no_placeholders 门因此拒绝导出（6 处占位），
  // PDF 里则是六段机器占位符。占位符不是内容，**说明为什么缺**才是。所以每个
  // 没产出的章都写一句如实的说明（这一章由谁产出、为什么没有、读者该注意什么），
  // 并且不假装它是论文的一部分。
  const absent = (what: string): string =>
    `本稿没有${what}：这一章由结构化规范化（E2）产出的容器提供，本次规范化未通过，`
    + '因此没有可交付内容。本稿只是模型的建模分析（E1）本身，其中的数字、引用与结论'
    + '均未经运行验证，请勿直接引用；失败原因与未通过的保真检查见文末「交付标注」附录。'
  const markdown = renderPaperSkeleton({
    title: input.title,
    assumptions,
    problemChapters,
    slots: {
      // 摘要：E1 没有摘要（它是对自己写的分析笔记）。诚实说明 + 指向正文。
      abstract: note,
      // 模型建立与求解：统一框架段（拆章成功时）或 E1 全文（拆不动时）。
      model: modelSlot,
      // 问题分析：逐问分析已经逐问成章（见下文各「问题N」章），本节不重复。
      analysis: problemChapters.length > 0
        ? '逐问分析已按子问题逐章给出（见下文各「问题N」章）：每一章给出该问的建模思路、方法族判断与难点。'
        : absent('问题分析'),
      // 问题重述：E1 是对自己写的工作笔记，没有"重述"这一节；把题面要求如实指出来。
      restatement: '本稿的问题重述由模型在结构化产出中给出，本次未产出；请对照题目原文阅读下文各「问题N」章的分析。',
      results: absent('结果对比与校核'),
      evaluation: absent('模型评价与推广'),
      references: absent('参考文献'),
      code: absent('代码附录'),
    },
  })

  return {
    markdown,
    assumptionsCount: assumptions.length,
    requirementAnchors: anchors.requirements.length,
    problemChapters: problemChapters.length,
  }
}
