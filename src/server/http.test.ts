import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'http'
import { clientIp, parseCookies } from './http'

const fakeReq = (headers: Record<string, string | string[]>, remote = '10.0.0.9'): IncomingMessage =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage

describe('clientIp', () => {
  it('uses the socket address by default, even when X-Forwarded-For is present', () => {
    expect(clientIp(fakeReq({}))).toBe('10.0.0.9')
    expect(clientIp(fakeReq({ 'x-forwarded-for': '1.2.3.4' }))).toBe('10.0.0.9')
  })

  it('with trustProxy takes the leftmost X-Forwarded-For entry', () => {
    expect(clientIp(fakeReq({ 'x-forwarded-for': '1.2.3.4' }), true)).toBe('1.2.3.4')
    expect(clientIp(fakeReq({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), true)).toBe('1.2.3.4')
    expect(clientIp(fakeReq({ 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] }), true)).toBe('1.2.3.4')
  })

  it('with trustProxy but no header falls back to the socket address', () => {
    expect(clientIp(fakeReq({}), true)).toBe('10.0.0.9')
    expect(clientIp(fakeReq({ 'x-forwarded-for': ' ' }), true)).toBe('10.0.0.9')
  })
})

describe('parseCookies', () => {
  it('parses multiple cookies and ignores malformed parts', () => {
    expect(parseCookies('a=1; b=2; bogus; =x')).toEqual({ a: '1', b: '2' })
    expect(parseCookies(undefined)).toEqual({})
  })
})
