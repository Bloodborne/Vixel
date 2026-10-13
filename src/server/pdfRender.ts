/**
 * 服务器版 PDF / AI 栅格化：pdfjs-dist(legacy build) + @napi-rs/canvas，纯 Node、无 Electron。
 *
 * 桌面版在隐藏 BrowserWindow 里跑 pdf.js（Chromium 有真 canvas）；服务器版没有窗口，
 * 但 pdfjs-dist 的 legacy 构建在 Node 下会自动用 @napi-rs/canvas（pdfjs-dist 自带的依赖，
 * linux x64 / arm64 皆有预编译，MIT）。通过 core 的 setPdfRasterizer 注入点接入 ——
 * design.ts 的调度（macOS 走 sips 为主、其它平台走本服务）保持不变。
 *
 * 隔离度不如桌面的 sandbox 窗口（在进程内跑），所以保守设置：
 *   - useSystemFonts: false（不读宿主字体，容器里也没有；v6 已彻底移除字体 eval 路径）
 *   - cmaps / standard_fonts / wasm 全部指向本地 node_modules，运行时零网络
 *   - 一次只渲染一个（串行队列）+ 20s 超时，超时销毁加载任务
 */
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import { setPdfRasterizer, type PdfRasterResult } from '../core/image/design'

const RENDER_TIMEOUT_MS = 20_000
/** 渲染放大上限：极小的页面（名片等）不至于被放大出锯齿怪物 */
const MAX_UPSCALE = 8

// pdfjs-dist 只有 ESM 构建（.mjs）；本文件被 tsc 编译成 CommonJS。Node ≥ 22.12 的 require()
// 可以直接加载无顶层 await 的 ESM（pdf.mjs 符合）；万一不行（旧 Node）再退回 Function 构造器
// 保住真正的动态 import（直接写 import() 会被 tsc 转译成 require 而丢失语义）。
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfjsModule> | null = null

function pdfjsAssetDir(): string {
  return dirname(require.resolve('pdfjs-dist/package.json'))
}

/** pdfjs-dist + @napi-rs/canvas 是否可用（devDependencies；Docker 镜像里是正式依赖） */
export function isServerPdfAvailable(): boolean {
  try {
    require.resolve('pdfjs-dist/package.json')
    require.resolve('@napi-rs/canvas')
    return true
  } catch {
    return false
  }
}

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const entry = join(pdfjsAssetDir(), 'legacy', 'build', 'pdf.mjs')
      let raw: unknown
      try {
        raw = require(entry) // Node ≥ 22.12：require(ESM)
      } catch {
        raw = await dynamicImport(pathToFileURL(entry).href)
      }
      const ns = raw as PdfjsModule & { default?: PdfjsModule }
      return typeof ns.getDocument === 'function' ? ns : (ns.default as PdfjsModule)
    })()
  }
  return pdfjsPromise
}

async function renderFirstPage(pdfjs: PdfjsModule, bytes: Buffer, maxSide: number): Promise<PdfRasterResult> {
  const assetDir = pdfjsAssetDir()
  const loadingTask = pdfjs.getDocument({
    // pdf.js 会直接持有并可能转移这块内存：给它独立副本，别把调用方的 Buffer 掏空
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    cMapUrl: join(assetDir, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(assetDir, 'standard_fonts') + '/',
    wasmUrl: join(assetDir, 'wasm') + '/',
    iccUrl: join(assetDir, 'iccs') + '/',
    verbosity: 0, // ERRORS only
  })
  try {
    const doc = await loadingTask.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(maxSide / Math.max(base.width, base.height, 1), MAX_UPSCALE)
    const viewport = page.getViewport({ scale })
    const canvasFactory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(mime: 'image/png'): Buffer; width: number; height: number }; context: object }; destroy(c: unknown): void } }).canvasFactory
    const target = canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
    try {
      await page.render({ canvas: target.canvas as never, canvasContext: target.context as never, viewport }).promise
      const png = target.canvas.toBuffer('image/png')
      return { png, pages: doc.numPages }
    } finally {
      canvasFactory.destroy(target)
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy().catch(() => {})
  }
}

/** 串行队列：上一个渲染（无论成败）结束后才开始下一个 */
let chain: Promise<unknown> = Promise.resolve()

function enqueue(bytes: Buffer, maxSide: number): Promise<PdfRasterResult> {
  const job = chain.then(
    async () => {
      const pdfjs = await loadPdfjs()
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`PDF render timed out after ${RENDER_TIMEOUT_MS}ms`)), RENDER_TIMEOUT_MS)
      })
      try {
        return await Promise.race([renderFirstPage(pdfjs, bytes, maxSide), timeout])
      } finally {
        clearTimeout(timer)
      }
    }
  )
  chain = job.catch(() => {})
  return job
}

/**
 * 注册服务器版 pdf.js 栅格化服务。依赖缺失（源码运行但没装 devDependencies）时返回 false，
 * 调用方应 restrictDesignExts 把 .pdf/.ai 从支持格式里拿掉。
 */
export function registerServerPdfRenderer(): boolean {
  if (!isServerPdfAvailable()) return false
  setPdfRasterizer((bytes, maxSide) => enqueue(bytes, maxSide))
  return true
}
