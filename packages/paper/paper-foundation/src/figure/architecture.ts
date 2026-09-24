/**
 * W9-C — the architecture / flow diagram engine (11 阶段第 5 步).
 *
 * 引擎选型（任务书 C1，裁决：**方案 B**）：
 *   A  HTML+CSS → 无头浏览器转图（参考实现做法）—— 最成熟，但引入
 *      Electron/puppeteer 依赖，CI 形状大变（体积/超时/沙箱）。
 *   B  **确定性分层布局（本模块）→ SVG** —— 自研 flex/grid 语义的简化版：
 *      层内等分、层间顺序排列、坐标由布局器计算。保留参考实现选择 HTML 的
 *      理由（自动布局、不写绝对坐标、免疫节点重叠），又不引入浏览器。
 *   C  手写 SVG 坐标 —— 拒绝：把参考实现刻意避开的 80% 难题揽回来。
 *
 * spike 结论（任务书 C1 要求的验证）：`tpl_flow.html` 的结构是
 * 「层 → 行 → 节点」三级嵌套，flex 布局可计算性 = 每层节点等分宽度 +
 * 层间固定间距——这是 O(层数×节点数) 的确定性算术，**不需要通用 CSS 引擎**。
 * 因此 B 成立。spike 证据：本模块的 `computeArchitectureLayout` 即该算术。
 *
 * 移植的六组机制（任务书 C4 表，全部落地为**代码或检查**而非注释）：
 *   C4-1 确定性种子（seed → H0/TONE/LAYOUT；禁随机数/时间戳）
 *   C4-2 风格族 A 朴素竞赛风 / C 纯黑白线稿
 *   C4-3 去全彩 AI 感（节点黑白灰；色相只给焦点/语义连线；彩色 ≤15%）
 *   C4-4 反空壳检查（万能词节点 = 返工）
 *   C4-5 不做结果展示（节点里禁止具体结果数值）
 *   C4-6 对齐硬纪律 + 可测量（data-mh-row + 中轴极差 >4px 即 FAIL）
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure/architecture
 */

import { sha256Hex } from '../ir/evidence-freeze.ts'

/** One node in the diagram: a short label (数据锚点级，不是句子). */
export interface ArchNode {
  readonly id: string
  readonly label: string
  /** Optional one-line subtitle (B 风格族才渲染；A/C 忽略). */
  readonly subtitle?: string
}

/** One horizontal layer of the diagram (渲染为等宽节点排). */
export interface ArchLayer {
  readonly label?: string
  readonly nodes: ReadonlyArray<ArchNode>
}

/** One edge: from node id → to node id. */
export interface ArchEdge {
  readonly from: string
  readonly to: string
  readonly label?: string
  /** 'decision' edges may carry the focus colour (C4-3 语义连线例外). */
  readonly kind?: 'flow' | 'decision'
}

/** The architecture diagram input. Everything comes from real IR objects
 *  (C3): the caller maps ModelSpec/EquationSpec/RequirementSpec → nodes.
 *  禁止硬编码图内容（N23）。 */
export interface ArchInput {
  readonly seed: string
  readonly style_family: 'A' | 'B' | 'C'
  readonly layers: ReadonlyArray<ArchLayer>
  readonly edges: ReadonlyArray<ArchEdge>
  readonly direction?: 'horizontal' | 'vertical'
}

/** The computed layout (exposed for the alignment self-check, C4-6). */
export interface ArchLayout {
  readonly nodeRects: ReadonlyArray<{
    readonly id: string
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
    /** The layer index — data-mh-row in the emitted SVG. */
    readonly row: number
  }>
  readonly width: number
  readonly height: number
  /** horizontal = 层从左到右展开，同层节点垂直堆叠（对齐不变量 = 同 x）；
   *  vertical = 层从上到下，同层节点水平排列（对齐不变量 = 同 y）。 */
  readonly direction: 'horizontal' | 'vertical'
}

/** 派生种子 → 确定性参数（C4-1：同篇统一、异篇不同、断线重跑可复现）。 */
export function deriveArchParams(seed: string): {
  hue: number
  tone: 'light' | 'mid'
  corner: number
} {
  const h = sha256Hex(seed)
  return {
    hue: parseInt(h.slice(0, 4), 16) % 360,
    tone: parseInt(h.slice(4, 6), 16) % 2 === 0 ? 'light' : 'mid',
    corner: [0, 2, 4][parseInt(h.slice(6, 8), 16) % 3] ?? 0,
  }
}

const GENERIC_SHELL_WORDS = [
  '数据采集', '数据预处理', '建立模型', '模型求解', '结果分析',
  '数据收集', '模型建立', '求解', '分析结果', '得出结论',
]

/**
 * C4-4 反空壳检查：抄下所有节点文字，遮住题目，问"能认出这是哪类课题、
 * 哪个方法吗？"——每个节点都命中万能词列表 = 通用空壳，返工。
 *
 * @param layers - the diagram layers.
 * @returns the offending node labels (empty = pass).
 */
export function assertNotGenericShell(
  layers: ReadonlyArray<ArchLayer>,
): ReadonlyArray<string> {
  const offenders: string[] = []
  for (const layer of layers) {
    for (const node of layer.nodes) {
      const bare = node.label.trim()
      if (GENERIC_SHELL_WORDS.includes(bare)) offenders.push(node.label)
    }
  }
  // 全部命中才算空壳（个别通用步骤 + 具体步骤混合是正常的）
  const total = layers.reduce((n, l) => n + l.nodes.length, 0)
  return offenders.length === total && total > 0 ? offenders : []
}

/**
 * C4-5 不做结果展示：流程节点**不写具体结果数值**（`t*=412.473838 s` ❌）。
 * 收敛精度/迭代上限等**方法参数**可留。判据：多于一处"数字.数字"形态即
 * 视为结果值（方法参数通常是单个整数如 "1e-6" / "最多100轮"）。
 *
 * @param layers - the diagram layers.
 * @returns the offending node labels (empty = pass).
 */
export function assertNoResultValues(
  layers: ReadonlyArray<ArchLayer>,
): ReadonlyArray<string> {
  const offenders: string[] = []
  for (const layer of layers) {
    for (const node of layer.nodes) {
      const decimals = node.label.match(/\d+\.\d+/g) ?? []
      if (decimals.length > 0) offenders.push(node.label)
    }
  }
  return offenders
}

/**
 * C4-6 对齐硬纪律的可测量形态：同一层的节点，y 中轴极差必须 ≤4px。
 * 本布局器按构造对齐（层内同 y），但检查是**真实的**——对手工构造的错位
 * 输入它必须红（见 spec 的 FAIL 案例）。
 *
 * @param layout - the computed layout.
 * @returns the per-row mid-axis deviation; empty = all aligned.
 */
export function checkArchitectureAlignment(
  layout: ArchLayout,
  tolerancePx = 4,
): ReadonlyArray<{ row: number; deviation: number }> {
  // 对齐不变量取决于方向：horizontal 模式同层节点垂直堆叠 → 不变量是**同 x**；
  // vertical 模式同层节点水平排列 → 不变量是**同 y**。第一版统一查 y——把
  // horizontal 模式的正常堆叠误判成 70px 偏差（spec 首跑抓到的真 bug）。
  const byRow = new Map<number, number[]>()
  for (const rect of layout.nodeRects) {
    const mid = layout.direction === 'horizontal'
      ? rect.x + rect.w / 2
      : rect.y + rect.h / 2
    const list = byRow.get(rect.row) ?? []
    list.push(mid)
    byRow.set(rect.row, list)
  }
  const violations: Array<{ row: number; deviation: number }> = []
  for (const [row, mids] of byRow) {
    if (mids.length < 2) continue
    const deviation = Math.max(...mids) - Math.min(...mids)
    if (deviation > tolerancePx) violations.push({ row, deviation })
  }
  return violations
}

/**
 * Compute the deterministic layered layout.
 *
 * 布局算术：横向为「层从左到右」，每层内部节点等宽等高垂直排列；
 * 同层节点共享中轴（C4-6 按构造满足）。
 *
 * @param input - the diagram input.
 */
export function computeArchitectureLayout(input: ArchInput): ArchLayout {
  const vertical = input.direction === 'vertical'
  const layers = input.layers
  if (layers.length === 0) throw new Error('architecture diagram declares no layers')
  const maxNodes = Math.max(...layers.map(l => l.nodes.length))
  if (maxNodes === 0) throw new Error('architecture diagram has an empty layer')

  const nodeW = vertical ? 220 : 148
  const nodeH = 52
  const gapMain = vertical ? 64 : 40 // 层间距
  const gapCross = vertical ? 36 : 18 // 层内节点间距
  const labelW = 0
  const layersLen = layers.length

  const width = vertical
    ? 60 + maxNodes * (nodeW + gapCross) - gapCross + 60
    : 60 + layersLen * (nodeW + gapMain) - gapMain + 60
  const height = vertical
    ? 50 + layersLen * (nodeH + gapMain) + 50
    : 50 + maxNodes * (nodeH + gapCross) - gapCross + 50

  const rects: Array<{ id: string; x: number; y: number; w: number; h: number; row: number }> = []
  layers.forEach((layer, li) => {
    const count = layer.nodes.length
    // 层内居中：该层总高/总宽对齐画布中轴
    const span = count * nodeH + (count - 1) * gapCross
    const startY = vertical
      // 纵向展开时层是**上下**排的，所以层间距要按节点**高**（nodeH）算。
      // 第一版这里写的是 `nodeW + gapMain`（横向分支的拷贝），于是四层的图最后
      // 一层落在 y=912 而 viewBox 高只有 564——**节点越出画布**。这条一直没被发现，
      // 因为既有的用例都用横向（`direction` 缺省），纵向分支从没被跑过；
      // 阶段 5 的 `diagram_geometry` 第一次跑纵向就撞出来了。
      ? 60 + li * (nodeH + gapMain)
      : 50 + (height - 100 - span) / 2
    const startX = vertical
      ? 60 + (width - 120 - (count * nodeW + (count - 1) * gapCross)) / 2
      : 60 + li * (nodeW + gapMain)
    layer.nodes.forEach((node, ni) => {
      rects.push({
        id: node.id,
        x: vertical ? startX + ni * (nodeW + gapCross) : startX,
        y: vertical ? startY : startY + ni * (nodeH + gapCross),
        w: nodeW,
        h: nodeH,
        row: li,
      })
    })
  })
  void labelW
  void layersLen
  return { nodeRects: rects, width, height, direction: vertical ? 'vertical' as const : 'horizontal' as const }
}

/**
 * Render the architecture diagram to deterministic SVG bytes.
 *
 * C4-2：A 朴素竞赛风（衬线/直角/无副标题）；C 纯黑白线稿（零彩色）。
 * C4-3：节点主体黑白灰；色相只用于①焦点节点（每图一个，seed 选取）
 * ②decision 边；彩色面积占比天然 ≤15%（只有描边/焦点块用色）。
 *
 * @param input - the diagram input.
 */
export function renderArchitectureSvg(input: ArchInput): string {
  const offendersShell = assertNotGenericShell(input.layers)
  if (offendersShell.length > 0) {
    throw new Error(`anti-empty-shell: all ${offendersShell.length} nodes are generic placeholder words (${offendersShell.join('、')}) — the diagram must name THIS problem's method/steps`)
  }
  const offendersValues = assertNoResultValues(input.layers)
  if (offendersValues.length > 0) {
    throw new Error(`no-result-values: nodes must not carry result numbers (${offendersValues.join('、')}) — 结果在交付物正文，不在流程图节点`)
  }
  const layout = computeArchitectureLayout(input)
  const align = checkArchitectureAlignment(layout)
  if (align.length > 0) {
    throw new Error(`alignment self-check FAIL: rows ${align.map(a => `#${a.row} dev=${a.deviation.toFixed(1)}px`).join(', ')} (tolerance 4px)`)
  }

  const params = deriveArchParams(input.seed)
  const family = input.style_family
  const vertical = input.direction === 'vertical'
  const serif = family === 'A'
  const mono = family === 'C'

  // C4-3: the ONE focus node (hue comes from the seed; zero-color in C)
  const allIds = layout.nodeRects.map(r => r.id)
  const focusId = mono ? undefined : allIds[parseInt(sha256Hex(input.seed).slice(8, 12), 16) % allIds.length]
  const focusFill = mono ? undefined : `hsl(${params.hue}, ${params.tone === 'light' ? 30 : 45}%, ${params.tone === 'light' ? 92 : 85}%)`
  const focusStroke = mono ? undefined : `hsl(${params.hue}, 45%, 55%)`

  const rectById = new Map(layout.nodeRects.map(r => [r.id, r]))
  const nodeById = new Map<string, { label: string; subtitle?: string }>()
  for (const layer of input.layers) for (const n of layer.nodes) nodeById.set(n.id, n)

  const parts: string[] = []
  const W = layout.width
  const H = layout.height
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`)
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`)

  const fontFam = serif ? 'Georgia, "Times New Roman", serif' : '"Microsoft YaHei", "PingFang SC", sans-serif'
  const rx = family === 'A' ? 0 : params.corner

  // edges first (under the nodes); orthogonal connectors between layer mid-edges
  for (const edge of input.edges) {
    const from = rectById.get(edge.from)
    const to = rectById.get(edge.to)
    if (from === undefined || to === undefined) {
      throw new Error(`edge references unknown node id: ${edge.from} → ${edge.to}`)
    }
    const x1 = vertical ? from.x + from.w / 2 : from.x + from.w
    const y1 = vertical ? from.y + from.h : from.y + from.h / 2
    const x2 = vertical ? to.x + to.w / 2 : to.x
    const y2 = vertical ? to.y : to.y + to.h / 2
    const midX = (x1 + x2) / 2
    const midY = (y1 + y2) / 2
    const isDecision = edge.kind === 'decision'
    const stroke = mono
      ? '#000000'
      : isDecision
        ? `hsl(${params.hue}, 45%, 55%)`
        : '#888888'
    const d = vertical
      ? `M ${fmtN(x1)} ${fmtN(y1)} L ${fmtN(x1)} ${fmtN(midY)} L ${fmtN(x2)} ${fmtN(midY)} L ${fmtN(x2)} ${fmtN(y2)}`
      : `M ${fmtN(x1)} ${fmtN(y1)} L ${fmtN(midX)} ${fmtN(y1)} L ${fmtN(midX)} ${fmtN(y2)} L ${fmtN(x2)} ${fmtN(y2)}`
    parts.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${isDecision ? 1.6 : 1.1}"${isDecision ? ' stroke-dasharray="none"' : ''} marker-end="url(#arrow)"/>`)
    if (edge.label !== undefined) {
      parts.push(`<text x="${fmtN(midX)}" y="${fmtN(midY - 4)}" text-anchor="middle" font-family="${fontFam}" font-size="10" fill="${mono ? '#000000' : '#666666'}">${escapeXml(edge.label)}</text>`)
    }
  }

  // nodes
  for (const rect of layout.nodeRects) {
    const node = nodeById.get(rect.id)
    if (node === undefined) continue
    const isFocus = rect.id === focusId
    const fill = mono ? '#FFFFFF' : isFocus ? focusFill : '#F5F5F3'
    const stroke = mono ? '#000000' : isFocus ? focusStroke : '#777777'
    const sw = isFocus ? 2 : 1
    // `data-mh-row` = 层号。几何门禁（`diagram_geometry`）**只读 SVG 字节**就能复原
    // "哪些节点同层"，从而复算对齐不变量——判据落在产物上，不靠第二份真相。
    parts.push(`<rect data-mh-row="${String(rect.row)}" x="${fmtN(rect.x)}" y="${fmtN(rect.y)}" width="${rect.w}" height="${rect.h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`)
    const labelSize = 12
    const labelY = rect.y + (node.subtitle !== undefined && family === 'B' ? 22 : rect.h / 2 + 4)
    parts.push(`<text x="${fmtN(rect.x + rect.w / 2)}" y="${fmtN(labelY)}" text-anchor="middle" font-family="${fontFam}" font-size="${labelSize}" font-weight="${mono ? 800 : isFocus ? 600 : 400}" fill="#000000">${escapeXml(node.label)}</text>`)
    if (node.subtitle !== undefined && family === 'B') {
      parts.push(`<text x="${fmtN(rect.x + rect.w / 2)}" y="${fmtN(rect.y + 40)}" text-anchor="middle" font-family="${fontFam}" font-size="10" fill="#555555">${escapeXml(node.subtitle)}</text>`)
    }
  }

  // arrow marker
  parts.push('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#555555"/></marker></defs>')
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}

function fmtN(v: number): string {
  return String(Math.round(v * 100) / 100)
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
