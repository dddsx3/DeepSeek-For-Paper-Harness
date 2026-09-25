/**
 * 数学建模语境的**结构保持压缩** —— 给阶段简报的上游内联减重。
 *
 * ## 为什么不能套用常用的压缩/摘要
 *
 * 用户的判断（也是 2024B 实验的教训）：max-tokens 是常见且长期存在的问题，
 * 需要优质的上下文压缩；但**数学建模的语境下不能直接套用常用的压缩算法**——
 * 一段题面/上游产物里，信息密度极不均匀：
 *
 * - **一个数字就是一条硬约束**（"次品率不超过 10%"、"至少 95% 的置信水平"），
 *   压掉一位小数或一个下标，整条链的数就全错了；
 * - **锚点行是机器契约**（`[[ASSUMPTION: A-X]]`、`[[REQUIREMENT: R-Q1]]`、
 *   `FIGURE_MANIFEST` 条目、图名、文件名、result_id）——下游按字面对账；
 * - **代码块是可执行语义**——摘要它等于改程序；
 * - 反倒是**大段解释性散文**（背景铺垫、叙事、重复的表格说明）压缩后几乎无损失。
 *
 * 通用压缩/LLM 摘要对这种不均匀性不设防：前者等权处理所有字节，后者可能
 * "流畅地"改写一个数字。所以本模块的压缩是**抽取式且带保护清单**的：
 *
 * 1. **先扫保护对象**（数字与单位、锚点行、标题行、表格行、代码围栏、
 *    清单条目、标识符），把它们的行整体保留；
 * 2. 只对**纯散文行**做删减（保留每段前若干句——首句通常是主题句）；
 * 3. 压缩结果**可机检**：`compressionLosses()` 为空 = 原文的每个数字、
 *    每条锚点、每个围栏都逐字保留；
 * 4. **确定性**：纯函数、无模型调用、无时钟——同一输入永远同一输出。
 *
 * ## 什么时候压
 *
 * 只在**超出内联预算**时压（`shouldCompress`），逐级放宽保留率直到进入预算。
 * 没超预算的原文原样传递——压缩本身也有风险，能不压就不压；压不进预算就
 * 如实超（**不静默丢保护对象**，那是比超预算更糟的失败）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/context-compression
 */

/** 保护对象的类别（进报告，让"保了什么"可回答）。 */
export type ProtectedKind = 'anchor' | 'number' | 'heading' | 'table' | 'fence' | 'manifest' | 'identifier'

/** 压缩报告（进简报与审计——压了多少、保了什么，要可回答）。 */
export interface CompressionReport {
  readonly originalChars: number
  readonly compressedChars: number
  readonly keptLines: number
  readonly droppedLines: number
  /** 逐字保留的保护行计数（按类）。 */
  readonly protectedCounts: Readonly<Record<string, number>>
}

export interface CompressionResult {
  readonly text: string
  readonly report: CompressionReport
}

/** 数学建模语境下的保护判据：这一行整体保留。 */
function classify(line: string): ProtectedKind | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  // 机器锚点（保真门 B3/B4 的锚）
  if (/^\[\[(?:ASSUMPTION|REQUIREMENT|DECISION):/.test(trimmed)) return 'anchor'
  // 清单块标记与清单条目（阶段 1 立、阶段 6/7 对账）
  if (/^<!--\s*(?:BEGIN|END)\s+\w+/.test(trimmed)) return 'manifest'
  if (/^(?:fig_|tikz_)[A-Za-z0-9_]*(?:\|.*)?$/.test(trimmed)) return 'manifest'
  // 标题行（逐问结构/章节结构的骨架）
  if (/^#{1,6}\s/.test(trimmed) || /^(?:问题|第)\s*[0-9]+/.test(trimmed)) return 'heading'
  // 表格行（数字密度最高、错一处全表作废）
  if (/^\s*\|.*\|\s*$/.test(line)) return 'table'
  // 代码围栏行（可执行语义，摘要等于改程序）
  if (/^\s*(?:`{3,}|~{3,})/.test(line)) return 'fence'
  // 含数字与单位的行（题面给定值/硬约束："不超过 10%"、"95% 置信"）
  if (/\d+(?:\.\d+)?\s*(?:%|元|个|件|台|次|米|厘米|毫米|公斤|千克|克|吨|小时|分钟|秒|天|月|年|kg|m|cm|mm|h|min|s|d)/i.test(trimmed)) return 'number'
  // 约束句（"必须/不得/至少/不超过"且带数字）
  if (/(?:必须|不得|不能|至少|不超过|不多于|不少于)/.test(trimmed) && /\d/.test(trimmed)) return 'number'
  // 标识符行（result_id / 图名 / 文件名被引用处）
  if (/\b(?:RES|FIG|fig|tikz)[-_][A-Za-z0-9_]+\b/.test(trimmed) && trimmed.length < 200) return 'identifier'
  return null
}

/**
 * 提取**必须逐字保留**的行（含代码围栏内部的全部行）。
 *
 * 代码围栏是特例：围栏一旦打开，内部行全保直到闭合——摘要器最容易犯的错
 * 就是把代码当散文删半句。
 */
function protectedLines(text: string): Map<string, ProtectedKind> {
  const kept = new Map<string, ProtectedKind>()
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      kept.set(line, 'fence')
      continue
    }
    if (inFence) {
      kept.set(line, 'fence')
      continue
    }
    const kind = classify(line)
    if (kind !== null) kept.set(line, kind)
  }
  return kept
}

/** 原文里的数字面量多重集（压缩后必须一个不少——"数不能丢"的机械判据）。 */
export function numbersOf(text: string): ReadonlySet<string> {
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? [])
}

/**
 * 压缩一份上游产物到**目标字符数以内**（抽取式，逐级放宽保留率）。
 *
 * @param text - 原文。
 * @param budgetChars - 目标字符数。
 * @returns 压缩结果（含报告）；压不进预算时如实超，**不丢保护对象**。
 */
export function compressForModeling(text: string, budgetChars: number): CompressionResult {
  const originalChars = text.length
  // 已在预算内 → 原样返回（压缩本身也有风险：能不压就不压）。
  // 这条在调用方（shouldCompress）之外再加一道——模块自己就是幂等且保守的。
  if (text.length <= budgetChars) {
    return {
      text,
      report: { originalChars, compressedChars: text.length, keptLines: 0, droppedLines: 0, protectedCounts: {} },
    }
  }
  const protectedMap = protectedLines(text)
  const lines = text.split('\n')

  const build = (maxSentences: number): string => {
    const out: string[] = []
    let inFence = false
    for (const line of lines) {
      if (/^\s*(?:`{3,}|~{3,})/.test(line)) inFence = !inFence
      if (inFence || protectedMap.has(line)) {
        out.push(line)
        continue
      }
      if (line.trim() === '') {
        out.push(line)
        continue
      }
      // 纯散文行：保留前 maxSentences 句（句读切分；数字行已被保护，不会走到这）
      const sentences = line.split(/(?<=[。；.!?！？])/).filter(x => x.trim() !== '')
      const keptText = sentences.slice(0, Math.max(1, maxSentences)).join('')
      out.push(keptText === line ? line : `${keptText}……（已压缩）`)
    }
    return out.join('\n')
  }

  const ladder = [1, 2, 3, 4, 8]
  let best = build(ladder[ladder.length - 1] ?? 1)
  for (const maxSentences of ladder) {
    best = build(maxSentences)
    if (best.length <= budgetChars) break
  }

  // 验证而不是相信：构造若违例（丢了保护对象），退回原文并如实报告"压不动"。
  const losses = compressionLosses(text, best)
  if (losses.length > 0) {
    return {
      text,
      report: { originalChars, compressedChars: text.length, keptLines: 0, droppedLines: 0, protectedCounts: {} },
    }
  }

  const compressedChars = best.length
  const keptLines = best.split('\n').filter(x => x.trim() !== '').length
  const droppedLines = lines.filter(x => x.trim() !== '').length - keptLines
  const protectedCounts: Record<string, number> = {}
  for (const kind of protectedMap.values()) protectedCounts[kind] = (protectedCounts[kind] ?? 0) + 1
  return {
    text: best,
    report: { originalChars, compressedChars, keptLines, droppedLines, protectedCounts },
  }
}

/**
 * 压缩**丢了什么** —— "数学建模语境不能丢重要信息"的机械判据。
 *
 * 三类受保护对象，压缩前后必须逐字守恒：
 * 1. **每个数字面量**（多重集比较——原文两个 "10" 压后剩一个也是丢）；
 * 2. **每条机器锚点/清单标记**（下游按字面对账）；
 * 3. **每个代码围栏**（开闭不成对 = 代码被截断）。
 *
 * @returns 丢失清单（空 = 没丢任何受保护对象）。
 */
export function compressionLosses(original: string, compressed: string): ReadonlyArray<string> {
  const losses: string[] = []
  const count = (t: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (const n of t.match(/\d+(?:\.\d+)?/g) ?? []) m.set(n, (m.get(n) ?? 0) + 1)
    return m
  }
  const before = count(original)
  const after = count(compressed)
  for (const [num, n] of before) {
    const kept = after.get(num) ?? 0
    if (kept < n) losses.push(`数字 ${num} 丢了 ${String(n - kept)} 处`)
  }
  for (const m of original.matchAll(/^\[\[(?:ASSUMPTION|REQUIREMENT|DECISION):.*$/gm)) {
    if (!compressed.includes(m[0])) losses.push(`锚点丢失：${(m[0] ?? '').slice(0, 40)}`)
  }
  for (const m of original.matchAll(/^<!--\s*(?:BEGIN|END)\s+\w+.*$/gm)) {
    if (!compressed.includes(m[0])) losses.push(`清单标记丢失：${(m[0] ?? '').slice(0, 40)}`)
  }
  const fences = (t: string): number => (t.match(/^\s*(?:`{3,}|~{3,})/gm) ?? []).length
  if (fences(compressed) < fences(original)) losses.push('代码围栏丢失（开闭不成对）')
  return losses
}

/**
 * 该不该压：只有**超过预算**才压。
 *
 * @param text - 待内联的原文。
 * @param budgetChars - 预算。
 */
export function shouldCompress(text: string, budgetChars: number): boolean {
  return text.length > budgetChars
}
