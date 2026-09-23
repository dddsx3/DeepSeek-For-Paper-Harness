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
 * - **机械可判**（字节地板、文件存在、正则、条目数、锚点形态）→ 本文件实现；
 * - **需要真实计算**（`capability_check` 要跨文件比对能力项、`modeling_coverage` 要
 *   逐条核对建模落地、`delivery_audit` 要核对声明的交付物是否真存在且非空、
 *   `leakage_audit` 要看分类指标与去泄漏证据、`paper_claim_check` 要核对 claim 上游落地）
 *   → 本文件**显式给 2**，并在 `detail` 里写明"需要什么才算实现"。
 *
 * 后一类不是"忘了写"，是**如实标注能力边界**——它们的实现各自需要一次专门的设计
 * （见 `artifacts/upper-bound/ROUND-*` 的方法论）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/gates
 */

import type { GateVerdict } from './handoff.ts'

/** 门禁的输入：产物文本（由调用方读盘后传入，门禁本身不碰文件系统）。 */
export interface GateInput {
  /** 本阶段目录内 `文件相对名 → 文本`。缺失的文件不出现。 */
  readonly files: ReadonlyMap<string, string>
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
  ['delivery_audit', () => cannot('delivery_audit',
    '未实现：参考的 delivery_audit.py 要核对 DELIVERABLES.json 声明的每个交付物**真的存在且非空**。'
    + '需要先确定本 harness 的交付物清单形态（与零数字通道的 Result 如何对应）。')],
  ['leakage_audit', leakageAudit],
  ['no_render', noRender],
  // ── 阶段 4/5 ──────────────────────────────────────────────────────────
  ['figure_manifest_reconcile', () => cannot('figure_manifest_reconcile',
    '未实现：要与阶段 1 的 FIGURE_MANIFEST 对账（计划里的每张图都必须真的渲染出来）。'
    + '需要先把 manifest 解析成机器可读清单。')],
  ['figure_declaration_complete', () => cannot('figure_declaration_complete',
    '未实现：每条声明的 data_refs 必须指向阶段 3 铸出的 Result。需要 IR 快照作为输入。')],
  ['diagram_manifest_reconcile', () => cannot('diagram_manifest_reconcile', '未实现：同 figure_manifest_reconcile，针对 HTML/DrawIO/TikZ 段。')],
  ['diagram_geometry', () => cannot('diagram_geometry',
    '未实现：参考的几何自检（文字溢出/越界/重叠/对齐漂移）需要渲染后的几何数据，'
    + '本 harness 的渲染器要先把元素坐标吐出来。')],
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
  ['docx_precheck', () => cannot('docx_precheck', '未实现：需要与阶段 9 的 _text_profile.json 对账（导出前的格式校核）。')],
  ['docx_exported', (i) => {
    const id = 'docx_exported'
    const docx = text(i, 'paper/main.docx')
    return docx === null
      ? fail(id, 'paper/main.docx 不存在（导出不算成功）')
      : ok(id, `paper/main.docx 存在（${String(Buffer.byteLength(docx, 'utf8'))} 字节）`)
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
