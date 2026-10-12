/**
 * 语义搜索的相关性门槛（按查询自适应）。纯函数，不碰数据库，方便单测。
 *
 * 向量检索永远返回 K 个"最近"的结果，库里根本没有的东西（在新疆旅行视频里搜"海边"）也会凑满一屏。
 * 绝对余弦值没法当门槛：EmbeddingGemma 2 的文本↔图片相似度挤在 0.65–0.80，
 * 不同查询的基线差得比"相关 / 不相关"还大（实测"夜景"真命中 0.69，不存在的"滑雪"最高 0.74）。
 *
 * 所以按查询标准化：抽样估计这个查询和整库的相似度均值 / 标准差，只保留高出均值 Z 个标准差的命中。
 * 实测（LiteRT 向量；358 段视频的真实库 + 34 项演示库，各 ~10 个存在 / 不存在的概念）：
 * 存在的概念最佳命中多在 3–5.5σ，最弱的（"夜景""大巴扎"）2.7–2.8σ；不存在的多在 1.8–2.6σ。
 */
export const RELEVANCE_MIN_Z = 2.75

/**
 * 稳健版门槛（仅小库）：中位数 / MAD 不受"一大簇相关结果"影响。小库里四分之一都是花时，
 * 普通标准差被这簇撑大，真命中的 z 反而不够；稳健 z 能补上。两者任一过线即算相关。
 */
export const RELEVANCE_MIN_ROBUST_Z = 3.5
const ROBUST_MAX_SAMPLE = 150

/** 基线样本最少条数：少于它就没法估计分布（调用方会合并两类向量或放弃门槛） */
export const BASELINE_MIN = 20

/** vec0 默认 L2 距离；向量已 L2 归一化，余弦相似度 = 1 − d²/2 */
export const l2ToCosine = (distance: number): number => 1 - (distance * distance) / 2

/** 查询相似度的相关性判定函数；样本不够时返回 null（不过滤） */
export function relevanceTest(query: Float32Array, sample: Float32Array[]): ((cosine: number) => boolean) | null {
  if (sample.length < BASELINE_MIN) return null
  const sims = sample.map((v) => {
    let d = 0
    for (let i = 0; i < v.length; i++) d += v[i] * query[i]
    return d
  })
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length
  const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length) || 1e-6
  const sorted = [...sims].sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  const mad = (sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b)[sorted.length >> 1] * 1.4826) || 1e-6
  // 稳健 z 只用于小库：大库的分布本来就不被单一主题主导，再放宽会把不存在的东西放进来（实测）
  const useRobust = sims.length < ROBUST_MAX_SAMPLE
  return (cosine) => (cosine - mean) / sd >= RELEVANCE_MIN_Z || (useRobust && (cosine - median) / mad >= RELEVANCE_MIN_ROBUST_Z)
}
