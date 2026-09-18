/**
 * TASK-M1 M1-2 — paper shell CLI entry. `paper-shell run <problem-file>`.
 *
 * Command surface:
 *   paper-shell run <file> [--tier T1|T2|T3] [--mode fast|strict|exploratory]
 *                          [--fail-soft] [--out <dir>] [--zip] [--no-write]
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
import { resolveShellRoute, blockMessage, lastFailureClassEvent, type ShellRoute } from './invoke.ts'
import { assembleBundle } from './bundle.ts'
import { classifyProblem, routeBanner, routeMismatch } from './route.ts'
import { contractBanner } from './contracts/index.ts'
import { streamCompletion } from './real-provider.ts'
import { CassetteRecorder, CassetteReplayer } from './cassette.ts'
import { checkCodeProvenance, SHELL_PROVENANCE_TARGETS } from './code-provenance.ts'
import { verifyStudyManifest, type StudyManifest } from './study-manifest.ts'
import { FINGERPRINT_NAMESPACES } from '@deepseek-ai/dsh-paper-foundation'
import { zipTextFiles } from './zip.ts'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * W8.6-C2/F1: the human truth label for a bench problem (bench/
 * TRUTH-FAMILIES.json). Matched by the problem file's directory name
 * ("2024-C" in the path). Returns null outside the bench — callers mark
 * mismatch, they never auto-correct.
 */
async function truthFamilyOf(problemFile: string): Promise<string | null> {
  const m = /2024-([A-E])\b/.exec(problemFile)
  if (m === null) return null
  const id = `2024-${m[1]}`
  const path = join(here, '..', '..', '..', 'bench', 'TRUTH-FAMILIES.json')
  try {
    const doc = JSON.parse(await readFile(path, 'utf8')) as { problems?: Array<{ id: string; family: string }> }
    return doc.problems?.find(p => p.id === id)?.family ?? null
  } catch {
    return null
  }
}

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

/** Build the full composition: storage + foundation + engine with real route.
 *  TASK-2026-09-09 E5: `display` carries the REAL resolved provider/model —
 *  the settings snapshot labels usage accounting and request events, so the
 *  old `deepseek-official/placeholder` placeholder mislabeled every real run. */
async function buildContext(shellRoot: string, display?: { provider: string; model: string }): Promise<{
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
  const displayRole = display === undefined
    ? { provider: 'deepseek-official', model: 'placeholder' }
    : { provider: display.provider, model: display.model }
  const roleRoute = { ...displayRole, credentialRef: 'PAPER_PROBE_API_KEY', timeoutMs: 60_000 }
  await ctx.plugin(PaperSettingsService, {
    executor: { ...roleRoute },
    reviewer: { ...roleRoute },
    editorAi: { ...roleRoute },
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
    console.error('usage: paper-shell run <problem-file> [--tier T1|T2|T3] [--mode fast|strict|exploratory] [--fail-soft] [--out <dir>] [--zip]')
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
  // TASK-P2-B: paper-shell study manifest verify <manifest.json> — re-derive
  // every content field against the current tree; ANY drift exits 1 with
  // the full drift list (freeze integrity = the study's identity).
  if (sub === 'study') {
    if (positionals[1] !== 'manifest' || positionals[2] !== 'verify') {
      console.error('usage: paper-shell study manifest verify <manifest.json>')
      return 2
    }
    const manifestPath = positionals[3]
    if (manifestPath === undefined) {
      console.error('study manifest verify needs a manifest file')
      return 2
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as StudyManifest
    const { execSync } = await import('node:child_process')
    let gitCommit = '(git unavailable)'
    try {
      gitCommit = execSync('git rev-parse HEAD', { cwd: here, encoding: 'utf8' }).trim()
    } catch { /* verify will report the drift */ }
    const result = verifyStudyManifest(manifest, {
      git_commit: gitCommit,
      fingerprint_namespaces: Object.values(FINGERPRINT_NAMESPACES),
      gate_baseline: { files: 99, total_tests: 1105 },
      model: resolveShellRoute(process.env)?.model ?? manifest.route.model,
      problem_files_root: dirname(manifestPath),
    })
    if (result.ok) {
      console.log(`study manifest OK — ${manifest.study_id} frozen at ${manifest.git_commit.slice(0, 12)}, manifest_hash ${manifest.manifest_hash.slice(0, 16)}…`)
      return 0
    }
    console.error(`study manifest VERIFY FAILED (${result.drifts.length} drifts):`)
    for (const drift of result.drifts) {
      console.error(`  - ${drift.field}: frozen ${drift.frozen.slice(0, 20)} vs current ${drift.current.slice(0, 20)}`)
    }
    console.error('This tree is NOT the frozen system image. Study Batch B or restore.')
    return 1
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
  // P0-2 (PRD v2): T3 is no longer the default. T3's closed fill-in face
  // never reads the problem statement (REAL-RUN-2024A: it delivered the
  // demo's 0.731), so it stays opt-in for regression use only.
  const rawTier = String(parsed.tier ?? 'T1')
  const tier: 'T1' | 'T2' | 'T3' | undefined = (['T1', 'T2', 'T3'] as const).includes(rawTier as 'T1' | 'T2' | 'T3')
    ? rawTier as 'T1' | 'T2' | 'T3'
    : undefined
  if (tier === undefined) {
    console.error(`invalid --tier '${rawTier}' (expected T1|T2|T3)`)
    return 2
  }
  const rawMode = String(parsed.mode ?? 'strict')
  const mode: 'fast' | 'strict' | 'exploratory' | undefined = (['fast', 'strict', 'exploratory'] as const).includes(rawMode as 'fast' | 'strict' | 'exploratory')
    ? rawMode as 'fast' | 'strict' | 'exploratory'
    : undefined
  if (mode === undefined) {
    console.error(`invalid --mode '${rawMode}' (expected fast|strict|exploratory)`)
    return 2
  }
  const outDir = parsed.out !== undefined ? String(parsed.out) : join(here, 'out')
  const fake = parsed.fake === true || parsed.fake === 'true'
  // P0-3: --fail-soft = MARKED fail-soft delivery threshold (mass tier).
  const failSoft = parsed['fail-soft'] === true || parsed['fail-soft'] === 'true'
  // W8.6-P4: PAPER_MAX_OUTPUT_TOKENS_PER_RUN (0/absent = unbounded).
  const maxOutputTokensPerRun = Number(process.env.PAPER_MAX_OUTPUT_TOKENS_PER_RUN ?? '0') || 0
  // W8.9-A4: sharded EXECUTE declaration is the DEFAULT path. The flag is
  // inverted from W9-P2's opt-in: `--no-shard-declare` restores the
  // single-shot declaration (A/B comparison, regression). `--shard-declare`
  // stays accepted as an explicit confirmation so old scripts keep working.
  const shardDeclareOff = parsed['no-shard-declare'] === true || parsed['no-shard-declare'] === 'true'
  const shardDeclareOn = parsed['shard-declare'] === true || parsed['shard-declare'] === 'true'
  if (shardDeclareOff && shardDeclareOn) {
    console.error('--shard-declare and --no-shard-declare are mutually exclusive')
    return 2
  }
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

  // W8.9 repair (found by the first-ever replay run of the TASK-E corpus):
  // the seam request's provider/model come from SETTINGS, and settings are
  // built from `display` — but `display` was derived only from the real route,
  // which is absent under --replay (no key needed). Every replayed request
  // therefore carried the placeholder identity `deepseek-official/placeholder`
  // while the cassette recorded the real one, so EVERY fingerprint missed and
  // every replay failed. The cassette knows its own identity; load it first
  // and let it supply `display`. (The step never ran in CI: it was masked by
  // the RG-06 drift that stopped the job earlier for its whole lifetime.)
  const replayMeta = replayPath !== undefined
    ? (await CassetteReplayer.load(replayPath)).meta
    : undefined
  const display = replayMeta !== undefined
    ? { provider: replayMeta.provider, model: replayMeta.model }
    : route === undefined ? undefined : { provider: route.provider, model: route.model }
  const { ctx, baseRoot, dispose } = await buildContext(here, display)
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
  void replayMeta
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
  // TASK-2026-09-09 E2/O3 (cockpit wiring): pricing arrives via
  // PAPER_PRICING_JSON (a full PricingTable: provider → model → per-1k USD);
  // the budget arrives via PAPER_DAILY_BUDGET_USD. The shell never prices by
  // guess: an unpriced model simply costs 0, and the cockpit surfaces that
  // as "未配置价格" rather than pretending $0 is a real number.
  const pricingFromEnv = process.env.PAPER_PRICING_JSON !== undefined
    ? (JSON.parse(process.env.PAPER_PRICING_JSON) as never)
    : undefined
  const budgetFromEnv = Number(process.env.PAPER_DAILY_BUDGET_USD ?? '')
  try {
    await ctx.plugin(PaperExecutorService, {
      produceFromExecute: true,
      finalOutputRoot: baseRoot,
      produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'paper-shell v0 (node 24)', timeoutMs: 60_000 },
      backoffBaseMs: 1_000,
      backoffCapMs: 10_000,
      initialTier: tier,
      // P0-3 (PRD v2 §3.3): --fail-soft switches the delivery threshold to
      // MARKED fail-soft (mass tier default). Without it the run keeps the
      // historical strict-tolerance (CLEAN or BLOCKED, never MARKED).
      deliveryGradeMode: failSoft ? 'fail-soft' : 'strict-tolerance',
      // W8.6-P4 (O-L5-03): the per-run output-token ceiling protects a
      // real key even when pricing is unconfigured. Env-set, recorded in
      // the run report; 0/absent = unbounded.
      maxOutputTokensPerRun: maxOutputTokensPerRun,
      // W8.9-A4: sharding is the default, so the option is only passed when
      // the caller explicitly turned it OFF (or explicitly confirmed ON,
      // which is a no-op — kept so an old `--shard-declare` script records
      // the same intent it always did).
      ...(shardDeclareOff ? { disableShardDeclare: true } : {}),
      ...(shardDeclareOn ? { shardDeclare: true } : {}),
      ...(pricingFromEnv !== undefined ? { pricing: pricingFromEnv } : {}),
      ...(Number.isFinite(budgetFromEnv) && budgetFromEnv > 0 ? { dailyBudgetUsd: budgetFromEnv } : {}),
    })
  } catch (error) {
    console.error('executor mount failed:', (error as Error).message)
    await dispose()
    return 1
  }

  const engine = ctx.paperWorkflow.runs
  // W8.9-A1: the code-provenance guard. Tests read `src` (tsconfig paths),
  // a real run reads `lib` (package exports) — so "tests green" says nothing
  // about the code a real run executes. W8.8 runs #1–3 executed a stale
  // executor while 1198 tests passed. The guard runs BEFORE the first model
  // call (fail-closed, zero tokens spent when it fires) and its verdict is
  // recorded in the run report so the next reader never has to infer it.
  // `--fake`/`--replay` are offline: they cannot burn a key, so they warn
  // instead of refusing (a stale-lib fake run is still a valid regression).
  const repoRoot = join(here, '..', '..', '..')
  const provenanceTargets = SHELL_PROVENANCE_TARGETS.map(t => ({ ...t, dir: join(repoRoot, t.dir) }))
  const provenance = checkCodeProvenance(provenanceTargets)
  const provenanceRecord = {
    checked_at: new Date().toISOString(),
    ok: provenance.ok,
    targets: provenance.checks.map(c => ({ name: c.name, ok: c.ok, detail: c.detail })),
  }
  if (!provenance.ok) {
    const lines = provenance.checks.filter(c => !c.ok).map(c => `  ${c.name}: ${c.detail}`)
    if (fake || replayPath !== undefined) {
      console.error(`[CODE-STALE] 构建产物落后于源码（离线运行，仅警告）：\n${lines.join('\n')}`)
      console.error(`  → ${provenance.remediation}`)
    } else {
      await dispose()
      console.error('[CODE-STALE] 拒绝启动真实运行：构建产物落后于源码。')
      console.error(lines.join('\n'))
      console.error(`  → 先重建：${provenance.remediation}`)
      console.error('  → 理由：测试读 src、真实运行读 lib；不重建则本次运行跑的代码与测试所验的代码不是同一份（W8.8 run#1–3 的代价）。')
      return 4
    }
  } else {
    console.error(`[CODE-FRESH] 代码来源已断言：${provenance.checks.map(c => c.detail).join('; ')}`)
  }
  // P0-4 (PRD v2 §5.1.1/§5.1.2, W3): the entry layer accepts a PDF/plain
  // problem plus optional data attachments; `assembleBundle` extracts the
  // PDF, profiles every attachment, and appends the profile to the task
  // text so the model sees the data's shape (行列/类型/缺失/量纲疑点)
  // before it models. The engine still only consumes text.
  const dataFiles = (Array.isArray(parsed.data) ? parsed.data : parsed.data === undefined ? [] : [parsed.data])
    .map(String)
    .filter(Boolean)
  const bundle = await assembleBundle(problemFile, dataFiles)
  // P0-5 (PRD v2 §5.1.3, W4): family routing BEFORE any provider call.
  // A problem outside the supported families (F3/F4 today) is refused
  // here — zero tokens, zero model calls (拒绝优先, §3.4). The route
  // banner for a supported problem is appended so the W5 contract layer
  // can pick the family template; it costs nothing (pure text).
  //
  // W8.9 repair: T3 is EXEMPT. PRD v2 F2 states T3's defining property is
  // that it does NOT read the problem statement ("默认路径（T3）不读题面,
  // 0.731 由 harness 写死"); P0-2 repositions it as "固定填充面（回归用）".
  // Gating a path that never consumes the statement on "the statement is
  // routable" is a category error — it made the T3 regression demo refuse
  // on an English minimal fixture (found when CI finally reached this step;
  // it had been masked by an earlier RG-06 drift for the whole M1 lifetime).
  // T3 keeps its own guard (the closed fill-in template), so no check is lost.
  const familyVerdict = tier === 'T3'
    ? { ok: true as const, family: 'F3' as const, note: 'T3 固定填充面（回归用）：不读题面，故不参与方法族路由（PRD v2 F2/P0-2）', components: [] as ReadonlyArray<{ family: 'F1' | 'F2' | 'F3' | 'F4'; hits: number }> }
    : classifyProblem(bundle.taskText)
  if (tier === 'T3') {
    console.error('[T3] 固定填充面（回归用）：跳过方法族路由——该路径按设计不读题面。')
  }
  if (!familyVerdict.ok) {
    await dispose()
    console.error(`[REFUSED] ${familyVerdict.reason}`)
    console.error('  → 未发起任何模型调用(零 token)。')
    return 3
  }
  // W8.6-C2: for a bench problem, flag when the router's decision differs
  // from the preregistered truth label — marked, never auto-corrected.
  // E3's discovery (2024-C routed F4 vs preregistered F3, later revised
  // to F3+F2) must be machine-visible on every run, not prose-only.
  const truth = await truthFamilyOf(problemFile)
  // W8.9-A2: component-SET comparison, not string equality. The truth label
  // may be a mixed family ("F3+F4") while `familyVerdict.family` is a single
  // primary family ("F4") — string equality marked every legal mixed problem
  // as a mismatch (2024-B contradicted RUNNABLE-PROBLEMS.md). A mismatch now
  // means "the routed component set does not COVER the truth components".
  const mismatched = routeMismatch(truth, familyVerdict)
  if (mismatched) {
    const routedText = familyVerdict.components.map(c => `${c.family}×${c.hits}`).join('，')
    console.error(`[ROUTE-MISMATCH] 路由组件 ${routedText} 未覆盖预注册真值 ${String(truth)}（仅标记，不自动纠正）`)
  }
  // W5 (P0-8): the family contract banner joins the taskText — the model
  // sees the closed candidate set + required assumptions + dedicated
  // validation BEFORE it models (zero invention space, 核验表 Part B).
  //
  // W8.9: T3 gets NO banner. T3 does not read the statement (PRD v2 F2), so
  // a family banner would be noise it never consumes — and, concretely, it
  // would change the request fingerprint and break every recorded cassette
  // (TASK-E's replay corpus was recorded from T3 runs whose taskText was the
  // bare statement). Keeping the T3 taskText byte-identical to what was
  // recorded is what makes "same cassette → same report → same zip sha256"
  // (expert plan §14) still true.
  const taskText = tier === 'T3'
    ? bundle.taskText
    : `${bundle.taskText}${routeBanner(familyVerdict)}${contractBanner(familyVerdict.family)}`
  // W8.5 (B2): M3b — the shell stamps the wall-clock window it owns
  // (submit → terminal). Recorded in run-report.json as
  // wall_clock_seconds so the bench metrics can read it (they cannot
  // derive it from the durable run record otherwise).
  const wallClockStart = Date.now()
  const run = await engine.startRun({ mode, harnessVersion: 'paper-shell-v0', configHash: 'sha256:dmshell' })
  try {
    await ctx.paperExecutor.runs.execute(RunId(run.id), taskText)
  } catch (error) {
    const err = error as { code?: string; eventType?: string; message?: string }
    // W8.10-A1 (O-L3-06): the thrown WorkflowExecutionError carries only
    // `code: 'gate-failed'` — never the failure CLASS. The class IS on the
    // audit trail (the executor writes `truncated` / `escape_refused` /
    // `tier_degraded` / `container_refused` / `provider_blocked` /
    // `budget_exceeded` before it throws), so read it there. Falling back to
    // the literal 'gate-failed' landed every truncation in the transport
    // bucket and advised "重试一次" — the one action W8.5 proved cannot work
    // for a length ceiling.
    const auditEvents = ctx.paperAudit.list(String(run.id))
    const classEvent = lastFailureClassEvent(auditEvents)
    const human = blockMessage(classEvent ?? String(err.eventType ?? 'gate-failed'), err.code, err.message ?? '')
    console.error(`[BLOCKED] ${human.oneLine}`)
    console.error(`  → ${human.advice}`)
    console.error(`  run-id  -> ${String(run.id)}`)
    // B0-1 (TASK-R1): the BLOCKED technical memo — what the student (or the
    // cockpit) can pick up from here. Pure projection of durable state:
    // passed gates, minted IR entries, and the failing node, no new semantics.
    const nodes = engine.listNodes(RunId(run.id))
    const blockedNode = nodes.find(n => n.state === 'failed' || n.lastErrorCode === err.code)
    const ir = ModelingIr.snapshot(ctx.get('paperModelingIr')) ?? new Map()
    const memo = {
      passed_gates: nodes.filter(n => n.state === 'succeeded').map(n => n.title),
      minted_ir_kinds: [...new Set([...ir.values()].map(r => r.kind))],
      minted_ir_count: ir.size,
      failing_node: blockedNode === undefined
        ? null
        : { title: blockedNode.title, attempts: blockedNode.attempts, code: blockedNode.lastErrorCode },
      suggested_intervention: human.advice,
    }
    await mkdir(outDir, { recursive: true })
    // W8.6-D2: the BLOCKED report MUST carry usage — the W8.5 run's
    // 8,785/75,669 had to be re-derived by hand (subtraction) because this
    // path omitted it. The durable run record has the numbers; project
    // them here exactly like the DELIVERED path does.
    const blockedUsage = engine.getRun(RunId(run.id))?.usage
    await writeFile(join(outDir, 'run-report.json'), JSON.stringify({
      runId: String(run.id),
      tier,
      mode,
      status: 'BLOCKED',
      routed_family: familyVerdict.family,
      route_truth: truth,
      route_mismatch: mismatched,
      code_provenance: provenanceRecord,
      // W8.10-A2 (O-L3-07): the IR mint count is the load-bearing fact for
      // "did the receive layer actually produce canonical state?" — it was
      // only reachable inside `memo`, so every reader had to know the memo
      // shape (W8.9's own report had to say "it's inside memo"). Promoted to
      // the top level; `memo.minted_ir_count` keeps its value unchanged.
      minted_ir_count: memo.minted_ir_count,
      classifier: human.classifier,
      code: err.code,
      humanized: human.oneLine,
      wall_clock_seconds: Math.round((Date.now() - wallClockStart) / 100) / 10,
      usage: {
        input_tokens: blockedUsage?.inputTokens ?? 0,
        output_tokens: blockedUsage?.outputTokens ?? 0,
        cost_usd: blockedUsage?.costUsd ?? 0,
      },
      memo,
    }, null, 2), 'utf8')
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
  // W8.9-C2 — the scope limitation joins the DELIVERED artifact here, after
  // the reviewer is done and before the digest is taken.
  //
  // 落点为何在这里（第一次放错了，由 cassette 回放实测抓出）：把声明放进
  // report-renderer 会让它进入 EXECUTE 节点的输出，而该输出**同时是
  // reviewer 的输入**——于是 reviewer 请求的指纹变了，TASK-E 的每个
  // cassette 都 miss（"same cassette → same zip sha256" 这条性质当场失效）。
  // 局限声明是给**读者**的，不是给 reviewer 的判定材料，故它属于交付层，
  // 不属于引擎层。放在这里还顺带满足 PRD v2 §3.3 的"标注放附录，不放正文
  // 内联"，并且让 sha256 覆盖含声明的最终文本。
  const scopeNote = [
    '',
    '---',
    '',
    '> **本交付物的验证范围（W8.9-C2）**：已机械核验的是**结构完整**（章节/符号/假设齐备）、**数字可溯源**（每个数字可追到 Result 或题面给定值）与**形式化忠实**（IR 声明逐字锚定建模分析文本）。**未**核验的是**实质正确性**——建模思路的优劣、假设的物理真伪、方法选择的恰当性，均**不在本 harness 的可判定范围内**。请读者据此评估结论。',
    '',
  ].join('\n')
  const report = (await readFile(join(finalDir, firstFile), 'utf8')) + scopeNote
  const sha256 = createHash('sha256').update(report).digest('hex')
  const audit = ctx.paperAudit.list(String(run.id)).map(e => `${e.eventType}`).join(',')
  // W8.10-A2: same top-level field as the BLOCKED path, so a reader compares
  // the two reports without knowing which one they are holding.
  const mintedIrCount = (ModelingIr.snapshot(ctx.get('paperModelingIr')) ?? new Map()).size
  // P0-3: the run-report carries the delivery grade. The MARKED appendix
  // lives in report.md itself; this field makes the grade machine-readable
  // for the bench metrics (M1's CLEAN/MARKED split) without re-parsing
  // prose. 'MARKED' is derived from the delivery_graded audit entry;
  // absence keeps the historical 'CLEAN' label for strict compositions
  // that never graded (defense in depth: the appendix is the source of
  // truth, this is the index).
  const gradedEntries = ctx.paperAudit.list(String(run.id)).filter(e => e.eventType === 'delivery_graded')
  const grade: 'CLEAN' | 'MARKED' = gradedEntries.some(e => String((e as { detail?: { grade?: unknown } }).detail?.grade) === 'MARKED') ? 'MARKED' : 'CLEAN'
  // TASK-Q2: real token accounting from the run record (the real adapter
  // requests include_usage; the executor accumulates every call). Fake and
  // replay runs legitimately report zeros.
  const runUsage = engine.getRun(RunId(run.id))?.usage
  const usageSummary = {
    input_tokens: runUsage?.inputTokens ?? 0,
    output_tokens: runUsage?.outputTokens ?? 0,
    cost_usd: runUsage?.costUsd ?? 0,
  }
  // P0-4 (W3): the attachment ledger — every data file that fed the run,
  // with its sampled sha256 + bytes, so the bench records what the model
  // saw. 490MB-class files stay cheap because the hash is sampled.
  const attachmentLedger = bundle.attachments.map(a => ({
    file: a.basename,
    sha256: a.sha256,
    bytes: a.bytes,
  }))
  // The zipped run-report redacts the per-run UUID so the zip is
  // byte-deterministic on re-run (G2: 重跑同 sha256); the full report with
  // the real runId is written to the out dir separately.
  const wallClockSeconds = Math.round((Date.now() - wallClockStart) / 100) / 10
  // W8.9 repair: the zip's copy must be byte-deterministic on re-run (the
  // TASK-E assertion "same cassette → same report → same zip sha256" depends
  // on it), so the two per-run facts are excluded here and kept only in the
  // on-disk run-report.json: `wall_clock_seconds` (a duration) and the
  // provenance `checked_at` (a wall-clock stamp). Everything a reader needs
  // to judge the delivery — tier, mode, grade, family, sha256, audit, usage,
  // provenance verdicts — stays.
  const zipProvenance = { ...provenanceRecord, checked_at: '<per-run>' }
  const runReport = JSON.stringify({ runId: '<redacted-run-id>', tier, mode, status: 'DELIVERED', grade, routed_family: familyVerdict.family, route_truth: truth, route_mismatch: mismatched, code_provenance: zipProvenance, minted_ir_count: mintedIrCount, wall_clock_seconds: '<per-run>', sha256, audit, usage: { input_tokens: usageSummary.input_tokens, output_tokens: usageSummary.output_tokens, cost_usd: usageSummary.cost_usd }, attachments: attachmentLedger }, null, 2)
  const runReportFull = JSON.stringify({ runId: String(run.id), tier, mode, status: 'DELIVERED', grade, routed_family: familyVerdict.family, route_truth: truth, route_mismatch: mismatched, code_provenance: provenanceRecord, minted_ir_count: mintedIrCount, wall_clock_seconds: wallClockSeconds, sha256, audit, usage: { input_tokens: usageSummary.input_tokens, output_tokens: usageSummary.output_tokens, cost_usd: usageSummary.cost_usd }, attachments: attachmentLedger }, null, 2)
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
  // C1: the cockpit maps its runKey → the durable run id via this line (the
  // persistence tables are keyed by it; SSE/GET projection reads them).
  console.log(`  run-id  -> ${String(run.id)}`)
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
type StreamRequest = { provider: string; model: string; system?: string; messages: Array<{ content?: unknown }> }

function recordOrPassthrough(
  recorder: CassetteRecorder | undefined,
  options: StreamRequest,
  stream: AsyncIterable<unknown>,
): AsyncGenerator<unknown> {
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

function assembledRequest(options: StreamRequest): {
  provider: string
  model: string
  system?: string | undefined
  messages: ReadonlyArray<{ content?: unknown }>
} {
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
  async function* streamAnswer(
    text: string,
    usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number },
  ): AsyncGenerator<unknown> {
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
      const answer = replayer.answerWithUsage(assembledRequest(options as StreamRequest))
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
