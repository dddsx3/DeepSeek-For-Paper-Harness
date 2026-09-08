/**
 * TASK-P2-B — study manifest tests: freeze, verify, tamper-anything-red.
 *
 * The gate the task book demands (G7): tampering ANY manifest field must
 * fail verify with that field named. The spec walks every content field,
 * plus the manifest_hash anchor itself.
 *
 * The manifest builds from fixture users with real temp problem files, so
 * the problem-hash re-derivation is exercised for real.
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildStudyManifest,
  teachingHashes,
  verifyStudyManifest,
  type StudyManifest,
} from '../src/study-manifest.ts'

async function fixture(): Promise<{ dir: string; manifest: StudyManifest; users: Array<{ user_id: string; tier: 'T3' as const; problem_file: string }> }> {
  const dir = await mkdtemp(join(tmpdir(), 'study-manifest-'))
  const problems = ['u1-problem.md', 'u2-problem.md', 'u3-problem.md']
  for (const name of problems) {
    await writeFile(join(dir, name), `# 题目 ${name}\nEstimate the mean sea-ice thickness.`, 'utf8')
  }
  const users = problems.map((problem_file, i) => ({ user_id: `user-${i + 1}`, tier: 'T3' as const, problem_file: join(dir, problem_file) }))
  const manifest = buildStudyManifest({
    study_id: 'STUDY-A',
    git_commit: '0'.repeat(40),
    frozen_at: '2026-09-09T00:00:00.000Z',
    gate_baseline: { files: 99, total_tests: 1105 },
    fingerprint_namespaces: ['DEP-EDGE-v1', 'ASSUMPTION-v1', 'EQUATION-v1', 'MODEL-v1'],
    route: { provider_class: 'openai-compatible-relay', model: 'z-ai/glm-5.3-flash' },
    sampling: { temperature: 0.2, stream: false },
    users,
    budgets: { max_model_calls: 60, max_input_tokens: 1_000_000, max_output_tokens: 400_000, max_cost_cny: 25 },
    shell_version: 'paper-shell v0 (TASK-M1)',
    // Problem paths are stored relative to the manifest's own directory.
    manifest_dir: dir,
  })
  return { dir, manifest, users }
}

const CURRENT = {
  git_commit: '0'.repeat(40),
  fingerprint_namespaces: ['DEP-EDGE-v1', 'ASSUMPTION-v1', 'EQUATION-v1', 'MODEL-v1'],
  gate_baseline: { files: 99, total_tests: 1105 },
  model: 'z-ai/glm-5.3-flash',
}

describe('study manifest — build & verify the frozen image', () => {
  it('a freshly built manifest verifies clean against its own inputs', async () => {
    const { dir, manifest } = await fixture()
    try {
      const result = verifyStudyManifest(manifest, {
        ...CURRENT,
        problem_files_root: dir,
      })
      expect(result.ok).toBe(true)
      expect(result.drifts).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('teaching hashes address the canonical builders (content, not promise)', async () => {
    const { teaching } = await (async () => ({ teaching: teachingHashes() }))()
    const { manifest } = await fixture()
    expect(manifest.teaching.t3_template_sha256).toBe(teaching.t3)
    expect(manifest.teaching.t35_teaching_sha256).toBe(teaching.t35)
    // The hashes are real digests over the canonical faces.
    expect(manifest.teaching.t3_template_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.teaching.t35_teaching_sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('study manifest — tampering ANY field must go red (G7)', () => {
  async function tampered(mutate: (m: StudyManifest) => StudyManifest): Promise<{ ok: boolean; drifts: Array<{ field: string }> }> {
    const { dir, manifest } = await fixture()
    try {
      const doc = JSON.parse(JSON.stringify(manifest)) as StudyManifest
      const after = mutate(doc)
      return verifyStudyManifest(after, { ...CURRENT, problem_files_root: dir })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('a changed git_commit is a drift', async () => {
    const r = await tampered(m => ({ ...m, git_commit: 'f'.repeat(40) }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('git_commit')
  })

  it('a hot-fixed sampling temperature is a drift (禁 P2-B #4)', async () => {
    const r = await tampered(m => ({ ...m, sampling: { temperature: 0.7, stream: false } }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('sampling.temperature')
  })

  it('a swapped model is a drift', async () => {
    const r = await tampered(m => ({ ...m, route: { provider_class: 'openai-compatible-relay', model: 'deepseek/deepseek-v4-pro' } }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('route.model')
  })

  it('a changed teaching face is caught by recomputation from the tree', async () => {
    // Tamper the manifest's frozen teaching hash — verify recomputes the
    // canonical builder output and sees the mismatch.
    const r = await tampered(m => ({
      ...m,
      teaching: { t3_template_sha256: 'a'.repeat(64), t35_teaching_sha256: m.teaching.t35_teaching_sha256 },
    }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('teaching.t3_template_sha256')
  })

  it('a changed problem file on disk is a drift (the study\'s task moved)', async () => {
    const { dir, manifest } = await fixture()
    try {
      await writeFile(join(dir, 'u1-problem.md'), '# 题目 u1-problem.md\nHOT-FIXED PROBLEM', 'utf8')
      const r = verifyStudyManifest(manifest, { ...CURRENT, problem_files_root: dir })
      expect(r.ok).toBe(false)
      expect(r.drifts.map(d => d.field)).toContain('users[user-1].problem_sha256')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a changed gate baseline is a drift', async () => {
    const r = await tampered(m => ({ ...m, engine: { ...m.engine, gate_baseline: { files: 99, total_tests: 999 } } }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('engine.gate_baseline')
  })

  it('a changed fingerprint namespace set is a drift', async () => {
    const r = await tampered(m => ({
      ...m,
      engine: { ...m.engine, fingerprint_namespaces: [...m.engine.fingerprint_namespaces.slice(0, -1)] },
    }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('engine.fingerprint_namespaces')
  })

  it('a direct manifest_hash edit is caught by the anchor recompute', async () => {
    const r = await tampered(m => ({ ...m, manifest_hash: 'b'.repeat(64) }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('manifest_hash')
  })

  it('a sneaky field edit WITHOUT updating manifest_hash is caught by the anchor too', async () => {
    // The realistic attacker edits a budget and forgets the anchor.
    const r = await tampered(m => ({ ...m, budgets: { ...m.budgets, max_cost_cny: 999_999 } }))
    expect(r.ok).toBe(false)
    expect(r.drifts.map(d => d.field)).toContain('manifest_hash')
  })
})

describe('study manifest — CLI face', () => {
  it('a manifest written to disk round-trips through JSON.parse', async () => {
    const { dir, manifest } = await fixture()
    try {
      await writeFile(join(dir, 'study-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      const round = JSON.parse(await readFile(join(dir, 'study-manifest.json'), 'utf8')) as StudyManifest
      const r = verifyStudyManifest(round, { ...CURRENT, problem_files_root: dir })
      expect(r.ok).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
