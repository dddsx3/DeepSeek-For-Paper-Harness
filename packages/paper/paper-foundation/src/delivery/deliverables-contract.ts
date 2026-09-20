/**
 * DELIVERABLES contract — R1②（交付面固化）.
 *
 * 照搬参照档案（REF-C `DELIVERABLES.json`，路线书 §1.2 丙类）的 schema，
 * 并抽通用 `kind` 体系（闭集）。字段：
 *   - `file`      交付物相对路径（交付根为单位的相对路径）
 *   - `kind`      闭集：xlsx / json / md / other（REF-D 11 项实测即这四种）
 *   - `sheets`    （xlsx）必备工作表名
 *   - `min_rows` / `min_cols`  （xlsx）表的最小行列
 *   - `min_bytes` 最小字节数（REF-D 每项都有）
 *   - `desc`      人类可读描述
 *
 * 判定（fail-closed）：契约齐全时——
 *   - 缺文件  → `deliverable_missing`（阻断级：交付面不完整）
 *   - 字节不足 → `deliverable_too_small`（阻断级：空壳交付 = 假绿形态 1）
 *   - xlsx 的 rows/cols 目前没有机器读取器（诚实边界）→ 返回
 *     `xlsx_content_unverified` 非阻断注明，不外许诺"已检查"
 *   - 契约本身非闭集/缺 min_bytes → `contract_invalid`（契约错误，不猜）
 *
 * 诚实地板（NR-5 的负对照）：删掉契约要求的一个文件 → 校验必红
 * （`deliverable_missing`）。这是"交付完整度"指标可被变红的操作。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/deliverables-contract
 */

import { z } from 'zod'

/** Closed set of delivery kinds — grounded in REF-D's 11 items (v3 实测). */
export const DELIVERABLE_KINDS = ['xlsx', 'json', 'md', 'other'] as const
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number]

export const deliverablesContractSchema = z.object({
  deliverables: z
    .array(
      z
        .object({
          file: z.string().min(1),
          kind: z.enum(DELIVERABLE_KINDS),
          sheets: z.array(z.string()).optional(),
          min_rows: z.number().int().nonnegative().optional(),
          min_cols: z.number().int().nonnegative().optional(),
          min_bytes: z.number().int().nonnegative(),
          desc: z.string().optional(),
        })
        .strict(),
    )
    .min(1),
}).strict()

export type DeliverablesContract = z.infer<typeof deliverablesContractSchema>

/** One actually-present deliverable, as the checker sees it. */
export interface ActualDeliverable {
  readonly bytes: number
  /** Present for text-readable kinds (md/json/csv-style): line count. */
  readonly lines?: number
}

export interface DeliverablesFinding {
  readonly kind:
    | 'contract_invalid'            // contract violates the closed schema
    | 'deliverable_missing'         // contract item has no file on disk
    | 'deliverable_too_small'       // file exists but under min_bytes
    | 'xlsx_content_unverified'     // rows/cols of an xlsx not machine-read (honest note)
  readonly item: string
  readonly reason: string
}

/** Parse a contract; `null` when it violates the closed schema (contract_invalid). */
export function parseDeliverablesContract(
  raw: unknown,
): { ok: true; contract: DeliverablesContract } | { ok: false; issues: ReadonlyArray<string> } {
  const verdict = deliverablesContractSchema.safeParse(raw)
  if (!verdict.success) {
    const issues = verdict.error.issues.map((i) => {
      const at = i.path.length > 0 ? `${i.path.join('.')}: ` : ''
      return `${at}${i.message}`
    })
    return { ok: false, issues }
  }
  return { ok: true, contract: verdict.data }
}

/**
 * Verify an actual file set against a parsed contract. Fail-closed: a
 * missing item or an under-sized item is a finding; rows/cols on xlsx stay
 * an explicit "not machine-read yet" note rather than a silent pass or a
 * dishonest check.
 */
export function deliverablesContractFindings(
  contract: DeliverablesContract,
  actual: ReadonlyMap<string, ActualDeliverable>,
): ReadonlyArray<DeliverablesFinding> {
  const findings: DeliverablesFinding[] = []
  for (const item of contract.deliverables) {
    const present = actual.get(item.file)
    if (present === undefined) {
      findings.push({
        kind: 'deliverable_missing',
        item: item.file,
        reason: `contract requires '${item.file}' (${item.kind}, min ${item.min_bytes} bytes) but no such file is on disk`,
      })
      continue
    }
    if (present.bytes < item.min_bytes) {
      findings.push({
        kind: 'deliverable_too_small',
        item: item.file,
        reason: `'${item.file}' is ${present.bytes} bytes but the contract demands ≥ ${item.min_bytes} (a hollow deliverable is the shape-1 fake-green)`,
      })
    }
    if (item.kind === 'xlsx' && (item.min_rows !== undefined || item.min_cols !== undefined || item.sheets !== undefined)) {
      findings.push({
        kind: 'xlsx_content_unverified',
        item: item.file,
        reason: `'${item.file}' exists but its rows/cols/sheets are not machine-read yet (no xlsx reader in the checker; DO NOT count this as verified)`,
      })
    }
  }
  return findings
}
