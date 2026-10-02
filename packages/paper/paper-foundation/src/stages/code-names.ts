/**
 * 代码文件的**名字一致性分析**（`code_name_consistency` 门禁与阶段 3 的分片自检共用）。
 *
 * 为什么抽成独立模块：判据只有一份，**门禁**与**分片重问**必须用同一份。
 * 分片是"一文件一次调用"，各文件独立生成，最容易写出"任何文件都没定义的名字"
 * ——实测反复撞：`Q4_SCENARIO_NODE_COUNT`、`Q2_PART1_INSPECTION_COSTS`…
 * 每次撞上的代价是**整阶段 8 片重跑**（约 10 分钟 + 8 次模型调用）。
 * 门禁只能事后拦；这里让分片循环在**收到那一片的当下**就能自查并只重问那一片。
 */

/** 一个文件里"引用了但没有任何文件定义"的常量名。 */
export interface UndefinedNameFinding {
  readonly file: string
  readonly names: ReadonlyArray<string>
}

/** 参与判据的文件形态：`code/*.py`（与门禁的判据逐字一致）。 */
export const CODE_PY_RE = /^code\/[A-Za-z0-9_]+\.py$/

/** 去掉注释、单行字符串、三引号块（判据只在"真代码"上成立）。 */
function strip(src: string): string {
  return src
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/'''[\s\S]*?'''/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    // **先吃掉转义对**（`\"` / `\'` / `\n` …），再吃引号内内容。
    // 为什么必须先吃：`"a\"b"` 这种带转义引号的字面量会让 `"[^"\n]*"` 只匹配到 `"a\"`，
    // 于是 `b` 后面的内容被当成**真代码**——实测它把一句中文提示里的 `PROBLEM_FACTS`
    // 判成了"未定义的常量名"（假阳性，正是这套判据最贵的一种错）。
    .replace(/\\./g, ' ')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/'[^'\n]*'/g, ' ')
}

/**
 * 该段代码"定义"了哪些名字（赋值/def/class/import/for/with/except 的绑定）。
 *
 * ⛔ 这几条形态**都踩过坑**，每一条都对应一次真实误报：
 * - **海象运算符 `NAME := …`**：实测（2024B 的 `params.py`）
 *   `if INACTIVE_DISASSEMBLY_FIXED_TO_ZERO := bool(…)` 被判成"未定义的常量名"
 *   ——它明明就在定义。漏了它，门禁会去修一个不存在的问题。
 * - **元组解包 `A, B = …`**：与海象同类（左边不止一个名字）。
 * - **括号式 `from x import (A, B)`**：跨行导入很常见。
 * - **`global` / `nonlocal`**：声明也是绑定。
 */
export function definitionsIn(code: string): ReadonlySet<string> {
  const out = new Set<string>()
  // 单名赋值（含注解）：`A = …` / `A: float = …`
  for (const m of code.matchAll(/^\s*([A-Za-z_]\w*)\s*(?::[^=\n]*)?=(?!=)/gm)) out.add(m[1] ?? '')
  // 元组解包：`A, B = …`（左边可能带括号）
  for (const m of code.matchAll(/^\s*\(?((?:[A-Za-z_]\w*\s*,\s*)+[A-Za-z_]\w*)\s*(?::[^=\n]*)?=/gm)) {
    for (const n of (m[1] ?? '').split(',')) out.add(n.trim())
  }
  // 海象运算符：`NAME := …`（任何位置）
  for (const m of code.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*:=/g)) out.add(m[1] ?? '')
  for (const m of code.matchAll(/^\s*(?:def|class)\s+([A-Za-z_]\w*)/gm)) out.add(m[1] ?? '')
  for (const m of code.matchAll(/^\s*import\s+([A-Za-z_]\w*)/gm)) out.add(m[1] ?? '')
  for (const m of code.matchAll(/^\s*from\s+[\w.]+\s+import\s+\(([^)]*)\)/gm)) {
    for (const n of (m[1] ?? '').split(',')) {
      const name = n.trim().split(/\s+as\s+/).pop()?.trim() ?? ''
      if (/^[A-Za-z_]\w*$/.test(name)) out.add(name)
    }
  }
  for (const m of code.matchAll(/^\s*from\s+[\w.]+\s+import\s+([A-Za-z_]\w*)/gm)) out.add(m[1] ?? '')
  for (const m of code.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) out.add(m[1] ?? '')
  for (const m of code.matchAll(/\bfor\s+(\(?[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+\)?)\s+in\b/g)) {
    for (const n of (m[1] ?? '').replace(/[()]/g, '').split(',')) out.add(n.trim())
  }
  for (const m of code.matchAll(/\bwith\b[^:\n]*\bas\s+([A-Za-z_]\w*)/g)) out.add(m[1] ?? '')
  for (const m of code.matchAll(/\bexcept\b[^:\n]*\bas\s+([A-Za-z_]\w*)/g)) out.add(m[1] ?? '')
  for (const m of code.matchAll(/^\s*(?:global|nonlocal)\s+([A-Za-z_]\w*)/gm)) out.add(m[1] ?? '')
  return out
}

/**
 * 找出**引用了但没有任何文件定义**的常量名。
 *
 * 只查**全大写、长度 ≥ 4 的裸标识符**（那才是"常量"的形态），且四条同时成立才判：
 * ① 不在注释/字符串/文档串里；② 前面不是 `.`（那是属性访问）；
 * ③ 它在该文件自己里没定义过；④ 它在任何 `.py` 里都没有定义。
 * 单条都不足以断定它不存在（可能是 `globals()` 注入、也可能是星号导入进来的成员）。
 *
 * @param files - `[相对路径, 源码]`；非 `code/*.py` 的条目被忽略。
 * @returns 逐文件的发现（没有问题时为空数组）。
 */
export function undefinedConstNames(
  files: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<UndefinedNameFinding> {
  const py = files.filter(([name]) => CODE_PY_RE.test(name))
  if (py.length === 0) return []
  const stripped = py.map(([f, raw]) => [f, strip(raw)] as const)
  const definedAnywhere = new Set<string>()
  for (const [, code] of stripped) for (const n of definitionsIn(code)) definedAnywhere.add(n)
  const out: UndefinedNameFinding[] = []
  for (const [file, code] of stripped) {
    const here = definitionsIn(code)
    const stray = new Set<string>()
    for (const m of code.matchAll(/(?<![.\w])([A-Z][A-Z0-9_]{3,})\b/g)) {
      const name = m[1] ?? ''
      if (here.has(name) || definedAnywhere.has(name)) continue
      stray.add(name)
    }
    if (stray.size > 0) out.push({ file, names: [...stray] })
  }
  return out
}
