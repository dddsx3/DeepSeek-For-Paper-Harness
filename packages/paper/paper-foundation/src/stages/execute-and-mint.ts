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
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveJsonPath } from '../produce/interpretation-producer.ts'
import { stageDirName, stageOf } from './registry.ts'

/** 阶段 3 的"数在哪"声明文件名。 */
export const RESULT_SOURCES_FILE = 'RESULT_SOURCES.json'

/** harness 铸出的结果账本（下游图表渲染的唯一取数口）。 */
export const RESULTS_LEDGER_FILE = 'results.json'

/** 代码执行入口（相对 `code/`）。 */
export const CODE_ENTRY = 'main.py'

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
    readonly value: number
    readonly unit: string
    readonly uncertainty: number | null
  }>
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
  const obj = parsed as { sources?: unknown }
  if (!Array.isArray(obj.sources)) {
    throw new Error(`${RESULT_SOURCES_FILE} 缺 "sources" 数组 —— 模型必须声明每个数在哪个产物的哪个路径`)
  }
  return obj.sources.map((rawSource, i) => {
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
    throw new Error(`code/${CODE_ENTRY} 退出码 ${String(run.status ?? 'null')}（非 0）—— `
      + `stderr 末尾：${(run.stderr || '(空)').split('\n').slice(-4).join(' / ').slice(0, 240)}`)
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
    const value = resolveJsonPath(root, source.json_path)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${source.result_id}：json_path '${source.json_path}' 在 '${source.locator}' 里`
        + ` 解析到 ${JSON.stringify(value) ?? 'undefined'} —— 不是有限数（图里出现 NaN 是静默失败）`)
      continue
    }
    minted.push({
      result_id: source.result_id,
      name: source.name,
      value,
      unit: source.unit,
      uncertainty: null,
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
