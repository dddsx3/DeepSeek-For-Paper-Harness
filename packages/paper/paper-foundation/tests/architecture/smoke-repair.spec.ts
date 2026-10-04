/**
 * 冒烟失败的**定向修复** —— traceback + 肇事文件 → 只要一个修好的完整文件。
 *
 * 为什么值得整套机制：一次 9 片重生成 ≈ 1-2 小时，而 traceback 指到的往往只是
 * **一个文件里的一处**。修 1 次（1 次调用）+ 重跑冒烟，比整阶段重来便宜一个量级。
 */

import { describe, expect, it } from 'vitest'
import { smokeInvolvedFiles, smokeRepairPrompt } from '../../src/stages/stage-service.ts'

const TRACE = [
  'Traceback (most recent call last):',
  '  File "main.py", line 30, in <module>',
  '  File "problem3.py", line 1457, in _event_candidate_cost',
  '  File "problem3.py", line 1470, in _service_profile',
  "TypeError: float() argument must be a string or a real number, not 'dict'",
].join('\n')

describe('smokeInvolvedFiles —— 从 traceback 提取**整条调用链**', () => {
  it('按出现顺序去重（修复需要看到 caller，不只是最内层）', () => {
    expect(smokeInvolvedFiles(TRACE)).toEqual(['main.py', 'problem3.py'])
  })

  it('最内层就是 main.py 时也返回它', () => {
    const t = 'Traceback (most recent call last):\n  File "main.py", line 9, in <module>\nValueError: bad'
    expect(smokeInvolvedFiles(t)).toEqual(['main.py'])
  })

  it('**绝对路径（Windows 反斜杠）也要认**——实测的静默失效：Python 的帧是模块绝对路径', () => {
    // 旧写法 `[^"\\]` 一遇到反斜杠就整帧失配 → 找不到肇事文件 → 定向修复静默失效，
    // 冒烟失败直接退化成"整阶段失败"（修复回路一次都没跑过）。
    const t = [
      '    _h1_partition in _all_partitions,',
      '  File "D:\\deepseek modex\\harness\\stages\\03-code\\code\\params.py", line 575, in record',
      'ValueError: 参数登记校验失败：q3_partition_contains_h1',
    ].join('\n')
    expect(smokeInvolvedFiles(t)).toEqual(['params.py'])
  })

  it('超过 3 个文件时只留最外层与最内层（prompt 大小有界）', () => {
    const t = [
      '  File "main.py", line 1, in <module>',
      '  File "a.py", line 2, in a',
      '  File "b.py", line 3, in b',
      '  File "c.py", line 4, in c',
      '  File "problem4.py", line 5, in d',
      'ValueError: x',
    ].join('\n')
    expect(smokeInvolvedFiles(t)).toEqual(['main.py', 'problem4.py'])
  })

  it('非本目录的帧按基名取出，但修复只会从 code/ 读文件（读不到自然放弃）', () => {
    // 第三方库（site-packages）的帧基名也可能撞上；不需要在这里区分——
    // `repairSmokeFailure` 只从 `code/` 读文件，读不到就放弃定向修复。
    expect(smokeInvolvedFiles('  File "site-packages\\numpy\\core.py", line 1, in f\nValueError: x')).toEqual(['core.py'])
    expect(smokeInvolvedFiles('ValueError: nothing')).toEqual([])
  })
})

describe('smokeRepairPrompt —— 修复指令要说清纪律', () => {
  it('包含 traceback、**全部涉案文件**内容，并写明修复纪律', () => {
    const contents = new Map([['problem3.py', 'def f():\n    return 1\n'], ['params.py', 'P = {}\n']])
    const p = smokeRepairPrompt(['params.py', 'problem3.py'], TRACE, contents)
    expect(p).toContain('TypeError')
    expect(p).toContain('File "problem3.py", line 1457')
    expect(p).toContain('def f():')
    expect(p).toContain('P = {}')
    expect(p).toContain('修复后的完整内容')
    expect(p).toContain('改动最小')
    expect(p).toContain('不要弱化任何校验与断言')
    expect(p).toContain('跨文件要一致')
  })

  it('**多文件时要求 JSON 信封**（跨文件修复要能同时改 caller 与 callee）', () => {
    const p = smokeRepairPrompt(['params.py', 'problem3.py'], TRACE, new Map([['params.py', 'x'], ['problem3.py', 'y']]))
    expect(p).toContain('{"files"')
    expect(p).toContain('`code/params.py`')
    expect(p).toContain('`code/problem3.py`')
  })

  it('单文件时不要求信封（原文形态更稳，少一层 JSON 转义）', () => {
    const p = smokeRepairPrompt(['main.py'], '  File "main.py", line 9, in <module>\nValueError: x', new Map([['main.py', 'print(1)']]))
    expect(p).not.toContain('{"files"')
    expect(p).toContain('print(1)')
  })
})
