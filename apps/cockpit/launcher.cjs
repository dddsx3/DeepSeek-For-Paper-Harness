// paper-cockpit launcher — embedded into paper-cockpit.exe via Node SEA.
// Its ONLY job: bring the cockpit up on a machine where this folder exists,
// with zero terminal knowledge required from the student.
//
//   1. find a Node runtime (portable runtime/ next to the exe, then PATH)
//   2. spawn the cockpit server (node --import tsx/esm apps/cockpit/server.mjs)
//   3. wait for the port to answer
//   4. open the default browser at the cockpit page
//   5. keep the console open with a friendly status line until closed
//
// Everything engine-side lives in server.mjs (the projection layer); this
// launcher implements no project semantics.

const { spawn, exec } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const http = require('node:http')

const BANNER = [
  '',
  '  ==============================================',
  '   Paper Cockpit  ·  论文实测驾驶舱',
  '  ==============================================',
  '   正在启动,请稍候(首次约 5-15 秒)…',
  '   启动完成后会自动打开操作页面。',
  '   【关闭本窗口 = 停止驾驶舱】',
  '',
].join('\n')

function findNode() {
  // 1. portable runtime shipped with the release
  const candidates = [
    join(process.cwd(), 'runtime', 'node.exe'),
    join(process.cwd(), 'runtime', 'node'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // 2. whatever node is on PATH
  return process.execPath.startsWith(process.cwd())
    ? 'node'
    : 'node'
}

function repoRoot() {
  // Candidates, in order: the exe's own directory (double-click from a
  // Desktop shortcut starts with cwd = the shortcut's dir, NOT the exe's),
  // then walk up from cwd. First dir containing apps/cockpit/server.mjs wins.
  const candidates = [dirname(process.execPath), process.cwd()]
  for (const start of candidates) {
    let dir = start
    for (let i = 0; i < 6; i += 1) {
      if (existsSync(join(dir, 'apps', 'cockpit', 'server.mjs'))) return dir
      const parent = resolve(dir, '..')
      if (parent === dir) break
      dir = parent
    }
  }
  return process.cwd()
}

function waitForPort(port, timeoutMs) {
  const started = Date.now()
  return new Promise((done, fail) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/manifest', timeout: 1_500 }, (res) => {
        res.resume()
        done()
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) return fail(new Error('启动超时'))
        setTimeout(attempt, 700)
      })
      req.on('timeout', () => req.destroy())
    }
    attempt()
  })
}

// 一次性探测:1 秒内 /api/manifest 有响应即认为驾驶舱已在运行(双击防重)
function cockpitAlreadyUp(port) {
  return new Promise((done) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/manifest', timeout: 1_000 }, (res) => {
      res.resume()
      done(true)
    })
    req.on('error', () => done(false))
    req.on('timeout', () => {
      req.destroy()
      done(false)
    })
  })
}

function openBrowser(url) {
  const platform = process.platform
  if (platform === 'win32') exec(`start "" "${url}"`)
  else if (platform === 'darwin') exec(`open "${url}"`)
  else exec(`xdg-open "${url}"`)
}

async function main() {
  console.log(BANNER)
  const port = process.env.COCKPIT_PORT ?? '3081'
  const url = `http://127.0.0.1:${port}/`

  // 双击防重(用户反馈 #2):若 3081 已有驾驶舱在跑,直接复用——打开页面后退出,
  // 绝不 spawn 第二个 server(否则 EADDRINUSE 崩溃堆栈吓到学生)。
  if (await cockpitAlreadyUp(Number(port))) {
    console.log('   ✓ 驾驶舱已经在运行,正在打开页面…')
    console.log(`     ${url}`)
    console.log('')
    console.log('   本窗口可以直接关闭;驾驶舱仍由先前的窗口负责运行。')
    openBrowser(url)
    return
  }

  const root = repoRoot()
  process.chdir(root)
  const node = findNode()

  const server = spawn(node, ['--import', 'tsx/esm', 'apps/cockpit/server.mjs'], {
    cwd: root,
    env: { ...process.env, COCKPIT_PORT: port },
    stdio: 'inherit',
  })
  server.on('error', (error) => {
    console.error('')
    console.error('  ✗ 启动失败:', String(error.message ?? error))
    console.error('  请把本窗口截图发给操作者。')
  })

  try {
    await waitForPort(Number(port), 60_000)
    console.log(`   ✓ 驾驶舱已就绪:${url}`)
    console.log('   正在打开浏览器…(若没打开,手动访问上面的地址)')
    openBrowser(url)
  } catch {
    console.error('  ✗ 60 秒内服务未就绪 — 请把本窗口截图发给操作者。')
  }
  server.on('exit', () => {
    console.log('')
    console.log('  驾驶舱已停止。按任意键关闭本窗口…')
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.once('data', () => process.exit(0))
  })
}

main()
