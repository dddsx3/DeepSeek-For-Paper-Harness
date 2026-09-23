// 一次性小工具：把检查结论写回切片（热重启工作流的人工步骤）。
import { recordReview } from '../packages/paper/paper-foundation/src/runtime/stage-checkpoint.ts'
const [dir, verdict, ...note] = process.argv.slice(2)
if (dir === undefined || verdict === undefined) {
  console.error('usage: tsx scripts/.record-review.mts <sliceDir> <passed|failed> <note>')
  process.exit(2)
}
await recordReview(dir, {
  verdict: verdict === 'passed' ? 'passed' : 'failed',
  note: note.join(' '),
  at: new Date().toISOString(),
})
console.log(`review recorded: ${dir} -> ${verdict}`)
