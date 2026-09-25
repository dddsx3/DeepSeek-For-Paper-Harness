/**
 * 阶段 4 的执行体 —— **声明驱动的图表渲染**（确定性，不消耗模型调用）。
 *
 * ## 为什么渲染要跟声明分开（这是本阶段存在的全部理由）
 *
 * 参考工作流让模型写 Python 绘图脚本。本 harness 不这么做：**模型声明结构，
 * harness 取数渲染**（`figure/producer.ts` 的既有设计）。理由是"数字的作者"——
 * 若模型能写渲染代码，它就能在图里画一个上游没有的数；而声明驱动下，图里的
 * 每个数都必须先作为 `Result` 存在，`data_hash` 覆盖全部被画的值。
 *
 * 六轮真实运行的实际失败是 **figures=0**：没有任何阶段写声明，渲染器就没有输入。
 * 所以本阶段的输入只有一样东西——阶段 3 的声明文件。
 *
 * ## 声明文件的形态（阶段 3 的契约，见 `briefing.ts` 的 `code` 技能）
 *
 * ```json
 * {
 *   "results": [
 *     { "result_id": "RES-Q3-TSTAR", "name": "问题3 干燥完成时刻",
 *       "value": 57.47, "unit": "h", "uncertainty": null }
 *   ],
 *   "figures": [
 *     { "figure_id": "fig_q3_numerics", "chart_type": "bar",
 *       "data_refs": ["RES-Q3-TSTAR"], "caption": "…", "x_label": "…", "y_label": "…" }
 *   ]
 * }
 * ```
 *
 * `results` 是**执行结果的只读投影**：代码真跑出来的值被抄成 `Result` 记录，
 * 因为渲染器只认 store 里的 `Result`（`figureRenderInput` 的唯一取数口）。
 * 投影而不是重放的理由写在 `interchange.ts` 的模块头：`ExecutionRecord` 按设计
 * 不可 JSON 往返（INV-3-M 的防伪缝），所以需要它的路径只能**进程内传递或只读投影**。
 *
 * ## 本阶段**不做**什么
 *
 * - 不写渲染代码：渲染器是固定的（`figure/renderer.ts`），配色/字号/布局都是
 *   harness 侧常量。声明里能改的只有 `chart_type` / `data_refs` / 题注与轴标签。
 * - 不猜数据：`data_refs` 里任何一个 ref 在 `results` 里找不到 → **具名拒绝**，
 *   不是"跳过这一张"。跳过会让"图少了"变成静默事实。
 * - 不发明图：只渲染阶段 3 声明的那些；清单外的图不补。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/figure-render
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { guardFigureLabelNumbers, type FigureDeclaration } from '../figure/producer.ts'
import {
  FIGURE_CHART_TYPES,
  FIGURE_STYLE_PROFILE,
  figureRenderInput,
  renderFigureSvg,
  type FigureChartType,
} from '../figure/renderer.ts'
import type { IrObjectRecord } from '../ir/store.ts'
import { stageDirName, stageOf, type StageId } from './registry.ts'

/** 阶段 3 的声明文件名（**单一来源**：注册表与门禁都从这里取）。 */
export const FIGURE_DECLARATIONS_FILE = 'FIGURE_DECLARATIONS.json'

/** 本阶段的渲染清单文件名。 */
export const FIGURE_MANIFEST_FILE = 'figure-manifest.json'

/** 图产物目录（相对阶段目录）。 */
export const FIGURE_DIR = 'figures'

/** 一条执行结果的只读投影（渲染器的取数口只认 `Result`）。 */
export interface ResultProjection {
  readonly result_id: string
  readonly name: string
  readonly value: number
  readonly unit: string
  readonly uncertainty: number | null
}

/** 一条**已申报的计划分叉**：阶段 3 在编码时把清单里的某张图改名/改型了。 */
export interface PlanDeviation {
  /** 阶段 1 清单里的原名。 */
  readonly from: string
  /** 实际声明并渲染的名字。 */
  readonly to: string
  /** 为什么分叉（进对账记录——申报了才可审计）。 */
  readonly reason: string
}

/** 阶段 3 交过来的声明文件。 */
export interface FigureDeclarationFile {
  readonly results: ReadonlyArray<ResultProjection>
  readonly figures: ReadonlyArray<FigureDeclaration>
  /** 可选：把"计划 vs 实际"的分叉**显式申报**出来——申报的分叉在对账时放行并留痕，静默的分叉照判失败。 */
  readonly plan_deviations?: ReadonlyArray<PlanDeviation>
}

/** 渲染清单里的一条。 */
export interface RenderedFigure {
  readonly figure_id: string
  /** 相对阶段目录的路径（`figures/fig_x.svg`）。 */
  readonly file: string
  readonly chart_type: FigureChartType
  readonly data_refs: ReadonlyArray<string>
  /** 渲染输入的规范哈希（与 `figure/producer.ts` 同源同算法）。 */
  readonly data_hash: string
  readonly style_profile: string
  readonly bytes: number
}

/** 渲染清单文件的内容。 */
export interface FigureManifestFile {
  readonly figures: ReadonlyArray<RenderedFigure>
  /** 已申报的计划分叉（无分叉时省略）——对账记录的一部分。 */
  readonly plan_deviations?: ReadonlyArray<PlanDeviation>
}

/** 本阶段的结果。 */
export interface FigureStageResult {
  readonly figures: ReadonlyArray<RenderedFigure>
}

/**
 * 解析声明文件。
 *
 * **缺 `results` 不报错**：那会让"声明了图但没给数"变成解析错误而不是具名拒绝。
 * 真正的判据在渲染时——ref 找不到就点名说找不到哪一个。
 *
 * @param raw - 声明文件文本。
 * @returns 解析结果。
 * @throws 文件不是 JSON 对象 / `figures` 不是数组时抛错（**具名**，不静默当空）。
 */
export function parseFigureDeclarations(raw: string): FigureDeclarationFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${FIGURE_DECLARATIONS_FILE} 不是合法 JSON：${String(error).slice(0, 120)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${FIGURE_DECLARATIONS_FILE} 必须是 JSON 对象（{"results":[…],"figures":[…]})`)
  }
  const obj = parsed as { results?: unknown; figures?: unknown; plan_deviations?: unknown }
  if (!Array.isArray(obj.figures)) {
    throw new Error(`${FIGURE_DECLARATIONS_FILE} 缺 "figures" 数组 —— 没有声明就没有可渲染的图`
      + '（六轮真实运行的 figures=0 就是这个原因）')
  }
  const results = Array.isArray(obj.results) ? obj.results : []
  const deviations: PlanDeviation[] = []
  if (obj.plan_deviations !== undefined) {
    if (!Array.isArray(obj.plan_deviations)) throw new Error(`${FIGURE_DECLARATIONS_FILE} 的 plan_deviations 必须是数组`)
    for (const [i, raw] of obj.plan_deviations.entries()) {
      if (typeof raw !== 'object' || raw === null) throw new Error(`plan_deviations[${String(i)}] 不是对象`)
      const d = raw as Record<string, unknown>
      const from = d['from']
      const to = d['to']
      const reason = d['reason']
      if (typeof from !== 'string' || typeof to !== 'string' || typeof reason !== 'string' || reason.length === 0) {
        throw new Error(`plan_deviations[${String(i)}] 需要 {from, to, reason}——没有理由的分叉就是没被审视的分叉`)
      }
      deviations.push({ from, to, reason })
    }
  }
  return {
    results: results.map((r, i) => parseResult(r, i)),
    figures: obj.figures.map((f, i) => parseFigure(f, i)),
    ...(deviations.length === 0 ? {} : { plan_deviations: deviations }),
  }
}

function parseResult(raw: unknown, index: number): ResultProjection {
  const where = `results[${String(index)}]`
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where} 不是对象`)
  const r = raw as Record<string, unknown>
  const id = r['result_id']
  if (typeof id !== 'string' || id.length === 0) throw new Error(`${where} 缺 result_id`)
  const value = r['value']
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    // 渲染器只画有限数；NaN/Infinity 会在 SVG 里变成 "NaN" 而**看起来**像渲染成功。
    throw new Error(`${where}（${id}）的 value 不是有限数（得到 ${JSON.stringify(value)}）——`
      + '图里出现 NaN 是静默失败，不是渲染成功')
  }
  const uncertainty = r['uncertainty']
  return {
    result_id: id,
    name: typeof r['name'] === 'string' && r['name'].length > 0 ? r['name'] : id,
    value,
    unit: typeof r['unit'] === 'string' ? r['unit'] : '',
    uncertainty: typeof uncertainty === 'number' && Number.isFinite(uncertainty) ? uncertainty : null,
  }
}

function parseFigure(raw: unknown, index: number): FigureDeclaration {
  const where = `figures[${String(index)}]`
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where} 不是对象`)
  const f = raw as Record<string, unknown>
  const id = f['figure_id']
  if (typeof id !== 'string' || id.length === 0) throw new Error(`${where} 缺 figure_id`)
  const refs = f['data_refs']
  if (!Array.isArray(refs) || refs.length === 0 || refs.some(x => typeof x !== 'string')) {
    throw new Error(`${where}（${id}）的 data_refs 必须是非空的 Result id 数组 —— `
      + '空 refs 意味着这张图没有数据来源，渲染器无从取数')
  }
  const chartType = f['chart_type']
  if (chartType !== undefined && (typeof chartType !== 'string' || !FIGURE_CHART_TYPES.includes(chartType as FigureChartType))) {
    throw new Error(`${where}（${id}）的 chart_type '${String(chartType)}' 不在渲染器的白名单 `
      + `[${FIGURE_CHART_TYPES.join(', ')}] 里 —— 渲染器是固定的，不认自创图型`)
  }
  return {
    figure_id: id,
    data_refs: refs as ReadonlyArray<string>,
    ...(chartType === undefined ? {} : { chart_type: chartType as FigureChartType }),
    ...(typeof f['caption'] === 'string' ? { caption: f['caption'] } : {}),
    ...(typeof f['x_label'] === 'string' ? { x_label: f['x_label'] } : {}),
    ...(typeof f['y_label'] === 'string' ? { y_label: f['y_label'] } : {}),
  }
}

/**
 * 把执行结果的只读投影变成渲染器认的 store 形态。
 *
 * 只用 `kind` / `value` 两个字段（`figureRenderInput` 读的就是这两个），
 * 所以这是**投影**而不是重建：不假装这些记录经过 `ModelingIr.put` 的全套校验。
 *
 * @param results - 投影条目。
 * @returns `result_id → IrObjectRecord`。
 */
export function figureStoreProjection(
  results: ReadonlyArray<ResultProjection>,
): ReadonlyMap<string, IrObjectRecord> {
  const store = new Map<string, IrObjectRecord>()
  results.forEach((r, seq) => {
    store.set(r.result_id, {
      seq,
      kind: 'Result',
      id: r.result_id,
      value: {
        result_id: r.result_id,
        name: r.name,
        value: r.value,
        unit: r.unit,
        uncertainty: r.uncertainty,
      },
      ingestedAt: 'projection',
    } as unknown as IrObjectRecord)
  })
  return store
}

/** 读一个阶段目录里的文件；不存在返回 null（**不返回空串**）。 */
async function readMaybe(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

/** 阶段目录的绝对路径（路径只从注册表拼，测试不另拼一份）。 */
export function stagePathOf(stagesRoot: string, id: StageId): string {
  return join(stagesRoot, stageDirName(stageOf(id)))
}

/**
 * 跑阶段 4。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 渲染清单。
 * @throws 声明缺失/非法、ref 解析不了、题注含未引用的数字时抛错（**具名**）。
 */
export async function renderFigureStage(stagesRoot: string): Promise<FigureStageResult> {
  const codeDir = stagePathOf(stagesRoot, 'code')
  const ownDir = stagePathOf(stagesRoot, 'figure')

  const raw = await readMaybe(join(codeDir, FIGURE_DECLARATIONS_FILE))
  if (raw === null) {
    throw new Error(`阶段 3 没有产出 ${FIGURE_DECLARATIONS_FILE} —— 渲染器没有输入，`
      + 'figures 会是 0（这正是六轮真实运行的实际失败）')
  }
  const declarations = parseFigureDeclarations(raw)
  const store = figureStoreProjection(declarations.results)

  const seen = new Set<string>()
  const figures: RenderedFigure[] = []
  const figureDir = join(ownDir, FIGURE_DIR)
  await mkdir(figureDir, { recursive: true })

  for (const decl of declarations.figures) {
    if (seen.has(decl.figure_id)) {
      throw new Error(`figure_id '${decl.figure_id}' 被声明了不止一次 —— `
        + '重复声明会让后一份静默覆盖前一份，图与数据引用就此对不上')
    }
    seen.add(decl.figure_id)
    const derived = figureRenderInput(store, {
      data_refs: decl.data_refs,
      ...(decl.chart_type === undefined ? {} : { chart_type: decl.chart_type }),
      ...(decl.caption === undefined ? {} : { caption: decl.caption }),
      ...(decl.x_label === undefined ? {} : { x_label: decl.x_label }),
      ...(decl.y_label === undefined ? {} : { y_label: decl.y_label }),
    })
    if (!derived.ok) {
      throw new Error(`图 '${decl.figure_id}' 取数失败：${derived.reason}`
        + `（声明的 refs：[${decl.data_refs.join(', ')}]；`
        + `投影里有的：[${declarations.results.map(r => r.result_id).join(', ') || '（空）'}]）`)
    }
    // 题注/轴标签里的数字必须是**被引用过的** Result 值（P2-3 attack 1：
    // 题注是唯一能绕过"数字只能来自 store"的缝）。复用 producer 的守卫，
    // 不另写一份判据——两份判据迟早会分叉。
    const stray = guardFigureLabelNumbers(decl, derived.input.series.map(s => String(s.value)))
    if (stray !== null) {
      throw new Error(`图 '${decl.figure_id}' 的题注/轴标签里出现了未被引用的数字 '${stray}' —— `
        + `允许的只有被引用 Result 的值 [${derived.input.series.map(s => String(s.value)).join(', ')}]`)
    }
    const svg = renderFigureSvg(derived.input)
    const file = `${FIGURE_DIR}/${decl.figure_id}.svg`
    await writeFile(join(ownDir, file), svg, 'utf8')
    figures.push({
      figure_id: decl.figure_id,
      file,
      chart_type: derived.input.chart_type,
      data_refs: [...decl.data_refs],
      data_hash: derived.data_hash,
      style_profile: FIGURE_STYLE_PROFILE,
      bytes: Buffer.byteLength(svg, 'utf8'),
    })
  }

  const manifest: FigureManifestFile = declarations.plan_deviations === undefined
    ? { figures }
    : { figures, plan_deviations: declarations.plan_deviations }
  await writeFile(join(ownDir, FIGURE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { figures }
}

/**
 * 读渲染清单（供门禁与对账）。
 *
 * @param raw - `figure-manifest.json` 文本。
 * @returns 清单；不是合法 JSON 或缺 `figures` 数组时返回 `null`（调用方给 `2`，不放行）。
 */
export function parseFigureManifestFile(raw: string | null): FigureManifestFile | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { figures?: unknown }
    if (!Array.isArray(parsed.figures)) return null
    return { figures: parsed.figures as ReadonlyArray<RenderedFigure> }
  } catch {
    return null
  }
}
