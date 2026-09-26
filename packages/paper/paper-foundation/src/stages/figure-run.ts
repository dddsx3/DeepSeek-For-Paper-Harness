/**
 * 阶段 6 执行体 —— **跑模型写的 `gen_fig_*.py`**（用户口径："单独替换这一步的约束即可"）。
 *
 * ## 与旧执行体的差别
 *
 * 旧的是"声明驱动"：读 `FIGURE_DECLARATIONS.json`，用固定渲染器出 SVG。
 * 现在读阶段 5 交的**脚本**，配好运行环境后逐个执行，收 matplotlib 产出的图像。
 * 换掉的是"模型不写渲染代码"这条约束；**"数不由模型持有"没有换**——
 * 它改由 `figure_script_traced` 门禁保证（脚本必须从铸出的 `results.json` 读）。
 *
 * ## 运行环境（照搬参考的 `script_template` 做法）
 *
 * 参考的脚本头自己 `shutil.copy2` 样式库到 `_utils/`；本仓库**由 harness 铺好**，
 * 脚本只需 `from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten`。
 * 这样做的好处：脚本不用带"找样式库"的样板代码，且**样式库版本由 harness 固定**
 * （参考那条"脚本各自 copy 一份"在实践中会出现版本漂移）。
 *
 * 铺三样：
 * - `<stage>/_utils/plot_utils.py` —— 样式唯一来源（原样，来自 `assets/plotting/`）；
 * - `<stage>/results.json` —— 铸出的账本，脚本取数的唯一来源；
 * - `<stage>/figures/` —— 脚本落盘处（`save_fig(fig, 'figures/fig_x.png')` 相对 cwd）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/figure-run
 */

import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { PLOTTING_ASSETS_DIR } from './assets.ts'
import { stageDirName, stageOf } from './registry.ts'

/** 一条脚本的执行结果。 */
export interface FigureScriptOutcome {
  readonly script: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  /** 脚本应当产出的图（由脚本名推出：`gen_fig_x.py` → `figures/fig_x.png`）。 */
  readonly expected: ReadonlyArray<string>
  /** 真的产出了的非空文件。 */
  readonly produced: ReadonlyArray<string>
}

/** 整阶段的执行结果。 */
export interface FigureRunOutcome {
  readonly scripts: ReadonlyArray<FigureScriptOutcome>
  readonly produced: number
  readonly failed: number
}

/** 可接受的图像扩展名（docx 链要 PNG；同时容忍 PDF，便于以后接 LaTeX）。 */
const IMAGE_EXTS = ['.png', '.pdf', '.svg', '.jpg', '.jpeg'] as const

/** 由脚本名推出期望的图文件名（`gen_fig_x.py` → `fig_x`）。 */
function figureIdOfScript(script: string): string {
  return script.replace(/^gen_/, '').replace(/\.py$/, '')
}

/** 跑一个子进程，收 stdout/stderr 与退出码（**不抛**——非零是正常返回值）。 */
function runPython(cwd: string, args: ReadonlyArray<string>, timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    // **`PYTHONPATH` 必须指到阶段目录**：Python 只把**脚本所在目录**加进 `sys.path`
    // （这里是 `<stage>/figures/`），不是 cwd。不设它，脚本里的
    // `from _utils.plot_utils import ...` 直接 ModuleNotFoundError（实测 8/8 全挂）。
    // 参考的脚本头自己 `sys.path.insert(0, '.')`；本仓库由 harness 铺环境，等价效果。
    const env = { ...process.env, PYTHONPATH: cwd }
    const child = spawn('python', [...args], { cwd, env, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`脚本超时（${String(timeoutMs)}ms）`)) }, timeoutMs)
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { err += b.toString('utf8') })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }) })
  })
}

/**
 * 铺好运行环境并逐个执行 `gen_fig_*.py`。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @param timeoutMs - 单个脚本的超时（默认 180s；绘图脚本通常几秒，慢的是数据准备）。
 * @returns 逐脚本结果（**不抛**：失败以 `exitCode`/`produced` 体现，由门禁去判）。
 */
export async function runFigureScripts(stagesRoot: string, timeoutMs = 180_000): Promise<FigureRunOutcome> {
  const declDir = join(stagesRoot, stageDirName(stageOf('figure-declare')))
  const dir = join(stagesRoot, stageDirName(stageOf('figure')))
  const figuresDir = join(dir, 'figures')
  await mkdir(join(dir, '_utils'), { recursive: true })
  // **重跑 = 替换**：先清掉 `figures/` 里上一轮留下的产物。
  // 确定性阶段原来没这一步（`pruneStageDir` 只作用于模型阶段），于是换执行体后
  // 旧渲染器留下的 SVG 还在，对账会把它当成"本轮产出的图"（实测：脚本全挂，
  // 却报"实际产出了 fig_x.svg"——那是上一轮的）。
  for (const name of await readdir(figuresDir).catch(() => [] as string[])) {
    if (name === '_utils') continue // 样式库兜底那份留着
    await rm(join(figuresDir, name), { recursive: true, force: true })
  }

  // ① 样式库（原样，来自 assets/plotting/）。
  // **放两处**：`<stage>/_utils/`（规范位置）与 `<stage>/figures/_utils/`（**兜底**）。
  // 兜底那一份是关键：Python 只把**脚本所在目录**加进 `sys.path`（这里是 `figures/`），
  // 靠 `PYTHONPATH` 传 cwd 在某些环境下不生效（实测：手动 spawn 通、走执行体不通）。
  // 把 `_utils` 放到脚本旁边，就**不依赖任何环境变量**了。
  await copyFile(join(PLOTTING_ASSETS_DIR, 'plot_utils.py'), join(dir, '_utils', 'plot_utils.py'))
  await mkdir(join(dir, 'figures', '_utils'), { recursive: true })
  await copyFile(join(PLOTTING_ASSETS_DIR, 'plot_utils.py'), join(dir, 'figures', '_utils', 'plot_utils.py'))
  // ③ **共用引导模块也由 harness 铺**（`figures/_figbase.py`）。
  // 参考把它写成"图多于 5 张时**先建**一个"——那是建议，交给执行者自己判断。
  // 实测代价：同一批 11 张图只有 1 份脚本真的建了它，其余各写各的样板，
  // 于是参考担心的"各图口径不一致导致论文数字打架"照样发生。
  // 改成**铺好的资产**之后，"用不用"不再是执行者的自由，而是契约（门禁也据此判）。
  await copyFile(join(PLOTTING_ASSETS_DIR, '_figbase.py'), join(dir, 'figures', '_figbase.py'))
  // ② 铸出的账本：脚本取数的唯一来源
  const ledger = await readFile(join(stagesRoot, '04-result-sources', 'results.json'), 'utf8').catch(() => null)
  if (ledger === null) {
    throw new Error('阶段 4 没有产出 results.json —— 账本是脚本取数的唯一来源（数不由模型持有）')
  }
  await writeFile(join(dir, 'results.json'), ledger, 'utf8')

  // ③ 把阶段 5 的脚本搬进本阶段（cwd 就设在这里，脚本里的相对路径才成立）
  const srcFigures = join(declDir, 'figures')
  const names = (await readdir(srcFigures).catch(() => [] as string[]))
    .filter(n => /^gen_fig_[A-Za-z0-9_]+\.py$/.test(n))
    .sort()
  if (names.length === 0) {
    throw new Error(`阶段 5 没有交任何 \`figures/gen_fig_*.py\` —— 没有脚本就没有图可画`)
  }

  const scripts: FigureScriptOutcome[] = []
  for (const name of names) {
    await copyFile(join(srcFigures, name), join(figuresDir, name))
    const fid = figureIdOfScript(name)
    const expected = IMAGE_EXTS.map(ext => `figures/${fid}${ext}`)
    let exitCode = -1
    let out = ''
    let err = ''
    try {
      const r = await runPython(dir, [join('figures', name)], timeoutMs)
      exitCode = r.code; out = r.out; err = r.err
    } catch (e) {
      err = String(e instanceof Error ? e.message : e)
    }
    const produced: string[] = []
    for (const rel of expected) {
      const size = await readFile(join(dir, rel)).then(b => b.byteLength).catch(() => 0)
      if (size > 0) produced.push(rel)
    }
    scripts.push({ script: `figures/${name}`, exitCode, stdout: out.slice(-2000), stderr: err.slice(-2000), expected, produced })
  }
  const produced = scripts.filter(s => s.produced.length > 0).length

  // 渲染清单 —— 声明的产物，必须真的落盘（`figure_manifest_reconcile` 与
  // `stage_deliverable_missing` 前置都看它）。旧执行体写的，换成脚本执行后
  // 一度漏了这一步：脚本跑成了、图也在，但"清单不存在"被判产物缺失。
  const manifest = {
    stage: '06-figure',
    source: 'model-scripts',
    figures: scripts.map(s => ({
      figure_id: figureIdOfScript(s.script.replace(/^figures\//, '')),
      script: s.script,
      file: s.produced[0] ?? null,
      exit_code: s.exitCode,
      bytes: s.produced.length === 0 ? 0 : undefined,
    })),
  }
  await writeFile(join(dir, 'figure-manifest.json'), JSON.stringify(manifest, null, 2) + String.fromCharCode(10), 'utf8')

  return { scripts, produced, failed: scripts.length - produced }
}
