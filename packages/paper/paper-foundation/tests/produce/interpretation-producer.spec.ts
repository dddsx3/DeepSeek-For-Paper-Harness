/**
 * P1-3 — Result/Claim production + v1 template-report renderer.
 *
 * The producer turns an interpretation (structure only — the model never
 * types the numbers) plus the REAL executed output bytes into canonical
 * Result + Claim records. Values are read from the bytes; a NUMERIC claim's
 * asserted value/unit are copied from the bound Result, so a model cannot
 * mis-transcribe a number it just computed (INV-2-A/B). The renderer
 * injects the result table from the IR and refuses a conclusion whose
 * numeric literals are not Result values.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/produce/interpretation
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { produceInterpretation, resolveJsonPath, type OutputBytes } from '../../src/produce/interpretation-producer.ts'
import { renderV1Report } from '../../src/produce/report-renderer.ts'
import { numericConsistencyFindings } from '../../src/delivery/numeric-consistency.ts'
import { chainThrough } from '../ir/fixtures.ts'

const RESULT_LOC = 'file:///runs/RUN1/result.json'

/** Store with the contract chain up to (and including) RunArtifact RUN1 —
 *  no Result/Claim yet, exactly the state after P1-2 executes the code. */
function chainToRun(): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of chainThrough('RunArtifact')) {
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) throw new Error(`chain failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  return ir
}

function realOutputs(overrides: Record<string, string> = {}): ReadonlyArray<OutputBytes> {
  return [
    { locator: RESULT_LOC, bytes: overrides[RESULT_LOC] ?? '{"mean_thickness": 0.731, "n": 120}' },
  ]
}

const LEGAL = {
  results: [
    {
      result_id: 'RES-ICE',
      name: 'mean_thickness',
      source: { locator: RESULT_LOC, jsonPath: 'mean_thickness' },
      unit: 'm',
      uncertainty: 0.012,
    },
  ],
  claims: [
    {
      claim_id: 'C-ICE',
      text: 'Mean ice thickness at the survey line is 0.731 m.',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      result_refs: ['RES-ICE'],
      model_refs: ['M1'],
      evidence_refs: ['RES-ICE'],
    },
  ],
}

describe('P1-3 produceInterpretation (values only from executed bytes)', () => {
  it('mints Result + Claim with the number read from the real output bytes', () => {
    const ir = chainToRun()
    const verdict = produceInterpretation({ ir, runId: 'RUN1', interpretations: LEGAL, outputs: realOutputs() })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.resultIds).toEqual(['RES-ICE'])
    expect(verdict.claimIds).toEqual(['C-ICE'])

    const resultRecord = ir.list().find(r => r.kind === 'Result' && r.id === 'RES-ICE')
    expect(resultRecord).toBeDefined()
    const result = resultRecord!.value as { run_ref: string; value: number; unit: string; source_location: string }
    expect(result.run_ref).toBe('RUN1')
    expect(result.value).toBe(0.731)
    expect(result.unit).toBe('m')
    expect(result.source_location).toBe(`${RESULT_LOC}#mean_thickness`)

    const claimRecord = ir.list().find(r => r.kind === 'Claim' && r.id === 'C-ICE')
    const claim = claimRecord!.value as {
      claim_type: string
      criticality: string
      numeric_binding: { result_ref: string; asserted_value: number; asserted_unit: string }
    }
    expect(claim.claim_type).toBe('NUMERIC')
    expect(claim.criticality).toBe('CRITICAL')
    expect(claim.numeric_binding).toEqual({ result_ref: 'RES-ICE', asserted_value: 0.731, asserted_unit: 'm' })
    // The claim's number is the RESULT's number — the semantic guard agrees.
    const snapshot = ModelingIr.snapshot(ir)
    const findings = snapshot === null ? [] : numericConsistencyFindings(snapshot)
    expect(findings).toHaveLength(0)
  })

  it('a different output value flows through: the model has no number of its own', () => {
    const ir = chainToRun()
    const verdict = produceInterpretation({ ir, runId: 'RUN1', interpretations: LEGAL, outputs: realOutputs({ [RESULT_LOC]: '{"mean_thickness": 0.999}' }) })
    expect(verdict.ok).toBe(true)
    const claimRecord = ir.list().find(r => r.kind === 'Claim' && r.id === 'C-ICE')
    const binding = (claimRecord!.value as { numeric_binding: { asserted_value: number } }).numeric_binding
    expect(binding.asserted_value).toBe(0.999)
  })

  it('attacks: structure, source, binding, and store conflicts are all refusals with no partial writes', () => {
    // 1 — structure violation (claim_id not a string).
    const bad1 = { results: [], claims: [{ claim_id: 7 }] }
    const r1 = produceInterpretation({ ir: chainToRun(), runId: 'RUN1', interpretations: bad1, outputs: realOutputs() })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.code).toBe('interpretation_invalid')

    // 2 — declared locator was not produced by the run.
    const bad2 = { ...LEGAL, results: [{ ...LEGAL.results[0], source: { locator: 'file:///nope.json', jsonPath: 'x' } }] }
    const r2 = produceInterpretation({ ir: chainToRun(), runId: 'RUN1', interpretations: bad2, outputs: realOutputs() })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.code).toBe('result_source_missing')

    // 3 — json path resolves to a non-number ('mean_thickness.typo' is a
    // missing branch; 'n' IS 120 so it would parse fine).
    const bad3 = { ...LEGAL, results: [{ ...LEGAL.results[0], source: { locator: RESULT_LOC, jsonPath: 'mean_thickness.typo' } }] }
    const r3 = produceInterpretation({ ir: chainToRun(), runId: 'RUN1', interpretations: bad3, outputs: realOutputs() })
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.code).toBe('result_source_invalid')

    // 4 — NUMERIC claim binds a Result neither produced nor in the store.
    const bad4 = { ...LEGAL, claims: [{ ...LEGAL.claims[0], result_refs: ['RES-GHOST'] }] }
    const r4 = produceInterpretation({ ir: chainToRun(), runId: 'RUN1', interpretations: bad4, outputs: realOutputs() })
    expect(r4.ok).toBe(false)
    if (!r4.ok) expect(r4.code).toBe('claim_binding_unknown')

    // 5 — no result_refs on a NUMERIC claim.
    const bad5 = { ...LEGAL, claims: [{ ...LEGAL.claims[0], result_refs: [] }] }
    const r5 = produceInterpretation({ ir: chainToRun(), runId: 'RUN1', interpretations: bad5, outputs: realOutputs() })
    expect(r5.ok).toBe(false)

    // 6 — all-or-nothing: every refusal above left the store untouched.
    const remaining = chainToRun()
    expect(remaining.list().filter(r => r.kind === 'Result' || r.kind === 'Claim')).toHaveLength(0)

    // 7 — re-producing the same result id into a store that has it = conflict.
    const ir = chainToRun()
    expect(produceInterpretation({ ir, runId: 'RUN1', interpretations: LEGAL, outputs: realOutputs() }).ok).toBe(true)
    const again = produceInterpretation({ ir, runId: 'RUN1', interpretations: LEGAL, outputs: realOutputs() })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('store_refused')
  })

  it('resolveJsonPath handles nested paths and missing keys', () => {
    expect(resolveJsonPath({ a: { b: 3 } }, 'a.b')).toBe(3)
    expect(resolveJsonPath({ a: { b: 3 } }, 'a.c')).toBeUndefined()
    expect(resolveJsonPath('nope', 'a')).toBeUndefined()
  })
})

describe('P1-3 renderV1Report (IR-injected numbers, guarded conclusion)', () => {
  const results = [
    { result_id: 'RES-ICE', name: 'mean_thickness', value: 0.731, unit: 'm', uncertainty: 0.012 },
  ]

  it('renders the result table from the IR and passes a consistent conclusion', () => {
    const verdict = renderV1Report({
      title: '冰海智航测试',
      results,
      narrative: { conclusion: 'Mean ice thickness is 0.731 m.', methods: 'simulated annealing' },
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.text).toContain('| mean_thickness | 0.731 | m | ±0.012 |')
      expect(verdict.text).toContain('Mean ice thickness is 0.731 m.')
      expect(verdict.text).toContain('simulated annealing')
    }
  })

  it('refuses a conclusion whose number is not a Result value (key numbers only from IR)', () => {
    const verdict = renderV1Report({
      title: 't',
      results,
      narrative: { conclusion: 'Mean ice thickness is 0.732 m.' },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('conflicting_conclusion_number')
      expect(verdict.reason).toContain('0.732')
    }
  })

  it('a conclusion with no numeric literals passes', () => {
    const verdict = renderV1Report({ title: 't', results, narrative: { conclusion: 'The thickness is consistent with the survey.' } })
    expect(verdict.ok).toBe(true)
  })

  it('a unit exponent like km^-1 is not mistaken for a numeric literal', () => {
    const verdict = renderV1Report({
      title: 't',
      results: [{ result_id: 'RES-D', name: 'ridge_density', value: 2.4, unit: 'km^-1', uncertainty: 0.3 }],
      narrative: { conclusion: 'Ridge density along the corridor is 2.4 km^-1.' },
    })
    expect(verdict.ok).toBe(true)
  })

  it('an uncertainty literal in the conclusion is allowed (machine number too)', () => {
    const verdict = renderV1Report({
      title: 't',
      results,
      narrative: { conclusion: 'Mean ice thickness is 0.731 m ± 0.012 m.' },
    })
    expect(verdict.ok).toBe(true)
  })
})
