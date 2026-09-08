/**
 * TASK-C1 — Paper Cockpit server: the projection layer between the engine
 * and the student-facing cockpit page (C-A decision: independent shell with
 * a SHARED subscription layer).
 *
 * 禁 C1-0 self-check: this file implements NO engine semantics. It
 *   - projects durable workflow records (run/node/event/artifact) read-only,
 *   - reuses apps/paper-shell's guards verbatim (readProblemFile),
 *   - reuses apps/paper-shell's manifest verify verbatim,
 *   - reuses apps/paper-shell's human-facing block message table verbatim,
 *   - runs the shell's engine composition for runs (fake or real route),
 *   - writes exactly ONE study artifact: the FalseBlock adjudication trail
 *     (a research record defined by pilot-protocol §2, not engine state).
 *
 * Endpoints:
 *   GET  /                          → cockpit page (static)
 *   POST /api/problems              → upload problem + data files (guards)
 *   GET  /api/runs                  → run list
 *   GET  /api/runs/:id              → run projection (record + nodes + events)
 *   GET  /api/runs/:id/stream       → SSE incremental event stream (afterSeq)
 *   GET  /api/manifest              → manifest verify projection (badge)
 *   POST /api/falseblock            → archive one FALSE_BLOCK claim (研究档案)
 *   GET  /api/falseblock            → read the adjudication trail
 *
 * @module apps/cockpit/server
 */

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shellSrc = resolve(here, '../paper-shell/src')
const staticDir = resolve(here, 'public')
const studyDir = resolve(here, '../../artifacts/handoff/TASK-P2/study')
const falseBlockPath = join(studyDir, 'falseblock.jsonl')
// TASK-C1.5 (user feedback): free API configuration. Profiles live in a
// gitignored local file; the KEY never goes back to the UI (masked tail only)
// and never into the repository. Runs inject the ACTIVE profile's route into
// the child env — different keys = different accounts = costs stay separated.
const settingsPath = resolve(here, 'cockpit-settings.json')
function loadSettings() {
  try {
    const doc = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (!Array.isArray(doc.profiles)) return { profiles: [], activeId: null }
    return doc
  } catch {
    return { profiles: [], activeId: null }
  }
}
function saveSettings(doc) {
  writeFileSync(settingsPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
}
function maskKey(key) {
  if (typeof key !== 'string' || key.length < 8) return '****'
  return key.slice(0, 5) + '…' + key.slice(-4)
}
function activeProfile(doc) {
  return doc.profiles.find(p => p.id === doc.activeId) ?? null
}

// ---------------------------------------------------------------------------
// Reused shell surfaces (零复制 — C-A/禁 C1-0)
// ---------------------------------------------------------------------------

const { readProblemFile, blockMessage, resolveShellRoute } = await import(
  `file://${shellSrc}/invoke.ts`
)
const { verifyStudyManifest } = await import(`file://${shellSrc}/study-manifest.ts`)

// ---------------------------------------------------------------------------
// Engine composition (the shell's own buildContext, reused wholesale)
// ---------------------------------------------------------------------------

async function buildEngineContext() {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const mod = await import(`file://${shellSrc}/cli.ts`)
  // cli.ts builds its context inside main(); for the cockpit we reuse the
  // exported pieces through a small factory the shell already exposes.
  // To avoid a shell refactor (禁全批: no engine/shell semantics change),
  // the cockpit spawns `paper-shell run` as a CHILD PROCESS per submission —
  // the same entry the CLI user gets, same persistence root, same guards.
  return mod
}

const shellRoot = resolve(here, '../paper-shell')
const problemsDir = join(shellRoot, 'cockpit-problems')
const outRoot = join(shellRoot, 'cockpit-out')
const persistRoot = join(shellRoot, 'paper-shell-persist-cockpit')

const FAKE_T3_DEMO = resolve(here, '../../artifacts/handoff/TASK-M1/samples/course-work.md')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res, code, body) {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // CORS: the cockpit page may be opened via file:// during development —
    // a permissive preflight keeps that path alive; same-origin requests
    // never see these headers' downsides. This server binds 127.0.0.1 only.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(payload)
}

/** Read the request body with explicit error/abort handling (event-based:
 *  the async-iterator form turned mid-stream client aborts into unhandled
 *  ECONNRESET — the "read body failed" class of failures). */
function readBody(req, limitBytes = 8_000_000) {
  return new Promise((done, fail) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        req.removeAllListeners('data')
        fail(new Error('payload too large'))
        req.resume() // drain the rest so the socket can close cleanly
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => done(Buffer.concat(chunks)))
    req.on('error', (error) => fail(error))
  })
}

/** Minimal multipart/form-data parser for file uploads (the drag-drop
 *  natural client shape). Extracts text/binary parts as Buffers keyed by
 *  their filename. Deliberately small: this server's contract prefers the
 *  JSON/base64 shape; multipart exists so a FormData client still works. */
function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (match === null) return null
  const boundary = `--${match[1] ?? match[2]}`
  const parts = []
  let start = buffer.indexOf(boundary)
  while (start !== -1) {
    const next = buffer.indexOf(boundary, start + boundary.length)
    if (next === -1) break
    const segment = buffer.subarray(start + boundary.length + 2, next - 2) // \r\n delimiters
    const headerEnd = segment.indexOf('\r\n\r\n')
    if (headerEnd !== -1) {
      const headers = segment.subarray(0, headerEnd).toString('utf8')
      const body = segment.subarray(headerEnd + 4)
      const nameMatch = /name="([^"]*)"/.exec(headers)
      const fileMatch = /filename="([^"]*)"/.exec(headers)
      parts.push({
        name: nameMatch?.[1] ?? 'field',
        filename: fileMatch?.[1] ?? null,
        data: body,
      })
    }
    start = next
  }
  return parts
}

/** The shell's persistence roots: mkdtemp(here + 'paper-shell-persist-*')
 *  inside apps/paper-shell/src (one temp dir per CLI invocation, holding a
 *  storage-domain JSON document with tables.{runs,nodes,events,artifacts}). */
const persistBase = resolve(shellRoot, 'src')

function listRunDirs() {
  if (!existsSync(persistBase)) return []
  return readdirSync(persistBase)
    .filter(name => name.startsWith('paper-shell-persist-'))
    .map(name => join(persistBase, name))
    .sort((a, b) => b.localeCompare(a))
}

/** Read one run's durable records out of a persistence dir's workflow doc. */
function readRunRecords(runId) {
  for (const dir of listRunDirs()) {
    const workflowPath = join(dir, 'paper_workflow.json')
    if (!existsSync(workflowPath)) continue
    let doc
    try {
      doc = JSON.parse(readFileSync(workflowPath, 'utf8'))
    } catch { continue }
    const tables = doc.tables ?? {}
    const rowsOf = (table) => Object.values(table ?? {})
    const run = rowsOf(tables.runs).find(r => r.id === runId)
    if (run === undefined) continue
    return {
      run: [run],
      nodes: rowsOf(tables.nodes).filter(n => n.runId === runId),
      events: rowsOf(tables.events).filter(e => e.runId === runId).sort((a, b) => a.seq - b.seq),
      artifacts: rowsOf(tables.artifacts).filter(a => a.runId === runId),
    }
  }
  return null
}

function listRunIds() {
  const ids = []
  for (const dir of listRunDirs()) {
    const workflowPath = join(dir, 'paper_workflow.json')
    if (!existsSync(workflowPath)) continue
    try {
      const doc = JSON.parse(readFileSync(workflowPath, 'utf8'))
      for (const run of Object.values(doc.tables?.runs ?? {})) ids.push(run.id)
    } catch { /* unreadable dir — skip */ }
  }
  return [...new Set(ids)]
}

// ---------------------------------------------------------------------------
// Run submission: spawn the real shell CLI (same entry as the CLI user)
// ---------------------------------------------------------------------------

const activeRuns = new Map() // runKey → { status, startedAt, runId? }

async function submitRun(problemPath, tier, mode, useFake, profileId) {
  const runKey = `run-${Date.now().toString(36)}`
  // Route resolution: the ACTIVE cockpit profile wins; a request-level
  // profileId picks a non-active one; no profile = fall back to the process
  // env (previous behaviour). Different profiles = different accounts =
  // costs never pile onto one account (user feedback 2026-09-08).
  let routeEnv = process.env
  if (!useFake) {
    const doc = loadSettings()
    const profile = doc.profiles.find(p => p.id === profileId) ?? activeProfile(doc)
    if (profile !== null) {
      routeEnv = {
        ...process.env,
        PAPER_PROBE_API_KEY: profile.apiKey,
        PAPER_PROBE_BASE_URL: profile.endpoint,
        PAPER_PROBE_MODEL: profile.model,
        PAPER_PROBE_PROVIDER: profile.provider ?? 'openai-compatible-relay',
      }
    }
  }
  const entry = { status: 'starting', startedAt: new Date().toISOString(), tier, mode, fake: useFake, runId: null, reportPath: null, error: null, profile: useFake ? null : (routeEnv.PAPER_PROBE_MODEL ?? null) }
  activeRuns.set(runKey, entry)
  void (async () => {
    try {
      entry.status = 'running'
      // Windows: `npx` is a .cmd and needs a shell; but shell-mode joins args
      // with spaces and the problem path contains spaces. Spawn node directly
      // (an .exe, no shell) with tsx as an --import loader — robust on both.
      const { spawn } = await import('node:child_process')
      const repoRoot = resolve(here, '../..')
      const args = ['--import', 'tsx/esm', 'apps/paper-shell/src/cli.ts', 'run', problemPath, '--tier', tier, '--mode', mode, '--out', outRoot]
      if (useFake) args.push('--fake')
      const child = spawn(process.execPath, args, { cwd: repoRoot, env: routeEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      // A child launch failure (ENOENT etc.) must NEVER kill the cockpit —
      // it aborts THIS run and the UI shows the failure (run2 incident: the
      // unhandled 'error' event was what kept producing "read body failed").
      child.on('error', (error) => {
        entry.status = 'FAILED'
        entry.error = `启动运行进程失败:${String(error.message ?? error).slice(0, 160)}`
      })
      let stdout = ''
      child.stdout.on('data', (d) => { stdout += String(d) })
      child.stderr.on('data', (d) => { stdout += String(d) })
      const code = await new Promise(done => child.on('exit', (c) => done(c)))
      const delivered = /DELIVERED/.test(stdout)
      const blocked = /BLOCKED/.test(stdout)
      const runIdMatch = stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
      entry.runId = runIdMatch?.[0] ?? null
      entry.exitCode = code
      entry.status = delivered ? 'DELIVERED' : blocked ? 'BLOCKED' : 'FAILED'
      entry.reportPath = join(outRoot, 'report.md')
      entry.outputHead = stdout.slice(-1_200)
    } catch (error) {
      entry.status = 'FAILED'
      entry.error = String(error).slice(0, 200)
    }
  })()
  return runKey
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

async function handleUpload(req, res) {
  // TWO accepted shapes (both funneled into the SAME readProblemFile guards —
  // 零复制,禁 C1-2):
  //   1. JSON:  {problem:{name, contentBase64}, data?: [{name, contentBase64}]}
  //   2. multipart/form-data: file parts named "problem" (one) and "data"
  //      (any number) — the drag-drop natural client shape.
  await mkdir(problemsDir, { recursive: true })
  const problemFiles = [] // {name, buffer}
  const dataFilesIn = []
  const contentType = req.headers['content-type'] ?? ''
  const raw = await readBody(req)

  if (contentType.includes('multipart/form-data')) {
    const parts = parseMultipart(raw, contentType)
    if (parts === null) return json(res, 400, { ok: false, reason: 'multipart 请求缺少 boundary' })
    for (const part of parts) {
      if (part.filename === null) continue
      if (part.name === 'problem') problemFiles.push({ name: part.filename, buffer: part.data })
      else if (part.name === 'data') dataFilesIn.push({ name: part.filename, buffer: part.data })
    }
  } else {
    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch (error) {
      return json(res, 400, { ok: false, reason: `请求体不是合法 JSON:${String(error.message ?? error).slice(0, 80)}` })
    }
    if (typeof body?.problem?.contentBase64 !== 'string') {
      return json(res, 400, { ok: false, reason: '缺少题目文件内容' })
    }
    problemFiles.push({ name: body.problem.name ?? 'problem.md', buffer: Buffer.from(body.problem.contentBase64, 'base64') })
    for (const data of body.data ?? []) {
      dataFilesIn.push({ name: data.name ?? 'data.csv', buffer: Buffer.from(data.contentBase64, 'base64') })
    }
  }

  if (problemFiles.length === 0) {
    return json(res, 400, { ok: false, reason: '缺少题目文件（problem 字段或名为 problem 的文件部分）' })
  }
  const problem = problemFiles[0]
  const problemPath = join(problemsDir, `problem-${Date.now().toString(36)}-${problem.name.replace(/[^\w.\-一-龥]+/g, '_')}`)
  await writeFile(problemPath, problem.buffer)
  try {
    await readProblemFile(problemPath) // SAME guard as the CLI (三拒: 300KB/空/编码)
  } catch (error) {
    return json(res, 422, { ok: false, reason: String(error.message ?? error) })
  }
  // Data files register into the sandbox environment only — they are saved
  // next to the problem for the run's code to read and NEVER enter any
  // prompt-assembly path (禁 C1-2; the shell's executor reads them as inputs).
  const dataFiles = []
  for (const data of dataFilesIn) {
    const dataPath = join(problemsDir, `data-${Date.now().toString(36)}-${data.name.replace(/[^\w.\-]+/g, '_')}`)
    await writeFile(dataPath, data.buffer)
    dataFiles.push({ name: data.name, path: dataPath, sha256: createHash('sha256').update(data.buffer).digest('hex') })
  }
  const problemHash = createHash('sha256').update(await readFile(problemPath)).digest('hex')
  return json(res, 200, { ok: true, problemPath, problem_sha256: problemHash, dataFiles })
}

async function handleManifest(res) {
  // The badge is the CLI verify projected — SAME function (禁 C1-5).
  const manifestPath = resolve(here, '../../artifacts/handoff/TASK-P2/study-manifest/study-manifest.json')
  if (!existsSync(manifestPath)) {
    return json(res, 200, { frozen: false, reason: 'STUDY_MANIFEST 尚未冻结（模板已在库，待用户名单登记）' })
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const { execSync } = await import('node:child_process')
  let git_commit = '(git unavailable)'
  try {
    git_commit = execSync('git rev-parse HEAD', { cwd: resolve(here, '../..'), encoding: 'utf8' }).trim()
  } catch { /* verify will report */ }
  const result = verifyStudyManifest(manifest, {
    git_commit,
    fingerprint_namespaces: Object.values((await import(`file://${resolve(here, '../../packages/paper/paper-foundation/src/ir/evidence-freeze.ts')}`)).FINGERPRINT_NAMESPACES),
    gate_baseline: { files: 100, total_tests: 1112 },
    model: resolveShellRoute(process.env)?.model ?? manifest.route.model,
    problem_files_root: dirname(manifestPath),
  })
  return json(res, 200, {
    frozen: true,
    ok: result.ok,
    drifts: result.drifts,
    study_id: manifest.study_id,
    git_commit: manifest.git_commit,
    manifest_hash: manifest.manifest_hash,
  })
}

async function handleFalseBlock(req, res) {
  if (req.method === 'GET') {
    const lines = existsSync(falseBlockPath)
      ? readFileSync(falseBlockPath, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
      : []
    return json(res, 200, { ok: true, claims: lines })
  }
  // POST: one student appeal → the pilot-protocol §2 adjudication record
  // (student fills reason + case; TRUE/FALSE_BLOCK/UNCERTAIN is filled by
  // operator + audit track later — the student never adjudicates).
  const body = JSON.parse((await readBody(req)).toString('utf8'))
  const record = {
    case_id: body.case_id ?? '(unspecified)',
    run_id: body.run_id ?? null,
    gate: body.gate ?? '(from run report)',
    failure_code: body.failure_code ?? null,
    model_output_head: (body.model_output_head ?? '').slice(0, 120),
    validator_evidence: body.validator_evidence ?? null,
    adjudication: 'UNCERTAIN', // student appeal starts here; operator + audit fill
    adjudication_reason: body.reason ?? '(学生一句话申诉)',
    adjudicated_by: 'student-appeal',
    at: new Date().toISOString(),
  }
  await mkdir(dirname(falseBlockPath), { recursive: true })
  await appendFile(falseBlockPath, `${JSON.stringify(record)}\n`, 'utf8')
  return json(res, 200, { ok: true, record })
}

// ---------------------------------------------------------------------------
// Static + routes
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  // CORS preflight: the cockpit page may be opened from file:// or another
  // local port; without this the browser kills the real POST before it is
  // ever read (the "read body failed" class of failures).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    })
    return res.end()
  }
  try {
    if (req.method === 'POST' && url.pathname === '/api/problems') return await handleUpload(req, res)
    if (req.method === 'POST' && url.pathname === '/api/runs') {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const runKey = await submitRun(body.problemPath, body.tier ?? 'T3', body.mode ?? 'strict', body.fake === true, body.profileId)
      return json(res, 200, { ok: true, runKey })
    }
    // TASK-C1.5: free API configuration (profiles; key masked, never returned)
    if (url.pathname === '/api/settings') {
      const doc = loadSettings()
      if (req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          activeId: doc.activeId,
          profiles: doc.profiles.map(p => ({
            id: p.id, name: p.name, endpoint: p.endpoint, model: p.model,
            provider: p.provider ?? 'openai-compatible-relay',
            apiKeyMasked: maskKey(p.apiKey),
          })),
        })
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8'))
        // Replace-all semantics from the UI: {profiles:[{name,endpoint,model,provider?,apiKey?}], activeId}
        // apiKey omitted on an existing id = keep the stored key (edit without retyping).
        if (!Array.isArray(body?.profiles)) return json(res, 400, { ok: false, reason: '缺少 profiles 数组' })
        const next = []
        for (const p of body.profiles) {
          if (typeof p.name !== 'string' || p.name.trim() === '') return json(res, 400, { ok: false, reason: '配置缺少名称' })
          if (typeof p.endpoint !== 'string' || !/^https?:\/\//.test(p.endpoint)) return json(res, 400, { ok: false, reason: `配置「${p.name}」的 endpoint 必须是 http(s) 地址` })
          if (typeof p.model !== 'string' || p.model.trim() === '') return json(res, 400, { ok: false, reason: `配置「${p.name}」缺少模型 ID` })
          const prior = doc.profiles.find(old => old.id === p.id)
          const apiKey = typeof p.apiKey === 'string' && p.apiKey.trim() !== ''
            ? p.apiKey.trim()
            : prior?.apiKey ?? ''
          if (apiKey === '') return json(res, 400, { ok: false, reason: `配置「${p.name}」缺少 API key` })
          next.push({
            id: p.id ?? `profile-${Date.now().toString(36)}-${next.length}`,
            name: p.name.trim(),
            endpoint: p.endpoint.replace(/\/$/, ''),
            model: p.model.trim(),
            provider: p.provider ?? 'openai-compatible-relay',
            apiKey,
          })
        }
        const activeId = next.some(p => p.id === body.activeId) ? body.activeId : (next[0]?.id ?? null)
        const doc = { profiles: next, activeId }
        saveSettings(doc)
        return json(res, 200, { ok: true, activeId, count: next.length })
      }
    }
    // Live connectivity probe for one profile (cheap: GET /models, no tokens)
    if (req.method === 'POST' && url.pathname === '/api/settings/test') {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const doc = loadSettings()
      const profile = doc.profiles.find(p => p.id === body.profileId) ?? activeProfile(doc)
      if (profile === null) return json(res, 400, { ok: false, reason: '没有可测试的配置' })
      try {
        const response = await fetch(`${profile.endpoint.replace(/\/$/, '')}/models`, {
          headers: { authorization: `Bearer ${profile.apiKey}` },
          signal: AbortSignal.timeout(15_000),
        })
        if (response.ok) {
          const list = await response.json().catch(() => null)
          const ids = Array.isArray(list?.data) ? list.data.map(m => m.id).slice(0, 40) : null
          return json(res, 200, { ok: true, detail: `端点可达(${response.status})`, models: ids })
        }
        return json(res, 200, { ok: false, detail: `端点返回 ${response.status}${response.status === 401 ? '(key 无效)' : ''}` })
      } catch (error) {
        return json(res, 200, { ok: false, detail: `无法连接:${String(error.cause?.message ?? error.message ?? error).slice(0, 120)}` })
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/runs/active') {
      return json(res, 200, { ok: true, runs: Object.fromEntries(activeRuns) })
    }
    if (req.method === 'GET' && url.pathname === '/api/runs') {
      return json(res, 200, { ok: true, runIds: listRunIds() })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/stream')) {
      const runId = url.pathname.split('/')[3]
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      let afterSeq = Number(url.searchParams.get('afterSeq') ?? '0')
      const timer = setInterval(() => {
        const records = readRunRecords(runId)
        if (records === null) {
          res.write(`event: pending\ndata: {}\n\n`)
          return
        }
        const fresh = records.events.filter(e => e.seq > afterSeq).sort((a, b) => a.seq - b.seq)
        for (const event of fresh) {
          afterSeq = Math.max(afterSeq, event.seq)
          res.write(`id: ${event.seq}\nevent: engine\ndata: ${JSON.stringify({ kind: 'event', event })}\n\n`)
        }
        if (records.run.length > 0) {
          res.write(`event: snapshot\ndata: ${JSON.stringify({ kind: 'snapshot', run: records.run[0], nodes: records.nodes, artifacts: records.artifacts })}\n\n`)
        }
      }, 1_500)
      req.on('close', () => clearInterval(timer))
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
      const runId = url.pathname.split('/')[3]
      const records = readRunRecords(runId)
      if (records === null) return json(res, 404, { ok: false, reason: 'run 不存在' })
      return json(res, 200, { ok: true, ...records })
    }
    if (url.pathname === '/api/manifest') return await handleManifest(res)
    if (url.pathname === '/api/falseblock') return await handleFalseBlock(req, res)
    if (req.method === 'POST' && url.pathname === '/api/demo-run') {
      // 一键演示:the fake sample problem through the shell, no key needed.
      const runKey = await submitRun(FAKE_T3_DEMO, 'T3', 'strict', true)
      return json(res, 200, { ok: true, runKey })
    }
    // Static cockpit page.
    const path = url.pathname === '/' ? '/index.html' : url.pathname
    const file = join(staticDir, path.replace(/\.\./g, ''))
    if (existsSync(file)) {
      const content = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      return res.end(content)
    }
    return json(res, 404, { ok: false, reason: 'not found' })
  } catch (error) {
    return json(res, 500, { ok: false, reason: String(error.message ?? error).slice(0, 200) })
  }
})

// A malformed request or an abruptly-closed socket must not take the whole
// cockpit down (the default clientError destroys without a response body,
// which surfaces to the client as an opaque 'read body failed').
server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\n\r\n{"ok":false,"reason":"请求不完整或已中断"}')
  }
})

const PORT = Number(process.env.COCKPIT_PORT ?? '3081')
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('')
    console.error('  ✗ 端口 3081 已被占用 —— 驾驶舱很可能已经在运行了。')
    console.error('    直接在浏览器打开 http://127.0.0.1:3081/ 即可;')
    console.error('    或在任务管理器结束旧的 paper-cockpit / node 进程后重试。')
  } else {
    console.error('  ✗ 服务启动失败:', String(error.message ?? error))
  }
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`paper-cockpit listening on http://127.0.0.1:${PORT}`)
  console.log('projection layer only — engine semantics live in paper-shell (禁 C1-0)')
})
