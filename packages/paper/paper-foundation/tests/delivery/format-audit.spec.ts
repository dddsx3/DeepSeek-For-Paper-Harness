/**
 * 格式审计 —— 以参照物论文为唯一合法标准。
 *
 * ## 参照物
 *
 * `CUMCM/workspaces/5ba6e7bd5010/paper/main.docx`（实测抽取形态：1 个 `#`、
 * `## 摘要` 不编号、`## N 章名` 1–11 连续、`### N.M 小节` 40 条、
 * `**表 N：题注**`、`![图 N：题注](…)`、56 个 `$$` 块）。
 *
 * ## 这套判据抓到的真事
 *
 * round-9（`3f43f9fcaa`）为解决"E1 标题泄漏"加了
 * `.replace(/^#{1,6}\s+(.+)$/gm, '**$1**')`——把 E1 里**所有层级**标题降级为加粗行。
 * 修法合理，但**判据过宽**：模型写的合法 `### N.M 小节` 一并被杀。
 * 而兜底路径的正文就是 E1 原文，于是从那轮起 13 次真实运行的交付稿小节数**全为 0**
 * （此前是 0/0/24/0/24——取决于模型当次写没写）。
 *
 * 本文件用**构造的样本**钉住每一条判据，并用**真实产物**做一次回归断言。
 */

import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REFERENCE_FORMAT, formatViolations } from '../../src/delivery/format-audit.ts'

/** 一份形态**完全对齐参照物**的骨架（用来做反向对照）。 */
function conforming(): string {
  return [
    '# 药材热风烘干过程的柱坐标耦合传热-传质模型与烘干时长确定',
    '',
    '## 摘要',
    '',
    '本文建立……',
    '',
    '## 1 问题重述',
    '',
    '### 1.1 问题背景',
    '',
    '题面给出……',
    '',
    '### 1.2 问题描述',
    '',
    '要求解……',
    '',
    '## 2 问题分析',
    '',
    '### 2.1 问题一的分析',
    '',
    '**表 1：三套物性经验公式**',
    '',
    '| 参数 | 值 |',
    '|---|---|',
    '| a | 1 |',
    '',
    '由式（1）可得……',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '![图 1：四问依赖链](figures/fig_roadmap.png)',
    '',
    '## AI 声明',
    '',
    '本文由 AI 辅助完成。',
    '',
    '## 参考文献',
    '',
    '[1] 某某. 书名. 出版社, 2020.',
    '',
    '## 附录 A 数据与输出文件',
    '',
    '见附件。',
  ].join('\n')
}

describe('格式审计 — 反向对照', () => {
  it('对齐参照物的骨架零违规（防误报）', () => {
    const v = formatViolations(conforming())
    expect(v, JSON.stringify(v, null, 2)).toEqual([])
  })
})

describe('格式审计 — F1 标题层级', () => {
  it('多个 `#` 报出来（E1 泄漏成论文章节的原始形态）', () => {
    const v = formatViolations(`${conforming()}\n# B题 建模工作笔记\n`)
    expect(v.some(x => x.rule === 'F1')).toBe(true)
  })
})

describe('格式审计 — F2 摘要', () => {
  it('摘要带编号 → 报出来（参照物是 `## 摘要`，不编号）', () => {
    const v = formatViolations(conforming().replace('## 摘要', '## 0 摘要'))
    expect(v.some(x => x.rule === 'F2')).toBe(true)
  })

  it('没有摘要章 → 报出来', () => {
    const v = formatViolations(conforming().replace('## 摘要\n\n本文建立……\n\n', ''))
    expect(v.some(x => x.rule === 'F2')).toBe(true)
  })
})

describe('格式审计 — F3 章编号', () => {
  it('跳号 → 报出来（某一章被插入或丢失）', () => {
    const v = formatViolations(conforming().replace('## 2 问题分析', '## 3 问题分析'))
    const hit = v.find(x => x.rule === 'F3')
    expect(hit).toBeDefined()
    expect(hit?.detail).toContain('跳号')
  })

  it('章号后带点 → 报出来（参照物是 `## 1 问题重述`）', () => {
    const v = formatViolations(conforming().replace('## 1 问题重述', '## 1. 问题重述'))
    expect(v.some(x => x.rule === 'F3' && x.detail.includes('不带点'))).toBe(true)
  })
})

describe('格式审计 — F4 小节（飘移的主判据）', () => {
  it('**有编号章却一条小节都没有 → 报出来**（round-9 之后的实际形态）', () => {
    const noSections = conforming().replace(/^### .*$/gm, '**某小节**')
    const v = formatViolations(noSections)
    const hit = v.find(x => x.rule === 'F4')
    expect(hit, JSON.stringify(v)).toBeDefined()
    expect(hit?.detail).toContain('一条都没有')
    // 这条的说明必须点出成因，否则维护者不知道从哪查
    expect(hit?.detail).toContain('round-9')
  })

  it('小节不带章号 → 报出来（参照物一律 `### 2.1 …`）', () => {
    const v = formatViolations(conforming().replace('### 2.1 问题一的分析', '### 问题一的分析'))
    expect(v.some(x => x.rule === 'F4' && x.detail.includes('不带'))).toBe(true)
  })
})

describe('格式审计 — F5 表题注', () => {
  it('有表却无题注 → 报出来', () => {
    const v = formatViolations(conforming().replace('**表 1：三套物性经验公式**\n\n', ''))
    const hit = v.find(x => x.rule === 'F5')
    expect(hit).toBeDefined()
    expect(hit?.detail).toContain('没有一条')
  })

  it('表号不连续 → 报出来', () => {
    const v = formatViolations(conforming().replace('**表 1：三套物性经验公式**', '**表 2：三套物性经验公式**'))
    expect(v.some(x => x.rule === 'F5' && x.detail.includes('连续'))).toBe(true)
  })

  it('非粗体题注不算题注（参照物是 `**表 N：题注**`）', () => {
    const v = formatViolations(conforming().replace('**表 1：三套物性经验公式**', '表 1：三套物性经验公式'))
    expect(v.some(x => x.rule === 'F5')).toBe(true)
  })
})

describe('格式审计 — F6 图题注', () => {
  it('有图引用但无 `![图 N：…]` → 报出来', () => {
    const v = formatViolations(conforming().replace('![图 1：四问依赖链](figures/fig_roadmap.png)', '![](figures/fig_roadmap.png)'))
    expect(v.some(x => x.rule === 'F6')).toBe(true)
  })
})

describe('格式审计 — F7 公式形态', () => {
  it('引用了 `式（2）` 却只有 1 个公式块 → 报出来', () => {
    const v = formatViolations(conforming().replace('由式（1）可得……', '由式（2）可得……'))
    const hit = v.find(x => x.rule === 'F7')
    expect(hit).toBeDefined()
    expect(hit?.detail).toContain('式（2）')
  })

  it('引用数与块数相符时不报（反向守卫）', () => {
    expect(formatViolations(conforming()).some(x => x.rule === 'F7')).toBe(false)
  })
})

describe('格式审计 — F8 不编号章的许可集', () => {
  it('冒出不编号的普通章 → 报出来', () => {
    const v = formatViolations(`${conforming()}\n## 模型评价与推广\n\n内容。\n`)
    const hit = v.find(x => x.rule === 'F8')
    expect(hit).toBeDefined()
    expect(hit?.detail).toContain('模型评价与推广')
  })

  it('许可集内的（摘要/AI 声明/参考文献/附录）不报', () => {
    expect(formatViolations(conforming()).some(x => x.rule === 'F8')).toBe(false)
  })
})

describe('格式审计 — 对真实产物的回归（飘移必须可见）', () => {
  const real = new URL('../../../../../artifacts/upper-bound/2024B-strict-13/report.md', import.meta.url).pathname.replace(/^\//, '')
  it('strict-13 的交付稿必须被 F4 判出"没有小节"', () => {
    if (!existsSync(real)) return // 产物未随仓库分发时跳过（不在 CI 里假绿）
    const md = readFileSync(real, 'utf8')
    const v = formatViolations(md)
    const f4 = v.find(x => x.rule === 'F4')
    expect(f4, `strict-13 应被判出缺少小节层级，实际违规：${JSON.stringify(v.map(x => x.rule))}`).toBeDefined()
    expect(f4?.detail).toContain('一条都没有')
  })

  it('参照物的形态常量与实测一致（防止判据随实现漂移）', () => {
    expect(REFERENCE_FORMAT.titleCount).toBe(1)
    expect(REFERENCE_FORMAT.unnumberedChapters).toContain('摘要')
    expect(REFERENCE_FORMAT.appendixPrefix).toBe('附录')
  })
})
