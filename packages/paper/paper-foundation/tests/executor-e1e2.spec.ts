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
import { ID_FIELD_BY_KIND, isIrId } from '../src/ir/schema.ts'
import {
  e1AnalysisInstruction,
  E1_ASSUMPTION_MARKER,
  MIN_E1_SPAN_CHARS,
  checkE1E2Fidelity,
  e2NormalizationPrompt,
  fidelityOk,
  foldForAnchorMatch,
  diagnoseSpanMismatch,
  isUsableAnchorId,
  parseE1Anchors,
} from '../src/produce/e1-e2.ts'
import {
  E2_DRIFT_HEADER,
  declarableRefRules,
  e2DriftGuidance,
  e2PromptWithGuidance,
  hasNoNumericLiterals,
  hasNoNumericLiteralsOutsideIds,
  stripNumericLiterals,
} from '../src/produce/e2-guidance.ts'

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

  // -------------------------------------------------------------------------
  // W8.10-D3 — the typographic fold (a harness-side量具 fix, not a model one)
  // -------------------------------------------------------------------------

  it('ACCEPTS a span whose only difference is typography (full-width ↔ half-width)', () => {
    // 真实运行抓出的形态：模型复制了正确的句子，只是把 `）` 写成了 `)`。
    // 旧比较器（裸 includes）把它报成"疑似改写"——把 harness 的比较器限制
    // 归因给模型（红线 N2）。折叠后仍要求逐字命中。
    const findings = checkE1E2Fidelity({
      e1Text: '[[ASSUMPTION: A-PUNC]] 采用单侧精确二项检验（不是正态近似），因为小样本会低估尾部概率。',
      entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-PUNC', e1_span: '采用单侧精确二项检验(不是正态近似)' } }),
      requiredOutputIds: [],
    })
    expect(fidelityOk(findings), JSON.stringify(findings)).toBe(true)
  })

  it('ACCEPTS a span whose only difference is whitespace', () => {
    // 实测形态：E1 写 `附录 (1)`，span 写 `附录（1）`，或复制时把换行折叠了。
    const findings = checkE1E2Fidelity({
      e1Text: '[[ASSUMPTION: A-WS]] 次品率定义按附录 (1) 给出，\n  即装配后的产品次品率。',
      entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-WS', e1_span: '次品率定义按附录（1）给出，即装配后的产品次品率' } }),
      requiredOutputIds: [],
    })
    expect(fidelityOk(findings), JSON.stringify(findings)).toBe(true)
  })

  it('ACCEPTS a span whose only difference is the math delimiter ($$ ↔ $)', () => {
    const findings = checkE1E2Fidelity({
      e1Text: '[[ASSUMPTION: A-MATH]] 单位成本为 $C_1 = \\frac{c_1+d_1}{1-p_1}$ 的形式。',
      entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-MATH', e1_span: '$$C_1 = \\frac{c_1+d_1}{1-p_1}$$' } }),
      requiredOutputIds: [],
    })
    expect(fidelityOk(findings), JSON.stringify(findings)).toBe(true)
  })

  it('NEGATIVE CONTROL: the fold does NOT accept a real rewrite', () => {
    // 这是这条修法的安全边界。折叠只允许"删掉渲染差异"，不允许"删掉字词"。
    // 若这条通过，说明折叠放得太宽，凭空改写的内容会进入论文——那比误报
    // 改写危险得多（形态 4 的反面：判定与目标失去相关性）。
    const cases: ReadonlyArray<{ label: string; span: string }> = [
      { label: '实词被替换', span: '采用双侧近似二项检验而不是正态近似' },
      { label: '语序颠倒', span: '采用二项检验单侧精确而不是正态近似' },
      { label: '增加了一个词', span: '采用单侧精确二项检验而不是正态近似的方法' },
      // 删词必须从**中间**删：从尾部截断得到的是真子串，`includes` 语义下
      // 本来就该通过（改动前亦然，不是本次放宽引入的）。
      { label: '中间删掉了一个词', span: '采用单侧精确二项检验正态近似' },
      { label: '否定被去掉', span: '采用单侧精确二项检验而不是正态近似' },
    ]
    for (const c of cases) {
      const findings = checkE1E2Fidelity({
        e1Text: '[[ASSUMPTION: A-REWRITE]] 采用单侧精确二项检验而不是正态近似，因为小样本下近似会低估尾部概率。',
        entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-REWRITE', e1_span: c.span } }),
        requiredOutputIds: [],
      })
      // the last case IS the original sentence — it must pass, the rest must fail
      const isOriginal = c.span === '采用单侧精确二项检验而不是正态近似'
      expect(fidelityOk(findings), `${c.label} was accepted`).toBe(isOriginal)
    }
  })

  it('the fold is idempotent and never invents characters', () => {
    // 折叠不能凭空造字：`fold(x)` 的长度必须 ≤ 原文（只删空白、只做等长替换）。
    const cases = ['采用（1）', '$$x$$', 'a\n\n b', '（全角）']
    for (const c of cases) {
      const folded = foldForAnchorMatch(c)
      expect(folded.length, `${c} grew`).toBeLessThanOrEqual(c.length)
      expect(foldForAnchorMatch(folded)).toBe(folded)
    }
  })

  // -------------------------------------------------------------------------
  // W8.10-D5 — the failing verdict must carry its own evidence
  // -------------------------------------------------------------------------

  it('a near-match (typography only) reports ~100% similarity', () => {
    // run-4 真实运行的正向失败集三次完全相同、恒含 `A-P1-CHOICE`，报"疑似
    // 改写"——但 E1 全文与容器都没落盘，判定**事后无法核验**。这条诊断把
    // 相似度写进 finding，让已落盘的 400 字符自带证据。
    const e1 = '[[ASSUMPTION: A-X]] 采用单侧精确二项检验（不是正态近似），因为小样本会低估尾部概率。'
    const diag = diagnoseSpanMismatch('采用单侧精确二项检验(不是正态近似)', e1)
    expect(diag).toContain('100.0%')
    expect(diag).toContain('无分歧点')
  })

  it('a real rewrite reports LOW similarity and names the divergence point', () => {
    const e1 = '[[ASSUMPTION: A-X]] 采用单侧精确二项检验（不是正态近似），因为小样本会低估尾部概率。'
    const diag = diagnoseSpanMismatch('采用双侧近似二项检验而不是正态近似', e1)
    const pct = Number(/([0-9.]+)%/.exec(diag)?.[1] ?? '100')
    expect(pct, diag).toBeLessThan(80)
    expect(diag).toContain('首分歧')
  })

  it('the diagnostic is measurement only — it does NOT change the verdict', () => {
    // 安全边界：D5 只让判定可核验，不得让任何原本失败的 span 通过。
    const e1 = '[[ASSUMPTION: A-X]] 采用单侧精确二项检验而不是正态近似。'
    const findings = checkE1E2Fidelity({
      e1Text: e1,
      entries: entriesOf({ kind: 'AssumptionSpec', value: { assumption_id: 'A-X', e1_span: '采用双侧近似二项检验而不是正态近似' } }),
      requiredOutputIds: [],
    })
    const fwd = findings.find(f => f.rule.includes('正向'))!
    expect(fwd.ok).toBe(false)
    // and the evidence rode along
    expect(fwd.detail).toContain('相似度')
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

  // -------------------------------------------------------------------------
  // W8.11-A1 — the anchor id must be a USABLE NAME (not a placeholder)
  // -------------------------------------------------------------------------

  it('B5 violation: a placeholder anchor id (`...`) is caught and named', () => {
    // 真实事故（run-4）：E1 写了 `[[ASSUMPTION: ...]]`，反向检查于是报
    // "E1 标记了但 IR 未声明的假设：..."——**读者无法分辨**这是模型漏声明一条
    // 假设，还是写了个占位符。两件事的修法完全不同，而当时的文案把两者说成
    // 同一件事。这条把占位符**单独命名**。
    const e1 = '[[ASSUMPTION: ...]] 检测本身无误差。\n[[REQUIREMENT: R-OUT]] 问题 1 要求设计抽样方案。'
    const findings = checkE1E2Fidelity({ e1Text: e1, entries: [], requiredOutputIds: ['R-OUT'] })
    const b5 = findings.find(f => f.rule.includes('B5'))
    expect(b5?.ok, JSON.stringify(findings)).toBe(false)
    expect(b5?.detail).toContain('...')
    // 反向**不再**把占位符当成"一条未声明的假设"——那是范畴错误
    expect(findings.find(f => f.rule.includes('反向'))?.ok).toBe(true)
  })

  it('B5 counter-examples: placeholder / space / control chars → rejected; real names → accepted', () => {
    const cases: ReadonlyArray<{ id: string; ok: boolean; why: string }> = [
      { id: '...', ok: false, why: '全标点占位符，没命名任何东西' },
      { id: '……', ok: false, why: '中文省略号，同样是占位符' },
      { id: 'A B', ok: false, why: '含空格，下游无法逐字引用' },
      { id: 'A-EXACT-TEST', ok: true, why: '正例（指令里给的）' },
      { id: 'A_BATCH_2', ok: true, why: '正例（下划线 + 数字）' },
      { id: '假设1', ok: true, why: '**中文是合法的 IR id**——IR 刻意不折叠兼容等价字符' },
      { id: 'A-ONESIDED', ok: true, why: '正例' },
    ]
    for (const c of cases) {
      const e1 = `[[ASSUMPTION: ${c.id}]] 某条假设的正文，足够长以避开长度检查。\n[[REQUIREMENT: R-OUT]] 推理。`
      const findings = checkE1E2Fidelity({ e1Text: e1, entries: [], requiredOutputIds: ['R-OUT'] })
      expect(findings.find(f => f.rule.includes('B5'))?.ok, `${c.id} (${c.why})`).toBe(c.ok)
    }
  })

  it('B5 does NOT tighten the charset beyond what the IR accepts (no false red)', () => {
    // 方向性守卫：锚点规则**不得比 IR 自己的 id 规则更严**。IR 的策略是刻意
    // 宽松的（`problem-contract.ts`："NFC deliberately does not fold
    // compatibility equivalents … that is the same policy the IR already
    // applies to object IDs"）。若此处凭空收紧字符集，就会对 IR 本来接受的
    // id 制造**假红**——那正是本轮要消灭的形态（红线 N2）。
    // 用一个 IR 明确接受的 id 来钉住这一点。
    expect(isIrId('假设1')).toBe(true)
    expect(isUsableAnchorId('假设1')).toBe(true)
    // and the two rules agree on everything the IR accepts EXCEPT bare punctuation
    expect(isIrId('...')).toBe(true)          // IR accepts it...
    expect(isUsableAnchorId('...')).toBe(false) // ...but it is not a NAME
  })

  it('the E1 instruction states the id rule AND its reason', () => {
    // 任务书 A1 要求 ②：**理由要说清**——"只加禁令不加理由，模型会换一种
    // 方式违反"。实测正是如此：它躲开了 `<your-short-id>`，改写成 `...`。
    const instruction = e1AnalysisInstruction(['R-OUT'])
    expect(instruction).toContain('VERBATIM')
    expect(instruction).toContain('NAME')
    // 正例与反例都在（任务书 A1 要求 ①）
    expect(instruction).toContain('A-EXACT-TEST')
    expect(instruction).toContain('[[ASSUMPTION: ...]]')
    // 原有的禁令仍在（要求 ③）
    expect(instruction).toContain('Do NOT write the literal text')
    // 且**没有**把 E1 推向 JSON（W8.9 明令，任务书 A1 禁止项）
    expect(instruction).toContain('Do NOT output JSON')
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


// ---------------------------------------------------------------------------
// W8.10-B1/B2 — the drift guidance backfill
// ---------------------------------------------------------------------------

describe('W8.10-B2 — zero-numeric-literals guard (red line N12)', () => {
  it('strips every digit from a guidance fragment', () => {
    expect(stripNumericLiterals('position 4295 of 12983')).toBe('position #### of #####')
    expect(hasNoNumericLiterals(stripNumericLiterals('entity 3 at byte 0xF3'))).toBe(true)
  })

  it('COUNTER-EXAMPLE: an injected number does not survive into the guidance', () => {
    // The zero-number channel is the project's core constraint — numbers reach
    // the paper only via code -> jsonPath -> Result. The backfill is prose and
    // must not become a second entrance. Injecting one must not leak it.
    const guidance = e2DriftGuidance({
      priorViolations: [{ code: 'store_refused', reason: 'entry refused at offset 4295 with value 0.731' }],
      registeredIds: [],
    })
    expect(hasNoNumericLiterals(guidance)).toBe(true)
    expect(guidance).not.toContain('0.731')
    expect(guidance).not.toContain('4295')
  })

  it('the shipped guidance has no numeric literal outside the id list', () => {
    // ⚠ B2's scope, decided by this very test: a blanket `[0-9]` check CANNOT
    // hold, because the harness's own canonical ids carry digits — `P1` is the
    // ProblemSpec id registered by `registerInputAssets`. Stripping it would
    // rewrite the guidance to say "reference P#" and the model would be told
    // to use an id that does not exist. The invariant asserted is therefore
    // the one the zero-number channel actually needs: every digit in the
    // shipped text belongs to a registered id, none is a quantity.
    const ids = ['DA-RAW', 'R-OUT', 'P1', 'SYM-q']
    const shapes = [
      { code: 'store_refused', reason: "entry 'ModelSpec' could not be admitted: reference_kind_mismatch: 'DA-RAW' resolves to DataArtifact, expected ModelSpec" },
      { code: 'store_refused', reason: "entry 'SymbolSpec' could not be admitted: unresolved_reference: 'P(Bin(n,0.10) > c)' is not registered (expected SymbolSpec)" },
      { code: 'conflicting_id', reason: "entry 'SymbolSpec' id 'S-P' is already registered with DIFFERENT content" },
    ]
    for (const v of shapes) {
      const g = e2DriftGuidance({ priorViolations: [v], registeredIds: ids })
      expect(hasNoNumericLiteralsOutsideIds(g, ids), v.code).toBe(true)
      // and the ids survive verbatim — the guidance must remain usable
      expect(g).toContain('P1')
    }
  })

  it('the ids are NOT mangled (the failure mode a blanket strip would cause)', () => {
    const g = e2DriftGuidance({ priorViolations: [], registeredIds: ['P1', 'SYM-q'] })
    expect(g).toContain('P1')
    expect(g).not.toContain('P#')
  })
})

describe('W8.10-B1 — the three correction contents', () => {
  const VIOLATIONS = [
    { code: 'store_refused', reason: "'DA-RAW' resolves to DataArtifact, expected ModelSpec" },
    { code: 'store_refused', reason: "'P(Bin(n,x) > c)' is not registered (expected SymbolSpec)" },
    { code: 'conflicting_id', reason: "id 'S-P' is already registered with DIFFERENT content" },
  ]

  it('① carries the reference-type rules, DERIVED from the validator table', () => {
    const g = e2DriftGuidance({ priorViolations: VIOLATIONS, registeredIds: ['P1'] })
    const rules = declarableRefRules()
    expect(rules.length).toBeGreaterThan(0)
    // Every rule the validator enforces appears in the guidance — this is the
    // anti-drift property: a hand-written lecture would fall out of sync.
    expect(g).toContain('Reference rules')
    expect(g).toContain('ModelSpec.variable_refs -> SymbolSpec')
    expect(g).toContain('ModelSpec.assumption_refs -> AssumptionSpec')
  })

  it('② carries the registered id list ("never declare these again")', () => {
    const g = e2DriftGuidance({ priorViolations: VIOLATIONS, registeredIds: ['DA-RAW', 'R-OUT', 'P1'] })
    expect(g).toContain('ALREADY REGISTERED')
    for (const id of ['DA-RAW', 'R-OUT', 'P1']) expect(g).toContain(id)
  })

  it('③ carries the SPECIFIC prior violations, verbatim and per-item', () => {
    const g = e2DriftGuidance({ priorViolations: VIOLATIONS, registeredIds: [] })
    for (const v of VIOLATIONS) {
      expect(g).toContain(`[${v.code}]`)
      expect(g).toContain(v.reason.slice(0, 30))
    }
  })

  it('the FIRST attempt gets NO guidance (byte-identical to W8.9 prompt)', () => {
    // Confines the backfill to retries — and keeps a never-retrying run's
    // request byte-identical, which is what preserves the cassette corpus.
    const g = e2DriftGuidance({ priorViolations: [], registeredIds: [] })
    expect(g).toBe('')
    const base = 'BASE-PROMPT'
    expect(e2PromptWithGuidance(base, g)).toBe(base)
  })

  it('anti-drift: it does NOT restate the whole schema', () => {
    // The forbidden shape is "加强协议教学" — that would drop E2's existing
    // compliant output along with the correction.
    const g = e2DriftGuidance({ priorViolations: VIOLATIONS, registeredIds: ['P1'] })
    expect(g).toContain('Do not restate the whole schema')
    expect(g.length).toBeLessThan(4000)
    expect(g.startsWith(E2_DRIFT_HEADER)).toBe(true)
  })

  it('an id list alone still produces guidance (the duplicate-id fix works pre-emptively)', () => {
    const g = e2DriftGuidance({ priorViolations: [], registeredIds: ['S-P'] })
    expect(g).toContain('S-P')
    expect(g).toContain('ALREADY REGISTERED')
  })
})


describe('W8.10-B1 — the backfill reaches the SECOND E2 call (end to end)', () => {
  it('H7: a refused attempt is followed by an E2 prompt carrying the reason + id list', async () => {
    // Attempt 1 normalizes into a container that INVENTs an assumption ->
    // fidelity refuses. Attempt 2 must be told what was wrong. This is the
    // wiring half: the pure function is covered above, here the question is
    // whether the executor actually feeds it back.
    const { ctx, runId, outcome, prompts } = await harness([
      E1_SAMPLE,
      INVENTED_ASSUMPTION_CONTAINER,
      FAITHFUL_CONTAINER,
    ])
    expect(outcome.status, outcome.message).toBe('resolved')

    const e2Prompts = prompts.filter(p => p.includes('NORMALIZING a modeling analysis'))
    expect(e2Prompts.length).toBeGreaterThanOrEqual(2)

    const second = e2Prompts[1] ?? ''
    // ③ the specific violation came back
    expect(second).toContain('CORRECTIONS FOR THIS ATTEMPT')
    expect(second).toContain('E1_E2_FIDELITY_VIOLATION')
    expect(second).toContain('A-INVENTED')
    // ① the reference rules
    expect(second).toContain('ModelSpec.variable_refs -> SymbolSpec')
    // ② the registered id list (the harness's own ids, verbatim)
    expect(second).toContain('ALREADY REGISTERED')
    expect(second).toContain('P1')
    // and it is LONGER than the first (the backfill is additive)
    expect(second.length).toBeGreaterThan((e2Prompts[0] ?? '').length)

    // B2 on the shipped text: no numeric literal outside the harness's own
    // identifiers. `P1` (a registered id) and `E1_E2_FIDELITY_VIOLATION`
    // (a failure code) both carry digits and must survive verbatim — they
    // are identifiers, not quantities.
    const guidance = second.slice(second.indexOf('CORRECTIONS FOR THIS ATTEMPT'))
    expect(hasNoNumericLiteralsOutsideIds(guidance, ['P1', 'E1_E2_FIDELITY_VIOLATION'])).toBe(true)

    // B5 unchanged: E1 still ran exactly once despite the retry
    expect(prompts.filter(p => p.includes('Write a modeling analysis in prose')).length).toBe(1)
    const kinds = ctx.paperAudit.list(runId).map((e: { eventType: string; detail?: { kind?: string } }) => `${e.eventType}:${String(e.detail?.kind ?? '')}`)
    expect(kinds).toContain('ir_entry_written:E1Reused')
    expect(kinds).toContain('ir_entry_written:E2DriftGuidance')
  })

  it('a first-attempt success gets NO *corrections* (only the registered-id list)', async () => {
    // W8.10-D1 (this assertion was too narrow and the test caught it):
    // B1 has two halves. ② (the registered-id list) is PREVENTIVE — it must
    // be present from the first attempt, because the duplicate-id failure it
    // prevents (`S-P` declared twice) happens on attempt one. ③ (the prior
    // violation) is CORRECTIVE and may only appear after a refusal.
    // "First attempt gets no guidance" was the wrong statement; the right one
    // is "first attempt gets no corrections".
    const { prompts, outcome } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('resolved')
    const e2s = prompts.filter(p => p.includes('NORMALIZING a modeling analysis'))
    expect(e2s.length).toBeGreaterThan(0)
    for (const p of e2s) {
      // no corrections...
      expect(p).not.toContain('What went wrong last time')
      // ...but the preventive id list IS there (registration runs before E1)
      expect(p).toContain('ALREADY REGISTERED')
      expect(p).toContain('R-OUT')
    }
  })
})

// ---------------------------------------------------------------------------
// W8.10-D1 — the input assets are registered BEFORE E1 is asked to analyse
// ---------------------------------------------------------------------------

describe('W8.10-D1 — registration precedes E1 (the ordering invariant)', () => {
  it('E1 sees the requirement ids (B4 is satisfiable at all)', async () => {
    // 事故（由目标模型上的第二次真实运行抓到）：注册原本发生在 E1 之后，
    // 于是 `semanticContextOf()` 在 E1 时刻返回空，E1 被告知"harness 没有
    // 注册任何 requirement id"，B4 因此**结构上不可能通过**——不是模型漏答，
    // 是它从未被告知要答什么。这与 fidelity 门的顺序缺陷同类：检查没问题，
    // 被检查对象从未以需要的形态到达（形态 6）。
    //
    // 这条断言钉住的是**顺序**，不是数值：E1 的 prompt 里必须出现已注册的
    // requirement id。真实运行已证明修复有效（run-3 的 B4 由恒 FAIL 转 PASS），
    // 但若没有这条断言，把注册挪回 E1 之后不会有任何测试变红。
    const { prompts, outcome } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('resolved')
    const e1Prompt = prompts.find(p => p.includes('Write a modeling analysis in prose'))
    expect(e1Prompt, 'E1 was never called').toBeDefined()
    // The registered id reached the analyst — this is what B4 anchors on.
    expect(e1Prompt).toContain('R-OUT')
  })

  it('registration is idempotent: the store still holds exactly one of each', async () => {
    // 修复把 `registerInputAssets` 提前调用，而它的原有调用点保留在原处
    // （容器准入需要那个 RESERVED 集合）。因此它必须真的是幂等的——否则
    // 修复会变成"注册两次"，而重复 id 正是本轮 B 组要消灭的失败类之一。
    //
    // 判定按各 kind 的**自己的 id 字段**（`ID_FIELD_BY_KIND`），不按
    // "value 里出现过这个字符串"——后者会把引用也算进来（`RequirementSpec`
    // 的 `source_data_ref` 正是 `DA-RAW`，实测会数出 3 条）。
    const { ir, outcome } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('resolved')
    for (const [kind, id] of [['DataArtifact', 'DA-RAW'], ['RequirementSpec', 'R-OUT'], ['ProblemSpec', 'P1']] as const) {
      const field = ID_FIELD_BY_KIND[kind]
      const hits = ir.list().filter(r => r.kind === kind && (r.value as Record<string, unknown>)[field] === id)
      expect(hits.length, `${kind} ${id} declared ${hits.length} times`).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// W8.10-D4 — E1 must NOT receive the container lecture
// ---------------------------------------------------------------------------

describe('W8.10-D4 — E1 and the container lecture are separated', () => {
  it('E1 prompt carries NO container lecture (the contradiction is gone)', async () => {
    // 事故（由 D3 探针抓出）：EXECUTE 节点的 instruction 段在
    // `produceFromExecute` 打开时就是容器讲义，而它的**第一句**是
    // "Produce ONE JSON object — and nothing else. No prose"。E1 拿到的是
    // `task + plan + 讲义` 再拼上 E1 指令，于是整个 prompt 的 85%
    // （实测 6749 / 7944 字符）在要求 JSON 容器，最后 15% 才说"写 prose、
    // 不要输出 JSON"。模型服从了多数派——探针在同一 prompt 上三次采样，
    // 锚点遵从度是 0 / 2 / 12，**不稳定的是矛盾本身，不是模型能力**。
    //
    // E2 才是需要讲义的那次调用，而它经由
    // `e2NormalizationPrompt(e1Text, EXECUTE_PROTOCOL_TEACHING)` 显式收到，
    // 所以 E1 侧丢掉它不损失任何信息。
    const { prompts, outcome } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('resolved')
    const e1Prompt = prompts.find(p => p.includes('Write a modeling analysis in prose'))
    expect(e1Prompt, 'E1 was never called').toBeDefined()
    // the container demand must not reach the analyst...
    expect(e1Prompt).not.toContain('Produce ONE JSON object')
    expect(e1Prompt).not.toContain('ir-container-v1')
    // ...while the task and the plan (what E1 legitimately needs) still do
    expect(e1Prompt).toContain('solve the sampling problem')
    expect(e1Prompt).toContain('Plan:')
  })

  it('E2 STILL receives the container lecture (nothing was lost, only moved)', async () => {
    // 与上一条配对：D4 是"把讲义从 E1 挪走"，不是"删掉讲义"。
    const { prompts, outcome } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('resolved')
    const e2Prompt = prompts.find(p => p.includes('NORMALIZING a modeling analysis'))
    expect(e2Prompt, 'E2 was never called').toBeDefined()
    expect(e2Prompt).toContain('Produce ONE JSON object')
    expect(e2Prompt).toContain('ir-container-v1')
  })

  it('the single-shot path still teaches the protocol (D4 touches ONLY E1)', async () => {
    // 回归守卫：非接收层路径的 instruction 段必须原样保留讲义——D4 的
    // 过滤只允许作用在 E1 那一次调用上。
    //
    // 这里断言的是**讲义到达了模型**，不是运行终态：喂进去的 `FAITHFUL_CONTAINER`
    // 是 E2 形状的输出，走单发路径本来就不合规。D4 若误把过滤也作用到这条
    // 路径，讲义会消失，而那时运行**照样**会失败——只看终态抓不到。
    //
    // 两个开关都要给：`disableE1E2` 单独作用会落到**分片**路径（A4 默认），
    // 而分片有自己的 instruction，讲义在那条路径上本就不出现。
    const { prompts } = await harness([FAITHFUL_CONTAINER], { disableE1E2: true, disableShardDeclare: true })
    expect(prompts.some(p => p.includes('Produce ONE JSON object'))).toBe(true)
    expect(prompts.some(p => p.includes('ir-container-v1'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// W8.11-A1 — the E1-side anchor rule, through the REAL object (red line N3)
// ---------------------------------------------------------------------------

describe('W8.11-A1 — a placeholder anchor fails the run as an E1-side finding', () => {
  it('run-4 shape: E1 writes `[[ASSUMPTION: ...]]` → B5 fails, reverse does not', async () => {
    // **走真实对象**（红线 N3 / 任务书 H1 要求）：这里的 E1 文本由真实
    // executor 接收，B5 由真实 fidelity 门产出，audit 由真实 audit service 落盘。
    // 不得手传参数——手传参数会让"判定条件正确"掩盖"传递链断裂"（W8.10-A1 教训）。
    const PLACEHOLDER_E1 = [
      '审题：本题是抽样检验 + 生产决策。',
      '[[REQUIREMENT: R-OUT]] 问题 1 要求设计检测次数尽可能少的抽样方案。',
      '[[ASSUMPTION: ...]] 检测本身无误差，检测出的次品确实是次品。',
    ].join('\n')
    const { ctx, runId, outcome, prompts } = await harness([PLACEHOLDER_E1, FAITHFUL_CONTAINER])
    expect(outcome.status, outcome.message).toBe('rejected')
    const findings = ctx.paperAudit.list(runId)
      .filter((e: { detail?: { kind?: string } }) => e.detail?.kind === 'FidelityFinding')
      .map((e: { detail?: { ok?: boolean; id?: string; detail?: string } }) => e.detail)
    const b5 = findings.find((f: { id?: string }) => String(f.id).includes('B5'))
    expect(b5, 'B5 was never recorded on the audit trail').toBeDefined()
    expect(b5?.ok, JSON.stringify(findings)).toBe(false)
    expect(String(b5?.detail)).toContain('...')
    // 反向不再把占位符当"一条未声明的假设"
    const reverse = findings.find((f: { id?: string }) => String(f.id).includes('反向'))
    expect(reverse?.ok, JSON.stringify(findings)).toBe(true)

    // **E1 侧缺陷不得被回灌给 E2**：E2 无法把一个占位符变成一条真假设。
    // 与 B4 同类——`e2Fixable` 必须把它排除，否则会向 E2 下达它做不到的指令。
    const guidance = prompts.filter(p => p.includes('CORRECTIONS FOR THIS ATTEMPT'))
    for (const g of guidance) {
      expect(g, 'B5 leaked into the E2 backfill').not.toContain('B5 锚点 id 形态')
    }
  })

  it('a well-named anchor is NOT flagged (the rule is narrow)', async () => {
    // 反向守卫：这条规则只抓占位符，不得误伤正常命名的锚点。
    const { ctx, runId } = await harness([E1_SAMPLE, FAITHFUL_CONTAINER])
    const findings = ctx.paperAudit.list(runId)
      .filter((e: { detail?: { kind?: string } }) => e.detail?.kind === 'FidelityFinding')
      .map((e: { detail?: { ok?: boolean; id?: string } }) => e.detail)
    const b5 = findings.find((f: { id?: string }) => String(f.id).includes('B5'))
    expect(b5?.ok, JSON.stringify(findings)).toBe(true)
  })
})
