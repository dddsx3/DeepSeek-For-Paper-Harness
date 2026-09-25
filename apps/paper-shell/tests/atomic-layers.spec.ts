/**
 * 原子验证门 —— **每一层都真的在主线里被触发过**。
 *
 * ## 它为什么存在
 *
 * 前面的几轮实测反复出现同一类问题：模块写好了、测试过了，但**主线里没触发**
 * （L3 符号通道与 L4 结构指纹在四次真实运行里一次都没跑到，因为链没走完）。
 * 单元测试证明不了这件事——它们直接调模块。
 *
 * 这一条用**离线 `--fake` 跑一整条链**（确定性输入，无模型调用、无 token 消耗），
 * 然后从**产出的审计轨迹**里取证：L0–L6 每一层的事件是否都在。
 *
 * ## 它守的是什么
 *
 * | 断言 | 守的东西 |
 * |---|---|
 * | `path = A-produce-chain` | 链能走完（不是兜底路径） |
 * | `capability_check` | L0 能力画像进了主线 |
 * | `skill_library_materialized` | L1 知识落盘 |
 * | `explore_select_completed` | L2 探索—择优跑了 |
 * | `symbolic_channel_run` | **L3 第一次被触发**（此前四次真实运行都没到） |
 * | `structure_fingerprint` | **L4 第一次被触发** |
 * | `closure_closed` + `delivery_graded` | L6 闭环收口 + 四档判定 |
 * | 交付物横幅无字面星号 | 生成的附录在下游渲染器里成立 |
 *
 * @module @deepseek-ai/dsh-paper-shell/tests/atomic-layers
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

interface AtomicRun {
  readonly audit: ReadonlyArray<{ readonly eventType: string; readonly detail?: Record<string, unknown> }>
  readonly report: string
  readonly outDir: string
}

/**
 * Run the whole chain offline and return what it produced.
 *
 * `--fake` is the offline provider: deterministic text, zero model calls, zero tokens.
 * That is what makes this an *atomic* check — every stage runs for real (parsing,
 * gates, chain, closure, export) while the model's contribution is held constant.
 */
function runOfflineChain(mode: 'strict' | 'fast'): AtomicRun {
  const outDir = mkdtempSync(join(tmpdir(), 'dph-atomic-'))
  // 跨平台：直接跑 tsx 的 CLI 入口，不经 `npx`（Windows 上 npx 是 .cmd，
  // spawnSync 找不到它——`npx ENOENT` 是一次实测踩到的形态）。
  execFileSync(process.execPath, [
    join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(repoRoot, 'apps', 'paper-shell', 'src', 'cli.ts'),
    'run', join(repoRoot, 'bench', 'problems', '2024-B', 'problem-faithful.md'),
    '--fake', '--mode', mode, '--capability-tier', 'A', '--out', outDir,
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 300_000, stdio: 'pipe' })
  const raw = JSON.parse(readFileSync(join(outDir, 'audit-trail.json'), 'utf8')) as
    | { events?: ReadonlyArray<{ eventType: string; detail?: Record<string, unknown> }> }
    | ReadonlyArray<{ eventType: string; detail?: Record<string, unknown> }>
  const audit = Array.isArray(raw) ? raw : (raw.events ?? [])
  const report = readFileSync(join(outDir, 'report.md'), 'utf8')
  return { audit, report, outDir }
}

const has = (run: AtomicRun, eventType: string): boolean => run.audit.some(e => e.eventType === eventType)

describe('原子验证 —— 离线跑一整条链，逐层取证', () => {
  // One offline run serves every assertion below; the chain is deterministic.
  let strict: AtomicRun

  it('链走完（不是兜底路径），且 L0–L6 每一层都在审计轨迹里', () => {
    strict = runOfflineChain('strict')

    // L0 能力画像
    expect(has(strict, 'capability_check'), 'L0 能力画像没进主线').toBe(true)
    // L1 知识外置落盘
    expect(has(strict, 'skill_library_materialized'), 'L1 技能库没落盘').toBe(true)
    // L2 探索—择优
    expect(has(strict, 'explore_select_completed'), 'L2 探索—择优没跑').toBe(true)
    // L3 符号证据通道 —— 此前四次真实运行都没触发过
    expect(has(strict, 'symbolic_channel_run'), 'L3 符号通道没触发（链没走到交付链尾？）').toBe(true)
    // L4 结构指纹
    expect(has(strict, 'structure_fingerprint'), 'L4 结构指纹没触发').toBe(true)
    // L6 门禁状态机 / 闭环 / 四档判定
    expect(has(strict, 'gate_state_changed'), 'L6 门禁状态机没记任何转移').toBe(true)
    expect(has(strict, 'closure_closed'), 'L6 闭环没收口').toBe(true)
    expect(has(strict, 'delivery_graded'), 'L6 四档判定没落审计').toBe(true)
  }, 300_000)

  it('交付路径是生产链，不是兜底（兜底意味着链没走通）', () => {
    const graded = strict.audit.find(e => e.eventType === 'delivery_graded')
    expect(graded, '没有 delivery_graded').toBeDefined()
    // 兜底路径（B-e1-direct）会判 DEGRADED；走通的生产链不该是它。
    expect(String(graded?.detail?.tier)).not.toBe('DEGRADED')
  })

  it('L3 的审计带级别与通过数（可核验，不是一句"跑过了"）', () => {
    const event = strict.audit.find(e => e.eventType === 'symbolic_channel_run')
    expect(event?.detail?.level).toBe('structural_check')
    expect(Number(event?.detail?.claims ?? 0)).toBeGreaterThan(0)
  })

  it('L4 的审计带结构指纹（换方法/增删方程/调假设都能被看见）', () => {
    const event = strict.audit.find(e => e.eventType === 'structure_fingerprint')
    expect(String(event?.detail?.struct_hash ?? '').length).toBeGreaterThan(8)
  })

  it('生成的附录**不含 markdown 强调/引用符**（下游渲染器里成立）', () => {
    // 事故：`**` 紧邻中日韩字符时 pandoc 不解析，交付的 PDF 里露出了字面星号；
    // `>` 块引用同样如此。生成的附录（横幅、已知缺陷表、缺口清单）一律用全角括号。
    //
    // CLEAN 交付**不附加横幅**（没有缺陷要标注），所以先看档位再断言。
    const tier = String(strict.audit.find(e => e.eventType === 'delivery_graded')?.detail?.tier ?? '')
    const head = strict.report.split(String.fromCharCode(10)).slice(0, 8).join(String.fromCharCode(10))
    if (tier !== 'CLEAN') {
      expect(head, `档位 ${tier} 却没有交付状态横幅`).toContain('【交付状态：')
    }
    // 无论哪个档位：抬头里都不该出现 markdown 强调或块引用（那是渲染事故的形态）。
    expect(head, '抬头里出现了 markdown 强调标记').not.toMatch(/\*\*/)
    expect(head, '抬头里出现了块引用符').not.toMatch(/^>\s/m)
  })

  it('交付包里的三件套按路径存在（report / 审计 / zip）', () => {
    for (const name of ['report.md', 'audit-trail.json', 'deliverable.zip']) {
      expect(existsSync(join(strict.outDir, name)), `交付包缺 ${name}`).toBe(true)
    }
  })

  it('每一次模型调用都有**无令牌看门狗**（不是墙钟——产出时长不可预设，挂住的连接才该被杀）', () => {
    // 两段事故史，两段判据：
    //   ① 路由声明 `timeoutMs: 60_000` 而 fetch 没有任何超时 → 挂住的中转把运行
    //      永久卡死（revise #3 停摆 25 分钟，审计一动不动）→ 必须有超时。
    //   ② 墙钟 PAPER_CALL_TIMEOUT_MS 会误杀**慢但健康**的长产出：2024B 真实运行
    //      实测阶段 1 产出 280KB 跑了 7 分钟、阶段 3 在 15 分钟处被拦腰截断。
    //      高质量建模的产出时长本来就不可预测。
    //   判据：**无令牌看门狗**（AbortController + 每个 chunk 重置喂狗）——只有持续
    //   无字节才判失败；退出路径必须清定时器；墙钟判据不得残留。
    const source = readFileSync(join(repoRoot, 'apps', 'paper-shell', 'src', 'real-provider.ts'), 'utf8')
    expect(source, 'provider 没有 AbortController 看门狗——挂住的调用会把运行卡死').toContain('new AbortController()')
    expect(source, '必须有 PAPER_IDLE_TIMEOUT_MS（无令牌判据）').toContain('PAPER_IDLE_TIMEOUT_MS')
    expect(source, '每个收到的 chunk 都要喂看门狗').toContain('bumpIdle()')
    expect(source, '退出路径必须清掉定时器（否则挂着进程不放）').toContain('stopIdle()')
    expect(source, '墙钟判据不得残留（它就是误杀长产出的那把刀）').not.toContain('PAPER_CALL_TIMEOUT_MS')
  })

  it('fast 档：不跑探索（成本随档位走），但链仍然走完', () => {
    const fast = runOfflineChain('fast')
    expect(has(fast, 'explore_select_completed'), 'fast 档不该跑探索').toBe(false)
    expect(has(fast, 'symbolic_channel_run'), 'fast 档的链也该走完并触发 L3').toBe(true)
    expect(readdirSync(fast.outDir).length).toBeGreaterThan(2)
  }, 300_000)
})
