/**
 * 浏览器扩展本地服务的请求校验（纯函数，便于单测）。服务只监听 127.0.0.1，且默认关闭。
 *
 * 防线：
 *   1. Host 必须是 127.0.0.1 / localhost:<端口> —— 挡 DNS rebinding（恶意网页把自己的域名解析到 127.0.0.1）
 *   2. 有 Origin 时必须是 chrome-extension://（设置了扩展 id 时必须正好是它）—— 网页发起的请求一定带
 *      自己的 Origin（或 "null"），直接拒；没有 Origin 的是本机进程（curl 等），本来就有本机权限，仍要令牌
 *   3. 收集接口必须带正确的令牌（每次安装随机生成，用户在扩展选项里粘贴一次），恒定时间比较
 *   4. 只收 image/*，必须有 Content-Length，上限 MAX_BODY_BYTES；字节内容写盘前再按文件头识别一次
 *   5. 简单的令牌桶限速
 * 服务从不发起任何对外请求：图片由扩展在浏览器里自己取，再把字节交给 Vixel。
 */
import { timingSafeEqual } from 'crypto'

export const DEFAULT_COLLECT_PORT = 41720
/** 单张图上限 */
export const MAX_BODY_BYTES = 50 * 1024 * 1024
/** 附带的元数据（来源 URL、标题、标签）放在 X-Vixel-Meta 头里，base64url(JSON)，上限 */
export const MAX_META_BYTES = 8 * 1024

export type CollectRoute = 'ping' | 'collect' | 'preflight'

export interface CollectRequestInfo {
  method: string
  path: string
  host: string | undefined
  origin: string | undefined
  authorization: string | undefined
  contentType: string | undefined
  contentLength: number | undefined
}

export interface CollectServerConfig {
  port: number
  token: string
  /** 只放行这个扩展 id（chrome-extension://<id>）；空 = 任何扩展 */
  extensionId?: string
}

export type ValidationResult =
  | { ok: true; route: CollectRoute }
  | { ok: false; status: number; code: string }

const fail = (status: number, code: string): ValidationResult => ({ ok: false, status, code })

export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function originAllowed(origin: string | undefined, extensionId?: string): boolean {
  if (origin === undefined) return true
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)
  if (!m) return false
  return !extensionId || m[1] === extensionId
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

export function validateCollectRequest(req: CollectRequestInfo, cfg: CollectServerConfig): ValidationResult {
  if (!hostAllowed(req.host, cfg.port)) return fail(421, 'bad_host')
  if (!originAllowed(req.origin, cfg.extensionId)) return fail(403, 'bad_origin')
  const path = req.path.split('?')[0]
  if (req.method === 'OPTIONS') return { ok: true, route: 'preflight' }
  if (path === '/v1/ping') {
    return req.method === 'GET' ? { ok: true, route: 'ping' } : fail(405, 'method')
  }
  if (path !== '/v1/collect') return fail(404, 'not_found')
  if (req.method !== 'POST') return fail(405, 'method')
  const bearer = /^Bearer (.+)$/.exec(req.authorization ?? '')?.[1]
  if (!tokenMatches(bearer, cfg.token)) return fail(401, 'bad_token')
  if (!/^image\/[a-z0-9.+-]+$/i.test((req.contentType ?? '').split(';')[0].trim())) return fail(415, 'not_image')
  if (req.contentLength === undefined || !Number.isFinite(req.contentLength) || req.contentLength <= 0) return fail(411, 'length_required')
  if (req.contentLength > MAX_BODY_BYTES) return fail(413, 'too_large')
  return { ok: true, route: 'collect' }
}

export interface CollectMeta {
  url?: string
  pageUrl?: string
  pageTitle?: string
  name?: string
  tags?: string[]
}

/** 解析 X-Vixel-Meta（base64url JSON）；格式不对就当没有，字段逐个校验、截断 */
export function parseMetaHeader(value: string | undefined): CollectMeta {
  if (!value || value.length > MAX_META_BYTES * 2) return {}
  try {
    const raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 64)).slice(0, 20)
      : undefined
    return {
      url: str(raw.url, 4096),
      pageUrl: str(raw.pageUrl, 4096),
      pageTitle: str(raw.pageTitle, 300),
      name: str(raw.name, 200),
      ...(tags && tags.length > 0 ? { tags } : {}),
    }
  } catch {
    return {}
  }
}

/** 令牌桶：capacity 个突发，之后每 refillMs 补一个 */
export class RateLimiter {
  private tokens: number
  private last: number
  constructor(private capacity = 30, private refillMs = 1000, private now: () => number = Date.now) {
    this.tokens = capacity
    this.last = now()
  }
  take(): boolean {
    const t = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.last) / this.refillMs)
    this.last = t
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}
