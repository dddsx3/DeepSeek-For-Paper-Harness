/**
 * 导出依赖清单与探测 — R2⑤（格式链，G3）.
 *
 * docx 导出链的可执行依赖（cairosvg / python-docx / pandoc）进 manifest：
 * 一个闭集表 + 一个探测函数，每个依赖返回 0/1/2（1=缺、2=环境无法判定）。
 * 诚实边界：探测只回答"import 是否成功"（python -c 一层），不验证版本行为。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/export-deps
 */

export interface ExportDependency {
  readonly name: string
  readonly purpose: string
  readonly probe: string // python -c / command -v 形态
}

/** 闭集清单（R2⑤ 依赖入 manifest 的数据源）。 */
export const EXPECTED_EXPORT_DEPS: ReadonlyArray<ExportDependency> = [
  { name: 'python-docx', purpose: 'docx 写出（export-docx.py 的 Document 对象）', probe: 'python -c "import docx"' },
  { name: 'cairosvg', purpose: 'SVG → PNG（300dpi 图嵌入）', probe: 'python -c "import cairosvg"' },
  { name: 'pandoc', purpose: 'Markdown → 中间格式与块公式（未来 OMML 通道）', probe: 'pandoc --version' },
]

export interface ExportDepStatus {
  readonly name: string
  /** 0 可用 / 1 缺失 / 2 无法判定（probe 进程本身失败）。 */
  readonly status: 0 | 1 | 2
  readonly detail: string
}

import { execFileSync } from 'node:child_process'

/** 探测所有导出依赖；不因单个缺失而中断（fail-open 探测，闸门在调用方）。 */
export function probeExportDeps(deps: ReadonlyArray<ExportDependency> = EXPECTED_EXPORT_DEPS): ReadonlyArray<ExportDepStatus> {
  return deps.map((dep) => {
    try {
      const parts = dep.probe.split(' ')
      const cmd = parts[0] as string
      const args = parts.slice(1)
      execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', timeout: 10_000 })
      return { name: dep.name, status: 0 as const, detail: 'probe OK' }
    } catch (error) {
      const m = /not found|No such file|Error: Cannot find module|command not found|unrecognized/i.test(String(error))
      return m
        ? { name: dep.name, status: 1 as const, detail: 'missing' }
        : { name: dep.name, status: 2 as const, detail: 'unverifiable: ' + String(error).split('\n')[0]?.slice(0, 80) }
    }
  })
}

/** 汇总：任一缺失即 notReady（导出的硬前置）。 */
export function exportDepsSummary(statuses: ReadonlyArray<ExportDepStatus>): { ready: boolean; missing: ReadonlyArray<string> } {
  const missing = statuses.filter(s => s.status === 1).map(s => s.name)
  return { ready: missing.length === 0, missing }
}
