/**
 * W9-P2 验收 — sharded EXECUTE declaration (O-L1-03).
 *
 * The single-shot ir-container's output budget is eaten by the reasoning
 * channel (P1 probes ≈14.6:1) and truncates at the 32k ceiling. The
 * shard protocol splits the declaration into three small outputs merged
 * into the SAME container — the merge is the only new code and the
 * producer/code-run/audit path is untouched.
 *
 * Judges:
 *   - three shards merge and the store receives the same entries as a
 *     single-shot container would produce;
 *   - a truncated shard fails as TRUNCATED (never as a model violation);
 *   - a malformed shard keeps the W4 class (NONE/DRIFT);
 *   - the flag defaults OFF (single-shot path unchanged).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/store.ts'
import { mergeShards, parseShard, SHARD_NAMES, shardPrompt } from '../src/produce/shard-declare.ts'

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}

const SHARD_DEFS = JSON.stringify({
  entries: [
    { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'thickness', unit: 'm', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: 'uniform slab', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: false, sensitivity_refs: [], status: 'ACTIVE' } },
  ],
})
const SHARD_MODELS = JSON.stringify({
  entries: [
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['ASM-1'], variable_refs: ['SYM-q'], parameter_refs: [], equation_refs: [], constraints: [], objective: 'estimate', dependencies: [] } },
  ],
})
const SHARD_RUNTIME = JSON.stringify({
  run: { outputBasenames: ['result.json'], seed: 7 },
  interpretations: { results: [{ result_id: 'RES-OUT', name: 'mean_thickness', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm' }] },
  narrative: { title: 'Shard report' },
})

interface ShardOverrides {
  readonly definitions?: { text: string; finish?: 'stop' | 'max-tokens' }
  readonly models?: { text: string; finish?: 'stop' | 'max-tokens' }
  readonly runtime?: { text: string; finish?: 'stop' | 'max-tokens' }
}

async function harness(
  outputs: ReadonlyArray<{ text: string; finish?: 'stop' | 'max-tokens' }>,
  opts: { shardDeclare: boolean | 'absent'; overrides?: ShardOverrides },
) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  let calls = 0
  const prompts: string[] = []
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request: { system?: string; messages?: ReadonlyArray<{ content?: unknown }> }) => {
      const system = String(request.system ?? '')
      const joined = (request.messages ?? []).map((m) => {
        const c = (m as { content?: unknown }).content
        if (typeof c === 'string') return c
        if (Array.isArray(c)) return (c as Array<{ type?: string; text?: string }>).map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('')
        return ''
      }).join(' ')
      prompts.push(joined)
      let text = ''
      let finish: 'stop' | 'max-tokens' = 'stop'
      if (system.includes('reviewer')) {
        text = '{"defects":[]}'
      } else if (joined.includes('SHARD 1/3')) {
        const o = opts.overrides?.definitions
        text = o?.text ?? SHARD_DEFS
        finish = o?.finish ?? 'stop'
      } else if (joined.includes('SHARD 2/3')) {
        const o = opts.overrides?.models
        text = o?.text ?? SHARD_MODELS
        finish = o?.finish ?? 'stop'
      } else if (joined.includes('SHARD 3/3')) {
        const o = opts.overrides?.runtime
        text = o?.text ?? SHARD_RUNTIME
        finish = o?.finish ?? 'stop'
      } else {
        const entry = outputs[Math.min(calls, outputs.length - 1)]
        calls += 1
        text = entry?.text ?? ''
        finish = entry?.finish === 'max-tokens' ? 'max-tokens' : 'stop'
      }
      return (async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', index: 0, reason: finish === 'max-tokens' ? { kind: 'max-tokens' as const } : { kind: 'stop' as const } }
      })()
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'exploratory' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    backoffBaseMs: 1,
    backoffCapMs: 1,
    // W8.9-A4: 'absent' drives the DEFAULT (no option passed at all);
    // `false` is the explicit opt-out (disableShardDeclare).
    ...(opts.shardDeclare === 'absent' ? {} : opts.shardDeclare ? { shardDeclare: true } : { disableShardDeclare: true }),
    // W8.9-B1: this suite pins the SHARDED container path. The E1/E2 receive
    // layer now outranks sharding for producing EXECUTE, so the shard path
    // must be named explicitly or these assertions would exercise E1/E2.
    disableE1E2: true,
  })
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:p2' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const, message: '' }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }))
  return { ctx, engine, runId: started.id, outcome, ir, calls: () => calls, prompts }
}

describe('W9-P2 — shard declaration', () => {
  it('three shards merge and the same entries reach the store', async () => {
    // Shard content is routed by the prompt's SHARD n/3 marker; the queue
    // only serves the plan (and any non-shard executor call).
    const { ctx, ir, runId, outcome, prompts } = await harness(
      [{ text: 'plan draft' }],
      { shardDeclare: true },
    )
    expect(outcome.status, outcome.message).toBe('resolved')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).toContain('SymbolSpec')
    expect(kinds).toContain('AssumptionSpec')
    expect(kinds).toContain('ModelSpec')
    // audit: three shard outputs + one merge
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string; detail?: { kind?: string } }) => `${e.eventType}:${String(e.detail?.kind ?? '')}`)
    expect(audit).toContain('ir_entry_written:ShardOutput')
    expect(audit).toContain('ir_entry_written:ShardMerge')
    // the shard prompts actually ask for the three shards
    expect(prompts.some(p => p.includes('SHARD 1/3'))).toBe(true)
    expect(prompts.some(p => p.includes('SHARD 2/3'))).toBe(true)
    expect(prompts.some(p => p.includes('SHARD 3/3'))).toBe(true)
  })

  it('a truncated shard fails as TRUNCATED (zero retry, transport fact)', async () => {
    const { ctx, runId, outcome } = await harness(
      [{ text: 'plan' }],
      { shardDeclare: true, overrides: { models: { text: '{"entries":[{"kind":"Sym', finish: 'max-tokens' } } },
    )
    expect(outcome.status).toBe('rejected')
    expect(outcome.message).toContain('TRUNCATED')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit).toContain('truncated')
  })

  it('a malformed shard keeps the W4 class (NONE guidance path intact)', async () => {
    const { outcome } = await harness(
      [{ text: 'plan' }],
      { shardDeclare: true, overrides: { definitions: { text: 'not json at all' } } },
    )
    expect(outcome.status).toBe('rejected')
    // A malformed shard keeps the W4 classification: the fixture returns
    // the SAME bad text every attempt, so W8.6-A4's same-cause breaker
    // fires (circuit-broken) instead of spending the guided budget twice
    // on an identical output — both terminal states are correct.
    expect(outcome.message).toMatch(/circuit-broken|shard 'definitions'|not a schema-valid|exhausted/)
  })

  it('W8.9-A4: the single-shot path is reachable via disableShardDeclare', async () => {
    // W9-P2 shipped this as "the flag defaults OFF". W8.9-A4 inverted the
    // default (sharding is now the path; the single-shot declaration is the
    // opt-out). The judgement changed, not the assertion's strength: the
    // single-shot container must still resolve end to end, so a composition
    // that opts out is not stranded.
    const single = JSON.stringify({
      __dsh_paper: 'ir-container-v1',
      entries: [
        { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 't', unit: 'm', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
        { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: [], variable_refs: ['SYM-q'], parameter_refs: [], equation_refs: [], constraints: [], objective: 'x', dependencies: [] } },
      ],
    })
    const { outcome, prompts } = await harness([{ text: 'plan' }, { text: single }], { shardDeclare: false })
    expect(outcome.status, outcome.message).toBe('resolved')
    expect(prompts.some(p => p.includes('SHARD 1/3'))).toBe(false)
  })

  it('W8.9-A4: the DEFAULT (option absent) is the sharded path', async () => {
    // The default flip itself: with NO shard option passed, the executor
    // must issue the three shard prompts.
    const { outcome, prompts } = await harness([{ text: 'plan' }], { shardDeclare: 'absent' })
    expect(outcome.status, outcome.message).toBe('resolved')
    expect(prompts.filter(p => p.includes('SHARD 1/3')).length).toBeGreaterThan(0)
    expect(prompts.filter(p => p.includes('SHARD 3/3')).length).toBeGreaterThan(0)
  })
})

describe('shard-declare unit surface', () => {
  it('SHARD_NAMES is the closed three-shard list', () => {
    expect(SHARD_NAMES).toEqual(['definitions', 'models', 'runtime'])
  })

  it('parseShard accepts a fenced small object and refuses non-objects', () => {
    const fenced = parseShard('definitions', '```json\n{"entries":[]}\n```')
    expect(fenced.ok).toBe(true)
    const prose = parseShard('definitions', 'here you go: {}')
    expect(prose.ok).toBe(false)
    if (!prose.ok) expect(prose.code).toBe('parse_failed')
  })

  it('mergeShards produces the exact single-shot container shape', () => {
    const merged = mergeShards(
      { entries: [{ kind: 'SymbolSpec', value: {} }] },
      { entries: [{ kind: 'ModelSpec', value: {} }] },
      { code: 'x', run: { outputBasenames: ['a.json'], seed: 1 }, interpretations: {}, narrative: { title: 't' } },
    )
    expect(merged['__dsh_paper']).toBe('ir-container-v1')
    expect((merged['entries'] as ReadonlyArray<unknown>).length).toBe(2)
    expect(merged['code']).toBe('x')
  })

  it('every shard prompt names its slot and forbids prose/fences', () => {
    for (const shard of SHARD_NAMES) {
      const p = shardPrompt(shard)
      expect(p).toContain('no markdown fences')
      expect(p).toContain('NEVER declare them')
    }
  })
})
