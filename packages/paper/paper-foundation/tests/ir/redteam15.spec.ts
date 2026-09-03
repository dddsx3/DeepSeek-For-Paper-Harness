/**
 * Regressions for the escape paths found by the TASK 1.5 red team.
 *
 * Every test here corresponds to a finding that was *exploited*, not merely
 * theorised: each one passed delivery (or poisoned canonical state) against
 * the first TASK 1.5 implementation, and each is the regression that had to
 * go red before its fix was accepted. They are kept in a dedicated file so
 * the next red team can see exactly which doors were tried.
 *
 * Roles, per task book §12:
 *   RT-A  schema / parser attacker
 *   RT-B  reference graph attacker
 *   RT-C  workflow bypass attacker
 *   RT-D  semantic drift attacker
 */

import { describe, expect, it } from 'vitest'
import {
  CAPTURE_ATTESTATION,
  ModelingIr,
  evaluateIrBridge,
  type IrKind,
} from '../../src/ir/index.ts'
import { findDuplicateSymbolTokens } from '../../src/ir/problem-contract.ts'
import { validChain, variableSymbol } from './fixtures.ts'

type Entry = { kind: IrKind; value: Record<string, unknown> }

/** Ingest the full TASK 1.5 chain, applying `overrides` per kind. */
function build(
  overrides: Partial<Record<IrKind, Record<string, unknown>>> = {},
  extra: ReadonlyArray<Entry> = [],
  omit: ReadonlyArray<IrKind> = [],
): { ir: ModelingIr; refused: ReadonlyArray<{ kind: IrKind; failures: unknown }> } {
  const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
  const refused: { kind: IrKind; failures: unknown }[] = []
  for (const entry of [...validChain(), ...extra]) {
    if (omit.includes(entry.kind)) continue
    const value = { ...entry.value, ...(overrides[entry.kind] ?? {}) }
    // 5.0-R (R3-1): ExecutionRecord cannot enter via `put` (INV-3-M /
    // 3.R3 closed that door) — it must go through the producer-only
    // `putExecutionRecord(record, CAPTURE_ATTESTATION)` door, exactly as
    // the stale-engine and backbone fixtures do. Assertions unchanged:
    // this migration restores the seven RT-A/B/C/D suites' coverage that
    // the direct-put refusal had been silently blocking.
    const verdict = entry.kind === 'ExecutionRecord'
      ? ir.putExecutionRecord(value as never, CAPTURE_ATTESTATION)
      : ir.put(entry.kind, value)
    if (!verdict.accepted) refused.push({ kind: entry.kind, failures: verdict.failures })
  }
  return { ir, refused }
}

describe('RT-A-01 — non-finite numbers cannot enter canonical state', () => {
  // PROBED, FOUND CLOSED. The attack was that `z.number()` accepts NaN and
  // ±Infinity: a parameter value of NaN poisons every downstream computation
  // silently — the symbol is bound, the role is right, the contract is
  // satisfied, and the number is garbage. Zod's number schema already
  // rejects non-finite values, so this is not an escape. These tests are kept
  // so the next red team does not have to re-derive the result, and so a
  // future schema change cannot quietly reopen it.
  for (const bad of [NaN, Infinity, -Infinity]) {
    it(`refuses parameter_refs[].value = ${bad}`, () => {
      const { refused } = build({ ModelSpec: { parameter_refs: [{ symbol_ref: 'SYM-rho', value: bad }] } })
      expect(refused.map(r => r.kind)).toContain('ModelSpec')
    })

    it(`refuses Result.value = ${bad}`, () => {
      const { refused } = build({ Result: { value: bad } })
      expect(refused.map(r => r.kind)).toContain('Result')
    })

    it(`refuses Result.uncertainty = ${bad}`, () => {
      const { refused } = build({ Result: { uncertainty: bad } })
      expect(refused.map(r => r.kind)).toContain('Result')
    })
  }

  it('still accepts a finite parameter value (guard is not a blanket refusal)', () => {
    const { ir, refused } = build({ ModelSpec: { parameter_refs: [{ symbol_ref: 'SYM-rho', value: 917 }] } })
    expect(refused).toEqual([])
    expect(evaluateIrBridge(ir, [], 'FORMAL').status).toBe('PASS')
  })
})

describe('RT-A-02 — the typed ingress carries the same size budget as the text ingress', () => {
  // `MAX_IR_JSON_CHARS` is enforced inside `parseStrictJson`, so it only ever
  // guarded the text path. A payload handed to `put()` as a live object walked
  // `scanIrValue` — which bounded depth but not size — and was admitted:
  // 200k `requirement_refs` is ~1.4 MB of JSON, refused as text and accepted
  // as an object. Choosing the ingress path was enough to lift the budget.
  // 120k refs clears both budgets at once — >100k nodes for the typed path,
  // and ~1.3 MB of JSON text against the 1 MiB character cap — while staying
  // small enough not to make the test run itself a memory-pressure flake.
  const oversized = Array.from({ length: 120_000 }, (_, i) => 'R' + i)

  it('refuses an oversized ref array handed to put() as a live object', () => {
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    const verdict = ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'x', requirement_refs: oversized })
    expect(verdict.accepted).toBe(false)
  })

  it('refuses the same payload arriving as text', () => {
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    const text = JSON.stringify({ problem_id: 'P1', raw_problem_ref: 'x', requirement_refs: oversized })
    expect(ir.ingestJson('ProblemSpec', text).accepted).toBe(false)
  })

  it('refuses a realistically sized ref array whose refs do not resolve (TASK 1.5R)', () => {
    // TASK 1.5R: the store now refuses ANY IR-internal dangling reference, not
    // just oversized ones. The previous 500-dangling-accepted expectation was
    // a coverage gap — proving the size guard fires while accepting a
    // dangling ref is exactly the fail-open this test used to exercise.
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    const refs = Array.from({ length: 500 }, (_, i) => 'R' + i)
    const verdict = ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-NOPE', requirement_refs: refs })
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'unresolved_reference')).toBe(true)
    }
  })
})

describe('RT-B-01 — a ModelSpec owned by no ProblemSpec still faces the symbol guards', () => {
  // The bridge filtered ModelSpecs by `problem_refs.includes(problem_id)`,
  // so a ModelSpec declaring `problem_refs: []` was never handed to any
  // ProblemSpec's contract walk. Every ModelSpec guard — variable role,
  // parameter role, symbol scope — was skipped entirely, and the run
  // delivered while using a PARAMETER as a solved-for variable.
  it('blocks a PARAMETER used as a variable by an unowned ModelSpec', () => {
    const { ir, refused } = build({ ModelSpec: { problem_refs: [], variable_refs: ['SYM-rho'] } })
    expect(refused).toEqual([]) // the store has nothing to say; the bridge must
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.contractFailures.map(f => f.kind)).toContain('symbol_role_mismatch')
  })

  it('blocks a VARIABLE used as a parameter by an unowned ModelSpec', () => {
    const { ir } = build({ ModelSpec: { problem_refs: [], parameter_refs: [{ symbol_ref: 'SYM-x', value: 1 }] } })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.contractFailures.map(f => f.kind)).toContain('parameter_role_mismatch')
  })

  it('passes when an unowned ModelSpec claims no symbols at all', () => {
    // Not a loophole: a model that declares no problem and uses no symbol has
    // nothing for the symbol guards to check. The escape was an unowned model
    // that *did* use another problem's symbols.
    const { ir, refused } = build({ ModelSpec: { problem_refs: [], variable_refs: [], parameter_refs: [] } })
    expect(refused).toEqual([])
    expect(evaluateIrBridge(ir, [], 'FORMAL').status).toBe('PASS')
  })
})

describe('RT-C-01 — the minimum contract is bound to a ProblemSpec, not counted globally', () => {
  // `minimumProblemContractSatisfied` counted REQUIRED_OUTPUT RequirementSpecs
  // and SymbolSpecs across the whole store. A ProblemSpec with
  // `requirement_refs: []` therefore "satisfied" the contract as long as some
  // unrelated REQUIRED_OUTPUT existed somewhere in the store — the declared
  // problem could ask for nothing at all and still reach FORMAL delivery.
  it('blocks a ProblemSpec that declares no REQUIRED_OUTPUT requirement', () => {
    const { ir, refused } = build({ ProblemSpec: { requirement_refs: [] } })
    expect(refused).toEqual([])
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.contractFailures.map(f => f.kind)).toContain('missing_required_output_requirement')
    expect(decision.contractSatisfied).toBe(false)
  })

  it('blocks a ProblemSpec whose only requirements are SUBPROBLEM/CONSTRAINT', () => {
    const { ir } = build({ ProblemSpec: { requirement_refs: ['R1', 'R-CON'] } })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.contractSatisfied).toBe(false)
  })

  it('blocks in FAST too — the bypass is not mode-specific', () => {
    const { ir } = build({ ProblemSpec: { requirement_refs: [] } })
    expect(evaluateIrBridge(ir, [], 'fast').status).toBe('BLOCKED')
  })

  it('does not credit a REQUIRED_OUTPUT that no ProblemSpec references', () => {
    // R-ORPHAN exists in canonical state but is referenced by nothing.
    const { ir, refused } = build({ ProblemSpec: { requirement_refs: ['R1'] } }, [
      { kind: 'RequirementSpec', value: { requirement_id: 'R-ORPHAN', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'orphan' } },
    ])
    expect(refused).toEqual([])
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.contract.requiredOutputRequirements).not.toContain('R-ORPHAN')
  })
})

describe('RT-C-02 — the minimum contract is a gate of its own', () => {
  // Found by PHASE 7, not by the red team: removing the `contractSatisfied`
  // term from the bridge verdict left every suite green. The per-element
  // contract failures had grown to cover almost everything it checks — but
  // not this. Without a SymbolSpec there is no dangling ref and no wrong
  // role, because there is no symbol to get wrong; the minimum contract is
  // the only thing that notices the paper never declared what its symbols
  // mean. Per task book §13, a surviving mutation is answered with a test.
  it('blocks delivery when no SymbolSpec is declared at all', () => {
    const { ir, refused } = build(
      { ModelSpec: { variable_refs: [], parameter_refs: [] } },
      [],
      ['SymbolSpec'],
    )
    expect(refused).toEqual([])
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.contractFailures).toEqual([])
    expect(decision.contractSatisfied).toBe(false)
    expect(decision.status).toBe('BLOCKED')
  })

  it('blocks in FAST too', () => {
    const { ir } = build({ ModelSpec: { variable_refs: [], parameter_refs: [] } }, [], ['SymbolSpec'])
    expect(evaluateIrBridge(ir, [], 'fast').status).toBe('BLOCKED')
  })
})

describe('RT-D-01 — same-scope token uniqueness is Unicode-aware', () => {
  // `findDuplicateSymbolTokens` keyed on the raw token bytes, while
  // `symbolTokenSchema` allowed any string free of control/format/surrogate/
  // separator characters. 'é' (U+00E9) and 'é' (e + U+0301) are canonically
  // equivalent and byte-distinct, so one problem scope could hold two
  // SymbolSpecs for "the same" symbol with different meanings and units —
  // precisely the silent re-interpretation TASK 1.5 exists to prevent.
  // Built from code points rather than literals: an accented literal in
  // this file collapses to one byte sequence whichever way the editor
  // normalises it, and the entire attack is that two spellings exist.
  const composed = String.fromCodePoint(0xe9) // U+00E9, precomposed
  const decomposed = String.fromCodePoint(0x65, 0x301) // 'e' + U+0301

  it('the two spellings are canonically equivalent but byte-distinct', () => {
    expect(composed).not.toBe(decomposed)
    expect(composed.normalize('NFC')).toBe(decomposed.normalize('NFC'))
  })

  it('refuses the second, non-NFC spelling at ingest', () => {
    const { refused } = build({}, [
      { kind: 'SymbolSpec', value: variableSymbol({ symbol_id: 'SYM-decomp', token: decomposed, meaning: 'a different quantity', unit: 's' }) },
    ])
    expect(refused.map(r => r.kind)).toContain('SymbolSpec')
  })

  it('never lets a second spelling of one token enter canonical state', () => {
    // The refusal now happens at ingest, which is strictly stronger than
    // catching the duplicate later: canonical state cannot hold two meanings
    // for one symbol even briefly, so there is nothing downstream to detect.
    const { ir } = build({}, [
      { kind: 'SymbolSpec', value: variableSymbol({ symbol_id: 'SYM-decomp', token: decomposed, meaning: 'a different quantity', unit: 's' }) },
    ])
    const stored = ir.list().filter(r => r.kind === 'SymbolSpec')
    // Every surviving token is already NFC, so the byte-exact uniqueness
    // check is comparing canonical forms and is therefore sound.
    expect(stored.every(r => (r.value as { token: string }).token.normalize('NFC') === (r.value as { token: string }).token)).toBe(true)
    expect(findDuplicateSymbolTokens(stored.map(r => r.value as Record<string, unknown>))).toEqual([])
    expect(evaluateIrBridge(ir, [], 'FORMAL').status).toBe('PASS')
  })

  it('still accepts a genuine NFC token (guard is not a blanket refusal)', () => {
    const { refused } = build({}, [
      { kind: 'SymbolSpec', value: variableSymbol({ symbol_id: 'SYM-acc', token: composed, meaning: 'along-track offset', unit: 'm' }) },
    ])
    expect(refused).toEqual([])
  })
})
