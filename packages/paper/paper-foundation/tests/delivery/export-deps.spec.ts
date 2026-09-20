/**
 * R2⑤ — 导出依赖清单（闭集）+ 探测形态测试.
 *
 * 判据：清单闭集不漂移；探测永不抛（每个依赖返回 0/1/2）；缺一即 notReady。
 * 探测会真跑 python/pandoc（低消耗子进程），但断言只依赖三态语义。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/export-deps
 */

import { describe, expect, it } from 'vitest'
import { EXPECTED_EXPORT_DEPS, exportDepsSummary, probeExportDeps } from '../../src/delivery/export-deps.ts'

describe('export-deps — R2⑤ 依赖 manifest', () => {
  it('闭集清单：三个导出依赖（python-docx / cairosvg / pandoc），硬前置标记齐全', () => {
    expect(EXPECTED_EXPORT_DEPS.map(d => d.name)).toEqual(['python-docx', 'cairosvg', 'pandoc'])
    // python-docx/cairosvg 是今天导出链的硬前置；pandoc 只服务 OMML 通道
    expect(EXPECTED_EXPORT_DEPS.filter(d => d.required).map(d => d.name)).toEqual(['python-docx', 'cairosvg'])
    for (const dep of EXPECTED_EXPORT_DEPS) {
      expect(dep.probe.length).toBeGreaterThan(0)
      expect(dep.purpose.length).toBeGreaterThan(5)
    }
  })

  it('探测永不抛且每个返回三态之一', () => {
    const statuses = probeExportDeps()
    expect(statuses).toHaveLength(EXPECTED_EXPORT_DEPS.length)
    for (const s of statuses) {
      expect([0, 1, 2]).toContain(s.status)
      expect(s.detail.length).toBeGreaterThan(0)
    }
  })

  it('硬前置缺失 → notReady；可选依赖（pandoc）缺失只登记不阻断', () => {
    const deps = [
      { name: 'python-docx', purpose: 'x', probe: ['python', '-c', 'import docx'], required: true },
      { name: 'pandoc', purpose: 'y', probe: ['pandoc', '--version'], required: false },
    ]
    const ok = [{ name: 'python-docx', status: 0 as const, detail: 'ok' }]
    expect(exportDepsSummary(ok, deps).ready).toBe(true)
    const optionalGone = [...ok, { name: 'pandoc', status: 1 as const, detail: 'missing' }]
    const s1 = exportDepsSummary(optionalGone, deps)
    expect(s1.ready).toBe(true)
    expect(s1.optionalMissing).toEqual(['pandoc'])
    const requiredGone = [{ name: 'python-docx', status: 1 as const, detail: 'missing' }]
    expect(exportDepsSummary(requiredGone, deps).ready).toBe(false)
  })
})
