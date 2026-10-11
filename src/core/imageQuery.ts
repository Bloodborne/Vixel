/**
 * 以图搜图的纯逻辑：相关性门槛 + 两路（图片向量 / 音视频片段向量）合并。不依赖数据库和模型，方便单测。
 *
 * 为什么不直接用"余弦 ≥ 0.85"（findSimilar 的门槛）：
 *   查询图和图片向量比，是同一种输入，相似图的余弦很高；和视频片段向量比，片段是 8 帧 + 音轨融合成的
 *   一个向量，同一个镜头里截的帧也只有 0.8 左右 —— 两路的绝对余弦不在一个尺度上，一个门槛管不了两路。
 *
 * 做法：每路各自对着整库抽样基线做标准化（z = (余弦 − 均值) / 标准差），两路都用 z 判断"是否明显相关"，
 * 合并后也按 z 排序（z 在两路之间可比）；再加一个绝对余弦下限，挡住"库里全是无关内容时 z 也能偏高"的情况。
 * 阈值见 IMAGE_GATE / MIXED_GATE 处的标定记录。
 */

/** 每路基线：查询向量和库里随机样本的余弦均值 / 标准差 */
export interface ChannelStats {
  mean: number
  sd: number
}

export function channelStats(query: Float32Array, sample: Float32Array[]): ChannelStats | null {
  if (sample.length < 20) return null
  const sims = sample.map((v) => dot(v, query))
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length
  const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length)
  return { mean, sd: sd || 1e-6 }
}

export function dot(a: Float32Array, b: Float32Array): number {
  let d = 0
  for (let i = 0; i < a.length; i++) d += a[i] * b[i]
  return d
}

/**
 * 标定（EmbeddingGemma 2 · LiteRT，2026-10-12；明细见 docs/review/09-image-search.md）
 *   正例 42 个：演示库 20 张图的「中间 70% 裁切 + 缩小 + q60」，素材库 22 段视频里另截的、不在索引帧上的画面
 *   负例 42 个：同一批查询拿去搜另一个库（主题基本不重合）
 *
 *   图片通道  正例目标：z 2.75–5.3，余弦 0.864–0.98
 *             负例最高：z 2.5–3.4 的几个都在余弦 0.73–0.79（雪景配雪景之类真相关的 0.86+）
 *   片段通道  正例目标：z 3.07–4.98，余弦 0.887–0.97（唯一例外：截帧和片段整体差得多的火箭 0.81 z 1.96，
 *             图片通道 0.905 z 3.05 能接住）
 *             负例最高：烟花 → 夜景埃菲尔铁塔 z 3.16 / 0.776；黑白肖像 → 1899 年黑白影片 z 2.77 / 0.732
 *
 *   z 单独不够（小库基线噪声大，负例能到 3.4）；余弦单独也不够（两路尺度不同）。两个都要过（IMAGE_GATE）。
 */
export interface Gate {
  imageMinZ: number
  imageMinCosine: number
  segmentMinZ: number
  segmentMinCosine: number
  /** 某一路样本 < 20（新库、只有几张图）没法估基线时只看余弦，门槛提高到负例全部挡住的位置 */
  imageMinCosineNoBaseline: number
  segmentMinCosineNoBaseline: number
}

export const IMAGE_GATE: Gate = {
  imageMinZ: 2.7,
  imageMinCosine: 0.85,
  segmentMinZ: 2.8,
  segmentMinCosine: 0.82,
  imageMinCosineNoBaseline: 0.88,
  segmentMinCosineNoBaseline: 0.86,
}

/**
 * 图 + 文（一次多模态编码）：向量介于"图"和"文"之间，和库里内容的余弦整体低一截，用纯图的门槛会丢掉一半真命中。
 * 实测（素材帧一角 40% 的小裁切 + 一句提示，12 组）：目标片段 z 2.14–4.07、余弦 0.757–0.892；
 * 非目标最高 z 2.51（"火箭发射"配另一段火箭发射，算相关）、其余 ≤ 2.40。2.5 / 0.75 留下 9/12，挡住全部不相关的。
 */
export const MIXED_GATE: Gate = {
  imageMinZ: 2.5,
  imageMinCosine: 0.75,
  segmentMinZ: 2.5,
  segmentMinCosine: 0.75,
  imageMinCosineNoBaseline: 0.82,
  segmentMinCosineNoBaseline: 0.8,
}

export interface ImageHit { fileHash: string; cosine: number }
export interface SegmentHit { videoId: number; startMs: number; endMs: number; cosine: number }

export interface MergedHit {
  /** 图片命中是自身的 hash；片段命中由调用方换成视频代表帧的 hash */
  key: string
  /** 合并排序用的分数：有基线时是 z，没有时是余弦 */
  score: number
  cosine: number
  channel: 'visual' | 'segment'
  segment?: { startMs: number; endMs: number }
}

function passes(cosine: number, stats: ChannelStats | null, minZ: number, minCos: number, minCosNoBase: number): number | null {
  if (!stats) return cosine >= minCosNoBase ? cosine : null
  const z = (cosine - stats.mean) / stats.sd
  return z >= minZ && cosine >= minCos ? z : null
}

/**
 * 两路各自过门槛后合并：同一视频的片段命中优先（带时间区间，打开就跳到那一段），
 * 它的代表帧在图片通道里的命中丢掉，避免同一视频出现两次。
 * segmentKey 把视频 id 换成代表帧 hash（换不到返回 null，丢弃该命中）。
 */
export function cutAndMerge(
  images: ImageHit[],
  segments: SegmentHit[],
  stats: { image: ChannelStats | null; segment: ChannelStats | null },
  segmentKey: (videoId: number) => string | null,
  gate: Gate = IMAGE_GATE
): MergedHit[] {
  const out: MergedHit[] = []
  const seen = new Set<string>()
  const bestSegment = new Map<number, SegmentHit>()
  for (const s of segments) {
    const cur = bestSegment.get(s.videoId)
    if (!cur || s.cosine > cur.cosine) bestSegment.set(s.videoId, s)
  }
  for (const s of bestSegment.values()) {
    const score = passes(s.cosine, stats.segment, gate.segmentMinZ, gate.segmentMinCosine, gate.segmentMinCosineNoBaseline)
    if (score == null) continue
    const key = segmentKey(s.videoId)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ key, score, cosine: s.cosine, channel: 'segment', segment: { startMs: s.startMs, endMs: s.endMs } })
  }
  for (const h of images) {
    if (seen.has(h.fileHash)) continue
    const score = passes(h.cosine, stats.image, gate.imageMinZ, gate.imageMinCosine, gate.imageMinCosineNoBaseline)
    if (score == null) continue
    seen.add(h.fileHash)
    out.push({ key: h.fileHash, score, cosine: h.cosine, channel: 'visual' })
  }
  return out.sort((a, b) => b.score - a.score)
}
