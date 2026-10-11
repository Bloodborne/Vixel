/**
 * 浏览器扩展的本地服务：只监听 127.0.0.1，默认关闭（设置 → 通用 → 浏览器扩展 打开）。
 * 规则见 core/collect/serverRules.ts；这里只管监听、读请求体、回 JSON。
 * 服务从不发起对外请求 —— 图片由扩展在浏览器里取到后，把字节 POST 过来。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import type { DatabaseInstance } from '../core/db'
import {
  DEFAULT_COLLECT_PORT, MAX_BODY_BYTES, RateLimiter, parseMetaHeader, tokenMatches, validateCollectRequest,
  type CollectMeta,
} from '../core/collect/serverRules'
import type { CollectResult, CollectServerStatus } from '../shared/collect'

const KEY = {
  enabled: 'collect.server.enabled',
  port: 'collect.server.port',
  token: 'collect.server.token',
  extensionId: 'collect.server.extensionId',
} as const

type Handler = (bytes: Buffer, meta: CollectMeta) => Promise<CollectResult>

export class CollectServer {
  private server: Server | null = null
  private error: string | null = null
  private limiter = new RateLimiter(30, 1000)

  constructor(private db: DatabaseInstance, private onCollect: Handler) {}

  private get enabled(): boolean { return this.db.getMetaState(KEY.enabled) === '1' }
  private get port(): number {
    const p = Number(this.db.getMetaState(KEY.port))
    return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : DEFAULT_COLLECT_PORT
  }
  private get extensionId(): string { return this.db.getMetaState(KEY.extensionId) ?? '' }

  /** 每次安装随机生成，用户在扩展选项里粘贴一次 */
  private get token(): string {
    let tok = this.db.getMetaState(KEY.token)
    if (!tok) {
      tok = randomBytes(24).toString('base64url')
      this.db.setMetaState(KEY.token, tok)
    }
    return tok
  }

  status(): CollectServerStatus {
    return {
      enabled: this.enabled,
      running: this.server?.listening ?? false,
      port: this.port,
      token: this.token,
      extensionId: this.extensionId,
      error: this.error,
    }
  }

  async update(patch: unknown): Promise<CollectServerStatus> {
    const p = (patch ?? {}) as Partial<CollectServerStatus>
    if (typeof p.port === 'number' && Number.isInteger(p.port) && p.port >= 1024 && p.port <= 65535) this.db.setMetaState(KEY.port, String(p.port))
    if (typeof p.extensionId === 'string') {
      const id = p.extensionId.trim().toLowerCase()
      if (id === '' || /^[a-p]{32}$/.test(id)) this.db.setMetaState(KEY.extensionId, id)
    }
    if (typeof p.enabled === 'boolean') this.db.setMetaState(KEY.enabled, p.enabled ? '1' : '0')
    await this.stop()
    if (this.enabled) await this.start()
    return this.status()
  }

  async regenerateToken(): Promise<CollectServerStatus> {
    this.db.setMetaState(KEY.token, randomBytes(24).toString('base64url'))
    return this.status()
  }

  startIfEnabled(): void {
    if (this.enabled) void this.start()
  }

  private start(): Promise<void> {
    this.error = null
    return new Promise((resolve) => {
      const server = createServer((req, res) => { void this.handle(req, res) })
      server.on('error', (err: NodeJS.ErrnoException) => {
        this.error = err.code === 'EADDRINUSE' ? `port ${this.port} in use` : err.message
        console.warn('[collect] server error:', err.message)
        this.server = null
        resolve()
      })
      // 只监听回环地址：局域网里的其他机器连不上
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server
        console.log(`[collect] browser extension server on 127.0.0.1:${this.port}`)
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    const s = this.server
    this.server = null
    return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = (name: string): string | undefined => {
      const v = req.headers[name]
      return Array.isArray(v) ? v[0] : v
    }
    const origin = header('origin')
    const send = (status: number, body: unknown): void => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      // 只给扩展回 CORS 头（validate 已保证有 Origin 时一定是 chrome-extension://）
      if (origin) {
        headers['Access-Control-Allow-Origin'] = origin
        headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Vixel-Meta'
        headers['Access-Control-Allow-Methods'] = 'GET, POST'
        headers['Vary'] = 'Origin'
      }
      res.writeHead(status, headers)
      res.end(status === 204 ? undefined : JSON.stringify(body))
    }

    if (!this.limiter.take()) return send(429, { error: 'rate_limited' })
    const lengthHeader = header('content-length')
    const verdict = validateCollectRequest({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      host: header('host'),
      origin,
      authorization: header('authorization'),
      contentType: header('content-type'),
      contentLength: lengthHeader === undefined ? undefined : Number(lengthHeader),
    }, { port: this.port, token: this.token, extensionId: this.extensionId || undefined })
    if (!verdict.ok) {
      req.resume()
      return send(verdict.status, { error: verdict.code })
    }
    if (verdict.route === 'preflight') return send(204, null)
    if (verdict.route === 'ping') {
      const bearer = /^Bearer (.+)$/.exec(header('authorization') ?? '')?.[1]
      return send(200, { app: 'vixel', version: app.getVersion(), paired: tokenMatches(bearer, this.token) })
    }

    // collect：读请求体（实际字节数也不能超过上限，别信 Content-Length）
    const chunks: Buffer[] = []
    let total = 0
    let aborted = false
    try {
      for await (const chunk of req) {
        total += (chunk as Buffer).length
        if (total > MAX_BODY_BYTES) { aborted = true; break }
        chunks.push(chunk as Buffer)
      }
    } catch {
      return send(400, { error: 'read_failed' })
    }
    if (aborted) { req.destroy(); return send(413, { error: 'too_large' }) }
    try {
      const result = await this.onCollect(Buffer.concat(chunks), parseMetaHeader(header('x-vixel-meta')))
      if (result.saved === 0 && result.existing === 0) return send(422, { error: 'not_image' })
      return send(200, { status: result.saved > 0 ? 'saved' : 'exists' })
    } catch (err) {
      console.warn('[collect] save failed:', err)
      return send(500, { error: 'save_failed' })
    }
  }
}
