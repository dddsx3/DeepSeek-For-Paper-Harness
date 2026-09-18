// W9-E2 — M5 首个可用样本：真实 2024-C 附件数据 → 渲染 → 质检 → 图文件
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { figureRenderInput, renderFigureSvg } from '../../../packages/paper/paper-foundation/src/figure/renderer.ts'
import type { IrObjectRecord } from '../../../packages/paper/paper-foundation/src/ir/store.ts'
import { checkFigureQuality } from '../../../packages/paper/paper-foundation/src/figure/quality-check.ts'

const csv = readFileSync(new URL('./2024-C-attachment-1.csv', import.meta.url), 'utf8')
const store = new Map<string, IrObjectRecord>()
store.set('DA-PLOTS', {
  id: 'DA-PLOTS', runId: 'r1' as never, nodeId: null, kind: 'DataArtifact',
  mime: 'text/csv', size: csv.length, sha256: 'b'.repeat(64), storageKey: 'inline:b',
  value: {
    data_id: 'DA-PLOTS', role: 'INPUT_DATA',
    locator: 'file:///problems/2024-C/attachment-1.csv',
    content_hash: 'sha256:' + 'c'.repeat(64),
    media_type: 'text/csv', description: '2024-C 附件1 地块表（真实 xlsx 登记时转 CSV）',
  },
} as never)

const out = figureRenderInput(store, {
  data_refs: ['DA-PLOTS'],
  chart_type: 'bar',
  x_label: '地块',
  y_label: '地块面积/亩',
}, {
  readLedger: () => ({ media_type: 'text/csv', content: csv }),
  ledgerSeries: [{ x_column: '地块名称', y_column: '地块面积/亩', label: '地块面积' }],
})
if (!out.ok) throw new Error(out.reason)
const svg = renderFigureSvg(out.input)
mkdirSync(new URL('./figures', import.meta.url), { recursive: true })
writeFileSync(new URL('./figures/fig-plots-area.svg', import.meta.url), svg)
const violations = checkFigureQuality(svg)
console.log('=== M5 首个可用样本 ===')
console.log('data_hash:', out.data_hash)
console.log('svg bytes:', svg.length, '| ledger_sources:', JSON.stringify(out.input.ledger_sources))
console.log('print-quality violations:', violations.length, JSON.stringify(violations))
console.log('中文渲染: 图内含"地块面积"标签 →', svg.includes('面积'))
console.log('无 base64 内联 →', !svg.includes('base64'))
