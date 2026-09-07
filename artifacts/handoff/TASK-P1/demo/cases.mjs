/**
 * P1-5 FORMAL demo + pass-corpus cases.
 *
 * Each case is the *domain essence* of a paper leaf; the demo pipeline
 * (run-p1-demo.mjs) assembles the ir-container-v1 the same way the
 * EXECUTE-stage model would emit it, runs the code for real, interprets
 * the REAL outputs, renders the v1 template report and pushes it through
 * the nine-gate FORMAL delivery.
 *
 * 3 legal leaves must deliver (False Block Rate baseline 0/3):
 *   polar-ice      mean thickness 0.731 m
 *   melt-pond      pond fraction   0.042 (unit '1')
 *   ridge-height   ridge density   2.4 km^-1
 * 2 wrong leaves must be killed:
 *   too-good       conclusion quotes 0.732 while the Result is 0.731
 *                  (renderer guard)
 *   over-promise   promises 2 REQUIRED_OUTPUTs, proves 1 (coverage gate)
 *
 * @module artifacts/handoff/TASK-P1/demo/cases
 */

/** Assemble the canonical container the model would emit for a case. */
export function containerFor(caseDef) {
  const key = caseDef.quantity.key
  const value = caseDef.quantity.value
  const output = { [key]: value }
  const outputJson = JSON.stringify(output)
  const code = [
    'const fs = require("node:fs");',
    `fs.writeFileSync("result.json", ${JSON.stringify(outputJson)});`,
    'console.log("run ok");',
  ].join('\n')
  const entries = [
    // TASK-PW W1: DA-RAW / R-OUT / P1 (+ R-OUT2 when extraOutput) are
    // harness-registered before this container is applied (mirroring the
    // executor's registerInputAssets) — the model face carries only
    // modeling-side kinds, referenced by id.
    {
      kind: 'SymbolSpec',
      value: {
        symbol_id: 'SYM-q',
        scope_ref: 'P1',
        token: 'q',
        meaning: caseDef.quantity.name,
        unit: caseDef.quantity.unit,
        role: 'VARIABLE',
        shape: 'SCALAR',
        domain: 'REAL',
        index_set: [],
      },
    },
    {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'ASM-1',
        scope_ref: 'P1',
        statement: caseDef.assumption,
        source_type: 'MODELING_CHOICE',
        justification_refs: [],
        risk_level: 'MEDIUM',
        testable: false,
        sensitivity_refs: [],
        status: 'ACTIVE',
      },
    },
    {
      kind: 'EquationSpec',
      value: {
        equation_id: 'EQ-1',
        scope_ref: 'P1',
        expression: `${key} = measured`,
        representation: 'SYMPY',
        lhs_symbols: ['SYM-q'],
        rhs_symbols: [],
        equation_type: 'DEFINITION',
        unit: caseDef.quantity.unit,
        depends_on: [],
        source: 'p1-demo-cases',
      },
    },
    {
      kind: 'ModelSpec',
      value: {
        model_id: 'M1',
        problem_refs: ['P1'],
        assumption_refs: ['ASM-1'],
        variable_refs: ['SYM-q'],
        parameter_refs: [],
        equation_refs: ['EQ-1'],
        constraints: [],
        objective: `estimate ${caseDef.quantity.name}`,
        dependencies: [],
      },
    },
  ]
  return {
    __dsh_paper: 'ir-container-v1',
    entries,
    code,
    run: {
      outputBasenames: ['result.json'],
      timeoutMs: 30_000,
    },
    interpretations: {
      results: [
        {
          result_id: 'RES-OUT',
          name: caseDef.quantity.name,
          source: { locator: null, jsonPath: key },
          unit: caseDef.quantity.unit,
          uncertainty: caseDef.quantity.uncertainty ?? null,
        },
      ],
      claims: [
        {
          claim_id: 'C-OUT',
          text: `${caseDef.quantity.name} is ${caseDef.quantity.value} ${caseDef.quantity.unit}.`,
          claim_type: 'NUMERIC',
          criticality: 'CRITICAL',
          result_refs: ['RES-OUT'],
          model_refs: ['M1'],
          evidence_refs: ['RES-OUT'],
        },
      ],
    },
    narrative: {
      conclusion: caseDef.conclusion,
      methods: caseDef.methods,
    },
  }
}

/** Dot-path locator template the pipeline fills with the run locator. */
export function locatorTemplate(caseDef) {
  return `file:///runs/RUN-${caseDef.id}/result.json`
}

export const legalCases = [
  {
    id: 'POLAR-ICE',
    title: 'Polar Smart Navigation — 2026 survey line ice-thickness estimate',
    problemText: 'Estimate mean sea-ice thickness along the survey line.',
    assumption: 'Ice along the line is a homogeneous slab.',
    quantity: { key: 'mean_thickness', name: 'mean ice thickness', value: 0.731, unit: 'm', uncertainty: 0.012 },
    conclusion: 'Mean ice thickness along the survey line is 0.731 m.',
    methods: 'Deterministic averaging over the survey cells.',
  },
  {
    id: 'MELT-POND',
    title: 'Melt-pond fraction estimate from optical survey',
    problemText: 'Estimate the melt-pond fraction of the sampled area.',
    assumption: 'The sampled area is representative of the wider region.',
    quantity: { key: 'pond_fraction', name: 'melt-pond fraction', value: 0.042, unit: '1', uncertainty: null },
    conclusion: 'The melt-pond fraction of the sampled area is 0.042.',
    methods: 'Optical classification over the orthophoto grid.',
  },
  {
    id: 'RIDGE-DENSITY',
    title: 'Ridge density along the navigation corridor',
    problemText: 'Estimate the ridge density along the corridor.',
    assumption: 'Ridge crossings are Poisson-distributed along the track.',
    quantity: { key: 'ridge_density', name: 'ridge density', value: 2.4, unit: 'km^-1', uncertainty: 0.3 },
    conclusion: 'Ridge density along the corridor is 2.4 km^-1.',
    methods: 'Peak detection on the laser profile.',
  },
]

export const wrongCases = [
  {
    // Killed by the renderer guard: the conclusion quotes a number the
    // Result does not have (0.732 vs the executed 0.731).
    id: 'TOO-GOOD',
    title: 'Too-good leaf (must be refused)',
    problemText: 'Estimate mean sea-ice thickness along the survey line.',
    assumption: 'Ice along the line is a homogeneous slab.',
    quantity: { key: 'mean_thickness', name: 'mean ice thickness', value: 0.731, unit: 'm', uncertainty: 0.012 },
    conclusion: 'Mean ice thickness along the survey line is 0.732 m.',
    methods: 'Deterministic averaging.',
    expect: 'renderer_refused',
  },
  {
    // Killed by the coverage gate: promises two REQUIRED_OUTPUTs, the
    // executed run proves only one distinct Result.
    id: 'OVER-PROMISE',
    title: 'Over-promise leaf (must be refused)',
    problemText: 'Estimate both thickness and density.',
    assumption: 'Ice along the line is a homogeneous slab.',
    quantity: { key: 'mean_thickness', name: 'mean ice thickness', value: 0.731, unit: 'm', uncertainty: 0.012 },
    conclusion: 'Mean ice thickness along the survey line is 0.731 m.',
    methods: 'Deterministic averaging.',
    extraOutput: 'Produce ridge density as well.',
    expect: 'coverage_blocked',
  },
]
