/**
 * 服务层事件总线：服务函数只负责 emit，宿主决定怎么送达 ——
 *   桌面（src/main/index.ts）→ BrowserWindow.webContents.send（原有 IPC 事件频道）
 *   服务器（src/server）    → WebSocket 广播
 * 频道名与 renderer 订阅的 window.api.on* 一一对应（见 src/server/apiSurface.ts 的 EVENT_METHODS）。
 */

export type ServiceEventChannel =
  | 'library-changed'
  | 'smart-albums-changed'
  | 'index-progress'
  | 'people-changed'
  | 'tags-changed'
  | 'autotags-changed'
  | 'cleanup-progress'

export interface ServiceEvents {
  emit(channel: ServiceEventChannel, payload?: unknown): void
}

/** 简易实现：多个订阅者（宿主注册），emit 同步分发 */
export function createServiceEvents(): ServiceEvents & { on(fn: (channel: ServiceEventChannel, payload?: unknown) => void): () => void } {
  const subs = new Set<(channel: ServiceEventChannel, payload?: unknown) => void>()
  return {
    emit(channel, payload) {
      for (const fn of subs) {
        try { fn(channel, payload) } catch (err) { console.warn('[events] subscriber failed:', err) }
      }
    },
    on(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}
