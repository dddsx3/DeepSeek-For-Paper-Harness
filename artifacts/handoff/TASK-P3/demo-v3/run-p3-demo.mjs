#!/usr/bin/env node
/**
 * P3 demo v3 — executor-authoritative FORMAL demo + corpus v3 (CI body).
 *
 * Same entry as demo v2 (the executor IS the only entry; strict-mode
 * nine-gate delivery promotes to a real file). Corpus v3: legal 5 (P2
 * quartet + ROUNDED-LEGAL, the P3-2 declaration leaf) must DELIVER with
 * FBR 0/5 AND semantic false-kill rate 0/5; wrong 6 (SEMANTIC-OVERCLAIM /
 * ROUND-ESCAPE / DUP-FIGURE / TOO-GOOD-V2 / CAPTION-ESCAPE / OVER-PROMISE)
 * must be KILLED — any green kill is exit non-zero (kills never expire
 * with the version bump, 禁9, script-level).
 *
 * F1 (P3-5): summary messages are REDACTED before writing — run/node ids
 * (UUIDs) become fixed placeholders so a re-run is byte-identical (G8
 * "重跑零脏" now literally holds for the committed summary).
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-P3/demo-v3/run-p3-demo.mjs
 * Exit 0 = corpus green.
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
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../../../../packages/paper/paper-foundation/src/index.ts'
import { ModelingIr } from '../../../../packages/paper/paper-foundation/src/ir/store.ts'
import { legalCases, wrongCases } from './cases.mjs'

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

/** F1 (P3-5): redact run/node ids (UUIDs) to fixed placeholders so a
 *  re-run writes a byte-identical summary (G8 重跑零脏). */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
function redact(text) {
  return String(text).replace(UUID_RE, '<redacted-id>')
}

/** Run one container through the executor as the single entry. */
async function runLeaf(containerJson) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request) => {
      const system = String(request.system ?? '')
      if (system.includes('reviewer')) return stream('{"defects":[]}')
      if (system.includes('editor')) return stream('revised text')
      const joined = (request.messages ?? [])
        .map((m) => {
          const c = m?.content
          if (typeof c === 'string') return c
          if (Array.isArray(c)) return c.map((p) => (p?.type === 'text' ? p.text ?? '' : '')).join('')
          return ''
        })
        .join(' ')
      if (joined.includes('numbered execution plan')) return stream('1. measure along the survey line')
      if (joined.includes('ir-container-v1')) return stream(containerJson)
      return stream('revised text')
    },
  })
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-p3demo-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic demo', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:p3demo' })
  try {
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'estimate the quantity')
    return { ok: true, ctx, ir, engine, runId: String(run.id), finalRoot, outcome }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), ctx, ir, engine, runId: String(run.id), finalRoot }
  }
}

async function main() {
  const summary = { legal: [], wrong: [], falseBlockRate: null, semanticFalseKillRate: null }
  let exit = 0

  for (const container of legalCases) {
    try {
      const result = await runLeaf(container)
      if (!result.ok) {
        summary.legal.push({ id: 'unknown', status: 'FALSE_BLOCK', message: redact(result.error) })
        exit = 1
        continue
      }
      const engine = result.engine
      const runStatus = engine.getRun(RunId(result.runId))?.status
      if (runStatus !== 'completed') {
        summary.legal.push({ id: 'unknown', status: 'FALSE_BLOCK', message: redact(`run status ${String(runStatus)}`) })
        exit = 1
        continue
      }
      const finalDir = join(result.finalRoot, result.runId, 'final')
      const files = await readdir(finalDir)
      const report = await readFile(join(finalDir, files[0]), 'utf8')
      const parsed = JSON.parse(container)
      const id = String(parsed.narrative?.title ?? 'leaf')
      const caseOut = join(OUT_ROOT, id)
      mkdirSync(caseOut, { recursive: true })
      await writeFile(join(caseOut, 'report.md'), report, 'utf8')
      await writeFile(join(caseOut, 'sha256.txt'), sha256(report), 'utf8')
      // Keep the figure's real bytes as files too, when the leaf has one.
      const figureRecords = result.ir.list().filter(r => r.kind === 'FigureSpec')
      if (figureRecords.length > 0) {
        const figs = join(caseOut, 'figures')
        mkdirSync(figs, { recursive: true })
        const { figureRenderInput, renderFigureSvg } = await import('../../../../packages/paper/paper-foundation/src/figure/renderer.ts')
        const snap = ModelingIr.snapshot(result.ir)
        for (const figure of figureRecords) {
          const fig = figure.value
          const input = snap === null ? null : figureRenderInput(snap, {
            data_refs: fig.data_refs,
            ...(fig.chart_type === undefined ? {} : { chart_type: fig.chart_type }),
            ...(fig.caption === undefined ? {} : { caption: fig.caption }),
          })
          if (input?.ok === true) {
            const svg = renderFigureSvg(input.input)
            await writeFile(join(figs, `${fig.figure_id}.svg`), svg, 'utf8')
            await writeFile(join(figs, `${fig.figure_id}.sha256`), sha256(svg), 'utf8')
          }
        }
      }
      summary.legal.push({ id, status: 'PASS', sha256: sha256(report) })
      console.log(`[PASS] ${id}: delivered report.md sha256=${sha256(report).slice(0, 16)}…`)
    } catch (error) {
      summary.legal.push({ id: 'unknown', status: 'ERROR', message: redact(String(error)) })
      exit = 1
    }
  }

  for (const container of wrongCases) {
    const result = await runLeaf(container)
    if (result.ok && result.engine?.getRun(RunId(result.runId))?.status === 'completed') {
      summary.wrong.push({ id: 'escape', status: 'ESCAPED' })
      exit = 1
      continue
    }
    const parsed = JSON.parse(container)
    const id = String(parsed.narrative?.title ?? 'leaf')
    summary.wrong.push({ id, status: 'KILLED', message: redact(result.ok ? `run ${String(result.engine?.getRun(RunId(result.runId))?.status)}` : (result.error?.split('\n')[0] ?? '')) })
    console.log(`[KILL] ${id}: refused (run not completed)`)
  }

  const legalPass = summary.legal.filter(c => c.status === 'PASS').length
  summary.falseBlockRate = `${legalCases.length - legalPass}/${legalCases.length}`
  // FBR 双口径: 结构 FBR + 语义误杀率 (evidenced semantic findings on legal leaves).
  // The fake reviewer returns a clean verdict, so any semantic false-kill
  // would have to be minted by the harness itself — 0 expected; recorded so
  // a future regression is visible in the summary, not just in the specs.
  const semanticFalseKills = summary.legal.filter(c => (c.message ?? '').includes('semantic')).length
  summary.semanticFalseKillRate = `${semanticFalseKills}/${legalCases.length}`
  const killed = summary.wrong.filter(c => c.status === 'KILLED').length
  console.log(`\nlegal PASS ${legalPass}/${legalCases.length} (False Block Rate ${summary.falseBlockRate}; semantic false-kill ${summary.semanticFalseKillRate})`)
  console.log(`wrong KILLED ${killed}/${wrongCases.length}`)
  mkdirSync(OUT_ROOT, { recursive: true })
  await writeFile(join(OUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  if (legalPass !== legalCases.length || killed !== wrongCases.length || exit !== 0) {
    console.error('P3 demo v3: not all legal leaves delivered and/or not all wrong leaves killed')
    process.exitCode = 1
  } else {
    console.log('P3 demo v3: corpus green — executor authoritative path with semantic/representation/figure layers')
    process.exitCode = 0
  }
}

const watchdog = setInterval(() => { /* keep event loop alive */ }, 30_000)
main()
  .catch((error) => {
    console.error('P3 demo v3 crashed:', error)
    process.exitCode = 1
  })
  .finally(() => clearInterval(watchdog))
