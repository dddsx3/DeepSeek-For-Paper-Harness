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
    entries: [
      { kind: 'DataArtifact', value: { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: `file:///problem/${caseDef.id}.txt`, content_hash: HASH, media_type: 'text/markdown', description: caseDef.problem } },
      { kind: 'RequirementSpec', value: { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: `Produce ${caseDef.quantityName}.` } },
      { kind: 'ProblemSpec', value: { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] } },
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: caseDef.quantityName, unit: caseDef.unit, role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: 'estimate', dependencies: [] } },
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

export const legalCases = [polar, pond, ridge, figured].map(c => containerOf(c))

export const wrongCases = [
  // TOO-GOOD on v2 slots: 0.732 vs bound Result 0.731.
  containerOf({ ...polar, id: 'TOO-GOOD-V2', conclusion: { claims: [{ text: 'Mean ice thickness along the survey line is 0.732 m.', quantity_refs: ['RES-OUT'] }] } }),
  // Caption numeric escape (P2-3 attack 1): the figure caption quotes a
  // number the Result does not have.
  containerOf({ ...figured, id: 'CAPTION-ESCAPE', figures: [{ figure_id: 'FIG-1', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness 0.8 m' }] }),
]

function containerOf(caseDef) {
  return JSON.stringify(baseContainer(caseDef))
}
