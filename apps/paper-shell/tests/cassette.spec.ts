/**
 * TASK-E — cassette record/replay unit tests (no engine, no network).
 *
 * The replay property the expert plan demands (§14):
 *
 *     same cassette → same answers → (at the shell level) same ZIP sha256
 *
 * The ZIP-level half is exercised end-to-end by the recorded cassette +
 * manual replay runs (see artifacts/handoff/TASK-E); this suite pins the
 * cassette module's own contracts:
 *
 *   - request fingerprints are deterministic (order/content sensitive)
 *   - a recorded exchange replays byte-identically
 *   - an unknown request FAILS LOUDLY — replay never guesses (禁7)
 *   - the written document is versioned and key-free
 *
 * @module apps/paper-shell/tests/cassette
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CassetteRecorder, CassetteReplayer, requestFingerprint } from '../src/cassette.ts'

const REQUEST = {
  provider: 'openai-compatible-relay',
  model: 'z-ai/glm-5.3-free',
  system: 'You are the reviewer.',
  messages: [{ content: 'review this text' }],
}

const OTHER_REQUEST = {
  provider: 'openai-compatible-relay',
  model: 'z-ai/glm-5.3-free',
  system: 'You are the reviewer.',
  messages: [{ content: 'review a DIFFERENT text' }],
}

describe('cassette request fingerprints', () => {
  it('the same request always hashes the same', () => {
    expect(requestFingerprint(REQUEST)).toBe(requestFingerprint({ ...REQUEST }))
  })

  it('a different message content is a different fingerprint', () => {
    expect(requestFingerprint(REQUEST)).not.toBe(requestFingerprint(OTHER_REQUEST))
  })

  it('message content in array form normalizes identically to string form', () => {
    const stringForm = requestFingerprint({ ...REQUEST, messages: [{ content: 'review this text' }] })
    const arrayForm = requestFingerprint({
      ...REQUEST,
      messages: [{ content: [{ type: 'text', text: 'review this text' }] }],
    })
    expect(stringForm).toBe(arrayForm)
  })
})

describe('cassette record → write → load → replay', () => {
  it('a recorded exchange replays byte-identically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-e2e-'))
    const path = join(dir, 'cassette.json')
    try {
      const recorder = new CassetteRecorder('openai-compatible-relay', 'z-ai/glm-5.3-free', 'unit test')
      recorder.record(REQUEST, '{"defects":[]}')
      expect(recorder.count).toBe(1)
      await recorder.write(path)

      const replayer = await CassetteReplayer.load(path)
      expect(replayer.meta.entries).toBe(1)
      expect(replayer.answer(REQUEST)).toBe('{"defects":[]}')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an unrecorded request fails loudly on replay (never guesses)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-miss-'))
    const path = join(dir, 'cassette.json')
    try {
      const recorder = new CassetteRecorder('p', 'm', 'unit test')
      recorder.record(REQUEST, 'answer')
      await recorder.write(path)
      const replayer = await CassetteReplayer.load(path)
      expect(() => replayer.answer(OTHER_REQUEST)).toThrow(/cassette miss/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the written document is versioned and carries no credential material', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-hygiene-'))
    const path = join(dir, 'cassette.json')
    try {
      const recorder = new CassetteRecorder('openai-compatible-relay', 'z-ai/glm-5.3-free', 'unit test')
      recorder.record({ ...REQUEST, system: 'Bearer sk-supersecretkey should never appear' }, 'response text')
      await recorder.write(path)
      const raw = await readFile(path, 'utf8')
      const doc = JSON.parse(raw) as { cassette_version: number; entries: ReadonlyArray<Record<string, string>> }
      expect(doc.cassette_version).toBe(1)
      // The system prompt text IS recorded (it is a request fingerprint
      // input — engine semantics, not a credential). What must NEVER appear
      // is the API key as a credential FIELD. Assert the schema has no
      // auth/key/header field at all.
      for (const entry of doc.entries) {
        expect(Object.keys(entry).sort()).toEqual(['model', 'provider', 'request_fingerprint', 'response_sha256', 'response_text'])
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an unsupported cassette version is refused on load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-ver-'))
    const path = join(dir, 'cassette.json')
    try {
      await writeFile(path, JSON.stringify({ cassette_version: 99, entries: [] }), 'utf8')
      await expect(CassetteReplayer.load(path)).rejects.toThrow(/unsupported version/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
