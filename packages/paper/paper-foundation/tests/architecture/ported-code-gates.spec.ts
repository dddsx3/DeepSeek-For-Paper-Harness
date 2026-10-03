/**
 * 从参考实现逐条移植的三道**代码级静态门禁** + `paper_claim_check`。
 *
 * 这四条各自都有一组"**不许误报**"用例——误报的代价不是"少拦一个错"，
 * 而是模型去修一个不存在的问题（实测：反复重启、进度卡死）。
 * 所以每个"能拦"的用例旁边都有一条"该放行"的用例。
 */

import { describe, expect, it } from 'vitest'
import { GATES, runGates, type GateInput } from '../../src/stages/gates.ts'

function input(files: Record<string, string>, upstream: Record<string, string> = {}): GateInput {
  return { files: new Map(Object.entries(files)), upstream: new Map(Object.entries(upstream)), problemCount: 4 }
}
const run = (id: string, i: GateInput) => runGates([id], i)
const detail = (i: GateInput, id: string) => run(id, i).items[0]?.detail ?? ''

// ══════════════════════════════════════════════════════════════════════════
describe('claim_code_check —— 声称 ↔ 代码实现（移植 claim_code_check.py）', () => {
  const contract = (lines: string) => `# 建模报告\n\n<!-- METHOD_CLAIMS_MACHINE\n${lines}\n-->\n`

  it('没有代码 / 没有声称文本 → 2（无法判定，不是通过）', () => {
    expect(run('claim_code_check', input({ 'RESULTS.md': 'x' }, { 'MODELING_REPORT.md': contract('M1 | must: LpInteger') })).code).toBe(2)
    expect(run('claim_code_check', input({ 'code/main.py': 'print(1)' })).code).toBe(2)
  })

  it('合同 must 命中任一即算实现（need_any 语义，防误判）', () => {
    const i = input(
      { 'code/main.py': 'import pulp\nx = pulp.LpVariable("x", cat="Integer")' },
      { 'MODELING_REPORT.md': contract('M1 | must: LpInteger, cat="Integer" | forbid: linprog') },
    )
    expect(run('claim_code_check', i).code).toBe(0)
  })

  it('合同 must 一个都找不到 → 1，且点名是哪条合同', () => {
    const i = input(
      { 'code/main.py': 'from scipy.optimize import linprog\nlinprog(c, A, b)' },
      { 'MODELING_REPORT.md': contract('M1 | must: LpInteger, GRB.INTEGER') },
    )
    const v = run('claim_code_check', i)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('M1')
  })

  it('合同 forbid 命中任一 → 1（建模明令禁止的降级替代）', () => {
    const i = input(
      { 'code/main.py': 'import pulp\nv = pulp.LpVariable("v", cat=pulp.LpInteger)\n# 退化成就近配车' },
      { 'MODELING_REPORT.md': contract('M1 | must: LpInteger | forbid: 就近配车') },
    )
    // 注释行被剥掉 → forbid 不该在注释里命中；must 命中 → 通过
    expect(run('claim_code_check', i).code).toBe(0)
    const real = input(
      { 'code/main.py': 'strategy = "就近配车"\nimport pulp\nv = pulp.LpVariable("v", cat=pulp.LpInteger)' },
      { 'MODELING_REPORT.md': contract('M1 | must: LpInteger | forbid: 就近配车') },
    )
    expect(run('claim_code_check', real).code).toBe(1)
  })

  it('内置安全网：声称整数规划却只有连续变量 → 1', () => {
    const i = input(
      { 'code/main.py': 'from scipy.optimize import linprog\nres = linprog(c, A_ub, b_ub)' },
      { 'MODELING_REPORT.md': '本文建立混合整数规划模型求解。' },
    )
    const v = run('claim_code_check', i)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('整数')
  })

  it('**零误报**：背景里的"排队现象"不该触发随机仿真规则', () => {
    const i = input(
      { 'code/main.py': 'from scipy.optimize import linprog\nres = linprog(c, A_ub, b_ub)' },
      // 参考的原话：裸词"排队/泊松"会被论文背景与文献综述误命中
      { 'MODELING_REPORT.md': '生产过程中的排队现象值得研究，本文用确定性优化处理。' },
    )
    expect(run('claim_code_check', i).code).toBe(0)
  })

  it('**零误报**：只有注释里出现 must 签名 → 不算实现（注释行被剥掉）', () => {
    const i = input(
      { 'code/main.py': '# 这里本可以用 LpInteger\nx = 1' },
      { 'MODELING_REPORT.md': contract('M1 | must: LpInteger') },
    )
    expect(run('claim_code_check', i).code).toBe(1)
  })

  it('无合同块时只跑内置安全网，并在 detail 里如实说明覆盖不足', () => {
    const i = input({ 'code/main.py': 'print(1)' }, { 'MODELING_REPORT.md': '# 报告（无合同块）' })
    const v = run('claim_code_check', i)
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('METHOD_CLAIMS_MACHINE')
  })

  it('**家规形态** `<!-- BEGIN X -->…<!-- END X -->` 也认（实测声明文件用的就是它）', () => {
    const block = '<!-- BEGIN METHOD_CLAIMS_MACHINE -->\nM1 | must: LpInteger | forbid: linprog\n<!-- END METHOD_CLAIMS_MACHINE -->'
    const ok = input({ 'code/main.py': 'x = 1\nv = LpInteger' }, { 'DECLARATION.json': block })
    const v = run('claim_code_check', ok)
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('通用合同核对了 1 条签名')
    // forbid 命中 → 硬失败（合同真的被执行了，不是被忽略）
    const bad = input({ 'code/main.py': 'from scipy.optimize import linprog\nv = LpInteger' }, { 'DECLARATION.json': block })
    expect(run('claim_code_check', bad).code).toBe(1)
  })

  it('合同块**只从 DECLARATION.json 读得到**也算数（实测块就写在那里）', () => {
    const block = '<!-- BEGIN METHOD_CLAIMS_MACHINE -->\nM1 | must: LpInteger\n<!-- END METHOD_CLAIMS_MACHINE -->'
    const i = input({ 'code/main.py': 'v = LpInteger' }, { 'DECLARATION.json': block })
    expect(run('claim_code_check', i).items[0]?.detail).toContain('1 条签名')
  })

  it('**零误报**：蒙特卡洛声称只要有随机抽样就算实现（不该要求队列结构）', () => {
    const i = input(
      { 'code/main.py': 'import random\nfor _ in range(1000):\n    x = random.uniform(0, 1)' },
      { 'MODELING_REPORT.md': '本文用蒙特卡洛模拟情景重抽样。' },
    )
    expect(run('claim_code_check', i).code).toBe(0)
  })

  it('**零误报**：只声明蒙特卡洛却写确定性计算 → 1（真该拦的那种）', () => {
    const i = input(
      { 'code/main.py': 'total = a * 3 + 7' },
      { 'MODELING_REPORT.md': '本文用蒙特卡洛模拟情景。' },
    )
    expect(run('claim_code_check', i).code).toBe(1)
  })

  // ── `forbid` 的否定式命中：这一组全是**实测踩过的假阳性**（每一条都曾让阶段硬失败）──
  it('**零误报**：合规自审字典 `{"X": False}` 是"声明没用"，不是降级', () => {
    // 实测（2024B 阶段 3 第 6 次）：模型在自审字典里登记
    // `"normal_approximation_as_primary": False` / `"unbounded_sprt": False`，
    // 门禁读成"出现降级签名"→ 硬失败。那是**守约的证据**，而且每轮都会这样登记 → 必然死循环。
    const code = [
      'x = {',
      '    "exact_integer_enumeration": True,',
      '    "normal_approximation_as_primary": False,',
      '    "unbounded_sprt": False,',
      '}',
    ].join('\n')
    const i = input({ 'code/problem1.py': code }, { 'DECLARATION.json': contract('M1 | must: exact_integer_enumeration | forbid: normal_approximation_as_primary, unbounded_sprt') })
    expect(run('claim_code_check', i).code).toBe(0)
  })

  it('**零误报**：行内注释里提到禁词不算命中（参考只跳整行注释，不够）', () => {
    const code = 'y = 1  # 这里不用 normal_approximation_as_primary，改用精确枚举\nz = exact_integer_enumeration\n'
    const i = input({ 'code/problem1.py': code }, { 'DECLARATION.json': contract('M1 | must: exact_integer_enumeration | forbid: normal_approximation_as_primary') })
    expect(run('claim_code_check', i).code).toBe(0)
  })

  it('**零误报**：否定式条件 `if not X:` 不算命中', () => {
    const code = 'if not unbounded_sprt:\n    use(exact_integer_enumeration)\n'
    const i = input({ 'code/problem1.py': code }, { 'DECLARATION.json': contract('M1 | must: exact_integer_enumeration | forbid: unbounded_sprt') })
    expect(run('claim_code_check', i).code).toBe(0)
  })

  it('**判别力还在**：真的调用了禁词 / 真的把它当字符串值用 → 仍然判 1', () => {
    const called = input(
      { 'code/problem1.py': 'from scipy.stats import norm\nres = normal_approximation_as_primary(p, n)\nv = exact_integer_enumeration' },
      { 'DECLARATION.json': contract('M1 | must: exact_integer_enumeration | forbid: normal_approximation_as_primary') },
    )
    expect(run('claim_code_check', called).code).toBe(1)
    const asValue = input(
      { 'code/problem1.py': 'strategy = "就近配车"\nv = LpInteger' },
      { 'DECLARATION.json': contract('M1 | must: LpInteger | forbid: 就近配车') },
    )
    expect(run('claim_code_check', asValue).code).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════
describe('data_ingest_check —— 防"静默少喂数据"（移植 data_ingest_check.py）', () => {
  it('没有 code → 2', () => {
    expect(run('data_ingest_check', input({ 'RESULTS.md': 'x' })).code).toBe(2)
  })

  it('`read_excel` 不写 `sheet_name` → 1（pandas 默认只读首表且不报错）', () => {
    const v = run('data_ingest_check', input({ 'code/main.py': 'df = pd.read_excel("data.xlsx")' }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('sheet_name')
  })

  it('写了 `sheet_name=None` → 0', () => {
    expect(run('data_ingest_check', input({ 'code/main.py': 'df = pd.read_excel("d.xlsx", sheet_name=None)' })).code).toBe(0)
    expect(run('data_ingest_check', input({ 'code/main.py': 'df = pd.read_excel("d.xlsx", sheet_name="Sheet1")' })).code).toBe(0)
  })

  it('**零误报**：没有 ExcelFile 的文件里 `.parse()` 空参不该被拦（dateutil 等）', () => {
    expect(run('data_ingest_check', input({ 'code/main.py': 'import dateutil.parser\nd = dateutil.parser.parse()' })).code).toBe(0)
  })

  it('`ExcelFile(...).parse()` 空参 → 1（同一个坑的另一种写法）', () => {
    const v = run('data_ingest_check', input({ 'code/main.py': 'x = pd.ExcelFile("d.xlsx")\ndf = x.parse()' }))
    expect(v.code).toBe(1)
    expect(run('data_ingest_check', input({ 'code/main.py': 'x = pd.ExcelFile("d.xlsx")\ndf = x.parse("S1")' })).code).toBe(0)
  })

  it('**零误报**：注释与三引号里的 `read_excel(f)` 不算真代码', () => {
    const src = '# 示例：pd.read_excel(f) 是错的\n"""\npd.read_excel(f)\n"""\nx = 1\n'
    expect(run('data_ingest_check', input({ 'code/main.py': src })).code).toBe(0)
  })

  it('截断写法只警告（`nrows=`）——**不阻断**，但写在 detail 里', () => {
    const i = input({ 'code/main.py': 'df = pd.read_excel("d.xlsx", sheet_name=None, nrows=1000)' })
    const v = run('data_ingest_check', i)
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('nrows')
  })
})

// ══════════════════════════════════════════════════════════════════════════
describe('facts_audit —— 代码裸数字（移植 facts_audit.py，**警告级**）', () => {
  const facts = JSON.stringify({ parameters: { p: 0.1, cost: 3.5 } })

  it('没有代码 / 没有基准集合 → 2', () => {
    expect(run('facts_audit', input({}, { 'PROBLEM_FACTS.json': facts })).code).toBe(2)
    expect(run('facts_audit', input({ 'code/main.py': 'x = 1' })).code).toBe(2)
  })

  it('**它永远不判硬失败**：裸数字最多是 ⚠（参考里 exit 2 = 可继续）', () => {
    const i = input({ 'code/main.py': 'z = 1.96\n' }, { 'PROBLEM_FACTS.json': facts })
    const v = run('facts_audit', i)
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('1.96')
    expect(v.items[0]?.detail).toContain('警告级')
  })

  it('白名单与题面给定值不算可疑', () => {
    const i = input(
      { 'code/params.py': 'p = 0.1\ncost = 3.5\n' },
      { 'PROBLEM_FACTS.json': facts },
    )
    const v = run('facts_audit', i)
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).not.toContain('⚠')
  })

  it('有裸数字却不 `import params` → 警告里点名该文件', () => {
    const i = input(
      { 'code/problem1.py': 'z = 1.96\n' },
      { 'PROBLEM_FACTS.json': facts },
    )
    expect(detail(i, 'facts_audit')).toContain('params')
  })
})

// ══════════════════════════════════════════════════════════════════════════
describe('delivery_audit —— 声明的交付物与磁盘一致（移植 delivery_audit.py）', () => {
  const list = (artifacts: ReadonlyArray<unknown>, key = 'artifacts') =>
    JSON.stringify({ [key]: artifacts })

  it('清单不存在 / 不是合法 JSON / 没有清单数组 → 1（不是 2：清单是硬契约）', () => {
    expect(run('delivery_audit', input({})).code).toBe(1)
    expect(run('delivery_audit', input({ 'DELIVERABLES.json': '{坏' })).code).toBe(1)
    expect(run('delivery_audit', input({ 'DELIVERABLES.json': '{"stage":"03-code"}' })).code).toBe(1)
    expect(run('delivery_audit', input({ 'DELIVERABLES.json': list([]) })).code).toBe(1)
  })

  it('键名 `deliverables` 与 `artifacts` 都认（判据是**一致**，不是键名）', () => {
    const one = [{ path: 'code/main.py', min_bytes: 5 }]
    expect(run('delivery_audit', input({ 'code/main.py': 'print(1)', 'DELIVERABLES.json': list(one) })).code).toBe(0)
    expect(run('delivery_audit', input({ 'code/main.py': 'print(1)', 'DELIVERABLES.json': list(one, 'deliverables') })).code).toBe(0)
  })

  it('**运行期产物**（代码里会写出、门禁时还没生成）放行并记账', () => {
    const i = input({
      'code/main.py': 'json.dump(out, open("outputs.json", "w"))',
      'DELIVERABLES.json': list([{ path: 'code/outputs.json', kind: 'json', min_bytes: 100 }]),
    })
    const v = run('delivery_audit', i)
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('运行期产物')
  })

  it('**声明的交付物没人产出**（磁盘没有、代码里也不写）→ 1', () => {
    const i = input({
      'code/main.py': 'print(1)',
      'DELIVERABLES.json': list([{ path: 'code/ghost.json', kind: 'json' }]),
    })
    const v = run('delivery_audit', i)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('没人产出')
  })

  it('**`.py` 不在磁盘上 → 1**（源码不可能"等运行时再生成"）', () => {
    // 实测（2024B）：`code/data_check.py` 被声明、main.py 里也有 `data_check.json`，
    // 旧判据靠"词干出现过"把它当成运行期产物放行 —— 假通过。
    const i = input({
      'code/main.py': 'x = _write_json("data_check.json")',
      'DELIVERABLES.json': list([{ path: 'code/data_check.py', kind: 'py', min_bytes: 200 }]),
    })
    const v = run('delivery_audit', i)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('源码')
  })

  it('存在但是空的 / 小于自己声明的 `min_bytes` → 1', () => {
    const empty = input({ 'RESULTS.md': '', 'DELIVERABLES.json': list([{ path: 'RESULTS.md' }]) })
    expect(run('delivery_audit', empty).code).toBe(1)
    const small = input({ 'RESULTS.md': '短', 'DELIVERABLES.json': list([{ path: 'RESULTS.md', min_bytes: 500 }]) })
    const v = run('delivery_audit', small)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('min_bytes')
  })

  it('目录型声明：目录下有产物才算数', () => {
    const okDir = input({ 'code/a.py': 'x = 1', 'DELIVERABLES.json': list([{ path: 'code/' }]) })
    expect(run('delivery_audit', okDir).code).toBe(0)
    const emptyDir = input({ 'DELIVERABLES.json': list([{ path: 'code/' }]) })
    expect(run('delivery_audit', emptyDir).code).toBe(1)
  })

  it('**零误报**：声明与磁盘一致的正常清单 → 0', () => {
    const i = input({
      'code/main.py': 'print(1)',
      'RESULTS.md': '结果'.repeat(300),
      'DELIVERABLES.json': list([
        { path: 'code/main.py', kind: 'py', min_bytes: 5, desc: '入口' },
        { path: 'RESULTS.md', kind: 'md', min_bytes: 100, desc: '结果说明' },
      ]),
    })
    expect(run('delivery_audit', i).code).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
describe('paper_claim_check —— 结果锚点必须落地（阶段 9 的"装配而非推理"）', () => {
  const ledger = JSON.stringify({ results: [{ result_id: 'R-Q1-p', name: 'p', value: 0.1, unit: '' }] })

  it('正文不存在 → 1；账本不存在 → 2', () => {
    expect(run('paper_claim_check', input({}, { 'results.json': ledger })).code).toBe(1)
    expect(run('paper_claim_check', input({ 'paper/main.md': 'x' })).code).toBe(2)
  })

  it('没有锚点 → 0（锚点是可选的写法，harness 会把落地的那部分换成真值）', () => {
    const i = input({ 'paper/main.md': '# 论文\n最优次品率为 0.1。' }, { 'results.json': ledger })
    expect(run('paper_claim_check', i).code).toBe(0)
  })

  it('**残留的锚点就是没落地的锚点** → 1，并把账本里没有的 id 点名', () => {
    const i = input(
      { 'paper/main.md': '最优次品率为 {R-Q1-p}，收益为 {R-Q9-nope}。' },
      { 'results.json': ledger },
    )
    const v = run('paper_claim_check', i)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('R-Q9-nope')
  })

  it('替换报告给出的"没换成的原因"会被带进门禁结论', () => {
    const i = input(
      {
        'paper/main.md': '扫描结果见 {R-Q2-scan}。',
        '_anchor-report.json': JSON.stringify({ resolved: 0, unresolved: [{ id: 'R-Q2-scan', reason: '该结果是数组/矩阵' }] }),
      },
      { 'results.json': ledger },
    )
    expect(detail(i, 'paper_claim_check')).toContain('数组/矩阵')
  })

  it('**零误报**：附录代码块里的 `{R-…}` 不是锚点', () => {
    const i = input(
      { 'paper/main.md': '# 论文\n\n```python\nprint("{R-Q9-nope}")\n```\n' },
      { 'results.json': ledger },
    )
    expect(run('paper_claim_check', i).code).toBe(0)
  })

  it('报告说替换了 N 条时，结论里带上这个证据', () => {
    const i = input(
      { 'paper/main.md': '最优次品率为 0.1。', '_anchor-report.json': JSON.stringify({ resolved: 3, unresolved: [] }) },
      { 'results.json': ledger },
    )
    expect(detail(i, 'paper_claim_check')).toContain('3 个锚点已由 harness 换成账本真值')
  })
})
