/**
 * P2 demo-v2 cases — leaves for the executor-authoritative demo.
 *
 * Legal leaves (must DELIVER): the P1 trio (legacy prose conclusions) plus
 * a new figure + structured-slot leaf (P2-3/P2-4 happy path). Wrong leaves
 * (must be KILLED): TOO-GOOD re-run on v2 slots and a caption-number
 * figure escape (P2-3 attack 1).
 *
 * The container builder mirrors the P2-1 executor chain contract: run
 * block only outputBasenames + seed (deployment owns the command), code
 * writes deterministic JSON, interpretations carry results/claims (+
 * figures), narrative carries title + conclusion (string or slots).
 *
 * @module artifacts/handoff/TASK-P2/demo-v2/cases
 */

const HASH = 'sha256:' + 'a'.repeat(64)

function baseContainer(caseDef) {
  const key = caseDef.key
  const output = { [key]: caseDef.value }
  const code = [
    'const fs = require("node:fs");',
    `fs.writeFileSync("result.json", ${JSON.stringify(JSON.stringify(output))});`,
    'console.log("ok");',
  ].join('\n')
  return {
    __dsh_paper: 'ir-container-v1',
    // TASK-PW W1: DA-RAW / R-OUT / P1 are harness-registered (the executor
    // registers them from the task text before this container is applied) —
    // the model face carries only modeling-side kinds, referenced by id.
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: caseDef.quantityName, unit: caseDef.unit, role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
      { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: 'homogeneous slab', source_type: 'MODELING_CHOICE', justification_refs: [], risk_level: 'MEDIUM', testable: false, sensitivity_refs: [], status: 'ACTIVE' } },
      { kind: 'EquationSpec', value: { equation_id: 'EQ-1', scope_ref: 'P1', expression: 'q = measured', representation: 'SYMPY', lhs_symbols: ['SYM-q'], rhs_symbols: [], equation_type: 'DEFINITION', unit: 'm', depends_on: [], source: 'p2-demo-cases' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['ASM-1'], variable_refs: ['SYM-q'], parameter_refs: [], equation_refs: ['EQ-1'], constraints: [], objective: 'estimate', dependencies: [] } },
    ],
    code,
    run: { outputBasenames: ['result.json'], seed: caseDef.seed },
    interpretations: {
      results: [
        { result_id: 'RES-OUT', name: caseDef.quantityName, source: { locator: 'result.json', jsonPath: key }, unit: caseDef.unit, uncertainty: caseDef.uncertainty ?? null },
      ],
      claims: [
        { claim_id: 'C-OUT', text: `${caseDef.quantityName} is ${caseDef.value} ${caseDef.unit}.`, claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] },
      ],
      ...(caseDef.figures === undefined ? {} : { figures: caseDef.figures }),
    },
    narrative: {
      title: caseDef.title,
      ...(caseDef.conclusion === undefined ? {} : { conclusion: caseDef.conclusion }),
      methods: 'Deterministic measurement along the survey line.',
    },
  }
}

const polar = {
  id: 'POLAR-ICE', key: 'mean_thickness', value: 0.731, unit: 'm', uncertainty: 0.012,
  quantityName: 'mean ice thickness', problem: 'Estimate mean sea-ice thickness.',
  seed: 20260903,
  title: 'Polar ice thickness',
  conclusion: 'Mean ice thickness along the survey line is 0.731 m.',
}
const pond = {
  id: 'MELT-POND', key: 'pond_fraction', value: 0.042, unit: '1', uncertainty: null,
  quantityName: 'melt-pond fraction', problem: 'Estimate melt-pond fraction.',
  seed: 20260903,
  title: 'Melt pond fraction',
  conclusion: 'The melt-pond fraction of the sampled area is 0.042.',
}
const ridge = {
  id: 'RIDGE-DENSITY', key: 'ridge_density', value: 2.4, unit: 'km^-1', uncertainty: 0.3,
  quantityName: 'ridge density', problem: 'Estimate ridge density.',
  seed: 20260903,
  title: 'Ridge density',
  conclusion: 'Ridge density along the corridor is 2.4 km^-1.',
}
// Figure + structured-slot happy path (P2-3/P2-4). The figure draws the
// same Result; the structured conclusion slot binds RES-OUT and states the
// value verbatim.
const figured = {
  id: 'FIGURED-ICE', key: 'mean_thickness', value: 0.731, unit: 'm', uncertainty: 0.012,
  quantityName: 'mean ice thickness', problem: 'Estimate mean sea-ice thickness with figure.',
  seed: 20260903,
  title: 'Polar ice with figure',
  conclusion: {
    claims: [
      { text: 'Mean ice thickness along the survey line is 0.731 m.', quantity_refs: ['RES-OUT'] },
    ],
  },
  figures: [
    { figure_id: 'FIG-1', chart_type: 'line', data_refs: ['RES-OUT'], caption: 'Survey line thickness', x_label: 'survey', y_label: 'thickness (m)' },
  ],
}

export const legalCaseDefs = [polar, pond, ridge, figured].map(c => ({ def: c, container: containerOf(c) }))

const wrongDefs = [
  // TOO-GOOD on v2 slots: 0.732 vs bound Result 0.731.
  { ...polar, id: 'TOO-GOOD-V2', conclusion: { claims: [{ text: 'Mean ice thickness along the survey line is 0.732 m.', quantity_refs: ['RES-OUT'] }] } },
  // Caption numeric escape (P2-3 attack 1): the figure caption quotes a
  // number the Result does not have.
  { ...figured, id: 'CAPTION-ESCAPE', figures: [{ figure_id: 'FIG-1', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness 0.8 m' }] },
]

export const wrongCaseDefs = wrongDefs.map(c => ({ def: c, container: containerOf(c) }))

export const legalCases = legalCaseDefs.map(c => c.container)
export const wrongCases = wrongCaseDefs.map(c => c.container)

function containerOf(caseDef) {
  return JSON.stringify(baseContainer(caseDef))
}
