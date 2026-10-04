/**
 * 阶段 3 的 harness 侧执行 —— **真跑代码，从产物字节里铸数**。
 *
 * ## 为什么数不能由模型持有（用户口径，2024B 实验的结论）
 *
 * 2024B 实验里模型在 `FIGURE_DECLARATIONS.json` 的 `results` 里转录数值：转录是否
 * 如实无从审计（它抄错一位小数，图画的就都是错的），且 177 条转录把回答顶过输出
 * 上限。正确形态是参考工作流自己的那条：`all_results.json` 由**代码写出**，
 * 模型从不持有一个数值。
 *
 * 所以本模块把"数从哪来"收归 harness：
 *
 * 1. 模型在 `RESULT_SOURCES.json` 里只写**定位**：`{result_id, name, locator,
 *    json_path, unit}`——"我的代码会把问题 1 的样本量写到 `outputs.json` 的
 *    `problem1.n_star` 路径下"。
 * 2. harness **真跑** `code/main.py`（Python 是既有能力；cwd 设在 `code/`，
 *    让代码的相对路径输出落在它自己的目录里）。
 * 3. harness 按 locator + json_path 从**真实产物字节**读出每个数，铸成
 *    `results.json`——这是下游图表渲染的唯一取数口。
 *
 * 于是：**前后一致**（图画的数 = 代码产出的数，中间没有转录），
 * **可追溯**（每个数定位到一次真实执行的确定路径），**体量归零**
 * （阶段 3 不再携带数值清单——2024B 的 max-tokens 截断就此消失）。
 *
 * ## 读不到就是读不到
 *
 * locator 解析不到、json_path 落空、值不是有限数——**具名拒绝**，绝不猜、
 * 绝不把 undefined 铸成 0。0 是一个"看起来合理的错数"，比失败危险得多。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/execute-and-mint
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveJsonPath } from '../produce/interpretation-producer.ts'
import { markStaleFrom, readPassport, writePassport } from './handoff.ts'
import { stageDirName, stageOf } from './registry.ts'

/** 阶段 3 的"数在哪"声明文件名。 */
export const RESULT_SOURCES_FILE = 'RESULT_SOURCES.json'

/** harness 铸出的结果账本（下游图表渲染的唯一取数口）。 */
export const RESULTS_LEDGER_FILE = 'results.json'

/**
 * **运行时失败的回执**（写在**阶段 3** 的目录里）。
 *
 * 阶段 4 真跑 `code/main.py` 失败时，错误属于**阶段 3 的代码**，不属于阶段 4。
 * 但 `--stage-next` 只会重跑阶段 4——拿同一份坏代码再跑一遍。实测一个变量名拼写错
 * （`at_palt` vs 它自己定义的 `at_p_alt`）让阶段 4 连撞 9 次、半个多小时全废，
 * 而那条 `NameError` 从来没到过该看它的阶段。
 * 这个文件是回路：`priorRuntimeFindings` 会把它注入阶段 3 的下一轮简报。
 */
export const RUNTIME_FAILURE_FILE = '_runtime-failure.txt'

/** 代码执行入口（相对 `code/`）。 */
export const CODE_ENTRY = 'main.py'

/**
 * 阶段 3 的**冒烟运行**结论。
 *
 * `failure` 非 null 时，`afterModel` 会把它抛出去让本阶段失败——走的是与阶段 4
 * 运行时失败**同一条回路**（回执写在 `_runtime-failure.txt`，`priorRuntimeFindings`
 * 注入下一轮简报）。
 */
export interface SmokeRunOutcome {
  /** 给 `onDeterministicOutcome` 的一句话（人读）。 */
  readonly summary: string
  /** 非空 = 代码跑不起来，本阶段应当失败。 */
  readonly failure: string | null
  /** 失败时的 stderr 尾部（定向修复要用：里面是 traceback 与肇事文件/行号）。 */
  readonly traceback: string
}

/**
 * 真跑一次 `code/main.py`（环境与阶段 4 完全一致：cwd = `code/`、同一入口、同一超时）。
 *
 * ## 为什么阶段 3 也要跑一次
 *
 * 在这之前，阶段 3 交付的代码**从没被执行过**——第一个执行它的环节是阶段 4，
 * 而在它之前隔着一次独立审计。实测代价：审计的第一条 fatal 是
 * *"Q1_DECISION_DIRECTIONS 被定义为元组，却被按下标索引字符串，首次求解即 TypeError"*
 * ——一个 10 秒的执行就能抓到的缺陷，烧掉了一次独立审计的裁决，
 * 外加下一轮 9 片重跑（约一小时）。**先让代码跑起来，再谈别的。**
 *
 * ## 三条边界
 *
 * 1. **超时不是失败**：竞赛级求解可能就是要跑很久；超时记"未判定，不阻断"，
 *    交由阶段 4 用同一个超时真跑。判据是"跑不起来"（非 0 退出），不是"跑得慢"。
 * 2. **spawn 失败不是失败**：python 不在 PATH 之类是环境问题，记未判定。
 * 3. **探针不是交付**：运行新产生的文件（结果账本等）在跑完后**删掉**——
 *    它们不是模型交付的产物，留着会让门禁的 `min_bytes` 判据看到一份"运行结果"
 *    而不是"声明与磁盘一致"；阶段 4 会从头再跑一遍，什么都不丢。
 */
export async function smokeRunCode(stagesRoot: string): Promise<SmokeRunOutcome> {
  const codeDir = join(stagesRoot, stageDirName(stageOf('code')), 'code')
  if (!existsSync(join(codeDir, CODE_ENTRY))) {
    return { summary: '冒烟运行跳过：code/main.py 不存在（由门禁报）', failure: null, traceback: '' }
  }
  const timeoutMs = Number(process.env['PAPER_CODE_RUN_TIMEOUT_MS'] ?? '') > 0
    ? Number(process.env['PAPER_CODE_RUN_TIMEOUT_MS'])
    : 600_000
  // 执行环境先备好（在快照**之前**拷——这样下面的清理不会把它当运行产物删掉）
  await stageCodeInputs(stagesRoot, codeDir)
  // 快照：跑完后把**新增**的文件删掉（探针不是交付，见上）。
  const before = new Set((await readdir(codeDir).catch(() => [] as string[])))
  const run = spawnSync('python', [CODE_ENTRY], { cwd: codeDir, encoding: 'utf8', timeout: timeoutMs })
  const created = (await readdir(codeDir).catch(() => [] as string[])).filter(n => !before.has(n))
  for (const n of created) await rm(join(codeDir, n), { force: true }).catch(() => { /* 删不掉就算了，阶段 4 会覆盖 */ })

  if (run.error !== undefined) {
    return { summary: `冒烟运行未判定（spawn 失败：${String(run.error).slice(0, 80)}）—— 不阻断`, failure: null, traceback: '' }
  }
  if (run.signal !== null) {
    return { summary: `冒烟运行超时（${String(timeoutMs)}ms 被杀）—— 未判定，不阻断（阶段 4 用同一超时真跑）`, failure: null, traceback: '' }
  }
  if (run.status === 0) {
    return { summary: '冒烟运行通过（python code/main.py 退出码 0）', failure: null, traceback: '' }
  }
  const tail = (run.stderr || '(空)').split('\n').filter(l => l.trim() !== '').slice(-10).join('\n').slice(0, 1800)
  const last = (run.stderr || '').split('\n').filter(l => l.trim() !== '').slice(-1)[0]?.slice(0, 140) ?? '(空)'
  await writeFile(join(stagesRoot, stageDirName(stageOf('code')), RUNTIME_FAILURE_FILE),
    `<!-- 阶段 3 冒烟运行失败（python code/main.py 退出码 ${String(run.status)}）。`
    + '环境与阶段 4 完全一致（cwd=code/）。修完代码再交付——别让独立审计替你执行代码。 -->\n\n'
    + `${tail}\n`, 'utf8').catch(() => { /* 落盘失败不掩盖原失败 */ })
  return {
    summary: `冒烟运行失败（退出码 ${String(run.status)}）：${last}`,
    failure: `交付的代码跑不起来（python code/main.py 退出码 ${String(run.status)}）：${last}`
      + ' —— 完整栈在 `_runtime-failure.txt`。这是执行就能抓到的缺陷，修完再交付。',
    traceback: tail,
  }
}

/** 一条"数在哪"的声明。 */
export interface ResultSource {
  readonly result_id: string
  readonly name: string
  /** 产物文件（相对 `code/`）。 */
  readonly locator: string
  /** 文件内的点路径（`problem1.n_star` / `cases[0].accept`）。 */
  readonly json_path: string
  readonly unit: string
}

/** 声明文件。 */
export interface ResultSourcesFile {
  readonly sources: ReadonlyArray<ResultSource>
}

/** 铸出的账本（与渲染器取数口同形）。 */
export interface MintedResultsFile {
  readonly results: ReadonlyArray<{
    readonly result_id: string
    readonly name: string
    /**
     * 账目的值。**不止标量**：序列（扫描表 / 样本 / 收敛序列）、
     * 矩阵（组合成本表 / 混淆矩阵）、三维张量（参数网格上的指标场）都合法。
     * 见 `numericShapeOf` —— 元素必须全是有限数。
     */
    readonly value: number | ReadonlyArray<unknown>
    readonly unit: string
    readonly uncertainty: number | null
    /** 值的形态。给下游（脚本、门禁、审计）一个不用猜的判据。 */
    readonly kind?: NumericShape
  }>
}

/**
 * 账目值的形态。
 *
 * 为什么要有这个字段而不是让下游自己 `Array.isArray`：
 * ① 门禁要能机械地回答"**账本里有没有能画那张图的数据**"——
 *    `figure_plan_valid` 就是按它判的（标量画不出热力图，这是硬事实）；
 * ② 审计要能核"阶段 3 是否铸了足够结构"，而不是只数条数。
 *
 * 七种形态都来自**实测中代码真正写出来的东西**（不是先验设计）：
 * 2024B 放宽标量限制后，阶段 4 一口气声明了 134 条，其中就有
 * `{"purchase":22,"inspection_part":0,…}`（成本分项）与
 * `[{"Z1":0,"Z2":0,…,"profit":21.68}, …]`（16 种候选策略）——
 * 第一版只收"平的数值数组"，于是 35 条被判非法。**这两种恰恰是画图最需要的**：
 * 瀑布图的分项名、热力图的横纵轴标签，都得靠 record 的字段名承载。
 */
export type NumericShape =
  /** 一个有限数。 */
  | 'scalar'
  /** 布尔（判定结果，0/1 语义）。 */
  | 'flag'
  /** 一维数值序列（参数扫描表、样本、收敛序列）。 */
  | 'series'
  /** 二维数值矩阵（组合成本表、混淆矩阵）。 */
  | 'matrix'
  /** ≥3 维数值张量（参数网格上的指标场）。 */
  | 'tensor'
  /** 具名字段集（`{purchase: 22, inspection_part: 0}`）——字段名就是图上的标签。 */
  | 'record'
  /** 记录数组（`[{Z1:0, profit:21.68}, …]`）——每行一条记录，天然是"表/热力图数据"。 */
  | 'table'
  /**
   * **字符串数组**（`["P1","P2","P3"]` / 二维的 `[["P1","P2"],["P3","P4"]]`）。
   *
   * 这是**分类轴**：类别名是图的一部分，不是杂质。实测：零配件分组
   * `blocks: [["P1","P2","P3"],["P4","P5","P6"],["P7","P8"]]` 正是组装拓扑图要的标签。
   */
  | 'labels'
  /**
   * **空数组**：`flip_examples: []` = "该情况没有翻转样本"。
   *
   * "没有"本身就是一条结论——判它非法等于逼执行者把空结果藏起来。
   */
  | 'empty'

/**
 * 判定值的形态；**叶子必须是有限数、布尔、或（仅限 record 字段的）字符串标签**，
 * 否则返回 `null`（不合法）。
 *
 * 严格性是刻意的：`NaN`/`Infinity` 画到图上会静默变成空白或断线，
 * 而"账本里有个坏数"在下游极难定位。
 *
 * 两处**刻意的不对称**：
 * - **字符串只允许出现在 record 的字段值上**（那是标签，如成本项名）。
 *   数值数组里出现字符串说明它是"标签列表"而不是数据——拒掉，
 *   否则图上会出现"某条曲线的一个点是 '采购'"这种说不清的东西。
 * - **混合形态的数组拒掉**（既有标量又有 record）：说不清它是什么，
 *   图也就画不出确定的东西。要混合就先在代码里拆成两条账目。
 */
export function numericShapeOf(value: unknown): NumericShape | null {
  if (typeof value === 'number') return Number.isFinite(value) ? 'scalar' : null
  if (typeof value === 'boolean') return 'flag'
  if (Array.isArray(value)) {
    // **空数组合法**：`flip_examples: []` 表示"该情况没有翻转样本"——
    // **"没有"本身就是一条结论**，判它非法等于逼模型把空结果藏起来。
    // （实测：problem4 第 2 行就是空数组，被旧判据判死。）
    if (value.length === 0) return 'empty'
    // **全字符串 = 标签数组**：`[["P1","P2","P3"],["P4","P5","P6"]]` 是零配件的分组名，
    // 而组装拓扑图**恰恰需要这些标签**（它们就是节点分组的名字）。
    // 旧判据把"数组里有字符串"一律拒掉，理由是"那是标签列表不是数据"——
    // 这条理由在**分类轴**上是错的：类别名是图的一部分，不是杂质。
    if (value.every(v => typeof v === 'string')) return 'labels'
    const inner = value.map(numericShapeOf)
    if (inner.some(s => s === null)) return null
    // **参差不齐的数组按"非空元素"判形态**：`[[], [1,2,3], [4]]` 是合法的
    // （有的行没有样本），不该因为混了空元素就整条作废。
    const nonEmpty = inner.filter(s => s !== 'empty')
    if (nonEmpty.length === 0) return 'empty'
    const only = nonEmpty[0]
    // 非空元素形态必须一致：一列里既有标量又有记录 = 说不清是什么
    if (nonEmpty.some(s => s !== only)) return null
    if (only === 'record') return 'table'
    if (only === 'scalar' || only === 'flag') return 'series'
    if (only === 'series') return 'matrix'
    if (only === 'matrix' || only === 'tensor') return 'tensor'
    if (only === 'table') return 'table'
    if (only === 'labels') return 'labels'
    return null
  }
  if (typeof value === 'object' && value !== null) {
    const vals = Object.values(value as Record<string, unknown>)
    if (vals.length === 0) return null // `{}` 仍拒绝：空对象说不清是什么
    const ok = vals.every(v =>
      typeof v === 'string' ? true // 标签（不是数，但它可溯源到代码产物本身）
        : typeof v === 'number' ? Number.isFinite(v)
          : typeof v === 'boolean' ? true
            : numericShapeOf(v) !== null)
    return ok ? 'record' : null
  }
  return null
}

/** 一次执行 + 铸造的结果。 */
export interface ExecuteMintResult {
  readonly exitCode: number
  readonly stderrTail: string
  readonly minted: number
  readonly ledgerPath: string
}

/** 解析"数在哪"声明文件。 */
export function parseResultSources(raw: string): ReadonlyArray<ResultSource> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${RESULT_SOURCES_FILE} 不是合法 JSON：${String(error).slice(0, 120)}`)
  }
  // **两种等价形态都收**：`{"sources": [...]}` 与**裸数组** `[...]`。
  //
  // 实测（2024B 阶段 4）：模型写了一整份合法的裸数组（134 条声明，字段齐备），
  // 却因为契约写的是 `{sources: [...]}` 而被判"缺 sources 数组"——**内容一字不缺，
  // 只是少了一层外壳**。这与围栏、`_figbase` 导出名单是同一类：形态的表述差异
  // 不该让内容作废。内容判据一条不放松：下面逐条核 result_id/name/locator/json_path。
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { sources?: unknown }).sources
  if (!Array.isArray(list)) {
    throw new Error(`${RESULT_SOURCES_FILE} 既不是 \`{"sources": […]}\`，也不是裸数组 —— `
      + '模型必须声明每个数在哪个产物的哪个路径')
  }
  return list.map((rawSource, i) => {
    if (typeof rawSource !== 'object' || rawSource === null) {
      throw new Error(`sources[${String(i)}] 不是对象`)
    }
    const s = rawSource as Record<string, unknown>
    const id = s['result_id']
    const name = s['name']
    const locator = s['locator']
    const path = s['json_path']
    if (typeof id !== 'string' || id.length === 0) throw new Error(`sources[${String(i)}] 缺 result_id`)
    if (typeof name !== 'string' || name.length === 0) throw new Error(`sources[${String(i)}]（${id}）缺 name`)
    if (typeof locator !== 'string' || locator.length === 0) {
      throw new Error(`sources[${String(i)}]（${id}）缺 locator —— 没有定位就无从铸数`)
    }
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`sources[${String(i)}]（${id}）缺 json_path —— 没有路径就无从铸数`)
    }
    return {
      result_id: id,
      name,
      locator,
      json_path: path,
      unit: typeof s['unit'] === 'string' ? s['unit'] : '',
    }
  })
}

/**
 * 真跑 `code/main.py` 并按声明铸数。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 铸造结论（进日志与检查点报告）。
 * @throws 代码非零退出、locator 读不到、值不是有限数时抛错（**具名**）。
 */
/**
 * 把题面事实放进**执行环境**（cwd = `code/`）。
 *
 * 为什么必须：执行环境的 cwd 是 `code/`，而 `PROBLEM_FACTS.json` 在 `01-prob-analysis/` ——
 * 契约要求 `data_check.py` 在运行时逐条核对事实的参数域与单位（我加的那条），于是代码
 * 会在运行时读它。不布进环境就是**契约要求一件环境里做不到的事**：实测冒烟运行报
 * `FileNotFoundError: PROBLEM_FACTS.json was not found`。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @param codeDir - 执行环境（`code/` 目录的绝对路径）。
 */
export async function stageCodeInputs(stagesRoot: string, codeDir: string): Promise<void> {
  const facts = join(stagesRoot, stageDirName(stageOf('prob-analysis')), 'PROBLEM_FACTS.json')
  if (existsSync(facts)) await copyFile(facts, join(codeDir, 'PROBLEM_FACTS.json')).catch(() => { /* 拷不了让运行时自己报 */ })
}

/**
 * 真跑 `code/main.py` 并按声明铸数。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 铸造结论（进日志与检查点报告）。
 * @throws 代码非零退出、locator 读不到、值不是有限数时抛错（**具名**）。
 */
export async function runCodeAndMintResults(stagesRoot: string): Promise<ExecuteMintResult> {
  const codeDir = join(stagesRoot, stageDirName(stageOf('code')), 'code')
  // RESULT_SOURCES 是**本阶段**（result-sources）的产物；代码在上一阶段（code）。
  const sourcesPath = join(stagesRoot, stageDirName(stageOf('result-sources')), RESULT_SOURCES_FILE)
  const raw = await readFile(sourcesPath, 'utf8').catch(() => null)
  if (raw === null) {
    throw new Error(`本阶段没有产出 ${RESULT_SOURCES_FILE} —— 模型必须声明每个数在哪个产物的哪个路径，`
      + '否则 harness 无从铸数（数不由模型持有）')
  }
  const sources = parseResultSources(raw)

  const entry = join(codeDir, CODE_ENTRY)
  if (!existsSync(entry)) {
    throw new Error(`代码入口不在：code/${CODE_ENTRY} —— 没有可执行的编排入口`)
  }
  // 执行环境先备好：题面事实进 cwd（data_check 之类的预检脚本要在运行时读它）
  await stageCodeInputs(stagesRoot, codeDir)
  const timeoutMs = Number(process.env['PAPER_CODE_RUN_TIMEOUT_MS'] ?? '') > 0
    ? Number(process.env['PAPER_CODE_RUN_TIMEOUT_MS'])
    : 600_000
  // 计算的上限是**墙钟**：挂住的脚本不会吐令牌，看门狗那套对它不适用——
  // 这里的判据是"程序要么结束要么被杀"，600s 对竞赛级求解已宽裕且可调。
  const run = spawnSync('python', [CODE_ENTRY], {
    cwd: codeDir, encoding: 'utf8', timeout: timeoutMs,
  })
  if (run.error !== undefined) {
    throw new Error(`代码执行失败（spawn）：${String(run.error).slice(0, 160)}`)
  }
  if (run.status !== 0) {
    // **把运行时错误写回"写代码的那个阶段"**，并**把它标 stale**。
    //
    // 为什么必须写回：本阶段（数源声明）的失败**不是本阶段的错**——是阶段 3 交的代码跑不起来。
    // 而 `--stage-next` 只会重跑**本阶段**，拿同一份坏代码再跑一遍：实测一个变量名拼写错
    // （`at_palt` vs 它自己定义的 `at_p_alt`）让阶段 4 连撞 **9 次**，每次一次模型调用 + 一次
    // 代码执行，半个多小时全废，而错误信息从来没到过该看它的那个阶段。
    //
    // 为什么还要标 stale：光写回执不够——回执只有**阶段 3 被重跑**时才进得了简报，而
    // `resumePointOf` 会一直挑阶段 4（它是 stale，阶段 3 还是 passed）。实测第二轮又是
    // 15 次空转（新的错是 `OverflowError: int too large to convert to float`）。
    // 所以这里把阶段 3 **自身**标 stale（`markStaleFrom` 的语义是"保留目标、作废其下游"，
    // 不作废目标自己），再作废其下游——与 `--stage-rollback` 的两步完全一致。
    // 这样下一轮 `--stage-next` 就会先跑阶段 3，带着这条栈去改代码。
    //
    // 与"复核结论回灌"（`priorReviewFindings`）是同一类：**下游发现的错误必须能回到
    // 该负责的上游**，否则重试就是空转。
    const tail = (run.stderr || '(空)').split('\n').slice(-12).join('\n').slice(0, 2000)
    const reason = `阶段 4 真跑 code/${CODE_ENTRY} 失败（退出码 ${String(run.status ?? 'null')}）：`
      + `${(run.stderr || '').split('\n').filter(l => l.trim() !== '').slice(-1)[0]?.slice(0, 120) ?? '(空)'}`
      + ' —— 这是阶段 3 的代码跑不起来，已自动回滚'
    await writeFile(join(stagesRoot, stageDirName(stageOf('code')), RUNTIME_FAILURE_FILE),
      `<!-- 阶段 4 真跑 code/${CODE_ENTRY} 失败（退出码 ${String(run.status ?? 'null')}）；`
      + '这不是数源声明的问题，是阶段 3 交的代码跑不起来。修完代码再放行。 -->\n\n'
      + `${tail}\n`, 'utf8').catch(() => { /* 落盘失败不掩盖原失败 */ })
    // 自动回滚：阶段 3 自身标 stale + 作废其下游（两步，与 CLI 的 --stage-rollback 一致）
    const codeSpec = stageOf('code')
    const codePassport = await readPassport(stagesRoot, codeSpec).catch(() => null)
    if (codePassport !== null) {
      await writePassport(stagesRoot, { ...codePassport, status: 'stale', staleReason: reason })
        .catch(() => { /* 标不动也不掩盖原失败 */ })
    }
    await markStaleFrom(stagesRoot, 'code', reason).catch(() => { /* 同上 */ })
    throw new Error(`code/${CODE_ENTRY} 退出码 ${String(run.status ?? 'null')}（非 0）—— `
      + `stderr 末尾：${(run.stderr || '(空)').split('\n').slice(-4).join(' / ').slice(0, 240)}`
      + `（完整栈已写回阶段 3：${RUNTIME_FAILURE_FILE}；阶段 3 已自动回滚，下一轮会带着这条栈改代码）`)
  }

  // 铸数：每个声明都要在**真实产物字节**里解析出一个有限数。
  const minted: Array<MintedResultsFile['results'][number]> = []
  const problems: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    if (seen.has(source.result_id)) {
      problems.push(`result_id '${source.result_id}' 被声明了不止一次`)
      continue
    }
    seen.add(source.result_id)
    // locator 相对 `code/`。**同时容忍一种自然的误读**：写 `code/outputs.json`
    // （相对阶段目录的读法）。两种读法指向的都是同一个文件，而"数在哪"本身毫无歧义
    // ——为路径前缀的读法差异让整轮重跑作废，是把契约的表述问题算在执行者头上。
    // 契约侧同时加了正例（简报明写"写 `outputs.json`，不要写 `code/outputs.json`"），
    // 所以这里是容错，不是把两种写法都当规范。
    const candidates = source.locator.startsWith('code/')
      ? [source.locator, source.locator.slice('code/'.length)]
      : [source.locator]
    const found = candidates.map(c => join(codeDir, c)).find(p => existsSync(p))
    if (found === undefined) {
      problems.push(`${source.result_id}：locator '${source.locator}' 不存在 —— 代码没有写出声明的产物`)
      continue
    }
    const file = found
    const content = await readFile(file, 'utf8').catch(() => null)
    if (content === null) {
      problems.push(`${source.result_id}：locator '${source.locator}' 读不出来`)
      continue
    }
    let root: unknown
    try {
      root = JSON.parse(content)
    } catch (error) {
      problems.push(`${source.result_id}：locator '${source.locator}' 不是合法 JSON（${String(error).slice(0, 80)}）`)
      continue
    }
    // **容忍一种自然的误读**：把文件名当前缀写进 `json_path`。
    // 实测（2024B）：`locator` 已经是 `outputs.json`，而 `json_path` 写成
    // `outputs.meta.seed`——多了一层"文件名"当顶层键。这与 `locator` 写成
    // `code/outputs.json` 是同一类误读（两种读法指向同一位置），
    // 而契约侧已经为 locator 的同一误读做了容错。为表述差异让整轮铸数作废，
    // 是把契约的表述问题算在执行者头上。
    // 判据要窄：**只剥"与该 locator 同名的那一层前缀"**，不是"随便试几个前缀"。
    const resolved = resolveJsonPath(root, source.json_path)
    let value = resolved
    if (resolved === undefined) {
      const parts = source.locator.split('/').filter(x => x.length > 0)
      const last = parts[parts.length - 1] ?? ''
      const base = last.endsWith('.json') ? last.slice(0, -'.json'.length) : last
      if (base !== '' && source.json_path.slice(0, base.length + 1) === `${base}.`) {
        value = resolveJsonPath(root, source.json_path.slice(base.length + 1))
      }
    }
    // **允许标量之外的三种形态**（序列 / 矩阵 / 三维），这是本轮的关键放宽。
    //
    // 原来只收有限数，后果是**结构性的**：2024B 的账本 49 条全是标量点值，
    // 于是阶段 5 有 7 张图"无米下锅"只能申报放弃——灵敏度图要参数扫描表、
    // 蒙特卡洛要样本序列、热力图要组合矩阵、盈亏平衡要二维网格。
    // 每一条放弃都真实，但根因是**这里根本收不下数组**：即使阶段 3 算出了扫描表，
    // 铸数这一步也会把它判成"不是有限数"而整轮失败。所以"多画几张图"这个要求
    // 在放宽这里之前是**不可达**的。
    //
    // 仍然严查的是**元素**：不许 NaN/Infinity/字符串/对象/null —— 图上出现 NaN 是静默失败。
    const shape = numericShapeOf(value)
    if (shape === null) {
      problems.push(`${source.result_id}：json_path '${source.json_path}' 在 '${source.locator}' 里`
        + ` 解析到 ${JSON.stringify(value) ?? 'undefined'} —— 既不是有限数，也不是有限数构成的数组`
        + '（允许：标量 / 一维序列 / 二维矩阵 / 三维张量；元素必须都是有限数）')
      continue
    }
    minted.push({
      result_id: source.result_id,
      name: source.name,
      value: value as number | ReadonlyArray<unknown>,
      unit: source.unit,
      uncertainty: null,
      kind: shape,
    })
  }
  if (problems.length > 0) {
    throw new Error(`铸数失败（${String(problems.length)}/${String(sources.length)} 条声明没能从真实产物里解析出有限数）：`
      + problems.slice(0, 6).join('；'))
  }
  if (minted.length === 0) {
    throw new Error(`${RESULT_SOURCES_FILE} 的 sources 是空的 —— 没有声明任何数，下游图表无从取数`)
  }

  // 账本落在本阶段（result-sources）目录：它是本阶段 harness 侧铸出的产物。
  const ledgerPath = join(stagesRoot, stageDirName(stageOf('result-sources')), RESULTS_LEDGER_FILE)
  await mkdir(join(ledgerPath, '..'), { recursive: true })
  const ledger: MintedResultsFile = { results: minted }
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
  return {
    exitCode: run.status ?? 0,
    stderrTail: (run.stderr || '').split('\n').slice(-3).join(' / ').slice(0, 200),
    minted: minted.length,
    ledgerPath,
  }
}

/** 读铸出的账本（供阶段 4 的简报内联与门禁对账）。 */
export async function readMintedResults(stagesRoot: string): Promise<MintedResultsFile | null> {
  const path = join(stagesRoot, stageDirName(stageOf('result-sources')), RESULTS_LEDGER_FILE)
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { results?: unknown }
    if (!Array.isArray(parsed.results)) return null
    return { results: parsed.results as MintedResultsFile['results'] }
  } catch {
    return null
  }
}

/** 代码目录里的产物文件名（locator 合法性检查用）。 */
export async function codeOutputNames(stagesRoot: string): Promise<ReadonlyArray<string>> {
  const dir = join(stagesRoot, stageDirName(stageOf('code')), 'code')
  return (await readdir(dir).catch(() => [] as string[])).filter(n => n !== CODE_ENTRY)
}
