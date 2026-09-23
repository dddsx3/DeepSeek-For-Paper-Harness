/**
 * 交付物的**防伪守卫**：非 CLEAN 的稿子必须带着它自己的标注。
 *
 * ## 它守的是什么
 *
 * `B-e1-direct`（兜底直通）交付的稿子看起来是一篇完整论文：有摘要、有章节、有数字、
 * 有结论、格式正确。**它唯一的防伪标记就是那段抬头**：
 *
 *   【交付状态：DEGRADED（降级交付，未规范核验）】
 *   【交付说明（诚实标注）】…结构化规范化（E2）未通过，故未经规范 IR 验证：
 *   数字、引用、图表均未逐条溯源。
 *
 * 实测（strict-11）：这样的稿子里出现了**伪造的验证结论**——结果章写
 * "情形(1)在 n=29, c₁=6 时第一类错误为 0.0473，满足不超过 5% 的要求"，而真值是
 * 0.0637（0.0473 对应的是 (27,6)）。**抬头一旦被剥掉，这稿子就变成了一份看起来
 * 经过验证、实际数字有错的论文。**
 *
 * ## 为什么要有运行时守卫，而不是只有测试
 *
 * 测试只能覆盖我今天想得到的导出路径。这个守卫在**每一次交付**上跑：只要档位不是
 * CLEAN，稿子里就必须能找到标记；找不到就**拒绝交付**，而不是导出一份没有防伪标记的
 * 成品。判据是"标记在不在"，不是"路径对不对"——它对未来新增的导出路径同样生效。
 *
 * @module @deepseek-ai/dsh-paper-shell/deliverable-guard
 */

/** 交付档位（与 executor 的 `renderTierBanner` 同一套标签）。 */
export type DeliverableGrade = 'CLEAN' | 'MARKED' | 'DEGRADED' | 'ESCALATE'

export interface HonestyGuardVerdict {
  /** 是否允许交付。 */
  readonly allowed: boolean
  /** 拒绝原因（allowed 为真时为空）。 */
  readonly reason: string
  /** 实际找到的标记（诊断用）。 */
  readonly found: ReadonlyArray<string>
}

/** 非 CLEAN 稿子必须携带的标记（任缺其一即拒绝交付）。 */
const REQUIRED_MARKERS: ReadonlyArray<{ readonly id: string; readonly probe: string }> = [
  { id: 'tier_banner', probe: '【交付状态：' },
]

/**
 * `B-e1-direct` 额外必须携带的标记——它是**未经规范 IR 验证**的那一类，
 * 抬头之外还要有一段逐字说明，否则读者只看到"降级"三个字，不知道降级意味着
 * "数字一个都没验证"。
 */
const E1_DIRECT_MARKERS: ReadonlyArray<{ readonly id: string; readonly probe: string }> = [
  { id: 'unverified_note', probe: '未经规范 IR 验证' },
]

/**
 * 检查交付正文是否带着它应有的标注。
 *
 * @param report - 最终交付正文（**已经**拼好抬头与附录的那一份）。
 * @param deliveryPath - 交付路径（`B-e1-direct` 触发额外判据）。
 * @param grade - 交付档位。
 * @returns 判定；不允许时给出可读原因。
 */
export function honestyGuard(
  report: string,
  deliveryPath: string,
  grade: DeliverableGrade,
): HonestyGuardVerdict {
  // CLEAN 是唯一允许"没有标注"的档位——它按定义就是核验通过的。
  if (grade === 'CLEAN') return { allowed: true, reason: '', found: [] }
  const required = [
    ...REQUIRED_MARKERS,
    ...(deliveryPath === 'B-e1-direct' ? E1_DIRECT_MARKERS : []),
  ]
  const found: string[] = []
  const missing: string[] = []
  for (const marker of required) {
    if (report.includes(marker.probe)) found.push(marker.id)
    else missing.push(marker.id)
  }
  if (missing.length === 0) return { allowed: true, reason: '', found }
  return {
    allowed: false,
    reason: `档位 ${grade}（路径 ${deliveryPath}）的交付稿缺少防伪标注：${missing.join('、')}。`
      + '这些标注是这份稿子**唯一**的可信度标记——被剥掉之后它看起来就是一篇经过验证的论文'
      + '（实测出现过伪造的验证结论）。拒绝交付，而不是导出一份没有标记的成品。',
    found,
  }
}
