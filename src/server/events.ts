/**
 * WebSocket 事件通道（与 HTTP 同端口，路径 /events）：
 * renderer 经 window.api.on* 订阅的所有事件在这里推送，消息格式
 *   { channel: 'index-progress' | 'library-changed' | ..., payload }
 * 升级请求必须带有效会话 cookie，否则 401 拒绝。
 */
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocketServer, WebSocket } from 'ws'
import type { SessionManager } from './auth'
import { SESSION_COOKIE } from './auth'
import { parseCookies } from './http'
import type { ServiceEventChannel } from '../services/events'

export interface EventHub {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  broadcast(channel: ServiceEventChannel, payload?: unknown): void
  clientCount(): number
  close(): void
}

export function createEventHub(sessions: SessionManager, requireAuth: boolean): EventHub {
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<WebSocket>()

  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
    // 单向推送通道：收到的消息一律忽略（界面不经 WS 发指令，都走 HTTP API）
  })

  return {
    handleUpgrade(req, socket, head) {
      const url = req.url ?? ''
      if (url !== '/events' && !url.startsWith('/events?')) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }
      if (requireAuth) {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
        if (!sessions.verify(token)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
          socket.destroy()
          return
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    },

    broadcast(channel, payload) {
      if (clients.size === 0) return
      const msg = JSON.stringify({ channel, payload: payload ?? null })
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg, () => {})
      }
    },

    clientCount: () => clients.size,

    close() {
      for (const ws of clients) ws.terminate()
      wss.close()
    },
  }
}
