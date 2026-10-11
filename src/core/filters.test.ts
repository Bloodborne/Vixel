import { describe, it, expect } from 'vitest'
import { classifyOrientation, hasActiveFilters, matchesFilters } from './filters'
import type { Photo } from '../shared/types'

const photo = (over: Partial<Photo>): Photo => ({
  id: 1, folderId: 1, filePath: '/a.jpg', fileName: 'a.jpg', fileSize: 1, fileMtime: 0, fileHash: 'h1',
  embedStatus: 'done', createdAt: '', updatedAt: '', ...over,
})

describe('classifyOrientation', () => {
  it('handles missing size', () => {
    expect(classifyOrientation(undefined, 100)).toBeNull()
    expect(classifyOrientation(100, 0)).toBeNull()
  })
  it('classifies by aspect ratio', () => {
    expect(classifyOrientation(4000, 3000)).toBe('landscape')
    expect(classifyOrientation(3000, 4000)).toBe('portrait')
    expect(classifyOrientation(1000, 1050)).toBe('square')
    expect(classifyOrientation(1100, 1000)).toBe('square') // 边界：10% 以内
    expect(classifyOrientation(1101, 1000)).toBe('landscape')
    expect(classifyOrientation(6000, 3000)).toBe('panorama') // 边界：正好 2:1
    expect(classifyOrientation(1000, 2500)).toBe('panorama') // 竖向全景
  })
})

describe('matchesFilters', () => {
  it('passes everything with no filters', () => {
    expect(matchesFilters(photo({}), {})).toBe(true)
    expect(hasActiveFilters({ kind: 'image', folderId: 2 })).toBe(false)
    expect(hasActiveFilters({ favorite: true })).toBe(true)
  })
  it('filters by orientation and pixels', () => {
    const p = photo({ width: 4000, height: 3000 })
    expect(matchesFilters(p, { orientation: 'landscape' })).toBe(true)
    expect(matchesFilters(p, { orientation: 'portrait' })).toBe(false)
    expect(matchesFilters(p, { minPixels: 12_000_000 })).toBe(true)
    expect(matchesFilters(p, { minPixels: 12_000_001 })).toBe(false)
    expect(matchesFilters(p, { maxPixels: 1_000_000 })).toBe(false)
    expect(matchesFilters(photo({}), { maxPixels: 1_000_000 })).toBe(false) // 尺寸未知不算小图
  })
  it('duration filters exclude images and use [min, max)', () => {
    const video = photo({ videoId: 3, mediaKind: 'video', durationMs: 30_000 })
    expect(matchesFilters(photo({}), { durationMax: 30_000 })).toBe(false)
    expect(matchesFilters(video, { durationMax: 30_000 })).toBe(false)
    expect(matchesFilters(video, { durationMin: 30_000, durationMax: 300_000 })).toBe(true)
  })
  it('keeps the lenient date semantics and applies hash sets', () => {
    expect(matchesFilters(photo({}), { dateFrom: '2024-01-01' })).toBe(true)
    expect(matchesFilters(photo({ takenAt: '2023-05-01' }), { dateFrom: '2024-01-01' })).toBe(false)
    expect(matchesFilters(photo({}), { favorite: true }, { favoriteHashes: new Set(['h1']) })).toBe(true)
    expect(matchesFilters(photo({}), { personId: 1 }, { personHashes: new Set(['other']) })).toBe(false)
  })
  it('color filter uses the colorHashes set (works for search post-filtering too)', () => {
    expect(hasActiveFilters({ color: 'blue' })).toBe(true)
    expect(matchesFilters(photo({}), { color: 'blue' }, { colorHashes: new Set(['h1']) })).toBe(true)
    expect(matchesFilters(photo({}), { color: 'blue' }, { colorHashes: new Set(['other']) })).toBe(false)
    expect(matchesFilters(photo({}), { color: 'blue' }, { colorHashes: new Set() })).toBe(false)
  })
})
