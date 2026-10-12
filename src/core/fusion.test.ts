import { describe, it, expect } from 'vitest'
import { rrfFuse } from './fusion'

describe('rrfFuse', () => {
  it('returns empty when no channels', () => {
    expect(rrfFuse([])).toEqual([])
  })

  it('handles a single channel as identity ordering', () => {
    const out = rrfFuse([[{ fileHash: 'a' }, { fileHash: 'b' }, { fileHash: 'c' }]])
    expect(out.map((r) => r.fileHash)).toEqual(['a', 'b', 'c'])
    // 分数单调递减
    expect(out[0].score).toBeGreaterThan(out[1].score)
    expect(out[1].score).toBeGreaterThan(out[2].score)
  })

  it('items appearing in multiple channels rank above singletons', () => {
    const out = rrfFuse([
      [{ fileHash: 'a' }, { fileHash: 'b' }],
      [{ fileHash: 'c' }, { fileHash: 'a' }],
    ])
    // 'a' 在两路都出现，应该排第一
    expect(out[0].fileHash).toBe('a')
  })

  it('respects rank decay — top of each channel weights more than bottom', () => {
    const out = rrfFuse([
      [{ fileHash: 'top' }, { fileHash: 'mid' }, { fileHash: 'bot' }],
    ])
    expect(out[0].fileHash).toBe('top')
    expect(out[2].fileHash).toBe('bot')
  })

  it('changing k changes the decay shape', () => {
    const big = rrfFuse([[{ fileHash: 'x' }]], 1000)
    const small = rrfFuse([[{ fileHash: 'x' }]], 1)
    expect(big[0].score).toBeLessThan(small[0].score)
  })

  it('a low-ranked match in one channel can still beat a singleton top', () => {
    // 'a' 出现在两路（一路第 5 名 + 一路第 3 名），'b' 仅在第 1 路第 1 名
    const channelA: { fileHash: string }[] = [
      { fileHash: 'b' },
      { fileHash: 'x' }, { fileHash: 'y' }, { fileHash: 'z' }, { fileHash: 'a' },
    ]
    const channelB: { fileHash: string }[] = [
      { fileHash: 'p' }, { fileHash: 'q' }, { fileHash: 'a' },
    ]
    const out = rrfFuse([channelA, channelB])
    const aRank = out.findIndex((r) => r.fileHash === 'a')
    const bRank = out.findIndex((r) => r.fileHash === 'b')
    expect(aRank).toBeLessThan(bRank)
  })

  it('does not crash on duplicate hashes within a single channel', () => {
    const out = rrfFuse([[{ fileHash: 'a' }, { fileHash: 'a' }, { fileHash: 'b' }]])
    expect(out.length).toBe(2)
    expect(out[0].fileHash).toBe('a')
  })
})

describe('rrfFuse — channel weights', () => {
  it('plain arrays behave exactly like weight 1', () => {
    const plain = rrfFuse([[{ fileHash: 'a' }, { fileHash: 'b' }]])
    const weighted = rrfFuse([{ items: [{ fileHash: 'a' }, { fileHash: 'b' }], weight: 1 }])
    expect(weighted).toEqual(plain)
  })

  it('a slightly heavier channel wins rank-1 ties (1.01 的文本通道压过同名次的向量通道)', () => {
    const out = rrfFuse([
      { items: [{ fileHash: 'visual' }], weight: 1 },
      { items: [{ fileHash: 'exactText' }], weight: 1.01 },
    ])
    expect(out[0].fileHash).toBe('exactText')
  })

  it('a 1.01 channel does NOT lift its rank 2 above another channel rank 1', () => {
    const out = rrfFuse([
      { items: [{ fileHash: 'visual' }], weight: 1 },
      { items: [{ fileHash: 't1' }, { fileHash: 't2' }], weight: 1.01 },
    ])
    const visualRank = out.findIndex((r) => r.fileHash === 'visual')
    const t2Rank = out.findIndex((r) => r.fileHash === 't2')
    expect(out[0].fileHash).toBe('t1') // 同名次（都是各自通道第 1）时文本赢
    expect(visualRank).toBeLessThan(t2Rank) // 但压不过高一名次的向量命中
  })

  it('weights scale contributions (×2 与 ×0.5)', () => {
    const out = rrfFuse([
      { items: [{ fileHash: 'a' }], weight: 2 },
      { items: [{ fileHash: 'b' }], weight: 0.5 },
    ])
    expect(out[0].fileHash).toBe('a')
    expect(out[0].score).toBeCloseTo(2 / 61, 10)
    expect(out[1].score).toBeCloseTo(0.5 / 61, 10)
  })
})
