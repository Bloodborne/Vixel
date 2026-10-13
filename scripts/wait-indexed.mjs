#!/usr/bin/env node
// 轮询一个正在跑的 Vixel 服务器，等"索引 + OCR + 人脸全部做完"，输出任务统计。
// docs/server/plan.md 层级 5 用：索引 0 错误才退出码 0。
//
//   node scripts/wait-indexed.mjs --url http://127.0.0.1:8080 --password pw [--timeout-min 90]
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const BASE = (flag('url') ?? '').replace(/\/$/, '')
const PASSWORD = flag('password')
const TIMEOUT_MIN = Number(flag('timeout-min', '120'))
if (!BASE || !PASSWORD) { console.error('usage: wait-indexed.mjs --url <base> --password <pw>'); process.exit(2) }

let cookie = ''
const api = async (method, args2 = []) => {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vixel': '1', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ args: args2 }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} → ${res.status} ${body.error ?? ''}`)
  return body.result
}

async function login() {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-vixel': '1' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`login → ${res.status}`)
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 等服务器起来
  const bootDeadline = Date.now() + 120_000
  for (;;) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) break } catch { /* not yet */ }
    if (Date.now() > bootDeadline) throw new Error('server never became healthy')
    await sleep(1000)
  }
  await login()

  const deadline = Date.now() + TIMEOUT_MIN * 60_000
  let quietRounds = 0
  let last = ''
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out waiting for indexing')
    const [ov, model] = await Promise.all([api('getTaskOverview'), api('getModelStatus')])
    const counts = ov.counts ?? {}
    let pending = 0
    for (const byStatus of Object.values(counts)) {
      pending += (byStatus.pending ?? 0) + (byStatus.processing ?? 0)
    }
    const errors = (ov.errors ?? []).length
    const p = ov.photos ?? {}
    const m = ov.media ?? {}
    const line = JSON.stringify({
      pending, errors,
      photos: `${p.indexed}/${p.total} indexed, ${p.thumbnailed} thumbed`,
      video: `${m.video?.done}/${m.video?.total}`,
      audio: `${m.audio?.done}/${m.audio?.total}`,
      segments: `${m.segmentsDone}/${m.segmentsExpected}`,
      embeddingReady: model?.embeddingReady ?? null,
    })
    if (line !== last) { console.log(new Date().toISOString(), line); last = line }

    const settled = pending === 0 &&
      p.total > 0 && p.indexed >= p.total && p.thumbnailed >= p.total &&
      (m.video?.done ?? 0) >= (m.video?.total ?? 0) &&
      (m.segmentsDone ?? 0) >= (m.segmentsExpected ?? 0)
    // OCR / 人脸不走任务表的部分：连续几轮完全静止才算完
    quietRounds = settled ? quietRounds + 1 : 0
    if (quietRounds >= 6) { // ~60s 静止
      console.log('--- settled ---')
      console.log('task counts:', JSON.stringify(counts))
      console.log('errors:', JSON.stringify(ov.errors ?? []))
      process.exit(errors === 0 ? 0 : 1)
    }
    await sleep(10_000)
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(2) })
