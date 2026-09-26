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
  forest: /\.errorbar\(|\.hlines\(/,
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
  if (ledger !== null) {
    try {
      const parsed: unknown = JSON.parse(ledger)
      const list = (parsed as { results?: unknown }).results
      if (Array.isArray(list)) for (const r of list) {
        const rid = (r as { result_id?: unknown }).result_id
        if (typeof rid === 'string') known.add(rid)
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
    if (typeof ct !== 'string' || !(FIGURE_TYPES as readonly string[]).includes(ct)) {
      problems.push(`${fid}：chart_type '${String(ct)}' 不在白名单 [${FIGURE_TYPES.join(', ')}]`)
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
export function figureScriptQuality(input: GateInput): ScriptGateVerdict {
  const id = 'figure_script_quality'
  const scripts = figureScripts(input)
  if (scripts.length === 0) {
    return { code: 2, items: [{ id, ok: false, detail: '本阶段没有 `figures/gen_fig_*.py` —— 没有可审的脚本', code: 2 }] }
  }
  const problems: string[] = []
  const warnings: string[] = []
  for (const [file, code] of scripts) {
    if (!/setup_style/.test(code)) {
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
    if (!/save_fig|savefig/.test(code)) problems.push(`${file}：没有 \`save_fig\`/\`savefig\` —— 脚本跑完不落盘`)
    if (/ax\.grid\s*\(|plt\.grid\s*\(/.test(code)) warnings.push(`${file}：手动 \`ax.grid()\`（参考 WARNING，非阻断）`)
    if (/frameon\s*=\s*True/.test(code)) warnings.push(`${file}：图例带灰框 \`frameon=True\`（参考 WARNING，显土）`)
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
    // 逐行扫，**排除坐标轴刻度/范围**这类结构性列表（`set_xticks([0.6, 0.7, …])`、
    // `set_xlim(...)`）——那是版面参数，不是图里的数（实测：把刻度当数据会误杀）。
    const dataLines = code.split(String.fromCharCode(10))
      .filter(l => !/set_[xy]ticks|set_[xy]lim|set_[xy]ticklabels|axhline|axvline|figsize|tight_layout/.test(l))
      .join(String.fromCharCode(10))
    for (const m of dataLines.matchAll(/\[([^\[\]]*\d\.\d[^\[\]]*)\]/g)) {
      const nums = (m[1] ?? '').match(/-?\d+\.\d+/g) ?? []
      if (nums.length < 3) continue
      const stray = nums.filter(n => !known.has(n) && !known.has(String(Number(n))))
      if (stray.length >= 3) {
        problems.push(`${file}：出现成串的**硬编码数据**（${stray.slice(0, 4).join(', ')}…，共 ${String(stray.length)} 个）`
          + '且都不在账本里 —— 图里的数必须从 `results.json` 读，不能写死在脚本里')
      }
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
    const ct = typeof f['chart_type'] === 'string' ? f['chart_type'] : ''
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
