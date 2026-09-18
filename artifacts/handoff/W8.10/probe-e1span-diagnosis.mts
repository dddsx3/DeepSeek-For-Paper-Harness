/**
 * W8.10-D3 — the `e1_span` ROOT-CAUSE probe (read-only, real API).
 *
 * 问题（本轮唯一要回答的）：真实运行（2024-B，`deepseek/deepseek-v4-flash`）
 * 三次尝试全部因 B3 正向失败——`checkE1E2Fidelity` 报 "e1_span 在 E1 中找不到
 * 逐字匹配（疑似改写）"。而该检查是**裸的 `String.includes`**，没有任何空白/
 * 标点归一化。所以两种可能：
 *
 *   (甲) 模型真的改写了 span（模型能力问题）；
 *   (乙) 只差空白/换行/全角半角/markdown 强调符号（harness 机械不匹配问题）。
 *
 * 这个区分决定修法完全不同，而**现有三次真实运行没有留存 E1 全文与 E2 容器**
 * （审计轨迹只记了 `chars: 4113` / `chars: 11818`），事后无法核验。本探针
 * 因此做两件事：
 *
 *   1. 真的重跑一次 E1→E2（真实 prompt、真实模型、`reasoning_effort=none`），
 *      把 E1 全文、E2 容器全文、逐条比对表**全部落盘**，补上归档缺口；
 *   2. 对每个 `e1_span` 做**多级比对**（精确 / 空白归一化 / 标点归一化 /
 *      相似度 + diff 摘要），把"疑似改写"这个笼统判定拆成可核验的类别。
 *
 * 另外把仓库里已存档的一份真实 E1 全文（`probe-b4-e1-reasoning-output.txt`
 * 的 A arm，`reasoning_effort=none`）也喂给真实的 E2，得到**第二份样本**——
 * 这样"E1 侧采样方差"不会成为唯一解释，两个样本各自独立出结论。
 *
 * 红线：只探测，不改 `packages/` 与 `apps/`。本文件在 `artifacts/` 下。
 * 绝不打印或落盘 API key。
 *
 * 用法：
 *   ./node_modules/.bin/tsx artifacts/handoff/W8.10/probe-e1span-diagnosis.mts
 *
 * 模型：`PAPER_D3_MODEL` 覆盖，默认目标模型 `deepseek/deepseek-v4-flash`
 * （`.env.local` 的 `PAPER_PROBE_MODEL` 是 `z-ai/glm-5.3-flash`，不是目标模型，
 * 本探针**不读**它）。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleBundle } from '../../../apps/paper-shell/src/bundle.ts'
import { classifyProblem, routeBanner } from '../../../apps/paper-shell/src/route.ts'
import { contractBanner } from '../../../apps/paper-shell/src/contracts/index.ts'
import { renderSections } from '../../../packages/paper/paper-foundation/src/context.ts'
import { EXECUTE_PROTOCOL_TEACHING } from '../../../packages/paper/paper-foundation/src/executor.ts'
import {
  MIN_E1_SPAN_CHARS,
  checkE1E2Fidelity,
  e1AnalysisInstruction,
  e2NormalizationPrompt,
  parseE1Anchors,
} from '../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const outDir = join(here, 'probe-e1span-diagnosis-output')

function loadDotEnvLocal(): void {
  let text = ''
  try {
    text = readFileSync(join(repoRoot, '.env.local'), 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim()
  }
}

/** The production adapter's own executor system prompt (executor.ts:401). */
const EXECUTOR_SYSTEM = 'You are a careful task executor. Produce complete, correct output for the given task. Be concise.'
/** The harness's registered requirement id (executor.ts:947/975). */
const REQUIRED_IDS = ['R-OUT']
const MAX_TOKENS = Number(process.env.PAPER_D3_MAX_TOKENS ?? '24000')
/**
 * E2's own budget. Separate from E1's because the two have measured, very
 * different appetites: E2 re-emits every SymbolSpec the analysis implies, and
 * on the archived E1 it exceeded 24k tokens having emitted 230 SymbolSpecs
 * and not yet reached the first AssumptionSpec. 65536 is the relay's
 * measured hard ceiling (B4 probe, HTTP 400 above it).
 */
const E2_MAX_TOKENS = Number(process.env.PAPER_D3_E2_MAX_TOKENS ?? '65536')
const REUSE = process.env.PAPER_D3_REUSE === '1'
/**
 * How many FRESH E1→E2 pairs to run. Each pair is an independent sample of the
 * model's behaviour, so the mechanical-vs-rewrite ratio can be checked for
 * stability rather than asserted from one draw. `temperature=0.2` means the
 * pairs genuinely differ (the B4 probe measured anchor counts of 11 vs 18
 * across two `none`-arm runs of the same prompt).
 */
const FRESH_SAMPLES = Math.max(1, Number(process.env.PAPER_D3_FRESH_SAMPLES ?? '1'))
/** Safety valve only. Measured on this relay: one E1 call ran 310 s. */
const CALL_TIMEOUT_MS = Number(process.env.PAPER_D3_TIMEOUT_MS ?? '1800000')

interface CallResult {
  readonly label: string
  readonly status: number
  readonly content: string
  readonly reasoningChars: number
  readonly finishReason: string | null
  readonly inBandError: string | null
  readonly promptTokens: number
  readonly completionTokens: number
  readonly reasoningTokens: number | undefined
  readonly elapsedMs: number
  readonly transportError: string | null
}

/** One real streaming call; accumulates content and reasoning channels. */
async function callOnce(
  label: string,
  base: string,
  key: string,
  model: string,
  prompt: string,
  extra: Record<string, unknown>,
): Promise<CallResult> {
  const started = Date.now()
  let status = 0
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  let inBandError: string | null = null
  let promptTokens = 0
  let completionTokens = 0
  let reasoningTokens: number | undefined
  let transportError: string | null = null
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: EXECUTOR_SYSTEM },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        stream: true,
        max_tokens: MAX_TOKENS,
        stream_options: { include_usage: true },
        ...extra,
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    status = r.status
    if (!r.ok || r.body === null) {
      const excerpt = (await r.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ')
      transportError = `HTTP ${r.status}: ${excerpt}`
    } else {
      const reader = r.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '')
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf('\n')
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '' || data === '[DONE]') continue
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ finish_reason?: string | null; delta?: { content?: string; reasoning_content?: string } }>
              usage?: {
                prompt_tokens?: number
                completion_tokens?: number
                completion_tokens_details?: { reasoning_tokens?: number }
              }
              error?: { message?: string }
            }
            if (chunk.error !== undefined) inBandError = chunk.error.message ?? 'error'
            if (chunk.usage !== undefined) {
              promptTokens = chunk.usage.prompt_tokens ?? promptTokens
              completionTokens = chunk.usage.completion_tokens ?? completionTokens
              reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens
            }
            const reason = chunk.choices?.[0]?.finish_reason
            if (typeof reason === 'string') finishReason = reason
            const d = chunk.choices?.[0]?.delta
            if (typeof d?.content === 'string' && d.content.length > 0) content += d.content
            if (typeof d?.reasoning_content === 'string' && d.reasoning_content.length > 0) reasoning += d.reasoning_content
          } catch {
            /* a non-JSON keep-alive line is not a protocol error */
          }
        }
      }
    }
  } catch (e) {
    transportError = `THREW ${(e as Error).message}`
  }
  return {
    label,
    status,
    content,
    reasoningChars: reasoning.length,
    finishReason,
    inBandError,
    promptTokens,
    completionTokens,
    reasoningTokens,
    elapsedMs: Date.now() - started,
    transportError,
  }
}

// ---------------------------------------------------------------------------
// The multi-level comparator.
//
// The harness's own check is level (a): a bare `String.includes`. The levels
// below it are ordered by how much they give up, so a span's category names
// exactly what would have to be tolerated for it to pass.
// ---------------------------------------------------------------------------

/** (b) whitespace-only: collapse every whitespace run to one space, trim. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** (b2) whitespace-only, stronger: remove ALL whitespace (line joins included). */
function stripAllWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * (c) typographic: Unicode punctuation/width/emphasis folded to a canonical
 * half-width ASCII form. **No letter or digit is ever changed** — so a span
 * that matches here differs from E1 only in how the same characters were
 * rendered, not in what they say.
 */
function normalizeTypographic(text: string): string {
  return normalizeWhitespace(text)
    // dashes / minus signs -> ASCII hyphen
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g, '-')
    // curly quotes -> straight
    .replace(/[\u2018\u2019\u201A\u201B\u2032\uFF07]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\uFF02]/g, '"')
    // full-width CJK punctuation -> ASCII
    .replace(/\uFF08/g, '(').replace(/\uFF09/g, ')')
    .replace(/\uFF0C/g, ',').replace(/\uFF1B/g, ';')
    .replace(/\uFF1A/g, ':').replace(/\uFF1F/g, '?').replace(/\uFF01/g, '!')
    .replace(/\u3002/g, '.').replace(/\uFF0E/g, '.')
    .replace(/\u3001/g, ',').replace(/\uFF05/g, '%')
    .replace(/\uFF3B/g, '[').replace(/\uFF3D/g, ']')
    .replace(/\uFF5B/g, '{').replace(/\uFF5D/g, '}')
    .replace(/\uFF1D/g, '=').replace(/\uFF0B/g, '+').replace(/\uFF0F/g, '/')
    .replace(/\uFF1C/g, '<').replace(/\uFF1E/g, '>')
    .replace(/\uFF06/g, '&').replace(/\uFF0A/g, '*')
    // markdown emphasis / code markers (E1 is Markdown; a re-typed span may drop them)
    .replace(/[*_`~]/g, '')
    // markdown math delimiters: `$$…$$` (display) and `$…$` (inline) denote the
    // same math — a span that switches one for the other is a rendering change,
    // not a content change. Runs are folded to a single `$`; nothing between
    // the delimiters is touched.
    .replace(/\$+/g, '$')
    // invisible characters
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** (c2) typographic + all whitespace removed. */
function normalizeTypographicTight(text: string): string {
  return stripAllWhitespace(normalizeTypographic(text))
}

/** Longest common substring, rolling-row DP. Returns the length and offsets. */
function longestCommonSubstring(
  a: string,
  b: string,
): { length: number; aStart: number; bStart: number } {
  if (a.length === 0 || b.length === 0) return { length: 0, aStart: -1, bStart: -1 }
  let prev = new Uint32Array(b.length + 1)
  let cur = new Uint32Array(b.length + 1)
  let best = 0
  let bestA = -1
  let bestB = -1
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        const v = prev[j - 1]! + 1
        cur[j] = v
        if (v > best) {
          best = v
          bestA = i - v
          bestB = j - v
        }
      } else {
        cur[j] = 0
      }
    }
    const t = prev
    prev = cur
    cur = t
    cur.fill(0)
  }
  return { length: best, aStart: bestA, bStart: bestB }
}

/** The first index at which two strings differ (or min length when one is a prefix). */
function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i
  return n
}

/** A `±24` character window around `at`, with the index marked. */
function window(text: string, at: number, radius = 24): string {
  const from = Math.max(0, at - radius)
  const to = Math.min(text.length, at + radius)
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\n/g, '⏎')}${to < text.length ? '…' : ''}`
}

/** One character's difference, rendered for the report (never the API key). */
function charDiff(a: string | undefined, b: string | undefined): string {
  if (a === undefined) return `E1 侧无字符（span 多出 ${JSON.stringify(b)}）`
  if (b === undefined) return `span 侧无字符（E1 多出 ${JSON.stringify(a)}）`
  const name = (ch: string): string => {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0x0a) return '\\n(LF)'
    if (cp === 0x0d) return '\\r(CR)'
    if (cp === 0x20) return 'space'
    if (cp === 0x09) return '\\t(TAB)'
    if (cp === 0xa0) return 'U+00A0(NBSP)'
    if (cp === 0x3000) return 'U+3000(全角空格)'
    if (cp >= 0x3000 && cp <= 0x303f) return `${JSON.stringify(ch)} (U+${cp.toString(16).toUpperCase()}, CJK 标点)`
    if (cp >= 0xff00 && cp <= 0xffef) return `${JSON.stringify(ch)} (U+${cp.toString(16).toUpperCase()}, 全角)`
    if (cp >= 0x2010 && cp <= 0x2015) return `${JSON.stringify(ch)} (U+${cp.toString(16).toUpperCase()}, 破折号/连字符)`
    if (cp === 0x2212) return `${JSON.stringify(ch)} (U+2212, 数学减号)`
    return `${JSON.stringify(ch)} (U+${cp.toString(16).toUpperCase()})`
  }
  return `${name(a)}  ←→  ${name(b)}`
}

/**
 * How much of `span` survives in `e1` once BOTH sides are folded to the
 * canonical form, measured as the fraction of the span's 8-character sliding
 * windows that occur anywhere in E1.
 *
 * Why 8-grams and not just the longest common substring: a single LCS is
 * brittle — one inserted word splits the span and halves the score, which is
 * exactly what a typographic difference looks like. Gram coverage is the
 * honest "how much of this text is present verbatim" number, and it separates
 * the two hypotheses cleanly: a rendering difference keeps most 8-grams, a
 * paraphrase keeps few.
 */
function gramCoverage(spanFolded: string, e1Folded: string, gram = 8): number {
  if (spanFolded.length < gram) return spanFolded.length > 0 && e1Folded.includes(spanFolded) ? 1 : 0
  let hit = 0
  let total = 0
  for (let i = 0; i + gram <= spanFolded.length; i += 1) {
    total += 1
    if (e1Folded.includes(spanFolded.slice(i, i + gram))) hit += 1
  }
  return total === 0 ? 0 : Math.round((hit / total) * 1000) / 1000
}

/** How a span matched, ordered from strictest to loosest. */
type MatchLevel = 'missing' | 'too-short' | 'exact' | 'whitespace' | 'whitespace-tight' | 'typographic' | 'typographic-tight' | 'rewritten'

interface SpanDiagnosis {
  readonly id: string
  readonly kind: string
  readonly spanChars: number
  readonly span: string
  readonly level: MatchLevel
  readonly harnessVerdict: string
  /** Where the span lands in E1 under the loosest matching level. */
  readonly e1MatchWindow: string | null
  /**
   * The decisive number: 8-gram coverage of the span inside E1, both sides
   * folded to the canonical (whitespace + typographic) form. ~1 means the
   * text IS there; near 0 means it is genuinely different text.
   */
  readonly gramCoverageFolded: number
  /** The same, on the RAW text (no folding) — the "how far apart are they" number. */
  readonly gramCoverageRaw: number
  /** Longest common substring / span length, on the folded text. */
  readonly lcsRatioFolded: number
  /** Longest common substring / span length, on the raw text. */
  readonly lcsRatioRaw: number
  readonly lcsLength: number
  /** index of the first differing character inside the first 80 chars */
  readonly firstDiffIndexIn80: number
  readonly firstDiffSummary: string
  readonly firstDiffSpanWindow: string
  readonly firstDiffE1Window: string
  /** The closest single E1 line, by LCS, when nothing matched. */
  readonly closestE1Line: string | null
  readonly closestE1LineSimilarity: number
  /** Plain-language reading of the numbers above. */
  readonly reading: string
}

function diagnoseSpan(
  id: string,
  kind: string,
  spanRaw: unknown,
  e1Text: string,
): SpanDiagnosis {
  const span = typeof spanRaw === 'string' ? spanRaw : ''
  const trimmed = span.trim()
  const e1Ws = normalizeWhitespace(e1Text)

  // The harness's own check, reproduced verbatim (e1-e2.ts:249-259).
  let harnessVerdict: string
  if (typeof spanRaw !== 'string' || trimmed.length === 0) harnessVerdict = '未声明 e1_span'
  else if (trimmed.length < MIN_E1_SPAN_CHARS) harnessVerdict = `e1_span 过短（${trimmed.length} < ${MIN_E1_SPAN_CHARS}）`
  else if (!e1Text.includes(trimmed)) harnessVerdict = 'e1_span 在 E1 中找不到逐字匹配（疑似改写）'
  else harnessVerdict = 'PASS'

  // --- level (a): exact, as the harness does it --------------------------
  //
  // The three harness messages are kept as SEPARATE categories. Conflating
  // them is what made the original "疑似改写" verdict unreadable: an entry
  // with NO span and an entry whose span is a paraphrase produce the same
  // bucket in a naive report, but they need opposite fixes.
  let level: MatchLevel = 'rewritten'
  let windowAt: string | null = null
  if (typeof spanRaw !== 'string' || trimmed.length === 0) {
    level = 'missing'
  } else if (trimmed.length < MIN_E1_SPAN_CHARS) {
    level = 'too-short'
  } else if (e1Text.includes(trimmed)) {
    level = 'exact'
    windowAt = window(e1Text, e1Text.indexOf(trimmed))
  } else {
    // --- level (b): whitespace only -------------------------------------
    const spanWs = normalizeWhitespace(trimmed)
    if (spanWs.length > 0 && e1Ws.includes(spanWs)) {
      level = 'whitespace'
      windowAt = window(e1Ws, e1Ws.indexOf(spanWs))
    } else {
      // --- level (b2): whitespace only, tighter (all whitespace removed) --
      const e1Tight = stripAllWhitespace(e1Text)
      const spanTight = stripAllWhitespace(trimmed)
      if (spanTight.length > 0 && e1Tight.includes(spanTight)) {
        level = 'whitespace-tight'
        windowAt = window(e1Tight, e1Tight.indexOf(spanTight))
      } else {
        // --- level (c): typographic fold ---------------------------------
        const e1Typo = normalizeTypographic(e1Text)
        const spanTypo = normalizeTypographic(trimmed)
        if (spanTypo.length > 0 && e1Typo.includes(spanTypo)) {
          level = 'typographic'
          windowAt = window(e1Typo, e1Typo.indexOf(spanTypo))
        } else {
          const e1TypoTight = normalizeTypographicTight(e1Text)
          const spanTypoTight = normalizeTypographicTight(trimmed)
          if (spanTypoTight.length > 0 && e1TypoTight.includes(spanTypoTight)) {
            level = 'typographic-tight'
            windowAt = window(e1TypoTight, e1TypoTight.indexOf(spanTypoTight))
          }
        }
      }
    }
  }

  // --- level (d): similarity, measured BOTH folded and raw --------------
  const spanWs = normalizeWhitespace(trimmed)
  const spanFolded = normalizeTypographic(trimmed)
  const e1Folded = normalizeTypographic(e1Text)

  const lcsFolded = longestCommonSubstring(spanFolded, e1Folded)
  const lcsRatioFolded = spanFolded.length === 0 ? 0 : Math.round((lcsFolded.length / spanFolded.length) * 1000) / 1000
  const lcsRaw = longestCommonSubstring(spanWs, e1Ws)
  const lcsRatioRaw = spanWs.length === 0 ? 0 : Math.round((lcsRaw.length / spanWs.length) * 1000) / 1000
  const gramCoverageFolded = gramCoverage(spanFolded, e1Folded)
  const gramCoverageRaw = gramCoverage(spanWs, e1Ws)

  // Align on the RAW text (the LCS there is the honest anchor: a folded match
  // could land on a coincidence produced by the folding itself), then diff
  // character by character so the reader sees the exact first divergence.
  const align = lcsRaw.bStart - lcsRaw.aStart
  const e1From = Math.max(0, align)
  const spanFrom = Math.max(0, -align)
  const spanTail = spanWs.slice(spanFrom)
  const e1Tail = e1Ws.slice(e1From)
  const diffAt = firstDifference(spanTail, e1Tail)
  const firstDiffIndexIn80 = Math.min(diffAt, 80)
  // An absent span has nothing to diff against; saying "differs at char 1"
  // would be a true sentence that answers a question nobody asked.
  const summary =
    spanWs.length === 0
      ? '(无 span，无 diff 可比)'
      : spanTail === e1Tail
        ? '整段逐字相同（差异仅在其前后）'
        : `对齐后前 ${diffAt} 字符一致，第 ${diffAt + 1} 个字符起不同：${charDiff(e1Tail[diffAt], spanTail[diffAt])}`
  const firstDiffSpanWindow = spanWs.length === 0
    ? '(无 span)'
    : diffAt < spanTail.length ? window(spanTail, diffAt) : '(span 在该处已结束)'
  const firstDiffE1Window = spanWs.length === 0
    ? '(无 span)'
    : diffAt < e1Tail.length ? window(e1Tail, diffAt) : '(E1 在该处已结束)'

  // --- the closest E1 line (diagnostic aid for genuine rewrites) --------
  let closestE1Line: string | null = null
  let closestSim = 0
  if (level === 'rewritten') {
    for (const line of e1Text.split('\n')) {
      const l = normalizeWhitespace(line)
      if (l.length === 0) continue
      const m = longestCommonSubstring(spanWs, l)
      const s = spanWs.length === 0 ? 0 : m.length / spanWs.length
      if (s > closestSim) {
        closestSim = s
        closestE1Line = l.length > 200 ? `${l.slice(0, 200)}…` : l
      }
    }
  }

  // --- the plain-language reading ---------------------------------------
  const reading = level === 'missing'
    ? '该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）'
    : level === 'too-short'
      ? 'e1_span 长度不足 MIN_E1_SPAN_CHARS（不是改写，是长度约束未满足）'
      : level === 'exact'
        ? '逐字命中，harness 的裸 includes 本应通过'
        : level === 'whitespace' || level === 'whitespace-tight'
          ? '仅空白/换行差异：字符序列完全相同，只是空白排布不同'
          : level === 'typographic' || level === 'typographic-tight'
            ? '仅排版差异：标点/全角半角/markdown 强调符号不同，字母数字未变'
            : gramCoverageFolded >= 0.8
              ? `疑似局部改写：折叠后仍有 ${Math.round(gramCoverageFolded * 100)}% 的 8 字片段能在 E1 中找到，改动集中在少数位置`
              : gramCoverageFolded >= 0.3
                ? `部分改写：折叠后仅 ${Math.round(gramCoverageFolded * 100)}% 的 8 字片段命中，句子骨架变了`
                : `真改写：折叠后只有 ${Math.round(gramCoverageFolded * 100)}% 的 8 字片段命中，E1 里没有这句话`

  return {
    id,
    kind,
    spanChars: trimmed.length,
    span: trimmed,
    level,
    harnessVerdict,
    e1MatchWindow: windowAt,
    gramCoverageFolded,
    gramCoverageRaw,
    lcsRatioFolded,
    lcsRatioRaw,
    lcsLength: lcsRaw.length,
    firstDiffIndexIn80,
    firstDiffSummary: summary,
    firstDiffSpanWindow,
    firstDiffE1Window,
    closestE1Line,
    closestE1LineSimilarity: Math.round(closestSim * 1000) / 1000,
    reading,
  }
}

const LEVEL_LABEL: Record<MatchLevel, string> = {
  missing: '未声明 e1_span（字段缺失）',
  'too-short': 'e1_span 过短（长度约束未满足）',
  exact: '精确匹配（harness 的裸 includes 即通过）',
  whitespace: '仅空白差异（折叠空白后匹配）',
  'whitespace-tight': '仅空白差异（删除全部空白后匹配）',
  typographic: '标点/全角/markdown 差异（折叠后匹配）',
  'typographic-tight': '标点/全角/markdown + 空白差异（全部折叠后匹配）',
  rewritten: '真改写（折叠标点与空白后仍不匹配）',
}

/** Pull the A-arm E1 text out of the archived B4 probe output. */
function archivedE1Text(): { text: string; source: string } | null {
  const path = join(here, 'probe-b4-e1-reasoning-output.txt')
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const armAt = raw.indexOf('ARM A reasoning_effort=none')
  if (armAt === -1) return null
  const contentAt = raw.indexOf('--- content (verbatim) ---', armAt)
  if (contentAt === -1) return null
  const start = contentAt + '--- content (verbatim) ---'.length
  const nextArm = raw.indexOf(`\n${'='.repeat(78)}\nARM `, start)
  const end = nextArm === -1 ? raw.length : nextArm
  const text = raw.slice(start, end).replace(/^\n+/, '').replace(/\n+$/, '')
  if (text.length === 0) return null
  return { text, source: 'probe-b4-e1-reasoning-output.txt (ARM A reasoning_effort=none, 真实 E1 调用存档)' }
}

interface Sample {
  readonly name: string
  readonly e1Source: string
  readonly e1Text: string
  readonly e2Raw: string
  readonly e2Finish: string | null
  readonly e2Status: number
  readonly e2Error: string | null
  readonly containerParseOk: boolean
  readonly containerParseError: string | null
  readonly entries: ReadonlyArray<{ kind: string; id: string; span: unknown }>
  readonly diagnoses: ReadonlyArray<SpanDiagnosis>
  readonly harnessFindings: ReadonlyArray<{ rule: string; ok: boolean; detail: string }>
}

/** Run the real fidelity check + the multi-level diagnosis on one E2 output. */
function analyze(name: string, e1Source: string, e1Text: string, e2: CallResult): Sample {
  let parsed: unknown = null
  let parseError: string | null = null
  try {
    parsed = JSON.parse(e2.content)
  } catch (err) {
    parseError = String(err).split('\n')[0] ?? 'parse failed'
  }
  // A truncated container is still diagnosable: every entry object that closed
  // before the cut is a real, fully-formed declaration. Scanning with a brace
  // counter (string-aware) recovers them so a budget-short E2 is not a total
  // loss — this is how the archived-E1 sample still yields its spans.
  const rawEntries = parsed === null ? salvageEntryObjects(e2.content) : null
  const entries: Array<{ kind: string; id: string; span: unknown }> = []
  const declared: Array<{ kind: string; value: Record<string, unknown> }> = []
  const take = (item: unknown): void => {
    if (typeof item !== 'object' || item === null) return
    const entry = item as Record<string, unknown>
    const kind = String(entry['kind'] ?? '?')
    const value = (typeof entry['value'] === 'object' && entry['value'] !== null
      ? entry['value']
      : {}) as Record<string, unknown>
    declared.push({ kind, value })
    if (kind === 'AssumptionSpec' || kind === 'EquationSpec') {
      const id = String(value[kind === 'AssumptionSpec' ? 'assumption_id' : 'equation_id'] ?? '?')
      entries.push({ kind, id, span: value['e1_span'] })
    }
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const es = (parsed as Record<string, unknown>)['entries']
    if (Array.isArray(es)) for (const item of es) take(item)
  } else if (rawEntries !== null) {
    for (const item of rawEntries) take(item)
  }
  const harnessFindings = checkE1E2Fidelity({
    e1Text,
    entries: declared,
    requiredOutputIds: REQUIRED_IDS,
  }).map(f => ({ rule: f.rule, ok: f.ok, detail: f.detail }))
  const diagnoses = entries.map(e => diagnoseSpan(e.id, e.kind, e.span, e1Text))
  return {
    name,
    e1Source,
    e1Text,
    e2Raw: e2.content,
    e2Finish: e2.finishReason,
    e2Status: e2.status,
    e2Error: e2.transportError ?? e2.inBandError,
    containerParseOk: parseError === null,
    containerParseError: parseError,
    entries,
    diagnoses,
    harnessFindings,
  }
}

/**
 * Recover the `{kind, value}` objects that closed before an unterminated JSON
 * string cut the container short. String-aware brace matching; returns null
 * when the text does not even look like a container.
 */
function salvageEntryObjects(text: string): ReadonlyArray<unknown> | null {
  const entriesAt = text.indexOf('"entries"')
  if (entriesAt === -1) return null
  const arrayAt = text.indexOf('[', entriesAt)
  if (arrayAt === -1) return null
  const out: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = arrayAt + 1; i < text.length; i += 1) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') {
      depth += 1
      if (depth === 1) start = i
    } else if (c === '}') {
      depth -= 1
      if (depth === 0 && start !== -1) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)))
        } catch {
          /* a partially written entry is not a declaration; skip it */
        }
        start = -1
      }
    } else if (c === ']' && depth === 0) {
      break
    }
  }
  return out
}

/** The comparison table, as Markdown. */
function renderTable(samples: ReadonlyArray<Sample>): string {
  const lines: string[] = []
  for (const s of samples) {
    lines.push(`## 样本 ${s.name}`)
    lines.push('')
    lines.push(`- E1 来源：${s.e1Source}`)
    lines.push(`- E1 长度：${s.e1Text.length} 字符`)
    lines.push(`- E2 输出：HTTP ${s.e2Status}，finish=${String(s.e2Finish)}，${s.e2Raw.length} 字符，JSON 可解析=${s.containerParseOk ? '是' : `否（${String(s.containerParseError)}）`}`)
    lines.push(`- 待检条目（AssumptionSpec + EquationSpec）：${s.diagnoses.length}`)
    lines.push('')
    lines.push('| id | kind | span 前 60 字符 | 精确? | 空白归一化? | 标点归一化? | 折叠后 8-gram 覆盖 | 原始 LCS 比 |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const d of s.diagnoses) {
      const snippet = d.span.length === 0 ? '（字段缺失）' : d.span.slice(0, 60).replace(/\|/g, '\\|').replace(/\n/g, '⏎')
      const exact = d.level === 'exact' ? '是' : '否'
      const passed = (l: MatchLevel): boolean =>
        l === 'exact' || l === 'whitespace' || l === 'whitespace-tight' || l === 'typographic' || l === 'typographic-tight'
      const ws = d.level === 'whitespace' || d.level === 'whitespace-tight'
        ? '是'
        : passed(d.level) ? '（已通过）' : '否'
      const typo = d.level === 'typographic' || d.level === 'typographic-tight'
        ? '是'
        : passed(d.level) ? '（已通过）' : '否'
      lines.push(`| ${d.id} | ${d.kind} | \`${snippet}\` | ${exact} | ${ws} | ${typo} | ${d.gramCoverageFolded} | ${d.lcsRatioRaw} |`)
    }
    lines.push('')
    const counts = countLevels(s.diagnoses)
    lines.push('**分类计数**：' + Object.entries(counts).map(([k, v]) => `${LEVEL_LABEL[k as MatchLevel]}=${v}`).join('；'))
    lines.push('')
    lines.push('**逐条明细**')
    lines.push('')
    for (const d of s.diagnoses) {
      lines.push(`### ${d.id}（${d.kind}，${d.spanChars} 字符）`)
      lines.push('')
      lines.push(`- harness 判定（裸 includes）：**${d.harnessVerdict}**`)
      lines.push(`- 本探针类别：**${LEVEL_LABEL[d.level]}**`)
      lines.push(`- 读数：${d.reading}`)
      lines.push(`- 相似度：折叠后 8-gram 覆盖 **${d.gramCoverageFolded}**；原始 8-gram 覆盖 ${d.gramCoverageRaw}；折叠后 LCS 比 ${d.lcsRatioFolded}；原始 LCS 比 ${d.lcsRatioRaw}`)
      if (d.e1MatchWindow !== null) lines.push(`- 在 E1 中的落点（按通过该级时的归一化文本）：\`${d.e1MatchWindow.replace(/`/g, '')}\``)
      lines.push(`- diff 摘要：${d.firstDiffSummary}`)
      lines.push(`  - span 侧：\`${d.firstDiffSpanWindow.replace(/`/g, '')}\``)
      lines.push(`  - E1 侧：\`${d.firstDiffE1Window.replace(/`/g, '')}\``)
      if (d.closestE1Line !== null) {
        lines.push(`- 最接近的 E1 单行（相似度 ${d.closestE1LineSimilarity}）：\`${d.closestE1Line.replace(/`/g, '')}\``)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

function countLevels(diagnoses: ReadonlyArray<SpanDiagnosis>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of diagnoses) out[d.level] = (out[d.level] ?? 0) + 1
  return out
}

/** Aggregate across samples: what the harness said vs what the text actually is. */
function renderAggregate(samples: ReadonlyArray<Sample>): string {
  const lines: string[] = []
  const all = samples.flatMap(s => s.diagnoses)
  const byLevel = new Map<MatchLevel, number>()
  for (const d of all) byLevel.set(d.level, (byLevel.get(d.level) ?? 0) + 1)
  const harnessFailed = all.filter(d => d.harnessVerdict !== 'PASS')
  lines.push('## 汇总（两个样本合并）')
  lines.push('')
  lines.push(`待检条目总数：${all.length}（AssumptionSpec ${all.filter(d => d.kind === 'AssumptionSpec').length} + EquationSpec ${all.filter(d => d.kind === 'EquationSpec').length}）`)
  lines.push('')
  lines.push('| 类别 | 条数 | 占比 |')
  lines.push('|---|---|---|')
  for (const [k, v] of [...byLevel.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${LEVEL_LABEL[k]} | ${v} | ${((v / all.length) * 100).toFixed(1)}% |`)
  }
  lines.push('')
  const mechanical = all.filter(d => d.level === 'whitespace' || d.level === 'whitespace-tight' || d.level === 'typographic' || d.level === 'typographic-tight').length
  const missing = all.filter(d => d.level === 'missing').length
  const short = all.filter(d => d.level === 'too-short').length
  const rewritten = all.filter(d => d.level === 'rewritten').length
  lines.push('**harness 失败条目（B3 正向未通过）的归因**')
  lines.push('')
  lines.push(`- harness 报"找不到逐字匹配（疑似改写）"的条目：${all.filter(d => d.harnessVerdict.includes('疑似改写')).length}`)
  lines.push(`  - 其中**纯机械差异**（空白/标点/全角/markdown 折叠后即命中）：**${mechanical}**`)
  lines.push(`  - 其中**真改写**（折叠后仍不命中）：**${rewritten}**`)
  lines.push(`- harness 报"未声明 e1_span"的条目：${missing}（不是改写，是字段缺失——另一类失败）`)
  lines.push(`- harness 报"e1_span 过短"的条目：${short}`)
  lines.push('')
  lines.push(`**机械差异占 harness 全部失败条目的比例**：${mechanical} / ${all.filter(d => d.harnessVerdict !== 'PASS').length} = ${((mechanical / Math.max(1, all.filter(d => d.harnessVerdict !== 'PASS').length)) * 100).toFixed(1)}%`)
  lines.push(`**机械差异占"疑似改写"条目的比例**：${mechanical} / ${Math.max(1, all.filter(d => d.harnessVerdict.includes('疑似改写')).length)} = ${((mechanical / Math.max(1, all.filter(d => d.harnessVerdict.includes('疑似改写')).length)) * 100).toFixed(1)}%`)
  lines.push('')
  lines.push('**harness 判定 × 实际类别 交叉表**')
  lines.push('')
  const levels = [...byLevel.keys()]
  lines.push('| harness 判定 | ' + levels.map(k => LEVEL_LABEL[k]).join(' | ') + ' |')
  lines.push('|---|' + levels.map(() => '---').join('|') + '|')
  for (const verdict of [...new Set(all.map(d => d.harnessVerdict === 'PASS' ? 'PASS' : d.harnessVerdict))]) {
    const row = all.filter(d => (d.harnessVerdict === 'PASS' ? 'PASS' : d.harnessVerdict) === verdict)
    const cells = levels.map(k => String(row.filter(d => d.level === k).length))
    lines.push(`| ${verdict} | ${cells.join(' | ')} |`)
  }
  lines.push('')
  return lines.join('\n')
}

async function main(): Promise<number> {
  loadDotEnvLocal()
  const base = (process.env.PAPER_PROBE_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.PAPER_PROBE_API_KEY ?? ''
  const model = process.env.PAPER_D3_MODEL ?? 'deepseek/deepseek-v4-flash'
  if (base === '' || key === '') {
    console.log('[SKIP] no PAPER_PROBE_BASE_URL / PAPER_PROBE_API_KEY in .env.local — cannot probe.')
    return 0
  }
  mkdirSync(outDir, { recursive: true })

  const log: string[] = []
  const say = (line: string): void => {
    console.log(line)
    log.push(line)
  }

  say('=== W8.10-D3 — e1_span root-cause probe ===')
  say(`model: ${model}   (target model; .env.local PAPER_PROBE_MODEL=${process.env.PAPER_PROBE_MODEL ?? '-'} — deliberately NOT used)`)
  say(`max_tokens: ${MAX_TOKENS}   reasoning_effort: none   temperature: 0.2   stream: true`)
  say(`serial: one call at a time (relay concurrency limit ${process.env.PAPER_PROBE_MAX_CONCURRENCY ?? '-'})`)
  say('')

  // --- preflight ---------------------------------------------------------
  const preflight = await callOnce('preflight', base, key, model, 'say OK', { max_tokens: 16, reasoning_effort: 'none' })
  say(`[preflight] HTTP ${preflight.status} finish=${String(preflight.finishReason)} ${preflight.elapsedMs}ms` +
    (preflight.transportError === null ? '' : `  ${preflight.transportError.slice(0, 160)}`))
  if (preflight.status !== 200) {
    say('[ABORT] the model is not callable on this route; failure recorded above, nothing fabricated.')
    writeFileSync(join(outDir, 'run-log.txt'), log.join('\n'), 'utf8')
    return 1
  }

  // --- the REAL E1 prompt (executor.ts:640-657 + 1434) --------------------
  const bundle = await assembleBundle(join(repoRoot, 'bench', 'problems', '2024-B', 'problem.pdf'))
  const verdict = classifyProblem(bundle.taskText)
  if (!verdict.ok) {
    say(`[ABORT] the problem did not route: ${verdict.reason}`)
    writeFileSync(join(outDir, 'run-log.txt'), log.join('\n'), 'utf8')
    return 1
  }
  const taskText = `${bundle.taskText}${routeBanner(verdict)}${contractBanner(verdict.family)}`
  const task = { name: 'task', text: `Task: ${taskText}`, trimPriority: 0 }

  const planPrompt = renderSections([
    task,
    { name: 'instruction', text: 'Produce a short numbered execution plan.', trimPriority: 0 },
  ])
  const planCall = await callOnce('plan', base, key, model, planPrompt, { reasoning_effort: 'none' })
  say(`[plan] HTTP ${planCall.status} ${planCall.content.length} chars ${planCall.elapsedMs}ms`)
  if (planCall.content.length === 0) {
    say(`[ABORT] the plan node produced no content; cannot build the E1 prompt.`)
    writeFileSync(join(outDir, 'run-log.txt'), log.join('\n'), 'utf8')
    return 1
  }
  const plan = { name: 'plan', text: `Plan:\n${planCall.content}`, trimPriority: 0 }
  const e1Prompt = `${renderSections([
    task,
    plan,
    { name: 'instruction', text: EXECUTE_PROTOCOL_TEACHING, trimPriority: 0 },
  ])}\n\n${e1AnalysisInstruction(REQUIRED_IDS)}`
  writeFileSync(join(outDir, 'e1-prompt.txt'), e1Prompt, 'utf8')
  say(`problem: bench/problems/2024-B/problem.pdf  (pypdf text ${bundle.taskText.length} chars)`)
  say(`route: ${verdict.family}`)
  say(`E1 prompt: ${e1Prompt.length} chars -> e1-prompt.txt`)
  say('')

  const samples: Sample[] = []
  const readIfPresent = (path: string): string | null => {
    try {
      const text = readFileSync(path, 'utf8')
      return text.length > 0 ? text : null
    } catch {
      return null
    }
  }
  /** A CallResult-shaped record for a file that is already on disk. */
  const fromDisk = (label: string, text: string): CallResult => ({
    label,
    status: 200,
    content: text,
    reasoningChars: 0,
    finishReason: 'reused-from-disk',
    inBandError: null,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: undefined,
    elapsedMs: 0,
    transportError: null,
  })

  // --- fresh samples: real E1, then the real E2, N times -----------------
  for (let n = 1; n <= FRESH_SAMPLES; n += 1) {
    const tag = `fresh${n}`
    const e1Path = join(outDir, `e1-analysis.${tag}.md`)
    const e2Path = join(outDir, `e2-container.${tag}.json`)
    const e1Disk = REUSE ? readIfPresent(e1Path) : null
    let e1: CallResult
    if (e1Disk !== null) {
      say(`[${tag}] REUSE: E1 loaded from ${tag} (PAPER_D3_REUSE=1)`)
      e1 = fromDisk('E1', e1Disk)
    } else {
      say(`[${tag}] calling E1 (fresh analysis) ...`)
      e1 = await callOnce('E1', base, key, model, e1Prompt, { reasoning_effort: 'none' })
      say(`      HTTP ${e1.status} finish=${String(e1.finishReason)} content=${e1.content.length} chars reasoning=${e1.reasoningChars} chars ${e1.elapsedMs}ms` +
        (e1.transportError === null ? '' : `  ERR=${e1.transportError.slice(0, 160)}`))
    }
    if (e1.content.length === 0) {
      say(`      [SKIP ${tag}] E1 returned empty content — recorded as-is, nothing fabricated.`)
      continue
    }
    const e1Anchors = parseE1Anchors(e1.content)
    say(`      E1: ${e1.content.length} chars; anchors assumptions=${e1Anchors.assumptions.length} requirements=${e1Anchors.requirements.length}`)
    writeFileSync(e1Path, e1.content, 'utf8')

    const e2Prompt = e2NormalizationPrompt(e1.content, EXECUTE_PROTOCOL_TEACHING)
    writeFileSync(join(outDir, `e2-prompt.${tag}.txt`), e2Prompt, 'utf8')
    const e2Disk = REUSE ? readIfPresent(e2Path) : null
    let e2: CallResult
    if (e2Disk !== null) {
      say(`[${tag}] REUSE: E2 output loaded from ${tag} (PAPER_D3_REUSE=1)`)
      e2 = fromDisk(`E2-${tag}`, e2Disk)
    } else {
      say(`[${tag}] calling E2 ... prompt ${e2Prompt.length} chars, max_tokens ${E2_MAX_TOKENS}`)
      e2 = await callOnce(`E2-${tag}`, base, key, model, e2Prompt, { reasoning_effort: 'none', max_tokens: E2_MAX_TOKENS })
      say(`      HTTP ${e2.status} finish=${String(e2.finishReason)} content=${e2.content.length} chars ${e2.elapsedMs}ms` +
        (e2.transportError === null ? '' : `  ERR=${e2.transportError.slice(0, 160)}`))
      writeFileSync(e2Path, e2.content, 'utf8')
    }
    samples.push(analyze(`fresh-${n} — 本次新跑的 E1 全文`, `本次探针第 ${n} 次真实 E1 调用（与生产同构的 prompt）`, e1.content, e2))
    say('')
  }

  // --- the archived sample: a real E1 from the target model --------------
  const archived = archivedE1Text()
  if (archived === null) {
    say('[archived] SKIPPED — no archived E1 text found in probe-b4-e1-reasoning-output.txt')
  } else {
    writeFileSync(join(outDir, 'e1-analysis.archived.md'), archived.text, 'utf8')
    const e2Prompt2 = e2NormalizationPrompt(archived.text, EXECUTE_PROTOCOL_TEACHING)
    writeFileSync(join(outDir, 'e2-prompt.archived.txt'), e2Prompt2, 'utf8')
    const e2bDisk = REUSE ? readIfPresent(join(outDir, 'e2-container.archived.json')) : null
    let e2b: CallResult
    if (e2bDisk !== null) {
      say('[archived] REUSE: E2 output loaded from e2-container.archived.json (PAPER_D3_REUSE=1)')
      e2b = fromDisk('E2-archived', e2bDisk)
    } else {
      say(`[archived] calling E2 (normalization of the ARCHIVED E1, ${archived.text.length} chars) ... max_tokens ${E2_MAX_TOKENS}`)
      e2b = await callOnce('E2-archived', base, key, model, e2Prompt2, { reasoning_effort: 'none', max_tokens: E2_MAX_TOKENS })
      say(`      HTTP ${e2b.status} finish=${String(e2b.finishReason)} content=${e2b.content.length} chars ${e2b.elapsedMs}ms` +
        (e2b.transportError === null ? '' : `  ERR=${e2b.transportError.slice(0, 160)}`))
      writeFileSync(join(outDir, 'e2-container.archived.json'), e2b.content, 'utf8')
    }
    samples.push(analyze('archived — 存档的真实 E1 全文', archived.source, archived.text, e2b))
  }
  say('')

  // --- the comparison table ---------------------------------------------
  const aggregate = renderAggregate(samples)
  writeFileSync(join(outDir, 'comparison-table.md'), `${aggregate}\n${renderTable(samples)}`, 'utf8')
  writeFileSync(join(outDir, 'comparison-details.json'), JSON.stringify(samples, null, 2), 'utf8')

  // --- console summary ---------------------------------------------------
  say('=== 结果 ===')
  for (const s of samples) {
    const counts = countLevels(s.diagnoses)
    say(`样本 ${s.name}: ${s.diagnoses.length} 条待检条目`)
    for (const [k, v] of Object.entries(counts)) say(`    ${LEVEL_LABEL[k as MatchLevel]}: ${v}`)
    for (const f of s.harnessFindings) {
      say(`    [harness] ${f.rule}: ok=${String(f.ok)} — ${f.detail.slice(0, 200)}`)
    }
  }
  say('')
  const cols = ['sample', 'id', 'spanChars', 'harness', 'exact', 'ws', 'typo', 'gramFold', 'lcsRaw']
  const rows = samples.flatMap(s => s.diagnoses.map(d => {
    const passed = (l: MatchLevel): boolean =>
      l === 'exact' || l === 'whitespace' || l === 'whitespace-tight' || l === 'typographic' || l === 'typographic-tight'
    return [
      s.name.slice(0, 2).trim(),
      d.id,
      String(d.spanChars),
      d.harnessVerdict === 'PASS' ? 'PASS' : 'FAIL',
      d.level === 'exact' ? 'YES' : 'no',
      d.level === 'whitespace' || d.level === 'whitespace-tight' ? 'YES' : passed(d.level) ? '-' : 'no',
      d.level === 'typographic' || d.level === 'typographic-tight' ? 'YES' : passed(d.level) ? '-' : 'no',
      String(d.gramCoverageFolded),
      String(d.lcsRatioRaw),
    ]
  }))
  const width = cols.map((c, i) => Math.max(c.length, ...rows.map(r => (r[i] ?? '').length)))
  const fmt = (cells: ReadonlyArray<string>): string => cells.map((c, i) => c.padEnd(width[i] ?? 0)).join('  ')
  say(fmt(cols))
  say(width.map(w => '-'.repeat(w)).join('  '))
  for (const row of rows) say(fmt(row))
  say('')
  say(`落盘目录：${outDir}`)
  writeFileSync(join(outDir, 'run-log.txt'), log.join('\n'), 'utf8')
  return 0
}

/** Exported so the comparator can be exercised on synthetic fixtures without
 *  spending a provider call (see the entry-point guard at the bottom). */
export { diagnoseSpan, normalizeTypographic, normalizeWhitespace, stripAllWhitespace, longestCommonSubstring, LEVEL_LABEL }
export type { SpanDiagnosis }

/**
 * Only run the probe when this file IS the entry point.
 *
 * Rationale: the comparator runs AFTER two multi-minute provider calls, so a
 * defect in it would waste a whole run. The guard lets a fixture script import
 * the pure functions and check them in milliseconds first.
 */
const isEntry = ((): boolean => {
  const arg = process.argv[1]
  if (arg === undefined) return false
  const self = fileURLToPath(import.meta.url)
  return resolve(arg).toLowerCase() === resolve(self).toLowerCase()
})()

if (isEntry) {
  main().then(code => process.exit(code)).catch(error => {
    console.error('probe failed:', error)
    process.exit(1)
  })
}
