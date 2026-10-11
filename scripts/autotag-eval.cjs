// 规则评估：每个库只用自己的统计量（运行时也只有它）。
// ELECTRON_RUN_AS_NODE=1 npx electron scripts/autotag-eval.cjs [demo|footage|real] [Z] [K] [MARGIN]
// 结果写到 /tmp/at/picks-<lib>.json，配合 autotag-sheet.cjs 出接触表人工判断
const { join } = require('path')
const { writeFileSync } = require('fs')
const root = join(__dirname, '..')
const { initDatabase } = require(join(root, 'dist/cli/core/db'))
const { assignLabels, labelBaseline } = require(join(root, 'dist/cli/core/autotag/assign'))
const L = require('/tmp/at/labels.json')
const ids = Object.keys(L)
const [lib = 'demo', Z, K, MARGIN] = process.argv.slice(2)
const opts = {}
if (Z) opts.minZ = Number(Z)
if (K) opts.topK = Number(K)
if (MARGIN) opts.margin = Number(MARGIN)
const inst = initDatabase(`/tmp/at/${lib}.db`, { readonly: true })
const rows = inst.raw.prepare(`
  SELECT m.file_hash h, v.embedding e,
    (SELECT COALESCE(vd.file_name, p.file_name) || COALESCE(' @' || p.frame_time_ms, '') FROM photos p LEFT JOIN videos vd ON vd.id = p.video_id WHERE p.file_hash = m.file_hash AND p.deleted_at IS NULL LIMIT 1) name,
    (SELECT p.file_path FROM photos p WHERE p.file_hash = m.file_hash AND p.deleted_at IS NULL LIMIT 1) path
  FROM image_vec_map m JOIN image_vecs v ON v.rowid = m.rowid`).all().filter((r) => r.name)
const items = rows.map((r) => { const b = Buffer.from(r.e); return { name: r.name, path: r.path, v: new Float32Array(b.buffer, b.byteOffset, b.length / 4) } })
const { VOCABULARY } = require(join(root, 'dist/cli/core/autotag/vocabulary'))
const { ACTIVITY_EXTRA_Z } = require(join(root, 'dist/cli/core/autotag/assign'))
const facet = Object.fromEntries(VOCABULARY.map((l) => [l.id, l.facet]))
const labels = ids.filter((id) => facet[id]).map((id) => ({ id, vector: Float32Array.from(L[id]), extraZ: facet[id] === 'activity' ? ACTIVITY_EXTRA_Z : 0 }))
const baseline = labelBaseline(items.map((x) => x.v), labels)
const picks = []
for (const it of items) {
  const got = assignLabels(it.v, labels, baseline, opts)
  if (got.length) picks.push({ name: it.name, path: it.path, tags: got.map((g) => `${g.labelId}(${g.z.toFixed(1)})`) })
  if (process.env.AT_PRINT) console.log(it.name.slice(0, 40).padEnd(40), got.map((g) => `${g.labelId}(${g.z.toFixed(1)})`).join(' ') || '—')
}
writeFileSync(`/tmp/at/picks-${lib}.json`, JSON.stringify(picks))
const n = picks.reduce((s, p) => s + p.tags.length, 0)
console.log(`${lib}: ${items.length} items, pooled sd ${baseline.sd.toFixed(4)}, ${n} tags on ${picks.length} items (${(n / items.length).toFixed(2)}/item)`)
