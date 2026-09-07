/**
 * TASK-Q2 — statistical model qualification (expert plan §6).
 *
 * The point estimate `18/18 = 1.0` is strong engineering signal but a weak
 * scientific claim: "the model is 100% reliable" is not what 18/18 means.
 * What 18/18 *does* license, under a one-sided exact (Clopper–Pearson)
 * 95% lower confidence bound, is "the true success probability p is
 * ≥ ~0.83". The upgrade verdict moves from a point-estimate floor to:
 *
 *     LCB₉₅(p) ≥ p_min   AND   ESCAPE = 0   AND   retry budget = 0
 *
 * so 8/10 and 80/100 are no longer the same qualification — the evidence
 * behind them differs, and the registry can tell.
 *
 * Stop rule (expert plan §6.2, exact one-sided binomial bound):
 *   - zero failures: n=14 all-success licenses p > 0.80; n=29 licenses
 *     p > 0.90 (both at 95% one-sided confidence).
 *   - with failures the bound is (roughly) the beta quantile; this module
 *     computes it exactly rather than approximating, so any (successes,
 *     attempts) pair gets an honest number.
 *
 * Pure functions only: no I/O, no clock, no registry mutation. The
 * registry (probe/registry.ts) consumes these to decide upgrades.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/probe/qualification
 */

/** One-sided confidence level of the lower bound. */
export const QUALIFICATION_CONFIDENCE = 0.95

/** Phase-1 minimum true success probability for qualification. */
export const QUALIFICATION_P_MIN_PHASE1 = 0.80

/** Production minimum true success probability for qualification. */
export const QUALIFICATION_P_MIN_PRODUCTION = 0.90

/** Zero-failure stop rule: all-success attempts licensing p > 0.80. */
export const STOP_RULE_P80_ZERO_FAIL_N = 14

/** Zero-failure stop rule: all-success attempts licensing p > 0.90. */
export const STOP_RULE_P90_ZERO_FAIL_N = 29

/**
 * Exact one-sided lower confidence bound for a binomial proportion — the
 * Clopper–Pearson lower bound:
 *
 *   - zero failures (k = n): the closed form is LCB = α^(1/n). Fourteen
 *     all-success attempts license p ≥ 0.807; twenty-nine license p ≥ 0.902
 *     — the expert plan's stop rule (§6.2: 14 → p>0.8, 29 → p>0.9) is this
 *     formula, not an approximation. (The naive "1 - α" reading is wrong:
 *     any p < 1 has probability p^n of producing n successes, and the
 *     bound must price that in.)
 *   - otherwise: the beta quantile LCB = BetaQuantile(α; k, n-k+1).
 *
 * Total: never throws; `successes` outside [0, attempts] is clamped.
 */
export function exactLowerConfidenceBound(
  successes: number,
  attempts: number,
  confidence: number = QUALIFICATION_CONFIDENCE,
): number {
  const n = Math.floor(attempts)
  if (n <= 0) return 0
  const k = Math.min(Math.max(Math.floor(successes), 0), n)
  const alpha = 1 - confidence
  if (k <= 0) return 0
  if (k >= n) return Math.pow(alpha, 1 / n)
  return betaInverseCdf(alpha, k, n - k + 1)
}

/**
 * Regularized incomplete beta function I_x(a, b) (the beta CDF), computed
 * by the continued-fraction series (Lentz's method) — the standard
 * numerically-stable formulation (cf. Numerical Recipes betacf/betai).
 */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lnBeta = logGamma(a + b) - logGamma(a) - logGamma(b)
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) + lnBeta)
  if (x < (a + 1) / (a + b + 2)) {
    return front * betacf(x, a, b) / a
  }
  return 1 - front * betacf(1 - x, b, a) / b
}

/** Continued fraction for the incomplete beta (Lentz). */
function betacf(x: number, a: number, b: number): number {
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab - m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-12) break
  }
  return h
}

/** log-Γ(x) — Lanczos approximation. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }
  const z = x - 1
  let acc = 0.99999999999980993
  for (let i = 0; i < g.length; i += 1) acc += g[i]! / (z + i + 1)
  const t = z + g.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc)
}

/** Inverse of the regularized beta CDF by bisection (exact to 1e-12). */
function betaInverseCdf(p: number, a: number, b: number): number {
  let low = 0
  let high = 1
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2
    if (regularizedBeta(mid, a, b) < p) low = mid
    else high = mid
    if (high - low < 1e-12) break
  }
  return (low + high) / 2
}

/** Per-attempt outcome kinds the qualification consumes. */
export type AttemptOutcome =
  | 'SUCCESS'   // first attempt passed every structural + semantic gate
  | 'NONE'      // no usable container (guidance gap)
  | 'DRIFT'     // container-shaped but off the declaration domain
  | 'ESCAPE'    // tried to smuggle harness-owned facts — zero tolerance
  | 'RUN'       // admitted, then the code run failed
  | 'TRANSPORT' // provider fault, not the model's fault

/** One measured probe pass (model × protocol × schema version). */
export interface QualificationSample {
  readonly outcomes: ReadonlyArray<AttemptOutcome>
  /** ESCAPE attempts in the sample (never tolerable for qualification). */
  readonly escapeCount: number
  /** Guided-retry budget consumed to reach these outcomes. */
  readonly retryBudgetUsed: number
}

/** The statistical verdict replacing the point-estimate floor. */
export interface QualificationVerdict {
  readonly qualified: boolean
  readonly n: number
  readonly successes: number
  /** Exact one-sided 95% lower bound on the true success probability. */
  readonly lcb95: number
  readonly pMin: number
  readonly failuresByClass: Readonly<Record<Exclude<AttemptOutcome, 'SUCCESS'>, number>>
  readonly reasons: ReadonlyArray<string>
}

/**
 * The qualification gate (expert plan §6.1):
 *
 *     LCB₉₅(p) ≥ p_min  AND  ESCAPE = 0  AND  retry budget = 0
 *
 * 8/10 and 80/100 are different qualifications here: 80/100's bound is
 * ~0.71 — the point estimates match but the evidence does not, and the
 * verdict says so.
 */
export function evaluateQualification(
  sample: QualificationSample,
  pMin: number = QUALIFICATION_P_MIN_PHASE1,
): QualificationVerdict {
  const outcomes = sample.outcomes
  const n = outcomes.length
  const successes = outcomes.filter(o => o === 'SUCCESS').length
  const count = (kind: AttemptOutcome) => outcomes.filter(o => o === kind).length
  const failuresByClass = {
    NONE: count('NONE'),
    DRIFT: count('DRIFT'),
    ESCAPE: count('ESCAPE'),
    RUN: count('RUN'),
    TRANSPORT: count('TRANSPORT'),
  } as const

  const reasons: string[] = []
  if (n === 0) reasons.push('no attempts measured')
  const lcb95 = exactLowerConfidenceBound(successes, n)
  if (n > 0 && lcb95 < pMin) {
    reasons.push(`LCB₉₅ ${lcb95.toFixed(3)} < p_min ${pMin.toFixed(2)} (point estimate ${(successes / n).toFixed(2)} is not the claim — the bound is)`)
  }
  const escapeTotal = failuresByClass.ESCAPE + sample.escapeCount
  if (escapeTotal > 0) reasons.push(`ESCAPE = ${escapeTotal} (zero tolerance — qualification refused regardless of adherence)`)
  if (sample.retryBudgetUsed > 0) reasons.push(`retry budget spent (${sample.retryBudgetUsed}) — guidance reached the outcomes, the tier is not FORMAL (禁 5)`)

  return {
    qualified: reasons.length === 0 && n > 0,
    n,
    successes,
    lcb95,
    pMin,
    failuresByClass,
    reasons,
  }
}

/**
 * The zero-failure stop rule (expert plan §6.2): how many all-success
 * attempts license the target p_min. With any failures the rule does not
 * apply — the exact bound path (evaluateQualification) answers instead.
 */
export function stopRuleTarget(pMin: number): number | undefined {
  if (pMin <= QUALIFICATION_P_MIN_PHASE1 + 1e-9) return STOP_RULE_P80_ZERO_FAIL_N
  if (pMin <= QUALIFICATION_P_MIN_PRODUCTION + 1e-9) return STOP_RULE_P90_ZERO_FAIL_N
  return undefined
}
