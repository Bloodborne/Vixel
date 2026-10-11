import { describe, expect, it } from 'vitest'
import { eagleItemDir, eagleLibraryName, itemTagNames, originalFileName, parseFolderPaths, parseItem } from './eagle'
import { matchTagNames, normalizeTagName } from './tagStore'
import { intersectTagHashes } from './filters'

// 按 Eagle 4.0 实际写出的结构（metadata.json / images/<ID>.info/metadata.json），见 docs/review/08-eagle-library-format.md
const LIBRARY_META = {
  applicationVersion: '4.0.0',
  folders: [
    {
      id: 'MV3JM9KHM1S5U', name: '自然素材', description: '', modificationTime: 1, tags: [], password: '', passwordTips: '',
      children: [{ id: 'MV3JMAC9HRJ4U', name: '花卉', description: '', children: [], modificationTime: 1, tags: [] }],
    },
    { id: 'MV3JMB41RBCL0', name: 'City Walk', description: '', children: [], modificationTime: 1, tags: [] },
  ],
  smartFolders: [],
  quickAccess: [],
  tagsGroups: [{ id: 'X', name: '颜色', tags: ['pink'], color: 'red' }],
  modificationTime: 1,
}

const ITEM = {
  id: 'MV3JMBVTQ0WK3', name: '粉色仙客来', size: 74969, btime: 1, mtime: 1, ext: 'jpg',
  tags: ['花卉', 'pink', ''], folders: ['MV3JMAC9HRJ4U', 'missing-folder'], isDeleted: false,
  url: '', annotation: '温室里拍的仙客来', modificationTime: 1, width: 512, height: 848, star: 5, palettes: [], lastModified: 1,
}

describe('Eagle library format', () => {
  it('builds folder paths from the nested tree', () => {
    const paths = parseFolderPaths(LIBRARY_META)
    expect(paths.get('MV3JM9KHM1S5U')).toBe('自然素材')
    expect(paths.get('MV3JMAC9HRJ4U')).toBe('自然素材/花卉')
    expect(paths.get('MV3JMB41RBCL0')).toBe('City Walk')
    expect(parseFolderPaths({ nope: true }).size).toBe(0)
  })

  it('parses item metadata defensively', () => {
    const item = parseItem(ITEM)!
    expect(item).toMatchObject({ id: 'MV3JMBVTQ0WK3', name: '粉色仙客来', ext: 'jpg', star: 5, isDeleted: false })
    expect(item.tags).toEqual(['花卉', 'pink'])
    expect(originalFileName(item)).toBe('粉色仙客来.jpg')
    expect(parseItem({ ...ITEM, ext: '' })).toBeNull()
    expect(parseItem({ name: 'x', ext: 'jpg' })).toBeNull()
    expect(parseItem({ ...ITEM, star: 9, isDeleted: true })).toMatchObject({ star: 5, isDeleted: true })
  })

  it('maps tags and folder paths to Vixel tag names (deduped, case-insensitive)', () => {
    const names = itemTagNames(parseItem({ ...ITEM, tags: ['花卉', 'Pink', 'pink'] })!, parseFolderPaths(LIBRARY_META))
    expect(names).toEqual(['花卉', 'pink', '自然素材/花卉'])
  })

  it('recognises item directories and library names', () => {
    expect(eagleItemDir('/x/a.library/images/MV3JMBVTQ0WK3.info/粉色仙客来.jpg')).toBe('/x/a.library/images/MV3JMBVTQ0WK3.info')
    expect(eagleItemDir('/x/a.library/images/MV3JMBVTQ0WK3.info/sub/x.jpg')).toBeNull()
    expect(eagleItemDir('/photos/2024/IMG_1.jpg')).toBeNull()
    expect(eagleLibraryName('/Users/me/设计素材.library/')).toBe('设计素材')
  })
})

describe('tag matching', () => {
  const names = ['花卉', 'Pink', 'pinkish', 'street', 'bar']
  it('scores exact > prefix > token', () => {
    expect(matchTagNames('pink', ['pink'], names)).toEqual(new Map([['Pink', 3], ['pinkish', 2]]))
    expect(matchTagNames('花卉照片', ['花卉', '照片'], names)).toEqual(new Map([['花卉', 1]]))
    // 分词不可用（jieba 退回原文）时，中文标签名出现在查询里也算命中
    expect(matchTagNames('花卉照片', ['花卉照片'], names)).toEqual(new Map([['花卉', 1]]))
    expect(matchTagNames('barcelona', ['barcelona'], names).size).toBe(0)
    expect(matchTagNames('night street', ['night', 'street'], names).get('street')).toBe(1)
    // 1 个字母的词不做前缀匹配，避免 "a" 命中一堆
    expect(matchTagNames('a bar', ['a', 'bar'], names)).toEqual(new Map([['bar', 1]]))
    expect(matchTagNames('  ', [], names).size).toBe(0)
  })

  it('normalises names', () => {
    expect(normalizeTagName('  Blue   sky ')).toBe('Blue sky')
    expect(normalizeTagName('x'.repeat(100)).length).toBe(80)
  })
})

describe('tag filter (AND)', () => {
  it('intersects per-tag hash sets', () => {
    expect(intersectTagHashes([])).toBeNull()
    expect([...intersectTagHashes([new Set(['a', 'b', 'c']), new Set(['b', 'c']), new Set(['c', 'd'])])!]).toEqual(['c'])
  })
})
