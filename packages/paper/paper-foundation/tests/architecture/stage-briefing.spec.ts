/**
 * 阶段简报（技能适配层）—— 用户两条口径的验收：
 * **① 不许简化成摘要；② 自创部分必须用明确指示，不用建议。**
 */

import { describe, expect, it } from 'vitest'
import {
  BRIEFING_SECTIONS,
  answerFormOf,
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
    // 数的**合法来源**这条硬形态随契约移到了阶段 4（数源声明）——断言跟着走，
    // 并钉真实字段名（`json_path` 是 RESULT_SOURCES.json 的键，不是 camelCase）。
    expect(brief('result-sources')).toContain('json_path')   // 数的定位形态
    expect(brief('result-sources')).toContain('locator')
    expect(brief('code')).toContain('JSON 文件')              // 阶段 3 只负责把量写进 JSON
  })
})

describe('简报 —— 回答形态必须教给模型（2024B-stages-1 真实运行换来的判据）', () => {
  it('**简报教的形态 = runner 解析的形态**（规则只写一份，两边共用）', () => {
    // 第一版这条规则只写在 runner.ts 的模块头——模型看不见。真实运行里模型产出
    // 270KB 推理 + 四个独立围栏块、没有一个 JSON 信封，于是"信封不是合法 JSON"。
    // 规则没投递，就不是模型不守约。
    for (const s of STAGES) {
      const text = brief(s.id)
      expect(text, `${s.id} 的简报没写回答形态`).toContain('回答形态（硬性）')
      expect(text).toContain(answerFormOf(s))
    }
  })

  it('多产出阶段点名**每一个**文件名，单产出阶段点名那一个文件', () => {
    const modeling = brief('modeling')
    for (const f of ['DECLARATION.json', 'MODELING_REPORT.md']) expect(modeling).toContain(f)
    expect(modeling).toContain('{"files"')
    const paper = brief('paper')
    expect(paper).toContain('paper/main.md')
    expect(paper).not.toContain('{"files"')
  })

  it('多产出阶段明说"除这一个 JSON 对象外不得有任何其它字符"', () => {
    expect(brief('code')).toContain('不得有任何其它字符')
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

  it('**语料索引只在工具挂了时出现**（没挂却点名 = 又一条无法被遵守的指令）', () => {
    // 开关是同一个：`selfCheckTool` 同时控制"自检工具"与"语料索引"。
    const on = brief('code', true)
    expect(on).toContain('read_skill_doc')
    expect(on).toContain('code-checks-index')
    const off = brief('code', false)
    expect(off).not.toContain('read_skill_doc')
    // 但"本步知识"里的规范要点**始终在**（那是内联知识，不依赖工具）
    expect(off).toContain('JSON 文件')  // 内联知识始终在（不依赖工具）
  })

  it('每段都有**提交前自检**清单（harness 会跑的判据，不是建议）', () => {
    for (const s of STAGES) {
      const text = brief(s.id)
      expect(text, `${s.id} 没有自检清单`).toContain('提交前自检')
      expect(text, `${s.id} 没说明自检是判据`).toContain('harness 会跑的判据')
    }
  })
})

/**
 * 阶段 2 简报要点名**两种最常撞的无出生证明数字形态**。
 *
 * 实测：模型在散文里举例时写 `P(X≥2|p_nom) = 0.01`（手算 p_nom²），
 * 又写"把置信水平提到 99%"（灵敏度格点），两处都被 `numbers_traced` 判无出生证明。
 * 规则本来就禁止"心算出的结果"，但模型不知道**举例**与**扫描格点**也算——
 * 所以简报要具名，否则每一轮都要用一次真实运行去教它。
 */
describe('阶段 2 简报 —— 举例与扫描格点要出生证明', () => {
  const brief = stageBriefing(stageOf('modeling'), new Map(), false)

  it('点名"举例写符号不写手算的数"，并给出替换写法', () => {
    expect(brief).toContain('举例与扫描格点同样要出生证明')
    expect(brief).toContain('p_nom²')
    expect(brief).toContain('0.01')
  })

  it('点名灵敏度格点要进 model_constants，并解释 90%/95% 为何能过', () => {
    expect(brief).toContain('灵敏度扫描置信水平')
    expect(brief).toContain('99%')
    expect(brief).toContain('别把巧合当许可')
  })
})

/**
 * 重跑必须带上**上一轮审计的问题** —— 否则重跑就是盲重试。
 *
 * 用户加逐节点审计的初衷是"不要用试错代替复核"。但如果审计提的问题传不到重跑，
 * 重跑就退化成"同一个模型在同一份简报下再生成一次，指望它自己撞对"——
 * 审计白跑，试错照旧。这一段就是那个回路。
 */
describe('重跑简报 —— 上一轮审计的问题必须投递', () => {
  const findings = [
    { severity: 'major', where: 'DECLARATION.json EQ-MINN', issue: '情形二约束方向与情形一不对称', fix: '改成 P(X≤c|p_nom) ≤ β' },
    { severity: 'minor', where: '§4.4', issue: 'n=100 未与问题 1 衔接', fix: '改用问题 1 求得的 n' },
  ]

  it('首轮（没有问题）**不出现**那一段——空标题会让模型以为被判过', () => {
    const brief = stageBriefing(stageOf('modeling'), new Map(), false)
    expect(brief).not.toContain('上一轮审计提出的问题')
  })

  it('重跑时逐条列出：严重度 + 位置 + 问题 + 建议改法', () => {
    const brief = stageBriefing(stageOf('modeling'), new Map(), false, findings)
    expect(brief).toContain('上一轮审计提出的问题')
    expect(brief).toContain('[major] DECLARATION.json EQ-MINN')
    expect(brief).toContain('情形二约束方向与情形一不对称')
    expect(brief).toContain('改成 P(X≤c|p_nom) ≤ β')
    expect(brief).toContain('[minor] §4.4')
  })

  it('**要求逐条处理或明确反驳**——沉默重发不算处理', () => {
    const brief = stageBriefing(stageOf('modeling'), new Map(), false, findings)
    expect(brief).toContain('必须逐条处理或明确反驳')
    expect(brief).toContain('沉默地重发一遍不算处理')
  })

  it('位置在「不要做」之后、「自检」之前（越靠后越重要）', () => {
    const brief = stageBriefing(stageOf('modeling'), new Map(), false, findings)
    const at = brief.indexOf('上一轮审计提出的问题')
    expect(at).toBeGreaterThan(brief.indexOf('明确不要做'))
    expect(at).toBeLessThan(brief.indexOf('提交前自检'))
  })
})
