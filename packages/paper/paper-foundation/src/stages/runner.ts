/**
 * 阶段执行器 —— 按注册表跑 11 个阶段，逐阶段门禁 + 通行证 + 回滚。
 *
 * ## 它不碰 provider
 *
 * 执行器只依赖一个 `callModel(stage, prompt)` 回调。这样它**完全可测**（注入假调用器
 * 就能跑完整条链），也不必知道 provider 是真是假、是哪个中转。
 *
 * ## 阶段的产出怎么落盘：一个**明确的规则**，不是猜
 *
 * 一个阶段的产出可能是一份（阶段 7 的 `paper/main.md`）也可能是四份（阶段 1）。
 * 模型一次调用只返回一段文本，所以映射规则必须写死：
 *
 * | 产出份数 | 模型的回答形态 | 为什么 |
 * |---|---|---|
 * | **1 份** | **原文**（不带信封） | 阶段 2b 要写纯散文——套信封会把 JSON 解析风险引回来，而那正是分片要消灭的头号失败 |
 * | **≥2 份** | **JSON 信封** `{"files": {"<名>": "<内容>"}}` | 一份回答装多份产出；JSON 是本项目指定的传递媒介 |
 *
 * 信封缺文件、多文件、名字不对——**一律判失败并点名**，不"尽力猜哪个是哪个"。
 *
 * ## 失败语义（四档）
 *
 * - `passed`：门禁**全 0** → 签发通行证；
 * - `passed-unverified`：门禁有 `2`（无法判定）但**没有 `1`** → **签发通行证，并把
 *   `unverifiedGates` 记在证上**；
 * - `gate-failed`：门禁有 `1`（硬失败）→ 不签发，把下游标 stale，并报告建议回滚目标；
 * - `blocked`：上游没就绪（缺通行证 / stale / 摘要不符）→ 拒绝启动并点名是哪一环。
 *
 * ### 为什么 `2` **不阻断阶段**，而是"阻断 CLEAN"
 *
 * 第一版让 `2` 与 `1` 一样阻断。测试立刻撞出一个后果：**阶段 1 的 `capability_check`
 * 尚未实现（`2`），于是整条链一步都跑不动**。
 *
 * 两种语义都自洽，但后果差别很大：
 *
 * | 语义 | `2` 的含义 | 后果 |
 * |---|---|---|
 * | 阻断阶段（第一版） | "判不了就不许往下走" | **所有门禁实现完之前，系统完全不可运行** |
 * | 阻断 CLEAN（现行） | "判不了就不算通过，但**缺口如实记账**" | 链能跑；缺口进通行证、进交付档位 |
 *
 * 选后者，理由是它与本仓库**既有的交付阶梯**一致：`CLEAN / MARKED / DEGRADED / ESCALATE`
 * 本来就是"检出问题但如实标注、不零掉产物"的机制。而"`2` 不等于通过"这条纪律**没有丢**
 * ——它变成了**通行证上的 `unverifiedGates`**：谁想宣称 CLEAN，就得先把这些缺口补上。
 *
 * **不许把 `2` 当 `0`** 这条仍然成立：`passed-unverified` 与 `passed` 是两个不同的状态，
 * 交付侧按前者降档。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/runner
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { compressForModeling, shouldCompress } from './context-compression.ts'
import { dirname, join } from 'node:path'
import { stageBriefing } from './briefing.ts'
import { runGates, type GateInput } from './gates.ts'
import {
  artifactDigests,
  markStaleFrom,
  passportFor,
  readPassport,
  stageReady,
  writePassport,
  type GateVerdict,
  type StagePassport,
} from './handoff.ts'
import { STAGES, stageDirName, type StageId, type StageSpec } from './registry.ts'

/** 执行器需要的外部能力（注入，便于测试与替换 provider）。 */
export interface StageRunContext {
  /** `stages/` 根目录。 */
  readonly stagesRoot: string
  /** 跑一次模型调用（阶段简报 → 回答文本）。只对 `kind === 'model'` 的阶段调用。 */
  readonly callModel: (stage: StageSpec, prompt: string) => Promise<string>
  /** 本阶段技能的版本（进 `inputDigest`；技能改了旧通行证就失效）。 */
  readonly skillVersionOf: (stage: StageSpec) => string
  /** 本阶段门禁的版本（同上）。 */
  readonly gateVersionOf: (stage: StageSpec) => string
  /**
   * 确定性阶段的执行体（harness 侧计算）。
   *
   * 缺省时确定性阶段**不产出任何文件**——那会让它的门禁失败（文件不存在），
   * 这是有意的：**没实现的确定性阶段不许静默通过**。
   */
  readonly runDeterministic?: (stage: StageSpec, stagesRoot: string) => Promise<void>
  /**
   * 模型阶段的 **harness 侧后处理**（可选）。
   *
   * 为什么要有它：阶段 3 的"数从哪来"收归 harness——模型写代码并声明数在哪
   * （`RESULT_SOURCES.json`），harness 在模型回答落盘**之后**真跑代码、按声明
   * 从产物字节里铸出 `results.json`。不挂这个钩子，阶段 3 就只产出文本，
   * 账本不存在，下游图表无从取数。
   */
  readonly afterModel?: (stage: StageSpec, stagesRoot: string) => Promise<void>
  /** 阶段是否挂了只读工具（影响简报是否列语料索引）。 */
  readonly toolsMounted?: (stage: StageSpec) => boolean
  /** 时钟（测试可注入）。 */
  readonly now?: () => string
}

/** 一个阶段的结果。 */
export interface StageOutcome {
  readonly stage: StageId
  readonly status: 'passed' | 'passed-unverified' | 'gate-failed' | 'blocked'
  readonly gate: GateVerdict
  readonly passport?: StagePassport
  /** `gate-failed` 且本阶段声明了回滚目标时，**建议回到哪个阶段**（执行器不擅自重跑）。 */
  readonly suggestedRollbackTo?: StageId
  /** 被标 stale 的下游阶段（`gate-failed` 时）。 */
  readonly staledDownstream?: ReadonlyArray<StageId>
  readonly reason: string
}

/**
 * 把模型的回答映射成 `文件 → 内容`。
 *
 * 规则见模块头：1 份产出取原文，≥2 份取 JSON 信封。
 *
 * @param spec - 阶段。
 * @param text - 模型的回答。
 * @returns 文件映射；形态不合法时抛错（**不尽力猜**）。
 */
export function parseStageOutput(spec: StageSpec, text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  // 单/多产出的判定只看**模型要交付的**产物：harness 铸的（results.json）不在
  // 模型回答里，数进判定会让单产出阶段被误判成"必须 JSON 信封"。
  // 目录型产物**算模型交付**（逐问代码 `code/`、改进轮次 `paper/_improvement_rounds/`
  // 都由模型经前缀键写出来）。
  const modelOwned = spec.produces.filter(p => p.harnessMinted !== true)
  if (modelOwned.length === 1 && modelOwned[0]?.kind !== 'dir') {
    const only = modelOwned[0]
    if (only === undefined) throw new Error(`stage '${spec.id}' declares no deliverable`)
    out.set(only.file, text)
    return out
  }
  // ≥2 份：要 JSON 信封。
  //
  // **候选阶梯，而不是单一规则**。真实运行（2024B-stages-1）实测：模型会先写
  // 数百 KB 的推理散文再给信封，而散文里也有 `{`——"取第一个 { 到最后一个 }"
  // 拿到的片段根本不是信封。阶梯每一级都是**确定性的**，逐级尝试；全部失败时把
  // 每一级的证据一起点名（不静默取其一，也不"尽力猜哪份是哪份"）。
  const trimmed = text.trim()
  const attempts: Array<{ readonly label: string; readonly text: string }> = [
    { label: '整个回答', text: trimmed },
  ]
  // 契约锚：顶层键必须是 `files`。从**最后一个** `"files"` 往前找它所属的 `{`——
  // 模型先推理后产出，真信封在末尾；散文里引用的 `{"files"}` 在它前面。
  const anchor = trimmed.lastIndexOf('"files"')
  if (anchor > 0) {
    const brace = trimmed.lastIndexOf('{', anchor)
    if (brace >= 0) {
      // 从锚点做**括号配平扫描**取完整对象：真实运行实测，信封之后还拖着尾巴
      // （结尾围栏/一句收尾话），切到文本末尾会报 "after JSON at position …"。
      // 扫描按字符串/转义感知配平，拿到对象的真实终点——确定性的，不是猜。
      const end = balancedEnd(trimmed, brace)
      if (end > brace) attempts.push({ label: `契约锚（最后一个 "files" 所属的完整对象，${String(brace)}…${String(end)}）`, text: trimmed.slice(brace, end + 1) })
      attempts.push({ label: `契约锚到文本末尾（偏移 ${String(brace)}）`, text: trimmed.slice(brace) })
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    attempts.push({ label: `第一个 { 到最后一个 }（${String(start)}…${String(end)}）`, text: trimmed.slice(start, end + 1) })
  }
  const failures: string[] = []
  for (const attempt of attempts) {
    let parsed: { files?: unknown }
    try {
      parsed = JSON.parse(attempt.text) as { files?: unknown }
    } catch (error) {
      failures.push(`[${attempt.label}] ${String(error).slice(0, 120)}`)
      continue
    }
    const files = parsed.files
    if (typeof files !== 'object' || files === null || Array.isArray(files)) {
      failures.push(`[${attempt.label}] 有 JSON 但没有 "files" 对象`)
      continue
    }
    return envelopesOf(spec, files as Record<string, unknown>)
  }
  throw new Error(`stage '${spec.id}' declares ${String(spec.produces.length)} deliverables, so the answer must be a JSON envelope {"files": {...}}`
    + ` —— 没有一个候选能解析出信封：${failures.join('；')}`)
}

/** 信封形态校验：缺文件、多文件、名字不对——一律判失败并点名（不"尽力猜"）。 */
function envelopesOf(spec: StageSpec, files: Record<string, unknown>): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  // harness 铸的产物（`results.json`）**不在**模型回答的信封契约里——
  // 它由 afterModel 从真实执行的产物字节里铸出，模型根本没见过它。
  const expected = new Set(spec.produces.filter(p => p.kind !== 'dir' && p.harnessMinted !== true).map(p => p.file))
  // 目录型产物（阶段 3 的 `code/`）**以目录为契约**：里面的文件名由模型按题面定
  // （逐问一个 `problem*.py`，问数是题面决定的，写不进静态的 produces 列表）。
  // 所以"契约内"= 精确名 ∪ 目录前缀；前缀之外的仍然算多出来。
  const dirPrefixes = spec.produces.filter(p => p.kind === 'dir').map(p => p.file)
  // **目录回声**：简报的契约节会列出 `code/`（dir）这样的条目，模型有理由把它
  // 也当成一个键抄回来（2024B 阶段 3 实测）。它不承载文件内容——只要该前缀下
  // 真有文件，就认出这是回声并忽略（**并且点名**，不静默）；前缀下一个文件都
  // 没有，就不是回声而是缺文件，照常判失败。
  const got = Object.keys(files)
  const echoed = got.filter(f => dirPrefixes.some(d => d.replace(/\/+$/, '') === f.replace(/\/+$/, '')))
  const fileKeys = got.filter(f => !echoed.includes(f))
  const missing = [...expected].filter(f => !fileKeys.includes(f))
  const covered = dirPrefixes.filter(d => fileKeys.some(f => f.startsWith(d.replace(/\/+$/, '') + '/')))
  const uncovered = dirPrefixes.filter(d => !covered.includes(d))
  const extra = fileKeys.filter(f => !expected.has(f) && !dirPrefixes.some(d => f.startsWith(d.replace(/\/+$/, ''))))
  if (uncovered.length > 0) {
    throw new Error(`stage '${spec.id}' envelope has no file under the declared dir produce(s) `
      + `${uncovered.join('、')} —— 只回声了目录名、没有给出其中的文件`)
  }
  // **缺与多都判失败**：静默接受"多出来的文件"会让阶段悄悄产出契约外的产物。
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `stage '${spec.id}' envelope does not match its contract —`
      + (missing.length > 0 ? ` missing: ${missing.join('、')};` : '')
      + (extra.length > 0 ? ` unexpected: ${extra.join('、')};` : '')
      + ` expected exactly: ${[...expected].join('、')}`
      + (dirPrefixes.length === 0 ? '' : `（或 ${dirPrefixes.join('、')} 之下的任意文件）`),
    )
  }
  for (const [name, body] of Object.entries(files)) {
    if (echoed.includes(name)) continue // 目录回声：不落盘（上面的 uncovered 检查已确认前缀下有真文件）
    if (typeof body !== 'string') throw new Error(`stage '${spec.id}' file '${name}' is not a string`)
    out.set(name, body)
  }
  return out
}

/**
 * 从 `start` 的 `{` 起做字符串/转义感知的括号配平，返回配平的 `}` 的下标；配不平返回 -1。
 */
export function balancedEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i] ?? ''
    if (inString) {
      if (escaped) escaped = false
      else if (ch === String.fromCharCode(92)) escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 读上游产物文本（供简报内联）。
 *
 * **`00-input/` 也要读**：题面与附件是阶段 1 的 `consumes`，而阶段 1 的模型必须
 * 看得见题面——跳过它们，简报就会是一份"分析一个你看不见的题"的指令。第一版
 * 跳过是按"外部输入由调用方另行注入"写的，但调用方（`stage-service.ts`）把题面
 * 落盘到 `00-input/problem.txt` 之后，这条路就是唯一通路。缺失的文件照旧不出现
 * （缺失在简报里如实体现，不假装是空串）。
 */
/** 单份上游产物的内联预算（字符）。env 可调；默认 24000——超出才压。 */
function inlineBudget(): number {
  const raw = Number(process.env['PAPER_STAGE_INLINE_BUDGET'] ?? '')
  return Number.isFinite(raw) && raw > 0 ? raw : 24_000
}

async function upstreamTextOf(stagesRoot: string, spec: StageSpec): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const budget = inlineBudget()
  for (const path of spec.consumes) {
    const text = await readFile(join(stagesRoot, path), 'utf8').catch(() => null)
    if (text === null) continue
    if (!shouldCompress(text, budget)) {
      out.set(path, text)
      continue
    }
    // 数学建模语境的结构保持压缩：数字/锚点/表格/代码逐字保留，只削散文。
    // 压缩要**明说**——模型得知道读的是节选，且头部记录压了多少（可审计）。
    const { text: compressed, report } = compressForModeling(text, budget)
    const note = [
      '<!-- 上游产物超过内联预算，已按数学建模语境压缩：',
      '     数字/锚点/表格/代码逐字保留（一个不少），散文只留段首句；',
      `     原文 ${String(report.originalChars)} 字 → ${String(report.compressedChars)} 字。`,
      '     若需要未压缩原文，向检查人申请。 -->',
    ].join('\n')
    out.set(path, `${note}\n${compressed}`)
  }
  return out
}

/** 目录型产物的展开深度上限（`figures/` 是平的，`paper/_improvement_rounds/` 也只一层）。 */
const DIR_PRODUCE_DEPTH = 2

/** 被拒回答的留档名（阶段目录内）。失败要能诊断，原始回答就是证据。 */
export const REJECTED_ANSWER_FILE = '_rejected-answer.txt'

/** 门禁逐条结论的留档名（阶段目录内）。检查人放行/否决看的是它，不是 id 列表。 */
export const GATE_REPORT_FILE = '_gate-report.json'

/** 文本类产物（读进来给门禁判）。其余（docx/png/xlsx）只记字节数——按 utf8 读二进制会改长度。 */
const TEXT_KINDS = /\.(md|json|py|svg|tex|csv|txt|ya?ml|html)$/i

/**
 * 递归收一个目录型产物。
 *
 * **为什么要展开目录**：阶段 4/5 的产物主体就是 `figures/` 里的图，而门禁
 * （对账、风格、几何）判的正是那些文件。不展开的话"目录型产物"对门禁不可见，
 * 于是"计划里的图都渲染出来了吗"只能靠人看——那正是注册表 `produces` 这一列
 * 要消灭的东西。
 */
async function collectDir(
  absDir: string,
  relPrefix: string,
  depth: number,
  files: Map<string, string>,
  sizes: Map<string, number>,
): Promise<void> {
  if (depth > DIR_PRODUCE_DEPTH) return
  // 前缀里的尾斜杠要剥掉：注册表写的是 `code/`（人读友好），但拼出来会变成
  // `code//problem1.py`，于是 `^code/problem.*\.py$` 这类判据全部落空——
  // 实测抓到的 bug（阶段 3 的 `code_parity` 因此判 1）。
  const prefix = relPrefix.replace(/\/+$/, '')
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const abs = join(absDir, entry.name)
    if (entry.isDirectory()) {
      await collectDir(abs, rel, depth + 1, files, sizes)
      continue
    }
    const info = await stat(abs).catch(() => null)
    if (info === null) continue
    sizes.set(rel, info.size)
    if (!TEXT_KINDS.test(rel)) continue
    const text = await readFile(abs, 'utf8').catch(() => null)
    if (text !== null) files.set(rel, text)
  }
}

/** 读阶段目录内的产物文本与字节数（供门禁）。 */
async function stageFilesOf(
  stagesRoot: string,
  spec: StageSpec,
): Promise<{ readonly files: Map<string, string>; readonly sizes: Map<string, number> }> {
  const dir = join(stagesRoot, stageDirName(spec))
  const files = new Map<string, string>()
  const sizes = new Map<string, number>()
  for (const p of spec.produces) {
    if (p.kind === 'dir') {
      await collectDir(join(dir, p.file), p.file, 1, files, sizes)
      continue
    }
    const abs = join(dir, p.file)
    const info = await stat(abs).catch(() => null)
    if (info === null) continue
    sizes.set(p.file, info.size)
    if (!TEXT_KINDS.test(p.file)) continue
    const text = await readFile(abs, 'utf8').catch(() => null)
    if (text !== null) files.set(p.file, text)
  }
  return { files, sizes }
}

/**
 * 声明的产物**齐了没有**。
 *
 * `produces` 这一列的全部意义就是"产出齐没齐可以机械判"（注册表模块头）。少了这一
 * 步，一个"什么都没产出"的阶段会因为门禁恰好没查那个文件而拿到 `passed`——
 * 那比没有门禁更糟：它让"通过"这个事实变成假的。
 *
 * @returns 缺失的产物名（空 = 齐）。
 */
async function missingDeliverables(stagesRoot: string, spec: StageSpec): Promise<ReadonlyArray<string>> {
  const dir = join(stagesRoot, stageDirName(spec))
  const missing: string[] = []
  for (const p of spec.produces) {
    if (p.kind === 'dir') {
      const entries = await readdir(join(dir, p.file)).catch(() => null)
      if (entries === null || entries.length === 0) missing.push(`${p.file}（目录为空或不存在）`)
      continue
    }
    const info = await stat(join(dir, p.file)).catch(() => null)
    if (info === null || !info.isFile() || info.size === 0) missing.push(p.file)
  }
  return missing
}

/**
 * 跑一条阶段链。
 *
 * 默认从第 1 阶段跑到第 11 阶段；遇到 `blocked` 或 `gate-failed` **立即停**
 * （后续阶段的前提已经不成立，继续跑只会产出不一致的包）。
 *
 * @param ctx - 注入的能力。
 * @param options - `only` 限定只跑某些阶段（调试用）；`problemCount` 供逐问判据。
 * @returns 逐阶段结果（含失败原因与建议回滚目标）。
 */
export async function runStages(
  ctx: StageRunContext,
  options: { readonly only?: ReadonlyArray<StageId>; readonly problemCount?: number } = {},
): Promise<ReadonlyArray<StageOutcome>> {
  const outcomes: StageOutcome[] = []
  const targets = options.only === undefined
    ? STAGES
    : STAGES.filter(s => options.only?.includes(s.id) === true)
  for (const spec of targets) {
    const skillVersion = ctx.skillVersionOf(spec)
    const gateVersion = ctx.gateVersionOf(spec)
    const ready = await stageReady(ctx.stagesRoot, spec, skillVersion, gateVersion)
    if (!ready.ok) {
      outcomes.push({
        stage: spec.id, status: 'blocked', gate: { code: 2, items: [] },
        reason: ready.reason,
      })
      break
    }

    const dir = join(ctx.stagesRoot, stageDirName(spec))
    await mkdir(dir, { recursive: true })
    let rejectedAnswer: string | undefined
    try {
      if (spec.kind === 'model') {
        const prompt = stageBriefing(spec, await upstreamTextOf(ctx.stagesRoot, spec), ctx.toolsMounted?.(spec) === true)
        const answer = await ctx.callModel(spec, prompt)
        rejectedAnswer = answer
        for (const [name, body] of parseStageOutput(spec, answer)) {
          const file = join(dir, name)
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, body, 'utf8')
        }
      } else {
        // 确定性阶段：执行体缺省时**什么都不做** → 门禁会因文件不存在而失败。
        // 这是有意的：没实现的确定性阶段不许静默通过。
        await ctx.runDeterministic?.(spec, ctx.stagesRoot)
      }
      // 模型阶段的 harness 侧后处理（阶段 3：真跑代码并铸数）。放在**同一个
      // try** 里——执行失败与产出形态失败是同一类"本阶段没跑成"，都具名失败。
      if (spec.kind === 'model') await ctx.afterModel?.(spec, ctx.stagesRoot)
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      // **被拒的回答要留档**：没有它，"信封不是合法 JSON"这类失败无法诊断——
      // 模型到底写了什么、差在哪个字符、是截断还是包了散文。这是真实运行
      // （2024B-stages-1 第一次就撞上）换来的观测点：失败只留一句 SyntaxError，
      // 而原始回答被丢掉，检查点报告就写不出"错误形态/根因"。
      if (rejectedAnswer !== undefined) {
        await writeFile(join(dir, REJECTED_ANSWER_FILE),
          `<!-- 拒绝原因：${message.replace(/--/g, '——')} -->\n\n${rejectedAnswer}\n`, 'utf8')
          .catch(() => { /* 落盘失败不掩盖原失败 */ })
      }
      outcomes.push({
        stage: spec.id, status: 'gate-failed',
        gate: { code: 1, items: [{ id: 'stage_output', ok: false, detail: message }] },
        ...(spec.rollbackTo.length === 0 ? {} : { suggestedRollbackTo: spec.rollbackTo[0] as StageId }),
        reason: `阶段产出未通过形态检查：${message}`
          + (rejectedAnswer === undefined ? '' : `（原始回答已留档：${REJECTED_ANSWER_FILE}）`),
      })
      break
    }

    // 声明的产物齐不齐 —— 在跑门禁**之前**判。一个什么都没产出的阶段不该有机会
    // 因为"门禁恰好没查那个文件"而拿到 passed。
    const missing = await missingDeliverables(ctx.stagesRoot, spec)
    if (missing.length > 0) {
      outcomes.push({
        stage: spec.id, status: 'gate-failed',
        gate: { code: 1, items: [{ id: 'stage_deliverable_missing', ok: false, detail: `声明的产物缺失或为空：${missing.join('、')}` }] },
        ...(spec.rollbackTo.length === 0 ? {} : { suggestedRollbackTo: spec.rollbackTo[0] as StageId }),
        reason: `门禁前置不成立：本阶段声明的 ${String(missing.length)} 项产物不存在或为空（${missing.join('、')}）`
          + '—— 产出齐备是门禁的前提，"没产出"不许被当成"通过"',
      })
      break
    }

    const stageFiles = await stageFilesOf(ctx.stagesRoot, spec)
    const gateInput: GateInput = {
      files: stageFiles.files,
      sizes: stageFiles.sizes,
      upstream: new Map([...await upstreamTextOf(ctx.stagesRoot, spec)].map(([k, v]) => [k.split('/').pop() ?? k, v])),
      problemCount: options.problemCount ?? 0,
    }
    const gate = runGates(spec.gates, gateInput)
    // **门禁逐条结论要留在产物旁边**。运行器对外的 reason 只点名门禁 id，而
    // "哪一条、什么证据"是检查人放行/否决的依据——2024B 阶段 4 实测：两个门禁
    // 失败，日志里却只有 id，细节得手动重跑门禁才能拿到。与 _rejected-answer.txt
    // 同一条纪律：失败要可诊断。
    await writeFile(join(dir, GATE_REPORT_FILE),
      `${JSON.stringify({ stage: spec.id, code: gate.code, items: gate.items }, null, 2)}
`, 'utf8')
      .catch(() => { /* 落盘失败不掩盖门禁结论本身 */ })
    // `1` = 硬失败 → 阻断；`2` = 无法判定 → **不阻断阶段，但记账**（见模块头的取舍）
    if (gate.code === 1) {
      // 门禁不过 → 不签发；把**下游**标 stale（它们的输入前提已经不成立）
      const staled = await markStaleFrom(
        ctx.stagesRoot, spec.id,
        `阶段 '${spec.id}' 门禁未通过（code ${String(gate.code)}）—— 下游前提不成立`,
      )
      outcomes.push({
        stage: spec.id, status: 'gate-failed', gate,
        ...(spec.rollbackTo.length === 0 ? {} : { suggestedRollbackTo: spec.rollbackTo[0] as StageId }),
        staledDownstream: staled,
        reason: `门禁 code ${String(gate.code)}（0=通过 1=硬失败 2=无法判定）：`
          + gate.items.filter(i => !i.ok).map(i => i.id).join('、'),
      })
      break
    }

    const unverified = gate.items.filter(i => !i.ok).map(i => i.id)
    const passport = passportFor(spec, {
      upstreamDigests: await upstreamDigestList(ctx, spec),
      skillVersion, gateVersion,
      artifacts: await artifactDigests(dir, spec.produces),
      gate,
      unverifiedGates: unverified,
      ...(ctx.now === undefined ? {} : { now: ctx.now() }),
    })
    await writePassport(ctx.stagesRoot, passport)
    outcomes.push({
      stage: spec.id,
      status: unverified.length === 0 ? 'passed' : 'passed-unverified',
      gate, passport,
      reason: unverified.length === 0
        ? '门禁全过，已签发通行证'
        : `门禁全过但**有 ${String(unverified.length)} 条无法判定**（${unverified.join('、')}）——`
          + '已如实记在通行证上；这些缺口使本阶段不能计入 CLEAN。',
    })
  }
  return outcomes
}

/** 上游通行证的摘要列表（按阶段序号）。 */
async function upstreamDigestList(ctx: StageRunContext, spec: StageSpec): Promise<ReadonlyArray<string>> {
  const out: string[] = []
  for (const up of STAGES.filter(s => s.index < spec.index)) {
    const passport = await readPassport(ctx.stagesRoot, up)
    out.push(passport === null ? '' : passport.inputDigest)
  }
  return out
}
