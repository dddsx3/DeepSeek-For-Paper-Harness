import { CassetteReplayer } from '../../../../apps/paper-shell/src/cassette.ts'
const r = await CassetteReplayer.load('artifacts/handoff/TASK-E/cassettes/glm-t3-coursework-v4.json')
try {
  r.answerWithUsage({ provider: 'openai-compatible-relay', model: 'z-ai/glm-5.3-flash', system: 'x', messages: [{ content: 'never-recorded-request' }] })
  console.log('UNEXPECTED: no miss raised')
} catch (e) {
  console.log('RAW MISS MESSAGE:', (e as Error).message)
}
