/**
 * W8.9-B — the E1/E2 receive layer tests.
 *
 * 退出判据（任务总书 §2.1）：
 *   H5  E1/E2 两次独立调用，E2 输入为 E1 全文
 *   H6  构造性反例：E2 引入数字 → 拒；E2 凭空造假设 → 拒；E1 漏答一问 → 检出
 *
 * 本文件分两层：
 *   ① 纯函数层（e1-e2.ts 的解析与保真检查）——每条规则一个构造性反例；
 *   ② 端到端层（executor 的两个调用 + B5 的 E1 不重跑）——用 fake provider
 *      的脚本化输出驱动，断言调用次数与审计事件。
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
import {
  e1AnalysisInstruction,
  E1_ASSUMPTION_MARKER,
  MIN_E1_SPAN_CHARS,
  checkE1E2Fidelity,
  e2NormalizationPrompt,
  fidelityOk,
  parseE1Anchors,
} from '../src/produce/e1-e2.ts'

// ---------------------------------------------------------------------------
// ① pure-function layer
// ---------------------------------------------------------------------------

const E1_SAMPLE = [
  '审题：本题是抽样检验 + 生产决策。',
  '[[REQUIREMENT: R-OUT]] 问题 1 要求设计检测次数尽可能少的抽样方案，并给出 95% 信度下的拒收规则与 90% 信度下的接收规则。',
  '[[ASSUMPTION: A-ONESIDED]] 采用单侧精确二项检验而不是正态近似，因为小样本下近似会低估尾部概率。',
  '[[ASSUMPTION: A-SEQ]] 采用序贯抽样并设计有效停止边界，以最小化期望检测次数。',
  '问题 2 需要枚举零配件检测、成品检测与拆解的 16 种固定策略。',
].join('\n')

function entriesOf(...list: Array<{ kind: string; value: Record<string, unknown> }>) {
  return list
}

describe('W8.9-B — anchor parsing', () => {
  it('finds assumption and requirement anchors in order', () => {
    const anchors = parseE1Anchors(E1_SAMPLE)
    expect(anchors.assumptions.map(a => a.id)).toEqual(['A-ONESIDED', 'A-SEQ'])
    expect(anchors.requirements.map(a => a.id)).toEqual(['R-OUT'])
  })

  it('ignores an empty id instead of manufacturing a phantom declaration', () => {
    const anchors = parseE1Anchors(`${E1_ASSUMPTION_MARKER} ]] text`)
    expect(anchors.assumptions).toEqual([])
  })

  it('handles the same anchor id appearing twice (a restated assumption)', () => {
    const text = `${E1_ASSUMPTION_MARKER} A-X]] first\n...\n${E1_ASSUMPTION_MARKER} A-X]] restated`
    expect(parseE1Anchors(text).assumptions.map(a => a.id)).toEqual(['A-X', 'A-X'])
  })

  it('an unterminated marker is ignored (no id to check against)', () => {
    expect(parseE1Anchors(`${E1_ASSUMPTION_MARKER} A-Y no close`).assumptions).toEqual([])
  })

  it('E1 instruction forbids JSON/container (B1: 不施加容器要求)', () => {
    const instruction = e1AnalysisInstruction(['R-OUT'])
    expect(instruction).toContain('Do NOT output JSON')
    expect(instruction).toContain('Do NOT output a container')
    // and it must NOT contain the container schema lecture
    expect(instruction).not.toContain('ir-container-v1')
  })

  it('E1 instruction carries the registered requirement ids verbatim (B4 prerequisite)', () => {
    // W8.9-B1 repair: the first real run showed that an id-free instruction
    // makes the model echo the literal placeholder and B4 can never pass.
    const instruction = e1AnalysisInstruction(['R-OUT', 'R-OUT-2'])
    expect(instruction).toContain('R-OUT')
    expect(instruction).toContain('R-OUT-2')
    expect(instruction).toContain('Do NOT write the literal text')
  })

  it('E1 instruction still works with zero registered ids (stated, not silent)', () => {
    const instruction = e1AnalysisInstruction([])
    expect(instruction).toContain('registered no requirement ids')
  })

  it('E2 prompt carries E1 in full and states the no-numbers rule (B1 + B2)', () => {
    const prompt = e2NormalizationPrompt('ANALYSIS-BODY-MARKER', 'TEACHING-MARKER')
    expect(prompt).toContain('ANALYSIS-BODY-MARKER')
    expect(prompt).toContain('TEACHING-MARKER')
    expect(prompt).toContain('introduce NO numbers')
    expect(prompt).toContain('e1_span')
  })
})

describe('W8.9-B3 — two-way fidelity (each rule gets a constructed counter-example)', () => {
  const span = '采用单侧精确二项检验而不是正态近似'

  it('passes on a faithful container', () => {
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf(
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', e1_span: span } },
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-SEQ', e1_span: '采用序贯抽样并设计有效停止边界' } },
      ),
      requiredOutputIds: ['R-OUT'],
    })
    expect(fidelityOk(findings), JSON.stringify(findings)).toBe(true)
  })

  it('FORWARD violation: a paraphrase (not verbatim) is caught', () => {
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', e1_span: '使用单侧精确二项检验' } }),
      requiredOutputIds: ['R-OUT'],
    })
    expect(fidelityOk(findings)).toBe(false)
    expect(findings.find(f => f.rule.includes('正向'))?.detail).toContain('逐字')
  })

  it('FORWARD violation: a missing e1_span is caught', () => {
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf({ kind: 'EquationSpec', value: { equation_id: 'EQ-1' } }),
      requiredOutputIds: ['R-OUT'],
    })
    expect(fidelityOk(findings)).toBe(false)
    expect(findings.find(f => f.rule.includes('正向'))?.detail).toContain('未声明 e1_span')
  })

  it('FORWARD violation: a too-short span is caught (accidental match guard)', () => {
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', e1_span: '采用' } }),
      requiredOutputIds: ['R-OUT'],
    })
    expect(fidelityOk(findings)).toBe(false)
    expect(findings.find(f => f.rule.includes('正向'))?.detail).toContain('过短')
    expect(MIN_E1_SPAN_CHARS).toBeGreaterThan(2)
  })

  it('REVERSE violation: E2 invents an assumption E1 never made → caught', () => {
    // The classic hallucination shape: an extra AssumptionSpec that is
    // faithfully-anchored-looking but has no anchor in E1 at all.
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf(
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', e1_span: span } },
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-SEQ', e1_span: '采用序贯抽样并设计有效停止边界' } },
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-INVENTED', e1_span: '采用单侧精确二项检验而不是正态近似' } },
      ),
      requiredOutputIds: ['R-OUT'],
    })
    // A-INVENTED borrows a real E1 span, so the FORWARD rule alone would
    // pass it. It is the anchor-identity rule that catches the invention:
    // E1 never wrote [[ASSUMPTION: A-INVENTED]].
    expect(fidelityOk(findings)).toBe(false)
    expect(findings.find(f => f.rule.includes('锚点同一性'))?.detail).toContain('A-INVENTED')
    // and the reverse rule legitimately passes (E1's own anchors ARE declared)
    expect(findings.find(f => f.rule.includes('反向'))?.ok).toBe(true)
  })

  it('REVERSE violation: E1 marks an assumption the IR never declares → caught', () => {
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', e1_span: span } }),
      requiredOutputIds: ['R-OUT'],
    })
    expect(fidelityOk(findings)).toBe(false)
    expect(findings.find(f => f.rule.includes('反向'))?.detail).toContain('A-SEQ')
  })

  it('B4 violation: E1 never reasons about a required output → caught and named', () => {
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf(
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', e1_span: span } },
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-SEQ', e1_span: '采用序贯抽样并设计有效停止边界' } },
      ),
      requiredOutputIds: ['R-OUT', 'R-OUT-2'],
    })
    expect(fidelityOk(findings)).toBe(false)
    const b4 = findings.find(f => f.rule.includes('B4'))
    expect(b4?.detail).toContain('R-OUT-2')
  })

  it('B4 passes when every required output has an anchor', () => {
    const findings = checkE1E2Fidelity({
      e1Text: E1_SAMPLE,
      entries: entriesOf(
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', e1_span: span } },
        { kind: 'AssumptionSpec', value: { assumption_id: 'A-SEQ', e1_span: '采用序贯抽样并设计有效停止边界' } },
      ),
      requiredOutputIds: ['R-OUT'],
    })
    expect(findings.find(f => f.rule.includes('B4'))?.ok).toBe(true)
  })

  it('no required outputs declared -> B4 is vacuously satisfied (stated, not silent)', () => {
    const findings = checkE1E2Fidelity({ e1Text: E1_SAMPLE, entries: [], requiredOutputIds: [] })
    expect(findings.find(f => f.rule.includes('B4'))?.ok).toBe(true)
    expect(findings.find(f => f.rule.includes('B4'))?.detail).toContain('0 个')
  })
})

// ---------------------------------------------------------------------------
// ② end-to-end layer — two independent calls, and B5 (E1 never re-runs)
// ---------------------------------------------------------------------------

/** A container that is faithful to E1_SAMPLE. */
const FAITHFUL_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    { kind: 'SymbolSpec', value: { symbol_id: 'SYM-n', scope_ref: 'P1', token: 'n', meaning: 'sample size', unit: '1', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
    {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-ONESIDED',
        scope_ref: 'P1',
        statement: 'one-sided exact binomial test',
        source_type: 'MODELING_CHOICE',
        justification_refs: ['R-OUT'],
        risk_level: 'MEDIUM',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
        e1_span: '采用单侧精确二项检验而不是正态近似',
      },
    },
    {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-SEQ',
        scope_ref: 'P1',
        statement: 'sequential sampling with a stopping boundary',
        source_type: 'MODELING_CHOICE',
        justification_refs: ['R-OUT'],
        risk_level: 'MEDIUM',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
        e1_span: '采用序贯抽样并设计有效停止边界',
      },
    },
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['A-ONESIDED', 'A-SEQ'], variable_refs: ['SYM-n'], parameter_refs: [], equation_refs: [], constraints: [], objective: 'minimize expected inspections', dependencies: [] } },
  ],
})

/** The E2 output the model would produce if it invented an assumption. */
const INVENTED_ASSUMPTION_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    { kind: 'SymbolSpec', value: { symbol_id: 'SYM-n', scope_ref: 'P1', token: 'n', meaning: 'sample size', unit: '1', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
    {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-ONESIDED',
        scope_ref: 'P1',
        statement: 'one-sided exact binomial test',
        source_type: 'MODELING_CHOICE',
        justification_refs: ['R-OUT'],
        risk_level: 'MEDIUM',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
        e1_span: '采用单侧精确二项检验而不是正态近似',
      },
    },
    {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-SEQ',
        scope_ref: 'P1',
        statement: 'sequential sampling with a stopping boundary',
        source_type: 'MODELING_CHOICE',
        justification_refs: ['R-OUT'],
        risk_level: 'MEDIUM',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
        e1_span: '采用序贯抽样并设计有效停止边界',
      },
    },
    {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-INVENTED',
        scope_ref: 'P1',
        statement: 'detection is perfectly accurate',
        source_type: 'MODELING_CHOICE',
        justification_refs: ['R-OUT'],
        risk_level: 'LOW',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
        e1_span: '采用单侧精确二项检验而不是正态近似',
      },
    },
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['A-ONESIDED', 'A-SEQ', 'A-INVENTED'], variable_refs: ['SYM-n'], parameter_refs: [], equation_refs: [], constraints: [], objective: 'minimize expected inspections', dependencies: [] } },
  ],
})

const routes = {
  executor: { provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 },
}

async function harness(outputs: ReadonlyArray<string>, opts?: { disableE1E2?: boolean; disableShardDeclare?: boolean }) {
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
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'fake-model', name: 'fake-model' } }),
    stream: (request: { system?: string; messages?: ReadonlyArray<{ content?: unknown }> }) => {
      const system = String(request.system ?? '')
      const joined = (request.messages ?? []).map((m) => {
        const c = (m as { content?: unknown }).content
        if (typeof c === 'string') return c
        if (Array.isArray(c)) return (c as Array<{ type?: string; text?: string }>).map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('')
        return ''
      }).join(' ')
      const seen = `${system}
${joined}`
      prompts.push(seen)
      let text = ''
      if (system.includes('reviewer')) {
        text = '{"defects":[]}'
      } else if (seen.includes('numbered execution plan')) {
        text = '1. do it'
      } else {
        // E1 then E2 — the order the receive layer issues them.
        text = outputs[Math.min(index, outputs.length - 1)] ?? ''
        index += 1
      }
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
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    ...(opts?.disableE1E2 === true ? { disableE1E2: true } : {}),
    ...(opts?.disableShardDeclare === true ? { disableShardDeclare: true } : {}),
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:w89b' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'solve the sampling problem')
    .then(() => ({ status: 'resolved' as const, message: '' }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }))
  return { ctx, ir, runId: started.id, outcome, prompts, callCount: () => index }
}

describe('W8.9-B1 — E1 and E2 are two independent calls', () => {
  it('H5: two calls happen, E1 first (free analysis) then E2 (normalization of E1 full text)', async () => {
    const { ctx, runId, outcome, prompts } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('resolved')
    const e1Prompts = prompts.filter(p => p.includes('Write a modeling analysis in prose'))
    const e2Prompts = prompts.filter(p => p.includes('NORMALIZING a modeling analysis'))
    expect(e1Prompts.length).toBe(1)
    expect(e2Prompts.length).toBe(1)
    // H5: E2's input IS E1's full text.
    expect(e2Prompts[0]).toContain(E1_SAMPLE)
    // the audit trail shows both stages
    const kinds = ctx.paperAudit.list(runId).map((e: { eventType: string; detail?: { kind?: string } }) => `${e.eventType}:${String(e.detail?.kind ?? '')}`)
    expect(kinds).toContain('ir_entry_written:E1Analysis')
    expect(kinds).toContain('ir_entry_written:E2Normalization')
  })

  it('the faithful container reaches the store (E1/E2 path produces IR)', async () => {
    const { ir, outcome } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('resolved')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).toContain('AssumptionSpec')
    expect(kinds).toContain('ModelSpec')
  })

  it('disableE1E2 removes the receive layer (no E1 instruction, no E2 prompt)', async () => {
    const { prompts, outcome } = await harness([FAITHFUL_CONTAINER], { disableE1E2: true, disableShardDeclare: true })
    // Neither half of the receive layer may run: no E1 instruction, and no
    // E2 normalization prompt (which would quote the analysis).
    expect(prompts.some(p => p.includes('Write a modeling analysis in prose'))).toBe(false)
    expect(prompts.some(p => p.includes('NORMALIZING a modeling analysis'))).toBe(false)
    // With sharding also off, the single-shot container teaching is the
    // instruction — the historical path, unchanged.
    expect(prompts.some(p => p.includes('Produce ONE JSON object — the ir-container-v1'))).toBe(true)
    expect(outcome.status, outcome.message).toBe('resolved')
  })

  it('path precedence: disabling E1/E2 alone lands on the SHARDED path (A4 default)', async () => {
    // W8.9-B1 + A4 interaction, asserted rather than assumed: E1/E2 →
    // sharding → single-shot. The shard prompts are what the model sees
    // when only the receive layer is turned off.
    const { prompts } = await harness([FAITHFUL_CONTAINER], { disableE1E2: true })
    expect(prompts.some(p => p.includes('ONE SHARD of a multi-step'))).toBe(true)
    expect(prompts.some(p => p.includes('Write a modeling analysis in prose'))).toBe(false)
  })
})

describe('W8.9-B3/B5 — fidelity refusal + E1 is never re-run', () => {
  it('H6: E2 inventing an assumption is REFUSED (fidelity), and E1 runs only once', async () => {
    const { ctx, runId, outcome, prompts, callCount } = await harness([E1_SAMPLE, INVENTED_ASSUMPTION_CONTAINER])
    expect(outcome.status).toBe('rejected')
    // The refusal carries the fidelity code (the circuit breaker appends its
    // own sentence after the class prefix — see the W8.6-A4 message shape).
    expect(outcome.message).toContain('E1_E2_FIDELITY_VIOLATION')
    // B5: E1 was called exactly once despite the retries.
    const e1Calls = prompts.filter(p => p.includes('Write a modeling analysis in prose')).length
    expect(e1Calls).toBe(1)
    // and the reuse is visible in the audit trail
    const kinds = ctx.paperAudit.list(runId).map((e: { eventType: string; detail?: { kind?: string } }) => `${e.eventType}:${String(e.detail?.kind ?? '')}`)
    expect(kinds).toContain('ir_entry_written:E1Reused')
    expect(callCount()).toBeGreaterThan(1)
  })

  it('the fidelity finding names the invented assumption', async () => {
    const { ctx, runId } = await harness([E1_SAMPLE, INVENTED_ASSUMPTION_CONTAINER])
    const findings = ctx.paperAudit.list(runId)
      .filter((e: { detail?: { kind?: string } }) => e.detail?.kind === 'FidelityFinding')
      .map((e: { detail?: { ok?: boolean; detail?: string } }) => e.detail)
    expect(findings.length).toBeGreaterThan(0)
    expect(JSON.stringify(findings)).toContain('A-INVENTED')
  })
})
