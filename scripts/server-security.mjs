#!/usr/bin/env node
// 层级 9 · 安全集成测试：对"真的在跑"的服务器做黑盒检查（npm run test:server:security）。
//
//   - 未登录访问 /api、/media、WebSocket → 401
//   - POST 不带 X-Vixel 头 → 403（CSRF）
//   - 错误口令连续尝试 → 429 限速
//   - 正确口令 → 会话 cookie → API 可用；注销后 cookie 失效
//   - 桌面专属方法 → 501 并说明
//   - 不设 VIXEL_PASSWORD（且不设 VIXEL_ALLOW_NO_AUTH）→ 拒绝启动
//
// 需要先 npm run build:server（test:server:security 脚本里已串联）；
// 本机（Electron ABI 的 node_modules）还需要一次性 npm run server:deps。
//
// 容器模式（plan.md 层级 9 在容器里重跑）：--docker <image>
//   每个"启动服务器"的步骤换成 docker run --rm（临时数据目录 bind 到 /data，口令等走 -e），
//   检查内容与本地模式完全一致 —— 包括"不设口令拒绝启动"（容器退出码 1）。

import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const WebSocket = require('ws')

const argv = process.argv.slice(2)
const dockerIdx = argv.indexOf('--docker')
const DOCKER_IMAGE = dockerIdx >= 0 ? argv[dockerIdx + 1] : null
if (dockerIdx >= 0 && !DOCKER_IMAGE) {
  console.error('usage: node scripts/server-security.mjs [--docker <image>]')
  process.exit(2)
}

const PORT = 18090 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'correct-horse-9'

let passed = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const post = (path, { body, headers = {}, cookie } = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body ?? {}),
  })

let dockerSeq = 0
function startServer(env, dataDir) {
  if (DOCKER_IMAGE) {
    // 容器里 /data 固定、端口 8080 固定（映射到本机 PORT）；口令等配置照常走环境变量
    return spawn('docker', [
      'run', '--rm', '-i', '--name', `vixel-sec-${process.pid}-${dockerSeq++}`,
      '-p', `127.0.0.1:${PORT}:8080`,
      '-v', `${dataDir}:/data`,
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      DOCKER_IMAGE,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
  }
  return spawn(process.execPath, [join(root, 'dist/server/index.js')], {
    env: {
      ...process.env,
      VIXEL_DATA_DIR: dataDir,
      VIXEL_PORT: String(PORT),
      VIXEL_HOST: '127.0.0.1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('server did not come up in time')
}

async function wsStatus(headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/events`, { headers })
    ws.on('open', () => { ws.close(); resolve('open') })
    ws.on('error', (e) => resolve(/401/.test(String(e.message)) ? '401' : `error:${e.message}`))
  })
}

async function main() {
  // ─ 不设口令：必须拒绝启动 ─
  {
    const dir = mkdtempSync(join(tmpdir(), 'vixel-sec-noauth-'))
    const child = startServer({}, dir)
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d })
    const code = await new Promise((r) => child.on('exit', r))
    ok('refuses to start without VIXEL_PASSWORD', code === 1 && /VIXEL_PASSWORD/.test(stderr), `exit ${code}`)
    rmSync(dir, { recursive: true, force: true })
  }

  // ─ 正常启动（带口令）─
  const dataDir = mkdtempSync(join(tmpdir(), 'vixel-sec-'))
  const server = startServer({ VIXEL_PASSWORD: PASSWORD }, dataDir)
  server.stdout.on('data', () => {})
  server.stderr.on('data', () => {})
  const die = (await Promise.race([waitForServer().then(() => null), new Promise((r) => server.on('exit', (c) => r(c)))]))
  if (die !== null) throw new Error(`server exited early (code ${die})`)

  try {
    // 未登录
    const r1 = await post('/api/getLibraryCounts', { body: { args: [] }, headers: { 'x-vixel': '1' } })
    ok('unauthenticated /api → 401', r1.status === 401, `got ${r1.status}`)

    const r2 = await fetch(`${BASE}/media/thumb/1`)
    ok('unauthenticated /media → 401', r2.status === 401, `got ${r2.status}`)

    ok('unauthenticated WebSocket → 401', (await wsStatus()) === '401')

    // CSRF：POST 必须带 X-Vixel（连 login 也要）
    const r3 = await post('/api/login', { body: { password: PASSWORD } })
    ok('POST without X-Vixel header → 403', r3.status === 403, `got ${r3.status}`)

    // 错误口令限速：5 次失败后 429
    let lastStatus = 0
    for (let i = 0; i < 6; i++) {
      const r = await post('/api/login', { body: { password: 'wrong-password' }, headers: { 'x-vixel': '1' } })
      lastStatus = r.status
    }
    ok('wrong password is rate-limited (429 after repeated failures)', lastStatus === 429, `got ${lastStatus}`)

    // 限速窗口里连正确口令也拒（先拒后验，不给爆破确认口令的机会）
    const r4 = await post('/api/login', { body: { password: PASSWORD }, headers: { 'x-vixel': '1' } })
    ok('rate limit also blocks correct password while limited', r4.status === 429, `got ${r4.status}`)

    // 换一个"IP"没法做（都是 127.0.0.1）：直接重启服务器清限速，再走正常登录
    server.kill('SIGTERM')
    await new Promise((r) => server.on('exit', r))
    const server2 = startServer({ VIXEL_PASSWORD: PASSWORD }, dataDir)
    server2.stdout.on('data', () => {})
    server2.stderr.on('data', () => {})
    await waitForServer()

    const login = await post('/api/login', { body: { password: PASSWORD }, headers: { 'x-vixel': '1' } })
    ok('correct password → 200 + session cookie', login.status === 200 && /vixel_session=/.test(login.headers.get('set-cookie') ?? ''))
    const cookieHeader = (login.headers.get('set-cookie') ?? '').split(';')[0]
    ok('cookie is HttpOnly + SameSite=Strict', /HttpOnly/i.test(login.headers.get('set-cookie')) && /SameSite=Strict/i.test(login.headers.get('set-cookie')))

    const authed = await post('/api/getLibraryCounts', { body: { args: [] }, headers: { 'x-vixel': '1' }, cookie: cookieHeader })
    ok('authenticated /api call works', authed.status === 200 && (await authed.json()).ok === true, `got ${authed.status}`)

    ok('authenticated WebSocket connects', (await wsStatus({ cookie: cookieHeader })) === 'open')

    // 伪造 cookie
    const forged = await post('/api/getLibraryCounts', { body: { args: [] }, headers: { 'x-vixel': '1' }, cookie: 'vixel_session=v1.99999999999999.AAAA.BBBB' })
    ok('forged session cookie → 401', forged.status === 401, `got ${forged.status}`)

    // 桌面专属
    const desk = await post('/api/selectFolder', { body: { args: [] }, headers: { 'x-vixel': '1' }, cookie: cookieHeader })
    ok('desktop-only method → 501 with explanation', desk.status === 501 && /desktop-only/.test((await desk.json()).error))

    // 媒体路由只收数字 id；路径样式一律 404
    const trav = await fetch(`${BASE}/media/thumb/..%2F..%2Fetc%2Fpasswd`, { headers: { cookie: cookieHeader } })
    ok('media route rejects traversal-looking ids', trav.status === 404, `got ${trav.status}`)
    const trav2 = await fetch(`${BASE}/media/file/%2Fetc%2Fpasswd`, { headers: { cookie: cookieHeader } })
    ok('media route rejects absolute path ids', trav2.status === 404 || trav2.status === 401, `got ${trav2.status}`)

    // 注销
    const out = await post('/api/logout', { body: {}, headers: { 'x-vixel': '1' }, cookie: cookieHeader })
    ok('logout clears the cookie', out.status === 200 && /Max-Age=0/.test(out.headers.get('set-cookie') ?? ''))

    server2.kill('SIGTERM')
    await new Promise((r) => server2.on('exit', r))
  } finally {
    server.kill('SIGTERM')
    rmSync(dataDir, { recursive: true, force: true })
  }

  console.log(`\nserver security: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
