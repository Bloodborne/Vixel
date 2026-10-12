/**
 * PDF 渲染隐藏窗口的 preload：只暴露三个方法（收任务 / 回结果 / 页面就绪），
 * 不透出 ipcRenderer 本体。沙箱 + contextIsolation 下运行。
 */
import { contextBridge, ipcRenderer } from 'electron'

export interface PdfRenderJob {
  id: number
  maxSide: number
  bytes: Uint8Array
}

export interface PdfRenderReply {
  id: number
  ok: boolean
  error?: string
  png?: Uint8Array
  pages?: number
}

const api = {
  onJob: (cb: (job: PdfRenderJob) => void): void => {
    ipcRenderer.on('pdf-render:job', (_event, job: PdfRenderJob) => cb(job))
  },
  done: (reply: PdfRenderReply): void => {
    ipcRenderer.send('pdf-render:done', reply)
  },
  ready: (): void => {
    ipcRenderer.send('pdf-render:ready')
  },
}

export type VixelPdfApi = typeof api

contextBridge.exposeInMainWorld('vixelPdf', api)
