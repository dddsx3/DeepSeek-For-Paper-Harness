import { describe, expect, it } from 'vitest'
import {
  CLAIM_CRITICALITIES,
  CLAIM_TYPES,
  ATTACK_TYPES,
  FINDING_SEVERITIES,
  ID_FIELD_BY_KIND,
  IR_KINDS,
  IR_SCHEMAS,
  claimSchema,
  figureSpecSchema,
  modelSpecSchema,
  problemSpecSchema,
  readIrObjectId,
  resultSchema,
  reviewerFindingSchema,
  runArtifactSchema,
  verificationResultSchema,
} from '../../src/ir/index.ts'
import { validChain, validObjectFor } from './fixtures.ts'

describe('IR schemas — closed vocabulary', () => {
  it('declares an ID field and a schema for every kind', () => {
    for (const kind of IR_KINDS) {
      expect(ID_FIELD_BY_KIND[kind]).toBeTruthy()
      expect(IR_SCHEMAS[kind]).toBeDefined()
      const parsed = IR_SCHEMAS[kind].safeParse(validObjectFor(kind))
      expect(parsed.success, `${kind} fixture must be valid`).toBe(true)
    }
  })

  it('accepts one valid object of every kind', () => {
    for (const entry of validChain()) {
      expect(IR_SCHEMAS[entry.kind].safeParse(entry.value).success).toBe(true)
    }
  })

  it('readIrObjectId returns the canonical id of a validated object', () => {
    for (const kind of IR_KINDS) {
      const value = validObjectFor(kind)
      const parsed = IR_SCHEMAS[kind].parse(value)
      expect(readIrObjectId(kind, parsed)).toBe(value[ID_FIELD_BY_KIND[kind]!])
    }
  })

  it('rejects an unrecognised key on every kind (no silently-ignored fields)', () => {
    for (const kind of IR_KINDS) {
      const value = { ...validObjectFor(kind), surprise_field: 1 }
      const parsed = IR_SCHEMAS[kind].safeParse(value)
      expect(parsed.success, `${kind} must reject extra keys`).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues[0]!.code).toBe('unrecognized_keys')
      }
    }
  })

  it('rejects an id that is empty or whitespace', () => {
    expect(resultSchema.safeParse({ ...validObjectFor('Result'), result_id: '' }).success).toBe(false)
    expect(resultSchema.safeParse({ ...validObjectFor('Result'), result_id: '  ' }).success).toBe(false)
  })

  it('rejects empty external refs and hashes', () => {
    expect(problemSpecSchema.safeParse({ ...validObjectFor('ProblemSpec'), raw_problem_ref: '' }).success).toBe(false)
    expect(runArtifactSchema.safeParse({ ...validObjectFor('RunArtifact'), code_hash: '' }).success).toBe(false)
    expect(resultSchema.safeParse({ ...validObjectFor('Result'), source_location: '' }).success).toBe(false)
  })

  it('rejects NaN and Infinity result values through the typed path', () => {
    expect(resultSchema.safeParse({ ...validObjectFor('Result'), value: NaN }).success).toBe(false)
    expect(resultSchema.safeParse({ ...validObjectFor('Result'), value: Infinity }).success).toBe(false)
    expect(resultSchema.safeParse({ ...validObjectFor('Result'), value: -Infinity }).success).toBe(false)
  })

  it('rejects an unknown criticality, claim type, attack type, and severity', () => {
    expect(claimSchema.safeParse({ ...validObjectFor('Claim'), criticality: 'UNKNOWN' }).success).toBe(false)
    expect(claimSchema.safeParse({ ...validObjectFor('Claim'), claim_type: 'VIBES' }).success).toBe(false)
    expect(reviewerFindingSchema.safeParse({ ...validObjectFor('ReviewerFinding'), attack_type: 'vibes' }).success).toBe(false)
    expect(reviewerFindingSchema.safeParse({ ...validObjectFor('ReviewerFinding'), severity: 'APOCALYPTIC' }).success).toBe(false)
    expect(CLAIM_CRITICALITIES).not.toContain('UNKNOWN')
    expect(CLAIM_TYPES).toContain('NUMERIC')
    expect(ATTACK_TYPES).toContain('counterexample')
    expect(FINDING_SEVERITIES).toContain('CRITICAL')
  })

  it('rejects a verification status outside PASS / FAIL / BLOCKED', () => {
    for (const bad of ['WARNING', 'MAYBE', 'LIKELY', 'PARTIAL', 'OK']) {
      const parsed = verificationResultSchema.safeParse({ ...validObjectFor('VerificationResult'), status: bad })
      expect(parsed.success, `${bad} must not be a gate status`).toBe(false)
    }
  })

  // TASK 1.5 removed the nested shapes these used to inspect. The guarantee
  // that replaces "no duplicate subproblem ids inside one object" is stronger:
  // there is no nested block to hold a duplicate, because the field does not
  // exist. Requirements and symbol semantics live in their own canonical
  // objects, so the failure moved from "unrecognised key" to "second source
  // of truth is not representable" (INV-1.5-A / INV-1.5-C).
  it('ProblemSpec rejects a nested subproblems block outright', () => {
    const parsed = problemSpecSchema.safeParse({
      ...validObjectFor('ProblemSpec'),
      subproblems: [
        { subproblem_id: 'S1', statement: 'a' },
        { subproblem_id: 'S1', statement: 'b' },
      ],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.message).toContain('subproblems')
    }
  })

  it('ProblemSpec rejects a nested required_outputs block outright', () => {
    const parsed = problemSpecSchema.safeParse({
      ...validObjectFor('ProblemSpec'),
      required_outputs: [
        { output_id: 'O1', description: 'a' },
        { output_id: 'O1', description: 'b' },
      ],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.message).toContain('required_outputs')
    }
  })

  it('ModelSpec rejects re-embedded variables and parameters', () => {
    // A meaning/unit pair belongs to SymbolSpec and nowhere else, so a model
    // that re-embeds it is creating a second source of truth for what its
    // symbols mean (INV-1.5-C, attack C-014).
    expect(modelSpecSchema.safeParse({
      ...validObjectFor('ModelSpec'),
      variables: [{ symbol: 'x', meaning: 'distance', unit: 'm' }],
    }).success).toBe(false)

    expect(modelSpecSchema.safeParse({
      ...validObjectFor('ModelSpec'),
      parameters: [{ symbol: 'rho', value: 917 }],
    }).success).toBe(false)
  })

  it('ModelSpec allows an explicit null objective but not a missing one', () => {
    expect(modelSpecSchema.safeParse({ ...validObjectFor('ModelSpec'), objective: null }).success).toBe(true)
    const { objective, ...withoutObjective } = validObjectFor('ModelSpec') as { objective?: string | null }
    expect(objective).toBeDefined()
    expect(modelSpecSchema.safeParse(withoutObjective).success).toBe(false)
  })

  it('RunArtifact accepts a null seed and an integer or string seed, but not a fractional one', () => {
    expect(runArtifactSchema.safeParse({ ...validObjectFor('RunArtifact'), seed: null }).success).toBe(true)
    expect(runArtifactSchema.safeParse({ ...validObjectFor('RunArtifact'), seed: 'no-seed-recorded' }).success).toBe(true)
    expect(runArtifactSchema.safeParse({ ...validObjectFor('RunArtifact'), seed: 1.5 }).success).toBe(false)
  })

  it('FigureSpec is schema-only and still demands the provenance fields', () => {
    expect(figureSpecSchema.safeParse({ figure_id: 'F1', data_refs: [], claim_refs: [] }).success).toBe(true)
    expect(figureSpecSchema.safeParse({ figure_id: 'F1', claim_refs: [] }).success).toBe(false)
  })
})
