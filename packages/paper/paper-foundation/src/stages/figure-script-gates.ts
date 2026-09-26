/**
 * 作图阶段的门禁 —— **规则照搬参考实现**（`assets/plotting/figure_check.sh` 等）。
 *
 * ## 为什么单独一个模块
 *
 * 作图阶段从"声明驱动"换成了"**模型写 `gen_fig_*.py`**"（用户口径：
 * "单独替换这一步的约束即可"）。原来那条"模型不写渲染代码"是为"数不由模型持有"
 * 设的；换成脚本之后，**溯源改由另一条机制保证**——这正是参考自己的做法：
 *
 * > `SKILL.md` Key Rules：*"Read data from JSON/CSV, do not hardcode values"*
 * > 并由 `facts_audit.py --stage figure` 审"脚本未从 JSON 读数据"。
 *
 * 本仓库把"从 JSON 读"具体化为"**从 harness 铸出的 `results.json` 读**"——
 * 数仍然只来自真实执行，只是经手的人从 harness 换成了模型写的脚本。
 *
 * ## 判据的分寸（照搬参考的取舍，不自己发明）
 *
 * 参考的 `figure_check.sh` 有一条明确纪律：**只让 CRITICAL 进退出码，WARNING/INFO
 * 只提醒**，理由是*"避免因合法风格差异死循环"*。本模块照此办理：
 * - **CRITICAL**（`fail`）：缺 `setup_style`、整图标题、默认蓝/被禁色板、硬编码色 >2 处、
 *   CSS 鲜艳命名色、不读账本、图型与规划不符、figsize 超档位 15%；
 * - **WARNING**（`ok` 但写进 detail）：手动 grid、图例带框、标注过多未防重叠、对数轴跨 >4 量级。
 *
 * 判据的来源逐条标在函数注释里（`figure_check.sh` 的节号），便于与参考对照。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/figure-script-gates
 */

import type { GateInput } from './gates.ts'

/** 一个门禁的判定（与 `gates.ts` 的 `GateVerdict` 同形，避免循环依赖）。 */
export interface ScriptGateVerdict {
  readonly code: 0 | 1 | 2
  readonly items: ReadonlyArray<{ readonly id: string; readonly ok: boolean; readonly detail: string; readonly code: 0 | 1 | 2 }>
}

/** 图型白名单（与 `FIGURE_PLAN.json` 的 `chart_type` 对齐；参考的决策表口径）。 */
export const FIGURE_TYPES = [
  'line', 'scatter', 'bar', 'grouped_bar', 'stacked_bar', 'tornado', 'waterfall',
  'heatmap', 'forest', 'ci_line', 'radar', 'box', 'violin', 'raincloud', 'lollipop',
  'dumbbell', 'pareto', 'contour', 'surface3d', 'residual', 'gantt', 'network',
  'sankey', 'ridge', 'bland_altman', 'km', 'volcano', 'funnel', 'calibration',
  'confusion', 'roc', 'parallel', 'table',
] as const
export type FigureType = (typeof FIGURE_TYPES)[number]

/**
 * 规划图型 → 脚本里**必须出现**的 API（照搬参考 `recipe_audit.py` 的 `TYPE_RULES`）。
 *
 * 参考给这张表写的用途是治一个具体的塌方：
 * > *"规划写等高线、画出来是条形图……图表质量塌方的首要原因不是'不知道该画什么'，
 * > 而是规划里写对了图型、执行时却凭印象退化成 plot/bar/scatter。"*
 *
 * **判不出来一律放行**（参考原话"宁漏不误"）：表里没有的图型不判。
 */
const TYPE_API: Readonly<Record<string, RegExp>> = {
  contour: /\.contourf?\(|tricontour/,
  surface3d: /plot_surface|plot_trisurf|projection\s*=\s*['"]3d['"]/,
  heatmap: /\.imshow\(|\.pcolormesh\(|sns\.heatmap/,
  confusion: /\.imshow\(|\.pcolormesh\(|sns\.heatmap/,
  // 棒棒糖 = 茎线 + 端点圆点；茎线**不一定**用 hlines/barh——参考的配方就是
  // `ax.plot([0, v], [y, y])` + `ax.scatter(v, y)`（实测：只认 hlines/barh 会误杀真棒棒糖）。
  lollipop: /\.hlines\(|\.vlines\(|\.barh\(|\.stem\(|\.scatter\(/,
  dumbbell: /\.hlines\(|\.barh\(|\.scatter\(/,
  tornado: /\.barh\(/,
  waterfall: /\.bar\(|\.barh\(|Rectangle|fill_between/,
  // 森林图的区间线**不一定**用 errorbar/hlines：参考的配方就是
  // `ax.plot([lo, hi], [y, y])` + 两端短竖线当端帽 + `plot(est, y, marker="o")`。
  // 只认 errorbar/hlines 会把**真森林图**判成“退化”（实测踩过，与棒棒糖同一类）。
  forest: /\.errorbar\(|\.hlines\(|\.vlines\(|\.plot\(/,
  violin: /violinplot/,
  raincloud: /violinplot|fill_betweenx|gaussian_kde|\.fill\(/,
  ridge: /fill_between|\.fill\(/,
  sankey: /Sankey|Polygon|PathPatch|\.fill\(/,
  radar: /projection\s*=\s*['"]polar['"]|set_theta/,
  box: /\.boxplot\(|\.bxp\(/,
  pareto: /\.bar\(|twinx/,
  ci_line: /fill_between|errorbar|yerr\s*=/,
  roc: /\.plot\(/,
  parallel: /\.plot\(/,
  bland_altman: /\.scatter\(|axhline|fill_between/,
  km: /\.step\(/,
  volcano: /\.scatter\(|hexbin/,
  funnel: /fill_betweenx|\.scatter\(/,
  calibration: /\.plot\(|hist/,
  gantt: /\.barh\(/,
  network: /networkx|\.plot\(|nx\./,
  gantt_chart: /\.barh\(/,
}

/**
 * 把 `chart_type` **归一化**成白名单里的裸标识符。
 *
 * 实测：模型很自然地把**中文图型名（常带一句说明）**写进 `chart_type`——
 * `'折线图（OC 曲线：x=真实次品率 p，y=接收概率 L(p)）'`、`'哑铃图（两面板对照…）'`。
 * 那不是错，是**表达习惯**；门禁的判据本该是"这张图是什么型"，不是"字段里是不是裸标识符"。
 * 所以这里按"最长名优先"匹配中文/英文图型名，认不出来才返回 null（由门禁具名报错）。
 *
 * 参考的同一处口径也值得记住：*"判不出来一律放行"*（宁漏不误）。
 */
const TYPE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  // 长的在前，避免"柱状图"吃掉"分组柱状图"
  ['分组柱状图', 'grouped_bar'], ['堆叠柱状图', 'stacked_bar'], ['堆叠面积图', 'stacked_bar'],
  ['平行坐标', 'parallel'], ['混淆矩阵', 'confusion'], ['泰勒图', 'radar'],
  ['棒棒糖图', 'lollipop'], ['棒棒糖', 'lollipop'],
  ['哑铃图', 'dumbbell'], ['龙卷风图', 'tornado'], ['瀑布图', 'waterfall'],
  ['森林图', 'forest'], ['山脊图', 'ridge'], ['小提琴图', 'violin'], ['雨云图', 'raincloud'],
  ['箱线图', 'box'], ['箱型图', 'box'], ['热力图', 'heatmap'], ['热图', 'heatmap'],
  ['雷达图', 'radar'], ['帕累托', 'pareto'], ['等高线', 'contour'], ['响应面', 'contour'],
  ['曲面图', 'surface3d'], ['三维曲面', 'surface3d'], ['残差诊断', 'residual'],
  ['甘特图', 'gantt'], ['网络图', 'network'], ['网络结构', 'network'], ['拓扑图', 'network'],
  ['桑基图', 'sankey'], ['校准曲线', 'calibration'],
  // 分区/边界族：参考用 fill_between 划判定域，归到 contour（同属"按阈值分区"的表达）
  ['边界分区', 'contour'], ['判定分区', 'contour'], ['分区图', 'contour'], ['区域划分', 'contour'],
  ['生存曲线', 'km'], ['火山图', 'volcano'], ['漏斗图', 'funnel'], ['三线表', 'table'],
  ['置信带折线', 'ci_line'], ['折线图', 'line'], ['折线', 'line'], ['散点图', 'scatter'],
  ['散点', 'scatter'], ['柱状图', 'bar'], ['条形图', 'bar'], ['饼图', 'bar'],
  // 裸"点图"（点 + 参考线）落在散点族；放在"散点图"之后，避免抢匹配
  ['点图', 'scatter'],
  // 英文别名（含模型可能写的变体）
  ['line chart', 'line'], ['bar chart', 'bar'], ['grouped bar', 'grouped_bar'],
  ['stacked bar', 'stacked_bar'], ['scatter plot', 'scatter'], ['box plot', 'box'],
  ['violin plot', 'violin'], ['forest plot', 'forest'], ['tornado chart', 'tornado'],
  ['waterfall chart', 'waterfall'], ['heat map', 'heatmap'], ['radar chart', 'radar'],
  ['3d surface', 'surface3d'], ['gantt chart', 'gantt'], ['roc curve', 'roc'],
  ['dot plot', 'scatter'], ['decision boundary', 'contour'], ['network diagram', 'network'],
  ['partition', 'contour'],
]

export function normalizeChartType(raw: string): string | null {
  const t = raw.trim()
  const lower = t.toLowerCase()
  if ((FIGURE_TYPES as readonly string[]).includes(lower)) return lower
  for (const [alias, id] of TYPE_ALIASES) {
    if (lower.includes(alias.toLowerCase())) return id
  }
  return null
}

/** 从 `input.files` 里取本阶段的 `gen_fig_*.py` 脚本（按路径排序，确定性）。 */
function figureScripts(input: GateInput): ReadonlyArray<readonly [string, string]> {
  return [...input.files.entries()]
    .filter(([f]) => /^figures\/gen_fig_[A-Za-z0-9_]+\.py$/.test(f))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/** 规划文件（`FIGURE_PLAN.json`）——可能在本阶段目录，也可能在上游。 */
function planRaw(input: GateInput): string | null {
  return input.files.get('FIGURE_PLAN.json') ?? input.upstream.get('FIGURE_PLAN.json') ?? null
}

/** 铸出的账本（`results.json`）——"数从哪来"的唯一来源。 */
function ledgerRaw(input: GateInput): string | null {
  return input.upstream.get('results.json') ?? input.files.get('results.json') ?? null
}

/** 账本里出现过的全部数值字面量（用于判"这个数是不是硬编码进来的"）。 */
function ledgerNumbers(raw: string | null): ReadonlySet<string> {
  const out = new Set<string>()
  if (raw === null) return out
  try {
    const parsed: unknown = JSON.parse(raw)
    const walk = (v: unknown): void => {
      if (typeof v === 'number') out.add(String(v))
      else if (Array.isArray(v)) v.forEach(walk)
      else if (typeof v === 'object' && v !== null) Object.values(v as Record<string, unknown>).forEach(walk)
    }
    walk(parsed)
  } catch {
    /* 账本坏了由别的门禁报 */
  }
  return out
}

/**
 * `figure_plan_valid` —— 规划形态与**取数可解析性**。
 *
 * 参考把"规划"当成合同（*"FIGURE_MANIFEST 是合同，少一张就是违约"*），
 * 并且要求每个数据图都指向真实数据源。本仓库的等价物：
 * `FIGURE_PLAN.json` 的每条 `data_refs` 必须解析到铸出的账本里的 `result_id`。
 */
export function figurePlanValid(input: GateInput): ScriptGateVerdict {
  const id = 'figure_plan_valid'
  const raw = planRaw(input)
  if (raw === null) return { code: 2, items: [{ id, ok: false, detail: 'FIGURE_PLAN.json 不在（本阶段目录与上游都没有）', code: 2 }] }
  let plan: { figures?: unknown }
  try {
    plan = JSON.parse(raw) as { figures?: unknown }
  } catch {
    return { code: 1, items: [{ id, ok: false, detail: 'FIGURE_PLAN.json 不是合法 JSON', code: 1 }] }
  }
  const figures = plan.figures
  if (!Array.isArray(figures) || figures.length === 0) {
    return { code: 1, items: [{ id, ok: false, detail: 'FIGURE_PLAN.json 的 `figures` 必须是非空数组 —— 没有规划就无从对账', code: 1 }] }
  }
  const ledger = ledgerRaw(input)
  const known = new Set<string>()
  /** `result_id → 值的形态`（`scalar`/`series`/`matrix`/`tensor`）。 */
  const shapes = new Map<string, string>()
  if (ledger !== null) {
    try {
      const parsed: unknown = JSON.parse(ledger)
      const list = (parsed as { results?: unknown }).results
      if (Array.isArray(list)) for (const r of list) {
        const row = r as { result_id?: unknown; kind?: unknown; value?: unknown }
        const rid = row.result_id
        if (typeof rid === 'string') {
          known.add(rid)
          // 老账本没有 `kind` 字段 → 就地按值判形态（向后兼容，别让旧产物被判"缺结构"）
          const kind = typeof row.kind === 'string' ? row.kind : shapeOfValue(row.value)
          if (kind !== null) shapes.set(rid, kind)
        }
      }
    } catch { /* 同上 */ }
  }
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [i, f] of figures.entries()) {
    if (typeof f !== 'object' || f === null) { problems.push(`figures[${String(i)}] 不是对象`); continue }
    const o = f as Record<string, unknown>
    const fid = typeof o['figure_id'] === 'string' ? o['figure_id'] : ''
    if (fid === '') { problems.push(`figures[${String(i)}] 缺 figure_id`); continue }
    if (seen.has(fid)) problems.push(`figure_id '${fid}' 重复 —— 重复声明会让后一份静默覆盖前一份`)
    seen.add(fid)
    const ct = o['chart_type']
    // **容忍中文图型名（常带一句说明）**：归一化后再判白名单。
    // 判据是"这张图是什么型"，不是"字段里是不是裸标识符"。
    const norm = typeof ct === 'string' ? normalizeChartType(ct) : null
    if (norm === null) {
      problems.push(`${fid}：chart_type '${String(ct).slice(0, 40)}' 认不出是什么图型 —— `
        + `写白名单里的裸标识符（${FIGURE_TYPES.slice(0, 12).join(' / ')} …），说明放进 \`caption\``)
    }
    const recipe = o['recipe']
    if (typeof recipe !== 'object' || recipe === null) {
      problems.push(`${fid}：缺 \`recipe\`（参考要求"写脚本前必须取配方代码作为起点"，`
        + '格式 `{"category": "competition", "number": 2}`）')
    }
    const refs = o['data_refs']
    if (!Array.isArray(refs) || refs.length === 0) {
      problems.push(`${fid}：data_refs 必须是非空数组 —— 没有数据来源的图是凭空画的`)
    } else if (known.size > 0) {
      const missing = refs.filter(r => typeof r !== 'string' || !known.has(r))
      if (missing.length > 0) {
        problems.push(`${fid}：${String(missing.length)} 个 data_ref 不在铸出的账本里（${missing.slice(0, 3).join('、')}）`
          + '—— 图里的数只能来自真实执行')
      } else if (norm !== null) {
        // **账本里有没有"能画这张图的那种数据"** —— 只查 result_id 存在是不够的。
        //
        // 实测（2024B）：规划了 14 张，交付 7 张，7 张的放弃理由**全是"账本没有那种结构"**
        // （热力图要组合矩阵、灵敏度要扫描序列、蒙特卡洛要样本序列、盈亏平衡要网格）。
        // 而 `data_refs` 当时**每一条都能解析到账本**——因为放弃发生在写脚本时，
        // 规划里引用的都是当时存在的标量。所以"引用解析得到"这一条判据**看不见这个缺陷**。
        // 这里补上形态判据：标量画不出热力图，这是硬事实，不必等它写到一半再放弃。
        const have = refs.map(r => shapes.get(String(r)) ?? 'scalar')
        const need = requiredShapeOf(norm)
        if (need === 'matrix' && !have.some(s => s === 'matrix' || s === 'tensor')) {
          problems.push(`${fid}：图型是 \`${norm}\`（要**矩阵/网格**数据），但 data_refs 里`
            + ` ${String(have.length)} 条账目全是标量/序列 —— 标量画不出热力图。`
            + '请回滚阶段 3 把组合矩阵（如"各候选组合 × 各指标"的二维表）算出来并铸进账本，'
            + '或改型成标量画得出的图（`bar` / `lollipop` / `waterfall` 等）。')
        } else if (need === 'series' && have.every(s => s === 'scalar') && have.length < 3) {
          problems.push(`${fid}：图型是 \`${norm}\`（要**序列**：沿某个参数/时间的多个点），`
            + `但 data_refs 只指向 ${String(have.length)} 个标量 —— 两点连不成曲线，`
            + '硬连会虚构账本里并不存在的趋势（这正是"诚实地放弃"的那一类）。'
            + '请回滚阶段 3 补算参数扫描/时间序列（≥8 个点），或改型成标量画得出的图。')
        }
      }
    }
    for (const k of ['caption', 'x_label', 'y_label'] as const) {
      const v = o[k]
      if (typeof v !== 'string' || v.trim() === '') {
        problems.push(`${fid}：缺 \`${k}\`（参考红线："Both set_xlabel and set_ylabel are mandatory, with units"）`)
      }
    }
  }
  return problems.length === 0
    ? { code: 0, items: [{ id, ok: true, detail: `${String(figures.length)} 条规划：图型合规、配方齐备、data_refs 全部解析到账本`, code: 0 }] }
    : { code: 1, items: [{ id, ok: false, detail: problems.slice(0, 6).join('；'), code: 1 }] }
}

/**
 * `figure_script_quality` —— 代码级 CRITICAL（**照搬参考 `figure_check.sh` 第 1 节**）。
 *
 * 参考只让 CRITICAL 进退出码、WARNING 只提醒，理由是*"避免因合法风格差异死循环"*。
 * 逐条对应（括号里是参考的节号/原话）：
 * - 缺 `setup_style`（#5：*"will use ugly matplotlib defaults"*）；
 * - 整图标题 `plt.title`/`.suptitle`（#4；**子图面板标签 `ax.set_title('(a)')` 合法**，
 *   参考专门写了"不查 ax.set_title"，否则会误杀大量多子图脚本）；
 * - 默认蓝 `#1f77b4`（#7）、`RdYlGn`/`RdBu_r`/`RdBu`（#8–10）、深色主题（#11）；
 * - `color=` 用 CSS 鲜艳命名色（#2）；
 * - 硬编码 hex **>2 处**（#1；≤2 处只 INFO，"允许少量自创协调色作特殊高亮"）；
 * - 缺 `save_fig`/`savefig`（第 3 节 WARNING 提到，但"出不了图"是硬伤，本仓库按 CRITICAL）。
 */
/**
 * 脚本建了几个面板（静态判）。
 *
 * `subplots(a, b)` 取乘积、`add_subplot` 数个数、`GridSpec` 视为多面板。
 * 只在**脚本自己建轴**的意义上判——`plt.subplots()` 无参返回单轴，仍算 1。
 */
function panelCountOf(code: string): number {
  let best = 1
  for (const m of code.matchAll(/subplots\s*\(\s*(\d+)\s*,\s*(\d+)/g)) {
    const n = Number(m[1]) * Number(m[2])
    if (n > best) best = n
  }
  const added = [...code.matchAll(/add_subplot\s*\(/g)].length
  if (added > best) best = added
  if (/GridSpec\s*\(/.test(code)) best = Math.max(best, 2)
  return best
}

/** 脚本是否用了 harness 铺好的共用引导模块。 */
function usesFigbase(code: string): boolean {
  return /from\s+_figbase\s+import|import\s+_figbase/.test(code)
}

/** 就地判值的形态（账本没有 `kind` 字段时的向后兼容路径）。 */
function shapeOfValue(value: unknown): string | null {
  if (typeof value === 'number') return 'scalar'
  if (!Array.isArray(value) || value.length === 0) return null
  // 外层数组算第 1 维，元素从第 2 维起（与 `numericShapeOf` 同一口径——
  // 两处判据不一致时，热力图会在一处被判"缺矩阵"、在另一处蒙混过关）。
  let depth = 1
  const walk = (v: unknown, d: number): boolean => {
    if (typeof v === 'number') return true
    if (Array.isArray(v) && v.length > 0) {
      if (d > depth) depth = d
      return v.every(x => walk(x, d + 1))
    }
    return false
  }
  if (!value.every(v => walk(v, 2))) return null
  return depth >= 3 ? 'tensor' : depth === 2 ? 'matrix' : 'series'
}

/**
 * 图型**最少**需要什么形态的账目数据。
 *
 * 只区分三档，故意保守（判不出来一律按 `scalar` 放行，与参考"宁漏不误"同调）：
 * - `matrix`：整幅面按两个维度铺色的图（热力图 / 等高线 / 曲面 / 混淆矩阵）——
 *   **一个标量画不出来**，这是硬事实；
 * - `series`：沿某个轴展开的图（折线 / 误差棒 / 收敛曲线 / 生存曲线 / ROC）——
 *   至少要有序列，或者 ≥3 个标量；
 * - `scalar`：由若干标量就能成的图（柱 / 棒棒糖 / 瀑布 / 森林 / 哑铃 / 箱线 / 雷达…）。
 */
function requiredShapeOf(chartType: string): 'matrix' | 'series' | 'scalar' {
  if (['heatmap', 'contour', 'surface3d', 'confusion'].includes(chartType)) return 'matrix'
  if (['line', 'ci_line', 'scatter', 'errorbar', 'km', 'roc', 'calibration', 'residual',
    'ridge', 'parallel', 'stacked_bar', 'grouped_bar', 'trend'].includes(chartType)) return 'series'
  return 'scalar'
}

export function figureScriptQuality(input: GateInput): ScriptGateVerdict {
  const id = 'figure_script_quality'
  const scripts = figureScripts(input)
  if (scripts.length === 0) {
    return { code: 2, items: [{ id, ok: false, detail: '本阶段没有 `figures/gen_fig_*.py` —— 没有可审的脚本', code: 2 }] }
  }
  const problems: string[] = []
  const warnings: string[] = []
  for (const [file, code] of scripts) {
    // `_figbase` 在**导入时**就调了 `setup_style()`（那是它存在的意义之一），
    // 所以"用了 _figbase"必须能顶替"脚本里出现 setup_style"——否则会误杀
    // 恰恰是最规范的那批脚本（它们只 `from _figbase import load, save`）。
    const base = usesFigbase(code)
    if (!/setup_style/.test(code) && !base) {
      problems.push(`${file}：缺 \`setup_style()\` —— 会用 matplotlib 默认样式（参考 CRITICAL）`)
    }
    for (const m of code.matchAll(/^\s*(plt\.title|plt\.suptitle|fig\.suptitle)\s*\(/gm)) {
      problems.push(`${file}:${String(code.slice(0, m.index ?? 0).split('\n').length)}：整图标题 \`${m[1] ?? ''}\` —— `
        + '标题只能进 LaTeX caption（子图面板标签用 ax.set_title 合法）')
    }
    for (const bad of ['1f77b4', 'RdYlGn', 'RdBu_r', "RdBu'", 'dark_background', 'darkgrid']) {
      if (code.includes(bad)) problems.push(`${file}：出现被禁的色板/主题 \`${bad}\``)
    }
    for (const m of code.matchAll(/color\s*=\s*['"](?:red|blue|green|orange|purple|brown)['"]/g)) {
      problems.push(`${file}：CSS 鲜艳命名色 \`${m[0]}\` —— 用 \`PALETTE[n]\` / \`COLORS[...]\``)
    }
    // 硬编码 hex：与参考的正则同口径 —— 排除 edgecolor/facecolor/cmap/linecolor
    // （白描边、色图名不是"自创色"），以及出现在 PALETTE/COLORS 附近的。
    const hexes = [...code.matchAll(/color\s*=\s*['"](#[0-9a-fA-F]{3,8})['"]/g)]
      .filter(m => !/edgecolor|facecolor|cmap|linecolor/.test(m[0]))
    if (hexes.length > 2) {
      problems.push(`${file}：硬编码颜色 ${String(hexes.length)} 处（上限 2）—— 绕过 \`PALETTE\` 会造成跨篇撞色`)
    }
    // 落盘判据同样要认 `_figbase.save()`（它内部就是 `save_fig`）；
    // 负向后行断言排除 `np.save(` 这类同名调用。
    if (!/save_fig|savefig|(?<!\.)\bsave\s*\(/.test(code)) {
      problems.push(`${file}：没有 \`save_fig\`/\`savefig\`/\`_figbase.save\` —— 脚本跑完不落盘`)
    }
    if (/ax\.grid\s*\(|plt\.grid\s*\(/.test(code)) warnings.push(`${file}：手动 \`ax.grid()\`（参考 WARNING，非阻断）`)
    if (/frameon\s*=\s*True/.test(code)) warnings.push(`${file}：图例带灰框 \`frameon=True\`（参考 WARNING，显土）`)
  }

  // ── 两条**图集层面**的检查（逐脚本查不出来的那类缺陷）────────────────────
  // 依据是参考的「图表质量跃升清单」：第 1 条讲多 panel 并陈，配套工程习惯讲共用引导模块。
  // 参考把这两条写成**建议**（"图多于 5 张时先建 `_figbase.py`"、"建议而非强制"），
  // 交给执行者自己判断——实测的代价是：本仓库上一轮 11 张图**全是单 panel**、
  // 只有 1 份脚本用了 `_figbase`。契约里写了、却没有任何东西去数它，等于没写。
  if (scripts.length > 5) {
    const noBase = scripts.filter(([, code]) => !usesFigbase(code)).map(([f]) => f)
    if (noBase.length > 0) {
      problems.push(`${String(noBase.length)}/${String(scripts.length)} 个脚本没有 \`from _figbase import\` —— `
        + 'harness 已把 `figures/_figbase.py` 铺好（参考："图多于 5 张时先建共用引导模块"，'
        + '本仓库改成铺好的资产）。不用的脚本各写各的样板，取数口径与缺字替换随之各写各的，'
        + `正是参考担心的"各图指标口径不一致导致论文数字打架"。例如：${noBase.slice(0, 2).join('、')}`)
    }
    // 多面板比例：参考原话"**平庸图的典型特征就是每张都单 panel**"。
    // 阈值取 1/3（不是"全部"）——留出"某张图本就该单画"的正当空间，
    // 只挡住"整本图集一张合成图都没有"这种退化。
    const multi = scripts.filter(([, code]) => panelCountOf(code) >= 2).length
    const need = Math.ceil(scripts.length / 3)
    if (multi < need) {
      problems.push(`多面板合成只有 ${String(multi)}/${String(scripts.length)} 张（要求 ≥${String(need)}，约 1/3）—— `
        + '参考："平庸图的典型特征就是每张都单 panel"。相关的几件事应并进同一张图的 2-4 个 panel'
        + '（分布 + 与上限对照、主结果 + 残差诊断、处理前‖处理后），而不是拆成几张孤图。')
    }
  }

  const tail = warnings.length === 0 ? '' : `；WARNING（不阻断）：${warnings.slice(0, 3).join('；')}`
  return problems.length === 0
    ? { code: 0, items: [{ id, ok: true, detail: `${String(scripts.length)} 个脚本通过代码级 CRITICAL 检查${tail}`, code: 0 }] }
    : { code: 1, items: [{ id, ok: false, detail: problems.slice(0, 6).join('；') + tail, code: 1 }] }
}

/**
 * `figure_script_traced` —— **脚本必须从铸出的账本读数据，不得硬编码**。
 *
 * 这是"数不由模型持有"在脚本方案下的替代机制，也是参考自己的做法：
 * *"Read data from JSON/CSV, do not hardcode values"*（`SKILL.md` Key Rules），
 * 由 `facts_audit.py --stage figure` 审"脚本未从 JSON 读数据"。
 *
 * 两条判据：
 * 1. 脚本必须**引用账本文件**（`results.json`）—— 一个不读账本的画图脚本，
 *    图里的数只能来自模型的手；
 * 2. 脚本里**不得出现成串的数据字面量**（≥3 个带小数的数）——那正是
 *    `facts_audit` 抓的形态（`plt.plot([0,5,10],[1.2,3.4,5.6])`）。
 *    结构性常量（0/1、字号、figsize、alpha、线宽）不在此列。
 */
/**
 * 取出 `openIdx` 处 `(` 的配对实参文本（按括号深度配平）。
 *
 * 为什么不用一条正则了事：`[^)]*` 无法表达"这一层括号内"，多列表实参时
 * 只能靠贪婪回溯命中最后一个列表（见 `figureScriptTraced` 里的注释）。
 * 上限 4000 字符只是防御"括号不配平的畸形脚本"，正常绘图调用远小于此。
 */
function callArgs(code: string, openIdx: number): string {
  let depth = 0
  const stop = Math.min(code.length, openIdx + 4000)
  for (let i = openIdx; i < stop; i++) {
    const ch = code[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return code.slice(openIdx + 1, i)
    }
  }
  return code.slice(openIdx + 1, stop)
}

export function figureScriptTraced(input: GateInput): ScriptGateVerdict {
  const id = 'figure_script_traced'
  const scripts = figureScripts(input)
  if (scripts.length === 0) {
    return { code: 2, items: [{ id, ok: false, detail: '本阶段没有 `figures/gen_fig_*.py` —— 没有可审的脚本', code: 2 }] }
  }
  const ledger = ledgerRaw(input)
  if (ledger === null) {
    return { code: 2, items: [{ id, ok: false, detail: '铸出的账本（results.json）不在 —— 无从判断脚本里的数是否来自它', code: 2 }] }
  }
  const known = ledgerNumbers(ledger)
  const problems: string[] = []
  for (const [file, code] of scripts) {
    if (!/results\.json|results\[|_ledger|load_results/.test(code)) {
      problems.push(`${file}：**没有引用铸出的账本**（\`results.json\`）—— 图里的数只能来自真实执行，`
        + '脚本必须先把它读进来（参考 Key Rules：*"Read data from JSON/CSV, do not hardcode values"*）')
      continue
    }
    // 成串的数据字面量：同一个列表里 ≥3 个带小数的数
    // **只在绘图调用的参数里找数据串** —— 那才是"硬编码的数据"。
    //
    // 判据要窄：宽判据会把版面参数也当成数据（实测踩过两次：`set_xticks([0.6, 0.7, …])`
    // 是刻度，`(-0.28, 0.11, "right", "bottom")` 是标注偏移表）。参考的 `facts_audit`
    // 抓的是同一个形态——`plt.plot([0,5,10],[1.2,3.4,5.6])`：**数据写死在绘图调用里**。
    // 所以只认"绘图函数调用的实参里出现的数值列表"。
    //
    // 但"绘图调用的实参"里仍然混着**结构性关键字**：实测第三次踩到的是
    // `ax.contourf(NN, KK, accept, levels=[-0.5, 0.5, 1.5])`——`levels` 是 0/1 指示场的
    // 分级边界（画在 0 与 1 之间的两条分界线），是**版面**不是数据，
    // 却因为它带小数点被判成"硬编码数据串"，把一份合规脚本拦了下来。
    // 参考的 CRITICAL 清单也只查数据、不查分级/范围/样式参数。故先把这些关键字的
    // 列表实参**抹掉**再找数据串——比"逐个数白名单"更不容易漏。
    const STRUCTURAL_KWARG = /(?:\b(?:levels|vmin|vmax|bins|range|extent|alpha|zorder|linewidth|lw|markersize|ms|markeredgewidth|fontsize|pad|width|height|figsize|dpi|rotation|ncol|nrow|columnspacing|wspace|hspace|aspect|top|bottom|left|right)\s*=\s*)\[[^\[\]]*\]/g
    const scan = code.replace(STRUCTURAL_KWARG, '=[]')
    // 判据落在**该调用括号内的每一个列表**上，而不是"最后一个列表"。
    // 为什么：原先用一条正则一次只捕获一个列表，`[^)]*` 贪婪回溯后命中的是**最后**一个
    // `[...]`。于是 `plot([0,5,10],[1.2,3.4,5.6])` 抓得到（数据在后），
    // 而 `plot([1.2,3.4,5.6],[0,5,10])` 抓不到（最后那个列表是整数刻度）——
    // 同一个缺陷换个参数顺序就漏。改成先把调用括号配对取出，再逐个列表判。
    const CALL = /(?:plot|bar|barh|scatter|fill_between|fill_betweenx|errorbar|hlines|vlines|stem|step|stackplot|imshow|pcolormesh|contourf?|pie|boxplot|violinplot)\s*\(/g
    for (const c of scan.matchAll(CALL)) {
      const args = callArgs(scan, (c.index ?? 0) + c[0].length - 1)
      let flagged = false
      for (const list of args.matchAll(/\[([^\[\]]*)\]/g)) {
        const nums = (list[1] ?? '').match(/-?\d+\.\d+/g) ?? []
        if (nums.length < 3) continue
        const stray = nums.filter(n => !known.has(n) && !known.has(String(Number(n))))
        if (stray.length >= 3) {
          problems.push(`${file}：绘图调用里出现成串的**硬编码数据**（${stray.slice(0, 4).join(', ')}…，共 ${String(stray.length)} 个）`
            + '且都不在账本里 —— 图里的数必须从 `results.json` 读，不能写死在脚本里')
          flagged = true
          break // 同一份脚本只报一次，别刷屏
        }
      }
      if (flagged) break
    }
  }
  return problems.length === 0
    ? { code: 0, items: [{ id, ok: true, detail: `${String(scripts.length)} 个脚本都从账本读数据，未发现硬编码数据串`, code: 0 }] }
    : { code: 1, items: [{ id, ok: false, detail: problems.slice(0, 5).join('；'), code: 1 }] }
}

/**
 * `figure_type_match` —— **规划图型 vs 脚本实际 API**（照搬参考 `recipe_audit.py`）。
 *
 * 治的是参考点名的那个塌方：*"规划写等高线、画出来是条形图"*。
 * **判不出来一律放行**（参考原话"宁漏不误"）：表里没有的图型、或规划里没写图型，都不判。
 */
export function figureTypeMatch(input: GateInput): ScriptGateVerdict {
  const id = 'figure_type_match'
  const raw = planRaw(input)
  const scripts = figureScripts(input)
  if (raw === null || scripts.length === 0) {
    return { code: 2, items: [{ id, ok: false, detail: '缺 FIGURE_PLAN.json 或 gen_fig_*.py —— 无从对账', code: 2 }] }
  }
  let figures: ReadonlyArray<Record<string, unknown>>
  try {
    const parsed: unknown = JSON.parse(raw)
    const list = (parsed as { figures?: unknown }).figures
    if (!Array.isArray(list)) return { code: 2, items: [{ id, ok: false, detail: 'FIGURE_PLAN.json 里没有 figures 数组', code: 2 }] }
    figures = list as ReadonlyArray<Record<string, unknown>>
  } catch {
    return { code: 2, items: [{ id, ok: false, detail: 'FIGURE_PLAN.json 不是合法 JSON', code: 2 }] }
  }
  const byId = new Map(scripts.map(([f, c]) => [f.replace(/^figures\/gen_/, '').replace(/\.py$/, ''), c] as const))
  const problems: string[] = []
  let checked = 0
  for (const f of figures) {
    const fid = String(f['figure_id'] ?? '')
    const ctRaw = typeof f['chart_type'] === 'string' ? f['chart_type'] : ''
    const ct = normalizeChartType(ctRaw) ?? ''
    const code = byId.get(fid)
    if (code === undefined || ct === '') continue
    const pat = TYPE_API[ct]
    if (pat === undefined) continue // 判不出来一律放行（宁漏不误）
    checked += 1
    if (!pat.test(code)) {
      problems.push(`${fid}：规划写的是 \`${ct}\`，但脚本里找不到对应的绘图 API（应出现 ${pat.source}）`
        + ' —— 参考：*"凭印象退化成 plot/bar/scatter 是最常见的质量塌方"*')
    }
  }
  return problems.length === 0
    ? { code: 0, items: [{ id, ok: true, detail: checked === 0 ? '没有可判的图型（判不出来一律放行）' : `${String(checked)} 张图的图型与脚本 API 一致`, code: 0 }] }
    : { code: 1, items: [{ id, ok: false, detail: problems.slice(0, 5).join('；'), code: 1 }] }
}

/**
 * `figure_size_buckets` —— **原生画布尺寸必须贴合长宽比档位**（照搬参考 `fig_include_size.py`）。
 *
 * 参考把这条写成硬规则，理由是实测的惨痛数据：
 * > *"不是'一律 ≤7.2in'，而是「原生宽 ≈ 上页显示宽」……近方图写 7.2in 仍被缩到 0.63、
 * > 刻度 8.5pt 变 5.4pt。"*
 *
 * 档位表（`r = 高/宽`）：`r≤0.80 → 6.0in`；`≤1.20 → 5.0in`；`≤1.60 → 3.6in`；否则 `3.0in`。
 * 容差 **15%**（参考 `figure_check.sh` 第 4 节就是 `_w > _want * 1.15` 才报）。
 */
export function figureSizeBuckets(input: GateInput): ScriptGateVerdict {
  const id = 'figure_size_buckets'
  const scripts = figureScripts(input)
  if (scripts.length === 0) {
    return { code: 2, items: [{ id, ok: false, detail: '本阶段没有 `figures/gen_fig_*.py` —— 没有可核的尺寸', code: 2 }] }
  }
  const want = (r: number): number => (r <= 0.8 ? 6.0 : r <= 1.2 ? 5.0 : r <= 1.6 ? 3.6 : 3.0)
  const problems: string[] = []
  let checked = 0
  for (const [file, code] of scripts) {
    const m = /figsize\s*=\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)/.exec(code)
    if (m === null) continue
    const w = Number(m[1]); const h = Number(m[2])
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue
    checked += 1
    const r = h / w
    const target = want(r)
    if (w > target * 1.15) {
      problems.push(`${file}：figsize 宽 ${String(w)}in，而该长宽比档（r=${r.toFixed(2)}）应写 ≈${String(target)}in `
        + '—— 原生远大于上页显示宽时，缩下去字会糊、线会虚（参考实测：7.2in 被缩到 0.63，刻度 8.5pt→5.4pt）')
    }
    if (h > 8) problems.push(`${file}：figsize 高 ${String(h)}in 超过 8in 上限（参考硬规则）`)
  }
  return problems.length === 0
    ? { code: 0, items: [{ id, ok: true, detail: checked === 0 ? '脚本里没有可核的 figsize 字面量' : `${String(checked)} 个脚本的画布尺寸贴合长宽比档位`, code: 0 }] }
    : { code: 1, items: [{ id, ok: false, detail: problems.slice(0, 5).join('；'), code: 1 }] }
}
