/**
 * Figure-link resolution — R1①（交付面固化）.
 *
 * The v2 renderer references each figure as `![caption](figures/<id>.svg)` —
 * an INDEPENDENT image file next to the report (never a data-URI, N21). The
 * reference and the file are written by different layers (renderer vs the
 * shell's out-dir), so the link can dangle. This module is the single,
 * mechanical check: extract every `figures/…` target from a report text and
 * let the caller compare against what is actually on disk.
 *
 * Design rule (route book R1①): the negative control is the guard — a report
 * that references `figures/nope.svg` which is not on disk must FAIL, so the
 * assertion is exercised (not ornamented).
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/figure-links
 */

/** Every `figures/…` target referenced by a rendered report, unique + sorted. */
export function figureLinksOf(reportText: string): ReadonlyArray<string> {
  const seen = new Set<string>()
  const pattern = /!\[[^\]]*\]\((figures\/[^)\s]+)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(reportText)) !== null) {
    const target = match[1]
    if (target !== undefined) seen.add(target)
  }
  return [...seen].sort()
}

/** The targets a report references but that are missing from `present` set. */
export function brokenFigureLinks(
  reportText: string,
  present: ReadonlySet<string>,
): ReadonlyArray<string> {
  return figureLinksOf(reportText).filter(target => !present.has(target))
}
