/**
 * **非阻断审计观察的归宿**（P0-b）—— 通过审计的阶段留下的 findings 必须进交付台账。
 *
 * 缺口是怎么来的：`_audit.json` 全仓只有一处读取点（`runner.ts` 的
 * `priorAuditFindings()`），只在**重跑**时把 findings 拼回简报。于是一个
 * `pass 0.80`、4 条 findings 的阶段，那 4 条既不影响放行、也不进已知缺陷表——
 * 违反"检出到的每个问题都必须有归宿"。
 *
 * 这个文件钉住三条判据：
 * 1. **只收通过阶段**的 findings（未通过阶段的已经走 DRIFT 回灌，不重复记账）；
 * 2. 缺审计文件的阶段计入 `withoutAudit`，但 `00-input` **不是阶段**（不能凭空多一个）；
 * 3. 坏 JSON / 坏字段一律跳过，**绝不抛错**（这是记账，不是门禁）。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectStageAuditObservations,
  renderAuditObservationsMarkdown,
} from '../../src/stages/audit-collector.ts'

/** 铺一个阶段目录并写 `_audit.json`（内容原样序列化）。 */
async function seedAudit(root: string, stageDir: string, audit: unknown): Promise<void> {
  const dir = join(root, stageDir)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '_audit.json'), JSON.stringify(audit, null, 2), 'utf8')
}

/** 造一个最小审计结论（字段名与 `stages/audit.ts` 的 `AuditVerdict` 一致）。 */
function verdictOf(verdict: 'pass' | 'fail', score: number, findings: ReadonlyArray<unknown>): unknown {
  return {
    stage: 'any',
    verdict,
    score,
    structure_ok: true,
    requirement_compliance: [],
    findings,
    missing: [],
    model: 'audit-model',
    at: '2026-10-27T00:00:00.000Z',
  }
}

describe('审计观察收集器 —— 通过阶段的 findings 进交付台账', () => {
  it('只收**通过**阶段的 findings；失败阶段走 DRIFT、不重复记账；无审计阶段计数', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-audit-collector-'))
    try {
      // 00-input 不是阶段：它没有 _audit.json，但绝不能进 withoutAudit。
      await mkdir(join(root, '00-input'), { recursive: true })
      await seedAudit(root, '01-prob-analysis', verdictOf('pass', 0.85, [
        { severity: 'major', where: 'CAPABILITY_CHECKLIST.json', issue: 'C-Q1 的概率方向写反', fix: '改为 ≤ beta' },
        { severity: 'minor', where: 'PROBLEM_ANALYSIS.md', issue: '假设 A3 的表述含糊', fix: '写明取值范围' },
      ]))
      await seedAudit(root, '02-modeling', verdictOf('fail', 0.3, [
        { severity: 'fatal', where: 'MODELING_REPORT.md', issue: '现金流分支缺失', fix: '按决策分支展开' },
      ]))
      // 没有审计结论的阶段（确定性阶段 / 审计没跑成）。
      await mkdir(join(root, '03-code'), { recursive: true })

      const collected = await collectStageAuditObservations(root)
      expect(collected.stages.map(s => s.stage)).toEqual(['01-prob-analysis'])
      expect(collected.stages[0]?.score).toBe(0.85)
      expect(collected.stages[0]?.verdict).toBe('pass')
      expect(collected.stages[0]?.findings).toHaveLength(2)
      expect(collected.total, '总条数 = 通过阶段的 findings 之和（失败的 fatal 不计）').toBe(2)
      expect(collected.withoutAudit, '只有 03-code 没有审计；00-input 不是阶段').toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('坏 JSON 与坏字段**跳过、不抛错**（记账不是门禁）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-audit-collector-'))
    try {
      const broken = join(root, '01-prob-analysis')
      await mkdir(broken, { recursive: true })
      await writeFile(join(broken, '_audit.json'), '{"verdict":"pass", 这不是 JSON', 'utf8')
      // 结构合法但缺少 score：按"不可用"处理，不猜一个分数。
      await seedAudit(root, '02-modeling', { verdict: 'pass', findings: [] })

      const collected = await collectStageAuditObservations(root)
      expect(collected.stages).toEqual([])
      expect(collected.total).toBe(0)
      expect(collected.withoutAudit, '坏文件与坏字段都算"没有可用审计结论"').toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('根目录不存在也不抛错（链还没产出任何阶段）', async () => {
    const root = join(tmpdir(), 'dsh-audit-collector-does-not-exist-2026-10-27')
    const collected = await collectStageAuditObservations(root)
    expect(collected).toEqual({ stages: [], total: 0, withoutAudit: 0 })
  })
})

describe('审计观察台账渲染', () => {
  it('表头写明这是**已接受的**非阻断观察，并转义竖线与换行', () => {
    const markdown = renderAuditObservationsMarkdown({
      generatedAt: '2026-10-27T00:00:00.000Z',
      stages: [{
        stage: '01-prob-analysis',
        score: 0.85,
        verdict: 'pass',
        findings: [{ severity: 'major', where: 'a|b', issue: '第一行\n第二行', fix: '改掉' }],
      }],
      total: 1,
      withoutAudit: 2,
    })
    expect(markdown).toContain('accepted non-blocking observations')
    expect(markdown).toContain('通过审计的阶段：1 个；非阻断观察：1 条；无审计结论的阶段：2 个')
    expect(markdown).toContain('| 01-prob-analysis | 0.85 | major | a\\|b | 第一行 第二行 | 改掉 |')
  })
})
