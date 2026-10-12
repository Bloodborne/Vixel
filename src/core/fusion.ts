/**
 * Reciprocal Rank Fusion —— 把多路检索（vec / BM25 / OCR / 文件名 ...）
 * 的结果按 weight/(k + rank) 加权累加，得到统一排序。
 *
 * 抽到独立模块的原因：
 *   - 纯函数，便于单测
 *   - 让 search.ts 不需要再嵌一个私有方法
 */

/** 单路检索结果：通过排名贡献分数（越前越高），不需要原始 score */
export interface RankedItem {
  fileHash: string
}

/** 一路检索 + 可选的通道权重（默认 1，等权） */
export interface FusionChannel<T extends RankedItem> {
  items: T[]
  /**
   * 该通道每个排名的贡献乘数。用法举例（见 search.ts）：
   *   - 精确文本通道（OCR / 文件名 / 标签）取 1.01：同排名时压过向量通道
   *     （查询原文出现在图里 / 文件名里，比"长得像"更确定），又不会让文本
   *     通道的第 2 名越过向量通道的第 1 名（需要 w < 61/60 ≈ 1.017）。
   *   - 查号式查询（IMG_2682）：文本通道 ×2、向量通道 ×0.5。
   */
  weight?: number
}

export interface FusedItem {
  fileHash: string
  score: number
}

/**
 * 多路 RRF 融合。传数组就是等权；要加权时传 { items, weight }。
 *
 * @param channels 每路结果（按相关性降序）
 * @param k        RRF 衰减常数，默认 60（IR 文献的经验值）
 */
export function rrfFuse<T extends RankedItem>(
  channels: Array<T[] | FusionChannel<T>>,
  k: number = 60
): FusedItem[] {
  const scores = new Map<string, number>()
  for (const channel of channels) {
    const { items, weight = 1 } = Array.isArray(channel) ? { items: channel } : channel
    items.forEach((r, rank) => {
      scores.set(r.fileHash, (scores.get(r.fileHash) || 0) + weight / (k + rank + 1))
    })
  }
  return Array.from(scores.entries())
    .map(([fileHash, score]) => ({ fileHash, score }))
    .sort((a, b) => b.score - a.score)
}
