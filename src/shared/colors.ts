/**
 * 颜色筛选的色桶（hue bucket）规则 —— 纯逻辑，无依赖，db / 渲染端 / 测试共用。
 *
 * 像素在 CIELAB（D65）里按 LCh 分桶。12 个桶：
 *   red orange yellow green cyan blue purple pink brown black white mono
 *
 * 阈值（标定记录见 docs 与 palette.test.ts；在演示库 + 素材库拷贝上校过：
 * 蓝色能找到天空 / 海面，粉色能找到粉色花朵）：
 *
 *   中性（无彩色）：C < 12。其中 L > 85 → white，其余 → black（黑 / 灰一个桶）。
 *   有彩色按 LCh 色相角（度）分：
 *     pink    h ∈ [320°, 55°) 且 L ≥ 62 —— 浅红 / 浅品红（粉）优先于 red / purple
 *     brown   h ∈ [45°, 90°) 且 L < 52 —— 深而偏黄的"橙"是棕
 *     red     h ∈ [340°, 45°)
 *     orange  h ∈ [45°, 85°)
 *     yellow  h ∈ [85°, 115°)
 *     green   h ∈ [115°, 180°)
 *     cyan    h ∈ [180°, 240°)
 *     blue    h ∈ [240°, 312°)   （sRGB 纯蓝 h≈306，天空蓝 h≈250–290）
 *     purple  h ∈ [312°, 340°)
 *   mono：整张图 ≥ 88% 的像素都是中性色（黑白 / 单色片）。
 *
 * 一个桶被打上旗标：该桶像素占比 ≥ MIN_BUCKET_SHARE（12%）。
 * pink 和 red 这类"亮度细分"桶占比常更低，但 12% 在两套标定库上都能既召回
 * 粉色花朵又不把每张带点红的图都标成粉。
 */

export const COLOR_BUCKETS = [
  'red', 'orange', 'yellow', 'green', 'cyan', 'blue',
  'purple', 'pink', 'brown', 'black', 'white', 'mono',
] as const

export type ColorBucket = (typeof COLOR_BUCKETS)[number]

/** 桶 → 位（bucket_mask 用）；顺序即 COLOR_BUCKETS */
export function maskForColor(bucket: string): number {
  const i = (COLOR_BUCKETS as readonly string[]).indexOf(bucket)
  return i < 0 ? 0 : 1 << i
}

export function isColorBucket(x: unknown): x is ColorBucket {
  return typeof x === 'string' && (COLOR_BUCKETS as readonly string[]).includes(x)
}

/** 分桶旗标的最小像素占比 */
export const MIN_BUCKET_SHARE = 0.12
/** 中性（无彩色）判定的 chroma 上限 */
export const NEUTRAL_MAX_CHROMA = 12
/** mono 判定：中性像素占比下限 */
export const MONO_MIN_NEUTRAL_SHARE = 0.88

// ─── sRGB → Lab（D65） ───────────────────────────────────────────

function srgbToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

const fLab = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)

export interface Lab { L: number; a: number; b: number }

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)
  // sRGB D65
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883
  const fx = fLab(x)
  const fy = fLab(y)
  const fz = fLab(z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** LCh 色相角（度，[0, 360)） */
export function labHue(lab: Lab): number {
  const h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  return h < 0 ? h + 360 : h
}

export function labChroma(lab: Lab): number {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b)
}

const inHue = (h: number, from: number, to: number): boolean =>
  from <= to ? h >= from && h < to : h >= from || h < to

/**
 * 单个颜色 → 桶（mono 是整图属性，不在这里）。
 * 顺序即优先级：pink / brown 是亮度细分，先于基础色相判。
 */
export function bucketOfLab(lab: Lab): Exclude<ColorBucket, 'mono'> {
  const C = labChroma(lab)
  if (C < NEUTRAL_MAX_CHROMA) return lab.L > 85 ? 'white' : 'black'
  const h = labHue(lab)
  if (inHue(h, 320, 55) && lab.L >= 62) return 'pink'
  if (inHue(h, 45, 90) && lab.L < 52) return 'brown'
  if (inHue(h, 340, 45)) return 'red'
  if (inHue(h, 45, 85)) return 'orange'
  if (inHue(h, 85, 115)) return 'yellow'
  if (inHue(h, 115, 180)) return 'green'
  if (inHue(h, 180, 240)) return 'cyan'
  if (inHue(h, 240, 312)) return 'blue'
  return 'purple' // [312, 340) 以及未被 pink 收走的高亮品红
}

export function bucketOfRgb(r: number, g: number, b: number): Exclude<ColorBucket, 'mono'> {
  return bucketOfLab(rgbToLab(r, g, b))
}

/** 筛选栏色块的展示颜色（和桶语义对齐，深浅主题下都可辨） */
export const BUCKET_SWATCHES: Record<ColorBucket, string> = {
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#f5c518',
  green: '#46a758',
  cyan: '#00a2c7',
  blue: '#3b82f6',
  purple: '#8e4ec6',
  pink: '#f186b4',
  brown: '#9a6b44',
  black: '#5b5b5b',
  white: '#f5f5f5',
  mono: '', // 渲染端画黑白渐变
}
