/**
 * 层级 2 · 接口契约：网页版 API 必须覆盖 preload `Api`（window.api）的每个成员 ——
 * 要么在服务器实现（IMPLEMENTED_METHODS），要么显式标记桌面专属 / 事件 / 属性。
 *
 * 类型层面（tsc，`npm run typecheck` 会检查本文件）：
 *   - Api 的每个展开方法名 ∈ 四个清单之并集（新增 IPC 方法而没归类 → 编译错误，报出方法名）
 *   - 清单里没有 Api 之外的多余项
 *   - 服务层实现的方法参数与 preload 签名相容
 * 运行时（vitest）：HTTP 分发表（由 services.api 扁平化生成）与 IMPLEMENTED_METHODS 完全一致。
 */
import { describe, it, expect } from 'vitest'
import type { Api } from '../preload'
import type { VixelApi } from '../services/api'
import { createServices } from '../services/api'
import { createServiceEvents } from '../services/events'
import { IMPLEMENTED_METHODS, DESKTOP_ONLY_METHODS, EVENT_METHODS, SPECIAL_PROPS } from './apiSurface'
import { flattenApiMethods } from './api'

// ─── 类型层契约 ─────────────────────────────────────────────────────────────

/** 把嵌套 API 展开成点号方法名：'search' | 'tags.list' | ... */
type FlatKeys<T> = {
  [K in keyof T & string]: T[K] extends (...args: never[]) => unknown
    ? K
    : T[K] extends object
      ? `${K}.${FlatKeys<T[K]>}`
      : K
}[keyof T & string]

type AllApiMembers = FlatKeys<Api>
type Declared =
  | (typeof IMPLEMENTED_METHODS)[number]
  | (typeof DESKTOP_ONLY_METHODS)[number]
  | (typeof EVENT_METHODS)[number]
  | (typeof SPECIAL_PROPS)[number]

type ExpectNever<T extends never> = T
// Api 里有、四个清单里都没有的方法：这里编译失败并在错误里报出方法名
type _missingFromSurface = ExpectNever<Exclude<AllApiMembers, Declared>>
// 清单里有、Api 里不存在的：拼错 / 方法已删除时在这里编译失败
type _unknownInSurface = ExpectNever<Exclude<Declared, AllApiMembers>>

/** 服务层方法必须能按 preload 的参数调用（参数类型相容；返回值一致性由层级 3 评测锁定） */
type AcceptsArgsOf<P> = {
  [K in keyof P]: P[K] extends (...args: infer A) => unknown ? (...args: A) => unknown : unknown
}
type Groups = 'tags' | 'cleanup' | 'autoTags' | 'collect'
// 仅类型检查用，永不调用（声明值在运行时不存在）
function _argCompat(vixelApi: VixelApi): void {
  const _topArgs: AcceptsArgsOf<Omit<Pick<Api, keyof VixelApi & keyof Api>, Groups>> = vixelApi
  const _tagArgs: AcceptsArgsOf<Pick<Api['tags'], keyof VixelApi['tags'] & keyof Api['tags']>> = vixelApi.tags
  const _cleanupArgs: AcceptsArgsOf<Pick<Api['cleanup'], keyof VixelApi['cleanup'] & keyof Api['cleanup']>> = vixelApi.cleanup
  const _autoTagArgs: AcceptsArgsOf<Pick<Api['autoTags'], keyof VixelApi['autoTags'] & keyof Api['autoTags']>> = vixelApi.autoTags
  const _collectArgs: AcceptsArgsOf<Pick<Api['collect'], keyof VixelApi['collect'] & keyof Api['collect']>> = vixelApi.collect
  void [_topArgs, _tagArgs, _cleanupArgs, _autoTagArgs, _collectArgs]
}
void _argCompat

// ─── 运行时契约 ─────────────────────────────────────────────────────────────

/** 万能 stub：createServices 构造时会 prepare SQL 语句、建 store —— 这里只要形状，不要真库 */
function anyStub(): unknown {
  const fn = (): unknown => anyStub()
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => 'stub'
      return anyStub()
    },
    apply: () => anyStub(),
  })
}

function makeServices() {
  return createServices({
    db: anyStub() as never,
    watcher: anyStub() as never,
    indexer: anyStub() as never,
    searchEngine: anyStub() as never,
    dataDir: '/tmp/vixel-contract-test',
    modelsDir: '/tmp/vixel-contract-test/models',
    events: createServiceEvents(),
  })
}

describe('web API surface contract', () => {
  it('HTTP dispatch table (flattened services.api) matches IMPLEMENTED_METHODS exactly', () => {
    const services = makeServices()
    const dispatch = [...flattenApiMethods(services.api as unknown as Record<string, unknown>).keys()].sort()
    expect(dispatch).toEqual([...IMPLEMENTED_METHODS].sort())
  })

  it('implemented / desktop-only / event / special lists do not overlap', () => {
    const all = [...IMPLEMENTED_METHODS, ...DESKTOP_ONLY_METHODS, ...EVENT_METHODS, ...SPECIAL_PROPS]
    expect(new Set(all).size).toBe(all.length)
  })
})
