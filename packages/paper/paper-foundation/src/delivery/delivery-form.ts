/**
 * Delivery-form check — M-QUAL 阶段 C（GATE-MAPPING 扩展点 E-5）.
 *
 * 把"交付文件形态"从 REQUIRED_OUTPUT 的**存在性**计数（A7 v0）细化到
 * **表头 / 列数据类型 / 行数**断言。抓的是"打开文件就能看见"的偏离——参考
 * 工作流 2026-A 的 F3 major：模板 `A1='时间\到药材中心的距离'`（int 时间列）
 * 交付为 `None` 表头 + `'1s'` 字符串时间列，与建模质量无关、却让稿子交不
 * 出去。落点是 `requirement_coverage` 门（既有 id）的语义细化，不新增
 * gate id（N4）。
 *
 * 两个输入都是**闭集数据**，不是散文：
 *   - **契约**（`DeliveryFormContract`）：题面模板的机械投影——每列的
 *     表头文本与**数据单元格**类型（时间列 int、距离列 float…），由
 *     composition 从题面事实/格式参考注册；
 *   - **清单**（`DeliveryFormManifestEntry`）：run 实际产出的形态
 *     （composition 从被 ExecutionRecord `output_hash` 覆盖的真实输出
 *     字节解析；xlsx 的抽取由 composition 的 Python 侧完成）。
 *
 * 比较是**按位置**的：产出文件第 i 列的表头文本必须等于契约第 i 列、
 * 该列的数据类型必须一致（2026-A 的偏离全部是位置性的——表头丢失、
 * 类型漂移、加后缀）。
 *
 * 诚实边界：本模块不解析 xlsx/二进制。契约或清单任一缺席 → 零发现
 * （检查未激活在 PASS 理由中可见，不冒充已检查）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/delivery-form
 */

/** Closed set of column data types a form contract may demand. */
export const DELIVERY_FORM_COLUMN_TYPES = ['int', 'float', 'string'] as const
export type DeliveryFormColumnType = (typeof DELIVERY_FORM_COLUMN_TYPES)[number]

export interface DeliveryFormColumn {
  /** The header cell text the template declares ('' = 无表头). */
  readonly name: string
  /** The DATA type the column's cells carry (int 时间列 / float 距离列). */
  readonly type: DeliveryFormColumnType
}

export interface DeliveryFormContract {
  /** The output locator the contract binds to (exact match on the manifest). */
  readonly locator: string
  /** Expected columns, in order (header text + data-cell type). */
  readonly columns: ReadonlyArray<DeliveryFormColumn>
  /** Minimum data-row count (the rows the deliverable must fill). */
  readonly minRows: number
}

export interface DeliveryFormManifestEntry {
  readonly locator: string
  /** The columns the produced file actually carries, in order. */
  readonly columns: ReadonlyArray<DeliveryFormColumn>
  readonly rows: number
}

export interface DeliveryFormFinding {
  readonly kind:
    | 'form_contract_missing'
    | 'form_header_missing'
    | 'form_header_name_mismatch'
    | 'form_header_type_mismatch'
    | 'form_header_extra'
    | 'form_rows_below_min'
  readonly locator: string
  readonly reason: string
}

/**
 * Compare the produced form manifest against the template contract.
 * Pure, total; positional per the module header.
 */
export function deliveryFormFindings(
  contracts: ReadonlyArray<DeliveryFormContract> | undefined,
  manifest: ReadonlyArray<DeliveryFormManifestEntry> | undefined,
): ReadonlyArray<DeliveryFormFinding> {
  if (contracts === undefined || contracts.length === 0 || manifest === undefined || manifest.length === 0) {
    return []
  }
  const findings: DeliveryFormFinding[] = []
  const byLocator = new Map(manifest.map(entry => [entry.locator, entry]))
  for (const contract of contracts) {
    const produced = byLocator.get(contract.locator)
    if (produced === undefined) {
      findings.push({
        kind: 'form_contract_missing',
        locator: contract.locator,
        reason: `no produced form manifest for '${contract.locator}' — the deliverable the template demands never carried a form (E-5, X-1)`,
      })
      continue
    }
    for (let i = 0; i < contract.columns.length; i += 1) {
      const expected = contract.columns[i]
      const actual = produced.columns[i]
      if (expected === undefined) continue
      if (actual === undefined) {
        findings.push({
          kind: 'form_header_missing',
          locator: contract.locator,
          reason: `column ${i}: header '${expected.name}' is absent from the produced file (2026-A 的表头丢失形态, X-1)`,
        })
        continue
      }
      if (actual.name !== expected.name) {
        findings.push({
          kind: 'form_header_name_mismatch',
          locator: contract.locator,
          reason: `column ${i}: header is '${actual.name}' but the template declares '${expected.name}' (后缀/改名/丢失漂移, X-1)`,
        })
        continue
      }
      if (actual.type !== expected.type) {
        findings.push({
          kind: 'form_header_type_mismatch',
          locator: contract.locator,
          reason: `column ${i} ('${expected.name}'): produced cells are ${actual.type} but the template declares ${expected.type} (2026-A 的"时间列写成 '1s'"形态, X-1)`,
        })
      }
    }
    if (produced.columns.length > contract.columns.length) {
      findings.push({
        kind: 'form_header_extra',
        locator: contract.locator,
        reason: `produced file carries ${produced.columns.length} columns but the template declares ${contract.columns.length} (X-1)`,
      })
    }
    if (produced.rows < contract.minRows) {
      findings.push({
        kind: 'form_rows_below_min',
        locator: contract.locator,
        reason: `produced file has ${produced.rows} data rows but the template demands >= ${contract.minRows} (X-1)`,
      })
    }
  }
  return findings
}
