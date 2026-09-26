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
 * 日期/随机种子放行（6 位 YYYYMM，如 `202409`）。
 *
 * 实测假阳性：正文声明"随机种子 202409"，被当成无出生证明的数字报错——而它是
 * **模型自己声明的常数**（只是声明在散文里，不在 `DECLARATION.json` 里，白名单读不到）。
 * 边界同 YEAR：恰好落在这个区间的 6 位计算结果会被漏掉（罕见）。
 */
function looksLikeDateSeed(numeric: number): boolean {
  if (!Number.isInteger(numeric) || numeric < 190_001 || numeric > 210_012) return false
  const month = numeric % 100
  return month >= 1 && month <= 12
}

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
    // **章节编号**：行首（含 markdown 标记前缀 `#`/`**`/`-`/`>`）的 `4.1` / `4.1.2`，
    // 以及 `§4.1` / `第 4.1 节`。这类点分数字是**编号**不是数值——实测它是本门禁
    // 最大的假阳性来源（一份报告里 1.1/4.2/5.3 这样的章节号有几十处）。
    // 第一版只认 `#` 前缀，漏了加粗小节标题 `**6.1 序贯概率比检验不作主方案。**`。
    .replace(/(^|\n)([#>\-*+\s]*)\d+(?:\.\d+)+(?=\s|$)/g, '$1$2')
    .replace(/(?:§|第)\s*\d+(?:\.\d+)+(?=\s*节|\s*章|\s|$)/g, ' ')
    // `5.3 节` / `4.2 章` 这类**无前缀**的章节引用（实测假阳性：正文写"第 4.2 节与 5.3 节"）
    .replace(/\d+(?:\.\d+)+(?=\s*[节章])/g, ' ')
    // **正文里的章节引用**（实测假阳性："理由见 4.1 末"、"4.3 论证"、"见 4.4 末"）。
    // 判据是**引用语境**而不是"点分数字一律放行"——后者会把 12.50 这类真结果也放掉。
    .replace(/(?:见|参见|理由见|按|如|依|据)\s*\d+(?:\.\d+)+/g, ' ')
    .replace(/\d+(?:\.\d+)+(?=\s*(?:末|论证|小节|节末|所述|的说明))/g, ' ')
    // **行内章节引用**（实测："对应 5.1 的 OC 函数；对应 6.1…；对应 8.1…"）。
    // 判据有**判别力**，不是"点分数字一律放行"：
    //   ① 形态像章节号——**每个分量都 ≤ 30**（`5.1`/`6.1`/`8.1` 是，`12.50`/`21.68` 不是：
    //      它们的第二分量 50/68 > 30，所以红队点名的那批真错数字照样被抓）；
    //   ② 邻近有章节标记（前有 对应/在/于/由/见…，或后跟 的/里/中/节/章…）。
    // 两个条件同时成立才剥离——单个条件都会误伤真结果。
    .replace(/(?:对应|在|于|由|见|参见|第|§|与|和|及|至|、)\s*\d+(?:\.\d+)+/g, (m) => isSectionLikeDotted(m) ? ' ' : m)
    .replace(/\d+(?:\.\d+)+(?=\s*(?:的|里|中|节|章))/g, (m) => isSectionLikeDotted(m) ? ' ' : m)
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

/**
 * 这个（可能带上下文的）片段像不像**章节号**？
 *
 * 判据：取出其中的点分数字，**每个分量都 ≤ 30**。这是"章节号 vs 结果"的判别力所在——
 * `5.1`/`8.3` 是章节号，而 `12.50`/`21.68`/`15.88`（红队点名的真错数字）的第二分量
 * 都 > 30，因此不会被这条规则放走。
 *
 * @param fragment - 可能带前后缀的片段（如 `对应 5.1`）。
 * @returns 像章节号则 true。
 */
function isSectionLikeDotted(fragment: string): boolean {
  const m = /\d+(?:\.\d+)+/.exec(fragment)
  if (m === null) return false
  return m[0].split('.').every(part => Number(part) <= STRUCTURAL_MAX)
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
    // **声明的集合长度**也算有出生证明。实测假阳性：正文写"本阶段登记但不赋值的结果
    // 锚点共 33 个"，而 `DECLARATION.json` 的 `result_anchors.registered` **正好 33 条**
    // ——这个数可从声明文件复核，它不是算出来的，是**数出来的**。
    // 只对能解析成 JSON 的来源做这件事；解析失败就跳过（来源坏了由别的门禁报）。
    try {
      const parsed: unknown = JSON.parse(source)
      for (const length of arrayLengthsOf(parsed)) out.add(normalizeLiteral(String(length)))
    } catch {
      /* 非 JSON 来源（如 .md）——跳过 */
    }
  }
  return out
}

/** 递归收集一个 JSON 值里**所有数组的长度**（每个长度都是一个可核的"数"）。 */
function arrayLengthsOf(value: unknown, depth = 0): ReadonlyArray<number> {
  if (depth > 12) return [] // 防深递归；声明文件的嵌套很浅
  if (Array.isArray(value)) {
    return [value.length, ...value.flatMap(v => arrayLengthsOf(v, depth + 1))]
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).flatMap(v => arrayLengthsOf(v, depth + 1))
  }
  return []
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
      // 日期/随机种子放行（`202409`）
      if (looksLikeDateSeed(numeric)) {
        allowedCount += 1
        continue
      }
      // `100%` 放行——"100% 准确/完整"是**完备性表述**不是计算结果。
      // 只放行后面紧跟 `%` 的 100，别的 100 仍然要出生证明。
      const after = line.slice((match.index ?? 0) + literal.length, (match.index ?? 0) + literal.length + 1)
      if (literal === '100' && after === '%') {
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
  // `通过` 在中文里是**歧义**的："全部通过"（passed）vs "均通过抽样检测得到"（via）。
  // 实测假阳性：正文写"所有次品的次品率均通过抽样检测方法得到"，被判成"声称已执行检验"。
  // 所以裸 `通过` 必须落在**小句末尾**才算"通过"；而"一致/闭合/满足/吻合/相等"无歧义，照旧。
  { pattern: /(?:全部|均|都|逐一|一一)\s*(?:一致|闭合|满足|吻合|相等)/, why: '"全部一致/满足"式的完成时结论' },
  { pattern: /(?:全部|均|都|逐一|一一)\s*通过(?=[。，、；：（）()\[\]「」\s]|$)/, why: '"全部通过"式的完成时结论' },
  { pattern: /(?:检验|验证|校核|核对|测试)\s*(?:通过|一致|合格|完成|无误)/, why: '把"检验"写成已完成的结论' },
  { pattern: /(?:容差|误差|偏差)\s*(?:为|=|≤|<|不超过)\s*[\d.]+\s*(?:时)?\s*(?:通过|一致|内)/, why: '带容差的"通过"结论' },
  // **`经检验` 是名词短语还是断言，取决于后面接什么**。本题的核心对象就是"被检过的零件"，
  // "经检验的零配件进入装配""经检验后合格品流转"都在**描述对象**，不是在说"我们验过了"。
  // 所以后接 的/后/前/时/中 时不算声明——这是第十一处误报的同一族（名词 vs 断言）。
  { pattern: /(?:已|经)\s*(?:验证|校核|检验|确认|核实)(?!的|后|前|时|中)/, why: '"已验证/已校核"式声明' },
  // **右侧必须是数值/表达式**才算"算得"的数值结论。实测假阳性：假设表的
  // `| ASM-011 | 全文核算单位为"每件交付用户的合格成品" |`——"核算单位"是名词，
  // 不是"我算出来了一个数"。原写法只看左边动词，于是把名词短语判成断言。
  { pattern: /(?:复算|核算|算得|求得|计算得|回代)[^，。；\n]{0,8}[为＝=]\s*(?=[-+\d.\\])/, why: '在无执行环境下"算得"的数值结论' },
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
  text.split('\n').forEach((rawLine, i) => {
    // **先剥掉元语言引号**：实测假阳性——正文写"绝不写「全部通过」"，那是**引用**
    // 被禁的措辞作为反例，不是断言。中文技术写作里「」『』`` 与成对引号承担元语言
    // 功能（提到某句话而非使用它），所以扫描前先去掉它们的内容。
    //
    // **ASCII 直引号也要剥**（第十三处误报）：模型解释这条纪律时写
    // `任何"已通过 / 已验证 / 全部一致"的完成时声明都比一个错数字更危险`——
    // 它是在**引用被禁的措辞**，而六个引号全是 U+0022，不在原来的剥离表里，
    // 于是「全部一致」被判成"声称已执行检验"。引号形式有四种，漏一种就是一个假阳性源。
    const line = rawLine
      .replace(/「[^」\n]*」/g, ' ')
      .replace(/『[^』\n]*』/g, ' ')
      .replace(/`[^`\n]*`/g, ' ')
      .replace(/“[^”\n]*”/g, ' ')
      .replace(/"[^"\n]*"/g, ' ')
    for (const claim of VERIFICATION_CLAIMS) {
      const hit = claim.pattern.exec(line)
      if (hit === null) continue
      // **断言框架守卫**：命中点附近若有否定/引用/元语言标记，那是在**谈论**验证
      // 而不是**断言**验证。实测假阳性："把检验方案写成检验结论会给下游传递错误的
      // 已验证信号"——这句话本身在批评假验证，却被判成声称已验证。
      const from = Math.max(0, (hit.index ?? 0) - 14)
      const to = Math.min(line.length, (hit.index ?? 0) + hit[0].length + 8)
      const window = line.slice(from, to)
      if (/[不没未绝勿禁]|错误|假|若|如果|写成|写作|引|称|所谓|示例|反例|避免|防止|禁止/.test(window)) continue
      out.push({ line: i + 1, context: rawLine.trim().slice(0, 120), why: claim.why })
      return // 一行只报一次
    }
  })
  return out
}
