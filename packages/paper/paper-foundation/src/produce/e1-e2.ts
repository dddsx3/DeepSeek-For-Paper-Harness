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

/** The E1 anchor markers. Exported so prompts, parser and tests share one source. */
export const E1_ASSUMPTION_MARKER = '[[ASSUMPTION:'
export const E1_REQUIREMENT_MARKER = '[[REQUIREMENT:'
export const E1_MARKER_CLOSE = ']]'

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
    '  Replace <your-short-id> with a real short id you choose (for example A-EXACT-TEST). Do NOT write the literal text "<your-short-id>".',
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
      if (id.length > 0) out.push({ id, at: start })
      from = close + E1_MARKER_CLOSE.length
    }
    return out
  }
  return { assumptions: collect(E1_ASSUMPTION_MARKER), requirements: collect(E1_REQUIREMENT_MARKER) }
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

  // --- B3 reverse: every E1 assumption anchor is declared ----------------
  const declaredAssumptionIds = new Set(
    input.entries.filter(e => e.kind === 'AssumptionSpec').map(e => String(e.value['assumption_id'] ?? '')),
  )
  const undeclared = anchors.assumptions.filter(a => !declaredAssumptionIds.has(a.id))
  findings.push({
    rule: 'B3 反向（E1 假设须被声明）',
    ok: undeclared.length === 0,
    detail: undeclared.length === 0
      ? `E1 的 ${anchors.assumptions.length} 条假设锚点均有对应 AssumptionSpec`
      : `E1 标记了但 IR 未声明的假设：${undeclared.map(a => a.id).join('、')}`,
  })

  // --- B3 anchor identity: every declared assumption IS anchored in E1 ----
  //
  // 为什么需要这条（本支线自查发现的缺口）：只查"声明有 e1_span 且 span
  // 逐字存在"是不够的——E2 可以**凭空造一条假设，再把 E1 里另一条假设的
  // 句子拿来当自己的 span**。那样的声明在两个已有检查下都会通过：正向
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
    problems.push(`${id}: e1_span 在 E1 中找不到逐字匹配（疑似改写）`)
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
