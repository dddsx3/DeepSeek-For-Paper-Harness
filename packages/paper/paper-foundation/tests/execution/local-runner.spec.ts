/**
 * LocalProcessRunner seam contract (pure logic).
 *
 * The real-process end-to-end smoke lives OUTSIDE vitest, in
 * `artifacts/handoff/TASK-3/run-real-execution-smoke.mjs`: under the
 * full regression's memory load, spawning a child node process can
 * starve for tens of seconds on this machine, and a flaky timeout is
 * exactly the kind of noise the TASK 1.5R discipline forbids in a
 * mutation/regression suite. The deterministic-fake runner covers the
 * capture/replay contracts; this file pins the seam's pure-logic
 * contract; the smoke script provides the real-process evidence (C5).
 */
import { describe, expect, it } from 'vitest'
import { LocalProcessRunner } from '../../src/execution/index.ts'

describe('LocalProcessRunner — seam contract', () => {
  it('refuses to run without a timeout (production runner is always bounded)', () => {
    expect(() => new LocalProcessRunner({
      command: ['node', 'main.js'],
      entryFile: 'main.js',
      outputBasenames: ['result.json'],
      outputLocators: ['file:///runs/RUN1/result.json'],
      timeoutMs: 0,
    })).toThrow(/positive timeoutMs/)
  })

  it('requires outputBasenames and outputLocators to stay aligned', () => {
    expect(() => new LocalProcessRunner({
      command: ['node', 'main.js'],
      entryFile: 'main.js',
      outputBasenames: ['a.json', 'b.json'],
      outputLocators: ['file:///a.json'],
      timeoutMs: 1_000,
    })).toThrow(/aligned/)
  })
})