import { existsSync } from 'fs'

let cachedPath: string | null | undefined

/**
 * Resolve ffmpeg-static to the physical executable. Electron may resolve the
 * package entry from app.asar, but child_process.spawn needs the corresponding
 * file in app.asar.unpacked.
 */
export function getFfmpegPath(): string | null {
  if (cachedPath !== undefined) return cachedPath

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const packagePath = (require('ffmpeg-static') as string | null) || null
    if (!packagePath) {
      cachedPath = null
      return cachedPath
    }

    const unpackedPath = packagePath.replace(/\.asar([\/])/, '.asar.unpacked$1')
    cachedPath = unpackedPath !== packagePath && existsSync(unpackedPath)
      ? unpackedPath
      : packagePath
  } catch {
    cachedPath = null
  }

  return cachedPath
}
