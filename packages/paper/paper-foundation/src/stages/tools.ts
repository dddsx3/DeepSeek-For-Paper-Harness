/**
 * 只读工具 —— 本管线里模型获取外部信息的**唯一通道**。
 *
 * ## 为什么工具要放在这里，而不是塞进 executor
 *
 * `ToolSpec` 是通用形状（名字 / 描述 / 参数 schema / 一个纯函数 `run`）。把它定义在
 * `executor.ts` 里会让"工具的实现"反向依赖"工具的宿主"——而 `read_skill_doc` 的实现
 * 只需要语料索引，不需要 executor 的任何东西。所以形状与实现都在本模块，
 * executor 只负责**挂载**。
 *
 * ## 两个工具的分工
 *
 * | 工具 | 回答什么 | 宿主 |
 * |---|---|---|
 * | `check_container` | "我这份容器能被准入吗" | executor（判据在 `produce/self-check.ts`） |
 * | `read_skill_doc` | "这条规范到底怎么写的" | 本模块（语料在 `skill-docs/`） |
 *
 * 两者都是**只读**：不改状态、不碰文件系统之外的任何东西、不执行代码。所以即使模型滥用，
 * 代价上限只是多几轮。
 *
 * ## 纪律：`run` **不得抛错**
 *
 * 工具是帮忙的，不是新的门。抛错会让整次模型调用作废，而正确答案是"这次没帮上忙"。
 * 未知 id、参数缺失、语料读取失败——一律返回**一句可读的话**，让模型自己纠正。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/tools
 */

import { SKILL_DOCS, skillDocBody, type SkillDoc } from './skill-docs.ts'
import type { StageId } from './registry.ts'

/** 一个只读工具的规格。 */
export interface ToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  /** 执行一次调用，返回给模型看的文本。**不得抛错**。 */
  readonly run: (args: Record<string, unknown>) => string
}

/** 取语料的工具名（模型看到的函数名）。 */
export const READ_SKILL_DOC_TOOL = 'read_skill_doc'

/**
 * 构造 `read_skill_doc` 工具。
 *
 * 参考工作流里这一步是模型自己 `cat _utils/xxx.md`。本管线没有文件工具，所以把它
 * **工具化**：等价、且更可控（能审计读了哪几份，也能限制单次返回体量）。
 *
 * @param stage - 当前阶段（决定**可见的语料范围**——不是所有语料都对所有阶段开放，
 *   一份与本题无关的图型配方读进来只会占上下文）。
 * @param maxBytes - 单次返回的字节上限（超出即截断并**明说被截断**，不静默）。
 * @returns 工具规格。
 */
export function skillDocToolSpec(stage: StageId, maxBytes = 60_000): ToolSpec {
  const visible = SKILL_DOCS.filter(d => d.stages.includes(stage))
  const list = visible.map(d => `- \`${d.id}\`（${d.title}，约 ${String(Math.round(docBytes(d) / 1024))}KB）：${d.whenToUse}`)
  return {
    name: READ_SKILL_DOC_TOOL,
    description: [
      'Read one reference document (writing rules, figure recipes, code checklists) by id.',
      'These are the competition-grade rules this harness holds itself to; they are long, so read only what you need, when you need it.',
      'Call it with {"id": "<doc id>"} to fetch one document, or with {} to list what is available.',
      'The returned text is the document verbatim — it is authoritative, not a summary.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'document id from the list; omit to list all available ids' },
      },
      required: [],
      additionalProperties: false,
    },
    run: (args) => {
      const id = args['id']
      if (typeof id !== 'string' || id.length === 0) {
        return list.length === 0
          ? '本阶段没有可读的参考语料。'
          : ['本阶段可读的参考语料（用 {"id": "<id>"} 取其中一份）：', ...list].join(String.fromCharCode(10))
      }
      const doc = visible.find(d => d.id === id)
      if (doc === undefined) {
        // 模型可能拼错 id，或要一份本阶段不开放的语料——两种情况都回一句可纠正的话。
        const elsewhere = SKILL_DOCS.find(d => d.id === id)
        return elsewhere === undefined
          ? `没有 id 为 '${id}' 的语料。可读的：${visible.map(d => d.id).join('、') || '（无）'}`
          : `语料 '${id}' 存在，但本阶段（${stage}）不开放它——它服务于 ${elsewhere.stages.join('、')}。`
      }
      let body: string
      try {
        body = skillDocBody(id)
      } catch (error) {
        // 读盘失败（打包时没把 .md 复制到 lib 旁边）——**如实说**，不假装"文档是空的"。
        return `语料 '${id}' 读取失败：${error instanceof Error ? error.message : String(error)}。`
          + '这是 harness 的装配问题，不是你的输入问题；请按你已有的知识继续。'
      }
      if (Buffer.byteLength(body, 'utf8') <= maxBytes) return body
      // 截断必须**明说**——静默截断会让模型以为读完了。
      const cut = Buffer.from(body, 'utf8').subarray(0, maxBytes).toString('utf8')
      return [cut, '', `（以上是 '${id}' 的前 ${String(maxBytes)} 字节——**文档被截断**，不是到此为止。`,
        '需要后半部分请再取一次，或按上文已给的部分工作。）'].join(String.fromCharCode(10))
    },
  }
}

/** 语料字节数（用于索引里显示体量，让模型知道"这份值不值得读"）。 */
function docBytes(doc: SkillDoc): number {
  try {
    return Buffer.byteLength(skillDocBody(doc.id), 'utf8')
  } catch {
    return 0
  }
}
