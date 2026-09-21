/**
 * W11.5 baseline-17 — assemble the FINAL delivery package for a real run.
 *
 * The run's own zip is produced at promotion time, before the docx export step
 * exists; this packs everything the delivery surface holds (paper, docx, run
 * report, executed outputs, figures, precheck report) into one zip.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { zipMixedFiles } from '../../../apps/paper-shell/src/zip.ts'

const dir = process.argv[2]
if (dir === undefined) throw new Error('usage: final-package.mts <delivery-dir>')
const files: Record<string, string | Uint8Array> = {}
for (const name of ['report.md', 'sha256.txt', 'run-report.json', 'paper.docx', 'docx-precheck-report.md']) {
  try {
    const bytes = await readFile(join(dir, name))
    files[name] = name.endsWith('.docx') ? new Uint8Array(bytes) : bytes.toString('utf8')
  } catch { /* absent by design (e.g. no precheck report) */ }
}
for (const sub of ['data', 'figures']) {
  for (const name of (await readdir(join(dir, sub)).catch(() => [] as string[])).sort()) {
    files[`${sub}/${name}`] = await readFile(join(dir, sub, name), 'utf8')
  }
}
const bytes = zipMixedFiles(files)
const out = join(dir, 'deliverable-final.zip')
await writeFile(out, bytes)
console.log(`final package: ${out}`)
console.log(`  members: ${Object.keys(files).sort().join(', ')}`)
console.log(`  sha256: ${createHash('sha256').update(bytes).digest('hex')}`)
