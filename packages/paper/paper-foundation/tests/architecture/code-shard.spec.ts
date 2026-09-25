/**
 * 阶段 3 的分片调用 —— "每次只交付一个小文件，全部落在输出天花板之内"。
 *
 * 2024B 实测：中转对单次输出有 ~8k 令牌硬天花板，"编排入口 + 逐问实现 + 结果说明
 * + 产出清单"合在一次回答里反复被截断。分片计划必须是**确定性**的（问数决定片数），
 * 组装必须过原契约（parseStageOutput 不感知分片）。
 */

import { describe, expect, it } from 'vitest'
import { assembleShards, planCodeShards } from '../../src/stages/code-shard.ts'
import { stageOf } from '../../src/stages/registry.ts'

const spec = stageOf('code')
const briefing = '阶段简报……（含逐问模型与上游上下文）'

describe('code-shard —— 分片计划', () => {
  it('问数 4 → 6 片：入口 1 + 逐问 4 + 收尾信封 1；每片 prompt 都带完整简报与片号', () => {
    const shards = planCodeShards(spec, briefing, 4)
    expect(shards.map(s => s.deliverable)).toEqual([
      'code/main.py', 'code/problem1.py', 'code/problem2.py', 'code/problem3.py', 'code/problem4.py', '*',
    ])
    for (const s of shards) {
      expect(s.total).toBe(6)
      expect(s.prompt).toContain(briefing)
      expect(s.prompt).toContain(`分片 ${String(s.index)}/${String(s.total)}`)
    }
    // 单文件片：原文物态；收尾片：JSON 信封物态
    expect(shards[0]?.prompt).toContain('只产出 `code/main.py`')
    expect(shards[5]?.prompt).toContain('JSON 信封')
    expect(shards[5]?.prompt).toContain('`RESULTS.md`')
  })

  it('问数 0 → 单片回退（问数未知时拆片无从拆；code_parity 会如实给 2）', () => {
    const shards = planCodeShards(spec, briefing, 0)
    expect(shards).toHaveLength(1)
    expect(shards[0]?.deliverable).toBe('*')
  })
})

describe('code-shard —— 组装过原契约', () => {
  it('六片回答组装成 JSON 信封，键与注册表契约一致', () => {
    const shards = planCodeShards(spec, briefing, 2)
    const answers = shards.map(s =>
      s.deliverable === '*'
        ? JSON.stringify({ files: { 'RESULTS.md': '结果说明', 'DELIVERABLES.json': '{"deliverables":[]}' } })
        : `# ${s.deliverable} 的内容`,
    )
    const envelope = JSON.parse(assembleShards(shards, answers)) as { files: Record<string, string> }
    expect(Object.keys(envelope.files).sort()).toEqual([
      'DELIVERABLES.json', 'RESULTS.md', 'code/main.py', 'code/problem1.py', 'code/problem2.py',
    ])
  })

  it('某一片的回答为空 → 具名失败（没有内容就是没有交付，不静默跳过）', () => {
    const shards = planCodeShards(spec, briefing, 1)
    const answers = shards.map(s => (s.deliverable === 'code/main.py' ? '' : s.deliverable === '*' ? '{"files":{}}' : 'x'))
    expect(() => assembleShards(shards, answers)).toThrow(/code\/main.py.*回答是空的/)
  })
})
