/**
 * Paper artifact states (TASK 0).
 *
 * Closes the most upstream escape path: "generated output == deliverable".
 * An LLM that has just finished writing a paper body can ONLY produce a
 * `CandidateArtifact`. Promotion to a `DeliverableArtifact` requires a
 * `VerifiedArtifact` intermediate and a successful pass through
 * `DeliveryPolicy`.
 *
 * The state machine and the `promotedAt` / `finalOutputPath` invariants are
 * enforced at the schema level via zod, so any caller that hands a malformed
 * value to the runtime is rejected at parse time, not at execution time.
 */

import { z as zod } from 'zod'

/** Closed three-state union. Anything else is an illegal artifact. */
export const ARTIFACT_STATES = ['CANDIDATE', 'VERIFIED', 'DELIVERABLE'] as const

export type ArtifactState = (typeof ARTIFACT_STATES)[number]

const artifactStateSchema = zod.enum(ARTIFACT_STATES)

/**
 * Base artifact shape. State transitions are expressed as separate zod
 * schemas (see `candidateArtifactSchema`, `verifiedArtifactSchema`,
 * `deliverableArtifactSchema`) so that invariants about field presence
 * cannot be violated by accident.
 */
const baseArtifactFields = {
  id: zod.string().min(1),
  createdAt: zod.string().min(1),
  contentHash: zod.string().min(1),
}

export const candidateArtifactSchema = zod
  .object({
    ...baseArtifactFields,
    state: zod.literal('CANDIDATE'),
  })
  .strict()

export const verifiedArtifactSchema = zod
  .object({
    ...baseArtifactFields,
    state: zod.literal('VERIFIED'),
    verifiedAt: zod.string().min(1),
  })
  .strict()

export const deliverableArtifactSchema = zod
  .object({
    ...baseArtifactFields,
    state: zod.literal('DELIVERABLE'),
    verifiedAt: zod.string().min(1),
    promotedAt: zod.string().min(1),
    finalOutputPath: zod.string().min(1),
  })
  .strict()
  // Belt-and-braces: zod's literal already prevents wrong state, but the
  // refine also makes the contract grep-able and produces a clearer message.
  .refine(
    a => a.state === 'DELIVERABLE' && a.promotedAt.length > 0 && a.finalOutputPath.length > 0,
    {
      message: 'DELIVERABLE artifact must have promotedAt and finalOutputPath set',
    },
  )

export const artifactSchema = zod.discriminatedUnion('state', [
  candidateArtifactSchema,
  verifiedArtifactSchema,
  deliverableArtifactSchema,
])

export type CandidateArtifact = zod.infer<typeof candidateArtifactSchema>
export type VerifiedArtifact = zod.infer<typeof verifiedArtifactSchema>
export type DeliverableArtifact = zod.infer<typeof deliverableArtifactSchema>
export type Artifact = zod.infer<typeof artifactSchema>

/**
 * Promotion errors. Each variant maps to one specific reason the
 * `DeliveryPolicy` failed; consumers (UI, audit, red-team harness) can
 * pattern-match on `kind` to drive their response.
 */
export type PromoteError =
  | { kind: 'wrong_source_state'; from: ArtifactState; to: ArtifactState }
  | { kind: 'verification_not_passed'; gateFailures: string[] }
  | { kind: 'fast_mode_bypass_attempt' }
  | { kind: 'reviewer_malformed_output' }
  | { kind: 'stale_artifact'; reason: string }
  | { kind: 'unresolved_reference'; ref: string }
  | { kind: 'required_output_missing'; output: string }
  | { kind: 'runtime_profile_invalid'; reason: string }

/**
 * Parse + validate an arbitrary object as an Artifact. Throws on invalid
 * input; callers that want a Result-style API should use `safeParseArtifact`
 * instead.
 */
export function parseArtifact(input: unknown): Artifact {
  return artifactSchema.parse(input)
}

/** Non-throwing parse. Returns zod's `SafeParseReturnType`. */
export function safeParseArtifact(input: unknown) {
  return artifactSchema.safeParse(input)
}

/** Convenience: a fresh CandidateArtifact (LLM output). */
export function makeCandidateArtifact(input: {
  id: string
  createdAt: string
  contentHash: string
}): CandidateArtifact {
  return candidateArtifactSchema.parse({ ...input, state: 'CANDIDATE' })
}

/** Convenience: transition a Candidate to a Verified. */
export function makeVerifiedArtifact(input: {
  id: string
  createdAt: string
  contentHash: string
  verifiedAt: string
}): VerifiedArtifact {
  return verifiedArtifactSchema.parse({ ...input, state: 'VERIFIED' })
}

/** Convenience: only the promoter should call this. It enforces every
 * deliverable-shape invariant and rejects malformed input.
 */
export function makeDeliverableArtifact(input: {
  id: string
  createdAt: string
  contentHash: string
  verifiedAt: string
  promotedAt: string
  finalOutputPath: string
}): DeliverableArtifact {
  return deliverableArtifactSchema.parse({ ...input, state: 'DELIVERABLE' })
}

export { artifactStateSchema }
