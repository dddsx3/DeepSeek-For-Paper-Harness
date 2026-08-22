/**
 * Skill body cleansing. A legacy skill package was written against one
 * provider's conventions: markup that only that provider parses, operating
 * instructions that name its command-line tool, and directives that assume a
 * provider-specific reasoning channel exists. None of that survives a move to
 * a provider-neutral harness — the markup renders as literal noise, and an
 * instruction naming a tool the harness does not expose is a prompt telling
 * the model to do something impossible.
 *
 * Cleansing is reported, never silent. Each rewrite carries its rule and line
 * so the result is reviewable: a skill body is model-visible text, and a
 * mechanical rewrite of model-visible text is a change to behavior that a
 * person should read before it ships. Callers get the cleansed text plus the
 * change list and decide whether to accept it.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/skill-content
 */

/** What one cleansing rule does to the text it matches. */
export type CleanseRuleKind = 'unwrap-tag' | 'drop-line' | 'replace'

/** One cleansing rule. */
export interface CleanseRule {
  /** Stable id reported with every change this rule makes. */
  readonly id: string
  /** What the rule does. */
  readonly kind: CleanseRuleKind
  /** Why the rule exists, shown in a review summary. */
  readonly reason: string
  /** Tag name for `unwrap-tag`; pattern for `drop-line` and `replace`. */
  readonly match: string | RegExp
  /** Replacement text for `replace`; ignored by the other kinds. */
  readonly replacement?: string
  /** Fence info string for `unwrap-tag`, e.g. `text`. */
  readonly fence?: string
}

/** One rewrite a cleansing pass made. */
export interface CleanseChange {
  /** Rule that made the change. */
  readonly rule: string
  /** 1-based line in the original text where the change started. */
  readonly line: number
  /** The original text the rule matched, trimmed for reporting. */
  readonly before: string
}

/** Result of cleansing one skill body. */
export interface CleanseOutcome {
  /** The cleansed text. */
  readonly text: string
  /** Every change made, in the order the rules ran. */
  readonly changes: readonly CleanseChange[]
}

/** Longest reported excerpt of a matched span. */
const EXCERPT_CHARS = 120

/**
 * Provider-specific markup a neutral harness does not parse. Each tag becomes
 * a fenced block so the content survives as content instead of being deleted
 * with the markup — a skill's examples are usually the useful part.
 */
const NEUTRALIZED_TAGS = ['example', 'examples', 'thinking', 'antml', 'function_calls', 'invoke'] as const

/**
 * Instructions that only make sense under the predecessor's operating model:
 * driving a provider's command-line tool, or bypassing the harness permission
 * surface. Both are dropped rather than rewritten, because the harness states
 * tool availability and permissions itself — a skill restating them is at best
 * redundant and at worst contradicts the live policy.
 */
const DROPPED_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /^\s*[-*]?\s*(?:use|run|invoke|call)\b[^\n]*\bcli\b[^\n]*$/iu,
  /^\s*[-*]?\s*[^\n]*\bskip(?:ping)?\s+(?:all\s+)?permissions?\b[^\n]*$/iu,
  /^\s*[-*]?\s*[^\n]*\b(?:bypass|disable|ignore)\s+(?:the\s+)?(?:permission|approval|sandbox)\b[^\n]*$/iu,
  /^\s*[-*]?\s*[^\n]*\bdangerously[-\s]?skip\b[^\n]*$/iu,
]

/**
 * Directives that assume a provider-specific reasoning channel is parseable.
 * Reasoning is an optional summary in this harness, never a structured field a
 * skill can rely on, so an instruction to read or emit one is removed.
 */
const DROPPED_REASONING_PATTERNS: readonly RegExp[] = [
  /^\s*[-*]?\s*[^\n]*\b(?:parse|read|extract|inspect)\b[^\n]*\bthinking\b[^\n]*$/iu,
  /^\s*[-*]?\s*[^\n]*\bthinking\s+block\b[^\n]*$/iu,
]

/** The default rule set, in the order a pass applies them. */
export const DEFAULT_CLEANSE_RULES: readonly CleanseRule[] = [
  ...NEUTRALIZED_TAGS.map((tag): CleanseRule => ({
    id: `unwrap-${tag}`,
    kind: 'unwrap-tag',
    reason: `<${tag}> is provider-specific markup; a neutral harness renders it literally`,
    match: tag,
    fence: 'text',
  })),
  ...DROPPED_INSTRUCTION_PATTERNS.map((pattern, index): CleanseRule => ({
    id: `drop-operating-instruction-${index + 1}`,
    kind: 'drop-line',
    reason: 'the harness owns tool availability and the permission surface; a skill must not restate or bypass them',
    match: pattern,
  })),
  ...DROPPED_REASONING_PATTERNS.map((pattern, index): CleanseRule => ({
    id: `drop-reasoning-directive-${index + 1}`,
    kind: 'drop-line',
    reason: 'reasoning is an optional summary here, not a structured field a skill can parse',
    match: pattern,
  })),
]

function excerpt(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat
}

/** 1-based line of one offset in the original text. */
function lineOf(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/** Escape a tag name for use inside a constructed pattern. */
function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Turn one tag pair into a fenced block, keeping its inner content.
 * A self-closing or unpaired tag is removed on its own, because leaving half a
 * tag behind would be worse than either outcome.
 */
function unwrapTag(text: string, rule: CleanseRule, changes: CleanseChange[]): string {
  const tag = escaped(String(rule.match))
  const fence = rule.fence ?? 'text'
  const paired = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'giu')
  let result = text.replace(paired, (whole, inner: string, offset: number) => {
    changes.push({ rule: rule.id, line: lineOf(text, offset), before: excerpt(whole) })
    const body = inner.replace(/^\n+|\n+$/gu, '')
    return body.length === 0 ? '' : `\`\`\`${fence}\n${body}\n\`\`\``
  })
  const lone = new RegExp(`</?${tag}(?:\\s[^>]*)?/?>`, 'giu')
  result = result.replace(lone, (whole, offset: number) => {
    changes.push({ rule: rule.id, line: lineOf(result, offset), before: excerpt(whole) })
    return ''
  })
  return result
}

/** Drop every line the rule matches. */
function dropLines(text: string, rule: CleanseRule, changes: CleanseChange[]): string {
  const pattern = rule.match instanceof RegExp ? rule.match : new RegExp(escaped(rule.match), 'iu')
  const kept: string[] = []
  text.split('\n').forEach((line, index) => {
    if (line.trim().length > 0 && pattern.test(line)) {
      changes.push({ rule: rule.id, line: index + 1, before: excerpt(line) })
      return
    }
    kept.push(line)
  })
  return kept.join('\n')
}

/** Replace every match of the rule's pattern. */
function replaceMatches(text: string, rule: CleanseRule, changes: CleanseChange[]): string {
  const source = rule.match instanceof RegExp ? rule.match.source : escaped(rule.match)
  const flags = rule.match instanceof RegExp ? rule.match.flags : 'iu'
  const pattern = new RegExp(source, flags.includes('g') ? flags : `${flags}g`)
  for (const match of text.matchAll(pattern)) {
    changes.push({ rule: rule.id, line: lineOf(text, match.index), before: excerpt(match[0]) })
  }
  const replacement = rule.replacement ?? ''
  return text.replace(pattern, () => replacement)
}

/** Collapse runs of three or more blank lines a removal can leave behind. */
function tidy(text: string): string {
  return `${text.replace(/\n{3,}/gu, '\n\n').replace(/[ \t]+$/gmu, '').trimEnd()}\n`
}

/**
 * Cleanse one skill body of provider-specific markup and instructions.
 * @param body - the skill's `system.md` text.
 * @param rules - rules to apply; the default set when omitted.
 * @returns the cleansed text and every change made, for review.
 */
export function cleanseSkillBody(
  body: string,
  rules: readonly CleanseRule[] = DEFAULT_CLEANSE_RULES,
): CleanseOutcome {
  const changes: CleanseChange[] = []
  let text = body
  for (const rule of rules) {
    if (rule.kind === 'unwrap-tag') text = unwrapTag(text, rule, changes)
    else if (rule.kind === 'drop-line') text = dropLines(text, rule, changes)
    else text = replaceMatches(text, rule, changes)
  }
  const cleansed = tidy(text)
  return { text: cleansed, changes }
}

/**
 * Whether one body still carries anything the default rules would rewrite.
 * A migrated package is expected to answer `false`, so a catalog can refuse a
 * body that was never cleansed instead of serving provider-specific markup to
 * a model.
 * @param body - the skill's `system.md` text.
 * @param rules - rules to check against; the default set when omitted.
 * @returns whether cleansing would change the body.
 */
export function needsCleansing(body: string, rules: readonly CleanseRule[] = DEFAULT_CLEANSE_RULES): boolean {
  return cleanseSkillBody(body, rules).changes.length > 0
}
