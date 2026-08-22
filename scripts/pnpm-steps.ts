/**
 * Run one or more pnpm invocations in order, without a shell.
 *
 * Package scripts cannot chain `pnpm … && pnpm …` portably: the nested calls
 * rely on a bare `pnpm` being spawnable, which holds on a Linux CI image but
 * not on a Windows host where pnpm is reached through Corepack and no
 * `pnpm.cmd` sits on PATH. Every step therefore resolves pnpm's real entry
 * point from the lifecycle environment ({@link pnpmInvocation}) and spawns it
 * directly, so the same script works on every platform.
 *
 * Steps are the `--`-separated argument groups:
 *
 * ```
 * tsx scripts/pnpm-steps.ts --filter @deepseek-ai/website run build -- run verify-doc-site-fragments
 * ```
 * @module
 */

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pnpmInvocation } from './pnpm-invocation.ts'

/**
 * Split raw arguments into one argument list per pnpm step.
 * @param argv - arguments after the script path, `--` separating steps.
 * @returns each step's argument list, in order, with empty groups dropped.
 */
export function pnpmSteps(argv: readonly string[]): string[][] {
  const steps: string[][] = [[]]
  for (const arg of argv) {
    if (arg === '--') steps.push([])
    else (steps.at(-1) as string[]).push(arg)
  }
  return steps.filter(step => step.length > 0)
}

function main(): void {
  const steps = pnpmSteps(process.argv.slice(2))
  if (steps.length === 0) {
    console.error('pnpm-steps: expected at least one pnpm argument group.')
    process.exit(1)
  }
  for (const step of steps) {
    const { command, args } = pnpmInvocation(step)
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.error !== undefined) {
      console.error(`pnpm-steps: could not run 'pnpm ${step.join(' ')}': ${result.error.message}`)
      process.exit(1)
    }
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

// Importing this module for its exported splitter must not spawn anything.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
