/**
 * W12-C3 —— **E2 必须拿到正文契约**。
 *
 * ## 它守的缺陷（热重启检查点实测）
 *
 * `artifacts/upper-bound/2024B-hot-1/CHECKPOINT-02-declare.md`：模型是在 **E2 那一通
 * 调用里**写 `narrative` 的——那八章**就是论文正文**。而 E2 的 prompt 此前只有
 * 「宪法 + E1」：宪法要求"八章非空字符串"，却**没有**篇幅地板、没有"参考文献 ≥3 条
 * 且至少一条含方法关键词"、没有"评价章四要素"。那三条只写在 `paper-contract` 里，
 * 由 `produce` 步骤简报内联，而那份简报**只挂在单发路径的 EXECUTE prompt 上**。
 *
 * 后果：模型写出 49 字的"模型评价与推广"、一份没有方法关键词的参考文献表，
 * 然后被产出链以 `prose_contract` 拒掉——**历轮反复出现**。
 * 那不是模型的缺陷，是交付链路的缺陷：**要求写在 A 处、执行在 B 处**。
 *
 * 这条测试钉住"E2 的 prompt 里必须有正文契约"，而不是钉住某一句措辞。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { e2NormalizationPrompt } from '../../src/produce/e1-e2.ts'
import { stepBriefing } from '../../src/knowledge/skill-library.ts'
import { PAPER_CONSTITUTION } from '../../src/knowledge/constitution.ts'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(here, '..', '..', 'src', 'executor.ts'), 'utf8')

describe('W12-C3 — E2 的正文契约', () => {
  it('produce 简报里确实含正文契约（篇幅地板 / 参考文献规则 / 评价四要素）', () => {
    const briefing = stepBriefing('produce', { target: 't', upstream: 'u', done: 'd' })
    // 篇幅地板
    expect(briefing).toMatch(/[0-9]{3,4}\s*字/)
    // 参考文献规则
    expect(briefing).toContain('参考文献')
    expect(briefing).toMatch(/至少一条|方法相关|方法关键词/)
    // 评价四要素
    for (const k of ['优点', '局限', '敏感性', '推广']) expect(briefing).toContain(k)
  })

  it('宪法**没有**正文契约 —— 所以"只在宪法里"是不够的', () => {
    // 方向性守卫：如果哪一天宪法把正文契约也吞进去了，这条会红——那时应该
    // 重新审视"两层投递"的设计，而不是默默让它通过。
    expect(PAPER_CONSTITUTION).not.toMatch(/低于\s*1200\s*字|1200 字的下限/)
  })

  it('E2 的 prompt 组装处**引用了 produce 简报**（接线判据，不是措辞判据）', () => {
    // 静态断言：`e2NormalizationPrompt(...)` 之后必须跟着正文契约简报。
    // 用"附近有没有 briefingOf('produce'"来判，避免钉死具体措辞。
    const at = SOURCE.indexOf('e2NormalizationPrompt(e1Text, constitutionText())')
    expect(at).toBeGreaterThan(-1)
    // 简报是**先构造、后拼接**的，所以要往前也看一段——只向后找会假红。
    const around = SOURCE.slice(Math.max(0, at - 1600), at + 400)
    expect(around, 'E2 的 prompt 必须拼上 produce 简报（正文契约的载体）').toContain("briefingOf('produce'")
    expect(around).toContain('proseContractBriefing')
  })

  it('E2 的基线 prompt 本身仍含容器 schema（不许因为加契约而挤掉它）', () => {
    const base = e2NormalizationPrompt('E1 分析全文。', PAPER_CONSTITUTION)
    expect(base).toContain('__dsh_paper')
    expect(base).toContain('E1 分析全文。')
  })
})

describe('W12-C3b — E2 必须知道哪两章没人帮它兜底', () => {
  it('E2 的 prompt 里点名 evaluation 与 references 的**地板数字**', () => {
    // 检查点实测：合并会把 E1 注入 analysis / methods / code，注入后那三章都过地板
    // （5,895 / 925 / 2,963 字）；而 evaluation（800）与 references（600）**没有任何注入**
    // ——实测 724 与 359，恰好是唯一不达标的两章。不达标不是因为写得不好，而是因为
    // 模型不知道这两章没人帮它兜底。
    const at = SOURCE.indexOf('E2_SELF_WRITTEN_CHAPTERS = [')
    expect(at).toBeGreaterThan(-1)
    const block = SOURCE.slice(at, at + 900)
    expect(block).toContain('evaluation')
    expect(block).toContain('references')
    expect(block).toContain('800')
    expect(block).toContain('600')
    // 必须说清"别的章有注入、这两章没有"——这是模型推断不出来的信息
    expect(block).toMatch(/merged into|no.*help|entirely yours/i)
  })

  it('这段仍然拼在 E2 的 prompt 上（接线判据）', () => {
    const at = SOURCE.indexOf('e2NormalizationPrompt(e1Text, constitutionText())')
    const around = SOURCE.slice(Math.max(0, at - 1600), at + 500)
    expect(around).toContain('E2_SELF_WRITTEN_CHAPTERS')
  })
})
