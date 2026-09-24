/**
 * 迁移进来的资产 —— 模板与导出引擎。
 *
 * 判据是"**拷文件不等于能跑**"。第一版这条断言的是"引擎的三个依赖还没装"
 * （那时确实跑不起来）。依赖装上之后，判据换成**从引擎目录能不能解析到它们**——
 * "装在哪儿"不是判据（pnpm 的工作区布局会把它放进包自己的 node_modules），
 * "引擎 require 得到吗"才是。
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  DIAGRAM_TEMPLATES,
  DIAGRAM_TEMPLATES_DIR,
  DIAGRAM_THEME_FILE,
  DOCX_ENGINE_DIR,
  DOCX_ENGINE_EXTERNAL_DEPS,
  DOCX_ENGINE_FILES,
  diagramTemplate,
} from '../../src/stages/assets.ts'
import { stageBriefing } from '../../src/stages/briefing.ts'
import { stageOf } from '../../src/stages/registry.ts'

describe('图模板 —— 迁移与可用性', () => {
  it('五种模板 + 主题样式都在磁盘上，且都不是空壳', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      const html = readFileSync(join(DIAGRAM_TEMPLATES_DIR, t.file), 'utf8')
      expect(html.length, `${t.file} 是空的`).toBeGreaterThan(500)
      expect(html, `${t.file} 不像 HTML`).toContain('<')
    }
    expect(readFileSync(join(DIAGRAM_TEMPLATES_DIR, DIAGRAM_THEME_FILE), 'utf8').length).toBeGreaterThan(500)
  })

  it('**没有 modex 字样**（迁移时逐份核查）', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      expect(/modex/i.test(diagramTemplate(t.file))).toBe(false)
    }
  })

  it('**模板族与阶段 5 简报一一对应** —— 简报写了不存在的模板，模型就无从选起', () => {
    const text = stageBriefing(stageOf('diagram'), new Map(), false)
    for (const t of DIAGRAM_TEMPLATES) {
      expect(text, `简报里没有模板 ${t.id}`).toContain(t.id)
    }
  })

  it('未知模板名 → 抛错（不返回空串，空串会让"没这个模板"和"模板是空的"混为一谈）', () => {
    expect(() => diagramTemplate('tpl_nope.html')).toThrow(/unknown diagram template/)
  })
})

describe('导出引擎 —— 迁移完成，且**依赖真的可解析**', () => {
  it('引擎文件都在磁盘上（含主入口）', () => {
    for (const f of DOCX_ENGINE_FILES) {
      expect(existsSync(join(DOCX_ENGINE_DIR, f.file)), `${f.file} 不在`).toBe(true)
    }
    expect(readFileSync(join(DOCX_ENGINE_DIR, 'md_to_docx.js'), 'utf8').length).toBeGreaterThan(10_000)
  })

  it('**三个外部依赖从引擎目录可解析** —— 拷文件不等于能跑，装上了才算', () => {
    const requireFromEngine = createRequire(join(DOCX_ENGINE_DIR, 'md_to_docx.js'))
    for (const dep of DOCX_ENGINE_EXTERNAL_DEPS) {
      expect(() => requireFromEngine.resolve(dep), `${dep} 从引擎目录解析不到 —— 引擎跑不起来`).not.toThrow()
    }
    expect(DOCX_ENGINE_EXTERNAL_DEPS).toEqual(['docx', 'fast-xml-parser', 'temml'])
  })

  it('引擎自己的 `package.json` 声明了这三个依赖（迁移过来的声明不改写）', () => {
    const declared = JSON.parse(readFileSync(join(DOCX_ENGINE_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    for (const dep of DOCX_ENGINE_EXTERNAL_DEPS) {
      expect(declared.dependencies?.[dep], `引擎的 package.json 没声明 ${dep}`).toBeDefined()
    }
  })

  it('每个引擎文件都写明了它用到哪些依赖（"还差什么"可核，不靠记忆）', () => {
    for (const f of DOCX_ENGINE_FILES) {
      expect(f.role.length, `${f.file} 没写职责`).toBeGreaterThan(4)
      expect(Array.isArray(f.requires)).toBe(true)
    }
    // 三个依赖各自至少被一个文件用到 —— 没有孤儿依赖
    const used = new Set(DOCX_ENGINE_FILES.flatMap(f => f.requires))
    for (const dep of DOCX_ENGINE_EXTERNAL_DEPS) expect(used.has(dep), `${dep} 没被任何文件用到`).toBe(true)
  })
})
