/**
 * 收集箱的纯函数部分（无 IO，便于单测）：文件名清洗、按年月分目录、按文件头识别图片类型。
 *
 * 收集箱就是一个普通的监视文件夹（默认 ~/Pictures/Vixel Inbox），收进来的文件放在
 * YYYY/MM/<清洗后的文件名>.<ext>；同名不覆盖，追加 " (2)"、" (3)"…
 */

/** 收集箱接受的图片类型（扩展名不带点）。和 watcher 支持的图片格式取交集里最常见的几种 */
export type CollectImageExt = 'jpg' | 'png' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'avif' | 'heic'

const MIME_EXT: Record<string, CollectImageExt> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heic',
}

export function extFromMime(mime: string | null | undefined): CollectImageExt | null {
  if (!mime) return null
  return MIME_EXT[mime.split(';')[0].trim().toLowerCase()] ?? null
}

/**
 * 按文件头识别图片类型。不信任 Content-Type / 扩展名：收进来的字节是什么就存成什么，
 * 不是认识的图片一律拒收（防止把 HTML 错误页、可执行文件之类写进图库）。
 */
export function sniffImageExt(buf: Uint8Array): CollectImageExt | null {
  const at = (i: number): number => buf[i] ?? -1
  const ascii = (from: number, to: number): string => String.fromCharCode(...buf.subarray(from, to))
  if (buf.length < 12) return null
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg'
  if (at(0) === 0x89 && ascii(1, 4) === 'PNG') return 'png'
  if (ascii(0, 4) === 'GIF8') return 'gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (ascii(0, 2) === 'BM') return 'bmp'
  if ((ascii(0, 4) === 'II*\u0000') || (at(0) === 0x4d && at(1) === 0x4d && at(2) === 0 && at(3) === 0x2a)) return 'tiff'
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic'
  }
  return null
}

/** Windows 保留设备名（不区分大小写，带不带扩展名都不行） */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** 文件名主干最多这么多个字符（不含扩展名）；macOS / Windows 单个文件名上限都是 255 */
const MAX_STEM = 100

/**
 * 清洗成安全的文件名主干（不含扩展名）：去掉路径分隔符、控制字符、各平台不允许的字符，
 * 去掉首尾的点和空格，避开 Windows 保留名，过长截断；清完为空时用 fallback。
 */
export function sanitizeStem(raw: string | null | undefined, fallback = 'image'): string {
  let s = (raw ?? '').normalize('NFC')
  // 只取最后一段（防 ../../ 之类）
  s = s.split(/[\\/]/).pop() ?? ''
  s = s
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const chars = Array.from(s)
  if (chars.length > MAX_STEM) s = chars.slice(0, MAX_STEM).join('').replace(/[.\s]+$/g, '')
  if (!s || WIN_RESERVED.test(s)) s = s ? `_${s}` : fallback
  return s
}

/** 把"名字.扩展名"拆开；扩展名统一小写、不带点 */
export function splitName(name: string): { stem: string; ext: string } {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return { stem: base, ext: '' }
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() }
}

/** 收进来的日期子目录：YYYY/MM（本地时间） */
export function monthDir(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 在目录里给 stem.ext 找一个不冲突的文件名：name.ext → name (2).ext → name (3).ext …
 * exists 由调用方注入（真实实现查磁盘）。
 */
export function uniqueFileName(stem: string, ext: string, exists: (fileName: string) => boolean): string {
  const withExt = (s: string): string => (ext ? `${s}.${ext}` : s)
  if (!exists(withExt(stem))) return withExt(stem)
  for (let i = 2; i < 10000; i++) {
    const candidate = withExt(`${stem} (${i})`)
    if (!exists(candidate)) return candidate
  }
  return withExt(`${stem} ${Date.now()}`)
}

/** 从 URL 推一个文件名主干（最后一段路径，去掉查询串）；推不出来返回 null */
export function stemFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
    if (!last) return null
    return splitName(last).stem || null
  } catch {
    return null
  }
}

/** 粘贴的图片：Pasted 2026-10-11 14.32.05（文件名里不能有冒号） */
export function pastedStem(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `Pasted ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}.${p(date.getSeconds())}`
}

/** 只放行 http(s) URL（来源链接、拖入时的下载地址都过这一道） */
export function isHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 4096) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
