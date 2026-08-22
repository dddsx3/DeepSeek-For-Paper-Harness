/**
 * Context budgeting: estimate a prompt and shrink it to fit the model's window
 * before a request is sent. Trimming follows a declared priority so the task
 * statement and the current instruction survive while bulky recoverable
 * material — prior plans, long drafts, defect lists — gives way first.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/context
 */

/**
 * Fixed text density. The repo prices model-visible content at four
 * characters per token (`dsh-token-meter`'s heuristic); this module mirrors it
 * so a prompt priced here and the same text priced there agree.
 */
const CHARS_PER_TOKEN = 4

/** Per-section structural overhead for framing, matching the shared heuristic. */
const SECTION_OVERHEAD = 4

/** Characters a trimmed section always keeps, so an elision stays readable. */
const MIN_KEEP_CHARS = 200

/** Iteration ceiling; each pass halves one section, so this cannot be reached in practice. */
const MAX_PASSES = 512

/** Separator between rendered sections. */
const SEPARATOR = '\n\n'

/** One labeled prompt section and how readily it may be trimmed. */
export interface PromptSection {
  /** Section label used in elision notes and compaction events. */
  readonly name: string
  /** Section body as the model would see it. */
  readonly text: string
  /**
   * Trim order: the lowest value gives way first, and `Infinity` marks a
   * section that must reach the model intact.
   */
  readonly trimPriority: number
}

/** One section the compactor shortened. */
export interface ElidedSection {
  /** Section label. */
  readonly name: string
  /** Characters the section carried before trimming. */
  readonly originalChars: number
  /** Characters that survived. */
  readonly keptChars: number
}

/** Result of fitting one prompt to a budget. */
export interface CompactionOutcome {
  /** Prompt text to send. */
  readonly text: string
  /** Heuristic token estimate of {@link CompactionOutcome.text}. */
  readonly estimatedTokens: number
  /** Sections that were shortened, in trim order; empty when nothing was cut. */
  readonly elided: readonly ElidedSection[]
}

/**
 * Price one text run under the shared density heuristic.
 * @param text - the text to price.
 * @returns heuristic tokens including one section's framing overhead.
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN) + SECTION_OVERHEAD
}

/**
 * Join sections into one prompt in declaration order.
 * @param sections - the sections to render.
 * @returns the rendered prompt.
 */
export function renderSections(sections: readonly PromptSection[]): string {
  return sections.map(section => section.text).join(SEPARATOR)
}

/**
 * Fit a prompt to a token budget by trimming its most expendable bulk first.
 * A section is halved repeatedly, keeping its head and tail so both the
 * opening context and the latest content survive, and never falls below
 * {@link MIN_KEEP_CHARS}; once a section reaches that floor the next priority
 * tier gives way instead. When every trimmable section is already at that
 * floor the prompt is returned as short as this module can make it, which the
 * caller sees as an estimate still above the budget.
 * @param sections - the prompt's labeled sections.
 * @param budgetTokens - token ceiling; `Infinity` disables trimming.
 * @returns the fitted prompt, its estimate, and what was elided.
 */
export function compactPrompt(
  sections: readonly PromptSection[],
  budgetTokens: number,
): CompactionOutcome {
  const kept = sections.map(section => section.text)
  let estimate = estimateOf(kept)
  if (!Number.isFinite(budgetTokens) || estimate <= budgetTokens) {
    return { text: kept.join(SEPARATOR), estimatedTokens: estimate, elided: [] }
  }

  // A section that cannot shrink further is retired rather than retried, so
  // the pass budget moves on to the next priority tier instead of spinning on
  // one section that has reached its floor.
  const exhausted = new Set<number>()
  for (let pass = 0; pass < MAX_PASSES && estimate > budgetTokens; pass += 1) {
    const target = nextTrimTarget(sections, kept, exhausted)
    if (target === -1) break
    const shortened = shorten(kept[target] as string)
    if (shortened.length >= (kept[target] as string).length) {
      exhausted.add(target)
      continue
    }
    kept[target] = shortened
    estimate = estimateOf(kept)
  }

  const elided: ElidedSection[] = []
  sections.forEach((section, index) => {
    const remaining = kept[index] as string
    if (remaining.length === section.text.length) return
    elided.push({
      name: section.name,
      originalChars: section.text.length,
      keptChars: remaining.length,
    })
  })
  return { text: kept.join(SEPARATOR), estimatedTokens: estimate, elided }
}

/** Estimate of the joined prompt, priced per section like the shared heuristic. */
function estimateOf(kept: readonly string[]): number {
  return kept.reduce((total, text) => total + estimateTextTokens(text), 0)
}

/**
 * The section to shorten next: within the lowest priority tier that still has
 * shrinkable text, the longest one. Returns -1 when nothing can shrink.
 */
function nextTrimTarget(
  sections: readonly PromptSection[],
  kept: readonly string[],
  exhausted: ReadonlySet<number>,
): number {
  let best = -1
  sections.forEach((section, index) => {
    if (!Number.isFinite(section.trimPriority)) return
    if (exhausted.has(index)) return
    if ((kept[index] as string).length <= MIN_KEEP_CHARS) return
    if (best === -1) {
      best = index
      return
    }
    const incumbent = sections[best] as PromptSection
    if (section.trimPriority < incumbent.trimPriority) {
      best = index
      return
    }
    if (section.trimPriority === incumbent.trimPriority
      && (kept[index] as string).length > (kept[best] as string).length) {
      best = index
    }
  })
  return best
}

/** Halve one section, keeping its head and tail with an elision note between. */
function shorten(text: string): string {
  const keepChars = Math.max(MIN_KEEP_CHARS, Math.floor(text.length / 2))
  const head = text.slice(0, Math.ceil(keepChars / 2))
  const tail = text.slice(text.length - Math.floor(keepChars / 2))
  const removed = text.length - head.length - tail.length
  return `${head}\n… ${removed} characters elided …\n${tail}`
}
