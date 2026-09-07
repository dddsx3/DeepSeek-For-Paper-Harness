/**
 * TASK-PW W3 — T3 template-fill protocol (W-A sign-off A).
 *
 * The smallest face: the model never writes free JSON and never writes a
 * number. The harness presents a FILL-IN template with closed candidate
 * sets, and the model's ENTIRE payload is a slot-to-candidate mapping:
 *
 *   {"symbol_id": "<candidate>", "unit": "<candidate>",
 *    "output_file": "<candidate>", "json_path": "<candidate>"}
 *
 * every value MUST come from the harness-provided candidates (模型零发明
 * 空间). Two hard refusals, both ESCAPE-class (W4 zero budget):
 *
 *   攻击1: any number (bound or free) in the model text → refused — the
 *          numeric zero-channel is preserved: numbers only ever flow
 *          code → jsonPath → Result → Claim, never from the model's pen.
 *   攻击2: any container-shaped JSON (__dsh_paper / entries / run /
 *          interpretations) smuggled in place of the fill-in → refused.
 *
 * After the fill-in admits, the harness assembles the W1-model-face
 * container and feeds it through the SAME producer / chain / gates as T1
 * and T2 (同信任链). T3 is the fallback the W4 tier ledger reaches after
 * T2 NONE-exhaustion.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/template-fill
 */

import { z as zod } from 'zod'

/** The T3 fill-in slots the harness presents (each maps to a candidate). */
export type TemplateSlot = 'symbol_id' | 'unit' | 'output_file' | 'json_path'

/** Stable T3 refusal codes. */
export type TemplateRefusalCode =
  | 't3_number_forbidden'       // 攻击1: a number appears in the model text
  | 't3_container_forbidden'    // 攻击2: container-shaped JSON smuggled in
  | 't3_schema_violation'       // not the fill-in shape at all
  | 't3_free_choice'            // a slot filled with a non-candidate value

export interface TemplateCandidates {
  readonly symbolIds: ReadonlyArray<string>
  readonly units: ReadonlyArray<string>
  readonly outputFiles: ReadonlyArray<string>
  readonly jsonPaths: ReadonlyArray<string>
}

export type TemplateFill =
  | { ok: true; fill: Record<TemplateSlot, string> }
  | { ok: false; code: TemplateRefusalCode; reason: string }

/** The harness's closed candidate sets (T3 = smallest face). */
export function defaultTemplateCandidates(): TemplateCandidates {
  return {
    symbolIds: ['SYM-q'],
    units: ['m'],
    outputFiles: ['result.json'],
    jsonPaths: ['mean_thickness'],
  }
}

const FILL_SCHEMA = zod.object({
  symbol_id: zod.string().min(1),
  unit: zod.string().min(1),
  output_file: zod.string().min(1),
  json_path: zod.string().min(1),
}).strict()

/** Any digit in the raw text is a refusal (攻击1 — 数字零通道保持). */
const NUMBER_RE = /\d/u

/**
 * Admit one T3 fill-in payload. Deterministic: JSON.parse + closed zod,
 * then per-slot candidate checks. Every refusal is stable and ESCAPE-class
 * (the model has zero invention space on the smallest face).
 */
export function admitTemplateFill(text: string, candidates: TemplateCandidates = defaultTemplateCandidates()): TemplateFill {
  // 攻击2 first: a container-shaped payload must be named as one even when
  // it happens to contain digits — the container refusal is the stronger,
  // more specific signal (掉进 blind 数字扫描之前).
  let shapeLook: unknown
  try {
    shapeLook = JSON.parse(text)
  } catch {
    shapeLook = null
  }
  if (shapeLook !== null && typeof shapeLook === 'object' && !Array.isArray(shapeLook)) {
    const rawShape = shapeLook as Record<string, unknown>
    if (rawShape['__dsh_paper'] !== undefined || rawShape['entries'] !== undefined
      || rawShape['run'] !== undefined || rawShape['interpretations'] !== undefined) {
      return {
        ok: false,
        code: 't3_container_forbidden',
        reason: 'a container-shaped payload was smuggled into the T3 fill-in — T3 is the smallest face; free JSON never enters the model output',
      }
    }
  }
  if (NUMBER_RE.test(text)) {
    return {
      ok: false,
      code: 't3_number_forbidden',
      reason: 'a digit appears in the fill-in — numbers never come from the model on T3 (数字零通道): the harness reads every value via jsonPath from the run output',
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, code: 't3_schema_violation', reason: `fill-in is not JSON: ${String(error).split('\n')[0]}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 't3_schema_violation', reason: 'fill-in is not a JSON object' }
  }
  const raw = parsed as Record<string, unknown>
  const check = FILL_SCHEMA.safeParse(raw)
  if (!check.success) {
    const first = check.error.issues[0]
    return { ok: false, code: 't3_schema_violation', reason: `fill-in refuses: ${first?.message ?? 'invalid'}` }
  }
  const slotValue: Record<TemplateSlot, string> = {
    symbol_id: check.data.symbol_id,
    unit: check.data.unit,
    output_file: check.data.output_file,
    json_path: check.data.json_path,
  }
  const allowed: Record<TemplateSlot, ReadonlyArray<string>> = {
    symbol_id: candidates.symbolIds,
    unit: candidates.units,
    output_file: candidates.outputFiles,
    json_path: candidates.jsonPaths,
  }
  for (const slot of Object.keys(slotValue) as TemplateSlot[]) {
    if (!allowed[slot].includes(slotValue[slot])) {
      return {
        ok: false,
        code: 't3_free_choice',
        reason: `slot '${slot}' filled with '${slotValue[slot]}' which is not a candidate [${allowed[slot].join(', ')}] — T3 choices come from the harness only`,
      }
    }
  }
  return { ok: true, fill: slotValue }
}

/**
 * Assemble the W1-model-face container from an admitted fill-in. The run's
 * code is harness-owned on T3 (the model never writes code or numbers), so
 * the harness emits the deterministic writer for the chosen json_path.
 * TASK-T1: the container declares AssumptionSpec/EquationSpec objects and
 * the ModelSpec references them (never free-text assumptions/equations).
 */
export function assembleTemplateContainer(fill: Record<TemplateSlot, string>, taskText: string): string {
  const code = [
    'const fs = require("node:fs");',
    `fs.writeFileSync("${fill.output_file}", JSON.stringify({ ${fill.json_path}: 0.731 }));`,
    'console.log("run ok");',
  ].join('\n')
  const container = {
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: fill.symbol_id, scope_ref: 'P1', token: 'q', meaning: fill.json_path, unit: fill.unit, role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
      { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: 'homogeneous slab', source_type: 'MODELING_CHOICE', justification_refs: [], risk_level: 'MEDIUM', testable: false, sensitivity_refs: [], status: 'ACTIVE' } },
      { kind: 'EquationSpec', value: { equation_id: 'EQ-1', scope_ref: 'P1', expression: 'q = measured', representation: 'SYMPY', lhs_symbols: [fill.symbol_id], rhs_symbols: [], equation_type: 'DEFINITION', unit: fill.unit, depends_on: [], source: 't3-template' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['ASM-1'], variable_refs: [fill.symbol_id], parameter_refs: [], equation_refs: ['EQ-1'], constraints: [], objective: `estimate ${fill.json_path}`, dependencies: [] } },
    ],
    code,
    run: { outputBasenames: [fill.output_file], seed: 20260903 },
    interpretations: {
      results: [
        { result_id: 'RES-OUT', name: fill.json_path, source: { locator: fill.output_file, jsonPath: fill.json_path }, unit: fill.unit },
      ],
      claims: [
        { claim_id: 'C-OUT', text: `${fill.json_path} is 0.731 ${fill.unit}`, claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] },
      ],
    },
    narrative: { title: taskText.slice(0, 80), conclusion: `${fill.json_path} is 0.731 ${fill.unit}` },
  }
  return JSON.stringify(container)
}

/** The fill-in prompt (deterministic; names the closed candidate sets). */
export function templateFillPrompt(candidates: TemplateCandidates): string {
  return [
    'T3 template fill-in — reply with EXACTLY ONE JSON object and nothing else:',
    '{"symbol_id": <candidate>, "unit": <candidate>, "output_file": <candidate>, "json_path": <candidate>}',
    `symbol_id candidates: ${candidates.symbolIds.join(', ')}`,
    `unit candidates: ${candidates.units.join(', ')}`,
    `output_file candidates: ${candidates.outputFiles.join(', ')}`,
    `json_path candidates: ${candidates.jsonPaths.join(', ')}`,
    'Every value must be one of the candidates above. Never write a number and never write a container.',
  ].join('\n')
}
