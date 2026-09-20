/**
 * 无模型全链 dry-run — 证明"正式论文产出"的每个环节都真的接上了.
 *
 * 首次真实产出（用户裁决）不是测试，而是 baseline；因此在花掉那次机会
 * 之前，先用**零模型**的方式把链条从头走到尾：
 *
 *   1. 渲染器（真 renderer，非手写 markdown）产出 12 章主稿
 *   2. 图落盘（figures/<id>.svg）+ figure-manifest
 *   3. docx precheck（15 类，0 致命才允许导出）
 *   4. docx export（依赖探测 → 闸门 → scripts/export-docx.py 真导出）
 *   5. DELIVERABLES 契约 verify（docs/paper-deliverables-contract.json）
 *   6. 交付包 zip（混合文本 + 二进制 docx，确定性字节）
 *
 * 任一步失败即以非零退出并打印断点——这就是"链条断在哪"的机器答案。
 *
 * 用法：npx tsx artifacts/handoff/R5/paper-chain-dryrun.mts [outDir]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { renderReportV2 } from '../../../packages/paper/paper-foundation/src/produce/report-renderer.ts'
import { zipMixedFiles } from '../../../apps/paper-shell/src/zip.ts'

const repoRoot = resolve(import.meta.dirname, '../../..')
const outDir = resolve(process.argv[2] ?? join(repoRoot, 'artifacts/handoff/R5/dryrun-out'))
mkdirSync(join(outDir, 'figures'), { recursive: true })

const step = (n: number, name: string): void => console.log(`\n[${n}/6] ${name}`)
// Windows 上 npx 不是可执行文件（npx.cmd）——直接用 node + tsx 的 cli 入口，
// 避免 shell 依赖（实测：dry-run 第一次断在这里，而非链条本身）。
const TSX_CLI = join(repoRoot, 'node_modules/tsx/dist/cli.mjs')
const cli = (args: string[]): { status: number; out: string } => {
  try {
    const out = execFileSync(process.execPath, [TSX_CLI, join(repoRoot, 'apps/paper-shell/src/cli.ts'), ...args], {
      cwd: repoRoot, encoding: 'utf8', timeout: 600_000,
    })
    return { status: 0, out }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}\n${e.stderr ?? ''}` }
  }
}

// ---- 1. 渲染器产出 12 章主稿（真 renderer，数字来自 Result） ----
step(1, '渲染 12 章主稿（真 renderer）')
const rendered = renderReportV2({
  title: '抽样检验与生产决策问题',
  results: [
    { result_id: 'R-N1', name: '情形一最小样本量', value: 109, unit: '件', uncertainty: null },
    { result_id: 'R-C1', name: '情形一拒收临界值', value: 16, unit: '件', uncertainty: null },
  ],
  narrative: {
    title: '抽样检验与生产决策问题',
    conclusion: {
      claims: [
        { text: '情形一的最小样本量为 109 件。', quantity_refs: ['R-N1'] },
        { text: '对应的拒收临界值为 16 件。', quantity_refs: ['R-C1'] },
      ],
    },
    methods: '以精确二项分布构造单侧检验，按双方风险上界反解最小样本量：给定标称次品率与风险约束，逐样本量搜索满足接受数与拒收数的最优临界值，取两情形样本量的较大者作为统一方案。',
    restatement: '本题要求在抽样检验场景下设计检测次数尽可能少的抽样方案，并在此基础上对生产决策给出建议：先分别给出两种情形下的最小样本量与临界值，再给出统一方案与风险核算。',
    analysis: '问题可分为三层：问题分为三层来解，先定口径再求解再核校。第一层是单情形的最小样本量反解（离散搜索，临界值由风险上界确定）；第二层是两情形的统一化（取较严者）；第三层是把检验方案嵌入生产决策的成本收益核算。三层共用同一组符号与风险定义，避免口径漂移。',
    evaluation: '本方案的优点是判据可复算、风险可核算，边界条件清晰；本方案的优点是判据全部由题面给定风险上界机械导出，样本量与临界值可复算、可审计；局限在于假设次品率在批内恒定、检测无误差，若产线存在批次漂移或检测漏检，需要按分段或引入误检率重新求解。推广方向是把风险上界替换为代价函数，做贝叶斯化的最优停止。',
    references: '[1] 作者甲. 抽样检验方法. 2026.\n[2] 作者乙. 生产决策模型. 2026.',
    code: [
      '求解代码（运行记录节选）：',
      '',
      '```js',
      'function binomCdf(k, n, p) { let c = 1, s = 0; for (let i = 0; i <= k; i += 1) { if (i > 0) c = c * (n - i + 1) / i; s += c * Math.pow(p, i) * Math.pow(1 - p, n - i); } return s; }',
      'let n = 1; while (true) { const c = Math.ceil(n * p0 + z * Math.sqrt(n * p0 * (1 - p0)) - 1e-9); if (1 - binomCdf(c - 1, n, p0) <= alpha) break; n += 1; }',
      '```',
      '',
      '输出 result.json 供结果表回读（code → jsonPath → Result，数字零人工转录）。',
    ].join('\n'),
  },
  skeletonRows: {
    symbols: [
      { id: 'SYM-n', columns: ['n', '样本量', '件'] },
      { id: 'SYM-c', columns: ['c', '拒收临界值', '件'] },
    ],
    assumptions: [{ id: 'A-IID', columns: ['次品相互独立', 'GIVEN', 'MEDIUM', '是'] }],
    requirements: [{ id: 'R-OUT', columns: ['设计最小样本量抽样方案', '问题 1'] }],
  },
  figures: [
    { figureId: 'F-N', caption: '最小样本量与风险的关系', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#f7f7f7"/><text x="12" y="30">risk vs n</text></svg>', data_hash: 'sha256:dryrun', resultRefs: ['R-N1'], rendererVersion: 'okabe-ito-v1/svg' },
  ],
  dataFiles: [{ id: 'result.json', columns: ['result.json'] }],
})
if (!rendered.ok) {
  console.error(`断点 1：渲染被拒 — ${rendered.code}: ${rendered.reason}`)
  process.exit(1)
}
const reportText = rendered.text + '\n\n[1] 作者甲. 抽样检验方法. 2026.\n'
writeFileSync(join(outDir, 'report.md'), reportText, 'utf8')
writeFileSync(join(outDir, 'figures/F-N.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#f7f7f7"/><text x="12" y="30">risk vs n</text></svg>', 'utf8')
const svgSha = createHash('sha256').update(readFileSync(join(outDir, 'figures/F-N.svg'))).digest('hex')
writeFileSync(join(outDir, 'figure-manifest.json'), JSON.stringify({ figures: [{ file: 'figures/F-N.svg', sha256: svgSha, renderer_version: 'okabe-ito-v1/svg' }] }, null, 2), 'utf8')
writeFileSync(join(outDir, 'result.json'), JSON.stringify({ n1: 109, c1: 16 }), 'utf8')
writeFileSync(join(outDir, 'run-report.json'), JSON.stringify({
  runId: '<dry-run>',
  delivery_path: 'A-produce-chain',
  tier: 'T1', mode: 'strict', status: 'DELIVERED', grade: 'CLEAN',
  routed_family: 'F1', route_truth: 'F1', route_mismatch: false,
  code_provenance: { ok: true, checked_at: '<dry-run>', targets: [{ name: '@deepseek-ai/dsh-paper-foundation', ok: true, detail: 'dry-run' }] },
  minted_ir_count: 12,
  wall_clock_seconds: 0,
  sha256: 'dry-run',
  audit: 'workflow_started,ir_entry_written,final_output_written,promotion_succeeded,workflow_completed',
  usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  attachments: [],
  figures: 1,
  figure_links_broken: [],
}, null, 2), 'utf8')
const sections = (reportText.match(/^## /gm) ?? []).length
console.log(`  ✓ report.md ${reportText.length} 字符，章节 ${sections} 个；figures/F-N.svg + figure-manifest.json 已写出`)

// ---- 2. precheck（0 致命才允许导出） ----
step(2, 'docx precheck（15 类机械检查）')
const pre = cli(['docx', 'precheck', join(outDir, 'report.md'), join(outDir, 'figures')])
console.log(pre.out.trim().split('\n').slice(-3).join('\n'))
if (pre.status !== 0) { console.error('断点 2：预检拒绝导出（见上）'); process.exit(1) }

// ---- 3. docx export（依赖 → 闸门 → 真导出器） ----
step(3, 'docx export（依赖探测 → 闸门 → export-docx.py）')
const exp = cli(['docx', 'export', join(outDir, 'report.md'), join(outDir, 'figures'), join(outDir, 'paper.docx')])
console.log(exp.out.trim().split('\n').slice(-4).join('\n'))
if (exp.status !== 0) { console.error('断点 3：docx 导出失败'); process.exit(1) }

// ---- 4. DELIVERABLES 契约 verify ----
step(4, 'DELIVERABLES 契约 verify')
const ver = cli(['deliverables', 'verify', join(repoRoot, 'docs/paper-deliverables-contract.json'), outDir])
console.log(ver.out.trim().split('\n').slice(-2).join('\n'))
if (ver.status !== 0) { console.error('断点 4：交付契约不完整'); process.exit(1) }

// ---- 5. 交付包 zip（文本 + 二进制 docx） ----
step(5, '交付包 zip（含二进制 docx）')
const figures = readdirSync(join(outDir, 'figures')).sort()
const zip = zipMixedFiles({
  'report.md': reportText,
  'run-report.json': readFileSync(join(outDir, 'run-report.json'), 'utf8'),
  'figure-manifest.json': readFileSync(join(outDir, 'figure-manifest.json'), 'utf8'),
  'result.json': readFileSync(join(outDir, 'result.json'), 'utf8'),
  'paper.docx': readFileSync(join(outDir, 'paper.docx')),
  ...Object.fromEntries(figures.map(f => [`figures/${f}`, readFileSync(join(outDir, 'figures', f))])),
})
writeFileSync(join(outDir, 'deliverable.zip'), zip)
const zipSha = createHash('sha256').update(zip).digest('hex')
console.log(`  ✓ deliverable.zip ${zip.length} bytes，sha256=${zipSha.slice(0, 16)}…（成员 ${6 + figures.length} 个，含 docx 二进制）`)

// ---- 6. 汇总 ----
step(6, '汇总')
const docxSize = statSync(join(outDir, 'paper.docx')).size
console.log(`  ✓ 链条全通：report.md → precheck → paper.docx(${docxSize}B) → 契约 verify → zip(${zip.length}B)`)
console.log(`  产物目录：${outDir}`)
