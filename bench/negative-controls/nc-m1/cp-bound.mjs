/**
 * Clopper–Pearson exact one-sided lower confidence bound for a binomial
 * proportion — a pure-JS mirror of
 * packages/paper/paper-foundation/src/probe/qualification.ts (verified
 * against scipy.stats.binomtest's exact method: beta.ppf(alpha, k, n-k+1)
 * — the repo's betaInverseCdf(alpha, k, n-k+1) — is the one-sided lower
 * bound; the two-sided interval scipy prints by default is wider, which
 * is why its .low column looks smaller).
 */

const CONFIDENCE = 0.95

/** ln Γ(x) — Lanczos approximation (same coefficients as qualification.ts). */
function gammaLn(x) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaLn(1 - x)
  const z = x - 1
  let acc = 0.99999999999980993
  for (let i = 0; i < g.length; i += 1) acc += g[i] / (z + i + 1)
  const t = z + g.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc)
}

/** Regularized incomplete beta I_x(a, b) via continued fraction (Lentz,
 *  verbatim port of qualification.ts's regularizedBeta — including its
 *  sign convention: the variable named lnBeta there holds
 *  logΓ(a+b) − logΓ(a) − logΓ(b) = −lnB(a,b), and the Lentz betacf below
 *  is tuned to that sign; using the true lnB silently zeroes `front`). */
function regIncBeta(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const negLnBeta = gammaLn(a + b) - gammaLn(a) - gammaLn(b)
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) + negLnBeta)
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(x, a, b)) / a
  return 1 - (front * betacf(1 - x, b, a)) / b
}

/** Continued fraction for the incomplete beta (Lentz) — verbatim port of
 *  qualification.ts so the two implementations cannot drift. */
function betacf(x, a, b) {
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

/** One-sided Clopper–Pearson lower bound, mirroring
 *  exactLowerConfidenceBound(successes, attempts) in qualification.ts:
 *  k=0 → 0; k=n → α^(1/n); else BetaQuantile(α; k, n-k+1). */
export function exactLowerConfidenceBound(k, n, confidence = CONFIDENCE) {
  const kk = Math.max(0, Math.min(k, n))
  if (kk <= 0) return 0
  if (kk >= n) return Math.pow(1 - confidence, 1 / n)
  const alpha = 1 - confidence
  let lo = 0
  let hi = 1
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    if (regIncBeta(mid, kk, n - kk + 1) < alpha) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }
  return (lo + hi) / 2
}
