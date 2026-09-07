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
import { blockMessage, readProblemFile } from '../src/invoke.ts'

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

  it('NONE 预算耗尽 → none 类、提示换层', () => {
    const h = blockMessage('tier_degraded', 'gate-failed', 'exhausted 2 guided retries (NONE)')
    expect(h.classifier).toBe('none')
    expect(h.advice).toContain('T3')
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
