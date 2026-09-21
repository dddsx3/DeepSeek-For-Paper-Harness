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
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
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
// W11.5-A3: the digit self-consistency scan (path B's post-hoc digit check).
import { digitSelfContradictionFindings } from './delivery/digit-check.ts'
// M-QUAL (W10) DP-8: the boundary appendix renders UNCONDITIONALLY (CLEAN
// deliveries carry their limits too) — a separate path from the MARKED
// appendix, exactly as the spec demands.
import { renderBoundaryAppendix } from './delivery/boundary-render.ts'
import type { BoundaryDeclaration } from './ir/boundary-declaration.ts'
import { renderE1DirectDraft } from './produce/e1-direct.ts'
import type { DeliveryGrade } from './delivery/delivery-grade.ts'
import { runVerificationV1V4 } from './verification/v-structure.ts'
import { ModelingIr } from './ir/store.ts'
import { sha256Hex } from './ir/index.ts'
import { resolveRunPolicy } from './policy.ts'
import { parseModelContainer, produceContainerInto } from './produce/ir-producer.ts'
import { produceRunExecution } from './produce/execution-producer.ts'
import { produceInterpretation } from './produce/interpretation-producer.ts'
import { PROSE_CHAPTERS, numericLiterals, renderReportV2 } from './produce/report-renderer.ts'
import { requirementCoverageFindings } from './delivery/requirement-coverage.ts'
import { arithmeticFindingsOf, deliveredNumberFindings } from './delivery/delivered-numbers.ts'
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
   *  with FINDING_SEVERITIES (critical | major | minor); an unknown
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
 * P3-3 (teaching segment v0): the ir-container-v1 protocol lecture carried
 * by the EXECUTE instruction whenever `produceFromExecute` is on. It names
 * ONLY schema-native structure — the run block's closed fields, the
 * declaration-based interpretations/figures, and jsonPath as the single
 * number channel — and never requires or demonstrates any free-form format
 * outside the container schema (禁10). Kept adjacent to the executor so
 * the probe (probe v2) and the instruction can never drift apart.
 */
export const EXECUTE_PROTOCOL_TEACHING = [
  'Produce ONE JSON object — the ir-container-v1 — and nothing else. No prose, no markdown fences, no schema of your own.',
  'Shape: {"__dsh_paper":"ir-container-v1","entries":[...],"code":"...","run":{...},"interpretations":{...},"narrative":{...}}.',
  '  entries: an array of objects, each EXACTLY {"kind": <KIND>, "value": <object>}. The ONLY kinds you may declare are "SymbolSpec", "AssumptionSpec", "EquationSpec", "ModelSpec", and (optionally) "DataArtifact". The harness has ALREADY registered the problem assets for you — DataArtifact "DA-RAW" (the raw problem), RequirementSpec "R-OUT" (the requirement), ProblemSpec "P1" (the binding). NEVER declare those three: reference them by id instead (your ModelSpec sets problem_refs: ["P1"]). Re-declaring a registered id refuses the container.',
  '    SymbolSpec value: {"symbol_id","scope_ref":"P1","token","meaning","unit","role","shape","domain","index_set"} — role is "VARIABLE" for unknowns the solve determines, or "PARAMETER" for quantities whose value you bind in ModelSpec.parameter_refs (k, dt, N...): EVERY symbol you list in parameter_refs must have role "PARAMETER", and a parameter must not be listed in variable_refs. shape is one of SCALAR|VECTOR|MATRIX|TENSOR|INDEXED|UNKNOWN; domain one of REAL|NONNEGATIVE_REAL|INTEGER|NONNEGATIVE_INTEGER|BOOLEAN|PROBABILITY|COMPLEX|UNKNOWN; if you are not sure, answer UNKNOWN honestly instead of inventing one; index_set is an array ([] for a scalar). unit MUST be a NON-EMPTY string — a dimensionless or count-like quantity takes the literal "dimensionless" (an empty "" unit refuses the container).',
  '    AssumptionSpec value: {"assumption_id","scope_ref":"P1","statement","source_type","justification_refs","risk_level","testable","sensitivity_refs","status"} — source_type GIVEN|DERIVED|MODELING_CHOICE|APPROXIMATION; risk_level HIGH|MEDIUM|LOW; status ACTIVE|OBSOLETE|QUESTIONED. Ref-field shapes: justification_refs is a list of REGISTERED IR ids (or []); sensitivity_refs MUST be [] at declaration time — no Results exist yet (they are minted only after your code runs), and if non-empty they may only name Result/DataArtifact ids. NEVER put SymbolSpec ids (like "S-DT") into justification_refs/sensitivity_refs — that refuses the container.',
  '    EquationSpec value: {"equation_id","scope_ref":"P1","expression","representation","lhs_symbols","rhs_symbols","equation_type","unit","depends_on","source"} — representation SYMPY|LATEX_PRESENTATION; equation_type DEFINITION|CONSTRAINT|OBJECTIVE|DERIVED. lhs_symbols/rhs_symbols are lists of the symbol_id VALUES you declared in your SymbolSpec entries (like ["S-Y"]) — NEVER raw math tokens (like ["y"]): an unregistered name refuses the container. depends_on lists your equation_ids; unit is a non-empty string ("dimensionless" when unitless).',
  '    ModelSpec value: {"model_id","problem_refs":["P1"],"assumption_refs","variable_refs","parameter_refs","equation_refs","constraints","objective","dependencies"} — every field is required; assumption_refs/equation_refs list the ids of AssumptionSpec/EquationSpec entries you declared.',
  '      NOTE (element shapes — a wrong shape refuses the container): variable_refs/assumption_refs/equation_refs/dependencies are plain id lists; constraints is an ARRAY OF STRINGS (write [] when you have none — NEVER a single string); objective is a string or null; parameter_refs is a list of {"symbol_ref","value"} objects.',
  // W8.11-A1c (repair, found by the second real run): `parameter_refs` was the
  // ONE field in this lecture whose ELEMENT shape was never stated — the line
  // above lists it as a bare name, right next to `variable_refs`, which IS a
  // plain id list. The model reasonably inferred the same shape and wrote
  // ["S-P0", "S-P1"], and the closed schema refused it:
  //   parameter_refs.0: Invalid input: expected object, received string
  // That refusal cost the run its third attempt and ended it. The field needs
  // an object because a PARAMETER carries a bound value (the whole point of
  // the zero-number channel); saying so is the fix. This is 信息不足, not a
  // model defect — the same class W8.10-B existed to eliminate.
  '      NOTE: parameter_refs is NOT a list of ids — each entry is an OBJECT {"symbol_ref": <a SymbolSpec id>, "value": <a number>}. variable_refs/equation_refs/assumption_refs ARE plain id lists; parameter_refs is the exception, because a parameter carries a bound value.',
  '      Example: "parameter_refs": [{"symbol_ref": "S-P0", "value": 0.1}]  — NOT ["S-P0"].',
  '    DataArtifact (optional, output-pointer form) value: {"data_id","locator"} — locator is one of YOUR outputBasenames. NEVER write content_hash anywhere: every sha256 is computed by the harness over real bytes (declaring one refuses the container — the hash of bytes that do not exist yet cannot be known).',
  '  code: executable Node JavaScript that WRITES the measured numbers to the declared output files. All arithmetic happens here; never state a computed number anywhere else.',
  '  run: the ONLY fields are "outputBasenames" (the file names your code writes) and "seed" (an integer). No other key is accepted.',
  // M-QUAL (W10) DP-4: teach the execution-time config emission. The config
  // is CODE-emitted (N19) — its keys must be the tokens of the SymbolSpecs
  // the container already declared, so the harness can resolve them into a
  // canonical NumericConfig (fail-closed on unknown tokens).
  '  Config emission (SHOULD): declare "numeric_config.json" in run.outputBasenames and write it from your code — ONE JSON object {"discretization": {<symbol>: <number>}, "physical": {<symbol>: <number>}, "choices": {<key>: <string>}, "property_set": <string or null>} where each key names a SymbolSpec you declared (its token OR its symbol_id — both are accepted). Values must be NUMBERS: omit a key you cannot fill rather than writing null. This is the mechanical record of what your code actually ran with; the config-consistency gate compares it against your declared parameters and sibling runs.',
  '  interpretations: declaration-based. results: [{ result_id, name, source: { locator: <one outputBasenames entry>, jsonPath: <a BARE dotted path to the number inside that file, e.g. "n_fixed" — not "$.n_fixed"; array elements use the index form "oc[2].accept"; it must resolve to a JSON number, so emit ranges as two numeric fields and vectors as one field per entry> }, unit }]. The locator must be one of your declared outputs; every Result reads its value via jsonPath — never a literal number. '
  + 'claims (declare them here): [{ claim_id, text, claim_type: "NUMERIC", criticality: "CRITICAL", result_refs: [<a result_id>], model_refs: [<your model_id>], evidence_refs: [<a result_id>] }] — a CRITICAL NUMERIC claim binds one Result as the number the paper states; without a claim your REQUIRED_OUTPUT stays unpaid and delivery is blocked.',
  '  interpretations.figures (REQUIRED — at least ONE figure): a submittable modelling paper shows a chart, and the harness refuses one without any (real refusal: "the paper carries no figure"). Declare the STRUCTURE only — the harness renders the bytes and computes every hash: [{ figure_id, chart_type: "line"|"scatter"|"bar"|"table", data_refs: [Result ids], caption? }]. Pick what your results actually support: an OC/ROC curve for a test design (line over the rejection probability Results), a comparison bar chart across decision scenarios, a sensitivity table, a decision tree as a table. caption/x_label/y_label must NOT contain numeric literals (write quantities in words, e.g. "final value" instead of "y(2.0)"): a number in these strings is refused unless it is exactly the value of a referenced Result.',
  '  narrative: { title, conclusion: { claims: [{ text, quantity_refs: [Result ids], representation? }] } } — a conclusion number must be the bound Result value verbatim, or an explicitly declared rendering: {"kind":"rounded","dp":<0..20>} or {"kind":"with_uncertainty","uncertainty_refs":[...]}. The check is mechanical: each claim\'s text must CONTAIN the value of every quantity_ref, written into the sentence — text "The unified minimum sample size is 1762." with quantity_refs ["R-N-FIXED"]. A qualitative sentence that names the Result but never states its value is refused (real refusal: "The unified sample size is the maximum of the two case-specific minimum sample sizes.").',
  '  Naming a quantity instead of copying it (STRONGLY PREFERRED): you write this narrative BEFORE your code runs, so you cannot know its output. Writing `{<result_id>}` inside the text makes the harness substitute the run\'s value at render time — the digit then comes from the IR by construction. Prefer this over guessing a literal: a literal number you write yourself must equal the Result value exactly, and a wrong guess refuses the whole report. Both of the two most recent real runs died exactly there (the narrative stated one sample size while its own code had computed another), and both had already passed every other check — so a wrong literal costs the entire production chain. Example shape: text "the minimum sample size is {R-N1} and the critical value is {R-C1}", quantity_refs ["R-N1","R-C1"]. A name that is not one of that claim\'s quantity_refs is refused (the braces would otherwise print into the paper).',
  '  Every literal in the conclusion must be a number the RUN produced (REQUIRED): a constant the problem GAVE you is not a Result, so writing it as a digit in the conclusion is refused (real refusal: "conclusion claim contains numeric literal \'95\' outside its declared quantities [2, 22, 0]" — the model restated the confidence level). Either write the given quantity in words ("at the stated confidence level"), or make your code emit it as a Result and name it `{<result_id>}`. The refusal lists the allowed set — read it before rewriting.',
  '  ANSWER EVERY SUB-PROBLEM (REQUIRED, and the most common way a paper fails review): the statement asks several questions (问题1/2/3/4…), and EACH ONE is a separate REQUIRED_OUTPUT the harness registers on its own. A sub-problem with no Result of its own reads as unanswered — the paper is refused before delivery and the correction names which ones are missing (real refusal: "the paper does not answer every sub-problem the statement asks: R-Q2…R-Q4"). So: build the model for every sub-problem, run the code that computes its numbers, and declare a Result AND a CRITICAL Claim for each. One aggregate number for the whole paper is not an answer to four questions, and a methods sentence that promises "we enumerate the combinations" while the results table holds a single scenario is exactly what a reviewer marks as unfulfilled.',
  '  Container shape (REQUIRED, FIRST LINE MATTERS): the output\'s first characters must be `{"__dsh_paper":"ir-container-v1"` — the version marker IS the container\'s identity, and a container missing it is refused before anything else is checked (real refusal: the first real run\'s attempt 1 produced a full, valid container that started with `{"run": …` and was refused on the missing marker alone).',
  '  Re-emission on retry (REQUIRED): a retried container must re-declare every entry it declared before, BYTE-IDENTICAL unless the refusal message asked you to change that entry — the store is append-only and same-id-different-content is a conflict. If you must improve wording, give the entry a NEW id instead of editing the old one.',
  '  Assumption completeness (REQUIRED, the B3-reverse rule): EVERY `[[ASSUMPTION: id]]` anchor that exists in the analysis MUST have a matching AssumptionSpec entry in `entries` — one anchor, one declaration, same id, no exceptions. A container that declares only "the assumptions I found important" while the analysis marked 15 is REFUSED (real refusal: the first real run marked 15 anchors, the container declared 9, and the fidelity gate refused all three attempts on exactly this gap). When in doubt, declare it — an over-declared assumption is checked, an under-declared one kills the container.',
  '  narrative fields (REQUIRED — the paper cannot be delivered without them): the narrative object must carry EIGHT non-empty strings: `title`, `methods` (模型建立与求解 — the model/derivation text, NOT a one-line summary: state the equations or recursions you actually solve), `conclusion`, `restatement` (问题重述), `analysis` (问题分析), `evaluation` (模型评价与推广), `references` (参考文献条目，形如 "[1] 作者. 题名. 年."), `code` (代码附录说明). A missing one renders as a VISIBLE placeholder and the harness refuses the paper before delivery with the exact key named (real refusals: "the paper still lacks chapters the container must supply: 模型建立与求解（方法）（narrative.methods）" — the model wrote the other six and kept omitting `methods`; and "代码附录（narrative.code）"). A retry must keep the chapters it already wrote: re-emit them all in the same container.',
  '  Output shape (REQUIRED): return the container as ONE bare JSON object — no markdown fence, no prose around it. (Two of three attempts in the first real run wrapped it in ```json … ``` and were refused as parse_failed.) If you do fence it, one surrounding fence is now stripped, but do not rely on that.',
  '  Code robustness (REQUIRED): your code must PARSE and run. A JavaScript object key that contains `-` must be quoted — `{"S-P1": 0.1}` is legal, `S-P1: 0.1` is a SyntaxError that kills the whole run before any output is written (real refusal: the first real run\'s attempt died on `S-P1: p1,` and the failure surfaced as an output-set mismatch). Prefer your symbols\' plain `token` as the key, or quote every key.',
  '  Code must FINISH in the runner\'s wall-clock budget (REQUIRED): the deployment gives the child process a fixed budget (minutes, not hours) and kills it when it runs out — a killed run writes no output file, so every Result is lost and the whole paper falls back to the unverified path. Keep the computation small enough to finish (bound every loop: cap Monte-Carlo draws, grid sizes and iteration counts; prefer closed-form and exact enumeration over simulation) and WRITE THE OUTPUT FILE EARLY — before the expensive part, then rewrite it with the final numbers — so a late kill still leaves a readable result.',
  '  Numeric robustness (REQUIRED): your code\'s output JSON must carry finite numbers for EVERY declared jsonPath. JavaScript Infinity/NaN become null in JSON.stringify, and a null (or any non-number) at a declared path refuses the container. Naive product formulas for binomial coefficients overflow around n≈170 — compute binomial probabilities in log space (sum of Math.log terms) or with a recurrence that cannot overflow; sanity-check that every value you emit is finite before writing the file (real refusal: a binomial CDF at n=2307 returned Infinity, serialized as null, and the container was refused after the code had already run).',
  '  In-container duplicates (REQUIRED): the same id must not appear twice within ONE container either — including SymbolSpec ids declared for different scopes. Run-11 attempt 1 declared two different S-C entries (case-1 and case-2 critical values); give each distinct quantity a distinct id (S-C1, S-C2).',
  'The container is refused (and the attempt fails) if: you declare kind "ProblemSpec" or "RequirementSpec", or re-declare "DA-RAW"; you write content_hash anywhere; an entry kind is not one of the five above; a number appears outside code/declarations; a jsonPath is missing or does not resolve to a finite number; the run block carries a foreign key; or the conclusion states an undeclared rounding.',
].join('\n')


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

/** W11.5 baseline-4: the section headings a delivery text carries (any level). */
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
   * P0-3 (PRD v2 §3.3): delivery grade threshold. 'strict-tolerance'
   * (default) keeps the historical fail-closed behavior — any unpassed
   * gate refuses delivery. 'fail-soft' turns unpassed gates into MARKED
   * annotations: content delivers with an honest appendix, and only the
   * three closed fatal conditions (empty content / execution failure /
   * reference catastrophe) still BLOCK. The option exists so the mass
   * tier can adopt fail-soft without mutating strict-tier compositions;
   * the grade itself is always computed by `gradeDelivery` (one verdict
   * path, no parallel judgement).
   */
  readonly deliveryGradeMode?: 'strict-tolerance' | 'fail-soft'
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
      const task: PromptSection = { name: 'task', text: `Task: ${input}`, trimPriority: TRIM_TASK }
      const plan = await this.runNode(runId, 'plan', 'plan', 'executor', [
        task,
        { name: 'instruction', text: 'Produce a short numbered execution plan.', trimPriority: KEEP },
      ])
      const draft = await this.runNode(runId, 'execute', 'execute', 'executor', [
        task,
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
            ? EXECUTE_PROTOCOL_TEACHING
            : 'Produce the deliverable text for the task.',
          trimPriority: KEEP,
        },
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
        const review = await this.runNode(
          runId, 'review', round === 0 ? 'review' : `review #${round + 1}`, 'reviewer',
          reviewSections(task, current, [...unresolved.values()], this.semanticContextOf()),
        )
        const report = parseReviewReport(review.text, [...unresolved.keys()], {
          context: this.semanticContextOf(),
          delivered: current,
        })
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
        for (const defect of unresolved.values()) {
          await this.engine.appendPublic(runId, review.nodeId, 'defect', {
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
      const gradeInput = this.options.deliveryGradeMode === 'fail-soft'
        ? [...gateFailures, ...reviewFailures, ...vFindings, ...receiveFailures, ...digitFindings]
        : [...gateFailures, ...reviewFailures]
      const fatal = {
        emptyContent: !contentExists(current),
        executionFailed: false,
        referenceCatastrophe: false,
      }
      const graded = gradeDelivery(gradeInput, fatal, {
        ...Object.fromEntries(gradeInput.map(f => [f.kind, f.kind.startsWith('review_defect') ? 'review ledger' : (f.kind.startsWith('V') ? 'verification' : 'delivery')])),
      })
      // Strict-tolerance keeps the historical fail-closed verdict byte-for-
      // byte: any failure blocks, none is annotation, and the fatal probe is
      // not consulted (P0-3 changes fail-soft compositions only).
      const grade: DeliveryGrade = this.options.deliveryGradeMode === 'fail-soft'
        ? graded.grade
        : (gradeInput.length === 0 ? 'CLEAN' : 'BLOCKED')
      await this.audit({
        eventType: 'delivery_graded',
        actor: 'paper-executor',
        runId,
        detail: {
          grade,
          mode: this.options.deliveryGradeMode ?? 'strict-tolerance',
          annotations: graded.annotations.length,
          fatal,
        },
      })
      if (grade === 'BLOCKED') {
        // TASK 4.2 history: the reviewer gate is part of the same fail-closed
        // policy. Under strict-tolerance any unpassed gate refuses; under
        // fail-soft only the three fatal conditions land here.
        await this.engine.transitionRun(runId, 'failed')
        await this.audit({
          eventType: 'gate_failed',
          actor: 'paper-executor',
          runId,
          detail: {
            gate: gradeInput.length === 0 ? 'fatal-content-probe' : 'review',
            defects: outstandingList.length,
            reviews: policy.maxReviseRounds + 1,
          },
        })
        throw new WorkflowExecutionError(
          'gate-failed',
          `run '${runId}' blocked at delivery grade ${grade}${gradeInput.length === 0 ? ' (fatal content probe)' : ` after ${policy.maxReviseRounds + 1} reviews`}`,
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
      const deliverableText = grade === 'MARKED'
        ? `${current}${boundaryAppendix}${renderDeliveryAppendix(grade, graded.annotations)}`
        : `${current}${boundaryAppendix}`

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
    if (ir.get('DA-RAW') !== undefined) return RESERVED

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

    putOrThrow('ProblemSpec', {
      problem_id: 'P1',
      raw_problem_ref: 'DA-RAW',
      requirement_refs: ['R-OUT', ...subProblems.map(s => s.requirementId)],
    })
    await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'ProblemSpec', id: 'P1', stage: 'input-registration' } })

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
            return { id: req.requirement_id, columns: [req.statement, req.requirement_type] }
          }),
        // W11.5 baseline-20 (审计 B-2/B-3): the equations and models the container
        // declared ARE the 模型建立与求解 chapter — rendered from the IR, so the
        // chapter states the model that was actually built instead of a summary
        // sentence, and cannot be empty while the model exists.
        equations: [...snapshot.values()]
          .filter(r => r.kind === 'EquationSpec')
          .map((r) => {
            const eq = r.value as { equation_id: string; expression: string; equation_type: string; unit: string }
            return { id: eq.equation_id, columns: [eq.equation_id, eq.expression, eq.equation_type, eq.unit] }
          }),
        models: [...snapshot.values()]
          .filter(r => r.kind === 'ModelSpec')
          .map((r) => {
            const m = r.value as {
              model_id: string
              objective: string
              constraints: ReadonlyArray<string>
              problem_refs: ReadonlyArray<string>
            }
            return {
              id: m.model_id,
              columns: [m.model_id, m.objective, (m.constraints ?? []).join('；') || '—', (m.problem_refs ?? []).join(', ')],
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
    const codeText = container.code ?? ''
    return { ok: true, reportText: rendered.text, loadCode: () => codeText }
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
    const failSoft = this.options.deliveryGradeMode === 'fail-soft'
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
        if (tier === 'T2' && type === 'execute' && this.options.produceFromExecute === true) {
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
            const e1Sections = sections.filter(s => s.text !== EXECUTE_PROTOCOL_TEACHING)
            const e1Base = e1Sections.length === sections.length
              ? prompt
              : await this.fitPrompt(runId, node.id, role, e1Sections)
            const e1Prompt = `${e1Base}\n\n${e1AnalysisInstruction(requiredIds)}`
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
          } else {
            // Visible in the audit trail: this attempt did NOT re-run E1.
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: 'E1Reused', id: 'e1', nodeId: node.id, stage: 'receive', chars: e1Text.length },
            })
          }
          const baseE2Prompt = e2NormalizationPrompt(e1Text, EXECUTE_PROTOCOL_TEACHING)
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
          const e2 = await this.call(role, e2Prompt)
          await this.recordUsage(runId, route.provider, route.model, e2.usage)
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
          await this.engine.transitionRun(runId, 'failed')
          await this.audit({
            eventType: 'truncated',
            actor: 'paper-executor',
            runId,
            detail: { code: failure.code, role, attempt, class: 'truncated' },
          })
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
    const draft = renderE1DirectDraft({
      e1Text,
      title: '建模分析稿（E1 直通交付）',
      failureReason: gateReason,
      failedRules: facts?.failedRules ?? [],
      gate: 'ir_producer',
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
  const instruction = [
    'Review the delivered text for defects.',
    severityGuide,
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
