import { describe, expect, it } from 'vitest'
import { compactPrompt, estimateTextTokens, renderSections, type PromptSection } from '../src/index.ts'

const KEEP = Infinity

function section(name: string, chars: number, trimPriority: number): PromptSection {
  return { name, text: `${name}:`.padEnd(chars, 'x'), trimPriority }
}

describe('context budgeting', () => {
  it('prices text at the shared four-character density plus framing', () => {
    expect(estimateTextTokens('')).toBe(4)
    expect(estimateTextTokens('abcd')).toBe(5)
    expect(estimateTextTokens('a'.repeat(400))).toBe(104)
  })

  it('renders sections in declaration order separated by a blank line', () => {
    expect(renderSections([
      { name: 'a', text: 'first', trimPriority: KEEP },
      { name: 'b', text: 'second', trimPriority: KEEP },
    ])).toBe('first\n\nsecond')
  })

  it('returns the prompt untouched when it already fits or the budget is unbounded', () => {
    const sections = [section('task', 400, 3), section('plan', 400, 0)]
    const fits = compactPrompt(sections, 1000)
    expect(fits.elided).toEqual([])
    expect(fits.text).toBe(renderSections(sections))

    const unbounded = compactPrompt(sections, Infinity)
    expect(unbounded.elided).toEqual([])
    expect(unbounded.estimatedTokens).toBeGreaterThan(0)
  })

  it('trims the lowest-priority section first and keeps head and tail', () => {
    const sections = [
      section('task', 4000, 3),
      section('plan', 4000, 0),
      { name: 'instruction', text: 'answer briefly', trimPriority: KEEP },
    ]
    const outcome = compactPrompt(sections, 1200)

    expect(outcome.elided.map(entry => entry.name)).toEqual(['plan'])
    expect(outcome.text).toContain('characters elided')
    expect(outcome.text.startsWith('task:')).toBe(true)
    expect(outcome.text.endsWith('answer briefly')).toBe(true)
    expect(outcome.estimatedTokens).toBeLessThanOrEqual(1200)
  })

  it('escalates through the priority tiers when one section is not enough', () => {
    const sections = [
      section('task', 8000, 3),
      section('draft', 8000, 2),
      section('defects', 8000, 1),
      section('plan', 8000, 0),
      { name: 'instruction', text: 'answer briefly', trimPriority: KEEP },
    ]
    const outcome = compactPrompt(sections, 400)

    expect(outcome.elided.map(entry => entry.name).sort())
      .toEqual(['defects', 'draft', 'plan', 'task'])
    expect(outcome.estimatedTokens).toBeLessThanOrEqual(400)
    for (const entry of outcome.elided) {
      expect(entry.keptChars).toBeLessThan(entry.originalChars)
    }
  })

  it('never trims a keep-section, and reports what it could not fit', () => {
    const sections = [
      { name: 'instruction', text: 'x'.repeat(8000), trimPriority: KEEP },
      section('plan', 400, 0),
    ]
    const outcome = compactPrompt(sections, 100)

    expect(outcome.elided.map(entry => entry.name)).toEqual(['plan'])
    expect(outcome.text).toContain('x'.repeat(8000))
    // The floor is honest about failure rather than dropping a required section.
    expect(outcome.estimatedTokens).toBeGreaterThan(100)
  })

  it('breaks a priority tie by length and stops when a section cannot shrink', () => {
    const sections = [
      section('short-plan', 900, 0),
      section('long-plan', 4000, 0),
      { name: 'instruction', text: 'answer briefly', trimPriority: KEEP },
    ]
    const outcome = compactPrompt(sections, 700)

    // Same tier, so the longer section gives way first: it is the only one cut,
    // and trimming stops as soon as the budget is met.
    expect(outcome.elided.map(entry => entry.name)).toEqual(['long-plan'])
    const longPlan = outcome.elided[0]
    expect(longPlan?.keptChars).toBeLessThan(longPlan?.originalChars ?? 0)
    expect(outcome.estimatedTokens).toBeLessThanOrEqual(700)
  })

  it('leaves sections already at the keep floor alone', () => {
    const sections = [section('plan', 150, 0), section('draft', 150, 2)]
    const outcome = compactPrompt(sections, 10)
    expect(outcome.elided).toEqual([])
    expect(outcome.text).toBe(renderSections(sections))
  })
})
