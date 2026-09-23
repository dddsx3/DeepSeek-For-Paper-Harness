it('**每一步的简报把它需要的知识内联进来**——指路是空话', () => {
  // 事故（本轮实测）：第一版简报写"必读 skills/x.md，用 read_file 读它"——而本管线
  // 的模型调用**没有工具**（streamCompletion 不发 tools，代码里没有 tool 循环）。
  // 那是一条模型无法遵守的指令。没有工具时唯一诚实的形态是**内联**。
  for (const step of BRIEFING_STEPS) {
    const briefing = stepBriefing(step, { target: 'T', upstream: 'U', done: 'D' })
    expect(briefing).toContain('=== THIS STEP')
    expect(briefing).toContain('Do NOT')
    expect(briefing).toContain('Done when')
    // 不许再声称模型能去读文件。
    expect(briefing, `${step} 仍然声称模型能读文件`).not.toContain('read_file(')
  }
})

it('产出步内联了写作与数字纪律；分析步**不**内联（否则淹掉"写散文"的指令）', () => {
  const produce = stepBriefing('produce', { target: 'T', upstream: 'U', done: 'D' })
  // 内联的是**正文**，不是文件名。
  expect(produce).toContain('数字进入正文')
  expect(produce).toContain('章节骨架')
  // 分析步必须轻——W8.10-D4 修掉的正是"E1 看到容器教学"。
  const analyze = stepBriefing('analyze', { target: 'T', upstream: 'U', done: 'D' })
  expect(analyze.length).toBeLessThan(600)
  expect(analyze).not.toContain('ir-container-v1')
})

/**
 * 门禁 ⇔ 教学 的**成本分流**契约（替代旧的 `teaching-contract.spec.ts`）。
 *
 * ## 旧契约的问题
 *
 * 旧契约要求"每个门禁的规则文本都必须出现在教学里"。它保证了一件事——**教过**，
 * 代价是**永远以最贵的形式教**：所有规则都被编译进 prompt，于是每加一条门禁，
 * prompt 就长一截，模型的建模预算就少一点。这条契约把那种膨胀**锁死成纪律**，
 * 即使模型早就会了。
 *
 * ## 新契约
 *
 * 规则文本必须出现在**它该在的那一层**，而"该在哪一层"由成本决定：
 *
 * | 性质 | 判据 | 归属 | 检查方式 |
 * |---|---|---|---|
 * | **接口** | 模型不看到就产不出合法容器 | 最小宪法（prompt 内） | 宪法必须包含该串 |
 * | **知识** | "怎么写更好" | 技能库（按需查询） | 技能库某文档必须包含该串 |
 *
 * 分流表就是 `gate-state.ts` 的 `GATE_ACTIVATIONS`（每条登记一个 `home`）。
 * 因此"漏教"仍然不可能发生——只是教的位置变了。
 *
 * ## 另外两条不变量（沿用旧契约，它们是对的）
 *
 * 1. **篇幅数字同源**：教学里出现的每一个退回线都取自 `PAPER_LENGTH_REFERENCE`，
 *    不允许出现第二个来源（round-8 抓到过一次漂移：教学说 600、门禁查 1200，
 *    模型按教学写、按门禁被拒，一次尝试白烧）。
 * 2. **宪法必须紧凑**：它有预算上限。一旦它开始膨胀，说明有"知识"被塞回来了——
 *    这是本次改造要防的头号回退形态。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/constitution-contract
 */

import { describe, expect, it } from 'vitest'
import { EXECUTE_PROTOCOL_TEACHING } from '../src/executor.ts'
import { IRON_RULES, PAPER_CONSTITUTION } from '../src/knowledge/constitution.ts'
import { BRIEFING_STEPS, SKILL_DOCS, skillIndexBlock, stepBriefing } from '../src/knowledge/skill-library.ts'
import { GATE_ACTIVATIONS } from '../src/delivery/gate-state.ts'
import { PAPER_LENGTH_REFERENCE } from '../src/delivery/prose-contracts.ts'

/** 注入 prompt 的全部教学文本 = 宪法 + 技能库索引。 */
const TAUGHT = EXECUTE_PROTOCOL_TEACHING

/** 技能库全文（索引之外的正文）。 */
const LIBRARY_TEXT = SKILL_DOCS.map(d => d.body).join('\n\n')

describe('门禁 ⇔ 教学：按成本分流', () => {
  it('注入 prompt 的教学 = 宪法 + 技能库索引，且不含任何技能文档正文', () => {
    expect(TAUGHT).toContain(PAPER_CONSTITUTION)
    expect(TAUGHT).toContain(skillIndexBlock())
    // 索引里只有 id / 标题 / "什么时候读"，**没有正文**——这是"按需加载"
    // 能成立的前提：正文进了 prompt，就等于又变成了全员强制预载。
    for (const doc of SKILL_DOCS) {
      expect(TAUGHT.includes(doc.body), `技能文档 ${doc.id} 的正文被塞进了 prompt`).toBe(false)
    }
  })

  it('十条铁律全部在宪法里（它们是不可协商的，不能外置）', () => {
    expect(IRON_RULES).toHaveLength(10)
    for (const rule of IRON_RULES) {
      // 铁律的**编号**必须出现在宪法里（正文措辞可以精简，编号是索引）。
      expect(PAPER_CONSTITUTION, `铁律 ${rule.id} 的编号不在宪法里`).toContain(rule.id)
    }
  })

  it('每一条 interface 门禁的规则都在宪法里', () => {
    const interfaceGates: ReadonlyArray<{ readonly gate: string; readonly taught: string }> = [
      { gate: 'container_shape（首行版本标记）', taught: '__dsh_paper' },
      { gate: 'numeric_channel（数字可点名）', taught: '{<result_id>}' },
      { gate: 'required_output_unpaid（逐问覆盖）', taught: 'EVERY SUB-PROBLEM' },
      { gate: 'figure_required', taught: 'at least ONE figure' },
      { gate: 'e1_e2_fidelity / B4 逐问覆盖', taught: '[[REQUIREMENT: R-Q1]]' },
      { gate: 'e1_e2_fidelity / B3 正向（逐字 span）', taught: 'copied VERBATIM from the E1 text' },
      { gate: 'e1_e2_fidelity / B3 反向与锚点同一性', taught: '[[ASSUMPTION: <id>]]' },
      { gate: 'placeholder_chapter（八键必填）', taught: 'EIGHT non-empty strings' },
    ]
    const missing = interfaceGates.filter(g => !PAPER_CONSTITUTION.includes(g.taught))
    expect(missing.map(m => m.gate), '接口类门禁没有在宪法里说明——模型不看到就产不出合法容器').toEqual([])
  })

  it('每一条 knowledge 门禁的规则都在技能库里', () => {
    const knowledgeGates: ReadonlyArray<{ readonly gate: string; readonly taught: string }> = [
      { gate: 'prose_contract/analysis（逐问归因）', taught: '逐问一段' },
      { gate: '实质地板 analysis（软重写线）', taught: '退回重写' },
      { gate: 'prose_contract/evaluation（四要素）', taught: '优点' },
      { gate: 'prose_contract/references（≥3 且方法相关）', taught: '参考文献纪律' },
      { gate: 'prose_contract/code（点名哪几问）', taught: '点名函数与子问题的对应关系' },
      { gate: 'blank_area（空白/密度）', taught: '不留连续空行' },
      { gate: 'assumption_structure（引用 + justification）', taught: '假设的闭环' },
      { gate: 'numeric_consistency（正文↔产物）', taught: '只有两个合法来源' },
      { gate: 'config_consistency（校核 vs 交付配置）', taught: '同一套离散参数' },
      { gate: 'reference_validation', taught: '不许编造条目' },
    ]
    const missing = knowledgeGates.filter(g => !LIBRARY_TEXT.includes(g.taught))
    expect(missing.map(m => m.gate), '知识类门禁没有在技能库里——模型查不到就只能猜').toEqual([])
  })

  it('分流表里的每个门禁都有微教学（WARN 档注入的那一条）', () => {
    for (const activation of GATE_ACTIVATIONS) {
      expect(activation.microTeaching.length, `${activation.id} 的微教学过短`).toBeGreaterThan(20)
      // 微教学是**针对性**的：只讲这一条。它不该整段复制手册。
      expect(activation.microTeaching.length, `${activation.id} 的微教学太长，退化成手册了`).toBeLessThan(400)
    }
  })
})

describe('两条沿用下来的不变量', () => {
  it('教学里的篇幅数字与门禁的软重写线**同源**（round-8 抓到的漂移）', () => {
    // 数字现在单点取自 PAPER_LENGTH_REFERENCE，由 `knowledge/skills/*` 渲染。
    // 这条测试钉住"技能库里出现的每一个退回线都是参照值表里的那个数"。
    for (const key of ['analysis', 'evaluation', 'references', 'code', 'restatement'] as const) {
      const chapter = PAPER_LENGTH_REFERENCE.chapters[key]
      expect(chapter, `参照值表缺 ${key}`).toBeDefined()
      if (chapter === undefined) continue
      expect(
        LIBRARY_TEXT.includes(String(chapter.rewriteBelow)),
        `技能库没有写出 ${key} 的软重写线 ${String(chapter.rewriteBelow)}`,
      ).toBe(true)
      expect(
        LIBRARY_TEXT.includes(String(chapter.reference)),
        `技能库没有写出 ${key} 的参照篇幅 ${String(chapter.reference)}`,
      ).toBe(true)
    }
  })

  it('宪法保持紧凑——它一开始膨胀，就说明知识被塞回来了', () => {
    // 预算上限是**防回退**的机械形式：让"再加一条就超"变成一次显式取舍，
    // 而不是静默的膨胀。
    //
    // 关于上限为什么不是更小（诚实记账）：宪法里**主体是容器 schema**——
    // 每种 entry kind 的字段名、形状、取值域、什么被拒。那部分不可压缩，
    // 因为模型看不到就产不出可解析的容器。真正可压缩的是"知识"，而它已经
    // 全部外置到技能库（由上面那条"不含技能文档正文"的断言钉住）。
    // 因此这条上限防的是**知识回流**，不是要求把 schema 也搬走。
    const chars = PAPER_CONSTITUTION.length
    expect(chars, `宪法 ${String(chars)} 字符，超出上限——请把"怎么写更好"的内容移进技能库`).toBeLessThan(18_000)
    const lines = PAPER_CONSTITUTION.split('\n').length
    expect(lines, `宪法 ${String(lines)} 行，超出上限`).toBeLessThan(80)
  })

  it('**展开的论述不得抄进宪法**——短规则可以，长解释不行', () => {
    // 判据的修订（依据：对优秀参考实现的结构分析）：那份实现把**短且永远需要**的
    // 规则**嵌入**工作区指令文件（竞赛规则、输出格式、核心原则），把**长材料**指向
    // 文件（题面"按需读取"、规范"必读"）。所以"知识一律外置"是错的口号——
    // 正确的不变量是：**短规则可以复述，展开的论述不得抄进来**。
    //
    // 机械形式：宪法里不得出现任何技能文档的 **≥120 字符连续片段**。
    // 短语级重合（"退回重写"、"只有两个合法来源"）是允许的——那正是"短规则"。
    const WINDOW = 120
    const leaked: string[] = []
    for (const doc of SKILL_DOCS) {
      // 按段落切，逐段取窗口滑过，找与宪法重合的长片段。
      for (const para of doc.body.split(String.fromCharCode(10) + String.fromCharCode(10))) {
        const clean = para.replace(/\s+/g, ' ').trim()
        if (clean.length < WINDOW) continue
        for (let i = 0; i + WINDOW <= clean.length; i += 40) {
          const probe = clean.slice(i, i + WINDOW)
          if (PAPER_CONSTITUTION.replace(/\s+/g, ' ').includes(probe)) {
            leaked.push(`${doc.id}: 「${probe.slice(0, 60)}…」`)
            break
          }
        }
      }
    }
    expect(leaked, `这些长片段从技能库抄进了宪法：${leaked.join(' / ')}`).toEqual([])
  })

  it('每一份技能文档的**正文**都被某一步内联（没有孤儿知识）', () => {
    // 知识外置之后唯一的风险是"文档存在但没人把它送到模型面前"。判据不是
    // "文件名被提到"，而是**正文真的出现在某一步的简报里**。
    const delivered = BRIEFING_STEPS.map(step => stepBriefing(step, { target: 'T', upstream: 'U', done: 'D' }))
      .join(String.fromCharCode(10))
    const orphans = SKILL_DOCS.filter(doc => !delivered.includes(doc.body)).map(doc => doc.id)
    expect(orphans, `这些文档的正文没有进入任何一步：${orphans.join('、')}`).toEqual([])
  })

  it('宪法**不指示模型去读文件**——本管线没有工具，那是指示不动的事', () => {
    // 事故（本轮实测）：第一版宪法与简报都写"见 `skills/x.md`，读它"。而本管线的
    // 模型调用**没有工具**（`streamCompletion` 不发 tools，没有 tool 循环）。
    // 那是一条**模型无法遵守的指令**——判定侧写了，传递侧没写。
    //
    // 现在知识由**步骤简报内联**送达（`stepBriefing`），宪法只描述接口与铁律。
    // 判据要精确：只抓"**要求模型去读一份文件**"的形态，不抓"读一下拒绝信息"这类
    // 合法表述（那是读模型自己的输出），也不抓"不需要你去读文件"这种否定句。
    const readInstructions = [
      ...PAPER_CONSTITUTION.matchAll(/read_file\(|read (?:the|this) (?:document|file|doc)|去读 `skills\//g),
    ].map(m => m[0])
    expect(readInstructions, `宪法里仍有"去读文件"的指示：${readInstructions.join('、')}`).toEqual([])
  })

  it('宪法里若提到 `skills/`，只能作为"来源标签"，不能是"去读"的指令', () => {
    const mentions = [...PAPER_CONSTITUTION.matchAll(/skills\/([a-z-]+)\.md/g)].map(m => m[1])
    for (const id of mentions) {
      expect(SKILL_DOCS.some(d => d.id === id), `宪法提到不存在的文档 ${String(id)}`).toBe(true)
    }
    // 现行形态下宪法**不该**再提任何 skills/ 路径（知识全部改由简报内联）。
    expect(mentions).toEqual([])
  })


  it('产出步的简报指名的正是"写结论前必看"的那几份', () => {
    const briefing = stepBriefing('produce', { target: 'T', upstream: 'U', done: 'D' })
    for (const id of ['evidence-and-numbers', 'paper-contract', 'writing-norms', 'symbolic-verification']) {
      expect(briefing).toContain(`${id}.md`)
    }
  })

  it('总索引仍存在（供模型主动探索），但它不再承担"按需加载"的主要投递', () => {
    const index = skillIndexBlock()
    expect(SKILL_DOCS.length).toBeGreaterThan(4)
    for (const doc of SKILL_DOCS) expect(index).toContain(`${doc.id}.md`)
    expect(index).toContain('read_file')
    // 它必须把模型指向"这一步必读的那几份"，而不是让它在目录里自己挑。
    expect(index).toContain('THIS step')
  })
})

describe('W12-A1j — 图注里的中文序数（strict-13 实测的头号阻断）', () => {
  it('宪法点名"问题2"这类中文序数也是数字字面量', () => {
    // strict-13 的 7 次拒绝里有 **4 次**是同一条：
    //   figure caption/axis label contains numeric literal '2' that is not a
    //   referenced Result value
    // 每次的游离字面量都是 `2`——模型写的是"问题2 / 情形2 / 图2"。
    //
    // 规则**早就在宪法里**（"must NOT contain numeric literals"），但那条措辞
    // 对中文写作者不起作用：没人会把"问题2"里的 2 读成"数字字面量"。
    // 所以这一条修的不是规则，是**措辞**——把陷阱点名，并给出合法改写。
    // （这正是 W8.11-A1 的教训："只加禁令不加理由，模型会换一种方式违反"。）
    expect(PAPER_CONSTITUTION).toContain('CHINESE ORDINALS ARE THE TRAP')
    expect(PAPER_CONSTITUTION).toContain('问题2')
    // 合法的改写方式必须在（否则模型只知道"不能写"，不知道"能写什么"）
    expect(PAPER_CONSTITUTION).toContain('问题二')
  })

  it('这条教学没有把数字禁令放宽——禁令原文仍在', () => {
    // 方向性守卫：这一轮加的是**措辞**，不是放松判据。原禁令必须逐字保留，
    // 否则就等于为了通过而削弱检查（那正是本架构要防的形态）。
    expect(PAPER_CONSTITUTION).toContain('must NOT contain numeric literals')
    expect(PAPER_CONSTITUTION).toContain('refused unless it is exactly the value of a referenced Result')
  })
})
