// 以图搜图标定：外部查询图（裁切 / 另截的视频帧）对库里图片向量和片段向量的余弦 / z 分布。
// 用法（先 npm run build:cli；模型推理较慢，整套约 2-4 分钟）：
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/image-search-eval.cjs gen     # 生成查询图到 /tmp/vx-is-q
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/image-search-eval.cjs eval    # 单图通道标定
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/image-search-eval.cjs mixed   # 图+文：多模态 vs 两路融合
// 库：/tmp/vx-is（演示库 34 图 + 3 段）、/tmp/vx-is-footage（22 条素材、32 段）
const { join, basename } = require('path')
const { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } = require('fs')
const { execFileSync } = require('child_process')
const root = join(__dirname, '..')
const sharp = require(join(root, 'node_modules/sharp'))
const { initDatabase } = require(join(root, 'dist/cli/core/db'))
const { decodeImage } = require(join(root, 'dist/cli/core/image/decode'))
const { initEmbeddingServicePath, getEmbeddingService } = require(join(root, 'dist/cli/core/embedding'))

const QDIR = '/tmp/vx-is-q'
const LIBS = { demo: '/tmp/vx-is/library.db', footage: '/tmp/vx-is-footage/library.db' }
const DEMO_LIB = join(process.env.HOME, 'workspace/dancer/vixel-demo/library')
const FOOTAGE = join(process.env.HOME, 'workspace/dancer/vixel-demo/footage')

// 演示库裁切目标（跨文件夹，含 heic / webp / RAW）
const DEMO_CROPS = [
  '自然/cyclamen_persicum.jpg', '自然/el_torcal_rocks.jpg', '自然/prairie_falcon.jpg', '自然/tanners_ridge.jpg',
  '自然/wood_anemones.jpg', '人像/portrait.jpg', '人像/mongolels.jpg', '文字/japanese-shop.jpg',
  '文字/craft-beer.jpg', '其他格式/denali.webp', '其他格式/IMG_2682.heic', '相机RAW/glarus.nef',
]
// 素材库另截帧的目标（时间点取 37% 时长，避开索引用的均匀抽帧网格）
const FOOTAGE_FRAMES = [
  'rocket-falcon9.mp4', 'cat-curious.mp4', 'fireworks-kamakura.mp4', 'beach-sunset-timelapse.mp4',
  'horse-grazing.mp4', 'seagull-chicks.mp4', 'train-zagreb.mp4', 'waterfall-delaneys.mp4',
  'snow-falling.mp4', 'cooking-alioli.mp4', 'dogs-hurdles-1899.mp4', 'earth-night-lights.mp4',
]
// 负例（查询 × 另一个库，主题不重合的组合；重合的（雪、瀑布、火车、鸟）单独看）
const NEGATIVE_PAIRS = [
  ['crop-cyclamen_persicum.jpg', 'footage'], ['crop-portrait.jpg', 'footage'], ['crop-japanese-shop.jpg', 'footage'],
  ['crop-craft-beer.jpg', 'footage'], ['crop-IMG_2682.jpg', 'footage'], ['crop-glarus.jpg', 'footage'],
  ['frame-rocket-falcon9.jpg', 'demo'], ['frame-cat-curious.jpg', 'demo'], ['frame-fireworks-kamakura.jpg', 'demo'],
  ['frame-horse-grazing.jpg', 'demo'], ['frame-cooking-alioli.jpg', 'demo'], ['frame-earth-night-lights.jpg', 'demo'],
]

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
function stats(sims) {
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length
  const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length) || 1e-6
  return { mean, sd }
}
const toF32 = (buf) => { const b = Buffer.from(buf); return new Float32Array(b.buffer, b.byteOffset, b.length / 4) }

function loadLib(dbPath) {
  const inst = initDatabase(dbPath, { readonly: true })
  const images = inst.raw.prepare(`
    SELECT m.file_hash h, v.embedding e,
      (SELECT COALESCE(vd.file_name, p.file_name) FROM photos p LEFT JOIN videos vd ON vd.id = p.video_id
       WHERE p.file_hash = m.file_hash AND p.deleted_at IS NULL LIMIT 1) name
    FROM image_vec_map m JOIN image_vecs v ON v.rowid = m.rowid`).all()
    .filter((r) => r.name).map((r) => ({ name: r.name, v: toF32(r.e) }))
  const segments = inst.raw.prepare(`
    SELECT s.video_id vid, s.start_ms s0, s.end_ms s1, vd.file_name name, v.embedding e
    FROM video_segment_vec_map m JOIN video_segment_vecs v ON v.rowid = m.rowid
    JOIN video_segments s ON s.id = m.segment_id JOIN videos vd ON vd.id = s.video_id`).all()
    .map((r) => ({ name: r.name, start: r.s0, v: toF32(r.e) }))
  const videos = inst.raw.prepare(`SELECT file_name n, duration_ms d FROM videos WHERE deleted_at IS NULL`).all()
  inst.close()
  return { images, segments, videos }
}

async function gen() {
  mkdirSync(QDIR, { recursive: true })
  for (const rel of DEMO_CROPS) {
    const src = join(DEMO_LIB, rel)
    const { buffer } = await decodeImage(src)
    const img = sharp(buffer)
    const { width: w, height: h } = await img.metadata()
    // 中间 70% 裁切 + 缩到 640 + q60：模拟"保存过一次的局部截图"
    const out = join(QDIR, `crop-${basename(rel).replace(/\.\w+$/, '')}.jpg`)
    await img.extract({ left: Math.round(w * 0.15), top: Math.round(h * 0.15), width: Math.round(w * 0.7), height: Math.round(h * 0.7) })
      .resize(640, 640, { fit: 'inside' }).jpeg({ quality: 60 }).toFile(out)
    console.log('crop', out)
  }
  const ffmpeg = require(join(root, 'node_modules/ffmpeg-static'))
  const { videos } = loadLib(LIBS.footage)
  for (const name of FOOTAGE_FRAMES) {
    const v = videos.find((x) => x.n === name)
    const t = ((v?.d ?? 20000) * 0.37) / 1000
    const out = join(QDIR, `frame-${name.replace(/\.\w+$/, '')}.jpg`)
    execFileSync(ffmpeg, ['-y', '-ss', t.toFixed(2), '-i', join(FOOTAGE, name), '-frames:v', '1', '-q:v', '4', out], { stdio: 'ignore' })
    console.log('frame', out, `@${t.toFixed(1)}s`)
  }
  // 小裁切（画面一角 40%）给图+文评估：单独更难认，文字提示才有用武之地
  for (const name of FOOTAGE_FRAMES) {
    const src = join(QDIR, `frame-${name.replace(/\.\w+$/, '')}.jpg`)
    const img = sharp(src)
    const { width: w, height: h } = await img.metadata()
    const out = join(QDIR, `mini-${name.replace(/\.\w+$/, '')}.jpg`)
    await img.extract({ left: Math.round(w * 0.3), top: Math.round(h * 0.3), width: Math.round(w * 0.4), height: Math.round(h * 0.4) })
      .resize(480, 480, { fit: 'inside' }).jpeg({ quality: 70 }).toFile(out)
  }
}

let svc
async function encodeFile(path, text) {
  if (!svc) {
    initEmbeddingServicePath('/tmp/vx-is-userdata', join(root, 'resources/models'), join(root, 'resources/litert/darwin-arm64'))
    svc = getEmbeddingService()
    await svc.init()
  }
  const { buffer } = await decodeImage(path)
  if (text) return svc.encode({ type: 'multimodal', text, image: buffer })
  return svc.encodeImage(buffer)
}

/** 查询对一个库的两通道明细：各通道按 z 排序的 top 行 */
function scoreAgainst(q, lib) {
  // 基线与运行时同款：某通道样本 < 20 时并入另一通道（同一嵌入空间）
  const imgSample = lib.images.map((x) => x.v)
  const segSample = lib.segments.map((x) => x.v)
  const merged = [...imgSample, ...segSample]
  const imgStats = stats((imgSample.length >= 20 ? imgSample : merged).map((v) => dot(v, q)))
  const segStats = stats((segSample.length >= 20 ? segSample : merged).map((v) => dot(v, q)))
  const img = lib.images.map((x) => ({ name: x.name, cos: dot(x.v, q) }))
    .map((x) => ({ ...x, z: (x.cos - imgStats.mean) / imgStats.sd })).sort((a, b) => b.z - a.z)
  const seg = lib.segments.map((x) => ({ name: x.name, start: x.start, cos: dot(x.v, q) }))
    .map((x) => ({ ...x, z: (x.cos - segStats.mean) / segStats.sd })).sort((a, b) => b.z - a.z)
  return { img, seg }
}

const fmt = (x) => x ? `${x.name}${x.start != null ? '@' + (x.start / 1000) + 's' : ''} cos ${x.cos.toFixed(3)} z ${x.z.toFixed(2)}` : '—'
const targetOf = (qname) => qname.replace(/^(crop|frame|mini)-/, '').replace(/\.jpg$/, '')

async function evalSingles() {
  const libs = { demo: loadLib(LIBS.demo), footage: loadLib(LIBS.footage) }
  const rows = []
  const queries = readdirSync(QDIR).filter((f) => /^(crop|frame)-/.test(f))
  for (const qf of queries) {
    const q = await encodeFile(join(QDIR, qf))
    const home = qf.startsWith('crop-') ? 'demo' : 'footage'
    const { img, seg } = scoreAgainst(q, libs[home])
    const tgt = targetOf(qf)
    const isT = (x) => x.name.startsWith(tgt)
    rows.push({ q: qf, lib: home, kind: 'pos', tImg: img.find(isT), tSeg: seg.find(isT), bImg: img.find((x) => !isT(x)), bSeg: seg.find((x) => !isT(x)) })
    console.log(`[pos] ${qf} → ${home}`)
    console.log(`   目标 img: ${fmt(img.find(isT))} | seg: ${fmt(seg.find(isT))}`)
    console.log(`   他图 img: ${fmt(img.find((x) => !isT(x)))} | seg: ${fmt(seg.find((x) => !isT(x)))}`)
  }
  for (const [qf, libName] of NEGATIVE_PAIRS) {
    if (!existsSync(join(QDIR, qf))) continue
    const q = await encodeFile(join(QDIR, qf))
    const { img, seg } = scoreAgainst(q, libs[libName])
    rows.push({ q: qf, lib: libName, kind: 'neg', bImg: img[0], bSeg: seg[0] })
    console.log(`[neg] ${qf} → ${libName}: img ${fmt(img[0])} | seg ${fmt(seg[0])}`)
  }
  writeFileSync('/tmp/vx-is-q/eval.json', JSON.stringify(rows, null, 1))
  // 汇总
  const pos = rows.filter((r) => r.kind === 'pos')
  const neg = rows.filter((r) => r.kind === 'neg')
  const best = (r) => [r.tImg, r.tSeg].filter(Boolean).sort((a, b) => b.z - a.z)[0]
  console.log('\n== 正例目标（img / seg 取更高的那路）==')
  for (const r of pos) { const b = best(r); console.log(`  ${r.q.padEnd(36)} ${b ? `cos ${b.cos.toFixed(3)} z ${b.z.toFixed(2)}` : 'TARGET MISSING'}`) }
  console.log('== 负例最高 ==')
  for (const r of neg) { const b = [r.bImg, r.bSeg].filter(Boolean).sort((a, b2) => b2.z - a.z)[0]; console.log(`  ${r.q.padEnd(36)} ${fmt(b)}`) }
}

// 图+文：小裁切 + 一句话提示。A = 一次多模态编码；B = 图、文各编一次，各自 z 后取 max 融合
const MIXED = [
  ['mini-rocket-falcon9.jpg', '火箭发射'], ['mini-cat-curious.jpg', '猫'], ['mini-fireworks-kamakura.jpg', '烟花'],
  ['mini-beach-sunset-timelapse.jpg', '海边日落'], ['mini-horse-grazing.jpg', '马在吃草'], ['mini-seagull-chicks.jpg', '海鸥喂小鸟'],
  ['mini-train-zagreb.jpg', '火车进站'], ['mini-waterfall-delaneys.jpg', '瀑布'], ['mini-snow-falling.jpg', '下雪'],
  ['mini-cooking-alioli.jpg', '做饭'], ['mini-dogs-hurdles-1899.jpg', '狗跨栏'], ['mini-earth-night-lights.jpg', '夜晚的地球'],
]
async function evalMixed() {
  const lib = loadLib(LIBS.footage)
  let winA = 0, winB = 0
  for (const [qf, text] of MIXED) {
    const tgt = targetOf(qf)
    const isT = (x) => x.name.startsWith(tgt)
    // A: multimodal 单向量
    const qa = await encodeFile(join(QDIR, qf), text)
    const A = scoreAgainst(qa, lib)
    // B: 两路各自 z，按名字取 max 合并
    const qi = await encodeFile(join(QDIR, qf))
    const qt = await svc.encodeText(text)
    const Bi = scoreAgainst(qi, lib), Bt = scoreAgainst(qt, lib)
    const bySeg = new Map()
    for (const s of [...Bi.seg, ...Bt.seg]) { const c = bySeg.get(s.name); if (!c || s.z > c.z) bySeg.set(s.name, s) }
    const B = [...bySeg.values()].sort((a, b) => b.z - a.z)
    const rankA = A.seg.findIndex(isT), rankB = B.findIndex(isT)
    const marginA = A.seg[0] && isT(A.seg[0]) ? A.seg[0].z - (A.seg.find((x) => !isT(x))?.z ?? 0) : -1
    const marginB = B[0] && isT(B[0]) ? B[0].z - (B.find((x) => !isT(x))?.z ?? 0) : -1
    if (marginA >= marginB) winA++; else winB++
    console.log(`${qf.padEnd(34)} "${text}"`)
    console.log(`  A multimodal: rank ${rankA} ${fmt(A.seg.find(isT))} | top ${fmt(A.seg[0])} margin ${marginA.toFixed(2)}`)
    console.log(`  B fuse z-max: rank ${rankB} ${fmt(B.find(isT))} | top ${fmt(B[0])} margin ${marginB.toFixed(2)}`)
  }
  console.log(`\nA(multimodal) wins ${winA} / B(fusion) wins ${winB}（按目标置顶后的 z 余量比较）`)
}

const mode = process.argv[2] || 'eval'
;(mode === 'gen' ? gen() : mode === 'mixed' ? evalMixed() : evalSingles())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
