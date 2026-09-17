/**
 * W8.9-A1 — code-provenance guard tests.
 *
 * 纪律 3（构建陷阱）的机械守卫。本组测试必须证明两件事：
 *   ① 合格形态通过（src 旧 / lib 新）；
 *   ② 事故形态被抓（src 新 / lib 旧）——这就是纪律 14 要求的"变异→红"证据。
 *
 * 纪律 14（击杀证明义务）：每项守卫修复配"变异→测试红→还原"证据。本文件
 * 的第 3 个用例即是该证据：它**构造出 W8.8 事故的精确形态**并断言守卫
 * 拒绝它。
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkCodeProvenance,
  checkProvenance,
  newestMtime,
  SHELL_PROVENANCE_TARGETS,
  type ProvenanceTarget,
} from '../src/code-provenance.ts'

/** Build a throwaway package with explicit mtimes. */
function makePackage(srcMtimeSec: number, entryMtimeSec: number | null): ProvenanceTarget {
  const dir = mkdtempSync(join(tmpdir(), 'prov-'))
  mkdirSync(join(dir, 'src', 'delivery'), { recursive: true })
  mkdirSync(join(dir, 'lib'), { recursive: true })
  const srcFile = join(dir, 'src', 'delivery', 'execution-gate.ts')
  writeFileSync(srcFile, 'export const x = 1\n')
  utimesSync(srcFile, srcMtimeSec, srcMtimeSec)
  if (entryMtimeSec !== null) {
    const entry = join(dir, 'lib', 'index.js')
    writeFileSync(entry, 'export const x = 1\n')
    utimesSync(entry, entryMtimeSec, entryMtimeSec)
  }
  return { name: 'pkg-under-test', dir, entry: 'lib/index.js' }
}

const T0 = 1_700_000_000 // seconds

describe('code-provenance — W8.9-A1 build-trap guard', () => {
  it('passes when the built entry is newer than the newest source', () => {
    const target = makePackage(T0, T0 + 60)
    const check = checkProvenance(target)
    expect(check.ok).toBe(true)
    expect(check.detail).toContain('newer than the newest source')
    rmSync(target.dir, { recursive: true, force: true })
  })

  it('passes when the built entry equals the newest source (rebuild same second)', () => {
    const target = makePackage(T0, T0)
    expect(checkProvenance(target).ok).toBe(true)
    rmSync(target.dir, { recursive: true, force: true })
  })

  it('FAILS on the exact W8.8 accident shape: src edited, lib not rebuilt', () => {
    // 事故形态：源码比构建产物新 → 真实运行会跑旧代码，而测试读 src 全绿。
    const target = makePackage(T0 + 600, T0)
    const check = checkProvenance(target)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain('OLDER than the newest source')
    expect(check.detail).toContain('stale')
    rmSync(target.dir, { recursive: true, force: true })
  })

  it('FAILS when the built entry was never built at all', () => {
    const target = makePackage(T0, null)
    const check = checkProvenance(target)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain('built entry missing')
    rmSync(target.dir, { recursive: true, force: true })
  })

  it('sees a nested source edit (src/delivery/…) — a top-level scan would miss it', () => {
    // The W8.8 accident touched src/delivery/execution-gate.ts, one level
    // down. The scan must be recursive or it would report "fresh" here.
    const target = makePackage(T0 + 600, T0)
    const nested = newestMtime(join(target.dir, 'src'), n => n.endsWith('.ts'))
    expect(nested).toBe((T0 + 600) * 1000)
    expect(checkProvenance(target).ok).toBe(false)
    rmSync(target.dir, { recursive: true, force: true })
  })

  it('a target with no sources cannot be stale (vacuous pass, stated)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-empty-'))
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'index.js'), 'export {}\n')
    const check = checkProvenance({ name: 'no-src', dir, entry: 'lib/index.js' })
    expect(check.ok).toBe(true)
    expect(check.detail).toContain('nothing to compare')
    rmSync(dir, { recursive: true, force: true })
  })

  it('checkCodeProvenance is fail-closed: one stale target fails the whole verdict', () => {
    const fresh = makePackage(T0, T0 + 60)
    const stale = makePackage(T0 + 600, T0)
    const verdict = checkCodeProvenance([fresh, stale])
    expect(verdict.ok).toBe(false)
    expect(verdict.checks.filter(c => !c.ok).length).toBe(1)
    expect(verdict.remediation).toContain('build:lib:host')
    rmSync(fresh.dir, { recursive: true, force: true })
    rmSync(stale.dir, { recursive: true, force: true })
  })

  it('a fully fresh set yields no remediation sentence', () => {
    const a = makePackage(T0, T0 + 60)
    const b = makePackage(T0, T0 + 60)
    const verdict = checkCodeProvenance([a, b])
    expect(verdict.ok).toBe(true)
    expect(verdict.remediation).toBe('')
    rmSync(a.dir, { recursive: true, force: true })
    rmSync(b.dir, { recursive: true, force: true })
  })

  it('the shell declares the workspace packages it loads (single source)', () => {
    // The CLI builds its target list from this constant; the test asserts
    // the list is non-empty and shaped as repo-relative dirs.
    expect(SHELL_PROVENANCE_TARGETS.length).toBeGreaterThan(0)
    for (const t of SHELL_PROVENANCE_TARGETS) {
      expect(t.dir).not.toMatch(/^[A-Za-z]:|^\//) // repo-relative, not absolute
      expect(t.entry.endsWith('.js')).toBe(true)
    }
  })
})
