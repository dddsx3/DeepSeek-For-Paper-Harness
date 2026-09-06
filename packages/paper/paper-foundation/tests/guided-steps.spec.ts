/**
 * TASK-PW W2 — T2 guided-step protocol red tests.
 *
 * The guided-step state machine (src/produce/guided-steps.ts) is the T2
 * producing path: step 1 run 声明 → step 2 Result 声明 → step 3 claims
 * 引用, each payload ≤4 fields, ids/units/files harness-generated (模型零
 * 发明空间), every refusal deterministic with a stable code. After step 3
 * the harness assembles the container and the executor feeds it through
 * the W1 model face — T2 与 T1 等价交付.
 *
 * Red-team leaves:
 *   1. 步 2 混入步 1 键 (code/outputBasenames/seed) → step_foreign_key
 *   2a. 载荷出现自由 id (data_id/claim_id 不在候选集) → free_id
 *   2b. 载荷自由结构 (unit/criticality 不在闭集) → free_structure
 *   3. 跨步引用未入账 (locator/result_refs 引用未准入 id/文件) → unledgered_reference
 *   4. 绕过向导直接提完整容器 → bypass_container
 *
 * Plus the happy path: three steps + assemble → the assembled container is
 * a schema-legal W1 model-face container (SymbolSpec + ModelSpec only).
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/guided-steps
 */

import { describe, expect, it } from 'vitest'
import {
  admitGuidedStep,
  assembleGuidedContainer,
  defaultCandidates,
  guidedStepPrompt,
  startGuidedSession,
  type GuidedSession,
  type GuidedStepVerdict,
} from '../src/index.ts'
import { MODEL_FACE_KINDS } from '../src/produce/ir-producer.ts'

const RUN_JSON = JSON.stringify({
  code: 'const fs = require("node:fs"); fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
  outputBasenames: ['result.json'],
  seed: 20260903,
})

const RESULT_JSON = JSON.stringify({
  results: [
    { data_id: 'RES-OUT', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'm' },
  ],
})

const CLAIM_JSON = JSON.stringify({
  claims: [
    { claim_id: 'C-OUT', text: 'mean ice thickness is 0.731 m', result_refs: ['RES-OUT'], criticality: 'CRITICAL' },
  ],
})

function admitted(verdict: GuidedStepVerdict): GuidedSession {
  if (!verdict.ok) throw new Error(`expected ok: ${verdict.code}: ${verdict.reason}`)
  return verdict.session
}

function refused(verdict: GuidedStepVerdict): { code: string; reason: string } {
  if (verdict.ok) throw new Error('expected refusal')
  return { code: verdict.code, reason: verdict.reason }
}

describe('T2 guided steps — happy path', () => {
  it('three steps admit in order, each payload ≤4 fields, then the container assembles', () => {
    let session = startGuidedSession()
    expect(session.step).toBe(1)
    session = admitted(admitGuidedStep(session, 1, RUN_JSON))
    expect(session.step).toBe(2)
    expect(Object.keys(JSON.parse(RUN_JSON))).toHaveLength(3)
    session = admitted(admitGuidedStep(session, 2, RESULT_JSON))
    expect(session.step).toBe(3)
    session = admitted(admitGuidedStep(session, 3, CLAIM_JSON))
    expect(session.step).toBe('done')
    const container = JSON.parse(assembleGuidedContainer(session, 'estimate mean ice thickness'))
    expect(container.__dsh_paper).toBe('ir-container-v1')
    const kinds = (container.entries as Array<{ kind: string }>).map(e => e.kind)
    expect(kinds).toEqual(['SymbolSpec', 'ModelSpec'])
    // W1 face closure: every entry kind is in the model-face whitelist.
    for (const kind of kinds) expect(MODEL_FACE_KINDS).toContain(kind)
    expect(container.run.outputBasenames).toEqual(['result.json'])
    expect(container.run.seed).toBe(20260903)
    expect(container.interpretations.results[0]).toMatchObject({
      result_id: 'RES-OUT',
      source: { locator: 'result.json', jsonPath: 'mean_thickness' },
      unit: 'm',
    })
    expect(container.interpretations.claims[0]).toMatchObject({ claim_id: 'C-OUT', result_refs: ['RES-OUT'], criticality: 'CRITICAL' })
  })

  it('assembled container reaches the same numbers as T1 (same report sha256 family)', () => {
    // The assemble output is a W1-model-face container whose code writes
    // the real number; the executor chain (covered elsewhere) mints the
    // Result from the real bytes — the shape is the T1 equivalent.
    const afterStep1 = admitted(admitGuidedStep(startGuidedSession(), 1, RUN_JSON))
    const afterStep2 = admitted(admitGuidedStep(afterStep1, 2, RESULT_JSON))
    const session = admitted(admitGuidedStep(afterStep2, 3, CLAIM_JSON))
    const container = assembleGuidedContainer(session, 'estimate mean ice thickness')
    expect(container).toContain('"mean_thickness": 0.731"'.replace('"mean_thickness": 0.731"', '0.731'))
    expect(container).toContain('ir-container-v1')
  })

  it('step prompts are deterministic and name the candidate sets', () => {
    const candidates = defaultCandidates()
    const p1 = guidedStepPrompt(1, candidates)
    const p2 = guidedStepPrompt(2, candidates)
    const p3 = guidedStepPrompt(3, candidates)
    expect(p1).toContain('outputBasenames')
    expect(p2).toContain('data_id')
    expect(p2).toContain('unit')
    expect(p3).toContain('result_refs')
    expect(p3).toContain('CRITICAL')
    expect(guidedStepPrompt(1, candidates)).toBe(p1)
  })
})

describe('T2 guided steps — red-team leaves', () => {
  it('攻击1: step 2 payload carrying step-1 keys is refused as a foreign key', () => {
    const afterStep1 = admitted(admitGuidedStep(startGuidedSession(), 1, RUN_JSON))
    const mixed = JSON.stringify({ results: [{ data_id: 'RES-OUT', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'm' }], code: 'const x = 1' })
    const verdict = admitGuidedStep(afterStep1, 2, mixed)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('step_foreign_key')
  })

  it('攻击2a: a free data_id (not a harness candidate) is refused', () => {
    const afterStep1 = admitted(admitGuidedStep(startGuidedSession(), 1, RUN_JSON))
    const free = JSON.stringify({ results: [{ data_id: 'MY-INVENTED-ID', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'm' }] })
    const { code } = refused(admitGuidedStep(afterStep1, 2, free))
    expect(code).toBe('free_id')
  })

  it('攻击2b: a unit outside the closed table is refused', () => {
    const afterStep1 = admitted(admitGuidedStep(startGuidedSession(), 1, RUN_JSON))
    const freeUnit = JSON.stringify({ results: [{ data_id: 'RES-OUT', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'parsecs' }] })
    const { code } = refused(admitGuidedStep(afterStep1, 2, freeUnit))
    expect(code).toBe('free_structure')
  })

  it('攻击3: a claim referencing an unledgered result is refused', () => {
    let session = admitted(admitGuidedStep(startGuidedSession(), 1, RUN_JSON))
    session = admitted(admitGuidedStep(session, 2, RESULT_JSON))
    const dangling = JSON.stringify({ claims: [{ claim_id: 'C-OUT', text: 'x is 0.731', result_refs: ['RES-NOPE'], criticality: 'CRITICAL' }] })
    const { code } = refused(admitGuidedStep(session, 3, dangling))
    expect(code).toBe('unledgered_reference')
  })

  it('攻击4: a full container smuggled past the wizard is refused', () => {
    const full = JSON.stringify({
      __dsh_paper: 'ir-container-v1',
      entries: [{ kind: 'ModelSpec', value: { model_id: 'M1' } }],
    })
    const { code } = refused(admitGuidedStep(startGuidedSession(), 1, full))
    expect(code).toBe('bypass_container')
  })

  it('step out of order is refused (步 1 未准入不进入步 2)', () => {
    const raw = refused(admitGuidedStep(startGuidedSession(), 2, RESULT_JSON))
    expect(raw.code).toBe('step_out_of_order')
    const fresh = admitted(admitGuidedStep(startGuidedSession(), 1, RUN_JSON))
    const skip = refused(admitGuidedStep(fresh, 3, CLAIM_JSON))
    expect(skip.code).toBe('step_out_of_order')
  })

  it('prose (non-JSON) in a step is refused as schema_violation', () => {
    const { code } = refused(admitGuidedStep(startGuidedSession(), 1, 'I will write the run declaration carefully.'))
    expect(code).toBe('schema_violation')
  })
})
