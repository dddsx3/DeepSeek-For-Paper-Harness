import { runGates } from './packages/paper/paper-foundation/src/stages/gates.ts'
const decl = JSON.stringify({ figures: [{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A'],
  caption: '六种情况对照', x_label: '表 1 的情况', y_label: '期望利润（元）' }] })
const svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 420">',
  ...[5,4,3,2,1].map((i,k)=>`<text x="40" y="${20+k*40}" font-family="monospace" font-size="11">${i*5}</text>`),
  '<text x="100" y="400" font-family="X" font-size="11">情况1</text>',
  '<text x="200" y="400" font-family="X" font-size="11">情况2</text>', '</svg>'].join('')
const v = runGates(['figure_completeness'], {
  files: new Map([['figures/fig_a.svg', svg], ['FIGURE_DECLARATIONS.json', decl]]),
  upstream: new Map([['FIGURE_DECLARATIONS.json', decl]]),
  problemCount: 4,
} as never)
console.log('code', v.code)
for (const i of v.items) console.log(' ', i.id, i.ok, String(i.detail).slice(0, 300))
