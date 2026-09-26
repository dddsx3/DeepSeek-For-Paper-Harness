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
import { METHODOLOGY_ASSETS, methodologyAsset } from '../../src/stages/assets.ts'

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
