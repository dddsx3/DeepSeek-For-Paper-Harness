/**
 * **非阻断审计观察的归宿** —— 把"通过审计的阶段里提出、却没有拦住交付"的 findings
 * 收成一份可交付的台账（`AUDIT-OBSERVATIONS.{json,md}`）。
 *
 * ## 为什么需要它（缺的是一条消费路径，不是一条判据）
 *
 * 项目铁律是"**检出到的每个问题都必须有归宿**：修掉 / 显式接受并写进已知缺陷表"。
 * 但 `_audit.json` 全仓只有一处读取点：`runner.ts` 的 `priorAuditFindings()`——
 * 它只在**重跑**时把 findings 拼回简报。于是通过审计的阶段（实测 `pass 0.80`、
 * 4 条 findings）那 4 条既不影响放行，也**不进最终交付的已知缺陷表**：
 * 只躺在阶段目录与通行证里，谁也不会再看它一眼。
 *
 * 本模块补的就是这条消费路径：
 * - **通过**的阶段 → 它的 findings 是"accepted observations"，收进台账；
 * - **未通过**的阶段 → findings 已经通过 DRIFT 回灌进下一轮简报（同一份
 *   `priorAuditFindings()`），在台账里再列一遍只会重复记账。
 *
 * ## 只读盘、不抛错
 *
 * 这是交付末尾的记账步骤，不是门禁：任何一个阶段的审计文件缺失/损坏，都只影响
 * "这一阶段的观察没进台账"，不该让整条链的结论翻成失败。所以读不到、解析不了
 * 一律跳过（计入 `withoutAudit`，让缺口感而不见而不是无声无息）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/audit-collector
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 审计结论的文件名。
 *
 * 与 `runner.ts` 的 `AUDIT_FILE` 是同一个字面量。这里**不 import** 它：collector 是
 * 只读盘的小模块，import runner 会把整条阶段链（门禁/简报/执行体）拖进它的依赖图，
 * 一个纯读文件的测试就会跟着门禁改动一起红。两处字面量由
 * `tests/architecture/audit-collector.spec.ts` 与 runner 的实际写盘路径共同钉住。
 */
const AUDIT_FILE = '_audit.json'

/**
 * 输入目录名：`stages/00-input/` 是题面与附件的落点，**不是阶段**。
 *
 * 不排除它的话，每个运行都会凭空多出一个"没有审计结论的阶段"，台账的
 * `withoutAudit` 从此永久偏大一。
 */
const INPUT_DIR = '00-input'

/** 一条被显式接受的审计观察（严重度保留审计员的原话）。 */
export interface AuditObservationFinding {
  readonly severity: 'fatal' | 'major' | 'minor'
  readonly where: string
  readonly issue: string
  readonly fix: string
}

/** 一个**通过**审计的阶段及其观察。 */
export interface StageAuditObservation {
  /** 阶段目录名（`01-prob-analysis` 形态）——与磁盘上的位置一一对应。 */
  readonly stage: string
  readonly score: number
  readonly verdict: 'pass' | 'fail'
  readonly findings: ReadonlyArray<AuditObservationFinding>
}

/** 收集结果（纯数据；写盘与渲染由调用方决定）。 */
export interface StageAuditObservations {
  /** 只含 `verdict === 'pass'` 的阶段（未通过阶段的 findings 走 DRIFT 回灌）。 */
  readonly stages: ReadonlyArray<StageAuditObservation>
  /** 非阻断观察总条数（各阶段 findings 之和）。 */
  readonly total: number
  /**
   * **没有可用审计结论**的阶段数（审计文件缺失、损坏、或字段不合法）。
   *
   * 它与 `stages` 是互补的：`stages.length + withoutAudit` 加上"有结论但未通过"
   * 的阶段 = 扫到的全部阶段目录。留这个数是为了让"这一轮有多少阶段根本没被审"
   * 在台账上看得见（确定性阶段本来就该在这里）。
   */
  readonly withoutAudit: number
}

/** 落盘文档：收集结果 + 生成时间。 */
export interface AuditObservationsDocument extends StageAuditObservations {
  readonly generatedAt: string
}

/** 解析后的审计结论（只保留台账用得到的三个字段）。 */
interface ParsedAudit {
  readonly verdict: 'pass' | 'fail'
  readonly score: number
  readonly findings: ReadonlyArray<AuditObservationFinding>
}

/**
 * 扫描 `stages/<阶段目录>/_audit.json`，收集**通过审计的阶段**的非阻断观察。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns 通过阶段的观察、总条数、无审计结论的阶段数（永不抛错）。
 */
export async function collectStageAuditObservations(stagesRoot: string): Promise<StageAuditObservations> {
  // 根目录读不到 = 链还没产出任何阶段：返回空台账，不抛错（这是记账，不是门禁）。
  const entries = await readdir(stagesRoot, { withFileTypes: true }).catch(() => [])
  const stages: StageAuditObservation[] = []
  let withoutAudit = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === INPUT_DIR) continue
    const audit = await readAuditFile(join(stagesRoot, entry.name, AUDIT_FILE))
    if (audit === null) {
      withoutAudit += 1
      continue
    }
    // 未通过的阶段不收集：它的 findings 已经进了下一轮简报（DRIFT 回灌）。
    if (audit.verdict !== 'pass') continue
    stages.push({ stage: entry.name, score: audit.score, verdict: audit.verdict, findings: audit.findings })
  }
  return {
    stages,
    total: stages.reduce((sum, stage) => sum + stage.findings.length, 0),
    withoutAudit,
  }
}

/**
 * 读一个 `_audit.json`；读不到 / 坏 JSON / 字段不合法一律返回 null（跳过，不抛错）。
 *
 * @param path - 审计结论文件的绝对路径。
 * @returns 解析结果；不可用时为 null。
 */
async function readAuditFile(path: string): Promise<ParsedAudit | null> {
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 坏文件只影响"这一阶段的观察没进台账"——不让它把整条链的记账掀翻。
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const verdict = obj['verdict']
  if (verdict !== 'pass' && verdict !== 'fail') return null
  const score = obj['score']
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  return { verdict, score, findings: findingsOf(obj['findings']) }
}

/**
 * 把审计的 `findings` 数组规整成台账行。
 *
 * 与 `runner.ts` 的 `priorAuditFindings()` 同一条口径：**没有 issue 的 finding 丢掉**
 * （台账回答的是"要修什么"，一行没有问题的记录没有归宿）。字段缺省时给可读的占位，
 * 而不是留空——空单元格会让人以为审计员写的是空字符串。
 *
 * @param raw - 审计 JSON 里的 `findings`（类型未知）。
 * @returns 规整后的观察清单。
 */
function findingsOf(raw: unknown): ReadonlyArray<AuditObservationFinding> {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): ReadonlyArray<AuditObservationFinding> => {
    if (typeof item !== 'object' || item === null) return []
    const o = item as Record<string, unknown>
    const issue = typeof o['issue'] === 'string' ? o['issue'].trim() : ''
    if (issue === '') return []
    const severity = o['severity']
    return [{
      severity: severity === 'fatal' || severity === 'major' || severity === 'minor' ? severity : 'minor',
      where: typeof o['where'] === 'string' && o['where'] !== '' ? o['where'] : '（未指明位置）',
      issue,
      fix: typeof o['fix'] === 'string' && o['fix'] !== '' ? o['fix'] : '（审计员未给具体改法）',
    }]
  })
}

/**
 * 渲染交付台账（中文 Markdown）。
 *
 * 表头一句话必须说清这些条目的性质：它们是**通过审计时被显式接受的观察**，
 * 不是漏掉的问题——否则读者会以为"审计通过了却还有 fatal，是不是审计失效了"。
 *
 * @param doc - 收集结果 + 生成时间。
 * @returns Markdown 全文（以换行结尾）。
 */
export function renderAuditObservationsMarkdown(doc: AuditObservationsDocument): string {
  const L: string[] = []
  L.push('# 审计观察（非阻断）')
  L.push('')
  L.push('> 本文件是**交付台账**的一部分：记录**通过审计的阶段**里，审计员提出、'
    + '但没有阻断交付的观察（accepted non-blocking observations）。')
  L.push('> 未通过审计的阶段的 findings 已经通过回灌（DRIFT）进入下一轮简报，不在此重复。')
  L.push('')
  L.push(`生成时间：${doc.generatedAt}`)
  L.push('')
  L.push(`通过审计的阶段：${String(doc.stages.length)} 个；非阻断观察：${String(doc.total)} 条；`
    + `无审计结论的阶段：${String(doc.withoutAudit)} 个（确定性阶段，或审计没跑成）。`)
  L.push('')
  if (doc.total === 0) {
    L.push('本轮没有非阻断观察。')
    return L.join('\n') + '\n'
  }
  L.push('| 阶段 | 质量分 | 严重度 | 位置 | 问题 | 建议改法 |')
  L.push('|---|---|---|---|---|---|')
  for (const stage of doc.stages) {
    for (const f of stage.findings) {
      L.push(`| ${cell(stage.stage)} | ${stage.score.toFixed(2)} | ${f.severity} | `
        + `${cell(f.where)} | ${cell(f.issue)} | ${cell(f.fix)} |`)
    }
  }
  return L.join('\n') + '\n'
}

/** 表格单元转义：竖线会截断列，换行会把一行拆成两行。 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}
