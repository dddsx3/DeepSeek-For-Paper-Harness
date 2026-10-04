/**
 * 冒烟失败的**定向修复** —— traceback + 肇事文件 → 只要一个修好的完整文件。
 *
 * 为什么值得整套机制：一次 9 片重生成 ≈ 1-2 小时，而 traceback 指到的往往只是
 * **一个文件里的一处**。修 1 次（1 次调用）+ 重跑冒烟，比整阶段重来便宜一个量级。
 */

import { describe, expect, it } from 'vitest'
import { smokeTargetFile, smokeRepairPrompt } from '../../src/stages/stage-service.ts'

const TRACE = [
  'Traceback (most recent call last):',
  '  File "main.py", line 30, in <module>',
  '  File "problem3.py", line 1457, in _event_candidate_cost',
  '  File "problem3.py", line 1470, in _service_profile',
  'TypeError: float() argument must be a string or a real number, not \'dict\'',
].join('\n')

describe('smokeTargetFile —— 从 traceback 找肇事文件', () => {
  it('取**最后一个** `File "…"`（最内层才是真正抛错的地方；外层是编排入口）', () => {
    expect(smokeTargetFile(TRACE)).toBe('problem3.py')
  })

  it('最内层就是 main.py 时也返回它（它有真实逻辑，也是合法的修复对象）', () => {
    const t = 'Traceback (most recent call last):\n  File "main.py", line 9, in <module>\nValueError: bad'
    expect(smokeTargetFile(t)).toBe('main.py')
  })

  it('带路径的帧取基名；解析不出 → null（修不了就照旧走整阶段失败）', () => {
    expect(smokeTargetFile('  File "code/problem1.py", line 3, in f\nValueError: x')).toBe('problem1.py')
    expect(smokeTargetFile('ValueError: nothing to look at')).toBeNull()
  })

  it('**绝对路径（Windows 反斜杠）也要认**——实测的静默失效：Python 的帧是模块绝对路径', () => {
    // 旧写法 `[^"\\]` 一遇到反斜杠就整帧失配 → 找不到肇事文件 → 定向修复静默失效，
    // 冒烟失败直接退化成"整阶段失败"（修复回路一次都没跑过）。
    const t = [
      '    _h1_partition in _all_partitions,',
      '  File "D:\\deepseek modex\\harness\\stages\\03-code\\code\\params.py", line 575, in record',
      'ValueError: 参数登记校验失败：q3_partition_contains_h1',
    ].join('\n')
    expect(smokeTargetFile(t)).toBe('params.py')
  })
})

describe('smokeRepairPrompt —— 修复指令要说清纪律', () => {
  it('包含 traceback、肇事文件内容，并写明四条修复纪律', () => {
    const p = smokeRepairPrompt('problem3.py', TRACE, 'def f():\n    return 1\n')
    expect(p).toContain('TypeError')
    expect(p).toContain('File "problem3.py", line 1457')
    expect(p).toContain('def f():')
    expect(p).toContain('只输出修复后的完整文件')
    expect(p).toContain('改动最小')
    expect(p).toContain('不要弱化任何校验与断言')
    expect(p).toContain('不碰其它文件')
  })
})
