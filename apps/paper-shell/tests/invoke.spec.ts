/**
 * TASK-M1 M1-2 — paper shell: pure helper unit tests (no engine, no network).
 *
 * Covers the shell's own surface — problem-file guardrails (G2 three attacks)
 * and the BLOCKED human-sentence map (M1-2 #2) — without mounting the engine.
 * The engine semantics are untouched (G4: 1025 baseline stays green).
 *
 * @module apps/paper-shell/tests/invoke
 */

import { describe, expect, it } from 'vitest'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { blockMessage, failureFactsOf, fidelityBlockedHuman, readProblemFile, ruleSide } from '../src/invoke.ts'

describe('M1-2 problem-file guardrails (三攻击)', () => {
  it('攻击 1: 巨量文本被外壳拒绝', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-shell-g1-'))
    const huge = join(dir, 'huge.md')
    await writeFile(huge, 'x'.repeat(300_000), 'utf8')
    await expect(readProblemFile(huge)).rejects.toThrow(/太大/)
    await rm(dir, { recursive: true, force: true })
  })

  it('攻击 2: 空文件被拒绝', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-shell-g2-'))
    const empty = join(dir, 'empty.md')
    await writeFile(empty, '', 'utf8')
    await expect(readProblemFile(empty)).rejects.toThrow(/空/)
    await rm(dir, { recursive: true, force: true })
  })

  it('攻击 3: 非 UTF-8 字节被拒绝且提示明确', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-shell-g3-'))
    const bad = join(dir, 'bad.md')
    await writeFile(bad, Buffer.from([0xff, 0xfe, 0x00, 0x61]), 'binary')
    await expect(readProblemFile(bad)).rejects.toThrow(/UTF-8/)
    await rm(dir, { recursive: true, force: true })
  })

  it('正例: 正常题目文件可读且去空白', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-shell-ok-'))
    const good = join(dir, 'ok.md')
    await writeFile(good, '  Estimate mean sea-ice thickness.  \n', 'utf8')
    await expect(readProblemFile(good)).resolves.toBe('Estimate mean sea-ice thickness.')
    await rm(dir, { recursive: true, force: true })
  })
})

describe('M1-2 BLOCKED 人话化 (九门拒绝 + 五类失败码 → 人话一句 + 修复建议)', () => {
  it('W1 协议拒绝 → protocol 类、含引擎原始 reason、给修复建议', () => {
    const h = blockMessage('gate-failed', 'hash_field_forbidden', 'a model-declared DataArtifact cannot carry content_hash')
    expect(h.classifier).toBe('protocol')
    expect(h.oneLine).toContain('协议拒绝')
    expect(h.oneLine).toContain('content_hash')
    expect(h.advice.length).toBeGreaterThan(0)
  })

  it('NONE 预算耗尽 → none 类；建议中不得出现 T3', () => {
    const h = blockMessage('tier_degraded', 'gate-failed', 'exhausted 2 guided retries (NONE)')
    expect(h.classifier).toBe('none')
    // W8.10-A3 (O-L5-05): the advice used to say "或用 --tier T3（最小填充面）
    // 重试". T3 does not read the problem statement (PRD v2 F2) and its
    // 14/14 was self-certifying; recommending it trades the user's paper for
    // a green light. The judgement is now the opposite one.
    expect(h.advice).not.toContain('T3')
    expect(h.advice.length).toBeGreaterThan(0)
  })

  it('T3 自由选择 → guided 类、点名字段、建议用候选', () => {
    const h = blockMessage('gate-failed', 't3_free_choice', "slot 'json_path' filled with 'pond_fraction'")
    expect(h.classifier).toBe('guided')
    expect(h.field).toBe('t3_free_choice')
    expect(h.advice).toContain('候选')
  })

  it('未命名码 → transport 类、给出重试建议', () => {
    const h = blockMessage('provider_retry', 'network-timeout', 'fetch failed')
    expect(h.classifier).toBe('transport')
    expect(h.advice).toContain('重试')
  })
})

// ---------------------------------------------------------------------------
// W8.11-C1 (O-L5-07) — the wording is generated from STRUCTURED facts
// ---------------------------------------------------------------------------

describe('W8.11-C1 — fidelity wording tells the truth about run-4', () => {
  /** The exact event shape run-4 wrote to its audit trail. */
  const run4Events = [
    { eventType: 'workflow_started', detail: { mode: 'strict' } },
    { eventType: 'ir_entry_written', detail: { kind: 'E1Analysis', id: 'e1', chars: 14010 } },
    { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B4 逐问推理覆盖', ok: true } },
    { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B3 反向（E1 假设须被声明）', ok: false } },
    { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B3 锚点同一性（声明须在 E1 中有同名锚点）', ok: true } },
    { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B3 正向（声明须逐字锚定 E1）', ok: false } },
    { eventType: 'gate_failed', detail: { gate: 'ir_producer', reason: 'DRIFT guidance budget exhausted' } },
  ]

  it('extracts the structured facts (gate / failed rules / passed rules / E1 size)', () => {
    const facts = failureFactsOf(run4Events)
    expect(facts.gate).toBe('ir_producer')
    expect(facts.reason).toBe('DRIFT guidance budget exhausted')
    expect(facts.e1Chars).toBe(14010)
    expect(facts.failedRules).toEqual(['B3 反向（E1 假设须被声明）', 'B3 正向（声明须逐字锚定 E1）'])
    expect(facts.passedRules).toContain('B4 逐问推理覆盖')
  })

  it('the wording does NOT claim the model produced nothing', () => {
    // 这是本条的核心反例：旧 `none` 分支说"模型没有给出可用结构"，而 run-4
    // 的 E1 = 14010 字符、四条检查里两条 PASS。**该描述与事实相反。**
    const human = fidelityBlockedHuman(failureFactsOf(run4Events))
    expect(human.oneLine).not.toContain('模型没有给出可用结构')
    expect(human.oneLine).toContain('14010')
    expect(human.oneLine).toContain('保真检查未通过')
    // 必须点名失败的规则
    expect(human.oneLine).toContain('B3 反向')
    expect(human.oneLine).toContain('B3 正向')
    // 且必须点出通过的规则（证明"它给出了"）
    expect(human.oneLine).toContain('B4')
  })

  it('the advice names the gate and does NOT say "换个说法重新提交题目"', () => {
    // 用户改题目措辞对 fidelity 失败无效——建议他这么做是误导。
    const human = fidelityBlockedHuman(failureFactsOf(run4Events))
    expect(human.advice).not.toContain('换个说法重新提交题目')
    expect(human.advice).toContain('ir_producer')
    expect(human.advice).toContain('DRIFT guidance budget exhausted')
  })

  it('the advice states which SIDE the failure belongs to', () => {
    // run-4 的失败集里 B3 反向/正向都属 E2 侧（分析内容合规，映射没对齐）。
    const e2Only = fidelityBlockedHuman(failureFactsOf([
      { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B3 正向（声明须逐字锚定 E1）', ok: false } },
    ]))
    expect(e2Only.advice).toContain('规范化侧')
    // E1 侧的缺陷，改题目措辞没用——文案必须说清
    const e1Only = fidelityBlockedHuman(failureFactsOf([
      { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B5 锚点 id 形态（E1 侧）', ok: false } },
    ]))
    expect(e1Only.advice).toContain('分析侧')
    expect(e1Only.advice).toContain('重试同一份分析不会改变结果')
  })

  it('a LATER wave replaces an earlier one (the terminal cause wins)', () => {
    // attempt 1 失败 → attempt 2 全过 → attempt 3 只挂一条。文案必须报第三条，
    // 不得把 attempt 1 的失败也算进来。
    const facts = failureFactsOf([
      { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B3 反向（E1 假设须被声明）', ok: false } },
      { eventType: 'ir_entry_written', detail: { kind: 'E2Normalization', id: 'e2', chars: 100 } },
      { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B3 反向（E1 假设须被声明）', ok: true } },
      { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B3 正向（声明须逐字锚定 E1）', ok: true } },
      { eventType: 'ir_entry_written', detail: { kind: 'E2Normalization', id: 'e2', chars: 120 } },
      { eventType: 'ir_entry_written', detail: { kind: 'FidelityFinding', id: 'B5 锚点 id 形态（E1 侧）', ok: false } },
    ])
    expect(facts.failedRules).toEqual(['B5 锚点 id 形态（E1 侧）'])
    expect(facts.passedRules).toEqual([])
  })

  it('ruleSide maps the four rules to the side the executor already uses', () => {
    // 归属不是新语义——`executor.ts` 的 E1_SIDE_RULES 已用它决定能否回灌。
    expect(ruleSide('B4 逐问推理覆盖')).toBe('E1')
    expect(ruleSide('B5 锚点 id 形态（E1 侧）')).toBe('E1')
    expect(ruleSide('B3 正向（声明须逐字锚定 E1）')).toBe('E2')
    expect(ruleSide('B3 反向（E1 假设须被声明）')).toBe('E2')
    expect(ruleSide('B3 锚点同一性（声明须在 E1 中有同名锚点）')).toBe('E2')
  })

  it('a run with no fidelity failure yields empty facts (falls back to the table)', () => {
    // 反向守卫：不得凭空造出 fidelity 失败——没有失败就必须返回空，让调用方
    // 走原来的 blockMessage 表。
    const facts = failureFactsOf([{ eventType: 'gate_failed', detail: { gate: 'review', reason: 'x' } }])
    expect(facts.failedRules).toEqual([])
  })
})
