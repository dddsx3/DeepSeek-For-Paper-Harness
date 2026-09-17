// Exact reproduction of the CLI's provider seam: streamCompletion feeds
// a BlockAssembler exactly like executor.call() does. If the assembler
// loses the finish here, the fault is in the chunk plumbing, not upstream.
import { streamCompletion } from '../../../apps/paper-shell/src/real-provider.ts'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
const route = { baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.PAPER_PROBE_API_KEY ?? '', model: 'stealth/union-alpha' }
const assembler = new BlockAssembler()
const chunksSeen: string[] = []
for await (const chunk of streamCompletion(route, { messages: [{ content: 'Output exactly: {"ok":true,"n":1}. Only JSON.' }] })) {
  chunksSeen.push((chunk as { type: string }).type)
  assembler.push(chunk)
}
console.log('chunk types:', chunksSeen.join(','))
console.log('assembler.finish:', JSON.stringify(assembler.finish))
console.log('text:', assembler.blocks().filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').slice(0, 80))
