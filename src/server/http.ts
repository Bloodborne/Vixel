/**
 * 极小的 HTTP 工具集（不引框架）：JSON / 原始 body 读取（带大小上限）、cookie 解析、JSON 响应、
 * 以及把 Web Response（core/media/serve.ts 产出）落到 Node 的 ServerResponse 上。
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { Readable } from 'stream'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** 读取请求体（原始字节），超过 limit 直接断开并抛 413 */
export function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new HttpError(413, `Request body exceeds ${limit} bytes`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function readJsonBody<T = unknown>(req: IncomingMessage, limit = 10 * 1024 * 1024): Promise<T> {
  const raw = await readRawBody(req, limit)
  if (raw.length === 0) return {} as T
  try {
    return JSON.parse(raw.toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body ?? null)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    // API 响应都是动态的
    'Cache-Control': 'no-store',
  })
  res.end(data)
}

/** 把 Web Response（手写 Range 的 serveMediaFile 等）落到 Node 响应上 */
export async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string> = {}
  webRes.headers.forEach((v, k) => { headers[k] = v })
  res.writeHead(webRes.status, headers)
  if (!webRes.body) {
    res.end()
    return
  }
  const nodeStream = Readable.fromWeb(webRes.body as import('stream/web').ReadableStream<Uint8Array>)
  nodeStream.pipe(res)
  nodeStream.on('error', () => res.destroy())
  // 客户端中断（视频 seek 时浏览器频繁断开 Range 请求）：别让 ReadStream 挂着
  res.on('close', () => nodeStream.destroy())
}

/**
 * 客户端 IP（登录限速用）。trustProxy 时取 X-Forwarded-For 最左侧条目（最初的客户端；
 * 只有反代在前面时才可信 —— 直连时该头可伪造，所以默认不看）。
 */
export function clientIp(req: IncomingMessage, trustProxy = false): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for']
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/**
 * Accept-Language → 按 q 值排好的语言标签（`zh-CN,zh;q=0.9,en;q=0.8` → ['zh-CN', 'zh', 'en']）。
 * 服务器没有"系统语言"，界面语言设为"跟随系统"时用发请求的浏览器的语言。
 */
export function acceptLanguages(header: string | string[] | undefined): string[] {
  const raw = Array.isArray(header) ? header.join(',') : header
  if (!raw) return []
  return raw
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, i }
    })
    .filter((x) => x.tag && x.tag !== '*' && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag)
}
