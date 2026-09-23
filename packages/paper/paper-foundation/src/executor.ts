/**
 * Node executor: policy-bounded runs with retry, cost accounting, and audit.
 * Every model call goes through the shared provider seam and every fact
 * through the durable engine, so a crashed run replays and recovers.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/executor
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { BlockAssembler, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { AuditEntryInput, AuditEventType } from './audit.ts'
import { compactPrompt, renderSections } from './context.ts'
import type { PromptSection } from './context.ts'
import { computeCostUsd, evaluateBudget, resolveModelPrice } from './cost.ts'
import type { BudgetPolicy, PricingTable } from './cost.ts'
import { IR_CANONICALIZATION_GATE_ID, PROVENANCE_GATE_ID } from './delivery/delivery-policy.ts'
import { buildDeliveryPolicy } from './delivery/gate-registry.ts'
import { evaluateDelivery } from './delivery/delivery-policy.ts'
import type { DeliveryDecision, DeliveryPolicy } from './delivery/delivery-policy.ts'
import { makeCandidateArtifact } from './delivery/artifact-states.ts'
import { promoteCandidateToDeliverable } from './delivery/promoter.ts'
import { contentExists, gradeDelivery, renderDeliveryAppendix } from './delivery/delivery-grade.ts'
// ── 上限解放架构（L0/L1/L3/L4/L5/L6）───────────────────────────────────
// 最小宪法 + 可查询知识库（L1）：知识从 prompt 外置，prompt 只留索引。
import { PAPER_CONSTITUTION } from './knowledge/constitution.ts'
import { materializeSkillLibrary, skillIndexBlock, stepBriefing, SKILL_LIBRARY_DIR, type BriefingStep } from './knowledge/skill-library.ts'
// L0 能力画像：档位决定门禁初始强度与教学前置量。
import { defaultProfile, profileForTier, type CapabilityProfile, type ModelTier } from './probe/capability-profile.ts'
// L6 门禁状态机：DORMANT → WARN（微教学）→ ENFORCE（硬拦截）。
import { GateStateMachine } from './delivery/gate-state.ts'
// L6 闭环：分派 → 修复 → 复验（指纹）→ 消解；预算耗尽 = ESCALATE。
import { DEFAULT_CLOSURE_BUDGET, ClosureSession, type ClosureBudget } from './delivery/closure.ts'
// L6 四档交付语义：CLEAN / MARKED / DEGRADED / ESCALATE。
import { gradeLadder, renderTierBanner, type DeliveryTier } from './delivery/delivery-ladder.ts'
// L5 三视角对抗评审：persona 定义与短码（缺陷 id 按视角加前缀，避免并行评审撞 id）。
import { PERSONA_SHORT, PERSONA_SPEC, REVIEW_PERSONAS, type ReviewPersona } from './verification/adversarial-review.ts'
import type { NodeId, RunMode } from './spec.ts'
import { attemptAutoRepair } from './delivery/auto-repair.ts'
import { initialFingerprint, modelStructureOf, recheckFinding, type RecheckInput } from './delivery/recheck.ts'
import { structHashOf } from './verification/semantic-fingerprint.ts'
import { makeFinding, type Finding, type ClosureSeverity } from './delivery/finding.ts'
// W11.5-A3: the digit self-consistency scan (path B's post-hoc digit check).
import { digitSelfContradictionFindings } from './delivery/digit-check.ts'
// M-QUAL (W10) DP-8: the boundary appendix renders UNCONDITIONALLY (CLEAN
// deliveries carry their limits too) — a separate path from the MARKED
// appendix, exactly as the spec demands.
import { renderBoundaryAppendix } from './delivery/boundary-render.ts'
import type { BoundaryDeclaration } from './ir/boundary-declaration.ts'
import { renderE1DirectDraft } from './produce/e1-direct.ts'
import { chapterTitleOf, frameworkOf, perQuestionChaptersOf, perQuestionSectionsOf, questionOrdinal, questionRequirements, questionTitlesOf } from './produce/per-question.ts'
import type { DeliveryGrade } from './delivery/delivery-grade.ts'
import { runVerificationV1V4 } from './verification/v-structure.ts'
import { ModelingIr } from './ir/store.ts'
import { sha256Hex } from './ir/index.ts'
import { resolveRunPolicy } from './policy.ts'
import { parseModelContainer, produceContainerInto } from './produce/ir-producer.ts'
import { produceRunExecution } from './produce/execution-producer.ts'
import { produceInterpretation } from './produce/interpretation-producer.ts'
import { PROSE_CHAPTERS, displayNumber, numericLiterals, renderReportV2 } from './produce/report-renderer.ts'
import { requirementCoverageFindings } from './delivery/requirement-coverage.ts'
import { arithmeticFindingsOf, deliveredNumberFindings } from './delivery/delivered-numbers.ts'
// L1: 篇幅参照（`PAPER_LENGTH_REFERENCE`）已不再注入 prompt——它随写作规范一起
// 外置到 `skills/writing-norms.md`，由 `knowledge/skills/*` 同源渲染。这里只需要
// 两个检查器本身。
import { blankAreaViolations, numericClaimCensus, proseContractViolations, proseContractViolationsOfText } from './delivery/prose-contracts.ts'
import { formatViolations } from './delivery/format-audit.ts'
import { listSlices, writeSlice } from './runtime/stage-checkpoint.ts'
import { EXPLORE_INSTRUCTION, SELECT_INSTRUCTION, reviewDecisionRecord } from './produce/explore-deepen.ts'
import { SELF_CHECK_TOOL_NAME, checkCandidateContainer, runSelfCheckSafely, selfCheckCategorySentence, type SelfCheckVerdict } from './produce/self-check.ts'
import { renderSymbolicEvidence, runEquationConsistency } from './verification/symbolic-channel.ts'
import type { ContractRequirement } from './delivery/prose-contracts.ts'
import { SHARD_NAMES, shardPrompt, parseShard, mergeShards } from './produce/shard-declare.ts'
import {
  e2DriftGuidance,
  e2PromptWithGuidance,
  type PriorViolation,
} from './produce/e2-guidance.ts'
import {
  e1AnalysisInstruction,
  e2NormalizationPrompt,
  checkE1E2Fidelity,
  fidelityOk,
  type DeclaredEntry,
  type FidelityFinding,
} from './produce/e1-e2.ts'
import type { PaperProviderService, PaperRole } from './provider.ts'
import { backoffDelayMs, classifyFailure } from './resilience.ts'
import type { BackoffPolicy } from './resilience.ts'
import {
  NONE_RETRY_BUDGET,
  degradeTier,
  driftCorrection,
  failureClassOf,
  initialTier,
  ledgerCorrection,
  noneGuide,
  type FailureClass,
  type Tier,
} from './probe/probe.ts'
import {
  admitGuidedStep,
  assembleGuidedContainer,
  guidedStepPrompt,
  startGuidedSession,
  type GuidedSession,
} from './produce/guided-steps.ts'
import {
  admitTemplateFill,
  assembleTemplateContainer,
  defaultTemplateCandidates,
  templateFillPrompt,
} from './produce/template-fill.ts'
import type { PaperRuntimeGuard } from './runtime/runtime-guard.ts'
import type { PaperSettingsService } from './settings.ts'
import type { ArtifactRecord, Manifest, NodeRecord, RunId, RunRecord } from './spec.ts'
import { newArtifactId } from './spec.ts'
import type { WorkflowEngine } from './workflow.ts'

/** Result of one completed run execution. */
export interface ExecutionOutcome {
  /** Final run record. */
  readonly run: RunRecord
  /** Manifest recorded at delivery. */
  readonly manifest: Manifest
}

/**
 * TASK 5.0.5 / INV-3-K: the one delivery verdict of a run, carried from
 * `evaluateDelivery` to the promoter. Bundling the policy with its
 * decision is deliberate — the promoter needs both (it re-checks the
 * FAST-mode critical-gate set against `policy.gates`) but must not
 * re-run the policy, so the pair is produced once and passed through.
 */
export interface DeliveryVerdict {
  /** The policy that was evaluated; never a freshly built one. */
  readonly policy: DeliveryPolicy
  /** The verdict `evaluateDelivery` returned for that policy. */
  readonly decision: DeliveryDecision
}

/**
 * P3-1 (E5): the CLOSED set of semantic reviewer findings. Semantic
 * permission is limited to these three — everything else is not a semantic
 * finding and can never become one (a domain-external finding is refused at
 * parse time, never silently upgraded to critical).
 */
export const SEMANTIC_FINDING_KINDS = [
  'claim_without_evidence',      // prose claims something no Result/Claim supports
  'number_rewrite_mismatch',     // a restated/rounded number disagrees with its source
  'scope_overclaim',             // conclusion reaches beyond the REQUIRED_OUTPUTs
] as const
export type SemanticFindingKind = (typeof SEMANTIC_FINDING_KINDS)[number]

/** Severity each semantic kind carries — the reviewer cannot choose it. */
export function semanticSeverity(kind: SemanticFindingKind): 'critical' | 'major' {
  return kind === 'number_rewrite_mismatch' ? 'major' : 'critical'
}

/** Evidence a semantic finding MUST carry (E5 hallucination guard). */
export interface ReviewEvidence {
  /** Verbatim span of the delivered text the finding is about. */
  readonly text_span: string
  /** Canonical ids (Result / RequirementSpec / Claim) backing the finding. */
  readonly ref_ids: ReadonlyArray<string>
}

/** One structured reviewer finding. */
export interface ReviewDefect {
  /** Stable id the review protocol carries across rounds (E4a): later
   *  verdicts reference this id in `resolved` — a defect with no id can
   *  never be resolved and never expires. */
  readonly id: string
  /** How much the finding matters. E4b: three-value vocabulary aligned
   *  with CLOSURE_SEVERITIES (critical | major | minor); an unknown
   *  severity is fail-closed (parsed as critical), never downgraded.
   *  A semantic finding's severity is fixed by its kind (P3-1). */
  readonly severity: 'critical' | 'major' | 'minor'
  /** What the reviewer objected to. */
  readonly description: string
  /** P3-1: set only for the three closed semantic kinds. */
  readonly semantic?: SemanticFindingKind
  /** P3-1: mandatory for semantic findings, absent otherwise. */
  readonly evidence?: ReviewEvidence
}

/**
 * P3-1: the canonical context the reviewer is allowed to see when judging
 * semantics — nothing beyond the store (no filesystem, no web).
 */
export interface SemanticContext {
  /** Result rows (id, name, value, unit, uncertainty). */
  readonly results: ReadonlyArray<{ result_id: string; name: string; value: number; unit: string; uncertainty: number | null }>
  /** REQUIRED_OUTPUT requirement ids + statements. */
  readonly requiredOutputs: ReadonlyArray<{ requirement_id: string; statement: string }>
  /** Claim ids with their bound results and criticality. */
  readonly claims: ReadonlyArray<{ claim_id: string; criticality: string; result_refs: ReadonlyArray<string> }>
}

/**
 * L1 — 注入 prompt 的**全部**教学内容 = 最小宪法 + 技能库索引。
 *
 * 这里曾经是一个把"接口"与"知识"混在一起的单一常量。分开的理由是可测量的：
 * **每修一个漏洞，prompt 就长一截，模型的建模预算就少一点**；而"门禁 ⇔ 教学
 * 一一对应"的同步测试把这种膨胀锁死成纪律，于是所有约束永远以最高成本的形式
 * 存在——即使模型早就会了。
 *
 * 现在：
 *   - **接口**（容器形状、必填字段、什么被拒）留在 `PAPER_CONSTITUTION`——
 *     模型不看到它就产不出合法容器，这是**必须**在场的；
 *   - **知识**（篇幅规范、章节要素、方法族、评分口径、证据纪律）外置到
 *     `skills/`，prompt 只给**索引**（id + 什么时候读它），模型按需 `read_file`。
 *
 * 两者都必须与门禁同步，但**按成本分流**：分流表在 `gate-state.ts` 的
 * `GATE_ACTIVATIONS`（每条登记一个 `home`），由 `constitution-contract` 测试
 * 逐条核对，所以"漏教"仍然不可能发生。
 *
 * 返回值必须是**确定性**的：调用点用字符串相等来把这段教学从 E1 的 prompt 里
 * 过滤掉（E1 不该看到容器教学——它会与"写散文"的指令打架）。
 */
function constitutionText(): string {
  return `${PAPER_CONSTITUTION}\n\n${skillIndexBlock()}`
}

/** 向后兼容的别名：旧代码/测试按这个名字引用这段教学文本。 */
export const EXECUTE_PROTOCOL_TEACHING = constitutionText()

/**
 * finding 的严重度归类。
 *
 * 判据只有一条：**它是否让论文的核心主张失去支撑**。`fatal` 留给"没有它这篇
 * 论文就不成立"的情形（无正文、无模型、编造引用）；其余一律 `major`/`minor`，
 * 因为它们都能进"已知缺陷表"如实披露，而不是拦下整条产线。
 */
function severityOfKind(kind: string): ClosureSeverity {
  if (kind.includes('empty') || kind === 'PRODUCE_CHAIN_NO_MODEL' || kind === 'fabricated_reference') return 'fatal'
  if (kind.startsWith('review_defect_critical') || kind === 'numeric_channel' || kind === 'numeric_consistency' || kind === 'required_output_unpaid') return 'major'
  // 数字未经验证是**读者会据此下结论**的那一类，比格式问题重。
  if (kind === 'unverified_numbers') return 'major'
  // 格式飘移是**标注**级（稿子仍然可读、可交付），但它必须可见——否则"对齐参照物"
  // 永远只能靠人眼看。
  if (kind === 'format_drift') return 'minor'
  return 'minor'
}

/**
 * finding 的产物范围——**闭环分派的依据**。
 *
 * 这张映射是"对抗成本不对称"的落点：一次真实修复之所以只碰论文正文，正是因为
 * 改文字比重跑代码便宜。分派规则必须是代码，否则架构总会选便宜那条。
 */
function scopeOfKind(kind: string): ReadonlyArray<string> {
  // `unverified_numbers` 是**正文**层面的标注（数字在正文里、风险在读者那一侧），
  // 所以分派到 paper/：它要改的是稿子，不是代码或结果。
  if (kind.startsWith('review_defect') || kind === 'prose_contract' || kind === 'blank_area' || kind === 'unverified_numbers' || kind === 'format_drift') return ['paper/']
  if (kind === 'config_consistency' || kind === 'execution' || kind === 'PROVENANCE') return ['code/']
  if (kind === 'figure_data_consistency' || kind === 'figure_required') return ['figures/']
  if (kind === 'stale_detection') return ['results/']
  if (kind === 'reference_validation') return ['paper/']
  return ['DELIVERABLES.json']
}

// 复验指纹的定义搬到了 `delivery/recheck.ts`。这里**不再**保留任何"给文本算
// 哈希"的替代实现：第一版曾用 `sha256(category::evidence::文本长度)`，那是一个
// 假复验——模型改一个字符就能让指纹变化、被判"已修复"，而没有任何检查器跑过。
// 指纹现在只有一个来源：重跑该类别登记的检查器，取它的违规集合。


/**
 * W11.5 baseline-4: does a revision destroy the draft? A revision must keep
 * every section heading the draft had and must not collapse to under half
 * its length — otherwise it is not a revision (the real run's editor returned
 * the TASK statement, which the flow then delivered as the paper).
 */
export function revisionDestroysDraft(draft: string, revised: string): { rejected: boolean; reason: string | null } {
  const before = headingSetOf(draft)
  const after = headingSetOf(revised)
  const lost = [...before].filter(h => !after.has(h))
  if (revised.length < draft.length * 0.5) {
    return { rejected: true, reason: `revised text collapsed to ${revised.length} chars (was ${draft.length})` }
  }
  if (lost.length > 0) {
    return { rejected: true, reason: `revised text lost ${lost.length} section heading(s): ${lost.slice(0, 5).join(', ')}` }
  }
  return { rejected: false, reason: null }
}

/**
 * W11.5 baseline-7 — the attempt suffix on chain-minted ids.
 *
 * The store is append-only and one run id names one execution, so a retry that
 * re-executes the code must mint NEW ids. Attempt 1 is the identity: every id
 * stays exactly as the model declared it (the normal path, and every archived
 * artifact, is byte-identical). A retry appends `-a<N>`, and `displayIdOf`
 * removes it again before any id reaches the paper.
 */
function scopeAttemptId(id: string, attempt: number): string {
  return attempt <= 1 ? id : `${id}-a${attempt}`
}

/**
 * The id as the model wrote it, with the harness's attempt suffix removed.
 *
 * Only the EXACT suffix this attempt added is stripped, so a model that
 * legitimately names something `X-a2` keeps its name on attempt 1 (a blanket
 * `/-a\d+$/` strip would silently rewrite it in the delivered paper).
 */
export function displayIdOf(id: string, attempt: number): string {
  return attempt > 1 && id.endsWith(`-a${attempt}`) ? id.slice(0, -`-a${attempt}`.length) : id
}

/**
 * Rewrite the interpretation block's INTERNAL id references to this attempt's
 * scoped ids, so the minted Result/Claim/FigureSpec records close their
 * references inside the store.
 *
 * Only the id fields are touched, and only when the named id is one the same
 * block declares: `model_refs`/`symbol` names and every free-text field are
 * left alone. The narrative is NOT rewritten — it keeps the model's own ids,
 * and the renderer resolves them against the display ids it is given.
 */
function scopeInterpretationIds(block: Readonly<Record<string, unknown>>, attempt: number): Record<string, unknown> {
  if (attempt <= 1) return { ...block }
  const asArray = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
    Array.isArray(value) ? (value as ReadonlyArray<Record<string, unknown>>) : []
  const resultIds = new Set(asArray(block['results']).map(r => String(r['result_id'] ?? '')))
  const claimIds = new Set(asArray(block['claims']).map(c => String(c['claim_id'] ?? '')))
  const scopeRefs = (refs: unknown, known: ReadonlySet<string>): ReadonlyArray<string> =>
    (Array.isArray(refs) ? refs : []).map((r) => {
      const text = String(r)
      return known.has(text) ? scopeAttemptId(text, attempt) : text
    })
  return {
    ...block,
    ...(block['results'] === undefined ? {} : {
      results: asArray(block['results']).map(r => ({ ...r, result_id: scopeAttemptId(String(r['result_id'] ?? ''), attempt) })),
    }),
    ...(block['claims'] === undefined ? {} : {
      claims: asArray(block['claims']).map(c => ({
        ...c,
        claim_id: scopeAttemptId(String(c['claim_id'] ?? ''), attempt),
        ...(c['result_refs'] === undefined ? {} : { result_refs: scopeRefs(c['result_refs'], resultIds) }),
        ...(c['evidence_refs'] === undefined ? {} : { evidence_refs: scopeRefs(c['evidence_refs'], resultIds) }),
      })),
    }),
    ...(block['figures'] === undefined ? {} : {
      figures: asArray(block['figures']).map(f => ({
        ...f,
        figure_id: scopeAttemptId(String(f['figure_id'] ?? ''), attempt),
        ...(f['data_refs'] === undefined ? {} : { data_refs: scopeRefs(f['data_refs'], resultIds) }),
        ...(f['claim_refs'] === undefined ? {} : { claim_refs: scopeRefs(f['claim_refs'], claimIds) }),
      })),
    }),
  }
}

/**
 * W11.5 baseline-18 — the sub-problems a competition statement asks.
 *
 * Read out of the statement's own markers ("问题 1", "问题 2", …; also the
 * common "问题一"/"第1问" spellings). Harness-side extraction, so the model can
 * neither invent nor omit a sub-problem: whatever the statement asks becomes a
 * REQUIRED_OUTPUT, and the coverage gate holds the paper to it.
 *
 * Returns [] when the statement carries fewer than two markers (a single-question
 * problem keeps exactly the whole-paper R-OUT it always had).
 */
export function subProblemsOf(statement: string): ReadonlyArray<{ requirementId: string; statement: string }> {
  const CJK_DIGITS: Readonly<Record<string, string>> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }
  const markers: Array<{ index: number; number: string }> = []
  const pattern = /问题\s*([0-9]{1,2}|[一二三四五六七八九])\s*(?:问)?/g
  for (const match of statement.matchAll(pattern)) {
    if (match.index === undefined) continue
    const raw = match[1] ?? ''
    const number = CJK_DIGITS[raw] ?? raw
    if (number === '' || markers.some(m => m.number === number)) continue
    markers.push({ index: match.index, number })
  }
  if (markers.length < 2) return []
  return markers.map((marker, i) => {
    const end = markers[i + 1]?.index ?? statement.length
    const text = statement.slice(marker.index, Math.min(end, marker.index + 900)).trim()
    return { requirementId: `R-Q${marker.number}`, statement: text.slice(0, 900) }
  })
}

/** W11.5 baseline-23: the paper-visible label for each requirement type. */
const REQUIREMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  REQUIRED_OUTPUT: '必须给出的结果',
  CONSTRAINT: '约束条件',
  ASSUMPTION: '前提条件',
}

/**
 * W11.5 round-6 (审计 T-2) — 退化产出：某一问只产出一个常量。
 *
 * 真实产物里问题3/问题4 的"期望利润"是**孤零零一个 0**，没有任何决策结构或过程
 * ——那不是答案。harness 判不了实质正确性，但"这一问只对应一个常量 0"是机械事实，
 * 可以作为 MAJOR 标注（不阻断交付），让读者与评审一眼看到哪一问没算。
 */
function degenerateResultFindings(
  store: ReadonlyMap<string, { readonly kind: string; readonly value: Record<string, unknown> }> | null,
): ReadonlyArray<ReviewDefect> {
  if (store === null) return []
  const runsByModel = new Map<string, ReadonlyArray<string>>()
  for (const record of store.values()) {
    if (record.kind !== 'ModelSpec') continue
    const model = record.value as { model_id?: unknown; problem_refs?: unknown }
    runsByModel.set(String(model.model_id ?? ''), Array.isArray(model.problem_refs) ? model.problem_refs.map(String) : [])
  }
  const runsByProblem = new Map<string, Set<string>>()
  for (const record of store.values()) {
    if (record.kind !== 'RunArtifact') continue
    const run = record.value as { run_id?: unknown; model_ref?: unknown }
    for (const problem of runsByModel.get(String(run.model_ref ?? '')) ?? []) {
      const set = runsByProblem.get(problem) ?? new Set<string>()
      set.add(String(run.run_id ?? ''))
      runsByProblem.set(problem, set)
    }
  }
  const valuesByProblem = new Map<string, Set<string>>()
  for (const record of store.values()) {
    if (record.kind !== 'Result') continue
    const result = record.value as { run_ref?: unknown; value?: unknown }
    for (const [problem, runs] of runsByProblem) {
      if (!runs.has(String(result.run_ref ?? ''))) continue
      const set = valuesByProblem.get(problem) ?? new Set<string>()
      set.add(String(result.value))
      valuesByProblem.set(problem, set)
    }
  }
  const out: ReviewDefect[] = []
  for (const [problem, values] of valuesByProblem) {
    if (values.size !== 1) continue
    const only = [...values][0]
    if (only !== '0') continue
    out.push({
      id: `MECH-DEGENERATE-${problem}`,
      severity: 'major',
      description: `问题 ${problem} 只产出一个常量结果 0，没有任何决策结构或计算过程——` +
        ' 这一问看起来没有真正求解（harness 不判实质正确性，但这是机械可见的退化产出），请补上该问的求解与指标。',
    })
  }
  return out
}

/**
 * A one-line label for a requirement (round-8): the paper's 问题重述 table is an
 * INDEX, not a reprint of the problem statement.
 */
function gistOf(statement: string): string {
  const flat = statement.replace(/\s+/g, ' ').trim()
  return flat.length <= 80 ? flat : `${flat.slice(0, 80)}…`
}

/** One row of a rendered table (id + columns). */
interface ChapterRow {
  readonly id: string
  readonly columns: ReadonlyArray<string>
}

/**
 * W11.5 round-8（对齐参照物「7 问题一模型的独立校核」）— 独立校核章的正文。
 *
 * 参照物那一章是**解析解对照**（Bessel 级数配 Duhamel 卷积 vs 数值解）；harness
 * 不能替模型做解析推导，所以这一章**如实写它真正做过的事**：交付前机械执行的结构
 * 校核（V1–V4）、每个关键数字回读运行输出的溯源链。章末明确划界——"没有自相矛盾"
 * 不等于"模型在物理上正确"，后者需要解析解或实测数据对照。
 *
 * 为什么要有这一章：参照物用一整章证明"这一问的结论经得起独立核对"，而这件事我们
 * 此前只写在交付附录里，读者要翻到最后才知道数字是怎么被核过的。
 */
function verificationChapterOf(
  findings: ReadonlyArray<{ readonly rule: string; readonly ok: boolean; readonly detail: string }>,
  resultCount: number,
): string {
  if (findings.length === 0 && resultCount === 0) return ''
  const lines: string[] = []
  lines.push('本节的校核由 harness 在交付前**机械执行**（不含人工复核，也不是解析解对照）：它检查的是"数字与结构有没有自相矛盾"，以及"每个进入结论的数字能不能回读到运行输出"。')
  lines.push('')
  if (resultCount > 0) {
    lines.push(`- **数值溯源**：正文结论中的关键数字全部来自 ${resultCount} 条 Result 记录，由真实代码运行经 jsonPath 回读（code → result.json → Result → 正文），没有任何数字是人工转录或凭记忆写下的。`)
  }
  if (findings.length > 0) {
    const passed = findings.filter(f => f.ok).length
    lines.push(`- **结构校核（V1–V4）**：${passed}/${findings.length} 项通过。`)
    lines.push('')
    for (const finding of findings) {
      lines.push(`  - ${finding.ok ? '通过' : '**未通过**'} — ${finding.rule}：${finding.detail}`)
    }
  }
  lines.push('')
  lines.push('**本节结论的边界**：以上校核只能说明"交付稿的数字与结构自洽、可溯源"。模型在物理或业务意义上是否正确，需要与解析解、实测数据或独立数据源对照，本文未做该项工作。')
  return lines.join(String.fromCharCode(10))
}

/**
 * W11.5 round-7（对齐参照物）— 逐问章的正文来自**规范 IR**，不是 E1 的复述。
 *
 * 参照物的逐问章是「问题一：预热平衡阶段的常物性耦合场求解」——**该问的模型 +
 * 该问的结果**，与「问题分析」章是两回事（分析章说"归到哪类方法、为什么、难点"，
 * 逐问章给出该问真正的方程与数值）。所以这里不把 E1 的分析段再抄一遍，而是走
 * 规范 IR 的引用链：
 *
 *   ProblemSpec.requirement_refs → R-Qn      （哪一问）
 *   ModelSpec.problem_refs        → 该问的模型（目标、方程）
 *   Result.run_ref → RunArtifact.model_ref → ModelSpec.problem_refs （哪些数值属于该问）
 *
 * 该问在 IR 里什么都没有时（容器漏了这一问）**退回 E1 的分析段**——宁可给出模型
 * 写下的分析，也不给一个空章（用户口径：绝不允许空白/极简片段）。
 */
/**
 * One IR field as a string, honestly: an id/expression/unit field is a string (or a
 * number for a bound parameter), and anything else is NOT silently stringified into
 * `[object Object]` — it reads as empty so the caller treats it as "not declared".
 */
function irText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function perProblemChaptersFromIr(
  store: ReadonlyMap<string, { readonly kind: string; readonly value: Record<string, unknown> }> | null,
  requirements: ReadonlyArray<{ requirementId: string; statement: string }>,
  results: ReadonlyArray<{ result_id: string; name: string; value: unknown; unit: string | null }>,
  e1Text: string,
): ReadonlyArray<{ readonly title: string; readonly body: string; readonly rows?: ReadonlyArray<ChapterRow> }> {
  const questions = questionRequirements(requirements)
  if (questions.length === 0) return []
  const fallback = perQuestionChaptersOf(e1Text, requirements)
  const fallbackByOrdinal = new Map<string, string>()
  for (const chapter of fallback) {
    const ordinal = /^问题(\d+)：/.exec(chapter.title)?.[1]
    if (ordinal !== undefined) fallbackByOrdinal.set(ordinal, chapter.body)
  }
  if (store === null) return fallback

  const problems: Array<{ problemId: string; requirementIds: ReadonlyArray<string> }> = []
  const modelsByProblem = new Map<string, Array<{ modelId: string; objective: string; equations: ReadonlyArray<string> }>>()
  const equationsById = new Map<string, { expression: string; unit: string }>()
  const modelsById = new Map<string, { problemRefs: ReadonlyArray<string>; objective: string; equationRefs: ReadonlyArray<string> }>()
  const runModel = new Map<string, string>()
  const resultProblems = new Map<string, Set<string>>()

  for (const record of store.values()) {
    const value = record.value
    if (record.kind === 'EquationSpec') {
      const id = irText(value['equation_id'])
      if (id !== '') equationsById.set(id, { expression: irText(value['expression']), unit: irText(value['unit']) })
    } else if (record.kind === 'ModelSpec') {
      const id = irText(value['model_id'])
      const problemRefs = Array.isArray(value['problem_refs']) ? value['problem_refs'].map(String) : []
      const equationRefs = Array.isArray(value['equation_refs']) ? value['equation_refs'].map(String) : []
      if (id !== '') modelsById.set(id, { problemRefs, objective: irText(value['objective']), equationRefs })
    } else if (record.kind === 'ProblemSpec') {
      problems.push({
        problemId: irText(value['problem_id']),
        requirementIds: Array.isArray(value['requirement_refs']) ? value['requirement_refs'].map(String) : [],
      })
    } else if (record.kind === 'RunArtifact') {
      const runId = irText(value['run_id'])
      const modelRef = irText(value['model_ref'])
      if (runId !== '') runModel.set(runId, modelRef)
    }
  }
  for (const [modelId, model] of modelsById) {
    for (const problem of model.problemRefs) {
      const list = modelsByProblem.get(problem) ?? []
      list.push({
        modelId,
        objective: model.objective,
        equations: model.equationRefs.map((ref) => {
          const equation = equationsById.get(ref)
          if (equation === undefined) return ref
          const unit = equation.unit === '' ? '' : `（单位：${equation.unit}）`
          return `**${ref}**：$${equation.expression}$${unit}`
        }),
      })
      modelsByProblem.set(problem, list)
    }
  }
  // 结果 → 问题：**先看结论自报的 model_refs**（这条 CRITICAL 结论在回答哪一问），
  // 只有没有任何结论认领的结果才退回出处链（run → model → problems）。顺序很关键：
  // 一次容器只有一次运行，出处链把所有结果都算到第一个模型的问题上，逐问章于是每章
  // 都列全部数值（离线预检实测：问题1 的表里出现了另外三问的成本）。
  const problemsOfModel = (modelId: string): ReadonlyArray<string> => modelsById.get(modelId)?.problemRefs ?? []
  const addResultProblem = (resultId: string, problemIds: ReadonlyArray<string>): void => {
    if (resultId === '' || problemIds.length === 0) return
    const set = resultProblems.get(resultId) ?? new Set<string>()
    for (const id of problemIds) set.add(id)
    resultProblems.set(resultId, set)
  }
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const value = record.value
    if (irText(value['criticality']) !== 'CRITICAL') continue
    const modelRefs = Array.isArray(value['model_refs']) ? value['model_refs'].map(String) : []
    const resultRefs = Array.isArray(value['result_refs']) ? value['result_refs'].map(String) : []
    const claimed = modelRefs.flatMap(ref => problemsOfModel(ref))
    for (const resultRef of resultRefs) addResultProblem(resultRef, claimed)
  }
  for (const record of store.values()) {
    if (record.kind !== 'Result') continue
    const resultId = irText(record.value['result_id'])
    if (resultProblems.has(resultId)) continue
    addResultProblem(resultId, problemsOfModel(runModel.get(irText(record.value['run_ref'])) ?? ''))
  }

  const titles = questionTitlesOf(e1Text)
  const out: Array<{ title: string; body: string; rows?: ReadonlyArray<ChapterRow> }> = []
  for (const question of questions) {
    const ordinal = questionOrdinal(question.requirementId)
    // 归属：ProblemSpec.requirement_refs 明说的优先；容器没明说时按序数约定取 P<n>。
    const owned = problems.filter(p => p.requirementIds.includes(question.requirementId))
    const named = owned.length > 0 ? owned : problems.filter(p => p.problemId === `P${ordinal}`)
    const problemIds = named.map(p => p.problemId)
    const models = problemIds.flatMap(id => modelsByProblem.get(id) ?? [])
    const rows: ChapterRow[] = []
    for (const result of results) {
      const owner = resultProblems.get(result.result_id)
      if (owner === undefined || !problemIds.some(p => owner.has(p))) continue
      rows.push({
        id: result.result_id,
        // 三列即可：renderTable 会把 row.id 作为溯源标记跟在行尾（`… | [RES-x]`），
        // 再放一列 id 就重复了。
        columns: [result.name, typeof result.value === 'number' ? displayNumber(result.value) : String(result.value), result.unit ?? ''],
      })
    }
    const bodyParts: string[] = []
    // 逐问章的正文 = 该问的模型 + 方程（IR 装配）。该问的**分析**在「问题分析」章的
    // 2.x 小节里，不在这里重复（参照物的分工：2.x 讲怎么做，6/8/9/10 给该问的模型与数值）。
    // 只有在 IR 里该问什么都没有时才退回 E1 的分析段——宁可给出模型写下的分析，
    // 也不给一个空章（用户口径：绝不允许空白/极简片段）。
    for (const model of models) {
      if (model.objective !== '') bodyParts.push(`**${model.modelId}** 的目标：${model.objective}`)
      if (model.equations.length > 0) {
        // 方程按"编号 + 行内公式 + 单位"排版：整串塞进 `$…$` 会把编号和单位也当成
        // 数学式（`$EQ-1: P_accept = …（dimensionless）$`），排版器读不懂。
        bodyParts.push(model.equations.map(e => `- ${e}`).join(NL))
      }
    }
    const body = bodyParts.length > 0 ? bodyParts.join(NL + NL) : (fallbackByOrdinal.get(ordinal) ?? '')
    if (body.trim() === '' && rows.length === 0) continue
    out.push({
      title: chapterTitleOf(ordinal, question.statement, titles.get(question.requirementId)),
      body,
      ...(rows.length === 0 ? {} : { rows }),
    })
  }
  return out
}


/** W11.5 baseline-4: the section headings a delivery text carries (any level). */
const NL = String.fromCharCode(10)

function headingSetOf(text: string): Set<string> {
  const out = new Set<string>()
  for (const line of text.split('\n')) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (m !== null && m[1] !== undefined) out.add(m[1].trim())
  }
  return out
}

/** Minimal audit sink the executor needs; {@link PaperAuditService} satisfies it. */
export interface AuditSink {
  /**
   * Append one audit entry.
   * @param entry - the operation to record.
   * @returns resolution after the entry is durable.
   */
  record(entry: AuditEntryInput): Promise<unknown>
}

/**
 * W8.11-B2 — minimal artifact BODY sink; {@link PaperArtifactBodyService}
 * satisfies it. Separate from the metadata store on purpose (see
 * `artifact-body.ts`).
 */
export interface ArtifactBodySink {
  /**
   * Store one body under the digest its metadata record carries.
   * @param input - artifact id, run id, digest, and text.
   * @returns resolution after the body is durable.
   */
  put(input: { artifactId: string; runId: string; sha256: string; text: string }): Promise<unknown>
}

/** Deployment-varying execution knobs resolved by the owning service. */
export interface ExecutorOptions {
  /** Route prices used to turn token counts into cost. */
  readonly pricing: PricingTable
  /** Daily spend ceiling and warning fraction. */
  readonly budget: BudgetPolicy
  /** Retry backoff bounds. */
  readonly backoff: BackoffPolicy
  /** Fraction of a model's context window one request may occupy. */
  readonly contextUtilization: number
  /** Audit sink; omitted in compositions that mount no trail. */
  readonly audit?: AuditSink
  /** Artifact body sink (W8.11-B2); omitted when bodies are not persisted. */
  readonly artifactBodies?: ArtifactBodySink
  /**
   * The canonical Modeling IR store the workflow's mathematical facts live in
   * (TASK 1.25). Deliberately optional at the type level — the composition may
   * not mount one — but **not** optional at the enforcement level: in FORMAL
   * and FAST mode a missing store means there is no canonical state at all,
   * which is exactly the condition the bridge exists to block.
   */
  readonly ir?: ModelingIr
  /**
   * 5.0-R (R5, author-delegated decision A): the root directory under which
   * a promoted final output is REALLY written, at
   * `<finalOutputRoot>/<runId>/final/<basename>`. When absent the executor
   * keeps the previous audit-only behaviour with the path labelled
   * "(no sink mounted)" — promotion no longer "to the void" once a
   * composition mounts a sink; every real deployment should.
   */
  readonly finalOutputRoot?: string
  /**
   * P2-1 (D7 obligation): the ONLY code-run configuration a composition may
   * inject. `command`/`entryFile` are deployment-owned — the model NEVER
   * chooses a runner command (task book P2 禁4). When produceFromExecute
   * meets a container with `code`, the executor requires this option; its
   * executable must be in the built-in allow-list (node/python by default).
   */
  readonly produceRun?: {
    readonly command: ReadonlyArray<string>
    readonly entryFile: string
    /** descriptive environment string recorded on the RunArtifact. */
    readonly environment: string
    readonly timeoutMs: number
    /** default allow-list when omitted: node, python, python3. */
    readonly allowExecutable?: ReadonlyArray<string>
  }
  /**
   * P1-1: when true, the EXECUTE node's output MUST be an ir-container-v1
   * typed-JSON (structured-output producer). The producer validates and
   * writes the model-declared kinds into `ir`; a refused container counts
   * as a failed EXECUTE attempt (retried up to the node ceiling, then the
   * run is BLOCKED with the producer's reason). Requires a mounted `ir`.
   * Default false keeps the pre-P1 free-prose EXECUTE protocol intact.
   */
  readonly produceFromExecute?: boolean
  /**
   * W9-P2 (O-L1-03): shard the EXECUTE declaration into three small
   * outputs (definitions → models → runtime) merged into the same
   * ir-container-v1. Rationale: the single-shot container's output
   * budget is eaten by the reasoning channel (P1 probes: ≈14.6:1),
   * truncating the JSON at the 32k ceiling.
   *
   * W8.9-A4 — **DEFAULT ON**. W8.7 shipped the shard protocol as an
   * opt-in switch ("默认关", per the W8.6 lesson that unverified protocol
   * changes must not flip a default). That lesson is now satisfied on the
   * evidence side: the shard path has its own test surface
   * (`tests/executor-shard.spec.ts`), and the single-shot path is the one
   * with a KNOWN output-ceiling failure (W8.5: 75,669 output tokens burned
   * before the container completed; W8.8 runs #3/#4: empty streams).
   * Leaving a known-failing path as the default is the hazard now.
   *
   * The switch is inverted, not removed: `shardDeclare: false` restores the
   * single-shot declaration for A/B comparison and regression.
   */
  readonly shardDeclare?: boolean
  /**
   * W8.9-A4: explicit opt-OUT of sharding. When absent, sharding is ON for
   * producing EXECUTE nodes. Kept separate from `shardDeclare` so a
   * composition can express "I know about sharding and I want it off"
   * without the meaning of `shardDeclare` having to be re-read.
   */
  readonly disableShardDeclare?: boolean
  /**
   * W8.9-B1 — the E1/E2 receive layer. When true, a producing EXECUTE node
   * runs TWO calls: E1 writes free analysis (no container requirement), E2
   * normalizes it into the ir-container-v1. **Default ON** for producing
   * runs: this is the main-contradiction fix (the single-shot container
   * measured container compliance, not modeling quality — W8.8 run#4).
   * `e1e2: false` restores the single-shot path for A/B comparison.
   */
  readonly e1e2?: boolean
  /**
   * W8.9-B1: explicit opt-out of the receive layer (takes precedence).
   */
  readonly disableE1E2?: boolean
  /**
   * 分阶段切片 + 热重启（W12-C1）。
   *
   * `slicesRoot` 给出切片落盘位置；`stagePause` 列出**完成即停**的阶段。
   * 停在检查点时抛 {@link StagePauseSignal}——它**不是失败**，节点状态不判 failed，
   * 整轮运行以"暂停"结束，由调用方（CLI）打印续跑提示并以独立退出码退出。
   *
   * 为什么默认不暂停：热重启是**人的工作流**（每阶段检查通过才继续），把它设成
   * 默认会让无人值守的运行永远走不完。它由 `--pause-after` 显式打开。
   */
  readonly slicesRoot?: string
  readonly stagePause?: ReadonlyArray<string>
  /**
   * 热重启：把已检查通过的阶段产出**播种**回来，续跑不重发那两次最贵的模型调用。
   *
   * 只播种 `analyze`（E1 全文）与 `container`（准入通过的容器全文）。
   * **为什么不播种 `produce` 的报告**：产出链是容器的**纯函数**——同一容器、
   * 同一 seed，代码输出与渲染结果相同，所以重派生出来的报告与你审过的那一份一致。
   * 播种报告反而要伪造一个节点 id（`draft.nodeId` 被引擎后续使用），得不偿失。
   *
   * 这个"纯函数"的前提是 `run.seed` 固定；容器没写 seed 时产出可能不同，
   * 此时续跑会重新产出（并覆盖同名切片），检查者需要重看——这是已知边界。
   */
  readonly resumeFrom?: { readonly analyze?: string; readonly container?: string }
  /**
   * W8.9-B3/B4 — enforce the E1→E2 fidelity checks. When true (default),
   * a container whose Assumption/Equation declarations are not verbatim-
   * anchored in E1, or whose E1 text lacks a required-output reasoning
   * anchor, is REFUSED as a DRIFT (guided retry, E1 not re-run).
   * `enforceFidelity: false` records the findings without refusing —
   * for the first real runs, where the anchor discipline is itself new.
   */
  readonly enforceFidelity?: boolean
  /**
   * TASK-PW W2: the protocol tier a producing run starts in (T1 / T2 / T3).
   * Defaults to T1 when absent; `tierOf()` is the single reader, so the
   * W4 NONE-degradation ledger stays authoritative.
   */
  readonly initialTier?: Tier
  /**
   * 交付档位。
   *
   * - `fail-soft`（**默认**）——检出但未返修的 finding 以"显式接受"消解，
   *   交付一份带**已知缺陷表**的完整包。下限不为零。
   * - `closed-loop`——finding 走闭环返修 + 复验；预算内未消解则 `ESCALATE`
   *   （交出"未完成包" + 缺口清单）。**这是目标形态**，需要返修执行者接上。
   * - `strict-tolerance`——历史行为：任何未通过即拒绝交付，零产物。
   *   保留给需要 fail-closed 的组合，但**不再是默认**：它是一条从未在任何
   *   真实产出中被验证过的路径，而放行路径的缺陷已被反复实证。
   *
   * 三档都由 `gradeLadder` 做唯一判定，不存在第二条判定路径。
   */
  readonly deliveryGradeMode?: 'strict-tolerance' | 'fail-soft' | 'closed-loop'
  /**
   * L0 能力画像的档位。缺省时按 `defaultProfile('未跑探针')` 取 **A** 档——
   * 保守默认不是"更严"，而是"该给脚手架就给"：在零证据下假定模型不需要帮助，
   * 会让弱模型直接卡在容器层（零产物），那比多给一点帮助贵得多。
   */
  readonly capabilityTier?: ModelTier
  /**
   * L2 探索—择优—深挖。
   *
   * 开启后，EXECUTE 之前会先跑两个 plan 型节点：**探索**（每个子问题 2–3 个
   * 方案草图）与**择优**（四维打分 + 选择理由 + 落选理由），其产物作为决策记录
   * 注入 EXECUTE 的 prompt。缺省 `strict` 档开启，其余档位关闭（探索段约占总预算
   * 15%，它是质量档买到的东西）。
   *
   * **失败是 fail-soft 的**：探索/择优任一失败只记审计并继续，绝不因此拒绝运行——
   * 它是"想得更好"的机制，不是"必须通过"的门。
   */
  readonly exploreDeepen?: boolean
  /**
   * L5 对抗评审的视角数。
   *
   * 缺省按 run mode 决定：`strict` 跑 **3** 个视角，`fast` / `exploratory` 跑 **1** 个。
   * 三个视角各自独立上下文、各自盲评，缺陷合并进同一本 ledger；id 按视角加前缀，
   * 因此并行评审的缺陷**不会互相覆盖**。详见 `reviewPersonasOf`。
   */
  readonly reviewPersonas?: 1 | 3
  /**
   * L6 闭环预算。缺省 {@link DEFAULT_CLOSURE_BUDGET}。
   * **预算耗尽的语义一定是 `ESCALATE`**，不可配置成 CLEAN（C2）。
   */
  readonly closureBudget?: ClosureBudget
  /**
   * W8.6-P4 (O-L5-03): per-RUN output-token ceiling, independent of the
   * USD daily budget. The USD gate cannot fire when pricing is
   * unconfigured (costUsd stays 0) — W8.5 burned 75,669 output tokens
   * with no cap at all. This gate counts tokens, not dollars: it works
   * on an unpriced relay. Zero or absent = unbounded (historical
   * behavior); a positive value pauses the run when the ceiling trips.
   */
  readonly maxOutputTokensPerRun?: number
}

/**
 * Shared stand-in for "no canonical IR was mounted". The bridge only reads, so
 * one immutable empty store is safe to reuse for every such run.
 */
const EMPTY_IR = new ModelingIr()

/**
 * W11.5-A2 — the closed set of delivery paths a manifest may declare.
 * See `manifestSchema.delivery_path` for the meaning of each value.
 */
export const DELIVERY_PATHS = ['A-produce-chain', 'B-e1-direct', 'A-normalized-no-code'] as const
export type DeliveryPath = (typeof DELIVERY_PATHS)[number]

/** Stable reasons the executor refuses to finish a run. */
export type ExecutionFailureCode =
  | 'budget-exhausted'
  | 'provider-blocked'
  | 'provider-unavailable'
  | 'gate-failed'

/** A run the executor stopped, carrying the reason a caller routes on. */
export class WorkflowExecutionError extends Error {
  /**
   * @param code - stable reason the run stopped.
   * @param message - human-readable summary without credential material.
   */
  constructor(readonly code: ExecutionFailureCode, message: string) {
    super(message)
    this.name = 'WorkflowExecutionError'
  }
}

/** One model call that ended in a provider or transport failure. */
class ModelCallFailure extends Error {
  /**
   * @param failure - the adapter's provider-neutral failure facts.
   * @param usage - W8.8: tokens the failed call still consumed. A stream
   *   that errors mid-way has already been billed; dropping its usage
   *   makes the expensive failures invisible to the P4 token budget.
   */
  constructor(readonly failure: LlmFailure, readonly usage?: TokenUsage) {
    super(failure.message)
    this.name = 'ModelCallFailure'
  }
}

/** Trim order: a regenerable plan gives way first, instructions never. */
const TRIM_PLAN = 0
const TRIM_DEFECTS = 1
const TRIM_DRAFT = 2
const TRIM_TASK = 3
const KEEP = Infinity

/**
 * Attempt ceiling for the PRODUCING EXECUTE node (W11.5 baseline-7).
 *
 * Its refusals arrive in stages — parse → schema → E1 fidelity → code run →
 * interpretation → report render — and each guided retry corrects one stage.
 * With the generic ceiling of 3, the seventh real run spent attempts 1-2 on
 * the fidelity rule, produced on attempt 3 a container that passed fidelity,
 * ran, and minted 4 Results + 4 CRITICAL claims, and then had no attempt left
 * to fix the render refusal that followed (its narrative stated numbers the
 * run did not produce). Every other node keeps `policy.maxNodeAttempts`; this
 * node is the one with staged causes, and the per-cause budgets plus the
 * same-cause breaker still bound the spend.
 *
 * W11.5 round-2 (baselines 18–21): the per-sub-problem contract made each
 * emission a much bigger job, and the observed loop is one stage per attempt
 * (章节 → 代码 → 保真 → 图 → …). Five attempts was one short of the stages; the
 * ceiling is raised to give each stage its correction round.
 */
const EXECUTE_PRODUCE_ATTEMPTS = 7

/**
 * W11.5 baseline-16/18 — the narrative chapters a container MUST supply.
 *
 * `methods` is the model-supplied content of 模型建立与求解 (same class as the
 * prose chapters: absent → a visible placeholder → the pre-export gate refuses).
 */
const REQUIRED_NARRATIVE: ReadonlyArray<{ id: string; title: string }> = [...PROSE_CHAPTERS]

/**
 * TASK 5.0.5 / INV-014: the single sink the promoter writes a
 * deliverable to. Declared once, at module scope, so that "the final
 * output has exactly one write path" is checkable by inspection — a
 * second literal would be a second path.
 */
const FINAL_OUTPUT_PATH = '/var/paper-harness/final'

/**
 * The two promotion outcomes the promoter is contractually allowed to
 * emit (`promoteCandidateToDeliverable` emits exactly one of them per
 * call). Anything else is a contract break between two in-process
 * modules, so it is refused rather than relabelled: an unknown
 * promotion event must never be filed under a kind that implies a
 * different verdict.
 */
const PROMOTION_AUDIT_TYPES: readonly AuditEventType[] = ['promotion_succeeded', 'promotion_failed']

function promotionAuditType(type: string): AuditEventType {
  const found = PROMOTION_AUDIT_TYPES.find(candidate => candidate === type)
  if (found === undefined) throw new Error(`promoter emitted an undeclared audit event: '${type}'`)
  return found
}

const SYSTEM_PROMPTS: Record<PaperRole, string> = {
  executor: 'You are a careful task executor. Produce complete, correct output for the given task. Be concise.',
  reviewer: 'You are an independent reviewer. Judge only the delivered text against the task. Respond with JSON only.',
  editorAi: 'You are a precise editor. Apply the listed defects minimally and return the corrected text only.',
}

/** Map a settings role to the node record's role vocabulary. */
function nodeRoleOf(role: PaperRole): NodeRecord['role'] {
  return role === 'editorAi' ? 'editor_ai' : role
}

/**
 * Drives one run's nodes through the durable engine: plan, execute, the
 * mode-bounded review loop, and delivery with a manifest.
 */
export class WorkflowExecutor {
  /**
   * @param engine - Durable workflow engine owning all run writes.
   * @param provider - Shared LLM seam for the three roles.
   * @param settings - Role settings snapshots.
   * @param options - Pricing, budget, backoff, and the optional audit sink.
   * @param runtimeGuard - The runtime guard, single entry point for capability
   *   execution. The executor asserts it is readied and the run mode matches
   *   the active profile before it starts a workflow.
   */
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly provider: PaperProviderService,
    private readonly settings: PaperSettingsService,
    private readonly options: ExecutorOptions,
    private readonly runtimeGuard: PaperRuntimeGuard,
  ) {}

  /** Context windows already resolved per role; `undefined` means the adapter states none. */
  private readonly contextWindows = new Map<PaperRole, number | undefined>()

  /**
   * P2-1: code-bytes loaders per run, captured when the EXECUTE stage runs
   * the production chain, forwarded to the FORMAL delivery policy so S-007
   * checks the bytes that ACTUALLY executed (synchronous contract).
   */
  readonly #codeLoaders: Map<string, (ref: string) => string> = new Map()

  /**
   * TASK-PW W4: the protocol tier the EXECUTE path currently expects of the
   * model, per run. Starts at T1 (full declarations); NONE exhaustion for
   * the run degrades it toward T2 then T3 (W-B: a model that never produces
   * a container is guided, then stepped down — the tier ledger feeds W2/W3).
   * `undefined` = not a producing run / no degradation happened yet.
   */
  readonly #tierByRun: Map<string, Tier> = new Map()

  /**
   * W8.9-B5 — the E1 analysis text, per run.
   *
   * Why it is cached: an E2 retry (DRIFT guidance) must NOT re-run E1. E1 is
   * the creative step — re-running it would (a) spend a second full analysis
   * on every E2 hiccup and (b) produce DIFFERENT content, so the second E2
   * would be normalizing a different source than the one the first attempt
   * was graded against (可复现性破坏, W8.9-B5 禁止项). Caching makes
   * "E1 ran once" a fact of the code rather than a promise.
   */
  readonly #e1ByRun: Map<string, string> = new Map()
  /**
   * 热重启播种的容器全文（按 run 键）。
   *
   * 有它时 E1/E2 两段**都不跑**：E1 由 `#e1ByRun` 播种、容器由这里播种，
   * 于是直接进准入与产出链。审计里记 `ContainerSeeded`，所以"这次没重新声明"
   * 是一个可核验的事实，而不是看不见的捷径。
   */
  readonly #seededContainerByRun: Map<string, string> = new Map()

  /**
   * W11.5 baseline-18 (审计 A-1，模板污染): the PAPER-VISIBLE problem statement
   * per run, when the caller can name it separately from the model-facing task.
   *
   * `execute(runId, input)` takes the text the MODEL reads, and the CLI appends
   * the method-family banner to it (W5 — the model should know the family). But
   * the same string was registered as the RequirementSpec statement and rendered
   * into the paper's 问题重述, so the seventeenth baseline's paper showed the
   * harness's own routing prompt ("候选模型集(封闭,只能从中选择,禁止自创)") to the
   * reader. Two audiences, two strings.
   */
  readonly #problemStatementByRun: Map<string, string> = new Map()

  /**
   * W11.5 baseline-19 — the narrative a run has accumulated across attempts,
   * keyed by chapter.
   *
   * The eighteenth baseline's attempts 1 and 5 died on the LAST gate with only a
   * narrative chapter missing (代码附录, then methods + 问题重述): the model
   * re-emits the whole container on every retry and silently drops chapters it
   * had already written — the refusal names what is missing, the model adds it,
   * and loses another one. A retry's intent is to FIX what was refused, so a
   * chapter the current attempt does not mention keeps its best-known text; a
   * chapter the attempt DOES write replaces it (the model's latest word wins per
   * key). Same spirit as the container store's first-declaration policy, applied
   * to the one part of the container that is not an entry.
   */
  readonly #narrativeByRun: Map<string, Record<string, unknown>> = new Map()

  /**
   * W8.12 — the receive layer's terminal failure facts per run, stashed when
   * the container path falls back to E1 direct delivery. The grader reads
   * them so the MARKED appendix names the real cause (which fidelity rules
   * failed) instead of a generic gate name.
   */
  readonly #receiveFailures: Map<string, { failedRules: ReadonlyArray<string>; reason: string }> = new Map()

  /**
   * W8.10-B1 — violations from the previous E2 attempt, per run.
   *
   * Appended to the NEXT E2 prompt as drift guidance. Cleared on success so a
   * later run of the node does not inherit stale corrections. Only E2 reads
   * it: E1 must never see this (it would re-author the analysis, which B5's
   * cache exists to prevent).
   */
  readonly #e2ViolationsByRun: Map<string, PriorViolation[]> = new Map()

  /**
   * W11.5-A2 — which exit produced each run's deliverable body. Written at
   * the three real exits of the receive stage (production chain / normalized
   * no-code / E1-direct fallback) so `buildManifest` states a FACT rather
   * than reconstructing one from the audit trail.
   */
  readonly #deliveryPathByRun: Map<string, DeliveryPath> = new Map()

  /**
   * TASK-PW W4: guided-retry budget spent per run and per class (NONE and
   * DRIFT have independent budgets; ESCAPE has no budget at all — W-B).
   */
  readonly #noneSpent: Map<string, number> = new Map()
  readonly #driftSpent: Map<string, number> = new Map()

  /** TASK-PW W2: per-run T2 guided-step sessions (executor memory only). */
  readonly #guidedByRun: Map<string, GuidedSession> = new Map()

  /** TASK-PW W2: pending W4 guidance to append to the next guided step
   *  prompt (DRIFT correction / NONE minimal example). */
  readonly #guidedGuidance: Map<string, string> = new Map()

  /**
   * TASK-PW W2: drive one T2 guided-step session through the three
   * declarations and return the assembled ir-container-v1. Each step is a
   * provider call whose payload is admitted against the step schema; a
   * refusal throws with a W4 failure class so the outer attempt loop applies
   * the class budgets (schema/foreign-key → DRIFT guidance, everything else
   * → ESCAPE zero budget).
   */
  private async runGuidedExecute(
    runId: RunId,
    role: PaperRole,
    taskText: string,
  ): Promise<string> {
    const runKey = String(runId)
    const route = this.settings.snapshot()[role]
    let session = this.#guidedByRun.get(runKey) ?? startGuidedSession()
    this.#guidedByRun.set(runKey, session)
    while (session.step !== 'done') {
      const step = session.step
      const pendingGuidance = this.#guidedGuidance.get(runKey)
      this.#guidedGuidance.delete(runKey)
      const stepPrompt = pendingGuidance === undefined
        ? guidedStepPrompt(step, session.candidates)
        : `${guidedStepPrompt(step, session.candidates)}\n\n${pendingGuidance}`
      const { text, usage } = await this.call(role, stepPrompt)
      await this.recordUsage(runId, route.provider, route.model, usage)
      const admission = admitGuidedStep(session, step, text)
      if (!admission.ok) {
        const err = new Error(`T2 guided step ${step} refused: ${admission.reason}`)
        ;(err as { code?: string }).code = admission.code
        // Schema/foreign-key refusals are a DRIFT (correctable with the
        // guidance prompt already in the message); free ids / bypass
        // containers are ESCAPE (zero budget, W4).
        // TASK-2026-09-09 D1 adjudication (维护者 task book, narrowing W4):
        // a CROSS-STEP reference inconsistency (`unledgered_reference` — the
        // declared locator/result_refs missed the ledger) is a correctable
        // drift, not an attack: it now rides the DRIFT budget with the
        // reason fed back into the next step prompt. True attack forms
        // (free_id = forged harness id, free_structure = off-ledger unit/
        // criticality, bypass_container) stay ESCAPE zero-retry and are
        // pinned by tests (executor-guided.spec attacks 1/3 + free-structure).
        ;(err as { w4Class?: FailureClass }).w4Class =
          admission.code === 'step_foreign_key' ||
          admission.code === 'schema_violation' ||
          admission.code === 'unledgered_reference'
            ? 'DRIFT'
            : 'ESCAPE'
        // 同一个不变量：这条路径**也可能是 DRIFT**（上面三种 code），所以它也必须
        // 带输出指纹——否则熔断键退化成与输出无关，第 2 次尝试必然跳闸。
        // 由 `tests/executor-fingerprint-sites.spec.ts` 静态核对：每一个可能取到
        // DRIFT 的 w4Class 赋值点，都必须在 throw 之前设 outputFingerprint。
        ;(err as { outputFingerprint?: string }).outputFingerprint = sha256Hex(text)
        throw err
      }
      session = admission.session
      this.#guidedByRun.set(runKey, session)
    }
    const assembled = assembleGuidedContainer(session, taskText)
    this.#guidedByRun.delete(runKey)
    return assembled
  }

  /**
   * TASK-PW W4: the protocol tier a run currently expects of the model.
   * Defaults to T1 (full declarations); NONE exhaustion steps it down
   * (W-B: NONE 耗尽记 failure 并降层). Read by the W5 probe registry.
   */
  tierOf(runId: RunId): Tier {
    return this.#tierByRun.get(String(runId)) ?? this.options.initialTier ?? initialTier()
  }

  /**
   * W8.9-A4: is the sharded EXECUTE declaration the path for this run?
   *
   * Single reader for the switch, so the default can never drift between
   * call sites. Precedence:
   *   1. `disableShardDeclare: true` → OFF (explicit opt-out, W8.9-A4).
   *   2. `shardDeclare` explicitly set → that value (A/B + regression).
   *   3. otherwise → ON (W8.9-A4: sharding is the default path).
   */
  shardDeclareEnabled(): boolean {
    if (this.options.disableShardDeclare === true) return false
    if (this.options.shardDeclare !== undefined) return this.options.shardDeclare
    return true
  }

  /**
   * W8.9-B1: is the E1/E2 receive layer the path for this run?
   *
   * Precedence mirrors `shardDeclareEnabled`: explicit opt-out, then the
   * explicit value, then the default (ON). E1/E2 wins over sharding when
   * both are on — sharding splits the CONTAINER declaration, E1/E2 replaces
   * the container obligation altogether; running both would ask the model
   * for a container it no longer needs to produce in one shot.
   */
  e1e2Enabled(): boolean {
    if (this.options.disableE1E2 === true) return false
    if (this.options.e1e2 !== undefined) return this.options.e1e2
    return true
  }

  /** W8.9-B3/B4: are the fidelity findings refusals, or just recorded? */
  fidelityEnforced(): boolean {
    return this.options.enforceFidelity !== false
  }

  /** W8.9-B3: the E1 analysis of a run, if the receive layer produced one. */
  e1AnalysisOf(runId: RunId): string | undefined {
    return this.#e1ByRun.get(String(runId))
  }

  /**
   * W8.10-B1: every id already in the canonical store. Handed to the drift
   * guidance so a retry is told which ids it may reference but must not
   * declare — the direct fix for W8.9 run-3's `conflicting_id` (`S-P` declared
   * twice with different content).
   */
  private registeredIdsOf(): ReadonlyArray<string> {
    const ir = this.options.ir
    if (ir === undefined) return []
    const snapshot = ModelingIr.snapshot(ir)
    if (snapshot === null) return []
    // Sorted so the guidance text is deterministic across runs (the same
    // store must produce the same prompt bytes).
    return [...snapshot.keys()].sort()
  }

  /**
   * 已注册的子问题 id（`P1`…）。
   *
   * 自检工具的"每个子问题都要有自己的 ModelSpec"这条判据需要它——判据是
   * **逐问**的，没有子问题清单就只能退化成"至少有一个模型"，那正是它要治的缺陷。
   */
  private problemScopesOf(): ReadonlyArray<string> {
    const ir = this.options.ir
    if (ir === undefined) return []
    return [...ir.list()]
      .filter(r => r.kind === 'ProblemSpec')
      .map(r => String((r.value as { problem_id?: unknown }).problem_id ?? ''))
      .filter(id => id.length > 0)
      .sort()
  }

  /** W8.10-B1: drop the pending corrections once an attempt succeeds. */
  private clearE2Violations(runId: RunId): void {
    this.#e2ViolationsByRun.delete(String(runId))
  }

  /**
   * Execute one run end to end. Fast mode delivers after its revise rounds
   * even with defects; strict mode fails the run when defects persist.
   * @param runId - Run to execute.
   * @param input - User task text.
   * @returns the final run record and its manifest.
   */
  async execute(
    runId: RunId,
    input: string,
    /** W11.5 baseline-18: the paper-visible problem statement, when it
     *  differs from the model-facing task text (the CLI appends the
     *  method-family banner to the latter). Absent = `input` is both. */
    problemStatement?: string,
  ): Promise<ExecutionOutcome> {
    if (problemStatement !== undefined) this.#problemStatementByRun.set(String(runId), problemStatement)
    const initial = this.runOf(runId)
    // TASK -1 rewire: refuse to start a run unless the runtime guard is
    // readied and the run mode matches the active profile. This is the
    // enforcement boundary the red-team P0-07 asked for: a mode mismatch
    // throws `RuntimeNotReadyError` here rather than allowing the run to
    // drift into a misconfigured execution path.
    this.runtimeGuard.assertRuntimeReady(initial.mode)
    const policy = resolveRunPolicy(initial.mode)
    if (initial.status === 'planning') await this.engine.transitionRun(runId, 'running')
    await this.audit({ eventType: 'workflow_started', actor: 'paper-executor', runId, detail: { mode: initial.mode } })

    try {
      // ── L0 能力画像 ────────────────────────────────────────────────
      // 档位决定两件事：门禁的**初始强度**（强模型跑一程可能一个门禁都没感知到）
      // 与**教学前置量**。代码里没有第二套流程——只多一个自适应参数。
      const capability: CapabilityProfile = this.options.capabilityTier === undefined
        ? defaultProfile('本次运行未声明档位，探针执行器尚未接线')
        : profileForTier(this.options.capabilityTier, `调用方声明档位 ${this.options.capabilityTier}`)
      await this.audit({
        eventType: 'capability_check',
        actor: 'paper-executor',
        runId,
        detail: { tier: capability.tier, rationale: capability.rationale, preloadKnowledge: capability.teaching.preloadKnowledge },
      })
      // 热重启：把已检查通过的切片**播种**回来。
      // 播种是显式的、可审计的——审计里记 `resume_seeded`，所以"这一轮跳过了哪些
      // 阶段"是一个事实，而不是看不见的捷径。
      // 判据必须是"**真的播了东西**"，不能是 `resumeFrom !== undefined`：
      // schema 会把声明过的可选对象物化成 `{ analyze: undefined, container: undefined }`，
      // 于是 `!== undefined` 为真而什么都没播——审计里因此多出一条 `resume_seeded`，
      // 一批断言"审计序列逐字相等"的用例当场变红。**空播种不是播种。**
      const seedE1 = this.options.resumeFrom?.analyze
      const seedContainerCandidate = this.options.resumeFrom?.container
      if ((seedE1 !== undefined && contentExists(seedE1))
        || (seedContainerCandidate !== undefined && contentExists(seedContainerCandidate))) {
        if (seedE1 !== undefined && contentExists(seedE1)) {
          this.#e1ByRun.set(String(runId), seedE1)
        }
        const seedContainer = seedContainerCandidate
        if (seedContainer !== undefined && contentExists(seedContainer)) {
          this.#seededContainerByRun.set(String(runId), seedContainer)
        }
        await this.audit({
          eventType: 'resume_seeded',
          actor: 'paper-executor',
          runId,
          detail: {
            analyze: seedE1 === undefined ? 'not-seeded' : `${String(seedE1.length)} chars`,
            container: seedContainer === undefined ? 'not-seeded' : `${String(seedContainer.length)} chars`,
            note: '热重启：E1 与容器来自已检查通过的切片，本轮不重发这两次模型调用',
          },
        })
      }
      // L6 门禁状态机：本次运行的门禁强度账本。快照进审计轨迹，因此
      // "这次运行被收紧到什么程度"永远是可核验的，不是事后回忆。
      const gateState = new GateStateMachine(capability.tier)

      // ── L1 知识外置：把技能库写进工作区 ─────────────────────────────
      // 索引里写着一个读不到的路径，等于没写。运行开始就落盘，模型才能真的
      // read_file 到它们。没有 finalOutputRoot 时不落盘（审计里如实说明）。
      const runWorkspace = this.options.finalOutputRoot === undefined
        ? null
        : join(this.options.finalOutputRoot, String(runId))
      const skillsWritten = runWorkspace === null ? [] : materializeSkillLibrary(runWorkspace)
      await this.audit({
        eventType: 'skill_library_materialized',
        actor: 'paper-executor',
        runId,
        detail: runWorkspace === null
          ? { files: 0, reason: 'no finalOutputRoot mounted — 技能库未落盘，索引中的路径不可读' }
          : { files: skillsWritten.length, dir: SKILL_LIBRARY_DIR, root: runWorkspace },
      })

      const task: PromptSection = { name: 'task', text: `Task: ${input}`, trimPriority: TRIM_TASK }
      const plan = await this.runNode(runId, 'plan', 'plan', 'executor', [
        task,
        { name: 'instruction', text: 'Produce a short numbered execution plan.', trimPriority: KEEP },
      ])
      // ── L2 探索—择优：动笔之前先比较 ────────────────────────────────
      //
      // 建模论文的质量差距**大半在"选了什么方法"**。线性流程把选择权交给运气：
      // 模型一旦开始写代码，探索就结束了，而它此时还没比较过任何替代方案。
      // 这两个节点把"方法选择"从一次性赌注变成可复核的决策。
      //
      // **fail-soft**：任一节点失败只记审计并继续。探索是"想得更好"的机制，
      // 不是"必须通过"的门——把它做成硬门会让它变成新的零产物来源。
      const exploreEnabled = this.options.exploreDeepen ?? (initial.mode === 'strict')
      let decisionRecord = ''
      if (exploreEnabled && this.options.produceFromExecute === true) {
        try {
          const explored = await this.runNode(runId, 'plan', 'explore', 'executor', [
            task,
            { name: 'instruction', text: EXPLORE_INSTRUCTION, trimPriority: KEEP },
            // 本步骤简报**放最后**（最后 = 最高优先级）：它指名这一步必读的文件、
            // 说明里面有什么、给出负面清单与可机械核验的完成标志。
            { name: 'this-step', text: this.briefingOf('explore', {
              target: '每个子问题 2–3 个方案草图（方法名 + 核心思路 + 需要什么 + 主要风险 + 预期深度）',
              upstream: '题面与已注册的子问题清单已在上文；尚无任何方案。',
              done: '每个子问题都有 2–3 个候选被逐行引入（"方案一：…"），且没有写任何代码。',
            }), trimPriority: KEEP },
          ])
          const selected = await this.runNode(runId, 'plan', 'select', 'executor', [
            task,
            { name: 'sketches', text: `Candidate sketches:
${explored.text}`, trimPriority: TRIM_PLAN },
            { name: 'instruction', text: SELECT_INSTRUCTION, trimPriority: KEEP },
            { name: 'this-step', text: this.briefingOf('select', {
              target: '一份择优记录：每个子问题一张打分表 + 选定者 + 每个落选者各自的落选理由',
              upstream: '候选草图已在上文（sketches）。',
              done: '每个子问题都有 ≥2 个候选、一次明确的选择、以及每个落选者的理由。',
            }), trimPriority: KEEP },
          ])
          decisionRecord = selected.text
          // **机械检查择优记录**——把"有没有真的比较"从 prompt 约定变成可检出的事实。
          // 缺陷进 L6 门禁状态机（`explore_deepen` 门禁）：首次违规注入针对性微教学。
          // 探索是"想得更好"的机制，所以这里是**检出**而不是拒绝。
          const recordFindings = reviewDecisionRecord(
            decisionRecord,
            this.options.ir === undefined
              ? []
              : [...this.options.ir.list()].filter(r => r.kind === 'ProblemSpec').map((r) => {
                const ps = r.value as { problem_id?: unknown }
                return String(ps.problem_id ?? '')
              }).filter(id => id.length > 0),
          )
          const taught: string[] = []
          for (const finding of recordFindings) {
            const disposition = gateState.recordViolation('explore_deepen')
            if (disposition.microTeaching !== null) taught.push(disposition.microTeaching)
            await this.audit({
              eventType: 'gate_state_changed',
              actor: 'paper-executor',
              runId,
              detail: {
                gate: 'explore_deepen',
                to: disposition.mode,
                taught: disposition.microTeaching !== null,
                defect: finding.id,
              },
            })
          }
          await this.audit({
            eventType: 'explore_select_completed',
            actor: 'paper-executor',
            runId,
            detail: {
              sketches: explored.text.length,
              decision: selected.text.length,
              defects: recordFindings.map(f => `${f.id}:${f.description}`),
              taught: taught.length,
            },
          })
        } catch (error) {
          // 如实记录，不吞掉、也不因此拒绝运行。
          await this.audit({
            eventType: 'explore_select_completed',
            actor: 'paper-executor',
            runId,
            detail: { failed: true, message: String(error).split(String.fromCharCode(10))[0] },
          })
        }
      }

      const draft = await this.runNode(runId, 'execute', 'execute', 'executor', [        task,
        { name: 'plan', text: `Plan:\n${plan.text}`, trimPriority: TRIM_PLAN },
        {
          name: 'instruction',
          // P3-3 (teaching segment v0): when the EXECUTE node's output is
          // consumed as an ir-container-v1, the protocol is TAUGHT in the
          // instruction itself — adherence is a property of protocol +
          // teaching as a combination, so they ship together. The segment
          // only describes schema-native structure (禁10: no free-form
          // format is required or demonstrated); the plain prose
          // instruction stays for non-producing runs.
          text: this.options.produceFromExecute === true
            ? constitutionText()
            : 'Produce the deliverable text for the task.',
          trimPriority: KEEP,
        },
        // L2：择优结论注入 EXECUTE——模型按**已经比较过**的方案深挖，
        // 而不是从零开始想。空串时不产生 section（历史交付逐字节不变）。
        ...(decisionRecord.length === 0
          ? []
          : [{ name: 'decision', text: `Method decision record (explore → select; follow the chosen candidate unless it provably fails):
${decisionRecord}`, trimPriority: TRIM_PLAN }]),
        // L1 本步骤简报**放最后**：指名这一步必读的四份技能文档（含里面有什么、
        // 为什么这一步需要它）、负面清单、以及可机械核验的完成标志。
        // 它同时进 E1 与 E2 的 prompt（E1 只过滤掉宪法那一段）。
        ...(this.options.produceFromExecute === true
          ? [{
            name: 'this-step',
            text: this.briefingOf('produce', {
              target: '一个 ir-container-v1 容器：条目声明 + 可运行的 code + 从 code 输出读回的 results/claims/figures + 八章 narrative',
              upstream: `题面与已注册的子问题（${String(this.options.ir === undefined ? 0 : [...this.options.ir.list()].filter(r => r.kind === 'ProblemSpec').length)} 个）已在上文；数字尚未产生。${decisionRecord.length === 0 ? '' : '方案决策记录已在上文（decision）——按选定的候选深挖。'}`,
              done: '容器被准入（首键为版本标记、entries 非空、引用全部解析）；每个子问题都有自己的一条 CRITICAL 结论；正文里的每个数字要么是 {<result_id>} 占位符，要么等于某个 Result 的值。',
            }),
            trimPriority: KEEP,
          }]
          : []),
      ], input)

      let current = draft.text
      // E4a (P2, sign-off A): defects accumulate ACROSS rounds. A defect
      // leaves the set ONLY through an explicit `resolved` id in a later
      // review verdict; a clean-looking review that resolves nothing cannot
      // silently age a CRITICAL out — critical never expires without its
      // resolved record. Review rounds carry an unresolved-defect ledger and
      // ask the reviewer to adjudicate it (remaining/resolved) instead of
      // re-discovering defects from scratch each round.
      const unresolved = new Map<string, ReviewDefect>()
      let advisoryDefects: ReviewDefect[] = []
      let gatePassed = false
      for (let round = 0; round <= policy.maxReviseRounds; round += 1) {
        // L5：一轮评审 = 每个视角一次独立调用（fast 档只跑 1 个视角，成本随档位走）。
        // 三个 persona 各自独立上下文，缺陷合并进同一本 ledger——**任一视角提出的
        // 缺陷都不会因为"另一个视角没提"而消失**。
        const personas = this.reviewPersonasOf(initial.mode)
        const merged: { defects: ReviewDefect[]; resolved: string[]; nodeId: NodeId | null } = { defects: [], resolved: [], nodeId: null }
        const multiPersona = personas.length > 1
        for (const persona of personas) {
          const review = await this.runNode(
            runId, 'review',
            multiPersona ? `review ${PERSONA_SHORT[persona]} #${round + 1}` : (round === 0 ? 'review' : `review #${round + 1}`),
            'reviewer',
            [
              ...reviewSections(task, current, [...unresolved.values()], this.semanticContextOf(), multiPersona ? persona : null),
              {
                name: 'this-step',
                text: this.briefingOf('review', {
                  target: `一份缺陷清单（JSON）：只含你这一视角（${multiPersona ? PERSONA_SPEC[persona].name : '综合'}）内的缺陷，每条带可指到具体文字或结果的证据`,
                  upstream: `待评审的正文已在上文（draft）。${multiPersona ? '本轮共 3 个视角并行评审，你的缺陷 id 会被自动加前缀，不必自己编号。' : ''}`,
                  done: '返回的 JSON 能被解析，且每条缺陷都有证据。零缺陷也是合法结果——但不要为了"有输出"而报没有证据的缺陷。',
                }),
                trimPriority: KEEP,
              },
            ],
          )
          merged.nodeId = merged.nodeId ?? review.nodeId
          const part = parseReviewReport(review.text, [...unresolved.keys()], {
            context: this.semanticContextOf(),
            delivered: current,
          })
          // **前缀由 harness 加，不靠 prompt 约定**。
          //
          // 三个视角各自从 `D1` 开始编号；若只让模型"记得加前缀"，两个视角写出
          // 同一个 id 时后一条会覆盖前一条——**缺陷静默消失**，而这是最难发现的
          // 那类失败（ledger 看起来正常，只是少了一条）。前缀因此在合并处机械施加，
          // 与模型是否听话无关。单视角时保持原 id（历史归档逐字节不变）。
          const prefix = multiPersona ? `${PERSONA_SHORT[persona]}-` : ''
          merged.defects.push(...part.defects.map(d => prefix === '' ? d : { ...d, id: `${prefix}${d.id}` }))
          merged.resolved.push(...part.resolved.map(id => `${prefix}${id}`))
        }
        const report = merged
        for (const id of report.resolved) unresolved.delete(id)
        // W11.5 baseline-18 (审计 A-2): MECHANICAL defects join the same ledger
        // as the reviewer's. The D4 guard used to run only at render time, and
        // the revise rounds rewrite the text afterwards — so a refused section
        // could come back as edited prose whose numbers no guard ever saw (the
        // seventeenth baseline's ledger names exactly that, three times). A
        // mechanical finding cannot be argued away: the editor must fix it, and
        // an unfixed one stays on the ledger to the end (critical never expires
        // without a resolved record).
        for (const defect of this.mechanicalDefects(current)) {
          if (!unresolved.has(defect.id)) unresolved.set(defect.id, defect)
        }
        for (const defect of report.defects) {
          const prior = unresolved.get(defect.id)
          if (prior !== undefined && prior.severity === 'critical' && defect.severity !== 'critical') {
            // Fail-closed: a re-reported critical cannot be downgraded in
            // place — the only legal exit for a critical is `resolved`.
            unresolved.set(defect.id, { ...prior, description: defect.description })
          } else {
            unresolved.set(defect.id, defect)
          }
        }
        // ── L6 门禁状态机：把本轮检出的缺陷记进状态机 ──────────────────
        //
        // 这是"约束按需提供"的落点：DORMANT 起步的门禁在**首次**违规时吐出一条
        // **针对性微教学**（只讲被违反的那一条），由下一轮修订的 prompt 带给模型；
        // 同维度再次违规则收紧为 ENFORCE。
        //
        // 状态机的违规计数不是装饰——它同时是"这次运行被收紧到什么程度"的证据，
        // 以及下次运行档位的负反馈来源。
        const microTeaching: string[] = []
        for (const defect of unresolved.values()) {
          const gateId = gateIdOfDefect(defect)
          if (gateId === null) continue
          const disposition = gateState.recordViolation(gateId)
          if (disposition.microTeaching !== null) {
            microTeaching.push(disposition.microTeaching)
            await this.audit({
              eventType: 'gate_state_changed',
              actor: 'paper-executor',
              runId,
              detail: { gate: gateId, to: disposition.mode, taught: true, round },
            })
          } else if (disposition.enforcing && gateState.violationsOf(gateId) === 2) {
            await this.audit({
              eventType: 'gate_state_changed',
              actor: 'paper-executor',
              runId,
              detail: { gate: gateId, to: disposition.mode, taught: false, round },
            })
          }
        }
        for (const defect of unresolved.values()) {
          await this.engine.appendPublic(runId, report.nodeId, 'defect', {
            severity: defect.severity,
            description: defect.description,
            defectId: defect.id,
          })
        }
        // E4a: a resolved record is the ONLY way a defect leaves the ledger.
        // When nothing is unresolved the paper is clean; otherwise the editor
        // gets the remaining rounds to fix it and the reviewer adjudicates
        // again — the gate below decides at the ceiling, and a CRITICAL with
        // no resolved record never expires.
        if (unresolved.size === 0) {
          gatePassed = true
          break
        }
        if (round === policy.maxReviseRounds) break
        const revised = await this.runNode(
          runId, 'revise', `revise #${round + 1}`, 'editorAi',
          [
            task,
            { name: 'draft', text: `Current text:\n${current}`, trimPriority: TRIM_DRAFT },
            {
              name: 'defects',
              text: `Defects:\n${[...unresolved.values()].map(defect => `- [${defect.id}] [${defect.severity}] ${defect.description}`).join('\n')}`,
              trimPriority: TRIM_DEFECTS,
            },
            {
              name: 'instruction',
              text: 'Return the corrected FULL text only — every section heading preserved, same order, no commentary. Never return the task statement.',
              trimPriority: KEEP,
            },
            // L6：**针对性微教学**——只讲这一轮被违反的那几条规则，几百字，
            // 不是整本手册。这是"约束按需提供"的机械落点：强模型永远看不到它，
            // 弱模型在它被证明踩过的维度上精确地拿到帮助。
            ...(microTeaching.length === 0
              ? []
              : [{ name: 'targeted-teaching', text: `Targeted corrections (each one addresses a rule you just violated — read them, they are short):
${microTeaching.map((m, i) => `${String(i + 1)}. ${m}`).join(String.fromCharCode(10))}`, trimPriority: KEEP }]),
            { name: 'this-step', text: this.briefingOf('revise', {
              target: '修订后的**完整正文**（章节标题与顺序全部保留，无评论、无题面复制）',
              upstream: `当前正文与缺陷清单已在上文（draft / defects）。${microTeaching.length > 0 ? `另有 ${String(microTeaching.length)} 条针对性微教学（targeted-teaching）——它们针对的正是你刚违反的规则。` : ''}`,
              done: '返回的正文保留了原稿的全部章节标题、未变短到一半以下、且缺陷清单里的每一条都被真正改掉（不是改文字迎合旧数字）。',
            }), trimPriority: KEEP },
          ],
        )
        // 首次真实产出实测（baseline-4）：修订轮的输出被**直接**当作交付文本，
        // 而编辑器拿到了 `Task: <题面>`——它把题面当"corrected text"返回，
        // 于是交付物变成了题面复制（形态 1 假绿：看起来是文档，实际不是稿子）。
        // 守卫：修订不得摧毁稿子结构——章节标题集合必须被保留，且篇幅不得
        // 塌缩到一半以下；违反则**拒绝该次修订**（保留上一版）并记账。
        const guard = revisionDestroysDraft(current, revised.text)
        if (guard.rejected) {
          await this.audit({
            eventType: 'ir_entry_written',
            actor: 'paper-executor',
            runId,
            detail: {
              kind: 'RevisionRejected',
              id: `revise#${round + 1}`,
              nodeId: revised.nodeId,
              reason: guard.reason ?? 'revision destroyed the draft',
              kept_chars: current.length,
            },
          })
          continue
        }
        current = revised.text
      }

      // E4c (P2, sign-off A): fast mode may deliver with MINOR defects left
      // (advisory, audited); MAJOR/CRITICAL still block. strict / formal /
      // exploratory keep zero tolerance — any unresolved defect blocks.
      if (!gatePassed && initial.mode === 'fast') {
        const outstanding = [...unresolved.values()]
        if (outstanding.every(d => d.severity === 'minor')) {
          gatePassed = true
          advisoryDefects = outstanding
        }
      }
      if (!gatePassed && initial.mode !== 'fast') {
        gatePassed = unresolved.size === 0
      }
      const outstandingList = [...unresolved.values()]
      const criticalCount = outstandingList.filter(d => d.severity === 'critical').length
      await this.engine.appendPublic(runId, null, 'gate_result', {
        gate: 'review',
        passed: gatePassed,
        defects_total: outstandingList.length,
        defects_critical: criticalCount,
        advisory: advisoryDefects.length,
      })

      // TASK 1.25: the paper may not be delivered unless its mathematical
      // facts exist as canonical IR. Without this call the workflow still had
      // a complete text-only path to a manifest, which made every IR
      // guarantee vacuous (external-advisory finding IR_CAN_BE_BYPASSED).
      // Claims are empty for now: TASK 2 introduces the Claim→Result→Run
      // TASK 3 repair (3.R2 / INV-3-K): there is exactly ONE delivery
      // verdict path. `buildDeliveryPolicy` walks the gate registry; the
      // resulting policy is handed to `evaluateDelivery`; whatever it
      // returns is the only thing the executor reasons about. No
      // parallel `if (gate.status === 'PASS') return` branches remain.
      //
      // TASK 5.0.5: the verdict is returned so the promoter below can be
      // handed the *same* decision instead of re-evaluating the policy.
      //
      // P0-3 (PRD v2 §3.3): under fail-soft the SAME verdict feeds the
      // grade function — `gradeDelivery` is the single judge of whether
      // a failure blocks or annotates; the executor never invents a
      // second verdict path for it.
      const verdict = await this.enforceDelivery(runId, initial.mode)

      // P0-3: collect the unpassed review defects as grade-input failures
      // too — a surviving critical defect is an annotation (or, with empty
      // content, a fatal probe) but never a separate decision branch.
      const reviewFailures: ReadonlyArray<{ kind: string; reason: string }> = gatePassed
        ? []
        : outstandingList.map(d => ({
          kind: `review_defect_${d.severity}`,
          reason: d.description,
        }))
      // W8 (PRD §6.4): the V1–V4 structural verifiers join the fail-soft grade
      // input — a V failure is an annotation in the MARKED appendix, never a
      // parallel verdict path. IR-mounted compositions only; a missing store
      // contributes no findings. STRICT-TOLERANCE keeps the historical
      // fail-closed input byte-for-byte (V findings do NOT participate
      // there — P0-3 changes fail-soft compositions only).
      const vFindings: ReadonlyArray<{ kind: string; reason: string }> = this.options.deliveryGradeMode !== 'fail-soft' || this.options.ir === undefined
        ? []
        : runVerificationV1V4(this.options.ir)
          .filter(f => !f.ok)
          .map(f => ({ kind: f.rule, reason: f.detail }))
      const gateFailures = verdict.decision.failures
      // W8.12 (E1 direct delivery): when the run got here via the fallback,
      // the receive layer's terminal failure joins the grade input — it is an
      // ANNOTATION (the appendix names the real cause) and never a separate
      // verdict path. Without this the appendix would not say why the paper
      // is an unverified analysis draft.
      const receiveFacts = this.options.deliveryGradeMode === 'fail-soft'
        ? this.#receiveFailures.get(String(runId))
        : undefined
      const receiveFailures: ReadonlyArray<{ kind: string; reason: string }> = receiveFacts === undefined
        ? []
        : [{
          kind: 'e2_normalization_failed',
          reason: `${receiveFacts.reason}（未通过的保真检查：${receiveFacts.failedRules.join('、') || '无'}）`,
        }]
      // W11.5-A3: the digit check runs on the DELIVERED text when the body is
      // the E1 analysis (path B — the one path with no executable evidence).
      // Its findings are annotations (fail-soft), never a separate verdict
      // path: a self-contradicting draft is MARKED with the contradiction
      // named, not silently delivered and not blocked.
      // W11.5 baseline-18: EVERY fail-soft path, not only the E1-direct one. The
      // scan is zero-false-positive (a correct draft never contradicts itself),
      // and on the chain path it is the only thing that looks at the text AFTER
      // the revise rounds rewrote it.
      const digitFindings: ReadonlyArray<{ kind: string; reason: string }> =
        this.options.deliveryGradeMode === 'fail-soft'
          ? digitSelfContradictionFindings(current).map(f => ({ kind: f.kind, reason: f.reason }))
          : []
      // W11.5 round-6（审计 T-5）: E1 直通稿**绕过链上全部门禁**，实测出现过 4 个章节
      // 只有 19–22 字符（baseline-29）。直通的意义是"总得交出点东西"，所以这里按
      // **标注**处理而不是拒绝：把空白/近空章节逐条写进 MARKED 附录，让读者知道
      // 哪些章节是空的。
      const blankFindings: ReadonlyArray<{ kind: string; reason: string }> =
        this.options.deliveryGradeMode === 'fail-soft' && this.options.ir !== undefined
          ? blankAreaViolations(
            current,
            [...this.options.ir.list()]
              .filter(r => r.kind === 'RequirementSpec')
              .map((r) => {
                const req = r.value as { requirement_id?: unknown; statement?: unknown }
                return { requirementId: String(req.requirement_id ?? ''), statement: String(req.statement ?? '') }
              }),
          ).map(v => ({ kind: 'blank_area', reason: v.reason }))
          : []
      const deliveryPathEarly: DeliveryPath = this.#deliveryPathByRun.get(String(runId)) ?? 'A-produce-chain'
      const contractRequirements: ReadonlyArray<ContractRequirement> = this.options.ir === undefined
        ? []
        : [...this.options.ir.list()]
          .filter(r => r.kind === 'RequirementSpec')
          .map((r) => {
            const req = r.value as { requirement_id?: unknown; statement?: unknown }
            return { requirementId: String(req.requirement_id ?? ''), statement: String(req.statement ?? '') }
          })
      // W12-B1 — **按渲染后的最终正文**重跑正文契约与数字普查。
      //
      // 上面那条 `blankFindings` 是同一个形态的先例（对 `current` 做文本检查、
      // 按标注处理）。这一条补的是另一件事：`proseContractViolations` 读的是
      // `narrative`，于是**兜底路径根本不进它的判据**（兜底稿没有 narrative）。
      // 而兜底稿之后还要过修订轮——实测（strict-11）修订轮把兜底稿里"本稿没有
      // 模型评价与推广…"的如实说明，整章改写成了 1,193 字的真内容，那两章
      // **从未被任何契约检查过**。
      //
      // 这里不拒绝任何东西（兜底的意义是"总得交出点东西"），只把违规逐条报出来，
      // 让它们落进交付附录的已知缺陷表。判据与产线链同一套函数。
      const finalTextFindings: ReadonlyArray<{ kind: string; reason: string }> =
        this.options.deliveryGradeMode === 'fail-soft'
          ? [
            ...proseContractViolationsOfText(current, contractRequirements)
              .map(v => ({ kind: 'prose_contract', reason: `${v.title}：${v.reason}` })),
            // 数字暴露量：只在**数字没有代码通道**的路径上报。
            // 产线链的数字来自 Result，逐条可溯源，报它反而是噪声。
            // 格式审计：以参照物论文为唯一合法标准（见 format-audit.ts 的模块注释）。
            // 格式飘移是静默的——论文照样能读、能导出、能交付，只是形态不再与参照物
            // 一致。实测：round-9 之后 13 次运行的交付稿 `###` 小节数全部为 0。
            ...formatViolations(current).map(v => ({ kind: 'format_drift', reason: `[${v.rule}] ${v.title}：${v.detail}` })),
            ...(deliveryPathEarly === 'B-e1-direct'
              ? ((): ReadonlyArray<{ kind: string; reason: string }> => {
                const n = numericClaimCensus(current)
                return n === 0 ? [] : [{
                  kind: 'unverified_numbers',
                  reason: `本稿正文含 ${String(n)} 处数字字面量，**全部未经代码通道验证**：`
                    + '它们来自模型的自由分析（E1），不是运行产物。稿中若有"经…验证""满足…要求"这类句子，'
                    + '那是模型的自述，不是校验结果——本轮的独立复算已证实这类自述出现过错误。',
                }]
              })()
              : []),
          ]
          : []
      const gradeInput = this.options.deliveryGradeMode === 'strict-tolerance'
        ? [...gateFailures, ...reviewFailures]
        : [...gateFailures, ...reviewFailures, ...vFindings, ...receiveFailures, ...digitFindings, ...blankFindings, ...finalTextFindings]
      const deliveryPath: DeliveryPath = deliveryPathEarly
      // ── 致命条件接上**真实判定**（D4 的修法）────────────────────────
      // 旧代码把 `executionFailed` 与 `referenceCatastrophe` 写死为 false，
      // 于是文档承诺的三个致命条件实际只有"空内容"可达——"退化为 MARKED 的
      // 保护伞有三根伞骨是画上去的"。现在它们各有真实来源。
      const irRecords = this.options.ir === undefined ? [] : [...this.options.ir.list()]
      const resultIds = new Set(irRecords.filter(r => r.kind === 'Result').map((r) => {
        const v = r.value as { result_id?: unknown }
        return String(v.result_id ?? '')
      }))
      // 悬空引用：IR 里**有** claim 声称绑定了 Result，但那些 Result 一个都不存在。
      // 这才是"正文数字声称有支撑而实际上没有"——与"根本没证据"是两件事。
      const danglingClaims = irRecords
        .filter(r => r.kind === 'Claim')
        .filter((r) => {
          const v = r.value as { result_refs?: unknown }
          const refs = Array.isArray(v.result_refs) ? v.result_refs.map(String) : []
          return refs.length > 0 && refs.every(ref => !resultIds.has(ref))
        })
      // 没有可执行证据：未挂载 IR，或一个 Result 都没铸出来。**兜底直通路径除外**
      // ——它按定义就是那条路，由 DEGRADED 档如实标注（F1：下限不为零）。
      const unverified = deliveryPath !== 'B-e1-direct' && resultIds.size === 0
      const fatal = {
        emptyContent: !contentExists(current),
        // 致命条件 2 接上真实判定（旧代码写死 false，见 D4）：链路上声明了执行，
        // 却一个 Result 都没铸出来。它现在是 DEGRADED 的证据，不是硬拒绝——
        // "代码没跑成"应当交出一份标注清楚的草稿，而不是零产物。
        executionFailed: deliveryPath === 'A-produce-chain' && resultIds.size === 0,
        // 致命条件 3：引用灾难（悬空引用）——这才是该拒绝的形态。
        referenceCatastrophe: danglingClaims.length > 0,
      }
      const graded = gradeDelivery(gradeInput, fatal, {
        ...Object.fromEntries(gradeInput.map(f => [f.kind, f.kind.startsWith('review_defect') ? 'review ledger' : (f.kind.startsWith('V') ? 'verification' : 'delivery')])),
      })

      // ── L6 闭环：每条 finding 必须有归宿 ─────────────────────────────
      //
      // 这是全案唯一真正新增的一层，也是两侧都缺的那一半：一边是"检测到但
      // 无消费方"，另一边是"findings 一律 BLOCKED → 零产物"。本层的目标不是
      // 二选一，而是让 findings **有终止状态**：已修 / 显式接受 / 明确驳回。
      //
      // 便宜那层（格式）真的自动修 + 复验；贵那层（建模）不假装修过——
      // 它走"显式接受"并写进交付物附录的已知缺陷表，让读者看得见。
      // 复验的输入：被检查产物的**当前状态**。指纹由真检查器给出（见
      // `delivery/recheck.ts`）——绝不由文本长度派生，那是假复验。
      const narrativeOf = (): Readonly<Record<string, unknown>> => {
        const snap = this.#narrativeByRun.get(String(runId))
        return (snap ?? {}) as Readonly<Record<string, unknown>>
      }
      const recheckInput = (text: string): RecheckInput => ({
        text,
        narrative: narrativeOf(),
        requirements: contractRequirements,
        store: this.options.ir === undefined ? null : new Map([...this.options.ir.list()].map(r => [String((r.value as { [k: string]: unknown }).id ?? Object.values(r.value)[0] ?? ''), r])),
      })

      // 同一门禁可以对不同产物各报一条、指纹还相同——按出现次序去重 id，
      // 否则闭环按 id 消解时会反复命中第一条，重复项永远留在 open。
      const occurrenceOf = new Map<string, number>()
      const findings: Finding[] = gradeInput.map((f) => {
        const fingerprint = initialFingerprint(f.kind, recheckInput(current))
        const key = `${f.kind}::${fingerprint}`
        const occurrence = occurrenceOf.get(key) ?? 0
        occurrenceOf.set(key, occurrence + 1)
        return makeFinding({
          category: f.kind,
          severity: severityOfKind(f.kind),
          checker: f.kind,
          files: ['paper/main.md'],
          artifactScope: scopeOfKind(f.kind),
          evidence: f.reason,
          // 初始指纹由**与复验同一个函数**给出——两个算法算出的值没法比。
          fingerprint,
          fixHint: '见交付附录；格式类由自动返修处理，其余按 artifact_scope 分派。',
          occurrence,
        })
      })
      const closure = new ClosureSession(findings, this.options.closureBudget ?? DEFAULT_CLOSURE_BUDGET)
      // 自动返修只做**确定性**那一层，且每一项都必须通过 N30 不变量。
      // 判定权在"重跑同一 checker 后比对指纹"，不在修复函数自称（C1）。
      let repairedText = current
      for (const finding of findings) {
        const attempt = attemptAutoRepair(finding, repairedText)
        if (attempt.produced && attempt.semanticsPreserved) {
          repairedText = attempt.text
          // 复验：**重跑同一类别的检查器**，指纹变化才算修复。
          closure.recheck(finding.id, recheckFinding(finding.category, recheckInput(repairedText)))
        } else if (attempt.semanticsPreserved === false) {
          // 修复被 N30 拒绝 → 如实记为"无法复验"（与未通过同级），不是"没检出问题"。
          closure.recheck(finding.id, { kind: 'checker_failed', reason: attempt.detail })
        }
        // **状态从闭环读**，不是从我手里那份副本读——闭环持有的是可变视图，
        // 副本永远显示 open，拿它判断会重复消解（并掩盖 id 撞车）。
        const live = closure.findings.find(f => f.id === finding.id)
        if (live !== undefined && live.state === 'open' && this.options.deliveryGradeMode !== 'closed-loop') {
          // fail-soft：未返修的 finding 走**显式接受**——这是一等公民，不是失败。
          // 附注如实写明"本轮未跑返修轮次"，所以读者不会把它误读成"修过且复验通过"。
          closure.resolve(
            finding.id,
            'accepted',
            '本轮未启用闭环返修（fail-soft 档）：如实披露，不阻断交付。复验指纹未重算。',
          )
        }
      }
      if (repairedText !== current) current = repairedText
      const closureReport = closure.close()
      await this.audit({
        eventType: 'closure_closed',
        actor: 'paper-executor',
        runId,
        detail: {
          outcome: closureReport.outcome,
          findings: closureReport.findings.length,
          unresolved: closureReport.unresolved.length,
          roundsUsed: closureReport.roundsUsed,
          rechecks: closureReport.rechecks.length,
          states: Object.fromEntries(closureReport.findings.map(f => [f.category, f.state])),
        },
      })
      // 门禁状态机快照：本次运行被收紧到什么程度。
      await this.audit({
        eventType: 'gate_state_changed',
        actor: 'paper-executor',
        runId,
        detail: {
          tier: capability.tier,
          modes: gateState.snapshot().modes,
          violations: gateState.snapshot().violations,
          tightened: gateState.tightenedGates(),
        },
      })

      // ── L6 四档交付语义 ─────────────────────────────────────────────
      // 旧形态是布尔的（`gradeInput.length === 0 ? 'CLEAN' : 'BLOCKED'`，且注释
      // 明写 never MARKED），于是输出分布是双峰的：要么核验通过，要么零产物，
      // 没有"平庸但可用"这一档——而中间档恰恰是优质论文实际诞生的地方。
      const ladder = this.options.deliveryGradeMode === 'strict-tolerance'
        ? null
        : gradeLadder({
          grade: graded.grade,
          annotations: graded.annotations,
          fatal,
          closure: closureReport,
          deliveryPath,
          unverified,
          findings: closureReport.findings,
        })
      // 四档里**只有硬拒绝**不交付。`DEGRADED` 与 `ESCALATE` 都产出交付物
      // （前者是"结构完整但未规范核验"，后者是"未完成包 + 缺口清单"），
      // 因此它们对下游的 legacy grade 都表现为 MARKED——**交付，但带标注**。
      // 把它们映射成 BLOCKED 会让新阶梯退化成旧的双峰分布，而那正是本次改造
      // 要消灭的形态。
      const tier: DeliveryTier | 'STRICT' = ladder === null
        ? (gradeInput.length === 0 ? 'CLEAN' : 'ESCALATE')
        : ladder.tier
      const blocked = (ladder !== null && ladder.hardRefused) || (ladder === null && gradeInput.length > 0)
      const grade: DeliveryGrade = blocked ? 'BLOCKED' : (tier === 'CLEAN' ? 'CLEAN' : 'MARKED')
      await this.audit({
        eventType: 'delivery_graded',
        actor: 'paper-executor',
        runId,
        detail: {
          grade,
          tier,
          mode: this.options.deliveryGradeMode ?? 'fail-soft',
          headline: ladder?.headline ?? '',
          annotations: graded.annotations.length,
          fatal,
        },
      })
      if (blocked) {
        // 唯一真正的硬拒绝：连"未完成包"都产不出，或命中编造引用。
        // **ESCALATE 不在这里**——它要产出"未完成包"，不是拒绝交付。
        await this.engine.transitionRun(runId, 'failed')
        await this.audit({
          eventType: 'gate_failed',
          actor: 'paper-executor',
          runId,
          detail: {
            gate: gradeInput.length === 0 ? 'fatal-content-probe' : 'review',
            defects: outstandingList.length,
            reviews: policy.maxReviseRounds + 1,
            refusalReason: ladder?.refusalReason ?? null,
          },
        })
        throw new WorkflowExecutionError(
          'gate-failed',
          ladder?.refusalReason === null || ladder?.refusalReason === undefined
            ? `run '${runId}' blocked at delivery grade ${grade}${gradeInput.length === 0 ? ' (fatal content probe)' : ` after ${policy.maxReviseRounds + 1} reviews`}`
            : `run '${runId}' blocked at delivery grade ${grade}: ${ladder.refusalReason}`,
        )
      }

      // Authorisation is the durable proof that lets a manifest exist at all;
      // `recordManifest` refuses without it (TASK 1.25, RT125B-03).
      await this.engine.authorizeDelivery(runId, {
        authorizedAt: new Date().toISOString(),
        gates: ['review', IR_CANONICALIZATION_GATE_ID, PROVENANCE_GATE_ID],
      })

      // P0-3 (PRD v2 §3.3): a MARKED delivery ships the appendix with the
      // paper — annotations live in the appendix, never inline (design
      // point 1), and the product does not lie by omission.
      //
      // M-QUAL (W10) DP-8: boundary declarations ship UNCONDITIONALLY —
      // a CLEAN delivery carries its limits appendix too (L-2/L-3 hold in
      // any real delivery). Stores without BoundaryDeclarations render ''
      // here, so historical deliveries are byte-identical.
      const boundaryDeclarations: ReadonlyArray<BoundaryDeclaration> = this.options.ir === undefined
        ? []
        : this.options.ir.list()
          .filter(r => r.kind === 'BoundaryDeclaration')
          .map(r => r.value as BoundaryDeclaration)
      const boundaryAppendix = renderBoundaryAppendix(boundaryDeclarations)
      // ── L6 交付形态：四档语义 + 已知缺陷表 ───────────────────────────
      // 旧形态只在 MARKED 时附一段"未通过项"；现在**任何非 CLEAN 的档位**
      // 都要带两样东西：
      //   ① 顶部一句话状态（`renderTierBanner`）——一份带未消解缺陷的交付物，
      //      头部不能显示"通过"；
      //   ② 阶梯附录——MARKED/DEGRADED 带已知缺陷表，ESCALATE 带缺口清单。
      // CLEAN 时两者都为空串，因此历史 CLEAN 交付逐字节不变。
      const tierBanner = ladder === null || ladder.tier === 'CLEAN' ? '' : renderTierBanner(ladder, closureReport.findings.length)
      const ladderAppendix = ladder?.appendix ?? (grade === 'MARKED' ? renderDeliveryAppendix(grade, graded.annotations) : '')
      const deliverableText = tierBanner === '' && ladderAppendix === ''
        ? `${current}${boundaryAppendix}`
        : `${tierBanner === '' ? '' : `${tierBanner}\n\n`}${current}${boundaryAppendix}${ladderAppendix}`

      // TASK 5.0.5 / INV-014: the ONLY path to a DeliverableArtifact
      // is `promoteCandidateToDeliverable`. The executor no longer
      // writes the final output directly. The promoter (a) re-checks
      // the verdict (it must not re-evaluate the policy, just confirm
      // the precomputed `decision.allowed`), (b) calls `writeFinalOutput`
      // on success, and (c) emits the `promotion_succeeded` / `_failed`
      // audit events. `F17-a` (static check) verifies there is no other
      // write path to the final output.
      //
      // P0-3: under fail-soft the promoter is handed the graded decision —
      // MARKED promotes like an allowed verdict (the appendix already
      // carries the failures), while BLOCKED never reaches this point.
      // The strict-tolerance composition keeps the raw verdict, so its
      // fail-closed behavior is byte-identical to history.
      const promotionDecision: DeliveryDecision = grade === 'MARKED'
        ? { allowed: true, failures: [] }
        : verdict.decision
      const { artifact, createdAt } = await this.deliver(runId, deliverableText)
      const promotion = await promoteCandidateToDeliverable(
        makeCandidateArtifact({
          id: artifact.id,
          createdAt,
          contentHash: artifact.sha256,
        }),
        verdict.policy,
        promotionDecision,
        {
          audit: event => this.audit({
            eventType: promotionAuditType(event.type),
            actor: 'paper-executor',
            runId,
            detail: { ...event },
          }),
          now: () => new Date().toISOString(),
          writeFinalOutput: async (path, content) => { await this.persistFinal(runId, path, content) },
        },
        FINAL_OUTPUT_PATH,
        deliverableText,
      )
      if (!promotion.ok) {
        await this.engine.transitionRun(runId, 'failed')
        throw new WorkflowExecutionError(
          'gate-failed',
          `run '${runId}' cannot deliver: ${promotion.error.kind} (${('gateFailures' in promotion.error ? promotion.error.gateFailures.join(',') : 'from=' + (promotion.error as { from: string }).from)})`,
        )
      }
      const manifest = this.buildManifest(this.runOf(runId), artifact, gatePassed, advisoryDefects)
      await this.engine.recordManifest(runId, manifest)

      await this.engine.transitionRun(runId, 'completed')
      await this.audit({
        eventType: 'workflow_completed',
        actor: 'paper-executor',
        runId,
        detail: { gatePassed, costUsd: manifest.usage.costUsd },
      })
      return { run: this.runOf(runId), manifest }
    } catch (error: unknown) {
      if (!(error instanceof WorkflowExecutionError) || error.code === 'gate-failed') throw error
      await this.audit({
        eventType: 'workflow_failed',
        actor: 'paper-executor',
        runId,
        detail: { reason: error.code, message: error.message },
      })
      throw error
    }
  }

  /**
   * Refuse to deliver unless the canonical IR carries the mathematical facts
   * the paper claims (TASK 1.25, INV-1.25-B).
   *
   * A composition that never mounted a store is treated as an empty one: in
   * FORMAL and FAST mode that means "no canonical state", so the run is
   * blocked rather than waved through. EXPLORATORY is exempt because it is
   * the mode in which no fact has been asserted yet.
   */
  /**
   * TASK-PW W1 (W-C sign-off A): register the problem-side input assets the
   * model is never allowed to declare — the RAW_PROBLEM DataArtifact (whose
   * content_hash the harness computes over the real task text), the
   * REQUIRED_OUTPUT RequirementSpec (statement = the task as asked), and the
   * ProblemSpec binding them. The model references these ids; re-declaring
   * them is a declaration refusal (see produceContainerInto's domain rules).
   *
   * Idempotent within a store: a second execute against the same IR skips
   * registration (the assets are already there).
   *
   * @returns the reserved id set handed to the container admission so a
   *          model-declared id collision is a domain refusal.
   */
  private async registerInputAssets(
    runId: RunId,
    ir: ModelingIr,
    taskText: string,
  ): Promise<ReadonlySet<string>> {
    const RESERVED = new Set<string>(['DA-RAW', 'R-OUT', 'P1'])
    // A retry must reserve the SAME id set the first attempt registered, or the
    // admission would let the model collide with a sub-problem id it never saw.
    if (ir.get('DA-RAW') !== undefined) {
      for (const record of ir.list()) {
        if (record.kind !== 'RequirementSpec' && record.kind !== 'ProblemSpec') continue
        const value = record.value as { requirement_id?: unknown; problem_id?: unknown }
        const id = irText(value.requirement_id ?? value.problem_id)
        if (id !== '') RESERVED.add(id)
      }
      return RESERVED
    }

    // W11.5 baseline-18 (审计 A-1): the paper shows THIS text, so it must be the
    // problem statement alone — never the model-facing task (which carries the
    // method-family banner).
    const problemBytes = this.#problemStatementByRun.get(String(runId)) ?? taskText
    const problemHash = `sha256:${sha256Hex(problemBytes)}`
    const problemLocator = `file:///problems/${String(runId)}/task.md`

    const putOrThrow = (kind: 'DataArtifact' | 'RequirementSpec' | 'ProblemSpec', value: Record<string, unknown>) => {
      const verdict = ir.put(kind, value)
      if (!verdict.accepted) {
        const failure = verdict.failures[0]
        throw new Error(`input asset registration refused (${kind}): ${failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused'}`)
      }
      return value
    }

    const daRaw = putOrThrow('DataArtifact', {
      data_id: 'DA-RAW',
      role: 'RAW_PROBLEM',
      locator: problemLocator,
      content_hash: problemHash,
      media_type: 'text/markdown',
      description: problemBytes.slice(0, 512),
    })
    void daRaw
    await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'DataArtifact', id: 'DA-RAW', stage: 'input-registration' } })

    putOrThrow('RequirementSpec', {
      requirement_id: 'R-OUT',
      source_data_ref: 'DA-RAW',
      requirement_type: 'REQUIRED_OUTPUT',
      statement: problemBytes.slice(0, 2048),
    })
    await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'RequirementSpec', id: 'R-OUT', stage: 'input-registration' } })

    // W11.5 baseline-18 (审计 A-3/A-4/B-2/B-3/B-4，虎头蛇尾): a competition paper
    // asks SEVERAL sub-problems, and the seventeenth baseline answered only the
    // first — the model declared one aggregate requirement (R-OUT) and the
    // coverage gate therefore had nothing to demand. The sub-problems are read
    // out of the problem statement itself (harness-side, never model-written) and
    // each becomes its own REQUIRED_OUTPUT; `requirement_coverage` (a CRITICAL
    // gate) then requires a distinct CRITICAL result per sub-problem, and the
    // production chain refuses + guides BEFORE delivery when one is unpaid.
    const subProblems = subProblemsOf(problemBytes)
    for (const sub of subProblems) {
      RESERVED.add(sub.requirementId)
      putOrThrow('RequirementSpec', {
        requirement_id: sub.requirementId,
        source_data_ref: 'DA-RAW',
        requirement_type: 'REQUIRED_OUTPUT',
        statement: sub.statement,
      })
      await this.audit({
        eventType: 'ir_entry_written',
        actor: 'paper-executor',
        runId,
        detail: { kind: 'RequirementSpec', id: sub.requirementId, stage: 'input-registration' },
      })
    }

    // W11.5 round-7（对齐参照物）: **一个子问题一个 ProblemSpec**（P<n> ↔ 问题n），
    // 而不是把所有子问题绑成一个 P1。这是逐问章能带上"该问自己的模型与数值"的前提
    // ——model_refs/Result 的归属链是 Result.run_ref → RunArtifact.model_ref →
    // ModelSpec.problem_refs，只有一个聚合 P1 时每问都会拿到同一批模型与结果。
    // 同时它把 requirement_coverage 变成**逐问**判据：第 n 问必须有自己的 CRITICAL
    // 结果链（A7 fail-closed），正是"虎头蛇尾"要治的那件事。
    const problemSpecs = subProblems.length === 0
      ? [{ problemId: 'P1', requirementRefs: ['R-OUT'] }]
      : subProblems.map(sub => ({
        problemId: `P${sub.requirementId.replace('R-Q', '')}`,
        requirementRefs: [sub.requirementId],
      }))
    for (const spec of problemSpecs) {
      RESERVED.add(spec.problemId)
      putOrThrow('ProblemSpec', {
        problem_id: spec.problemId,
        raw_problem_ref: 'DA-RAW',
        requirement_refs: spec.requirementRefs,
      })
      await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'ProblemSpec', id: spec.problemId, stage: 'input-registration' } })
    }

    return RESERVED
  }

  /**
   * P2-1 (D7 obligation): run the FULL production chain inside the EXECUTE
   * stage when the model's container carries executable code.
   *
   * Sequence: container contract kinds are already in the store (P1-1);
   * here the code REALLY runs (produceRunExecution — the deployment-owned
   * runnerCommand is the ONLY possible command, the container may only
   * declare outputBasenames/seed), the ExecutionRecord is captured, the
   * model's dry-pass interpretation is minted against the REAL output
   * bytes (jsonPath must resolve to a finite number or the chain refuses
   * with zero partial Result writes), and the v1 template report becomes
   * the EXECUTE deliverable text.
   *
   * @returns the rendered report text plus a synchronous code loader the
   *          FORMAL delivery policy uses for S-007.
   */
  private async runProductionChain(
    runId: RunId,
    ir: ModelingIr,
    container: {
      readonly code?: string
      readonly run?: Record<string, unknown>
      readonly interpretations?: Record<string, unknown>
      readonly narrative?: Record<string, unknown>
      readonly entries: ReadonlyArray<{ kind: string; value: Record<string, unknown> }>
    },
    pendingOutputArtifacts: ReadonlyArray<{ data_id: string; locator: string }> = [],
    attempt = 1,
    /** W11.5 baseline-10: refuse a report whose chapter is still an unfilled
     *  placeholder. True on the single-shot face, where the model writes the
     *  whole container; false on the T2/T3 guided faces, whose container is
     *  assembled from tiny steps and has no prose step at all (demanding
     *  chapters there would make those faces unsatisfiable — their report is a
     *  skeleton by construction, and the docx gate says so). */
    requireProseChapters = true,
  ): Promise<
    { ok: true; reportText: string; loadCode: (ref: string) => string }
    | { ok: false; code: string; reason: string }
  > {
    const runIdText = String(runId)
    // W11.5 baseline-7 (首次真实产出实测): every id this chain mints is scoped
    // to the ATTEMPT, because a retry re-executes the code and the store is
    // append-only — one run id names one execution. Before this, a retry after
    // an attempt that got as far as running (the seventh real run's attempt 3:
    // fidelity passed, the code ran, 4 Results were minted, and the report
    // render then refused the narrative's numbers) could not even declare its
    // run: `duplicate_id: id '<runId>' is already registered as RunArtifact`.
    // Attempt 1 keeps every id exactly as before, so the normal path — and
    // every archived artifact — is byte-identical; the suffix appears only on
    // a retry, and `displayIdOf` strips it before anything reaches the paper.
    const runNs = scopeAttemptId(runIdText, attempt)
    // W11.5 baseline-19: carry every chapter this run has already written into
    // this attempt's narrative (the attempt's own text wins per key). Without
    // this, a retry that fixes one chapter drops another and the run cannot
    // converge — observed twice in the eighteenth baseline.
    const carried = this.#narrativeByRun.get(runIdText) ?? {}
    if (container.narrative !== undefined) {
      for (const [key, value] of Object.entries(container.narrative)) {
        // An empty string from this attempt must not erase a chapter an earlier
        // attempt wrote; anything else is the model's latest word for that key.
        if (typeof value === 'string' && value.trim() === '' && key in carried) continue
        carried[key] = value
      }
      this.#narrativeByRun.set(runIdText, carried)
    }
    const narrative: Record<string, unknown> = { ...carried }
    // The prose contracts are held to the run's REQUIRED_OUTPUTs (one passage
    // per question), read from the store — the same set the coverage gate uses.
    const contractRequirements: ReadonlyArray<{ requirementId: string; statement: string }> =
      [...ir.list()]
        .filter(r => r.kind === 'RequirementSpec')
        .map((r) => {
          const req = r.value as { requirement_id: string; statement: string }
          return { requirementId: req.requirement_id, statement: req.statement }
        })
    // W11.5 round-4 (审计 §2.3 治本) → round-8 归位（对齐参照物的分工）：
    //
    // 参照物的分工是——「2 问题分析」逐问写"归到哪类方法 + 为什么 + 难点"（2.1–2.4），
    // 「5 统一框架」写四问共用的口径与方程，「6/8/9/10 问题N」给该问的模型与数值。
    // 所以：
    //   · 逐问分析段（E1 的 `[[REQUIREMENT: R-Qn]]` 段）→ **问题分析章**（小节号由
    //     渲染器统一编成 2.x），模型自己写的 analysis prose 接在其后；
    //   · E1 的**统一框架段**（第一个逐问锚点之前）→ **模型章**（方法小节的开头），
    //     那才是"四问共用口径"该在的位置；
    //   · 逐问章放该问的模型/方程/结果（见 `perProblemChaptersFromIr`）。
    // 这样同一段 E1 在论文里只出现一次，而每一章都有它该有的东西。
    const e1FullText = this.#e1ByRun.get(String(runId)) ?? ''
    if (e1FullText.trim() !== '') {
      const perQuestion = perQuestionSectionsOf(e1FullText, contractRequirements)
      const modelAnalysis = typeof narrative['analysis'] === 'string' ? narrative['analysis'].trim() : ''
      if (perQuestion.length > 0) {
        narrative['analysis'] = [
          perQuestion.join(NL + NL),
          ...(modelAnalysis === '' ? [] : ['', '### 逐问归因（模型自述）', '', modelAnalysis]),
        ].join(NL)
      }
      const framework = frameworkOf(e1FullText)
      if (framework !== '') {
        const methods = typeof narrative['methods'] === 'string' ? narrative['methods'].trim() : ''
        narrative['methods'] = [framework, ...(methods === '' ? [] : ['', methods])].join(NL + NL)
      }
    }
    // W11.5 round-7（对齐参照物结构）: 参照物是**每个子问题独立成章**（「6 问题一：…」
    // 「7 问题一模型的独立校核」「8 问题二：…」）。章的正文在**渲染时**从规范 IR 装配
    // （`perProblemChaptersFromIr`）——那时该问的 Result 才存在，逐问章才能带上自己的
    // 数值表；此处不预生成，避免渲染时才发现拿不到结果。
    // 代码附录：把**真实代码**渲染进正文（参照物的附录 B/C/D 就是核心代码）。
    // 模型写的说明只作导语，代码本身由 harness 从容器里取——不增删改一字。
    const appendixCode = container.code ?? ''
    if (appendixCode.trim() !== '') {
      const note = typeof narrative['code'] === 'string' ? narrative['code'].trim() : ''
      narrative['code'] = [
        ...(note === '' ? [] : [note, '']),
        '```javascript',
        appendixCode.trim(),
        '```',
      ].join(NL)
    }
    // W11.5 baseline-19: the chapter check runs BEFORE the code, not after the
    // render. Its input is the container's narrative, so an execution buys
    // nothing for it — and in the eighteenth baseline two attempts paid a full
    // run (and its tokens) only to be refused for a chapter the harness could
    // see was missing on arrival. A cheap refusal is also a faster retry loop.
    if (requireProseChapters) {
      const emptyChapters = REQUIRED_NARRATIVE.filter((chapter) => {
        const value = narrative[chapter.id]
        return typeof value !== 'string' || value.trim() === ''
      })
      if (emptyChapters.length > 0) {
        return {
          ok: false,
          code: 'placeholder_chapter',
          reason: `the paper still lacks chapters the container must supply: ${emptyChapters.map(c => `${c.title}（narrative.${c.id}）`).join('、')} — a paper with an empty chapter cannot be exported (docx precheck: no_placeholders). Write those narrative strings in the SAME container as the code (a retry must keep the chapters it already wrote, not trade one for another)`,
        }
      }
    }
    const scope = (id: string): string => scopeAttemptId(id, attempt)
    const runDecl = container.run ?? {}
    const allowedRunKeys = new Set(['outputBasenames', 'seed'])
    for (const key of Object.keys(runDecl)) {
      if (!allowedRunKeys.has(key)) {
        return { ok: false, code: 'PRODUCE_RUN_DECLARATION_INVALID', reason: `container run block may only declare ${[...allowedRunKeys].join(', ')}; '${key}' is not deployment-negotiable (the model never chooses a runnerCommand — P2 禁4)` }
      }
    }
    const basenames = runDecl['outputBasenames']
    if (!Array.isArray(basenames) || basenames.length === 0 || basenames.some(b => typeof b !== 'string' || b.length === 0)) {
      return { ok: false, code: 'PRODUCE_RUN_DECLARATION_INVALID', reason: "container 'run.outputBasenames' must be a non-empty array of file basenames the code will write" }
    }
    const produceRun = this.options.produceRun
    if (produceRun === undefined) {
      return { ok: false, code: 'CODE_RUN_NOT_CONFIGURED', reason: 'EXECUTE code was declared but options.produceRun (deployment-owned runner) is not mounted' }
    }
    const executable = basename(String(produceRun.command[0] ?? ''))
    // A schema-coerced empty allow-list means "use the built-in defaults"
    // (an explicit empty list is not a valid policy).
    const allowSrc = produceRun.allowExecutable !== undefined && produceRun.allowExecutable.length > 0
      ? produceRun.allowExecutable
      : ['node', 'python', 'python3']
    const allow = new Set(allowSrc)
    if (!allow.has(executable)) {
      return { ok: false, code: 'CODE_RUN_NOT_CONFIGURED', reason: `deployment runner command '${produceRun.command.join(' ')}' executes '${executable}' which is outside the code-run allow-list [${[...allow].join(', ')}]` }
    }
    const modelRefEntry = [...container.entries].find(e => e.kind === 'ModelSpec')
    const modelRef = modelRefEntry === undefined
      ? undefined
      : String((modelRefEntry['value'] as { model_id?: unknown }).model_id ?? '')
    if (modelRefEntry === undefined || modelRef === undefined || modelRef.length === 0) {
      return { ok: false, code: 'PRODUCE_CHAIN_NO_MODEL', reason: 'a container with code must declare a ModelSpec with a model_id (the run is an instance of it)' }
    }
    const outputBasenames = basenames as string[]
    const outputLocators = outputBasenames.map(b => `file:///runs/${runNs}/${b}`)
    const seedRaw = runDecl['seed']
    // INV-3-D: FORMAL critical runs need a non-null seed; only a numeric
    // integer is a reproducible declaration (a string seed would be a
    // "no seed recorded" statement in disguise).
    const seed = typeof seedRaw === 'number' && Number.isInteger(seedRaw) ? seedRaw : null

    const executed = await produceRunExecution({
      ir,
      runId: runNs,
      modelRef,
      codeText: container.code ?? '',
      environment: produceRun.environment,
      seed,
      outputBasenames,
      outputLocators,
      runnerCommand: [...produceRun.command],
      runnerEntryFile: produceRun.entryFile,
      timeoutMs: produceRun.timeoutMs,
    })
    // 配置缺口（部分准入的产物）：记进审计，并在链尾进 findings。
    // 它是"符号表不全"的如实上报，不是链的失败——见 execution-producer.ts 的注释。
    const configGaps = executed.ok ? (executed.configGaps ?? []) : []
    if (configGaps.length > 0) {
      await this.audit({
        eventType: 'ir_entry_written',
        actor: 'paper-executor',
        runId,
        detail: {
          kind: 'NumericConfig',
          id: `NC-${runNs}`,
          stage: 'config-gap',
          gaps: configGaps.length,
          reason: configGaps[0],
        },
      })
    }
    if (!executed.ok) {
      return { ok: false, code: executed.code, reason: `code run refused: ${executed.reason}` }
    }
    await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'RunArtifact', id: executed.runArtifactId, nodeId: 'execute', stage: 'code-run' } })
    await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'ExecutionRecord', id: executed.executionId, nodeId: 'execute', stage: 'code-run' } })

    // TASK-PW W1 (hash backfill): the model's declared output artifacts are
    // minted HERE with the sha256 computed over the real captured bytes —
    // the model declared only { data_id, locator } and never a hash (the
    // impossible-field rule). A locator that is not one of the run's real
    // outputs refuses (locator closure: pointing semantics only).
    const outputBytes = new Map(executed.outputs.map(o => [o.locator, o.bytes]))
    for (const pending of pendingOutputArtifacts) {
      const outputLocator = `file:///runs/${runNs}/${pending.locator}`
      const bytes = outputBytes.get(outputLocator)
      if (bytes === undefined) {
        return { ok: false, code: 'OUTPUT_ARTIFACT_LOCATOR_INVALID', reason: `output artifact '${pending.data_id}' points at '${pending.locator}' which the run did not produce (declared outputs: [${outputBasenames.join(', ')}]) — a DataArtifact locator may only name a run output basename (W1 locator closure)` }
      }
      const minted = ir.put('DataArtifact', {
        data_id: scope(pending.data_id),
        role: 'RUN_OUTPUT',
        locator: outputLocator,
        content_hash: `sha256:${sha256Hex(bytes)}`,
        media_type: 'application/json',
        description: 'run-produced output artifact; hash computed by the harness over the captured bytes',
      })
      if (!minted.accepted) {
        const failure = minted.failures[0]
        return { ok: false, code: 'OUTPUT_ARTIFACT_REFUSED', reason: `output artifact '${pending.data_id}' could not be registered: ${failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused'}` }
      }
      await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'DataArtifact', id: pending.data_id, nodeId: 'execute', stage: 'hash-backfill' } })
    }

    const figureAssets: Array<{ figureId: string; data_hash: string; svg: string }> = []
    const interpretations = container.interpretations
    if (interpretations !== undefined) {
      // Interpretation sources may name the file basename; resolve them to
      // the run's canonical locators before the dry pass.
      const normalized = normalizeInterpretationLocators(
        scopeInterpretationIds(interpretations, attempt),
        outputBasenames,
        outputLocators,
      )
      if (!normalized.ok) {
        return { ok: false, code: normalized.code, reason: normalized.reason }
      }
      const minted = produceInterpretation({
        ir,
        runId: runNs,
        interpretations: normalized.value,
        outputs: executed.outputs,
      })
      if (!minted.ok) {
        return { ok: false, code: minted.code, reason: `interpretation refused: ${minted.reason}` }
      }
      for (const id of minted.resultIds) {
        await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'Result', id, nodeId: 'execute', stage: 'interpretation' } })
      }
      for (const id of minted.claimIds) {
        await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'Claim', id, nodeId: 'execute', stage: 'interpretation' } })
      }
      for (const figure of minted.figures) {
        await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'FigureSpec', id: figure.figureId, nodeId: 'execute', stage: 'interpretation' } })
        figureAssets.push(figure)
      }
    }

    // v2 template report (P2-4): result table injected from the IR, the
    // conclusion may be structured slots or guarded prose, and any minted
    // figure's REAL rendered bytes are embedded with provenance.
    const snapshot = ModelingIr.snapshot(ir)
    // W11.5 baseline-7: the report renders THIS attempt's numbers. On a retry
    // the store also holds the previous attempt's Results (append-only), and
    // rendering every Result in the store would print two rows per quantity —
    // one of them from a run the paper is no longer describing. Filtering by
    // `run_ref` also makes the narrative's `quantity_refs` resolve against
    // this attempt's values, which is the only way the verbatim check (D4) can
    // tell the model which number was wrong.
    const results: ReadonlyArray<{
      result_id: string
      name: string
      value: number
      unit: string
      uncertainty: number | null
    }> = snapshot === null
      ? []
      : [...snapshot.values()]
        .filter(r => r.kind === 'Result' && (r.value as { run_ref?: string }).run_ref === runNs)
        .map((r) => {
          const value = r.value as {
            result_id?: unknown
            name?: unknown
            value?: unknown
            unit?: unknown
            uncertainty?: unknown
          }
          return {
            result_id: displayIdOf(String(value.result_id ?? ''), attempt),
            name: String(value.name ?? ''),
            value: Number(value.value),
            unit: String(value.unit ?? ''),
            uncertainty: (value.uncertainty as number | null | undefined) ?? null,
          }
        })
    const figureDecls = (container.interpretations?.['figures'] as Array<{ figure_id: string; caption?: string; data_refs?: ReadonlyArray<string> }> | undefined) ?? []
    // W8.5 (B1): skeleton rows for the machine tables (符号说明/模型假设/
    // 问题重述) come straight from the canonical IR — the delivery text is
    // the 10-section skeleton (single renderer, no second template).
    const skeletonRows = snapshot === null
      ? undefined
      : {
        symbols: [...snapshot.values()]
          .filter(r => r.kind === 'SymbolSpec')
          .map((r) => {
            const s = r.value as { symbol_id: string; meaning: string; unit: string }
            return { id: s.symbol_id, columns: [s.symbol_id, s.meaning, s.unit] }
          }),
        assumptions: [...snapshot.values()]
          .filter(r => r.kind === 'AssumptionSpec')
          .map((r) => {
            const a = r.value as { assumption_id: string; statement: string; source_type: string; risk_level: string; testable: boolean }
            return { id: a.assumption_id, columns: [a.statement, a.source_type, a.risk_level, a.testable ? '是' : '否'] }
          }),
        requirements: [...snapshot.values()]
          .filter(r => r.kind === 'RequirementSpec')
          .map((r) => {
            const req = r.value as { requirement_id: string; statement: string; requirement_type: string }
            return {
              id: req.requirement_id,
              // W11.5 baseline-23 (审计 A-1 验收口径): the paper must not print the
              // harness's own type names — a judge reading 问题重述 should see what the
              // problem asks for, not `REQUIRED_OUTPUT`.
              //
              // round-8: 这张表是**索引**，不是题面复印件。竞赛题面的一问有几百上千字
              // （2024-B 的问题 2 含两张表），整段塞进表格单元格会变成一堵字墙，而评委
              // 本来就知道题面——「问题重述」该给的是模型自己的转述（narrative.restatement，
              // 就在这张表下面）。这里只留一问一行的短标签，全文仍在 RAW_PROBLEM 里可溯源。
              columns: [gistOf(req.statement), REQUIREMENT_TYPE_LABELS[req.requirement_type] ?? req.requirement_type],
            }
          }),
        // W11.5 baseline-20 (审计 B-2/B-3): the equations and models the container
        // declared ARE the 模型建立与求解 chapter — rendered from the IR, so the
        // chapter states the model that was actually built instead of a summary
        // sentence, and cannot be empty while the model exists.
        equations: [...snapshot.values()]
          .filter(r => r.kind === 'EquationSpec')
          .map((r) => {
            const eq = r.value as { equation_id: string; expression: string; equation_type: string; unit: string }
            return {
              id: String(eq.equation_id ?? ''),
              columns: [String(eq.equation_id ?? ''), String(eq.expression ?? ''), String(eq.equation_type ?? ''), String(eq.unit ?? '')],
            }
          }),
        models: [...snapshot.values()]
          .filter(r => r.kind === 'ModelSpec')
          .map((r) => {
            const m = r.value as {
              model_id: string
              objective: string | null
              constraints: ReadonlyArray<string> | null
              problem_refs: ReadonlyArray<string> | null
            }
            return {
              id: String(m.model_id ?? ''),
              columns: [
                String(m.model_id ?? ''),
                String(m.objective ?? '（未声明目标）'),
                (m.constraints ?? []).join('；') || '—',
                (m.problem_refs ?? []).join(', '),
              ],
            }
          }),
      }
    // W11.5 baseline-14 (首次真实产出实测): the numbers of the registered
    // problem statement are INPUT DATA, not claims — a conclusion that restates
    // the problem's own confidence level or nominal rate must not be refused as
    // an unsourced key number. Collected from the RequirementSpec statements the
    // harness registered (never from anything the model wrote).
    const givenLiterals = new Set<string>()
    if (snapshot !== null) {
      for (const record of snapshot.values()) {
        if (record.kind !== 'RequirementSpec') continue
        const statement = (record.value as { statement?: unknown }).statement
        if (typeof statement !== 'string') continue
        for (const literal of numericLiterals(statement)) givenLiterals.add(literal)
      }
    }
    // W11.5 round-7（对齐参照物结构）: 每个子问题独立成章（「问题一：…」「问题二：…」），
    // 正文来自规范 IR（该问的模型与方程）+ 该问自己的结果表；IR 里没有的那一问退回
    // E1 的分析段。装配在渲染时做，因为 Result 到这一步才齐全。
    const problemChapters = perProblemChaptersFromIr(
      snapshot,
      contractRequirements,
      results.map(r => ({ result_id: r.result_id, name: r.name, value: r.value, unit: r.unit })),
      e1FullText,
    )
    // 独立校核章（参照物「7 问题一模型的独立校核」）：内容取自 harness 交付前真正跑过
    // 的结构校核（V1–V4）+ 数值溯源事实，章末划清"自洽"与"物理正确"的边界。
    const verification = verificationChapterOf(
      snapshot === null ? [] : runVerificationV1V4(snapshot),
      results.length,
    )
    const rendered = renderReportV2({
      title: String((narrative['title'] as string | undefined) ?? 'Paper deliverable (executor production chain)'),
      givenLiterals: [...givenLiterals],
      results: results.map(r => ({
        result_id: r.result_id,
        name: r.name,
        value: r.value,
        unit: r.unit,
        uncertainty: r.uncertainty,
      })),
      narrative,
      ...(skeletonRows === undefined ? {} : { skeletonRows }),
      ...(problemChapters.length === 0 ? {} : { problemChapters }),
      ...(verification === '' ? {} : { verification }),
      // The figure's DISPLAY id is the file name the paper references, so the
      // persisted bytes and the link agree (the attempt suffix never reaches
      // the deliverable).
      figures: figureAssets.map((asset) => {
        const displayId = displayIdOf(asset.figureId, attempt)
        const decl = figureDecls.find(d => scopeAttemptId(d.figure_id, attempt) === asset.figureId)
        return {
          figureId: displayId,
          ...(decl?.caption === undefined ? {} : { caption: decl.caption }),
          svg: asset.svg,
          data_hash: asset.data_hash,
          resultRefs: (decl?.data_refs ?? []).map(ref => displayIdOf(ref, attempt)),
          rendererVersion: 'okabe-ito-v1/svg',
        }
      }),
      // R5: 数据附录 — the executed outputs the code really wrote.
      dataFiles: executed.outputs.map(o => ({
        id: basename(o.locator),
        columns: [basename(o.locator)],
      })),
    })
    if (!rendered.ok) {
      return { ok: false, code: rendered.code, reason: `report render refused: ${rendered.reason}` }
    }
    // W11.5 baseline-18 (审计 A-3/A-4/B-2/B-3/B-4，虎头蛇尾 —— 本轮最重要的一处):
    // the chain must not hand out a paper that leaves sub-problems unanswered.
    // The seventeenth baseline delivered a MARKED paper whose OWN review ledger
    // said "问题2至问题4的决策方案、指标结果和依据完全缺失" — the judgement existed
    // and was recorded, but it arrived after the production chain had closed, so
    // the model never got to act on it. `requirement_coverage` is a CRITICAL
    // delivery gate that would refuse such a paper anyway; checking it HERE, with
    // the per-sub-problem requirements registered, turns "annotated at the end"
    // into "corrected while the model can still write the missing work".
    const uncovered = requirementCoverageFindings(ModelingIr.snapshot(ir))
    if (uncovered.length > 0) {
      const named = uncovered.map(f => `${f.requirementId}（${f.reason.split(' is not covered')[0]}）`)
      return {
        ok: false,
        code: 'required_output_unpaid',
        reason: `the paper does not answer every sub-problem the statement asks: ${named.join('；')} — declare a Result AND a CRITICAL Claim over it for EACH required output (a sub-problem with no result of its own reads as unanswered to any reviewer), then re-emit the container`,
      }
    }

    // W11.5 round-4 (审计 §3.2 第 2 步): "非空" 曾是这一维唯一的门槛，而它放行了
    // 207 字的问题分析、185 字的模型评价、1 篇参考文献、利润=0 且无过程的问题。
    // 现在每章按**要素**判：逐问归因、四要素齐备、文献 ≥3 且与所用方法有关联、
    // 代码附录点名实现了哪几问。要素门槛锁的是下限（不空洞、逐问覆盖），不判
    // "写得好不好"——实质正确性仍由模型负责（W8.9-C2 保留）。
    const proseViolations = proseContractViolations(narrative, contractRequirements)
    if (proseViolations.length > 0) {
      return {
        ok: false,
        code: 'prose_contract',
        reason: `the paper's prose chapters do not meet the element contract: ${proseViolations.map(v => `${v.title}——${v.reason}`).join('；')}`,
      }
    }

    // W11.5 baseline-10 (首次 A-produce-chain 交付): a chapter the container left
    // out renders as a VISIBLE placeholder, and the docx pre-export gate refuses
    // such a paper (`no_placeholders`) — so the very next step after delivery
    // rejected the first real chain-delivered paper (its 参考文献 was empty).
    // The chain has a retry budget and the model can fill the chapter, so the
    // refusal belongs HERE, naming the empty chapters and the narrative keys
    // that fill them, instead of one step downstream where nobody can act.
    // `methods` is the model-supplied content of 模型建立与求解 — same class as
    // the prose chapters (W11.5 baseline-16: the model omitted it and the
    // chapter rendered as a placeholder, which the pre-export gate refuses).
    // curve, a decision tree, a sensitivity chart. The seventeenth baseline had
    // ZERO, and nothing asked for one: figures are declared by the container, so
    // a model that declares none simply ships none. This is the same class as the
    // empty chapter (a chapter the model did not write) and gets the same
    // treatment: refuse in the chain, name the fix, let the guided retry add it.
    // The harness renders the bytes (never the model), so the ask is "declare the
    // structure", which is cheap for the model and checkable by the harness.
    // W11.5 round-2 (审计 A-5/A-6): the V1/V2 structure checks already existed —
    // the seventeenth baseline's appendix listed 13 of their findings — but they
    // only ever ran at DELIVERY time, as annotations. An assumption no model
    // references ("assumed but never used") or a MODELING_CHOICE with no
    // justification is a CONTAINER defect: the model can fix it in the very next
    // attempt, whereas an appendix line fixes nothing. Same "judgement exists,
    // never reaches the model" shape as the placeholder and coverage holes, and
    // the same fix — check it in the chain and name the offending fields.
    const structural = snapshot === null ? [] : runVerificationV1V4(snapshot)
      .filter(f => !f.ok && (f.rule.startsWith('V1') || f.rule.startsWith('V2')))
    // Scope: the single-shot face, where the model writes the container (the
    // T2/T3 guided faces assemble theirs from tiny steps that carry no
    // assumptions — demanding fields those steps cannot express would make the
    // guided faces unsatisfiable, exactly as with the prose chapters).
    if (requireProseChapters && structural.length > 0) {
      const shown = structural.slice(0, 4).map(f => f.detail).join('；')
      const more = structural.length > 4 ? `；…(+${structural.length - 4})` : ''
      return {
        ok: false,
        code: 'assumption_structure',
        reason: `the container's assumptions do not close: ${shown}${more} — every AssumptionSpec must be REFERENCED by a ModelSpec.assumption_refs (an assumption no model uses is "assumed but never used") and must carry justification_refs (MODELING_CHOICE: what in the problem or the analysis justifies it; GIVEN: the DataArtifact it came from). Fix those fields in the container`,
      }
    }
    // W11.5 round-5 (空白/密度判据，对齐参照系统 pdf_page_density_check):
    // 渲染后的成品不允许大片空白或几乎空的章节——实质地板管模型写的散文章，
    // 这一条管**成品**（去掉表格/代码块后逐章计正文体量 + 连续空行）。
    const blankAreas = blankAreaViolations(rendered.text, contractRequirements)
    if (blankAreas.length > 0) {
      return {
        ok: false,
        code: 'blank_area',
        reason: `the rendered paper has blank areas: ${blankAreas.map(v => v.reason).join('；')}`,
      }
    }

    if (requireProseChapters && figureAssets.length === 0) {
      return {
        ok: false,
        code: 'figure_required',
        reason: 'the paper carries no figure — a submittable modelling paper shows at least one (an OC/ROC curve, a decision tree, a sensitivity or comparison chart). Declare one in the container: interpretations.figures: [{ figure_id, chart_type: "line"|"scatter"|"bar"|"table", data_refs: [Result ids], caption }] — the harness renders the SVG from the Results you declared, you never draw it yourself.',
      }
    }
    // R1①（交付面固化）: the rendered report references each figure as
    // `figures/<figureId>.svg` — an INDEPENDENT file. The reference must
    // not dangle: persist the minted SVG bytes next to the promoted final
    // output (`<finalOutputRoot>/<runId>/final/figures/<id>.svg`), under
    // the same sink contract as `persistFinal`. When no sink is mounted
    // the write is audit-recorded as a no-op, never silently dropped.
    await this.persistFigures(runId, figureAssets.map(a => ({ figureId: displayIdOf(a.figureId, attempt), svg: a.svg })))
    // W11.5 baseline-13 (首次 A-produce-chain 交付跑完交付链): the executed
    // output files ship with the paper. The report's 数据附录 names them and
    // every Result value was read out of their bytes — but the bytes lived in
    // the runner's throwaway cwd and were deleted with it, so the delivered
    // paper referenced evidence that no longer existed anywhere. Persist them
    // next to the figures under the same sink contract.
    await this.persistDataFiles(runId, executed.outputs.map(o => ({ basename: basename(o.locator), bytes: o.bytes })))

    // ── L3 符号证据通道（harness 侧驱动）──────────────────────────────
    // 从已声明的 EquationSpec 直接推出形式性质：表达式可解析、自由符号已声明、
    // lhs/rhs 与自由符号一致、单位非空。**它判不了"方程对不对"**，因此证据级别是
    // `structural_check`，论文里只能说"形式一致"。
    //
    // fail-soft：sympy 不可用 / 脚本跑不通 → 落 unverifiable 并**如实写进附录**，
    // 绝不因此拒绝交付（未执行与未通过同级，但都不拦交付——见 C3 与四档阶梯）。
    const symbolic = this.options.ir === undefined
      ? { claims: [], unverifiable: [] }
      : runEquationConsistency(
        this.options.finalOutputRoot === undefined ? process.cwd() : join(this.options.finalOutputRoot, String(runId)),
        [...this.options.ir.list()]
          .filter(r => r.kind === 'SymbolSpec')
          .map((r) => {
            const s = r.value as { symbol_id?: unknown; token?: unknown; unit?: unknown }
            return { id: String(s.symbol_id ?? ''), token: String(s.token ?? ''), unit: String(s.unit ?? '') }
          }),
        [...this.options.ir.list()]
          .filter(r => r.kind === 'EquationSpec')
          .map((r) => {
            const e = r.value as {
              equation_id?: unknown
              expression?: unknown
              lhs_symbols?: unknown
              rhs_symbols?: unknown
              unit?: unknown
            }
            return {
              id: String(e.equation_id ?? ''),
              expression: String(e.expression ?? ''),
              lhs_symbols: Array.isArray(e.lhs_symbols) ? e.lhs_symbols.map(String) : [],
              rhs_symbols: Array.isArray(e.rhs_symbols) ? e.rhs_symbols.map(String) : [],
              unit: String(e.unit ?? ''),
            }
          }),
      )
    if (symbolic.claims.length > 0) {
      await this.audit({
        eventType: 'symbolic_channel_run',
        actor: 'paper-executor',
        runId,
        detail: {
          claims: symbolic.claims.length,
          passed: symbolic.claims.filter(c => c.passed).length,
          failed: symbolic.claims.filter(c => !c.passed).map(c => c.claim_id),
          level: 'structural_check',
        },
      })
    }
    // ── L4 结构指纹：把"这次交付的模型长什么样"变成可审计的身份 ─────────
    //
    // 它让两个问题可回答：①同一次运行的不同尝试之间，模型结构**变了没有**
    // （换方法 / 增删方程 / 调假设都会改变它，而数值指纹对这三类完全无感）；
    // ②一份**已交付**的论文与它当时的声明是否一致。
    //
    // 同一口径也被 `delivery/recheck.ts` 用作建模类 finding 的复验指纹——
    // 于是"改文字冒充改建模"在结构上不可能通过复验。
    const structureFingerprint = this.options.ir === undefined
      ? null
      : structHashOf(modelStructureOf(new Map([...this.options.ir.list()].map(r => [
        String((r.value as { [k: string]: unknown })['id'] ?? Object.values(r.value)[0] ?? ''), r,
      ]))))
    if (structureFingerprint !== null) {
      await this.audit({
        eventType: 'structure_fingerprint',
        actor: 'paper-executor',
        runId,
        detail: {
          struct_hash: structureFingerprint,
          attempt,
          equations: container.entries.filter(e => e.kind === 'EquationSpec').length,
          assumptions: container.entries.filter(e => e.kind === 'AssumptionSpec').length,
        },
      })
    }
    const symbolicAppendix = renderSymbolicEvidence(symbolic.claims)
    const codeText = container.code ?? ''
    return {
      ok: true,
      reportText: symbolicAppendix.length === 0 ? rendered.text : `${rendered.text}${symbolicAppendix}`,
      loadCode: () => codeText,
    }
  }

  /**
   * W11.5 baseline-18 — the defects a MACHINE can prove, as review defects.
   *
   * Two checks, both closed over the canonical store and zero-false-positive by
   * construction:
   *   1. the delivered text's 摘要/结论 numbers must be Result values,
   *      uncertainties, or the registered problem's own numbers (审计 A-2);
   *   2. the delivered text must not contradict its own arithmetic (W11.5-A3,
   *      previously an annotation on the E1-direct path only).
   */
  private mechanicalDefects(delivered: string): ReadonlyArray<ReviewDefect> {
    const ir = this.options.ir
    const snapshot = ir === undefined ? null : ModelingIr.snapshot(ir)
    if (snapshot === null) return []
    const allowed: string[] = []
    for (const record of snapshot.values()) {
      if (record.kind === 'Result') {
        const result = record.value as { value?: unknown; uncertainty?: unknown }
        if (typeof result.value === 'number') allowed.push(String(result.value))
        if (typeof result.uncertainty === 'number') allowed.push(String(result.uncertainty))
      }
      // Problem-given constants are input data (the registered statement).
      if (record.kind === 'RequirementSpec') {
        const statement = (record.value as { statement?: unknown }).statement
        if (typeof statement === 'string') allowed.push(...numericLiterals(statement))
      }
    }
    return [
      ...deliveredNumberFindings(delivered, allowed),
      ...arithmeticFindingsOf(digitSelfContradictionFindings(delivered)),
      ...degenerateResultFindings(snapshot),
    ]
  }

  /**
   * TASK 3 repair (3.R2 / INV-3-K): the single delivery verdict of one
   * run. The policy is built from the gate registry and evaluated
   * exactly once; whatever `evaluateDelivery` returns is the only
   * thing this executor — and, through it, the promoter — reasons
   * about. No `if (gate.status === 'PASS') return` branch, and no
   * second evaluation: the promoter is handed this record so a policy
   * cannot be refreshed between the verdict and the write.
   *
   * @param runId - the run being judged.
   * @param mode - the run's execution mode.
   * @returns the policy that was evaluated together with its verdict.
   */
  /**
   * L5：本次运行跑几个评审视角。
   *
   * **成本随档位走**——这是**一个**决定，所以它写在**一个**地方：
   *
   * | run mode | 视角数 | 理由 |
   * |---|---|---|
   * | `strict` | **3** | 质量档：多视角覆盖正是这一档买到的东西。一篇稿子被"数学严格性 / 应用相关性 / 写作与呈现"三个独立上下文各审一遍，比被一个"总评审"审一遍更能发现**跨维度**的缺陷 |
   * | `fast` | 1 | 快速档：它的价值是尽快拿到一份可交的稿，把评审成本压到最低 |
   * | `exploratory` | 1 | 内部/机制验证档；需要时用 `reviewPersonas` 显式开启 |
   *
   * 三视角会让评审调用数变为三倍（一轮 3 次而不是 1 次）。**这个代价是显式的**：
   * 它由档位决定，不藏在默认值里。
   *
   * @param mode - run mode。
   */
  /**
   * 本步骤简报（{@link stepBriefing} 的薄包装）。
   *
   * 抽成一个方法而不是在各调用点直接调，是为了将来把**真实的上游状态**喂进去
   * （例如"上一次评审报了 4 条缺陷"），而不是写死一句泛泛的"上游已就绪"。
   * 现在各调用点给的就是这一步真实的目标与上游事实。
   */
  private briefingOf(
    step: BriefingStep,
    facts: { readonly target: string; readonly upstream: string; readonly done: string },
  ): string {
    return stepBriefing(step, facts)
  }

  private reviewPersonasOf(mode: RunMode): ReadonlyArray<ReviewPersona> {
    const declared = this.options.reviewPersonas
    const count = declared ?? (mode === 'strict' ? 3 : 1)
    return count === 1 ? ['mathematical-rigor'] : REVIEW_PERSONAS
  }

  private async enforceDelivery(runId: RunId, mode: string): Promise<DeliveryVerdict> {
    // TASK 5.0.11: the policy is now told the runtime guard's *actual*
    // readiness instead of assuming it. `assertRuntimeReady` at the top
    // of `execute` would already have thrown on a mismatch, so this is
    // not a second gate — it is the policy no longer claiming a check
    // it never made (INV-3-O). Compositions that mount no guard get
    // `false`, and delivery is refused.
    const policy = buildDeliveryPolicy({
      mode,
      ir: this.options.ir ?? EMPTY_IR,
      runtimeProfileValid: this.runtimeGuard.isReady(),
      // P2-1: when the EXECUTE production chain captured the actual code
      // bytes, hand them to the delivery policy so S-007 runs (synchronous
      // loader contract); otherwise the IR-only checks stay.
      ...(this.#codeLoaders.has(String(runId))
        ? { loadCode: this.#codeLoaders.get(String(runId)) ?? (() => '') }
        : {}),
    })
    const decision = evaluateDelivery(policy)
    // W8.12 — the OTHER half of the Wave-3 audit's finding, found by the first
    // E1-direct real run. `gradeDelivery`'s own unit tests feed it
    // `critical_gate` failures and assert they become MARKED annotations —
    // but this method threw BEFORE the grader ever saw them, so under
    // fail-soft a critical gate still ended the run and the E1-direct draft
    // died one step after it was built. The same class as the E1/E2 gap:
    // the judgement was written, the transfer side was never wired.
    //
    // Fix: under fail-soft the verdict is still RECORDED (one audit entry per
    // failure kind, verbatim) but delivery is no longer refused here — the
    // decision flows to `gradeDelivery`, whose CLOSED fatal list is the only
    // thing that can still BLOCK. Strict-tolerance keeps the historical
    // fail-closed behaviour byte-for-byte.
    // 非 strict 的档位（fail-soft / closed-loop）都不在这里拒绝：findings 的
    // 归宿由 L6 闭环决定，而不是由这道门直接终止产线。
    const failSoft = this.options.deliveryGradeMode !== 'strict-tolerance'
    if (decision.allowed) return { policy, decision }
    // Record one audit entry per failure kind so external auditors can
    // triage without re-running the executor.
    for (const failure of decision.failures) {
      await this.audit({
        eventType: 'gate_failed',
        actor: 'paper-executor',
        runId,
        detail: { kind: failure.kind, reason: failure.reason, mode },
      })
    }
    if (failSoft) return { policy, decision }
    await this.engine.transitionRun(runId, 'failed')
    throw new WorkflowExecutionError(
      'gate-failed',
      `run '${runId}' cannot deliver: ${decision.failures.map(f => `${f.kind}:${f.reason}`).join('; ')}`,
    )
  }

  /**
   * Deliver the final text: one delivery node plus its stored artifact.
   *
   * TASK 5.0.5: also returns the moment the artifact was produced. The
   * durable `ArtifactRecord` carries no creation time of its own (see
   * `known-risks.md`), and the promoter requires one for the
   * `CandidateArtifact` it promotes, so the executor — the only
   * component that observes the artifact's creation — stamps it here
   * rather than inventing one further down the pipeline.
   */
  private async deliver(runId: RunId, text: string): Promise<{ artifact: ArtifactRecord; createdAt: string }> {
    const node = await this.engine.addNode({ runId, type: 'deliver', title: 'deliver' })
    await this.engine.transitionNode(node.id, 'ready')
    await this.engine.transitionNode(node.id, 'running')
    const createdAt = new Date().toISOString()
    const artifact = await this.storeArtifact(runId, node.id, text)
    await this.engine.transitionNode(node.id, 'succeeded')
    return { artifact, createdAt }
  }

  /**
   * TASK 5.0.5 / INV-014: the only writer of the final output sink, and
   * it is reachable from exactly one caller — the promoter's
   * `writeFinalOutput`, which the promoter does not invoke on any
   * failure path. Handing the promoter this callback is what makes
   * "no promotion, no final output" true by construction rather than
   * by convention.
   *
   * The composition has no real sink mounted yet, so the write is
   * recorded on the audit trail instead: the path, the byte count, and
   * the content digest are the evidence a later auditor replays the
   * delivery against. This is deliberately NOT a silent no-op.
   */
  private async persistFinal(runId: RunId, path: string, content: string): Promise<void> {
    const bytes = Buffer.byteLength(content, 'utf8')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const root = this.options.finalOutputRoot
    const resolvedPath = root === undefined
      ? null
      : join(root, runId, 'final', basename(path))
    if (resolvedPath !== null) {
      try {
        await mkdir(dirname(resolvedPath), { recursive: true })
        await writeFile(resolvedPath, content, 'utf8')
      } catch (error) {
        // A failed real write is a failed promotion: the promoter's
        // contract says a DELIVERABLE artifact means the file exists.
        await this.audit({
          eventType: 'promotion_failed',
          actor: 'paper-executor',
          runId,
          detail: { kind: 'final_output_write_failed', path: resolvedPath, message: String(error) },
        })
        await this.engine.transitionRun(runId, 'failed')
        throw new WorkflowExecutionError(
          'gate-failed',
          `run '${runId}' final output write failed at ${resolvedPath}: ${String(error).split('\n')[0]}`,
        )
      }
    }
    await this.audit({
      eventType: 'final_output_written',
      actor: 'paper-executor',
      runId,
      detail: {
        path: resolvedPath ?? `${path} (no sink mounted: set finalOutputRoot)`,
        bytes,
        sha256,
      },
    })
  }

  /**
   * R1① — persist the minted figure SVGs next to the promoted final output.
   * The rendered report references `figures/<figureId>.svg`; writing those
   * bytes is what keeps the reference resolvable on disk (the R1① gate).
   * Same sink contract as `persistFinal`: no sink mounted → audit-only.
   * A write failure is a failed promotion — a DELIVERABLE artifact whose
   * figures are missing would fail the figure-link check at the shell.
   */
  private async persistFigures(
    runId: RunId,
    figures: ReadonlyArray<{ figureId: string; svg: string }>,
  ): Promise<void> {
    const root = this.options.finalOutputRoot
    if (root === undefined || figures.length === 0) {
      if (figures.length > 0 && root === undefined) {
        await this.audit({
          eventType: 'final_output_written',
          actor: 'paper-executor',
          runId,
          detail: {
            kind: 'figures_persist_skipped',
            figures: figures.length,
            reason: 'no final sink mounted (set finalOutputRoot)',
          },
        })
      }
      return
    }
    const dir = join(root, runId, 'final', 'figures')
    try {
      await mkdir(dir, { recursive: true })
      for (const figure of figures) {
        await writeFile(join(dir, `${figure.figureId}.svg`), figure.svg, 'utf8')
      }
    } catch (error) {
      await this.audit({
        eventType: 'promotion_failed',
        actor: 'paper-executor',
        runId,
        detail: { kind: 'figures_write_failed', dir, message: String(error) },
      })
      await this.engine.transitionRun(runId, 'failed')
      throw new WorkflowExecutionError(
        'gate-failed',
        `run '${runId}' figure write failed at ${dir}: ${String(error).split('\n')[0]}`,
      )
    }
    await this.audit({
      eventType: 'final_output_written',
      actor: 'paper-executor',
      runId,
      detail: { kind: 'figures_persisted', dir, figures: figures.length },
    })
  }

  /**
   * W11.5 baseline-13 — write the run's executed output files next to the
   * final output (`<finalOutputRoot>/<runId>/final/data/<basename>`).
   *
   * The same sink contract as {@link persistFigures}: with no sink mounted the
   * write is audit-recorded as a no-op, never silently dropped.
   */
  private async persistDataFiles(
    runId: RunId,
    files: ReadonlyArray<{ basename: string; bytes: string }>,
  ): Promise<void> {
    const root = this.options.finalOutputRoot
    if (root === undefined || files.length === 0) {
      if (files.length > 0 && root === undefined) {
        await this.audit({
          eventType: 'final_output_written',
          actor: 'paper-executor',
          runId,
          detail: { kind: 'data_persist_skipped', files: files.length, reason: 'no final sink mounted (set finalOutputRoot)' },
        })
      }
      return
    }
    const dir = join(root, runId, 'final', 'data')
    try {
      await mkdir(dir, { recursive: true })
      for (const file of files) {
        await writeFile(join(dir, file.basename), file.bytes, 'utf8')
      }
    } catch (error) {
      await this.audit({
        eventType: 'promotion_failed',
        actor: 'paper-executor',
        runId,
        detail: { kind: 'data_write_failed', dir, message: String(error) },
      })
      await this.engine.transitionRun(runId, 'failed')
      throw new WorkflowExecutionError(
        'gate-failed',
        `run '${runId}' data write failed at ${dir}: ${String(error).split(String.fromCharCode(10))[0]}`,
      )
    }
    await this.audit({
      eventType: 'final_output_written',
      actor: 'paper-executor',
      runId,
      detail: { kind: 'data_persisted', dir, files: files.map(f => f.basename) },
    })
  }

  /** Run one model-backed node through ready, running, and its outcome. */
  private async runNode(
    runId: RunId,
    type: NodeRecord['type'],
    title: string,
    role: PaperRole,
    sections: readonly PromptSection[],
    /** TASK-PW W1: the raw task text, threaded only for the producing
     *  EXECUTE path (the harness registers the input assets from it). */
    taskText?: string,
  ): Promise<{ nodeId: NodeRecord['id']; text: string }> {
    const mode = this.runOf(runId).mode
    const policy = resolveRunPolicy(mode)
    await this.assertBudget(runId, mode)

    const node = await this.engine.addNode({
      runId,
      type,
      title,
      role: nodeRoleOf(role),
      maxAttempts: policy.maxNodeAttempts,
      idempotent: true,
    })
    await this.engine.transitionNode(node.id, 'ready')
    const route = this.settings.snapshot()[role]
    let prompt = await this.fitPrompt(runId, node.id, role, sections)
    // TASK-PW W4: guided-retry budget spent for THIS run (NONE and DRIFT
    // each have their own counter; ESCAPE has none at all).
    //
    // W11.5 baseline-7 (首次真实产出实测): the counter is keyed by CAUSE
    // (failure code), not by run alone. The seventh real run's producing
    // EXECUTE failed the E1-fidelity rule on attempts 1-2 (same code), then on
    // attempt 3 produced a container that passed fidelity, RAN, minted 4
    // Results + 4 CRITICAL claims — and was refused at the report render
    // because its narrative stated numbers the run did not produce. A single
    // per-run counter had already been spent by the fidelity attempts, so the
    // new, different, FIXABLE cause got no guided retry at all and the run fell
    // back to the unverified path. One counter per cause gives each distinct
    // correction its own budget; the same-cause circuit breaker below still
    // stops a cause that repeats without change, and the attempt ceiling still
    // bounds the total.
    const runKey = String(runId)
    const spentOf = (map: Map<string, number>, code: string): number => map.get(`${runKey}:${code}`) ?? 0
    // W8.6-A4: same-cause circuit breaker state for THIS node. If two
    // consecutive attempts fail with the same class+code, a third retry
    // is known-ineffective (W8.5: two identical truncations, 32k tokens
    // each) — refuse it and account honestly. Cleared on any different
    // outcome so ordinary transient retries keep their budget.
    let lastFailureKey: string | null = null
    let sameCauseStreak = 0
    // W11.5 baseline-7 (首次真实产出实测): the LAST refusal is the one that
    // ended the run, and it is the only one the fallback's delivery note may
    // name. Kept outside the loop because every terminal path (breaker,
    // budget, ceiling) needs it, and the per-attempt audit events are not
    // readable from there.
    let lastFailureCode: string | null = null
    let lastFailureMessage = ''
    // W11.5 baseline-7: the producing EXECUTE node's refusals arrive in
    // STAGES — parse → schema → E1 fidelity → code run → report render — and a
    // guided retry corrects one stage at a time, so the generic three-attempt
    // ceiling cannot reach the later ones (see the budget comment above: the
    // seventh run's render refusal had no attempt left). Only this node type
    // gets the wider ceiling; every other node keeps policy.maxNodeAttempts.
    const attemptCeiling = type === 'execute' && this.options.produceFromExecute === true
      ? Math.max(policy.maxNodeAttempts, EXECUTE_PRODUCE_ATTEMPTS)
      : policy.maxNodeAttempts

    for (let attempt = 1; attempt <= attemptCeiling; attempt += 1) {
      await this.engine.transitionNode(node.id, 'running')
      await this.engine.appendPublic(runId, node.id, 'request_started', {
        provider: route.provider,
        model: route.model,
        attempt,
      })
      try {
        // TASK-PW W2/W3: on the T2/T3 producing paths the wizard owns every
        // provider call for this node — T2 walks three tiny declarations,
        // T3 is a single closed fill-in — and the harness assembles the
        // container from the admitted payloads; the one-shot EXECUTE call
        // is skipped there. On any other path the normal single call runs.
        const tier = this.tierOf(runId)
        const isGuidedTier = type === 'execute'
          && this.options.produceFromExecute === true
          && (tier === 'T2' || tier === 'T3')
        let text: string
        // 热重启：容器已播种 → 跳过 E1 与 E2 两段，直接进准入。
        // 放在分支链**最前面**：播种的意义就是不走任何声明路径。
        const seededContainer = this.#seededContainerByRun.get(String(runId))
        if (seededContainer !== undefined && type === 'execute') {
          text = seededContainer
          await this.audit({
            eventType: 'ir_entry_written',
            actor: 'paper-executor',
            runId,
            detail: {
              kind: 'ContainerSeeded',
              id: 'seeded-container',
              nodeId: node.id,
              stage: 'receive',
              chars: seededContainer.length,
              note: '热重启：容器由已检查通过的 declare 切片播种，本轮未重新声明',
            },
          })
        } else if (tier === 'T2' && type === 'execute' && this.options.produceFromExecute === true) {
          text = await this.runGuidedExecute(runId, role, taskText ?? '')
        } else if (tier === 'T3' && type === 'execute' && this.options.produceFromExecute === true) {
          const stepPrompt = templateFillPrompt(defaultTemplateCandidates())
          const { text: callText, usage } = await this.call(role, stepPrompt)
          await this.recordUsage(runId, route.provider, route.model, usage)
          const admitted = admitTemplateFill(callText)
          if (!admitted.ok) {
            const err = new Error(`T3 fill-in refused: ${admitted.reason}`)
            ;(err as { code?: string }).code = admitted.code
            // T3 refusals are ESCAPE-class (zero budget): the model has no
            // invention space on the smallest face; a number or a container
            // or a free choice is a hard refusal, never guided.
            ;(err as { w4Class?: FailureClass }).w4Class = 'ESCAPE'
            throw err
          }
          text = assembleTemplateContainer(admitted.fill, taskText ?? '')
        } else if (type === 'execute' && this.options.produceFromExecute === true && this.e1e2Enabled()) {
          // W8.9-B1 — the receive layer. E1 writes free analysis (the shape
          // run#4 proved the model is good at); E2 normalizes it in a SECOND
          // independent call (a far narrower task: input given, nothing to
          // author). The single-shot container path above is what produced
          // the main contradiction (harness judged container compliance, not
          // modeling quality); this path replaces it for producing EXECUTE.
          //
          // W8.9-B5: E1 runs AT MOST ONCE per run. A retry of this node (E2
          // drifted / refused) reuses the cached analysis — see #e1ByRun.
          const runKey = String(runId)
          // W8.10-D1 (repair, found by the second real run on the target
          // model): the input assets MUST be registered before E1 is asked to
          // analyse the problem. They used to be registered further down, so
          // `semanticContextOf()` returned nothing at E1 time, E1 was told
          // "the harness registered no requirement ids", and B4 (per-question
          // reasoning coverage) could never pass — the analysis had no id to
          // anchor to. Same class as the fidelity-gate ordering bug: the check
          // is fine, the object never arrived in the shape it needs.
          // Registration is idempotent (`if (ir.get('DA-RAW') !== undefined)
          // return RESERVED`), so the existing call site stays valid.
          if (this.options.ir !== undefined) {
            await this.registerInputAssets(runId, this.options.ir, taskText ?? '')
          }
          let e1Text = this.#e1ByRun.get(runKey)
          if (e1Text === undefined) {
            // W8.9-B1 (repair, found by the first real run): E1 must SEE the
            // problem. The first implementation called the model with the
            // bare instruction, so the analysis had no problem statement and
            // no requirement ids — the model echoed the literal placeholder
            // `[[ASSUMPTION: <short-id>]]` and could not possibly cover the
            // requirements. The prompt the node assembled (`task` + `plan` +
            // this instruction) is what carries them, so E1 gets THAT.
            //
            // W8.10-D4 (repair, found by the D3 probe): but NOT the container
            // lecture. That lecture IS the EXECUTE node's instruction section
            // whenever `produceFromExecute` is on, and it opens with "Produce
            // ONE JSON object — and nothing else. No prose". E1 was therefore
            // receiving a prompt that spent ~85% of its length (6749 of 7944
            // chars) demanding a JSON container and then, in its last 15%,
            // asking for prose and saying "Do NOT output JSON". The model
            // obeyed the majority: the probe measured anchor compliance of
            // 0 / 2 / 12 across three samples of the SAME prompt — the
            // instability is the contradiction, not the model's ability.
            // E2 is the call that needs the lecture, and it receives it
            // explicitly via `e2NormalizationPrompt(e1Text, …)`, so dropping
            // it here loses nothing and removes the conflict.
            const requiredIds = (this.semanticContextOf()?.requiredOutputs ?? []).map(o => o.requirement_id)
            // E1 要**两个**东西都不要：容器教学（D4 的教训），以及为容器而写的
            // 本步骤简报。E1 的任务是写散文分析——给它看"首键必须是版本标记"这类
            // 话，等于让两套指令打架（实测：同一 prompt 上锚点合规率在 0 / 2 / 12
            // 之间跳，不稳定的来源是矛盾本身，不是模型能力）。
            // 所以 E1 拿它**自己的**简报：锚点语法 + 逐问覆盖 + 明说此阶段不写容器。
            const e1Sections = sections.filter(s => s.text !== constitutionText() && s.name !== 'this-step')
            const e1Base = e1Sections.length === sections.length
              ? prompt
              : await this.fitPrompt(runId, node.id, role, e1Sections)
            const e1Prompt = [
              e1Base,
              e1AnalysisInstruction(requiredIds),
              this.briefingOf('analyze', {
                target: '一份自由散文的建模分析（Markdown）：逐问给出这一问要什么、用哪个方法族、为什么是它、模型是什么、必须假设什么、怎么验证',
                upstream: '题面与已注册的子问题已在上文；数字尚未产生。此阶段**不写代码、不写 JSON、不写容器**——那是下一步的事。',
                done: '每个子问题都有一段以 [[REQUIREMENT: <id>]] 行首锚点开头的推理，且每条假设都带 [[ASSUMPTION: <名字>]] 行首锚点（名字是可用 id，不是占位符）。',
              }),
            ].join(String.fromCharCode(10) + String.fromCharCode(10))
            const e1 = await this.call(role, e1Prompt)
            await this.recordUsage(runId, route.provider, route.model, e1.usage)
            // W8.11-B2: persist the analysis BEFORE anything judges it. The
            // fidelity gate below decides "this e1_span was paraphrased" — and
            // until now that verdict was unverifiable after the fact, because
            // the text it judged existed only in this process. Same digest the
            // metadata record will carry, so `getVerified` can re-check later.
            await this.persistReceiveBody(runId, node.id, 'E1Analysis', e1.text)
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: 'E1Analysis', id: 'e1', nodeId: node.id, stage: 'receive', chars: e1.text.length },
            })
            if (e1.truncated) {
              // An E1 cut mid-sentence is a TRANSPORT fact (output ceiling),
              // not a model contract violation (纪律 2).
              const err = new Error('E1 analysis hit the provider output-length ceiling mid-generation: output budget mismatch, not a model contract violation')
              ;(err as { code?: string }).code = 'EXECUTE_OUTPUT_TRUNCATED'
              throw err
            }
            e1Text = e1.text
            this.#e1ByRun.set(runKey, e1Text)
            await this.checkpointStage('analyze', runId, e1Text, {
              note: 'E1 全文已就绪——检查建模分析的推理质量与逐问覆盖',
              e1_chars: e1Text.length,
            })
          } else {
            // Visible in the audit trail: this attempt did NOT re-run E1.
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: 'E1Reused', id: 'e1', nodeId: node.id, stage: 'receive', chars: e1Text.length },
            })
          }
          // ── W12-C3：E2 必须拿到**正文契约** ────────────────────────────
          //
          // 检查点实测（`artifacts/upper-bound/2024B-hot-1/CHECKPOINT-02-declare.md`）：
          // 模型是在**这一通调用里**写 `narrative` 的——那八章**就是论文的正文**。
          // 而 E2 的 prompt 此前只有「宪法 + E1」：宪法要求"八章非空字符串"，
          // 却**没有**篇幅地板、没有"参考文献 ≥3 条且至少一条含方法关键词"、
          // 没有"评价章四要素"。那三条只写在 `paper-contract` 里，而它由
          // `produce` 步骤简报内联——那份简报**只挂在单发路径的 EXECUTE prompt 上，
          // E2 从来拿不到**。
          //
          // 后果就是历轮反复出现的 `prose_contract` 拒绝：模型写了一章 49 字的
          // "模型评价与推广"、一份没有方法关键词的参考文献表，然后被产出链拒掉。
          // **那不是模型的缺陷，是交付链路的缺陷**——要求写在 A 处、执行在 B 处。
          const proseContractBriefing = this.briefingOf('produce', {
            target: '容器的 `narrative` 八章——**这八章就是论文正文**，不是摘要也不是笔记',
            upstream: 'E1 的建模分析已在上文；代码与数字尚未产生（正文里的数字写 `{<result_id>}` 占位符）。',
            done: '八章各自达到篇幅地板、逐问点名、参考文献 ≥3 条且至少一条指向你实际用过的方法、'
              + '评价章写全四要素（优点 / 局限 / 敏感性 / 推广）。**这些是产出链会逐条机械检查的判据**。',
          })
          const baseE2Prompt = e2NormalizationPrompt(e1Text, constitutionText())
            + String.fromCharCode(10) + String.fromCharCode(10) + proseContractBriefing
            + String.fromCharCode(10) + String.fromCharCode(10) + E2_SELF_WRITTEN_CHAPTERS
          // W8.10-B1: the drift guidance. Empty on the first attempt (the
          // prompt is then byte-identical to W8.9's — the backfill is confined
          // to retries, which is also what keeps the cassette corpus valid for
          // runs that never retry).
          const guidance = e2DriftGuidance({
            priorViolations: this.#e2ViolationsByRun.get(runKey) ?? [],
            registeredIds: this.registeredIdsOf(),
          })
          const e2Prompt = e2PromptWithGuidance(baseE2Prompt, guidance)
          if (guidance.length > 0) {
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: {
                kind: 'E2DriftGuidance',
                id: 'e2-guidance',
                nodeId: node.id,
                stage: 'receive',
                applied: true,
                // B2 evidence: the shipped text has no numeric literals.
                guidance_chars: guidance.length,
              },
            })
          }
          // W12-A1 — E2 走**带自检工具**的调用。四轮实测的结论是：把判据
          // 写在 prompt 里（"提交前请自查 entries 非空、id 不重复…"）没有用
          // ——模型不会因为被要求就执行。做成工具后，判据由 harness 自己跑
          // （`checkCandidateContainer` 复用 `parseModelContainer` 等真实准入
          // 路径），模型拿到的是逐条可执行的问题，而不是一段叮嘱。
          const selfCheckTrace: SelfCheckCallInfo[] = []
          const e2 = await this.callWithSelfCheck(
            role,
            e2Prompt,
            containerText => checkCandidateContainer(containerText, {
              scopeRefs: this.problemScopesOf(),
              e1Text,
              requiredOutputIds: (this.semanticContextOf()?.requiredOutputs ?? []).map(o => o.requirement_id),
            }),
            true,
            info => selfCheckTrace.push(info),
          )
          // 到顶轮交了散文（放弃式输出）：**不静默接受**，给出精确的拒绝理由。
          // 旧行为是收下 `"I need to "...`，然后在下游变成一条 JSON 语法错误——
          // 那条错误指向的是症状（解析失败），不是病因（模型放弃了结构化输出）。
          if (e2.notStructured) {
            const err = new Error('E2 normalization produced PROSE instead of a container, even after the structured-only correction: the model abandoned structured output on its final round')
            ;(err as { code?: string }).code = 'E2_PROSE_NOT_CONTAINER'
            ;(err as { w4Class?: FailureClass }).w4Class = 'NONE'
            ;(err as { outputFingerprint?: string }).outputFingerprint = sha256Hex(e2.text)
            throw err
          }
          // 自检最后告诉它的那一条，喂给**下一次尝试**的回灌。
          //
          // 这是 strict-9 实测出来的缺口：模型把 3 次工具额度用满，然后照样提交了
          // 工具已经指出问题的容器。工具是"提交前自己跑一遍检查"，它需要能把结论
          // **带过这一轮**——否则额度用完就等于什么都没发生。
          //
          // 注意这不是把工具变成门：它仍然只影响**下一次尝试收到的提示文本**，
          // 准入判定一个字都没变。
          const lastVerdict = selfCheckTrace.at(-1)
          if (lastVerdict !== undefined && !lastVerdict.admissible) {
            const prior = this.#e2ViolationsByRun.get(runKey) ?? []
            this.#e2ViolationsByRun.set(String(runId), [...prior, {
              code: 'SELF_CHECK_REPORTED',
              // 按构造**无数字**：这条文本会被 `e2DriftGuidance` 逐行
              // `stripNumericLiterals`（E2 的零数字纪律），直接引用工具原文会被剥成
              // 乱码（`e1_span 过短（3 < 10）` → `e1_span 过短（ < ）`）。
              // 类别名不含数字，原文让模型自己再调一次工具去看。
              reason: `你自己调用的自检工具在提交前已经报出问题，但容器里它们仍在：${selfCheckCategorySentence(lastVerdict.problems)}。提交前**再调用一次** ${SELF_CHECK_TOOL_NAME}，把它报的每一条都改掉——不要再交一份工具刚说过有问题的容器。`,
            }].slice(-3))
          }
          await this.recordUsage(runId, route.provider, route.model, e2.usage)
          // 每一次**调用**都单独记一条（在崩溃点之前就写下了）。汇总那条留在
          // 返回之后——它回答"这一轮自检整体用了几次"，逐条那条回答"到底有没有
          // 调用过"，两个问题不一样，且后者在崩溃时仍然必须可答。
          for (const info of selfCheckTrace) {
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: {
                kind: 'E2SelfCheckCall',
                id: `e2-self-check-${String(info.callIndex)}`,
                nodeId: node.id,
                stage: 'receive',
                round: info.round,
                container_chars: info.containerChars,
                // 工具当时给出的结论。有了它，"工具报了但它没改"与"工具没报"
                // 才分得出来——strict-9 里这两者当时无法区分。
                admissible: info.admissible,
                problem_count: info.problems.length,
                problems: info.problems.slice(0, 3),
              },
            })
          }
          if (e2.toolCalls > 0) {
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: 'E2SelfCheck', id: 'e2-self-check', nodeId: node.id, stage: 'receive', calls: e2.toolCalls },
            })
          }
          // W8.11-B2: persist the container too. The fidelity gate judges the
          // PAIR (E1 text, container); storing only one half would leave the
          // verdict half-checkable. Note this is a per-attempt artifact — each
          // retry stores its own, so a reader can diff attempt N against N+1.
          await this.persistReceiveBody(runId, node.id, `E2Normalization-attempt${attempt}`, e2.text)
          await this.audit({
            eventType: 'ir_entry_written',
            actor: 'paper-executor',
            runId,
            detail: {
              kind: 'E2Normalization',
              id: 'e2',
              nodeId: node.id,
              stage: 'receive',
              chars: e2.text.length,
              e1_chars: e1Text.length,
            },
          })
          if (e2.truncated) {
            const err = new Error('E2 normalization hit the provider output-length ceiling mid-generation: output budget mismatch, not a model contract violation')
            ;(err as { code?: string }).code = 'EXECUTE_OUTPUT_TRUNCATED'
            throw err
          }
          text = e2.text
        } else if (type === 'execute' && this.options.produceFromExecute === true && this.shardDeclareEnabled()) {
          // W9-P2 (O-L1-03): three small declarations instead of one big
          // container — each shard is a separate provider call with its
          // own budget (P1: reasoning eats ≈14.6x the content; a ~600-char
          // shard needs ≈9k output tokens, far under the 32k default).
          // The merged result flows into the SAME producer / code-run /
          // audit path below — the merge is the only new code.
          const shardTexts: string[] = []
          for (const shard of SHARD_NAMES) {
            const { text: shardText, usage: shardUsage, truncated: shardTruncated } = await this.call(role, shardPrompt(shard))
            await this.recordUsage(runId, route.provider, route.model, shardUsage)
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: 'ShardOutput', id: shard, nodeId: node.id, stage: 'shard-declare', chars: shardText.length },
            })
            if (shardTruncated) {
              const err = new Error(`shard '${shard}' hit the provider output-length ceiling mid-generation: output budget/protocol length mismatch, not a model contract violation`)
              ;(err as { code?: string }).code = 'EXECUTE_OUTPUT_TRUNCATED'
              throw err
            }
            shardTexts.push(shardText)
          }
          const parsedShards = SHARD_NAMES.map((shard, i) => ({ shard, verdict: parseShard(shard, shardTexts[i] ?? '') }))
          const firstBad = parsedShards.find(p => !p.verdict.ok)
          if (firstBad !== undefined && !firstBad.verdict.ok) {
            // A refused shard is a model-side declaration failure: keep the
            // W4 classification (NONE/DRIFT) so guidance/retry semantics
            // are identical to the single-shot path.
            const err = new Error(`shard '${firstBad.shard}' refused: ${firstBad.verdict.reason}`)
            ;(err as { code?: string }).code = firstBad.verdict.code
            ;(err as { w4Class?: FailureClass }).w4Class = failureClassOf(firstBad.verdict.code, shardTexts[SHARD_NAMES.indexOf(firstBad.shard)] ?? '')
            ;(err as { outputFingerprint?: string }).outputFingerprint = sha256Hex(shardTexts.join('\u0000'))
            throw err
          }
          const merged = mergeShards(
            (parsedShards[0]?.verdict as { ok: true; value: Record<string, unknown> }).value,
            (parsedShards[1]?.verdict as { ok: true; value: Record<string, unknown> }).value,
            (parsedShards[2]?.verdict as { ok: true; value: Record<string, unknown> }).value,
          )
          await this.audit({
            eventType: 'ir_entry_written',
            actor: 'paper-executor',
            runId,
            detail: { kind: 'ShardMerge', id: 'merged-container', nodeId: node.id, stage: 'shard-declare', entries: (merged['entries'] as ReadonlyArray<unknown>).length },
          })
          text = JSON.stringify(merged)
        } else {
          const { text: callText, usage, truncated } = await this.call(role, prompt)
          await this.recordUsage(runId, route.provider, route.model, usage)
          // W8.6-A1: a truncated EXECUTE output is its OWN failure class.
          // Pre-W8.6 it fell into parse_failed (NONE) — the 假红: a relay
          // length ceiling recorded as a model contract violation. The
          // text is incomplete BY CONSTRUCTION; classifying it correctly
          // stops the retry-loop from burning budget on a guaranteed loss.
          if (type === 'execute' && this.options.produceFromExecute === true && truncated) {
            // W8.6-A1: truncation is a TRANSPORT-side fact (the provider's
            // length ceiling), not a model contract violation. It gets its
            // own code and its own audit event — never ESCAPE (which would
            // blame the model) and never NONE/DRIFT (which would retry into
            // a ceiling that will not move; W8.5 burned 32k tokens on
            // exactly that). w4Class stays undefined: the catch below sees
            // code EXECUTE_OUTPUT_TRUNCATED and takes the dedicated path.
            const err = new Error('EXECUTE output hit the provider output-length ceiling mid-generation (finish_reason=length): output budget/protocol length mismatch, not a model contract violation')
            ;(err as { code?: string }).code = 'EXECUTE_OUTPUT_TRUNCATED'
            throw err
          }
          text = callText
        }
        // P1-1: on the produce-from-EXECUTE path the node output must be an
        // ir-container-v1; the structured-output producer writes the model's
        // declared kinds into the canonical store. A refused container is a
        // failed attempt (retried by the loop below like any other failure);
        // once the ceiling is spent the run is BLOCKED (see the exhaust
        // branch). Every written entry is audited so the trail reconstructs
        // the run's IR evolution.
        if (type === 'execute' && this.options.produceFromExecute === true) {
          const ir = this.options.ir
          if (ir === undefined) {
            const err = new Error('produceFromExecute requires a mounted ModelingIr (options.ir)')
            ;(err as { code?: string }).code = 'IR_PRODUCER_NOT_CONFIGURED'
            throw err
          }
          // TASK-PW W1: the harness registers the problem-side input assets
          // (RAW_PROBLEM DataArtifact + RequirementSpec + ProblemSpec) BEFORE
          // the model container is applied — the model references them by id
          // and must never re-declare them (W-C input-asset domain).
          const reserved = await this.registerInputAssets(runId, ir, taskText ?? '')
          const harnessAssembled = isGuidedTier

          // W8.10-B1 (repair, found by this batch's own end-to-end test):
          // the fidelity gate MUST run BEFORE admission. It used to run
          // after `produceContainerInto`, so a fidelity-refused container had
          // ALREADY written its entries into the append-only store — and the
          // retry then hit `conflicting_id` on its own previous attempt's
          // state instead of the violation it was supposed to fix. The store
          // is append-only: admission is irreversible, so every gate that can
          // refuse must sit in front of it.
          //
          // W8.9-B3/B4 — the E1→E2 fidelity gate. Only meaningful on the
          // receive layer (there is no E1 on the other paths, so the checks
          // have nothing to anchor against and are skipped).
          //
          // 设计意图（W8.9-B3 逐字）："这是'识别优秀建模'的机械落点——
          // harness 判断不了推理好不好，但可要求形式化忠实于推理。" A
          // container that declares assumptions the analysis never made, or
          // that normalizes a sub-question the analysis never reasoned about,
          // is the failure mode this catches.
          const e1Text = this.#e1ByRun.get(String(runId))
          if (e1Text !== undefined) {
            const fidelity = this.checkFidelityOf(e1Text, text)
            for (const finding of fidelity) {
              await this.audit({
                eventType: 'ir_entry_written',
                actor: 'paper-executor',
                runId,
                detail: {
                  kind: 'FidelityFinding',
                  id: finding.rule,
                  nodeId: node.id,
                  ok: finding.ok,
                  detail: finding.detail.slice(0, 400),
                },
              })
            }
            if (!fidelityOk(fidelity) && this.fidelityEnforced()) {
              // W8.10-D1: B4 is an E1-SIDE defect ("the analysis never
              // reasoned about requirement X"). Handing it to the E2 guidance
              // would ask the normalizer to fix what the analyst omitted —
              // an instruction it cannot satisfy without inventing content
              // (which the same gate then refuses). It is reported as a
              // finding and, when it alone blocks, the run fails with that
              // reason instead of a misleading correction.
              //
              // W8.11-A1: B5 is E1-side for the same reason — E2 cannot turn a
              // placeholder (`[[ASSUMPTION: ...]]`) into a real assumption; only
              // the analyst can name it. Both rules name their side, so the
              // exclusion is derived from the rule NAME rather than a second
              // hand-kept list that could drift.
              const E1_SIDE_RULES = ['B4', 'B5']
              const e2Fixable = fidelity.filter(f => !f.ok && !E1_SIDE_RULES.some(r => f.rule.includes(r)))
              // A fidelity violation is a DRIFT: the model did produce
              // container-shaped output (so it is not NONE), and the fix is
              // to re-map the SAME analysis (so guidance helps and E1 must
              // NOT be re-run — B5). The output fingerprint is the E2 text,
              // so an identical re-emission trips the W8.6-A4 breaker.
              const failed = fidelity.filter(f => !f.ok).map(f => `${f.rule}: ${f.detail}`).join('；')
              // W8.10-B1: fidelity violations are corrections too.
              if (this.#e1ByRun.has(String(runId)) && e2Fixable.length > 0) {
                const prior = this.#e2ViolationsByRun.get(String(runId)) ?? []
                const reason = e2Fixable.map(f => `${f.rule}: ${f.detail}`).join('；')
                this.#e2ViolationsByRun.set(String(runId), [...prior, { code: 'E1_E2_FIDELITY_VIOLATION', reason }].slice(-3))
              }
              // W8.12: stash the terminal receive failure so the E1-direct
              // fallback (and the MARKED appendix) can name the real cause.
              this.#receiveFailures.set(String(runId), {
                failedRules: e2Fixable.length > 0 ? e2Fixable.map(f => f.rule) : fidelity.filter(f => !f.ok).map(f => f.rule),
                reason: failed,
              })
              const err = new Error(`EXECUTE output refused by the E1→E2 fidelity check: ${failed}`)
              ;(err as { code?: string }).code = 'E1_E2_FIDELITY_VIOLATION'
              ;(err as { w4Class?: FailureClass }).w4Class = 'DRIFT'
              ;(err as { outputFingerprint?: string }).outputFingerprint = sha256Hex(text)
              throw err
            }
            // W11.5 baseline-7 (首次真实产出实测): the fidelity findings that
            // reached the E1-direct fallback were the ones from the LAST FAILED
            // attempt, not from the attempt that actually ended the run — the
            // seventh run's attempt 3 passed every fidelity rule and then died
            // at the report render, yet the delivery note still blamed
            // `B3 正向`. A passing check clears the stash: the fallback must
            // name the cause that really stopped the run.
            this.#receiveFailures.delete(String(runId))
          }

          const verdict = produceContainerInto(ir, text, undefined, { reservedIds: reserved })
          if (verdict.ok) {
            await this.checkpointStage('declare', runId, text, {
              note: '容器已通过准入——检查它的声明是否自洽、锚点是否对得上 E1',
              container_chars: text.length,
              admitted: true,
            })
          }
          if (!verdict.ok) {
            // W8.6-D1: a bounded excerpt of the refused container lands on
            // the audit trail BEFORE the throw. Repo principle: 模型可见 ⟺
            // 已记录. Pre-W8.6, exec#2's schema_violation left NO artifact
            // — its offending field path was permanently unknowable (W8.5
            // deviation two). Head/tail excerpts + hash + the producer's
            // reason restore diagnosability without storing unbounded text.
            const excerptHead = text.slice(0, 400)
            const excerptTail = text.length > 800 ? text.slice(-400) : ''
            await this.audit({
              eventType: 'container_refused',
              actor: 'paper-executor',
              runId,
              detail: {
                nodeId: node.id,
                attempt,
                code: verdict.code,
                reason: verdict.reason.slice(0, 400),
                output_sha256: sha256Hex(text),
                excerpt_head: excerptHead,
                excerpt_tail: excerptTail,
              },
            })
            // W8.10-B1: record the violation so the NEXT E2 attempt is told
            // exactly what was refused. Only on the receive layer — on the
            // single-shot/shard paths there is no E2 to correct.
            if (this.#e1ByRun.has(String(runId))) {
              const prior = this.#e2ViolationsByRun.get(String(runId)) ?? []
              // Keep the list bounded: the most recent refusal is the one that
              // describes what to fix, and an unbounded list would grow the
              // prompt on every retry (R2 risk).
              const next = [...prior, { code: String(verdict.code), reason: verdict.reason }].slice(-3)
              this.#e2ViolationsByRun.set(String(runId), next)
            }
            // W8.12: same stash for producer refusals (schema/store), so the
            // E1-direct fallback names them too.
            this.#receiveFailures.set(String(runId), {
              failedRules: [String(verdict.code)],
              reason: verdict.reason.slice(0, 400),
            })
            const err = new Error(`EXECUTE output refused by the IR producer: ${verdict.reason}`)
            ;(err as { code?: string }).code = verdict.code
            // W8.6-A4: attach an OUTPUT fingerprint so the same-cause circuit
            // breaker can tell "deterministic repeat" (same output refused
            // the same way) from "different cause" (two different prose
            // attempts — the guided-retry design must keep those). The
            // failure message alone is NOT sufficient: parse_failed's
            // message is input-independent (W8.6 review caught this as Q6).
            ;(err as { outputFingerprint?: string }).outputFingerprint = sha256Hex(text)
            // TASK-PW W4: carry the failure class so the catch below can
            // apply class-specific budgets (ESCAPE zero / NONE+DRIFT guided).
            // On the T2/T3 paths `text` is the HARNESS-assembled container — a
            // producer refusal of it is a harness-side contract problem, not
            // a model failure, so it must not re-enter under DRIFT guidance
            // (which would loop the wizard on an un-fixable shape).
            ;(err as { w4Class?: FailureClass }).w4Class = harnessAssembled
              ? 'ESCAPE'
              : failureClassOf(verdict.code, text)
            throw err
          }
          for (const entry of verdict.entries) {
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: entry.kind, id: entry.id, nodeId: node.id },
            })
          }
          // W11.5 baseline-3: a retry re-declares the whole container; ids the
          // FIRST attempt already registered keep their first content (the
          // refused attempt is not authoritative). The skip is audited — a
          // silent supersede would hide a real content change from the trail.
          for (const entry of verdict.superseded) {
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: entry.kind, id: entry.id, nodeId: node.id, stage: 'superseded-by-first-declaration', attempt },
            })
          }
          // P2-1 (D7 obligation): when the container carries executable code
          // the EXECUTE stage runs the FULL production chain — code-run
          // (deployment-owned runnerCommand, model can never choose one),
          // capture, dry-pass interpretation, Result/Claim minting — and
          // returns the rendered v1 report as the deliverable text. This is
          // the executor-authoritative path; `demo/run-p1-demo.mjs` is no
          // longer the only way to a FORMAL delivery.
          const container = parseModelContainer(text)
          if (container.ok && (container.container.code?.length ?? 0) > 0) {
            const chain = await this.runProductionChain(
              runId, ir, container.container, verdict.pendingOutputArtifacts, attempt, !isGuidedTier,
            )
            if (chain.ok) {
              await this.checkpointStage('produce', runId, chain.reportText, {
                note: '代码已真跑、IR 已铸、正文已渲染——检查数字是否可溯源、图与表是否齐备',
                report_chars: chain.reportText.length,
              })
            }
            if (!chain.ok) {
              // W11.5 baseline-7 (首次真实产出实测): a refusal from the chain
              // (code run / interpretation / report render) is the cause that
              // ended THIS attempt, so it — not an earlier attempt's fidelity
              // findings — must be what the E1-direct fallback and the MARKED
              // appendix name.
              this.#receiveFailures.set(String(runId), {
                failedRules: [chain.code],
                reason: chain.reason,
              })
              const err = new Error(`EXECUTE production chain refused: ${chain.reason}`)
              ;(err as { code?: string }).code = chain.code
              ;(err as { w4Class?: FailureClass }).w4Class = failureClassOf(chain.code)
              // W8.6-A4 的同一条要求，此前**只做到了容器准入那一条路径上**——
              // 生产链这条漏了，于是熔断键里的指纹恒为空串，键变成与输出无关的
              // `DRIFT:prose_contract:`，第 2 次尝试必然跳闸。
              //
              // 一次真实运行实测到的代价：两次 E2 输出**并不相同**（17,715 / 17,891
              // 字节，哈希不同），却因空指纹被判成"确定性重复"，熔断器在第 2 次就
              // 把 DRIFT 预算（4 次）砍到 2 次，运行提前落到兜底路径。
              // 这正是 W8.6 注释里警告过的过触发形态（"failure message alone is NOT
              // sufficient"）——只是漏在了另一条路径上。
              ;(err as { outputFingerprint?: string }).outputFingerprint = sha256Hex(text)
              throw err
            }
            this.#codeLoaders.set(String(runId), chain.loadCode)
            // W11.5-A2: the code REALLY ran — the strongest delivery path.
            this.#deliveryPathByRun.set(String(runId), 'A-produce-chain')
            // W8.10-B1: the attempt succeeded — the corrections are spent.
            this.clearE2Violations(runId)
            await this.engine.transitionNode(node.id, 'succeeded')
            return { nodeId: node.id, text: chain.reportText }
          }
        }
        // W11.5-A2: the container was accepted but carried no executable
        // code, so no number was minted by a run — a weaker path than the
        // production chain and a different claim from it.
        //
        // `type === 'execute'` is load-bearing (caught by NR-1's first run):
        // this statement sits on the shared exit of `runNode`, which the
        // plan/review/revise nodes also take — without the guard the review
        // node overwrote the fact the fallback had just recorded, and the
        // manifest claimed a path that never happened.
        if (type === 'execute') this.#deliveryPathByRun.set(String(runId), 'A-normalized-no-code')
        await this.engine.transitionNode(node.id, 'succeeded')
        return { nodeId: node.id, text }
      } catch (error: unknown) {
        // 热重启的暂停**不是失败**：立刻重抛，不进重试分类。
        // 若让它落进下面的 DRIFT/NONE 分支，"暂停"会变成"重试七次然后降级"——
        // 与热重启的语义完全相反。
        if (error instanceof StagePauseSignal) throw error
        const failure = failureOf(error)
        const w4Class = (error as { w4Class?: FailureClass }).w4Class
        lastFailureCode = failure.code
        lastFailureMessage = failure.message

        // W8.8: a failed call's tokens are still real spend — record them
        // before classification so the P4 token gate sees every attempt
        // (V1: 3 EXECUTE calls billed but only 1 usage entry reached the
        // run record, hiding the cost of the most expensive failures).
        if (error instanceof ModelCallFailure && error.usage !== undefined) {
          await this.recordUsage(runId, route.provider, route.model, error.usage)
        }

        // W8.6-P4: a budget refusal is TERMINAL, not retryable — the run
        // is already `paused` for a human to inspect. Retrying would spend
        // more tokens against the very ceiling that just tripped. Bubble
        // it unchanged (no node transition to failed; paused is the state).
        if (failure.code === 'budget-exhausted') {
          throw error
        }
        await this.engine.transitionNode(node.id, 'failed')

        // W8.6-A1: TRUNCATED is its own failure class with zero retry and
        // no tier degradation (the ceiling does not move between attempts;
        // W8.6-A4's circuit breaker generalizes this for same-cause
        // repeats). Audit names the class so the trail says "truncated",
        // never "refused".
        if (failure.code === 'EXECUTE_OUTPUT_TRUNCATED') {
          // W11.5 baseline-r9（真实运行实测）: 截断是**传输事实**（提供方输出上限），
          // 模型这一轮写下的 E1 分析是真的、也已经落盘——fail-soft 口径下没有理由
          // 因此交付零内容。所以先走 E1 直通兜底（标注交付），兜底不适用才终结。
          // 零重试不变：天花板不会因为重试而移动。
          await this.audit({
            eventType: 'truncated',
            actor: 'paper-executor',
            runId,
            detail: { code: failure.code, role, attempt, class: 'truncated' },
          })
          const truncatedDirect = await this.e1DirectFallback(
            runId,
            node,
            `provider output ceiling hit mid-generation (attempt ${attempt}): ${failure.message.slice(0, 300)}`,
          )
          if (truncatedDirect !== null) return truncatedDirect
          await this.engine.transitionRun(runId, 'failed')
          throw new WorkflowExecutionError(
            'gate-failed',
            `node '${node.id}' TRUNCATED: ${failure.message} (zero retry — the provider ceiling will not move)`,
          )
        }

        // TASK-PW W4: on the producing EXECUTE path refusals are
        // classified, and each class has its own retry budget (W-B).
        if (type === 'execute' && this.options.produceFromExecute === true && w4Class !== undefined) {
          if (w4Class === 'ESCAPE') {
            // Zero budget, hard refusal: an escape is never retried — a
            // retry would be a second chance at the same prohibition
            // (W4 attack 1: ESCAPE 后重试 → 拒).
            await this.engine.transitionRun(runId, 'failed')
            await this.audit({
              eventType: 'escape_refused',
              actor: 'paper-executor',
              runId,
              detail: { code: failure.code, role, attempt },
            })
            throw new WorkflowExecutionError(
              'gate-failed',
              `node '${node.id}' ESCAPE refused: ${failure.code} (zero retry budget — W4)`,
            )
          }
          if (w4Class === 'NONE' || w4Class === 'DRIFT') {
            const spentMap = w4Class === 'NONE' ? this.#noneSpent : this.#driftSpent
            const spent = spentOf(spentMap, failure.code)
            if (spent >= NONE_RETRY_BUDGET) {
              // W8.12: the THIRD terminal refusal path — and the one real runs
              // actually take (W8.11's four runs all ended here with
              // `DRIFT guidance budget exhausted`, not at retry exhaustion or
              // the circuit breaker). The first E1-direct attempt was wired to
              // the other two and therefore never fired. Wired here too, BEFORE
              // the run transitions to failed.
              const direct = await this.e1DirectFallback(
                runId, node, `${w4Class} guidance budget exhausted`,
              )
              if (direct !== null) return direct
              // Budget exhausted: record the failure and (NONE only — W-B)
              // step the protocol tier down, then fail the run.
              await this.engine.transitionRun(runId, 'failed')
              if (w4Class === 'NONE') {
                const from = this.tierOf(runId)
                const to = degradeTier(from)
                this.#tierByRun.set(runKey, to)
                await this.audit({
                  eventType: 'tier_degraded',
                  actor: 'paper-executor',
                  runId,
                  detail: { from, to, class: w4Class, budget: NONE_RETRY_BUDGET },
                })
              }
              await this.audit({
                eventType: 'gate_failed',
                actor: 'paper-executor',
                runId,
                detail: { gate: 'ir_producer', reason: `${w4Class} guidance budget exhausted` },
              })
              throw new WorkflowExecutionError(
                'gate-failed',
                `node '${node.id}' exhausted ${NONE_RETRY_BUDGET} guided retries (${w4Class}): EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)`,
              )
            }
            spentMap.set(`${runKey}:${failure.code}`, spent + 1)
            // W8.6-A4 (same-cause circuit breaker): only a DETERMINISTIC
            // repeat trips it — same class, same code, AND the same OUTPUT
            // (fingerprint). Two different prose outputs (NONE) are
            // different causes: the guided-retry design exists precisely
            // to nudge alignment, and "NONE ≠ 错" keeps its budget. The
            // same output refused the same way twice means a third retry
            // cannot differ — W8.5: two retries, two identical truncations,
            // 64k tokens. (W8.6 review Q6: class+code alone over-triggers
            // because parse_failed's message is input-independent.)
            const outputFingerprint = (error as { outputFingerprint?: string }).outputFingerprint ?? ''
            const failureKey = `${w4Class}:${failure.code}:${outputFingerprint}`
            if (lastFailureKey === failureKey) {
              sameCauseStreak += 1
            } else {
              lastFailureKey = failureKey
              sameCauseStreak = 1
            }
            if (sameCauseStreak >= 2) {
              // W8.12: the fallback FIRST — a circuit-broken receive layer
              // must not discard E1's analysis either (the breaker fires
              // EARLIER than retry exhaustion, so this is the path real
              // same-cause runs actually take).
              //
              // W11.5 baseline-7: the breaker's key is class+code+fingerprint,
              // which says WHAT repeated but not WHY it was refused. The
              // underlying refusal message rides along, so the terminal note
              // stays diagnosable (the seventh real run's render refusal named
              // the Result and the value the run did not produce).
              const breakerReason = `same-cause circuit breaker: ${failureKey} repeated (attempt ${attempt}) — ${failure.message.slice(0, 300)}`
              const direct = await this.e1DirectFallback(runId, node, breakerReason)
              if (direct !== null) return direct
              await this.engine.transitionRun(runId, 'failed')
              await this.audit({
                eventType: 'gate_failed',
                actor: 'paper-executor',
                runId,
                detail: { gate: 'ir_producer', reason: breakerReason },
              })
              throw new WorkflowExecutionError(
                'gate-failed',
                `node '${node.id}' circuit-broken: ${failureKey} failed identically on consecutive attempts — a third retry is known-ineffective (W8.6-A4) — last refusal ${failure.message.slice(0, 300)}`,
              )
            }
            // Guide the next attempt: NONE shows the layer's options + the
            // minimal example; DRIFT corrects only the offending field and
            // hands back the registered id table (W4). D1: a cross-step
            // reference inconsistency gets the ledger-specific correction —
            // the refusal reason names the allowed set, echo it whole.
            // W11.5 baseline-18: the id table in the correction is the LIVE
            // registered set (DA-RAW / R-OUT / P1 / R-Q1…), not the historical
            // three — a model told "never declare these" must be told which
            // ones those are, including the per-sub-problem requirements.
            const reservedNow = [...(this.options.ir === undefined
              ? []
              : [...(ModelingIr.snapshot(this.options.ir)?.keys() ?? [])])
              .filter(id => id === 'DA-RAW' || id === 'R-OUT' || id === 'P1' || id.startsWith('R-Q'))]
            const reservedIds = reservedNow.length === 0 ? ['DA-RAW', 'R-OUT', 'P1'] : reservedNow.sort()
            const guide = w4Class === 'NONE'
              ? noneGuide(reservedIds)
              : failure.code === 'unledgered_reference'
                ? ledgerCorrection(failure.message, reservedIds)
                : driftCorrection(failure.message, reservedIds)
            // TASK-PW W2: on the T2 wizard path the correction must reach the
            // NEXT STEP prompt, not the (skipped) one-shot EXECUTE prompt —
            // stash it for runGuidedExecute to append.
            this.#guidedGuidance.set(runKey, guide)
            prompt = await this.fitPrompt(runId, node.id, role, [
              ...sections,
              { name: 'w4-guidance', text: guide, trimPriority: KEEP },
            ])
            await this.audit({
              eventType: 'provider_retry',
              actor: 'paper-executor',
              runId,
              // W11.5 baseline-4/baseline-7（首次真实产出实测）：只记 code 不记
              // reason，模型看得到拒绝、事后核不了（"模型可见 ⟺ 已记录"）。
              // reason 带失败原文——baseline-7 的第三次尝试跑通了整条生产链、
              // 铸出 4 个 Result，却在报告渲染处被拒，而审计里只剩一个通用
              // 计数，真正的原因（结论数字与运行结果不一致）永久丢失。
              detail: { code: failure.code, role, attempt, w4Class, reason: failure.message.slice(0, 400) },
            })
            await this.engine.transitionNode(node.id, 'ready')
            await delay(backoffDelayMs(attempt, this.options.backoff, failure.providerRetryAfterMs))
            continue
          }
        }

        // Everything else (RUN / TRANSPORT / non-producing nodes): the
        // existing transport semantics apply unchanged.
        const action = classifyFailure(failure.code)
        if (action === 'block' || action === 'revise') {
          await this.engine.transitionRun(runId, 'failed')
          await this.audit({
            eventType: 'provider_blocked',
            actor: 'paper-executor',
            runId,
            detail: { code: failure.code, role, action, reason: failure.message.slice(0, 400) },
          })
          throw new WorkflowExecutionError(
            'provider-blocked',
            `node '${node.id}' cannot proceed: provider reported ${failure.code}`,
          )
        }
        if (attempt === attemptCeiling) break
        await this.audit({
          eventType: 'provider_retry',
          actor: 'paper-executor',
          runId,
          // W11.5 baseline-4（首次真实产出实测）：只记 code 不记 reason，
          // 模型看得到拒绝、事后核不了（"模型可见 ⟺ 已记录"）。message 带
          // 失败原文（如 CONFIG_EMISSION_TOKEN_UNRESOLVED 具体哪个 token
          // 没解析到），下轮诊断不再靠猜。
          detail: { code: failure.code, role, attempt, reason: failure.message.slice(0, 400) },
        })
        await this.engine.transitionNode(node.id, 'ready')
        await delay(backoffDelayMs(attempt, this.options.backoff, failure.providerRetryAfterMs))
      }
    }

    // Attempts are spent and the failure was retryable. On the P1-1
    // produce-from-EXECUTE path the retries existed to let the model emit a
    // schema-valid container; once the ceiling is spent the run is BLOCKED
    // (a persistent producer refusal is not a resumable transport pause).
    // Otherwise pause for review so a resumed run continues from this node.
    if (this.options.produceFromExecute === true && type === 'execute') {
      // W8.12 — the E1 direct delivery path (Wave-3 audit §四). The container
      // production failed after every retry, but E1's analysis — which the
      // model HAS produced, and which the fidelity gate judged — is real work.
      // Throwing here discards it and the user gets zero, which is exactly
      // the gap fail-soft's MARKED grade was meant to close: its grading
      // evaluates the post-review text, so a failure at THIS node never
      // reached it. Under fail-soft, when E1 satisfies contentExists, the
      // analysis is rendered into the skeleton and the run CONTINUES — the
      // fidelity findings ride into the MARKED appendix instead of ending
      // the run. The fidelity gate itself is untouched (red line N18): it
      // still refuses containers, its findings are still recorded verbatim.
      //
      // W11.5 baseline-7 (首次真实产出实测): the reason NAMES the last refusal
      // instead of counting attempts. "refused 3 times" told a reader nothing
      // about what stopped the run — the seventh run's attempts 1-2 died on a
      // fidelity rule and attempt 3 on a conclusion number, and the count
      // erased the difference.
      const lastRefusal = lastFailureCode === null
        ? 'no refusal recorded'
        : `${lastFailureCode}: ${lastFailureMessage.slice(0, 300)}`
      const direct = await this.e1DirectFallback(
        runId, node,
        `EXECUTE output refused after ${attemptCeiling} attempt(s) — last refusal ${lastRefusal}`,
      )
      if (direct !== null) return direct
      // The node already sits in 'failed' (set by the catch path on its
      // last attempt); only the RUN transitions here.
      await this.engine.transitionRun(runId, 'failed')
      await this.audit({
        eventType: 'gate_failed',
        actor: 'paper-executor',
        runId,
        detail: { gate: 'ir_producer', reason: `EXECUTE output refused after ${attemptCeiling} attempt(s) — last refusal ${lastRefusal}` },
      })
      throw new WorkflowExecutionError(
        'gate-failed',
        `node '${node.id}' exhausted ${attemptCeiling} attempts: EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED) — last refusal ${lastRefusal}`,
      )
    }
    await this.engine.transitionNode(node.id, 'paused')
    await this.engine.transitionRun(runId, 'paused')
    throw new WorkflowExecutionError(
      'provider-unavailable',
      `node '${node.id}' exhausted ${attemptCeiling} attempts and is paused for review`,
    )
  }

  /**
   * W8.12 — the E1 direct delivery fallback, shared by BOTH terminal refusal
   * paths (the same-cause circuit breaker inside the retry loop, and the
   * post-retry exhaustion block). Returns the rendered draft when the
   * fallback applies (fail-soft + E1 present + contentExists), else null so
   * the caller keeps its historical BLOCKED behaviour.
   *
   * 提成方法而非两处内联的理由：两条路径的兜底必须**永远一致**——若只在
   * 重试耗尽处兜底，熔断器（更早触发）仍会丢掉 E1，Wave-3 审计指出的洞
   * 只修了一半。
   */
  /**
   * 写一个阶段切片；若该阶段被要求暂停，抛 {@link StagePauseSignal}。
   *
   * 未配置 `slicesRoot` 时**什么都不做**——热重启是可选工作流，不开就没有开销。
   *
   * @param stage - 阶段 id（见 `runtime/stage-checkpoint.ts` 的 STAGES）。
   * @param runId - 运行 id。
   * @param payload - 该阶段的产出（可续跑所需的全部内容）。
   * @param facts - 人读的要点（检查者据此知道该看什么）。
   */
  private async checkpointStage(
    stage: string,
    runId: RunId,
    payload: string,
    facts: Readonly<Record<string, string | number | boolean>>,
  ): Promise<void> {
    const root = this.options.slicesRoot
    if (root === undefined) return
    const existing = await listSlices(root)
    const index = existing.length + 1
    const { dir } = await writeSlice(root, {
      stage: stage as never,
      index,
      runId: String(runId),
      payload,
      facts,
    })
    await this.audit({
      eventType: 'stage_checkpoint',
      actor: 'paper-executor',
      runId,
      detail: { stage, slice: dir, index, chars: payload.length },
    })
    if (this.options.stagePause?.includes(stage) === true) {
      throw new StagePauseSignal(stage, dir)
    }
  }

  private async e1DirectFallback(
    runId: RunId,
    node: NodeRecord,
    gateReason: string,
  ): Promise<{ nodeId: NodeRecord['id']; text: string } | null> {
    if (this.options.deliveryGradeMode !== 'fail-soft') return null
    const e1Text = this.#e1ByRun.get(String(runId))
    if (e1Text === undefined || !contentExists(e1Text)) return null
    // W11.5-A2: this run's body is the E1 analysis — declare it before any
    // downstream reader can mistake it for a chain-verified delivery.
    this.#deliveryPathByRun.set(String(runId), 'B-e1-direct')
    const facts = this.#receiveFailures.get(String(runId))
    // W11.5 round-7: the fallback is assembled into the SAME reference form as
    // the produce-chain draft (framework + one chapter per sub-problem), so a
    // fail-soft delivery is not a wall of undifferentiated prose.
    const fallbackRequirements = this.options.ir === undefined
      ? []
      : [...this.options.ir.list()]
        .filter(r => r.kind === 'RequirementSpec')
        .map((r) => {
          const req = r.value as { requirement_id?: unknown; statement?: unknown }
          return { requirementId: String(req.requirement_id ?? ''), statement: String(req.statement ?? '') }
        })
        .filter(r => r.requirementId !== '')
    const draft = renderE1DirectDraft({
      e1Text,
      title: '建模分析稿（E1 直通交付）',
      failureReason: gateReason,
      failedRules: facts?.failedRules ?? [],
      gate: 'ir_producer',
      requirements: fallbackRequirements,
    })
    await this.audit({
      eventType: 'e1_direct_delivery',
      actor: 'paper-executor',
      runId,
      detail: {
        nodeId: node.id,
        gate: 'ir_producer',
        reason: gateReason,
        failedRules: facts?.failedRules ?? [],
        e1_chars: e1Text.length,
        assumptions: draft.assumptionsCount,
      },
    })
    // The node state stays 'failed' — that is the honest record (the
    // container production DID fail). The run continues anyway; the MARKED
    // appendix carries why.
    return { nodeId: node.id, text: draft.markdown }
  }

  /**
   * Fit one prompt to the role's context window. When anything is elided the
   * untrimmed prompt is stored as a run artifact and the request carries its
   * reference, so the full text stays recoverable without being resent.
   */
  private async fitPrompt(
    runId: RunId,
    nodeId: NodeRecord['id'],
    role: PaperRole,
    sections: readonly PromptSection[],
  ): Promise<string> {
    const window = await this.contextWindowFor(role)
    const budget = window === undefined
      ? Infinity
      : Math.floor(window * this.options.contextUtilization)
    const outcome = compactPrompt(sections, budget)
    if (outcome.elided.length === 0) return outcome.text
    const artifact = await this.storeArtifact(runId, nodeId, renderSections(sections))
    await this.engine.appendPublic(runId, nodeId, 'context_compacted', {
      budgetTokens: budget,
      estimatedTokens: outcome.estimatedTokens,
      elided: outcome.elided.map(entry => ({ ...entry })),
      fullPromptArtifactId: artifact.id,
    })
    return `${outcome.text}\n\n<artifact_ref kind="text" id="${artifact.id}" sha256="${artifact.sha256}" />`
  }

  /** Resolve and cache one role's context window from the adapter. */
  private async contextWindowFor(role: PaperRole): Promise<number | undefined> {
    if (this.contextWindows.has(role)) return this.contextWindows.get(role)
    const resolved = await this.provider.resolveRole(role, this.settings.snapshot())
    const window = resolved.model.context?.contextWindow
    this.contextWindows.set(role, window)
    return window
  }

  /** Refuse to start another model call once the day's ceiling is reached. */
  private async assertBudget(runId: RunId, mode: 'fast' | 'strict' | 'exploratory'): Promise<void> {
    const verdict = evaluateBudget(this.spentTodayUsd(), this.options.budget, mode)
    if (verdict.state === 'ok') return
    await this.engine.appendPublic(runId, null, 'usage', {
      budgetState: verdict.state,
      limitUsd: verdict.limitUsd,
      spentUsd: verdict.spentUsd,
    })
    if (verdict.state === 'warning') return
    await this.engine.transitionRun(runId, 'paused')
    await this.audit({
      eventType: 'budget_exceeded',
      actor: 'paper-executor',
      runId,
      detail: { limitUsd: verdict.limitUsd, spentUsd: verdict.spentUsd, mode },
    })
    throw new WorkflowExecutionError(
      'budget-exhausted',
      `run '${runId}' is paused: the daily budget of ${verdict.limitUsd} USD is spent`,
    )
  }

  /** Accumulate one call's tokens and derived cost onto the run.
   *  W8.6-P4: also enforces the per-run OUTPUT-token ceiling when
   *  configured — the count-based guard that works without pricing. */
  private async recordUsage(
    runId: RunId,
    provider: string,
    model: string,
    usage: TokenUsage | undefined,
  ): Promise<void> {
    if (usage === undefined) return
    const price = resolveModelPrice(this.options.pricing, provider, model)
    await this.engine.applyUsage(runId, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: computeCostUsd(price, usage),
    })
    const ceiling = this.options.maxOutputTokensPerRun
    if (ceiling !== undefined && ceiling > 0) {
      const spent = this.runOf(runId).usage.outputTokens
      if (spent > ceiling) {
        await this.engine.transitionRun(runId, 'paused')
        await this.audit({
          eventType: 'budget_exceeded',
          actor: 'paper-executor',
          runId,
          detail: { kind: 'output_tokens_per_run', ceiling, spent },
        })
        throw new WorkflowExecutionError(
          'budget-exhausted',
          `run '${runId}' is paused: output-token ceiling ${ceiling} exceeded (spent ${spent}) — per-run guard, pricing-independent`,
        )
      }
    }
  }

  /** Cost recorded for runs created today, the budget's spend basis. */
  private spentTodayUsd(): number {
    const today = new Date().toISOString().slice(0, 10)
    return this.engine.listRuns()
      .filter(run => run.createdAt.startsWith(today))
      .reduce((total, run) => total + run.usage.costUsd, 0)
  }

  /** One provider-neutral model call assembling the streamed text.
   *  W8.6-A1: a `max-tokens` finish means the provider cut the output at
   *  its length ceiling — the text is INCOMPLETE by construction. The
   *  caller must classify this as `truncated`, never as a model contract
   *  violation (parse_failed/schema_violation were the pre-W8.6
   *  misattribution, the "假红"). */
  /**
   * 带**一个只读自检工具**的模型调用 —— 让"提交前先检查"成为可执行的调用。
   *
   * ## 为什么不是"再写一段教学"
   *
   * 把自检写进 prompt 之后，真实运行里**仍然**出现 2 次容器结构失败与 3 次散文契约
   * 失败。结论：**模型不会因为被告知就照做。** 一段请求与一次调用是两件事。
   *
   * ## 边界（刻意收窄）
   *
   * 只有一个工具，且**只读**：`check_container` 跑的是门禁自己的判据
   * （`checkCandidateContainer` 复用 `parseModelContainer` 等），返回逐条问题。
   * 它不改任何状态、不碰文件、不执行代码——因此即使模型滥用，代价上限只是多几轮。
   *
   * ## 轮次上限与失败语义
   *
   * 最多 {@link SELF_CHECK_MAX_ROUNDS} 轮工具调用；到顶后**要求模型直接给出最终答案**
   * （把"不要再调用工具"作为最后一条消息），而不是把这一轮判失败。工具是帮忙的，
   * 不是新的门。
   *
   * @param role - 调用角色。
   * @param prompt - 首轮 prompt。
   * @param selfCheck - 自检的执行体（由调用方绑定 run 的真实上下文）。
   */
  private async callWithSelfCheck(
    role: PaperRole,
    prompt: string,
    selfCheck: (containerText: string) => SelfCheckVerdict,
    /**
     * 是否要求这一轮的回答**必须是结构化输出**（默认是）。
     *
     * 依据是 strict-12/13 的实测：模型在到顶那一轮放弃了结构化输出，交出
     * `"I need to "...` 这样的散文，而旧代码**无条件接受**它，于是整次尝试被
     * 判成 `parse_failed` 并重跑一整个节点（一次完整的 E2 调用）。
     * 到顶轮的正确答案是"再要一次结构化输出"，而不是收下一句放弃声明。
     */
    requireStructured = true,
    /**
     * 每次**调用工具**时回调一次（在跑判据之前）。
     *
     * 存在的理由是一个观测缺口：strict-8 真实运行里，工具通道刚打开就撞上端点
     * 把 `delta.content` 写成 `null`，异常穿透到调用层。因为异常发生在返回
     * **之后**的审计写入之前，事后**无法判断**模型到底有没有调用过工具——
     * "模型不爱用工具"与"工具根本没送到"分不出来。观测点必须在**崩溃点之前**。
     */
    onToolCall?: (info: SelfCheckCallInfo) => void,
  ): Promise<{ text: string; usage: TokenUsage | undefined; truncated: boolean; toolCalls: number; notStructured: boolean }> {
    const route = this.settings.snapshot()[role]
    const tools = [{
      name: SELF_CHECK_TOOL_NAME,
      description: [
        'Validate a candidate ir-container-v1 BEFORE you submit it.',
        'Returns the list of problems that would make the container refused at admission.',
        'It only checks what is checkable before your code runs (parse, entries shape, duplicate ids, per-sub-problem ModelSpec, Result locators, assumption anchors).',
        'It does NOT check numeric_config.json keys or jsonPath values — those exist only after your code runs.',
        'Call it as many times as you like before your final answer.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          container_json: { type: 'string', description: 'the full JSON container text you are about to submit' },
        },
        required: ['container_json'],
        additionalProperties: false,
      },
    }]

    // 对话累积：首轮 prompt + 每轮的 assistant 文本与工具结果。
    type Turn =
      | { readonly role: 'user'; readonly content: string }
      | { readonly role: 'assistant'; readonly content: string }
      | { readonly role: 'tool'; readonly content: string; readonly callId: string }
    const turns: Turn[] = [{ role: 'user', content: prompt }]
    let totalUsage: TokenUsage | undefined
    let truncated = false
    let toolCalls = 0
    // 到顶之后**还**要一次调用：那一次是用来收最终答案的，不再执行工具。
    // 因此循环上界是 MAX + 2（MAX 轮执行工具 + 1 轮下发"给最终答案" +
    // 1 轮收回它）。
    let askedForFinal = false
    /**
     * 工具已经判过"可准入"——接下来那一轮就是最终答案。
     *
     * ## 为什么必须在这里收口（strict-12 实测）
     *
     * 把额度从 3 提到 6 之后，模型**不是收敛，而是震荡**：
     *
     *   round 0  19,730  不可准入
     *   round 1  29,559  不可准入
     *   round 2  40,017  不可准入
     *   round 3  21,567  **可准入**   ← 已经拿到了干净容器
     *   round 4  38,835  不可准入     ← 又改坏了
     *   round 5  23,271  不可准入
     *
     * 然后它提交了一份**连 JSON 都不合法**的文本。所以"多给几轮"在这里是负收益：
     * 工具一旦批准，正确的动作是**立刻收口**，而不是让它继续编辑。
     *
     * 这不是把工具变成门：准入判定一个字都没变。它只是把"工具说可以了"当作
     * **循环的终止条件**——一个自然的目标状态，而不是新的约束。
     */
    let approved = false
    /**
     * 到顶/批准之后，若模型交回散文，只再要**一次**结构化输出。
     *
     * 只再要一次：第二次仍不给，说明它这一轮确实产不出结构化输出，此时如实交回
     * 并让调用方给出精确的拒绝理由（"到顶轮给了散文"），比无限重问或静默接受都诚实。
     */
    let structuredReasked = false
    /**
     * 工具**批准过**的那份容器文本。
     *
     * ## 为什么必须记住它（第四轮 declare 实测）
     *
     * 模型调了 3 次工具，工具在第 3 次判"可准入"（`admissible: true`），循环随即收口
     * 并要求"把那份文本**原样**给出"。**但模型交回的是一份改过的文本**——工具批准的是
     * evaluation ≥800 的容器，提交的那份是 671。
     *
     * 于是"工具批准过"变成了一种**虚假的安心**：批准针对的是 A，提交的是 B，
     * 而 B 从未被检查过。这与 round-5 修的"批准后又改"是同一形态，只是那次改在收口
     * **之前**、这次改在收口**之后**。
     *
     * 修法不是再写一句更强的措辞（"原样给出"已经写过了，模型没照做——这正是本项目
     * 反复学到的：**模型不会因为被告知就照做**），而是**在返回处验一次**：
     * 交回的文本若与批准的那份不同，批准对它**不适用**，必须重新过一遍判据。
     */
    let approvedText: string | null = null

    for (let round = 0; round < SELF_CHECK_MAX_ROUNDS + 3; round += 1) {
      const assembler = new BlockAssembler()
      // 三种轮次各自用**正确的消息类型**：工具结果走 `createToolResultMessage`
      // （role=user + source.kind=tool + toolCallId），而不是伪装成一条用户消息——
      // 后者会让模型把工具输出误读成新的用户指令。
      const messages = turns.map(turn => turn.role === 'assistant'
        ? createAssistantMessage({ content: [{ type: 'text', text: turn.content }], source: { provider: route.provider, model: route.model } })
        : turn.role === 'tool'
          ? createToolResultMessage({ callId: turn.callId as never, content: [{ type: 'text', text: turn.content }], isError: false })
          : createUserMessage({ content: [{ type: 'text', text: turn.content }], source: { kind: 'user' } }))
      for await (const chunk of this.provider.stream({
        provider: route.provider,
        model: route.model,
        system: SYSTEM_PROMPTS[role],
        messages,
        tools,
      })) {
        assembler.push(chunk)
      }
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        throw new ModelCallFailure(finish.failure, assembler.usage)
      }
      totalUsage = mergeUsage(totalUsage, assembler.usage)
      if (finish.kind === 'max-tokens') truncated = true

      const text = assembler.blocks().filter(b => b.type === 'text').map(b => b.text).join(String.fromCharCode(10))
      const calls = assembler.blocks().filter(b => b.type === 'tool-call')

      // 三种"该收下这一轮"的情形：模型没调工具、工具已批准、或已经到顶。
      // 工具是帮忙的，不是新的门——到顶不得把整次尝试判失败（那会让"模型太爱
      // 自检"变成一个比"不自检"更差的结果）。
      const shouldReturn = calls.length === 0 || approved || askedForFinal
      if (shouldReturn) {
        const structured = !requireStructured || isStructuredAnswer(text)
        // **批准只对它当时看到的那份文本成立**。交回的是另一份 → 批准作废，
        // 对新文本重跑一遍判据；不过就把问题回灌给它继续改。
        // （措辞层面的"请原样给出"已经写过且无效——判据必须落在**行为**上。）
        if (approved && approvedText !== null && text.trim() !== approvedText.trim() && structured) {
          const fresh = runSelfCheckSafely(selfCheck, text)
          onToolCall?.({
            round,
            callIndex: toolCalls + 1,
            containerChars: text.length,
            admissible: fresh.admissible,
            problems: fresh.problems,
          })
          if (!fresh.admissible) {
            approved = false
            approvedText = null
            turns.push({ role: 'assistant', content: text })
            turns.push({
              role: 'user',
              content: [
                'You changed the container AFTER the self-check approved it, so that approval does NOT apply to what you just submitted.',
                'The harness re-ran the same checks on your new text and it FAILED:',
                ...fresh.problems.slice(0, 6).map(p => `  - ${p}`),
                'Either submit the approved text verbatim, or fix these and submit the fixed text.',
              ].join(String.fromCharCode(10)),
            })
            continue
          }
        }
        if (structured || structuredReasked) {
          return { text, usage: totalUsage, truncated, toolCalls, notStructured: !structured }
        }
        // 散文（放弃式输出）：**不收**。明确回一句，再取一次。
        // strict-12/13 实测：旧代码在这里无条件收下 `"I need to "...`，
        // 于是整次尝试被判 parse_failed 并重跑一整个节点。
        structuredReasked = true
        turns.push({ role: 'assistant', content: text })
        turns.push({ role: 'user', content: STRUCTURED_ONLY_CORRECTION })
        continue
      }

      // 额度用满：明确要求给最终答案，这一轮的调用**不执行**。
      if (toolCalls >= SELF_CHECK_MAX_ROUNDS) {
        askedForFinal = true
        turns.push({ role: 'assistant', content: text })
        // 到顶时的措辞必须点明一件**实测出来的**事：自检的结论只对它当时看到的
        // 那份文本成立。strict-11 的 attempt 1 里工具第三轮判了"可准入"，而模型
        // 之后仍在改，提交的文本从未被检查过——准入侧于是以 B3 拒了它
        // （`A-INFINITE-RETURN-LOOP: e1_span 在 E1 中找不到逐字匹配`）。
        // 所以这句话不是"再想想"，而是**明确的提交纪律**。
        turns.push({ role: 'user', content: `You have used the self-check tool ${String(toolCalls)} times, which is the limit. Produce your FINAL container now. IMPORTANT: the checks you ran applied to the exact text you passed them. If you have edited the container since your last check, that verdict no longer applies and you are submitting something unverified — so submit the checked text VERBATIM, or make no further edits. Do not call ${SELF_CHECK_TOOL_NAME} again.` })
        continue
      }

      turns.push({ role: 'assistant', content: text })
      for (const call of calls) {
        toolCalls += 1
        const args = parseToolArguments(call.arguments)
        const containerText = typeof args['container_json'] === 'string' ? args['container_json'] : ''
        // 自检**不得把调用弄失败**：判据自己崩了，正确答案是"这次没帮上忙"，
        // 而不是让整次 E2 调用作废（见 `runSelfCheckSafely` 的注释）。
        const verdict = containerText.length === 0
          ? { admissible: false, problems: ['container_json 缺失或不是字符串——把完整的容器文本放进这个参数。'], summary: '参数不合法', notChecked: [] }
          : runSelfCheckSafely(selfCheck, containerText)
        // 记痕在**判据之后**：记的是"工具告诉过它什么"，而不只是"它调用过"。
        // strict-9 暴露的缺口正是这个——模型用了满 3 次工具，然后**照样**提交了
        // 带 `e1_span 过短` 的容器；而审计里只有 `calls: 3`，看不出工具当时
        // 到底报了什么问题。没有这一条，"工具报了但它没改"与"工具没报"
        // 事后分不出来。
        onToolCall?.({
          round,
          callIndex: toolCalls,
          containerChars: containerText.length,
          admissible: verdict.admissible,
          problems: verdict.problems,
        })
        if (verdict.admissible) {
          approved = true
          approvedText = containerText
        }
        turns.push({
          role: 'tool',
          callId: String(call.id),
          content: [
            verdict.summary,
            ...verdict.problems.map(p => `  - ${p}`),
            ...(verdict.notChecked.length === 0 ? [] : ['（本工具判不了的：', ...verdict.notChecked.map(n => `  · ${n}`), '）']),
          ].join(String.fromCharCode(10)),
        })
      }

      // 工具批准了某一份文本 → **立刻收口**：要求模型把那份文本原样作为最终答案
      // 给出，然后下一轮直接取走（见上面 `approved` 的分支）。不再执行任何工具，
      // 也不给它继续编辑的机会——strict-12 证明了继续编辑只会改坏。
      if (approved) {
        turns.push({ role: 'assistant', content: text })
        turns.push({ role: 'user', content: `The self-check tool reported that the container you just passed it is ADMISSIBLE. Output that exact container text now as your final answer, byte for byte, with no edits. Do not call ${SELF_CHECK_TOOL_NAME} again.` })
        continue
      }
    }
    // 不可达：`askedForFinal` 最迟在第 MAX 轮被置位，下一轮必然 return。
    // 留一个**有文本的**兜底而不是抛错——抛错会把一次本可交付的尝试零掉。
    return { text: '', usage: totalUsage, truncated, toolCalls, notStructured: true }
  }

  private async call(role: PaperRole, prompt: string): Promise<{ text: string; usage: TokenUsage | undefined; truncated: boolean }> {
    const route = this.settings.snapshot()[role]
    const assembler = new BlockAssembler()
    for await (const chunk of this.provider.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPTS[role],
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })],
    })) {
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new ModelCallFailure(finish.failure, assembler.usage)
    }
    return {
      text: assembler.blocks()
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n'),
      usage: assembler.usage,
      truncated: finish.kind === 'max-tokens',
    }
  }

  /**
   * W8.11-B2 — persist one receive-layer text as an artifact body.
   *
   * 与 `storeArtifact` 分开的理由：那条路径会写一条 `ArtifactRecord`，而
   * `ArtifactRecord.nodeId` 指向一个 **node**——接收层的 E1/E2 文本没有自己的
   * 节点（它们跑在 EXECUTE 节点内），硬塞一条记录会让"artifact 属于哪个节点"
   * 的语义变糊。这里只存**正文**，键是 `label`，与元数据解耦。
   *
   * **不得进节点输出**（红线 N17）：本方法只写 artifact body 域，不碰
   * `node`/`event`/`prompt` 任何模型可见通道。
   *
   * @param runId - owning run.
   * @param nodeId - the EXECUTE node the receive layer runs inside (for the label).
   * @param label - stable name (`E1Analysis`, `E2Normalization-attempt2`, …).
   * @param text - the body.
   */
  private async persistReceiveBody(
    runId: RunId,
    nodeId: NodeRecord['id'],
    label: string,
    text: string,
  ): Promise<void> {
    const sink = this.options.artifactBodies
    if (sink === undefined) return
    const digest = createHash('sha256').update(text).digest('hex')
    await sink.put({ artifactId: `${String(nodeId)}:${label}`, runId: String(runId), sha256: digest, text })
  }

  private async storeArtifact(runId: RunId, nodeId: NodeRecord['id'], text: string): Promise<ArtifactRecord> {
    const digest = createHash('sha256').update(text).digest('hex')
    const record: ArtifactRecord = {
      id: newArtifactId(),
      runId,
      nodeId,
      kind: 'text',
      mime: 'text/plain',
      size: Buffer.byteLength(text, 'utf8'),
      sha256: digest,
      storageKey: `inline:${digest}`,
    }
    await this.engine.putArtifact(record)
    // W8.11-B2: the metadata record above has always pointed at a body store
    // that was never built (`spec.ts`: "content is stored separately by a
    // later provider"). Until now the body existed only in memory, so a
    // judgement recorded on the audit trail — "this e1_span was paraphrased" —
    // could not be re-checked against the text it judged. Persisting here, at
    // the ONE choke point every artifact flows through, covers E1/E2 and the
    // deliverable alike without adding a second call site to keep in sync.
    //
    // 红线 N17: this is the artifact store, NOT the node output. Putting the
    // text on the EXECUTE node's output is what broke every TASK-E cassette in
    // W8.9-C2 (the node output is also the reviewer's input, so the request
    // fingerprint moved). Nothing here is model-visible.
    await this.options.artifactBodies?.put({ artifactId: String(record.id), runId: String(runId), sha256: digest, text })
    return record
  }

  private buildManifest(
    run: RunRecord,
    artifact: ArtifactRecord,
    gatePassed: boolean,
    advisoryDefects: ReadonlyArray<ReviewDefect> = [],
  ): Manifest {
    return {
      schemaVersion: 1,
      runId: run.id,
      harnessVersion: run.harnessVersion,
      mode: run.mode,
      // 5.0-R (R1-4): an EXPLORATORY deliverable is informal — it must
      // never be consumed as a formal result.
      informal: run.mode === 'exploratory',
      // W11.5-A2: the recorded exit — never inferred from prose or audit.
      // Default 'A-normalized-no-code' is the only exit that needs no
      // dedicated set-site (it is what a container without code produces).
      delivery_path: this.#deliveryPathByRun.get(String(run.id)) ?? 'A-normalized-no-code',
      finalArtifactId: artifact.id,
      gates: { review: gatePassed },
      // E4c: fast deliveries with advisory MINOR defects record them so the
      // manifest never hides a review finding (exactOptionalPropertyTypes:
      // omit rather than pass an explicit empty array).
      ...(advisoryDefects.length === 0
        ? {}
        : { advisory_defects: advisoryDefects.map(d => ({ id: d.id, severity: d.severity, description: d.description })) }),
      usage: run.usage,
      redacted: true,
    }
  }

  /**
   * P3-1 (E5): the canonical context the reviewer may see and cite — result
   * rows, REQUIRED_OUTPUTs and claim summaries, derived from the store and
   * nothing else. `undefined` when no store is mounted: semantic findings
   * then cannot be verified and are discarded rather than trusted.
   */
  /**
   * W8.9-B3/B4: run the two-way fidelity check for one E2 container.
   *
   * The container text is re-parsed here (the producer already validated it)
   * rather than threading the producer's entries through — the fidelity
   * check must judge what the MODEL wrote, not what the producer normalized
   * it into. A parse failure yields no findings (the producer's own refusal
   * already handled that case upstream).
   *
   * @param e1Text - E1's full analysis.
   * @param containerText - E2's container JSON.
   */
  private checkFidelityOf(e1Text: string, containerText: string): ReadonlyArray<FidelityFinding> {
    const container = parseModelContainer(containerText)
    if (!container.ok) return []
    const entries: DeclaredEntry[] = container.container.entries.map(e => ({
      kind: e.kind,
      value: e.value as Readonly<Record<string, unknown>>,
    }))
    const requiredOutputIds = (this.semanticContextOf()?.requiredOutputs ?? []).map(o => o.requirement_id)
    return checkE1E2Fidelity({ e1Text, entries, requiredOutputIds })
  }

  private semanticContextOf(): SemanticContext | undefined {    const ir = this.options.ir
    if (ir === undefined) return undefined
    const snapshot = ModelingIr.snapshot(ir)
    if (snapshot === null) return undefined
    const results: Array<{ result_id: string; name: string; value: number; unit: string; uncertainty: number | null }> = []
    const requiredOutputs: Array<{ requirement_id: string; statement: string }> = []
    const claims: Array<{ claim_id: string; criticality: string; result_refs: ReadonlyArray<string> }> = []
    for (const record of snapshot.values()) {
      if (record.kind === 'Result') {
        const result = record.value as {
          result_id: string
          name: string
          value: number
          unit: string
          uncertainty: number | null
        }
        results.push({
          result_id: result.result_id,
          name: result.name,
          value: result.value,
          unit: result.unit,
          uncertainty: result.uncertainty,
        })
        continue
      }
      if (record.kind === 'RequirementSpec') {
        const requirement = record.value as { requirement_id: string; requirement_type: string; statement: string }
        if (requirement.requirement_type === 'REQUIRED_OUTPUT') {
          requiredOutputs.push({ requirement_id: requirement.requirement_id, statement: requirement.statement })
        }
        continue
      }
      if (record.kind === 'Claim') {
        const claim = record.value as { claim_id: string; criticality: string; result_refs?: ReadonlyArray<string> }
        claims.push({ claim_id: claim.claim_id, criticality: claim.criticality, result_refs: claim.result_refs ?? [] })
      }
    }
    return { results, requiredOutputs, claims }
  }

  /** Resolve one run or fail loud; the executor never operates on a vanished run. */
  private runOf(runId: RunId): RunRecord {
    const run = this.engine.getRun(runId)
    if (run === undefined) throw new Error(`run '${runId}' was not found`)
    return run
  }

  private async audit(entry: AuditEntryInput): Promise<void> {
    await this.options.audit?.record(entry)
  }
}

/**
 * Resolve interpretation `source.locator`s that name a file basename to the
 * run's canonical locators before the interpretation dry pass. A basename
 * that is not one of the run's declared outputs is a refusal — the model
 * can only read what the code actually produced.
 */
export function normalizeInterpretationLocators(
  block: Record<string, unknown>,
  basenames: ReadonlyArray<string>,
  locators: ReadonlyArray<string>,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; reason: string } {
  const copy = structuredClone(block) as { results?: Array<{ source?: { locator?: unknown } }> }
  const results = copy.results
  if (!Array.isArray(results)) return { ok: true, value: copy as Record<string, unknown> }
  for (const result of results) {
    const source = result.source
    const loc = source?.locator
    if (typeof loc !== 'string' || loc.startsWith('file://')) continue
    const index = basenames.indexOf(loc)
    if (index < 0) {
      return { ok: false, code: 'INTERPRETATION_SOURCE_INVALID', reason: `result reads '${loc}' which is not one of the run's declared outputs [${basenames.join(', ')}]` }
    }
    // `source` is non-null here (loc came from `source?.locator` as a string),
    // but the assignment target must be narrowed explicitly — this suite's
    // lint forbids non-null assertions in src.
    if (source !== undefined && locators[index] !== undefined) {
      source.locator = locators[index]
    }
  }
  return { ok: true, value: copy as Record<string, unknown> }
}

/**
 * 把一条评审缺陷映射到**门禁 id**（状态机的键）。
 *
 * 映射是**保守**的：认不出来就返回 null，不进状态机。理由与门禁登记表一致——
 * 一个"猜出来的"门禁 id 会污染违规计数，让档位反馈建立在不存在的维度上。
 *
 * @param defect - 评审缺陷。
 */
function gateIdOfDefect(defect: ReviewDefect): string | null {
  const text = defect.description.toLowerCase()
  if (defect.id.startsWith('RES-') || text.includes('numeric') || text.includes('数字')) return 'numeric_consistency'
  if (text.includes('figure') || text.includes('图')) return 'figure_required'
  if (text.includes('assumption') || text.includes('假设')) return 'assumption_structure'
  if (text.includes('blank') || text.includes('空')) return 'blank_area'
  if (text.includes('reference') || text.includes('文献') || text.includes('引用')) return 'reference_validation'
  if (text.includes('prose') || text.includes('chapter') || text.includes('章节') || text.includes('篇幅')) return 'prose_contract'
  if (text.includes('config') || text.includes('dt') || text.includes('配置')) return 'config_consistency'
  if (text.includes('stale') || text.includes('陈旧')) return 'stale_detection'
  return null
}

/**
 * 自检工具允许的**最多轮次**。
 *
 * 到顶后要求模型直接给最终答案，而不是把这一轮判失败——工具是帮忙的，不是新的门。
 * 3 轮的理由：一次修完（第 1 轮）＋一次确认（第 2 轮）已经足够，第 3 轮是给
 * "改一处又碰坏另一处"的余地；再多就说明模型在打转，那时该让它交卷。
 */
/**
 * 自检工具的轮次上限。
 *
 * **从 3 提到 6，依据是实测**（strict-11 attempt 1 的逐次调用）：
 *
 *   round 0  21,321 字  不可准入（0 个问题？—— 见下）
 *   round 1  34,984 字  不可准入（3 个问题）
 *   round 2  41,685 字  **可准入**
 *
 * 模型是在**用工具迭代**：每一轮都把它报的问题改掉，第三轮拿到了干净容器。
 * 3 轮的额度刚好够它**走到干净**，却不够它**再确认一次**——而它在拿到干净结论
 * 之后还继续改（见下一条注释），于是提交的文本从未被检查过。
 *
 * 上限的作用是防死循环，不是省轮次；6 轮在成本上仍可接受（每次调用都带完整
 * 对话重发，这是已知代价）。
 */
export const SELF_CHECK_MAX_ROUNDS = 6

/**
 * 停在检查点。
 *
 * 它**不是失败**：节点状态不判 failed，重试预算不消耗。若把它当普通错误，
 * 它会被 catch 当成可重试拒绝——于是"暂停"变成"重试七次然后降级"，
 * 与热重启的语义完全相反。
 */
export class StagePauseSignal extends Error {
  constructor(
    readonly stage: string,
    readonly sliceDir: string,
  ) {
    super(`paused at stage '${stage}' (checkpoint written to ${sliceDir})`)
    this.name = 'StagePauseSignal'
  }
}

/**
 * 一次自检**调用**的记录（在跑判据之后、返回之前产生）。
 *
 * 它同时是审计的载荷：`admissible` 与 `problems` 让事后能分辨"工具报了但它没改"
 * 与"工具根本没报"——strict-8 那次崩溃之后这两者无法区分，正是因为审计里只有
 * 一个调用计数。
 */
/**
 * 一段回答是否**结构化**（至少含一个 JSON 对象）。
 *
 * 判据故意宽松到"有没有 JSON 对象"这一层：精确的 schema 判定由下游的
 * `parseModelContainer` 负责，这里要拦的是**散文**——模型在到顶那一轮放弃结构化
 * 输出时交回的是 `"I need to ..."` 这类句子，里面连一个 `{` 都没有。
 *
 * 宽松是有意的：若在这里做严格判定，一个"JSON 但 schema 差一点"的回答会被当成
 * 散文重问，而它本该走正常的 DRIFT 回灌（那条路会告诉模型具体错在哪）。
 *
 * @param text - 模型这一轮的文字。
 * @returns 含 JSON 对象则为真。
 */
function isStructuredAnswer(text: string): boolean {
  const open = text.indexOf('{')
  if (open === -1) return false
  return text.indexOf('}', open) > open
}

/**
 * E2 必须**自己写足**的那两章。
 *
 * ## 为什么单独点名（检查点实测）
 *
 * `runProductionChain` 的合并会把 E1 的内容注入三章：逐问段 → `analysis`、
 * 框架段 → `methods`、真实代码块 → `code`。实测（`2024B-hot-1` 的 `03-declare`）：
 * 注入后 `analysis` 5,895 字、`code` 2,963 字、`restatement` 450 字，**都过地板**。
 *
 * 而 `evaluation`（800）与 `references`（600）**没有任何注入**——它们完全由 E2 写。
 * 实测那两章是 724 与 359 字，**恰好是唯一不达标的两章**。也就是说：不达标不是因为
 * "写得不好"，而是因为**模型不知道这两章没人帮它兜底**。
 *
 * 所以这一段不是加判据，而是把"哪两章完全靠你"讲清楚——这是模型无法从 E1 的
 * 存在推断出来的信息（E1 在别处确实帮了大忙）。
 */
const E2_SELF_WRITTEN_CHAPTERS = [
  'TWO CHAPTERS ARE ENTIRELY YOURS — nobody else writes them:',
  '- `narrative.evaluation` (模型评价与推广): floor is 800 characters. Four labelled passages: 优点 / 局限 / 敏感性 / 推广.',
  '- `narrative.references` (参考文献): floor is 600 characters, at least 3 complete entries (author, title, venue, year),',
  '  and at least one entry must name a method you actually used in THIS paper.',
  'Every other chapter gets help: your E1 analysis is merged into `analysis` and `methods`, and your real code is appended to `code`.',
  'These two get none — if you leave them short, the paper is refused for exactly that reason.',
].join(String.fromCharCode(10))

/** 到顶/批准之后交回散文时，再要一次结构化输出的措辞。 *//** 到顶/批准之后交回散文时，再要一次结构化输出的措辞。 */
const STRUCTURED_ONLY_CORRECTION = [
  'That answer was PROSE, not the container. The harness can only accept the structured container object —',
  'a sentence like "I need to ..." is not a submission and would be refused as unparseable.',
  'Emit the JSON object now: it must start with { and contain the container keys. No preamble, no explanation, no apology.',
  'If you believe you cannot produce it, say so in one short line and stop — but do not write the container in prose.',
].join(' ')

interface SelfCheckCallInfo {
  readonly round: number
  readonly callIndex: number
  readonly containerChars: number
  readonly admissible: boolean
  readonly problems: ReadonlyArray<string>
}

/** 累加两轮 usage（工具循环会产生多次调用，账要合起来记）。 */
function mergeUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  const sum = (x: number | undefined, y: number | undefined): number => (x ?? 0) + (y ?? 0)
  const merged: TokenUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  }
  if (a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined) {
    merged.cacheReadTokens = sum(a.cacheReadTokens, b.cacheReadTokens)
  }
  if (a.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined) {
    merged.cacheWriteTokens = sum(a.cacheWriteTokens, b.cacheWriteTokens)
  }
  if (a.reasoningTokens !== undefined || b.reasoningTokens !== undefined) {
    merged.reasoningTokens = sum(a.reasoningTokens, b.reasoningTokens)
  }
  return merged
}

/** 解析工具调用参数；非法 JSON 返回空对象（由调用方给出"参数不合法"的反馈）。 */
function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** Sections one review request carries. E4b: the reviewer prompt teaches
 *  the three-value severity vocabulary (critical | major | minor) with its
 *  definitions; E4a: from round 1 the reviewer is handed the unresolved
 *  ledger and asked to adjudicate it (remaining / resolved), instead of
 *  re-discovering defects with no memory. */
function reviewSections(
  task: PromptSection,
  delivered: string,
  priorUnresolved: ReadonlyArray<ReviewDefect> = [],
  semanticContext: SemanticContext | undefined = undefined,
  persona: ReviewPersona | null = null,
): PromptSection[] {
  const firstRound = priorUnresolved.length === 0
  const severityGuide = [
    'severity is one of: "critical" (delivery-blocking: data integrity,',
    'numeric escape, provenance, unsupported claim), "major" (structural',
    'deviation), "minor" (wording/presentation).',
  ].join(' ')
  const semanticGuide = semanticContext === undefined
    ? ''
    : [
      '',
      'Semantic findings are limited to these three kinds (anything else is not a',
      'semantic finding and will be discarded):',
      '  1) "claim_without_evidence" — the text asserts something no Result/Claim backs.',
      '  2) "number_rewrite_mismatch" — a restated/rounded number disagrees with its source.',
      '  3) "scope_overclaim" — the conclusion reaches beyond the REQUIRED_OUTPUTs.',
      'A semantic finding MUST carry "evidence": {"text_span": <a verbatim span of the',
      'delivered text>, "ref_ids": [<ids from the canonical context below>]}. A semantic',
      'finding without evidence, or whose span is not in the text, or whose ref_ids do not',
      'resolve in the context, is discarded (it never blocks delivery).',
      'Severity of a semantic finding is fixed by its kind — you cannot choose it.',
    ].join('\n')
  const shape = firstRound
    ? '{"defects":[{"id":"D1","severity":"critical|major|minor","description":"...","semantic":"claim_without_evidence","evidence":{"text_span":"...","ref_ids":["RES-OUT"]}}]}'
    : '{"defects":[{"id":"D1","severity":"critical|major|minor","description":"...","semantic":"claim_without_evidence","evidence":{"text_span":"...","ref_ids":["RES-OUT"]}}],"resolved":["D1"]}'
  // L5：三视角盲评。每个 persona 只看**产物 + 评分细则**，不看模型的自我声明——
  // 实测出现过"复核与答题同源、读同一份输入、上游读错则共犯同一错误"的形态。
  const personaGuide = persona === null
    ? ''
    : [
      '',
      `You are reviewing from ONE perspective: ${PERSONA_SPEC[persona].name}.`,
      `Your focus: ${PERSONA_SPEC[persona].focus}`,
      'Report ONLY defects that fall inside your focus. A defect outside it is another reviewer job —',
      'reporting it anyway dilutes the ledger and is treated as noise.',
      `Prefix every defect id you invent with "${PERSONA_SHORT[persona]}-" so three parallel reviews cannot collide.`,
    ].join(String.fromCharCode(10))
  const instruction = [
    'Review the delivered text for defects.',
    severityGuide,
    personaGuide,
    semanticGuide,
    firstRound
      ? 'Return JSON only: ' + shape + '. An empty defects array means the text is clean.'
      : [
        'Previously reported defects (adjudicate each one):',
        priorUnresolved.map(d => `- ${d.id} [${d.severity}] ${d.description}`).join('\n'),
        'Return JSON only: ' + shape + '.',
        '  "defects": defects STILL present in the current text (reuse the original',
        '    id; a defect no longer present must NOT be listed here),',
        '  "resolved": ids from the list above that the editor has genuinely fixed.',
        'A defect that is absent from BOTH lists is treated as still unresolved.',
      ].join('\n'),
    semanticContext === undefined ? '' : '"semantic" and "evidence" are optional: omit them for non-semantic findings.',
  ].filter(line => line.length > 0).join('\n')
  return [
    task,
    ...(semanticContext === undefined ? [] : [{
      name: 'canonical-context',
      text: `Canonical context (the ONLY evidence you may cite):\n${renderSemanticContext(semanticContext)}`,
      trimPriority: KEEP,
    }]),
    { name: 'draft', text: `Delivered text:\n${delivered}`, trimPriority: TRIM_DRAFT },
    { name: 'instruction', text: instruction, trimPriority: KEEP },
  ]
}

/** Render the canonical context block the reviewer may cite (P3-1 E5). */
function renderSemanticContext(context: SemanticContext): string {
  const lines: string[] = []
  lines.push('REQUIRED_OUTPUTs:')
  for (const requirement of context.requiredOutputs) {
    lines.push(`- ${requirement.requirement_id}: ${requirement.statement}`)
  }
  lines.push('Results:')
  for (const result of context.results) {
    const uncertainty = result.uncertainty === null ? '' : ` ±${result.uncertainty}`
    lines.push(`- ${result.result_id}: ${result.name} = ${result.value} ${result.unit}${uncertainty}`)
  }
  lines.push('Claims:')
  for (const claim of context.claims) {
    lines.push(`- ${claim.claim_id} [${claim.criticality}] results: ${claim.result_refs.join(', ')}`)
  }
  return lines.join('\n')
}

/** Await one backoff delay. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Project any thrown value onto provider-neutral failure facts. */
function failureOf(error: unknown): LlmFailure {
  if (error instanceof ModelCallFailure) return error.failure
  const code = (error as { code?: unknown } | null)?.code
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typeof code === 'string' && code.length > 0 ? code : 'UNKNOWN',
  }
}

/** A review round's parsed verdict (E4a): what remains + what is resolved. */
export interface ReviewReport {
  /** Defects the reviewer reports as STILL PRESENT (auto-id when absent). */
  readonly defects: ReadonlyArray<ReviewDefect>
  /** ids from the prior ledger the reviewer confirms the editor fixed. */
  readonly resolved: ReadonlyArray<string>
}

function criticalDefect(description: string): ReviewDefect {
  return { id: 'MALFORMED', severity: 'critical', description }
}

/** Parse a review verdict. E4b: an unknown severity is fail-closed — the
 *  entry becomes a CRITICAL finding (never silently downgraded to major);
 *  a defect with no id gets a deterministic local id (D<k>), which means a
 *  legacy-format reviewer can never *resolve* it later — only report it.
 *  Malformed output is itself a single critical review failure. */
function parseReviewReport(
  text: string,
  knownIds: ReadonlyArray<string>,
  semantic: { readonly context: SemanticContext | undefined; readonly delivered: string } | undefined = undefined,
): ReviewReport {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { defects: [criticalDefect('reviewer returned no JSON object')], resolved: [] }
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { defects?: unknown; resolved?: unknown }
    if (!Array.isArray(parsed.defects)) {
      return { defects: [criticalDefect('reviewer JSON has no defects array')], resolved: [] }
    }
    const resolved = Array.isArray(parsed.resolved)
      ? parsed.resolved.filter((id): id is string => typeof id === 'string')
      : []
    const seen = new Set(knownIds)
    const defects: ReviewDefect[] = []
    let autoIndex = 1
    for (const entry of parsed.defects) {
      if (typeof entry !== 'object' || entry === null) continue
      const raw = entry as {
        description?: unknown
        severity?: unknown
        id?: unknown
        semantic?: unknown
        evidence?: unknown
      }
      if (typeof raw.description !== 'string') continue
      // A listed id reuses its history; a fresh entry gets a local id.
      const rawId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
      if (rawId !== null && !seen.has(rawId)) seen.add(rawId)
      const id = rawId ?? `D${autoIndex}`
      autoIndex += 1
      // ---- P3-1 (E5): semantic findings are closed + evidence-bound. ----
      if (raw.semantic !== undefined) {
        const parsedSemantic = parseSemanticFinding(raw, id, semantic)
        // A domain-external or evidence-less semantic finding is DISCARDED
        // (never upgraded, never blocking — 禁 1 / attack 3 / attack 4).
        if (parsedSemantic !== null) defects.push(parsedSemantic)
        continue
      }
      defects.push(normalizeSeverity(
        typeof raw.severity === 'string' ? raw.severity : '',
        raw.description,
        id,
      ))
    }
    return { defects, resolved }
  } catch {
    return { defects: [criticalDefect('reviewer returned unparsable JSON')], resolved: [] }
  }
}

/**
 * Parse one semantic finding (P3-1). Returns null when the finding must be
 * discarded: kind outside the closed set of three, no canonical context to
 * check against, missing/empty evidence, a text_span that is not verbatim in
 * the delivered text, or a ref_id that does not resolve in the context.
 */
function parseSemanticFinding(
  raw: { description?: unknown; semantic?: unknown; evidence?: unknown },
  id: string,
  semantic: { readonly context: SemanticContext | undefined; readonly delivered: string } | undefined,
): ReviewDefect | null {
  if (!(SEMANTIC_FINDING_KINDS as ReadonlyArray<string>).includes(String(raw.semantic))) return null
  const kind = String(raw.semantic) as SemanticFindingKind
  if (semantic === undefined || semantic.context === undefined) return null
  const description = String(raw.description ?? '')
  const evidence = raw.evidence as { text_span?: unknown; ref_ids?: unknown } | undefined
  if (evidence === null || typeof evidence !== 'object') return null
  const span = evidence?.text_span
  if (typeof span !== 'string' || span.length === 0) return null
  if (!semantic.delivered.includes(span)) return null
  const refIds = evidence?.ref_ids
  if (!Array.isArray(refIds) || refIds.length === 0 || refIds.some(r => typeof r !== 'string')) return null
  const domain = new Set<string>([
    ...semantic.context.results.map(r => r.result_id),
    ...semantic.context.requiredOutputs.map(r => r.requirement_id),
    ...semantic.context.claims.map(c => c.claim_id),
  ])
  if (!refIds.every(ref => domain.has(ref as string))) return null
  return {
    id,
    severity: semanticSeverity(kind),
    description,
    semantic: kind,
    evidence: { text_span: span, ref_ids: refIds.map(String) },
  }
}

/** Map a producer-supplied severity onto the closed three-value enum.
 *  E4b: fail-closed — anything that is not exactly one of the three values
 *  is CRITICAL (an unclassifiable review entry blocks, it is never
 *  downgraded to major/minor). */
function normalizeSeverity(
  raw: string,
  description: string,
  id: string,
): ReviewDefect {
  const s = raw.trim().toLowerCase()
  if (s === 'critical') return { id, severity: 'critical', description }
  if (s === 'major') return { id, severity: 'major', description }
  if (s === 'minor') return { id, severity: 'minor', description }
  // E4b fail-closed: an unclassifiable severity is a CRITICAL finding that
  // keeps its original description — the review is untrustworthy, never
  // silently downgraded.
  return { id, severity: 'critical', description }
}
