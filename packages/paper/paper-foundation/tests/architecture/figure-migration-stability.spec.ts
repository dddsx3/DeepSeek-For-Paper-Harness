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
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stageBriefing } from '../../src/stages/briefing.ts'
import { STAGES, stageOf } from '../../src/stages/registry.ts'
import { METHODOLOGY_ASSETS, PLOTTING_ASSETS, PLOTTING_ASSETS_DIR, STAGE_TOOLS, methodologyAsset, stageAsset } from '../../src/stages/assets.ts'

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

  it('① 共用引导模块由 **harness 铺好**（不是让模型自己建——实测那样会各写各的）', () => {
    expect(brief).toContain('_figbase')
    expect(brief).toContain('口径')
    // 语义变了：参考写的是"图多于 5 张时**先建**一个"（建议），
    // 实测 11 张图只有 1 份真用了它 → 改成铺好的资产 + "不要自己另写"。
    expect(brief, '必须写明模块是铺好的，不是让模型自己写').toContain('铺好')
    expect(brief).toContain('不要自己另写')
    // 资产清单里真的有这个文件（否则契约承诺了、环境里没有 = 又一类"教了但不给"）
    const asset = PLOTTING_ASSETS.find(a => a.file === '_figbase.py')
    expect(asset, 'PLOTTING_ASSETS 里必须有 _figbase.py').toBeDefined()
    expect(asset?.role).toContain('铺好')
  })

  it('①b 色板形状写对了（`COLORS` 是 dict 不是 list——猜错每份脚本都崩）', () => {
    // 实测：`COLORS[0]` → KeyError: 0。契约必须教**真实形状**。
    expect(brief).toContain('COLORS["primary"]')
    expect(brief).toContain('语义字典')
    expect(brief).toContain('PALETTE[0]')
  })

  it('② 多面板合成是硬要求、panel ≤ 4，且写明门禁会数', () => {
    expect(brief).toContain('多面板')
    expect(brief).toContain('panel 数量 ≤ 4')
    expect(brief).toContain('(a)')
    // 上一轮 11/11 全是单 panel —— 因为"写了但没人数"。现在门禁会数。
    expect(brief).toContain('figure_script_quality')
    expect(brief).toContain('平庸图的典型特征就是每张都单 panel')
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

/**
 * **两条图集层面的判据真的会拦人** —— 用上一轮 11 份真实脚本的形态做夹具。
 *
 * 为什么必须测"会拦"：这两条契约（共用引导模块、多面板）**上一轮就写在简报里了**，
 * 结果 11 张图全是单 panel、只有 1 份用了 `_figbase`。写了不等于会发生——
 * 没有东西去数它，它就只是建议。这里钉住"数它的那个东西"。
 */
describe('图集层面的两条判据（`figure_script_quality`）', () => {
  /** 造一份脚本：`style` 决定它像不像上一轮那批（单 panel、无 _figbase）。 */
  const script = (opts: { base: boolean; panels: number }): string => {
    const head = opts.base
      ? 'from _figbase import load, save, panel, PALETTE\n'
      : 'import json\nimport matplotlib.pyplot as plt\nfrom _utils.plot_utils import setup_style, save_fig\nsetup_style()\n'
    const body = opts.panels >= 2
      ? `fig, axes = plt.subplots(1, ${String(opts.panels)}, figsize=(6.0, 2.8))\n`
      : 'fig, ax = plt.subplots(figsize=(6.0, 3.6))\n'
    const tail = opts.base ? 'save(fig, "fig_x")\n' : 'save_fig(fig, "figures/fig_x.png")\n'
    return head + body + tail
  }

  /** 造一个阶段 5 的 GateInput（只放脚本，判据不需要别的）。 */
  const inputOf = (codes: ReadonlyArray<string>) => ({
    files: new Map(codes.map((c, i) => [`figures/gen_fig_f${String(i)}.py`, c])),
    upstream: new Map<string, string>(),
    problemCount: 4,
  })

  it('11 份脚本全是单 panel 且不用 _figbase → 判失败（就是上一轮的形态）', async () => {
    const { figureScriptQuality } = await import('../../src/stages/figure-script-gates.ts')
    const v = figureScriptQuality(inputOf(Array.from({ length: 11 }, () => script({ base: false, panels: 1 }))))
    expect(v.code).toBe(1)
    const detail = v.items.map(i => i.detail).join(' ')
    expect(detail).toContain('_figbase')
    expect(detail).toContain('单 panel')
  })

  it('用 _figbase 且 ≥1/3 多面板 → 通过', async () => {
    const { figureScriptQuality } = await import('../../src/stages/figure-script-gates.ts')
    const codes = [
      ...Array.from({ length: 4 }, () => script({ base: true, panels: 2 })),
      ...Array.from({ length: 7 }, () => script({ base: true, panels: 1 })),
    ]
    const v = figureScriptQuality(inputOf(codes))
    expect(v.code, v.items.map(i => i.detail).join(' ')).toBe(0)
  })

  it('脚本 ≤5 份时不数这两条（参考的门槛就是"多于 5 张"）', async () => {
    const { figureScriptQuality } = await import('../../src/stages/figure-script-gates.ts')
    const v = figureScriptQuality(inputOf(Array.from({ length: 5 }, () => script({ base: false, panels: 1 }))))
    expect(v.code).toBe(0)
  })

  it('`_figbase` 顶替 `setup_style` 与 `save_fig`（导入即生效，不误杀规范脚本）', async () => {
    const { figureScriptQuality } = await import('../../src/stages/figure-script-gates.ts')
    // 只 `from _figbase import ...` 的脚本里，`setup_style`/`save_fig` 字样**不出现**——
    // 旧判据会误杀它，而它恰恰是最规范的那一类。
    const code = 'from _figbase import load, save\nfig, ax = plt.subplots()\nsave(fig, "fig_a")\n'
    expect(code).not.toContain('setup_style')
    expect(code).not.toContain('save_fig')
    const v = figureScriptQuality(inputOf([code]))
    expect(v.code, v.items.map(i => i.detail).join(' ')).toBe(0)
  })

  it('`np.save(` 不算落盘（负向后行断言：别把数组存盘当出图）', async () => {
    const { figureScriptQuality } = await import('../../src/stages/figure-script-gates.ts')
    const code = 'from _figbase import load, PALETTE\nimport numpy as np\nnp.save("x.npy", np.zeros(3))\n'
    const v = figureScriptQuality(inputOf([code]))
    expect(v.code).toBe(1)
    expect(v.items.map(i => i.detail).join(' ')).toContain('不落盘')
  })
})

/**
 * **`figure_script_traced` 不误杀结构性参数** —— 用真实闯祸的那一行核。
 *
 * 实测（本轮阶段 5）：`ax.contourf(NN, KK, accept, levels=[-0.5, 0.5, 1.5], cmap=CMAP2)`
 * 被判"绘图调用里出现成串的硬编码数据"。但 `levels` 是 0/1 指示场的**分级边界**，
 * 是版面不是数据——一份合规脚本被拦下，代价是整个阶段重跑（十几次模型调用）。
 * 参考自己的 CRITICAL 清单也只查数据、不查分级/范围/样式参数。
 */
describe('`figure_script_traced` 的边界（只抓数据，不抓版面）', () => {
  const LEDGER = JSON.stringify({ results: [
    { result_id: 'R-A', name: 'a', value: 12.5, unit: '件' },
    { result_id: 'R-B', name: 'b', value: 3.25, unit: '件' },
    { result_id: 'R-C', name: 'c', value: 7.75, unit: '件' },
  ] })
  const inputOf = (code: string) => ({
    files: new Map([['figures/gen_fig_f1.py', code]]),
    upstream: new Map([['results.json', LEDGER]]),
    problemCount: 1,
  })

  it('`contourf(levels=[-0.5, 0.5, 1.5])` **不算**硬编码数据（真实误判）', async () => {
    const { figureScriptTraced } = await import('../../src/stages/figure-script-gates.ts')
    const code = 'from _figbase import load, PALETTE\nimport matplotlib.pyplot as plt\n'
      + 'doc = load("results.json")\n'
      + 'fig, ax = plt.subplots()\n'
      + 'ax.contourf(NN, KK, accept, levels=[-0.5, 0.5, 1.5], cmap=CMAP2)\n'
      + 'save(fig, "fig_a")\n'
    const v = figureScriptTraced(inputOf(code))
    expect(v.code, v.items.map(i => i.detail).join(' ')).toBe(0)
  })

  it('其它结构性关键字同样放行（`bins` / `vmin` / `set_xticks`）', async () => {
    const { figureScriptTraced } = await import('../../src/stages/figure-script-gates.ts')
    const code = 'from _figbase import load\n'
      + 'doc = load("results.json")\n'
      + 'ax.hist(vals, bins=[0.5, 1.5, 2.5, 3.5])\n'
      + 'ax.imshow(M, vmin=-0.5, vmax=1.5)\n'
      + 'ax.set_xticks([0.6, 0.7, 0.8, 0.9])\n'
    const v = figureScriptTraced(inputOf(code))
    expect(v.code, v.items.map(i => i.detail).join(' ')).toBe(0)
  })

  it('**真的硬编码数据仍然拦**（`plot([0,5,10],[1.2,3.4,5.6])` 是参考点名的形态）', async () => {
    const { figureScriptTraced } = await import('../../src/stages/figure-script-gates.ts')
    const code = 'from _figbase import load\n'
      + 'doc = load("results.json")\n'
      + 'ax.plot([0, 5, 10], [1.2, 3.4, 5.6])\n'
    const v = figureScriptTraced(inputOf(code))
    expect(v.code).toBe(1)
    expect(v.items.map(i => i.detail).join(' ')).toContain('硬编码数据')
  })

  it('账本里真有这些数就不拦（判据是"不在账本里"，不是"带小数点"）', async () => {
    const { figureScriptTraced } = await import('../../src/stages/figure-script-gates.ts')
    // 12.5 / 3.25 / 7.75 都在账本里 —— 数值对得上就不该被判硬编码。
    // 第二个列表用**整数**刻度：`[1.0, 2.0, 3.0]` 自己就是"不在账本里的小数串"，
    // 会被正确拦下（第一版夹具就栽在这——判据没问题，是夹具造错了）。
    const code = 'from _figbase import load\n'
      + 'doc = load("results.json")\n'
      + 'ax.plot([12.5, 3.25, 7.75], [0, 5, 10])\n'
    const v = figureScriptTraced(inputOf(code))
    expect(v.code, v.items.map(i => i.detail).join(' ')).toBe(0)
  })

  it('数据在**第一个**列表里也抓得到（原先只认最后一个列表 → 漏判）', async () => {
    const { figureScriptTraced } = await import('../../src/stages/figure-script-gates.ts')
    // 参数顺序反过来，缺陷就藏起来了：旧正则的 `[^)]*` 贪婪回溯命中的是最后的整数刻度表。
    const code = 'from _figbase import load\n'
      + 'doc = load("results.json")\n'
      + 'ax.plot([1.2, 3.4, 5.6], [0, 5, 10])\n'
    const v = figureScriptTraced(inputOf(code))
    expect(v.code).toBe(1)
    expect(v.items.map(i => i.detail).join(' ')).toContain('硬编码数据')
  })
})

/**
 * **契约承诺的每个导入名，`_figbase` 必须真的提供** —— 这条守卫是血换来的。
 *
 * 实测第三次踩同一个坑：简报与分片提示词教模型
 * `from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn`，
 * 而 `_figbase.py` 转出名单里**漏了 `_lighten`**（它定义在 `plot_utils` 里，
 * 但没被转出）。后果不是"某张图差一点"，而是**7/7 脚本全部 ImportError**，
 * 整个阶段白跑（阶段 6 才炸，等于把代价推到了最后）。
 *
 * 这与 chart_type 那次是同一类错：**契约教的形态 ≠ 资产实际提供的形态**。
 * 靠人记得同步两处是防不住的，所以把契约里点名的名字抠出来逐个核。
 */
describe('`_figbase` 提供的名字 ⊇ 契约点名的名字', () => {
  /**
   * 从 `from _figbase import a, b, c` 这类句子里抠出所有被点名的名字。
   *
   * 捕获必须**在第一个非标识符处停下**：简报里那句是
   * `` `from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn` ``，
   * 后面紧跟反引号与中文说明。第一版用 `[^\n；;]*` 一路吃到行尾，
   * 于是把说明文字也当成名字，抠出 `cn_figbasesetup_style`、`5`、`10` 这类垃圾，
   * 测试报了 12 个"缺失"——**全是夹具自己的 bug**（判据没问题，是抠名字的方式错了）。
   */
  function namedImports(text: string): ReadonlyArray<string> {
    const out = new Set<string>()
    for (const m of text.matchAll(/from\s+_figbase\s+import\s+((?:[A-Za-z_]\w*\s*,\s*)*[A-Za-z_]\w*)/g)) {
      for (const raw of (m[1] ?? '').split(',')) {
        const name = raw.trim()
        if (name.length > 0) out.add(name)
      }
    }
    return [...out]
  }

  it('简报与分片提示词里点名的名字，`_figbase.py` 都有', async () => {
    const { stageBriefing } = await import('../../src/stages/briefing.ts')
    const { scriptShards } = await import('../../src/stages/figure-script-shard.ts')
    const brief = stageBriefing(stageOf('figure-declare'), new Map(), false)
    // `scriptShards(briefing, rawPlan)`：第二个参数是**第一段的原始回答文本**（规划 JSON）。
    const planJson = JSON.stringify({ figures: [
      { figure_id: 'fig_x', chart_type: 'line', recipe: { category: 'basic', number: 1 }, data_refs: [], caption: '', x_label: '', y_label: '' },
    ] })
    const shard = scriptShards(brief, planJson).map(s => s.prompt).join('\n')
    const named = [...new Set([...namedImports(brief), ...namedImports(shard)])]
    expect(named.length, '契约里应当点名了一批要导入的名字').toBeGreaterThan(4)

    const src = await readFile(join(PLOTTING_ASSETS_DIR, '_figbase.py'), 'utf8')
    // **不用 `new RegExp('\b' + n + '\b')`**：这条测试第一版就栽在它上面——
    // 落到文件里成了单反斜杠的 `` `\b${n}\b` ``，JS 读成**退格符 U+0008**，
    // 于是正则变成 `\x08load\x08`，**一个名字都匹配不上**，报"7 个名字全缺"。
    // 这是本会话第二次踩同一个坑（第一次在 stage-service 的限额正则上）。
    // 改成"抠出源码里的全部标识符再查表"：既躲开转义，也比子串匹配更准
    // （子串匹配会让 `save` 被 `save_fig` 命中而假通过）。
    const defined = new Set(src.match(/[A-Za-z_]\w*/g) ?? [])
    const missing = named.filter(n => !defined.has(n))
    expect(missing, `契约教模型 import 这些名字，但 _figbase.py 没有：${missing.join('、')}`).toEqual([])
  })

  it('`_figbase.py` 真的能被 python 导入，且这些名字都在（不是靠字符串碰巧出现）', async () => {
    // 源码里有这个词 ≠ 能 import（可能是注释、可能是 import 失败）。
    // 所以真跑一次：拷成临时布局 → python -c "from _figbase import ..."。
    const root = await mkdtemp(join(tmpdir(), 'dsh-figbase-'))
    await mkdir(join(root, '_utils'), { recursive: true })
    await mkdir(join(root, 'figures', '_utils'), { recursive: true })
    await copyFile(join(PLOTTING_ASSETS_DIR, 'plot_utils.py'), join(root, '_utils', 'plot_utils.py'))
    await copyFile(join(PLOTTING_ASSETS_DIR, '_figbase.py'), join(root, 'figures', '_figbase.py'))
    const names = ['load', 'save', 'panel', 'PALETTE', 'COLORS', 'PALETTE_LIGHT', '_lighten',
      'cn', 'CMAP_SEQ', 'CMAP_DIV', 'LINE_COLORS', 'seq_colors', 'log_floor',
      'smart_labels', 'auto_legend', 'check_legend_overlap', 'values_by_id', 'ledger']
    const probe = `import sys; sys.path.insert(0, 'figures'); from _figbase import ${names.join(', ')}; print('ok')`
    const r = spawnSync('python', ['-c', probe], { cwd: root, encoding: 'utf8', timeout: 180_000 })
    expect(r.stdout ?? '', `python 导入失败：${(r.stderr ?? '').slice(-400)}`).toContain('ok')
  })
})

/**
 * **契约里点名的文件，本阶段必须真的拿得到** —— 否则那段话是空话。
 *
 * 实测（本轮）：我在阶段 3 的契约里写"阶段 1 的 `FIGURE_MANIFEST` 已经规划了每张数据图，
 * 逐张问一句这张图要什么数据"，但阶段 3 的 `consumes` 里**没有 `PROBLEM_ANALYSIS.md`**
 * ——清单根本不在它的简报里，**那段话无从执行**。阶段 4 同样。
 *
 * 这是"契约教的 ≠ 环境给的"的又一形态（与 `_figbase` 导出名单、chart_type 白名单同类）。
 * 区别在于它更隐蔽：前两者会让脚本**报错**，这一条只会让模型**默默按自己的理解做**，
 * 最后表现为"图还是画不出来"，而没有任何一处报错指向真正的原因。
 */
describe('契约点名的文件必须在本阶段的 `consumes` 里', () => {
  /** 契约里出现这个标记 → 本阶段必须 consume 这个文件。 */
  const REQUIRED: ReadonlyArray<readonly [string, string]> = [
    ['FIGURE_MANIFEST', '01-prob-analysis/PROBLEM_ANALYSIS.md'],
    ['PROBLEM_FACTS.json', '01-prob-analysis/PROBLEM_FACTS.json'],
    ['DECLARATION.json', '02-modeling/DECLARATION.json'],
    ['FIGURE_PLAN.json', '05-figure-declare/FIGURE_PLAN.json'],
  ]

  it('逐阶段核：契约提到某文件，`consumes` 或 `produces` 里就得有它', () => {
    const problems: string[] = []
    // **按 basename 比**：`consumes` 写的是带目录的路径（`02-modeling/DECLARATION.json`），
    // `produces` 写的是裸名（`DECLARATION.json`）——第一版直接比字符串，
    // 于是把"本阶段自己产出的文件"也判成"没拿到"（4 条命中里 3 条是假阳性）。
    // 这里**不用正则**：`replace(/\/$/, ...)` 里的转义斜杠经多层字符串转义会掉成裸 `/`，
    // 变成非法正则字面量 `//$/` 而整个文件解析失败（本会话第四次栽在这类转义上）。
    const base = (q: string): string => {
      const parts = q.split('/').filter(x => x.length > 0)
      return parts[parts.length - 1] ?? q
    }
    for (const spec of STAGES) {
      // 本阶段自己的产物不算"要拿到"（它自己写出来的）
      const own = spec.produces.map(q => base(q.file))
      const has = (file: string): boolean => {
        const b = base(file)
        return spec.consumes.some(c => base(c) === b) || own.some(f => f === b || b.startsWith(f))
      }
      const brief = stageBriefing(spec, new Map(), false)
      for (const [marker, file] of REQUIRED) {
        if (!brief.includes(marker)) continue
        if (!has(file)) {
          problems.push(`${spec.id}：契约点名了 \`${marker}\`，但没有 consume \`${file}\` —— 那段话无从执行`)
        }
      }
    }
    expect(problems, problems.join('；')).toEqual([])
  })
})
