import { describe, expect, it } from 'vitest'
import { pnpmSteps } from './pnpm-steps.ts'

describe('pnpmSteps', () => {
  it('treats a single argument group as one step', () => {
    expect(pnpmSteps(['--filter', '@deepseek-ai/website', 'run', 'build']))
      .toEqual([['--filter', '@deepseek-ai/website', 'run', 'build']])
  })

  it('splits chained steps on the separator', () => {
    expect(pnpmSteps(['--filter', 'site', 'run', 'build', '--', 'run', 'verify']))
      .toEqual([['--filter', 'site', 'run', 'build'], ['run', 'verify']])
  })

  it('keeps a step argument that only looks like a flag', () => {
    expect(pnpmSteps(['exec', 'vitepress', 'build', '.', '--mpa', '--', 'run', 'verify']))
      .toEqual([['exec', 'vitepress', 'build', '.', '--mpa'], ['run', 'verify']])
  })

  it('drops empty groups from leading, repeated, or trailing separators', () => {
    expect(pnpmSteps(['--', 'run', 'one', '--', '--', 'run', 'two', '--']))
      .toEqual([['run', 'one'], ['run', 'two']])
  })

  it('reports no steps for no arguments', () => {
    expect(pnpmSteps([])).toEqual([])
  })
})
