const svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 420">',
  ...[5,4,3,2,1].map((i,k)=>`<text x="40" y="${20+k*40}" font-family="monospace" font-size="11">${i*5}</text>`),
  '<text x="100" y="400" font-family="X" font-size="11">情况1</text>', '</svg>'].join('')
const all = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1])
console.log('匹配数', all.length, JSON.stringify(all))
console.log('finite 数', all.filter(t => t !== '' && Number.isFinite(Number(t))).length)
