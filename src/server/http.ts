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

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}
