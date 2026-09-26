import { readFileSync, writeFileSync } from 'node:fs'

const p = 'packages/paper/paper-foundation/src/figure/renderer.ts'
// 仓库文件是 CRLF；多行匹配前先归一化成 LF，写回也用 LF（与仓库偏好一致）。
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const hadCrlf = readFileSync(p, 'utf8').includes('\r\n')

const drop = (name) => {
  const re = new RegExp('\n(?:/\\*\\*[\\s\\S]*?\\*/\\n)?function ' + name + '\\([\\s\\S]*?\n\\}\n', 'm')
  const m = s.match(re)
  if (m === null) { console.log('未找到本地 ' + name); return }
  s = s.replace(m[0], '\n')
}

drop('escapeXml')
drop('fmt')
drop('fmtTick')

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
if (!s.includes(oldPad)) { console.log('留白段仍未找到'); process.exit(1) }
s = s.replace(oldPad, newPad)

const oldGrid = `  const gridRows = 4
  for (let row = 0; row <= gridRows; row += 1) {
    const gy = T + (plotH / gridRows) * row
    parts.push(\`<line x1="\${L}" y1="\${gy}" x2="\${W - R}" y2="\${gy}" stroke="\${recipe.grid_color}" stroke-width="1"/>\`)
    const gv = yMax - ((yMax - yMin) / gridRows) * row
    parts.push(\`<text x="\${L - 8}" y="\${gy + 4}" text-anchor="end" font-family="monospace" font-size="\${recipe.font_size - 1}" fill="\${recipe.ink}">\${fmtTick(gv)}</text>\`)
  }`
const newGrid = `  // 网格行数由取整后的步长推出（原来写死 4 段，与取整后的区间对不上）
  const gridRows = Math.max(1, Math.round((yMax - yMin) / yStep))
  for (let row = 0; row <= gridRows; row += 1) {
    const gv = yMin + yStep * row
    const gy = sy(gv)
    parts.push(\`<line x1="\${L}" y1="\${fmt(gy)}" x2="\${W - R}" y2="\${fmt(gy)}" stroke="\${recipe.grid_color}" stroke-width="1"/>\`)
    parts.push(\`<text x="\${L - 8}" y="\${fmt(gy + 4)}" text-anchor="end" font-family="monospace" font-size="\${recipe.font_size - 1}" fill="\${recipe.ink}">\${fmtTick(gv)}</text>\`)
  }`
if (!s.includes(oldGrid)) { console.log('网格段未找到'); process.exit(1) }
s = s.replace(oldGrid, newGrid)

writeFileSync(p, s, 'utf8')
console.log('renderer 完成（原 CRLF：' + String(hadCrlf) + '）')
