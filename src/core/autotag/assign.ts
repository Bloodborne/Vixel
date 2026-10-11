/**
 * 自动标签的判定：图片（或视频片段）向量 × 标签文字向量的余弦，只留"明显突出"的几个。
 *
 * 规则（三条都满足才打）：
 *   1. 校正后分数 z = (余弦 − 该标签在本库的平均余弦) / 本库合并标准差 ≥ minZ
 *      （第二、三个标签要 ≥ secondaryZ；"活动"类标签再加 activityExtraZ —— 动作最容易看错）
 *      —— 有的标签（"全景""室内"）和什么图都挺像，减去它自己的均值才公平；
 *         标准差用所有标签合并算（小库里逐标签的标准差太不稳）
 *   2. 在这张图的原始余弦里排前 topK
 *   3. 余弦不低于这张图第一名 − margin（第二、三名得和第一名差不多才算）
 * 宁缺毋滥：错的标签比没有标签更糟，所以阈值偏严，每项最多 maxPerItem 个。
 *
 * 标定（EmbeddingGemma 2 · LiteRT，词表 v1 共 153 个标签，2026-10-12）：
 *   三个库：演示库 34 项、公有领域视频素材 22 段、真实库 358 个视频帧
 *   所有（图, 标签）余弦：p50 0.650，p90 0.681，p99 0.723，最大 0.812；本库合并 sd 0.020–0.025
 *   第一版 z ≥ 3 / top3 / margin 0.03：演示库 + 素材库 62 个标签人工看对 54 个（87%）；
 *   错的多是第二标签（河流、白板、建筑）和动作（冲浪）→ 第二个起要 z ≥ 3.8、活动类 +0.7。
 *   终版：人工核对 89 个标签对 82 个（92%），见 docs/review/09-autotags.md
 */

export interface LabelVector {
  id: string
  /** L2 归一化的 768 维向量 */
  vector: Float32Array
  /** 这个标签额外要求的 z（"活动"类用） */
  extraZ?: number
}

export interface Baseline {
  /** 每个标签在本库的平均余弦（与 labels 同序） */
  mean: Float32Array
  /** 所有标签去均值后的合并标准差 */
  sd: number
}

export interface AssignOptions {
  minZ: number
  secondaryZ: number
  topK: number
  margin: number
  maxPerItem: number
}

export const DEFAULT_ASSIGN: AssignOptions = { minZ: 3, secondaryZ: 3.8, topK: 3, margin: 0.03, maxPerItem: 3 }
/** 活动类标签额外要求的 z */
export const ACTIVITY_EXTRA_Z = 0.7

/** 基线至少要这么多条向量；不够时用 MIN_SD 兜底，避免小库里 sd 太小、什么都过门槛 */
export const BASELINE_MIN_ITEMS = 20
/** 合并标准差的下限（标定里各库在 0.020–0.025 之间） */
export const MIN_SD = 0.02

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** 从库里的一批向量（可以是抽样）算基线 */
export function labelBaseline(vectors: Float32Array[], labels: LabelVector[]): Baseline {
  const n = vectors.length
  const mean = new Float32Array(labels.length)
  if (n === 0) return { mean, sd: MIN_SD }
  const scores = vectors.map((v) => labels.map((l) => dot(v, l.vector)))
  for (const s of scores) for (let j = 0; j < labels.length; j++) mean[j] += s[j] / n
  let acc = 0
  for (const s of scores) for (let j = 0; j < labels.length; j++) acc += (s[j] - mean[j]) ** 2
  const sd = Math.sqrt(acc / (n * labels.length))
  return { mean, sd: n < BASELINE_MIN_ITEMS ? Math.max(sd, MIN_SD) : Math.max(sd, MIN_SD * 0.75) }
}

export interface Assignment {
  labelId: string
  cosine: number
  z: number
}

/**
 * 一条向量 → 该打的标签（按余弦降序）。
 * 视频：把各片段 / 代表帧的结果合并时，同一标签取最高分（见 mergeAssignments）。
 */
export function assignLabels(vector: Float32Array, labels: LabelVector[], baseline: Baseline, opts: Partial<AssignOptions> = {}): Assignment[] {
  const o = { ...DEFAULT_ASSIGN, ...opts }
  const ranked = labels
    .map((l, j) => {
      const cosine = dot(vector, l.vector)
      return { labelId: l.id, cosine, z: (cosine - baseline.mean[j]) / baseline.sd, extra: l.extraZ ?? 0 }
    })
    .sort((a, b) => b.cosine - a.cosine)
  const top = ranked[0]?.cosine ?? 0
  const out: Assignment[] = []
  for (const x of ranked.slice(0, o.topK)) {
    const need = (out.length === 0 ? o.minZ : o.secondaryZ) + x.extra
    if (x.z >= need && x.cosine >= top - o.margin) out.push({ labelId: x.labelId, cosine: x.cosine, z: x.z })
  }
  return out.slice(0, o.maxPerItem)
}

/**
 * 多条向量（视频的代表帧 + 各片段）的结果合并：同一标签取 z 最高的那次，再按 z 取前 maxPerItem。
 * 只在片段里出现、代表帧没有的标签要多过 segmentOnlyExtraZ —— 片段向量混了声音和多帧，
 * 标定里单靠片段判出的标签错得最多（素材库里猫的视频被片段判成"摩托车"）
 */
export function mergeAssignments(lists: Assignment[][], maxPerItem = DEFAULT_ASSIGN.maxPerItem, primary?: Assignment[], segmentOnlyExtraZ = SEGMENT_ONLY_EXTRA_Z): Assignment[] {
  const onPrimary = new Set((primary ?? []).map((a) => a.labelId))
  const best = new Map<string, Assignment>()
  for (const a of primary ?? []) best.set(a.labelId, a)
  for (const list of lists) for (const a of list) {
    if (primary && !onPrimary.has(a.labelId) && a.z < DEFAULT_ASSIGN.minZ + segmentOnlyExtraZ) continue
    const cur = best.get(a.labelId)
    if (!cur || a.z > cur.z) best.set(a.labelId, a)
  }
  return [...best.values()].sort((a, b) => b.z - a.z).slice(0, maxPerItem)
}

/** 只在视频片段里判出的标签额外要求的 z */
export const SEGMENT_ONLY_EXTRA_Z = 1.5
