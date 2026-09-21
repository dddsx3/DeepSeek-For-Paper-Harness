/**
 * W11.5-A4 — the FLOOR guard (NR-1~4). 每一轮改动后都必须跑这一组。
 *
 * 为什么它比本轮任何新成就都重要（新总书 §0.3 / 红线 N35）：用户原话是
 * "不得影响本身就可以做到产出即可交付的能力要求"——地板一旦回退，该轮
 * **判为未达成**，无论新功能多好。本文件把这条承诺变成四条可执行断言。
 *
 * 分工（NR-3/NR-4 需要 CLI 的 zip 写出物，属 apps/paper-shell 层）：
 *   - 本文件：NR-1（E2 必败仍交付）、NR-2（BLOCKED 仅限零内容）
 *   - `apps/paper-shell/tests/non-regression.spec.ts`：NR-3（zip 自包含）、
 *     NR-4（非专有格式）
 * 任务总书原稿给的路径是 `src/delivery/non-regression.spec.ts`——测试不属于
 * src（构建产物会把它带上），故落在 `tests/delivery/`，此处显式记录该偏差。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/non-regression
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../../src/runtime/profile.ts'
import {
  PaperArtifactBodyService,
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../../src/index.ts'
import { ModelingIr } from '../../src/ir/store.ts'
import { gradeDelivery, renderDeliveryAppendix } from '../../src/delivery/delivery-grade.ts'

// ---------------------------------------------------------------------------
// Fixtures: the E2-must-fail pair (the same pair the W8.12 suite uses to drive
// the fallback). Keeping them local makes this file's dependency surface the
// receive layer only — a guard that breaks when its fixtures move is useless.
// ---------------------------------------------------------------------------

const E1_SAMPLE = [
  '审题：本题是抽样检验 + 生产决策。',
  '[[REQUIREMENT: R-OUT]] 问题 1 要求设计检测次数尽可能少的抽样方案。',
  '[[ASSUMPTION: A-ONESIDED]] 采用单侧精确二项检验而不是正态近似，因为小样本下近似会低估尾部概率。',
  '[[ASSUMPTION: A-SEQ]] 采用序贯抽样并设计有效停止边界，以最小化期望检测次数。',
  '问题 2 需要枚举零配件检测、成品检测与拆解的 16 种固定策略。',
].join('\n')

/** E2 output that violates the anchor-identity rule → fidelity refuses it. */
const E2_REFUSED_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    { kind: 'SymbolSpec', value: { symbol_id: 'SYM-n', scope_ref: 'P1', token: 'n', meaning: 'sample size', unit: '1', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'A-INVENTED', scope_ref: 'P1', statement: 'This assumption appears nowhere in the analysis.', source_type: 'MODELING_CHOICE', justification_refs: [], risk_level: 'LOW', testable: false, sensitivity_refs: [], status: 'ACTIVE', e1_span: '采用单侧精确二项检验而不是正态近似' } },
    { kind: 'ModelSpec', value: { model_id: 'M-1', problem_refs: ['P1'], assumption_refs: ['A-INVENTED'], variable_refs: ['SYM-n'], parameter_refs: [], equation_refs: [], constraints: [], objective: null, dependencies: [] } },
  ],
  narrative: { title: 't' },
})

const routes = {
  executor: { provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'fake-model', credentialRef: 'c', timeoutMs: 1000 },
}

/** Drive one full run through the receive layer with scripted model answers. */
async function runWith(outputs: ReadonlyArray<string>, opts?: { failSoft?: boolean }) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  let index = 0
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'fake-model', name: 'fake-model' } }),
    stream: (request: { system?: string; messages?: ReadonlyArray<{ content?: unknown }> }) => {
      const system = String(request.system ?? '')
      let text = ''
      if (system.includes('reviewer')) text = '{"defects":[]}'
      else if (`${system}${(request.messages ?? []).map(m => String((m as { content?: unknown }).content ?? '')).join(' ')}`.includes('numbered execution plan')) text = '1. do it'
      else { text = outputs[Math.min(index, outputs.length - 1)] ?? ''; index += 1 }
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
  await ctx.plugin(PaperArtifactBodyService, {})
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    ...(opts?.failSoft === true ? { deliveryGradeMode: 'fail-soft' as const } : {}),
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:nr' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'solve the sampling problem')
    .then(() => ({ status: 'resolved' as const, message: '' }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }))
  return { ctx, engine, runId: started.id, outcome }
}

// ---------------------------------------------------------------------------
// NR-1 — 任何输入下最终产出非空交付物
// ---------------------------------------------------------------------------

describe('NR-1 — E2 必败输入仍产出非空交付物（fail-soft）', () => {
  it('E2 三连败 → 运行 resolve（不是 BLOCKED），交付体是 E1 全文', async () => {
    const { ctx, engine, runId, outcome } = await runWith([E1_SAMPLE, E2_REFUSED_CONTAINER], { failSoft: true })
    expect(outcome.status, outcome.message).toBe('resolved')
    expect(engine.getRun(runId)?.status).toBe('completed')
    // the deliverable really exists and carries the analysis
    const kinds = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(kinds).toContain('e1_direct_delivery')
    expect(kinds).toContain('final_output_written')
    // W11.5-A2: the path is declared, not inferred
    expect(engine.getManifest(runId)?.delivery_path).toBe('B-e1-direct')
  })

  it('交付等级为 MARKED（不是 CLEAN——附录如实列出未通过项）', async () => {
    const { ctx, runId } = await runWith([E1_SAMPLE, E2_REFUSED_CONTAINER], { failSoft: true })
    const graded = ctx.paperAudit.list(runId).find((e: { eventType: string }) => e.eventType === 'delivery_graded')
    expect(graded?.detail?.grade).toBe('MARKED')
  })
})

// ---------------------------------------------------------------------------
// NR-2 — BLOCKED 仅出现在"真正零内容"
// ---------------------------------------------------------------------------

describe('NR-2 — BLOCKED 的唯一触发条件是零内容', () => {
  it('"有 E1 但 E2 失败"不得 BLOCKED（构造性反例）', async () => {
    const { engine, runId } = await runWith([E1_SAMPLE, E2_REFUSED_CONTAINER], { failSoft: true })
    const manifest = engine.getManifest(runId)
    // A delivered manifest for a failed-E2 run is the whole point of the
    // fallback: BLOCKED would have thrown before any manifest existed.
    expect(manifest).toBeDefined()
    expect(engine.getRun(runId)?.status).not.toBe('failed')
  })

  it('gradeDelivery: 只有三个 fatal 条件能产生 BLOCKED（闭集）', () => {
    const failures = [{ kind: 'critical_gate', reason: 'x' }]
    for (const fatal of [
      { emptyContent: true, executionFailed: false, referenceCatastrophe: false },
      { emptyContent: false, executionFailed: true, referenceCatastrophe: false },
      { emptyContent: false, executionFailed: false, referenceCatastrophe: true },
    ]) {
      expect(gradeDelivery(failures, fatal).grade).toBe('BLOCKED')
    }
    // failures alone (no fatal condition) degrade to MARKED — never BLOCKED.
    expect(gradeDelivery(failures, { emptyContent: false, executionFailed: false, referenceCatastrophe: false }).grade).toBe('MARKED')
    // and a clean run with a fatal condition still blocks (the fatal list is
    // not bypassable by "no failures").
    expect(gradeDelivery([], { emptyContent: true, executionFailed: false, referenceCatastrophe: false }).grade).toBe('BLOCKED')
  })

  it('MARKED 附录非空且逐项列出（交付物不靠沉默掩盖未通过项）', () => {
    const appendix = renderDeliveryAppendix('MARKED', [{ kind: 'e2_normalization_failed', reason: 'r', location: 'delivery' }])
    expect(appendix).toContain('MARKED')
    expect(appendix).toContain('e2_normalization_failed')
    expect(renderDeliveryAppendix('CLEAN', [])).toBe('')
  })
})


// ---------------------------------------------------------------------------
// W11.5-A1 — 记号归一的负对照：放宽的是"记号"，不是"判定"
// ---------------------------------------------------------------------------

describe('W11.5-A1 — jsonPath 记号归一不放过真错误', () => {
  it('`$.a.b` 与 `a.b` 解析到同一个值（记号等价）', async () => {
    const { resolveJsonPath } = await import('../../src/produce/interpretation-producer.ts')
    const root = { a: { b: 7 } }
    expect(resolveJsonPath(root, '$.a.b')).toBe(7)
    expect(resolveJsonPath(root, 'a.b')).toBe(7)
    expect(resolveJsonPath(root, '$')).toBe(root)
  })

  it('指向不存在的键仍然解析为 undefined（构造性反例：记号容忍不是路径容忍）', async () => {
    const { resolveJsonPath } = await import('../../src/produce/interpretation-producer.ts')
    const root = { a: { b: 7 } }
    expect(resolveJsonPath(root, '$.a.c')).toBeUndefined()
    expect(resolveJsonPath(root, 'a.c')).toBeUndefined()
    expect(resolveJsonPath(root, '$.')).toBe(root)
  })
})

describe('W11.5-A1 — 数学定界符折叠不放过真改写', () => {
  it('只差 $ 的引用通过；改动实词/数字/关系的引用仍失败（构造性反例）', async () => {
    const { foldForAnchorMatch } = await import('../../src/produce/e1-e2.ts')
    const e1 = '样本中次品数服从二项分布 $B(n,p)$，取$p_1>p_0$。'
    const e1Folded = foldForAnchorMatch(e1)
    // the W10-MQUAL attempt-1 quote: same words, delimiters dropped
    expect(e1Folded.includes(foldForAnchorMatch('样本中次品数服从二项分布 B(n,p)'))).toBe(true)
    // the real rewrite from the same attempt: a DIFFERENT relation
    expect(e1Folded.includes(foldForAnchorMatch('取p_1=0.20'))).toBe(false)
    // a swapped number must still fail
    expect(e1Folded.includes(foldForAnchorMatch('样本中次品数服从二项分布 $B(n,0.5)$'))).toBe(false)
  })

  it('W11.5 扩展：下标/上标/强调/转义括号都是渲染差异（真实运行证据）', async () => {
    const { foldForAnchorMatch } = await import('../../src/produce/e1-e2.ts')
    // run-5: E1 `p = p₀ 处` quoted as `p=p0处`（相似度 97.1%）
    const e1 = '情形(2) 只约束 p = p₀ 处的接收概率 ≥ 90%。'
    expect(foldForAnchorMatch(e1).includes(foldForAnchorMatch('只约束p=p0处的接收概率≥90%'))).toBe(true)
    // run-3: 强调标记位置移动（`**线性函数**` ↔ `**线性**函数`）
    const bold = '次品率的**线性函数**(因为所属区间)'
    expect(foldForAnchorMatch(bold).includes(foldForAnchorMatch('次品率的**线性**函数(因为所属区间)'))).toBe(true)
    // run-2: LaTeX 转义括号 —— 折叠后与普通括号等价（`\(p_f\)` ↔ `(p_f)`）。
    const escaped = '独立,成品次品率\\(p_f\\)是给定常数'
    expect(foldForAnchorMatch(escaped).includes(foldForAnchorMatch('独立,成品次品率(p_f)是给定常数'))).toBe(true)
    // W11.5 baseline-1 反转（首次真实产出实测）：原断言把"整个丢掉括号"判为
    // 内容差异、折叠不吸收——**被真实运行推翻**：E1 `参数为(p)的伯努利分布`
    // vs E2 span `参数为p的伯努利分布,`，三次尝试全部被 B3 正向拒绝（相似度
    // 52.8%，首分歧 @28），运行退化为 B-e1-direct。括号是分组，不是内容；
    // 折叠现在吸收它，内容差异仍由字词/数字/下标负对照守住。
    expect(foldForAnchorMatch(escaped).includes(foldForAnchorMatch('独立,成品次品率p_f是给定常数'))).toBe(true)
    expect(foldForAnchorMatch(escaped).includes(foldForAnchorMatch('独立,成品次品率p_g是给定常数'))).toBe(false)
  })

  it('W11.5 扩展的负对照：字词/数字改写仍失败', async () => {
    const { foldForAnchorMatch } = await import('../../src/produce/e1-e2.ts')
    const e1 = foldForAnchorMatch('情形(2) 只约束 p = p₀ 处的接收概率 ≥ 90%。')
    expect(e1.includes(foldForAnchorMatch('只约束p=p0处的接收概率≥95%'))).toBe(false) // 数字改
    expect(e1.includes(foldForAnchorMatch('只约束p=p1处的接收概率≥90%'))).toBe(false) // 下标改
    expect(e1.includes(foldForAnchorMatch('只约束p=p0处的风险≤90%'))).toBe(false) // 词改
  })
})

// ---------------------------------------------------------------------------
// W11.5 baseline-1（首次真实产出实测）—— 折叠缺口：括号 + 半/全角标点。
// 证据：E1 `品状态服从参数为(p)的伯努利分布` vs E2 span
// `品状态服从参数为p的伯努利分布,`（括号丢失 + 半角逗号），三次尝试全部被
// B3 正向拒绝（相似度 52.8%，首分歧 @28），运行退化为 B-e1-direct。
// ---------------------------------------------------------------------------
describe('W11.5 baseline-1 — 折叠扩展（括号/标点）与负对照', () => {
  it('括号围绕短符号是渲染差异：`(p)` 与 `p` 折叠后一致', async () => {
    const { foldForAnchorMatch } = await import('../../src/produce/e1-e2.ts')
    const e1 = foldForAnchorMatch('品状态服从参数为(p)的伯努利分布')
    expect(e1.includes(foldForAnchorMatch('品状态服从参数为p的伯努利分布'))).toBe(true)
  })

  it('半角/全角逗号是渲染差异（E2 的 `,` 匹配 E1 的 `，`）', async () => {
    const { foldForAnchorMatch } = await import('../../src/produce/e1-e2.ts')
    expect(foldForAnchorMatch('伯努利分布,相互独立').includes(foldForAnchorMatch('伯努利分布，相互独立'))).toBe(true)
  })

  it('负对照：字词/数字改写仍然失败（折叠没有放松内容）', async () => {
    const { foldForAnchorMatch } = await import('../../src/produce/e1-e2.ts')
    const e1 = foldForAnchorMatch('品状态服从参数为(p)的伯努利分布')
    expect(e1.includes(foldForAnchorMatch('品状态服从参数为q的伯努利分布'))).toBe(false) // 符号改
    expect(e1.includes(foldForAnchorMatch('品状态服从参数为(p)的正态分布'))).toBe(false) // 分布改
    expect(e1.includes(foldForAnchorMatch('品状态服从参数为(p0)的伯努利分布'))).toBe(false) // 下标加
  })
})

// ---------------------------------------------------------------------------
// W11.5 baseline-4（首次真实产出实测）—— 修订不得摧毁稿子。
// 证据：交付的 report.md 竟是**题目原文**（编辑器拿到 `Task: <题面>` 后把题面
// 当"corrected text"返回，交付流直接采用）。预检能拒，但交付动作本身就不该
// promote 非稿子内容 → 结构守卫：章节标题集合必须保留、篇幅不得塌缩过半。
// ---------------------------------------------------------------------------
describe('W11.5 baseline-4 — 修订结构守卫（负对照：题面冒充修订）', () => {
  const DRAFT = [
    '# 建模分析稿（E1 直通交付）',
    '## 摘要', '说明…',
    '## 问题重述', '题面复述…',
    '## 模型建立与求解', 'E1 全文…',
    '## 结果对比与校核', '结果…',
  ].join('\n')

  it('编辑器返回题面（丢章节）→ 拒绝该次修订', async () => {
    const { revisionDestroysDraft } = await import('../../src/executor.ts')
    const taskStatement = '# 2024 年高教社杯全国大学生数学建模竞赛题目\n\n## B 题 生产过程中的决策问题\n\n某企业生产…（题面复制）'
    const verdict = revisionDestroysDraft(DRAFT, taskStatement)
    expect(verdict.rejected).toBe(true)
    expect(String(verdict.reason)).toContain('section heading')
  })

  it('修订塌缩到一半以下 → 拒绝（即使标题侥幸保留）', async () => {
    const { revisionDestroysDraft } = await import('../../src/executor.ts')
    const collapsed = DRAFT.split('\n').map(l => (l.startsWith('##') ? l : '')).join('\n')
    expect(revisionDestroysDraft(DRAFT, collapsed).rejected).toBe(true)
  })

  it('正常修订（保留章节、篇幅相当）→ 接受', async () => {
    const { revisionDestroysDraft } = await import('../../src/executor.ts')
    const improved = DRAFT.replace('说明…', '说明（已按缺陷修订，保留全部章节）……').replace('结果…', '结果（补充了校核说明）……')
    const verdict = revisionDestroysDraft(DRAFT, improved)
    expect(verdict.rejected).toBe(false)
  })
})
