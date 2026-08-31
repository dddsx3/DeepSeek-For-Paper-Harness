/**
 * Driver: read one fault fixture JSON from $FAULT_FIXTURE_DIR, build the
 * prescribed `ModelingIr`, call `evaluateIrBridge`, and emit a single
 * JSON line summarising the verdict.
 *
 * The fixture format is intentionally tiny so the runner can be invoked
 * from either the harness test (`tests/ir/attack15.spec.ts`) or the
 * standalone fault-corpus script (`run-fault-corpus.mjs`).
 *
 * Fixture shape:
 *   {
 *     "id": "C-001",
 *     "description": "...",
 *     "mode": "FORMAL" | "FAST" | "EXPLORATORY",
 *     "ir_claims": [],
 *     "ingest": [
 *       { "kind": "ProblemSpec", "value": { ... } },
 *       ...
 *     ]
 *   }
 *
 * The driver ingests everything in `ingest` order (the store is append-only
 * by design), then evaluates the bridge. The fixture never has to mock the
 * executor or the gate — the bridge is the choke point.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { evaluateIrBridge } from '../../src/ir/bridge.ts'
import { ModelingIr, type IrIngestVerdict, type IrKind } from '../../src/ir/index.ts'

const fixtureDir = process.env.FAULT_FIXTURE_DIR
if (!fixtureDir) {
  console.error('FAULT_FIXTURE_DIR is not set')
  process.exit(2)
}
const fixtureName = process.argv[2]
if (!fixtureName) {
  console.error('usage: run-fault.ts <fixture.json>')
  process.exit(2)
}

const fixture = JSON.parse(readFileSync(join(fixtureDir, fixtureName), 'utf8'))
const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })

let accepted = 0
let refused = 0
const ingestLog: Array<{ kind: string; accepted: boolean; failures?: ReadonlyArray<unknown> }> = []
for (const entry of fixture.ingest) {
  const verdict = ir.put(entry.kind as IrKind, entry.value) as IrIngestVerdict
  if (verdict.accepted) {
    accepted += 1
    ingestLog.push({ kind: entry.kind, accepted: true })
  } else {
    refused += 1
    ingestLog.push({ kind: entry.kind, accepted: false, failures: verdict.failures })
  }
}

const decision = evaluateIrBridge(ir, fixture.ir_claims ?? [], fixture.mode)

const observed = {
  status: decision.status,
  reason: decision.reason,
  missingBackbone: decision.missingBackbone,
  missingCriticalClaim: decision.missingCriticalClaim,
  contractSatisfied: decision.contractSatisfied,
  contractFailures: decision.contractFailures,
  claimProblems: decision.claimProblems,
  ingest: { accepted, refused, log: ingestLog },
}

console.log(JSON.stringify(observed))
