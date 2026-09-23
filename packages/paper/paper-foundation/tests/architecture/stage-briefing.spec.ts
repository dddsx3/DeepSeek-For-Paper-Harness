/**
 * 阶段简报（技能适配层）—— 用户两条口径的验收：
 * **① 不许简化成摘要；② 自创部分必须用明确指示，不用建议。**
 */

import { describe, expect, it } from 'vitest'
import {
  BRIEFING_SECTIONS,
  isPorted,
  missingSkills,
  stageBriefing,
} from '../../src/stages/briefing.ts'
import { STAGES, stageOf } from '../../src/stages/registry.ts'

const empty = new Map<string, string>()
const brief = (id: Parameters<typeof stageOf>[0], tool = false) => stageBriefing(stageOf(id), empty, tool)

describe('简报 —— 装配完整性', () => {
  it('**11 个阶段都有技能内容**（缺一个就是空壳阶段）', () => {
    expect(missingSkills()).toEqual([])
  })

  it('每个简报都含全部七节（顺序固定）', () => {
    for (const s of STAGES) {
      const text = brief(s.id)
      let at = -1
      for (const name of BRIEFING_SECTIONS) {
        const found = text.indexOf(`## ${name}`)
        expect(found, `${s.id} 缺分节「${name}」`).toBeGreaterThan(-1)
        expect(found, `${s.id} 的分节顺序不对：「${name}」`).toBeGreaterThan(at)
        at = found
      }
    }
  })

  it('**产出契约逐条内联**（模型知道会被量什么，不用猜）', () => {
    for (const s of STAGES) {
      const text = brief(s.id)
      for (const p of s.produces) {
        expect(text, `${s.id} 的契约里没写 ${p.file}`).toContain(p.file)
      }
      // 有字节地板的必须把数字写出来
      const floored = s.produces.filter(p => p.minBytes !== undefined)
      for (const p of floored) {
        expect(text, `${s.id} 没写 ${p.file} 的字节地板`).toContain(String(p.minBytes))
      }
    }
  })
})

describe('简报 —— ① 不许简化成摘要', () => {
  it('每个简报都有实质体量（**下限 800 字符**）', () => {
    for (const s of STAGES) {
      const text = brief(s.id)
      expect(text.length, `${s.id} 的简报只有 ${String(text.length)} 字符 —— 太薄，等于没写`).toBeGreaterThan(800)
    }
  })

  it('每段都给了**具体形态**（不是"要认真写"这类空话）', () => {
    // 抽查几处参考里的硬形态，必须逐字在简报里
    expect(brief('format-profile')).toContain('小四 12')     // 字号映射表
    expect(brief('format-profile')).toContain('SimSun')      // 字体映射表
    expect(brief('figure')).toContain('300 DPI')             // 质量地板
    expect(brief('figure')).toContain('fig_roadmap')         // 命名规则的反例前缀
    expect(brief('paper')).toContain('参考文献')             // 头号拒绝的判据
    expect(brief('review')).toContain('bound_direction')     // findings 类别是闭集
    expect(brief('code')).toContain('jsonPath')              // 数字的合法来源
  })
})

describe('简报 —— ② 自创部分用明确指示', () => {
  it('**阶段 8/11 标记为自创**（参考里没有这两个技能）', () => {
    expect(isPorted(stageOf('improve'))).toBe(false)
    expect(isPorted(stageOf('docx-export'))).toBe(false)
    // 移植的标记为 true（反向守卫：不许把移植的也标成自创）
    expect(isPorted(stageOf('modeling'))).toBe(true)
    expect(isPorted(stageOf('prob-analysis'))).toBe(true)
  })

  it('自创阶段的简报**明说"这是指示，不是建议"**', () => {
    for (const id of ['improve', 'docx-export'] as const) {
      const text = brief(id)
      expect(text, `${id} 没标明自创`).toContain('自创')
      expect(text, `${id} 没把语气钉成指示`).toContain('指示，不是建议')
    }
  })

  it('自创阶段的正文用**祈使句**（必须 / 不得），不用"建议""可以考虑"', () => {
    for (const id of ['improve', 'docx-export'] as const) {
      const text = brief(id)
      expect(text, `${id} 里没有"必须"`).toContain('必须')
      expect(text, `${id} 里没有"不得"`).toContain('不得')
      // 软措辞在自创段落里不允许
      for (const soft of ['建议你', '可以考虑', '最好能', '尽量']) {
        expect(text.includes(soft), `${id} 里出现了软措辞「${soft}」`).toBe(false)
      }
    }
  })

  it('自创阶段的终止条件**写成允许集**（不是"至达标或超时"）', () => {
    const text = brief('improve')
    expect(text).toContain('approved')
    expect(text).toContain('no-progress')
    // 反面：参考工作流原来的措辞"至达标或超时"不许出现
    expect(text).not.toContain('或超时')
    expect(text).toContain('额度不是终止条件')
  })
})

describe('简报 —— 不投递模型做不到的指令（round-5 的教训）', () => {
  it('**没有任何"去读文件"类指令**（本管线的模型调用没有文件工具）', () => {
    for (const s of STAGES) {
      const text = brief(s.id)
      for (const impossible of ['read_file', 'cat _utils', 'cat skills/', '用 Write 工具', 'Bash 的 cat', '$ARGUMENTS', 'MH_FAST_MODE']) {
        expect(text.includes(impossible), `${s.id} 投递了做不到的指令「${impossible}」`).toBe(false)
      }
    }
  })

  it('挂了自检工具的阶段**明说可以调用**；没挂的不提工具', () => {
    const withTool = brief('modeling', true)
    expect(withTool).toContain('check_container')
    expect(withTool).toContain('任意多次')
    const without = brief('modeling', false)
    expect(without).not.toContain('check_container')
  })

  it('每段都有**提交前自检**清单（harness 会跑的判据，不是建议）', () => {
    for (const s of STAGES) {
      const text = brief(s.id)
      expect(text, `${s.id} 没有自检清单`).toContain('提交前自检')
      expect(text, `${s.id} 没说明自检是判据`).toContain('harness 会跑的判据')
    }
  })
})
