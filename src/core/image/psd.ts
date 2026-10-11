/**
 * PSD / PSB 合成图（"image data" 段）的纯 JS 解析。
 *
 * 只读文件末尾的合成位图，跳过图层数据（用 fd 定位 + 按段长 seek，不把图层字节读进内存），
 * 所以几百 MB 的分层文件也只读头部和合成图本身。支持：
 *   - 8-bit RGB / RGBA / 灰度 / CMYK（近似转 RGB）
 *   - 压缩 0（raw）和 1（PackBits RLE）；zip（2/3）极少用于合成图，不支持 → 调用方走系统兜底
 *   - PSB（version 2）：图层段长 8 字节、RLE 行长 4 字节
 *
 * "Maximize Compatibility" 关闭时文件里没有合成图（image data 全白或缺失）——无法区分
 * "真的全白"，只能原样返回；实际上 Photoshop 默认开启，Affinity / Krita 导出也带合成图。
 */

import { open } from 'fs/promises'

/** 画布像素上限：超过就不在主进程里解（≈ 80MP RGBA ≈ 320MB），调用方走 qlmanage 兜底 */
export const PSD_MAX_PIXELS = 80_000_000

export interface PsdComposite {
  /** 交错像素（sharp raw 输入） */
  data: Buffer
  width: number
  height: number
  /** 3 = RGB, 4 = RGBA */
  channels: 3 | 4
  /** 原始颜色模式（诊断用） */
  colorMode: 'rgb' | 'grayscale' | 'cmyk'
}

const COLOR_MODES: Record<number, PsdComposite['colorMode'] | undefined> = {
  1: 'grayscale',
  3: 'rgb',
  4: 'cmyk',
}

/** PackBits 解一行到 out（长度必须正好填满），数据损坏时抛错 */
function unpackBits(src: Buffer, out: Uint8Array): void {
  let i = 0
  let o = 0
  while (o < out.length) {
    if (i >= src.length) throw new Error('PSD RLE: scanline data truncated')
    const n = src.readInt8(i++)
    if (n >= 0) {
      const len = n + 1
      if (i + len > src.length || o + len > out.length) throw new Error('PSD RLE: literal run overflow')
      out.set(src.subarray(i, i + len), o)
      i += len
      o += len
    } else if (n !== -128) {
      const len = 1 - n
      if (i >= src.length || o + len > out.length) throw new Error('PSD RLE: repeat run overflow')
      out.fill(src[i++], o, o + len)
      o += len
    }
  }
}

/**
 * 解析 PSD/PSB 的合成图。不支持的变体（16/32-bit、zip 压缩、Lab/多通道等）抛错，
 * 由调用方决定兜底路径。
 */
export async function parsePsdComposite(filePath: string): Promise<PsdComposite> {
  const fh = await open(filePath, 'r')
  try {
    const stat = await fh.stat()
    const readAt = async (pos: number, len: number): Promise<Buffer> => {
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, pos)
      if (bytesRead !== len) throw new Error(`PSD: unexpected EOF at ${pos}+${len}`)
      return buf
    }

    // ── 头（26 字节） ──────────────────────────────────────────
    const head = await readAt(0, 26)
    if (head.toString('latin1', 0, 4) !== '8BPS') throw new Error('PSD: bad signature')
    const version = head.readUInt16BE(4)
    if (version !== 1 && version !== 2) throw new Error(`PSD: unsupported version ${version}`)
    const isPsb = version === 2
    const channels = head.readUInt16BE(12)
    const height = head.readUInt32BE(14)
    const width = head.readUInt32BE(18)
    const depth = head.readUInt16BE(22)
    const modeCode = head.readUInt16BE(24)
    const colorMode = COLOR_MODES[modeCode]

    if (depth !== 8) throw new Error(`PSD: unsupported depth ${depth} (8-bit only)`)
    if (!colorMode) throw new Error(`PSD: unsupported color mode ${modeCode}`)
    if (width <= 0 || height <= 0) throw new Error('PSD: empty canvas')
    if (width * height > PSD_MAX_PIXELS) throw new Error(`PSD: canvas too large (${width}×${height})`)
    const minChannels = colorMode === 'cmyk' ? 4 : colorMode === 'rgb' ? 3 : 1
    if (channels < minChannels || channels > 56) throw new Error(`PSD: bad channel count ${channels}`)

    // ── 跳过三段：color mode data / image resources / layer & mask ──
    let pos = 26
    const skipU32 = async (): Promise<void> => {
      const len = (await readAt(pos, 4)).readUInt32BE(0)
      pos += 4 + len
    }
    await skipU32() // color mode data
    await skipU32() // image resources
    if (isPsb) {
      const len = (await readAt(pos, 8)).readBigUInt64BE(0)
      pos += 8 + Number(len)
    } else {
      await skipU32() // layer & mask
    }

    // ── image data ─────────────────────────────────────────────
    const compression = (await readAt(pos, 2)).readUInt16BE(0)
    pos += 2
    if (compression !== 0 && compression !== 1) {
      throw new Error(`PSD: unsupported composite compression ${compression}`)
    }

    const planeSize = width * height
    // 只用前 minChannels 个颜色通道 + 可能的第一个 alpha 通道
    const useChannels = Math.min(channels, minChannels + 1)
    const planes: Uint8Array[] = []

    if (compression === 0) {
      const need = planeSize * useChannels
      if (pos + need > stat.size) throw new Error('PSD: raw image data truncated')
      for (let c = 0; c < useChannels; c++) {
        planes.push(new Uint8Array(await readAt(pos + c * planeSize, planeSize)))
      }
    } else {
      // RLE：所有通道的行长表在前（height × channels 项），PSD u16 / PSB u32
      const entrySize = isPsb ? 4 : 2
      const countsLen = height * channels * entrySize
      const counts = await readAt(pos, countsLen)
      pos += countsLen
      const lineLen = (idx: number): number =>
        isPsb ? counts.readUInt32BE(idx * 4) : counts.readUInt16BE(idx * 2)

      // 逐通道逐行解；不需要的通道只按行长跳过
      let dataPos = pos
      for (let c = 0; c < channels; c++) {
        const wanted = c < useChannels
        const plane = wanted ? new Uint8Array(planeSize) : null
        for (let y = 0; y < height; y++) {
          const len = lineLen(c * height + y)
          if (plane) {
            const row = await readAt(dataPos, len)
            const out = plane.subarray(y * width, (y + 1) * width)
            unpackBits(row, out)
          }
          dataPos += len
        }
        if (plane) planes.push(plane)
        if (planes.length === useChannels) break
      }
      if (planes.length < useChannels) throw new Error('PSD: RLE channels truncated')
    }

    // ── 平面 → 交错 RGB(A) ─────────────────────────────────────
    const hasAlpha = useChannels > minChannels
    const outChannels: 3 | 4 = hasAlpha ? 4 : 3
    const out = Buffer.allocUnsafe(planeSize * outChannels)
    if (colorMode === 'rgb') {
      const [r, g, b] = planes
      const a = hasAlpha ? planes[3] : null
      for (let i = 0; i < planeSize; i++) {
        const o = i * outChannels
        out[o] = r[i]; out[o + 1] = g[i]; out[o + 2] = b[i]
        if (a) out[o + 3] = a[i]
      }
    } else if (colorMode === 'grayscale') {
      const [g] = planes
      const a = hasAlpha ? planes[1] : null
      for (let i = 0; i < planeSize; i++) {
        const o = i * outChannels
        out[o] = g[i]; out[o + 1] = g[i]; out[o + 2] = g[i]
        if (a) out[o + 3] = a[i]
      }
    } else {
      // CMYK：PSD 存的是反相值（255 = 无墨）。近似：R = C' × K' / 255（' 为存储值）
      const [c, m, y, k] = planes
      const a = hasAlpha ? planes[4] : null
      for (let i = 0; i < planeSize; i++) {
        const o = i * outChannels
        out[o] = (c[i] * k[i]) / 255
        out[o + 1] = (m[i] * k[i]) / 255
        out[o + 2] = (y[i] * k[i]) / 255
        if (a) out[o + 3] = a[i]
      }
    }

    return { data: out, width, height, channels: outChannels, colorMode }
  } finally {
    await fh.close()
  }
}
