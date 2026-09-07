/**
 * TASK-M1 M1-2 — paper shell CLI entry. `paper-shell run <problem-file>`.
 *
 * Command surface:
 *   paper-shell run <file> [--tier T1|T2|T3] [--mode fast|strict|exploratory]
 *                          [--out <dir>] [--zip] [--no-write]
 *   paper-shell explain <code>        — print the human sentence for a code
 *   paper-shell --version / --help
 *
 * The engine is mounted with a REAL provider route (OpenAI-compatible
 * endpoint; route from the PAPER_PROBE / DEEPSEEK / DSH_E2E_LLM env families
 * — no hardcoded vendor, P3D family) and produceFromExecute EXPLICITLY
 * enabled + audited (F5/M-B). The shell never re-implements engine
 * semantics: it reads the problem, delegates to the executor, and packs.
 *
 * @module apps/paper-shell/src/cli
 */

import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperProviderService,
  PaperRuntimeGuard,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  createExploratoryProfile,
} from '@deepseek-ai/dsh-paper-foundation'
import { ModelingIr } from '@deepseek-ai/dsh-paper-foundation'
import { resolveShellRoute, readProblemFile, blockMessage, type ShellRoute } from './invoke.ts'
import { streamCompletion } from './real-provider.ts'
import { CassetteRecorder, CassetteReplayer } from './cassette.ts'
import { zipTextFiles } from './zip.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** Parse `--k v` / `--flag` / positional args. */
export function parseArgs(argv: string[]): Record<string, unknown> & { positionals: string[] } {
  const positionals: string[] = []
  const flags: Record<string, unknown> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i += 1
      } else {
        flags[key] = true
      }
    } else {
      positionals.push(token)
    }
  }
  return { ...flags, positionals }
}

/** Build the full composition: storage + foundation + engine with real route. */
async function buildContext(shellRoot: string): Promise<{
  ctx: Context
  baseRoot: string
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const baseRoot = await mkdtemp(join(shellRoot, 'paper-shell-persist-'))
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(baseRoot)
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  await ctx.plugin(PaperProviderService)
  await ctx.plugin(PaperSettingsService, {
    executor: { provider: 'deepseek-official', model: 'placeholder', credentialRef: 'PAPER_PROBE_API_KEY', timeoutMs: 60_000 },
    reviewer: { provider: 'deepseek-official', model: 'placeholder', credentialRef: 'PAPER_PROBE_API_KEY', timeoutMs: 60_000 },
    editorAi: { provider: 'deepseek-official', model: 'placeholder', credentialRef: 'PAPER_PROBE_API_KEY', timeoutMs: 60_000 },
    defaultMode: 'strict',
  })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  return {
    ctx,
    baseRoot,
    dispose: async () => { await backend.close().catch(() => {}) },
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2))
  const positionals = parsed.positionals
  if (positionals.length === 0 && parsed.version === undefined && parsed.help === undefined) {
    console.error('usage: paper-shell run <problem-file> [--tier T1|T2|T3] [--mode fast|strict|exploratory] [--out <dir>] [--zip]')
    return 2
  }
  if (parsed.version !== undefined) {
    console.log('paper-shell v0 (TASK-M1)')
    return 0
  }
  const sub = positionals[0]
  if (sub === 'explain') {
    const code = positionals[1] ?? ''
    console.log(blockMessage('gate-failed', code, '').oneLine)
    return 0
  }
  if (sub !== 'run') {
    console.error(`unknown subcommand '${sub}'`)
    return 2
  }
  const problemFile = positionals[1]
  if (problemFile === undefined) {
    console.error('paper-shell run needs a problem file')
    return 2
  }
  const rawTier = String(parsed.tier ?? 'T3')
  const tier: 'T1' | 'T2' | 'T3' | undefined = (['T1', 'T2', 'T3'] as const).includes(rawTier as 'T1' | 'T2' | 'T3') ? rawTier as 'T1' | 'T2' | 'T3' : undefined
  if (tier === undefined) {
    console.error(`invalid --tier '${rawTier}' (expected T1|T2|T3)`)
    return 2
  }
  const rawMode = String(parsed.mode ?? 'strict')
  const mode: 'fast' | 'strict' | 'exploratory' | undefined = (['fast', 'strict', 'exploratory'] as const).includes(rawMode as 'fast' | 'strict' | 'exploratory') ? rawMode as 'fast' | 'strict' | 'exploratory' : undefined
  if (mode === undefined) {
    console.error(`invalid --mode '${rawMode}' (expected fast|strict|exploratory)`)
    return 2
  }
  const outDir = parsed.out !== undefined ? String(parsed.out) : join(here, 'out')
  const fake = parsed.fake === true || parsed.fake === 'true'
  // TASK-E: cassette record/replay. --cassette <file> records a REAL run's
  // every seam exchange; --replay <file> answers the seam from a cassette
  // (no network, no key). Exactly one of the three provider modes
  // (fake / real / replay) applies; cassette recording is real-mode only.
  const cassettePath = parsed.cassette !== undefined ? String(parsed.cassette) : undefined
  const replayPath = parsed.replay !== undefined ? String(parsed.replay) : undefined
  if (cassettePath !== undefined && (fake || replayPath !== undefined)) {
    console.error('--cassette (record) requires a real run: it is a recording of real provider answers')
    return 2
  }
  if (replayPath !== undefined && fake) {
    console.error('--replay and --fake are mutually exclusive (replay IS the offline mode, but from recorded real answers)')
    return 2
  }

  const route = resolveShellRoute(process.env)
  if (!fake && replayPath === undefined && (route === undefined || route.baseURL === '')) {
    console.error('no provider route: set PAPER_PROBE_API_KEY + PAPER_PROBE_BASE_URL (or DSH_E2E_LLM_*) — never a hardcoded vendor (P3D 中立变量族)')
    return 1
  }

  const { ctx, baseRoot, dispose } = await buildContext(here)
  if (!fake && replayPath === undefined) {
    if (route === undefined) {
      // Unreachable (guarded above), but keep the type narrow for the audit.
      console.error('no provider route')
      await dispose()
      return 1
    }
    // Explicit production opt-in (F5/M-B): the SHELL opts into the
    // form-production path (the library default stays false); the opt-in is
    // recorded before anything runs. The audit service is already mounted.
    await ctx.paperAudit.record({ eventType: 'production_enabled', actor: 'paper-shell', detail: { tier, mode, route: `${route.baseURL} + ${route.model}` } })
  }

  // Mount the provider (REAL adapter over the shell seam, a deterministic
  // fake for the offline e2e, or a CASSETTE REPLAYER for recorded-real
  // offline runs — never engine semantics, 禁 M1-1).
  const recorder = cassettePath !== undefined && route !== undefined
    ? new CassetteRecorder(route.provider, route.model, `paper-shell real run → ${cassettePath}`)
    : undefined
  const replayer = replayPath !== undefined
    ? await CassetteReplayer.load(replayPath)
    : undefined
  if (fake) {
    ctx.provide('paperProvider', createFakeProvider(route))
  } else if (replayer !== undefined) {
    ctx.provide('paperProvider', createReplayProvider(replayer))
  } else {
    if (route === undefined) {
      console.error('no provider route')
      await dispose()
      return 1
    }
    const adapter = (r: ShellRoute, req: { system?: string; messages: Array<{ content: string }> }) => streamCompletion(r, req)
    ctx.provide('paperProvider', createRealProvider(route, adapter, recorder))
  }
  // Plugin executor AFTER provider is mounted.
  try {
    await ctx.plugin(PaperExecutorService, {
      produceFromExecute: true,
      finalOutputRoot: baseRoot,
      produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'paper-shell v0 (node 24)', timeoutMs: 60_000 },
      backoffBaseMs: 1_000,
      backoffCapMs: 10_000,
      initialTier: tier,
    })
  } catch (error) {
    console.error('executor mount failed:', (error as Error).message)
    await dispose()
    return 1
  }

  const engine = ctx.paperWorkflow.runs
  const task = await readProblemFile(problemFile)
  const run = await engine.startRun({ mode, harnessVersion: 'paper-shell-v0', configHash: 'sha256:dmshell' })
  try {
    await ctx.paperExecutor.runs.execute(RunId(run.id), task)
  } catch (error) {
    const err = error as { code?: string; eventType?: string; message?: string }
    const human = blockMessage(String(err.eventType ?? 'gate-failed'), err.code, err.message ?? '')
    console.error(`[BLOCKED] ${human.oneLine}`)
    console.error(`  → ${human.advice}`)
    // Write a run report even on failure.
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'run-report.json'), JSON.stringify({ runId: String(run.id), tier, mode, status: 'BLOCKED', classifier: human.classifier, code: err.code }, null, 2), 'utf8')
    await dispose()
    return 1
  }

  // Read the promoted final output.
  const finalDir = join(baseRoot, String(run.id), 'final')
  const files = await readdir(finalDir).catch(() => [] as string[])
  const firstFile = files[0]
  if (files.length === 0 || firstFile === undefined) {
    console.error('[no-deliverable] executor finished but no final output was promoted')
    await dispose()
    return 1
  }
  const report = await readFile(join(finalDir, firstFile), 'utf8')
  const sha256 = createHash('sha256').update(report).digest('hex')
  const audit = ctx.paperAudit.list(String(run.id)).map(e => `${e.eventType}`).join(',')
  // TASK-Q2: real token accounting from the run record (the real adapter
  // requests include_usage; the executor accumulates every call). Fake and
  // replay runs legitimately report zeros.
  const runUsage = engine.getRun(RunId(run.id))?.usage
  const usageSummary = {
    input_tokens: runUsage?.inputTokens ?? 0,
    output_tokens: runUsage?.outputTokens ?? 0,
    cost_usd: runUsage?.costUsd ?? 0,
  }
  // The zipped run-report redacts the per-run UUID so the zip is
  // byte-deterministic on re-run (G2: 重跑同 sha256); the full report with
  // the real runId is written to the out dir separately.
  const runReport = JSON.stringify({ runId: '<redacted-run-id>', tier, mode, status: 'DELIVERED', sha256, audit, usage: { input_tokens: usageSummary.input_tokens, output_tokens: usageSummary.output_tokens, cost_usd: usageSummary.cost_usd } }, null, 2)
  const runReportFull = JSON.stringify({ runId: String(run.id), tier, mode, status: 'DELIVERED', sha256, audit, usage: { input_tokens: usageSummary.input_tokens, output_tokens: usageSummary.output_tokens, cost_usd: usageSummary.cost_usd } }, null, 2)
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'report.md'), report, 'utf8')
  await writeFile(join(outDir, 'sha256.txt'), sha256, 'utf8')
  await writeFile(join(outDir, 'run-report.json'), runReportFull, 'utf8')
  // Deterministic zip of the deliverable + run report (same sha256 on re-run).
  const zipBytes = zipTextFiles({ 'report.md': report, 'sha256.txt': sha256, 'run-report.json': runReport })
  const zipPath = join(outDir, 'deliverable.zip')
  await writeFile(zipPath, zipBytes)
  const zipSha = createHash('sha256').update(zipBytes).digest('hex')
  console.log(`[DELIVERED] sha256=${sha256.slice(0, 16)}...`)
  console.log(`  report  -> ${join(outDir, 'report.md')}`)
  console.log(`  zip     -> ${zipPath} (zip sha256=${zipSha.slice(0, 16)}...)`)
  console.log(`  usage   -> in ${usageSummary.input_tokens} tok / out ${usageSummary.output_tokens} tok / $${usageSummary.cost_usd.toFixed(4)} (TASK-Q2 telemetry)`)
  console.log(`  audit   -> ${audit}`)
  console.log(`  tier    -> ${ctx.paperExecutor.runs.tierOf(RunId(run.id))}`)
  // TASK-E: a real run recorded with --cassette persists its exchanges
  // here — the cassette is the run's evidence, replayable key-less forever.
  if (recorder !== undefined && cassettePath !== undefined) {
    await recorder.write(cassettePath)
    console.log(`  cassette -> ${cassettePath} (${recorder.count} exchanges)`)
  }
  await dispose()
  return 0
}

type ProviderFace = {
  resolveRole: (role: string) => Promise<unknown>
  stream: (options: { provider: string; model: string; system?: string; messages: Array<{ content?: unknown }> }) => AsyncIterable<unknown>
}

/** Shell-level provider over the real adapter (never engine semantics).
 *  When a recorder is present, every answered request + assembled response
 *  is recorded into the cassette (TASK-E). */
function createRealProvider(
  route: ShellRoute,
  adapter: (r: ShellRoute, req: { system?: string; messages: Array<{ content: string }> }) => AsyncIterable<unknown>,
  recorder?: CassetteRecorder,
): ProviderFace {
  return {
    resolveRole: async () => ({
      route: { role: 'executor', provider: route.provider, model: route.model, credentialRef: 'PAPER_PROBE_API_KEY', timeoutMs: 60_000 },
      model: { provider: route.provider, id: route.model, name: route.model, context: { contextWindow: 128_000 }, inputModalities: ['text'] },
    }),
    stream: options => recordOrPassthrough(recorder, options, adapterStream(route, adapter, options)),
  }
}

/** Adapter stream for one seam request (no recording — recording wraps it). */
async function* adapterStream(
  route: ShellRoute,
  adapter: (r: ShellRoute, req: { system?: string; messages: Array<{ content: string }> }) => AsyncIterable<unknown>,
  options: { provider: string; model: string; system?: string; messages: Array<{ content?: unknown }> },
): AsyncGenerator<unknown> {
  yield* adapter(route, {
    ...(options.system === undefined ? {} : { system: options.system }),
    messages: (options.messages ?? []).map((m) => {
      const c = (m as { content?: unknown }).content
      if (typeof c === 'string') return { content: c }
      if (Array.isArray(c)) {
        const parts = c as Array<{ type?: string; text?: string }>
        return { content: parts.map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('') }
      }
      return { content: '' }
    }),
  })
}

/** Wrap one stream: pass chunks through, record the assembled exchange
 *  (text AND usage — TASK-Q2) into the cassette. */
function recordOrPassthrough(recorder: CassetteRecorder | undefined, options: { provider: string; model: string; system?: string; messages: Array<{ content?: unknown }> }, stream: AsyncIterable<unknown>): AsyncGenerator<unknown> {
  if (recorder === undefined) {
    return (async function* pass() { yield* stream })()
  }
  const request = assembledRequest(options)
  return (async function* record() {
    let assembled = ''
    let usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } | undefined
    for await (const chunk of stream) {
      if (typeof chunk === 'object' && chunk !== null && 'text' in chunk && typeof (chunk as { text?: unknown }).text === 'string') {
        assembled += (chunk as { text: string }).text
      }
      if (typeof chunk === 'object' && chunk !== null && (chunk as { type?: string }).type === 'usage') {
        const u = (chunk as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } }).usage
        if (u !== undefined) {
          usage = {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            ...(u.cacheReadTokens !== undefined ? { cacheReadTokens: u.cacheReadTokens } : {}),
          }
        }
      }
      yield chunk
    }
    recorder.record(request, assembled, usage)
  })()
}

function assembledRequest(options: { provider: string; model: string; system?: string; messages: Array<{ content?: unknown }> }): { provider: string; model: string; system?: string | undefined; messages: ReadonlyArray<{ content?: unknown }> } {
  return {
    provider: options.provider,
    model: options.model,
    ...(options.system === undefined ? {} : { system: options.system }),
    messages: options.messages ?? [],
  }
}

/** Shell-level provider answering from a cassette (TASK-E replay). The
 *  replay reproduces the recorded usage chunks too, so a replayed run's
 *  telemetry report equals the real run's (TASK-Q2). */
function createReplayProvider(replayer: CassetteReplayer): ProviderFace {
  async function* streamAnswer(text: string, usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }): AsyncGenerator<unknown> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    if (usage !== undefined) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        },
      }
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  return {
    resolveRole: async () => ({
      route: { role: 'executor', provider: replayer.meta.provider, model: replayer.meta.model, credentialRef: 'CASSETTE', timeoutMs: 1_000 },
      model: { provider: replayer.meta.provider, id: replayer.meta.model, name: replayer.meta.model, context: { contextWindow: 128_000 }, inputModalities: ['text'] },
    }),
    stream: (options) => {
      const answer = replayer.answerWithUsage(assembledRequest(options as { provider: string; model: string; system?: string; messages: Array<{ content?: unknown }> }))
      return streamAnswer(answer.text, answer.usage)
    },
  }
}

/** The T3 fill-in payload the fake provider serves (deterministic, legal). */
const FAKE_T3_FILL = JSON.stringify({ symbol_id: 'SYM-q', unit: 'm', output_file: 'result.json', json_path: 'mean_thickness' })

/** A deterministic fake provider (offline e2e): fills the T3 fill-in prompt,
 *  serves a clean review, and never touches the network. */
function createFakeProvider(route: ShellRoute | undefined): ProviderFace {
  async function* streamText(text: string): AsyncGenerator<unknown> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  return {
    resolveRole: async () => ({
      route: { role: 'executor', provider: route?.provider ?? 'fake', model: route?.model ?? 'fake-model', credentialRef: 'FAKE', timeoutMs: 1_000 },
      model: { provider: 'fake', id: 'fake-model', name: 'fake-model', context: { contextWindow: 64_000 }, inputModalities: ['text'] },
    }),
    stream: (options) => {
      const system = String(options.system ?? '')
      if (system.includes('reviewer')) return streamText('{"defects":[]}')
      const joined = (options.messages ?? [])
        .map((m) => {
          const c = (m as { content?: unknown }).content
          if (typeof c === 'string') return c
          if (Array.isArray(c)) return (c as Array<{ type?: string; text?: string }>).map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('')
          return ''
        })
        .join(' ')
      if (joined.includes('T3 template fill-in')) return streamText(FAKE_T3_FILL)
      return streamText('revised text')
    },
  }
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    console.error('paper-shell crashed:', error)
    process.exitCode = 1
  })
  .finally(() => clearInterval(watchdog))
