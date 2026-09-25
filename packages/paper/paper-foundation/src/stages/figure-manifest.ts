/**
 * `FIGURE_MANIFEST` 的机器可读形态 —— 阶段 1 立约、阶段 4/5 对账的**同一个解析器**。
 *
 * ## 为什么要有这个模块（而不是各阶段自己 `split('\n')`）
 *
 * 参考工作流把图清单夹在一对 HTML 注释之间：
 *
 * ```
 * <!-- BEGIN FIGURE_MANIFEST -->
 * DATA=20
 * fig_q1_profiles
 * …
 * DRAWIO=1
 * fig_roadmap
 * TIKZ=3
 * tikz_geometry_bc
 * …
 * GPTIMG=0
 * ALL=24
 * <!-- END FIGURE_MANIFEST -->
 * ```
 *
 * `DATA=20` 这类行是**段头**（大写键 = 该段的条目数），后面跟的是条目名。
 * 阶段 4 只对账数据图段，阶段 5 只对账 HTML/DrawIO 段——**两边必须按同一套规则
 * 切段**，否则"哪张图归谁"会在两个阶段里得到两个答案。
 *
 * ## 两种写法都收（参考的段头式 + 简报示例的列表式）
 *
 * 简报里给模型的示例是 `- fig_a` 这种列表式，参考工作流用的是段头式。解析器**两种都收**
 * ——只收一种就会出现"按简报写的清单被解析器当成空清单"，那是最难查的一类对账失败。
 *
 * ## 解析器不做判断，只做切分
 *
 * 段头声明的数量（`DATA=20`）与实际条目数**不一致**时，解析器**不报错**：那是
 * 门禁的判据（`figure_manifest_anchors` 已经在阶段 1 管锚点与命名），不是解析器的职责。
 * 解析器报错会让"清单写错了"变成"整个阶段跑不动"，而正确处置是**如实上报数量不符**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/figure-manifest
 */

/** 清单里的一个条目（名字 + 它属于哪一段）。 */
export interface ManifestEntry {
  /** 图名（`fig_*` / `tikz_*`）。 */
  readonly name: string
  /** 段头键（`DATA` / `DRAWIO` / `TIKZ` / …）；列表式写法下是 `''`。 */
  readonly section: string
}

/** 解析结果。 */
export interface FigureManifest {
  /** 段 → 条目名（段头声明的顺序即这里的键顺序）。 */
  readonly sections: Readonly<Record<string, ReadonlyArray<string>>>
  /** 段头声明的条目数（段 → N）；列表式写法下是空对象。 */
  readonly declaredCounts: Readonly<Record<string, number>>
  /** 全部条目，按出现顺序。 */
  readonly entries: ReadonlyArray<ManifestEntry>
}

export const MANIFEST_BEGIN = '<!-- BEGIN FIGURE_MANIFEST -->'
export const MANIFEST_END = '<!-- END FIGURE_MANIFEST -->'

/**
 * 数据图的段头键 —— **除了**架构/几何族的那些。
 *
 * 判据是"这张图由谁渲染"：`DRAWIO`（HTML/DrawIO 族）与 `TIKZ`（LaTeX 几何族）
 * 归阶段 5；`GPTIMG`（模型生图）本流程不产出（参考里恒为 0）；`ALL` 是合计，
 * 不是一段。**其余的段都归阶段 4**——包括参考里没出现过的段头，这样新段头
 * 不会因为"解析器不认识"而静默丢图。
 */
export const ARCHITECTURE_SECTIONS: ReadonlySet<string> = new Set(['DRAWIO', 'TIKZ', 'GPTIMG', 'ALL'])

/** 段头行：大写键 = 数量（`DATA=20`）。 */
const SECTION_HEADER = /^([A-Z][A-Z0-9_]*)\s*=\s*(\d+)$/
/**
 * 条目行：`- fig_a` / `fig_a` / **`fig_a|问题1两种信度下…（折线图）`**。
 *
 * 参考工作流的清单条目本来就带题注（`名字|题注`）——2024B 真实运行实测：
 * 阶段 1 写的就是这种形态，而第一版解析器按"整行只有一个名字"匹配，
 * 18 条全部不识别 → 计划侧读到 0 条 → 对账失败。条目的**身份**是 `|` 之前
 * 的那段；后面的题注是给人看的，不进对账键。
 */
const ENTRY_LINE = /^(?:[-*+]?\s*)?([A-Za-z][A-Za-z0-9_]*)(?:\s*[|｜].*)?$/

/**
 * 解析 `PROBLEM_ANALYSIS.md` 里的 `FIGURE_MANIFEST` 块。
 *
 * @param analysisText - 阶段 1 的 `PROBLEM_ANALYSIS.md` 全文。
 * @returns 清单；**锚点不完整或没有清单时返回 `null`**（调用方据此区分"没有清单"
 *   与"清单是空的"——这两件事的处置完全不同）。
 */
export function parseFigureManifest(analysisText: string): FigureManifest | null {
  const begin = analysisText.indexOf(MANIFEST_BEGIN)
  const end = analysisText.indexOf(MANIFEST_END)
  if (begin === -1 || end === -1 || end <= begin) return null
  const block = analysisText.slice(begin + MANIFEST_BEGIN.length, end)

  const sections: Record<string, string[]> = {}
  const declaredCounts: Record<string, number> = {}
  const entries: ManifestEntry[] = []
  let current = ''
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const header = SECTION_HEADER.exec(line)
    if (header !== null) {
      current = header[1] ?? ''
      declaredCounts[current] = Number(header[2] ?? '0')
      sections[current] = sections[current] ?? []
      continue
    }
    const entry = ENTRY_LINE.exec(line)
    if (entry === null) continue // 说明性文字不进清单（清单只装名字）
    const name = entry[1] ?? ''
    const bucket = sections[current] ?? []
    bucket.push(name)
    sections[current] = bucket
    entries.push({ name, section: current })
  }
  return { sections, declaredCounts, entries }
}

/**
 * 数据图段（阶段 4 的对账范围）的全部条目名。
 *
 * @param manifest - 解析结果。
 * @returns 条目名，按出现顺序；**可能为空**（清单里全是架构图时）。
 */
export function dataFigureNames(manifest: FigureManifest): ReadonlyArray<string> {
  return manifest.entries
    .filter(e => !ARCHITECTURE_SECTIONS.has(e.section) && !e.name.startsWith('tikz_'))
    .map(e => e.name)
}

/**
 * 架构图段（阶段 5 的对账范围）的全部条目名。
 *
 * @param manifest - 解析结果。
 * @returns `DRAWIO` 与 `TIKZ` 段的条目名，按出现顺序。
 */
export function architectureFigureNames(manifest: FigureManifest): ReadonlyArray<string> {
  return manifest.entries
    .filter(e => e.section === 'DRAWIO' || e.section === 'TIKZ' || e.name.startsWith('tikz_'))
    .map(e => e.name)
}
