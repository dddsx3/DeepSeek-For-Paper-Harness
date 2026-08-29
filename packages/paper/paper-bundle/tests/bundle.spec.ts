/**
 * The bundle's substance is its patch file: `dsh.bundle.patch` must name a
 * real, parseable patch list whose rows mount the Paper layer, and the one
 * requirement the patch cannot enforce by composition must be reported rather
 * than left silent.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as bundle from '../src/index.ts'
import { PAPER_REQUIRED_SERVICES, missingPaperServices, name } from '../src/index.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

interface PatchRow {
  readonly id?: string
  readonly name?: string
  readonly config?: Record<string, unknown>
}

function patchRows(): PatchRow[] {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: string } }
  }
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  const parsed = yaml.load(
    readFileSync(resolve(ROOT, manifest.dsh?.bundle?.patch ?? ''), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('paper patch must parse to a patch list')
  return parsed.flatMap((patch): PatchRow[] =>
    typeof patch === 'object' && patch !== null
      ? (patch as { insert?: PatchRow[] }).insert ?? []
      : [])
}

describe('dsh-paper bundle patch', () => {
  it('inserts the Paper rows through the dsh.bundle.patch manifest field', () => {
    const ids = patchRows().map(row => row.id)
    expect(ids).toEqual(['paper', 'paper-skill-catalog', 'paper-catalog-provider', 'paper-invariant'])
  })

  it('routes the three roles and names a default mode', () => {
    const config = patchRows().find(row => row.id === 'paper')?.config
    expect(config?.['defaultMode']).toBe('fast')
    for (const role of ['executor', 'reviewer', 'editorAi']) {
      const route = config?.[role] as Record<string, unknown> | undefined
      expect(route?.['provider'], role).toBe('deepseek-official')
      expect(route?.['model'], role).toBe('deepseek-v4-flash')
      // A reference to a credential, never a credential value.
      expect(route?.['credentialRef'], role).toBe('DEEPSEEK_API_KEY')
    }
  })

  it('keeps the conservative trust defaults the layer ships with', () => {
    const paper = patchRows().find(row => row.id === 'paper')
    const release = paper?.config?.['releasePolicy'] as Record<string, unknown> | undefined
    // No trust root is declared and unsigned releases are refused, so updates
    // stay off until a deployment names a signing key.
    expect(release?.['trustRoots']).toBeUndefined()
    expect(release?.['allowUnsigned']).toBe(false)
    expect(release?.['harnessVersion']).toBe('0.1.1-rc.2')
    const migration = paper?.config?.['migrationPolicy'] as Record<string, unknown> | undefined
    expect(migration).toEqual({ harnessVersion: '0.1.1-rc.2', configHash: 'legacy-migration' })
    const catalog = patchRows().find(row => row.id === 'paper-skill-catalog')
    expect(catalog?.config?.['trustRoots']).toBeUndefined()
    expect(catalog?.config?.['allowUnsigned']).toBe(false)
    expect(catalog?.config?.['storeRoot']).toEqual({ __jsExpr: "dshHomePath('paper/skills')" })
  })

  it('names published entry points for every row', () => {
    for (const row of patchRows()) {
      expect(row.name, row.id).toMatch(/^@deepseek-ai\/dsh-paper-foundation(\/[a-z-]+)?$/u)
    }
  })
})

describe('missingPaperServices', () => {
  it('names every requirement a bare composition does not carry', () => {
    expect(missingPaperServices(new Context())).toEqual([...PAPER_REQUIRED_SERVICES])
  })

  it('reports nothing once the composition carries all three', () => {
    const ctx = new Context()
    for (const service of PAPER_REQUIRED_SERVICES) ctx.provide(service, {} as never)
    expect(missingPaperServices(ctx)).toEqual([])
  })
})

describe('dsh-paper plugin', () => {
  it('is a named plugin', () => {
    expect(name).toBe('paper-bundle')
  })

  it('throws naming the gap when a profile cannot activate the layer (TASK -1 rewire)', async () => {
    const ctx = new Context()
    ctx.provide('storage', {} as never)
    // TASK -1 rewire: warn-and-continue is forbidden in FORMAL; a profile
    // missing required services must surface the gap as a thrown error
    // rather than a warning, so the caller cannot silently boot a partial
    // composition.
    await expect(ctx.plugin(bundle)).rejects.toThrow(/paper-bundle: profile does not carry required services: storageDomain, llm/)
  })

  it('stays quiet when the composition is complete', async () => {
    const ctx = new Context()
    for (const service of PAPER_REQUIRED_SERVICES) ctx.provide(service, {} as never)

    const fiber = await ctx.plugin(bundle)
    // No warning, no throw — the layer is fully resolved.
    await fiber.dispose()
  })
})
