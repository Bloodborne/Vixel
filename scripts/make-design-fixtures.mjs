/**
 * 生成设计格式的测试素材到 tests/fixtures/design/（提交进仓库，不放演示库）。
 *
 *   node scripts/make-design-fixtures.mjs
 *
 * 不依赖任何第三方包：PSD 按规范手写（raw + RLE 两种压缩），PDF 手写最小结构，
 * SVG 是文本。生成后用 scripts 下的单测与（macOS 上）sips 双重验证。
 */
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'design')
mkdirSync(outDir, { recursive: true })

// ─── SVG ─────────────────────────────────────────────────────────────────

// 色块海报：红 / 蓝 / 黄三栏（palette 测试也能用）
writeFileSync(join(outDir, 'poster.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">
  <rect width="160" height="320" fill="#d92b2b"/>
  <rect x="160" width="160" height="320" fill="#1e66d0"/>
  <rect x="320" width="160" height="320" fill="#f2c200"/>
  <circle cx="240" cy="160" r="60" fill="#ffffff"/>
</svg>
`)

// 带外部引用的 SVG：librsvg 从 buffer 加载时不解析外部 http / 本地文件引用，
// 渲染必须瞬间完成且不发请求（decode 用它验证离线承诺）
writeFileSync(join(outDir, 'external-ref.svg'), `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200">
  <image href="http://127.0.0.1:1/never-fetched.png" width="200" height="100"/>
  <image xlink:href="file:///etc/hostname" y="100" width="200" height="50"/>
  <rect y="150" width="200" height="50" fill="#00a860"/>
</svg>
`)

// ─── PSD ─────────────────────────────────────────────────────────────────

const be16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }

function psdHeader({ channels, height, width, depth = 8, mode = 3 }) {
  return Buffer.concat([
    Buffer.from('8BPS', 'latin1'), be16(1), Buffer.alloc(6),
    be16(channels), be32(height), be32(width), be16(depth), be16(mode),
  ])
}

/** 画一张 64×48 的合成图：上半横向三色条（红绿蓝），下半灰渐变 */
const W = 64, H = 48
function compositePlanes() {
  const r = Buffer.alloc(W * H), g = Buffer.alloc(W * H), b = Buffer.alloc(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (y < H / 2) {
        if (x < W / 3) r[i] = 230
        else if (x < (2 * W) / 3) g[i] = 200
        else b[i] = 240
      } else {
        const v = Math.round((x / (W - 1)) * 255)
        r[i] = v; g[i] = v; b[i] = v
      }
    }
  }
  return [r, g, b]
}

// raw（compression 0）RGB PSD
{
  const planes = compositePlanes()
  const psd = Buffer.concat([
    psdHeader({ channels: 3, height: H, width: W }),
    be32(0),            // color mode data
    be32(0),            // image resources
    be32(0),            // layer & mask（无图层：仅合成图）
    be16(0),            // compression raw
    ...planes,
  ])
  writeFileSync(join(outDir, 'merged-raw.psd'), psd)
}

/** PackBits 压一行 */
function packBits(row) {
  const out = []
  let i = 0
  while (i < row.length) {
    // 找重复 run
    let run = 1
    while (i + run < row.length && row[i + run] === row[i] && run < 128) run++
    if (run >= 2) {
      out.push(Buffer.from([257 - run, row[i]])) // 1-run 的补码
      i += run
    } else {
      // literal run：直到出现 ≥3 重复或 128 个
      let j = i + 1
      while (j < row.length && out.length < 1e6) {
        let r = 1
        while (j + r < row.length && row[j + r] === row[j] && r < 128) r++
        if (r >= 3 || j - i >= 128) break
        j += r
      }
      const lit = row.subarray(i, Math.min(j, i + 128))
      out.push(Buffer.from([lit.length - 1]), lit)
      i += lit.length
    }
  }
  return Buffer.concat(out)
}

// RLE（compression 1）RGB PSD —— 同一张图
{
  const planes = compositePlanes()
  const counts = []
  const data = []
  for (const plane of planes) {
    for (let y = 0; y < H; y++) {
      const packed = packBits(plane.subarray(y * W, (y + 1) * W))
      counts.push(be16(packed.length))
      data.push(packed)
    }
  }
  const psd = Buffer.concat([
    psdHeader({ channels: 3, height: H, width: W }),
    be32(0), be32(0), be32(0),
    be16(1),
    ...counts, ...data,
  ])
  writeFileSync(join(outDir, 'merged-rle.psd'), psd)
}

// 灰度 PSD（1 通道，raw）
{
  const g = Buffer.alloc(W * H)
  for (let i = 0; i < g.length; i++) g[i] = (i * 7) % 256
  const psd = Buffer.concat([
    psdHeader({ channels: 1, height: H, width: W, mode: 1 }),
    be32(0), be32(0), be32(0), be16(0), g,
  ])
  writeFileSync(join(outDir, 'gray.psd'), psd)
}

// 大一点、更像真实海报的 PSD（raw RGB 320×200，粉色花 + 绿叶色块；capture 用）
{
  const PW = 320, PH = 200
  const r = Buffer.alloc(PW * PH), g = Buffer.alloc(PW * PH), b = Buffer.alloc(PW * PH)
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const i = y * PW + x
      const dx = x - 160, dy = y - 100
      if (dx * dx + dy * dy < 60 * 60) { r[i] = 240; g[i] = 150; b[i] = 185 } // 粉色圆
      else if (y > 150) { r[i] = 60; g[i] = 150; b[i] = 80 }                   // 绿底
      else { r[i] = 245; g[i] = 242; b[i] = 236 }                              // 米白
    }
  }
  const psd = Buffer.concat([
    psdHeader({ channels: 3, height: PH, width: PW }),
    be32(0), be32(0), be32(0), be16(0), r, g, b,
  ])
  writeFileSync(join(outDir, 'poster.psd'), psd)
}

// ─── PDF（手写最小结构，3 页，sips 可渲染） ───────────────────────────────

function makePdf(pages) {
  // pages: [{w,h,content}]
  const objs = []
  const kidsIds = pages.map((_, i) => 3 + i * 2)
  objs.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kidsIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`)
  pages.forEach((p, i) => {
    const id = 3 + i * 2
    objs.push(`${id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Contents ${id + 1} 0 R /Resources << >> >>\nendobj\n`)
    objs.push(`${id + 1} 0 obj\n<< /Length ${p.content.length} >>\nstream\n${p.content}\nendstream\nendobj\n`)
  })
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const o of objs) { offsets.push(pdf.length); pdf += o }
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objs.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const pdf3 = makePdf([
  { w: 400, h: 300, content: '0.85 0.17 0.17 rg 40 40 320 220 re f' },
  { w: 400, h: 300, content: '0.12 0.40 0.82 rg 40 40 320 220 re f' },
  { w: 400, h: 300, content: '0.95 0.76 0.00 rg 40 40 320 220 re f' },
])
writeFileSync(join(outDir, 'brochure.pdf'), pdf3)

// PDF 兼容的 .ai = 同样的 PDF 字节换扩展名（Illustrator "Create PDF Compatible File" 的本质）
writeFileSync(join(outDir, 'artwork.ai'), makePdf([
  { w: 300, h: 300, content: '0.55 0.31 0.78 rg 30 30 240 240 re f' },
]))

console.log(`fixtures written to ${outDir}`)
