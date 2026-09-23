/**
 * 规则语料索引 —— 恢复自参考（809KB），由只读工具按需取用，**不内联**。
 *
 * 它守的是用户指出的那个缺陷：S3 我只放了手写摘要，**知识被丢了**。现在语料在仓库里、
 * 索引可核、且**简报暂时不点名它们**（工具未接线，点名就是新的"无法被遵守的指令"）。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKILL_DOCS, SKILL_DOCS_DIR, docsForStage, skillDocBody, skillDocIndexBlock } from '../../src/stages/skill-docs.ts'
import { ADAPTATIONS } from '../../src/stages/adaptation.ts'

// **用模块导出的常量**，不自己另拼一份——第一版两边各拼一份，结果模块的路径漏了
// `skill-docs/` 这一段而测试全绿，只有真正调 skillDocBody 的那条抓到。路径必须单一来源。
const DOCS_DIR = SKILL_DOCS_DIR

describe('语料索引 —— 装配完整性', () => {
  it('**20 份语料全部在磁盘上**（索引与文件必须一一对应）', () => {
    for (const d of SKILL_DOCS) {
      const text = readFileSync(join(DOCS_DIR, d.file), 'utf8')
      expect(text.length, `${d.id} 是空的`).toBeGreaterThan(500)
    }
  })

  it('**总量 ≥ 800KB** —— 这个数字本身就是"不能内联"的证据', () => {
    // **必须按字节算**：第一版用了 `readFileSync(...).length`（字符数），得到 594,708 而误判失败。
    // 中文一字 3 字节，两者差 ~1.36 倍——这正是我为此专门写了 `byteFloor` 门禁的那个单位混淆，
    // 结果自己在测试里又踩了一次。
    const total = SKILL_DOCS.reduce((n, d) => n + Buffer.byteLength(readFileSync(join(DOCS_DIR, d.file), 'utf8'), 'utf8'), 0)
    expect(total).toBeGreaterThan(800_000)
  })

  it('**没有一份含 modex 字样**（恢复时逐份核查过）', () => {
    for (const d of SKILL_DOCS) {
      const text = readFileSync(join(DOCS_DIR, d.file), 'utf8')
      expect(/modex/i.test(text), `${d.id} 含 modex`).toBe(false)
    }
  })

  it('`skillDocBody` 取得到正文；未知 id **抛错**（不返回空串）', () => {
    expect(Buffer.byteLength(skillDocBody('writing-rules'), 'utf8')).toBeGreaterThan(50_000)
    expect(() => skillDocBody('nope')).toThrow(/unknown skill doc/)
  })

  it('`whenToUse` 写成**可判断的条件**，不是"需要时"', () => {
    for (const d of SKILL_DOCS) {
      expect(d.whenToUse, `${d.id} 的 whenToUse 无法据以决策`).toContain('当')
      expect(d.whenToUse.length, `${d.id} 的 whenToUse 太短`).toBeGreaterThan(12)
    }
  })
})

describe('语料索引 —— 阶段覆盖与简报纪律', () => {
  it('三个缺口语料对应的阶段都有份（论文/图表/代码）', () => {
    expect(docsForStage('paper').length).toBeGreaterThanOrEqual(3)   // 写作规范 + 防错 + AI 声明
    expect(docsForStage('code').length).toBeGreaterThanOrEqual(8)    // 防错 + 七份检查清单
    expect(docsForStage('figure').length).toBeGreaterThanOrEqual(6)  // 风格规范 + 范例 + 五份配方
  })

  it('**索引块明确要求"按需取用、不要一次全读"**（809KB 一次读会淹掉上下文）', () => {
    const block = skillDocIndexBlock('paper')
    expect(block).toContain('read_skill_doc')
    expect(block).toContain('按需')
    expect(block).toContain('不要一次全读')
  })

  it('没有语料的阶段返回空串（不产出空标题）', () => {
    // 第一版我拿 `improve` 当"没语料"的例子——错了：`writing-rules` 明确覆盖 paper **与 improve**
    // （改进循环要按写作规范改稿）。真正没有语料的是阶段 5/9/10/11 里不涉写作与图表的那些。
    expect(skillDocIndexBlock('improve')).toContain('writing-rules')
    expect(skillDocIndexBlock('format-profile')).toBe('')
    expect(skillDocIndexBlock('docx-export')).toBe('')
  })
})

describe('语料索引 —— 与适配台账一致', () => {
  it('台账里的 `rule_corpus` 项指向的就是这批语料（两边不许各说各话）', () => {
    const corpus = ADAPTATIONS.filter(a => a.assetClass === 'rule_corpus')
    expect(corpus.length).toBeGreaterThanOrEqual(3)
    for (const a of corpus) {
      // **落点在 detail**（语料现在住哪），**取用方式在 option**（模型怎么拿到）。
      // 第一版我把两者混在一处断言，改了措辞就红——两个字段说的是两件事。
      expect(a.detail, `${a.stage} 没写语料落点`).toContain('skill-docs')
      expect(String(a.option), `${a.stage} 没写取用方式`).toContain('read_skill_doc')
    }
  })

  it('语料的落点与台账写的落点一致（`src/stages/skill-docs/`）', () => {
    expect(DOCS_DIR).toContain(join('src', 'stages', 'skill-docs'))
  })
})
