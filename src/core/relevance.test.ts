import { describe, it, expect } from 'vitest'
import { BASELINE_MIN, l2ToCosine, relevanceTest, RELEVANCE_MIN_Z } from './relevance'

/** 构造一个和 query 余弦恰好为 cos 的单位向量（二维就够） */
function vecWithCosine(cos: number): Float32Array {
  return new Float32Array([cos, Math.sqrt(Math.max(0, 1 - cos * cos))])
}

const QUERY = new Float32Array([1, 0])

describe('l2ToCosine', () => {
  it('d=0 → 1；d=√2 → 0；d=2 → −1（归一化向量的极值）', () => {
    expect(l2ToCosine(0)).toBeCloseTo(1, 12)
    expect(l2ToCosine(Math.SQRT2)).toBeCloseTo(0, 12)
    expect(l2ToCosine(2)).toBeCloseTo(-1, 12)
  })
})

describe('relevanceTest', () => {
  it('样本不足 BASELINE_MIN 时返回 null（调用方不过滤）', () => {
    const sample = Array.from({ length: BASELINE_MIN - 1 }, () => vecWithCosine(0.5))
    expect(relevanceTest(QUERY, sample)).toBeNull()
  })

  it('明显高出基线的命中通过，贴着基线的不通过', () => {
    // 基线：均值 ≈0.65、带一点散布（模拟真实库的相似度分布）
    const sample: Float32Array[] = []
    for (let i = 0; i < 64; i++) sample.push(vecWithCosine(0.65 + 0.02 * Math.sin(i * 1.7)))
    const test = relevanceTest(QUERY, sample)!
    expect(test).toBeTypeOf('function')
    expect(test(0.9)).toBe(true) // 远超均值
    expect(test(0.655)).toBe(false) // 淹没在基线里
  })

  it('门槛随该查询的基线移动：同一个余弦，基线高的查询不通过、基线低的通过', () => {
    const lowBase = Array.from({ length: 200 }, (_, i) => vecWithCosine(0.6 + 0.02 * Math.sin(i)))
    const highBase = Array.from({ length: 200 }, (_, i) => vecWithCosine(0.75 + 0.02 * Math.sin(i)))
    const cosine = 0.78
    expect(relevanceTest(QUERY, lowBase)!(cosine)).toBe(true)
    expect(relevanceTest(QUERY, highBase)!(cosine)).toBe(false)
  })

  it('小库（样本 < 150）允许稳健 z 补救：一簇相关结果撑大 sd 时真命中仍能过', () => {
    // 100 条里 25 条是同主题高相似（0.80），把普通 sd 撑大；主体在 0.62 ± 0.01
    const sample: Float32Array[] = []
    for (let i = 0; i < 75; i++) sample.push(vecWithCosine(0.62 + 0.01 * Math.sin(i * 2.3)))
    for (let i = 0; i < 25; i++) sample.push(vecWithCosine(0.8))
    const test = relevanceTest(QUERY, sample)!
    const mean = 0.62 * 0.75 + 0.8 * 0.25 // ≈0.665，sd 被双峰撑到 ~0.08
    const hit = 0.78 // 普通 z ≈ (0.78−0.665)/0.08 ≈ 1.4 < RELEVANCE_MIN_Z，但稳健 z（median≈0.62、MAD 小）很高
    expect((hit - mean) / 0.08).toBeLessThan(RELEVANCE_MIN_Z)
    expect(test(hit)).toBe(true)
  })
})
