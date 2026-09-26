/**
 * **稳定迁移** —— 用户口径：*"后续不能只跑一种类型的题目，如果无法保证稳定迁移就不能算成功。"*
 *
 * 这条要求必须**可核**，否则只是口号。判据落在三件与题无关的事上：
 *
 * 1. **契约里不许有题目词汇**。简报是模型看到的全部；一旦把某道题的名词（"零配件"、
 *    "次品率"、"药材"…）写进契约，换一道题时那段话就从"规范"变成"噪声"——
 *    这是迁移性被破坏最常见的形态（也是我上一轮最容易犯的）。
 * 2. **骨架七步不能缺**。换题后仍要走"规划 → 取配方 → 写脚本 → 机械门禁 → 溯源门禁
 *    → 执行 → 对账质检"，尤其"取配方"与"从账本读"这两步——它们是质量的来源。
 * 3. **四条稳定性硬规则要在契约里**（共用模块 / 多面板 / 不过度收缩 / 从账本读）。
 *    这四条是我最初漏掉的，而它们正是参考实战总结出来的跨题经验。
 *
 * 方法论本体在 `assets/methodology/FIGURE-METHOD.md`（原样迁自参考）。
 */
import { describe, expect, it } from 'vitest'
import { stageBriefing } from '../../src/stages/briefing.ts'
import { stageOf } from '../../src/stages/registry.ts'
import { METHODOLOGY_ASSETS, STAGE_TOOLS, methodologyAsset, stageAsset } from '../../src/stages/assets.ts'

describe('稳定迁移 —— 契约里不许有题目词汇', () => {
  const brief = stageBriefing(stageOf('figure-declare'), new Map(), false)
  // 我实际跑过的两道题的专有名词（2024B 与参考工作区的 CUMCM 药材干燥）。
  // 这条清单**只增不改**：每引入一道新题，把它暴露出来的词汇加进来。
  const PROBLEM_NOUNS = [
    '2024B', '2023B', '国赛', '美赛',
    '零配件', '次品率', '调换损失', '拆解费用', '装配成本',
    '药材', '干燥', '含水量', '传质',
  ]

  it('阶段 5 简报（模型看到的全部）不含任何题目名词', () => {
    const hits = PROBLEM_NOUNS.filter(n => brief.includes(n))
    expect(hits, `契约里出现了题目词汇：${hits.join('、')}——换一道题时这段就从"规范"变成"噪声"`).toEqual([])
  })

  it('简报**必须**是"骨架"：讲清规划、取配方、从账本读、门禁，而不讲某道题怎么做', () => {
    for (const skeleton of ['FIGURE_PLAN.json', 'get_recipe.py', 'results.json', 'setup_style']) {
      expect(brief, `骨架缺了 ${skeleton}`).toContain(skeleton)
    }
  })
})

describe('稳定迁移 —— 四条硬规则必须在契约里（我最初漏掉的那四条）', () => {
  const brief = stageBriefing(stageOf('figure-declare'), new Map(), false)

  it('① 图 >5 张要建共用引导模块（参考：高分图集的共同做法）', () => {
    expect(brief).toContain('_figbase')
    expect(brief).toContain('口径')
  })

  it('② 多面板合成在单个图内实现、panel ≤ 4', () => {
    expect(brief).toContain('多面板')
    expect(brief).toContain('panel 数量 ≤ 4')
    expect(brief).toContain('(a)')
  })

  it('③ **不要过度收缩**：判据线/极值标注/置信带这些信息性元素该有就有', () => {
    expect(brief).toContain('不要过度收缩')
    expect(brief).toContain('信息性元素')
  })

  it('④ 数据只能从铸出的账本读（溯源在脚本方案下的机制）', () => {
    expect(brief).toContain('不得硬编码')
    expect(brief).toContain('figure_script_traced')
  })
})

describe('方法论资产 —— 题型无关的那一层已固化', () => {
  it('骨架文档在，且写明七步与跨题验收', () => {
    const doc = methodologyAsset('FIGURE-METHOD.md')
    expect(doc).toContain('不变骨架')
    expect(doc).toContain('题型无关')
    expect(doc).toContain('稳定迁移')
    // 七步里的关键三步
    for (const step of ['规划图集', '取配方', '写脚本']) expect(doc).toContain(step)
  })

  it('按题型索引的防错手册在（这正是"换题"时要查的东西）', () => {
    const doc = methodologyAsset('error-prevention-by-problem-type.md')
    expect(doc.length).toBeGreaterThan(50_000)
    expect(doc).toContain('题型')
  })

  it('每份方法论资产都读得到、非空（清单与实际一致）', () => {
    expect(METHODOLOGY_ASSETS.length).toBeGreaterThanOrEqual(9)
    for (const a of METHODOLOGY_ASSETS) {
      expect(methodologyAsset(a.file).length, `${a.file} 是空的`).toBeGreaterThan(1000)
    }
  })
})

/**
 * **跨阶段**的稳定迁移 —— 用户口径的延伸：*"看一下是否还有可以继续固化与迁移的，
 * 比如建模阶段，比如问题求解或者逻辑复合对抗阶段真正有价值的资产能否固化下来。"*
 *
 * 参考实现在每个阶段都带一整套"**题型无关的机械闸 + 结构化契约**"。它们的格式固定、
 * 内容按题填——**这正是跨题稳定的机制**：换题只改输入，不改规范。
 * 这一组把"契约真的进了简报"钉住，否则迁进来的资产只是躺在磁盘上。
 */
describe('跨阶段固化 —— 四个题型无关的结构化契约（阶段 2）', () => {
  const brief = stageBriefing(stageOf('modeling'), new Map(), false)

  it('① `METHOD_CLAIMS_MACHINE`（正文声称的方法必须有机器签名）', () => {
    expect(brief).toContain('METHOD_CLAIMS_MACHINE')
    expect(brief).toContain('must')
    expect(brief).toContain('forbid')
    expect(brief).toContain('claim_code_check')
  })

  it('② `LOGIC_CONTRACT_MACHINE` 八键齐备', () => {
    expect(brief).toContain('LOGIC_CONTRACT_MACHINE')
    for (const k of ['bounds', 'no_double_count', 'must_features', 'train_range',
      'monotonic', 'constraints_with_margin', 'calibration_anchors', 'equivalence_claims']) {
      expect(brief, `八键缺了 ${k}`).toContain(k)
    }
  })

  it('③ `CROSS_PROBLEM_LEDGER`（唯一负责跨问对撞的环节）', () => {
    expect(brief).toContain('CROSS_PROBLEM_LEDGER')
    expect(brief).toContain('must_le')
    expect(brief).toContain('跨问对撞')
  })

  it('④ 方向推导四步 + 探针（不许拍脑袋定方向）', () => {
    expect(brief).toContain('方向推导四步')
    expect(brief).toContain('logic_probes')
  })

  it('把编码阶段的自由度压到零 + 按题型查手册', () => {
    expect(brief).toContain('不得自行选择')
    expect(brief).toContain('error_prevention.md')
    expect(brief).toContain('按题型')
  })

  it('**阶段 2 的契约里也没有题目词汇**', () => {
    const nouns = ['2024B', '国赛', '零配件', '次品率', '调换损失', '药材', '干燥', '传质']
    const hits = nouns.filter(n => brief.includes(n))
    expect(hits, `建模阶段契约里出现了题目词汇：${hits.join('、')}`).toEqual([])
  })
})

describe('跨阶段固化 —— 复核阶段的六类缺口与诚实边界（阶段 8）', () => {
  const brief = stageBriefing(stageOf('review'), new Map(), false)

  it('六类缺口：前五类 + **任务理解 vs 题目原文**（唯一的独立防线）', () => {
    expect(brief).toContain('bound_direction')
    expect(brief).toContain('double_count')
    expect(brief).toContain('extrapolation')
    expect(brief).toContain('missing_feature')
    expect(brief).toContain('cross_problem')
    expect(brief).toContain('task_misread')
    expect(brief).toContain('唯一的独立防线')
  })

  it('任务读歪 = fatal（回炉重来）', () => {
    expect(brief).toContain('任务读歪')
    expect(brief).toContain('fatal')
  })

  it('**不许问自己"我实现了吗"**（会诱导自证）', () => {
    expect(brief).toContain('我实现了吗')
    expect(brief).toContain('自证')
  })

  it('诚实边界：与答题同源、有共同盲区、非万无一失', () => {
    expect(brief).toContain('同源')
    expect(brief).toContain('共同盲区')
    expect(brief).toContain('非万无一失')
  })
})

describe('跨阶段固化 —— 阶段工具与按题型资料已就位', () => {
  it('各阶段的机械闸都能读得到（清单与实际一致）', () => {
    expect(STAGE_TOOLS.length).toBeGreaterThanOrEqual(17)
    for (const t of STAGE_TOOLS) {
      expect(stageAsset(t.file).length, `${t.file} 是空的`).toBeGreaterThan(500)
    }
  })

  it('按题型资料都在（这些是"查表"资产，不是写进契约的规则）', () => {
    for (const rel of [
      'modeling/SKILL.md', 'modeling/methods_table.md',
      'code/SKILL.md', 'code/error_prevention_code.md',
      'code/checks/optimization.md', 'code/checks/prediction.md', 'code/checks/evaluation.md',
      'code/checks/physical.md', 'code/checks/consistency.md', 'code/checks/sanity_check.md',
      'review/SKILL.md',
    ]) {
      expect(stageAsset(rel).length, `${rel} 读不到或为空`).toBeGreaterThan(300)
    }
  })

  it('`logic_audit` 的七查与"有效解释只认非空字符串"都在源码里', () => {
    const src = stageAsset('logic_audit.py')
    for (const fn of ['audit_extrapolation', 'audit_feature_completeness', 'audit_double_count',
      'audit_direction', 'audit_margin', 'audit_self_consistency', 'audit_anchor']) {
      expect(src, `七查缺了 ${fn}`).toContain(fn)
    }
  })
})

/**
 * 阶段 1 与阶段 3 的契约（补全"所有阶段可学内容"的最后一环）。
 *
 * 阶段 1 的 `DATA_FACTS.json` 是**数据台账**：`role` 三分（observed/setpoint/assumed）
 * 与 `given[]` 的"一字不改"铁律——实测最常见的错法是"把作用在系数上的幂律当成作用在力上"。
 * 阶段 3 的硬规则是参考反复强调的几条：参数从契约取、遵守方法签名、Excel 显式读全表、
 * 长求解前台同步等、本阶段不画图。
 */
describe('跨阶段固化 —— 阶段 1 的数据台账契约', () => {
  const brief = stageBriefing(stageOf('prob-analysis'), new Map(), false)

  it('`DATA_FACTS.json` 与 `role` 三分语义都在', () => {
    expect(brief).toContain('DATA_FACTS.json')
    for (const r of ['observed', 'setpoint', 'assumed']) expect(brief).toContain(r)
  })

  it('`given[]` 的"一字不改"铁律（含 `acts_on` 作用对象不许挪位）', () => {
    expect(brief).toContain('acts_on')
    expect(brief).toContain('教科书标准形')
  })

  it('参数 ≥ 20 时另建 `PROBLEM_FACTS.json`（带 source 与 raw_quote）', () => {
    expect(brief).toContain('PROBLEM_FACTS.json')
    expect(brief).toContain('raw_quote')
  })
})

describe('跨阶段固化 —— 阶段 3 的硬规则', () => {
  const brief = stageBriefing(stageOf('code'), new Map(), false)

  it('参数从契约取（`params.py`），不许裸数字', () => {
    expect(brief).toContain('params.py')
    expect(brief).toContain('裸数字')
    expect(brief).toContain('facts_audit')
  })

  it('遵守阶段 2 给的方法签名（`claim_code_check`）', () => {
    expect(brief).toContain('METHOD_CLAIMS_MACHINE')
    expect(brief).toContain('claim_code_check')
  })

  it('Excel 必须显式读全表 + 前台同步等（不许后台跑完就退出）', () => {
    expect(brief).toContain('sheet_name=None')
    expect(brief).toContain('前台同步')
  })

  it('本阶段不画图', () => {
    expect(brief).toContain('不画图')
    expect(brief).toContain('savefig')
  })
})
