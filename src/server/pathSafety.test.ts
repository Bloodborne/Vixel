import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isPathInside, resolveInsideRoots } from './pathSafety'

function makeFixture(): { root: string; library: string; data: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'vixel-pathsafety-'))
  const library = join(root, 'library')
  const data = join(root, 'data')
  const outside = join(root, 'outside')
  for (const d of [library, data, outside, join(library, 'sub')]) mkdirSync(d, { recursive: true })
  writeFileSync(join(library, 'sub', 'photo.jpg'), 'x')
  writeFileSync(join(data, 'thumbnails.webp'), 'x')
  writeFileSync(join(outside, 'secret.txt'), 'top secret')
  return { root, library, data, outside }
}

describe('isPathInside', () => {
  it('accepts children and the root itself, rejects siblings and parents', () => {
    expect(isPathInside('/a/b', '/a/b/c.jpg')).toBe(true)
    expect(isPathInside('/a/b', '/a/b')).toBe(true)
    expect(isPathInside('/a/b', '/a/bc/c.jpg')).toBe(false) // 前缀相似但不同目录
    expect(isPathInside('/a/b', '/a')).toBe(false)
    expect(isPathInside('/a/b', '/other')).toBe(false)
  })
  it('normalizes .. segments', () => {
    expect(isPathInside('/a/b', '/a/b/c/../../b/d.jpg')).toBe(true)
    expect(isPathInside('/a/b', '/a/b/../outside/x.jpg')).toBe(false)
  })
})

describe('resolveInsideRoots', () => {
  it('allows a registered file inside a library root', async () => {
    const f = makeFixture()
    const p = await resolveInsideRoots(join(f.library, 'sub', 'photo.jpg'), [f.library, f.data])
    expect(p).toBe(realpathSync(join(f.library, 'sub', 'photo.jpg')))
  })

  it('allows generated assets inside the data dir', async () => {
    const f = makeFixture()
    expect(await resolveInsideRoots(join(f.data, 'thumbnails.webp'), [f.library, f.data])).not.toBeNull()
  })

  it('rejects ../ traversal out of the roots', async () => {
    const f = makeFixture()
    expect(await resolveInsideRoots(join(f.library, '..', 'outside', 'secret.txt'), [f.library, f.data])).toBeNull()
  })

  it('rejects URL-encoded traversal once decoded by the HTTP layer', async () => {
    const f = makeFixture()
    // 路由层 decodeURIComponent 后得到的就是这种字符串
    const decoded = decodeURIComponent(encodeURIComponent(join(f.library, '..', 'outside', 'secret.txt')))
    expect(await resolveInsideRoots(decoded, [f.library, f.data])).toBeNull()
  })

  it('rejects absolute paths outside all roots', async () => {
    const f = makeFixture()
    expect(await resolveInsideRoots(join(f.outside, 'secret.txt'), [f.library, f.data])).toBeNull()
    expect(await resolveInsideRoots('/etc/hosts', [f.library, f.data])).toBeNull()
  })

  it('rejects symlink escapes (symlink inside library pointing outside)', async () => {
    const f = makeFixture()
    const link = join(f.library, 'sub', 'sneaky.jpg')
    symlinkSync(join(f.outside, 'secret.txt'), link)
    expect(await resolveInsideRoots(link, [f.library, f.data])).toBeNull()
  })

  it('rejects missing files and empty input', async () => {
    const f = makeFixture()
    expect(await resolveInsideRoots(join(f.library, 'nope.jpg'), [f.library])).toBeNull()
    expect(await resolveInsideRoots('', [f.library])).toBeNull()
  })

  it('follows symlinked roots (data dir on a symlinked volume still works)', async () => {
    const f = makeFixture()
    const linkRoot = join(f.root, 'data-link')
    symlinkSync(f.data, linkRoot)
    expect(await resolveInsideRoots(join(linkRoot, 'thumbnails.webp'), [linkRoot])).not.toBeNull()
  })
})
