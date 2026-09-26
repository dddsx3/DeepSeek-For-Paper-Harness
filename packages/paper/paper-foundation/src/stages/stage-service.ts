/**
 * 阶段链的**服务层** —— 把 11 阶段执行器接进 harness 的 provider 缝。
 *
 * ## 为什么要有这一层（S6 的全部意义）
 *
 * `runner.ts` 刻意**不碰 provider**：它只依赖一个 `callModel(stage, prompt)` 回调，
 * 所以完全可测。但这也意味着"模块做好"和"进了主线"之间隔着一层——没有这一层，
 * `runStages` 就只能被测试调用（§5.3 的教训：那等于没做）。
 *
 * 本模块做的事：
 * 1. **`callModel` → provider 缝**：与 `WorkflowExecutor.call` 同一条缝
 *    （`paperProvider.stream` → LLM runtime → runtime guard 的能力防火墙），
 *    所以阶段链的模型调用与交付链的模型调用走**同一条**被审计、被预算约束的路。
 * 2. **确定性阶段 → 真执行体**：`runDeterministic` 接 `deterministicRunner()`。
 * 3. **暂停/续跑**：见下面 §"暂停与续跑"。
 *
 * ## 暂停与续跑：**通行证就是切片**
 *
 * 11 阶段链的每个阶段跑完都留一份 `PASSED`（JSON，含上游摘要与产物哈希）在磁盘上。
 * 所以"暂停"= 跑到指定阶段就停；"续跑"= 找出**第一份缺失或已作废**的通行证，
 * 从那里用 `only` 继续跑——上游就绪检查（`stageReady`）会逐环节核对摘要，
 * 对不上就拒绝启动并点名是哪一环。**这与 `runtime/stage-checkpoint.ts` 是同一套
 * 工作流**（每阶段完成即停、人检查后续跑），但载体不是那份 5 阶段的切片清单：
 *
 * | | 切片清单（`stage-checkpoint.ts`） | 通行证（本模块） |
 * |---|---|---|
 * | 阶段 id | 5 个（analyze/declare/produce/review/deliver） | **11 个**（注册表） |
 * | "这个切片还算数吗" | 人写回 review 结论 | 机器算的 `inputDigest`（上游/技能/门禁任一变了就失效） |
 * | 作废下游 | 要另写逻辑 | `markStaleFrom` 已实现 |
 *
 * 5 阶段表服务的是**交付链**（`WorkflowExecutor` 的切片点）；把 11 阶段塞进那张表
 * 是硬套，而通行证已经是更强的形态。所以这里**复用的是热重启的工作流，不是那张表**。
 *
 * ## 工具开关：这条路径**没有工具回路**，所以必须是 false
 *
 * `read_skill_doc` / `check_container` 的宿主在 `WorkflowExecutor`（它有工具调用循环）。
 * 阶段链的 `callModel` 是一次纯文本调用，模型**没有**发起工具调用的通道。如果这里
 * 接受 `skillDocs: true` 并把语料索引列进简报，就是点名一份**取不到的文档**——
 * round-5 的原缺陷。所以 `true` 在这里**拒绝启动**并说明原因，而不是静默忽略。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/stage-service
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { deterministicRunner, type DeterministicOutcome } from './deterministic.ts'
import { runCodeAndMintResults } from './execute-and-mint.ts'
import { assembleShards, planCodeShards, planModelingShards } from './code-shard.ts'
import { assembleFigureAnswers, planShard, scriptShards } from './figure-script-shard.ts'
import { auditPromptOf, parseAuditVerdict } from './audit.ts'
import { skillTaskOf } from './briefing.ts'
import { readPassport } from './handoff.ts'
import { runStages, type StageOutcome, type StageRunContext } from './runner.ts'
import type { StageSpec } from './registry.ts'
import { STAGES, type StageId } from './registry.ts'

/** 读一个文件；不存在返回 null（**不返回空串**）。 */
async function readFileMaybe(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

/**
 * 读**题面事实**：判"产物是否符合题面"的唯一依据。
 *
 * 两份，都不大（2024B 实测 4KB + 11KB），都内联：
 * - `00-input/problem.txt` —— 原始题面（含附件表格与图转写）；
 * - `01-prob-analysis/PROBLEM_FACTS.json` —— 阶段 1 抽取的**给定值事实表**（每条带 raw_quote）。
 *
 * 为什么是这两份而不是执行者的上游产物：它们是**题面**，不是"某个模型怎么理解题面"。
 * 审计员拿它当尺子，量的是产物与题面的距离——这正是"独立审计"要量的东西。
 * 阶段 1 自己的审计也会拿到 problem.txt：那时尺子是原始题面，审的是"有没有读错题"。
 *
 * 读不到就**不给**（`size === 0`），提示词里那段整体不出现——而不是给一段空标题
 * 让审计员以为自己看到了什么。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @returns `文件名 → 文本`（可能为空）。
 */
async function loadGroundTruth(stagesRoot: string): Promise<ReadonlyMap<string, string>> {
  const candidates: ReadonlyArray<readonly [string, string]> = [
    ['题面原文 problem.txt', join(stagesRoot, '00-input', 'problem.txt')],
    ['给定值事实表 PROBLEM_FACTS.json', join(stagesRoot, '01-prob-analysis', 'PROBLEM_FACTS.json')],
  ]
  const out = new Map<string, string>()
  for (const [name, path] of candidates) {
    const text = await readFileMaybe(path)
    if (text !== null && text.trim() !== '') out.set(name, text)
  }
  return out
}

/** 阶段链的系统提示词（与交付链的角色提示词分开：它说的是"按简报的契约产出"）。 */
export const STAGE_CHAIN_SYSTEM = [
  '你是数学建模竞赛论文流水线中的一个阶段执行者。',
  '你会收到一份**阶段简报**：任务、产出契约（机器可校验的判据）、上游产物、怎么做、不要做、自检清单。',
  '只产出简报要求的那个形态；那些判据是 harness 会逐条量你的，不是建议。',
  '不要输出任何解释性开场白或结束语——你的回答会被按契约直接解析。',
].join('\n')

/** 服务的配置。 */
export interface StageChainConfig {
  /** `stages/` 根目录（**必须**给：产物与通行证都落在这里）。 */
  readonly stagesRoot: string
  /** 只跑这些阶段（调试用；续跑时由本模块算出来）。 */
  readonly only?: ReadonlyArray<StageId>
  /** 跑完这些阶段就停（等人工检查后续跑）。 */
  readonly pauseAfter?: ReadonlyArray<StageId>
  /** 题面的子问题数；不给则从 `00-input/problem.txt` 数，数不出给 0（`code_parity` 如实给 `2`）。 */
  readonly problemCount?: number
  /**
   * 语料工具开关（与 `PaperExecutorOptions.skillDocs` 同名）。
   *
   * **这条路径只接受 `false`**：阶段链的 `callModel` 没有工具调用回路，挂了开关
   * 也只是让简报点名一份取不到的文档。要在这条路径上启用语料，先给阶段链加工具回路。
   */
  readonly skillDocs?: boolean
  /** 每个确定性阶段跑完的回调（进 CLI 日志/检查点报告）。 */
  readonly onDeterministicOutcome?: (outcome: DeterministicOutcome) => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperStageChain: PaperStageChainService
  }
}

/** 11 阶段链的服务宿主。 */
export class PaperStageChainService extends Service {
  static inject = ['paperProvider', 'paperSettings']

  private readonly config: StageChainConfig

  constructor(ctx: Context, config: StageChainConfig) {
    super(ctx, 'paperStageChain')
    if (config.stagesRoot === undefined || config.stagesRoot === '') {
      throw new Error('阶段链服务缺 stagesRoot —— 产物与通行证必须落盘，否则暂停/续跑无从谈起')
    }
    if (config.skillDocs === true) {
      throw new Error('阶段链还没有工具回路（read_skill_doc 的宿主在 WorkflowExecutor），'
        + 'skillDocs=true 只会让简报点名一份取不到的语料——这条路径必须传 false。'
        + '要在阶段链上启用语料，先给 callModel 加工具调用循环。')
    }
    this.config = config
  }

  /**
   * 跑一次阶段链（默认从第 1 阶段跑到第 11 阶段；`only` 限定范围）。
   *
   * @returns 逐阶段结果（含失败原因与建议回滚目标）。
   */
  async run(): Promise<ReadonlyArray<StageOutcome>> {
    const problemCount = await this.problemCount()
    const only = this.config.only
    return runStages(this.contextOf(), {
      ...(only === undefined ? {} : { only }),
      problemCount,
    })
  }

  /**
   * 跑到 `pauseAfter` 指定的阶段就停（**不含**之后的阶段——那是下一轮的事）。
   *
   * @returns 已跑的阶段结果。
   */
  async runUntilPause(): Promise<ReadonlyArray<StageOutcome>> {
    const pause = this.config.pauseAfter
    if (pause === undefined || pause.length === 0) return this.run()
    const upto = Math.max(...pause.map(id => stageIndexOf(id)))
    const only = STAGES.filter(s => s.index <= upto).map(s => s.id)
    const problemCount = await this.problemCount()
    return runStages(this.contextOf(), { only, problemCount })
  }

  /**
   * **只跑一个阶段**：下一个未通过的阶段，跑完即停。
   *
   * 这是"每阶段完成即停、人工检查后放行"的最小单元：调用方（CLI/agent）拿到
   * 一个结果，检查产物与通行证，**人决定**是否放行下一个。放行不是这里的事——
   * 它是"再调一次 runOneStage"这个动作本身；检查结论写进检查点报告。
   *
   * @returns 该阶段的结果；整条链都已完成时为 `null`。
   */
  async runOneStage(): Promise<StageOutcome | null> {
    const next = await resumePointOf(this.config.stagesRoot)
    if (next === null) return null
    const problemCount = await this.problemCount()
    const outcomes = await runStages(this.contextOf(), { only: [next], problemCount })
    const first = outcomes[outcomes.length - 1]
    return first ?? null
  }

  /**
   * 续跑：找出第一份缺失或已作废的通行证，从那里继续。
   *
   * @returns 续跑点（整条链都已完成时为 `null`）与续跑结果。
   */
  async resume(): Promise<{ readonly from: StageId | null; readonly outcomes: ReadonlyArray<StageOutcome> }> {
    const from = await resumePointOf(this.config.stagesRoot)
    if (from === null) return { from: null, outcomes: [] }
    const only = STAGES.filter(s => s.index >= stageIndexOf(from)).map(s => s.id)
    const problemCount = await this.problemCount()
    const outcomes = await runStages(this.contextOf(), { only, problemCount })
    return { from, outcomes }
  }

  /** 组装 `StageRunContext`（`callModel` 走 provider 缝，确定性阶段走真执行体）。 */
  private contextOf(): StageRunContext {
    const provider = this.ctx.paperProvider
    const route = this.ctx.paperSettings.snapshot().executor

    // **限额应对**（用户指定，免费模型场景）：免费模型的配额是**周期性**的
    // ——实测同一账户报"余额不足"后几分钟又恢复 200。所以正确处置不是失败，
    // 而是：① 先切 PAPER_STAGE_FALLBACK_MODEL（默认 glm-5.3-flash-free，两者
    // 配额独立）；② 都受限就**等待并交替重试**（配额按时间恢复）。
    // 上限由 PAPER_STAGE_QUOTA_WAIT_MS 控制（默认 30 分钟），超时才如实失败。
    const fallbackModel = process.env['PAPER_STAGE_FALLBACK_MODEL'] ?? 'glm-5.3-flash-free'
    let activeModel = route.model
    let modelSwitched = false
    const quotaWaitCapMs = (() => {
      const raw = Number(process.env['PAPER_STAGE_QUOTA_WAIT_MS'] ?? '')
      return Number.isFinite(raw) && raw > 0 ? raw : 1_800_000
    })()
    let quotaWaitedMs = 0
    const isQuotaError = (message: string): boolean =>
      /\b429\b|\b402\b|quota|额度|余额|配额|insufficient|exhaust|rate.?limit|无可用|渠道/i.test(message)
    // 配额等待阶梯（秒）：越往后等越久，交替两个模型试（各自配额独立恢复）。
    const QUOTA_WAIT_LADDER_MS = [30_000, 60_000, 120_000, 300_000, 600_000]

    // **单次调用原语**（传输级重试 + 限额降级内建）。阶段 3 的分片与单产出的模型阶段都用它。
    const singleCall = async (spec: StageSpec, prompt: string): Promise<string> => {
      const request: GenerateOptions = {
        provider: route.provider,
        model: activeModel,
        system: STAGE_CHAIN_SYSTEM,
        messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
      }
      // 传输级重试（2024B 阶段 3 实测）：一次十几分钟的流会被中转中途掐断
      // （"terminated" / 看门狗触发 / ECONNRESET）。这些是**传输失败**，不是
      // "模型答错了"——重试是恢复路径，把整阶段作废才是真的浪费。
      // 上限 3 次、退避 5s/15s/45s；max-tokens 截断**不重试**（那是产出超限，
      // 重发只会再超限一次），按契约失败上报。
      let lastFailure: unknown
      let quotaWaits = 0
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          let text = ''
          let finish: { kind: string } | undefined
          for await (const chunk of provider.stream(request)) {
            if (chunk.type === 'text-delta') text += chunk.text
            if (chunk.type === 'finish') finish = chunk.reason
          }
          const kind = finish?.kind ?? 'stop'
          if (kind === 'max-tokens') {
            throw new Error(`阶段 '${spec.id}' 的回答被 max-tokens 截断 —— `
              + '这不是"写错了哪里"，是产出超过了单次调用的输出上限；分片或压缩后重试')
          }
          if (kind === 'error' || kind === 'aborted') {
            throw new Error(`模型调用未正常结束（finish=${kind}）—— 阶段 '${spec.id}' 没有可用回答`)
          }
          return text
        } catch (error) {
          lastFailure = error
          const message = String(error instanceof Error ? error.message : error)
          // 限额 → 先切降级模型（重置重试预算），都受限就等待后交替重试。
          if (isQuotaError(message)) {
            if (!modelSwitched && activeModel !== fallbackModel) {
              modelSwitched = true
              activeModel = fallbackModel
              this.config.onDeterministicOutcome?.({
                stage: spec.id,
                summary: `模型 ${route.model} 触发限额，切换到 ${fallbackModel} 继续完成剩余内容`,
              })
              attempt = 0
              continue
            }
            // 两个模型都受限：等配额恢复（周期性），交替试。
            const waitMs = QUOTA_WAIT_LADDER_MS[Math.min(quotaWaits, QUOTA_WAIT_LADDER_MS.length - 1)] ?? 600_000
            if (quotaWaitedMs + waitMs > quotaWaitCapMs) break
            quotaWaits += 1
            quotaWaitedMs += waitMs
            activeModel = activeModel === route.model ? fallbackModel : route.model
            this.config.onDeterministicOutcome?.({
              stage: spec.id,
              summary: `两个模型都受限，等待 ${String(Math.round(waitMs / 1000))}s 后改用 ${activeModel} 重试`
                + `（已等 ${String(Math.round(quotaWaitedMs / 1000))}s / 上限 ${String(Math.round(quotaWaitCapMs / 1000))}s）`,
            })
            await new Promise(resolve => setTimeout(resolve, waitMs))
            attempt = 0
            continue
          }
          const retryable = /terminated|ECONNRESET|fetch failed|socket|看门狗|network|timeout|aborted/i.test(message)
            && !/max-tokens/.test(message)
          if (!retryable || attempt === 3) break
          await new Promise(resolve => setTimeout(resolve, 5_000 * 3 ** (attempt - 1)))
        }
      }
      throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure))
    }

    return {
      stagesRoot: this.config.stagesRoot,
      callModel: async (spec, prompt) => {
        // 阶段 3 **分片调用**（与 shard-declare 同一模式）：每次只交付一个小文件，
        // 全部落在中转的输出天花板之内；组装成 JSON 信封后按原契约解析——
        // runner 不感知分片。见 code-shard.ts 的模块头。
        if (spec.id === 'code') {
          const shards = planCodeShards(spec, prompt, await this.problemCount())
          const answers: string[] = []
          for (const shard of shards) {
            answers.push(await singleCall(spec, shard.prompt))
            this.config.onDeterministicOutcome?.({
              stage: spec.id,
              summary: `分片 ${String(shard.index)}/${String(shard.total)} 交付 ${shard.deliverable}`,
            })
          }
          return assembleShards(shards, answers)
        }
        // 阶段 2 **也分片**：注册表的前提就写着"两次调用，不是一次"（2a 只声明 IR、
        // 2b 只写富散文），但分片机制只接在阶段 3 上。实测代价：加进"上一轮审计的问题"
        // 后回答在 47915 字节处被输出天花板截断，整轮重跑作废。
        // **后续分片要看到前面的产出**：分片把"一次调用"拆成"两次独立调用"，
        // 于是富散文分片看不到 IR 声明分片写了什么，两边可以自相矛盾——实测立刻发生：
        // 声明的 `EQ-PLAN-Q1` 已改成 `Pr(X≤c|p_nom) ≤ beta`，而报告仍写 `≥ 0.90`，
        // 审计判"报告与声明冲突"（fatal）。所以每片的 prompt 追加已产出文件全文，
        // 并明写"必须与之保持一致"。这是分片换来的新约束，必须补上。
        if (spec.id === 'modeling') {
          const shards = planModelingShards(spec, prompt)
          const answers: string[] = []
          for (const shard of shards) {
            const prior = answers.length === 0
              ? ''
              : '\n\n---\n\n## 本阶段**已产出**的文件（必须与之保持一致，不得互相矛盾）\n\n'
                + shards.slice(0, answers.length)
                  .map((s, i) => `### \`${s.deliverable}\`\n\n${answers[i] ?? ''}`)
                  .join('\n\n')
            answers.push(await singleCall(spec, shard.prompt + prior))
            this.config.onDeterministicOutcome?.({
              stage: spec.id,
              summary: `分片 ${String(shard.index)}/${String(shard.total)} 交付 ${shard.deliverable}`,
            })
          }
          return assembleShards(shards, answers)
        }
        // 阶段 5 **两段式分片**：先出规划（简报 + 配方索引），再逐图内联配方写脚本。
        // 为什么必须分两段：配方库 350KB+ 全量内联装不下，而**每张图只需要它自己那一条**；
        // 且模型读不到磁盘（简报是唯一通道），"取配方"只能由 harness 代做。
        // 与参考的 Step 1 规划 → Step 3 一图一脚本同构。
        if (spec.id === 'figure-declare') {
          const plan = planShard(prompt)
          this.config.onDeterministicOutcome?.({ stage: spec.id, summary: '第 1 段：出作图规划' })
          const planAnswer = await singleCall(spec, plan.prompt)
          const shards = scriptShards(prompt, planAnswer)
          const answers: string[] = []
          for (const shard of shards) {
            answers.push(await singleCall(spec, shard.prompt))
            this.config.onDeterministicOutcome?.({
              stage: spec.id,
              summary: `第 ${String(shard.index)}/${String(shard.total)} 段：交付 ${shard.deliverable}`,
            })
          }
          return assembleFigureAnswers(planAnswer, shards, answers)
        }
        return singleCall(spec, prompt)
      },
      runDeterministic: deterministicRunner(this.config.onDeterministicOutcome),
      // 阶段 3 的 harness 侧后处理：**真跑代码并铸数**。模型只声明数在哪
      // （RESULT_SOURCES.json），账本由真实执行的产物字节铸成——数不由模型持有。
      afterModel: async (spec, stagesRoot) => {
        if (spec.id !== 'result-sources') return
        const outcome = await runCodeAndMintResults(stagesRoot)
        this.config.onDeterministicOutcome?.({
          stage: 'result-sources',
          summary: '执行 code/main.py（exit ' + String(outcome.exitCode) + '），按声明铸出 '
            + String(outcome.minted) + ' 条账目',
        })
      },
      // ── 逐节点审计（用户新增约束）：交付前由**独立角色**审一遍 ──────────────
      // 独立性：审计只拿到"契约（任务陈述 + 产出清单 + 门禁 id）+ 本阶段产物 + 上游产物名
      // + 题面事实"，拿不到执行者的提示词与推理——否则它会顺着执行者的框架去理解产物，
      // 那就成了自己审自己。
      // **题面事实必须给**：只给"上游文件名清单"时，审计员无从判断产物是否与题面相符。
      // 2024B 实测的失配正是这一类：题面给了调换损失 `ce=40`，阶段 3 的代码从头到尾没用它，
      // "什么都不检查"于是虚假胜出——那不是结构缺陷，机械门禁全绿，只有拿题面当尺子才量得出。
      // 模型：PAPER_AUDIT_MODEL（默认与执行者同模型但**全新上下文**；换成别的模型族更独立）。
      auditStage: async (spec, auditStagesRoot, artifacts) => {
        const auditModel = process.env['PAPER_AUDIT_MODEL'] ?? activeModel
        const upstreamNames = spec.consumes.map(p2 => p2.split('/').pop() ?? p2)
        const groundTruth = await loadGroundTruth(auditStagesRoot)
        const prompt = auditPromptOf({
          spec,
          skillTask: skillTaskOf(spec),
          artifacts,
          upstreamNames,
          ...(groundTruth.size === 0 ? {} : { groundTruth }),
          ...(process.env['PAPER_AUDIT_INLINE_BUDGET'] === undefined
            ? {} : { budgetChars: Number(process.env['PAPER_AUDIT_INLINE_BUDGET']) }),
        })
        const request: GenerateOptions = {
          provider: route.provider,
          model: auditModel,
          system: STAGE_CHAIN_SYSTEM,
          messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
        }
        let text = ''
        let finish: { kind: string } | undefined
        for await (const chunk of provider.stream(request)) {
          if (chunk.type === 'text-delta') text += chunk.text
          if (chunk.type === 'finish') finish = chunk.reason
        }
        const kind = finish?.kind ?? 'stop'
        if (kind === 'error' || kind === 'aborted' || kind === 'max-tokens') {
          // 审计没跑成 → 抛错，由 runner 记 `2`（**绝不当成通过**）
          throw new Error(`审计调用未正常结束（finish=${kind}）—— 本阶段未被审计`)
        }
        const verdict = parseAuditVerdict(text, spec, auditModel, new Date().toISOString())
        this.config.onDeterministicOutcome?.({
          stage: spec.id,
          summary: `逐节点审计（${auditModel}）：${verdict.verdict}，质量分 ${verdict.score.toFixed(2)}，`
            + `要求 ${String(verdict.requirementCompliance.filter(r => r.done).length)}/${String(verdict.requirementCompliance.length)} 项完成，`
            + `${String(verdict.findings.length)} 条 findings`,
        })
        return verdict
      },
      auditMinScore: (() => {
        const raw = Number(process.env['PAPER_AUDIT_MIN_SCORE'] ?? '')
        return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.7
      })(),
      skillVersionOf: () => 'stage-chain-v1',
      gateVersionOf: () => 'stage-gates-v1',
      // **这条路径没有工具回路**（见模块头）：简报永远不列语料索引。
      toolsMounted: () => false,
    }
  }

  /** 题面问数：显式配置优先，否则从 `00-input/problem.txt` 数（读不到给 0）。 */
  private async problemCount(): Promise<number> {
    if (this.config.problemCount !== undefined) return this.config.problemCount
    const text = await readFileMaybe(join(this.config.stagesRoot, '00-input', 'problem.txt'))
    return text === null ? 0 : countProblems(text)
  }
}

/** 阶段序号（未知 id 直接抛错——静默当 1 会让"从哪续跑"算错）。 */
function stageIndexOf(id: StageId): number {
  const found = STAGES.find(s => s.id === id)
  if (found === undefined) throw new Error(`unknown stage id: ${String(id)}`)
  return found.index
}

/**
 * 续跑点：第一份**缺失或已作废**的通行证。
 *
 * @returns 阶段 id；全部就绪（整条链已完成）时返回 `null`。
 */
export async function resumePointOf(stagesRoot: string): Promise<StageId | null> {
  for (const spec of STAGES) {
    const passport = await readPassport(stagesRoot, spec)
    if (passport === null || passport.status !== 'passed') return spec.id
  }
  return null
}

/**
 * 从题面文本数子问题数（`count_subproblems.sh` 的等价物）。
 *
 * 判据是**保守**的：取所有"问题 N / 第 N 问"标记的最大 N；一个都没匹配到给 0，
 * 因为 `code_parity` 对 0 的处置是**如实给 `2`**（无法判定），而不是猜一个数。
 *
 * @param problemText - 题面全文。
 * @returns 子问题数；判不出来给 0。
 */
export function countProblems(problemText: string): number {
  const numbers: number[] = []
  for (const m of problemText.matchAll(/问题\s*([0-9]+)/g)) numbers.push(Number(m[1] ?? '0'))
  for (const m of problemText.matchAll(/第\s*([0-9]+)\s*问/g)) numbers.push(Number(m[1] ?? '0'))
  const finite = numbers.filter(n => Number.isFinite(n) && n > 0)
  return finite.length === 0 ? 0 : Math.max(...finite)
}

export default PaperStageChainService
