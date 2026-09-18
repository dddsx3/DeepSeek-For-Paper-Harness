// W8.12 §七 零成本实验：把 B2 落盘的真实 E1 全文渲染进 10 章节骨架，
// 看"平庸但诚实"的初稿能不能读。**不改任何生产代码**——这是判定实验。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { renderPaperSkeleton } from '../../../packages/paper/paper-foundation/src/produce/paper-skeleton.ts'

const bodies = Object.values((JSON.parse(readFileSync(
  'apps/paper-shell/src/paper-shell-persist-bRWlDt/paper_artifact_body.json', 'utf8')) as {
  tables: { bodies: Record<string, { artifactId: string; text: string }> }
}).tables.bodies)
const e1 = bodies.find(b => b.artifactId.endsWith(':E1Analysis'))!.text

// --- 按 E1 自身的结构切分（它的 markdown 就是天然的分段） ---
const lines = e1.split('\n')
const section = (start: number, end: number): string => lines.slice(start, end).join('\n').trim()
const idx = (prefix: string): number => lines.findIndex(l => l.startsWith(prefix))

const iRoute = idx('## 总体路由判断')
const iQ1 = idx('## 问题 1')
const iQ2 = idx('## 问题 2')
const iQ3 = idx('## 问题 3')
const iQ4 = idx('## 问题 4')
const iSum = idx('## 汇总')

// 各问题的"模型"小节（### x.2/3 模型）
const modelOf = (qStart: number, qEnd: number): string => {
  const seg = lines.slice(qStart, qEnd)
  const m = seg.findIndex(l => /^###\s+\d\.\d?\s*(模型|具体结果)/.test(l))
  const v = seg.findIndex(l => /^###\s+\d\.\d?\s*验证/.test(l))
  if (m < 0) return ''
  return seg.slice(m, v > m ? v : undefined).join('\n').trim()
}
const verifyOf = (qStart: number, qEnd: number): string => {
  const seg = lines.slice(qStart, qEnd)
  const v = seg.findIndex(l => /^###\s+\d\.\d?\s*验证/.test(l))
  return v < 0 ? '' : seg.slice(v).join('\n').trim()
}

// 假设表：从 [[ASSUMPTION: id]] 行提取
const assumptions = lines
  .filter(l => l.trim().startsWith('[[ASSUMPTION:'))
  .map(l => {
    const m = /\[\[ASSUMPTION:\s*([^\]]+)\]\]\s*(.*)/.exec(l)!
    return { id: m[1]!.trim(), columns: [m[1]!.trim(), (m[2] ?? '').slice(0, 60) + '…', '未评定', '待检验'] }
  })

// 摘要：E1 没有摘要——用"汇总"节代替并如实标注（诚实标注是本实验的核心）
const summarySlot = [
  '> **W8.12 §七 实验标注**：本节由 E1 分析的「汇总」节代替——E1 未写摘要。',
  '> 这正是"E1 直通交付"需要解决的两个缺口之一（另一个是图表）。',
  '',
  section(iSum + 1, lines.length),
].join('\n')

const restatementSlot = [
  section(iRoute + 1, iQ1),
  '',
  '---',
  '',
  ...[iQ1, iQ2, iQ3, iQ4].map((s, i) => {
    const seg = lines.slice(s, [iQ2, iQ3, iQ4, iSum][i])
    const w = seg.findIndex(l => /问题真正在问什么/.test(l))
    const a = seg.findIndex(l => /假设/.test(l))
    return seg.slice(w, a > w ? a : undefined).join('\n').trim()
  }),
].join('\n')

const rendered = renderPaperSkeleton({
  title: '生产过程中的决策问题（E1 直通实验稿）',
  assumptions,
  slots: {
    abstract: summarySlot,
    restatement: restatementSlot,
    analysis: section(iRoute + 1, iQ1),
    model: [modelOf(iQ1, iQ2), modelOf(iQ2, iQ3), modelOf(iQ3, iQ4), modelOf(iQ4, iSum)].filter(Boolean).join('\n\n---\n\n'),
    validation: [verifyOf(iQ1, iQ2), verifyOf(iQ2, iQ3), verifyOf(iQ3, iQ4), verifyOf(iQ4, iSum)].filter(Boolean).join('\n\n---\n\n'),
    evaluation: '_(E1 未单独写模型评价；风险点见模型假设表与各节。本节待写入。)_',
  },
})

mkdirSync('artifacts/handoff/W8.12/experiment-output', { recursive: true })
writeFileSync('artifacts/handoff/W8.12/experiment-output/e1-direct-render.md', rendered)
console.log('rendered chars:', rendered.length, '(E1 was', e1.length, ')')
console.log('sections all present:', ['摘要','问题重述','问题分析','模型假设','符号说明','模型建立与求解','模型检验','模型评价','参考文献','代码附录'].every(t => rendered.includes('## ' + t)))
console.log('assumption rows:', assumptions.length)
// 占位符统计——"空壳"占比是可交付性的直接度量
const placeholders = (rendered.match(/_\(.*?\)_/g) ?? []).length
console.log('placeholder slots:', placeholders, 'of 10 sections')
