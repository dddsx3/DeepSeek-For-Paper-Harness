/**
 * 阶段 3（code）的**分片调用** —— 与 `shard-declare` 同一模式的既有方案。
 *
 * ## 为什么必须分片
 *
 * 2024B 实测（见 CHECKPOINT-STAGE-CHAIN.md §5.2）：该中转对单次输出有 ~8k 令牌的
 * 硬天花板（与请求的 max_tokens 无关），而"编排入口 + 逐问实现 + 结果说明 + 产出
 * 清单"合在一次回答里，加上模型必写的推理散文，反复被截断（非流式也试过，
 * 被网关 524 掐断——长生成下流式是唯一可行形态）。**唯一能过天花板的办法是
 * 每次调用只交付一个小文件**。
 *
 * ## 分片计划（确定性，由题面问数决定）
 *
 * | 片 | 交付 | 形态 |
 * |---|---|---|
 * | 1 | `code/main.py`（编排入口） | 原文 |
 * | 2..N+1 | `code/problemK.py`（逐问实现，K = 1..题面问数） | 原文 |
 * | N+2 | `RESULTS.md` + `DELIVERABLES.json` | JSON 信封 |
 *
 * 每一片的 prompt = **完整阶段简报** + 一句"本次只产出 X"。简报里已有逐问模型
 * 与上游上下文，所以每一片都能独立写出该文件；重复的只是输入令牌——
 * 这是过天花板的代价，且被 `PAPER_STAGE_INLINE_BUDGET` 的压缩钳住。
 *
 * 组装后的 JSON 信封交给 `parseStageOutput` 按原契约解析——**runner 不感知分片**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/code-shard
 */

import type { StageSpec } from './registry.ts'

/** 一片：要产出的文件 + 该片的完整 prompt。 */
export interface CodeShard {
  readonly index: number
  readonly total: number
  /** 本片交付的文件（相对阶段目录）；`'*'` = JSON 信封（多文件）。 */
  readonly deliverable: string
  readonly prompt: string
}

/** 阶段 3 的模型交付清单（非 harnessMinted、含目录型）。 */
function codeDeliverables(spec: StageSpec): ReadonlyArray<string> {
  return spec.produces.filter(p => p.harnessMinted !== true).map(p => p.file)
}

/**
 * 把阶段 3 的简报切成**确定性**的分片序列。
 *
 * @param spec - 阶段 3 的 spec。
 * @param prompt - 完整阶段简报（runner 组装的那份）。
 * @param problemCount - 题面问数（0 = 未知：此时不逐问分片，回退成"整段一次交付"，
 *   由上层按原契约解析——问数未知时拆片反而无从拆）。
 */
export function planCodeShards(spec: StageSpec, prompt: string, problemCount: number): ReadonlyArray<CodeShard> {
  const deliverables = codeDeliverables(spec)
  const entry = 'code/main.py'
  const perProblem = Array.from({ length: Math.max(problemCount, 0) }, (_, i) => `code/problem${String(i + 1)}.py`)
  const rest = deliverables.filter(f => f !== entry && !/^code\/problem\d+\.py$/.test(f))

  const shardPrompt = (deliverable: string, i: number, total: number): string =>
    `${prompt}\n\n---\n\n## 本次调用（分片 ${String(i)}/${String(total)}）\n\n`
      + (deliverable === '*'
        ? `一次性产出 **JSON 信封** \`{"files": {…}}\`，其中恰好包含这几个键：${rest.map(f => `\`${f}\``).join('、')}。`
        : `只产出 \`${deliverable}\` 的**完整内容**——你的回答从第一个字符到最后一个字符都是它，不得有任何解释或围栏。`)
      + '\n简报的其余要求对本片同样成立。'

  if (problemCount <= 0) {
    // 问数未知：无法按问拆——一次交付全部（2024B 之外的情形；code_parity 会给 2）。
    const total = 1
    return [{ index: 1, total, deliverable: '*', prompt: shardPrompt('*', 1, total) }]
  }
  const shards: Array<{ deliverable: string }> = [ { deliverable: entry }, ...perProblem.map(f => ({ deliverable: f })), { deliverable: '*' } ]
  const total = shards.length
  return shards.map((shard, i) => ({
    index: i + 1,
    total,
    deliverable: shard.deliverable,
    prompt: shardPrompt(shard.deliverable, i + 1, total),
  }))
}

/**
 * 组装分片回答成 JSON 信封（交给 `parseStageOutput` 按原契约解析）。
 *
 * @param shards - `planCodeShards` 的分片序列（deliverable 顺序即组装顺序）。
 * @param answers - 每一片的回答（与 `shards` 一一对应）。
 * @throws 某一片的回答为空（该文件没有内容就是没有交付）、或末片信封不是合法 JSON。
 */
export function assembleShards(
  shards: ReadonlyArray<CodeShard>,
  answers: ReadonlyArray<string>,
): string {
  const files: Record<string, string> = {}
  shards.forEach((shard, i) => {
    const answer = answers[i] ?? ''
    if (answer.trim() === '') {
      throw new Error(`分片 ${String(shard.index)}/${String(shard.total)}（${shard.deliverable}）的回答是空的 —— `
        + '该文件没有内容就是没有交付，不静默跳过')
    }
    if (shard.deliverable === '*') {
      // 末片是 JSON 信封：把它的 files 并进来
      const parsed = JSON.parse(answer) as { files?: Record<string, string> }
      for (const [k, v] of Object.entries(parsed.files ?? {})) files[k] = v
      return
    }
    files[shard.deliverable] = answer
  })
  return JSON.stringify({ files })
}
