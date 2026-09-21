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
  it('renders all 12 sections (路线书 D3: 12 章无空槽)', () => {
    const text = renderPaperSkeleton(INPUT)
    for (const section of PAPER_SECTIONS) {
      expect(text).toContain(`## ${section.title}`)
    }
    expect(PAPER_SECTIONS).toHaveLength(12)
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

// ---------------------------------------------------------------------------
// W11.5 round-7 — 对齐参照物：每个子问题独立成章 + 独立校核章
// ---------------------------------------------------------------------------
describe('W11.5 round-7 — 逐问章与校核章（参照物结构）', () => {
  it('problemChapters 渲染成独立章节，且插在模型章之后、结果章之前', async () => {
    const { renderPaperSkeleton } = await import('../../src/produce/paper-skeleton.ts')
    const text = renderPaperSkeleton({
      title: 't',
      problemChapters: [
        { title: '问题1：设计抽样检测方案', body: '问题1 归到假设检验，难点是最小样本量。'.repeat(20) },
        { title: '问题2：给出各阶段决策', body: '问题2 归到期望值决策，难点是拆解循环。'.repeat(20) },
      ],
      verification: '校核：与解析解逐位比对，偏差在 1e-3 内。'.repeat(10),
      slots: { restatement: 'x', analysis: 'y', evaluation: 'z', references: 'w', code: 'v', model: 'u' },
    })
    const order = ['## 模型建立与求解', '## 问题1：设计抽样检测方案', '## 问题2：给出各阶段决策', '## 模型校核', '## 结果对比与校核']
    const positions = order.map(h => text.indexOf(h))
    expect(positions.every(p => p >= 0), `缺章：${order.filter((_h, i) => (positions[i] ?? -1) < 0).join(', ')}`).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})
