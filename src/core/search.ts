/**
 * 搜索引擎 — RRF 融合：image vec + 音视频片段 vec + ocr BM25 + filename + 标签
 *
 * 纯逻辑都拆在旁边的小模块里（这里只做编排和查库）：
 *   queryAnalysis.ts  查询分析：类型词剥离 / 查号式查询判定
 *   relevance.ts      向量通道的相关性门槛（按查询自适应的 z 分数）
 *   fusion.ts         加权 RRF 融合
 *   imageQuery.ts     以图搜图的门槛与合并
 */

import type { DatabaseInstance } from './db'
import type { MatchChannel, MediaFilters, Photo, SearchResult } from '../shared/types'
import { hasActiveFilters, intersectTagHashes, matchesFilters, type FilterSets } from './filters'
import { maskForColor } from '../shared/colors'
import { TagStore } from './tagStore'
import { getEmbeddingService } from './embedding'
import { rrfFuse } from './fusion'
import { BASELINE_MIN, l2ToCosine, relevanceTest } from './relevance'
import { channelStats, cutAndMerge, IMAGE_GATE, MIXED_GATE, type Gate, type ImageHit, type SegmentHit } from './imageQuery'

interface VecSearchResult {
  fileHash: string
  distance: number
}

interface VideoSegmentSearchResult {
  videoId: number
  startMs: number
  endMs: number
  distance: number
}

interface TextSearchResult {
  fileHash: string
  score: number
}

/**
 * "相似"的最低余弦相似度：先按它过滤，再截取条数，不够就少给、一张都没有就不展示。
 * LiteRT 版 EmbeddingGemma 2 的图片向量基线偏高：实测（358 段视频的真实库）随机两张的中位数 0.72、
 * p90 0.80，同场景连拍 0.87+；互不相关的演示图片最接近的一张也常到 0.79。0.85 只留真正相近的。
 */
export const SIMILAR_MIN_COSINE = 0.85

/**
 * 基线抽样条数。某一类向量少于 BASELINE_MIN 条时（小库、只有几段视频），
 * 两类合并成一个基线（同一嵌入空间）；合并后仍少于 BASELINE_MIN 才放弃门槛。
 * 新用户常拿一个小文件夹试用，这时不过滤就会"什么都搜出整个库"。
 */
const BASELINE_SAMPLE = 256
/** 一个明确命中都没有时，给出的"最接近"结果条数（标记 lowConfidence） */
const FALLBACK_LIMIT = 12

type VecKind = 'image' | 'segment'

export type SearchOptions = MediaFilters

export class SearchEngine {
  private db: DatabaseInstance
  private tags: TagStore
  // 基线样本缓存：库的向量条数变化超过 10% 才重新抽样
  private baseline: Record<VecKind, { sample: Float32Array[]; count: number }> | null = null

  constructor(db: DatabaseInstance) {
    this.db = db
    this.tags = new TagStore(db.raw)
  }

  async search(query: string, limit: number = 50, options?: SearchOptions): Promise<SearchResult[]> {
    const trimmedQuery = query.trim()
    const filters: MediaFilters = options ?? {}
    const kind = filters.kind

    // 无搜索词：按过滤条件浏览，或返回最近照片
    if (!trimmedQuery) {
      if (kind || filters.folderId != null || hasActiveFilters(filters)) {
        const photos = this.db.getRepresentativePhotosFiltered(limit, 0, filters)
        return photos.map((photo) => ({ photo, score: 1.0 }))
      }
      return this.getRecentPhotos(limit)
    }

    try {
      // 查询向量只编码一次，图片通道和视频片段通道共用。
      // 这是唯一的异步步骤，之后四路检索都是同步的 SQLite 查询。
      const queryVec = await this.encodeQuery(trimmedQuery)

      // 四路召回（caption 通道已删除）：图片 vec / 片段 vec / ocr BM25 / 文件名 LIKE。
      // 按类型过滤时跳过用不上的通道：片段只属于音视频；图片向量和 OCR 只对图片 + 视频首帧有意义
      const wantSegments = kind !== 'image'
      const wantImageChannels = kind !== 'audio'
      const rawImageVec = wantImageChannels ? this.searchByVector(queryVec, limit * 2) : []
      const rawSegments = wantSegments ? this.searchVideoSegments(queryVec, limit * 2) : []
      const ocrResults = wantImageChannels ? this.searchByOcr(trimmedQuery, limit * 2) : []
      const fileNameResults = this.db.searchByFileName(trimmedQuery, limit * 2)
      // 用户打的标签：和文字、文件名一样算"明确命中"
      const tagResults = this.searchByTags(trimmedQuery, limit * 2)

      // 相关性门槛：向量通道只留明显高于该查询基线的命中（见 RELEVANCE_MIN_Z）
      const relevant = <T extends { distance: number }>(rows: T[], kind: VecKind): T[] => {
        if (!queryVec || rows.length === 0) return rows
        const isRelevant = relevanceTest(queryVec, this.baselineSample(kind))
        return isRelevant ? rows.filter((r) => isRelevant(l2ToCosine(r.distance))) : rows
      }
      let imageVecResults = relevant(rawImageVec, 'image')
      let videoSegmentResults = relevant(rawSegments, 'segment')
      // 什么都没过门槛、文字和文件名也没命中：给少量"最接近"的结果并标明，而不是凑满一屏
      const lowConfidence = imageVecResults.length + videoSegmentResults.length + ocrResults.length + fileNameResults.length +
        tagResults.length === 0 &&
        rawImageVec.length + rawSegments.length > 0
      if (lowConfidence) {
        imageVecResults = rawImageVec.slice(0, FALLBACK_LIMIT)
        videoSegmentResults = rawSegments.slice(0, FALLBACK_LIMIT)
        limit = Math.min(limit, FALLBACK_LIMIT)
      }

      // 片段命中 → 映射到该媒体代表 photo 的 fileHash，
      // 这样才能和图片通道在同一个 id 空间里融合；同时记下命中区间给 UI 定位
      const videoSegmentAsFileHash: VecSearchResult[] = []
      const segmentByHash = new Map<string, { startMs: number; endMs: number }>()
      for (const seg of videoSegmentResults) {
        const frames = this.db.getFramePhotosByVideo(seg.videoId)
        const frame = frames.find((f) => !f.deletedAt) ?? frames[0]
        if (frame?.fileHash) {
          videoSegmentAsFileHash.push({ fileHash: frame.fileHash, distance: seg.distance })
          segmentByHash.set(frame.fileHash, { startMs: seg.startMs, endMs: seg.endMs })
        }
      }
      const segmentHashes = new Set(segmentByHash.keys())

      // 代表帧也有图片向量：已被片段通道命中的视频从图片通道剔除，
      // 否则 RRF 会把同一视频累加两次，视频几乎霸占所有查询的前排
      const imageOnlyResults = imageVecResults.filter((r) => !segmentHashes.has(r.fileHash))

      // RRF 融合（各通道先按相关性排序好，再交给 fusion）
      const mergedResults = rrfFuse(
        [
          [...imageOnlyResults].sort((a, b) => a.distance - b.distance),
          [...videoSegmentAsFileHash].sort((a, b) => a.distance - b.distance),
          [...ocrResults].sort((a, b) => b.score - a.score),
          fileNameResults,
          tagResults,
        ],
        60
      )

      const maxScore = mergedResults.length > 0 ? mergedResults[0].score : 1
      for (const r of mergedResults) {
        r.score = r.score / maxScore
      }

      // 每条结果记下召回它的通道，供界面解释命中原因
      const channelSets: Array<[MatchChannel, Set<string>]> = [
        ['visual', new Set(imageOnlyResults.map((r) => r.fileHash))],
        ['segment', segmentHashes],
        ['text', new Set(ocrResults.map((r) => r.fileHash))],
        ['filename', new Set(fileNameResults.map((r) => r.fileHash))],
        ['tag', new Set(tagResults.map((r) => r.fileHash))],
      ]
      const matchedBy = (hash: string): MatchChannel[] =>
        channelSets.filter(([, set]) => set.has(hash)).map(([ch]) => ch)

      // 需要查库的条件先取成 hash 集合，逐条过滤时只做集合查找
      const sets = this.filterSets(filters)
      const hidden = this.hiddenHashes()
      const results: SearchResult[] = []
      const seenHashes = new Set<string>()
      const seenVideos = new Set<number>()
      for (const { fileHash, score } of mergedResults) {
        if (seenHashes.has(fileHash)) continue
        seenHashes.add(fileHash)
        if (hidden.has(fileHash)) continue

        const photo = this.db.getRepresentativeByHash(fileHash)
        if (photo && !photo.deletedAt) {
          if (!matchesFilters(photo, filters, sets)) continue
          // 视频去重：同一视频的多个帧只保留首个（已按 score 降序，所以是最佳帧）
          if (photo.videoId != null) {
            if (seenVideos.has(photo.videoId)) continue
            seenVideos.add(photo.videoId)
          }
          const segment = segmentByHash.get(fileHash)
          const by = matchedBy(fileHash)
          const extra = lowConfidence ? { lowConfidence: true } : {}
          results.push(segment ? { photo, score, segment, matchedBy: by, ...extra } : { photo, score, matchedBy: by, ...extra })
          if (results.length >= limit) break
        }
      }

      return results
    } catch (error) {
      console.error('Search error:', error)
      return this.getRecentPhotos(limit)
    }
  }

  private baselineSample(kind: VecKind): Float32Array[] {
    const own = this.rawBaselineSample(kind)
    if (own.length >= BASELINE_MIN) return own
    return [...this.rawBaselineSample('image'), ...this.rawBaselineSample('segment')]
  }

  private rawBaselineSample(kind: VecKind): Float32Array[] {
    const counts = this.db.countVectors()
    const stale = (k: VecKind): boolean => {
      const b = this.baseline?.[k]
      return !b || Math.abs(counts[k] - b.count) > Math.max(10, b.count * 0.1)
    }
    if (!this.baseline || stale('image') || stale('segment')) {
      this.baseline = {
        image: { sample: this.db.sampleVectors('image', BASELINE_SAMPLE), count: counts.image },
        segment: { sample: this.db.sampleVectors('segment', BASELINE_SAMPLE), count: counts.segment },
      }
    }
    return this.baseline[kind].sample
  }

  findSimilar(fileHash: string, limit: number = 12, minCosine: number = SIMILAR_MIN_COSINE): SearchResult[] {
    // 取超采，因为下面会按 hash + video 去重，可能丢一部分
    const results = this.db.findSimilar(fileHash, limit * 3)
    const photos: SearchResult[] = []
    const seenHashes = new Set<string>([fileHash, ...this.hiddenHashes()]) // 排除查询本身和已隐藏的
    const seenVideos = new Set<number>()
    for (const { fileHash: hash, distance } of results) {
      const similarity = l2ToCosine(distance)
      // KNN 按距离升序：第一个低于门槛的之后全都更低
      if (similarity < minCosine) break
      if (seenHashes.has(hash)) continue
      seenHashes.add(hash)
      const photo = this.db.getRepresentativeByHash(hash)
      if (photo && !photo.deletedAt) {
        if (photo.videoId != null) {
          if (seenVideos.has(photo.videoId)) continue
          seenVideos.add(photo.videoId)
        }
        photos.push({ photo, score: similarity })
        if (photos.length >= limit) break
      }
    }
    return photos
  }

  /**
   * 以图搜图：查询向量（已在调用方编码好）对图片向量 + 音视频片段向量两路 KNN，
   * 各自按库基线标准化后过门槛再合并（逻辑和标定见 imageQuery.ts）。
   * 过滤 / 隐藏排除与文字搜索一致；excludeHash 是查询图自己的内容 hash（在库里时从结果中去掉）。
   * 一个都没过门槛时退化为少量"最接近"的结果并标 lowConfidence（与文字搜索同款语义）。
   */
  searchByImage(
    queryVec: Float32Array,
    opts: { limit?: number; filters?: MediaFilters; excludeHash?: string | null; mixed?: boolean } = {}
  ): { results: SearchResult[]; queryInLibrary: boolean } {
    const limit = opts.limit ?? 60
    const filters = opts.filters ?? {}
    const kind = filters.kind
    const gate: Gate = opts.mixed ? MIXED_GATE : IMAGE_GATE

    // 按类型过滤时跳过用不上的通道（与文字搜索一致）：片段只属于音视频，图片向量属于图片 + 视频代表帧
    const rawImages: ImageHit[] = kind === 'audio' ? [] : this.db.searchByVec(queryVec, limit * 2)
      .map((r) => ({ fileHash: r.fileHash, cosine: l2ToCosine(r.distance) }))
    const rawSegments: SegmentHit[] = kind === 'image' ? [] : this.db.searchVideoSegmentsByVec(queryVec, limit * 2)
      .map((r) => ({ videoId: r.videoId, startMs: r.startMs, endMs: r.endMs, cosine: l2ToCosine(r.distance) }))

    const stats = {
      image: channelStats(queryVec, this.baselineSample('image')),
      segment: channelStats(queryVec, this.baselineSample('segment')),
    }
    // 片段命中换成该视频代表帧的 hash（和图片通道同一个 id 空间）；没有存活帧的丢弃
    const segmentKey = (videoId: number): string | null => {
      const frames = this.db.getFramePhotosByVideo(videoId)
      const frame = frames.find((f) => !f.deletedAt) ?? frames[0]
      return frame?.fileHash ?? null
    }
    let merged = cutAndMerge(rawImages, rawSegments, stats, segmentKey, gate)
    // 查询图就在库里：从结果中排除，并告知 UI
    const queryInLibrary = !!opts.excludeHash && !!this.db.getRepresentativeByHash(opts.excludeHash)
    if (opts.excludeHash) merged = merged.filter((h) => h.key !== opts.excludeHash)

    // 什么都没过门槛：给少量"最接近"的结果并标明，而不是一片空白
    let lowConfidence = false
    if (merged.length === 0 && rawImages.length + rawSegments.length > 0) {
      lowConfidence = true
      const open: Gate = {
        imageMinZ: -Infinity, imageMinCosine: -Infinity, segmentMinZ: -Infinity, segmentMinCosine: -Infinity,
        imageMinCosineNoBaseline: -Infinity, segmentMinCosineNoBaseline: -Infinity,
      }
      merged = cutAndMerge(rawImages, rawSegments, stats, segmentKey, open)
        .filter((h) => h.key !== opts.excludeHash)
        .slice(0, FALLBACK_LIMIT)
    }

    const sets = this.filterSets(filters)
    const hidden = this.hiddenHashes()
    const results: SearchResult[] = []
    const seenVideos = new Set<number>()
    const max = Math.min(limit, lowConfidence ? FALLBACK_LIMIT : limit)
    for (const hit of merged) {
      if (hidden.has(hit.key)) continue
      const photo = this.db.getRepresentativeByHash(hit.key)
      if (!photo || photo.deletedAt) continue
      if (!matchesFilters(photo, filters, sets)) continue
      // 同一视频的多个抽帧 hash 不同：按 videoId 再去一次重（merged 已按分数降序，留下的是最佳帧）
      if (photo.videoId != null) {
        if (seenVideos.has(photo.videoId)) continue
        seenVideos.add(photo.videoId)
      }
      results.push({
        photo,
        // 展示分数用余弦（和 findSimilar 一致、可解释）；顺序已按 z 排好
        score: hit.cosine,
        matchedBy: [hit.channel satisfies MatchChannel],
        ...(hit.segment ? { segment: hit.segment } : {}),
        ...(lowConfidence ? { lowConfidence: true } : {}),
      })
      if (results.length >= max) break
    }
    return { results, queryInLibrary }
  }

  /** 需要查库的过滤条件先取成 hash 集合（文字搜索和以图搜图共用） */
  private filterSets(filters: MediaFilters): FilterSets {
    return {
      folderHashes: filters.folderId != null ? this.db.getHashesInFolder(filters.folderId) : null,
      personHashes: filters.personId != null ? this.db.getHashesForPerson(filters.personId) : null,
      favoriteHashes: filters.favorite ? this.db.getFavoriteHashes() : null,
      tagHashes: intersectTagHashes((filters.tagIds ?? []).map((id) => this.tags.hashesForTag(id))),
      colorHashes: filters.color ? this.db.getHashesForColorMask(maskForColor(filters.color)) : null,
    }
  }

  /** 近重复清理里“在 Vixel 中隐藏”的内容（表很小，每次查询现读） */
  private hiddenHashes(): Set<string> {
    return new Set(this.db.raw.prepare('SELECT file_hash FROM hidden_items').pluck().all() as string[])
  }

  private async encodeQuery(query: string): Promise<Float32Array | null> {
    try {
      const embeddingService = getEmbeddingService()
      if (!embeddingService.isReady()) return null
      return await embeddingService.encodeText(query)
    } catch (error) {
      console.error('Query encoding failed:', error)
      return null
    }
  }

  private searchByVector(queryVec: Float32Array | null, limit: number): VecSearchResult[] {
    if (!queryVec) return []
    try {
      return this.db.searchByVec(queryVec, limit)
    } catch (error) {
      console.error('Vector search failed:', error)
      return []
    }
  }

  private searchVideoSegments(queryVec: Float32Array | null, limit: number): VideoSegmentSearchResult[] {
    if (!queryVec) return []
    try {
      const rawResults = this.db.searchVideoSegmentsByVec(queryVec, limit)
      // 按 videoId 去重，保留每个视频的最佳片段
      const bestPerVideo = new Map<number, VideoSegmentSearchResult>()
      for (const seg of rawResults) {
        const existing = bestPerVideo.get(seg.videoId)
        if (!existing || seg.distance < existing.distance) {
          bestPerVideo.set(seg.videoId, seg)
        }
      }
      return Array.from(bestPerVideo.values())
    } catch (error) {
      console.error('Video segment search failed:', error)
      return []
    }
  }

  private searchByOcr(query: string, limit: number): TextSearchResult[] {
    try {
      return this.db.searchByOcr(query, limit)
    } catch (error) {
      console.error('OCR search failed:', error)
      return []
    }
  }

  private searchByTags(query: string, limit: number): Array<{ fileHash: string }> {
    try {
      return this.tags.search(query, limit)
    } catch (error) {
      console.error('Tag search failed:', error)
      return []
    }
  }

  private getRecentPhotos(limit: number): SearchResult[] {
    const photos = this.db.getRepresentativePhotos(limit)
    return photos.map((photo) => ({ photo, score: 1.0 }))
  }
}
