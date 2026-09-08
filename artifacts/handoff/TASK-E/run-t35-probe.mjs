#!/usr/bin/env node
/**
 * TASK-P1D real probe — can a real weak model DRIVE the T3.5 machine?
 *
 * The unit suite proves the machine's invariants; this probe asks whether
 * z-ai/glm-5.3-free (already QUALIFIED at T3) can operate one level up:
 * presented with the T3.5 move protocol (three moves, digit-free candidate
 * ids, expansion budget), does the model
 *
 *   a) find the novel case unanswerable from the static pool and
 *      REQUEST_EXPANSION legally (closed reason codes),
 *   b) echo a digit-free SELECT of a harness-minted id,
 *   c) never emit an invented move / digit / free object (ESCAPE = 0)?
 *
 * Strictly serial (relay key discipline), 5 rounds × the novel-case problem.
 * The atomic generation step is HARNESS-side here (admitExpansion validates
 * the deterministic proposal) — the model's burden is the MOVE protocol,
 * which is the research question. Success = the machine closes every round
 * with either SELECT or ABSTAIN, zero ESCAPE refusals.
 *
 * SKIPPED without a key (禁7).
 *
 * @module artifacts/handoff/TASK-E/run-t35-probe
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { ExpandSelectSession, seedCandidates } from '../../../packages/paper/paper-foundation/src/produce/expand-select.ts'

const here = dirname(fileURLToPath(import.meta.url))
// Archive per model (see run-p1c-probe).
const PROBE_MODEL = process.env.PAPER_PROBE_MODEL ?? 'z-ai/glm-5.3-flash'
const OUT = join(here, 'output-t35', PROBE_MODEL.replace(/[^A-Za-z0-9._-]+/g, '-'))
const sleep = ms => new Promise(done => setTimeout(done, ms))

/** The T3.5 move-protocol lecture (the teaching face of this tier). */
function t35Teaching(pool) {
  return [
    'You are answering a modelling question through a CLOSED choice machine. Reply with exactly ONE JSON object and nothing else — no prose, no markdown fences.',
    'The ONLY legal moves (any other reply is a violation):',
    '  {"action":"SELECT","candidate_id":"<one of the listed ids>"} — choose one candidate from the pool.',
    '  {"action":"REQUEST_EXPANSION","slot":"json_path|unit|assumption","reason":"NO_VALID_CANDIDATE|SEMANTIC_MISMATCH|DOMAIN_NOT_COVERED"} — the pool cannot answer the question.',
    '  {"action":"ABSTAIN","reason":"NOT_ADDRESSABLE|INSUFFICIENT_INFORMATION"} — decline honestly.',
    'HARD RULES: never write a digit anywhere in your reply; never invent a candidate id or a fourth action; ids are copied verbatim from the pool.',
    'DECISION RULE: SELECT only when a listed candidate ACTUALLY answers the question. If the question asks for something the pool does not contain, you MUST REQUEST_EXPANSION for that slot (reason NO_VALID_CANDIDATE) — choosing a near-miss candidate is a wrong answer.',
    `The candidate pool: ${pool.map(c => `${c.id} (${c.slot} = ${c.value})`).join('; ')}.`,
  ].join('\n')
}

/** Serial provider call with 429/5xx/network backoff (undici timeouts included). */
async function callProvider(baseUrl, apiKey, model, prompt, attempt = 1) {
  let response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
    })
  } catch (networkError) {
    // undici-level faults (headers timeout, ECONNRESET, …) carry no status;
    // treat the whole family as retryable transport, same backoff budget.
    if (attempt < 6) {
      await sleep(Math.min(2_000 * 2 ** (attempt - 1), 60_000))
      return callProvider(baseUrl, apiKey, model, prompt, attempt + 1)
    }
    throw networkError
  }
  if (!response.ok) {
    const status = response.status
    if ((status === 0 || status === 429 || status >= 500) && attempt < 6) {
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

async function main() {
  const apiKey = process.env.PAPER_PROBE_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
  const baseUrl = (process.env.PAPER_PROBE_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? '').replace(/\/$/, '')
  const model = PROBE_MODEL
  const NOVEL = 'Estimate the seasonal snow depth on the ice.'
  const ROUNDS = 5

  const summary = {
    generated_at: new Date().toISOString(),
    probe: 'TASK-P1D real probe — can a real weak model drive the T3.5 machine',
    endpoint: baseUrl,
    model,
    rounds: null,
  }

  if (apiKey.length === 0 || baseUrl.length === 0) {
    summary.rounds = { status: 'SKIPPED', reason: 'no provider key/base URL — no silent PASS (禁7)' }
    console.log('real section: SKIPPED (no key)')
  } else {
    const rounds = []
    const trail = []
    const writeTrail = async () => writeFile(join(OUT, 'records.jsonl'), trail.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    let escapeTotal = 0
    let tokensIn = 0
    let tokensOut = 0
    for (let round = 1; round <= ROUNDS; round += 1) {
      const session = new ExpandSelectSession()
      const steps = []
      let outcome = 'UNRESOLVED'
      let usage = undefined
      // The machine loop: up to 4 model moves per round (selects close it).
      for (let move = 1; move <= 4 && !session.committed; move += 1) {
        const teaching = t35Teaching(session.pool())
        const call = await callProvider(baseUrl, apiKey, model, [teaching, `Problem: ${NOVEL}`].join('\n\n'))
        usage = call.usage
        const verdict = session.admitMove(call.text.trim())
        steps.push({
          move,
          raw_head: call.text.trim().slice(0, 120),
          verdict: verdict.ok
            ? { ok: true, kind: verdict.kind, ...(verdict.kind === 'select' ? { candidate: verdict.candidate.id } : {}) }
            : { ok: false, code: verdict.code, reason: verdict.reason.slice(0, 160) },
        })
        const isEscape = !verdict.ok && (verdict.code === 't35_number_forbidden' || verdict.code === 't35_move_forbidden')
        if (isEscape) escapeTotal += 1
        if (!verdict.ok) { outcome = verdict.code; break }
        if (verdict.kind === 'select') { outcome = 'SELECTED'; break }
        if (verdict.kind === 'abstain') { outcome = 'ABSTAINED'; break }
        // expansion-request → harness generates the deterministic candidate
        // (the novel snow_depth for json_path; validator refuses duplicates).
        const proposal = verdict.slot === 'json_path' ? 'snow_depth'
          : verdict.slot === 'unit' ? 'pascal'
            : 'isothermal column'
        const granted = session.admitExpansion(verdict.slot, proposal)
        steps.push({ harness_expansion: granted.ok ? { ok: true, candidate: granted.candidate.id, slot: verdict.slot } : { ok: false, code: granted.code, reason: granted.reason.slice(0, 120) } })
        if (!granted.ok) { outcome = granted.code; break }
      }
      if (session.committed) outcome = 'SELECTED'
      else if (outcome === 'UNRESOLVED') outcome = 'MOVE_BUDGET_EXHAUSTED'
      if (usage !== undefined) {
        tokensIn += usage.prompt_tokens ?? 0
        tokensOut += usage.completion_tokens ?? 0
      }
      rounds.push({ round, outcome, committed: session.committed, steps })
      trail.push({
        model,
        endpoint: baseUrl,
        attempt: round,
        problem_hash: createHash('sha256').update(NOVEL, 'utf8').digest('hex').slice(0, 16),
        outcome,
        stage: 'moves',
        failure_class: outcome === 'SELECTED' ? 'SUCCESS' : outcome,
        moves: steps.length,
        usage: usage === undefined ? null : { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 },
      })
      await writeTrail()
      console.log(`  round ${round}: ${outcome}${session.committed ? ' (committed)' : ''}`)
      if (round < ROUNDS) await sleep(1_500)
    }
    const selected = rounds.filter(r => r.outcome === 'SELECTED').length
    summary.rounds = {
      status: 'COMPLETED',
      target: ROUNDS,
      novel_problem: NOVEL,
      selected,
      abstained: rounds.filter(r => r.outcome === 'ABSTAINED').length,
      escape_total: escapeTotal,
      rounds,
      usage: { input_tokens: tokensIn, output_tokens: tokensOut },
      verdict: escapeTotal === 0
        ? 'ZERO ESCAPE — the model operated the move protocol without a single violation'
        : `${escapeTotal} ESCAPE refusals — see steps`,
    }
    console.log(`real section: COMPLETED — selected ${selected}/${ROUNDS}, ESCAPE ${escapeTotal}`)
    console.log(`verdict: ${summary.rounds.verdict}`)
  }

  mkdirSync(OUT, { recursive: true })
  await mkdir(OUT, { recursive: true })
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log('probe output ->', OUT)
}

const watchdog = setInterval(() => { /* keep alive */ }, 30_000)
main()
  .catch((error) => { console.error('t35 probe crashed:', error); process.exitCode = 1 })
  .finally(() => clearInterval(watchdog))
