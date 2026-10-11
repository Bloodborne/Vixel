// 标定脚本：编码词表 prompt，和三个库的图片 / 片段向量比余弦，输出分布。ELECTRON_RUN_AS_NODE=1 npx electron scripts/autotag-calibrate.cjs
const { join } = require('path')
const { writeFileSync, existsSync, readFileSync } = require('fs')
const root = join(__dirname, '..')
const { initEmbeddingServicePath, getEmbeddingService } = require(join(root, 'dist/cli/core/embedding'))
const { VOCABULARY } = require(join(root, 'dist/cli/core/autotag/vocabulary'))
const { initDatabase } = require(join(root, 'dist/cli/core/db'))

const CACHE = '/tmp/at/labels.json'
const PREFIX_MODE = process.env.AT_PREFIX || 'query' // query = 搜索框同款前缀

function norm(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s); return v.map((x) => x / s) }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

async function labelVectors() {
  if (existsSync(CACHE) && !process.env.AT_REENCODE) return JSON.parse(readFileSync(CACHE, 'utf8'))
  initEmbeddingServicePath('/tmp/at/userdata', join(root, 'resources/models'), join(root, 'resources/litert/darwin-arm64'))
  const svc = getEmbeddingService()
  await svc.init()
  const out = {}
  for (const l of VOCABULARY) {
    const vs = []
    for (const p of l.prompts) vs.push(Array.from(await svc.encodeText(PREFIX_MODE === 'query' ? p : `task: search result | query: ${p}`)))
    const avg = vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length)
    out[l.id] = norm(avg)
  }
  writeFileSync(CACHE, JSON.stringify(out))
  return out
}

function loadVecs(dbPath) {
  const inst = initDatabase(dbPath, { readonly: true })
  const db = inst.raw
  const rows = db.prepare(`
    SELECT m.file_hash h, v.embedding e,
      (SELECT COALESCE(vd.file_name, p.file_name) FROM photos p LEFT JOIN videos vd ON vd.id = p.video_id WHERE p.file_hash = m.file_hash AND p.deleted_at IS NULL LIMIT 1) name
    FROM image_vec_map m JOIN image_vecs v ON v.rowid = m.rowid`).all()
  const out = rows.filter((r) => r.name).map((r) => {
    const b = Buffer.from(r.e); return { hash: r.h, name: r.name, v: new Float32Array(b.buffer, b.byteOffset, b.length / 4) }
  })
  db.close()
  return out
}

;(async () => {
  const L = await labelVectors()
  const ids = Object.keys(L)
  const libs = { demo: loadVecs('/tmp/at/demo.db'), footage: loadVecs('/tmp/at/footage.db'), real: loadVecs('/tmp/at/real.db') }
  const all = [...libs.demo, ...libs.footage, ...libs.real]
  // 每个标签在全部图片上的分布 → 均值 / 标准差
  const stats = {}
  for (const id of ids) {
    const s = all.map((x) => dot(x.v, L[id]))
    const mean = s.reduce((a, b) => a + b, 0) / s.length
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length)
    stats[id] = { mean, sd }
  }
  const dump = { stats, items: {} }
  for (const [lib, items] of Object.entries(libs)) {
    for (const it of items) {
      const scored = ids.map((id) => { const c = dot(it.v, L[id]); return { id, c, z: (c - stats[id].mean) / stats[id].sd } })
      dump.items[`${lib}:${it.name}`] = scored.sort((a, b) => b.c - a.c).slice(0, 8)
    }
  }
  writeFileSync('/tmp/at/dump.json', JSON.stringify(dump))
  const raw = all.flatMap((x) => ids.map((id) => dot(x.v, L[id])))
  raw.sort((a, b) => a - b)
  const q = (p) => raw[Math.floor(p * (raw.length - 1))].toFixed(3)
  console.log(`items ${all.length} labels ${ids.length}  cos p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${q(1)}`)
})()
