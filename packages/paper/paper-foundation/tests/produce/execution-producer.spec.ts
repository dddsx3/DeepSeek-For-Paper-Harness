/**
 * P1-2 — execution-capture production wiring acceptance.
 *
 * A P1-1 container's code payload is really executed by a node child, the
 * outcome lands in the canonical store as RunArtifact + ExecutionRecord
 * (through ingestCapturedRecord, the production door), and the chain reads
 * as fresh (no STALE). The correct sequencing is: the contract chain is
 * produced first (P1-1), then the code runs against it (P1-2). Attacks:
 * a missing declared model is refused before anything runs; a code whose
 * real output set disagrees with the declaration is refused before any
 * record is committed.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/produce/execution-producer
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { computeStaleReport } from '../../src/ir/stale.ts'
import { produceContainerInto, MODEL_CONTAINER_VERSION } from '../../src/produce/ir-producer.ts'
import { produceRunExecution } from '../../src/produce/execution-producer.ts'
import {
  dataArtifact,
  requirementSpec,
  requiredOutput,
  constraintRequirement,
  variableSymbol,
  parameterSymbol,
  problemSpec,
  modelSpec,
} from '../ir/fixtures.ts'

const REAL_RESULT = JSON.stringify({ mean_thickness: 0.731 })
const RUN_ID = 'RUN-P1'
const LOCATOR = `file:///runs/${RUN_ID}/result.json`

function nodeCode(): string {
  return [
    'const fs = require("node:fs");',
    `fs.writeFileSync("result.json", ${JSON.stringify(REAL_RESULT)});`,
    'console.log("run ok");',
  ].join('\n')
}

/** Produce the P1-1 contract chain (DataArtifact..ModelSpec) into `ir`. */
function seedContract(ir: ModelingIr, modelOverrides: Record<string, unknown> = {}): void {
  const container = JSON.stringify({
    __dsh_paper: MODEL_CONTAINER_VERSION,
    code: nodeCode(),
    entries: [
      { kind: 'DataArtifact', value: dataArtifact() },
      { kind: 'RequirementSpec', value: requirementSpec() },
      { kind: 'RequirementSpec', value: requiredOutput() },
      { kind: 'RequirementSpec', value: constraintRequirement() },
      { kind: 'ProblemSpec', value: problemSpec() },
      { kind: 'SymbolSpec', value: variableSymbol() },
      { kind: 'SymbolSpec', value: parameterSymbol() },
      { kind: 'ModelSpec', value: modelSpec(modelOverrides) },
    ],
  })
  const verdict = produceContainerInto(ir, container)
  if (!verdict.ok) throw new Error(`seedContract failed: ${verdict.reason}`)
}

function runArgs(modelRef = 'M1') {
  return {
    runId: RUN_ID,
    modelRef,
    codeText: nodeCode(),
    environment: 'node deterministic-fake',
    outputBasenames: ['result.json'],
    outputLocators: [LOCATOR],
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
    declaredOutputBytes: new Map([[LOCATOR, REAL_RESULT]]),
    environmentFactsCommands: [['node', '-p', 'process.version']],
  } as const
}

describe('P1-2 execution producer — positive (real node child)', () => {
  it('runs a real node child and commits RunArtifact + ExecutionRecord', async () => {
    const ir = new ModelingIr()
    seedContract(ir)
    const verdict = await produceRunExecution({ ir, ...runArgs() })
    expect(verdict.ok).toBe(true)
    expect(ir.list().filter(r => r.kind === 'RunArtifact').map(r => (r.value as { run_id: string }).run_id)).toContain(RUN_ID)
    const records = ir.list().filter(r => r.kind === 'ExecutionRecord').map(r => r.value as { execution_id: string; exit_status: number; run_ref: string })
    expect(records.map(r => r.execution_id)).toContain(`EXEC-${RUN_ID}`)
    expect(records[0]!.exit_status).toBe(0)
    expect(records[0]!.run_ref).toBe(RUN_ID)
    expect(computeStaleReport(ModelingIr.snapshot(ir)!).stale.filter(s => s.kind === 'RunArtifact')).toHaveLength(0)
  }, 60_000)
})

describe('P1-2 execution producer — attacks', () => {
  it('refuses when the declared model is not in the store (nothing runs)', async () => {
    const ir = new ModelingIr()
    const verdict = await produceRunExecution({ ir, ...runArgs('M-DOES-NOT-EXIST') })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('run_declaration_refused')
    expect(ir.list().filter(r => r.kind === 'RunArtifact' || r.kind === 'ExecutionRecord')).toHaveLength(0)
  })

  it('refuses a code whose real output set disagrees with the declaration', async () => {
    const ir = new ModelingIr()
    seedContract(ir)
    const verdict = await produceRunExecution({
      ir, ...runArgs(),
      codeText: 'console.log("no output file at all")',
      declaredOutputBytes: undefined as unknown as Map<string, string>,
    })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('OUTPUT_SET_MISMATCH')
    expect(ir.list().filter(r => r.kind === 'ExecutionRecord')).toHaveLength(0)
  }, 60_000)
})
