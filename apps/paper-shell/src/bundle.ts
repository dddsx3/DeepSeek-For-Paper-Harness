/**
 * P0-4 (PRD v2 §5.1.1/§5.1.2, W3) — problem bundling for the paper shell.
 *
 * The entry layer accepts a problem file (PDF or plain text: md/tex/docx
 * text is passed through) plus zero or more data attachments
 * (csv/xlsx/xlsm). The bundle assembles ONE taskText handed to the
 * executor:
 *
 *   [题目原文]
 *   ## 数据附件概况（自动生成，P0-4）
 *   <per-attachment profile: format/rows/columns/types/missing/suspicion>
 *
 * PDF text is extracted via the Python `pypdf` package (spawned once per
 * run) — the shell may call external tools for *reading*; the *engine* is
 * the one that must never depend on file formats (F5 closure: the shell
 * opts in to reading, the engine only consumes text).
 *
 * Profiling runs `scripts/summarize-data.py` per attachment. Design
 * rules from the PRD and the W1 metrics harness:
 *   - The profile is DESCRIPTION ONLY (行列/类型/缺失/量纲疑点) — the
 *     model does the modeling; the shell never interprets data.
 *   - Deterministic: same files -> same taskText (pypdf text and the
 *     profile script are both deterministic on the same input).
 *   - Big-file safe: the profile script streams/samples; the bundle
 *     never loads an attachment into memory.
 *   - The sha256 of every attachment (sample-hashed — the profile
 *     script hashes the sampled bytes, so a 490MB csv stays cheap) is
 *     recorded in the returned manifest for audit traceability.
 *
 * @module apps/paper-shell/src/bundle
 */

import { createHash } from 'node:crypto'
import { readFile, stat, open } from 'node:fs/promises'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'

/** `child.stdout`/`child.stderr` when stdio is 'pipe' — typed once so the
 *  spawn in runPython isn't fighting the ChildProcessByStdio union. */
interface PipedChild {
  readonly stdout: Readable | null
  readonly stderr: Readable | null
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}

const here = dirname(fileURLToPath(import.meta.url))
/** Repo root: ../../.. from apps/paper-shell/src. */
const REPO_ROOT = join(here, '..', '..', '..')
/** The profile helper the bundle invokes per attachment. */
export const PROFILE_SCRIPT = join(REPO_ROOT, 'scripts', 'summarize-data.py')

/** Text attachments passed through verbatim (guardrails in readProblemFile).
 *  PDF goes through pypdf. Anything else is refused up front. */
export const SUPPORTED_PROBLEM_EXTENSIONS = ['.md', '.tex', '.docx', '.txt', '.pdf'] as const
/** Data attachments the profiler understands. */
export const SUPPORTED_DATA_EXTENSIONS = ['.csv', '.xlsx', '.xlsm'] as const

/** One attachment's profile + integrity record. */
export interface AttachmentProfile {
  readonly file: string
  readonly basename: string
  readonly ext: string
  readonly sha256: string
  readonly bytes: number
  readonly profile: Record<string, unknown>
}

export interface BundleResult {
  readonly taskText: string
  readonly attachments: ReadonlyArray<AttachmentProfile>
  readonly problemSource: { readonly file: string; readonly bytes: number; readonly sha256: string }
}

export class BundleError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Spawn python and capture stdout (bounded: profile JSON is small).
 *  Deterministic: no env tampering, no cwd dependence beyond the script. */
function runPython(args: ReadonlyArray<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [...args], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }) as unknown as PipedChild
    const stdoutBuf: Buffer[] = []
    const stderrBuf: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => { stdoutBuf.push(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderrBuf.push(chunk) })
    child.on('error', (err) => {
      reject(new BundleError('PROFILE_SPAWN_FAILED', `cannot run python: ${String(err.message ?? err)}`))
    })
    child.on('close', (code) => {
      const out = Buffer.concat(stdoutBuf).toString('utf8')
      const err = Buffer.concat(stderrBuf).toString('utf8').slice(0, 400)
      if (code !== 0) {
        reject(new BundleError('PROFILE_SCRIPT_FAILED', `profiler exited ${code}: ${err}`))
        return
      }
      resolve(out)
    })
  })
}

/** sha256 of a file's first 4MB + a 64KB tail probe — cheap integrity for
 *  hundred-MB attachments; the bytes never load whole. */
export async function sampleHash(file: string): Promise<string> {
  const info = await stat(file)
  const size = info.size
  const hash = createHash('sha256')
  const head = Buffer.alloc(4 * 1024 * 1024)
  const fh = await open(file, 'r')
  try {
    const { bytesRead } = await fh.read(head, 0, 4 * 1024 * 1024, 0)
    hash.update(head.subarray(0, bytesRead))
    if (size > 4 * 1024 * 1024) {
      const tailLen = Math.min(64 * 1024, size - 4 * 1024 * 1024)
      const tail = Buffer.alloc(tailLen)
      await fh.read(tail, 0, tailLen, size - tailLen)
      hash.update(tail)
    }
  } finally {
    await fh.close()
  }
  return hash.digest('hex')
}

/** Extract PDF text via pypdf (one-shot python invoke). */
async function extractPdf(path: string): Promise<string> {
  const script = [
    'from pypdf import PdfReader;',
    'import sys;',
    'r = PdfReader(sys.argv[1]);',
    'print(\'\\n\'.join((p.extract_text() or \'\') for p in r.pages))',
  ].join('')
  const out = await runPython(['-c', script, path])
  const text = out.trim()
  if (text.length === 0) {
    throw new BundleError('PDF_TEXT_EMPTY', 'pypdf 未从该 PDF 提取到任何文本（可能是扫描件/图片型 PDF）')
  }
  return text
}

/** Profile one data attachment (csv/xlsx/xlsm) via the profiler. */
async function profileAttachment(file: string): Promise<AttachmentProfile> {
  const info = await stat(file)
  const basename = file.split(/[\\/]/).pop() ?? file
  const ext = extname(file).toLowerCase()
  if (!SUPPORTED_DATA_EXTENSIONS.includes(ext as (typeof SUPPORTED_DATA_EXTENSIONS)[number])) {
    throw new BundleError('DATA_UNSUPPORTED', `附件类型不支持：${ext}（支持 csv/xlsx/xlsm）`)
  }
  if (info.size === 0) throw new BundleError('DATA_EMPTY', `附件为空：${basename}`)
  const out = await runPython([PROFILE_SCRIPT, file, '--max-rows', '2000', '--sample', '8'])
  let profile: Record<string, unknown>
  try {
    profile = JSON.parse(out) as Record<string, unknown>
  } catch {
    throw new BundleError('PROFILE_PARSE_FAILED', `概况输出不是合法 JSON：${out.slice(0, 120)}`)
  }
  if ((profile as { error?: string }).error !== undefined) {
    throw new BundleError('PROFILE_REFUSED', `数据概况失败：${String((profile as { error?: string }).error)}`)
  }
  return {
    file,
    basename,
    ext,
    sha256: await sampleHash(file),
    bytes: info.size,
    profile,
  }
}

/** Hash a text/PDF problem file (whole for small files, sampled above
 *  4MB — still fine for ≤300KB PRD scope). */
async function hashProblem(file: string, bytes: number): Promise<string> {
  return bytes <= 4 * 1024 * 1024
    ? createHash('sha256').update(await readFile(file)).digest('hex')
    : sampleHash(file)
}

/** Shape of the profiler JSON (subset the renderer consumes). */
interface ProfileRow {
  readonly name: string
  readonly type: string
  readonly missing: number
  readonly missing_pct: number
  readonly suspicious: Array<string>
}
interface ProfileShape {
  readonly format?: string
  readonly encoding?: string
  readonly rows_sampled?: number
  readonly columns?: number
  readonly dimension_suspicion?: Array<string>
  readonly cols?: Array<ProfileRow>
}

/** Render one attachment's profile into the task text (concise, stable). */
function renderProfileText(p: AttachmentProfile, index: number): string {
  const prof = p.profile as ProfileShape
  const lines: string[] = []
  lines.push(`### 附件 ${index + 1}：${p.basename}`)
  const enc = prof.encoding === undefined ? '' : `（编码 ${prof.encoding}）`
  lines.push(`- 格式:${prof.format ?? p.ext}${enc};行数(采样 ${prof.rows_sampled ?? '?'})列数 ${prof.columns ?? '?'};sha256 ${p.sha256}`)
  for (const col of prof.cols ?? []) {
    const flags: string[] = []
    if (col.type === 'mixed') flags.push('类型混合')
    if (col.missing > 0) flags.push(`缺失 ${col.missing}（${col.missing_pct}%）`)
    if (col.suspicious.length > 0) flags.push(`量纲疑点 ${JSON.stringify(col.suspicious.slice(0, 3))}`)
    lines.push(`  - \`${col.name}\`：${col.type}${flags.length === 0 ? '' : `（${flags.join('；')}）`}`)
  }
  if ((prof.dimension_suspicion ?? []).length > 0) {
    lines.push(`- ⚠ 量纲疑点列：${(prof.dimension_suspicion ?? []).join('、')} —— 请建模时核对单位`)
  }
  return lines.join('\n')
}

/**
 * Assemble the bundle: read/extract the problem text, profile every data
 * attachment, and build the task text with the profile appendix.
 */
export async function assembleBundle(
  problemFile: string,
  dataFiles: ReadonlyArray<string> = [],
): Promise<BundleResult> {
  const info = await stat(problemFile).catch(() => null)
  if (info === null || !info.isFile()) throw new BundleError('PROBLEM_MISSING', `题目文件不存在：${problemFile}`)
  const ext = extname(problemFile).toLowerCase()
  if (!SUPPORTED_PROBLEM_EXTENSIONS.includes(ext as (typeof SUPPORTED_PROBLEM_EXTENSIONS)[number])) {
    throw new BundleError('PROBLEM_UNSUPPORTED', `题目类型不支持：${ext}（支持 md/tex/docx/txt/pdf）`)
  }

  let problemText: string
  let problemBytes = info.size
  if (ext === '.pdf') {
    problemText = await extractPdf(problemFile)
    problemBytes = Buffer.byteLength(problemText, 'utf8')
  } else {
    const raw = await readFile(problemFile, 'utf8')
    if (raw.includes('\uFFFD')) throw new BundleError('PROBLEM_NOT_UTF8', `题目文件不是有效 UTF-8：${problemFile}`)
    problemText = raw.trim()
  }
  if (problemText.length === 0) throw new BundleError('PROBLEM_EMPTY', `题目内容为空：${problemFile}`)

  const attachments: AttachmentProfile[] = []
  for (let i = 0; i < dataFiles.length; i += 1) {
    const f = dataFiles[i]
    if (f === undefined) continue
    attachments.push(await profileAttachment(f))
  }

  const problemSha = await hashProblem(problemFile, info.size)
  let taskText = problemText
  if (attachments.length > 0) {
    const appendix = attachments.map((p, i) => renderProfileText(p, i)).join('\n\n')
    taskText += `\n\n## 数据附件概况（自动生成）\n\n${appendix}\n`
  }
  return {
    taskText,
    attachments,
    problemSource: { file: problemFile, bytes: problemBytes, sha256: problemSha },
  }
}
