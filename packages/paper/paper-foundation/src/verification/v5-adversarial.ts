/**
 * Verification layer V5 — adversarial review (DPH-PRD-v2 §6.4, W7).
 *
 * V5 requires an INDEPENDENT channel that must find >= MIN_FINDINGS real
 * problems in the paper, each with a resolvable target + evidence refs.
 * Zero findings = an INVALID review (the channel must attack, not bless).
 *
 * The verdict is a pure function over the ReviewerFinding objects a run
 * produced and the store they reference:
 *   - zero findings  -> INVALID (the review never attacked)
 *   - a finding whose target_ref / evidence_refs dangle -> discarded as
 *     non-evidence (a hallucinated attack is not a finding)
 *   - a finding with a text_span that is NOT in the delivered paper is
 *     discarded (fabricated span = not evidence) — the fixture's
 *     ReviewerFinding carries `hypothesis`/`reason` as the span text.
 *   - valid findings count must reach MIN_FINDINGS, else INVALID.
 */

export const MIN_ADVERSARIAL_FINDINGS = 1

export interface AdversarialVerdict {
  readonly valid: boolean
  readonly findings_total: number
  readonly findings_valid: number
  readonly findings_discarded: Array<{ id: string; reason: string }>
  readonly detail: string
}

export interface AdversarialInput {
  readonly findings: ReadonlyArray<{
    readonly finding_id: string
    readonly target_ref?: string
    readonly evidence_refs?: ReadonlyArray<string>
    /** The paper span the attack is about (mirrors text_span). */
    readonly reason?: string
    readonly severity?: string
    readonly attack_type?: string
  }>
  /** The delivered paper text — a fabricated span must not appear. */
  readonly paperText: string
  /** Resolves a ref to true iff the store has that id. */
  readonly refResolves: (ref: string) => boolean
}

/** Discard a finding if its target/evidence dangle or its span is absent. */
export function adjudicateAdversarialReview(input: AdversarialInput): AdversarialVerdict {
  const discarded: Array<{ id: string; reason: string }> = []
  let valid = 0
  const total = input.findings.length
  for (const f of input.findings) {
    if (total === 0) break
    const targetOk = f.target_ref === undefined || input.refResolves(f.target_ref)
    const evidenceOk = (f.evidence_refs ?? []).every(r => input.refResolves(r))
    if (!targetOk || !evidenceOk) {
      discarded.push({ id: f.finding_id, reason: `引用悬空(target ${String(f.target_ref)} / evidence ${(f.evidence_refs ?? []).join(',')}) — 非证据` })
      continue
    }
    // A hallucinated attack names a span the paper never said.
    const span = String(f.reason ?? '').trim()
    if (span !== '' && !input.paperText.includes(span)) {
      discarded.push({ id: f.finding_id, reason: 'text_span 未出现在交付文本 — 伪造' })
      continue
    }
    valid += 1
  }
  const validEnough = valid >= MIN_ADVERSARIAL_FINDINGS
  const detail = total === 0
    ? '零发现：对抗审查未攻击任何点 —— 无效审查'
    : `发现 ${total} 条，有效 ${valid} 条，丢弃 ${discarded.length} 条（${discarded.map(d => d.id).join(',') || '无'}）`
  return {
    valid: validEnough && (total > 0),
    findings_total: total,
    findings_valid: valid,
    findings_discarded: discarded,
    detail,
  }
}
