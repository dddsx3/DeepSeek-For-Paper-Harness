/**
 * M-Bench metrics calculator — DPH-PRD-v2 §4 (P0-1, W1).
 *
 * Reads one run-report.json per problem (the paper-shell CLI already
 * writes { runId, tier, mode, status, sha256, audit, usage } plus the
 * BLOCKED memo { minted_ir_kinds, minted_ir_count, failing_node, ... })
 * and computes the preregistered indicator set, PER PROBLEM and PER
 * FAMILY, never aggregated into a single blended success number.
 *
 * Hard rules encoded here (PRD §4.2 / PREREGISTRATION.md §C–F):
 *  - M1 must be reported split by delivery grade (CLEAN vs MARKED);
 *    a blended total is a protocol violation, so `report()` refuses it.
 *  - M3c prints `null` (not 0) when pricing is unconfigured — reporting
 *    $0 for an unpriced run is the historical sin F-audit flagged.
 *  - Determinism: same inputs + same seed → same JSON (sort keys).
 *
 * @module bench/metrics/compute-metrics.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const benchRoot = resolve(here, '..')

/** Paper skeleton sections M4 counts (PRD P0-7's 10-section list). */
export const M4_SECTIONS = [
  '摘要', '问题重述', '问题分析', '模型假设', '符号说明',
  '模型建立与求解', '模型检验', '模型评价', '参考文献', '代码附录',
]

/** 490MB-class attachments are hashed from the manifest, not re-read. */
const MAX_HASH_BYTES = 64 * 1024 * 1024

export async function sha256File(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

/** Load and sha256-verify the frozen bench manifest. */
export async function loadManifest() {
  const manifest = JSON.parse(await readFile(join(benchRoot, 'MANIFEST.json'), 'utf8'))
  const problems = manifest.problems ?? []
  const manifestProblems = problems.map(p => p.id)
  const frozen = [...manifestProblems, ...(manifest.pending_placeholders ?? []).map(p => p.id)]
  return { manifest, frozenIds: frozen }
}

/**
 * Recompute sha256 of every non-placeholder problem file and compare with
 * the frozen manifest. Any mismatch = the bench has been tampered with;
 * metrics computed on a mutated bench are void (anti-cheat clause F).
 */
export async function verifyManifestIntegrity() {
  const { manifest } = await loadManifest()
  const failures = []
  for (const problem of manifest.problems ?? []) {
    for (const file of problem.files ?? []) {
      const full = join(benchRoot, file.path)
      const actual = await sha256File(full).catch(() => null)
      if (actual !== file.sha256) failures.push({ file: file.path, expected: file.sha256, actual })
    }
  }
  return { ok: failures.length === 0, failures }
}

/** Delivery grade implied by a run report (PRD §3.3 fail-soft tiers).
 *  W2+: the shell's run-report carries an explicit `grade` field written
 *  from the executor's delivery_graded audit entry — that is the index;
 *  the appendix inside report.md remains the source of truth. Legacy
 *  reports (pre-P0-3) fall back to the status-based mapping. */
export function deliveryGrade(report) {
  if (report.grade === 'MARKED') return 'MARKED'
  if (report.grade === 'CLEAN') return 'CLEAN'
  if (report.status === 'DELIVERED' || report.status === 'CLEAN') return 'CLEAN'
  if (report.status === 'MARKED') return 'MARKED'
  return 'BLOCKED'
}

/** M2 core: numbers in the draft must trace to sources. A number with no
 *  matching source token and no Result-backed claim is a silent error. */
export function silentNumericErrors(draftText, sources) {
  const errors = []
  const numberRe = /-?\d+(?:\.\d+)?/g
  const sourceHaystack = sources.join(' ')
  const sourceNumbers = new Set((sourceHaystack.match(numberRe) ?? []).map(n => Number(n)))
  for (const match of draftText.matchAll(numberRe)) {
    const raw = match[0]
    // Years, section numbers, small integers used structurally are not
    // "key numbers"; the preregistration scopes M2 to CONCLUSION numbers,
    // so only numbers inside the conclusion/table/figure context count.
    const value = Number(raw)
    if (raw.length <= 2 && Number.isInteger(value) && Math.abs(value) <= 99) continue
    if (sourceNumbers.has(value)) continue
    // tolerance-matched source (e.g. rounding): ±0.5% of some source number
    const toleranceMatch = [...sourceNumbers].some(s => Math.abs(s) > 0 && Math.abs(value - s) / Math.abs(s) <= 0.005)
    if (toleranceMatch) continue
    errors.push({ number: raw })
  }
  return errors
}

/** n-gram overlap between draft and problem statement (anti-recital rule B4). */
export function recitalOverlap(draftText, problemText, n = 8) {
  const grams = (text) => {
    const words = text.split(/\s+/).filter(Boolean)
    const set = new Set()
    for (let i = 0; i + n <= words.length; i += 1) set.add(words.slice(i, i + n).join(' '))
    return set
  }
  const g1 = grams(draftText)
  const g2 = grams(problemText)
  if (g1.size === 0) return 0
  let hits = 0
  for (const gram of g1) if (g2.has(gram)) hits += 1
  return hits / g1.size
}

/** M4: which of the 10 skeleton sections are present in the draft. */
export function skeletonPresence(draftText) {
  const present = []
  const missing = []
  for (const section of M4_SECTIONS) {
    if (draftText.includes(section)) present.push(section)
    else missing.push(section)
  }
  return { present, missing, ratio: present.length / M4_SECTIONS.length }
}

/** M5: draft must contain a figure whose data traces to a real attachment
 *  (in W1 this is detectable only as "figure section + data_ref not scalar
 *  placeholder"; full DataArtifact wiring is P1-1's obligation). */
export function figureUsability(draftText, report) {
  const hasFigure = /图\s*\d|figure\s*\d/i.test(draftText)
  const hasRealData = report?.figures_from_data === true
  return { usable: hasFigure && hasRealData === true, hasFigureSection: hasFigure, hasRealData }
}

/**
 * Compute the per-problem metric record from one run report + draft.
 * Returns the full record even when indicators are red — red IS data.
 */
/**
 * W8.10-A6 — the component-set mismatch rule, mirrored from
 * `routeCoversTruth` (apps/paper-shell/src/route.ts). A truth label like
 * "F3+F4" is COVERED when every one of its components appears in the router's
 * component set; the primary family alone is not the claim.
 *
 * Kept as a local mirror because this script is plain .mjs and cannot import
 * the TypeScript module. The two implementations are pinned together by the
 * A6 verification (same inputs -> same verdict on the archived runs).
 */
export function routeMismatchOf(routedFamily, truthLabel) {
  const decide = (routed, truth) => {
    if (routed === null || truth === null) return { mismatch: null, basis: 'missing_input' }
    const truthParts = String(truth).split('+').map(s => s.trim()).filter(s => /^F[1-4]$/.test(s))
    if (truthParts.length === 0) return { mismatch: null, basis: 'unparseable_truth' }
    const routedParts = String(routed).split('+').map(s => s.trim()).filter(s => /^F[1-4]$/.test(s))
    // Single-family truth: the primary family IS the whole claim, so the
    // comparison is exact and the archive is sufficient.
    if (truthParts.length === 1) {
      return { mismatch: !routedParts.includes(truthParts[0]), basis: 'single_family_exact' }
    }
    // Multi-family truth (2024-B: F3+F4): coverage needs the router's COMPONENT
    // SET. The archived run-reports predate that field, so the archive alone
    // cannot decide. Returning `true` here would be the old string comparison
    // wearing a new name — the exact defect A6 exists to remove.
    return { mismatch: null, basis: 'archive_lacks_routed_components' }
  }
  return decide(routedFamily, truthLabel)
}

export function computeProblemMetrics(problemId, family, report, draftText, problemText, meta = {}) {
  const grade = deliveryGrade(report)
  const recital = recitalOverlap(draftText ?? '', problemText ?? '')
  const skeleton = skeletonPresence(draftText ?? '')
  const silentErrors = silentNumericErrors(draftText ?? '', [
    problemText ?? '',
    ...(meta.resultNumbers ?? []),
  ])
  const figure = figureUsability(draftText ?? '', report)
  const usage = report.usage ?? {}
  const costKnown = usage.cost_usd !== undefined && usage.cost_usd > 0
  const manualInterventions = meta.manual_interventions ?? 0
  // W8.5 (B2): the shell stamps wall_clock_seconds into run-report.json —
  // prefer it (top-level), fall back to a meta override for fixtures.
  const wallClockSeconds = report.wall_clock_seconds ?? meta.wall_clock_seconds ?? null

  const m1Readable = grade !== 'BLOCKED'
    && recital < 0.30
    && skeleton.missing.length === 0
    && silentErrors.length === 0
  const m1Split = grade === 'CLEAN' ? { clean: true, marked: false } : grade === 'MARKED' ? { clean: false, marked: true } : { clean: false, marked: false }
  // W8.6-B3: in/out ratio — the W8.5 run burned 75,669 output tokens for
  // 8,785 input (8.6:1) and NOTHING flagged it. Ratio > IN_OUT_ALERT
  // marks the record (baseline W8.5 = 8.6).
  const inTokens = usage.input_tokens ?? 0
  const outTokens = usage.output_tokens ?? 0
  const inOutRatio = inTokens > 0 ? Math.round((outTokens / inTokens) * 100) / 100 : null
  const inOutAlert = inOutRatio !== null && inOutRatio > 5
  // W8.6-E3: M2 is conditioned on delivery. No deliverable → no "silent
  // errors" to count: null, NOT 0 (a 0 would read as "zero errors found").
  const delivered = grade === 'CLEAN' || grade === 'MARKED'
  // W8.6-E1: provider mode is a REQUIRED field — fake and real results
  // must be mechanically distinguishable in one snapshot (red line N2).
  // Legacy reports without the field default by directory convention:
  // "<id>-real" = real, everything else fake (the W1 baseline).
  const providerMode = report.provider_mode ?? (/-real(-shard)?$/.test(problemId) ? 'real' : 'fake')

  return {
    problem_id: problemId,
    // W8.10-A6: `family` = the revised human truth (TRUTH-FAMILIES.json);
    // `preregistered_family` = the frozen W1 prior (MANIFEST.json). They
    // differ for 2024-B (F3+F4 vs F3) and 2024-C (F3+F2 vs F3) — carrying
    // only one of them under the name `family` is what made a single record
    // disagree with itself.
    family,
    preregistered_family: meta.preregistered_family ?? null,
    // W8.6-E2: the human truth label vs what the router decided. Either
    // alone cannot answer "is routing accurate" over time.
    routed_family: report.routed_family ?? meta.routed_family ?? null,
    route_truth: report.route_truth ?? null,
    // W8.10-A6: recomputed here from `routed_family` + `route_truth` using the
    // component-SET rule (mirrors apps/paper-shell/src/route.ts:routeCoversTruth).
    // The archived `route_mismatch` was written by the pre-W8.9 string
    // comparison, which marked every legal mixed-family problem as a mismatch
    // (2024-B: truth F3+F4 vs routed F4). Archives stay immutable; the metrics
    // view states the verdict the current rule gives.
    ...(() => {
      const verdict = routeMismatchOf(report.routed_family ?? null, report.route_truth ?? null)
      return { route_mismatch: verdict.mismatch, route_mismatch_basis: verdict.basis }
    })(),
    // The archived verdict is kept, named, so the drift is visible rather than erased.
    route_mismatch_archived: report.route_mismatch ?? null,
    provider_mode: providerMode,
    grade,
    m1_readable_draft: m1Readable,
    m1_grade_split: m1Split,
    m2_silent_errors: delivered ? silentErrors.length : null,
    m2_silent_error_samples: delivered ? silentErrors.slice(0, 5) : [],
    m2_recital_overlap: delivered ? Math.round(recital * 1000) / 1000 : null,
    m3a_zero_manual: manualInterventions === 0,
    m3b_wall_clock_seconds: wallClockSeconds,
    m3b_in_out_ratio: inOutRatio,
    m3b_in_out_alert: inOutAlert,
    m3c_cost_usd: costKnown ? usage.cost_usd : null,
    m3c_pricing_configured: costKnown,
    m4_skeleton_ratio: skeleton.ratio,
    m4_missing_sections: skeleton.missing,
    m5_figure_usable: figure.usable,
    m5_detail: figure,
  }
}

/**
 * Aggregate per family — and ONLY per family. Summing families into one
 * total is forbidden (PRD §4.2 / PREREGISTRATION §F); this function
 * throws if asked to do it, so the mistake cannot ship silently.
 */
export function aggregatePerFamily(records) {
  // W8.6-E1: aggregation key is family PROVIDER-MODE-SCOPED. Fake and real
  // runs must never blend into one number (red line N2 — the snapshot now
  // enforces what prose used to depend on the reader remembering).
  const byKey = new Map()
  for (const r of records) {
    const key = `${r.family}${r.provider_mode === 'real' ? ' (real)' : ''}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(r)
  }
  const out = {}
  for (const [family, list] of byKey) {
    const clean = list.filter(r => r.m1_grade_split.clean && r.m1_readable_draft).length
    const marked = list.filter(r => r.m1_grade_split.marked && r.m1_readable_draft).length
    out[family] = {
      problems: list.length,
      clean_readable: clean,
      marked_readable: marked,
      blocked: list.filter(r => r.grade === 'BLOCKED').length,
      // W8.6-E3: M2 is delivery-conditioned (null without a deliverable) —
      // sum only over delivered records, and say how many contributed.
      silent_errors_total: list.filter(r => typeof r.m2_silent_errors === 'number').reduce((a, r) => a + r.m2_silent_errors, 0),
      silent_errors_measured_on: list.filter(r => typeof r.m2_silent_errors === 'number').length,
      m4_avg: list.length === 0 ? 0 : Math.round((list.reduce((a, r) => a + r.m4_skeleton_ratio, 0) / list.length) * 1000) / 1000,
      m5_usable: list.filter(r => r.m5_figure_usable).length,
    }
  }
  return out
}

/** The forbidden blended total — exported only so negative-control NC-1
 *  can prove the guard exists. Never call this in the reporting path. */
export function forbiddenBlendedTotal(records) {
  return records.filter(r => r.m1_readable_draft).length / records.length
}

/** Run over bench/results/<problemId>/run-report.json + report.md, where
 *  <problemId> uses the MANIFEST key (e.g. "2024-A" or "CUMCM-2024-A" —
 *  both resolve: the manifest is searched by exact id, then by
 *  "CUMCM-<id>" suffix). */
export async function computeFromResults() {
  const integrity = await verifyManifestIntegrity()
  if (!integrity.ok) {
    throw new Error(`bench manifest integrity FAILED (anti-cheat F): ${JSON.stringify(integrity.failures)}`)
  }
  const { manifest } = await loadManifest()
  // W8.10-A6 (O-L3-01): TWO truth sources existed and the record carried
  // only one of them, unlabelled.
  //   - `bench/MANIFEST.json` holds the PRE-REGISTRATION family (frozen at W1,
  //     "族已定，不得改"). It is the prior, not the answer.
  //   - `bench/TRUTH-FAMILIES.json` holds the human-annotated truth AFTER the
  //     W8.6 revision (2024-B: F3 -> F3+F4; 2024-C: F3 -> F3+F2), and it is
  //     what `route_truth` / `route_mismatch` must be judged against.
  // The old code read only MANIFEST, so `family` said 'F3' for 2024-B while
  // `route_truth` on the same record said 'F3+F4' — two fields disagreeing
  // about the truth inside one JSON object. Both are now carried, each named
  // for what it is.
  const preregisteredFamilies = new Map()
  const truthFamilies = new Map()
  const problemTexts = new Map()
  for (const p of [...(manifest.problems ?? []), ...(manifest.pending_placeholders ?? [])]) {
    preregisteredFamilies.set(p.id, p.family)
    if (!preregisteredFamilies.has(p.id.replace(/^CUMCM-/, ''))) preregisteredFamilies.set(p.id.replace(/^CUMCM-/, ''), p.family)
    for (const f of p.files ?? []) {
      if (f.path.endsWith('.md')) {
        problemTexts.set(p.id, join(benchRoot, f.path))
        problemTexts.set(p.id.replace(/^CUMCM-/, ''), join(benchRoot, f.path))
      }
    }
  }

  // The revised human truth (W8.6): the authority for route_truth comparison.
  try {
    const truth = JSON.parse(await readFile(join(benchRoot, 'TRUTH-FAMILIES.json'), 'utf8'))
    for (const p of truth.problems ?? []) truthFamilies.set(p.id, p.family)
  } catch { /* absent truth file: fall back to the preregistration label */ }

  const resultsDir = join(benchRoot, 'results')
  const entries = await readdir(resultsDir, { withFileTypes: true }).catch(() => [])
  const records = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const reportPath = join(resultsDir, entry.name, 'run-report.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8').catch(() => null) ?? 'null')
    // W8.6-E2: archived reports are immutable; a route-annotation.json
    // sidecar supplies facts learned after archiving (routed_family from
    // W8.5-E3). Never mutates the archive itself.
    if (report !== null) {
      const sidecar = JSON.parse(await readFile(join(resultsDir, entry.name, 'route-annotation.json'), 'utf8').catch(() => 'null') ?? 'null')
      if (sidecar !== null && report.routed_family === undefined) {
        report.routed_family = sidecar.routed_family ?? null
        report.route_truth = sidecar.route_truth ?? null
        report.route_mismatch = sidecar.route_mismatch ?? null
      }
    }
    // W8.5: a "<id>-real" directory is the SAME problem run with a real
    // provider (bench/results/2024-C-real) — resolve to the same family.
    const baseName = entry.name.replace(/-real(-shard)?$/, '')
    const lookups = [entry.name, `CUMCM-${entry.name}`, baseName, `CUMCM-${baseName}`]
    const firstOf = (map) => {
      for (const key of lookups) {
        const hit = map.get(key)
        if (hit !== undefined) return hit
      }
      return undefined
    }
    // W8.10-A6: `family` is the REVISED human truth (what the paper should be
    // judged against); `preregistered_family` preserves the frozen W1 prior.
    // Before this the field silently held the prior under the truth's name.
    const preregistered = firstOf(preregisteredFamilies) ?? '?'
    const family = firstOf(truthFamilies) ?? preregistered
    if (report === null) {
      records.push({ problem_id: entry.name, family, grade: 'NO-REPORT', missing: true })
      continue
    }
    const draftText = await readFile(join(resultsDir, entry.name, 'report.md'), 'utf8').catch(() => '')
    const problemTextPath = problemTexts.get(entry.name) ?? problemTexts.get(`CUMCM-${entry.name}`) ?? problemTexts.get(baseName)
    const problemText = problemTextPath === undefined ? '' : await readFile(problemTextPath, 'utf8').catch(() => '')
    records.push(computeProblemMetrics(
      entry.name,
      family,
      report,
      draftText,
      problemText,
      { ...(report.meta ?? {}), preregistered_family: preregistered },
    ))
  }
  return { integrity, records, per_family: aggregatePerFamily(records), generated_from: resultsDir }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  computeFromResults()
    .then((out) => {
      console.log(JSON.stringify(out, null, 2))
    })
    .catch((err) => {
      console.error(`metrics: ${err.message}`)
      process.exitCode = 1
    })
}
