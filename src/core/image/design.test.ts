import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { readFile } from 'fs/promises'
import sharp from 'sharp'
import { countPdfPages, renderDesignPreview, renderSvg, supportedDesignExts, isDesignExt, setPdfRasterizer, DESIGN_BADGES } from './design'

// vitest 从仓库根运行；tsconfig.cli 也会编译测试文件，避免 import.meta
const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'design')

describe('platform support matrix', () => {
  it('SVG / PSD / PSB / PDF / AI are supported everywhere (PDF/AI via sips on macOS, pdf.js elsewhere)', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const exts = supportedDesignExts(platform)
      expect(exts.has('.svg')).toBe(true)
      expect(exts.has('.psd')).toBe(true)
      expect(exts.has('.psb')).toBe(true)
      expect(exts.has('.pdf')).toBe(true)
      expect(exts.has('.ai')).toBe(true)
    }
  })

  it('EPS is supported nowhere (Ghostscript is AGPL and nobody has it installed)', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(supportedDesignExts(platform).has('.eps')).toBe(false)
    }
  })

  it('isDesignExt is case-insensitive', () => {
    expect(isDesignExt('.SVG', 'linux')).toBe(true)
    expect(isDesignExt('.Psd', 'win32')).toBe(true)
    expect(isDesignExt('.jpg', 'darwin')).toBe(false)
  })

  it('every badge extension exists', () => {
    expect(Object.keys(DESIGN_BADGES).sort()).toEqual(['.ai', '.pdf', '.psb', '.psd', '.svg'])
  })
})

describe('renderSvg', () => {
  it('rasterizes an SVG at its aspect ratio', async () => {
    const svg = await readFile(join(FIXTURES, 'poster.svg'))
    const png = await renderSvg(svg)
    const meta = await sharp(png).metadata()
    // 480×320 → 长边放大到 1600
    expect(meta.width).toBe(1600)
    expect(Math.abs((meta.height ?? 0) - 1067)).toBeLessThanOrEqual(1)
  })

  it('does not fetch external/local refs and renders fast (offline promise)', async () => {
    const svg = await readFile(join(FIXTURES, 'external-ref.svg'))
    const t0 = Date.now()
    const png = await renderSvg(svg)
    // 外部 <image href="http://…"> 指向必拒绝的端口：若真发请求会卡到超时；librsvg 直接忽略
    expect(Date.now() - t0).toBeLessThan(5000)
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    // 底部 25% 的绿色矩形照常渲染
    const y = Math.floor(info.height * 0.9)
    const o = (y * info.width + Math.floor(info.width / 2)) * info.channels
    expect(data[o + 1]).toBeGreaterThan(120) // G
    expect(data[o]).toBeLessThan(80)         // R
    // 外部图片区域（上半）没有被画上任何内容（alpha 0）
    const top = (Math.floor(info.height * 0.2) * info.width + Math.floor(info.width / 2)) * info.channels
    if (info.channels === 4) expect(data[top + 3]).toBe(0)
  })

  it('rejects oversized SVG input', async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 0x20)
    await expect(renderSvg(big)).rejects.toThrow(/too large/)
  })
})

describe('renderDesignPreview', () => {
  it('renders PSD composite via the pure-JS parser', async () => {
    const path = join(FIXTURES, 'merged-raw.psd')
    const { buffer } = await renderDesignPreview(path, '.psd', await readFile(path))
    const meta = await sharp(buffer).metadata()
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(48)
  })

  const darwinIt = process.platform === 'darwin' ? it : it.skip
  darwinIt('renders first PDF page via sips and reports page count (macOS)', async () => {
    const path = join(FIXTURES, 'brochure.pdf')
    const { buffer, pages } = await renderDesignPreview(path, '.pdf', await readFile(path))
    expect(pages).toBe(3)
    const meta = await sharp(buffer).metadata()
    expect((meta.width ?? 0)).toBeGreaterThan(100)
  })

  darwinIt('renders a PDF-compatible .ai via sips (macOS)', async () => {
    const path = join(FIXTURES, 'artwork.ai')
    const { buffer, pages } = await renderDesignPreview(path, '.ai', await readFile(path))
    expect(pages).toBe(1)
    const meta = await sharp(buffer).metadata()
    expect((meta.width ?? 0)).toBeGreaterThan(100)
  })

  it('rejects a non-PDF-compatible .ai', async () => {
    await expect(renderDesignPreview('/tmp/x.ai', '.ai', Buffer.from('%!PS-Adobe old ai')))
      .rejects.toThrow(/PDF/i)
  })
})

describe('pdf.js rasterizer service hook', () => {
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  afterEach(() => {
    setPdfRasterizer(null)
    delete process.env.VIXEL_PDF_RENDERER
  })

  it('VIXEL_PDF_RENDERER=pdfjs forces the service and prefers its exact numPages', async () => {
    process.env.VIXEL_PDF_RENDERER = 'pdfjs'
    const calls: Array<{ bytes: number; maxSide: number }> = []
    setPdfRasterizer(async (bytes, maxSide) => {
      calls.push({ bytes: bytes.length, maxSide })
      return { png: PNG_1PX, pages: 5 } // 启发式扫 brochure.pdf 是 3，服务的 numPages 必须优先
    })
    const pdf = await readFile(join(FIXTURES, 'brochure.pdf'))
    const { buffer, pages } = await renderDesignPreview(join(FIXTURES, 'brochure.pdf'), '.pdf', pdf)
    expect(buffer.equals(PNG_1PX)).toBe(true)
    expect(pages).toBe(5)
    expect(calls).toEqual([{ bytes: pdf.length, maxSide: 1600 }])
  })

  it('falls back to the heuristic page count when the service reports none', async () => {
    process.env.VIXEL_PDF_RENDERER = 'pdfjs'
    setPdfRasterizer(async () => ({ png: PNG_1PX }))
    const pdf = await readFile(join(FIXTURES, 'brochure.pdf'))
    const { pages } = await renderDesignPreview(join(FIXTURES, 'brochure.pdf'), '.pdf', pdf)
    expect(pages).toBe(3)
  })

  it('reports a clear error when the service is required but not registered', async () => {
    process.env.VIXEL_PDF_RENDERER = 'pdfjs' // 等价于跑在 win32/linux：没有 sips 可用
    const pdf = await readFile(join(FIXTURES, 'brochure.pdf'))
    await expect(renderDesignPreview(join(FIXTURES, 'brochure.pdf'), '.pdf', pdf))
      .rejects.toThrow(/PDF preview service unavailable/)
  })

  it('still rejects a non-PDF-compatible .ai before calling the service', async () => {
    process.env.VIXEL_PDF_RENDERER = 'pdfjs'
    let called = false
    setPdfRasterizer(async () => { called = true; return { png: PNG_1PX, pages: 1 } })
    await expect(renderDesignPreview('/tmp/x.ai', '.ai', Buffer.from('%!PS-Adobe old ai')))
      .rejects.toThrow(/PDF/i)
    expect(called).toBe(false)
  })

  it('a PDF-compatible .ai goes through the service as-is (no rename dance)', async () => {
    process.env.VIXEL_PDF_RENDERER = 'pdfjs'
    setPdfRasterizer(async () => ({ png: PNG_1PX, pages: 1 }))
    const ai = await readFile(join(FIXTURES, 'artwork.ai'))
    const { buffer, pages } = await renderDesignPreview(join(FIXTURES, 'artwork.ai'), '.ai', ai)
    expect(buffer.equals(PNG_1PX)).toBe(true)
    expect(pages).toBe(1)
  })
})

describe('countPdfPages', () => {
  it('counts pages in the fixture', async () => {
    expect(countPdfPages(await readFile(join(FIXTURES, 'brochure.pdf')))).toBe(3)
  })
  it('falls back to /Count when no page objects are visible', () => {
    expect(countPdfPages(Buffer.from('<< /Type /Pages /Count 7 >> compressed...'))).toBe(7)
  })
  it('returns null when nothing is found', () => {
    expect(countPdfPages(Buffer.from('not a pdf'))).toBeNull()
  })
})
