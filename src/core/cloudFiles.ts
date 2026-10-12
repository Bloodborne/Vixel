/**
 * 云端占位文件的磁盘判定（纯规则在 skipRules.ts；这里是碰 OS 的部分）。
 * 目标：绝不因为索引触发 iCloud / OneDrive 下载。
 *
 *   macOS / Linux：fs.stat 的 blocks —— 逻辑大小不小但磁盘上 0 块 = dataless
 *     （macOS SF_DATALESS 的廉价近似，省掉每个文件一次 FFI / 子进程读 st_flags）。
 *     4 KB 以下的小文件不适用（APFS 可能内联存储），反正下载它们也无代价。
 *   Windows：koffi 直调 GetFileAttributesW，看 OFFLINE / RECALL_ON_* 位
 *     （OneDrive 按需文件）。koffi 已是依赖（LiteRT 绑定在用）。
 *
 * `.xxx.icloud` 占位名在 skipRules.shouldIgnorePath 里就被挡掉，不会走到这里。
 */
import { isCloudFileAttributes } from './skipRules'

const DATALESS_MIN_SIZE = 4096
const INVALID_FILE_ATTRIBUTES = 0xffffffff

type GetFileAttributesW = (path: string) => number
let winAttr: GetFileAttributesW | null | undefined

function loadWinAttr(): GetFileAttributesW | null {
  if (winAttr !== undefined) return winAttr
  winAttr = null
  if (process.platform === 'win32') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi') as typeof import('koffi')
      const kernel32 = koffi.load('kernel32.dll')
      winAttr = kernel32.func('uint32 __stdcall GetFileAttributesW(str16 path)') as GetFileAttributesW
    } catch (err) {
      console.warn('[cloud] GetFileAttributesW unavailable, OneDrive stubs not detected:', err)
    }
  }
  return winAttr
}

/** 这个文件是不是云端占位（读它会触发下载）。stats 来自 fs.stat（已经在手，不多跑 syscall） */
export function isCloudStub(filePath: string, stats: { size: number; blocks?: number }): boolean {
  if (process.platform === 'win32') {
    const fn = loadWinAttr()
    if (!fn) return false
    try {
      const attrs = fn(filePath)
      return attrs !== INVALID_FILE_ATTRIBUTES && isCloudFileAttributes(attrs)
    } catch {
      return false
    }
  }
  return stats.size > DATALESS_MIN_SIZE && stats.blocks === 0
}
