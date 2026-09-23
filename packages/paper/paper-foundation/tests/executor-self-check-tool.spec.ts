/**
 * W12-A1 — the self-check TOOL (E2 的 `check_container`) 的回归门。
 *
 * ## 为什么这条测试存在
 *
 * 四轮上限测试的结论写得很直白：把判据写在 prompt 里（"提交前请自查 entries
 * 非空、id 不重复、每个子问题都要有模型"）**没有用**——模型不会因为被要求就
 * 执行。所以判据从"一段叮嘱"改成了"一个工具"：由 harness 自己跑
 * `checkCandidateContainer`，模型拿到逐条可执行的问题。
 *
 * 但工具一旦接上，就多出一整类新的失效方式，而它们都不是"模型答错"：
 *
 *   - 工具结果**没有回到模型**（对话累积写错、消息类型用错）→ 模型第二轮
 *     拿不到问题，于是"用了工具"和"没用工具"完全等价，而审计里却显示
 *     `E2SelfCheck`——**假证据**，比没有更糟。
 *   - 模型一直调用工具 → 循环不收敛，整次尝试被判失败。工具是帮忙的，
 *     不是新的门；到顶必须**要求最终答案**，而不是零掉这一轮。
 *   - 模型把参数写错（漏 `container_json`、传对象而不是字符串）→ 崩在
 *     harness 里，而不是回一句"参数不合法"。
 *   - 模型**不调用**工具 → 这条路径必须与加工具之前**逐字一致**（一轮调用、
 *     没有 `E2SelfCheck` 事件），否则老 cassette 与历史对照全部失效。
 *
 * 四条各一个用例。第 ① 条是主判据：它断言的是**回灌**（第二轮 prompt 里真的
 * 带着工具给的问题），而不是"工具被调用过"。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../src/runtime/profile.ts'
import {
  PaperArtifactBodyService,
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/store.ts'
import { SELF_CHECK_TOOL_NAME, checkCandidateContainer, runSelfCheckSafely, selfCheckCategorySentence } from '../src/produce/self-check.ts'
import { SELF_CHECK_MAX_ROUNDS } from '../src/executor.ts'

// ---------------------------------------------------------------------------
// 样本
// ---------------------------------------------------------------------------

/** E1 的散文分析：两条行首锚点，供 B3 双向锚定比对。 */
const E1_SAMPLE = [
  '审题：本题是抽样检验 + 生产决策。',
  '[[REQUIREMENT: R-OUT]] 问题 1 要求设计检测次数尽可能少的抽样方案，并给出 95% 信度下的拒收规则与 90% 信度下的接收规则。',
  '[[ASSUMPTION: A-ONESIDED]] 采用单侧精确二项检验而不是正态近似，因为小样本下近似会低估尾部概率。',
  '[[ASSUMPTION: A-SEQ]] 采用序贯抽样并设计有效停止边界，以最小化期望检测次数。',
  '问题 2 需要枚举零配件检测、成品检测与拆解的 16 种固定策略。',
].join('\n')

/**
 * 一份**能走完整条链**的容器（与 `executor-e1e2.spec.ts` 的 FAITHFUL_CONTAINER
 * 同形）。用它的原因很实际：只有它能保证"一次节点尝试 = 一次 E2 调用"，
 * 于是调用计数才是判据；容器本身过不了后续门时，节点会重试，计数里就混进了
 * 重试次数——那样测的就不是工具回路了。
 */
const GOOD_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    { kind: 'SymbolSpec', value: { symbol_id: 'SYM-n', scope_ref: 'P1', token: 'n', meaning: 'sample size', unit: '1', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', scope_ref: 'P1', statement: 'one-sided exact binomial test', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用单侧精确二项检验而不是正态近似' } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-SEQ', scope_ref: 'P1', statement: 'sequential sampling with a stopping boundary', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用序贯抽样并设计有效停止边界' } },
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['A-ONESIDED', 'A-SEQ'], variable_refs: ['SYM-n'], parameter_refs: [], equation_refs: [], constraints: [], objective: 'minimize expected inspections', dependencies: [] } },
  ],
})

/**
 * 同一份容器的**有毛病版**：`A-ONESIDED` 声明了两次。
 *
 * 这不是编出来的坏例子——四轮真实运行里 "同一 id 声明两次" 是最高频的
 * 准入拒绝之一（W8.9 run-3 的 `conflicting_id`）。它也是**提交时可判**的，
 * 正是自检工具该拦住的东西。
 */
const DUPLICATE_ID_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    { kind: 'SymbolSpec', value: { symbol_id: 'SYM-n', scope_ref: 'P1', token: 'n', meaning: 'sample size', unit: '1', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', scope_ref: 'P1', statement: 'one-sided exact binomial test', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用单侧精确二项检验而不是正态近似' } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', scope_ref: 'P1', statement: 'a second declaration of the same id', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'LOW', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用序贯抽样并设计有效停止边界' } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-SEQ', scope_ref: 'P1', statement: 'sequential sampling with a stopping boundary', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用序贯抽样并设计有效停止边界' } },
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['A-ONESIDED', 'A-SEQ'], variable_refs: ['SYM-n'], parameter_refs: [], equation_refs: [], constraints: [], objective: 'minimize expected inspections', dependencies: [] } },
  ],
})

/**
 * 复现**全轮次最高频的那条拒绝**：模型的 `equation_refs` 引用了另一个子问题的方程。
 *
 * 形态取自 strict-9 真实运行（`'EQ-PROFIT-DEF' is scoped outside the referencing
 * object's scopes`）——模型把两个子问题共用的方程只声明了一份、挂在 P1 上，
 * 然后从 P2 的模型里引用它。
 */
const CROSS_SCOPE_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', scope_ref: 'P1', statement: 'one-sided exact binomial test', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用单侧精确二项检验而不是正态近似' } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-SEQ', scope_ref: 'P1', statement: 'sequential sampling with a stopping boundary', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用序贯抽样并设计有效停止边界' } },
    { kind: 'EquationSpec', value: { equation_id: 'EQ-PROFIT-DEF', scope_ref: 'P1', expression: 'pi = R - C', representation: 'SYMPY', lhs_symbols: ['SYM-n'], rhs_symbols: [], equation_type: 'DEFINITION', unit: 'dimensionless', depends_on: [], source: 'DERIVED', e1_span: '本题是抽样检验 + 生产决策' } },
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['A-ONESIDED', 'A-SEQ'], variable_refs: [], parameter_refs: [], equation_refs: ['EQ-PROFIT-DEF'], constraints: [], objective: 'minimize expected inspections', dependencies: [] } },
    { kind: 'ModelSpec', value: { model_id: 'M2', problem_refs: ['P2'], assumption_refs: [], variable_refs: [], parameter_refs: [], equation_refs: ['EQ-PROFIT-DEF'], constraints: [], objective: 'maximize profit', dependencies: [] } },
  ],
})

// ---------------------------------------------------------------------------
// 一个会调用工具的 fake provider
// ---------------------------------------------------------------------------

/** 一次 E2 调用的剧本：要么给最终文本，要么调一次工具。 */
type Script =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool'; readonly containerJson: string; readonly argumentsRaw?: string }

interface HarnessResult {
  readonly outcome: { status: 'resolved' | 'rejected'; message: string }
  /** 每次 provider 调用看到的 system+messages 全文（用于断言"回灌到了"）。 */
  readonly prompts: ReadonlyArray<string>
  /** E2 调用次数（E1 与 reviewer 不算）。 */
  readonly e2Calls: number
  readonly toolResultTexts: ReadonlyArray<string>
  /**
   * 单次节点尝试里**被执行过**的工具调用的最大深度。
   *
   * 深度 = 本请求里 tool-result 块的个数；节点重试会让它回到 0，因此它读的是
   * "一个回合内到底执行了几次工具"，与重试次数无关——正是轮次上限要钉的量。
   */
  readonly maxToolDepth: number
  /**
   * 收到过"停止调用工具、给最终答案"这条指令的 E2 调用次数。
   *
   * 这是"到顶之后**真的又取了一次**"的**唯一**判据：修复前，循环在把指令压进
   * 对话之后就退出了，于是这条指令被写进对话却**从未被任何一次调用看到**——
   * 计数为 0。只看"指令出现在 prompts 里"会被这个假象骗过（它确实出现过）。
   */
  readonly finalRounds: number
  readonly auditKinds: ReadonlyArray<string>
  /** 每次自检调用记下的结论（审计里 `E2SelfCheckCall` 的 detail）。 */
  readonly selfCheckDetails: ReadonlyArray<{ admissible?: unknown; problem_count?: unknown; problems?: unknown }>
  readonly irKinds: ReadonlyArray<string>
}

async function runWithScript(script: ReadonlyArray<Script>): Promise<HarnessResult> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)

  const prompts: string[] = []
  const toolResultTexts: string[] = []
  let e1Done = false
  let e2Calls = 0
  let maxToolDepth = 0
  let finalRounds = 0

  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({
      route: { role: 'executor', provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 },
      model: { provider: 'fake', id: 'fake-model', name: 'fake-model' },
    }),
    stream: (request: { system?: string; messages?: ReadonlyArray<{ content?: unknown }>; tools?: ReadonlyArray<{ name?: string }> }) => {
      const system = String(request.system ?? '')
      // 消息拍平：文本块与**工具结果块**都要收——漏掉后者就看不到回灌，
      // 测试会假绿（这正是要防的失效方式之一）。
      const parts: string[] = []
      // 这一轮是不是工具回路的**续轮**：判据是消息里有没有 tool-result 块。
      // 续轮的个数（= 本请求里 tool-result 的个数）恰好就是本回合内的调用序号，
      // 于是剧本下标可以**只由请求本身**决定，不需要外部计数器——节点重试时
      // 新尝试没有 tool-result，自然回到剧本头部。
      let toolResultsInRequest = 0
      void 0
      for (const message of request.messages ?? []) {
        const content = (message as { content?: unknown }).content
        if (typeof content === 'string') { parts.push(content); continue }
        if (!Array.isArray(content)) continue
        for (const part of content as ReadonlyArray<{ type?: string; text?: string; content?: unknown }>) {
          if (part?.type === 'text') parts.push(part.text ?? '')
          else if (part?.type === 'tool-result') {
            const inner = part.content
            const flat = Array.isArray(inner)
              ? (inner as ReadonlyArray<{ text?: string }>).map(p => p?.text ?? '').join('')
              : ''
            parts.push(flat)
            toolResultTexts.push(flat)
            toolResultsInRequest += 1
            maxToolDepth = Math.max(maxToolDepth, toolResultsInRequest)
          }
        }
      }
      const seen = `${system}\n${parts.join(' ')}`
      prompts.push(seen)
      // 这一轮是否看到了"停止调用工具、给最终答案"那条指令——"到顶之后是否
      // **真的又取了一次**"只能这样观测：指令被写进对话 ≠ 有调用读过它。
      const sawFinalInstruction = seen.includes('Do not call') && seen.includes('FINAL')

      const isE1 = seen.includes('Write a modeling analysis in prose')
      const isE2 = seen.includes('NORMALIZING a modeling analysis')

      let blocks: ReadonlyArray<Record<string, unknown>> = []
      if (system.includes('reviewer')) {
        blocks = [{ type: 'text', text: '{"defects":[]}' }]
      } else if (seen.includes('numbered execution plan')) {
        blocks = [{ type: 'text', text: '1. do it' }]
      } else if (isE1 && !e1Done) {
        e1Done = true
        blocks = [{ type: 'text', text: E1_SAMPLE }]
      } else if (isE2) {
        e2Calls += 1
        if (sawFinalInstruction) finalRounds += 1
        const step = script[Math.min(toolResultsInRequest, script.length - 1)]
        if (step !== undefined && step.kind === 'tool') {
          // 一次纯工具调用：**没有文本块**，finish 必须是 `stop`
          // （`max-tokens` 会让 assembler 丢掉工具调用）。
          blocks = [{
            type: 'tool-call',
            id: 'call-1',
            name: SELF_CHECK_TOOL_NAME,
            arguments: step.argumentsRaw ?? JSON.stringify({ container_json: step.containerJson }),
          }]
        } else {
          blocks = [{ type: 'text', text: step?.kind === 'text' ? step.text : GOOD_CONTAINER }]
        }
      } else {
        blocks = [{ type: 'text', text: GOOD_CONTAINER }]
      }

      return (async function* () {
        for (let index = 0; index < blocks.length; index += 1) {
          const block = blocks[index]!
          yield { type: 'block-start', index, blockType: block['type'] === 'tool-call' ? 'tool-call' : 'text' }
          if (block['type'] === 'tool-call') {
            yield { type: 'tool-call-delta', index, id: block['id'], name: block['name'], argumentsDelta: block['arguments'] }
          } else {
            yield { type: 'text-delta', index, text: block['text'] }
          }
          yield { type: 'block-end', index, block }
        }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
        yield { type: 'finish', index: 0, reason: { kind: 'stop' as const } }
      })()
    },
  } as never)

  const routes = { provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 }
  await ctx.plugin(PaperSettingsService, { executor: routes, reviewer: routes, editorAi: routes, defaultMode: 'exploratory' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperArtifactBodyService, {})
  await ctx.plugin(PaperExecutorService, { produceFromExecute: true, deliveryGradeMode: 'fail-soft', backoffBaseMs: 1, backoffCapMs: 1 })

  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:w12a1' })
  const runId = RunId(started.id)
  const outcome = await ctx.paperExecutor.runs.execute(runId, 'solve the sampling problem')
    .then(() => ({ status: 'resolved' as const, message: '' }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }))

  const auditKinds = ctx.paperAudit.list(runId).map((e: { eventType: string; detail?: { kind?: string } }) =>
    `${e.eventType}:${String(e.detail?.kind ?? '')}`)
  return {
    outcome,
    prompts,
    e2Calls,
    toolResultTexts,
    maxToolDepth,
    finalRounds,
    auditKinds,
    selfCheckDetails: ctx.paperAudit.list(runId)
      .filter((e: { detail?: { kind?: string } }) => e.detail?.kind === 'E2SelfCheckCall')
      .map((e: { detail?: unknown }) => e.detail as { admissible?: unknown; problem_count?: unknown; problems?: unknown }),
    irKinds: ir.list().map(r => r.kind),
  }
}

// ---------------------------------------------------------------------------
// ⓪ 纯函数层：判据本身
// ---------------------------------------------------------------------------

describe('W12-A1a — checkCandidateContainer 的判据', () => {
  it('抓得住重复 id（这是它存在的主要理由之一）', () => {
    const verdict = checkCandidateContainer(DUPLICATE_ID_CONTAINER, { scopeRefs: ['P1'], e1Text: E1_SAMPLE })
    expect(verdict.admissible).toBe(false)
    expect(verdict.problems.some(p => p.includes('A-ONESIDED'))).toBe(true)
    expect(verdict.summary).toContain('问题')
  })

  it('修好之后判可准入', () => {
    const verdict = checkCandidateContainer(GOOD_CONTAINER, { scopeRefs: ['P1'], e1Text: E1_SAMPLE })
    expect(verdict.problems, JSON.stringify(verdict.problems)).toEqual([])
    expect(verdict.admissible).toBe(true)
  })

  it('**如实列出判不了的东西**——"检查过了"不得被读成"全对"', () => {
    const verdict = checkCandidateContainer(GOOD_CONTAINER, { scopeRefs: ['P1'], e1Text: E1_SAMPLE })
    expect(verdict.notChecked.length).toBeGreaterThan(0)
    expect(verdict.notChecked.some(n => n.includes('numeric_config.json'))).toBe(true)
    expect(verdict.notChecked.some(n => n.includes('jsonPath'))).toBe(true)
  })

  it('拿不到 E1 全文时**明说跳过锚定**，而不是假装通过', () => {
    const verdict = checkCandidateContainer(GOOD_CONTAINER, { scopeRefs: ['P1'] })
    expect(verdict.notChecked.some(n => n.includes('E1'))).toBe(true)
    // 跳过锚定 ≠ 通过：锚定问题不进 problems，但它出现在 notChecked 里
    expect(verdict.problems.some(p => p.includes('假设'))).toBe(false)
  })

  it('缺 ModelSpec 的子问题被点名（逐问覆盖）', () => {
    const verdict = checkCandidateContainer(GOOD_CONTAINER, { scopeRefs: ['P1', 'P2'], e1Text: E1_SAMPLE })
    expect(verdict.admissible).toBe(false)
    expect(verdict.problems.some(p => p.includes('P2'))).toBe(true)
  })

  it('抓得住 REF-003 跨子问题引用（全轮次最高频的那条拒绝）', () => {
    // M2 属于 P2，却引用了作用在 P1 的 EQ-PROFIT-DEF。这条判据**提交时可判**
    // ——容器自己就带着 scope_ref 与 problem_refs，不需要 store、不需要跑代码。
    const verdict = checkCandidateContainer(CROSS_SCOPE_CONTAINER, { scopeRefs: ['P1', 'P2'], e1Text: E1_SAMPLE })
    expect(verdict.admissible).toBe(false)
    const problem = verdict.problems.find(p => p.includes('EQ-PROFIT-DEF'))
    expect(problem, JSON.stringify(verdict.problems)).toBeDefined()
    // 提示必须给出**两条**合法路线（只给禁令会换一种方式违反）
    expect(problem).toContain('shared')
    expect(problem).toContain('P1')
    expect(problem).toContain('P2')
  })

  it('反向守卫：同一条方程声明成 shared 之后放行（不误报）', () => {
    // 例外必须窄但必须存在：写 shared 与逐问复制两份，都是合法路线。
    const shared = JSON.parse(CROSS_SCOPE_CONTAINER) as { entries: Array<{ kind: string; value: Record<string, unknown> }> }
    const eq = shared.entries.find(e => e.kind === 'EquationSpec')
    expect(eq).toBeDefined()
    eq!.value['shared'] = true
    const verdict = checkCandidateContainer(JSON.stringify(shared), { scopeRefs: ['P1', 'P2'], e1Text: E1_SAMPLE })
    expect(verdict.problems, JSON.stringify(verdict.problems)).toEqual([])
  })

  it('反向守卫：逐问各声明一份（id 不同）也放行', () => {
    const duplicated = JSON.parse(CROSS_SCOPE_CONTAINER) as { entries: Array<{ kind: string; value: Record<string, unknown> }> }
    const eq = duplicated.entries.find(e => e.kind === 'EquationSpec')!
    duplicated.entries.push({ kind: 'EquationSpec', value: { ...eq.value, equation_id: 'EQ-PROFIT-DEF-P2', scope_ref: 'P2' } })
    const m2 = duplicated.entries.find(e => e.kind === 'ModelSpec' && e.value['model_id'] === 'M2')!
    m2.value['equation_refs'] = ['EQ-PROFIT-DEF-P2']
    const verdict = checkCandidateContainer(JSON.stringify(duplicated), { scopeRefs: ['P1', 'P2'], e1Text: E1_SAMPLE })
    expect(verdict.problems, JSON.stringify(verdict.problems)).toEqual([])
  })

  it('抓得住闭 schema 违规（strict-10 实测：EquationSpec 里多了个 `token`）', () => {
    // 落盘证据（strict-10 attempt 2）：
    //   entry 'EquationSpec' violates its closed IR schema — Unrecognized key: "token"
    // 工具当时只报了"JSON 解析失败"——**闭 schema 它能查却没查**。它是最机械
    // 可判的一类（字段名对不对），没有理由留给准入去发现。
    const bad = JSON.parse(GOOD_CONTAINER) as { entries: Array<{ kind: string; value: Record<string, unknown> }> }
    bad.entries.push({ kind: 'EquationSpec', value: {
      equation_id: 'EQ-1', scope_ref: 'P1', token: 'pi', expression: 'pi = R - C',
      representation: 'SYMPY', lhs_symbols: ['SYM-n'], rhs_symbols: [],
      equation_type: 'DEFINITION', unit: 'dimensionless', depends_on: [], source: 'DERIVED',
      e1_span: '本题是抽样检验 + 生产决策',
    } })
    const verdict = checkCandidateContainer(JSON.stringify(bad), { scopeRefs: ['P1'], e1Text: E1_SAMPLE })
    expect(verdict.admissible).toBe(false)
    const problem = verdict.problems.find(p => p.includes('EquationSpec'))
    expect(problem, JSON.stringify(verdict.problems)).toBeDefined()
    expect(problem).toContain('token')
  })

  it('合法的容器不会被闭 schema 检查误报（反向守卫）', () => {
    const verdict = checkCandidateContainer(GOOD_CONTAINER, { scopeRefs: ['P1'], e1Text: E1_SAMPLE })
    expect(verdict.problems, JSON.stringify(verdict.problems)).toEqual([])
  })

  it('不认识的 entry kind 被点名，而不是静默跳过', () => {
    const bad = JSON.parse(GOOD_CONTAINER) as { entries: Array<{ kind: string; value: Record<string, unknown> }> }
    bad.entries.push({ kind: 'NotAKind', value: { id: 'X' } })
    const verdict = checkCandidateContainer(JSON.stringify(bad), { scopeRefs: ['P1'], e1Text: E1_SAMPLE })
    expect(verdict.admissible).toBe(false)
    expect(verdict.problems.some(p => p.includes('NotAKind'))).toBe(true)
  })

  it('解析不了的文本回一句原因，不抛异常', () => {
    const verdict = checkCandidateContainer('{ not json', { scopeRefs: ['P1'] })
    expect(verdict.admissible).toBe(false)
    expect(verdict.problems.length).toBe(1)
    expect(verdict.summary).toContain('不可准入')
  })
})

// ---------------------------------------------------------------------------
// ① 主判据：工具被调用，且**结果真的回到了模型**
// ---------------------------------------------------------------------------

describe('W12-A1b — 工具回路', () => {
  it('E2 调一次工具 → 问题被回灌 → 第二轮给出修好的容器', async () => {
    const result = await runWithScript([
      { kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER },
      { kind: 'text', text: GOOD_CONTAINER },
    ])

    // ① 回路真的转了：E2 被调了两次（工具轮 + 最终答案轮）。
    expect(result.e2Calls, 'the tool round plus the final round').toBe(2)

    // ② **回灌**：第二轮 E2 的 prompt 里带着工具给出的那条问题。
    //    这一条才是主判据——"工具被调用过"可以在回灌断掉时依然为真。
    const secondE2 = result.prompts.filter(p => p.includes('NORMALIZING a modeling analysis'))[1]
    expect(secondE2, 'the second E2 call must exist').toBeDefined()
    expect(secondE2, 'the tool verdict must reach the model').toContain('A-ONESIDED')
    expect(secondE2).toContain('出现了两次')

    // ③ 工具结果走的是 tool-result 消息，不是伪装成用户指令的文本。
    expect(result.toolResultTexts.length).toBe(1)

    // ④ 审计里留下了这次自检（可取证）——**逐条**那条记在跑判据之前，
    //    所以即使判据随后崩掉，"模型调用过工具"这一事实也已经落盘。
    expect(result.auditKinds).toContain('ir_entry_written:E2SelfCheckCall')
    expect(result.auditKinds).toContain('ir_entry_written:E2SelfCheck')

    // ⑤ 修好的容器真的进了 IR。
    expect(result.irKinds).toContain('ModelSpec')
    expect(result.outcome.status, result.outcome.message).toBe('resolved')
  })

  it('反向对照：不调用工具时**一次** E2 调用、没有 E2SelfCheck 事件', async () => {
    // 这条钉住的是"加工具之前的行为逐字不变"：老 cassette、历史对照
    // 与成本基线都以"一次 E2 调用"为前提。
    const result = await runWithScript([{ kind: 'text', text: GOOD_CONTAINER }])
    expect(result.e2Calls).toBe(1)
    expect(result.auditKinds).not.toContain('ir_entry_written:E2SelfCheck')
    expect(result.auditKinds).not.toContain('ir_entry_written:E2SelfCheckCall')
    expect(result.toolResultTexts.length).toBe(0)
  })

  it('没修好就提交 → 准入把它拒掉（工具不是放行条）', async () => {
    // 工具只**报告**问题；真正的准入仍然是门。这条防止"用了工具就当通过"。
    // 判据取"容器的条目**没有**进入 IR"——比看交付档位更硬：档位在 fail-soft
    // 下会以 DEGRADED 收尾（那是**交付**策略），而"重复 id 的容器被拒"是
    // **准入**事实。
    const result = await runWithScript([{ kind: 'text', text: DUPLICATE_ID_CONTAINER }])
    expect(result.irKinds).not.toContain('AssumptionSpec')
    expect(result.irKinds).not.toContain('ModelSpec')
    // 而修好的那份进得去（正向对照，证明上面不是"什么都没进"的假绿）。
    const good = await runWithScript([{ kind: 'text', text: GOOD_CONTAINER }])
    expect(good.irKinds).toContain('ModelSpec')
  })
})

// ---------------------------------------------------------------------------
// ② 到顶：要求最终答案，而不是零掉这一轮
// ---------------------------------------------------------------------------

describe('W12-A1c — 轮次上限', () => {
  it('模型一直调用工具 → 到顶后要求最终答案，整次尝试**不被判失败**', async () => {
    // 剧本：每一轮都只调用工具（永不给出文本）。上限之内**执行** MAX 次工具，
    // 之后那一轮的调用不再执行，改为下发"给最终答案"，并要求下一轮停止调用。
    const always: Script[] = Array.from({ length: 20 }, () => ({ kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER }))
    always.push({ kind: 'text', text: GOOD_CONTAINER })
    const result = await runWithScript(always)

    // ① **上限被真正执行**：一个回合内执行的工具调用不超过 MAX。
    //    （这一条在修复前是假的——那时的循环上界把"收最终答案"的那一轮排除在外，
    //    于是到顶直接抛出 'did not converge'，整次尝试被零掉。）
    // 上限是 6（strict-11 实测后从 3 提高：模型用 3 轮刚好走到"干净"，却不够再确认一次）。
    expect(result.maxToolDepth, 'executed tool calls within one node attempt').toBe(SELF_CHECK_MAX_ROUNDS)

    // ② 到顶后**真的又取了一次**最终答案：这条指令必须被某次调用看到过。
    //    （"指令出现在 prompts 里"不足以证明——修复前它被写进对话后就再没有
    //    任何调用读它，计数为 0。）
    expect(result.finalRounds, 'the final round must actually be taken').toBeGreaterThan(0)

    // ③ 循环**收敛**了：没有任何一次尝试以"循环不收敛"结束。
    expect(result.outcome.message).not.toContain('did not converge')
    expect(result.outcome.status, result.outcome.message).toBe('resolved')
  })

  it('到顶后仍只调用工具 → 取它的文本，不抛错（工具不是新的门）', async () => {
    // 最坏情形：模型永远不给文本。循环必须**返回值**（可能是空文本，由下游的
    // 准入去拒），而不是抛异常——抛异常会让"太爱自检"比"不自检"更差。
    // 必须用**工具永远不会批准**的容器：换成 GOOD_CONTAINER 会命中"批准即收口"，
    // 走的是另一条路径（那条路径另有专门用例）。
    const alwaysTool: Script[] = Array.from({ length: 60 }, () => ({ kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER }))
    const result = await runWithScript(alwaysTool)
    expect(result.outcome.message).not.toContain('did not converge')
    expect(result.maxToolDepth).toBe(SELF_CHECK_MAX_ROUNDS)
    expect(result.finalRounds, 'the final round must actually be taken').toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// ③ 参数写错：回一句"参数不合法"，不崩
// ---------------------------------------------------------------------------

describe('W12-A1d — 参数不合法', () => {
  it('漏掉 container_json → 工具回一句可执行的提示，循环继续', async () => {
    const result = await runWithScript([
      { kind: 'tool', containerJson: '', argumentsRaw: JSON.stringify({}) },
      { kind: 'text', text: GOOD_CONTAINER },
    ])
    expect(result.toolResultTexts.length).toBe(1)
    expect(result.toolResultTexts[0]).toContain('container_json')
    expect(result.e2Calls).toBe(2)
    expect(result.outcome.status, result.outcome.message).toBe('resolved')
  })

  it('arguments 根本不是 JSON → 同样回一句提示，不抛异常', async () => {
    const result = await runWithScript([
      { kind: 'tool', containerJson: '', argumentsRaw: '{oops' },
      { kind: 'text', text: GOOD_CONTAINER },
    ])
    expect(result.toolResultTexts.length).toBe(1)
    expect(result.e2Calls).toBe(2)
    expect(result.outcome.status, result.outcome.message).toBe('resolved')
  })
})

// ---------------------------------------------------------------------------
// ④ 自检自己崩了：说"崩了"，不说"没问题"，也不让调用失败
// ---------------------------------------------------------------------------

describe('W12-A1e — 自检的失败语义', () => {
  it('判据抛异常 → 回一句"自检未能完成"，不静默说"没问题"', () => {
    // 只读帮手崩掉时的正确答案是"这次没帮上忙"，不是"整次尝试作废"，更不是
    // 假装容器过关。strict-8 真实运行里那次 `Cannot read properties of null`
    // 正是把整次 E2 尝试作废、并且连"工具是否被调用过"都无从判断。
    const verdict = runSelfCheckSafely(() => { throw new Error('boom') }, '{}')
    expect(verdict.admissible).toBe(false)
    expect(verdict.summary).toContain('未能完成')
    expect(verdict.problems[0]).toContain('自检本身出错')
    expect(verdict.problems[0]).toContain('boom')
    expect(verdict.notChecked.join(' ')).toContain('harness 的故障')
  })

  it('判据正常时不改变结论（包装层不引入行为）', () => {
    const verdict = runSelfCheckSafely(text => checkCandidateContainer(text, { scopeRefs: ['P1'], e1Text: E1_SAMPLE }), GOOD_CONTAINER)
    expect(verdict.admissible).toBe(true)
    expect(verdict.problems).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ⑤ 工具报了什么，必须可取证；且**带得进下一次尝试**
// ---------------------------------------------------------------------------

describe('W12-A1f — 自检结论的可取证与传递', () => {
  it('审计记下工具当时的结论（"报了但它没改"与"没报"必须分得出来）', async () => {
    // strict-9 实测的缺口：模型用满 3 次工具额度，然后照样提交了工具已经指出
    // 问题的容器。而审计里只有 `calls: 3`——**看不出工具当时报了什么**，于是
    // "工具报了但它没改"与"工具根本没报"事后无法区分。
    const result = await runWithScript([
      { kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER },
      { kind: 'text', text: GOOD_CONTAINER },
    ])
    expect(result.selfCheckDetails.length).toBe(1)
    const detail = result.selfCheckDetails[0]!
    expect(detail.admissible).toBe(false)
    expect(Number(detail.problem_count)).toBeGreaterThan(0)
    expect(JSON.stringify(detail.problems)).toContain('A-ONESIDED')
  })

  it('工具报过的问题被带进下一次尝试的回灌（额度用完 ≠ 什么都没发生）', async () => {
    // 剧本：第一次尝试用满工具额度后仍提交**有毛病**的容器；第二次尝试给出
    // 修好的容器。断言：第二次尝试收到的 prompt 里带着"你自己调用的自检工具
    // 已经报出这些问题"。
    //
    // 注意这**不是**把工具变成门：准入判定一个字都没变，变的只是下一次尝试
    // 收到的提示文本。
    const result = await runWithScript([
      // 节点尝试 1：第 1 轮调工具，第 2 轮仍提交坏容器（工具报过、它没改）
      { kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER },
      { kind: 'text', text: DUPLICATE_ID_CONTAINER },
      // 节点尝试 2（剧本从头部重放）：直接给修好的
      { kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER },
      { kind: 'text', text: GOOD_CONTAINER },
    ])
    expect(result.auditKinds.filter(k => k === 'ir_entry_written:E2SelfCheck').length).toBeGreaterThanOrEqual(2)
    const guidancePrompt = result.prompts.find(p => p.includes('SELF_CHECK_REPORTED'))
    expect(guidancePrompt, 'the tool verdict must reach the next attempt').toBeDefined()
    expect(guidancePrompt).toContain('自检工具')
    // 注入的这句话必须**按构造无数字**：回灌文本会被逐行
    // `stripNumericLiterals`（E2 的零数字纪律），直接引用工具原文会被剥成乱码
    // （`e1_span 过短（3 < 10）` → `e1_span 过短（ < ）`）。
    const marker = '[SELF_CHECK_REPORTED]'
    const at = (guidancePrompt ?? '').indexOf(marker)
    expect(at, 'the injected line must be present').toBeGreaterThanOrEqual(0)
    const injectedLine = (guidancePrompt ?? '').slice(at, (guidancePrompt ?? '').indexOf(String.fromCharCode(10), at))
    expect(/[0-9]/.test(injectedLine), `digits leaked into the guidance: ${injectedLine}`).toBe(false)
  })

  it('工具说没问题时不注入这条回灌（不产生假告警）', async () => {
    const result = await runWithScript([
      { kind: 'tool', containerJson: GOOD_CONTAINER },
      { kind: 'text', text: GOOD_CONTAINER },
    ])
    expect(result.prompts.some(p => p.includes('SELF_CHECK_REPORTED'))).toBe(false)
  })
})

describe('W12-A1g — 自检问题 → 回灌类别句（无数字）', () => {
  const Q = String.fromCharCode(39)

  it('类别句不含数字（它会被 e2DriftGuidance 逐行剥数字）', () => {
    const sentence = selfCheckCategorySentence([
      '容器无法解析：model output is not JSON: SyntaxError: Expected , at position 9195',
      '[B3 正向（声明须逐字锚定 E1）] A-X: e1_span 过短',
    ])
    expect(sentence).toContain('不是合法的 JSON 对象')
    expect(sentence).toContain('锚点对不上你的分析稿')
    expect(/[0-9]/.test(sentence), sentence).toBe(false)
  })

  it('每一类问题都有对应的类别名（不漏成空句）', () => {
    expect(selfCheckCategorySentence([`id ${Q}A-X${Q} 在同一个容器里出现了两次`])).toContain('出现了两次')
    expect(selfCheckCategorySentence(['这些子问题没有自己的 ModelSpec：P2'])).toContain('没有自己的模型')
    expect(selfCheckCategorySentence([`entry ${Q}EquationSpec${Q} 不符合它自己的 schema`])).toContain('schema')
    expect(selfCheckCategorySentence([`Result ${Q}R-1${Q} 的 locator 不在 run.outputBasenames 里`])).toContain('locator')
    // 认不出来的也要给一句，不能空
    expect(selfCheckCategorySentence(['某种没见过的故障'])).toBe('自检报出的问题')
    // 每个标签都必须按构造无数字——`stripNumericLiterals` 会把 `E1` 变成 `E#`。
    for (const probe of [
      '容器无法解析：x', 'schema 不符', 'id 出现了两次', '没有自己的 ModelSpec',
      'locator 不在', '作用在别的子问题', '[B3] 锚点', 'entries 空', '没见过',
    ]) {
      expect(/[0-9]/.test(selfCheckCategorySentence([probe])), probe).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// ⑥ 到顶那一轮：提交纪律（strict-11 实测出来的形态）
// ---------------------------------------------------------------------------

describe('W12-A1h — 到顶的提交纪律', () => {
  it('到顶指令点明"结论只对当时那份文本成立"', async () => {
    // 落盘证据（strict-11 attempt 1）：工具第三轮判"可准入"，模型之后仍在改，
    // 提交的文本从未被检查过，准入侧以 B3 拒了它
    // （`A-INFINITE-RETURN-LOOP: e1_span 在 E1 中找不到逐字匹配`）。
    //
    // 所以到顶那句话不是"再想想"，而是明确的提交纪律——否则"用满工具额度"
    // 会给出一种**虚假的安心**：模型以为检查过了，实际检查的是另一份文本。
    const always: Script[] = Array.from({ length: 30 }, () => ({ kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER }))
    const result = await runWithScript(always)
    const finalPrompt = result.prompts.filter(p => p.includes('NORMALIZING a modeling analysis')).at(-1) ?? ''
    expect(finalPrompt).toContain('VERBATIM')
    expect(finalPrompt).toContain('no longer applies')
    expect(finalPrompt).toContain('Do not call')
  })
})

// ---------------------------------------------------------------------------
// ⑦ 工具批准即收口（strict-12 实测：多给额度只会震荡）
// ---------------------------------------------------------------------------

describe('W12-A1i — 批准即收口', () => {
  it('工具判"可准入"之后立刻收口，不再给它继续编辑的机会', async () => {
    // 落盘证据（strict-12，额度从 3 提到 6 之后）：
    //   round 0  19,730  不可准入
    //   round 1  29,559  不可准入
    //   round 2  40,017  不可准入
    //   round 3  21,567  **可准入**   ← 已经拿到干净容器
    //   round 4  38,835  不可准入     ← 又改坏了
    //   round 5  23,271  不可准入
    // 然后提交了一份连 JSON 都不合法的文本。
    //
    // 所以"多给几轮"是**负收益**：批准就是目标状态，到达即停。
    const result = await runWithScript([
      { kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER },
      { kind: 'tool', containerJson: GOOD_CONTAINER },      // ← 批准
      // 批准后的那一轮：模型按指令把批准过的文本原样给出（这里给文本）。
      { kind: 'text', text: GOOD_CONTAINER },
      // 这一项不该被执行到——收口之后不再执行工具。
      { kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER },
    ])

    // 只执行了 2 次工具：批准那一次之后就不再执行了。
    expect(result.maxToolDepth).toBe(2)
    // 而且要求它把批准过的那份**原样**给出。
    expect(result.prompts.some(p => p.includes('ADMISSIBLE') && p.includes('byte for byte'))).toBe(true)
    // 最终答案取自批准后的那一轮。
    expect(result.irKinds).toContain('ModelSpec')
  })

  it('反向守卫：一直不可准入时仍然走满额度（收口不提前打断失败路径）', async () => {
    const always: Script[] = Array.from({ length: 30 }, () => ({ kind: 'tool', containerJson: DUPLICATE_ID_CONTAINER }))
    const result = await runWithScript(always)
    expect(result.maxToolDepth).toBe(SELF_CHECK_MAX_ROUNDS)
    expect(result.finalRounds, 'the forced-final round must still happen').toBeGreaterThan(0)
  })
})
