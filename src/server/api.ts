/**
 * HTTP JSON API：POST /api/<method>，body 为 { args: [...] }（与 window.api 方法的参数一一对应），
 * 响应 { ok: true, result } / { ok: false, error }。
 * 分发表直接由服务层 services.api 扁平化生成（嵌套组用点号：tags.list），
 * 与 preload `Api` 的覆盖关系由 apiSurface.ts + 契约测试锁定，不会漂移。
 */
import type { VixelApi } from '../services/api'
import { isDesktopOnlyMethod } from './apiSurface'

export type ApiMethod = (...args: unknown[]) => Promise<unknown> | unknown

/** 把 services.api 扁平化成 `name` / `group.name` → 函数 的分发表 */
export function flattenApiMethods(api: Record<string, unknown>, prefix = ''): Map<string, ApiMethod> {
  const out = new Map<string, ApiMethod>()
  for (const [key, value] of Object.entries(api)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'function') {
      out.set(name, value as ApiMethod)
    } else if (value && typeof value === 'object') {
      for (const [n, fn] of flattenApiMethods(value as Record<string, unknown>, name)) out.set(n, fn)
    }
  }
  return out
}

export type ApiCallOutcome =
  | { status: 200; body: { ok: true; result: unknown } }
  | { status: 400 | 404 | 500 | 501; body: { ok: false; error: string; method?: string } }

export class ApiDispatcher {
  private table: Map<string, ApiMethod>

  constructor(api: VixelApi) {
    this.table = flattenApiMethods(api as unknown as Record<string, unknown>)
  }

  methods(): string[] {
    return [...this.table.keys()]
  }

  async call(method: string, args: unknown[]): Promise<ApiCallOutcome> {
    const fn = this.table.get(method)
    if (!fn) {
      if (isDesktopOnlyMethod(method)) {
        return { status: 501, body: { ok: false, error: `"${method}" is desktop-only and not available on the server edition`, method } }
      }
      return { status: 404, body: { ok: false, error: `Unknown API method: ${method}`, method } }
    }
    if (!Array.isArray(args)) {
      return { status: 400, body: { ok: false, error: 'Request body must be {"args": [...]}' } }
    }
    try {
      const result = await fn(...args)
      return { status: 200, body: { ok: true, result: result === undefined ? null : result } }
    } catch (err) {
      console.error(`[api] ${method} failed:`, err)
      return { status: 500, body: { ok: false, error: err instanceof Error ? err.message : String(err) } }
    }
  }
}
