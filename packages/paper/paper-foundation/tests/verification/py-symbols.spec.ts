/**
 * PY-SYMBOLS — AST 符号表打包层测试。
 *
 * 判定语义（`name`/`qualname`、空壳行数、docstring）由 `scripts/py-symbols.py`
 * 实现；这里对真实脚本跑输入-输出契约，并用注入桩覆盖通道故障的两条降级路径
 * （python 缺失 / 脚本输出非 JSON）——它们必须返回 `ok: false` 而不是抛异常。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync } from 'node:fs'
import { runPySymbols, PY_SYMBOLS_SCRIPT } from '../../src/verification/py-symbols.ts'

type SpawnSyncFn = typeof import('node:child_process').spawnSync

// spawnSync 可注入：绝大多数测试走真实子进程（pass-through），只有"输出非 JSON"
// 这类真实脚本不会走到的分支用桩覆盖。
const { spawnSyncMock, realSpawnSyncRef } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn<(...args: Parameters<SpawnSyncFn>) => ReturnType<SpawnSyncFn>>(),
  realSpawnSyncRef: { current: null as SpawnSyncFn | null },
}))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  realSpawnSyncRef.current = actual.spawnSync
  return { ...actual, spawnSync: spawnSyncMock }
})

describe('PY-SYMBOLS 打包层', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    const real = realSpawnSyncRef.current
    if (!real) throw new Error('child_process mock 未拿到真实实现')
    spawnSyncMock.mockImplementation((...args) => real(...args))
  })

  it('the script resolves inside the repo', () => {
    expect(existsSync(PY_SYMBOLS_SCRIPT)).toBe(true)
  })

  it('real script: defs / classes / nested qualnames / docstring / stub line counts', () => {
    const result = runPySymbols([['code/main.py', [
      'class Helper:',
      '    def _beta_params(self):',
      '        """M4 doc."""',
      '        a = 1',
      '        return a',
      '',
      'def outer():',
      '    def inner():',
      '        return 1',
      '    return inner',
    ].join('\n')]])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.classes).toEqual([{ name: 'Helper', file: 'code/main.py' }])
    const beta = result.defs.find(def => def.name === '_beta_params')
    expect(beta?.qualname).toBe('Helper._beta_params')
    expect(beta?.non_doc_lines).toBe(2)
    expect(beta?.stub).toBe(false)
    expect(beta?.docstring).toBe('M4 doc.')
    expect(result.defs.find(def => def.name === 'inner')?.qualname).toBe('outer.<locals>.inner')
  })

  it('stub 判定是 AST 级：pass/NotImplementedError 是空壳，**一行真实实现不是**（2024B _oc_accept 教训）', () => {
    const result = runPySymbols([['code/main.py', [
      'def a():',
      '    pass',
      'def b():',
      '    raise NotImplementedError',
      'def c():',
      '    ...',
      'def one_liner():',
      '    return [round(float(binom.cdf(c, n, p)), 10) for p in ps]',
      'def empty():',
      '    """只有 docstring。"""',
    ].join('\n')]])
    expect(result.ok).toBe(true)
    const byName = (name: string): boolean | undefined => result.defs.find(def => def.name === name)?.stub
    expect(byName('a')).toBe(true)
    expect(byName('b')).toBe(true)
    expect(byName('c')).toBe(true)
    expect(byName('empty')).toBe(true)
    // **一行列表推导是真实实现**——行数判据（>=2）会误杀它。
    expect(byName('one_liner')).toBe(false)
  })

  it('per-file SyntaxError is reported; other files still parsed', () => {
    const result = runPySymbols([
      ['code/bad.py', 'def broken(:\n    pass\n'],
      ['code/ok.py', 'def fine():\n    return 1\n'],
    ])
    expect(result.ok).toBe(true)
    expect(result.errors[0]?.file).toBe('code/bad.py')
    expect(result.errors[0]?.error).toContain('SyntaxError')
    expect(result.defs.map(def => def.name)).toEqual(['fine'])
  })

  it('degrades gracefully when python is missing (ok:false, EXEC error, no throw)', () => {
    vi.stubEnv('PYTHON', 'dsh-no-such-python-for-py-symbols')
    try {
      const result = runPySymbols([['code/main.py', 'x = 1']])
      expect(result.ok).toBe(false)
      expect(result.defs).toEqual([])
      expect(result.errors[0]?.file).toBe('<exec>')
      expect(result.errors[0]?.error.length).toBeGreaterThan(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('non-JSON stdout → ok:false, PARSE error, no throw', () => {
    const fake = { status: 0, stdout: '<html>crashed</html>', stderr: '' } as unknown as ReturnType<SpawnSyncFn>
    spawnSyncMock.mockReturnValue(fake)
    const result = runPySymbols([['code/main.py', 'x = 1']])
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.file).toBe('<parse>')
    expect(result.errors[0]?.error).toContain('非 JSON')
  })

  it('helper crash (non-zero exit) → ok:false with the stderr trail', () => {
    const fake = { status: 1, stdout: '', stderr: 'Traceback: boom' } as unknown as ReturnType<SpawnSyncFn>
    spawnSyncMock.mockReturnValue(fake)
    const result = runPySymbols([['code/main.py', 'x = 1']])
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.file).toBe('<exec>')
    expect(result.errors[0]?.error).toContain('boom')
  })

  it('valid JSON with ok:false / missing arrays → normalized empty arrays', () => {
    const fake = { status: 0, stdout: '{"ok":false}', stderr: '' } as unknown as ReturnType<SpawnSyncFn>
    spawnSyncMock.mockReturnValue(fake)
    expect(runPySymbols([['code/main.py', 'x = 1']]))
      .toEqual({ ok: false, defs: [], classes: [], errors: [] })
  })
})
