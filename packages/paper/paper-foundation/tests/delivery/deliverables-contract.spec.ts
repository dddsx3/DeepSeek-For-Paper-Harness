/**
 * R1② — DELIVERABLES contract tests (schema + fail-closed findings).
 *
 * 正例/反例都按路线书 R1② 判据：缺项必红（NR-5 地板块）、空壳必红、
 * 契约本身不合法不猜测、xlsx 内容未机器读时要诚实注明而非假装已核。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/deliverables-contract
 */

import { describe, expect, it } from 'vitest'
import {
  deliverablesContractFindings,
  parseDeliverablesContract,
  type ActualDeliverable,
} from '../../src/delivery/deliverables-contract.ts'

/** The reference contract from REF-D's own DELIVERABLES.json (result1-4 + json/md). */
const REF_D_11 = {
  deliverables: [
    { file: 'result1.xlsx', kind: 'xlsx', sheets: ['温度', '水分浓度'], min_rows: 1800, min_cols: 21, min_bytes: 1000, desc: 'problem 1' },
    { file: 'result2.xlsx', kind: 'xlsx', sheets: ['温度', '水分浓度'], min_rows: 10800, min_cols: 21, min_bytes: 1000, desc: 'problem 2' },
    { file: 'figures/all_results.json', kind: 'json', min_bytes: 1000, desc: 'summary' },
    { file: 'code/main.py', kind: 'other', min_bytes: 500, desc: 'orchestrator' },
    { file: 'RESULTS.md', kind: 'md', min_bytes: 1024, desc: 'results note' },
  ],
}

function actual(entries: ReadonlyArray<[string, ActualDeliverable]>): Map<string, ActualDeliverable> {
  return new Map(entries)
}

describe('deliverables-contract — schema（闭集不漂移）', () => {
  it('the REF-D 11-item shape parses (kind 闭集 = xlsx/json/md/other)', () => {
    const verdict = parseDeliverablesContract(REF_D_11)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.contract.deliverables).toHaveLength(5)
  })

  it('an unknown kind is rejected (闭集拒绝)', () => {
    const bad = { deliverables: [{ file: 'a.txt', kind: 'pdf', min_bytes: 1 }] }
    expect(parseDeliverablesContract(bad).ok).toBe(false)
  })

  it('an item without min_bytes is rejected (REF-D 每项都有)', () => {
    const bad = { deliverables: [{ file: 'a.json', kind: 'json' }] }
    expect(parseDeliverablesContract(bad).ok).toBe(false)
  })

  it('an empty deliverables array is rejected (契约至少要声明一项)', () => {
    expect(parseDeliverablesContract({ deliverables: [] }).ok).toBe(false)
  })
})

describe('deliverables-contract — findings（fail-closed 判定）', () => {
  const parsed = parseDeliverablesContract(REF_D_11)
  if (!parsed.ok) throw new Error('fixture contract must parse')
  const contract = parsed.contract

  it('every item present with ≥ min_bytes passes (正例)', () => {
    const findings = deliverablesContractFindings(contract, actual([
      ['result1.xlsx', { bytes: 2000 }],
      ['result2.xlsx', { bytes: 2400 }],
      ['figures/all_results.json', { bytes: 1500 }],
      ['code/main.py', { bytes: 600 }],
      ['RESULTS.md', { bytes: 2000 }],
    ]))
    // xlsx rows/cols stay an explicit "not machine-read yet" note — honest, not silent.
    const blocking = findings.filter(f => f.kind !== 'xlsx_content_unverified')
    expect(blocking).toEqual([])
    expect(findings.filter(f => f.kind === 'xlsx_content_unverified')).toHaveLength(2)
  })

  it('NR-5（地板块）：删掉契约要求的一个文件 → 校验必红', () => {
    const findings = deliverablesContractFindings(contract, actual([
      ['result1.xlsx', { bytes: 2000 }],
      ['result2.xlsx', { bytes: 2400 }],
      ['figures/all_results.json', { bytes: 1500 }],
      ['code/main.py', { bytes: 600 }],
      // RESULTS.md deleted
    ]))
    const missing = findings.find(f => f.kind === 'deliverable_missing' && f.item === 'RESULTS.md')
    expect(missing).toBeDefined()
    if (missing !== undefined) expect(missing.reason).toContain('RESULTS.md')
  })

  it('files below min_bytes are hollow deliverables (形态 1 假绿变红)', () => {
    const findings = deliverablesContractFindings(contract, actual([
      ['result1.xlsx', { bytes: 10 }],
      ['result2.xlsx', { bytes: 2400 }],
      ['figures/all_results.json', { bytes: 1500 }],
      ['code/main.py', { bytes: 600 }],
      ['RESULTS.md', { bytes: 2000 }],
    ]))
    expect(findings.some(f => f.kind === 'deliverable_too_small' && f.item === 'result1.xlsx')).toBe(true)
  })

  it('an item absent AND a sibling empty → two independent findings (逐项)', () => {
    const findings = deliverablesContractFindings(contract, actual([
      ['result2.xlsx', { bytes: 5 }],
    ]))
    const kindsOf = (item: string) => findings.filter(f => f.item === item).map(f => f.kind)
    expect(kindsOf('result1.xlsx')).toContain('deliverable_missing')
    expect(kindsOf('result2.xlsx')).toContain('deliverable_too_small')
    expect(kindsOf('result2.xlsx')).toContain('xlsx_content_unverified') // honest note side by side
  })
})
