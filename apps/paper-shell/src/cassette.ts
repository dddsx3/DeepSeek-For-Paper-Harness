/**
 * TASK-E (expert plan §2.1 option E) — record/replay cassettes for the
 * paper shell.
 *
 * A cassette captures EVERY response that crossed the provider seam during
 * one shell run, in call order, keyed by a deterministic request
 * fingerprint. Replay mode answers every seam call from the cassette —
 * no network, no key — which is what lets push CI exercise the FULL
 * real-provider code path (executor → tiers → gates → ZIP) without a
 * provider, and lets a recorded real run be re-verified byte-for-byte
 * forever.
 *
 * The property the expert plan demands (§14 Replay):
 *
 *     same cassette → same IR → same gate result → same ZIP sha256
 *
 * is pinned by `tests/ir/…` and the shell spec (apps/paper-shell).
 *
 * Discipline (recorded in every cassette, enforced by this module):
 *   - No API keys, no auth headers, no user-identifying bytes EVER enter a
 *     cassette. Only provider/model ids, request fingerprints, and the
 *     response text chunks the engine consumed.
 *   - A replay that meets an unknown fingerprint FAILS LOUDLY (禁7-style
 *     explicit refusal) — it never guesses, never falls through to the
 *     network, never silently serves a neighboring entry.
 *
 * @module apps/paper-shell/src/cassette
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

/** One recorded seam exchange: request fingerprint → assembled text. */
export interface CassetteEntry {
  /** Deterministic digest of (role, provider, model, system, messages). */
  readonly request_fingerprint: string
  readonly provider: string
  readonly model: string
  /** sha256 of the assembled response text (integrity + dedup aid). */
  readonly response_sha256: string
  /** The assembled response text exactly as the engine consumed it. */
  readonly response_text: string
  /** Token usage the transport reported (TASK-Q2; absent when the endpoint
   *  did not report any — replay then omits the usage chunk too). */
  readonly usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
}

/** Cassette document (versioned). */
export interface CassetteDoc {
  readonly cassette_version: 1
  readonly recorded_from: string
  readonly provider: string
  readonly model: string
  readonly entries: ReadonlyArray<CassetteEntry>
}

/** Deterministic fingerprint over one seam request. */
export function requestFingerprint(request: {
  provider: string
  model: string
  system?: string | undefined
  messages: ReadonlyArray<{ content?: unknown }>
}): string {
  return createHash('sha256').update(JSON.stringify({
    provider: request.provider,
    model: request.model,
    system: request.system ?? '',
    messages: request.messages.map(m => ({ content: normalizeContent(m.content) })),
  })).digest('hex')
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .map(part => (part?.type === 'text' ? part.text ?? '' : ''))
      .join('')
  }
  return ''
}

/** Append-only recorder: one entry per seam call, in call order. */
export class CassetteRecorder {
  readonly #entries: CassetteEntry[] = []
  readonly #provider: string
  readonly #model: string
  readonly #source: string

  constructor(provider: string, model: string, source: string) {
    this.#provider = provider
    this.#model = model
    this.#source = source
  }

  record(request: { provider: string; model: string; system?: string | undefined; messages: ReadonlyArray<{ content?: unknown }> }, responseText: string, usage?: CassetteEntry['usage']): void {
    this.#entries.push({
      request_fingerprint: requestFingerprint(request),
      provider: request.provider,
      model: request.model,
      response_sha256: createHash('sha256').update(responseText, 'utf8').digest('hex'),
      response_text: responseText,
      ...(usage === undefined ? {} : { usage }),
    })
  }

  /** Recorded exchanges so far. */
  get count(): number {
    return this.#entries.length
  }

  async write(path: string): Promise<void> {
    const doc: CassetteDoc = {
      cassette_version: 1,
      recorded_from: this.#source,
      provider: this.#provider,
      model: this.#model,
      entries: this.#entries,
    }
    await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  }
}

/**
 * Replayer: answers each seam call from the recorded entries.
 *
 * Lookup is BY FINGERPRINT (not by call index): two runs of the same
 * engine make the same requests in possibly different orders (tier
 * fallbacks, retries), and the fingerprint is the request's identity.
 * Duplicate fingerprints replay the same answer — deterministic engines
 * ask the same thing repeatedly. An unknown fingerprint is a hard error
 * (the cassette and the engine disagree; serving anything else would
 * fabricate evidence).
 */
export class CassetteReplayer {
  readonly #byFingerprint = new Map<string, CassetteEntry>()
  readonly #doc: CassetteDoc

  private constructor(doc: CassetteDoc) {
    this.#doc = doc
    for (const entry of doc.entries) {
      if (!this.#byFingerprint.has(entry.request_fingerprint)) {
        this.#byFingerprint.set(entry.request_fingerprint, entry)
      }
    }
  }

  static async load(path: string): Promise<CassetteReplayer> {
    const raw = await readFile(path, 'utf8')
    const doc = JSON.parse(raw) as CassetteDoc
    if (doc.cassette_version !== 1) {
      throw new Error(`cassette ${path}: unsupported version ${String(doc.cassette_version)}`)
    }
    return new CassetteReplayer(doc)
  }

  /** The cassette's provider/model identity (route metadata only). */
  get meta(): { provider: string; model: string; entries: number } {
    return { provider: this.#doc.provider, model: this.#doc.model, entries: this.#doc.entries.length }
  }

  /** The recorded answer for this exact request, or a loud failure. */
  answer(request: { provider: string; model: string; system?: string | undefined; messages: ReadonlyArray<{ content?: unknown }> }): string {
    const entry = this.#entryFor(request)
    return entry.response_text
  }

  /** The recorded answer AND its usage (TASK-Q2: replay reproduces the
   *  token accounting, so a replayed run-report equals the real one). */
  answerWithUsage(request: { provider: string; model: string; system?: string | undefined; messages: ReadonlyArray<{ content?: unknown }> }): { text: string; usage?: CassetteEntry['usage'] } {
    const entry = this.#entryFor(request)
    return { text: entry.response_text, ...(entry.usage === undefined ? {} : { usage: entry.usage }) }
  }

  #entryFor(request: { provider: string; model: string; system?: string | undefined; messages: ReadonlyArray<{ content?: unknown }> }): CassetteEntry {
    const fingerprint = requestFingerprint(request)
    const entry = this.#byFingerprint.get(fingerprint)
    if (entry === undefined) {
      throw new Error(
        `cassette miss: request ${fingerprint.slice(0, 16)}… was never recorded — ` +
        'the engine changed what it asks; re-record the cassette (never guess on replay)',
      )
    }
    return entry
  }
}
