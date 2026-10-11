/**
 * 近重复（相似照片）分组：连拍、重复导出、轻度编辑过的副本 —— 文件不同、看起来几乎一样。
 * 字节完全相同的副本已经靠 file_hash 去重，不在这里处理。
 *
 * 不做 N 次全库 KNN：真实的近重复几乎总是“时间上挨着”（连拍 / 同一场景连按）或“文件名同源”
 * （IMG_1234.HEIC 与 IMG_1234 (1).jpg / IMG_1234-edited.jpg）。所以只比较：
 *   1. 按拍摄时间（缺失时用修改时间，再按文件名）排序后，每张和后面 TIME_WINDOW_MS 内、最多
 *      MAX_NEIGHBOURS 张做余弦；向量按滑动窗口从库里读，内存里同时只有 ~MAX_NEIGHBOURS 条
 *   2. 文件名主干相同的小组（≤ STEM_GROUP_MAX 张），不看时间
 * 命中的边用并查集连成组。5 万张图约 60 万次 768 维点积 + 5 万次按 hash 读向量。
 *
 * 阈值标定（EmbeddingGemma 2 · LiteRT，演示库 31 张图 + 3 段视频，2026-10-11）：
 *   重新压缩 q60 / 缩小一半 / 裁掉 8% / 提亮 15% / 旋转 3°   最小 0.942，p10 ≥ 0.948，中位 0.97–0.99
 *   视频里相隔 0.5–2 s 的帧（连拍的近似）                       0.92–0.99（快速运动的 train.mov 0.916）
 *   互不相关的两张图（随机对）                                  p99 0.862，最大 0.896
 *   同一组花卉的不同物种（“相似但不是重复”）                     0.86
 *   转成黑白                                                    0.86–0.93（不当作重复）
 * 时间窗口内本身就有“同一时刻”的证据，取 0.93：连拍基本都能连上，离随机最大值 0.896 还有余量；
 * 同名主干是更强的证据（同一张底片导出 / 编辑），取 0.90。
 */
import type { DupGroup, DupItem } from '../shared/cleanup'

export const TIME_WINDOW_MS = 120_000
export const MAX_NEIGHBOURS = 12
export const TIME_MIN_COSINE = 0.93
export const STEM_MIN_COSINE = 0.9
export const STEM_GROUP_MAX = 8

export interface DupCandidate extends DupItem {
  /** 排序用时间戳（毫秒）：拍摄时间，缺失时用文件修改时间 */
  ts: number
}

/** 文件名主干：去扩展名，再去掉 “ (1)” “-edited” “_copy” “ 副本” “-2” 这类导出 / 复制后缀 */
export function stemOf(fileName: string): string {
  let s = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/(\s*\(\d+\)|[\s_-]*(copy|edited|edit|副本|拷贝)|[\s_-]\d{1,2})$/i, '')
    if (next === s) break
    s = next
  }
  return s.trim()
}

/** 建议保留：像素最多 → 文件最大 → 拍得最早 → hash 字典序（保证确定性） */
export function pickKeeper(items: DupItem[]): string {
  const px = (i: DupItem): number => (i.width ?? 0) * (i.height ?? 0)
  const sorted = [...items].sort((a, b) =>
    px(b) - px(a) ||
    b.fileSize - a.fileSize ||
    (a.takenAt ?? '￿').localeCompare(b.takenAt ?? '￿') ||
    a.fileHash.localeCompare(b.fileHash))
  return sorted[0].fileHash
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    if (p !== x) { p = this.find(p); this.parent.set(x, p) }
    return p
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

export interface GroupOptions {
  /** 每处理这么多张让出一次事件循环（主进程上跑，别卡 IPC） */
  yieldEvery?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * 分组。getVector 按 hash 取 L2 归一化的图片向量（没有向量返回 null，跳过）。
 * 候选集可以很大：向量只在滑动窗口里保留。
 */
export async function groupNearDuplicates(
  candidates: DupCandidate[],
  getVector: (fileHash: string) => Float32Array | null,
  opts: GroupOptions = {}
): Promise<DupGroup[]> {
  const yieldEvery = opts.yieldEvery ?? 500
  const items = [...candidates].sort((a, b) => a.ts - b.ts || a.fileName.localeCompare(b.fileName))
  const uf = new UnionFind()
  const edgeBest = new Map<string, number>() // root 暂不可知，先按 hash 记最高相似度，最后再归到组
  const link = (a: string, b: string, c: number): void => {
    uf.union(a, b)
    edgeBest.set(a, Math.max(edgeBest.get(a) ?? 0, c))
    edgeBest.set(b, Math.max(edgeBest.get(b) ?? 0, c))
  }

  // 1. 时间窗口：向量缓存只留当前窗口
  const cache = new Map<string, Float32Array | null>()
  const vec = (h: string): Float32Array | null => {
    if (!cache.has(h)) cache.set(h, getVector(h))
    return cache.get(h) ?? null
  }
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    const va = vec(a.fileHash)
    if (va) {
      for (let j = i + 1; j < items.length && j <= i + MAX_NEIGHBOURS && items[j].ts - a.ts <= TIME_WINDOW_MS; j++) {
        const vb = vec(items[j].fileHash)
        if (!vb) continue
        const c = cosine(va, vb)
        if (c >= TIME_MIN_COSINE) link(a.fileHash, items[j].fileHash, c)
      }
    }
    cache.delete(a.fileHash) // 之后不会再作为“后面的邻居”被用到
    if ((i + 1) % yieldEvery === 0) {
      opts.onProgress?.(i + 1, items.length)
      await new Promise<void>((r) => setImmediate(r))
    }
  }

  // 2. 同名主干（不看时间）
  const byStem = new Map<string, DupCandidate[]>()
  for (const it of items) {
    const s = stemOf(it.fileName)
    if (s.length < 3) continue
    const list = byStem.get(s)
    if (list) list.push(it)
    else byStem.set(s, [it])
  }
  for (const list of byStem.values()) {
    if (list.length < 2 || list.length > STEM_GROUP_MAX) continue
    const vs = list.map((it) => getVector(it.fileHash))
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const va = vs[i], vb = vs[j]
        if (!va || !vb) continue
        const c = cosine(va, vb)
        if (c >= STEM_MIN_COSINE) link(list[i].fileHash, list[j].fileHash, c)
      }
    }
  }
  opts.onProgress?.(items.length, items.length)

  // 3. 收集组
  const groups = new Map<string, DupCandidate[]>()
  for (const it of items) {
    if (!edgeBest.has(it.fileHash)) continue
    const root = uf.find(it.fileHash)
    const g = groups.get(root)
    if (g) g.push(it)
    else groups.set(root, [it])
  }
  const out: DupGroup[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const dupItems: DupItem[] = members.map(({ ts: _ts, ...rest }) => rest)
    out.push({
      id: members.map((m) => m.fileHash).sort().join(':').slice(0, 64) + `:${members.length}`,
      items: dupItems,
      keeperHash: pickKeeper(dupItems),
      similarity: Math.max(...members.map((m) => edgeBest.get(m.fileHash) ?? 0)),
    })
  }
  // 可释放空间大的组排前面
  const reclaim = (g: DupGroup): number => g.items.filter((i) => i.fileHash !== g.keeperHash).reduce((s, i) => s + i.fileSize, 0)
  return out.sort((a, b) => reclaim(b) - reclaim(a))
}

export function reclaimableBytes(groups: DupGroup[]): number {
  let total = 0
  for (const g of groups) for (const i of g.items) if (i.fileHash !== g.keeperHash) total += i.fileSize * Math.max(1, i.copies)
  return total
}
