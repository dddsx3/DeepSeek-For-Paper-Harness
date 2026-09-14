/**
 * P0-4 (PRD v2 §5.1.1/§5.1.2, W3) — bundle tests.
 *
 * Asserts the entry layer:
 *   - a PDF problem extracts real text via pypdf and becomes taskText;
 *   - data attachments (csv/xlsx) are profiled and their profile is
 *     appended to taskText (格式/编码/行列/列类型/缺失/量纲疑点);
 *   - the profile is DESCRIPTION-only (never interprets the data);
 *   - big-file attachments are sampled, not streamed whole (the profile
 *     itself is bounded; sha256 is a sample hash);
 *   - unsupported attachments / empty files / non-UTF problems are
 *     refused loudly with a stable code (M1-2 攻击 surface).
 *
 * Uses the real bench corpus (2024-C pdf + attachments) plus generated
 * fixtures — deterministic, offline, no network.
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assembleBundle,
  sampleHash,
  PROFILE_SCRIPT,
  SUPPORTED_PROBLEM_EXTENSIONS,
  SUPPORTED_DATA_EXTENSIONS,
} from '../src/bundle.ts'
import { existsSync } from 'node:fs'

const CORPUS = join(import.meta.dirname ?? '..', '..', '..', '..', 'bench', 'problems')
const C_PDF = join(CORPUS, '2024-C', 'problem.pdf')
const C_XLSX_1 = join(CORPUS, '2024-C', 'attachment-1.xlsx')
const C_XLSX_2 = join(CORPUS, '2024-C', 'attachment-2.xlsx')

describe('bundle — problem ingestion', () => {
  it('accepts plain-text problems unchanged (md)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-bundle-'))
    const md = join(dir, 'plain.md')
    await writeFile(md, '问题一：求最优解。', 'utf8')
    const bundle = await assembleBundle(md)
    expect(bundle.taskText).toContain('问题一：求最优解。')
    expect(bundle.attachments).toHaveLength(0)
    expect(bundle.problemSource.bytes).toBeGreaterThan(0)
  })

  it('extracts a PDF problem via pypdf (2024 C)', async () => {
    expect(existsSync(C_PDF)).toBe(true)
    const bundle = await assembleBundle(C_PDF)
    expect(bundle.taskText).toContain('C 题')
    expect(bundle.taskText).toContain('种植')
    expect(bundle.attachments).toHaveLength(0)
  })

  it('refuses an unsupported problem extension loudly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-bundle-'))
    const bad = join(dir, 'x.exe')
    await writeFile(bad, 'not a problem')
    await expect(assembleBundle(bad)).rejects.toMatchObject({ code: 'PROBLEM_UNSUPPORTED' })
  })

  it('refuses a non-UTF8 text problem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-bundle-'))
    const latin1 = join(dir, 'latin.md')
    await writeFile(latin1, Buffer.from([0xff, 0xfe, 0x61, 0x62, 0x63])) // latin-1 junk
    await expect(assembleBundle(latin1)).rejects.toMatchObject({ code: 'PROBLEM_NOT_UTF8' })
  })
})

describe('bundle — data attachments + profile', () => {
  it('appends a description-only profile for every xlsx attachment', async () => {
    const bundle = await assembleBundle(C_PDF, [C_XLSX_1, C_XLSX_2])
    expect(bundle.attachments).toHaveLength(2)
    const task = bundle.taskText
    expect(task).toContain('数据附件概况（自动生成）')
    expect(task).toContain('附件 1：attachment-1.xlsx')
    expect(task).toContain('附件 2：attachment-2.xlsx')
    expect(task).toContain('格式')
    expect(task).toContain('列数')
    expect(task).toContain('地块面积/亩')
    // Description only: the profile never states a model decision or a
    // "correct" answer — only rows/cols/types/missing/suspicion.
    expect(task).not.toContain('期望')
  })

  it('carries sha256 + bytes for audit traceability', async () => {
    const bundle = await assembleBundle(C_PDF, [C_XLSX_1])
    const p = bundle.attachments[0]
    expect(p?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(p?.bytes).toBeGreaterThan(0)
    expect(p?.basename).toBe('attachment-1.xlsx')
  })

  it('refuses an unsupported attachment extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-bundle-'))
    const bad = join(dir, 'x.png')
    await writeFile(bad, 'not data')
    await expect(assembleBundle(C_PDF, [bad])).rejects.toMatchObject({ code: 'DATA_UNSUPPORTED' })
  })

  it('refuses an empty attachment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-bundle-'))
    const empty = join(dir, 'empty.csv')
    await writeFile(empty, '', 'utf8')
    await expect(assembleBundle(C_PDF, [empty])).rejects.toMatchObject({ code: 'DATA_EMPTY' })
  })
})

describe('bundle — big-file safety', () => {
  it('sampleHash covers head + tail without loading the whole file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-hash-'))
    const big = join(dir, 'big.csv')
    // 6MB of zeros + a recognizable tail marker: head probe should hash
    // the marker at the very end while skipping the middle.
    const head = Buffer.alloc(4 * 1024 * 1024, 0x41)
    const marker = Buffer.from('TAIL-MARKER-1234567890', 'utf8')
    const pad = Buffer.alloc(2 * 1024 * 1024 - marker.length, 0x42)
    await writeFile(big, Buffer.concat([head, pad, marker]))
    const hash = await sampleHash(big)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // A change to the tail marker must change the sample hash.
    await writeFile(big, Buffer.concat([head, pad, Buffer.from('TAIL-MARKER-9999999999', 'utf8')]))
    expect(await sampleHash(big)).not.toBe(hash)
  })

  it('the profiler script path resolves inside the repo', () => {
    expect(existsSync(PROFILE_SCRIPT)).toBe(true)
  })
})

describe('bundle — supported surfaces', () => {
  it('the closed extension lists match the PRD entry surface', () => {
    expect(SUPPORTED_PROBLEM_EXTENSIONS).toContain('.pdf')
    expect(SUPPORTED_PROBLEM_EXTENSIONS).toContain('.md')
    expect(SUPPORTED_DATA_EXTENSIONS).toEqual(['.csv', '.xlsx', '.xlsm'])
  })
})
