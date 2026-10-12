/**
 * 隐藏窗口里的 pdf.js 渲染页（见 src/main/pdfRender.ts 的隔离说明）。
 *
 * - worker 以 fake-worker 方式打进同一个 bundle（side-effect import 设
 *   globalThis.pdfjsWorker），运行时零文件加载、零网络
 * - cmaps / standard_fonts / wasm / iccs 走本地协议 vixel-pdf://assets/
 *   （主进程白名单校验后从打包资源读取）
 * - 一次只处理一个任务（主进程已串行化），渲染第一页到 canvas，回传 PNG 字节 + 页数
 */
// legacy build：modern build 用到 Uint8Array.prototype.toHex（Chrome 140+），
// Electron 33 的 Chromium 130 还没有；legacy 构建带 core-js 垫片
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
// fake worker：worker 模块顶层会设置 globalThis.pdfjsWorker，pdf.js 检测到后在本线程跑解析
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'

interface PdfRenderJob { id: number; maxSide: number; bytes: Uint8Array }
interface PdfRenderReply { id: number; ok: boolean; error?: string; png?: Uint8Array; pages?: number }

declare global {
  interface Window {
    vixelPdf: {
      onJob: (cb: (job: PdfRenderJob) => void) => void
      done: (reply: PdfRenderReply) => void
      ready: () => void
    }
  }
}

const ASSETS = 'vixel-pdf://assets/'

async function renderFirstPage(bytes: Uint8Array, maxSide: number): Promise<{ png: Uint8Array; pages: number }> {
  const task = getDocument({
    data: bytes,
    // 全部指向本地资源协议；没有任何 http(s) 可达路径（CSP 也再拦一道）
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    useSystemFonts: false,
    disableAutoFetch: true,
  })
  const doc = await task.promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(10, Math.max(0.05, maxSide / Math.max(base.width, base.height)))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    // intent 'print'：一次画完，不走渐进式 rAF 调度（隐藏窗口里更稳）
    await page.render({
      canvas,
      canvasContext: canvas.getContext('2d', { alpha: false })!,
      viewport,
      intent: 'print',
      background: '#ffffff', // PDF 透明处应是纸白
    }).promise
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/png'))
    return { png: new Uint8Array(await blob.arrayBuffer()), pages: doc.numPages }
  } finally {
    await task.destroy().catch(() => {})
  }
}

window.vixelPdf.onJob(async (job) => {
  try {
    const { png, pages } = await renderFirstPage(job.bytes, job.maxSide)
    window.vixelPdf.done({ id: job.id, ok: true, png, pages })
  } catch (err) {
    window.vixelPdf.done({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

window.vixelPdf.ready()
