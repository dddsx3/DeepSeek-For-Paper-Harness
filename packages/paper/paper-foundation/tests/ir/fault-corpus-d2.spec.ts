/**
 * TASK 2 — fault corpus driver (D-001..D-020).
 *
 * Mirrors `artifacts/handoff/TASK-1.5R/fault-corpus.spec.ts`: the same
 * fixture files are run through `evaluateIrBridge` from inside vitest so
 * the corpus is part of the regression suite, not just a standalone
 * artifact. The fixture shape (`{id, ingest, ir_claims, mode}` +
 * `{expected_status, expected_reason_matches,
 * expected_ingest_reason_matches}`) is identical to TASK 1.5R's, so
 * the existing runner code is reused verbatim with a fresh fault dir.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateIrBridge } from '../../src/ir/bridge.ts'
import { ModelingIr, type IrIngestVerdict, type IrKind } from '../../src/ir/index.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const faultDir = join(__dirname, '..', '..', '..', '..', '..', 'artifacts', 'handoff', 'TASK-2', 'faults')

const fixtureNames = readdirSync(faultDir)
  .filter(name => name.endsWith('.json') && !name.endsWith('.verdict.json'))
  .sort()

describe('TASK 2 fault corpus D-001..D-020', () => {
  for (const name of fixtureNames) {
    const id = name.replace(/\.json$/, '')
    const fixture = JSON.parse(readFileSync(join(faultDir, name), 'utf8'))
    const verdict = JSON.parse(readFileSync(join(faultDir, name.replace(/\.json$/, '.verdict.json')), 'utf8'))

    it(`${id} — ${fixture.description}`, () => {
      const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
      const refused: { kind: string; failures: ReadonlyArray<{ path: string; kind: string; reason: string }> }[] = []
      for (const entry of fixture.ingest) {
        const result = ir.put(entry.kind as IrKind, entry.value) as IrIngestVerdict
        if (!result.accepted) refused.push({ kind: entry.kind, failures: result.failures })
      }

      const decision = evaluateIrBridge(ir, fixture.ir_claims ?? [], fixture.mode)

      expect(decision.status).toBe(verdict.expected_status)

      for (const needle of verdict.expected_reason_matches ?? []) {
        expect(decision.reason, `${id} reason should contain "${needle}"`).toContain(needle)
      }

      const haystack = refused
        .flatMap(e => e.failures.map(f => `${f.path}:${f.kind}:${f.reason}`))
        .join(' | ')
      for (const needle of verdict.expected_ingest_reason_matches ?? []) {
        expect(haystack, `${id} ingest haystack should contain "${needle}"`).toContain(needle)
      }
    })
  }
})