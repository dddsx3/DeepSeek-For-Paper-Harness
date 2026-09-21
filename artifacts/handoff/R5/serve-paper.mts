/**
 * Serve one delivered paper for reading.
 *
 * Usage: tsx serve-paper.mts <delivery-dir> [port]
 *
 * The run's delivery directory is served as-is; `report.md` is additionally
 * rendered to HTML (a small converter for the subset the paper uses) so the
 * main text can be read in a browser. Nothing outside the directory is
 * reachable, and every other file is offered raw (the docx as a download, the
 * run report and the executed outputs as JSON).
 */
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const port = Number(process.argv[3] ?? '8788')

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Inline spans: code, bold, italic, links. Applied AFTER escaping. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s（(])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

/** Markdown -> HTML for the subset the paper uses (headings, tables, lists, hr, quotes). */
function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    if (trimmed === '') { i += 1; continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      const level = (heading[1] ?? '#').length
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`)
      i += 1
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { out.push('<hr>'); i += 1; continue }
    // table: header row + separator + body rows
    if (trimmed.startsWith('|') && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
      const cells = (row: string): string[] =>
        row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      const head = cells(trimmed)
      out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>')
      i += 2
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        out.push('<tr>' + cells((lines[i] ?? '').trim()).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>')
        i += 1
      }
      out.push('</tbody></table>')
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test((lines[i] ?? '').trim())) {
        quote.push((lines[i] ?? '').trim().replace(/^>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${quote.map(q => inline(q)).join('<br>')}</blockquote>`)
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        items.push(inline((lines[i] ?? '').trim().replace(/^[-*]\s+/, '')))
        i += 1
      }
      out.push('<ul>' + items.map(t => `<li>${t}</li>`).join('') + '</ul>')
      continue
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        items.push(inline((lines[i] ?? '').trim().replace(/^\d+\.\s+/, '')))
        i += 1
      }
      out.push('<ol>' + items.map(t => `<li>${t}</li>`).join('') + '</ol>')
      continue
    }
    // paragraph: consume until a blank line or a block starter
    const para: string[] = []
    while (i < lines.length) {
      const t = (lines[i] ?? '').trim()
      if (t === '' || t.startsWith('|') || /^#{1,6}\s/.test(t) || /^>\s?/.test(t) || /^[-*]\s+/.test(t)) break
      para.push(t)
      i += 1
    }
    if (para.length > 0) out.push(`<p>${para.map(p => inline(p)).join(' ')}</p>`)
  }
  return out.join('\n')
}

const PAGE = (title: string, body: string, nav: string): string => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #f6f6f4; color: #1a1a1a;
         font-family: "Songti SC", "SimSun", Georgia, serif; line-height: 1.75; }
  header { position: sticky; top: 0; background: #ffffffdd; backdrop-filter: blur(6px);
           border-bottom: 1px solid #ddd; padding: 10px 18px; font-family: system-ui, sans-serif;
           font-size: 13px; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  header a { color: #0b5fff; text-decoration: none; }
  header a:hover { text-decoration: underline; }
  header .tag { background: #eef3ff; color: #24418a; border-radius: 999px; padding: 2px 10px; }
  main { max-width: 860px; margin: 0 auto; padding: 28px 22px 80px; background: #fff;
         box-shadow: 0 0 0 1px #e6e6e6; }
  h1 { font-size: 27px; line-height: 1.35; margin: 8px 0 22px; }
  h2 { font-size: 20px; margin: 34px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #ececec; }
  h3 { font-size: 17px; margin: 24px 0 8px; }
  p { margin: 10px 0; text-align: justify; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 14px;
          font-family: system-ui, sans-serif; }
  th, td { border: 1px solid #dcdcdc; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #f2f5fa; font-weight: 600; }
  code { background: #f1f1f1; padding: 1px 5px; border-radius: 4px;
         font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  blockquote { margin: 14px 0; padding: 10px 16px; background: #fffaf0;
               border-left: 4px solid #e8c07a; color: #4a4237; font-size: 14px; }
  hr { border: 0; border-top: 1px solid #e8e8e8; margin: 26px 0; }
  ul, ol { padding-left: 26px; }
  a { color: #0b5fff; }
</style></head>
<body><header>${nav}</header><main>${body}</main></body></html>`

const navFor = (extra: string): string =>
  `<span class="tag">DPH 论文</span>${extra}<a href="/">正文</a>` +
  `<a href="/evidence">交付证据</a><a href="/paper.docx">下载 .docx</a><a href="/report.md">原始 Markdown</a>`

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    try {
      if (path === '/' || path === '/index.html') {
        const md = await readFile(join(dir, 'report.md'), 'utf8')
        const title = /^#\s+(.+)$/m.exec(md)?.[1] ?? '论文'
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(PAGE(title, renderMarkdown(md), navFor('')))
        return
      }
      if (path === '/evidence') {
        const parts: string[] = ['<h1>交付证据</h1>']
        const report = JSON.parse(await readFile(join(dir, 'run-report.json'), 'utf8')) as Record<string, unknown>
        const rows: Array<[string, string]> = [
          ['delivery_path', String(report['delivery_path'] ?? '')],
          ['status / grade', `${String(report['status'] ?? '')} / ${String(report['grade'] ?? '')}`],
          ['tier / mode', `${String(report['tier'] ?? '')} / ${String(report['mode'] ?? '')}`],
          ['sha256 (report.md)', String(report['sha256'] ?? '')],
          ['wall_clock_seconds', String(report['wall_clock_seconds'] ?? '')],
          ['minted_ir_count', String(report['minted_ir_count'] ?? '')],
          ['code_run_timeout_ms', String(report['code_run_timeout_ms'] ?? '')],
        ]
        parts.push('<h2>运行</h2><table><tbody>' + rows
          .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td><code>${escapeHtml(v)}</code></td></tr>`)
          .join('') + '</tbody></table>')
        const dataFiles = (report['data_files'] ?? []) as Array<{ file: string; sha256: string; bytes: number }>
        if (dataFiles.length > 0) {
          parts.push('<h2>执行输出（论文数字的来源字节）</h2><table><thead><tr><th>文件</th><th>字节</th><th>sha256</th></tr></thead><tbody>'
            + dataFiles.map(d => `<tr><td><a href="/${d.file}"><code>${escapeHtml(d.file)}</code></a></td><td>${d.bytes}</td><td><code>${escapeHtml(d.sha256.slice(0, 16))}…</code></td></tr>`).join('')
            + '</tbody></table>')
        }
        try {
          const pre = await readFile(join(dir, 'docx-precheck-report.md'), 'utf8')
          parts.push('<h2>docx 预检</h2>' + renderMarkdown(pre))
        } catch { /* not exported yet */ }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(PAGE('交付证据', parts.join('\n'), navFor('')))
        return
      }
      // static: everything inside the delivery dir, by relative path
      const target = normalize(join(dir, path))
      if (!target.startsWith(dir + sep)) { res.writeHead(403).end('forbidden'); return }
      const bytes = await readFile(target)
      const type = extname(target) === '.docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : extname(target) === '.json' ? 'application/json; charset=utf-8'
          : extname(target) === '.md' ? 'text/plain; charset=utf-8'
            : 'application/octet-stream'
      res.writeHead(200, { 'content-type': type })
      res.end(bytes)
    } catch (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`not found: ${path}\n${String(error)}`)
    }
  })()
})

server.listen(port, '127.0.0.1', async () => {
  const files = await readdir(dir).catch(() => [] as string[])
  console.log(`serving ${dir}`)
  console.log(`  http://127.0.0.1:${port}/`)
  console.log(`  files: ${files.sort().join(', ')}`)
})
