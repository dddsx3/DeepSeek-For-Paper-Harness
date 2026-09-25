// 图的**视觉转录**：把题面里的插图转成结构化文字，接进 `00-input/`。
//
// ## 为什么必须有这一步（2024B 实测）
//
// 图 1（2 道工序、8 个零配件的装配树）是**图片**，纯文本抽取拿不到。后果实测：
// 阶段 2 的建模报告把输入件集合 I(v) 当抽象符号（"由装配拓扑决定"），
// **从未给出组件→半成品的具体映射**——问题 3 的决策变量无法正确实例化。
// 用户口径：不能因为中转/输入的原因对建模质量让步，所以图必须进输入。
//
// ## 设计：转录在**摄取期**完成，不进主链的 prompt
//
// 主链的模型不一定是视觉模型，且图像令牌很贵。所以：摄取时用视觉模型把图读成
// **结构化文字**（节点/边/标签），写进 `figures/<id>.md` 并并入 `problem.txt`；
// 主链只吃文字。这与参考工作流的做法一致（它在摄取期做 Vision OCR）。
//
// ## 纪律
//
// - **只转录图上有的**：提示词明确要求不得推断未画出的结构，看不清就写"不清晰"；
// - **幂等**：已转录的（`figures.json` 里 `transcribed: true`）跳过；
// - **配额容忍**：免费模型会限额，按阶梯等待重试（与主链同一策略）。
//
// 用法：node scripts/transcribe-figures.mjs <00-input 目录>
//   env: PAPER_PROBE_BASE_URL / PAPER_PROBE_API_KEY / PAPER_VISION_MODEL（默认 deepseek-v4-flash-vision-exp）

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (dir === undefined) { console.error('用法: node scripts/transcribe-figures.mjs <00-input 目录>'); process.exit(2) }

// 允许从 .env.local / .env.<name> 读配置（与 CLI 同源），也接受已导出的环境变量
if (process.env.PAPER_PROBE_BASE_URL === undefined) {
  for (const f of ['.env.local', '.env.teamorouter', '.env.mhcoding']) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
      if (m !== null && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
    }
  }
}
const base = (process.env.PAPER_PROBE_BASE_URL ?? '').replace(/\/$/, '')
const key = process.env.PAPER_PROBE_API_KEY ?? ''
const visionModel = process.env.PAPER_VISION_MODEL ?? 'deepseek-v4-flash-vision-exp'
if (base === '' || key === '') { console.error('缺少 PAPER_PROBE_BASE_URL / PAPER_PROBE_API_KEY'); process.exit(1) }

const figuresPath = join(dir, 'figures.json')
if (!existsSync(figuresPath)) { console.error(`没有 ${figuresPath} —— 先跑 scripts/ingest-problem.py`); process.exit(1) }
const manifest = JSON.parse(readFileSync(figuresPath, 'utf8'))

const PROMPT = [
  '这是一张数学建模竞赛题目里的插图。请把它转录成**结构化文字**，供后续建模阶段直接使用。',
  '',
  '要求：',
  '1. **只写图上真实存在的内容**：节点名、连接关系（谁指向谁）、图上的文字标注。',
  '   不得推断图上没有的结构；看不清的地方写"（图中不清晰）"。',
  '2. 输出格式：先一行"结构类型"（如：装配树 / 流程框图 / 几何示意 / 坐标系曲线），',
  '   再列"节点"（逐个列出标注文字），再列"连接关系"（每行 `A → B`），',
  '   最后如有坐标轴/量纲/图例，逐条列出。',
  '3. 不要复述题面文字，不要给解题建议，不要解释这张图的意义。只转录。',
].join('\n')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function transcribe(rec) {
  const b64 = readFileSync(join(dir, rec.file)).toString('base64')
  const ext = (rec.file.split('.').pop() ?? 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  const waitLadder = [30_000, 60_000, 120_000, 300_000]
  for (let attempt = 0; attempt <= waitLadder.length; attempt += 1) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: visionModel,
          messages: [{ role: 'user', content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          ] }],
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(300_000),
      })
      const data = await res.json()
      const msg = data.choices?.[0]?.message ?? {}
      const text = String(msg.content ?? '').trim()
      if (text === '') throw new Error(`空转录（reasoning=${String(msg.reasoning_content ?? '').length} 字符）`)
      return text
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      const quota = /\b429\b|\b402\b|quota|额度|余额|配额|insufficient|rate.?limit|空转录/i.test(message)
      if (!quota || attempt === waitLadder.length) throw error
      const wait = waitLadder[attempt]
      console.log(`  ${rec.id}: ${message.slice(0, 90)} —— 等待 ${Math.round(wait / 1000)}s 重试`)
      await sleep(wait)
    }
  }
  throw new Error('unreachable')
}

let done = 0
for (const rec of manifest.figures ?? []) {
  if (rec.transcribed === true) { console.log(`  ${rec.id}: 已转录，跳过`); continue }
  console.log(`  ${rec.id}: 转录中（${rec.width}×${rec.height}，模型 ${visionModel}）…`)
  const text = await transcribe(rec)
  const mdPath = join(dir, 'figures', `${rec.id}.md`)
  writeFileSync(mdPath, `# ${rec.id}（第 ${rec.page} 页，${rec.width}×${rec.height}）\n\n${text}\n`, 'utf8')
  rec.transcribed = true
  rec.transcript_file = `figures/${rec.id}.md`
  done += 1
  console.log(`  ${rec.id}: 完成（${text.length} 字符）`)
}

writeFileSync(figuresPath, JSON.stringify(manifest, null, 2), 'utf8')

// 把转录并入 problem.txt：替换掉摄取时留下的占位注释
const problemPath = join(dir, 'problem.txt')
let problem = readFileSync(problemPath, 'utf8')
for (const rec of manifest.figures ?? []) {
  if (rec.transcribed !== true || rec.transcript_file === undefined) continue
  const body = readFileSync(join(dir, rec.transcript_file), 'utf8').trim()
  const placeholder = `<!-- ${rec.id} 的转录见 figures/${rec.id}.md（摄取时由视觉模型生成） -->`
  const replacement = ['```', `【${rec.id} 的结构化转录（视觉模型，仅转录图上内容）】`, body, '```'].join('\n')
  problem = problem.includes(placeholder) ? problem.replace(placeholder, replacement) : `${problem}\n\n${replacement}\n`
}
writeFileSync(problemPath, problem, 'utf8')

console.log(JSON.stringify({ transcribed: done, total: (manifest.figures ?? []).length, model: visionModel }))
