#!/usr/bin/env node
/**
 * TASK-PW W6 — demo v4: 层注册演示 (tier registry demo) + corpus v4.
 *
 * corpus v4 keeps T1 全叶 (the P3 legal leaves unchanged through the
 * executor) and ADDS T2/T3 正例 (guided-step wizard / template fill-in), so
 * the same report bytes are reachable from every protocol tier. After the
 * runs the demo reads each leaf's executed tier back OFF the executor's
 * registry surface (initialTier config per leaf) and writes a 层注册表
 * (per-leaf {id, tier, status, sha256}) — the W5 combination-registry
 * discipline's demo face.
 *
 *   T1 leaves (5): the corpus-v3 legal leaves, one-shot containers.
 *   T2 leaves (2): three guided steps scripted per leaf (run 声明 → Result
 *                  声明 → claims 引用) — 与 T1 等价交付 (same sha256).
 *   T3 leaves (2): one closed fill-in per leaf — 与 T1 等价交付 (same sha256).
 *
 * The T2/T3 equivalence baseline is the EXACT container the harness
 * assembles from the scripted steps / fill (assembleGuidedContainer /
 * assembleTemplateContainer), run one-shot through the executor at T1:
 * "the wizard-assembled container, declared in one shot, yields the same
 * report" — that is the W2/W3 同信任链 claim made byte-exact.
 *
 * Fake-only (禁 7: real tiers need the probe, not the demo). FBR 0/9;
 * wrong leaves (bypass / free number) are exercised by the unit specs.
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-PW/demo-v4/run-demo-v4.mjs
 * Exit 0 = corpus green.
 *
 * @module artifacts/handoff/TASK-PW/demo-v4
 */

import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../../../../packages/paper/paper-foundation/src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../../../../packages/paper/paper-foundation/src/runtime/profile.ts'
import {
  admitGuidedStep,
  admitTemplateFill,
  assembleGuidedContainer,
  assembleTemplateContainer,
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  startGuidedSession,
  WorkflowEngineService,
} from '../../../../packages/paper/paper-foundation/src/index.ts'
import { ModelingIr } from '../../../../packages/paper/paper-foundation/src/ir/store.ts'
import { legalCaseDefs } from '../../TASK-P3/demo-v3/cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = join(here, 'output')

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}

async function* stream(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
function redact(text) {
  return String(text).replace(UUID_RE, '<redacted-id>')
}

/** The T2 step payloads for one quantity (deterministic; the same payloads
 *  are replayed through the exported protocol to build the T1 twin). */
function t2Steps(caseDef) {
  const key = caseDef.key
  const unit = caseDef.unit
  const claimText = caseDef.conclusion // corpus-curated; no stray unit literal
  return [
    JSON.stringify({ code: `const fs = require("node:fs"); fs.writeFileSync("result.json", JSON.stringify({ ${key}: ${caseDef.value} }));`, outputBasenames: ['result.json'], seed: caseDef.seed }),
    JSON.stringify({ results: [{ data_id: 'RES-OUT', locator: 'result.json', jsonPath: key, unit }] }),
    JSON.stringify({ claims: [{ claim_id: 'C-OUT', text: claimText, result_refs: ['RES-OUT'], criticality: 'CRITICAL' }] }),
  ]
}

/** The T3 fill-in payload — every slot from the harness candidate set. */
function t3Fill() {
  return JSON.stringify({ symbol_id: 'SYM-q', unit: 'm', output_file: 'result.json', json_path: 'mean_thickness' })
}

/** Replay the scripted steps through the exported T2 protocol to obtain the
 *  exact container the executor's wizard would assemble. */
function t2Assembled(caseDef, taskText) {
  let session = startGuidedSession()
  const steps = t2Steps(caseDef)
  for (const [index, step] of [[0, 1], [1, 2], [2, 3]]) {
    const admitted = admitGuidedStep(session, step, steps[index])
    if (!admitted.ok) throw new Error(`T2 replay step ${step} refused: ${admitted.reason}`)
    session = admitted.session
  }
  return assembleGuidedContainer(session, taskText)
}

/** Replay the fill through the exported T3 protocol to obtain the exact
 *  container the executor's fill-in would assemble. */
function t3Assembled(taskText) {
  const admitted = admitTemplateFill(t3Fill())
  if (!admitted.ok) throw new Error(`T3 replay fill refused: ${admitted.reason}`)
  return assembleTemplateContainer(admitted.fill, taskText)
}

/** A queued provider: EXECUTE-ish calls (guided-step / fill-in / container)
 *  consume the queue; plan/review/editor return canned text. */
function queuedProvider(outputs) {
  const seen = []
  let cursor = 0
  return {
    seen,
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request) => {
      const system = String(request.system ?? '')
      if (system.includes('reviewer')) return stream('{"defects":[]}')
      if (system.includes('editor')) return stream('revised text')
      const joined = (request.messages ?? [])
        .map((m) => {
          const c = m?.content
          if (typeof c === 'string') return c
          if (Array.isArray(c)) return c.map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('')
          return ''
        })
        .join(' ')
      seen.push(joined)
      if (joined.includes('numbered execution plan')) return stream('1. measure along the survey line')
      if (joined.includes('guided step') || joined.includes('T3 template fill-in') || joined.includes('ir-container-v1') || joined.includes('Produce the deliverable')) {
        const out = outputs[Math.min(cursor, outputs.length - 1)]
        cursor += 1
        return stream(out ?? '')
      }
      return stream('revised text')
    },
  }
}

/** Run one leaf through the executor at the given protocol tier. */
async function runLeaf(caseDef, tier, outputs) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', queuedProvider(outputs))
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-d4-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic demo', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
    initialTier: tier,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:d4' })
  try {
    await ctx.paperExecutor.runs.execute(RunId(run.id), `${caseDef.problem} (${caseDef.title})`)
    const finalDir = join(finalRoot, String(run.id), 'final')
    const files = await readdir(finalDir)
    if (files.length === 0) throw new Error('no final file')
    const report = await readFile(join(finalDir, files[0]), 'utf8')
    return { ok: true, report, engine, runId: String(run.id) }
  } catch (error) {
    const audit = ctx.paperAudit.list(String(run.id)).map(r => `${r.eventType} ${JSON.stringify(r.detail)}`).join('\n  ')
    return { ok: false, error: error instanceof Error ? error.message : String(error), engine, runId: String(run.id), audit }
  }
}

async function main() {
  const summary = { leaves: [], tierRegistry: [], falseBlockRate: null }
  let exit = 0

  const t1Leaves = legalCaseDefs.map(({ def, container }) => ({ id: def.id, tier: 'T1', def, outputs: [container] }))
  // T2/T3 positive leaves reuse the same cases (same report bytes as their
  // one-shot T1 twin — the harness-assembled container run at T1).
  const t2Leaves = legalCaseDefs.slice(0, 2).map(({ def }) => ({ id: `${def.id}-T2`, tier: 'T2', def, outputs: t2Steps(def) }))
  const t3Leaves = [legalCaseDefs[0], legalCaseDefs[4]].map(({ def }) => ({ id: `${def.id}-T3`, tier: 'T3', def, outputs: [t3Fill()] }))
  const leaves = [...t1Leaves, ...t2Leaves, ...t3Leaves]

  for (const leaf of leaves) {
    try {
      const taskText = `${leaf.def.problem} (${leaf.def.title})`
      const result = await runLeaf(leaf.def, leaf.tier, leaf.outputs)
      if (!result.ok) {
        summary.leaves.push({ id: leaf.id, tier: leaf.tier, status: 'FALSE_BLOCK', message: redact(result.error) })
        exit = 1
        continue
      }
      const baseId = leaf.id.replace(/-T[23]$/, '')
      const caseOut = join(OUT_ROOT, leaf.id)
      mkdirSync(caseOut, { recursive: true })
      await writeFile(join(caseOut, 'report.md'), result.report, 'utf8')
      await writeFile(join(caseOut, 'sha256.txt'), sha256(result.report), 'utf8')
      const leafRecord = { id: leaf.id, baseId, tier: leaf.tier, status: 'PASS', sha256: sha256(result.report) }
      summary.leaves.push(leafRecord)
      summary.tierRegistry.push({ ...leafRecord, meaning: tierMeaning(leaf.tier) })
      console.log(`[PASS] ${leaf.id} (${leaf.tier}): delivered sha256=${sha256(result.report).slice(0, 16)}...`)

      // T2/T3 正例: replay the same steps/fill through the exported protocol
      // and run the harness-assembled container one-shot at T1 — the report
      // bytes must be identical (同信任链, byte-exact).
      if (leaf.tier === 'T2' || leaf.tier === 'T3') {
        const assembled = leaf.tier === 'T2' ? t2Assembled(leaf.def, taskText) : t3Assembled(taskText)
        const twin = await runLeaf(leaf.def, 'T1', [assembled])
        if (!twin.ok) {
          summary.tierRegistry.push({ id: `${leaf.id}-T1EQ`, status: 'T1_TWIN_FALSE_BLOCK', baseId, message: redact(twin.error) })
          exit = 1
        } else {
          const twinSha = sha256(twin.report)
          summary.tierRegistry.push({ id: `${leaf.id}-T1EQ`, baseId, tier: 'T1', status: 'PASS', sha256: twinSha, meaning: `one-shot twin of ${leaf.id}` })
          if (twinSha !== leafRecord.sha256) {
            summary.tierRegistry.push({ id: `${leaf.id}-T1EQ`, status: 'TIER_MISMATCH', baseId, expected: leafRecord.sha256, actual: twinSha })
            exit = 1
          } else {
            console.log(`[EQ]   ${leaf.id} T1 twin sha256=${twinSha.slice(0, 16)}... (same report bytes across tiers)`)
          }
        }
      }
    } catch (error) {
      summary.leaves.push({ id: leaf.id, tier: leaf.tier, status: 'ERROR', message: redact(String(error)) })
      exit = 1
    }
  }

  const legalCount = leaves.length
  const passes = summary.leaves.filter(l => l.status === 'PASS')
  summary.falseBlockRate = `${legalCount - passes.length}/${legalCount}`
  console.log(`\nleaves DELIVERED ${passes.length}/${legalCount} (False Block Rate ${summary.falseBlockRate})`)
  console.log(`tier registry: ${summary.tierRegistry.map(r => `${r.tier ?? '?'}:${r.id}`).join(' ')}`)
  mkdirSync(OUT_ROOT, { recursive: true })
  await writeFile(join(OUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  if (passes.length !== legalCount || exit !== 0) {
    console.error('demo v4: not all leaves delivered across tiers')
    process.exitCode = 1
  } else {
    console.log('demo v4: corpus green — T1 all leaves + T2/T3 positive leaves deliver the same report bytes as their one-shot twins (层注册演示)')
    process.exitCode = 0
  }
}

function tierMeaning(tier) {
  return tier === 'T1' ? 'full declaration (one-shot container)'
    : tier === 'T2' ? 'guided steps (run → Result → claims wizard)'
      : 'template fill-in (smallest face, closed candidates)'
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => {
    console.error('demo v4 crashed:', error)
    process.exitCode = 1
  })
  .finally(() => clearInterval(watchdog))
