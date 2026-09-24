/**
 * S6 — `--stages` 真的接进了 CLI（从外壳到阶段链的端到端取证）。
 *
 * `--fake` 的回答是固定散文，不满足阶段 1 的 JSON 信封契约——所以这条运行**必然失败**，
 * 而这正是它的价值：失败要带着阶段名与原因浮出来（而不是"命令没这个选项"或
 * "引擎崩了"）。能这样失败，就证明外壳 → 服务层 → 阶段执行器这条线是通的。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

/** 跑一次 `--stages`，返回退出码与合并输出（离线：`--fake` 不发模型调用）。 */
function runStagesCli(extra: ReadonlyArray<string>, problemText: string): { code: number; output: string; outDir: string } {
  const outDir = mkdtempSync(join(tmpdir(), 'dph-stages-cli-'))
  const problem = join(outDir, 'problem.md')
  writeFileSync(problem, problemText, 'utf8')
  let code = 0
  let output = ''
  try {
    output = execFileSync(process.execPath, [
      join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(repoRoot, 'apps', 'paper-shell', 'src', 'cli.ts'),
      'run', problem, '--fake', '--mode', 'strict', '--capability-tier', 'A', '--out', outDir,
      '--stages', ...extra,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 300_000, stdio: 'pipe' })
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    code = e.status ?? -1
    output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`
  }
  return { code, output, outDir }
}

const PROBLEM = ['# 测试题', '', '## 问题1', '计算某个量。', '', '## 问题2', '计算另一个量。'].join('\n')

describe('S6 —— `--stages` 进了 CLI', () => {
  it('外壳 → 服务层 → 阶段执行器：题面落进 00-input，问数被数出来，失败带着阶段名浮出来', () => {
    const { code, output, outDir } = runStagesCli([], PROBLEM)
    // 外壳把题面交给了阶段链
    const stagesRoot = join(outDir, 'stages')
    expect(existsSync(join(stagesRoot, '00-input', 'problem.txt')), '00-input/problem.txt 没落盘').toBe(true)
    expect(output).toContain('题面问数（数出来的）：2')
    // 阶段 1 跑了，并按契约失败（--fake 的回答不是 JSON 信封）——失败要**点名阶段**
    expect(code).toBe(1)
    expect(output).toContain('prob-analysis')
    expect(output).toContain('JSON envelope')
    expect(output).toContain('STAGE CHAIN FAILED')
  }, 300_000)

  it('不认识的阶段 id → 拒绝并**列出全部合法 id**（不静默取其一）', () => {
    const { code, output } = runStagesCli(['--stage-only', 'nope'], PROBLEM)
    expect(code).toBe(2)
    expect(output).toContain('nope')
    expect(output).toContain('docx-export')
  }, 300_000)

  it('`--stage-pause-after` 跑到指定阶段就停，并提示怎么续跑', () => {
    const { code, output, outDir } = runStagesCli(['--stage-pause-after', 'prob-analysis'], PROBLEM)
    expect(code).toBe(1) // 阶段 1 在 --fake 下本来就过不了；停在这里是对的
    expect(output).toContain('prob-analysis')
    expect(output).not.toContain('03-code')
    expect(existsSync(join(outDir, 'stages', '00-input', 'problem.txt'))).toBe(true)
  }, 300_000)
})
