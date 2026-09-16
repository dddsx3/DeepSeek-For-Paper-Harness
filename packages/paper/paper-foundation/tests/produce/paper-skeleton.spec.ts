/**
 * W8 — PaperSkeleton rendering tests.
 *
 * PRD §6.1 P0-7 + §8 W8 exit criterion: 骨架可渲染为完整空壳.
 * Verify: all 10 sections present (M4 骨架完整率 100%), symbol table and
 * assumption table auto-generated from IR rows, requirement table from
 * REQUIRED_OUTPUTs, machine rows use the canonical ids, prose slots are
 * placeholders (to be filled) but the sections EXIST.
 */

import { describe, expect, it } from 'vitest'
import { PAPER_SECTIONS, renderPaperSkeleton, type PaperSkeletonInput } from '../../src/produce/paper-skeleton.ts'

const INPUT: PaperSkeletonInput = {
  title: '抽样检验决策模型',
  symbols: [
    { id: 'SYM-p', columns: ['次品率', 'p', '%'] },
    { id: 'SYM-n', columns: ['样本量', 'n', '个'] },
  ],
  assumptions: [
    { id: 'A-1', columns: ['样本独立', 'GIVEN', 'MEDIUM', '是'] },
    { id: 'A-2', columns: ['次品率服从二项分布', 'APPROXIMATION', 'HIGH', '是'] },
  ],
  requirements: [
    { id: 'R-OUT-1', columns: ['设计最小抽样方案', '问题 1'] },
  ],
}

describe('PaperSkeleton', () => {
  it('renders all 10 sections (M4 = 100%)', () => {
    const text = renderPaperSkeleton(INPUT)
    for (const section of PAPER_SECTIONS) {
      expect(text).toContain(`## ${section.title}`)
    }
    expect(PAPER_SECTIONS).toHaveLength(10)
  })

  it('auto-generates the symbol table from IR rows', () => {
    const text = renderPaperSkeleton(INPUT)
    expect(text).toContain('| 符号 | 含义 | 单位 |')
    expect(text).toContain('SYM-p')
    expect(text).toContain('次品率')
    expect(text).toContain('SYM-n')
  })

  it('auto-generates the assumption table from IR rows', () => {
    const text = renderPaperSkeleton(INPUT)
    expect(text).toContain('| 假设 | 来源 | 风险 | 可检验 |')
    expect(text).toContain('A-1')
    expect(text).toContain('样本独立')
    expect(text).toContain('A-2')
  })

  it('renders the requirements table when provided', () => {
    const text = renderPaperSkeleton(INPUT)
    expect(text).toContain('R-OUT-1')
    expect(text).toContain('设计最小抽样方案')
  })

  it('prose sections exist as placeholders (filled by the model later)', () => {
    const text = renderPaperSkeleton(INPUT)
    expect(text).toContain('_(模型待写入)_')
    // 摘要 is prose, so it has the placeholder but its title is present.
    expect(text).toContain('## 摘要')
  })

  it('an empty IR still renders a complete shell (empty tables noted)', () => {
    const text = renderPaperSkeleton({ title: '空壳' })
    expect(text).toContain('符号表由规范 IR 自动生成')
    expect(text).toContain('假设表由规范 IR 自动生成')
    for (const section of PAPER_SECTIONS) expect(text).toContain(`## ${section.title}`)
  })

  it('machine rows escape markdown pipes (no broken tables)', () => {
    const text = renderPaperSkeleton({
      title: 't',
      symbols: [{ id: 'S1', columns: ['含|管道', 'v', 'u'] }],
    })
    expect(text).toContain('含\\|管道')
  })
})
