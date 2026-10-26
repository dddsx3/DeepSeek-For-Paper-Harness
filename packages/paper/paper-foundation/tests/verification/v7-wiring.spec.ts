/**
 * V7 sympy 接链（形态 6 镜像修复）——调用侧 seam 的测试。
 *
 * 背景：`runV7Check`（DIM-001/DIM-002/DOM-001/RES-001 判定）与
 * `scripts/sympy-v7-check.py` 早已存在，却在接链前没有任何调用方——判定写了、
 * 调用侧没接（形态 6：修复只做判定侧）。executor 现在经 `v7AdvisoryFindings`
 * 把发现接进 fail-soft 交付标注流（观察级：归宿 = 已知缺陷表，绝不硬拒绝）。
 *
 * 本套件钉住三件事，全部不依赖 executor 的庞大 harness：
 *   1. **映射口径**（`v7InputFromStore`）：IR 行 → V7Input 只映射存在且非空的
 *      字段；无可锚声明（符号与结果全空）返回 null——调用侧据此省掉一次
 *      python spawn，而不是跑一场注定空转的检查。
 *   2. **观察级标注**（`v7ObservationsOf`）：只保留未通过项；kind 带 `V7_`
 *      前缀、reason 带「观察级」前缀——对读者的显式声明：不阻断交付。
 *   3. **懒降级**：python 缺席时（`PYTHON` 指向不存在的可执行文件）调用链
 *      必须照常返回一条 V7_EXEC 观察——**绝不 throw、绝不崩溃**（C3：未执行
 *      按未通过同级，但同级只是观察级，不是拦交付）。
 *
 * python 在场时的真脚本集成（DIM-002 抓单位失配）由 `v6-v7.spec.ts` 的
 * V7 段覆盖；这里不重复，只在懒降级测试里借用同一真实调用路径。
 */

import { describe, expect, it } from 'vitest'
import {
  V7_OBSERVATION_KIND_PREFIX,
  V7_OBSERVATION_REASON_PREFIX,
  v7AdvisoryFindings,
  v7InputFromStore,
  v7ObservationsOf,
  type V7StoreRow,
} from '../../src/verification/v7-sympy.ts'

const symbolRow = (overrides: Record<string, unknown> = {}): V7StoreRow => ({
  kind: 'SymbolSpec',
  value: { symbol_id: 'SYM-q', unit: 'm', domain: 'REAL', ...overrides },
})
const equationRow = (overrides: Record<string, unknown> = {}): V7StoreRow => ({
  kind: 'EquationSpec',
  value: { equation_id: 'EQ-1', expression: 'q = a * x', unit: 'm', ...overrides },
})
const resultRow = (overrides: Record<string, unknown> = {}): V7StoreRow => ({
  kind: 'Result',
  value: { result_id: 'RES-1', value: 0.731, unit: 'm', ...overrides },
})

describe('v7InputFromStore — IR 行到 V7Input 的映射口径', () => {
  it('三类行各自映射到 V7Input 的对应字段（id/unit/domain、id/expression/unit、id/value/unit）', () => {
    const input = v7InputFromStore([symbolRow(), equationRow(), resultRow()])
    expect(input).not.toBeNull()
    expect(input?.symbols).toEqual([{ id: 'SYM-q', unit: 'm', domain: 'REAL' }])
    expect(input?.equations).toEqual([{ id: 'EQ-1', expression: 'q = a * x', unit: 'm' }])
    expect(input?.results).toEqual([{ id: 'RES-1', value: 0.731, unit: 'm' }])
  })

  it('COUNTER-EXAMPLE: 缺失/空字段被跳过而不是造值（graceful adaptation）', () => {
    const input = v7InputFromStore([
      symbolRow({ unit: '', domain: undefined }),
      resultRow({ value: 'not-a-number', unit: '' }),
    ])
    expect(input?.symbols).toEqual([{ id: 'SYM-q' }])
    // value 不是 number → 不带 value 字段；unit 为空 → 不带 unit 字段。
    expect(input?.results).toEqual([{ id: 'RES-1' }])
  })

  it('COUNTER-EXAMPLE: 无 id 的行无从对账，整行跳过；未知 kind 忽略', () => {
    const input = v7InputFromStore([
      symbolRow({ symbol_id: '' }),
      resultRow({ result_id: undefined }),
      { kind: 'Claim', value: { claim_id: 'C-1' } },
      resultRow(),
    ])
    expect(input?.symbols).toEqual([])
    expect(input?.results).toEqual([{ id: 'RES-1', value: 0.731, unit: 'm' }])
  })

  it('触发口径：空快照与"只有方程"的快照都返回 null（省一次 python spawn）', () => {
    expect(v7InputFromStore([])).toBeNull()
    expect(v7InputFromStore([equationRow()])).toBeNull()
  })

  it('触发口径：符号或结果任一非空即触发；residuals 无 IR 来源，刻意不造', () => {
    const symbolsOnly = v7InputFromStore([symbolRow()])
    expect(symbolsOnly).not.toBeNull()
    expect(symbolsOnly?.results).toEqual([])
    const resultsOnly = v7InputFromStore([resultRow()])
    expect(resultsOnly).not.toBeNull()
    expect(resultsOnly?.symbols).toEqual([])
    // `residuals` 键不存在（undefined）——脚本的响应是 RES-001 ok「跳过」。
    expect(symbolsOnly?.residuals).toBeUndefined()
    expect(resultsOnly?.residuals).toBeUndefined()
  })
})

describe('v7ObservationsOf — findings 到观察级标注', () => {
  it('只保留未通过项；ok 项（检查跑了且无发现）是回执不是缺陷', () => {
    const out = v7ObservationsOf([
      { rule: 'DIM-002', ok: false, detail: '结果 RES-1 单位 s 未在符号表中声明' },
      { rule: 'RES-001', ok: true, detail: '未传入残差序列(跳过)' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('V7_DIM-002')
    expect(out[0]?.reason).toBe(`${V7_OBSERVATION_REASON_PREFIX}结果 RES-1 单位 s 未在符号表中声明`)
  })

  it('kind 前缀剥离规则自身的 V7- 冠字（V7-EXEC → V7_EXEC，不出现双前缀）', () => {
    const out = v7ObservationsOf([{ rule: 'V7-EXEC', ok: false, detail: 'sympy 检查进程退出 1: boom' }])
    expect(out).toEqual([{ kind: 'V7_EXEC', reason: `${V7_OBSERVATION_REASON_PREFIX}sympy 检查进程退出 1: boom` }])
    expect(out[0]?.kind.startsWith(`${V7_OBSERVATION_KIND_PREFIX}V7-`)).toBe(false)
  })
})

describe('v7AdvisoryFindings — 懒降级纪律（python 缺席不崩溃）', () => {
  /** 在本进程内把 PYTHON 指向不存在的可执行文件，用完即恢复（fork 隔离 + finally 兜底）。 */
  const withBrokenPython = (body: () => void): void => {
    const original = process.env['PYTHON']
    process.env['PYTHON'] = 'dsh-v7-wiring-no-such-python-executable'
    try {
      body()
    } finally {
      if (original === undefined) delete process.env['PYTHON']
      else process.env['PYTHON'] = original
    }
  }

  it('COUNTER-EXAMPLE: PYTHON 指向不存在的可执行文件 → 一条 V7_EXEC 观察，绝不 throw', () => {
    withBrokenPython(() => {
      const out = v7AdvisoryFindings([symbolRow(), resultRow()])
      expect(out).toHaveLength(1)
      expect(out[0]?.kind).toBe('V7_EXEC')
      expect(out[0]?.reason.startsWith(V7_OBSERVATION_REASON_PREFIX)).toBe(true)
    })
  })

  it('空快照不触发任何检查（无 python 也安静返回空）', () => {
    withBrokenPython(() => {
      expect(v7AdvisoryFindings([])).toEqual([])
      expect(v7AdvisoryFindings([equationRow()])).toEqual([])
    })
  })
})

describe('v7AdvisoryFindings — 真脚本集成（python 在场，与 v6-v7.spec 同一依赖）', () => {
  it('单位失配的 store 快照产出 V7_DIM-002 观察（kind/reason 都带观察级标记）', () => {
    const out = v7AdvisoryFindings([symbolRow({ unit: 'm', domain: 'REAL' }), resultRow({ unit: 's' })])
    const dim = out.find(o => o.kind === 'V7_DIM-002')
    expect(dim).toBeDefined()
    expect(dim?.reason.startsWith(V7_OBSERVATION_REASON_PREFIX)).toBe(true)
  })

  it('口径一致的 store 快照（符号/方程/结果单位齐同）产出零观察', () => {
    const out = v7AdvisoryFindings([symbolRow(), equationRow(), resultRow()])
    expect(out).toEqual([])
  })
})
