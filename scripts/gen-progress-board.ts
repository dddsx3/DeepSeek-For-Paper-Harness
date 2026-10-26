/**
 * Progress board generator (PM-HANDBOOK §10).
 *
 * Regenerates ONLY the auto section of docs/PROGRESS.md (between the
 * PROGRESS_AUTO markers): HEAD, unpushed-commit count, design-debt status
 * counts parsed from docs/DESIGN-DEBTS.md, and the recent commit list.
 * The hand-written round log below the markers is never touched — every
 * round appends its own section there, so history stays append-only.
 *
 * Why a generator: hand-maintained dashboards rot. Debt statuses already
 * live in DESIGN-DEBTS.md (single source of truth); this script projects
 * them into one view instead of duplicating them.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const boardPath = resolve(root, 'docs/PROGRESS.md')
const debtsPath = resolve(root, 'docs/DESIGN-DEBTS.md')
const START = '<!-- board:auto:start -->'
const END = '<!-- board:auto:end -->'

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString()
  } catch (error) {
    return `(git ${args.join(' ')} failed: ${(error as Error).message.split('\n')[0]})`
  }
}

/** Classify one DESIGN-DEBTS table row by its first status-keyword cell. */
function classifyDebtRow(line: string): 'fixed' | 'mitigated' | 'open' | null {
  if (!line.startsWith('|')) return null
  const cells = line.split('|').map(cell => cell.trim())
  for (const cell of cells) {
    if (cell === '' || /^:?-{2,}:?$/.test(cell)) continue
    if (cell.includes('open')) return 'open'
    if (cell.includes('缓解')) return 'mitigated'
    if (cell.includes('已修')) return 'fixed'
  }
  return null
}

const debts = readFileSync(debtsPath, 'utf8').split('\n')
const counts = { fixed: 0, mitigated: 0, open: 0 }
for (const line of debts) {
  const status = classifyDebtRow(line)
  if (status !== null) counts[status] += 1
}
const total = counts.fixed + counts.mitigated + counts.open

const head = git(['log', '-1', '--format=%h %s']).trim()
const branch = git(['branch', '--show-current']).trim()
const unpushedRaw = git(['rev-list', '--count', 'origin/main..main']).trim()
const unpushed = /^\d+$/.test(unpushedRaw) ? unpushedRaw : '?'
const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length
const recent = git(['log', '--oneline', '-15'])
  .split('\n')
  .filter(Boolean)
  .map(line => `- \`${line}\``)
  .join('\n')

const auto = [
  START,
  `> 生成于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}（本地时间）· 由 \`pnpm run progress:board\` 再生成；本节之下为手写轮次日志（只增不删）。`,
  '',
  '| 指标 | 值 |',
  '|---|---|',
  `| 分支 / HEAD | \`${branch}\` @ \`${head}\` |`,
  `| 未推送提交 | ${unpushed}（常态应为 0，PM-HANDBOOK §7） |`,
  `| 工作树脏文件 | ${dirty}（收口前必须为 0，PM-HANDBOOK §7） |`,
  `| 设计债：已修 / 缓解 / open | ${counts.fixed} / ${counts.mitigated} / **${counts.open}**（共 ${total}，见 [DESIGN-DEBTS.md](./DESIGN-DEBTS.md)） |`,
  '',
  '### 最近提交（≤15）',
  '',
  recent,
  END,
  '',
].join('\n')

if (!existsSync(boardPath)) {
  writeFileSync(boardPath, [
    '# DPH 开发进度仪表盘',
    '',
    '> 自动区由脚本维护，手写区（轮次日志）每轮收口时由执行者追加一节——格式见 PM-HANDBOOK §10。',
    '',
    auto,
    '## 轮次日志（只增不删）',
    '',
  ].join('\n'), 'utf8')
  console.log('progress-board: created docs/PROGRESS.md')
  process.exit(0)
}

const board = readFileSync(boardPath, 'utf8')
const startAt = board.indexOf(START)
const endAt = board.indexOf(END)
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  console.error('progress-board: docs/PROGRESS.md is missing its auto markers — repair manually, refusing to overwrite.')
  process.exit(1)
}
writeFileSync(boardPath, board.slice(0, startAt) + auto + board.slice(endAt + END.length), 'utf8')
console.log(`progress-board: updated (${counts.fixed} fixed / ${counts.mitigated} mitigated / ${counts.open} open debts, ${unpushed} unpushed)`)
