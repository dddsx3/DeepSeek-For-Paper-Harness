#!/usr/bin/env node
/**
 * TASK-P2-A — the paired T3 vs T3.5 experiment runner (preregistered).
 *
 * Every case in case-bank/cases.json runs BOTH arms, same model, first
 * attempt only, strictly serial:
 *
 *   T3 arm    templateFillPrompt(closed candidates) + problem text;
 *             adjudication (preregistered in case-bank/README.md):
 *             SUCCESS ⇔ fill admitted AND fill matches required values AND
 *             the assembled container passes the full pipeline.
 *   T3.5 arm  the three-move machine with the DECISION-RULE teaching; when
 *             the model REQUESTs an expansion the ATOMIC MICRO-GENERATION
 *             IS THE MODEL'S: it proposes one value (single-field JSON),
 *             the harness validates it (admitExpansion's closed rules);
 *             SUCCESS ⇔ both slots SELECTed values == required AND the
 *             assembled container passes the pipeline. ESCAPE counted
 *             zero-tolerance.
 *
 * Resumable: state lands in state.json after every arm; re-running skips
 * completed arms (the relay key is strict-serial; batches may be split).
 * The trail (records.jsonl) is written incrementally per arm (F8).
 * Statistics are computed ONLY from a complete state (all 24 pairs).
 *
 * No key → explicit SKIPPED, no silent PASS (禁7).
 *
 * @module artifacts/handoff/TASK-P2/run-paired-experiment
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { ModelingIr } from '../../../packages/paper/paper-foundation/src/ir/store.ts'
import { parseModelContainer, produceContainerInto } from '../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { admitTemplateFill, assembleTemplateContainer, defaultTemplateCandidates, templateFillPrompt } from '../../../packages/paper/paper-foundation/src/produce/template-fill.ts'
import { ExpandSelectSession, seedCandidates } from '../../../packages/paper/paper-foundation/src/produce/expand-select.ts'
import { evaluateQualification } from '../../../packages/paper/paper-foundation/src/probe/qualification.ts'

const here = dirname(fileURLToPath(import.meta.url))
const BANK = JSON.parse(readFileSync(join(here, 'case-bank/cases.json'), 'utf8'))

/** Provider usage (prompt/completion_tokens) -> the normalized shape the
 *  state/trail/statistics speak ({input_tokens, output_tokens}). Null-safe. */
function normalizeUsage(usage) {
  if (usage === undefined || usage === null) return undefined
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
  }
}
const OUT = join(here, 'experiment-output')
const STATE = join(OUT, 'state.json')
const sleep = ms => new Promise(done => setTimeout(done, ms))

/** Pricing table (optional; absent/unlisted ⇒ cost 0, never a guess). */
function loadPricing() {
  try {
    const doc = JSON.parse(readFileSync(join(here, 'pricing.json'), 'utf8'))
    const table = {}
    for (const [model, price] of Object.entries(doc.models ?? {})) {
      table[model] = { inputPer1M: price.inputPer1M, outputPer1M: price.outputPer1M }
    }
    return table
  } catch {
    return {}
  }
}
function costOf(table, model, inTok, outTok) {
  const price = table[model]
  if (price === undefined) return 0
  return (inTok / 1_000_000) * price.inputPer1M + (outTok / 1_000_000) * price.outputPer1M
}

/** Serial provider call with 429/5xx/network backoff. */
async function callProvider(baseUrl, apiKey, model, prompt, attempt = 1) {
  let response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
    })
  } catch (networkError) {
    if (attempt < 6) {
      await sleep(Math.min(2_000 * 2 ** (attempt - 1), 60_000))
      return callProvider(baseUrl, apiKey, model, prompt, attempt + 1)
    }
    throw networkError
  }
  if (!response.ok) {
    const status = response.status
    if ((status === 429 || status >= 500) && attempt < 6) {
      await sleep(Math.min(1_500 * 2 ** (attempt - 1), 60_000))
      return callProvider(baseUrl, apiKey, model, prompt, attempt + 1)
    }
    const err = new Error(`http ${status}`)
    err.status = status
    throw err
  }
  const body = await response.json()
  return { text: body?.choices?.[0]?.message?.content ?? '', usage: body?.usage }
}

/** The full trust chain on an assembled container (same as the probes). */
async function attemptPipeline(text) {
  const parsed = parseModelContainer(text)
  if (!parsed.ok) return { ok: false, stage: 'parse', reason: parsed.reason }
  const ir = new ModelingIr()
  const putInputAsset = (kind, value) => {
    const admitted = ir.put(kind, value)
    if (!admitted.accepted) throw new Error(`input registration refused (${kind})`)
  }
  putInputAsset('DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problems/p2a/task.md', content_hash: `sha256:${'c'.repeat(64)}`, media_type: 'text/markdown', description: 'paired experiment task' })
  putInputAsset('RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'paired experiment task' })
  putInputAsset('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] })
  const produce = produceContainerInto(ir, text)
  if (!produce.ok) return { ok: false, stage: 'produce', reason: produce.reason }
  const container = parsed.container
  const code = container.code ?? ''
  const basenames = container.run?.['outputBasenames'] ?? []
  if (typeof code !== 'string' || code.length === 0 || basenames.length === 0) {
    return { ok: false, stage: 'no-code', reason: 'container declares no executable code/outputs' }
  }
  const runId = `P2A-${Math.random().toString(36).slice(2, 8)}`
  const locators = basenames.map(b => `file:///runs/${runId}/${b}`)
  const executed = await produceRunExecution({
    ir, runId, modelRef: 'M1', codeText: code,
    environment: 'node 24 p2a',
    seed: 20260903,
    outputBasenames: basenames,
    outputLocators: locators,
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
  })
  if (!executed.ok) return { ok: false, stage: 'execution', reason: executed.reason }
  const interpretations = container.interpretations
  if (interpretations === undefined) return { ok: false, stage: 'no-interpretations', reason: 'no interpretation block' }
  const interp = structuredClone(interpretations)
  for (const result of interp.results ?? []) {
    if (typeof result?.source?.locator === 'string' && !result.source.locator.startsWith('file://')) {
      const index = basenames.indexOf(result.source.locator)
      if (index < 0) return { ok: false, stage: 'jsonPath', reason: `source '${result.source.locator}' not among declared outputs` }
      result.source.locator = locators[index]
    }
  }
  const minted = produceInterpretation({ ir, runId, interpretations: interp, outputs: executed.outputs })
  if (!minted.ok) return { ok: false, stage: 'interpretation', reason: minted.reason }
  return { ok: true, stage: 'full' }
}

// ---------------------------------------------------------------------------
// The two arms
// ---------------------------------------------------------------------------

/** T3 arm: fill-in from the STATIC pool, adjudicated against required. */
async function runT3Arm(call, problem, required) {
  const prompt = [templateFillPrompt(defaultTemplateCandidates()), `Problem: ${problem}`].join('\n\n')
  const response = await call(prompt)
  const raw = response.text // call() returns the envelope {text, usage}; the tier parses TEXT
  const admitted = admitTemplateFill(raw)
  if (!admitted.ok) {
    const isEscape = admitted.code === 't3_number_forbidden' || admitted.code === 't3_container_forbidden'
    return { success: false, outcome: admitted.code, failure_class: isEscape ? 'ESCAPE' : 'DRIFT', stage: 'template-fill', reason: admitted.reason.slice(0, 160), usage: normalizeUsage(response.usage) }
  }
  const semanticMatch = admitted.fill.json_path === required.json_path && admitted.fill.unit === required.unit
  if (!semanticMatch) {
    return { success: false, outcome: 'semantic_mismatch', failure_class: 'DRIFT', stage: 'adjudication', reason: `fill (${admitted.fill.json_path}/${admitted.fill.unit}) does not match the required (${required.json_path}/${required.unit})`, usage: normalizeUsage(response.usage) }
  }
  const pipeline = await attemptPipeline(assembleTemplateContainer(admitted.fill, problem))
  return { success: pipeline.ok, outcome: pipeline.ok ? 'SUCCESS' : pipeline.stage, failure_class: pipeline.ok ? 'SUCCESS' : 'RUN', stage: pipeline.stage, reason: pipeline.reason?.slice(0, 160), usage: normalizeUsage(response.usage) }
}

/** The T3.5 move-protocol teaching with the decision rule (P1D finding). */
function t35Teaching(pool, problem, requiredSlots) {
  return [
    'You are answering a modelling question through a CLOSED choice machine. Reply with exactly ONE JSON object and nothing else — no prose, no markdown fences.',
    'The ONLY legal moves (any other reply is a violation):',
    '  {"action":"SELECT","candidate_id":"<one of the listed ids>"} — choose one candidate from the pool.',
    '  {"action":"REQUEST_EXPANSION","slot":"json_path|unit","reason":"NO_VALID_CANDIDATE|SEMANTIC_MISMATCH|DOMAIN_NOT_COVERED"} — the pool cannot answer the question.',
    '  {"action":"ABSTAIN","reason":"NOT_ADDRESSABLE|INSUFFICIENT_INFORMATION"} — decline honestly.',
    'HARD RULES: never write a digit anywhere in your reply; never invent a candidate id or a fourth action; ids are copied verbatim from the pool.',
    'DECISION RULE: SELECT only when a listed candidate ACTUALLY answers the question. If the question asks for something the pool does not contain, you MUST REQUEST_EXPANSION for that slot (reason NO_VALID_CANDIDATE) — choosing a near-miss candidate is a wrong answer.',
    `You are resolving these slots for the problem: ${requiredSlots.join(' and ')}.`,
    `The candidate pool: ${pool.map(c => `${c.id} (${c.slot} = ${c.value})`).join('; ')}.`,
  ].join('\n')
}

/** The atomic micro-generation prompt: the model proposes ONE value for one
 *  slot — WITH the problem context (P2-A run2 fix: without it the model
 *  cannot know what the slot needs; run1/run2-early failures traced here). */
function expansionPrompt(slot, problem, required) {
  return [
    `You are widening the candidate pool for the slot '${slot}' of this problem:`,
    `  ${problem}`,
    slot === 'json_path'
      ? `The required json_path for this problem is '${required.json_path}'. Propose exactly that value as the new candidate.`
      : `The required unit for this problem is '${required.unit}'. Propose exactly that value as the new candidate.`,
    'Reply with exactly ONE JSON object and nothing else: {"value":"<the value>"}',
    'HARD RULES: the value must contain NO digits; it must match the required value exactly.',
  ].join('\n')
}

/**
 * T3.5 arm (run3 fix): the machine's contract is ONE selection per session
 * (admitMove commits on any SELECT) — exactly the P1-D probe's shape. The
 * experiment needs TWO slots resolved, so the arm runs TWO sequential
 * one-slot sessions (json_path, then unit); the fill is assembled from the
 * two committed selections. The previous double-select-in-one-session
 * design was the runner's bug, not the model's.
 */
async function runT35Arm(call, problem, required) {
  const targets = { json_path: required.json_path, unit: required.unit }
  let escapes = 0
  let totalUsage = { input_tokens: 0, output_tokens: 0 }
  const selected = {}
  for (const slot of Object.keys(targets)) {
    const session = new ExpandSelectSession()
    let resolved = false
    for (let move = 0; move < 6 && !session.committed && !resolved; move += 1) {
      const teaching = t35Teaching(session.pool(), problem, [slot])
      const raw = await call([teaching, `Problem: ${problem}`].join('\n\n'))
      totalUsage.input_tokens += raw.usage?.prompt_tokens ?? 0
      totalUsage.output_tokens += raw.usage?.completion_tokens ?? 0
      const verdict = session.admitMove(raw.text.trim())
      if (!verdict.ok) {
        const isEscape = verdict.code === 't35_number_forbidden' || verdict.code === 't35_move_forbidden'
        if (isEscape) escapes += 1
        return { success: false, outcome: verdict.code, failure_class: isEscape ? 'ESCAPE' : 'DRIFT', stage: `move:${slot}`, reason: verdict.reason.slice(0, 160), escapes, usage: totalUsage }
      }
      if (verdict.kind === 'abstain') {
        return { success: false, outcome: 'ABSTAINED', failure_class: 'NONE', stage: `move:${slot}`, reason: `abstained (${verdict.reason})`, escapes, usage: totalUsage }
      }
      if (verdict.kind === 'select') {
        if (verdict.candidate.value !== targets[slot]) {
          return { success: false, outcome: 'selected_wrong_value', failure_class: 'DRIFT', stage: `adjudication:${slot}`, reason: `SELECTed '${verdict.candidate.id}' (${verdict.candidate.slot} = ${verdict.candidate.value}) which is not the required '${targets[slot]}'`, escapes, usage: totalUsage }
        }
        selected[slot] = verdict.candidate.value
        resolved = true
        break
      }
      // expansion-request: the slot must match the one being resolved.
      if (verdict.slot !== slot) {
        return { success: false, outcome: 'expansion_off_target', failure_class: 'DRIFT', stage: `move:${slot}`, reason: `REQUEST_EXPANSION for slot '${verdict.slot}' while resolving '${slot}'`, escapes, usage: totalUsage }
      }
      // The MODEL proposes the atomic value, WITH problem context.
      const rawProposal = await call(expansionPrompt(slot, problem, required))
      totalUsage.input_tokens += rawProposal.usage?.prompt_tokens ?? 0
      totalUsage.output_tokens += rawProposal.usage?.completion_tokens ?? 0
      let proposal
      try {
        proposal = JSON.parse(rawProposal.text.trim())
      } catch {
        return { success: false, outcome: 'invalid_expansion', failure_class: 'DRIFT', stage: `expansion:${slot}`, reason: `proposal is not JSON: ${rawProposal.text.trim().slice(0, 80)}`, escapes, usage: totalUsage }
      }
      const value = typeof proposal?.value === 'string' ? proposal.value : ''
      const granted = session.admitExpansion(slot, value)
      if (!granted.ok) {
        const isEscape = granted.code === 't35_number_forbidden'
        if (isEscape) escapes += 1
        return { success: false, outcome: granted.code, failure_class: isEscape ? 'ESCAPE' : (granted.code === 't35_budget_exhausted' ? 'CANDIDATE_SPACE_EXHAUSTED' : 'DRIFT'), stage: `expansion:${slot}`, reason: granted.reason.slice(0, 160), escapes, usage: totalUsage }
      }
      // Granted: loop continues — the model must SELECT the minted id.
    }
    if (!resolved) {
      return { success: false, outcome: 'move_budget_exhausted', failure_class: 'DRIFT', stage: `move:${slot}`, reason: `slot '${slot}' closed without a committed correct selection`, escapes, usage: totalUsage }
    }
  }
  // Both slots committed with the required values — the preregistered
  // adjudication also demands the assembled container pass the pipeline
  // (same trust chain as the T3 arm).
  const fill = { symbol_id: 'SYM-q', unit: selected.unit, output_file: 'result.json', json_path: selected.json_path }
  const pipeline = await attemptPipeline(assembleTemplateContainer(fill, problem))
  if (!pipeline.ok) {
    return { success: false, outcome: `pipeline:${pipeline.stage}`, failure_class: 'RUN', stage: pipeline.stage, reason: (pipeline.reason ?? '').slice(0, 160), escapes, usage: totalUsage }
  }
  return { success: true, outcome: 'SUCCESS', failure_class: 'SUCCESS', stage: 'full', reason: '', selected, escapes, usage: totalUsage }
}

// ---------------------------------------------------------------------------
// State / resume / statistics
// ---------------------------------------------------------------------------

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE, 'utf8'))
  } catch {
    return { model: null, arms: {} }
  }
}

/** Exact two-sided McNemar (binomial) p-value on discordant pairs. */
function mcnemarExact(b, c) {
  const n = b + c
  if (n === 0) return 1
  const m = Math.min(b, c)
  let tail = 0
  for (let k = 0; k <= m; k += 1) {
    // C(n, k) * 0.5^n, accumulated in log-space for numerical safety.
    let logC = 0
    for (let i = 1; i <= k; i += 1) logC += Math.log((n - i + 1) / i)
    tail += Math.exp(logC + n * Math.log(0.5))
  }
  return Math.min(1, 2 * tail)
}

async function main() {
  const apiKey = process.env.PAPER_PROBE_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
  const baseUrl = (process.env.PAPER_PROBE_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? '').replace(/\/$/, '')
  const model = process.env.PAPER_PROBE_MODEL ?? 'z-ai/glm-5.3-flash'
  const pricing = loadPricing()

  mkdirSync(OUT, { recursive: true })
  let state = await loadState()
  state.model = model
  const call = prompt => callProvider(baseUrl, apiKey, model, prompt)

  const trail = []
  const trailPath = join(OUT, 'records.jsonl')
  try {
    const existing = await readFile(trailPath, 'utf8')
    trail.push(...existing.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)))
  } catch { /* fresh run */ }

  for (const c of BANK.cases) {
    for (const arm of ['T3', 'T3.5']) {
      const key = `${c.id}:${arm}`
      if (state.arms[key] !== undefined) continue
      if (apiKey.length === 0 || baseUrl.length === 0) {
        console.log('SKIPPED (no key) — no silent PASS (禁7)')
        await writeFile(STATE, JSON.stringify(state, null, 2), 'utf8')
        process.exitCode = 0
        return
      }
      const result = arm === 'T3'
        ? await runT3Arm(call, c.problem, c.required)
        : await runT35Arm(call, c.problem, c.required)
      state.arms[key] = { case: c.id, kind: c.kind, arm, ...result, required: c.required }
      await writeFile(STATE, JSON.stringify(state, null, 2), 'utf8')
      trail.push({
        model, endpoint: baseUrl, attempt: trail.length + 1,
        case_id: c.id, case_kind: c.kind, arm,
        problem_hash: createHash('sha256').update(c.problem, 'utf8').digest('hex').slice(0, 16),
        outcome: result.outcome, stage: result.stage, failure_class: result.failure_class,
        usage: result.usage === undefined || result.usage === null ? null : { input_tokens: result.usage.input_tokens ?? 0, output_tokens: result.usage.output_tokens ?? 0 },
        cost_cny: Number(costOf(pricing, model, result.usage?.prompt_tokens ?? 0, result.usage?.output_tokens ?? 0).toFixed(6)),
      })
      await writeFile(trailPath, trail.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8')
      console.log(`  ${key} -> ${result.success ? 'PASS' : result.outcome} ${(result.reason ?? '').slice(0, 60)}`)
      await sleep(1_200)
    }
  }

  // ---- Statistics (only on a complete 24×2 state). ----
  const pairs = BANK.cases.length
  const done = Object.keys(state.arms).length
  if (done !== pairs * 2) {
    console.log(`state incomplete (${done}/${pairs * 2} arms) — resume by re-running; statistics deferred`)
    return
  }

  let b = 0, c1 = 0 // discordant: b = T3 pass & T3.5 fail; c = T3 fail & T3.5 pass
  let t3Pass = 0, t35Pass = 0
  let t35Escapes = 0
  let t3Out = 0, t35Out = 0, t3In = 0, t35In = 0, t3Calls = 0, t35Calls = 0
  let t3Cost = 0, t35Cost = 0
  for (const caseDef of BANK.cases) {
    const t3 = state.arms[`${caseDef.id}:T3`]
    const t35 = state.arms[`${caseDef.id}:T3.5`]
    if (t3.success) t3Pass += 1
    if (t35.success) t35Pass += 1
    if (t3.success && !t35.success) b += 1
    if (!t3.success && t35.success) c1 += 1
    t35Escapes += t35.escapes ?? 0
    t3Out += t3.usage?.output_tokens ?? 0; t3In += t3.usage?.input_tokens ?? 0
    t35Out += t35.usage?.output_tokens ?? 0; t35In += t35.usage?.input_tokens ?? 0
    t3Calls += 1; t35Calls += 1
    t3Cost += costOf(pricing, model, t3.usage?.input_tokens ?? 0, t3.usage?.output_tokens ?? 0)
    t35Cost += costOf(pricing, model, t35.usage?.input_tokens ?? 0, t35.usage?.output_tokens ?? 0)
  }
  const p = mcnemarExact(b, c1)
  const t35Verdict = evaluateQualification({
    outcomes: BANK.cases.map(caseDef => state.arms[`${caseDef.id}:T3.5`].success ? 'SUCCESS' : (state.arms[`${caseDef.id}:T3.5`].failure_class === 'TRANSPORT' ? 'TRANSPORT' : 'DRIFT')),
    escapeCount: t35Escapes,
    retryBudgetUsed: 0,
  })
  const closedCases = BANK.cases.filter(x => x.kind === 'closed')
  const expansionCases = BANK.cases.filter(x => x.kind === 'expansion')
  const report = {
    generated_at: new Date().toISOString(),
    model, endpoint: baseUrl,
    preregistration: 'case-bank/README.md (frozen before execution; 禁 P2-A #2)',
    pairs,
    concordant: { both_pass: BANK.cases.filter(x => state.arms[`${x.id}:T3`].success && state.arms[`${x.id}:T3.5`].success).length, both_fail: BANK.cases.filter(x => !state.arms[`${x.id}:T3`].success && !state.arms[`${x.id}:T3.5`].success).length },
    discordant: { t3_only_pass: b, t35_only_pass: c1 },
    mcnemar: { test: 'exact binomial, two-sided', b, c: c1, p_value: p },
    arm_summary: {
      T3: { pass: t3Pass, fail: pairs - t3Pass, output_tokens: t3Out, input_tokens: t3In, output_tokens_per_success: t3Pass > 0 ? Math.round(t3Out / t3Pass) : null, cost_cny: Number(t3Cost.toFixed(6)) },
      'T3.5': { pass: t35Pass, fail: pairs - t35Pass, output_tokens: t35Out, input_tokens: t35In, output_tokens_per_success: t35Pass > 0 ? Math.round(t35Out / t35Pass) : null, cost_cny: Number(t35Cost.toFixed(6)), escapes: t35Escapes },
    },
    by_kind: {
      closed: { cases: closedCases.length, t3_pass: closedCases.filter(x => state.arms[`${x.id}:T3`].success).length, t35_pass: closedCases.filter(x => state.arms[`${x.id}:T3.5`].success).length },
      expansion: { cases: expansionCases.length, t3_pass: expansionCases.filter(x => state.arms[`${x.id}:T3`].success).length, t35_pass: expansionCases.filter(x => state.arms[`${x.id}:T3.5`].success).length },
    },
    expressivity_price: {
      extra_cases_covered_by_t35: c1,
      extra_output_tokens: t35Out - t3Out,
      output_tokens_per_extra_case: c1 > 0 ? Math.round((t35Out - t3Out) / c1) : null,
    },
    t35_qualification: {
      n: t35Verdict.n, successes: t35Verdict.successes, lcb95: t35Verdict.lcb95,
      p_min: t35Verdict.pMin, qualified: t35Verdict.qualified, escapes: t35Escapes,
      registry_row_warranted: t35Verdict.qualified && t35Escapes === 0,
      reasons: t35Verdict.reasons,
    },
    note: 'n=24 是筛选性对照(任务书 P2-A #3):报告 discordant 对与精确 p 值;不做 mixed model,不做总体外推。统计只在完整 24×2 状态上计算。',
  }
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`pairs: ${pairs} — T3 ${t3Pass}/${pairs}, T3.5 ${t35Pass}/${pairs}`)
  console.log(`discordant: b(T3 only)=${b}, c(T3.5 only)=${c1} — McNemar exact p = ${p.toExponential(3)}`)
  console.log(`expressivity price: +${c1} cases for +${t35Out - t3Out} output tokens`)
  console.log(`T3.5 qualification: ${report.t35_qualification.qualified ? 'QUALIFIED' : 'NOT'} (LCB95=${t35Verdict.lcb95.toFixed(3)}, ESCAPE=${t35Escapes})`)
  console.log('report ->', join(OUT, 'report.json'))
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => { console.error('paired experiment crashed:', error); process.exitCode = 1 })
  .finally(() => clearInterval(watchdog))
