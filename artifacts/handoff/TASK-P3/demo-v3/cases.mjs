/**
 * P3 demo-v3 cases — corpus v3 leaves for the executor-authoritative demo.
 *
 * Legal 5 (must DELIVER): the P2 quartet (POLAR-ICE legacy prose, MELT-POND,
 * RIDGE-DENSITY, FIGURED-ICE figure+slot) + ROUNDED-LEGAL — the P3-2
 * declaration leaf (rounded {dp:2} ≈0.73 against source 0.731). FBR 0/5;
 * semantic false-kill rate 0/5 (no legal leaf may raise an evidenced
 * semantic finding).
 *
 * Kill 6 (must be KILLED, exit non-zero if any turns green):
 *   SEMANTIC-OVERCLAIM — prose claims an unsupported comparison → the
 *     deterministic layer refuses (0.99 is not a bound value), and the
 *     reviewer path would add an evidenced claim_without_evidence finding.
 *   ROUND-ESCAPE — ≈0.73 with NO representation declaration (P3-2 攻击1).
 *   DUP-FIGURE — two figure declarations with the same uniqueness key
 *     (P3-4 攻击1) → producer refuses, zero partial writes.
 *   TOO-GOOD-V2 / CAPTION-ESCAPE / OVER-PROMISE — P1/P2 kills re-run
 *     (禁9: kills never expire with the version bump).
 *
 * The container builder mirrors the executor chain contract (run block only
 * outputBasenames + seed; numbers only via code + jsonPath + declarations).
 *
 * @module artifacts/handoff/TASK-P3/demo-v3/cases
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
// P3-2 declaration leaf: ≈0.73 is legal ONLY through rounded {dp:2}.
const rounded = {
  id: 'ROUNDED-LEGAL', key: 'mean_thickness', value: 0.731, unit: 'm', uncertainty: 0.012,
  quantityName: 'mean ice thickness', problem: 'Estimate mean sea-ice thickness (report rounded to two decimals).',
  seed: 20260903,
  title: 'Rounded ice report',
  conclusion: {
    claims: [
      { text: 'Mean ice thickness along the survey line is ≈0.73 m.', quantity_refs: ['RES-OUT'], representation: { kind: 'rounded', dp: 2 } },
    ],
  },
}

export const legalCases = [polar, pond, ridge, figured, rounded].map(c => containerOf(c))

export const wrongCases = [
  // P3-1 kill: prose overclaim — the narrative promises a comparison the
  // store has no Result for. The deterministic layer refuses (0.99 is not a
  // bound value); on the reviewer path this is an evidenced
  // claim_without_evidence finding (P3-1 attack 1 as a corpus leaf).
  containerOf({
    ...polar, id: 'SEMANTIC-OVERCLAIM', title: 'SEMANTIC-OVERCLAIM kill',
    conclusion: 'Mean ice thickness is 0.731 m, outperforming every baseline by 0.99.',
  }),
  // P3-2 kill: ≈ without a representation declaration.
  containerOf({
    ...rounded, id: 'ROUND-ESCAPE', title: 'ROUND-ESCAPE kill',
    conclusion: { claims: [{ text: 'Mean ice thickness is ≈0.73 m.', quantity_refs: ['RES-OUT'] }] },
  }),
  // P3-4 kill: same uniqueness key twice (same refs + chart_type + style).
  containerOf({
    ...figured, id: 'DUP-FIGURE', title: 'DUP-FIGURE kill',
    figures: [
      { figure_id: 'FIG-1', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness bars' },
      { figure_id: 'FIG-2', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness bars again' },
    ],
  }),
  // P2 kills re-run on v3 (禁9: kills never expire with the version bump).
  containerOf({ ...polar, id: 'TOO-GOOD-V2', title: 'TOO-GOOD-V2 kill', conclusion: { claims: [{ text: 'Mean ice thickness along the survey line is 0.732 m.', quantity_refs: ['RES-OUT'] }] } }),
  containerOf({ ...figured, id: 'CAPTION-ESCAPE', title: 'CAPTION-ESCAPE kill', figures: [{ figure_id: 'FIG-1', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness 0.8 m' }] }),
  containerOf({
    ...polar, id: 'OVER-PROMISE', title: 'OVER-PROMISE kill',
    conclusion: 'Mean ice thickness is 0.731 m and ridge density is 2.4 km^-1 across both corridors.',
  }),
]

function containerOf(caseDef) {
  return JSON.stringify(baseContainer(caseDef))
}
