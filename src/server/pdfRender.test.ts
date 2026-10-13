/**
 * 服务器版 pdf.js 栅格化（pdfRender.ts）：真渲染 tests/fixtures/design 的 PDF / AI，
 * 走 core 的 renderDesignPreview 调度（VIXEL_PDF_RENDERER=pdfjs 强制 pdf.js 路径，
 * 等价于 Linux 容器里的主路径）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import { renderDesignPreview, setPdfRasterizer } from '../core/image/design'
import { registerServerPdfRenderer, isServerPdfAvailable } from './pdfRender'

const FIXTURES = join(__dirname, '../../tests/fixtures/design')

describe('server pdf renderer (pdfjs-dist + @napi-rs/canvas)', () => {
  const prevRenderer = process.env.VIXEL_PDF_RENDERER
  beforeAll(() => {
    process.env.VIXEL_PDF_RENDERER = 'pdfjs'
    expect(isServerPdfAvailable()).toBe(true)
    expect(registerServerPdfRenderer()).toBe(true)
  })
  afterAll(() => {
    if (prevRenderer === undefined) delete process.env.VIXEL_PDF_RENDERER
    else process.env.VIXEL_PDF_RENDERER = prevRenderer
    setPdfRasterizer(null)
  })

  it('renders the first page of a PDF with exact page count', async () => {
    const pdf = await readFile(join(FIXTURES, 'brochure.pdf'))
    const { buffer, pages } = await renderDesignPreview(join(FIXTURES, 'brochure.pdf'), '.pdf', pdf)
    expect(pages).toBe(3)
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe('png')
    // 长边应被放大到 RASTER_MAX_SIDE（1600）
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600)
    // 第一页是红色矩形：中心像素接近 #d82f2f（见 fixtures 生成脚本）
    const { data } = await sharp(buffer).extract({
      left: Math.floor((meta.width ?? 2) / 2), top: Math.floor((meta.height ?? 2) / 2), width: 1, height: 1,
    }).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(150) // R
    expect(data[1]).toBeLessThan(100) // G
  }, 30000)

  it('renders a PDF-compatible .ai', async () => {
    const ai = await readFile(join(FIXTURES, 'artwork.ai'))
    const { buffer, pages } = await renderDesignPreview(join(FIXTURES, 'artwork.ai'), '.ai', ai)
    expect(pages).toBe(1)
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe('png')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600)
  }, 30000)

  it('rejects garbage bytes instead of hanging', async () => {
    await expect(renderDesignPreview('/nope/garbage.pdf', '.pdf', Buffer.from('%PDF-not really a pdf')))
      .rejects.toThrow()
  }, 30000)

  it('serialises concurrent renders (no interleaved canvas state)', async () => {
    const pdf = await readFile(join(FIXTURES, 'brochure.pdf'))
    const results = await Promise.all([
      renderDesignPreview(join(FIXTURES, 'brochure.pdf'), '.pdf', pdf),
      renderDesignPreview(join(FIXTURES, 'brochure.pdf'), '.pdf', pdf),
    ])
    for (const r of results) expect(r.pages).toBe(3)
  }, 60000)
})
