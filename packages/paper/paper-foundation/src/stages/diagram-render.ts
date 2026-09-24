/**
 * 阶段 5 的执行体 —— **流程与架构图渲染**（确定性，不消耗模型调用）。
 *
 * ## 引擎选型：迁移进来的模板 + 仓库内的确定性布局器
 *
 * 参考实现的做法是「HTML+CSS → 无头浏览器转图」。本 harness **不引浏览器**
 * （体积/超时/沙箱的形状会全变），改用 `figure/architecture.ts` 的确定性分层布局器
 * ——它对 `tpl_flow.html` 的三级嵌套（层 → 行 → 节点）做了等价的可计算化，
 * 所以"用迁移进来的模板"在这里的落地方式是：
 *
 * | 迁移资产 | 本阶段怎么用它 |
 * |---|---|
 * | `tpl_*.html`（5 份） | **版式规范本身**：布局语义已固化进 `architecture.ts`；本阶段**按图选模板**并把模板的身份与摘要写进清单（改了模板，清单即失效） |
 * | `themes.css` | 主题色感的来源；风格族 A/B/C 的判据（C 族零彩色）由几何门禁机械核对 |
 *
 * **不是"读了不用"**：模板文件是清单里的一个字段（`template` + `template_digest`），
 * 所以"这张图按哪份模板画的"是可核的事实，而不是注释里的一句话。
 *
 * ## 声明从哪来：`PROBLEM_ANALYSIS.md` 里的 `ARCH_DECLARATION` 块
 *
 * `FIGURE_MANIFEST` 只给图**名**（参考里就是如此），给不出层/节点/连线。所以阶段 1
 * 还要在分析里立一份机器可读的结构声明——与阶段 4 的"声明驱动"同一条纪律：
 * **模型声明结构，harness 渲染**。缺这一块时本阶段**具名失败**，不凭空造一张路线图。
 *
 * ```json
 * <!-- BEGIN ARCH_DECLARATION -->
 * { "fig_roadmap": { "style_family": "A", "direction": "vertical",
 *     "layers": [{ "label": "问题1", "nodes": [{ "id": "n1", "label": "…" }] }],
 *     "edges": [{ "from": "n1", "to": "n2" }] } }
 * <!-- END ARCH_DECLARATION -->
 * ```
 *
 * ## TikZ 几何族：**如实标注够不到**
 *
 * 参考的 `tikz_*`（柱体与边界、移动域映射、控制体模板）由 LaTeX 渲染，本仓库没有
 * LaTeX 引擎。这三张图本阶段**产不出来**，所以清单里单列 `unreachable[]` 并写明原因，
 * 门禁据此给 `2`（无法判定）而不是 `0`——"没产出"不许被当成"通过了"。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/diagram-render
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { diagramTemplate } from './assets.ts'
import { digestOf } from './interchange.ts'
import { architectureFigureNames, parseFigureManifest } from './figure-manifest.ts'
import { FIGURE_DIR, stagePathOf } from './figure-render.ts'
import {
  computeArchitectureLayout,
  renderArchitectureSvg,
  type ArchInput,
  type ArchLayout,
} from '../figure/architecture.ts'

/** 结构声明的块标记。 */
export const ARCH_DECLARATION_BEGIN = '<!-- BEGIN ARCH_DECLARATION -->'
export const ARCH_DECLARATION_END = '<!-- END ARCH_DECLARATION -->'

/** 本阶段的清单文件名。 */
export const DIAGRAM_MANIFEST_FILE = 'diagram-manifest.json'

/** 一份架构图的结构声明（`seed` / `template` 可省，其余必填——缺层就没有图）。 */
export interface ArchDeclaration {
  readonly style_family: 'A' | 'B' | 'C'
  readonly direction: 'horizontal' | 'vertical'
  readonly layers: ArchInput['layers']
  readonly edges: ArchInput['edges']
  /** 可省略：缺省时由本阶段从"图 id + 分析全文摘要"确定性派生（同篇统一、异篇不同）。 */
  readonly seed?: string
  /** 用哪份迁移进来的模板（`tpl_roadmap.html` 等）；缺省按图 id 前缀推断。 */
  readonly template?: string
}

/** 清单里的一条。 */
export interface RenderedDiagram {
  readonly figure_id: string
  readonly file: string
  readonly template: string
  readonly template_digest: string
  readonly style_family: 'A' | 'B' | 'C'
  readonly direction: 'horizontal' | 'vertical'
  readonly seed: string
  readonly nodes: number
  readonly bytes: number
}

/** 够不到的图（有声明、但本仓库渲染不了）。 */
export interface UnreachableFigure {
  readonly figure_id: string
  readonly reason: string
}

/** 清单文件内容。 */
export interface DiagramManifestFile {
  readonly figures: ReadonlyArray<RenderedDiagram>
  readonly unreachable: ReadonlyArray<UnreachableFigure>
}

/** 本阶段的结果。 */
export interface DiagramStageResult {
  readonly figures: ReadonlyArray<RenderedDiagram>
  readonly unreachable: ReadonlyArray<UnreachableFigure>
  /** 每张图的布局（供门禁的几何判据复用，**不落盘**——落盘会变成第二份真相）。 */
  readonly layouts: ReadonlyMap<string, ArchLayout>
}

/**
 * 解析 `ARCH_DECLARATION` 块。
 *
 * @param analysisText - `PROBLEM_ANALYSIS.md` 全文。
 * @returns `图 id → 结构声明`；没有该块时返回 `null`（调用方据此给 `2`，不放行）。
 * @throws 块在但不是合法 JSON 对象时抛错（**具名**）。
 */
export function parseArchDeclaration(analysisText: string): ReadonlyMap<string, ArchDeclaration> | null {
  const begin = analysisText.indexOf(ARCH_DECLARATION_BEGIN)
  const end = analysisText.indexOf(ARCH_DECLARATION_END)
  if (begin === -1 || end === -1 || end <= begin) return null
  const body = analysisText.slice(begin + ARCH_DECLARATION_BEGIN.length, end).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    throw new Error(`ARCH_DECLARATION 块不是合法 JSON：${String(error).slice(0, 120)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ARCH_DECLARATION 必须是 JSON 对象（{"<图 id>": {layers, edges, …}}）')
  }
  const out = new Map<string, ArchDeclaration>()
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`ARCH_DECLARATION 里 '${id}' 不是对象`)
    }
    const d = value as Record<string, unknown>
    if (!Array.isArray(d['layers']) || d['layers'].length === 0) {
      throw new Error(`ARCH_DECLARATION 里 '${id}' 缺 layers —— 没有层就没有图`)
    }
    const family = d['style_family']
    if (family !== undefined && family !== 'A' && family !== 'B' && family !== 'C') {
      throw new Error(`ARCH_DECLARATION 里 '${id}' 的 style_family '${String(family)}' 不在 A/B/C 里`)
    }
    const direction = d['direction']
    if (direction !== undefined && direction !== 'horizontal' && direction !== 'vertical') {
      throw new Error(`ARCH_DECLARATION 里 '${id}' 的 direction '${String(direction)}' 不在 horizontal/vertical 里`)
    }
    out.set(id, {
      style_family: (family ?? 'A') as 'A' | 'B' | 'C',
      direction: (direction ?? 'vertical') as 'horizontal' | 'vertical',
      layers: d['layers'] as ArchInput['layers'],
      edges: (Array.isArray(d['edges']) ? d['edges'] : []) as ArchInput['edges'],
      ...(typeof d['seed'] === 'string' ? { seed: d['seed'] } : {}),
      ...(typeof d['template'] === 'string' ? { template: d['template'] } : {}),
    })
  }
  return out
}

/**
 * 按图 id 前缀推断模板 —— 与阶段 5 简报里写的模板族**同一张表**。
 *
 * @param figureId - 图 id。
 * @returns 模板文件名。
 */
export function templateForFigure(figureId: string): string {
  if (figureId.startsWith('fig_flow')) return 'tpl_flow.html'
  if (figureId.startsWith('fig_arch')) return 'tpl_arch.html'
  if (figureId.startsWith('fig_framework')) return 'tpl_framework.html'
  if (figureId.startsWith('fig_pipeline')) return 'tpl_pipeline.html'
  return 'tpl_roadmap.html'
}

/** 模板文件名 → 清单里记的 id（`tpl_roadmap.html` → `tpl_roadmap`）。 */
function templateId(file: string): string {
  return file.replace(/\.html$/, '')
}

/** 确定性种子：同篇统一、异篇不同、断线重跑可复现。 */
function seedFor(figureId: string, analysisText: string): string {
  return `arch:${figureId}:${digestOf(analysisText).slice(0, 16)}`
}

/**
 * 跑阶段 5。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 清单 + 够不到的图。
 * @throws 分析里没有 `FIGURE_MANIFEST` / `ARCH_DECLARATION`、或声明里没有某张清单图时抛错。
 */
export async function renderDiagramStage(stagesRoot: string): Promise<DiagramStageResult> {
  const analysisDir = stagePathOf(stagesRoot, 'prob-analysis')
  const ownDir = stagePathOf(stagesRoot, 'diagram')
  const analysis = await readFile(join(analysisDir, 'PROBLEM_ANALYSIS.md'), 'utf8').catch(() => null)
  if (analysis === null) {
    throw new Error('阶段 1 没有产出 PROBLEM_ANALYSIS.md —— 本阶段没有清单与结构声明可读')
  }
  const manifest = parseFigureManifest(analysis)
  if (manifest === null) {
    throw new Error('PROBLEM_ANALYSIS.md 里没有完整的 FIGURE_MANIFEST 块 —— 无法对账"计划里的图都产出了"')
  }
  const wanted = architectureFigureNames(manifest)
  if (wanted.length === 0) {
    throw new Error('FIGURE_MANIFEST 的架构段（DRAWIO / TIKZ）是空的 —— 本阶段声明的产物'
      + ' `figures/fig_roadmap.svg` 没有声明来源，凭空造一张图比缺一张更糟')
  }
  const declarations = parseArchDeclaration(analysis)
  if (declarations === null) {
    throw new Error('PROBLEM_ANALYSIS.md 里没有 ARCH_DECLARATION 块 —— '
      + 'FIGURE_MANIFEST 只给图名，给不出层/节点/连线，渲染器无从下笔')
  }

  const figureDir = join(ownDir, FIGURE_DIR)
  await mkdir(figureDir, { recursive: true })
  const figures: RenderedDiagram[] = []
  const unreachable: UnreachableFigure[] = []
  const layouts = new Map<string, ArchLayout>()

  for (const id of wanted) {
    if (id.startsWith('tikz_')) {
      // TikZ 几何族要 LaTeX 引擎，本仓库没有——如实标注够不到，不假装产出。
      unreachable.push({
        figure_id: id,
        reason: 'TikZ 几何图需要 LaTeX 引擎渲染（参考用 xelatex），本仓库没有 LaTeX 工具链；'
          + '本阶段的渲染器（确定性 SVG 布局）不覆盖几何图族',
      })
      continue
    }
    const decl = declarations.get(id)
    if (decl === undefined) {
      throw new Error(`清单里的架构图 '${id}' 在 ARCH_DECLARATION 里没有结构声明 —— `
        + `声明里有的：[${[...declarations.keys()].join(', ') || '（空）'}]`)
    }
    const template = decl.template ?? templateForFigure(id)
    const templateBody = diagramTemplate(template)
    const input: ArchInput = {
      seed: decl.seed ?? seedFor(id, analysis),
      style_family: decl.style_family,
      direction: decl.direction,
      layers: decl.layers,
      edges: decl.edges,
    }
    // 渲染器自己会跑反空壳 / 禁结果值 / 对齐三条自检并在不过时抛错——这里不重复判。
    const svg = renderArchitectureSvg(input)
    const file = `${FIGURE_DIR}/${id}.svg`
    await writeFile(join(ownDir, file), svg, 'utf8')
    layouts.set(id, computeArchitectureLayout(input))
    figures.push({
      figure_id: id,
      file,
      template: templateId(template),
      template_digest: digestOf(templateBody),
      style_family: decl.style_family,
      direction: decl.direction,
      seed: input.seed,
      nodes: input.layers.reduce((n, l) => n + l.nodes.length, 0),
      bytes: Buffer.byteLength(svg, 'utf8'),
    })
  }

  const out: DiagramManifestFile = { figures, unreachable }
  await writeFile(join(ownDir, DIAGRAM_MANIFEST_FILE), `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  return { figures, unreachable, layouts }
}

/**
 * 读架构图清单（供门禁）。
 *
 * @param raw - `diagram-manifest.json` 文本。
 * @returns 清单；不是合法 JSON 或缺 `figures` 时返回 `null`。
 */
export function parseDiagramManifestFile(raw: string | null): DiagramManifestFile | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { figures?: unknown; unreachable?: unknown }
    if (!Array.isArray(parsed.figures)) return null
    return {
      figures: parsed.figures as ReadonlyArray<RenderedDiagram>,
      unreachable: Array.isArray(parsed.unreachable)
        ? parsed.unreachable as ReadonlyArray<UnreachableFigure>
        : [],
    }
  } catch {
    return null
  }
}
