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
  skillTaskOf,
  stageBriefing,
} from '../../src/stages/briefing.ts'
import { STAGES, stageOf } from '../../src/stages/registry.ts'

const empty = new Map<string, string>()

/**
 * **分片调用的阶段**：阶段 2（建模，2a/2b）、阶段 3（代码，逐问）、阶段 5（作图，规划 + 逐图）。
 *
 * 它们的回答形态由**每段的「本次调用」指示**决定，简报里只说明"本阶段分片"。
 * 简报若写死"发 `{"files": {...}}` 信封"，会和分片 prompt 的"只产出这一个文件"打架——
 * 实测两段都因此出过问题（脚本被写成 JSON、规划被包成信封导致解析不到 `figures`）。
 * 所以下面所有"简报形态 = answerFormOf"的断言都跳过它们。
 */
const SHARDED = new Set(['modeling', 'code', 'figure-declare'])
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
      // **分片阶段例外**：它们的形态由每段的「本次调用」指示决定，简报里只说明这件事。
      if (SHARDED.has(s.id)) {
        expect(text).toContain('分片调用')
        continue
      }
      expect(text).toContain(answerFormOf(s))
    }
  })

  it('多产出阶段点名**每一个**文件名，单产出阶段点名那一个文件', () => {
    // 分片阶段（阶段 2/3/5）的回答形态由每段指示决定 —— 简报改为说明这一点。
    const modeling = brief('modeling')
    expect(modeling).toContain('分片调用')
    for (const f of ['DECLARATION.json', 'MODELING_REPORT.md']) expect(modeling).toContain(f)
    // 信封那句话**不该**出现在分片阶段的简报里（它与分片 prompt 打架）
    expect(modeling).not.toContain('{"files"')
    const paper = brief('paper')
    expect(paper).toContain('paper/main.md')
    expect(paper).not.toContain('{"files"')
  })

  it('多产出阶段明说"除这一个 JSON 对象外不得有任何其它字符"', () => {
    // `code` 已改成分片阶段（形态由每段指示决定）→ 换一个非分片的多产出阶段来核
    expect(brief('prob-analysis')).toContain('不得有任何其它字符')
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

/**
 * `modeling_coverage` 要在简报里**有对应的硬性要求**——否则就是一条无法被遵守的指令
 * （round-5 的原缺陷：门禁量一个简报从没要求过的东西）。
 */
describe('阶段 2 简报 —— 能力项逐条认领是硬性要求', () => {
  it('点名 `C-*` id 要逐字出现在 checklist_refs 里，且说明换个说法不算', () => {
    const brief = stageBriefing(stageOf('modeling'), new Map(), false)
    expect(brief).toContain('modeling_coverage')
    expect(brief).toContain('checklist_refs')
    expect(brief).toContain('逐字出现')
    expect(brief).toContain('不算认领')
  })
})

/**
 * 阶段 3 的契约文本必须与 13 阶段流水线一致。
 *
 * 原文本是 11 阶段时代的写法（"并**声明**图……你写 chart_type/data_refs/caption"、
 * "渲染是阶段 4 的事"）。拆分后：数源声明=阶段 4、图表声明=阶段 5、渲染=阶段 6/7。
 * 契约没跟着改，后果是实测的：**审计员照任务陈述判"缺图表声明"并记进 missing**，
 * 而阶段 3 的产出契约里根本没有图表声明，执行者也做不到（它不跑代码、不渲染）。
 * 契约与流水线不一致，审计就会判一个执行者做不到的要求。
 */
describe('阶段 3 契约 —— 与 13 阶段流水线一致', () => {
  const spec = stageOf('code')
  const brief = stageBriefing(spec, new Map(), false)
  const task = skillTaskOf(spec)

  it('任务陈述不再要求"声明图"，并说清各阶段归属', () => {
    expect(task).not.toContain('chart_type/data_refs/caption')
    expect(task).toContain('本阶段只写代码')
    expect(task).toContain('阶段 4')
    expect(task).toContain('阶段 5')
  })

  it('产出契约里确实没有图表声明（契约与任务陈述自洽）', () => {
    const files = spec.produces.map(p => p.file)
    expect(files).not.toContain('FIGURE_DECLARATIONS.json')
    expect(brief).not.toContain('`chart_type/data_refs/caption` 形式的图表声明')
  })

  it('"不得写图表声明"进了 forbidden（把边界写死，而不是留白）', () => {
    expect(brief).toContain('不得**写图表声明')
  })

  it('**逐条参数去公式里找它**写进了 how 与 selfCheck（死参数防线）', () => {
    expect(brief).toContain('逐条参数去目标函数里找它')
    expect(brief).toContain('参数表里写着、公式里不用')
  })
})

/**
 * 成本核算的**逐轮现金流守恒**要写进阶段 2 契约。
 *
 * 审计连续两轮抓到同一族的 fatal：① 检测出的不合格零配件要丢弃，所以得到 1 件
 * 可用零配件要买 `1/(1−p_i)` 件（只记 1 件采购价 = 默认"一买一检必得可用件"，
 * 系统性低估检测成本、高估检测收益）；② 回收件的"免采购"收益被记两次
 * （递推分支里记了，利润式里又按退回件数抵扣一次）。
 * 两者都会让"什么都不做/不检测"虚假胜出——正是红队最初那个缺陷的同一族。
 *
 * 这类错靠"再生成一次"是掷骰子，所以把自检方式写进契约：解析式必须与逐轮现金流复算对齐。
 */
describe('阶段 2 简报 —— 成本核算的现金流守恒', () => {
  const brief = stageBriefing(stageOf('modeling'), new Map(), false)

  it('点名"逐轮现金流守恒"这个自检方式', () => {
    expect(brief).toContain('逐轮现金流守恒')
    expect(brief).toContain('逐轮现金流复算')
  })

  it('两个具体的坑都要点名（丢弃件采购损耗 / 回收件抵扣不重复）', () => {
    // 措辞已**去题目化**（原为"零配件"等题面名词，换题后那段就从"规范"变成"噪声"）：
    // 判据保留，名词换成题目无关的说法。
    expect(brief).toContain('1/(1−p)')
    expect(brief).toContain('一买一检必得可用件')
    expect(brief).toContain('只能记一次')
  })

  it('说清后果（否则模型不知道为什么要守这条）', () => {
    expect(brief).toContain('虚假胜出')
  })
})

/**
 * 编外登记簿必须**在简报里教给模型**——否则模型不知道这条通道存在，
 * 就会继续把示意数直接写进散文（那才是"凭空出现"）。
 */
describe('阶段 2 简报 —— 编外登记簿这条通道', () => {
  const brief = stageBriefing(stageOf('modeling'), new Map(), false)

  it('点名 `illustrative_numbers`，并给出可直接照抄的条目形态', () => {
    expect(brief).toContain('illustrative_numbers')
    expect(brief).toContain('编外登记簿')
    expect(brief).toContain('"quote"')
    expect(brief).toContain('"reason"')
  })

  it('说清"编外不是豁免，是换一种记账"与缺项后果', () => {
    expect(brief).toContain('编外不是豁免，是换一种记账')
    expect(brief).toContain('凭空出现')
  })

  it('**堵住"把结果塞进编外"这条路**（否则零数字通道被绕过）', () => {
    expect(brief).toContain('把计算结果塞进编外')
    expect(brief).toContain('绕过零数字通道')
  })
})

/**
 * **简报教的形态 = 解析器要的形态**，对**每一个阶段**都成立。
 *
 * 原来这条纪律只有一个笼统的测试，没覆盖"有 harness 铸出产物"的阶段。实测代价
 * （第十六处缺陷）：阶段 4 声明两份产出（`RESULT_SOURCES.json` + harness 铸的 `results.json`），
 * `answerFormOf` 按 `spec.produces.length === 1` 判 → 教模型"发 JSON 信封、键恰好是这两个"，
 * 而 `parseStageOutput` 排除 harness 铸的之后只有 1 份 → 按**原文**取。
 * 于是模型**照契约**发了信封，runner 把整个信封当成 `RESULT_SOURCES.json` 的内容，
 * 报"缺 sources 数组"——模型没错，是 harness 自相矛盾。
 *
 * 所以判据要**遍历阶段表**，两边口径逐个对齐；靠人记得某处特例是防不住的。
 */
describe('回答形态 —— 简报与解析器逐个阶段对齐（防自相矛盾）', () => {
  it('**每个模型阶段**：`answerFormOf` 说的形态 = `parseStageOutput` 的期望', () => {
    for (const spec of STAGES) {
      if (spec.kind !== 'model') continue
      if (SHARDED.has(spec.id)) continue
      const owned = spec.produces.filter(p => p.harnessMinted !== true)
      const form = answerFormOf(spec)
      if (owned.length === 1) {
        // 原文形态：必须点名那一个文件，且**不得**教它发信封
        expect(form, `${spec.id} 应是原文形态`).toContain(`\`${owned[0]!.file}\` 的完整内容本身`)
        expect(form, `${spec.id} 不该教信封`).not.toContain('{"files"')
      } else {
        // 信封形态：键**恰好**是模型自己拥有的那几份（不含 harness 铸的）
        expect(form, `${spec.id} 应是信封形态`).toContain('{"files"')
        for (const p of owned) {
          if (p.kind === 'dir') continue
          expect(form, `${spec.id} 的信封键漏了 ${p.file}`).toContain(`\`${p.file}\``)
        }
        for (const p of spec.produces.filter(p => p.harnessMinted === true)) {
          expect(form, `${spec.id} 不该把 harness 铸的 ${p.file} 当成交付键`).not.toContain(`\`${p.file}\``)
        }
      }
    }
  })

  it('**阶段 4 是这条纪律的活样本**（harness 铸的产物不进回答）', () => {
    const spec = stageOf('result-sources')
    expect(spec.produces.filter(p => p.harnessMinted === true).map(p => p.file)).toEqual(['results.json'])
    const form = answerFormOf(spec)
    expect(form).toContain('`RESULT_SOURCES.json` 的完整内容本身')
    expect(form).toContain('不要**出现在你的回答里')
  })
})

/**
 * 阶段 5 的简报必须把**新图型与决策表**教给模型。
 *
 * 没有这一段，渲染器扩容就是白做——模型只会继续声明 `line`/`bar`，
 * 而参考的硬合同是"规划写了什么图型就必须画出那个图型"。
 */
/**
 * 阶段 5 简报必须把**"写脚本"这条路**教给模型。
 *
 * 约束换成"模型写 `gen_fig_*.py`"之后，简报要讲清四件事：
 * ① 一图一脚本、产物在哪；② **必须先取配方再写、不要从零写**（参考原话：
 * *"Do NOT write figure scripts from scratch"*）；③ 数据**只能从铸出的账本读**；
 * ④ 门禁会逐条审什么（整图标题/被禁色板/硬编码色/图型对账/figsize 档位）。
 */
describe('阶段 5 简报 —— 写脚本这条路', () => {
  const brief = stageBriefing(stageOf('figure-declare'), new Map(), false)

  it('点名产物形态：一图一脚本 + 规划文件', () => {
    expect(brief).toContain('gen_fig_')
    expect(brief).toContain('FIGURE_PLAN.json')
    expect(brief).toContain('一图一脚本')
  })

  it('**必须先取配方、不要从零写**（参考点名的塌方）', () => {
    expect(brief).toContain('get_recipe.py')
    expect(brief).toContain('不要从零写')
    expect(brief).toContain('figure_recipes_')
  })

  it('数据**只能从铸出的账本读**（约束换了、溯源没丢）', () => {
    expect(brief).toContain('results.json')
    expect(brief).toContain('不得硬编码')
    expect(brief).toContain('figure_script_traced')
  })

  it('把门禁会审的项逐条列出（否则模型只能猜）', () => {
    for (const k of ['figure_script_quality', 'figure_type_match', 'figure_size_buckets', 'figure_diversity']) {
      expect(brief, `简报里没提 ${k}`).toContain(k)
    }
    expect(brief).toContain('plt.title')
    expect(brief).toContain('PALETTE')
    expect(brief).toContain('setup_style')
  })

  it('图型决策表的几条"明确否掉"要写进去', () => {
    expect(brief).toContain('tornado')
    expect(brief).toContain('waterfall')
    expect(brief).toContain('heatmap')
  })
})

