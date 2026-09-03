/**
 * Execution runner seam (TASK 3, task book D3).
 *
 * The ONLY way code gets executed in the provenance layer. Capture and
 * replay both receive an {@link ExecutionRunner}; neither talks to a
 * process directly. That gives three properties the task book requires:
 *
 *   - **Producer-generated fields.** `exit_status`, the captured streams
 *     and the output bytes come from `ExecutionOutcome` — there is no
 *     API that lets a caller write them by hand (INV-3-B).
 *   - **Testability without processes.** Tests inject a deterministic
 *     fake runner; same request in, same outcome out.
 *   - **Sandboxing in one place.** The production runner enforces the
 *     timeout, the isolated working directory and stdin isolation.
 *
 * The runner is deliberately small: it executes the code it is given and
 * reports what happened. It is not a job queue, not a shell, and it does
 * not read or write canonical state.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** One execution request. `code` is the full text at RunArtifact.code_ref. */
export interface ExecutionRequest {
  readonly code: string
  readonly seed: string | number | null
  /** Wall-clock budget for the child process; 0 or below means no limit
   *  (tests only — the production runner always sets one). */
  readonly timeoutMs: number
}

/** One output artifact produced by the execution. `bytes` is UTF-8 text. */
export interface ExecutionOutputFile {
  readonly locator: string
  readonly bytes: string
}

/** What the runner observed. Every field is measured, never declared. */
export interface ExecutionOutcome {
  readonly exitStatus: number
  readonly stdout: string
  readonly stderr: string
  readonly outputFiles: ReadonlyArray<ExecutionOutputFile>
  /** Runner-measured environment facts (task book D4), e.g. the runtime
   *  version. Their canonical-JSON hash becomes
   *  `runtime_fingerprint_hash`. */
  readonly runtimeFacts: Readonly<Record<string, string>>
  readonly startedAt: string
  readonly finishedAt: string
}

export interface ExecutionRunner {
  run(request: ExecutionRequest): Promise<ExecutionOutcome>
}

export interface LocalProcessRunnerConfig {
  /** Command to run inside the sandbox cwd, e.g. `['node', 'main.js']`.
   *  The entry file named here is written from `request.code`. */
  readonly command: readonly string[]
  /** The file `code` is written to (the command's entry file). */
  readonly entryFile: string
  /** Basenames (inside the sandbox cwd) collected as output artifacts. */
  readonly outputBasenames: readonly string[]
  /** Full locators reported for the collected outputs, positionally
   *  aligned with `outputBasenames`. */
  readonly outputLocators: readonly string[]
  /** Wall-clock budget for the child process. Required — the production
   *  runner refuses to run without one. */
  readonly timeoutMs: number
  /** Commands whose stdout is recorded as runtime facts (D4), e.g.
   *  `[['node', '-p', 'process.version']]`. */
  readonly environmentFactsCommands?: ReadonlyArray<readonly string[]>
  /** Optional phase trace (TASK 3 C5 smoke). Off by default; the
   *  real-process smoke sets it so a CI hang can be attributed to the
   *  exact await instead of the whole phase. */
  readonly trace?: (message: string) => void
}

/**
 * The production runner: a bounded child process in a throwaway working
 * directory. Output artifacts are collected from the sandbox cwd after
 * the child exits; the directory is removed best-effort either way.
 */
export class LocalProcessRunner implements ExecutionRunner {
  constructor(private readonly config: LocalProcessRunnerConfig) {
    if (!(config.timeoutMs > 0)) {
      throw new Error('LocalProcessRunner requires a positive timeoutMs')
    }
    if (config.outputBasenames.length !== config.outputLocators.length) {
      throw new Error('outputBasenames and outputLocators must be aligned')
    }
  }

  async run(request: ExecutionRequest): Promise<ExecutionOutcome> {
    const trace = this.config.trace ?? (() => {})
    const startedAt = new Date().toISOString()
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-exec-'))
    try {
      trace(`runner: cwd=${cwd}`)
      await writeFile(join(cwd, this.config.entryFile), request.code, 'utf8')
      trace('runner: entry file written')
      const child = spawn(this.config.command[0]!, this.config.command.slice(1), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.config.timeoutMs,
      })
      trace(`runner: spawned pid=${child.pid}`)
      // Listen to BOTH streams AND the exit/error events immediately,
      // before awaiting anything. A fast child can close its pipes and
      // exit before listeners attached later would fire — 'end'/'exit'
      // fire exactly once, so a late listener never fires and the await
      // hangs forever. (Observed: CI stall where stdout ended in 31ms
      // and the stderr reader was attached only after stdout resolved;
      // reproduced locally with a short watchdog.) Reading concurrently
      // also drains both pipes so a chatty child cannot deadlock.
      const stdoutRead = streamToText(child.stdout)
      const stderrRead = streamToText(child.stderr)
      const exitStatusPromise = new Promise<number>((resolve) => {
        child.on('exit', (code, signal) => resolve(code ?? (signal === null ? -1 : -1)))
        child.on('error', () => resolve(-1))
      })
      const stdout = await stdoutRead
      trace('runner: stdout stream ended')
      const stderr = await stderrRead
      trace('runner: stderr stream ended')
      const exitStatus = await exitStatusPromise
      trace(`runner: child exited exitStatus=${exitStatus}`)
      const runtimeFacts = await this.collectRuntimeFacts()
      trace('runner: runtime facts collected')
      const outputFiles: ExecutionOutputFile[] = []
      for (let i = 0; i < this.config.outputBasenames.length; i += 1) {
        const basename = this.config.outputBasenames[i]!
        let bytes = ''
        try {
          bytes = await readFile(join(cwd, basename), 'utf8')
        } catch {
          // A missing output file is a finding, not a runner crash — the
          // replay's output-hash check reports it.
          bytes = ''
        }
        outputFiles.push({ locator: this.config.outputLocators[i]!, bytes })
      }
      trace('runner: outputs collected')
      const finishedAt = new Date().toISOString()
      return {
        exitStatus,
        stdout,
        stderr,
        outputFiles,
        runtimeFacts,
        startedAt,
        finishedAt,
      }
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {})
      trace('runner: cwd removed')
    }
  }

  private async collectRuntimeFacts(): Promise<Record<string, string>> {
    const trace = this.config.trace ?? (() => {})
    const facts: Record<string, string> = {}
    for (const command of this.config.environmentFactsCommands ?? []) {
      const key = command.join(' ')
      const child = spawn(command[0]!, command.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.config.timeoutMs,
      })
      trace(`runner: runtime-fact spawned pid=${child.pid} (${key})`)
      // Same missed-event discipline as run(): attach the readers and
      // the exit/error listeners before awaiting anything, so a fast
      // child cannot slip an 'end'/'exit' past a late listener.
      const stdoutRead = streamToText(child.stdout)
      const exited = new Promise<void>((resolve) => {
        child.on('exit', () => resolve())
        child.on('error', () => resolve())
      })
      const stdout = await stdoutRead
      await exited
      facts[key] = stdout.trim()
      trace(`runner: runtime-fact done (${key})`)
    }
    return facts
  }
}

function streamToText(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => { text += chunk })
    stream.on('end', () => resolve(text))
    stream.on('error', () => resolve(text))
  })
}