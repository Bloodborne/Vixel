import { describe, it, expect } from 'vitest'
import { sanitizeStem, splitName, monthDir, uniqueFileName, sniffImageExt, extFromMime, stemFromUrl, pastedStem, isHttpUrl } from './paths'
import { validateCollectRequest, parseMetaHeader, RateLimiter, originAllowed, type CollectRequestInfo } from './serverRules'

describe('sanitizeStem', () => {
  it('keeps normal names, including CJK', () => {
    expect(sanitizeStem('海边日落 2024')).toBe('海边日落 2024')
  })
  it('drops path components and traversal', () => {
    expect(sanitizeStem('../../etc/passwd')).toBe('passwd')
    expect(sanitizeStem('C:\\Users\\a\\photo')).toBe('photo')
  })
  it('replaces characters invalid on Windows and strips control chars', () => {
    expect(sanitizeStem('a<b>c:d"e|f?g*h\u0001')).toBe('a_b_c_d_e_f_g_h')
  })
  it('trims dots / spaces and avoids reserved device names', () => {
    expect(sanitizeStem('  .hidden.  ')).toBe('hidden')
    expect(sanitizeStem('CON')).toBe('_CON')
    expect(sanitizeStem('...')).toBe('image')
    expect(sanitizeStem('', 'pasted')).toBe('pasted')
  })
  it('truncates very long names', () => {
    expect(Array.from(sanitizeStem('长'.repeat(300))).length).toBe(100)
  })
})

describe('layout helpers', () => {
  it('splits names', () => {
    expect(splitName('a.b.JPG')).toEqual({ stem: 'a.b', ext: 'jpg' })
    expect(splitName('.bashrc')).toEqual({ stem: '.bashrc', ext: '' })
    expect(splitName('noext')).toEqual({ stem: 'noext', ext: '' })
  })
  it('month dir is YYYY/MM', () => {
    expect(monthDir(new Date(2026, 0, 5))).toBe('2026/01')
    expect(monthDir(new Date(2026, 10, 30))).toBe('2026/11')
  })
  it('never overwrites: appends (2), (3)…', () => {
    const taken = new Set(['a.jpg', 'a (2).jpg'])
    expect(uniqueFileName('a', 'jpg', (n) => taken.has(n))).toBe('a (3).jpg')
    expect(uniqueFileName('b', 'png', (n) => taken.has(n))).toBe('b.png')
  })
  it('derives names from URLs and pastes', () => {
    expect(stemFromUrl('https://cdn.example.com/img/%E6%B5%B7%E8%BE%B9.jpg?w=800')).toBe('海边')
    expect(stemFromUrl('https://example.com/')).toBeNull()
    expect(stemFromUrl('not a url')).toBeNull()
    expect(pastedStem(new Date(2026, 9, 11, 9, 5, 7))).toBe('Pasted 2026-10-11 09.05.07')
  })
  it('only http(s) URLs pass', () => {
    expect(isHttpUrl('https://a.com/x.png')).toBe(true)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl(42)).toBe(false)
  })
})

describe('sniffImageExt', () => {
  const bytes = (...xs: Array<number | string>): Uint8Array => {
    const out: number[] = []
    for (const x of xs) typeof x === 'string' ? out.push(...Array.from(x, (c) => c.charCodeAt(0))) : out.push(x)
    while (out.length < 16) out.push(0)
    return Uint8Array.from(out)
  }
  it('recognizes common formats by magic bytes', () => {
    expect(sniffImageExt(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpg')
    expect(sniffImageExt(bytes(0x89, 'PNG', 0x0d, 0x0a))).toBe('png')
    expect(sniffImageExt(bytes('GIF89a'))).toBe('gif')
    expect(sniffImageExt(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('webp')
    expect(sniffImageExt(bytes(0, 0, 0, 0x1c, 'ftypavif'))).toBe('avif')
    expect(sniffImageExt(bytes(0, 0, 0, 0x18, 'ftypheic'))).toBe('heic')
  })
  it('rejects non-images (HTML error pages, executables)', () => {
    expect(sniffImageExt(bytes('<!DOCTYPE html>'))).toBeNull()
    expect(sniffImageExt(bytes(0xcf, 0xfa, 0xed, 0xfe))).toBeNull()
    expect(sniffImageExt(new Uint8Array(4))).toBeNull()
  })
  it('maps MIME types', () => {
    expect(extFromMime('image/jpeg; charset=binary')).toBe('jpg')
    expect(extFromMime('text/html')).toBeNull()
  })
})

describe('validateCollectRequest', () => {
  const cfg = { port: 41720, token: 'secret-token-123' }
  const base: CollectRequestInfo = {
    method: 'POST', path: '/v1/collect', host: '127.0.0.1:41720', origin: undefined,
    authorization: 'Bearer secret-token-123', contentType: 'image/png', contentLength: 1000,
  }
  const ext = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

  it('accepts a valid collect request from the extension or a local client', () => {
    expect(validateCollectRequest(base, cfg)).toEqual({ ok: true, route: 'collect' })
    expect(validateCollectRequest({ ...base, origin: ext }, cfg)).toEqual({ ok: true, route: 'collect' })
  })
  it('rejects web pages and DNS rebinding', () => {
    expect(validateCollectRequest({ ...base, origin: 'https://evil.example' }, cfg)).toMatchObject({ ok: false, status: 403 })
    expect(validateCollectRequest({ ...base, origin: 'null' }, cfg)).toMatchObject({ ok: false, status: 403 })
    expect(validateCollectRequest({ ...base, host: 'evil.example:41720' }, cfg)).toMatchObject({ ok: false, status: 421 })
  })
  it('pins a configured extension id', () => {
    expect(originAllowed(ext, 'abcdefghijklmnopabcdefghijklmnop')).toBe(true)
    expect(originAllowed(ext, 'pppppppppppppppppppppppppppppppp')).toBe(false)
  })
  it('requires the token', () => {
    expect(validateCollectRequest({ ...base, authorization: undefined }, cfg)).toMatchObject({ status: 401 })
    expect(validateCollectRequest({ ...base, authorization: 'Bearer wrong' }, cfg)).toMatchObject({ status: 401 })
  })
  it('only accepts images within the size limit', () => {
    expect(validateCollectRequest({ ...base, contentType: 'text/html' }, cfg)).toMatchObject({ status: 415 })
    expect(validateCollectRequest({ ...base, contentLength: undefined }, cfg)).toMatchObject({ status: 411 })
    expect(validateCollectRequest({ ...base, contentLength: 60 * 1024 * 1024 }, cfg)).toMatchObject({ status: 413 })
  })
  it('ping works without a token; unknown paths 404', () => {
    expect(validateCollectRequest({ ...base, method: 'GET', path: '/v1/ping', authorization: undefined }, cfg)).toEqual({ ok: true, route: 'ping' })
    expect(validateCollectRequest({ ...base, path: '/v1/other' }, cfg)).toMatchObject({ status: 404 })
  })
})

describe('parseMetaHeader / RateLimiter', () => {
  it('parses base64url JSON and drops junk', () => {
    const v = Buffer.from(JSON.stringify({ url: 'https://a.com/x.jpg', pageTitle: 'T', tags: ['a', '', 3, 'b'], extra: 1 })).toString('base64url')
    expect(parseMetaHeader(v)).toEqual({ url: 'https://a.com/x.jpg', pageUrl: undefined, pageTitle: 'T', name: undefined, tags: ['a', 'b'] })
    expect(parseMetaHeader('%%%')).toEqual({})
    expect(parseMetaHeader(undefined)).toEqual({})
  })
  it('limits bursts and refills over time', () => {
    let now = 0
    const rl = new RateLimiter(2, 1000, () => now)
    expect(rl.take()).toBe(true)
    expect(rl.take()).toBe(true)
    expect(rl.take()).toBe(false)
    now += 1000
    expect(rl.take()).toBe(true)
  })
})
