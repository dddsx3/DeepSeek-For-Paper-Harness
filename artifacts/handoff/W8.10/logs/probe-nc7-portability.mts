// E3 probe: is NC-7's tamper check portable to any other checkout path?
// run-all.mjs line 128 hardcodes this machine's absolute path. Simulate the
// same expression on a different drive root and observe what nc7() would hit.
import { sha256File } from '../../../../bench/metrics/compute-metrics.mjs'

const asWritten = 'bench/problems/2024-B/problem.pdf'.replace('bench/', 'D:/deepseek modex/deepseek-harness/bench/')
console.log('as written in run-all.mjs  :', asWritten)

const otherCheckout = 'bench/problems/2024-B/problem.pdf'.replace('bench/', '/home/ci/paper-harness/bench/')
console.log('same expression elsewhere  :', otherCheckout)
console.log('')
console.log('nc7() calls sha256File() with no try/catch, then asserts `actual !== "0".repeat(64)`.')
try {
  const h = await sha256File(otherCheckout)
  console.log('  on another checkout -> returned:', String(h).slice(0, 12))
} catch (e) {
  console.log('  on another checkout -> THREW', e.code + ':', e.message.slice(0, 90))
  console.log('  => nc7() rejects -> top-level await rejects -> script exits non-zero,')
  console.log('     the "18 passed, 0 failed" summary line never prints.')
}
