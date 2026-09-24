/**
 * 资产目录解析 —— **同一个模块在两种布局下要找到同一批文件**。
 *
 * 这条测试要防的是"模块做好但跑不起来"：测试读 `src`，真实运行读打包过的 `lib`
 * （§6），而静态资源不会被构建自动带过去。解析逻辑一旦只认"模块旁边"，
 * 测试全绿、真实运行第一步就炸。
 */

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveStageAssetDir, stageAssetDir } from '../../src/stages/asset-dir.ts'
import { DIAGRAM_TEMPLATES_DIR, DOCX_ENGINE_DIR } from '../../src/stages/assets.ts'
import { DOCX_PROFILES_DIR } from '../../src/stages/docx-profile.ts'
import { SKILL_DOCS_DIR, SKILL_DOCS, skillDocBody } from '../../src/stages/skill-docs.ts'
import { existsSync, readdirSync } from 'node:fs'

describe('资产目录 —— src 布局（模块旁边）', () => {
  it('三个资产目录都解析到真实存在的位置，且**不在 src 之外**', () => {
    const pkgRoot = join(import.meta.dirname, '..', '..')
    for (const [name, dir] of [['assets', DIAGRAM_TEMPLATES_DIR], ['skill-docs', SKILL_DOCS_DIR], ['docx-profiles', DOCX_PROFILES_DIR]] as const) {
      expect(existsSync(dir), `${name} 目录不存在：${dir}`).toBe(true)
      expect(dir.startsWith(pkgRoot), `${name} 解析到了包外：${dir}`).toBe(true)
      expect(readdirSync(dir).length, `${name} 目录是空的`).toBeGreaterThan(0)
    }
    // 导出引擎与模板都在 `assets/` 之下（单一来源，不各拼一份）
    expect(DIAGRAM_TEMPLATES_DIR.startsWith(stageAssetDir('assets'))).toBe(true)
    expect(DOCX_ENGINE_DIR.startsWith(stageAssetDir('assets'))).toBe(true)
  })

  it('语料真的读得出来（**只有真调 `skillDocBody` 才能发现路径拼错**）', () => {
    for (const doc of SKILL_DOCS) {
      const body = skillDocBody(doc.id)
      expect(Buffer.byteLength(body, 'utf8'), `${doc.id} 读出来是空的`).toBeGreaterThan(200)
    }
  })
})

describe('资产目录 —— lib 布局（构建产物旁边没有静态资源）', () => {
  it('模块旁边没有 → 回退到源码树，且**明确报告用的是哪一份**', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-asset-'))
    // 模拟打包后的布局：只有 `lib/`，静态资源仍在 `src/stages/` 下。
    await mkdir(join(root, 'src', 'stages', 'assets'), { recursive: true })
    const resolved = resolveStageAssetDir('assets', join(root, 'lib'))
    expect(resolved.layout).toBe('source-fallback')
    expect(resolved.dir).toBe(join(root, 'src', 'stages', 'assets'))
  })

  it('模块旁边有 → 用它（`beside` 是唯一"资产随产物走"的正确形态）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-asset-'))
    await mkdir(join(root, 'lib', 'assets'), { recursive: true })
    await mkdir(join(root, 'src', 'stages', 'assets'), { recursive: true })
    const resolved = resolveStageAssetDir('assets', join(root, 'lib'))
    expect(resolved.layout).toBe('beside')
    expect(resolved.dir).toBe(join(root, 'lib', 'assets'))
  })

  it('两处都没有 → **抛错并点名构建问题**（不返回空目录）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-asset-'))
    expect(() => resolveStageAssetDir('assets', join(root, 'lib'))).toThrow(/构建没有把静态资源复制到产物旁边/)
  })
})
