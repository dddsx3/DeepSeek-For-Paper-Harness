#!/usr/bin/env node
/**
 * P2 demo v2 — executor-authoritative FORMAL demo + corpus (CI body).
 *
 * The ENTRY is the executor: every leaf runs through PaperExecutorService
 * with produceFromExecute + produceRun mounted (deployment-owned code-run),
 * EXECUTE runs the production chain inside the stage, the review gate sees
 * the rendered v2 report, the strict-mode nine-gate delivery promotes it to
 * a REAL file under a temp final-output root.
 *
 * Legal leaves must DELIVER (P1 trio + FIGURED-ICE figure/slot leaf; FBR
 * baseline stays 0/4); wrong leaves must be KILLED (TOO-GOOD re-run on v2
 * slots; figure caption numeric escape).
 *
 * Usage: node_modules/.bin/tsx artifacts/handoff/TASK-P2/demo-v2/run-p2-demo.mjs
 * Exit 0 = corpus green. (top-level-await-safe: everything runs inside
 * main() with a watchdog and an explicit exit code.)
 */

import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync } from 'node:fs'
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
      if (joined.includes('Produce the deliverable')) return stream(containerJson)
      return stream('revised text')
    },
  })
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-p2demo-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic demo', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:p2demo' })
  try {
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'estimate the quantity')
    return { ok: true, ctx, ir, engine, runId: String(run.id), finalRoot, outcome }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), ctx, ir, engine, runId: String(run.id), finalRoot }
  }
}

async function main() {
  const summary = { legal: [], wrong: [], falseBlockRate: null }
  let exit = 0

  for (const container of legalCases) {
    try {
      const result = await runLeaf(container)
      if (!result.ok) {
        summary.legal.push({ id: 'unknown', status: 'FALSE_BLOCK', message: result.error })
        exit = 1
        continue
      }
      const engine = result.engine
      const runStatus = engine.getRun(RunId(result.runId))?.status
      if (runStatus !== 'completed') {
        summary.legal.push({ id: 'unknown', status: 'FALSE_BLOCK', message: `run status ${String(runStatus)}` })
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
      summary.legal.push({ id: 'unknown', status: 'ERROR', message: String(error) })
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
    summary.wrong.push({ id: String(parsed.narrative?.title ?? 'leaf'), status: 'KILLED', message: result.ok ? `run ${String(result.engine?.getRun(RunId(result.runId))?.status)}` : result.error?.split('\n')[0] })
    console.log(`[KILL] ${JSON.parse(container).narrative?.title}: refused (run not completed)`)
  }

  const legalPass = summary.legal.filter(c => c.status === 'PASS').length
  summary.falseBlockRate = `${legalCases.length - legalPass}/${legalCases.length}`
  const killed = summary.wrong.filter(c => c.status === 'KILLED').length
  console.log(`\nlegal PASS ${legalPass}/${legalCases.length} (False Block Rate ${summary.falseBlockRate})`)
  console.log(`wrong KILLED ${killed}/${wrongCases.length}`)
  mkdirSync(OUT_ROOT, { recursive: true })
  await writeFile(join(OUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  if (legalPass !== legalCases.length || killed !== wrongCases.length || exit !== 0) {
    console.error('P2 demo v2: not all legal leaves delivered and/or not all wrong leaves killed')
    process.exitCode = 1
  } else {
    console.log('P2 demo v2: corpus green — executor is the authoritative FORMAL path with figures + slots')
    process.exitCode = 0
  }
}

const watchdog = setInterval(() => { /* keep event loop alive */ }, 30_000)
main()
  .catch((error) => {
    console.error('P2 demo v2 crashed:', error)
    process.exitCode = 1
  })
  .finally(() => clearInterval(watchdog))
