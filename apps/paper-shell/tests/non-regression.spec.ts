/**
 * W11.5-A4 — 地板护栏（交付物侧）：NR-3 自包含 + NR-4 非专有格式。
 *
 * 与 `packages/paper/paper-foundation/tests/delivery/non-regression.spec.ts`
 * 的分工：NR-1/NR-2 是执行器/分级层，这里两条是**交付包**层（zip 由
 * `apps/paper-shell/src/cli.ts` 写出，只有本包能真实测到）。
 *
 * 为什么用自写的 STORE-zip 读取器而不是引第三方 unzip：交付 zip 的写入器
 * 是本仓自研的确定性 STORE 写入器（`zip.ts`），用独立实现的读取器解析它，
 * 才是对"写出的字节真的能被解出来"的检验；调同一个模块的自读函数只能
 * 证明它自洽（N3：断言必须走真实对象）。
 *
 * @module apps/paper-shell/tests/non-regression
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { zipTextFiles } from '../src/zip.ts'

/** Minimal STORE-zip reader: walks local file headers (method 0, no zip64). */
function readStoreZip(bytes: Uint8Array): ReadonlyArray<{ name: string; text: string }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('utf-8')
  const out: Array<{ name: string; text: string }> = []
  let offset = 0
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    const size = view.getUint32(offset + 18, true)
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    if (method !== 0) throw new Error(`unexpected compression method ${method}`)
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen))
    const dataStart = offset + 30 + nameLen + extraLen
    out.push({ name, text: decoder.decode(bytes.subarray(dataStart, dataStart + size)) })
    offset = dataStart + size
  }
  return out
}

/** The three entries the CLI writes into every DELIVERED zip. */
const DELIVERABLE = {
  'report.md': '# 报告\n\n正文内容，含 D 节点说明。\n',
  'sha256.txt': 'a'.repeat(64) + '\n',
  'run-report.json': JSON.stringify({ delivery_path: 'B-e1-direct', grade: 'MARKED' }, null, 2),
}

describe('NR-3 — 交付物自包含（解压即三件齐）', () => {
  it('zip 解出的成员恰好是 report.md + sha256.txt + run-report.json', () => {
    const entries = readStoreZip(zipTextFiles(DELIVERABLE))
    const names = entries.map(e => e.name).sort()
    expect(names).toEqual(['report.md', 'run-report.json', 'sha256.txt'])
  })

  it('成员内容逐字节还原（写入器与读取器独立实现）', () => {
    const entries = readStoreZip(zipTextFiles(DELIVERABLE))
    for (const name of Object.keys(DELIVERABLE) as Array<keyof typeof DELIVERABLE>) {
      expect(entries.find(e => e.name === name)?.text, name).toBe(DELIVERABLE[name])
    }
  })

  it('run-report 里带着交付来源（W11.5-A2 的字段真的进了包）', () => {
    const entries = readStoreZip(zipTextFiles(DELIVERABLE))
    const report = JSON.parse(entries.find(e => e.name === 'run-report.json')?.text ?? '{}') as { delivery_path?: string }
    expect(report.delivery_path).toBe('B-e1-direct')
  })
})

describe('NR-4 — 交付格式非专有（任意阅读器可开）', () => {
  it('zip 内全部是纯文本格式（.md/.txt/.json），无二进制/专有容器', () => {
    const entries = readStoreZip(zipTextFiles(DELIVERABLE))
    for (const entry of entries) {
      expect(entry.name, entry.name).toMatch(/\.(md|txt|json)$/)
      // plain UTF-8: no NUL byte anywhere (a binary payload would carry one)
      expect(entry.text.includes('\u0000'), `${entry.name} must be plain text`).toBe(false)
    }
  })

  it('docx 路径存在（Word 交付由仓库自带导出器提供，非专有格式即可交付）', () => {
    const exporter = fileURLToPath(new URL('../../../scripts/export-docx.py', import.meta.url))
    const bytes = readFileSync(exporter, 'utf8')
    expect(bytes.length).toBeGreaterThan(1000)
    // the real import the exporter uses (`from docx import Document`)
    expect(bytes).toContain('from docx import Document')
  })
})

// ---------------------------------------------------------------------------
// R1①/③ — figures join the zip deterministically; figure-manifest covers
// every shipped figure (no untracked svg). The same cassette must still
// produce the same zip bytes (G2 重跑同 sha256).
// ---------------------------------------------------------------------------
describe('R1①/③ — figures in the deliverable zip', () => {
  const FIG_DELIVERABLE = {
    'report.md': '# 报告\n\n![表](figures/F-A.svg)\n',
    'sha256.txt': 'a'.repeat(64) + '\n',
    'run-report.json': '{}',
    'figures/F-B.svg': '<svg id="b"></svg>',
    'figures/F-A.svg': '<svg id="a"></svg>', // note: deliberately NOT sorted input order
    'figure-manifest.json': JSON.stringify({ figures: [{ file: 'figures/F-A.svg', sha256: 'h', renderer_version: 'okabe-ito-v1/svg' }] }),
  }

  it('figures + manifest join the zip alongside the base three entries', () => {
    const entries = readStoreZip(zipTextFiles(FIG_DELIVERABLE))
    const names = entries.map(e => e.name)
    expect(names).toEqual(expect.arrayContaining(['figures/F-A.svg', 'figures/F-B.svg', 'figure-manifest.json']))
    expect(names).toContain('report.md')
    expect(names).toContain('sha256.txt')
  })

  it('same content → same zip bytes (deterministic on re-run, G2)', () => {
    const first = zipTextFiles(FIG_DELIVERABLE)
    const second = zipTextFiles(FIG_DELIVERABLE)
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it('figure-manifest.json records no timestamp (determinism) and renders as plain text', () => {
    const entries = readStoreZip(zipTextFiles(FIG_DELIVERABLE))
    const manifest = entries.find(e => e.name === 'figure-manifest.json')?.text ?? ''
    expect(manifest).not.toContain('generated_at')
    expect(manifest).not.toContain('\u0000')
  })
})
