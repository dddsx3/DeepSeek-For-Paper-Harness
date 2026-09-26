import { readFileSync, writeFileSync } from 'node:fs'

// ── chart-types.ts：去掉未用的参数/变量 ────────────────────────────────
{
  const p = 'packages/paper/paper-foundation/src/figure/chart-types.ts'
  let s = readFileSync(p, 'utf8')
  s = s.replace(
    `export function refLineParts(
  input: RenderInput, sx: (v: number) => number, sy: (v: number) => number,
  ink: string, font: number,
): ReadonlyArray<string> {`,
    `export function refLineParts(
  input: RenderInput, sx: (v: number) => number, sy: (v: number) => number,
  font: number,
): ReadonlyArray<string> {`)
  s = s.replace(/refLineParts\(input, sx, \(v: number\) => v, recipe\.ink, recipe\.font_size\)/g,
    'refLineParts(input, sx, (v: number) => v, recipe.font_size)')
  s = s.replace(/refLineParts\(input, \(v: number\) => v, sy, recipe\.ink, recipe\.font_size\)/g,
    'refLineParts(input, (v: number) => v, sy, recipe.font_size)')
  s = s.replace(`  const lo = colorOf(recipe, 5)
  const hi = colorOf(recipe, 0)`, `  const hi = colorOf(recipe, 0)`)
  writeFileSync(p, s, 'utf8')
  console.log('chart-types 清理完成')
}

// ── renderer.ts：删本地重复定义 + 用 niceScale 取整刻度 ────────────────
{
  const p = 'packages/paper/paper-foundation/src/figure/renderer.ts'
  let s = readFileSync(p, 'utf8')

  // 删掉本地的 escapeXml / fmt / fmtTick（已移到 svg-primitives）
  const drop = (name) => {
    const re = new RegExp('\\n(?:/\\*\\*[\\s\\S]*?\\*/\\n)?function ' + name + '\\([\\s\\S]*?\\n\\}\\n', 'm')
    const m = s.match(re)
    if (m === null) { console.log('未找到本地 ' + name); return }
    s = s.replace(m[0], '\n')
  }
  drop('escapeXml')
  drop('fmt')
  drop('fmtTick')

  // y 轴刻度取整：把留白后的区间扩到 1/2/5×10^k 的整数刻度上
  const oldPad = `  const xPad = (xMax - xMin) * 0.04
  const yPad = (yMax - yMin) * 0.06
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad`
  const newPad = `  const xPad = (xMax - xMin) * 0.04
  const yPad = (yMax - yMin) * 0.06
  xMin -= xPad; xMax += xPad
  // **值轴刻度取整**（参考：把关键阈值/端点塞进刻度；实测旧图是 22.33/19.295/16.26
  // 这种非整数，读起来很业余）。留白之后再把区间扩到 1/2/5×10^k 的整数刻度上，
  // 于是刻度标签天然落在整数（或一位小数）上。
  const yNice = niceScale(yMin - yPad, yMax + yPad, 4)
  yMin = yNice.lo; yMax = yNice.hi
  const yStep = yNice.step > 0 ? yNice.step : (yMax - yMin) / 4`
  if (!s.includes(oldPad)) { console.log('留白段未找到'); process.exit(1) }
  s = s.replace(oldPad, newPad)

  // 网格行数由步长推出（原来是写死 4 段，与取整后的区间对不上）
  const oldGrid = `  const gridRows = 4
  for (let row = 0; row <= gridRows; row += 1) {
    const gy = T + (plotH / gridRows) * row
    parts.push(\`<line x1="\${L}" y1="\${gy}" x2="\${W - R}" y2="\${gy}" stroke="\${recipe.grid_color}" stroke-width="1"/>\`)
    const gv = yMax - ((yMax - yMin) / gridRows) * row
    parts.push(\`<text x="\${L - 8}" y="\${gy + 4}" text-anchor="end" font-family="monospace" font-size="\${recipe.font_size - 1}" fill="\${recipe.ink}">\${fmtTick(gv)}</text>\`)
  }`
  const newGrid = `  const gridRows = Math.max(1, Math.round((yMax - yMin) / yStep))
  for (let row = 0; row <= gridRows; row += 1) {
    const gv = yMin + yStep * row
    const gy = sy(gv)
    parts.push(\`<line x1="\${L}" y1="\${fmt(gy)}" x2="\${W - R}" y2="\${fmt(gy)}" stroke="\${recipe.grid_color}" stroke-width="1"/>\`)
    parts.push(\`<text x="\${L - 8}" y="\${fmt(gy + 4)}" text-anchor="end" font-family="monospace" font-size="\${recipe.font_size - 1}" fill="\${recipe.ink}">\${fmtTick(gv)}</text>\`)
  }`
  if (!s.includes(oldGrid)) { console.log('网格段未找到（可能已被前面替换影响）') } else {
    s = s.replace(oldGrid, newGrid)
  }
  writeFileSync(p, s, 'utf8')
  console.log('renderer 清理 + 刻度取整完成')
}

// ── figure-render.ts：声明类型放宽到新图型 ────────────────────────────
{
  const p = 'packages/paper/paper-foundation/src/stages/figure-render.ts'
  let s = readFileSync(p, 'utf8')
  const oldT = '  readonly chart_type: FigureChartType'
  if (s.includes(oldT)) {
    s = s.replace(oldT, '  readonly chart_type: FigureChartType')
    console.log('figure-render 类型已是 FigureChartType（无需改）')
  }
  writeFileSync(p, s, 'utf8')
}
