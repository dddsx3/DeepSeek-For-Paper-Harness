/**
 * Delivery grades (DPH-PRD-v2 §3.3, P0-3 — W2).
 *
 * The fail-soft delivery threshold: gates no longer decide WHETHER a run
 * delivers; they decide WHAT the delivery is LABELED with. The three
 * grades:
 *
 *   CLEAN   — every gate passed; the paper delivers unmarked.
 *   MARKED  — some gates failed, but content exists; the paper still
 *             delivers, with an appendix listing every unpassed item,
 *             its location, and its reason. The default grade for the
 *             mass tier (大众档).
 *   BLOCKED — delivery is refused. ONLY three conditions can cause it
 *             (the fatal list — everything else degrades to MARKED):
 *               1. content is empty (< EMPTY_CONTENT_CHARS of body text);
 *               2. code execution failed (the run never produced the
 *                  artifacts the paper would cite);
 *               3. references cannot resolve to ANY result (the paper's
 *                  numbers would have no backing whatsoever).
 *
 * Design invariants (mirroring the repo's gate discipline — no second
 * verdict path, no silent downgrade):
 *   - `gradeDelivery` is a pure function of its inputs; no I/O, no clock.
 *   - The fatal list is CLOSED: a caller cannot invent a new BLOCKED
 *     reason by passing a fancy failure kind; unknown kinds land in the
 *     MARKED annotation list.
 *   - MARKED annotations are never dropped: whatever the grade, the full
 *     failure list is returned so the appendix renderer and the audit
 *     trail see the same items.
 */

/** Minimum non-whitespace characters for content to count as existing. */
export const EMPTY_CONTENT_CHARS = 200

/** The closed set of delivery grades. */
export const DELIVERY_GRADES = ['CLEAN', 'MARKED', 'BLOCKED'] as const
export type DeliveryGrade = (typeof DELIVERY_GRADES)[number]

/**
 * The closed fatal-condition inputs. All three are booleans the caller
 * derives from run facts; this module never re-derives them.
 */
export interface FatalConditions {
  /** Body content below EMPTY_CONTENT_CHARS after trim. */
  readonly emptyContent: boolean
  /** The execute stage's code run refused / never captured artifacts. */
  readonly executionFailed: boolean
  /** No claim reference resolves to any Result in the IR. */
  readonly referenceCatastrophe: boolean
}

/** One annotation item for the MARKED appendix. */
export interface GradeAnnotation {
  readonly kind: string
  readonly reason: string
  /** Where the failure binds in the paper (gate id / node / section). */
  readonly location: string
}

/** The graded outcome: grade + the annotations that must ship with it. */
export interface GradeDecision {
  readonly grade: DeliveryGrade
  readonly annotations: ReadonlyArray<GradeAnnotation>
}

/**
 * Grade a delivery from its gate outcome and fatal conditions.
 *
 * @param failures   The delivery failures as `evaluateDelivery` reported
 *                   them (kind + reason). Empty ⇒ CLEAN.
 * @param fatal      The three closed fatal conditions.
 * @param locations  Optional kind→location map for annotations; failures
 *                   without a mapping get the location 'delivery'.
 */
export function gradeDelivery(
  failures: ReadonlyArray<{ readonly kind: string; readonly reason: string }>,
  fatal: FatalConditions,
  locations: Readonly<Record<string, string>> = {},
): GradeDecision {
  const annotations: GradeAnnotation[] = failures.map(f => ({
    kind: f.kind,
    reason: f.reason,
    location: locations[f.kind] ?? 'delivery',
  }))

  if (fatal.emptyContent || fatal.executionFailed || fatal.referenceCatastrophe) {
    // Fatal list tripped: no delivery at all. The annotations still return
    // so the audit entry explains the BLOCKED verdict.
    return { grade: 'BLOCKED', annotations }
  }
  if (annotations.length === 0) return { grade: 'CLEAN', annotations }
  return { grade: 'MARKED', annotations }
}

/**
 * Render the MARKED appendix (PRD §3.3 design point 1: annotations live in
 * an appendix, never inline in the body — the paper's readability stays
 * intact while the product stays honest).
 */
export function renderDeliveryAppendix(
  grade: DeliveryGrade,
  annotations: ReadonlyArray<GradeAnnotation>,
): string {
  if (grade === 'CLEAN') return ''
  const lines: string[] = []
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 附录：交付标注（自动生成）')
  lines.push('')
  if (grade === 'MARKED') {
    lines.push(`本稿以 MARKED（标注交付）等级交付：${annotations.length} 项检查未通过。内容照常可用；以下逐项列出未通过项、位置与原因，供复核与改进。`)
  } else {
    lines.push(`本运行以 BLOCKED 判定：${annotations.length} 项致命条件命中，不予交付。以下为判定依据。`)
  }
  lines.push('')
  lines.push('| # | 检查项 | 位置 | 原因 |')
  lines.push('|---|---|---|---|')
  for (let i = 0; i < annotations.length; i += 1) {
    const a = annotations[i]
    if (a === undefined) continue
    lines.push(`| ${i + 1} | ${a.kind} | ${a.location} | ${a.reason.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')
  lines.push('*标注由交付门槛自动生成（fail-soft）：未通过项不拦截交付，但必须在此如实列出。*')
  return lines.join('\n')
}

/**
 * The fatal-content probe: does the draft body have real content?
 * Whitespace and the appendix itself do not count.
 */
export function contentExists(bodyText: string): boolean {
  const stripped = bodyText.replace(/\s+/g, '')
  return stripped.length >= EMPTY_CONTENT_CHARS
}
