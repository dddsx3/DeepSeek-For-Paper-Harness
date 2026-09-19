/**
 * W10-MQUAL E2E 探针 1（v2）—— DP-4 配置发射契约的真实模型验证.
 *
 * 单变量：除 M-QUAL 落地的 teaching 行 + 配置捕获 + 闸扩展外，其余镜像既有
 * 生产链（资产预登记 → 容器接收 → 真实 node 子进程 → interpretation 铸造
 * → DRIFT 式重试 → 交付判定）。测量四件事：
 *   1. 模型是否服从 EXECUTE_PROTOCOL_TEACHING 的新行（声明并写出
 *      numeric_config.json）——形态 7 风险点的直接回答；
 *   2. 捕获是否把它物化为 canonical NumericConfig（run_ref 闭合）；
 *   3. config-consistency 的 C-2（声明↔实际）在真实数据上是否零发现；
 *   4. 含配置 store 的交付闸 verdict（与既有 9 门全链一起）。
 *
 * 运行：npx tsx --env-file=.env.local artifacts/handoff/W10-MQUAL/probe-e2e-config-capture.mts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { ModelingIr, sha256Hex, type IrKind } from '../../../packages/paper/paper-foundation/src/ir/index.ts'
import { produceContainerInto } from '../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'
import { produceRunExecution } from '../../../packages/paper/paper-foundation/src/produce/execution-producer.ts'
import { produceInterpretation } from '../../../packages/paper/paper-foundation/src/produce/interpretation-producer.ts'
import { normalizeInterpretationLocators } from '../../../packages/paper/paper-foundation/src/executor.ts'
import { configConsistencyFindings } from '../../../packages/paper/paper-foundation/src/delivery/config-consistency.ts'
import { buildDeliveryPolicy } from '../../../packages/paper/paper-foundation/src/delivery/gate-registry.ts'
import { evaluateDelivery } from '../../../packages/paper/paper-foundation/src/delivery/delivery-policy.ts'
import { gradeDelivery } from '../../../packages/paper/paper-foundation/src/delivery/delivery-grade.ts'
import { capabilityThresholdFindings } from '../../../packages/paper/paper-foundation/src/delivery/capability-thresholds.ts'
import { EXECUTE_PROTOCOL_TEACHING } from '../../../packages/paper/paper-foundation/src/executor.ts'

const base = (process.env.PAPER_PROBE_BASE_URL ?? '').replace(/\/$/, '')
const key = process.env.PAPER_PROBE_API_KEY ?? ''
const model = process.env.PAPER_PROBE_MODEL ?? 'deepseek/deepseek-v4-flash'
if (base === '' || key === '') throw new Error('PAPER_PROBE_BASE_URL / PAPER_PROBE_API_KEY are required')

const OUT = new URL('.', import.meta.url)
mkdirSync(new URL('./e2e-probe-1', OUT), { recursive: true })

const TASK = [
  '小型数值问题（单问）：',
  '用显式欧拉法解常微分方程 dy/dt = -k*y，其中 k = 0.35，初值 y(0) = 2.55。',
  '取时间步长 dt = 0.25，从 t=0 解到 t=2.0（共 8 步）。',
  '要求：把最终值 y(2.0) 写入输出文件 result.json 的 y_final 字段（JSON 数值，保留 6 位小数）。',
].join('\n')

const SYSTEM = EXECUTE_PROTOCOL_TEACHING
const USER = `${TASK}\n\nProduce the ir-container-v1 now, exactly as the protocol requires.`

// ---------------------------------------------------------------------------
// 1. 一次流式模型调用（线形完全镜像 real-provider.streamCompletion）
// ---------------------------------------------------------------------------

async function callModel(messages: ReadonlyArray<{ role: 'system' | 'user'; content: string }>): Promise<{ content: string; usage: Record<string, number> }> {
  const started = Date.now()
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      stream: true,
      max_tokens: 8000,
      reasoning_effort: 'none',
      stream_options: { include_usage: true },
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`provider http ${response.status}: ${detail.slice(0, 300)}`)
  }
  const raw = await response.text()
  writeFileSync(new URL(`./e2e-probe-1/raw-sse-${Date.now()}.txt`, OUT), raw)
  let content = ''
  const usage: Record<string, number> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>
        usage?: Record<string, number>
      }
      content += chunk.choices?.[0]?.delta?.content ?? ''
      if (chunk.usage !== undefined) Object.assign(usage, chunk.usage)
    } catch { /* keep-alive or partial line */ }
  }
  console.log(`[model] ${Date.now() - started}ms — in ${usage['prompt_tokens'] ?? '?'} tok / out ${usage['completion_tokens'] ?? '?'} tok, content ${content.length} chars`)
  return { content, usage }
}

// ---------------------------------------------------------------------------
// 2. 单次全链尝试（fresh store；容器 → 真实执行 → interpretation 铸造）
// ---------------------------------------------------------------------------

interface ChainOutcome {
  readonly ir: ModelingIr
  readonly runId: string
  readonly entries: ReadonlyArray<{ kind: IrKind; id: string }>
  readonly outputs: ReadonlyArray<{ locator: string; bytes: string }>
  readonly mintedResults: ReadonlyArray<string>
  readonly mintedClaims: ReadonlyArray<string>
  readonly hadFigures: boolean
}

async function tryChain(text: string): Promise<{ stage: string; reason: string } | ChainOutcome> {
  const ir = new ModelingIr()
  const problemHash = `sha256:${sha256Hex(TASK)}`
  for (const [kind, value] of [
    ['DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problems/probe-w10/task.md', content_hash: problemHash, media_type: 'text/markdown', description: TASK.slice(0, 512) }],
    ['RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: '给出 y(2.0) 的数值结果' }],
    ['ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] }],
  ] as const) {
    const v = ir.put(kind, value as Record<string, unknown>)
    if (!v.accepted) throw new Error(`asset registration refused (${kind})`)
  }

  const admitted = produceContainerInto(ir, text)
  if (!admitted.ok) return { stage: 'container', reason: `${admitted.code}: ${admitted.reason}` }

  const parsed = JSON.parse(text) as {
    run?: Record<string, unknown>
    code?: string
    interpretations?: unknown
  }
  const basenames = (parsed.run?.outputBasenames as string[] | undefined) ?? []
  const runId = 'RUN-PROBE-W10'
  const modelRef = (parsed as { entries?: Array<{ kind: string; value: Record<string, unknown> }> })
    .entries?.find(e => e.kind === 'ModelSpec')?.value.model_id as string ?? 'M1'
  const runVerdict = await produceRunExecution({
    ir,
    runId,
    modelRef,
    codeText: parsed.code ?? '',
    environment: 'paper-shell v0 (node 24)',
    seed: typeof parsed.run?.seed === 'number' ? parsed.run.seed : null,
    outputBasenames: basenames,
    outputLocators: basenames.map(b => `file:///runs/${runId}/${b}`),
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 60_000,
  })
  if (!runVerdict.ok) return { stage: 'run', reason: `${runVerdict.code}: ${runVerdict.reason}` }

  let mintedResults: ReadonlyArray<string> = []
  let mintedClaims: ReadonlyArray<string> = []
  let hadFigures = false
  if (parsed.interpretations !== undefined) {
    const norm = normalizeInterpretationLocators(
      parsed.interpretations as Record<string, unknown>,
      basenames,
      runVerdict.outputs.map(o => o.locator),
    )
    if (!norm.ok) return { stage: 'interpretation', reason: `${norm.code}: ${norm.reason}` }
    const iv = produceInterpretation({
      ir,
      runId,
      interpretations: norm.value,
      outputs: runVerdict.outputs.map(o => ({ locator: o.locator, bytes: o.bytes })),
    })
    if (!iv.ok) return { stage: 'interpretation', reason: `${iv.code}: ${iv.reason}` }
    mintedResults = iv.resultIds
    mintedClaims = iv.claimIds
    hadFigures = iv.figures.length > 0
  }

  return {
    ir,
    runId,
    entries: admitted.entries,
    outputs: runVerdict.outputs.map(o => ({ locator: o.locator, bytes: o.bytes })),
    mintedResults,
    mintedClaims,
    hadFigures,
  }
}

// ---------------------------------------------------------------------------
// 3. DRIFT 式重试循环（镜像 executor 的 guided retry：拒绝原因回灌）
// ---------------------------------------------------------------------------

let stage = 'container'
let refusal = ''
let winner: ChainOutcome | null = null
let lastUsage: Record<string, number> = {}
let attemptsUsed = 0
for (let attempt = 1; attempt <= 3 && winner === null; attempt += 1) {
  attemptsUsed = attempt
  const messages = attempt === 1
    ? [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: USER }]
    : [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: USER },
       { role: 'user' as const, content: `Your previous container was REFUSED at the '${stage}' stage: ${refusal}\n\nProduce ONE corrected ir-container-v1 JSON object only — no prose, no markdown fences, and fix exactly the named problem.` }]
  const { content, usage } = await callModel(messages)
  lastUsage = usage
  writeFileSync(new URL(`./e2e-probe-1/model-output.attempt${attempt}.txt`, OUT), content)
  const outcome = await tryChain(content)
  if (!('stage' in outcome)) {
    winner = outcome
    console.log(`[chain] attempt ${attempt} PASSED — entries: ${outcome.entries.map(e => `${e.kind}:${e.id}`).join(', ')}`)
  } else {
    stage = outcome.stage
    refusal = outcome.reason
    console.log(`[refusal@${stage}] attempt ${attempt}: ${outcome.reason.slice(0, 240)}`)
  }
}
if (winner === null) {
  console.log('E2E-PROBE VERDICT: FAILED_AFTER_RETRIES (DRIFT 预算耗尽)')
  process.exit(4)
}

// ---------------------------------------------------------------------------
// 4. 测量点
// ---------------------------------------------------------------------------

const snapshot = ModelingIr.snapshot(winner.ir)
if (snapshot === null) throw new Error('store snapshot failed')

const records = [...snapshot.values()].filter(r => r.kind === 'ExecutionRecord')
console.log(`[m-qual] ExecutionRecord committed: ${records.length} (expect 1)`)

const configs = [...snapshot.values()].filter(r => r.kind === 'NumericConfig')
console.log(`[m-qual] NumericConfig captured: ${configs.length}`)
for (const record of configs) {
  const config = record.value as { config_id: string; run_ref: string; discretization: Array<{ symbol_ref: string; value: number }>; physical: Array<{ symbol_ref: string; value: number }>; property_set: string | null }
  console.log(`  - ${config.config_id} (run ${config.run_ref}): discretization=${JSON.stringify(config.discretization)} physical=${JSON.stringify(config.physical)} property_set=${config.property_set}`)
}

const configFindings = configConsistencyFindings(snapshot)
console.log(`[m-qual] config-consistency findings: ${configFindings.length}`)
for (const finding of configFindings) console.log(`  - ${finding.kind} @ ${finding.field}: ${finding.reason.slice(0, 220)}`)

const capFindings = capabilityThresholdFindings(snapshot)
console.log(`[m-qual] capability-threshold findings: ${capFindings.length} (本探针未注入 CapabilitySpec — 期望 0)`)

const policy = buildDeliveryPolicy({ mode: 'fast', ir: winner.ir, runtimeProfileValid: true })
const decision = evaluateDelivery(policy)
// The real executor derives emptyContent from the RENDERED REPORT body; this
// probe does not render one, so the fatal probe is not consulted (documented:
// the meaningful verdict here is the nine-gate `decision.allowed`).
const graded = gradeDelivery(decision.failures, {
  emptyContent: false,
  executionFailed: false,
  referenceCatastrophe: false,
}, {})
console.log(`[delivery] decision.allowed=${decision.allowed} grade=${graded.grade}`)
for (const failure of decision.failures) console.log(`  - ${failure.kind}: ${failure.reason.slice(0, 200)}`)

writeFileSync(new URL('./e2e-probe-1/probe-verdict.json', OUT), JSON.stringify({
  model,
  usage: lastUsage,
  attempts_used: attemptsUsed,
  entries: winner.entries,
  run_outputs: winner.outputs.map(o => o.locator),
  minted_results: winner.mintedResults,
  minted_claims: winner.mintedClaims,
  numeric_configs: configs.length,
  config_consistency_findings: configFindings,
  capability_threshold_findings: capFindings,
  delivery_decision: { allowed: decision.allowed, failures: decision.failures },
  grade: graded.grade,
}, null, 2))
console.log('E2E-PROBE VERDICT: OK')
