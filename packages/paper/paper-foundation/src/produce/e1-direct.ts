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
}

/** The rendered draft plus the counts a caller needs for its audit entry. */
export interface E1DirectDraft {
  readonly markdown: string
  /** Assumptions extracted from E1's own `[[ASSUMPTION: id]]` anchors. */
  readonly assumptionsCount: number
  /** Whether E1 carries any `[[REQUIREMENT: id]]` anchors at all. */
  readonly requirementAnchors: number
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

  const note = [
    '> **交付说明（诚实标注）**：本稿由模型的建模分析（E1）直接生成——',
    '> 结构化规范化（E2）未通过，故**未经规范 IR 验证**：数字、引用、图表',
    `> 均未逐条溯源。失败原因（引擎原文）：${input.failureReason}`,
    input.failedRules.length > 0 ? `> 未通过的保真检查：${input.failedRules.join('、')}。` : '',
    '> 请把它当作**素材**而不是成品。',
  ].filter(l => l.length > 0).join('\n')

  const markdown = renderPaperSkeleton({
    title: input.title,
    assumptions,
    slots: {
      // 摘要：E1 没有摘要（它是对自己写的分析笔记）。诚实说明 + 指向正文。
      abstract: note,
      // 模型建立与求解：E1 的全文就是建模分析——原样放入，不加工。
      model: input.e1Text,
    },
  })

  return {
    markdown,
    assumptionsCount: assumptions.length,
    requirementAnchors: anchors.requirements.length,
  }
}
