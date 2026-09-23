/**
 * 交付物防伪守卫 —— **非 CLEAN 的稿子必须带着它自己的标注**。
 *
 * ## 为什么这条测试重要
 *
 * `B-e1-direct` 交付的稿子看起来就是一篇完整论文：有摘要、有章节、有数字、有结论、
 * 格式正确。**它唯一的防伪标记是那段抬头。**
 *
 * 实测（strict-11）里这样的稿子出现了**伪造的验证结论**：结果章写"情形(1)在
 * n=29, c₁=6 时第一类错误为 0.0473，满足不超过 5% 的要求"——真值 0.0637
 * （0.0473 对应的是 (27,6)）。抬头一旦被剥掉，它就是一份**看起来经过验证、
 * 实际数字有错**的论文。
 *
 * 守卫的判据是"标记在不在"，不是"导出路径对不对"——这样它对未来新增的导出路径
 * 同样生效。
 */

import { describe, expect, it } from 'vitest'
import { honestyGuard } from '../src/deliverable-guard.ts'

const BANNER = '【交付状态：DEGRADED（降级交付，未规范核验）】\n本次运行共检出 68 项问题。'
const E1_NOTE = '【交付说明（诚实标注）】…结构化规范化（E2）未通过，故未经规范 IR 验证：数字、引用、图表均未逐条溯源。'

describe('交付物防伪守卫', () => {
  it('CLEAN 是唯一允许没有标注的档位（它按定义就是核验通过的）', () => {
    const verdict = honestyGuard('# 论文\n正文。', 'A-produce-chain', 'CLEAN')
    expect(verdict.allowed).toBe(true)
  })

  it('E1 直通稿带齐两段标记 → 放行', () => {
    const verdict = honestyGuard(`# 论文\n\n${BANNER}\n\n${E1_NOTE}\n\n正文。`, 'B-e1-direct', 'DEGRADED')
    expect(verdict.allowed).toBe(true)
    expect(verdict.found).toContain('tier_banner')
    expect(verdict.found).toContain('unverified_note')
  })

  it('**抬头被剥掉 → 拒绝交付**（这是它存在的全部理由）', () => {
    const verdict = honestyGuard(`# 论文\n\n${E1_NOTE}\n\n正文。`, 'B-e1-direct', 'DEGRADED')
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain('tier_banner')
  })

  it('E1 直通稿只剩抬头、缺"未经规范 IR 验证"说明 → 也拒绝', () => {
    // 只看到"降级"三个字，读者不知道降级意味着"数字一个都没验证"。
    const verdict = honestyGuard(`# 论文\n\n${BANNER}\n\n正文。`, 'B-e1-direct', 'DEGRADED')
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain('unverified_note')
  })

  it('MARKED（产线链）只需要抬头，不要求 E1 直通那句说明', () => {
    expect(honestyGuard(`# 论文\n\n${BANNER}\n\n正文。`, 'A-produce-chain', 'MARKED').allowed).toBe(true)
    expect(honestyGuard('# 论文\n\n正文。', 'A-produce-chain', 'MARKED').allowed).toBe(false)
  })

  it('ESCALATE（未完成包）同样受守卫约束', () => {
    expect(honestyGuard('# 论文\n\n正文。', 'A-produce-chain', 'ESCALATE').allowed).toBe(false)
  })

  it('拒绝原因里写明"为什么这不是小事"（读者据此判断严重性）', () => {
    const verdict = honestyGuard('正文。', 'B-e1-direct', 'DEGRADED')
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain('防伪标注')
    expect(verdict.reason).toContain('拒绝交付')
  })

  it('未知路径 + 非 CLEAN：只按抬头判（守卫不依赖路径枚举）', () => {
    // 这一条钉的是"判据是标记在不在，不是路径对不对"——新增导出路径不必改守卫。
    expect(honestyGuard(`# 论文\n\n${BANNER}`, 'A-something-new', 'MARKED').allowed).toBe(true)
    expect(honestyGuard('# 论文', 'A-something-new', 'MARKED').allowed).toBe(false)
  })
})
