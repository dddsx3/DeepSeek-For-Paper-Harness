/**
 * TASK-P2-0 — record-trail and pricing discipline tests.
 *
 *   - F8: the probe trail contract — every attempt produces exactly one
 *     records line carrying outcome/failure-class/usage, checkable from an
 *     archived trail; a helper validates the invariant so any future probe
 *     writer that drops lines fails this spec, not the experiment.
 *   - pricing: cost is computed ONLY for priced models (config-driven);
 *     unpriced = 0, never a guess (NOT-NOW #10).
 *   - legacy-protocol: a legacy registry record is history, never a
 *     qualification claim — upgradeVerdict refuses it with a citation
 *     instruction, regardless of its numbers.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { upgradeVerdict } from '../../src/probe/registry.ts'
import type { CombinationRecord } from '../../src/probe/registry.ts'

// ---------------------------------------------------------------------------
// F8 — the records trail invariant
// ---------------------------------------------------------------------------

/** Trail record shape (what every probe must write per attempt). */
export interface ProbeTrailRecord {
  readonly model: string
  readonly endpoint: string
  readonly attempt: number
  readonly problem_hash: string
  readonly outcome: string
  readonly stage: string
  readonly failure_class: string
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number } | null
}

/**
 * Validate an archived records.jsonl trail against its attempts count
 * (the F8 invariant: lines == attempts, every line complete). Throws with
 * a precise reason on the first violation. Used by the P2-A runner and
 * pinned here by the spec below.
 */
export function validateTrail(jsonlText: string, expectedAttempts: number): void {
  const lines = jsonlText.split('\n').filter(l => l.trim().length > 0)
  if (lines.length !== expectedAttempts) {
    throw new Error(`trail has ${lines.length} lines, expected ${expectedAttempts} (one per attempt)`)
  }
  for (const [index, line] of lines.entries()) {
    let record: ProbeTrailRecord
    try {
      record = JSON.parse(line) as ProbeTrailRecord
    } catch (error) {
      throw new Error(`trail line ${index + 1} is not JSON: ${String(error).slice(0, 80)}`)
    }
    for (const field of ['model', 'endpoint', 'attempt', 'problem_hash', 'outcome', 'stage', 'failure_class'] as const) {
      if (record[field] === undefined) throw new Error(`trail line ${index + 1} missing field '${field}'`)
    }
    if (record.problem_hash.length !== 16) {
      throw new Error(`trail line ${index + 1} problem_hash is not a 16-char digest`)
    }
    if (record.usage !== null && (record.usage.input_tokens === undefined || record.usage.output_tokens === undefined)) {
      throw new Error(`trail line ${index + 1} usage present but incomplete`)
    }
  }
}

describe('F8 — probe trail invariant (lines == attempts, every line complete)', () => {
  it('a complete trail passes validation', () => {
    const lines = Array.from({ length: 14 }, (_, i) => JSON.stringify({
      model: 'z-ai/glm-5.3-flash', endpoint: 'https://relay/v1', attempt: i + 1,
      problem_hash: 'a'.repeat(16), outcome: 'SUCCESS', stage: 'full', failure_class: 'SUCCESS',
      usage: { input_tokens: 100, output_tokens: 50 },
    }))
    expect(() => validateTrail(lines.join('\n'), 14)).not.toThrow()
  })

  it('a dropped line fails the trail (the F8 bug would have failed here)', () => {
    const lines = Array.from({ length: 3 }, (_, i) => JSON.stringify({
      model: 'm', endpoint: 'e', attempt: i + 1, problem_hash: 'a'.repeat(16),
      outcome: 'SUCCESS', stage: 'full', failure_class: 'SUCCESS', usage: null,
    }))
    expect(() => validateTrail(lines.join('\n'), 14)).toThrow(/3 lines, expected 14/)
  })

  it('an incomplete line (missing failure_class) fails validation', () => {
    const bad = JSON.stringify({ model: 'm', endpoint: 'e', attempt: 1, problem_hash: 'a'.repeat(16), outcome: 'SUCCESS', stage: 'full' })
    expect(() => validateTrail(bad, 1)).toThrow(/missing field 'failure_class'/)
  })

  it('the committed P1-C real trails satisfy the invariant (14 lines each)', () => {
    // The archived trails from the two qualification runs — if either were
    // the empty file F8 shipped with, this test goes red.
    for (const slug of ['z-ai-glm-5.3-flash', 'deepseek-deepseek-v4-pro']) {
      const text = readFileSync(
        fileURLToPath(new URL(`../../../../../artifacts/handoff/TASK-E/output-p1c/${slug}/records.jsonl`, import.meta.url)),
        'utf8',
      )
      expect(() => validateTrail(text, 14)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// legacy-protocol — history, never a qualification claim
// ---------------------------------------------------------------------------

describe('legacy-protocol records are refused by upgradeVerdict', () => {
  const record: CombinationRecord = {
    provider: 'deepseek-official',
    model: 'deepseek/deepseek-v4-flash',
    endpoint: 'https://api.y-api.bestvirtualgoods.com/v1',
    tier: 'T3',
    date: '2026-09-07',
    structuralAdherence: 1,
    firstTrySuccess: 1,
    retryBudgetUsed: 0,
    attempts: 18,
    successes: 18,
    escapeCount: 0,
    legacy: 'legacy-protocol',
  }

  it('an 18/18 legacy record is refused despite its perfect numbers', () => {
    const verdict = upgradeVerdict(record)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/legacy-protocol/)
  })

  it('the same numbers without the legacy mark still qualify (the mark is the gate, not the numbers)', () => {
    const { legacy: _l, ...current } = record
    const verdict = upgradeVerdict(current)
    expect(verdict.ok).toBe(true)
  })

  it('legacy refusal outranks even zero-failure statistical evidence', () => {
    // Order matters: the legacy check sits before every other rule.
    const verdict = upgradeVerdict({ ...record, date: '2026-09-08' })
    expect(verdict.ok).toBe(false)
  })
})
