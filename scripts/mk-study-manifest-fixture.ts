import { buildStudyManifest } from '../apps/paper-shell/src/study-manifest.ts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
// The problem file must exist BEFORE the manifest build hashes it.
mkdirSync('artifacts/handoff/TASK-P2/study-manifest/problems', { recursive: true })
writeFileSync('artifacts/handoff/TASK-P2/study-manifest/problems/user-1.md', '# pilot problem\nEstimate the mean sea-ice thickness.', 'utf8')
const manifest = buildStudyManifest({
  study_id: 'STUDY-A-PILOT',
  git_commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  frozen_at: new Date().toISOString(),
  gate_baseline: { files: 99, total_tests: 1105 },
  fingerprint_namespaces: ['DEP-EDGE-v1', 'ASSUMPTION-v1', 'EQUATION-v1', 'MODEL-v1'],
  route: { provider_class: 'openai-compatible-relay', model: 'z-ai/glm-5.3-flash' },
  sampling: { temperature: 0.2, stream: false },
  users: [
    { user_id: 'user-1', tier: 'T3', problem_file: resolve('artifacts/handoff/TASK-P2/study-manifest/problems/user-1.md') },
  ],
  budgets: { max_model_calls: 60, max_input_tokens: 1_000_000, max_output_tokens: 400_000, max_cost_cny: 25 },
  shell_version: 'paper-shell v0 (TASK-M1)',
  manifest_dir: resolve('artifacts/handoff/TASK-P2/study-manifest'),
})
writeFileSync('artifacts/handoff/TASK-P2/study-manifest/study-manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log('manifest written:', manifest.manifest_hash.slice(0, 16))
