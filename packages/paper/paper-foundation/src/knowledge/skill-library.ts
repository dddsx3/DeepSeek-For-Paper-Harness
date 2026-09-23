/**
 * L1 — 知识外置库（`skills/`）。
 *
 * ## 这一层解决什么
 *
 * 旧形态把"怎么写好建模论文"编译进 prompt，于是**每个 token 都是全员强制预载**：
 * 一个已经会写问题分析的强模型，照样要先读完写作规范、方法族手册、评分口径，
 * 才能开始想问题。省下的那部分注意力，本来可以用在建模上。
 *
 * 新形态：知识**外置为可查询的文档**，prompt 里只留**索引**（id + 什么时候读它）。
 * 模型在动笔前觉得没底，自己 \`read_file\` 去看。token 成本从"每次运行都付"
 * 变成"需要时才付"。
 *
 * ## 单一真相源
 *
 * 文档正文是 TS 常量（\`skills/paper-contract.ts\` / \`skills/library-docs.ts\`），
 * 因此：
 *   - 打包时不需要额外的资源拷贝（不存在"lib 里少了 skills/ 目录"这类事故）；
 *   - 文档里引用的篇幅数值来自 \`PAPER_LENGTH_REFERENCE\`，与门禁**同源**，
 *     不会出现"文档说 1200、门禁查 800"的漂移。
 *
 * \`materializeSkillLibrary(dir)\` 在运行开始时把文档**写到工作区**，模型才能真的
 * \`read_file\` 到它们——索引里写着一个读不到的路径，等于没写。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/knowledge/skill-library
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PAPER_CONTRACT_SKILL } from './skills/paper-contract.ts'
import { LIBRARY_DOCS } from './skills/library-docs.ts'

/** 技能库在工作区里的目录名（相对运行根）。 */
export const SKILL_LIBRARY_DIR = 'skills'

/** 一份可查询的知识文档。 */
export interface SkillDoc {
  /** 文档 id，也是它的文件名（不含 `.md`）。 */
  readonly id: string
  /** 人读的标题。 */
  readonly title: string
  /** **什么时候该读它**——索引行里给模型看的唯一信息。 */
  readonly whenToRead: string
  /** 正文（Markdown）。 */
  readonly body: string
}

/** 全部文档，按 id 升序稳定排列。 */
export const SKILL_DOCS: ReadonlyArray<SkillDoc> = [
  { id: 'paper-contract', title: '论文契约', whenToRead: '写 narrative 之前（章节骨架、摘要、逐问覆盖、假设闭环、参考文献纪律）', body: PAPER_CONTRACT_SKILL },
  ...LIBRARY_DOCS.map(d => ({ id: d.id, title: d.title, whenToRead: d.whenToRead, body: d.body })),
].filter(d => d.body.length > 0)

/**
 * 流水线的步骤——每个步骤有自己的**必读指针**。
 *
 * 判据来自对优秀参考实现的结构分析：它**不**给模型一份"知识库目录"让它自己挑，
 * 而是**在需要知识的那一步**指名文件、说明里面有什么、并标"必读"。同一个工作区
 * 指令文件里，短且永远需要的规则（竞赛规则、输出格式、核心原则）是**嵌入**的，
 * 而长材料（题面原文）标"按需读取"、规范类文件标"必读"。
 *
 * 两者的差别是**可观测的**：那份实现里，模型自己说"我先读它"并真的读了被指名的
 * 文件；而目录式邀请（"这里有一堆文档，需要时自己查"）没有留下被读取的证据。
 */
export const BRIEFING_STEPS = ['analyze', 'explore', 'select', 'produce', 'review', 'revise'] as const
export type BriefingStep = (typeof BRIEFING_STEPS)[number]

/** 每一步该读哪几份、以及**为什么**该读它（内容摘要 + 必读标记）。 */
const STEP_READING: Readonly<Record<BriefingStep, ReadonlyArray<{ id: string; why: string }>>> = {
  // E1 写的是**散文分析**，不是容器。它需要的知识只有锚点语法与逐问覆盖——那两条
  // 已经在 `e1AnalysisInstruction` 里说清了，所以这里**不内联任何文档**。
  // 给它内联产出步那 10KB（容器契约、章节要素、数字通道）会把"写散文"的指令淹掉，
  // 而那正是 W8.10-D4 修掉的矛盾。
  analyze: [],
  explore: [
    { id: 'explore-select-deepen', why: '三段流程的产出形态、择优与回溯的记录格式' },
    { id: 'modeling-playbook', why: '各方法族的适用条件与高发陷阱（判断"这个方法能不能撑住这一问"）' },
  ],
  select: [
    { id: 'explore-select-deepen', why: '择优记录的必需字段（候选数 / 四维打分 / 选择理由 / 每个落选者的理由）' },
    { id: 'judging-criteria', why: '评委的权重顺序——它决定"哪个候选更值得深挖"' },
  ],
  produce: [
    { id: 'evidence-and-numbers', why: '数字进入正文的**两条合法通道**与六类常见踩坑（写结论前必看）' },
    { id: 'paper-contract', why: '章节骨架、摘要骨架、逐问覆盖、假设闭环、**交付前自检清单**' },
    { id: 'writing-norms', why: '每章的篇幅参照与要素清单、去 AI 味对照表' },
    { id: 'symbolic-verification', why: '解析推导写成可执行断言的形态与证据级别措辞纪律' },
  ],
  review: [
    { id: 'judging-criteria', why: '评分口径与扣分形态——它决定"这条缺陷值不值得报"（误报会淹没队列）' },
  ],
  revise: [
    { id: 'writing-norms', why: '被退回的章节差在哪：篇幅参照、要素清单、去 AI 味对照表' },
    { id: 'paper-contract', why: '章节要素与交付前自检清单' },
  ],
}

/**
 * **提交前自检**——只列**机器会拒**的那几条，且每条都给出"怎么自己验"。
 *
 * ## 为什么要有这一块（四轮实测的证据）
 *
 * 最高频的两类失败都不是"知识不足"，而是**同一份输出内部自相矛盾**：
 *
 * | 失败 | 出现次数 | 真实成因 |
 * |---|---|---|
 * | `physical key 'S_P1' does not resolve to any declared SymbolSpec` | 4 | 给一个**自己没声明**的量写了 `numeric_config.json` 的键 |
 * | `container 'entries' must be a non-empty array` | 4 | 输出被截断或形状写坏 |
 *
 * 这两条 harness 都能机械判，**而且模型自己也能判**——它只要在提交前把自己的
 * 声明列表与配置键对一遍。把这一步写进 prompt，比再写一条"要注意命名"的教学
 * 有效得多：前者是**可执行的检查**，后者是**提醒**。
 *
 * ## 形态来自对优秀参考实现的结构分析
 *
 * 它的"本步骤上下文"里有一栏就叫**完成标志**，写的是一条**可机械核验**的终止
 * 条件（"报告写入工作区根目录；如有自动修复，源 md 已被 Edit 工具修改"）。
 * 本块是同一形态：**提交前逐条过，过不了就别提交。**
 */
export const PRE_SUBMIT_CHECKS = [
  'BEFORE YOU EMIT — run these checks yourself, in this order. Each one is refused mechanically, and each refusal costs you a whole attempt:',
  '  1. The output starts with `{"__dsh_paper":"ir-container-v1"` — that marker is the FIRST KEY of ONE single JSON object (not its own object, not a second object after it).',
  '  2. `entries` is a NON-EMPTY array, and every element is exactly `{"kind": <KIND>, "value": <object>}`. An empty or missing `entries` refuses the container.',
  '  3. Write your declared symbol list down (every `SymbolSpec`: its `token` and its `symbol_id`), then check EVERY key of `numeric_config.json` against it: each key must be EXACTLY one of those tokens or ids. A key for a quantity you never declared (e.g. `S_P1` when you declared `S-P0`) is refused, and the refusal lists the legal ones.',
  '  4. Every `jsonPath` you declare resolves to a JSON NUMBER in the file your code writes — no `null`, no string, no range label. Run the code once in your head: does that path exist and is it a finite number?',
  '  5. Every `[[ASSUMPTION: <id>]]` anchor in your analysis has a matching AssumptionSpec in `entries`, and vice versa — count them, they must be equal.',
  '  6. Every sub-problem the statement asks has its own Result AND its own CRITICAL claim. Count the questions, count the claims.',
  'If any check fails, fix it before emitting. Do not emit and hope.',
].join(String.fromCharCode(10))

/** 一句话说清这一步在链条里的位置。 */
const STEP_POSITION: Readonly<Record<BriefingStep, string>> = {
  analyze: '分析步：写一份自由散文的建模分析（工作笔记），逐问交代方法选择、模型、假设与验证方案。此阶段不写代码、不写 JSON。',
  explore: '第一步：动笔之前先比较——每个子问题摆出 2–3 个方案草图，此阶段不写代码。',
  select: '第二步：在草图之间择优，并留下可复核的决策记录（选了谁、为什么、落选者各为什么输）。',
  produce: '产出步：把选定方案落成可运行的代码 + 可复核的数字 + 论文正文。数字只能来自 code 的真实运行。',
  review: '复核步：按你这一视角的焦点攻击这份稿子，只报你视角内的缺陷。',
  revise: '修订步：按给出的缺陷清单改稿，保留全部章节标题与结构。',
}

/** 每一步的负面清单（防越界）。 */
const STEP_FORBIDDEN: Readonly<Record<BriefingStep, string>> = {
  analyze: '不要写 JSON、不要写容器、不要写代码、不要重述题面当作分析；不要用占位符当假设 id。',
  explore: '不要写代码、不要下结论、不要只给一个方案（那就没有比较）。',
  select: '不要跳过打分直接选、不要丢掉落选方案（它们可能在深挖失败后被复活）。',
  produce: '不要在正文里写任何来自心算的数字（必须来自 code 运行后经 jsonPath 读回）；不要重述题面当作论文正文。',
  review: '不要报你视角之外的缺陷；不要在没有证据（可指到具体文字或结果）的情况下断言。',
  revise: '不要把稿子改短或丢掉章节标题；不要返回题面原文当作"修订后的正文"。',
}

/**
 * **本步骤简报**——注入该步骤 prompt 的**最后一段**（最后 = 最高优先级）。
 *
 * ## 它为什么把知识**内联**，而不是"指路"
 *
 * 第一版写的是"必读：`skills/evidence-and-numbers.md`（含…），用 read_file 读它"。
 * 那是一条**模型无法遵守的指令**：本管线的模型调用**没有工具**——
 * `apps/paper-shell/src/real-provider.ts` 的 `streamCompletion` 只发 messages，
 * 不发 `tools`，代码里也没有 tool 循环。模型读不到那些文件，**"按需加载"在这条
 * 管线里根本不可执行**。这恰好是本项目反复抓到的那类缺陷：判定侧写了，传递侧没写。
 *
 * 对照证据：参考实现的模型**是有工具的 agent**（其运行日志里有 191 条工具调用），
 * 所以它的"必读指针"能被真的执行——它的 agent 会主动读被指名的文件。**没有工具时，
 * 唯一诚实的形态是把这一步需要的知识内联进它的 prompt。**
 *
 * ## 内联的代价是可控的
 *
 * 每一步只内联**它自己需要的**那 1–2 份（合计 1–10KB），而不是把 7 份全塞给每一步：
 * 评审步只要 1KB 的评分口径，产出步才要 9.6KB 的写作与数字纪律。这与"一份 22KB
 * 教学对所有步骤一视同仁"是两件事——后者正是本架构要拆掉的东西。
 *
 * ## 字段
 *
 * | 字段 | 作用 |
 * |---|---|
 * | 目标产物 | 消除歧义（防"产出到别处"） |
 * | 上游状态 | 让模型知道什么存在、什么不存在（防幻觉引用） |
 * | 本步知识（内联全文） | **保证在场**——不依赖模型去查 |
 * | 本步骤定位 | 一句话说清这一步在链条里的位置 |
 * | 不要做 | 负面清单（防越界） |
 * | 完成标志 | **可机械核验**的终止条件 |
 *
 * **为什么放在最后**：模型开始写之前的最后一段才真正在"掌舵"（W8.10-D1 的教训：
 * 要求写在长 prompt 的第三行时，到动笔时已经不掌舵了）。
 *
 * @param step - 当前步骤。
 * @param facts - 上游状态与目标产物（由调用方给真实值，不猜）。
 * @param dir - 技能库目录（用于说明文件也在磁盘上，供人工复核）。
 */
export function stepBriefing(
  step: BriefingStep,
  facts: { readonly target: string; readonly upstream: string; readonly done: string },
  dir: string = SKILL_LIBRARY_DIR,
): string {
  const reading = STEP_READING[step]
  const bodies = reading.map((r) => {
    const doc = skillDocById(r.id)
    return [
      `--- ${dir}/${r.id}.md — ${doc?.title ?? r.id}（为什么这一步需要它：${r.why}）---`,
      doc?.body ?? `（文档 ${r.id} 缺失——这是一个装配缺陷，请按你已有的知识尽力完成并如实说明）`,
    ].join(String.fromCharCode(10))
  })
  return [
    '=== THIS STEP (highest priority — read this before you act) ===',
    `Target output: ${facts.target}`,
    `Upstream state: ${facts.upstream}`,
    ...(bodies.length === 0
      ? ['This step needs no external norms beyond what is already stated above.']
      : [
        'THIS STEP KNOWLEDGE — the norms below are what this step is checked against, quoted in full so you do not have to go looking for them:',
        ...bodies,
        `(The same files are also on disk under \`${dir}/\` for human review. You have no file-reading tool in this pipeline, so everything you need is quoted above — do not assume you can go read more.)`,
      ]),
    `Where this step sits: ${STEP_POSITION[step]}`,
    `Do NOT: ${STEP_FORBIDDEN[step]}`,
    ...(step === 'produce' || step === 'revise' ? [PRE_SUBMIT_CHECKS] : []),
    `Done when: ${facts.done}`,
  ].join(String.fromCharCode(10))
}

/**
 * 知识库总索引——**只给"有哪些文档"**，用于模型主动探索时。
 *
 * ⚠️ 它**不是**主要的知识投递方式。实测（对优秀参考实现的结构分析）表明：
 * 目录式邀请没有"被读取"的证据，而**在需要的那一步指名 + 给理由 + 标必读**
 * 会被真的执行。因此各步骤注入的是 {@link stepBriefing}；本索引只作补充，
 * 说明"除了这一步必读的那几份，还有什么存在"。
 *
 * @param dir - 技能库目录（相对工作区根），默认为 {@link SKILL_LIBRARY_DIR}。
 */
export function skillIndexBlock(dir: string = SKILL_LIBRARY_DIR): string {
  return [
    `SKILL LIBRARY — a queryable knowledge base at \`${dir}/\` (not loaded into this prompt).`,
    'The documents THIS step requires are named in the THIS STEP block; read those first.',
    'The full catalogue, for anything else you find yourself unsure about:',
    ...SKILL_DOCS.map(d => `  - ${dir}/${d.id}.md — ${d.title}`),
    `Read any of them with read_file("${dir}/<name>.md").`,
  ].join(String.fromCharCode(10))
}

/**
 * 把技能库写到工作区。
 *
 * 幂等：同内容重写不改变任何字节（运行可重放，且不会因为时间戳产生假 diff）。
 *
 * @param rootDir - 工作区根目录。
 * @returns 写出的文件绝对路径（顺序稳定，便于审计与测试断言）。
 */
export function materializeSkillLibrary(rootDir: string): ReadonlyArray<string> {
  const dir = join(rootDir, SKILL_LIBRARY_DIR)
  mkdirSync(dir, { recursive: true })
  const written: string[] = []
  for (const doc of SKILL_DOCS) {
    const path = join(dir, `${doc.id}.md`)
    writeFileSync(path, doc.body, 'utf8')
    written.push(path)
  }
  return written
}

/** 按 id 取一份文档；未知 id 返回 null（调用方决定怎么报）。 */
export function skillDocById(id: string): SkillDoc | null {
  return SKILL_DOCS.find(d => d.id === id) ?? null
}
