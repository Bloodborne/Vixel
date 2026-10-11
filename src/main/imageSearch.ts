/**
 * 以图搜图（主进程侧）：把查询输入（路径 / 字节 / 库内 hash）变成查询向量，交给 SearchEngine.searchByImage。
 *
 * 隐私：查询图只在内存和临时文件里处理 —— 粘贴 / 浏览器拖入的字节落一个临时文件给 decodeImage
 * （HEIC/RAW 需要走 sips），用完立刻删除；不写缩略图、不进资料库、不留任何记录。
 */

import { mkdtemp, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import xxhash from 'xxhash-wasm'
import type { DatabaseInstance } from '../core/db'
import type { SearchEngine } from '../core/search'
import { decodeImage } from '../core/image/decode'
import { getEmbeddingService } from '../core/embedding'
import type { ImageQueryInput, ImageSearchResponse, MediaFilters } from '../shared/types'

// 与 indexer / watcher 同款内容 hash（xxhash64 hex）：查询图和库里内容同字节时才能对上
let _hasher: ((data: Uint8Array) => string) | null = null
async function contentHash(data: Uint8Array): Promise<string> {
  if (!_hasher) {
    const h = await xxhash()
    _hasher = (d) => h.h64Raw(d).toString(16).padStart(16, '0')
  }
  return _hasher(data)
}

/** 粘贴 / 拖入字节的扩展名嗅探：只影响 decodeImage 的 sips 兜底白名单（HEIC），其余交给 sharp */
function sniffExt(buf: Buffer): string {
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12)
    if (/^(heic|heix|hevc|mif1|msf1|heif)/.test(brand)) return '.heic'
  }
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return '.png'
  return '.jpg'
}

/** 查询图芯片用的小缩略图（内存里生成，不落盘） */
async function queryThumb(image: Buffer): Promise<string | undefined> {
  try {
    const jpeg = await sharp(image).resize(96, 96, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer()
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch {
    return undefined
  }
}

export async function searchByImage(
  db: DatabaseInstance,
  engine: SearchEngine,
  input: ImageQueryInput,
  limit?: number,
  filters?: MediaFilters
): Promise<ImageSearchResponse> {
  const fail = (error: 'decode-failed' | 'model-not-ready'): ImageSearchResponse =>
    ({ results: [], queryInLibrary: false, error })
  const text = typeof input?.text === 'string' && input.text.trim() ? input.text.trim() : undefined

  // 1) 解码 + 内容 hash（库内 hash 查询跳过解码，除非要和文字一起重新编码）
  let image: Buffer | null = null
  let excludeHash: string | null = null
  try {
    if (typeof input?.fileHash === 'string' && input.fileHash) {
      excludeHash = input.fileHash
      const photo = db.getRepresentativeByHash(input.fileHash)
      // 纯图查询直接用已存向量（下面第 2 步），带文字才需要原图重新多模态编码
      if (text || !db.getImageVecByHash(input.fileHash)) {
        if (!photo || !existsSync(photo.filePath)) return fail('decode-failed')
        image = (await decodeImage(photo.filePath)).buffer
      } else if (photo && existsSync(photo.filePath)) {
        image = (await decodeImage(photo.filePath)).buffer // 只为缩略图；失败不致命
      }
    } else if (typeof input?.path === 'string' && input.path) {
      if (!existsSync(input.path)) return fail('decode-failed')
      const decoded = await decodeImage(input.path)
      image = decoded.buffer
      excludeHash = await contentHash(decoded.originalBuffer)
    } else if (input?.bytes && input.bytes.byteLength > 0) {
      // 结构化克隆后是 Uint8Array；HEIC 等要走 sips，落临时文件、用完即删
      const buf = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes)
      const dir = await mkdtemp(join(tmpdir(), 'vixel-imgq-'))
      try {
        const p = join(dir, `q${sniffExt(buf)}`)
        await writeFile(p, buf)
        image = (await decodeImage(p)).buffer
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
      excludeHash = await contentHash(buf)
    } else {
      return fail('decode-failed')
    }
  } catch (err) {
    console.warn('[imagesearch] decode failed:', err)
    return fail('decode-failed')
  }

  // 2) 编码：库内 hash 且无文字 → 直接用已存向量；否则过模型（urgent：插到索引批次前面）
  let queryVec: Float32Array | null = null
  if (!text && excludeHash && typeof input?.fileHash === 'string') {
    queryVec = db.getImageVecByHash(input.fileHash)
  }
  if (!queryVec) {
    if (!image) return fail('decode-failed')
    try {
      const svc = getEmbeddingService()
      queryVec = text
        ? await svc.encode({ type: 'multimodal', text, image, urgent: true })
        : await svc.encode({ type: 'image', content: image, urgent: true })
    } catch (err) {
      console.warn('[imagesearch] encode failed:', err)
      return fail('model-not-ready')
    }
  }

  const { results, queryInLibrary } = engine.searchByImage(queryVec, {
    limit,
    filters,
    excludeHash,
    mixed: !!text,
  })
  return { results, queryInLibrary, queryThumb: image ? await queryThumb(image) : undefined }
}
