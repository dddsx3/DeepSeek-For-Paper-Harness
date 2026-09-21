/**
 * W11.5 round-7 — 把 E1 拆成"每问一段"，并按参照物的形态装成"每问一章"。
 *
 * 参照物（`CUMCM/workspaces/5ba6e7bd5010/paper/main.md`）的骨架是
 * 「6 问题一：预热平衡阶段的常物性耦合场求解」「7 问题一模型的独立校核」
 * 「8 问题二：全变系数耦合模型与阶段划分」——**每个子问题独立成章**，而不是把所有
 * 问题挤进一章。E1 本来就按 `[[REQUIREMENT: R-Qn]]` 逐问写了推理段（教学要求，
 * 实测每次都有），所以这一形态由 harness 装配即可，不额外要求模型写东西。
 *
 * 从 `executor.ts` 抽出来，是因为 **E1 直通路径（`e1-direct.ts`）也要用同一套装配**，
 * 而两者互相 import 会成环。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/per-question
 */

const NL = String.fromCharCode(10)

/** One requirement as the assembler needs to see it. */
export interface QuestionRequirement {
  readonly requirementId: string
  readonly statement: string
}

/** Whether a requirement id names a sub-problem (`R-Q3`), not the whole paper (`R-OUT`). */
export function isQuestionId(requirementId: string): boolean {
  return /^R-Q\d+$/.test(requirementId)
}

/** The sub-problems among a run's requirements, in declaration order. */
export function questionRequirements(
  requirements: ReadonlyArray<QuestionRequirement>,
): ReadonlyArray<QuestionRequirement> {
  return requirements.filter(r => isQuestionId(r.requirementId))
}

/** The ordinal a question id carries: `R-Q3` → `3`. */
export function questionOrdinal(requirementId: string): string {
  return requirementId.replace('R-Q', '')
}

const CN_ORDINALS: Readonly<Record<string, string>> = {
  一: '1', 二: '2', 三: '3', 四: '4', 五: '5',
  六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
}

/** Normalize a captured ordinal (`1` or `一`) to its digit spelling. */
function ordinalDigits(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null
  if (/^\d+$/.test(raw)) return raw
  return CN_ORDINALS[raw] ?? null
}

/**
 * The sub-problem a line announces as a heading, or null.
 *
 * **判据必须严**（W11.5 round-7 抓到的真缺陷）：旧的写法是
 * `/^#{0,6}\s*问题\s*([0-9]+)/`，它把**正文句子**也当标题——`问题1的核心是常物性
 * 假设下的耦合场求解。` 一旦出现，整段正文就被当成"下一个标题"而**被整段吞掉**
 * （拆分结果为空，正文在交付里消失）。所以这里要求标题要么是 markdown 标题行，
 * 要么是**独立的一行**：序号后面只能是行尾、分隔符，或一段短标题——而不是句子。
 */
export function questionHeadingOf(line: string): string | null {
  const trimmed = line.trim()
  const markdown = /^#{1,6}\s*问题\s*(\d+|[一二三四五六七八九十]+)/.exec(trimmed)
  if (markdown !== null) {
    const digits = ordinalDigits(markdown[1])
    return digits === null ? null : `R-Q${digits}`
  }
  // 非 markdown 行：只有"整行就是标题"才认。句子会被排除掉（含句末标点，或过长）。
  if (/[。！？；]/.test(trimmed) || trimmed.length > 40) return null
  const plain = /^问题\s*(\d+|[一二三四五六七八九十]+)\s*(?:$|[:：、.．]|\s)/.exec(trimmed)
  if (plain === null) return null
  const digits = ordinalDigits(plain[1])
  return digits === null ? null : `R-Q${digits}`
}

/**
 * Strip the harness's own inline anchors from text that goes into the PAPER.
 *
 * `[[REQUIREMENT: R-Q1]]` / `[[ASSUMPTION: A1]]` are the harness's addressing
 * syntax — E1 is written FOR the gates, so it carries them. They must not reach
 * the deliverable: a competition paper does not print `[[REQUIREMENT: R-Q1]]`
 * (离线预检实测：框架段与逐问段都把锚点原样带进了正文). Stripping happens at the
 * render boundary only — the fidelity gates read E1 raw, never this text.
 */
export function stripHarnessAnchors(text: string): string {
  return text
    .replace(/\[\[(?:REQUIREMENT|ASSUMPTION|EVIDENCE|CLAIM|RESULT):[^\]]*\]\]/g, '')
    .replace(/\n{3,}/g, NL + NL)
    .trim()
}

/**
 * Split E1 into per-question passages.
 *
 * E1 marks each sub-problem's reasoning with a `[[REQUIREMENT: R-Qn]]` anchor (the
 * same anchors B4 reads), and otherwise separates questions with 问题 N headings.
 * Both spellings are accepted. Returns [] when E1 carries no usable structure, so
 * the caller keeps whatever it has rather than inventing prose.
 *
 * 同一问出现多次标题（E1 常见的"问题1：…"+"问题1 小结"）时**合并**而不是取第一段——
 * 否则后面的段落会静默丢失。
 */
export function perQuestionSectionsOf(
  e1Text: string,
  requirements: ReadonlyArray<QuestionRequirement>,
): ReadonlyArray<string> {
  const ids = questionRequirements(requirements).map(r => r.requirementId)
  if (ids.length === 0) return []
  const order: string[] = []
  const bodies = new Map<string, string[]>()
  let currentId: string | null = null
  let buffer: string[] = []
  const flush = (): void => {
    const body = stripHarnessAnchors(buffer.join(NL))
    if (currentId !== null && body !== '') {
      const parts = bodies.get(currentId)
      if (parts === undefined) {
        bodies.set(currentId, [body])
        order.push(currentId)
      } else {
        parts.push(body)
      }
    }
    buffer = []
  }
  for (const line of e1Text.split(NL)) {
    const anchor = /\[\[REQUIREMENT:\s*(R-Q\d+)\]\]/.exec(line)
    const hit = anchor?.[1] ?? questionHeadingOf(line)
    if (hit !== null && ids.includes(hit)) {
      flush()
      currentId = hit
      continue
    }
    if (currentId !== null) buffer.push(line)
  }
  flush()
  return order.map((id) => {
    const parts = bodies.get(id) ?? []
    return `### 问题${questionOrdinal(id)} 的分析${NL}${NL}${parts.join(NL + NL)}`
  })
}

/**
 * E1's framework text — everything before the first per-question boundary.
 *
 * This is the reference's 「5 <统一框架>」 chapter: the assumptions, notation and
 * method that hold for every question, written once.
 */
export function frameworkOf(e1Text: string): string {
  const lines = e1Text.split(NL)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/\[\[REQUIREMENT:\s*R-Q\d+\]\]/.test(line) || questionHeadingOf(line) !== null) {
      return stripHarnessAnchors(lines.slice(0, i).join(NL))
    }
  }
  return stripHarnessAnchors(e1Text)
}

/** A one-line gist of a requirement's statement, for use as a chapter title. */
export function chapterTitleOf(ordinal: string, statement: string): string {
  const flat = statement.replace(/\s+/g, ' ').replace(/^问题\s*\d+\s*[:：、.．]?\s*/, '').trim()
  const cut = flat.search(/[。；，：]/)
  const head = cut > 0 && cut <= 40 ? flat.slice(0, cut) : flat
  return `问题${ordinal}：${head.slice(0, 40)}`
}

/**
 * Assemble the per-problem chapters (reference form).
 *
 * @param e1Text - the model's analysis.
 * @param requirements - the run's REQUIRED_OUTPUTs (titles come from their statements).
 * @returns one chapter per sub-problem, in order, skipping any with no passage.
 */
export function perQuestionChaptersOf(
  e1Text: string,
  requirements: ReadonlyArray<QuestionRequirement>,
): ReadonlyArray<{ readonly title: string; readonly body: string }> {
  const questions = questionRequirements(requirements)
  if (questions.length === 0 || e1Text.trim() === '') return []
  const passages = perQuestionSectionsOf(e1Text, requirements)
  const out: Array<{ title: string; body: string }> = []
  for (const question of questions) {
    const ordinal = questionOrdinal(question.requirementId)
    const heading = `### 问题${ordinal} 的分析`
    const passage = passages.find(p => p.startsWith(heading)) ?? ''
    const body = passage === '' ? '' : passage.split(NL).slice(1).join(NL).trim()
    if (body === '') continue
    out.push({ title: chapterTitleOf(ordinal, question.statement), body })
  }
  return out
}
