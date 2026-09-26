import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runStages } from './packages/paper/paper-foundation/src/stages/runner.ts'
const root = await mkdtemp(join(tmpdir(), 'dsh-diag-'))
const mod = await import('./packages/paper/paper-foundation/tests/architecture/stage-runner.spec.ts').catch(() => null)
console.log('（直接跑 spec 不方便，改看 runner 的输出）')
