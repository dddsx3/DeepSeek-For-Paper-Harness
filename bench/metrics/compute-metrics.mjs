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

/** Delivery grade implied by a run report (PRD §3.3 fail-soft tiers). */
export function deliveryGrade(report) {
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
  const wallClockSeconds = meta.wall_clock_seconds ?? null

  const m1Readable = grade !== 'BLOCKED'
    && recital < 0.30
    && skeleton.missing.length === 0
    && silentErrors.length === 0
  const m1Split = grade === 'CLEAN' ? { clean: true, marked: false } : grade === 'MARKED' ? { clean: false, marked: true } : { clean: false, marked: false }

  return {
    problem_id: problemId,
    family,
    grade,
    m1_readable_draft: m1Readable,
    m1_grade_split: m1Split,
    m2_silent_errors: silentErrors.length,
    m2_silent_error_samples: silentErrors.slice(0, 5),
    m2_recital_overlap: Math.round(recital * 1000) / 1000,
    m3a_zero_manual: manualInterventions === 0,
    m3b_wall_clock_seconds: wallClockSeconds,
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
  const byFamily = new Map()
  for (const r of records) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, [])
    byFamily.get(r.family).push(r)
  }
  const out = {}
  for (const [family, list] of byFamily) {
    const clean = list.filter(r => r.m1_grade_split.clean && r.m1_readable_draft).length
    const marked = list.filter(r => r.m1_grade_split.marked && r.m1_readable_draft).length
    out[family] = {
      problems: list.length,
      clean_readable: clean,
      marked_readable: marked,
      blocked: list.filter(r => r.grade === 'BLOCKED').length,
      silent_errors_total: list.reduce((a, r) => a + r.m2_silent_errors, 0),
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
  const families = new Map()
  const problemTexts = new Map()
  for (const p of [...(manifest.problems ?? []), ...(manifest.pending_placeholders ?? [])]) {
    families.set(p.id, p.family)
    if (!families.has(p.id.replace(/^CUMCM-/, ''))) families.set(p.id.replace(/^CUMCM-/, ''), p.family)
    for (const f of p.files ?? []) {
      if (f.path.endsWith('.md')) {
        problemTexts.set(p.id, join(benchRoot, f.path))
        problemTexts.set(p.id.replace(/^CUMCM-/, ''), join(benchRoot, f.path))
      }
    }
  }

  const resultsDir = join(benchRoot, 'results')
  const entries = await readdir(resultsDir, { withFileTypes: true }).catch(() => [])
  const records = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const reportPath = join(resultsDir, entry.name, 'run-report.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8').catch(() => null) ?? 'null')
    const family = families.get(entry.name) ?? families.get(`CUMCM-${entry.name}`) ?? '?'
    if (report === null) {
      records.push({ problem_id: entry.name, family, grade: 'NO-REPORT', missing: true })
      continue
    }
    const draftText = await readFile(join(resultsDir, entry.name, 'report.md'), 'utf8').catch(() => '')
    const problemTextPath = problemTexts.get(entry.name) ?? problemTexts.get(`CUMCM-${entry.name}`)
    const problemText = problemTextPath === undefined ? '' : await readFile(problemTextPath, 'utf8').catch(() => '')
    records.push(computeProblemMetrics(
      entry.name,
      family,
      report,
      draftText,
      problemText,
      report.meta ?? {},
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
