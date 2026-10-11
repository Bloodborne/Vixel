// 规则评估：每个库只用自己的统计量（运行时也只有它）。node scripts/autotag-eval.cjs [demo|footage|real] [Z] [K] [MARGIN]
const { join } = require('path')
const root = join(__dirname, '..')
const { initDatabase } = require(join(root, 'dist/cli/core/db'))
const L = require('/tmp/at/labels.json')
const ids = Object.keys(L)
const [lib = 'demo', Z = '3.5', K = '3', MARGIN = '0.03'] = process.argv.slice(2)
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const inst = initDatabase(`/tmp/at/${lib}.db`, { readonly: true })
const rows = inst.raw.prepare(`
  SELECT m.file_hash h, v.embedding e,
    (SELECT COALESCE(vd.file_name, p.file_name) || COALESCE(' @' || p.frame_time_ms, '') FROM photos p LEFT JOIN videos vd ON vd.id = p.video_id WHERE p.file_hash = m.file_hash AND p.deleted_at IS NULL LIMIT 1) name
  FROM image_vec_map m JOIN image_vecs v ON v.rowid = m.rowid`).all().filter((r) => r.name)
const items = rows.map((r) => { const b = Buffer.from(r.e); return { name: r.name, v: new Float32Array(b.buffer, b.byteOffset, b.length / 4) } })
const S = items.map((it) => ids.map((id) => dot(it.v, L[id])))
const mean = ids.map((_, j) => S.reduce((a, s) => a + s[j], 0) / S.length)
// 合并标准差：所有标签去均值后的整体 sd（小库里逐标签 sd 太不稳）
let acc = 0; for (const s of S) for (let j = 0; j < ids.length; j++) acc += (s[j] - mean[j]) ** 2
const sd = Math.sqrt(acc / (S.length * ids.length))
let total = 0
const shown = process.env.AT_ALL ? items.length : Math.min(items.length, 60)
for (let i = 0; i < items.length; i++) {
  const s = S[i]
  const ranked = ids.map((id, j) => ({ id, c: s[j], z: (s[j] - mean[j]) / sd })).sort((a, b) => b.c - a.c)
  const top = ranked[0].c
  const pick = ranked.slice(0, Number(K)).filter((x) => x.z >= Number(Z) && x.c >= top - Number(MARGIN))
  total += pick.length
  if (i < shown) console.log(items[i].name.slice(0, 40).padEnd(40), pick.map((x) => `${x.id}(${x.z.toFixed(1)})`).join(' ') || '—')
}
console.log(`\n${lib}: ${items.length} items, pooled sd ${sd.toFixed(4)}, ${total} tags, ${(total / items.length).toFixed(2)}/item`)
