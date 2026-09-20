/**
 * R1① — figure-link resolver tests. The negative control is the guard:
 * a report that references a figure not on disk must be caught.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/figure-links
 */

import { describe, expect, it } from 'vitest'
import { brokenFigureLinks, figureLinksOf } from '../../src/delivery/figure-links.ts'

describe('figure-links — R1① 链接可解析守卫', () => {
  it('extracts every figures/… target of a rendered report (unique + sorted)', () => {
    const report = [
      '![温度分布](figures/F-TEMP.svg)',
      '## 图',
      '',
      '![水分浓度](figures/F-WATER.svg)',
      '图 2：水分浓度',
      '',
      '![温度分布](figures/F-TEMP.svg)',
    ].join('\n')
    expect(figureLinksOf(report)).toEqual(['figures/F-TEMP.svg', 'figures/F-WATER.svg'])
  })

  it('a report without figure references yields no targets (no false positive)', () => {
    expect(figureLinksOf('纯文本，无图。')).toEqual([])
    expect(figureLinksOf('![不是图](images/other.png)')).toEqual([])
  })

  it('a dangling reference is reported (反例：引用不存在的图必须红)', () => {
    const report = '![断链](figures/nope.svg)'
    const broken = brokenFigureLinks(report, new Set(['figures/nope.svg']))
    expect(broken).toEqual([])
    const actuallyBroken = brokenFigureLinks(report, new Set(['figures/real.svg']))
    expect(actuallyBroken).toEqual(['figures/nope.svg'])
  })

  it('all-on-disk references pass clean (正例)', () => {
    const report = '![a](figures/A.svg)\n![b](figures/B.svg)'
    expect(brokenFigureLinks(report, new Set(['figures/A.svg', 'figures/B.svg']))).toEqual([])
  })
})
