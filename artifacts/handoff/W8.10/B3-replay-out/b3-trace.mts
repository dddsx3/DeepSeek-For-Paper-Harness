/**
 * W8.10-B3 evidence harness (untracked, artifacts-only).
 *
 * Drives the REAL shell CLI with --replay while wrapping the replayer, so the
 * exact request fingerprints the engine computes at replay time are logged and
 * compared against the cassette's recorded set. Read-only: nothing under
 * apps/ or packages/ is touched, and the cassette is never written.
 */
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs'
import { CassetteReplayer, requestFingerprint } from '../../../../apps/paper-shell/src/cassette.ts'

const [cassette, outDir, tracePath] = process.argv.slice(2)
if (cassette === undefined || outDir === undefined || tracePath === undefined) {
  console.error('usage: b3-trace.mts <cassette> <out-dir> <trace-file>')
  process.exit(2)
}

const doc = JSON.parse(readFileSync(cassette, 'utf8')) as {
  provider: string
  model: string
  entries: Array<{ request_fingerprint: string; response_text: string; usage?: unknown }>
}
const recorded = new Set(doc.entries.map(e => e.request_fingerprint))
writeFileSync(tracePath, '')

const orig = CassetteReplayer.prototype.answerWithUsage
let callIndex = 0
CassetteReplayer.prototype.answerWithUsage = function (
  this: CassetteReplayer,
  request: Parameters<typeof orig>[0],
) {
  const fp = requestFingerprint(request as never)
  const messages = (request.messages ?? []) as ReadonlyArray<{ content?: unknown }>
  const joined = messages
    .map((m) => {
      const c = m?.content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) {
        return (c as Array<{ type?: string; text?: string }>).map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('')
      }
      return ''
    })
    .join('\n')
  appendFileSync(tracePath, `${JSON.stringify({
    call: callIndex,
    fingerprint: fp,
    in_cassette: recorded.has(fp),
    request_provider: request.provider,
    request_model: request.model,
    system_chars: String(request.system ?? '').length,
    messages: messages.length,
    prompt_chars: joined.length,
    prompt_head: joined.slice(0, 220).replace(/\s+/g, ' '),
  })}\n`)
  callIndex += 1
  return orig.call(this, request as never)
}

process.argv = [
  'node',
  'apps/paper-shell/src/cli.ts',
  'run',
  'artifacts/handoff/TASK-M1/samples/course-work.md',
  '--tier', 'T3',
  '--mode', 'strict',
  '--out', outDir,
  '--replay', cassette,
]
await import('../../../../apps/paper-shell/src/cli.ts')
