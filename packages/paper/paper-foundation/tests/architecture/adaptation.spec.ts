/**
 * 数字资产适配台账 —— 要防的缺陷是**"只删了指令，没给替代"**。
 *
 * S3 我已经犯过一次：简报里只放了我手写的摘要，参考的规则语料一条都没进来。
 * 那是简化，不是适配。这份台账逐项声明"参考依赖什么 → 本机怎么适配"，
 * 并强制 `missing` 项必须写出**可执行的补齐选项**。
 */

import { describe, expect, it } from 'vitest'
import { ADAPTATIONS, missingAdaptations, stagesWithoutAdaptationRows } from '../../src/stages/adaptation.ts'

describe('适配台账 —— 没有"删掉"这个选项', () => {
  it('**每一项都有适配方式**，四种之一，且 `detail` 写明怎么适配的', () => {
    const allowed = new Set(['inlined', 'ported', 'harness-side', 'tool-fetchable', 'missing'])
    for (const a of ADAPTATIONS) {
      expect(allowed.has(a.mode), `${a.stage}/${a.assetClass} 的 mode '${a.mode}' 不在允许集`).toBe(true)
      expect(a.detail.length, `${a.stage}/${a.assetClass} 没写明怎么适配`).toBeGreaterThan(20)
      expect(a.reference.length, `${a.stage}/${a.assetClass} 没写参考里对应什么`).toBeGreaterThan(5)
    }
  })

  it('**`missing` 项必须给出本机补齐选项**（空选项 = 只删了指令）', () => {
    for (const a of missingAdaptations()) {
      expect(a.option, `${a.stage}/${a.assetClass} 标了 missing 却没写 option`).toBeDefined()
      expect(String(a.option).length, `${a.stage}/${a.assetClass} 的 option 太短，不算可执行方案`).toBeGreaterThan(30)
    }
  })

  it('`missing` 的项数**必须被显式记录**（不允许悄悄增长）', () => {
    // 这不是"通过"的断言，是把当前缺口**钉成一个数字**：缺口变化时测试会红，
    // 逼作者在提交里说明为什么多了/少了一项。
    // 缺口在按计划收敛：8 → 5（规则语料转 tool-fetchable）→ 4（国赛样式档已迁移）
    // → 3（图模板已迁移）→ 1（S5b：导出引擎三个依赖已装并实测跑通；
    //    图表的 Python 规范已做成 `figure_style_rules` 门禁）。
    // 剩的那一项不是"算法没写"，是**接线位置没有**：阶段 1 是模型阶段，
    // 没有 harness 侧后处理钩子，画像器无处可挂（见那行的 detail）。
    expect(missingAdaptations().length).toBe(1)
    expect(missingAdaptations().map(a => `${a.stage}/${a.assetClass}`)).toEqual(['prob-analysis/python_compute'])
  })
})

describe('适配台账 —— 覆盖了参考的全部依赖类别', () => {
  it('八类资产都有记录（规则语料/门禁/文件IO/模板/Python计算/开关/参数/导出引擎）', () => {
    const classes = new Set(ADAPTATIONS.map(a => a.assetClass))
    for (const c of ['rule_corpus', 'gate_script', 'file_io', 'template', 'python_compute', 'cli_flag', 'arg_passing', 'docx_engine']) {
      expect(classes.has(c as never), `台账里没有 ${c} 类`).toBe(true)
    }
  })

  it('**规则语料已恢复 → `tool-fetchable`**（不再是"只放了摘要"）', () => {
    const corpus = ADAPTATIONS.filter(a => a.assetClass === 'rule_corpus')
    expect(corpus.length).toBeGreaterThanOrEqual(3) // 论文写作 / 图表配方 / 代码检查清单
    for (const a of corpus) {
      expect(a.mode, `${a.stage} 的规则语料状态不对`).toBe('tool-fetchable')
      expect(a.detail, `${a.stage} 没写明语料已恢复`).toContain('已恢复')
      expect(String(a.option), `${a.stage} 没写明取用方式`).toContain('read_skill_doc')
    }
  })

  it('文件读写这一类**已经适配**（harness-side），不是缺失', () => {
    const io = ADAPTATIONS.filter(a => a.assetClass === 'file_io')
    expect(io.length).toBeGreaterThanOrEqual(3)
    for (const a of io) expect(a.mode).toBe('harness-side')
  })

  it('`paper_claim_check` 的补齐被标为**最高优先级**（它是阶段 7 前提的强制手段）', () => {
    const hit = ADAPTATIONS.find(a => a.reference.includes('paper_claim_check'))
    expect(hit).toBeDefined()
    expect(String(hit?.option)).toContain('优先级最高')
  })
})

describe('适配台账 —— 阶段覆盖', () => {
  it('**11 个阶段全部有台账记录**（一个都不能漏）', () => {
    // 这条断言被撞过两次，两次都是真缺口：
    //   第一版漏了阶段 10（移植技能 docx-format-check，有真实依赖）；
    //   第二版我以为阶段 8 会空着——其实它有一行（自创技能也要适配 `MH_*` 开关这类依赖）。
    // 现在是 `[]`：每个阶段都能说清"参考依赖什么、本机怎么适配"。
    expect(stagesWithoutAdaptationRows()).toEqual([])
  })

  it('阶段 5/9/11 的模板与引擎缺口都在台账里（不是漏记）', () => {
    const stages = ADAPTATIONS.filter(a => a.mode === 'missing').map(a => a.stage)
    // 导出引擎**不在** missing 里了 —— 三个依赖已装、已实测跑通
    expect(stages).not.toContain('docx-export')
    // 图模板、国赛样式档都**不在** missing 里了 —— 已迁移
    expect(stages).not.toContain('diagram')
    expect(stages).not.toContain('format-profile')
    // 规则语料**不在** missing 里了 —— 它已恢复
    expect(stages).not.toContain('paper')
    // 图表规范**不在** missing 里了 —— 已做成 `figure_style_rules` 门禁
    expect(stages).not.toContain('figure')
    // 仍然在的那一项是接线缺口，不是能力缺口
    expect(stages).toEqual(['prob-analysis'])
  })
})
