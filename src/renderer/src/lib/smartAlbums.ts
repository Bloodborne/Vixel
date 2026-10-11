import { useCallback, useEffect, useState } from 'react'
import type { MediaFilters, SmartAlbum } from '../../../shared/types'
import type { ExtraFilters } from '../components/shell/FilterBar'
import { normalizeQuery, takeLegacySavedSearches } from './searchHistory'

/** 拆开相册条件：日期 / 来源范围（类型、文件夹）/ 筛选栏条件，各自对应界面上不同的控件 */
export function splitAlbumFilters(f: MediaFilters): {
  dateFrom: string
  dateTo: string
  scope: Pick<MediaFilters, 'kind' | 'folderId'>
  extra: ExtraFilters
} {
  const { dateFrom = '', dateTo = '', kind, folderId, ...rest } = f
  const extra: ExtraFilters = {}
  if (rest.orientation) extra.orientation = rest.orientation
  if (rest.minPixels != null) extra.minPixels = rest.minPixels
  if (rest.maxPixels != null) extra.maxPixels = rest.maxPixels
  if (rest.durationMin != null) extra.durationMin = rest.durationMin
  if (rest.durationMax != null) extra.durationMax = rest.durationMax
  if (rest.personId != null) extra.personId = rest.personId
  if (rest.favorite) extra.favorite = true
  if (rest.tagIds?.length) extra.tagIds = [...rest.tagIds]
  if (rest.color) extra.color = rest.color
  const scope: Pick<MediaFilters, 'kind' | 'folderId'> = {}
  if (kind) scope.kind = kind
  if (folderId != null) scope.folderId = folderId
  return { dateFrom, dateTo, scope, extra }
}

/** 键排好序、去掉空值后的 JSON：比较"当前条件和相册是否一致"用（标签 id 列表也排序，选的先后不算差别） */
function canonical(f: MediaFilters): string {
  const entries = Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort((a, b) => a - b) : v] as const)
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)))
}

export function sameAlbumState(album: SmartAlbum, query: string, filters: MediaFilters): boolean {
  return normalizeQuery(album.query) === normalizeQuery(query) && canonical(album.filters) === canonical(filters)
}

/** 侧栏的智能相册列表：任意窗口改动后主进程广播，这里重新拉取。
 *  upsert 让刚创建 / 更新的相册立即可用，不必等广播回来 */
export function useSmartAlbums(): { albums: SmartAlbum[]; upsert: (album: SmartAlbum) => void } {
  const [albums, setAlbums] = useState<SmartAlbum[]>([])
  const upsert = useCallback((album: SmartAlbum) => {
    setAlbums((prev) => (prev.some((a) => a.id === album.id) ? prev.map((a) => (a.id === album.id ? album : a)) : [...prev, album]))
  }, [])
  useEffect(() => {
    let cancelled = false
    const load = (): void => { window.api.getSmartAlbums().then((a) => { if (!cancelled) setAlbums(a) }).catch(() => {}) }
    // 旧版存在 localStorage 里的"已保存搜索"迁成只有查询词的智能相册
    const legacy = takeLegacySavedSearches()
    Promise.all(legacy.map((q) => window.api.createSmartAlbum({ name: q, query: q, filters: {} }))).finally(load)
    const off = window.api.onSmartAlbumsChanged(load)
    return () => { cancelled = true; off() }
  }, [])
  return { albums, upsert }
}
