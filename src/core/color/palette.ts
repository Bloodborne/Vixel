/**
 * 色板提取：64×64 下采样 → Lab 里 k-means（k=5）出主色，逐像素分桶出 bucket_mask。
 *
 * extractPaletteFromRaw 是纯逻辑（可单测）；computeItemColors 负责 sharp 下采样，
 * 缩略图任务（复用已解码的图）和后台补算（直接读缩略图文件）共用。
 */

import sharp from 'sharp'
import {
  bucketOfLab, labChroma, rgbToLab, maskForColor,
  MIN_BUCKET_SHARE, MONO_MIN_NEUTRAL_SHARE, NEUTRAL_MAX_CHROMA,
  type ColorBucket, type Lab,
} from '../../shared/colors'

/** 存进 item_colors.palette（JSON 数组）的单个色板项 */
export interface PaletteColor {
  /** '#rrggbb' */
  hex: string
  /** 占比 0–1（保留两位小数） */
  p: number
  /** 该颜色落入的桶（点击色板按桶筛选用） */
  bucket: ColorBucket
}

export interface ItemColors {
  palette: PaletteColor[]
  /** COLOR_BUCKETS 的位掩码（含 mono 位） */
  mask: number
}

const SAMPLE_SIDE = 64
const K = 5
const KMEANS_ITERS = 10
/** 色板里占比低于 3% 的颜色丢掉（显示没意义） */
const MIN_PALETTE_SHARE = 0.03

interface Px extends Lab { R: number; G: number; B: number }

/** 交错 RGB(A) 像素 → 色板 + 桶掩码。channels 3 或 4（alpha < 128 的像素跳过）。 */
export function extractPaletteFromRaw(data: Uint8Array, channels: 3 | 4): ItemColors {
  const pixels: Px[] = []
  for (let i = 0; i + channels <= data.length; i += channels) {
    if (channels === 4 && data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    pixels.push({ R: r, G: g, B: b, ...rgbToLab(r, g, b) })
  }
  if (pixels.length === 0) return { palette: [], mask: 0 }

  // ── 桶占比（逐像素，和 k-means 无关 —— 掩码不受聚类摆动影响） ──
  const shares = new Map<ColorBucket, number>()
  let neutral = 0
  for (const p of pixels) {
    const b = bucketOfLab(p)
    shares.set(b, (shares.get(b) ?? 0) + 1)
    if (labChroma(p) < NEUTRAL_MAX_CHROMA) neutral++
  }
  let mask = 0
  for (const [bucket, n] of shares) {
    if (n / pixels.length >= MIN_BUCKET_SHARE) mask |= maskForColor(bucket)
  }
  if (neutral / pixels.length >= MONO_MIN_NEUTRAL_SHARE) mask |= maskForColor('mono')

  // ── k-means（Lab 空间，确定性初始化：按 L 排序取分位点） ──
  const sorted = [...pixels].sort((a, b) => a.L - b.L)
  const centers: Lab[] = []
  for (let i = 0; i < K; i++) {
    const p = sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) / K) * sorted.length))]
    centers.push({ L: p.L, a: p.a, b: p.b })
  }
  const assign = new Int32Array(pixels.length)
  for (let iter = 0; iter < KMEANS_ITERS; iter++) {
    let moved = false
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i]
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < centers.length; c++) {
        const dL = p.L - centers[c].L
        const da = p.a - centers[c].a
        const db = p.b - centers[c].b
        const d = dL * dL + da * da + db * db
        if (d < bestD) { bestD = d; best = c }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true }
    }
    const sum = centers.map(() => ({ L: 0, a: 0, b: 0, n: 0 }))
    for (let i = 0; i < pixels.length; i++) {
      const s = sum[assign[i]]
      s.L += pixels[i].L; s.a += pixels[i].a; s.b += pixels[i].b; s.n++
    }
    for (let c = 0; c < centers.length; c++) {
      if (sum[c].n > 0) centers[c] = { L: sum[c].L / sum[c].n, a: sum[c].a / sum[c].n, b: sum[c].b / sum[c].n }
    }
    if (!moved) break
  }

  // ── 聚类 → 色板项：每簇用"离中心最近的真实像素"当代表色（避免 Lab 均值转回 RGB 出界） ──
  const clusters = centers.map(() => ({ n: 0, best: null as Px | null, bestD: Infinity }))
  for (let i = 0; i < pixels.length; i++) {
    const c = clusters[assign[i]]
    const p = pixels[i]
    const ctr = centers[assign[i]]
    const dL = p.L - ctr.L
    const da = p.a - ctr.a
    const db = p.b - ctr.b
    const d = dL * dL + da * da + db * db
    c.n++
    if (d < c.bestD) { c.bestD = d; c.best = p }
  }
  const palette: PaletteColor[] = clusters
    .filter((c) => c.best && c.n / pixels.length >= MIN_PALETTE_SHARE)
    .map((c) => ({
      hex: hexOf(c.best!),
      p: Math.round((c.n / pixels.length) * 100) / 100,
      bucket: bucketOfLab(c.best!),
    }))
    .sort((a, b) => b.p - a.p)

  return { palette, mask }
}

function hexOf(p: { R: number; G: number; B: number }): string {
  const h = (x: number): string => x.toString(16).padStart(2, '0')
  return `#${h(p.R)}${h(p.G)}${h(p.B)}`
}

/** 任意 sharp 能读的图（解码后的原图 buffer 或缩略图文件路径）→ 色板。 */
export async function computeItemColors(input: Buffer | string): Promise<ItemColors> {
  // ensureAlpha：透明背景（SVG / AI 的栅格预览）必须跳过而不是压成黑色
  const { data } = await sharp(input)
    .resize(SAMPLE_SIDE, SAMPLE_SIDE, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return extractPaletteFromRaw(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 4)
}

/** palette JSON（item_colors.palette）→ 结构化；坏数据返回 [] */
export function parsePaletteJson(json: string | null | undefined): PaletteColor[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is PaletteColor =>
      x && typeof x.hex === 'string' && typeof x.p === 'number' && typeof x.bucket === 'string')
  } catch {
    return []
  }
}
