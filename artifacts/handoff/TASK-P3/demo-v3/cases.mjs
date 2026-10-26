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

/**
 * The prose chapters the current contract demands from the single-shot
 * container face (W11.5 baseline-10 `placeholder_chapter` → docx precheck
 * `no_placeholders`): a chapter the container leaves out renders as a visible
 * placeholder and the paper cannot be exported. The executor auto-fills only
 * the 代码附录 chapter from the container's code, so these four must be
 * written here. The demo corpora froze before the gate existed; this brings
 * the fake leaves up to the live contract without changing what each leaf
 * tests. Strings carry no digit literals and no `$..$` math so they cannot
 * trip the delivered-number / arithmetic self-contradiction scans.
 */
function proseChaptersOf(caseDef) {
  return {
    restatement: `The problem asks for one quantity: the ${caseDef.quantityName} of the surveyed scene, reported in ${caseDef.unit}. The statement — ${caseDef.problem} — leaves the method open, so this paper treats it as a single deterministic measurement task over the survey line and reports the estimate together with its uncertainty statement.`,
    analysis: 'The quantity is modeled as a deterministic property of the surveyed scene, so the analysis reduces to choosing an estimator whose inputs the deployment can actually observe. The homogeneous-slab assumption keeps the model linear and the run reproducible; the difficulty is that the statement provides no raw series, so the model must close over the run\'s own output rather than over an external dataset.',
    evaluation: 'Strengths: the model is minimal, fully reproducible, and every reported number is minted from the run\'s own output rather than transcribed. Limitations: the homogeneous-slab assumption is a modeling choice, so the estimate is only as good as that choice, and the single-quantity scope admits no cross-check against an independent instrument. Sensitivity: the estimator is an average over the surveyed cells, so it is robust to small perturbations of the grid but inherits any bias of the measurement device. Generalization: the same container shape extends to any quantity a deterministic script can emit as structured output, so the model transfers to further survey campaigns without structural change.',
    references: [
      '[1] Survey Methods Group. Line-transect sampling for environmental surveys. Journal of Field Sampling. 2019.',
      '[2] Cryosphere Modeling Group. Regression estimation of ice thickness from survey profiles. Cryosphere Reports. 2021.',
      '[3] Reproducible Computation Group. Simulation and re-run methodology for deterministic estimators. Computational Statistics Digest. 2020.',
    ].join('\n'),
  }
}

/**
 * The single-figure declaration every container must carry on the
 * single-shot face (W11.5 round-2 `figure_required`: a submittable modelling
 * paper shows at least one figure; the harness renders the SVG from the
 * declared Results — the model never draws it). Labels stay digit-free so
 * the caption guard (P2-3 attack 1) has nothing to flag.
 */
function defaultFigureOf(caseDef) {
  return [
    {
      figure_id: 'FIG-1',
      chart_type: 'line',
      data_refs: ['RES-OUT'],
      caption: `Measured ${caseDef.quantityName} along the survey line`,
      x_label: 'survey',
      y_label: caseDef.quantityName,
    },
  ]
}

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
      { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: 'homogeneous slab', source_type: 'MODELING_CHOICE', justification_refs: ['DA-RAW'], risk_level: 'MEDIUM', testable: false, sensitivity_refs: [], status: 'ACTIVE' } },
      { kind: 'EquationSpec', value: { equation_id: 'EQ-1', scope_ref: 'P1', expression: 'q = measured', representation: 'SYMPY', lhs_symbols: ['SYM-q'], rhs_symbols: [], equation_type: 'DEFINITION', unit: 'm', depends_on: [], source: 'p3-demo-cases' } },
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
      ...(caseDef.figures === undefined ? { figures: defaultFigureOf(caseDef) } : { figures: caseDef.figures }),
    },
    narrative: {
      title: caseDef.title,
      ...(caseDef.conclusion === undefined ? {} : { conclusion: caseDef.conclusion }),
      methods: 'Deterministic measurement along the survey line.',
      ...proseChaptersOf(caseDef),
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

export const legalCaseDefs = [polar, pond, ridge, figured, rounded].map(c => ({ def: c, container: containerOf(c) }))

const wrongDefs = [
  // P3-1 kill: prose overclaim — the narrative promises a comparison the
  // store has no Result for. The deterministic layer refuses (0.99 is not a
  // bound value); on the reviewer path this is an evidenced
  // claim_without_evidence finding (P3-1 attack 1 as a corpus leaf).
  ({
    ...polar, id: 'SEMANTIC-OVERCLAIM', title: 'SEMANTIC-OVERCLAIM kill',
    conclusion: 'Mean ice thickness is 0.731 m, outperforming every baseline by 0.99.',
  }),
  // P3-2 kill: ≈ without a representation declaration.
  ({
    ...rounded, id: 'ROUND-ESCAPE', title: 'ROUND-ESCAPE kill',
    conclusion: { claims: [{ text: 'Mean ice thickness is ≈0.73 m.', quantity_refs: ['RES-OUT'] }] },
  }),
  // P3-4 kill: same uniqueness key twice (same refs + chart_type + style).
  ({
    ...figured, id: 'DUP-FIGURE', title: 'DUP-FIGURE kill',
    figures: [
      { figure_id: 'FIG-1', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness bars' },
      { figure_id: 'FIG-2', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness bars again' },
    ],
  }),
  // P2 kills re-run on v3 (禁9: kills never expire with the version bump).
  ({ ...polar, id: 'TOO-GOOD-V2', title: 'TOO-GOOD-V2 kill', conclusion: { claims: [{ text: 'Mean ice thickness along the survey line is 0.732 m.', quantity_refs: ['RES-OUT'] }] } }),
  ({ ...figured, id: 'CAPTION-ESCAPE', title: 'CAPTION-ESCAPE kill', figures: [{ figure_id: 'FIG-1', chart_type: 'bar', data_refs: ['RES-OUT'], caption: 'Thickness 0.8 m' }] }),
  ({
    ...polar, id: 'OVER-PROMISE', title: 'OVER-PROMISE kill',
    conclusion: 'Mean ice thickness is 0.731 m and ridge density is 2.4 km^-1 across both corridors.',
  }),
]

export const wrongCaseDefs = wrongDefs.map(c => ({ def: c, container: containerOf(c) }))

export const legalCases = legalCaseDefs.map(c => c.container)
export const wrongCases = wrongCaseDefs.map(c => c.container)

function containerOf(caseDef) {
  return JSON.stringify(baseContainer(caseDef))
}
