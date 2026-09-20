/**
 * R2② — DOCX 导出前校核测试（十五类，每类正例 + 负例）。
 *
 * 判据（路线书 R2②）：零致命才允许导出；每类检查都必须有一个让它
 * 变红的反例（负对照纪律）。退出码契约 (R2⑥)：0 通过 / 1 致命 / 2 无据可查。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/docx-precheck
 */

import { describe, expect, it } from 'vitest'
import { DOCX_CHECK_CODES, docxPrecheckVerdict, runDocxPrechecks } from '../../src/delivery/docx-precheck.ts'

/** A well-formed markdown report with the full DPH skeleton + every checkable slot. */
const WELL_FORMED = [
  '# 摘要',
  '',
  '本文给出抽样检验与生产决策的统一方案。',
  '# 问题重述',
  '',
  '本题研究抽样检验与生产决策。',
  '# 问题分析',
  '',
  '按情形分别建模。',
  '# 模型假设',
  '',
  '假设次品相互独立。',
  '# 符号说明',
  '',
  '| 符号 | 含义 |',
  '| --- | --- |',
  '| $n$ | 样本量 |',
  '# 模型建立与求解',
  '',
  '由二项分布 $P(X\\ge c)$ 构造检验，$$\\alpha = \\sum_{k=c}^{n} \\binom{n}{k} p^k (1-p)^{n-k}$$',
  '',
  '| 参数 | 取值 |',
  '| --- | ---: |',
  '| 样本量 | 109 |',
  '',
  '表 1：参数表',
  '',
  '![采样方案](figures/F-A.svg)',
  '',
  '图 1：采样方案',
  '',
  '见文献 [1] 与 [2]。',
  '# 结果对比与校核',
  '',
  '结论如正文所述。',
  '# 模型评价与推广',
  '',
  '方案可推广。',
  '# AI 声明',
  '',
  '本文由生产链辅助生成。',
  '# 参考文献',
  '',
  '[1] 作者甲. 抽样检验方法. 2026.',
  '[2] 作者乙. 生产决策模型. 2026.',
  '# 数据附录',
  '',
  '结果数据见 figures/ 与结果表。',
  '# 代码附录',
  '',
  '```js',
  'const n = 109;',
  '```',
].join('\n')

const FIGURES = ['F-A.svg', 'F-B.svg']

describe('docx-precheck — 正例（完备稿零致命）', () => {
  it('well-formed report passes every check (0 致命才允许导出)', () => {
    const results = runDocxPrechecks({ reportMarkdown: WELL_FORMED, figureFiles: FIGURES })
    const verdict = docxPrecheckVerdict(results)
    expect(verdict.fatal, JSON.stringify(verdict.fatalReasons)).toBe(false)
    expect(verdict.passed).toBeGreaterThanOrEqual(10)
    // 十五类闭集未漂移
    expect(new Set(results.map(r => r.code))).toEqual(new Set(DOCX_CHECK_CODES))
  })

  it('统计面数字可核对（图片引用/块行内公式/表格/引文）', () => {
    const results = runDocxPrechecks({ reportMarkdown: WELL_FORMED, figureFiles: FIGURES })
    const byCode = new Map(results.map(r => [r.code, r.detail]))
    expect(byCode.get('image_refs')).toContain('1')
    expect(byCode.get('block_math')).toContain('1')
    expect(byCode.get('inline_math')).toContain('2')
    expect(byCode.get('citation_count')).toContain('2')
  })
})

describe('docx-precheck — 负例（每类要能变红）', () => {
  it('悬空图片引用 → fatal（fig_ref_resolution）', () => {
    const text = '# 题\n\n![断链](figures/GONE.svg)\n'
    const verdict = docxPrecheckVerdict(runDocxPrechecks({ reportMarkdown: text, figureFiles: ['F-A.svg'] }))
    expect(verdict.fatalReasons.some(r => r.includes('fig_ref_resolution'))).toBe(true)
  })

  it('标题跳级 h1→h3 → fatal（heading_continuity）', () => {
    const text = '# 一\n### 三\n'
    const verdict = docxPrecheckVerdict(runDocxPrechecks({ reportMarkdown: text, figureFiles: [] }))
    expect(verdict.fatalReasons.some(r => r.includes('heading_continuity'))).toBe(true)
  })

  it('表格列数不一 → fatal（table_columns）', () => {
    const text = '# 题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 1 |\n'
    const verdict = docxPrecheckVerdict(runDocxPrechecks({ reportMarkdown: text, figureFiles: [] }))
    expect(verdict.fatalReasons.some(r => r.includes('table_columns'))).toBe(true)
  })

  it('未配对公式定界符 → fatal（math_delimiters）', () => {
    const verdict = docxPrecheckVerdict(runDocxPrechecks({ reportMarkdown: '# 题\n\n正文 $x=1\n', figureFiles: [] }))
    expect(verdict.fatalReasons.some(r => r.includes('math_delimiters'))).toBe(true)
  })

  it('空正文 → fatal（body_non_empty）', () => {
    const verdict = docxPrecheckVerdict(runDocxPrechecks({ reportMarkdown: '', figureFiles: [] }))
    expect(verdict.fatalReasons.some(r => r.includes('body_non_empty'))).toBe(true)
  })

  it('缺少必需章节 → fatal（skeleton_present）', () => {
    const verdict = docxPrecheckVerdict(runDocxPrechecks({ reportMarkdown: '# 别的\n\n内容', figureFiles: [] }))
    expect(verdict.fatalReasons.some(r => r.includes('skeleton_present'))).toBe(true)
  })

  it('引文号无文献列表支撑 → fatal（citation_resolution）；无引文 → 无据可查不误杀（2）', () => {
    const broken = runDocxPrechecks({ reportMarkdown: '# 题\n\n内容见 [99]。\n', figureFiles: [] })
    expect(docxPrecheckVerdict(broken).fatalReasons.some(r => r.includes('citation_resolution'))).toBe(true)
    const dangling = runDocxPrechecks({ reportMarkdown: '# 题\n\n见 [1]，但列表只有 [2]。\n\n[2] 作者. 2026.\n', figureFiles: [] })
    expect(docxPrecheckVerdict(dangling).fatalReasons.some(r => r.includes('citation_resolution'))).toBe(true)
    const none = runDocxPrechecks({ reportMarkdown: '# 题\n\n无引文。\n', figureFiles: [] })
    expect(none.find(r => r.code === 'citation_resolution')?.status).toBe(2)
  })

  it('无图/无表 → caption/table 检查为无据可查（2）而非致命（反假红）', () => {
    const results = runDocxPrechecks({ reportMarkdown: '# 题\n\n正文。\n', figureFiles: [] })
    expect(results.find(r => r.code === 'caption_solo_lines')?.status).toBe(2)
    expect(results.find(r => r.code === 'table_columns')?.status).toBe(2)
  })
})
