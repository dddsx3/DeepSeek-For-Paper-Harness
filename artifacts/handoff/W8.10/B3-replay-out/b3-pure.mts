import { e2PromptWithGuidance, e2DriftGuidance, E2_DRIFT_HEADER } from '../../../../packages/paper/paper-foundation/src/produce/e2-guidance.ts'

const base = 'BASE-PROMPT-BYTES'
const out = e2PromptWithGuidance(base, '')
console.log('A) e2PromptWithGuidance(base, "") === base  ->', out === base)
console.log('   returned bytes:', JSON.stringify(out))

const empty = e2DriftGuidance({ priorViolations: [], registeredIds: [] })
console.log('B) e2DriftGuidance(no violations, no ids) ->', JSON.stringify(empty), '(len ' + empty.length + ')')

const idsOnly = e2DriftGuidance({ priorViolations: [], registeredIds: ['DA-RAW', 'P1', 'R-OUT'] })
console.log('C) e2DriftGuidance(no violations, 3 harness ids) len =', idsOnly.length)
console.log('   starts with header:', idsOnly.startsWith(E2_DRIFT_HEADER))
console.log('   contains "What went wrong last time":', idsOnly.includes('What went wrong last time'))
console.log('   => guidance empty on a first attempt IFF the store is empty:', idsOnly.length === 0)
