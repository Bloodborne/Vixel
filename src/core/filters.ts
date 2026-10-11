/**
 * 浏览 / 搜索过滤条件的纯逻辑部分。
 *
 * 无搜索词时过滤在 SQL 里做（db.ts 的 filterWhere，和这里同一套判定）；
 * 有搜索词时融合结果已经按相关性排好，逐条用 matchesFilters 过滤代表 photo。
 */
import type { MediaFilters, Orientation, Photo } from '../shared/types'

/** 长边 ≥ 2 倍短边算全景；长短边相差 10% 以内算方形 */
export const PANORAMA_RATIO = 2
export const SQUARE_TOLERANCE = 1.1

export function classifyOrientation(width?: number | null, height?: number | null): Orientation | null {
  if (!width || !height) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long >= PANORAMA_RATIO * short) return 'panorama'
  if (long <= SQUARE_TOLERANCE * short) return 'square'
  return width > height ? 'landscape' : 'portrait'
}

/** 除来源（类型 / 文件夹）以外，是否设了任何过滤条件 */
export function hasActiveFilters(f: MediaFilters | undefined): boolean {
  if (!f) return false
  return !!(f.dateFrom || f.dateTo || f.orientation || f.minPixels || f.maxPixels ||
    f.durationMin != null || f.durationMax != null || f.personId != null || f.favorite || (f.tagIds?.length ?? 0) > 0)
}

/** 需要查库才能判断的条件，调用方预先取成 hash 集合 */
export interface FilterSets {
  folderHashes?: Set<string> | null
  personHashes?: Set<string> | null
  favoriteHashes?: Set<string> | null
  /** 同时带有所有所选标签的内容 */
  tagHashes?: Set<string> | null
}

export function matchesFilters(photo: Photo, f: MediaFilters, sets: FilterSets = {}): boolean {
  // 日期沿用原有语义：没有拍摄时间的不因日期条件被排除
  if (f.dateFrom && photo.takenAt && photo.takenAt < f.dateFrom) return false
  if (f.dateTo && photo.takenAt && photo.takenAt > f.dateTo) return false
  if (f.kind && (photo.mediaKind ?? 'image') !== f.kind) return false
  if (sets.folderHashes && !sets.folderHashes.has(photo.fileHash)) return false
  if (f.orientation && classifyOrientation(photo.width, photo.height) !== f.orientation) return false
  const pixels = (photo.width ?? 0) * (photo.height ?? 0)
  if (f.minPixels && pixels < f.minPixels) return false
  if (f.maxPixels && (!pixels || pixels >= f.maxPixels)) return false
  if (f.durationMin != null || f.durationMax != null) {
    const d = photo.videoId != null ? photo.durationMs : null
    if (d == null) return false
    if (f.durationMin != null && d < f.durationMin) return false
    if (f.durationMax != null && d >= f.durationMax) return false
  }
  if (sets.personHashes && !sets.personHashes.has(photo.fileHash)) return false
  if (sets.favoriteHashes && !sets.favoriteHashes.has(photo.fileHash)) return false
  if (sets.tagHashes && !sets.tagHashes.has(photo.fileHash)) return false
  return true
}

/** 每个标签各自的 hash 集合 → 同时带有全部标签的 hash（AND）；没选标签返回 null */
export function intersectTagHashes(perTag: Array<Set<string>>): Set<string> | null {
  if (perTag.length === 0) return null
  const [first, ...rest] = [...perTag].sort((a, b) => a.size - b.size)
  return new Set([...first].filter((h) => rest.every((s) => s.has(h))))
}
