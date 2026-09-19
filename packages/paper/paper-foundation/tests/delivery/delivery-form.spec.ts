/**
 * M-QUAL 阶段 C — delivery-form（E-5 交付形态闸）+ 与 requirement_coverage
 * 门的接线.
 *
 * 负对照直接取自 2026-A 的实测偏离（bench/quality/cumcm-2026-A/form-contract.json）：
 * 表头丢失（A1=None）、距离表头加后缀（'0.0cm'）、时间列写成 '1s'（int→string）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/delivery-form
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deliveryFormFindings, type DeliveryFormContract, type DeliveryFormManifestEntry } from '../../src/delivery/delivery-form.ts'

const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../bench/quality/cumcm-2026-A/form-contract.json', import.meta.url)), 'utf8'),
) as {
  contracts: DeliveryFormContract[]
  manifests: Record<string, DeliveryFormManifestEntry>
}

const LOCATOR = 'result1.xlsx!温度'

describe('delivery-form — 2026-A golden（E-5 抓"打开文件就能看见"的偏离）', () => {
  it('bad_delivered（参考 F3 major 实物形态）逐列表头名 mismatch 全部被抓住', () => {
    const findings = deliveryFormFindings(GOLDEN.contracts, [GOLDEN.manifests.bad_delivered!])
    const names = findings.filter(f => f.kind === 'form_header_name_mismatch')
    // 全部 4 列都漂移：col0 表头丢失（None），col1..3 加 'cm' 后缀改名。
    expect(names).toHaveLength(4)
    expect(names.some(f => f.reason.includes("'0.0cm'"))).toBe(true)
    expect(names.some(f => f.reason.includes("''"))).toBe(true)
  })

  it("names_fixed_time_string 抓住时间列的 int→string 漂移（'1s' 形态）", () => {
    const findings = deliveryFormFindings(GOLDEN.contracts, [GOLDEN.manifests.names_fixed_time_string!])
    const types = findings.filter(f => f.kind === 'form_header_type_mismatch')
    expect(types).toHaveLength(1)
    expect(types[0]?.reason).toContain('string')
    expect(types[0]?.reason).toContain('int')
  })

  it('corrected（与模板同构）零发现', () => {
    expect(deliveryFormFindings(GOLDEN.contracts, [GOLDEN.manifests.corrected!])).toHaveLength(0)
  })

  it('契约存在但清单缺该产物 → form_contract_missing', () => {
    const findings = deliveryFormFindings(GOLDEN.contracts, [{
      locator: 'result9.xlsx!sheet',
      columns: [],
      rows: 0,
    }])
    expect(findings[0]?.kind).toBe('form_contract_missing')
  })

  it('任一半缺席 → 零发现（检查未激活，不冒充已检查）', () => {
    expect(deliveryFormFindings(undefined, [GOLDEN.manifests.corrected!])).toHaveLength(0)
    expect(deliveryFormFindings(GOLDEN.contracts, undefined)).toHaveLength(0)
  })
})

describe('delivery-form — requirement_coverage 门接线', () => {
  it('form findings raise the requirement_coverage prefix via the gate registry', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const { backboneIr } = await import('../ir/fixtures.ts')
    const ir = backboneIr()
    const policy = buildDeliveryPolicy({
      mode: 'fast',
      ir,
      runtimeProfileValid: true,
      formChecks: { contracts: GOLDEN.contracts, manifest: [GOLDEN.manifests.bad_delivered!] },
    })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f =>
      f.reason.startsWith('requirement_coverage:BLOCKED:') && f.reason.includes('form_header_name_mismatch'),
    )).toBe(true)
  })

  it('without formChecks the historical verdict is unchanged', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const { backboneIr } = await import('../ir/fixtures.ts')
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: backboneIr(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('requirement_coverage:BLOCKED:'))).toBe(false)
  })

  it(`the golden contract binds ${LOCATOR} (跑题护栏：清单/契约定位符漂移即失败)`, () => {
    expect(GOLDEN.contracts[0]?.locator).toBe(LOCATOR)
  })
})
