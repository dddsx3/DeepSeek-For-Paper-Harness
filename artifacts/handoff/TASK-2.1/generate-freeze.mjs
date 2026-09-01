#!/usr/bin/env node
/**
 * TASK 2.1 PHASE 0 — Evidence Freeze Snapshot generator.
 *
 * Builds the canonical example IR (the TASK 1.5/1.5R/2 fixture chain),
 * freezes it with `buildEvidenceFreeze`, verifies the freeze with a real
 * `auditEvidenceFreeze` run (must PASS), and emits the four handoff
 * artifacts:
 *
 *   evidence-freeze-manifest.json  — the frozen manifest itself
 *   freeze-hash-report.json        — the out-of-band hash registry
 *   evidence-chain-map.md          — human-readable chain map with hashes
 *   (audit-checklist.md is static documentation, not generated here)
 *
 * Usage (via tsx so the TS source imports resolve):
 *   node_modules/.bin/tsx artifacts/handoff/TASK-2.1/generate-freeze.mjs <repo-root>
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve as pathResolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ? pathResolve(process.argv[2]) : pathResolve(__dirname, '..', '..', '..')

const irIndexUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/src/ir/index.ts')).href
const fixturesUrl = pathToFileURL(join(repoRoot, 'packages/paper/paper-foundation/tests/ir/fixtures.ts')).href

const { ModelingIr, buildEvidenceFreeze, auditEvidenceFreeze } = await import(irIndexUrl)
const { backboneIr } = await import(fixturesUrl)

const NOW = () => '2026-09-01T00:00:00.000Z'

// 1. Build the canonical example store (the frozen subject).
const ir = backboneIr()
const store = ModelingIr.snapshot(ir)
if (store === null) throw new Error('backboneIr() did not produce a canonical store')

// 2. Freeze it.
const manifest = buildEvidenceFreeze(store, { now: NOW })

// 3. Verify the freeze with a real audit (must PASS).
const report = auditEvidenceFreeze(store, manifest)
if (report.status !== 'PASS') {
  console.error('freeze audit did not PASS:', JSON.stringify(report, null, 2))
  process.exit(1)
}

// 4. Emit evidence-freeze-manifest.json
writeFileSync(
  join(__dirname, 'evidence-freeze-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
  'utf8',
)

// 5. Emit freeze-hash-report.json — the out-of-band hash registry.
const hashReport = {
  report_version: 1,
  generated_at: manifest.generated_at,
  generated_from: {
    fixture: 'tests/ir/fixtures.ts validChain() (TASK 1.5/1.5R/2 canonical example chain)',
    store_objects: store.size,
    repo: 'deepseek-harness',
  },
  algorithm: {
    canonical_json: 'sorted object keys, array order preserved, no whitespace; -0 serialises as 0',
    chain_hash: 'sha256(canonicalJson({ claim, evidence_refs, results, run_reference })) per claim',
    freeze_hash: 'sha256(canonicalJson({ claims, results, runs }))',
    manifest_hash: 'sha256(canonicalJson({ manifest_version, freeze_hash, claims, results, runs }))',
    environment_hash: "sha256(canonicalJson({ environment, seed })) — freeze-time fingerprint of DECLARED metadata, not a proof of execution (TASK 3)",
    dependency_lock_hash: 'sha256(canonicalJson({ input_data_refs, parameter_refs, assumptions })) — same caveat',
  },
  freeze_hash: manifest.freeze_hash,
  manifest_hash: manifest.manifest_hash,
  claims: manifest.claims.map(c => ({
    claim_id: c.claim_id,
    critical: c.critical,
    evidence_chain_hash: c.evidence_chain_hash,
  })),
  verification: {
    audit_id: report.audit_id,
    status: report.status,
    claims_checked: report.claims_checked,
    failures: report.failures,
  },
  usage: {
    auditor_entry: 'auditEvidenceFreeze(ModelingIr.snapshot(ir), manifest)',
    anchor_rule: 'An external auditor must receive manifest_hash out-of-band (this file) and refuse any audit whose report.manifest_hash differs. Producer agent ≠ auditor agent (RT-E4).',
  },
}
writeFileSync(join(__dirname, 'freeze-hash-report.json'), JSON.stringify(hashReport, null, 2) + '\n', 'utf8')

// 6. Emit evidence-chain-map.md — the human-readable chain map.
const c = manifest.claims[0]
const r = manifest.results[0]
const run = manifest.runs[0]
const chainMap = `# Evidence Chain Map — TASK 2.1 Freeze Snapshot

> Frozen at \`${manifest.generated_at}\` from the canonical example chain
> (\`tests/ir/fixtures.ts validChain()\`). Every hash below is sha256 over
> the canonical JSON defined in \`freeze-hash-report.json → algorithm\`.

## Chain at a glance

\`\`\`
Claim C1 (${c.claim_type}/${c.criticality})
  ├─ text (presentational, never a number source)
  ├─ numeric_binding ─→ result_ref RES1, asserted_value ${c.numeric_binding.asserted_value}, asserted_unit '${c.numeric_binding.asserted_unit}'
  ├─ evidence_refs ───→ [${c.evidence_refs.join(', ')}]
  └─ result_refs ─────→ [${c.result_refs.join(', ')}]
        │
Result RES1  value=${r.value} unit='${r.unit}'
  ├─ producer ────→ ${r.producer}
  └─ run_ref ─────→ RUN1
        │
Run RUN1
  ├─ model_ref ─────────────→ M1 (→ ProblemSpec P1)
  ├─ code_hash ─────────────→ ${run.code_hash.slice(0, 24)}…
  ├─ environment_hash ──────→ ${run.environment_hash.slice(0, 24)}…
  └─ dependency_lock_hash ──→ ${run.dependency_lock_hash.slice(0, 24)}…
\`\`\`

## Frozen fingerprints

| Object | id | fingerprint | value |
|--------|----|-------------|-------|
| Manifest | — | \`manifest_hash\` | \`${manifest.manifest_hash}\` |
| Freeze content | — | \`freeze_hash\` | \`${manifest.freeze_hash}\` |
| Claim | ${c.claim_id} | \`evidence_chain_hash\` | \`${c.evidence_chain_hash}\` |
| Result | ${r.result_id} | value/unit | \`${r.value} ${r.unit}\` |
| Run | ${run.run_id} | code_hash | \`${run.code_hash.slice(0, 32)}…\` |

## Independent verification

Any auditor can re-derive every fingerprint:

\`\`\`ts
import { ModelingIr, buildEvidenceFreeze, auditEvidenceFreeze } from '<pkg>/src/ir/index.ts'

const store = ModelingIr.snapshot(ir)          // read-only view
const report = auditEvidenceFreeze(store, manifest)
// report.status === 'PASS'  ⇔  every frozen chain hash re-derived unchanged
\`\`\`

Verify the manifest itself against the out-of-band registry
(\`freeze-hash-report.json\`): \`report.manifest_hash\` MUST equal the
registered \`manifest_hash\`. A self-consistent but fabricated manifest
re-frozen from tampered evidence carries a different \`manifest_hash\` —
that difference is the RT-E4 trust boundary (producer ≠ auditor).
`
writeFileSync(join(__dirname, 'evidence-chain-map.md'), chainMap, 'utf8')

console.log('wrote evidence-freeze-manifest.json / freeze-hash-report.json / evidence-chain-map.md')
console.log(`manifest_hash = ${manifest.manifest_hash}`)
console.log(`audit: ${report.status} (${report.claims_checked} critical claim(s), ${report.failures.length} failures)`)