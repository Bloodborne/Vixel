/**
 * 设计格式（SVG / PSD / PSB / PDF / AI）的栅格化预览。
 *
 * 平台支持（watcher 据此决定要不要收这些扩展名，所以不支持的平台上它们
 * 根本不进库，也不会在任务面板里堆失败）：
 *
 *   SVG        所有平台 —— sharp 内置 librsvg；从 buffer 加载没有 base URI，
 *              外部 / 本地文件引用一律不解析（见 decode.test / design.test 的验证）
 *   PSD / PSB  所有平台 —— 纯 JS 解合成图（image/psd.ts）；macOS 上失败再走 qlmanage
 *   PDF / AI   仅 macOS —— sips 渲染第一页（AI 要求 PDF 兼容存储，临时改名 .pdf 交给 sips）；
 *              Windows / Linux 上没有不带原生 canvas 的轻量渲染器（pdfjs-dist 的渲染端
 *              需要 DOM/canvas），故不支持
 *   EPS        不支持 —— macOS 已移除 PostScript 解码（sips 报错、Quick Look 挂起）
 *
 * 预览一律在临时目录（mkdtemp）里生成再读回，从不写到原件旁边。
 */

import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import sharp from 'sharp'
import { parsePsdComposite } from './psd'

/** 栅格预览的长边：够缩略图（512）和 OCR / 人脸分析用 */
const RASTER_MAX_SIDE = 1600
/** SVG 输入字节上限：再大的基本是数据可视化导出，librsvg 渲染耗时不可控 */
const SVG_MAX_BYTES = 8 * 1024 * 1024
/** 外部命令（sips / qlmanage）超时 */
const TOOL_TIMEOUT_MS = 30_000

/** 设计格式扩展名 → 徽标文字（渲染端画角标用，与平台无关） */
export const DESIGN_BADGES: Record<string, string> = {
  '.svg': 'SVG',
  '.psd': 'PSD',
  '.psb': 'PSB',
  '.pdf': 'PDF',
  '.ai': 'AI',
}

/** 当前平台能索引的设计格式扩展名 */
export function supportedDesignExts(platform: NodeJS.Platform = process.platform): Set<string> {
  const exts = new Set(['.svg', '.psd', '.psb'])
  if (platform === 'darwin') {
    exts.add('.pdf')
    exts.add('.ai')
  }
  return exts
}

export function isDesignExt(ext: string, platform: NodeJS.Platform = process.platform): boolean {
  return supportedDesignExts(platform).has(ext.toLowerCase())
}

export interface DesignPreview {
  /** sharp 可直接消化的栅格 buffer（PNG） */
  buffer: Buffer
  /** PDF / AI：页数（快速扫描 /Type /Page 得到，拿不到就省略） */
  pages?: number
}

/** 调度入口：按扩展名栅格化；失败抛错（调用方记任务失败） */
export async function renderDesignPreview(filePath: string, ext: string, originalBuffer: Buffer): Promise<DesignPreview> {
  const e = ext.toLowerCase()
  if (e === '.svg') return { buffer: await renderSvg(originalBuffer) }
  if (e === '.psd' || e === '.psb') return { buffer: await renderPsd(filePath) }
  if (e === '.pdf' || e === '.ai') return renderPdf(filePath, e, originalBuffer)
  throw new Error(`Not a design format: ${ext}`)
}

/**
 * SVG → PNG。librsvg 从 buffer 加载时没有 base URI：外部 http(s) 引用和本地文件引用都不会
 * 被解析（实测 <image href="http://…"> 直接渲染为空，无网络请求、不阻塞）。
 * 尺寸上限：先读内在尺寸，按需提高 density 到长边 ≈ RASTER_MAX_SIDE，但不超过 10 倍。
 */
export async function renderSvg(svg: Buffer): Promise<Buffer> {
  if (svg.byteLength > SVG_MAX_BYTES) {
    throw new Error(`SVG too large (${Math.round(svg.byteLength / 1024 / 1024)} MB > ${SVG_MAX_BYTES / 1024 / 1024} MB)`)
  }
  const meta = await sharp(svg).metadata() // 72dpi 下的内在尺寸
  const long = Math.max(meta.width ?? 0, meta.height ?? 0) || 512
  const density = 72 * Math.min(10, Math.max(1, RASTER_MAX_SIDE / long))
  return sharp(svg, { density, limitInputPixels: 0x3fff * 0x3fff })
    .resize(RASTER_MAX_SIDE, RASTER_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
}

/** PSD/PSB：纯 JS 读合成图；不支持的变体（16-bit / zip / Lab）在 macOS 上走 qlmanage */
async function renderPsd(filePath: string): Promise<Buffer> {
  try {
    const composite = await parsePsdComposite(filePath)
    return await sharp(composite.data, {
      raw: { width: composite.width, height: composite.height, channels: composite.channels },
    })
      .resize(RASTER_MAX_SIDE, RASTER_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
  } catch (err) {
    if (process.platform === 'darwin') {
      try {
        return await renderWithQlmanage(filePath)
      } catch {
        throw err // 原始解析错误信息更有用
      }
    }
    throw err
  }
}

/** PDF / AI（仅 macOS）：sips 渲染第一页；AI 改名 .pdf 再交给 sips（sips 认扩展名不认内容） */
async function renderPdf(filePath: string, ext: string, originalBuffer: Buffer): Promise<DesignPreview> {
  if (process.platform !== 'darwin') {
    throw new Error(`PDF/AI preview requires macOS (got ${process.platform})`)
  }
  // AI 必须是 PDF 兼容存储（Illustrator 默认开启）；纯 PostScript 的老 .ai 不支持
  if (ext === '.ai' && originalBuffer.toString('latin1', 0, 5) !== '%PDF-') {
    throw new Error('AI file is not PDF-compatible (re-save with "Create PDF Compatible File")')
  }
  const pages = countPdfPages(originalBuffer)
  const dir = await mkdtemp(join(tmpdir(), 'vixel-design-'))
  const inPath = join(dir, 'in.pdf')
  const outPath = join(dir, 'out.png')
  try {
    await writeFile(inPath, originalBuffer)
    try {
      await runTool('sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', String(RASTER_MAX_SIDE), inPath, '--out', outPath])
      return { buffer: await readFile(outPath), ...(pages ? { pages } : {}) }
    } catch (sipsErr) {
      try {
        return { buffer: await renderWithQlmanage(inPath), ...(pages ? { pages } : {}) }
      } catch {
        throw sipsErr
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * PDF 页数：扫描 "/Type /Page"（不含 /Pages）对象个数；对线性化 / 增量更新的文件可能略多，
 * 退而求其次读 /Count。纯启发式，拿不准返回 null（界面不显示页数）。
 */
export function countPdfPages(buf: Buffer): number | null {
  const s = buf.toString('latin1')
  const typePages = s.match(/\/Type\s*\/Page[\s/>\]]/g)
  if (typePages && typePages.length > 0) return typePages.length
  let max: number | null = null
  for (const m of s.matchAll(/\/Count\s+(\d+)/g)) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > 0 && (max === null || n > max)) max = n
  }
  return max
}

/** macOS Quick Look 兜底：qlmanage -t 生成 <tmp>/<basename>.png */
async function renderWithQlmanage(filePath: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'vixel-ql-'))
  try {
    await runTool('qlmanage', ['-t', '-s', String(RASTER_MAX_SIDE), '-o', dir, filePath])
    return await readFile(join(dir, `${basename(filePath)}.png`))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function runTool(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let timedOut = false
    const killTimer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    }, TOOL_TIMEOUT_MS)
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (err) => { clearTimeout(killTimer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(killTimer)
      if (timedOut) reject(new Error(`${cmd} timed out after ${TOOL_TIMEOUT_MS}ms`))
      else if (code === 0) resolve()
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim() || 'no stderr'}`))
    })
  })
}
