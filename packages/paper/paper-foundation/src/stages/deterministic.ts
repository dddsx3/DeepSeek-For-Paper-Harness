/**
 * 确定性阶段的**执行体总入口** —— 阶段 4 / 5 / 10 / 11 的 harness 侧计算。
 *
 * ## 为什么这四段必须是确定性阶段（而不是"再来一次模型调用"）
 *
 * 它们做的都是**机械变换**：声明 → 图、清单 → 架构图、Markdown → 自检报告、
 * 正文 → Word。机械变换交给模型有两重代价：① 每次调用都可能不一样，于是
 * "同一份输入两次导出不同"成为常态；② 模型可以在图里画一个上游没有的数。
 * 所以这四段**不消耗模型调用**，输入相同则输出逐字节相同。
 *
 * ## 一处**有意的**不对称：失败要说话，成功要闭嘴
 *
 * 四段里任何一段失败都抛错（`runStages` 会把它记成 `gate-failed` 并点名原因）。
 * 但"没实现的确定性阶段不许静默通过"这条纪律的落点不在这里，而在 `runner.ts`：
 * 执行体**整个缺席**时，阶段不产出任何文件 → 门禁因文件不存在而失败。两条路
 * （缺席 / 抛错）都指向同一个结果：**没跑成的阶段不会被当成通过**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/deterministic
 */

import { renderDiagramStage, type DiagramStageResult } from './diagram-render.ts'
import { runDocxExportStage, type DocxExportResult } from './docx-export.ts'
import { renderFigureStage, type FigureStageResult } from './figure-render.ts'
import { runFormatCheckStage, type FormatCheckResult } from './format-check.ts'
import type { StageId, StageSpec } from './registry.ts'

/** 一个确定性阶段跑完后的自述（进日志与检查点报告）。 */
export interface DeterministicOutcome {
  readonly stage: StageId
  /** 一句话说清"产出了什么"（含数量，便于人工核对）。 */
  readonly summary: string
}

/** 本模块覆盖的阶段 —— **与注册表里的 `kind === 'deterministic'` 必须一致**。 */
export const DETERMINISTIC_EXECUTED: ReadonlyArray<StageId> = ['figure', 'diagram', 'format-check', 'docx-export']

/**
 * 跑一个确定性阶段。
 *
 * @param spec - 阶段（只认 id；`kind` 不是 `deterministic` 时抛错——静默跑错阶段
 *   比抛错危险得多）。
 * @param stagesRoot - `stages/` 根目录。
 * @returns 阶段自述。
 * @throws 阶段不在本模块的覆盖范围内，或该阶段本身失败时抛错（**具名**）。
 */
export async function runDeterministicStage(
  spec: StageSpec,
  stagesRoot: string,
): Promise<DeterministicOutcome> {
  if (spec.kind !== 'deterministic') {
    throw new Error(`阶段 '${spec.id}' 不是确定性阶段（kind=${spec.kind}）——`
      + '确定性执行体不接受模型阶段，静默跑错阶段比抛错危险得多')
  }
  switch (spec.id) {
    case 'figure': {
      const r: FigureStageResult = await renderFigureStage(stagesRoot)
      return {
        stage: spec.id,
        summary: `渲染 ${String(r.figures.length)} 张数据图（声明驱动，图里的数全部来自 Result 投影）`,
      }
    }
    case 'diagram': {
      const r: DiagramStageResult = await renderDiagramStage(stagesRoot)
      return {
        stage: spec.id,
        summary: `渲染 ${String(r.figures.length)} 张架构图`
          + (r.unreachable.length === 0
            ? ''
            : `；${String(r.unreachable.length)} 张够不到（${r.unreachable.map(u => u.figure_id).join('、')}，需 LaTeX 引擎）`),
      }
    }
    case 'format-check': {
      const r: FormatCheckResult = await runFormatCheckStage(stagesRoot)
      const repaired = r.repairs.reduce((n, x) => n + x.count, 0)
      const manual = r.findings.filter(f => f.status === 'manual').length
      return {
        stage: spec.id,
        summary: `五类检查完成：安全修复 ${String(repaired)} 处`
          + (manual === 0 ? '；无人工项' : `；${String(manual)} 类仍需人工（非阻塞，已写进报告）`),
      }
    }
    case 'docx-export': {
      const r: DocxExportResult = await runDocxExportStage(stagesRoot)
      return {
        stage: spec.id,
        summary: `导出 ${String(r.bytes)} 字节 docx；栅格化 ${String(r.rasterized.length)} 张图；`
          + `画像来源 ${r.profile.source}`,
      }
    }
    default:
      throw new Error(`确定性阶段 '${spec.id}' 没有执行体 —— `
        + `已实现的只有 ${DETERMINISTIC_EXECUTED.join('、')}；`
        + '没实现的阶段不许静默通过（缺执行体时它不会产出文件，门禁会因文件不存在而失败）')
  }
}

/**
 * 生成 `StageRunContext.runDeterministic` 需要的回调。
 *
 * 这样接线处只写一行，不必知道四个执行体各自长什么样。
 *
 * @param onOutcome - 可选：每次跑完一个阶段的回调（进日志/检查点报告）。
 * @returns `runDeterministic` 回调。
 */
export function deterministicRunner(
  onOutcome?: (outcome: DeterministicOutcome) => void,
): (spec: StageSpec, stagesRoot: string) => Promise<void> {
  return async (spec, stagesRoot) => {
    const outcome = await runDeterministicStage(spec, stagesRoot)
    onOutcome?.(outcome)
  }
}
