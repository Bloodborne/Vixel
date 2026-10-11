import { describe, expect, it } from 'vitest'
import { sameAlbumState, splitAlbumFilters } from './smartAlbums'
import type { SmartAlbum } from '../../../shared/types'

const album = (query: string, filters: SmartAlbum['filters']): SmartAlbum =>
  ({ id: 1, name: 'a', query, filters, sortOrder: 0, createdAt: '', updatedAt: '' })

describe('splitAlbumFilters', () => {
  it('separates date, scope and filter-bar conditions', () => {
    const r = splitAlbumFilters({ dateFrom: '2024-01-01', kind: 'video', folderId: 3, orientation: 'portrait', favorite: true, personId: 7 })
    expect(r.dateFrom).toBe('2024-01-01')
    expect(r.dateTo).toBe('')
    expect(r.scope).toEqual({ kind: 'video', folderId: 3 })
    expect(r.extra).toEqual({ orientation: 'portrait', favorite: true, personId: 7 })
  })
})

describe('sameAlbumState', () => {
  it('ignores key order, whitespace and empty values', () => {
    const a = album('海边  日落', { orientation: 'landscape', minPixels: 8_000_000 })
    expect(sameAlbumState(a, ' 海边 日落 ', { minPixels: 8_000_000, orientation: 'landscape', dateFrom: '' })).toBe(true)
  })
  it('detects changed query or filters', () => {
    const a = album('花', { favorite: true })
    expect(sameAlbumState(a, '花朵', { favorite: true })).toBe(false)
    expect(sameAlbumState(a, '花', {})).toBe(false)
    expect(sameAlbumState(a, '花', { favorite: true, kind: 'image' })).toBe(false)
  })
})
