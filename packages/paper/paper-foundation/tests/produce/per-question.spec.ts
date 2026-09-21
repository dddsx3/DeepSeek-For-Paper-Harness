/**
 * W11.5 round-7（对齐参照物）— 逐问章装配 + 兜底稿同形态。
 *
 * 参照物 `CUMCM/workspaces/5ba6e7bd5010/paper/main.md` 的骨架是
 * 「统一框架 → 问题一：… → 问题一模型的独立校核 → 问题二：…」——**每问独立成章**。
 * 这两条测试钉住的是：
 *
 *   1. `per-question.ts` 的拆分对 `[[REQUIREMENT: R-Qn]]` 与「问题 N」两种写法都成立，
 *      且没有结构时**返回空**而不是编造问题边界；
 *   2. **两条交付路径呈现同一形态**——`A-produce-chain`（骨架直传 problemChapters）
 *      与 `B-e1-direct`（兜底稿自己装配）都要出现 `## 问题N：…` 章，
 *      否则 fail-soft 交付就是一大段无差别的流水账。
 */

import { describe, expect, it } from 'vitest'
import {
  chapterTitleOf,
  frameworkOf,
  perQuestionChaptersOf,
  perQuestionSectionsOf,
  questionHeadingOf,
  questionRequirements,
} from '../../src/produce/per-question.ts'
import { renderE1DirectDraft } from '../../src/produce/e1-direct.ts'

const REQUIREMENTS = [
  { requirementId: 'R-OUT', statement: '提交一篇完整论文' },
  { requirementId: 'R-Q1', statement: '问题1：建立预热阶段温度场模型并给出稳态厚度' },
  { requirementId: 'R-Q2', statement: '问题2：给出全流程变系数模型与阶段划分' },
]

const E1 = [
  '## 一、总体框架',
  '本文对硅片热氧化过程建立一维稳态导热模型，符号见表 1。',
  '[[ASSUMPTION: A1]] 炉内气体充分混合，温度均匀。',
  '',
  '[[REQUIREMENT: R-Q1]]',
  '问题1的核心是常物性假设下的耦合场求解。我们采用有限差分法离散。',
  '',
  '[[REQUIREMENT: R-Q2]]',
  '问题2需要放开常物性假设，引入温度依赖的导热系数。',
].join('\n')

describe('per-question 装配', () => {
  it('只把子问题（R-Qn）算作逐问章，交付要求 R-OUT 不算', () => {
    expect(questionRequirements(REQUIREMENTS).map(r => r.requirementId)).toEqual(['R-Q1', 'R-Q2'])
  })

  it('按 [[REQUIREMENT: R-Qn]] 拆分，并保留每问的推理正文', () => {
    const sections = perQuestionSectionsOf(E1, REQUIREMENTS)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toContain('### 问题1 的分析')
    expect(sections[0]).toContain('有限差分法')
    expect(sections[1]).toContain('温度依赖的导热系数')
  })

  it('「问题 N」小标题写法同样识别（E1 的形态随运行方差很大）', () => {
    const alt = ['## 问题1', '第一问的做法。', '', '## 问题2', '第二问的做法。'].join('\n')
    const sections = perQuestionSectionsOf(alt, REQUIREMENTS)
    expect(sections).toHaveLength(2)
    expect(sections[1]).toContain('第二问的做法')
  })

  it('正文句子里的"问题1"不算标题——否则整段会被吞掉（round-7 真缺陷）', () => {
    // 旧判据 /^#{0,6}\s*问题\s*([0-9]+)/ 会把这一行当标题，于是该问的正文
    // 一段都进不了缓冲，拆分结果为空、正文在交付里消失。
    const sections = perQuestionSectionsOf(E1, REQUIREMENTS)
    expect(sections[0]).toContain('问题1的核心是常物性假设下的耦合场求解')
    expect(questionHeadingOf('问题1的核心是常物性假设下的耦合场求解。')).toBeNull()
    expect(questionHeadingOf('问题1 需要放开常物性假设。')).toBeNull()
    expect(questionHeadingOf('问题1')).toBe('R-Q1')
    expect(questionHeadingOf('问题一：预热平衡阶段的常物性耦合场求解')).toBe('R-Q1')
    expect(questionHeadingOf('## 问题 2')).toBe('R-Q2')
  })

  it('同一问的多个段落合并，不取第一段就丢后面的', () => {
    const multi = [
      '[[REQUIREMENT: R-Q1]]',
      '第一段：建立控制方程。',
      '[[REQUIREMENT: R-Q2]]',
      '第二问的做法。',
      '[[REQUIREMENT: R-Q1]]',
      '第三段：补充边界条件。',
    ].join('\n')
    const sections = perQuestionSectionsOf(multi, REQUIREMENTS)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toContain('建立控制方程')
    expect(sections[0]).toContain('补充边界条件')
  })

  it('没有可识别结构时返回空——不编造问题边界', () => {
    expect(perQuestionSectionsOf('一段没有任何结构标记的分析。', REQUIREMENTS)).toEqual([])
    expect(perQuestionChaptersOf('一段没有任何结构标记的分析。', REQUIREMENTS)).toEqual([])
    expect(perQuestionChaptersOf(E1, [])).toEqual([])
  })

  it('章标题用题干（去掉题干里重复的"问题N："前缀），正文是拆分出的段落', () => {
    const chapters = perQuestionChaptersOf(E1, REQUIREMENTS)
    expect(chapters).toHaveLength(2)
    expect(chapters[0]?.title).toBe('问题1：建立预热阶段温度场模型并给出稳态厚度')
    expect(chapters[0]?.body).toContain('有限差分法')
    expect(chapters[0]?.body).not.toContain('### 问题1 的分析')
  })

  it('框架段是第一个逐问锚点之前的内容，且不携带 harness 锚点', () => {
    const framework = frameworkOf(E1)
    expect(framework).toContain('总体框架')
    expect(framework).not.toContain('有限差分法')
    // 锚点只服务门禁，不能印进论文（离线预检实测：框架段把锚点带进了正文）。
    expect(framework).not.toContain('[[ASSUMPTION')
    expect(framework).not.toContain('[[REQUIREMENT')
  })

  it('逐问正文里的锚点也剥掉（交付件是论文，不是门禁输入）', () => {
    const sections = perQuestionSectionsOf(E1, REQUIREMENTS)
    for (const section of sections) expect(section).not.toContain('[[')
  })

  it('章标题取题干的自然断点，不把句子切在半句上', () => {
    expect(chapterTitleOf('1', '问题1：建立预热阶段温度场模型并给出稳态厚度。第二句不要。'))
      .toBe('问题1：建立预热阶段温度场模型并给出稳态厚度')
    expect(chapterTitleOf('2', '  给出   全流程   变系数模型  ')).toBe('问题2：给出 全流程 变系数模型')
  })
})

describe('E1 直通兜底稿也按参照物形态渲染', () => {
  const base = {
    e1Text: E1,
    title: '建模分析稿（E1 直通交付）',
    failureReason: 'container missing required field',
    failedRules: ['B4'],
    gate: 'ir_producer',
  }

  it('给出 requirements 时渲染逐问章，且框架段与逐问段不重复', () => {
    const draft = renderE1DirectDraft({ ...base, requirements: REQUIREMENTS })
    expect(draft.problemChapters).toBe(2)
    // round-8: 章标题带序号（参照物形态），所以按行"包含"断言。
    const headings = draft.markdown.split(String.fromCharCode(10))
    expect(headings.some(line => line.includes('问题1：'))).toBe(true)
    expect(headings.some(line => line.includes('问题2：'))).toBe(true)
    // 正文里每问的分析只出现一次（模型章放框架段，不放全文）。
    expect(draft.markdown.split('有限差分法').length - 1).toBe(1)
  })

  it('拿不到 requirements 时退回扁平骨架，不猜问题边界', () => {
    const draft = renderE1DirectDraft(base)
    expect(draft.problemChapters).toBe(0)
    expect(draft.markdown.split(String.fromCharCode(10)).some(line => line.startsWith('## ') && line.includes('问题1：'))).toBe(false)
    // 全文仍在（宁可退化成一大章，也不丢模型写下的内容）。
    expect(draft.markdown).toContain('有限差分法')
  })
})
