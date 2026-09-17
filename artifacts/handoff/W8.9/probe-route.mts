import { classifyProblem, routeMismatch, routeCoversTruth } from '../../../apps/paper-shell/src/route.ts'
const B = '某企业生产电子产品，需要购买两种零配件装配成品，零配件和成品存在次品率。请用抽样检测方法在 95% 信度下判断是否接收，并针对表 1 的六种情况给出各阶段的生产决策方案，包括是否检测零配件与成品、不合格成品是否拆解，并给出决策依据及成本、利润等指标结果，比较各方案的优劣。'
const v = classifyProblem(B)
console.log(JSON.stringify(v, null, 1))
if (v.ok) {
  console.log('components:', v.components.map(c => `${c.family}x${c.hits}`).join(' '))
  console.log('routeMismatch("F3+F4") =', routeMismatch('F3+F4', v))
  console.log('routeCoversTruth("F3+F4") =', routeCoversTruth('F3+F4', v))
}
