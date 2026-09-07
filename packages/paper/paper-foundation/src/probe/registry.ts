/**
 * TASK-PW W5 — combination registry (能力探针 v1).
 *
 * One provider+model+endpoint+tier combination is measured by a micro-probe
 * (5 questions across the protocol tiers) and recorded here. Every record
 * carries the two adherence metrics and the retry budget actually spent:
 *
 *   structuralAdherence — 结构遵从率: first attempts whose output was
 *     structurally valid for the tier (container parses / every guided step
 *     admits / the fill-in admits) over total first attempts.
 *   firstTrySuccess     — 层内首次成功率: first attempts that completed the
 *     tier end-to-end (structure AND numeric gates) over total attempts.
 *   retryBudgetUsed     — NONE/DRIFT guided-retry budget actually consumed
 *     while reaching the recorded outcome (W4 budgets; ESCAPE has none).
 *
 * Upgrade discipline (禁 5): a combination may only move UP a protocol tier
 * through a fresh probe pass — `upgradeVerdict` is the single gate, and it
 * requires BOTH metrics ≥ 0.8 AND zero retry budget on the first attempts
 * (a combination that needed guidance to reach 0.8 is not yet FORMAL).
 *
 * The registry is append-only: every probe run adds a dated record; the
 * latest record per (provider, model, endpoint, tier) is the live one.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/probe
 */

import { exactLowerConfidenceBound } from './qualification.ts'

/** One combination's identity: the thing a tier assignment is about. */
export interface CombinationIdentity {
  readonly provider: string
  readonly model: string
  /** Provider endpoint (base URL) — two endpoints are two combinations. */
  readonly endpoint: string
  /** The protocol tier this observation measures. */
  readonly tier: 'T1' | 'T2' | 'T3'
}

/** One dated probe observation of a combination. */
export interface CombinationRecord extends CombinationIdentity {
  /** ISO date of the probe pass that produced this record. */
  readonly date: string
  /** 结构遵从率 in [0,1]: structurally-valid first attempts / total. */
  readonly structuralAdherence: number
  /** 层内首次成功率 in [0,1]: end-to-end-completing first attempts / total. */
  readonly firstTrySuccess: number
  /** W4 guided-retry budget actually consumed during the pass. */
  readonly retryBudgetUsed: number
  readonly attempts: number
  /** TASK-Q2: first-attempt successes (the LCB's numerator). */
  readonly successes?: number
  /** TASK-Q2: ESCAPE attempts in the pass (zero tolerance for upgrade). */
  readonly escapeCount?: number
}

/** The single upgrade gate (禁 5). */
export type UpgradeVerdict =
  | { ok: true; to: CombinationRecord['tier'] }
  | { ok: false; reason: string }

/** The structural floor every tier's first attempt must clear. */
const FLOOR = 0.8

/**
 * Decide whether a fresh probe pass entitles this combination to the
 * measured tier (or to move up from it).
 *
 * TASK-Q2 (expert plan §6.3): the point-estimate floor is replaced by the
 * statistical gate — the exact one-sided 95% lower confidence bound of the
 * first-try success probability must clear the floor, ESCAPE must be
 * zero, and the retry budget untouched. 8/10 and 80/100 no longer earn
 * the same qualification: 80/100's exact LCB is ~0.723 and the verdict
 * says so. A record without per-attempt data (successes/escapeCount
 * absent, the pre-Q2 shape) falls back to the point-estimate reading so
 * historical probe archives stay loadable — but only fresh probes can
 * qualify.
 */
export function upgradeVerdict(record: CombinationRecord): UpgradeVerdict {
  if (record.attempts < 1) return { ok: false, reason: 'no first attempts measured' }
  if (record.retryBudgetUsed > 0) {
    return {
      ok: false,
      reason: `retry budget was spent (${record.retryBudgetUsed}) — guidance got the pass, so the tier is not FORMAL (禁 5)`,
    }
  }
  if ((record.escapeCount ?? 0) > 0) {
    return {
      ok: false,
      reason: `ESCAPE = ${record.escapeCount} — zero tolerance; the tier is refused regardless of adherence`,
    }
  }
  const successes = record.successes
  if (successes !== undefined) {
    const lcb = exactLowerConfidenceBound(successes, record.attempts)
    if (lcb < FLOOR) {
      return {
        ok: false,
        reason: `LCB₉₅ of first-try success ${lcb.toFixed(3)} < ${FLOOR} (point estimate ${(successes / record.attempts).toFixed(2)}; the bound is the claim — expert plan §6.3)`,
      }
    }
    if (record.structuralAdherence < FLOOR) {
      return { ok: false, reason: `structural adherence ${record.structuralAdherence.toFixed(3)} < ${FLOOR}` }
    }
    return { ok: true, to: record.tier }
  }
  // Pre-Q2 record shape: point-estimate reading only (legacy archives).
  if (record.structuralAdherence < FLOOR) {
    return { ok: false, reason: `structural adherence ${record.structuralAdherence.toFixed(3)} < ${FLOOR}` }
  }
  if (record.firstTrySuccess < FLOOR) {
    return { ok: false, reason: `first-try success ${record.firstTrySuccess.toFixed(3)} < ${FLOOR}` }
  }
  return { ok: true, to: record.tier }
}

/**
 * The append-only registry. `observe` records one probe pass; the latest
 * record per combination identity is the live tier assignment.
 */
export class CombinationRegistry {
  readonly #records: CombinationRecord[] = []

  /** Record one probe pass. Returns the stored record. */
  observe(record: CombinationRecord): CombinationRecord {
    this.#records.push(record)
    return record
  }

  /** All records, oldest first. */
  all(): ReadonlyArray<CombinationRecord> {
    return [...this.#records]
  }

  /** The live (latest) record for one combination, if any. */
  latest(identity: CombinationIdentity): CombinationRecord | undefined {
    for (let i = this.#records.length - 1; i >= 0; i -= 1) {
      const candidate = this.#records[i]
      if (candidate !== undefined
        && candidate.provider === identity.provider
        && candidate.model === identity.model
        && candidate.endpoint === identity.endpoint
        && candidate.tier === identity.tier) {
        return candidate
      }
    }
    return undefined
  }
}
