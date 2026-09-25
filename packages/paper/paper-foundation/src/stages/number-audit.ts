/**
 * 数字出生证明审计 —— **每个数字要么是题面给的，要么是模型自己声明的；否则它没有出生证明**。
 *
 * ## 为什么需要它（红队实测的失败模式）
 *
 * 2024B 的阶段 2 在**没有任何代码执行**的情况下手写了最终数值结论：Q2 六种情况错三种
 * （情况 4：报 12.50，真值 15.88；情况 5：报 20.19，真值 16.94/最优 18.94；
 * 情况 6：报 12.50，真值 21.68），Q1 两情形的最小性论证也全错。这不是"模型不会建模"
 * ——它的方法与公式是对的，**错的只是算术**：模型在无执行环境下心算。
 *
 * 这正是本项目既有的**零数字通道**要防的东西，但那条通道只管交付物（阶段 9 的论文），
 * 没管建模阶段。于是"没有出生证明的数字"提前出现在了阶段 2 的正式产物里，并被下游当真。
 *
 * ## 判据（机械、可复算）
 *
 * 扫描文本里的数字面量，逐个要求它属于以下**白名单**之一：
 *
 * | 来源 | 例 | 为什么合法 |
 * |---|---|---|
 * | 题面给定值（`PROBLEM_FACTS.json`） | 10%、56 元、200 元 | 题面就是它的出生证明 |
 * | 模型自己声明的常数（`DECLARATION.json` 的表达式/约束） | Beta(12,100) 的 12 与 100 | 模型选择，属**声明**而非**计算结果** |
 * | 小整数（≤ 30） | 情况 6、表 2、`x_{ij}` 的 0/1 | 引用编号/计数/指数与结果无法区分 |
 *
 * 其余一律是**没有出生证明的数字**——在阶段 2，它们只可能来自心算，因为还没有代码。
 *
 * ## 诚实的边界（**不假装全覆盖**）
 *
 * - 小整数放行 → "n=110" 会被抓（>30），但 "c=17" 不会（≤30）。这是**已知的假阴性**，
 *   用假阴性换零误报：把引用编号当结果报错会让门禁失去可信度；
 * - 与错误代码一致的错数字抓不到（那需要执行代码对账，属阶段 8/9 的对账门禁）；
 * - 数字**含义**的正确性判不了（"这个 56 是售价还是成本"），本门禁只管**出生证明**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/number-audit
 */

/** 一处没有出生证明的数字。 */
export interface NumberViolation {
  readonly literal: string
  /** 1-based 行号（便于定位）。 */
  readonly line: number
  /** 该数字所在的整行（截断到 120 字符，供人工核对）。 */
  readonly context: string
}

/** 审计结论。 */
export interface NumberAudit {
  /** 扫描到的数字总数（去重后按出现计）。 */
  readonly scanned: number
  /** 命中白名单的数量。 */
  readonly allowed: number
  /** 没有出生证明的数字。 */
  readonly violations: ReadonlyArray<NumberViolation>
  /** 白名单规模（诊断用——空白名单说明上游没给可核的来源）。 */
  readonly allowlistSize: number
}

/** 小整数无条件放行（引用编号/计数/指数无法与结果区分）。 */
const STRUCTURAL_MAX = 30

/**
 * 年份放行（4 位整数，1400–2100）。
 *
 * 实测假阳性：参考文献里的 `1947` / `2011` / `1975` 被当成结果报错——而它们是**年份**。
 * 这是有意的边界：4 位数恰好落在年份区间的计算结果会被漏掉（罕见），
 * 用这个假阴性换"参考文献不误报"。
 */
const YEAR_MIN = 1400
const YEAR_MAX = 2100

/**
 * 数字面量：**必须带词边界**，避免把标识符里的数字当数字
 * （`EQ-01`、`fig_p1_x`、`ASM-12` 里的数字先由 `stripIdentifiers` 抹掉）。
 */
const NUMBER_LITERAL = /(?<![\w.])(\d+(?:\.\d+)?)(?![\w])/g

/**
 * 抹掉不该参与审计的内容：锚点、占位符、LaTeX 命令与下标、标识符。
 *
 * 判据是"这些位置里的数字不是**作者陈述的数值**"：`[[REQUIREMENT: R-Q2]]` 里的 2
 * 是编号，`x_{ij}` 里的 i/j 是索引，`\times` 是命令名的一部分。
 *
 * @param text - 原文。
 * @returns 可安全扫描数字的文本（长度不变的部分被替换为空格，**行号与上下文仍可定位**）。
 */
export function stripIdentifiers(text: string): string {
  return text
    // **章节编号**：行首（含 `### `）的 `4.1` / `4.1.2`，以及 `§4.1` / `第 4.1 节`。
    // 这类点分数字是**编号**不是数值——实测它是本门禁最大的假阳性来源
    // （一份报告里 1.1/4.2/5.3 这样的章节号有几十处）。
    .replace(/(^|\n)(#*\s*)\d+(?:\.\d+)+(?=\s|$)/g, '$1$2')
    .replace(/(?:§|第)\s*\d+(?:\.\d+)+(?=\s*节|\s*章|\s|$)/g, ' ')
    // `5.3 节` / `4.2 章` 这类**无前缀**的章节引用（实测假阳性：正文写"第 4.2 节与 5.3 节"）
    .replace(/\d+(?:\.\d+)+(?=\s*[节章])/g, ' ')
    // 行首锚点 `[[ASSUMPTION: A-X]]`。**必须点名锚点关键字**——否则 `[[` 会误吃
    // JSON 的二维数组（`[["1","10%"…]]`），实测踩到过：白名单因此丢掉整张表。
    .replace(/\[\[(?:ASSUMPTION|REQUIREMENT|DECISION):[^\]]*\]\]/g, ' ')
    // 结果占位符 `{R-Q2-case5-profit}` / `{<result_id>}`。
    // **必须排除含冒号的形态**：否则会把 JSON 里的每个对象整块剥掉——实测踩到过，
    // 后果是 `buildAllowlist` 从上游 JSON 里读不出任何数，白名单恒为空、
    // 门禁把题面给定值全部误报（"零误报面"直接崩掉）。
    .replace(/\{[^{}\n:]*\}/g, ' ')
    // LaTeX 命令名与上下标：`\tag{1}`、`x_{ij}`、`T_{K}`
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[_^]\{[^{}\n]*\}/g, ' ')
    // 标识符：`EQ-01`、`ASM-12`、`R-Q2`、`fig_p1_oc_curve`、`T1`、`S-N1`
    .replace(/\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b/g, ' ')
    .replace(/\b[A-Z]{2,}\d+\b/g, ' ')
}

/** 把一个字面量归一成可比较的键（`0.10` → `0.1`，`10%` 的 `10` 仍是 `10`）。 */
function normalizeLiteral(literal: string): string {
  const value = Number(literal)
  if (!Number.isFinite(value)) return literal
  // 去尾零：0.10 → 0.1；整数保持整数形式
  return String(value)
}

/**
 * 从若干上游文本构建白名单。
 *
 * @param sources - `PROBLEM_FACTS.json`、`DECLARATION.json`、`results.json` 的文本
 *   （缺失的传 `null`）。**每个来源都先剥标识符**——`EQ-01` 里的 01 不是数值。
 * @returns 归一化后的字面量集合。
 */
export function buildAllowlist(sources: ReadonlyArray<string | null>): ReadonlySet<string> {
  const out = new Set<string>()
  for (const source of sources) {
    if (source === null) continue
    const stripped = stripIdentifiers(source)
    for (const match of stripped.matchAll(NUMBER_LITERAL)) {
      const literal = match[1]
      if (literal === undefined) continue
      out.add(normalizeLiteral(literal))
      // 百分数 → 比例：题面写 "10%"，正文可能写 0.1（反之亦然）
      const value = Number(literal)
      if (Number.isFinite(value) && /%/.test(stripped.slice(match.index ?? 0, (match.index ?? 0) + literal.length + 1))) {
        out.add(normalizeLiteral(String(value / 100)))
      } else if (Number.isFinite(value) && value > 0 && value < 1) {
        out.add(normalizeLiteral(String(value * 100)))
      }
    }
  }
  return out
}

/**
 * 审计一段文本里的数字出生证明。
 *
 * @param text - 待审计的文本（如 `MODELING_REPORT.md`）。
 * @param allowed - 白名单（`buildAllowlist` 的产物）。
 * @returns 审计结论。
 */
export function auditNumbers(text: string, allowed: ReadonlySet<string>): NumberAudit {
  const stripped = stripIdentifiers(text)
  const lines = stripped.split('\n')
  const originalLines = text.split('\n')
  const violations: NumberViolation[] = []
  let scanned = 0
  let allowedCount = 0
  lines.forEach((line, i) => {
    for (const match of line.matchAll(NUMBER_LITERAL)) {
      const literal = match[1]
      if (literal === undefined) continue
      scanned += 1
      const key = normalizeLiteral(literal)
      const numeric = Number(literal)
      // 小整数（含 0）无条件放行——引用编号/计数/指数
      if (Number.isInteger(numeric) && Math.abs(numeric) <= STRUCTURAL_MAX) {
        allowedCount += 1
        continue
      }
      // 年份放行——参考文献里的年份不是结果（见 YEAR_MIN/YEAR_MAX 的边界说明）
      if (Number.isInteger(numeric) && numeric >= YEAR_MIN && numeric <= YEAR_MAX) {
        allowedCount += 1
        continue
      }
      if (allowed.has(key)) {
        allowedCount += 1
        continue
      }
      violations.push({
        literal,
        line: i + 1,
        context: (originalLines[i] ?? '').trim().slice(0, 120),
      })
    }
  })
  return { scanned, allowed: allowedCount, violations, allowlistSize: allowed.size }
}

/**
 * 声称"已执行检验"的措辞 —— 阶段 2 还没有代码，所以这类措辞必然是假的。
 *
 * 红队实测：阶段 2 的 §9 写"表 1 的六种情况与问题 3 的算例全部通过（容差 1e-6）"，
 * 而**这些检验一次都没跑过**（阶段 3 尚不存在代码）。这比单个错数字更危险——
 * 它给下游传递"已验证"的假信号。
 */
const VERIFICATION_CLAIMS: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  { pattern: /(?:全部|均|都|逐一|一一)\s*(?:通过|一致|闭合|满足|吻合|相等)/, why: '"全部通过/一致"式的完成时结论' },
  { pattern: /(?:检验|验证|校核|核对|测试)\s*(?:通过|一致|合格|完成|无误)/, why: '把"检验"写成已完成的结论' },
  { pattern: /(?:容差|误差|偏差)\s*(?:为|=|≤|<|不超过)\s*[\d.]+\s*(?:时)?\s*(?:通过|一致|内)/, why: '带容差的"通过"结论' },
  { pattern: /(?:已|经)\s*(?:验证|校核|检验|确认|核实)/, why: '"已验证/已校核"式声明' },
  { pattern: /(?:复算|核算|算得|求得|计算得|回代)[^，。；\n]{0,8}[为＝=]/, why: '在无执行环境下"算得"的数值结论' },
  { pattern: /(?:检验|验证|核算|复算)\s*结果[：:]/, why: '"检验结果：…"式的已完成结论' },
  // 英文（模型常在中文报告里混写英文小结）
  { pattern: /\b(?:all\s+)?(?:tests?|checks?|verification|assertions?)\s*[:\-—]?\s+(?:pass(?:ed)?|succeed(?:ed)?|ok|clean)\b/i, why: '英文的"检验通过"结论' },
  { pattern: /\b(?:verified|validated|confirmed)\b/i, why: '英文的"已验证"声明' },
]

/**
 * 从源码里抽出**注释行**。
 *
 * 为什么单独抽注释：代码本体合法地充满数字（`range(1, 11)`、`1e-6`、`figsize=(8,6)`），
 * 全量审计会满屏误报；而红队点名的风险恰恰在**注释**里——"把阶段 2 的 12.50 抄进
 * 代码注释里说'验证通过'"。所以对代码只审注释，不审代码本体。
 *
 * @param text - 源码文本。
 * @returns 逐行的注释文本（行数与原文一致，空串=该行无注释）。
 */
export function commentLines(text: string): ReadonlyArray<string> {
  return text.split('\n').map((line) => {
    const hash = line.indexOf('#')
    const slash = line.indexOf('//')
    const cut = hash === -1 ? slash : slash === -1 ? hash : Math.min(hash, slash)
    return cut === -1 ? '' : line.slice(cut)
  })
}

/**
 * 审计**一组文件**里的数字出生证明（逐个文件报告，缺一不可）。
 *
 * **只审 `.md` 散文**。两条理由都是实测换来的：
 * ① 声明类 JSON（`DECLARATION.json`）**本身就是白名单来源**——拿它审自己等于空转；
 * ② 契约类 JSON（`DELIVERABLES.json` 的 `min_bytes`、`_text_profile.json` 的字号）
 *    里的数字是**schema 常量**不是结果，审它会满屏误报（实测：`min_bytes: 500`
 *    被当成"无出生证明的数字"）。
 *
 * 而"手写的最终数值结论"恰恰都住在散文里（红队点名的 6 处全在 `MODELING_REPORT.md`
 * 的表格与段落里），所以这个范围既不漏也不误报。
 *
 * @param files - `文件名 → 文本`。
 * @param allowed - 白名单。
 * @returns 逐文件的审计结论（只含被审的 `.md` 文件）。
 */
export function auditFiles(
  files: ReadonlyMap<string, string>,
  allowed: ReadonlySet<string>,
): ReadonlyArray<{ readonly file: string; readonly audit: NumberAudit }> {
  const out: Array<{ file: string; audit: NumberAudit }> = []
  for (const [name, text] of files) {
    if (!/\.md$/i.test(name)) continue
    out.push({ file: name, audit: auditNumbers(text, allowed) })
  }
  return out
}

/** 一处可疑的"已执行"声明。 */
export interface VerificationClaim {
  readonly line: number
  readonly context: string
  readonly why: string
}

/**
 * 扫描"声称已执行检验"的措辞。
 *
 * @param text - 待扫描的文本。
 * @returns 命中清单（空 = 没有这类声明）。
 */
export function verificationClaims(text: string): ReadonlyArray<VerificationClaim> {
  const out: VerificationClaim[] = []
  text.split('\n').forEach((line, i) => {
    for (const claim of VERIFICATION_CLAIMS) {
      if (claim.pattern.test(line)) {
        out.push({ line: i + 1, context: line.trim().slice(0, 120), why: claim.why })
        return // 一行只报一次
      }
    }
  })
  return out
}
