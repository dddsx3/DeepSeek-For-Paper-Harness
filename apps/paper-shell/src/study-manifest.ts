/**
 * TASK-P2-B — the study manifest: freeze, verify, and never five-systems.
 *
 * A user study runs against a FROZEN system image. The manifest is that
 * image's content address: git commit, engine/gate versions, route class,
 * sampling parameters, per-user tier + problem hashes, the four hard
 * budgets, and the sha256 of the exact teaching faces the model saw (T3
 * template + T3.5 move protocol). `buildStudyManifest` mints it;
 * `verifyStudyManifest` re-derives every content field from the CURRENT
 * tree and refuses with a precise drift list on ANY mismatch — so a hot
 * fix mid-study cannot masquerade as the same system (禁 P2-B #4): the
 * study either continues on the frozen image or becomes Study Batch B.
 *
 * Credentials NEVER enter the manifest: the endpoint is a CLASS
 * (e.g. 'openai-compatible-relay'), never a URL with a key.
 *
 * @module apps/paper-shell/src/study-manifest
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import {
  defaultTemplateCandidates,
  expandSelectTeaching,
  seedCandidates,
  templateFillPrompt,
} from '@deepseek-ai/dsh-paper-foundation'

/** Manifest document (versioned). */
export interface StudyManifest {
  readonly manifest_version: 1
  readonly study_id: string
  /** ISO timestamp of the freeze. */
  readonly frozen_at: string
  /** The commit the study freezes — must precede every user run. */
  readonly git_commit: string
  /** Engine contract versions. */
  readonly engine: {
    readonly fingerprint_namespaces: ReadonlyArray<string>
    /** gate-report baseline at freeze (files / total tests). */
    readonly gate_baseline: { readonly files: number; readonly total_tests: number }
  }
  /** Route CLASS — model id allowed, endpoint URL/key never. */
  readonly route: {
    readonly provider_class: string
    readonly model: string
  }
  readonly sampling: {
    readonly temperature: number
    readonly stream: boolean
  }
  readonly users: ReadonlyArray<{
    readonly user_id: string
    readonly tier: 'T1' | 'T2' | 'T3' | 'T3.5'
    readonly problem_file: string
    readonly problem_sha256: string
  }>
  /** The four hard budgets (TASK-Q2 UsageBudget semantics). */
  readonly budgets: {
    readonly max_model_calls: number
    readonly max_input_tokens: number
    readonly max_output_tokens: number
    readonly max_cost_cny: number
  }
  readonly shell_version: string
  /** Content hashes of the teaching faces. */
  readonly teaching: {
    readonly t3_template_sha256: string
    readonly t35_teaching_sha256: string
  }
  /** sha256 over the manifest minus this field (canonical JSON). */
  readonly manifest_hash: string
}

/** Deterministic JSON for hashing (sorted keys, no whitespace). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value === null || value === undefined || typeof value !== 'object') {
    return typeof value === 'string' ? JSON.stringify(value) : String(value)
  }
  const source = value as Record<string, unknown>
  return `{${Object.keys(source).sort()
    .filter(key => source[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * The manifest stores problem paths RELATIVE to the manifest's directory.
 * The builder is told a manifest directory; a user's absolute path under it
 * is relativised, anything else is kept verbatim (the caller then owns the
 * layout — the hash still pins the content).
 */
function relativeProblemFile(problemFile: string, manifestDir?: string): string {
  if (manifestDir === undefined) return problemFile
  const rel = relative(manifestDir, problemFile)
  return rel.startsWith('..') ? problemFile : rel
}

/** The canonical teaching faces' content hashes (the current tree's). */
export function teachingHashes(): { t3: string; t35: string } {
  return {
    t3: sha256(templateFillPrompt(defaultTemplateCandidates())),
    t35: sha256(expandSelectTeaching(seedCandidates(), ['json_path', 'unit', 'assumption'])),
  }
}

/** Hash one problem file's bytes. */
export function problemHash(path: string): string {
  return sha256(readFileSync(path, 'utf8'))
}

/** Mint the manifest. Inputs are caller-verified facts, not guesses. */
export function buildStudyManifest(inputs: {
  study_id: string
  git_commit: string
  frozen_at: string
  gate_baseline: { files: number; total_tests: number }
  fingerprint_namespaces: ReadonlyArray<string>
  route: { provider_class: string; model: string }
  sampling: { temperature: number; stream: boolean }
  users: ReadonlyArray<{ user_id: string; tier: 'T1' | 'T2' | 'T3' | 'T3.5'; problem_file: string }>
  budgets: StudyManifest['budgets']
  shell_version: string
  /** Directory the manifest itself will live in (relativises user paths). */
  manifest_dir?: string
}): StudyManifest {
  const teaching = teachingHashes()
  const withoutHash = {
    manifest_version: 1 as const,
    study_id: inputs.study_id,
    frozen_at: inputs.frozen_at,
    git_commit: inputs.git_commit,
    engine: {
      fingerprint_namespaces: [...inputs.fingerprint_namespaces],
      gate_baseline: { ...inputs.gate_baseline },
    },
    route: { ...inputs.route },
    sampling: { ...inputs.sampling },
    users: inputs.users.map(u => ({
      user_id: u.user_id,
      tier: u.tier,
      // The manifest records the problem path RELATIVE to the manifest's
      // own directory (the CLI passes that directory as problem_files_root)
      // — absolute paths differ across machines and would break the frozen
      // hash; the CONTENT hash is the identity.
      problem_file: relativeProblemFile(u.problem_file, inputs.manifest_dir),
      problem_sha256: problemHash(u.problem_file),
    })),
    budgets: { ...inputs.budgets },
    shell_version: inputs.shell_version,
    teaching: { t3_template_sha256: teaching.t3, t35_teaching_sha256: teaching.t35 },
  }
  return { ...withoutHash, manifest_hash: sha256(canonicalJson(withoutHash)) }
}

/** Verify result: a full drift list, never a bare boolean. */
export interface VerifyResult {
  readonly ok: boolean
  readonly drifts: ReadonlyArray<{ readonly field: string; readonly frozen: string; readonly current: string }>
}

/**
 * Re-derive every content field against the CURRENT tree. Any drift —
 * tampered manifest, changed teaching, hot-fixed sampling, moved problem
 * file — lands in the drift list; `ok` is false on ANY entry.
 * `current.git_commit` comes from the caller (the CLI runs git).
 */
export function verifyStudyManifest(
  manifest: StudyManifest,
  current: {
    git_commit: string
    fingerprint_namespaces: ReadonlyArray<string>
    gate_baseline: { files: number; total_tests: number }
    model: string
    problem_files_root?: string
  },
): VerifyResult {
  const drifts: Array<{ field: string; frozen: string; current: string }> = []
  const push = (field: string, frozen: string, actual: string) => {
    drifts.push({ field, frozen, current: actual })
  }

  // 1. Manifest self-integrity: the freeze-hash IS the anchor. A mismatch
  //    is reported as its own drift line, but per-field checks CONTINUE —
  //    the drift list must name every field the tamperer touched, not hide
  //    behind the anchor.
  const { manifest_hash: _mh, ...rest } = manifest
  const recomputed = sha256(canonicalJson(rest))
  if (recomputed !== manifest.manifest_hash) {
    push('manifest_hash', manifest.manifest_hash, recomputed)
  }
  if (manifest.manifest_version !== 1) push('manifest_version', '1', String(manifest.manifest_version))
  if (current.git_commit !== manifest.git_commit) push('git_commit', manifest.git_commit, current.git_commit)

  // 2. Engine contract versions.
  const frozenNs = [...manifest.engine.fingerprint_namespaces].sort().join('|')
  const currentNs = [...current.fingerprint_namespaces].sort().join('|')
  if (frozenNs !== currentNs) push('engine.fingerprint_namespaces', frozenNs, currentNs)
  if (manifest.engine.gate_baseline.total_tests !== current.gate_baseline.total_tests
    || manifest.engine.gate_baseline.files !== current.gate_baseline.files) {
    push('engine.gate_baseline',
      `${manifest.engine.gate_baseline.files}/${manifest.engine.gate_baseline.total_tests}`,
      `${current.gate_baseline.files}/${current.gate_baseline.total_tests}`)
  }

  // 3. Route + sampling (a hot-fixed temperature is a different system).
  if (manifest.route.model !== current.model) push('route.model', manifest.route.model, current.model)
  if (manifest.sampling.temperature !== 0.2) push('sampling.temperature', '0.2 (protocol)', String(manifest.sampling.temperature))

  // 4. Teaching faces: recompute from THIS tree's canonical builders.
  const teaching = teachingHashes()
  if (manifest.teaching.t3_template_sha256 !== teaching.t3) push('teaching.t3_template_sha256', manifest.teaching.t3_template_sha256, teaching.t3)
  if (manifest.teaching.t35_teaching_sha256 !== teaching.t35) push('teaching.t35_teaching_sha256', manifest.teaching.t35_teaching_sha256, teaching.t35)

  // 5. Problem files: recompute every user's problem hash from the tree.
  for (const user of manifest.users) {
    const path = current.problem_files_root !== undefined
      ? `${current.problem_files_root}/${user.problem_file}`
      : user.problem_file
    let actual: string
    try {
      actual = problemHash(path)
    } catch {
      actual = '(file missing)'
    }
    if (actual !== user.problem_sha256) {
      push(`users[${user.user_id}].problem_sha256`, user.problem_sha256, actual)
    }
  }

  return { ok: drifts.length === 0, drifts }
}
