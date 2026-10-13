#!/usr/bin/env node
// L7 离线验证的容器内测试客户端：与被测容器共享网络命名空间跑
// （docker run --network container:<id>），检查登录 / 搜索 / 缩略图 / Range 媒体 /
// 模型就绪，全部走 127.0.0.1 —— 容器所在网络是 internal（无外网）。
//
//   node offline-check.mjs http://127.0.0.1:8080 <password> [expectQuery]
const [BASE_RAW, PASSWORD, QUERY = '瀑布'] = process.argv.slice(2)
const BASE = BASE_RAW.replace(/\/$/, '')
let failed = 0
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

let cookie = ''
const api = async (method, args = []) => {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vixel': '1', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ args }),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, result: body.result, error: body.error }
}

const h = await fetch(`${BASE}/healthz`)
ok('healthz', h.ok)

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-vixel': '1' },
  body: JSON.stringify({ password: PASSWORD }),
})
cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
ok('login', login.status === 200 && cookie.includes('vixel_session'))

// 模型就绪（等待最多 120s —— 离线环境模型加载只靠本地文件）
let ready = false
for (let i = 0; i < 60; i++) {
  const { result } = await api('getModelStatus')
  if (result?.embeddingReady) { ready = true; break }
  if (result?.initError) break
  await new Promise((r) => setTimeout(r, 2000))
}
ok('embedding model ready (loaded from bundled files)', ready)

const counts = await api('getLibraryCounts')
ok('library counts', counts.status === 200 && (counts.result?.all ?? 0) > 0, JSON.stringify(counts))

const search = await api('search', [QUERY, 10])
const results = search.result?.results ?? search.result ?? []
ok(`semantic search "${QUERY}" returns results`, search.status === 200 && results.length > 0,
  JSON.stringify(search).slice(0, 200))

const first = results[0]
if (first) {
  const thumb = await fetch(`${BASE}/media/thumb/${first.photo.id}`, { headers: { cookie } })
  ok('thumbnail of first hit', thumb.ok && (thumb.headers.get('content-type') ?? '').startsWith('image/'))
}

// Range 请求（视频拖动路径）：找一个带 videoId 的结果
const locs = await api('search', ['视频', 10])
const lresults = locs.result?.results ?? locs.result ?? []
const vid = [...results, ...lresults].map((r) => r.photo).find((p) => p?.videoId != null)
if (vid) {
  const r = await fetch(`${BASE}/media/media/${vid.videoId}`, { headers: { cookie, range: 'bytes=0-1023' } })
  ok('media Range request → 206', r.status === 206 && r.headers.get('content-range') != null, `got ${r.status}`)
} else {
  console.log('  (no video found for Range check — skipped)')
}

console.log(failed === 0 ? 'offline-check: ALL OK' : `offline-check: ${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
