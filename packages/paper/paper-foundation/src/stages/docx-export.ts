/**
 * 阶段 11 的执行体 —— **导出 Word 交付物**（确定性，不消耗模型调用）。
 *
 * ## 为什么"导出器退出 0"不等于"导出成功"
 *
 * 参考的纪律（也写进了阶段 11 的简报）：**校验产物的存在与体量**。一个退出码为 0
 * 却只产出空壳的导出器，会交出一份"看起来完整、实际没有正文"的 Word。所以本模块
 * 的判据是**文件真的在、而且不是空壳**，退出码只是其中一条输入。
 *
 * ## 三段流水线，每一段都有具名失败
 *
 * 1. **导出前校核**（`docx_precheck` 的判据）：占位符 / 表格列数 / 图片链接闭合。
 *    有致命项 → **不产出 docx**，把致命项写进报告后抛错。宁可交"缺 docx 的包 + 明确
 *    的致命项报告"，也不要交一个格式错乱却看起来完整的 Word。
 * 2. **图栅格化**：迁移进来的引擎只嵌位图（png/jpg/gif/bmp），而本 harness 的图是
 *    SVG（`figure/renderer.ts` 的确定性输出）。参考侧不存在这一步——它的图由
 *    matplotlib 直接出 PNG。所以这里补一步 SVG → PNG（`cairosvg`，300 DPI），
 *    并把它记进报告与适配台账。栅格化不可用时**具名拒绝**，不静默嵌占位符。
 * 3. **引擎渲染**：`assets/docx-engine/md_to_docx.js`（迁移自参考，**标准不变**）。
 *    用阶段 9 的画像渲染——画像缺失/非法时回退到国赛默认，**回退这件事写进报告**。
 *
 * ## 交付的正文**不被改写**
 *
 * 图链接的 `.svg → .png` 只发生在**导出用的派生副本**（`_export.md`）上；
 * `paper/main.md` 保持原样。交付物的正文与"导出时的中间形态"是两件事，
 * 混在一起会让"论文里写的是什么"变成不可回答的问题。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/docx-export
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DOCX_ENGINE_DIR } from './assets.ts'
import { resolveDocxProfile, docxPrecheckFatal, type ResolvedProfile } from './docx-profile.ts'
import { PAPER_MAIN } from './format-check.ts'
import { stagePathOf } from './figure-render.ts'
import { exportDepsSummary, probeExportDeps, type ExportDependency, type ExportDepStatus } from '../delivery/export-deps.ts'

/** 本阶段的报告文件名（画像回退、栅格化、校核结论都记在这里）。 */
export const DOCX_EXPORT_REPORT = 'DOCX_EXPORT_REPORT.md'

/** 导出用的派生正文（图链接改指 PNG；**不是交付物**）。 */
export const EXPORT_SOURCE = '_export.md'

/** 交付物路径（相对阶段目录）—— 与注册表的 `produces` 必须逐字一致。 */
export const DOCX_OUTPUT = 'paper/main.docx'

/** 引擎入口（相对 `assets/docx-engine/`）。 */
export const DOCX_ENGINE_ENTRY = 'md_to_docx.js'

/** 阶段 11 真正需要的导出依赖（`python-docx` 是另一条链的，不在这里当闸门）。 */
export const DOCX_EXPORT_DEPS: ReadonlyArray<ExportDependency> = [
  { name: 'cairosvg', purpose: 'SVG → PNG（引擎只嵌位图，本 harness 的图是 SVG）', probe: ['python', '-c', 'import cairosvg'], required: true },
]

/** 栅格化目标 DPI（参考的图质量地板就是 300）。 */
export const RASTER_DPI = 300

/** 一次栅格化。 */
export interface RasterizedFigure {
  readonly from: string
  readonly to: string
  readonly bytes: number
}

/** 本阶段的结果。 */
export interface DocxExportResult {
  readonly docxPath: string
  readonly bytes: number
  readonly profile: ResolvedProfile
  readonly fatal: ReadonlyArray<string>
  readonly rasterized: ReadonlyArray<RasterizedFigure>
  readonly deps: ReadonlyArray<ExportDepStatus>
  readonly reportPath: string
}

/** 论文里引用的图路径（去重，按出现顺序）。 */
export function figureLinksOf(markdown: string): ReadonlyArray<string> {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const path = (m[1] ?? '').replace(/^\.\//, '')
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/** 收集本阶段能看到的图文件：`04-figure/figures/` 与 `05-diagram/figures/`。 */
export async function figureFilesOf(stagesRoot: string): Promise<ReadonlyArray<string>> {
  const out: string[] = []
  for (const stageId of ['figure', 'diagram'] as const) {
    const dir = join(stagePathOf(stagesRoot, stageId), 'figures')
    const names = await readdir(dir).catch(() => [] as string[])
    out.push(...names.filter(n => /\.(svg|png|jpg|jpeg)$/i.test(n)))
  }
  return out
}

/** 在阶段目录里找一张图（按文件名，图在两个阶段目录里都找）。 */
async function locateFigure(stagesRoot: string, basename: string): Promise<string | null> {
  for (const stageId of ['figure', 'diagram'] as const) {
    const p = join(stagePathOf(stagesRoot, stageId), 'figures', basename)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * SVG → PNG（`cairosvg`，argv 数组不经过 shell）。
 *
 * @param svgPath - 源 SVG 的绝对路径。
 * @param pngPath - 目标 PNG 的绝对路径。
 * @throws cairosvg 不可用或转换失败时抛错（**具名**，不静默嵌占位符）。
 */
export function rasterizeSvg(svgPath: string, pngPath: string): void {
  const python = process.env['PYTHON'] ?? 'python'
  const script = [
    'import sys, cairosvg',
    'cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], dpi=float(sys.argv[3]))',
  ].join('; ')
  try {
    execFileSync(python, ['-c', script, svgPath, pngPath, String(RASTER_DPI)], {
      stdio: 'pipe', encoding: 'utf8', timeout: 120_000,
    })
  } catch (error) {
    throw new Error(`SVG 栅格化失败（${python} + cairosvg，${String(RASTER_DPI)} DPI）：`
      + `${String(error).split('\n')[0]?.slice(0, 160) ?? ''} —— `
      + '引擎只嵌位图，栅格化不了就不许假装导出成功（那会交出一份图全是占位符的 Word）')
  }
}

/**
 * 跑阶段 11。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 导出结论（含依赖探测、栅格化记录、画像回退原因）。
 * @throws 正文缺失 / 校核有致命项 / 依赖缺失 / 引擎失败 / 产物是空壳时抛错。
 */
export async function runDocxExportStage(stagesRoot: string): Promise<DocxExportResult> {
  const paperDir = stagePathOf(stagesRoot, 'paper')
  const profileDir = stagePathOf(stagesRoot, 'format-profile')
  const ownDir = stagePathOf(stagesRoot, 'docx-export')
  await mkdir(join(ownDir, 'paper'), { recursive: true })
  await mkdir(join(ownDir, 'figures'), { recursive: true })

  const markdown = await readFile(join(paperDir, PAPER_MAIN), 'utf8').catch(() => null)
  if (markdown === null) {
    throw new Error(`阶段 7 没有产出 ${PAPER_MAIN} —— 没有可导出的正文`)
  }
  const rawProfile = await readFile(join(profileDir, '_text_profile.json'), 'utf8').catch(() => null)
  const profile = resolveDocxProfile(rawProfile)

  // ── 段 1：导出前校核 ──────────────────────────────────────────────────
  const available = await figureFilesOf(stagesRoot)
  const fatal = docxPrecheckFatal(markdown, available)
  const deps = probeExportDeps(DOCX_EXPORT_DEPS)
  const depSummary = exportDepsSummary(deps, DOCX_EXPORT_DEPS)
  const report = (extra: ReadonlyArray<string>): string => renderExportReport({
    profile, fatal, deps, depSummary, rasterized: [], extra,
  })

  if (fatal.length > 0) {
    await writeFile(join(ownDir, DOCX_EXPORT_REPORT), report([
      '## 结论', '',
      `❌ **拒绝导出**：${String(fatal.length)} 项致命校核未过。`
        + '本阶段**不产出 docx**——宁可交出"缺 docx 的交付包 + 明确的致命项报告"，'
        + '也不要交出一个看起来完整、实际格式错乱的 Word。',
    ]), 'utf8')
    throw new Error(`导出前校核有 ${String(fatal.length)} 项致命项：${fatal.join('；')}`)
  }

  // ── 段 2：图栅格化（引擎只嵌位图） ─────────────────────────────────────
  if (!depSummary.ready) {
    await writeFile(join(ownDir, DOCX_EXPORT_REPORT), report([
      '## 结论', '',
      `❌ **拒绝导出**：栅格化依赖缺失（${depSummary.missing.join('、')}）。`
        + '本 harness 的图是 SVG，引擎只嵌位图，缺 cairosvg 就只能嵌占位符——那不叫导出成功。',
    ]), 'utf8')
    throw new Error(`导出依赖缺失：${depSummary.missing.join('、')}（不假装导出成功）`)
  }

  const links = figureLinksOf(markdown)
  const rasterized: RasterizedFigure[] = []
  const rewrites = new Map<string, string>()
  for (const link of links) {
    const basename = link.split('/').pop() ?? link
    const source = await locateFigure(stagesRoot, basename)
    if (source === null) continue // 链接闭合已在段 1 判过；这里只处理存在的图
    const targetName = `${basename.replace(/\.svg$/i, '')}.png`
    const target = join(ownDir, 'figures', targetName)
    if (/\.svg$/i.test(basename)) {
      rasterizeSvg(source, target)
      const bytes = (await readFile(target)).byteLength
      rasterized.push({ from: basename, to: `figures/${targetName}`, bytes })
      rewrites.set(link, `figures/${targetName}`)
      continue
    }
    // 已经是位图：拷进导出工作区，引擎按 workspace 相对路径找得到。
    await writeFile(target, await readFile(source))
    rewrites.set(link, `figures/${targetName}`)
  }

  const exportSource = figureLinksOf(markdown).reduce(
    (text, link) => text.split(`](${link})`).join(`](${rewrites.get(link) ?? link})`),
    markdown,
  )
  await writeFile(join(ownDir, EXPORT_SOURCE), exportSource, 'utf8')
  await writeFile(join(ownDir, '_text_profile.json'), `${JSON.stringify(profile.profile, null, 2)}\n`, 'utf8')

  // ── 段 3：引擎渲染 ────────────────────────────────────────────────────
  const engine = join(DOCX_ENGINE_DIR, DOCX_ENGINE_ENTRY)
  if (!existsSync(engine)) {
    throw new Error(`导出引擎入口不在：${engine} —— 构建没有把 assets 复制到 lib 旁边？`
      + '（模块做好不等于进了主线：资产必须跟着产物走）')
  }
  // 输出路径必须与注册表的 `produces` 逐字一致——第一版这里错用了 `PAPER_MAIN`
  // （`paper/main.md`），于是引擎把 docx 写到了**正文的路径**上：产物"存在"、
  // 体量也够，但阶段声明的 `paper/main.docx` 根本没产出。运行器新加的
  // "声明的产物齐了没有"一查就撞出来了。
  const outDocx = join(ownDir, DOCX_OUTPUT)
  const run = spawnEngine(engine, {
    source: join(ownDir, EXPORT_SOURCE),
    output: outDocx,
    workspace: ownDir,
    profile: join(ownDir, '_text_profile.json'),
  })
  if (run.status !== 0) {
    await writeFile(join(ownDir, DOCX_EXPORT_REPORT), report([
      '## 结论', '',
      `❌ **导出失败**：引擎退出码 ${String(run.status ?? 'null')}。`,
      '', '```', (run.stderr || run.stdout).split('\n').slice(-12).join('\n'), '```',
    ]), 'utf8')
    throw new Error(`导出引擎失败（exit ${String(run.status ?? 'null')}）：`
      + `${(run.stderr || run.stdout).split('\n').slice(-3).join(' / ').slice(0, 200)}`)
  }
  const bytes = await readFile(outDocx).then(b => b.byteLength).catch(() => 0)
  if (bytes < 1000) {
    await writeFile(join(ownDir, DOCX_EXPORT_REPORT), report([
      '## 结论', '',
      `❌ **导出失败**：引擎退出 0，但产物不存在或只有 ${String(bytes)} 字节 —— `
        + '导出器退出 0 不等于导出成功，空壳 Word 不许交付。',
    ]), 'utf8')
    throw new Error(`导出产物是空壳（${String(bytes)} 字节 < 1000）：导出不算成功`)
  }

  const reportPath = join(ownDir, DOCX_EXPORT_REPORT)
  await writeFile(reportPath, renderExportReport({
    profile, fatal, deps, depSummary, rasterized,
    extra: [
      '## 结论', '',
      `✅ **导出成功**：\`paper/main.docx\` ${String(bytes)} 字节；`
        + `栅格化 ${String(rasterized.length)} 张图（${String(RASTER_DPI)} DPI）；`
        + `格式画像来源：${profile.source === 'explicit' ? '阶段 9 的画像' : '**回退到国赛默认**'}。`,
    ],
  }), 'utf8')
  return { docxPath: outDocx, bytes, profile, fatal, rasterized, deps, reportPath }
}

/** 引擎调用（argv 数组，不经过 shell；cwd 设在引擎目录，`require` 按模块位置解析）。 */
function spawnEngine(
  engine: string,
  args: { readonly source: string; readonly output: string; readonly workspace: string; readonly profile: string },
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [
      engine, '--source', args.source, '--output', args.output,
      '--workspace', args.workspace, '--profile', args.profile,
    ], { cwd: dirname(engine), encoding: 'utf8', timeout: 600_000 })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string }
    return {
      status: typeof e.status === 'number' ? e.status : null,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(error),
    }
  }
}

/** 渲染导出报告（三段：依赖 / 栅格化与画像 / 结论）。 */
export function renderExportReport(input: {
  readonly profile: ResolvedProfile
  readonly fatal: ReadonlyArray<string>
  readonly deps: ReadonlyArray<ExportDepStatus>
  readonly depSummary: { readonly ready: boolean; readonly missing: ReadonlyArray<string>; readonly optionalMissing: ReadonlyArray<string> }
  readonly rasterized: ReadonlyArray<RasterizedFigure>
  readonly extra: ReadonlyArray<string>
}): string {
  const L: string[] = []
  L.push('# DOCX 导出报告', '')
  L.push(`**引擎**：\`stages/assets/docx-engine/${DOCX_ENGINE_ENTRY}\`（迁移自参考，**标准不变**）`, '')
  L.push('## 导出依赖', '')
  const purposeOf = (name: string): string => DOCX_EXPORT_DEPS.find(d => d.name === name)?.purpose ?? ''
  for (const d of input.deps) {
    const mark = d.status === 0 ? '✅' : d.status === 1 ? '❌' : '⚠️'
    L.push(`- ${mark} \`${d.name}\`：${purposeOf(d.name)} —— ${d.detail}`)
  }
  L.push('')
  L.push('## 格式画像', '')
  L.push(`- 来源：**${input.profile.source === 'explicit' ? '阶段 9 的画像（explicit）' : '回退到国赛默认（default）'}**`)
  if (input.profile.source === 'default') {
    L.push(`- **回退原因**：${input.profile.fallbackReason}`)
    L.push('- 这条必须写在报告里：回退是**事实**，不是隐形行为。')
  }
  L.push(`- 被采纳的顶层键：${input.profile.appliedKeys.join('、') || '（无）'}`)
  L.push('')
  L.push('## 导出前校核', '')
  L.push(input.fatal.length === 0
    ? '- ✅ 零致命项（占位符 / 表格列数 / 图片链接闭合）'
    : input.fatal.map(f => `- ❌ ${f}`).join('\n'))
  L.push('')
  L.push('## 图栅格化（SVG → PNG）', '')
  if (input.rasterized.length === 0) {
    L.push('无（本稿没有引用 SVG 图）。')
  } else {
    L.push(`参考侧不存在这一步：它的图由 matplotlib 直接出 PNG。本 harness 的图是 SVG，`
      + `而迁移进来的引擎只嵌位图，所以补一步 \`cairosvg\` 栅格化（${String(RASTER_DPI)} DPI）。`)
    L.push('')
    for (const r of input.rasterized) L.push(`- \`${r.from}\` → \`${r.to}\`（${String(r.bytes)} 字节）`)
  }
  L.push('')
  L.push(...input.extra)
  L.push('')
  return L.join('\n')
}
