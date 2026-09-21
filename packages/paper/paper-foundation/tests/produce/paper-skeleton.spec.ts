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
    // round-8: 编号章写成 `## N <title>`，所以按行"包含"断言（摘要/参考文献/附录不编号）。
    const headings = text.split(String.fromCharCode(10)).filter(line => line.startsWith('## '))
    for (const section of PAPER_SECTIONS) {
      expect(headings.some(line => line.includes(section.title)), `缺章：${section.title}`).toBe(true)
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
    const headings = text.split(String.fromCharCode(10)).filter(line => line.startsWith('## '))
    for (const section of PAPER_SECTIONS) expect(headings.some(line => line.includes(section.title)), `缺章：${section.title}`).toBe(true)
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
    // round-8: 章标题带序号（参照物形态），逐问章接在模型章（5）之后，校核章跟在
    // **第一问**之后——参照物的「7 问题一模型的独立校核」就在 6 与 8 之间。
    const order = ['## 5 模型建立与求解', '## 6 问题1：设计抽样检测方案', '## 7 问题1模型的独立校核', '## 8 问题2：给出各阶段决策', '## 9 结果对比与校核']
    const positions = order.map(h => text.indexOf(h))
    expect(positions.every(p => p >= 0), `缺章：${order.filter((_h, i) => (positions[i] ?? -1) < 0).join(', ')}`).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('章与小节都带序号，摘要/参考文献/附录不带（参照物口径）', async () => {
    const { renderPaperSkeleton } = await import('../../src/produce/paper-skeleton.ts')
    const text = renderPaperSkeleton({
      title: 't',
      equations: [{ id: 'EQ-1', columns: ['EQ-1', 'q = a + b', 'DEFINITION', 'm'] }],
      slots: { model: '### 方法\n\n方法正文。', code: '代码说明。' },
    })
    expect(text).toContain('## 摘要')
    expect(text).toContain('## 1 问题重述')
    expect(text).toContain('## 2 问题分析')
    expect(text).toContain('## 5 模型建立与求解')
    expect(text).toContain('## 参考文献')
    expect(text).toContain('## 附录 A 数据与输出文件')
    expect(text).toContain('## 附录 B 核心代码')
    // 表号与题注（参照物：`**表 N：题注**` 独占一行）
    expect(text).toContain('**表 1：方程清单**')
    // 槽内容里的小节由渲染器统一编号，接在章号后
    expect(text).toContain('### 5.1 方法')
  })
})
