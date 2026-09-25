/**
 * 门禁（TS 重写）—— 0 通过 / 1 硬失败 / **2 无法判定**。
 *
 * ## 三条纪律
 *
 * 1. **移植意图，不移植字面比较**。参考里有些判据写得很弱，例如
 *    `leakage_audit.py` 的判据是"`≠ 1` 算过"——那意味着 `RC=2`（无法判定）也放行。
 *    这条**不移植**：本文件里 `2` 一律不算通过。
 * 2. **未实现的判据给 `2` 并写明原因，绝不给 `0`**。给 `0` 是静默放行，比没有门禁更糟
 *    ——它会让"通过"这个事实变成假的。
 * 3. **判据只读文本**。门禁是纯函数：输入是产物文本，输出是结论。不碰网络、不碰模型、
 *    不碰时钟。这样它可测、可复算、可进审计轨迹。
 *
 * ## 哪些是"真的判据"、哪些是"暂未实现"
 *
 * 参考的门禁分两类：
 * - **机械可判**（字节地板、文件存在、正则、条目数、锚点形态、**与清单对账、
 *   声明里的引用解析、SVG 字节上的风格与几何**）→ 本文件实现；
 * - **需要真实计算**（`capability_check` 要跨文件比对能力项、`modeling_coverage` 要
 *   逐条核对建模落地、`delivery_audit` 要核对声明的交付物是否真存在且非空、
 *   `paper_claim_check` 要核对 claim 上游落地）→ 本文件**显式给 2**，并在 `detail`
 *   里写明"需要什么才算实现"。
 *
 * 后一类不是"忘了写"，是**如实标注能力边界**——它们的实现各自需要一次专门的设计
 * （见 `artifacts/upper-bound/ROUND-*` 的方法论）。
 *
 * ## 已实现 / 未实现的分界**由测试钉住**
 *
 * `gates.spec.ts` 里那份"未实现清单"是**断言**：实现一条就从清单里删一条。
 * 于是"哪些判据其实没跑"永远可回答——它不会随着时间悄悄变成"都实现了"。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/gates
 */

import { checkArchitectureAlignment, type ArchLayout } from '../figure/architecture.ts'
import { estimateLabelPx } from '../figure/axis-labels.ts'
import { checkFigureQuality } from '../figure/quality-check.ts'
import { parseDiagramManifestFile } from './diagram-render.ts'
import { docxPrecheckFatal, resolveDocxProfile } from './docx-profile.ts'
import { FIGURE_DECLARATIONS_FILE, FIGURE_MANIFEST_FILE, parseFigureDeclarations, parseFigureManifestFile } from './figure-render.ts'
import { RESULTS_LEDGER_FILE } from './execute-and-mint.ts'
import { architectureFigureNames, dataFigureNames, parseFigureManifest } from './figure-manifest.ts'
import type { GateVerdict } from './handoff.ts'

/** 门禁的输入：产物文本（由调用方读盘后传入，门禁本身不碰文件系统）。 */
export interface GateInput {
  /** 本阶段目录内 `文件相对名 → 文本`。缺失的文件不出现。**二进制产物不在里面**。 */
  readonly files: ReadonlyMap<string, string>
  /**
   * 产物的**真实字节数**（由调用方 stat 得到）。
   *
   * 为什么不能拿文本长度代替：`docx`/`png` 这类二进制按 utf8 读会改长度，
   * 于是"文件是不是空壳"这个判据会变成一个错的数。文本产物两边的数一致，
   * 但判据只该有一个来源。
   */
  readonly sizes?: ReadonlyMap<string, number>
  /** 上游阶段目录内 `相对路径 → 文本`（供跨阶段判据使用）。 */
  readonly upstream: ReadonlyMap<string, string>
  /** 题面的子问题数（`count_subproblems` 的等价物）。 */
  readonly problemCount: number
}

type GateFn = (input: GateInput) => GateVerdict

const ok = (id: string, detail: string): GateVerdict => ({ code: 0, items: [{ id, ok: true, detail }] })
const fail = (id: string, detail: string): GateVerdict => ({ code: 1, items: [{ id, ok: false, detail }] })
const cannot = (id: string, detail: string): GateVerdict => ({ code: 2, items: [{ id, ok: false, detail }] })

/** 取文件文本；缺失返回 null（**不返回空串**——空串会让"文件不存在"和"文件是空的"混为一谈）。 */
function text(input: GateInput, name: string): string | null {
  return input.files.get(name) ?? null
}

/** 字节地板：参考用 `wc -c`，这里用 UTF-8 字节数（与 `wc -c` 一致，**不是字符数**）。 */
function byteFloor(input: GateInput, id: string, name: string, min: number): GateVerdict {
  const body = text(input, name)
  if (body === null) return fail(id, `${name} 不存在（地板 ${String(min)} 字节）`)
  const bytes = Buffer.byteLength(body, 'utf8')
  return bytes >= min
    ? ok(id, `${name} ${String(bytes)} 字节 ≥ ${String(min)}`)
    : fail(id, `${name} 只有 ${String(bytes)} 字节（低于 ${String(min)} 字节的下限）`)
}

/**
 * 参考工作流的 `leakage_audit` —— 分类指标 ≥0.99 且无去泄漏证据即硬失败。
 *
 * **参考的写法是 `RC ≠ 1 算过`，这里不沿用**：`2` 一律不算通过。本实现只做
 * "能看到的"那一半——扫描产物文本里是否出现 ≥0.99 的指标却没有任何去泄漏说明。
 * 真正的去泄漏判定需要看代码与数据划分，属未实现部分。
 */
const leakageAudit: GateFn = (input) => {
  const id = 'leakage_audit'
  const bodies = [...input.files.values()].join('\n')
  const suspicious = /0\.9[9]\d*|1\.000|100\.0\s*%/.test(bodies)
  if (!suspicious) return ok(id, '未发现 ≥0.99 的分类指标（无需去泄漏证据）')
  const hasEvidence = /去泄漏|de[- ]?leak|泄漏|train[_ ]?test[_ ]?split|划分/.test(bodies)
  return hasEvidence
    ? ok(id, '出现 ≥0.99 的指标，且产物里有去泄漏说明')
    : fail(id, '出现 ≥0.99 的分类指标，但产物里没有任何去泄漏证据（参考口径：这是硬失败）')
}

/** 参考 `no_render` 的意图：阶段 3 **不得产出图像字节**（渲染是阶段 4 的事）。 */
const noRender: GateFn = (input) => {
  const id = 'no_render'
  const images = [...input.files.keys()].filter(f => /\.(png|jpg|jpeg|pdf|svg)$/i.test(f))
  return images.length === 0
    ? ok(id, '没有图像产物（渲染归阶段 4）')
    : fail(id, `本阶段产出了图像：${images.join('、')} —— 渲染是阶段 4 的事，本阶段只声明`)
}

/** 参考的 LaTeX 残留正则（阶段 7 的核心门禁之一）。 */
const LATEX_RESIDUE = /\\(begin|end|input|cite|ref|label|includegraphics|section|chapter|subsection|bibitem|usepackage|documentclass)\{/

const noLatexResidue: GateFn = (input) => {
  const id = 'no_latex_residue'
  const body = text(input, 'paper/main.md')
  if (body === null) return fail(id, 'paper/main.md 不存在')
  const hit = LATEX_RESIDUE.exec(body)
  if (hit !== null) return fail(id, `正文里出现 LaTeX 命令 \`${hit[0]}\` —— 论文是 Markdown，不得含 LaTeX 结构`)
  const texFiles = [...input.files.keys()].filter(f => f.endsWith('.tex'))
  return texFiles.length === 0
    ? ok(id, '无 LaTeX 残留、无 .tex 产物')
    : fail(id, `产出了 .tex 文件：${texFiles.join('、')}`)
}

/** 参考的页数地板：正文（附录之前）字符数 / 800 ≥ 目标页数。 */
const paperPageFloor: GateFn = (input) => {
  const id = 'paper_page_floor'
  const body = text(input, 'paper/main.md')
  if (body === null) return fail(id, 'paper/main.md 不存在')
  const beforeAppendix = body.split(/^##\s*附录/m)[0] ?? body
  const chars = beforeAppendix.replace(/\s+/g, '').length
  const pages = Math.floor(chars / 800)
  return pages >= 20
    ? ok(id, `正文约 ${String(pages)} 页（≥20）`)
    : fail(id, `正文约 ${String(pages)} 页（字符 ${String(chars)}）—— 低于 20 页下限`)
}

/** 逐问奇偶校验：代码文件数必须 ≥ 题面问数。 */
const codeParity: GateFn = (input) => {
  const id = 'code_parity'
  const codeFiles = [...input.files.keys()].filter(f => /^code\/problem.*\.py$/.test(f))
  if (input.problemCount === 0) {
    return cannot(id, '题面问数未知（0）—— 无法判定逐问覆盖是否成立')
  }
  return codeFiles.length >= input.problemCount
    ? ok(id, `代码文件 ${String(codeFiles.length)} 个 ≥ 题面 ${String(input.problemCount)} 问`)
    : fail(id, `代码文件只有 ${String(codeFiles.length)} 个，少于题面 ${String(input.problemCount)} 问`)
}

/** 致命缺陷计数（阶段 6 的核心门禁）。 */
const reviewFatalCount: GateFn = (input) => {
  const id = 'review_fatal_count'
  const raw = text(input, 'COMP_REVIEW_VERDICT.json')
  if (raw === null) return fail(id, 'COMP_REVIEW_VERDICT.json 不存在')
  let parsed: { fatal_count?: unknown }
  try {
    parsed = JSON.parse(raw) as { fatal_count?: unknown }
  } catch {
    return fail(id, 'COMP_REVIEW_VERDICT.json 不是合法 JSON')
  }
  const fatal = Number(parsed.fatal_count ?? Number.NaN)
  if (!Number.isFinite(fatal)) return cannot(id, 'fatal_count 缺失或不是数字 —— 无法判定')
  return fatal === 0
    ? ok(id, 'fatal_count = 0')
    : fail(id, `fatal_count = ${String(fatal)} —— 必须回滚到归属阶段修正后重跑，不许进阶段 7`)
}

/** 严格单文件产出（阶段 9 的核心纪律）。 */
const profileSingleFile: GateFn = (input) => {
  const id = 'profile_single_file'
  const extra = [...input.files.keys()].filter(f => f !== '_text_profile.json')
  return extra.length === 0
    ? ok(id, '只产出了 _text_profile.json')
    : fail(id, `除 _text_profile.json 外还产出了：${extra.join('、')} —— 本阶段只准出一个文件`)
}

const profileValidJson: GateFn = (input) => {
  const id = 'profile_valid_json'
  const raw = text(input, '_text_profile.json')
  if (raw === null) return fail(id, '_text_profile.json 不存在')
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes < 300) return fail(id, `_text_profile.json 只有 ${String(bytes)} 字节（低于 300）`)
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail(id, '_text_profile.json 不是 JSON 对象')
    }
  } catch (error) {
    return fail(id, `_text_profile.json 不是合法 JSON：${String(error).slice(0, 120)}`)
  }
  return ok(id, `_text_profile.json ${String(bytes)} 字节且是合法 JSON 对象`)
}

/** 报告必须存在——**即使全部检查通过也要出报告**（参考的明确纪律）。 */
const formatCheckReport: GateFn = (input) =>
  byteFloor(input, 'format_check_report', 'DOCX_FORMAT_CHECK_REPORT.md', 200)

/** FIGURE_MANIFEST 锚点与命名前缀（阶段 1）。 */
const figureManifestAnchors: GateFn = (input) => {
  const id = 'figure_manifest_anchors'
  const body = text(input, 'PROBLEM_ANALYSIS.md')
  if (body === null) return fail(id, 'PROBLEM_ANALYSIS.md 不存在')
  const hasBegin = body.includes('<!-- BEGIN FIGURE_MANIFEST -->')
  const hasEnd = body.includes('<!-- END FIGURE_MANIFEST -->')
  if (!hasBegin || !hasEnd) {
    return fail(id, `FIGURE_MANIFEST 块不完整（BEGIN=${String(hasBegin)} END=${String(hasEnd)}）`)
  }
  const block = body.slice(body.indexOf('<!-- BEGIN FIGURE_MANIFEST -->'), body.indexOf('<!-- END FIGURE_MANIFEST -->'))
  // 参考：裸名（image2 / 图2 / chart1）是硬阻断——下游对账会静默丢掉它们
  const bare = [...block.matchAll(/^\s*[-*]\s+([^\s`|]+)/gm)]
    .map(m => m[1] ?? '')
    .filter(name => name.length > 0 && !/^(fig_|tikz_)/.test(name))
  return bare.length === 0
    ? ok(id, 'FIGURE_MANIFEST 锚点完整，条目全部以 fig_/tikz_ 开头')
    : fail(id, `清单里有裸名：${bare.slice(0, 5).join('、')} —— 下游对账会静默丢掉它们`)
}

/** 假设/需求锚点（阶段 1 的 E1 契约；保真门 B3/B4 的锚）。 */
const anchorPresence: GateFn = (input) => {
  const id = 'anchor_presence'
  const body = text(input, 'PROBLEM_ANALYSIS.md')
  if (body === null) return fail(id, 'PROBLEM_ANALYSIS.md 不存在')
  const assumptions = (body.match(/^\[\[ASSUMPTION:/gm) ?? []).length
  const requirements = (body.match(/^\[\[REQUIREMENT:/gm) ?? []).length
  if (assumptions === 0) return fail(id, '没有任何 `[[ASSUMPTION: id]]` 行首锚点 —— 保真门 B3 会失去锚')
  if (requirements === 0) return fail(id, '没有任何 `[[REQUIREMENT: id]]` 行首锚点 —— 保真门 B4 会失去锚')
  return ok(id, `假设锚点 ${String(assumptions)} 条、需求锚点 ${String(requirements)} 条`)
}

/** 阶段 8 的终止条件（round-5 的两条）。 */
const improveTerminated: GateFn = (input) => {
  const id = 'improve_terminated'
  const raw = text(input, 'PAPER_IMPROVEMENT_STATE.json')
  if (raw === null) return fail(id, 'PAPER_IMPROVEMENT_STATE.json 不存在')
  let parsed: { rounds?: unknown; termination?: unknown }
  try {
    parsed = JSON.parse(raw) as { rounds?: unknown; termination?: unknown }
  } catch {
    return fail(id, 'PAPER_IMPROVEMENT_STATE.json 不是合法 JSON')
  }
  const rounds = Array.isArray(parsed.rounds) ? parsed.rounds as ReadonlyArray<{ defects?: unknown }> : null
  if (rounds === null) return cannot(id, 'rounds 不是数组 —— 无法判定终止条件')
  const counts = rounds.map(r => Number(r.defects ?? Number.NaN))
  if (counts.some(c => !Number.isFinite(c))) return cannot(id, '某一轮缺 defects 计数 —— 无法判定"进展"')
  const termination = String(parsed.termination ?? '')
  if (termination === '') return fail(id, '没有写 termination —— 终止原因必须显式记录')
  if (termination === 'approved') return ok(id, '批准即收口（检查器报零缺陷）')
  // 三轮无进展：最后三轮的缺陷数**没有严格下降**
  if (counts.length >= 3) {
    const last3 = counts.slice(-3)
    const noProgress = !(last3[0]! > last3[1]! && last3[1]! > last3[2]!)
    if (noProgress && termination === 'no-progress') {
      return ok(id, `三轮无进展即停（缺陷数 ${last3.join(' → ')}）—— 如实报告未收敛`)
    }
  }
  return fail(id, `终止原因 '${termination}' 不在允许集（approved / no-progress）`)
}

// ── 阶段 4/5：图对账、声明完整性、风格与几何 ────────────────────────────────
//
// 这三组判据**只读文本**（门禁的第三条纪律）：对账用的清单、声明、SVG 字节全部
// 由 `GateInput` 传进来。所以它们可测、可复算、可进审计轨迹——不需要重跑渲染。

/** 本阶段产出的 SVG 图文件（`figures/x.svg`）—— 由 runner 枚举 dir 型产物后进来。 */
function renderedSvgFiles(input: GateInput): ReadonlyArray<string> {
  return [...input.files.keys()].filter(f => /^figures\/.+\.svg$/i.test(f))
}

/** 图文件名 → 图 id（`figures/fig_a.svg` → `fig_a`）。 */
function figureIdOf(file: string): string {
  return (file.split('/').pop() ?? file).replace(/\.svg$/i, '')
}

/** 上游声明的题注（`图 id → caption`）——用于"题注不得出现在图内"的判据。 */
function declaredCaptions(input: GateInput): ReadonlyMap<string, string> {
  const raw = input.upstream.get(FIGURE_DECLARATIONS_FILE) ?? null
  const out = new Map<string, string>()
  if (raw === null) return out
  try {
    for (const f of parseFigureDeclarations(raw).figures) {
      if (f.caption !== undefined && f.caption.length > 0) out.set(f.figure_id, f.caption)
    }
  } catch {
    return out // 声明本身坏了由 `figure_declaration_complete` 报，这里不重复报
  }
  return out
}

/**
 * 阶段 4 的声明完整性 —— 每条 `data_refs` 必须指向**真有的** Result，且每条声明
 * 都真的被渲染出来了。
 *
 * 参考的 `figure_declaration_complete.py` 要的正是这个（"每条声明的 data_refs 必须
 * 指向阶段 3 铸出的 Result"）。这里不需要 IR 快照：阶段 3 交过来的声明文件里就带着
 * 执行结果的只读投影，判据落在**那个文件**上，而不是某个内存对象。
 */
const figureDeclarationComplete: GateFn = (input) => {
  const id = 'figure_declaration_complete'
  // 声明文件是**本阶段自己的产物**（阶段 4 figure-declare），账本是上游——
  // 第一版把声明当上游读，于是永远拿不到，门禁恒为 2。
  const raw = input.files.get(FIGURE_DECLARATIONS_FILE)
    ?? input.upstream.get(FIGURE_DECLARATIONS_FILE) ?? null
  if (raw === null) {
    return cannot(id, `${FIGURE_DECLARATIONS_FILE} 不在（既不在本阶段产物也不在上游）—— `
      + '没有声明就无从判定"每条 data_refs 都指向真有的 Result"')
  }
  let declarations
  try {
    declarations = parseFigureDeclarations(raw)
  } catch (error) {
    return fail(id, `声明文件形态不合法：${String(error instanceof Error ? error.message : error).slice(0, 160)}`)
  }
  // 数的来源是阶段 3 由 harness 铸出的账本（不是声明文件，更不是模型的散文）。
  const ledgerRaw = input.upstream.get(RESULTS_LEDGER_FILE) ?? null
  if (ledgerRaw === null) {
    return cannot(id, `上游 03-code/${RESULTS_LEDGER_FILE} 不在 —— 没有铸出的账本就无从核对引用`)
  }
  let ledger: ReadonlyArray<{ readonly result_id: string }>
  try {
    const parsedLedger = JSON.parse(ledgerRaw) as { results?: ReadonlyArray<{ result_id?: string }> }
    ledger = (parsedLedger.results ?? []).map(r => ({ result_id: String(r.result_id ?? '') }))
  } catch {
    return fail(id, `${RESULTS_LEDGER_FILE} 不是合法 JSON —— 账本由 harness 铸出，坏了要查执行环节`)
  }
  const known = new Set(ledger.map(r => r.result_id))
  const dangling: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()
  for (const figure of declarations.figures) {
    for (const ref of figure.data_refs) {
      if (!known.has(ref)) dangling.push(`${figure.figure_id} → ${ref}`)
    }
    if (seen.has(figure.figure_id)) duplicates.push(figure.figure_id)
    seen.add(figure.figure_id)
  }
  // "声明了但没渲染"**不在这里查**：渲染是阶段 5 的事，阶段 4 产出声明时图还不存在
  // （第一版把这条留在阶段 4，于是恒为失败）。它归阶段 5 的对账——那里同时核对
  // 计划与声明两份清单。
  const problems: string[] = []
  if (dangling.length > 0) {
    problems.push(`悬空 data_refs：${dangling.slice(0, 5).join('、')}`
      + `（账本里有的 Result：[${ledger.map(r => r.result_id).join(', ') || '（空）'}]）`)
  }
  if (duplicates.length > 0) problems.push(`重复声明的 figure_id：${duplicates.join('、')}`)
  return problems.length === 0
    ? ok(id, `${String(declarations.figures.length)} 条声明的 data_refs 全部解析到真有的 Result（`
      + `${String(ledger.length)} 条账本），且全部渲染`)
    : fail(id, problems.join('；'))
}

/** 上游声明文件里**已申报**的计划分叉（没有该字段或解析失败时为空）。 */
function declaredDeviations(input: GateInput): ReadonlyArray<{ readonly from: string; readonly to: string; readonly reason: string }> {
  const raw = input.upstream.get(FIGURE_DECLARATIONS_FILE) ?? null
  if (raw === null) return []
  try {
    return parseFigureDeclarations(raw).plan_deviations ?? []
  } catch {
    return []
  }
}

/**
 * 阶段 4 与阶段 1 的**计划对账** —— 参考的 `figure_manifest_reconcile`。
 *
 * 判据是双向的：计划里的每张数据图都要有文件（缺一张即失败），清单外的图也不许
 * 静默存在（多一张即失败）。只查一个方向会让"多渲染的图"永远没人发现——
 * 而多出来的图会被下游当成真产物引用。
 */
const figureManifestReconcile: GateFn = (input) => {
  const id = 'figure_manifest_reconcile'
  const analysis = input.upstream.get('PROBLEM_ANALYSIS.md') ?? null
  if (analysis === null) {
    return cannot(id, '上游 01-prob-analysis/PROBLEM_ANALYSIS.md 不在 —— 没有计划清单就无从对账')
  }
  const manifest = parseFigureManifest(analysis)
  if (manifest === null) {
    return cannot(id, 'PROBLEM_ANALYSIS.md 里没有完整的 FIGURE_MANIFEST 块 —— 无法对账"计划里的图都渲染出来了"')
  }
  const planned = dataFigureNames(manifest)
  if (planned.length === 0) {
    return cannot(id, 'FIGURE_MANIFEST 里没有任何数据图条目 —— 本阶段无事可对账'
      + '（阶段 1 的简报要求 12–20 张数据图，清单为空说明那一环没做）')
  }
  // 声明清单（阶段 4）也要被渲染覆盖：声明了一张图却不渲染，和计划漏渲染同样
  // 是"账面与产物脱节"。
  const declaredRaw = input.upstream.get(FIGURE_DECLARATIONS_FILE) ?? null
  let declared: ReadonlyArray<string> = []
  if (declaredRaw !== null) {
    try {
      declared = parseFigureDeclarations(declaredRaw).figures.map(f => f.figure_id)
    } catch {
      declared = [] // 声明坏了由 figure_declaration_complete 报，这里不重复报
    }
  }
  const rendered = renderedSvgFiles(input).map(figureIdOf)
  const missing = [...new Set([...planned, ...declared])].filter(n => !rendered.includes(n))
  const untracked = rendered.filter(n => !planned.includes(n) && !declared.includes(n))
  if (missing.length === 0 && untracked.length === 0) {
    return ok(id, `计划 ${String(planned.length)} 张数据图，全部渲染；无清单外的图`)
  }
  // **已申报的分叉放行并留痕**：计划是阶段 1 写的，编码阶段的模型可能合理地改进图
  // （拆分/合并/换更贴合数据的图型）。静默改名的对账必失败；但阶段 3 可以在
  // `plan_deviations` 里申报 {from, to, reason}——申报了就可审计，门禁放行并把
  // 理由写进结论。没有理由的分叉就是没被审视的分叉。
  const deviations = declaredDeviations(input)
  const accepted = deviations.filter(d => missing.includes(d.from) && untracked.includes(d.to))
  const stillMissing = missing.filter(n => !accepted.some(d => d.from === n))
  const stillUntracked = untracked.filter(n => !accepted.some(d => d.to === n))
  if (stillMissing.length === 0 && stillUntracked.length === 0) {
    return ok(id, `计划 ${String(planned.length)} 张数据图全部渲染（含 ${String(accepted.length)} 处**已申报**的分叉：`
      + accepted.map(d => `${d.from}→${d.to}`).join('、') + '；理由见阶段 3 的声明文件）')
  }
  const undeclared = untracked.filter(n => !accepted.some(d => d.to === n) && deviations.some(d => d.to === n))
  return fail(id, [
    stillMissing.length > 0 ? `计划里有、但没渲染出来：${stillMissing.slice(0, 6).join('、')}` : '',
    stillUntracked.length > 0 ? `渲染了、但不在计划里（也未申报分叉）：${stillUntracked.slice(0, 6).join('、')}` : '',
    undeclared.length > 0 ? `申报了分叉但对不上：${undeclared.slice(0, 4).join('、')}` : '',
  ].filter(s => s !== '').join('；'))
}

/** 参考明令禁止的色板与样式名（打印成灰度后不可区分）。 */
const BANNED_STYLE_NAMES = /tab10|tab20|RdYlGn|RdBu_r|dark_background|jet\b/
/** 合法的颜色写法：十六进制 / hsl() / rgb() / none / url(#…)（引用 marker）。 */
const LEGAL_COLOR = /^(?:none|currentColor|url\(#[\w-]+\)|#[0-9a-fA-F]{3,8}|hsla?\(|rgba?\()/

/**
 * 阶段 4 的风格门禁（`figure_style_rules`）—— 把参考 `setup_style` 的规范
 * **做成可核的判据**（这是 `adaptation.ts` 里那条 `missing` 的补齐项）。
 *
 * 三条，全部**只读 SVG 字节**：
 * 1. **印刷质量**：字号 ≥9、元素不越出 viewBox、文字与白底对比度 ≥4.5（复用
 *    `checkFigureQuality`——它就是为这件事写的，不另写一份判据）；
 * 2. **配色禁令**：不得出现 `tab10` / `RdYlGn` / `RdBu_r` / `dark_background`，
 *    也不得用 CSS 颜色名（`red`、`gray` 这种，灰度打印后不可区分）；
 * 3. **图内不得有标题**：声明的题注不得作为文本出现在 SVG 里（`plt.title` 的等价物；
 *    题注由正文给）。
 */
const figureStyleRules: GateFn = (input) => {
  const id = 'figure_style_rules'
  const svgs = renderedSvgFiles(input)
  if (svgs.length === 0) return cannot(id, '本阶段没有产出任何 SVG 图 —— 没有可核的风格对象')
  const captions = declaredCaptions(input)
  const problems: string[] = []
  for (const file of svgs) {
    const svg = input.files.get(file) ?? ''
    for (const v of checkFigureQuality(svg)) problems.push(`${file}：${v.kind} —— ${v.detail}`)
    if (BANNED_STYLE_NAMES.test(svg)) {
      const hit = BANNED_STYLE_NAMES.exec(svg)
      problems.push(`${file}：出现被禁的色板/样式名 '${hit?.[0] ?? ''}'（打印成灰度后不可区分）`)
    }
    for (const m of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
      const value = (m[1] ?? '').trim()
      if (value === '' || LEGAL_COLOR.test(value)) continue
      problems.push(`${file}：颜色用了 CSS 颜色名 '${value}' —— 打印成灰度后不可区分`)
    }
    const caption = captions.get(figureIdOf(file))
    if (caption !== undefined && svg.includes(caption)) {
      problems.push(`${file}：题注出现在图内（'${caption.slice(0, 20)}'）—— 数据图不写图内标题，题注由正文给`)
    }
  }
  return problems.length === 0
    ? ok(id, `${String(svgs.length)} 张图全部通过：字号/边界/对比度 + 配色禁令 + 无图内标题`)
    : fail(id, problems.slice(0, 6).join('；'))
}

/**
 * 阶段 5 与阶段 1 的**计划对账**（架构/几何段）。
 *
 * TikZ 几何族（`tikz_*`）要 LaTeX 引擎，本仓库没有 → 它们既没产出、也没被判定，
 * 所以这一条给 **`2`（无法判定）而不是 `0`**：把它们算成"通过"就是拿"没做"当"做对了"。
 */
const diagramManifestReconcile: GateFn = (input) => {
  const id = 'diagram_manifest_reconcile'
  const analysis = input.upstream.get('PROBLEM_ANALYSIS.md') ?? null
  if (analysis === null) {
    return cannot(id, '上游 01-prob-analysis/PROBLEM_ANALYSIS.md 不在 —— 没有计划清单就无从对账')
  }
  const manifest = parseFigureManifest(analysis)
  if (manifest === null) {
    return cannot(id, 'PROBLEM_ANALYSIS.md 里没有完整的 FIGURE_MANIFEST 块 —— 无法对账架构段')
  }
  const planned = architectureFigureNames(manifest)
  const htmlPlanned = planned.filter(n => !n.startsWith('tikz_'))
  const tikzPlanned = planned.filter(n => n.startsWith('tikz_'))
  if (htmlPlanned.length === 0) {
    return cannot(id, 'FIGURE_MANIFEST 的 DRAWIO/HTML 段是空的 —— 本阶段无事可对账'
      + '（本阶段声明的产物 `figures/fig_roadmap.svg` 需要清单里有对应条目）')
  }
  const rendered = renderedSvgFiles(input).map(figureIdOf)
  const missing = htmlPlanned.filter(n => !rendered.includes(n))
  const untracked = rendered.filter(n => !htmlPlanned.includes(n))
  if (missing.length > 0 || untracked.length > 0) {
    return fail(id, [
      missing.length > 0 ? `计划里有、但没渲染出来：${missing.slice(0, 6).join('、')}` : '',
      untracked.length > 0 ? `渲染了、但不在计划里：${untracked.slice(0, 6).join('、')}` : '',
    ].filter(s => s !== '').join('；'))
  }
  if (tikzPlanned.length > 0) {
    return cannot(id, `DRAWIO/HTML 段 ${String(htmlPlanned.length)} 张全部渲染；`
      + `但 TIKZ 段 ${String(tikzPlanned.length)} 张（${tikzPlanned.join('、')}）需要 LaTeX 引擎，`
      + '本仓库没有该工具链 —— 这几张既没产出、也没被判定，所以本门禁不能算通过')
  }
  return ok(id, `DRAWIO/HTML 段 ${String(htmlPlanned.length)} 张全部渲染；无清单外的图；无 TIKZ 条目`)
}

/** 从 SVG 字节复原节点矩形（几何判据只读产物，不靠第二份真相）。 */
function nodeRectsOf(svg: string): ReadonlyArray<{ row: number; x: number; y: number; w: number; h: number }> {
  return [...svg.matchAll(/<rect data-mh-row="(\d+)" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map(m => ({
      row: Number(m[1]),
      x: Number(m[2]),
      y: Number(m[3]),
      w: Number(m[4]),
      h: Number(m[5]),
    }))
}

/** 从 SVG 字节复原文本盒（只取落在某个节点矩形内的文本——那才是"节点标签"）。 */
function nodeLabelsOf(
  svg: string,
  rects: ReadonlyArray<{ row: number; x: number; y: number; w: number; h: number }>,
): ReadonlyArray<{ row: number; text: string; left: number; right: number; top: number; bottom: number }> {
  const out: Array<{ row: number; text: string; left: number; right: number; top: number; bottom: number }> = []
  for (const m of svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
    const x = Number(m[1])
    const y = Number(m[2])
    const size = Number(m[3])
    const text = m[4] ?? ''
    if (text.trim() === '') continue
    const host = rects.find(r => x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - 1 && y <= r.y + r.h + 1)
    if (host === undefined) continue
    const width = estimateLabelPx(text, size)
    out.push({
      row: host.row,
      text,
      left: x - width / 2,
      right: x + width / 2,
      top: y - size * 0.8,
      bottom: y + size * 0.25,
    })
  }
  return out
}

/**
 * 阶段 5 的几何自检（`diagram_geometry`）—— 参考的四类几何问题里的三类在这里落地：
 * **文字溢出被裁切**（标签宽度超过所在节点）、**元素越出画布**（复用
 * `checkFigureQuality` 的边界判据）、**同层中轴漂移 >4px**（复用
 * `checkArchitectureAlignment`，层号从 SVG 的 `data-mh-row` 复原）。
 *
 * **文字块互相重叠**只核"节点标签之间"：边标签落在层间空隙，与节点标签的比较需要
 * 连线的实际走向，那超出"只读 SVG 字节"能判的范围——这条边界如实写在这里，
 * 不假装四类都覆盖了。
 */
const diagramGeometry: GateFn = (input) => {
  const id = 'diagram_geometry'
  const svgs = renderedSvgFiles(input)
  if (svgs.length === 0) return cannot(id, '本阶段没有产出任何 SVG 图 —— 没有几何对象可核')
  const problems: string[] = []
  for (const file of svgs) {
    const svg = input.files.get(file) ?? ''
    for (const v of checkFigureQuality(svg)) problems.push(`${file}：${v.kind} —— ${v.detail}`)
    const rects = nodeRectsOf(svg)
    if (rects.length === 0) {
      problems.push(`${file}：没有任何带 data-mh-row 的节点矩形 —— 几何不可复算`)
      continue
    }
    // 方向：同层多节点共享 x → 横向展开；共享 y → 纵向展开。
    const multi = [...new Set(rects.map(r => r.row))]
      .map(row => rects.filter(r => r.row === row))
      .find(rs => rs.length >= 2)
    const direction: ArchLayout['direction'] = multi !== undefined && (multi[0]?.x === multi[1]?.x)
      ? 'horizontal'
      : 'vertical'
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
    const layout: ArchLayout = {
      nodeRects: rects.map((r, i) => ({ id: `n${String(i)}`, x: r.x, y: r.y, w: r.w, h: r.h, row: r.row })),
      width: Number(vb?.[1] ?? '0'),
      height: Number(vb?.[2] ?? '0'),
      direction,
    }
    for (const v of checkArchitectureAlignment(layout, 4)) {
      problems.push(`${file}：第 ${String(v.row)} 层的中轴漂移 ${v.deviation.toFixed(1)}px（>4px）`)
    }
    const labels = nodeLabelsOf(svg, rects)
    for (const label of labels) {
      const host = rects.find(r => r.row === label.row && label.left >= r.x - 40 && label.right <= r.x + r.w + 40)
      if (host !== undefined && (label.left < host.x || label.right > host.x + host.w)) {
        problems.push(`${file}：标签「${label.text.slice(0, 16)}」宽 ${(label.right - label.left).toFixed(0)}px `
          + `超出节点宽 ${String(host.w)}px —— 文字会被裁切`)
      }
    }
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = labels[i]
        const b = labels[j]
        if (a === undefined || b === undefined) continue
        // **同层也要比**：横排节点之间最容易挤在一起，跳过同层就正好漏掉那一类。
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        if (overlap) {
          problems.push(`${file}：标签「${a.text.slice(0, 12)}」与「${b.text.slice(0, 12)}」的文字块重叠`)
        }
      }
    }
  }
  return problems.length === 0
    ? ok(id, `${String(svgs.length)} 张架构图：边界/溢出/对齐（≤4px）/标签重叠 全部通过`)
    : fail(id, problems.slice(0, 6).join('；'))
}

/** 上游两个清单里登记过的图文件名（导出前校核用）。 */
function upstreamFigureNames(input: GateInput): ReadonlyArray<string> {
  const out: string[] = []
  const figureManifest = parseFigureManifestFile(input.upstream.get(FIGURE_MANIFEST_FILE) ?? null)
  for (const f of figureManifest?.figures ?? []) out.push((f.file.split('/').pop() ?? f.file))
  const diagramManifest = parseDiagramManifestFile(input.upstream.get('diagram-manifest.json') ?? null)
  for (const f of diagramManifest?.figures ?? []) out.push((f.file.split('/').pop() ?? f.file))
  return out
}

/**
 * 阶段 11 的导出前校核（`docx_precheck`）—— 参考 `docx-export` 的三件事：
 * 占位符 / 表格列数 / 图片链接闭合，**判据写成代码**（`docxPrecheckFatal`）。
 *
 * 判据的落点：
 * - 正文不在 → `2`（没有可校核的对象）；
 * - 阶段 9 的画像在、但不是合法 JSON → **`1`**：那不是"用户没提要求"，是
 *   "要求没被解析出来"，导出会按默认格式走而没人知道；
 * - 画像缺失 → 不阻断（回退到国赛默认是**设计好的**行为，且回退这件事写在导出报告里）；
 * - 有致命项 → `1`。
 */
const docxPrecheck: GateFn = (input) => {
  const id = 'docx_precheck'
  const markdown = input.upstream.get('paper/main.md') ?? null
  if (markdown === null) {
    return cannot(id, '上游 07-paper/paper/main.md 不在 —— 没有可校核的正文')
  }
  const rawProfile = input.upstream.get('_text_profile.json') ?? null
  if (rawProfile !== null) {
    try {
      JSON.parse(rawProfile)
    } catch (error) {
      return fail(id, `阶段 9 的 _text_profile.json 不是合法 JSON（${String(error).slice(0, 80)}）—— `
        + '用户要求没被解析出来，导出会静默按默认格式走')
    }
  }
  const profile = resolveDocxProfile(rawProfile)
  const fatal = docxPrecheckFatal(markdown, upstreamFigureNames(input))
  if (fatal.length > 0) return fail(id, `导出前校核有致命项：${fatal.slice(0, 3).join('；')}`)
  return ok(id, `导出前校核零致命项；格式画像来源 ${profile.source}`
    + (profile.source === 'default' ? `（回退：${profile.fallbackReason.slice(0, 60)}）` : ''))
}

/**
 * 门禁登记表。
 *
 * **未实现的判据给 `2`**，并在 `detail` 里写明"需要什么才算实现"——它们不是"忘了写"，
 * 是如实标注能力边界。给 `0` 是静默放行，比没有门禁更糟。
 */
export const GATES: ReadonlyMap<string, GateFn> = new Map<string, GateFn>([
  // ── 阶段 1 ────────────────────────────────────────────────────────────
  ['prob_analysis_floor', i => byteFloor(i, 'prob_analysis_floor', 'PROBLEM_ANALYSIS.md', 1500)],
  ['figure_manifest_anchors', figureManifestAnchors],
  ['capability_check', () => cannot('capability_check',
    '未实现：参考的 capability_check.py 要跨 PROBLEM_ANALYSIS.md 的逐句表与 CAPABILITY_CHECKLIST.json '
    + '逐条比对（每条"决策/目标/机制"句必须被某个能力项的 source_sentence 认领）。'
    + '实现它需要先定义逐句表的机器可读形态。')],
  // 阶段 1 另有锚点契约（E1 的锚，保真门 B3/B4 依赖它）
  ['anchor_presence', anchorPresence],
  // ── 阶段 2 ────────────────────────────────────────────────────────────
  ['modeling_floor', i => byteFloor(i, 'modeling_floor', 'MODELING_REPORT.md', 1500)],
  ['modeling_coverage', () => cannot('modeling_coverage',
    '未实现：参考的 modeling_coverage_check.py 要核对 CAPABILITY_CHECKLIST.json 的每条能力项'
    + '在 MODELING_REPORT.md 里都有建模落地。需要先定义"落地"的机器可读形态（能力项 id 的引用）。')],
  ['modeling_self_check', () => cannot('modeling_self_check',
    '未实现：参考的 9 项自检含"问题递进性检查"（参考自己标注为"最关键"且是人工项）。'
    + '可机械化的那几项（逐问数、目标/公式/约束非零、符号表存在、灵敏度计划）待实现。')],
  // ── 阶段 3 ────────────────────────────────────────────────────────────
  ['code_parity', codeParity],
  // 阶段 3 的数由 harness 铸出（runCodeAndMintResults）：账本存在、非空、
  // 每个值都是有限数——这是"数不由模型持有"的机械落点。
  ['results_minted', (i) => {
    const id = 'results_minted'
    const raw = i.files.get('results.json') ?? null
    if (raw === null) {
      return fail(id, 'results.json 不存在 —— harness 没能从代码产物里铸数'
        + '（模型只声明数在哪，数由真实执行产生；没有账本下游图表无从取数）')
    }
    let parsed: { results?: unknown }
    try {
      parsed = JSON.parse(raw) as { results?: unknown }
    } catch (error) {
      return fail(id, `results.json 不是合法 JSON：${String(error).slice(0, 100)}`)
    }
    const results = Array.isArray(parsed.results) ? parsed.results as ReadonlyArray<{ value?: unknown }> : null
    if (results === null || results.length === 0) return fail(id, 'results.json 的 results 是空的 —— 没有声明任何数')
    const bad = results.filter(r => typeof r.value !== 'number' || !Number.isFinite(r.value)).length
    if (bad > 0) return fail(id, `${String(bad)} 条账目的 value 不是有限数 —— NaN 进图是静默失败`)
    return ok(id, `账本 ${String(results.length)} 条，全部是来自真实执行的有限数`)
  }],
  ['delivery_audit', () => cannot('delivery_audit',
    '未实现：参考的 delivery_audit.py 要核对 DELIVERABLES.json 声明的每个交付物**真的存在且非空**。'
    + '需要先确定本 harness 的交付物清单形态（与零数字通道的 Result 如何对应）。')],
  ['leakage_audit', leakageAudit],
  ['no_render', noRender],
  // ── 阶段 4/5 ──────────────────────────────────────────────────────────
  ['figure_manifest_reconcile', figureManifestReconcile],
  ['figure_declaration_complete', figureDeclarationComplete],
  // 风格门禁 —— `adaptation.ts` 里那条 `missing`（Python 绘图库的规范）的补齐项：
  // 规范本身早已在仓库里（语料 + 简报的禁令），缺的是**可核的判据**，这就是它。
  ['figure_style_rules', figureStyleRules],
  ['diagram_manifest_reconcile', diagramManifestReconcile],
  ['diagram_geometry', diagramGeometry],
  // ── 阶段 6 ────────────────────────────────────────────────────────────
  ['review_fatal_count', reviewFatalCount],
  // ── 阶段 7 ────────────────────────────────────────────────────────────
  ['paper_floor', i => byteFloor(i, 'paper_floor', 'paper/main.md', 5120)],
  ['paper_page_floor', paperPageFloor],
  ['no_latex_residue', noLatexResidue],
  ['upstream_min_chars', (i) => {
    const id = 'upstream_min_chars'
    const need = ['PROBLEM_ANALYSIS.md', 'MODELING_REPORT.md', 'RESULTS.md']
    const short = need.filter(n => (i.upstream.get(n) ?? '').length < 500)
    return short.length === 0
      ? ok(id, `上游三件产物各 ≥500 字符`)
      : fail(id, `上游产物过短或缺失：${short.join('、')} —— 论文没有可装配的原料`)
  }],
  ['paper_claim_check', () => cannot('paper_claim_check',
    '未实现：参考的 paper_claim_check.py 要核对"将写进论文的每条结果在上游已有已核验的落地"。'
    + '这是阶段 7"装配而非推理"这一前提的**机械强制手段**，优先级最高——'
    + '实现它需要把 Result/Claim 与论文里出现的数字连起来（零数字通道已有这个能力，待接）。')],
  // ── 阶段 8 ────────────────────────────────────────────────────────────
  ['improve_terminated', improveTerminated],
  // ── 阶段 9 ────────────────────────────────────────────────────────────
  ['profile_single_file', profileSingleFile],
  ['profile_valid_json', profileValidJson],
  // ── 阶段 10/11 ────────────────────────────────────────────────────────
  ['format_check_report', formatCheckReport],
  ['docx_precheck', docxPrecheck],
  ['docx_exported', (i) => {
    const id = 'docx_exported'
    // 字节数优先取 stat 的真值：docx 是二进制，按 utf8 读出来的长度不是它的体量。
    const size = i.sizes?.get('paper/main.docx') ?? null
    if (size === null) {
      const docx = text(i, 'paper/main.docx')
      return docx === null
        ? fail(id, 'paper/main.docx 不存在（导出不算成功）')
        : ok(id, `paper/main.docx 存在（${String(Buffer.byteLength(docx, 'utf8'))} 字节）`)
    }
    if (size === 0) return fail(id, 'paper/main.docx 存在但是空的（导出不算成功）')
    return ok(id, `paper/main.docx 存在（${String(size)} 字节）`)
  }],
])

/**
 * 跑一组门禁并聚合结论。
 *
 * 聚合规则：**任一 `1` → `1`；否则任一 `2` → `2`；否则 `0`**。
 * 这个顺序重要：硬失败优先于无法判定（一个明确的失败比一个未知更该被看见）。
 *
 * @param ids - 门禁 id（来自阶段注册表）。
 * @param input - 产物文本。
 * @returns 聚合结论；未登记的 id 记为 `2`（**不放行**）。
 */
export function runGates(ids: ReadonlyArray<string>, input: GateInput): GateVerdict {
  const items: Array<{ id: string; ok: boolean; detail: string }> = []
  let worst: 0 | 1 | 2 = 0
  for (const id of ids) {
    const fn = GATES.get(id)
    const verdict = fn === undefined
      ? cannot(id, '门禁未登记 —— 不放行（登记表与阶段表必须一致）')
      : fn(input)
    items.push(...verdict.items)
    if (verdict.code === 1) worst = 1
    else if (verdict.code === 2 && worst === 0) worst = 2
  }
  return { code: worst, items }
}
