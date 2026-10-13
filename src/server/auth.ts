/**
 * 单用户认证：口令 → HttpOnly / SameSite=Strict 会话 cookie。
 *
 * 会话是无状态签名令牌：`v1.<过期毫秒>.<随机 nonce>.<HMAC>`。
 * 签名密钥随机生成并持久化在 <dataDir>/server-secret（0600）——重启后已登录的浏览器不掉线；
 * 删除该文件即吊销所有会话。
 *
 * 登录限速：按来源 IP 的固定窗口计数（连续失败才计数，成功清零），防口令爆破。
 * CSRF：所有 POST 必须带自定义头 X-Vixel: 1（浏览器跨站发不出自定义头 —— 服务器不回任何 CORS 头，
 * 预检必然失败），cookie 又是 SameSite=Strict，双保险。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export const SESSION_COOKIE = 'vixel_session'
/** 会话有效期：30 天（NAS 上的常用窗口不至于每天登一次） */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function loadOrCreateSecret(dataDir: string): Buffer {
  const file = join(dataDir, 'server-secret')
  if (existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  }
  const secret = randomBytes(32)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, secret.toString('hex') + '\n', { mode: 0o600 })
  return secret
}

export class SessionManager {
  constructor(private secret: Buffer, private now: () => number = Date.now) {}

  private hmac(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url')
  }

  /** 签发一个会话令牌（cookie 值） */
  issue(ttlMs: number = SESSION_TTL_MS): string {
    const expires = this.now() + ttlMs
    const nonce = randomBytes(16).toString('base64url')
    const payload = `v1.${expires}.${nonce}`
    return `${payload}.${this.hmac(payload)}`
  }

  /** 验证令牌：签名有效且未过期 */
  verify(token: string | undefined | null): boolean {
    if (!token) return false
    const m = /^(v1\.(\d{1,16})\.([A-Za-z0-9_-]{1,64}))\.([A-Za-z0-9_-]{1,64})$/.exec(token)
    if (!m) return false
    const [, payload, expires, , mac] = m
    const expect = this.hmac(payload)
    const a = Buffer.from(mac)
    const b = Buffer.from(expect)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false
    return Number(expires) > this.now()
  }
}

/** 口令比较：常数时间（先 HMAC 到定长再比，长度差异不泄露） */
export function passwordMatches(secret: Buffer, expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || provided.length > 1024) return false
  const h = (s: string): Buffer => createHmac('sha256', secret).update(s).digest()
  return timingSafeEqual(h(expected), h(provided))
}

/**
 * 登录限速：每个 IP 在 windowMs 内最多 maxAttempts 次失败；超了之后整窗拒绝。
 * 登录成功清零。内存实现（单进程、单用户场景足够）。
 */
export class LoginRateLimiter {
  private failures = new Map<string, { count: number; windowStart: number }>()

  constructor(
    private maxAttempts = 5,
    private windowMs = 15 * 60 * 1000,
    private now: () => number = Date.now
  ) {}

  /** 这次登录尝试是否被拒（true = 已限速，直接 429，不验口令） */
  isLimited(ip: string): boolean {
    const rec = this.failures.get(ip)
    if (!rec) return false
    if (this.now() - rec.windowStart >= this.windowMs) {
      this.failures.delete(ip)
      return false
    }
    return rec.count >= this.maxAttempts
  }

  recordFailure(ip: string): void {
    const now = this.now()
    const rec = this.failures.get(ip)
    if (!rec || now - rec.windowStart >= this.windowMs) {
      this.failures.set(ip, { count: 1, windowStart: now })
    } else {
      rec.count++
    }
    // 防内存涨：超过 10k 个 IP 时清掉过期窗口
    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) if (now - v.windowStart >= this.windowMs) this.failures.delete(k)
    }
  }

  recordSuccess(ip: string): void {
    this.failures.delete(ip)
  }
}
