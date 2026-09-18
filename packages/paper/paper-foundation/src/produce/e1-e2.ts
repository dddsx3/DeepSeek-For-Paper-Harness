/**
 * W8.9-B — the E1/E2 receive layer.
 *
 * 事故（W8.8 实证，主矛盾的来源）：模型产出了**高质量的建模分析**（run#4
 * 的 603 tokens：单侧精确二项检验、序贯抽样停止边界、16 策略枚举、
 * 回收—重检—装配—调换状态递推、成本守恒与循环终止性检查、独立仿真核验、
 * 四项敏感性分析，并自述"F4 不适合作为主模型：问题1采用 F3，问题2—3采用
 * F2"——**与人工真值方向一致**），但 harness 要求 JSON 容器，于是判
 * `parse_failed`。**通过/失败信号测的是容器合规性，与建模质量无相关性。**
 *
 * 拆法（W8.9-B1）：
 *   E1（分析）：模型自由产出 prose/Markdown，**不施加容器要求**。
 *              这是 run#4 已证明其能做好的形态。
 *   E2（规范化）：**独立调用**，唯一职责是把 E1 的产出映射为
 *              ir-container-v1 声明。远窄于 E1（输入已给定、无需创作），
 *              故合规概率高；且无创作内容可丢，故**可做 DRIFT 引导重试**。
 *
 * 三条纪律（本模块是它们的落点）：
 *   - B2 零数字通道：E2 **不得引入任何数字**。数值仍只经
 *     `code` → `jsonPath` → `Result` → `Claim` 流动。E2 写的 code 里的
 *     数字是**算术**，不是结论；结论数字只能由 code 运行后读回。
 *   - B3 保真关系：正向——每个 AssumptionSpec/EquationSpec 必须锚定到 E1
 *     文本中的**具体 span（逐字）**；反向——E1 中被表述为"假设/假定"的
 *     每一条，**必须**在 IR 中有对应声明。**这是"识别优秀建模"的机械
 *     落点**：harness 判断不了推理好不好，但可要求形式化忠实于推理。
 *   - B4 逐问覆盖：E1 必须对每个 `REQUIRED_OUTPUT` 有对应推理段，且带
 *     **可机械识别的锚点**（`requirement_id`）。
 *
 * 锚点语法（E1 侧唯一的格式要求——它是"可被机械找到"，不是"必须是 JSON"）：
 *   `[[ASSUMPTION: <id>]]`  标记一条假设的起始
 *   `[[REQUIREMENT: <id>]]` 标记一段针对某要求的推理
 * 这两个标记是**行内可见的纯文本**，不改变 E1 的 prose 形态。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/e1-e2
 */

import { isIrId } from '../ir/schema.ts'
// W8.11-A1d: the reference-target list is DERIVED from the validator's own
// table, not restated here — a hand-written copy is how the teaching and the
// store come to disagree. `e2-guidance.ts` is a leaf (only `executor.ts`
// imports it), so this edge introduces no cycle.
import { declarableRefRules } from './e2-guidance.ts'

/** The E1 anchor markers. Exported so prompts, parser and tests share one source. */
export const E1_ASSUMPTION_MARKER = '[[ASSUMPTION:'
export const E1_REQUIREMENT_MARKER = '[[REQUIREMENT:'
export const E1_MARKER_CLOSE = ']]'

/**
 * W8.11-A1 — whether an E1 anchor id is a USABLE NAME.
 *
 * 事故（run-4 真实运行）：E1 把 `...` 当假设 id 写（`[[ASSUMPTION: ...]]`），
 * 反向检查于是报"E1 标记了但 IR 未声明的假设：..."——**读者无法分辨这是模型
 * 漏声明一条假设，还是一个占位符**。指令当时只说"别写字面量
 * `<your-short-id>`"，**从没说过"这个 id 会被下游逐字引用，所以它必须是一个
 * 名字"**。
 *
 * 两条判据，**方向都是"不得比 IR 更严"**：
 *
 *   ① `isIrId` —— 直接复用 IR 自己的标识符规则（`ir/schema.ts`，单一真相源）。
 *      **关键**：IR 的策略是刻意宽松的（`problem-contract.ts` 写明"NFC deliberately
 *      does not fold compatibility equivalents … that is the same policy the IR
 *      already applies to object IDs"），**中文 id 是合法的 IR id**。若此处凭空
 *      发明一条"必须 ASCII"的规则，就会对 IR 本来接受的 id 制造**假红**——那正是
 *      本轮要消灭的形态。故不引入字符集收紧。
 *
 *   ② **至少含一个字母或数字** —— 这是针对实测缺陷的**最窄**规则：`...` 全部是
 *      标点，它**没有命名任何东西**；而 `A-EXACT-TEST`、`假设1`、`A_BATCH_2`
 *      都通过。占位符与名字的区别就在于此，与字符集无关。
 *
 * @param id - the anchor id as parsed from E1.
 */
export function isUsableAnchorId(id: string): boolean {
  if (!isIrId(id)) return false
  return /[\p{L}\p{N}]/u.test(id)
}

/**
 * E1 — the free-analysis instruction.
 *
 * 与 `EXECUTE_PROTOCOL_TEACHING` 的关键差别：**它不提 JSON、不提容器、
 * 不提 schema**。禁项（W8.9-B1）：不得用"加强协议教学"逼 E1 产 JSON——
 * 掰弯模型会一并丢掉其优质内容（run#4 的证据）。
 *
 * W8.9-B1 修复（首次真实运行发现）：**requirement id 必须显式给出**。首版
 * 只给了标记语法、没给 id 清单，模型照抄了字面占位符 `[[ASSUMPTION:
 * <short-id>]]`——于是 B4 必然失败，而失败原因不是模型能力，是 prompt 缺
 * 信息。故本指令是一个**函数**：id 清单来自 harness 已注册的
 * `RequirementSpec`，不靠模型猜。
 *
 * @param requiredOutputIds - the requirement ids the harness registered.
 */
export function e1AnalysisInstruction(requiredOutputIds: ReadonlyArray<string>): string {
  const idLines = requiredOutputIds.length === 0
    ? ['The harness registered no requirement ids for this problem; mark the reasoning sections with your own short ids instead.']
    : [
      'The harness registered these requirement ids — use them VERBATIM as the anchor ids, one [[REQUIREMENT: ...]] per id:',
      ...requiredOutputIds.map(id => `  - ${id}`),
    ]
  return [
    'Write a modeling analysis in prose (Markdown is fine). This is a working note to yourself — think on paper about how to solve the problem.',
    'Cover, for EVERY sub-question the problem asks: what the question is really asking, which method family fits and why, what the model is, what assumptions you must make, and how you would check the answer.',
    '',
    ...idLines,
    '',
    'Mark each assumption with an inline anchor on its own line: [[ASSUMPTION: <your-short-id>]] followed by the assumption sentence.',
    '  Replace <your-short-id> with a real short id you choose. Do NOT write the literal text "<your-short-id>".',
    // W8.11-A1: the id must be a NAME, and the reason has to be stated.
    // 只说禁令不给理由，模型会换一种方式违反——实测就是这样：它躲开了
    // `<your-short-id>`，改写成 `...`。理由是真实的：这个 id 会被下一步
    // 逐字抄进结构化记录，并被那份记录引用。
    '  The id is a NAME that the next step copies VERBATIM into structured records and then references. So it must be a name that can be referenced: use letters, digits, "-" or "_", with no spaces.',
    '  Good: [[ASSUMPTION: A-EXACT-TEST]] · [[ASSUMPTION: A_BATCH_2]]. Bad: [[ASSUMPTION: ...]] (a placeholder names nothing and cannot be referenced), [[ASSUMPTION: A B]] (contains a space).',
    '  Use the same short-id if you restate the same assumption.',
    'Mark the start of each sub-question\'s reasoning with an inline anchor: [[REQUIREMENT: <id>]], using the requirement ids listed above exactly.',
    'Be concrete about method choices and their justification. Where you must assume something the problem does not give, say so explicitly and mark it.',
    'Do NOT output JSON. Do NOT output a container. Do NOT try to match any schema — that is the next step\'s job.',
  ].join('\n')
}

/** One anchor found in E1 text. */
export interface E1Anchor {
  readonly id: string
  /** Character offset of the marker in the E1 text. */
  readonly at: number
}

/** What E1 declared, in the order it declared it. */
export interface E1Anchors {
  readonly assumptions: ReadonlyArray<E1Anchor>
  readonly requirements: ReadonlyArray<E1Anchor>
}

/**
 * Parse the anchors out of an E1 analysis. Pure; never throws.
 *
 * A marker with no id (`[[ASSUMPTION: ]]`) is ignored rather than treated
 * as an empty id — an empty anchor cannot be checked against anything, and
 * inventing one would manufacture a phantom declaration.
 *
 * W8.11-A1b — only a **LINE-START** marker is a declaration.
 *
 * 事故（run-1 真实运行，A1 落地后的第一次运行）：E1 在正文里**引用**了这个
 * 语法——"这三处都在上文以 `[[ASSUMPTION: ...]]` 标注。"——而解析器用
 * `indexOf` 扫全文，于是把这句**散文里的引用**当成了一条假设声明，B5 报
 * 「...」不是可用名字。E1 其实写对了：它的 16 条真锚点**全部行首**。
 *
 * 契约早就写在指令里（`e1AnalysisInstruction`："Mark each assumption with an
 * inline anchor **on its own line**"），而真实产出**100% 遵守**。解析器却比
 * 契约更宽——宽出来的部分正是这个假阳性。收窄到契约本身：
 * **行首（允许前导空白）的标记才是声明**，行内的标记是散文。
 *
 * 这不放松判定：行首的锚点仍然逐条被 B3/B5 检查，一条都不少。
 *
 * @param e1Text - E1's full analysis.
 */
export function parseE1Anchors(e1Text: string): E1Anchors {
  const collect = (marker: string): ReadonlyArray<E1Anchor> => {
    const out: E1Anchor[] = []
    let from = 0
    for (;;) {
      const start = e1Text.indexOf(marker, from)
      if (start === -1) break
      const idStart = start + marker.length
      const close = e1Text.indexOf(E1_MARKER_CLOSE, idStart)
      if (close === -1) break
      const id = e1Text.slice(idStart, close).trim()
      from = close + E1_MARKER_CLOSE.length
      if (id.length === 0) continue
      // Only line-start markers declare. A marker mid-line is prose that
      // mentions the syntax (the run-1 shape).
      if (!isLineStartMarker(e1Text, start)) continue
      out.push({ id, at: start })
    }
    return out
  }
  return { assumptions: collect(E1_ASSUMPTION_MARKER), requirements: collect(E1_REQUIREMENT_MARKER) }
}

/**
 * Whether the marker at `at` begins its line (leading whitespace and an
 * optional Markdown list bullet allowed).
 *
 * 为什么允许列表符号：`- [[ASSUMPTION: X]]` 里标记前面只有**结构标记**，
 * 没有任何散文——它是 Markdown 的一条列表项，声明意图明确。反过来，
 * `…都以 [[ASSUMPTION: ...]] 标注。` 里标记前面是**正文**，那是引用语法。
 * 判据因此是"标记之前只有结构标记"，不是"字面上是行首"——前者既修掉假阳性，
 * 又不会把模型用列表写的真声明丢掉（丢真声明会削弱 B3 这条核心资产，
 * 红线 N18）。
 *
 * Exported so the tests can pin the contract without re-deriving it.
 *
 * @param text - the E1 analysis.
 * @param at - offset of the marker.
 */
export function isLineStartMarker(text: string, at: number): boolean {
  let i = at - 1
  // walk back over horizontal whitespace
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i -= 1
  if (i < 0) return true
  if (text[i] === '\n' || text[i] === '\r') return true
  // an optional Markdown list bullet immediately before the whitespace run
  const ch = text[i]
  if (ch === '-' || ch === '*' || ch === '+') {
    let j = i - 1
    while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j -= 1
    return j < 0 || text[j] === '\n' || text[j] === '\r'
  }
  return false
}

/**
 * E2 — the normalization instruction.
 *
 * **The only difference from the single-shot teaching**: the analysis is
 * GIVEN (E1's full text), so the task is mapping, not authoring. Plus the
 * fidelity obligation: every declared AssumptionSpec/EquationSpec must carry
 * the verbatim E1 sentence it came from (`e1_span`), which is what makes
 * W8.9-B3 mechanically checkable.
 *
 * @param e1Text - E1's FULL text (B1: "E2 的输入确为 E1 的全文").
 * @param containerTeaching - the schema lecture (same text the single-shot
 *        path uses, so the two paths can never drift apart).
 */
export function e2NormalizationPrompt(e1Text: string, containerTeaching: string): string {
  return [
    'You are NORMALIZING a modeling analysis into a machine-readable declaration. The analysis below was already written; your job is ONLY to map it into the required JSON shape.',
    'Do NOT re-derive, improve, or extend the analysis. Do NOT invent anything it does not say. If the analysis is silent on something the schema wants, use the schema\'s honest-unknown values (UNKNOWN / empty array) rather than inventing content.',
    'NUMBERS: introduce NO numbers of your own. The schema\'s zero-number channel is unchanged — values reach the paper only by running your `code` and reading the numbers back through jsonPath.',
    '',
    '--- BEGIN ANALYSIS (this is the source of truth for content) ---',
    e1Text,
    '--- END ANALYSIS ---',
    '',
    containerTeaching,
    // W8.10-D1 (repair, found by the first real run on the target model):
    // the per-field obligations are repeated LAST, immediately before the
    // model starts writing. In that run the model emitted all ten assumption
    // anchors correctly (the reverse and anchor-identity checks PASSED) but
    // omitted `e1_span` on every one — the requirement sat third in a
    // ~4k-character prompt whose bulk is the schema lecture, so by the time
    // it was writing entries it was no longer steering. The lecture stays
    // where it is; the checklist goes where the writing starts.
    '',
    '=== BEFORE YOU ANSWER — CHECK EACH OF THESE (the harness refuses the container if any is missing) ===',
    '  1. EVERY AssumptionSpec and EVERY EquationSpec carries "e1_span": a verbatim substring (>= 10 chars, exact, no ellipsis, no paraphrase) of the analysis above that states it.',
    '  2. Every assumption you declare has a matching [[ASSUMPTION: <id>]] anchor in the analysis, with the SAME id.',
    '  3. Every requirement id the harness listed has a [[REQUIREMENT: <id>]] anchor in the analysis.',
    '  4. No numbers of your own anywhere outside your `code`.',
    '  5. Do not re-declare any id the harness registered.',
    // W8.11-A1d (repair, found by the third real run): the reference TARGETS
    // were never stated, so the model put a SymbolSpec id (`S-P1`) into
    // `AssumptionSpec.sensitivity_refs` — a field that takes Result/DataArtifact.
    // The store then refused the whole container (`reference_kind_mismatch`)
    // AFTER the fidelity gate had passed, costing the run. Every reference
    // field's legal target is now listed, derived from `IR_REF_FIELDS` (the
    // same table the validator walks) rather than hand-written, so this list
    // cannot drift from what the store enforces.
    '  6. Every REFERENCE field must point at the kinds listed here — a reference to the wrong kind refuses the whole container:',
    ...declarableRefRules().map(r => `       ${r.kind}.${r.path} -> ${r.target}`),
  ].join('\n')
}

/** One fidelity finding. `rule` names the check; `ok:false` is the violation. */
export interface FidelityFinding {
  readonly rule: string
  readonly ok: boolean
  readonly detail: string
}

/** The container entry shape the fidelity checks read (subset of the producer's). */
export interface DeclaredEntry {
  readonly kind: string
  readonly value: Readonly<Record<string, unknown>>
}

/** Entries whose provenance must be anchored verbatim in E1 (B3 forward). */
const ANCHORED_KINDS: ReadonlySet<string> = new Set(['AssumptionSpec', 'EquationSpec'])

/** The minimum span length; shorter substrings match by accident. */
export const MIN_E1_SPAN_CHARS = 10

/**
 * W8.10-D3 — the typographic fold for the B3 forward anchor check.
 *
 * 事故（由目标模型上的真实运行抓出，探针 `probe-e1span-diagnosis.mts` 复现）：
 * 35 条受检条目里 **32 条原生精确命中**，剩下 3 条的 LCS 相似度是
 * 0.977 / 0.985 / 0.986，差异**全部**是排版层的——
 *   - 全角 vs 半角标点（`）` ↔ `)`）
 *   - 空白的折叠与插入（`附录（1）` ↔ `附录 (1)`）
 *   - 数学定界符（`$$…$$` ↔ `$…$`）
 * **没有一条是语义改写。** 而当时的判定是裸 `String.includes`，于是这三条被
 * 报成"疑似改写"——把 harness 的**比较器限制**归因给了模型（红线 N2 / 形态 2），
 * 与 W8.9 的 `finish_reason` 事故同源：判定条件写好了，被判定对象从未以需要
 * 的形态到达（形态 6）。
 *
 * 修法是让**比较**容忍排版差异，而不是降低判定标准：折叠只做"不改变任何
 * 字词"的三件事（全角→半角标点、删除空白、`$$`→`$`），折叠后**仍要求逐字
 * 子串命中**。
 *
 * **不设相似度阈值**：阈值会放过真改写（LCS 0.9 的改写照样是改写），而
 * "放过真改写"比"误报改写"危险得多——前者让凭空造的假设进入论文，后者只是
 * 让人多看一眼。负对照见 `tests/executor-e1e2.spec.ts`：把实词替换掉的真改写
 * 在折叠后仍必须 FAIL。
 */
const FULLWIDTH_TO_ASCII: Readonly<Record<string, string>> = {
  '\uFF08': '(', '\uFF09': ')', '\uFF0C': ',', '\uFF1A': ':', '\uFF1B': ';',
  '\uFF01': '!', '\uFF1F': '?', '\uFF0E': '.', '\uFF02': '"', '\uFF07': "'",
  '\uFF0D': '-', '\uFF5E': '~', '\u3001': ',', '\u3002': '.',
  '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
  '\u2014': '-', '\u2013': '-',
  '\uFF1D': '=', '\uFF0B': '+', '\uFF0A': '*', '\uFF0F': '/', '\uFF5C': '|',
  '\uFF3B': '[', '\uFF3D': ']', '\uFF5B': '{', '\uFF5D': '}',
  '\uFF1C': '<', '\uFF1E': '>', '\uFF05': '%', '\uFF06': '&', '\uFF20': '@',
  '\uFF03': '#', '\uFF04': '$', '\uFF3F': '_', '\uFF40': '`', '\uFF5F': '^',
}

/**
 * Fold a piece of text to its typography-insensitive form.
 *
 * Deliberately conservative: every step removes a *rendering* difference, never
 * a word. Exported so the negative control can apply the same fold to a real
 * rewrite and confirm it still fails.
 *
 * @param text - any text (E1 or a declared span).
 */
export function foldForAnchorMatch(text: string): string {
  let out = ''
  for (const ch of text) out += FULLWIDTH_TO_ASCII[ch] ?? ch
  // Display math and inline math are the same content in two delimiters.
  out = out.replace(/\$\$/g, '$')
  // Whitespace is a rendering difference: the model may re-wrap a sentence it
  // copied. Removing it is what lets `附录（1）` match `附录 (1)`.
  return out.replace(/\s+/g, '')
}

/**
 * W8.10-D5 — quantify WHY a span failed the anchor check.
 *
 * 事故（run-4 真实运行）：三次尝试的正向失败集**完全一致**且恒含
 * `A-P1-CHOICE`，报的是"疑似改写"——但 E1 全文与容器**都没有落盘**，于是
 * 这个判定**事后无法核验**：它到底是模型改写，还是 harness 又一处机械不匹配，
 * 谁也无法回答。这正是本项目第 4/6 类形态（量具失效 / 判定侧写了传递侧没写）
 * 的复发，也是 D3 那次修复**没能一次到位**的原因——D3 修了排版差异，但
 * 判定仍然只输出一个二值结论，没有留下"差在哪"的证据。
 *
 * 这条诊断把**相似度与首个分歧点**写进 finding，于是审计轨迹（已落盘的那
 * 400 字符）自带证据：读者不必重跑，就能分辨"几乎相同（排版/单字符）"与
 * "真的重写了"。
 *
 * 它**不改变判定**——只让判定可核验。相似度不参与通过/失败。
 *
 * @param span - the declared span that failed.
 * @param e1Text - E1's full analysis.
 */
export function diagnoseSpanMismatch(span: string, e1Text: string): string {
  const a = foldForAnchorMatch(span)
  const b = foldForAnchorMatch(e1Text)
  if (a.length === 0) return '空 span'
  // Find the best-matching WINDOW of E1 by sliding the span across it.
  //
  // Anchoring matters: an earlier version sampled start offsets on a stride and
  // compared position-by-position, which scored the KNOWN near-misses (they
  // differ only in full-width punctuation) at 12-17% — the sampling missed the
  // true alignment entirely. The measurement has to be a real search, not a
  // stride scan, or it reports "unrelated" for pairs that are 98% identical.
  //
  // Cost: O(|E1| x |span|) worst case. The folded E1 is ~10^4 and spans are
  // ~10^2, so a linear scan with an early-exit on a perfect prefix is fast
  // enough, and this runs only on FAILING spans (normally zero or a handful).
  const width = a.length
  let best = 0
  let bestAt = 0
  for (let i = 0; i + width <= b.length; i += 1) {
    // Cheap reject: if the first character does not match, the window cannot
    // beat a candidate that already matched a prefix. This is what keeps the
    // scan from being |E1| x |span| in practice.
    if (b[i] !== a[0] && best > 0) continue
    let hit = 0
    for (let j = 0; j < width; j += 1) if (b[i + j] === a[j]) hit += 1
    if (hit > best) { best = hit; bestAt = i; if (best === width) break }
  }
  const ratio = best / width
  // First divergence against the best window — the character a reader needs.
  let firstDiff = -1
  for (let j = 0; j < width; j += 1) {
    if (b[bestAt + j] !== a[j]) { firstDiff = j; break }
  }
  const tail = b.slice(bestAt, bestAt + width)
  const at = firstDiff < 0 ? width : firstDiff
  const spanAround = a.slice(Math.max(0, at - 8), at + 8)
  const e1Around = tail.slice(Math.max(0, at - 8), at + 8)
  return [
    `相似度 ${(ratio * 100).toFixed(1)}%`,
    firstDiff < 0 ? '（无分歧点：应为匹配）' : `首分歧 @${firstDiff}`,
    `span「${spanAround}」vs E1「${e1Around}」`,
  ].join('，')
}

/**
 * W8.9-B3/B4 — the two-way fidelity check between E1 (analysis) and the
 * E2-declared entries.
 *
 * Forward (B3): every AssumptionSpec/EquationSpec carries `e1_span`, and that
 *   span appears VERBATIM in E1.
 * Reverse (B3): every `[[ASSUMPTION: id]]` anchor in E1 has a corresponding
 *   AssumptionSpec whose id is the anchor's id.
 * Coverage (B4): every REQUIRED_OUTPUT's requirement_id appears as a
 *   `[[REQUIREMENT: id]]` anchor in E1.
 *
 * @param input - E1 text, the declared entries, and the required-output ids.
 * @returns findings; empty array means fully faithful.
 */
export function checkE1E2Fidelity(input: {
  readonly e1Text: string
  readonly entries: ReadonlyArray<DeclaredEntry>
  readonly requiredOutputIds: ReadonlyArray<string>
}): ReadonlyArray<FidelityFinding> {
  const findings: FidelityFinding[] = []
  const anchors = parseE1Anchors(input.e1Text)

  // --- B4: per-requirement reasoning coverage ---------------------------
  const anchoredRequirements = new Set(anchors.requirements.map(a => a.id))
  const missing = input.requiredOutputIds.filter(id => !anchoredRequirements.has(id))
  findings.push({
    rule: 'B4 逐问推理覆盖',
    ok: missing.length === 0,
    detail: missing.length === 0
      ? `全部 ${input.requiredOutputIds.length} 个 REQUIRED_OUTPUT 在 E1 中有推理锚点`
      : `E1 缺少 ${missing.length} 个要求的推理段：${missing.join('、')}`,
  })

  // --- B5: every anchor id is a usable name (W8.11-A1) -------------------
  //
  // W8.11-A1：这一条把"占位符冒充锚点"从**误导性的反向失败**里分离出来。
  // 事故形态（run-4）：E1 写了 `[[ASSUMPTION: ...]]`，反向检查于是报
  // "E1 标记了但 IR 未声明的假设：..."——读者无法分辨它是"漏声明一条假设"
  // 还是"写了个占位符"。两件事的修法完全不同（前者要 E2 补声明，后者只能
  // 由 E1 改写法），而当时的文案把两者说成同一件事。
  //
  // 它是 **E1 侧**缺陷（与 B4 同类）：E2 无法把一个占位符变成一条真假设。
  // 故执行器把它排除在回灌之外（见 `executor.ts` 的 `e2Fixable`）。
  const malformedAnchors = [...anchors.assumptions, ...anchors.requirements].filter(a => !isUsableAnchorId(a.id))
  findings.push({
    rule: 'B5 锚点 id 形态（E1 侧）',
    ok: malformedAnchors.length === 0,
    detail: malformedAnchors.length === 0
      ? `全部 ${anchors.assumptions.length + anchors.requirements.length} 个锚点 id 都是可用名字`
      : `以下锚点 id 不是可用名字（占位符或含空格，下游无法逐字引用）：${malformedAnchors.map(a => `「${a.id}」`).join('、')}`,
  })

  // --- B3 reverse: every E1 assumption anchor is declared ----------------
  //
  // W8.11-A1: 只比较**可用名字**的锚点。占位符不是"一条被标记的假设"，拿它
  // 去和 AssumptionSpec 比大小是范畴错误——它由 B5 单独报告。这不放松检查：
  // 真正被命名的假设仍然必须被声明，一条都不少。
  const usableAssumptions = anchors.assumptions.filter(a => isUsableAnchorId(a.id))
  const declaredAssumptionIds = new Set(
    input.entries.filter(e => e.kind === 'AssumptionSpec').map(e => String(e.value['assumption_id'] ?? '')),
  )
  const undeclared = usableAssumptions.filter(a => !declaredAssumptionIds.has(a.id))
  findings.push({
    rule: 'B3 反向（E1 假设须被声明）',
    ok: undeclared.length === 0,
    detail: undeclared.length === 0
      ? `E1 的 ${usableAssumptions.length} 条假设锚点均有对应 AssumptionSpec`
      : `E1 标记了但 IR 未声明的假设：${undeclared.map(a => a.id).join('、')}`,
  })

  // --- B3 anchor identity: every declared assumption IS anchored in E1 ----
  //
  // 为什么需要这条（本支线自查发现的缺口）：只查"声明有 e1_span 且 span
  // 逐字存在"是不够的——E2 可以**凭空造一条假设，再把 E1 里另一条假设的
  // 句子拿来当自己的 span**。那样的声明在两个已有检查下**都会通过**：正向
  // 看到的是真实存在的逐字 span，反向看到的是 E1 的锚点都被声明了。
  // 这条检查把"声明 ↔ 锚点"按 **id** 对上，才是 H6 说的"凭空造假设"的
  // 机械落点。
  const anchoredAssumptionIds = new Set(anchors.assumptions.map(a => a.id))
  const unanchored = [...declaredAssumptionIds].filter(id => id.length > 0 && !anchoredAssumptionIds.has(id))
  findings.push({
    rule: 'B3 锚点同一性（声明须在 E1 中有同名锚点）',
    ok: unanchored.length === 0,
    detail: unanchored.length === 0
      ? `${declaredAssumptionIds.size} 条假设声明在 E1 中均有同名锚点`
      : `IR 声明了但 E1 从未标记的假设：${unanchored.join('、')}`,
  })

  // --- B3 forward: every anchored kind carries a verbatim E1 span --------
  const anchoredEntries = input.entries.filter(e => ANCHORED_KINDS.has(e.kind))
  const problems: string[] = []
  // Fold E1 once; the per-entry fold is cheap but E1 is the long side.
  const foldedE1 = foldForAnchorMatch(input.e1Text)
  for (const entry of anchoredEntries) {
    const id = String(entry.value[entry.kind === 'AssumptionSpec' ? 'assumption_id' : 'equation_id'] ?? '?')
    const span = entry.value['e1_span']
    if (typeof span !== 'string' || span.trim().length === 0) {
      problems.push(`${id}: 未声明 e1_span`)
      continue
    }
    if (span.trim().length < MIN_E1_SPAN_CHARS) {
      problems.push(`${id}: e1_span 过短（${span.trim().length} < ${MIN_E1_SPAN_CHARS}）`)
      continue
    }
    // W8.10-D3: exact first (the common case), then the typographic fold.
    // The message distinguishes the two so the audit trail says which one
    // happened — a folded match is still a match, but it is NOT the same
    // evidence as a byte-identical copy, and a reader must be able to tell.
    if (input.e1Text.includes(span.trim())) continue
    if (foldedE1.includes(foldForAnchorMatch(span))) continue
    // W8.10-D5: the verdict carries its own evidence, so the audit trail
    // (which truncates to 400 chars) is enough to tell a near-match from a
    // real rewrite WITHOUT re-running the model.
    problems.push(`${id}: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔${diagnoseSpanMismatch(span, input.e1Text)}〕`)
  }
  findings.push({
    rule: 'B3 正向（声明须逐字锚定 E1）',
    ok: problems.length === 0,
    detail: problems.length === 0
      ? `${anchoredEntries.length} 条 Assumption/Equation 声明全部逐字锚定 E1`
      : problems.join('；'),
  })

  return findings
}

/** Whether every fidelity finding passed. */
export function fidelityOk(findings: ReadonlyArray<FidelityFinding>): boolean {
  return findings.every(f => f.ok)
}
