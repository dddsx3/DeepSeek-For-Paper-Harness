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

const HASH_PLACEHOLDER = 'sha256:' + 'a'.repeat(64)

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
  const requirementRefs = caseDef.extraOutput === undefined
    ? ['R-OUT']
    : ['R-OUT', 'R-OUT2']
  const entries = [
    {
      kind: 'DataArtifact',
      value: {
        data_id: 'DA-RAW',
        role: 'RAW_PROBLEM',
        locator: `file:///problem/${caseDef.id}.txt`,
        content_hash: HASH_PLACEHOLDER,
        media_type: 'text/markdown',
        description: caseDef.problemText,
      },
    },
    {
      kind: 'RequirementSpec',
      value: {
        requirement_id: 'R-OUT',
        source_data_ref: 'DA-RAW',
        requirement_type: 'REQUIRED_OUTPUT',
        statement: `Produce ${caseDef.quantity.name}.`,
      },
    },
  ]
  if (caseDef.extraOutput !== undefined) {
    entries.push({
      kind: 'RequirementSpec',
      value: {
        requirement_id: 'R-OUT2',
        source_data_ref: 'DA-RAW',
        requirement_type: 'REQUIRED_OUTPUT',
        statement: caseDef.extraOutput,
      },
    })
  }
  entries.push(
    {
      kind: 'ProblemSpec',
      value: {
        problem_id: 'P1',
        raw_problem_ref: 'DA-RAW',
        requirement_refs: requirementRefs,
      },
    },
    {
      kind: 'SymbolSpec',
      value: {
        symbol_id: 'SYM-q',
        scope_ref: 'P1',
        token: 'q',
        meaning: caseDef.quantity.name,
        unit: caseDef.quantity.unit,
        role: 'VARIABLE',
      },
    },
    {
      kind: 'ModelSpec',
      value: {
        model_id: 'M1',
        problem_refs: ['P1'],
        assumptions: [caseDef.assumption],
        variable_refs: ['SYM-q'],
        parameter_refs: [],
        equations: [`${key} = measured`],
        constraints: [],
        objective: `estimate ${caseDef.quantity.name}`,
        dependencies: [],
      },
    },
  )
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
