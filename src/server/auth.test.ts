import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { mkdtempSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, LoginRateLimiter, passwordMatches, loadOrCreateSecret, SESSION_TTL_MS } from './auth'

const secret = randomBytes(32)

describe('passwordMatches', () => {
  it('accepts the correct password', () => {
    expect(passwordMatches(secret, 'hunter22', 'hunter22')).toBe(true)
  })
  it('rejects wrong / empty / non-string / oversized passwords', () => {
    expect(passwordMatches(secret, 'hunter22', 'hunter23')).toBe(false)
    expect(passwordMatches(secret, 'hunter22', '')).toBe(false)
    expect(passwordMatches(secret, 'hunter22', undefined)).toBe(false)
    expect(passwordMatches(secret, 'hunter22', 42)).toBe(false)
    expect(passwordMatches(secret, 'hunter22', 'x'.repeat(2000))).toBe(false)
  })
  it('rejects prefixes and extensions (no length leak shortcut)', () => {
    expect(passwordMatches(secret, 'hunter22', 'hunter2')).toBe(false)
    expect(passwordMatches(secret, 'hunter22', 'hunter222')).toBe(false)
  })
})

describe('SessionManager cookie signing', () => {
  it('verifies a token it issued', () => {
    const sm = new SessionManager(secret)
    expect(sm.verify(sm.issue())).toBe(true)
  })
  it('rejects garbage, empty and malformed tokens', () => {
    const sm = new SessionManager(secret)
    expect(sm.verify(undefined)).toBe(false)
    expect(sm.verify('')).toBe(false)
    expect(sm.verify('v1.123.abc')).toBe(false)
    expect(sm.verify('not-a-token')).toBe(false)
  })
  it('rejects a token with tampered expiry or signature', () => {
    const sm = new SessionManager(secret)
    const token = sm.issue()
    const [v, exp, nonce, mac] = token.split('.')
    expect(sm.verify(`${v}.${Number(exp) + 9999999}.${nonce}.${mac}`)).toBe(false)
    expect(sm.verify(`${v}.${exp}.${nonce}.${mac.slice(0, -2)}xx`)).toBe(false)
  })
  it('rejects tokens signed with a different secret', () => {
    const other = new SessionManager(randomBytes(32))
    const sm = new SessionManager(secret)
    expect(sm.verify(other.issue())).toBe(false)
  })
  it('expires: token valid before TTL, invalid after', () => {
    let now = 1_000_000_000_000
    const sm = new SessionManager(secret, () => now)
    const token = sm.issue()
    now += SESSION_TTL_MS - 1000
    expect(sm.verify(token)).toBe(true)
    now += 2000
    expect(sm.verify(token)).toBe(false)
  })
})

describe('LoginRateLimiter', () => {
  it('limits after maxAttempts failures within the window', () => {
    let now = 0
    const rl = new LoginRateLimiter(5, 15 * 60 * 1000, () => now)
    for (let i = 0; i < 5; i++) {
      expect(rl.isLimited('1.2.3.4')).toBe(false)
      rl.recordFailure('1.2.3.4')
    }
    expect(rl.isLimited('1.2.3.4')).toBe(true)
    // 其他 IP 不受影响
    expect(rl.isLimited('5.6.7.8')).toBe(false)
  })
  it('unlocks after the window passes', () => {
    let now = 0
    const rl = new LoginRateLimiter(3, 1000, () => now)
    for (let i = 0; i < 3; i++) rl.recordFailure('a')
    expect(rl.isLimited('a')).toBe(true)
    now = 1001
    expect(rl.isLimited('a')).toBe(false)
  })
  it('successful login clears the failure count', () => {
    const rl = new LoginRateLimiter(3, 1000, () => 0)
    rl.recordFailure('a')
    rl.recordFailure('a')
    rl.recordSuccess('a')
    rl.recordFailure('a')
    expect(rl.isLimited('a')).toBe(false)
  })
})

describe('loadOrCreateSecret', () => {
  it('creates a 32-byte secret with 0600 and reloads the same value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vixel-auth-test-'))
    const a = loadOrCreateSecret(dir)
    expect(a.length).toBe(32)
    const b = loadOrCreateSecret(dir)
    expect(b.equals(a)).toBe(true)
    expect(/^[0-9a-f]{64}$/.test(readFileSync(join(dir, 'server-secret'), 'utf8').trim())).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'server-secret')).mode & 0o777).toBe(0o600)
    }
  })
})
