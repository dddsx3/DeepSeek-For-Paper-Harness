/**
 * TASK-PW W3 — T3 template-fill red tests.
 *
 * The smallest producing face: the model's ENTIRE output is a slot-to-
 * candidate mapping (symbol_id / unit / output_file / json_path) and every
 * value must come from the harness's closed candidate table (模型零发明
 * 空间). Numbers never come from the model (攻击1 — 数字零通道保持) and
 * container-shaped JSON never rides in a T3 payload (攻击2).
 *
 * Red-team leaves:
 *   1. 自由数字出现 → t3_number_forbidden (ESCAPE-class, zero budget).
 *   2. 容器形 JSON 混入 → t3_container_forbidden.
 *   3. 非候选槽值 (free choice) → t3_free_choice.
 *   4. 非 fill-in 形状 (prose / wrong keys) → t3_schema_violation.
 * Plus the happy path: a valid fill-in admits, assembles a W1-model-face
 * container, and the container is schema-legal (SymbolSpec + ModelSpec).
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/template-fill
 */

import { describe, expect, it } from 'vitest'
import {
  admitTemplateFill,
  assembleTemplateContainer,
  defaultTemplateCandidates,
  templateFillPrompt,
  type TemplateFill,
} from '../src/index.ts'
import { MODEL_FACE_KINDS } from '../src/produce/ir-producer.ts'

const FILL_OK = JSON.stringify({
  symbol_id: 'SYM-q',
  unit: 'm',
  output_file: 'result.json',
  json_path: 'mean_thickness',
})

function refused(fill: TemplateFill): { code: string; reason: string } {
  if (fill.ok) throw new Error('expected refusal')
  return { code: fill.code, reason: fill.reason }
}

describe('T3 template fill — happy path', () => {
  it('a valid fill-in admits and assembles a W1-model-face container', () => {
    const admitted = admitTemplateFill(FILL_OK)
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    expect(admitted.fill).toEqual({
      symbol_id: 'SYM-q',
      unit: 'm',
      output_file: 'result.json',
      json_path: 'mean_thickness',
    })
    const container = JSON.parse(assembleTemplateContainer(admitted.fill, 'estimate mean ice thickness'))
    expect(container.__dsh_paper).toBe('ir-container-v1')
    const kinds = (container.entries as Array<{ kind: string }>).map(e => e.kind)
    expect(kinds).toEqual(['SymbolSpec', 'AssumptionSpec', 'EquationSpec', 'ModelSpec'])
    for (const kind of kinds) expect(MODEL_FACE_KINDS).toContain(kind)
    expect(container.run.outputBasenames).toEqual(['result.json'])
    expect(container.interpretations.results[0]).toMatchObject({
      result_id: 'RES-OUT',
      source: { locator: 'result.json', jsonPath: 'mean_thickness' },
      unit: 'm',
    })
  })

  it('the prompt is deterministic and names every candidate set', () => {
    const candidates = defaultTemplateCandidates()
    const prompt = templateFillPrompt(candidates)
    for (const piece of ['symbol_id', 'unit', 'output_file', 'json_path', 'SYM-q', 'mean_thickness']) {
      expect(prompt).toContain(piece)
    }
    expect(templateFillPrompt(candidates)).toBe(prompt)
  })
})

describe('T3 template fill — red-team leaves', () => {
  it('攻击1: a free number in the fill-in is refused (数字零通道保持)', () => {
    const withNumber = '{"symbol_id": "SYM-q", "unit": "m", "output_file": "result.json", "json_path": "mean_thickness", "note": "0.731"}'
    const { code } = refused(admitTemplateFill(withNumber))
    expect(code).toBe('t3_number_forbidden')
  })

  it('攻击1b: even a bound-looking number in prose is refused', () => {
    const prose = 'SYM-q m result.json mean_thickness and the value is 0.731'
    const { code } = refused(admitTemplateFill(prose))
    expect(code).toBe('t3_number_forbidden')
  })

  it('攻击2: a container-shaped payload is refused', () => {
    const container = JSON.stringify({
      __dsh_paper: 'ir-container-v1',
      entries: [{ kind: 'ModelSpec', value: { model_id: 'M1' } }],
    })
    const { code } = refused(admitTemplateFill(container))
    expect(code).toBe('t3_container_forbidden')
  })

  it('attack 3: a non-candidate slot value is refused as a free choice', () => {
    const freeUnit = '{"symbol_id": "SYM-q", "unit": "parsecs", "output_file": "result.json", "json_path": "mean_thickness"}'
    const { code } = refused(admitTemplateFill(freeUnit))
    expect(code).toBe('t3_free_choice')
  })

  it('attack 4: prose (non-fill-in shape) is refused as schema_violation', () => {
    const { code } = refused(admitTemplateFill('I will estimate the thickness carefully.'))
    expect(code).toBe('t3_schema_violation')
  })

  it('attack 5: a foreign top-level key is refused', () => {
    const foreign = '{"symbol_id": "SYM-q", "unit": "m", "output_file": "result.json", "json_path": "mean_thickness", "code": "x"}'
    const { code } = refused(admitTemplateFill(foreign))
    expect(code).toBe('t3_schema_violation')
  })
})
