/**
 * 规则语料索引 —— 恢复自参考工作流，**由只读工具按需取用**，不内联。
 *
 * ## 为什么不内联（这是一次真正的适配，不是简化）
 *
 * 参考里这些语料是让模型 `cat _utils/xxx.md` **按需读**的。它们合计 **809KB**：
 * `error-prevention.md` 128KB、`figure-recipes-advanced.md` 132KB、`figure-style-guide.md` 80KB…
 *
 * **内联进简报是不可能的**——一份 128KB 的文档塞进 prompt 会把简报本身淹掉，而且每阶段
 * 都要为它付一遍 token。我 S3 的做法（只放我手写的摘要）**既不是内联也不是取用**，
 * 它是把知识丢了。这一点由用户指出、也被 `adaptation.ts` 的台账固定为缺口。
 *
 * ## 适配方式：参考的 `cat` → 本机的**只读工具**
 *
 * 这与本项目的既有结论同源（round-5）：**把判据/知识做成工具，而不是写成请求**——
 * `check_container` 上线后容器级拒绝从 5 次清零。语料同理：给模型一个
 * `read_skill_doc(id)` 只读工具，它按需取用，与参考的 `cat` 等价而更可控
 * （能审计"读了哪几份"，也能限制单次返回体量）。
 *
 * ## 当前状态（诚实标注）
 *
 * **语料已恢复、索引已建；工具本身尚未接线。** 所以简报**暂时不点名这些文档**——
 * 点一份模型取不到的文档，等于又造了一条"无法被遵守的指令"（round-5 的原缺陷）。
 * 工具落地后，简报才改为列出索引 + 什么时候读哪一份。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/skill-docs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveStageAssetDir } from './asset-dir.ts'
import type { StageId } from './registry.ts'

/** 一份语料的索引项。 */
export interface SkillDoc {
  /** 工具取用时用的 id（稳定，别改——它是模型与审计共同的键）。 */
  readonly id: string
  /** 磁盘文件名（相对本模块目录）。 */
  readonly file: string
  readonly title: string
  /** 什么时候该读它（**这是给模型看的**，所以写成可判断的条件，不写"需要时"）。 */
  readonly whenToUse: string
  /** 哪几个阶段会用到它。 */
  readonly stages: ReadonlyArray<StageId>
}

/**
 * 语料索引。
 *
 * `whenToUse` 必须写成**可判断的条件**（"当你要写图表题注时"），
 * 而不是"需要时"——后者等于没说，模型无法据此决定读不读。
 */
export const SKILL_DOCS: ReadonlyArray<SkillDoc> = [
  {
    id: 'writing-rules', file: 'writing-rules.md', title: '中文竞赛论文写作规范',
    whenToUse: '当你要写或改论文正文的任何一章时（含摘要、问题重述、评价与推广、参考文献）',
    stages: ['paper', 'improve'],
  },
  {
    id: 'error-prevention', file: 'error-prevention.md', title: '全流程高发错误与预防清单',
    whenToUse: '当你准备提交任一阶段的产物之前（它是跨阶段的踩坑总表）',
    stages: ['prob-analysis', 'modeling', 'code', 'paper'],
  },
  {
    id: 'ai-disclosure-rules', file: 'ai-disclosure-rules.md', title: 'AI 使用声明规范',
    whenToUse: '当你要写论文的 AI 声明章时',
    stages: ['paper'],
  },
  {
    id: 'figure-style-guide', file: 'figure-style-guide.md', title: '图表风格规范',
    whenToUse: '当你要声明或审查任何一张图之前（字号下限、灰度可区分、配色禁令）',
    stages: ['figure', 'diagram', 'code'],
  },
  {
    id: 'figure-exemplars', file: 'figure-exemplars.md', title: '优秀图表范例',
    whenToUse: '当你要决定某类结果该配哪种图时',
    stages: ['figure', 'code'],
  },
  {
    id: 'figure-recipes-basic', file: 'figure-recipes-basic.md', title: '图型配方：基础',
    whenToUse: '当你声明的图属于折线/柱状/散点这类基础图型时',
    stages: ['figure', 'code'],
  },
  {
    id: 'figure-recipes-advanced', file: 'figure-recipes-advanced.md', title: '图型配方：进阶',
    whenToUse: '当你声明的图属于热力图/等值线/双轴/子图组合这类进阶图型时',
    stages: ['figure', 'code'],
  },
  {
    id: 'figure-recipes-academic', file: 'figure-recipes-academic.md', title: '图型配方：学术风',
    whenToUse: '当你声明的是校核图、误差图、收敛性图这类学术用途的图时',
    stages: ['figure', 'code'],
  },
  {
    id: 'figure-recipes-empirical', file: 'figure-recipes-empirical.md', title: '图型配方：经验分布类',
    whenToUse: '当你声明的图属于分布/箱线/小提琴/经验累积这类数据分布图时',
    stages: ['figure', 'code'],
  },
  {
    id: 'figure-recipes-competition', file: 'figure-recipes-competition.md', title: '图型配方：竞赛场景',
    whenToUse: '当你声明的图是竞赛论文里常见的对比图、灵敏度龙卷风图、决策树图时',
    stages: ['figure', 'code'],
  },
  {
    id: 'drawio-rules', file: 'drawio-rules.md', title: 'DrawIO 架构图规范',
    whenToUse: '当你要画流程/架构/框架图时',
    stages: ['diagram'],
  },
  {
    id: 'tikz-rules', file: 'tikz-rules.md', title: 'TikZ 精确几何图规范',
    whenToUse: '当你要画需要精确几何的示意图（控制体、边界条件、坐标变换）时',
    stages: ['diagram'],
  },
  {
    id: 'code-error-prevention', file: 'code-error-prevention.md', title: '编程实现防错清单',
    whenToUse: '当你写求解代码之前（数值稳定性、单位、边界、可复算性）',
    stages: ['code'],
  },
  {
    id: 'code-checks-index', file: 'code-checks-index.md', title: '检查清单总索引',
    whenToUse: '当你要自查结果是否可信，但不确定该查哪一类时（先读它）',
    stages: ['code'],
  },
  {
    id: 'code-checks-consistency', file: 'code-checks-consistency.md', title: '检查清单：一致性',
    whenToUse: '当你要核对多组结果之间是否自洽时',
    stages: ['code'],
  },
  {
    id: 'code-checks-evaluation', file: 'code-checks-evaluation.md', title: '检查清单：评价类结果',
    whenToUse: '当你的结果是评价/排序/打分这类产出时',
    stages: ['code'],
  },
  {
    id: 'code-checks-optimization', file: 'code-checks-optimization.md', title: '检查清单：优化类结果',
    whenToUse: '当你的结果是优化/决策/最优策略这类产出时（本题属于这一类）',
    stages: ['code'],
  },
  {
    id: 'code-checks-physical', file: 'code-checks-physical.md', title: '检查清单：物理量纲',
    whenToUse: '当你的模型涉及物理量、单位与量纲一致性时',
    stages: ['code'],
  },
  {
    id: 'code-checks-prediction', file: 'code-checks-prediction.md', title: '检查清单：预测类结果',
    whenToUse: '当你的结果是预测/外推/拟合这类产出时',
    stages: ['code'],
  },
  {
    id: 'code-checks-sanity-check', file: 'code-checks-sanity-check.md', title: '检查清单：数值自检',
    whenToUse: '当你要在提交前做最后一遍数值合理性检查时',
    stages: ['code'],
  },
]

/**
 * 本模块所在目录（`src/stages/`）。
 *
 * 语料在 `src/stages/skill-docs/` —— **路径必须从模块自身解析**，不能靠调用方拼。
 * 第一版这里漏了 `skill-docs/` 这一段，于是 `skillDocBody` 全部读不到；而测试里
 * 我自己另拼了一份带 `skill-docs/` 的路径，所以文件存在性检查全绿，
 * **只有真正调 `skillDocBody` 的那条抓到了**——两个路径各说各话就是这种结果。
 *
 * 路径**只能从 `resolveStageAssetDir` 来**：本包的产物是打包过的 `lib/index.js`，
 * 静态资源不会自动跟过去，所以解析要覆盖 src 与 lib 两种布局（见 `asset-dir.ts`）。
 */
export const SKILL_DOCS_DIR = resolveStageAssetDir('skill-docs').dir

/**
 * 取一份语料的正文。
 *
 * 读盘而不是内联成 TS 字符串：809KB 的字符串字面量会让编译与打包都变慢，而语料是
 * **静态资产**，本就不该进编译单元。代价是构建必须把它们复制到 `lib/` 旁边——
 * 这条由测试守住（`every registry entry's file exists`）。
 *
 * @param id - 索引 id。
 * @returns 正文；id 不存在时**抛错**（不返回空串——空串会让"没这份"和"这份是空的"混为一谈）。
 */
export function skillDocBody(id: string): string {
  const doc = SKILL_DOCS.find(d => d.id === id)
  if (doc === undefined) throw new Error(`unknown skill doc id: ${id}`)
  return readFileSync(join(SKILL_DOCS_DIR, doc.file), 'utf8')
}

/** 某阶段会用到哪几份语料。 */
export function docsForStage(stage: StageId): ReadonlyArray<SkillDoc> {
  return SKILL_DOCS.filter(d => d.stages.includes(stage))
}

/**
 * 语料索引块（给模型看的清单）。
 *
 * **当前未被任何简报引用**——工具还没接线。见模块头的"当前状态"。
 * 工具落地后，简报会用它列出"有哪些语料、什么时候读哪一份"。
 *
 * @param stage - 阶段。
 * @returns 多行清单（id / 标题 / 什么时候读）。
 */
export function skillDocIndexBlock(stage: StageId): string {
  const docs = docsForStage(stage)
  if (docs.length === 0) return ''
  return [
    '本阶段可用的参考语料（用 `read_skill_doc` 按需取用；不要一次全读）：',
    ...docs.map(d => `- \`${d.id}\` —— ${d.title}：${d.whenToUse}`),
  ].join('\n')
}
