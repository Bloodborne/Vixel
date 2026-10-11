// 视频片段向量（画面 + 声音）能不能用同一规则打标签：片段用自己的基线，每个视频合并各片段结果。
// ELECTRON_RUN_AS_NODE=1 npx electron scripts/autotag-eval-seg.cjs [footage|real|demo]
const { join } = require('path')
const root = join(__dirname, '..')
const { initDatabase } = require(join(root, 'dist/cli/core/db'))
const { assignLabels, labelBaseline, mergeAssignments, ACTIVITY_EXTRA_Z } = require(join(root, 'dist/cli/core/autotag/assign'))
const { VOCABULARY } = require(join(root, 'dist/cli/core/autotag/vocabulary'))
const L = require('/tmp/at/labels.json')
const facet = Object.fromEntries(VOCABULARY.map((l) => [l.id, l.facet]))
const labels = Object.keys(L).filter((id) => facet[id]).map((id) => ({ id, vector: Float32Array.from(L[id]), extraZ: facet[id] === 'activity' ? ACTIVITY_EXTRA_Z : 0 }))
const lib = process.argv[2] || 'footage'
const db = initDatabase(`/tmp/at/${lib}.db`, { readonly: true }).raw
const rows = db.prepare(`
  SELECT s.video_id vid, vd.file_name name, s.start_ms st, v.embedding e
  FROM video_segment_vec_map m JOIN video_segment_vecs v ON v.rowid = m.rowid
  JOIN video_segments s ON s.id = m.segment_id JOIN videos vd ON vd.id = s.video_id`).all()
const vec = (e) => { const b = Buffer.from(e); return new Float32Array(b.buffer, b.byteOffset, b.length / 4) }
const segs = rows.map((r) => ({ ...r, v: vec(r.e) }))
const baseline = labelBaseline(segs.map((s) => s.v), labels)
const byVideo = new Map()
for (const s of segs) { const list = byVideo.get(s.name) ?? []; list.push(assignLabels(s.v, labels, baseline)); byVideo.set(s.name, list) }
let n = 0
for (const [name, lists] of byVideo) {
  const got = mergeAssignments(lists)
  n += got.length
  if (lib !== 'real' || process.env.AT_PRINT) console.log(name.slice(0, 34).padEnd(34), got.map((g) => `${g.labelId}(${g.z.toFixed(1)})`).join(' ') || '—')
}
console.log(`${lib}: ${segs.length} segments in ${byVideo.size} videos, sd ${baseline.sd.toFixed(4)}, ${n} tags`)
