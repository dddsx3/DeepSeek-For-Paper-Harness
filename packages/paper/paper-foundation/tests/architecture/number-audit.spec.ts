/**
 * 数字出生证明审计 —— 红队实测失败模式的**回归测试**。
 *
 * 红队对 2024B 阶段 2 的独立复算结论：模型层（方法/公式）达参照物水平，
 * 但**求解层不及格**——6 处结果数字错 3 处，全部源于"在没有代码执行的环境下心算"。
 * 本文件把那次的失败形状固化成夹具：门禁必须抓住它们，且**不得**误伤
 * 题面给定值、声明常数、章节编号、参考文献年份。
 */

import { describe, expect, it } from 'vitest'
import { auditFiles, auditNumbers, buildAllowlist, commentLines, verificationClaims } from '../../src/stages/number-audit.ts'

/** 题面给定值（2024B 表 1/表 2 的真值，带原文锚点的形态）。 */
const FACTS = JSON.stringify({
  facts: [
    { name: '标称值', value: '10%', raw_quote: '如果标称值为10%' },
    { name: '信度', value: '95%', raw_quote: '在95%的信度下' },
    { name: '信度', value: '90%', raw_quote: '在90%的信度下' },
  ],
  table1: { rows: [['1', '10%', '4', '2', '10%', '18', '3', '10%', '6', '3', '56', '6', '5']] },
  table2: { rows: [['1', '10%', '2', '1', '1', '10%', '8', '4', '6']] },
})

/** 模型自己声明的常数（Q4 的先验、Q1 的置信水平等）。 */
const DECLARATION = JSON.stringify({
  entries: [
    { kind: 'EquationSpec', value: { equation_id: 'EQ-01', expression: 'pi = 0.9 * 0.9' } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-12', statement: '先验取 Beta(12, 100)' } },
  ],
})

const allowed = buildAllowlist([FACTS, DECLARATION, null])

describe('数字出生证明 —— 红队点名的错数字必须被抓', () => {
  it('阶段 2 手写的期望利润（6 处错 3 处）全部判为"无出生证明"', () => {
    // 红队复算表：报告值与真值（真值不在报告里，所以只应抓到报告值）
    const report = [
      '### 6.4 算例结果',
      '| 情况 | 最优策略 | 期望利润 |',
      '| 1 | (0,0,0,1) | 21.68 |',
      '| 2 | (1,0,0,1) | 13.81 |',
      '| 3 | (0,0,1,1) | 19.80 |',
      '| 4 | (1,0,1,1) | 12.50 |',
      '| 5 | (0,0,0,1) | 20.19 |',
      '| 6 | (1,0,1,1) | 12.50 |',
    ].join('\n')
    const audit = auditNumbers(report, allowed)
    const uniq = new Set(audit.violations.map(v => v.literal))
    for (const bad of ['21.68', '13.81', '19.80', '12.50', '20.19']) {
      expect(uniq.has(bad), `${bad} 是心算结果，必须判为无出生证明`).toBe(true)
    }
  })

  it('阶段 2 的 Q1 样本量（n=110/c=17、n=106/c=15）被抓', () => {
    const report = '情形 (1)：n=110，c=17；情形 (2)：n=106，c=15，接收概率 0.944。'
    const audit = auditNumbers(report, allowed)
    const uniq = new Set(audit.violations.map(v => v.literal))
    expect(uniq.has('110')).toBe(true)
    expect(uniq.has('106')).toBe(true)
    expect(uniq.has('0.944')).toBe(true) // 接收概率是算出来的
    // c=17 是小整数（≤30）→ 已知假阴性，如实断言这个边界
    expect(uniq.has('17')).toBe(false)
  })

  it('**不得误伤**题面给定值与声明常数（零误报面是门禁可信的前提）', () => {
    const legit = [
      '标称值 10%，在 95% 与 90% 的信度下分别给出方案（表 1 情况 1-6）。',
      '市场售价 56 元、调换损失 6 元、拆解费用 5 元、购买单价 18 元、检测成本 2 元。',
      '先验取 Beta(12, 100)，故 alpha = 0.10、beta = 0.90。',
      '第 4.2 节与 5.3 节给出推导；见参考文献 [1] Wald A. Sequential Analysis. Wiley. 1947.',
      '零配件 1-3 装配成半成品 1（见 `ASM-12`、`EQ-01`）。',
    ].join('\n')
    const audit = auditNumbers(legit, allowed)
    expect(audit.violations, `误报：${audit.violations.map(v => v.literal).join('、')}`).toEqual([])
  })

  it('阶段 9 的论文里，**账本里的结果**是合法的（出生证明由真跑代码给出）', () => {
    const withLedger = buildAllowlist([FACTS, DECLARATION, JSON.stringify({
      results: [{ result_id: 'R-Q2-case5-profit', value: 16.94 }, { result_id: 'R-Q3-profit', value: 66.09 }],
    })])
    const paper = '情况 5 的最优期望利润为 16.94 元/件，问题 3 为 66.09 元/件。'
    expect(auditNumbers(paper, withLedger).violations).toEqual([])
    // 但同一个数在没有账本的阶段（阶段 2/3）仍然是无出生证明的
    expect(auditNumbers(paper, allowed).violations.length).toBeGreaterThan(0)
  })
})

describe('"已执行检验"的假声明 —— 阶段 2 不可能跑过任何检验', () => {
  it('红队点名的 §9 完成时声明被抓', () => {
    const section = '1. **分项恒等式检验。** 表 1 的六种情况与问题 3 的算例全部通过（容差 1e-6）。'
    const claims = verificationClaims(section)
    expect(claims.length).toBeGreaterThan(0)
    expect(claims[0]?.context).toContain('全部通过')
  })

  it('写成"待执行"的方案**不**被抓（这是正确写法）', () => {
    const planned = [
      '### 9 模型检验方案（待执行）',
      '1. **分项恒等式检验**：将对 6 种情况逐一核验分项之和与更新方程相等（容差 1e-6）。',
      '2. **网格无关性**：将比较不同离散粒度的解。',
      '3. **灵敏度分析**：将扫描关键参数。',
    ].join('\n')
    expect(verificationClaims(planned)).toEqual([])
  })

  it('"已验证/已校核"式声明被抓', () => {
    expect(verificationClaims('该结论已经验证，与解析解一致。').length).toBeGreaterThan(0)
    expect(verificationClaims('复算结果为 12.50。').length).toBeGreaterThan(0)
  })
})

describe('补严后的覆盖面（状态检查发现的三个遗漏）', () => {
  it('**审全部 .md 散文**，不是只审第一个匹配到的文件', () => {
    const files = new Map([
      ['MODELING_REPORT.md', '结论：期望利润 12.50 元/件。'],
      ['RESULTS.md', '另一处手写数字 21.68。'],
      ['DELIVERABLES.json', '{"min_bytes": 500}'],   // 契约常量：不审（否则误报）
    ])
    const audited = auditFiles(files, allowed)
    expect(audited.map(a => a.file)).toEqual(['MODELING_REPORT.md', 'RESULTS.md'])
    expect(audited.every(a => a.audit.violations.length > 0)).toBe(true)
  })

  it('**契约类 JSON 不被审**（`min_bytes: 500` 是 schema 常量，不是结果）', () => {
    const files = new Map([['DELIVERABLES.json', '{"deliverables":[{"min_bytes":500,"min_rows":3000}]}']])
    expect(auditFiles(files, allowed)).toEqual([])
  })

  it('**代码注释**里的"验证通过"被抓（红队点名的形态）', () => {
    const code = [
      'def solve():',
      '    # 期望利润 12.50，与阶段 2 报告一致，检验通过',
      '    return 12.50',
    ].join(String.fromCharCode(10))
    const comments = commentLines(code)
    expect(comments[1]).toContain('12.50')
    expect(comments[0]).toBe('')  // 非注释行为空
    const claims = comments.flatMap(c => (c === '' ? [] : verificationClaims(c)))
    expect(claims.length).toBeGreaterThan(0)
  })

  it('代码注释里的**普通注释不误报**', () => {
    const code = [
      '# 用后向欧拉做时间推进，dt 由稳定性条件决定',
      'for i in range(1, 11):',
      '    tol = 1e-6  # 收敛容差',
      'fig = plt.figure(figsize=(8, 6))',
    ].join(String.fromCharCode(10))
    const claims = commentLines(code).flatMap(c => (c === '' ? [] : verificationClaims(c)))
    expect(claims).toEqual([])
  })

  it('措辞覆盖面：英文与更多中文说法', () => {
    for (const text of [
      'All tests passed.', 'verification: OK', 'The result was validated.',
      '检验结果：全部满足约束。', '逐一核对无误。', '回代验算为 12.50。',
    ]) {
      expect(verificationClaims(text).length, `漏了：${text}`).toBeGreaterThan(0)
    }
  })
})

describe('四个真实误报形态（2024B 阶段 2 实测，逐条固化成回归夹具）', () => {
  const facts = JSON.stringify({ facts: [{ name: '售价', value: '56', raw_quote: '市场售价 56 元' }] })

  it('随机种子 `202409`（模型声明的常数，只是写在散文里）不误报', () => {
    const text = '蒙特卡洛固定随机种子 202409，重复 2000 次。'
    expect(auditNumbers(text, buildAllowlist([facts, null, null])).violations).toEqual([])
  })

  it('**正文里的章节引用**（"理由见 4.1 末" / "4.3 论证"）不误报', () => {
    const text = [
      '**被否方案**：序贯概率比检验，理由见 4.1 末。',
      '**被否方案**：连续松弛，理由见 4.2 末。',
      '并给出拓扑稳健性说明（见 4.3 末）。',
      '只回代点估计、完整贝叶斯后验最优，理由见 4.4 末。',
      '结构性结论的稳健性已在 4.3 论证。',
    ].join(String.fromCharCode(10))
    const audit = auditNumbers(text, buildAllowlist([facts, null, null]))
    expect(audit.violations.map(v => v.literal), '章节引用被当成结果').toEqual([])
  })

  it('`100%` 是完备性表述（"检测被假设为 100% 准确"）不误报；但孤立的 100 仍要出生证明', () => {
    const ok = '检测被假设为 100% 准确。'
    expect(auditNumbers(ok, buildAllowlist([facts, null, null])).violations).toEqual([])
    const bare = '样本量取 100 件。'
    expect(auditNumbers(bare, buildAllowlist([facts, null, null])).violations.map(v => v.literal)).toEqual(['100'])
  })

  it('**"均通过抽样检测方法得到" 不是"声称已执行检验"**（"通过"=经由，非通过检验）', () => {
    const via = '问题 4 规定所有零配件、半成品、成品的次品率均通过抽样检测方法（例如问题 1 的方法）得到。'
    expect(verificationClaims(via)).toEqual([])
    // 但真正的"全部通过"仍要抓（落在小句末尾）
    expect(verificationClaims('表 1 的六种情况全部通过。').length).toBeGreaterThan(0)
    expect(verificationClaims('全部通过，无异常').length).toBeGreaterThan(0)
  })
})

describe('第五个真实误报形态：**声明的集合长度**', () => {
  it('"共 33 个锚点"可从 DECLARATION.json 复核 → 不误报', () => {
    // 实测：正文写"本阶段登记但不赋值的结果锚点共 33 个"，而 DECLARATION.json 的
    // result_anchors.registered 正好 33 条——这个数是**数出来的**，不是算出来的。
    const declaration = JSON.stringify({
      symbols: new Array(44).fill({}), assumptions: new Array(11).fill({}),
      result_anchors: { registered: new Array(33).fill({}) },
    })
    const text = '本阶段登记但**不赋值**的结果锚点共 33 个，清单见 `DECLARATION.json`。'
    expect(auditNumbers(text, buildAllowlist([declaration, null, null])).violations).toEqual([])
    // 但声明里**没有**的数仍然要出生证明（不能因为引入了长度规则就放走任意整数）
    const bad = '本阶段登记的结果锚点共 34 个。'
    expect(auditNumbers(bad, buildAllowlist([declaration, null, null])).violations.map(v => v.literal)).toEqual(['34'])
  })
})

describe('元语言 vs 断言（第六、七处真实误报）', () => {
  it('**反例引用**不算声称（"绝不写「全部通过」"）', () => {
    const line = '所有检验口径都写成**待执行**：写「将对 16 种组合逐一核验分项恒等式」，绝不写「16 种组合全部通过」。'
    expect(verificationClaims(line)).toEqual([])
  })

  it('**批评假验证**不算声称（"会给下游传递错误的已验证信号"）', () => {
    const line = '把检验方案写成检验结论会给下游传递错误的已验证信号，比单个错数字更危险。'
    expect(verificationClaims(line)).toEqual([])
  })

  it('真断言仍然被抓（红队点名的 §9）', () => {
    expect(verificationClaims('表 1 的六种情况与问题 3 的算例全部通过（容差 1e-6）。').length).toBeGreaterThan(0)
    expect(verificationClaims('该结论已验证，与解析解一致。').length).toBeGreaterThan(0)
  })
})

describe('章节号 vs 结果 —— 判别力（第八、九处真实误报）', () => {
  const facts = JSON.stringify({ facts: [{ name: '售价', value: '56', raw_quote: '市场售价 56 元' }] })

  it('**行内章节引用**（"对应 5.1 的 OC 函数；对应 6.1…"）不误报', () => {
    const text = '图表类型说明：fig_q1_oc_curve_p1 为折线图，对应 5.1 的 OC 函数；fig_x 对应 6.1 的模型；fig_y 对应 8.1 与 8.2；fig_z 见 5.2、5.3。'
    expect(auditNumbers(text, buildAllowlist([facts, null, null])).violations.map(v => v.literal)).toEqual([])
  })

  it('**加粗小节标题**（"**6.1 序贯概率比检验不作主方案。**"）不误报', () => {
    const text = ['**6.1 序贯概率比检验（SPRT）不作主方案。** SPRT 在期望样本量上更优。',
      '### 5.1 问题 1：最小检测次数的精确二项验收方案'].join(String.fromCharCode(10))
    expect(auditNumbers(text, buildAllowlist([facts, null, null])).violations.map(v => v.literal)).toEqual([])
  })

  it('**判别力**：第二分量 >30 的（红队点名的真错数字）即使贴着章节标记也照样被抓', () => {
    // 这是这条规则的"不误伤"证明：12.50 / 21.68 / 15.88 的第二分量是 50/68/88 > 30，
    // 所以它们**不满足"各分量都 ≤30"**，任何章节标记都救不了它们。
    for (const bad of ['12.50', '21.68', '15.88', '34.32']) {
      const text = `对应 ${bad} 的结果，见 ${bad} 节。`
      expect(auditNumbers(text, buildAllowlist([facts, null, null])).violations.map(v => v.literal), `${bad} 被章节规则误放`).toContain(bad)
    }
  })
})
