/**
 * W8.9-A1 — code provenance + freshness guard.
 *
 * 事故（纪律 3，W8.8 run#1–3）：`tsc -b` 只把源码编译到 `lib/types/*.js`；
 * 包真正对外导出的 `lib/index.js` 由 `tsdown` 从 `lib/types/*.js` 再打一次。
 * 测试读 `src`（vitest 的 tsconfig `paths`），真实运行读 `lib`（包 exports）
 * —— 于是**真实运行跑的是旧 executor，而 1198 个测试全绿**。那次事故的
 * 代价是三轮真实 API 调用被浪费，且失败被误读为"模型不遵从协议"。
 *
 * 教训已归档，但归档不是守卫（W8.9-A1 禁止项逐字："没有守卫的教训会在
 * 下一次被遗忘"）。本模块把它变成**可执行的断言**：
 *
 *   真实运行开始前，对每个将被加载的 workspace 包，断言
 *     mtime(包入口 lib/index.js) >= mtime(该包 src 下最新文件)
 *   不满足 → 拒绝启动（fail-closed），并打印应执行的构建命令。
 *
 * 为什么是 mtime 而不是内容哈希：需要比较的是"这份 lib 是不是由当前 src
 * 生成的"，而源码→lib 的映射不是逐文件一一对应的（tsdown 打包成单文件）。
 * mtime 是**充分的**下界检查——src 更新而 lib 未重建，一定被抓到；反之
 * 重建后未改源码也不会误报。哈希方案需要一个构建时写入的清单文件，那会
 * 把守卫绑定到构建流程本身（守卫必须在构建被跳过时也能工作）。
 *
 * 判据的诚实边界：mtime 比较**不能**证明 lib 的内容与 src 语义一致（时钟
 * 回拨、手工 touch 都能骗过它）。它证明的是"没有发生'改了 src 却没重建'
 * 这一具体事故"。这是 A1 要求的范围，不多不少。
 *
 * @module apps/paper-shell/src/code-provenance
 */

import { statSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** One workspace package the run will load through its built entry. */
export interface ProvenanceTarget {
  /** Package name for the message (e.g. `@deepseek-ai/dsh-paper-foundation`). */
  readonly name: string
  /** Repo-relative directory of the package. */
  readonly dir: string
  /** The built entry the package's `exports` points at. */
  readonly entry: string
}

/** The result of checking one target. */
export interface ProvenanceCheck {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

/**
 * The newest mtime (ms) under `dir`, recursively, for files matching
 * `filter`. Returns null when the directory holds no matching file.
 *
 * Recursive because a package's sources live in subdirectories
 * (`src/ir/`, `src/delivery/`, …); a top-level-only scan would miss the
 * exact edit that matters (e.g. `src/delivery/execution-gate.ts`).
 */
export function newestMtime(dir: string, filter: (name: string) => boolean): number | null {
  if (!existsSync(dir)) return null
  let newest: number | null = null
  const walk = (current: string): void => {
    let entries: ReadonlyArray<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        // node_modules / build output are not sources; skipping them keeps
        // the scan bounded and avoids comparing lib against itself.
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue
        walk(full)
      } else if (entry.isFile() && filter(entry.name)) {
        try {
          const mtime = statSync(full).mtimeMs
          if (newest === null || mtime > newest) newest = mtime
        } catch {
          /* a file that vanished mid-scan is not a source of truth */
        }
      }
    }
  }
  walk(dir)
  return newest
}

/**
 * Check one target: the built entry must be at least as new as the newest
 * source file. A missing entry is a failure too — "the run would load a
 * package that has never been built" is the same class of hazard.
 */
export function checkProvenance(target: ProvenanceTarget): ProvenanceCheck {
  const entryPath = join(target.dir, target.entry)
  if (!existsSync(entryPath)) {
    return {
      name: target.name,
      ok: false,
      detail: `built entry missing: ${target.entry} — the package has never been built`,
    }
  }
  const entryMtime = statSync(entryPath).mtimeMs
  const srcMtime = newestMtime(join(target.dir, 'src'), name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
  if (srcMtime === null) {
    return { name: target.name, ok: true, detail: `no src/*.ts found under ${target.dir}/src — nothing to compare` }
  }
  const ok = entryMtime >= srcMtime
  const deltaMs = Math.round(entryMtime - srcMtime)
  return {
    name: target.name,
    ok,
    detail: ok
      ? `entry ${target.entry} is ${deltaMs} ms newer than the newest source`
      : `entry ${target.entry} is ${Math.abs(deltaMs)} ms OLDER than the newest source — the built entry is stale`,
  }
}

/** The verdict over every target, plus the remediation sentence. */
export interface ProvenanceVerdict {
  readonly ok: boolean
  readonly checks: ReadonlyArray<ProvenanceCheck>
  /** The command that fixes a failure; empty when ok. */
  readonly remediation: string
}

/**
 * Check every target. `ok` only when all pass (fail-closed).
 *
 * @param targets - the workspace packages the run loads.
 */
export function checkCodeProvenance(targets: ReadonlyArray<ProvenanceTarget>): ProvenanceVerdict {
  const checks = targets.map(checkProvenance)
  const ok = checks.every(c => c.ok)
  return {
    ok,
    checks,
    remediation: ok ? '' : 'npm run build:lib:host   # tsc -b + tsdown（真实运行读 lib，测试读 src）',
  }
}

/**
 * The workspace packages the paper-shell CLI loads through their built
 * entries. Kept as data so the CLI and the tests assert the same list.
 *
 * `dir` values are repo-relative; the caller resolves them against the
 * repo root it already computes for `bench/TRUTH-FAMILIES.json`.
 */
export const SHELL_PROVENANCE_TARGETS: ReadonlyArray<ProvenanceTarget> = [
  { name: '@deepseek-ai/dsh-paper-foundation', dir: 'packages/paper/paper-foundation', entry: 'lib/index.js' },
]
