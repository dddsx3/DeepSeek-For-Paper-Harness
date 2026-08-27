#!/usr/bin/env node
// Collect the list of files changed in the current commit into
// `changed-files.txt`. Run inside the handoff directory AFTER the commit.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const out = execSync('git show --name-status --format="" HEAD', { encoding: 'utf8' })
writeFileSync('changed-files.txt', out)
console.log(`wrote changed-files.txt (${out.trim().split('\n').length} lines)`)
