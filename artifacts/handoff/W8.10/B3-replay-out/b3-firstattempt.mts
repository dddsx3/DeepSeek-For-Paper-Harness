/**
 * W8.10-B3 evidence probe (untracked, artifacts-only).
 *
 * Question: on a FIRST E2 attempt, is the assembled prompt byte-identical to
 * what W8.9 sent? Drives the working-tree executor with a scripted provider and
 * prints the E2 prompt it actually issues. Nothing under apps/ or packages/ is
 * modified; the cassette is never touched.
 */
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

const E1_SAMPLE = [
  '审题：本题是抽样检验 + 生产决策。',
  '[[REQUIREMENT: R-OUT]] 问题 1 要求设计检测次数尽可能少的抽样方案。',
  '[[ASSUMPTION: A-ONESIDED]] 采用单侧精确二项检验而不是正态近似。',
].join('\n')

const FAITHFUL_CONTAINER = JSON.stringify({
  container_version: 'ir-container-v1',
  entries: [
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', statement: '采用单侧精确二项检验而不是正态近似', e1_span: '采用单侧精确二项检验而不是正态近似' } },
  ],
})

const routes = {
  executor: { role: 'executor', provider: 'fake', model: 'fake-model', credentialRef: 'X', timeoutMs: 1_000 },
  reviewer: { role: 'reviewer', provider: 'fake', model: 'fake-model', credentialRef: 'X', timeoutMs: 1_000 },
  editorAi: { role: 'editorAi', provider: 'fake', model: 'fake-model', credentialRef: 'X', timeoutMs: 1_000 },
}

const ctx = new Context()
await ctx.plugin(Storage)
ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
const facility = new DomainFacility(ctx, { backend: 'memory' })
ctx.storage.mount('domain', facility)
ctx.provide('storageDomain', facility)
await ctx.plugin(PaperFoundationService)
await ctx.plugin(WorkflowEngineService)

const prompts: string[] = []
let index = 0
ctx.provide('paperProvider', {
  resolveRole: () => Promise.resolve({ route: routes.executor, model: { provider: 'fake', id: 'fake-model', name: 'fake-model' } }),
  stream: (request: { system?: string; messages?: ReadonlyArray<{ content?: unknown }> }) => {
    const system = String(request.system ?? '')
    const joined = (request.messages ?? []).map((m) => {
      const c = (m as { content?: unknown }).content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return (c as Array<{ type?: string; text?: string }>).map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('')
      return ''
    }).join(' ')
    const seen = `${system}\n${joined}`
    prompts.push(seen)
    let text = ''
    if (system.includes('reviewer')) text = '{"defects":[]}'
    else if (seen.includes('numbered execution plan')) text = '1. do it'
    else { text = [E1_SAMPLE, FAITHFUL_CONTAINER][Math.min(index, 1)] ?? ''; index += 1 }
    return (async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
      yield { type: 'finish', index: 0, reason: { kind: 'stop' as const } }
    })()
  },
} as never)
await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'exploratory' })
const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
guard.markReady()
const ir = new ModelingIr()
ctx.provide('paperModelingIr', ir)
await ctx.plugin(PaperAuditService, {})
await ctx.plugin(PaperExecutorService, { produceFromExecute: true, backoffBaseMs: 1, backoffCapMs: 1 })
const engine = ctx.paperWorkflow.runs
const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:b3probe' })
await ctx.paperExecutor.runs.execute(RunId(started.id), 'solve the sampling problem')
  .then(() => console.log('outcome: resolved'))
  .catch((e: unknown) => console.log('outcome: rejected —', e instanceof Error ? e.message : String(e)))

const e2s = prompts.filter(p => p.includes('NORMALIZING a modeling analysis'))
console.log('E2 call count on this run:', e2s.length)
const first = e2s[0] ?? ''
console.log('first E2 prompt chars:', first.length)
console.log('contains E2_DRIFT_HEADER      :', first.includes('--- CORRECTIONS FOR THIS ATTEMPT (the previous attempt was refused) ---'))
console.log('contains "What went wrong"    :', first.includes('What went wrong last time'))
console.log('contains "ALREADY REGISTERED" :', first.includes('ALREADY REGISTERED'))
console.log('contains "R-OUT"              :', first.includes('R-OUT'))
console.log('--- tail of the first E2 prompt (last 700 chars) ---')
console.log(first.slice(-700))
