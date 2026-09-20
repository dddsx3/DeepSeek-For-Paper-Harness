/**
 * 安全格式修复 + N30 不变量 — R2③（格式链）.
 *
 * 红线 N30：**自动修复不改语义**。路线书 R2③ 判据把它定为可测形式——
 * 「修复前后正文（去格式）逐字比对差异为空」。
 *
 * 修复器只执行**演示层变换**（换行/行尾空白/空行折叠/题注独占行拆分），
 * 不做任何字符级增删改。`stripFormat` 是那个逐字比对的"去格式"：剥掉
 * markdown 语法与空白、代码块按原字节保留（代码的空白是语义，不剥）；
 * 两者都是 **fence 感知**的，且 `stripFormat` 先做与修复器相同的换行归一
 * （CRLF→LF），于是任何演示层修复在比对眼里不可见——N30 被机械钉死：
 *
 *   for doc of CORPUS: stripFormat(fix(doc)) === stripFormat(doc)
 *
 * 修复器白名单（只此四种；加一种必须同时加一条 N30 反例）：
 *   1. CRLF → LF（换行归一）
 *   2. 行尾空白删除
 *   3. 连续 3+ 空行折叠为 2（仅正文区；代码块内不胜手）
 *   4. 题注独占行：正文行尾的「图 N：…/表 N：…」拆到自己的行（REF-D 铁律，
 *      不删任何字符，只换行）
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/format-fix
 */

/** Split into lines with fence state; `inCode: true` means the line is INSIDE a ``` block. */
function codeAwareLines(markdown: string): Array<{ text: string; inCode: boolean }> {
  const out: Array<{ text: string; inCode: boolean }> = []
  let inCode = false
  for (const raw of markdown.split('\n')) {
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```')) {
      inCode = !inCode
      out.push({ text: raw, inCode: false }) // the fence line itself is not content
      continue
    }
    out.push({ text: raw, inCode })
  }
  return out
}

const CAPTION = /^(.*?)((?:图|表)\s*\d+[：:].+)$/

/**
 * 去格式：同样的换行归一 + 语法/空白剥离；代码块逐字保留。
 * 返回纯内容字符序列（无空白）。
 */
export function stripFormat(markdown: string): string {
  const lf = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts: string[] = []
  for (const { text, inCode } of codeAwareLines(lf)) {
    if (inCode) {
      parts.push(text) // 代码块逐字
      continue
    }
    parts.push(text
      .replace(/```/g, '')
      .replace(/#{1,6}\s+/, '')
      .replace(/\*\*/g, '')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '$1')
      .replace(/^>\s?/, '')
      .replace(/^\s*[-+*]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '')
      .replace(/\|/g, ' ')
      .replace(/\$\$/g, ' ').replace(/\$/g, ' ')
      .replace(/\s+/g, ''))
  }
  return parts.join('')
}

/**
 * 白名单修复：只做演示层变换（N30：字符级内容零增删）。
 */
export function applySafeFormatFixes(markdown: string): string {
  // 1. 换行归一（全局；stripFormat 同款，比对不可见）
  const lf = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const out: string[] = []
  let inCode = false
  let blankRun = 0
  for (const line of lf.split('\n')) {
    const trimmedStart = line.trimStart()
    const isFence = trimmedStart.startsWith('```')
    if (isFence) {
      inCode = !inCode
      blankRun = 0
      out.push(line) // fence 行原样
      continue
    }
    if (inCode) {
      // 代码块内：逐字保留（代码的空行/行尾空白是语义，不演示层修理）
      blankRun = 0
      out.push(line)
      continue
    }
    if (line.trim().length === 0) {
      // 3. 连续空行折叠为 2（仅正文区；代码块内已在上方逐字归位）
      blankRun += 1
      if (blankRun <= 2) out.push('')
      continue
    }
    blankRun = 0
    // 2. 行尾空白删除
    const noTrail = line.replace(/[ \t]+$/, '')
    // 4. 题注独占行：正文行尾的「图 N：…/表 N：…」拆到自己的行（字符零增删）
    const caption = CAPTION.exec(noTrail)
    const head = caption?.[1]
    const tail = caption?.[2]
    if (head !== undefined && tail !== undefined && head.trim().length > 0) {
      out.push(head.replace(/[ \t]+$/, ''), tail.trimStart())
      continue
    }
    out.push(noTrail)
  }
  // 结尾换行统一为恰好一个（EOF 处的空白是演示层；幂等：再修不再变）
  const joined = out.join('\n')
  return joined.length === 0 ? '' : joined.replace(/\n+$/, '\n')
}

/** N30 断言汇总：修复前后去格式逐字一致。 */
export function n30Holds(markdown: string): boolean {
  return stripFormat(applySafeFormatFixes(markdown)) === stripFormat(markdown)
}
