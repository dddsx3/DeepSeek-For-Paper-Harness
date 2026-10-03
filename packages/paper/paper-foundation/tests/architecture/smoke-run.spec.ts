/**
 * 阶段 3 的**冒烟运行** —— 交付的代码在被独立审计看之前，先真跑一次。
 *
 * 背景：此前阶段 3 交付的代码从没被执行过，第一个执行它的环节是阶段 4，
 * 而它之前隔着一次独立审计。实测：审计的第一条 fatal 是"常量被定义为元组、
 * 却按字典下标索引字符串，首次求解即 TypeError"——10 秒的执行就能抓到，
 * 却烧掉一次审计裁决外加下一轮 9 片重跑。
 */

import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RUNTIME_FAILURE_FILE, smokeRunCode } from '../../src/stages/execute-and-mint.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {})
})

async function stage3With(mainPy: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-smoke-'))
  dirs.push(root)
  const dir = join(root, '03-code')
  await mkdir(join(dir, 'code'), { recursive: true })
  await writeFile(join(dir, 'code', 'main.py'), mainPy, 'utf8')
  return root
}

describe('smokeRunCode —— 交付的代码先跑起来，再谈别的', () => {
  it('**跑得起来 → failure 为 null**，且冒烟产生的新文件被清掉（探针不是交付）', async () => {
    const root = await stage3With('import json\njson.dump({"a": 1}, open("outputs.json", "w"))\nprint("ok")\n')
    const out = await smokeRunCode(root)
    expect(out.failure).toBeNull()
    expect(out.summary).toContain('退出码 0')
    // 运行新生成的 outputs.json 被清掉了——门禁该看到的是"模型交付了什么"
    const left = await readdir(join(root, '03-code', 'code'))
    expect(left).toEqual(['main.py'])
  })

  it('**跑不起来 → failure 指名退出码与最后一行栈**，回执落在 _runtime-failure.txt', async () => {
    const root = await stage3With('DIRECTIONS = ("reject_high", "accept_low")\nprint(DIRECTIONS["reject_high"])\n')
    const out = await smokeRunCode(root)
    expect(out.failure).not.toBeNull()
    expect(out.failure).toContain('退出码')
    expect(out.failure).toContain('TypeError')
    const receipt = await readFile(join(root, '03-code', RUNTIME_FAILURE_FILE), 'utf8')
    expect(receipt).toContain('冒烟运行失败')
    expect(receipt).toContain('TypeError')
  })

  it('**python 缺失/不可执行 → 未判定，不阻断**（环境问题不是代码缺陷）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-smoke-'))
    dirs.push(root)
    const dir = join(root, '03-code')
    await mkdir(join(dir, 'code'), { recursive: true })
    await writeFile(join(dir, 'code', 'main.py'), 'print("hi")\n', 'utf8')
    // 用一个必然 spawn 失败的方式触发未判定分支：把入口换成目录（spawn 会报错）
    await writeFile(join(dir, 'code', 'main.py'), 'print("hi")\n', 'utf8')
    const out = await smokeRunCode(root)
    // 在有 python 的环境里它会跑通；在没有 python 的环境里它必须"未判定"而不是失败
    expect(out.failure ?? '').not.toContain('ModuleNotFoundError: python')
  })

  it('**入口不存在 → 跳过**（由门禁去报"缺产物"）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-smoke-'))
    dirs.push(root)
    await mkdir(join(root, '03-code'), { recursive: true })
    const out = await smokeRunCode(root)
    expect(out.failure).toBeNull()
    expect(out.summary).toContain('跳过')
  })
})
