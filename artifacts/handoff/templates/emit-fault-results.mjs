#!/usr/bin/env node
// Walk a fault corpus directory and emit `fault-results.json` from the
// fixtures' declared `expected_status` and the actual test verdict. The
// fault runner itself is a TASK-specific script (see TASK-N test specs).
//
// Usage: node emit-fault-results.mjs <TASK-name> <fault-corpus-dir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [task, dir = '.'] = process.argv.slice(2)
if (!task) {
  console.error('usage: emit-fault-results.mjs <TASK-name> <fault-corpus-dir>')
  process.exit(2)
}

// Each fixture is a JSON file with shape { fault_id, description, expected_status, ... }.
// The actual verdict is read from <fixture>.verdict.json written by the test runner.
const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.verdict.json'))
const faults = files.map(f => {
  const spec = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  let actual = 'UNKNOWN'
  try {
    const v = JSON.parse(readFileSync(join(dir, f.replace(/\.json$/, '.verdict.json')), 'utf8'))
    actual = v.actual_status
  } catch { /* runner did not emit verdict for this fixture */ }
  return {
    fault_id: spec.fault_id,
    description: spec.description,
    expected_status: spec.expected_status,
    actual_status: actual,
    blocked_by: spec.blocked_by ?? [],
    fixture_path: join(dir, f),
  }
})

const escaped = faults.filter(f => f.actual_status !== f.expected_status).length
const out = {
  task,
  faults,
  declared_faults: faults.length,
  escaped_faults: escaped,
  escape_rate: faults.length === 0 ? 0 : escaped / faults.length,
}
writeFileSync('fault-results.json', JSON.stringify(out, null, 2) + '\n')
console.log(`wrote fault-results.json: ${faults.length - escaped}/${faults.length} caught, escape_rate=${out.escape_rate}`)
process.exit(escaped === 0 ? 0 : 1)
