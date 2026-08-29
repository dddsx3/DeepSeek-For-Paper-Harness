import { describe, expect, it } from 'vitest'
import {
  makeCandidateArtifact,
  makeDeliverableArtifact,
  makeVerifiedArtifact,
  parseArtifact,
  safeParseArtifact,
} from '../../src/delivery/index.ts'

describe('ArtifactStates — three-state invariant', () => {
  it('allows Candidate -> Verified (state change preserves required fields)', () => {
    const candidate = makeCandidateArtifact({
      id: 'art-1',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:candidate-hash',
    })
    expect(candidate.state).toBe('CANDIDATE')
    expect('promotedAt' in candidate).toBe(false)
    expect('finalOutputPath' in candidate).toBe(false)

    const verified = makeVerifiedArtifact({
      id: candidate.id,
      createdAt: candidate.createdAt,
      contentHash: candidate.contentHash,
      verifiedAt: '2026-08-28T00:01:00.000Z',
    })
    expect(verified.state).toBe('VERIFIED')
    expect(verified.verifiedAt).toBe('2026-08-28T00:01:00.000Z')
    expect('promotedAt' in verified).toBe(false)
  })

  it('rejects direct Candidate -> Deliverable: deliverable schema refuses without verifiedAt / promotedAt / finalOutputPath', () => {
    // Caller hands the deliverable schema a CANDIDATE payload.
    const candidate = makeCandidateArtifact({
      id: 'art-2',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:h',
    })
    const result = safeParseArtifact({ ...candidate, state: 'DELIVERABLE' })
    expect(result.success).toBe(false)
  })

  it('allows Verified -> Deliverable (promoter-side only)', () => {
    const verified = makeVerifiedArtifact({
      id: 'art-3',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:v',
      verifiedAt: '2026-08-28T00:01:00.000Z',
    })
    const deliverable = makeDeliverableArtifact({
      id: verified.id,
      createdAt: verified.createdAt,
      contentHash: verified.contentHash,
      verifiedAt: verified.verifiedAt,
      promotedAt: '2026-08-28T00:02:00.000Z',
      finalOutputPath: '/out/art-3.pdf',
    })
    expect(deliverable.state).toBe('DELIVERABLE')
    expect(deliverable.promotedAt).toBe('2026-08-28T00:02:00.000Z')
    expect(deliverable.finalOutputPath).toBe('/out/art-3.pdf')
  })

  it('rejects an artifact with promotedAt set but state != DELIVERABLE (D-007: any direct promotion must be refused by the schema)', () => {
    const malformed = {
      id: 'art-4',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:h',
      state: 'CANDIDATE' as const,
      promotedAt: '2026-08-28T00:02:00.000Z',
    }
    const result = safeParseArtifact(malformed)
    expect(result.success).toBe(false)
  })

  it('rejects unknown states (closed enum)', () => {
    const result = safeParseArtifact({
      id: 'art-5',
      createdAt: '2026-08-28T00:00:00.000Z',
      contentHash: 'sha256:h',
      state: 'PROMOTED_LIKE',
    })
    expect(result.success).toBe(false)
  })

  it('parseArtifact throws on malformed input', () => {
    expect(() => parseArtifact({ state: 'DELIVERABLE' })).toThrow()
  })
})
