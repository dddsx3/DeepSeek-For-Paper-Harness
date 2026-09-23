/**
 * L0 — 能力探针**执行器**。
 *
 * ## 为什么探针任务必须"可机械判定"
 *
 * 一个"让模型写段话、再让另一个模型打分"的探针，测的是评审的偏好，不是模型与
 * 本架构的匹配度。因此三个探针各自有**确定性判据**：
 *
 * | 探针 | 任务 | 判据 | 为什么架构依赖它 |
 * |---|---|---|---|
 * | `structure` | 产出一个最小 `ir-container-v1` 容器 | 解析成功 **且** 版本标记是**第一个键** | 容器不合规则整条生产链拿不到任何产物 |
 * | `execution` | 写一段 Node 代码把指定数值写进文件 | **真的跑一遍**，输出文件里的数在容差内 | 生产链的每个数字都来自这段代码 |
 * | `symbolic` | 解一个一阶线性 ODE 并给出 t=1 的值 | 数值在容差内 | 决定符号证据通道能不能用得上 |
 *
 * 判据全是**机器判的**，因此同一份回答必然得到同一个档位——探针本身可回归。
 *
 * ## 成本
 *
 * 三次模型调用 + 一次子进程执行，约 1–2 分钟。相对一次完整运行（数十分钟）可忽略，
 * 换来的是整个运行期的约束适配。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/probe/probe-runner
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assessCapability, type CapabilityProfile, type ProbeKind, type ProbeObservation } from './capability-profile.ts'
import { MODEL_CONTAINER, MODEL_CONTAINER_VERSION } from '../produce/ir-producer.ts'

/** 探针调用的抽象：给一段 prompt，拿回模型的文本。 */
export type ProbeCall = (prompt: string) => Promise<string>

/** 数值容差：相对误差 1e-3（三位有效数字的题面，留一个数量级的余量）。 */
export const PROBE_NUMERIC_TOLERANCE = 1e-3

/** 三个探针的 prompt。**它们只描述任务，不透露判据**——透露判据等于教模型作弊。 */
export const PROBE_PROMPTS: Readonly<Record<ProbeKind, string>> = {
  structure: [
    'Produce ONE JSON object and nothing else. It must be a minimal ir-container-v1 declaration:',
    `  {"${MODEL_CONTAINER}":"${MODEL_CONTAINER_VERSION}","entries":[{"kind":"SymbolSpec","value":{...}}],"code":"...","run":{"outputBasenames":["out.json"],"seed":1}}`,
    'Declare exactly one SymbolSpec whose symbol_id is "S-X", token "x", meaning "a quantity", unit "dimensionless", role "VARIABLE", shape "SCALAR", domain "REAL", index_set [].',
    'The version marker MUST be the FIRST key of the single JSON object. No prose, no markdown fence.',
  ].join('\n'),
  execution: [
    'Write a Node.js script that writes a JSON file named `out.json` containing exactly',
    '  {"value": <the value of sum_{i=1}^{40} i^2>}',
    'Return ONLY the JavaScript source (no markdown fence, no explanation). It will be executed with `node main.js` in a directory where `out.json` is writable.',
  ].join('\n'),
  symbolic: [
    'Solve the ODE  dT/dt = -k * (T - T_env)  with T(0) = T0, where k = 0.5, T0 = 100, T_env = 20.',
    'Report T at t = 1, rounded to 3 significant digits.',
    'Return ONLY a JSON object: {"value": <number>}. No prose, no markdown fence.',
  ].join('\n'),
}

/** 探针的期望值（机械判据的右端）。 */
export const PROBE_EXPECTED: Readonly<Record<ProbeKind, number>> = {
  // sum of squares 1..40 = 40*41*81/6 = 22140
  execution: 22140,
  // T(1) = 20 + 80*exp(-0.5) = 68.52...
  symbolic: 20 + 80 * Math.exp(-0.5),
  // structure is not numeric; its expectation is a shape.
  structure: 0,
}

/** 相对误差是否在容差内。`expected === 0` 时退化为绝对比较。 */
export function withinTolerance(actual: number, expected: number, tolerance = PROBE_NUMERIC_TOLERANCE): boolean {
  if (!Number.isFinite(actual)) return false
  if (expected === 0) return Math.abs(actual) <= tolerance
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerance
}

/** 从一段文本里抠出第一个 JSON 对象（容忍 markdown fence 与前后散文）。 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/**
 * `structure` 探针的判据：容器能解析，**且版本标记是第一个键**。
 *
 * "是第一个键"不是吹毛求疵：生产链的准入检查就是这个（容器缺标记或标记不是首键
 * 会被拒），探针必须与它测同一件事，否则档位与真实表现脱节。
 *
 * @param text - 模型输出。
 */
export function judgeStructureProbe(text: string): { readonly passed: boolean; readonly detail: string } {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').trim()
  const marker = `"${MODEL_CONTAINER}"`
  if (!trimmed.startsWith('{')) {
    return { passed: false, detail: `输出不是以 '{' 开头（前 40 字符：${JSON.stringify(trimmed.slice(0, 40))}）` }
  }
  if (!trimmed.startsWith(`{${marker}`)) {
    return { passed: false, detail: `版本标记不是第一个键（前 40 字符：${JSON.stringify(trimmed.slice(0, 40))}）` }
  }
  const parsed = extractJsonObject(trimmed)
  if (parsed === null) return { passed: false, detail: 'JSON 无法解析' }
  if (parsed[MODEL_CONTAINER] !== MODEL_CONTAINER_VERSION) {
    return { passed: false, detail: `版本标记值不是 ${MODEL_CONTAINER_VERSION}` }
  }
  const entries = parsed['entries']
  if (!Array.isArray(entries) || entries.length === 0) {
    return { passed: false, detail: 'entries 不是非空数组' }
  }
  return { passed: true, detail: `容器合规（${String(entries.length)} 条 entry，首键为版本标记）` }
}

/**
 * `execution` 探针的判据：**真的把代码跑一遍**。
 *
 * 只判"代码看起来对不对"会测到措辞，测不到能不能跑。这里落盘 → `node main.js`
 * → 读 `out.json` → 比数值。模型写不出可运行代码时，生产链的每个数字都会丢，
 * 所以这一项必须真跑。
 *
 * @param text - 模型给出的 JS 源码。
 * @param nodeBinary - node 可执行文件名（测试可注入）。
 */
export function judgeExecutionProbe(
  text: string,
  nodeBinary = 'node',
): { readonly passed: boolean; readonly detail: string } {
  const source = text.trim().replace(/^```(?:javascript|js)?/i, '').replace(/```$/, '').trim()
  if (source.length === 0) return { passed: false, detail: '没有给出任何代码' }
  const dir = mkdtempSync(join(tmpdir(), 'dph-probe-exec-'))
  try {
    writeFileSync(join(dir, 'main.js'), source, 'utf8')
    const run = spawnSync(nodeBinary, ['main.js'], { cwd: dir, encoding: 'utf8', timeout: 30_000 })
    if (run.status !== 0) {
      return { passed: false, detail: `代码执行失败（退出 ${String(run.status)}）：${String(run.stderr ?? '').slice(0, 200)}` }
    }
    let value: unknown
    try {
      value = (JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as { value?: unknown }).value
    } catch (error) {
      return { passed: false, detail: `out.json 缺失或不可解析：${(error as Error).message}` }
    }
    if (typeof value !== 'number') return { passed: false, detail: `out.json 的 value 不是数字：${JSON.stringify(value)}` }
    const ok = withinTolerance(value, PROBE_EXPECTED.execution)
    return {
      passed: ok,
      detail: ok
        ? `代码真实跑通，输出 ${String(value)}（期望 ${String(PROBE_EXPECTED.execution)}）`
        : `代码跑通但结果错误：输出 ${String(value)}，期望 ${String(PROBE_EXPECTED.execution)}`,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * `symbolic` 探针的判据：数值在容差内。
 *
 * @param text - 模型输出（应含 `{"value": <number>}`）。
 */
export function judgeSymbolicProbe(text: string): { readonly passed: boolean; readonly detail: string } {
  const parsed = extractJsonObject(text)
  if (parsed === null) return { passed: false, detail: '输出里没有可解析的 JSON 对象' }
  const value = parsed['value']
  if (typeof value !== 'number') return { passed: false, detail: `value 不是数字：${JSON.stringify(value)}` }
  const ok = withinTolerance(value, PROBE_EXPECTED.symbolic)
  return {
    passed: ok,
    detail: ok
      ? `解析解正确：${String(value)}（期望约 ${PROBE_EXPECTED.symbolic.toFixed(3)}）`
      : `解析解错误：${String(value)}，期望约 ${PROBE_EXPECTED.symbolic.toFixed(3)}`,
  }
}

/**
 * 跑完三个探针并判档。
 *
 * **一个探针抛异常不会中断整轮**：它记为未通过，原因如实写进 detail。理由与
 * 运行期一致——探针是"给多少脚手架"的依据，不是"能不能跑"的门。
 *
 * @param call - 模型调用（prompt → 文本）。
 * @param options - 可注入 node 可执行名与时钟，便于测试。
 */
export async function runCapabilityProbes(
  call: ProbeCall,
  options: { readonly nodeBinary?: string; readonly now?: () => number } = {},
): Promise<CapabilityProfile> {
  const now = options.now ?? (() => Date.now())
  const observations: ProbeObservation[] = []
  for (const kind of ['structure', 'execution', 'symbolic'] as const) {
    const started = now()
    try {
      const text = await call(PROBE_PROMPTS[kind])
      const verdict = kind === 'structure'
        ? judgeStructureProbe(text)
        : (kind === 'execution' ? judgeExecutionProbe(text, options.nodeBinary ?? 'node') : judgeSymbolicProbe(text))
      observations.push({ kind, passed: verdict.passed, detail: verdict.detail, elapsedMs: now() - started })
    } catch (error) {
      observations.push({
        kind,
        passed: false,
        detail: `探针调用失败：${(error as Error).message}`,
        elapsedMs: now() - started,
      })
    }
  }
  return assessCapability(observations)
}
