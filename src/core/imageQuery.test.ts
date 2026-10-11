import { describe, it, expect } from 'vitest'
import { channelStats, cutAndMerge, dot, IMAGE_GATE, MIXED_GATE, type ChannelStats, type ImageHit, type SegmentHit } from './imageQuery'

// 基线：均值 0.5、标准差 0.1 → z = (cos − 0.5) / 0.1
const stats: ChannelStats = { mean: 0.5, sd: 0.1 }
const both = { image: stats, segment: stats }
const img = (fileHash: string, cosine: number): ImageHit => ({ fileHash, cosine })
const seg = (videoId: number, startMs: number, cosine: number): SegmentHit => ({ videoId, startMs, endMs: startMs + 32000, cosine })
const keyOf = (videoId: number): string | null => `v${videoId}`

describe('channelStats', () => {
  it('样本不足 20 条时返回 null（调用方退化为纯余弦门槛）', () => {
    const v = new Float32Array([1, 0])
    expect(channelStats(v, Array.from({ length: 19 }, () => v))).toBeNull()
  })

  it('均值 / 标准差按余弦分布计算', () => {
    const q = new Float32Array([1, 0])
    // 一半余弦 0.6、一半 0.8 → 均值 0.7、sd 0.1
    const sample = [
      ...Array.from({ length: 10 }, () => new Float32Array([0.6, 0.8])),
      ...Array.from({ length: 10 }, () => new Float32Array([0.8, 0.6])),
    ]
    const s = channelStats(q, sample)!
    expect(s.mean).toBeCloseTo(0.7, 5)
    expect(s.sd).toBeCloseTo(0.1, 5)
    expect(dot(q, sample[0])).toBeCloseTo(0.6, 5)
  })
})

describe('cutAndMerge · 门槛', () => {
  it('z 和余弦都要过：余弦够但 z 不够、z 够但余弦不够的都挡掉', () => {
    const hits = [
      img('pass', 0.9), // z 4.0 cos 0.9 → 过
      img('lowz', 0.86), // z 3.6？不——用更紧的基线单测 z
    ]
    // 高基线（均值 0.8）：cos 0.86 → z 0.6 不过；cos 0.9 → z 1.0 也不过
    const tight = { image: { mean: 0.8, sd: 0.1 }, segment: stats }
    expect(cutAndMerge(hits, [], tight, keyOf)).toEqual([])
    // 标定基线：标定里负例最高 z 3.27 但余弦只有 0.744 —— 余弦下限必须把它挡掉
    const neg = cutAndMerge([img('neg', 0.744)], [], { image: { mean: 0.417, sd: 0.1 }, segment: stats }, keyOf)
    expect(neg).toEqual([]) // z = 3.27 ≥ 2.7 但 cos < 0.85
  })

  it('正例（标定最弱：z 2.96 / cos 0.898）通过 IMAGE_GATE', () => {
    const out = cutAndMerge([img('a', 0.898)], [], { image: { mean: 0.602, sd: 0.1 }, segment: stats }, keyOf)
    expect(out.map((h) => h.key)).toEqual(['a'])
    expect(out[0].channel).toBe('visual')
    expect(out[0].cosine).toBeCloseTo(0.898)
  })

  it('相关但非同源的内容（另一场火箭发射 0.899 / z 2.03）通过 —— 这是"以此图搜索"替代旧查找相似的前提', () => {
    const out = cutAndMerge([img('related', 0.899)], [], { image: { mean: 0.696, sd: 0.1 }, segment: stats }, keyOf)
    expect(out.map((h) => h.key)).toEqual(['related'])
  })

  it('没有基线（小库）只看余弦，门槛更高', () => {
    const none = { image: null, segment: null }
    const out = cutAndMerge([img('hi', 0.9), img('mid', 0.86)], [], none, keyOf)
    expect(out.map((h) => h.key)).toEqual(['hi']) // 0.86 < imageMinCosineNoBaseline 0.88
  })

  it('MIXED_GATE 按图+文的标定放宽（目标最低 z 2.61 / cos 0.809）', () => {
    const s = { image: stats, segment: { mean: 0.548, sd: 0.1 } }
    const out = cutAndMerge([], [seg(1, 0, 0.809)], s, keyOf, MIXED_GATE)
    expect(out).toHaveLength(1)
    // 同样的命中过不了纯图门槛（segmentMinCosine 0.82）
    expect(cutAndMerge([], [seg(1, 0, 0.809)], s, keyOf, IMAGE_GATE)).toEqual([])
  })
})

describe('cutAndMerge · 合并', () => {
  it('同一视频多个片段只留最佳，并带时间区间', () => {
    const out = cutAndMerge([], [seg(1, 0, 0.85), seg(1, 64000, 0.92), seg(1, 32000, 0.88)], both, keyOf)
    expect(out).toHaveLength(1)
    expect(out[0].segment).toEqual({ startMs: 64000, endMs: 96000 })
    expect(out[0].channel).toBe('segment')
  })

  it('片段命中的代表帧在图片通道里重复出现时丢弃（同一视频不出现两次）', () => {
    const out = cutAndMerge([img('v1', 0.95), img('other', 0.93)], [seg(1, 0, 0.9)], both, keyOf)
    expect(out.map((h) => h.key).sort()).toEqual(['other', 'v1'])
    expect(out.find((h) => h.key === 'v1')?.channel).toBe('segment')
  })

  it('两路按 z 混合排序（z 跨通道可比）', () => {
    const s = { image: { mean: 0.5, sd: 0.1 }, segment: { mean: 0.5, sd: 0.05 } }
    // 图片 cos 0.95 → z 4.5；片段 cos 0.9 → z 8
    const out = cutAndMerge([img('i', 0.95)], [seg(1, 0, 0.9)], s, keyOf)
    expect(out.map((h) => h.key)).toEqual(['v1', 'i'])
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })

  it('映射不到代表帧的片段命中丢弃', () => {
    const out = cutAndMerge([], [seg(1, 0, 0.95), seg(2, 0, 0.95)], both, (id) => (id === 1 ? 'v1' : null))
    expect(out.map((h) => h.key)).toEqual(['v1'])
  })
})
