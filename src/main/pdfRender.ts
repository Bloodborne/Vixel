/**
 * PDF / PDF 兼容 AI 的 pdf.js 栅格化服务（Windows / Linux 的主路径，macOS 的兜底）。
 *
 * 纯 Node 下 pdfjs-dist 渲染不了（没有 canvas），所以学 Eagle 的做法：在一个隐藏的
 * BrowserWindow 里跑 pdf.js —— Chromium 有真 canvas。窗口完全隔离：
 *
 *   - sandbox + contextIsolation，无 node integration；preload 只暴露 job/done 三个方法
 *   - 页面 CSP default-src 'none'，连不了任何 http(s)；enforceOfflinePolicy（defaultSession）
 *     同样罩着这个窗口
 *   - PDF 字节由主进程读好后经 IPC 传入（页面从不碰磁盘路径）
 *   - pdf.js 的 worker 以“fake worker”方式打进同一个 bundle，运行时不加载任何文件
 *   - cmaps（CJK 文字必需）/ standard_fonts / wasm（JPX、JBIG2、ICC）打包为本地资源，
 *     经自定义协议 vixel-pdf://assets/ 提供（file:// 页面 fetch 不了 file:，自定义
 *     standard scheme 是 Electron 的正规解法）
 *
 * 可靠性：请求串行（一次一个）、20s 超时、渲染进程崩溃 / 挂起时销毁重建窗口、
 * 空闲 60s 后销毁窗口释放内存。
 */

import { BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { setPdfRasterizer, type PdfRasterResult } from '../core/image/design'

export const PDF_ASSET_SCHEME = 'vixel-pdf'

const RENDER_TIMEOUT_MS = 20_000
const PAGE_READY_TIMEOUT_MS = 20_000
const IDLE_DESTROY_MS = 60_000

/** 页面只能取这三类 pdfjs-dist 静态资源；文件名白名单校验，杜绝路径穿越 */
const ASSET_DIRS = new Set(['cmaps', 'standard_fonts', 'wasm', 'iccs'])
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

interface JobReply {
  id: number
  ok: boolean
  error?: string
  png?: Uint8Array
  pages?: number
}

let win: BrowserWindow | null = null
let winReady: Promise<BrowserWindow> | null = null
let readyResolve: (() => void) | null = null
let idleTimer: NodeJS.Timeout | null = null
let chain: Promise<unknown> = Promise.resolve()
let nextId = 1
const pending = new Map<number, { resolve: (r: PdfRasterResult) => void; reject: (e: Error) => void }>()

/**
 * pdfjs-dist 静态资源根目录：
 * 打包后 electron.vite.config.ts 的 copy 插件把 cmaps 等拷进 out/renderer（asar 内，
 * net.fetch(file://) 能读）；开发时直接用 node_modules 里的原件。
 */
function assetRoot(): string {
  const bundled = join(__dirname, '../renderer')
  if (existsSync(join(bundled, 'cmaps'))) return bundled
  return join(process.cwd(), 'node_modules', 'pdfjs-dist')
}

/** app ready 之后调用：注册资源协议 + IPC + 把栅格化函数注入 core/image/design */
export function registerPdfRenderer(): void {
  protocol.handle(PDF_ASSET_SCHEME, async (request) => {
    const headers = { 'Access-Control-Allow-Origin': '*' } // 页面在 file://（打包）或 dev server（开发）origin 上
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)
      if (url.host !== 'assets' || parts.length !== 2 || !ASSET_DIRS.has(parts[0]) || !ASSET_NAME.test(parts[1])) {
        return new Response('not found', { status: 404, headers })
      }
      const res = await net.fetch(pathToFileURL(join(assetRoot(), parts[0], parts[1])).toString())
      const h = new Headers(res.headers)
      h.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, headers: h })
    } catch (err) {
      return new Response(String(err), { status: 500, headers })
    }
  })

  ipcMain.on('pdf-render:ready', (event) => {
    if (win && event.sender === win.webContents) readyResolve?.()
  })

  ipcMain.on('pdf-render:done', (event, reply: JobReply) => {
    if (!win || event.sender !== win.webContents) return
    const job = pending.get(reply?.id)
    if (!job) return
    pending.delete(reply.id)
    if (reply.ok && reply.png) {
      job.resolve({ png: Buffer.from(reply.png), ...(reply.pages ? { pages: reply.pages } : {}) })
    } else {
      job.reject(new Error(reply.error || 'pdf.js render failed'))
    }
  })

  setPdfRasterizer(rasterize)
}

/** 退出前调用：注销服务并销毁隐藏窗口 */
export function disposePdfRenderer(): void {
  setPdfRasterizer(null)
  failAllPending(new Error('app quitting'))
  destroyWindow()
}

/**
 * 用户窗口（主窗口 / 设置）关闭时调用：只剩隐藏渲染窗口时把它也销毁。
 * 不这样做的话 'window-all-closed' 永远不触发，Windows / Linux 上应用退不掉。
 */
export function releasePdfWindowIfLast(): void {
  if (!win) return
  const others = BrowserWindow.getAllWindows().filter((w) => w !== win && !w.isDestroyed())
  if (others.length === 0) destroyWindow()
}

/** 串行化入口：一次只渲染一个，后来的排队（隐藏窗口是单线程 fake worker） */
function rasterize(bytes: Buffer, maxSide: number): Promise<PdfRasterResult> {
  const job = chain.then(() => runJob(bytes, maxSide))
  chain = job.catch(() => {}) // 失败不打断队列
  return job
}

async function runJob(bytes: Buffer, maxSide: number): Promise<PdfRasterResult> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  const w = await ensureWindow()
  try {
    return await new Promise<PdfRasterResult>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        // 挂起的渲染进程不可信（可能在死循环里），直接销毁，下个请求重建
        destroyWindow()
        reject(new Error(`pdf.js render timed out after ${RENDER_TIMEOUT_MS}ms`))
      }, RENDER_TIMEOUT_MS)
      pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      w.webContents.send('pdf-render:job', { id, maxSide, bytes })
    })
  } finally {
    scheduleIdleDestroy()
  }
}

async function ensureWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed() && !winReady) return win
  if (winReady) return winReady
  winReady = createWindow().finally(() => { winReady = null })
  return winReady
}

async function createWindow(): Promise<BrowserWindow> {
  const w = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      preload: join(__dirname, '../preload/pdf.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 隐藏窗口的 rAF / 定时器默认被 Chromium 节流，渲染会卡死在第一帧
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  win = w
  w.webContents.on('render-process-gone', (_e, details) => {
    failAllPending(new Error(`pdf.js renderer process gone: ${details.reason}`))
    destroyWindow()
  })

  const ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('pdf.js renderer page did not become ready')), PAGE_READY_TIMEOUT_MS)
    readyResolve = () => { clearTimeout(t); resolve() }
  })

  // 与主窗口同一套入口规则：开发走 electron-vite dev server，打包走 out/renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pdf.html`)
  } else {
    void w.loadFile(join(__dirname, '../renderer/pdf.html'))
  }

  try {
    await ready
  } catch (err) {
    destroyWindow()
    throw err
  } finally {
    readyResolve = null
  }
  return w
}

function failAllPending(err: Error): void {
  for (const [, job] of pending) job.reject(err)
  pending.clear()
}

function scheduleIdleDestroy(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (pending.size === 0) destroyWindow()
  }, IDLE_DESTROY_MS)
}

function destroyWindow(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  const w = win
  win = null
  if (w && !w.isDestroyed()) w.destroy()
}
