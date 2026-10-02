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

/** 作图规划文件名（阶段 5 的产物；「模型写脚本」之后的合同）。 */
export const FIGURE_PLAN_FILE = 'FIGURE_PLAN.json'
import { numericShapeOf, parseResultSources, RESULTS_LEDGER_FILE } from './execute-and-mint.ts'
import { addRoundedVariants, auditFiles, buildAllowlist, commentLines, verificationClaims } from './number-audit.ts'
import { CODE_PY_RE, undefinedConstNames } from './code-names.ts'
import {
  ANCHOR_REPORT_FILE, anchorsIn, blankFencedCode, parseAnchorReport,
} from './anchor-resolve.ts'
import {
  figurePlanValid, figureScriptQuality, figureScriptTraced, figureSizeBuckets, figureTextWithinAxes, figureTypeMatch,
} from './figure-script-gates.ts'
import { architectureFigureNames, dataFigureNames, parseFigureManifest } from './figure-manifest.ts'
import {
  FIGURE_COUNT_HARD_FLOOR, budgetSentence, figureBudget,
} from './figure-budget.ts'
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

const ok = (id: string, detail: string): GateVerdict => ({ code: 0, items: [{ id, ok: true, detail, code: 0 }] })
const fail = (id: string, detail: string): GateVerdict => ({ code: 1, items: [{ id, ok: false, detail, code: 1 }] })
const cannot = (id: string, detail: string): GateVerdict => ({ code: 2, items: [{ id, ok: false, detail, code: 2 }] })

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
 *
 * ## 判据必须锚在"分类指标"上，不能只看数字大小（第十二处真实误报）
 *
 * 原实现 `0\.9[9]\d*|1\.000|100\.0\s*%` 只要文本里**任何地方**出现 ≥0.99 的数就报，
 * 于是 2024B 阶段 3 被拦：本题**根本没有分类指标**（是抽样方案 + 装配决策 + 期望利润），
 * 被命中的是两处完全无关的数——灵敏度扫描的置信水平格点 `[0.9, 0.95, 0.99]`、
 * OC 曲线上的接收概率轴值 `0.99 / 0.995`。这些数越接近 1 越正常，与"模型好得可疑"无关。
 *
 * 所以判据改成**同时**要求：① 该行有 ≥0.99 的数；② 该行或邻近行有分类指标词。
 * 单看①会把置信水平、概率、坐标轴全打成"分类指标"；这正是本项目反复出现的
 * "数字被当成它不代表的量"的同一个病。
 */
const CLASSIFICATION_METRIC = /准确率|精确率|精准率|召回率|查全率|查准率|F1|F-1|AUC|ROC|混淆矩阵|分类(?:器|模型|指标|任务|准确|精度)|accuracy|precision|recall|f1[-_ ]?score|confusion|classif/i
const NEAR_ONE = /0\.9[9]\d*|1\.000|100\.0\s*%/

const leakageAudit: GateFn = (input) => {
  const id = 'leakage_audit'
  const bodies = [...input.files.values()].join('\n')
  const lines = bodies.split('\n')
  // 分类指标词允许出现在**同一行或上下各一行**：markdown 表头与数值常分两行，
  // 而 JSON 里的裸数字行（`0.99,`）附近不会有指标词，所以不会误伤。
  const hits: string[] = []
  lines.forEach((line, i) => {
    if (!NEAR_ONE.test(line)) return
    const window = lines.slice(Math.max(0, i - 1), i + 2).join('\n')
    if (CLASSIFICATION_METRIC.test(window)) hits.push(line.trim().slice(0, 80))
  })
  if (hits.length === 0) {
    return ok(id, '未发现 ≥0.99 的**分类指标**（置信水平 / 概率 / 坐标轴上的大数不算）')
  }
  const hasEvidence = /去泄漏|de[- ]?leak|泄漏|train[_ ]?test[_ ]?split|划分/.test(bodies)
  return hasEvidence
    ? ok(id, `出现 ≥0.99 的分类指标（${String(hits.length)} 处），且产物里有去泄漏说明`)
    : fail(id, `出现 ≥0.99 的分类指标（${String(hits.length)} 处：${hits.slice(0, 3).join(' / ')}），`
      + '但产物里没有任何去泄漏证据（参考口径：这是硬失败）')
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

/**
 * `code_name_consistency` —— **代码里引用的常量名，必须在某个文件里真的定义过**。
 *
 * ## 为什么必须静态查（实测三次代价）
 *
 * 阶段 3 是**分片**写的（一文件一次调用），于是各文件之间可能对不上名字，
 * 而它们本该是同一个程序：
 * - `problem1.py` 用了 `params.py` 里并不存在的 `Q1_ALTERN` → 阶段 4 真跑报
 *   `ValueError: params 中缺少问题一常量：Q1_ALTERN`；
 * - 另一代里 `problem1.py` 引用了 10 个**任何文件都没定义**的名字
 *   （`DELTA`/`BETA`/`Q1_NOMINAL`/`ALPHA_REJECT`/`CONF_ACCEPT`/`NUMERIC_TOL`/
 *   `N_SPRT`/`SPRT`/`DELTA_GRID`/`BETA_GRID`），而 `params.py` 定义的是
 *   `Q1_DELTA`/`Q1_BETA`/… 前缀名——**同一个概念两套名字**。
 *
 * 这些错误**静态就能判**，却一直被推到最后一步（阶段 4 真跑）才炸：那一炸要么作废
 * 一轮代码生成，要么（更早的版本里）让阶段 4 空转十几次。所以在这里拦。
 *
 * ## 判据要窄（宁可漏，不误杀）
 *
 * 只查**全大写、长度 ≥ 4 的裸标识符**（那才是"常量"的形态），且必须同时满足：
 * ① 不在注释/字符串/文档串里；② 前面不是 `.`（那是属性访问）；
 * ③ 它在该文件**自己**里没定义过；④ 它在**任何** `.py` 里都没有定义
 * （含赋值/def/class/import/for/with/except 绑定）。
 * 四条都成立才判——单条都不足以断定它不存在（可能是 `globals()` 注入、
 * 也可能是星号导入进来的成员）。
 */
const codeNameConsistency: GateFn = (input) => {
  const id = 'code_name_consistency'
  const files = [...input.files.entries()].filter(([f]) => CODE_PY_RE.test(f))
  if (files.length === 0) return cannot(id, '没有 `code/*.py` —— 没有可核的代码')
  // 判据只有一份：与阶段 3 分片循环的**单片自检**共用（`code-names.ts`）。
  // 共用是刻意的——分片在收到那一片的当下就用同一条判据自查并只重问那一片，
  // 不必等整阶段 8 片跑完再被门禁拦回（那一次重跑的代价是 8 次模型调用）。
  const findings = undefinedConstNames(files)
  if (findings.length === 0) {
    return ok(id, `${String(files.length)} 个代码文件：引用的常量名都有定义`)
  }
  const problems = findings.map(f => `${f.file}：引用了 ${String(f.names.length)} 个**任何文件都没定义**的常量名`
    + `（${f.names.slice(0, 6).join('、')}）—— 运行时必然 NameError。`
    + '分片是"一文件一次调用"，各文件对不上名字是这类阶段的典型塌方；'
    + '要么用 `params.py` 里已有的名字，要么在用到它的文件里定义。'
    + '⛔ 常见误区：`source.某名字` 这类**属性访问**不等于"该名字可导入"——'
    + '`from params import *` 只给模块级常量；在 `params.py` 里补上定义即可。')
  return fail(id, problems.slice(0, 3).join('；'))
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

/**
 * `figure_manifest_count` —— **规划端的图表预算**（阶段 1）。
 *
 * 参考在同一个位置卡这件事（`comp-prob-analysis` 的 `FIGURE_MANIFEST` 自检脚本），
 * 常量原样照搬：`HARD_FLOOR=3` 硬阻塞、软区间 12-20。
 *
 * 实测为什么必须卡：2024B 的清单写了 `DATA=14`（在区间内、完全合格），
 * 但阶段 5 交付时只剩 7 张——**规划端合格不代表交付端合格**，
 * 所以这一端只保证"起点对"，总量由阶段 5 的 `figure_plan_budget` 兜。
 */
const figureManifestCount: GateFn = (input) => {
  const id = 'figure_manifest_count'
  const body = text(input, 'PROBLEM_ANALYSIS.md')
  if (body === null) return fail(id, 'PROBLEM_ANALYSIS.md 不存在')
  const manifest = parseFigureManifest(body)
  if (manifest === null) return fail(id, 'FIGURE_MANIFEST 块不完整 —— 没有可数的图表预算')
  // 以**实际列出的条目**为准，声明数只作参考（声明 14 却只列 7 条时，列出的才是真会画的）
  const data = manifest.sections['DATA']?.length ?? manifest.declaredCounts['DATA'] ?? 0
  const flow = (manifest.sections['DRAWIO']?.length ?? 0) + (manifest.sections['TIKZ']?.length ?? 0)
  const budget = figureBudget(input.problemCount)
  const sentence = budgetSentence(budget, input.problemCount)
  if (data < FIGURE_COUNT_HARD_FLOOR) {
    return fail(id, `数据图只规划了 ${String(data)} 张，低于**绝对底线** ${String(FIGURE_COUNT_HARD_FLOOR)} 张 —— `
      + `参考口径：少于 3 张数据图是"工作严重不完整"，硬阻塞。${sentence}`)
  }
  // 下限认 `DATA + 流程图/TikZ`：参考明说推理密集型题"数据图达底线即正常，
  // 推导构造图(TIKZ)才是重点，勿为凑数硬加数据曲线"。
  if (data + flow < budget.lo) {
    return fail(id, `数据图 ${String(data)} 张 + 流程图/示意图 ${String(flow)} 张 = ${String(data + flow)} 张，`
      + `低于下限 ${String(budget.lo)} 张 —— 图集撑不起论文篇幅。${sentence}`
      + `（推理密集型题可把差额补在 TikZ 推导/构造图上，那也是达标路径。）`)
  }
  // 上限只卡 DATA：防"为凑数硬加数据曲线稀释重点"
  if (data > budget.hi) {
    return fail(id, `数据图规划了 ${String(data)} 张，超过上限 ${String(budget.hi)} 张 —— `
      + `参考口径：超过推荐上限即为冗余，宁少勿凑。${sentence}`)
  }
  return ok(id, `数据图 ${String(data)} 张（+ 流程图/示意图 ${String(flow)} 张）落在 ${String(budget.lo)}–${String(budget.hi)} 张区间内。${sentence}`)
}

/**
 * `figure_plan_budget` —— **交付端的图表预算**（阶段 5）。
 *
 * 这一条是本轮新增的核心：**申报放弃的机制是对的，但总量必须有下限**。
 *
 * 实测（2024B）：阶段 5 的 11 条 `plan_deviations` 里 7 条是"申报放弃"，
 * 每条理由都真实（账本确实没那些数），于是图从 14 张诚实降到 7 张，
 * 而**没有任何门禁说过一句话**——契约允许逐张申报，却不数最后剩几张。
 * 结果就是"诚实地放弃到图集撑不起论文"。
 *
 * 注意它**不禁止**申报放弃：放弃在预算内照样放行（少一张不是罪），
 * 越界才拦——而且拦的时候把"放弃了哪些、为什么"一并报出来，
 * 让检查人能一眼判断是"产物偷懒"还是"上游缺数"（2024B 是后者，得回滚阶段 3）。
 */
const figurePlanBudget: GateFn = (input) => {
  const id = 'figure_plan_budget'
  const raw = input.files.get(FIGURE_PLAN_FILE) ?? input.upstream.get(FIGURE_PLAN_FILE) ?? null
  if (raw === null) return cannot(id, `${FIGURE_PLAN_FILE} 不在 —— 没有规划就数不出张数`)
  let figures: ReadonlyArray<Record<string, unknown>>
  let deviations: ReadonlyArray<Record<string, unknown>> = []
  try {
    const parsed = JSON.parse(raw) as { figures?: unknown; plan_deviations?: unknown }
    if (!Array.isArray(parsed.figures)) return cannot(id, `${FIGURE_PLAN_FILE} 里没有 \`figures\` 数组`)
    figures = parsed.figures as ReadonlyArray<Record<string, unknown>>
    if (Array.isArray(parsed.plan_deviations)) {
      deviations = parsed.plan_deviations as ReadonlyArray<Record<string, unknown>>
    }
  } catch {
    return cannot(id, `${FIGURE_PLAN_FILE} 不是合法 JSON`)
  }
  const delivered = figures.length
  const dropped = deviations.filter(d => String(d['to'] ?? '') === '')
  const budget = figureBudget(input.problemCount)
  const sentence = budgetSentence(budget, input.problemCount)
  if (delivered < budget.lo) {
    const why = dropped.length === 0
      ? ''
      : `；其中 ${String(dropped.length)} 张是**申报放弃**（${dropped.slice(0, 3).map(d => String(d['from'] ?? '')).join('、')}…）`
        + '—— 申报放弃本身合规，但总量不能越过下限：若放弃的理由是"账本没这些数"，'
        + '那是**上游缺口**，应回滚阶段 3 补算，而不是就此少画'
    return fail(id, `最终只交付 ${String(delivered)} 张图，低于下限 ${String(budget.lo)} 张${why}。${sentence}`)
  }
  if (delivered > budget.hi) {
    return fail(id, `交付 ${String(delivered)} 张图，超过上限 ${String(budget.hi)} 张 —— 宁少勿凑。${sentence}`)
  }
  return ok(id, `交付 ${String(delivered)} 张图${dropped.length === 0 ? '' : `（含申报放弃 ${String(dropped.length)} 张）`}`
    + `，落在 ${String(budget.lo)}–${String(budget.hi)} 张区间内。${sentence}`)
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

/**
 * `ledger_keys_declared` —— **阶段 3 必须公布"我到底写了哪些键"**（阶段 4 的取数依据）。
 *
 * 为什么必须新增这一条：阶段 4 的 `json_path` 是**预测**代码会写出什么路径，
 * 而它能读到的只有 `RESULTS.md` 与 `DELIVERABLES.json`——**两者都不含具体键名**。
 * 实测（2024B）：模型于是自己编了一套命名（`problem1.case1.n`），
 * 而代码写的是 `problem1.case95.n`，**102 条声明里 100 条解析到 undefined**，
 * 铸数整轮失败。反复重跑不会收敛——因为**它没有可依据的事实**，只能猜。
 *
 * 所以把"路径"变成阶段 3 的交付物：`DELIVERABLES.json.ledger_keys` =
 * `[{json_path, name, unit}]`，**逐字**写出它写进账本的每个键。
 * 阶段 4 只许照抄，不许自推（见 `result_sources_valid` 的交叉核对）。
 */
const ledgerKeysDeclared: GateFn = (input) => {
  const id = 'ledger_keys_declared'
  const raw = text(input, 'DELIVERABLES.json')
  if (raw === null) return fail(id, 'DELIVERABLES.json 不存在')
  let parsed: { ledger_keys?: unknown }
  try {
    parsed = JSON.parse(raw) as { ledger_keys?: unknown }
  } catch (error) {
    return fail(id, `DELIVERABLES.json 不是合法 JSON：${String(error).slice(0, 80)}`)
  }
  const keys = parsed.ledger_keys
  if (!Array.isArray(keys) || keys.length === 0) {
    return fail(id, 'DELIVERABLES.json 缺 `ledger_keys`（或为空）—— 阶段 4 只能靠猜键名，'
      + '实测 102 条声明里 100 条落空。请逐条列出你写进账本的每个键：'
      + '`ledger_keys: [{"json_path": "problem1.case95.n", "name": "…", "unit": "件"}]`，'
      + '**路径逐字照抄你在 JSON 里写的键**，不要改写成你以为更规整的名字。')
  }
  const bad = keys.filter(k => typeof (k as { json_path?: unknown }).json_path !== 'string'
    || ((k as { json_path?: string }).json_path ?? '').trim() === '')
  if (bad.length > 0) {
    return fail(id, `ledger_keys 里有 ${String(bad.length)} 条缺 \`json_path\`（或为空）`)
  }
  return ok(id, `已公布 ${String(keys.length)} 个账本键 —— 阶段 4 照抄即可，不必猜`)
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
  // 剥**任意图像后缀**，不只是 `.svg`：数据图现在是 PNG，只剥 svg 会让
  // `figures/fig_a.png` → `fig_a.png`，于是同一张图被判成"计划里有但没渲染 + 渲染了但不在计划里"
  // （实测：两句话同时出现，一眼能看出是 id 归一化没做）。
  return (file.split('/').pop() ?? file).replace(/\.(png|pdf|svg|jpg|jpeg)$/i, '')
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


/** 上游声明文件里**已申报**的计划分叉（没有该字段或解析失败时为空）。 */
function declaredDeviations(input: GateInput): ReadonlyArray<{ readonly from: string; readonly to: string; readonly reason: string }> {
  // 偏移申报现在写在**作图规划**（`FIGURE_PLAN.json`）里——
  // 声明驱动时代写在 `FIGURE_DECLARATIONS.json`，那个文件已经不再产出。
  // 只读旧文件会让“已申报的分叉”一律判成未申报。
  const raw = input.upstream.get(FIGURE_PLAN_FILE) ?? input.files.get(FIGURE_PLAN_FILE) ?? null
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    const list = (parsed as { plan_deviations?: unknown }).plan_deviations
    if (!Array.isArray(list)) return []
    return list.flatMap((d): ReadonlyArray<{ from: string; to: string; reason: string }> => {
      if (typeof d !== 'object' || d === null) return []
      const o = d as Record<string, unknown>
      const from = typeof o['from'] === 'string' ? o['from'] : ''
      const to = typeof o['to'] === 'string' ? o['to'] : ''
      // **`to` 为空是"申报放弃"**（不是坏条目）——这里若把它过滤掉，
      // 下游的放行逻辑就永远匹配不到，6 张诚实的放弃会被一直判成漏渲染（实测踩过）。
      // 只要求 `from` 非空。
      if (from === '') return []
      return [{ from, to, reason: typeof o['reason'] === 'string' ? o['reason'] : '' }]
    })
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
  // 作图规划（阶段 5 的 `FIGURE_PLAN.json`）也要被渲染覆盖：规划了一张图却没画出来，
  // 与计划漏渲染同样是"账面与产物脱节"。参考把这条写成硬合同：
  // *"规划了几张就必须画几张：FIGURE_MANIFEST 是合同，少一张就是违约"*。
  const planRaw = input.upstream.get(FIGURE_PLAN_FILE) ?? input.files.get(FIGURE_PLAN_FILE) ?? null
  let declared: ReadonlyArray<string> = []
  if (planRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(planRaw)
      const list = (parsed as { figures?: unknown }).figures
      if (Array.isArray(list)) {
        declared = list.map(f => String((f as { figure_id?: unknown }).figure_id ?? '')).filter(x => x !== '')
      }
    } catch {
      declared = [] // 规划坏了由 figure_plan_valid 报，这里不重复报
    }
  }
  // 产物现在是 matplotlib 出的 PNG（PDF 也容忍）——不再是固定渲染器的 SVG。
  // **二进制不在 `input.files` 里**（那里只装文本），所以从 `sizes` 的键取——
  // 只看 `files` 会把每一张 PNG 都判成"没渲染出来"（实测踩过两次，这里与
  // `figure_completeness` 是同一条纪律）。
  const imageKeys = [...new Set([...input.files.keys(), ...(input.sizes?.keys() ?? [])])]
  const rendered = imageKeys
    .filter(f => /^figures\/fig_[A-Za-z0-9_]+\.(png|pdf|svg|jpg|jpeg)$/i.test(f))
    .map(figureIdOf)
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
  // **改名的判据是"新 id 真的渲染出来了"**，不是"新 id 不在规划里"。
  //
  // 原来的写法是 `missing.includes(d.from) && untracked.includes(d.to)`——
  // 而改名后的新 id **必然在规划的 `declared` 里**（它就是从规划里来的），
  // 所以 `untracked`（= 渲染了但既不在清单、也不在规划里）**永远不会**包含它。
  // 那个条件对真正的改名恒为假：申报了改名也照旧判"漏渲染"。
  // 实测（2024B）：阶段 5 申报了 3 处改名（账本没有扫描序列/二维网格，
  // 改用横断面关联图与成本结构对照，理由写明且诚实），却被判 3 张漏渲染。
  const accepted = deviations.filter(d => d.to !== '' && missing.includes(d.from) && rendered.includes(d.to))
  // **申报放弃**也要认（`to` 为空 + 写明理由）。
  //
  // 实测：模型显式放弃了 6 张计划图，理由是"账本只有两个点，连成曲线会虚构并不存在的
  // 单调关系"——**那正是要的行为**（拒绝编造）。只认"换名"会把这种诚实的放弃判成漏渲染。
  // 判据仍是"可审计"：有 `from`、有非空 `reason`，就放行并把理由写进结论；
  // 没有理由的放弃 = 没被审视的放弃，照旧失败。
  const dropped = deviations.filter(d => d.to === '' && d.reason.trim() !== '' && missing.includes(d.from))
  const stillMissing = missing.filter(n => !accepted.some(d => d.from === n) && !dropped.some(d => d.from === n))
  const stillUntracked = untracked.filter(n => !accepted.some(d => d.to === n))
  if (stillMissing.length === 0 && stillUntracked.length === 0) {
    const parts: string[] = []
    if (accepted.length > 0) parts.push(`${String(accepted.length)} 处换名/改型（${accepted.map(d => `${d.from}→${d.to}`).join('、')}）`)
    if (dropped.length > 0) parts.push(`${String(dropped.length)} 处**申报放弃**（${dropped.map(d => d.from).join('、')}）`)
    return ok(id, `计划 ${String(planned.length)} 张数据图全部有落点`
      + (parts.length === 0 ? '' : `（${parts.join('；')}；理由见阶段 5 的规划文件）`))
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

/** 含中日韩字形的文本（这类文本的 font-family 必须点名中文字体）。 */
const CJK_TEXT = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/
/**
 * 点名了中文字体的字体栈。
 *
 * 判据是"**点名**"，不是"含 generic 兜底"：`"Microsoft YaHei", sans-serif` 合格
 * （前面的名字 cairosvg 解析得到），裸 `sans-serif` 不合格（会落到无中日韩字形的默认字体）。
 */
const CJK_CAPABLE_FONT = /(?:YaHei|SimHei|SimSun|PingFang|Noto Sans CJK|Source Han|Hiragino|Heiti|Songti|KaiTi|FangSong|WenQuanYi|Droid Sans Fallback)/i

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
/**
 * **图完整性**（参考工作流的"最高优先级"红线，原话：*prevents "broken / partial" figures*）。
 *
 * 为什么单独立一条：`figure_style_rules` 量的是**风格**（字号/配色/图内标题），
 * 而"这张图能不能读"是另一回事——一张配色完全合规的图完全可以**没有刻度、
 * 没有轴标签**，看上去像个漂浮的色块。参考工作流把它放在最高优先级，原话三条：
 * 1. *"Y-axis MUST keep numeric ticks. Never call set_yticks([]) on a data plot —
 *    an axis with no scale is unreadable. Sparse (3–5 ticks) is fine, empty is forbidden."*
 * 2. *"Both set_xlabel(...) and set_ylabel(...) are mandatory, with units. No bare/unlabeled axes."*
 * 3. *"If you hide x-ticks, you MUST directly label the data. Hiding ticks WITHOUT
 *    direct labels = broken figure."*
 * 还有一条验收动作：*"Open each figure and confirm it is not just floating color blocks."*
 *
 * 判据全部落在**已渲染的 SVG + 声明**上（机械可核）：
 * - 声明里每张数据图都要有非空的 `x_label` 与 `y_label`；
 * - SVG 里值轴要有 ≥3 个数值刻度标签（"稀疏可以，空的不行"）；
 * - 柱状图必须有**类别标签或数值标注**之一（否则是"隐藏刻度又不标注"的残图）。
 */
const figureCompleteness: GateFn = (input) => {
  const id = 'figure_completeness'
  // 规划**在上游**（阶段 6 的 `FIGURE_PLAN.json` 是阶段 5 的产物），本阶段目录也找一遍。
  // 只看一处会让这条门禁在阶段 6 永远给 2——等于没跑。
  const declRaw = input.files.get(FIGURE_PLAN_FILE)
    ?? input.upstream.get(FIGURE_PLAN_FILE) ?? null
  if (declRaw === null) return cannot(id, `${FIGURE_PLAN_FILE} 不在（本阶段目录与上游都没有）—— 没有规划就无从对账`)
  let figures: ReadonlyArray<Record<string, unknown>>
  try {
    const parsed: unknown = JSON.parse(declRaw)
    const list = (parsed as { figures?: unknown }).figures
    if (!Array.isArray(list)) return fail(id, `${FIGURE_PLAN_FILE} 里没有 \`figures\` 数组`)
    figures = list as ReadonlyArray<Record<string, unknown>>
  } catch {
    return fail(id, `${FIGURE_PLAN_FILE} 不是合法 JSON`)
  }
  const dataFigures = figures.filter(f => f['chart_type'] !== 'table')
  if (dataFigures.length === 0) return cannot(id, '规划里没有数据图（只有表格）—— 没有可核对象')
  const problems: string[] = []

  // ① 轴标签（参考红线："Both set_xlabel and set_ylabel are mandatory, with units"）
  for (const f of dataFigures) {
    const fid = String(f['figure_id'] ?? '?')
    for (const key of ['x_label', 'y_label'] as const) {
      const v = f[key]
      if (typeof v !== 'string' || v.trim() === '') {
        problems.push(`${fid}：缺 \`${key}\` —— 参考红线"轴标签必须有、且带单位；裸轴不可接受"`)
      }
    }
  }

  // ② **成图必须真的在、且不是坏文件**。
  // 参考把这条写在 FINAL QUALITY GATE 里：*"PDF < 5000 bytes → FAIL（likely broken）"*。
  // 本仓库的产物是 PNG，缩到 3000 字节作为"疑似损坏"线（简单图的 PNG 也在 10KB 量级）。
  const MIN_IMAGE_BYTES = 3000
  for (const f of dataFigures) {
    const fid = String(f['figure_id'] ?? '?')
    const candidates = ['png', 'pdf', 'svg', 'jpg', 'jpeg'].map(ext => `figures/${fid}.${ext}`)
    // **二进制产物不在 `input.files` 里**（那里只装文本）——PNG 要走 `sizes` 的真实字节数。
    // 实测踩过：只看 `files` 会把每一张 PNG 都判成"没有成图"。
    const hit = candidates.find(c => (input.sizes?.get(c) ?? 0) > 0)
    if (hit === undefined) {
      problems.push(`${fid}：规划了但**没有成图**（找不到 ${candidates.slice(0, 2).join(' / ')}）—— 参考：*"规划了几张就必须画出几张"*`)
      continue
    }
    const bytes = input.sizes?.get(hit) ?? 0
    if (bytes > 0 && bytes < MIN_IMAGE_BYTES) {
      problems.push(`${fid}：成图只有 ${String(bytes)} 字节（< ${String(MIN_IMAGE_BYTES)}）—— 参考把过小的图当“疑似损坏”判失败`)
    }
  }

  // ③ 只要本阶段仍有 SVG（结构图阶段），就继续核它的刻度与标注
  for (const file of renderedSvgFiles(input)) {
    const svg = input.files.get(file) ?? ''
    const numericLabels = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
      .map(m => (m[1] ?? '').trim())
      .filter(t => t !== '' && Number.isFinite(Number(t)))
    if (numericLabels.length < 3) {
      problems.push(`${file}：值轴只有 ${String(numericLabels.length)} 个数值刻度 —— `
        + '参考红线"没有刻度的轴不可读；稀疏（3–5 个）可以，空的禁止"')
    }
  }

  return problems.length === 0
    ? ok(id, `${String(dataFigures.length)} 张数据图：轴标签齐备、成图存在且不小于 ${String(MIN_IMAGE_BYTES)} 字节`)
    : fail(id, problems.slice(0, 6).join('；'))
}

/**
 * **图型多样性** —— 参考工作流的硬规则，原话两条：
 * - *"Hard rule: do not use the same chart type more than 2 times in one paper."*
 * - *"If < 4 unique types for a paper with ≥6 figures, go back and swap."*
 * 还有一条更狠的：*"All bar charts? Mix at least 3+ different types"*。
 *
 * 为什么这不是审美洁癖：一整篇全是柱状图时，读者无法从**图型**上分辨
 * "这是灵敏度排序"还是"这是成本构成"——而那正是图型本身要承载的信息。
 * 参考的决策表对每种数据形态都指定了图型，重复用同一种等于放弃了那层表达。
 *
 * 判据落在**声明**上（图型是声明字段，不必等渲染出来）：
 * - 同一种图型最多出现 `MAX_SAME_TYPE` 次；
 * - 声明 ≥ `MANY_FIGURES` 张图时，unique 图型数不得少于 `MIN_UNIQUE_TYPES`。
 */
const MAX_SAME_TYPE = 3
const MANY_FIGURES = 6
const MIN_UNIQUE_TYPES = 4

const figureDiversity: GateFn = (input) => {
  const id = 'figure_diversity'
  const raw = input.files.get(FIGURE_PLAN_FILE) ?? input.upstream.get(FIGURE_PLAN_FILE) ?? null
  if (raw === null) return cannot(id, `${FIGURE_PLAN_FILE} 不在 —— 没有规划就无从统计图型`)
  let figures: ReadonlyArray<Record<string, unknown>>
  try {
    const parsed: unknown = JSON.parse(raw)
    const list = (parsed as { figures?: unknown }).figures
    if (!Array.isArray(list)) return fail(id, 'FIGURE_DECLARATIONS.json 里没有 `figures` 数组')
    figures = list as ReadonlyArray<Record<string, unknown>>
  } catch {
    return fail(id, 'FIGURE_DECLARATIONS.json 不是合法 JSON')
  }
  if (figures.length === 0) return cannot(id, '声明里没有任何图 —— 没有可统计的对象')
  const counts = new Map<string, number>()
  for (const f of figures) {
    const t = typeof f['chart_type'] === 'string' ? f['chart_type'] : '(未声明)'
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const problems: string[] = []
  for (const [t, n] of counts) {
    if (n > MAX_SAME_TYPE) {
      problems.push(`图型 '${t}' 用了 ${String(n)} 次（上限 ${String(MAX_SAME_TYPE)}）—— `
        + '参考的硬规则：同一种图型不要在一篇里重复超过 2–3 次；'
        + '按它的图型决策表换型（灵敏度排序→tornado、贡献构成→waterfall、'
        + '区间估计→forest、矩阵→heatmap、带重复的趋势→ci_line）')
    }
  }
  if (figures.length >= MANY_FIGURES && counts.size < MIN_UNIQUE_TYPES) {
    problems.push(`共 ${String(figures.length)} 张图却只有 ${String(counts.size)} 种图型 `
      + `（参考：≥${String(MANY_FIGURES)} 张图时 unique 图型应 ≥${String(MIN_UNIQUE_TYPES)}）—— `
      + `现有：${[...counts.entries()].map(([t, n]) => `${t}×${String(n)}`).join('、')}`)
  }
  return problems.length === 0
    ? ok(id, `${String(figures.length)} 张图、${String(counts.size)} 种图型：无单一图型超过 ${String(MAX_SAME_TYPE)} 次`)
    : fail(id, problems.slice(0, 3).join('；'))
}

const figureStyleRules: GateFn = (input) => {
  const id = 'figure_style_rules'
  const svgs = renderedSvgFiles(input)
  // 产物现在是 matplotlib 出的 PNG（二进制）——本条审不了它。
  // **风格改在脚本层审**：`figure_script_quality` 按 `figure_check.sh` 的
  // CRITICAL 规则直接扫 `gen_fig_*.py`（缺 setup_style / 整图标题 / 被禁色板 / 硬编码色）。
  // 留着 SVG 那一支是为了结构图阶段（它仍然出 SVG）。
  if (svgs.length === 0) return cannot(id, '本阶段没有 SVG 产物（数据图现在是 PNG）—— 风格由脚本级门禁 `figure_script_quality` 审')
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
    // **中文标签必须点名可渲染的中文字体**（否则栅格化后是豆腐块）。
    // 为什么这条必须在门禁上：裸 `sans-serif` 在浏览器里看起来完全正常
    // （浏览器会解析到系统中文字体），**只有 `cairosvg` 那条路（docx/PDF）才暴露**——
    // 也就是说，坏掉的正好是交付物，而所有"用浏览器看一眼"的检查都会漏掉它。
    // 实测：旧的 11 阶段运行 18 张图的中文轴标签**全是豆腐块**。
    for (const m of svg.matchAll(/<text\b[^>]*font-family="([^"]*)"[^>]*>([^<]*)<\/text>/g)) {
      const family = (m[1] ?? '').trim()
      const content = m[2] ?? ''
      if (!CJK_TEXT.test(content)) continue
      if (!CJK_CAPABLE_FONT.test(family)) {
        problems.push(`${file}：中文文本「${content.slice(0, 12)}」的 font-family='${family}' `
          + '没有点名中文字体 —— 栅格化进 docx/PDF 后会渲染成豆腐块（□□□□）。'
          + '改用可渲染的中文栈（如 "Microsoft YaHei", "PingFang SC", sans-serif）')
      }
    }
  }
  return problems.length === 0
    ? ok(id, `${String(svgs.length)} 张图全部通过：字号/边界/对比度 + 配色禁令 + 无图内标题 + 中文字体`)
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
 * **数字出生证明**（红队实测的失败模式）—— 每个数字要么是题面给的，要么是模型自己
 * 声明的常数，要么（下游阶段）是 harness 铸出的结果；否则它没有出生证明。
 *
 * 2024B 实测：阶段 2 在没有任何代码执行的情况下手写了最终数值结论，Q2 六种情况
 * 错三种（12.50 vs 真值 15.88、20.19 vs 16.94、12.50 vs 21.68）。错的不是模型，
 * 是**算术**——它在无执行环境下心算。这条门禁就是零数字通道在建模阶段的落点。
 *
 * 白名单来源随阶段不同（都由 `consumes` 保证可见）：
 * - 阶段 2/3：题面给定值（`PROBLEM_FACTS.json`）+ 模型声明的常数（`DECLARATION.json`）
 *   ——此时**还没有任何结果**，所以任何算出来的数都是无出生证明的；
 * - 阶段 9：再加上 harness 铸出的账本（`results.json`）——结果至此才合法。
 */
const numbersTraced: GateFn = (input) => {
  const id = 'numbers_traced'
  // 白名单**为空是合法的**（题面本来就可能没有数值事实）——此时任何数字都是无出生证明的，
  // 照常审计。只有"上游根本没给可核的来源"才是无法判定。
  //
  // **声明文件既可能在上游，也可能就是本阶段的产物**：阶段 2/3 自己产出
  // `DECLARATION.json`（`consumes` 里没有它），而 `upstream` 只装 `consumes` 的东西。
  // 第十处真实误报就撞在这里：模型在 `DECLARATION.json` 里声明了备择次品率 `0.15`，
  // 正文引用它，门禁却因"上游没有 DECLARATION.json"而判它没有出生证明——
  // **白名单的文档来源取不到，门禁就在惩罚守约的模型**。所以本阶段目录也要找一遍。
  const declared = input.upstream.get('DECLARATION.json') ?? input.files.get('DECLARATION.json') ?? null
  const facts = input.upstream.get('PROBLEM_FACTS.json') ?? null
  const ledger = input.upstream.get(RESULTS_LEDGER_FILE) ?? null
  if (facts === null && declared === null) {
    return cannot(id, '既没有 PROBLEM_FACTS.json 也没有 DECLARATION.json —— '
      + '没有任何"出生证明来源"，无从判断某个数字是否有据')
  }
  const allowed = new Set(buildAllowlist([facts, declared, ledger]))
  // 账本数值的**四舍五入变体**也要算有出生证明：正文写"15.88"而账本存"15.8765432"
  // 是正常写作（锚点替换与手写都可能这样）。变体全部由真值派生，偏差有界。
  addRoundedVariants(ledger, allowed)
  // **编外数字登记簿的形态要先合法**（用户口径：可以有编外，但不能不可追溯）。
  // 一个"编外"数字必须能回答两件事：它出现在哪句话里（`quote`）、为什么它既不是
  // 模型常数也不是计算结果（`reason`）。缺任一项就是"凭空出现"——那正是要禁止的。
  const registerProblem = illustrativeRegisterProblem(declared)
  if (registerProblem !== null) return fail(id, registerProblem)
  // **审全部文本面**（散文 + 声明类 JSON），不是只审第一个匹配到的文件——
  // 第一版漏掉了阶段 2 的 DECLARATION.json 与阶段 3 的 DELIVERABLES.json。
  const audited = auditFiles(input.files, allowed)
  if (audited.length === 0) {
    return cannot(id, '本阶段没有可审计的文本产物（.md / 声明类 .json）—— 没有审计对象')
  }
  const bad = audited.filter(a => a.audit.violations.length > 0)
  const total = audited.reduce((n, a) => n + a.audit.scanned, 0)
  if (bad.length === 0) {
    return ok(id, `${String(audited.length)} 个文本产物的 ${String(total)} 个数字全部有出生证明`
      + `（题面给定值 / 声明的常数${ledger !== null ? ' / 铸出的结果' : ''}`
      + `${registerCount(declared) > 0 ? ` / 编外登记 ${String(registerCount(declared))} 条` : ''}）`)
  }
  const parts = bad.slice(0, 3).map((a) => {
    const uniq = [...new Set(a.audit.violations.map(v => v.literal))]
    return `${a.file}：${String(a.audit.violations.length)} 处（去重 ${String(uniq.length)}：`
      + `${uniq.slice(0, 8).join('、')}${uniq.length > 8 ? '…' : ''}）`
      + `，首个 L${String(a.audit.violations[0]?.line ?? 0)}「${a.audit.violations[0]?.context.slice(0, 50) ?? ''}」`
  })
  return fail(id, `有 ${String(bad.length)} 个文件出现**没有出生证明**的数字 —— ${parts.join('；')}。`
    + '补救有三条路：**若它是你的模型常数**（随机种子/容差/网格数/重复次数…），'
    + '写进 `DECLARATION.json` 的 `model_constants`；**若它是计算结果**，改成结果锚点'
    + '（如 `{R-Q2-case5-profit}`）——数值只能由 harness 真跑代码后铸出；'
    + '**若它是反例或示意里的数**（说明某个被否方案会给出什么、某个退化情形长什么样），'
    + '写进 `DECLARATION.json` 的 `illustrative_numbers`（编外登记簿），'
    + '每条要给出 `quote`（它出现在哪句话里）与 `reason`（为什么它既不是常数也不是结果）。'
    + '**编外不等于免登记**：没有登记簿条目，门禁照样判它无出生证明。'
    + '在散文里声明常数不算声明。')
}

/** 编外登记簿的条目数（读不出来按 0 算——形态问题由 `illustrativeRegisterProblem` 报）。 */
function registerCount(declared: string | null): number {
  if (declared === null) return 0
  try {
    const parsed: unknown = JSON.parse(declared)
    const list = (parsed as { illustrative_numbers?: unknown }).illustrative_numbers
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}

/** 编外登记簿的**最低可追溯要求**：`reason` 至少这么长（几个字不算理由）。 */
const REGISTER_REASON_MIN = 10

/**
 * 校验**编外数字登记簿**（`DECLARATION.json` 的 `illustrative_numbers`）。
 *
 * 用户口径：*每个数字都要有出生证明，不能某一数字凭空出现而没有任何可溯源痕迹；
 * 如果是反例或模型有其他可解释的原因，可以统一管理放到编外，但不能不可追溯。*
 *
 * 所以编外这条通道**不是豁免，是换一种记账方式**——它必须留下痕迹：
 * - `value`：那个数（必须是有限数，且真的会被写进白名单）；
 * - `quote`：它出现在哪句话里（人/审计员能照着回原文核）；
 * - `reason`：为什么它既不是模型常数也不是计算结果（"示意/反例"要具体到是哪一处论证）。
 *
 * 三条缺任一条就是"凭空出现"。另加一条结构性约束：**同一条不能登记两个不同的值**
 * （一个 `quote` 对应一个数），否则登记簿就不再是"数 → 出处"的映射。
 *
 * @param declared - `DECLARATION.json` 的文本（可能为 null）。
 * @returns 问题描述；没有登记簿或形态合法时返回 null。
 */
function illustrativeRegisterProblem(declared: string | null): string | null {
  if (declared === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(declared)
  } catch {
    return null // 声明文件本身坏了，由别的判据去报（这里不重复报）
  }
  const list = (parsed as { illustrative_numbers?: unknown }).illustrative_numbers
  if (list === undefined) return null
  if (!Array.isArray(list)) {
    return '`illustrative_numbers`（编外登记簿）必须是数组——每条 `{value, quote, reason}`'
  }
  const problems: string[] = []
  for (const [i, raw] of list.entries()) {
    const at = `第 ${String(i + 1)} 条`
    if (typeof raw !== 'object' || raw === null) {
      problems.push(`${at} 不是对象（应为 \`{value, quote, reason}\`）`)
      continue
    }
    const e = raw as Record<string, unknown>
    const value = e['value']
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${at} 的 \`value\` 不是有限数`)
    }
    const quote = typeof e['quote'] === 'string' ? e['quote'].trim() : ''
    if (quote === '') problems.push(`${at} 缺 \`quote\`（它出现在哪句话里）`)
    const reason = typeof e['reason'] === 'string' ? e['reason'].trim() : ''
    if (reason.length < REGISTER_REASON_MIN) {
      problems.push(`${at} 的 \`reason\` 太短（< ${String(REGISTER_REASON_MIN)} 字）——`
        + '"示意"两个字不算理由，要具体到是哪一处论证')
    }
  }
  return problems.length === 0
    ? null
    : '编外登记簿（`illustrative_numbers`）有不可追溯的条目 —— ' + problems.slice(0, 5).join('；')
      + '。编外**不是豁免而是换一种记账**：每条要能回答"它出现在哪句话里（`quote`）"'
      + '与"为什么它既不是模型常数也不是计算结果（`reason`）"。'
}

/**
 * **逐条能力项覆盖** —— 阶段 1 立的能力清单，阶段 2 必须逐条认领。
 *
 * 为什么需要它：阶段 1 的 `CAPABILITY_CHECKLIST.json` 是后面每一阶段的对照表，
 * 而"逐问覆盖"如果只靠人看，就等于没有。缺一条能力项意味着**某问根本没建模**，
 * 但报告照样能写得很长——`modeling_floor` 只看字节数，看不出来。
 *
 * "落地"的机器可读形态就是**能力项 id 的引用**：阶段 2 的 `ModelSpec.checklist_refs`
 * 逐条挂上 `C-*`（简报里有硬性要求）。所以判据是"每个 id 都在本阶段产物里出现过"，
 * 而不是"报告里提过某个词"——后者无法机械判定，且正是"看起来做了但其实没有"的温床。
 *
 * 2024B 实测：这一版模型 20/20 全部认领（都在 `DECLARATION.json` 的 `checklist_refs` 里）。
 * 判据落在"本阶段全部文本产物"上而不是只查 `DECLARATION.json`：只要认领得下、说得出，
 * 写在哪一份里不该由门禁规定死。
 */
const modelingCoverage: GateFn = (input) => {
  const id = 'modeling_coverage'
  const raw = input.upstream.get('CAPABILITY_CHECKLIST.json') ?? null
  if (raw === null) {
    return cannot(id, '上游没有 CAPABILITY_CHECKLIST.json —— 没有对照表，无从判断能力项是否被认领')
  }
  let ids: ReadonlyArray<string>
  try {
    const parsed: unknown = JSON.parse(raw)
    // 数组键名两种都认：生成器产出的是 `capabilities`，而参考工作流的旧形态是 `items`。
    // 只认一种会把"形态差异"变成"一条能力项都没有"的假硬失败——而这条门禁的判据
    // 本该是**覆盖**，不是**键名**。
    const o = parsed as { capabilities?: unknown; items?: unknown }
    const caps = Array.isArray(o.capabilities) ? o.capabilities : o.items
    if (!Array.isArray(caps)) {
      return fail(id, 'CAPABILITY_CHECKLIST.json 里没有 `capabilities`（或 `items`）数组 —— 对照表形态不对')
    }
    ids = caps.flatMap((c): ReadonlyArray<string> => {
      if (typeof c !== 'object' || c === null) return []
      const capId = (c as { id?: unknown }).id
      return typeof capId === 'string' && capId !== '' ? [capId] : []
    })
  } catch {
    return fail(id, 'CAPABILITY_CHECKLIST.json 不是合法 JSON —— 对照表读不出来')
  }
  if (ids.length === 0) {
    return fail(id, 'CAPABILITY_CHECKLIST.json 的 `capabilities` 为空 —— 阶段 1 没有立出任何能力项')
  }
  const haystack = [...input.files.values()].join('\n')
  const missing = ids.filter(capId => !haystack.includes(capId))
  if (missing.length > 0) {
    return fail(id, `${String(missing.length)}/${String(ids.length)} 条能力项**没有被认领**：`
      + `${missing.slice(0, 10).join('、')}${missing.length > 10 ? '…' : ''}。`
      + '缺一条就意味着那一问没有建模落地。补救：在对应 `ModelSpec.checklist_refs` 里挂上该 id'
      + '（或在报告里明确写出该 id 的落点）——id 要**逐字出现**，换个说法不算认领。')
  }
  return ok(id, `${String(ids.length)} 条能力项全部被认领（逐字命中 id）`)
}

/**
 * **不许声称"已执行检验"** —— 在代码存在之前，任何"检验通过"都是假的。
 *
 * 红队实测：阶段 2 的 §9 写"表 1 的六种情况与问题 3 的算例全部通过（容差 1e-6）"，
 * 而这些检验**一次都没跑过**（阶段 3 尚不存在代码）。这比单个错数字更危险——
 * 它给下游传递"已验证"的假信号。
 */
const noClaimedVerification: GateFn = (input) => {
  const id = 'no_claimed_verification'
  // 审散文全文 + **代码注释**（红队点名：把心算数字抄进代码注释里说"验证通过"）。
  // 代码本体不审——`range(1,11)` / `1e-6` / `figsize=(8,6)` 会满屏误报。
  const scanned: Array<{ file: string; claims: ReadonlyArray<{ line: number; context: string; why: string }> }> = []
  for (const [name, text] of input.files) {
    if (/\.md$/i.test(name)) {
      const claims = verificationClaims(text)
      if (claims.length > 0) scanned.push({ file: name, claims })
      continue
    }
    if (/\.py$/i.test(name)) {
      const lines = commentLines(text)
      const claims: Array<{ line: number; context: string; why: string }> = []
      lines.forEach((comment, i) => {
        if (comment === '') return
        for (const c of verificationClaims(comment)) claims.push({ line: i + 1, context: comment.trim().slice(0, 100), why: `代码注释里的${c.why}` })
      })
      if (claims.length > 0) scanned.push({ file: name, claims })
    }
  }
  if (scanned.length === 0) return ok(id, '没有"已执行检验"类声明（检验方案都写成待执行；代码注释也干净）')
  const total = scanned.reduce((n, s2) => n + s2.claims.length, 0)
  return fail(id, `${String(total)} 处声称已执行检验：`
    + scanned.slice(0, 3).map(s2 => `${s2.file} L${String(s2.claims[0]?.line ?? 0)}（${s2.claims[0]?.why ?? ''}）${s2.claims[0]?.context.slice(0, 50) ?? ''}`).join('；')
    + ' —— 本阶段还没有代码执行，检验不可能跑过；把结论改成"检验方案（待执行）"')
}

// ══════════════════════════════════════════════════════════════════════════
// 三道从参考实现**逐条移植**的代码级静态门禁
//
// 为什么现在补：简报里早就写着"门禁 `claim_code_check` 零方向知识逐条核""门禁
// `data_ingest_check` 判硬失败""门禁 `facts_audit` 会扫代码里的裸数字"，但这三条
// 门禁在 `GATES` 里**根本不存在**——契约在向模型承诺一个不会运行的检查。
// 这是最坏的一种不一致：模型按"会被核"的假设写代码，实际无人核。
//
// 移植的是参考的**判据与哲学**（`claim_code_check.py` / `data_ingest_check.py` /
// `facts_audit.py`），不是字面：参考用 Python 正则扫源码，这里同样用正则扫源码，
// 逐条对齐它的白名单与上下文门控。**宁可漏报，不可误报**是三条共用的铁律——
// 每一条的误报都会让模型去修一个不存在的问题（实测代价：反复重启、进度卡死）。
// ══════════════════════════════════════════════════════════════════════════

/** 本阶段目录里的 `code/*.py` 源码（递归收集后 `files` 的键形如 `code/problem1.py`）。 */
function pySources(input: GateInput): ReadonlyArray<readonly [string, string]> {
  return [...input.files.entries()].filter(([name]) => /^code\/.+\.py$/i.test(name))
}

/**
 * 去掉**整行注释**（保留行号），防注释里的词骗过扫描。
 *
 * 对应参考 `claim_code_check.py::_load_code`：它只跳整行注释，不跳行内注释——
 * 移植时保持同一口径，否则本文件的判据会比参考松/紧，两边不可比。
 */
function stripFullLineComments(src: string): string {
  return src.split('\n').map(line => (line.trimStart().startsWith('#') ? '' : line)).join('\n')
}

/** 按正则搜；正则非法则退化为字面量搜（防上游写的模式编译报错拖垮整道闸）。 */
function safeSearch(pattern: string, haystack: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(haystack)
  } catch {
    return haystack.toLowerCase().includes(pattern.toLowerCase())
  }
}

/** 一条 `METHOD_CLAIMS_MACHINE` 签名。 */
export interface MethodClaim {
  readonly id: string
  readonly must: ReadonlyArray<string>
  readonly forbid: ReadonlyArray<string>
}

/**
 * 解析建模阶段的机器可核合同块。**两种写法都认**：
 * - 参考形态：`<!-- METHOD_CLAIMS_MACHINE` … `-->`（块头直接跟名字）；
 * - 本仓库的**家规形态**：`<!-- BEGIN METHOD_CLAIMS_MACHINE -->` … `<!-- END … -->`
 *   ——与 `FIGURE_MANIFEST` / `ARCH_DECLARATION` 一致。
 *
 * ⛔ 只认参考那一种会**假阴性**：实测 2024B 的 `DECLARATION.json` 里
 * `method_claims_machine_block` 用的就是家规形态，于是门禁报"无合同块、仅内置安全网生效"
 * ——合同一直都在（8 条签名），只是解析器没认出来。**漏认 = 这条门禁白建**。
 *
 * 格式（每行一条）：
 * ```
 * M1 | must: LpInteger, GRB.INTEGER | forbid: 就近配车, p_median
 * ```
 * 语义：`must` **至少命中一个**即算实现（need_any，防误判）；`forbid` 命中任一即铁证降级。
 */
export function parseMethodClaims(text: string): ReadonlyArray<MethodClaim> {
  // 家规形态优先：`<!-- BEGIN NAME -->` … `<!-- END NAME -->`。**不能**用一条"懒匹配到
  // 最近的 `-->`"的正则去覆盖它——那样匹配到的是 BEGIN 标记自己的结束符，块体是空的
  // （实测就是这么把 8 条签名读成 0 条的）。
  const houseOpen = /<!--\s*BEGIN\s+METHOD_CLAIMS_MACHINE\s*-->/i.exec(text)
  let body: string | null = null
  if (houseOpen !== null) {
    const rest = text.slice(houseOpen.index + houseOpen[0].length)
    const endIdx = rest.search(/<!--\s*END\s+METHOD_CLAIMS_MACHINE/i)
    // 没有 END 标记也认（模型漏写收尾不该让整块合同失效）：取到下一个注释或 4000 字符。
    body = endIdx >= 0 ? rest.slice(0, endIdx) : rest.slice(0, 4000)
  } else {
    // 参考形态：`<!-- METHOD_CLAIMS_MACHINE` 后直接跟内容，直到 `-->`。
    body = /<!--\s*METHOD_CLAIMS_MACHINE\s+([\s\S]*?)-->/i.exec(text)?.[1] ?? null
  }
  if (body === null) return []
  const out: MethodClaim[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('<!--') || line.startsWith('-->')) continue
    const parts = line.split('|').map(p => p.trim())
    let must: string[] = []
    let forbid: string[] = []
    for (const seg of parts.slice(1)) {
      const low = seg.toLowerCase()
      if (low.startsWith('must:')) {
        must = seg.slice(5).split(',').map(x => x.trim()).filter(x => x !== '')
      } else if (low.startsWith('forbid:')) {
        forbid = seg.slice(7).split(',').map(x => x.trim()).filter(x => x !== '')
      }
    }
    if (must.length > 0 || forbid.length > 0) out.push({ id: parts[0] ?? '?', must, forbid })
  }
  return out
}

/** 内置安全网规则（对应参考的 `RULES`，只收"命中即铁证、缺失即铁证"的强规则）。 */
interface MethodRule {
  readonly name: string
  readonly claimKw: ReadonlyArray<string>
  readonly needAny: ReadonlyArray<string>
  readonly hint: string
}

/**
 * 内置安全网：**仅三条**通用灾难级降级，不按方向扩充（扩充是 `METHOD_CLAIMS_MACHINE` 的活）。
 *
 * 触发词沿用参考收紧后的版本。参考对裸词"排队/泊松"的注释值得照抄一遍：
 * 裸词会被论文背景与文献综述误命中（"交通排队现象""数据服从泊松分布"），
 * 于是方法明明是确定性优化却被判"声称随机仿真但没实现"——**误报比漏报更贵**。
 *
 * ⛔ **与参考的一处刻意偏离**：参考把"蒙特卡洛"与"排队/泊松到达"收在同一条规则里，
 * 而它的 `need_any` 只认到达过程与队列结构。那样一来"用蒙特卡洛做情景重抽样"的题
 * （2024B 就是）会被判"声称蒙特卡洛却没有到达采样"——**那是误报**：蒙特卡洛不蕴含队列。
 * 所以这里拆成两条：队列/离散事件那条沿用参考的强判据；蒙特卡洛那条只要求
 * "真的有随机抽样"（random/sample/choice/bootstrap/重抽样/固定种子）。
 */
const METHOD_RULES: ReadonlyArray<MethodRule> = [
  {
    name: '整数规划(整数决策变量)',
    claimKw: ['整数规划', '混合整数', '\\bMILP\\b', '\\bMIP\\b', 'integer program'],
    needAny: [
      'LpInteger', "cat\\s*=\\s*['\"]Integer['\"]", 'GRB\\.INTEGER',
      "vtype\\s*=\\s*['\"]?I", 'integrality\\s*=', 'cp_model', 'NewIntVar',
      'Bool(ean)?Var', 'LpBinary', "cat\\s*=\\s*['\"]Binary['\"]",
    ],
    hint: '声称整数规划，但代码里找不到任何整数/0-1 变量标记'
      + '（LpInteger/cat=Integer/GRB.INTEGER/integrality=/NewIntVar 等）。'
      + '若实际用 scipy.optimize.linprog 且变量全连续 → 名不副实，改代码或改声称。',
  },
  {
    name: '排队/离散事件仿真(泊松到达/指数服务/队列)',
    claimKw: [
      '\\bM/M/', '离散事件', '随机仿真', '到达过程',
      '泊松到达', '泊松过程', '[Pp]oisson\\s*(?:arrival|process|到达|过程)',
      '排队(?:仿真|模型|系统|网络|论)',
    ],
    // 铁证只认"到达过程 + 队列/事件结构"，**故意不收 exponential/expovariate**：
    // "给固定值加一点指数噪声"也用 exponential，收了它就会把降级放过去。
    needAny: [
      '\\.poisson\\s*\\(', 'rng\\.poisson', 'np\\.random\\.poisson',
      '\\bqueue\\b', 'heapq', 'simpy', 'interarrival',
      '到达时刻', '到达间隔', 'arrival_time', 'event_list', 'SimTime',
    ],
    hint: '声称泊松/排队/离散事件仿真，但代码里找不到到达过程采样或队列/事件结构'
      + '（poisson 到达 / queue / heapq / 到达时刻推进）。'
      + '若只是给固定响应时间加一点指数噪声（如 base + exponential(0.3)）→ 不是仿真，'
      + '必须补真到达采样+队列状态，或把声称改成"解析近似/敏感性扰动"。',
  },
  {
    name: '蒙特卡洛/随机抽样',
    claimKw: ['蒙特卡洛', 'Monte\\s*Carlo', '随机抽样', '重抽样', 'bootstrap', 'Bootstrap'],
    // 蒙特卡洛的"实现铁证"就是**真的有随机数**：抽样本、按分布采样、重抽样、
    // 固定种子后重复 —— 命中任一即算实现（need_any）。一处都没有，
    // 那这个声称就是名不副实（写的其实是确定性计算）。
    needAny: [
      'random', 'sample', 'choice', 'poisson', 'normal\\s*\\(', 'uniform',
      'bootstrap', '重抽样', 'seed', '种子', 'randint', 'rand\\(',
    ],
    hint: '声称蒙特卡洛/随机抽样，但代码里找不到任何随机数来源'
      + '（random / sample / choice / 按分布采样 / 重抽样 / 固定种子）。'
      + '若实际是确定性计算 → 改声称（"解析计算"/"情景枚举"），别写蒙特卡洛。',
  },
]

/**
 * **声称 ↔ 代码实现**（移植 `claim_code_check.py`）。
 *
 * 两层，都是"代码有没有背叛建模声称"的方向无关核对：
 * - (A) 通用合同（主）：执行建模阶段自己写的 `must`/`forbid` 签名，脚本零方向知识
 *   ——数模/NLP/CV/RL 全靠同一引擎，加新方向不改脚本、不堆规则库；
 * - (B) 内置安全网（兜底）：整数规划 / 排队仿真 / 蒙特卡洛三条通用灾难级降级。
 *
 * 参考原话：*"凭印象退化成 plot/bar/scatter 是最常见的质量塌方"*，这条就是治它的。
 */
const claimCodeCheck: GateFn = (input) => {
  const id = 'claim_code_check'
  const sources = pySources(input)
  if (sources.length === 0) {
    return cannot(id, '本阶段没有 `code/*.py` —— 没有可核的实现，无法判断声称与代码是否一致')
  }
  // 声称来源：上游 `MODELING_REPORT.md` + **上游 `DECLARATION.json`** + 本阶段 `RESULTS.md`。
  //
  // ⛔ `DECLARATION.json` 这一路**必须带上**：实测（2024B）机器合同块并不在报告里，
  // 而是在声明文件里（`method_claims_machine` 8 条 + `method_claims_machine_block`
  // 的 HTML 注释块 + `logic_contract_machine` 八键 + `cross_problem_ledger`）。
  // 只读报告的第一版因此报了"无 `METHOD_CLAIMS_MACHINE` 合同块，仅内置安全网生效"
  // ——**假阴性**：合同一直都在，只是门禁没去看它。漏读一路来源 = 这条门禁白建。
  // 参考还会并入 paper/sections，但论文在阶段 9，本阶段看不到——如实少一路来源。
  const claimText = [
    input.upstream.get('MODELING_REPORT.md') ?? '',
    input.upstream.get('DECLARATION.json') ?? '',
    input.files.get('RESULTS.md') ?? '',
  ].join('\n')
  if (claimText.trim() === '') {
    return cannot(id, '既没有上游 `MODELING_REPORT.md` 也没有本阶段 `RESULTS.md` —— 没有可核的方法声称')
  }
  const codeText = sources.map(([, src]) => stripFullLineComments(src)).join('\n')

  const problems: string[] = []
  let checked = 0
  // (B) 内置安全网
  for (const rule of METHOD_RULES) {
    if (!rule.claimKw.some(p => safeSearch(p, claimText))) continue // 没声称这类方法 → 不检查
    checked += 1
    if (!rule.needAny.some(p => safeSearch(p, codeText))) problems.push(`[内置] ${rule.name}：${rule.hint}`)
  }
  // (A) 通用合同（执行建模者写的签名）
  const contract = parseMethodClaims(claimText)
  for (const c of contract) {
    if (c.must.length > 0 && !c.must.some(p => safeSearch(p, codeText))) {
      problems.push(`[合同 ${c.id}·must] 声称需实现但代码找不到任一必备签名：${c.must.join('、')}`)
    }
    const hitForbid = c.forbid.filter(p => safeSearch(p, codeText))
    if (hitForbid.length > 0) {
      problems.push(`[合同 ${c.id}·forbid] 代码出现建模报告明令禁止的降级签名：${hitForbid.join('、')}`)
    }
  }

  if (problems.length > 0) {
    return fail(id, `${String(problems.length)} 条方法声称与代码实现脱钩（名不副实/降级冒充）—— `
      + problems.slice(0, 5).join('；')
      + '。修复：要么把代码补成真正实现该方法，要么把建模报告/正文的声称改成代码真做的事'
      + '（合同 must/forbid 签名由建模阶段针对本题所填，方向无关）。')
  }
  const contractNote = contract.length === 0
    ? '；⚠ 上游产物里找不到 `METHOD_CLAIMS_MACHINE` 合同块 —— 仅内置安全网生效，'
      + '本题特有方法**无人核**（建议阶段 2 补机器可核签名：'
      + '`<!-- BEGIN METHOD_CLAIMS_MACHINE -->` 一行一条 `M1 | must: … | forbid: …`）'
    : `；通用合同核对了 ${String(contract.length)} 条签名`
  return ok(id, `内置安全网检查了 ${String(checked)} 类方法声称，全部有实现铁证${contractNote}`)
}

/** 把三引号块整段置空但保留换行数（维持行号映射）——对应参考 `_blank_triple_quoted`。 */
function blankTripleQuoted(src: string): string {
  return src.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, m => '\n'.repeat(m.split('\n').length - 1))
}

/**
 * 去掉一行里**字符串外**的 `#` 注释（整行注释 → 返回空串），保留字符串里的 `#`。
 *
 * 字符级扫描、跳过引号内内容——对应参考 `_strip_line_comment`。防注释/docstring 里
 * 贴的 `pd.read_excel(f)` 被当真代码误判为硬失败。
 */
function stripLineComment(line: string): string {
  let quote = ''
  let i = 0
  while (i < line.length) {
    const c = line[i] ?? ''
    if (quote !== '') {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = ''
      i += 1
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '#') return line.slice(0, i)
    i += 1
  }
  return line
}

/** 剥三引号块 + 逐行去注释（保留行号）——对应参考 `_strip_comment_lines`。 */
function stripComments(src: string): string {
  return blankTripleQuoted(src).split('\n').map(stripLineComment).join('\n')
}

/** 从 `text[openIdx] === '('` 开始做括号配平，跳过引号内内容，返回匹配 `)` 的下标（找不到 -1）。 */
function matchParen(text: string, openIdx: number): number {
  let depth = 0
  let i = openIdx
  let quote = ''
  while (i < text.length) {
    const c = text[i] ?? ''
    if (quote !== '') {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = ''
      i += 1
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return -1
}

/**
 * **数据摄入完整性**（移植 `data_ingest_check.py`）——防"静默少喂数据"。
 *
 * 最典型的坑：`pd.read_excel` 不写 `sheet_name` → pandas 默认只读第一个 sheet、
 * 不报错不告警 → 多 sheet 数据被静默丢掉。程序照常跑完，结果全是错的。
 *
 * 唯一硬失败项就是它（零成本、无歧义的铁证）；`nrows=` / `.head(大数)` / 大切片
 * 这类"疑似截断"只报警告——静态查不出用途，可能只是探查预览。
 */
const dataIngestCheck: GateFn = (input) => {
  const id = 'data_ingest_check'
  const sources = pySources(input)
  if (sources.length === 0) {
    return cannot(id, '本阶段没有 `code/*.py` —— 没有数据读取代码可扫')
  }
  const excelCall = /(?<![\w.])(?:pd\.|pandas\.)?read_excel\s*\(/g
  const sheetKw = /sheet_name\s*=/
  const parseCall = /\.parse\s*\(/g
  const nrows = /\bnrows\s*=\s*(\d+)/
  const headCall = /\.head\s*\(\s*(\d{4,})\s*\)/
  const sliceCall = /\[\s*:\s*(\d{4,})\s*\]/

  const hard: string[] = []
  const warns: string[] = []
  let usedExcel = false
  for (const [name, raw] of sources) {
    const src = stripComments(raw)
    const lineOf = (idx: number): number => src.slice(0, idx).split('\n').length
    // 1) read_excel 无 sheet_name → 硬失败
    for (const m of src.matchAll(excelCall)) {
      const openIdx = src.indexOf('(', m.index)
      const closeIdx = matchParen(src, openIdx)
      const args = closeIdx > openIdx ? src.slice(openIdx, closeIdx + 1) : src.slice(openIdx, openIdx + 200)
      if (!sheetKw.test(args)) {
        hard.push(`${name}:${String(lineOf(m.index))} read_excel(...) 未写 sheet_name= —— `
          + 'pandas 默认只读第 1 个 sheet 且不报错，多 sheet 数据会被静默丢掉。'
          + '改成 sheet_name=None 读全部并合并，或显式写死用哪张并在注释里说明理由')
      }
    }
    // 2) ExcelFile(...).parse() 空参 → 硬失败。
    //    上下文门控：文件里没出现过 ExcelFile 就不查 .parse()，否则会误伤
    //    dateutil.parser.parse() / 自定义 obj.parse() 等无辜空参调用（宁漏勿误）。
    if (src.includes('ExcelFile')) {
      for (const m of src.matchAll(parseCall)) {
        const openIdx = src.indexOf('(', m.index)
        const closeIdx = matchParen(src, openIdx)
        const args = closeIdx > openIdx ? src.slice(openIdx, closeIdx + 1) : src.slice(openIdx, openIdx + 200)
        const firstArg = args.replace(/^\(+/, '').replace(/\)+$/, '').split(',')[0]?.trim() ?? ''
        if (!sheetKw.test(args) && firstArg === '') {
          hard.push(`${name}:${String(lineOf(m.index))} ExcelFile.parse() 未指定 sheet —— `
            + '同样默认只读首表，请显式传 sheet 名/索引，或改用 read_excel(sheet_name=None)')
        }
      }
    }
    if (excelCall.test(src) || src.includes('ExcelFile')) usedExcel = true
    excelCall.lastIndex = 0
    // 3) 截断写法 → 警告（不阻断）
    for (const m of src.matchAll(new RegExp(nrows.source, 'g'))) {
      warns.push(`${name}:${String(lineOf(m.index))} nrows=${m[1] ?? ''} —— 若这是建模用数据，`
        + '顺序截断会丢样本且引入顺序偏差；确需抽样用 df.sample(n=, random_state=) 并声明"抽样 X / 总量 Y"')
    }
    for (const [re, tag] of [[headCall, '.head('], [sliceCall, '切片 [:N]']] as const) {
      for (const m of src.matchAll(new RegExp(re.source, 'g'))) {
        warns.push(`${name}:${String(lineOf(m.index))} ${tag}${m[1] ?? ''}) —— 疑似把大数据顺序截断当抽样，`
          + '确认是探查预览而非喂给模型的训练/建模数据')
      }
    }
  }
  // 用了 Excel 却没有机器建档 → 警告（行数断言的权威基准还没建）
  if (usedExcel && !input.files.has('DATA_PROFILE.json')) {
    warns.push('代码读了 Excel，但本阶段没有 `DATA_PROFILE.json` —— "读没读全"缺少机器基准，'
      + '行数断言会退化成靠记忆手填（易随上下文漂移出错）')
  }
  if (hard.length > 0) {
    return fail(id, `${String(hard.length)} 处数据读取存在"静默只读一部分"的写法 —— `
      + hard.slice(0, 4).join('；')
      + '。修复：Excel 读取必须显式表明读哪张表（`sheet_name=None` 读全部 / 写死某张并注明），'
      + '禁止依赖"默认只读首表"。')
  }
  return ok(id, `扫描 ${String(sources.length)} 个 .py：所有 Excel 读取都显式声明了 sheet_name`
    + `（无静默首表陷阱）${warns.length > 0 ? `；⚠ ${String(warns.length)} 处疑似截断待人工确认（${warns[0]?.slice(0, 80) ?? ''}）` : ''}`)
}

/** 数字字面量：数字后允许跟字母（单位），但禁止跟点或数字（避免抓章节号 1.2.3）。 */
const FACT_NUM_RE = /(?<![\w.])([-+]?\d+\.\d+|\d+)(?![.\d])/g
/** 数字白名单：常用辅助常数，不参与"虚构"判定（参考 `WHITELIST` 逐字对齐）。 */
const FACT_WHITELIST = new Set([0, 1, 2, 3, 4, 5, 10, 100, 1000, 60, 24, 0.5, 1.5, -1])
/** 抽 facts 时跳过的元信息键（参考 `SKIP_KEYS`）。 */
const FACT_SKIP_KEYS = new Set(['source', 'raw_quote', 'machine_check', 'factor', 'sha256', 'path', 'note'])

/** 从 facts 嵌套结构里递归抽数值字段（跳过元信息键）。对应参考 `extract_numbers_from_facts`。 */
function numbersFromFacts(node: unknown, out: Set<number>): void {
  if (typeof node === 'number') {
    if (Number.isFinite(node)) out.add(Math.round(node * 1e4) / 1e4)
    return
  }
  if (Array.isArray(node)) { for (const v of node) numbersFromFacts(v, out); return }
  if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('_') || FACT_SKIP_KEYS.has(k)) continue
      numbersFromFacts(v, out)
    }
  }
}

/**
 * **代码裸数字审计**（移植 `facts_audit.py::audit_code_against_facts` + `audit_params_py_enforced`）。
 *
 * ⚠ **这条是警告级，不是硬失败**——参考里它的产物全部以 `⚠` 开头（exit 2，可继续）。
 * 移植时保持同一强度：代码里的 `dpi=300`、`figsize=(10,6)`、`1e-9`、`range(1000)`
 * 都是合法写法，把它判成硬失败会制造大量误报，而误报的代价是模型去修不存在的问题。
 *
 * 判据两条：
 * 1. 代码里的数字字面量既不在白名单、也不在题面给定值/模型常数里 → 疑似虚构；
 * 2. 有数字字面量却不 `import params` 的文件 → 可能凭印象写裸数字（常数没走契约）。
 */
const factsAudit: GateFn = (input) => {
  const id = 'facts_audit'
  const sources = pySources(input)
  if (sources.length === 0) return cannot(id, '本阶段没有 `code/*.py` —— 没有可扫的代码')
  const factsRaw = input.upstream.get('PROBLEM_FACTS.json') ?? null
  const declaredRaw = input.upstream.get('DECLARATION.json') ?? input.files.get('DECLARATION.json') ?? null
  if (factsRaw === null && declaredRaw === null) {
    return cannot(id, '既没有 `PROBLEM_FACTS.json` 也没有 `DECLARATION.json` —— '
      + '没有"题面给定值/模型常数"的基准集合，无从判断代码里的数字有没有来源')
  }
  const allowed = new Set<number>()
  for (const raw of [factsRaw, declaredRaw]) {
    if (raw === null) continue
    try {
      numbersFromFacts(JSON.parse(raw) as unknown, allowed)
    } catch { /* 上游 JSON 坏了由它自己的门禁报，这里不重复报 */ }
  }
  const suspicious: string[] = []
  const noParams: string[] = []
  for (const [name, raw] of sources) {
    const base = name.split('/').pop() ?? name
    if (base === 'params.py') continue // 契约文件本身就是常数的出处
    const lines = raw.split('\n')
    let hits = 0
    lines.forEach((line, i) => {
      const s = line.trim()
      if (s.startsWith('#') || s.startsWith('import') || s.startsWith('from')) return
      for (const m of line.matchAll(new RegExp(FACT_NUM_RE.source, 'g'))) {
        const v = Number(m[1])
        if (!Number.isFinite(v)) continue
        const r4 = Math.round(v * 1e4) / 1e4
        if (FACT_WHITELIST.has(v) || allowed.has(r4)) continue
        hits += 1
        if (suspicious.length < 12) {
          suspicious.push(`${name}:${String(i + 1)} 值=${String(v)} ${s.slice(0, 60)}`)
        }
      }
    })
    if (hits > 0 && !/^\s*(?:from\s+params\s+import|import\s+params)/m.test(raw)) noParams.push(name)
  }
  const notes: string[] = []
  if (suspicious.length > 0) {
    notes.push(`${String(suspicious.length)} 处数字字面量既不在白名单也不在题面给定值/模型常数里`
      + `（${suspicious.slice(0, 3).join('；')}${suspicious.length > 3 ? '…' : ''}）—— `
      + '若它是模型常数，登记进 `DECLARATION.json` 的 `model_constants`；若是题面给定值，走 `params.py`')
  }
  if (noParams.length > 0) {
    notes.push(`${String(noParams.length)} 个文件有数字字面量却未 \`from params import *\`（${noParams.slice(0, 5).join('、')}）`
      + '—— 可能凭印象写裸数字；数值常数应从 `params.py` 取')
  }
  if (notes.length === 0) {
    return ok(id, `扫描 ${String(sources.length)} 个 .py：数字字面量都有来源（白名单/题面给定值/模型常数），且常数走契约`)
  }
  return ok(id, `⚠ 警告级（不阻断）：${notes.join('；')}`)
}

/**
 * **论文声称核对** —— "装配而非推理"这一前提的机械强制手段。
 *
 * 判据是**锚点必须落地**：正文里每个 `{R-…}` 都要能解析到阶段 4 铸出的账本
 * （`results.json`）。落地的那部分由 harness 在模型落盘后**替换成真值**
 * （`anchor-resolve.ts`），所以走到门禁时**剩下的锚点就是没落地的**——它们是两类真实缺陷：
 * - 账本里根本没有这个 id → 论文引用了一个不存在的结果（凭空写出来的"成果"）；
 * - 值是数组/矩阵 → 不能内联成数值，正文该写"见图 N / 见表 N"。
 *
 * 两类都会**原样印进最终 Word**（`docx_precheck` 只认 `{<result_id>}` 尖括号形态，
 * `numbers_traced` 把 `{…}` 整段剥掉），所以这条门禁是它们唯一的拦截点。
 */
const paperClaimCheck: GateFn = (input) => {
  const id = 'paper_claim_check'
  const paper = text(input, 'paper/main.md')
  if (paper === null) return fail(id, '`paper/main.md` 不存在 —— 没有可核对的正文')
  const ledgerRaw = input.upstream.get(RESULTS_LEDGER_FILE) ?? null
  if (ledgerRaw === null) {
    return cannot(id, '上游没有 `results.json`（阶段 4 铸出的账本）—— '
      + '没有可核对的落地，无从判断正文里的结果锚点是否有据')
  }
  const report = parseAnchorReport(input.files.get(ANCHOR_REPORT_FILE) ?? null)
  // 权威判据是**扫正文**（报告只是证据补充）：报告坏掉/没写都不影响判定。
  const leftover = anchorsIn(blankFencedCode(paper))
  const resolvedNote = report === null || report.resolved === 0
    ? ''
    : `；另 ${String(report.resolved)} 个锚点已由 harness 换成账本真值`
  if (leftover.length === 0) {
    return ok(id, `正文里的结果锚点全部落地${resolvedNote}`)
  }
  const reasons = new Map((report?.unresolved ?? []).map(u => [u.id, u.reason]))
  const parts = leftover.slice(0, 4).map(a => `${a}（${reasons.get(a) ?? '未能替换'}）`)
  return fail(id, `${String(leftover.length)} 个结果锚点**没能落地**（会原样印进最终 Word）—— `
    + parts.join('；')
    + '。补救：**账本里有的**结果就直接写它的值（harness 会把锚点换成真值，无需你手打）；'
    + '**账本里没有的**说明上游没有这个结果——回阶段 3/4 把它真算出来并登记，'
    + '或者把这句话改成上游真有的结果；**数组/矩阵类结果**（扫描表、组合矩阵、样本序列）'
    + '在正文里要写成"见图 N"或"见表 N"，不能当数值内联。')
}

/**
 * **声明的交付物与磁盘一致**（移植 `delivery_audit.py`）。
 *
 * 参考的判据是"`DELIVERABLES.json` 声明的每个交付物**真的存在且非空**"。
 * 直接照搬会误报——本 harness 的清单里**混着两类东西**（实测 2024B 的 14 条）：
 * - **阶段产物**：`code/*.py`、`RESULTS.md`、`DELIVERABLES.json` —— 门禁时**必须在**；
 * - **运行期产物**：`code/problem1.json`、`code/outputs.json` —— 由阶段 4 真跑代码才生成，
 *   阶段 3 的门禁时**必然不在**。把后者判成失败，就是在惩罚一份完全正确的清单。
 *
 * 所以三类分别判：
 * 1. 在磁盘上 → 非空 + 满足自己声明的 `min_bytes`（否则**硬失败**）；
 * 2. 不在磁盘上、但**代码里写得出它**（源码出现该文件名或其去扩展名形态）→ 运行期产物，放行并记账；
 * 3. 不在磁盘上、代码里也找不到 → **硬失败**：声明了一个没人产出的交付物。
 */
const deliveryAudit: GateFn = (input) => {
  const id = 'delivery_audit'
  const raw = input.files.get('DELIVERABLES.json') ?? null
  if (raw === null) return fail(id, '`DELIVERABLES.json` 不存在 —— 没有可核的产出清单')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail(id, `\`DELIVERABLES.json\` 不是合法 JSON（${String(error).slice(0, 80)}）—— 清单读不出来就无从核对`)
  }
  // 键名两种都认：契约写的是 `deliverables`，实测模型写的是 `artifacts`。
  // 只认一种会把"键名差异"变成"一条交付物都没声明"的假硬失败——判据是**一致**，不是键名。
  const o = parsed as Record<string, unknown>
  const list = [o['deliverables'], o['artifacts']].find(Array.isArray) as ReadonlyArray<unknown> | undefined
  if (list === undefined) {
    return fail(id, '`DELIVERABLES.json` 里没有 `deliverables` / `artifacts` 数组 —— 没有可核的清单')
  }
  if (list.length === 0) return fail(id, '`DELIVERABLES.json` 的交付物清单是空的 —— 声明了零个产出')

  // 代码文本：判"运行期产物"的凭据（源码里出现文件名 = 代码会写出它）。
  const codeText = [...input.files.entries()]
    .filter(([n]) => /\.py$/i.test(n))
    .map(([, body]) => body)
    .join('\n')
  const problems: string[] = []
  const runtime: string[] = []
  let present = 0
  for (const [i, entry] of list.entries()) {
    const at = `第 ${String(i + 1)} 条`
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`${at} 不是对象（应为 \`{path, kind, min_bytes, desc}\`）`)
      continue
    }
    const e = entry as Record<string, unknown>
    const path = typeof e['path'] === 'string' ? e['path'] : (typeof e['file'] === 'string' ? e['file'] : '')
    if (path === '') {
      problems.push(`${at} 缺 \`path\`（声明的交付物在哪）`)
      continue
    }
    // 目录型声明：判"目录下有产物"而不是"这个路径是个文件"
    if (path.endsWith('/') || !/\.[A-Za-z0-9]+$/.test(path)) {
      const kids = [...input.files.keys()].filter(k => k.startsWith(path.endsWith('/') ? path : `${path}/`))
      if (kids.length === 0) problems.push(`${path} 声明为目录，但目录下没有任何产物`)
      else present += 1
      continue
    }
    const size = input.sizes?.get(path)
      ?? (input.files.has(path) ? Buffer.byteLength(input.files.get(path) ?? '', 'utf8') : null)
    if (size === null) {
      const base = path.split('/').pop() ?? path
      const stem = base.replace(/\.[A-Za-z0-9]+$/, '')
      // **`.py` 是源码交付物，不是运行期产物** —— 磁盘上没有就是没有交付。
      // 实测（2024B）：`code/data_check.py` 被声明、`main.py` 里也 `import` 了它，
      // 但**没有任何分片产出这个文件**，阶段 4 真跑代码必然 ModuleNotFoundError。
      // 旧判据用"文件名/词干在代码里出现过"就放行，于是把它当成了"运行期产物"
      // ——**假通过**：那一个词干来自 `data_check.json`（另一个东西）。
      // 源码文件只认"在磁盘上"，运行期产物才认"代码里会写出它"。
      if (/\.py$/i.test(path)) {
        problems.push(`${path}：声明为**源码**交付物，但磁盘上没有 —— `
          + '源码不可能"等运行时再生成"，这就是没交付（运行时必然 ModuleNotFoundError）')
      } else if (codeText.includes(base) || (stem !== '' && codeText.includes(stem))) {
        runtime.push(path)
      } else {
        problems.push(`${path}：既不在磁盘上、代码里也没有任何地方写出它 —— `
          + '声明的交付物**没人产出**（要么让代码真的写出它，要么把它从清单里去掉）')
      }
      continue
    }
    present += 1
    if (size === 0) {
      problems.push(`${path} 存在但是**空的**`)
      continue
    }
    const min = e['min_bytes']
    if (typeof min === 'number' && min > 0 && size < min) {
      problems.push(`${path} 只有 ${String(size)} 字节 < 自己声明的 \`min_bytes\` ${String(min)}`)
    }
  }
  if (problems.length > 0) {
    return fail(id, `${String(problems.length)} 条声明与磁盘不一致 —— ` + problems.slice(0, 4).join('；')
      + '。清单是"我交付了什么"的对外声明，它必须与磁盘一致；'
      + '运行期产物（阶段 4 真跑代码才生成的 JSON）可以不在磁盘上，但**代码里必须真的写出它**。')
  }
  const runtimeNote = runtime.length === 0 ? ''
    : `；其中 ${String(runtime.length)} 条是运行期产物（阶段 4 真跑后才有，代码里会写出：`
      + `${runtime.slice(0, 3).join('、')}${runtime.length > 3 ? '…' : ''}）`
  return ok(id, `声明的 ${String(list.length)} 条交付物：${String(present)} 条在磁盘上且非空、`
    + '满足各自的 `min_bytes`' + runtimeNote)
}

/**
 * **建模阶段的结构自检**（参考的 9 项自检里**可机械化的那几项**）。
 *
 * 参考把这 9 项自检写成了人工清单，其中"问题递进性检查"被它自己标注为最关键、
 * 且明确是人工项——那一项**机械判不了**，本门禁如实不判（写进 detail，不假装判过）。
 * 其余几项都能落在 `DECLARATION.json` 的**结构**上，而且判据全是"有没有、空不空"，
 * 没有语义猜测，所以零误报面：
 * - 符号表 / 公式 / 约束清单非空（空 = 这一块根本没做）；
 * - 每个 `ModelSpec` 有非空的 `objective`（没有目标 = 不是模型，是一段散文）；
 * - **逐问覆盖**：题面有几问，就要有几条 `ModelSpec` 认领它们
 *   （缺一问意味着那一问没建模，而报告照样能写得很长）；
 * - `result_constraints` 的**形态**：必须是 lambda 或含比较运算符的表达式
 *   （模糊自然语言不算机器可核的约束——契约明写"不许用模糊自然语言"）。
 */
const modelingSelfCheck: GateFn = (input) => {
  const id = 'modeling_self_check'
  const raw = input.files.get('DECLARATION.json') ?? null
  if (raw === null) return cannot(id, '本阶段没有 `DECLARATION.json` —— 没有可自检的声明')
  let declared: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return fail(id, '`DECLARATION.json` 不是 JSON 对象')
    declared = parsed as Record<string, unknown>
  } catch (error) {
    return fail(id, `\`DECLARATION.json\` 不是合法 JSON（${String(error).slice(0, 80)}）`
      + ' —— 声明文件是整个下游的机器契约，它必须能被解析')
  }
  const listOf = (key: string): ReadonlyArray<Record<string, unknown>> =>
    Array.isArray(declared[key]) ? (declared[key] as ReadonlyArray<Record<string, unknown>>).filter(
      (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
    ) : []
  // 键名宽容（判据是**结构完整**，不是命名习惯）：契约叫 `model_specs`，但实测夹具与
  // 部分模型会写 `models` / `specs`。只认一种会把"键名差异"变成"没有任何模型声明"的假硬失败。
  const firstList = (...keys: ReadonlyArray<string>): ReadonlyArray<Record<string, unknown>> => {
    for (const k of keys) { const v = listOf(k); if (v.length > 0) return v }
    return []
  }
  const problems: string[] = []
  if (listOf('symbols').length === 0) problems.push('符号表 `symbols` 是空的（没有可对照的符号定义）')
  if (listOf('equations').length === 0) problems.push('`equations` 是空的 —— 一条公式都没有')
  const specs = firstList('model_specs', 'models', 'specs')
  if (specs.length === 0) {
    problems.push('`model_specs` 是空的 —— 没有任何模型声明')
  } else {
    const noObjective = specs.filter((s) => {
      const o = s['objective']
      // 门槛取 4 个字符：中文里"最大化期望利润"只有 7 字，卡 8 会误伤；
      // 而空串 / "无" / "待定" 这类占位一律拦得住。
      return typeof o !== 'string' || o.trim().length < 4
    })
    if (noObjective.length > 0) {
      problems.push(`${String(noObjective.length)} 个 \`ModelSpec\` 的 \`objective\` 为空或过短 —— `
        + '没有目标函数/决策目标的不是模型，是一段散文')
    }
    // 逐问覆盖：只问题数已知时判（问数未知时无从判，`code_parity` 那边同一条纪律）
    if (input.problemCount > 0) {
      const refs = specs.flatMap((s) => {
        const r = s['problem_refs'] ?? s['problem_ref']
        return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : (typeof r === 'string' ? [r] : [])
      })
      const missing = Array.from({ length: input.problemCount }, (_, i) => i + 1).filter((n) => {
        // 三种常见写法都认（`R-Q1` / `Q1` / `P1`）——判据是**覆盖**，不是命名习惯。
        const re = new RegExp(`(?:^|[^A-Za-z0-9])(?:R-)?Q${String(n)}(?![0-9])|(?:^|[^A-Za-z0-9])P${String(n)}(?![0-9])`, 'i')
        return !refs.some(r => re.test(r))
      })
      if (missing.length > 0) {
        problems.push(`这 ${String(missing.length)} 问没有任何 \`ModelSpec\` 认领：`
          + `${missing.map(n => `第 ${String(n)} 问`).join('、')} —— 缺一问就是那一问没建模`)
      }
    }
  }
  const constraints: unknown = declared['result_constraints'] ?? declared['constraints']
  const constraintCount = Array.isArray(constraints) ? constraints.length : 0
  if (!Array.isArray(constraints) || constraints.length === 0) {
    problems.push('`result_constraints` 是空的 —— 约束没有机器可核的表达')
  } else {
    const vague = constraints.filter(c => typeof c !== 'string' || !/(lambda|<=|>=|==|!=|<|>)/.test(c))
    if (vague.length > 0) {
      problems.push(`${String(vague.length)} 条 \`result_constraints\` 既不是 lambda 也不含比较运算符`
        + ' —— 模糊自然语言不算机器可核的约束')
    }
  }
  // 机械判不了的那一项**如实说出来**，不假装判过。
  const note = '；⚠ "问题递进性检查"与"灵敏度计划"在报告散文里，机械判不了，未纳入本判据'
  if (problems.length > 0) {
    return fail(id, `${String(problems.length)} 项结构自检没过 —— ${problems.slice(0, 4).join('；')}${note}`)
  }
  return ok(id, `符号表 ${String(listOf('symbols').length)} 条、公式 ${String(listOf('equations').length)} 条、`
    + `模型 ${String(specs.length)} 个（都有 objective）、约束 ${String(constraintCount)} 条且形态可核`
    + `${input.problemCount > 0 ? '，逐问都有模型认领' : ''}${note}`)
}

/**
 * **能力项 ↔ 逐句表**（移植 `capability_check.py`）—— 阶段 1 的"漏列即漏核"闸。
 *
 * 参考的判据：`PROBLEM_ANALYSIS.md` 的逐句表里**每条"决策/目标/机制"句都必须被某个
 * 能力项的 `source_sentence` 认领**。为什么关键：能力清单是后面每一阶段的对照表，
 * 漏一条能力项 = 某一问根本没建模，而报告照样能写得很长。
 *
 * 逐句表的机器可读形态（实测 2024B 已经就是这个形态，22 行、四列）：
 * ```
 * | S06 | 请为企业设计检测次数尽可能少的抽样检测方案。 | 目标 | C-Q1-PLAN |
 * ```
 * 两处**零歧义**的缺陷判硬失败：
 * ① 一条"决策/目标/机制"句的认领列是空的（没人认领它）；
 * ② 认领列写的 id 在 `CAPABILITY_CHECKLIST.json` 里不存在（悬空引用）。
 *
 * 一处**有歧义**的只给警告：清单里有能力项没被任何句引用——它可能是合理派生的能力项
 * （题面没直说但确实要做），所以不判失败，只在结论里点名。
 */
const capabilityCheck: GateFn = (input) => {
  const id = 'capability_check'
  const analysis = input.files.get('PROBLEM_ANALYSIS.md') ?? input.upstream.get('PROBLEM_ANALYSIS.md') ?? null
  const checklistRaw = input.files.get('CAPABILITY_CHECKLIST.json')
    ?? input.upstream.get('CAPABILITY_CHECKLIST.json') ?? null
  if (analysis === null) return cannot(id, '没有 `PROBLEM_ANALYSIS.md` —— 没有逐句表可比对')
  if (checklistRaw === null) return cannot(id, '没有 `CAPABILITY_CHECKLIST.json` —— 没有能力清单可比对')
  const rows = [...analysis.matchAll(/^\|\s*(S\d+)\s*\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|\s*$/gm)].map(m => ({
    sentence: m[1] ?? '',
    text: (m[2] ?? '').trim(),
    kind: (m[3] ?? '').trim(),
    claim: (m[4] ?? '').trim(),
  }))
  if (rows.length === 0) {
    return cannot(id, '`PROBLEM_ANALYSIS.md` 里没有可解析的逐句表'
      + '（形态应为 `| S01 | 题面原句 | 类型 | 认领它的能力项 id |`）—— 没有对照表，无从逐条比对')
  }
  let capIds: ReadonlySet<string>
  try {
    const parsed: unknown = JSON.parse(checklistRaw)
    const list = (parsed as { capabilities?: unknown }).capabilities ?? (parsed as { items?: unknown }).items
    capIds = new Set((Array.isArray(list) ? list : [])
      .map(c => (typeof c === 'object' && c !== null ? (c as { id?: unknown }).id : undefined))
      .filter((x): x is string => typeof x === 'string' && x !== ''))
  } catch (error) {
    return fail(id, `\`CAPABILITY_CHECKLIST.json\` 不是合法 JSON（${String(error).slice(0, 60)}）`
      + ' —— 它是后面每一阶段的对照表，必须能被解析')
  }
  if (capIds.size === 0) return fail(id, '`CAPABILITY_CHECKLIST.json` 里一条能力项都没有')

  // ① "决策/目标/机制"句必须被认领（这是参考点名的三类——它们决定"要做成什么"）
  const mustClaim = rows.filter(r => /决策|目标|机制/.test(r.kind))
  const unclaimed = mustClaim.filter(r => r.claim === '' || r.claim === '-' || r.claim === '—')
  // ② 悬空引用：认领的 id 在清单里不存在
  const dangling = rows.filter((r) => {
    const ids = r.claim.match(/C-[A-Za-z0-9_-]+/g) ?? []
    return ids.length > 0 && ids.some(x => !capIds.has(x))
  })
  // ③ 清单里没被任何句引用的能力项（**警告级**：可能是合理派生的能力项）
  const referenced = new Set(rows.flatMap(r => r.claim.match(/C-[A-Za-z0-9_-]+/g) ?? []))
  const orphan = [...capIds].filter(c => !referenced.has(c))

  const problems: string[] = []
  if (unclaimed.length > 0) {
    problems.push(`${String(unclaimed.length)} 条"决策/目标/机制"句**没人认领**（认领列是空的）：`
      + `${unclaimed.slice(0, 4).map(r => `${r.sentence}「${r.text.slice(0, 24)}…」`).join('、')}`
      + ' —— 这类句子决定"要做成什么"，没人认领就是那一问没建模')
  }
  if (dangling.length > 0) {
    const bad = [...new Set(dangling.flatMap(r => (r.claim.match(/C-[A-Za-z0-9_-]+/g) ?? []).filter(x => !capIds.has(x))))]
    problems.push(`${String(bad.length)} 个**悬空引用**：逐句表里认领的 id 在能力清单里不存在`
      + `（${bad.slice(0, 6).join('、')}）—— 要么清单里补上这条能力项，要么改成真有的 id`)
  }
  const orphanNote = orphan.length === 0
    ? ''
    : `；⚠ ${String(orphan.length)} 条能力项没被任何句子引用（可能是合理派生的能力项，`
      + `请自行确认它们不是凭空加的）：${orphan.slice(0, 6).join('、')}`
  if (problems.length > 0) return fail(id, problems.join('；') + orphanNote)
  return ok(id, `逐句表 ${String(rows.length)} 条（其中"决策/目标/机制" ${String(mustClaim.length)} 条）`
    + `全部被能力项认领，认领 id 都在清单里（清单 ${String(capIds.size)} 条）${orphanNote}`)
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
  ['figure_manifest_count', figureManifestCount],
  ['capability_check', capabilityCheck],
  // 阶段 1 另有锚点契约（E1 的锚，保真门 B3/B4 依赖它）
  ['anchor_presence', anchorPresence],
  // ── 阶段 2 ────────────────────────────────────────────────────────────
  ['modeling_floor', i => byteFloor(i, 'modeling_floor', 'MODELING_REPORT.md', 1500)],
  // 零数字通道在建模阶段的落点（红队实测：阶段 2 手写结果数字，六处错三处）
  ['numbers_traced', numbersTraced],
  ['no_claimed_verification', noClaimedVerification],
  ['modeling_coverage', modelingCoverage],
  ['modeling_self_check', modelingSelfCheck],
  // ── 阶段 3 ────────────────────────────────────────────────────────────
  ['code_parity', codeParity],
  ['code_name_consistency', codeNameConsistency],
  ['ledger_keys_declared', ledgerKeysDeclared],
  // 三条**代码级静态扫描**（从参考逐条移植，2026-10 补：此前简报承诺了它们却不存在）
  ['claim_code_check', claimCodeCheck],
  ['data_ingest_check', dataIngestCheck],
  ['facts_audit', factsAudit],
  // 阶段 3 同样不许写没有出生证明的数字（此时还没有账本，所以只能写锚点）
  ['numbers_traced', numbersTraced],
  // 阶段 3 的数由 harness 铸出（runCodeAndMintResults）：账本存在、非空、
  // 每个值都是有限数——这是"数不由模型持有"的机械落点。
  ['result_sources_valid', (i) => {
    const id = 'result_sources_valid'
    const raw = i.files.get('RESULT_SOURCES.json') ?? null
    if (raw === null) return fail(id, 'RESULT_SOURCES.json 不存在 —— 模型必须声明每个数在哪个产物的哪个路径')
    try {
      const sources = parseResultSources(raw)
      const ids = sources.map(s2 => s2.result_id)
      const dupes = ids.filter((x, k) => ids.indexOf(x) !== k)
      if (dupes.length > 0) return fail(id, `重复的 result_id：${[...new Set(dupes)].join('、')}`)
      // **交叉核对：声明的 json_path 是否都在阶段 3 公布的键里**（只提示，不阻断）。
      //
      // 为什么降级成提示：**铸数（`afterModel`）先于门禁跑**，它已经拿真实产物
      // 逐条解析过每个 `json_path`，解析不到就整轮失败——**那才是权威判据**。
      // 门禁这里只能拿"阶段 3 公布的键"当代理，而那份清单是模型写的，
      // 漏登几个（实测 3 条 `meta.*`）就会把**已经被真实产物证明可取到**的声明判死。
      // 所以这里如实报出越界的键（提醒阶段 3 补全 `ledger_keys`），但放行。
      let strayNote = ''
      const declared = i.upstream.get('DELIVERABLES.json') ?? null
      if (declared !== null) {
        try {
          const keys = (JSON.parse(declared) as { ledger_keys?: unknown }).ledger_keys
          if (Array.isArray(keys) && keys.length > 0) {
            const known = new Set(keys
              .map(k => (k as { json_path?: unknown }).json_path)
              .filter((p): p is string => typeof p === 'string'))
            const stray = [...new Set(sources.map(s2 => s2.json_path).filter(p => !known.has(p)))]
            if (stray.length > 0) {
              strayNote = `；提示：${String(stray.length)} 个 json_path 不在阶段 3 公布的 ledger_keys 里`
                + `（${stray.slice(0, 3).join('、')}…）——铸数已按真实产物核对通过，`
                + '但阶段 3 的 `ledger_keys` 应补全（它是阶段 4 的取数依据）'
            }
          }
        } catch { /* 上游 DELIVERABLES.json 坏了由阶段 3 的门禁报，这里不重复报 */ }
      }
      return ok(id, `${String(sources.length)} 条数源声明，id 唯一、locator/json_path 齐备`
        + '，且每一条都经铸数按真实产物解析过' + strayNote)
    } catch (error) {
      return fail(id, String(error instanceof Error ? error.message : error).slice(0, 200))
    }
  }],
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
    const results = Array.isArray(parsed.results) ? parsed.results as ReadonlyArray<{ value?: unknown; kind?: unknown }> : null
    if (results === null || results.length === 0) return fail(id, 'results.json 的 results 是空的 —— 没有声明任何数')
    // **账目不止标量**：序列 / 矩阵 / 张量 / 记录 / 表 / 布尔都合法（阶段 3 的扫描表、样本、
    // 组合矩阵都靠它们承载）。这条门禁原来写死"每条 value 必须是有限数"，
    // 于是 12 条序列 + 5 条布尔被判成"17 条不是有限数"——**门禁没跟上铸数的放宽**。
    // 判据仍然严：形态不合法（含 NaN/Infinity/字符串/混合数组）一律拦。
    const bad = results.filter(r => numericShapeOf(r.value) === null)
    if (bad.length > 0) {
      return fail(id, `${String(bad.length)} 条账目的 value 既不是有限数，也不是合法的数值结构`
        + '（允许：标量 / 序列 / 矩阵 / 张量 / 记录 / 表 / 布尔；元素必须是有限数）——'
        + 'NaN 进图是静默失败')
    }
    const kinds: Record<string, number> = {}
    for (const r of results) {
      const k = typeof r.kind === 'string' ? r.kind : (numericShapeOf(r.value) ?? '?')
      kinds[k] = (kinds[k] ?? 0) + 1
    }
    return ok(id, `账本 ${String(results.length)} 条，全部来自真实执行；形态：`
      + Object.entries(kinds).map(([k, n]) => `${k} ${String(n)}`).join('、'))
  }],
  ['delivery_audit', deliveryAudit],
  ['leakage_audit', leakageAudit],
  ['no_render', noRender],
  // ── 阶段 4/5 ──────────────────────────────────────────────────────────
  ['figure_manifest_reconcile', figureManifestReconcile],
  // ── 作图阶段换成「模型写脚本」之后的门禁（规则照搬参考实现）──
  ['figure_plan_valid', figurePlanValid],
  ['figure_plan_budget', figurePlanBudget],
  ['figure_script_quality', figureScriptQuality],
  ['figure_script_traced', figureScriptTraced],
  ['figure_type_match', figureTypeMatch],
  // 风格门禁 —— `adaptation.ts` 里那条 `missing`（Python 绘图库的规范）的补齐项：
  // 规范本身早已在仓库里（语料 + 简报的禁令），缺的是**可核的判据**，这就是它。
  ['figure_completeness', figureCompleteness],
  ['figure_size_buckets', figureSizeBuckets],
  // 标注坐标必须落在坐标区内（阶段 6 的脚本已由执行体搬进本阶段目录，
  // 所以脚本级判据在这里也能拿到脚本——见 `figure-run.ts` 的"把阶段 5 的脚本搬进本阶段"）。
  ['figure_text_within_axes', figureTextWithinAxes],
  ['figure_diversity', figureDiversity],
  ['figure_style_rules', figureStyleRules],
  ['diagram_manifest_reconcile', diagramManifestReconcile],
  ['diagram_geometry', diagramGeometry],
  // ── 阶段 6 ────────────────────────────────────────────────────────────
  ['review_fatal_count', reviewFatalCount],
  // ── 阶段 7 ────────────────────────────────────────────────────────────
  ['paper_floor', i => byteFloor(i, 'paper_floor', 'paper/main.md', 5120)],
  // 论文里的每个数字必须能追到：题面给定值 / 声明的常数 / harness 铸出的结果（F2 的对账）
  ['numbers_traced', numbersTraced],
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
  ['paper_claim_check', paperClaimCheck],

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
  const items: Array<{ id: string; ok: boolean; detail: string; code?: 0 | 1 | 2 }> = []
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
