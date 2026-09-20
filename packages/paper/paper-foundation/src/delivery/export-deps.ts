/**
 * 导出依赖清单与探测 — R2⑤（格式链，G3）.
 *
 * docx 导出链的可执行依赖（cairosvg / python-docx / pandoc）进 manifest：
 * 一个闭集表 + 一个探测函数，每个依赖返回 0/1/2（0 可用 / 1 缺失 /
 * 2 无法判定）。probe 是 **argv 数组**（不经过 shell）：早期版本用字符串
 * 按空格切分，`python -c "import docx"` 的引号被打散成 4 个参数，三个依赖
 * 全部误报"无法判定"——实测抓到的实现错误。
 *
 * 诚实边界：探测只回答"probe 命令是否成功退出"，不验证版本行为。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/export-deps
 */

import { execFileSync } from 'node:child_process'

export interface ExportDependency {
  readonly name: string
  readonly purpose: string
  /** argv 形态（不经过 shell，引号不会被打散）。 */
  readonly probe: ReadonlyArray<string>
  /** 当前导出链的硬前置（false = 仅未来通道需要，缺了不阻断今天的导出）。 */
  readonly required: boolean
}

/** 闭集清单（R2⑤ 依赖入 manifest 的数据源）。 */
export const EXPECTED_EXPORT_DEPS: ReadonlyArray<ExportDependency> = [
  { name: 'python-docx', purpose: 'docx 写出（export-docx.py 的 Document 对象）', probe: ['python', '-c', 'import docx'], required: true },
  { name: 'cairosvg', purpose: 'SVG → PNG（300dpi 图嵌入）', probe: ['python', '-c', 'import cairosvg'], required: true },
  { name: 'pandoc', purpose: 'Markdown → 中间格式与块公式（R2④ OMML 通道）', probe: ['pandoc', '--version'], required: false },
]

export interface ExportDepStatus {
  readonly name: string
  /** 0 可用 / 1 缺失 / 2 无法判定（探测进程本身异常）。 */
  readonly status: 0 | 1 | 2
  readonly detail: string
}

/** 探测所有导出依赖；不因单个缺失而中断（闸门在调用方）。 */
export function probeExportDeps(deps: ReadonlyArray<ExportDependency> = EXPECTED_EXPORT_DEPS): ReadonlyArray<ExportDepStatus> {
  return deps.map((dep) => {
    try {
      const [cmd, ...args] = dep.probe
      if (cmd === undefined) return { name: dep.name, status: 2 as const, detail: 'empty probe' }
      execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', timeout: 20_000 })
      return { name: dep.name, status: 0 as const, detail: 'probe OK' }
    } catch (error) {
      const e = error as { code?: string; status?: number | null }
      // spawn failure (interpreter absent) and a non-zero probe exit (module
      // absent) are both "missing"; anything else is unverifiable.
      if (e.code === 'ENOENT' || (typeof e.status === 'number' && e.status !== 0)) {
        return { name: dep.name, status: 1 as const, detail: 'missing' }
      }
      return { name: dep.name, status: 2 as const, detail: 'unverifiable: ' + String(error).split('\n')[0]?.slice(0, 80) }
    }
  })
}

/**
 * 汇总：**硬前置**缺失才 notReady；可选依赖（如 pandoc，只服务 OMML 通道）
 * 缺失只登记不阻断——否则今天的导出会被一个用不到的依赖假闸拒掉（实测）。
 */
export function exportDepsSummary(
  statuses: ReadonlyArray<ExportDepStatus>,
  deps: ReadonlyArray<ExportDependency> = EXPECTED_EXPORT_DEPS,
): { ready: boolean; missing: ReadonlyArray<string>; optionalMissing: ReadonlyArray<string> } {
  const requiredNames = new Set(deps.filter(d => d.required).map(d => d.name))
  const missing = statuses.filter(s => s.status === 1 && requiredNames.has(s.name)).map(s => s.name)
  const optionalMissing = statuses.filter(s => s.status === 1 && !requiredNames.has(s.name)).map(s => s.name)
  return { ready: missing.length === 0, missing, optionalMissing }
}
